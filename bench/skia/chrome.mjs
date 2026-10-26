// The Skia renderer in headless Chrome (bench/skia/page.jsx): the
// accessibility mirror's cost on create and clear of 1,000 rows (`aria-off`
// against `aria-on`), and damage repaint against whole-frame repaint (`full`
// against `damage`) for swap, update and a keystroke. Each arm runs in its own
// Chrome process, arms in ABBA order, `--runs` times each; every process
// measures `--rounds` rounds after `--warmup`. Take the machine-wide Chrome
// lock (resources.md):
//
//   flock -w 1800 "$HOME/.cache/chrome-bench.lock" node bench/skia/chrome.mjs [--suite aria|damage] [--runs 4] [--rounds 10] [--warmup 3]

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';
import { provenance, sources } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lib = resolvePath(here, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const suite = option('suite', 'aria');
const runs = Number(option('runs', 4));
const rounds = Number(option('rounds', 10));
const warmup = Number(option('warmup', 3));
const arms = suite === 'damage' ? ['full', 'damage'] : ['aria-off', 'aria-on'];

const artifact = join(lib, 'artifact');
const dist = join(artifact, 'bench/skia/dist');
mkdirSync(dist, { recursive: true });
await build({ entryPoints: { page: join(here, 'page.jsx') }, outdir: dist, bundle: true, format: 'esm', jsx: 'automatic', jsxImportSource: 'ren-core', target: 'es2022', logLevel: 'warning' });

// Resolve the installed engines and the renderer font through package exports.
const require = createRequire(import.meta.url);
const canv = createRequire(require.resolve('ren-canv'));
const taffy = canv.resolve.paths('taffy-layout').map(path => join(path, 'taffy-layout/pkg/taffy_wasm_bg.wasm')).find(path => existsSync(path));
if (!taffy) throw new Error("Cannot locate ren-canv's Taffy WebAssembly");
const files = {
  '/taffy.wasm': [taffy, 'application/wasm'],
  '/dist/page.js': [join(dist, 'page.js'), 'text/javascript'],
  '/canvaskit/canvaskit.js': [require.resolve('canvaskit-wasm'), 'text/javascript'],
  '/canvaskit/canvaskit.wasm': [require.resolve('canvaskit-wasm/bin/canvaskit.wasm'), 'application/wasm'],
  '/font.ttf': [require.resolve('ren-skia/font.ttf'), 'font/ttf'],
};
let received = null;
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
  if (url.pathname === '/') {
    response
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><script src="/canvaskit/canvaskit.js"></script><script type="module" src="/dist/page.js"></script>');
    return;
  }
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  const file = files[url.pathname];
  if (!file) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': file[1] }).end(readFileSync(file[0]));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find(name => {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) throw new Error('Chrome or Chromium is required');
const version = execFileSync(chrome, ['--version']).toString().trim();

let running = null;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (running) {
      try {
        process.kill(-running.pid, 'SIGKILL');
      } catch {}
      rmSync(running.profile, { recursive: true, force: true });
    }
    process.exit(130);
  });

/** A DevTools session on `url`. @param {string} url */
async function devtools(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  /** @type {((message: any) => void)[]} */
  const listeners = [];
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) for (const listen of listeners) listen(message);
  };
  return {
    /** @param {string} method @param {object} [params] */
    send: (method, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params })),
    /** @param {(message: any) => void} listen */
    on: listen => void listeners.push(listen),
    close: () => socket.close(),
  };
}

/**
 * Opens `url` in `browser` (started on about:blank with a debugging port),
 * calling `fail` with the page's first exception or console error.
 * @param {import('node:child_process').ChildProcess} browser @param {string} url @param {(why: string) => void} fail
 */
async function watch(browser, url, fail) {
  const endpoint = await new Promise(resolve => {
    let log = '';
    /** @param {Buffer} chunk */
    const read = chunk => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        browser.stderr?.off('data', read);
        browser.stderr?.resume();
        resolve(match[1]);
      }
    };
    browser.stderr?.on('data', read);
  });
  const http = String(endpoint).replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
  const target = (await (await fetch(`${http}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
  const cdp = await devtools(target.webSocketDebuggerUrl);
  cdp.on(message => {
    const p = message.params;
    if (message.method === 'Runtime.exceptionThrown') fail(`page exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
    if (message.method === 'Runtime.consoleAPICalled' && p.type === 'error') fail(`page console error: ${p.args.map((/** @type {any} */ a) => a.value ?? a.description).join(' ')}`);
    if (message.method === 'Log.entryAdded' && p.entry.level === 'error') fail(`page error: ${p.entry.text} ${p.entry.url ?? ''}`);
  });
  cdp.send('Runtime.enable');
  cdp.send('Log.enable');
  cdp.send('Page.navigate', { url });
  return cdp;
}

/** One arm in its own Chrome. @param {string} arm */
async function run(arm) {
  const base = join(artifact, 'bench/skia/profiles');
  mkdirSync(base, { recursive: true });
  const profile = mkdtempSync(join(base, 'ren-skia-chrome-'));
  const url = `http://127.0.0.1:${port}/?arm=${arm}&rounds=${rounds}&warmup=${warmup}`;
  const browser = spawn(
    chrome,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-proxy-server', '--no-first-run', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--max-old-space-size=1024', `--user-data-dir=${profile}`, '--window-size=1280,1000', '--remote-debugging-port=0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  running = { pid: browser.pid, profile };
  /** @type {Awaited<ReturnType<typeof devtools>> | null} */
  let cdp = null;
  try {
    return await new Promise((resolve, reject) => {
      // timer: deadline, a page that never posts fails the run.
      const timer = setTimeout(() => reject(new Error(`${arm}: no result in 120 s`)), 120000);
      const fail = (/** @type {string} */ why) => {
        clearTimeout(timer);
        reject(new Error(`${arm}: ${why}`));
      };
      received = result => {
        clearTimeout(timer);
        resolve(result);
      };
      browser.once('exit', code => fail(`Chrome exited (${code})`));
      // The page's exceptions and console errors fail the run at once, with
      // their message, instead of a silent deadline.
      watch(browser, url, fail).then(c => (cdp = c), fail);
    });
  } finally {
    cdp?.close();
    received = null;
    try {
      process.kill(-browser.pid, 'SIGKILL');
    } catch {}
    // Its profile is free once Chrome has exited.
    if (browser.exitCode === null && browser.signalCode === null) await new Promise(resolve => browser.once('exit', resolve));
    rmSync(profile, { recursive: true, force: true });
    running = null;
  }
}

/** @type {Record<string, Record<string, { js: number[], layout: number[], frame: number[] }>>} */
const all = {};
const load = [loadavg()[0]];
for (let r = 0; r < runs; r++) {
  const order = r % 2 === 0 ? arms : arms.slice().reverse();
  for (const arm of order) {
    process.stderr.write(`run ${r} ${arm}\n`);
    const result = await run(arm);
    process.stderr.write(`  last repaint: ${result.repaint}\n`);
    const into = (all[arm] ??= {});
    for (const [name, v] of Object.entries(result.results)) {
      const r2 = (into[name] ??= { js: [], layout: [], frame: [] });
      r2.js.push(...v.js);
      r2.layout.push(...v.layout);
      r2.frame.push(...v.frame);
    }
  }
}
load.push(loadavg()[0]);
server.close();

const median = list => {
  const sorted = list.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
const f = list => `${Math.min(...list).toFixed(2)} / ${median(list).toFixed(2)}`;
console.log(`${suite}: ${version}, node ${process.version}, ${cpus().length} CPUs, load ${load.map(x => x.toFixed(1)).join(' → ')}, ${runs} Chrome runs per arm (ABBA) × ${rounds} rounds after ${warmup} warm-up; ms, min / median`);
console.log('| operation | arm | JS (to present) | + style and layout | to next frame |');
console.log('| --- | --- | ---: | ---: | ---: |');
const ops = Object.keys(all[arms[0]]);
for (const op of ops) for (const arm of arms) if (all[arm][op]) console.log(`| ${op} | ${arm} | ${f(all[arm][op].js)} | ${f(all[arm][op].layout)} | ${f(all[arm][op].frame)} |`);

console.log(JSON.stringify({ provenance: { ...provenance(lib), sources: sources(['rrx-core', 'ren-core', 'ren-canv', 'ren-skia'], import.meta.url) }, suite, runs, rounds, warmup, chrome: version, load, samples: all }));
