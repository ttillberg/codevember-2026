export const shellVertex = /* glsl */ `
attribute float moss;
attribute vec4 speciesW;
attribute float speciesW2; // fifth species weight: green reindeer moss (coral)
attribute vec4 fields; // dead, pillow, dome (cushion clumps), cavity (baked occlusion), packed: attribute slots run out
attribute vec3 mossNormal; // smoothed normal: the moss grows along this, the rock is lit with its own
const float puff = 0.0; // day 05's brushing spring; nothing brushes here
attribute vec3 surf; // x = material (0 soil, 1 bark, 2 stone), yz = a surface coordinate for its texture
varying vec3 vSurf;

uniform float uHeight;
uniform float uBulge;
uniform float uScale;

varying vec3 vLean; // strand lean and the lump field: low frequency, so worked out per vertex, not per fragment
varying float vLump;
float vHash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(vHash31(i), vHash31(i + vec3(1,0,0)), f.x), mix(vHash31(i + vec3(0,1,0)), vHash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(vHash31(i + vec3(0,0,1)), vHash31(i + vec3(1,0,1)), f.x), mix(vHash31(i + vec3(0,1,1)), vHash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

varying float vShell;
varying float vMoss;
varying vec4 vSpecies;
varying float vSpecies2;
varying float vDead;
varying float vPillow;
varying float vDome;
varying float vCavity;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjNormal;
varying vec3 vMossNormal;

void main() {
  float dead = fields.x, pillow = fields.y, dome = fields.z, cavity = fields.w;
  float t = float(gl_InstanceID) / float(SHELLS - 1);
  // mound up where the moss is mature: real geometry, so the light makes real shadows between pillows
  float wsum = max(speciesW.x + speciesW.y + speciesW.z + speciesW.w + speciesW2, 1e-4);
  vec4 w = speciesW / wsum;
  float w5 = speciesW2 / wsum;
  // cushion (Leucobryum): a round dome, steep shoulder and flat crown, gentle mounds; smooth, no emboss
  float cush = w.w;
  float profile = mix(moss * moss, 1.0 - (1.0 - moss) * (1.0 - moss), cush);
  float pil = mix(pillow, mix(0.9, 1.0, pillow), cush);
  float bulge = profile * mix(0.3, 1.0, pil) * uBulge * (dot(w, vec4(1.0, 0.6, 0.5, 1.7)) + w5 * 0.9);
  bulge *= mix(1.0, mix(0.5, 1.0, dome), cush); // separate round clumps, low crevices between them
  bulge += puff * uBulge * 1.4 * smoothstep(0.0, 0.3, moss);
  // hollows stay hollow: thin, short moss in holes and inner corners so they do not fill up
  bulge *= 1.0 - 0.85 * cavity;
  vec3 p = position + mossNormal * (bulge + uHeight * t * (1.0 - 0.6 * cavity));


  vShell = t;
  vSurf = surf;
  vMoss = moss;
  vSpecies = w;
  vSpecies2 = w5;
  vDead = dead;
  vPillow = pillow;
  vDome = dome;
  vCavity = cavity;
  vLocal = position;
  vLocalNormal = mossNormal;
  vec3 lq = position * 60.0 / uScale;
  vec3 lean = (vec3(vNoise3(lq), vNoise3(lq + 17.0), vNoise3(lq + 31.0)) - 0.5) * 2.0;
  vLean = lean - mossNormal * dot(lean, mossNormal);
  vLump = vNoise3(position * 9.0 + 5.0) * 0.5 + 0.5;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vObjNormal = normal;
  vMossNormal = normalize(mat3(modelMatrix) * mossNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Shared by the shell and the frond fragment shaders, so the fuzz and the fronds are lit the same way.
export const mossLighting = /* glsl */ `
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
// the shadow map's pass wants only the depth: each material stops here, after its discards (its holes still holes)
uniform float uDepthOnly;
#define DEPTH_ONLY if (uDepthOnly > 0.5) { gl_FragColor = vec4(1.0); return; }
uniform float uCavityAO; // 1 = moss sits darker in holes and inner corners, 0 = AO disabled
uniform float uShadowFloor; // how dark a fully shadowed spot gets
uniform float uTime;
uniform vec3 uLightDirC; // the sun, for the canopy projection
uniform sampler2D uCanopyMap; // the crowns' shade from above (foliage.ts): 1 open, 0 under thick boughs
uniform vec3 uCanopyBox; // its corner x, z and its size
uniform float uCanopyAmt; // how much the map counts: 0 the noise alone (the look panel's crown shade)

// ---- canopy: the sun comes through leaves, so the light on the floor is a field of soft spots, projected
// along the light and swaying slowly
float cHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), f.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), f.x), f.y);
}
float canopyAt(vec3 wp) {
  vec3 L = normalize(uLightDirC);
  vec3 a = normalize(cross(L, vec3(0.0, 0.0, 1.0)));
  vec3 b = cross(L, a);
  vec2 q = vec2(dot(wp, a), dot(wp, b));
  vec2 sway = vec2(sin(uTime * 0.35), cos(uTime * 0.27)) * 0.04;
  // big pools of light, broken up by leaves into smaller spots
  float big = cNoise(q * 0.9 + 3.0);
  float n = cNoise(q * 3.2 + sway) * 0.5 + cNoise(q * 7.5 - sway * 1.7 + 9.0) * 0.32 + cNoise(q * 19.0 + sway * 3.0 + 4.0) * 0.18;
  // the crowns' own shade, where they are: under a spruce dark, under a pine's clumps patchy, in the open lit
  // (the noise alone put shade and sun anywhere, not under the trees)
  // (the map is drawn for the floor, its heights squeezed as foliage.ts does: a point up in the air the same)
  vec2 g = (wp.xz - (10.0 + (wp.y - 10.0) * 0.3) * L.xz / max(L.y, 0.05) - uCanopyBox.xy) / uCanopyBox.z;
  float open = (g.x > 0.0 && g.y > 0.0 && g.x < 1.0 && g.y < 1.0) ? texture2D(uCanopyMap, g).r : 0.55;
  // far off, toward the sun, the crowns that would shade it are past the ones placed: neither lit nor shaded there
  open = mix(open, 0.55, smoothstep(14.0, 26.0, length(g - 0.5) * uCanopyBox.z));
  // (more of it lets the sun through than at first: looking away from the sun the floor was nearly all in shade)
  // (a nudge, not a lid: weighed in fully, under a crown all was shade and in a gap all sun, each patch metres
  // across, bigger than the floor a worm's eye sees, so no patches showed at all; this way the flecks of sun
  // stay everywhere, fewer and smaller under the crowns, more in the gaps)
  return smoothstep(0.45, 0.58, n + (big - 0.5) * mix(0.45, 0.25, min(uCanopyAmt, 1.0)) + (open - 0.55) * 0.35 * uCanopyAmt);
}

// A cheat for looking away from the sun: things turned to it catch a warm glow, not their own (very dark) colour
// lit, and even in the long shadows a few flecks get through the fern lace. 'withSun' is 1 with the sun at your
// back, 0 looking into it, where the glow through things and the rims carry the light instead.
// the backlit rim is sun through the leaves: in the crowns' shade it is gone too (unshadowed, looking toward the sun
// the moss glowed alike in sun and shade, and the patches on the floor did not show). shadow as shadowAt gives it
// how much sun reaches here, 0..1, from what shadowAt gives (uShadowFloor..1)
float sunIn(float shadow) { return clamp((shadow - uShadowFloor) / max(1.0 - uShadowFloor, 1e-3), 0.0, 1.0); }
float rimShade(float shadow) { return mix(0.3, 1.0, sunIn(shadow)); }
float withSun(vec3 V, vec3 L) { return smoothstep(-0.1, 0.8, dot(normalize(V.xz + 1e-5), normalize(L.xz + 1e-5))); }
float sunCatch(vec3 wp, float shadow) {
  vec3 L = normalize(uLightDirC);
  vec3 a = normalize(cross(L, vec3(0.0, 0.0, 1.0)));
  vec3 b = cross(L, a);
  vec2 q = vec2(dot(wp, a), dot(wp, b));
  float fleck = smoothstep(0.5, 0.66, cNoise(q * 9.0 + 5.0) * 0.6 + cNoise(q * 23.0 + 1.0) * 0.4);
  float lit = clamp((shadow - uShadowFloor) / max(1.0 - uShadowFloor, 1e-3), 0.0, 1.0);
  return max(lit, fleck * 0.75);
}
const vec3 SUN_GLOW = vec3(1.4, 0.98, 0.3); // the gold a low sun leaves on whatever faces it

// soft shadow from a depth map rendered from the light: 16 Poisson taps. 1 = lit, 0.45 = fully shadowed.
float shadowAt(vec3 worldPos, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  float canopy = canopyAt(worldPos);
  if (canopy <= 0.0) return uShadowFloor;
  vec4 sc = uShadowMatrix * vec4(worldPos + n * 0.03, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return mix(uShadowFloor, 1.0, canopy);
  // wide, soft penumbra: taps spread over ~5 texels of the 2048 map
  float texel = 5.0 / 2048.0;
  vec2 taps[16];
  taps[0] = vec2(-0.94, 0.0); taps[1] = vec2(0.94, -0.4); taps[2] = vec2(-0.09, -0.93); taps[3] = vec2(0.34, 0.29);
  taps[4] = vec2(-0.91, 0.46); taps[5] = vec2(-0.82, -0.59); taps[6] = vec2(-0.38, 0.28); taps[7] = vec2(0.97, 0.19);
  taps[8] = vec2(0.44, -0.97); taps[9] = vec2(0.54, 0.77); taps[10] = vec2(-0.26, -0.42); taps[11] = vec2(-0.49, 0.9);
  taps[12] = vec2(0.14, 0.69); taps[13] = vec2(0.73, -0.19); taps[14] = vec2(-0.6, -0.12); taps[15] = vec2(0.1, -0.33);
  float lit = 0.0;
  // 8 taps: half the cost of day 05's 16, the canopy noise on top hides the difference
  for (int i = 0; i < 8; i++) {
    float d = texture2D(uShadowMap, p.xy + taps[i] * texel).r;
    // soft compare instead of a hard step: no jagged edge where the map is coarse
    lit += smoothstep(-0.004, 0.004, d - (p.z - 0.002));
  }
  return mix(uShadowFloor, 1.0, lit / 8.0 * canopy);
}

// coloured ambient: where the key light does not reach, the moss takes a cool sky fill from above and a
// warm, greenish bounce from below instead of flat grey
uniform float uHemi; // 0 = off (swatches, thumbnails)
vec3 skyTint(vec3 N, float shade) {
  vec3 sky = vec3(0.62, 0.66, 1.15); // dusk: the shade is lit by a cooling, violet-blue sky
  vec3 bounce = vec3(1.35, 1.0, 0.45);
  vec3 t = mix(bounce, sky, smoothstep(-0.6, 0.8, N.y));
  return mix(vec3(1.0), t, uHemi * clamp(shade, 0.0, 1.0));
}

// back light: sits behind the object as seen from the camera, so it follows the view. It only reaches the
// silhouette, where fuzz and frond tips catch it and glow against the background.
uniform vec3 uRimDir;
uniform float uRim; // 0 = off (swatches, thumbnails)
vec3 rimLight(vec3 N, vec3 V) {
  if (uRim <= 0.0) return vec3(0.0);
  vec3 R = normalize(uRimDir);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0); // tight: just the outline
  float facing = smoothstep(-0.1, 0.7, dot(N, R));
  float against = smoothstep(-0.2, 0.8, dot(-V, R)); // strongest looking into the sun
  return vec3(1.0, 0.68, 0.30) * fres * facing * against * uRim; // the golden edge of everything against a low sun
}

// tone mapping, on the moss only: the white rock, the ground and the page background stay exactly as they are.
// 0 = none (just the grade), 1 = AgX, 2 = ACES, 3 = Neutral; switchable in the debug panel
#include <tonemapping_pars_fragment>
uniform float uTone;
uniform float uExposure;
vec3 tonemap(vec3 c) {
  if (uTone < 0.5) return c;
  c *= uExposure;
  if (uTone < 1.5) return AgXToneMapping(c);
  if (uTone < 2.5) return ACESFilmicToneMapping(c);
  return NeutralToneMapping(c);
}

// nothing looms right in front of the eye: thin things closer than this dissolve in a fine dither instead of
// filling the frame as big flat blurred shapes
float nearFade(vec3 worldPos, float a, float b) {
  float d = distance(cameraPosition, worldPos);
  float k = smoothstep(a, b, d);
  float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  return step(h, k);
}

// colour grade for the moss only: a touch of exposure, saturation and contrast, in linear light
vec3 grade(vec3 c) {
  c *= 1.3 * vec3(1.12, 0.93, 0.72); // the light itself is the colour of a low sun
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.12);
  c = (c - 0.18) * 1.1 + 0.18;
  return max(c, 0.0);
}
`;

export const shellFragment = /* glsl */ `
precision highp float;

uniform vec3 uLightDir;
uniform float uScale; // moss size, 0.5 .. 2

${mossLighting}

varying vec3 vSurf;
varying vec3 vLean;
varying float vLump;

varying float vShell;
varying float vMoss;
varying vec4 vSpecies;
varying float vSpecies2;
varying float vDead;
varying float vPillow;
varying float vDome;
varying float vCavity;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vObjNormal;
varying vec3 vMossNormal;

float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

// One model for every species. Per-species numbers live in these tables and are
// blended by the vertex weights, so a 50/50 mix is a real in-between, never a switch.
//                              feather  star    lichen  cushion
const vec4 kHeight   = vec4(   1.0,     0.9,    1.0,    0.7  );   // shell height factor (cushion short: velvet, not strands)
const vec4 kAgePow   = vec4(   1.0,     1.0,    1.0,    2.0  );   // height vs age curve
const vec4 kDensity  = vec4(   0.35,    0.4,    0.5,    0.14 );   // fuzz threshold at the root (higher = sparser)
const vec4 kSheen    = vec4(   0.35,    0.2,    0.15,   0.7  );   // velvet rim strength
const vec4 kBase     = vec4(   0.7,     0.8,    0.5,    1.0  );   // how much the ground takes the species shade
// the fifth species, green reindeer moss (coral): height, age curve, density, sheen, base
const float kHeight5 = 1.0, kAgePow5 = 1.0, kDensity5 = 0.42, kSheen5 = 0.2, kBase5 = 0.8;

vec3 blend4(vec3 a, vec3 b, vec3 c, vec3 d, vec4 w) { return a * w.x + b * w.y + c * w.z + d * w.w; }
vec3 blend5(vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec4 w, float w5) { return blend4(a, b, c, d, w) + e * w5; }

// anti-aliased grid lines along one axis pair, world space
float gridLine(vec2 p, float cell, float width) {
  vec2 g = abs(fract(p / cell - 0.5) - 0.5) * cell;
  vec2 fw = fwidth(p) * 1.2 + 1e-4;
  vec2 l = 1.0 - smoothstep(width - fw, width + fw, g);
  return max(l.x, l.y);
}
// triplanar: pick the two world axes across the dominant normal axis, blend across corners
float techGrid(vec3 p, vec3 n, float cell, float width) {
  vec3 a = abs(n);
  a = pow(a, vec3(6.0));
  a /= a.x + a.y + a.z;
  return gridLine(p.yz, cell, width) * a.x + gridLine(p.xz, cell, width) * a.y + gridLine(p.xy, cell, width) * a.z;
}


void main() {
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec4 w = vSpecies;
  float w5 = vSpecies2;
  float age = vMoss;

  // the mounds are real geometry now: light them with the geometric normal, softened a little
  vec3 gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 N = normalize(mix(normalize(vMossNormal), gN, 0.7)); // moss is lit along its own smooth field

  float ndv = max(dot(N, V), 0.0);
  // ---- fuzz shells decide first whether this fragment exists at all: the density test needs no light,
  // so discarded fragments never pay for the shadow taps below
  float pillow = vPillow;
  float top = 0.0, uu = 0.0;
  if (vShell >= 0.001) {
    float lump = vLump;
    float ageH = pow(age, dot(w, kAgePow) + w5 * kAgePow5);
    top = ageH * mix(mix(0.5, 0.94, w.w), 1.0, lump) * mix(mix(0.35, 0.95, w.w), 1.0, pillow) * (dot(w, kHeight) + w5 * kHeight5);
    top *= mix(1.0, mix(0.7, 1.0, vDome), w.w); // short in the crevices between cushion clumps
    // seen edge-on the stacked layers read as streaks too: short fuzz at grazing angles, the velvet base carries it
    float facing = smoothstep(0.15, 0.6, abs(dot(normalize(vMossNormal), V)));
    top *= mix(1.0, mix(0.2, 1.0, facing), w.w);
    if (vShell > top) discard;
    uu = vShell / max(top, 0.001);

    // lean the sample point as we go up so strands curve instead of standing in straight columns,
    // which at grazing angles would show the shell layers as streaks
    vec3 q = vLocal + vLean * uu * uu * 0.006;
    // cushion moss: more fine grain than the others, so it reads as dense short strands
    float fineW = mix(0.2, 0.45, w.w);
    float midW = mix(0.3, 0.4, w.w);
    // the voxel hash reads as a grid on cushion's smooth domes: there it fades to smooth noise
    // sampled in a rotated frame, so no lattice lines up with the surface
    const mat3 rot = mat3(0.80, 0.36, -0.48, -0.60, 0.48, -0.64, 0.0, 0.80, 0.60);
    float grain = mix(hash31(floor(q * 420.0 / uScale)), noise3(rot * q * 520.0 / uScale + 7.0), w.w);
    // same for the mid and coarse terms: each in its own rotated frame so no two lattices line up
    const mat3 rot2 = mat3(0.36, 0.48, 0.80, 0.80, -0.60, 0.0, 0.48, 0.64, -0.60);
    vec3 qm = mix(q, rot2 * q + 3.0, w.w);
    vec3 qc = mix(q, rot * rot2 * q + 11.0, w.w);
    float dens = noise3(qc * 140.0 / uScale) * (1.0 - fineW - midW) + noise3(qm * 380.0 / uScale) * midW + grain * fineW;
    // thin out more at grazing angles: the silhouette stays fuzzy but layers cannot line up
    float graze = 1.0 - ndv;
    if (dens < (dot(w, kDensity) + w5 * kDensity5) + 0.6 * uu + 0.35 * uu * graze) discard;
  }

  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out
  float shadow = shadowAt(vWorldPos, N);
  float sheen = pow(1.0 - ndv, 2.5) * (dot(w, kSheen) + w5 * kSheen5) * mix(0.4, 1.0, shadow);
  // directional, not wrapped: sides facing away from the light go properly dark
  float wrap = pow(max(dot(N, L) * 0.65 + 0.35, 0.0), 1.6) * shadow;
  float hemi = 0.5 + 0.5 * N.y;

  // species palettes (linear)
  vec3 deep = blend5(vec3(0.008, 0.022, 0.004), vec3(0.012, 0.05, 0.008), vec3(0.18, 0.18, 0.11), vec3(0.06, 0.15, 0.012), vec3(0.006, 0.03, 0.006), w, w5);
  vec3 lime = blend5(vec3(0.045, 0.14, 0.014),   vec3(0.035, 0.14, 0.012), vec3(0.34, 0.38, 0.24), vec3(0.24, 0.40, 0.10), vec3(0.05, 0.14, 0.03), w, w5);
  vec3 young = blend5(vec3(0.08, 0.11, 0.02),  vec3(0.13, 0.19, 0.03),   vec3(0.30, 0.30, 0.18), vec3(0.22, 0.34, 0.09), vec3(0.06, 0.13, 0.03), w, w5);
  lime = mix(young, lime, smoothstep(0.2, 0.9, age));
  vec3 deadCol = blend5(vec3(0.50, 0.38, 0.11), vec3(0.40, 0.30, 0.09), vec3(0.30, 0.24, 0.14), vec3(0.50, 0.38, 0.11), vec3(0.30, 0.26, 0.12), w, w5);
  // yellow only as a per-strand sprinkle; the area field makes patches of darker, deeper moss instead
  float deadMix = step(0.92, hash31(floor(vLocal * 260.0 / uScale) + 3.0)) * 0.8 * (1.0 - w.w) * (1.0 - 0.6 * w.y); // cushion even, star mostly even
  deep = mix(deep, vec3(0.12, 0.08, 0.02), deadMix);
  lime = mix(lime, deadCol, deadMix);
  // bright green towards the top and on upward faces, darker down the sides; the dark patch field only bites low down
  float upTop = smoothstep(-0.4, 0.9, N.y) * 0.55 + smoothstep(-0.7, 1.9, vWorldPos.y) * 0.45;
  lime = mix(lime * 0.78, lime * 1.22, upTop);
  // a slight gradient: darker towards the bottom
  float bottomDark = mix(0.72, 1.0, smoothstep(-0.75, 0.5, vWorldPos.y));
  lime *= bottomDark;
  deep *= bottomDark;
  float shade = vDead * (1.0 - 0.75 * upTop) * 0.8 * (1.0 - w.w);
  lime = mix(lime, lime * vec3(0.5, 0.6, 0.45), shade);
  deep *= mix(1.0, 0.7, shade);

  // shared fields

  if (vShell < 0.001) {
    // ---- ground: the bare forest floor, bark or stone, taking on the species' velvet shade as the moss matures
    vec3 sN = normalize(vWorldNormal);
    float diff = max(dot(sN, L), 0.0) * shadow;
    vec3 bare;
    if (vSurf.x < 0.5) {
      // soil: dark humus, broken leaf litter and needles on top
      float n1 = noise3(vLocal * 14.0), n2 = noise3(vLocal * 55.0), n3 = noise3(vLocal * 160.0);
      bare = mix(vec3(0.012, 0.008, 0.005), vec3(0.05, 0.034, 0.02), n1 * 0.5 + n2 * 0.3 + n3 * 0.2);
      float litter = smoothstep(0.62, 0.7, noise3(vLocal * vec3(11.0, 11.0, 11.0) + 3.0) * 0.7 + n3 * 0.3);
      vec3 leafCol = mix(vec3(0.07, 0.04, 0.02), vec3(0.16, 0.10, 0.045), noise3(vLocal * 5.0 + 1.0));
      bare = mix(bare, leafCol, litter);
      // needles: thin bright slivers in random directions
      vec2 nq = vLocal.xz * 70.0;
      float needle = smoothstep(0.86, 0.97, noise3(vec3(nq.x * 0.25, nq.y * 3.0, 0.0) + vec3(floor(vLocal.xz * 9.0), 0.0) * 7.0));
      bare = mix(bare, vec3(0.14, 0.085, 0.04), needle * 0.7);
    } else if (vSurf.x < 1.5) {
      // bark of an old fallen spruce: dark grey-brown scales split by deeper cracks, warped so nothing lines up
      float u = vSurf.y, a = vSurf.z;
      vec3 bq = vec3(u * 4.0, a * 10.0, 0.0);
      bq += (vec3(noise3(bq * 0.7), noise3(bq * 0.7 + 7.0), 0.0) - 0.5) * 2.5;
      float plate = noise3(bq);
      float crack = smoothstep(0.06, 0.2, abs(noise3(bq * vec3(0.6, 1.8, 1.0) + 3.0) - 0.5));
      bare = mix(vec3(0.012, 0.009, 0.007), mix(vec3(0.05, 0.038, 0.028), vec3(0.09, 0.07, 0.05), plate), crack);
      bare *= 0.7 + 0.6 * noise3(vLocal * 120.0);
      // a little green film where the moss has not taken over yet
      bare = mix(bare, vec3(0.03, 0.05, 0.015), smoothstep(0.3, 0.7, noise3(vLocal * 7.0 + 5.0)) * 0.7);
    } else {
      // granite: grey with a faint green film, a few pale crust lichens
      float n1 = noise3(vLocal * 20.0), n2 = noise3(vLocal * 120.0);
      bare = mix(vec3(0.07, 0.072, 0.065), vec3(0.19, 0.19, 0.17), n1 * 0.6 + n2 * 0.4);
      bare = mix(bare, bare * vec3(0.8, 0.95, 0.72), smoothstep(0.4, 0.7, noise3(vLocal * 6.0)) * 0.6);
      // crust lichen: irregular patches, finely broken at their edge, in some places on the stone and not others;
      // grey-green, a slightly paler rim where each grows outward, now and then a yellow-green map lichen. Low in
      // contrast: one noise at one threshold had made round pale blots like dabs of paint
      float lmask = smoothstep(0.42, 0.62, noise3(vLocal * 3.0 + 9.0));
      float lf = noise3(vLocal * 18.0 + 2.0) * 0.5 + noise3(vLocal * 60.0 + 4.0) * 0.32 + noise3(vLocal * 190.0 + 6.0) * 0.18;
      float lich = smoothstep(0.58, 0.64, lf) * lmask;
      float lrim = (smoothstep(0.58, 0.6, lf) - smoothstep(0.6, 0.64, lf)) * lmask;
      vec3 lcol = mix(vec3(0.17, 0.18, 0.15), vec3(0.24, 0.25, 0.2), noise3(vLocal * 80.0));
      lcol = mix(lcol, vec3(0.2, 0.23, 0.08), smoothstep(0.62, 0.7, noise3(vLocal * 8.0 + 13.0)));
      bare = mix(bare, lcol, lich * 0.75);
      bare += vec3(0.025, 0.026, 0.02) * lrim;
    }
    vec3 rock = bare * (0.6 * skyTint(sN, 1.0) * (0.35 + 0.25 * sN.y) * mix(1.0, 0.6, vCavity) + 2.4 * diff);
    rock = tonemap(grade(rock));
    rock *= mix(0.6, 1.0, smoothstep(0.0, 0.15, 1.0 - age)); // contact shadow right under the moss

    // the ground takes the moss colour early, so neither white rock nor the mound's slope shows through the fuzz
    float edgeNoise = noise3(vLocal * 90.0) * 0.15;
    float mature = smoothstep(0.08 + edgeNoise, 0.6, age);
    float humus = mature;
    float bump = noise3(vLocal * 70.0 / uScale) * 0.6 + noise3(vLocal * 180.0 / uScale) * 0.4; // micro height, ground only
    vec3 velvet = mix(deep, lime, (0.1 + 0.75 * bump) * wrap) + lime * sheen;
    velvet *= mix(mix(0.85, 0.96, w.w), 1.0, pillow);
    velvet *= mix(1.0, mix(0.65, 1.0, vDome), w.w); // dark crevice between cushion clumps  // valleys a touch darker, the mounds carry the shape not the colour
    velvet *= skyTint(N, 1.0 - 0.6 * wrap);
    velvet += rimLight(N, V) * lime * 2.2 * rimShade(shadow);
    // the velvet seen with the sun at your back: the same gold catch as the strands over it
    velvet += SUN_GLOW * 0.6 * withSun(V, L) * sunCatch(vWorldPos, shadow) * (0.3 + 0.7 * bump);
    vec3 ground = mix(vec3(0.03, 0.025, 0.012), velvet, (dot(w, kBase) + w5 * kBase5));
    vec3 lit = mix(rock, tonemap(grade(ground)), max(humus * 0.92, mature * (dot(w, kBase) + w5 * kBase5)));
    lit *= mix(1.0, 0.45, vCavity * mature * uCavityAO); // moss in a hollow sits in the dark
    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
    return;
  }

  // ---- fuzz: coloured strands, dense at the root and thinning upward
  vec3 col = mix(deep, lime, pow(uu, 1.2) * (0.12 + 0.88 * wrap)) + lime * sheen * uu;
  // the strands stand up, so a low sun lights their sides, not the carpet's top: where it gets through (the
  // canopy's pools, out of the shadows) the tips light up gold-green, most with the sun behind you, where the
  // lit sides face you. Without it, looking away from the sun the moss was black even in the sunlit pools.
  col += SUN_GLOW * withSun(V, L) * sunCatch(vWorldPos, shadow) * pow(uu, 1.6) * 0.9 * (1.0 - 0.6 * vCavity);
  // young sparse moss at a patch edge reads as light specks, not dirt
  col = mix(col, lime * 0.8, (1.0 - smoothstep(0.1, 0.5, age)) * 0.7);
  // (darker in the crowns' shade than it was: at 0.6 of the raw shadow, a shaded patch was barely darker than a lit one)
  col *= mix(mix(0.85, 0.96, w.w), 1.0, pillow) * (0.8 + 0.2 * hemi) * mix(0.42, 1.0, sunIn(shadow));
  col *= mix(1.0, mix(0.75, 1.0, vDome), w.w);
  // cushion hair has pale yellow-green tips
  col = mix(col, vec3(0.42, 0.52, 0.30), smoothstep(0.75, 1.0, uu) * 0.25 * w.w * vDome);
  col *= skyTint(N, 1.0 - 0.6 * wrap);
  col += rimLight(N, V) * lime * 3.0 * uu * rimShade(shadow);
  col *= mix(1.0, 0.45, vCavity * uCavityAO);
  gl_FragColor = vec4(tonemap(grade(col)), 1.0);
  #include <colorspace_fragment>
}
`;

export const groundVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const groundFragment = /* glsl */ `
precision highp float;
uniform vec3 uBg;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - 0.5) * vec2(10.0, 13.0);
  float r = length(d) * 2.0;
  // a fake soft shadow: the object floats too high for SSAO to reach the ground
  float shadow = (1.0 - smoothstep(0.2, 1.0, r)) * 0.5;
  gl_FragColor = vec4(uBg * (1.0 - shadow), 1.0);
  #include <colorspace_fragment>
}
`;
