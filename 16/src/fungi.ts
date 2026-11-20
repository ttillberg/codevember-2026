// Small fungi pushing up through the moss: funnel chanterelles (yellowfoot) and finger fungi (clubs and
// little corals). They grow slowly, one after another, never all at once; the growing tips feel their way
// round in slow circles, as they do in a timelapse, and settle when they are done. Every stem is sinuous.
// Wet and a little slimy: a glistening sheen that moves, light coming through the thin flesh.
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { buildDew } from './dew';
import { loadModel, instancedModel, modelWeights, modelVertexShader, MODELS, MODEL_KINDS, isModelKind, type ModelKind } from './models';

export type FungusKind = 'funnel' | 'finger' | 'chanterelle' | 'puffball' | 'agaric' | 'porcini' | 'slippery' | 'morel' | 'waxcap';

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ---------------------------------------------------------------------------------------------------------
// geometry buffers: position, part (0 stem, 0.2 a netted stem, 1 underside, 2 funnel inside or cap top, 3 finger,
// 4 puffball, 5 fly agaric's cap, 6 a bolete's cap (6.3 slimy, 6.45 a waxcap's), 7 pores (7.3 gills), 8 a
// morel's honeycomb; 0.4 a dotted stem), along, around, tint
// drops: beads of water on fresh growth, (x, y, z, radius), drawn with the dew
interface Buf { pos: number[]; part: number[]; uvf: number[]; tint: number[]; idx: number[]; drops: number[] }
const newBuf = (): Buf => ({ pos: [], part: [], uvf: [], tint: [], idx: [], drops: [] });
/** A bead of water that comes out while it grows (after `at`, 0..1 of its growth) and stays. */
function bead(b: Buf, x: number, y: number, z: number, r: number, g: number, at: number) {
  const k = THREE.MathUtils.smoothstep(g, at, at + 0.15) * (1 - THREE.MathUtils.smoothstep(ROT, 0, 0.3)); // dry up first
  if (k > 0.02) b.drops.push(x, y, z, r * (0.4 + 0.6 * k));
}
const frac = (x: number) => x - Math.floor(x);

// Withering: how far the cluster being built has gone (0 fresh .. 1 gone), set by Fungi.rebuild around a build.
// The build functions read it: colours go dark brown, caps droop and roll in, stems keel over, fingers sag,
// puffballs go slack, and it all sinks into the moss.
let ROT = 0;
const WITHER = 16; // seconds from the first browning to gone
function rotTint(t: number[]) {
  const k = Math.pow(ROT, 0.7) * 0.85;
  return [t[0] + (0.1 - t[0]) * k, t[1] + (0.07 - t[1]) * k, t[2] + (0.045 - t[2]) * k];
}

// ---- finger fungi -----------------------------------------------------------------------------------------
interface Finger {
  base: THREE.Vector3; // relative to the cluster
  L: number; r: number;
  az: number; tilt: number; // which way it leans out, and how far from upright
  bend: number; // how much it curls over along its length
  wob: [number, number, number, number]; // sinuous: two frequencies and phases
  delay: number; dur: number; phase: number;
  fork: number; // 0 = none, else where along it splits in two
  tint: [number, number, number];
}

const FR = 8; // around a finger

/** Points along a finger at growth g: a path that leans, curls and wanders, its tip circling while it grows. */
function fingerPath(f: Finger, g: number, time: number, from: THREE.Vector3, dir0: { az: number; el: number }, len: number, segs: number) {
  const pts: THREE.Vector3[] = [from.clone()];
  const p = from.clone();
  const growing = g < 1 ? 1 - g : 0;
  for (let i = 1; i <= segs; i++) {
    const s = i / segs; // along the visible part
    const sl = s * len / f.L; // along the whole finger
    let el = dir0.el - f.bend * sl * sl;
    let az = dir0.az + f.wob[0] * Math.sin(sl * f.wob[1] + f.phase);
    el += f.wob[2] * Math.sin(sl * f.wob[3] + f.phase * 1.7);
    // nutation: the growing tip feels its way round
    const tipW = s * s * growing;
    az += Math.sin(time * 0.8 + f.phase) * 0.9 * tipW;
    el += Math.cos(time * 0.65 + f.phase * 1.3) * 0.35 * tipW;
    const ce = Math.cos(el);
    p.x += Math.cos(az) * ce * (len / segs);
    p.y += Math.sin(el) * (len / segs);
    p.z += Math.sin(az) * ce * (len / segs);
    pts.push(p.clone());
  }
  return pts;
}

/** A tube along `pts`, radius by `rad(s)`, closed with a rounded tip if `cap`. */
function tube(b: Buf, pts: THREE.Vector3[], rad: (s: number) => number, cap: boolean, tint: number[], along0: number, along1: number, tipFresh: number) {
  const n = pts.length;
  const T = new THREE.Vector3(), N = new THREE.Vector3(1, 0, 0), B = new THREE.Vector3(), tmp = new THREE.Vector3();
  const rings: { c: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3; r: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    // parallel transport: keep the ring from twisting
    N.addScaledVector(T, -N.dot(T));
    if (N.lengthSq() < 1e-6) N.set(0, 0, 1).addScaledVector(T, -T.z);
    N.normalize();
    B.crossVectors(T, N);
    const s = i / (n - 1);
    rings.push({ c: pts[i], n: N.clone(), b: B.clone(), r: rad(s), s });
  }
  if (cap) {
    // a blunt, rounded end: three more rings closing in, the last a point
    const last = rings[n - 1];
    T.subVectors(pts[n - 1], pts[n - 2]).normalize();
    for (let k = 1; k <= 3; k++) {
      const a = (k / 3) * Math.PI * 0.5;
      rings.push({ c: tmp.copy(last.c).addScaledVector(T, Math.sin(a) * last.r).clone(), n: last.n, b: last.b, r: Math.cos(a) * last.r + 1e-5, s: 1 });
    }
  }
  const start = b.pos.length / 3;
  for (const ring of rings) {
    for (let k = 0; k < FR; k++) {
      const a = (k / FR) * Math.PI * 2;
      const x = ring.c.x + (ring.n.x * Math.cos(a) + ring.b.x * Math.sin(a)) * ring.r;
      const y = ring.c.y + (ring.n.y * Math.cos(a) + ring.b.y * Math.sin(a)) * ring.r;
      const z = ring.c.z + (ring.n.z * Math.cos(a) + ring.b.z * Math.sin(a)) * ring.r;
      b.pos.push(x, y, z);
      b.part.push(3);
      b.uvf.push(along0 + (along1 - along0) * ring.s, k / FR);
      // the growing tip is paler, fresh
      const fresh = tipFresh * Math.pow(ring.s, 6);
      b.tint.push(tint[0] + (0.85 - tint[0]) * fresh, tint[1] + (0.82 - tint[1]) * fresh, tint[2] + (0.72 - tint[2]) * fresh);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < FR; k++) {
    const a = start + i * FR + k, c = start + i * FR + ((k + 1) % FR);
    b.idx.push(a, a + FR, c, c, a + FR, c + FR);
  }
}

function buildFingerCluster(b: Buf, fingers: Finger[], age: number, time: number) {
  for (const f0 of fingers) {
    // withering: they sag over, darken, and sink
    const f = ROT > 0 ? { ...f0, bend: f0.bend + ROT * 2.2, tint: rotTint(f0.tint) as [number, number, number], base: f0.base.clone().setY(f0.base.y - ROT * ROT * f0.L * 0.4) } : f0;
    const g = clamp01((age - f.delay) / f.dur);
    if (g <= 0) continue;
    // a speed that varies a little as it goes: growth comes in pulses
    const gl = ease(clamp01(g + 0.025 * Math.sin(g * 18 + f.phase)));
    const len = Math.max(0.002, f.L * gl);
    const el0 = Math.PI / 2 - f.tilt;
    const rad = (lenNow: number) => (s: number) => {
      const sl = (s * lenNow) / f.L;
      // the growing tip swells a little, a soft club that is still pushing out
      const club = 1 + 0.35 * (1 - g) * THREE.MathUtils.smoothstep(s, 0.7, 1);
      return f.r * club * (0.65 + 0.35 * THREE.MathUtils.smoothstep(sl, 0, 0.12)) * (1 - 0.5 * sl) * (1 + 0.12 * Math.sin(sl * 13 + f.phase)) * (0.6 + 0.4 * Math.min(1, gl * 3));
    };
    // a bead of water on the side, a little below the tip, on about half of them
    const drop = (pts: THREE.Vector3[], r: number) => {
      if (frac(f.phase * 3.7) > 0.5 || pts.length < 5) return;
      const q = pts[pts.length - 4], a = f.phase * 5.1;
      bead(b, q.x + Math.cos(a) * r * 1.3, q.y, q.z + Math.sin(a) * r * 1.3, r * 0.9, g, 0.35 + 0.3 * frac(f.phase * 2.3));
    };
    if (f.fork > 0 && gl > f.fork) {
      // split: the trunk up to the fork, then two arms going on from there, thinner, apart
      const trunkLen = f.L * f.fork;
      const trunk = fingerPath(f, 1, time, f.base, { az: f.az, el: el0 }, trunkLen, 8);
      tube(b, trunk, rad(trunkLen), false, f.tint, 0, f.fork, 0);
      const armG = (gl - f.fork) / (1 - f.fork);
      const armLen = Math.max(0.002, f.L * (1 - f.fork) * armG);
      const tip = trunk[trunk.length - 1];
      for (const side of [-1, 1]) {
        const arm: Finger = { ...f, r: f.r * 0.72, phase: f.phase + side * 2.1 };
        const pts = fingerPath(arm, g, time, tip, { az: f.az + side * 0.55, el: el0 - f.bend * f.fork * f.fork - 0.15 }, armLen, 8);
        tube(b, pts, (s) => arm.r * (1 - 0.5 * f.fork) * (1 - 0.45 * s * armG) * (1 + 0.35 * (1 - g) * THREE.MathUtils.smoothstep(s, 0.7, 1)), true, f.tint, f.fork, f.fork + (1 - f.fork) * armG, 1 - g);
        if (side > 0) drop(pts, arm.r * 0.6);
      }
    } else {
      const pts = fingerPath(f, g, time, f.base, { az: f.az, el: el0 }, len, 14);
      tube(b, pts, rad(len), true, f.tint, 0, gl, 1 - g);
      drop(pts, f.r * 0.6);
    }
  }
}

// ---- funnel chanterelles ----------------------------------------------------------------------------------
interface Funnel {
  base: THREE.Vector3;
  H: number; rs: number; R: number;
  wave: [number, number, number]; // rim waviness phases
  sway: [number, number, number, number]; // sinuous stem: amplitude and phase in x and z
  lean: [number, number]; // a straight lean, x and z per unit of height: away from its neighbours
  delay: number; dur: number; phase: number;
  tint: [number, number, number]; // the cap, inside the funnel or on top
  stemTint: [number, number, number];
  underTint: [number, number, number]; // the ridges under the cap
  solid: boolean; // a chanterelle: solid stem, fleshy cap with a shallow dip, no hollow
}
const FS = 40; // around a funnel

/** Where a funnel's centre is at height y, for a stem of height H: its lean and its sinuous sway. */
function funnelAxis(f: Funnel, y: number, H: number) {
  const h = Math.max(0, y) / Math.max(H, 1e-3);
  return [
    f.lean[0] * y + f.sway[0] * Math.sin(h * 2.4 + f.sway[1]) * H,
    f.lean[1] * y + f.sway[2] * Math.sin(h * 2.1 + f.sway[3]) * H,
  ];
}

/**
 * A grown funnel as layers: for each height, the centre and the outer radius (stem, then the flare, out to the
 * waving rim). The cluster layout tests new funnels against these, so they grow in among each other without
 * passing through: no physics, just the final shape, sliced.
 */
const LAYER = 0.003;
function funnelLayers(f: Funnel) {
  const { P } = funnelProfile(f, 1);
  // the outer silhouette: the stem and the flare's underside, up to the rim
  const outer = P.filter((p) => p[2] < 1.5);
  const top = outer[outer.length - 1][1];
  const layers: { y: number; x: number; z: number; r: number }[] = [];
  for (let y = 0; y <= top + 0.004; y += LAYER) {
    let r = outer[outer.length - 1][0];
    for (let i = 1; i < outer.length; i++) {
      if (outer[i][1] >= y) {
        const a = outer[i - 1], b = outer[i];
        const t = (y - a[1]) / Math.max(b[1] - a[1], 1e-6);
        r = a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, t));
        break;
      }
    }
    const [ax, az] = funnelAxis(f, y, f.H);
    layers.push({ y, x: f.base.x + ax, z: f.base.z + az, r: r * 1.17 }); // the rim's waves reach out ~17 %
  }
  return layers;
}

/** How far two funnels go into each other, at worst over their shared layers (0 = clear). Their feet may fuse. */
function funnelOverlap(a: ReturnType<typeof funnelLayers>, b: ReturnType<typeof funnelLayers>, fuseBelow: number) {
  let worst = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].y < fuseBelow) continue;
    const d = Math.hypot(a[i].x - b[i].x, a[i].z - b[i].z);
    // a little touching is fine: that is how they grow
    const into = a[i].r + b[i].r - d - 0.15 * Math.min(a[i].r, b[i].r);
    worst = Math.max(worst, into);
  }
  return worst;
}

/**
 * The funnel's profile at growth g: (r, y, part, along). Three phases, as in a timelapse: a pale knob pushes up
 * out of the moss (the pin), the stem stretches with the cap still shut over it like a domed button, then the cap
 * opens, its rim unrolling, the dome sinking into a dip (a chanterelle) or a funnel (a yellowfoot).
 */
function funnelProfile(f: Funnel, g: number, rot = 0) {
  const pin = ease(clamp01(g / 0.15));
  const stretch = ease(clamp01((g - 0.08) / 0.55));
  const open = ease(clamp01((g - 0.42) / 0.58));
  // a yellowfoot's slender stem shoots up before it opens; a chanterelle's grows with its cap
  const up = f.solid ? 0.45 * stretch + 0.55 * open : stretch;
  const H = f.H * (0.03 + 0.12 * pin + 0.85 * up) * (1 - 0.3 * rot); // withering, it slumps
  const rs = f.rs * (0.5 + 0.2 * pin + 0.3 * stretch);
  // shut, the cap is a button a little wider than the stem; open, it spreads to its full width
  const R = Math.max(rs * 1.3, f.R * (0.3 + 0.7 * open) * (0.45 + 0.55 * pin));
  const dome = Math.pow(1 - open, 1.5) * R * (f.solid ? 0.75 : 0.6); // how high the shut cap bulges
  const D = H * (f.solid ? 0.07 : 0.3) * open; // how deep the funnel goes; a chanterelle only dips
  const rimLift = f.R * (f.solid ? 0.12 : 0.25) * open * (1 - rot);
  const curl = 1 - open + 0.9 * rot; // young rims roll in, and old ones roll in again as they wither
  const P: number[][] = [];
  // a chanterelle's ridges run a long way down the stem
  const top = H - (f.solid ? 0.5 : 0.2) * H * open;
  // stem, from just inside the moss; a chanterelle's tapers down to its foot
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const r = f.solid ? rs * (0.62 + 0.38 * Math.pow(u, 0.8)) : rs * (1.15 - 0.2 * u);
    P.push([r, -0.006 + (top + 0.006) * u, 0, u * 0.6]);
  }
  // the flare's underside, with its false gills, out to the rim
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    P.push([rs + (R - rs) * Math.pow(t, 1.4), top + (H - top + rimLift) * Math.pow(t, 0.7) - curl * R * 0.5 * t * t, 1, 0.6 + 0.2 * t]);
  }
  // over the rim: rolled in when young; a chanterelle's is thick and fleshy
  const rimY = P[P.length - 1][1];
  const th = f.solid ? R * (0.07 + 0.1 * curl) : 0.0016 + 0.002 * curl;
  P.push([R + th * 0.3, rimY + th, 2, 0.8]);
  if (f.solid) {
    // the top of a chanterelle's cap: from the rim in and gently down to a shallow dip in the middle
    for (let i = 1; i <= 9; i++) {
      const t = i / 9;
      P.push([R * (1 - t), rimY + th - (rimY + th - (H + th - D)) * Math.pow(t, 0.6) + dome * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))), 2, 0.8 + 0.08 * t]);
    }
    return { P, H, R, open };
  }
  // the inside of the funnel, down into the hollow stem
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // shut, this is the domed top of the button; the dome sinks as it opens into a funnel
    const r = R - (R - rs * 0.45 * open) * Math.pow(t, 0.8);
    P.push([r, rimY + th - (rimY + th - (H - D)) * Math.pow(t, 1.3) + dome * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))), 2, 0.8 + 0.2 * t]);
  }
  P.push([rs * 0.25 * open, H - D - 0.004 * open + dome, 2, 1]);
  P.push([0, H - D - 0.006 * open + dome, 2, 1]);
  return { P, H, R, open };
}

function buildFunnel(b: Buf, f: Funnel, age: number, time: number) {
  const g = clamp01((age - f.delay) / f.dur);
  if (g <= 0) return;
  const gg = clamp01(g + 0.02 * Math.sin(g * 15 + f.phase));
  const { P, H, R, open } = funnelProfile(f, gg, ROT);
  // withering, it keels over its own way and sinks
  const fall = ROT * ROT, fx = Math.cos(f.phase * 2.3), fz = Math.sin(f.phase * 2.3);
  const growing = 1 - g;
  const start = b.pos.length / 3;
  const n = P.length;
  // where profile point i lands at angle a: the rim waves, more as it opens; a sinuous stem, and while growing
  // the top sways round feeling for the light
  const vert = (i: number, a: number) => {
    const [r0, y] = P[i];
    const rimW = THREE.MathUtils.smoothstep(r0, R * 0.55, R) * open;
    const wave = 0.16 * Math.sin(3 * a + f.wave[0]) + 0.09 * Math.sin(5 * a + f.wave[1]) + 0.06 * Math.sin(2 * a + f.wave[2]);
    const r = r0 * (1 + wave * rimW);
    const yy = y + Math.sin(2 * a + f.wave[1] + 1.3) * R * 0.2 * rimW + wave * R * 0.15 * rimW;
    const h = Math.max(0, yy) / Math.max(H, 1e-3);
    const [ax, az] = funnelAxis(f, yy, H);
    const sx = ax + Math.sin(time * 0.7 + f.phase) * 0.004 * growing * h * h;
    const sz = az + Math.cos(time * 0.55 + f.phase) * 0.004 * growing * h * h;
    const keel = fall * Math.max(0, yy) * Math.max(0, yy) / Math.max(H, 1e-3) * 1.1; // the stem bends over, more towards the top
    return [f.base.x + Math.cos(a) * r + sx + fx * keel, f.base.y + yy - fall * (H * 0.35 + keel * 0.4), f.base.z + Math.sin(a) * r + sz + fz * keel];
  };
  for (let i = 0; i < n; i++) {
    const [, , part, along] = P[i];
    for (let k = 0; k < FS; k++) {
      const [x, y, z] = vert(i, (k / FS) * Math.PI * 2);
      b.pos.push(x, y, z);
      b.part.push(part);
      b.uvf.push(along, k / FS);
      // each part its own colour; pins come up pale, nearly white, and colour in as they grow
      const t = rotTint(part === 0 ? f.stemTint : part === 1 ? f.underTint : f.tint);
      const fresh = 0.6 * (1 - THREE.MathUtils.smoothstep(g, 0.05, 0.75));
      b.tint.push(t[0] + (0.8 - t[0]) * fresh, t[1] + (0.74 - t[1]) * fresh, t[2] + (0.6 - t[2]) * fresh);
    }
  }
  // beads of water: one or two sitting on the cap (a funnel's rim, a chanterelle's top), out as it opens
  const rim = P.findIndex((p) => p[2] === 2); // the first point over the rim
  for (let j = 0; j < 2; j++) {
    const h = frac(f.phase * (3.1 + j * 1.7));
    if (j === 1 && h > 0.5) break;
    const i = f.solid ? Math.min(n - 1, rim + 3 + Math.floor(h * 4)) : rim;
    const [x, y, z] = vert(i, h * Math.PI * 2);
    const r = 0.0012 + 0.0012 * frac(h * 7.3);
    bead(b, x, y + r * 0.6, z, r, g, 0.55 + 0.25 * h);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < FS; k++) {
    const a = start + i * FS + k, c = start + i * FS + ((k + 1) % FS);
    b.idx.push(a, a + FS, c, c, a + FS, c + FS);
  }
}

// ---- puffballs ------------------------------------------------------------------------------------------
interface Puff {
  base: THREE.Vector3;
  H: number; R: number;
  delay: number; dur: number; phase: number;
  age: number; // how ripe, 0 white and firm .. 1 brown with an open pore
  squash: number; // 1 just pressed, puffing, easing back to 0
}
const PS = 36; // around a puffball

/** A pear: a short stem widening into a round head, from a small white button. Part 4. */
function buildPuffball(b: Buf, p: Puff, age: number) {
  const g = clamp01((age - p.delay) / p.dur);
  if (g <= 0) return;
  // a white knob pushes up out of the moss, swells into a ball, and last the foot lifts it on a short stem
  const gg = clamp01(g + 0.02 * Math.sin(g * 13 + p.phase));
  const pin = ease(clamp01(gg / 0.2)), swell = ease(clamp01((gg - 0.1) / 0.6)), lift = ease(clamp01((gg - 0.45) / 0.55));
  const sq = p.squash * p.squash;
  const R0 = p.R * (0.25 + 0.15 * pin + 0.6 * swell);
  // withering, it goes slack and flattens, and sinks
  const H = (R0 * 1.7 + (p.H - p.R * 1.7) * lift) * (1 - 0.22 * sq) * (1 - 0.45 * ROT);
  const R = R0 * (1 + 0.1 * sq) * (1 + 0.12 * ROT);
  const sink = (1 - pin) * R * 1.6 + (1 - lift) * R * 0.7 + ROT * ROT * R * 0.8; // under the moss, the foot too until it lifts
  // a round head on a stout foot that narrows down into the moss, with a little point on top
  const prof: number[][] = [];
  const N = 26;
  const Rv = R * 0.8, hc = H - Rv; // the head's centre, the head a little flattened
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -0.004 + (H + 0.004) * t;
    const dy = (y - hc) / Rv;
    const head = R * Math.sqrt(Math.max(0, 1 - Math.min(1, dy * dy)));
    const f = clamp01(y / Math.max(1e-4, hc));
    const foot = R * (0.3 + 0.5 * f * f * (3 - 2 * f));
    // smooth max of head and foot so the head swells out of the foot without a crease
    const k = R * 0.6, hh = clamp01(0.5 + 0.5 * (head - foot) / k);
    let r = dy > 0 ? head : foot + (head - foot) * hh + k * hh * (1 - hh);
    if (t > 0.9) r *= 1 - 0.3 * (t - 0.9) / 0.1; // the point
    prof.push([r, y, t]);
  }
  const start = b.pos.length / 3;
  const tint = rotTint([0.86 - 0.3 * p.age, 0.82 - 0.34 * p.age, 0.72 - 0.38 * p.age]);
  for (const [r, y, along] of prof) {
    for (let k = 0; k < PS; k++) {
      const a = (k / PS) * Math.PI * 2;
      b.pos.push(p.base.x + Math.cos(a) * r, p.base.y + y - sink, p.base.z + Math.sin(a) * r);
      b.part.push(4);
      b.uvf.push(along, k / PS);
      const fresh = (1 - g) * 0.5;
      b.tint.push(tint[0] + (0.95 - tint[0]) * fresh, tint[1] + (0.93 - tint[1]) * fresh, tint[2] + (0.88 - tint[2]) * fresh);
    }
  }
  // a bead or two of water on the head, up on its shoulder
  for (let j = 0; j < 2; j++) {
    const h = frac(p.phase * (2.3 + j * 1.9));
    if (j === 1 && h > 0.45) break;
    const [r, y] = prof[Math.floor(N * (0.72 + 0.12 * h))], a = h * Math.PI * 2, dr = R * (0.07 + 0.05 * h);
    bead(b, p.base.x + Math.cos(a) * (r + dr * 0.4), p.base.y + y - sink + dr * 0.3, p.base.z + Math.sin(a) * (r + dr * 0.4), dr, g, 0.5 + 0.3 * h);
  }
  for (let i = 0; i < prof.length - 1; i++) for (let k = 0; k < PS; k++) {
    const a = start + i * PS + k, c = start + i * PS + ((k + 1) % PS);
    b.idx.push(a, a + PS, c, c, a + PS, c + PS);
  }
}

// ---- fly agaric -----------------------------------------------------------------------------------------
interface Agaric {
  base: THREE.Vector3;
  H: number; R: number; rs: number;
  lean: [number, number];
  delay: number; dur: number; phase: number;
  red: [number, number, number];
}
const AS = 40; // around a fly agaric

/** One ring of a lathe at radius r and height y, around the axis (ax, az), into the buffer. */
function ring(b: Buf, n: number, cx: number, cy: number, cz: number, r: number, part: number, along: number, t: number[]) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    b.pos.push(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r);
    b.part.push(part);
    b.uvf.push(along, k / n);
    b.tint.push(t[0], t[1], t[2]);
  }
}
function stitch(b: Buf, start: number, rings: number, n: number) {
  for (let i = 0; i < rings - 1; i++) for (let k = 0; k < n; k++) {
    const a = start + i * n + k, c = start + i * n + ((k + 1) % n);
    b.idx.push(a, a + n, c, c, a + n, c + n);
  }
}

/**
 * A fly agaric at growth g. It comes up as a white egg: the universal veil wrapped round a domed cap pressed
 * down on a bulb. The stem stretches and the red cap breaks through the veil, which stays on it as white warts
 * (part 5, the veil's cover carried in the part number) that spread apart as the cap grows. The cap opens from a
 * dome to nearly flat; the partial veil over the gills tears from the rim and hangs as a skirt on the stem.
 */
function buildAgaric(b: Buf, m: Agaric, age: number) {
  const g = clamp01((age - m.delay) / m.dur);
  if (g <= 0) return;
  const gg = clamp01(g + 0.02 * Math.sin(g * 11 + m.phase));
  const pin = ease(clamp01(gg / 0.18)), stretch = ease(clamp01((gg - 0.1) / 0.5)), open = ease(clamp01((gg - 0.45) / 0.55));
  const veil = 1 - THREE.MathUtils.smoothstep(gg, 0.1, 0.45); // 1: all white egg, 0: only the warts left
  const H = m.H * (0.06 + 0.14 * pin + 0.8 * stretch) * (1 - 0.3 * ROT);
  const rs = m.rs * (0.6 + 0.4 * stretch);
  const R = Math.max(rs * 1.5, m.R * (0.35 + 0.65 * open) * (0.5 + 0.5 * pin));
  // the cap is a piece of a sphere: theta past a right angle is a dome with its rim tucked under, near zero flat
  const th = 1.7 - 1.2 * open + 0.6 * ROT; // withering, the rim curls down again
  const Rc = R / Math.sin(th);
  const thick = R * 0.22;
  const sink = (1 - pin) * R * 0.9 + ROT * ROT * H * 0.3;
  const fall = ROT * ROT, fx = Math.cos(m.phase * 2.3), fz = Math.sin(m.phase * 2.3);
  const at = (y: number) => {
    const yy = Math.max(0, y);
    const keel = fall * yy * yy / Math.max(H, 1e-3) * 1.1;
    return [m.base.x + m.lean[0] * yy + fx * keel, m.base.y + y - sink - keel * 0.4 * fall, m.base.z + m.lean[1] * yy + fz * keel];
  };
  const white = rotTint([0.9, 0.87, 0.8]), gill = rotTint([0.93, 0.9, 0.82]), red = rotTint(m.red);
  // the cap's top surface, from the centre (t = 0) to the rim (t = 1), and its underside a little below
  const capY = (t: number) => H - Rc * (1 - Math.cos(t * th));
  const capR = (t: number) => Rc * Math.sin(t * th);
  const tS = Math.min(1, Math.asin(Math.min(1, rs / Rc)) / th); // where the underside meets the stem
  const stemTop = capY(tS) - thick;
  // stem and bulb, the cap's underside out to the rim, over the rim and across the top to the centre
  const P: [number, number, number, number, number[]][] = [];
  const bulbH = rs * 2.2;
  for (let i = 0; i <= 12; i++) {
    const u = i / 12, y = -0.006 + (stemTop + 0.006) * u;
    const bulb = Math.exp(-Math.max(0, y) / bulbH);
    // the bulb, with ragged rings of the veil round it
    const rag = 1 + 0.07 * bulb * Math.max(0, Math.sin(y / bulbH * 9 + m.phase));
    P.push([rs * (1.0 - 0.08 * u + 0.75 * bulb) * rag, y, 0, u * 0.6, white]);
  }
  for (let i = 1; i <= 8; i++) {
    const t = tS + (1 - tS) * (i / 8);
    P.push([capR(t), capY(t) - thick * (1 - 0.7 * t), 1, 0.6 + 0.2 * (i / 8), gill]);
  }
  for (let i = 0; i <= 12; i++) {
    const t = 1 - i / 12;
    P.push([capR(t) + (i === 0 ? thick * 0.15 : 0), capY(t), 5 + 0.9 * veil, t, red]);
  }
  const start = b.pos.length / 3;
  for (const [r, y, part, along, t] of P) {
    const [cx, cy, cz] = at(y);
    ring(b, AS, cx, cy, cz, r, part, along, t);
  }
  stitch(b, start, P.length, AS);
  // the skirt: the partial veil, first spread from the stem to the rim over the gills, then torn and hanging
  const tear = THREE.MathUtils.smoothstep(open, 0.25, 0.6);
  if (pin > 0.5) {
    const yr = stemTop - (stemTop - bulbH) * 0.18;
    const rimR = capR(1) * 0.96, rimY = capY(1) - thick * 0.3;
    const hangR = rs * 1.9, hangY = yr - H * 0.1;
    const ex = rimR + (hangR - rimR) * tear, ey = rimY + (hangY - rimY) * tear;
    const s0 = b.pos.length / 3;
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      const r = rs * 1.02 + (ex - rs * 1.02) * u;
      const y = yr + (ey - yr) * u - Math.sin(u * Math.PI) * H * 0.03 * tear; // it sags
      const [cx, cy, cz] = at(y);
      ring(b, AS, cx, cy, cz, r, 0, 0.62, white);
    }
    stitch(b, s0, 5, AS);
  }
  // a bead or two on the cap
  for (let j = 0; j < 2; j++) {
    const h = frac(m.phase * (2.7 + j * 1.3));
    if (j === 1 && h > 0.5) break;
    const t = 0.35 + 0.4 * h, a = h * Math.PI * 2, dr = 0.0012 + 0.001 * h;
    const [cx, cy, cz] = at(capY(t));
    bead(b, cx + Math.cos(a) * capR(t), cy + dr * 0.6, cz + Math.sin(a) * capR(t), dr, g, 0.6 + 0.25 * h);
  }
}

// ---- capped fungi: boletes and the like ---------------------------------------------------------------------
// A cap on a stem, as the fly agaric but without its veil, in a few styles: what the stem does (a barrel, a
// taper), how thick and round the cap is, what is under it.
interface CapStyle {
  capPart: number; // the cap top's part number (6 a bolete)
  underPart: number; // what is under the cap (7 pores)
  stemPart: number; // 0 plain, 0.2 netted
  thick: number; // the cap's flesh, times R
  th0: number; th1: number; // the cap's sphere angle shut and open
  bulb: number; bulbAt: number; // the stem swells by this much about this far up (0..1)
  umbo?: number; // a low hump in the middle of the cap, times R
  ring?: number[]; // a partial veil over the pores that tears into a ring on the stem, this colour
  decurrent?: number; // gills that run down the stem this far, times H
}
interface Capped {
  base: THREE.Vector3;
  H: number; R: number; rs: number;
  lean: [number, number];
  delay: number; dur: number; phase: number;
  style: CapStyle;
  cap: number[]; stem: number[]; under: number[];
}
// karljohan (Boletus edulis): a fat barrel of a stem, netted white at the top, under a thick brown bun of a cap,
// white pores going olive-yellow
const PORCINI: CapStyle = { capPart: 6, underPart: 7, stemPart: 0.2, thick: 0.42, th0: 1.75, th1: 1.12, bulb: 1.05, bulbAt: 0.18 };
// smörsopp (Suillus luteus): a slimy chestnut cap with a low hump, opening flatter, yellow pores under a pale veil
// that tears into a ring, a yellowish stem dotted brown above it
// sotvaxskivling (Hygrophorus camarophyllus): a sooty grey-brown cap streaked with fibres, opening flat round a
// broad hump; thick, far-apart waxy white gills running down a white stem
const WAXCAP: CapStyle = { capPart: 6.45, underPart: 7.3, stemPart: 0, thick: 0.22, th0: 1.55, th1: 0.72, bulb: 0, bulbAt: 0.5, umbo: 0.12, decurrent: 0.16 };
const SLIPPERY: CapStyle = { capPart: 6.3, underPart: 7, stemPart: 0.4, thick: 0.36, th0: 1.6, th1: 1.0, bulb: 0.2, bulbAt: 0.1, umbo: 0.07, ring: [0.58, 0.5, 0.56] };

/**
 * A capped fungus at growth g: a knob that pushes up (a young bolete is all stem, a cork with a small cap
 * pressed on it), the stem stretching, then the cap widening and opening from a tight dome.
 */
function buildCapped(b: Buf, m: Capped, age: number) {
  const g = clamp01((age - m.delay) / m.dur);
  if (g <= 0) return;
  const st = m.style;
  const gg = clamp01(g + 0.02 * Math.sin(g * 11 + m.phase));
  const pin = ease(clamp01(gg / 0.2)), stretch = ease(clamp01((gg - 0.1) / 0.55)), open = ease(clamp01((gg - 0.35) / 0.65));
  const H = m.H * (0.12 + 0.18 * pin + 0.7 * stretch) * (1 - 0.3 * ROT);
  const rs = m.rs * (0.55 + 0.45 * pin) * (0.85 + 0.15 * stretch);
  const R = Math.max(rs * 1.15, m.R * (0.4 + 0.6 * open) * (0.55 + 0.45 * pin));
  const th = st.th0 + (st.th1 - st.th0) * open + 0.5 * ROT;
  const Rc = R / Math.sin(th);
  const thick = R * st.thick;
  const sink = (1 - pin) * H * 0.6 + ROT * ROT * H * 0.3;
  const fall = ROT * ROT, fx = Math.cos(m.phase * 2.3), fz = Math.sin(m.phase * 2.3);
  const at = (y: number) => {
    const yy = Math.max(0, y);
    const keel = fall * yy * yy / Math.max(H, 1e-3) * 1.1;
    return [m.base.x + m.lean[0] * yy + fx * keel, m.base.y + y - sink - keel * 0.4 * fall, m.base.z + m.lean[1] * yy + fz * keel];
  };
  const capC = rotTint(m.cap), stemC = rotTint(m.stem), underC = rotTint(m.under);
  const capY = (t: number) => H - Rc * (1 - Math.cos(t * th)) + (st.umbo ?? 0) * R * open * (1 - THREE.MathUtils.smoothstep(t, 0, 0.45));
  const capR = (t: number) => Rc * Math.sin(t * th);
  const tS = Math.min(1, Math.asin(Math.min(1, rs / Rc)) / th);
  const dec = (st.decurrent ?? 0) * H * open; // gills running down the stem: the stem ends that much lower
  const stemTop = capY(tS) - thick - dec;
  const P: [number, number, number, number, number[]][] = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14, y = -0.006 + (stemTop + 0.006) * u;
    const swell = st.bulb * Math.exp(-Math.pow((u - st.bulbAt) / 0.38, 2)) * (0.6 + 0.4 * (1 - open));
    P.push([rs * (1 + swell) * (1 - 0.1 * u), y, st.stemPart, u * 0.6, stemC]);
  }
  if (st.decurrent) {
    // gills: from down on the stem, flaring out under the cap to just inside the rim
    const y1 = capY(1) - thick * 0.45;
    for (let i = 1; i <= 9; i++) {
      const u = i / 9, e = 1 - (1 - u) * (1 - u);
      P.push([rs + (capR(1) * 0.97 - rs) * Math.pow(u, 0.8), stemTop + (y1 - stemTop) * e, st.underPart, 0.6 + 0.2 * u, underC]);
    }
  } else {
    // under the cap: the pore layer, thick and nearly flat, from the stem out to just inside the rim
    for (let i = 1; i <= 8; i++) {
      const t = tS + (1 - tS) * (i / 8);
      const flat = capY(1) - thick * 0.85;
      P.push([capR(t) * (0.98 - 0.05 * (i / 8)), Math.min(capY(t) - thick, flat + (capY(tS) - thick - flat) * (1 - i / 8)), st.underPart, 0.6 + 0.2 * (i / 8), underC]);
    }
  }
  // over the rim, rounded, and across the top to the middle
  for (let i = 0; i <= 14; i++) {
    const t = 1 - i / 14;
    const roll = i === 0 ? thick * 0.25 : i === 1 ? thick * 0.1 : 0;
    P.push([capR(t) + roll, capY(t) - (i === 0 ? thick * 0.45 : 0), st.capPart, t, capC]);
  }
  const start = b.pos.length / 3;
  for (const [r, y, part, along, t] of P) {
    const [cx, cy, cz] = at(y);
    ring(b, AS, cx, cy, cz, r, part, along, t);
  }
  stitch(b, start, P.length, AS);
  // the partial veil: first a skin from the stem to the rim over the pores, then torn and hanging as a ring
  if (st.ring && pin > 0.5) {
    const tear = THREE.MathUtils.smoothstep(open, 0.15, 0.5);
    const yr = Math.min(stemTop * 0.72, capY(1) - thick * 1.2); // below the rim, or the rim hides it
    const rimR = capR(1) * 0.94, rimY = capY(1) - thick * 0.6;
    const hangR = rs * 1.55, hangY = yr - H * 0.16;
    const ex = rimR + (hangR - rimR) * tear, ey = rimY + (hangY - rimY) * tear;
    const ringC = rotTint(st.ring);
    const s0 = b.pos.length / 3;
    for (let i = 0; i <= 3; i++) {
      const u = i / 3;
      const r = rs * 1.03 + (ex - rs * 1.03) * u;
      const y = yr + (ey - yr) * u - Math.sin(u * Math.PI) * H * 0.02 * tear;
      const [cx, cy, cz] = at(y);
      ring(b, AS, cx, cy, cz, r, 0, 0.5, ringC);
    }
    stitch(b, s0, 4, AS);
  }
  // a bead or two on the cap
  for (let j = 0; j < 2; j++) {
    const h = frac(m.phase * (2.3 + j * 1.7));
    if (j === 1 && h > 0.5) break;
    const t = 0.3 + 0.45 * h, a = h * Math.PI * 2, dr = 0.0012 + 0.001 * h;
    const [cx, cy, cz] = at(capY(t));
    bead(b, cx + Math.cos(a) * capR(t), cy + dr * 0.6, cz + Math.sin(a) * capR(t), dr, g, 0.6 + 0.25 * h);
  }
}

// ---- morels ----------------------------------------------------------------------------------------------
interface Morel {
  base: THREE.Vector3;
  H: number; R: number; rs: number; capH: number; // all of it; the cap's radius at its foot; the stem; the cap's height
  lean: [number, number];
  delay: number; dur: number; phase: number;
  cap: number[]; stem: number[];
}
/**
 * Toppmurkla (Morchella elata) at growth g: a tall cone of honeycomb (part 8: pits between dark ridges, in the
 * shader) set straight on a pale hollow stem, with a little groove where they meet. It comes up a small dark cone
 * on almost no stem; the stem stretches under it as it grows.
 */
function buildMorel(b: Buf, m: Morel, age: number) {
  const g = clamp01((age - m.delay) / m.dur);
  if (g <= 0) return;
  const gg = clamp01(g + 0.02 * Math.sin(g * 11 + m.phase));
  const pin = ease(clamp01(gg / 0.25)), stretch = ease(clamp01((gg - 0.15) / 0.85));
  const capH = m.capH * (0.35 + 0.65 * (0.4 * pin + 0.6 * stretch)) * (1 - 0.25 * ROT);
  const R = m.R * (0.45 + 0.55 * (0.5 * pin + 0.5 * stretch)) * (1 - 0.15 * ROT);
  const stemH = (m.H - m.capH) * (0.1 + 0.9 * stretch) * (1 - 0.35 * ROT);
  const rs = m.rs * (0.6 + 0.4 * stretch);
  const H = stemH + capH;
  const sink = (1 - pin) * H * 0.7 + ROT * ROT * H * 0.25;
  const fall = ROT * ROT, fx = Math.cos(m.phase * 2.3), fz = Math.sin(m.phase * 2.3);
  const at = (y: number) => {
    const yy = Math.max(0, y);
    const keel = fall * yy * yy / Math.max(H, 1e-3) * 1.0;
    return [m.base.x + m.lean[0] * yy + fx * keel, m.base.y + y - sink - keel * 0.4 * fall, m.base.z + m.lean[1] * yy + fz * keel];
  };
  const capC = rotTint(m.cap), stemC = rotTint(m.stem);
  const P: [number, number, number, number, number[]][] = [];
  // the stem: wider and furrowed at the foot, the groove at the top where the cap sits on it
  for (let i = 0; i <= 10; i++) {
    const u = i / 10, y = -0.006 + (stemH + 0.006) * u;
    P.push([rs * (1 + 0.45 * Math.exp(-u / 0.22)) * (1 - 0.06 * u), y, 0, u * 0.5, stemC]);
  }
  P.push([rs * 0.95, stemH + capH * 0.02, 0, 0.5, stemC]);
  // the cap: from its foot, a hair out over the stem, up the cone to a blunt point
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = R * Math.pow(1 - t, 0.62) * (1 + 0.04 * Math.sin(t * 9 + m.phase)) * (i === 0 ? 0.97 : 1);
    P.push([Math.max(r, 0.0004), stemH + capH * (i === 0 ? 0.0 : t), 8, t, capC]);
  }
  const start = b.pos.length / 3;
  for (const [r, y, part, along, t] of P) {
    const [cx, cy, cz] = at(y);
    ring(b, AS, cx, cy, cz, r, part, along, t);
  }
  stitch(b, start, P.length, AS);
  // a bead caught in a pit or two
  for (let j = 0; j < 2; j++) {
    const h = frac(m.phase * (3.1 + j * 1.9));
    const t = 0.2 + 0.5 * h, a = h * Math.PI * 2, dr = 0.001 + 0.0008 * h;
    const [cx, cy, cz] = at(stemH + capH * t);
    const r = R * Math.pow(1 - t, 0.62);
    bead(b, cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, dr, g, 0.55 + 0.3 * h);
  }
}

/**
 * Lay out funnel-shaped fungi (funnel chanterelles, chanterelles) one by one, each tried against the ones
 * already there, layer by layer; when one would grow into another it leans away from it, goes taller or
 * shorter so they sit at different heights, gets a smaller cap, and if nothing works it is left out.
 */
function layoutFunnels(r: () => number, n: number, make: (i: number) => Funnel) {
  const placed: { f: Funnel; layers: ReturnType<typeof funnelLayers> }[] = [];
  for (let i = 0; i < n; i++) {
    const f = make(i);
    for (let attempt = 0; attempt < 14; attempt++) {
      const layers = funnelLayers(f);
      let worst = 0, from: Funnel | null = null;
      for (const p of placed) {
        const o = funnelOverlap(layers, p.layers, Math.min(f.H, p.f.H) * 0.15);
        if (o > worst) { worst = o; from = p.f; }
      }
      if (worst <= 0) { placed.push({ f, layers }); break; }
      const dx = f.base.x - from!.base.x + 1e-4 * (r() - 0.5), dz = f.base.z - from!.base.z + 1e-4 * (r() - 0.5);
      const l = Math.hypot(dx, dz) || 1;
      f.lean[0] += (dx / l) * 0.12;
      f.lean[1] += (dz / l) * 0.12;
      if (attempt % 2 === 1) {
        f.H *= from!.H > f.H ? 0.85 : 1.15;
        f.R *= 0.9;
      }
    }
  }
  return placed.map((p) => p.f);
}

// ---------------------------------------------------------------------------------------------------------
export interface Cluster {
  kind: FungusKind;
  x: number; y: number; z: number;
  mesh: THREE.Mesh;
  fingers: Finger[];
  funnels: Funnel[];
  puffs: Puff[];
  agarics: Agaric[];
  capped: Capped[];
  morels: Morel[];
  age: number;
  end: number; // age at which the last one is done
  grown: boolean;
  key?: string;
  height: number;
  radius: number; // roughly how far it reaches out, for the autofocus
  wither?: number; // age at which it starts to wither (thrown ones; found ones stay)
  rot: number; // how far it has withered, 0..1
  built?: number; // when it was last rebuilt, on the update's clock
}

const UP = new THREE.Vector3(0, 1, 0);
const PACK = { m4: new THREE.Matrix4(), q: new THREE.Quaternion(), qt: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() };
const SEE = 9;
const SEE_MODEL = matchMedia('(pointer: coarse)').matches ? 11 : 17; // a model costs only its drawing: seen further // fungi further than this are hidden (and their growing not built) when Fungi.update is told where you are
const BUILD_EVERY = matchMedia('(pointer: coarse)').matches ? 1 / 12 : 1 / 30; // seconds between rebuilds of a growing one

export class Fungi {
  readonly group = new THREE.Group();
  list: Cluster[] = [];
  changed = false;
  readonly material: THREE.ShaderMaterial;
  // the kinds that are models, once loaded: an instanced mesh each, each fungus its blend of the growth
  private models = new Map<ModelKind, { mesh: THREE.InstancedMesh; data: THREE.InstancedBufferAttribute; tint: THREE.InstancedBufferAttribute; dummy: THREE.Mesh; n: number }>();
  private modelsDirty = false;

  /** `dew`: the moss's dew material, to draw the beads of water on fresh growth (none without it). */
  constructor(setup: (m: THREE.ShaderMaterial) => void, private dew?: THREE.Material) {
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(this.material);
    for (const k of MODEL_KINDS) loadModel(k).then((geo) => { if (geo) this.useModel(k, geo, setup); });
  }

  private useModel(kind: ModelKind, src: THREE.BufferGeometry, setup: (m: THREE.ShaderMaterial) => void) {
    const N = 1024;
    const material = new THREE.ShaderMaterial({ vertexShader: modelVertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(material);
    const geo = instancedModel(src, N);
    const mesh = new THREE.InstancedMesh(geo, material, N);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Mesh(geo);
    dummy.morphTargetInfluences = [0, 0, 0, 0, 0, 0];
    mesh.setMorphAt(0, dummy); // the texture is made for all N here, before the count drops to the ones drawn
    mesh.count = 0;
    this.group.add(mesh);
    this.models.set(kind, {
      mesh, dummy, n: 0,
      data: geo.getAttribute('iData') as THREE.InstancedBufferAttribute,
      tint: geo.getAttribute('iTint') as THREE.InstancedBufferAttribute,
    });
    // the ones already standing: their rings go, the model takes over
    for (const c of this.list) if (c.kind === kind) this.rebuild(c, 0);
    this.modelsDirty = true;
    this.changed = true;
  }

  /** a cluster drawn by a model (once that has loaded) */
  private modelled(c: Cluster) { return isModelKind(c.kind) && this.models.has(c.kind); }

  /**
   * Every modelled fungus in sight, packed into its kind's instanced mesh: where it stands, how it leans and how
   * big, its blend of the stages and its colour. Only when one is growing, withering, comes or goes.
   */
  private packModels() {
    const m4 = PACK.m4, q = PACK.q, qt = PACK.qt, p = PACK.p, sc = PACK.s;
    for (const slot of this.models.values()) slot.n = 0;
    for (const c of this.list) {
      if (!isModelKind(c.kind) || !c.mesh.visible) continue;
      const slot = this.models.get(c.kind);
      if (!slot) continue;
      const { mesh, data, tint, dummy } = slot;
      const w = dummy.morphTargetInfluences!;
      const M = MODELS[c.kind];
      const items: (Agaric | Capped)[] = c.kind === 'agaric' ? c.agarics : c.capped;
      for (const m of items) {
        const g0 = clamp01((c.age - m.delay) / m.dur);
        if (g0 <= 0 || slot.n >= mesh.instanceMatrix.count) continue;
        const n = slot.n++;
        // growth comes in pulses
        const g = clamp01(g0 + 0.02 * Math.sin(g0 * 11 + m.phase));
        // its own cap when grown: round, open, or turned up (a third or so each)
        modelWeights(g, c.rot, THREE.MathUtils.clamp(frac(m.phase * 5.17) * 2.4 - 1.2, -1, 1), w);
        const s = m.R / M.R, ky = (m.H / m.R) / (M.H / M.R);
        // up out of the moss as it starts; down into it as it goes
        const rise = (1 - ease(clamp01(g / 0.05))) * 0.02 * s + c.rot * c.rot * 0.012 * s;
        p.set(c.x + m.base.x, c.y - rise, c.z + m.base.z);
        // turned its own way (the way it falls when it withers), leaning out a little
        q.setFromAxisAngle(UP, m.phase * 2.3);
        qt.setFromEuler(PACK.e.set(Math.atan(m.lean[1]), 0, -Math.atan(m.lean[0])));
        q.premultiply(qt);
        sc.set(s, s * ky, s);
        mesh.setMatrixAt(n, m4.compose(p, q, sc));
        mesh.setMorphAt(n, dummy);
        if (c.kind === 'agaric') {
          // the veil: all white on the egg, cracking off as it swells; the red from a deep scarlet to going orange
          const veil = 1 - THREE.MathUtils.smoothstep(g, 0.08, 0.45);
          const o = frac(m.phase * 7.31), k = 0.9 + 0.2 * frac(m.phase * 3.7);
          data.setXYZW(n, veil, c.rot, 1, m.phase);
          tint.setXYZ(n, (0.7 + 0.04 * o) * k, (0.025 + 0.11 * o * o) * k, (0.02 + 0.01 * o) * k);
        } else {
          // a bolete: its pores white when young, going yellow, then olive
          const cm = (m as Capped).cap;
          data.setXYZW(n, 1 - THREE.MathUtils.smoothstep(g, 0.3, 1.0), c.rot, 1, m.phase);
          tint.setXYZ(n, cm[0], cm[1], cm[2]);
        }
      }
    }
    for (const { mesh, data, tint, n } of this.models.values()) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
      data.needsUpdate = true;
      tint.needsUpdate = true;
    }
  }

  /**
   * A cluster at (x, y, z). Thrown ones grow; found ones (grown) are there already. `wither`: seconds after it
   * has grown before it starts to wither away (never, without it).
   */
  spawn(kind: FungusKind, x: number, y: number, z: number, opts: { grown?: boolean; key?: string; seed?: number; scale?: number; wither?: number } = {}) {
    const r = mulberry32(opts.seed ?? Math.floor(Math.random() * 1e9));
    const sc = opts.scale ?? 0.8 + 0.5 * r();
    const fingers: Finger[] = [], funnels: Funnel[] = [], puffs: Puff[] = [], agarics: Agaric[] = [], capped: Capped[] = [], morels: Morel[] = [];
    let end = 0, height = 0, radius = 0.03 * sc;
    if (kind === 'finger') {
      // a colour per cluster: white crested coral, golden spindles, orange clubs
      const pick = r();
      const tint: [number, number, number] = pick < 0.4 ? [0.70, 0.67, 0.60] : pick < 0.75 ? [0.66, 0.50, 0.16] : [0.62, 0.34, 0.12];
      const n = 5 + Math.floor(r() * 10);
      for (let i = 0; i < n; i++) {
        // fingers come out of one tight foot, leaning out, wandering as they go
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.008 * sc;
        const f: Finger = {
          base: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d),
          // a few centimetres: crested coral stands 2 to 6 cm, rarely 8
          L: (0.022 + 0.05 * r() * r()) * sc, r: (0.0013 + 0.0015 * r()) * sc,
          az: a + (r() - 0.5) * 1.2, tilt: 0.15 + 0.6 * r(),
          bend: (r() - 0.2) * 1.4,
          wob: [0.45 + 0.6 * r(), 4 + 6 * r(), 0.2 + 0.3 * r(), 3 + 6 * r()],
          delay: r() * 5 + i * 0.35, dur: 8 + 6 * r(), phase: r() * 6.28,
          fork: r() < 0.45 ? 0.45 + 0.3 * r() : 0,
          tint: [tint[0] * (0.9 + 0.2 * r()), tint[1] * (0.9 + 0.2 * r()), tint[2] * (0.9 + 0.2 * r())],
        };
        fingers.push(f);
        end = Math.max(end, f.delay + f.dur);
        height = Math.max(height, f.L);
      }
    } else if (kind === 'funnel') {
      // yellowfoot: a cluster of slender hollow funnels
      const n = 2 + Math.floor(r() * 6);
      funnels.push(...layoutFunnels(r, n, (i) => {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.022 * sc;
        const out0 = (0.08 + 0.12 * r()) * (d / (0.022 * sc)); // outer ones lean out as the cluster opens
        return {
          base: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d),
          H: (0.032 + 0.04 * r()) * sc, rs: (0.0035 + 0.0025 * r()) * sc, R: (0.012 + 0.012 * r()) * sc,
          wave: [r() * 6.28, r() * 6.28, r() * 6.28],
          sway: [(r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3, r() * 6.28],
          lean: [Math.cos(a) * out0, Math.sin(a) * out0],
          delay: r() * 4 + i * 0.6, dur: 8 + 5 * r(), phase: r() * 6.28,
          tint: [0.20 + 0.08 * r(), 0.15 + 0.05 * r(), 0.10 + 0.03 * r()],
          stemTint: [0.62, 0.44, 0.12], underTint: [0.43, 0.40, 0.34], solid: false,
        };
      }));
      radius = 0.04 * sc;
    } else if (kind === 'chanterelle') {
      // chanterelles: one to three, egg-yolk yellow all through, fleshy, standing a little apart
      const n = 1 + Math.floor(r() * 3);
      funnels.push(...layoutFunnels(r, n, (i) => {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.05 * sc;
        const out0 = (0.04 + 0.08 * r()) * (d / (0.05 * sc));
        const k = 0.92 + 0.16 * r();
        return {
          base: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d),
          H: (0.036 + 0.03 * r()) * sc, rs: (0.010 + 0.005 * r()) * sc, R: (0.032 + 0.02 * r()) * sc,
          wave: [r() * 6.28, r() * 6.28, r() * 6.28],
          sway: [(r() - 0.5) * 0.15, r() * 6.28, (r() - 0.5) * 0.15, r() * 6.28],
          lean: [Math.cos(a) * out0, Math.sin(a) * out0],
          delay: r() * 3 + i * 1.2, dur: 10 + 5 * r(), phase: r() * 6.28,
          tint: [0.84 * k, 0.52 * k, 0.07 * k], stemTint: [0.86 * k, 0.60 * k, 0.16 * k], underTint: [0.88 * k, 0.56 * k, 0.10 * k],
          solid: true,
        };
      }));
      radius = 0.09 * sc;
    } else if (kind === 'agaric') {
      // fly agarics: one or two, sometimes three, big, standing apart
      const n = 1 + Math.floor(r() * r() * 3);
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          // the biggest thing on the floor: a cap 10 to 17 cm across on a stem as tall or taller
          const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.08 + 0.05 * r()) * sc;
          const R = (0.05 + 0.035 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (agarics.some((m) => Math.hypot(m.base.x - x, m.base.z - z) < (m.R + R) * 0.9)) continue;
          const k = 0.9 + 0.2 * r(), out0 = 0.04 + 0.1 * r();
          agarics.push({
            base: new THREE.Vector3(x, 0, z), H: R * (2.2 + 0.7 * r()), R, rs: R * (0.12 + 0.04 * r()),
            lean: [Math.cos(a) * out0, Math.sin(a) * out0],
            delay: r() * 2 + i * 2.5, dur: 12 + 6 * r(), phase: r() * 6.28,
            red: [0.7 * k, 0.04 * k + 0.03 * r(), 0.025],
          });
          break;
        }
      }
      radius = 0.11 * sc;
    } else if (kind === 'porcini') {
      // karljohan: one or two, sometimes three, stout, a hand apart; caps 8 to 18 cm, stems 3 to 6 thick
      const n = 1 + Math.floor(r() * r() * 3);
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.09 + 0.05 * r()) * sc;
          const R = (0.04 + 0.05 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (capped.some((m) => Math.hypot(m.base.x - x, m.base.z - z) < (m.R + R) * 0.9)) continue;
          const k = 0.85 + 0.3 * r(), out0 = 0.02 + 0.06 * r();
          capped.push({
            base: new THREE.Vector3(x, 0, z), H: R * (1.6 + 0.6 * r()), R, rs: R * (0.3 + 0.08 * r()),
            lean: [Math.cos(a) * out0, Math.sin(a) * out0],
            delay: r() * 2 + i * 2.5, dur: 13 + 6 * r(), phase: r() * 6.28, style: PORCINI,
            cap: [0.32 * k, 0.2 * k, 0.11 * k], stem: [0.74, 0.67, 0.55], under: [0.82, 0.8, 0.66],
          });
          break;
        }
      }
      radius = 0.1 * sc;
    } else if (kind === 'slippery') {
      // smörsopp: two to five, under pine, caps 5 to 11 cm, standing close
      const n = 2 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.04 + 0.06 * r()) * sc;
          const R = (0.026 + 0.03 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (capped.some((m) => Math.hypot(m.base.x - x, m.base.z - z) < (m.R + R) * 0.85)) continue;
          const k = 0.85 + 0.3 * r(), out0 = 0.05 + 0.1 * r();
          capped.push({
            base: new THREE.Vector3(x, 0, z), H: R * (1.3 + 0.4 * r()), R, rs: R * (0.24 + 0.05 * r()),
            lean: [Math.cos(a) * out0, Math.sin(a) * out0],
            delay: r() * 3 + i * 1.4, dur: 11 + 5 * r(), phase: r() * 6.28, style: SLIPPERY,
            cap: [0.3 * k, 0.15 * k, 0.06 * k], stem: [0.78, 0.7, 0.42], under: [0.8, 0.66, 0.2],
          });
          break;
        }
      }
      radius = 0.08 * sc;
    } else if (kind === 'waxcap') {
      // sotvaxskivlingar: two to five under spruce, caps 4 to 10 cm on white stems
      const n = 2 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.04 + 0.06 * r()) * sc;
          const R = (0.022 + 0.026 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (capped.some((m) => Math.hypot(m.base.x - x, m.base.z - z) < (m.R + R) * 0.8)) continue;
          const k = 0.85 + 0.3 * r(), out0 = 0.06 + 0.12 * r();
          capped.push({
            base: new THREE.Vector3(x, 0, z), H: R * (1.7 + 0.6 * r()), R, rs: R * (0.2 + 0.05 * r()),
            lean: [Math.cos(a) * out0, Math.sin(a) * out0],
            delay: r() * 3 + i * 1.3, dur: 11 + 5 * r(), phase: r() * 6.28, style: WAXCAP,
            cap: [0.2 * k, 0.17 * k, 0.15 * k], stem: [0.8, 0.79, 0.76], under: [0.86, 0.85, 0.8],
          });
          break;
        }
      }
      radius = 0.07 * sc;
    } else if (kind === 'morel') {
      // toppmurklor: one to four, a hand's height, standing a little apart
      const n = 1 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.03 + 0.05 * r()) * sc;
          const R = (0.011 + 0.008 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (morels.some((m) => Math.hypot(m.base.x - x, m.base.z - z) < (m.R + R) * 1.2)) continue;
          const k = 0.85 + 0.3 * r(), out0 = 0.03 + 0.08 * r(), capH = R * (2.4 + 1.0 * r());
          morels.push({
            base: new THREE.Vector3(x, 0, z), H: capH * (1.5 + 0.5 * r()), R, rs: R * (0.5 + 0.1 * r()), capH,
            lean: [Math.cos(a) * out0, Math.sin(a) * out0],
            delay: r() * 3 + i * 1.5, dur: 12 + 6 * r(), phase: r() * 6.28,
            cap: [0.3 * k, 0.24 * k, 0.15 * k], stem: [0.8, 0.76, 0.66],
          });
          break;
        }
      }
      radius = 0.05 * sc;
    } else {
      // puffballs: a few pears close together, set out so they do not overlap
      const n = 2 + Math.floor(r() * 5);
      const age = r() * 0.8;
      for (let i = 0; i < n && puffs.length < n; i++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.045 * sc;
          const R = (0.013 + 0.011 * r()) * sc;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (puffs.some((p) => Math.hypot(p.base.x - x, p.base.z - z) < (p.R + R) * 0.95)) continue;
          puffs.push({
            base: new THREE.Vector3(x, 0, z), H: R * (2.6 + 0.9 * r()), R,
            delay: r() * 4 + i * 0.8, dur: 9 + 5 * r(), phase: r() * 6.28,
            age: Math.min(1, age + (r() - 0.5) * 0.3), squash: 0,
          });
          break;
        }
      }
      radius = 0.06 * sc;
    }
    for (const f of funnels) {
      end = Math.max(end, f.delay + f.dur);
      height = Math.max(height, f.H + f.R * 0.4);
    }
    for (const p of puffs) {
      end = Math.max(end, p.delay + p.dur);
      height = Math.max(height, p.H);
    }
    for (const m of agarics) {
      end = Math.max(end, m.delay + m.dur);
      height = Math.max(height, m.H);
    }
    for (const m of capped) {
      end = Math.max(end, m.delay + m.dur);
      height = Math.max(height, m.H);
    }
    for (const m of morels) {
      end = Math.max(end, m.delay + m.dur);
      height = Math.max(height, m.H);
    }
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const c: Cluster = { kind, x, y, z, mesh, fingers, funnels, puffs, agarics, capped, morels, age: opts.grown ? end : 0, end, grown: false, key: opts.key, height, radius, rot: 0, wither: opts.wither === undefined ? undefined : end + opts.wither };
    this.list.push(c);
    this.rebuild(c, 0);
    if (opts.grown) c.grown = true;
    if (this.modelsDirty) { this.packModels(); this.modelsDirty = false; } // drawn at once, before any update
    this.changed = true;
    return c;
  }

  remove(c: Cluster) {
    if (isModelKind(c.kind)) this.modelsDirty = true;
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    for (const d of c.mesh.children) (d as THREE.Mesh).geometry.dispose();
    this.list.splice(this.list.indexOf(c), 1);
    this.changed = true;
  }

  private rebuild(c: Cluster, time: number) {
    const b = newBuf();
    ROT = c.rot;
    if (this.modelled(c)) this.modelsDirty = true; // nothing to build: the model, packed with the rest
    else if (c.kind === 'finger') buildFingerCluster(b, c.fingers, c.age, time);
    else if (c.kind === 'puffball') for (const p of c.puffs) buildPuffball(b, p, c.age);
    else if (c.kind === 'agaric') for (const m of c.agarics) buildAgaric(b, m, c.age);
    else if (c.capped.length) for (const m of c.capped) buildCapped(b, m, c.age);
    else if (c.morels.length) for (const m of c.morels) buildMorel(b, m, c.age);
    else for (const f of c.funnels) buildFunnel(b, f, c.age, time);
    ROT = 0;
    const g = new THREE.BufferGeometry();
    if (b.idx.length) {
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('part', new THREE.Float32BufferAttribute(b.part, 1));
      g.setAttribute('uvf', new THREE.Float32BufferAttribute(b.uvf, 2));
      g.setAttribute('tint', new THREE.Float32BufferAttribute(b.tint, 3));
      g.setIndex(b.idx);
      g.computeVertexNormals();
    }
    c.mesh.geometry.dispose();
    c.mesh.geometry = g;
    // the beads: a child of the cluster's mesh, built again with it
    const old = c.mesh.children[0] as THREE.Mesh | undefined;
    if (old) { c.mesh.remove(old); old.geometry.dispose(); }
    if (this.dew && b.drops.length) c.mesh.add(buildDew(b.drops, this.dew));
  }

  /**
   * Every frame: age, grow and wither them. With (px, pz), the ones further than SEE are hidden and not rebuilt
   * while they grow (they are caught up when they come back into view): hundreds can stand about.
   */
  update(dt: number, time: number, px?: number, pz?: number) {
    for (const c of [...this.list]) {
      if (px !== undefined && pz !== undefined) {
        const seen = Math.hypot(c.x - px, c.z - pz) < (this.modelled(c) ? SEE_MODEL : SEE) + c.radius;
        if (seen !== c.mesh.visible) { c.mesh.visible = seen; if (seen) c.built = undefined; if (isModelKind(c.kind)) this.modelsDirty = true; }
      }
      // a pressed puffball springs back
      let squashing = false;
      for (const p of c.puffs) if (p.squash > 0) { p.squash = Math.max(0, p.squash - dt * 1.6); squashing = true; }
      // a thrown one, grown, keeps ageing until it withers away
      if (!c.grown || c.wither !== undefined) c.age += dt;
      c.rot = c.wither === undefined ? 0 : clamp01((c.age - c.wither) / WITHER);
      if (c.rot >= 1) { this.remove(c); continue; }
      if (this.modelled(c)) {
        // a model: nothing to build, only its weights to set (packed below)
        if (!c.grown || c.rot > 0) {
          if (c.mesh.visible) this.modelsDirty = true;
          if (!c.grown && c.age >= c.end) { c.grown = true; this.changed = true; }
        }
        continue;
      }
      if (c.grown && c.rot <= 0 && !squashing) continue;
      // growing and withering are slow: rebuilt a few dozen times a second, not every frame (each build is a
      // lathe and its beads; on a phone, every frame of it stuttered), the last step always
      const done = !c.grown && c.age >= c.end;
      if (!c.mesh.visible && !done) continue; // out of sight: built again when it comes back
      if (!squashing && !done && c.built !== undefined && time - c.built < BUILD_EVERY) continue;
      this.rebuild(c, time);
      c.built = time;
      if (done) {
        c.grown = true;
        this.changed = true; // the shadow map is drawn again for the grown shape, not for every step of growing
      }
    }
    if (this.modelsDirty) { this.packModels(); this.modelsDirty = false; }
  }

  /** Inside a cluster's rough cylinder? For the autofocus; `among` the ones near enough to matter. */
  hit(x: number, y: number, z: number, among: Cluster[] = this.list) {
    for (const c of among) if (y > c.y - 0.01 && y < c.y + c.height && Math.hypot(x - c.x, z - c.z) < c.radius * 0.6) return true;
    return false;
  }

}

const vertexShader = /* glsl */ `
attribute float part;
attribute vec2 uvf; // along, around
attribute vec3 tint;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vPart;
varying vec2 vUvf;
varying vec3 vTint;
varying vec2 vUv1;
varying vec4 vData;
void main() {
  vUv1 = vec2(0.0);
  vData = vec4(0.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vPart = part;
  vUvf = uvf;
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vPart;
varying vec2 vUvf;
varying vec3 vTint;
varying vec2 vUv1; // the model's: out across the cap, a per-piece random
varying vec4 vData; // the model's, per fungus: veil, rot, the red's depth, a seed
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  if (nearFade(vWorldPos, 0.02, 0.05) < 0.5) discard;
  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uLightDir);
  float along = vUvf.x, around = vUvf.y;
  vec3 col = vTint;
  float thin = 0.4;
  float wet = 1.0; // how glossy: a slippery jack's cap is all slime
  if (vPart > 9.95) {
    // the porcini model (models.ts): a brown bun of a cap, a sponge of pores going from white to yellow to olive
    // with age, a pale barrel of a stem netted white at the top
    float p = vPart - 10.0, t = vUv1.x;
    float young = vData.x, rot = vData.y;
    if (p < 0.05) {
      // the skin: a bun's crust, finely wrinkled, paler toward the rim, a little greasy; going pale on the lip
      col = vTint * mix(0.85, 1.2, smoothstep(0.5, 1.0, t));
      col *= 0.94 + 0.1 * n3(vWorldPos * 140.0) + 0.06 * (n3(vWorldPos * 600.0) - 0.5);
      col = mix(col, vec3(0.8, 0.72, 0.56), smoothstep(1.02, 1.06, t) * 0.7);
      thin = 0.2; wet = 1.1;
    } else if (p < 0.15) {
      // the edge between skin and pores: pale
      col = vec3(0.84, 0.79, 0.66) * (0.94 + 0.1 * n3(vWorldPos * 500.0));
      thin = 0.4;
    } else if (p < 0.5) {
      // the pores: white when young, then yellow, then olive; tiny round mouths, a sponge
      vec3 c0 = vec3(0.6, 0.58, 0.3), c1 = vec3(0.86, 0.78, 0.42), c2 = vec3(0.9, 0.88, 0.8);
      col = mix(mix(c0, c1, smoothstep(0.0, 0.45, young)), c2, smoothstep(0.5, 0.95, young));
      vec2 q = vec2(around * 320.0, t * 90.0);
      vec2 i = floor(q), fq = fract(q) - 0.5 - (vec2(h31(vec3(i, 5.0)), h31(vec3(i, 6.0))) - 0.5) * 0.4;
      col *= 1.0 - 0.3 * (1.0 - smoothstep(0.14, 0.3, length(fq)));
      col *= 0.92 + 0.1 * n3(vWorldPos * 200.0);
      thin = 0.25; wet = 0.4;
    } else {
      // the stem: pale buff, darker low; a fine raised white net over the top half
      col = vec3(0.8, 0.73, 0.58) * (0.95 + 0.05 * sin(around * 6.2831 * 17.0 + n3(vWorldPos * 200.0) * 4.0));
      vec2 q = vec2(around * 30.0, along * 22.0);
      q.x += 0.35 * sin(q.y * 1.3);
      vec2 i = floor(q), f = fract(q);
      float e = 9.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)), c = o + 0.2 + 0.6 * vec2(h31(vec3(i + o, 3.0)), h31(vec3(i + o, 4.0)));
        e = min(e, length((c - f) * vec2(1.0, 0.7)));
      }
      float net = (1.0 - smoothstep(0.3, 0.42, e)) * smoothstep(0.35, 0.75, along);
      col = mix(col * 0.86, vec3(0.9, 0.87, 0.8), net * 0.85);
      thin = 0.35;
    }
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    col = mix(col, vec3(0.3, 0.2, 0.11) * (0.45 + 0.9 * lum) + vec3(0.04, 0.03, 0.015), pow(rot, 0.7) * 0.9);
  } else if (vPart > 8.95) {
    // the fly agaric model (models.ts): its parts by number, the veil and the withering per fungus
    float p = vPart - 9.0, t = vUv1.x, h = vUv1.y;
    float veil = vData.x, rot = vData.y;
    vec3 white = vec3(0.9, 0.87, 0.79);
    if (p < 0.05) {
      // the cap's skin: red, deeper in the middle, more orange to the rim, faintly striate at the very edge
      col = vTint * mix(0.78, 1.12, smoothstep(0.0, 0.95, t));
      // more orange out to the rim, the very edge going yellowish
      col.g += vTint.r * (0.06 * smoothstep(0.45, 1.0, t) + 0.08 * smoothstep(0.93, 1.0, t));
      col *= 1.0 - 0.12 * smoothstep(0.86, 1.0, t) * abs(sin(around * 6.2831 * 70.0));
      col *= 0.93 + 0.12 * n3(vWorldPos * 220.0);
      // the universal veil: all of it white on the egg, cracking off into patches as the cap swells
      float crack = 0.62 * n3(vWorldPos * 240.0) + 0.38 * n3(vWorldPos * 60.0);
      col = mix(col, white * (0.92 + 0.1 * n3(vWorldPos * 600.0)), smoothstep(crack - 0.06, crack + 0.06, veil * 1.2 - 0.1));
      thin = 0.35; wet = 1.3;
    } else if (p < 0.15) {
      // the flesh turning under at the rim: white, a red line along the skin's edge
      col = mix(white * 0.95, vTint * 1.2, smoothstep(0.55, 0.0, abs(t - 1.0) * 30.0) * 0.6 * (1.0 - veil));
      thin = 0.6;
    } else if (p < 0.3) {
      // a wart: a cottony flake of the veil, chalky cream, some yellowed, rough and dry (no slime on it)
      col = mix(vec3(0.97, 0.95, 0.88), vec3(0.92, 0.86, 0.66), h * 0.45) * (0.9 + 0.16 * n3(vWorldPos * 1400.0));
      thin = 0.45; wet = 0.15;
    } else if (p < 0.5) {
      // the gills: white, close, a soft sheen on each blade
      col = white * 1.02 * (0.9 + 0.1 * n3(vWorldPos * 500.0));
      thin = 0.9; wet = 0.6;
    } else if (p < 0.7) {
      // the stem: white, fine lengthwise fibres; below the ring, faint torn bands of the veil, uneven
      col = white * (0.95 + 0.04 * sin(around * 6.2831 * 23.0 + n3(vWorldPos * 300.0) * 6.0) + 0.05 * (n3(vWorldPos * 700.0) - 0.5));
      float band = n3(vec3(around * 9.0, along * 22.0, 0.0)) * n3(vec3(around * 31.0, along * 60.0, 3.0));
      col *= 1.0 - 0.07 * (1.0 - smoothstep(0.5, 0.8, along)) * smoothstep(0.25, 0.45, band);
      thin = 0.4;
    } else {
      // the ring: a thin white skirt, finely grooved from above, its hem a little yellow
      col = white * (0.92 + 0.08 * abs(sin(around * 6.2831 * 90.0 + n3(vWorldPos * 200.0) * 3.0)));
      col = mix(col, vec3(0.88, 0.8, 0.55), smoothstep(0.75, 1.0, t) * 0.35);
      thin = 0.85;
    }
    // withering: everything browns, the red to a dull rust, the white to a dirty buff
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    col = mix(col, vec3(0.34, 0.2, 0.1) * (0.45 + 0.9 * lum) + vec3(0.05, 0.03, 0.015), pow(rot, 0.7) * 0.9);
  } else if (vPart < 0.5) {
    // stem: fine lengthwise fibres, white mycelium at the foot where it comes out of the moss
    col *= 0.94 + 0.06 * sin(around * 6.2831 * 11.0 + n3(vWorldPos * 300.0) * 5.0) + 0.06 * (n3(vWorldPos * 500.0) - 0.5);
    col = mix(col, vec3(0.72, 0.70, 0.64), (1.0 - smoothstep(0.0, 0.08, along)) * 0.8);
    if (vPart > 0.1) {
      // a bolete's stem: a fine raised net, white over the pale brown, strongest at the top and fading down
      vec2 q = vec2(around * 34.0, along * 26.0);
      q.x += 0.35 * sin(q.y * 1.3);
      vec2 i = floor(q), f = fract(q);
      float e = 9.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y)), c = o + 0.2 + 0.6 * vec2(h31(vec3(i + o, 3.0)), h31(vec3(i + o, 4.0)));
        e = min(e, length((c - f) * vec2(1.0, 0.7)));
      }
      float net = (1.0 - smoothstep(0.32, 0.42, e)) * smoothstep(0.15, 0.5, along);
      if (vPart > 0.3) {
        // a slippery jack's stem: not a net but little brown glandular dots, above the ring
        float dot1 = (1.0 - smoothstep(0.12, 0.2, e)) * smoothstep(0.44, 0.5, along);
        col = mix(col, vec3(0.32, 0.2, 0.1), dot1 * 0.8);
      } else col = mix(col * 0.82, vec3(0.86, 0.84, 0.78), net * 0.8);
    }
  } else if (vPart < 1.5) {
    // the funnel's underside: pale grey false gills, forking veins running down onto the stem
    // ridges: blunt and forking, running down onto the stem (grey under a yellowfoot, yellow under a chanterelle)
    float veins = abs(sin(around * 6.2831 * (18.0 + 10.0 * (along - 0.6) * 5.0) + n3(vWorldPos * 150.0) * 4.0));
    col = vTint * mix(0.72, 1.12, smoothstep(0.1, 0.9, veins) * (0.6 + 0.4 * n3(vWorldPos * 90.0)));
    thin = 0.8;
  } else if (vPart < 2.5) {
    // the inside of the funnel: dark grey-brown, finely fibrous, darker down into the hollow stem
    col *= 0.85 + 0.25 * n3(vec3(around * 60.0, along * 40.0, 0.0));
    col *= mix(1.0, 0.3, smoothstep(0.9, 1.0, along));
    thin = 0.7;
  } else if (vPart < 3.5) {
    // finger fungi: smooth, a little darker toward the base, translucent tips
    col *= mix(0.75, 1.0, smoothstep(0.0, 0.4, along));
    thin = 0.9;
  } else if (vPart < 4.5) {
    // puffball: covered in little warts (pale cones, some rubbed off to brown spots), a smoother stem,
    // and a pore at the top once ripe
    vec2 q = vec2(around * 40.0, along * 22.0);
    vec2 i = floor(q), fq = fract(q) - 0.5;
    vec2 o = vec2(h31(vec3(i, 1.0)), h31(vec3(i, 2.0))) - 0.5;
    vec2 d = fq - o * 0.5;
    float wart = 1.0 - smoothstep(0.08, 0.32, length(d));
    float onHead = smoothstep(0.35, 0.6, along);
    wart *= onHead * (0.6 + 0.4 * h31(vec3(i, 4.0)));
    // each wart a little cone: tilt the normal off its slope, tip a touch darker
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4), B = cross(N, T);
    N = normalize(N + (T * d.x + B * d.y) * wart * 2.2);
    col = mix(col, col * vec3(0.92, 0.86, 0.74), wart * smoothstep(0.75, 1.0, wart));
    // the foot pleated and wrinkled lengthwise
    col *= 1.0 - (1.0 - onHead) * 0.12 * abs(sin(around * 6.2831 * 9.0 + n3(vWorldPos * 200.0) * 3.0));
    // a ripe one has browned (its tint is lower in red) and opened a dark pore at the very top
    float ripe = 1.0 - smoothstep(0.66, 0.78, vTint.r);
    col *= mix(1.0, 0.25, smoothstep(0.965, 0.995, along) * ripe);
    thin = 0.3;
  } else if (vPart > 7.5) {
    // a morel's cap: a honeycomb of pits between ridges, the long ridges running up the cone, dark, the pits
    // olive brown and sunk in; cells stretched upward, finer towards the tip
    vec2 q = vec2(around * 11.0, along * 5.5 * (1.0 + 0.5 * along));
    vec2 i = floor(q), f = fract(q);
    float f1 = 9.0, f2 = 9.0; vec2 c1 = vec2(0.0), c2 = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cc = o + 0.2 + 0.6 * vec2(h31(vec3(mod(i.x + o.x, 11.0), i.y + o.y, 11.0)), h31(vec3(mod(i.x + o.x, 11.0), i.y + o.y, 12.0)));
      float l = length((cc - f) * vec2(1.0, 0.45));
      if (l < f1) { f2 = f1; c2 = c1; f1 = l; c1 = cc; } else if (l < f2) { f2 = l; c2 = cc; }
    }
    float edge = f2 - f1;
    vec2 dc = c2 - c1;
    float upright = smoothstep(0.3, 0.8, abs(dc.x) / (length(dc) + 1e-4)); // an edge between side-by-side cells runs up
    float ridge = 1.0 - smoothstep(0.04, mix(0.1, 0.18, upright), edge);
    float pit = 1.0 - ridge;
    col = mix(vTint * (0.75 + 0.35 * n3(vWorldPos * 400.0)) * mix(0.7, 1.0, smoothstep(0.0, 0.5, f1)), vec3(0.07, 0.055, 0.045), ridge * 0.9);
    // the pits sunk in: tilt the normal down into each one, away from its middle
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4), B = cross(N, T);
    vec2 dd = (f - c1) * vec2(1.0, 0.45);
    N = normalize(N - (T * dd.x + B * dd.y) * pit * 1.4);
    thin = 0.15;
  } else if (vPart > 7.2) {
    // a waxcap's gills: thick, far apart, waxy white, running down the stem; dark gaps between, a soft gloss
    float gl = abs(fract(around * 34.0) - 0.5) * 2.0; // 0 on a gill's edge .. 1 midway between
    float gap = smoothstep(0.55, 0.9, gl);
    col *= mix(1.0, 0.35, gap);
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
    N = normalize(N + T * (fract(around * 34.0) - 0.5) * 1.2 * (1.0 - gap));
    wet = 1.6;
    thin = 0.5;
  } else if (vPart > 6.5) {
    // pores: a sponge of tiny round mouths, white when young, olive yellow later (in the tint)
    vec2 q = vec2(around * 260.0, along * 70.0);
    vec2 i = floor(q), fq = fract(q) - 0.5 - (vec2(h31(vec3(i, 5.0)), h31(vec3(i, 6.0))) - 0.5) * 0.4;
    float pore = 1.0 - smoothstep(0.16, 0.3, length(fq));
    col *= 1.0 - 0.35 * pore;
    thin = 0.25;
  } else if (vPart > 5.95) {
    // a bolete's cap: brown, paler at the rim, finely wrinkled like a bun's crust, a little greasy
    col *= mix(0.88, 1.15, smoothstep(0.7, 1.0, along));
    col *= 0.9 + 0.2 * n3(vWorldPos * 140.0) + 0.08 * (n3(vWorldPos * 600.0) - 0.5);
    thin = 0.2;
    if (vPart > 6.4) {
      // a waxcap's cap: sooty grey-brown, darker over the hump, streaked with fine dark fibres running out, greasy
      col = vTint * mix(0.7, 1.15, smoothstep(0.0, 0.85, along));
      col *= 0.85 + 0.18 * sin(around * 6.2831 * 110.0 + n3(vWorldPos * 60.0) * 6.0) * smoothstep(0.15, 0.6, along);
      col *= 0.92 + 0.12 * n3(vWorldPos * 200.0);
      wet = 1.5;
    } else if (vPart > 6.2) {
      // slimy: a smooth glossy skin, darker in the middle, streaked where the slime has run
      col = vTint * mix(0.75, 1.1, smoothstep(0.0, 0.9, along)) * (0.96 + 0.05 * sin(around * 6.2831 * 23.0 + n3(vWorldPos * 80.0) * 4.0));
      wet = 3.0;
    }
  } else {
    // fly agaric's cap: red, under the white veil while it is an egg; as it breaks, the veil stays as warts that
    // spread apart with the growing cap. How much veil is left rides in the part number (5 .. 5.9).
    float veil = clamp((vPart - 5.0) / 0.9, 0.0, 1.0);
    vec2 disc = vec2(cos(around * 6.2831), sin(around * 6.2831)) * along * 9.0; // flat over the cap
    vec2 i = floor(disc), fq = fract(disc) - 0.5;
    vec2 o = vec2(h31(vec3(i, 7.0)), h31(vec3(i, 8.0))) - 0.5;
    vec2 d = fq - o * 0.55;
    float r0 = mix(0.12 + 0.12 * h31(vec3(i, 9.0)), 1.0, veil) * (1.0 - 0.35 * along * (1.0 - veil));
    float wart = (1.0 - smoothstep(r0, r0 + 0.07, length(d))) * step(0.2, h31(vec3(i, 10.0)) + veil);
    // the red: deeper in the middle, more orange to the rim, faintly striate at the very edge
    col = vTint * mix(0.8, 1.12, smoothstep(0.0, 0.9, along));
    col *= 1.0 - 0.1 * smoothstep(0.85, 1.0, along) * abs(sin(around * 6.2831 * 60.0));
    // the warts: chalky white, darkened as the rest is when it withers; little raised lumps
    float k = clamp(vTint.r / 0.7, 0.15, 1.0);
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4), B = cross(N, T);
    N = normalize(N + (T * d.x + B * d.y) * wart * (1.0 - veil) * 1.6);
    col = mix(col, vec3(0.9, 0.87, 0.78) * k * (0.9 + 0.15 * n3(vWorldPos * 900.0)), wart);
    thin = 0.35;
  }
  // slime: a film of water that glistens and slowly moves; the colour deeper where it is wet
  vec3 q = vWorldPos * 380.0 + vec3(0.0, uTime * 0.25, 0.0);
  vec3 Nw = normalize(N + (vec3(n3(q), n3(q + 17.0), n3(q + 31.0)) - 0.5) * 0.35);
  col *= 0.82;
  // in the shade no direct sun at all: the floor that lets a little through is for the dark moss, and on a white
  // stem or a red cap it read as lit; the sky's fill does the shade
  float shadow = clamp((shadowAt(vWorldPos, N) - uShadowFloor) / max(1.0 - uShadowFloor, 1e-3), 0.0, 1.0);
  float diff = max(dot(N, L), 0.0);
  float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);
  float spec = (pow(max(dot(reflect(-L, Nw), V), 0.0), 140.0) * 2.2 + pow(max(dot(reflect(-L, Nw), V), 0.0), 18.0) * 0.25) * wet;
  float sheen = pow(1.0 - max(dot(Nw, V), 0.0), 4.0) * 0.35 * mix(0.3, 1.0, shadow) * mix(1.0, wet, 0.5); // the wet sheen is the sky's: dim in the shade, as all else
  float thru = pow(max(dot(-V, L), 0.0), 2.5) * thin;
  // the fill is dimmer in the shade, as on the moss: a white stem in a shadow had stood out as if lit
  vec3 lit = col * (mix(0.09, 0.25, shadow) * skyTint(N, 1.0) + 1.3 * diff * shadow + 0.15 * wrap * mix(0.35, 1.0, shadow))
           + col * vec3(1.5, 1.1, 0.6) * thru * max(shadow, 0.3)
           + vec3(1.0, 0.9, 0.75) * spec * shadow
           + vec3(0.6, 0.62, 0.66) * sheen;
  lit += rimLight(N, V) * col * 2.0 * mix(0.3, 1.0, shadow); // (shadow is 0..1 here)
  // with the sun at your back, a gold catch on the side turned to it, as the moss and ferns get
  // (their own colour lit warm, not the moss's flat gold added: that washed a red cap out to cream)
  lit += col * vec3(1.5, 1.15, 0.7) * pow(max(dot(N, L) * 0.5 + 0.5, 0.0), 3.0) * withSun(V, L) * sunCatch(vWorldPos, shadow) * 0.7;
  // the foot down in the moss is dark
  lit *= mix(0.35, 1.0, smoothstep(0.0, 0.12, along));
  gl_FragColor = vec4(tonemap(grade(lit)), 1.0);
  #include <colorspace_fragment>
}
`;
