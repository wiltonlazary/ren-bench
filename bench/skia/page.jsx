// The page of bench/skia/chrome.mjs: one arm per Chrome process, measured in
// the page and posted to the driver. Every arm runs the bench/ui rows (two
// Labels and an Action in a row Layout) on an 800×600 canvas.
// - `aria-off`, `aria-on`: create and clear 1,000 rows without and with the
//   accessibility mirror; JS time (the write, the host calls, layout, paint,
//   replay and the mirror), then forced style and layout, then the next frame.
// - `full`, `damage`: whole-frame repaint against damage repaint, for a swap
//   of rows 2 and 999, an update of every 10th label and a keystroke, each
//   timed from the operation to the end of present (CanvasKit's copy to the
//   canvas included) and to the next frame.

import { $root, $signal, $read, $write, $batch } from 'rrx-core';
import { View, Layout, Label, Edit, Action, For } from 'ren-core';
import { $skia, render, attach, loadLayout } from 'ren-skia';

const params = new URLSearchParams(location.search);
const arm = params.get('arm') ?? 'aria-off';
const rounds = Number(params.get('rounds') ?? 10);
const warmup = Number(params.get('warmup') ?? 3);
const now = () => performance.now();
// The task after the next frame's paint. timer: fallback, browsers do not
// signal a frame painted (no requestPostAnimationFrame).
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const [kit] = await Promise.all([globalThis.CanvasKitInit({ locateFile: file => `/canvaskit/${file}` }), loadLayout('/taffy.wasm')]);
const font = await (await fetch('/font.ttf')).arrayBuffer();
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:800px;height:600px';
document.body.appendChild(canvas);
const skia = $skia(kit, { font, canvas, width: 800, height: 600, aria: arm === 'aria-on' });
skia.partial = arm !== 'full';
attach(skia, canvas);
const root = $root('bench');
const rows = $signal(root, /** @type {{ id: number, label: any }[]} */ ([]));
const text = $signal(root, '');
let next = 0;
render(
  () => (
    <View gap={4}>
      <Edit label="Type" value={text} onChange={e => $write(text, e.value)} />
      <Label text={() => `typed ${$read(text).length}`} />
      <For each={rows} by={row => row.id}>
        {row => (
          <Layout layout="row" gap={8}>
            <Label text={String(row().id)} width={60} />
            <Label text={row().label} />
            <Action text="x" onPress={() => {}} />
          </Layout>
        )}
      </For>
    </View>
  ),
  skia,
  { root },
);
const create = () => {
  const list = new Array(1000);
  for (let i = 0; i < 1000; i++) {
    const id = ++next;
    list[i] = { id, label: $signal(root, `pretty table ${id}`) };
  }
  $write(rows, list);
};

/** @type {Record<string, { js: number[], layout: number[], frame: number[] }>} */
const results = {};
/** Times `fn` (which presents): JS, then forced layout, then the next frame. @param {string} name @param {() => void} fn @param {boolean} keep */
async function timed(name, fn, keep) {
  const start = now();
  fn();
  const js = now();
  void document.body.offsetHeight;
  const layout = now();
  await frame();
  const end = now();
  if (!keep) return;
  const r = (results[name] ??= { js: [], layout: [], frame: [] });
  r.js.push(js - start);
  r.layout.push(layout - start);
  r.frame.push(end - start);
}

await frame();
for (let round = 0; round < warmup + rounds; round++) {
  const keep = round >= warmup;
  if (arm === 'aria-off' || arm === 'aria-on') {
    await timed('create', create, keep);
    await timed('clear', () => $write(rows, []), keep);
    continue;
  }
  if (round === 0) await timed('create', create, false);
  for (let i = 0; i < 4; i++)
    await timed('swap', () => {
      const list = $read(rows).slice();
      const a = list[1];
      list[1] = list[998];
      list[998] = a;
      $write(rows, list);
    }, keep);
  for (let i = 0; i < 4; i++)
    await timed('update', () => {
      const list = $read(rows);
      $batch(root, () => {
        for (let k = 0; k < list.length; k += 10) $write(list[k].label, `${$read(list[k].label)} !`);
      });
    }, keep);
  // Press the Edit where it was drawn.
  const hits = skia.painter.hits;
  let at = 0;
  while (at < hits.n && hits.items[at].kind !== 4) at++;
  skia.press((hits.box[at * 6] + hits.box[at * 6 + 2]) / 2, (hits.box[at * 6 + 1] + hits.box[at * 6 + 3]) / 2);
  for (let i = 0; i < 4; i++) await timed('key', () => skia.key('a'), keep);
  skia.press(400, 590);
}
// A keystroke that missed the Edit measures nothing.
if (arm === 'full' || arm === 'damage') {
  const typed = $read(text).length;
  if (typed !== 4 * (warmup + rounds)) throw new Error(`typed ${typed} keys of ${4 * (warmup + rounds)}`);
}
const repaint = skia.repaint;
await fetch('/result', { method: 'POST', body: JSON.stringify({ arm, repaint, results, agent: navigator.userAgent }) });
