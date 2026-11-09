import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose } from './state';
import { drone, startCell, crossInto } from './drone';

// A quad drone that lives in the tesseract. It is inside one of the eight cells, a cube with one coordinate held at
// ±1 and the other three free, and it can only leave through a square face into the neighbouring cell: fly to the
// face slowing down, a beat on the threshold, then pulled through, and the coordinate that was held is free while
// another is held instead. Everything is a point in 4D seen through the same turn and perspective as the struts, so
// what looks like speed is partly the warp of the cell it is in. The trail is kept in 4D too, and turns with the rest.

const TRAIL = 56;
const TRAIL_EVERY = 0.05; // seconds between trail samples
const SPEED = 0.5; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so the drone keeps clear of the struts
const SIZE = 0.075; // half the span across the rotors

type Phase = 'cruise' | 'approach' | 'pause' | 'enter';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp4 = (a: V4, b: V4, t: number): V4 => [0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * t) as V4;
const dist4 = (a: V4, b: V4) => Math.hypot(...a.map((x, i) => x - b[i]));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t: number) => t * t * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

const SAND = '#d9b985', DARK = '#1c1c1e', LED = '#c9e35b';

/** The quad: a sand body, four dark arms, four rotor discs, a lamp under the belly. Span 2 × SIZE, facing -z. */
function quad() {
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
  g.scale.setScalar(SIZE / 1.02);
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
      p: [0, 0, 0, 0] as V4, from: [0, 0, 0, 0] as V4, to: [0, 0, 0, 0] as V4, t: 0, dur: 1, phase: 'cruise' as Phase, pauseLeft: 0,
      trail: [] as V4[], trailAt: 0,
      last: new THREE.Vector3(), vel: new THREE.Vector3(), heading: new THREE.Quaternion(), spin: 0,
    };
    s.p = roomIn(s);
    go(s, roomIn(s), 'cruise');
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
  /** A face out of the cell, not the one it came through: the point on it to aim for. */
  function nextFace(s: S): V4 {
    const choices: [number, number][] = [];
    for (const axis of [0, 1, 2, 3]) if (axis !== s.held) for (const sign of [-1, 1]) {
      if (s.came && s.came[0] === axis && s.came[1] === sign) continue;
      choices.push([axis, sign]);
    }
    const [axis, sign] = choices[Math.floor(Math.random() * choices.length)];
    const at = roomIn(s);
    at[axis] = sign;
    return at;
  }
  function go(s: S, to: V4, phase: Phase, speed = SPEED) {
    s.from = s.p.slice() as V4;
    s.to = to;
    s.t = 0;
    s.dur = Math.max(0.25, dist4(s.from, s.to) / speed);
    s.phase = phase;
  }

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), m: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = pose();
    const now = performance.now() / 1000;
    const s = d;

    // move, in 4D
    if (s.phase === 'pause') {
      s.pauseLeft -= dt;
      if (s.pauseLeft <= 0) {
        // through: the face's axis is held now, the old one is free
        const face = s.to.slice() as V4;
        const axis = [0, 1, 2, 3].find((i) => i !== s.held && Math.abs(face[i]) > 0.999)!;
        s.came = [s.held, s.sign];
        crossInto(axis, Math.sign(face[axis]));
        s.held = axis; s.sign = Math.sign(face[axis]);
        s.p = face; s.p[s.held] = s.sign;
        const inside = roomIn(s);
        inside[s.came[0]] = s.came[1] * rnd(0.1, 0.5); // just inside the new cell, past the frame
        go(s, inside, 'enter', SPEED * 1.5);
      }
    } else {
      s.t += dt / s.dur;
      const t = Math.min(1, s.t);
      const u = s.phase === 'approach' ? easeOut(t) : s.phase === 'enter' ? easeIn(t) : smooth(t);
      s.p = lerp4(s.from, s.to, u);
      if (s.t >= 1) {
        if (s.phase === 'approach') { s.phase = 'pause'; s.pauseLeft = rnd(0.3, 0.6); }
        else if (Math.random() < 0.45) go(s, roomIn(s), 'cruise');
        else go(s, nextFace(s), 'approach', SPEED * 0.8);
      }
    }
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
    s.q.lampMat.emissiveIntensity = s.phase === 'pause' ? 0.8 + 2 * (0.5 + 0.5 * Math.sin(now * 6)) : 2.5;

    const pos = s.line.geometry.attributes.position as THREE.BufferAttribute;
    s.trail.forEach((p4, i) => { project(m, p4, v); pos.setXYZ(i, v.x, v.y, v.z); });
    pos.needsUpdate = true;
    s.line.geometry.setDrawRange(0, s.trail.length);
  });

  return <primitive object={d.group} />;
}
