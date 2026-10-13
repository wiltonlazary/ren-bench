// A/B of ren-core's own row cost, in one node process, without a DOM: the
// market table's row (compiled by ren-core/esbuild, or through the automatic
// runtime) is created, updated and cleared through a host that keeps only a
// handle tree, by the linked ren-core package (A) and another ren-core checkout
// (B, --base), interleaved ABBA:
//
//   git worktree add ../base <commit>   # in ren-core, a separate package checkout
//   node --expose-gc bench/ui/rows.mjs --base ../base [--pairs 20] [--rows 1000] [--mode compiled|runtime]
//
// Each sample mounts a fresh table and times: create (Write of `rows` items
// until the flush returns), update (every 10th label), clear (rows stopped:
// retire false). Both sides share one rrx-core (this checkout's), so the reading
// is ren-core's own code. It prints the medians and how many pairs A won.

import { transformSync } from 'esbuild';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { $root, $signal, $read, $write, $select } from 'rrx-core';
import { provenance, sources, packageRoot } from '../../provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const pairs = Number(option('pairs', 20));
const count = Number(option('rows', 1000));
const mode = option('mode', 'compiled');
const base = option('base', null);
if (base === null) throw new Error('--base <checkout> is required (a ren-core package checkout)');
const gc = /** @type {any} */ (globalThis).gc ?? (() => {});
const now = () => performance.now();

/** A handle: a node of the host's tree. */
class Handle {
  constructor() {
    this.parent = null;
    this.first = null;
    this.last = null;
    this.prev = null;
    this.next = null;
    this.data = null;
  }
}
/** @param {Handle} child */
function unlink(child) {
  const parent = child.parent;
  if (child.prev === null) parent.first = child.next;
  else child.prev.next = child.next;
  if (child.next === null) parent.last = child.prev;
  else child.next.prev = child.prev;
  child.parent = child.prev = child.next = null;
}
/** A deep copy of a handle tree (cloneNode). @param {Handle} node */
function copy(node) {
  const out = new Handle();
  out.data = node.data;
  for (let c = node.first; c !== null; c = c.next) {
    const k = copy(c);
    k.parent = out;
    k.prev = out.last;
    if (out.last === null) out.first = k;
    else out.last.next = k;
    out.last = k;
  }
  return out;
}

/** The tree-only host; clone copies a template per plan and walks the plan's path, as the DOM host does. @param {(H: any, plan: any) => any[]} skeleton */
const host = skeleton => ({
  clone(plan) {
    let template = plan.template;
    if (template === undefined) template = plan.template = skeleton(this, plan)[0];
    const root = copy(template);
    const refs = plan.refs;
    const out = new Array(refs.length);
    out[0] = root;
    const path = plan.path;
    for (let r = 1, i = 0; r < refs.length; r++, i += 4) {
      let node = out[path[i]];
      if (path[i + 1] === 1) node = node.first;
      for (let k = path[i + 2]; k > 0; k--) node = node.next;
      out[r] = node;
    }
    return out;
  },
  element: () => new Handle(),
  text: () => new Handle(),
  marker: () => new Handle(),
  content(node, text) {
    node.data = text;
  },
  set() {},
  listen: () => () => {},
  delegate(node, name, handler) {
    node.data = handler;
    return true;
  },
  fill(element, text, keep) {
    const t = new Handle();
    t.data = text;
    this.insert(element, t, null);
    return keep ? t : null;
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
});

const VIEW = `(rows, isSelected, select, remove) =>
  <table><tbody>
    <For each={rows} by={row => row.id}>
      {row => {
        const { id, label } = row();
        return (
          <tr class={() => (isSelected(id) ? 'danger' : '')}>
            <td class="col-md-1">{String(id)}</td>
            <td class="col-md-4"><a onClick={() => select(id)}>{label}</a></td>
            <td class="col-md-1"><a onClick={() => remove(id)}><span class="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
            <td class="col-md-6" />
          </tr>
        );
      }}
    </For>
  </tbody></table>`;

/** Loads one side: its ren-core and the view compiled by its own compiler. @param {string} dir */
async function side(dir) {
  const require = createRequire(join(dir, 'package.json'));
  const entry = name => import(pathToFileURL(require.resolve(name)).href);
  const ren = await entry('ren-core');
  const { skeleton, mount } = await entry('ren-core/host');
  const runtime = await entry('ren-core/jsx-runtime');
  let factory;
  if (mode === 'compiled') {
    const { transform } = await entry('ren-core/esbuild');
    const classic = transformSync(`export default ${VIEW};`, { loader: 'jsx', jsx: 'transform', jsxFactory: '__ren_h', jsxFragment: '__ren_F' }).code;
    const code = transform(classic).replace(/^import .*\n/, '').replace('export default', 'return');
    factory = new Function('__ren_h', '__ren_F', '__ren_t', '__ren_p', 'For', code)(runtime.h, runtime.Fragment, runtime.template, runtime.plan, ren.For);
  } else {
    const code = transformSync(`export default ${VIEW};`, { loader: 'jsx', jsx: 'automatic', jsxImportSource: 'ren-core' }).code;
    factory = new Function('jsx', 'jsxs', 'For', code.replace(/^import .*\n/gm, '').replace('export default', 'return'))(runtime.jsx, runtime.jsxs, ren.For);
  }
  return { ren, factory, skeleton, mount };
}

let ids = 1;
/** One sample of a side: create, update, clear times. */
function sample(s) {
  const root = $root('bench');
  const rows = $signal(root, []);
  const selected = $signal(root, 0);
  const isSelected = $select(root, () => $read(selected));
  const view = s.factory(rows, isSelected, id => $write(selected, id), () => {});
  const dispose = s.mount(host(s.skeleton), () => view, new Handle(), { root, retire: false, sweep: false });
  const data = new Array(count);
  for (let i = 0; i < count; i++) data[i] = { id: ids++, label: $signal(root, `row ${i}`) };
  gc();
  let t = now();
  $write(rows, data);
  const create = now() - t;
  t = now();
  for (let i = 0; i < count; i += 10) $write(data[i].label, `row ${i} !!!`);
  const update = now() - t;
  t = now();
  $write(rows, []);
  const clear = now() - t;
  dispose();
  return { create, update, clear };
}

const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const r = x => Math.round(x * 1000) / 1000;

const A = await side(packageRoot('ren-core', import.meta.url));
const B = await side(resolvePath(base));
for (let w = 0; w < 10; w++) {
  sample(A);
  sample(B);
}
const got = { A: [], B: [] };
for (let p = 0; p < pairs; p++) {
  const order = p % 2 === 0 ? ['A', 'B', 'B', 'A'] : ['B', 'A', 'A', 'B'];
  for (const k of order) got[k].push(sample(k === 'A' ? A : B));
}
console.log(JSON.stringify({ provenance: { ...provenance(resolvePath(here, '../..')), sources: sources(['rrx-core', 'ren-core'], import.meta.url), control: { path: resolvePath(base), ...provenance(resolvePath(base)) } }, mode, rows: count, pairs, base, gc: typeof globalThis.gc === 'function' }));
console.log('| op | A (linked ren-core) | B (base) | A/B | A faster |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const op of ['create', 'update', 'clear']) {
  const a = got.A.map(x => x[op]);
  const b = got.B.map(x => x[op]);
  let wins = 0;
  for (let i = 0; i < a.length; i += 2) if (a[i] + a[i + 1] < b[i] + b[i + 1]) wins++;
  console.log(`| ${op} | ${r(median(a))} | ${r(median(b))} | ${r(median(a) / median(b))} | ${wins}/${a.length / 2} |`);
}
