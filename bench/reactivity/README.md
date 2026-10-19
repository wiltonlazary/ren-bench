# Reactivity and disposal benchmarks

Run these commands from the ren-bench checkout. rrx-core's design choices
are in [its README](https://github.com/wiltonlazary/rrx-core).

`bench/reactivity/scenarios.json` defines the scenarios: deep, broad, diamond,
avoidable, repeated, unstable, churn, disposal, async and steps, with their
parameters and expected checksums; it is the canonical definition.

- **disposal**: 10 000 scopes each own a memo, an effect and a cleanup, and
  every scope is disposed with the library's own ownership primitive (rrx-core
  `$stop`, alien-signals and Vue effect scopes, Solid roots, Preact disposer
  lists). The checksum counts cleanups and effect runs; the worker also
  reports `blocking`, the time until the last dispose call returned.
  `rrx-retire` runs this scenario only, with `$retire` and a full `$sweep`, so its
  blocking time is the `$retire` loop and its total includes the sweep.
- **async**: 1 000 async values on synchronous deferreds (so the time is the
  graph, not the event loop), including superseded completions that must be
  ignored. rrx-core uses `$task`; libraries without a synchronous async primitive use
  one generic task in `bench/reactivity/adapters.mjs` (a signal written by the latest
  launch of a tracking effect).

- **steps**: 1 000 async values, each a chain of 8 sequential async steps,
  settled by the harness in rounds with the event loop running between
  rounds, timed until the last completion (the worker awaits it). After the
  first step the input changes, and the superseded chains' steps are settled
  last, so an accepted late completion changes the sum. Every library writes
  the chain as an async function awaiting a promise per step.

`bench/reactivity/sweep.mjs` (rrx-core only) measures `$retire` and `$sweep` against `$stop` at
10k and 100k rows: the caller's blocking time, the sweep's total, and the
slowest and p99 slice at budgets of 2, 4 and 8 ms; and the same rows as a
`$keyed` list's, cleared by one write with and without `{ retire: true }`. `RRX_SCENARIOS=<path>` makes the
harness read another file in the same format, and the provenance line records
which.
`bench/reactivity/scenarios.mjs` writes each graph once over five primitives, and
`bench/reactivity/adapters.mjs` maps those primitives onto each library. Every write does
exactly one propagation: rrx-core writes and flushes; alien-signals, Preact and
Solid 1 write inside their own batch; Solid 2 writes and flushes. Vue has no
public batch, and a single write is already one propagation there.

```sh
npm --prefix bench/reactivity ci    # pinned competitors
node bench/reactivity/run.mjs --table --repeat 3
node bench/reactivity/run.mjs --rounds 1 --warmup 0 --table             # a quick smoke run
RRX_SCENARIOS=<path>/scenarios.json node bench/reactivity/run.mjs --table
```

The libraries are `rrx` (rrx-core's records core), `rrx-retire` (the records
core disposing with `$retire`; disposal only), `rrx-arena` (the column arena),
alien-signals 3.2.1, @preact/signals-core 1.14.4, @vue/reactivity 3.5.43,
solid-js 1.9.15 and @solidjs/signals 2.0.0-rc.9, pinned in
`bench/reactivity/package.json`.

Each (library, scenario) pair runs in its own `node` process with the same
flags, warm-up and number of timed rounds. The harness prints the median as
`{library, scenario, ms, sum, runs}`. A result
whose `sum` or `runs` differs from the expected values is reported as
`"fail": "checksum"` with `ms: null`, never as a time. The first line records
provenance (commit, dirty state, node and library versions, command-line flags,
inherited `NODE_OPTIONS`, warm-up, rounds, repeats and load), and the last
line records the load after the run. The default warms every library for
200 rounds: V8 tracing found optimization continuing through round 142.
Readings are comparable only under the same method: the same warm-up and
rounds, and a similar load.

## Current results

### Market (`run.mjs`)

[`results/full.jsonl`](results/full.jsonl) is the current full market run
and [`results/async.jsonl`](results/async.jsonl) the current focused
async/steps run; each file's first line is its environment and its last
line the load after the run. Both ran on Node v24.15.0 with the pinned
versions recorded in the files, 20 cores,
`NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler"`
and a 6,000,000 KB address-space cap; every process used 200 warm-up
rounds and 30 timed rounds, and every row passed the canonical sum and
run-count checks.

`node bench/reactivity/run.mjs --repeat 3 --table` (213 rows, one-minute
load 3.99 at the start), median ms with the range of the three repeats:

|              library |                deep |               broad |             diamond |           avoidable |            repeated |            unstable |               churn |               disposal |               async |               steps | rrx ÷ library (geomean) |
| -------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ------------------: | ---------------------: | ------------------: | ------------------: | ----------------------: |
|                  rrx | 0.437 (0.419–0.438) | 0.819 (0.807–0.830) | 0.501 (0.500–0.525) | 0.036 (0.035–0.037) | 0.087 (0.079–0.090) | 0.034 (0.034–0.036) | 0.154 (0.144–0.177) |    1.904 (1.821–1.916) | 0.444 (0.428–0.628) | 1.213 (1.202–1.655) |                    1.00 |
|            rrx-arena | 0.961 (0.959–0.978) | 1.923 (1.876–1.957) | 1.201 (1.150–1.212) | 0.083 (0.078–0.089) | 0.131 (0.129–0.132) | 0.071 (0.068–0.094) | 0.403 (0.396–0.503) | 10.171 (10.010–10.383) | 1.466 (1.425–1.892) | 2.103 (2.079–2.173) |                    0.41 |
|        alien-signals | 0.435 (0.434–0.435) | 1.040 (1.015–1.057) | 0.643 (0.631–0.657) | 0.030 (0.030–0.032) | 0.106 (0.099–0.107) | 0.032 (0.031–0.037) | 0.143 (0.143–0.177) |    1.915 (1.847–2.388) | 0.392 (0.391–0.410) | 1.251 (1.213–1.720) |                    0.97 |
| @preact/signals-core | 0.593 (0.587–0.607) | 1.119 (1.024–1.126) | 0.733 (0.726–0.741) | 0.034 (0.033–0.035) | 0.072 (0.071–0.072) | 0.045 (0.037–0.046) | 0.227 (0.211–0.231) |    3.320 (3.146–3.978) | 0.446 (0.420–0.570) | 1.220 (1.214–1.221) |                    0.82 |
|      @vue/reactivity | 1.018 (0.998–1.081) | 1.592 (1.533–1.626) | 1.180 (1.169–1.196) | 0.064 (0.063–0.066) | 0.111 (0.108–0.113) | 0.056 (0.052–0.058) | 0.234 (0.227–0.236) |    3.802 (2.723–4.027) | 0.390 (0.389–0.394) | 1.545 (1.176–1.591) |                    0.61 |
|             solid-js | 2.554 (2.390–2.611) | 3.866 (3.857–3.883) | 2.694 (2.666–2.798) | 0.101 (0.091–0.120) | 0.275 (0.265–0.288) | 0.125 (0.117–0.126) | 0.410 (0.406–0.419) |    4.143 (3.603–4.223) | 0.723 (0.679–0.930) | 1.408 (1.371–1.515) |                    0.34 |
|     @solidjs/signals | 2.852 (2.792–2.873) | 5.219 (5.087–5.324) | 3.380 (3.278–3.444) | 0.098 (0.097–0.113) | 0.434 (0.431–0.445) | 0.214 (0.186–0.224) | 0.764 (0.734–0.777) | 11.601 (11.390–14.089) | 1.418 (1.413–1.558) | 2.148 (1.861–2.506) |                    0.22 |
|           rrx-retire |                     |                     |                     |                     |                     |                     |                     |    2.340 (2.220–2.442) |                     |                     |                    0.81 |

|                rrx ÷ | deep | broad | diamond | avoidable | repeated | unstable | churn | disposal | async | steps |
| -------------------: | ---: | ----: | ------: | --------: | -------: | -------: | ----: | -------: | ----: | ----: |
|            rrx-arena | 0.46 |  0.43 |    0.42 |      0.44 |     0.66 |     0.48 |  0.38 |     0.19 |  0.30 |  0.58 |
|        alien-signals | 1.01 |  0.79 |    0.78 |      1.21 |     0.82 |     1.05 |  1.07 |     0.99 |  1.13 |  0.97 |
| @preact/signals-core | 0.74 |  0.73 |    0.68 |      1.07 |     1.21 |     0.76 |  0.68 |     0.57 |  1.00 |  0.99 |
|      @vue/reactivity | 0.43 |  0.51 |    0.42 |      0.57 |     0.78 |     0.61 |  0.66 |     0.50 |  1.14 |  0.79 |
|             solid-js | 0.17 |  0.21 |    0.19 |      0.36 |     0.32 |     0.27 |  0.37 |     0.46 |  0.61 |  0.86 |
|     @solidjs/signals | 0.15 |  0.16 |    0.15 |      0.37 |     0.20 |     0.16 |  0.20 |     0.16 |  0.31 |  0.56 |
|           rrx-retire |      |       |         |           |          |          |       |     0.81 |       |       |

|          blocking ms | disposal |
| -------------------: | -------: |
|                  rrx |    0.697 |
|            rrx-arena |    5.108 |
|        alien-signals |    0.664 |
| @preact/signals-core |    0.856 |
|      @vue/reactivity |    1.327 |
|             solid-js |    1.184 |
|     @solidjs/signals |    1.675 |
|           rrx-retire |    0.334 |

Three repeats check the whole market; they do not establish small
differences. The focused run,
`node bench/reactivity/run.mjs --only rrx,alien-signals,@solidjs/signals --scenarios async,steps --repeat 30 --table`
(180 rows, load 3.47 at the start), pairs the repeats of rrx-core and
alien-signals: the ratio is the median of the 30 paired rrx/alien ratios,
and, as in the harness, the median is the upper middle sample.

| Scenario | rrx ms | alien-signals ms | Solid 2 ms | Paired rrx/alien | rrx faster than alien |
| --- | ---: | ---: | ---: | ---: | ---: |
| async | 0.436 | 0.382 | 1.415 | 1.133 | 5/30 |
| steps | 1.209 | 1.197 | 1.921 | 1.014 | 13/30 |

What the readings say:

- The async scenario is bimodal for every library (a process settles in a
  fast or a slow mode), so a single median can mislead in either
  direction; claims about it rest on paired runs.
- The other libraries run the generic task (a tracking effect and a value
  signal), which gives none of the `$task` guarantees (the stale-read
  pull, status at once, superseded completions ignored even before the
  flush). What `$task` costs beyond it is per launch and completion, and
  folding it into a dedicated node kind would put a task check into the
  core's hottest paths.
- `steps` is dominated by the promise machinery every library shares
  (async function bodies, microtasks, GC); the chains are close across
  libraries.

`node bench/reactivity/paired.mjs <pairs> <scenarios> <candidate> <control>`
compares two rrx-core checkouts through this harness and its pinned
dependencies in alternating AB/BA pairs, each arm in a fresh process; its
header records the source SHA-256 digests of both arms.

### Disposal (`sweep.mjs`)

`node --expose-gc bench/reactivity/sweep.mjs`, 5 repeats, Node v24.15.0,
load 4.6: `$stop` of 100k rows blocks 16.2 ms; `$retire` of each row
5.5–7.7 ms, then the sweep frees them in 15.5–16.3 ms in slices of at most
2.05/4.05/8.04 ms at budgets of 2/4/8 ms. Clearing a 100k-row retiring
`$keyed` list blocks 0.03 ms (a `$stop` list: 17.6 ms), and the sweep
takes 15.4 ms in slices of at most 4.05 ms.
