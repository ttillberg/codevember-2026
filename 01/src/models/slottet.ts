import { box, C, line, r, tabArt, tiles, type Art } from '../art';
import { DEG, rect, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// Stadsbiblioteket's old part, Slottet: red brick under a slate roof, a stepped gable standing up
// above the roof at each end, white bands and arched windows. The gabled house's net with
// stepped gables: the steps rise past the roof's line, so the roof hangs off the right wall and
// is held by the left wall's eave tab, its ends tucked inside the gables.

const W = 42; // gable
const D = 64; // along the ridge
const H = 46; // eaves: four floors
const R = 21;
const T = 6;
const STEPS = 3;
const L = Math.hypot(W / 2, R);
const pitch = Math.atan2(R, W / 2) * DEG;
const cw = W / (2 * STEPS + 1);
// a column's top: above the roof at its inner edge by a margin, the middle one highest
const roofAt = (x: number) => H + R * (1 - Math.abs(x - W / 2) / (W / 2));
const tops = Array.from({ length: 2 * STEPS + 1 }, (_, c) => {
  const inner = c < STEPS ? (c + 1) * cw : c > STEPS ? c * cw : W / 2;
  return roofAt(inner) + (c === STEPS ? 4 : 3);
});

function stepped(x0: number): { poly: V2[]; parts: V2[][] } {
  const poly: V2[] = [[x0, 0], [x0 + W, 0], [x0 + W, H]];
  for (let c = 2 * STEPS; c >= 0; c--) {
    poly.push([x0 + (c + 1) * cw, tops[c]]);
    poly.push([x0 + c * cw, tops[c]]);
  }
  poly.push([x0, H]);
  const parts = [rect(x0, 0, W, H), ...tops.map((t, c) => rect(x0 + c * cw, H, cw, t - H))];
  // drop repeats (a column's corners meet the next one's)
  const clean = poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 1e-9);
  return { poly: clean, parts };
}

export function makeSlottet(): Net {
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'>) => panels.push({ origin: p.poly[0], ...p });
  const base = { poly: rect(0, -D, W, D) };
  const left = { poly: rect(xL, 0, D, H) };
  add({ id: 'base', kind: 'base', face: 'base', poly: base.poly, parent: null, hinge: null, fold: 0 });
  add({ id: 'front', kind: 'gable', face: 'front', ...stepped(0), parent: 'base', hinge: [[0, 0], [W, 0]], fold: 90 });
  add({ id: 'right', kind: 'wall', face: 'side', poly: rect(xR, 0, D, H), parent: 'front', hinge: [[xR, 0], [xR, H]], fold: 90 });
  add({ id: 'back', kind: 'gable', face: 'back', ...stepped(xB), parent: 'right', hinge: [[xB, 0], [xB, H]], fold: 90 });
  add({ id: 'left', kind: 'wall', face: 'side', poly: left.poly, parent: 'back', hinge: [[xL, 0], [xL, H]], fold: 90 });
  add({ id: 'roof1', kind: 'roof', face: 'roof', poly: rect(xR, H, D, L), parent: 'right', hinge: [[xR, H], [xR + D, H]], fold: 90 - pitch });
  add({ id: 'roof2', kind: 'roof', face: 'roof', poly: rect(xR, H + L, D, L), parent: 'roof1', hinge: [[xR, H + L], [xR + D, H + L]], fold: 2 * pitch });
  add({ id: 'tab-base-left', kind: 'tab', face: 'tab', poly: tabOff(base, [0, 0], [0, -D], T), parent: 'base', hinge: [[0, 0], [0, -D]], fold: 90, glue: 'left' });
  add({ id: 'tab-base-back', kind: 'tab', face: 'tab', poly: tabOff(base, [0, -D], [W, -D], T), parent: 'base', hinge: [[0, -D], [W, -D]], fold: 90, glue: 'back' });
  add({ id: 'tab-base-right', kind: 'tab', face: 'tab', poly: tabOff(base, [W, -D], [W, 0], T), parent: 'base', hinge: [[W, -D], [W, 0]], fold: 90, glue: 'right' });
  add({ id: 'tab-seam', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, 0], [xE, H], T), parent: 'left', hinge: [[xE, 0], [xE, H]], fold: 90, glue: 'front' });
  add({ id: 'tab-eave', kind: 'tab', face: 'tab', poly: tabOff(left, [xE, H], [xL, H], T, 40, 40), parent: 'left', hinge: [[xE, H], [xL, H]], fold: 90 - pitch, glue: 'roof2' });
  return { panels };
}

// --- print ---
const BRICK = '#b5523a';
const BRICK2 = '#97412c';
const LIME = '#efe6d4';
const SLATE = '#4b4f50';
const SLATE2 = '#363a3b';
const GLASS = '#3a4648';
const FLOORS = [3.5, 14, 25, 35.5]; // window sills

function brick(x0: number, w: number, h: number) {
  let s = r(x0, 0, w, h, BRICK);
  for (let y = 1.3; y < h; y += 1.3) s += line(x0, y, x0 + w, y, BRICK2, 0.13);
  // a grey plinth, white bands under the windows, a corbelled frieze under the eaves
  s += r(x0, 0, w, 2.2, '#8b857c');
  for (const y of [12, 23.2, 33.8]) s += r(x0, y, w, 0.7, LIME);
  for (let x = x0 + 0.6; x < x0 + w - 1; x += 2.4) s += `<path d="M${x} ${H - 3.2}a1.2 1.2 0 0 0 2.4 0z" fill="${LIME}" opacity="0.85"/>`;
  return s;
}

// an arched window: white frame, glazing bars, a pale arch over it
function arched(x: number, y: number, w: number, h: number) {
  const k = w / 2;
  return `<path d="M${x - 0.6} ${y + h}a${k + 0.6} ${k + 0.6} 0 0 1 ${w + 1.2} 0z" fill="${LIME}"/>` +
    r(x, y, w, h, '#f4f1ea', `stroke="${C.ink}" stroke-width="0.2"`) + r(x + 0.5, y + 0.5, w - 1, h - 1, GLASS) +
    line(x + w / 2, y + 0.5, x + w / 2, y + h - 0.5, '#f4f1ea', 0.4) + line(x + 0.5, y + h * 0.62, x + w - 0.5, y + h * 0.62, '#f4f1ea', 0.35);
}

// the iron wall anchors, a dark cross between the windows
const anchor = (x: number, y: number) => line(x, y - 1, x, y + 1, '#2e2622', 0.35) + line(x - 0.8, y, x + 0.8, y, '#2e2622', 0.35);

// a rose window
const rose = (x: number, y: number, rr: number) => `<circle cx="${x}" cy="${y}" r="${rr + 0.7}" fill="${LIME}"/><circle cx="${x}" cy="${y}" r="${rr}" fill="${GLASS}"/>` +
  Array.from({ length: 6 }, (_, k) => line(x, y, x + rr * Math.cos((k * Math.PI) / 3), y + rr * Math.sin((k * Math.PI) / 3), LIME, 0.3)).join('');

function gableArt(x0: number, front: boolean) {
  let s = brick(x0, W, H + R + 8);
  // copings on every step, a narrow blind niche up each
  tops.forEach((t, c) => {
    s += r(x0 + c * cw, t - 1.2, cw, 1.2, LIME);
    if (t - H > 7) s += r(x0 + c * cw + cw / 2 - 0.7, H + 1, 1.4, Math.min(t - H - 4, 22), LIME, 'opacity="0.8"');
  });
  s += rose(x0 + W / 2, H + 14, 3);
  for (const f of [0.36, 0.5, 0.64]) s += arched(x0 + W * f - 1.6, H + 2.5, 3.2, 6);
  FLOORS.forEach((y, k) => {
    for (const f of [0.2, 0.5, 0.8]) s += arched(x0 + W * f - 2.3, y, 4.6, k === 0 ? 6 : 7);
    for (const f of [0.35, 0.65]) s += anchor(x0 + W * f, y + 8);
  });
  if (front) s += `<path d="M${x0 + W / 2 - 3} 0v7a3 3 0 0 1 6 0v-7z" fill="#3b2a20" stroke="${LIME}" stroke-width="0.6"/>`;
  return s;
}

function sideArt(x0: number, sign: boolean) {
  let s = brick(x0, D, H);
  // a cross gable in the middle: its bay set off with pilasters, the round window up top
  const m = x0 + D / 2;
  s += r(m - 7, 2.2, 0.8, H - 5.4, BRICK2) + r(m + 6.2, 2.2, 0.8, H - 5.4, BRICK2);
  s += rose(m, 30, 3.4);
  FLOORS.forEach((y, k) => {
    for (const f of [0.1, 0.24, 0.38, 0.62, 0.76, 0.9]) s += arched(x0 + D * f - 2.4, y, 4.8, k === 0 ? 6 : 7);
    if (k !== 2) s += arched(m - 2.4, y, 4.8, 7);
    for (const f of [0.17, 0.31, 0.69, 0.83]) s += anchor(x0 + D * f, y + 8);
  });
  if (sign) {
    s += `<g transform="translate(${x0 + D * 0.24} 9.6) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.2" fill="#2a2420" textLength="${D * 0.3}" lengthAdjust="spacingAndGlyphs">Stadsbibliotek</text></g>`;
    s += `<path d="M${m - 2.4} 0v8a2.4 2.4 0 0 1 4.8 0v-8z" fill="#3b2a20" stroke="${LIME}" stroke-width="0.5"/>`;
  }
  return s;
}

const art: Art = (p: Panel) => {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'front': return gableArt(b.x0, true);
    case 'back': return gableArt(b.x0, false);
    case 'right': return sideArt(b.x0, true);
    case 'left': return sideArt(b.x0, false);
    case 'roof1': case 'roof2': {
      let s = tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, SLATE, SLATE2);
      // a copper ridge, a few lead dormers low on the slope
      if (p.id === 'roof2') s += r(b.x0, b.y0, b.w, 1.2, '#6ea58b');
      else {
        s += r(b.x0, b.y0 + b.h - 1.2, b.w, 1.2, '#6ea58b');
        for (const f of [0.25, 0.5, 0.75]) s += r(b.x0 + b.w * f - 2, b.y0 + 4, 4, 3.4, '#6ea58b') + r(b.x0 + b.w * f - 1.2, b.y0 + 4.6, 2.4, 2, GLASS);
      }
      return s;
    }
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    default: return '';
  }
};

// the gables' backs show over the roof: brick there too, the copings
const backArt: Art = (p: Panel) => {
  if (p.kind !== 'gable') return '';
  const b = box(p);
  let s = r(b.x0, H - 2, W, R + 10, BRICK);
  for (let y = H - 2 + 1.3; y < H + R + 8; y += 1.3) s += line(b.x0, y, b.x0 + W, y, BRICK2, 0.13);
  tops.forEach((t, c) => { s += r(b.x0 + c * cw, t - 1.2, cw, 1.2, LIME); });
  return s;
};

export const slottet: Model = { id: 'slottet', name: 'Slottet', where: 'Stadsbiblioteket', net: makeSlottet(), art, backArt };
