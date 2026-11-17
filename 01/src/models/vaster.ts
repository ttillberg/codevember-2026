import { C, box, door, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { makeHouse, type House, type Panel } from '../net';
import type { Model } from './model';

// Gamla Väster: a row of low houses, eaves to the cobbles, each its own colour (red, ochre,
// white), one long roof of orange tiles with moss in patches, skylights in it. The gabled house's
// net turned long and low: the side walls are the street.

const house: House = makeHouse(34, 84, 22, 17, 6);
const { W, D, H } = house;

const HOMES = [
  { wall: '#b8452f', dark: '#9a3826' },
  { wall: '#e2b65c', dark: '#c79c45' },
  { wall: '#f1e9d6', dark: '#d8cdb5' },
];
const sash: WindowStyle = { frame: '#f6f2ea', glass: '#5d6f72', bars: 'six' };
const TILE = '#c45a34';
const TILE2 = '#9e4527';

// a street front: three homes along it, windows and a door each, a stone plinth
function street(x0: number, mirror: boolean) {
  let s = '';
  const w = D / 3;
  for (let i = 0; i < 3; i++) {
    const home = HOMES[mirror ? 2 - i : i];
    const xa = x0 + i * w;
    s += r(xa, 0, w, H, home.wall) + line(xa + w, 0, xa + w, H, home.dark, 0.6);
    s += window(xa + 3, 6, 6, 10, sash) + window(xa + w - 9, 6, 6, 10, sash);
    s += door(xa + w / 2 - 2.6, 2, 5.2, 13, i === 1 ? '#e9e4da' : '#5a4636', '#f6f2ea');
    s += r(xa + w / 2 - 1.4, 17.5, 2.8, 1.6, '#3a3632'); // a lamp
  }
  s += r(x0, 0, D, 2, '#9a958c') + line(x0, 2, x0 + D, 2, C.ink, 0.3);
  // gutter under the eave
  s += r(x0, H - 1.2, D, 1.2, '#5c5650');
  return s;
}

function gable(x0: number, i: number) {
  const home = HOMES[i];
  let s = r(x0, 0, W, H + 20, home.wall);
  s += r(x0, 0, W, 2, '#9a958c');
  s += window(x0 + W / 2 - 3, 6, 6, 9, sash) + window(x0 + W / 2 - 2.5, H + 3, 5, 6, sash);
  return s;
}

// old tiles, moss in patches, a skylight over each home, a chimney stack
function roof(p: Panel, street: boolean) {
  const b = box(p);
  const eaveAtBottom = Math.abs(b.y0 - H) < 1e-6;
  let s = tiles(b.x0, b.y0, b.w, b.h, eaveAtBottom, TILE, TILE2);
  for (let k = 0; k < 9; k++) {
    const x = b.x0 + ((k * 37) % 80) + 2, y = b.y0 + ((k * 13) % Math.max(1, b.h - 6)) + 2;
    s += `<ellipse cx="${x}" cy="${y}" rx="${4 + (k % 3)}" ry="2.2" fill="#7f8045" opacity="0.5"/>`;
  }
  if (street) for (let i = 0; i < 3; i++) {
    const x = b.x0 + (i + 0.5) * (D / 3) - 3;
    const y = eaveAtBottom ? b.y0 + b.h * 0.45 : b.y1 - b.h * 0.45 - 7;
    s += r(x, y, 6, 7, '#2e3b3f', `stroke="${C.frame}" stroke-width="0.6"`) + line(x, y + 3.5, x + 6, y + 3.5, C.frame, 0.4);
  }
  else s += r(b.x0 + D * 0.62, eaveAtBottom ? b.y1 - 6 : b.y0 + 1, 5, 5, '#c9b18a', `stroke="${C.ink}" stroke-width="0.3"`);
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  switch (p.id) {
    case 'front': return gable(p.origin[0], 2);
    case 'back': return gable(p.origin[0], 0);
    case 'right': return street(p.origin[0], false);
    case 'left': return street(p.origin[0], true);
    case 'roof1': return roof(p, true);
    case 'roof2': return roof(p, false);
    case 'base': return r(p.origin[0], p.origin[1], W, D, '#b9b4aa');
    default: return '';
  }
}

export const vaster: Model = {
  id: 'vaster',
  name: 'Längor',
  where: 'Gamla Väster',
  net: house,
  art,
};
