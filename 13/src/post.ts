import * as THREE from 'three';
import { phone } from './device';

// Scene → 4x MSAA HalfFloat target (alpha-to-coverage on the feathers needs the
// samples) with a depth texture → depth of field → tone map + grade → screen.
//
// DOF is a gather: per-pixel circle of confusion from real depth, a
// golden-angle spiral of taps, each tap weighted by its own CoC so a sharp
// bird doesn't smear into the background and the background doesn't bleed
// over the bird's edge. A pack pass first puts colour and 1/z in one target,
// so a tap is a single fetch. Tiles hold the biggest CoC around, so the gather
// only reaches as far (and taps as often) as something near can blur. What is
// blurry anyway is gathered at half size; near focus the grade gathers at full.

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The lens: blur circle radius (CSS px) at 1 / view distance. The motes in ambient.ts draw their discs by it too. */
export const lensGlsl = /* glsl */ `
float lensCoc(float invZ, float focus, float aperture, float maxCoc) {
  // a real lens gets shallower up close; scale that back so a macro look at
  // the eye isn't a smear (blur grows with distance from focus, not 1/f^2)
  float k = focus / 3.3;
  return min(aperture * abs(1.0 / focus - invZ) * k, maxCoc);
}
`;

// colour + 1/z (view distance) in one HalfFloat texel: the gather reads nothing else
const packFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform float uFocus;    // view-space distance in focus
uniform float uAperture; // CoC in px for 1/z difference of 1
uniform float uFarCoc;   // px for the sky sphere / cleared depth

void main() {
  float d = texture2D(tDepth, vUv).x;
  float invZ;
  if (d >= 0.99999) {
    // the sky: the 1/z, past infinity, whose blur circle is uFarCoc
    invZ = max(1.0 / uFocus - uFarCoc * 3.3 / (max(uAperture, 1e-3) * uFocus), -1e4);
  } else {
    // perspective depth → 1 / positive view distance
    float z = d * 2.0 - 1.0;
    invZ = (uFar + uNear - z * (uFar - uNear)) / (2.0 * uNear * uFar);
  }
  // NaNs go through as they are: the gather drops them
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, invZ);
}
`;

// Biggest CoC in each tile, then over the tile and its 8 neighbours: what could
// blur over a pixel, a blurry foreground next to a sharp one included.
// A tile is no smaller than the gather's reach (TILE below).
const tileFrag = /* glsl */ `
precision highp float;
uniform sampler2D tPack;
uniform int uTile; // device px
uniform float uFocus, uAperture, uMaxCoc;
${lensGlsl}
void main() {
  ivec2 last = textureSize(tPack, 0) - 1;
  ivec2 base = ivec2(gl_FragCoord.xy) * uTile;
  // the CoC grows with |1/focus - 1/z|: the tile's two ends of 1/z are enough
  float lo = 1e9, hi = -1e9;
  for (int y = 0; y < uTile; y++) {
    for (int x = 0; x < uTile; x++) {
      float invZ = texelFetch(tPack, min(base + ivec2(x, y), last), 0).a;
      lo = min(lo, invZ);
      hi = max(hi, invZ);
    }
  }
  gl_FragColor = vec4(max(lensCoc(lo, uFocus, uAperture, uMaxCoc), lensCoc(hi, uFocus, uAperture, uMaxCoc)));
}
`;
const dilateFrag = /* glsl */ `
precision highp float;
uniform sampler2D tTile;
void main() {
  ivec2 last = textureSize(tTile, 0) - 1;
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) m = max(m, texelFetch(tTile, clamp(p + ivec2(x, y), ivec2(0), last), 0).r);
  }
  gl_FragColor = vec4(m);
}
`;

// the gather itself, shared: the half size pass runs it for the blurry lot, the
// grade for the pixels near focus
const gatherGlsl = /* glsl */ `
uniform sampler2D tPack; // rgb colour, a = 1 / view distance
uniform sampler2D tTile; // biggest CoC near here
uniform int uTile;
uniform vec2 uTexel;     // dpr / size: CoC numbers are in CSS px
uniform vec2 uSpiral[TAPS]; // (cos, sin) of i * golden angle
uniform float uFocus;
uniform float uAperture;
uniform float uMaxCoc;   // px
${lensGlsl}
const int MIN_TAPS = 8;
const float FULL = 48.0; // the look was set with 48 taps: fewer each weigh more

// p0: the pack's texel at uv, c0: its CoC, seed: a pixel's own two numbers
vec3 gather(vec2 uv, vec4 p0, float c0, vec2 seed) {
  vec3 acc = p0.rgb;
  if (any(isnan(acc)) || any(isinf(acc))) acc = vec3(0.0);
  float wsum = 1.0;
  // the full reach: big enough to catch blurry foreground spilling over a sharp pixel
  float R0 = max(c0, uMaxCoc * 0.5);
  // nothing near blurs further than the tile says (+1: the weight's soft edge),
  // so look no further, with as many taps as keeps them as dense as on the full
  // disc. Even in focus a few stay: the full disc's innermost taps soften the
  // picture a little, and it should look the same.
  float R = min(R0, texelFetch(tTile, ivec2(uv * vec2(textureSize(tPack, 0))) / uTile, 0).r + 1.0);
  float area = (R * R) / (R0 * R0);
  int taps = clamp(int(ceil(float(TAPS) * area)), MIN_TAPS, TAPS);
  float dense = FULL * area / float(taps);
  // rotate the spiral per pixel so a hot speck blurs to a soft disc, not a ring of dots
  float rot = fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  mat2 spin = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  float jr = fract(sin(dot(seed, vec2(39.3468, 11.135))) * 24634.6345);
  for (int i = 1; i < taps; i++) {
    float fi = float(i);
    float r = sqrt((fi - jr) / float(taps)) * R;
    vec4 p = texture2D(tPack, uv + spin * uSpiral[i] * r * uTexel);
    float ci = lensCoc(p.a, uFocus, uAperture, uMaxCoc);
    // a tap behind us can't blur over us further than our own blur
    if (p.a * 1.02 < p0.a) ci = min(ci, c0);
    float w = smoothstep(r - 1.0, r + 1.0, ci) * dense;
    vec3 s = p.rgb;
    // one NaN pixel would smear into a dotted disc: drop it
    if (any(isnan(s)) || any(isinf(s))) continue;
    s = min(s, vec3(32.0));
    // out-of-focus highlights bloom into discs a little
    w *= 1.0 + 0.25 * smoothstep(0.6, 1.6, dot(s, vec3(0.333)));
    acc += s * w;
    wsum += w;
  }
  return acc / wsum;
}
`;

// Half size, a quarter of the work: each texel is the blur of one real pixel
// (not of four averaged: its CoC has to be a true one), with that CoC in alpha
// for the grade to pick its neighbours by.
const dofFrag = /* glsl */ `
precision highp float;
${gatherGlsl}
void main() {
  vec2 size = vec2(textureSize(tPack, 0));
  vec2 uv = (min(floor(gl_FragCoord.xy) * 2.0 + 1.0, size - 1.0) + 0.5) / size;
  vec4 p0 = texture2D(tPack, uv);
  float c0 = lensCoc(p0.a, uFocus, uAperture, uMaxCoc);
  gl_FragColor = vec4(gather(uv, p0, c0, gl_FragCoord.xy), c0);
}
`;

// Ink spreading into the paper: a separable blur of the scene (linear, clamped), run
// twice at two sizes. The grade reads both.
const inkBlurFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir; // one step, in uv
void main() {
  vec3 s = vec3(0.0);
  float w = 0.0;
  for (int i = -4; i <= 4; i++) {
    float f = float(i);
    float g = exp(-f * f / 8.0);
    vec3 x = texture2D(tSrc, vUv + uDir * f).rgb;
    if (any(isnan(x)) || any(isinf(x))) x = vec3(0.0);
    s += min(x, vec3(4.0)) * g;
    w += g;
  }
  gl_FragColor = vec4(s / w, 1.0);
}
`;

const gradeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDof;  // half size: blurred colour, a = the CoC it was blurred by
uniform float uDof;      // 0 with the lens shut
${gatherGlsl}
uniform float uExposure;
uniform vec3 uWhite;     // white balance multiplier (linear)
uniform vec3 uLift;      // display space
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
uniform sampler2D tWire;  // the loading drawing: ink where alpha
uniform float uReveal;   // 0 = the drawing on millimetre paper, 1 = the picture
uniform float uDpr;
uniform float uInk;      // 1 = the picture as an ink wash on paper

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 + vnoise(p * 4.1 + 3.3) * 0.125 + vnoise(p * 8.3 + 1.7) * 0.0625; }
float lumOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
uniform sampler2D tInkS; // the scene, spread a little: ink soaked a few px into the paper
uniform sampler2D tInkL; // and spread wide: how much ink is about
uniform sampler2D tInkDepth; // the scene's depth: 1 where there is only paper
uniform mat4 uInvVP;     // clip space to world
uniform vec3 uCam;
uniform vec3 uFwd;
float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n31(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return n31(p) * 0.5 + n31(p * 2.03 + 7.1) * 0.25 + n31(p * 4.1 + 3.3) * 0.125 + n31(p * 8.3 + 1.7) * 0.0625; }
// Where in the world this pixel's ink sits: on the nearest form around it, or, out on the
// bare paper, on the plane through the bird. The brushwork is looked up there, so it
// stays on the forms when the view turns instead of sliding over them like a projection.
vec3 inkPlace(vec2 px) {
  float z = texture2D(tInkDepth, vUv).x;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472;
    z = min(z, texture2D(tInkDepth, vUv + vec2(cos(a), sin(a)) * px * (i % 2 == 0 ? 4.0 : 9.0)).x);
  }
  vec4 far = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCam);
  if (z >= 0.99999) return uCam + dir * (uFocus / max(dot(dir, uFwd), 0.1));
  vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  return w.xyz / w.w;
}
vec3 disp(vec3 x) {
  x = toneMapping(x * uExposure);
  return clamp(linearToOutputTexel(vec4(x, 1.0)).rgb, 0.0, 1.0);
}
// one sharp sample of the scene, in display space
vec3 shot(vec2 uv) {
  vec3 x = texture2D(tColor, uv).rgb;
  if (any(isnan(x)) || any(isinf(x))) x = vec3(0.0);
  return disp(x);
}
// how much ink a brush would have left for this colour: none for white, all of it for black
float dens(vec3 c) { return 1.0 - smoothstep(0.05, 0.9, lumOf(c)); }

// Ink on absorbent paper. The rendered picture says where the brush went and how loaded
// it was; what shows is what the paper did with it.
//  - The shape is not the rendered outline: it is the soaked-in density (tInkS) cut off by
//    how thirsty the paper is at each spot, so every edge is feathered along the fibres.
//  - Inside, the tone falls into a few inks, water pools and runs back, and pigment
//    settles toward the wet edge.
//  - Past the edge thin ink creeps on for a way (tInkL): the bleed.
//  - Colour is pigment in the same water. Everything is laid on the paper as
//    absorption, so a thin wash lets the paper through and a dense one goes black.
vec3 inkWash() {
  vec2 pp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr; // CSS px
  vec2 px = uDpr / uRes;                                          // one CSS px, in uv
  // the paper: clouded sizing, long fibres both ways, a fine tooth
  float cloud = fbm2(pp * 0.009);
  float fibA = fbm2(pp * vec2(0.5, 0.11) + 4.0 * fbm2(pp * 0.02));
  float fibB = fbm2(pp.yx * vec2(0.42, 0.1) + 9.0);
  float tooth = fbm2(pp * 0.75 + 40.0);
  float thirst = 0.55 * fibA + 0.45 * fibB;
  vec3 paper = vec3(0.960, 0.930, 0.852) * (0.955 + 0.06 * cloud + 0.035 * (thirst - 0.5));
  // the brush's own unevenness, on the forms: how wet it was, where it ran dry
  vec3 wp = inkPlace(px);
  float water = fbm3(wp * 2.3 + 3.0);
  float ragged = fbm3(wp * 13.0 + 11.0);
  float dryN = fbm3(wp * vec3(34.0, 34.0, 34.0) + 40.0);
  thirst = mix(thirst, ragged, 0.75);
  // ink creeps a little way from where it was laid
  vec2 creep = vec2(fbm3(wp * 5.5 + 2.0), fbm3(wp * 5.5 + 31.0)) - 0.5;
  vec2 uvS = vUv + creep * 5.0 * px;
  vec2 uvL = vUv + creep * 18.0 * px;
  vec3 cS = shot(vUv + creep * 1.5 * px);
  vec3 cM = disp(texture2D(tInkS, uvS).rgb);
  vec3 cL = disp(texture2D(tInkL, uvL).rgb);
  float dS = dens(cS);
  float dM = dens(cM);
  float dL = dens(cL);
  // the wet shape, its edge broken by the paper
  float n = (thirst - 0.5) * 0.5 + (tooth - 0.5) * 0.08;
  float wet = smoothstep(0.1, 0.28, dM + n * (1.0 - dM));
  // (what was drawn sharp and dark stays: a hair-thin twig is not washed away)
  wet = max(wet, smoothstep(0.25, 0.55, dS));
  // tone: the drawing softened, then drawn toward five inks
  // (off the drawn form there is only what soaked out: no gap between the stroke and its bleed)
  float body = mix(dM, dS, 0.6) + 0.4 * dM * (1.0 - dS);
  // a pale form is modelled in thin ink: what is white turns away from the light in a
  // grey wash, long before it is dark enough to count as ink in the drawing
  float onForm = step(texture2D(tInkDepth, vUv).x, 0.99999);
  float turn = 1.0 - smoothstep(0.42, 0.9, lumOf(mix(cM, cL, 0.35)));
  body = max(body, onForm * 0.42 * turn * (1.0 - smoothstep(0.25, 0.6, dM)));
  float q = body * 4.0;
  body = mix(body, (floor(q) + smoothstep(0.2, 0.8, fract(q))) / 4.0, 0.55);
  // water: pools and back-runs
  body *= mix(0.7, 1.12, smoothstep(0.24, 0.66, water));
  // pigment carried to the edge of the wet patch
  body += 0.3 * clamp(dM - dL, 0.0, 1.0) * smoothstep(0.2, 0.6, dM);
  float d = body * wet;
  float soak = 0.95 * dL * dL * (0.25 + 3.0 * thirst * thirst);
  // the bleed: thin ink beyond the shape, thinner the further, more where the paper drinks
  d = max(d, soak * (1.0 - 0.6 * wet));
  // a dry brush skips on the tooth
  d *= 1.0 - 0.25 * smoothstep(0.5, 0.72, dryN) * smoothstep(0.1, 0.4, d) * (1.0 - smoothstep(0.6, 0.85, d));
  // pale forms (the white of the bird) are held by a thin broken line of pale ink along
  // their outline: where a form meets bare paper, found in the depth
  float z0 = texture2D(tInkDepth, vUv + creep * 1.5 * px).x;
  float zn = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.6;
    zn = max(zn, texture2D(tInkDepth, vUv + creep * 1.5 * px + vec2(cos(a), sin(a)) * px * 2.2).x);
  }
  float outline = step(z0, 0.99999) * step(0.99999, zn);
  float broken = smoothstep(0.3, 0.55, fbm3(wp * 6.0 + 70.0));
  d = max(d, outline * (1.0 - smoothstep(0.12, 0.4, dS)) * (1.0 - smoothstep(0.03, 0.1, dL)) * mix(0.2, 0.5, broken));
  d = clamp(d, 0.0, 1.0);
  // What the ink is made of is read off the picture as absorption: black takes all the
  // light, rouge takes the green and blue and leaves the red. Past the edge of a shape the
  // bleed keeps the colour of what bled (the wide spread), so red runs red.
  vec3 cc = mix(cL, mix(cM, cS, 0.5), wet);
  vec3 a3 = max(1.0 - cc, 0.0);
  vec3 absorb = pow(a3 / max(max(a3.r, max(a3.g, a3.b)), 1e-3), vec3(1.6));
  // (a hair warm, as ink on this paper is)
  absorb *= vec3(1.0, 0.985, 0.955);
  float red = smoothstep(0.1, 0.45, 1.0 - absorb.r);
  // dense ink is charcoal, not a hole in the paper; rouge stays luminous
  float od = 2.7 * pow(d, 1.3) * mix(1.0, 1.35, red);
  // granulation in the thin washes
  od *= 1.0 + (tooth - 0.5) * 0.3 * (1.0 - d);
  return paper * exp(-absorb * od);
}

// Half size blur is fine where the picture is blurry anyway. Near focus (the
// bird, its feathers) the gather runs here, at full size, as it always did.
const float NEAR = 2.0; // CoC px: below, all full size
const float FAR = 4.0;  // above, all half size
vec3 lens() {
  vec4 p0 = texture2D(tPack, vUv);
  float c0 = lensCoc(p0.a, uFocus, uAperture, uMaxCoc);
  vec3 sharp = vec3(0.0);
  if (c0 < FAR) {
    sharp = gather(vUv, p0, c0, gl_FragCoord.xy);
    if (c0 <= NEAR) return sharp;
  }
  // the four half size texels around, each by how close its sharpness is to
  // ours: a blurry background doesn't take the bird's crisp edge in
  ivec2 last = textureSize(tDof, 0) - 1;
  vec2 q = gl_FragCoord.xy * 0.5 - 0.75; // a texel stands for the odd pixel of its four
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 soft = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec4 t = texelFetch(tDof, clamp(i + o, ivec2(0), last), 0);
    float d = min(t.a, FAR) - min(c0, FAR); // past FAR blurry is blurry: plain bilinear
    vec2 b = mix(1.0 - f, f, vec2(o));
    soft += vec4(t.rgb, 1.0) * (b.x * b.y + 0.01) / (0.25 + d * d);
  }
  return mix(sharp, soft.rgb / soft.a, smoothstep(NEAR, FAR, c0));
}

void main() {
  vec3 c;
  if (uDof > 0.0) {
    c = lens();
  } else {
    c = texture2D(tColor, vUv).rgb;
    // the gather drops NaNs; with the lens shut this is the first to see them
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  }
  c *= uExposure * uWhite;
  c = toneMapping(c);
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  // lift / gamma / gain in display space
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  // soft contrast around mid grey
  c = mix(vec3(0.5), c, uContrast);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  // grain, luminance-weighted, a touch stronger in the mids
  float g = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
  c += g * uGrain * (0.4 + 0.6 * (1.0 - abs(l - 0.5) * 2.0));
  c = clamp(c, 0.0, 1.0);
  if (uInk > 0.5) c = inkWash();
  if (uReveal < 1.0) {
    // millimetre paper, in CSS px from the top left so it lines up with the page's own
    vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
    float line = 0.0;
    vec3 lines = vec3(1.0 / 5.0, 1.0 / 25.0, 1.0 / 50.0);
    vec3 alpha = vec3(0.12, 0.22, 0.35);
    for (int i = 0; i < 3; i++) {
      vec2 f = fract(px * lines[i]);
      float on = max(step(f.x, lines[i] * 1.0), step(f.y, lines[i] * 1.0));
      line = max(line, on * alpha[i]);
    }
    vec3 paper = mix(vec3(0.945, 0.941, 0.910), vec3(0.435, 0.561, 0.416), line);
    float ink = texture2D(tWire, vUv).a;
    paper = mix(paper, vec3(0.17, 0.23, 0.17), ink * 0.85);
    c = mix(paper, c, uReveal);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const TILE = 8;
// a phone's pixels are small and its GPU smaller: half the taps, a little more noise
const TAPS = phone ? 24 : 48;

export interface Post {
  /** wire: while loading, draws the drawing (into its own target); null once revealing */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, t: number, wire?: (() => void) | null): void;
  setSize(w: number, h: number, dpr: number): void;
  /** world-space point to keep in focus */
  focusOn(p: THREE.Vector3): void;
  dof: Record<string, THREE.IUniform>;
  grade: Record<string, THREE.IUniform>;
  /** swap the tone mapping curve (the grade pass calls it itself) */
  setToneMapping(t: THREE.ToneMapping): void;
  /** the drawing is off screen: free its target (it comes back on the next drawing frame) */
  endDrawing(): void;
  /**
   * Compile what the picture will draw, while the drawing still shows: `jobs` runs with the
   * scene target bound (its compileAsync calls get the programs that pass uses), then the lens.
   * Resolves once they are all ready.
   */
  compile(jobs: () => Promise<unknown>[]): Promise<unknown>;
  /** draw the picture once into its targets, unseen: whatever compile can't reach (the shadow pass) is done then */
  prerender(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
}

export function createPost(renderer: THREE.WebGLRenderer, opts: { samples: number }): Post {
  const depth = new THREE.DepthTexture(1, 1);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: opts.samples,
    depthTexture: depth,
    depthBuffer: true,
  });
  sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const packRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const tileOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const tileRT = new THREE.WebGLRenderTarget(1, 1, tileOpts);
  const tileMaxRT = new THREE.WebGLRenderTarget(1, 1, tileOpts);
  const dofRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const wireRT = new THREE.WebGLRenderTarget(1, 1, { samples: opts.samples });
  // ink spread: two half size targets for the near soak, two quarter size for the wide bleed
  const inkOpts = { type: THREE.HalfFloatType, depthBuffer: false };
  const inkA = new THREE.WebGLRenderTarget(1, 1, inkOpts);
  const inkB = new THREE.WebGLRenderTarget(1, 1, inkOpts);
  const inkC = new THREE.WebGLRenderTarget(1, 1, inkOpts);
  const inkD = new THREE.WebGLRenderTarget(1, 1, inkOpts);
  const clearCol = new THREE.Color();

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // one lens for every pass (and the motes, through `dof`)
  const lens = { uFocus: { value: 3.3 }, uAperture: { value: 85 }, uMaxCoc: { value: 14 } };
  const packMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: packFrag,
    uniforms: {
      tColor: { value: sceneRT.texture },
      tDepth: { value: depth },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uFarCoc: { value: 6 },
      uFocus: lens.uFocus,
      uAperture: lens.uAperture,
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const uTile = { value: 16 };
  const tileMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: tileFrag,
    uniforms: { tPack: { value: packRT.texture }, uTile, ...lens },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const dilateMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: dilateFrag,
    uniforms: { tTile: { value: tileRT.texture } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gather = {
    tPack: { value: packRT.texture },
    tTile: { value: tileMaxRT.texture },
    uTile,
    uTexel: { value: new THREE.Vector2() },
    uSpiral: { value: Array.from({ length: TAPS }, (_, i) => new THREE.Vector2(Math.cos(i * 2.39996323), Math.sin(i * 2.39996323))) },
    ...lens,
  };
  const dofMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: dofFrag,
    uniforms: gather,
    defines: { TAPS },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const inkMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: inkBlurFrag,
    uniforms: { tSrc: { value: sceneRT.texture as THREE.Texture }, uDir: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const gradeMat = new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: gradeFrag,
    uniforms: {
      tColor: { value: sceneRT.texture },
      tDof: { value: dofRT.texture },
      uDof: { value: 1 },
      ...gather,
      uExposure: { value: 1.0 },
      uWhite: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 },
      uContrast: { value: 1 },
      uVignette: { value: 0.2 },
      uGrain: { value: 0.025 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      tWire: { value: wireRT.texture as THREE.Texture | null },
      uReveal: { value: 1 },
      uDpr: { value: 1 },
      uInk: { value: 1 },
      tInkS: { value: inkB.texture },
      tInkL: { value: inkD.texture },
      tInkDepth: { value: depth },
      uInvVP: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uFwd: { value: new THREE.Vector3() },
    },
    depthTest: false,
    depthWrite: false,
    defines: { TAPS },
    // keep toneMapped so three defines toneMapping() for the screen pass; the
    // shader calls it itself, before the grade
    toneMapped: true,
  });

  const dofPasses: [THREE.Material, THREE.WebGLRenderTarget][] = [
    [packMat, packRT],
    [tileMat, tileRT],
    [dilateMat, tileMaxRT],
    [dofMat, dofRT],
  ];
  // the scene, then the lens, each into its target
  function drawPicture(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    if (gradeMat.uniforms.uInk.value > 0.5) {
      // (steps in texels of the target being read: ~1.5 half size texels, then ~2 quarter size ones)
      const steps: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, number, number][] = [
        [sceneRT, inkA, 3 / sceneRT.width, 0],
        [inkA, inkB, 0, 1.5 / inkA.height],
        [inkB, inkC, 2.2 / inkC.width, 0],
        [inkC, inkD, 0, 2.2 / inkC.height],
      ];
      quad.material = inkMat;
      for (const [src, dst, dx, dy] of steps) {
        inkMat.uniforms.tSrc.value = src.texture;
        inkMat.uniforms.uDir.value.set(dx, dy);
        renderer.setRenderTarget(dst);
        renderer.render(fsScene, fsCam);
      }
    }
    // lens wide shut: nothing to blur, the grade reads the scene as it is
    gradeMat.uniforms.uDof.value = lens.uAperture.value > 0 ? 1 : 0;
    if (!gradeMat.uniforms.uDof.value) return;
    for (const [mat, rt] of dofPasses) {
      quad.material = mat;
      renderer.setRenderTarget(rt);
      renderer.render(fsScene, fsCam);
    }
  }

  const focusWorld = new THREE.Vector3(0, 0.9, 0);
  const tmp = new THREE.Vector3();
  let focusDist = 3.3;

  return {
    dof: dofMat.uniforms,
    grade: gradeMat.uniforms,
    endDrawing() {
      wireRT.dispose();
      gradeMat.uniforms.tWire.value = null;
    },
    compile(jobs) {
      const prev = renderer.getRenderTarget();
      // into a float target three compiles linear, untone-mapped programs: compiled against the
      // screen they would be the wrong ones, and the picture would compile its own on its first frame.
      // (binding the targets also allocates them, so that isn't left to the first frame either)
      renderer.setRenderTarget(sceneRT);
      const all = jobs();
      for (const [mat, rt] of dofPasses) {
        renderer.setRenderTarget(rt);
        quad.material = mat;
        all.push(renderer.compileAsync(quad, fsCam, fsScene));
      }
      quad.material = gradeMat;
      renderer.setRenderTarget(prev);
      return Promise.all(all);
    },
    prerender(scene, camera) {
      const prev = renderer.getRenderTarget();
      drawPicture(scene, camera);
      quad.material = gradeMat;
      renderer.setRenderTarget(prev);
    },
    setToneMapping(t) {
      renderer.toneMapping = t;
      gradeMat.needsUpdate = true;
    },
    focusOn(p) {
      focusWorld.copy(p);
    },
    setSize(w, h, d) {
      const W = Math.floor(w * d);
      const H = Math.floor(h * d);
      sceneRT.setSize(W, H);
      packRT.setSize(W, H);
      // TILE css px a side: no less than the gather's reach past a sharp pixel (uMaxCoc / 2, + 1)
      uTile.value = Math.ceil(TILE * d);
      tileRT.setSize(Math.ceil(W / uTile.value), Math.ceil(H / uTile.value));
      tileMaxRT.setSize(tileRT.width, tileRT.height);
      dofRT.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      wireRT.setSize(W, H);
      inkA.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
      inkB.setSize(inkA.width, inkA.height);
      inkC.setSize(Math.ceil(W / 4), Math.ceil(H / 4));
      inkD.setSize(inkC.width, inkC.height);
      gradeMat.uniforms.uDpr.value = d;
      gather.uTexel.value.set(d / W, d / H);
      gradeMat.uniforms.uRes.value.set(W, H);
    },
    render(scene, camera, t, wire) {
      if (wire) {
        gradeMat.uniforms.tWire.value = wireRT.texture;
        renderer.getClearColor(clearCol);
        const a = renderer.getClearAlpha();
        renderer.setRenderTarget(wireRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        wire();
        renderer.setClearColor(clearCol, a);
      }
      // focus distance along the view axis, eased so saccades don't pump the focus
      tmp.copy(focusWorld).applyMatrix4(camera.matrixWorldInverse);
      focusDist += (-tmp.z - focusDist) * 0.15;
      lens.uFocus.value = Math.max(focusDist, 0.1);
      packMat.uniforms.uNear.value = camera.near;
      packMat.uniforms.uFar.value = camera.far;
      gradeMat.uniforms.uTime.value = t;
      gradeMat.uniforms.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      gradeMat.uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      camera.getWorldDirection(gradeMat.uniforms.uFwd.value);

      gradeMat.uniforms.uDof.value = 0;
      // nothing of the picture shows yet: skip it (the drawing is all there is)
      if (gradeMat.uniforms.uReveal.value > 0) drawPicture(scene, camera);
      quad.material = gradeMat;
      renderer.setRenderTarget(null);
      renderer.render(fsScene, fsCam);
    },
  };
}
