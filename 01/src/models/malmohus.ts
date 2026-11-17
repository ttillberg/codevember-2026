import { C, box, line, onPanel, r, shingles, tabArt } from '../art';
import type { Panel } from '../net';
import type { Model } from './model';
import { makeTower, towerGeo, type TowerSpec } from './tower';

// A rundel of Malmöhus: a squat round gun tower of red brick, ten-sided here, a low cone of
// slate on top.

const spec: TowerSpec = { n: 10, rb: 30, rt: 29, h: 32, hc: 15, t: 5, tc: 3.2 };
const { sb, hs, st, hcap } = towerGeo(spec);

const BRICK = '#a14b34';
const BRICK2 = '#853a26';
const LIME = '#e6dcc6';
const SLATE = '#4d5154';
const SLATE2 = '#3a3e41';

function sideArt(k: number) {
  const W = sb / 2 + 1;
  let s = r(-W, 0, 2 * W, hs + 1, BRICK);
  for (let y = 1.5; y < hs; y += 1.5) s += line(-W, y, W, y, BRICK2, 0.18);
  // a battered stone foot, a limestone band, the parapet
  s += r(-W, 0, 2 * W, 4, '#8f897e') + line(-W, 4, W, 4, C.ink, 0.3);
  s += r(-W, 18, 2 * W, 1.6, LIME);
  s += r(-W, hs - 2.4, 2 * W, 2.4, LIME) + line(-W, hs - 2.4, W, hs - 2.4, C.ink, 0.3);
  // gun ports, every other side; a gate on the front
  if (k % 2 === 0) s += `<ellipse cx="0" cy="11" rx="2.4" ry="1.6" fill="#231d19" stroke="${LIME}" stroke-width="0.7"/>`;
  else s += r(-0.6, 21.5, 1.2, 5, '#231d19');
  if (k === 0) s += r(-3.5, 4, 7, 9, '#4a3324', `stroke="${LIME}" stroke-width="0.8"`);
  return s;
}

const capArt = () => shingles(-st, st, 0, hcap + 1, SLATE, SLATE2, 2) + r(-st, 0, 2 * st, 1.2, SLATE2);

function art(p: Panel) {
  if (p.kind === 'tab') return tabArt(p);
  if (p.id === 'base') { const b = box(p); return r(b.x0, b.y0, b.w, b.h, '#cfc6b4'); }
  if (p.id.startsWith('side-')) return onPanel(p, sideArt(+p.id.slice(5)));
  if (p.id.startsWith('cap-')) return onPanel(p, capArt());
  return '';
}

export const malmohus: Model = {
  id: 'malmohus',
  name: 'Malmöhus',
  where: 'Slottsholmen',
  net: makeTower(spec),
  art,
};
