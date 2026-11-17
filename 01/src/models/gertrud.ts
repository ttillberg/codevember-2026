import { box, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { rect, type Net, type Panel, type V2 } from '../net';
import { DEG } from '../net';
import { tabOff, type Model } from './model';

// S:t Gertrud: a merchant's house of the old town, red brick, its gables stepped, standing up
// above the roof at both ends. The gabled house's net with stepped gables: the steps rise past
// the roof's line, so the roof hangs off the right wall and is held by the left wall's eave tab,
// its ends tucked inside the gables.

const W = 40, D = 48, H = 44, R = 22, T = 6, STEPS = 3;
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

export function makeGertrud(): Net {
  const xR = W, xB = W + D, xL = 2 * W + D, xE = 2 * W + 2 * D;
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'> & { origin?: V2 }) => panels.push({ origin: p.origin ?? p.poly[0], ...p } as Panel);
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
const BRICK = '#a8432f';
const BRICK2 = '#8c3524';
const LIME = '#efe7d6';
const sash: WindowStyle = { frame: LIME, glass: '#34403f', bars: 'six' };

function brick(x0: number, w: number, h: number) {
  let s = r(x0, 0, w, h, BRICK);
  for (let y = 1.4; y < h; y += 1.4) s += line(x0, y, x0 + w, y, BRICK2, 0.15);
  return s;
}
// a blind pointed niche, plastered white
const niche = (x: number, y: number, w: number, h: number) =>
  `<path d="M${x} ${y}h${w}v${h}l${-w / 2} ${w * 0.6}l${-w / 2} ${-w * 0.6}z" fill="${LIME}"/>`;

function gableArt(x0: number, front: boolean) {
  let s = brick(x0, W, H + R + 8);
  // copings on every step
  tops.forEach((t, c) => { s += r(x0 + c * cw, t - 1.2, cw, 1.2, LIME); });
  // niches up the gable, windows below
  tops.forEach((t, c) => { if (t - H > 8) s += niche(x0 + c * cw + cw * 0.25, H + 2, cw * 0.5, Math.min(t - H - 8, 18)); });
  for (const y of [6, 24]) for (const f of [0.22, 0.5, 0.78]) s += window(x0 + W * f - 2.6, y, 5.2, 9, sash);
  if (front) s += r(x0 + W / 2 - 3.5, 0, 7, 12, '#4b3426', `stroke="${LIME}" stroke-width="0.8"`);
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'front': return gableArt(b.x0, true);
    case 'back': return gableArt(b.x0, false);
    case 'right': case 'left': {
      let s = brick(b.x0, D, H);
      for (const y of [6, 24]) for (const f of [0.2, 0.4, 0.6, 0.8]) s += window(b.x0 + D * f - 2.6, y, 5.2, 9, sash);
      return s;
    }
    case 'roof1': case 'roof2': return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, '#a9553a', '#86412b');
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    default: return '';
  }
}

export const gertrud: Model = { id: 'gertrud', name: 'S:t Gertrud', where: 'Östergatan', net: makeGertrud(), art };
