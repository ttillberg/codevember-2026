// The hillside around the hole: tussocks of grass on the bank and its brow, bare trodden dirt in front of the mouth.
import * as THREE from 'three';
import { Perlin, mulberry32 } from './noise';
import type { World } from './world';
import { grassMaterial, herbMaterial } from './gfx';

/** 0 on the trodden dirt in front of and around the mouth, 1 where grass grows. Mirrored in the soil shader. */
export function turf(x: number, y: number, z: number, n: number): number {
  // bare only on the lip of the hole itself: the grass has closed over the way in
  const d = Math.hypot(x, (y + 0.05) * 0.8, z);
  const r = 0.3 + 0.12 * n;
  return Math.min(1, Math.max(0, (d - r) / 0.2));
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
  const own = mulberry32(77);
  const blade = (x: number, z: number, h: number, w: number, bend: number, ang: number, tint: number): boolean => {
    const y0 = world.terrainH(x, z) + 0.45;
    o.set(x, y0, z);
    if (world.sample(x, y0, z) > -0.02) return false;
    const t = world.march(o, down, 1.2);
    if (t >= 1.2) return false;
    const y = y0 - t;
    if (turf(x, y, z, P.n(x * 2.1, 0.5, z * 2.1)) < 0.5) return false;
    // straight in front of the hole it is kept short by what goes in and out (and the hole is not hidden from where we start)
    if (z > 0.05) { const front = 1 - Math.min(1, Math.max(0, (Math.abs(x - 0.03) - 0.2) / 0.2)); h = Math.min(h, 0.07 + 0.06 * tint + (1 - front) * 0.5); }
    root.push(x, y - 0.01, z);
    shape.push(h, w, bend, ang);
    // (a die of its own: how many blades take must not move what is built after the grass)
    look.push(tint, own());
    return true;
  };
  // tussocks: long blades arching out of one crown. All over the bank, and thick in a ring round the hole itself,
  // where nothing treads and the dug earth is rich: the hole sits in a collar of grass
  for (let i = 0; i < 1250; i++) {
    let cx = -3.2 + rnd() * 6.2, cz = -2.4 + rnd() * 4.1;
    if (i >= 620) {
      const a = rnd() * Math.PI * 2, r = 0.45 + Math.abs(rnd() + rnd() - 1) * 1.25;
      cx = Math.cos(a) * r; cz = 0.05 + Math.sin(a) * r * 0.9;
    }
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
  for (let i = 0; i < 26000; i++) {
    let x = -3.2 + rnd() * 6.2, z = -2.4 + rnd() * 4.1;
    if (i >= 13000) {
      const a = rnd() * Math.PI * 2, r = 0.4 + Math.sqrt(rnd()) * 1.5;
      x = Math.cos(a) * r; z = 0.05 + Math.sin(a) * r * 0.9;
    }
    blade(x, z, 0.02 + rnd() * rnd() * 0.08, 0.0018 + rnd() * 0.002, 0.3 + rnd() * 1.4, rnd() * Math.PI * 2, rnd());
  }
  // and a sward of it over the way in, in front of the hole: short, thick, trodden rather than bare
  for (let i = 0; i < 16000; i++) {
    const x = -0.5 + own() * 1.05, z = 0.15 + own() * 1.6;
    blade(x, z, 0.03 + own() * 0.11, 0.002 + own() * 0.0025, 0.4 + own() * 1.5, own() * Math.PI * 2, own());
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

/**
 * Thin herbs and small flowers in the collar round the hole, some leaning in over it: every strip of every plant
 * (its stem, each leaf, each petal) one instance of one mesh. Hillside only; main.ts stops drawing it once we are in.
 */
export function buildHerbs(world: World, rnd: () => number): THREE.Mesh {
  const P = new Perlin(404);
  const SEG = 3;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    pos.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);

  const aRoot: number[] = [], aStem: number[] = [], aPart: number[] = [], aLook: number[] = [];
  const down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
  type Col = [number, number, number];
  const tone = (c: Col, v: number): Col => { const k = 1 - v + 2 * v * rnd(); return [c[0] * k, c[1] * k, c[2] * k]; };
  const WHITE: Col = [0.6, 0.6, 0.55], YELLOW: Col = [0.62, 0.43, 0.03], BLUE: Col = [0.17, 0.24, 0.62], PINK: Col = [0.56, 0.2, 0.36], EYE: Col = [0.55, 0.36, 0.03];

  let root: Col = [0, 0, 0], stem = [0, 0, 0, 0];
  const part = (at: number, len: number, w: number, ang: number, c: Col, kind: number) => {
    aRoot.push(...root); aStem.push(...stem); aPart.push(at, len, w, ang); aLook.push(c[0], c[1], c[2], kind);
  };
  /** a head of petals on the end of the stem (or wherever `at` says), with a middle to it if it is big enough to have one */
  const flower = (at: number, n: number, len: number, w: number, c: Col, eye: boolean) => {
    const a0 = rnd() * 6.28;
    for (let k = 0; k < n; k++) part(at, len * (0.85 + 0.3 * rnd()), w, a0 + (k / n) * 6.283 + (rnd() - 0.5) * 0.25, tone(c, 0.1), 2);
    if (eye) for (let k = 0; k < 5; k++) part(at, len * 0.32, len * 0.42, a0 + k * 1.257, tone(EYE, 0.15), 3);
  };
  /** One plant. False where nothing can grow: in the air, in the way out of the hole. */
  const plant = (x: number, z: number, kind: number, big: number, lean: number | null, rim = false): boolean => {
    const y0 = world.terrainH(x, z) + 0.45;
    o.set(x, y0, z);
    if (world.sample(x, y0, z) > -0.02) return false;
    const t = world.march(o, down, 1.2);
    if (t >= 1.2) return false;
    const y = y0 - t;
    // on the lip of the hole they stand in the bare dug earth, only not down in the hole itself, nor in the way in
    if (rim ? t > 0.53 || (z > 0.0 && Math.abs(x) < 0.2) : turf(x, y, z, P.n(x * 2.1, 0.5, z * 2.1)) < 0.3) return false;
    root = [x, y - 0.006, z];
    const green = tone([0.07 + 0.03 * rnd(), 0.125 + 0.03 * rnd(), 0.032], 0.2);
    const heading = lean ?? rnd() * 6.283;
    if (kind === 0) {
      // a creeping, leafy thing (speedwell, chickweed): pairs of small leaves up a weak stem, a little flower at the top
      const H = (0.05 + rnd() * 0.13) * big;
      stem = [H, 0.6 + rnd() * 1.3, heading, rnd()];
      part(-1, 0, 0.0013 * big, 0, tone(green, 0.1), 0);
      const n = Math.max(2, Math.round(H / 0.017));
      const a0 = rnd() * 6.28;
      for (let i = 0; i < n; i++) {
        const at = (i + 0.7) / (n + 0.4), len = (0.016 - 0.008 * at) * (0.7 + 0.6 * rnd()) * big;
        for (let k = 0; k < 2; k++) part(at, len, len * 0.55, a0 + i * 1.571 + k * 3.1416, tone(green, 0.15), 1);
      }
      if (rnd() < 0.6) flower(1, rnd() < 0.5 ? 4 : 5, 0.0045 + rnd() * 0.002, 0.004, rnd() < 0.55 ? BLUE : rnd() < 0.5 ? WHITE : PINK, false);
    } else if (kind === 1) {
      // a flower on a bare stalk out of a rosette: a daisy, or a buttercup
      const H = (0.07 + rnd() * 0.13) * big;
      stem = [H, 0.25 + rnd() * 0.7, heading, rnd()];
      part(-1, 0, 0.0014, 0, tone(green, 0.1), 0);
      const a0 = rnd() * 6.28, n = 5 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) { const len = (0.022 + rnd() * 0.03) * big; part(0.03, len, len * 0.32, a0 + k * 2.4, tone(green, 0.2), 1); }
      if (rnd() < 0.55) flower(1, 11 + Math.floor(rnd() * 6), 0.009 + rnd() * 0.004, 0.0032, WHITE, true);
      else flower(1, 5, 0.0075 + rnd() * 0.003, 0.0085, YELLOW, true);
    } else {
      // the thin one (a bedstraw): a wiry stem, whorls of needle leaves, a froth of tiny white at the top
      const H = Math.min(0.42, (0.1 + rnd() * 0.2) * big);
      stem = [H, 0.35 + rnd() * 1.1, heading, rnd()];
      part(-1, 0, 0.001 * big, 0, tone(green, 0.1), 0);
      const n = Math.max(3, Math.round(H / 0.028));
      for (let i = 0; i < n; i++) {
        const at = (i + 0.8) / (n + 0.6), a0 = rnd() * 6.28, m = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k < m; k++) part(at, (0.011 + rnd() * 0.009) * big * (1.1 - 0.4 * at), 0.0019 * big, a0 + (k / m) * 6.283, tone(green, 0.15), 1);
      }
      if (rnd() < 0.7) for (let k = 0; k < 4; k++) flower(0.9 + 0.1 * rnd(), 4, 0.0028, 0.0026, WHITE, false);
    }
    return true;
  };
  // they come in patches, a kind to a patch: most of them in the collar round the hole, a few out on the bank
  let plants = 0;
  for (let i = 0; i < 150; i++) {
    let cx = -3.0 + rnd() * 5.8, cz = -2.2 + rnd() * 3.8;
    let lean: number | null = null;
    if (i < 105) {
      const a = rnd() * Math.PI * 2, r = 0.42 + Math.abs(rnd() + rnd() - 1) * 0.95;
      cx = Math.cos(a) * r; cz = 0.05 + Math.sin(a) * r * 0.9;
      // on the brow and the sides of the hole they lean in over it
      if (r < 0.85 && rnd() < 0.7) lean = Math.atan2(0.05 - cz, -cx);
    }
    const kind = Math.floor(rnd() * 3), big = 0.7 + rnd() * 0.7;
    for (let k = 3 + Math.floor(rnd() * 6); k > 0; k--) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.09;
      if (plant(cx + Math.cos(a) * r, cz + Math.sin(a) * r, kind, big * (0.7 + 0.5 * rnd()), lean === null ? null : lean + (rnd() - 0.5) * 1.2)) plants++;
    }
  }
  // and right on the lip of the hole, all the way round but for the way in: the thin and the leafy ones, grown long,
  // leaning in over it. The hole is half hidden behind them; they part as we go through
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2, r = 0.3 + rnd() * rnd() * 0.3;
    const cx = Math.cos(a) * r, cz = -0.2 + Math.sin(a) * r;
    const lean = Math.atan2(-0.2 - cz, -cx);
    const kind = rnd() < 0.5 ? 2 : rnd() < 0.75 ? 0 : 1, big = 1.2 + rnd() * 0.9;
    for (let k = 3 + Math.floor(rnd() * 6); k > 0; k--) {
      const b = rnd() * 6.283, q = Math.sqrt(rnd()) * 0.07;
      if (plant(cx + Math.cos(b) * q, cz + Math.sin(b) * q, kind, big * (0.7 + 0.5 * rnd()), lean + (rnd() - 0.5) * 1.0, true)) plants++;
    }
  }
  g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(aRoot), 3));
  g.setAttribute('aStem', new THREE.InstancedBufferAttribute(new Float32Array(aStem), 4));
  g.setAttribute('aPart', new THREE.InstancedBufferAttribute(new Float32Array(aPart), 4));
  g.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 4));
  g.instanceCount = aRoot.length / 3;
  const mesh = new THREE.Mesh(g, herbMaterial());
  mesh.frustumCulled = false;
  console.log(`herbs: ${plants} plants, ${g.instanceCount} strips`);
  return mesh;
}
