// The market UI benchmark: one table application (js-framework-benchmark's
// keyed table) in each implementation of impls.mjs, timed in headless Chrome.
//
//   flock "$HOME/.cache/chrome-bench.lock" node bench/market/run.mjs [--only a,b] [--benches create1k,swap,…] [--rounds 10]
//                                                                       [--warmup 5] [--memory 3] [--slowdown 1] [--no-build] [--out file.json]
//
// Builds the implementations (build.mjs), serves them, and runs them one at
// a time, each in its own Chrome process (one Chrome at a time; the run waits
// while the machine has less than 8 GB available). Every sample loads a fresh
// page, runs the benchmark's setup and warm-up operations (untimed), then
// times one operation from the click to the painted frame (see harness.js),
// with the main thread's script, style and layout time from the DevTools
// Performance domain. The result is then checked in full; a wrong result is
// a failure, not a time. Memory: JS heap after a forced GC, when loaded and
// after creating 1,000 rows (the worker's heap too, for worker variants).
// Writes results/latest.json (or the --out file), and prints tables.

import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { impls } from './impls.mjs';
import { build, versions, dist, artifact } from './build.mjs';
import { provenance as checkout, sources } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const BENCHES = ['create1k', 'replace1k', 'update10th', 'select', 'swap', 'remove', 'create10k', 'append1k', 'clear1k', 'clear10k', 'async1k'];
const settings = {
  rounds: Number(option('rounds', 10)),
  warmup: Number(option('warmup', 5)),
  memory: Number(option('memory', 3)),
  slowdown: Number(option('slowdown', 1)),
  benches: option('benches', BENCHES.join(',')).split(','),
};
const only = option('only', null);
const list = only ? only.split(',').map(name => impls.find(x => x.name === name) ?? fail(`unknown implementation ${name}`)) : impls;
function fail(message) {
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Build and serve

if (!args.includes('--no-build')) process.stderr.write('building\n');
const sizes = args.includes('--no-build') ? JSON.parse(readFileSync(join(dist, 'sizes.json'), 'utf8')) : await build(list);
if (!args.includes('--no-build')) writeFileSync(join(dist, 'sizes.json'), JSON.stringify(sizes, null, 1));

const page = name =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><link rel="stylesheet" href="/style.css"></head>` +
  `<body><div id="main"></div><script src="/harness.js"></script><script type="module" src="/dist/${name}/main.js"></script></body></html>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  const path = url.pathname;
  const send = (file, type) => response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(readFileSync(file));
  if (path === '/style.css') return send(join(here, 'common/style.css'), 'text/css');
  if (path === '/harness.js') return send(join(here, 'harness.js'), 'text/javascript');
  const m = /^\/dist\/([a-z0-9-]+)\/([a-z]+\.js)$/.exec(path);
  if (m && existsSync(join(dist, m[1], m[2]))) return send(join(dist, m[1], m[2]), 'text/javascript');
  const p = /^\/([a-z0-9-]+)\/$/.exec(path);
  if (p && impls.some(x => x.name === p[1])) return response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(page(p[1]));
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

// ---------------------------------------------------------------------------
// Chrome and the DevTools protocol

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find(name => {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) throw new Error('Chrome or Chromium is required');
const chromeVersion = execFileSync(chrome, ['--version']).toString().trim();

/** A minimal CDP client over the page target's WebSocket, with flat sessions. */
async function devtools(ws) {
  const socket = new WebSocket(ws);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const calls = new Map();
  const listeners = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && calls.has(message.id)) {
      const { resolve, reject } = calls.get(message.id);
      calls.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ''}`));
      else resolve(message.result);
    } else if (message.method) for (const fn of listeners.get(message.method) ?? []) fn(message.params, message.sessionId);
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        calls.set(++id, { resolve, reject });
        socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      }),
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    close: () => socket.close(),
  };
}

let running = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (running) {
      try {
        process.kill(-running.pid, 'SIGKILL');
      } catch {}
      rmSync(running.profile, { recursive: true, force: true });
    }
    process.exit(130);
  });
}

const available = () => {
  const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
  return m ? Number(m[1]) / 1048576 : Infinity;
};
/** Waits (up to an hour) for 8 GB of available memory, which has no event to await. */
async function memoryGate() {
  for (let waited = 0; available() < 8; waited += 15) {
    if (waited >= 3600) throw new Error(`less than 8 GB available for an hour (${available().toFixed(1)} GB)`);
    if (waited % 60 === 0) process.stderr.write(`waiting: ${available().toFixed(1)} GB available (< 8)\n`);
    await new Promise(resolve => setTimeout(resolve, 15000)); // timer: poll
  }
}

/** Chrome profiles stay with this benchmark checkout's generated output. */
function temp() {
  const profiles = join(artifact, 'tmp/market');
  mkdirSync(profiles, { recursive: true });
  return profiles;
}

async function launch() {
  const profile = mkdtempSync(join(temp(), 'ren-market-chrome-'));
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-proxy-server',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--user-data-dir=${profile}`,
      '--window-size=1280,1000',
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  running = { pid: browser.pid, profile };
  const exited = new Promise(resolve => browser.once('exit', resolve));
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    browser.on('exit', code => reject(new Error(`Chrome exited (${code}): ${text.slice(-2000)}`)));
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000); // timer: deadline
    browser.stderr.on('data', chunk => {
      text += chunk;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const http = endpoint.replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
  const target = (await (await fetch(`${http}/json/list`)).json()).find(t => t.type === 'page');
  const cdp = await devtools(target.webSocketDebuggerUrl);
  const workers = new Set();
  cdp.on('Target.attachedToTarget', params => {
    if (params.targetInfo.type === 'worker') workers.add(params.sessionId);
  });
  cdp.on('Target.detachedFromTarget', params => workers.delete(params.sessionId));
  const session = { cdp, workers, loaded: null, close: null };
  cdp.on('Page.loadEventFired', () => {
    const done = session.loaded;
    session.loaded = null;
    if (done) done();
  });
  if (process.env.TRACE) {
    cdp.on('Runtime.consoleAPICalled', p => process.stderr.write(`  console.${p.type}: ${p.args.map(a => a.value ?? a.description).join(' ')}\n`));
    cdp.on('Runtime.exceptionThrown', p => process.stderr.write(`  exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}\n`));
  }
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  if (settings.slowdown > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: settings.slowdown });
  const close = async () => {
    cdp.close();
    try {
      process.kill(-browser.pid, 'SIGTERM');
    } catch {}
    // timer: deadline, Chrome gets 300 ms to exit on SIGTERM before the kill
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 300))]);
    try {
      process.kill(-browser.pid, 'SIGKILL');
    } catch {}
    await exited;
    rmSync(profile, { recursive: true, force: true });
    running = null;
  };
  session.close = close;
  return session;
}

/** Evaluates an expression in the page, awaiting a promise; throws the page's error. */
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text);
  return r.result.value;
}

async function open(session, name) {
  const loaded = new Promise(resolve => (session.loaded = resolve));
  await session.cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/${name}/` });
  await loaded;
  // The implementation's first render has no common event: poll for it.
  for (let i = 0; i < 400; i++) {
    if (await evaluate(session.cdp, 'window.__bench?.ready() ?? false')) return;
    await new Promise(resolve => setTimeout(resolve, 25)); // timer: poll
  }
  throw new Error(`${name}: the page never became ready`);
}

const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

/** Collects the garbage of the page and its workers. */
async function collect(session) {
  await session.cdp.send('HeapProfiler.collectGarbage');
  for (const id of session.workers) {
    try {
      await session.cdp.send('HeapProfiler.collectGarbage', {}, id);
    } catch {}
  }
}

async function heap(session) {
  await collect(session);
  const main = (await session.cdp.send('Runtime.getHeapUsage')).usedSize;
  let worker = 0;
  for (const id of session.workers) {
    try {
      worker += (await session.cdp.send('Runtime.getHeapUsage', {}, id)).usedSize;
    } catch {}
  }
  return { main, worker };
}

// ---------------------------------------------------------------------------
// Statistics

const sorted = xs => xs.slice().sort((a, b) => a - b);
const median = xs => {
  if (xs.length === 0) return null;
  const s = sorted(xs);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = xs => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const summary = xs => ({ min: round(Math.min(...xs)), median: round(median(xs)), mean: round(mean(xs)), sd: round(sd(xs)) });

// ---------------------------------------------------------------------------
// Run

const provenance = {
  date: new Date().toISOString(),
  node: process.version,
  chrome: chromeVersion,
  ...checkout(here),
  sources: sources(list.some(impl => impl.kind === 'ren' || impl.kind === 'ren-compiled') ? ['rrx-core', 'ren-core', 'ren-dom'] : [], import.meta.url),
  cpus: cpus().length,
  cpu: cpus()[0]?.model,
  settings,
  command: `node bench/market/run.mjs ${args.join(' ')}`.trim(),
  timing: 'click (element.click()) to the task after the first painted frame that shows the result: rAF probe kept last in the frame, then a posted message (harness.js)',
};
process.stderr.write(`${JSON.stringify(provenance)}\n`);

// --probe "<expression>": load each implementation's page, print the
// expression's value (awaited), and stop; for debugging a variant.
const probe = option('probe', null);
if (probe !== null) {
  for (const impl of list) {
    await memoryGate();
    const session = await launch();
    try {
      await open(session, impl.name);
      console.log(impl.name, JSON.stringify(await evaluate(session.cdp, probe)));
    } catch (error) {
      console.log(impl.name, 'error', error.message);
    } finally {
      await session.close();
    }
  }
  server.close();
  process.exit(0);
}

// --profile <bench>: prepare the benchmark on each implementation's page,
// sample the timed operation with the DevTools profiler (0.1 ms), print the
// functions with the most self time, and stop; for finding where time goes.
const profile = option('profile', null);
if (profile !== null) {
  for (const impl of list) {
    await memoryGate();
    const session = await launch();
    try {
      await open(session, impl.name);
      // A drain benchmark starts from the warm-up's garbage collected.
      if (await evaluate(session.cdp, `(window.__bench.warmup = ${settings.warmup}, window.__bench.prepare(${JSON.stringify(profile)}))`)) await collect(session);
      await session.cdp.send('Profiler.enable');
      await session.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await session.cdp.send('Profiler.start');
      const t = await evaluate(session.cdp, 'window.__bench.measure()');
      const { profile: p } = await session.cdp.send('Profiler.stop');
      await evaluate(session.cdp, 'window.__bench.verify()');
      const self = new Map();
      const byId = new Map(p.nodes.map(n => [n.id, n]));
      for (let i = 0; i < p.samples.length; i++) {
        const node = byId.get(p.samples[i]);
        const f = node.callFrame;
        const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + (p.timeDeltas[i + 1] ?? 0) / 1000);
      }
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
      console.log(`${impl.name} ${profile}: sync ${round(t.sync)} ms, total ${round(t.total)} ms; self time (ms):`);
      for (const [key, ms] of top) console.log(`  ${ms.toFixed(2).padStart(8)}  ${key}`);
    } catch (error) {
      console.log(impl.name, 'error', error.message);
    } finally {
      await session.close();
    }
  }
  server.close();
  process.exit(0);
}

const results = [];
for (const impl of list) {
  await memoryGate();
  const entry = { name: impl.name, label: impl.label, note: impl.note ?? null, versions: versions(impl), size: sizes[impl.name], load: { start: loadavg().map(x => round(x)) }, available: round(available(), 1), benches: {}, memory: null, failures: [] };
  process.stderr.write(`run ${impl.name} (load ${entry.load.start.join(' ')}, ${entry.available} GB available)\n`);
  const session = await launch();
  try {
    for (const name of settings.benches) {
      const samples = [];
      for (let r = 0; r < settings.rounds; r++) {
        try {
          await open(session, impl.name);
          // A drain benchmark starts from the warm-up's garbage collected.
          if (await evaluate(session.cdp, `(window.__bench.warmup = ${settings.warmup}, window.__bench.prepare(${JSON.stringify(name)}))`)) await collect(session);
          const m0 = await metrics(session.cdp);
          const t = await evaluate(session.cdp, 'window.__bench.measure()');
          const m1 = await metrics(session.cdp);
          await evaluate(session.cdp, 'window.__bench.verify()');
          const d = k => ((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000;
          const sample = { total: t.total, ready: t.ready, sync: t.sync, script: d('ScriptDuration'), style: d('RecalcStyleDuration'), layout: d('LayoutDuration'), task: d('TaskDuration') };
          if (t.freed !== undefined) {
            if (!t.drained) throw new Error('the background disposal never reported its end');
            Object.assign(sample, { freed: t.freed, jitter: t.jitter, frames: t.frames, longtask: t.longtask });
          }
          samples.push(sample);
        } catch (error) {
          entry.failures.push({ bench: name, round: r, error: String(error.message ?? error) });
          process.stderr.write(`  ${name} round ${r}: FAIL ${error.message ?? error}\n`);
          break;
        }
      }
      if (samples.length === settings.rounds) {
        const pick = k => samples.map(s => s[k]);
        entry.benches[name] = { n: samples.length, total: summary(pick('total')), ready: round(median(pick('ready'))), render: round(median(samples.map(s => s.total - s.ready))), script: round(median(pick('script'))), style: round(median(pick('style'))), layout: round(median(pick('layout'))), task: round(median(pick('task'))), sync: round(median(pick('sync'))), samples: samples.map(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round(v, 3)]))) };
        if (samples[0].freed !== undefined) Object.assign(entry.benches[name], { freed: summary(pick('freed')), jitter: summary(pick('jitter')), longtask: round(Math.max(...pick('longtask'))) });
        const b = entry.benches[name];
        process.stderr.write(`  ${name.padEnd(10)} total ${b.total.min} / ${b.total.median} ms, ready ${b.ready}, style+layout ${round(b.style + b.layout)}\n`);
      }
    }
    if (settings.memory > 0) {
      const ready = [];
      const run = [];
      try {
        for (let r = 0; r < settings.memory; r++) {
          await open(session, impl.name);
          await evaluate(session.cdp, 'window.__bench.painted()');
          ready.push(await heap(session));
          await evaluate(session.cdp, 'window.__bench.step("run")');
          run.push(await heap(session));
        }
        const mb = xs => round(median(xs) / 1048576, 2);
        entry.memory = { readyMain: mb(ready.map(x => x.main)), readyWorker: mb(ready.map(x => x.worker)), run1kMain: mb(run.map(x => x.main)), run1kWorker: mb(run.map(x => x.worker)) };
        process.stderr.write(`  memory     ready ${entry.memory.readyMain} MB, 1k rows ${entry.memory.run1kMain} MB${entry.memory.run1kWorker ? ` (+ worker ${entry.memory.run1kWorker} MB)` : ''}\n`);
      } catch (error) {
        entry.failures.push({ bench: 'memory', error: String(error.message ?? error) });
      }
    }
  } finally {
    await session.close();
  }
  entry.load.end = loadavg().map(x => round(x));
  results.push(entry);
}
server.close();

const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const report = { provenance, results };
// --out runs (scratch and A/B runs) leave results/latest.json alone.
const file = option('out', join(outDir, 'latest.json'));
writeFileSync(file, JSON.stringify(report, null, 1));
process.stderr.write(`wrote ${file}\n`);

// ---------------------------------------------------------------------------
// Tables

const names = settings.benches;
const cell = (r, n, f) => (r.benches[n] ? f(r.benches[n]) : r.failures.some(x => x.bench === n) ? 'FAIL' : '–');
console.log(`\nms from click to painted frame, min / median (${settings.rounds} rounds after ${settings.warmup} warm-up operations; ${chromeVersion}):\n`);
console.log(`| implementation | ${names.join(' | ')} |`);
console.log(`| --- |${names.map(() => ' ---: |').join('')}`);
for (const r of results) console.log(`| ${r.label} | ${names.map(n => cell(r, n, b => `${b.total.min} / ${b.total.median}`)).join(' | ')} |`);
console.log('\nMedian ms: to DOM ready (the click\'s JS, microtasks included; for the worker, the round trip) / ready to painted (style, layout, paint) / DevTools style+layout:\n');
console.log(`| implementation | ${names.join(' | ')} |`);
console.log(`| --- |${names.map(() => ' ---: |').join('')}`);
for (const r of results) console.log(`| ${r.label} | ${names.map(n => cell(r, n, b => `${b.ready} / ${b.render} / ${round(b.style + b.layout)}`)).join(' | ')} |`);
if (names.includes('clear10k')) {
  console.log('\nclear10k, the disposal: median ms of the click handler (sync), to the painted frame (total), to the last row freed (freed; the painted frame for implementations that free at once), the longest frame after the painted one within 250 ms of the last freeing (jitter, min / median), and the longest task of 50 ms or more then (longtask, max; 0: none):\n');
  console.log('| implementation | sync | total | freed | jitter | longtask |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const b = r.benches.clear10k;
    if (b && b.freed) console.log(`| ${r.label} | ${b.sync} | ${b.total.median} | ${b.freed.median} | ${b.jitter.min} / ${b.jitter.median} | ${b.longtask} |`);
    else console.log(`| ${r.label} | ${r.failures.some(x => x.bench === 'clear10k') ? 'FAIL' : '–'} | | | | |`);
  }
}
console.log('\nMemory (JS heap after GC, MB) and bundle (bytes, minified / gzip):\n');
console.log('| implementation | ready | 1k rows | bundle min | bundle gzip | load (start → end) |');
console.log('| --- | ---: | ---: | ---: | ---: | --- |');
for (const r of results) {
  const m = r.memory;
  const w = x => (x ? ` + ${x} worker` : '');
  console.log(`| ${r.label} | ${m ? `${m.readyMain}${w(m.readyWorker)}` : '–'} | ${m ? `${m.run1kMain}${w(m.run1kWorker)}` : '–'} | ${r.size?.min ?? '–'} | ${r.size?.gzip ?? '–'} | ${r.load.start[0]} → ${r.load.end[0]} |`);
}
const failures = results.flatMap(r => r.failures.map(f => `${r.name} ${f.bench}${f.round != null ? ` round ${f.round}` : ''}: ${f.error}`));
if (failures.length) console.log(`\nFailures:\n${failures.map(f => `- ${f}`).join('\n')}`);
process.exit(0);
