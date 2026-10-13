// The worker side of the UI benchmark: the same Bench application as the
// direct page, served to the main thread. `config=plain` turns lanes,
// coalescing and backpressure off (one message per flush, applied on arrival).
// `pacing`: on (ren-core's background disposal, the default), off (retire:
// false), rrx-core (retired, swept by rrx-core's macrotask fallback drain); each drain's
// report crosses to the page.

import { $root } from 'rrx-core';
import { serve } from 'ren-core/worker';
import { Bench, rrxSweeper } from './app.jsx';

const params = new URLSearchParams(self.location.search);
const qos = params.get('config') !== 'plain';
const root = $root('app');
const app = Bench(root, { batch: true, work: Number(params.get('work') ?? 0), yielding: params.get('yielding') ?? 'timeout', weight: Number(params.get('weight') ?? 0) });
const pacing = params.get('pacing') ?? 'on';
if (pacing === 'rrx') rrxSweeper(root, drain => session.post({ swept: drain }));
const session = serve(app.view, {
  root,
  retire: pacing === 'off' ? false : undefined,
  swept: drain => session.post({ swept: drain }),
  lanes: qos,
  coalesce: qos,
  backpressure: qos,
  budget: qos ? 8 : Infinity,
  message: data => {
    if (data === 'counters') session.post({ counters: { ...session.counters }, ticks: app.ticks(), spent: app.spent() });
    else app.ops[data]();
  },
});
