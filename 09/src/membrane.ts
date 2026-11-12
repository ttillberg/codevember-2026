import {
  BufferAttribute, BufferGeometry, CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping,
  DoubleSide, FloatType, FrontSide, Group, Mesh, MeshPhysicalMaterial, NearestFilter, RedFormat, RGBAFormat, RGFormat,
  UnsignedByteType, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { R, type Ctx, type Module } from './state';
import { ATLAS_H, ATLAS_W, FILM_GLSL, type Film } from './film';
import { LIFT_GLSL, LIFT_H, LIFT_W } from './lift';
import { FILMS_MAX, type Layer } from './layers';

// The sphere and its stack of membranes.
//
// Draws, in this order:
//   under      opaque          world.next, a plain sphere a hair below the films. Seen through
//                              grooves, where film is gone or lifted, and through translucent films.
//   attached   blended, 1..M   one a film slot (M = FILMS_MAX), from the bottom one up to the top
//                              one (films[0]): all of that film lying on the sphere, undeformed.
//                              Slots past world.films.length are hidden. The film being pulled
//                              leaves out the lifted part of its piece.
//   lifted     blended, M + 1  that lifted part, the same sphere moved by the lift atlas (lift.ts).
// Where the film is and which piece it belongs to comes from the film atlases (film.ts), looked
// up from the UNDEFORMED sphere-local position, so the cut edges are exact whatever the mesh
// does. attached and lifted split the pulled piece on the same w = 0.5 line, so nothing is
// missing or doubled at the peel front, and everything on the sphere is down before the lifted
// sheet blends over it. Each film sits FILM_STEP below the one over it, so they never z-fight.
// Below the sphere underneath nothing is drawn, it is treated as opaque.

const DENSITY = 150; // cells per cube face edge: 6 * 151² ≈ 137k verts
const UNDER_DENSITY = 80;
const UNDER_RADIUS = R * 0.998; // a membrane: the film is all but on the surface underneath
// From one film slot down to the next, just enough for the depth buffer. The lowest slot is
// at 0.9985 R: over the sphere (0.998 R) and the eye (0.9975 R, eye.ts).
const FILM_STEP = R * 0.0005;

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
// A film has no thickness to draw, but its rim tilts the light a little over a few texels,
// so it reads as lying on what is under it. Height in radii, width in film texels.
const FILM_BUMP = 0.004;
const FILM_BEVEL = 3.5;
const NET_WAVE = 34;           // the net's waves per radius: about a dozen veins across the sphere
const FINGER_FADE = 0.22 * R;  // round the finger, lifted film thins out to nothing within this
const FINGER_RISE = 0.9;       // ... but never further than this much of the finger's height: a film just taken hold of is whole
const FINGER_CLEAR = 0.3;      // the part of that reach, nearest the finger, where there is none at all
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
uniform float uLiftGhost; // how solid lifted film is
uniform float uLiftBand;  // height over the sphere (radii) up to which lifted film is shown
uniform float uLiftFade;  // 1 while held, runs to 0 after letting go
uniform vec4 uFinger;      // where the finger holds the film (world, from the sphere's centre), and how far round it the film thins out
uniform sampler2D uCover; // film.cover: bilinear, film where the filtered value is above 0.5
#define LIFT_DEPTH
${LIFT_GLSL}

uniform sampler2D uId;    // film.id: nearest, low and high byte of the piece id
uniform vec4 uUnder;      // this film's underside rgb, roughness
uniform vec3 uTop;        // this film's opacity, translucent (0/1), scatter alpha
uniform sampler2D uPrint; // ink coverage of the print on the film, tiles
uniform float uPrintOn;   // 1 this film carries the label, 0 not
uniform float uNet;       // 1 this film is veined with a net instead
uniform vec3 uInk;        // the colour of what is printed
uniform sampler2D uAbove; // cover of the film over this one, for the hairline of its cuts
uniform float uAboveOn;   // 1 there is a film over this one, 0 it is the top one
uniform float uAboveLift; // 1 the film over this one is being pulled
uniform float uGrid;      // 1 draws the millimetre grid on the sphere, 0 leaves it plain
uniform vec4 uEnv;        // env diffuse, env specular gloss / matte, direct specular matte

#define LIFT_FADE_CELLS ${LIFT_FADE_CELLS.toFixed(1)}
#define LIFT_NORMAL_CELLS ${LIFT_NORMAL_CELLS.toFixed(1)}
#define LIFT_THIN ${LIFT_THIN.toFixed(3)}
#define LIFT_FOLD_SHADE ${LIFT_FOLD_SHADE.toFixed(3)}
#define LIFT_FOLD_NORMAL ${LIFT_FOLD_NORMAL.toFixed(3)}
#define LIFT_GLOSS ${LIFT_GLOSS.toFixed(3)}
#define FINGER_CLEAR ${FINGER_CLEAR.toFixed(3)}
#define NET_WAVE ${NET_WAVE.toFixed(1)}
#define FILM_BUMP ${FILM_BUMP.toFixed(5)}
#define FILM_BEVEL vec2(${(FILM_BEVEL / ATLAS_W).toFixed(7)}, ${(FILM_BEVEL / ATLAS_H).toFixed(7)})

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
#endif
#ifdef ROLE_ATTACHED
// The same for the film above. Its ids are not at hand here: all of the lift atlas counts,
// which only differs from the piece's own lifted part within a cell of a cut.
float downAt(vec3 p, vec2 uv) {
  return uAboveLift > 0.5 ? 1.0 - step(0.5, liftAt(p).w) : 1.0;
}
#endif

#if defined(ROLE_UNDER) || defined(ROLE_ATTACHED)
// A cut reads as a thin dark line on any colour: what is underneath darkens a little inside a
// narrow groove, where film is down on both sides within GROOVE_REACH texels. Wide bare areas,
// and what is along their edges, stay clean. No ledge or cast shadows anywhere: the film is a
// membrane, it has no thickness to shade. film is the cover of the film the groove is cut in,
// open how much of it is missing here.
#define GROOVE_REACH 4.0
#define GROOVE_DARK 0.6
float grooveShade(sampler2D film, vec3 P, float open) {
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
    float both = smoothstep(0.5, 0.9, min(textureLod(film, ua, 0.0).r, textureLod(film, ub, 0.0).r));
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
// The net: a labyrinth of veins, as on a frog's inner eyelid. A sum of waves of one length
// in many directions is a field of worms once it is cut at a level; taken in space, on the
// sphere it has no seams. The directions lean one way so the worms run mostly along.
const vec3 NET_K[10] = vec3[10](
  vec3(0.94, 0.20, 0.27), vec3(0.88, -0.31, 0.36), vec3(0.97, 0.05, -0.24), vec3(0.83, 0.42, -0.36), vec3(0.90, -0.12, -0.42),
  vec3(0.79, 0.55, 0.27), vec3(0.86, -0.48, -0.17), vec3(0.99, 0.12, 0.05), vec3(0.76, 0.30, 0.57), vec3(0.81, -0.22, -0.54));
float netField(vec3 p) {
  float f = 0.0;
  for (int i = 0; i < 10; i++) f += sin(dot(p, NET_K[i]) * NET_WAVE + float(i) * 2.399);
  return f * 0.316; // about unit spread
}
/** Ink coverage of the net at p, antialiased. */
float netInk(vec3 p) {
  // a slow drift in the level makes the veins thicken and thin and break up
  float level = 0.15 + 0.35 * sin(dot(p, vec3(1.7, -2.3, 1.1))) * sin(dot(p, vec3(-1.3, 0.9, 2.1)) + 1.0);
  float f = netField(p) - level;
  return smoothstep(-0.5, 0.5, f / max(fwidth(f), 1e-4));
}
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
#ifndef ROLE_UNDER
  float netVein = uNet > 0.5 ? netInk(P) : 0.0;
#endif
#ifdef ROLE_ATTACHED
  // The film's height near its edge: its cover, blurred over a few texels, as a ramp up from
  // the rim. Its slope across the screen is taken here, while every pixel is still alive.
  float bumpH = fc;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634;
    bumpH += textureLod(uCover, fuv + vec2(cos(a), sin(a)) * FILM_BEVEL, 0.0).r;
  }
  bumpH /= 9.0;
  bumpH = FILM_BUMP * smoothstep(0.3, 1.0, bumpH);
  vec2 bumpD = vec2(dFdx(bumpH), dFdy(bumpH));
  vec3 bumpSx = dFdx(-vViewPosition), bumpSy = dFdy(-vViewPosition);
#endif
  float fcw = max(fwidth(fc), 1e-4);
  float cov = coverAA(fc, fcw);
  float shade = 1.0;
  bool backFilm = false;
#ifdef ROLE_UNDER
  shade = grooveShade(uCover, P, 1.0 - cov);
#else
  // Cells behind the peel front, and how much of this pixel is past it.
  float lw = uLiftId != 0 ? liftDepth(P) : 0.0;
  float up = coverAA(lw, max(fwidth(lw), 1e-4));
#endif
#ifdef ROLE_ATTACHED
  vec3 dPx = dFdx(vLocal);
  vec3 dPy = dFdy(vLocal);
  // How much of the film above is missing here, for the hairline of its cuts on this one.
  float ac = texture(uAbove, fuv).r;
  float aboveOpen = 1.0 - coverAA(ac, max(fwidth(ac), 1e-4));
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
#ifdef ROLE_ATTACHED
  if (uAboveOn > 0.5) shade = grooveShade(uAbove, P, aboveOpen);
#endif
`;

// Lifted film: as it leaves the sphere its own shape takes over from the radial normal.
const FRAG_NORMAL = /* glsl */ `
#ifdef ROLE_ATTACHED
  {
    // the rim bump: the normal leans down the ramp worked out before the discards
    vec3 r1 = cross(bumpSy, normal), r2 = cross(normal, bumpSx);
    float det = dot(bumpSx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (bumpD.x * r1 + bumpD.y * r2));
    nonPerturbedNormal = normal;
  }
#endif
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
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.27, 0.36), 0.7 * uGrid * mmGrid(P)); // grey-blue ink
#else
  #ifdef ROLE_LIFTED
  // Both sides of the film look the same: gathered film turns its facets every which way,
  // and a different underside would show each one.
  #endif
  // The print: ink on the film, so it travels with every piece and shows mirrored from behind.
  float ink = uNet > 0.5 ? netVein : texture2D(uPrint, printUV(P)).r * (backFilm ? 0.55 : 1.0) * uPrintOn;
  #ifdef ROLE_LIFTED
  ink = 0.0; // peeled film is plain: its own flat, see-through look, no print
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, uInk, ink * 0.9);
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
  // And only the foot of it is shown: lifted film is cut off where it rises more than
  // uLiftBand above the sphere. A clean cut at one height, not a fade: only as soft as a pixel.
  float liftHigh = length(vViewPosition + viewMatrix[3].xyz) - MR;
  float liftBand = 1.0 - smoothstep(-0.5, 0.5, (liftHigh - uLiftBand * MR) / max(fwidth(liftHigh), 1e-6));
  // And it thins out to nothing right at the finger: the whole width of the sheet is
  // gathered into the grip there, a bunch a hand would be holding and hiding.
  if (uFinger.w > 0.0) {
    vec3 fromFinger = -vViewPosition - viewMatrix[3].xyz - mat3(viewMatrix) * uFinger.xyz;
    liftBand *= smoothstep(FINGER_CLEAR * uFinger.w, uFinger.w, length(fromFinger));
  }
  // Cut away, not just drawn clear: a clear pixel would still write depth and hide the
  // film lying on the sphere behind it.
  if (liftBand <= 0.0) discard;
  liftFade = uLiftFade * uLiftGhost * liftBand;
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
    float specKeep = uLiftFade * liftBand * max(uLiftGhost, LIFT_GLOSS);
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

/** Copy a layer's finish onto a material: colour, roughness, metalness, nothing that recompiles. */
function applyLayer(mat: MeshPhysicalMaterial, layer: Layer) {
  mat.color.copy(layer.color);
  mat.roughness = layer.roughness;
  mat.metalness = layer.metalness;
}

export function createMembrane(ctx: Ctx): Module {
  const { world, scene, renderer, camera } = ctx;

  const group = new Group();
  scene.add(group);

  // FILMS_MAX slots, slot k for world.films[k]. How many are in use changes while it runs:
  // a slot follows whatever Film and Layer sit at its index, and is hidden past the end.
  const live = () => Math.min(world.films.length, FILMS_MAX);
  // An index into the live films, kept in range.
  const clampLive = (k: number) => Math.min(Math.max(k | 0, 0), Math.max(live() - 1, 0));

  // ---- the film atlases, a pair a slot, each uploaded only when the sim bumps its version.
  // A slot with no film yet has no data and is never drawn, so it is never uploaded.
  const atlases = Array.from({ length: FILMS_MAX }, (_, k) => {
    const f = world.films[k];
    const cover = new DataTexture(f ? f.cover : null, ATLAS_W, ATLAS_H, RedFormat, UnsignedByteType);
    cover.magFilter = cover.minFilter = LinearFilter;
    const id = new DataTexture(f ? f.id : null, ATLAS_W, ATLAS_H, RGFormat, UnsignedByteType);
    for (const t of [cover, id]) {
      t.generateMipmaps = false;
      t.flipY = false;
      t.unpackAlignment = 1; // 1 and 2 byte texels: rows need not be 4-byte aligned
    }
    return { cover, id, coverVersion: -1, idVersion: -1 };
  });
  const syncFilms = () => {
    for (let k = 0; k < live(); k++) {
      const f = world.films[k], a = atlases[k];
      if (a.cover.image.data !== f.cover) { a.cover.image.data = f.cover; a.coverVersion = -1; }
      if (a.id.image.data !== f.id) { a.id.image.data = f.id; a.idVersion = -1; }
      if (f.coverVersion !== a.coverVersion) { a.coverVersion = f.coverVersion; a.cover.needsUpdate = true; }
      if (f.idVersion !== a.idVersion) { a.idVersion = f.idVersion; a.id.needsUpdate = true; }
    }
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

  const fingerAt = new Vector3();
  // ---- shared uniforms (same objects in every material)
  const shared = {
    uLift: { value: liftTex },
    uLiftFade: { value: 1 },
    uGrid: { value: 1 },
    uLiftGhost: { value: 0.45 },
    uLiftBand: { value: 0.02 },
    uFinger: { value: new Vector4(0, 0, 0, 0) },
    uHoverOk: { value: 1 },
    uPrint: { value: makePrint(ctx.renderer.capabilities.getMaxAnisotropy()) },
    uEnv: { value: new Vector4(ENV_DIFFUSE, ENV_SPEC_GLOSS, ENV_SPEC_MATTE, DIRECT_SPEC_MATTE) },
  };

  // ---- per film uniforms: the same names for every film, its own objects
  const filmUniforms = (k: number) => ({
    uCover: { value: atlases[k].cover },
    uId: { value: atlases[k].id },
    uLiftId: { value: 0 },  // the pulled piece when this is the film pulled, else 0
    uHoverId: { value: 0 }, // the hovered piece when it is on this film, else 0
    uUnder: { value: new Vector4(1, 1, 1, 0.25) },
    uTop: { value: new Vector3(1, 0, 1) },
    uPrintOn: { value: 0 }, // 1 this film carries the label
    uNet: { value: 0 },
    uInk: { value: new Vector3(0.03, 0.09, 0.2) },
    uAbove: { value: atlases[k > 0 ? k - 1 : k].cover },
    uAboveOn: { value: k > 0 ? 1 : 0 },
    uAboveLift: { value: 0 },
  });
  const perFilm = Array.from({ length: FILMS_MAX }, (_, k) => filmUniforms(k));
  // The lifted draw is whichever film is pulled, the sphere's grooves are the bottom film's:
  // each has its own objects, pointed at that film each frame.
  const liftU = filmUniforms(0);
  const underU = filmUniforms(0);
  liftU.uAboveOn.value = underU.uAboveOn.value = 0;

  // Slot k sits k FILM_STEP below R: the mesh is scaled, the shaders read the unscaled position.
  // The lowest slot stays above the sphere underneath, and above the eye (0.9975 R, eye.ts).
  const filmScale = (k: number) => (R - k * FILM_STEP) / R;
  const geo = cubeSphere(DENSITY, R);
  const mk = (role: Role, g: BufferGeometry, uniforms: Record<string, { value: unknown }>, order: number) => {
    const mesh = new Mesh(g, makeMaterial(role, uniforms));
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };
  const under = mk('under', cubeSphere(UNDER_DENSITY, Math.min(UNDER_RADIUS, R - FILMS_MAX * FILM_STEP)),
    { ...shared, ...underU }, 0);
  // Bottom slot first (1), top slot last (FILMS_MAX), so each blends over the ones below.
  const attached = perFilm.map((u, k) => {
    const mesh = mk('attached', geo, { ...shared, ...u }, FILMS_MAX - k);
    mesh.scale.setScalar(filmScale(k));
    return mesh;
  });
  const lifted = mk('lifted', geo, { ...shared, ...liftU }, FILMS_MAX + 1);
  lifted.frustumCulled = false; // moved by the lift atlas, past the sphere's bounds

  // ---- layers
  const curLayers: Array<Layer | null> = perFilm.map(() => null);
  const curFilms: Array<Film | null> = perFilm.map(() => null);
  let curLifted: Layer | null = null;
  let curNext: Layer | null = null;
  const syncLayers = () => {
    for (let k = 0; k < live(); k++) {
      const layer = world.layers[k];
      // a slot that gained another film takes on its look too
      if (layer === curLayers[k] && world.films[k] === curFilms[k]) continue;
      curLayers[k] = layer;
      curFilms[k] = world.films[k];
      applyLayer(attached[k].material, layer);
      const u = perFilm[k];
      const uc = layer.under.color;
      u.uUnder.value.set(uc.r, uc.g, uc.b, layer.under.roughness);
      const op = layer.opacity;
      const translucent = op < 0.999;
      // A milky film: it simply lays its own colour over what is underneath.
      const scatter = translucent ? op : 1;
      u.uTop.value.set(op, translucent ? 1 : 0, scatter);
      // what is printed on it is the layer's choice, wherever it is in the stack
      u.uPrintOn.value = layer.print === 'label' ? 1 : 0;
      u.uNet.value = layer.print === 'net' ? 1 : 0;
      u.uInk.value.set(layer.ink.r, layer.ink.g, layer.ink.b);
    }
    const pulledLayer = world.layers[clampLive(world.lift.layer)];
    if (pulledLayer !== curLifted) {
      curLifted = pulledLayer;
      applyLayer(lifted.material, curLifted);
    }
    if (world.next !== curNext) {
      curNext = world.next;
      applyLayer(under.material, curNext);
      // A jelly sphere lets what is inside it through, blurred by its own roughness: three
      // draws the opaque things (the eye) to a texture first and this samples it.
      const m = under.material, j = curNext.jelly;
      // Not all of it: a little of its own colour keeps it a body and not a glass ball. And
      // thin, for the bending: at its real thickness the eye would swell to fill the sphere.
      m.transmission = j ? 0.58 : 0;
      m.thickness = j ? 0.45 * R : 0;
      m.ior = j ? j.ior : 1.5;
      m.attenuationDistance = j ? j.depth * R : Infinity;
      if (j) m.attenuationColor.copy(j.tint); else m.attenuationColor.set(0xffffff);
      m.needsUpdate = true;
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
      syncFilms();
      syncLift();
      if (!warmed) prewarm();
      group.quaternion.copy(world.rotation);

      const { lift, hover } = world;
      const count = live(), pk = clampLive(lift.layer), hk = clampLive(hover.layer);
      for (let k = 0; k < count; k++) {
        const u = perFilm[k];
        u.uLiftId.value = pk === k ? lift.id : 0;
        u.uHoverId.value = world.show.debug && hk === k ? hover.id : 0;
        u.uAboveLift.value = k > 0 && pk === k - 1 && lift.id !== 0 ? 1 : 0;
      }
      // The lifted draw takes on the pulled film: its atlases, its look, its height.
      const p = perFilm[pk];
      liftU.uCover.value = p.uCover.value;
      liftU.uId.value = p.uId.value;
      liftU.uUnder.value = p.uUnder.value;
      liftU.uTop.value = p.uTop.value;
      liftU.uLiftId.value = lift.id;
      lifted.scale.setScalar(filmScale(pk));
      // The sphere takes on the grooves of whichever film is at the bottom now.
      const b = perFilm[Math.max(count - 1, 0)];
      underU.uCover.value = b.uCover.value;
      underU.uId.value = b.uId.value;
      underU.uLiftId.value = b.uLiftId.value;

      shared.uHoverOk.value = hover.ok ? 1 : 0;
      shared.uLiftFade.value = lift.fade;
      shared.uGrid.value = world.show.grid ? 1 : 0;
      shared.uLiftGhost.value = lift.ghost;
      shared.uLiftBand.value = lift.band;
      // kept as it was while a let-go sheet fades out
      if (world.finger.active) {
        const f = world.finger;
        fingerAt.copy(f.at).normalize().multiplyScalar(R + f.height).applyQuaternion(world.rotation);
        shared.uFinger.value.set(fingerAt.x, fingerAt.y, fingerAt.z, Math.min(FINGER_FADE, FINGER_RISE * f.height));
      }
      lifted.visible = lift.id !== 0 && world.show.films && count > 0;
      under.visible = !world.next.eye; // the eye is the sphere then (eye.ts)
      attached.forEach((m, k) => { m.visible = world.show.films && k < count; });
    },
  };
}
