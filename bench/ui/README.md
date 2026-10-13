# Worker runtime and disposal benchmarks

This suite belongs to ren-bench. Run the commands below from its repository root.
It measures ren-core through public package entries, with the linked rrx-core,
ren-dom and ren-skia packages. Install its pinned dependencies with
`npm --prefix bench/ui install` after the root dependencies. Bundles go to
`artifact/bench/ui/dist`; Chrome profiles stay under `artifact/tmp/ui`.
Each run prints its environment (the benchmark and family checkouts, Chrome,
node, load). The readings below are the current measurements, each with the
environment and method it ran under.

### Worker mode against direct mode (headless Chrome)

```sh
node bench/ui/run.mjs --build                 # bundles only
flock "$HOME/.cache/chrome-bench.lock" node bench/ui/run.mjs [--rounds 10] [--warmup 3] [--keys 40] [--burst-keys 100] [--interval 30] [--work N]
node --import ren-core/loader bench/ui/boundary.mjs [--rounds 200] [--warmup 60]
```

`bench/ui/run.mjs` bundles `bench/ui/page.jsx` and `bench/ui/worker.jsx` with
esbuild and runs each configuration in its own headless Chrome process:
the renderer (DOM or Skia) × direct mode with rrx-core batching on (`batch`) or off
(`nobatch`, every write flushes) × worker mode with QoS on (`qos`: lanes,
coalescing, backpressure, frame scheduling, overtaking) or off (`plain`: one
message per flush, applied on arrival). Every configuration runs the same
application (`bench/ui/app.jsx`: an Edit, a Label and 1,000 rows of two
Labels and an Action), the same operations, rounds and warm-up:

- create 1,000 rows, update every 10th, swap rows 1 and 998, clear; timed
  from the command to the moment the change is applied on the main thread,
  including a forced style and layout on the DOM in every mode (Skia paints in
  `present`);
- main-thread busy time per operation: the operation itself in direct mode;
  the connection's own time (reading, applying, presenting, forwarding) plus
  the forced layout in worker mode;
- keystrokes sent as real input through the DevTools protocol
  (`Input.dispatchKeyEvent`, every 30 ms, not waiting for the page), timed
  from the event's timestamp to the change applied, and to the frame that
  shows it; idle, and while a background burst rewrites all 1,000 labels
  inside rrx-core `$defer` on a timer, after `--work` counted iterations of
  application computation per tick (the same count in both modes);
- the frame rate during the burst, and the boundary: messages, records and
  bytes per message, and the time in postMessage, reading, applying and
  presenting.

Current results: Chrome 153.0.8010.47, node v24.15.0, 20 CPUs, load
2.0–3.7 (the mailbox rows are a separate run under the same settings),
`--work 4000000`, 10 rounds after 3 warm-up rounds. Operations,
min / median ms (create 1,000 rows, update every 10th, swap rows 1 and 998,
clear; clear retires the 1,000 rows at the default threshold):

| configuration | create 1,000 | update 10th | swap | clear |
| --- | ---: | ---: | ---: | ---: |
| DOM direct batch | 19.91 / 21.43 | 1.51 / 1.72 | 0.79 / 0.91 | 1.9 / 1.97 |
| DOM direct nobatch | 19.47 / 20.98 | 1.42 / 1.7 | 0.76 / 0.92 | 1.76 / 1.98 |
| DOM worker qos | 21.3 / 24.85 | 1.64 / 2.32 | 0.86 / 1.06 | 2.02 / 2.32 |
| DOM worker plain | 20.43 / 23.24 | 1.68 / 2.19 | 0.98 / 1.22 | 2.13 / 2.22 |
| DOM worker mailbox | 22.18 / 23.87 | 1.75 / 1.94 | 0.92 / 1.1 | 2.08 / 2.27 |
| Skia direct batch | 2.06 / 2.65 | 1.33 / 1.51 | 1.53 / 1.63 | 0.6 / 0.65 |
| Skia direct nobatch | 2.02 / 2.4 | 88.81 / 95.23 | 1.26 / 1.39 | 0.54 / 0.63 |
| Skia worker qos | 3.55 / 3.89 | 1.59 / 1.77 | 1.72 / 1.99 | 0.8 / 0.95 |
| Skia worker plain | 2.83 / 3.99 | 1.65 / 1.78 | 1.73 / 1.88 | 0.81 / 0.93 |
| Skia worker mailbox | 3.36 / 4.3 | 1.67 / 1.83 | 1.7 / 1.88 | 0.84 / 0.95 |

Main-thread busy per operation, min / median ms (direct rows equal the
table above):

| configuration | create 1,000 | update 10th | swap | clear |
| --- | ---: | ---: | ---: | ---: |
| DOM worker qos | 19.3 / 22.4 | 1.4 / 2.03 | 0.57 / 0.69 | 1.82 / 2.06 |
| DOM worker plain | 18.84 / 20.91 | 1.48 / 1.85 | 0.7 / 0.77 | 1.85 / 1.93 |
| DOM worker mailbox | 20.24 / 21.45 | 1.46 / 1.72 | 0.6 / 0.72 | 1.86 / 2 |
| Skia worker qos | 1.69 / 2.2 | 1.38 / 1.5 | 1.34 / 1.51 | 0.56 / 0.69 |
| Skia worker plain | 1.6 / 2.12 | 1.45 / 1.52 | 1.34 / 1.51 | 0.61 / 0.67 |
| Skia worker mailbox | 1.82 / 2.28 | 1.46 / 1.55 | 1.37 / 1.47 | 0.6 / 0.7 |

Keystroke to applied change and to the frame that shows it, p50 / p95 /
p99 ms, idle and during the background burst (work 4M), with the burst's
frame rate (long frames over 25 ms / frames):

| configuration | idle applied | idle frame | burst applied | burst frame | burst fps |
| --- | ---: | ---: | ---: | ---: | ---: |
| DOM direct batch | 1.45 / 1.95 / 4.8 | 9.55 / 15.56 / 16.65 | 5.28 / 11.95 / 13.17 | 7.36 / 12.1 / 14.72 | 60 (0/179) |
| DOM direct nobatch | 1.49 / 1.82 / 4.69 | 7.68 / 16.45 / 16.81 | 6.72 / 11.91 / 12.72 | 7.3 / 12.07 / 13.97 | 60 (0/179) |
| DOM worker qos | 11.29 / 18.38 / 18.92 | 26 / 33.01 / 33.3 | 14.26 / 18.03 / 18.59 | 26.44 / 32.8 / 33.62 | 60 (0/179) |
| DOM worker plain | 9.32 / 16.47 / 17.35 | 24.01 / 31.24 / 31.7 | 19.73 / 29.87 / 33.45 | 25.29 / 37.16 / 38.21 | 59.7 (1/178) |
| DOM worker mailbox | 9.59 / 16.77 / 17.13 | 9.69 / 16.88 / 17.94 | 14.76 / 18.47 / 18.8 | 27.05 / 33.74 / 33.97 | 60 (0/180) |
| Skia direct batch | 1.99 / 2.62 / 4.26 | 9.29 / 16.16 / 16.55 | 1.91 / 5.6 / 6.24 | 9.38 / 16.26 / 16.47 | 60 (0/180) |
| Skia direct nobatch | 1.83 / 2.37 / 4.1 | 9.08 / 16.22 / 16.63 | 472.75 / 929.16 / 991.38 | 491.57 / 962.74 / 1031.65 | 1.6 (3/5) |
| Skia worker qos | 9.67 / 16.67 / 17.62 | 24.45 / 31.98 / 32.44 | 10.96 / 17.88 / 18.62 | 24.18 / 34.55 / 35.07 | 60 (0/180) |
| Skia worker plain | 11.61 / 18.29 / 19.46 | 26.3 / 32.85 / 33.29 | 11.73 / 19.49 / 19.93 | 25.63 / 32.76 / 33.17 | 60 (0/179) |
| Skia worker mailbox | 9.51 / 15.97 / 18.04 | 12.46 / 18.09 / 18.52 | 11 / 18.6 / 19.38 | 25.92 / 34.91 / 35.24 | 60 (0/179) |

At saturation (`--work 64000000`, 100 keystrokes, DOM, two runs, load
3.5–4.1): QoS keystroke to applied p50 / p95 / p99 37.2 / 59.2 / 66.4 and
37.6 / 60.1 / 70.2 ms, plain 45.0–53.7 / 81.6–84.0, 60 fps with no long
frame.

During the burst (work 4M), with the application on its own thread:

| configuration | burst ticks | app ms/s | msgs/s | records/msg | main-thread ms/s | coalesced | overtaken | late frames |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DOM direct batch | 196 | 298.4 | – | – | – | – | – | – |
| DOM worker qos | 371 | 485.7 | 73 | 697 | 49.5 | 271,225 | 100 | 60 |
| DOM worker plain | 369 | 494.1 | 156 | 787 | 234.6 | 0 | 0 | 0 |
| DOM worker mailbox | 370 | 484.8 | 72 | 779 | 57.5 | 254,000 | 100 | 0 |
| Skia direct batch | 260 | 458.3 | – | – | – | – | – | – |
| Skia worker qos | 376 | 478.4 | 86 | 816 | 134.5 | 217,000 | 100 | 21 |
| Skia worker plain | 374 | 481.4 | 158 | 789 | 235.6 | 0 | 0 | 0 |
| Skia worker mailbox | 372 | 479.1 | 89 | 818 | 152.8 | 206,551 | 100 | 0 |

(A "late frame" is a gap of more than 25 ms between two frames this side
ran a callback in; the mailbox polls every frame after input, so its gaps
are frame-sized, while qos counts frames without a message as gaps.)

Boundary per message in the browser (worker qos, timed rounds): create
1,000 rows is one message of 13,727 records and 269 KB, posted in 0.12 ms,
read in 0.06 ms and applied in 5.0 ms on the DOM (0.56 ms plus 1.55 ms of
present on Skia); update is 100 records, 5.8 KB, 0.03 / 0.02 / 0.18 ms; swap
is 2 records; clear is 1,000 records applied in 2.0 ms. Through the mailbox
the create message is read (its strings decoded) in 0.45 ms. In node
(`bench/ui/boundary.mjs`, 200 rounds): recording costs 10–53 ns
a record over a host that only mirrors the tree, decoding and dispatching
into a host that does nothing 5–7 ns a record, and `structuredClone` of the
create message 0.2 ms.

What the readings say:

- With the DOM, the component layer and graph are a small part of the main
  thread's work; the DOM mutations and style/layout are most of it, so worker
  mode barely lowers busy time per operation (create 19.3 against 19.9 ms
  min). With Skia it lowers it by about a fifth; layout and paint stay.
- Idle, a keystroke's application answer lands one frame later in worker
  mode by message: Chrome runs the worker's reply after the frame that
  follows the input (shown 24–26 ms p50 after the key). The shared mailbox
  takes that frame away (9.7 ms on the DOM, 12.5 on Skia, as direct).
- Worker mode keeps 60 fps with no long frames at every burst level (work 0
  to 64M), and the
  application does up to twice the background work, where direct mode falls
  to 25–30 fps once the burst takes most of the main thread. Keystroke latency
  under the burst stays close to the idle worker latency until the worker
  itself is saturated; then input waits behind the application's own long
  tasks on the worker as it does on the main thread, plus a frame. Neither
  mode can preempt a running task; slicing long work is the application's.
- QoS against plain: half the messages (73 against 156 a second on the DOM),
  less main-thread time at the same burst (DOM 49.5 against 234.6 ms/s, Skia
  134.5 against 235.6), and a lower latency tail, at saturation too: an answer that depends on a
  held message (a HURRY request and its acknowledgement) goes at once
  behind it, so at work 64M QoS reads p95 59–60 ms against plain's 82–84 on
  the DOM, with 60 fps and no long frame in every run.
- Batching off costs nothing on the DOM (writes apply synchronously and the
  layout is forced once), but on Skia every write repaints: updating 100 rows
  takes 89–95 ms instead of 1.3–1.5, and the burst drops to 1.6 fps.
- Swap is 2 records: the reconciler moves only the two swapped rows.

### Disposal under input

```sh
flock "$HOME/.cache/chrome-bench.lock" node bench/ui/run.mjs --scenario dispose [--keys 40] [--interval 30] [--repeat 4] [--weight 0]
node --expose-gc --import ren-core/loader bench/ui/dispose.mjs [--pairs 10] [--sizes 100,300,1000,3000,10000]
```

The page renders 10,000 rows of the application above, then types
keystrokes every 30 ms while, 150 ms in, the rows are cleared; direct and
worker mode, each with pacing `on` (ren-core's Sweeper), `off` (`retire:
false`: every row stops in the clear) and `rrx-core` (retired, swept by rrx-core's
macrotask fallback drain: 4 ms `setTimeout` slices, reproduced by `rrxSweeper`),
interleaved over `--repeat` runs.
`--weight N` gives every row N memos over its label, each read by an
effect with a cleanup, as real components carry.

Current results: Chrome 153.0.8010.47, node v24.15.0, 20 CPUs, load
1.3–4.4, medians of 4 interleaved runs,
DOM renderer (keystroke to applied change, p50 / p95 / max ms; frame rate
and long frames over the typing; the clear's time to applied and its
main-thread busy time; the drain: clear to last row freed, slices, longest
slice):

| rows | configuration | keystroke | fps (long) | clear applied / busy | drain |
| --- | --- | ---: | ---: | ---: | ---: |
| weight 0 | direct, on | 0.6 / 11 / 18.2 | 60 (0/72) | 17.9 / 17.9 | 21.1 / 1 / 2.2 |
| weight 0 | direct, off | 0.6 / 10.5 / 21.3 | 60 (0/72) | 21 / 21 | – |
| weight 0 | direct, rrx-core | 0.6 / 9.6 / 20.8 | 60 (0/72) | 17.8 / 17.8 | 21.1 / 1 / 2.1 |
| weight 0 | worker, on | 10.6 / 24.9 / 32.7 | 60 (0/71) | 31.5 / 18.9 | 4.2 / 1 / 3 |
| weight 0 | worker, off | 10.2 / 22.2 / 26.3 | 60 (0/72) | 25.6 / 23.5 | – |
| weight 0 | worker, rrx-core | 10.4 / 22.9 / 26.7 | 60 (0/72) | 25.1 / 22.8 | 4.6 / 1 / 3.3 |
| weight 10 | direct, on | 0.8 / 13.2 / 25.8 | 59.2 (0/71) | 19.6 / 19.6 | 45.7 / 4 / 4.5 |
| weight 10 | direct, off | 0.7 / 10.2 / 26.9 | 60 (0/72) | 30.7 / 30.7 | – |
| weight 10 | direct, rrx-core | 0.6 / 12.3 / 22.1 | 60 (0/72) | 19.9 / 19.9 | 68.5 / 10 / 4.1 |
| weight 10 | worker, on | 9.5 / 27.1 / 37.3 | 60 (0/71) | 36.8 / 20.4 | 16.1 / 4 / 4.4 |
| weight 10 | worker, off | 10 / 23.4 / 37.8 | 60 (0/71) | 38.7 / 20.5 | – |
| weight 10 | worker, rrx-core | 9.4 / 22.5 / 36 | 60 (0/71) | 35.4 / 19.7 | 65.9 / 18 / 4.1 |

Skia, weight 0 (same run as weight 0): the clear is 1.6–4.2 ms in every
pacing and the drain one slice of 2.4–4.2 ms, 5–13 ms after the clear.

- The clear is DOM-bound (removing 10,000 rows is most of its 18–21 ms);
  retiring takes ren-core's own disposal out of it: 3 ms at weight 0, 11 ms at
  weight 10 (direct). In worker mode the disposal runs in the worker, so
  the main thread's clear is the same with every pacing.
- No configuration drops a frame over the typing: the drain's slices stay
  at 4.5 ms or less. ren-core's pacing drains in fewer, fuller slices than rrx-core's
  default (4 against 10–18 at weight 10, with a similar total of work),
  so the rows are freed sooner: 46 against 69 ms direct, 16 against 66 ms
  in the worker.
- Keystroke latency differs by less than the run-to-run spread: the
  keystrokes that wait are the ones behind the clear itself.

### Row implementation A/B

`node --expose-gc bench/ui/rows.mjs --base <ren-core-checkout> --pairs 20 --rows 1000`
compares the linked ren-core package with a second ren-core checkout through
each package's public export map. Both must resolve the same rrx-core dependency.
Use `--mode runtime` for the automatic runtime; compiled is the default.
