export const shellVertex = /* glsl */ `
attribute float moss;
attribute vec4 speciesW;
attribute float speciesW2; // fifth species weight: green reindeer moss (coral)
attribute float dead;
attribute float pillow;
attribute float puff; // plumped up by repeated brushing, animated as a spring
attribute float dome; // cushion clumps
attribute vec3 mossNormal; // smoothed normal: the moss grows along this, the rock is lit with its own
attribute float cavity; // baked occlusion: 1 deep in a hole or an inner corner

uniform float uHeight;
uniform float uBulge;
uniform float uTime;
uniform float uScale;

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
varying vec3 vMossNormal;

void main() {
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
  vMoss = moss;
  vSpecies = w;
  vSpecies2 = w5;
  vDead = dead;
  vPillow = pillow;
  vDome = dome;
  vCavity = cavity;
  vLocal = position;
  vLocalNormal = mossNormal;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vMossNormal = normalize(mat3(modelMatrix) * mossNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const shellFragment = /* glsl */ `
precision highp float;

uniform vec3 uLightDir;
uniform float uTime;
uniform float uHideRock;
uniform float uScale; // moss size, 0.5 .. 2

uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;

// 3x3 PCF against a depth texture rendered from the light. 1 = lit, 0.3 = fully shadowed.
float shadowAt(vec3 worldPos, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(worldPos + n * 0.03, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  // wide, soft penumbra: 16 Poisson taps spread over ~3 texels
  float texel = 5.0 / 2048.0;
  vec2 taps[16];
  taps[0] = vec2(-0.94, 0.0); taps[1] = vec2(0.94, -0.4); taps[2] = vec2(-0.09, -0.93); taps[3] = vec2(0.34, 0.29);
  taps[4] = vec2(-0.91, 0.46); taps[5] = vec2(-0.82, -0.59); taps[6] = vec2(-0.38, 0.28); taps[7] = vec2(0.97, 0.19);
  taps[8] = vec2(0.44, -0.97); taps[9] = vec2(0.54, 0.77); taps[10] = vec2(-0.26, -0.42); taps[11] = vec2(-0.49, 0.9);
  taps[12] = vec2(0.14, 0.69); taps[13] = vec2(0.73, -0.19); taps[14] = vec2(-0.6, -0.12); taps[15] = vec2(0.1, -0.33);
  float lit = 0.0;
  for (int i = 0; i < 16; i++) {
    float d = texture2D(uShadowMap, p.xy + taps[i] * texel).r;
    // soft compare instead of a hard step: no jagged edge where the map is coarse
    lit += smoothstep(-0.004, 0.004, d - (p.z - 0.002));
  }
  return mix(0.45, 1.0, lit / 16.0);
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

// translucency: thin moss lets the key light through. Strongest looking towards the light, a little on the
// side facing away from it; thin = how much of the strand is there (tips 1, roots 0)
uniform float uTrans; // 0 = off (swatches, thumbnails)
vec3 transLight(vec3 N, vec3 V, vec3 L, float thin) {
  if (uTrans <= 0.0) return vec3(0.0);
  float through = pow(max(dot(-V, L), 0.0), 1.5);
  float behind = smoothstep(-0.1, 0.6, dot(-N, L));
  return vec3(1.0, 1.0, 0.6) * (through * 0.6 + behind * 0.55) * thin * uTrans;
}

// coloured ambient: where the key light does not reach, the moss takes a cool sky fill from above and a
// warm, greenish bounce from below instead of flat grey
uniform float uHemi; // 0 = off (swatches, thumbnails)
vec3 skyTint(vec3 N, float shade) {
  vec3 sky = vec3(0.60, 0.84, 1.32);
  vec3 bounce = vec3(1.28, 1.10, 0.45);
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
  return vec3(1.0, 0.93, 0.70) * fres * facing * uRim;
}

// colour grade for the moss only: a touch of exposure, saturation and contrast, in linear light
vec3 grade(vec3 c) {
  c *= 1.3;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.35);
  c = (c - 0.18) * 1.1 + 0.18;
  return max(c, 0.0);
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
  float shadow = shadowAt(vWorldPos, N);
  float sheen = pow(1.0 - ndv, 2.5) * (dot(w, kSheen) + w5 * kSheen5) * mix(0.4, 1.0, shadow);
  // directional, not wrapped: sides facing away from the light go properly dark
  float wrap = pow(max(dot(N, L) * 0.65 + 0.35, 0.0), 1.6) * shadow;
  float hemi = 0.5 + 0.5 * N.y;

  // species palettes (linear)
  vec3 deep = blend5(vec3(0.02, 0.045, 0.008), vec3(0.012, 0.05, 0.008), vec3(0.18, 0.18, 0.11), vec3(0.06, 0.15, 0.012), vec3(0.006, 0.03, 0.006), w, w5);
  vec3 lime = blend5(vec3(0.20, 0.56, 0.04),   vec3(0.05, 0.20, 0.015), vec3(0.34, 0.38, 0.24), vec3(0.40, 0.74, 0.06), vec3(0.05, 0.14, 0.03), w, w5);
  vec3 young = blend5(vec3(0.33, 0.31, 0.07),  vec3(0.13, 0.19, 0.03),   vec3(0.30, 0.30, 0.18), vec3(0.36, 0.58, 0.06), vec3(0.06, 0.13, 0.03), w, w5);
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
  float bump = noise3(vLocal * 70.0 / uScale) * 0.6 + noise3(vLocal * 180.0 / uScale) * 0.4;      // micro height
  float pillow = vPillow;
  float lump = noise3(vLocal * 9.0 + 5.0) * 0.5 + 0.5;

  if (vShell < 0.001) {
    // ---- ground: white surface, taking on the species' velvet shade as the moss matures
    if (uHideRock > 1.5) discard;              // 2 = no base at all, fuzz and fronds only
    if (uHideRock > 0.5 && age < 0.3) discard; // 1 = rock hidden, no pale rim
    // bare surface: smooth vertex normal, no faceting. The geometric normal is only for the mounds.
    vec3 sN = normalize(vWorldNormal);
    float diff = max(dot(sN, L), 0.0) * mix(0.75, 1.0, shadowAt(vWorldPos, sN)); // gentle on the white
    vec3 rock = vec3(0.82) * (0.38 + 0.22 * (0.5 + 0.5 * sN.y) + 0.5 * diff);
    // techie: a fine grid etched into the white, a heavier line every fifth, fading under the moss
    float fine = techGrid(vWorldPos, sN, 0.05, 0.002);
    float major = techGrid(vWorldPos, sN, 0.25, 0.004);
    float grid = max(fine * 0.35, major * 0.6) * (1.0 - smoothstep(0.0, 0.3, age));
    rock *= 1.0 - grid * 0.42;
    rock *= mix(0.75, 1.0, smoothstep(0.0, 0.1, 1.0 - age)); // slight contact shadow right under the moss

    // the ground takes the moss colour early, so neither white rock nor the mound's slope shows through the fuzz
    float edgeNoise = noise3(vLocal * 90.0) * 0.15;
    float mature = smoothstep(0.08 + edgeNoise, 0.6, age);
    float humus = mature;
    vec3 velvet = mix(deep, lime, (0.1 + 0.75 * bump) * wrap) + lime * sheen;
    velvet *= mix(mix(0.85, 0.96, w.w), 1.0, pillow);
    velvet *= mix(1.0, mix(0.65, 1.0, vDome), w.w); // dark crevice between cushion clumps  // valleys a touch darker, the mounds carry the shape not the colour
    velvet *= skyTint(N, 1.0 - 0.6 * wrap);
    velvet += rimLight(N, V) * lime * 2.2;
    vec3 ground = mix(vec3(0.03, 0.025, 0.012), velvet, (dot(w, kBase) + w5 * kBase5));
    vec3 lit = mix(rock, grade(ground), max(humus * 0.92, mature * (dot(w, kBase) + w5 * kBase5)));
    lit *= mix(1.0, 0.45, vCavity * mature); // moss in a hollow sits in the dark
    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
    return;
  }

  // ---- fuzz: a noise density field, dense at the root and thinning upward.
  float ageH = pow(age, dot(w, kAgePow) + w5 * kAgePow5);
  float top = ageH * mix(mix(0.5, 0.94, w.w), 1.0, lump) * mix(mix(0.35, 0.95, w.w), 1.0, pillow) * (dot(w, kHeight) + w5 * kHeight5);
  top *= mix(1.0, mix(0.7, 1.0, vDome), w.w); // short in the crevices between cushion clumps
  // seen edge-on the stacked layers read as streaks too: short fuzz at grazing angles, the velvet base carries it
  float facing = smoothstep(0.15, 0.6, abs(dot(normalize(vMossNormal), V)));
  top *= mix(1.0, mix(0.2, 1.0, facing), w.w);
  if (vShell > top) discard;
  float uu = vShell / max(top, 0.001);

  // lean the sample point as we go up so strands curve instead of standing in straight columns,
  // which at grazing angles would show the shell layers as streaks
  vec3 lean = (vec3(noise3(vLocal * 60.0 / uScale), noise3(vLocal * 60.0 / uScale + 17.0), noise3(vLocal * 60.0 / uScale + 31.0)) - 0.5) * 2.0;
  lean -= vLocalNormal * dot(lean, vLocalNormal);
  vec3 q = vLocal + lean * uu * uu * 0.006;
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

  vec3 col = mix(deep, lime, pow(uu, 1.2) * (0.25 + 0.75 * wrap)) + lime * sheen * uu;
  // young sparse moss at a patch edge reads as light specks, not dirt
  col = mix(col, lime * 0.8, (1.0 - smoothstep(0.1, 0.5, age)) * 0.7);
  col *= mix(mix(0.85, 0.96, w.w), 1.0, pillow) * (0.8 + 0.2 * hemi) * mix(0.6, 1.0, shadow);
  col *= mix(1.0, mix(0.75, 1.0, vDome), w.w);
  // cushion hair has pale yellow-green tips
  col = mix(col, vec3(0.55, 0.76, 0.18), smoothstep(0.75, 1.0, uu) * 0.15 * w.w * vDome);
  col *= skyTint(N, 1.0 - 0.6 * wrap);
  col += transLight(N, V, L, uu * uu) * lime * 3.2;
  col += rimLight(N, V) * lime * 3.0 * uu;
  col *= mix(1.0, 0.45, vCavity);
  gl_FragColor = vec4(grade(col), 1.0);
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
  float shadow = smoothstep(1.0, 0.2, r) * 0.5;
  gl_FragColor = vec4(uBg * (1.0 - shadow), 1.0);
  #include <colorspace_fragment>
}
`;
