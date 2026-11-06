import { Vector3 } from 'three';

// JPL "Approximate Positions of the Planets", table 1 (valid 1800–2050).
// a [au], e, I [deg], L mean longitude [deg], w longitude of perihelion [deg], O longitude of ascending node [deg].
export type Elements = { a: number; e: number; I: number; L: number; w: number; O: number };

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

export function jdFromDate(d: Date) {
  return d.getTime() / 86400000 + 2440587.5;
}

export function dateFromJd(jd: number) {
  return new Date((jd - 2440587.5) * 86400000);
}

export function elementsAt(base: Elements, rate: Elements, jd: number): Elements {
  const T = (jd - J2000) / 36525;
  return {
    a: base.a + rate.a * T,
    e: base.e + rate.e * T,
    I: base.I + rate.I * T,
    L: base.L + rate.L * T,
    w: base.w + rate.w * T,
    O: base.O + rate.O * T,
  };
}

function solveKepler(M: number, e: number) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

// Heliocentric ecliptic position for eccentric anomaly E, written into `out` in three's y-up frame:
// ecliptic (x, y, z) -> scene (x, z, -y), so north of the ecliptic is +y and orbits run counterclockwise seen from above.
function placeAt(el: Elements, E: number, out: Vector3) {
  const { a, e } = el;
  const om = (el.w - el.O) * DEG; // argument of perihelion
  const O = el.O * DEG;
  const I = el.I * DEG;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(om), so = Math.sin(om);
  const cO = Math.cos(O), sO = Math.sin(O);
  const cI = Math.cos(I), sI = Math.sin(I);
  const x = (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp;
  const y = (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp;
  const z = so * sI * xp + co * sI * yp;
  return out.set(x, z, -y);
}

export function position(el: Elements, out: Vector3) {
  let M = ((el.L - el.w) % 360) * DEG;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  return placeAt(el, solveKepler(M, el.e), out);
}


// Closed orbit outline in the ecliptic frame, E from 0 to 2 pi.
export function orbitPath(el: Elements, n = 256) {
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(placeAt(el, (i / n) * Math.PI * 2, new Vector3()));
  return pts;
}

// Distances span 0.39 to 30 au, so the radius is compressed with a power law.
// Directions are kept, so every orbit keeps its phase, tilt and closes on itself.
export const SCALE = 6;
export const POW = 0.45;

// orrery: compressed distances, marble sizes picked by eye
// sqrt: compressed distances, size goes with the square root of the real radius, the old orrery compromise
// sizes: compressed distances, real relative sizes (Jupiter keeps its marble size)
// true: linear distances and real sizes on the same scale, Neptune's orbit where it was
export type Scale = 'orrery' | 'sqrt' | 'sizes' | 'true';
export const SCALES: Scale[] = ['sqrt', 'sizes', 'true', 'orrery'];

const AU_KM = 149597870.7;
const LINEAR = (SCALE * Math.pow(30.07, POW)) / 30.07; // scene units per au
const JUPITER_KM = 69911;
const JUPITER_MARBLE = 0.8;

export function radiusOf(b: { radius: number; km: number }, mode: Scale) {
  if (mode === 'orrery') return b.radius;
  if (mode === 'sqrt') return Math.sqrt(b.km / JUPITER_KM) * JUPITER_MARBLE * 1.1;
  if (mode === 'sizes') return (b.km / JUPITER_KM) * JUPITER_MARBLE;
  return (b.km / AU_KM) * LINEAR;
}

// sqrt mode only: planets are scaled up on their own, the sun keeps its size.
export const PLANET_SIZE = 3;

export function planetRadius(b: { radius: number; km: number }, mode: Scale) {
  return radiusOf(b, mode) * (mode === 'sqrt' ? PLANET_SIZE : 1);
}

const SUN_KM = 695700;
const SUN_MARBLE = 1.4; // orrery mode
const SUN_BOOST = 2; // sqrt mode: the sun is the centrepiece, not to scale with the planets

export function sunRadius(mode: Scale) {
  const r = radiusOf({ radius: SUN_MARBLE, km: SUN_KM }, mode);
  return mode === 'sqrt' ? r * SUN_BOOST : r;
}

// Compressed modes push every orbit out by the same amount, so Mercury's perihelion clears the sun's surface.
const MERCURY_PERIHELION = SCALE * Math.pow(0.3075, POW);
const CLEARANCE = 1.2;
const offsetOf = (mode: Scale) =>
  mode === 'true' ? 0 : Math.max(0, sunRadius(mode) + CLEARANCE - MERCURY_PERIHELION);

export function toScene(v: Vector3, mode: Scale = 'orrery') {
  const r = v.length();
  if (r === 0) return v;
  if (mode === 'true') return v.multiplyScalar(LINEAR);
  return v.multiplyScalar((offsetOf(mode) + SCALE * Math.pow(r, POW)) / r);
}
