// What both implementations share: the scene's data (seeded, so every page
// renders the same meshes), the operations, and the timing: an operation is
// timed from its call to the end of the WebGL render that draws it (both
// libraries render only when something changed). The page publishes
// `window.bench` for the harness.

/** The meshes of one create. */
export const COUNT = 1000;
/** The grid they stand on. */
export const COLUMNS = 40;

let seed = 7;
/** A seeded random number in [0, 1). */
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

let next = 1;
/**
 * `count` new rows: an id and a color each.
 * @param {number} count
 * @returns {{ id: number, color: number }[]}
 */
export function build(count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) rows[i] = { id: next++, color: Math.floor(random() * 0xffffff) };
  return rows;
}

/** A row's place on the grid. @param {number} i @returns {[number, number, number]} */
export const place = i => [(i % COLUMNS) - COLUMNS / 2, Math.floor(i / COLUMNS) - 12, 0];

/** The operations, as changes to a row list. */
export const OPS = {
  /** @param {any[]} rows */
  create: rows => (rows.length > 0 ? rows : build(COUNT)),
  /** @param {any[]} rows */
  update: rows => rows.map((r, i) => (i % 10 === 0 ? { id: r.id, color: (r.color + 0x3f3f3f) & 0xffffff } : r)),
  /** @param {any[]} rows */
  swap: rows => {
    if (rows.length < 999) return rows;
    const out = rows.slice();
    const a = out[1];
    out[1] = out[998];
    out[998] = a;
    return out;
  },
  /** @param {any[]} _rows */
  clear: _rows => [],
};

/** The render in flight's waiters: the next render after an operation resolves them. @type {((t: number) => void)[]} */
let waiting = [];
/** Renderers already timed. */
const timed = new WeakSet();
/**
 * Times a WebGLRenderer's renders (three.js defines `render` on each
 * instance, so the instance's is wrapped).
 * @param {any} gl
 */
function time(gl) {
  if (timed.has(gl)) return;
  timed.add(gl);
  const render = gl.render;
  gl.render = function (/** @type {any} */ scene, /** @type {any} */ camera) {
    render.call(this, scene, camera);
    if (waiting.length === 0) return;
    const t = performance.now();
    const list = waiting;
    waiting = [];
    for (const done of list) done(t);
  };
}

/**
 * Publishes the harness API of an implementation.
 * @param {string} name
 * @param {{ ready: Promise<void>, apply: (op: string) => void, scene: () => any, gl: () => any }} impl
 */
export function publish(name, impl) {
  /** @type {any} */ (window).bench = {
    name,
    ready: impl.ready,
    /** Runs an operation; resolves with milliseconds to the render that drew it. @param {string} op */
    run(op) {
      time(impl.gl());
      const start = performance.now();
      const drawn = new Promise(resolve => waiting.push(resolve));
      impl.apply(op);
      // timer: deadline, an operation that draws nothing fails the run.
      const late = new Promise((_, reject) => setTimeout(() => reject(new Error(`${name}: ${op} drew nothing within 10 s`)), 10000));
      return Promise.race([drawn, late]).then(t => /** @type {number} */ (t) - start);
    },
    /** The scene's meshes and a checksum of their colors and places, to validate each operation. */
    check() {
      /** @type {any[]} */
      const meshes = [];
      impl.scene().traverse((/** @type {any} */ o) => void (o.isMesh && meshes.push(o)));
      let sum = 0;
      for (const m of meshes) sum = (sum + m.material.color.getHex() * 31 + Math.round(m.position.x * 7 + m.position.y * 13)) % 1e9;
      return { meshes: meshes.length, sum };
    },
  };
}
