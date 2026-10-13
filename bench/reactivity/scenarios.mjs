// The scenario graphs of the reactivity benchmark, written once over the
// adapter primitives (adapters.mjs). Parameters come from the JSON; nothing
// here is specific to a library.
//
// The definition is bench/reactivity/scenarios.json. RRX_SCENARIOS=<path> reads another
// file in the same format instead:
//   RRX_SCENARIOS=<path>/scenarios.json node bench/reactivity/run.mjs
// Child processes inherit the variable.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the definition was read from (recorded in the provenance line). */
export const source = process.env.RRX_SCENARIOS ? pathToFileURL(resolve(process.env.RRX_SCENARIOS)).href : new URL('./scenarios.json', import.meta.url).href;
export const definition = JSON.parse(readFileSync(new URL(source), 'utf8'));

const observe = (api, read) => {
  const state = { sum: 0, runs: 0 };
  api.effect(() => {
    state.sum += read();
    state.runs++;
  });
  return state;
};

const update = (set, count) => {
  for (let v = 1; v <= count; v++) set(v);
};

/** Each scenario takes (adapter, parameters) and returns { sum, runs }. */
export const scenarios = {
  deep(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      let last = source.get;
      for (let i = 0; i < p.width; i++) {
        const previous = last;
        last = api.memo(() => previous() + 1);
      }
      const tail = last;
      return { source, state: observe(api, () => tail()) };
    });
    update(result.source.set, p.updates);
    dispose();
    return result.state;
  },
  broad(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const states = [];
      for (let i = 0; i < p.width; i++) {
        const index = i;
        const derived = api.memo(() => source.get() + index);
        states.push(observe(api, () => derived()));
      }
      return { source, states };
    });
    update(result.source.set, p.updates);
    dispose();
    let sum = 0, runs = 0;
    for (const s of result.states) { sum += s.sum; runs += s.runs; }
    return { sum, runs };
  },
  diamond(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const sides = [];
      for (let i = 0; i < p.width; i++) sides.push(api.memo(() => source.get() + 1));
      const joined = api.memo(() => {
        let total = 0;
        for (let i = 0; i < sides.length; i++) total += sides[i]();
        return total;
      });
      return { source, state: observe(api, () => joined()) };
    });
    update(result.source.set, p.updates);
    dispose();
    return result.state;
  },
  avoidable(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const flat = api.memo(() => {
        source.get();
        return 0;
      });
      let last = flat;
      for (let i = 0; i < p.chain; i++) {
        const previous = last;
        last = api.memo(() => previous() + 1);
      }
      const tail = last;
      return { source, state: observe(api, () => tail()) };
    });
    update(result.source.set, p.updates);
    dispose();
    return result.state;
  },
  repeated(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const derived = api.memo(() => {
        let total = 0;
        for (let i = 0; i < p.reads; i++) total += source.get();
        return total;
      });
      return { source, state: observe(api, () => derived()) };
    });
    update(result.source.set, p.updates);
    dispose();
    return result.state;
  },
  unstable(adapter, p) {
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const odd = api.signal(p.odd);
      const even = api.signal(p.even);
      const derived = api.memo(() => (source.get() % 2 === 0 ? even.get() : odd.get()) + source.get());
      return { source, state: observe(api, () => derived()) };
    });
    update(result.source.set, p.updates);
    dispose();
    return result.state;
  },
  churn(adapter, p) {
    const state = { sum: 0, runs: 0 };
    const { result, dispose } = adapter.root(api => ({ api, source: api.signal(0) }));
    const { api, source } = result;
    for (let round = 0; round < p.rounds; round++) {
      const stop = api.scope(inner => {
        for (let i = 0; i < p.width; i++) {
          const index = i;
          const derived = inner.memo(() => source.get() + index);
          inner.effect(() => {
            state.sum += derived();
            state.runs++;
          });
        }
      });
      source.set(round);
      stop();
    }
    dispose();
    return state;
  },
  disposal(adapter, p) {
    let cleaned = 0;
    const state = { sum: 0, runs: 0 };
    const { result, dispose } = adapter.root(api => ({ api, source: api.signal(0) }));
    const { api, source } = result;
    const stops = [];
    for (let i = 0; i < p.scopes; i++) {
      const index = i;
      stops.push(api.scope(inner => {
        const derived = inner.memo(() => source.get() + index);
        inner.effect(() => {
          state.sum += derived();
          state.runs++;
        });
        inner.cleanup(() => {
          cleaned++;
        });
      }));
    }
    // The caller is blocked from here until every dispose returned.
    const started = performance.now();
    for (let i = 0; i < stops.length; i++) stops[i]();
    const blocking = performance.now() - started;
    if (api.settle) api.settle();
    // Disposed scopes never run again.
    source.set(1);
    dispose();
    return { sum: cleaned, runs: state.runs, blocking };
  },
  async(adapter, p) {
    const POISON = -1e9;
    let poisoned = 0;
    /** @type {{ input: number, resolve: (value: number) => void }[]} */
    let launches = [];
    const take = () => {
      const taken = launches;
      launches = [];
      return taken;
    };
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const tasks = [];
      for (let i = 0; i < p.tasks; i++) {
        const index = i;
        const get = api.task(() => source.get() + index, (input, resolve) => void launches.push({ input, resolve }));
        api.effect(() => {
          if (get() === POISON) poisoned++;
        });
        tasks.push(get);
      }
      return { source, tasks };
    });
    // Every first launch completes.
    for (const l of take()) l.resolve(l.input * 2);
    // Two writes before completing: the older launches are superseded, and
    // their late completions (after the newer ones) must be ignored.
    result.source.set(1);
    const older = take();
    result.source.set(2);
    const newer = take();
    for (const l of newer) l.resolve(l.input * 2);
    for (const l of older) l.resolve(POISON);
    let sum = 0;
    for (const get of result.tasks) sum += get();
    dispose();
    return { sum, runs: older.length - poisoned };
  },
  /**
   * Async chains: each task's value is `steps` sequential steps from its
   * input, a step adding 1. The harness settles the steps it is asked for,
   * in rounds, letting the event loop run between rounds (a round ends when
   * the microtask queue has drained). After the first step of every chain
   * the source changes: the superseded chains' steps are settled only after
   * every current chain finished, so a late completion accepted would change
   * the sum. Timed from the first launch to the last completion.
   */
  async steps(adapter, p) {
    /** Steps asked for, by the generation current when asked: [value, resolve, …]. @type {any[][]} */
    const queues = [[], []];
    let generation = 0;
    let settled = 0;
    const step = (value, resolve) => void queues[generation].push(value, resolve);
    const { result, dispose } = adapter.root(api => {
      const source = api.signal(0);
      const tasks = [];
      for (let i = 0; i < p.tasks; i++) {
        const index = i;
        const get = api.chain(() => source.get() + index, p.steps, step);
        api.effect(() => {
          if (get() === 1 + index + p.steps) settled++;
        });
        tasks.push(get);
      }
      return { source, tasks };
    });
    /** Settles generation `g`'s steps, round after round, until none is asked for (3 idle microtask turns). @param {number} g */
    const rounds = async g => {
      for (let idle = 0; idle < 3; ) {
        const now = queues[g];
        if (now.length === 0) {
          idle++;
          await null;
          continue;
        }
        idle = 0;
        queues[g] = [];
        for (let i = 0; i < now.length; i += 2) now[i + 1](now[i] + 1);
      }
    };
    // The first step of every chain.
    const first = queues[0];
    queues[0] = [];
    for (let i = 0; i < first.length; i += 2) first[i + 1](first[i] + 1);
    await null;
    await null;
    // The source changes: new chains launch; the old ones wait in their queue,
    // settled only after every current chain completed.
    generation = 1;
    result.source.set(1);
    await rounds(1);
    await rounds(0);
    let sum = 0;
    for (const get of result.tasks) sum += get();
    dispose();
    return { sum, runs: settled };
  },
};
