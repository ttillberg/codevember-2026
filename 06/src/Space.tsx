import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  MeshPhysicalMaterial,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  Vector3,
} from 'three';
import { clock } from './clock';
import { elementsAt, jdFromDate, position, type Elements } from './kepler';
import { PLANETS } from './planets';
import { planetAt, toOrrery } from './scale';
import { planetPositions } from './world';

// The rest of the solar system's furniture, on real Kepler orbits like the planets, in the same compressed scale:
// the main asteroid belt as sprinkles, Jupiter's Trojans, and Halley's comet.
const ORBIT_Y = 12.6; // the orbits' plane, the glass ball's middle, where the planets ride
const J2000 = 2451545;
const DAY = 0.9856076686; // a 1 au orbit's mean motion, degrees per day; scales as a^-1.5

// Small seeded random, so the belt is the same every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const r = rng(11);
const between = (lo: number, hi: number) => lo + (hi - lo) * r();
const rayleigh = (sigma: number) => sigma * Math.sqrt(-2 * Math.log(1 - r() * 0.999)); // small inclinations, eccentricities

// One small body: its orbital elements at J2000 and its mean motion. Angles in degrees, as in kepler.ts.
type Body = { el: Elements; L0: number; n: number };

// The main belt, 2.1 to 3.3 au. Asteroids avoid the Kirkwood gaps, where an orbit would beat in step with Jupiter's
// (4:1, 3:1, 5:2, 7:3, 2:1) and get pumped out; sampling around them leaves the gaps empty.
const GAPS = [
  [2.065, 0.03],
  [2.502, 0.03],
  [2.825, 0.025],
  [2.958, 0.02],
  [3.279, 0.04],
];
function beltBody(): Body {
  let a = 0;
  do a = between(2.1, 3.3);
  while (GAPS.some(([g, w]) => Math.abs(a - g) < w));
  const w = between(0, 360);
  const L0 = w + between(0, 360);
  return { el: { a, e: Math.min(rayleigh(0.08), 0.3), I: rayleigh(7), L: L0, w, O: between(0, 360) }, L0, n: DAY / a ** 1.5 };
}

// Trojans share Jupiter's orbit, clustered 60° ahead (L4) and behind (L5), swinging about those points by up to ~20°.
// They are given Jupiter's mean motion so they keep pace with it.
const JUPITER = PLANETS.find((p) => p.name === 'Jupiter')!;
const jupiterL0 = elementsAt(JUPITER.el, JUPITER.rate, J2000).L;
const jupiterN = JUPITER.rate.L / 36525; // degrees per day
function trojanBody(lead: number): Body {
  const a = JUPITER.el.a + (r() - 0.5) * 0.1;
  const w = between(0, 360);
  const L0 = jupiterL0 + lead + (r() - 0.5) * 40;
  return { el: { a, e: between(0, 0.12), I: rayleigh(10), L: L0, w, O: between(0, 360) }, L0, n: jupiterN };
}

const BELT = 2500;
const TROJANS = 300; // per cloud
const BODIES: Body[] = [
  ...Array.from({ length: BELT }, beltBody),
  ...Array.from({ length: TROJANS }, () => trojanBody(60)),
  ...Array.from({ length: TROJANS }, () => trojanBody(-60)),
];

// Rainbow sprinkles.
const SPRINKLES = ['#ff5c8a', '#ffd23a', '#4fb3ff', '#5fd36a', '#ff8a2a', '#ffffff', '#a77bff'];

// Playful flight: each sprinkle points along its orbit and is followed by a trail of smaller copies of itself, where
// it was a few days before, so the belt seems to stream round. Each one also bobs up and down at its own pace, the
// bob rippling back down its trail like a wave.
const STEPS = 5; // the sprinkle and its trail
const LAG = 7; // days between one copy and the next
const BOB = 0.35; // how far up and down
const BOB_RATE = 2.2; // rad/s

const v = new Vector3(), prev = new Vector3(), dir = new Vector3(), m = new Matrix4(), sc = new Vector3(), q = new Quaternion();
const AXIS = new Vector3(0, 1, 0); // the capsule's length

function Rubble() {
  const ref = useRef<InstancedMesh>(null!);
  const geometry = useMemo(() => new CapsuleGeometry(0.07, 0.32, 3, 8), []);
  const phases = useMemo(() => BODIES.map(() => r() * Math.PI * 2), []);
  useLayoutEffect(() => {
    const c = new Color();
    BODIES.forEach((_, i) => {
      c.set(SPRINKLES[i % SPRINKLES.length]);
      for (let k = 0; k < STEPS; k++) ref.current.setColorAt(i * STEPS + k, c);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);
  useFrame(({ clock: t }) => {
    const days = clock.jd - J2000;
    const now = t.elapsedTime;
    BODIES.forEach((b, i) => {
      for (let k = 0; k < STEPS; k++) {
        // Where it was k steps ago, and a moment before that, for the direction of flight.
        b.el.L = b.L0 + b.n * (days - k * LAG);
        toOrrery(position(b.el, v));
        b.el.L -= b.n;
        toOrrery(position(b.el, prev));
        dir.subVectors(v, prev).normalize();
        v.y += ORBIT_Y + Math.sin(now * BOB_RATE + phases[i] - k * 0.6) * BOB;
        q.setFromUnitVectors(AXIS, dir);
        const size = 1 - k / STEPS;
        ref.current.setMatrixAt(i * STEPS + k, m.compose(v, q, sc.set(size, size * (k ? 1.4 : 1), size)));
      }
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, BODIES.length * STEPS]} receiveShadow frustumCulled={false}>
      <meshPhysicalMaterial roughness={0.45} clearcoat={0.6} />
    </instancedMesh>
  );
}

// Halley's comet, 1P/Halley: a = 17.83 au, e = 0.967, i = 162° (it goes round backwards), perihelion 1986 Feb 9.
// Longitudes as kepler.ts wants them: perihelion at Ω + ω, mean longitude at J2000 from the time since perihelion.
const HALLEY_N = DAY / 17.834 ** 1.5;
const HALLEY_W = 58.42 + 111.33;
const HALLEY: Elements = { a: 17.834, e: 0.96714, I: 162.26, L: 0, w: HALLEY_W, O: 58.42 };
const HALLEY_L0 = HALLEY_W + HALLEY_N * (J2000 - 2446467.4);
const NEXT_PERIHELION = jdFromDate(new Date(Date.UTC(2061, 6, 28)));

// Icy blue sugar dust streaming off the comet, always away from the sun, longer the closer it gets to it.
const TAIL = 600;
const SUN = new Vector3(0, ORBIT_Y, 0);

function Comet() {
  const nucleus = useRef<Mesh>(null!);
  const tail = useRef<Points>(null!);
  const { geometry, seeds } = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TAIL * 3), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(TAIL * 3), 3));
    // Each grain: where it is along the tail (0 at the head), how fast it drifts out, and a sideways spread.
    const seeds = Array.from({ length: TAIL }, () => ({
      u: r(),
      speed: 0.25 + r() * 0.5,
      spread: new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(2),
    }));
    return { geometry: g, seeds };
  }, []);

  // H jumps to a little before Halley's next perihelion, in 2061, to watch it swing past.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') clock.jd = NEXT_PERIHELION - 220;
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const away = useMemo(() => new Vector3(), []);
  const head = useMemo(() => new Vector3(), []);
  const ice = useMemo(() => new Color('#5fb4ff'), []);
  useFrame((_, dt) => {
    HALLEY.L = HALLEY_L0 + HALLEY_N * (clock.jd - J2000);
    position(HALLEY, head);
    const au = head.length();
    toOrrery(head).y += ORBIT_Y;
    nucleus.current.position.copy(head);
    nucleus.current.rotation.y += dt * 0.6;
    away.subVectors(head, SUN).normalize();
    // Tail length in scene units: nothing far out, growing as it nears the sun (sublimation, roughly 1/r²).
    const length = Math.min(14, 30 / (au * au));
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const col = geometry.getAttribute('color') as BufferAttribute;
    seeds.forEach((g, i) => {
      g.u = (g.u + dt * g.speed) % 1;
      const d = g.u * length;
      pos.setXYZ(
        i,
        head.x + away.x * d + g.spread.x * g.u * length * 0.08,
        head.y + away.y * d + g.spread.y * g.u * length * 0.08,
        head.z + away.z * d + g.spread.z * g.u * length * 0.08,
      );
      const fade = 1 - g.u; // fades towards the end of the tail, darkened to vanish against the light background
      col.setXYZ(i, ice.r * fade + (1 - fade) * 0.93, ice.g * fade + (1 - fade) * 0.93, ice.b * fade + (1 - fade) * 0.93);
    });
    pos.needsUpdate = col.needsUpdate = true;
    tail.current.visible = length > 0.3;
  });

  return (
    <>
      {/* The nucleus: a lump of rock candy. */}
      <mesh ref={nucleus} castShadow>
        <icosahedronGeometry args={[0.55, 0]} />
        <meshPhysicalMaterial color="#e8f4ff" roughness={0.15} clearcoat={1} flatShading />
      </mesh>
      <points ref={tail} geometry={geometry} frustumCulled={false}>
        <pointsMaterial size={0.55} vertexColors transparent opacity={0.95} depthWrite={false} />
      </points>
    </>
  );
}

// A leader and a line of followers playing round the sun like dolphins: the leader loops quickly round the
// lollipop the way the planets go, leaping up and diving down and swinging in and out; each of the others chases
// where the one in front of it was a moment ago, swaying a little from side to side, so the line ripples along
// behind. The leader knows where each planet will be by the time it gets there, from its orbit, and steers clear of
// that; and when it comes alongside one going about its own speed, it stops to play, looping round it two or three
// times before going on, the line in tow. Each leaves a short wake. Runs on real time, so they keep playing when the
// clock is paused.
const FOLLOWERS = 14;
const POD = FOLLOWERS + 1; // the leader first
const BEHIND = 4; // frames: how far back along the one in front each follower aims, its spacing in the line
const WAKE = 4; // the sprinkle and its wake
const WAKE_GAP = 3; // frames between wake copies
const HISTORY = Math.max(WAKE * WAKE_GAP, BEHIND) + 2;
const CENTRE = new Vector3(0, ORBIT_Y, 0);
const FAST = 14, SLOW = 4; // speed limits, scene units per second

// Translucent sugar: see-through, glowing a little in its own colour, more at the thin edges, and no shadows, so the
// pod reads as light and quick rather than solid.
function jelly() {
  const m = new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.8, transparent: true, opacity: 0.6, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
  float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * (0.35 + 0.8 * edge);`,
    );
  };
  return m;
}

function Pod() {
  const ref = useRef<InstancedMesh>(null!);
  const geometry = useMemo(() => new CapsuleGeometry(0.1, 0.42, 3, 8), []);
  const material = useMemo(jelly, []);
  const state = useMemo(() => {
    const fish = Array.from({ length: POD }, (_, i) => {
      const p = new Vector3(9, ORBIT_Y, i * 0.8);
      return { p, v: new Vector3(0, 0, -8), trail: Array.from({ length: HISTORY }, () => p.clone()), sway: r() * Math.PI * 2 };
    });
    return {
      fish,
      angle: 0,
      time: 0,
      head: 0,
      target: new Vector3(),
      // Playing round a planet: which one, how far round the loop, how much is left, and a rest before the next.
      play: null as string | null,
      loop: 0,
      left: 0,
      rest: 0,
    };
  }, []);

  useLayoutEffect(() => {
    const c = new Color();
    for (let i = 0; i < POD; i++) {
      c.set(SPRINKLES[i % SPRINKLES.length]);
      for (let k = 0; k < WAKE; k++) ref.current.setColorAt(i * WAKE + k, c);
    }
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);

  const aim = useMemo(() => new Vector3(), []), d = useMemo(() => new Vector3(), []);
  const side = useMemo(() => new Vector3(), []), up = useMemo(() => new Vector3(0, 1, 0), []);
  const ahead = useMemo(() => new Vector3(), []), there = useMemo(() => new Vector3(), []);
  const pv = useMemo(() => new Vector3(), []), a = useMemo(() => new Vector3(), []), b = useMemo(() => new Vector3(), []);
  // A planet's velocity in the scene, units per second at the current clock speed.
  const velocityOf = (p: (typeof PLANETS)[number], out: Vector3) =>
    out.subVectors(planetAt(p, clock.jd + 0.5, a), planetAt(p, clock.jd - 0.5, b)).multiplyScalar(clock.paused ? 0 : clock.speed);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30), S = state;
    S.time += dt;
    // The leader's path: round the lollipop, quick, leaping and swinging in and out.
    S.angle += dt * 0.9;
    const radius = 9 + 3.5 * Math.sin(S.time * 0.53);
    S.target.set(
      radius * Math.cos(S.angle),
      ORBIT_Y + 3.5 * Math.sin(S.time * 1.7) + 1.5 * Math.sin(S.time * 0.9),
      -radius * Math.sin(S.angle),
    );
    S.rest = Math.max(0, S.rest - dt);
    if (import.meta.env.DEV) (window as any).__pod = S; // dev: what the leader is up to
    S.fish.forEach((f, i) => {
      if (i === 0) {
        const lead = S.fish[0];
        const playing = S.play && PLANETS.find((p) => p.name === S.play);
        const at = playing && planetPositions.get(playing.name);
        if (playing && at) {
          // Loop the loop round the planet, in the plane of its motion and up: a dolphin round a boat. Aim a touch
          // ahead of where it's going, so the loops keep up with it.
          velocityOf(playing, pv);
          S.loop += dt * 4.5;
          side.copy(pv).normalize();
          aim.copy(at).addScaledVector(pv, 0.12).addScaledVector(side, Math.cos(S.loop) * 3.8).addScaledVector(up, Math.sin(S.loop) * 3.8);
          if (S.loop > S.left) {
            S.play = null;
            S.rest = 10;
          }
        } else {
          aim.copy(S.target);
          for (const p of PLANETS) {
            const now = planetPositions.get(p.name);
            if (!now) continue;
            // Close by and going about as fast, the same way: stop and play round it for two or three loops.
            velocityOf(p, pv);
            if (S.rest === 0 && lead.p.distanceTo(now) < 7 && pv.distanceTo(lead.v) < 4.5) {
              S.play = p.name;
              S.loop = 0;
              S.left = Math.PI * 2 * (2 + Math.floor(r() * 2));
            }
            // Otherwise look ahead: where will it be by the time we get there? Steer clear of that.
            const t = Math.min(lead.p.distanceTo(now) / Math.max(lead.v.length(), 1), 1.5);
            there.copy(planetAt(p, clock.jd + t * (clock.paused ? 0 : clock.speed), a)).setY(a.y + ORBIT_Y);
            ahead.copy(lead.p).addScaledVector(lead.v, t);
            d.subVectors(ahead, there);
            const miss = d.length();
            if (miss < 5.5) aim.addScaledVector(d.normalize(), (5.5 - miss) * 3);
          }
        }
      } else {
        // Where the one in front was a moment ago, nudged to one side and the other.
        const ahead = S.fish[i - 1];
        aim.copy(ahead.trail[(S.head - BEHIND + HISTORY * 2) % HISTORY]);
        side.crossVectors(ahead.v, up).normalize();
        aim.addScaledVector(side, Math.sin(S.time * 3 + f.sway) * 0.6);
      }
      // Steer: a velocity towards the aim, eased in.
      const crisp = i > 0 || S.play; // the leader turns tighter while it plays
      d.subVectors(aim, f.p).multiplyScalar(crisp ? 14 : 2.5);
      f.v.lerp(d, Math.min(1, dt * (crisp ? 14 : 2)));
      // Last ditch swerve, if anyone gets right up against a planet, and stay clear of the lollipop and the glass.
      for (const q of planetPositions.values()) {
        d.subVectors(f.p, q);
        const dist = d.length();
        if (dist < 2.6) f.v.addScaledVector(d.normalize(), (2.6 - dist) * 60 * dt);
      }
      d.subVectors(f.p, CENTRE);
      const fromSun = d.length();
      if (fromSun < 6) f.v.addScaledVector(d.normalize(), (6 - fromSun) * 50 * dt);
      if (fromSun > 24) f.v.addScaledVector(d.normalize(), (24 - fromSun) * 20 * dt);
      const speed = f.v.length() || 1;
      // Followers may go a little faster than the leader, so they can catch up and keep the line tight.
      f.v.multiplyScalar(Math.min(Math.max(speed, SLOW), i === 0 ? FAST : FAST * 1.4) / speed);
      f.p.addScaledVector(f.v, dt);
    });
    // Record the paths and draw each sprinkle with its wake, pointing along the way it's going; the leader a bit bigger.
    S.head = (S.head + 1) % HISTORY;
    S.fish.forEach((f, i) => {
      f.trail[S.head].copy(f.p);
      const big = i === 0 ? 1.5 : 1;
      for (let k = 0; k < WAKE; k++) {
        const at = f.trail[(S.head - k * WAKE_GAP + HISTORY * 2) % HISTORY];
        const before = f.trail[(S.head - k * WAKE_GAP - 1 + HISTORY * 2) % HISTORY];
        dir.subVectors(at, before);
        if (dir.lengthSq() < 1e-8) dir.copy(f.v);
        q.setFromUnitVectors(AXIS, dir.normalize());
        const size = (1 - k / WAKE) * big;
        ref.current.setMatrixAt(i * WAKE + k, m.compose(at, q, sc.set(size, size * (k ? 1.5 : 1), size)));
      }
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, POD * WAKE]} frustumCulled={false} />;
}

const SHOW_BELT = false; // the main belt and the Trojans, off while the pod plays

export function Space() {
  return (
    <>
      {SHOW_BELT && <Rubble />}
      <Pod />
      <Comet />
    </>
  );
}
