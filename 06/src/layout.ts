import { Vector3 } from 'three';
import { elementsAt, orbitPath, planetRadius, toScene, type Scale } from './kepler';
import { PLANETS, type Planet } from './planets';

// The innermost FINE_RAILS rings, the top of the stack, run on thin polished silver wire; the rest on steel.
export const FINE_RAILS = 4;
export const isFine = (name: string) => PLANETS.findIndex((p) => p.name === name) < FINE_RAILS;
export const rodRadius = (r: number, fine = false) => (fine ? 0.5 : 1) * (0.04 + r * 0.03);
export const MAX_TILT = (4 * Math.PI) / 180;

const MARGIN = 0.4; // free space between neighbouring rails
export const DECK_SPREAD = 2; // multiplies every vertical step between decks
const J2000 = 2451545;

// How far a rail reaches from the marble's centre line, sideways or up and down.
const reach = (r: number, fine: boolean) => r + 2 * rodRadius(r, fine);

// Decks, like the arms of a real orrery stacked on the central column, cascading down: the further out, the lower.
// The whole stack is centred vertically on the bulb.
// Each orbit steps down from the one before by MIN_STEP, or further where its rail would overlap an inner
// orbit's radially, enough to clear it counting marbles, rods and both rings tilting towards each other.
const MIN_STEP = 2;
const decks = new Map<Scale, Map<string, number>>();
const lowest = new Map<Scale, number>();

function build(mode: Scale) {
  const m = new Map<string, number>();
  const placed: { lo: number; hi: number; reach: number; h: number }[] = [];
  let bottom = Infinity;
  for (const p of PLANETS) {
    const r = planetRadius(p, mode);
    const rr = reach(r, isFine(p.name));
    const radii = orbitPath(elementsAt(p.el, p.rate, J2000), 128).map((v) => {
      toScene(v, mode);
      return Math.hypot(v.x, v.z);
    });
    const lo = Math.min(...radii) - rr, hi = Math.max(...radii) + rr;
    let h = placed.length ? placed[placed.length - 1].h - MIN_STEP * DECK_SPREAD : 0;
    for (const q of placed) {
      if (q.lo < hi && lo < q.hi) {
        const sep = DECK_SPREAD * (q.reach + rr + MARGIN + 2 * Math.min(hi, q.hi) * Math.sin(MAX_TILT));
        h = Math.min(h, q.h - sep);
      }
    }
    placed.push({ lo, hi, reach: rr, h });
    bottom = Math.min(bottom, h - rr - hi * Math.sin(MAX_TILT));
  }
  // Centre the stack on the bulb: as much of it above as below.
  const shift = -(placed[0].h + placed[placed.length - 1].h) / 2;
  PLANETS.forEach((p, i) => m.set(p.name, placed[i].h + shift));
  decks.set(mode, m);
  lowest.set(mode, bottom + shift);
}

export function deckHeight(name: string, mode: Scale) {
  if (!decks.has(mode)) build(mode);
  return decks.get(mode)!.get(name) ?? 0;
}

// Lowest point any ring or marble can reach, tilt included.
export function lowestPoint(mode: Scale) {
  if (!lowest.has(mode)) build(mode);
  return lowest.get(mode)!;
}

// Heliocentric position (au, three's frame) to ring-local scene position, in place. The deck height is applied
// by the ring's group, so the ring tilts about its own centre on the column.
export function place(v: Vector3, mode: Scale) {
  return toScene(v, mode);
}

// Each ring's centre line, ring-local (before deck height and tilt), cached per mode.
// Elements at J2000: over a few decades the drift moves the orbit by far less than a rod's width.
const paths = new Map<Scale, Map<string, Vector3[]>>();
export function ringPath(p: Planet, mode: Scale) {
  let m = paths.get(mode);
  if (!m) paths.set(mode, (m = new Map()));
  let path = m.get(p.name);
  if (!path) m.set(p.name, (path = orbitPath(elementsAt(p.el, p.rate, J2000)).map((v) => place(v, mode))));
  return path;
}
