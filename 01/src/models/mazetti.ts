import { C, box, line, r, tabArt, tiles, window, type WindowStyle } from '../art';
import { makeHouse, type House, type Panel } from '../net';
import type { Model } from './model';

// Mazetti: the old cocoa ad on a firewall in Gamla Väster. A tall house whose gable to the
// lane is bare and white, MAZETTI'S ÖGON-CACAO painted across it; brick down the sides.

const house: House = makeHouse(56, 34, 66, 20, 7);
const { W, D, H } = house;
const BRICK = '#b0694a';
const BRICK2 = '#93553a';
const sash: WindowStyle = { frame: '#f3eee4', glass: '#3e4a4a', bars: 'six' };

// painted letters: text in sheet space, flipped back upright
const text = (x: number, y: number, size: number, s: string, width: number, fill = '#2a2a2a', weight = 700) =>
  `<g transform="translate(${x} ${y}) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="${weight}" font-size="${size}" fill="${fill}" textLength="${width}" lengthAdjust="spacingAndGlyphs">${s}</text></g>`;

function firewall(x0: number) {
  let s = r(x0, 0, W, H + R(), '#ece9e1');
  // weathered: a few greyer patches, the plinth
  for (let k = 0; k < 6; k++) s += r(x0 + ((k * 17) % (W - 10)), 8 + k * 9, 10, 4, '#dedad0', 'opacity="0.7"');
  s += r(x0, 0, W, 3, '#8f8a80');
  s += text(x0 + W / 2, H - 3, 8.5, 'MAZETTI’S', W - 6);
  s += text(x0 + W / 2, H - 13, 6, 'ÖGON-CACAO', W - 12, '#2a2a2a', 600);
  s += text(x0 + W / 2, H - 24, 3.6, 'Holländsk', W * 0.45, '#9a978f', 400);
  return s;
}
const R = () => house.R;

function brickSide(x0: number, n: number) {
  let s = r(x0, 0, D, H, BRICK);
  for (let y = 1.6; y < H; y += 1.6) s += line(x0, y, x0 + D, y, BRICK2, 0.18);
  for (let f = 0; f < 4; f++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * (D / n) - 3, y = 6 + f * 15;
    s += r(x - 0.8, y + 10, 7.6, 1.6, '#e3d6c0') + window(x, y, 6, 10, sash);
  }
  return s + r(x0, H - 2.2, D, 2.2, '#e3d6c0');
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  switch (p.id) {
    case 'front': return firewall(p.origin[0]);
    case 'back': {
      let s = r(p.origin[0], 0, W, H + R(), BRICK);
      for (let y = 1.6; y < H + R(); y += 1.6) s += line(p.origin[0], y, p.origin[0] + W, y, BRICK2, 0.18);
      return s;
    }
    case 'right': case 'left': return brickSide(p.origin[0], 2);
    case 'roof1': case 'roof2': {
      const b = box(p);
      return tiles(b.x0, b.y0, b.w, b.h, Math.abs(b.y0 - H) < 1e-6, '#5b5653', '#433f3c');
    }
    case 'base': return r(p.origin[0], p.origin[1], W, D, '#b9b4aa');
    default: return r(0, 0, 0, 0, C.paper);
  }
}

export const mazetti: Model = { id: 'mazetti', name: 'Mazetti', where: 'Gamla Väster', net: house, art };
