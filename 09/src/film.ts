// The film as data: where it still covers the sphere and which piece each bit belongs to.
// This file is the contract between sim (writes) and membrane (uploads and samples). The
// layout and the direction <-> texel mapping live here once, in TypeScript and in GLSL, so
// the two can never disagree.
//
// Layout
//   The sphere is unwrapped onto a cube, equal angles per face, N x N texels a face.
//   Faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. On a face the two in-face axes are
//     X faces: (y, z)    Y faces: (x, z)    Z faces: (x, y)
//   and for a direction p with major axis m:  q = inFace(p) / |p.m|,  uv = atan(q) * 4 / PI,
//   so uv is in [-1, 1]². Texel (i, j) covers u = (i + 0.5) / N * 2 - 1, same for v and j.
//   The six faces sit in one atlas, 3 columns x 2 rows: face f at column f % 3, row f / 3 | 0.
//   Atlas size is 3N x 2N. Array index of texel (f, i, j):
//     ((row * N + j) * 3N + col * N + i)        row 0 is the bottom of the texture (flipY off)
//
// Two atlases
//   cover  Uint8, one byte a texel: 255 film, 0 none. Antialiased at edges (a cut paints a
//          soft-edged groove), sampled with bilinear filtering; the film exists where the
//          filtered value is above 0.5.
//   id     Uint8 x 2 a texel (low byte, high byte): the piece this texel belongs to, 0 for
//          none. Sampled nearest. id is 0 exactly where cover < 128.
//   Pieces are the 4-connected regions of texels with cover >= 128 (connected across face
//   edges too).

export const FILM_N = 1024;
export const ATLAS_W = FILM_N * 3;
export const ATLAS_H = FILM_N * 2;

export interface Film {
  cover: Uint8Array;        // ATLAS_W * ATLAS_H
  id: Uint8Array;           // ATLAS_W * ATLAS_H * 2
  /** Bumped by whoever writes; membrane re-uploads an atlas when its number changed. */
  coverVersion: number;
  idVersion: number;
}

export function createFilm(): Film {
  const cover = new Uint8Array(ATLAS_W * ATLAS_H).fill(255);
  const id = new Uint8Array(ATLAS_W * ATLAS_H * 2);
  for (let k = 0; k < id.length; k += 2) id[k] = 1; // one piece, id 1
  return { cover, id, coverVersion: 1, idVersion: 1 };
}

/** Atlas array index of texel (face, i, j). Multiply by 2 for the id atlas. */
export function texelIndex(face: number, i: number, j: number): number {
  const col = face % 3, row = (face / 3) | 0;
  return (row * FILM_N + j) * ATLAS_W + col * FILM_N + i;
}

const Q = Math.PI / 4;

/** Direction (need not be unit) -> face and continuous texel coordinates (i + 0.5 is the
 *  centre of texel i). Writes out[0] = face, out[1] = x, out[2] = y, x and y in [0, N]. */
export function dirToFace(x: number, y: number, z: number, out: Float64Array | number[]): void {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f: number, a: number, b: number, m: number;
  if (ax >= ay && ax >= az) { f = x >= 0 ? 0 : 1; a = y; b = z; m = ax; }
  else if (ay >= az) { f = y >= 0 ? 2 : 3; a = x; b = z; m = ay; }
  else { f = z >= 0 ? 4 : 5; a = x; b = y; m = az; }
  out[0] = f;
  out[1] = (Math.atan(a / m) / Q * 0.5 + 0.5) * FILM_N;
  out[2] = (Math.atan(b / m) / Q * 0.5 + 0.5) * FILM_N;
}

/** Face and continuous texel coordinates -> unit direction, written to out[0..2].
 *  x and y may lie outside [0, N]: the face plane is simply extended, which is how a
 *  neighbour across a face edge is found (map the result back with dirToFace). */
export function faceToDir(face: number, x: number, y: number, out: Float64Array | number[]): void {
  const a = Math.tan((x / FILM_N * 2 - 1) * Q);
  const b = Math.tan((y / FILM_N * 2 - 1) * Q);
  const s = face & 1 ? -1 : 1;
  let px: number, py: number, pz: number;
  if (face < 2) { px = s; py = a; pz = b; }
  else if (face < 4) { px = a; py = s; pz = b; }
  else { px = a; py = b; pz = s; }
  const l = 1 / Math.hypot(px, py, pz);
  out[0] = px * l; out[1] = py * l; out[2] = pz * l;
}

/** The same mapping for the shaders. filmUV(p) is the atlas uv of a sphere-local point,
 *  kept half a texel inside its face so bilinear filtering never bleeds a neighbour in.
 *  filmTexel(p) is the integer atlas texel, for texelFetch on the id atlas. */
export const FILM_GLSL = /* glsl */ `
#define FILM_N ${FILM_N}.0
void filmFace(vec3 p, out float face, out vec2 uv) {
  vec3 a = abs(p);
  vec2 q;
  if (a.x >= a.y && a.x >= a.z) { face = p.x >= 0.0 ? 0.0 : 1.0; q = p.yz / a.x; }
  else if (a.y >= a.z) { face = p.y >= 0.0 ? 2.0 : 3.0; q = p.xz / a.y; }
  else { face = p.z >= 0.0 ? 4.0 : 5.0; q = p.xy / a.z; }
  uv = atan(q) * (2.0 / 3.14159265359) + 0.5; // 0..1 on the face
}
vec2 filmUV(vec3 p) {
  float face; vec2 uv;
  filmFace(p, face, uv);
  uv = clamp(uv, 0.5 / FILM_N, 1.0 - 0.5 / FILM_N);
  return (vec2(mod(face, 3.0), floor(face / 3.0)) + uv) / vec2(3.0, 2.0);
}
ivec2 filmTexel(vec3 p) {
  float face; vec2 uv;
  filmFace(p, face, uv);
  vec2 t = min(floor(uv * FILM_N), FILM_N - 1.0);
  return ivec2(vec2(mod(face, 3.0), floor(face / 3.0)) * FILM_N + t);
}
`;
