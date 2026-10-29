# ren-bench

The rui workspace's benchmark project. It owns the harnesses, pinned market
libraries, benchmark tests and recorded results. The measured libraries are
linked sibling checkouts and are imported through their public entries.

| Suite | Entry | Measures |
| --- | --- | --- |
| Reactivity | `bench/reactivity/run.mjs` | rrx-core against alien-signals, Preact, Vue, Solid 1 and Solid 2 |
| Disposal | `bench/reactivity/sweep.mjs` | `$stop` against `$retire`/`$sweep`, including keyed lists |
| DOM market | `bench/market/run.mjs` | the keyed table on ren-dom, Solid, React, Preact, Vue, Svelte, Lit and vanilla |
| Worker UI | `bench/ui/run.mjs` | direct/worker roots, lanes, batching, input latency and disposal |
| Skia | `bench/skia/frames.jsx`, `bench/skia/chrome.mjs` | frames, damage and accessibility in Node and Chrome |
| three.js | `bench/r3f/run.mjs` | ren-three against react-three-fiber through the rendered frame |

## Install

Install the sibling family libraries first, in the workspace's documented
order. From this checkout, install the root tools and isolated competitors:

```sh
npm ci
npm --prefix bench/reactivity ci
npm --prefix bench/market ci
npm --prefix bench/market/solid1 ci
npm --prefix bench/ui ci
npm --prefix bench/r3f ci
```

The separate Solid 1 install prevents it from resolving Solid 2's runtime.
All tools and competitor versions remain pinned in their manifests and locks.

## Run

All paths and commands below are relative to this checkout. Follow the
[workspace resource rules](https://github.com/wiltonlazary/rui/blob/main/.ai/config/resources.md): one heavy job
at a time, at least 8 GB available and load below 20. Node commands use both
the address-space and heap caps, for example:

```sh
bash -c 'ulimit -v 6000000; NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm test'
bash -c 'ulimit -v 6000000; NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm run bench -- --repeat 3'
```

Browser commands take the machine-wide Chrome lock through their npm scripts.
Use a heap cap and a deadline, without the address-space cap (Chrome needs
its own virtual address space):

```sh
NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm run market -- --only ren-dom-c,solid2
NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm run ui
NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm run skia:browser -- --suite damage
NODE_OPTIONS="--max-old-space-size=1024 --disable-wasm-trap-handler" timeout 300 npm run r3f
```

`npm run skia -- --suite damage` runs the Node frame benchmark; `npm run
sweep` runs background disposal. Both use the Node wrapper above.
See the [reactivity](bench/reactivity/README.md), [DOM market](bench/market/README.md),
[worker UI](bench/ui/README.md) and [R3F](bench/r3f/README.md) guides for
workloads, options and current results.

Other entry points, using the same resource wrappers:

```sh
node --import ren-core/loader bench/ui/boundary.mjs --rounds 30 --warmup 10
node --expose-gc bench/ui/dispose.mjs --pairs 10
node --expose-gc bench/ui/rows.mjs --base <ren-core-checkout> --pairs 20
node --import ren-core/loader bench/skia/busy.jsx --frames 400 --warmup 50
node --import ren-core/loader bench/skia/opacity.jsx --frames 400 --warmup 50
flock -w 1800 "$HOME/.cache/chrome-bench.lock" node bench/market/abba.mjs --base <ren-bench-checkout>
node bench/reactivity/paired.mjs 30 async,steps <candidate-rrx-core-checkout> <control-rrx-core-checkout>
```

## Contracts and results

[Reactivity scenarios](bench/reactivity/scenarios.json) remain the canonical
graphs, parameters and expected checksums. `RRX_SCENARIOS=<file>` selects
another definition. `RRX_ROOT=<checkout>` selects another rrx-core package
for the reactivity runner; the paired runner sets it per arm, so both arms
use this same harness and dependency install. A checksum failure exits
nonzero and is never reported as a valid timing.

Reports record the ren-bench commit/dirty state, Node options and the
version, resolved path, commit and dirty state of the measured family
packages. A missing Git identity is unknown, never clean. Browser runners
also record Chrome and their workload settings. Benchmark changes
must preserve validation and timing boundaries; a reduced run proves
execution, not performance parity.

Bundles, profiles and scratch live under `artifact`, the ignored link to
`../../build/_repo__0.1.13`. Each suite keeps one current
measurement: the DOM market's
[`bench/market/results/latest.json`](bench/market/results/latest.json) and the
reactivity market's [`bench/reactivity/results`](bench/reactivity/results);
the other suites' current readings are in their guides. A stored result
carries the environment it ran under (versions, settings, load), not the
commits it ran on.

Design analysis lives in each library's README. Performance defects belong
to the owning library; rrx-core's async parity target is parked under the
API freeze.

`npm test` runs the shared timer guard, source-provenance tests, reactivity
runner checks and the Solid compiler integration tests. A harness change
also requires real execution of the affected Node/browser paths.
