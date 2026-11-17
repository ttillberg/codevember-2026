import { C, box, line, r, tabArt, window, type WindowStyle } from '../art';
import { makeHouse, type House, type Panel } from '../net';
import type { Model } from './model';

// Ribersborgs kallbadhus: the cold bath house out on the water, 1898. A long low building of
// pale wooden boards with white trim on its pier, a gentle roof of grey felt, the name over the
// door, the sea showing under it.

const house: House = makeHouse(30, 92, 24, 9, 6);
const { W, D, H } = house;
const BOARD = '#c9d6cf';
const BOARD2 = '#adbdb5';
const sash: WindowStyle = { frame: '#f8f6f0', glass: '#4f6a72', bars: 'cross' };

function boards(x0: number, w: number, top: number) {
  let s = r(x0, 0, w, top, BOARD);
  for (let y = 7; y < top; y += 1.6) s += line(x0, y, x0 + w, y, BOARD2, 0.3);
  // the pier and the water under it
  s += r(x0, 0, w, 6, '#4e7d8f');
  for (let x = x0 + 3; x < x0 + w; x += 7) s += r(x, 0, 1.3, 6, '#6e5a46');
  s += r(x0, 6, w, 1, '#8b7357') + r(x0, H - 1.6, w, 1.6, C.frame);
  return s;
}

function side(x0: number, sign: boolean) {
  let s = boards(x0, D, H);
  for (let x = x0 + 5; x < x0 + D - 6; x += 8) s += window(x, 11, 5, 7, sash);
  if (sign) {
    s += r(x0 + D / 2 - 18, 18.6, 36, 3.4, C.frame, `stroke="${C.ink}" stroke-width="0.25"`);
    s += `<g transform="translate(${x0 + D / 2} 19.5) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="2.2" fill="#2e4a55" textLength="33" lengthAdjust="spacingAndGlyphs">RIBERSBORGS KALLBADHUS</text></g>`;
    s += r(x0 + D / 2 - 3, 7, 6, 10, '#2e4a55', `stroke="${C.frame}" stroke-width="0.6"`);
  }
  return s;
}

function gable(x0: number) {
  let s = boards(x0, W, H + 12);
  s += line(x0, H, x0 + W / 2, H + 9, C.frame, 1.1) + line(x0 + W, H, x0 + W / 2, H + 9, C.frame, 1.1);
  return s + window(x0 + W / 2 - 3, 11, 6, 7, sash);
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  switch (p.id) {
    case 'front': case 'back': return gable(p.origin[0]);
    case 'right': return side(p.origin[0], true);
    case 'left': return side(p.origin[0], false);
    case 'roof1': case 'roof2': {
      let s = r(b.x0, b.y0, b.w, b.h, '#6f7678');
      for (let x = b.x0 + 4; x < b.x1; x += 5) s += line(x, b.y0, x, b.y1, '#5d6466', 0.5);
      return s;
    }
    case 'base': return r(b.x0, b.y0, b.w, b.h, '#8b7357');
    default: return '';
  }
}

export const kallbad: Model = { id: 'kallbad', name: 'Kallbadhuset', where: 'Ribersborg', net: house, art };
