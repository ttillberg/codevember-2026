// What is left of the meals (model/bones.py -> public/bones.glb): small bones of birds and lizards. Old ones, dirty
// and half under, in the bedding of the den nobody sleeps in any more; newer ones round the nest on the lower level,
// one lizard still lying more or less in the order it was put together in; and a bone here and there along the way.
// Each heap is one mesh: every bone is turned, set on the floor and written into it once, when the file has come.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { World } from './world';
import { boneMaterial, depthMaterial } from './gfx';

type Heap = { p: number[]; n: number[]; c: number[]; l: number[]; i: number[]; pieces: number };
const heap = (): Heap => ({ p: [], n: [], c: [], l: [], i: [], pieces: 0 });
/** They are modelled the size of a sparrow's and a wall lizard's. What was eaten here was bigger: a crow, a monitor. */
const SIZE = 1.9;

export class Bones {
  group = new THREE.Group();
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];
  /** the heaps, and where each is: one that is far off is not drawn */
  private sites: { mesh: THREE.Mesh; at: THREE.Vector3 | null }[] = [];
  onReady = () => {};

  constructor(world: World, rnd: () => number, nest: THREE.Vector3) {
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}bones.glb`).then((gltf) => {
      const kinds = new Map<string, THREE.BufferGeometry>();
      gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) kinds.set(m.name, m.geometry); });
      const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
      const n = new THREE.Vector3(), v = new THREE.Vector3(), o = new THREE.Vector3(), axis = new THREE.Vector3();
      const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();

      /**
       * One bone, set down at x, z on the floor under y0. age: how long it has lain, 0 fresh to 1: darker, dustier,
       * further into the ground. lift: on top of something (bedding). tilt: how far it may lean (radians).
       */
      const put = (to: Heap, kind: string, x: number, y0: number, z: number, yaw: number, age: number, lift = 0, tilt = 0.12) => {
        const g = kinds.get(kind);
        if (!g) return false;
        o.set(x, y0, z);
        if (world.sample(x, y0, z) > -0.01) return false;
        // (not in a pool: it would stand on the water)
        if (world.puddles.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 0.04)) return false;
        const t = world.march(o, down, 0.8);
        if (t >= 0.8) return false;
        const y = y0 - t;
        world.normalAt(x, y, z, n);
        if (n.y < 0) n.negate();
        // (it lies on the floor, not quite along every lump of it)
        n.lerp(up, 0.4).normalize();
        q.setFromUnitVectors(up, n);
        q.multiply(q2.setFromAxisAngle(up, yaw));
        const lean = rnd() * Math.PI * 2;
        q.multiply(q2.setFromAxisAngle(axis.set(Math.cos(lean), 0, Math.sin(lean)), (rnd() - 0.5) * 2 * tilt));
        const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
        g.computeBoundingBox();
        const tall = g.boundingBox!.max.y;
        const scale = SIZE * (0.9 + rnd() * 0.3), sink = tall * scale * (0.04 + 0.34 * age * rnd()), seed = rnd();
        // old bone is browner and darker, and no two are quite the same
        const dim = (1 - 0.3 * age) * (0.88 + 0.24 * rnd()), warm = 0.3 * age;
        const base = to.p.length / 3;
        for (let i = 0; i < pos.count; i++) {
          const h = pos.getY(i) * scale;
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).multiplyScalar(scale).applyQuaternion(q);
          to.p.push(x + v.x - n.x * sink, y + lift + v.y - n.y * sink, z + v.z - n.z * sink);
          v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyQuaternion(q);
          to.n.push(v.x, v.y, v.z);
          to.c.push(col.getX(i) * dim, col.getY(i) * dim * (1 - 0.35 * warm), col.getZ(i) * dim * (1 - 0.7 * warm));
          to.l.push(h - sink, seed, age);
        }
        const idx = g.index!;
        for (let i = 0; i < idx.count; i++) to.i.push(base + idx.getX(i));
        to.pieces++;
        return true;
      };
      const build = (h: Heap, at: THREE.Vector3 | null) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(h.p), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(h.n), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(h.c), 3));
        g.setAttribute('aLook', new THREE.BufferAttribute(new Float32Array(h.l), 3));
        g.setIndex(h.i);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, boneMaterial());
        this.group.add(mesh);
        this.casters.push({ obj: mesh, depth: depthMaterial() });
        this.sites.push({ mesh, at });
      };
      const turn = () => rnd() * Math.PI * 2;

      // ---- the old den: what its two ate, years of it, trodden into the bed ----
      const { c, back, floor } = world.den;
      const old = heap();
      const bed = c.clone().addScaledVector(back, 0.15);
      const inBed = (kind: string, reach = 0.8, age = 0.55 + 0.45 * rnd()) => {
        for (let tries = 0; tries < 6; tries++) {
          const ang = turn(), r = (0.12 + 0.88 * Math.sqrt(rnd())) * reach;
          const mound = 0.085 * Math.exp(-((r / 0.42) ** 2));
          if (put(old, kind, bed.x + Math.cos(ang) * r, floor + 0.35, bed.z + Math.sin(ang) * r * 1.1, turn(), age, mound * (0.75 + 0.35 * rnd()) + 0.006, 0.3)) return;
        }
      };
      for (const k of ['bird_skull', 'bird_skull_small', 'lizard_skull', 'lizard_jaw', 'wishbone', 'bird_sternum', 'bird_pelvis', 'bird_ribcage',
        'lizard_spine', 'lizard_tail', 'bird_foot', 'bird_foot', 'lizard_limb', 'lizard_limb']) inBed(k, 0.7);
      for (const k of ['bird_femur', 'bird_tibia', 'bird_humerus', 'bird_forearm']) { inBed(k); inBed(k); }
      for (let i = 0; i < 7; i++) { inBed('rib'); inBed('vertebra'); }
      // and a few kicked out of it, up the tunnel
      for (let i = 0; i < 5; i++) {
        const t = 0.9 + rnd() * 1.3;
        put(old, ['rib', 'vertebra', 'bird_tibia', 'bird_femur', 'wishbone'][i], c.x - back.x * t + (rnd() - 0.5) * 0.3, floor + 0.35, c.z - back.z * t + (rnd() - 0.5) * 0.3, turn(), 0.8 + 0.2 * rnd());
      }
      build(old, c.clone());

      // ---- the nest: newer, paler, lying where they were dropped ----
      const fresh = heap();
      const y0 = nest.y + 0.25;
      const byNest = (kind: string, near = 0.2, far = 0.7, age = 0.35 * rnd()) => {
        for (let tries = 0; tries < 8; tries++) {
          const ang = turn(), r = near + (far - near) * rnd() ** 1.4;
          if (put(fresh, kind, nest.x + Math.cos(ang) * r, y0, nest.z + Math.sin(ang) * r, turn(), age)) return;
        }
      };
      // one lizard, eaten where it lay: head, back, tail, in that order, the limbs fallen away to the sides
      for (let tries = 0; tries < 12; tries++) {
        const ang = turn(), r = 0.3 + 0.2 * rnd(), yaw = turn();
        const x = nest.x + Math.cos(ang) * r, z = nest.z + Math.sin(ang) * r;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        // (room for the whole length of it, or somewhere else)
        const fits = [-0.075 * SIZE, 0, 0.075 * SIZE].every((d) => world.sample(x + fx * d, y0, z + fz * d) < -0.01 && world.march(o.set(x + fx * d, y0, z + fz * d), down, 0.8) < 0.8);
        if (!fits) continue;
        const at = (along: number, side: number) => [x + (fx * along + fz * side) * SIZE, y0, z + (fz * along - fx * side) * SIZE] as const;
        put(fresh, 'lizard_spine', ...at(0, 0), yaw + (rnd() - 0.5) * 0.2, 0.1);
        put(fresh, 'lizard_skull', ...at(0.064, 0.004), yaw + (rnd() - 0.5) * 0.5, 0.1);
        put(fresh, 'lizard_jaw', ...at(0.07, -0.03), yaw + 0.9 + rnd() * 0.8, 0.1);
        put(fresh, 'lizard_tail', ...at(-0.062, 0.008), yaw + (rnd() - 0.5) * 0.5, 0.1);
        put(fresh, 'lizard_limb', ...at(0.026, 0.034), yaw + rnd(), 0.1);
        put(fresh, 'lizard_limb', ...at(-0.03, -0.036), yaw + Math.PI + rnd(), 0.1);
        break;
      }
      // a bird or two, pulled apart
      for (const k of ['bird_skull', 'bird_ribcage', 'bird_sternum', 'bird_pelvis', 'wishbone', 'bird_skull_small']) byNest(k, 0.2, 0.55);
      for (const k of ['bird_foot', 'bird_tibia', 'bird_femur', 'bird_humerus', 'bird_forearm']) { byNest(k); byNest(k, 0.25, 0.9); }
      for (let i = 0; i < 7; i++) { byNest('rib', 0.18, 0.9); byNest('vertebra', 0.18, 0.9); }
      build(fresh, nest.clone());

      // ---- and one here, one there, anywhere in the place: carried off, dropped, trodden in ----
      const stray = heap();
      const loose = ['rib', 'vertebra', 'bird_femur', 'bird_tibia', 'rib', 'bird_humerus', 'vertebra', 'lizard_jaw', 'bird_forearm', 'rib', 'bird_skull_small',
        'wishbone', 'vertebra', 'bird_foot'];
      const inside = world.edges.filter((e) => !e.open);
      for (let i = 0, tries = 0; i < loose.length && tries < 200; tries++) {
        const e = inside[Math.floor(rnd() * inside.length)];
        const s = 0.2 + rnd() * Math.max(0.1, e.len - 0.4);
        world.railPoint(e, s, o);
        world.railTangent(e, s, v);
        // to one side of where things walk
        const side = (rnd() < 0.5 ? -1 : 1) * (0.1 + 0.16 * rnd());
        const x = o.x + v.z * side, z = o.z - v.x * side;
        if (Math.hypot(x - nest.x, z - nest.z) < 1 || Math.hypot(x - c.x, z - c.z) < 1.4) continue;
        if (put(stray, loose[i], x, o.y, z, turn(), 0.45 + 0.55 * rnd())) i++;
      }
      build(stray, null);
      console.log(`bones: ${old.pieces} in the old bed, ${fresh.pieces} by the nest, ${stray.pieces} about; ${(old.i.length + fresh.i.length + stray.i.length) / 3} triangles`);
      this.onReady();
    });
  }

  update(eye: THREE.Vector3) {
    for (const s of this.sites) s.mesh.visible = !s.at || eye.distanceTo(s.at) < 9;
  }
}
