import { C, box, line, onPanel, r, row, tabArt, window, type WindowStyle } from '../art';
import { DEG, rect, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// A tenement on Möllevången: five floors of red brick, a shop at the street, a hipped roof of
// black tin. Walls in a strip as on the gabled houses; the roof is four faces, one on each wall
// top: trapezoids on the long walls, triangles on the ends, all at one pitch so the hips run
// at 45° and the ridge is the length less the depth. Tabs on the triangles' hips and along the
// ridge close it.

const W = 48; // street front
const D = 32; // depth
const H = 72; // eaves
const R = 15; // ridge rise
const T = 6;

const run = D / 2;
const s = Math.hypot(run, R); // every face, eave to ridge
const p = Math.atan2(R, run); // pitch
const eaveFold = 90 - p * DEG;
const hipBend = Math.acos(Math.cos(p) ** 2) * DEG;

export function makeMollan(): Net {
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const panels: Panel[] = [];
  const add = (q: Omit<Panel, 'origin'>) => panels.push({ origin: q.poly[0], ...q });

  const base = { poly: rect(0, -D, W, D) };
  const left = { poly: rect(xL, 0, D, H) };
  add({ id: 'base', kind: 'base', face: 'base', poly: base.poly, parent: null, hinge: null, fold: 0 });
  add({ id: 'front', kind: 'wall', face: 'front', poly: rect(0, 0, W, H), parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'right', kind: 'wall', face: 'side', poly: rect(xR, 0, D, H), parent: 'front', hinge: [[xR, 0], [xR, H]], fold: 90 });
  add({ id: 'back', kind: 'wall', face: 'back', poly: rect(xB, 0, W, H), parent: 'right', hinge: [[xB, 0], [xB, H]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, H]], fold: 90 });

  // the roof: a face up off each wall top
  const trap = (x: number): V2[] => [[x, H], [x + W, H], [x + W - run, H + s], [x + run, H + s]];
  const tri = (x: number): V2[] => [[x, H], [x + D, H], [x + D / 2, H + s]];
  const roofF = { poly: trap(0) };
  const roofB = { poly: trap(xB) };
  const hipR = { poly: tri(xR) };
  const hipL = { poly: tri(xL) };
  add({ id: 'roof-front', kind: 'roof', face: 'roof', poly: roofF.poly, parent: 'front', hinge: [[0, H], [W, H]], fold: eaveFold });
  add({ id: 'roof-back', kind: 'roof', face: 'roof', poly: roofB.poly, parent: 'back', hinge: [[xB, H], [xB + W, H]], fold: eaveFold });
  add({ id: 'hip-right', kind: 'roof', face: 'roof', poly: hipR.poly, parent: 'right', hinge: [[xR, H], [xR + D, H]], fold: eaveFold });
  add({ id: 'hip-left', kind: 'roof', face: 'roof', poly: hipL.poly, parent: 'left', hinge: [[xL, H], [xL + D, H]], fold: eaveFold });

  // the box closes as the houses do
  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff(base, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff(base, [0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff(base, [W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, H], T), parent: 'left', hinge: [[xE, 0], [xE, H]], fold: 90, glue: 'front' });
  // the hips: each end triangle glues under the long faces either side of it
  const hips: [string, { poly: V2[] }, V2, V2, string][] = [
    ['tab-hip-rf', hipR, [xR, H], [xR + D / 2, H + s], 'roof-front'],
    ['tab-hip-rb', hipR, [xR + D / 2, H + s], [xR + D, H], 'roof-back'],
    ['tab-hip-lb', hipL, [xL, H], [xL + D / 2, H + s], 'roof-back'],
    ['tab-hip-lf', hipL, [xL + D / 2, H + s], [xL + D, H], 'roof-front'],
  ];
  for (const [id, face, a, b, glue] of hips) {
    const parent = face === hipR ? 'hip-right' : 'hip-left';
    // the eave end is sharp (the long face's corner there), the ridge end has room
    const eaveAtA = Math.abs(a[1] - H) < 1e-6;
    add({ id, kind: 'tab', face: 'tab', poly: tabOff(face, a, b, 4, eaveAtA ? 38 : 45, eaveAtA ? 45 : 38), parent, hinge: [a, b], fold: hipBend, glue });
  }
  // the ridge: the front face's top edge under the back one
  add({ id: 'tab-ridge', kind: 'tab', face: 'tab', poly: tabOff(roofF, [run, H + s], [W - run, H + s], 4), parent: 'roof-front', hinge: [[W - run, H + s], [run, H + s]], fold: 2 * p * DEG, glue: 'roof-back' });
  return { panels };
}

// --- print ---
const BRICK = '#a5503a';
const BRICK2 = '#8a3f2c';
const STUCCO = '#eadfca';
const TIN = '#3e4347';
const TIN2 = '#2e3236';
const win: WindowStyle = { frame: '#f4efe4', glass: '#36504f', bars: 'six' };

function brick(x0: number, w: number, h: number) {
  let o = r(x0, 0, w, h, BRICK);
  for (let y = 1.5; y < h; y += 1.5) o += line(x0, y, x0 + w, y, BRICK2, 0.16);
  // a stucco ground floor, a band at each floor, a cornice
  o += r(x0, 0, w, 14, STUCCO) + line(x0, 14, x0 + w, 14, C.ink, 0.35);
  for (let f = 1; f < 5; f++) o += r(x0, 14 + f * 11.4 - 0.7, w, 0.7, STUCCO);
  o += r(x0, h - 3.4, w, 3.4, STUCCO) + line(x0, h - 3.4, x0 + w, h - 3.4, C.ink, 0.35);
  return o;
}

function upper(x0: number, w: number, n: number) {
  let o = '';
  for (let f = 0; f < 4; f++) o += row(x0, w, 16.5 + f * 11.4, n, 5, 8, win);
  return o;
}

function frontArt(x0: number) {
  let o = brick(x0, W, H) + upper(x0, W, 5);
  // the shop: a green awning, two windows, the stair door
  o += window(x0 + 3, 2, 14, 9, { frame: '#2f4a3c', glass: '#5d7f82', bars: 'none', sill: false });
  o += window(x0 + 20, 2, 14, 9, { frame: '#2f4a3c', glass: '#5d7f82', bars: 'none', sill: false });
  o += r(x0 + 2, 11, 33, 2.4, '#2f6b4f');
  for (let x = x0 + 2; x < x0 + 35; x += 3) o += r(x, 11, 1.5, 2.4, '#e9e4d6');
  o += r(x0 + 38, 1, 7, 12, '#5a3b2a', `stroke="${C.ink}" stroke-width="0.4"`);
  return o;
}

function art(q: Panel) {
  if (q.kind === 'tab') return tabArt(q);
  const b = box(q);
  switch (q.id) {
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#d5d0c6');
    case 'front': return frontArt(b.x0);
    case 'back': return brick(b.x0, W, H) + upper(b.x0, W, 5) + row(b.x0, W, 3, 5, 5, 8, win);
    case 'right': case 'left': return brick(b.x0, D, H) + upper(b.x0, D, 2) + row(b.x0, D, 3, 2, 5, 8, win);
    default: {
      // tin: seams down the slope, drawn along the face from its eave
      let o = '';
      for (let x = -W; x <= W; x += 2.8) o += line(x, 0, x, s + 1, TIN2, 0.35);
      return onPanel(q, r(-W, 0, 2 * W, s + 1, TIN) + o + r(-W, 0, 2 * W, 1.2, TIN2));
    }
  }
}

export const mollan: Model = {
  id: 'mollan',
  name: 'Hyreshus',
  where: 'Möllevången',
  net: makeMollan(),
  art,
};
