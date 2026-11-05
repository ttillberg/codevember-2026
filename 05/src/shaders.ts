export const shellVertex = /* glsl */ `
attribute float moss;
attribute vec4 speciesW;
attribute float dead;
attribute float pillow;
attribute float puff; // plumped up by repeated brushing, animated as a spring

uniform float uHeight;
uniform float uBulge;
uniform float uTime;

varying float vShell;
varying float vMoss;
varying vec4 vSpecies;
varying float vDead;
varying float vPillow;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  float t = float(gl_InstanceID) / float(SHELLS - 1);
  // mound up where the moss is mature: real geometry, so the light makes real shadows between pillows
  vec4 w = speciesW / max(speciesW.x + speciesW.y + speciesW.z + speciesW.w, 1e-4);
  float bulge = moss * moss * mix(0.3, 1.0, pillow) * uBulge * dot(w, vec4(1.0, 0.6, 0.5, 1.3));
  bulge += puff * uBulge * 1.4 * smoothstep(0.0, 0.3, moss);
  vec3 p = position + normal * (bulge + uHeight * t);


  vShell = t;
  vMoss = moss;
  vSpecies = w;
  vDead = dead;
  vPillow = pillow;
  vLocal = position;
  vLocalNormal = normal;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const shellFragment = /* glsl */ `
precision highp float;

uniform vec3 uLightDir;
uniform float uTime;
uniform float uHideRock;

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
varying float vDead;
varying float vPillow;
varying vec3 vLocal;
varying vec3 vLocalNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

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
const vec4 kHeight   = vec4(   1.0,     0.5,    0.6,    1.5  );   // shell height factor
const vec4 kAgePow   = vec4(   1.0,     1.0,    1.0,    2.0  );   // height vs age curve
const vec4 kDensity  = vec4(   0.35,    0.4,    0.5,    0.25 );   // fuzz threshold at the root (higher = sparser)
const vec4 kSheen    = vec4(   0.35,    0.2,    0.15,   0.7  );   // velvet rim strength
const vec4 kBase     = vec4(   0.7,     0.8,    0.5,    1.0  );   // how much the ground takes the species shade

vec3 blend4(vec3 a, vec3 b, vec3 c, vec3 d, vec4 w) { return a * w.x + b * w.y + c * w.z + d * w.w; }

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
  float age = vMoss;

  // the mounds are real geometry now: light them with the geometric normal, softened a little
  vec3 gN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 N = normalize(mix(normalize(vWorldNormal), gN, 0.7));

  float ndv = max(dot(N, V), 0.0);
  float shadow = shadowAt(vWorldPos, N);
  float sheen = pow(1.0 - ndv, 2.5) * dot(w, kSheen) * mix(0.4, 1.0, shadow);
  // directional, not wrapped: sides facing away from the light go properly dark
  float wrap = pow(max(dot(N, L) * 0.65 + 0.35, 0.0), 1.6) * shadow;
  float hemi = 0.5 + 0.5 * N.y;

  // species palettes (linear)
  vec3 deep = blend4(vec3(0.02, 0.045, 0.008), vec3(0.006, 0.03, 0.004), vec3(0.10, 0.09, 0.05), vec3(0.008, 0.04, 0.005), w);
  vec3 lime = blend4(vec3(0.20, 0.56, 0.04),   vec3(0.035, 0.15, 0.012), vec3(0.34, 0.38, 0.24), vec3(0.30, 0.72, 0.05),  w);
  vec3 young = blend4(vec3(0.33, 0.31, 0.07),  vec3(0.13, 0.19, 0.03),   vec3(0.30, 0.30, 0.18), vec3(0.28, 0.40, 0.06),  w);
  lime = mix(young, lime, smoothstep(0.2, 0.9, age));
  vec3 deadCol = blend4(vec3(0.50, 0.38, 0.11), vec3(0.40, 0.30, 0.09), vec3(0.30, 0.24, 0.14), vec3(0.50, 0.38, 0.11), w);
  // yellow only as a per-strand sprinkle; the area field makes patches of darker, deeper moss instead
  float deadMix = step(0.92, hash31(floor(vLocal * 260.0) + 3.0)) * 0.8;
  deep = mix(deep, vec3(0.12, 0.08, 0.02), deadMix);
  lime = mix(lime, deadCol, deadMix);
  // bright green towards the top and on upward faces, darker down the sides; the dark patch field only bites low down
  float upTop = smoothstep(-0.4, 0.9, N.y) * 0.55 + smoothstep(-0.7, 1.9, vWorldPos.y) * 0.45;
  lime = mix(lime * 0.78, lime * 1.22, upTop);
  float shade = vDead * (1.0 - 0.75 * upTop) * 0.8;
  lime = mix(lime, lime * vec3(0.5, 0.6, 0.45), shade);
  deep *= mix(1.0, 0.7, shade);

  // shared fields
  float bump = noise3(vLocal * 70.0) * 0.6 + noise3(vLocal * 180.0) * 0.4;      // micro height
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
    rock *= mix(0.75, 1.0, smoothstep(0.0, 0.1, 1.0 - age)); // slight contact shadow right under the moss

    // the ground takes the moss colour early, so neither white rock nor the mound's slope shows through the fuzz
    float edgeNoise = noise3(vLocal * 90.0) * 0.15;
    float mature = smoothstep(0.08 + edgeNoise, 0.6, age);
    float humus = mature;
    vec3 velvet = mix(deep, lime, (0.1 + 0.75 * bump) * wrap) + lime * sheen;
    velvet *= mix(0.5, 1.0, pillow);   // valleys stay dark
    vec3 ground = mix(vec3(0.03, 0.025, 0.012), velvet, dot(w, kBase));
    vec3 lit = mix(rock, grade(ground), max(humus * 0.92, mature * dot(w, kBase)));
    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
    return;
  }

  // ---- fuzz: a noise density field, dense at the root and thinning upward.
  float ageH = pow(age, dot(w, kAgePow));
  float top = ageH * mix(0.5, 1.0, lump) * mix(0.35, 1.0, pillow) * dot(w, kHeight);
  if (vShell > top) discard;
  float uu = vShell / max(top, 0.001);

  // lean the sample point as we go up so strands curve instead of standing in straight columns,
  // which at grazing angles would show the shell layers as streaks
  vec3 lean = (vec3(noise3(vLocal * 60.0), noise3(vLocal * 60.0 + 17.0), noise3(vLocal * 60.0 + 31.0)) - 0.5) * 2.0;
  lean -= vLocalNormal * dot(lean, vLocalNormal);
  vec3 q = vLocal + lean * uu * uu * 0.006;
  float dens = noise3(q * 140.0) * 0.5 + noise3(q * 420.0) * 0.3 + hash31(floor(q * 420.0)) * 0.2;
  // thin out more at grazing angles: the silhouette stays fuzzy but layers cannot line up
  float graze = 1.0 - ndv;
  if (dens < dot(w, kDensity) + 0.6 * uu + 0.35 * uu * graze) discard;

  vec3 col = mix(deep, lime, pow(uu, 1.2) * (0.25 + 0.75 * wrap)) + lime * sheen * uu;
  // young sparse moss at a patch edge reads as light specks, not dirt
  col = mix(col, lime * 0.8, (1.0 - smoothstep(0.1, 0.5, age)) * 0.7);
  col *= mix(0.55, 1.0, pillow) * (0.8 + 0.2 * hemi) * mix(0.6, 1.0, shadow);
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
