// Per-frame cost of the Skia renderer on 1,000 rows (the bench/ui
// application's rows: two Labels and an Action in a row Layout), in node on a
// CanvasKit raster surface, attached to a happy-dom canvas: the whole
// operation (the application's update, the host calls, layout, paint,
// replay), and within it the painter, the replay and the accessibility
// mirror's writes, for create, swap, page scroll, update of every 10th label,
// a keystroke into the Edit and clear. Arms, each on its own renderer, in
// ABBA order in one process. `--suite aria` (the default):
// - `off`: no accessibility mirror (`aria: false`);
// - `on`: the incremental mirror (`aria: true`);
// - `walk`: the mirror plus a walk over every item after each frame that
//   rewrites changed text, the per-frame alternative to incremental writes.
// happy-dom's DOM costs are not a browser's; compare the arms, not absolutes.
// `--suite damage` (no mirror):
// - `full`: every frame repainted whole (`partial = false`);
// - `damage`: only the rectangles that differ from the last frame.
//
//   node --import ren-core/loader bench/skia/frames.jsx [--suite aria|damage] [--rounds 10] [--warmup 3]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { provenance, sources } from '../../provenance.mjs';
import { performance } from 'node:perf_hooks';
import { Window } from 'happy-dom';
import { $root, $signal, $read, $write, $batch } from 'rrx-core';
import { View, Layout, Label, Edit, Action, For } from 'ren-core';
import { $skia, render, attach, loadLayout } from 'ren-skia';
import { setFlagsFromString } from 'node:v8';

// Each WebAssembly memory reserves its whole range up front: at most 1 GB
// each, Taffy's and CanvasKit's fit the address cap (.ai/config/resources.md).
setFlagsFromString('--wasm-max-mem-pages=16384');
await loadLayout();

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : Number(args[at + 1]);
};
const ROUNDS = option('rounds', 10);
const at = args.indexOf('--suite');
const SUITE = at < 0 ? 'aria' : args[at + 1];
const WARMUP = option('warmup', 3);

const font = readFileSync(new URL(import.meta.resolve('ren-skia/font.ttf')));
const kit = await (await import('canvaskit-wasm')).default();

/** Rewrites the mirrored text of every item that differs: the per-frame walk. @param {any} item */
function walk(item) {
  const el = item.aria;
  if (el !== null && (item.kind === 3 || item.kind === 5) && el.textContent !== item.text) el.textContent = item.text;
  for (let c = item.first; c !== null; c = c.next) walk(c);
}

/** One application on its own renderer and document, with its operations. @param {string} arm */
function App(arm) {
  const window = new Window();
  const document = window.document;
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const skia = $skia(kit, { font, width: 800, height: 600, aria: arm === 'on' || arm === 'walk' });
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
  const sample = { frames: 0, total: 0, draw: 0, replay: 0, aria: 0 };
  const painter = skia.painter;
  const draw = painter.draw.bind(painter);
  painter.draw = (a, b, c) => {
    const start = performance.now();
    draw(a, b, c);
    sample.draw += performance.now() - start;
  };
  const replay = skia.replay.run.bind(skia.replay);
  skia.replay.run = (a, b, c, d, e) => {
    const start = performance.now();
    replay(a, b, c, d, e);
    sample.replay += performance.now() - start;
  };
  const mirror = skia.mirror;
  if (mirror !== null) {
    const flush = mirror.flush.bind(mirror);
    mirror.flush = () => {
      const start = performance.now();
      flush();
      sample.aria += performance.now() - start;
    };
  }
  /** Runs `fn` and presents, timing the whole frame. @param {() => void} fn */
  const frame = fn => {
    const start = performance.now();
    fn();
    skia.present();
    if (arm === 'walk') {
      const t = performance.now();
      walk(skia.root);
      sample.aria += performance.now() - t;
    }
    sample.total += performance.now() - start;
    sample.frames++;
  };
  const ops = {
    create: () =>
      frame(() => {
        const list = new Array(1000);
        for (let i = 0; i < 1000; i++) {
          const id = ++next;
          list[i] = { id, label: $signal(root, `pretty table ${id}`) };
        }
        $write(rows, list);
      }),
    // Swap rows 2 and 999 (on screen and far below), 20 times.
    swap: () => {
      for (let i = 0; i < 20; i++)
        frame(() => {
          const list = $read(rows).slice();
          const a = list[1];
          list[1] = list[998];
          list[998] = a;
          $write(rows, list);
        });
    },
    // Scroll the page 40 px a frame, 3,000 px down and back up.
    scroll: () => {
      for (let i = 0; i < 75; i++) frame(() => skia.wheel(400, 300, 40));
      for (let i = 0; i < 75; i++) frame(() => skia.wheel(400, 300, -40));
    },
    // Update every 10th label, as bench/ui does, 10 times.
    update: () => {
      for (let n = 0; n < 10; n++)
        frame(() => {
          const list = $read(rows);
          $batch(root, () => {
            for (let i = 0; i < list.length; i += 10) $write(list[i].label, `${$read(list[i].label)} !`);
          });
        });
    },
    // Type into the Edit, one key a frame, 20 times.
    key: () => {
      // Press the Edit where it was drawn.
      const hits = skia.painter.hits;
      let at = 0;
      while (at < hits.n && hits.items[at].kind !== 4) at++;
      skia.press((hits.box[at * 6] + hits.box[at * 6 + 2]) / 2, (hits.box[at * 6 + 1] + hits.box[at * 6 + 3]) / 2);
      for (let i = 0; i < 20; i++) frame(() => skia.key('a'));
      skia.press(400, 590);
    },
    clear: () => frame(() => $write(rows, [])),
  };
  const take = () => {
    const out = { ...sample };
    sample.frames = sample.total = sample.draw = sample.replay = sample.aria = 0;
    return out;
  };
  return { ops, take };
}

const ARMS = SUITE === 'damage' ? ['full', 'damage'] : ['off', 'on', 'walk'];
/** @type {Record<string, ReturnType<typeof App>>} */
const arms = {};
for (const arm of ARMS) arms[arm] = App(arm);
const names = ['create', 'swap', 'scroll', 'update', 'key', 'clear'];
const FIELDS = /** @type {const} */ (['total', 'draw', 'replay', 'aria']);
/** @type {any} */
const results = {};
for (const op of names) {
  results[op] = {};
  for (const arm of ARMS) results[op][arm] = { total: [], draw: [], replay: [], aria: [] };
}

for (let round = 0; round < WARMUP + ROUNDS; round++) {
  const forward = round % 2 === 0 ? ARMS : ARMS.slice().reverse();
  const order = [...forward, ...forward.slice().reverse()];
  // Each arm runs the whole sequence (create first, clear last) twice per round, in ABBA order.
  for (const arm of order) {
    for (const op of names) {
      arms[arm].ops[op]();
      const s = arms[arm].take();
      if (round < WARMUP) continue;
      for (const field of FIELDS) results[op][arm][field].push((s[field] / s.frames) * 1000);
    }
  }
}

const median = list => {
  const sorted = list.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};
const min = list => Math.min(...list);
const f = list => `${min(list).toFixed(0)} / ${median(list).toFixed(0)}`;
console.log(`${SUITE} suite, node ${process.version}, happy-dom, ${ROUNDS} rounds after ${WARMUP} warm-up, ABBA; per frame, µs, min / median`);
console.log('| op | arm | whole frame | painter | replay | mirror writes (walk: the walk) |');
console.log('| --- | --- | ---: | ---: | ---: | ---: |');
for (const op of names)
  for (const arm of ARMS) {
    const r = results[op][arm];
    console.log(`| ${op} | ${arm} | ${f(r.total)} | ${f(r.draw)} | ${f(r.replay)} | ${f(r.aria)} |`);
  }

console.log(JSON.stringify({ provenance: { ...provenance(fileURLToPath(new URL('../..', import.meta.url))), sources: sources(['rrx-core', 'ren-core', 'ren-canv', 'ren-skia'], import.meta.url) } }));
