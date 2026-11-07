import { Vector3 } from 'three';

// JPL "Approximate Positions of the Planets", table 1 (valid 1800–2050).
// a [au], e, I [deg], L mean longitude [deg], w longitude of perihelion [deg], O longitude of ascending node [deg].
export type Elements = { a: number; e: number; I: number; L: number; w: number; O: number };

const DEG = Math.PI / 180;
export const J2000 = 2451545.0;

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
