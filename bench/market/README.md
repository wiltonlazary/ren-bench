# Market UI benchmark

One application, the keyed table of
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
(krausest), written in each market framework the way its own users write it,
and through the linked ren-core and ren-dom public package entries. Each is timed
in headless Chrome from the click to the painted frame. This is the UI-level
companion of the reactivity-core comparison in `bench/reactivity/run.mjs`.

```sh
cd <ren-bench checkout>   # bundles land in artifact/bench/market/dist (the build directory)
npm --prefix bench/market install && npm --prefix bench/market/solid1 install   # once
flock "$HOME/.cache/chrome-bench.lock" node bench/market/run.mjs                                   # everything: build, run, tables
flock "$HOME/.cache/chrome-bench.lock" node bench/market/run.mjs --only ren-dom,solid2 --rounds 15 --benches swap,select
node bench/market/build.mjs                                 # bundles and sizes only
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--only a,b` | all | implementations by `name` (impls.mjs) |
| `--benches a,b` | all eleven | `create1k replace1k update10th select swap remove create10k append1k clear1k`, and two that are not krausest's: `clear10k async1k` |
| `--rounds N` | 10 | timed samples per benchmark (each on a fresh page) |
| `--warmup N` | 5 | warm-up operations before each timed one |
| `--memory N` | 3 | heap samples (0 skips) |
| `--slowdown N` | 1 | CDP CPU throttling for the whole session (krausest uses 2–16×; off by default) |
| `--no-build` | | reuse the bundles and `sizes.json` of the last build |
| `--out file` | `results/latest.json` | the result file (scratch and A/B runs pass their own) |
| `--probe "expr"` | | load each page, print the expression's value, stop (debugging) |
| `--profile bench` | | prepare the benchmark on each page, sample its timed operation with the DevTools profiler (0.1 ms) and print the functions with the most self time, stop |

`TRACE=1` prints the page's console and exceptions.

`flock "$HOME/.cache/chrome-bench.lock" node bench/market/abba.mjs --base <checkout> [--only ren-dom-c] [--benches create1k,create10k] [--pairs 4]`
runs this checkout (A) against another ren-bench checkout (B) in ABBA order.
Each checkout's file-linked family dependencies select its library revisions, each
side with its own `run.mjs`, and prints the medians of `total` and
`ready`, A/B and the pairs A won; take the Chrome lock around it.

Family library revisions are recorded separately from the ren-bench commit.
Both ABBA checkouts need their own artifact links and installed dependencies;
changing a library means linking that checkout's dependencies to its chosen family worktrees.
A smoke run may compare a ren-bench checkout with itself, without a performance claim.

## Implementations and versions

Every implementation renders the same DOM (the krausest markup: a jumbotron
with six buttons, `table.table > tbody > tr` with four cells, the label in
`td.col-md-4 > a`, a remove `a > span.glyphicon-remove`, `tr.danger` for the
selected row), uses the same stylesheet (`common/style.css`, the Bootstrap 3
subset the table uses) and the same seeded data (`common/data.js`, so labels
and ids are identical across implementations). The code of each is
krausest's keyed implementation for that framework, changed only to use the
shared data module (and, for Solid 2, the 2.0 API).

| name | source | versions (exact; package.json pins them) | build |
| --- | --- | --- | --- |
| `vanilla` | krausest `keyed/vanillajs` | – | esbuild |
| `solid2` | krausest `keyed/solid`, ported to 2.0: no `batch`, `createProjection` for selection (2.0 has no `createSelector`) | solid-js 2.0.0-rc.9, @solidjs/web 2.0.0-rc.9, @solidjs/signals 2.0.0-rc.9; babel-preset-solid 2.0.0-rc.2 (@dom-expressions/babel-plugin-jsx 0.50.0-next.44, the newest published) | babel + esbuild (see the Solid 2 note) |
| `solid1` | krausest `keyed/solid` | solid-js 1.9.15, babel-preset-solid 1.9.15 (in `solid1/`, its own node_modules) | babel + esbuild |
| `svelte` | krausest `keyed/svelte` (runes, `$state.raw`) | svelte 5.57.1 | svelte/compiler + esbuild |
| `vue` | krausest `keyed/vue` (`shallowRef`, `v-memo`) | vue 3.5.43, @vue/compiler-sfc 3.5.43 (inline template, `isProd`) | compiler-sfc + esbuild |
| `preact` | krausest `keyed/preact-signals` | preact 10.29.8, @preact/signals 2.11.2 (signals-core 1.14.4) | esbuild (automatic JSX) |
| `lit` | krausest `keyed/lit` (plain JS static properties instead of TS decorators; shadow root; one delegated table listener) | lit 3.3.3 (lit-html 3.3.3, lit-element 4.2.2) | esbuild |
| `react` | krausest `keyed/react-hooks` (`useReducer`, `memo` rows) | react 19.3.0, react-dom 19.3.0 (`react-dom/client`) | esbuild, `NODE_ENV=production` |
| `ren-dom` | `impl/ren/app.jsx` with `render` from `ren-dom` | ren-core 0.1.0 and rrx-core 0.1.0, working trees | esbuild (automatic JSX, `jsxImportSource: ren-core`) |
| `ren-dom-stop` | `ren-dom` with `retire: false`: removed rows stop in the clear (no background disposal) | same | same |
| `ren-dom-rrx` | `ren-dom` retiring as usual, swept by rrx-core's macrotask fallback drain (4 ms `setTimeout` slices) instead of ren-core's pacing | same | same |
| `ren-shadow` | the same view in `Root({ renderer: $shadow({ styles }) })` | same | same |
| `ren-worker` | the same view served from a Worker (`ren-core/worker` `serve`), applied by `connect(worker, $dom(document), #main)` | same | same (two bundles) |
| `ren-dom-c`, `ren-shadow-c`, `ren-worker-c` | the same three entries compiled by the library's `ren-core/esbuild` plugin (templates) | same | esbuild + `ren()` plugin |

All bundles are ESM, minified, `target: es2022`, `conditions: ['production']`,
`process.env.NODE_ENV = "production"`, esbuild 0.28.2. Sizes are the
minified files the page loads and their gzip -9 size (the worker variant
counts both files).

The ren-core view is written as a ren-core user writes it: keyed `For` with
`by`, the label signal as a dynamic child, `class` as a reactive property, rrx-core
`$select` for the selected row, and `onClick` per element (which the DOM renderers delegate to the root's
container). It uses no ren-core primitives, only HTML tags, so it cannot run on
the Skia renderer; the Skia renderer's figures for create, update, swap and
clear of 1,000 rows are in `bench/ui` (a primitives view, not DOM-comparable).

**Solid 2 note.** The pinned Solid 2 compiler stores delegated
handlers as `el.$$click`, while @solidjs/web 2.0.0-rc.9 reads `el._$$click`
(rc.2 to rc.8 read `$$click`). Unpatched, the row handlers (select, remove)
are dead and the harness reports those benchmarks as failures.
`solid.mjs` integrates the two through a Babel AST pass for Solid 2. It reads
the compiler's generated delegation call and changes only generated handler
and handler-data assignments for those event names. User nodes keep their
source locations and are excluded: strings, templates, regexes, JSX text and
unrelated properties are preserved. Delegation stays enabled; the emitted
assignments are what a compiler matching rc.9 would generate. Solid 1 keeps
its own compiler unchanged. The pass exists only for the pinned compiler's
keys: a compiler that emits the keys rc.9 reads leaves it nothing to change.

`npm --prefix bench/market test` checks that source preservation and actual
click, double-click, named, bound-data and dynamic handlers work with both
pinned Solid versions. It uses happy-dom through the real esbuild plugin.

## Method

Each implementation runs in its own Chrome process, one at a time
(`--headless=new --disable-gpu`, 1280×1000, background throttling off). The
run waits while the machine has less than 8 GB available and records the load
average at the start and end of each implementation.

A benchmark is krausest's: a setup, warm-up operations, and one timed
operation. Every sample loads a fresh page.

| bench | setup and warm-up (untimed) | timed |
| --- | --- | --- |
| create1k | 5 × (create 1,000, clear) | create 1,000 |
| replace1k | 5 × create 1,000 | create 1,000 (replaces all rows) |
| update10th | create 1,000, 5 × update | update every 10th row (append " !!!") |
| select | create 1,000, select rows 5–9 | select row 1 (the second) |
| swap | create 1,000, 5 × swap | swap rows 1 and 998 (krausest's "2 and 999") |
| remove | create 1,000, remove rows 8, 7, 6, 5, 4 | remove row 3 |
| create10k | 5 × (create 1,000, clear) | create 10,000 |
| append1k | 5 × (create 1,000, clear), create 1,000 | append 1,000 |
| clear1k | 5 × (create 1,000, clear), create 1,000 | clear |
| clear10k | 5 × (create 1,000, clear), create 10,000, 300 ms | clear, and the disposal after it (below) |
| async1k | 5 × (create 1,000 async, clear) | create 1,000 rows from async data (below) |

**clear10k: disposal after the paint.** ren-core retires a large list's rows
and frees them later in paced slices; every other library frees them in the
clear itself (none has a background mode). The page reports: `sync`, the
click handler's own time (Solid 2, Svelte, Vue, Preact, Lit and React
render in a microtask, so theirs is near zero and the work shows in
`total`); `total`, to the painted frame; `freed`, to the moment the last
row is freed (ren-core calls `globalThis.benchDrained()` from its `swept`
report, which crosses from the worker in worker mode; for everyone else the
painted frame); and, over a window that ends 250 ms after `freed`, the
longest frame interval after the painted frame (`jitter`: 16.7 ms is a
frame on time) and the longest task of 50 ms or more (Long Tasks API).

**async1k: rows from async data.** `common/data.js` `later(1000)`
resolves plain rows after one `setTimeout(0)`, the same for everyone; each
implementation takes them through its own async primitive: ren-core an rrx-core
`$task` whose pending read keeps the list as it is; Solid 2 an async
`createMemo` under `Loading`; Solid 1.9 `createResource` under
`Suspense`; React 19 the promise in state read with `use()` under
`Suspense` (React holds a revealed Suspense boundary back for its fallback
throttle, about 300 ms, which is most of its reading); Svelte 5 an
`{#await}` block; Lit `until`. Vue (its `Suspense` is experimental and
serves async components, not data), Preact (its `Suspense` is
preact/compat, for lazy components) and vanilla have no async data primitive:
the handler awaits the data and writes it, which is what their
documentation shows. The reading is click to the painted frame; as the data
arrives in a later task, it is quantized to frames (the probe checks once per
frame).

**Timing** (`harness.js`, loaded before the implementation). The harness
hooks `requestAnimationFrame` so its probe callback is always the last one of
a frame. It clicks (`element.click()`, which reaches the same listeners as
a driver's click) from the probe at the start of a frame, then drains the
microtask queue, checking a cheap readiness test (row count, one or two
rows) after each turn; work that React, Vue, Svelte, Lit and Solid 2 queue as
microtasks therefore renders in that same frame. If the result is not there
yet (the worker's answer), the probe checks again in each later frame, after
the implementation's own frame callbacks. Once it is, a message posted from
the frame runs after that frame's style, layout and paint: its time is the
reading. So:

- **total** = click → the task after the first painted frame that shows the
  result. For a synchronous implementation it is the click's JS plus one
  frame's style, layout and paint, with no wait for a frame; for the worker
  it includes the round trip and the frame its answer waits for.
- **ready** = click → the DOM holds the result (the JS, microtasks included;
  for the worker, the round trip).
- **render** = total − ready: style, layout and paint on the main thread.
- DevTools `Performance.getMetrics` deltas around the timed operation give
  the main thread's `RecalcStyleDuration + LayoutDuration`. Its
  `ScriptDuration` is kept in the JSON but not reported: it omits work run as
  promise microtasks (Vue, Preact, Lit read near zero), so **ready** is the
  script-time measure.

This is not krausest's trace-based timing (click event start to the end of
the last paint in a Chrome trace), and it does not wait for the next vsync,
so absolute numbers are lower than krausest's and include no CPU throttling
unless `--slowdown` is given. Between implementations it is the same method.

**Validation.** After every warm-up operation and after the timed one, the
harness compares the whole table with a snapshot taken before the click:
row count, every id and label (fresh consecutive ids and well-formed labels
after create and append; exactly every 10th label changed on update; the two
rows exchanged on swap; exactly the clicked row selected; exactly one row
gone on remove; none after clear). A mismatch fails that benchmark for the
implementation; no time is recorded for it.

**Memory.** On a fresh page, after `HeapProfiler.collectGarbage`,
`Runtime.getHeapUsage` (used JS heap) once the page is ready and again after
creating 1,000 rows; the median of `--memory` samples. Worker variants also
report the worker's heap (DevTools auto-attach to the worker target).

## Results

`results/latest.json` is the current measurement: the run's environment
(Chrome, node, CPU, settings, command) and, per implementation, the
versions, bundle sizes, load at its start and end, every sample and the
summaries (min, median, mean, sd), memory and failures (none: every
implementation validated every warm-up and timed operation).

Environment: headless Chrome 153.0.8010.47, node v24.15.0, i7-12700H (20
CPUs), one-minute load 1.6–5.8 over the run with at least 12.5 GB
available, `node bench/market/run.mjs --no-build --rounds 10 --warmup 5
--memory 3`: 10 timed samples after 5 warm-up operations, 3 heap samples, no
CPU throttling. React's row is a second invocation with the same settings
(load 2.4–2.8), merged into the file.

Median ms, click to painted frame (`total`), with the click's JS (`ready`)
in parentheses for create; heap is the used JS heap after creating 1,000
rows (main thread, plus the worker's for worker variants); size is the
gzip -9 bundle:

| implementation | create1k | create10k | replace1k | update10th | select | swap | remove | append1k | clear1k | heap 1k rows (MB) | gzip (KB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vanilla JS | 34.1 (2.35) | 307.25 (23.75) | 34.4 | 4.05 | 1.25 | 5.05 | 7.8 | 35.2 | 3.6 | 0.83 | 1.9 |
| Solid 2 | 31.7 (3.8) | 339.85 (39.0) | 32.7 | 4.7 | 1.45 | 6.2 | 9.95 | 33.0 | 3.55 | 2.05 | 25.9 |
| Solid 1.9 | 32.35 (2.9) | 475.25 (48.1) | 35.25 | 4.6 | 1.2 | 6.5 | 9.45 | 44.55 | 3.65 | 1.93 | 8.4 |
| Svelte 5 | 29.6 (3.05) | 330.95 (30.7) | 34.55 | 4.5 | 1.6 | 5.55 | 8.6 | 33.8 | 4.15 | 2.02 | 21.2 |
| Vue 3.5 | 30.0 (4.8) | 326.6 (52.85) | 34.15 | 4.95 | 2.9 | 5.4 | 8.95 | 34.3 | 3.9 | 2.82 | 25.7 |
| Preact 10 + signals | 34.95 (9.25) | 376.2 (109.35) | 38.45 | 4.6 | 1.6 | 5.95 | 10.95 | 40.7 | 4.7 | 4.52 | 9.3 |
| Lit 3 | 33.9 (5.5) | 326.05 (50.4) | 204.25 | 4.4 | 1.5 | 5.4 | 8.55 | 35.85 | 208.15 | 1.42 | 9.3 |
| React 19 | 33.4 (7.25) | 602.7 (333.85) | 36.85 | 5.0 | 1.6 | 30.8 | 8.55 | 37.1 | 4.9 | 3.23 | 68.6 |
| ren-dom $dom | 31.4 (5.05) | 330.9 (59.9) | 33.9 | 4.25 | 1.15 | 5.25 | 8.25 | 35.45 | 3.35 | 2.04 | 19.0 |
| ren-dom $dom, retire off | 31.05 (5.05) | 332.45 (55.85) | 33.35 | 4.35 | 1.2 | 5.0 | 7.9 | 35.6 | 3.55 | 2.04 | 19.0 |
| ren-dom $dom, rrx-core fallback drain | 29.95 (5.0) | 334.5 (58.3) | 33.85 | 4.2 | 1.1 | 5.3 | 8.35 | 35.05 | 3.4 | 2.04 | 19.0 |
| ren-dom $shadow | 32.15 (5.65) | 325.15 (57.15) | 33.45 | 4.3 | 1.2 | 5.3 | 8.2 | 34.45 | 3.4 | 2.11 | 25.6 |
| ren-dom $dom, worker | 42.6 (16.7) | 379.85 (83.55) | 42.15 | 20.75 | 17.75 | 22.1 | 24.85 | 46.5 | 17.2 | 1.19 + 3.34 | 30.3 |
| ren-dom $dom, compiled | 27.9 (3.2) | 287.45 (34.25) | 30.6 | 4.8 | 3.1 | 5.4 | 8.15 | 31.95 | 3.1 | 2.06 | 19.6 |
| ren-dom $shadow, compiled | 28.95 (3.5) | 298.75 (34.2) | 32.1 | 4.3 | 1.3 | 5.45 | 8.3 | 32.3 | 3.4 | 2.12 | 25.7 |
| ren-dom $dom, worker, compiled | 42.95 (16.65) | 347.5 (53.35) | 42.65 | 20.95 | 17.8 | 21.85 | 24.9 | 45.2 | 17.25 | 1.16 + 2.94 | 30.8 |

Disposal and async, median ms (clear10k: `sync` / `total` / `freed`;
`jitter` min / median; no long task in any implementation):

| implementation | clear10k sync / total / freed | clear10k jitter | async1k total |
| --- | ---: | ---: | ---: |
| vanilla JS | 28.2 / 28.7 / 28.7 | 16.7 / 16.7 | 44.3 |
| Solid 2 | 0.1 / 31.1 / 31.1 | 16.7 / 16.8 | 45.75 |
| Solid 1.9 | 30.25 / 30.75 / 30.75 | 16.7 / 16.8 | 43.25 |
| Svelte 5 | 0.15 / 37.8 / 37.8 | 16.7 / 16.75 | 41.3 |
| Vue 3.5 | 0 / 35.05 / 35.05 | 16.7 / 16.8 | 41.65 |
| Preact 10 + signals | 0.05 / 41.0 / 41.0 | 16.7 / 16.75 | 41.5 |
| Lit 3 | 0 / 5468 / 5468 | 16.7 / 16.8 | 42.3 |
| React 19 | 0.1 / 45.7 / 45.7 | 16.7 / 16.7 | 327.1 |
| ren-dom $dom | 27.75 / 28.15 / 29.85 | 16.7 / 16.7 | 42.1 |
| ren-dom $dom, retire off | 28.15 / 28.6 / 28.6 | 16.7 / 16.8 | 41.6 |
| ren-dom $dom, rrx-core fallback drain | 27.25 / 29.1 / 29.05 | 16.7 / 16.75 | 41.15 |
| ren-dom $shadow | 28.3 / 28.8 / 31.1 | 16.7 / 16.8 | 42.3 |
| ren-dom $dom, worker | 0.1 / 39.85 / 39.55 | 16.7 / 16.75 | 42.8 |
| ren-dom $dom, compiled | 32.2 / 32.6 / 34.6 | 16.7 / 16.75 | 42.2 |
| ren-dom $shadow, compiled | 28.65 / 29.1 / 30.95 | 16.7 / 16.75 | 41.3 |
| ren-dom $dom, worker, compiled | 0.05 / 39.7 / 39.05 | 16.7 / 16.75 | 43.55 |

What the readings say:

- Compiled ren-dom is ahead of Solid 2 on create's JS time (3.2 against
  3.8 ms per 1,000 rows, 34.25 against 39.0 per 10,000) and level on heap
  (2.06 against 2.05 MB per 1,000 rows); the runtime path's JS time is
  higher (5.05 and 59.9 ms), and total time is style, layout and paint for
  everyone.
- Clearing 10,000 rows is DOM-bound everywhere: removing the rows (one
  `textContent` write) is most of vanilla's and ren-dom's 28 ms
  (`--profile clear10k`). Retiring takes ren-core's own disposal out of the
  clear (27.75 against 28.15 ms sync with retire off); the drain frees the
  rows about 2 ms after the paint, with no late frame (jitter 16.7 ms, a
  frame on time, as for everyone) and no long task. In worker mode the
  disposal and the drain run in the worker; the main thread only removes
  the rows.
- The worker variants pay the round trip and the frame the answer waits
  for (about 17 ms on the small operations) and move the application's
  heap off the main thread.
- async1k is within 5 ms for every implementation but React, whose
  Suspense reveal throttle holds the rows back about 300 ms. Lit's clear
  of a `repeat` over 10,000 rows takes seconds, which dominates its
  clear10k, and its replace1k and clear1k.

## Adding a variant

1. Put its source under `impl/<name>/` (or its own directory with a
   `package.json` when its dependencies conflict, like `solid1/`). Render the
   krausest markup into `#main` (a shadow-root variant sets
   `globalThis.benchScope = () => shadowRoot`), import the data from
   `common/data.js`, and give the buttons the ids `run`, `runlots`, `add`,
   `update`, `clear` and `swaprows`.
2. Add an entry to `impls.mjs`: `name`, `label`, `entry`, optional `worker`,
   `kind` (a build pipeline of `build.mjs`: `plain`, `solid`, `svelte`,
   `vue`, `preact`, `react`, `ren`, `ren-compiled`; add one there for a new compiler),
   `packages` whose versions to record, optional `from` and `note`.
3. Pin its dependencies exactly in `package.json`, install, and run
   `flock "$HOME/.cache/chrome-bench.lock" node bench/market/run.mjs --only <name> --rounds 2` to check that every
   benchmark validates, then the full run.

A ren-core variant (template cloning, event delegation, another reconciler)
is a new `impl/ren/*.jsx` entry over the same `app.jsx`, or a change to
a linked library measured with `abba.mjs` against a checkout linked to the
unchanged library, or by rerunning `--only ren-dom,ren-shadow,ren-worker` and
comparing with `results/latest.json` under the same environment.
