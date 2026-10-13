// A busy screen (ren-show's Terminal): two columns of rows on their own
// backgrounds, and each frame a tick in one column and a hover moving in
// the other (between its first two rows), beside the edge between them. On a CanvasKit raster surface
// in node: the time of a whole frame (the update, layout, paint, damage,
// replay), the replay alone, how the frames repainted, and the damage's
// mean share of the canvas.
//
//   node --import ren-core/loader bench/skia/busy.jsx [--frames 400] [--warmup 50] [--scale 1]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { loadavg } from 'node:os';
import { $root, $signal, $read, $write, $batch, $flush } from 'rrx-core';
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
const SCALE = option('scale', 1);
const CanvasKitInit = (await import('canvaskit-wasm')).default;
const kit = await CanvasKitInit();
const font = readFileSync(new URL(import.meta.resolve('ren-skia/font.ttf')));
const skia = /** @type {any} */ ($skia(kit, { font, width: 800, height: 600, scale: SCALE }));
const root = $root('busy');
const tick = $signal(root, 0);
const hover = $signal(root, 0);
const ROWS = 24;
const rows = Array.from({ length: ROWS }, (_, i) => i);
render(() => (
  <View style={{ direction: 'row', height: 600 }}>
    <View style={{ width: 400, background: '#1e2230', align: 'end', padding: 2, gap: 2 }}>
      {rows.map(i => (
        <Label text={`order ${1000 + i}  218.41  3,284`} style={() => ({ color: '#e0e0e0', radius: 3, background: $read(hover) % ROWS === i ? '#3a4260' : '#1e2230' })} />
      ))}
    </View>
    <View style={{ width: 400, background: '#161a24', align: 'start', padding: 2, gap: 2 }}>
      {rows.map(i => (
        <Label text={i === 0 ? () => `tick ${$read(tick)}` : `level ${i}  12.5  +0.4%`} style={{ color: '#c8c8c8' }} />
      ))}
    </View>
  </View>
), skia, { root });
skia.present();
let replay = 0;
const draw = skia.draw.bind(skia);
skia.draw = (/** @type {any} */ frame, /** @type {any} */ damage) => {
  const s = performance.now();
  try {
    return draw(frame, damage);
  } finally {
    replay += performance.now() - s;
  }
};
/** @type {Record<string, number>} */
const repaints = { full: 0, damage: 0, none: 0 };
let share = 0;
const frame = (/** @type {number} */ i) => {
  $batch(root, () => {
    $write(tick, i);
    $write(hover, i & 1);
  });
  $flush(root);
  skia.present();
  repaints[skia.repaint]++;
  const d = skia.painter.damage;
  share += skia.repaint === 'full' ? 1 : skia.repaint === 'none' ? 0 : d.area() / (800 * 600);
};
for (let i = 0; i < WARMUP; i++) frame(i);
replay = 0;
share = 0;
for (const k in repaints) repaints[k] = 0;
const start = performance.now();
for (let i = 0; i < FRAMES; i++) frame(WARMUP + i);
const total = performance.now() - start;
const per = (/** @type {number} */ v) => Math.round((v / FRAMES) * 1000) / 1000;
console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core', 'ren-core', 'ren-canv', 'ren-skia'], import.meta.url) }, frames: FRAMES, scale: SCALE, load: loadavg()[0].toFixed(2), frame: per(total), replay: per(replay), repaints, damage: Math.round((share / FRAMES) * 1000) / 1000 }));
skia.close();
