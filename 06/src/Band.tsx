import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, MeshPhysicalMaterial, Vector3 } from 'three';
import { clock } from './clock';
import { elementsAt, jdFromDate, position } from './kepler';
import { PLANETS } from './planets';

const EARTH = PLANETS.find((p) => p.name === 'Earth')!;
const YEAR = 365.256363; // sidereal year [days]: one lap of the orbit
const SAMPLES = 4096; // dense enough for the bulge to stay smooth
const R = 10; // scene units per au
const DAYS = 365; // one LED per day

// The band is Earth's orbit sampled by time, not by angle. Each LED sits where Earth really is on its day,
// slightly bunched up near aphelion in July.
const jd0 = jdFromDate(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
const lapOf = (jd: number) => (((jd - jd0) / YEAR) % 1 + 1) % 1;

const earthAt = (jd: number, out = new Vector3()) => position(elementsAt(EARTH.el, EARTH.rate, jd), out).multiplyScalar(R);

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
  uBalls: { value: [new Vector3(), new Vector3(), new Vector3()] },
  uBallScale: { value: new Vector3(1, 1, 1) },
};

// A jelly bean trapped in the tube at Earth's exact position: three soft balls tumbling round each other at a steady
// rate, the tube's wall wrapped round them like a skin. Each ball swells and shrinks out of step with the others, so
// the bean bulges up, down, sideways, ahead and behind as they roll. They are also the coloured cores its light comes
// from. MOTION springs towards 1 while time runs and 0 when paused, overshooting: the balls huddle when the bean
// stops and spread out when it goes, with a jiggle either way.
const motion = { x: 0, v: 0, phase: 0, colour: 0 };
// Wobble rate in rad/s: a slow idle plus a part that follows how fast the bean travels down the tube (scene units/s).
const WOBBLE_IDLE = 3;
const WOBBLE_PER_SPEED = 3;
const BALL_RADIUS = 0.3; // at its mean size
const BALL_SCALE = 0.3; // each ball swells and shrinks by this much around its mean size, out of step
const BALL_ORBIT = new Vector3(0.35, 0.12, 0.07); // half extents of the tumble: along, across, up
const BALL_SPIN = 0.5; // tumble rate relative to the wobble rate
const SKIN = 0.14; // how softly the wall blends from ball to ball and into the bare tube, like metaballs
// Each ball also swells the tube around it, a soft skirt reaching SKIRT_REACH ball radii, SKIRT_LIFT radii high,
// so the tube flares gradually into the bean instead of meeting it at a neck.
const SKIRT_REACH = 2.6;
const SKIRT_LIFT = 0.45;

const bulge = /* glsl */ `
  attribute float along;
  attribute vec3 section;
  uniform vec3 uBalls[3];
  uniform vec3 uBallScale;
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
  uniform vec3 uLedA, uLedB, uGreen, uBlue, uBean, uBeanT;
  uniform vec3 uBalls[3];
  uniform vec3 uBallScale;
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

  // The balls glow: one green, one blue, one in between, the green and blue ones swelling in turn.
  vec3 cores() {
    float w = greenAt(uColourPhase);
    float rG = mix(0.07, 0.25, w) * uBallScale.x, rB = mix(0.07, 0.25, 1.0 - w) * uBallScale.y;
    return uGreen * exp(-distance(vWorld, uBalls[0]) / rG)
      + uBlue * exp(-distance(vWorld, uBalls[1]) / rB)
      + mix(uBlue, uGreen, 0.5) * 0.6 * exp(-distance(vWorld, uBalls[2]) / (0.12 * uBallScale.z));
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
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `${bulge}
void main() {
  vAlong = along;
  // Each vertex moves along its own section direction. For each ball: how far out the wall must go to sit on the
  // ball's surface. Where that line misses the ball it carries on smoothly below its closest approach, so nothing
  // snaps at the ball's edge. A smooth max of those and the bare tube melts balls and tube into one soft skin; the
  // softmax weights also blend the normals.
  vec3 centre = position - section;
  vec3 outward = normalize(section);
  float bare = length(section);
  float K = ${SKIN.toFixed(3)};
  for (int i = 0; i < 3; i++) {
    float R = ${BALL_RADIUS.toFixed(3)} * uBallScale[i];
    float x = distance(centre, uBalls[i]) / (R * ${SKIRT_REACH.toFixed(2)});
    float f = max(0.0, 1.0 - x * x);
    bare += R * ${SKIRT_LIFT.toFixed(2)} * f * f * f; // Wyvill falloff: smooth, and exactly zero past its reach
  }
  vec3 wts = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 v = centre - uBalls[i];
    float R = ${BALL_RADIUS.toFixed(3)} * uBallScale[i];
    float b = dot(v, outward);
    float disc = b * b - (dot(v, v) - R * R);
    float t = -b + sign(disc) * sqrt(abs(disc));
    // Only near the ball: further off, the line could cross the ring's middle and reach it from the far side.
    float near = smoothstep(4.0 * R, 2.0 * R, length(v));
    wts[i] = near * exp(clamp((t - bare) / K, -30.0, 30.0));
  }
  float total = 1.0 + wts.x + wts.y + wts.z;
  vec3 wall = centre + outward * (bare + K * log(total));`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  objectNormal = normalize(objectNormal + wts.x * normalize(wall - uBalls[0]) + wts.y * normalize(wall - uBalls[1])
    + wts.z * normalize(wall - uBalls[2]));`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = wall;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `${sss}\nvoid main() {`).replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
  float thick = 1.0 + 0.8 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  vec3 colour = trailColour();
  vec3 lit = mix(scatter(uLedA, uLapA, colour), scatter(uLedB, uLapB, colour), uMixB);
  totalEmissiveRadiance += uPower * thick * (lit + 0.8 * cores());`,
    );
  };
  return m;
}

const tmp = new Vector3(), tmp2 = new Vector3();
const UP = new Vector3(0, 1, 0), side = new Vector3(), local = new Vector3();

// Three balls on a triangle round the bean's middle. The triangle spins in its plane while that plane slowly turns
// over about two other axes, so the balls reach every side of the bean; each also bobs in and out a little.
function tumble(centre: Vector3, T: Vector3, a: number, spread: number, out: Vector3[]) {
  side.crossVectors(T, UP).normalize();
  const tilt = a * 0.43, roll = a * 0.29;
  out.forEach((b, i) => {
    const t = a + (i * Math.PI * 2) / 3;
    const r = spread * (1 + 0.35 * Math.sin(a * 1.7 + i * 2.1));
    local.set(Math.cos(t) * r, Math.sin(t) * r, 0);
    // Turn the triangle's plane: about the along axis, then about the across axis.
    let { x, y, z } = local;
    [y, z] = [y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)];
    [x, z] = [x * Math.cos(roll) + z * Math.sin(roll), -x * Math.sin(roll) + z * Math.cos(roll)];
    b.copy(centre)
      .addScaledVector(T, x * BALL_ORBIT.x)
      .addScaledVector(side, y * BALL_ORBIT.y)
      .addScaledVector(UP, z * BALL_ORBIT.z);
  });
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
    const spin = motion.phase * BALL_SPIN;
    tumble(uniforms.uBean.value, T, spin, 0.75 + 0.25 * motion.x, uniforms.uBalls.value);
    // Each ball breathes at its own pace, so the three never swell together.
    uniforms.uBallScale.value.set(
      1 + BALL_SCALE * Math.sin(spin * 2.3),
      1 + BALL_SCALE * Math.sin(spin * 1.9 + 2.1),
      1 + BALL_SCALE * Math.sin(spin * 2.7 + 4.2),
    );
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
