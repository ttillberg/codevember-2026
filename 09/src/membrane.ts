import {
  BufferAttribute, BufferGeometry, CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping,
  DoubleSide, FloatType, FrontSide, Group, Mesh, MeshPhysicalMaterial, NearestFilter, RedFormat, RGBAFormat, RGFormat,
  UnsignedByteType, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { R, type Ctx, type Module } from './state';
import { ATLAS_H, ATLAS_W, FILM_GLSL } from './film';
import { LIFT_GLSL, LIFT_H, LIFT_W } from './lift';
import type { Layer } from './layers';

// The sphere and its top membrane.
//
// Three draws, in this order:
//   under      opaque       world.next, a plain sphere a hair below R. Seen through grooves, where
//                           film is gone or lifted, and through translucent layers.
//   attached   blended, 1   world.layer, all film lying on the sphere, undeformed: everything but
//                           the lifted part of the piece being pulled.
//   lifted     blended, 2   that lifted part, the same sphere moved by the lift atlas (lift.ts).
// Where the film is and which piece it belongs to comes from the film atlases (film.ts), looked
// up from the UNDEFORMED sphere-local position, so the cut edges are exact whatever the mesh
// does. attached and lifted split the pulled piece on the same w = 0.5 line, so nothing is
// missing or doubled at the peel front, and everything on the sphere is down before the lifted
// sheet blends over it. Below the layer underneath nothing is drawn, it is treated as opaque.

const DENSITY = 150; // cells per cube face edge: 6 * 151² ≈ 137k verts
const UNDER_DENSITY = 80;
const UNDER_RADIUS = R * 0.998; // a membrane: the film is all but on the surface underneath

// Light balance for the membranes. RoomEnvironment is bright (a white room lit by a 900 cd
// point light plus emissive panels, one of them straight behind the camera): at
// envMapIntensity 1 its diffuse irradiance alone is ~2.5x albedo on the camera-facing side, and
// with the key light and ACES' own 1/0.6 pre-exposure every colour lands on the curve's
// shoulder and desaturates to pastel. A rough dielectric also picks up a uniform white
// env-specular veil. So: env diffuse is cut hard, env specular is kept for gloss (the
// reflections are the point) and cut for matte.
const ENV_DIFFUSE = 0.22;
const ENV_SPEC_GLOSS = 1.0;
const ENV_SPEC_MATTE = 0.1;
const DIRECT_SPEC_MATTE = 0.3;

// Lifted film, in lattice cells behind the peel front: nearly gone after LIFT_FADE_CELLS, lit
// by its own shape instead of the sphere's after LIFT_NORMAL_CELLS.
const LIFT_FADE_CELLS = 7.0;
const LIFT_NORMAL_CELLS = 2.0;
// The film is one even material. Where it is pulled thin a little more shows through, where
// it bunches it is a touch darker, and its own folds only tilt the light part of the way.
const LIFT_THIN = 0.3;      // how much stretch thins it: 0 not at all, 1 in full
const LIFT_FOLD_SHADE = 0.1; // darkening where it is gathered
const LIFT_FOLD_NORMAL = 0.7;
const LIFT_GLOSS = 0.85;       // how much of its reflections peeled film keeps, however see-through it is
const LIFT_NORMAL_STEP = 0.014; // rad between the points the sheet normal is taken from, about a cell // share of the sheet's own facets in its normal

/** The print on the film, as ink coverage: what a protective film carries, said once per
 *  cube face and otherwise left blank. */
function makePrint(anisotropy: number): CanvasTexture {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.textBaseline = 'alphabetic';
  const mono = 'ui-monospace, Menlo, Consolas, monospace';

  // One headline.
  g.font = `700 46px ${mono}`;
  g.fillText('PROTECTIVE FILM', 150, 400);
  g.font = `500 26px ${mono}`;
  g.fillText('REMOVE BEFORE USE  →', 150, 440);

  // One spec block, small, bottom right.
  g.font = `500 17px ${mono}`;
  const spec = ['PE-LD 50µm', 'LOT 0911-26', 'TYPE M-09', 'QC PASS'];
  spec.forEach((s, k) => g.fillText(s, 700, 760 + k * 24));
  g.fillRect(700, 734, 150, 1.5);

  // One registration mark.
  const x = 800, y = 230;
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x - 16, y); g.lineTo(x + 16, y); g.moveTo(x, y - 16); g.lineTo(x, y + 16); g.stroke();
  g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();

  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

function cubeSphere(n: number, radius: number): BufferGeometry {
  // [w, u, v] with u × v = w, so (u, v) quads wind counter-clockwise seen from outside.
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const side = n + 1;
  const vCount = 6 * side * side;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(6 * n * n * 6);
  let v = 0;
  let k = 0;
  for (const [w, u, vv] of faces) {
    const base = v;
    for (let j = 0; j <= n; j++) {
      // Equal-angle warp: far more even than a plain cube projection.
      const y = Math.tan((-1 + (2 * j) / n) * Math.PI * 0.25);
      for (let i = 0; i <= n; i++) {
        const x = Math.tan((-1 + (2 * i) / n) * Math.PI * 0.25);
        const px = w[0] + u[0] * x + vv[0] * y;
        const py = w[1] + u[1] * x + vv[1] * y;
        const pz = w[2] + u[2] * x + vv[2] * y;
        const l = 1 / Math.hypot(px, py, pz);
        nrm[v * 3] = px * l; nrm[v * 3 + 1] = py * l; nrm[v * 3 + 2] = pz * l;
        pos[v * 3] = px * l * radius; pos[v * 3 + 1] = py * l * radius; pos[v * 3 + 2] = pz * l * radius;
        v++;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = base + j * side + i;
        const b = a + 1;
        const c = a + side + 1;
        const d = a + side;
        // Alternate the diagonal so the lifted sheet does not show a uniform grain.
        if ((i + j) & 1) {
          idx[k++] = a; idx[k++] = b; idx[k++] = c;
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
        } else {
          idx[k++] = a; idx[k++] = b; idx[k++] = d;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- GLSL

const COMMON = /* glsl */ `
#define MR ${R.toFixed(4)}

varying vec3 vLocal;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 perpTo(vec3 d) {
  vec3 a = abs(d.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  return normalize(cross(d, a));
}
`;

const VERT_PARS = /* glsl */ `
#ifdef ROLE_LIFTED
varying vec3 vLiftN;
${FILM_GLSL}
uniform sampler2D uLift;
${LIFT_GLSL}
#endif
`;

const VERT_BEGIN = /* glsl */ `
  vLocal = position;
#ifdef ROLE_LIFTED
  transformed += liftAt(position).xyz;
  {
    // The sheet's own normal, from where its neighbours a cell away have been carried to.
    // Smooth over the mesh, so it gives one soft highlight and not a facet a triangle.
    vec3 r = normalize(position);
    vec3 t1 = perpTo(r), t2 = cross(r, t1);
    const float e = ${LIFT_NORMAL_STEP.toFixed(4)};
    vec3 pa = normalize(r + t1 * e) * MR, pb = normalize(r + t2 * e) * MR;
    vec3 n = cross(pa + liftAt(pa).xyz - transformed, pb + liftAt(pb).xyz - transformed);
    vLiftN = normalMatrix * (dot(n, n) > 1e-20 ? normalize(n) : r);
  }
#endif
`;

const FRAG_PARS = /* glsl */ `
#ifdef ROLE_LIFTED
varying vec3 vLiftN;
#endif
${FILM_GLSL}
uniform sampler2D uLift;  // lift.ts atlas: displacement xyz, cells behind the peel front w
uniform int uLiftId;      // the piece being pulled, 0 none
uniform float uLiftGhost; // how solid lifted film stays far behind the front
uniform float uLiftFade;  // 1 while held, runs to 0 after letting go
uniform sampler2D uCover; // film.cover: bilinear, film where the filtered value is above 0.5
#define LIFT_DEPTH
${LIFT_GLSL}

uniform sampler2D uId;    // film.id: nearest, low and high byte of the piece id
uniform vec4 uUnder;      // top layer underside rgb, roughness
uniform vec3 uTop;        // top layer opacity, translucent (0/1), scatter alpha
uniform sampler2D uPrint; // ink coverage of the print on the film, tiles
uniform vec4 uEnv;        // env diffuse, env specular gloss / matte, direct specular matte

#define LIFT_FADE_CELLS ${LIFT_FADE_CELLS.toFixed(1)}
#define LIFT_NORMAL_CELLS ${LIFT_NORMAL_CELLS.toFixed(1)}
#define LIFT_THIN ${LIFT_THIN.toFixed(3)}
#define LIFT_FOLD_SHADE ${LIFT_FOLD_SHADE.toFixed(3)}
#define LIFT_FOLD_NORMAL ${LIFT_FOLD_NORMAL.toFixed(3)}
#define LIFT_GLOSS ${LIFT_GLOSS.toFixed(3)}

// Antialiased coverage from a bilinear value c and its screen footprint cw: the 0.5 contour is
// a hard edge, smoothed over exactly one pixel at any zoom. Film cover and peel front alike.
float coverAA(float c, float cw) {
  return clamp((c - 0.5) / cw + 0.5, 0.0, 1.0);
}

int idAt(ivec2 t) {
  vec2 b = texelFetch(uId, t, 0).rg * 255.0 + 0.5;
  return int(b.x) + int(b.y) * 256;
}

// The piece at atlas uv (from filmUV). The nearest texel says so wherever it holds film. Right
// at an edge the bilinear cover can still be above 0.5 where the nearest texel is already
// groove (id 0): then the texel of the bilinear footprint that adds the most cover wins. The
// footprint is clamped to the face, like filmUV, so nothing bleeds in from the next face, and
// two pieces either side of a thin groove each keep the fragments closest to them.
int pieceAt(vec2 uv) {
  vec2 a = uv * vec2(3.0, 2.0) * FILM_N - 0.5;
  ivec2 lo = ivec2(floor(uv * vec2(3.0, 2.0)) * FILM_N);
  ivec2 hi = lo + int(FILM_N) - 1;
  vec2 b = floor(a);
  vec2 f = a - b;
  ivec2 t0 = clamp(ivec2(b), lo, hi);
  ivec2 t1 = clamp(ivec2(b) + 1, lo, hi);
  int id = idAt(ivec2(f.x < 0.5 ? t0.x : t1.x, f.y < 0.5 ? t0.y : t1.y));
  if (id != 0) return id;
  float best = 0.0;
  for (int k = 0; k < 4; k++) {
    bool hx = (k & 1) != 0, hy = k >= 2;
    ivec2 t = ivec2(hx ? t1.x : t0.x, hy ? t1.y : t0.y);
    float w = (hx ? f.x : 1.0 - f.x) * (hy ? f.y : 1.0 - f.y) * texelFetch(uCover, t, 0).r;
    if (w <= best) continue;
    int i = idAt(t);
    if (i != 0) { best = w; id = i; }
  }
  return id;
}

#ifdef ROLE_UNDER
// Is the film still lying on the sphere at p? All of it but the lifted part of the pulled piece.
float downAt(vec3 p, vec2 uv) {
  if (uLiftId == 0 || pieceAt(uv) != uLiftId) return 1.0;
  return 1.0 - step(0.5, liftAt(p).w);
}

// A cut reads as a thin dark line on any colour: the paper darkens a little inside a narrow
// groove, where film is down on both sides within GROOVE_REACH texels. Wide bare areas, and
// the paper along their edges, stay clean. No ledge or cast shadows anywhere: the film is a
// membrane, it has no thickness to shade.
#define GROOVE_REACH 4.0
#define GROOVE_DARK 0.6
float grooveShade(vec3 P, float cov) {
  float open = 1.0 - cov;
  if (open <= 0.0) return 1.0;
  vec3 n = P / MR;
  vec3 t1 = perpTo(n);
  vec3 t2 = cross(n, t1);
  float reach = GROOVE_REACH * (0.5 * PI / FILM_N) * MR;
  float g = 0.0;
  for (int k = 0; k < 2; k++) {
    vec3 t = (k == 0 ? t1 : t2) * reach;
    vec3 pa = normalize(P + t) * MR;
    vec3 pb = normalize(P - t) * MR;
    vec2 ua = filmUV(pa);
    vec2 ub = filmUV(pb);
    float both = smoothstep(0.5, 0.9, min(textureLod(uCover, ua, 0.0).r, textureLod(uCover, ub, 0.0).r));
    if (both <= g) continue;
    g = max(g, both * downAt(pa, ua) * downAt(pb, ub));
  }
  return 1.0 - GROOVE_DARK * g * open;
}
#endif

#ifdef ROLE_ATTACHED
uniform int uHoverId;     // the piece a press would grab, 0 none
uniform float uHoverOk;   // 1 it can be pulled, 0 too wide

// Debug outline of the hovered piece: 1 within HOVER_PX pixels of where its film ends.
#define HOVER_PX 2.5
float hoverLine(vec3 P, vec3 dx, vec3 dy, int id, float cw) {
  float inside = 1.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * (PI / 4.0);
    vec2 uv = filmUV(P + (dx * cos(a) + dy * sin(a)) * HOVER_PX);
    inside = min(inside, pieceAt(uv) == id ? coverAA(textureLod(uCover, uv, 0.0).r, cw) : 0.0);
    if (inside <= 0.0) break;
  }
  return 1.0 - inside;
}
#endif

// Where a point of the film samples the print: one cube face each, equal angles, wound so
// the text reads the right way round on every face (and mirrored from behind, as print does).
#define PRINT_REPEAT 1.0
vec2 printUV(vec3 p) {
  vec3 a = abs(p);
  vec2 q;
  if (a.x >= a.y && a.x >= a.z) q = vec2(-sign(p.x) * p.z, p.y) / a.x;
  else if (a.y >= a.z) q = vec2(p.x, -sign(p.y) * p.z) / a.y;
  else q = vec2(sign(p.z) * p.x, p.y) / a.z;
  return (atan(q) * (2.0 / PI) + 0.5) * PRINT_REPEAT;
}

// Millimetre paper on the root sphere, laid out per cube face so it never pinches: a fine
// line every mm, a stronger one every 10. Returns line strength 0..1.
#define GRID_MM 40.0
float gridLine(vec2 uv, float n, float px, float w) {
  vec2 g = uv * n;
  vec2 d = abs(fract(g - 0.5) - 0.5) / (w * n);
  // Fades out before the lines get denser than the pixels.
  float fade = 1.0 - smoothstep(0.25, 0.6, w * n);
  return (1.0 - smoothstep(px - 0.5, px + 0.5, min(d.x, d.y))) * fade;
}
float mmGrid(vec3 p) {
  vec3 a = abs(p);
  vec2 q = a.x >= a.y && a.x >= a.z ? p.yz / a.x : (a.y >= a.z ? p.xz / a.y : p.xy / a.z);
  // Equal angles, so the squares keep their size from the middle of a face to its edge.
  vec2 uv = atan(q) * (2.0 / PI);
  // Pixel size in uv from the position itself: uv jumps at the face seams, p does not.
  float w = length(fwidth(p)) * (2.0 / PI) * 0.7;
  return max(0.35 * gridLine(uv, GRID_MM, 0.5, w), gridLine(uv, GRID_MM / 10.0, 0.9, w));
}
`;

// Everything that needs screen derivatives is computed first, before any discard.
const FRAG_PRE = /* glsl */ `
  vec3 P = normalize(vLocal) * MR;
  vec2 fuv = filmUV(P);
  float fc = texture(uCover, fuv).r;
  float fcw = max(fwidth(fc), 1e-4);
  float cov = coverAA(fc, fcw);
  float shade = 1.0;
  bool backFilm = false;
#ifdef ROLE_UNDER
  shade = grooveShade(P, cov);
#else
  // Cells behind the peel front, and how much of this pixel is past it.
  float lw = uLiftId != 0 ? liftDepth(P) : 0.0;
  float up = coverAA(lw, max(fwidth(lw), 1e-4));
#endif
#ifdef ROLE_ATTACHED
  vec3 dPx = dFdx(vLocal);
  vec3 dPy = dFdy(vLocal);
#endif
#ifdef ROLE_LIFTED
  vec3 dN = cross(dFdx(vViewPosition), dFdy(vViewPosition));
  // How much the sheet is stretched here: its area now over its area at rest.
  float stretch = clamp(length(dN) / max(length(cross(dFdx(vLocal), dFdy(vLocal))), 1e-20), 0.25, 8.0);
#endif
#ifndef ROLE_UNDER
  if (cov <= 0.0) discard;
  int pid = pieceAt(fuv);
  float lifted = uLiftId != 0 && pid == uLiftId ? up : 0.0;
  #ifdef ROLE_ATTACHED
  cov *= 1.0 - lifted;
  #else
  cov *= lifted;
  #endif
  if (cov <= 0.0) discard;
#endif
`;

// Lifted film: as it leaves the sphere its own shape takes over from the radial normal.
const FRAG_NORMAL = /* glsl */ `
#ifdef ROLE_LIFTED
  {
    // the smooth sheet normal, turned to face the eye whichever side is up
    vec3 fn = normalize(vLiftN);
    if (dot(fn, vViewPosition) < 0.0) fn = -fn;
    normal = normalize(mix(normal, fn, LIFT_FOLD_NORMAL * smoothstep(0.5, LIFT_NORMAL_CELLS, lw)));
    nonPerturbedNormal = normal;
  }
#endif
`;

const FRAG_COLOR = /* glsl */ `
  float liftFade = 1.0;
#ifdef ROLE_UNDER
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.27, 0.36), 0.7 * mmGrid(P)); // grey-blue ink
#else
  #ifdef ROLE_LIFTED
  // Both sides of the film look the same: gathered film turns its facets every which way,
  // and a different underside would show each one.
  #endif
  // The print: ink on the film, so it travels with every piece and shows mirrored from behind.
  float ink = texture2D(uPrint, printUV(P)).r * (backFilm ? 0.55 : 1.0);
  #ifdef ROLE_LIFTED
  ink = 0.0; // peeled film is plain: its own flat, see-through look, no print
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.09, 0.2), ink * 0.9);
  // Film alpha. Opaque layers: 1. Translucent ones only scatter a little of their own colour,
  // the tint of what is underneath happens in the under-sphere shader.
  float filmA = uTop.y > 0.5 ? uTop.z : 1.0;
  filmA = max(filmA, ink * 0.8);
  diffuseColor.a = cov * filmA;
  #ifdef ROLE_ATTACHED
  if (uHoverId != 0 && pid == uHoverId) {
    // Debug outline of the piece a press would grab. Magenta: pull it. Grey: too wide, cut it narrower.
    float k = hoverLine(P, dPx, dPy, pid, fcw);
    diffuseColor.rgb = mix(diffuseColor.rgb, uHoverOk > 0.5 ? vec3(1.0, 0.0, 0.55) : vec3(0.25), k);
    diffuseColor.a = max(diffuseColor.a, k * cov);
  }
  #endif
  #ifdef ROLE_LIFTED
  // Peeled film is one plain transparent sheet: the same everywhere, however it is
  // stretched, gathered or folded.
  liftFade = uLiftFade * uLiftGhost;
  diffuseColor.a *= liftFade;
  #endif
#endif
`;

const FRAG_ROUGH = /* glsl */ `
#ifdef ROLE_LIFTED
  if (backFilm) roughnessFactor = clamp(uUnder.a * (0.5 + 1.0 * vnoise(P * 9.0 + 4.0)), 0.05, 1.0);
#endif
`;

const FRAG_LIGHTS = /* glsl */ `
  {
    float rk = smoothstep(0.25, 0.85, material.roughness);
    reflectedLight.indirectDiffuse *= uEnv.x;
    reflectedLight.indirectSpecular *= mix(uEnv.y, uEnv.z, rk);
    reflectedLight.directSpecular *= mix(1.0, uEnv.w, rk);
  }
`;

const FRAG_MATERIAL = /* glsl */ `
#ifdef ROLE_LIFTED
  if (backFilm) {
    #ifdef USE_CLEARCOAT
      material.clearcoat = 0.5;
      material.clearcoatRoughness = clamp(0.06 + geometryRoughness, 0.045, 1.0);
    #endif
  }
#endif
`;

const FRAG_POST = /* glsl */ `
#ifdef ROLE_UNDER
  outgoingLight *= shade;
#else
  {
    // Blend like glass: the diffuse part is mixed by the film opacity, reflections stay at
    // full strength and hide a little more of what is behind.
    vec3 dif = totalDiffuse * shade;
    // Peeled film is see-through but still glossy: its reflections do not thin out with it.
    #ifdef ROLE_LIFTED
    float specKeep = uLiftFade * max(liftFade, LIFT_GLOSS);
    #else
    float specKeep = liftFade;
    #endif
    vec3 spec = max(outgoingLight * shade - dif, 0.0) * cov * specKeep;
    float a = diffuseColor.a;
    float lum = clamp(dot(spec, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float aOut = clamp(a + lum * (1.0 - a), 0.0, 1.0);
    outgoingLight = (dif * a + spec) / max(aOut, 1e-3);
    diffuseColor.a = aOut;
  }
#endif
`;

type Role = 'under' | 'attached' | 'lifted';

const BLEND_ORDER: Record<Role, number> = { under: 0, attached: 1, lifted: 2 };

function patch(src: string, find: string, add: string, before = false): string {
  if (!src.includes(find)) throw new Error(`membrane: shader chunk ${find} not found`);
  return src.replace(find, before ? `${add}\n${find}` : `${find}\n${add}`);
}

function makeMaterial(
  role: Role,
  uniforms: Record<string, { value: unknown }>,
): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    // The lifted sheet folds back over itself: both sides show.
    side: role === 'lifted' ? DoubleSide : FrontSide,
    transparent: role !== 'under',
    metalness: 0,
    // Only there so the underside can switch it on in the shader; layers do not use it.
    clearcoat: 1e-3,
    clearcoatRoughness: 0.05,
  });
  mat.forceSinglePass = true;
  mat.depthWrite = true;
  const define = `#define ROLE_${role.toUpperCase()}\n`;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    vs = patch(vs, 'void main() {', define + COMMON + VERT_PARS, true);
    vs = patch(vs, '#include <begin_vertex>', VERT_BEGIN);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = patch(fs, 'void main() {', define + COMMON + FRAG_PARS, true);
    fs = patch(fs, '#include <clipping_planes_fragment>', FRAG_PRE);
    fs = patch(fs, '#include <color_fragment>', FRAG_COLOR);
    fs = patch(fs, '#include <metalnessmap_fragment>', FRAG_ROUGH);
    fs = patch(fs, '#include <normal_fragment_begin>', FRAG_NORMAL);
    fs = patch(fs, '#include <lights_physical_fragment>', FRAG_MATERIAL);
    fs = patch(fs, '#include <lights_fragment_end>', FRAG_LIGHTS);
    fs = patch(fs, '#include <opaque_fragment>', FRAG_POST, true);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `membrane-${role}`;
  return mat;
}

/** Copy a layer's finish onto a material: colour and roughness, nothing that recompiles. */
function applyLayer(mat: MeshPhysicalMaterial, layer: Layer) {
  mat.color.copy(layer.color);
  mat.roughness = layer.roughness;
}

export function createMembrane(ctx: Ctx): Module {
  const { world, scene, renderer, camera } = ctx;

  const group = new Group();
  scene.add(group);

  // ---- the film atlases, uploaded only when the sim bumps their version
  const coverTex = new DataTexture(world.film.cover, ATLAS_W, ATLAS_H, RedFormat, UnsignedByteType);
  coverTex.magFilter = coverTex.minFilter = LinearFilter;
  const idTex = new DataTexture(world.film.id, ATLAS_W, ATLAS_H, RGFormat, UnsignedByteType);
  for (const t of [coverTex, idTex]) {
    t.generateMipmaps = false;
    t.flipY = false;
    t.unpackAlignment = 1; // 1 and 2 byte texels: rows need not be 4-byte aligned
  }
  let coverVersion = -1;
  let idVersion = -1;
  const syncFilm = () => {
    const f = world.film;
    if (coverTex.image.data !== f.cover) { coverTex.image.data = f.cover; coverVersion = -1; }
    if (idTex.image.data !== f.id) { idTex.image.data = f.id; idVersion = -1; }
    if (f.coverVersion !== coverVersion) { coverVersion = f.coverVersion; coverTex.needsUpdate = true; }
    if (f.idVersion !== idVersion) { idVersion = f.idVersion; idTex.needsUpdate = true; }
  };

  // ---- the lift atlas, same deal
  const liftTex = new DataTexture(world.lift.data, LIFT_W, LIFT_H, RGBAFormat, FloatType);
  liftTex.magFilter = liftTex.minFilter = NearestFilter;
  liftTex.generateMipmaps = false;
  liftTex.flipY = false;
  let liftVersion = -1;
  const syncLift = () => {
    const l = world.lift;
    if (liftTex.image.data !== l.data) { liftTex.image.data = l.data; liftVersion = -1; }
    if (l.version !== liftVersion) { liftVersion = l.version; liftTex.needsUpdate = true; }
  };

  // ---- shared uniforms (same objects in every material)
  const shared = {
    uCover: { value: coverTex },
    uId: { value: idTex },
    uLift: { value: liftTex },
    uLiftId: { value: 0 },
    uLiftFade: { value: 1 },
    uLiftGhost: { value: 0.45 },
    uHoverId: { value: 0 },
    uHoverOk: { value: 1 },
    uUnder: { value: new Vector4(1, 1, 1, 0.25) },
    uTop: { value: new Vector3(1, 0, 1) },
    uPrint: { value: makePrint(ctx.renderer.capabilities.getMaxAnisotropy()) },
    uEnv: { value: new Vector4(ENV_DIFFUSE, ENV_SPEC_GLOSS, ENV_SPEC_MATTE, DIRECT_SPEC_MATTE) },
  };

  const geo = cubeSphere(DENSITY, R);
  const mk = (role: Role, g: BufferGeometry) => {
    const mesh = new Mesh(g, makeMaterial(role, shared));
    mesh.renderOrder = BLEND_ORDER[role];
    group.add(mesh);
    return mesh;
  };
  const under = mk('under', cubeSphere(UNDER_DENSITY, UNDER_RADIUS));
  const attached = mk('attached', geo);
  const lifted = mk('lifted', geo);
  lifted.frustumCulled = false; // moved by the lift atlas, past the sphere's bounds
  const filmMats = [attached.material, lifted.material];

  // ---- layers
  let curLayer: Layer | null = null;
  let curNext: Layer | null = null;
  const syncLayers = () => {
    if (world.layer !== curLayer) {
      curLayer = world.layer;
      for (const m of filmMats) applyLayer(m, curLayer);
      const uc = curLayer.under.color;
      shared.uUnder.value.set(uc.r, uc.g, uc.b, curLayer.under.roughness);
      const op = curLayer.opacity;
      const translucent = op < 0.999;
      // A milky film: it simply lays its own colour over what is underneath.
      const scatter = translucent ? op : 1;
      shared.uTop.value.set(op, translucent ? 1 : 0, scatter);
    }
    if (world.next !== curNext) {
      curNext = world.next;
      applyLayer(under.material, curNext);
    }
  };

  let warmed = false;
  function prewarm() {
    // Compile every program now, not on the first grab.
    lifted.visible = true;
    renderer.compile(scene, camera);
    warmed = true;
  }

  return {
    update() {
      syncLayers();
      syncFilm();
      syncLift();
      if (!warmed) prewarm();
      group.quaternion.copy(world.rotation);

      shared.uHoverId.value = world.hover.id;
      shared.uHoverOk.value = world.hover.ok ? 1 : 0;
      shared.uLiftId.value = world.lift.id;
      shared.uLiftFade.value = world.lift.fade;
      shared.uLiftGhost.value = world.lift.ghost;
      lifted.visible = world.lift.id !== 0;
    },
  };
}
