import * as THREE from 'three';
import type { Food } from './bird/types';

// Now and then a gnat drifts into view: it hovers in front of the bird, darts,
// hovers again, and after a while leaves. It is food like a seed, so the bird
// may watch it and, now and then, take it. Mostly it gets away.

const ID0 = 1_000_000; // apart from the seeds' ids

interface Gnat extends Food {
  obj: THREE.Group;
  wings: THREE.Mesh[];
  home: THREE.Vector3;
  goal: THREE.Vector3;
  age: number;
  life: number;
  dartAt: number;
  phase: number;
  state: 'fly' | 'leave' | 'carried' | 'gone';
  carryT: number;
  swallowAt: number;
  /** most of them see the bill coming: out of reach (not food) until then */
  dodgedUntil: number;
}

export function createInsects(scene: THREE.Scene, around: () => THREE.Vector3) {
  const bodyGeo = new THREE.SphereGeometry(1, 8, 6);
  bodyGeo.scale(0.004, 0.004, 0.011);
  const wingGeo = new THREE.PlaneGeometry(0.016, 0.007);
  wingGeo.translate(0.008, 0, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.6 });
  // a beating wing is a blur, not a blade
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xdde4dc, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const gnats: Gnat[] = [];
  const food: Food[] = [];
  const tip = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let nextId = ID0;
  // rare: one some time in the first minute, then one every 45–90 s
  let nextAt = 20 + Math.random() * 35;
  let wasStriking = false;

  function spawn() {
    const c = around();
    const home = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.05 + Math.random() * 0.3, 0.45 + Math.random() * 0.35));
    // come in from off to one side
    const from = home.clone().add(new THREE.Vector3(Math.sign(Math.random() - 0.5) * 2.2, 0.6, -0.4));
    const obj = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const wings = [new THREE.Mesh(wingGeo, wingMat), new THREE.Mesh(wingGeo, wingMat)];
    wings[1].rotation.y = Math.PI;
    obj.add(body, ...wings);
    obj.position.copy(from);
    scene.add(obj);
    gnats.push({
      id: nextId++,
      obj,
      wings,
      position: obj.position,
      velocity: new THREE.Vector3(),
      home,
      goal: home.clone(),
      age: 0,
      life: 6 + Math.random() * 8,
      dartAt: 0.8,
      phase: Math.random() * 100,
      state: 'fly',
      carryT: 0,
      swallowAt: -1,
      dodgedUntil: 0,
    });
  }

  function remove(g: Gnat) {
    g.state = 'gone';
    scene.remove(g.obj);
  }

  return {
    /** let one in now (debug, settings) */
    spawn,
    owns: (id: number) => id >= ID0,
    pick(id: number) {
      const g = gnats.find((x) => x.id === id && (x.state === 'fly' || x.state === 'leave'));
      if (g) {
        g.state = 'carried';
        g.carryT = 0;
      }
    },
    swallowed(id: number) {
      const g = gnats.find((x) => x.id === id && x.state === 'carried');
      if (g && g.swallowAt < 0) g.swallowAt = g.carryT;
    },
    food(): ReadonlyArray<Food> {
      food.length = 0;
      for (const g of gnats) if (g.state === 'fly' && g.age > g.dodgedUntil) food.push(g);
      return food;
    },
    /** striking: the bird is winding up or striking right now */
    update(dt: number, t: number, billTip: ((out: THREE.Vector3) => THREE.Vector3) | undefined, striking = false) {
      // one roll per strike, as it starts
      const strikeStarts = striking && !wasStriking;
      wasStriking = striking;
      if (t > nextAt && gnats.length === 0) {
        spawn();
        nextAt = t + 45 + Math.random() * 45;
      }
      for (const g of gnats) {
        if (g.state === 'gone') continue;
        g.age += dt;
        if (g.state === 'carried') {
          g.carryT += dt;
          if (billTip) g.obj.position.copy(billTip(tip));
          for (const w of g.wings) w.visible = false;
          const k = g.swallowAt >= 0 ? Math.max(0, 1 - (g.carryT - g.swallowAt) * 10) : 1;
          g.obj.scale.setScalar(k);
          if ((g.swallowAt >= 0 && k <= 0) || g.carryT > 3 || !billTip) remove(g);
          continue;
        }
        // hover around a point that wanders; now and then dart to a new one
        if (g.state === 'fly') {
          if (g.age > g.life) {
            g.state = 'leave';
            g.goal.copy(g.position).add(new THREE.Vector3(Math.sign(g.position.x - g.home.x || 1) * 3, 1.2, -0.5));
          } else if (g.age > g.dartAt) {
            g.goal.copy(g.home).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.3));
            g.dartAt = g.age + 0.6 + Math.random() * 1.8;
          }
        }
        // the bird gathers itself to strike: most gnats are gone before the bill gets there
        if (g.state === 'fly' && g.age > g.dodgedUntil && strikeStarts && billTip && billTip(tip).distanceTo(g.position) < 0.7 && Math.random() < 0.75) {
          // gone from the bird's list for a moment, so the strike hits air
          g.dodgedUntil = g.age + 1.5;
          tmp.copy(g.position).sub(tip).normalize();
          g.velocity.addScaledVector(tmp, 2.2);
          g.goal.copy(g.position).addScaledVector(tmp, 0.45);
          g.dartAt = g.age + 0.8;
        }
        const k = t * 3 + g.phase;
        // jitter: gnats never hold still
        tmp.set(Math.sin(k * 5.1) + Math.sin(k * 11.7) * 0.5, Math.sin(k * 6.3 + 1) + Math.sin(k * 13.1) * 0.4, Math.sin(k * 4.7 + 2)).multiplyScalar(0.08);
        tmp.addScaledVector(tmp.clone().copy(g.goal).sub(g.position), g.state === 'leave' ? 2.5 : 6);
        g.velocity.lerp(tmp, 1 - Math.exp(-dt * 8));
        g.obj.position.addScaledVector(g.velocity, dt);
        // face where it flies, wings a-blur
        if (g.velocity.lengthSq() > 1e-6) g.obj.lookAt(tmp.copy(g.obj.position).add(g.velocity));
        const beat = Math.sin(t * 190 + g.phase) * 0.9;
        g.wings[0].rotation.z = beat;
        g.wings[1].rotation.z = -beat;
        if (g.state === 'leave' && g.position.distanceTo(g.home) > 2.5) remove(g);
      }
      for (let i = gnats.length - 1; i >= 0; i--) if (gnats[i].state === 'gone') gnats.splice(i, 1);
    },
  };
}
