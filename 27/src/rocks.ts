// Stones: eight ways of cutting, wearing or growing a ball, of six kinds of rock, set into the walls (the soil closes
// around them) in seams of one sort with rubble round the big ones, and scattered loose on the floor. The loose ones get shoved along as we crawl; the set ones shift in their sockets.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Perlin } from './noise';
import type { World } from './world';
import { rockMaterial } from './gfx';

/** The kinds of stone the shader knows (gfx.ts): what it is made of. */
const GRANITE = 0, SANDSTONE = 1, SLATE = 2, QUARTZ = 3, IRONSTONE = 4, FLINT = 5;

/** A way a stone can be shaped: how many cuts, how deep, how worn, how stretched, and what it is likely made of. */
interface Style { planes: number; h: [number, number]; k: number; sx: [number, number]; sy: [number, number]; sz: [number, number]; lump: number; split?: number; kinds: number[] }
const STYLES: Style[] = [
  // blocks: a handful of cuts, edges still sharp
  { planes: 9, h: [0.62, 1], k: 34, sx: [0.9, 1.15], sy: [0.65, 0.9], sz: [0.8, 1.1], lump: 0.07, kinds: [GRANITE, GRANITE, IRONSTONE, SANDSTONE] },
  // many small faces
  { planes: 14, h: [0.72, 1], k: 40, sx: [0.85, 1.1], sy: [0.7, 1], sz: [0.85, 1.1], lump: 0.05, kinds: [GRANITE, IRONSTONE, SANDSTONE] },
  // cobbles: something a river once had
  { planes: 16, h: [0.82, 1], k: 9, sx: [0.9, 1.15], sy: [0.7, 0.9], sz: [0.85, 1.1], lump: 0.04, kinds: [GRANITE, QUARTZ, IRONSTONE, GRANITE] },
  // slabs: split along their bedding
  { planes: 10, h: [0.6, 1], k: 32, sx: [1.1, 1.3], sy: [0.28, 0.42], sz: [0.85, 1.1], lump: 0.03, kinds: [SLATE, SLATE, SANDSTONE] },
  // shards: long, thin, a few hard cuts
  { planes: 7, h: [0.5, 0.95], k: 44, sx: [1.4, 1.7], sy: [0.45, 0.6], sz: [0.6, 0.8], lump: 0.04, kinds: [SLATE, FLINT, GRANITE] },
  // nodules: no cuts at all, grown in lumps
  { planes: 0, h: [1, 1], k: 10, sx: [0.9, 1.1], sy: [0.75, 0.95], sz: [0.9, 1.1], lump: 0.24, kinds: [FLINT, IRONSTONE, FLINT] },
  // a cobble broken in two: one clean face
  { planes: 14, h: [0.8, 1], k: 24, sx: [0.9, 1.1], sy: [0.75, 0.95], sz: [0.85, 1.1], lump: 0.05, split: 0.2, kinds: [QUARTZ, FLINT, GRANITE] },
  // wedges: three or four big cuts
  { planes: 6, h: [0.45, 0.8], k: 46, sx: [0.9, 1.2], sy: [0.6, 0.9], sz: [0.8, 1.1], lump: 0.06, kinds: [GRANITE, SANDSTONE, SLATE] },
];

function boulder(seed: number, detail: number, rnd: () => number, st: Style = STYLES[0]): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const P = new Perlin(seed);
  const planes: [THREE.Vector3, number][] = [];
  for (let i = 0; i < st.planes; i++) {
    const n = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    planes.push([n, st.h[0] + rnd() * (st.h[1] - st.h[0])]);
  }
  if (st.split) planes.push([new THREE.Vector3(rnd() - 0.5, 0.3 + rnd(), rnd() - 0.5).normalize(), st.split]);
  const pick = (r: [number, number]) => r[0] + rnd() * (r[1] - r[0]);
  const sx = pick(st.sx), sy = pick(st.sy), sz = pick(st.sz);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  const k = st.k;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    // a soft minimum over the cutting planes: flat faces, and edges as worn as the style says
    let acc = Math.exp(-k * 0.88);
    for (const [n, h] of planes) {
      const c = d.dot(n);
      if (c > 0.05) acc += Math.exp((-k * h) / c);
    }
    let r = -Math.log(acc) / k;
    r *= 1 + st.lump * P.n(d.x * 2.4, d.y * 2.4, d.z * 2.4) + st.lump * 0.4 * P.n(d.x * 7 + 3, d.y * 7, d.z * 7);
    pos.setXYZ(i, d.x * r * sx, d.y * r * sy, d.z * r * sz);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

interface Set { c: THREE.Vector3; q: THREE.Quaternion; s: number; axis: THREE.Vector3; ang: number; vel: number; loose: number; shed: number; mesh: number; kind: number; slot: number }

export class Rocks {
  meshes: THREE.InstancedMesh[] = [];
  pebbles!: THREE.InstancedMesh;
  sets: Set[] = [];
  private peb!: { p: Float32Array; v: Float32Array; s: Float32Array; q: THREE.Quaternion[]; awake: Uint8Array; n: number };
  /** called when a stone shifts: somewhere for the dirt above it to come down from */
  onShift: (p: THREE.Vector3, amount: number) => void = () => {};

  /** Chooses where the stones go and closes the soil around them. Call before the ground is meshed. */
  constructor(private world: World, rnd: () => number) {
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3(), dir = new THREE.Vector3();
    const place = (center: THREE.Vector3, d: THREE.Vector3, R: number, embed: number, open: boolean): boolean => {
      const t = world.march(center, d, 1.4);
      if (t >= 1.4) return false;
      if (!open) {
        // leave room to crawl past
        const reach = t - R * (1 - embed);
        if (reach < 0.25) embed = Math.min(0.9, 1 - (t - 0.25) / R);
        if (t - R * (1 - embed) < 0.24) return false;
      }
      const pos = center.clone().addScaledVector(d, t + R * embed);
      for (const s of this.sets) if (s.c.distanceTo(pos) < (s.s + R) * 0.8) return false;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3));
      // a seam of stones tends to be of one sort: neighbours often share their shape and what they are made of
      const near = this.sets.length && rnd() < 0.45 ? this.sets[this.sets.length - 1] : null;
      const mesh = near && rnd() < 0.6 ? near.mesh : Math.floor(rnd() * STYLES.length);
      const kinds = STYLES[mesh].kinds;
      const kind = near && near.mesh === mesh ? near.kind : kinds[Math.floor(rnd() * kinds.length)];
      this.sets.push({
        c: pos, q, s: R, axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), ang: 0, vel: 0,
        loose: R < 0.13 && rnd() < 0.5 ? 0.5 + rnd() * 0.5 : 0.12, shed: 0, mesh, kind, slot: 0,
      });
      // (a flat stone sits less deep in the soil than a round one)
      world.stampRock(pos, R * 0.9 * Math.min(1, 0.55 + STYLES[mesh].sy[0] * 0.6));
      return true;
    };
    for (const e of world.edges) {
      if (e.open) continue;
      const count = Math.round(e.len * 2.1);
      for (let i = 0; i < count; i++) {
        const s = 0.25 + rnd() * (e.len - 0.5);
        world.railPoint(e, s, c);
        world.railTangent(e, s, T);
        side.crossVectors(T, up).normalize();
        up2.crossVectors(side, T);
        // mostly low in the walls and at the edge of the floor, now and then overhead
        const phi = (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.18 ? rnd() * 0.8 : 1.0 + rnd() * 1.6);
        dir.copy(up2).multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
        // mostly fist-sized, some the size of a head, now and then one that half blocks the way
        const u = rnd();
        const R = u < 0.05 ? 0.3 + rnd() * 0.14 : u < 0.25 ? 0.17 + rnd() * 0.13 : 0.035 + rnd() * 0.11;
        if (!place(c, dir, R, 0.2 + rnd() * 0.4, false) || rnd() > 0.4) continue;
        // and where one came to rest, others did: a little rubble round it
        for (let k = 2 + Math.floor(rnd() * 4); k > 0; k--) {
          world.railPoint(e, s + (rnd() - 0.5) * (R * 3 + 0.2), c);
          const p2 = phi + (rnd() - 0.5) * (0.5 + R * 2);
          dir.copy(up2).multiplyScalar(Math.cos(p2)).addScaledVector(side, Math.sin(p2));
          place(c, dir, 0.025 + rnd() * 0.07, 0.15 + rnd() * 0.45, false);
        }
      }
    }
    // by the mouth, under the sky
    for (const [x, z, R] of [[-0.78, 0.42, 0.24], [0.86, 0.3, 0.17], [0.55, 0.78, 0.1], [-0.42, 0.85, 0.07], [1.25, -0.1, 0.2], [-1.3, 0.05, 0.14]]) {
      c.set(x, world.terrainH(x, z) + 0.5, z);
      place(c, dir.set(0, -1, 0), R, 0.25 + rnd() * 0.3, true);
    }
  }

  /** Builds the meshes. Call after the ground is meshed (the pebbles lie on it). */
  build(rnd: () => number): THREE.InstancedMesh[] {
    const world = this.world;
    const mat = rockMaterial();
    const geos = STYLES.map((st, i) => boulder(11 + i, 14, rnd, st));
    const m = new THREE.Matrix4(), one = new THREE.Vector3();
    geos.forEach((g, gi) => {
      const list = this.sets.filter((s) => s.mesh === gi);
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      const tint = new Float32Array(list.length), open = new Float32Array(list.length), kind = new Float32Array(list.length);
      list.forEach((s, i) => {
        s.slot = i;
        mesh.setMatrixAt(i, m.compose(s.c, s.q, one.setScalar(s.s)));
        tint[i] = rnd();
        open[i] = s.c.z > -0.45 ? 1 : 0;
        kind[i] = s.kind;
      });
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
      g.setAttribute('aOpen', new THREE.InstancedBufferAttribute(open, 1));
      g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
    });

    // loose stones on the floor
    const pg = boulder(21, 4, rnd, STYLES[2]);
    const list: { p: THREE.Vector3; s: number }[] = [];
    const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
    for (const e of world.edges) {
      const count = Math.round(e.len * (e.open ? 24 : 30));
      for (let i = 0; i < count; i++) {
        const s = rnd() * e.len;
        world.railPoint(e, s, c);
        world.railTangent(e, s, T);
        side.crossVectors(T, up).normalize();
        c.addScaledVector(side, (rnd() * 2 - 1) * (e.open ? 0.8 : 0.24));
        if (world.sample(c.x, c.y, c.z) > -0.02) continue;
        const t = world.march(c, down, 1.2);
        if (t >= 1.2) continue;
        const size = 0.005 + rnd() * rnd() * rnd() * 0.04;
        list.push({ p: new THREE.Vector3(c.x, c.y - t + size * 0.2, c.z), s: size });
      }
    }
    const n = list.length;
    this.pebbles = new THREE.InstancedMesh(pg, mat, n);
    const tint = new Float32Array(n), open = new Float32Array(n), pkind = new Float32Array(n);
    this.peb = { p: new Float32Array(n * 3), v: new Float32Array(n * 3), s: new Float32Array(n), q: [], awake: new Uint8Array(n), n };
    list.forEach((it, i) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3));
      this.peb.q.push(q);
      this.peb.p.set([it.p.x, it.p.y, it.p.z], i * 3);
      this.peb.s[i] = it.s;
      this.pebbles.setMatrixAt(i, m.compose(it.p, q, one.setScalar(it.s)));
      tint[i] = rnd();
      open[i] = it.p.z > -0.3 ? 1 : 0;
    });
    pg.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    pg.setAttribute('aOpen', new THREE.InstancedBufferAttribute(open, 1));
    // (loose stones are a mixed lot: whatever came out of the walls)
    for (let i = 0; i < n; i++) pkind[i] = [GRANITE, GRANITE, IRONSTONE, QUARTZ, FLINT, SANDSTONE, SLATE][Math.floor(rnd() * 7)];
    pg.setAttribute('aKind', new THREE.InstancedBufferAttribute(pkind, 1));
    this.pebbles.frustumCulled = false;
    this.pebbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return [...this.meshes, this.pebbles];
  }

  update(dt: number, eye: THREE.Vector3, move: THREE.Vector3, speed: number) {
    const m = new THREE.Matrix4(), one = new THREE.Vector3(), q = new THREE.Quaternion(), dq = new THREE.Quaternion(), p = new THREE.Vector3();
    // set stones: nudged when we squeeze past, they rock back on a stiff spring and let some dirt go
    const dirty = this.meshes.map(() => false);
    for (const s of this.sets) {
      const d = s.c.distanceTo(eye);
      const near = d < s.s + 0.42;
      if (near && speed > 0.05) {
        s.vel += s.loose * speed * dt * 22 * (1 - (d - s.s) / 0.42);
        if (s.shed <= 0 && s.loose > 0.3) { s.shed = 4 + Math.random() * 5; this.onShift(p.copy(s.c).setY(s.c.y + s.s * 0.7), s.loose); }
      }
      s.shed -= dt;
      if (Math.abs(s.ang) < 1e-5 && Math.abs(s.vel) < 1e-4) continue;
      s.vel += (-s.ang * 260 - s.vel * 9) * dt;
      s.ang += s.vel * dt;
      s.ang = Math.max(-0.09, Math.min(0.09, s.ang));
      dq.setFromAxisAngle(s.axis, s.ang);
      q.copy(dq).multiply(s.q);
      p.copy(s.c).addScaledVector(move, s.ang * s.s * 0.5);
      this.meshes[s.mesh].setMatrixAt(s.slot, m.compose(p, q, one.setScalar(s.s)));
      dirty[s.mesh] = true;
    }
    dirty.forEach((d, i) => { if (d) this.meshes[i].instanceMatrix.needsUpdate = true; });

    // loose stones: pushed ahead and aside by hands and knees
    const pb = this.peb;
    const world = this.world;
    let any = false;
    const floorY = eye.y - 0.2;
    for (let i = 0; i < pb.n; i++) {
      const j = i * 3;
      const dx = pb.p[j] - eye.x, dz = pb.p[j + 2] - eye.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.2 * 0.2 && speed > 0.05 && Math.abs(pb.p[j + 1] - floorY) < 0.25) {
        const d = Math.sqrt(d2) + 1e-4;
        const push = (1 - d / 0.2) * speed * dt * (0.8 + 0.02 / pb.s[i]);
        pb.v[j] += ((dx / d) * 0.5 + move.x) * push * 6;
        pb.v[j + 2] += ((dz / d) * 0.5 + move.z) * push * 6;
        pb.awake[i] = 1;
      }
      if (!pb.awake[i]) continue;
      const vx = pb.v[j], vz = pb.v[j + 2];
      const sp = Math.hypot(vx, vz);
      if (sp < 0.004) { pb.awake[i] = 0; pb.v[j] = pb.v[j + 2] = 0; continue; }
      pb.p[j] += vx * dt; pb.p[j + 2] += vz * dt;
      // stay on the floor: find it again under the new spot
      p.set(pb.p[j], pb.p[j + 1] + 0.06, pb.p[j + 2]);
      const a = world.sample(p.x, p.y, p.z);
      if (a > -0.01) { pb.p[j] -= vx * dt; pb.p[j + 2] -= vz * dt; pb.v[j] *= -0.3; pb.v[j + 2] *= -0.3; }
      else pb.p[j + 1] = p.y - world.march(p, one.set(0, -1, 0), 0.3) + pb.s[i] * 0.3;
      const f = Math.exp(-dt * 5.5);
      pb.v[j] *= f; pb.v[j + 2] *= f;
      // roll
      dq.setFromAxisAngle(one.set(vz, 0, -vx).normalize(), (sp * dt) / pb.s[i]);
      pb.q[i].premultiply(dq);
      p.set(pb.p[j], pb.p[j + 1], pb.p[j + 2]);
      this.pebbles.setMatrixAt(i, m.compose(p, pb.q[i], one.setScalar(pb.s[i])));
      any = true;
    }
    if (any) this.pebbles.instanceMatrix.needsUpdate = true;
  }
}
