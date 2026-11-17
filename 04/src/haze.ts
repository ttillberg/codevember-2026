// The air the place sits in: its colour behind everything, and what comes through it over a day in autumn.
import { place } from './net';
import { Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, Uniform, Vector2, Vector3, type Material } from 'three';

/** The sky behind everything, by day. */
export const HAZE = 0xa3adb3;

/** How much of the night is here: 0 by day, 1 in the dark. One number, read by every lamp, sign, window and headlight. */
export const NIGHT = new Uniform(0);
/** The hour of the day, 0 to 24, for whoever keeps hours: the children, the players. */
export const HOUR = new Uniform(12);
/** How dark it really is: later than the lamps come on, and gone sooner. What the place takes of its own light goes by this, since in half light the map of it shows its edges. */
export const DARK = new Uniform(0);
/** How far the town has gone to bed: 0 in the evening, 1 from half past one, and back to 0 as it gets up before seven. A room with a bedtime under this is dark. */
export const LATE = new Uniform(0);
/** Whether the floodlights of the pitch are on: from the afternoon until eleven at night, and not again before the next day. */
export const FLOOD = new Uniform(1);
/**
 * The light of the place itself at night, as a map of the ground seen from above: where the lamps stand and the houses are lit
 * it is bright, and everything near takes some of that light, walls and trees as well as the ground. Not a light: a picture
 * of where light is, baked whenever the lamps move, and read by every material that asks.
 */
// over four tiles the same map lies over all of them, with as many more texels
const GLOW_SIZE = place.on ? 512 : 256, GLOW_SPAN = place.on ? 2 * place.half : 1200;
/** Where the middle of the map lies: it is baked over the window of tiles as it is then. */
const GLOW_MID = new Uniform(new Vector2(place.x, place.y));
const glowData = new Uint16Array(GLOW_SIZE * GLOW_SIZE * 4);
const glowMap = new DataTexture(glowData, GLOW_SIZE, GLOW_SIZE, RGBAFormat, HalfFloatType);
glowMap.minFilter = glowMap.magFilter = LinearFilter;
export const GLOW = new Uniform(glowMap);

/** What the lamps of the streets are tinted by, and all the light they leave on the place: set by `lampWarmth`. */
export const LAMPS = new Uniform(new Vector3(1, 1, 1));
/** How warm the street lights are: 0 as they are, sodium; up to 1 deeper and redder, down to -1 towards white. */
export function lampWarmth(w: number) {
  const c = Math.max(0, -w);
  w = Math.max(0, w);
  LAMPS.value.set(1 - 0.3 * c, 1 - 0.35 * w + 0.25 * c, 1 - 0.7 * w + 2.5 * c);
}

/** A lamp or a lit house for the map: where, how far its light reaches in metres, and its colour and strength. */
export interface Spot { x: number; z: number; r: number; c: [number, number, number] }

// the lights of every tile of the grid, by tile: the one map is baked of all of them, once, after any of them changed
const lit = new Map<string, Spot[]>();
let baking = 0;
/** These are the lights of this tile now; null when the tile is gone. */
export function glowOf(key: string, spots: Spot[] | null) {
  if (spots) lit.set(key, spots); else lit.delete(key);
  if (typeof requestAnimationFrame === 'undefined') return bakeGlow([...lit.values()].flat());
  cancelAnimationFrame(baking);
  baking = requestAnimationFrame(() => bakeGlow([...lit.values()].flat()));
}

function bakeGlow(spots: Spot[]) {
  const acc = new Float32Array(GLOW_SIZE * GLOW_SIZE * 3), px = GLOW_SIZE / GLOW_SPAN, GX = place.x, GZ = place.y;
  GLOW_MID.value.set(GX, GZ);
  for (const s of spots) {
    const cx = ((s.x - GX) / GLOW_SPAN + 0.5) * GLOW_SIZE, cy = ((s.z - GZ) / GLOW_SPAN + 0.5) * GLOW_SIZE, r = s.r * px;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(GLOW_SIZE - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(GLOW_SIZE - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d >= 1) continue;
        // bright under the lamp, and a long soft skirt
        const k = (1 - d) * (1 - d), i = (y * GLOW_SIZE + x) * 3;
        acc[i] += s.c[0] * k; acc[i + 1] += s.c[1] * k; acc[i + 2] += s.c[2] * k;
      }
    }
  }
  for (let i = 0, n = GLOW_SIZE * GLOW_SIZE; i < n; i++) {
    // many lamps close together do not add up for ever
    for (let k = 0; k < 3; k++) glowData[i * 4 + k] = DataUtils.toHalfFloat(1 - Math.exp(-acc[i * 3 + k]));
    glowData[i * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  glowMap.needsUpdate = true;
}

/** Let a material take the light of the place at night: what it shows of its own colour where the map is bright. */
/**
 * `sided`: only the side that faces where the light comes from takes it, as a tree by a road is lit on its road side and
 * dark behind. Where the light is, is read off the map itself: it comes from where the map gets brighter.
 * `aloft`: it carries its own lamps wherever it is, as a bridge deck does, so its height does not matter.
 */
export function glowing<T extends Material>(m: T, much = 1, sided = false, aloft = false): T {
  if (m.userData.glow) return m;
  m.userData.glow = true;
  const before = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (s, r) => {
    before.call(m, s, r);
    s.uniforms.uGlow = GLOW;
    s.uniforms.uGlowMid = GLOW_MID;
    s.uniforms.uGlowNight = DARK;
    s.uniforms.uLamps = LAMPS;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlowAt;')
      .replace('#include <project_vertex>', `{ vec4 gw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gw = instanceMatrix * gw;
        #endif
        vGlowAt = (modelMatrix * gw).xyz; }
        #include <project_vertex>`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGlow; uniform vec2 uGlowMid; uniform float uGlowNight; uniform vec3 uLamps; varying vec3 vGlowAt;')
      // the lamps hang low and shine down: the foot of a wall takes their light, what is above them takes none,
      // and a roof stays dark however bright the car park beside it
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 gu = (vGlowAt.xz - uGlowMid) / ${GLOW_SPAN.toFixed(1)} + 0.5;
          float turned = 1.0;
          ${sided ? `
          // which way the light lies: uphill on the map, two texels either side
          float ge = ${(2 / GLOW_SIZE).toFixed(6)};
          vec2 up = vec2(texture2D(uGlow, gu + vec2(ge, 0.0)).g - texture2D(uGlow, gu - vec2(ge, 0.0)).g, texture2D(uGlow, gu + vec2(0.0, ge)).g - texture2D(uGlow, gu - vec2(0.0, ge)).g);
          vec3 nw = inverseTransformDirection(normal, viewMatrix);
          float flat_ = length(nw.xz), steep = length(up);
          float facing = clamp(dot(nw.xz / max(flat_, 1e-4), up / max(steep, 1e-5)) * 0.75 + 0.25, 0.0, 1.0);
          // a face that looks up takes little; where the light is all round, every side takes some
          turned = mix(0.18, mix(0.5, facing, smoothstep(0.004, 0.03, steep)), flat_);` : ''}
          totalEmissiveRadiance += diffuseColor.rgb * texture2D(uGlow, gu).rgb * uLamps * (turned * uGlowNight * ${much.toFixed(3)}${aloft ? '' : ' * (1.0 - smoothstep(2.5, 9.0, vGlowAt.y))'});
        }`);
  };
  m.customProgramCacheKey = () => key.call(m) + 'glow' + much + (sided ? 'sided' : '') + (aloft ? 'aloft' : '');
  return m;
}

/** Seconds of our own time, for whatever blinks: the lamps of an emergency vehicle, the lamps at road works. */
export const NOW = new Uniform(0);
/** What the hour does to the grade: the balance of the colours, and how much more of them there is in low sun. */
export const MOOD = new Uniform(new Vector3(1, 1, 1));
export const RICH = new Uniform(0);

/** Autumn: the sun is up at seven and down at five, and at noon it is still low. Hours, and degrees over the horizon. */
export const RISE = 7, SET = 17;
const NOON = 36, DEEP = 40;
/** The light never comes in flatter than this, or a house would shade the whole town: under it the sun only fades. */
const GRAZE = 10;
/** The night goes by this much faster than the day: there is less to see in it. */
const HURRY = 3;

const RAD = Math.PI / 180;
const step = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Degrees the sun stands over the horizon at this hour, or under it. */
export function sunAt(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return h >= RISE && h < SET
    ? NOON * Math.sin((Math.PI * (h - RISE)) / (SET - RISE))
    : -DEEP * Math.sin((Math.PI * ((h - SET + 24) % 24)) / (24 - SET + RISE));
}

/** The lamps come on as the sun touches the roofs and the dark is whole a little after it has gone. */
const nightAt = (el: number) => 1 - step(-6, 2, el);

/** How much the lights are on: people do not wait for the dark, they switch on while the sun is still a hand above the horizon. */
const litAt = (el: number) => 1 - step(-2, 9, el);

/** How much of the low, warm light there is: most just over the horizon, gone when the sun is well up or well down. */
const goldAt = (el: number) => step(-4, 3, el) * (1 - step(9, 28, el));

// how long an hour lasts next to the others: a night hour is a third of a day hour, and the low sun is given half as long again
const weight = (hour: number) => {
  const el = sunAt(hour);
  return (1 - (1 - 1 / HURRY) * nightAt(el)) * (1 + 0.5 * goldAt(el));
};
const MEAN = Array.from({ length: 480 }, (_, i) => weight(i / 20)).reduce((a, b) => a + b, 0) / 480;

/** Hours that pass in a second of ours at this hour, when a whole day takes `day` seconds. */
export const hoursPerSecond = (hour: number, day: number) => (24 * MEAN) / (day * weight(hour));

const hex = (h: number) => new Color(h);
// the sun: orange on the horizon, nearly white when it is up; and the moon
const LOW = new Color(1, 0.46, 0.17), HIGH = new Color(1, 0.95, 0.87), MOON = new Color(0.62, 0.68, 0.82);
// the light of the sky itself, from above and from the ground: always cooler than the sun, and blue once it is gone
const AIR = { day: hex(0xbcd4ff), low: hex(0xa4b4ee), night: hex(0x0d0f14) };
const EARTH = { day: hex(0x6b6a52), night: hex(0x060708) };
// the haze behind everything
const BACK = { day: hex(HAZE), gold: hex(0xc9a48a), dusk: hex(0x6a6382), night: hex(0x020203) };

/** Everything the hour decides. One of these is kept and written over every frame. */
export interface Sky {
  /** where the light comes from: radians west of south, and radians up */
  phi: number; el: number;
  sun: Color; power: number;
  air: Color; earth: Color; fill: number;
  back: Color;
  night: number;
}
export const SKY: Sky = { phi: 0, el: 1, sun: new Color(), power: 0, air: new Color(), earth: new Color(), fill: 0, back: new Color(), night: 0 };

/** What the hour does to the light. Also sets NIGHT, MOOD and RICH. */
export function skyAt(hour: number, out = SKY): Sky {
  const h = ((hour % 24) + 24) % 24;
  const el = sunAt(h);
  const night = nightAt(el);
  HOUR.value = h;
  // it comes in as the sun reaches the horizon and is all there soon after: later, and the place stands grey and
  // unlit between the day and the night; much earlier, and the map of it shows its edges in daylight
  DARK.value = 1 - step(-5, 2.5, el);
  FLOOD.value = h < 12 ? 0 : 1 - step(22.9, 23, h);
  // the windows go out one by one from nine in the evening, and come on again from five
  LATE.value = h >= 12 ? step(21, 25.5, h) : step(21, 25.5, h + 24) * (1 - step(5, 6.75, h));
  if (el > -2.5) {
    // the sun crosses from the east, over the south, to the west
    out.phi = ((h - 12) / ((SET - RISE) / 2)) * 1.35;
    out.el = Math.max(GRAZE, el) * RAD;
    out.sun.copy(LOW).lerp(HIGH, step(3, 30, el));
    // flat ground takes little of a low sun, so the sun is turned up as it sinks, as a camera would open up: the walls that face it burn
    // it keeps its strength right down to the horizon and goes in the few degrees under it, as an afterglow: fading
    // any sooner leaves an hour that is neither sunlit nor lamplit
    out.power = (step(-3, 2.5, el) * (1.4 + 0.1 * step(8, 30, el))) / Math.sin(out.el);
  } else {
    // once it is well down the same light is the moon, high in the south and in no hurry. Neither shines while they change places.
    const n = ((h - SET + 24) % 24) / (24 - SET + RISE);
    out.phi = (n - 0.5) * 1.5;
    out.el = (44 + 12 * Math.sin(Math.PI * n)) * RAD;
    out.sun.copy(MOON);
    // next to nothing: at night the place is lit by itself, and what it does not light is black
    out.power = 0.07 * step(4, 10, -el);
  }
  out.air.copy(AIR.night).lerp(AIR.low, step(-8, 0, el)).lerp(AIR.day, step(2, 26, el));
  out.earth.copy(EARTH.night).lerp(EARTH.day, step(-6, 6, el));
  out.fill = 0.05 + 0.9 * step(-4, 3, el) + 0.3 * step(3, 28, el);
  out.back.copy(BACK.night).lerp(BACK.dusk, step(-9, -2, el)).lerp(BACK.gold, step(-3, 4, el)).lerp(BACK.day, step(5, 24, el));
  out.night = night;
  // what shines goes by the lights, which are ahead of the dark
  NIGHT.value = litAt(el);
  // low sun: warmer and with more colour in it; night: cold
  const gold = goldAt(el);
  // and not cold: a night under sodium lamps is amber, and the grade leans that way with it
  MOOD.value.set(1 + 0.1 * gold + 0.06 * night, 1 + 0.01 * gold, 1 - 0.12 * gold - 0.1 * night);
  RICH.value = 0.28 * gold + 0.3 * night;
  return out;
}
