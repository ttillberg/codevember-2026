import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose } from './state';
import { drone, startCell, crossInto, faceQuad, toCell, fromCell, wallCorners } from './drone';
import { device, DEVICE_URL } from './device';

// A device that lives in the tesseract: a ball with one eye, fins that are walls, a shutter. It is inside one of the eight cells, a cube with one coordinate held at
// ±1 and the other three free, and it can only leave through a square face into the neighbouring cell. The passage is
// one smooth curve in 4D: it bends from the way it was flying to the way into the next cell, which in 4D is a right
// angle, slows to half speed in the face and picks up again, as if through a field. Everything is a point in 4D seen
// through the same turn and perspective as the struts, so what looks like speed is partly the warp of the cell it is
// in. The trail is kept in 4D too, and turns with the rest.

const TRAIL = 56;
const TRAIL_EVERY = 0.05; // seconds between trail samples
const SPEED = 0.5; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so the drone keeps clear of the struts
const FIELD = 0.12; // half-width, in path fraction, of the slow zone round the face
const DIP = 0.55; // how much of the speed the field takes
// at the controls: cell-space units per second squared and per second, radians per second
const THRUST = 1.6, DRAG = 1.1, VMAX = 1.1, TURN = 1.7;

type Leg = { kind: 'cruise' | 'portal'; pts: V4[]; len: number; face?: { axis: number; sign: number; corners: V4[] }; crossed: boolean };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const add4 = (a: V4, b: V4, k = 1): V4 => a.map((x, i) => x + b[i] * k) as V4;
const sub4 = (a: V4, b: V4): V4 => a.map((x, i) => x - b[i]) as V4;
const scale4 = (a: V4, k: number): V4 => a.map((x) => x * k) as V4;
const len4 = (a: V4) => Math.hypot(a[0], a[1], a[2], a[3]);
const unit4 = (a: V4): V4 => scale4(a, 1 / (len4(a) || 1));
const smooth = (t: number) => t * t * (3 - 2 * t);
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

const BLUE = '#4f8cff', LED = '#c9e35b';
const SIZE_MAIN = 0.095; // the device's radius in the main scene

export function Drones() {
  const gltf = useGLTF(DEVICE_URL);
  const d = useMemo(() => {
    const group = new THREE.Group();
    const q = device(gltf.scene, SIZE_MAIN);
    group.add(q.g);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.55, toneMapped: false }));
    line.frustumCulled = false;
    group.add(line);
    const flash = faceQuad(LED);
    group.add(flash.mesh);
    const held = Math.floor(Math.random() * 4), sign = Math.random() < 0.5 ? -1 : 1;
    const s = {
      group, q, line, flash,
      held, sign, came: null as [number, number] | null,
      p: [0, 0, 0, 0] as V4, dir: [0, 0, 0, 0] as V4, // where it is, which way it is going, in 4D
      leg: null as Leg | null, s: 0,
      trail: [] as V4[], trailAt: 0,
      last: new THREE.Vector3(), vel: new THREE.Vector3(), heading: new THREE.Quaternion(),
      shield: 0, blink: Infinity, nextBlink: 3 + Math.random() * 5, // seconds into the blink; seconds to a blink of its own
      wasPilot: false, yawV: 0, pitchV: 0,
    };
    s.p = roomIn(s);
    s.dir = unit4(sub4(roomIn(s), s.p));
    project(pose(), s.p, s.last);
    startCell(held, sign);
    return s;
  }, []);
  type S = typeof d;

  function roomIn(s: { held: number; sign: number }): V4 {
    const v = [0, 1, 2, 3].map(() => rnd(-ROOM, ROOM)) as V4;
    v[s.held] = s.sign;
    return v;
  }
  /** A leg to a point inside the cell, bending out of the current heading. */
  function cruiseLeg(s: S): Leg {
    const to = roomIn(s);
    const L = len4(sub4(to, s.p));
    const c0 = inCell(add4(s.p, s.dir, L * 0.35), s.held, s.sign);
    const mid = inCell(add4(scale4(add4(s.p, to), 0.5), [rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15)]), s.held, s.sign);
    const c1 = inCell(add4(mid, sub4(c0, s.p), -0.3), s.held, s.sign);
    const c2 = inCell(add4(mid, sub4(to, mid), 0.3), s.held, s.sign);
    const c3 = inCell(add4(to, sub4(to, mid), -0.2), s.held, s.sign);
    const pts = [s.p, c0, c1, mid, c2, c3, to];
    return { kind: 'cruise', pts, len: pathLen(pts), crossed: false };
  }
  /** A leg out through a face into the neighbour, not the face it came through: one curve, the face at its middle. */
  function portalLeg(s: S): Leg {
    const choices: [number, number][] = [];
    for (const axis of [0, 1, 2, 3]) if (axis !== s.held) for (const sign of [-1, 1]) {
      if (s.came && s.came[0] === axis && s.came[1] === sign) continue;
      choices.push([axis, sign]);
    }
    const [axis, sign] = choices[Math.floor(Math.random() * choices.length)];
    const face = roomIn(s);
    face[axis] = sign;
    // beyond the face the held axis is free: a point in the next cell, a little in
    const beyond = face.slice() as V4;
    beyond[s.held] = s.sign * rnd(0.2, 0.6);
    for (const i of [0, 1, 2, 3]) if (i !== axis && i !== s.held) beyond[i] = rnd(-ROOM, ROOM);
    // in square to the face and square on from it: the turn is the 4D right angle itself, taken in the face, slowed
    // by the field. Every control point stays on the boundary, inside its cell; the path never leaves the tesseract.
    const out: V4 = [0, 0, 0, 0]; out[axis] = sign;
    const inward: V4 = [0, 0, 0, 0]; inward[s.held] = -s.sign;
    const L0 = len4(sub4(face, s.p)), L1 = len4(sub4(beyond, face));
    const pts = [
      s.p, inCell(add4(s.p, s.dir, L0 * 0.35), s.held, s.sign), add4(face, out, -L0 * 0.4), face,
      add4(face, inward, L1 * 0.4), inCell(add4(beyond, sub4(beyond, face), -0.25), axis, sign), beyond,
    ];
    // the face's four joints: the held axis and the face's axis fixed, the other two at the corners
    const corners: V4[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const c: V4 = [0, 0, 0, 0];
      const free = [0, 1, 2, 3].filter((i) => i !== axis && i !== s.held);
      c[axis] = sign; c[s.held] = s.sign; c[free[0]] = u; c[free[1]] = v;
      return c;
    });
    return { kind: 'portal', pts, len: pathLen(pts), face: { axis, sign, corners }, crossed: false };
  }

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), qa: new THREE.Quaternion() }), []);

  /** Hands on: taken over, the device keeps the way it was going; let go, it carries on from there on its own. */
  function takeOver(s: S) {
    const here = toCell(s.p), ahead = toCell(add4(s.p, s.dir, 0.1));
    const v = new THREE.Vector3(ahead[0] - here[0], ahead[1] - here[1], ahead[2] - here[2]);
    if (v.lengthSq() < 1e-8) v.set(0, 0, -1);
    v.normalize();
    tmp.m.lookAt(new THREE.Vector3(), v, tmp.up);
    drone.q.setFromRotationMatrix(tmp.m);
    drone.cvel = [v.x * SPEED, v.y * SPEED, v.z * SPEED];
    s.yawV = s.pitchV = 0;
  }
  function letGo(s: S) {
    s.p[s.held] = s.sign;
    s.leg = null; s.came = null;
  }
  /** One step at the controls, in cell space: eased yaw and pitch, thrust along the eye against drag, and the same
   * crossing as on its own when it goes through a wall; the field round the walls slows it too. Returns the field. */
  function pilot(s: S, dt: number): number {
    const { fwd, right, qa } = tmp, k = drone.keys;
    s.yawV += (k.yaw * TURN - s.yawV) * Math.min(1, dt * 6);
    s.pitchV += (k.pitch * TURN - s.pitchV) * Math.min(1, dt * 6);
    right.set(1, 0, 0).applyQuaternion(drone.q);
    drone.q.premultiply(qa.setFromAxisAngle(tmp.up, s.yawV * dt)).premultiply(qa.setFromAxisAngle(right, s.pitchV * dt)).normalize();
    fwd.set(0, 0, -1).applyQuaternion(drone.q);
    const c = toCell(s.p), cv = drone.cvel;
    // the nearest wall and the field there
    let dmin = Infinity, kw = 0, tw = 1;
    for (let i = 0; i < 3; i++) for (const t of [-1, 1]) {
      const dist = Math.abs(drone.centre[i] + t - c[i]);
      if (dist < dmin) { dmin = dist; kw = i; tw = t; }
    }
    const field = DIP * Math.exp(-((dmin / 0.22) ** 2));
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < 3; i++) cv[i] = (cv[i] + fwd.getComponent(i) * k.thrust * THRUST * dt) * drag;
    const sp = Math.hypot(cv[0], cv[1], cv[2]);
    if (sp > VMAX) for (let i = 0; i < 3; i++) cv[i] *= VMAX / sp;
    for (let i = 0; i < 3; i++) c[i] += cv[i] * (1 - field) * dt;
    // the wall ahead lights as it closes in, and through: the same swap of held axis as on its own
    drone.flash.corners = wallCorners(kw, tw);
    drone.flash.a = Math.exp(-(((dmin - 0.1) / 0.12) ** 2));
    const over = c[kw] - (drone.centre[kw] + tw);
    if (over * tw > 0) {
      crossInto(drone.axisOf[kw], tw * drone.A[kw][drone.axisOf[kw]]);
      s.held = drone.held; s.sign = drone.sign;
      s.blink = 0;
    }
    const prev = s.p;
    s.p = fromCell(c);
    const step = sub4(s.p, prev);
    if (len4(step) > 1e-6) s.dir = unit4(step);
    return field;
  }

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = pose();
    const now = performance.now() / 1000;
    const s = d;

    if (drone.pilot !== s.wasPilot) { s.wasPilot = drone.pilot; if (drone.pilot) takeOver(s); else letGo(s); }
    let field = 0, leg: Leg | null = null;
    if (drone.pilot) {
      field = pilot(s, dt);
    } else {
      // move, in 4D, along the leg; the field round a face slows it
      if (!s.leg) { s.leg = Math.random() < 0.5 ? cruiseLeg(s) : portalLeg(s); s.s = 0; }
      leg = s.leg;
      field = leg.kind === 'portal' ? DIP * Math.exp(-(((s.s - 0.5) / FIELD) ** 2)) : 0;
      s.s += (SPEED * (1 - field) / leg.len) * dt;
      const prev = s.p;
      s.p = path(leg.pts, Math.min(1, s.s));
      const step = sub4(s.p, prev);
      if (len4(step) > 1e-6) s.dir = unit4(step);
      if (leg.kind === 'portal' && !leg.crossed && s.s >= 0.5) {
        // through: the face's axis is held now, the old one is free
        leg.crossed = true;
        s.came = [s.held, s.sign];
        crossInto(leg.face!.axis, leg.face!.sign);
        s.held = leg.face!.axis; s.sign = leg.face!.sign;
        s.blink = 0;
      }
      if (s.s >= 1) { s.p[s.held] = s.sign; s.leg = null; }
      // the face lights just before the drone goes through, and is out again as it does
      if (leg.kind === 'portal') {
        drone.flash.corners = leg.face!.corners;
        drone.flash.a = Math.exp(-(((s.s - 0.4) / 0.06) ** 2));
      } else drone.flash.a = 0;
    }
    drone.p = s.p;
    if (now - s.trailAt > TRAIL_EVERY) {
      s.trail.push(s.p.slice() as V4);
      if (s.trail.length > TRAIL) s.trail.shift();
      s.trailAt = now;
    }

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
    drone.shield = s.shield; drone.shutter = shut;
    s.q.shield(s.shield); s.q.shutter(shut);

    // draw: where it is in 3D, the eye along the way it is going, a slow lean into the move, nothing abrupt
    const { v, up, q, tilt, axis } = tmp;
    project(m, s.p, v);
    s.vel.subVectors(v, s.last).divideScalar(Math.max(dt, 1e-3));
    s.last.copy(v);
    s.q.g.position.copy(v);
    const speed = s.vel.length();
    if (speed > 0.05) {
      tmp.m.lookAt(new THREE.Vector3(), s.vel, up); // the eye looks along -z
      q.setFromRotationMatrix(tmp.m);
      axis.crossVectors(up, s.vel).normalize();
      tilt.setFromAxisAngle(axis, Math.min(0.3, speed * 0.2));
      q.premultiply(tilt);
      s.heading.slerp(q, Math.min(1, dt * 2.5));
    }
    s.q.g.quaternion.copy(s.heading);

    drone.flash.corners.forEach((c4, i) => { project(m, c4, v); s.flash.set(i, v); });
    s.flash.done();
    s.flash.mat.opacity = 0.6 * drone.flash.a;

    const pos = s.line.geometry.attributes.position as THREE.BufferAttribute;
    s.trail.forEach((p4, i) => { project(m, p4, v); pos.setXYZ(i, v.x, v.y, v.z); });
    pos.needsUpdate = true;
    s.line.geometry.setDrawRange(0, s.trail.length);
  });

  return <primitive object={d.group} />;
}
