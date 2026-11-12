// The film being pulled, as data: a coarse lattice of particles over the sphere, written by
// the sim (peel.ts) and drawn by membrane.ts. Like film.ts this file is the contract: the
// layout lives here once, in TypeScript and in GLSL.
//
// Lattice
//   The same cube unwrap as film.ts, LIFT_M x LIFT_M cells a face; cell (i, j) of a face
//   covers CELL x CELL film texels and its particle rests at the cell centre, on the sphere.
//
// Atlas
//   RGBA float, nearest. Each face is a tile of LIFT_T = LIFT_M + 2 cells: one cell of
//   padding all round, filled by the sim with the neighbouring face's cells, so a bilinear
//   read never has to stop at a face edge. Tiles sit 3 x 2 like the film atlas: face f at
//   column f % 3, row f / 3 | 0. Atlas size 3 LIFT_T x 2 LIFT_T.
//   Cell (f, i, j), i and j in -1..LIFT_M, is at atlas texel
//     x = (f % 3) * LIFT_T + i + 1,  y = (f / 3 | 0) * LIFT_T + j + 1
//
// A texel
//   xyz  where the particle is, minus where it rests: a displacement in sphere-local units.
//   w    0 for film still down. For lifted film, how many cells behind the peel front it
//        is (1 just let go, growing from there).
//   Read bilinearly (liftAt in GLSL): film is lifted where w > 0.5, and that line is the
//   peel front. Across a cut the lattice is too coarse to say which side a point is on:
//   there liftDepth (GLSL) only counts the cells the film reaches from that point. Cells that hold no film of the piece being pulled carry their lifted
//   neighbours' values, so the read is good right up to a cut.

import { FILM_N } from './film';

export const LIFT_M = 128;
export const LIFT_T = LIFT_M + 2;
export const LIFT_W = LIFT_T * 3;
export const LIFT_H = LIFT_T * 2;
/** Film texels along a cell. */
export const CELL = FILM_N / LIFT_M;

/** Most corners the fan polygon has. */
export const FAN_MAX = 32;

export interface Lift {
  /** LIFT_W * LIFT_H * 4. */
  data: Float32Array;
  /** Bumped when data changed; membrane re-uploads. */
  version: number;
  /** Which film is being pulled (index into world.films), and the piece of it (its id
   *  atlas value), 0 when nothing is. Only that piece's film is lifted. */
  layer: number;
  id: number;
  /** 1 while held. After letting go it runs to 0 and the lifted film goes with it. */
  fade: number;
  /** How solid lifted film still is far behind the front, 0..1. Low is the look, high is
   *  for seeing what the sheet does. */
  ghost: number;
  /** How much of the lifted film is shown at all: only what is no higher than this over
   *  the sphere, in radii. Above that it is cut off. */
  band: number;
  /** The fan: the film between the hand and the front being pulled, the only lifted film
   *  that is drawn. A convex polygon of n corners (counter-clockwise, at most FAN_MAX) in
   *  the flat map with centre c and axes u, v (unit, sphere-local): a point p maps to
   *  (p.u, p.v) / (p.c). n = 0: all of the lifted film is drawn. */
  fan: { c: Float32Array; u: Float32Array; v: Float32Array; pts: Float32Array; n: number };
}

export function createLift(): Lift {
  return { data: new Float32Array(LIFT_W * LIFT_H * 4), version: 1, layer: 0, id: 0, fade: 1, ghost: 0.6, band: 2,
    fan: { c: new Float32Array(3), u: new Float32Array(3), v: new Float32Array(3), pts: new Float32Array(FAN_MAX * 2), n: 0 } };
}

/** Index into data (times 4 already) of cell (f, i, j), i and j in -1..LIFT_M. */
export function liftIndex(f: number, i: number, j: number): number {
  return ((((f / 3) | 0) * LIFT_T + j + 1) * LIFT_W + (f % 3) * LIFT_T + i + 1) * 4;
}

/** Bilinear read of the atlas at face f, continuous cell coordinates (x, y) in [0, LIFT_M]
 *  (x = i + 0.5 is the centre of cell i). Component c: 0..2 displacement, 3 depth. The
 *  same arithmetic as liftAt in GLSL. */
export function liftRead(data: Float32Array, f: number, x: number, y: number, c: number): number {
  const u = x - 0.5, v = y - 0.5;
  const i = Math.floor(u), j = Math.floor(v), tx = u - i, ty = v - j;
  const k = liftIndex(f, i, j) + c, row = LIFT_W * 4;
  return (data[k] * (1 - tx) + data[k + 4] * tx) * (1 - ty) + (data[k + row] * (1 - tx) + data[k + row + 4] * tx) * ty;
}

/** For the shaders. Needs FILM_GLSL (filmFace) before it and `uniform sampler2D uLift`.
 *  liftAt(p): bilinear atlas value at the sphere-local rest position p. With LIFT_DEPTH
 *  defined (and `uniform sampler2D uCover`), also liftDepth(p). */
export const LIFT_GLSL = /* glsl */ `
#define LIFT_M ${LIFT_M}.0
#define LIFT_T ${LIFT_T}
vec4 liftAt(vec3 p) {
  float face; vec2 uv;
  filmFace(p, face, uv);
  vec2 q = uv * LIFT_M - 0.5;
  vec2 fl = floor(q), t = q - fl;
  ivec2 o = ivec2(int(mod(face, 3.0)), int(floor(face / 3.0))) * LIFT_T + ivec2(fl) + 1;
  vec4 a = texelFetch(uLift, o, 0), b = texelFetch(uLift, o + ivec2(1, 0), 0);
  vec4 c = texelFetch(uLift, o + ivec2(0, 1), 0), d = texelFetch(uLift, o + ivec2(1, 1), 0);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
#ifdef LIFT_DEPTH
// w at p for a point ON the film. Where the four cells disagree about being lifted, only
// those the film reaches from p without a gap count (the cover atlas, sampled on the way to
// each cell's centre): the line between lifted and not then runs along the cut itself.
float liftDepth(vec3 p) {
  float face; vec2 uv;
  filmFace(p, face, uv);
  vec2 q = uv * LIFT_M - 0.5;
  vec2 fl = floor(q), t = q - fl;
  vec2 tile = vec2(mod(face, 3.0), floor(face / 3.0));
  ivec2 o = ivec2(tile) * LIFT_T + ivec2(fl) + 1;
  vec4 w = vec4(texelFetch(uLift, o, 0).w, texelFetch(uLift, o + ivec2(1, 0), 0).w,
                texelFetch(uLift, o + ivec2(0, 1), 0).w, texelFetch(uLift, o + ivec2(1, 1), 0).w);
  vec4 k = vec4((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  float lo = min(min(w.x, w.y), min(w.z, w.w)), hi = max(max(w.x, w.y), max(w.z, w.w));
  if (lo > 0.5 || hi < 0.5) return dot(w, k);
  vec4 ok;
  for (int c = 0; c < 4; c++) {
    vec2 centre = (fl + vec2(float(c & 1), float(c >> 1)) + 0.5) / LIFT_M;
    float m = 1.0;
    for (int s = 1; s <= 4; s++) {
      vec2 u = clamp(mix(uv, centre, float(s) * 0.25), 0.5 / FILM_N, 1.0 - 0.5 / FILM_N);
      m = min(m, textureLod(uCover, (tile + u) / vec2(3.0, 2.0), 0.0).r);
    }
    ok[c] = step(0.8, m);
  }
  float sum = dot(k, ok);
  return sum > 1e-4 ? dot(w, k * ok) / sum : dot(w, k);
}
#endif
`;
