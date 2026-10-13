# ren-three against react-three-fiber

The same scene in both, written as each library's users write it: 1,000
meshes in a keyed list on a grid (one shared BoxGeometry, a
MeshBasicMaterial each, a seeded color), created, every 10th recolored,
rows 2 and 999 swapped (their places follow the list), and all cleared.
ren-three renders on the frame after a change; react-three-fiber renders
on demand (`frameloop="demand"`, a committed change invalidating, as its
users do). Both use one three.js, no antialiasing and no tone mapping.

Each operation is timed in headless Chrome (WebGL on SwiftShader) from its
call to the end of the WebGL render that draws it (the renderer instance's
`render` is wrapped: three.js defines it per instance). After every
operation the scene's meshes and a checksum of their colors and places must
equal the other implementation's, or the run fails. Every sample is on a
fresh page, the implementations in ABBA order, after warm-up runs that each
change the scene.

Run from the ren-bench checkout; its root dependencies provide the family
packages through their public entries.

```sh
cd bench/r3f && npm install            # once
cd ../.. && flock "$HOME/.cache/chrome-bench.lock" node bench/r3f/run.mjs [--rounds 10] [--warmup 3]
```

Bundles and results (with harness and family checkout provenance) go to `artifact/bench/r3f`.

## Results

Current results: Chrome 153, three.js 0.186.1, @react-three/fiber 9.8.1 on
React 19.3.0, 10 rounds after 3 warm-ups, load 5.7 on 20 cores; median ms
to the render that draws the change:

| op | ren-three | react-three-fiber | ratio |
| --- | ---: | ---: | ---: |
| create 1,000 | 28.95 | 27.00 | 1.07 |
| update every 10th | 3.70 | 9.55 | 0.39 |
| swap | 2.90 | 10.65 | 0.27 |
| clear | 3.35 | 4.10 | 0.82 |

Create is mostly three.js building and drawing 1,000 meshes in both.
