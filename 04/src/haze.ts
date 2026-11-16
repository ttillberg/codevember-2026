// The air the place sits in: its colour behind everything, and what comes through it over a day in autumn.
import { Color, Uniform, Vector3 } from 'three';

/** The sky behind everything, by day. */
export const HAZE = 0xa3adb3;

/** How much of the night is here: 0 by day, 1 in the dark. One number, read by every lamp, sign, window and headlight. */
export const NIGHT = new Uniform(0);
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
const LOW = new Color(1, 0.46, 0.17), HIGH = new Color(1, 0.95, 0.87), MOON = new Color(0.5, 0.64, 1);
// the light of the sky itself, from above and from the ground: always cooler than the sun, and blue once it is gone
const AIR = { day: hex(0xbcd4ff), low: hex(0xa4b4ee), night: hex(0x3c55a8) };
const EARTH = { day: hex(0x6b6a52), night: hex(0x1a2033) };
// the haze behind everything
const BACK = { day: hex(HAZE), gold: hex(0xc9a48a), dusk: hex(0x6a6382), night: hex(0x0b111d) };

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
  if (el > -2.5) {
    // the sun crosses from the east, over the south, to the west
    out.phi = ((h - 12) / ((SET - RISE) / 2)) * 1.35;
    out.el = Math.max(GRAZE, el) * RAD;
    out.sun.copy(LOW).lerp(HIGH, step(3, 30, el));
    // flat ground takes little of a low sun, so the sun is turned up as it sinks, as a camera would open up: the walls that face it burn
    out.power = (step(-1.5, 6, el) * (1.4 + 0.1 * step(8, 30, el))) / Math.sin(out.el);
  } else {
    // once it is well down the same light is the moon, high in the south and in no hurry. Neither shines while they change places.
    const n = ((h - SET + 24) % 24) / (24 - SET + RISE);
    out.phi = (n - 0.5) * 1.5;
    out.el = (44 + 12 * Math.sin(Math.PI * n)) * RAD;
    out.sun.copy(MOON);
    out.power = 0.42 * step(4, 10, -el);
  }
  out.air.copy(AIR.night).lerp(AIR.low, step(-8, 0, el)).lerp(AIR.day, step(2, 26, el));
  out.earth.copy(EARTH.night).lerp(EARTH.day, step(-6, 6, el));
  out.fill = 0.3 + 0.65 * step(-7, 3, el) + 0.3 * step(3, 28, el);
  out.back.copy(BACK.night).lerp(BACK.dusk, step(-9, -2, el)).lerp(BACK.gold, step(-3, 4, el)).lerp(BACK.day, step(5, 24, el));
  out.night = night;
  // what shines goes by the lights, which are ahead of the dark
  NIGHT.value = litAt(el);
  // low sun: warmer and with more colour in it; night: cold
  const gold = goldAt(el);
  MOOD.value.set(1 + 0.1 * gold - 0.1 * night, 1 + 0.01 * gold - 0.03 * night, 1 - 0.12 * gold + 0.1 * night);
  RICH.value = 0.28 * gold;
  return out;
}
