// ren-three against react-three-fiber on the same scene, in headless Chrome
// (WebGL on SwiftShader): 1,000 meshes (one shared geometry, a material
// each) in a keyed list, created, every 10th recolored, two swapped, all
// cleared. Each operation is timed from its call to the end of the WebGL
// render that draws it (both render on demand); after each, the scene's
// meshes and a checksum of their colors and places must equal the other
// implementation's. Every sample is on a fresh page, the implementations
// alternating in ABBA order.
//
//   flock "$HOME/.cache/chrome-bench.lock" node bench/r3f/run.mjs [--rounds 10] [--warmup 3]
//
// Bundles and results go to the build directory (artifact/bench/r3f).

import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cpus, loadavg } from 'node:os';
import { provenance as harnessProvenance, sources } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const out = join(repo, 'artifact', 'bench', 'r3f');
const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {number} */ fallback) => (args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback);
const ROUNDS = option('rounds', 10);
const WARMUP = option('warmup', 3);
const OPS = ['create', 'update', 'swap', 'clear'];
const IMPLS = ['ren-three', 'react-three-fiber'];

// Bundles: ren-three from its installed public package, compiled by ren-core's esbuild plugin;
// react-three-fiber as its users build it. One three.js for both.
const requireRepo = createRequire(join(repo, 'package.json'));
const { ren } = await import(requireRepo.resolve('ren-core/esbuild'));
const three = join(here, 'node_modules', 'three', 'build', 'three.module.js');
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: /** @type {const} */ ('esm'), target: 'es2022', minify: true, logLevel: /** @type {const} */ ('warning'), alias: { three }, define: { 'process.env.NODE_ENV': '"production"' } };
await build({ ...common, entryPoints: [join(here, 'impl', 'ren.jsx')], outfile: join(out, 'ren-three.js'), jsx: 'automatic', jsxImportSource: 'ren-core', plugins: [ren()], nodePaths: [join(repo, 'node_modules')] });
await build({ ...common, entryPoints: [join(here, 'impl', 'r3f.jsx')], outfile: join(out, 'react-three-fiber.js'), jsx: 'automatic', nodePaths: [join(here, 'node_modules')] });
for (const impl of IMPLS) writeFileSync(join(out, `${impl}.html`), `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="scene"></div><script type="module" src="./${impl}.js"></script>`);

const server = createServer((req, res) => {
  const file = join(out, new URL(String(req.url), 'http://x').pathname);
  if (!file.startsWith(out) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'text/html' }).end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const port = /** @type {any} */ (server.address()).port;

const chrome = ['google-chrome', 'chromium', 'chromium-browser'].find(name => {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) throw new Error('Chrome or Chromium is required');
const profile = mkdtempSync(join(out, 'chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', `--user-data-dir=${profile}`, '--window-size=1000,800', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });

/** A DevTools session on a page's WebSocket. @param {string} url */
async function devtools(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
  let id = 0;
  /** @type {Map<number, (m: any) => void>} */
  const calls = new Map();
  /** The waiters for each event, by method. @type {Map<string, ((params: any) => void)[]>} */
  const events = new Map();
  socket.onmessage = e => {
    const m = JSON.parse(String(e.data));
    if (m.id && calls.has(m.id)) /** @type {any} */ (calls.get(m.id))(m), calls.delete(m.id);
    else if (m.method && events.has(m.method)) {
      const waiting = /** @type {((params: any) => void)[]} */ (events.get(m.method));
      events.delete(m.method);
      for (const resolve of waiting) resolve(m.params);
    }
  };
  return {
    /** The next event of `method`. @param {string} method @returns {Promise<any>} */
    once: method =>
      new Promise(resolve => {
        const waiting = events.get(method);
        if (waiting !== undefined) waiting.push(resolve);
        else events.set(method, [resolve]);
      }),
    /** @param {string} method @param {object} [params] @returns {Promise<any>} */
    send: (method, params = {}) => new Promise(resolve => (calls.set(++id, resolve), socket.send(JSON.stringify({ id, method, params })))),
    close: () => socket.close(),
  };
}

/** @type {Record<string, Record<string, number[]>>} */
const samples = Object.fromEntries(IMPLS.map(i => [i, Object.fromEntries(OPS.map(o => [o, []]))]));
/** @type {Record<string, any>} */
let chromeVersion = {};
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    // timer: deadline, Chrome that never listens fails the run.
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
    browser.stderr.on('data', c => {
      log += c;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) (clearTimeout(timer), resolve(m[1]));
    });
  });
  const http = String(endpoint).replace(/^ws:\/\/([^/]+)\/.*$/, 'http://$1');
  chromeVersion = await (await fetch(`${http}/json/version`)).json();
  const page = (await (await fetch(`${http}/json/list`)).json()).find((/** @type {any} */ t) => t.type === 'page');
  const cdp = await devtools(page.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  // A page's errors, to report when it does not start.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors = []; addEventListener('error', e => __errors.push(String(e.message))); addEventListener('unhandledrejection', e => __errors.push(String(e.reason && e.reason.stack || e.reason)));" });
  /** @param {string} expression */
  const evaluate = async expression => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 === 0 ? IMPLS : [...IMPLS].reverse();
    for (const op of OPS) {
      /** @type {Record<string, any>} */
      const checks = {};
      for (const impl of order) {
        // The page's module script publishes window.bench before its load event.
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/${impl}.html` });
        await loaded;
        await evaluate(`(async () => { if (!window.bench) throw new Error('${impl} did not start: ' + window.__errors.join(' / ')); await window.bench.ready; })()`);
        // Warm-up runs, each a real change (an operation that changes nothing draws nothing),
        // then the state the timed operation starts from.
        const warm = op === 'create' || op === 'clear' ? ['create', 'clear'] : ['create', ...Array(WARMUP).fill(op), 'clear'];
        for (let w = 0; w < (op === 'create' || op === 'clear' ? WARMUP : 1); w++) for (const o of warm) await evaluate(`window.bench.run(${JSON.stringify(o)})`);
        if (op !== 'create') await evaluate(`window.bench.run('create')`);
        const ms = await evaluate(`window.bench.run(${JSON.stringify(op)})`);
        checks[impl] = await evaluate('window.bench.check()');
        samples[impl][op].push(ms);
      }
      const [a, b] = IMPLS.map(i => JSON.stringify(checks[i]));
      if (a !== b) throw new Error(`${op}: the scenes differ: ${IMPLS[0]} ${a}, ${IMPLS[1]} ${b}`);
    }
  }
  cdp.close();
} finally {
  try {
    process.kill(-(/** @type {number} */ (browser.pid)), 'SIGTERM');
  } catch {}
  server.close();
  // Its profile is free once Chrome has exited.
  if (browser.exitCode === null && browser.signalCode === null) await new Promise(resolve => browser.once('exit', resolve));
  rmSync(profile, { recursive: true, force: true });
}

const median = (/** @type {number[]} */ xs) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const versions = JSON.parse(readFileSync(join(here, 'node_modules', '@react-three', 'fiber', 'package.json'), 'utf8')).version;
const provenance = { date: new Date().toISOString(), chrome: chromeVersion.Browser, node: process.version, three: JSON.parse(readFileSync(join(here, 'node_modules', 'three', 'package.json'), 'utf8')).version, fiber: versions, react: JSON.parse(readFileSync(join(here, 'node_modules', 'react', 'package.json'), 'utf8')).version, rounds: ROUNDS, warmup: WARMUP, load: loadavg(), cpus: cpus().length, ...harnessProvenance(repo), sources: sources(['rrx-core', 'ren-core', 'ren-canv', 'ren-three'], import.meta.url) };
console.log(`| op | ren-three (ms, median) | react-three-fiber | ratio |\n| --- | ---: | ---: | ---: |`);
for (const op of OPS) {
  const a = median(samples['ren-three'][op]);
  const b = median(samples['react-three-fiber'][op]);
  console.log(`| ${op} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${(a / b).toFixed(2)} |`);
}
mkdirSync(join(out, 'results'), { recursive: true });
const file = join(out, 'results', `${provenance.date.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ provenance, samples }, null, 1));
console.log(JSON.stringify(provenance));
console.log(`results: ${file}`);
process.exit(0);
