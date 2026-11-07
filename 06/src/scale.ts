import { Vector3 } from 'three';
import { elementsAt, position } from './kepler';
import type { Planet } from './planets';

// Distances run from 0.39 to 30 au, so the radius is compressed with a power law, keeping directions: every orbit
// keeps its shape, phase and tilt and still closes on itself. Earth sits at R scene units.
export const R = 7;
const POW = 0.35;
// And everything stands this much further out, so the innermost planets clear the sun with room to spare.
const CLEAR = 0.8;

export function toOrrery(v: Vector3) {
  const r = v.length();
  return r === 0 ? v : v.multiplyScalar((R * Math.pow(r, POW) + CLEAR) / r);
}

// Real orbits lie within a few degrees of each other, too flat to read, so each one's tilt is exaggerated by this
// much (Mercury's 7° becomes 28°). Only in the scene: the close up card's facts use the real orbit.
export const TILT = 4;

// A planet's place in the scene at Julian date jd.
export function planetAt(p: Planet, jd: number, out = new Vector3()) {
  const el = elementsAt(p.el, p.rate, jd);
  el.I *= TILT;
  return toOrrery(position(el, out));
}
