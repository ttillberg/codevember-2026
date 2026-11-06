import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, MeshPhysicalMaterial, Quaternion, Vector3 } from 'three';
import { clock } from './clock';
import { jdFromDate } from './kepler';
import { PLANETS } from './planets';
import { planetAt } from './scale';

const EARTH = PLANETS.find((p) => p.name === 'Earth')!;
const YEAR = 365.256363; // sidereal year [days]: one lap of the orbit
const SAMPLES = 4096; // dense enough for the bulge to stay smooth
const DAYS = 365; // one LED per day

// The band is Earth's orbit sampled by time, not by angle. Each LED sits where Earth really is on its day,
// slightly bunched up near aphelion in July.
const jd0 = jdFromDate(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
const lapOf = (jd: number) => (((jd - jd0) / YEAR) % 1 + 1) % 1;

const earthAt = (jd: number, out = new Vector3()) => planetAt(EARTH, jd, out);

function orbitByTime() {
  const pts: Vector3[] = [];
  for (let i = 0; i <= SAMPLES; i++) pts.push(earthAt(jd0 + (i / SAMPLES) * YEAR));
  pts[SAMPLES].copy(pts[0]); // exact seam
  return pts;
}

// Sweep a cross-section along a flat closed path. The profile lives in (radial, up), with its own normals.
// Rings are duplicated at the seam so u runs cleanly from 0 to 1. Each vertex also keeps its offset from the
// centre line, so the vertex shader can swell the section anywhere along the tube.
type Profile = { p: [number, number]; n: [number, number] }[];
function sweep(path: Vector3[], profile: Profile, closedProfile: boolean) {
  const rings = path.length, m = profile.length;
  const n3 = rings * m * 3;
  const pos = new Float32Array(n3), nor = new Float32Array(n3), off = new Float32Array(n3);
  const uv = new Float32Array(rings * m * 2);
  const radial = new Vector3();
  path.forEach((c, i) => {
    radial.set(c.x, 0, c.z).normalize();
    profile.forEach(({ p, n }, j) => {
      const k = i * m + j;
      off.set([radial.x * p[0], p[1], radial.z * p[0]], k * 3);
      pos.set([c.x + off[k * 3], c.y + off[k * 3 + 1], c.z + off[k * 3 + 2]], k * 3);
      const nl = Math.hypot(n[0], n[1]) || 1;
      nor.set([(radial.x * n[0]) / nl, n[1] / nl, (radial.z * n[0]) / nl], k * 3);
      uv.set([i / (rings - 1), m > 1 ? (j / (m - 1)) * 2 - 1 : 0], k * 2);
    });
  });
  const idx: number[] = [];
  const cols = closedProfile ? m : m - 1;
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, d = b + m;
      idx.push(a, c, b, b, c, d);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('along', new BufferAttribute(uv.filter((_, i) => i % 2 === 0), 1)); // lap fraction
  g.setAttribute('section', new BufferAttribute(off, 3));
  g.setIndex(idx);
  return g;
}

// Rounded rectangle as a superellipse, half-width w (radial), half-height h, exponent e.
function superellipse(w: number, h: number, e = 6, n = 48): Profile {
  const out: Profile = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const pc = Math.sign(c) * Math.pow(Math.abs(c), 2 / e), ps = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    const nc = Math.sign(c) * Math.pow(Math.abs(c), 2 - 2 / e), ns = Math.sign(s) * Math.pow(Math.abs(s), 2 - 2 / e);
    out.push({ p: [w * pc, h * ps], n: [nc / w, ns / h] });
  }
  return out;
}

const BAND_HALF_WIDTH = 0.05; // radial
const BAND_HALF_HEIGHT = 0.019;
const REACH = 16; // scene units along the tube where the guided light is cut to nothing: a quarter lap each way, half the ring
const POWER = 14;
const GREEN = new Color('#5dffa0');
const BLUE = new Color('#3a7bff');

// LED k sits at the middle of day k of the lap.
const LEDS = Array.from({ length: DAYS }, (_, k) => earthAt(jd0 + ((k + 0.5) / DAYS) * YEAR));
const ledLap = (k: number) => (k + 0.5) / DAYS;
const PERIMETER = LEDS.reduce((s, p, k) => s + p.distanceTo(LEDS[(k + 1) % DAYS]), 0);

const uniforms = {
  uLedA: { value: new Vector3() },
  uLedB: { value: new Vector3() },
  uLapA: { value: 0 },
  uLapB: { value: 0 },
  uPerim: { value: PERIMETER },
  uMixB: { value: 0 },
  uGreen: { value: GREEN },
  uBlue: { value: BLUE },
  uBean: { value: new Vector3() },
  uBeanT: { value: new Vector3(1, 0, 0) },
  uPhasePerUnit: { value: 0.5 },
  uColourPhase: { value: 0 },
  uTime: { value: 0 },
  uPower: { value: POWER },
  uReach: { value: REACH },
  uBulgeLap: { value: 0 },
  uMotion: { value: 0 },
  uPhase: { value: 0 },
  uBeanX: { value: new Vector3(1, 0, 0) },
  uBeanY: { value: new Vector3(0, 1, 0) },
  uBeanZ: { value: new Vector3(0, 0, 1) },
  uBeanShape: { value: new Vector3() }, // arc radius, arc half angle, thickness
  uCoreG: { value: new Vector3() },
  uCoreB: { value: new Vector3() },
};

// A jelly bean trapped in the tube at Earth's exact position, the tube's wall wrapped round it like a skin. The bean
// is a bent capsule, a little thinner at the ends. It rolls about its own length at a steady rate and rocks a little,
// so its curve faces every way in turn, and it squishes softly as it goes. A green core sits in one end, a blue one
// in the other. MOTION springs towards 1 while time runs and 0 when paused, overshooting: the bean settles when it
// stops and rocks again when it goes, with a jiggle either way.
const motion = { x: 0, v: 0, phase: 0, colour: 0 };
// Wobble rate in rad/s: a slow idle plus a part that follows how fast the bean travels down the tube (scene units/s).
const WOBBLE_IDLE = 3;
const WOBBLE_PER_SPEED = 3;
const BEAN_RADIUS = 0.22; // thickness, half
const BEAN_BEND = 0.55; // radius of the arc its spine follows: smaller is more curved
const BEAN_SPAN = 0.6; // half the angle of that arc: with the radius, sets its length
const BEAN_SQUISH = 0.08; // how much fatter and shorter, then thinner and longer, it gets as it rolls
const BEAN_ROLL = 0.5; // roll rate relative to the wobble rate
const SKIN = 0.1; // how softly the wall blends from the bean into the bare tube
// The bean also swells the tube around it, a soft skirt reaching SKIRT_REACH bean radii, SKIRT_LIFT radii high,
// so the tube flares gradually into the bean instead of meeting it at a neck.
const SKIRT_REACH = 2.6;
const SKIRT_LIFT = 0.45;

// Signed distance to the bean, shared by both shaders. The spine is an arc through the bean's centre, bending
// towards -Y at the ends; the bean is that arc thickened, tapering a little towards the ends.
const beanSdf = /* glsl */ `
  uniform vec3 uBean, uBeanX, uBeanY, uBeanZ, uBeanShape;
  float beanSdf(vec3 p) {
    vec3 q = p - uBean;
    vec3 l = vec3(dot(q, uBeanX), dot(q, uBeanY), dot(q, uBeanZ));
    float Rc = uBeanShape.x, T = uBeanShape.y;
    vec2 c = vec2(0.0, -Rc);
    vec2 d = l.xy - c;
    float a = clamp(atan(d.x, d.y), -T, T);
    vec2 spine = c + Rc * vec2(sin(a), cos(a));
    float r = uBeanShape.z * (1.0 - 0.12 * (a / T) * (a / T));
    return length(vec3(l.xy - spine, l.z)) - r;
  }
`;

const bulge = /* glsl */ `
  attribute float along;
  attribute vec3 section;
  varying float vBean;
  varying vec3 vBeanLocal;
  varying vec3 vWorld;
  varying float vAlong;
`;

// Dark smoked acrylic, barely there until lit from inside by the LED buried in it. Faked subsurface scattering:
// a white hot spot right on the LED that dies within a few millimetres, then the tube guides what is left a long way,
// a fast falloff followed by a long faint one. The further the light travels, the more of its weaker channels it
// loses, so the tail deepens to its pure colour. Grazing views look through more material, so the edges glow more.
//
// The bean holds two little cores, green and blue like the planet, swelling in turn as it wobbles, so its light
// swings between the two. The trail behind keeps those colours and slowly mixes them, see trailColour.
const sss = /* glsl */ `
  uniform vec3 uLedA, uLedB, uGreen, uBlue, uBeanT, uCoreG, uCoreB;
  varying float vBean;
  varying vec3 vBeanLocal;
  uniform float uLapA, uLapB, uPerim, uMixB, uPower, uReach, uBulgeLap, uPhase, uColourPhase, uPhasePerUnit, uMotion, uTime;
  varying vec3 vWorld;
  varying float vAlong;

  // Value noise and a few octaves of it, for the smoke.
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

  // 0 is all blue, 1 all green.
  float greenAt(float phase) { return 0.5 + 0.5 * sin(phase); }

  // Colour along the tube. The bean itself, nose to tail, is one colour, swinging between green and blue with its
  // wobble. Behind it the tube keeps the colour the bean had when it passed, so the wobble is laid down as bands; the
  // bands then diffuse like dye in the liquid, stirred into smoky wisps and fading towards an even blue green mix the
  // older they get. Ahead of the bean, its current colour.
  vec3 trailColour() {
    float s = (fract(vAlong - uBulgeLap + 0.5) - 0.5) * uPerim;
    float age = smoothstep(0.0, uReach, -s);
    float behind = smoothstep(0.5, 1.2, -s); // past the bean's own back
    // Tube coordinates for the wisps: drawn out along the flow, fine across the section.
    vec3 q = vec3(vAlong * uPerim * 2.0, length(vWorld.xz) * 28.0, vWorld.y * 28.0);
    q += vec3(uTime * 0.25, uTime * 0.6, uTime * 0.45);
    vec3 warp = vec3(fbm(q), fbm(q + 11.3), 0.0);
    float wisp = (fbm(q + warp * 1.6) - 0.5) * mix(0.4, 3.0, age);
    // A diffusing sine band loses contrast exponentially with time, here with distance travelled since.
    float contrast = exp(s < 0.0 ? s / 5.0 : 0.0);
    float recorded = 0.5 + 0.5 * sin(uColourPhase + min(s, 0.0) * uPhasePerUnit + wisp) * contrast;
    float w = mix(greenAt(uColourPhase), recorded, behind);
    return mix(uBlue, uGreen, w);
  }

  // The bean's candy shell: a speckled Earth, ocean blue with green continents and white flecks of cloud and ice.
  // Painted in the bean's own frame, so it rolls with it.
  vec3 candy() {
    vec3 p = vBeanLocal * 5.0;
    float land = smoothstep(0.5, 0.56, fbm(p + fbm(p * 1.7) * 0.8));
    float fleck = smoothstep(0.78, 0.82, noise(vBeanLocal * 26.0)) * 0.9;
    vec3 c = mix(vec3(0.05, 0.22, 0.75), vec3(0.12, 0.55, 0.2), land);
    return mix(c, vec3(0.95, 0.97, 1.0), fleck);
  }

  // The two cores glow, one in each end of the bean, swelling in turn.
  vec3 cores() {
    float w = greenAt(uColourPhase);
    float rG = mix(0.08, 0.3, w), rB = mix(0.08, 0.3, 1.0 - w);
    return uGreen * exp(-distance(vWorld, uCoreG) / rG) + uBlue * exp(-distance(vWorld, uCoreB) / rB);
  }

  vec3 scatter(vec3 led, float lap, vec3 colour) {
    float d = distance(vWorld, led);
    float a = abs(fract(vAlong - lap + 0.5) - 0.5) * uPerim; // distance along the tube
    vec3 core = vec3(3.0) * exp(-d / 0.03) + colour * exp(-d / 0.12);
    vec3 tint = pow(colour, vec3(1.0 + a * 0.15));
    vec3 tail = tint * (0.6 * exp(-a / 0.3) + 0.045 * exp(-a / 14.0));
    return (core + tail) * (1.0 - smoothstep(uReach * 0.6, uReach, a));
  }
`;

function acrylic() {
  const m = new MeshPhysicalMaterial({
    color: '#2a2e32',
    roughness: 0.55,
    envMapIntensity: 0.15,
    clearcoat: 1, // switched on per fragment: only the bean has the candy's glaze
    clearcoatRoughness: 0.06,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `${bulge}
${beanSdf}
void main() {
  vAlong = along;
  // Each vertex moves along its own section direction, out to where that line leaves the bean, found by sphere
  // tracing in from outside. Where the line misses, the march stops at its closest approach and carries on smoothly
  // below it, so nothing snaps at the bean's edge. A smooth max of that and the bare tube melts them into one skin.
  vec3 centre = position - section;
  vec3 outward = normalize(section);
  float bare = length(section);
  float K = ${SKIN.toFixed(3)};
  float R = uBeanShape.z;
  float w = 0.0;
  vec3 wall = position;
  float far = distance(centre, uBean);
  if (far < 1.6) {
    float x = max(beanSdf(centre), 0.0) / (R * ${SKIRT_REACH.toFixed(2)});
    float f = max(0.0, 1.0 - x * x);
    bare += R * ${SKIRT_LIFT.toFixed(2)} * f * f * f; // Wyvill falloff: smooth, and exactly zero past its reach
    float t = 0.8, d = 1e3, prev = 1e3;
    for (int i = 0; i < 24; i++) {
      d = beanSdf(centre + outward * t);
      if (d < 0.001 || d > prev) break;
      prev = d;
      t -= d;
    }
    float hit = t - 3.0 * max(d, 0.0);
    // Only near the bean, so the line can't reach it from across the ring.
    w = smoothstep(1.6, 1.0, far) * exp(clamp((hit - bare) / K, -30.0, 30.0));
    wall = centre + outward * (bare + K * log(1.0 + w));
  }
  vBean = w / (1.0 + w);
  vec3 bq = wall - uBean;
  vBeanLocal = vec3(dot(bq, uBeanX), dot(bq, uBeanY), dot(bq, uBeanZ));`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  if (w > 0.0) {
    // The bean's own normal from its distance field, blended in by its weight in the smooth max.
    vec2 e = vec2(0.004, 0.0);
    vec3 g = vec3(
      beanSdf(wall + e.xyy) - beanSdf(wall - e.xyy),
      beanSdf(wall + e.yxy) - beanSdf(wall - e.yxy),
      beanSdf(wall + e.yyx) - beanSdf(wall - e.yyx));
    objectNormal = normalize(objectNormal + w * normalize(g));
  }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = wall;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${sss}\nvoid main() {`)
      // The bean is candy: its own colour, a smoother waxy surface under a hard glaze, and the studio reflected
      // much more brightly in it than in the dark tube.
      .replace('#include <color_fragment>', '#include <color_fragment>\n  vec3 candyColour = candy();\n  diffuseColor.rgb = mix(diffuseColor.rgb, candyColour, vBean);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.35, vBean);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat = vBean;')
      .replace(
        '#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n  iblIrradiance *= mix(1.0, 5.0, vBean);\n  radiance *= mix(1.0, 6.0, vBean);\n  clearcoatRadiance *= mix(1.0, 8.0, vBean);',
      )
      .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
  float thick = 1.0 + 0.8 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  vec3 colour = trailColour();
  vec3 lit = mix(scatter(uLedA, uLapA, colour), scatter(uLedB, uLapB, colour), uMixB);
  // The candy is lit from inside but stays candy: the LED's light comes through it as a soft glow in its own colour,
  // a little stronger at the thin grazing edges, instead of the white hot core the bare tube shows.
  vec3 tubeGlow = uPower * thick * (lit + 0.8 * cores());
  vec3 beanGlow = candyColour * (0.25 + 0.6 * thick) * (0.5 + 0.08 * length(lit));
  totalEmissiveRadiance += mix(tubeGlow, beanGlow, vBean);`,
    );
  };
  return m;
}

const tmp = new Vector3(), tmp2 = new Vector3();
const UP = new Vector3(0, 1, 0), side = new Vector3(), qa = new Quaternion(), qb = new Quaternion();

// The bean's pose: lying along the tube, its curve first lying flat, rolled about the tube by a, then rocked a little
// about the vertical and the across axes. Writes the bean's axes, and its two ends where the cores sit.
function pose(T: Vector3, a: number, rock: number) {
  side.crossVectors(T, UP).normalize();
  qa.setFromAxisAngle(T, a);
  qb.setFromAxisAngle(UP, rock * 0.3 * Math.sin(a * 1.21));
  qa.premultiply(qb);
  qb.setFromAxisAngle(side, rock * 0.2 * Math.sin(a * 0.87 + 1));
  qa.premultiply(qb);
  const X = uniforms.uBeanX.value.copy(T).applyQuaternion(qa);
  const Y = uniforms.uBeanY.value.copy(side).applyQuaternion(qa);
  uniforms.uBeanZ.value.crossVectors(X, Y);
  const squish = BEAN_SQUISH * rock * Math.sin(a * 1.7);
  const Rc = BEAN_BEND, span = BEAN_SPAN * (1 - squish);
  uniforms.uBeanShape.value.set(Rc, span, BEAN_RADIUS * (1 + squish));
  // Cores most of the way out along the spine.
  const end = span * 0.75, sx = Rc * Math.sin(end), sy = Rc * (Math.cos(end) - 1);
  const C = uniforms.uBean.value;
  uniforms.uCoreG.value.copy(C).addScaledVector(X, sx).addScaledVector(Y, sy);
  uniforms.uCoreB.value.copy(C).addScaledVector(X, -sx).addScaledVector(Y, sy);
}

export function Band() {
  const { band, mat } = useMemo(
    () => ({ band: sweep(orbitByTime(), superellipse(BAND_HALF_WIDTH, BAND_HALF_HEIGHT), true), mat: acrylic() }),
    [],
  );

  // Today's LED crossfades into tomorrow's over the day. The bulge follows Earth continuously.
  useFrame((_, dt) => {
    uniforms.uBulgeLap.value = lapOf(clock.jd);
    // Underdamped spring: about two visible jiggles before it settles.
    const h = Math.min(dt, 1 / 30);
    motion.v += ((clock.paused ? 0 : 1) - motion.x) * 120 * h - motion.v * 5 * h;
    motion.x += motion.v * h;
    uniforms.uMotion.value = motion.x;
    const speed = clock.paused ? 0 : (clock.speed / YEAR) * PERIMETER;
    const rate = WOBBLE_IDLE + WOBBLE_PER_SPEED * speed;
    motion.phase += h * rate;
    uniforms.uPhase.value = motion.phase;
    // The colour swings with the wobble, but only while the bean travels, so the bands it lays down stay put.
    // Phase per unit of tube travelled lets the trail replay it; kept as is while paused.
    if (speed > 0.05) {
      uniforms.uPhasePerUnit.value = rate / speed;
      motion.colour += h * rate;
    }
    uniforms.uColourPhase.value = motion.colour;
    uniforms.uTime.value += h;
    earthAt(clock.jd, uniforms.uBean.value);
    const T = uniforms.uBeanT.value.subVectors(earthAt(clock.jd + 0.5, tmp), earthAt(clock.jd - 0.5, tmp2)).normalize();
    pose(T, motion.phase * BEAN_ROLL, 0.4 + 0.6 * motion.x);
    const t = lapOf(clock.jd) * DAYS - 0.5;
    const i = Math.floor(t);
    const a = ((i % DAYS) + DAYS) % DAYS, b = (a + 1) % DAYS;
    uniforms.uLedA.value.copy(LEDS[a]);
    uniforms.uLedB.value.copy(LEDS[b]);
    uniforms.uLapA.value = ledLap(a);
    uniforms.uLapB.value = ledLap(b);
    uniforms.uMixB.value = t - i;
  });

  return <mesh geometry={band} material={mat} />;
}
