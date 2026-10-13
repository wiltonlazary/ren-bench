// ren-core worker mode, main-thread side: the ren-dom $dom host applies what the
// worker sends (ren-core/remote connect), with the default QoS options.
import { connect } from 'ren-core/remote';
import { $dom } from 'ren-dom';

const url = new URL('./worker.js', import.meta.url);
globalThis.benchBackground = true;
connect(new Worker(url, { type: 'module' }), $dom(document), document.getElementById('main'), { message: () => globalThis.benchDrained?.() });
