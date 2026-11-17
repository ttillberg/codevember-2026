import { box, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeTorget, type BaySpec } from './torget';

// Västra skolan: the old school by the park, three tall floors of red brick banded in white, a
// gabled bay with a clock in the middle, a slate roof along the street. The red house's net, a
// stone ledge at the foot where that has its awning.

const S: BaySpec = { W: 88, D: 34, H: 56, R: 14, T: 6, HC: 7, CD: 2.5, CV: 1, BW: 24, U: 10, G: 12 };
const BRICK = '#b65a42';
const BRICK2 = '#9a4934';
const WHITE = '#f1ece1';
const sash: WindowStyle = { frame: WHITE, glass: '#3c4b50', bars: 'six' };

function brick(x0: number, y0: number, w: number, h: number) {
  let s = r(x0, y0, w, h, BRICK);
  for (let y = y0 + 1.5; y < y0 + h; y += 1.5) s += line(x0, y, x0 + w, y, BRICK2, 0.14);
  return s;
}
// tall school windows, round-headed on the bay
const tall = (x: number, y: number) => r(x - 0.8, y - 0.8, 7.6, 13.6, WHITE) + window(x, y, 6, 12, { ...sash, sill: false });

function frontArt(x0: number, y0: number) {
  const HU = S.H - S.HC - S.CV;
  const xb = x0 + (S.W - S.BW) / 2;
  let s = brick(x0, y0, S.W, HU + S.U + S.G + 1);
  for (const y of [y0 + 3, y0 + 19, y0 + 35]) {
    for (let x = x0 + 5; x < xb - 6; x += 10) s += tall(x, y);
    for (let x = xb + S.BW + 3; x < x0 + S.W - 6; x += 10) s += tall(x, y);
    s += tall(xb + S.BW / 2 - 3, y);
    s += r(x0, y + 14.5, S.W, 1.2, WHITE);
  }
  // the bay: white corners, a clock under its gable
  s += r(xb, y0, 1.2, HU + S.U, WHITE) + r(xb + S.BW - 1.2, y0, 1.2, HU + S.U, WHITE);
  s += `<circle cx="${xb + S.BW / 2}" cy="${y0 + HU + S.U - 1}" r="4" fill="${WHITE}" stroke="#2a2a2a" stroke-width="0.4"/>` + line(xb + S.BW / 2, y0 + HU + S.U - 1, xb + S.BW / 2, y0 + HU + S.U + 2, '#2a2a2a', 0.5) + line(xb + S.BW / 2, y0 + HU + S.U - 1, xb + S.BW / 2 + 2, y0 + HU + S.U - 1, '#2a2a2a', 0.5);
  s += r(x0, y0 + HU - 2, (S.W - S.BW) / 2, 2, WHITE) + r(xb + S.BW, y0 + HU - 2, (S.W - S.BW) / 2, 2, WHITE);
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    case 'shop': {
      let s = r(b.x0, 0, S.W, S.HC + 1, '#9d978b');
      for (let x = b.x0 + 4; x < b.x0 + S.W; x += 10) s += window(x, 1.5, 6, 4, { ...sash, sill: false });
      return s + r(b.x0 + S.W / 2 - 4, 0, 8, S.HC, '#4a3a2c');
    }
    case 'under': case 'awning': return r(b.x0, b.y0, b.w, b.h, '#8b867c');
    case 'front': return frontArt(b.x0, b.y0);
    case 'back': {
      let s = brick(b.x0, 0, S.W, S.H);
      for (const y of [8, 24, 40]) for (let x = b.x0 + 5; x < b.x1 - 6; x += 10) s += tall(x, y);
      return s;
    }
    case 'right': case 'left': {
      let s = brick(b.x0, 0, S.D, S.H + S.R);
      for (const y of [8, 24, 40]) s += tall(b.x0 + S.D / 2 - 3, y);
      return s;
    }
    default: return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - S.H) < 1e-6, '#5e6266', '#46494c');
  }
}

export const skola: Model = { id: 'skola', name: 'Västra skolan', where: 'Kungsparken', net: makeTorget(S), art };
