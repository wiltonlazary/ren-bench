// The cost of the worker boundary itself, in node, on the Bench operations:
//
//   node --import ren-core/loader bench/ui/boundary.mjs [--rounds 30] [--warmup 10]
//
// mirror  ren-core and rrx-core against a host that only keeps the handle tree (the
//         worker's work without recording): the baseline.
// record  the same against the recording Remote host, its messages taken by
//         a port that returns the buffers at once (encode, no clone).
// decode  the main-thread applier decoding those messages into a host whose
//         calls do nothing (decode and dispatch only).
// clone   structuredClone of each message with its buffers transferred (the
//         serialization part of postMessage, without a thread hop).
// The page benchmark (run.mjs) measures the real postMessage and read times.

import { $root } from 'rrx-core';
import { Handle, Remote } from 'ren-core/worker';
import { mount } from 'ren-core/host';
import { Connection } from 'ren-core/remote';
import { Bench } from './app.jsx';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const rounds = option('rounds', 30);
const warmup = option('warmup', 10);
const now = () => performance.now();

/** The handle tree alone. */
class Mirror {
  constructor() {
    this.ids = 2;
    this.portal = new Handle(1, 0);
  }
  element(tag) {
    return new Handle(this.ids++, tag === 'Edit' ? 1 : 0);
  }
  text() {
    return new Handle(this.ids++, 0);
  }
  marker() {
    return new Handle(this.ids++, 0);
  }
  content() {}
  set() {}
  listen() {
    return () => {};
  }
  insert(parent, child, before) {
    if ((parent.flags & 1) !== 0 || child === before) return;
    if (child.parent !== null) unlink(child);
    if (before !== null && before.parent !== parent) before = null;
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
  }
  remove(parent, child) {
    if (child.parent === parent) unlink(child);
  }
  parent(node) {
    return node.parent;
  }
  next(node) {
    return node.next;
  }
  owns(value) {
    return value instanceof Handle;
  }
  layer() {
    return this.portal;
  }
  present() {}
}

function unlink(child) {
  const parent = child.parent;
  if (child.prev === null) parent.first = child.next;
  else child.prev.next = child.next;
  if (child.next === null) parent.last = child.prev;
  else child.next.prev = child.prev;
  child.parent = child.prev = child.next = null;
}

/** A main-thread host whose calls do nothing. */
const inert = {
  element: () => ({}),
  text: () => ({}),
  content() {},
  set() {},
  listen: () => () => {},
  insert() {},
  remove() {},
  marker: () => ({}),
  parent: () => null,
  next: () => null,
  owns: () => true,
  layer: () => ({}),
};

const ops = ['create', 'update', 'swap', 'clear'];
const times = kind => Object.fromEntries(ops.map(op => [op, []]));

// mirror
const mirror = times();
{
  const root = $root('bench');
  const app = Bench(root);
  mount(new Mirror(), app.view, new Handle(0, 0), { root });
  for (let r = 0; r < warmup + rounds; r++)
    for (const op of ops) {
      const start = now();
      app.ops[op]();
      const ms = now() - start;
      if (r >= warmup) mirror[op].push(ms);
    }
}

// record: the recording host, its buffers returned at once, nothing copied.
const record = times();
{
  const root = $root('bench');
  const app = Bench(root);
  let remote = null;
  const port = {
    postMessage(message) {
      if (message[0] !== 1) return;
      const ops = message[1];
      const nums = message[3];
      const number = new Int32Array(ops)[3];
      queueMicrotask(() => remote.receive([2, ops, nums, 0, 0, 0, number, false]));
    },
    addEventListener() {},
  };
  remote = new Remote(root, port, { backpressure: false });
  mount(remote, app.view, remote.container, { root });
  for (let r = 0; r < warmup + rounds; r++)
    for (const op of ops) {
      const start = now();
      app.ops[op]();
      const ms = now() - start;
      await null;
      if (r >= warmup) record[op].push(ms);
    }
}

// decode and clone: the messages of a third run, captured, then decoded into
// an inert host and cloned with their buffers transferred.
const decode = times();
const clone = times();
const sizes = Object.fromEntries(ops.map(op => [op, { records: 0, bytes: 0, messages: 0 }]));
{
  const root = $root('bench');
  const app = Bench(root);
  /** @type {any[]} */
  const captured = [];
  let remote = null;
  const port = {
    postMessage(message) {
      if (message[0] !== 1) return;
      captured.push([message[0], message[1].slice(0, message[2] * 4), message[2], message[3] && message[3].slice(0, message[4] * 8), message[4], message[5] && message[5].slice(), message[6] && message[6].slice(), message[7] && message[7].slice()]);
      const ops = message[1];
      const nums = message[3];
      const number = new Int32Array(ops)[3];
      queueMicrotask(() => remote.receive([2, ops, nums, 0, 0, 0, number, false]));
    },
    addEventListener() {},
  };
  remote = new Remote(root, port, { backpressure: false });
  mount(remote, app.view, remote.container, { root });
  const sink = { postMessage() {}, addEventListener() {} };
  const main = new Connection(sink, inert, {}, { schedule: 'now' });
  const take = () => {
    const messages = captured.splice(0);
    for (const m of messages) main.receive(m);
    return messages.length;
  };
  take();
  for (let r = 0; r < warmup + rounds; r++)
    for (const op of ops) {
      app.ops[op]();
      await null;
      const messages = captured.splice(0);
      const clones = messages.map(m => [m[0], m[1].slice(0), m[2], m[3] && m[3].slice(0), m[4], m[5], m[6], m[7]]);
      const t0 = now();
      for (const m of clones) structuredClone(m, { transfer: m[3] ? [m[1], m[3]] : [m[1]] });
      const cloned = now() - t0;
      const before = main.totals.apply;
      const records = main.totals.records;
      const bytes = main.totals.bytes;
      for (const m of messages) main.receive(m);
      if (r < warmup) continue;
      decode[op].push(main.totals.apply - before);
      clone[op].push(cloned);
      sizes[op].records = main.totals.records - records;
      sizes[op].bytes = main.totals.bytes - bytes;
      sizes[op].messages = messages.length;
    }
}

const median = list => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
const r3 = x => Math.round(x * 1000) / 1000;
console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core', 'ren-core'], import.meta.url), rounds, warmup, date: new Date().toISOString() } }));
console.log('| op | records | bytes | mirror ms | record ms | encode ms (record − mirror) | encode ns/record | decode ms | decode ns/record | clone ms |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const op of ops) {
  const s = sizes[op];
  const m = median(mirror[op]);
  const e = median(record[op]);
  const d = median(decode[op]);
  const c = median(clone[op]);
  console.log(`| ${op} | ${s.records} | ${s.bytes} | ${r3(m)} | ${r3(e)} | ${r3(e - m)} | ${s.records ? Math.round(((e - m) * 1e6) / s.records) : '–'} | ${r3(d)} | ${s.records ? Math.round((d * 1e6) / s.records) : '–'} | ${r3(c)} |`);
}
