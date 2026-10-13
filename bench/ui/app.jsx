// The benchmark application: one definition of the components and the
// operations, run unchanged direct on the main thread and in the worker. Only
// ren-core primitives are used, so the same tree renders on the DOM and on Skia.
//
// Operations (js-framework-benchmark style): create 1,000 rows (or 10,000:
// lots), update every 10th row, swap rows 1 and 998, clear; an Edit whose keystrokes update a
// Label; and a background burst that rewrites every row label inside rrx-core's
// `$defer` on a timer until stopped.

import { $signal, $read, $write, $batch, $defer, $sweep, $sweeper, $memo, $effect, $cleanup, $owner } from 'rrx-core';
import { View, Layout, Label, Edit, Action, For } from 'ren-core';

const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant'];
const NOUNS = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse'];

/**
 * rrx-core's macrotask fallback drain (4 ms setTimeout slices), reproduced so the
 * page learns when it ends and how long its slices were: the `rrx-core` pacing.
 * @param {import('rrx-core').Graph} root @param {(drain: { slices: number, longest: number, busy: number, time: number, late: number }) => void} report
 */
export function rrxSweeper(root, report) {
  $sweeper(root, R => {
    const start = performance.now();
    let slices = 0;
    let longest = 0;
    let busy = 0;
    const tick = () => {
      const t = performance.now();
      const left = $sweep(R, 4);
      const d = performance.now() - t;
      slices++;
      busy += d;
      if (d > longest) longest = d;
      if (left > 0) setTimeout(tick, 0); // timer: fallback, rrx-core's own drain reproduced
      else report({ slices, longest, busy, time: performance.now() - start, late: 0 });
    };
    setTimeout(tick, 0); // timer: fallback, rrx-core's own drain reproduced
  });
}

/**
 * The state and operations of one application instance.
 * @param {import('rrx-core').Graph} root
 * @param {{ batch?: boolean, work?: number, yielding?: 'timeout' | 'message' | 'background', weight?: number }} [options] batch: run each operation in one rrx-core `$batch` (one flush); off, every
 *   write flushes. work: iterations of application computation per burst tick (counted, not timed, so every mode does the same).
 *   weight: per row, that many memos over the label, each read by an effect with a cleanup (what real components carry; disposal cost).
 */
export function Bench(root, options = {}) {
  const batch = options.batch !== false;
  const work = options.work ?? 0;
  const weight = options.weight ?? 0;
  let sink = 0;
  /** A row's component state: weight × (memo, effect, cleanup). @param {() => { label: any }} row */
  const load = row => {
    const owner = $owner(root);
    for (let i = 0; i < weight; i++) {
      const m = $memo(root, () => $read(row().label).length + i);
      $effect(root, () => void (sink += $read(m)));
      $cleanup(owner, () => void (sink -= i));
    }
  };
  // How the burst yields between ticks: a timer (the default), a message to
  // itself, or the platform scheduler's background priority. Measured in
  // Chrome 153 with long ticks, both alternatives gave the worker's input a
  // longer wait than the timer (p50 about 100 ms against 51).
  const channel = options.yielding === 'message' ? new MessageChannel() : null;
  // background: the platform scheduler's background priority, after input and rendering.
  const later =
    options.yielding === 'background' && globalThis.scheduler?.postTask
      ? fn => globalThis.scheduler.postTask(fn, { priority: 'background' })
      : channel === null
        ? fn => setTimeout(fn, 0) // timer: feature, the burst's measured yielding
        : fn => channel.port2.postMessage(0);
  if (channel !== null) channel.port1.onmessage = () => tick();
  const rows = $signal(root, /** @type {{ id: number, label: any }[]} */ ([]));
  const text = $signal(root, '');
  let next = 0;
  let seed = 1;
  const pick = list => list[(seed = (seed * 1103515245 + 12345) & 0x7fffffff) % list.length];
  /** @param {() => void} fn */
  const run = fn => (batch ? $batch(root, fn) : fn());
  let ticking = false;
  let ticks = 0;
  let spent = 0;
  const tick = () => {
    if (!ticking) return;
    const start = performance.now();
    ticks++;
    const list = $read(rows);
    // The application's own computation of the new labels.
    let hash = ticks;
    for (let i = 0; i < work; i++) hash = (Math.imul(hash, 1103515245) + 12345) | 0;
    const tag = (hash >>> 0) % 1000;
    run(() => $defer(root, () => {
      for (let i = 0; i < list.length; i++) $write(list[i].label, `${list[i].id} tick ${ticks} ${tag}`);
    }));
    spent += performance.now() - start;
    later(tick);
  };
  const make = count => {
    const list = new Array(count);
    for (let i = 0; i < count; i++) {
      const id = ++next;
      list[i] = { id, label: $signal(root, `${pick(ADJECTIVES)} ${pick(NOUNS)} ${id}`) };
    }
    run(() => $write(rows, list));
  };
  const ops = {
    lots: () => make(10000),
    create: () => {
      const list = new Array(1000);
      for (let i = 0; i < 1000; i++) {
        const id = ++next;
        list[i] = { id, label: $signal(root, `${pick(ADJECTIVES)} ${pick(NOUNS)} ${id}`) };
      }
      run(() => $write(rows, list));
    },
    update: () => {
      const list = $read(rows);
      run(() => {
        for (let i = 0; i < list.length; i += 10) $write(list[i].label, `${$read(list[i].label)} !!!`);
      });
    },
    swap: () => {
      const list = $read(rows).slice();
      if (list.length < 999) return;
      const a = list[1];
      list[1] = list[998];
      list[998] = a;
      run(() => $write(rows, list));
    },
    clear: () => run(() => $write(rows, [])),
    burst: () => {
      if (ticking) return;
      ticking = true;
      ticks = 0;
      tick();
    },
    calm: () => {
      ticking = false;
    },
    reset: () => run(() => $write(text, '')),
  };
  const remove = id => run(() => $write(rows, $read(rows).filter(row => row.id !== id)));
  const view = () => (
    <View gap={4}>
      <Edit label="Type" value={text} onChange={e => $write(text, e.value)} />
      <Label text={() => `typed ${$read(text).length}: ${$read(text).slice(-24)}`} />
      <For each={rows} by={row => row.id}>
        {row => (
          weight > 0 && load(row),
          <Layout layout="row" gap={8}>
            <Label text={String(row().id)} width={60} />
            <Label text={row().label} />
            <Action text="x" onPress={() => remove(row().id)} />
          </Layout>
        )}
      </For>
    </View>
  );
  return { rows, text, ops, view, ticks: () => ticks, spent: () => spent };
}
