// An opacity-only restyle every frame (rui-core's Skeleton pulse: 60 rows,
// each a round View whose style's opacity follows a signal, and a Label), on
// a CanvasKit raster surface in node: the time of a whole frame (the
// application's update, the host calls, layout, paint, damage, replay) and,
// within it, the layout tree's sync (prepare), the painter's draw and
// compare, and the replay; and how many frames ran the layout engine.
//
//   node --import ren-core/loader bench/skia/opacity.jsx [--frames 400] [--warmup 50]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { loadavg } from 'node:os';
import { $root, $signal, $read, $write, $flush } from 'rrx-core';
import { View, Label } from 'ren-core';
import { $skia, render, loadLayout } from 'ren-skia';

setFlagsFromString('--wasm-max-mem-pages=16384');
await loadLayout();
const args = process.argv.slice(2);
const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const FRAMES = option('frames', 400);
const WARMUP = option('warmup', 50);
const CanvasKitInit = (await import('canvaskit-wasm')).default;
const kit = await CanvasKitInit();
const font = readFileSync(new URL(import.meta.resolve('ren-skia/font.ttf')));
const skia = /** @type {any} */ ($skia(kit, { font, width: 800, height: 600 }));
const root = $root('bench');
const t = $signal(root, 0);
const rows = Array.from({ length: 60 }, (_, i) => i);
render(() => (
  <View style={{ padding: 16, gap: 8 }}>
    {rows.map(i => (
      <View style={{ direction: 'row', gap: 8, align: 'center' }}>
        <View style={() => ({ width: 40, height: 40, radius: 20, background: '#dee2e6', opacity: 0.5 + 0.5 * Math.abs(Math.sin($read(t) / 20 + i)) })} />
        <Label text={`row ${i}: a line of text`} />
      </View>
    ))}
  </View>
), skia, { root });
skia.present();
/** @type {Record<string, number>} */
const time = { prepare: 0, draw: 0, compare: 0, replay: 0 };
/** @param {any} obj @param {string} name @param {string} key */
const wrap = (obj, name, key) => {
  const f = obj[name].bind(obj);
  obj[name] = (/** @type {any[]} */ ...a) => {
    const s = performance.now();
    try {
      return f(...a);
    } finally {
      time[key] += performance.now() - s;
    }
  };
};
wrap(skia.boxes, 'prepare', 'prepare');
wrap(skia.painter, 'draw', 'draw');
wrap(skia.painter, 'compare', 'compare');
wrap(skia, 'draw', 'replay');
let layouts = 0;
const arrange = skia.boxes.arrange.bind(skia.boxes);
skia.boxes.arrange = (/** @type {any[]} */ ...a) => (layouts++, arrange(...a));
const frame = (/** @type {number} */ i) => {
  $write(t, i);
  $flush(root);
  skia.present();
};
for (let i = 0; i < WARMUP; i++) frame(i);
for (const k in time) time[k] = 0;
layouts = 0;
const start = performance.now();
for (let i = 0; i < FRAMES; i++) frame(WARMUP + i);
const total = performance.now() - start;
const per = (/** @type {number} */ v) => Math.round((v / FRAMES) * 1000) / 1000;
console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core', 'ren-core', 'ren-canv', 'ren-skia'], import.meta.url) }, frames: FRAMES, load: loadavg()[0].toFixed(2), layouts, repaint: skia.repaint, frame: per(total), prepare: per(time.prepare), draw: per(time.draw), compare: per(time.compare), replay: per(time.replay) }));
skia.close();
