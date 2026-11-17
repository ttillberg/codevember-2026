import { box, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { DEG, rect, tab, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// The red house on Lilla torg: four floors of red over a café, a dark awning all along, and in
// the middle a tall bay whose gable stands up above the eave, the roof's ridge running along
// the square behind it.
//
// The front is a pleat as on Fiskehoddorna: the café front up to the awning, its underside out,
// the awning sloping back up, then the wall on up to the eave and the bay's gable. The roof hangs
// off the back wall's top, back slope then front slope; the ends are gables whose slopes hold it,
// and the front's eave, either side of the bay, holds the front slope.

const W = 54; // along the square
const D = 30; // deep
const H = 62; // eaves
const R = 13; // ridge rise
const T = 6;
const HC = 12; // the awning's underside
const CD = 9; // how far it reaches
const CV = 3; // how much it rises back to the wall
const BW = 18; // the bay
const U = 9; // its wall over the eave
const G = 9; // its gable

const L = Math.hypot(D / 2, R);
const pitch = Math.atan2(R, D / 2) * DEG;
const tight = 90 - pitch - 4;
const CL = Math.hypot(CD, CV);
const lean = Math.atan2(CV, CD) * DEG;
const HU = H - HC - CV;

export interface BaySpec { W: number; D: number; H: number; R: number; T: number; HC: number; CD: number; CV: number; BW: number; U: number; G: number }
export const TORGET: BaySpec = { W, D, H, R, T, HC, CD, CV, BW, U, G };

// any size: the front's pleat (a ledge when small), the bay, the roof along the front
export function makeTorget(spec: BaySpec = TORGET): Net {
  const { W, D, H, R, T, HC, CD, CV, BW, U, G } = spec;
  const L = Math.hypot(D / 2, R);
  const pitch = Math.atan2(R, D / 2) * DEG;
  const tight = 90 - pitch - 4;
  const CL = Math.hypot(CD, CV);
  const lean = Math.atan2(CV, CD) * DEG;
  const HU = H - HC - CV;
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const xb1 = (W - BW) / 2, xb2 = (W + BW) / 2;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'> & { origin?: V2 }) => panels.push({ origin: p.origin ?? p.poly[0], ...p } as Panel);

  const y1 = HC, y2 = HC + CD, y3 = HC + CD + CL, ye = y3 + HU;
  const upper = {
    poly: [[0, y3], [W, y3], [W, ye], [xb2, ye], [xb2, ye + U], [W / 2, ye + U + G], [xb1, ye + U], [xb1, ye], [0, ye]] as V2[],
    parts: [rect(0, y3, W, HU), rect(xb1, ye, BW, U), [[xb1, ye + U], [xb2, ye + U], [W / 2, ye + U + G]] as V2[]],
  };
  const base = { poly: rect(0, -D, W, D) };
  // the ends are gables, notched where the awning meets them
  const right = { poly: [[xR, 0], [xR + D, 0], [xR + D, H], [xR + D / 2, H + R], [xR, H], [xR, HC + CV], [xR, HC]] as V2[] };
  const left = { poly: [[xL, 0], [xE, 0], [xE, HC], [xE, HC + CV], [xE, H], [xL + D / 2, H + R], [xL, H]] as V2[] };

  add({ id: 'base', kind: 'base', face: 'base', poly: base.poly, parent: null, hinge: null, fold: 0 });
  add({ id: 'shop', kind: 'wall', face: 'front', poly: rect(0, 0, W, HC), parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'under', kind: 'part', face: 'part', poly: rect(0, y1, W, CD), parent: 'shop', hinge: [[0, y1], [W, y1]], fold: -90 });
  add({ id: 'awning', kind: 'roof', face: 'roof', poly: rect(0, y2, W, CL), parent: 'under', hinge: [[0, y2], [W, y2]], fold: 180 - lean });
  add({ id: 'front', kind: 'wall', face: 'front', ...upper, parent: 'awning', hinge: [[0, y3], [W, y3]], fold: -(90 - lean) });
  add({ id: 'right', kind: 'gable', face: 'side', poly: right.poly, parent: 'shop', hinge: [[xR, 0], [xR, HC]], fold: 90 });
  add({ id: 'back', kind: 'wall', face: 'back', poly: rect(xB, 0, W, H), parent: 'right', hinge: [[xB, 0], [xB, H]], fold: 90 });
  add({ id: 'left', kind: 'gable', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, H]], fold: 90 });
  add({ id: 'roof-back', kind: 'roof', face: 'roof', poly: rect(xB, H, W, L), parent: 'back', hinge: [[xB, H], [xB + W, H]], fold: 90 - pitch });
  add({ id: 'roof-front', kind: 'roof', face: 'roof', poly: rect(xB, H + L, W, L), parent: 'roof-back', hinge: [[xB, H + L], [xB + W, H + L]], fold: 2 * pitch });

  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff(base, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff(base, [0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff(base, [W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, HC], 5), parent: 'left', hinge: [[xE, 0], [xE, HC]], fold: 90, glue: 'shop' });
  add({ id: 'tab-seam-up', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, HC + CV], [xE, H], 5), parent: 'left', hinge: [[xE, HC + CV], [xE, H]], fold: 90, glue: 'front' });
  // the gables' slopes hold the roof from under: the half by the back wall the back slope
  const slopes: [string, V2, V2, number, number, string][] = [
    ['right', [xR + D, H], [xR + D / 2, H + R], tight, 45, 'roof-back'],
    ['right', [xR + D / 2, H + R], [xR, H], 45, tight, 'roof-front'],
    ['left', [xE, H], [xL + D / 2, H + R], tight, 45, 'roof-front'],
    ['left', [xL + D / 2, H + R], [xL, H], 45, tight, 'roof-back'],
  ];
  slopes.forEach(([parent, a, b, ta, tb, glue], i) =>
    add({ id: `tab-${parent}-${i % 2 ? 'l' : 'r'}`, kind: 'tab', face: 'tab', poly: tab(a, b, T * 0.8, ta, tb), parent, hinge: [a, b], fold: 90, glue }),
  );
  // the front's eave either side of the bay holds the front slope
  add({ id: 'tab-eave-r', kind: 'tab', face: 'tab', poly: tab([W, ye], [xb2, ye], T * 0.8, 40, 45), parent: 'front', hinge: [[W, ye], [xb2, ye]], fold: 90 - pitch, glue: 'roof-front' });
  add({ id: 'tab-eave-l', kind: 'tab', face: 'tab', poly: tab([xb1, ye], [0, ye], T * 0.8, 45, 40), parent: 'front', hinge: [[xb1, ye], [0, ye]], fold: 90 - pitch, glue: 'roof-front' });
  return { panels };
}

// --- print ---
const RED = '#c4523a';
const RED2 = '#a8432f';
const sash: WindowStyle = { frame: '#f7f4ee', glass: '#3a4a50', bars: 'six' };

function brick(x0: number, y0: number, w: number, h: number) {
  let s = r(x0, y0, w, h, RED);
  for (let y = y0 + 1.5; y < y0 + h; y += 1.5) s += line(x0, y, x0 + w, y, RED2, 0.14);
  return s;
}
// a window with its white surround and a dark lintel
const framedWin = (x: number, y: number, w = 6, h = 9) => r(x - 0.9, y - 0.9, w + 1.8, h + 1.8, '#f7f4ee') + window(x, y, w, h, { ...sash, sill: false }) + r(x - 1.2, y + h + 0.9, w + 2.4, 1, '#5e5752');
// a round-headed one, for the bay
const arched = (x: number, y: number, w = 6, h = 9) =>
  `<path d="M${x - 0.9} ${y - 0.9}h${w + 1.8}v${h + 0.9}a${w / 2 + 0.9} ${w / 2 + 0.9} 0 0 1 ${-(w + 1.8)} 0z" fill="#f7f4ee"/>` +
  `<path d="M${x} ${y}h${w}v${h}a${w / 2} ${w / 2} 0 0 1 ${-w} 0z" fill="${sash.glass}"/>` + line(x + w / 2, y, x + w / 2, y + h + w / 2, '#f7f4ee', 0.6) + line(x, y + h * 0.55, x + w, y + h * 0.55, '#f7f4ee', 0.6);

function frontArt(x0: number, y0: number) {
  const xb1 = x0 + (W - BW) / 2;
  let s = brick(x0, y0, W, HU + U + G + 1);
  // the bay: a shade darker at its edges, round heads up its middle
  s += r(xb1, y0, 0.9, HU + U, RED2) + r(xb1 + BW - 0.9, y0, 0.9, HU + U, RED2);
  const floors = [y0 + 3, y0 + 15, y0 + 27, y0 + 38];
  for (const y of floors) {
    for (const x of [x0 + 4, x0 + 12]) s += framedWin(x, y);
    for (const x of [x0 + W - 18, x0 + W - 10]) s += framedWin(x, y);
    s += arched(xb1 + BW / 2 - 3, y, 6, 7.5);
  }
  s += framedWin(xb1 + BW / 2 - 3, y0 + HU + 1.5, 6, 7);
  // the eave cornice either side of the bay
  s += r(x0, y0 + HU - 1.6, (W - BW) / 2, 1.6, '#5e5752') + r(xb1 + BW, y0 + HU - 1.6, (W - BW) / 2, 1.6, '#5e5752');
  return s;
}

function shopArt(x0: number) {
  let s = r(x0, 0, W, HC + 1, '#2b2d2d');
  for (let x = x0 + 2; x < x0 + W - 6; x += 9) s += r(x, 1, 7.5, HC - 2, '#475659', `stroke="#9a9a92" stroke-width="0.4"`);
  // café tables and umbrellas out under the awning
  for (let x = x0 + 6; x < x0 + W; x += 12) s += `<ellipse cx="${x}" cy="7" rx="3.2" ry="1.1" fill="#f1eee6"/>` + line(x, 1, x, 7, '#cfcac0', 0.4);
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    case 'shop': return shopArt(b.x0);
    case 'under': return r(b.x0, b.y0, b.w, b.h, '#2f3133');
    case 'awning': return r(b.x0, b.y0, b.w, b.h, '#45494b') + r(b.x0, b.y0, b.w, 1.4, '#f1eee6');
    case 'front': return frontArt(b.x0, b.y0);
    case 'back': {
      let s = brick(b.x0, 0, W, H);
      for (const y of [16, 28, 40, 51]) for (const x of [6, 18, 30, 42]) s += framedWin(b.x0 + x, y, 5, 8);
      return s;
    }
    case 'right': case 'left': {
      let s = brick(b.x0, 0, D, H + R);
      for (const y of [16, 28, 40, 51]) s += framedWin(b.x0 + D / 2 - 2.5, y, 5, 8);
      return s + r(b.x0, 0, D, HC, '#2b2d2d');
    }
    default: return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, '#9a6a52', '#7a503c');
  }
}

export const torget: Model = { id: 'torget', name: 'Röda huset', where: 'Lilla torg', net: makeTorget(), art };
