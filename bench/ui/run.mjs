// The UI benchmark of the direct and worker modes, in headless Chrome.
//
//   flock "$HOME/.cache/chrome-bench.lock" node bench/ui/run.mjs [--rounds 10] [--warmup 3] [--keys 40] [--burst-keys 100]
//                                                                [--interval 30] [--work 0] [--yielding timeout|message] [--only dom-direct-batch,skia-worker-qos,…] [--json]
//   flock "$HOME/.cache/chrome-bench.lock" node bench/ui/run.mjs --scenario dispose [--keys 40] [--interval 30] [--repeat 5] [--weight 0] [--only dom-direct-batch-on,…]
//
// Bundles bench/ui/page.jsx and bench/ui/worker.jsx with esbuild, serves them
// with CanvasKit and the font, and runs each configuration in its own Chrome
// process: renderer (dom, skia) × mode and config (direct with rrx-core batching on
// or off; worker with QoS on or plain, or QoS with the shared mailbox). The
// pages are served cross-origin isolated (COOP/COEP), so SharedArrayBuffer
// exists; only the mailbox configuration uses it. Every configuration runs the same
// application (bench/ui/app.jsx), operations, rounds and warm-up. Keystrokes
// are real input events sent through the DevTools protocol
// (Input.dispatchKeyEvent) at a fixed interval, without waiting for the page.
// Prints provenance, then one JSON line per configuration, then tables.
//
// --scenario dispose: disposal under input. Each configuration (renderer ×
// direct batch or worker qos × pacing on, off or rrx-core) renders 10,000 rows,
// then types --keys keystrokes every --interval ms while, 150 ms in, the rows
// are cleared: keystroke latency, frame rate and long frames over the
// typing, the clear's main-thread time, and the background drain (time to
// the last row freed, slices and the longest slice). --repeat runs each
// configuration that many times, interleaved (on, off, rrx-core, rrx-core, off, on, …).
// --weight gives each row that many memos, effects and cleanups (a heavier
// component, so a heavier disposal).

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { provenance, sources } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolvePath(here, '../..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const settings = {
  rounds: Number(option('rounds', 10)),
  warmup: Number(option('warmup', 3)),
  keys: Number(option('keys', 40)),
  burstKeys: Number(option('burst-keys', 100)),
  interval: Number(option('interval', 30)),
  work: Number(option('work', 0)),
  yielding: option('yielding', 'timeout'),
  weight: Number(option('weight', 0)),
};
const all = [];
for (const renderer of ['dom', 'skia'])
  for (const [mode, config] of [['direct', 'batch'], ['direct', 'nobatch'], ['worker', 'qos'], ['worker', 'plain'], ['worker', 'mailbox']]) all.push({ renderer, mode, config });
const scenario = option('scenario', 'ops');
const repeat = Number(option('repeat', 1));
const only = option('only', null);
const tag = c => `${c.renderer}-${c.mode}-${c.config}${c.pacing ? `-${c.pacing}` : ''}`;
let configs = only && scenario !== 'dispose' ? all.filter(c => only.split(',').includes(tag(c))) : all;
if (scenario === 'dispose') {
  const cells = [];
  for (const renderer of ['dom', 'skia'])
    for (const [mode, config] of [['direct', 'batch'], ['worker', 'qos']]) {
      const group = ['on', 'off', 'rrx'].map(pacing => ({ renderer, mode, config, pacing, scenario }));
      if (only ? group.some(c => only.split(',').includes(tag(c))) : renderer === 'dom') cells.push(group.filter(c => !only || only.split(',').includes(tag(c))));
    }
  // Interleaved (ABBA over the pacings) so drift in the machine's load
  // spreads over every pacing.
  configs = [];
  for (let r = 0; r < repeat; r++) for (const group of cells) configs.push(...(r % 2 === 0 ? group : group.slice().reverse()));
}

// ---------------------------------------------------------------------------
// Bundles resolve family packages through their public entries.
// Bundles and Chrome profiles stay in this benchmark checkout's artifact.
const artifact = join(lib, 'artifact');
const dist = join(artifact, 'bench/ui/dist');
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: { page: join(here, 'page.jsx'), worker: join(here, 'worker.jsx') },
  outdir: dist,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  jsxImportSource: 'ren-core',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
});
// --build: bundles only (to check that they compile), no Chrome.
if (args.includes('--build')) {
  console.log(`bundled ${dist}/page.js and worker.js`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Server

const canv = createRequire(require.resolve('ren-canv'));
const taffy = canv.resolve.paths('taffy-layout').map(path => join(path, 'taffy-layout/pkg/taffy_wasm_bg.wasm')).find(path => existsSync(path));
if (!taffy) throw new Error("Cannot locate ren-canv's Taffy WebAssembly");
const files = {
  '/taffy.wasm': [taffy, 'application/wasm'],
  '/dist/page.js': [join(dist, 'page.js'), 'text/javascript'],
  '/dist/worker.js': [join(dist, 'worker.js'), 'text/javascript'],
  '/canvaskit/canvaskit.js': [join(here, 'node_modules/canvaskit-wasm/bin/canvaskit.js'), 'text/javascript'],
  '/canvaskit/canvaskit.wasm': [join(here, 'node_modules/canvaskit-wasm/bin/canvaskit.wasm'), 'application/wasm'],
  '/font.ttf': [require.resolve('ren-skia/font.ttf'), 'font/ttf'],
};
const page = renderer =>
  `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}#app{height:600px;overflow:auto}</style>` +
  (renderer === 'skia' ? '<script src="/canvaskit/canvaskit.js"></script>' : '') +
  `<div id="app"></div><script type="module" src="/dist/page.js"></script>`;

let received = null;
let typist = null;
/** Cross-origin isolation, so the mailbox configuration can share memory with its worker. */
const ISOLATED = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  if (request.method === 'POST' && url.pathname === '/result') {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      response.writeHead(204).end();
      if (received) received(JSON.parse(body));
    });
    return;
  }
  if (url.pathname === '/log') {
    if (process.env.TRACE) process.stderr.write(`page: ${url.searchParams.get('m')}\n`);
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === '/type') {
    typist(Number(url.searchParams.get('count')), Number(url.searchParams.get('interval'))).then(
      () => response.writeHead(200, { 'content-type': 'text/plain' }).end('ok'),
      error => response.writeHead(500).end(String(error)),
    );
    return;
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html', ...ISOLATED }).end(page(url.searchParams.get('renderer')));
    return;
  }
  const file = files[url.pathname];
  if (!file) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': file[1], ...ISOLATED }).end(readFileSync(file[0]));
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

/** A minimal CDP session over the page target's WebSocket. */
async function devtools(ws) {
  const socket = new WebSocket(ws);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const calls = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && calls.has(message.id)) {
      calls.get(message.id)(message);
      calls.delete(message.id);
    }
  };
  return {
    send: (method, params = {}) =>
      new Promise(resolve => {
        calls.set(++id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

// The running browser, stopped (with its profile removed) if this driver is interrupted.
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

async function run(spec) {
  process.stderr.write(`run ${tag(spec)} (load ${loadavg()[0].toFixed(1)})\n`);
  const base = join(artifact, 'tmp/ui');
  mkdirSync(base, { recursive: true });
  const profile = mkdtempSync(join(base, 'ren-bench-chrome-'));
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
      `--user-data-dir=${profile}`,
      '--window-size=1280,1000',
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  running = { pid: browser.pid, profile };
  try {
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
    const targets = await (await fetch(`${http}/json/list`)).json();
    const target = targets.find(t => t.type === 'page');
    const cdp = await devtools(target.webSocketDebuggerUrl);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.enable');
    typist = async (count, interval) => {
      const sent = [];
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        const due = start + i * interval;
        const wait = due - performance.now();
        // timer: feature, keystrokes go at the --interval cadence.
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        sent.push(cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }));
        sent.push(cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 }));
      }
      await Promise.all(sent);
    };
    const result = new Promise((resolve, reject) => {
      received = resolve;
      // timer: deadline
      setTimeout(() => reject(new Error(`timeout: ${spec.renderer}-${spec.mode}-${spec.config}`)), 600000);
    });
    const query = new URLSearchParams({ ...spec, ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k === 'burstKeys' ? 'burstKeys' : k, String(v)])) });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${query}` });
    const data = await result;
    cdp.close();
    return data;
  } finally {
    // The profile is removed once Chrome has exited.
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise(resolve => browser.once('exit', resolve));
      try {
        process.kill(-browser.pid, 'SIGTERM');
      } catch {}
      // timer: deadline, a Chrome that ignores SIGTERM is killed.
      const kill = setTimeout(() => {
        try {
          process.kill(-browser.pid, 'SIGKILL');
        } catch {}
      }, 5000);
      await exited;
      clearTimeout(kill);
    }
    rmSync(profile, { recursive: true, force: true });
    running = null;
  }
}

// ---------------------------------------------------------------------------
// Statistics and report

const sorted = list => list.slice().sort((a, b) => a - b);
const quantile = (list, q) => {
  if (list.length === 0) return null;
  const s = sorted(list);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
const min = list => (list.length ? Math.min(...list) : null);
const median = list => quantile(list, 0.5);
const sum = (list, key) => list.reduce((a, b) => a + (b[key] ?? 0), 0);
const round = (value, digits = 2) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

console.log(JSON.stringify({ provenance: { ...provenance(lib), sources: sources(['rrx-core', 'ren-core', 'ren-dom', 'ren-canv', 'ren-skia'], import.meta.url), chrome: chromeVersion, settings, scenario, repeat, cpus: cpus().length, load: loadavg().map(x => round(x)), date: new Date().toISOString() } }));

let failed = false;
if (scenario === 'dispose') {
  /** @type {Map<string, any[]>} */
  const byTag = new Map();
  for (const spec of configs) {
    const data = await run(spec);
    const error = data.error ?? data.dispose?.drain?.error;
    if (error) {
      failed = true;
      console.log(JSON.stringify({ ...spec, error }));
      continue;
    }
    const p = data.dispose;
    const line = {
      tag: tag(spec),
      load: round(loadavg()[0]),
      n: p.samples.length,
      lost: p.lost,
      p50: round(quantile(p.samples, 0.5)),
      p95: round(quantile(p.samples, 0.95)),
      max: round(Math.max(...p.samples)),
      fps: round(p.intervals.length / Math.max(1e-9, p.intervals.reduce((a, b) => a + b, 0) / 1000), 1),
      longFrames: p.intervals.filter(x => x > 25).length,
      longestFrame: round(Math.max(...p.intervals)),
      frames: p.intervals.length,
      clearApplied: round(p.clear?.applied),
      clearBusy: round(p.clear?.busy),
      drain: p.drain && !p.drain.error ? { time: round(p.drain.time), slices: p.drain.slices, longest: round(p.drain.longest), busy: round(p.drain.busy), late: p.drain.late } : (p.drain ?? null),
    };
    console.log(JSON.stringify(line));
    if (!byTag.has(line.tag)) byTag.set(line.tag, []);
    byTag.get(line.tag).push(line);
  }
  server.close();
  const med = (lines, f) => round(median(lines.map(f).filter(x => x != null)));
  console.log(`\nDisposal under input: ${settings.keys} keystrokes every ${settings.interval} ms, 10,000 rows (weight ${settings.weight}) cleared 150 ms in; medians over ${repeat} run(s) per configuration:\n`);
  console.log('| configuration | keystroke p50 / p95 / max | fps (long frames > 25 ms) | longest frame | clear: applied / main busy | drain: to freed / slices / longest slice |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, lines] of byTag) {
    const d = lines.filter(l => l.drain && l.drain.time != null);
    const drainCell = d.length ? `${med(d, l => l.drain.time)} / ${med(d, l => l.drain.slices)} / ${med(d, l => l.drain.longest)}` : '– (stopped in the clear)';
    console.log(`| ${name} | ${med(lines, l => l.p50)} / ${med(lines, l => l.p95)} / ${med(lines, l => l.max)} | ${med(lines, l => l.fps)} (${med(lines, l => l.longFrames)}/${med(lines, l => l.frames)}) | ${med(lines, l => l.longestFrame)} | ${med(lines, l => l.clearApplied)} / ${med(lines, l => l.clearBusy)} | ${drainCell} |`);
  }
  console.log(JSON.stringify({ load: loadavg().map(x => round(x)) }));
  process.exit(failed ? 1 : 0);
}

const results = [];
for (const spec of configs) {
  const data = await run(spec);
  if (data.error) {
    failed = true;
    console.log(JSON.stringify({ ...spec, error: data.error }));
    continue;
  }
  const line = { ...spec, ops: {}, typing: {}, boundary: {} };
  for (const [name, op] of Object.entries(data.ops)) {
    line.ops[name] = { min: round(min(op.applied)), median: round(median(op.applied)), busyMin: round(min(op.busy)), busyMedian: round(median(op.busy)) };
    if (op.totals.length) {
      const t = op.totals;
      const w = op.worker;
      const messages = sum(t, 'messages');
      line.boundary[name] = {
        messages: round(messages / t.length, 1),
        records: round(sum(t, 'records') / messages, 0),
        bytes: round(sum(t, 'bytes') / messages, 0),
        postMs: round(sum(w, 'post') / Math.max(1, sum(w, 'messages')), 3),
        readMs: round(sum(t, 'read') / messages, 3),
        applyMs: round(sum(t, 'apply') / messages, 3),
        presentMs: round(sum(t, 'present') / messages, 3),
        coalesced: round(sum(w, 'coalesced') / t.length, 0),
      };
    }
  }
  for (const phase of ['idle', 'burst']) {
    const p = data[phase];
    if (process.env.TRACE) process.stderr.write(`${phase} ${JSON.stringify(p.samples.map(x => Math.round(x)))} ${JSON.stringify(p.trace)}\n`);
    const entry = {
      n: p.samples.length,
      lost: p.lost,
      p50: round(quantile(p.samples, 0.5)),
      p95: round(quantile(p.samples, 0.95)),
      p99: round(quantile(p.samples, 0.99)),
      max: round(Math.max(...p.samples)),
      frameP50: round(quantile(p.frames, 0.5)),
      frameP95: round(quantile(p.frames, 0.95)),
      frameP99: round(quantile(p.frames, 0.99)),
      fps: round(p.intervals.length / Math.max(1e-9, p.intervals.reduce((a, b) => a + b, 0) / 1000), 1),
      longFrames: p.intervals.filter(x => x > 25).length,
      frames: p.intervals.length,
    };
    if (p.workerBefore) {
      entry.ticks = p.workerAfter.ticks - p.workerBefore.ticks;
      entry.appBusyPerSecond = round((p.workerAfter.spent - p.workerBefore.spent) / p.seconds, 1);
    }
    if (p.before) {
      const d = k => p.after[k] - p.before[k];
      entry.messagesPerSecond = round(d('messages') / p.seconds, 0);
      entry.recordsPerMessage = round(d('records') / Math.max(1, d('messages')), 0);
      entry.mainBusyPerSecond = round(d('busy') / p.seconds, 1);
      entry.maxApplyMs = round(p.after.max, 2);
      if (p.workerBefore) {
        const w = k => p.workerAfter.counters[k] - p.workerBefore.counters[k];
        entry.coalesced = w('coalesced');
        entry.merged = w('merged');
        entry.promotions = w('promotions');
        entry.overtaken = w('overtaken');
        entry.hurried = w('hurried');
        entry.late = w('late');
        entry.limit = p.workerAfter.counters.limit;
      }
    }
    line.typing[phase] = entry;
  }
  results.push(line);
  console.log(JSON.stringify(line));
}
server.close();

if (!args.includes('--json')) {
  const label = r => `${r.renderer} ${r.mode} ${r.config}`;
  const cell = (a, b) => `${a ?? '–'} / ${b ?? '–'}`;
  console.log('\nOperation, ms from command to applied (min / median):\n');
  console.log('| configuration | create 1,000 | update 10th | swap | clear |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const r of results) console.log(`| ${label(r)} | ${['create', 'update', 'swap', 'clear'].map(n => cell(r.ops[n].min, r.ops[n].median)).join(' | ')} |`);
  console.log('\nMain-thread busy per operation, ms (min / median):\n');
  console.log('| configuration | create 1,000 | update 10th | swap | clear |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const r of results) console.log(`| ${label(r)} | ${['create', 'update', 'swap', 'clear'].map(n => cell(r.ops[n].busyMin, r.ops[n].busyMedian)).join(' | ')} |`);
  console.log('\nKeystroke latency, ms (p50 / p95 / p99): to applied, and to the frame that shows it; idle and during a background burst:\n');
  console.log('| configuration | idle applied | idle frame | burst applied | burst frame | burst fps (long frames) |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const i = r.typing.idle;
    const b = r.typing.burst;
    const q = (e, k) => `${e[k + 'p50'] ?? e.p50} / ${e[k + 'p95'] ?? e.p95} / ${e[k + 'p99'] ?? e.p99}`;
    console.log(`| ${label(r)} | ${i.p50} / ${i.p95} / ${i.p99} | ${i.frameP50} / ${i.frameP95} / ${i.frameP99} | ${b.p50} / ${b.p95} / ${b.p99}${b.lost ? ` (${b.lost} lost)` : ''} | ${b.frameP50} / ${b.frameP95} / ${b.frameP99} | ${b.fps} (${b.longFrames}/${b.frames}) |`);
  }
  console.log('\nDuring the burst: burst ticks, application ms/s (on its thread), messages/s, records/message, main-thread connection ms/s, worker counters:\n');
  console.log('| configuration | ticks | app ms/s | msgs/s | records/msg | main ms/s | coalesced | merged | overtaken | hurried | late | limit |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const b = r.typing.burst;
    const v = x => x ?? '–';
    console.log(`| ${label(r)} | ${v(b.ticks)} | ${v(b.appBusyPerSecond)} | ${v(b.messagesPerSecond)} | ${v(b.recordsPerMessage)} | ${v(b.mainBusyPerSecond)} | ${v(b.coalesced)} | ${v(b.merged)} | ${v(b.overtaken)} | ${v(b.hurried)} | ${v(b.late)} | ${v(b.limit)} |`);
  }
  console.log('\nBoundary per message (worker modes, timed rounds): messages per op, records and bytes per message, ms per message:\n');
  console.log('| configuration | op | msgs/op | records | bytes | post | read | apply | present |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results)
    for (const [name, b] of Object.entries(r.boundary)) console.log(`| ${label(r)} | ${name} | ${b.messages} | ${b.records} | ${b.bytes} | ${b.postMs} | ${b.readMs} | ${b.applyMs} | ${b.presentMs} |`);
  console.log(JSON.stringify({ load: loadavg().map(x => round(x)) }));
}
process.exit(failed ? 1 : 0);
