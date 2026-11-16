import { C, box, door, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { makeHouse, type House, type Panel } from '../net';
import { type Model } from './model';

// A half-timbered house on Lilla torg: two low storeys of dark oak and ochre plaster under a
// steep tiled roof, its gable to the square. The same net as any gabled house.

const house: House = makeHouse(42, 50, 46, 30, 7);
const { W, D, H, R } = house;

const OAK = '#4a3327';
const FILL = '#e6c88f';
const TILE = '#b5523b';
const TILE2 = '#8f3b2a';
const STONE = '#8f8a80';
const small: WindowStyle = { frame: '#f3eee2', glass: '#3f5f5c', bars: 'cross' };

const beam = (x: number, y: number, w: number, h: number) => r(x, y, w, h, OAK);

// the frame of a wall: sill, a rail at each floor, a top plate, posts between, braces at the ends
function timber(x0: number, width: number, top: number) {
  const bays = Math.max(2, Math.round(width / 8));
  const bw = width / bays;
  let s = r(x0, 0, width, top, FILL);
  s += r(x0, 0, width, 3, STONE) + beam(x0, 3, width, 1.6);
  const floor = H / 2;
  s += beam(x0, floor - 0.8, width, 1.6) + beam(x0, H - 1.8, width, 1.8);
  for (let i = 0; i <= bays; i++) s += beam(x0 + i * bw - 0.7, 3, 1.4, top - 3);
  // braces in the end bays, both floors
  for (const [y0, y1] of [[4.6, floor - 0.8], [floor + 0.8, H - 1.8]]) {
    s += line(x0 + 0.7, y0, x0 + bw - 0.7, y1, OAK, 1.1);
    s += line(x0 + width - 0.7, y0, x0 + width - bw + 0.7, y1, OAK, 1.1);
  }
  return { s, bays, bw };
}

// windows in the middle bays, small leaded panes
function windows(x0: number, bays: number, bw: number, skip: number[] = []) {
  let s = '';
  for (let i = 1; i < bays - 1; i++) {
    if (skip.includes(i)) continue;
    const cx = x0 + (i + 0.5) * bw;
    s += window(cx - 2.6, 9, 5.2, 8, small) + window(cx - 2.6, H / 2 + 5, 5.2, 8, small);
  }
  return s;
}

function gableArt(x0: number, front: boolean) {
  const { s: frame, bays, bw } = timber(x0, W, H + R);
  let s = frame;
  const doorBay = Math.floor(bays / 2);
  s += windows(x0, bays, bw, front ? [doorBay] : []);
  if (front) {
    const cx = x0 + (doorBay + 0.5) * bw;
    s += door(cx - 3.5, 4.6, 7, 14, '#3b4a3a', '#efe7d4') + window(cx - 2.6, H / 2 + 5, 5.2, 8, small);
  }
  // the gable: a collar beam, the posts run on up, a loft window, oak barge boards
  const collar = H + R * 0.45;
  s += beam(x0, collar - 0.8, W, 1.6);
  s += window(x0 + W / 2 - 2.6, H + 3, 5.2, 7, small);
  s += line(x0, H, x0 + W / 2, H + R, OAK, 2.6) + line(x0 + W, H, x0 + W / 2, H + R, OAK, 2.6);
  return s;
}

function sideArt(x0: number) {
  const { s, bays, bw } = timber(x0, D, H);
  return s + windows(x0, bays, bw);
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  switch (p.face) {
    case 'front': return gableArt(p.origin[0], true);
    case 'back': return gableArt(p.origin[0], false);
    case 'side': return sideArt(p.origin[0]);
    case 'roof': {
      const b = box(p);
      return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, TILE, TILE2);
    }
    case 'base': return r(p.origin[0], p.origin[1], W, D, '#d9d2c3');
    default: return r(0, 0, 0, 0, C.paper);
  }
}

export const lillatorg: Model = {
  id: 'lillatorg',
  name: 'Korsvirkeshus',
  where: 'Lilla torg',
  net: house,
  art,
};
