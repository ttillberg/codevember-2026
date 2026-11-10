import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { project, D, SCALE, type M4, type V4 } from './tesseract';
import { pose, st } from './state';
import { drone, target, startCell, LOCK_RANGE, crossInto, pieceMesh, blink, toCell, fromCell, dirFromCellWith, otherMap, mapAcross, relayTarget, faceCorners, facePoint, wallOf, cellId, cellIdOf, lampColor, CELL_HEX, RIPPLE, SIZE_MAIN, SIZE_CELL, type CellMap } from './drone';
import { device, ringOut, DEVICE_URL, type Device } from './device';
import { makeSmoke } from './smoke';
import { makeLaser } from './laser';

const LASER = true; // the laser line through the wake (hidden for a while, the clouds alone)

// A device that lives in the tesseract: a ball with one eye, fins that are walls, a shutter. It is inside one of the eight cells, a cube with one coordinate held at
// ±1 and the other three free, and it can only leave through a square face into the neighbouring cell. The passage is
// one smooth curve in 4D: it bends from the way it was flying to the way into the next cell, which in 4D is a right
// angle, slows to half speed in the face and picks up again, as if through a field. Everything is a point in 4D seen
// through the same turn and perspective as the struts, so what looks like speed is partly the warp of the cell it is
// in. The wake is smoke, each puff kept in 4D too, so it turns with the rest.

const SPEED = 0.5; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so the drone keeps clear of the struts
const FIELD = 0.14; // half-width, in path fraction, of the field round the face (it shuts the ball and the wings)
const DIP = 0.3; // the field's depth, 0 to DIP: what shuts the wings and the ball; the speed keeps on through it
// through a wall straight on, at speed (eased into the face, held a quarter second with no wake and eased out, for a moment)
const CURVE = 0.45; // how far the heading carries into a leg, of its length: longer, rounder sweeps (it was 0.35)
const ARRIVE = 0.4, ARRIVE_SLOW = 0.25; // the last stretch to the piece: over this much of the leg it slows, to this much of cruising
// the catch, in phases: still in front of the piece, a beat with the scoop home, then the scoop out on it; the piece
// drawn into the bowl and the blade swung shut over it; the machine glides a quarter turn while the next piece
// emerges; still again; and off
const PAUSE = 0.4, SETTLE = PAUSE + 0.35, CATCH = 0.6, GLIDE = 2.0, REST = 0.5;
const TINT_IN = 14; // how fast the glow on the half inside a new cell comes and goes, per second
const WINGS_REST = 0.5; // the wings as it flies: half shut, 0 spread to 1 shut; spread only for the catch
const LOOK_EASE = 1.5; // per second: how quick the eye, on its own, comes round to the way it is going (it was 4, and nodded with every turn)
const RIPPLE_R = 2.3, RIPPLE_W = 0.22; // the ripple: how far out its wave runs on the wall in 4D (the wall is 2 across), and how wide its front is
const HEX = 0.012, GRID_A = 0.7; // the grid on a wall being gone through: a honeycomb, its cell's radius on the wall (2 across), and its strength
/** The honeycomb's edges on the wall, in its own coordinates (-1 to 1 each way), each once, cut at the wall's square:
 * worked out once, put through the turn each frame. Flat-topped cells, centres on a grid of 1.5 by √3 radii. */
const HEXES: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [], seen = new Set<string>(), r = HEX, h = (Math.sqrt(3) / 2) * r;
  const corner = (cx: number, cy: number, i: number) => [cx + r * Math.cos((Math.PI / 3) * i), cy + r * Math.sin((Math.PI / 3) * i)];
  // a segment cut to the square |u|, |v| <= 1 (Liang-Barsky), or null if it misses it
  const clip = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null => {
    let a = 0, b = 1;
    const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0 + 1], [dx, 1 - x0], [-dy, y0 + 1], [dy, 1 - y0]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) a = Math.max(a, t); else b = Math.min(b, t);
      if (a > b) return null;
    }
    return [x0 + dx * a, y0 + dy * a, x0 + dx * b, y0 + dy * b];
  };
  for (let col = -Math.ceil(1 / (1.5 * r)) - 1; col <= Math.ceil(1 / (1.5 * r)) + 1; col++) {
    for (let row = -Math.ceil(1 / (2 * h)) - 1; row <= Math.ceil(1 / (2 * h)) + 1; row++) {
      const cx = col * 1.5 * r, cy = row * 2 * h + (col & 1 ? h : 0);
      for (let i = 0; i < 6; i++) {
        const [x0, y0] = corner(cx, cy, i), [x1, y1] = corner(cx, cy, i + 1);
        const key = [Math.round((x0 + x1) * 5e3), Math.round((y0 + y1) * 5e3)].join(); // an edge by its middle
        if (seen.has(key)) continue;
        seen.add(key);
        const c = clip(x0, y0, x1, y1);
        if (c) out.push(c);
      }
    }
  }
  return out;
})();
/** The honeycomb on the GPU: some 33,000 edges, too many to put through the 4D turn on the CPU each frame. Each end
 * keeps its place on the wall (u, v) and its edge's middle; the wall comes in as its middle and its two unit ways
 * along it, already turned (`turned`), and the shader puts the point through the w perspective as `project` does. */
const HEX_GEO = (() => {
  const pos = new Float32Array(HEXES.length * 6), mid = new Float32Array(HEXES.length * 4);
  HEXES.forEach(([u0, v0, u1, v1], j) => {
    pos.set([u0, v0, 0, u1, v1, 0], 6 * j);
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    mid.set([mu, mv, mu, mv], 4 * j);
  });
  return new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('mid', new THREE.BufferAttribute(mid, 2));
})();
HEX_GEO.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
/** The honeycomb's material: one colour and strength for the grid; with `ripple`, each edge lit as the wave from the
 * crossing (`at`, on the wall) reaches it, its front at `front`, a faint wash left behind it. */
function hexMaterial(ripple: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      wC: { value: new THREE.Vector4() }, wU: { value: new THREE.Vector4() }, wV: { value: new THREE.Vector4() },
      color: { value: new THREE.Color() }, opacity: { value: 0 },
      at: { value: new THREE.Vector2() }, front: { value: 0 },
    },
    defines: { D: D.toFixed(4), SCALE: SCALE.toFixed(4), ...(ripple ? { RIPPLE_W: RIPPLE_W.toFixed(4) } : {}) },
    vertexShader: /* glsl */ `
      uniform vec4 wC, wU, wV;
      uniform vec2 at;
      uniform float front;
      attribute vec2 mid;
      varying float vA;
      void main() {
        vec4 q = wC + position.x * wU + position.y * wV;
        vec3 p = q.xyz * (D / (D - q.w)) * SCALE;
        vA = 1.0;
        #ifdef RIPPLE_W
          float d = distance(mid, at), e = (d - front) / RIPPLE_W;
          vA = min(1.0, exp(-e * e) + (d < front ? 0.25 : 0.0));
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      varying float vA;
      void main() {
        gl_FragColor = vec4(color, opacity * vA);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
}
type HexMat = ReturnType<typeof hexMaterial>;
/** A point of 4D through the turn alone, no perspective: the four rows' dot products. */
const turned = (m: M4, v: number[], out: THREE.Vector4) =>
  out.set(...(m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3] * v[3]) as [number, number, number, number]));
// in-then-out, in distance: how far the body goes on past all in, in radii, before the next cell's copy starts up out
// of the wall, and over how far it comes out; how deep in the wall it starts at the least, in radii; and seconds the
// hand-over may linger past the wall state. (Tried in seconds for a while; the distance reads as the body going in,
// then out, and it is back.)
const INOUT_GAP = 1.5, INOUT_RISE = 4, INOUT_SET = 3, LINGER = 3;
const GLOW = 0.9; // the strength of the cell-colour tint on a half in a wall: 0.9 of the tint's own 0.55 is about half
// at the controls the device docks on its own once the piece has been in the lock this long (seconds): it turns its
// eye on it and closes to a scoop's reach (device radii, in cell space), and the catch takes over
const LOCK_HOLD = 0.5, STAND = 2.0;
const REACH3 = 1.9; // where the piece should sit when the device stops, in device radii, on screen
type Phase = 'seek' | 'dock' | 'settle' | 'catch' | 'turn' | 'rest';
// at the controls: cell-space units per second squared and per second, radians per second
const THRUST = 1.6, DRAG = 1.1, VMAX = 1.1;
// at the controls, how near the device may come to an edge of its room, in cell units (the room 2 across): the strut is
// there, the eye inside it sees only its dark inside, and by an edge it is near two walls at once and crossed the wrong one
const EDGE_CLEAR = 0.15;

/** A wall of the current cell: the 4D axis of its face and the side it is on. */
type Wall = { axis: number; sign: number };
const sameWall = (a: Wall, b: Wall) => a.axis === b.axis && a.sign === b.sign;
/** The hand-over at a wall: which wall, named from the cell the device is in; whether it has gone through; seconds
 * the body has been all the way in since; seconds since the flight last had the wall ahead. */
type Handover = { wall: Wall; crossed: boolean; gone: number };
type Leg = { pts: V4[]; len: number; arc: number[]; crossed: boolean } & ({ kind: 'cruise'; toTarget: boolean } | { kind: 'portal'; face: Wall });
/** A step of a plan, made into a leg when its turn comes, from wherever the device is then. */
type Step = { kind: 'portal'; axis: number; sign: number; face: V4; beyond: V4 } | { kind: 'cruise'; to: V4; toTarget: boolean };
const mix4 = (a: V4, b: V4, t: number): V4 => a.map((x, i) => x + (b[i] - x) * t) as V4;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const add4 = (a: V4, b: V4, k = 1): V4 => a.map((x, i) => x + b[i] * k) as V4;
const sub4 = (a: V4, b: V4): V4 => a.map((x, i) => x - b[i]) as V4;
const scale4 = (a: V4, k: number): V4 => a.map((x) => x * k) as V4;
const len4 = (a: V4) => Math.hypot(a[0], a[1], a[2], a[3]);
const unit4 = (a: V4): V4 => scale4(a, 1 / (len4(a) || 1));
/** Keep a control point inside the cell: the held coordinate on its wall, the others short of the struts. */
const inCell = (v: V4, held: number, sign: number): V4 => v.map((x, i) => (i === held ? sign : Math.max(-0.9, Math.min(0.9, x)))) as V4;

/** Cubic Bezier through two segments, s in [0, 1], the join at 0.5. pts = [p0, c0, c1, join, c2, c3, p1]. */
function path(pts: V4[], s: number): V4 {
  const seg = s < 0.5 ? 0 : 3;
  const t = (s - (seg ? 0.5 : 0)) * 2;
  const [a, b, c, d] = pts.slice(seg, seg + 4);
  const u = 1 - t;
  return [0, 1, 2, 3].map((i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]) as V4;
}
/** The path's length, and the length run at each of ARC_N steps of its parameter: so the device goes on at a
 * constant speed, the parameter found from the distance (a Bezier's parameter runs fast on the straight and slow in
 * the bends). */
const ARC_N = 64;
function arcOf(pts: V4[]): { len: number; arc: number[] } {
  const arc = [0];
  let prev = path(pts, 0);
  for (let i = 1; i <= ARC_N; i++) { const p = path(pts, i / ARC_N); arc.push(arc[i - 1] + len4(sub4(p, prev))); prev = p; }
  return { len: arc[ARC_N], arc };
}
/** The path's parameter where `d` of its length has been run. */
function atDist(arc: number[], d: number): number {
  if (d <= 0) return 0;
  if (d >= arc[ARC_N]) return 1;
  let lo = 0, hi = ARC_N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid] <= d) lo = mid; else hi = mid; }
  return (lo + (d - arc[lo]) / (arc[hi] - arc[lo] || 1)) / ARC_N;
}
const { clamp, smoothstep, degToRad } = THREE.MathUtils;
const ZERO = new THREE.Vector3();
/** The rotation that looks along `fwd` with `up` as up, into `out`. */
const lookQuat = (m: THREE.Matrix4, fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion) => out.setFromRotationMatrix(m.lookAt(ZERO, fwd, up));

export function Drones() {
  const gltf = useGLTF(DEVICE_URL);
  const d = useMemo(() => {
    const group = new THREE.Group();
    // two copies: the one in this cell, and one for the cell on the other side of a wall it is passing through.
    // In 4D the half of the body through the wall lies in the neighbour's space and projects with the neighbour's
    // turn, so each copy is oriented by its own cell's map and clipped at the wall's plane; together they fold.
    const q = device(gltf.scene, SIZE_MAIN);
    const q2 = device(gltf.scene, SIZE_MAIN);
    group.add(q.g, q2.g);
    const planeA = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4), planeB = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
    q.clip([planeA]); q2.clip([planeB]);
    const smoke = makeSmoke();
    group.add(smoke.points);
    const laser = LASER ? makeLaser() : null; // built only if shown
    if (laser) group.add(laser.line);
    // the ripple at a crossing, run through the honeycomb: each edge of it lights as the wave from the crossing
    // reaches it (rings of hairlines before that, and a filled ring in a shader before them, faceQuad); a colour
    // with alpha per end, so each edge has its own strength
    const ripple = new THREE.LineSegments(HEX_GEO, hexMaterial(true));
    ripple.frustumCulled = false; ripple.visible = false; ripple.renderOrder = 4;
    group.add(ripple);
    // the grid on a wall about to be gone through: a honeycomb (HEXES), in the colour of the cell beyond
    const grid = new THREE.LineSegments(HEX_GEO, hexMaterial(false));
    grid.frustumCulled = false; grid.visible = false; grid.renderOrder = 4;
    group.add(grid);
    const piece = pieceMesh();
    piece.visible = false;
    group.add(piece);
    const grabbed = pieceMesh(); // the one just taken, in the ring on its way in
    grabbed.visible = false;
    group.add(grabbed);
    startCell(Math.floor(Math.random() * 4), Math.random() < 0.5 ? -1 : 1);
    const s = {
      group, q, smoke, laser, puffAt: new THREE.Vector3(1e9, 0, 0), puffGap: 0.04, trailAt: new THREE.Vector3(1e9, 0, 0), ripple, grid, gridK: 0, gridHex: '', ho: null as Handover | null, shift: new THREE.Vector3(), tintA: 0, tintB: 0, tintHexA: '', tintHexB: '', piece, grabbed,
      came: null as Wall | null, // the wall of the leg it is on, once through it, named from the new cell
      p: [0, 0, 0, 0] as V4, dir: [0, 0, 0, 0] as V4, // where it is, which way it is going, in 4D
      leg: null as Leg | null, s: 0, dist: 0, // the leg, its parameter, and how far along it, in 4D
      last: new THREE.Vector3(), heading: new THREE.Quaternion(), heading2: new THREE.Quaternion(),
      q2, planeA, planeB, cLast: [0, 0, 0], look: new THREE.Vector3(0, 0, -1), camUp: new THREE.Vector3(0, 1, 0),
      wall: null as Wall | null, // the wall the flight has it at, if any
      plan: [] as Step[], phase: 'seek' as Phase, t: 0, // the steps to the piece; the catch's phase and its clock
      eyeCap: null as THREE.Object3D | null, // the eye cap, found once: which way it looks, for the chase camera
      grip: 0, shut: 0, lockT: 0, // the scoop out, and shut; seconds the piece has been in the lock
      grabOf: null as V4 | null, grabLocal: new THREE.Vector3(), // the piece taken, and where it was from the device then, in its frame
      shield: 0, blink: Infinity, nextBlink: 3 + Math.random() * 5, // seconds into the blink; seconds to a blink of its own
      wasPilot: false,
    };
    s.p = roomIn();
    s.dir = unit4(sub4(roomIn(), s.p));
    project(pose(), s.p, s.last);
    return s;
  }, []);
  type S = typeof d;

  /** A point inside the current cell, clear of the struts. */
  function roomIn(): V4 {
    const v = [0, 1, 2, 3].map(() => rnd(-ROOM, ROOM)) as V4;
    v[drone.held] = drone.sign;
    return v;
  }
  /** On to `p`, the heading kept from the step. */
  function moveTo(s: S, p: V4) {
    const step = sub4(p, s.p);
    s.p = p;
    if (len4(step) > 1e-6) s.dir = unit4(step);
  }
  /** A leg to a point inside the cell, bending out of the current heading. */
  function cruiseLeg(s: S, to: V4 = roomIn(), toTarget = false): Leg {
    const { held, sign } = drone, L = len4(sub4(to, s.p));
    const c0 = inCell(add4(s.p, s.dir, L * CURVE), held, sign);
    const mid = inCell(scale4(add4(s.p, to), 0.5), held, sign); // no knot in the middle: one round sweep
    const c1 = inCell(add4(mid, sub4(c0, s.p), -0.3), held, sign);
    const c2 = inCell(add4(mid, sub4(to, mid), 0.3), held, sign);
    const c3 = inCell(add4(to, sub4(to, mid), -0.2), held, sign);
    const pts = [s.p, c0, c1, mid, c2, c3, to];
    return { kind: 'cruise', pts, ...arcOf(pts), crossed: false, toTarget };
  }
  /** A leg out through the face where `axis` is `sign`, at `face`, on to `beyond` in the next cell: one curve, the
   * face at its middle. In square to the face and square on from it: the turn is the 4D right angle itself, taken in
   * the face, eased by the field. Every control point stays on the boundary, inside its cell. */
  function portalLeg(s: S, axis: number, sign: number, face: V4, beyond: V4): Leg {
    const out: V4 = [0, 0, 0, 0]; out[axis] = sign;
    const inward: V4 = [0, 0, 0, 0]; inward[drone.held] = -drone.sign;
    const L0 = len4(sub4(face, s.p)), L1 = len4(sub4(beyond, face));
    const pts = [
      s.p, inCell(add4(s.p, s.dir, L0 * CURVE), drone.held, drone.sign), add4(face, out, -L0 * 0.4), face,
      add4(face, inward, L1 * 0.4), inCell(add4(beyond, sub4(beyond, face), -0.25), axis, sign), beyond,
    ];
    return { kind: 'portal', pts, ...arcOf(pts), face: { axis, sign }, crossed: false };
  }
  /** A new piece two walls away, never back where it is, and the plan to it: two faces, each a little towards the
   * piece on the axes the cells share, then the last stretch. The piece's cell map is kept for the cam. */
  function newTarget(s: S) {
    const { held, sign } = drone;
    const a1 = pick([0, 1, 2, 3].filter((a) => a !== held)), s1 = Math.random() < 0.5 ? -1 : 1;
    const a2 = pick([0, 1, 2, 3].filter((a) => a !== a1 && a !== held)), s2 = Math.random() < 0.5 ? -1 : 1;
    const to: V4 = [0, 1, 2, 3].map(() => rnd(-0.55, 0.55)) as V4;
    to[a2] = s2;
    const face1 = mix4(s.p, to, 0.35); face1[held] = sign; face1[a1] = s1; face1[a2] = clamp(face1[a2], -0.5, 0.5);
    const face2 = mix4(s.p, to, 0.7); face2[a1] = s1; face2[a2] = s2; face2[held] = sign * 0.45;
    const beyond1 = mix4(face1, face2, 0.45); beyond1[a1] = s1;
    const beyond2 = mix4(face2, to, 0.45); beyond2[a2] = s2;
    s.plan = [
      { kind: 'portal', axis: a1, sign: s1, face: face1, beyond: beyond1 },
      { kind: 'portal', axis: a2, sign: s2, face: face2, beyond: beyond2 },
      { kind: 'cruise', to: stopBefore(to, face2), toTarget: true },
    ];
    target.p = to; target.up = true; target.scale = 0;
    target.map = mapAcross(mapAcross(drone, a1, s1), a2, s2);
    lampColor(CELL_HEX[cellIdOf(target.map)]); // the lamps in the colour of the cell the piece is in
  }
  /** Where the last leg to the piece at `to`, coming from `from`, stops: a grip's reach short of it, so it is taken in
   * the ring, not in the body. A reach is a 3D distance and the projection stretches 4D differently from place to
   * place, so the 4D step back is sized from the local scale of the projection at the piece: probe how far a small 4D
   * step moves on screen there. */
  function stopBefore(to: V4, from: V4): V4 {
    const back = unit4(sub4(to, from));
    const m0 = pose(), E = 0.02;
    const scale3 = project(m0, to, new THREE.Vector3()).distanceTo(project(m0, add4(to, back, -E), new THREE.Vector3())) / E;
    const d4 = clamp((REACH3 * SIZE_MAIN) / Math.max(0.2, scale3), 0.06, 0.45);
    return add4(to, back, -d4);
  }
  /** A plan from the cell the device is in to the piece where it is: straight to it in this cell, through one wall from
   * next door, through a cell between from across the machine. Let go at the controls, the old plan was laid from
   * another cell, or is spent, and the device would wander this room for good. */
  function planTo(s: S) {
    const tm = target.map!, to = target.p, steps: Step[] = [];
    let { held, sign } = drone, from = s.p;
    /** A point on the wall of the cell held at `h`, `g` on axis `a`, `t`, the rest clear of the struts. */
    const onWall = (p: V4, h: number, g: number, a: number, t: number): V4 => p.map((x, i) => (i === h ? g : i === a ? t : clamp(x, -ROOM, ROOM))) as V4;
    if (tm.held === held && tm.sign === -sign) {
      // across: through a cell between, on any other axis
      const a1 = pick([0, 1, 2, 3].filter((a) => a !== held)), s1 = Math.random() < 0.5 ? -1 : 1;
      const face = onWall(mix4(from, to, 0.35), held, sign, a1, s1);
      const beyond = mix4(face, to, 0.3); beyond[a1] = s1; beyond[held] = sign * 0.45;
      steps.push({ kind: 'portal', axis: a1, sign: s1, face, beyond });
      held = a1; sign = s1; from = beyond;
    }
    if (tm.held !== held) {
      const face = onWall(mix4(from, to, 0.5), held, sign, tm.held, tm.sign);
      const beyond = mix4(face, to, 0.45); beyond[tm.held] = tm.sign; beyond[held] = sign * 0.45;
      steps.push({ kind: 'portal', axis: tm.held, sign: tm.sign, face, beyond });
      from = beyond;
    }
    steps.push({ kind: 'cruise', to: stopBefore(to, from), toTarget: true });
    s.plan = steps;
  }

  const tmp = useMemo(() => ({
    v: new THREE.Vector3(), m: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), qa: new THREE.Quaternion(),
    a: new THREE.Vector3(), b: new THREE.Vector3(), f3: new THREE.Vector3(), u3: new THREE.Vector3(), corners: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    color: new THREE.Color(), gq: new THREE.Quaternion(),
  }), []);

  /** Hands on: taken over, the device keeps the way it was going; let go, it carries on from there on its own. */
  function takeOver() {
    // the orientation is already kept in cell space; it carries on from there, at cruising speed along the eye
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(drone.q);
    drone.cvel = [v.x * SPEED, v.y * SPEED, v.z * SPEED];
  }
  function letGo(s: S) {
    s.p[drone.held] = drone.sign;
    s.leg = null; s.came = null;
    drone.turn[0] = drone.turn[1] = 0; drone.keys.thrust = drone.keys.strafe = 0;
    // the flight lays a fresh plan from here when it next needs one; a catch that was about to begin begins over
    s.plan = [];
    if (s.phase === 'settle' || s.phase === 'dock') s.phase = 'seek';
  }
  /** Through the wall where 4D axis `axis` is `sign`, crossed at `p4`: the face's axis is held now, the old one free;
   * the wall ripples from the crossing in the new cell's colour, the shutter blinks, and the hand-over goes on in the
   * new cell. Returns the wall just crossed as the new cell names it: the axis that was held, now free. */
  function cross(s: S, axis: number, sign: number, p4: V4): Wall {
    const was = { axis: drone.held, sign: drone.sign };
    drone.flash.corners = faceCorners(axis, sign); drone.flash.p4 = p4; drone.flash.t = 0;
    crossInto(axis, sign);
    relayTarget(p4);
    drone.flash.color = CELL_HEX[cellId()];
    s.blink = 0;
    s.ho = { wall: was, crossed: true, gone: 0 };
    // the copies swap cells: this one now draws the cell just entered, the other the one left. Each takes over the
    // pose and the tint the other had there, so neither half jumps or changes colour at the crossing
    [s.heading, s.heading2] = [s.heading2, s.heading];
    [s.tintA, s.tintB] = [s.tintB, s.tintA];
    [s.tintHexA, s.tintHexB] = [s.tintHexB, s.tintHexA];
    if (s.tintHexA) s.q.tint(s.tintHexA, s.tintA);
    if (s.tintHexB) s.q2.tint(s.tintHexB, s.tintB);
    return was;
  }
  /** One step at the controls, in cell space: the look as it came in from the page, thrust along the eye and strafe
   * across it against drag, and the same crossing as on its own when it goes through a wall; the field round the
   * walls slows it too. Returns the field. */
  function pilot(s: S, dt: number): number {
    const { fwd, right, qa } = tmp, k = drone.keys;
    // the turns are about the eye's own axes, so a drag right turns towards the right of the view and a drag up
    // towards its top whatever way the device is rolled or pitched
    const upq = new THREE.Vector3(0, 1, 0).applyQuaternion(drone.q);
    right.set(1, 0, 0).applyQuaternion(drone.q);
    drone.q.premultiply(qa.setFromAxisAngle(upq, -drone.turn[0])).premultiply(qa.setFromAxisAngle(right, drone.turn[1])).normalize();
    drone.turn[0] = drone.turn[1] = 0;
    fwd.set(0, 0, -1).applyQuaternion(drone.q);
    right.set(1, 0, 0).applyQuaternion(drone.q);
    // and it rights itself slowly towards the room's up while the look is level, so roll does not build up
    upq.set(0, 1, 0).applyQuaternion(drone.q);
    const level = 1 - Math.abs(fwd.y);
    if (level > 0.05) {
      upq.lerp(tmp.up, 0.5).normalize();
      drone.q.slerp(lookQuat(tmp.m, fwd, upq, qa), Math.min(1, dt * 1.5 * level));
    }
    const c = toCell(s.p), cv = drone.cvel;
    // the nearest wall and the field there
    let dmin = Infinity, kw = 0, tw = 1;
    for (let i = 0; i < 3; i++) for (const t of [-1, 1]) {
      const dist = Math.abs(drone.centre[i] + t - c[i]);
      if (dist < dmin) { dmin = dist; kw = i; tw = t; }
    }
    const field = DIP * Math.exp(-((dmin / 0.22) ** 2));
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < 3; i++) cv[i] = (cv[i] + (fwd.getComponent(i) * k.thrust + right.getComponent(i) * k.strafe) * THRUST * dt) * drag;
    const sp = Math.hypot(cv[0], cv[1], cv[2]);
    if (sp > VMAX) for (let i = 0; i < 3; i++) cv[i] *= VMAX / sp;
    for (let i = 0; i < 3; i++) c[i] += cv[i] * (1 - field) * dt;
    // clear of the room's twelve edges: pushed back out to EDGE_CLEAR from any it comes too near, and the way into it
    // taken off the speed, so it slides along the edge and goes through a face, never in by an edge
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const ui = c[i] - drone.centre[i], uj = c[j] - drone.centre[j];
      const a = Math.max(0, 1 - Math.abs(ui)), b = Math.max(0, 1 - Math.abs(uj)); // to the two walls meeting there
      const dd = Math.hypot(a, b);
      if (dd >= EDGE_CLEAR) continue;
      const si = Math.sign(ui) || 1, sj = Math.sign(uj) || 1;
      const ni = dd > 1e-6 ? a / dd : Math.SQRT1_2, nj = dd > 1e-6 ? b / dd : Math.SQRT1_2; // out from the edge, inwards
      c[i] = drone.centre[i] + si * (1 - ni * EDGE_CLEAR); c[j] = drone.centre[j] + sj * (1 - nj * EDGE_CLEAR);
      const vn = -si * ni * cv[i] - sj * nj * cv[j]; // the speed out from the edge; below 0, into it
      if (vn < 0) { cv[i] += vn * si * ni; cv[j] += vn * sj * nj; }
    }
    // the piece in the lock (in this cell, close, ahead of the eye) for a moment: the device docks on its own
    let locked = false;
    if (target.up && target.map && target.map.held === drone.held && target.map.sign === drone.sign) {
      const t3 = toCell(target.p), dx = t3[0] - c[0], dy = t3[1] - c[1], dz = t3[2] - c[2], dist = Math.hypot(dx, dy, dz);
      locked = dist < LOCK_RANGE && dist > 1e-6 && fwd.x * dx + fwd.y * dy + fwd.z * dz > 0;
    }
    s.lockT = locked ? s.lockT + dt : 0;
    if (s.lockT > LOCK_HOLD) {
      s.phase = 'dock'; s.t = 0; s.lockT = 0;
      cv[0] = cv[1] = cv[2] = 0; k.thrust = 0; drone.turn[0] = drone.turn[1] = 0;
      s.look.copy(fwd); s.cLast = c.slice();
    }
    // the clip is at the nearest wall, the one being straddled
    s.wall = dmin < 0.5 ? wallOf(kw, tw) : null;
    // through: the same swap of held axis as on its own
    const over = c[kw] - (drone.centre[kw] + tw);
    if (over * tw > 0) {
      const w = wallOf(kw, tw);
      s.wall = cross(s, w.axis, w.sign, fromCell(c));
    }
    moveTo(s, fromCell(c));
    return field;
  }

  /** Docking, at the controls: the eye turns on the piece and the device closes to a scoop's reach of it, eased;
   * square on and there, the catch takes over. */
  function dock(s: S, dt: number) {
    drone.turn[0] = drone.turn[1] = 0; drone.cvel = [0, 0, 0];
    s.wall = null;
    if (!target.up) return;
    const c = toCell(s.p), t3 = toCell(target.p);
    const to = tmp.a.set(t3[0] - c[0], t3[1] - c[1], t3[2] - c[2]), dist = to.length();
    if (dist < 1e-6) return;
    to.divideScalar(dist);
    const gap = dist - STAND * SIZE_CELL, step = gap * Math.min(1, dt * 2.5);
    for (let i = 0; i < 3; i++) c[i] += to.getComponent(i) * step;
    moveTo(s, fromCell(c));
    const square = tmp.fwd.set(0, 0, -1).applyQuaternion(drone.q).dot(to) > Math.cos(degToRad(4));
    if ((Math.abs(gap) < 0.01 && square) || s.t > 4) { s.phase = 'settle'; s.t = 0; }
  }

  useFrame(({ size, viewport, camera }, dt) => {
    dt = Math.min(dt, 0.05);
    if (drone.frozen) return; // P: all of it held where it is, the clouds and the laser too, their clock stopped
    drone.clock += dt;
    const m = pose();
    const now = drone.clock;
    const s = d;

    if (drone.pilot !== s.wasPilot) { s.wasPilot = drone.pilot; if (drone.pilot) takeOver(); else letGo(s); }
    drone.docking = drone.pilot && s.phase !== 'seek';
    let field = 0, leg: Leg | null = null;
    /** The take: the piece is drawn from where it is into the ring over the catch, then rides in with the grip. */
    const take = () => {
      s.phase = 'catch'; s.t = 0; s.blink = 0;
      target.up = false; target.scale = 0;
      drone.taken = 1; drone.grab4 = target.p.slice() as V4; drone.grabMap = target.map; drone.grabK = 0;
    };
    if (s.phase !== 'seek') {
      // the catch's clock, in either mode. At the controls the device docks and holds still through it; on its own
      // it takes the piece on the fly and carries on in its curve, the machine turning as it goes
      s.t += dt;
      if (s.phase === 'settle' && s.t > SETTLE) take();
      else if (s.phase === 'catch' && s.t > CATCH) { s.phase = 'turn'; s.t = 0; if (!target.up) newTarget(s); } // the catch no longer turns the machine a quarter: paused, it stays still; turning, it turns anyway
      else if (s.phase === 'turn' && s.t > GLIDE) { s.phase = 'rest'; s.t = 0; }
      else if (s.phase === 'rest' && s.t > REST) { s.phase = 'seek'; }
    }
    if (s.phase === 'dock' && drone.pilot) {
      dock(s, dt);
    } else if (s.phase !== 'seek' && drone.pilot) {
      // docked: still, eye on the piece
      drone.turn[0] = drone.turn[1] = 0; drone.cvel = [0, 0, 0];
      s.wall = null;
    } else if (drone.pilot) {
      field = pilot(s, dt);
    } else {
      // move, in 4D, along the leg; the field round a face slows it
      if (!s.leg) {
        // the next step of the plan; with none, a first piece, or the way to the one that is up
        if (!s.plan.length) { if (target.up && target.map) planTo(s); else newTarget(s); }
        let step = s.plan.shift();
        // a wall on the held axis is no wall of this cell: the plan was laid from another cell, lay it again from here
        if (step && step.kind === 'portal' && step.axis === drone.held) { planTo(s); step = s.plan.shift(); }
        s.leg = !step ? cruiseLeg(s) : step.kind === 'cruise' ? cruiseLeg(s, step.to, step.toTarget) : portalLeg(s, step.axis, step.sign, step.face, step.beyond);
        s.s = 0; s.dist = 0;
      }
      leg = s.leg;
      field = leg.kind === 'portal' ? DIP * Math.exp(-(((s.s - 0.5) / FIELD) ** 2)) : 0;
      // on at a constant speed, by distance along the path, through walls and all (a dip at the face, then a rush
      // through it, were tried); only the last stretch to the piece slows, eased, for the catch
      const arrive = leg.kind === 'cruise' && leg.toTarget ? 1 - (1 - ARRIVE_SLOW) * smoothstep(s.dist, leg.len * (1 - ARRIVE), leg.len) : 1;
      s.dist += SPEED * arrive * dt;
      s.s = s.dist >= leg.len ? 1 : atDist(leg.arc, s.dist);
      moveTo(s, path(leg.pts, Math.min(1, s.s)));
      if (leg.kind === 'portal' && !leg.crossed && s.s >= 0.5) {
        leg.crossed = true;
        s.came = cross(s, leg.face.axis, leg.face.sign, s.p.slice() as V4);
      }
      if (s.s >= 1) {
        s.p[drone.held] = drone.sign; s.leg = null;
        if (leg.kind === 'cruise' && leg.toTarget) take(); // at the piece: taken on the fly
      }
      // the wall, named from whichever cell it is in now: before the crossing the face's axis, after it the old held
      s.wall = leg.kind === 'portal' && s.s > 0.25 && s.s < 0.75 ? (leg.crossed ? s.came : leg.face) : null;
    }
    // the ripple runs its course
    if (drone.flash.t >= 0) { drone.flash.t += dt; if (drone.flash.t > RIPPLE) drone.flash.t = -1; }
    drone.p = s.p;

    // the walls close in the field, the ball shuts round the body going through a wall, and open out again after;
    // the shutter blinks once at the crossing and now and then on its own
    s.nextBlink -= dt;
    if (s.nextBlink <= 0) { s.blink = 0; s.nextBlink = 4 + Math.random() * 6; }
    s.blink += dt;
    const BLINK = 0.55;
    const shut = s.blink < BLINK ? Math.sin((s.blink / BLINK) * Math.PI) : 0;
    if (s.blink >= BLINK) s.blink = Infinity;
    // the scoop: out fast once the device has come to a stop in front of the piece (on its own, as it closes in), as
    // far as the piece is; it shuts once the piece is in the bowl, and goes home shut, the piece riding in it
    const near = target.up && len4(sub4(target.p, s.p)) < 0.3;
    const onPiece = near || (drone.pilot && s.phase !== 'seek' && target.up); // at the controls, docking or docked
    const want = (s.phase === 'settle' && s.t > PAUSE) || s.phase === 'catch' || (s.phase === 'seek' && near); // out as it closes in, through the take, then home
    s.grip += ((want ? 1 : 0) - s.grip) * Math.min(1, dt * (want ? 16 : 5));
    const wantShut = s.phase === 'catch' ? s.t > CATCH * 0.6 : drone.taken > 0.02;
    s.shut += ((wantShut ? 1 : 0) - s.shut) * Math.min(1, dt * (wantShut ? 12 : 6));
    if (onPiece) drone.gripAt = project(m, target.p, tmp.a).distanceTo(project(m, s.p, tmp.b)) / SIZE_MAIN;
    // the wings, the four shell petals: half shut as it flies, shut through a wall, and spread wide only for the
    // catch, from closing in on the piece till it is taken
    const capture = near || s.phase === 'settle' || s.phase === 'catch' || s.phase === 'dock';
    const wantShield = field > 0.12 ? 1 : capture ? 0 : WINGS_REST;
    s.shield += (wantShield - s.shield) * Math.min(1, dt * (wantShield > s.shield ? 5 : 2.5));
    drone.shield = s.shield; drone.shutter = shut; drone.grip = s.grip;
    const drive = (dev: Device) => { dev.shield(s.shield); dev.shutter(shut); dev.grip(s.grip, drone.gripAt, s.shut); };
    drive(s.q);

    // draw: where it is in 3D. Its orientation lives in cell space, drone.q: at the controls the pilot's, on its own
    // the way it is going, with an up carried from frame to frame so no leg straight up or down flips it. From
    // there a cell's map takes the eye's forward and up to 4D, and the projection at the device gives the 3D pose.
    const { v, q, qa } = tmp;
    project(m, s.p, v);
    s.last.copy(v);
    // the wake: little clusters of puffs, a few small ones in a large faint one, round a point just behind the device,
    // a gap between
    if (v.distanceTo(s.puffAt) > s.puffGap) {
      const at = add4(s.p, s.dir, -0.05), n = 3 + Math.floor(Math.random() * 4), hex = CELL_HEX[cellId()];
      s.smoke.spawn(add4(at, [0, 1, 2, 3].map(() => rnd(-0.01, 0.01)) as V4), now, hex, 2.2 + Math.random());
      for (let i = 0; i < n; i++) s.smoke.spawn(add4(at, [0, 1, 2, 3].map(() => rnd(-0.022, 0.022)) as V4), now + rnd(0, 0.15), hex);
      s.puffAt.copy(v);
      s.puffGap = rnd(0.025, 0.06); // more clouds: twice as often as at first, and more to each
    }
    // and a steady line of small ones between the clusters, so the way it came reads
    if (v.distanceTo(s.trailAt) > 0.02) {
      s.smoke.spawn(add4(s.p, s.dir, -0.05), now, CELL_HEX[cellId()], 0.45);
      s.trailAt.copy(v);
    }
    // the laser through it, along the same way (LASER)
    if (s.laser) {
      s.laser.sample(add4(s.p, s.dir, -0.05), now, CELL_HEX[cellId()]);
      s.laser.update(m, now, size.width * viewport.dpr, size.height * viewport.dpr);
    }
    const vfov = degToRad((camera as THREE.PerspectiveCamera).fov);
    s.smoke.update(m, now, (size.height * viewport.dpr) / (2 * Math.tan(vfov / 2)));
    if (!drone.pilot || s.phase !== 'seek') {
      const c = toCell(s.p);
      const cv = tmp.a.set(c[0] - s.cLast[0], c[1] - s.cLast[1], c[2] - s.cLast[2]);
      s.cLast = c;
      // the way it is going; near the piece, the piece itself, so the scoop goes out at it
      if (onPiece) {
        const t3 = toCell(target.p);
        const at = tmp.b.set(t3[0] - c[0], t3[1] - c[1], t3[2] - c[2]);
        if (at.lengthSq() > 1e-8) s.look.lerp(at.normalize(), Math.min(1, dt * 10)).normalize();
      // the path weaves, S after S, about once a second; the eye takes the way it goes on the whole, not each turn
      } else if (cv.lengthSq() > 1e-10 && cv.lengthSq() < 0.25) s.look.lerp(cv.normalize(), Math.min(1, dt * LOOK_EASE)).normalize();
      s.camUp.set(0, 1, 0).applyQuaternion(drone.q);
      s.camUp.lerp(tmp.up, 0.04 * (1 - Math.abs(s.look.y))).normalize();
      drone.q.slerp(lookQuat(tmp.m, s.look, s.camUp, qa), Math.min(1, dt * 5));
    }
    const pose3 = (map: CellMap, out: THREE.Quaternion) => {
      const { fwd, right: upv } = tmp;
      fwd.set(0, 0, -1).applyQuaternion(drone.q);
      upv.set(0, 1, 0).applyQuaternion(drone.q);
      const E = 0.02;
      const f4 = dirFromCellWith(map, [fwd.x, fwd.y, fwd.z]), u4 = dirFromCellWith(map, [upv.x, upv.y, upv.z]);
      const f3 = project(m, add4(s.p, f4, E), tmp.f3).sub(v);
      const u3 = project(m, add4(s.p, u4, E), tmp.u3).sub(v);
      if (f3.lengthSq() < 1e-10 || u3.lengthSq() < 1e-10) return;
      out.slerp(lookQuat(tmp.m, f3, u3, q), Math.min(1, dt * 8));
    };
    pose3(drone, s.heading);
    s.q.g.quaternion.copy(s.heading);
    // At a wall the body is two copies, one in each cell's pose, each clipped to its own cell's side of the wall's
    // plane. In 4D nothing of the kind happens, the body just moves on, but in the picture two spaces meet at the
    // wall and this makes the hand-over plain. Away from walls the planes are far off and the other copy hidden.
    // The hand-over has its own life: it starts with a wall ahead, goes on through the crossing (cross() hands it to
    // the new cell) and ends once the body has come all the way up out of the wall, which can be after the flight
    // has left the wall behind. Another wall ahead in the meantime (two walls close together, as through a thin cell
    // in the picture) starts a new one; backing off a wall without going through drops it.
    if (s.wall && !(s.ho && sameWall(s.ho.wall, s.wall))) s.ho = { wall: s.wall, crossed: false, gone: 0 };
    else if (!s.wall && s.ho && !s.ho.crossed) s.ho = null;
    const ho = s.ho, wall = ho?.wall;
    const other = wall ? otherMap(wall.axis, wall.sign) : null;
    // how far each copy is into the wall, 0 to 1, for its tint; and whether the other copy is rising out of it
    let immA = 0, immB = 0, rising = false;
    // in, then out: the copy going into the wall, leaving its cell, fades as it sinks; the one coming out does not
    let fadeA = 1, fadeB = 1;
    const leaving = (k: number) => 1 - smoothstep(k, 0.15, 0.85);
    s.q.g.visible = true;
    if (ho && wall && other) {
      pose3(other, s.heading2);
      const corners = faceCorners(wall.axis, wall.sign);
      const [c0, c1, c2] = tmp.corners.map((c3, i) => project(m, corners[i], c3));
      s.planeA.setFromCoplanarPoints(c0, c1, c2);
      const centre: V4 = [0, 0, 0, 0]; centre[drone.held] = drone.sign;
      if (s.planeA.distanceToPoint(project(m, centre, tmp.a)) < 0) s.planeA.negate();
      s.planeB.copy(s.planeA);
      const centre2: V4 = [0, 0, 0, 0]; centre2[other.held] = other.sign;
      if (s.planeB.distanceToPoint(project(m, centre2, tmp.a)) < 0) s.planeB.negate();
      // The body goes in and comes out at once: as this cell's copy sinks into the wall the other cell's copy rises
      // out of it on that cell's side by the same amount, so between two cells on opposite sides of the wall that is
      // the two halves of one body, folded at the wall. Through the outer wall the next cell is on the same side, so
      // the other copy is mirrored in the wall's plane: it comes up out of the wall as this one goes down into it,
      // and the body's path, which turns back in at the wall, is read as the same body coming out again.
      const R = SIZE_MAIN, d = Math.max(0, s.planeA.distanceToPoint(v)); // how far the centre is into this cell's side, in 3D
      const imm = (x: number) => clamp((R + x) / (2 * R), 0, 1); // how far in is a copy whose centre is `x` into the wall
      const same = s.planeA.normal.dot(s.planeB.normal) > 0;
      s.q2.g.position.copy(v);
      if (same) s.q2.g.position.addScaledVector(s.planeA.normal, -2 * d);
      s.q2.g.quaternion.copy(s.heading2);
      drive(s.q2);
      let done = d >= R;
      if (!st.inout) {
        // both at once: this copy is this far into the wall, the other this far still in it
        s.q2.g.visible = true;
        immA = imm(-d); immB = imm(d);
      } else if (!ho.crossed) {
        // in, then out (o): going in, this copy sinks and the other is not there yet; the one going fades as it goes
        s.q2.g.visible = false;
        immA = imm(-d);
        fadeA = leaving(immA);
      } else {
        // across: the old copy sinks the rest of the way; this one waits inside the wall until the body is all in
        // and a gap further on, then comes up out of it and catches the body up over the rise, both in distance
        s.q2.g.visible = true;
        rising = true;
        const from = R * (1 + INOUT_GAP), e = smoothstep(d, from, from + R * INOUT_RISE);
        // it starts deep enough to be inside the wall however far the body has gone, and the set-back eases to
        // nothing along the rise, so the copy comes out at the body's own speed, no catching up to be seen
        const back = Math.max(INOUT_SET * R, d + R) * (1 - e);
        s.q.g.visible = d >= from;
        s.shift.copy(s.planeA.normal).multiplyScalar(-back);
        immB = imm(d);
        fadeB = leaving(immB); // the old copy, going, fades the rest of the way
        immA = s.q.g.visible ? imm(back - d) : 1;
        done = e >= 1;
      }
      // past the wall and all the way across, or long enough past it: the hand-over is done
      if (s.wall) ho.gone = 0;
      else if (ho.crossed && (done || (ho.gone += dt) > LINGER)) s.ho = null;
      // the renderer clips in world space, and the machine sits on a turned rig: the planes go through its matrix
      s.planeA.applyMatrix4(s.group.matrixWorld); s.planeB.applyMatrix4(s.group.matrixWorld);
    } else {
      s.q2.g.visible = false;
      s.planeA.set(tmp.up, 1e4); s.planeB.set(tmp.up, 1e4);
    }
    // whatever set-back is left from a hand-over cut short, the body catches up, eased rather than snapped
    if (!rising) s.shift.multiplyScalar(Math.max(0, 1 - dt * 6));
    s.q.g.position.copy(v).add(s.shift);
    // for the follow camera and the depth of field: the device in the world
    drone.world.copy(v).applyMatrix4(s.group.matrixWorld);
    // and which way it looks, in the world, for the chase camera: from its middle to its eye cap, the model's own
    // (its heading's axes, guessed, put the camera in front for a moment); its up, the cap's frame's
    const cap = (s.eyeCap ??= s.q.g.getObjectByName('eye_cap') ?? null);
    if (cap) {
      cap.getWorldPosition(tmp.a); s.q.g.getWorldPosition(tmp.b);
      if (tmp.a.distanceToSquared(tmp.b) > 1e-12) drone.worldFwd.subVectors(tmp.a, tmp.b).normalize();
      s.group.getWorldQuaternion(tmp.gq);
      drone.worldUp.set(0, 1, 0).applyQuaternion(s.heading).applyQuaternion(tmp.gq);
    }
    // while the body is sliced by a wall each half glows in the colour of the cell it is in: this copy in this
    // cell's, the other copy in the neighbour's, so the cut reads at a glance; whole again, the glow goes
    // a tint, not a glow: nothing until a quarter of the body is in the wall, then up a curve to half strength with
    // the body all the way in, and the same on the way out
    const curve = (k: number) => smoothstep(k, 0.25, 1) * GLOW;
    const hexA = CELL_HEX[cellId()], hexB = other ? CELL_HEX[cellIdOf(other)] : hexA;
    const wantA = curve(immA), wantB = curve(immB);
    const tintA = s.tintA + (wantA - s.tintA) * Math.min(1, dt * TINT_IN), tintB = s.tintB + (wantB - s.tintB) * Math.min(1, dt * TINT_IN);
    if (Math.abs(tintA - s.tintA) > 0.002 || (wantA && s.tintHexA !== hexA)) { s.q.tint(hexA, tintA); s.tintHexA = hexA; }
    if (Math.abs(tintB - s.tintB) > 0.002 || (wantB && s.tintHexB !== hexB)) { s.q2.tint(hexB, tintB); s.tintHexB = hexB; }
    s.tintA = tintA; s.tintB = tintB;
    s.q.fade(fadeA); s.q2.fade(fadeB);

    // the grid on the wall: it comes up as the device heads for a wall, in the colour of the cell beyond, and goes
    // once it is through. Lines on a wall in 4D project to lines, so each is just its two ends put through the turn.
    {
      const k = s.gridK + ((ho && wall && !ho.crossed ? 1 : 0) - s.gridK) * Math.min(1, dt * 5);
      s.gridK = k;
      // with the hand-over over and the grid still fading, it fades where it was last drawn
      s.grid.visible = k > 0.01;
      const gu = (s.grid.material as HexMat).uniforms;
      gu.opacity.value = k * GRID_A;
      if (s.grid.visible && wall) {
        // the wall's middle and its two ways along it, through the turn; the shader does the rest
        const c0 = facePoint(wall.axis, wall.sign, 0, 0), cu = facePoint(wall.axis, wall.sign, 1, 0), cv = facePoint(wall.axis, wall.sign, 0, 1);
        turned(m, c0, gu.wC.value);
        turned(m, cu.map((x, i) => x - c0[i]), gu.wU.value);
        turned(m, cv.map((x, i) => x - c0[i]), gu.wV.value);
        // the cell beyond: before the crossing the neighbour, after it this one
        const hex = ho && !ho.crossed ? hexB : hexA;
        if (hex !== s.gridHex) { gu.color.value.set(hex); s.gridHex = hex; }
      }
    }

    // the piece: emerging or there, turning slowly; taken, it is the held one: in the ring, riding in with the grip,
    // swallowed as the ring reaches the cap
    target.scale += ((target.up ? 1 : 0) - target.scale) * Math.min(1, dt * 4);
    s.piece.visible = target.up && target.scale > 0.02;
    if (s.piece.visible) {
      project(m, target.p, s.piece.position);
      s.piece.scale.setScalar(target.scale);
      s.piece.rotation.y += dt * 0.8; s.piece.rotation.z = 0.5;
    }
    if (drone.taken > 0) {
      drone.grabK = s.phase === 'catch' ? smoothstep(s.t, 0, CATCH * 0.6) : 1; // into the bowl, then the blade shuts
      if (s.grip < 0.2 && drone.grabK >= 1) drone.taken = Math.max(0, drone.taken - dt * 6);
      const fwd3 = tmp.a.set(0, 0, -1).applyQuaternion(s.heading);
      const ring = tmp.b.copy(v).addScaledVector(fwd3, ringOut(s.grip, drone.gripAt) * SIZE_MAIN);
      // taken, the piece goes with the device from where it was then, and is drawn from there into the bowl: on its
      // own the device flies on, and a piece left in 4D would fall behind and come in through the back of the bowl
      if (s.grabOf !== drone.grab4) { s.grabOf = drone.grab4; project(m, drone.grab4, s.grabLocal).sub(v).applyQuaternion(tmp.qa.copy(s.heading).invert()); }
      s.grabbed.position.copy(s.grabLocal).applyQuaternion(s.heading).add(v).lerp(ring, drone.grabK);
      s.grabbed.scale.setScalar(drone.taken);
    }
    s.grabbed.visible = drone.taken > 0.02;
    blink(now);

    // the ripple on the wall just gone through, on the honeycomb: a wave runs out from the crossing over the wall in
    // 4D and each edge lights as it passes, with a faint wash left behind it; the wall's corners as they were at the
    // crossing, so the honeycomb stays on that wall whatever the cell is now
    {
      const t = drone.flash.t, rip = s.ripple;
      rip.visible = t >= 0;
      if (rip.visible) {
        const u = t / RIPPLE, [c0, c1, , c3] = drone.flash.corners, p4 = drone.flash.p4;
        const U = c1.map((x, i) => (x - c0[i]) / 2), V = c3.map((x, i) => (x - c0[i]) / 2); // unit, along the wall
        const C = c0.map((x, i) => x + U[i] + V[i]); // the wall's middle
        let pu = 0, pv = 0; // the crossing, on the wall
        for (let i = 0; i < 4; i++) { pu += (p4[i] - C[i]) * U[i]; pv += (p4[i] - C[i]) * V[i]; }
        const ru = (rip.material as HexMat).uniforms;
        turned(m, C, ru.wC.value); turned(m, U, ru.wU.value); turned(m, V, ru.wV.value);
        ru.color.value.set(drone.flash.color);
        ru.at.value.set(pu, pv);
        ru.front.value = RIPPLE_R * u;
        ru.opacity.value = Math.pow(1 - u, 1.2);
      }
    }
  });

  return <primitive object={d.group} />;
}
