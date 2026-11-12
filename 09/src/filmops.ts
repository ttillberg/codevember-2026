// Operations on the film atlases (film.ts): painting grooves, removing film behind a fold,
// and relabelling what is left into pieces. Plain typed arrays, no three.js, so it also
// runs headless.
//
// Every op bumps the version of the film it changed; membrane re-uploads once a frame.
//
// The id atlas is read and written as one Uint16 a texel (low byte first): every browser
// this runs in is little-endian.

import { FILM_N, dirToFace, faceToDir, texelIndex } from './film';
import type { Film } from './film';

const N = FILM_N;
const Q = Math.PI / 4;

/** The angle a texel spans at a face centre, the most it ever spans (0.71 of it at the least). */
export const TEXEL = Math.PI / (2 * N);

/** tan of each texel centre's angle: the in-face coordinate before normalising. */
const TC = new Float64Array(N);
for (let i = 0; i < N; i++) TC[i] = Math.tan(((i + 0.5) / N * 2 - 1) * Q);

// Face f has its major axis AX_C[f] (sign SGN[f]) and in-face axes AX_A[f], AX_B[f]; the
// direction of texel (f, i, j) is p[C] = s, p[A] = TC[i], p[B] = TC[j], normalised.
const AX_C = [0, 0, 1, 1, 2, 2];
const AX_A = [1, 1, 0, 0, 0, 0];
const AX_B = [2, 2, 2, 2, 1, 1];
const SGN = [1, -1, 1, -1, 1, -1];

// ------------------------------------------------------------------------------- lookups

const idViews = new WeakMap<Uint8Array, Uint16Array>();
export function ids16(film: Film): Uint16Array {
  let v = idViews.get(film.id);
  if (!v) idViews.set(film.id, (v = new Uint16Array(film.id.buffer, film.id.byteOffset, film.id.length >> 1)));
  return v;
}

const tmp = new Float64Array(3);
/** Atlas index of the texel under a direction (need not be unit). */
export function texelAt(x: number, y: number, z: number): number {
  dirToFace(x, y, z, tmp);
  const i = Math.min(N - 1, tmp[1] | 0), j = Math.min(N - 1, tmp[2] | 0);
  return texelIndex(tmp[0], i, j);
}

/** Piece id under a direction, 0 where there is no film. Nearest texel. */
export function idAt(film: Film, x: number, y: number, z: number): number {
  return ids16(film)[texelAt(x, y, z)];
}

// -------------------------------------------------------------------------------- groove

// A groove: cover 0 out to CORE from the curve, then a one-texel ramp up to full. The film
// ends where cover crosses 128, CORE + RAMP / 2 = 1.1 texel-widths each side, so at least
// two texels of < 128 lie across it however it runs through the grid: always a cut.
const CORE = 0.55 * TEXEL;
const RAMP = 1.1 * TEXEL;
const REACH = CORE + RAMP;
const SPACING = 0.5 * TEXEL;
/** Window half-size around a stamp, in texels: REACH over the smallest texel plus spacing. */
const WIN = 4;

// The curve being painted, as dot products with the texel direction p:
//   circle  |p·n - w| / cos   (n, w: the plane, cos = √(1 - w²))
//   arc     |p·n| between the ends (p·(n×a) >= 0 and p·(b×n) >= 0), else chord to the
//           nearest end. a == b is a dot.
// Every vector is kept per face as (s·v[C], v[A], v[B]), so p·v = (vc + a·va + b·vb) / |..|.
const CIRCLE = 0, ARC = 1, DOT = 2;
let mode = CIRCLE;
let cw = 0, cInvCos = 1;
const PF = new Float64Array(6 * 15); // per face: n, n×a, b×n, a, b, three each

function project(off: number, x: number, y: number, z: number) {
  const v = [x, y, z];
  for (let f = 0; f < 6; f++) {
    const o = f * 15 + off;
    PF[o] = SGN[f] * v[AX_C[f]];
    PF[o + 1] = v[AX_A[f]];
    PF[o + 2] = v[AX_B[f]];
  }
}

/** How far (texels) film reaches out over what is under it: under a hairline cut in the
 *  film above, the film below still counts as covered. */
const OVERHANG = 3;

/** Is there film of one of films[0..layer-1] over texel (f, i, j)? A cut in them does not
 *  count as an opening: the texels OVERHANG either side are looked at too. */
export function coveredAt(films: Film[], layer: number, f: number, i: number, j: number): boolean {
  const i0 = Math.max(0, i - OVERHANG), i1 = Math.min(N - 1, i + OVERHANG);
  const j0 = Math.max(0, j - OVERHANG), j1 = Math.min(N - 1, j + OVERHANG);
  const k = texelIndex(f, i, j), ka = texelIndex(f, i0, j), kb = texelIndex(f, i1, j), kc = texelIndex(f, i, j0), kd = texelIndex(f, i, j1);
  for (let q = 0; q < layer; q++) {
    const c = films[q].cover;
    if (c[k] >= 128 || c[ka] >= 128 || c[kb] >= 128 || c[kc] >= 128 || c[kd] >= 128) return true;
  }
  return false;
}

/** The same for a direction. */
export function coveredOver(films: Film[], layer: number, x: number, y: number, z: number): boolean {
  if (layer === 0) return false;
  dirToFace(x, y, z, tmp);
  return coveredAt(films, layer, tmp[0], Math.min(N - 1, tmp[1] | 0), Math.min(N - 1, tmp[2] | 0));
}

// A cut only goes into the film on top where it lands, never through two. Which film that
// is for a texel is settled the first time a stroke touches it and kept for the rest of the
// stroke: otherwise the next stamp, finding the top film already cut there, would carry on
// into the one below. 0 not touched yet, 1 + film index, 255 nothing to cut.
let strokeFilm: Uint8Array | null = null;
/** Bits of the films the stroke has cut into so far. */
let strokeTouched = 0;

/** Start a new cut. Returns nothing; endStroke says which films it changed. */
export function beginStroke(): void {
  if (!strokeFilm) strokeFilm = new Uint8Array(N * 3 * N * 2);
  else strokeFilm.fill(0);
  strokeTouched = 0;
}
/** Bit q set: films[q] was cut by the stroke. */
export function endStroke(): number {
  return strokeTouched;
}

const c = [0, 0, 0];
/** Lower cover around the current curve near one point of it. */
function stamp(films: Film[], x: number, y: number, z: number) {
  const mark = strokeFilm!;
  let changed = 0; // bits of the films this stamp lowered
  c[0] = x; c[1] = y; c[2] = z;
  for (let f = 0; f < 6; f++) {
    const m = SGN[f] * c[AX_C[f]];
    if (m < 0.3) continue;
    const fx = (Math.atan(c[AX_A[f]] / m) / Q * 0.5 + 0.5) * N;
    const fy = (Math.atan(c[AX_B[f]] / m) / Q * 0.5 + 0.5) * N;
    const i0 = Math.max(0, Math.floor(fx) - WIN), i1 = Math.min(N - 1, Math.floor(fx) + WIN);
    const j0 = Math.max(0, Math.floor(fy) - WIN), j1 = Math.min(N - 1, Math.floor(fy) + WIN);
    if (i0 > i1 || j0 > j1) continue;
    const o = f * 15;
    const nc = PF[o], na = PF[o + 1], nb = PF[o + 2];
    const xc = PF[o + 3], xa = PF[o + 4], xb = PF[o + 5];
    const yc = PF[o + 6], ya = PF[o + 7], yb = PF[o + 8];
    const ac = PF[o + 9], aa = PF[o + 10], ab = PF[o + 11];
    const bc = PF[o + 12], ba = PF[o + 13], bb = PF[o + 14];
    for (let j = j0; j <= j1; j++) {
      const b = TC[j];
      const row = texelIndex(f, 0, j);
      for (let i = i0; i <= i1; i++) {
        const a = TC[i];
        const il = 1 / Math.sqrt(1 + a * a + b * b);
        let d: number;
        if (mode === CIRCLE) {
          d = Math.abs((nc + a * na + b * nb) * il - cw) * cInvCos;
        } else if (mode === ARC && xc + a * xa + b * xb >= 0 && yc + a * ya + b * yb >= 0) {
          d = Math.abs((nc + a * na + b * nb) * il);
        } else {
          const da = (ac + a * aa + b * ab) * il;
          const db = mode === DOT ? da : (bc + a * ba + b * bb) * il;
          d = Math.sqrt(Math.max(0, 2 - 2 * Math.max(da, db)));
        }
        if (d >= REACH) continue;
        const v = d <= CORE ? 0 : ((d - CORE) / RAMP * 255 + 0.5) | 0;
        const k = row + i;
        let w = mark[k];
        if (w === 0) {
          // the film on top here; under an overhang of the one above there is nothing to cut
          w = 255;
          for (let q = 0; q < films.length; q++) {
            if (films[q].cover[k] < 128) continue;
            if (!coveredAt(films, q, f, i, j)) w = q + 1;
            break;
          }
          mark[k] = w;
        }
        if (w === 255) continue;
        const cover = films[w - 1].cover;
        if (v < cover[k]) {
          cover[k] = v;
          changed |= 1 << (w - 1);
        }
      }
    }
  }
  // Every stamp that cut something says so: a stroke drawn by hand goes on over many
  // frames, and each of them has to reach the screen, not only the first.
  if (changed) {
    strokeTouched |= changed;
    for (let q = 0; q < films.length; q++) if (changed & (1 << q)) films[q].coverVersion++;
  }
}

/** Groove along the whole circle where the plane p·n = w meets the unit sphere (n unit),
 *  in whichever film is on top along it. Between beginStroke and endStroke. */
export function paintCircle(films: Film[], nx: number, ny: number, nz: number, w: number): void {
  if (Math.abs(w) >= 1) return;
  const r = Math.sqrt(1 - w * w);
  mode = CIRCLE; cw = w; cInvCos = 1 / r;
  project(0, nx, ny, nz);
  // u, v: a frame of the plane
  let ux = -ny, uy = nx, uz = 0;
  if (Math.abs(nz) > 0.9) { ux = 0; uy = -nz; uz = ny; }
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const steps = Math.ceil((2 * Math.PI * r) / SPACING);
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * 2 * Math.PI, c = Math.cos(t) * r, sn = Math.sin(t) * r;
    stamp(films, w * nx + c * ux + sn * vx, w * ny + c * uy + sn * vy, w * nz + c * uz + sn * vz);
  }
}

/** Groove along the shorter great-circle arc between two unit points, round at the ends. */
export function paintArc(films: Film[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const dot = ax * bx + ay * by + az * bz;
  if (dot < 0.5) {
    // Long arcs go in halves, so "between" is never ambiguous.
    let mx = ax + bx, my = ay + by, mz = az + bz;
    const ml = Math.hypot(mx, my, mz);
    if (ml < 1e-9) return;
    mx /= ml; my /= ml; mz /= ml;
    paintArc(films, ax, ay, az, mx, my, mz);
    paintArc(films, mx, my, mz, bx, by, bz);
    return;
  }
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const nl = Math.hypot(nx, ny, nz);
  project(9, ax, ay, az);
  project(12, bx, by, bz);
  if (nl < 1e-9) {
    mode = DOT;
    stamp(films, ax, ay, az);
  } else {
    mode = ARC;
    nx /= nl; ny /= nl; nz /= nl;
    project(0, nx, ny, nz);
    project(3, ny * az - nz * ay, nz * ax - nx * az, nx * ay - ny * ax); // n × a
    project(6, by * nz - bz * ny, bz * nx - bx * nz, bx * ny - by * nx); // b × n
    const th = Math.atan2(nl, dot);
    const steps = Math.max(1, Math.ceil(th / SPACING));
    const si = 1 / Math.sin(th);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ka = Math.sin((1 - t) * th) * si, kb = Math.sin(t * th) * si;
      stamp(films, ka * ax + kb * bx, ka * ay + kb * by, ka * az + kb * bz);
    }
  }
}

/** The film as it was when `cover` was copied from it. Relabel afterwards. */
export function restoreFilm(film: Film, cover: Uint8Array): void {
  film.cover.set(cover);
  film.coverVersion++;
}

/** Whole film again, everywhere. Relabel afterwards. */
export function fillFilm(film: Film): void {
  film.cover.fill(255);
  film.coverVersion++;
}

// ---------------------------------------------------------------------------- removing

/** All film of piece `id` goes. Returns how many texels changed. Relabel afterwards. */
export function erasePiece(film: Film, id: number): number {
  const cover = film.cover, ids = ids16(film);
  let n = 0;
  for (let f = 0; f < 6; f++) {
    bounds(film, id, f);
    for (let j = bb[2]; j < bb[3]; j++) {
      const row = texelIndex(f, 0, j);
      for (let k = row + bb[0]; k < row + bb[1]; k++) if (ids[k] === id && cover[k] !== 0) { cover[k] = 0; n++; }
    }
  }
  if (n) film.coverVersion++;
  return n;
}

// --------------------------------------------------------------------------- edge normal

/** Is a direction on piece `id`? Bilinear cover, so the answer moves smoothly across an
 *  edge instead of in texel steps. */
function onPiece(film: Film, id: number, x: number, y: number, z: number): boolean {
  dirToFace(x, y, z, tmp);
  const f = tmp[0], u = tmp[1] - 0.5, v = tmp[2] - 0.5;
  const fi = Math.floor(u), fj = Math.floor(v), tx = u - fi, ty = v - fj;
  const i0 = Math.max(0, fi), i1 = Math.min(N - 1, fi + 1);
  const j0 = Math.max(0, fj), j1 = Math.min(N - 1, fj + 1);
  const k00 = texelIndex(f, i0, j0), k10 = texelIndex(f, i1, j0);
  const k01 = texelIndex(f, i0, j1), k11 = texelIndex(f, i1, j1);
  const cv = film.cover;
  const c = (cv[k00] * (1 - tx) + cv[k10] * tx) * (1 - ty) + (cv[k01] * (1 - tx) + cv[k11] * tx) * ty;
  if (c < 127.5) return false;
  // Pieces are two texels apart at least, so one 2 x 2 never holds two of them.
  const ids = ids16(film);
  return ids[k00] === id || ids[k10] === id || ids[k01] === id || ids[k11] === id;
}

const RINGS = [0.03, 0.01];
const TAPS = 48;
const ins = new Uint8Array(TAPS);
const cross = new Float64Array(TAPS);
const enter = new Uint8Array(TAPS);

/** Which way piece `id` lies from a point e on its edge: the mean direction, in e's tangent
 *  plane, of the arcs of a small ring around e that are on the piece (crossings found to a
 *  fraction of a texel). Unit, written to out. false when the ring cannot tell (inside a
 *  slit, all on or all off): then the caller picks a direction. */
export function edgeNormal(film: Film, id: number, ex: number, ey: number, ez: number, out: Float64Array | number[]): boolean {
  let ux = -ey, uy = ex, uz = 0;
  if (Math.abs(ez) > 0.9) { ux = 0; uy = -ez; uz = ey; }
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ey * uz - ez * uy, vy = ez * ux - ex * uz, vz = ex * uy - ey * ux;
  const step = (2 * Math.PI) / TAPS;
  for (const rho of RINGS) {
    const cr = Math.cos(rho), sr = Math.sin(rho);
    const on = (phi: number) => {
      const c = Math.cos(phi) * sr, s = Math.sin(phi) * sr;
      return onPiece(film, id, cr * ex + c * ux + s * vx, cr * ey + c * uy + s * vy, cr * ez + c * uz + s * vz) ? 1 : 0;
    };
    for (let k = 0; k < TAPS; k++) ins[k] = on(k * step);
    let nc = 0;
    for (let k = 0; k < TAPS; k++) {
      const s0 = ins[k];
      if (s0 === ins[(k + 1) % TAPS]) continue;
      let lo = k * step, hi = lo + step;
      for (let it = 0; it < 10; it++) {
        const mid = (lo + hi) / 2;
        if (on(mid) === s0) lo = mid; else hi = mid;
      }
      cross[nc] = (lo + hi) / 2;
      enter[nc] = s0 ? 0 : 1;
      nc++;
    }
    if (nc === 0) continue;
    let tx = 0, ty = 0, total = 0;
    for (let m = 0; m < nc; m++) {
      if (!enter[m]) continue;
      const p1 = cross[m];
      let p2 = cross[(m + 1) % nc];
      if (p2 <= p1) p2 += 2 * Math.PI;
      tx += Math.sin(p2) - Math.sin(p1);
      ty += Math.cos(p1) - Math.cos(p2);
      total += p2 - p1;
    }
    const tl = Math.hypot(tx, ty);
    if (total <= 0 || tl / total < 0.15) continue;
    tx /= tl; ty /= tl;
    out[0] = tx * ux + ty * vx; out[1] = tx * uy + ty * vy; out[2] = tx * uz + ty * vz;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------- relabel
//
// Run based: each row of each face is cut into runs of film; a run is a node of the
// union-find, joined to the runs it overlaps in the row below and across face edges.
// Per texel there is only the scan for runs and native fills; areas and centroids come
// from per-row prefix sums.

/** Components below this many texels are crumbs: erased instead of becoming pieces. */
const CRUMB = 160;
const MAX_ID = 65535;

export interface Labels {
  /** Pieces found; the arrays are indexed 0..n-1. */
  n: number;
  /** New id in the atlas. A piece keeps its old id when it is the largest part of it. */
  id: Int32Array;
  /** The id its texels had before, 0 for none. */
  old: Int32Array;
  /** Fraction of the sphere. */
  area: Float64Array;
}

const out: Labels = {
  n: 0,
  id: new Int32Array(MAX_ID), old: new Int32Array(MAX_ID),
  area: new Float64Array(MAX_ID),
};
const size = new Int32Array(MAX_ID);
const acc = new Float64Array(MAX_ID);

// Texel bounds of each piece on each face from the last relabel, i0, i1, j0, j1 (ends
// exclusive) at (id * 6 + f) * 4. Ids only change in a relabel, so they stay exact. An id
// the last relabel of this film did not hand out (the film before any) is scanned whole.
const BOX = new Int32Array((MAX_ID + 1) * 24);
const boxGen = new Int32Array(MAX_ID + 1);
let gen = 0;
let boxFilm: Film | null = null;
const bb = [0, 0, 0, 0];
function bounds(film: Film, id: number, f: number) {
  if (film === boxFilm && boxGen[id] === gen) {
    const q = (id * 6 + f) * 4;
    bb[0] = BOX[q]; bb[1] = BOX[q + 1]; bb[2] = BOX[q + 2]; bb[3] = BOX[q + 3];
  } else { bb[0] = 0; bb[1] = N; bb[2] = 0; bb[3] = N; }
}
const best = new Int32Array(MAX_ID + 1).fill(-1);
const taken = new Uint8Array(MAX_ID + 1);

// Runs: start, end (exclusive, in-face i), union-find parent, texel count, old id of the
// first texel, piece index. Row r = f * N + j owns runs [rowRun[r], rowRun[r + 1]).
let rCap = 1 << 16;
let rS = new Int32Array(rCap), rE = new Int32Array(rCap);
let parent = new Int32Array(rCap), cnt = new Int32Array(rCap), first = new Int32Array(rCap), cmp = new Int32Array(rCap);
const rowRun = new Int32Array(6 * N + 1);
function grow() {
  rCap *= 2;
  const g = (a: Int32Array) => { const b = new Int32Array(rCap); b.set(a); return b; };
  rS = g(rS); rE = g(rE); parent = g(parent); cnt = g(cnt); first = g(first); cmp = g(cmp);
}

function find(x: number): number {
  const P = parent;
  while (P[x] !== x) { const g = P[P[x]]; P[x] = g; x = g; }
  return x;
}
function union(a: number, b: number) {
  a = find(a); b = find(b);
  if (a < b) parent[b] = a; else if (b < a) parent[a] = b;
}

/** The run of row r holding in-face column i, -1 if that texel has no film. */
function runAt(r: number, i: number): number {
  let lo = rowRun[r], hi = rowRun[r + 1] - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (rE[m] <= i) lo = m + 1;
    else if (rS[m] > i) hi = m - 1;
    else return m;
  }
  return -1;
}

// Per-row prefix sums of texel solid angle, the same on every face.
let COM: Float64Array | null = null;
let OM_TOTAL = 0;
function tables() {
  if (COM) return;
  const M = N + 1;
  COM = new Float64Array(N * M);
  const da = Math.PI / (2 * N);
  let tot = 0;
  for (let j = 0; j < N; j++) {
    const b = TC[j], o = j * M;
    for (let i = 0; i < N; i++) {
      const a = TC[i], l2 = 1 + a * a + b * b, l = Math.sqrt(l2);
      const om = ((1 + a * a) * (1 + b * b) * da * da) / (l2 * l);
      COM[o + i + 1] = COM[o + i] + om;
    }
    tot += COM[o + N];
  }
  OM_TOTAL = tot * 6;
}

// Texels that touch across a face edge, as (row, column) pairs, every border texel once per edge.
let EDGES: Int32Array | null = null;
function edgePairs(): Int32Array {
  if (EDGES) return EDGES;
  const e = new Int32Array(6 * 4 * N * 4);
  const o = [0, 0, 0], q = [0, 0, 0];
  let n = 0;
  for (let f = 0; f < 6; f++) {
    for (let t = 0; t < N; t++) {
      for (let side = 0; side < 4; side++) {
        const i = side === 0 ? 0 : side === 1 ? N - 1 : t;
        const j = side === 2 ? 0 : side === 3 ? N - 1 : t;
        const x = side === 0 ? -0.01 : side === 1 ? N + 0.01 : t + 0.5;
        const y = side === 2 ? -0.01 : side === 3 ? N + 0.01 : t + 0.5;
        faceToDir(f, x, y, o);
        dirToFace(o[0], o[1], o[2], q);
        e[n++] = f * N + j;
        e[n++] = i;
        e[n++] = q[0] * N + Math.min(N - 1, Math.max(0, Math.floor(q[2])));
        e[n++] = Math.min(N - 1, Math.max(0, Math.floor(q[1])));
      }
    }
  }
  return (EDGES = e);
}

/**
 * Rewrite the id atlas: the 4-connected components of cover >= 128, across face edges too,
 * crumbs erased. `reserved`: ids in use before (world.pieces), never handed to a new part.
 * The returned object is reused by the next call.
 */
export function relabel(film: Film, reserved: Iterable<number>): Labels {
  tables();
  const cover = film.cover, ids = ids16(film);

  // Pass 1: runs, joined to the overlapping runs of the row below.
  let nr = 0;
  for (let r = 0; r < 6 * N; r++) {
    const f = (r / N) | 0, j = r - f * N;
    const row = texelIndex(f, 0, j);
    rowRun[r] = nr;
    let i = 0;
    while (i < N) {
      while (i < N && cover[row + i] < 128) i++;
      if (i === N) break;
      const s = i;
      while (i < N && cover[row + i] >= 128) i++;
      if (nr === rCap) grow();
      rS[nr] = s; rE[nr] = i; parent[nr] = nr; cnt[nr] = i - s; first[nr] = ids[row + s];
      nr++;
    }
    if (j > 0) {
      const end = rowRun[r];
      let a = rowRun[r - 1];
      for (let m = rowRun[r]; m < nr; m++) {
        const s = rS[m], e = rE[m];
        while (a < end && rE[a] <= s) a++;
        for (let b = a; b < end && rS[b] < e; b++) union(m, b);
      }
    }
  }
  rowRun[6 * N] = nr;
  const E = edgePairs();
  for (let e = 0; e < E.length; e += 4) {
    const a = runAt(E[e], E[e + 1]);
    if (a < 0) continue;
    const b = runAt(E[e + 2], E[e + 3]);
    if (b >= 0) union(a, b);
  }

  // Roots are the smallest run of their set, so one ascending sweep flattens and counts.
  for (let x = 0; x < nr; x++) {
    const r = find(x);
    parent[x] = r;
    if (r !== x) cnt[r] += cnt[x];
  }
  taken.fill(0);
  taken[0] = 1;
  let nRes = 0;
  for (const r of reserved) { if (r > 0 && r <= MAX_ID && !taken[r]) { taken[r] = 1; nRes++; } }
  const limit = MAX_ID - nRes;
  let n = 0;
  for (let x = 0; x < nr; x++) {
    const r = parent[x];
    if (r !== x) { cmp[x] = cmp[r]; continue; }
    if (cnt[x] >= CRUMB && n < limit) { cmp[x] = n; out.old[n] = first[x]; size[n] = cnt[x]; n++; }
    else cmp[x] = -1;
  }

  // Ids: the largest part of an old piece keeps its id, the others get unused ones.
  for (let c = 0; c < n; c++) {
    const o = out.old[c];
    if (o > 0 && (best[o] < 0 || size[c] > size[best[o]])) best[o] = c;
  }
  for (let c = 0; c < n; c++) {
    const o = out.old[c];
    if (o > 0 && best[o] === c) { out.id[c] = o; taken[o] = 1; }
    else out.id[c] = -1;
  }
  let cursor = 1;
  for (let c = 0; c < n; c++) {
    if (out.id[c] >= 0) continue;
    while (taken[cursor]) cursor++;
    out.id[c] = cursor;
    taken[cursor] = 1;
  }
  for (let c = 0; c < n; c++) best[out.old[c]] = -1;

  // Pass 2: write ids, sum solid angle, erase crumbs.
  ids.fill(0);
  acc.fill(0, 0, n);
  const pid = out.id, com = COM!, M = N + 1;
  gen++;
  boxFilm = film;
  for (let c = 0; c < n; c++) {
    boxGen[pid[c]] = gen;
    for (let q = pid[c] * 24, end = q + 24; q < end; q += 4) { BOX[q] = N; BOX[q + 1] = 0; BOX[q + 2] = N; BOX[q + 3] = 0; }
  }
  let erased = 0;
  for (let r = 0; r < 6 * N; r++) {
    const f = (r / N) | 0, j = r - f * N;
    const row = texelIndex(f, 0, j), o = j * M;
    for (let m = rowRun[r]; m < rowRun[r + 1]; m++) {
      const s = rS[m], e = rE[m], c = cmp[m];
      if (c < 0) { cover.fill(0, row + s, row + e); erased++; continue; }
      ids.fill(pid[c], row + s, row + e);
      const bq = (pid[c] * 6 + f) * 4;
      if (s < BOX[bq]) BOX[bq] = s;
      if (e > BOX[bq + 1]) BOX[bq + 1] = e;
      if (j < BOX[bq + 2]) BOX[bq + 2] = j;
      if (j + 1 > BOX[bq + 3]) BOX[bq + 3] = j + 1;
      acc[c] += com[o + e] - com[o + s];
    }
  }
  for (let c = 0; c < n; c++) out.area[c] = acc[c] / OM_TOTAL;
  out.n = n;
  film.idVersion++;
  if (erased) film.coverVersion++;
  return out;
}

// --------------------------------------------------------------------------------- flood

let seen: Uint8Array | null = null;
let qCap = 1 << 16;
let queue = new Int32Array(qCap);
const nbTmp = new Float64Array(3);
const DI = [1, -1, 0, 0], DJ = [0, 0, 1, -1];
const W3 = 3 * N;

/** Atlas index of the texel one step (di, dj) from (f, i, j), across face edges too. */
function neighbour(f: number, i: number, j: number, di: number, dj: number): number {
  const ni = i + di, nj = j + dj;
  if (ni >= 0 && ni < N && nj >= 0 && nj < N) return texelIndex(f, ni, nj);
  faceToDir(f, ni + 0.5, nj + 0.5, nbTmp);
  return texelAt(nbTmp[0], nbTmp[1], nbTmp[2]);
}

/**
 * Film of piece `id` goes wherever it can be reached from the seed texels over texels of
 * the piece that `gone` accepts (4-connected, so never across a cut). Returns how many
 * texels changed. Relabel afterwards.
 */
export function eraseFlood(film: Film, id: number, seeds: ArrayLike<number>, gone: (k: number) => boolean): number {
  const ids = ids16(film), cover = film.cover;
  if (!seen) seen = new Uint8Array(ids.length);
  let head = 0, tail = 0;
  const push = (k: number) => {
    if (tail === qCap) { qCap *= 2; const q = new Int32Array(qCap); q.set(queue); queue = q; }
    queue[tail++] = k;
    seen![k] = 1;
  };
  for (let m = 0; m < seeds.length; m++) { const k = seeds[m]; if (!seen[k] && ids[k] === id) push(k); }
  while (head < tail) {
    const k = queue[head++];
    const col = k % W3, row = (k / W3) | 0;
    const fc = (col / N) | 0, fr = (row / N) | 0;
    for (let q = 0; q < 4; q++) {
      const nk = neighbour(fr * 3 + fc, col - fc * N, row - fr * N, DI[q], DJ[q]);
      if (!seen[nk] && ids[nk] === id && gone(nk)) push(nk);
    }
  }
  for (let m = 0; m < tail; m++) { const k = queue[m]; seen[k] = 0; cover[k] = 0; }
  if (tail) film.coverVersion++;
  return tail;
}
