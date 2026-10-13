// ren-core, ren-dom $dom, direct, retiring as ren-dom but swept by rrx-core's
// macrotask fallback drain (4 ms setTimeout slices) instead of ren-core's pacing (sweep: false).
import { $root } from 'rrx-core';
import { $sweeper, $sweep } from 'rrx-core';
import { render } from 'ren-dom';
import { Bench } from './app.jsx';

const root = $root('bench');
globalThis.benchBackground = true;
// rrx-core's macrotask fallback drain (4 ms setTimeout slices), reproduced so the harness learns when it ends.
$sweeper(root, R => {
  const tick = () => {
    if ($sweep(R, 4) > 0) setTimeout(tick, 0); // timer: fallback, as rrx-core's macrotask fallback drain
    else globalThis.benchDrained?.();
  };
  setTimeout(tick, 0); // timer: fallback, as rrx-core's macrotask fallback drain
});
render(Bench(root), document.getElementById('main'), { root });
