import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { bodies, clock, radii, tilts } from './clock';
import { elementsAt, planetRadius, position, type Scale } from './kepler';
import { deckHeight, isFine, MAX_TILT, place, ringPath } from './layout';
import { hash, Marble } from './Marble';
import type { Planet as P } from './planets';
import { planeNormal, Rail } from './Rail';

const UP = new Vector3(0, 1, 0);
const K = 0.01720209895; // Gaussian gravitational constant, au^1.5 / day
// Fastest angular speed in the system, Mercury at perihelion (rad/day); the tilt is measured against it.
const OMEGA_REF = (K * Math.sqrt(0.387 * (1 - 0.2056 ** 2))) / 0.3075 ** 2;
export const TILT_EXP = 1 / 3; // < 1 so the slow outer rings still visibly tilt

// Angular speed along the orbit right now, from Kepler's second law: h / r^2, h = k sqrt(a (1 - e^2)).
const omega = (a: number, e: number, rAu: number) => (K * Math.sqrt(a * (1 - e * e))) / (rAu * rAu);

// A marble rolling on its rail. Its place on the orbit comes from Kepler, nothing else. The ring is then turned so
// that exactly that point is its lowest: a convex plane curve is lowest at the point whose outward normal points
// downhill, so the ring's plane normal goes to a plane tilted by alpha and the outward normal at the marble goes to
// that plane's downhill direction. Alpha follows the planet's angular speed at that point (steeper at perihelion,
// steeper for inner planets), so the tilt is a function of position only, the same paused or running. The chains
// read their heights off this rotation. Each ring sits on its own deck (see layout.ts).
export function Planet({ p, mode }: { p: P; mode: Scale }) {
  const tiltRef = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const roll = useRef<Group>(null!);
  const r = planetRadius(p, mode);
  radii.set(p.name, r);

  const path = ringPath(p, mode);
  const normal = useMemo(() => planeNormal(path), [path]);
  const deck = deckHeight(p.name, mode);

  const s = useMemo(
    () => ({ pos: new Vector3(), prev: new Vector3(), d: new Vector3(), axis: new Vector3(), helio: new Vector3(),
      a: new Vector3(), b: new Vector3(), t: new Vector3(), out: new Vector3(), u: new Vector3(), dn: new Vector3(),
      n: new Vector3(), c: new Vector3(), b1: new Matrix4(), b2: new Matrix4(), q: new Quaternion(), first: true }),
    [],
  );
  if (!bodies.has(p.name)) bodies.set(p.name, new Vector3());
  if (!tilts.has(p.name)) tilts.set(p.name, new Quaternion());

  useFrame(() => {
    const el = elementsAt(p.el, p.rate, clock.jd);
    position(el, s.helio);
    const rAu = s.helio.length();
    place(s.pos.copy(s.helio), mode);
    body.current.position.copy(s.pos);

    // Roll: rotate about (plane normal x motion) by distance / radius. Skip jumps (mode switch, "now").
    s.d.subVectors(s.pos, s.prev);
    const dist = s.d.length();
    if (!s.first && dist > 1e-6 && dist < r * 4) {
      s.axis.crossVectors(normal, s.d).normalize();
      s.q.setFromAxisAngle(s.axis, dist / r);
      roll.current.quaternion.premultiply(s.q);
    }
    s.prev.copy(s.pos);
    s.first = false;

    // Tangent at the marble, from the orbit a few hours either side; outward normal in the ring's plane.
    place(position(elementsAt(p.el, p.rate, clock.jd + 0.2), s.a), mode);
    place(position(elementsAt(p.el, p.rate, clock.jd - 0.2), s.b), mode);
    s.t.subVectors(s.a, s.b).normalize();
    s.out.crossVectors(s.t, normal).normalize();

    // Target plane: tilted by alpha, downhill towards the marble's outward normal (seen from above).
    const alpha = MAX_TILT * Math.min(1, Math.pow(omega(el.a, el.e, rAu) / OMEGA_REF, TILT_EXP));
    s.u.set(s.out.x, 0, s.out.z).normalize();
    s.n.copy(UP).multiplyScalar(Math.cos(alpha)).addScaledVector(s.u, Math.sin(alpha));
    s.dn.copy(s.u).multiplyScalar(Math.cos(alpha)).addScaledVector(UP, -Math.sin(alpha));

    // Rotation taking (out, normal) to (downhill, tilted normal): two orthonormal frames, R = B2 * B1^T.
    s.b1.makeBasis(s.out, normal, s.c.crossVectors(s.out, normal));
    s.b2.makeBasis(s.dn, s.n, s.c.crossVectors(s.dn, s.n));
    s.b2.multiply(s.b1.transpose());
    tiltRef.current.quaternion.setFromRotationMatrix(s.b2);
    tilts.get(p.name)!.copy(tiltRef.current.quaternion);
    const world = bodies.get(p.name)!.copy(s.pos).applyQuaternion(tiltRef.current.quaternion);
    world.y += deck;
  });

  return (
    <group position-y={deck}>
      <group ref={tiltRef}>
        <Rail path={path} r={r} fine={isFine(p.name)} />
        <group ref={body}>
          <group ref={roll} scale={r}>
            <Marble colors={p.vanes} tint={p.tint} seed={hash(p.name)} ring={p.ring ? p.tilt : undefined} />
          </group>
        </group>
      </group>
    </group>
  );
}
