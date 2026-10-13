// react-three-fiber: the same scene as its users write it: a Canvas that
// renders on demand, state in React, a keyed list of meshes over one shared
// geometry, each with its own material.

import * as THREE from 'three';
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OPS, place, publish } from './common.js';

const box = new THREE.BoxGeometry(0.8, 0.8, 0.8);
/** @type {(op: string) => void} */
let apply = () => {};
/** @type {any} */
let scene = null;
/** @type {any} */
let gl = null;
/** @type {() => void} */
let started = () => {};
const ready = new Promise(resolve => (started = /** @type {any} */ (resolve)));

function Scene() {
  const [rows, setRows] = useState(/** @type {{ id: number, color: number }[]} */ ([]));
  const three = useThree();
  useEffect(() => {
    scene = three.scene;
    gl = three.gl;
    apply = op => setRows(r => OPS[/** @type {keyof typeof OPS} */ (op)](r));
    started();
  }, []);
  // On-demand rendering: a committed change asks for a frame, as r3f's users
  // do (a removal alone does not).
  useEffect(() => three.invalidate(), [rows]);
  return rows.map((row, i) => (
    <mesh key={row.id} geometry={box} position={place(i)}>
      <meshBasicMaterial color={row.color} />
    </mesh>
  ));
}

createRoot(/** @type {HTMLElement} */ (document.getElementById('scene'))).render(
  <div style={{ width: 800, height: 600 }}>
    <Canvas frameloop="demand" dpr={1} gl={{ antialias: false }} flat camera={{ fov: 50, position: [0, 0, 40] }} scene={{ background: new THREE.Color('#101014') }}>
      <Scene />
    </Canvas>
  </div>,
);

publish('react-three-fiber', { ready, apply: op => apply(op), scene: () => scene, gl: () => gl });
