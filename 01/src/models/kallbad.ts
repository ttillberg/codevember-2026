import { C, framed, line, r, tabArt, window, type WindowStyle } from '../art';
import { ccw, DEG, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// Ribersborgs kallbadhus: the cold bath out on the water, 1898, reached by a long pier. A ring of
// low board ranges round the bathing pools, the back corner cut off on the slant, the gate where
// the pier comes in. The base is the whole deck, pier and all; off each of its edges a strip runs
// out as at S:t Gertrud: the outer wall, the roof's two faces, the inner wall hanging down to
// stand on the deck. The pier is in the way of the front strip, so that one hangs off the right
// wall's end instead and comes round to stand across the pier's foot; the gate is printed on it.
// The pier's rails fold up off its edges. The deck, the pools and the pier's boards are printed
// on the base's back, the side that faces up once built.

const W = 96; // the front
const D = 72; // deep
const CH = 36; // the back left corner cut off
const G = 12; // the pier's width
const P = 110; // its length
const d = 14; // a range's depth
const H = 12; // its eaves
const R = 4; // its ridge over the eaves
const T = 5;
const RAIL = 3.5;
const i = d / 2;
const s = Math.hypot(i, R); // a roof face, eave to ridge
const p = Math.atan2(R, i);
const eave = 90 - p * DEG;
const gx0 = W / 2 - G / 2, gx1 = W / 2 + G / 2;

const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];

// the deck's corners, going round so the front runs right to left, the deck on its left
const corners: V2[] = [[W, 0], [0, 0], [0, -D + CH], [CH, -D], [W, -D]];
const n = corners.length;
// at each corner: its turn (degrees) and how far a line d in from the walls runs along each wall
const turn = corners.map((c, k) => {
  const a = corners[(k + n - 1) % n], b = corners[(k + 1) % n];
  const u = Math.atan2(c[1] - a[1], c[0] - a[0]), v = Math.atan2(b[1] - c[1], b[0] - c[0]);
  return (((v - u) * DEG + 540) % 360) - 180;
});
const cot = turn.map((t) => Math.tan(t / 2 / DEG)); // cot of half the inside angle
// the bend between two roof faces across a hip, the walls turning t
const hip = (t: number) => Math.acos(Math.sin(p) ** 2 * Math.cos(t / DEG) + Math.cos(p) ** 2) * DEG;

interface Strip { L: number; e: V2; at: (u: number, v: number) => V2; c0: number; c1: number }

const y1 = H, y2 = H + s, y3 = H + 2 * s, y4 = 2 * H + 2 * s;

function strips(): Strip[] {
  const out: Strip[] = corners.map((a, k) => {
    const b = corners[(k + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = mul([b[0] - a[0], b[1] - a[1]], 1 / L);
    const o: V2 = [e[1], -e[0]]; // outward
    return { L, e, at: (u, v) => add2(add2(a, mul(e, u)), mul(o, v)), c0: cot[k], c1: cot[(k + 1) % n] };
  });
  // the front goes on round the corner from the right wall's end, flat on the sheet
  const right = out[n - 1];
  out[0] = { ...out[0], e: right.e, at: (u, v) => right.at(right.L + u, v) };
  return out;
}
const S = strips();

export function makeKallbad(): Net {
  const panels: Panel[] = [];
  const add = (q: Omit<Panel, 'origin'>) => panels.push({ origin: q.poly[0], ...q });
  const deck: V2[] = [corners[0], [gx1, 0], [gx1, P], [gx0, P], [gx0, 0], ...corners.slice(1)];
  add({
    id: 'base', kind: 'base', face: 'base', poly: ccw(deck), parent: null, hinge: null, fold: 0,
    parts: [ccw(corners), ccw([[gx0, 0], [gx1, 0], [gx1, P], [gx0, P]])],
  });
  // the pier's rails
  add({ id: 'rail-r', kind: 'wall', face: 'side', poly: ccw([[gx1, 0], [gx1 + RAIL, 0], [gx1 + RAIL, P], [gx1, P]]), parent: 'base', hinge: [[gx1, 0], [gx1, P]], fold: 90 });
  add({ id: 'rail-l', kind: 'wall', face: 'side', poly: ccw([[gx0 - RAIL, 0], [gx0, 0], [gx0, P], [gx0 - RAIL, P]]), parent: 'base', hinge: [[gx0, P], [gx0, 0]], fold: 90 });

  const strip = (k: number) => {
    const { L, at, c0, c1 } = S[k];
    const hinge: [V2, V2] = k === 0 ? [at(0, 0), at(0, y1)] : [at(0, 0), at(L, 0)];
    add({ id: `wall-${k}`, kind: 'wall', face: k === 0 ? 'front' : k === 3 ? 'back' : 'side', poly: ccw([at(0, 0), at(L, 0), at(L, y1), at(0, y1)]), parent: k === 0 ? `wall-${n - 1}` : 'base', hinge, fold: k === 0 ? turn[0] : 90 });
    add({ id: `roof-${k}`, kind: 'roof', face: 'roof', poly: ccw([at(0, y1), at(L, y1), at(L - i * c1, y2), at(i * c0, y2)]), parent: `wall-${k}`, hinge: [at(0, y1), at(L, y1)], fold: eave });
    add({ id: `yroof-${k}`, kind: 'roof', face: 'roof', poly: ccw([at(i * c0, y2), at(L - i * c1, y2), at(L - d * c1, y3), at(d * c0, y3)]), parent: `roof-${k}`, hinge: [at(i * c0, y2), at(L - i * c1, y2)], fold: 2 * p * DEG });
    add({ id: `yard-${k}`, kind: 'wall', face: 'side', poly: ccw([at(d * c0, y3), at(L - d * c1, y3), at(L - d * c1, y4), at(d * c0, y4)]), parent: `yroof-${k}`, hinge: [at(d * c0, y3), at(L - d * c1, y3)], fold: eave });
  };
  for (let k = 1; k < n; k++) strip(k);
  strip(0);

  // the corners: each strip's far end glues to the next one (the right wall and the front are
  // one piece round theirs, only the roof needs a tab); only the outer faces, as at S:t Gertrud
  for (let k = 0; k < n; k++) {
    const { L, at, c1 } = S[k];
    const next = (k + 1) % n;
    const t = turn[next];
    const sharp = t < 60; // the cut corner: a narrow gap between the strips on the sheet
    if (next !== 0) {
      const wall = panels.find((q) => q.id === `wall-${k}`)!;
      add({ id: `tab-wall-${k}`, kind: 'tab', face: 'tab', poly: tabOff(wall, at(L, 0), at(L, y1), T, sharp ? 28 : 45, 45), parent: `wall-${k}`, hinge: [at(L, 0), at(L, y1)], fold: t, glue: `wall-${next}` });
    }
    const roof = panels.find((q) => q.id === `roof-${k}`)!;
    const a = at(L, y1), b = at(L - i * c1, y2);
    add({ id: `tab-roof-${k}`, kind: 'tab', face: 'tab', poly: tabOff(roof, a, b, 4, sharp ? 24 : 38, 45), parent: `roof-${k}`, hinge: [a, b], fold: hip(t), glue: `roof-${next}` });
  }
  return { panels };
}

// --- print ---
const BOARD = '#c9d6cf';
const BOARD2 = '#a9bab2';
const TRIM = '#f6f4ee';
const FELT = '#6f7678';
const FELT2 = '#5d6466';
const DECK = '#c98a4b';
const DECK2 = '#a86d36';
const SEA = '#3f7488';
const INK = '#2e4a55';
const sash: WindowStyle = { frame: TRIM, glass: '#4f6a72', bars: 'cross' };

// a strip's face, drawn in its own frame: x along the wall (centred on u0..u1), y out from v
const on = (k: number, u0: number, u1: number, v: number, art: string) =>
  framed(S[k].at((u0 + u1) / 2, v), [-S[k].e[0], -S[k].e[1]], art);

function boards(L: number, h: number) {
  let o = r(-L / 2 - 1, 0, L + 2, h + 1, BOARD);
  for (let x = -L / 2; x < L / 2; x += 1.4) o += line(x, 0, x, h, BOARD2, 0.12);
  return o + r(-L / 2 - 1, h - 1, L + 2, 1, TRIM);
}

// out to the sea: the pilings under the deck, rocks heaped against the back, a row of small
// windows; on the front the gate, the name over it, a lantern on the gable over the gate
function outerArt(k: number) {
  const L = S[k].L;
  let o = boards(L, H);
  o += r(-L / 2 - 1, 0, L + 2, 2.2, '#5b4a3a');
  for (let x = -L / 2 + 1; x < L / 2; x += 3.5) o += r(x, 0, 0.8, 2.2, '#3d3128');
  if (k === 2 || k === 3) {
    let seed = 7 + k;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -L / 2; x < L / 2; x += 1.6) o += `<ellipse cx="${x}" cy="${0.6 + rnd()}" rx="${1 + rnd()}" ry="${0.8 + rnd() * 0.8}" fill="${['#8c8a84', '#a19e96', '#77746e'][Math.floor(rnd() * 3)]}"/>`;
  }
  const gap = k === 0 ? 10 : 0;
  for (let x = -L / 2 + 4; x < L / 2 - 4; x += 6) {
    if (Math.abs(x + 1.5) < gap) continue;
    o += window(x, 5.4, 3, 3.2, sash);
  }
  if (k === 0) {
    o += `<path d="M-3.4 2.2V6.6A3.4 3.4 0 0 0 3.4 6.6V2.2Z" fill="#26353b" stroke="${TRIM}" stroke-width="0.6"/>`;
    o += r(-9, 9.6, 18, 2, TRIM, `stroke="${C.ink}" stroke-width="0.15"`);
    o += `<g transform="translate(0 10.1) scale(1,-1)"><text x="0" y="0" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="1.4" fill="${INK}" textLength="17" lengthAdjust="spacingAndGlyphs">RIBERSBORGS KALLBADHUS</text></g>`;
  }
  return o;
}

// the pool side, drawn upright (it hangs down from the inner eave): the cabins' doors in a row
function yardArt(k: number, L: number) {
  let o = boards(L, H);
  o += r(-L / 2 - 1, 0, L + 2, 1, DECK2);
  for (let x = -L / 2 + 2; x < L / 2 - 3; x += 4.5) {
    if (k === 0 && Math.abs(x + 1.4) < 6) continue;
    o += r(x, 1, 2.8, 6.4, '#e8e2d2', `stroke="${INK}" stroke-width="0.15"`) + r(x + 0.6, 5.4, 1.6, 1.4, '#4f6a72');
  }
  if (k === 0) o += `<path d="M-3.4 1V5.4A3.4 3.4 0 0 0 3.4 5.4V1Z" fill="#26353b" stroke="${TRIM}" stroke-width="0.6"/>`;
  return `<g transform="matrix(-1 0 0 -1 0 ${H})">${o}</g>`;
}

function feltArt(L: number, lantern: boolean) {
  let o = r(-L / 2 - 1, 0, L + 2, s + 1, FELT);
  for (let x = -L / 2; x < L / 2; x += 3) o += line(x, 0, x, s + 1, FELT2, 0.35);
  if (lantern) o += r(-2.4, s - 5.2, 4.8, 4, TRIM, `stroke="${C.ink}" stroke-width="0.2"`) + r(-1.6, s - 4.4, 3.2, 2, '#4f6a72') + `<path d="M-3 ${s - 1.2}h6l-3 1.2z" fill="#4c7a72"/>`;
  return o;
}

// the deck as built, seen from above: boards, the two pools with their ladders, the walk down the
// middle from the gate to the sauna at the back, the pier's boards out to its end
function deckFloor() {
  let o = r(0, -D, W, D, DECK);
  for (let y = -D; y < 0; y += 1.2) o += line(0, y, W, y, DECK2, 0.12);
  const pool = (x: number, y: number, w: number, h: number) => {
    let q = r(x - 0.8, y - 0.8, w + 1.6, h + 1.6, TRIM) + r(x, y, w, h, SEA);
    for (let k = 1; k < 4; k++) q += line(x + 1, y + (h * k) / 4, x + w - 1, y + (h * k) / 4 + 0.6, '#5f93a6', 0.25);
    for (const lx of [x + 2, x + w - 3]) q += line(lx, y + h, lx, y + h - 3, '#d9d9d4', 0.25) + line(lx + 1, y + h, lx + 1, y + h - 3, '#d9d9d4', 0.25);
    return q;
  };
  o += pool(W / 2 + 4, -D + d + 4, W - d - W / 2 - 8, D - 2 * d - 8);
  o += pool(d + 8, -D + d + 18, W / 2 - d - 12, D - 2 * d - 22);
  o += r(W / 2 - 2.5, -D + d, 5, D - 2 * d, '#d9a066');
  for (let y = -D + d; y < -d; y += 1) o += line(W / 2 - 2.5, y, W / 2 + 2.5, y, DECK2, 0.12);
  o += r(W / 2 - 6, -D + d, 12, 7, '#7d6a58') + r(W / 2 - 1, -D + d + 7, 2, 0.6, TRIM);
  // the pier
  o += r(gx0, 0, G, P, '#b98a5e');
  for (let y = 0; y < P; y += 1.1) o += line(gx0, y, gx1, y, '#94693f', 0.14);
  o += r(gx0, P - 1, G, 1, '#94693f');
  return o;
}

function art(q: Panel) {
  if (q.kind === 'tab') return tabArt(q);
  if (q.id === 'base') return r(-10, -D - 10, W + 20, D + P + 20, '#a98a64');
  if (q.id.startsWith('rail')) {
    const x = q.id === 'rail-r' ? gx1 : gx0 - RAIL;
    let o = r(x, 0, RAIL, P, TRIM);
    for (let y = 0; y < P; y += 4) o += r(x, y, RAIL, 0.6, '#d0cbbf');
    return o;
  }
  const k = +q.id.slice(-1);
  const { L, c0, c1 } = S[k];
  if (q.id.startsWith('wall-')) return on(k, 0, L, 0, outerArt(k));
  if (q.id.startsWith('roof-')) return on(k, 0, L, y1, feltArt(L, k === 0));
  if (q.id.startsWith('yroof-')) return on(k, i * c0, L - i * c1, y2, feltArt(L, false));
  if (q.id.startsWith('yard-')) return on(k, d * c0, L - d * c1, y3, yardArt(k, L - d * (c0 + c1)));
  return '';
}

const backArt = (q: Panel) => {
  if (q.id === 'base') return deckFloor();
  if (q.id.startsWith('rail')) return r(Math.min(...q.poly.map((v) => v[0])), 0, RAIL, P, TRIM);
  return '';
};

export const kallbad: Model = { id: 'kallbad', name: 'Kallbadhuset', where: 'Ribersborg', net: makeKallbad(), art, backArt };
