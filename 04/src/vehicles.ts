// Vehicle bodies, built from a few tapered boxes. Seen from a drone, that is all a car is.
// Long axis +x (front), up +y. Vertex colour is a shade multiplied by the instance paint.
import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GLASS = 0.07;
const TYRE = 0.04;

function box(L: number, y0: number, y1: number, W: number, cx: number, shade: number, tx = 1, tz = 1) {
  const g = new BoxGeometry(L, y1 - y0, W);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * tx, p.getY(i), p.getZ(i) * tz);
  }
  g.translate(cx, (y0 + y1) / 2, 0);
  g.computeVertexNormals();
  const c = new Float32Array(p.count * 3).fill(shade);
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}

function wheels(L: number, W: number, r = 0.34, front = 0.3, rear = -0.31) {
  const out: BufferGeometry[] = [];
  for (const x of [front * L, rear * L]) {
    const g = box(r * 2, 0, r * 2, W + 0.04, x, TYRE);
    out.push(g);
  }
  return out;
}

export interface VType {
  name: string;
  len: number;
  wid: number;
  weight: number;
  parks: boolean;
  heavy: boolean;
  geo: BufferGeometry;
  cap: number;
}

function car(L: number, W: number, H: number, belt: number, cabL: number, cabX: number, taper: number) {
  return mergeGeometries([
    box(L, 0.24, belt, W, 0, 1, 0.97, 0.94),
    box(L * cabL, belt, H - 0.04, W * 0.9, cabX * L, GLASS, taper, 0.84),
    box(L * cabL * taper * 0.9, H - 0.05, H, W * 0.74, cabX * L, 1),
    ...wheels(L, W),
  ])!;
}

const sedan = () => car(4.7, 1.84, 1.44, 0.82, 0.54, -0.04, 0.66);
const hatch = () => car(4.1, 1.78, 1.5, 0.84, 0.62, -0.1, 0.74);
const suv = () => car(4.85, 1.95, 1.74, 1.0, 0.66, -0.1, 0.82);

function pickup() {
  const L = 5.7, W = 2.02;
  return mergeGeometries([
    box(L, 0.36, 1.06, W, 0, 1, 0.98, 0.96),
    box(L * 0.3, 1.06, 1.82, W * 0.9, 0.06 * L, GLASS, 0.78, 0.86),
    box(L * 0.22, 1.8, 1.86, W * 0.76, 0.06 * L, 1),
    box(L * 0.33, 1.02, 1.08, W * 0.8, -0.31 * L, 0.3),
    ...wheels(L, W, 0.4),
  ])!;
}

function van() {
  const L = 5.4, W = 2.02;
  return mergeGeometries([
    box(L, 0.3, 2.2, W, 0, 1, 0.97, 0.93),
    box(L * 0.1, 1.25, 1.9, W * 0.88, 0.455 * L, GLASS),
    ...wheels(L, W, 0.36),
  ])!;
}

function truck() {
  const L = 7.6, W = 2.4;
  return mergeGeometries([
    box(L * 0.2, 0.5, 2.4, W * 0.94, 0.39 * L, 1, 0.9, 0.95),
    box(L * 0.03, 1.5, 2.2, W * 0.84, 0.485 * L, GLASS),
    box(L * 0.74, 0.95, 3.25, W, -0.12 * L, 1.15),
    box(L * 0.9, 0.5, 0.95, W * 0.5, -0.03 * L, 0.12),
    ...wheels(L, W, 0.48, 0.38, -0.3),
  ])!;
}

function bus() {
  const L = 12, W = 2.55;
  return mergeGeometries([
    box(L, 0.36, 3.05, W, 0, 1, 0.99, 0.94),
    box(L * 0.93, 1.45, 2.35, W + 0.03, 0, GLASS),
    box(L * 0.2, 3.05, 3.3, W * 0.6, -0.2 * L, 0.8),
    ...wheels(L, W, 0.5, 0.36, -0.3),
  ])!;
}

export function makeTypes(): VType[] {
  return [
    { name: 'sedan', len: 4.7, wid: 1.84, weight: 0.28, parks: true, heavy: false, geo: sedan(), cap: 500 },
    { name: 'hatch', len: 4.1, wid: 1.78, weight: 0.12, parks: true, heavy: false, geo: hatch(), cap: 300 },
    { name: 'suv', len: 4.85, wid: 1.95, weight: 0.3, parks: true, heavy: false, geo: suv(), cap: 500 },
    { name: 'pickup', len: 5.7, wid: 2.02, weight: 0.17, parks: true, heavy: false, geo: pickup(), cap: 300 },
    { name: 'van', len: 5.4, wid: 2.02, weight: 0.07, parks: true, heavy: false, geo: van(), cap: 160 },
    { name: 'truck', len: 7.6, wid: 2.4, weight: 0.045, parks: false, heavy: true, geo: truck(), cap: 80 },
    { name: 'bus', len: 12, wid: 2.55, weight: 0.015, parks: false, heavy: true, geo: bus(), cap: 40 },
  ];
}

// what is actually on American roads: mostly white, black and greys
export const PAINTS: [number, number][] = [
  [0xe9e9e6, 0.25], [0x111214, 0.19], [0x6c7075, 0.17], [0xb3b6ba, 0.12], [0x243a5e, 0.08],
  [0x8c1c1c, 0.07], [0x2f4f3a, 0.02], [0xb9a98a, 0.03], [0x3b6ea5, 0.03], [0xc2571a, 0.015], [0x5a2d2d, 0.025],
];
export const WORK_PAINTS: [number, number][] = [[0xeeeeea, 0.6], [0xd9b83a, 0.15], [0x9aa3ad, 0.15], [0x9c2b2b, 0.1]];

export function pick<T>(list: [T, number][], r: number): T {
  let t = 0;
  for (const [, w] of list) t += w;
  r *= t;
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[0][0];
}
