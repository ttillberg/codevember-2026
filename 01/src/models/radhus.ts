import { C, box, door, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { makeHouse, type House, type Panel } from '../net';
import type { Model } from './model';

// Gamla Väster again, the taller row: three town houses of three floors side by side, sky blue,
// yellow, red, white window surrounds, one long tiled roof. Eaves to the street.

const house: House = makeHouse(30, 96, 46, 15, 6);
const { W, D, H } = house;

const HOMES = [
  { wall: '#3d8fc6', dark: '#2f76a7' },
  { wall: '#e9bd4c', dark: '#cfa33a' },
  { wall: '#c9473a', dark: '#a8382d' },
];
const sash: WindowStyle = { frame: '#f6f3ec', glass: '#38545a', bars: 'six' };

function street(x0: number, mirror: boolean) {
  let s = '';
  const w = D / 3;
  for (let i = 0; i < 3; i++) {
    const home = HOMES[mirror ? 2 - i : i];
    const xa = x0 + i * w;
    s += r(xa, 0, w, H, home.wall) + line(xa + w, 0, xa + w, H, home.dark, 0.7);
    // white surrounds, three floors of tall windows, a door at the street
    for (const y of [17, 31]) for (const f of [0.18, 0.5, 0.82]) s += r(xa + w * f - 3.6, y - 0.8, 7.2, 11.6, '#f6f3ec') + window(xa + w * f - 2.8, y, 5.6, 10, sash);
    s += window(xa + w * 0.2 - 2.8, 4, 5.6, 9, sash) + window(xa + w * 0.8 - 2.8, 4, 5.6, 9, sash);
    s += door(xa + w / 2 - 2.8, 1.5, 5.6, 12, '#2f3a33', '#f6f3ec');
    s += r(xa, H - 2.6, w, 2.6, '#f6f3ec') + r(xa, 14.5, w, 0.8, home.dark);
  }
  s += r(x0, 0, D, 1.6, '#8f8a80');
  return s;
}

function gable(x0: number, i: number) {
  const home = HOMES[i];
  return r(x0, 0, W, H + 20, home.wall) + window(x0 + W / 2 - 2.8, H + 2, 5.6, 7, sash) + r(x0, 0, W, 1.6, '#8f8a80');
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  switch (p.id) {
    case 'front': return gable(p.origin[0], 2);
    case 'back': return gable(p.origin[0], 0);
    case 'right': return street(p.origin[0], false);
    case 'left': return street(p.origin[0], true);
    case 'roof1': case 'roof2': {
      const b = box(p);
      return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, '#bb5130', '#94401f');
    }
    case 'base': return r(p.origin[0], p.origin[1], W, D, '#b9b4aa');
    default: return r(0, 0, 0, 0, C.paper);
  }
}

export const radhus: Model = { id: 'radhus', name: 'Stadshus i rad', where: 'Gamla Väster', net: house, art };
