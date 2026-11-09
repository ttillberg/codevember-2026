import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose, turnGlide, st } from './state';
import { drone, target, startCell, crossInto, faceQuad, pieceMesh, blink, toCell, fromCell, dirFromCellWith, otherMap, mapAcross, faceCorners, wallOf, cellId, cellIdOf, lampColor, CELL_HEX, RIPPLE, SIZE_MAIN, SIZE_CELL, type CellMap } from './drone';
import { device, ringOut, DEVICE_URL, type Device } from './device';
import { makeSmoke } from './smoke';
import { makeLaser } from './laser';

// A device that lives in the tesseract: a ball with one eye, fins that are walls, a shutter. It is inside one of the eight cells, a cube with one coordinate held at
// ±1 and the other three free, and it can only leave through a square face into the neighbouring cell. The passage is
// one smooth curve in 4D: it bends from the way it was flying to the way into the next cell, which in 4D is a right
// angle, slows to half speed in the face and picks up again, as if through a field. Everything is a point in 4D seen
// through the same turn and perspective as the struts, so what looks like speed is partly the warp of the cell it is
// in. The wake is smoke, each puff kept in 4D too, so it turns with the rest.

const SPEED = 0.5; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so the drone keeps clear of the struts
const FIELD = 0.14; // half-width, in path fraction, of the slow zone round the face
const DIP = 0.3; // how much of the speed the field takes: a lean through it, not a stop
// the catch, in phases: still in front of the piece; the grip takes it; the machine glides a quarter turn while the
// next piece emerges; still again; and off
const SETTLE = 0.6, CATCH = 0.35, GLIDE = 2.0, REST = 0.5;
const TINT_IN = 14; // how fast the glow on the half inside a new cell comes and goes, per second
// in-then-out: seconds the body stays in after it is all in before the next cell's copy starts up out of the wall,
// and seconds that copy takes to come out; how deep in the wall it starts, in radii; and seconds the hand-over may
// linger past the wall state
const INOUT_GAP = 0.3, INOUT_RISE = 0.7, INOUT_SET = 3, LINGER = 3;
const GLOW = 0.9; // the strength of the cell-colour tint on a half in a wall: 0.9 of the tint's own 0.55 is about half
// at the controls the device docks on its own: the piece this close (in device radii, in cell space), the device this
// slow (cell units a second) and the piece this well ahead (cosine), and the catch takes over
const DOCK_AT = 2.6, DOCK_V = 0.35, DOCK_AHEAD = 0.6;
const REACH3 = 1.9; // where the piece should sit when the device stops, in device radii, on screen
type Phase = 'seek' | 'settle' | 'catch' | 'turn' | 'rest';
// at the controls: cell-space units per second squared and per second, radians per second
const THRUST = 1.6, DRAG = 1.1, VMAX = 1.1;

/** A wall of the current cell: the 4D axis of its face and the side it is on. */
type Wall = { axis: number; sign: number };
const sameWall = (a: Wall, b: Wall) => a.axis === b.axis && a.sign === b.sign;
/** The hand-over at a wall: which wall, named from the cell the device is in; whether it has gone through; seconds
 * the body has been all the way in since; seconds since the flight last had the wall ahead. */
type Handover = { wall: Wall; crossed: boolean; inT: number; gone: number };
type Leg = { pts: V4[]; len: number; crossed: boolean } & ({ kind: 'cruise'; toTarget: boolean } | { kind: 'portal'; face: Wall });
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
function pathLen(pts: V4[]): number {
  let L = 0, prev = path(pts, 0);
  for (let i = 1; i <= 24; i++) { const p = path(pts, i / 24); L += len4(sub4(p, prev)); prev = p; }
  return L;
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
    const laser = makeLaser();
    group.add(laser.line);
    const flash = faceQuad();
    group.add(flash.mesh);
    const piece = pieceMesh();
    piece.visible = false;
    group.add(piece);
    const grabbed = pieceMesh(); // the one just taken, in the ring on its way in
    grabbed.visible = false;
    group.add(grabbed);
    startCell(Math.floor(Math.random() * 4), Math.random() < 0.5 ? -1 : 1);
    const s = {
      group, q, smoke, laser, puffAt: new THREE.Vector3(1e9, 0, 0), puffGap: 0.04, trailAt: new THREE.Vector3(1e9, 0, 0), flash, ho: null as Handover | null, shift: new THREE.Vector3(), tintA: 0, tintB: 0, tintHexA: '', tintHexB: '', piece, grabbed,
      came: null as Wall | null, // the wall of the leg it is on, once through it, named from the new cell
      p: [0, 0, 0, 0] as V4, dir: [0, 0, 0, 0] as V4, // where it is, which way it is going, in 4D
      leg: null as Leg | null, s: 0,
      last: new THREE.Vector3(), heading: new THREE.Quaternion(), heading2: new THREE.Quaternion(),
      q2, planeA, planeB, cLast: [0, 0, 0], look: new THREE.Vector3(0, 0, -1), camUp: new THREE.Vector3(0, 1, 0),
      wall: null as Wall | null, // the wall the flight has it at, if any
      plan: [] as Step[], phase: 'seek' as Phase, t: 0, // the steps to the piece; the catch's phase and its clock
      grip: 0,
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
    const c0 = inCell(add4(s.p, s.dir, L * 0.35), held, sign);
    const mid = inCell(add4(scale4(add4(s.p, to), 0.5), [rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)]), held, sign);
    const c1 = inCell(add4(mid, sub4(c0, s.p), -0.3), held, sign);
    const c2 = inCell(add4(mid, sub4(to, mid), 0.3), held, sign);
    const c3 = inCell(add4(to, sub4(to, mid), -0.2), held, sign);
    const pts = [s.p, c0, c1, mid, c2, c3, to];
    return { kind: 'cruise', pts, len: pathLen(pts), crossed: false, toTarget };
  }
  /** A leg out through the face where `axis` is `sign`, at `face`, on to `beyond` in the next cell: one curve, the
   * face at its middle. In square to the face and square on from it: the turn is the 4D right angle itself, taken in
   * the face, eased by the field. Every control point stays on the boundary, inside its cell. */
  function portalLeg(s: S, axis: number, sign: number, face: V4, beyond: V4): Leg {
    const out: V4 = [0, 0, 0, 0]; out[axis] = sign;
    const inward: V4 = [0, 0, 0, 0]; inward[drone.held] = -drone.sign;
    const L0 = len4(sub4(face, s.p)), L1 = len4(sub4(beyond, face));
    const pts = [
      s.p, inCell(add4(s.p, s.dir, L0 * 0.35), drone.held, drone.sign), add4(face, out, -L0 * 0.4), face,
      add4(face, inward, L1 * 0.4), inCell(add4(beyond, sub4(beyond, face), -0.25), axis, sign), beyond,
    ];
    return { kind: 'portal', pts, len: pathLen(pts), face: { axis, sign }, crossed: false };
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
    if (s.phase === 'settle') s.phase = 'seek';
  }
  /** Through the wall where 4D axis `axis` is `sign`, crossed at `p4`: the face's axis is held now, the old one free;
   * the wall ripples from the crossing in the new cell's colour, the shutter blinks, and the hand-over goes on in the
   * new cell. Returns the wall just crossed as the new cell names it: the axis that was held, now free. */
  function cross(s: S, axis: number, sign: number, p4: V4): Wall {
    const was = { axis: drone.held, sign: drone.sign };
    drone.flash.corners = faceCorners(axis, sign); drone.flash.p4 = p4; drone.flash.t = 0;
    crossInto(axis, sign);
    drone.flash.color = CELL_HEX[cellId()];
    s.blink = 0;
    s.ho = { wall: was, crossed: true, inT: 0, gone: 0 };
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
    // close to the piece, slow and facing it: dock, and the catch takes over from here
    if (target.up && target.map && target.map.held === drone.held && target.map.sign === drone.sign && sp < DOCK_V) {
      const t3 = toCell(target.p), dx = t3[0] - c[0], dy = t3[1] - c[1], dz = t3[2] - c[2], dist = Math.hypot(dx, dy, dz);
      if (dist < DOCK_AT * SIZE_CELL && dist > 1e-6 && (fwd.x * dx + fwd.y * dy + fwd.z * dz) / dist > DOCK_AHEAD) {
        s.phase = 'settle'; s.t = 0;
        cv[0] = cv[1] = cv[2] = 0; k.thrust = 0; drone.turn[0] = drone.turn[1] = 0;
        s.look.copy(fwd); s.cLast = c.slice();
      }
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

  useFrame(({ size, viewport, camera }, dt) => {
    dt = Math.min(dt, 0.05);
    const m = pose();
    const now = performance.now() / 1000;
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
      else if (s.phase === 'catch' && s.t > CATCH) { s.phase = 'turn'; s.t = 0; if (!st.hard) turnGlide(GLIDE); if (!target.up) newTarget(s); } // hard mode turns all the time anyway
      else if (s.phase === 'turn' && s.t > GLIDE) { s.phase = 'rest'; s.t = 0; }
      else if (s.phase === 'rest' && s.t > REST) { s.phase = 'seek'; }
    }
    if (s.phase !== 'seek' && drone.pilot) {
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
        s.s = 0;
      }
      leg = s.leg;
      field = leg.kind === 'portal' ? DIP * Math.exp(-(((s.s - 0.5) / FIELD) ** 2)) : 0;
      s.s += (SPEED * (1 - field) / leg.len) * dt;
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
    const wantShield = field > 0.12 ? 1 : 0;
    s.shield += (wantShield - s.shield) * Math.min(1, dt * (wantShield ? 5 : 2.5));
    s.nextBlink -= dt;
    if (s.nextBlink <= 0) { s.blink = 0; s.nextBlink = 4 + Math.random() * 6; }
    s.blink += dt;
    const BLINK = 0.55;
    const shut = s.blink < BLINK ? Math.sin((s.blink / BLINK) * Math.PI) : 0;
    if (s.blink >= BLINK) s.blink = Infinity;
    // the grip: out fast once the device has come to a stop in front of the piece (at the controls, when it is within
    // reach), as far as the piece is; home again once it is taken, the piece riding in the ring
    const near = target.up && len4(sub4(target.p, s.p)) < 0.3;
    const want = (s.phase === 'settle' && s.t > 0.25) || s.phase === 'catch' || (s.phase === 'seek' && near); // out as it closes in, through the take, then home
    s.grip += ((want ? 1 : 0) - s.grip) * Math.min(1, dt * (want ? 16 : 5));
    if (near) drone.gripAt = project(m, target.p, tmp.a).distanceTo(project(m, s.p, tmp.b)) / SIZE_MAIN;
    drone.shield = s.shield; drone.shutter = shut; drone.grip = s.grip;
    const drive = (dev: Device) => { dev.shield(s.shield); dev.shutter(shut); dev.grip(s.grip, drone.gripAt); };
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
      const at = add4(s.p, s.dir, -0.05), n = 2 + Math.floor(Math.random() * 3), hex = CELL_HEX[cellId()];
      s.smoke.spawn(add4(at, [0, 1, 2, 3].map(() => rnd(-0.01, 0.01)) as V4), now, hex, 2.2 + Math.random());
      for (let i = 0; i < n; i++) s.smoke.spawn(add4(at, [0, 1, 2, 3].map(() => rnd(-0.022, 0.022)) as V4), now + rnd(0, 0.15), hex);
      s.puffAt.copy(v);
      s.puffGap = rnd(0.05, 0.12);
    }
    // and a steady line of small ones between the clusters, so the way it came reads
    if (v.distanceTo(s.trailAt) > 0.02) {
      s.smoke.spawn(add4(s.p, s.dir, -0.05), now, CELL_HEX[cellId()], 0.45);
      s.trailAt.copy(v);
    }
    // the laser through it, along the same way
    s.laser.sample(add4(s.p, s.dir, -0.05), now, CELL_HEX[cellId()]);
    s.laser.update(m, now, size.width * viewport.dpr, size.height * viewport.dpr);
    const vfov = degToRad((camera as THREE.PerspectiveCamera).fov);
    s.smoke.update(m, now, (size.height * viewport.dpr) / (2 * Math.tan(vfov / 2)));
    if (!drone.pilot || s.phase !== 'seek') {
      const c = toCell(s.p);
      const cv = tmp.a.set(c[0] - s.cLast[0], c[1] - s.cLast[1], c[2] - s.cLast[2]);
      s.cLast = c;
      // the way it is going; near the piece, the piece itself, so the grip goes out at it
      if (near) {
        const t3 = toCell(target.p);
        const at = tmp.b.set(t3[0] - c[0], t3[1] - c[1], t3[2] - c[2]);
        if (at.lengthSq() > 1e-8) s.look.lerp(at.normalize(), Math.min(1, dt * 10)).normalize();
      } else if (cv.lengthSq() > 1e-10 && cv.lengthSq() < 0.25) s.look.lerp(cv.normalize(), Math.min(1, dt * 4)).normalize();
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
    if (s.wall && !(s.ho && sameWall(s.ho.wall, s.wall))) s.ho = { wall: s.wall, crossed: false, inT: 0, gone: 0 };
    else if (!s.wall && s.ho && !s.ho.crossed) s.ho = null;
    const ho = s.ho, wall = ho?.wall;
    const other = wall ? otherMap(wall.axis, wall.sign) : null;
    // how far each copy is into the wall, 0 to 1, for its tint; and whether the other copy is rising out of it
    let immA = 0, immB = 0, rising = false;
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
        // in, then out (o): going in, this copy sinks and the other is not there yet
        s.q2.g.visible = false;
        immA = imm(-d);
      } else {
        // across: the old copy sinks the rest of the way; this one waits inside the wall until the body is all in
        // and a moment more, then comes up out of it and catches the body up over the rise. Gap and rise are in
        // time, not distance: in the picture a cell can be small, and a distance there is a long way in 4D
        s.q2.g.visible = true;
        rising = true;
        if (d >= R) ho.inT += dt;
        const e = smoothstep(ho.inT, INOUT_GAP, INOUT_GAP + INOUT_RISE);
        // it starts deep enough to be inside the wall however far the body has gone, and the set-back eases to
        // nothing along the rise, so the copy comes out at the body's own speed, no catching up to be seen
        const back = Math.max(INOUT_SET * R, d + R) * (1 - e);
        s.q.g.visible = ho.inT >= INOUT_GAP;
        s.shift.copy(s.planeA.normal).multiplyScalar(-back);
        immB = imm(d);
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
      drone.grabK = s.phase === 'catch' ? smoothstep(s.t, 0, CATCH) : 1;
      if (s.grip < 0.2 && drone.grabK >= 1) drone.taken = Math.max(0, drone.taken - dt * 6);
      const fwd3 = tmp.a.set(0, 0, -1).applyQuaternion(s.heading);
      const ring = tmp.b.copy(v).addScaledVector(fwd3, ringOut(s.grip, drone.gripAt) * SIZE_MAIN);
      project(m, drone.grab4, s.grabbed.position).lerp(ring, drone.grabK);
      s.grabbed.scale.setScalar(drone.taken);
    }
    s.grabbed.visible = drone.taken > 0.02;
    blink(now);

    drone.flash.corners.forEach((c4, i) => { project(m, c4, v); s.flash.set(i, v); });
    s.flash.done();
    const across = project(m, drone.flash.corners[0], v).distanceTo(project(m, drone.flash.corners[2], tmp.fwd)) / 2;
    s.flash.pulse(project(m, drone.flash.p4, v), across, drone.flash.t, drone.flash.color);
  });

  return <primitive object={d.group} />;
}
