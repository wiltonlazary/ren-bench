// The JavaScript cost of disposing list rows in ren-core, without a DOM: the
// market table's row (a keyed For of <tr> rows with a class binding over an
// rrx-core $select, a label text signal and two delegated handlers) rendered
// through a host that keeps only a handle tree. For each row count, a clear
// is timed with rows stopped at once (retire: false) and with rows retired
// (retire: 1), in ABBA order:
//
//   node --expose-gc bench/ui/dispose.mjs [--pairs 10] [--sizes 100,300,1000,3000,10000] [--budget 4]
//
// blocking  the clear's own time ($write → the flush returned): $stop of every
//           row, or one $retire of their container.
// drain     retire only: the time $sweep then takes to free everything, in
//           slices of --budget ms, and the longest slice.
// The host call that removes the rows (one `clear`) costs the same in both.

import { $root, $signal, $read, $write, $select, $sweep, $sweeper } from 'rrx-core';
import { jsx, For } from 'ren-core';
import { mount } from 'ren-core/host';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const pairs = Number(option('pairs', 10));
const sizes = option('sizes', '100,300,1000,3000,10000').split(',').map(Number);
const budget = Number(option('budget', 4));
const now = () => performance.now();
const gc = /** @type {any} */ (globalThis).gc ?? (() => {});

/** A handle: a node of the tree the host keeps. */
class Handle {
  constructor() {
    this.parent = null;
    this.first = null;
    this.last = null;
    this.prev = null;
    this.next = null;
    this.handlers = null;
  }
}

/** A host that keeps the tree and nothing else (delegated handlers stay on their node). */
const host = {
  element: () => new Handle(),
  text: () => new Handle(),
  marker: () => new Handle(),
  content() {},
  set() {},
  listen: () => () => {},
  delegate(node, name, handler) {
    node.handlers = handler;
    return true;
  },
  insert(parent, child, before) {
    if (child.parent !== null) unlink(child);
    child.parent = parent;
    if (before === null) {
      child.prev = parent.last;
      child.next = null;
      if (parent.last === null) parent.first = child;
      else parent.last.next = child;
      parent.last = child;
    } else {
      child.prev = before.prev;
      child.next = before;
      if (before.prev === null) parent.first = child;
      else before.prev.next = child;
      before.prev = child;
    }
  },
  remove(parent, child) {
    if (child.parent === parent) unlink(child);
  },
  clear(parent, first, last) {
    if (parent.first === first && parent.last === last) {
      for (let n = first; n !== null; n = n.next) n.parent = null;
      parent.first = parent.last = null;
      return;
    }
    for (let n = first; ; ) {
      const after = n.next;
      unlink(n);
      if (n === last) break;
      n = after;
    }
  },
  parent: node => node.parent,
  next: node => node.next,
  owns: value => value instanceof Handle,
  layer: () => new Handle(),
};

/** @param {Handle} child */
function unlink(child) {
  const parent = child.parent;
  if (child.prev === null) parent.first = child.next;
  else child.prev.next = child.next;
  if (child.next === null) parent.last = child.prev;
  else child.next.prev = child.prev;
  child.parent = child.prev = child.next = null;
}

let ids = 1;
/** Mounts the table with `retire`, fills `n` rows; returns the clear. */
function table(n, retire) {
  const root = $root('bench');
  $sweeper(root, null);
  const rows = $signal(root, []);
  const selected = $signal(root, 0);
  const isSelected = $select(root, () => $read(selected));
  const view = () =>
    jsx('table', {
      children: jsx('tbody', {
        children: jsx(For, {
          each: rows,
          by: row => row.id,
          children: row => {
            const { id, label } = row();
            return jsx('tr', {
              class: () => (isSelected(id) ? 'danger' : ''),
              children: [
                jsx('td', { class: 'col-md-1', children: String(id) }),
                jsx('td', { class: 'col-md-4', children: jsx('a', { onClick: () => $write(selected, id), children: label }) }),
                jsx('td', { class: 'col-md-1', children: jsx('a', { onClick: () => {}, children: jsx('span', { class: 'glyphicon glyphicon-remove' }) }) }),
                jsx('td', { class: 'col-md-6' }),
              ],
            });
          },
        }),
      }),
    });
  const dispose = mount(host, view, new Handle(), { root, retire, sweep: false });
  const data = new Array(n);
  for (let i = 0; i < n; i++) data[i] = { id: ids++, label: $signal(root, `row ${i}`) };
  $write(rows, data);
  return { root, clear: () => $write(rows, []), dispose };
}

/** One sample: blocking, drain total and longest slice (0 for stop). @param {number} n @param {boolean} retiring */
function sample(n, retiring) {
  const t = table(n, retiring ? 1 : false);
  gc();
  const t0 = now();
  t.clear();
  const blocking = now() - t0;
  let drain = 0;
  let longest = 0;
  let slices = 0;
  for (let left = 1; left > 0; ) {
    const s = now();
    left = $sweep(t.root, budget);
    const d = now() - s;
    drain += d;
    slices++;
    if (d > longest) longest = d;
  }
  t.dispose();
  return { blocking, drain, longest, slices };
}

const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const r = x => Math.round(x * 1000) / 1000;

console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core', 'ren-core'], import.meta.url) }, pairs, sizes, budget, gc: typeof globalThis.gc === 'function' }));
console.log('| rows | stop blocking | retire blocking | saved | faster pairs | drain total | longest slice | slices |');
console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const n of sizes) {
  for (let w = 0; w < 3; w++) {
    sample(n, false);
    sample(n, true);
  }
  const stop = [];
  const retire = [];
  let wins = 0;
  for (let p = 0; p < pairs; p++) {
    // ABBA: stop, retire, retire, stop.
    const order = p % 2 === 0 ? [false, true] : [true, false];
    const got = {};
    for (const retiring of order) got[retiring] = sample(n, retiring);
    stop.push(got[false]);
    retire.push(got[true]);
    if (got[true].blocking < got[false].blocking) wins++;
  }
  const sb = median(stop.map(x => x.blocking));
  const rb = median(retire.map(x => x.blocking));
  console.log(`| ${n} | ${r(sb)} | ${r(rb)} | ${r(sb - rb)} | ${wins}/${pairs} | ${r(median(retire.map(x => x.drain)))} | ${r(Math.max(...retire.map(x => x.longest)))} | ${median(retire.map(x => x.slices))} |`);
}
