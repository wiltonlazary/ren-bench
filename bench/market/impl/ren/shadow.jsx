// ren-core, ren-dom $shadow, direct: an application root whose view renders
// into a shadow root of its host element; the shared stylesheet is the
// renderer's scoped `styles` (adopted by the shadow root). The component
// builds the table in the root's own graph ($active()).
import { Root, $active } from 'ren-core';
import { $shadow } from 'ren-dom';
import css from '../../common/style.css';
import { Bench } from './app.jsx';

globalThis.benchScope = () => document.querySelector('[data-ren-root="bench"]')?.shadowRoot ?? null;
const App = () => Bench($active())();
globalThis.benchBackground = true;
Root({ id: 'bench', target: document.getElementById('main'), renderer: $shadow({ mode: 'open', styles: css }), children: <App />, swept: () => globalThis.benchDrained?.() });
