// One adapter per library over the same five primitives. Every adapter
// performs exactly one propagation per write: rrx-core writes, then flushes ($flush);
// libraries with synchronous effects write inside their own batch (Vue has
// no public batch, and a single write is already one propagation there);
// Solid 2 writes then flushes.
//
// api.signal(v) -> { get, set }   api.memo(fn) -> get   api.effect(fn)
// adapter.root(build) -> { result, dispose }
// api.scope(build) -> dispose      (an owned child scope)
// api.cleanup(fn)                  (runs when the current scope is disposed)
// api.task(read, start) -> get     (an async value: see task below)
// api.chain(read, steps, step) -> get  (an async value made of `steps` sequential
//                                   steps, `step(value, resolve)` each: see chain below)
// api.settle()                     (optional: finishes deferred disposal)

import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from '../../provenance.mjs';

// A comparison may select another rrx-core checkout; resolve its public exports.
export const rrxFrom = process.env.RRX_ROOT
  ? pathToFileURL(join(resolve(process.env.RRX_ROOT), 'package.json')).href
  : import.meta.url;
const rrxRequire = createRequire(rrxFrom);
const rrxModule = name => import(pathToFileURL(rrxRequire.resolve(name)).href);
const load = async name => import(name);

/**
 * The async value for libraries without a synchronous async primitive: an
 * effect tracks `read`, and each change launches `start(input, resolve)`
 * with a new generation; a resolve from an older generation is ignored (a
 * superseded completion). The value is a signal, so readers see the latest
 * accepted completion. `untrack` keeps `start` out of the tracking.
 * @param {any} api @param {(fn: () => void) => void} untrack
 */
const generic = (api, untrack) => (read, start) => {
  const value = api.signal(null);
  let generation = 0;
  api.effect(() => {
    const input = read();
    const ticket = ++generation;
    untrack(() => start(input, v => {
      if (ticket === generation) value.set(v);
    }));
  });
  return value.get;
};

/**
 * A chain of async steps the way an application writes it with promises: an
 * async function awaiting each step, over the library's task. Each await is
 * a promise and a microtask.
 * @param {any} api
 */
const promises = api => (read, steps, step) =>
  api.task(read, (input, resolve) => {
    (async () => {
      let value = input;
      for (let k = 0; k < steps; k++) value = await new Promise(ok => step(value, ok));
      resolve(value);
    })();
  });

/**
 * rrx-core over the records core or the arena. `retire` disposes scopes with
 * $retire and settles with a full $sweep; tasks use rrx-core $task where the module
 * has it (the arena has none and uses the generic task).
 * @param {any} g @param {boolean} retire
 */
const rrx = (g, retire) => {
  const { $root, $signal, $memo, $effect, $read, $write, $flush, $dispose, $scope, $enter, $stop, $cleanup, $owner, $untrack } = g;
  return {
    root(build) {
      const root = $root('bench');
      if (retire) g.$sweeper(root, null);
      const api = {
        signal(v) {
          const s = $signal(root, v);
          return { get: () => $read(s), set: x => { $write(s, x); $flush(root); } };
        },
        memo(fn) {
          const m = $memo(root, fn);
          return () => $read(m);
        },
        effect(fn) { $effect(root, fn); },
        scope(inner) {
          const owner = $scope(root, null);
          $enter(owner, () => inner(api));
          return retire ? () => g.$retire(owner) : () => $stop(owner);
        },
        cleanup(fn) { $cleanup($owner(root), fn); },
        task: g.$task
          ? (read, start) => {
            // rrx-core $task: completion writes the task state, then one $flush.
            const t = g.$task(root, read, (input, complete) => start(input, value => {
              complete({ ok: true, value });
              $flush(root);
            }));
            return () => g.$lastReady(t);
          }
          : null,
        settle() {
          if (retire) while (g.$sweep(root, Infinity) > 0);
        },
      };
      if (api.task === null) api.task = generic(api, fn => $untrack(root, fn));
      api.chain = promises(api);
      const result = build(api);
      return { result, dispose: () => $dispose(root) };
    },
  };
};

/** @type {Record<string, () => Promise<any>>} */
export const adapters = {
  async rrx() {
    return rrx(await rrxModule('rrx-core'), false);
  },


  // rrx-core disposing scopes with $retire, settled by a full $sweep (disposal only).
  async 'rrx-retire'() {
    return rrx(await rrxModule('rrx-core'), true);
  },

  // The column arena of arena.js: the same core over integer columns.
  async 'rrx-arena'() {
    return rrx(await rrxModule('rrx-core/arena'), false);
  },

  async 'alien-signals'() {
    const a = await load('alien-signals');
    const api = {
      signal(v) {
        const s = a.signal(v);
        return { get: () => s(), set: x => { a.startBatch(); s(x); a.endBatch(); } };
      },
      memo: fn => a.computed(fn),
      effect(fn) { a.effect(fn); },
      scope(inner) { return a.effectScope(() => inner(api)); },
      // An effect's returned function is alien-signals' cleanup.
      cleanup(fn) { a.effect(() => fn); },
      task: null,
    };
    api.task = generic(api, fn => {
      const previous = a.setActiveSub(undefined);
      try { fn(); } finally { a.setActiveSub(previous); }
    });
    api.chain = promises(api);
    return {
      root(build) {
        let result;
        const dispose = a.effectScope(() => { result = build(api); });
        return { result, dispose };
      },
    };
  },

  async '@preact/signals-core'() {
    const p = await load('@preact/signals-core');
    const make = stops => {
      const api = {
        signal(v) {
          const s = p.signal(v);
          return { get: () => s.value, set: x => p.batch(() => { s.value = x; }) };
        },
        memo(fn) {
          const c = p.computed(fn);
          return () => c.value;
        },
        effect(fn) { stops.push(p.effect(fn)); },
        scope(inner) {
          const own = [];
          inner(make(own));
          return () => { for (let i = own.length - 1; i >= 0; i--) own[i](); };
        },
        // Preact has no owner: a scope is the list of its disposers.
        cleanup(fn) { stops.push(fn); },
        task: null,
      };
      api.task = generic(api, fn => p.untracked(fn));
      api.chain = promises(api);
      return api;
    };
    return {
      root(build) {
        const stops = [];
        const result = build(make(stops));
        return { result, dispose: () => { for (let i = stops.length - 1; i >= 0; i--) stops[i](); } };
      },
    };
  },

  async '@vue/reactivity'() {
    const v = await load('@vue/reactivity');
    const api = {
      signal(x) {
        const s = v.shallowRef(x);
        return { get: () => s.value, set: y => { s.value = y; } };
      },
      memo(fn) {
        const c = v.computed(fn);
        return () => c.value;
      },
      effect(fn) { v.effect(fn); },
      scope(inner) {
        const scope = v.effectScope();
        scope.run(() => inner(api));
        return () => scope.stop();
      },
      cleanup(fn) { v.onScopeDispose(fn); },
      task: null,
    };
    api.task = generic(api, fn => {
      v.pauseTracking();
      try { fn(); } finally { v.resetTracking(); }
    });
    api.chain = promises(api);
    return {
      root(build) {
        const scope = v.effectScope();
        let result;
        scope.run(() => { result = build(api); });
        return { result, dispose: () => scope.stop() };
      },
    };
  },

  async 'solid-js'() {
    const s = await load('solid-js/dist/solid.js');
    const api = {
      signal(x) {
        const [get, set] = s.createSignal(x);
        return { get, set: y => s.batch(() => set(y)) };
      },
      memo: fn => s.createMemo(fn),
      effect(fn) { s.createComputed(fn); },
      scope(inner) {
        let dispose;
        s.createRoot(d => { dispose = d; inner(api); });
        return dispose;
      },
      cleanup(fn) { s.onCleanup(fn); },
      task: null,
    };
    api.task = generic(api, fn => s.untrack(fn));
    api.chain = promises(api);
    return {
      root(build) {
        let result, dispose;
        s.createRoot(d => { dispose = d; result = build(api); });
        return { result, dispose };
      },
    };
  },

  async '@solidjs/signals'() {
    const s = await load('@solidjs/signals');
    const api = {
      signal(x) {
        const [get, set] = s.createSignal(x);
        return { get, set: y => { set(y); s.flush(); } };
      },
      memo: fn => s.createMemo(fn),
      effect(fn) { s.createTrackedEffect(() => { fn(); }); },
      scope(inner) {
        let dispose;
        s.createRoot(d => { dispose = d; inner(api); });
        s.flush();
        return dispose;
      },
      cleanup(fn) { s.onCleanup(fn); },
      // Solid 2 async memos settle on promises (microtasks); the generic
      // task keeps the completion synchronous, as for every other library.
      task: null,
    };
    api.task = generic(api, fn => s.untrack(fn));
    api.chain = promises(api);
    return {
      root(build) {
        let result, dispose;
        s.createRoot(d => { dispose = d; result = build(api); });
        s.flush();
        return { result, dispose };
      },
    };
  },
};

/** Libraries that run only some scenarios: rrx-retire differs from rrx-core only in disposal. */
export const limits = { 'rrx-retire': ['disposal'] };

/** The installed version of a library. */
export async function version(name) {
  const { readFile } = await import('node:fs/promises');
  const file = name.startsWith('rrx') ? pathToFileURL(join(packageRoot('rrx-core', rrxFrom), 'package.json')) : new URL(`./node_modules/${name}/package.json`, import.meta.url);
  return JSON.parse(await readFile(file, 'utf8')).version;
}
