import { ccw, DEG, type Net, type Panel, type V2 } from '../net';
import { tabOff } from './model';

// A tower: a regular n-sided body, maybe leaning in as it rises, under a pointed cap. In the
// sheet the base polygon sits in the middle, a side out from each edge, a cap facet beyond each
// side. Every fold comes from the faces' outward normals. Sails (the mill) take the front's
// top edge, so the front's facet hangs off its neighbour instead.

export interface TowerSpec {
  n: number;
  rb: number; // circumradius at the foot
  rt: number; // and at the top
  h: number; // body height
  hc: number; // cap height over the body
  t?: number; // side tabs
  tc?: number; // cap tabs
  sails?: { s: number; sw: number; b: number }; // shaft length, sail width, hub to tip
}

export function towerGeo({ n, rb, rt, h, hc }: TowerSpec) {
  const half = Math.PI / n;
  const ab = rb * Math.cos(half); // apothems
  const at = rt * Math.cos(half);
  const sb = 2 * rb * Math.sin(half); // side widths
  const st = 2 * rt * Math.sin(half);
  const lean = Math.atan2(ab - at, h); // how far each side leans in
  const hs = Math.hypot(h, ab - at); // a side, foot to top
  const pitch = Math.atan2(hc, at); // cap facet slope
  const hcap = Math.hypot(hc, at); // cap facet, eave to apex
  // bends between neighbours, from their outward normals
  const sideBend = Math.acos(Math.cos(lean) ** 2 * Math.cos(2 * half) + Math.sin(lean) ** 2) * DEG;
  const capBend = Math.acos(Math.sin(pitch) ** 2 * Math.cos(2 * half) + Math.cos(pitch) ** 2) * DEG;
  return { half, ab, at, sb, st, lean, hs, pitch, hcap, sideBend, capBend };
}

export const add2 = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const unit = (a: V2): V2 => mul(a, 1 / Math.hypot(a[0], a[1]));
export const mid = (a: V2, b: V2): V2 => mul(add2(a, b), 0.5);
// b reflected across the line through p and q
function reflect(b: V2, p: V2, q: V2): V2 {
  const d = unit(sub(q, p));
  const w = sub(b, p);
  const along = mul(d, w[0] * d[0] + w[1] * d[1]);
  return add2(p, sub(mul(along, 2), w));
}

export function makeTower(spec: TowerSpec): Net {
  const { n, rb } = spec;
  const T = spec.t ?? 5;
  const TC = spec.tc ?? 3.5;
  const g = towerGeo(spec);
  const { half, sb, st, lean, hs, pitch, hcap, sideBend, capBend } = g;
  // tapers: a side tab must clear its neighbour in the sheet (the gap there is the turn between
  // edges plus the narrowing), a cap tab must fit in its neighbour's point
  const narrow = Math.atan2((sb - st) / 2, hs) * DEG;
  const taSide = Math.min(40, 0.8 * (360 / n + 2 * narrow));
  const tbCap = Math.min(22, 0.8 * 2 * Math.atan2(st / 2, hcap) * DEG);

  const panels: Panel[] = [];
  const add = (p: Omit<Panel, 'origin'>) => panels.push({ origin: p.poly[0], ...p });

  // the foot: edge 0 on top, running right to left, the front up the sheet as on the houses
  const v: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 - half + k * 2 * half;
    v.push([rb * Math.cos(a), rb * Math.sin(a)]);
  }
  add({ id: 'base', kind: 'base', face: 'base', poly: v, parent: null, hinge: null, fold: 0 });

  const tops: { a: V2; b: V2; e: V2; o: V2 }[] = [];
  for (let k = 0; k < n; k++) {
    const a = v[k];
    const b = v[(k + 1) % n];
    const e = unit(sub(b, a));
    const o: V2 = [e[1], -e[0]]; // outward
    const a2 = add2(add2(a, mul(o, hs)), mul(e, (sb - st) / 2));
    const b2 = sub(add2(b, mul(o, hs)), mul(e, (sb - st) / 2));
    tops.push({ a: a2, b: b2, e, o });
    const side = { poly: [b, a, a2, b2] as V2[] };
    add({ id: `side-${k}`, kind: 'wall', face: 'side', poly: side.poly, parent: 'base', hinge: [a, b], fold: 90 + lean * DEG });
    // each side's left edge carries the tab its right-hand neighbour glues over
    add({
      id: `tab-side-${k}`, kind: 'tab', face: 'tab', poly: tabOff(side, a, a2, T, taSide, 45),
      parent: `side-${k}`, hinge: [a, a2], fold: sideBend, glue: `side-${(k + n - 1) % n}`,
    });
  }

  // the cap: a facet over each side's top edge, apex outward
  const facets: V2[][] = tops.map(({ a, b, o }) => [b, a, add2(mid(a, b), mul(o, hcap))]);
  const sails = spec.sails;
  for (let k = sails ? 1 : 0; k < n; k++) {
    const [b2, a2, c] = facets[k];
    add({ id: `cap-${k}`, kind: 'roof', face: 'roof', poly: facets[k], parent: `side-${k}`, hinge: [a2, b2], fold: 90 - (pitch + lean) * DEG });
    if (sails && k === 1) continue; // its left edge carries the front's facet instead
    add({
      id: `tab-cap-${k}`, kind: 'tab', face: 'tab', poly: tabOff({ poly: facets[k] }, a2, c, TC, 40, tbCap),
      parent: `cap-${k}`, hinge: [a2, c], fold: capBend, glue: `cap-${(k + n - 1) % n}`,
    });
  }
  if (!sails) return { panels };

  // the front's facet, unfolded off its neighbour's edge: the shaft takes the front's top edge
  {
    const [b1, a1, c1] = facets[1];
    const x = reflect(b1, a1, c1);
    const f0 = ccw([a1, x, c1]);
    add({ id: 'cap-0', kind: 'roof', face: 'roof', poly: f0, parent: 'cap-1', hinge: [a1, c1], fold: capBend });
    add({
      id: 'tab-cap-0', kind: 'tab', face: 'tab', poly: tabOff({ poly: f0 }, x, c1, TC, 40, tbCap),
      parent: 'cap-0', hinge: [x, c1], fold: capBend, glue: `cap-${n - 1}`,
    });
  }
  // the shaft sticks straight out of the top of the front, the sails hang off its end
  const { s: S, sw: SW, b: B } = sails;
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
