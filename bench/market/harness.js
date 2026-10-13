// The page side of the market benchmark: loaded as a classic script before
// the implementation's bundle, so its requestAnimationFrame hook is in place
// before any framework captures the function.
//
// Timing: an operation is timed from the click (element.click(), dispatched
// synchronously from script, as a benchmark driver's click reaches the same
// listeners) to the first frame that paints its result:
//
// - the click is dispatched at the start of a frame, from a probe frame
//   callback; the hook re-registers the probe whenever the page asks for a
//   frame, so the probe is always the frame's last callback. A synchronous
//   implementation's reading is then its work plus that frame's style,
//   layout and paint, without the wait for the next frame;
// - work queued as microtasks (React, Vue, Svelte, Lit, Solid 2) runs before
//   the frame renders, so the harness drains the microtask queue before it
//   checks; an answer that arrives later (the worker's) is checked by the
//   probe of each later frame, after the implementation's own frame
//   callbacks (the worker connection's) applied what they had;
// - once the result is there, a message posted from the frame runs after
//   that frame's style, layout and paint; its time is the reading.
//
// The probe's check is cheap (row count and one or two rows); the full check
// of every row runs afterwards, untimed, against a snapshot taken before the
// click. A mismatch fails the sample.

(() => {
  const raf = window.requestAnimationFrame.bind(window); // timer: feature, the probe forwarding (this alias is requestAnimationFrame)
  const caf = window.cancelAnimationFrame.bind(window);
  const now = () => performance.now();
  /** The pending probe: its frame id and callback. */
  let probe = 0;
  let probeCallback = null;
  window.requestAnimationFrame = callback => {
    const handle = raf(callback); // timer: feature, the probe forwarding: the app's own frame, passed through
    if (probe !== 0) {
      caf(probe);
      probe = raf(probeCallback); // timer: feature, the probe forwarding: the probe moves behind the app's frame
    }
    return handle;
  };
  const frame = () =>
    new Promise(resolve => {
      probeCallback = time => {
        probe = 0;
        probeCallback = null;
        resolve(time);
      };
      probe = raf(probeCallback); // timer: feature, the probe's frame is the reading (its style, layout and paint)
    });
  const channel = new MessageChannel();
  let posted = null;
  channel.port1.onmessage = () => {
    const done = posted;
    posted = null;
    done();
  };
  /** Resolves in the task after the current frame's rendering. */
  const afterPaint = () =>
    new Promise(resolve => {
      posted = resolve;
      channel.port2.postMessage(0);
    });

  // -------------------------------------------------------------------------
  // The DOM under test

  const scope = () => (typeof globalThis.benchScope === 'function' ? globalThis.benchScope() : document);
  const tbody = () => scope()?.querySelector('tbody') ?? null;
  const rows = () => tbody()?.rows ?? [];
  const count = () => rows().length;
  const idOf = tr => tr.cells[0].textContent.trim();
  const labelOf = tr => tr.cells[1].textContent.trim();
  const button = id => scope().querySelector(`#${id}`);
  const selectLink = i => rows()[i].cells[1].querySelector('a');
  const removeLink = i => rows()[i].cells[2].querySelector('a span') ?? rows()[i].cells[2].querySelector('a');

  /** Full snapshot: ids, labels, selected rows. */
  const snapshot = () => {
    const list = rows();
    const ids = new Array(list.length);
    const labels = new Array(list.length);
    const selected = [];
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      ids[i] = idOf(tr);
      labels[i] = labelOf(tr);
      if (tr.classList.contains('danger')) selected.push(i);
    }
    return { ids, labels, selected };
  };
  const LABEL = /^[a-z]+ [a-z]+ [a-z]+$/;

  // -------------------------------------------------------------------------
  // Operations: the element to click, the cheap readiness test (from the
  // state before), and the full check (snapshots before and after).

  const fail = message => {
    throw new Error(message);
  };
  const fresh = (n, before, after) => {
    if (after.ids.length !== n) fail(`expected ${n} rows, got ${after.ids.length}`);
    const first = Number(after.ids[0]);
    for (let i = 0; i < n; i++) {
      if (Number(after.ids[i]) !== first + i) fail(`row ${i}: id ${after.ids[i]}, expected ${first + i}`);
      if (!LABEL.test(after.labels[i])) fail(`row ${i}: label "${after.labels[i]}"`);
    }
    if (before.ids.length > 0 && before.ids.includes(after.ids[0])) fail('rows were not replaced');
  };
  const OPS = {
    run: {
      target: () => button('run'),
      ready: before => () => count() === 1000 && (before.first === null || idOf(rows()[0]) !== before.first) && labelOf(rows()[999]) !== '',
      check: (before, after) => {
        fresh(1000, before, after);
        if (after.selected.length !== 0) fail('a row is selected after create');
      },
    },
    runasync: {
      // Create 1,000 rows from async data (common/data.js later), through the
      // implementation's own async primitive.
      target: () => button('runasync'),
      ready: before => () => count() === 1000 && (before.first === null || idOf(rows()[0]) !== before.first) && labelOf(rows()[999]) !== '',
      check: (before, after) => {
        fresh(1000, before, after);
        if (after.selected.length !== 0) fail('a row is selected after create');
      },
    },
    runlots: {
      target: () => button('runlots'),
      ready: before => () => count() === 10000 && (before.first === null || idOf(rows()[0]) !== before.first) && labelOf(rows()[9999]) !== '',
      check: (before, after) => {
        fresh(10000, before, after);
        if (after.selected.length !== 0) fail('a row is selected after create');
      },
    },
    add: {
      target: () => button('add'),
      ready: before => () => count() === before.count + 1000 && labelOf(rows()[before.count + 999]) !== '',
      check: (before, after) => {
        const n = before.ids.length;
        if (after.ids.length !== n + 1000) fail(`expected ${n + 1000} rows, got ${after.ids.length}`);
        for (let i = 0; i < n; i++) if (after.ids[i] !== before.ids[i] || after.labels[i] !== before.labels[i]) fail(`row ${i} changed on append`);
        const first = Number(after.ids[n]);
        if (!(first > Math.max(...before.ids.map(Number)))) fail('appended ids are not new');
        for (let i = n; i < n + 1000; i++) {
          if (Number(after.ids[i]) !== first + i - n) fail(`row ${i}: id ${after.ids[i]}`);
          if (!LABEL.test(after.labels[i])) fail(`row ${i}: label "${after.labels[i]}"`);
        }
      },
    },
    update: {
      target: () => button('update'),
      ready: before => {
        const last = Math.floor((before.count - 1) / 10) * 10;
        const want0 = `${before.label0} !!!`;
        const wantLast = `${labelOf(rows()[last])} !!!`;
        return () => labelOf(rows()[0]) === want0 && labelOf(rows()[last]) === wantLast;
      },
      check: (before, after) => {
        if (after.ids.length !== before.ids.length) fail('row count changed on update');
        for (let i = 0; i < after.ids.length; i++) {
          if (after.ids[i] !== before.ids[i]) fail(`row ${i}: id changed on update`);
          const want = i % 10 === 0 ? `${before.labels[i]} !!!` : before.labels[i];
          if (after.labels[i] !== want) fail(`row ${i}: label "${after.labels[i]}", expected "${want}"`);
        }
      },
    },
    clear: {
      target: () => button('clear'),
      ready: () => () => count() === 0,
      check: (before, after) => {
        if (after.ids.length !== 0) fail(`${after.ids.length} rows after clear`);
      },
    },
    swaprows: {
      target: () => button('swaprows'),
      ready: before => {
        const a = idOf(rows()[1]);
        const b = idOf(rows()[998]);
        return () => idOf(rows()[1]) === b && idOf(rows()[998]) === a;
      },
      check: (before, after) => {
        const want = before.ids.slice();
        const wantLabels = before.labels.slice();
        [want[1], want[998]] = [want[998], want[1]];
        [wantLabels[1], wantLabels[998]] = [wantLabels[998], wantLabels[1]];
        if (after.ids.length !== want.length) fail('row count changed on swap');
        for (let i = 0; i < want.length; i++) if (after.ids[i] !== want[i] || after.labels[i] !== wantLabels[i]) fail(`row ${i}: ${after.ids[i]} "${after.labels[i]}", expected ${want[i]} "${wantLabels[i]}"`);
      },
    },
    select: {
      target: i => selectLink(i),
      ready: (before, i) => () => rows()[i].classList.contains('danger'),
      check: (before, after, i) => {
        if (after.selected.length !== 1 || after.selected[0] !== i) fail(`selected rows ${JSON.stringify(after.selected)}, expected [${i}]`);
        for (let k = 0; k < after.ids.length; k++) if (after.ids[k] !== before.ids[k]) fail(`row ${k} changed on select`);
      },
    },
    remove: {
      target: i => removeLink(i),
      ready: (before, i) => {
        const next = idOf(rows()[i + 1]);
        return () => count() === before.count - 1 && idOf(rows()[i]) === next;
      },
      check: (before, after, i) => {
        const want = before.ids.slice();
        want.splice(i, 1);
        if (after.ids.length !== want.length) fail(`expected ${want.length} rows, got ${after.ids.length}`);
        for (let k = 0; k < want.length; k++) if (after.ids[k] !== want[k]) fail(`row ${k}: id ${after.ids[k]}, expected ${want[k]}`);
      },
    },
  };

  const brief = () => {
    const list = rows();
    return { count: list.length, first: list.length ? idOf(list[0]) : null, label0: list.length ? labelOf(list[0]) : null };
  };

  /**
   * Clicks an operation and waits until its result is painted. Returns the
   * times (ms from the click): sync (the click's dispatch returned), ready
   * (the probe saw the result), total (the task after that frame's paint).
   */
  let clickAt = 0;
  /** The operations that retire the table's rows when it has some. */
  const DISPOSES = new Set(['run', 'runasync', 'runlots', 'clear']);
  async function act(name, arg, timeout = 30000) {
    const op = OPS[name];
    const before = brief();
    const ready = op.ready(before, arg);
    const target = op.target(arg);
    if (!target) fail(`no element for ${name}`);
    // Click at the start of a frame (in the probe, the frame's last
    // callback), so the reading does not include the wait for a frame.
    await frame();
    // Replacing or clearing a table retires its rows: a background
    // implementation owes a drain report from here on.
    if (globalThis.benchBackground === true && before.count > 0 && DISPOSES.has(name)) owed = true;
    const t0 = (clickAt = now());
    target.click();
    const sync = now() - t0;
    // Work the implementation queued as microtasks still paints in this
    // frame: let the microtask queue drain before deciding.
    let done = ready();
    for (let i = 0; !done && i < 1000; i++) {
      await null;
      done = ready();
    }
    while (!done) {
      await frame();
      done = ready();
      if (!done && now() - t0 > timeout) fail(`${name}: no result after ${timeout} ms (${count()} rows)`);
    }
    const seen = now() - t0;
    await afterPaint();
    return { sync, ready: seen, total: now() - t0 };
  }

  // -------------------------------------------------------------------------
  // Disposal in the background. An implementation that frees its rows after
  // the painted frame (ren-core: retired scopes, swept in idle slices) sets
  // globalThis.benchBackground and calls globalThis.benchDrained() once the
  // last of it is freed; for the others everything is freed when the result
  // is painted. For a fixed window after that (the same for all), every
  // frame interval and long task (the Long Tasks API, 50 ms and more) is
  // recorded: the longest frame after the painted one is the jitter the
  // disposal (and the collector) caused.

  const WINDOW = 250;
  let drained = null;
  /** True from a retiring operation until the implementation reports its drain; `quiet` waits for that report. */
  let owed = false;
  let quiet = null;
  window.benchDrained = () => {
    owed = false;
    if (quiet !== null) quiet();
    quiet = null;
    if (drained !== null) drained(now());
  };

  /** Resolves once the warm-up's background disposal reported its end; fails after 10 s. */
  async function settleWarmup() {
    if (!owed) return;
    const reported = new Promise(resolve => (quiet = resolve));
    // timer: deadline, a disposal that never reports fails the sample
    await Promise.race([reported, new Promise(resolve => setTimeout(resolve, 10000))]);
    quiet = null;
    if (owed) fail('the warm-up\'s background disposal never reported its end');
  }

  async function measureDrain(name, arg) {
    // The warm-up's disposal ended in prepare, and the driver collected its
    // garbage before this call.
    const frames = [];
    let recording = true;
    const tick = time => {
      frames.push(time);
      if (recording) raf(tick); // timer: feature, the drain's frame loop is the measurement
    };
    raf(tick); // timer: feature, the drain's frame loop is the measurement
    const tasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) tasks.push([entry.startTime, entry.duration]);
      });
      observer.observe({ type: 'longtask' });
    } catch {}
    const background = globalThis.benchBackground === true;
    let freedAt = null;
    const freed = background ? new Promise(resolve => (drained = time => ((drained = null), (freedAt = time), resolve()))) : null;
    const t = await act(name, arg);
    const t0 = clickAt;
    const painted = t0 + t.total;
    // timer: deadline, a disposal that never reports is recorded as not drained
    if (freed !== null) await Promise.race([freed, new Promise(resolve => setTimeout(resolve, 10000))]);
    drained = null;
    const end = Math.max(painted, freedAt ?? painted) + WINDOW;
    // timer: feature, the fixed window every implementation is observed for
    await new Promise(resolve => setTimeout(resolve, Math.max(0, end - now())));
    recording = false;
    observer?.disconnect();
    let jitter = 0;
    let count = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i - 1] < painted) continue;
      jitter = Math.max(jitter, frames[i] - frames[i - 1]);
      count++;
    }
    let longtask = 0;
    for (const [start, duration] of tasks) if (start + duration > painted) longtask = Math.max(longtask, duration);
    return { ...t, freed: (freedAt ?? painted) - t0, jitter, frames: count, longtask, drained: freed === null || freedAt !== null };
  }

  // -------------------------------------------------------------------------
  // Benchmarks, as js-framework-benchmark defines them: each sample starts
  // from a freshly loaded page, runs the setup and the warm-up operations
  // (untimed, each waited to its painted result), then times one operation.

  const W = () => bench.warmup;
  const repeat = (n, steps) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(...steps(i));
    return out;
  };
  const BENCHES = {
    create1k: { prepare: () => repeat(W(), () => [['run'], ['clear']]), op: ['run'] },
    replace1k: { prepare: () => repeat(W(), () => [['run']]), op: ['run'] },
    update10th: { prepare: () => [['run'], ...repeat(W(), () => [['update']])], op: ['update'] },
    select: { prepare: () => [['run'], ...repeat(W(), i => [['select', 5 + i]])], op: ['select', 1] },
    swap: { prepare: () => [['run'], ...repeat(W(), () => [['swaprows']])], op: ['swaprows'] },
    remove: { prepare: () => [['run'], ...repeat(W(), i => [['remove', W() + 3 - i]])], op: ['remove', 3] },
    create10k: { prepare: () => repeat(W(), () => [['run'], ['clear']]), op: ['runlots'] },
    append1k: { prepare: () => [...repeat(W(), () => [['run'], ['clear']]), ['run']], op: ['add'] },
    clear1k: { prepare: () => [...repeat(W(), () => [['run'], ['clear']]), ['run']], op: ['clear'] },
    // Not krausest's: clearing 10,000 rows, with the disposal after the paint
    // measured (sync: the click's handler time; freed; jitter; longtask).
    clear10k: { prepare: () => [...repeat(W(), () => [['run'], ['clear']]), ['runlots']], op: ['clear'], drain: true },
    // Not krausest's: 1,000 rows from async data, through each library's
    // own async primitive (see README).
    async1k: { prepare: () => repeat(W(), () => [['runasync'], ['clear']]), op: ['runasync'] },
  };

  let pending = null;
  const bench = {
    warmup: 5,
    benches: Object.keys(BENCHES),
    ready: () => {
      const s = scope();
      return !!(s && s.querySelector('#run') && s.querySelector('tbody'));
    },
    /**
     * Runs a benchmark's setup and warm-up; for a drain benchmark, waits for
     * the warm-up's background disposal too, and returns true: the driver then
     * collects the garbage before the timed operation.
     */
    async prepare(name) {
      for (const [op, arg] of BENCHES[name].prepare()) {
        const before = snapshot();
        await act(op, arg);
        OPS[op].check(before, snapshot(), arg);
      }
      const [op, arg] = BENCHES[name].op;
      const drain = BENCHES[name].drain === true;
      if (drain) await settleWarmup();
      pending = { op, arg, before: snapshot(), drain };
      return drain;
    },
    /** Times the benchmark's operation (after prepare). */
    measure() {
      return pending.drain ? measureDrain(pending.op, pending.arg) : act(pending.op, pending.arg);
    },
    /** Checks the timed operation's result in full; throws on a mismatch. */
    verify() {
      const { op, arg, before } = pending;
      pending = null;
      OPS[op].check(before, snapshot(), arg);
      return true;
    },
    /** Resolves in the task after the next frame's paint (memory readings). */
    async painted() {
      await frame();
      await afterPaint();
      return true;
    },
    /** One untimed operation (memory readings). */
    async step(op, arg) {
      const before = snapshot();
      await act(op, arg);
      OPS[op].check(before, snapshot(), arg);
      return true;
    },
  };
  window.__bench = bench;
})();
