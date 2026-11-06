import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BallCollider, CapsuleCollider, CylinderCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { AdditiveBlending, BufferAttribute, LatheGeometry, Vector2, CanvasTexture, RepeatWrapping, Vector4, Color, SRGBColorSpace, type Group as THREE_Group, InstancedMesh, Matrix4, type Mesh, ShaderMaterial, MeshPhysicalMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { clock } from './clock';
import { PLANETS, type Planet } from './planets';
import { planetAt } from './scale';
import { AllsortSweet, Chili, Moons, type Allsort } from './Moons';
import { pick } from './selection';
import { moonPositions, planetPositions } from './world';

// Each planet as a jelly bean, all the same size: the candy it is made of. A base colour with darker
// patches, bigger patches of a second colour and highlights inside those; 'bands' lays them out in stripes round the
// bean instead, for the gas giants.
type Candy = { base: string; dark: string; patch: string; light: string; bands?: boolean; ring?: boolean; bump?: number; poles?: boolean };
const CANDY: Record<string, Candy> = {
  Mercury: { base: '#5e544c', dark: '#2e2824', patch: '#a2968a', light: '#d8cfc4' },
  Venus: { base: '#d9a54a', dark: '#a8742a', patch: '#f2d79a', light: '#fff1cf' },
  // Green land, darker green in its heart, raised a touch; small ice caps; a thin blue atmosphere round it all.
  Earth: { base: '#1f5fd0', dark: '#123c8a', patch: '#2f9a4a', light: '#1c5a2a', bump: 1, poles: true },
  Mars: { base: '#a5121c', dark: '#6b0a12', patch: '#f08a1e', light: '#ffcb5c' },
  Jupiter: { base: '#c98a52', dark: '#8a4a24', patch: '#f1dcb6', light: '#fff6e6', bands: true },
  Saturn: { base: '#dcb877', dark: '#a8884e', patch: '#f3e2b4', light: '#fff8e2', bands: true, ring: true },
  Uranus: { base: '#5fd3db', dark: '#3aa9b6', patch: '#a8f1f2', light: '#e8ffff' },
  Neptune: { base: '#1d3fb8', dark: '#0b1f66', patch: '#4d7cff', light: '#eef3ff' },
};

export const LENGTH = 4.0; // every bean's length in scene units
// How far below their orbits' plane the beans ride (negative is above): at the glass ball's centre, halfway up.
const DIG = -12.6;
const ROLL = 1.6; // rad/s about its length, backwards for the retrograde spinners
const TIP = 0.5; // rad/s of the slow end over end rocking

// A jelly bean of length 1: an ellipsoid a little flatter than it is wide, bent into a kidney so one side goes concave.
export function beanGeometry(widthSegments = 96, heightSegments = 64) {
  const g = new SphereGeometry(1, widthSegments, heightSegments);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const bend = 0.32 * (1 - x * x); // the middle sits higher than the ends
    p.setXYZ(i, x * 0.5, y * 0.3 + bend * 0.5 - 0.08, z * 0.27);
  }
  g.computeVertexNormals();
  return g;
}
const BEAN = beanGeometry();

// No two jelly beans are quite the same shape: a copy of the bean with its surface pushed in and out a little by
// smooth noise, its own for each seed, then its normals worked out again. Amount in bean lengths.
const LUMPS = 0.035;
function lumpy(seed: number) {
  const g = BEAN.clone();
  const pos = g.attributes.position;
  const h = (x: number, y: number, z: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.13) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (x: number, y: number, z: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    fz = fz * fz * (3 - 2 * fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(ix, iy, iz), h(ix + 1, iy, iz), fx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
      l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx), fy),
      fz,
    );
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Two octaves: broad dents and bulges, and smaller knobbles.
    const d = (smooth(x * 4, y * 4, z * 4) - 0.5) + (smooth(x * 11, y * 11, z * 11) - 0.5) * 0.35;
    // Pushed out from the bean's middle, not along the normal: the sphere's seam has doubled vertices with
    // slightly different normals, and they must move together or the surface would crack open.
    const len = Math.hypot(x, y, z) || 1;
    pos.setXYZ(i, x + (x / len) * d * LUMPS, y + (y / len) * d * LUMPS, z + (z / len) * d * LUMPS);
  }
  g.computeVertexNormals();
  return g;
}

// The bean's collider, as a capsule along its length, sized for a bean of length 1 (scaled at use).
export const BEAN_CAPSULE = { radius: 0.245, half: 0.25, lift: 0.06 };

// Candy under a hard glaze. Faked subsurface scattering: the sugar shell lets some light through, so the colour glows
// a little on its own, and deeper at the thin grazing edges where the light has gone through more of the bean.
function candy(c: Candy, seed: number) {
  const m = new MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.07 });
  const lin = (hex: string) => new Color(hex); // three converts hex from sRGB to linear
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uBase: { value: lin(c.base) },
      uDark: { value: lin(c.dark) },
      uPatch: { value: lin(c.patch) },
      uLight: { value: lin(c.light) },
      uSeed: { value: seed },
      uBands: { value: c.bands ? 1 : 0 },
      uBump: { value: c.bump ?? 0 },
      uPoles: { value: c.poles ? 1 : 0 },
    });
    sh.vertexShader = sh.vertexShader
      // The bean's own axes in view space, so slopes worked out on the bean can tip the view space normal.
      .replace('void main() {', 'varying vec3 vObj, vAxX, vAxY, vAxZ;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vObj = position;\n  vAxX = normalize(normalMatrix * vec3(1, 0, 0));\n  vAxY = normalize(normalMatrix * vec3(0, 1, 0));\n  vAxZ = normalize(normalMatrix * vec3(0, 0, 1));',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `varying vec3 vObj, vAxX, vAxY, vAxZ;
  vec3 toView(vec3 g) { return g.x * vAxX + g.y * vAxY + g.z * vAxZ; }
  uniform vec3 uBase, uDark, uPatch, uLight;
  uniform float uSeed, uBands, uBump, uPoles;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.3 + 7.1) + 0.15 * noise(p * 5.1 + 3.7); }
  // The patches' height, for the bump: high where the land is, eased so the coasts slope rather than step.
  float landAt(vec3 o) {
    vec3 p = o * 6.4 + uSeed;
    return smoothstep(0.5, 0.66, fbm(p + fbm(p * 1.9) * 0.9));
  }
void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
  vec3 p = vObj * 6.4 + uSeed;
  float n = fbm(p + fbm(p * 1.9) * 0.9);
  // Gas giants: stripes round the bean's length, wavering.
  float band = 0.5 + 0.5 * sin(vObj.x * 22.0 + fbm(p * 0.8) * 3.0);
  n = mix(n, band * 0.75 + n * 0.25, uBands);
  float blot = smoothstep(0.56, 0.6, n);
  float light = smoothstep(0.66, 0.69, n);
  float dark = smoothstep(0.62, 0.66, fbm(p * 1.4 + 9.0)) * 0.6;
  vec3 c = mix(uBase, uDark, dark);
  c = mix(c, uPatch, blot);
  c = mix(c, uLight, light);
  diffuseColor.rgb = c;
  // The patches are a sugary crust on the glaze: how much of one is here, for the gloss and the grain below.
  float stain = max(blot, light) * (1.0 - uBands * 0.6);
  // Ice caps at the poles, the ends of the bean (it spins about its length), with ragged edges.
  float cap = smoothstep(0.41, 0.46, abs(vObj.x) + (fbm(p * 1.3 + 4.0) - 0.5) * 0.08) * uPoles;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), cap * 0.75);
  stain = max(stain, cap * 0.7);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        // Glossy candy where it's bare, matte and sugary where the patches are.
        '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.24, 0.68, stain);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
  // Grain: a soft orange peel all over, a little more on the patches; the slope of a gentle noise tips the normal.
  vec3 gq = vObj * mix(16.0, 26.0, stain);
  float ge = 0.08, g0 = noise(gq);
  vec3 grad = vec3(noise(gq + vec3(ge, 0, 0)) - g0, noise(gq + vec3(0, ge, 0)) - g0, noise(gq + vec3(0, 0, ge)) - g0) / ge;
  normal = normalize(normal - toView(grad) * mix(0.008, 0.022, stain));
  // Bump: the land stands a touch proud of the sea (Earth), the slope of the pattern itself tipping the normal at
  // the coasts.
  if (uBump > 0.0) {
    float be = 0.01, b0 = landAt(vObj);
    vec3 bg = vec3(landAt(vObj + vec3(be, 0, 0)) - b0, landAt(vObj + vec3(0, be, 0)) - b0, landAt(vObj + vec3(0, 0, be)) - b0) / be;
    normal = normalize(normal - toView(bg) * 0.005 * uBump);
  }`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        // The hard glaze thins out over the crust.
        '#include <lights_physical_fragment>\n  material.clearcoat *= 1.0 - 0.85 * stain;\n  material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.35, stain);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
  float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * 0.06 + uDark * edge * 0.6;`,
      );
  };
  return m;
}

const q = new Quaternion(), qa = new Quaternion();
const T = new Vector3(), side = new Vector3(), up = new Vector3(), UP = new Vector3(0, 1, 0), basis = new Matrix4();
const a = new Vector3(), b = new Vector3(), vel = new Vector3(), cur = new Quaternion();
// Steering towards the orbit, per second: how hard a bean pulled off its track is drawn back to its place on it,
// and back to its proper turn.
const PULL = 3;
const TURN = 6;
const DENSITY = 25; // heavy, so the loose sweets bounce off the planets rather than shove them about

// Saturn's ring as a belt of tiny gumballs, each on its own circular orbit round the bean, the inner ones going round
// faster than the outer ones (Kepler: angular speed falls as r^-1.5), so the belt shears slowly as it turns. In the
// bean's units: the ring's inner and outer radius, and how thick it is.
const BELT_COUNT = 700;
const BELT_IN = 0.5, BELT_OUT = 0.78, BELT_THICK = 0.012;
const BELT_SPIN = 0.8; // rad/s at the inner edge
// Little gumballs in the chalky pastels of a gumball machine.
// Chalky pastels scatter light about inside the coat, so even their shaded side keeps some of its own colour.
const chalkyGlow = (sh: { fragmentShader: string }) => {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.22;',
  );
};
const BELT_COLOURS = ['#f29aa8', '#f08a7e', '#f5a04e', '#f2cc66', '#a9bde8', '#9fc7a8', '#f7b6c8'];

// Saturn is playful, and has a beef with Mercury: when a quick planet comes past close by, Mercury most of all, it
// pulls two or three sweets off its belt and lets fly. It aims where the target will be by the time they arrive,
// from its orbit, so the first one is dead on and the others fan out a little round it. They are heavy enough to
// knock the target off its track for a moment. Then, yoyo style, they come back: just past the target they turn
// round and fly home to Saturn, and slip back into their places in the belt. A good long rest between throws.
const NEAR = 12; // a planet this close (scene units) is passing by
const QUICK = 4; // and only the quick ones, scene units per second: the slow outer planets aren't worth it
const BURST_SIZE = [2, 3]; // sweets per throw
const THROW = 18; // throwing speed, scene units per second
const SPREAD = 0.08; // how widely the others fan out round the first, as a fraction of its speed
const SHRUG = 0.6; // chance it can't be bothered with anyone but Mercury
const REST = 14; // seconds between throws
const OVERSHOOT = 0.35; // seconds past the target before the yoyo turns round
const RETURN = 16; // flying home, scene units per second
const HOME = 1.5; // this close to Saturn's middle, it's back in the belt
const GIVE_UP = 10; // seconds, in case one gets stuck somewhere

type Slot = { gone: number };
type Fling = { id: number; pos: Vector3; vel: Vector3; colour: string; out: number; slot: Slot };
let flingId = 0;
let throwSweets: ((f: Fling[]) => void) | null = null;

// How far the belt keeps from each planet passing through it, in scene units: a bean's half length (whichever way
// it's turned), Jupiter's roll, Uranus with its moon drops. And how soft the bend round them is.
// (Jupiter and Uranus are sized further down, so their numbers are repeated here from LENGTH.)
const AVOID: Record<string, number> = { bean: LENGTH * 0.55, Jupiter: LENGTH * 0.45 * 1.3, Uranus: LENGTH * 0.36 * 1.6 };
const AVOID_SOFT = 0.8;
const TITAN_AVOID = 0.3 + 0.25; // Titan's radius and a little room
const BLOCKERS = Array.from({ length: 4 }, () => ({ at: new Vector3(), r: 0, soft: 0 }));

function SaturnBelt({ shadows, playful }: { shadows: boolean; playful: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  const geometry = useMemo(() => new SphereGeometry(0.024, 12, 8), []);
  const sweets = useMemo(() => {
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    return Array.from({ length: BELT_COUNT }, (_, i) => {
      // More of them towards the inner edge, like the bright B ring.
      const r = BELT_IN + (BELT_OUT - BELT_IN) * Math.pow(rnd(), 1.4);
      return {
        r,
        a: rnd() * Math.PI * 2,
        z: (rnd() - 0.5) * BELT_THICK,
        w: BELT_SPIN * Math.pow(BELT_IN / r, 1.5),
        tilt: rnd() * Math.PI,
        squash: [1 + (rnd() - 0.5) * 0.18, 1 + (rnd() - 0.5) * 0.18, 1 + (rnd() - 0.5) * 0.18], // each a little wonky
        colour: BELT_COLOURS[i % BELT_COLOURS.length],
        gone: 0, // seconds until it grows back, after being flung
      };
    });
  }, []);
  useLayoutEffect(() => {
    const c = new Color();
    sweets.forEach((s, i) => ref.current.setColorAt(i, c.set(s.colour)));
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [sweets]);
  const m = useMemo(() => new Matrix4(), []), p = useMemo(() => new Vector3(), []);
  const q = useMemo(() => new Quaternion(), []), size = useMemo(() => new Vector3(), []), z = useMemo(() => new Vector3(0, 0, 1), []);
  const near = useRef(new Set<string>()); // who is passing by right now, so each pass gets one throw
  const rest = useRef(3);
  const speedOf = useMemo(() => new Vector3(), []), at0 = useMemo(() => new Vector3(), []), at1 = useMemo(() => new Vector3(), []);
  const centre = useMemo(() => ({ now: new Vector3(), before: new Vector3(), vel: new Vector3(), ready: false }), []);
  useFrame((_, dt) => {
    const mesh = ref.current;
    // Saturn's own velocity, from where the belt's centre was a frame ago.
    mesh.updateWorldMatrix(true, false);
    centre.before.copy(centre.now);
    mesh.getWorldPosition(centre.now);
    if (centre.ready && dt > 0) centre.vel.subVectors(centre.now, centre.before).divideScalar(dt);
    centre.ready = true;

    // Who's coming past? Each pass close by, of a quick planet, gets one throw; Mercury always, others not always.
    let target: Planet | null = null;
    rest.current = Math.max(0, rest.current - dt);
    if (playful && throwSweets) {
      for (const pl of PLANETS) {
        if (pl.name === 'Saturn') continue;
        const there = planetPositions.get(pl.name);
        if (!there) continue;
        const close = there.distanceTo(centre.now) < NEAR;
        const was = near.current.has(pl.name);
        if (!close) {
          near.current.delete(pl.name);
          continue;
        }
        if (was) continue;
        near.current.add(pl.name);
        speedOf.subVectors(planetAt(pl, clock.jd + 0.5, at0), planetAt(pl, clock.jd - 0.5, at1)).multiplyScalar(clock.paused ? 0 : clock.speed);
        if (speedOf.length() < QUICK) continue;
        if (rest.current > 0) continue; // still resting from the last throw
        if (pl.name !== 'Mercury' && Math.random() < SHRUG) continue;
        if (!target || pl.name === 'Mercury') target = pl;
      }
    }
    if (target && throwSweets) {
      rest.current = REST;
      const count = BURST_SIZE[0] + Math.floor(Math.random() * (BURST_SIZE[1] - BURST_SIZE[0] + 1));
      // A few neighbours from one spot in the belt, so they leave together.
      const start = Math.floor(Math.random() * BELT_COUNT);
      const out: Fling[] = [];
      let aim: Vector3 | null = null;
      let flight = 1;
      for (let k = 0; k < BELT_COUNT && out.length < count; k += 1 + Math.floor(Math.random() * 3)) {
        const s = sweets[(start + k) % BELT_COUNT];
        if (s.gone > 0) continue;
        const here = mesh.localToWorld(new Vector3(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, s.z));
        if (!aim) {
          // Lead the target: guess the flight time, see where it will be then, refine.
          const at = new Vector3();
          let t = 1;
          for (let it = 0; it < 6; it++) {
            planetAt(target, clock.jd + t * (clock.paused ? 0 : clock.speed), at).y -= DIG;
            t = at.distanceTo(here) / THROW;
          }
          aim = at.sub(here).divideScalar(t); // the velocity that gets there on time
          flight = t;
        }
        const vel = aim.clone();
        if (out.length) vel.add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(THROW * SPREAD * 2));
        out.push({ id: flingId++, pos: here, vel, colour: s.colour, out: flight + OVERSHOOT, slot: s });
        s.gone = Infinity; // away until it comes home
      }
      throwSweets(out);
    }

    // Anyone passing through the belt: the sweets bend round them, out to a soft distance, instead of cutting through.
    // Worked out in the belt's own space (its radius is 1), from the planets' places now.
    let blockers = 0;
    if (playful) {
      const scale = mesh.matrixWorld.getMaxScaleOnAxis();
      for (const pl of PLANETS) {
        if (pl.name === 'Saturn') continue;
        const there = planetPositions.get(pl.name);
        if (!there) continue;
        const reach = (AVOID[pl.name] ?? AVOID.bean) + AVOID_SOFT;
        if (there.distanceTo(centre.now) > BELT_OUT * scale + reach * 2) continue;
        const o = BLOCKERS[blockers++];
        mesh.worldToLocal(o.at.copy(there));
        o.r = (AVOID[pl.name] ?? AVOID.bean) / scale;
        o.soft = AVOID_SOFT / scale;
        if (blockers === BLOCKERS.length) break;
      }
      // And Saturn's own moon, going round just outside it, whenever its orbit takes it through the belt.
      const titan = moonPositions.get('Titan');
      if (titan && blockers < BLOCKERS.length) {
        const o = BLOCKERS[blockers++];
        mesh.worldToLocal(o.at.copy(titan));
        o.r = TITAN_AVOID / scale;
        o.soft = AVOID_SOFT * 0.6 / scale;
      }
    }

    sweets.forEach((s, i) => {
      s.a += dt * s.w;
      if (s.gone > 0 && s.gone !== Infinity) s.gone = Math.max(0, s.gone - dt);
      // Gone while it's away, then growing back over its last second.
      const grow = s.gone > 1 ? 0 : 1 - s.gone;
      p.set(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, s.z);
      for (let b = 0; b < blockers; b++) {
        // A smooth max of its distance and the blocker's radius: untouched far off, eased out to just past the
        // radius close in, so the ring curves round rather than kinking.
        const o = BLOCKERS[b];
        const d = p.distanceTo(o.at);
        if (d > o.r + o.soft * 3) continue;
        const pushed = 0.5 * (d + o.r + Math.sqrt((d - o.r) ** 2 + o.soft * o.soft));
        p.sub(o.at).multiplyScalar(pushed / Math.max(d, 1e-5)).add(o.at);
      }
      q.setFromAxisAngle(z, s.a + s.tilt); // lying flat in the ring, each turned its own way
      mesh.setMatrixAt(i, m.compose(p, q, size.set(grow * s.squash[0], grow * s.squash[1], grow * s.squash[2])));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, BELT_COUNT]} castShadow={shadows} receiveShadow={shadows} frustumCulled={false}>
      <meshPhysicalMaterial roughness={0.3} clearcoat={0.75} clearcoatRoughness={0.15} sheen={0.3} sheenColor="#ffffff" onBeforeCompile={chalkyGlow} />
    </instancedMesh>
  );
}

// One thrown sweet: a small rigid body in free flight, straight at where it was aimed (no gravity, it's space),
// heavy for its size so a hit gives the target a real shove, bouncing off whatever it meets. Past the target it
// turns round and flies back to Saturn, and once home it is back in the belt.
const FLUNG_SIZE = 2; // bigger than in the belt, to be seen flying
function Flung({ fling, done }: { fling: Fling; done: () => void }) {
  const body = useRef<RapierRigidBody>(null!);
  const look = useRef<THREE_Group>(null!);
  const life = useRef(0);
  const geometry = useMemo(() => new SphereGeometry(0.024 * LENGTH * FLUNG_SIZE, 16, 12), []);
  const v = useMemo(() => new Vector3(), []), home = useMemo(() => new Vector3(), []), finished = useRef(false);
  useFrame((_, dt) => {
    life.current += dt;
    const rb = body.current;
    const saturn = planetPositions.get('Saturn');
    if (!rb || !saturn || finished.current) return;
    if (life.current < fling.out) return; // still on its way out
    const t = rb.translation(), lv = rb.linvel();
    home.set(saturn.x - t.x, saturn.y - t.y, saturn.z - t.z);
    const dist = home.length();
    if (dist < HOME || life.current > GIVE_UP) {
      // Back in the belt: its place there fills again straight away.
      finished.current = true;
      fling.slot.gone = 1;
      done();
      return;
    }
    // The string pulls it home, turning it round smoothly, faster as it reels in.
    v.set(lv.x, lv.y, lv.z).lerp(home.normalize().multiplyScalar(RETURN), Math.min(1, dt * 3));
    rb.setLinvel(v, true);
    look.current.scale.setScalar(Math.min(1, dist / 3)); // shrinking into the belt as it arrives
  });
  return (
    <RigidBody
      ref={body}
      position={fling.pos.toArray()}
      linearVelocity={fling.vel.toArray()}
      gravityScale={0}
      linearDamping={0}
      angularDamping={0.2}
      ccd
      colliders={false}
    >
      <BallCollider args={[0.022 * LENGTH * FLUNG_SIZE]} restitution={0.85} friction={0.1} density={400} />
      <group ref={look}>
        <mesh geometry={geometry} castShadow>
          <meshPhysicalMaterial color={fling.colour} roughness={0.3} clearcoat={0.75} clearcoatRoughness={0.15} sheen={0.3} sheenColor="#ffffff" onBeforeCompile={chalkyGlow} />
        </mesh>
      </group>
    </RigidBody>
  );
}

// Holds the sweets in flight; Saturn's belt throws them in through throwSweets.
function Flings() {
  const [flying, setFlying] = useState<Fling[]>([]);
  useEffect(() => {
    throwSweets = (f) => setFlying((list) => [...list, ...f].slice(-60));
    return () => {
      throwSweets = null;
    };
  }, []);
  return (
    <>
      {flying.map((f) => (
        <Flung key={f.id} fling={f} done={() => setFlying((list) => list.filter((x) => x.id !== f.id))} />
      ))}
    </>
  );
}

// Earth's atmosphere: a slightly bigger shell round the bean, clear where you look straight through it and a soft
// blue glow towards its rim, where the line of sight runs through more air. Added on top, no shadows, no depth.
const ATMOSPHERE = new ShaderMaterial({
  uniforms: { uColour: { value: new Color('#7fb8ff') } },
  vertexShader: /* glsl */ `
    varying vec3 vN, vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColour;
    varying vec3 vN, vV;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
      gl_FragColor = vec4(uColour, rim * 0.75);
    }`,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
});

// A planet's jelly bean on its own, with Saturn's ring: used in the scene and in the close up card.
// Jupiter isn't a jelly bean: it's the big one from the liquorice allsorts, a yellow roll round a black liquorice
// core, lying along its orbit like the beans and spinning about its length. Its moons are allsorts too.
export const JUPITER_RADIUS = LENGTH * 0.45;
const JUPITER_ROLL: Allsort = { kind: 'roll', coat: '#f2d65a', core: '#1a1416' };
const JUPITER_LENGTH = JUPITER_RADIUS * 1.5; // the roll's length, as AllsortSweet makes it

// Uranus isn't a bean either: a round sugared gum drop, cyan, see-through soft gum under a frost of sugar. Plain
// PBR: real transmission for the gum, sheen for the frost, and painted maps (colour, bump, roughness) for the sugar
// grains and the faint wavy bands. It spins about the bean's length, which lies along its orbit, so like the real
// Uranus it rolls round on its side; the sphere is turned so its poles, and the bands, go round that axis.
export const URANUS_RADIUS = LENGTH * 0.36;

// The maps, painted once on canvases laid out like the sphere's UVs (longitude across, latitude down): the gum in two
// shades, in soft wavy bands if it has any, and sugar grains over it.
export type Gum = { deep: number[]; pale: number[]; bands: number; size: number; grains: number };
function gumMaps({ deep, pale, bands, size: w, grains }: Gum) {
  const h = w / 2;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')!] as const;
  };
  const [colour, cx] = canvas(), [bump, bx] = canvas(), [rough, rx] = canvas();
  const img = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2, lat = y / h;
      const wave = Math.sin(lat * Math.PI) * 0.04 * Math.sin(lon * 3 + lat * 9);
      const t = bands ? 0.5 + 0.5 * Math.sin((lat + wave) * Math.PI * bands) : 0.5 + 0.25 * Math.sin(lon * 2 + lat * 5) * Math.sin(lat * 7);
      const k = t * t * (3 - 2 * t), i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) img.data[i + c] = deep[c] + (pale[c] - deep[c]) * k;
      img.data[i + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  bx.fillStyle = '#000';
  bx.fillRect(0, 0, w, h);
  rx.fillStyle = 'rgb(80,80,80)'; // bare gum: fairly glossy
  rx.fillRect(0, 0, w, h);
  // The sugar: lots of small grains, a few bigger, drawn as ellipses widened towards the poles so they come out
  // round on the sphere.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < grains; i++) {
    const x = rnd() * w, y = Math.acos(1 - 2 * rnd()) / Math.PI * h; // even over the sphere, not the map
    const stretch = 1 / Math.max(Math.sin((y / h) * Math.PI), 0.08);
    const r = 0.7 + rnd() ** 3 * 2.6, a = 0.35 + rnd() * 0.65;
    for (const [g, style] of [
      [cx, `rgba(240,252,252,${a * 0.85})`],
      [bx, `rgba(255,255,255,${a})`],
      [rx, `rgba(200,200,200,${a})`], // sugar is matte
    ] as const) {
      g.fillStyle = style;
      g.beginPath();
      g.ellipse(x, y, r * stretch, r, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = (c: HTMLCanvasElement, srgb = false) => {
    const t = new CanvasTexture(c);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = RepeatWrapping; // round the sphere, so the maps meet at the seam
    return t;
  };
  return { map: tex(colour, true), bumpMap: tex(bump), roughnessMap: tex(rough) };
}

// Gum squishes: where two pieces of the clump meet, each one's vertices are pushed out of the other, so they flatten
// against each other instead of passing through, and just outside the other one they're drawn a little towards it,
// so a soft neck forms between them as if the gum were sticking. All in Uranus's own space: BODIES holds each piece's
// centre and radius there (Uranus first), and each material knows its own piece (self) and how its mesh sits in
// that space (toRoot).
const IDENTITY = new Matrix4();
const BODIES = Array.from({ length: 6 }, () => new Vector4());
const SQUISH_BLEND = 0.35; // how far outside another piece the sticking starts, in scene units
function squish(m: MeshPhysicalMaterial, self: number, toRoot: Matrix4) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBodies = { value: BODIES };
    sh.uniforms.uSelf = { value: self };
    sh.uniforms.uToRoot = { value: toRoot };
    sh.uniforms.uBlend = { value: SQUISH_BLEND };
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform vec4 uBodies[6];\nuniform int uSelf;\nuniform mat4 uToRoot;\nuniform float uBlend;\nvoid main() {')
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  vec3 squished = position;
  {
    vec3 p = (uToRoot * vec4(position, 1.0)).xyz;
    mat3 R = mat3(uToRoot);
    vec3 n = normalize(R * objectNormal);
    for (int j = 0; j < 6; j++) {
      if (j == uSelf) continue;
      vec4 b = uBodies[j];
      vec3 v = p - b.xyz;
      float d = length(v);
      vec3 dir = v / max(d, 1e-4);
      if (d < b.w) {
        // Inside the other piece: out to most of the way to its surface, and the normal turned to face away from it.
        p += dir * (b.w - d) * 0.8;
        n = normalize(mix(n, dir, 0.6));
      } else if (d < b.w + uBlend) {
        // Just outside: drawn in a little, most at the middle of the band, so the two pieces neck together.
        float t = (d - b.w) / uBlend;
        p -= dir * uBlend * 0.35 * t * (1.0 - t) * 4.0 * (1.0 - t);
      }
    }
    squished = (inverse(uToRoot) * vec4(p, 1.0)).xyz;
    objectNormal = normalize(inverse(R) * n);
  }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = squished;');
  };
}

// A sugared gum material, made once per gum. `glow` is the gum's own colour, deepened, for its light from inside.
const GUMS = new Map<string, MeshPhysicalMaterial>();
// `self` is its piece in the Uranus clump, or -1 for gum that isn't part of it and doesn't squish.
export function gumMaterial(key: string, gum: Gum, radius: number, glow: string, glowing = 0.22, self = 0, toRoot = IDENTITY) {
  let m = GUMS.get(key);
  if (m) return m;
  m = new MeshPhysicalMaterial({
    ...gumMaps(gum),
    roughness: 1, // the roughness map sets it: glossy gum, matte sugar
    bumpScale: 1.2,
    transmission: 0.55,
    thickness: radius,
    ior: 1.4,
    attenuationColor: glow,
    attenuationDistance: radius * 0.8,
    sheen: 0.7,
    sheenColor: '#fbfbf6',
    sheenRoughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    emissive: glow, // a little glow of its own, so the night side still reads as coloured gum
    emissiveIntensity: glowing,
  });
  if (self >= 0) squish(m, self, toRoot);
  GUMS.set(key, m);
  return m;
}
const URANUS_GUM: Gum = { deep: [14, 150, 172], pale: [86, 214, 220], bands: 9, size: 2048, grains: 90000 };
// Poles along x, the spin axis.
const URANUS_GEOMETRY = new SphereGeometry(URANUS_RADIUS, 128, 64).rotateZ(Math.PI / 2);

// Its five big moons are smaller gum drops of other flavours, going round just off its surface, each in its own
// tipped plane at its own pace and bobbing a little in and out, so now and then two of them, or one and Uranus,
// meet, and squish together for a moment as they pass. Each is a squat dome, its flat side to Uranus, turning slowly
// on the spot. Sizes go roughly with the real moons.
const DROP_GEOMETRY = new SphereGeometry(1, 64, 32).scale(1, 0.78, 1);
const URANUS_MOONS = [
  { name: 'Miranda', size: 0.3, tilt: [0.35, 0.9, 0.25], speed: 0.62, deep: [200, 24, 40], pale: [246, 70, 76], glow: '#8a0a18' },
  { name: 'Ariel', size: 0.4, tilt: [-0.5, 0.75, -0.35], speed: -0.48, deep: [240, 120, 10], pale: [255, 170, 60], glow: '#a54a00' },
  { name: 'Umbriel', size: 0.38, tilt: [0.2, 0.25, -1], speed: 0.41, deep: [110, 200, 90], pale: [175, 236, 150], glow: '#2f7a1e' },
  { name: 'Titania', size: 0.48, tilt: [0.1, -0.35, 0.95], speed: 0.3, deep: [16, 80, 170], pale: [50, 130, 210], glow: '#082a6a' },
  { name: 'Oberon', size: 0.46, tilt: [-0.45, -0.85, -0.2], speed: -0.26, deep: [240, 200, 10], pale: [255, 236, 90], glow: '#9a7a00' },
];
export const URANUS_REACH = URANUS_RADIUS * 1.6; // out over the drops going round, for the collider
const GAP = 1.05; // how far out a drop rides: its middle this many of its radii off Uranus's surface
const DROPS = URANUS_MOONS.map((moon, i) => {
  const r = URANUS_RADIUS * moon.size;
  const normal = new Vector3(...(moon.tilt as [number, number, number])).normalize();
  const u = new Vector3(1, 0, 0).cross(normal).normalize(), w = new Vector3().crossVectors(normal, u);
  return { moon, r, normal, u, w, angle: i * 1.3, spin: 0, matrix: new Matrix4(), at: new Vector3(), out: 0, placed: false };
});
const DROP_PULL = 3; // per second: how quickly a drop held up catches back up with its place on its orbit
const TOUCH = 0.96; // drops may touch, pressing in this far (of their two radii), but never pass through
BODIES[0].set(0, 0, 0, URANUS_RADIUS);
if (import.meta.env.DEV) (window as any).__drops = BODIES;
let dropsTime = 0;
// Move the drops on and set their matrices and BODIES. Only the scene's Uranus moves them on (dt > 0); the card's
// one just shows them where they are.
// Like the planets: each drop is drawn towards its place on its orbit, and pushed off any drop it runs into, so
// they bump and slide round each other, never through; one held up catches up again once it's clear.
function stepDrops(dt: number) {
  dropsTime += dt;
  const target = new Vector3(), dir = new Vector3(), q = new Quaternion(), turn = new Quaternion(), size = new Vector3();
  const pull = 1 - Math.exp(-dt * DROP_PULL);
  DROPS.forEach((d, i) => {
    d.angle += dt * d.moon.speed;
    d.spin += dt * (i % 2 ? -0.3 : 0.35);
    d.out = URANUS_RADIUS + d.r * (GAP + 0.3 * Math.sin(dropsTime * (0.5 + i * 0.13) + i * 2)); // bobbing
    target.copy(d.u).multiplyScalar(Math.cos(d.angle)).addScaledVector(d.w, Math.sin(d.angle)).multiplyScalar(d.out);
    if (!d.placed) d.at.copy(target), (d.placed = true);
    else d.at.lerp(target, pull);
  });
  // Push apart any two pressing in further than a touch, half each, a few rounds so a pile-up settles, keeping each
  // on its shell round Uranus.
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < DROPS.length; i++) {
      for (let j = i + 1; j < DROPS.length; j++) {
        const a = DROPS[i], b = DROPS[j];
        const least = (a.r + b.r) * 0.9 * TOUCH;
        dir.subVectors(b.at, a.at);
        const d = dir.length();
        if (d >= least || d < 1e-6) continue;
        dir.multiplyScalar((least - d) / d / 2);
        a.at.sub(dir);
        b.at.add(dir);
      }
    }
    DROPS.forEach((d) => d.at.setLength(d.out));
  }
  DROPS.forEach((d, i) => {
    dir.copy(d.at).normalize();
    q.setFromUnitVectors(new Vector3(0, 1, 0), dir).multiply(turn.setFromAxisAngle(new Vector3(0, 1, 0), d.spin));
    d.matrix.compose(d.at, q, size.setScalar(d.r));
    BODIES[i + 1].set(d.at.x, d.at.y, d.at.z, d.r * 0.9); // a little inside its domed outline
  });
}
stepDrops(0);
function MoonDrops({ playful }: { playful: boolean }) {
  const meshes = useRef<(Mesh | null)[]>([]);
  const materials = useMemo(
    () =>
      DROPS.map((d, i) =>
        gumMaterial(d.moon.name, { deep: d.moon.deep, pale: d.moon.pale, bands: 0, size: 1024, grains: 26000 }, d.r, d.moon.glow, 0.4, i + 1, d.matrix),
      ),
    [],
  );
  useFrame((_, dt) => {
    if (playful && !clock.paused) stepDrops(Math.min(dt, 0.1));
    meshes.current.forEach((m, i) => m && m.matrix.copy(DROPS[i].matrix));
  });
  return (
    <>
      {DROPS.map((d, i) => (
        <mesh
          key={d.moon.name}
          ref={(m) => void (meshes.current[i] = m)}
          geometry={DROP_GEOMETRY}
          material={materials[i]}
          matrixAutoUpdate={false}
          frustumCulled={false}
        />
      ))}
    </>
  );
}

// Mercury is a little chocolate button covered in white nonpareils: a round, flattish oval, smaller than the beans,
// lying along its orbit like them, dark glossy chocolate a little uneven, the beads thickest round the rim and
// scattered over the faces. It rolls like the beans do, so it's dotted on both sides.
const MERCURY = { a: LENGTH * 0.29, b: LENGTH * 0.16, c: LENGTH * 0.28 }; // half length, half height, half width
const NONPAREILS = 1100;
const CHOCOLATE_GEOMETRY = (() => {
  const g = new SphereGeometry(1, 96, 48);
  const p = g.attributes.position, v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // The surface a little uneven where it set.
    const lump = 1 + 0.03 * Math.sin(v.x * 7 + 1.3) * Math.sin(v.z * 6 - 0.4) + 0.015 * Math.sin(v.x * 17 + v.z * 13);
    p.setXYZ(i, v.x * MERCURY.a * lump, v.y * MERCURY.b * lump, v.z * MERCURY.c * lump);
  }
  g.computeVertexNormals();
  return g;
})();
const CHOCOLATE = new MeshPhysicalMaterial({ color: '#3b1d12', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: '#8a5a44', emissive: '#3b1d12', emissiveIntensity: 0.35 });
const NONPAREIL = new MeshPhysicalMaterial({ color: '#fbf8f1', roughness: 0.5, emissive: '#fbf8f1', emissiveIntensity: 0.18 });
const NONPAREIL_GEOMETRY = new SphereGeometry(1, 10, 8);
function ChocolateButton({ shadows }: { shadows: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const m = new Matrix4(), q = new Quaternion(), at = new Vector3(), n = new Vector3(), size = new Vector3();
    for (let i = 0; i < NONPAREILS; ) {
      // A direction over the button, kept more often the nearer the rim.
      const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
      if (rnd() > 0.45 + 0.55 * (1 - Math.abs(y)) ** 2) continue;
      at.set(Math.cos(a) * ring * MERCURY.a, y * MERCURY.b, Math.sin(a) * ring * MERCURY.c);
      n.set(at.x / MERCURY.a ** 2, at.y / MERCURY.b ** 2, at.z / MERCURY.c ** 2).normalize();
      const k = LENGTH * (0.009 + rnd() * 0.005);
      at.addScaledVector(n, -k * 0.35); // pressed into the chocolate a little
      m.compose(at, q, size.setScalar(k));
      ref.current.setMatrixAt(i++, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <>
      <mesh geometry={CHOCOLATE_GEOMETRY} material={CHOCOLATE} castShadow={shadows} receiveShadow={shadows} />
      <instancedMesh ref={ref} args={[NONPAREIL_GEOMETRY, NONPAREIL, NONPAREILS]} castShadow={shadows} receiveShadow={shadows} />
    </>
  );
}

// Saturn is a big gumball, the round chewing gum from a gumball machine: a pastel ball, glossy, not quite round,
// its colour a little mottled, with a belt of little gumballs round it.
const SATURN_RADIUS = LENGTH * 0.38;
const SATURN_GEOMETRY = (() => {
  const g = new SphereGeometry(SATURN_RADIUS, 96, 64);
  // Mottled: the colour drifts a little lighter and darker over the ball, as the coat was panned on.
  const p = g.attributes.position, colours = new Float32Array(p.count * 3), v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).divideScalar(SATURN_RADIUS);
    // Not quite round: a few slow dents and bulges, as a gumball is.
    const wonk = 1 + 0.055 * Math.sin(v.x * 2.3 + 0.4) * Math.sin(v.y * 1.9 - 1.2) + 0.035 * Math.sin(v.z * 2.8 + v.x * 1.4 + 2.2) + 0.012 * Math.sin(v.y * 5.1 + v.z * 4.3);
    p.setXYZ(i, v.x * SATURN_RADIUS * wonk, v.y * SATURN_RADIUS * wonk * 0.97, v.z * SATURN_RADIUS * wonk);
    const k = 0.93 + 0.07 * Math.sin(v.x * 5 + 1.1) * Math.sin(v.y * 4.3 - 0.6) * Math.sin(v.z * 5.6 + 2) + 0.03 * Math.sin(v.x * 13 + v.z * 11);
    colours.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return g;
})();
const GUMBALL = new MeshPhysicalMaterial({ color: '#f5c46c', vertexColors: true, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.15, sheen: 0.4, sheenColor: '#fff4e0', emissive: '#f5c46c', emissiveIntensity: 0.1 });

// Venus is a hard butter caramel: a round golden puck, glossy and a little see-through, its face a raised ring round
// a shallow dip with a small dome in the middle, its edge well rounded. Turned on a lathe. The planets roll, so it's
// the same on both faces.
const CARAMEL = { r: LENGTH * 0.28, h: LENGTH * 0.16 }; // radius, half thickness
const CARAMEL_GEOMETRY = (() => {
  const { r: R, h: H } = CARAMEL, edge = R * 0.42; // a wide, soft edge, so it's more pebble than puck
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // The face's height at radius r, out to where the rounded edge starts.
  const face = (r: number) =>
    H * (0.72 + 0.28 * smooth(0.2 * R, 0.45 * R, r) - 0.04 * smooth(0.45 * R, R - edge, r)) + H * 0.2 * Math.exp(-((r / (0.12 * R)) ** 2));
  const top: Vector2[] = [];
  const out = R - edge, steps = 60;
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * out;
    top.push(new Vector2(r, face(r)));
  }
  // The rounded edge: from the face's height down to the middle, a quarter ellipse.
  const rim = face(out);
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    top.push(new Vector2(out + Math.sin(a) * edge, rim * Math.cos(a)));
  }
  // Bottom to top, as the lathe wants it: the underside (the face mirrored) from the middle out to the edge, then the
  // top from the edge back in to the middle.
  const profile = [...top.map((p) => new Vector2(p.x, -p.y)), ...top.slice(0, -1).reverse()].map((p) => new Vector2(Math.max(p.x, 0.0001), p.y));
  const g = new LatheGeometry(profile, 96);
  g.computeVertexNormals();
  return g;
})();
const CARAMEL_MATERIAL = (() => {
  const m = new MeshPhysicalMaterial({ color: '#e6a23c', roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.06, transmission: 0.08, thickness: CARAMEL.h * 2, attenuationColor: '#b0600e', attenuationDistance: 1.5 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      // Caramel holds the light: a warm glow, deeper at the thin edges.
      /* glsl */ `#include <emissivemap_fragment>
  float edge = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += diffuseColor.rgb * (0.08 + 0.3 * edge * edge);`,
    );
  };
  return m;
})();

// Neptune is a jelly drop rolled in blue nonpareils: a soft, slightly squarish dome (a superquadric) packed all over
// with tiny beads, mostly deep blues, a few pale ones and white. One instanced mesh of beads on a dark blue core.
const NEPTUNE = { a: LENGTH * 0.36, b: LENGTH * 0.31, c: LENGTH * 0.36, n: 2.6 }; // half sizes, squareness
const NEPTUNE_BEADS = 3600;
const NEPTUNE_BEAD = LENGTH * 0.019;
const NEPTUNE_COLOURS: [string, number][] = [['#2a2c86', 0.42], ['#3f55c2', 0.3], ['#6f86e0', 0.14], ['#a9bbf2', 0.08], ['#f1f3fb', 0.06]];
const onNeptune = (d: Vector3, out: Vector3) => {
  const { a, b, c, n } = NEPTUNE;
  const k = Math.pow(Math.abs(d.x) ** n + Math.abs(d.y) ** n + Math.abs(d.z) ** n, 1 / n);
  return out.set((d.x / k) * a, (d.y / k) * b, (d.z / k) * c);
};
const NEPTUNE_CORE = (() => {
  const g = new SphereGeometry(1, 64, 32), p = g.attributes.position, v = new Vector3(), w = new Vector3();
  for (let i = 0; i < p.count; i++) {
    onNeptune(v.fromBufferAttribute(p, i), w);
    p.setXYZ(i, w.x, w.y, w.z);
  }
  g.computeVertexNormals();
  return g;
})();
const NEPTUNE_CORE_MATERIAL = new MeshPhysicalMaterial({ color: '#1c1f6a', roughness: 0.5 });
const NEPTUNE_BEAD_GEOMETRY = new SphereGeometry(1, 10, 8);
const NEPTUNE_BEAD_MATERIAL = new MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
NEPTUNE_BEAD_MATERIAL.onBeforeCompile = (sh) => {
  // Sugar beads scatter light, so they keep a little of their own colour on the shaded side.
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.2;');
};
function NonpareilDrop({ shadows }: { shadows: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    let seed = 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const m = new Matrix4(), q = new Quaternion(), at = new Vector3(), d = new Vector3(), n = new Vector3(), size = new Vector3(), c = new Color();
    const { a, b, c: cc, n: sq } = NEPTUNE;
    for (let i = 0; i < NEPTUNE_BEADS; i++) {
      const y = rnd() * 2 - 1, t = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
      onNeptune(d.set(Math.cos(t) * ring, y, Math.sin(t) * ring), at);
      // The surface's normal there, from the superquadric's slope.
      n.set(Math.sign(at.x) * Math.abs(at.x / a) ** (sq - 1) / a, Math.sign(at.y) * Math.abs(at.y / b) ** (sq - 1) / b, Math.sign(at.z) * Math.abs(at.z / cc) ** (sq - 1) / cc).normalize();
      const k = NEPTUNE_BEAD * (0.8 + rnd() * 0.45);
      at.addScaledVector(n, k * (0.35 + rnd() * 0.4)); // sitting in the jelly, some a little proud
      m.compose(at, q, size.setScalar(k));
      ref.current.setMatrixAt(i, m);
      let pick = rnd(), colour = NEPTUNE_COLOURS[0][0];
      for (const [hex, share] of NEPTUNE_COLOURS) {
        if ((pick -= share) <= 0) {
          colour = hex;
          break;
        }
      }
      ref.current.setColorAt(i, c.set(colour));
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, []);
  return (
    <>
      <mesh geometry={NEPTUNE_CORE} material={NEPTUNE_CORE_MATERIAL} receiveShadow={shadows} />
      <instancedMesh ref={ref} args={[NEPTUNE_BEAD_GEOMETRY, NEPTUNE_BEAD_MATERIAL, NEPTUNE_BEADS]} castShadow={shadows} receiveShadow={shadows} />
    </>
  );
}

export function PlanetCandy({ name, shadows = true, playful = false }: { name: string; shadows?: boolean; playful?: boolean }) {
  const c = CANDY[name];
  // Pattern seed: Earth came last, so the others keep the patterns they've always had.
  const others = PLANETS.filter((p) => p.name !== 'Earth');
  const index = name === 'Earth' ? others.length : others.findIndex((p) => p.name === name);
  const material = useMemo(() => candy(c, index * 17.3), [c, index]);
  const geometry = useMemo(() => lumpy(index + 1), [index]);
  if (name === 'Jupiter') return <AllsortSweet allsort={JUPITER_ROLL} size={JUPITER_RADIUS} seed={3} />;
  if (name === 'Mercury') return <ChocolateButton shadows={shadows} />;
  if (name === 'Neptune') return <NonpareilDrop shadows={shadows} />;
  // Mars is a chili sweet, the length of a bean, its moons little chilis too.
  if (name === 'Mars') return <Chili length={LENGTH * 1.05} radius={LENGTH * 0.2} colour="#c8141c" seed={0.4} shadows={shadows} />;
  if (name === 'Venus') return <mesh geometry={CARAMEL_GEOMETRY} material={CARAMEL_MATERIAL} castShadow={shadows} receiveShadow={shadows} />;
  if (name === 'Saturn')
    return (
      <>
        <mesh geometry={SATURN_GEOMETRY} material={GUMBALL} castShadow={shadows} receiveShadow={shadows} />
        {/* Its belt round its middle, tipped a little. */}
        <group rotation={[0, Math.PI / 2, 0.35]} scale={LENGTH}>
          <SaturnBelt shadows={shadows} playful={playful} />
        </group>
      </>
    );
  if (name === 'Uranus')
    return (
      <>
        <mesh geometry={URANUS_GEOMETRY} material={gumMaterial('Uranus', URANUS_GUM, URANUS_RADIUS, '#0b7f8a')} castShadow={shadows} receiveShadow={shadows} />
        <MoonDrops playful={playful} />
      </>
    );
  return (
    <>
      <mesh geometry={geometry} material={material} scale={LENGTH} castShadow={shadows} receiveShadow={shadows} />
      {name === 'Earth' && <mesh geometry={geometry} material={ATMOSPHERE} scale={LENGTH * 1.09} />}
      {c.ring && (
        // Saturn's ring round the bean's waist, tipped a little.
        <group rotation={[0, Math.PI / 2, 0.35]} scale={LENGTH}>
          <SaturnBelt shadows={shadows} playful={playful} />
        </group>
      )}
    </>
  );
}

function Bean({ planet, index }: { planet: Planet; index: number }) {
  const ref = useRef<RapierRigidBody>(null!);
  const pos = useMemo(() => new Vector3(), []);
  const turn = useRef({ roll: index * 1.3, tip: index * 0.7 });
  const dir = Math.sign(planet.day);

  useFrame((_, dt) => {
    const h = Math.min(dt, 1 / 30);
    planetAt(planet, clock.jd, pos).y -= DIG;
    // Lying along its orbit, rolling about its length and slowly rocking end over end.
    T.subVectors(planetAt(planet, clock.jd + 0.5, a), planetAt(planet, clock.jd - 0.5, b)).normalize();
    side.crossVectors(T, UP).normalize();
    up.crossVectors(side, T);
    turn.current.roll += h * ROLL * dir;
    turn.current.tip += h * TIP;
    // Its length along the orbit, its top up: a basis that turns smoothly all the way round, so the bean never flips.
    q.setFromRotationMatrix(basis.makeBasis(T, up, side));
    qa.setFromAxisAngle(T, turn.current.roll);
    q.premultiply(qa);
    qa.setFromAxisAngle(side, 0.35 * Math.sin(turn.current.tip));
    q.premultiply(qa);
    // Dynamic, steered: it moves at its orbital velocity plus a pull back towards where the orbit says it should
    // be, and turns towards its proper orientation. Collisions push beans off their tracks (other planets, falling
    // sweets); the steering brings them smoothly back.
    const rb = ref.current;
    if (!rb) return;
    const p = rb.translation();
    let mine = planetPositions.get(planet.name);
    if (!mine) planetPositions.set(planet.name, (mine = new Vector3()));
    mine.set(p.x, p.y, p.z);
    vel.subVectors(a, b).multiplyScalar(clock.paused ? 0 : clock.speed); // a and b are a day either side: units per day
    vel.x += (pos.x - p.x) * PULL;
    vel.y += (pos.y - p.y) * PULL;
    vel.z += (pos.z - p.z) * PULL;
    rb.setLinvel(vel, true);
    // Small angle rotation error, as an angular velocity towards the target.
    const r = rb.rotation();
    cur.set(r.x, r.y, r.z, r.w).invert().premultiply(q);
    const sign = cur.w < 0 ? -1 : 1;
    rb.setAngvel({ x: 2 * cur.x * sign * TURN, y: 2 * cur.y * sign * TURN, z: 2 * cur.z * sign * TURN }, true);
  });

  return (
    <RigidBody
      ref={ref}
      type="dynamic"
      gravityScale={0}
      canSleep={false}
      colliders={false}
      position={planetAt(planet, clock.jd).setY(-DIG)}
    >
      {planet.name === 'Neptune' ? (
        <BallCollider density={DENSITY} args={[NEPTUNE.a]} />
      ) : planet.name === 'Venus' ? (
        <CylinderCollider density={DENSITY} args={[CARAMEL.h, CARAMEL.r]} />
      ) : planet.name === 'Saturn' ? (
        // The gumball; the belt itself doesn't collide.
        <BallCollider density={DENSITY} args={[SATURN_RADIUS]} />
      ) : planet.name === 'Mercury' ? (
        // A flat capsule's worth along the button.
        <CapsuleCollider density={DENSITY} args={[MERCURY.a - MERCURY.c * 0.6, MERCURY.c * 0.6]} rotation={[0, 0, Math.PI / 2]} />
      ) : planet.name === 'Uranus' ? (
        // Round enough to cover the gum drops stuck on it too.
        <BallCollider density={DENSITY} args={[URANUS_REACH]} />
      ) : planet.name === 'Jupiter' ? (
        // A cylinder along the roll, which lies along the bean's x like the beans do.
        <CylinderCollider density={DENSITY} args={[JUPITER_LENGTH / 2, JUPITER_RADIUS]} rotation={[0, 0, Math.PI / 2]} />
      ) : (
        <CapsuleCollider
          density={DENSITY}
          args={[BEAN_CAPSULE.half * LENGTH, BEAN_CAPSULE.radius * LENGTH]}
          position={[0, BEAN_CAPSULE.lift * LENGTH, 0]}
          rotation={[0, 0, Math.PI / 2]}
        />
      )}
      {/* Tap a planet for its close up card. */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          pick(planet.name);
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <PlanetCandy name={planet.name} playful />
      </group>
    </RigidBody>
  );
}

// Every planet as a jelly bean, with their moons.
export function Beans() {
  return (
    <>
      {PLANETS.map((p, i) => (
        <Bean key={p.name} planet={p} index={i} />
      ))}
      <Moons />
      <Flings />
    </>
  );
}
