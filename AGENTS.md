# ren-bench

Read [the workspace rules](../../../AGENTS.md), its shared `.ai/config/`,
then [README.md](README.md) and [TODO.md](TODO.md).

This private JavaScript project owns the workspace's benchmark harnesses,
competitor dependencies, benchmark tests and recorded results. Libraries
own their implementation and behavioral tests; fix library defects there.

- Suites: `bench/reactivity/`, `bench/market/`, `bench/ui/`, `bench/skia/`,
  `bench/r3f/`.
- Import family packages through their public entries. Dependencies link to
  sibling checkouts; never keep a copy of library source in this project.
- Each competitor suite keeps its pinned dependencies and lockfile. Solid 1
  stays isolated from Solid 2 in `bench/market/solid1/`.
- Generated output, Chrome profiles and scratch belong under the ignored
  `artifact` link to `../../build/_repo__0.1.0`.
- Result files keep the provenance of their run. Results identify this
  harness and every family checkout the measured path uses.
- Keep canonical workloads, checksums and timing boundaries unchanged when
  maintaining a harness. A run that only checks execution is not a
  performance claim.
- Run one heavy job at a time under the workspace's memory limits; browser
  runs take `$HOME/.cache/chrome-bench.lock` and never use `ulimit -v`.
- `npm test` checks harness contracts. Exercise affected harnesses with
  real libraries and browser runs before committing changes to them.
