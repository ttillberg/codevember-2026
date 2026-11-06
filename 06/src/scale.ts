import { Vector3 } from 'three';
import { elementsAt, position } from './kepler';
import type { Planet } from './planets';

// Distances run from 0.39 to 30 au, so the radius is compressed with a power law, keeping directions: every orbit
// keeps its shape, phase and tilt and still closes on itself. Earth sits at R scene units.
export const R = 7;
const POW = 0.35;

// Past Saturn the ice giants are pulled in further, so the whole system fits tighter and can be seen bigger: beyond
// OUTER scene units only KEEP of the distance is kept, eased in smoothly (a softplus) so no orbit gets a kink.
const OUTER = 16;
const KEEP = 0.65;
const SOFT = 1;
// And a second, harder pull past Uranus, for Neptune.
const FAR = 19;
const KEEP_FAR = 0.45;
const softplus = (x: number) => SOFT * Math.log(1 + Math.exp(x / SOFT));

export function toOrrery(v: Vector3) {
  const r = v.length();
  if (r === 0) return v;
  const s = R * Math.pow(r, POW);
  const outer = s - (1 - KEEP) * softplus(s - OUTER);
  return v.multiplyScalar((outer - (1 - KEEP_FAR) * softplus(outer - FAR)) / r);
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
