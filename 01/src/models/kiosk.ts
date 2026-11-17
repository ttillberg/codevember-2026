import { C, box, line, onPanel, r, tabArt } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeTower, towerGeo, type TowerSpec } from './tower';

// The Rikstelefon on Lilla torg: an old telephone kiosk, green, square, a little pointed roof,
// a lattice skirt round its foot and the enamel sign over the door.

const spec: TowerSpec = { n: 4, rb: 8 * Math.SQRT2, rt: 8.5 * Math.SQRT2, h: 30, hc: 9, t: 4, tc: 3 };
const { sb, hs, st, hcap } = towerGeo(spec);
const GREEN = '#5f7f62';
const GREEN2 = '#48644b';

function sideArt(k: number) {
  const w = sb / 2 + 1;
  let s = r(-w, 0, 2 * w, hs + 1, GREEN);
  // the lattice skirt, a plinth band, panels and glass, a cornice
  s += r(-w, 0, 2 * w, 7, '#7a3a2c');
  for (let x = -w; x < w; x += 1.6) s += line(x, 0, x + 7, 7, '#d8c9b0', 0.35) + line(x, 7, x + 7, 0, '#d8c9b0', 0.35);
  s += r(-w, 7, 2 * w, 1.2, GREEN2);
  s += r(-5.5, 9.5, 11, 10, GREEN2) + r(-4.5, 20.5, 9, 6, '#cfe0dc', `stroke="${GREEN2}" stroke-width="0.6"`);
  s += line(0, 9.5, 0, 26.5, GREEN, 0.5);
  s += r(-w, hs - 2, 2 * w, 2, GREEN2);
  if (k === 0) {
    s += r(-5, hs - 5.4, 10, 3, '#f3efe5', `stroke="${C.ink}" stroke-width="0.25"`);
    s += `<g transform="translate(0 ${hs - 4.6}) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="1.6" fill="#a3302a" textLength="8.6" lengthAdjust="spacingAndGlyphs">RIKSTELEFON</text></g>`;
  }
  return s;
}

const capArt = () => {
  let s = r(-st, 0, 2 * st, hcap + 1, '#6f8f75');
  for (let x = -st; x <= st; x += 1.5) s += line(x, 0, x * 0.15, hcap, '#58765d', 0.3);
  return s;
};

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  if (p.id === 'base') { const b = box(p); return r(b.x0, b.y0, b.w, b.h, '#8f8a80'); }
  if (p.id.startsWith('side-')) return onPanel(p, sideArt(+p.id.slice(5)));
  if (p.id.startsWith('cap-')) return onPanel(p, capArt());
  return '';
}

export const kiosk: Model = { id: 'kiosk', name: 'Rikstelefon', where: 'Lilla torg', net: makeTower(spec), art };
