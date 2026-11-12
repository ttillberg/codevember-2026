import * as THREE from 'three';
import type { FeatherLook, Region, Species } from './species';
import type { Rig, Side } from './rig';
import { SIDES, sideSign } from './rig';
import type { SurfacePoint } from './loft';
import { clamp, DEG, lerp, mulberry32, noise1, type Rng, smoothstep } from './util';

// All feathers are real geometry: small cupped cards for the contour feathers
// and scales, long blades for remiges and rectrices. They are merged into
// skinned buffers; every vertex knows its feather's root and hinge so the
// vertex shader can lift the feather off the skin (ruffle) before skinning.

export const CH_NONE = 0;
export const CH_GORGET = 1;
export const CH_CROWN = 2;
export const CH_FLIGHT = 3;
export const CH_FUZZ = 4;

interface FeatherSpec {
  root: THREE.Vector3;
  /** unit shaft direction, unit feather normal */
  dir: THREE.Vector3;
  normal: THREE.Vector3;
  /** normal of whatever it lies on, for soft shading; null = use its own */
  skinNormal: THREE.Vector3 | null;
  iriNormal: THREE.Vector3;
  width: number;
  length: number;
  cols: number;
  rows: number;
  round: number;
  cup: number;
  curl: number;
  /** vane asymmetry -1…1 (flight feathers) */
  asym: number;
  /** blades: how far along the vane reaches full width (default 0.12) */
  widen?: number;
  base: THREE.Color;
  tip: THREE.Color;
  iri: THREE.Color;
  iri2: THREE.Color;
  iriStrength: number;
  iriPower: number;
  rough: number;
  /** 0 crisp vane … 1 down */
  loose: number;
  /** fraction of the length hidden under the row above */
  cover: number;
  bones: [number, number, number, number];
  weights: [number, number, number, number];
  rand: number;
  coord: number;
  gain: number;
  channel: number;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  root: number[] = [];
  hinge: number[] = [];
  data: number[] = [];
  iriN: number[] = [];
  cBase: number[] = [];
  cTip: number[] = [];
  cIri: number[] = [];
  cIri2: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  feathers = 0;
  private S = new THREE.Vector3();
  private H = new THREE.Vector3();
  private P = new THREE.Vector3();
  private Nv = new THREE.Vector3();
  private In = new THREE.Vector3();

  add(f: FeatherSpec) {
    const { cols, rows } = f;
    const S = this.S.crossVectors(f.normal, f.dir).normalize(); // across the vane
    const H = this.H.crossVectors(f.dir, f.normal).normalize(); // +angle lifts the tip
    const start = this.pos.length / 3;
    const hw = f.width / 2;
    for (let r = 0; r < rows; r++) {
      const last = r === rows - 1;
      // short cards: quill, widest point, shoulder of the tip, tip. Blades: evenly spaced.
      const v = rows === 4 ? [0, 0.5, 0.82, 0.965][r] : Math.pow(r / (rows - 1), 0.9);
      // outline: narrow quill, widest at the middle, then a superellipse closes the tip
      const pw = lerp(1.25, 2.1, f.round);
      const tipT = clamp((v - 0.5) / 0.5, 0, 1);
      const close = Math.pow(Math.max(1 - Math.pow(tipT, pw), 0), 1 / pw);
      const prof = rows === 4 ? lerp(0.5, 1, smoothstep(0, 0.5, v)) * close : lerp(0.4, 1, smoothstep(0, f.widen ?? 0.12, v)) * (last ? 0.42 : Math.pow(Math.max(1 - Math.pow(clamp((v - 0.8) / 0.2, 0, 1), 2.2), 0), 0.45));
      for (let c = 0; c < cols; c++) {
        const u = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1;
        const side = u < 0 ? 1 - f.asym : 1 + f.asym;
        const x = u * hw * prof * side;
        // the tip row bows forward so the outline reads round
        const vv = last ? v + (1 - v) * (1 - u * u) : v;
        const drop = f.cup * hw * (u * prof) * (u * prof) + f.curl * f.length * vv * vv;
        this.P.copy(f.root).addScaledVector(S, x).addScaledVector(f.dir, vv * f.length).addScaledVector(f.normal, -drop);
        this.Nv.copy(f.normal).addScaledVector(S, 2 * f.cup * u * prof).addScaledVector(f.dir, 2 * f.curl * vv);
        // the platelet normal follows the curl of the vane, so a scale shades as a little dome
        this.In.copy(f.iriNormal).addScaledVector(S, 0.55 * f.cup * u * prof).addScaledVector(f.dir, 0.16 * (vv - 0.6)).normalize();
        // soft feathers shade as one coat, not as separate plates
        if (f.skinNormal) this.Nv.normalize().lerp(f.skinNormal, lerp(0.45, 0.8, Math.min(f.loose * 2, 1)));
        this.Nv.normalize();
        this.pos.push(this.P.x, this.P.y, this.P.z);
        this.nor.push(this.Nv.x, this.Nv.y, this.Nv.z);
        this.uv.push(u, vv);
        this.root.push(f.root.x, f.root.y, f.root.z);
        this.hinge.push(H.x, H.y, H.z);
        this.data.push(f.rand, f.coord, f.gain, f.channel);
        this.iriN.push(this.In.x, this.In.y, this.In.z);
        this.cBase.push(f.base.r, f.base.g, f.base.b, f.iriStrength / 4);
        this.cTip.push(f.tip.r, f.tip.g, f.tip.b, f.loose);
        this.cIri.push(f.iri.r, f.iri.g, f.iri.b, f.iriPower / 32);
        this.cIri2.push(f.iri2.r, f.iri2.g, f.iri2.b, f.cover);
        this.si.push(...f.bones);
        this.sw.push(...f.weights);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = start + r * cols + c;
        const b = a + cols;
        this.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.feathers++;
  }

  build() {
    const g = new THREE.BufferGeometry();
    const f32 = (a: number[], n: number) => new THREE.BufferAttribute(new Float32Array(a), n);
    const u16n = (a: number[], n: number) => {
      const arr = new Uint16Array(a.length);
      for (let i = 0; i < a.length; i++) arr[i] = Math.round(clamp(a[i], 0, 1) * 65535);
      return new THREE.BufferAttribute(arr, n, true);
    };
    const i16n = (a: number[], n: number) => {
      const arr = new Int16Array(a.length);
      for (let i = 0; i < a.length; i++) arr[i] = Math.round(clamp(a[i], -1, 1) * 32767);
      return new THREE.BufferAttribute(arr, n, true);
    };
    g.setAttribute('position', f32(this.pos, 3));
    g.setAttribute('normal', i16n(this.nor, 3));
    g.setAttribute('uv', f32(this.uv, 2));
    g.setAttribute('aRoot', f32(this.root, 3));
    g.setAttribute('aHinge', i16n(this.hinge, 3));
    g.setAttribute('aData', f32(this.data, 4));
    g.setAttribute('aIriN', i16n(this.iriN, 3));
    g.setAttribute('aBase', u16n(this.cBase, 4));
    g.setAttribute('aTip', u16n(this.cTip, 4));
    g.setAttribute('aIri', u16n(this.cIri, 4));
    g.setAttribute('aIri2', u16n(this.cIri2, 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.si), 4));
    g.setAttribute('skinWeight', u16n(this.sw, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, -0.1), 2.5);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 3, 2));
    return g;
  }
}

function inRegion(r: Region, s: number, phi: number, rnd: number) {
  if (r.kind === 'band') {
    const sj = s + (r.soft ?? 0) * (rnd * 2 - 1);
    return sj >= r.s[0] && sj <= r.s[1] && phi >= r.phi[0] && phi <= r.phi[1];
  }
  if (r.kind === 'blob') {
    const a = (s - r.at[0]) / r.r[0];
    const b = (phi - r.at[1]) / r.r[1];
    const e = r.pow ?? 2;
    // a soft blob thins out toward its rim instead of ending
    return Math.pow(Math.abs(a), e) + Math.pow(Math.abs(b), e) <= 1 + (r.soft ?? 0) * (rnd * 2 - 1);
  }
  // capsule, measured in units of its radii
  const ax = r.from[0] / r.r[0];
  const ay = r.from[1] / r.r[1];
  const bx = r.to[0] / r.r[0];
  const by = r.to[1] / r.r[1];
  const px = s / r.r[0];
  const py = phi / r.r[1];
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t) <= 1;
}

/** rnd in 0…1 decides soft tract borders; 0.5 gives the nominal outline. */
export function lookAt(species: Species, s: number, phi: number, rnd = 0.5): FeatherLook {
  let name = 'body';
  for (const t of species.tracts) if (inRegion(t.region, s, phi, rnd)) name = t.look;
  return species.looks[name];
}

const col = (hex: number) => new THREE.Color(hex);

/** Pigment value, gold wash and glitter strength at a point of the coat. */
function toneAt(species: Species, look: FeatherLook, sj: number, phi: number) {
  // value: darker down the flanks and under the body, with slow mottling over it all
  const sh = species.shading;
  let shade = 1 + sh.patch * (0.6 * noise1(sj * 2.7, 5) + 0.6 * noise1(phi * 8 + sj * 1.3, 6));
  let gold = 0;
  // glitter comes in patches: whole clumps of feathers catch the light, their neighbours stay dark
  const glit = look.fine ? 1 : lerp(0.12, 1.7, smoothstep(-0.25, 0.45, 0.7 * noise1(sj * 6.1 + phi * 9, 41) + 0.6 * noise1(phi * 21 - sj * 3.3, 42)));
  if (!look.fine) {
    gold = look.iriStrength > 0 && sj < 6 ? smoothstep(0.05, 0.6, 0.7 * noise1(sj * 3.4 + phi * 5, 31) + 0.5 * noise1(phi * 13 - sj * 2, 32)) * sh.goldAmount : 0;
    const body = 1 - smoothstep(4.6, 5.6, sj);
    shade *= lerp(1, sh.flank, body * smoothstep(0.2, 0.55, phi) * (1 - smoothstep(0.72, 0.95, phi)));
    shade *= lerp(1, sh.under, smoothstep(2.6, 0.5, sj) * (1 - smoothstep(0.4, 0.7, phi)));
  }
  return { shade, gold, glit };
}

function specFromLook(look: FeatherLook, rng: Rng, shade = 1, gold = 0, goldHex = 0x6a6420, glit = 1) {
  const j = (0.8 + rng() * 0.4) * shade;
  const iri = col(look.iri).lerp(col(look.iriGraze), rng() * rng() * 0.45);
  return {
    base: col(look.base).multiplyScalar(j),
    tip: col(look.tip).lerp(col(goldHex), gold * rng()).multiplyScalar(j),
    iri,
    iri2: col(look.iriGraze),
    iriStrength: look.iriStrength * lerp(0.75 + rng() * 0.5, 2.6 * Math.pow(rng(), 2.5), look.sparkle ?? 0) * (1 + gold * 1.5) * glit,
    iriPower: look.iriPower * (0.8 + rng() * 0.5),
    rough: look.rough,
    loose: look.loose ?? 0,
    round: look.round,
    cup: look.cup,
    channel: look.channel === 'gorget' ? CH_GORGET : look.channel === 'crown' ? CH_CROWN : CH_NONE,
  };
}

/**
 * Contour feathers and scales over the whole loft.
 *
 * Rows are not loft rings. Walking from the bill to the tail in fine steps, every
 * direction around the body keeps its own odometer and starts a new row each time
 * it has travelled one row pitch of whatever tract it is in. Row r is then the
 * closed curve through every direction's r-th mark: a line of equal "feathers
 * from the bill". Rows stay evenly spaced on both the inside and the outside of
 * the neck's bend, and big body feathers come round less often than small face
 * feathers. Each row is then walked sideways from the belly line, both ways,
 * dropping a feather every feather-pitch, odd rows half a pitch off: bricks,
 * exact on the throat and breast where it shows, drifting gently toward the back.
 */
function addContour(b: Builder, rig: Rig, rng: Rng) {
  const { loft, species } = rig;
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const sfc2: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const skinN = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const iriN = new THREE.Vector3();
  const root = new THREE.Vector3();
  const eyeR = species.eye.radius;
  const TAU = Math.PI * 2;
  const phiOf = (ang: number) => {
    const a = ((ang % TAU) + TAU) % TAU;
    return a <= Math.PI ? a / Math.PI : (TAU - a) / Math.PI;
  };
  /** look and graded width at a point of the loft */
  const sizeAt = (s: number, phi: number, rnd = 0.5) => {
    const look = lookAt(species, s, phi, rnd);
    let width = look.width;
    if (!look.fine) {
      // plain contour feathers grade in size across tract borders; show scales keep theirs
      const la = lookAt(species, s - 0.45, phi);
      const lb = lookAt(species, s + 0.45, phi);
      width = (width * 2 + (la.fine ? width : la.width) + (lb.fine ? width : lb.width)) / 4;
    }
    return { look, width };
  };

  // --- pass 1: odometers. rowS[r][bin] = the s at which direction `bin` starts its r-th row
  const BINS = 240;
  const COARSE = 40;
  const acc = new Float32Array(BINS).fill(1); // everything is due a first row at the bill
  const count = new Uint16Array(BINS);
  const rowS: Float32Array[] = [];
  const cS = new Float32Array(COARSE + 1);
  const FINE = 0.001; // travel per step on the fastest side
  let s = loft.sMax - 0.015;
  while (s > 0.03) {
    let maxS = 0;
    for (let k = 0; k <= COARSE; k++) {
      const a = (k / COARSE) * TAU;
      cS[k] = loft.point(Math.min(s + 0.01, loft.sMax), a, tmpA).distanceTo(loft.point(s - 0.01, a, tmpB)) / 0.02;
      maxS = Math.max(maxS, cS[k]);
    }
    const ds = FINE / maxS;
    for (let i = 0; i < BINS; i++) {
      const f = (i / BINS) * COARSE;
      const k = Math.min(Math.floor(f), COARSE - 1);
      const { look, width } = sizeAt(s, phiOf((i / BINS) * TAU));
      const pitch = width * look.aspect * look.rowStep;
      acc[i] += lerp(cS[k], cS[k + 1], f - k) * ds;
      if (acc[i] >= pitch) {
        acc[i] = Math.min(acc[i] - pitch, pitch * 0.5);
        const r = count[i]++;
        (rowS[r] ??= new Float32Array(BINS).fill(NaN))[i] = s;
      }
    }
    s -= ds;
  }

  // --- pass 2: walk each row sideways from the belly line and plant feathers
  const P0 = new THREE.Vector3();
  const P1 = new THREE.Vector3();
  const plant = (sj: number, a: number) => {
    loft.surface(sj, a, sfc);
    for (const side of SIDES) if (sfc.p.distanceTo(rig.eyes[side].center) < eyeR * 1.08) return;
    // ragged tract borders: look the feather itself up with a little jitter
    const phi = phiOf(a);
    const { look, width } = sizeAt(sj + (rng() - 0.5) * 0.06, clamp(phi + (rng() - 0.5) * 0.012, 0, 1), rng());
    const sh = species.shading;
    const { shade, gold, glit } = toneAt(species, look, sj, phi);
    // tousle: every soft feather is a little off in length, lie and twist, and whole
    // patches lean together (slow noise), so there are clumps and partings
    const loose = look.loose ?? 0;
    const nA = noise1(sj * 4.3 + phi * 17, 21);
    const nB = noise1(sj * 3.1 - phi * 23, 22);
    const size = 1 + (rng() - 0.5) * lerp(0.26, 0.65, loose);
    const len = width * look.aspect * size;
    // a few strays per hundred stand off the coat at an odd angle
    const stray = rng() < 0.035 * loose ? 1 : 0;
    let tilt = (look.tilt + (rng() - 0.5) * lerp(6, 17, loose) + nB * 7 * loose + stray * (8 + rng() * 10)) * DEG;
    const yaw = (rng() - 0.5) * lerp(0.17, 0.72, loose) + nA * 0.4 * loose + stray * (rng() - 0.5) * 0.9;
    const roll = ((rng() - 0.5) * 0.7 + nB * 0.3) * loose;
    let gain = look.lift;
    // under the folded wing the coat is pressed flat
    tmpA.set(Math.abs(sfc.p.x), sfc.p.y, sfc.p.z);
    tmpB.copy(rig.wingLine[1]).sub(rig.wingLine[0]);
    const wt = clamp(tmpA.clone().sub(rig.wingLine[0]).dot(tmpB) / tmpB.lengthSq(), 0, 1);
    const wd = tmpA.distanceTo(tmpB.multiplyScalar(wt).add(rig.wingLine[0]));
    // (but at the wing root the flank and shoulder feathers stay full, and bury the bend)
    // and the long scapulars are left to drape over the inner wing
    if (wd < 0.06 && wt > 0.13 && look !== species.looks.scapular) {
      tilt = Math.min(tilt, 3 * DEG);
      gain *= 0.12;
    }
    // lay the feather along the skin: aim it at the surface point under its tip, raised by the
    // tilt, so it rides over bulges and bridges hollows instead of cutting through them
    const local = loft.point(Math.min(sj + 0.01, loft.sMax), a, tmpA).distanceTo(loft.point(Math.max(sj - 0.01, 0), a, tmpB)) / 0.02;
    root.copy(sfc.p);
    skinN.copy(sfc.n);
    loft.surface(Math.max(sj - (len * 0.85) / Math.max(local, 0.02), 0), a, sfc2);
    dir.copy(sfc2.p).addScaledVector(sfc2.n, len * Math.sin(tilt)).sub(root);
    if (dir.lengthSq() < 1e-8) dir.copy(sfc.t);
    dir.normalize();
    nrm.copy(skinN).add(sfc2.n).addScaledVector(dir, -skinN.dot(dir) - sfc2.n.dot(dir)).normalize();
    dir.applyAxisAngle(nrm, yaw);
    nrm.applyAxisAngle(dir, roll);

    // platelet normal: skin-following, pulled toward the tract's aim, plus per-feather noise
    iriN.copy(nrm);
    if (look.iriAim) {
      tmpA.set(look.iriAim[0], look.iriAim[1], look.iriAim[2]).normalize();
      iriN.lerp(tmpA, look.iriAlign).normalize();
    }
    iriN.x += (rng() - 0.5) * look.jitter;
    iriN.y += (rng() - 0.5) * look.jitter;
    iriN.z += (rng() - 0.5) * look.jitter;
    iriN.normalize();

    const sk = loft.skin(sj, a);
    b.add({
      ...specFromLook(look, rng, shade, gold, sh.gold, glit),
      root,
      dir,
      normal: nrm,
      skinNormal: skinN,
      iriNormal: iriN,
      width: width * size,
      length: len,
      cols: look.fine ? 5 : 3,
      rows: 4,
      curl: lerp(0.1, 0.02 + rng() * 0.22, loose),
      asym: 0,
      bones: sk.bones.map((nm) => rig.index(nm)) as [number, number, number, number],
      weights: sk.weights,
      rand: rng(),
      coord: loft.bodyCoord(sj) * 0.8,
      gain,
      cover: clamp(1 - look.rowStep, 0.1, 0.9),
    });
  };

  for (let r = 0; r < rowS.length; r++) {
    const row = rowS[r];
    for (const sign of [1, -1]) {
      // q counts feather pitches along the row; a feather drops at every whole number
      let q = r & 1 ? 0.5 : sign > 0 ? 1 : 0;
      let broken = false;
      for (let i = 0; i < BINS / 2; i++) {
        const b0 = (((sign * i) % BINS) + BINS) % BINS;
        const b1 = (((sign * (i + 1)) % BINS) + BINS) % BINS;
        const s0 = row[b0];
        const s1 = row[b1];
        if (Number.isNaN(s0) || Number.isNaN(s1)) {
          broken = true;
          continue;
        }
        if (broken) {
          q = rng(); // a row fragment starts on its own phase
          broken = false;
        }
        const a0 = (sign * i * TAU) / BINS;
        const a1 = (sign * (i + 1) * TAU) / BINS;
        loft.point(s0, a0, P0);
        loft.point(s1, a1, P1);
        const { look, width } = sizeAt((s0 + s1) / 2, phiOf((a0 + a1) / 2));
        const span = P0.distanceTo(P1) / (width * (look.spacing ?? 0.6));
        // feathers falling inside this span
        while (q + span >= 1) {
          const f = (1 - q) / span;
          const jitterS = ((rng() - 0.5) * 0.25 * width * look.aspect * look.rowStep) / 0.11;
          const lj = lerp(0.12, 0.5, look.loose ?? 0);
          plant(clamp(lerp(s0, s1, f) + jitterS * (1 + 2 * (look.loose ?? 0)), 0.02, loft.sMax), lerp(a0, a1, f) + ((rng() - 0.5) * lj * width) / 0.15);
          q -= 1;
        }
        q += span;
      }
    }
  }
}

/** Remiges and wing coverts, built in the folded rest pose. */
function addWing(b: Builder, rig: Rig, side: Side, rng: Rng) {
  const W = rig.species.wing;
  const wr = rig.wings[side];
  const sg = sideSign(side);
  const base = col(W.color);
  const sheen = col(W.sheen);
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  const blade = (bone: THREE.Bone, length: number, width: number, asym: number) => {
    const r = rig.rest[bone.name];
    new THREE.Matrix4().makeRotationFromQuaternion(r.worldQuat).extractBasis(X, Y, Z);
    // no two blades lie quite alike
    Z.applyAxisAngle(Y, (rng() - 0.5) * 0.02);
    Y.applyAxisAngle(Z, (rng() - 0.5) * 0.12);
    const i = rig.index(bone.name);
    const j = 0.7 + rng() * 0.6;
    b.add({
      root: r.worldPos,
      dir: Z,
      normal: Y,
      skinNormal: null,
      iriNormal: Y,
      width,
      length,
      cols: 3,
      rows: 9,
      round: 0.75,
      cup: 0.12,
      curl: 0.012,
      // bone +X is the trailing edge on the left wing and the leading edge on the right
      asym: asym * sg,
      base: base.clone().multiplyScalar(j),
      tip: base.clone().multiplyScalar(j * 0.8),
      iri: sheen,
      iri2: sheen,
      iriStrength: 0.22,
      iriPower: 2.5,
      rough: 0.4,
      loose: 0,
      widen: 0.3,
      bones: [i, 0, 0, 0],
      weights: [1, 0, 0, 0],
      rand: rng(),
      coord: 0.55,
      gain: 0,
      // for blades the cover slot says which edge is the leading one
      cover: sg > 0 ? 0.2 : 0.8,
      channel: CH_FLIGHT,
    });
  };
  wr.primaries.forEach((bone, i) => {
    const f = i / (wr.primaries.length - 1);
    blade(bone, lerp(W.primaryLen[0], W.primaryLen[1], Math.pow(f, 0.75)), W.primaryWidth * lerp(1.15, 0.8, f), lerp(0.2, 0.5, f));
  });
  wr.secondaries.forEach((bone, j) => {
    const f = j / (wr.secondaries.length - 1);
    blade(bone, lerp(W.secondaryLen[0], W.secondaryLen[1], f), W.secondaryWidth, 0.15);
  });

  // coverts: rows of small feathers shingled over the remex bases, riding the arm bones
  const look = rig.species.looks.covert;
  const hand = rig.rest[`hand.${side}`];
  const fore = rig.rest[`forearm.${side}`];
  const upper = rig.rest[`shoulder.${side}`];
  new THREE.Matrix4().makeRotationFromQuaternion(hand.worldQuat).extractBasis(X, Y, Z);
  // world-space trailing direction regardless of side
  const trail = X.clone().multiplyScalar(sg);
  const N = Y.clone();
  // (in world space the mirrored wing's clearance test works on the mirrored point)
  const hd = Z.clone();
  const tipOfHand = hand.worldPos.clone().addScaledVector(hd, W.hand);
  // coverts: rows of loose feathers shingled over the remex bases and the wing bend,
  // each pushed out until it rides above the blades under it
  const rowsDef = [
    { off: -0.02, len: 0.075, w: 0.034, lift: 0.016, n: 15 },
    { off: 0.0, len: 0.1, w: 0.04, lift: 0.02, n: 14 },
    { off: 0.024, len: 0.13, w: 0.046, lift: 0.027, n: 14 },
    { off: 0.05, len: 0.17, w: 0.05, lift: 0.031, n: 14 },
    { off: 0.078, len: 0.2, w: 0.05, lift: 0.034, n: 13 },
  ];
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const sn = new THREE.Vector3();
  const clear = rig.species.wing.foldClear;
  for (const rw of rowsDef) {
    for (let k = 0; k < rw.n; k++) {
      // a runs elbow(−0.5) → wrist(0) → along the hand(1)
      const a = lerp(-0.55, 0.9, (k + rng() * 0.7) / rw.n);
      if (a < 0) p.copy(hand.worldPos).lerp(fore.worldPos, -a / 0.5);
      else p.copy(hand.worldPos).lerp(tipOfHand, a);
      p.addScaledVector(trail, rw.off + (rng() - 0.5) * 0.016);
      for (let it = 0; it < 3; it++) {
        const d = rig.loft.clearance(p, sn);
        if (d < clear + rw.lift) p.addScaledVector(sn, clear + rw.lift - d);
      }
      N.copy(sn);
      const tilt = 0.08 + rng() * 0.1;
      dir.copy(hd).addScaledVector(N, -hd.dot(N)).normalize().applyAxisAngle(N, sg * (0.1 + rng() * 0.3 + (a < 0 ? 0.25 : 0)));
      nrm.copy(N).multiplyScalar(Math.cos(tilt)).addScaledVector(dir, -Math.sin(tilt));
      dir.multiplyScalar(Math.cos(tilt)).addScaledVector(N, Math.sin(tilt));
      nrm.applyAxisAngle(dir, (rng() - 0.5) * 0.4);
      const bi = rig.index(a < 0 ? `forearm.${side}` : `hand.${side}`);
      const size = 0.8 + rng() * 0.4;
      b.add({
        ...specFromLook(look, rng, 0.8 + 0.3 * rng()),
        root: p,
        dir,
        normal: nrm,
        skinNormal: N,
        iriNormal: nrm.clone().add(new THREE.Vector3((rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4)).normalize(),
        width: rw.w * size,
        length: rw.len * size,
        cols: 3,
        rows: 4,
        curl: 0.04 + rng() * 0.1,
        asym: 0,
        bones: [bi, 0, 0, 0],
        weights: [1, 0, 0, 0],
        rand: rng(),
        coord: 0.5,
        gain: 0.25,
        cover: 0.55,
      });
    }
  }
}

function addTail(b: Builder, rig: Rig, rng: Rng) {
  const T = rig.species.tail;
  const base = col(T.color);
  const sheen = col(0x2a3a5a);
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  for (const r of rig.rectrices) {
    const rest = rig.rest[r.bone.name];
    new THREE.Matrix4().makeRotationFromQuaternion(rest.worldQuat).extractBasis(X, Y, Z);
    const f = (Math.abs(r.k) - 0.5) / Math.max(T.rectrices - 1, 1);
    const j = 0.85 + rng() * 0.3;
    b.add({
      root: rest.worldPos,
      dir: Z,
      normal: Y,
      skinNormal: null,
      iriNormal: Y,
      width: T.width,
      length: lerp(T.length[0], T.length[1], Math.pow(f, 1.4)),
      cols: 3,
      rows: 9,
      round: 1,
      cup: 0.1,
      curl: 0.01,
      asym: 0.18 * Math.sign(r.k),
      base: base.clone().multiplyScalar(j),
      tip: base.clone().multiplyScalar(j * 0.8),
      iri: sheen,
      iri2: sheen,
      iriStrength: 0.2,
      iriPower: 3,
      rough: 0.62,
      loose: 0,
      widen: 0.7,
      bones: [rig.index(r.bone.name), 0, 0, 0],
      weights: [1, 0, 0, 0],
      rand: rng(),
      coord: 1,
      gain: 0,
      cover: r.k > 0 ? 0.8 : 0.2,
      channel: CH_FLIGHT,
    });
  }
}

/**
 * Fuzz: a few shells of the loft, just above and between the contour feathers, that the
 * shader fills with fine hairs running the way the feathers lie. It is what makes the
 * coat read as fur instead of as leaves, and it frays the silhouette. Same vertex layout
 * as the feathers, so the same material draws it (channel CH_FUZZ):
 *   uv      = hair columns round the body, distance from the bill
 *   aTip.a  = how thickly this tract is fuzzed, aIri2.a = which shell (0 inner … 1 outer)
 */
function buildFuzz(rig: Rig, layers = 3, rings = 120, segs = 80) {
  const { loft, species } = rig;
  const b = new Builder();
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const P = new THREE.Vector3();
  const prev = new Float32Array(segs + 1);
  const pts: THREE.Vector3[] = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
  const iriN = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const rng = mulberry32(species.seed + 99);
  const COLUMNS = 560;
  const sTop = loft.sMax - 0.12;
  interface V { p: THREE.Vector3; n: THREE.Vector3; d: number; s: number; a: number }
  const grid: V[] = [];
  for (let i = 0; i <= rings; i++) {
    const s = sTop - (i / rings) * (sTop - 0.05);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      loft.surface(s, a, sfc);
      if (i > 0) prev[j] += pts[j].distanceTo(sfc.p);
      pts[j].copy(sfc.p);
      grid.push({ p: sfc.p.clone(), n: sfc.n.clone(), d: prev[j], s, a });
    }
  }
  for (let L = 0; L < layers; L++) {
    const lf = layers > 1 ? L / (layers - 1) : 0;
    const height = lerp(0.008, 0.03, lf);
    const start = b.pos.length / 3;
    for (let k = 0; k < grid.length; k++) {
      const g = grid[k];
      const j = k % (segs + 1);
      const phi = g.a <= Math.PI ? g.a / Math.PI : (2 * Math.PI - g.a) / Math.PI;
      const look = lookAt(species, g.s, phi);
      const { shade, gold, glit } = toneAt(species, look, g.s, phi);
      let fuzz = look.fuzz ?? Math.min(0.55 + (look.loose ?? 0) * 0.6, 1);
      // keep the eyes and the root of the bill clear
      for (const side of SIDES) fuzz *= smoothstep(species.eye.radius * 1.25, species.eye.radius * 2.1, g.p.distanceTo(rig.eyes[side].center));
      fuzz *= 1 - smoothstep(loft.sMax - 0.7, loft.sMax - 0.2, g.s);
      // no body fuzz growing through the folded blades (the wing root keeps it)
      {
        const q = new THREE.Vector3(Math.abs(g.p.x), g.p.y, g.p.z);
        const ab = rig.wingLine[1].clone().sub(rig.wingLine[0]);
        const wt = clamp(q.clone().sub(rig.wingLine[0]).dot(ab) / ab.lengthSq(), 0, 1);
        const wd = q.distanceTo(ab.multiplyScalar(wt).add(rig.wingLine[0]));
        if (wt > 0.13) fuzz *= smoothstep(0.035, 0.085, wd);
      }
      const sp = specFromLook(look, rng, shade, gold, species.shading.gold, glit);
      iriN.copy(g.n);
      if (look.iriAim) iriN.lerp(aim.set(look.iriAim[0], look.iriAim[1], look.iriAim[2]).normalize(), look.iriAlign).normalize();
      // small feathers, short fuzz: the head must not wear a halo
      P.copy(g.p).addScaledVector(g.n, height * (0.5 + 0.5 * Math.min(fuzz * 2, 1)) * clamp(look.width / 0.03, 0.4, 1));
      const sk = loft.skin(g.s, g.a);
      b.pos.push(P.x, P.y, P.z);
      b.nor.push(g.n.x, g.n.y, g.n.z);
      b.uv.push((j / segs) * COLUMNS, g.d);
      b.root.push(P.x, P.y, P.z);
      b.hinge.push(1, 0, 0);
      b.data.push(lf, loft.bodyCoord(g.s) * 0.8, look.lift, CH_FUZZ);
      b.iriN.push(iriN.x, iriN.y, iriN.z);
      // fuzz over the show scales stays dark: the scales do the shining
      b.cBase.push(sp.base.r, sp.base.g, sp.base.b, look.fine ? 0 : (look.iriStrength * glit * (1 + gold)) / 4);
      b.cTip.push(sp.tip.r, sp.tip.g, sp.tip.b, fuzz);
      b.cIri.push(sp.iri.r, sp.iri.g, sp.iri.b, look.iriPower / 32);
      b.cIri2.push(sp.iri2.r, sp.iri2.g, sp.iri2.b, lf);
      b.si.push(...sk.bones.map((nm) => rig.index(nm)));
      b.sw.push(...sk.weights);
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * (segs + 1) + j;
        const c = a + segs + 1;
        // rings run bill → tail, so this winding faces out
        b.idx.push(a, c, a + 1, c, c + 1, a + 1);
      }
    }
  }
  return b;
}

export interface PlumageGeometry {
  contour: THREE.BufferGeometry;
  flight: THREE.BufferGeometry;
  fuzz: THREE.BufferGeometry;
  stats: { contourFeathers: number; flightFeathers: number; vertices: number; triangles: number };
}

export function buildPlumageGeometry(rig: Rig): PlumageGeometry {
  const rng = mulberry32(rig.species.seed);
  const contour = new Builder();
  addContour(contour, rig, rng);
  const flight = new Builder();
  for (const side of SIDES) addWing(flight, rig, side, rng);
  addTail(flight, rig, rng);
  const fuzz = buildFuzz(rig);
  return {
    contour: contour.build(),
    flight: flight.build(),
    fuzz: fuzz.build(),
    stats: {
      contourFeathers: contour.feathers,
      flightFeathers: flight.feathers,
      vertices: (contour.pos.length + flight.pos.length + fuzz.pos.length) / 3,
      triangles: (contour.idx.length + flight.idx.length + fuzz.idx.length) / 3,
    },
  };
}

/** The skin under the feathers: the loft itself, skinned to the spine. */
export function buildSkinGeometry(rig: Rig, rings = 64, segs = 36, inset = 0.007) {
  const sfc: SurfacePoint = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3() };
  const { loft } = rig;
  const pos: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const s = (i / rings) * loft.sMax;
    for (let j = 0; j <= segs; j++) {
      const ang = (j / segs) * Math.PI * 2;
      const sk = loft.skin(s, ang);
      loft.surface(s, ang, sfc);
      p.copy(sfc.p).addScaledVector(sfc.n, -inset);
      pos.push(p.x, p.y, p.z);
      si.push(...sk.bones.map((n) => rig.index(n)));
      sw.push(...sk.weights);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
