// ren-core, ren-dom $dom, direct, with background disposal off (retire: false):
// every removed row stops at once, in the clear, with no Sweeper.
import { $root } from 'rrx-core';
import { render } from 'ren-dom';
import { Bench } from './app.jsx';

const root = $root('bench');
render(Bench(root), document.getElementById('main'), { root, retire: false });
