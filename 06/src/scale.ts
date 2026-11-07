import { Vector3 } from 'three';
import { elementsAt, position } from './kepler';
import type { Planet } from './planets';

// Distances run from 0.39 to 30 au, far too wide to show as they are, so each planet's distance is set by hand here,
// tight and evenly enough spaced that each candy has room, and the radius between them follows a smooth curve
// (monotone cubic, in log distance) so every orbit keeps its shape, phase and tilt and still closes on itself.
// au out from the sun, scene units out from the sun.
const TABLE: [number, number][] = [
  [0.387, 5.8], // Mercury
  [0.723, 7.2], // Venus
  [1.0, 8.6], // Earth
  [1.524, 10.2], // Mars
  [5.203, 13.8], // Jupiter
  [9.537, 17.0], // Saturn
  [19.19, 20.0], // Uranus
  [30.07, 22.6], // Neptune
];
const X = TABLE.map(([au]) => Math.log(au)), Y = TABLE.map(([, s]) => s);
// Slopes for a monotone cubic through the table (Fritsch–Carlson), so the curve never wiggles between planets.
const SLOPE = (() => {
  const n = X.length, d = X.slice(0, -1).map((x, i) => (Y[i + 1] - Y[i]) / (X[i + 1] - x)), m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return m;
})();
function sceneRadius(au: number) {
  const x = Math.log(au), n = X.length;
  // Beyond the ends (Halley's comet swings out past Neptune and in past Venus): carried on along the end slopes.
  if (x <= X[0]) return Math.max(4.2, Y[0] + SLOPE[0] * (x - X[0]));
  if (x >= X[n - 1]) return Y[n - 1] + SLOPE[n - 1] * (x - X[n - 1]);
  let i = 0;
  while (x > X[i + 1]) i++;
  const h = X[i + 1] - X[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * SLOPE[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * SLOPE[i + 1];
}

export function toOrrery(v: Vector3) {
  const r = v.length();
  return r === 0 ? v : v.multiplyScalar(sceneRadius(r) / r);
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
