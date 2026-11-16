import { C, box, framed, line, r, tabArt, window } from '../art';
import { ccw, DEG, type Net, type Panel, type V2 } from '../net';
import { tabOff, type Model } from './model';

// Slottsmöllan: a smock mill. An octagonal body leaning in as it rises, a pointed cap, sails
// hanging off a shaft at the top of the front. In the sheet: the base octagon in the middle,
// the eight sides round it, a cap facet beyond each, the front's facet hinged to its neighbour
// so the shaft can take the front's top edge.

const N = 8;
const RB = 24; // body, circumradius at the foot
const RT = 15; // and at the top
const HM = 58; // body height
const HC = 17; // cap height over the body
const T = 5; // side tabs
const TC = 3.5; // cap tabs
const S = 11; // shaft, out from the top of the front
const SW = 8; // sail width
const B = 23; // sail, hub to tip

const half = Math.PI / N;
const ab = RB * Math.cos(half); // apothems
const at = RT * Math.cos(half);
const sb = 2 * RB * Math.sin(half); // side widths
const st = 2 * RT * Math.sin(half);
const lean = Math.atan2(ab - at, HM); // how far each side leans in
const hs = Math.hypot(HM, ab - at); // side, foot to top
const pitch = Math.atan2(HC, at); // cap facet slope
const hc = Math.hypot(HC, at); // cap facet, eave to apex

// bends between neighbours, from their outward normals
const sideBend = Math.acos(Math.cos(lean) ** 2 * Math.cos(2 * half) + Math.sin(lean) ** 2) * DEG;
const capBend = Math.acos(Math.sin(pitch) ** 2 * Math.cos(2 * half) + Math.cos(pitch) ** 2) * DEG;

const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const unit = (a: V2): V2 => mul(a, 1 / Math.hypot(a[0], a[1]));
const mid = (a: V2, b: V2): V2 => mul(add2(a, b), 0.5);
// b reflected across the line through p and q
function reflect(b: V2, p: V2, q: V2): V2 {
  const d = unit(sub(q, p));
  const w = sub(b, p);
  const along = mul(d, w[0] * d[0] + w[1] * d[1]);
  return add2(p, sub(mul(along, 2), w));
}

export function makeMill(): Net {
  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'>) => panels.push({ origin: p.poly[0], ...p });

  // the foot: edge 0 on top, running right to left, the front up the sheet as on the houses
  const v: V2[] = [];
  for (let k = 0; k < N; k++) {
    const a = Math.PI / 2 - half + k * 2 * half;
    v.push([RB * Math.cos(a), RB * Math.sin(a)]);
  }
  add({ id: 'base', kind: 'base', face: 'base', poly: v, parent: null, hinge: null, fold: 0 });

  const tops: { a: V2; b: V2; e: V2; o: V2 }[] = [];
  for (let k = 0; k < N; k++) {
    const a = v[k];
    const b = v[(k + 1) % N];
    const e = unit(sub(b, a));
    const o: V2 = [e[1], -e[0]]; // outward
    const a2 = add2(add2(a, mul(o, hs)), mul(e, (sb - st) / 2));
    const b2 = sub(add2(b, mul(o, hs)), mul(e, (sb - st) / 2));
    tops.push({ a: a2, b: b2, e, o });
    const side = { poly: [b, a, a2, b2] as V2[] };
    add({ id: `side-${k}`, kind: 'wall', face: 'side', poly: side.poly, parent: 'base', hinge: [a, b], fold: 90 + lean * DEG });
    // each side's left edge carries the tab its right-hand neighbour glues over
    add({
      id: `tab-side-${k}`, kind: 'tab', face: 'tab', poly: tabOff(side, a, a2, T, 40, 45),
      parent: `side-${k}`, hinge: [a, a2], fold: sideBend, glue: `side-${(k + N - 1) % N}`,
    });
  }

  // the cap: a facet over each side's top edge, apex outward
  const facets: V2[][] = tops.map(({ a, b, o }) => [b, a, add2(mid(a, b), mul(o, hc))]);
  for (let k = 1; k < N; k++) {
    const [b2, a2, c] = facets[k];
    const facet = { poly: facets[k] };
    add({ id: `cap-${k}`, kind: 'roof', face: 'roof', poly: facets[k], parent: `side-${k}`, hinge: [a2, b2], fold: 90 - (pitch + lean) * DEG });
    if (k === 1) continue; // its left edge carries the front's facet instead
    add({
      id: `tab-cap-${k}`, kind: 'tab', face: 'tab', poly: tabOff(facet, a2, c, TC, 40, 22),
      parent: `cap-${k}`, hinge: [a2, c], fold: capBend, glue: `cap-${k - 1}`,
    });
  }
  // the front's facet, unfolded off its neighbour's edge: the shaft takes the front's top edge
  {
    const [b1, a1, c1] = facets[1];
    const x = reflect(b1, a1, c1);
    const f0 = ccw([a1, x, c1]);
    add({ id: 'cap-0', kind: 'roof', face: 'roof', poly: f0, parent: 'cap-1', hinge: [a1, c1], fold: capBend });
    add({
      id: 'tab-cap-0', kind: 'tab', face: 'tab', poly: tabOff({ poly: f0 }, x, c1, TC, 40, 22),
      parent: 'cap-0', hinge: [x, c1], fold: capBend, glue: `cap-${N - 1}`,
    });
  }

  // the shaft sticks straight out of the top of the front, the sails hang off its end
  const { a: fa, b: fb, e, o } = tops[0];
  const s1 = sub(add2(fb, mul(o, S)), mul(e, (st - SW) / 2));
  const s0 = add2(add2(fa, mul(o, S)), mul(e, (st - SW) / 2));
  add({ id: 'shaft', kind: 'part', face: 'part', poly: ccw([fa, fb, s1, s0]), parent: 'side-0', hinge: [fa, fb], fold: -(90 + lean * DEG) });
  const hub = mid(s0, s1);
  const at2 = (u: number, w: number): V2 => add2(add2(hub, mul(e, u)), mul(o, w));
  const w = SW / 2;
  const cross: V2[] = [
    [-w, 0], [w, 0], [w, B - w], [B, B - w], [B, B + w], [w, B + w], [w, 2 * B], [-w, 2 * B], [-w, B + w], [-B, B + w], [-B, B - w], [-w, B - w],
  ].map(([u, wv]) => at2(u, wv));
  const rectAt = (u0: number, u1: number, w0: number, w1: number) => ccw([at2(u0, w0), at2(u1, w0), at2(u1, w1), at2(u0, w1)]);
  add({
    id: 'sails', kind: 'part', face: 'part', poly: ccw(cross), parent: 'shaft', hinge: [s0, s1], fold: -90,
    parts: [rectAt(-w, w, 0, 2 * B), rectAt(-B, -w, B - w, B + w), rectAt(w, B, B - w, B + w)],
  });

  return { panels };
}

// --- print ---
const TAR = '#3a3531';
const TAR2 = '#2a2623';
const CAP = '#7b3a2a';
const CAP2 = '#5e2a1e';
const WOOD = '#6b5240';
const STONE = '#9a958b';
const SAIL = '#efe9dc';

// a panel's own frame: the middle of its hinge, u along it, v away from it
function local(p: Panel, art: string) {
  const [a, b] = p.hinge!;
  const m = mid(a, b);
  let u = unit(sub(b, a));
  // v (u turned left) must point into the panel
  const c = p.poly.reduce((s, q) => add2(s, mul(q, 1 / p.poly.length)), [0, 0] as V2);
  if ((c[0] - m[0]) * -u[1] + (c[1] - m[1]) * u[0] < 0) u = mul(u, -1);
  return framed(m, u, art);
}

function shingles(x0: number, x1: number, y0: number, y1: number, fill: string, dark: string) {
  let s = r(x0, y0, x1 - x0, y1 - y0, fill);
  for (let i = 0, y = y0 + 2.4; y < y1; i++, y += 2.4) {
    s += line(x0, y, x1, y, dark, 0.35);
    for (let x = x0 + (i % 2 ? 1.2 : 0); x < x1; x += 2.4) s += line(x, y - 2.4, x, y, dark, 0.2);
  }
  return s;
}

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

const capArt = () => shingles(-st, st, 0, hc + 1, CAP, CAP2) + r(-st, 0, 2 * st, 1.4, CAP2);

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
  if (p.id.startsWith('side-')) return local(p, sideArt(+p.id.slice(5)));
  if (p.id.startsWith('cap-')) return local(p, capArt());
  if (p.id === 'shaft') return local(p, r(-st, 0, 2 * st, S + 1, WOOD));
  if (p.id === 'sails') return local(p, sailArt());
  return '';
}

// the sails hang print to the tower: their canvas is on the back
const backArt = (p: Panel) => (p.id === 'sails' ? local(p, sailArt()) : '');

export const mill: Model = {
  id: 'mill',
  name: 'Slottsmöllan',
  where: 'Slottsparken',
  net: makeMill(),
  art,
  backArt,
};
