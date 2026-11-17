import { box, line, r, tabArt } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeShed } from './shed';

// Malmö Live: three buildings by the canal. The hotel tower, tall and dark, its glass in slanting
// bands; the concert hall, a low wide box wrapped in a screen of pale fins; the congress hall
// between, its glass broken into a pixel pattern of light and dark panes.

const pane = (x: number, y: number, w: number, h: number, c: string) => r(x, y, w, h, c);

// the tower's skin: dark glass, its floor lines leaning, a light pane here and there
function towerSkin(x0: number, w: number, h: number) {
  let s = r(x0, 0, w, h + 20, '#3d4a52');
  for (let y = -w; y < h + 20; y += 3.2) s += line(x0, y, x0 + w, y + w * 0.18, '#56656e', 0.5);
  for (let k = 0; k < 40; k++) s += pane(x0 + ((k * 13) % (w - 3)), (k * 29) % h, 3, 2, '#8fb0bd');
  return s + r(x0, 0, w, 5, '#20282d');
}

// the concert hall's fins: pale vertical slats, warm light between them
function finSkin(x0: number, w: number, h: number) {
  let s = r(x0, 0, w, h + 20, '#d9a95e');
  for (let x = x0 + 0.8; x < x0 + w; x += 2) s += r(x, 0, 1.2, h + 20, '#e9e5dc');
  return s + r(x0, 0, w, 3, '#2e3133');
}

// the congress hall: a grid of panes, some lit
function pixelSkin(x0: number, w: number, h: number) {
  let s = r(x0, 0, w, h + 20, '#4b5a63');
  let k = 0;
  for (let y = 2; y < h; y += 3) for (let x = x0; x < x0 + w; x += 3) {
    const c = (k++ * 7919) % 11;
    if (c < 3) s += pane(x + 0.3, y + 0.3, 2.4, 2.4, c === 0 ? '#e6eef0' : '#9fb7bf');
  }
  return s + r(x0, 0, w, 4, '#2a3236');
}

function roofArt(p: Panel, c: string) {
  const b = box(p);
  return r(b.x0, b.y0, b.w, b.h, c) + r(b.x0 + b.w * 0.25, b.y0 + b.h * 0.3, b.w * 0.3, b.h * 0.25, '#8b9196');
}

function artFor(skin: (x0: number, w: number, h: number) => string, roof: string) {
  return (p: Panel) => {
    if (p.kind === 'tab') return tabArt(p);
    const b = box(p);
    if (p.id === 'base') return r(b.x0, b.y0, b.w, b.h, '#b9b4aa');
    if (p.id === 'roof') return roofArt(p, roof);
    return skin(b.x0, b.w, b.y1);
  };
}

export const liveHotel: Model = { id: 'live-hotel', name: 'Malmö Live, hotellet', where: 'Dockplatsen', net: makeShed(30, 26, 150, 156, 7), art: artFor(towerSkin, '#2e353a') };
export const liveConcert: Model = { id: 'live-concert', name: 'Malmö Live, konserthuset', where: 'Dockplatsen', net: makeShed(72, 50, 38, 38, 7), art: artFor(finSkin, '#cfcac0') };
export const liveCongress: Model = { id: 'live-congress', name: 'Malmö Live, kongressen', where: 'Dockplatsen', net: makeShed(52, 40, 60, 60, 7), art: artFor(pixelSkin, '#b3b0a8') };
