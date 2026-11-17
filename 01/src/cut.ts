import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isFold, type Net, type V2 } from './net';
import { GAP, THICK } from './paper';

// Press-out card. The cut line is split into borders: each panel's unbroken stretch of
// cut edges (a tab's three sides, a wall's foot, a roof's side). Each is a groove bridged by
// a thin membrane of card. Pressure breaks it: a press right on it at once, a thumb on the
// face nearby bit by bit, more the closer and the longer it pushes.

export interface Run {
  a: V2;
  len: number;
  dx: number;
  dy: number;
}

export interface Border {
  panel: string;
  runs: Run[];
  pressure: number; // 0..1, pops at 1
  done: boolean;
  mesh: THREE.Mesh;
}

const run = (a: V2, b: V2): Run => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, len, dx: (b[0] - a[0]) / len, dy: (b[1] - a[1]) / len };
};

const PAPER = new THREE.Color('#d8d0bf');
const STRAINED = new THREE.Color('#5a5446');

export function makeBorders(house: Net) {
  const borders: Border[] = [];
  const group = new THREE.Group();
  for (const p of house.panels) {
    const n = p.poly.length;
    const cut = p.poly.map((a, i) => !isFold(house, p, a, p.poly[(i + 1) % n]));
    if (!cut.some(Boolean)) continue;
    // start right after a fold so a stretch never wraps around the start
    const start = cut.every(Boolean) ? 0 : (cut.findIndex((c) => !c) + 1) % n;
    let cur: Border | null = null;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (!cut[i]) { cur = null; continue; }
      if (!cur) {
        cur = { panel: p.id, runs: [], pressure: 0, done: false, mesh: null! };
        borders.push(cur);
      }
      cur.runs.push(run(p.poly[i], p.poly[(i + 1) % n]));
    }
  }
  // the membranes: a strip of thinner card under each groove
  for (const b of borders) {
    const parts = b.runs.map((r) => {
      const g = new THREE.BoxGeometry(r.len + GAP, GAP + 0.5, THICK * 0.4);
      g.rotateZ(Math.atan2(r.dy, r.dx));
      g.translate(r.a[0] + (r.dx * r.len) / 2, r.a[1] + (r.dy * r.len) / 2, -THICK / 2);
      return g;
    });
    b.mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95 }));
    b.mesh.receiveShadow = true;
    group.add(b.mesh);
  }
  return { borders, group };
}

export function distance(b: Border, p: V2) {
  let best = Infinity;
  for (const r of b.runs) {
    const px = p[0] - r.a[0];
    const py = p[1] - r.a[1];
    const s = Math.max(0, Math.min(r.len, px * r.dx + py * r.dy));
    best = Math.min(best, Math.hypot(p[0] - (r.a[0] + r.dx * s), p[1] - (r.a[1] + r.dy * s)));
  }
  return best;
}

// the uncut border nearest to p, within reach
export function borderAt(borders: Border[], p: V2, reach: number): Border | null {
  let best: Border | null = null;
  let bd = reach;
  for (const b of borders) {
    if (b.done) continue;
    const d = distance(b, p);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// a thumb at p, radius r: how hard it bears on each border, 0..1
export const bearing = (b: Border, p: V2, r: number) => Math.exp(-((distance(b, p) / r) ** 2));

// strain shows: the membrane darkens as it is about to go, glow adds a moment's flash
export function tint(b: Border, glow = 0) {
  const m = b.mesh.material as THREE.MeshStandardMaterial;
  m.color.copy(PAPER).lerp(STRAINED, Math.min(1, b.pressure * 0.75 + glow));
}
