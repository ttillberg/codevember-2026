import { C, box, line, r, tabArt, window } from '../art';
import { DEG, rect, tab, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// Fiskehoddorna on Banérskajen: a row of fishing huts, falu red with white corners, gables to
// the quay, a long black canopy over the fish counters along the front, the sign on the end.
//
// One net. The front is a pleat: the shop front up to the canopy, then the canopy's underside
// folding out flat, the canopy itself sloping back up to the wall, then the wall on up to its
// saw-toothed gables. The canopy's triangle closes on the wall, nothing missing shows. The end
// walls hang off the shop front and the back as on a house; the roof is one strip of slopes
// off the left wall's top, ridge, valley, ridge..., held from under by every gable edge.

const K = 3; // huts
const W = 26; // each hut's width
const D = 30; // depth
const H = 27; // eaves
const R = 10; // ridge rise
const T = 6;
const HC = 12; // the canopy's underside
const CD = 9; // how far it reaches out
const CV = 4; // how much it rises back to the wall

const L = Math.hypot(W / 2, R); // a slope, eave to ridge
const pitch = Math.atan2(R, W / 2) * DEG;
const tight = 90 - pitch - 4; // a gable tab's end at an eave or a valley
const CL = Math.hypot(CD, CV); // the canopy, edge to wall
const lean = Math.atan2(CV, CD) * DEG;
const HU = H - HC - CV; // the wall above the canopy

// the saw-tooth top over a wall from y0, hw high: right corner, peak, valley, ... left corner
function sawtooth(x0: number, y0: number, hw: number): { poly: V2[]; parts: V2[][] } {
  const poly: V2[] = [[x0, y0], [x0 + K * W, y0], [x0 + K * W, y0 + hw]];
  for (let i = K - 1; i >= 0; i--) {
    poly.push([x0 + i * W + W / 2, y0 + hw + R]);
    poly.push([x0 + i * W, y0 + hw]);
  }
  const parts = [rect(x0, y0, K * W, hw)];
  for (let i = 0; i < K; i++) parts.push([[x0 + i * W, y0 + hw], [x0 + (i + 1) * W, y0 + hw], [x0 + i * W + W / 2, y0 + hw + R]]);
  return { poly, parts };
}

export function makeHoddor(): Net {
  const xR = K * W, xB = K * W + D, xL = 2 * K * W + D, xE = 2 * K * W + 2 * D;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'> & { origin?: V2 }) => panels.push({ origin: p.origin ?? p.poly[0], ...p } as Panel);

  const base = { poly: rect(0, -D, K * W, D) };
  // the front, folded as a pleat: shop, underside, canopy, the wall above
  const y1 = HC, y2 = HC + CD, y3 = HC + CD + CL;
  const upper = sawtooth(0, y3, HU);
  const back = sawtooth(xB, 0, H);
  // the end walls: notched where the canopy meets them, so their tabs can take each part
  const right = { poly: [[xR, 0], [xR + D, 0], [xR + D, H], [xR, H], [xR, HC + CV], [xR, HC]] as V2[] };
  const left = { poly: [[xL, 0], [xE, 0], [xE, HC], [xE, HC + CV], [xE, H], [xL, H]] as V2[] };

  add({ id: 'base', kind: 'base', face: 'base', poly: base.poly, parent: null, hinge: null, fold: 0 });
  add({ id: 'shop', kind: 'wall', face: 'front', poly: rect(0, 0, K * W, HC), parent: 'base', hinge: [[0, 0], [K * W, 0]], fold: 90 });
  add({ id: 'under', kind: 'part', face: 'part', poly: rect(0, y1, K * W, CD), parent: 'shop', hinge: [[0, y1], [K * W, y1]], fold: -90 });
  add({ id: 'canopy', kind: 'roof', face: 'roof', poly: rect(0, y2, K * W, CL), parent: 'under', hinge: [[0, y2], [K * W, y2]], fold: 180 - lean });
  add({ id: 'front', kind: 'gable', face: 'front', ...upper, parent: 'canopy', hinge: [[0, y3], [K * W, y3]], fold: -(90 - lean) });
  add({ id: 'right', kind: 'wall', face: 'side', poly: right.poly, parent: 'shop', hinge: [[xR, 0], [xR, HC]], fold: 90 });
  add({ id: 'back', kind: 'gable', face: 'back', ...back, parent: 'right', hinge: [[xB, 0], [xB, H]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, H]], fold: 90 });

  // the roof: slope j over the left wall's top; counting huts from the left, j even a hut's
  // left slope, odd its right one. Ridge folds one way, valley the other.
  for (let j = 0; j < 2 * K; j++) {
    const y = H + j * L;
    add({
      id: `roof-${j}`, kind: 'roof', face: 'roof', poly: rect(xL, y, D, L), parent: j ? `roof-${j - 1}` : 'left',
      hinge: [[xL, y], [xE, y]], fold: j === 0 ? 90 - pitch : j % 2 ? 2 * pitch : -2 * pitch,
    });
  }

  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff(base, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff(base, [0, -D], [K * W, -D], T), parent: 'base', hinge: [[0, -D], [K * W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff(base, [K * W, -D], [K * W, 0], T), parent: 'base', hinge: [[K * W, -D], [K * W, 0]], fold: 90, glue: 'right' });
  // the left wall closes on the front, below the canopy and above it
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, HC], 5), parent: 'left', hinge: [[xE, 0], [xE, HC]], fold: 90, glue: 'shop' });
  add({ id: 'tab-seam-up', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, HC + CV], [xE, H], 5), parent: 'left', hinge: [[xE, HC + CV], [xE, H]], fold: 90, glue: 'front' });
  // the wall above the canopy holds the right wall's top part
  add({ id: 'tab-front-right', kind: 'tab', face: 'tab', poly: tabOff(upper, [K * W, y3], [K * W, y3 + HU], 5), parent: 'front', hinge: [[K * W, y3], [K * W, y3 + HU]], fold: 90, glue: 'right' });
  // the right wall's top holds the last slope
  add({ id: 'tab-eave', kind: 'tab', face: 'tab', poly: tabOff(right, [xR, H], [xR + D, H], 5, 40, 40), parent: 'right', hinge: [[xR, H], [xR + D, H]], fold: 90 - pitch, glue: `roof-${2 * K - 1}` });

  // every gable edge holds its slope from under (the edges run anticlockwise: tab() puts each
  // on the outside, where the panel's middle can't tell on a saw-tooth). The back is the front
  // seen from behind.
  for (const [wall, shape, x0, mirror] of [['front', upper, 0, false], ['back', back, xB, true]] as const) {
    const top = shape.poly.slice(2); // the right corner, then peak, valley, ...
    const low = top[0][1];
    for (let e = 0; e < top.length - 1; e++) {
      const a = top[e];
      const b = top[e + 1];
      const xm = (a[0] + b[0]) / 2 - x0;
      const fromLeft = mirror ? K * W - xm : xm;
      const hut = Math.floor(fromLeft / W);
      const leftSlope = fromLeft - hut * W < W / 2;
      const j = 2 * hut + (leftSlope ? 0 : 1);
      const lowA = Math.abs(a[1] - low) < 1e-6;
      add({
        id: `tab-${wall}-${e}`, kind: 'tab', face: 'tab', poly: tab(a, b, T * 0.7, lowA ? tight : 45, lowA ? 45 : tight),
        parent: wall, hinge: [a, b], fold: 90, glue: `roof-${j}`,
      });
    }
  }
  return { panels };
}

// --- print: falu red boards up and down, white corners and frames, grey felt roofs ---
const PAINT = ['#9e3428', '#8b9ea4', '#a3382b']; // from the left
const PAINT2 = ['#7e2920', '#71858b', '#842d22'];
const ROOF = '#55585a';
const ROOF2 = '#3f4244';

function boards(x0: number, x1: number, y0: number, y1: number, hut: number) {
  let s = r(x0, y0, x1 - x0, y1 - y0, PAINT[hut]);
  for (let x = x0 + 2.2; x < x1; x += 2.2) s += line(x, y0, x, y1, PAINT2[hut], 0.35);
  return s;
}
// white corner boards at a hut's two sides
const corners = (x0: number, x1: number, y0: number, y1: number) => r(x0, y0, 1.3, y1 - y0, C.frame) + r(x1 - 1.3, y0, 1.3, y1 - y0, C.frame);
const win = (x: number, y: number, w = 5, h = 6) => window(x, y, w, h, { frame: C.frame, bars: 'cross', sill: false });

// the shop front: each hut's boards, a white counter with its glass case of fish
function shopArt(x0: number) {
  let s = '';
  for (let i = 0; i < K; i++) {
    const xa = x0 + i * W;
    s += boards(xa, xa + W, 0, HC + 1, i) + corners(xa, xa + W, 0, HC + 1);
    s += r(xa + W / 2 - 3, 0, 6, HC, '#3a332c', `stroke="${C.frame}" stroke-width="0.7"`);
    // the counter: white below, a blue name board, glass with ice and fish on top
    s += r(xa + 1.5, 0, W - 3, 4.4, '#f1efe9', `stroke="${C.ink}" stroke-width="0.25"`) + r(xa + 2.5, 1.4, W - 5, 1.6, '#2f5d8a');
    s += r(xa + 1.5, 4.4, W - 3, 3, '#cfe0e4', `stroke="${C.ink}" stroke-width="0.25" opacity="0.92"`);
    for (let x = xa + 3; x < xa + W - 3; x += 2.6) s += `<ellipse cx="${x}" cy="5.4" rx="1" ry="0.4" fill="#c9cdd0"/>`;
  }
  return s;
}

function gableArt(x0: number, y0: number, mirror: boolean) {
  let s = '';
  for (let i = 0; i < K; i++) {
    const hut = mirror ? K - 1 - i : i;
    const xa = x0 + i * W;
    const top = y0 + (mirror ? H : HU);
    s += boards(xa, xa + W, y0, top + R + 1, hut) + corners(xa, xa + W, y0, top);
    // barge boards up the gable, a window in it, one in the wall below on the back
    s += line(xa, top, xa + W / 2, top + R, C.frame, 1.2) + line(xa + W, top, xa + W / 2, top + R, C.frame, 1.2);
    s += win(xa + W / 2 - 2.5, top + 0.8, 5, 5);
    if (mirror) s += win(xa + W / 2 - 3, 9, 6, 8) + r(xa, 0, W, 2, '#57524a');
  }
  return s;
}

// the end on the right: the white sign with its boats
function signArt(x0: number) {
  let s = boards(x0, x0 + D, 0, H, K - 1) + corners(x0, x0 + D, 0, H) + r(x0, 0, D, 2, '#57524a');
  const sx = x0 + 3, sy = 8, sw = D - 6, sh = 13;
  s += r(sx, sy, sw, sh, '#f7f5f0', `stroke="${C.ink}" stroke-width="0.3"`);
  s += `<g transform="translate(${sx + sw / 2} ${sy + sh - 4.2}) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="3" fill="#1d1d1d" textLength="${sw - 2.5}" lengthAdjust="spacingAndGlyphs">FISKEHODDORNA</text></g>`;
  s += `<g transform="translate(${sx + sw / 2} ${sy + 3.4}) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, serif" font-size="1.5" fill="#1d1d1d" textLength="${sw * 0.5}" lengthAdjust="spacingAndGlyphs">TIS–LÖR 06.30–13.00</text></g>`;
  for (const bx of [sx + 3.5, sx + sw - 6.5]) s += r(bx, sy + 5.4, 3, 0.9, '#1d1d1d') + r(bx + 1.6, sy + 6.3, 0.9, 0.8, '#1d1d1d') + line(bx + 1, sy + 6.3, bx + 1, sy + 8.4, '#1d1d1d', 0.2);
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    case 'shop': return shopArt(b.x0);
    case 'under': return r(b.x0, b.y0, b.w, b.h, '#2a2826') + line(b.x0, b.y0 + 0.6, b.x1, b.y0 + 0.6, '#4a4743', 0.6);
    case 'canopy': {
      let s = r(b.x0, b.y0, b.w, b.h, '#262524');
      for (let x = b.x0 + 2.5; x < b.x1; x += 3.2) s += line(x, b.y0, x, b.y1, '#1a1918', 0.45);
      return s + r(b.x0, b.y0, b.w, 0.8, '#3c3a37');
    }
    case 'front': return gableArt(b.x0, b.y0, false);
    case 'back': return gableArt(b.x0, b.y0, true);
    case 'right': return signArt(b.x0);
    case 'left': return boards(b.x0, b.x1, 0, H, 0) + corners(b.x0, b.x1, 0, H) + win(b.x0 + D / 2 - 3, 12, 6, 7) + r(b.x0, 0, b.w, 2, '#57524a');
    default: {
      // grey felt over battens, a cap on every ridge
      let s = r(b.x0, b.y0, b.w, b.h, ROOF);
      for (let x = b.x0 + 3; x < b.x1; x += 3.6) s += line(x, b.y0, x, b.y1, ROOF2, 0.6);
      const j = +p.id.slice(5);
      s += r(b.x0, j % 2 === 0 ? b.y1 - 1.6 : b.y0, b.w, 1.6, '#6b6e70');
      return s;
    }
  }
}

export const hoddor: Model = {
  id: 'hoddor',
  name: 'Fiskehoddorna',
  where: 'Banérskajen',
  net: makeHoddor(),
  art,
};
