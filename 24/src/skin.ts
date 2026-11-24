// Snake skin on a MeshPhysicalMaterial. Every scale is a cell in the tube's own coordinates
// (they never swim): staggered rows of rhombic dorsal scales, each domed and lifted at its free
// back edge so it lies over the one behind, and wide belly plates. Height turns into the normal
// by finite differences. Colour is decided once per scale from where its centre is, so the
// markings follow the scale edges, as they do on the animal. Where the body bends, the scales
// part on the outside and the skin between them shows. Each species has its own pattern
// (bodyColor, picked by uPattern: one program for all of them).
import * as THREE from 'three';
import type { Species } from './species';

const GLSL = /* glsl */ `
uniform int uPattern;
uniform sampler2D tHead;  // the head's own paint (head.ts): its back row is what the neck grows out of
uniform float uHeadOn;
uniform float uNeckLen;
uniform float uRows;
uniform float uVw;
uniform float uVRatio;
uniform float uSeed;
uniform float uLength;
uniform float uRadius;
uniform vec3 uBare;
uniform sampler2D tText;
uniform float uTextW;
uniform float uTextT0;
uniform float uTextCol;
uniform float uKind;
uniform float uTime;
uniform vec3 uPixOn;  // linear
uniform vec3 uPixOff;
uniform vec4 uSpark[4];
uniform float uSparkEnd; // uTime past which every tap animation is done: skip the spark loops
varying vec4 vBody;
varying vec2 vBody2;
varying vec3 vTanV;
varying float vAO;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(float x) {
  float i = floor(x), f = fract(x);
  float a = hash12(vec2(i, uSeed)), b = hash12(vec2(i + 1.0, uSeed));
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}
vec3 srgb(vec3 c) { return pow(c / 255.0, vec3(2.2)); }

// dorsal scales: staggered rows of rounded rhombi that overlap like shingles, the one nearer the
// head always on top. p = (along in scale lengths, round in rows), st = stretch: on the outside
// of a bend the scales draw apart and leave skin between them.
// a scale's half length and half width in the grid: drawn out along a stretched bend, a little narrower
vec2 scaleR(float st) { return vec2(0.78 / st, 1.12 / pow(st, 0.35)); }
float scaleShape(vec2 d, float ra, float rb) {
  float ax = abs(d.x) / (d.x > 0.0 ? ra : ra * 0.8);
  return pow(pow(ax, 1.55) + pow(abs(d.y) / rb, 1.55), 1.0 / 1.55);
}
void dorsalTop(vec2 p, vec2 R, out vec2 cTop, out float eTop, out vec2 oTop) {
  eTop = 9.0; cTop = vec2(0.0); oTop = vec2(0.0);
  float ra = R.x, rb = R.y, raBack = -ra * 0.8;
  float bestX = 1e9;
  float j0 = floor(p.y);
  for (int dj = -1; dj <= 2; dj++) {
    float j = j0 + float(dj);
    float dy = p.y - j;
    if (abs(dy) >= rb) continue;
    float off = mod(j, 2.0) * 0.5;
    float i0 = floor(p.x - off + 0.5);
    for (int di = -1; di <= 1; di++) {
      float cx = i0 + float(di) + off;
      if (cx >= bestX) continue;
      float dx = p.x - cx;
      if (dx >= ra || dx <= raBack) continue;
      vec2 d = vec2(dx, dy);
      float e = scaleShape(d, ra, rb);
      if (e < 1.0) { bestX = cx; cTop = vec2(cx, j); eTop = e; oTop = d; }
    }
  }
}
// the free edges just in front of p throw a thin shadow on it
float edgeShadow(vec2 p, vec2 R, float topX) {
  float ra = R.x, rb = R.y;
  float raMax = ra * 1.16, rbMax = rb * 1.16;
  float sh = 0.0;
  float j0 = floor(p.y);
  for (int dj = -1; dj <= 2; dj++) {
    float j = j0 + float(dj);
    float dy = p.y - j;
    if (abs(dy) >= rbMax) continue;
    float off = mod(j, 2.0) * 0.5;
    float i0 = floor(p.x - off + 0.5);
    for (int di = -1; di <= 0; di++) {
      float cx = i0 + float(di) + off;
      if (cx >= topX) continue;
      float dx = p.x - cx;
      if (dx < 0.0 || dx >= raMax) continue;
      float e = scaleShape(vec2(dx, dy), ra, rb);
      sh = max(sh, 1.0 - smoothstep(1.0, 1.16, e));
    }
  }
  return sh;
}
// the height at a point of the top scale found there (e: how far out on it, o: offset from its centre)
float dorsalHAt(float e, vec2 o, float ra, float gap) {
  if (e > 1.0) return 0.0;
  float rim = smoothstep(1.0, 1.0 - gap, e);
  float dome = 1.0 - e * e;
  float lift = clamp(o.x / ra, -1.0, 1.0); // the free back edge stands proud
  return 0.25 + rim * (0.35 + 0.25 * dome + 0.3 * lift);
}

// belly plates: one per vertebra, the back edge over the next one
float ventralH(float av, float q, float gap) {
  float f = fract(av);
  float side = 1.0 - abs(q);
  float edge = smoothstep(0.0, gap * 0.5, f) * smoothstep(0.0, gap * 0.25, 1.0 - f) * smoothstep(0.0, gap * 0.35, side);
  return edge * (0.6 + 0.3 * f - 0.15 * q * q * q * q);
}

// --- colour: one per scale -------------------------------------------------------
// s: metres from the neck, phi: round from the spine (0) to the belly (+-pi), id: hash
vec3 pythonColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  vec3 top = srgb(vec3(18.0, 104.0, 46.0));
  vec3 side = srgb(vec3(58.0, 150.0, 46.0));
  vec3 low = srgb(vec3(150.0, 192.0, 58.0));
  vec3 c = mix(top, side, smoothstep(0.35, 1.5, ap));
  c = mix(c, low, smoothstep(1.7, 2.3, ap));
  // the vertebral line: white scales, broken into dashes and the odd triangle down the side
  float dash = vnoise(s * 45.0);
  float onLine = step(ap, 0.05 + 0.1 * smoothstep(0.7, 0.95, dash));
  float tn = vnoise(s * 14.0 + 7.0);
  float tri = step(0.9, tn) * step(ap, 0.3 * (tn - 0.9) / 0.1 + 0.04);
  float white = max(onLine * step(0.58, dash), tri) * step(0.06, s) * step(s, uLength * 0.82) * step(0.3, id);
  c = mix(c, srgb(vec3(214.0, 226.0, 196.0)), white * (0.7 + 0.25 * id));
  // a blue cast on some dorsal scales, as on some adults
  c = mix(c, srgb(vec3(26.0, 108.0, 96.0)), smoothstep(0.75, 1.0, id) * (1.0 - smoothstep(0.2, 0.9, ap)) * 0.35);
  vec3 bc = mix(srgb(vec3(214.0, 222.0, 104.0)), srgb(vec3(196.0, 214.0, 84.0)), id);
  c = mix(c, bc, belly);
  return c;
}

vec3 cornColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  vec3 ground = srgb(vec3(206.0, 124.0, 64.0));
  vec3 pale = srgb(vec3(226.0, 168.0, 112.0));
  vec3 red = srgb(vec3(178.0, 44.0, 22.0));
  vec3 black = srgb(vec3(26.0, 14.0, 10.0));
  vec3 c = mix(ground, pale, smoothstep(0.9, 2.0, ap));
  // dorsal saddles, a little irregular in size and spacing
  float P = 0.034;
  float k = floor(s / P);
  float sc = (k + 0.5) * P + (vnoise(k * 3.1) - 0.5) * 0.012;
  float len = 0.008 + 0.009 * vnoise(k * 1.7 + 4.0);
  float reach = 1.15 + 0.2 * vnoise(k * 2.3 + 9.0);
  float fs = abs(s - sc) - len * (1.0 - 0.5 * pow(ap / reach, 3.0));
  fs = max(fs, (ap - reach) * 0.012);
  // lateral blotches, between the saddles, low on the flank
  float sl = (k + 1.0) * P + (vnoise(k * 2.9 + 1.0) - 0.5) * 0.006;
  float fl = length(vec2((s - sl) / 0.007, (ap - 1.75) / 0.28)) - 1.0;
  fl *= 0.006;
  float f = min(fs, fl);
  float bw = 0.0035;
  float tail = smoothstep(uLength * 0.8, uLength, s);
  c = mix(c, red, step(f, 0.0));
  c = mix(c, black, step(0.0, f) * step(f, bw) * (1.0 - tail * 0.5));
  // the neck carries the head's spearpoint back as two stripes
  float stripe = step(abs(ap - 0.4), 0.16) * (1.0 - smoothstep(0.03, 0.06, s));
  c = mix(c, red, stripe);
  // belly: white with black checks, alternating sides, plate by plate
  float r = hash12(vec2(plate, uSeed + 3.0));
  float sideSel = mod(plate, 2.0) < 1.0 ? 1.0 : -1.0;
  float q = sign(phi);
  vec3 bc = srgb(vec3(238.0, 230.0, 214.0));
  float check = step(0.25, r) * step(0.0, q * sideSel) * step(abs(ap - 2.62), 0.24) * step(0.06, s);
  bc = mix(bc, black, check);
  bc = mix(bc, srgb(vec3(232.0, 176.0, 120.0)), smoothstep(2.35, 2.2, ap) * 0.7);
  c = mix(c, bc, belly);
  return c;
}

// value noise in two dimensions, and the nearest two cell walls of a jittered grid
float vnoise2(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  float a = hash12(i + uSeed), b = hash12(i + vec2(1.0, 0.0) + uSeed);
  float c = hash12(i + vec2(0.0, 1.0) + uSeed), d = hash12(i + vec2(1.0, 1.0) + uSeed);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 cells(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    vec2 g = vec2(float(k), float(y));
    vec2 o = vec2(hash12(i + g + uSeed), hash12(i + g + uSeed + 17.0)) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
float blob(float s, float ap, float sc, float pc, float rs, float rp) {
  return length(vec2((s - sc) / rs, (ap - pc) / rp)) - 1.0;
}

// ball python: near black brown, big rounded caramel blotches on the flanks, smaller ones on the
// back between them, each rimmed in gold; the flank ones with a dark eye in the middle
vec3 ballColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi), sd = sign(phi);
  vec3 dark = srgb(vec3(40.0, 27.0, 18.0));
  vec3 tan = srgb(vec3(172.0, 118.0, 58.0));
  vec3 gold = srgb(vec3(214.0, 170.0, 96.0));
  float P = 0.05;
  float sh = s + sd * P * 0.25;
  float k = floor(sh / P);
  float sc = (k + 0.5) * P + (vnoise(k * 3.7 + sd) - 0.5) * 0.012;
  float fl = blob(sh, ap, sc, 1.45 + 0.15 * vnoise(k + 9.0), 0.013 + 0.005 * vnoise(k * 1.3), 0.5);
  float kd = floor(s / P);
  float fd = blob(s, ap, kd * P + (vnoise(kd * 2.1 + 4.0) - 0.5) * 0.01, 0.0, 0.007 + 0.004 * vnoise(kd * 5.0), 0.42);
  float f = min(fl, fd);
  vec3 c = dark;
  c = mix(c, gold, step(f, 0.18));
  c = mix(c, tan, step(f, 0.0));
  c = mix(c, dark * 1.3, step(fl, -0.62));
  vec3 bc = mix(srgb(vec3(232.0, 220.0, 190.0)), srgb(vec3(60.0, 44.0, 30.0)), step(0.93, hash12(vec2(plate, uSeed + 5.0))) * 0.8);
  return mix(c, bc, belly);
}

// jungle carpet python: jet black and bright yellow in broken, crossing bands
vec3 carpetColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  vec2 q = vec2(s, phi * uRadius);
  float n = vnoise2(q * 34.0) * 0.65 + vnoise2(q * 80.0 + 3.0) * 0.35;
  float band = 0.5 + 0.5 * sin(s * 6.2832 / 0.055 + vnoise(s * 30.0) * 4.0 + ap * 1.2);
  float y = n * 0.75 + band * 0.45 - 0.5;
  vec3 c = mix(srgb(vec3(18.0, 15.0, 11.0)), srgb(vec3(232.0, 184.0, 28.0)), step(0.0, y));
  // a black rim where yellow meets black is part of it: a thin line, scale by scale
  c = mix(c, srgb(vec3(120.0, 92.0, 18.0)), step(abs(y), 0.03) * 0.6);
  vec3 bc = mix(srgb(vec3(226.0, 204.0, 120.0)), srgb(vec3(40.0, 34.0, 20.0)), step(0.8, vnoise2(vec2(plate * 0.7, phi * 3.0))));
  return mix(c, bc, belly);
}

// albino Burmese python: cream, with butter-yellow patches like a giraffe's, the paler net between them
vec3 burmeseColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  vec2 q = vec2(s / 0.034, phi * uRadius / (0.024 + 0.01 * smoothstep(0.6, 1.6, ap)));
  vec2 d = cells(q);
  float net = d.y - d.x;
  vec3 cream = srgb(vec3(244.0, 236.0, 212.0));
  vec3 butter = srgb(vec3(244.0, 198.0, 72.0));
  vec3 rim = srgb(vec3(226.0, 150.0, 40.0));
  vec3 c = mix(butter, mix(butter, cream, 0.35), smoothstep(0.5, 0.1, d.x));
  c = mix(c, rim, smoothstep(0.32, 0.12, net));
  c = mix(c, cream, step(net, 0.1));
  c = mix(c, cream, smoothstep(1.9, 2.3, ap));
  return mix(c, srgb(vec3(248.0, 242.0, 228.0)), belly);
}

// California kingsnake: chocolate black, crisp white bands that widen low on the flanks
vec3 kingColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  float P = 0.036;
  float k = floor(s / P);
  float sc = (k + 0.5) * P + (vnoise(k * 2.7) - 0.5) * 0.008;
  float w = 0.0045 + 0.0035 * smoothstep(0.9, 2.2, ap) + 0.0015 * vnoise(k * 4.1 + 2.0);
  float band = step(abs(s - sc), w);
  vec3 dark = srgb(vec3(30.0, 22.0, 18.0));
  vec3 white = srgb(vec3(238.0, 232.0, 210.0));
  vec3 c = mix(dark, white, band);
  vec3 bc = mix(white, dark, step(0.45, hash12(vec2(plate, uSeed + 9.0))) * (1.0 - band));
  return mix(c, bc, belly);
}

// Honduran milk snake: rings round the whole body, red, black, yellow, black, red;
// the red scales tipped black here and there
vec3 milkColor(float s, float phi, float id, float belly, float plate) {
  float P = 0.052;
  float j = vnoise(floor(s / P) * 3.3) * 0.12;
  float t = fract(s / P + j);
  vec3 red = srgb(vec3(200.0, 46.0, 26.0));
  vec3 black = srgb(vec3(16.0, 13.0, 12.0));
  vec3 yel = srgb(vec3(238.0, 200.0, 96.0));
  vec3 c = red;
  if (t > 0.52) c = black;
  if (t > 0.63) c = yel;
  if (t > 0.77) c = black;
  if (t > 0.88) c = red;
  c = mix(c, black, step(0.86, id) * step(t, 0.5) * (1.0 - belly));
  c = mix(c, black, 1.0 - step(0.012, s));
  return mix(c, c * 0.9 + 0.06, belly);
}

// eastern garter snake: dark olive, a yellow stripe down the back and one low on each side,
// two rows of black checks between
vec3 garterColor(float s, float phi, float id, float belly, float plate) {
  float ap = abs(phi);
  vec3 olive = srgb(vec3(62.0, 60.0, 38.0));
  vec3 black = srgb(vec3(20.0, 20.0, 14.0));
  vec3 stripe = srgb(vec3(224.0, 200.0, 96.0));
  vec3 side = srgb(vec3(200.0, 196.0, 126.0));
  float P = 0.012;
  float r1 = step(abs(ap - 0.62), 0.16) * step(0.5, fract(s / P));
  float r2 = step(abs(ap - 1.18), 0.16) * step(0.5, fract(s / P + 0.5));
  vec3 c = mix(olive, black, max(r1, r2) * 0.85);
  c = mix(c, stripe, step(ap, 0.2 + 0.03 * vnoise(s * 60.0)));
  c = mix(c, side, step(abs(ap - 1.72), 0.17));
  vec3 bc = mix(srgb(vec3(200.0, 208.0, 150.0)), black, step(abs(ap - 2.3), 0.06) * step(0.6, hash12(vec2(plate, uSeed))));
  return mix(c, bc, belly);
}

// The head and the body are two meshes painted two ways: met on one ring, the pattern stopped dead
// there. So down the neck, scale by scale, the body takes the colour the head has at its back edge
// right above it (blurred, so a granule doesn't streak), all of them at the head, fewer and fewer
// further on, none past uNeckLen: the head's colours run out into the body's pattern in a ragged edge,
// scale-sized, as markings do. The head's texture runs round from the belly (u 0) over the left
// cheek to the spine (.5), its back row along the bottom; the body's sV runs the other way round.
vec3 neckBlend(vec3 c, float s, float sv, float id) {
  if (uHeadOn < 0.5) return c;
  float w = 1.0 - smoothstep(0.0, uNeckLen, s);
  if (id >= w * w * 1.05) return c;
  // an explicit level: the lookup is per scale, so its screen derivatives jump at every scale's edge,
  // and left to them the GPU took the smallest level there, the whole head's average, in specks
  return textureLod(tHead, vec2(fract(1.0 - sv), 0.985), 4.0).rgb;
}

vec3 bodyColor(float s, float phi, float id, float belly, float plate) {
  // a uniform, not a define: one program for all eight snakes, built once instead of eight times
  if (uPattern == 0) return pythonColor(s, phi, id, belly, plate);
  if (uPattern == 1) return cornColor(s, phi, id, belly, plate);
  if (uPattern == 2) return ballColor(s, phi, id, belly, plate);
  if (uPattern == 3) return carpetColor(s, phi, id, belly, plate);
  if (uPattern == 4) return burmeseColor(s, phi, id, belly, plate);
  if (uPattern == 5) return kingColor(s, phi, id, belly, plate);
  if (uPattern == 6) return milkColor(s, phi, id, belly, plate);
  return garterColor(s, phi, id, belly, plate);
}
`;

// a 5 x 7 font for the few letters it needs, and the line it scrolls, as a one-channel texture
const FONT: Record<string, string[]> = {
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  t: ['00100', '00100', '01110', '00100', '00100', '00101', '00010'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  m: ['00000', '00000', '11010', '10101', '10101', '10001', '10001'],
  '♥': ['00000', '01010', '11111', '11111', '01110', '00100', '00000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01111'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  _: ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const texts = new Map<string, { tex: THREE.DataTexture; width: number }>();
/** a line of text as a one-channel texture, a 5 x 7 cell and a column of space per letter */
function textTexture(line: string) {
  let t = texts.get(line);
  if (t) return t;
  const chars = [...line];
  const width = chars.length * 6;
  const data = new Uint8Array(width * 7);
  chars.forEach((ch, n) => {
    const g = FONT[ch] ?? FONT[' '];
    // a heart's pixels are stored at half: drawn red
    const v = ch === '♥' ? 128 : 255;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (g[y][x] === '1') data[y * width + n * 6 + x] = v;
  });
  const tex = new THREE.DataTexture(data, width, 7, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  t = { tex, width };
  texts.set(line, t);
  return t;
}

/** an sRGB colour (0..255) as the linear one a shader works in, converted once */
const lin = (c: number[]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

export function createSkin(sp: Species) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: sp.roughness,
    metalness: 0,
    clearcoat: sp.clearcoat,
    clearcoatRoughness: 0.28,
    iridescence: sp.iridescence,
    iridescenceIOR: 1.55,
    iridescenceThicknessMinimum: 180,
    iridescenceThicknessMaximum: 420,
  });
  const uniforms = {
    uPattern: { value: sp.pattern },
    tHead: { value: null as THREE.Texture | null },
    uHeadOn: { value: 0 },
    uNeckLen: { value: sp.headLength * 0.65 },
    uRows: { value: sp.rows },
    uVw: { value: sp.ventralWidth },
    uVRatio: { value: sp.shape === 'python' ? 2.2 : 1.35 },
    uSeed: { value: sp.seed ?? sp.pattern * 17 + 3 },
    uLength: { value: sp.length },
    uRadius: { value: sp.radius },
    uBare: { value: lin(sp.bare) },
    tText: { value: textTexture(sp.text ?? ' ').tex },
    uTextW: { value: sp.text ? textTexture(sp.text).width : 0 },
    uTextT0: { value: -99 },
    uTextCol: { value: 0 },
    uKind: { value: sp.pixelAnim },
    uTime: { value: 0 },
    uPixOn: { value: lin(sp.pixel.on) },
    uPixOff: { value: lin(sp.pixel.off) },
    uSpark: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -99, 0)) },
    uSparkEnd: { value: -99 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aBody;
attribute vec2 aBody2;
attribute vec3 aTan;
attribute float aAO;
varying float vAO;
varying vec4 vBody;
varying vec2 vBody2;
varying vec3 vTanV;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBody = aBody; vBody2 = aBody2; vAO = aAO; vTanV = normalize(normalMatrix * aTan);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float sA = vBody.x;            // along, in dorsal scale lengths
float sV = vBody.y;            // round, 0 at the belly's middle, .5 on the spine
float rad = vBody.z;
float stretch = vBody.w;
float sM = vBody2.x;           // metres from the neck
float mPerA = vBody2.y;        // metres per scale length
float girth = 6.2832 * rad;
float spacingM = (1.0 - uVw) * girth / uRows;
float vv = sV > 0.5 ? sV - 1.0 : sV; // -.5 .. .5, 0 at the belly
float halfV = uVw * 0.5;
float isBelly = step(abs(vv), halfV);
float phi = (sV - 0.5) * 6.2832; // 0 on the spine
// how many scales a pixel covers: fade the relief out before it shimmers. The mean of the two
// directions, not the larger: where the skin is foreshortened (an edge, the inside of a bend) the
// scales are tiny one way only and still read
float foot = sqrt(fwidth(sA) * fwidth(sV) * uRows);
float fade = 1.0 - smoothstep(0.12, 0.45, foot);
float gap = 0.09 * pow(stretch, 4.0) + 0.02;
vec3 col;
vec2 tilt = vec2(0.0);
float scaleId = 0.5;
float h, hA, hB;
float dA = 0.035, dB = 0.035;
float joint;
float lift = 0.0;
float lit = 0.0, star = 0.0, heart = 0.0;
vec3 starC = vec3(0.0);
if (isBelly > 0.5) {
  float av = sA / uVRatio;
  float q = vv / halfV;
  float g = gap * 2.0;
  h = ventralH(av, q, g);
  hA = ventralH(av + dA / uVRatio, q, g);
  hB = ventralH(av, q + dB * 2.0 / (uRows * uVw / (1.0 - uVw)), g);
  float plate = floor(av);
  float id = hash12(vec2(plate, 7.0 + uSeed));
  scaleId = id;
  tilt = vec2(hash12(vec2(plate, 2.0)) - 0.5, 0.0) * 0.12;
  vec3 base = neckBlend(bodyColor(sM, phi, id, 1.0, plate), sM, sV, id);
  col = base * (0.94 + 0.12 * id);
  joint = 1.0 - smoothstep(0.0, g * 0.5, fract(av));
  lift = fract(av);
} else {
  float b = (sV - halfV) / (1.0 - uVw) * uRows;
  vec2 p = vec2(sA, b);
  vec2 c; float e; vec2 o;
  float st = stretch;
  vec2 R = scaleR(st);
  dorsalTop(p, R, c, e, o);
  float gapE = 0.12;
  float bare = step(1.0, e);
  h = dorsalHAt(e, o, R.x, gapE);
  if (fade > 0.05 && bare < 0.5) {
    // gradient on the winning scale itself: 2 shape calls instead of 24
    vec2 oA = o + vec2(dA, 0.0);
    vec2 oB = o + vec2(0.0, dB);
    hA = dorsalHAt(scaleShape(oA, R.x, R.y), oA, R.x, gapE);
    hB = dorsalHAt(scaleShape(oB, R.x, R.y), oB, R.x, gapE);
  } else {
    hA = h;
    hB = h;
  }
  // the scatter (one species' tap): round the scale tapped, each scale wears the colour of another
  // a few scales off, shuffled anew every frame, twelve a second, the shuffle spreading and dying down
  vec2 cm = c;
  float shuffled = 0.0;
  if (uKind > 3.5 && uTime < uSparkEnd) {
    for (int q = 0; q < 4; q++) {
      vec4 sk = uSpark[q];
      float age = uTime - sk.z;
      if (sk.w < 0.5 || age < 0.0 || age > 1.8) continue;
      float radS = min(4.0 + age * 12.0, 12.0);
      float d = length(c - sk.xy);
      if (d >= radS) continue;
      float fr = floor(age * 12.0);
      float amp = 10.0 * pow(1.0 - age / 1.8, 1.5) * (1.0 - d / radS);
      vec2 hh = vec2(hash12(c + fr * 1.37 + float(q) * 7.1), hash12(c.yx + fr * 2.11 + float(q) * 3.3)) - 0.5;
      vec2 mo = floor(hh * 2.0 * amp + 0.5);
      cm += mo;
      if (mod(abs(mo.y), 2.0) > 0.5) cm.x += 0.5;
      shuffled = max(shuffled, step(0.5, abs(mo.x) + abs(mo.y)) * min(1.0, amp / 4.0));
    }
  }
  float id = hash12(cm + uSeed);
  scaleId = id;
  // every scale sits at its own slight angle: they catch the light one by one
  tilt = (vec2(hash12(c + 1.7), hash12(c + 5.3)) - 0.5) * 0.3 * (1.0 - bare);
  // a shuffled scale is knocked askew, catching the light
  tilt += (vec2(hash12(cm + 3.1), hash12(cm + 9.7)) - 0.5) * 1.1 * shuffled;
  float sC = sM + (cm.x - p.x) * mPerA;
  float vC = halfV + cm.y / uRows * (1.0 - uVw);
  float phiC = (vC - 0.5) * 6.2832;
  vec3 base = neckBlend(bodyColor(sC, phiC, id, 0.0, 0.0), sC, vC, id);
  if (uTextT0 > -50.0 && uTextW > 0.5) {
    // after a click, the scales as pixels: the line in a 5 x 7 font comes out of the scale clicked and
    // runs toward the head, four scales a second, on the seven rows round the spine
    float k = c.y - (floor(uRows * 0.5) - 3.0);
    float colI = floor(c.x - mod(c.y, 2.0) * 0.5);
    float lead = uTextCol - floor((uTime - uTextT0) * 4.0);
    float u = colI - lead;
    float shown = step(0.0, u) * step(u, uTextW - 1.0) * step(colI, uTextCol) * step(0.04, sC) * step(sC, uLength * 0.9);
    if (k >= 0.0 && k < 7.0) {
      float tv = texture2D(tText, vec2((u + 0.5) / uTextW, (6.0 - k + 0.5) / 7.0)).r * shown;
      lit = step(0.25, tv);
      heart = lit * step(tv, 0.75);
    }
  }
  // a tap's pixel animation, twelve frames a second, each species its own: a star (a dot, four
  // crossed rays to a *, the middle going out, the tips running on alone), a ring, a diamond, a plus
  if (uKind < 3.5 && uTime < uSparkEnd) {
    for (int q = 0; q < 4; q++) {
      vec4 sk = uSpark[q];
      float f = floor((uTime - sk.z) * 12.0);
      if (sk.w < 0.5 || f < 0.0 || f > 8.0) continue;
      float ax = abs(c.x - sk.x), ay = abs(c.y - sk.y);
      float on = 0.0;
      if (uKind < 0.5 || uKind > 2.5) {
        float r0 = f < 4.0 ? 0.0 : f < 5.0 ? 1.0 : f < 6.0 ? 2.0 : f < 7.0 ? 4.0 : f < 8.0 ? 5.0 : 6.0;
        float r1 = f < 4.0 ? f : f < 5.0 ? 4.0 : f < 8.0 ? 5.0 : 6.0;
        float r = 99.0;
        if (ay < 0.5) r = ax;                                          // along the body
        if (ax < 0.6) r = min(r, ay);                                  // round it
        if (uKind < 0.5 && abs(ax - ay) < 0.6) r = min(r, ay);         // the star's diagonals
        on = step(r0 - 0.01, r) * step(r, r1 + 0.01);
      } else if (uKind < 1.5) {
        // a ring going out, breaking into every other scale as it goes
        float r = length(vec2(ax, ay));
        on = step(abs(r - f * 0.9), 0.55) * (f < 5.0 ? 1.0 : step(mod(floor(c.x) + c.y, 2.0), 0.5));
      } else {
        // a diamond going out, only its four corners at the end
        float r = ax + ay;
        on = step(abs(r - f), 0.6) * (f < 6.0 ? 1.0 : step(min(ax, ay), 0.6));
      }
      star = max(star, on);
    }
  }
  // whichever of its two pixel colours stands out more from this scale's own
  starC = distance(base, uPixOn) > distance(base, uPixOff) ? uPixOn : uPixOff;
  float lf = clamp(o.x / R.x, -1.0, 1.0);
  // the scale's own variation, a lighter free edge, the rim and the shadow of the scale in front
  col = base * (0.9 + 0.18 * id) * (1.0 + 0.07 * lf) * (1.0 + 0.4 * shuffled);
  float rim = 1.0 - smoothstep(1.0, 1.0 - gapE, e);
  float sh = fade > 0.05 ? edgeShadow(p, R, c.x) : 0.0;
  joint = max(rim * 0.5 * (1.0 - bare), sh * 0.55);
  vec3 skinC = uBare;
  col = mix(col, skinC * 0.55, bare);
  lift = lf * 0.5 + 0.5;
}
// far off, a scale is under a pixel: the pattern taken where the pixel is, not per scale
{
  // two scales' worth averaged, as a scattering of odd scales (the python's white ones) would be
  float pl = floor(sA / uVRatio);
  // (only where it shows: close up the scales are drawn and this is skipped)
  if (fade < 0.6) {
    vec3 smoothC = mix(bodyColor(sM, phi, 0.25, isBelly, pl), bodyColor(sM, phi, 0.62, isBelly, pl), 0.4);
    smoothC = mix(smoothC, neckBlend(smoothC, 0.0, sV, 0.0), uHeadOn * (1.0 - smoothstep(0.0, uNeckLen, sM)) * 0.8);
    col = mix(smoothC, col, smoothstep(0.0, 0.6, fade));
  }
}
// the text and the stars: scales recoloured against the pattern, each in whichever of the snake's
// two pixel colours stands out more from its own; the heart red, but where the scale is red already
vec3 heartC = srgb(vec3(214.0, 22.0, 34.0));
heartC = distance(starC, heartC) < 0.25 || distance(col, heartC) < 0.35 ? starC : heartC;
col = mix(col, mix(starC, heartC, heart) * (0.9 + 0.18 * scaleId), lit);
col = mix(col, starC * (0.9 + 0.18 * scaleId), star);
// the joints and the shadows under the free edges
col = mix(col, col * 0.4, joint * fade);
// the tucked front of each scale lies in the shade of the one before
col *= mix(1.0, 0.82 + 0.18 * lift, fade);
diffuseColor.rgb = col * mix(1.0, vAO, 0.55);
float gradA = (hA - h) / (dA * mPerA);
float gradB = (hB - h) / (dB * spacingM);
float amp = (isBelly > 0.5 ? 0.0004 : 0.11 * spacingM) * fade;
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
// scales smaller than a pixel still scatter the light: their tilt turns into roughness
roughnessFactor = clamp(roughnessFactor + joint * 0.3 * fade - lift * 0.06 + (scaleId - 0.5) * 0.14 * fade + (1.0 - fade) * 0.15, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 Tv = normalize(vTanV - dot(vTanV, normal) * normal);
  vec3 Bv = cross(Tv, normal);
  normal = normalize(normal - (gradA * Tv + gradB * Bv) * amp - (tilt.x * Tv + tilt.y * Bv) * fade);
}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoatRoughness = clamp(material.clearcoatRoughness + (1.0 - fade) * 0.22, 0.0, 1.0);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vAO;
reflectedLight.indirectSpecular *= vAO * vAO;
reflectedLight.directSpecular *= mix(1.0, vAO, 0.6);`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
clearcoatNormal = normal;`);
  };
  mat.customProgramCacheKey = () => 'snake-skin';
  return mat;
}
