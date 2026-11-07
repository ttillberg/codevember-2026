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
  Quaternion,
  Vector3,
} from 'three';
import { clock, daysPerSecond, FULL_SPEED, motion } from './clock';
import { elementsAt, J2000, jdFromDate, position, type Elements } from './kepler';
import { PLANETS } from './planets';
import { ORBIT_Y, planetAt, SUN, toOrrery } from './scale';
import { planetPositions } from './world';
import { pickedNow } from './selection';
import { rng } from './random';

// The rest of the solar system's furniture, on real Kepler orbits like the planets, in the same compressed scale:
// the main asteroid belt as sprinkles, Jupiter's Trojans, and Halley's comet (a gummy worm).
const DAY = 0.9856076686; // a 1 au orbit's mean motion, degrees per day; scales as a^-1.5

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
const spot = new Vector3(), tumble = new Quaternion();
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

// Halley's comet is a gummy worm, worming its way round the solar system on Halley's orbit: its head where the comet
// is, its body trailing back along the way it came, a wriggle running down it from head to tail. A ridged tube,
// rounded at both ends, red at the head fading to orange, glossy see-through gum glowing a little of its own colour.
const WORM_LENGTH = 3.4;
const WORM_RADIUS = 0.17;
const SPINE = 120; // rings along the body, a few to each ridge
const RIM = 28; // points round each ring
const RIDGES = 22; // the little ridges round a gummy worm
const WORM_HEAD = new Color('#e3142a'), WORM_TAIL = new Color('#ff9a1c');

function Comet() {
  const worm = useRef<Mesh>(null!);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    // Every ring's points, then one at each tip to close it off round.
    const count = SPINE * RIM + 2;
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    const colours = new Float32Array(count * 3), c = new Color();
    for (let i = 0; i < SPINE; i++) {
      // Red at the head, through to orange most of the way down, a soft blend between.
      const t = i / (SPINE - 1);
      c.copy(WORM_HEAD).lerp(WORM_TAIL, Math.min(1, Math.max(0, (t - 0.25) / 0.45)));
      for (let j = 0; j < RIM; j++) colours.set([c.r, c.g, c.b], (i * RIM + j) * 3);
    }
    colours.set([WORM_HEAD.r, WORM_HEAD.g, WORM_HEAD.b], SPINE * RIM * 3);
    colours.set([WORM_TAIL.r, WORM_TAIL.g, WORM_TAIL.b], (SPINE * RIM + 1) * 3);
    g.setAttribute('color', new BufferAttribute(colours, 3));
    const index: number[] = [];
    const tip = SPINE * RIM, last = (SPINE - 1) * RIM;
    for (let j = 0; j < RIM; j++) {
      const k = (j + 1) % RIM;
      index.push(tip, j, k); // the head's tip
      index.push(last + j, tip + 1, last + k); // the tail's
    }
    for (let i = 0; i < SPINE - 1; i++)
      for (let j = 0; j < RIM; j++) {
        const a = i * RIM + j, b = i * RIM + ((j + 1) % RIM), c2 = a + RIM, d = b + RIM;
        index.push(a, c2, b, b, c2, d);
      }
    g.setIndex(index);
    return g;
  }, []);
  const material = useMemo(() => {
    const m = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.15, transmission: 0.25, thickness: WORM_RADIUS * 2 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        // Gum lets light in: a glow of its own colour, stronger at the thin edges.
        /* glsl */ `#include <emissivemap_fragment>
  float edge = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += diffuseColor.rgb * (0.3 + 0.4 * edge * edge);`,
      );
    };
    return m;
  }, []);

  // H jumps to a little before Halley's next perihelion, in 2061, to watch it swing past.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') clock.jd = NEXT_PERIHELION - 220;
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const s = useMemo(
    () => ({
      head: new Vector3(), ahead: new Vector3(), dir: new Vector3(1, 0, 0), side: new Vector3(), up: new Vector3(),
      spine: Array.from({ length: SPINE }, () => new Vector3()), t: new Vector3(), n: new Vector3(), b: new Vector3(),
      time: 0,
    }),
    [],
  );
  const where = (jd: number, out: Vector3) => {
    HALLEY.L = HALLEY_L0 + HALLEY_N * (jd - J2000);
    toOrrery(position(HALLEY, out)).y += ORBIT_Y;
    return out;
  };
  useFrame((_, dt) => {
    s.time += dt * motion(); // the wriggle stops with the clock
    where(clock.jd, s.head);
    // Which way it's going along the orbit: a little way ahead in time, far enough to see it move.
    where(clock.jd + 30, s.ahead).sub(s.head);
    if (s.ahead.lengthSq() > 1e-8) s.dir.copy(s.ahead).normalize();
    s.side.crossVectors(s.dir, UP).normalize();
    s.up.crossVectors(s.side, s.dir);
    // The spine: back from the head along the way it came, a wave travelling down it, growing towards the tail.
    for (let i = 0; i < SPINE; i++) {
      const u = i / (SPINE - 1), along = u * WORM_LENGTH;
      const wave = Math.sin(along * 2.4 - s.time * 4), lift = Math.sin(along * 1.7 - s.time * 3.1 + 1);
      const swing = 0.25 + 0.75 * u;
      s.spine[i]
        .copy(s.head)
        .addScaledVector(s.dir, -along)
        .addScaledVector(s.side, wave * 0.32 * swing)
        .addScaledVector(s.up, lift * 0.14 * swing);
    }
    // Rings round the spine, each square to it, ridged, rounded off at both ends.
    const pos = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < SPINE; i++) {
      const prev = s.spine[Math.max(i - 1, 0)], next = s.spine[Math.min(i + 1, SPINE - 1)];
      s.t.subVectors(prev, next).normalize();
      // Square to the spine, kept from flipping round: the worm's own side, made square to this bit of spine.
      s.n.copy(s.side).addScaledVector(s.t, -s.side.dot(s.t)).normalize();
      s.b.crossVectors(s.n, s.t);
      // Rounded ends: a quarter circle in profile, stopping short of nothing so the tips close smoothly.
      const along = (i / (SPINE - 1)) * WORM_LENGTH, cap = WORM_RADIUS * 1.3;
      const end = Math.min(1, (Math.min(along, WORM_LENGTH - along) + cap * 0.04) / cap);
      const round = Math.sqrt(1 - (1 - end) ** 2);
      const r = WORM_RADIUS * round * (1 + 0.07 * round * Math.cos((along / WORM_LENGTH) * RIDGES * Math.PI * 2));
      for (let j = 0; j < RIM; j++) {
        const a = (j / RIM) * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r, p = s.spine[i];
        pos.setXYZ(i * RIM + j, p.x + s.n.x * x + s.b.x * y, p.y + s.n.y * x + s.b.y * y, p.z + s.n.z * x + s.b.z * y);
      }
    }
    // The tips, a little out beyond the end rings along the spine.
    s.t.subVectors(s.spine[0], s.spine[1]).normalize();
    pos.setXYZ(SPINE * RIM, s.spine[0].x + s.t.x * WORM_RADIUS * 0.06, s.spine[0].y + s.t.y * WORM_RADIUS * 0.06, s.spine[0].z + s.t.z * WORM_RADIUS * 0.06);
    s.t.subVectors(s.spine[SPINE - 1], s.spine[SPINE - 2]).normalize();
    const e = s.spine[SPINE - 1];
    pos.setXYZ(SPINE * RIM + 1, e.x + s.t.x * WORM_RADIUS * 0.06, e.y + s.t.y * WORM_RADIUS * 0.06, e.z + s.t.z * WORM_RADIUS * 0.06);
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return <mesh ref={worm} geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />;
}
const UP = new Vector3(0, 1, 0);

// A leader and a line of followers playing round the sun like dolphins: the leader loops quickly round the
// sun the way the planets go, leaping up and diving down and swinging in and out; each of the others chases
// where the one in front of it was a moment ago, swaying a little from side to side, so the line ripples along
// behind. The leader knows where each planet will be by the time it gets there, from its orbit, and steers clear of
// that; and when it comes alongside one going about its own speed, it stops to play, looping round it two or three
// times before going on, the line in tow. Each one is a little cluster of sprinkles. They stop with the clock and
// slow with it.
const FOLLOWERS = 14;
const POD = FOLLOWERS + 1; // the leader first
const BEHIND = 4; // frames: how far back along the one in front each follower aims, its spacing in the line
const CLUSTER = 7; // each one is a little string of sprinkles
const GAP = 1; // frames between one sprinkle and the next along its string
const HISTORY = Math.max(BEHIND, CLUSTER * GAP) + 3;
const FAST = 14, SLOW = 4; // speed limits, scene units per second

function Pod() {
  const ref = useRef<InstancedMesh>(null!);
  // A sprinkle: a short rounded rod, glossy, glowing a little in its own colour.
  const geometry = useMemo(() => new CapsuleGeometry(0.036, 0.08, 4, 10), []);
  const material = useMemo(() => {
    const m = new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.25;');
    };
    return m;
  }, []);
  // Each cluster's sprinkles, more or less in single file along the way it's going: strung out one behind another
  // with a little sideways stagger, each pointing roughly forward, tipped a little its own way and wobbling.
  const bits = useMemo(
    () =>
      Array.from({ length: POD * CLUSTER }, (_, n) => {
        const k = n % CLUSTER;
        return {
          at: new Vector3((r() - 0.5) * 0.2, (k - (CLUSTER - 1) / 2) * -0.17 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.18),
          // Its own little curve on top: across and up and down, slowly, each at its own pace.
          wander: [0.8 + r() * 1.4, 0.7 + r() * 1.5, r() * 6.3, r() * 6.3, 0.03 + r() * 0.08, 0.03 + r() * 0.07],
          axis: new Vector3(r() - 0.5, 0, r() - 0.5).normalize(),
          turn: (r() - 0.5) * 0.7,
          spin: 1.5 + r() * 2,
          phase: r() * Math.PI * 2,
          // A couple in each line don't stay put: they drift ahead, back or alongside now and then.
          stray: r() < 0.3 ? 1 : 0,
          colour: SPRINKLES[Math.floor(r() * SPRINKLES.length)],
        };
      }),
    [],
  );
  const state = useMemo(() => {
    const fish = Array.from({ length: POD }, (_, i) => {
      const p = new Vector3(9, ORBIT_Y, i * 0.8);
      // A few don't quite keep to the line (wild): now and then they go off ahead, drop back or swim alongside.
      return { p, v: new Vector3(0, 0, -8), trail: Array.from({ length: HISTORY }, () => p.clone()), sway: r() * Math.PI * 2, wild: i > 0 && r() < 0.35 ? 1 : 0, wander: r() * 100 };
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
      for (let k = 0; k < CLUSTER; k++) ref.current.setColorAt(i * CLUSTER + k, c.set(bits[i * CLUSTER + k].colour));
    }
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);

  const aim = useMemo(() => new Vector3(), []), d = useMemo(() => new Vector3(), []);
  const side = useMemo(() => new Vector3(), []), up = useMemo(() => new Vector3(0, 1, 0), []);
  const ahead = useMemo(() => new Vector3(), []), there = useMemo(() => new Vector3(), []);
  const pv = useMemo(() => new Vector3(), []), a = useMemo(() => new Vector3(), []), b = useMemo(() => new Vector3(), []);
  // A planet's velocity in the scene, units per second at the current clock speed.
  const velocityOf = (p: (typeof PLANETS)[number], out: Vector3) =>
    out.subVectors(planetAt(p, clock.jd + 0.5, a), planetAt(p, clock.jd - 0.5, b)).multiplyScalar(daysPerSecond());
  useFrame((_, delta) => {
    // The pod stops with the clock, but only slows a little with it (×1 about four fifths of full pace, ×0.5 about two thirds), and
    // keeps playing at full pace while a planet is in focus.
    const rate = clock.paused ? 0 : pickedNow() ? 1 : Math.pow(clock.speed / FULL_SPEED, 0.1);
    const dt = Math.min(delta, 1 / 30) * rate, S = state;
    S.time += dt;
    // The leader's path: round the sun, quick, leaping and swinging in and out.
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
            there.copy(planetAt(p, clock.jd + t * daysPerSecond(), a));
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
        if (f.wild) {
          // Off on its own for a while: a slow swell that comes and goes, pulling it ahead or back along the line and
          // out to the side.
          const urge = Math.max(0, Math.sin(S.time * 0.4 + f.wander)) ** 2;
          d.copy(ahead.v).normalize();
          aim.addScaledVector(d, urge * 1.6 * Math.sin(S.time * 0.23 + f.wander * 1.7));
          aim.addScaledVector(side, urge * 1.3 * Math.cos(S.time * 0.31 + f.wander));
        }
      }
      // Steer: a velocity towards the aim, eased in.
      const crisp = i > 0 || S.play; // the leader turns tighter while it plays
      d.subVectors(aim, f.p).multiplyScalar(crisp ? 14 : 2.5);
      f.v.lerp(d, Math.min(1, dt * (crisp ? 14 : 2)));
      // Last ditch swerve, if anyone gets right up against a planet, and stay clear of the sun.
      for (const q of planetPositions.values()) {
        d.subVectors(f.p, q);
        const dist = d.length();
        if (dist < 2.6) f.v.addScaledVector(d.normalize(), (2.6 - dist) * 60 * dt);
      }
      d.subVectors(f.p, SUN);
      const fromSun = d.length();
      if (fromSun < 6) f.v.addScaledVector(d.normalize(), (6 - fromSun) * 50 * dt);
      if (fromSun > 24) f.v.addScaledVector(d.normalize(), (24 - fromSun) * 20 * dt);
      const speed = f.v.length() || 1;
      // Followers may go a little faster than the leader, so they can catch up and keep the line tight.
      f.v.multiplyScalar(Math.min(Math.max(speed, SLOW), i === 0 ? FAST : FAST * 1.4) / speed);
      f.p.addScaledVector(f.v, dt);
    });
    // Record the paths and draw each one as a string of sprinkles laid along the way it has just come, so the string
    // bends through every turn like something swimming: each sprinkle at its own point on the path, pointing along
    // it there, a soft wave running back down the string, the odd one straying ahead, back or alongside. The leader's
    // a bit bigger.
    if (dt > 0) S.head = (S.head + 1) % HISTORY;
    S.fish.forEach((f, i) => {
      f.trail[S.head].copy(f.p);
      const big = i === 0 ? 1.35 : 1;
      // The whole cluster drifts a little off the line too, in its own slow curve.
      const swayX = 0.12 * Math.sin(S.time * (1.1 + i * 0.13) + i * 2.3), swayY = 0.1 * Math.cos(S.time * (0.9 + i * 0.17) + i * 1.7);
      for (let k = 0; k < CLUSTER; k++) {
        const bit = bits[i * CLUSTER + k];
        const at = f.trail[(S.head - k * GAP + HISTORY * 2) % HISTORY];
        const before = f.trail[(S.head - k * GAP - 1 + HISTORY * 2) % HISTORY];
        dir.subVectors(at, before);
        if (dir.lengthSq() < 1e-8) dir.copy(f.v);
        if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
        dir.normalize();
        side.crossVectors(dir, up).normalize();
        // The wave, and a straying one's wander, across and along the path.
        const [f1, f2, p1, p2, a1, a2] = bit.wander;
        let across = bit.at.x + 0.07 * Math.sin(S.time * 6 - k * 0.9 + i) + swayX + a1 * Math.sin(S.time * f1 + p1 + k * 0.4);
        const lift = bit.at.z + swayY + a2 * Math.sin(S.time * f2 + p2);
        let along = 0;
        if (bit.stray) {
          const urge = Math.max(0, Math.sin(S.time * 0.7 + bit.phase)) ** 2;
          along = urge * 0.45 * Math.sin(S.time * 0.37 + bit.phase * 2.1);
          across += urge * 0.3 * Math.cos(S.time * 0.53 + bit.phase);
        }
        spot.copy(at).addScaledVector(side, across * big).addScaledVector(dir, along * big).addScaledVector(up, lift * big);
        q.setFromUnitVectors(AXIS, dir);
        tumble.setFromAxisAngle(bit.axis, bit.turn * 0.5 + 0.25 * Math.sin(S.time * bit.spin + bit.phase));
        ref.current.setMatrixAt(i * CLUSTER + k, m.compose(spot, tumble.premultiply(q), sc.setScalar(big)));
      }
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, POD * CLUSTER]} frustumCulled={false} />;
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
