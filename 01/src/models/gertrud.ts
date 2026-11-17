import { C, line, onPanel, r, row, shingles, tabArt, window, type WindowStyle } from '../art';
import { ccw, DEG, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// S:t Gertrud, Kuntzegården: yellow ranges under tiled roofs all round a cobbled yard, in from
// Östergatan through an arch in the street range. The base is the whole block; off each of its
// edges a strip runs out: the outer wall, the roof's outer face, its inner face, the wall to
// the yard hanging down from the inner eave to stand on the base. One depth all round, so the
// hips at the outer corners and the valleys at the inner ones run at 45°. The front and back
// strips carry the tabs that close the four corners. The yard is printed on the base's back,
// the side that faces up once it is built.

const W = 84; // along Östergatan
const D = 72; // into the block
const d = 18; // a range's depth
const H = 18; // its eaves
const R = 8; // its ridge over the eaves
const T = 5;
const i = d / 2;
const s = Math.hypot(i, R); // a roof face, eave to ridge
const p = Math.atan2(R, i);
const eave = 90 - p * DEG;
const hip = Math.acos(Math.cos(p) ** 2) * DEG;

const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];

// the base's corners, going round so the front edge runs right to left, the block on its left
const corners: V2[] = [[W, 0], [0, 0], [0, -D], [W, -D]];

interface Strip { L: number; at: (u: number, v: number) => V2 }

export function makeGertrud(): Net {
  const panels: Panel[] = [];
  const add = (q: Omit<Panel, 'origin'>) => panels.push({ origin: q.poly[0], ...q });
  add({ id: 'base', kind: 'base', face: 'base', poly: ccw(corners), parent: null, hinge: null, fold: 0 });

  const strips: Strip[] = corners.map((a, k) => {
    const b = corners[(k + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = mul([b[0] - a[0], b[1] - a[1]], 1 / L);
    const o: V2 = [e[1], -e[0]]; // outward
    return { L, at: (u, v) => add2(add2(a, mul(e, u)), mul(o, v)) };
  });

  strips.forEach(({ L, at }, k) => {
    const y1 = H, y2 = H + s, y3 = H + 2 * s, y4 = 2 * H + 2 * s;
    add({ id: `wall-${k}`, kind: 'wall', face: k === 0 ? 'front' : k === 2 ? 'back' : 'side', poly: ccw([at(0, 0), at(L, 0), at(L, y1), at(0, y1)]), parent: 'base', hinge: [at(0, 0), at(L, 0)], fold: 90 });
    add({ id: `roof-${k}`, kind: 'roof', face: 'roof', poly: ccw([at(0, y1), at(L, y1), at(L - i, y2), at(i, y2)]), parent: `wall-${k}`, hinge: [at(0, y1), at(L, y1)], fold: eave });
    add({ id: `yroof-${k}`, kind: 'roof', face: 'roof', poly: ccw([at(i, y2), at(L - i, y2), at(L - d, y3), at(d, y3)]), parent: `roof-${k}`, hinge: [at(i, y2), at(L - i, y2)], fold: 2 * p * DEG });
    add({ id: `yard-${k}`, kind: 'wall', face: 'side', poly: ccw([at(d, y3), at(L - d, y3), at(L - d, y4), at(d, y4)]), parent: `yroof-${k}`, hinge: [at(d, y3), at(L - d, y3)], fold: eave });
  });

  // the corners: the front and back strips' ends glue to the side strips
  for (const k of [0, 2]) {
    const { L, at } = strips[k];
    const y1 = H, y2 = H + s;
    for (const end of [0, 1]) {
      const n = end ? (k + 1) % 4 : (k + 3) % 4;
      const u = (x: number) => (end ? L - x : x);
      // only the outer corners: a tab in an inner one (a valley, the yard's corner) would hang
      // free in the range behind it, held by nothing
      const seams: [string, V2, V2, number, number, number][] = [
        ['wall', at(u(0), 0), at(u(0), y1), 90, 45, 45],
        ['roof', at(u(0), y1), at(u(i), y2), hip, 38, 45],
      ];
      for (const [part, a, b, fold, ta, tb] of seams) {
        const parent = `${part}-${k}`;
        const face = panels.find((q) => q.id === parent)!;
        add({ id: `tab-${part}-${k}-${end}`, kind: 'tab', face: 'tab', poly: tabOff(face, a, b, part === 'wall' ? T : 4, ta, tb), parent, hinge: [a, b], fold, glue: `${part}-${n}` });
      }
    }
  }
  return { panels };
}

// --- print ---
const OCHRE = '#e3ac43';
const OCHRE2 = '#c99332';
const PLINTH = '#8d8a83';
const TIMBER = '#3e2a1e';
const TILE = '#a8683c';
const TILE2 = '#7f4a28';
const BROWN = '#5a3a2a';
const win: WindowStyle = { frame: BROWN, glass: '#3a4a4c', bars: 'cross' };

const lengths = [W, D, W, D];
const inner = (k: number) => lengths[k] - 2 * d;

function wash(L: number, h: number) {
  let o = r(-L / 2 - 1, 0, L + 2, h + 1, OCHRE);
  for (let y = 2.5; y < h; y += 2.5) o += line(-L / 2 - 1, y, L / 2 + 1, y, OCHRE2, 0.08);
  return o + r(-L / 2 - 1, 0, L + 2, 1.6, PLINTH);
}

// the arch through the street range: the yard's cobbles seen down the passage
function arch(w: number, h: number) {
  const x = -w / 2;
  return `<path d="M${x} 0V${h - w / 2}A${w / 2} ${w / 2} 0 0 0 ${w / 2} ${h - w / 2}V0Z" fill="#2c2420" stroke="${OCHRE2}" stroke-width="0.6"/>` +
    r(x + 1.2, 0, w - 2.4, 2.2, '#8f877b') + r(-1, 2.2, 2, 4, OCHRE, 'opacity="0.6"');
}

function awning(x: number, y: number, w: number) {
  return `<path d="M${x} ${y}h${w}l-0.8 -2.2h${-w + 1.6}z" fill="${BROWN}"/>` + r(x, y, w, 0.5, '#3b2519');
}

function sign(x: number, y: number, w: number, h: number, text: string, size: number) {
  return r(x - w / 2, y, w, h, '#eadfc4', `stroke="${C.ink}" stroke-width="0.2"`) +
    `<g transform="translate(${x} ${y + h * 0.3}) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, serif" font-size="${size}" fill="${BROWN}" textLength="${w - 1.5}" lengthAdjust="spacingAndGlyphs">${text}</text></g>`;
}

// the street side: two floors of windows; on Östergatan the arch, shops under awnings, the name
function outerArt(k: number) {
  const L = lengths[k];
  let o = wash(L, H);
  o += row(-L / 2, L, 10.5, Math.round(L / 9), 3.6, 5.2, win);
  if (k === 0) {
    o += arch(8, 12) + sign(0, 12.4, 13, 2.2, 'S:T GERTRUD', 1.6);
    for (const x of [-30, -20, 14, 24]) o += window(x, 2.6, 5, 5.4, { ...win, bars: 'none' }) + awning(x - 0.6, 8.4, 6.2);
    o += r(-38, 2, 3.4, 6.8, BROWN, `stroke="${C.ink}" stroke-width="0.25"`) + r(34.5, 2, 3.4, 6.8, BROWN, `stroke="${C.ink}" stroke-width="0.25"`);
  } else {
    o += row(-L / 2, L, 3.4, Math.round(L / 9), 3.6, 5.2, win);
  }
  return o;
}

// the yard side, drawn upright (the panel hangs down from its eave): the west range timbered,
// the cafe in the back range, the arch again in the front one
function yardArt(k: number) {
  const L = inner(k);
  let o = wash(L, H);
  if (k === 1) {
    for (let x = -L / 2; x <= L / 2 + 0.1; x += L / 6) o += line(x, 1.6, x, H, TIMBER, 0.8);
    for (const y of [1.6, 9, H - 0.4]) o += line(-L / 2, y, L / 2, y, TIMBER, 0.8);
    for (let x = -L / 2; x < L / 2 - 0.1; x += L / 6) o += line(x, 9, x + L / 12, H - 0.4, TIMBER, 0.6);
  }
  o += row(-L / 2, L, 10.5, Math.round(L / 8), 3.4, 5, win);
  if (k === 0) o += arch(8, 12) + row(-L / 2, L / 2 - 6, 3.4, 2, 3.4, 5, win) + row(6, L / 2 - 6, 3.4, 2, 3.4, 5, win);
  else if (k === 2) {
    o += row(-L / 2, L, 3.4, 4, 3.4, 5, win);
    o += r(-2, 1.6, 4, 7, BROWN, `stroke="${C.ink}" stroke-width="0.25"`) + sign(0, 9.4, 9, 1.8, 'PUB KUNTZE', 1.2);
  } else o += row(-L / 2, L, 3.4, Math.round(L / 8), 3.4, 5, win);
  return `<g transform="matrix(-1 0 0 -1 0 ${H})">${o}</g>`;
}

// down: drawn from the ridge, as the yard side's faces are (hinged at the ridge), so a dormer
// turns over to point up the slope
function roofArt(L: number, dormer: boolean, down = false) {
  let o = shingles(-L / 2 - 1, L / 2 + 1, 0, s + 1, TILE, TILE2, 1.5);
  if (dormer) {
    let d = '';
    for (const x of [-L / 4, L / 4]) {
      d += `<path d="M${x - 3} 2h6v4.5l-3 3.4l-3 -3.4z" fill="${OCHRE}" stroke="${TILE2}" stroke-width="0.4"/>` + window(x - 1.4, 3, 2.8, 3.4, win);
    }
    o += down ? `<g transform="matrix(-1 0 0 -1 0 ${s})">${d}</g>` : d;
  }
  return o;
}

// the yard: cobbles, a flagstone path in from the arch, the cafe's tables under parasols
function yardFloor() {
  const x0 = d, x1 = W - d, z0 = -D + d, z1 = -d;
  let o = r(x0, z0, x1 - x0, z1 - z0, '#9d968a');
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = z0; y < z1; y += 1.6) {
    for (let x = x0 + ((Math.round((y - z0) / 1.6) % 2) * 0.9); x < x1; x += 1.8) {
      o += `<rect x="${x + 0.15}" y="${y + 0.15}" width="1.5" height="1.3" rx="0.45" fill="${['#aaa398', '#958e82', '#b4ada1', '#a29a8d'][Math.floor(rnd() * 4)]}"/>`;
    }
  }
  o += r(W / 2 - 2.5, z0 + 6, 5, z1 - z0 - 6, '#c8bfae') + r(W / 2 - 2.5, z0 + 6, 5, 0.3, '#a89f8c');
  for (let y = z0 + 6; y < z1; y += 2.5) o += line(W / 2 - 2.5, y, W / 2 + 2.5, y, '#a89f8c', 0.2);
  // parasols and tables: to the left, round the back
  for (const [x, y] of [[d + 7, z0 + 7], [d + 7, z0 + 16], [d + 16, z0 + 7], [W - d - 8, z0 + 8], [W - d - 8, z0 + 18]]) {
    o += `<circle cx="${x + 0.6}" cy="${y - 0.6}" r="4" fill="rgba(40,30,20,0.25)"/><circle cx="${x}" cy="${y}" r="4" fill="#f1ead8" stroke="#cfc4aa" stroke-width="0.3"/>`;
    for (let a = 0; a < 8; a++) o += line(x, y, x + 4 * Math.cos((a * Math.PI) / 4), y + 4 * Math.sin((a * Math.PI) / 4), '#d6ccb4', 0.2);
  }
  // shrubs in planters
  for (const [x, y] of [[d + 3, z1 - 3], [W - d - 3, z1 - 3], [W / 2 + 6, z0 + 12]]) {
    o += r(x - 2, y - 2, 4, 4, '#4a4440') + `<circle cx="${x}" cy="${y}" r="2.4" fill="#5d7a45"/>`;
  }
  return o;
}

function art(q: Panel) {
  if (q.kind === 'tab') return tabArt(q);
  const k = +q.id.slice(-1);
  if (q.id === 'base') return r(0, -D, W, D, '#cfc6b4');
  if (q.id.startsWith('wall-')) return onPanel(q, outerArt(k));
  if (q.id.startsWith('yard-')) return onPanel(q, yardArt(k));
  if (q.id.startsWith('roof-')) return onPanel(q, roofArt(lengths[k], k === 0));
  if (q.id.startsWith('yroof-')) return onPanel(q, roofArt(lengths[k] - d, k === 2, true));
  return '';
}

const backArt = (q: Panel) => (q.id === 'base' ? yardFloor() : '');

export const gertrud: Model = { id: 'gertrud', name: 'S:t Gertrud', where: 'Östergatan', net: makeGertrud(), art, backArt };
