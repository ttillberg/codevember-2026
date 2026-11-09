import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose } from './state';
import { drone, target, startCell, crossInto, faceQuad, pieceMesh, blink, toCell, fromCell, dirFromCellWith, otherMap, mapAcross, wallCorners, type CellMap } from './drone';
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
const FIELD = 0.14; // half-width, in path fraction, of the slow zone round the face
const DIP = 0.3; // how much of the speed the field takes: a lean through it, not a stop
const HOLD = 1.0; // seconds from a piece taken to the next one emerging
// at the controls: cell-space units per second squared and per second, radians per second
const THRUST = 1.6, DRAG = 1.1, VMAX = 1.1, TURN = 1.7;

type Leg = { kind: 'cruise' | 'portal'; pts: V4[]; len: number; face?: { axis: number; sign: number; corners: V4[] }; crossed: boolean; toTarget?: boolean };
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
    // two copies: the one in this cell, and one for the cell on the other side of a wall it is passing through.
    // In 4D the half of the body through the wall lies in the neighbour's space and projects with the neighbour's
    // turn, so each copy is oriented by its own cell's map and clipped at the wall's plane; together they fold.
    const q = device(gltf.scene, SIZE_MAIN, true);
    const q2 = device(gltf.scene, SIZE_MAIN, true);
    group.add(q.g, q2.g);
    const planeA = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4), planeB = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
    q.clip([planeA]); q2.clip([planeB]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.55, toneMapped: false }));
    line.frustumCulled = false;
    group.add(line);
    const flash = faceQuad(LED);
    group.add(flash.mesh);
    const piece = pieceMesh();
    piece.visible = false;
    group.add(piece);
    const held = Math.floor(Math.random() * 4), sign = Math.random() < 0.5 ? -1 : 1;
    const s = {
      group, q, line, flash, piece,
      held, sign, came: null as [number, number] | null,
      p: [0, 0, 0, 0] as V4, dir: [0, 0, 0, 0] as V4, // where it is, which way it is going, in 4D
      leg: null as Leg | null, s: 0,
      trail: [] as V4[], trailAt: 0,
      last: new THREE.Vector3(), vel: new THREE.Vector3(), heading: new THREE.Quaternion(), heading2: new THREE.Quaternion(),
      q2, planeA, planeB, cLast: [0, 0, 0], look: new THREE.Vector3(0, 0, -1), camUp: new THREE.Vector3(0, 1, 0),
      wall: null as { axis: number; sign: number } | null, // the wall it is at, if any: the face's 4D axis and side
      plan: [] as Step[], wait: 0, // the steps to the piece; seconds since the last one was taken
      grip: 0,
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
  function cruiseLeg(s: S, to: V4 = roomIn(s), toTarget = false): Leg {
    const L = len4(sub4(to, s.p));
    const c0 = inCell(add4(s.p, s.dir, L * 0.35), s.held, s.sign);
    const mid = inCell(add4(scale4(add4(s.p, to), 0.5), [rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)]), s.held, s.sign);
    const c1 = inCell(add4(mid, sub4(c0, s.p), -0.3), s.held, s.sign);
    const c2 = inCell(add4(mid, sub4(to, mid), 0.3), s.held, s.sign);
    const c3 = inCell(add4(to, sub4(to, mid), -0.2), s.held, s.sign);
    const pts = [s.p, c0, c1, mid, c2, c3, to];
    return { kind: 'cruise', pts, len: pathLen(pts), crossed: false, toTarget };
  }
  /** A leg out through the face where `axis` is `sign`, at `face`, on to `beyond` in the next cell: one curve, the
   * face at its middle. In square to the face and square on from it: the turn is the 4D right angle itself, taken in
   * the face, eased by the field. Every control point stays on the boundary, inside its cell. */
  function portalLeg(s: S, axis: number, sign: number, face: V4, beyond: V4): Leg {
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
  /** A new piece two walls away, never back where it is, and the plan to it: two faces, each a little towards the
   * piece on the axes the cells share, then the last stretch. The piece's cell map is kept for the cam. */
  function newTarget(s: S) {
    const a1 = pick([0, 1, 2, 3].filter((a) => a !== s.held)), s1 = Math.random() < 0.5 ? -1 : 1;
    const a2 = pick([0, 1, 2, 3].filter((a) => a !== a1 && a !== s.held)), s2 = Math.random() < 0.5 ? -1 : 1;
    const to: V4 = [0, 1, 2, 3].map(() => rnd(-0.55, 0.55)) as V4;
    to[a2] = s2;
    const face1 = mix4(s.p, to, 0.35); face1[s.held] = s.sign; face1[a1] = s1; face1[a2] = Math.max(-0.5, Math.min(0.5, face1[a2]));
    const face2 = mix4(s.p, to, 0.7); face2[a1] = s1; face2[a2] = s2; face2[s.held] = s.sign * 0.45;
    const beyond1 = mix4(face1, face2, 0.45); beyond1[a1] = s1;
    const beyond2 = mix4(face2, to, 0.45); beyond2[a2] = s2;
    // the last leg stops a grip's reach short of the piece, so it is taken in the ring, not in the body
    const stop = add4(to, unit4(sub4(to, face2)), -0.1);
    s.plan = [
      { kind: 'portal', axis: a1, sign: s1, face: face1, beyond: beyond1 },
      { kind: 'portal', axis: a2, sign: s2, face: face2, beyond: beyond2 },
      { kind: 'cruise', to: stop, toTarget: true },
    ];
    target.p = to; target.up = true; target.scale = 0;
    target.map = mapAcross(mapAcross(drone, a1, s1), a2, s2);
  }

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), qa: new THREE.Quaternion() }), []);

  /** Hands on: taken over, the device keeps the way it was going; let go, it carries on from there on its own. */
  function takeOver(s: S) {
    // the orientation is already kept in cell space; it carries on from there, at cruising speed along the eye
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(drone.q);
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
    s.wall = dmin < 0.5 ? { axis: drone.axisOf[kw], sign: tw * drone.A[kw][drone.axisOf[kw]] } : null;
    const over = c[kw] - (drone.centre[kw] + tw);
    if (over * tw > 0) {
      const was = { axis: drone.held, sign: drone.sign };
      crossInto(drone.axisOf[kw], tw * drone.A[kw][drone.axisOf[kw]]);
      s.held = drone.held; s.sign = drone.sign;
      s.blink = 0;
      s.wall = was; // the wall just crossed, named from the new cell: the axis that was held, now free
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
      if (!s.leg) {
        // the next step of the plan; with none, a new piece once the last is a second gone; meanwhile a turn in the room
        if (!s.plan.length && !target.up && s.wait >= HOLD) newTarget(s);
        const step = s.plan.shift();
        s.leg = !step ? cruiseLeg(s) : step.kind === 'cruise' ? cruiseLeg(s, step.to, step.toTarget) : portalLeg(s, step.axis, step.sign, step.face, step.beyond);
        s.s = 0;
      }
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
      if (s.s >= 1) {
        s.p[s.held] = s.sign; s.leg = null;
        if (leg.toTarget) { target.up = false; s.wait = 0; s.blink = 0; } // taken: a blink, and the next one in a while
      }
      // the face lights just before the drone goes through, and is out again as it does
      if (leg.kind === 'portal') {
        drone.flash.corners = leg.face!.corners;
        drone.flash.a = Math.exp(-(((s.s - 0.4) / 0.06) ** 2));
        // the wall, named from whichever cell it is in now: before the crossing the face's axis, after it the old held
        s.wall = s.s > 0.25 && s.s < 0.75 ? (leg.crossed ? { axis: s.came![0], sign: s.came![1] } : { axis: leg.face!.axis, sign: leg.face!.sign }) : null;
      } else { drone.flash.a = 0; s.wall = null; }
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
    // the grip: out fast when the piece is within reach, home again once it is taken
    const near = target.up && len4(sub4(target.p, s.p)) < 0.3;
    s.grip += ((near ? 1 : 0) - s.grip) * Math.min(1, dt * (near ? 16 : 5));
    drone.shield = s.shield; drone.shutter = shut; drone.grip = s.grip;
    s.q.shield(s.shield); s.q.shutter(shut); s.q.grip(s.grip);

    // draw: where it is in 3D. Its orientation lives in cell space, drone.q: at the controls the pilot's, on its own
    // the way it is going, with an up carried from frame to frame so no leg straight up or down flips it. From
    // there a cell's map takes the eye's forward and up to 4D, and the projection at the device gives the 3D pose.
    const { v, q, qa } = tmp;
    project(m, s.p, v);
    s.vel.subVectors(v, s.last).divideScalar(Math.max(dt, 1e-3));
    s.last.copy(v);
    if (!drone.pilot) {
      const c = toCell(s.p);
      const cv = new THREE.Vector3(c[0] - s.cLast[0], c[1] - s.cLast[1], c[2] - s.cLast[2]);
      s.cLast = c;
      if (cv.lengthSq() > 1e-10 && cv.lengthSq() < 0.25) s.look.lerp(cv.normalize(), Math.min(1, dt * 4)).normalize();
      s.camUp.set(0, 1, 0).applyQuaternion(drone.q);
      s.camUp.lerp(tmp.up, 0.04 * (1 - Math.abs(s.look.y))).normalize();
      tmp.m.lookAt(new THREE.Vector3(), s.look, s.camUp);
      qa.setFromRotationMatrix(tmp.m);
      drone.q.slerp(qa, Math.min(1, dt * 5));
    }
    const pose3 = (map: CellMap, out: THREE.Quaternion) => {
      const { fwd, right: upv } = tmp;
      fwd.set(0, 0, -1).applyQuaternion(drone.q);
      upv.set(0, 1, 0).applyQuaternion(drone.q);
      const E = 0.02;
      const f4 = dirFromCellWith(map, [fwd.x, fwd.y, fwd.z]), u4 = dirFromCellWith(map, [upv.x, upv.y, upv.z]);
      const f3 = project(m, add4(s.p, f4, E), new THREE.Vector3()).sub(v);
      const u3 = project(m, add4(s.p, u4, E), new THREE.Vector3()).sub(v);
      if (f3.lengthSq() < 1e-10 || u3.lengthSq() < 1e-10) return;
      tmp.m.lookAt(new THREE.Vector3(), f3, u3);
      q.setFromRotationMatrix(tmp.m);
      out.slerp(q, Math.min(1, dt * 8));
    };
    pose3(drone, s.heading);
    s.q.g.position.copy(v);
    s.q.g.quaternion.copy(s.heading);
    // at a wall: the other copy in the neighbour's pose, and the two clipped against the wall's plane, this cell's
    // side for this copy, the far side for the other. Away from walls the planes are far off and the other copy hidden.
    if (s.wall) {
      const other = otherMap(s.wall.axis, s.wall.sign);
      pose3(other, s.heading2);
      s.q2.g.visible = true;
      s.q2.g.position.copy(v);
      s.q2.g.quaternion.copy(s.heading2);
      s.q2.shield(s.shield); s.q2.shutter(shut); s.q2.grip(s.grip);
      const [c0, c1, c2] = drone.flash.corners.map((c4) => project(m, c4, new THREE.Vector3()));
      s.planeA.setFromCoplanarPoints(c0, c1, c2);
      const centre: V4 = [0, 0, 0, 0]; centre[drone.held] = drone.sign;
      if (s.planeA.distanceToPoint(project(m, centre, new THREE.Vector3())) < 0) s.planeA.negate();
      s.planeB.copy(s.planeA).negate();
    } else {
      s.q2.g.visible = false;
      s.planeA.set(tmp.up, 1e4); s.planeB.set(tmp.up, 1e4);
    }

    // the piece: emerging, there, or going; it turns slowly, and shrinks into the device as it is taken
    s.wait += dt;
    target.scale += ((target.up ? 1 : 0) - target.scale) * Math.min(1, dt * (target.up ? 4 : 10));
    s.piece.visible = target.scale > 0.02;
    if (s.piece.visible) {
      project(m, target.up ? target.p : mix4(target.p, s.p, 1 - target.scale), s.piece.position);
      s.piece.scale.setScalar(target.scale);
      s.piece.rotation.y += dt * 0.8; s.piece.rotation.z = 0.5;
    }
    blink(now);

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
