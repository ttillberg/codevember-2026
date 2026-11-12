import * as THREE from 'three';
import type { Rig, Side } from './rig';
import { basisQuat, SIDES, sideSign } from './rig';
import type { PlumageUniforms } from './plumageMaterial';
import { LID } from './parts';
import { clamp, DEG, lerp, smoothstep } from './util';

// The pose is the seam between motion and rig. Behaviour layers never touch
// bones: they add to these channels, and applyPose() turns the channels into
// bone transforms and feather uniforms. A new behaviour (flight, preening)
// writes the same channels, or adds its own and teaches the solver about it.

export interface WingPose {
  /** 0 folded … 1 spread */
  spread: number;
  /** wing swung away from the body, radians */
  lift: number;
  /** wingtips lowered, radians */
  droop: number;
}

export class Pose {
  // gaze: where the bill points, in root space. yaw + = bird's left, pitch + = up.
  headYaw = 0;
  headPitch = 0;
  headRoll = 0;
  /** extra head translation, root space */
  headShift = new THREE.Vector3();
  /** 1 = head position fully held against body motion */
  headStabil = 0.85;

  /**
   * Reach: put the bill TIP on this root-space point. weight 0 = ignore, 1 = exactly there.
   * The solver aims the head so the bill points along the line to the target and slides the
   * head along that line (unfolding or tucking the neck) until the tip arrives.
   */
  reachTarget = new THREE.Vector3();
  reachWeight = 0;

  // body (hips)
  bodyYaw = 0;
  bodyPitch = 0; // + = lean forward
  bodyRoll = 0;
  bodyShift = new THREE.Vector3();
  chestPitch = 0;

  /** -1 … 1, drives the sternum */
  breath = 0;

  // feathers
  fluff = 0; // radians of lift, global
  lift = new Float32Array(8); // extra lift along the body: [0] bill … [7] tail
  gorget = 0;
  crest = 0;

  // eyes: 0 open … 1 closed
  lidUpper = 0;
  lidLower = 0;
  nict = 0;
  jaw = 0;

  tailPitch = 0; // + = lifted
  tailYaw = 0;
  tailRoll = 0;
  tailFan = 0; // 0 folded … 1 fanned

  wing: Record<Side, WingPose> = { L: { spread: 0, lift: 0, droop: 0 }, R: { spread: 0, lift: 0, droop: 0 } };

  reset() {
    this.headYaw = this.headPitch = this.headRoll = 0;
    this.headShift.set(0, 0, 0);
    this.headStabil = 0.85;
    this.reachWeight = 0;
    this.bodyYaw = this.bodyPitch = this.bodyRoll = this.chestPitch = 0;
    this.bodyShift.set(0, 0, 0);
    this.breath = 0;
    this.fluff = this.gorget = this.crest = 0;
    this.lift.fill(0);
    this.lidUpper = this.lidLower = this.nict = this.jaw = 0;
    this.tailPitch = this.tailYaw = this.tailRoll = this.tailFan = 0;
    for (const s of SIDES) {
      this.wing[s].spread = 0;
      this.wing[s].lift = 0;
      this.wing[s].droop = 0;
    }
  }

  /** Add a bump to the lift profile centred at body coordinate c (0 bill … 1 tail). */
  addLift(c: number, width: number, amount: number) {
    for (let i = 0; i < 8; i++) {
      const d = (i / 7 - c) / width;
      this.lift[i] += amount * Math.exp(-d * d);
    }
  }
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const I = new THREE.Quaternion();

/** applyPose plus what the solve found out. */
export interface Solver {
  (p: Pose): void;
  /** bill tip after the last solve, root space */
  tip: THREE.Vector3;
  /** distance from head pivot to bill tip */
  billReach: number;
}

export function createSolver(rig: Rig, uniforms: PlumageUniforms): Solver {
  const { bones, rest, species } = rig;
  const e = new THREE.Euler();
  const qHips = new THREE.Quaternion();
  const qChestL = new THREE.Quaternion();
  const qChestW = new THREE.Quaternion();
  const qHead = new THREE.Quaternion();
  const qRel = new THREE.Quaternion();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const pFk = new THREE.Vector3();
  const pStill = new THREE.Vector3();
  const [n1, n2] = species.behaviour.neckShare;

  // axes for swinging the folded wing, expressed in forearm space
  const wingAxes = {} as Record<Side, { out: THREE.Vector3; fan: THREE.Vector3 }>;
  for (const s of SIDES) {
    const hq = rest[`hand.${s}`].quat;
    wingAxes[s] = { out: X.clone().applyQuaternion(hq), fan: Y.clone().applyQuaternion(hq) };
  }
  // the bill tip in head space, and how far the neck may unfold or tuck to carry it somewhere
  const billRest = rest.bill;
  const tipLocal = new THREE.Vector3(0, -species.bill.droop, species.bill.length).applyQuaternion(billRest.worldQuat).add(billRest.worldPos).sub(rest.head.worldPos);
  const tipLen = tipLocal.length();
  const tipElev = Math.atan2(tipLocal.y, tipLocal.z);
  const NECK_OUT = 0.34;
  const NECK_IN = 0.24;
  const tip = new THREE.Vector3();
  const hWant = new THREE.Vector3();
  const qAim = new THREE.Quaternion();
  const sternumDir = rest.sternum.worldPos.clone().sub(rest.chest.worldPos).setX(0).normalize();

  /** Root-space position of the head bone for a given hips transform and neck rotations. */
  function headFk(hipsPos: THREE.Vector3, hipsQ: THREE.Quaternion, chestL: THREE.Quaternion, neckA: THREE.Quaternion, neckB: THREE.Quaternion, out: THREE.Vector3) {
    // walk up from the head: each step rotates by the parent's local rotation and adds its offset
    out.copy(rest.head.pos).applyQuaternion(neckB).add(rest.neck2.pos);
    out.applyQuaternion(neckA).add(rest.neck1.pos);
    out.applyQuaternion(chestL).add(rest.chest.pos);
    out.add(rest.spine.pos); // spine keeps its rest rotation
    out.applyQuaternion(hipsQ).add(hipsPos);
    return out;
  }

  const applyPose = function applyPose(p: Pose) {
    // --- body -------------------------------------------------------------------
    e.set(p.bodyPitch, p.bodyYaw, p.bodyRoll, 'YXZ');
    qHips.setFromEuler(e);
    bones.hips.quaternion.copy(qHips);
    bones.hips.position.copy(rest.hips.pos).add(p.bodyShift);
    qChestL.setFromAxisAngle(X, p.chestPitch);
    bones.chest.quaternion.copy(qChestL);
    qChestW.copy(qHips).multiply(qChestL);

    // breath: sternum swings out and the flanks widen
    bones.sternum.position.copy(rest.sternum.pos).addScaledVector(sternumDir, p.breath * 0.011);
    bones.sternum.scale.set(1 + p.breath * 0.028, 1, 1 + p.breath * 0.012);

    // --- neck and head: world-stabilised gaze, optionally reaching with the bill ----------
    e.set(-p.headPitch, p.headYaw, p.headRoll, 'YXZ');
    qHead.setFromEuler(e);
    const solveNeck = () => {
      qRel.copy(qChestW).invert().multiply(qHead);
      qA.copy(I).slerp(qRel, n1);
      qB.copy(I).slerp(qRel, n2);
    };
    solveNeck();
    // where the head sits with the body's motion taken out (held still in space) and the
    // layers' own shifts added
    headFk(bones.hips.position, qHips, qChestL, qA, qB, pFk);
    headFk(rest.hips.pos, I, I, qA, qB, pStill);
    v.copy(pStill).sub(pFk).multiplyScalar(clamp(p.headStabil, 0, 1)).add(p.headShift);
    const w = clamp(p.reachWeight, 0, 1);
    if (w > 0) {
      // IK for the bill tip. The head pivot must end up exactly one bill-length from the
      // target, on the line from where it is now: slide it along that line, within what the
      // neck can give, then turn the head so the tip lies on the target.
      hWant.copy(pFk).add(v);
      v2.copy(p.reachTarget).sub(hWant);
      const dist = v2.length() || 1e-6;
      const slide = clamp(dist - tipLen, -NECK_IN, NECK_OUT);
      hWant.addScaledVector(v2, slide / dist);
      v2.copy(p.reachTarget).sub(hWant).normalize();
      const yaw = clamp(Math.atan2(v2.x, v2.z), -2.2, 2.2);
      const pitch = clamp(Math.asin(clamp(v2.y, -1, 1)) - tipElev, -1.1, 1.25);
      e.set(-pitch, yaw, p.headRoll * (1 - w), 'YXZ');
      qAim.setFromEuler(e);
      qHead.slerp(qAim, w);
      solveNeck();
      headFk(bones.hips.position, qHips, qChestL, qA, qB, pFk);
      v.lerp(hWant.sub(pFk), w);
    }
    bones.neck1.quaternion.copy(qA);
    bones.neck2.quaternion.copy(qB);
    // whatever the neck did not do, the head does: world orientation is exact
    qC.copy(qA).multiply(qB).invert().multiply(qRel);
    bones.head.quaternion.copy(qC);
    // the head's translation is shared down the neck (a bird's neck is a folded S under the
    // feathers: reaching is that S unfolding), each bone taking its part in its parent's frame
    tip.copy(pFk).add(v);
    qC.copy(qChestW).invert();
    bones.neck1.position.copy(rest.neck1.pos).add(v2.copy(v).multiplyScalar(0.22).applyQuaternion(qC));
    qC.copy(qChestW).multiply(qA).invert();
    bones.neck2.position.copy(rest.neck2.pos).add(v2.copy(v).multiplyScalar(0.3).applyQuaternion(qC));
    qC.copy(qChestW).multiply(qA).multiply(qB).invert();
    bones.head.position.copy(rest.head.pos).add(v2.copy(v).multiplyScalar(0.48).applyQuaternion(qC));
    // bill tip, root space, for whoever wants to know (picking, carrying)
    tip.add(v2.copy(tipLocal).applyQuaternion(qHead));

    bones.jaw.quaternion.copy(rest.jaw.quat).multiply(qA.setFromAxisAngle(X, p.jaw * 0.11));

    // --- eyes -------------------------------------------------------------------
    for (const s of SIDES) {
      const eye = rig.eyes[s];
      const up = lerp(LID.upperOpen, 0, smoothstep(0, 1, p.lidUpper));
      const lo = lerp(LID.lowerOpen, 0, smoothstep(0, 1, p.lidLower));
      // sweeping from +Z toward +Y is a negative turn about X
      eye.lidUpper.quaternion.copy(rest[eye.lidUpper.name].quat).multiply(qA.setFromAxisAngle(X, -up));
      eye.lidLower.quaternion.copy(rest[eye.lidLower.name].quat).multiply(qA.setFromAxisAngle(X, -lo));
      // the membrane parks toward the bill: -X on the left eye, +X on the right
      const na = -sideSign(s) * LID.nictOpen * (1 - clamp(p.nict, 0, 1));
      eye.nict.quaternion.copy(rest[eye.nict.name].quat).multiply(qA.setFromAxisAngle(Y, na));
      // parked lids tuck under the skin
      eye.nict.scale.setScalar(p.nict > 0.002 ? 1 : 0.001);
      eye.lidUpper.scale.setScalar(lerp(0.93, 1, smoothstep(0, 0.5, p.lidUpper)));
      eye.lidLower.scale.setScalar(lerp(0.93, 1, smoothstep(0, 0.5, p.lidLower)));
    }

    // --- tail -------------------------------------------------------------------
    e.set(-p.tailPitch, p.tailYaw, p.tailRoll, 'YXZ');
    bones.tail.quaternion.copy(rest.tail.quat).multiply(qA.setFromEuler(e));
    const fan = lerp(species.tail.restFan, species.tail.maxFan, clamp(p.tailFan, -0.5, 1)) * DEG;
    for (const r of rig.rectrices) r.bone.quaternion.setFromAxisAngle(Y, r.k * fan);

    // --- wings ------------------------------------------------------------------
    for (const s of SIDES) {
      const w = rig.wings[s];
      const wp = p.wing[s];
      const k = smoothstep(0, 1, wp.spread);
      for (let i = 0; i < w.bones.length; i++) w.bones[i].quaternion.copy(w.folded[i]).slerp(w.spread[i], k);
      const fold = 1 - k;
      if (fold > 0) {
        const ax = wingAxes[s];
        const fore = w.bones[1];
        // (the free tips follow a flick only a little: most of it is the resting wing's feathers lifting)
        fore.quaternion.multiply(qA.setFromAxisAngle(ax.out, -wp.lift * 0.3 * fold));
        fore.quaternion.multiply(qA.setFromAxisAngle(ax.fan, -sideSign(s) * wp.droop * fold));
      }
    }

    // --- legs: feet stay planted, the tarsus reaches for the hip ---------
    for (const s of SIDES) {
      v.copy(rig.hipSocket[s]).applyQuaternion(qHips).add(bones.hips.position);
      v2.copy(v).sub(rig.ankle[s]);
      const b = bones[`tarsus.${s}`];
      basisQuat(v2, X, b.quaternion);
      b.scale.set(1, 1, v2.length() / rig.tarsusLength);
    }

    // --- feathers -----------------------------------------------------------------
    uniforms.uFluff.value = p.fluff;
    uniforms.uLift.value.set(p.lift);
    uniforms.uGorget.value = p.gorget;
    uniforms.uCrest.value = p.crest;
    uniforms.uWingSpread.value.set(p.wing.L.spread, p.wing.R.spread);
    uniforms.uWingLift.value.set(p.wing.L.lift, p.wing.R.lift);
  } as Solver;
  applyPose.tip = tip;
  applyPose.billReach = tipLen;
  return applyPose;
}

export { Z as FORWARD };
