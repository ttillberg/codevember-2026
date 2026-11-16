import { C, box, line, r, tabArt, window, type WindowStyle } from '../art';
import { DEG, rect, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// A Bo01 house in Västra Hamnen: a tall box under a single slope of zinc, low at the street,
// high at the back. Strip of walls front | right | back | left, the base under the front,
// the roof on top of the back wall, tabs along every wall top to hold it from under.

const W = 40; // street front
const D = 42; // depth
const HF = 60; // front, eave
const HB = 78; // back, top of the slope
const T = 7;

const L = Math.hypot(D, HB - HF);
const slope = Math.atan2(HB - HF, D) * DEG;

export function makeBo01(): Net {
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'> & { origin?: V2 }) => panels.push({ origin: p.origin ?? p.poly[0], ...p } as Panel);

  const front = { poly: rect(0, 0, W, HF) };
  const right = { poly: [[xR, 0], [xR + D, 0], [xR + D, HB], [xR, HF]] as V2[] };
  const left = { poly: [[xL, 0], [xL + D, 0], [xL + D, HF], [xL, HB]] as V2[] };
  add({ id: 'base', kind: 'base', face: 'base', poly: rect(0, -D, W, D), parent: null, hinge: null, fold: 0 });
  add({ id: 'front', kind: 'wall', face: 'front', poly: front.poly, parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'right', kind: 'wall', face: 'side', poly: right.poly, parent: 'front', hinge: [[xR, 0], [xR, HF]], fold: 90 });
  add({ id: 'back', kind: 'wall', face: 'back', poly: rect(xB, 0, W, HB), parent: 'right', hinge: [[xB, 0], [xB, HB]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, HB]], fold: 90 });
  // the roof leans from the top of the back down to the front
  add({ id: 'roof', kind: 'roof', face: 'roof', poly: rect(xB, HB, W, L), parent: 'back', hinge: [[xB, HB], [xB + W, HB]], fold: 90 + slope });

  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff({ poly: rect(0, -D, W, D) }, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff({ poly: rect(0, -D, W, D) }, [0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff({ poly: rect(0, -D, W, D) }, [W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, HF], T), parent: 'left', hinge: [[xE, 0], [xE, HF]], fold: 90, glue: 'front' });
  // wall tops hold the roof from under
  add({ id: 'tab-eave', kind: 'tab', face: 'tab', poly: tabOff(front, [0, HF], [W, HF], T, 40, 40), parent: 'front', hinge: [[0, HF], [W, HF]], fold: 90 - slope, glue: 'roof' });
  add({ id: 'tab-right', kind: 'tab', face: 'tab', poly: tabOff(right, [xR, HF], [xR + D, HB], T, 40, 40), parent: 'right', hinge: [[xR, HF], [xR + D, HB]], fold: 90, glue: 'roof' });
  add({ id: 'tab-left', kind: 'tab', face: 'tab', poly: tabOff(left, [xL, HB], [xE, HF], T, 40, 40), parent: 'left', hinge: [[xL, HB], [xE, HF]], fold: 90, glue: 'roof' });
  return { panels };
}

// --- print: render in a strong colour on the street, white round the sides, zinc on top ---
const RUST = '#d0643c';
const WHITE = '#f0ece4';
const ZINC = '#87909a';
const ZINC2 = '#6f7882';
const GREY = '#4a5157';
const GLASS = '#86a9b3';
const big: WindowStyle = { frame: GREY, glass: GLASS, bars: 'none', sill: false };

// a glass balcony: slab, posts, a pale pane
function balcony(x: number, y: number, w: number) {
  return r(x, y, w, 1.4, '#cfcac0', `stroke="${C.ink}" stroke-width="0.35"`) +
    r(x, y + 1.4, w, 5, '#bcd3d6', 'opacity="0.75"') +
    line(x, y + 6.4, x + w, y + 6.4, GREY, 0.6) +
    line(x + 0.4, y + 1.4, x + 0.4, y + 6.4, GREY, 0.4) + line(x + w - 0.4, y + 1.4, x + w - 0.4, y + 6.4, GREY, 0.4);
}

function frontArt(x0: number) {
  let s = r(x0, 0, W, HF, RUST);
  // a white strip up one side, the stair
  s += r(x0 + W - 9, 0, 9, HF, WHITE) + line(x0 + W - 9, 0, x0 + W - 9, HF, C.ink, 0.35);
  // ground: a glass door and a shop window
  s += window(x0 + 3, 2, 18, 14, big) + window(x0 + W - 7.5, 2, 6, 15, { ...big, frame: '#2f3438' });
  // up: wide windows, balconies on the two top floors
  for (const y of [22, 40]) s += window(x0 + 4, y, 22, 13, big);
  s += balcony(x0 + 2, 39, 26) + balcony(x0 + 2, 21, 26);
  for (const y of [24, 42]) s += window(x0 + W - 7, y, 5, 10, big);
  return s;
}

function sideArt(p: Panel) {
  const b = box(p);
  let s = r(b.x0, 0, b.w, b.y1, WHITE);
  // tall narrow windows, three floors, a rust panel through the middle
  s += r(b.x0 + b.w * 0.42, 0, 9, HF, RUST, 'opacity="0.9"');
  for (const y of [3, 22, 40]) for (const f of [0.16, 0.7]) s += window(b.x0 + b.w * f, y, 5, 14, big);
  return s;
}

function backArt(x0: number) {
  let s = r(x0, 0, W, HB, WHITE);
  for (const y of [3, 22, 40, 58]) s += window(x0 + 5, y, 12, 13, big) + window(x0 + W - 17, y, 12, 13, big);
  return s;
}

function roofArt(p: Panel) {
  const b = box(p);
  let s = r(b.x0, b.y0, b.w, b.h, ZINC);
  // standing seams down the slope, a flashing at the top
  for (let x = b.x0 + 3; x < b.x1; x += 3.6) s += line(x, b.y0, x, b.y1, ZINC2, 0.45);
  s += r(b.x0, b.y0, b.w, 1.6, ZINC2) + r(b.x0, b.y1 - 1.2, b.w, 1.2, '#5c636b');
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  switch (p.id) {
    case 'base': { const b = box(p); return r(b.x0, b.y0, b.w, b.h, '#d5d0c6'); }
    case 'front': return frontArt(p.origin[0]);
    case 'back': return backArt(p.origin[0]);
    case 'roof': return roofArt(p);
    default: return sideArt(p);
  }
}

export const bo01: Model = {
  id: 'bo01',
  name: 'Bo01',
  where: 'Västra Hamnen',
  net: makeBo01(),
  art,
};
