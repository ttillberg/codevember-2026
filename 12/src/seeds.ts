import * as THREE from 'three';
import type { Food } from './bird/types';

// Seeds on the air: a dark spindle on a fine beak, a parachute of pale hairs.
// Click drops one where you clicked; it drifts down on a lazy breeze. The bird
// may reach out and take it, then it rides on the bill tip for a moment and
// is gone.

const MAX = 6;
const PAPPUS_R = 0.038;
const FIBERS = 44;

interface Seed extends Food {
  obj: THREE.Group;
  fibres: THREE.Object3D;
  age: number;
  spin: number;
  phase: number;
  state: 'drift' | 'carried' | 'gone';
  carryT: number;
  swallowAt: number;
  /** a seed passing through on the breeze, not dropped: carried across */
  wind: THREE.Vector3 | null;
}

function seedGeometry() {
  // fibres: from the crown of the beak out and up in an umbrella, each with a
  // couple of side hairs near the tip so the edge reads soft
  const pos: number[] = [];
  const top = new THREE.Vector3(0, 0.03, 0);
  for (let i = 0; i < FIBERS; i++) {
    const a = (i / FIBERS) * Math.PI * 2 + Math.sin(i * 12.7) * 0.05;
    const lift = 0.35 + 0.12 * Math.sin(i * 3.1);
    const r = PAPPUS_R * (0.9 + 0.15 * Math.sin(i * 7.3));
    const tip = new THREE.Vector3(Math.cos(a) * r, top.y + r * lift, Math.sin(a) * r);
    pos.push(top.x, top.y, top.z, tip.x, tip.y, tip.z);
    for (const t of [0.6, 0.78, 0.92]) {
      const p = top.clone().lerp(tip, t);
      const side = new THREE.Vector3(-Math.sin(a), 0.3, Math.cos(a)).multiplyScalar(r * 0.07);
      pos.push(p.x, p.y, p.z, p.x + side.x, p.y + side.y, p.z + side.z);
      pos.push(p.x, p.y, p.z, p.x - side.x, p.y + side.y, p.z - side.z);
    }
  }
  const fibres = new THREE.BufferGeometry();
  fibres.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const beak = new THREE.CylinderGeometry(0.0008, 0.0011, 0.03, 5);
  beak.translate(0, 0.015, 0);
  const body = new THREE.SphereGeometry(1, 10, 8);
  body.scale(0.0035, 0.01, 0.0035);
  body.translate(0, -0.007, 0);
  return { fibres, beak, body };
}

export function createSeeds(scene: THREE.Scene) {
  const g = seedGeometry();
  const fibreMat = new THREE.LineBasicMaterial({ color: 0xf2f0e6, transparent: true, opacity: 0.75, depthWrite: false });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b4, roughness: 0.7 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 });
  const seeds: Seed[] = [];
  const food: Food[] = [];
  const tip = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const qa = new THREE.Quaternion();
  let nextId = 1;

  function spawn(at: THREE.Vector3, wind: THREE.Vector3 | null = null) {
    if (seeds.filter((s) => s.state === 'drift').length >= MAX) {
      const old = seeds.find((s) => s.state === 'drift');
      if (old) remove(old);
    }
    const obj = new THREE.Group();
    const fibres = new THREE.LineSegments(g.fibres, fibreMat);
    obj.add(fibres, new THREE.Mesh(g.beak, beakMat), new THREE.Mesh(g.body, bodyMat));
    obj.position.copy(at);
    obj.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4);
    obj.scale.setScalar(0.01);
    scene.add(obj);
    stats.spawned++;
    seeds.push({
      id: nextId++,
      obj,
      fibres,
      position: obj.position,
      velocity: new THREE.Vector3(),
      age: 0,
      spin: (Math.random() - 0.5) * 0.8,
      phase: Math.random() * 100,
      state: 'drift',
      carryT: 0,
      swallowAt: -1,
      wind,
    });
  }

  function remove(s: Seed) {
    s.state = 'gone';
    scene.remove(s.obj);
  }

  const stats = { spawned: 0, picked: 0, swallowed: 0, dropped: 0 };

  return {
    spawn,
    stats,
    /** the bird took this one */
    pick(id: number) {
      const s = seeds.find((x) => x.id === id && x.state === 'drift');
      if (s) {
        stats.picked++;
        s.state = 'carried';
        s.carryT = 0;
        s.swallowAt = -1;
      }
    },
    /** the bird got it down */
    swallowed(id: number) {
      const s = seeds.find((x) => x.id === id && x.state === 'carried');
      if (s && s.swallowAt < 0) {
        s.swallowAt = s.carryT;
        stats.swallowed++;
      }
    },
    /** drifting seeds, for bird.setFood */
    food(): ReadonlyArray<Food> {
      food.length = 0;
      for (const s of seeds) if (s.state === 'drift') food.push(s);
      return food;
    },
    update(dt: number, t: number, billTip: ((out: THREE.Vector3) => THREE.Vector3) | undefined, headPos?: THREE.Vector3) {
      for (const s of seeds) {
        if (s.state === 'gone') continue;
        s.age += dt;
        if (s.state === 'drift') {
          // sink slowly, wander on a breeze, a little lift now and then
          const k = t * 0.6 + s.phase;
          const wind = new THREE.Vector3(Math.sin(k * 0.9) * 0.05 + Math.sin(k * 2.3) * 0.02, Math.sin(k * 1.7) * 0.02, Math.cos(k * 0.7) * 0.03);
          const target = wind.add(new THREE.Vector3(0, -0.035, 0));
          if (s.wind) target.add(s.wind);
          s.velocity.lerp(target, 1 - Math.exp(-dt * 1.5));
          s.obj.position.addScaledVector(s.velocity, dt);
          s.obj.rotation.y += s.spin * dt;
          s.obj.rotation.x = Math.sin(k * 1.3) * 0.12;
          s.obj.rotation.z = Math.cos(k * 1.1) * 0.12;
          s.obj.scale.setScalar(Math.min(1, s.obj.scale.x + dt * 4));
          if (s.obj.position.y < -1.4 || s.age > (s.wind ? 90 : 45) || Math.abs(s.obj.position.x) > 3.2) remove(s);
        } else if (s.state === 'carried') {
          // held where the bird says (bill tip, then along the tongue into the
          // mouth) until it reports the swallow; a timeout in case it never does
          s.carryT += dt;
          if (billTip) s.obj.position.copy(billTip(tip));
          // in the bill: the parachute folds shut and lies along the bill, tufts
          // pointing back into the mouth, and it shrinks as it is drawn in, so the
          // bill hides it instead of a fan sticking out sideways
          if (headPos) {
            axis.copy(headPos).sub(s.obj.position).normalize();
            s.obj.quaternion.slerp(qa.setFromUnitVectors(up, axis), 1 - Math.exp(-dt * 30));
          }
          const fold = Math.min(1, s.carryT / 0.07);
          const sink = Math.max(0.2, 1 - s.carryT * 1.6);
          s.fibres.scale.set(1 - 0.85 * fold, 1 + 0.6 * fold, 1 - 0.85 * fold);
          s.obj.scale.setScalar(sink);
          if (s.swallowAt >= 0) {
            s.obj.scale.setScalar(Math.max(0, 0.2 * (1 - (s.carryT - s.swallowAt) * 10)));
            if (s.carryT - s.swallowAt > 0.1) remove(s);
          }
          if (s.carryT > 3 || !billTip) {
            if (s.swallowAt < 0) stats.dropped++;
            remove(s);
          }
        }
      }
      for (let i = seeds.length - 1; i >= 0; i--) if (seeds[i].state === 'gone') seeds.splice(i, 1);
    },
  };
}
