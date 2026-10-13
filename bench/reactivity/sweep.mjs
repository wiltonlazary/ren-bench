// Background disposal against eager $stop, for rrx-core alone:
//
//   node --expose-gc bench/reactivity/sweep.mjs [--sizes 10000,100000] [--budgets 2,4,8] [--repeat 5]
//
// Each (size, mode) runs in a fresh process state: build `size` row scopes
// under one list scope, each owning a memo, an effect and a cleanup (the
// shape of a keyed row), then tear them all down.
// - stop:   $stop every row; the caller is blocked for the whole teardown.
// - retire: $retire every row (the caller's cost), then $sweep(root, budget)
//           until done, timing each slice (the jitter a frame would see).
// - list-stop, list-retire: the same rows as a $keyed list's rows, cleared by
//           writing [] and flushing (the caller's cost), then, when retiring,
//           swept at a 4 ms budget: a list that keeps no row retires its one
//           row container instead of each row.
// Prints one JSON line per reading, medians over --repeat, with provenance
// first. The checksum is the number of cleanups run (it must equal size).
// With --expose-gc, a full collection runs before each timed teardown, so a
// collection of the freshly built rows is not charged to either mode.

import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';
import { $root, $signal, $memo, $effect, $read, $write, $flush, $scope, $enter, $stop, $cleanup, $owner, $retire, $sweep, $sweeper, $dispose, $keyed } from 'rrx-core';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const sizes = option('sizes', '10000,100000').split(',').map(Number);
const budgets = option('budgets', '2,4,8').split(',').map(Number);
const repeat = Number(option('repeat', 5));

console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core'], import.meta.url), load: loadavg().map(x => Math.round(x * 100) / 100), date: new Date().toISOString() } }));

/** @param {number} size */
function build(size) {
  const root = $root('sweep');
  $sweeper(root, null);
  const source = $signal(root, 0);
  const counter = { cleaned: 0, sum: 0 };
  const rows = [];
  for (let i = 0; i < size; i++) {
    const row = $scope(root, null);
    $enter(row, () => {
      const memo = $memo(root, () => $read(source) + i);
      $effect(root, () => {
        counter.sum += $read(memo);
      });
      $cleanup(row, () => {
        counter.cleaned++;
      });
    });
    rows.push(row);
  }
  return { root, rows, counter };
}

/** The same rows as a $keyed list's. @param {number} size @param {boolean} retire */
function list(size, retire) {
  const root = $root('sweep');
  $sweeper(root, null);
  const source = $signal(root, 0);
  const counter = { cleaned: 0, sum: 0 };
  const items = $signal(root, Array.from({ length: size }, (_, i) => i));
  const rows = $keyed(root, () => $read(items), null, item => {
    const i = $read(item);
    const memo = $memo(root, () => $read(source) + i);
    $effect(root, () => {
      counter.sum += $read(memo);
    });
    $cleanup(/** @type {any} */ ($owner(root)), () => {
      counter.cleaned++;
    });
  }, { retire });
  $effect(root, () => void $read(rows));
  return { root, items, counter };
}

/** Collects before a timed phase when the collector is exposed. */
const settle = () => (/** @type {any} */ (globalThis).gc ? /** @type {any} */ (globalThis).gc() : undefined);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs, p) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
};

// Warm the code paths once so both modes run optimized code.
for (let w = 0; w < 3; w++) {
  const a = build(20000);
  for (const row of a.rows) $stop(row);
  $dispose(a.root);
  const b = build(20000);
  for (const row of b.rows) $retire(row);
  while ($sweep(b.root, 4) > 0);
  $dispose(b.root);
}

for (let w = 0; w < 3; w++) {
  for (const retire of [false, true]) {
    const { root, items } = list(20000, retire);
    $write(items, []);
    $flush(root);
    while ($sweep(root, 4) > 0);
    $dispose(root);
  }
}

for (const size of sizes) {
  const stop = [];
  for (let r = 0; r < repeat; r++) {
    const { root, rows, counter } = build(size);
    settle();
    const t = performance.now();
    for (const row of rows) $stop(row);
    stop.push(performance.now() - t);
    if (counter.cleaned !== size) throw new Error('checksum: stop');
    $dispose(root);
  }
  console.log(JSON.stringify({ size, mode: 'stop', blockingMs: median(stop) }));
  for (const budget of budgets) {
    const retire = [], total = [], max = [], p99 = [], slices = [];
    for (let r = 0; r < repeat; r++) {
      const { root, rows, counter } = build(size);
      settle();
      let t = performance.now();
      for (const row of rows) $retire(row);
      retire.push(performance.now() - t);
      const times = [];
      let left = 1;
      while (left > 0) {
        t = performance.now();
        left = $sweep(root, budget);
        times.push(performance.now() - t);
      }
      if (counter.cleaned !== size) throw new Error('checksum: retire');
      total.push(times.reduce((a, b) => a + b, 0));
      max.push(Math.max(...times));
      p99.push(pct(times, 0.99));
      slices.push(times.length);
      $dispose(root);
    }
    const round = x => Math.round(x * 1000) / 1000;
    console.log(JSON.stringify({
      size, mode: 'retire', budgetMs: budget, blockingMs: round(median(retire)), sweepTotalMs: round(median(total)),
      sliceMaxMs: round(median(max)), sliceP99Ms: round(median(p99)), slices: median(slices),
    }));
  }
}
for (const size of sizes) {
  for (const retire of [false, true]) {
    const blocking = [], total = [], max = [];
    for (let r = 0; r < repeat; r++) {
      const { root, items, counter } = list(size, retire);
      settle();
      let t = performance.now();
      $write(items, []);
      $flush(root);
      blocking.push(performance.now() - t);
      const times = [];
      while (retire) {
        t = performance.now();
        const left = $sweep(root, 4);
        times.push(performance.now() - t);
        if (left === 0) break;
      }
      if (counter.cleaned !== size) throw new Error('checksum: list');
      total.push(times.reduce((a, b) => a + b, 0));
      max.push(times.length ? Math.max(...times) : 0);
      $dispose(root);
    }
    const round = x => Math.round(x * 1000) / 1000;
    console.log(JSON.stringify(retire
      ? { size, mode: 'list-retire', budgetMs: 4, blockingMs: round(median(blocking)), sweepTotalMs: round(median(total)), sliceMaxMs: round(median(max)) }
      : { size, mode: 'list-stop', blockingMs: round(median(blocking)) }));
  }
}
console.log(JSON.stringify({ load: loadavg().map(x => Math.round(x * 100) / 100) }));
