// The end of the first level: a chamber with a bed of straw and leaves, heaped and pressed into a hollow. Whoever
// made it is not in it. (There were two here once, an old one and a young one; then something else moved in below.)
import * as THREE from 'three';
import type { World } from './world';
import { litterMaterial, litterDepthMaterial } from './gfx';


export class Den {
  group = new THREE.Group();
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];

  constructor(private world: World, rnd: () => number) {
    const { c, back, floor } = world.den;
    const down = new THREE.Vector3(0, -1, 0);
    const floorAt = (x: number, z: number) => {
      const o = new THREE.Vector3(x, floor + 0.35, z);
      if (world.sample(o.x, o.y, o.z) > -0.02) return NaN;
      const t = world.march(o, down, 0.8);
      return t >= 0.8 ? NaN : o.y - t;
    };


    // ---- the bed ----
    const SEG = 4;
    const lp: number[] = [], li: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      lp.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
      if (i < SEG) { const k = i * 2; li.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    lg.setIndex(li);
    const aPos: number[] = [], aDir: number[] = [], aUp: number[] = [], aShape: number[] = [], aLook: number[] = [];
    const piece = (x: number, z: number, lift: number, leaf: boolean, exposed: number) => {
      const y = floorAt(x, z);
      if (Number.isNaN(y)) return;
      const yaw = rnd() * Math.PI * 2, tilt = (rnd() - 0.5) * (leaf ? 0.5 : 0.7);
      aPos.push(x, y + 0.004 + lift, z);
      aDir.push(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
      aUp.push((rnd() - 0.5) * 0.9, 1, (rnd() - 0.5) * 0.9);
      if (leaf) aShape.push(0.06 + rnd() * 0.07, 0.011 + rnd() * 0.012, (rnd() - 0.5) * 0.9, 1);
      else aShape.push(0.07 + rnd() * rnd() * 0.25, 0.0012 + rnd() * 0.0022, (rnd() - 0.5) * 0.7, 0);
      aLook.push(rnd(), exposed);
    };
    // heaped under and in front of them, thinning out across the floor and a little way back up the tunnel
    const heap = c.clone().addScaledVector(back, 0.15);
    for (let i = 0; i < 5200; i++) {
      const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.95 * (0.35 + 0.65 * rnd());
      const mound = 0.085 * Math.exp(-((r / 0.42) ** 2));
      const h = rnd();
      piece(heap.x + Math.cos(ang) * r, heap.z + Math.sin(ang) * r * 1.15, mound * h, rnd() < 0.09, 0.35 + 0.65 * h);
    }
    for (let i = 0; i < 160; i++) {
      const t = rnd() * rnd() * 1.6;
      piece(c.x - back.x * (0.9 + t) + (rnd() - 0.5) * 0.3, c.z - back.z * (0.9 + t) + (rnd() - 0.5) * 0.3, rnd() * 0.01, rnd() < 0.25, 0.8);
    }
    lg.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(aPos), 3));
    lg.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(aDir), 3));
    lg.setAttribute('aUp', new THREE.InstancedBufferAttribute(new Float32Array(aUp), 3));
    lg.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(aShape), 4));
    lg.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 2));
    lg.instanceCount = aPos.length / 3;
    const litter = new THREE.Mesh(lg, litterMaterial());
    litter.frustumCulled = false;
    this.group.add(litter);
    this.casters.push({ obj: litter, depth: litterDepthMaterial() });
    console.log(`den: ${lg.instanceCount} pieces of bedding`);
  }

  update(eye: THREE.Vector3) {
    this.group.visible = eye.distanceTo(this.world.den.c) < 9;
  }
}

/**
 * What lies about on the floors of the runs: bits of root and twig, husks, and near the mouth the leaves the wind
 * has pushed in. The same bent strips as the bedding, only scattered thin and dirty.
 */
export function buildDebris(world: World, rnd: () => number): { mesh: THREE.Mesh; depth: THREE.Material } {
  const SEG = 3;
  const lp: number[] = [], li: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    lp.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
    if (i < SEG) { const k = i * 2; li.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  g.setIndex(li);
  const aPos: number[] = [], aDir: number[] = [], aUp: number[] = [], aShape: number[] = [], aLook: number[] = [];
  const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), n = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  for (const e of world.edges) {
    if (e.open) continue;
    for (let i = Math.round(e.len * 75); i > 0; i--) {
      const s = rnd() * e.len;
      world.railPoint(e, s, c);
      world.railTangent(e, s, T);
      side.crossVectors(T, up).normalize();
      // most of it has been swept to the sides by whoever runs here
      const off = (rnd() < 0.5 ? -1 : 1) * (0.05 + Math.sqrt(rnd()) * 0.24);
      c.addScaledVector(side, off);
      if (world.sample(c.x, c.y, c.z) > -0.02) continue;
      const t = world.march(c, down, 0.6);
      if (t >= 0.6) continue;
      c.y -= t;
      world.normalAt(c.x, c.y, c.z, n);
      if (n.y < 0.35) continue;
      // how far in we are: leaves do not get far
      const depth = c.distanceTo(world.entrance);
      const leaf = rnd() < 0.3 * Math.exp(-depth / 1.8);
      const yaw = rnd() * Math.PI * 2, tilt = (rnd() - 0.5) * 0.35;
      aPos.push(c.x, c.y + 0.003 + rnd() * 0.004, c.z);
      // lying along the floor, whatever way it slopes
      const d = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      d.addScaledVector(n, -d.dot(n)).normalize().addScaledVector(n, tilt).normalize();
      aDir.push(d.x, d.y, d.z);
      aUp.push(n.x + (rnd() - 0.5) * 0.5, n.y, n.z + (rnd() - 0.5) * 0.5);
      if (leaf) aShape.push(0.05 + rnd() * 0.06, 0.01 + rnd() * 0.011, (rnd() - 0.5) * 0.8, 1);
      else aShape.push(0.015 + rnd() * rnd() * 0.11, 0.0011 + rnd() * 0.0028, (rnd() - 0.5) * 0.9, 0);
      // (dirty: it has been lying in this)
      aLook.push(rnd(), 0.4 + rnd() * 0.45);
    }
  }
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(aPos), 3));
  g.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(aDir), 3));
  g.setAttribute('aUp', new THREE.InstancedBufferAttribute(new Float32Array(aUp), 3));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(aShape), 4));
  g.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 2));
  g.instanceCount = aPos.length / 3;
  const mesh = new THREE.Mesh(g, litterMaterial());
  mesh.frustumCulled = false;
  console.log(`debris: ${g.instanceCount} bits on the floors`);
  return { mesh, depth: litterDepthMaterial() };
}
