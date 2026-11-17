import { C, box, line, onPanel, poly, r, tabArt } from '../art';
import type { Panel, V2 } from '../net';
import type { Model } from './model';
import { makeTower, towerGeo, type TowerSpec } from './tower';

// S:t Petri kyrka's tower: red brick, square, under a tall copper spire gone green.

const spec: TowerSpec = { n: 4, rb: 15 * Math.SQRT2, rt: 15 * Math.SQRT2, h: 74, hc: 80, t: 6, tc: 4 };
const { sb, hs, st, hcap } = towerGeo(spec);

const BRICK = '#8e3f2c';
const BRICK2 = '#73301f';
const LIME = '#e4d9c3';
const COPPER = '#6ea58b';
const COPPER2 = '#548a71';

// a pointed arch window, its tracery a mullion
function lancet(x: number, y: number, w: number, h: number, glass = '#2e3f44') {
  const pts: V2[] = [[x, y], [x + w, y], [x + w, y + h], [x + w / 2, y + h + w * 0.75], [x, y + h]];
  return poly(pts, LIME, `stroke="${C.ink}" stroke-width="0.4"`) +
    poly(pts.map(([px, py]): V2 => [x + w / 2 + (px - x - w / 2) * 0.72, y + 0.8 + (py - y) * 0.92]), glass) +
    line(x + w / 2, y + 1, x + w / 2, y + h + w * 0.55, LIME, 0.5);
}

function sideArt(k: number) {
  const W = sb / 2 + 1;
  let s = r(-W, 0, 2 * W, hs + 1, BRICK);
  for (let y = 1.6; y < hs; y += 1.6) s += line(-W, y, W, y, BRICK2, 0.18);
  // a limestone plinth, string courses, a cornice
  s += r(-W, 0, 2 * W, 5, LIME) + line(-W, 5, W, 5, C.ink, 0.3);
  for (const y of [26, 50]) s += r(-W, y, 2 * W, 1.4, LIME);
  s += r(-W, hs - 3, 2 * W, 3, LIME) + line(-W, hs - 3, W, hs - 3, C.ink, 0.3);
  // blind arcades low down, tall belfry openings up top, a clock on the front
  for (const x of [-10, -3.5, 3]) s += lancet(x, 9, 6.5, 11, BRICK2);
  s += lancet(-9.5, 30, 6, 14) + lancet(3.5, 30, 6, 14);
  s += lancet(-11, 54, 8, 9) + lancet(3, 54, 8, 9);
  if (k === 0) {
    s += lancet(-4, 0.2, 8, 9, '#3b2a20');
    s += `<circle cx="0" cy="${hs - 9.5}" r="3.6" fill="${LIME}" stroke="${C.ink}" stroke-width="0.4"/>` +
      line(0, hs - 9.5, 0, hs - 7, C.ink, 0.5) + line(0, hs - 9.5, 1.8, hs - 9.5, C.ink, 0.5);
  }
  return s;
}

function spireArt() {
  // standing seams to the point, a band of dormer slits low down
  let s = r(-st, 0, 2 * st, hcap + 1, COPPER);
  for (let x = -st; x <= st; x += 2.2) s += line(x, 0, x * 0.1, hcap, COPPER2, 0.35);
  s += r(-st, 0, 2 * st, 1.8, COPPER2);
  s += poly([[-1.6, 10], [1.6, 10], [0, 15]], '#33473f');
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  if (p.id === 'base') { const b = box(p); return r(b.x0, b.y0, b.w, b.h, '#cfc6b4'); }
  if (p.id.startsWith('side-')) return onPanel(p, sideArt(+p.id.slice(5)));
  if (p.id.startsWith('cap-')) return onPanel(p, spireArt());
  return '';
}

export const petri: Model = {
  id: 'petri',
  name: 'S:t Petri',
  where: 'Gamla staden',
  net: makeTower(spec),
  art,
};
