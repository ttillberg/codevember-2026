// The hillside around the hole: tussocks of grass on the bank and its brow, bare trodden dirt in front of the mouth.
import * as THREE from 'three';
import { Perlin } from './noise';
import type { World } from './world';
import { grassMaterial } from './gfx';

/** 0 on the trodden dirt in front of and around the mouth, 1 where grass grows. Mirrored in the soil shader. */
export function turf(x: number, y: number, z: number, n: number): number {
  // the path out of the hole: a segment from the mouth down the apron
  const t = Math.min(1, Math.max(0, z / 1.8));
  const d = Math.hypot(x - 0.05 * t, (y - (-0.05 - 0.2 * t)) * 0.8, z - 1.8 * t);
  const r = 0.62 + 0.25 * t + 0.3 * n;
  return Math.min(1, Math.max(0, (d - r) / 0.25));
}

export function buildGrass(world: World, rnd: () => number): THREE.Mesh {
  const P = new Perlin(404);
  const SEG = 5;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    pos.push(-0.5, t, 0, 0.5, t, 0);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);

  const root: number[] = [], shape: number[] = [], look: number[] = [];
  const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
  const blade = (x: number, z: number, h: number, w: number, bend: number, ang: number, tint: number): boolean => {
    const y0 = world.terrainH(x, z) + 0.45;
    o.set(x, y0, z);
    if (world.sample(x, y0, z) > -0.02) return false;
    const t = world.march(o, down, 1.2);
    if (t >= 1.2) return false;
    const y = y0 - t;
    if (turf(x, y, z, P.n(x * 2.1, 0.5, z * 2.1)) < 0.5) return false;
    root.push(x, y - 0.01, z);
    shape.push(h, w, bend, ang);
    look.push(tint, rnd());
    return true;
  };
  // tussocks: long blades arching out of one crown
  for (let i = 0; i < 520; i++) {
    const cx = -3.2 + rnd() * 6.2, cz = -2.4 + rnd() * 4.1;
    const big = 0.5 + rnd();
    const n = Math.round(26 + rnd() * 40);
    const tint = rnd();
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * rnd() * 0.07 * big;
      // blades lean out from the crown, and all a little downhill
      blade(cx + Math.cos(a) * r, cz + Math.sin(a) * r, (0.06 + rnd() * 0.26) * big, 0.003 + rnd() * 0.0045, 0.5 + rnd() * 1.7, Math.atan2(Math.sin(a) + 0.5, Math.cos(a)) + (rnd() - 0.5) * 0.8, tint * 0.7 + rnd() * 0.3);
    }
  }
  // and the short stuff between
  for (let i = 0; i < 9000; i++) {
    const x = -3.2 + rnd() * 6.2, z = -2.4 + rnd() * 4.1;
    blade(x, z, 0.02 + rnd() * rnd() * 0.08, 0.0018 + rnd() * 0.002, 0.3 + rnd() * 1.4, rnd() * Math.PI * 2, rnd());
  }
  g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(root), 3));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4));
  g.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(look), 2));
  const n = root.length / 3;
  g.instanceCount = n;
  const mesh = new THREE.Mesh(g, grassMaterial());
  mesh.frustumCulled = false;
  console.log(`grass: ${n} blades`);
  return mesh;
}
