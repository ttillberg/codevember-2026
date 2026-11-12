import * as THREE from 'three';
import type { Food } from './bird/types';

// Seeds on the air: a dark spindle on a fine beak, a parachute of pale hairs.
// Click drops one where you clicked; it drifts down on a lazy breeze. The bird
// may reach out and take it, then it rides on the bill tip for a moment and
// is gone.

const MAX = 6;
const PAPPUS_R = 0.065;
const FIBERS = 56;

interface Seed extends Food {
  obj: THREE.Group;
  age: number;
  spin: number;
  phase: number;
  state: 'drift' | 'carried' | 'gone';
  carryT: number;
}

function seedGeometry() {
  // fibres: from the crown of the beak out and up in an umbrella, each with a
  // couple of side hairs near the tip so the edge reads soft
  const pos: number[] = [];
  const top = new THREE.Vector3(0, 0.05, 0);
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
  const beak = new THREE.CylinderGeometry(0.0012, 0.0016, 0.05, 5);
  beak.translate(0, 0.025, 0);
  const body = new THREE.SphereGeometry(1, 10, 8);
  body.scale(0.0055, 0.016, 0.0055);
  body.translate(0, -0.012, 0);
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
  let nextId = 1;

  function spawn(at: THREE.Vector3) {
    if (seeds.filter((s) => s.state === 'drift').length >= MAX) {
      const old = seeds.find((s) => s.state === 'drift');
      if (old) remove(old);
    }
    const obj = new THREE.Group();
    obj.add(new THREE.LineSegments(g.fibres, fibreMat), new THREE.Mesh(g.beak, beakMat), new THREE.Mesh(g.body, bodyMat));
    obj.position.copy(at);
    obj.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4);
    obj.scale.setScalar(0.01);
    scene.add(obj);
    stats.spawned++;
    seeds.push({
      id: nextId++,
      obj,
      position: obj.position,
      velocity: new THREE.Vector3(),
      age: 0,
      spin: (Math.random() - 0.5) * 0.8,
      phase: Math.random() * 100,
      state: 'drift',
      carryT: 0,
    });
  }

  function remove(s: Seed) {
    s.state = 'gone';
    scene.remove(s.obj);
  }

  const stats = { spawned: 0, picked: 0 };

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
      }
    },
    /** drifting seeds, for bird.setFood */
    food(): ReadonlyArray<Food> {
      food.length = 0;
      for (const s of seeds) if (s.state === 'drift') food.push(s);
      return food;
    },
    update(dt: number, t: number, billTip: ((out: THREE.Vector3) => THREE.Vector3) | undefined) {
      for (const s of seeds) {
        if (s.state === 'gone') continue;
        s.age += dt;
        if (s.state === 'drift') {
          // sink slowly, wander on a breeze, a little lift now and then
          const k = t * 0.6 + s.phase;
          const wind = new THREE.Vector3(Math.sin(k * 0.9) * 0.05 + Math.sin(k * 2.3) * 0.02, Math.sin(k * 1.7) * 0.02, Math.cos(k * 0.7) * 0.03);
          const target = wind.add(new THREE.Vector3(0, -0.035, 0));
          s.velocity.lerp(target, 1 - Math.exp(-dt * 1.5));
          s.obj.position.addScaledVector(s.velocity, dt);
          s.obj.rotation.y += s.spin * dt;
          s.obj.rotation.x = Math.sin(k * 1.3) * 0.12;
          s.obj.rotation.z = Math.cos(k * 1.1) * 0.12;
          s.obj.scale.setScalar(Math.min(1, s.obj.scale.x + dt * 4));
          if (s.obj.position.y < -1.4 || s.age > 45) remove(s);
        } else if (s.state === 'carried') {
          // held in the bill tip, then swallowed
          s.carryT += dt;
          if (billTip) s.obj.position.copy(billTip(tip));
          s.obj.scale.setScalar(Math.max(0, 1 - Math.max(s.carryT - 0.35, 0) * 4));
          if (s.carryT > 0.6 || !billTip) remove(s);
        }
      }
      for (let i = seeds.length - 1; i >= 0; i--) if (seeds[i].state === 'gone') seeds.splice(i, 1);
    },
  };
}
