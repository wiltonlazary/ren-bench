// ren-core, ren-dom $dom, direct: render() into #main, as the README shows. Rows
// cleared in the background report the end of their drain to the harness.
import { $root } from 'rrx-core';
import { render } from 'ren-dom';
import { Bench } from './app.jsx';

const root = $root('bench');
globalThis.benchBackground = true;
render(Bench(root), document.getElementById('main'), { root, swept: () => globalThis.benchDrained?.() });
