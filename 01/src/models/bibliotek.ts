import { box, line, r, tabArt } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeShed } from './shed';

// Stadsbiblioteket: the Calendar of Light, the library's glass hall by the park. Big panes in a
// light frame, the trees and the old brick library showing in the glass, a pale flat roof.

const W = 66, D = 46, H = 40;
const FRAME = '#e9ece8';

function glass(x0: number, w: number, h: number, reflect: boolean) {
  let s = r(x0, 0, w, h + 1, '#9fb8b4');
  // the park and the old building in the glass
  if (reflect) {
    for (let k = 0; k < 14; k++) s += `<ellipse cx="${x0 + ((k * 23) % w)}" cy="${8 + (k % 3) * 3}" rx="${4 + (k % 4)}" ry="${5 + (k % 3)}" fill="#6f9273" opacity="0.55"/>`;
    s += r(x0 + w * 0.55, 0, w * 0.3, 22, '#a8665a', 'opacity="0.35"');
  }
  s += r(x0, 0, w, h + 1, '#ffffff', 'opacity="0.08"');
  // the frame: mullions, two transoms, a heavier edge
  for (let x = x0; x <= x0 + w + 0.1; x += w / 10) s += line(x, 0, x, h, FRAME, 0.9);
  for (const y of [h / 3, (2 * h) / 3]) s += line(x0, y, x0 + w, y, FRAME, 0.7);
  return s + r(x0, h - 1.6, w, 1.6, FRAME) + r(x0, 0, w, 1.4, '#7c847f');
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  const b = box(p);
  if (p.id === 'base') return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
  if (p.id === 'roof') return r(b.x0, b.y0, b.w, b.h, '#d8dad6') + r(b.x0 + 4, b.y0 + 4, b.w - 8, b.h - 8, '#c7cac5');
  return glass(b.x0, b.w, H, p.id === 'front' || p.id === 'right');
}

export const bibliotek: Model = { id: 'bibliotek', name: 'Ljusets kalender', where: 'Stadsbiblioteket', net: makeShed(W, D, H, H, 7), art };
