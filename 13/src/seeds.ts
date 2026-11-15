import * as THREE from 'three';
import type { Food } from './bird/types';

// Plum petals on the air: one small red petal, cupped, paler at its heart. Click drops
// one where you clicked; it flutters down on a lazy breeze. The bird may reach out and
// take it, then it rides on the bill tip for a moment and is gone. (They are still the
// bird's food, so the code calls them seeds.)

const MAX = 6;
const PETAL_R = 0.017;

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

function petalGeometry() {
  // a round petal lying in the XZ plane, narrowing to its claw at -Z, cupped upward;
  // the pigment has run to the rim, as on the blossoms
  const SEG = 14;
  const pos: number[] = [];
  const col: number[] = [];
  const pale = new THREE.Color(0xf2857a);
  const deep = new THREE.Color(0xd3222a);
  const at = (i: number) => {
    const a = (i / SEG) * Math.PI * 2;
    // narrower toward the claw
    const w = 0.82 - 0.22 * Math.max(-Math.cos(a), 0);
    const x = Math.sin(a) * PETAL_R * w;
    const z = Math.cos(a) * PETAL_R;
    return [x, (x * x + z * z) / (PETAL_R * 2.2), z];
  };
  for (let i = 0; i < SEG; i++) {
    const a = at(i);
    const b = at(i + 1);
    pos.push(0, 0, 0, a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(pale.r, pale.g, pale.b, deep.r, deep.g, deep.b, deep.r, deep.g, deep.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function createSeeds(scene: THREE.Scene) {
  const g = petalGeometry();
  // flat pigment, like the blossoms on the branch
  const petalMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const seeds: Seed[] = [];
  const drift = new THREE.Vector3();
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
    // (the petal is what folds when the bird takes it: the same slot the seed's parachute had)
    const fibres = new THREE.Mesh(g, petalMat);
    obj.add(fibres);
    obj.position.copy(at);
    obj.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4);
    obj.scale.setScalar(0.01);
    scene.add(obj);
    seeds.push({
      id: nextId++,
      obj,
      fibres,
      position: obj.position,
      velocity: new THREE.Vector3(),
      age: 0,
      spin: (Math.random() - 0.5) * 3.2,
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

  return {
    spawn,
    /** one of each part, never in the scene: for compiling the shaders while loading, not on the first seed */
    warm: [new THREE.Mesh(g, petalMat)] as THREE.Object3D[],
    /** the bird took this one */
    pick(id: number) {
      const s = seeds.find((x) => x.id === id && x.state === 'drift');
      if (s) {
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
          // a breeze, and the slow sink
          const target = drift.set(Math.sin(k * 0.9) * 0.05 + Math.sin(k * 2.3) * 0.02, Math.sin(k * 1.7) * 0.02 - 0.035, Math.cos(k * 0.7) * 0.03);
          if (s.wind) target.add(s.wind);
          s.velocity.lerp(target, 1 - Math.exp(-dt * 1.5));
          s.obj.position.addScaledVector(s.velocity, dt);
          s.obj.rotation.y += s.spin * dt;
          // a petal rocks and tumbles as it falls
          s.obj.rotation.x = Math.sin(k * 2.9) * 0.9;
          s.obj.rotation.z = Math.cos(k * 2.3) * 0.7;
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
          if (s.carryT > 3 || !billTip) remove(s);
        }
      }
      for (let i = seeds.length - 1; i >= 0; i--) if (seeds[i].state === 'gone') seeds.splice(i, 1);
    },
  };
}
