import { C, box, line, onPanel, r, shingles, tabArt, window } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeTower, towerGeo, type TowerSpec } from './tower';

// Slottsmöllan: a smock mill. An octagonal body leaning in as it rises, a pointed cap, sails
// hanging off a shaft at the top of the front.

const spec: TowerSpec = { n: 8, rb: 24, rt: 15, h: 58, hc: 17, sails: { s: 11, sw: 8, b: 23 } };
const { sb, st, hs, hcap } = towerGeo(spec);
const { s: S, sw: SW, b: B } = spec.sails!;

const TAR = '#3a3531';
const TAR2 = '#2a2623';
const CAP = '#7b3a2a';
const CAP2 = '#5e2a1e';
const WOOD = '#6b5240';
const STONE = '#9a958b';
const SAIL = '#efe9dc';

function sideArt(k: number) {
  const W = sb / 2 + 2;
  let s = shingles(-W, W, 0, hs + 1, TAR, TAR2);
  // a stone foot and a white band under the eave
  s += r(-W, 0, 2 * W, 7, STONE) + line(-W, 7, W, 7, C.ink, 0.4);
  s += r(-W, hs - 2.2, 2 * W, 2.2, C.frame) + line(-W, hs - 2.2, W, hs - 2.2, C.ink, 0.3);
  const win = { frame: C.frame, bars: 'cross' as const };
  if (k === 0) {
    s += r(-4, 7, 8, 13, '#5b3a26', `stroke="${C.ink}" stroke-width="0.5"`) + line(0, 8, 0, 19, C.ink, 0.3);
    s += window(-2.5, 34, 5, 7, win);
  } else if (k % 2 === 0) {
    s += window(-2.5, 22, 5, 7, win) + window(-2, 42, 4, 6, win);
  }
  return s;
}

const capArt = () => shingles(-st, st, 0, hcap + 1, CAP, CAP2) + r(-st, 0, 2 * st, 1.4, CAP2);

function sailArt() {
  // a lattice of laths, the canvas on the back
  let s = r(-B, 0, 2 * B, 2 * B, SAIL);
  const w = SW / 2;
  for (let y = 0; y <= 2 * B; y += 2.6) s += line(-B, y, B, y, WOOD, 0.4);
  for (const x of [-w, -w / 3, w / 3, w]) s += line(x, 0, x, 2 * B, WOOD, 0.5);
  for (const y of [B - w, B - w / 3, B + w / 3, B + w]) s += line(-B, y, B, y, WOOD, 0.5);
  s += line(0, 0, 0, 2 * B, WOOD, 1.2) + line(-B, B, B, B, WOOD, 1.2);
  s += `<circle cx="0" cy="${B}" r="2" fill="${WOOD}"/>`;
  return s;
}

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  if (p.id === 'base') { const b = box(p); return r(b.x0, b.y0, b.w, b.h, '#cfc6b4'); }
  if (p.id.startsWith('side-')) return onPanel(p, sideArt(+p.id.slice(5)));
  if (p.id.startsWith('cap-')) return onPanel(p, capArt());
  if (p.id === 'shaft') return onPanel(p, r(-st, 0, 2 * st, S + 1, WOOD));
  if (p.id === 'sails') return onPanel(p, sailArt());
  return '';
}

export const mill: Model = {
  id: 'mill',
  name: 'Slottsmöllan',
  where: 'Slottsparken',
  net: makeTower(spec),
  art,
  // the sails hang print to the tower: their canvas is on the back
  backArt: (p) => (p.id === 'sails' ? onPanel(p, sailArt()) : ''),
};
