// ren-three: the scene in JSX, a keyed For of meshes over one shared
// geometry, each with its own material; renders on the frame after a change.

import * as THREE from 'three';
import { $signal, $read, $write } from 'rrx-core';
import { Root, For, $active } from 'ren-core';
import { $three } from 'ren-three';
import { OPS, place, publish } from './common.js';

const box = new THREE.BoxGeometry(0.8, 0.8, 0.8);
const three = $three(THREE, { width: 800, height: 600, scale: 1, camera: { fov: 50, position: [0, 0, 40] }, background: '#101014', renderer: canvas => new THREE.WebGLRenderer({ canvas, antialias: false }) });
/** @type {any} */
let rows = null;
Root({
  id: 'bench',
  target: /** @type {HTMLElement} */ (document.getElementById('scene')),
  renderer: three,
  storage: null,
  locks: null,
  children: () => {
    rows = $signal($active(), /** @type {{ id: number, color: number }[]} */ ([]));
    return (
      <For each={rows} by={row => row.id}>
        {(row, i) => (
          <mesh geometry={box} position={() => place(i())}>
            <meshBasicMaterial color={() => row().color} />
          </mesh>
        )}
      </For>
    );
  },
});

publish('ren-three', {
  ready: Promise.resolve(),
  apply: op => $write(rows, OPS[/** @type {keyof typeof OPS} */ (op)]($read(rows))),
  scene: () => three.scene,
  gl: () => three.drawer,
});
