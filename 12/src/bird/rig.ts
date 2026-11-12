import * as THREE from 'three';
import type { Species } from './species';
import { Loft, type SurfacePoint } from './loft';
import { DEG, lerp } from './util';

// The skeleton. Plain THREE.Bone hierarchy, every bone named, so a later
// behaviour (flight, preening) can grab what it needs:
//
// root
// ├─ hips ─ spine ─ chest ─ neck1 ─ neck2 ─ head ─ bill, jaw
// │   │              │                       ├─ eye.L/R
// │   │              │                       ├─ lidUpper.L/R, lidLower.L/R, nict.L/R
// │   │              ├─ sternum (breath)
// │   │              └─ shoulder.L/R ─ forearm.L/R ─ hand.L/R ─ primary.L/R.1…N
// │   │                                   └─ secondary.L/R.1…N
// │   └─ tail ─ rectrix.L/R.1…N
// └─ foot.L/R ─ tarsus.L/R, toe.L/R.1…4
//
// Feather bones (primary/secondary/rectrix) have +Z along the shaft and +Y out
// of the upper surface. Spine bones keep root-aligned axes at rest.

export type Side = 'L' | 'R';
export const SIDES: Side[] = ['L', 'R'];
export const sideSign = (s: Side) => (s === 'L' ? 1 : -1);

export interface WingRig {
  side: Side;
  /** bones in a fixed order: shoulder, forearm, hand, primaries…, secondaries… */
  bones: THREE.Bone[];
  folded: THREE.Quaternion[];
  spread: THREE.Quaternion[];
  primaries: THREE.Bone[];
  secondaries: THREE.Bone[];
}

export interface RectrixRig {
  bone: THREE.Bone;
  /** signed index from the centre: ±0.5, ±1.5 … */
  k: number;
}

export interface EyeRig {
  side: Side;
  center: THREE.Vector3; // root space, rest
  out: THREE.Vector3;
  eye: THREE.Bone;
  lidUpper: THREE.Bone;
  lidLower: THREE.Bone;
  nict: THREE.Bone;
}

export interface RestPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  worldPos: THREE.Vector3;
  worldQuat: THREE.Quaternion;
}

export interface Rig {
  species: Species;
  loft: Loft;
  rootBone: THREE.Bone;
  bones: Record<string, THREE.Bone>;
  list: THREE.Bone[];
  rest: Record<string, RestPose>;
  skeleton: THREE.Skeleton;
  index(name: string): number;
  wings: Record<Side, WingRig>;
  /** left wing, folded: wrist and the point over the tail where the tips meet (mirror x for the right) */
  wingLine: [THREE.Vector3, THREE.Vector3];
  rectrices: RectrixRig[];
  eyes: Record<Side, EyeRig>;
  /** hip sockets in hips-bone space, and ankles in root space */
  hipSocket: Record<Side, THREE.Vector3>;
  ankle: Record<Side, THREE.Vector3>;
  tarsusLength: number;
}

const V = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

/** Quaternion whose +Z is `dir` and whose +Y leans toward `up`. */
export function basisQuat(dir: THREE.Vector3, up: THREE.Vector3, out = new THREE.Quaternion()) {
  const z = dir.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

const mirror = (v: THREE.Vector3, sign: number) => new THREE.Vector3(v.x * sign, v.y, v.z);

export function buildRig(species: Species): Rig {
  const loft = new Loft(species);
  const bones: Record<string, THREE.Bone> = {};
  const list: THREE.Bone[] = [];
  const rest: Record<string, RestPose> = {};

  function add(name: string, parent: string | null, worldPos: THREE.Vector3, worldQuat = new THREE.Quaternion()) {
    const b = new THREE.Bone();
    b.name = name;
    const r: RestPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), worldPos: worldPos.clone(), worldQuat: worldQuat.clone() };
    if (parent) {
      const p = rest[parent];
      const inv = p.worldQuat.clone().invert();
      r.pos.copy(worldPos).sub(p.worldPos).applyQuaternion(inv);
      r.quat.copy(inv).multiply(worldQuat);
      bones[parent].add(b);
    } else {
      r.pos.copy(worldPos);
      r.quat.copy(worldQuat);
    }
    b.position.copy(r.pos);
    b.quaternion.copy(r.quat);
    bones[name] = b;
    rest[name] = r;
    list.push(b);
    return b;
  }

  const c = (s: number) => loft.center(s, new THREE.Vector3());
  const sp = species.spine;

  const rootBone = add('root', null, new THREE.Vector3());
  add('hips', 'root', c(sp.hips));
  add('spine', 'hips', c(sp.spine));
  add('chest', 'spine', c(sp.chest));
  add('neck1', 'chest', c(sp.neck1));
  add('neck2', 'neck1', c(sp.neck2));
  add('head', 'neck2', c(sp.head));

  // leaf bone the breath moves: breast and flanks hang off it
  add('sternum', 'chest', loft.point(sp.spine + 0.4, 0, new THREE.Vector3()));

  // bill
  const billBase = c(loft.sMax);
  const billDir = loft.axis(loft.sMax, new THREE.Vector3());
  const billQ = basisQuat(billDir, new THREE.Vector3(0, 1, 0));
  add('bill', 'head', billBase, billQ);
  add('jaw', 'head', billBase.clone().add(new THREE.Vector3(0, -0.012, -0.04)), billQ);

  // eyes
  const eyes = {} as Record<Side, EyeRig>;
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  for (const side of SIDES) {
    const sg = sideSign(side);
    loft.surface(species.eye.s, species.eye.phi * Math.PI, sfc);
    const out = sfc.n.clone().multiplyScalar(0.7).add(new THREE.Vector3(0.3, 0.02, 0.04)).normalize();
    const center = sfc.p.clone().addScaledVector(out, -species.eye.radius * species.eye.inset);
    out.x *= sg;
    center.x *= sg;
    const q = basisQuat(out, new THREE.Vector3(0, 1, 0));
    eyes[side] = {
      side,
      center,
      out,
      eye: add(`eye.${side}`, 'head', center, q),
      lidUpper: add(`lidUpper.${side}`, 'head', center, q),
      lidLower: add(`lidLower.${side}`, 'head', center, q),
      nict: add(`nict.${side}`, 'head', center, q),
    };
  }

  // wings
  const W = species.wing;
  const wings = {} as Record<Side, WingRig>;
  const wingA = new THREE.Vector3();
  const wingB = new THREE.Vector3();
  {
    // Folded pose, left wing. The wing is laid ON the body: the wrist sits on the flank,
    // every remex is a straight blade from there toward the point over the tail where the
    // wingtips meet, and each is swung outward until its whole length clears the skin by
    // enough to ride above the contour feathers. Inner feathers lie on top of outer ones.
    const S = V(W.shoulder);
    const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
    const tmpN = new THREE.Vector3();
    const P = new THREE.Vector3();
    const onSkin = (s: number, deg: number, lift: number) => {
      loft.surface(s, deg * DEG, sfc);
      return sfc.p.clone().addScaledVector(sfc.n, lift);
    };
    const ta = species.tail.droop * DEG;
    const tailDir = new THREE.Vector3(0, -Math.sin(ta), -Math.cos(ta));
    const tailUp = new THREE.Vector3(0, Math.cos(ta), -Math.sin(ta));
    const meet = c(sp.tail).addScaledVector(tailDir, species.tail.length[1] * W.foldCross[0]).addScaledVector(tailUp, 0.03);
    meet.x = W.foldCross[1];
    const wrist = onSkin(W.foldAt[0], W.foldAt[1], W.foldClear);
    const N = sfc.n.clone();
    const E = onSkin(W.foldAt[0] + 0.85, W.foldAt[1] + 24, W.foldClear * 0.7);
    const hd = meet.clone().sub(wrist).normalize();
    N.addScaledVector(hd, -N.dot(hd)).normalize();
    const trail = new THREE.Vector3().crossVectors(N, hd);
    /** Push a point out until it clears the skin by `clear`. */
    const lift = (p: THREE.Vector3, clear: number) => {
      for (let k = 0; k < 4; k++) {
        const d = loft.clearance(p, tmpN);
        if (d >= clear) break;
        p.addScaledVector(tmpN, clear - d + 0.001);
      }
      return p;
    };
    /** Swing a blade about its base until all of it clears; returns its direction and surface normal. */
    const lay = (base: THREE.Vector3, aim: THREE.Vector3, len: number, clear: number) => {
      const tip = base.clone().addScaledVector(aim.clone().sub(base).normalize(), len);
      for (let it = 0; it < 30; it++) {
        let worst = 0;
        let wf = 1;
        const wn = new THREE.Vector3();
        for (let f = 0.12; f <= 1.001; f += 0.11) {
          P.copy(base).lerp(tip, f);
          const d = loft.clearance(P, tmpN) - clear;
          if (d < worst) {
            worst = d;
            wf = f;
            wn.copy(tmpN);
          }
        }
        if (worst >= -0.0005) break;
        tip.addScaledVector(wn, (-worst / wf) * 1.05);
        // keep the length
        tip.sub(base).setLength(len).add(base);
      }
      const dir = tip.sub(base).normalize();
      loft.clearance(P.copy(base).addScaledVector(dir, len * 0.3), tmpN);
      const n = tmpN.clone().addScaledVector(dir, -tmpN.dot(dir)).normalize();
      return { dir, n };
    };

    // spread pose directions (left wing): out along +X, trailing edge toward the tail
    const caudal = loft.axis(sp.spine, new THREE.Vector3()).multiplyScalar(-1);
    const dorsal = new THREE.Vector3(0, -caudal.z, caudal.y);
    if (dorsal.z > 0) dorsal.multiplyScalar(-1);
    const X = new THREE.Vector3(1, 0, 0);
    const rotIn = (dir: THREE.Vector3, n: THREE.Vector3, ang: number) => dir.clone().applyAxisAngle(n, ang);

    interface Spec { name: string; parent: string; pos: THREE.Vector3; dir: THREE.Vector3; n: THREE.Vector3; sDir: THREE.Vector3 }
    const specs: Spec[] = [];
    specs.push({ name: 'shoulder', parent: 'chest', pos: S, dir: E.clone().sub(S), n: N, sDir: X.clone().multiplyScalar(0.85).addScaledVector(caudal, 0.5) });
    specs.push({ name: 'forearm', parent: 'shoulder', pos: E, dir: wrist.clone().sub(E), n: N, sDir: X.clone().multiplyScalar(0.9).addScaledVector(caudal, -0.35) });
    specs.push({ name: 'hand', parent: 'forearm', pos: wrist, dir: hd, n: N, sDir: X.clone() });
    const np = W.primaries;
    for (let i = 0; i < np; i++) {
      const f = i / (np - 1);
      const clear = W.foldClear + (1 - f) * 0.008;
      const base = lift(wrist.clone().addScaledVector(hd, (W.hand * (i + 0.4)) / np).addScaledVector(trail, (1 - f) * 0.05), clear);
      const len = lerp(W.primaryLen[0], W.primaryLen[1], Math.pow(f, 0.75));
      const { dir, n } = lay(base, meet.clone().addScaledVector(trail, (1 - f) * 0.045), len, clear);
      specs.push({ name: `primary#${i + 1}`, parent: 'hand', pos: base, dir, n, sDir: rotIn(X, dorsal, lerp(74, -6, f) * DEG) });
    }
    const ns = W.secondaries;
    for (let j = 0; j < ns; j++) {
      const f = j / (ns - 1);
      const clear = W.foldClear + 0.01 + f * 0.004;
      const base = lift(wrist.clone().lerp(E, (j + 0.7) / (ns + 0.4)).addScaledVector(trail, 0.045 + f * 0.02), clear);
      const len = lerp(W.secondaryLen[0], W.secondaryLen[1], f);
      const { dir, n } = lay(base, base.clone().add(rotIn(hd, N, lerp(7, 16, f) * DEG)), len, clear);
      specs.push({ name: `secondary#${j + 1}`, parent: 'forearm', pos: base, dir, n, sDir: rotIn(X, dorsal, lerp(82, 97, f) * DEG) });
    }

    wingA.copy(wrist);
    wingB.copy(meet);
    for (const side of SIDES) {
      const sg = sideSign(side);
      const nm = (n: string) => (n.includes('#') ? n.replace('#', `.${side}.`) : `${n}.${side}`);
      const wr: WingRig = { side, bones: [], folded: [], spread: [], primaries: [], secondaries: [] };
      const spreadWorld: Record<string, THREE.Quaternion> = { chest: new THREE.Quaternion() };
      for (const s of specs) {
        const name = nm(s.name);
        const parent = s.parent === 'chest' ? 'chest' : nm(s.parent);
        const q = basisQuat(mirror(s.dir, sg), mirror(s.n, sg));
        const b = add(name, parent, mirror(s.pos, sg), q);
        const qs = basisQuat(mirror(s.sDir, sg), mirror(dorsal, sg));
        spreadWorld[name] = qs;
        wr.bones.push(b);
        wr.folded.push(rest[name].quat.clone());
        wr.spread.push(spreadWorld[parent].clone().invert().multiply(qs));
        if (s.name.startsWith('primary')) wr.primaries.push(b);
        if (s.name.startsWith('secondary')) wr.secondaries.push(b);
      }
      wings[side] = wr;
    }
  }

  // tail
  const T = species.tail;
  const rectrices: RectrixRig[] = [];
  {
    const a = T.droop * DEG;
    const dir = new THREE.Vector3(0, -Math.sin(a), -Math.cos(a));
    const up = new THREE.Vector3(0, Math.cos(a), -Math.sin(a));
    const q = basisQuat(dir, up);
    const base = c(sp.tail);
    add('tail', 'hips', base, q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q); // bone +X in root space
    for (const side of SIDES) {
      for (let i = 0; i < T.rectrices; i++) {
        // bone +X is the bird's right, so left feathers sit at negative k
        const k = (i + 0.5) * (side === 'L' ? -1 : 1);
        const pos = base.clone().addScaledVector(right, k * 0.013).addScaledVector(up, -i * 0.005 - (side === 'L' ? 0.002 : 0)).addScaledVector(dir, 0.02);
        const qk = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * T.restFan * DEG));
        rectrices.push({ bone: add(`rectrix.${side}.${i + 1}`, 'tail', pos, qk), k });
      }
    }
  }

  // legs: feet are planted on the perch (children of root), the tarsus aims at the hip
  const L = species.legs;
  const hipSocket = {} as Record<Side, THREE.Vector3>;
  const ankle = {} as Record<Side, THREE.Vector3>;
  let tarsusLength = 0.1;
  for (const side of SIDES) {
    const sg = sideSign(side);
    const foot = new THREE.Vector3(L.spread * sg, 0, 0);
    add(`foot.${side}`, 'root', foot);
    const ank = foot.clone().add(new THREE.Vector3(0, 0.014, -0.012));
    const hipW = new THREE.Vector3(L.hip[0] * sg, L.hip[1], L.hip[2]);
    ankle[side] = ank;
    hipSocket[side] = hipW.clone().sub(rest.hips.worldPos);
    tarsusLength = hipW.distanceTo(ank);
    add(`tarsus.${side}`, `foot.${side}`, ank, basisQuat(hipW.clone().sub(ank), new THREE.Vector3(1, 0, 0)));
    for (let i = 0; i < 4; i++) add(`toe.${side}.${i + 1}`, `foot.${side}`, foot);
  }

  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const idx = new Map(list.map((b, i) => [b.name, i]));
  return {
    species,
    loft,
    rootBone,
    bones,
    list,
    rest,
    skeleton,
    index: (n) => {
      const i = idx.get(n);
      if (i === undefined) throw new Error(`no bone ${n}`);
      return i;
    },
    wings,
    wingLine: [wingA, wingB],
    rectrices,
    eyes,
    hipSocket,
    ankle,
    tarsusLength,
  };
}
