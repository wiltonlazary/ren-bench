// ren-core worker mode, worker side: the same Bench view, served to the main thread.
import { $root } from 'rrx-core';
import { serve } from 'ren-core/worker';
import { Bench } from './app.jsx';

const root = $root('bench');
// The end of each background drain crosses to the harness.
const session = serve(Bench(root), { root, swept: () => session.post('swept') });
