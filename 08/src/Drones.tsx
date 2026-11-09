import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { project, type V4 } from './tesseract';
import { pose } from './state';
import { ACCENTS } from './decals';

// LED drones that live in the tesseract. A drone is inside one of the eight cells, a cube with one coordinate held
// at ±1 and the other three free, and it can only leave through a square face into the neighbouring cell: fly to
// the face, hesitate at the threshold, get pulled through, and the coordinate that was held is free while another
// is held instead. Everything is a point in 4D seen through the same turn and perspective as the struts, so what
// looks like speed is partly the warp of the cell it is in. The trail is kept in 4D too, and turns with the rest.

const N = 5;
const TRAIL = 48;
const TRAIL_EVERY = 0.045; // seconds between trail samples
const SPEED = 0.55; // 4D units per second, cruising
const ROOM = 0.62; // how far from a cell's walls a waypoint stays, so drones keep clear of the struts
const BODY = 0.028, LED = 0.014;

type Phase = 'cruise' | 'approach' | 'hesitate' | 'enter';
type Drone = {
  held: number; sign: number; // the cell: coordinate held, and at which side
  came: [number, number] | null; // the face it came in through, not to go straight back out
  p: V4; from: V4; to: V4;
  t: number; dur: number; phase: Phase;
  hesitateLeft: number;
  trail: V4[]; trailAt: number;
  body: THREE.Mesh; led: THREE.Mesh; ledMat: THREE.MeshStandardMaterial; line: THREE.Line; color: THREE.Color;
  flicker: number;
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp4 = (a: V4, b: V4, t: number): V4 => [0, 1, 2, 3].map((i) => a[i] + (b[i] - a[i]) * t) as V4;
const dist4 = (a: V4, b: V4) => Math.hypot(...a.map((x, i) => x - b[i]));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t: number) => t * t * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** A point well inside the drone's cell. */
function roomIn(d: Drone): V4 {
  const v = [0, 1, 2, 3].map(() => rnd(-ROOM, ROOM)) as V4;
  v[d.held] = d.sign;
  return v;
}

/** Pick a face out of the cell, not the one it came through: the point on it to aim for. */
function nextFace(d: Drone): { axis: number; sign: number; at: V4 } {
  const choices: [number, number][] = [];
  for (const axis of [0, 1, 2, 3]) if (axis !== d.held) for (const sign of [-1, 1]) {
    if (d.came && d.came[0] === axis && d.came[1] === sign) continue;
    choices.push([axis, sign]);
  }
  const [axis, sign] = choices[Math.floor(Math.random() * choices.length)];
  const at = roomIn(d);
  at[axis] = sign;
  return { axis, sign, at };
}

function go(d: Drone, to: V4, phase: Phase, speed = SPEED) {
  d.from = d.p.slice() as V4;
  d.to = to;
  d.t = 0;
  d.dur = Math.max(0.2, dist4(d.from, d.to) / speed);
  d.phase = phase;
}

export function Drones() {
  const parts = useMemo(() => {
    const group = new THREE.Group();
    const sph = new THREE.SphereGeometry(1, 16, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.5, metalness: 0.2 });
    const drones: Drone[] = [];
    for (let i = 0; i < N; i++) {
      const color = new THREE.Color(ACCENTS[i % ACCENTS.length]);
      const ledMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.5, toneMapped: false });
      const body = new THREE.Mesh(sph, bodyMat);
      const led = new THREE.Mesh(sph, ledMat);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, toneMapped: false }));
      for (const o of [body, led, line]) { o.frustumCulled = false; group.add(o); }
      const held = Math.floor(Math.random() * 4), sign = Math.random() < 0.5 ? -1 : 1;
      const d: Drone = {
        held, sign, came: null,
        p: [0, 0, 0, 0], from: [0, 0, 0, 0], to: [0, 0, 0, 0], t: 0, dur: 1, phase: 'cruise', hesitateLeft: 0,
        trail: [], trailAt: 0, body, led, ledMat, line, color, flicker: 0,
      };
      d.p = roomIn(d);
      go(d, roomIn(d), 'cruise');
      drones.push(d);
    }
    return { group, drones };
  }, []);

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    const m = pose();
    const now = performance.now() / 1000;
    for (const d of parts.drones) {
      // move
      if (d.phase === 'hesitate') {
        d.hesitateLeft -= dt;
        // a nervous hover at the threshold
        d.p = d.to.map((x, i) => (i === d.held ? x : x + Math.sin(now * 23 + i * 1.7) * 0.012)) as V4;
        d.p[d.held] = d.sign;
        if (d.hesitateLeft <= 0) {
          // through: the face's axis is held now, the old one is free
          const face = d.to.slice() as V4;
          const axis = [0, 1, 2, 3].find((i) => i !== d.held && Math.abs(face[i]) > 0.999)!;
          d.came = [d.held, d.sign];
          d.held = axis; d.sign = Math.sign(face[axis]);
          d.p = face;
          d.p[d.held] = d.sign;
          const inside = roomIn(d);
          inside[d.came[0]] = d.came[1] * rnd(0.1, 0.5); // just inside the new cell, past the frame
          go(d, inside, 'enter', SPEED * 1.6);
        }
      } else {
        d.t += dt / d.dur;
        const t = Math.min(1, d.t);
        const u = d.phase === 'approach' ? easeOut(t) : d.phase === 'enter' ? easeIn(t) : smooth(t);
        d.p = lerp4(d.from, d.to, u);
        if (d.t >= 1) {
          if (d.phase === 'approach') { d.phase = 'hesitate'; d.hesitateLeft = rnd(0.35, 0.8); }
          else if (Math.random() < 0.45) go(d, roomIn(d), 'cruise');
          else { const f = nextFace(d); go(d, f.at, 'approach', SPEED * 0.8); }
        }
      }
      // trail, in 4D
      if (now - d.trailAt > TRAIL_EVERY) {
        d.trail.push(d.p.slice() as V4);
        if (d.trail.length > TRAIL) d.trail.shift();
        d.trailAt = now;
      }
      // draw
      project(m, d.p, tmp.v);
      d.body.position.copy(tmp.v);
      d.body.scale.setScalar(BODY);
      d.led.position.copy(tmp.v).addScaledVector(tmp.up, BODY * 0.9);
      d.led.scale.setScalar(LED);
      const on = d.phase === 'hesitate' ? (Math.sin(now * 40) > 0 ? 1 : 0.15) : (now * 2 + d.flicker) % 1 < 0.08 ? 0.2 : 1;
      d.ledMat.emissiveIntensity = 0.3 + 2.4 * on;
      const pos = d.line.geometry.attributes.position as THREE.BufferAttribute;
      d.trail.forEach((q, i) => { project(m, q, tmp.v); pos.setXYZ(i, tmp.v.x, tmp.v.y, tmp.v.z); });
      pos.needsUpdate = true;
      d.line.geometry.setDrawRange(0, d.trail.length);
    }
  });

  return <primitive object={parts.group} />;
}
