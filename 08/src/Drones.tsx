import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose } from './state';
import { drone, startCell, crossInto } from './drone';

// A quad drone that lives in the tesseract. It is inside one of the eight cells, a cube with one coordinate held at
// ±1 and the other three free, and it can only leave through a square face into the neighbouring cell. The passage is
// one smooth curve in 4D: it bends from the way it was flying to the way into the next cell, which in 4D is a right
// angle, slows to half speed in the face and picks up again, as if through a field. Everything is a point in 4D seen
// through the same turn and perspective as the struts, so what looks like speed is partly the warp of the cell it is
// in. The trail is kept in 4D too, and turns with the rest.

const TRAIL = 56;
const TRAIL_EVERY = 0.05; // seconds between trail samples
const SPEED = 0.5; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so the drone keeps clear of the struts
const SIZE = 0.075; // half the span across the rotors
const FIELD = 0.12; // half-width, in path fraction, of the slow zone round the face
const DIP = 0.55; // how much of the speed the field takes

type Leg = { kind: 'cruise' | 'portal'; pts: V4[]; len: number; face?: { axis: number; sign: number }; crossed: boolean };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const add4 = (a: V4, b: V4, k = 1): V4 => a.map((x, i) => x + b[i] * k) as V4;
const sub4 = (a: V4, b: V4): V4 => a.map((x, i) => x - b[i]) as V4;
const scale4 = (a: V4, k: number): V4 => a.map((x) => x * k) as V4;
const len4 = (a: V4) => Math.hypot(a[0], a[1], a[2], a[3]);
const unit4 = (a: V4): V4 => scale4(a, 1 / (len4(a) || 1));
const smooth = (t: number) => t * t * (3 - 2 * t);

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

const SAND = '#d9b985', DARK = '#1c1c1e', LED = '#c9e35b';

/** The quad: a sand body, four dark arms, four rotor discs, a lamp under the belly. Span 2 × size, facing -z. */
export function quad(size = SIZE) {
  const g = new THREE.Group();
  const sand = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5, metalness: 0.2 });
  const blur = new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.6, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.6), sand);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.16), dark);
  nose.position.set(0, 0, -0.36);
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16), dark);
  belly.position.y = -0.12;
  const rotors: THREE.Mesh[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 10), dark);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(z, x);
    arm.position.set(x * 0.36, 0.02, z * 0.36);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), dark);
    hub.position.set(x * 0.72, 0.06, z * 0.72);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 24), blur);
    rotor.position.set(x * 0.72, 0.13, z * 0.72);
    rotors.push(rotor);
    g.add(arm, hub, rotor);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: LED, emissive: LED, emissiveIntensity: 2.5, toneMapped: false });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lampMat);
  lamp.position.y = -0.2;
  g.add(body, nose, belly, lamp);
  g.scale.setScalar(size / 1.02);
  return { g, rotors, lampMat };
}

export function Drones() {
  const d = useMemo(() => {
    const group = new THREE.Group();
    const q = quad();
    group.add(q.g);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: LED, transparent: true, opacity: 0.7, toneMapped: false }));
    line.frustumCulled = false;
    group.add(line);
    const held = Math.floor(Math.random() * 4), sign = Math.random() < 0.5 ? -1 : 1;
    const s = {
      group, q, line,
      held, sign, came: null as [number, number] | null,
      p: [0, 0, 0, 0] as V4, dir: [0, 0, 0, 0] as V4, // where it is, which way it is going, in 4D
      leg: null as Leg | null, s: 0,
      trail: [] as V4[], trailAt: 0,
      last: new THREE.Vector3(), vel: new THREE.Vector3(), heading: new THREE.Quaternion(), spin: 0,
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
    const c0 = add4(s.p, s.dir, L * 0.35);
    const mid = add4(scale4(add4(s.p, to), 0.5), [rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15), rnd(-0.15, 0.15)]);
    mid[s.held] = s.sign;
    const c1 = add4(mid, sub4(c0, s.p), -0.3);
    const c2 = add4(mid, sub4(to, mid), 0.3);
    const c3 = add4(to, sub4(to, mid), -0.2);
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
    // the tangent in the face: half the way out, half the way in, the right angle rounded
    const out: V4 = [0, 0, 0, 0]; out[axis] = sign;
    const inward: V4 = [0, 0, 0, 0]; inward[s.held] = -s.sign;
    const tan = unit4(add4(out, inward));
    const L0 = len4(sub4(face, s.p)), L1 = len4(sub4(beyond, face));
    const pts = [
      s.p, add4(s.p, s.dir, L0 * 0.35), add4(face, tan, -L0 * 0.4), face,
      add4(face, tan, L1 * 0.4), add4(beyond, sub4(beyond, face), -0.25), beyond,
    ];
    return { kind: 'portal', pts, len: pathLen(pts), face: { axis, sign }, crossed: false };
  }

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = pose();
    const now = performance.now() / 1000;
    const s = d;

    // move, in 4D, along the leg; the field round a face slows it
    if (!s.leg) { s.leg = Math.random() < 0.5 ? cruiseLeg(s) : portalLeg(s); s.s = 0; }
    const leg = s.leg;
    const field = leg.kind === 'portal' ? DIP * Math.exp(-(((s.s - 0.5) / FIELD) ** 2)) : 0;
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
    }
    if (s.s >= 1) { s.p[s.held] = s.sign; s.leg = null; }

    drone.p = s.p;
    if (now - s.trailAt > TRAIL_EVERY) {
      s.trail.push(s.p.slice() as V4);
      if (s.trail.length > TRAIL) s.trail.shift();
      s.trailAt = now;
    }

    // draw: where it is in 3D, which way it is going there, a lean into the move
    const { v, up, q, tilt, axis } = tmp;
    project(m, s.p, v);
    s.vel.subVectors(v, s.last).divideScalar(Math.max(dt, 1e-3));
    s.last.copy(v);
    s.q.g.position.copy(v);
    const speed = s.vel.length();
    if (speed > 0.05) {
      tmp.m.lookAt(new THREE.Vector3(), s.vel.clone().negate(), up); // the quad's nose is -z
      q.setFromRotationMatrix(tmp.m);
      axis.crossVectors(up, s.vel).normalize();
      tilt.setFromAxisAngle(axis, Math.min(0.5, speed * 0.35)); // lean forward, more the faster
      q.premultiply(tilt);
      s.heading.slerp(q, Math.min(1, dt * 6));
    }
    s.q.g.quaternion.copy(s.heading);
    s.spin += dt * (40 + speed * 30);
    s.q.rotors.forEach((r, i) => { r.rotation.y = s.spin * (i % 2 ? 1 : -1); });
    s.q.lampMat.emissiveIntensity = 2.5 + 3 * field * (0.5 + 0.5 * Math.sin(now * 9)); // brighter, breathing, in the field

    const pos = s.line.geometry.attributes.position as THREE.BufferAttribute;
    s.trail.forEach((p4, i) => { project(m, p4, v); pos.setXYZ(i, v.x, v.y, v.z); });
    pos.needsUpdate = true;
    s.line.geometry.setDrawRange(0, s.trail.length);
  });

  return <primitive object={d.group} />;
}
