// The end of the labyrinth: a chamber with a bed of straw and leaves, and whoever dug all this lying at the back of
// it with a young one. Mostly they are two pairs of eyes: the torch is next to the lens, so their eyes hand it back.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from './world';
import { hideMaterial, eyeMaterial, hairMaterial, hairDepthMaterial, litterMaterial, litterDepthMaterial, depthMaterial } from './gfx';

// the animal, lying down, facing +z: ellipsoids melted together. cx cy cz rx ry rz
const BODY: number[][] = [
  [0, 0.19, -0.34, 0.21, 0.18, 0.37],
  [0, 0.17, -0.57, 0.2, 0.17, 0.2],
  [0, 0.185, -0.1, 0.19, 0.155, 0.16],
  // a broad flat skull and a square muzzle
  [0, 0.16, 0.14, 0.138, 0.098, 0.13],
  [0, 0.122, 0.236, 0.09, 0.062, 0.064],
  [0.135, 0.045, 0.1, 0.055, 0.05, 0.1],
  [-0.135, 0.045, 0.1, 0.055, 0.05, 0.1],
];
const EARS: number[][] = [
  [0.105, 0.262, 0.075, 0.032, 0.046, 0.018],
  [-0.105, 0.262, 0.075, 0.032, 0.046, 0.018],
];
const NOSE = new THREE.Vector3(0, 0.126, 0.298);
const CORE = new THREE.Vector3(0, 0.17, -0.12);

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
function sdf(x: number, y: number, z: number): number {
  let d = 1e9;
  for (const e of BODY) d = smin(d, (Math.hypot((x - e[0]) / e[3], (y - e[1]) / e[4], (z - e[2]) / e[5]) - 1) * Math.min(e[3], e[4], e[5]), 0.05);
  for (const e of EARS) d = smin(d, (Math.hypot((x - e[0]) / e[3], (y - e[1]) / e[4], (z - e[2]) / e[5]) - 1) * Math.min(e[3], e[4], e[5]), 0.018);
  return Math.max(d, -y); // it lies on the floor
}
function normalOf(p: THREE.Vector3, out: THREE.Vector3) {
  const e = 0.003;
  return out.set(sdf(p.x + e, p.y, p.z) - sdf(p.x - e, p.y, p.z), sdf(p.x, p.y + e, p.z) - sdf(p.x, p.y - e, p.z), sdf(p.x, p.y, p.z + e) - sdf(p.x, p.y, p.z - e)).normalize();
}
/** the surface, looking in from far out along a direction from a point inside */
function surface(from: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3) {
  let t = 1.3;
  for (let i = 0; i < 90; i++) {
    const s = sdf(from.x + d.x * t, from.y + d.y * t, from.z + d.z * t);
    if (s < 0.0006) break;
    t -= s * 0.7;
  }
  return out.copy(from).addScaledVector(d, t);
}

interface Animal { group: THREE.Group; open: { value: number }; blink: number; size: number; rest: THREE.Vector3; duck: number }

export class Den {
  group = new THREE.Group();
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];
  /** they stirred: somewhere for the roof to answer */
  onStir: (p: THREE.Vector3) => void = () => {};
  private animals: Animal[] = [];
  private woken = false;
  private stir = 0;

  constructor(private world: World, rnd: () => number, pixel: { value: number }) {
    const { c, back, floor } = world.den;
    const lat = new THREE.Vector3(back.z, 0, -back.x);
    const down = new THREE.Vector3(0, -1, 0);
    const floorAt = (x: number, z: number) => {
      const o = new THREE.Vector3(x, floor + 0.35, z);
      if (world.sample(o.x, o.y, o.z) > -0.02) return NaN;
      const t = world.march(o, down, 0.8);
      return t >= 0.8 ? NaN : o.y - t;
    };

    // ---- the body: an icosphere shrunk onto the melted ellipsoids ----
    let body: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 40);
    body.deleteAttribute('uv');
    body.deleteAttribute('normal');
    body = mergeVertices(body, 1e-4);
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    const nrm = new Float32Array(pos.count * 3);
    const d = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      surface(CORE, d, p);
      normalOf(p, n);
      pos.setXYZ(i, p.x, p.y, p.z);
      nrm.set([n.x, n.y, n.z], i * 3);
    }
    body.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    body.computeBoundingSphere();

    // ---- eyes: set where the skull says, looking a little outward ----
    const eyes: { p: THREE.Vector3; fwd: THREE.Vector3 }[] = [];
    for (const sx of [1, -1]) {
      const from = new THREE.Vector3(0, 0.16, 0.14);
      d.set(sx * 0.6, 0.34, 0.72).normalize();
      surface(from, d, p);
      normalOf(p, n);
      eyes.push({ p: p.clone().addScaledVector(n, -0.004), fwd: n.clone().multiplyScalar(0.55).add(new THREE.Vector3(sx * 0.1, 0.05, 0.75)).normalize() });
    }

    // ---- fur: short strands, lying back from the nose ----
    const idx = body.index!.array;
    const tris = idx.length / 3;
    const cum = new Float32Array(tris);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), flow = new THREE.Vector3(), q = new THREE.Vector3();
    let total = 0;
    for (let t = 0; t < tris; t++) {
      a.fromBufferAttribute(pos, idx[t * 3]); b.fromBufferAttribute(pos, idx[t * 3 + 1]); cc.fromBufferAttribute(pos, idx[t * 3 + 2]);
      total += b.sub(a).cross(cc.sub(a)).length() * 0.5;
      cum[t] = total;
    }
    const STRANDS = 44000, PTS = 3;
    const fp = new Float32Array(STRANDS * PTS * 6), ft = new Float32Array(STRANDS * PTS * 6), fs = new Float32Array(STRANDS * PTS * 2), fw = new Float32Array(STRANDS * PTS * 2), fseed = new Float32Array(STRANDS * PTS * 2);
    const fidx: number[] = [];
    let made = 0;
    for (let guard = 0; made < STRANDS && guard < STRANDS * 3; guard++) {
      const r = rnd() * total;
      let lo = 0, hi = tris - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      a.fromBufferAttribute(pos, idx[lo * 3]); b.fromBufferAttribute(pos, idx[lo * 3 + 1]); cc.fromBufferAttribute(pos, idx[lo * 3 + 2]);
      p.copy(a).addScaledVector(b.sub(a), u).addScaledVector(cc.sub(a), v);
      if (p.y < 0.012 || p.distanceTo(NOSE) < 0.03 || eyes.some((e) => e.p.distanceTo(p) < 0.017)) continue;
      normalOf(p, n);
      // away from the nose along the hide, and a little down with its own weight
      flow.copy(p).sub(NOSE);
      flow.addScaledVector(n, -flow.dot(n)).normalize();
      const face = Math.min(1, Math.max(0, (p.z - 0.02) / 0.2));
      const len = (0.02 + rnd() * 0.022) * (1 - 0.6 * face);
      d.copy(n).multiplyScalar(0.22).addScaledVector(flow, 0.9).add(q.set(rnd() - 0.5, rnd() - 0.5 - 0.2, rnd() - 0.5).multiplyScalar(0.3)).normalize();
      const seed = rnd(), w = 0.0005 + rnd() * 0.0006;
      q.copy(p).addScaledVector(n, -0.002);
      for (let k = 0; k < PTS; k++) {
        const i = made * PTS + k;
        for (let s = 0; s < 2; s++) {
          fp.set([q.x, q.y, q.z], (i * 2 + s) * 3);
          ft.set([d.x, d.y, d.z], (i * 2 + s) * 3);
          fs[i * 2 + s] = s ? 1 : -1;
          fw[i * 2 + s] = w * (1 - 0.7 * (k / (PTS - 1)));
          fseed[i * 2 + s] = seed;
        }
        if (k < PTS - 1) fidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        q.addScaledVector(d, len / (PTS - 1));
        d.y -= 0.18; d.addScaledVector(n, -0.2).normalize();
      }
      made++;
    }
    const fur = new THREE.BufferGeometry();
    fur.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fur.setAttribute('aTan', new THREE.BufferAttribute(ft, 3));
    fur.setAttribute('aSide', new THREE.BufferAttribute(fs, 1));
    fur.setAttribute('aW', new THREE.BufferAttribute(fw, 1));
    fur.setAttribute('aSeed', new THREE.BufferAttribute(fseed, 1));
    fur.setIndex(new THREE.BufferAttribute(new Uint32Array(fidx), 1));

    const hide = hideMaterial(NOSE);
    // grizzled: dark underfur, a share of pale guard hairs
    const furMat = hairMaterial(pixel, new THREE.Vector3(0.008, 0.0065, 0.0055), new THREE.Vector3(0.028, 0.023, 0.019));
    const furDepth = hairDepthMaterial();
    const bodyDepth = depthMaterial();
    const eyeGeo = new THREE.SphereGeometry(0.0105, 16, 12);

    const animal = (at: THREE.Vector3, yaw: number, size: number): Animal => {
      const g = new THREE.Group();
      const open = { value: 1 };
      const m = new THREE.Mesh(body, hide);
      const f = new THREE.Mesh(fur, furMat);
      m.frustumCulled = f.frustumCulled = false;
      g.add(m, f);
      for (const e of eyes) {
        const eye = new THREE.Mesh(eyeGeo, eyeMaterial(e.fwd, open));
        eye.position.copy(e.p);
        eye.frustumCulled = false;
        g.add(eye);
      }
      g.position.copy(at);
      g.rotation.y = yaw;
      g.scale.setScalar(size);
      this.group.add(g);
      this.casters.push({ obj: m, depth: bodyDepth }, { obj: f, depth: furDepth });
      return { group: g, open, blink: 1.5 + rnd() * 3, size, rest: at.clone(), duck: 0 };
    };

    // the old one at the back, facing the way we come; the young one tucked in against her flank
    const facing = Math.atan2(-back.x, -back.z);
    const W = c.clone().addScaledVector(back, 0.42).addScaledVector(lat, -0.1);
    W.y = (floorAt(W.x, W.z) || floor) + 0.035;
    this.animals.push(animal(W, facing + 0.18, 1));
    const J = c.clone().addScaledVector(back, 0.3).addScaledVector(lat, 0.34);
    J.y = (floorAt(J.x, J.z) || floor) + 0.03;
    this.animals.push(animal(J, facing - 0.12, 0.46));

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
    console.log(`den: ${pos.count} body vertices, ${made} fur strands, ${lg.instanceCount} pieces of bedding`);
  }

  /** How far along a ray until it meets one of them (Infinity if it misses): the light meter needs to know. */
  hit(o: THREE.Vector3, d: THREE.Vector3): number {
    let best = Infinity;
    const c = new THREE.Vector3();
    for (const a of this.animals) {
      c.set(0, 0.17, -0.1).multiplyScalar(a.size).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.group.rotation.y).add(a.rest).sub(o);
      const along = c.dot(d), r = 0.3 * a.size;
      const off2 = c.lengthSq() - along * along;
      if (along > 0 && off2 < r * r) best = Math.min(best, along - Math.sqrt(r * r - off2));
    }
    return best;
  }

  update(dt: number, time: number, eye: THREE.Vector3) {
    const dist = eye.distanceTo(this.world.den.c);
    this.group.visible = dist < 9;
    if (!this.group.visible) return;
    // the moment we come round into the chamber: a start, and the roof answers
    if (!this.woken && dist < 1.75) {
      this.woken = true;
      this.stir = 1;
      const p = this.world.den.c.clone();
      p.y += 0.42;
      this.onStir(p);
    }
    this.stir = Math.max(0, this.stir - dt * 0.9);
    const jolt = Math.sin(Math.min(1, 1 - this.stir) * Math.PI) * (this.stir > 0 ? 1 : 0);
    this.animals.forEach((a, i) => {
      // breathing: slow for the old one, quick for the young
      const br = Math.sin(time * (i ? 3.1 : 1.7) + i * 2);
      a.group.scale.set(a.size * (1 + 0.012 * br), a.size * (1 + 0.018 * br), a.size);
      // the young one shrinks down behind the heap once it has been seen; the old one only lifts her head a little
      if (i && this.woken) a.duck = Math.min(1, a.duck + dt * 0.7);
      a.group.position.copy(a.rest);
      a.group.position.y += i ? -0.035 * a.duck : 0.012 * jolt;
      a.group.rotation.x = i ? 0.1 * a.duck : -0.05 * jolt;
      a.blink -= dt;
      if (a.blink < -0.16) a.blink = 2 + Math.random() * 5;
      a.open.value = a.blink < 0 ? Math.abs(a.blink + 0.08) / 0.08 : 1;
    });
  }
}
