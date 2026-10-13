// The main-thread side of the UI benchmark, loaded by bench/ui/run.mjs in
// headless Chrome as index.html?renderer=dom|skia&mode=direct|worker&config=…
//
// direct: the Bench application runs here (config batch | nobatch).
// worker: it runs in a Worker; this page connects the real host
//   (config qos: lanes, coalescing, backpressure, frame scheduling;
//    config plain: none of them, every flush applied on arrival;
//    config mailbox: qos, with the shared mailbox read in animation frames).
//
// Every operation is timed from its command to the moment its change is
// applied on this thread; on the DOM a forced style and layout
// (offsetHeight) is part of it in every mode. Main-thread busy time is the
// operation itself in direct mode, and the connection's own time (reading,
// applying, presenting, forwarding) plus the forced layout in worker mode.
// Keystrokes come from the driver through the DevTools protocol, so their
// latency is measured from the browser's event timestamp.
//
// scenario=dispose: 10,000 rows, then keystrokes every `interval` ms while,
// 150 ms in, the rows are cleared; `pacing` is on (ren-core's background
// disposal), off (retire: false: every row stops in the clear) or rrx-core
// (retired, swept by rrx-core's macrotask fallback drain (4 ms setTimeout slices)).

import { $root } from 'rrx-core';
import { $dom, render as renderDom } from 'ren-dom';
import { $skia, render as renderSkia, attach, loadLayout } from 'ren-skia';
import { connect } from 'ren-core/remote';
import { Bench, rrxSweeper } from './app.jsx';

const params = new URLSearchParams(location.search);
const renderer = params.get('renderer') ?? 'dom';
const mode = params.get('mode') ?? 'direct';
const config = params.get('config') ?? (mode === 'direct' ? 'batch' : 'qos');
const rounds = Number(params.get('rounds') ?? 10);
const warmup = Number(params.get('warmup') ?? 3);
const keys = Number(params.get('keys') ?? 40);
const burstKeys = Number(params.get('burstKeys') ?? 100);
const interval = Number(params.get('interval') ?? 30);
const work = Number(params.get('work') ?? 0);
const scenario = params.get('scenario') ?? 'ops';
const pacing = params.get('pacing') ?? 'on';
const weight = Number(params.get('weight') ?? 0);
/** Burst ticks run before typing into a burst starts. */
const BURST_TICKS = 5;
/** The last drain's report, and who waits for it. */
let drain = null;
let drained = null;
const report = d => {
  drain = d;
  if (drained !== null) drained(d);
};
const now = () => performance.now();
/** The next animation frame: what was applied has been presented. */
// timer: feature, the presenting frame is what the measurement reads.
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
/** Resolves with `value` after `ms`: raced against what may never come. */
// timer: deadline, bounds a wait for results that can be lost.
const giveUp = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));
const log = message => fetch(`/log?m=${encodeURIComponent(message)}`);

/** Forces style and layout on the DOM; Skia painted in present. */
let settle = () => {};

async function setup() {
  if (renderer === 'dom') {
    const container = document.getElementById('app');
    settle = () => void document.body.offsetHeight;
    return { host: $dom(document), container, skia: null, canvas: null };
  }
  const kit = await globalThis.CanvasKitInit({ locateFile: file => `/canvaskit/${file}` });
  const font = await (await fetch('/font.ttf')).arrayBuffer();
  await loadLayout('/taffy.wasm');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:800px;height:600px';
  document.body.appendChild(canvas);
  // aria: false keeps the readings comparable with those taken before the
  // accessibility mirror existed (bench/skia measures the mirror itself).
  const skia = $skia(kit, { font, canvas, width: 800, height: 600, aria: false });
  attach(skia, canvas);
  return { host: skia, container: skia.root, skia, canvas };
}

/** Direct: the application on this thread. */
function direct(env) {
  const root = $root('app');
  const app = Bench(root, { batch: config !== 'nobatch', work, yielding: params.get('yielding') ?? 'timeout', weight });
  if (pacing === 'rrx') rrxSweeper(root, report);
  const options = { root, retire: pacing === 'off' ? false : undefined, swept: report };
  if (env.skia) renderSkia(app.view, env.skia, options);
  else renderDom(app.view, env.container, options);
  return {
    op: async name => {
      const start = now();
      app.ops[name]();
      settle();
      const ms = now() - start;
      return { applied: ms, busy: ms };
    },
    // The handler ran synchronously inside the event dispatch; it shows in the next frame.
    typed: (stamp, done) => {
      settle();
      done(now() - stamp, null, false);
    },
    snapshot: () => null,
    counters: async () => ({ counters: {}, ticks: app.ticks(), spent: app.spent() }),
    idle: async () => {},
  };
}

/** Worker: the application in a Worker, applied here. */
function worker(env) {
  const qos = config !== 'plain';
  const waiters = [];
  const pending = [];
  let counters = null;
  const conn = connect(new Worker(`/dist/worker.js?config=${config}&work=${work}&yielding=${params.get('yielding') ?? 'timeout'}&pacing=${pacing}&weight=${weight}`, { type: 'module' }), env.host, env.container, {
    schedule: qos ? 'frame' : 'now',
    mailbox: config === 'mailbox' && globalThis.crossOriginIsolated === true,
    coalesce: qos,
    message: data => {
      if (data.counters) counters(data);
      else if (data.swept) report(data.swept);
    },
    applied: info => {
      if (waiters.length === 0 && pending.length === 0) return;
      let settled = -1;
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        if (p.want > info.acked) continue;
        if (settled < 0) {
          const start = now();
          settle();
          settled = now() - start;
          conn.totals.forward += settled;
        }
        p.done(now() - p.stamp, [info.urgent ? 1 : 0, round(conn.started - p.stamp), round(p.sent - p.stamp)], info.framed);
        pending.splice(i, 1);
      }
      // The timed operations publish in the urgent lane; a burst keeps a
      // deferred backlog (MORE) for as long as it runs.
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.seq > info.acked) continue;
        const start = now();
        settle();
        const layout = now() - start;
        waiters.splice(i, 1);
        w.resolve({ applied: now() - w.start, busy: conn.totals.busy - w.busy + layout + w.post });
      }
    },
  });
  return {
    conn,
    // Resolved by the message that applies the operation, or, for one that
    // changes nothing shown, once the worker is idle.
    op: name =>
      new Promise(resolve => {
        const start = now();
        const busy = conn.totals.busy;
        const seq = conn.post(name);
        const waiter = { seq, start, busy, post: now() - start, resolve };
        waiters.push(waiter);
        conn.idle().then(() => {
          const at = waiters.indexOf(waiter);
          if (at < 0) return;
          waiters.splice(at, 1);
          resolve({ applied: now() - start, busy: conn.totals.busy - busy + waiter.post });
        });
      }),
    typed: (stamp, done) => pending.push({ stamp, want: conn.seq, done, sent: now() }),
    snapshot: () => ({ ...conn.totals, busy: conn.totals.busy }),
    counters: () =>
      new Promise(resolve => {
        counters = resolve;
        conn.post('counters');
      }),
    idle: () => conn.idle(),
  };
}

/** Keystrokes through the driver (DevTools Input.dispatchKeyEvent), timed from the event timestamp. */
async function typing(env, app, count, background, during = null) {
  if (env.skia) {
    env.canvas.focus();
    env.skia.press(100, 60);
  } else document.querySelector('input').focus();
  await app.op('reset');
  if (background) {
    await app.op('burst');
    // Type into a running burst: wait for its first ticks, a frame at a time.
    let ticks = 0;
    for (let i = 0; i < 600 && ticks < BURST_TICKS; i++) {
      await nextFrame();
      ticks = (await app.counters()).ticks;
    }
    if (ticks < BURST_TICKS) throw new Error(`the burst ticked ${ticks} times in 600 frames`);
  }
  const before = app.snapshot();
  const workerBefore = await app.counters();
  const samples = [];
  /** @type {() => void} */
  let all = () => {};
  const complete = new Promise(resolve => (all = resolve));
  const stamps = [];
  const capture = e => {
    if (e.key === 'a') stamps.push(e.timeStamp);
  };
  const trace = [];
  const frames = [];
  // Keystroke to the frame that shows it: the current frame when the change
  // applied inside a frame callback, the next one otherwise.
  const done = (ms, detail, framed) => {
    samples.push(ms);
    if (samples.length === count) all();
    if (detail) trace.push(detail);
    const stamp = now() - ms;
    if (framed) frames.push(ms);
    else requestAnimationFrame(() => frames.push(now() - stamp)); // timer: feature, the frame that shows it ends the reading
  };
  // Frame intervals while typing.
  const intervals = [];
  let last = 0;
  let measuring = true;
  const frame = t => {
    if (last > 0) intervals.push(t - last);
    last = t;
    if (measuring) requestAnimationFrame(frame); // timer: feature, frame intervals are the reading
  };
  requestAnimationFrame(frame); // timer: feature, starts the frame-interval loop
  const finish = e => {
    if (env.skia ? e.type === 'keydown' && e.key === 'a' : e.type === 'input') {
      const stamp = stamps.shift();
      if (stamp !== undefined) app.typed(stamp, done);
    }
  };
  window.addEventListener('keydown', capture, true);
  window.addEventListener(env.skia ? 'keydown' : 'input', finish);
  const start = now();
  if (during !== null) during();
  await fetch(`/type?count=${count}&interval=${interval}`);
  // Lost keystrokes are counted, not waited for past 10 s.
  if (samples.length < count) await Promise.race([complete, giveUp(10000, null)]);
  const seconds = (now() - start) / 1000;
  measuring = false;
  window.removeEventListener('keydown', capture, true);
  window.removeEventListener(env.skia ? 'keydown' : 'input', finish);
  const after = app.snapshot();
  log(`typed ${samples.length}/${count}`);
  const workerAfter = await app.counters();
  log('counted');
  if (background) await app.op('calm');
  log('calm');
  // Nothing left to publish, the burst's backlog included.
  await app.idle();
  return { samples, frames, intervals, trace, lost: count - samples.length, seconds, before, after, workerBefore, workerAfter };
}

/**
 * Disposal under input: 10,000 rows, keystrokes, and a clear 150 ms into
 * them. Returns the typing record, the clear's own time (applied and
 * main-thread busy, as the operations) and the drain's report (null with
 * pacing off: nothing is left after the clear).
 */
async function disposal(env, app, count) {
  await app.op('lots');
  await app.idle();
  await nextFrame();
  drain = null;
  let clear = null;
  let clearAt = 0;
  const ended = pacing === 'off' ? Promise.resolve(null) : new Promise(resolve => (drained = resolve));
  const typed = await typing(env, app, count, false, () =>
    // timer: feature, the scenario clears 150 ms into the keystrokes.
    setTimeout(async () => {
      clearAt = now();
      clear = await app.op('clear');
    }, 150),
  );
  const d = await Promise.race([ended, giveUp(10000, 'timeout')]);
  drained = null;
  return { ...typed, clear, clearAt, drain: d === 'timeout' ? { error: 'no drain report' } : d };
}

async function main() {
  const env = await setup();
  const app = mode === 'direct' ? direct(env) : worker(env);
  if (mode === 'worker') await app.idle();
  if (scenario === 'dispose') {
    const phase = await disposal(env, app, keys);
    await fetch('/result', { method: 'POST', body: JSON.stringify({ renderer, mode, config, pacing, scenario, dispose: phase, agent: navigator.userAgent }) });
    return;
  }
  const names = ['create', 'update', 'swap', 'clear'];
  const ops = Object.fromEntries(names.map(name => [name, { applied: [], busy: [], totals: [], worker: [] }]));
  for (let round = 0; round < warmup + rounds; round++) {
    for (const name of names) {
      const before = app.snapshot();
      const workerBefore = mode === 'worker' ? await app.counters() : null;
      const result = await app.op(name);
      if (round < warmup) continue;
      const after = app.snapshot();
      const workerAfter = mode === 'worker' ? await app.counters() : null;
      ops[name].applied.push(result.applied);
      ops[name].busy.push(result.busy);
      if (before) ops[name].totals.push(diff(before, after));
      if (workerBefore) ops[name].worker.push(diff(workerBefore.counters, workerAfter.counters));
      await nextFrame();
    }
  }
  log('ops done');
  await app.op('create');
  const idle = await typing(env, app, keys, false);
  log('idle typing done');
  const burst = await typing(env, app, burstKeys, true);
  log('burst typing done');
  await fetch('/result', { method: 'POST', body: JSON.stringify({ renderer, mode, config, rounds, warmup, ops, idle, burst, agent: navigator.userAgent }) });
}

function round(x) {
  return Math.round(x * 10) / 10;
}

function diff(a, b) {
  const out = {};
  for (const key in b) if (typeof b[key] === 'number') out[key] = b[key] - (a[key] ?? 0);
  return out;
}

main().catch(error => fetch('/result', { method: 'POST', body: JSON.stringify({ error: String(error && error.stack || error) }) }));
