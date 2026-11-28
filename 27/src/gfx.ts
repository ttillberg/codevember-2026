// Light and matter. Every surface runs the same three lights: the torch (a cookie, 1/d², a shadow map), a fake bounce
// off whatever the hotspot lands on, and the day coming in through the mouth of the burrow.
import * as THREE from 'three';
import { bakeNoiseTexture, bakeCellTexture } from './noise';

export const SHADOW_RES = 2048;
export const LIGHT_COL = new THREE.Vector3(1.0, 0.86, 0.66);

export const U = {
  uTime: { value: 0 },
  uNoise: { value: bakeNoiseTexture(64, 7) as THREE.Texture },
  uCells: { value: bakeCellTexture(64, 8) as THREE.Texture },
  uShadow: { value: null as THREE.Texture | null },
  uShadowRes: { value: SHADOW_RES },
  uLightVP: { value: new THREE.Matrix4() },
  uLightPos: { value: new THREE.Vector3() },
  uLightDir: { value: new THREE.Vector3(0, 0, -1) },
  uLightCol: { value: LIGHT_COL },
  uLightI: { value: 1.0 },
  uBouncePos: { value: new THREE.Vector3() },
  uBounceCol: { value: new THREE.Vector3() },
  uMouth: { value: new THREE.Vector3() },
  uSky: { value: new THREE.Vector3(0.78, 0.86, 1.0) },
  uGround: { value: new THREE.Vector3(0.2, 0.19, 0.13) },
  uDay: { value: 3.2 },
  uEye: { value: new THREE.Vector3() },
};

/** The torch's beam profile by angle off its axis (radians). Kept in step with cookie() in the GLSL below. */
export function cookie(a: number): number {
  const hot = Math.exp(-((a / 0.17) ** 2));
  const corona = 0.16 * Math.exp(-((a / 0.42) ** 2));
  const u = Math.min(1, Math.max(0, (0.95 - a) / (0.95 - 0.6)));
  return hot + corona + 0.004 * u * u * (3 - 2 * u);
}

const COMMON = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2DShadow;
#define PI 3.14159265
uniform sampler3D uNoise;
uniform sampler2DShadow uShadow;
uniform mat4 uLightVP;
uniform vec3 uLightPos, uLightDir, uLightCol, uBouncePos, uBounceCol, uMouth, uSky, uGround, uEye;
uniform float uLightI, uShadowRes, uTime, uDay;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec4 nz(vec3 p) { return texture(uNoise, p); }
float sat(float x) { return clamp(x, 0.0, 1.0); }

float cookie(float c) {
  float a = acos(clamp(c, -1.0, 1.0));
  float hot = exp(-(a * a) / (0.17 * 0.17));
  float corona = 0.16 * exp(-(a * a) / (0.42 * 0.42));
  float spill = 0.004 * smoothstep(0.95, 0.6, a);
  // the faint rings of a cheap reflector
  float rings = 1.0 + 0.09 * sin(a * 58.0) * smoothstep(0.12, 0.3, a);
  return hot + (corona + spill) * rings;
}

const vec2 POISSON[5] = vec2[5](vec2(0.0, 0.0), vec2(-0.613, 0.617), vec2(0.645, 0.493), vec2(-0.499, -0.691), vec2(0.621, -0.627));

float torchShadow(vec3 P, vec3 N, vec3 l, float d) {
  vec3 Pb = P + N * (0.0012 + 0.0035 * d) + l * (0.002 + 0.004 * d);
  vec4 sc = uLightVP * vec4(Pb, 1.0);
  if (sc.w <= 0.0) return 1.0;
  vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 1.0;
  float a = hash12(gl_FragCoord.xy) * 6.2832;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  float r = 2.2 / uShadowRes;
  float sum = 0.0;
  for (int i = 0; i < 5; i++) sum += texture(uShadow, vec3(s.xy + R * POISSON[i] * r, s.z));
  return sum * 0.2;
}

struct Surf { vec3 alb; vec3 N; float rough; float f0; float ao; float trans; float glint; float near; };

vec3 torch(vec3 P, vec3 V, Surf s, vec3 Ng) {
  vec3 L = uLightPos - P;
  float d2 = dot(L, L), d = sqrt(d2);
  vec3 l = L / d;
  float ck = cookie(dot(-l, uLightDir));
  float sh = torchShadow(P, Ng, l, d);
  float ndl = dot(s.N, l);
  float diff = max(ndl, 0.0) + s.trans * max(-ndl, 0.0);
  vec3 H = normalize(l + V);
  float ndh = max(dot(s.N, H), 0.0), ndv = max(dot(s.N, V), 1e-3), ldh = max(dot(l, H), 0.0);
  float a = s.rough * s.rough, a2 = a * a;
  float dn = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dn * dn);
  float k = (s.rough + 1.0); k = k * k * 0.125;
  float nl = max(ndl, 0.0);
  float G = 1.0 / ((nl * (1.0 - k) + k) * (ndv * (1.0 - k) + k));
  float F = s.f0 + (1.0 - s.f0) * pow(1.0 - ldh, 5.0);
  float spec = D * G * F * 0.25 * nl;
  // mineral glints: a few grains that flash when the beam and the eye line up
  spec += s.glint * pow(ndh, 180.0) * 40.0 * nl;
  vec3 e = uLightCol * (uLightI * ck * sh / (d2 + 0.004 + s.near));
  return min(e * (s.alb / PI * diff * mix(1.0, s.ao, 0.35) + spec), vec3(600.0));
}

vec3 bounce(vec3 P, Surf s) {
  vec3 L = uBouncePos - P;
  float d2 = dot(L, L);
  float w = dot(s.N, L) * inversesqrt(d2 + 1e-6) * 0.5 + 0.5;
  return uBounceCol * s.alb * s.ao * (w * w) / (d2 + 0.3);
}

vec3 daylight(vec3 P, Surf s, float sky) {
  vec3 Lm = uMouth - P;
  float d2 = dot(Lm, Lm), d = sqrt(d2);
  // what gets in through the mouth is gone within a couple of body lengths
  float inside = (0.05 / (0.05 + d2)) * smoothstep(2.6, 0.4, d) * (0.2 + 0.8 * max(dot(s.N, Lm / d), 0.0));
  vec3 hemi = mix(uGround, uSky, s.N.y * 0.5 + 0.5) * 0.7 * s.ao;
  // overcast, but brighter over one shoulder: enough for the bank to have form
  hemi += vec3(1.0, 0.95, 0.86) * 0.85 * max(dot(s.N, normalize(vec3(-0.5, 0.62, 0.6))), 0.0) * mix(0.4, 1.0, s.ao);
  return s.alb * uDay * mix(uSky * inside * 1.4 * s.ao, hemi, sky);
}

vec3 shade(vec3 P, Surf s, vec3 Ng, float sky) {
  vec3 V = normalize(cameraPosition - P);
  return torch(P, V, s, Ng) + bounce(P, s) + daylight(P, s, sky);
}

// how many world metres one pixel covers here: octaves finer than that are faded out instead of sparkling
float footprint(vec3 P) { return length(fwidth(P)) * 0.7; }
float keep(float feature, float px) { return sat(feature / (px * 2.5) - 0.6); }
`;

const SOIL = /* glsl */ `
uniform sampler3D uCells;
vec4 cz(vec3 p) { return texture(uCells, p); }
// The noise volumes tile, and a wall shows it: the same lump every hand's breadth, in rows. So every octave looks at
// the ground through its own rotation, the middle ones twice over at scales that share no measure, and all of them
// through a warp from the octave below. Nothing lines up with anything, or with the wall.
const mat3 R1 = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
const mat3 R2 = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
const mat3 R3 = mat3(0.6, 0.0, 0.8, 0.48, 0.8, -0.36, -0.64, 0.6, 0.48);

float turfMask(vec3 P) {
  float t = clamp(P.z / 1.8, 0.0, 1.0);
  vec3 q = P - vec3(0.05 * t, -0.05 - 0.2 * t, 1.8 * t);
  q.y *= 0.8;
  return sat((length(q) - (0.62 + 0.25 * t + 0.2 * nz(P * 0.35).a)) / 0.25);
}
// the ground lies in layers (world.ts has the same two lines, and weathers the walls by them)
float strataY(vec3 P) { return P.y + 0.1 * sin(P.x * 1.3 + 0.7 * sin(P.z * 0.9)) + 0.07 * sin(P.z * 1.7 + P.x * 0.6); }
float band(float y, float c, float w) { return 1.0 - smoothstep(w * 0.4, w, abs(y - c)); }
// rounded lumps parted by creases, out of a noise that runs smoothly through zero
float billow(float h) { return sqrt(h * h + 0.02); }

Surf soil(vec3 P, vec3 N, float ao, float sky) {
  float px = footprint(P);
  float under = 1.0 - sky;
  vec4 wA = nz(R1 * P * 0.31 + 0.11), wB = nz(R2 * P * 0.19 + 0.57);
  vec4 n1 = nz(R3 * P * 1.9);
  vec3 Pw = P + (n1.rgb * R3) * 0.0028 + (wA.rgb * R1) * 0.006;

  // ---- where we are: what kind of ground this is ----
  float yy = strataY(P) + 0.035 * n1.a + 0.05 * wA.a;
  float top = max(smoothstep(-0.52, -0.28, yy), sky);                       // dark crumbly topsoil, the first stretch in
  float gravel = sat(band(yy, -0.93, 0.11) + 0.7 * band(yy, -0.36, 0.05) + sat(wB.a * 2.4 - 1.0)) * under; // stony seams and lenses
  float flr = smoothstep(0.45, 0.8, N.y) * under;                            // trodden: its own dust lies over whatever layer it cuts
  float steep = 1.0 - N.y * N.y;                                             // a layer shows as a line on a wall, as a smear on a ledge
  float sand = sat(band(yy, -0.69, 0.028) + band(yy, -1.2, 0.034)) * (1.0 - gravel) * (1.0 - 0.9 * flr) * (0.35 + 0.65 * steep) * under;                  // thin pale seams
  float damp = sat(smoothstep(-1.2, -1.6, yy) * 0.8 + sat(-wB.a * 2.4 - 0.9)) * under;                      // deep down, and in patches
  float clay = (1.0 - top) * (1.0 - sand);
  float cracked = clay * sat(wA.a * 2.2 - 0.2) * (1.0 - flr) * (1.0 - damp) * (1.0 - gravel);

  // ---- relief ----
  float k2 = keep(0.022, px), k3 = keep(0.0065, px), k4 = keep(0.0022, px), k5 = keep(0.0008, px);
  vec4 a2 = nz(R1 * Pw * 6.3), b2 = nz(R2 * Pw * 8.9 + 0.37);
  vec4 a3 = nz(R3 * Pw * 21.0 + 0.61), b3 = nz(R1 * Pw * 29.0 + 0.2);
  // (the finest octaves only exist within arm's reach: further off they are faded to nothing, so they are not fetched)
  vec4 n4 = vec4(0.0), n5 = vec4(0.0);
  if (k4 > 0.0) n4 = textureLod(uNoise, R2 * P * 67.0 + 0.23, 0.0);
  if (k5 > 0.0) n5 = textureLod(uNoise, R3 * P * 183.0 + 0.5, 0.0);
  float h2 = (a2.a + b2.a) * 0.7, h3 = (a3.a + b3.a) * 0.7;
  vec3 g2 = ((a2.rgb * R1) * 6.3 + (b2.rgb * R2) * 8.9) * 0.7;
  vec3 g3 = ((a3.rgb * R3) * 21.0 + (b3.rgb * R1) * 29.0) * 0.7;
  float c2 = billow(h2), c3 = billow(h3);
  // how lumpy, cloddy and crumbly each kind is; the floor is pressed flat, wet ground slumps smooth
  float even = (1.0 - 0.55 * flr) * (1.0 - 0.4 * damp);
  float A1 = mix(0.010, 0.006, sand);
  float A2 = (0.0046 * clay + 0.0068 * top + 0.003 * gravel) * (1.0 - 0.3 * sand) * even * k2;
  float A3 = (0.0021 * clay + 0.0032 * top + 0.0022 * gravel + 0.0012 * sand) * even * k3;
  float A4 = mix(0.0011, 0.0024, sand) * k4, A5 = mix(0.0004, 0.0009, sand) * k5; // sand is all grain
  vec3 g = A1 * 1.9 * (n1.rgb * R3) + A2 * (h2 / c2) * g2 + A3 * (h3 / c3) * g3 + A4 * 67.0 * (n4.rgb * R2) + A5 * 183.0 * (n5.rgb * R3);
  // the fine bedding inside a layer: thin level lines, laid down one at a time
  float lay = (clay * 0.8 + sand) * steep * steep * (1.0 - top);
  vec4 st = vec4(0.0);
  if (lay > 0.02) st = textureLod(uNoise, vec3(P.x * 1.7, yy * 31.0, P.z * 1.7) + 0.4, 0.0);
  g.y += 0.0011 * 31.0 * st.g * lay;

  // cells: stones each of their own, the cracks of clay drying, the holes of whatever lives in a wall
  vec4 cl = cz(R2 * Pw * 5.5 + 0.3), cs = vec4(1.0, 1.0, 1.0, 0.0), cc = vec4(1.0);
  if (keep(0.004, px) > 0.0) cs = textureLod(uCells, R1 * P * 15.0 + 0.1, 0.0);
  if (cracked > 0.01) cc = textureLod(uCells, R3 * Pw * 2.3, 0.0);
  float s1 = step(cl.b, 0.025 + 0.7 * gravel + 0.14 * flr + 0.04 * top) * keep(0.01, px);
  float q1 = cl.r / (0.2 + 0.2 * cl.a);
  float dome1 = sqrt(max(1.0 - q1 * q1, 0.0)) * s1;
  float s2 = step(cs.b, 0.02 + 0.5 * gravel + 0.16 * flr + 0.05 * top + 0.2 * sand) * keep(0.004, px);
  float q2 = cs.r / (0.22 + 0.2 * cs.a);
  float dome2 = sqrt(max(1.0 - q2 * q2, 0.0)) * s2;
  float crack = smoothstep(0.07, 0.01, cc.g) * cracked * keep(0.004, px);
  float pit = step(0.975, cs.a) * sat(wA.a * 3.0 + 0.6) * (1.0 - s2) * smoothstep(0.3, 0.16, cs.r) * (1.0 - flr) * (1.0 - sand) * keep(0.004, px)
            + step(0.965, cl.a) * (1.0 - s1) * smoothstep(0.26, 0.14, cl.r) * (1.0 - flr) * keep(0.008, px);
  pit = sat(pit) * under;
  float hW = 0.0055 * dome1 + 0.0022 * dome2 - 0.004 * crack - 0.006 * pit;
  // (their slope from the screen's own derivatives: the cells carry no gradient)
  vec3 dpx = dFdx(P), dpy = dFdy(P);
  vec3 e1 = cross(dpy, N), e2 = cross(N, dpx);
  float det = dot(dpx, e1);
  vec3 gW = (dFdx(hW) * e1 + dFdy(hW) * e2) * (sign(det) / (abs(det) + 1e-12));
  gW *= min(1.0, 2.5 / (length(gW) + 1e-5));

  Surf s;
  s.N = normalize(N - (g - N * dot(g, N)) - gW);

  // ---- colour ----
  float cav = sat(0.5 + 0.3 * n1.a + 0.45 * (c2 - 0.6) * k2 + 0.3 * (c3 - 0.6) * k3 + 0.2 * n4.a * k4);
  vec3 cClay = mix(vec3(0.135, 0.078, 0.04), vec3(0.165, 0.076, 0.036), sat(wA.a * 0.9 + 0.45));
  cClay = mix(cClay, vec3(0.25, 0.17, 0.095), sat(0.26 * smoothstep(0.55, 0.95, cav) + 0.14 * sat(st.a) * lay));
  vec3 cTop = mix(vec3(0.045, 0.027, 0.016), vec3(0.085, 0.05, 0.027), sat(n1.a * 0.8 + 0.5));
  vec3 cSand = vec3(0.2, 0.142, 0.08) * (0.8 + 0.3 * st.a + 0.25 * n4.a * k4);
  vec3 alb = mix(cClay, cTop, top);
  alb = mix(alb, vec3(0.19, 0.135, 0.082), gravel * 0.7 * (1.0 - top));
  alb = mix(alb, cSand, sand * 0.65);
  // where it never dries: darker, and greyed in patches where the iron has gone out of it
  alb = mix(alb, mix(alb, vec3(0.12, 0.115, 0.09), sat(wB.r * 0.12 + 0.3)) * 0.6, damp);
  alb = mix(alb, vec3(0.2, 0.135, 0.082), 0.3 * flr);
  alb *= mix(0.68, 1.1, cav) * (1.0 - 0.7 * crack) * (1.0 - 0.85 * pit);
  float dome = max(dome1, dome2);
  float hs = dome1 > 0.0 ? fract(cl.b * 13.7) : fract(cs.b * 17.3);
  vec3 sc = mix(vec3(0.14, 0.13, 0.115), vec3(0.19, 0.14, 0.088), smoothstep(0.2, 0.5, hs));
  sc = mix(sc, vec3(0.15, 0.075, 0.043), smoothstep(0.62, 0.72, hs));
  sc = mix(sc, vec3(0.27, 0.25, 0.21), smoothstep(0.92, 0.96, hs));
  float stone = smoothstep(0.02, 0.3, dome);
  alb = mix(alb, mix(sc, alb, 0.3 + 0.35 * (1.0 - dome)), stone);
  if (sky > 0.01) {
    // under the sky: weathered grey-brown, and a dark thatch wherever the grass has hold
    float turf = turfMask(P) * sky;
    alb = mix(alb, vec3(0.115, 0.085, 0.055) * (0.8 + 0.4 * cav), 0.7 * sky);
    vec3 thatch = mix(vec3(0.05, 0.045, 0.022), vec3(0.04, 0.062, 0.018), sat(n1.a + 0.4)) * (0.6 + 0.8 * cav);
    alb = mix(alb, thatch, turf * 0.85);
  }
  s.alb = alb;
  s.rough = mix(mix(0.97, 0.6, damp), 0.66, stone);
  s.f0 = mix(0.018 + 0.022 * damp, 0.04, stone);
  s.ao = ao * mix(0.55, 1.0, cav) * (1.0 - 0.6 * crack) * (1.0 - 0.8 * pit);
  s.trans = 0.0; s.near = 0.0;
  vec3 cell = floor(P * 1400.0);
  s.glint = step(0.992 - 0.012 * sand, hash13(cell)) * keep(0.0012, px);
  return s;
}
`;

const SOIL_VERT = /* glsl */ `
attribute float aAO;
attribute float aSky;
varying vec3 vP; varying vec3 vN; varying float vAO; varying float vSky;
void main() {
  vP = position; vN = normal; vAO = aAO; vSky = aSky;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`.replace('void main', 'invariant gl_Position;\nvoid main');

const SOIL_FRAG = COMMON + SOIL + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying float vAO; varying float vSky;
uniform float uFlat;
void main() {
  vec3 Ng = normalize(vN);
  Surf s = soil(vP, Ng, vAO, vSky);
  if (uFlat > 0.5) { s.near = 0.0; s.N = Ng; s.alb = vec3(0.18, 0.11, 0.065); s.rough = 0.9; s.glint = 0.0; s.ao = vAO; }
  gl_FragColor = vec4(shade(vP, s, Ng, vSky), 1.0);
}`;


// ---- stones: instanced, textured in their own space so the grain travels with them when they shift ----
const ROCK_VERT = /* glsl */ `
attribute float aTint;
attribute float aOpen;
attribute float aKind;
varying vec3 vP; varying vec3 vO; varying vec3 vNo; varying mat3 vR; varying float vTint; varying float vSky; varying float vDirt; varying float vKind;
void main() {
  // the small ones are mostly the colour of what they lie in
  mat3 M = mat3(instanceMatrix);
  float sc = length(M[0]);
  vR = M / sc;
  vO = position * sc + aTint * 17.0;
  vNo = normal;
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  vP = wp.xyz; vTint = aTint; vSky = aOpen; vKind = aKind; vDirt = 0.6 * smoothstep(0.07, 0.012, sc);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ROCK_FRAG = COMMON + /* glsl */ `
uniform sampler3D uCells;
varying vec3 vP; varying vec3 vO; varying vec3 vNo; varying mat3 vR; varying float vTint; varying float vSky; varying float vDirt; varying float vKind;
const mat3 Q1 = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
const mat3 Q2 = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
void main() {
  vec3 O = vO, No = normalize(vNo);
  float px = footprint(vP);
  // what it is made of: 0 granite, 1 sandstone, 2 slate, 3 quartz, 4 ironstone, 5 flint (rocks.ts)
  float kd = floor(vKind + 0.5);
  float sandst = float(kd == 1.0), slate = float(kd == 2.0), quartz = float(kd == 3.0), iron = float(kd == 4.0), flint = float(kd == 5.0);
  float gran = 1.0 - sandst - slate - quartz - iron - flint;
  vec4 n1 = nz(Q1 * O * 2.3 + 0.3), n2 = nz(Q2 * O * 8.1), n3 = nz(Q1 * O * 27.0 + 0.4), n4 = nz(Q2 * O * 83.0), n5 = nz(Q1 * O * 210.0 + 0.7);
  float k3 = keep(0.006, px), k4 = keep(0.002, px), k5 = keep(0.0008, px);
  // bedding, along the stone's own short axis: sandstone in coarse courses, slate in leaves
  float bed = sandst + slate;
  float lf = sandst * 46.0 + slate * 130.0 + 1.0;
  vec4 lam = nz(vec3(O.x * 2.5, O.y * lf, O.z * 2.5) + 0.2);
  // broken, not polished: chipped at every scale. Slate cleaves flat, quartz and flint break clean, sandstone is all grain
  float chip = 1.0 - 0.6 * slate - 0.45 * quartz - 0.3 * flint;
  float grain = 1.0 + 1.2 * sandst - 0.5 * quartz - 0.6 * flint;
  vec3 g = 0.007 * 2.3 * (n1.rgb * Q1) + chip * (0.0048 * 8.1 * (n2.rgb * Q2) + 0.0024 * 27.0 * (n3.rgb * Q1) * k3)
         + grain * (0.0009 * 83.0 * (n4.rgb * Q2) * k4 + 0.0003 * 210.0 * (n5.rgb * Q1) * k5);
  g.y += bed * lam.g * (sandst * 0.0011 * 46.0 + slate * 0.00045 * 130.0);
  vec4 c = texture(uCells, Q2 * O * 9.0);
  float pit = step(0.8 - 0.25 * iron, c.a) * smoothstep(0.32, 0.14, c.r) * keep(0.006, px) * (gran + iron + sandst);
  vec3 N = normalize(No - (g - No * dot(g, No)));
  Surf s;
  s.N = normalize(vR * N);
  vec3 Ng = normalize(vR * No);

  vec3 cGran = mix(mix(vec3(0.105, 0.095, 0.082), vec3(0.13, 0.095, 0.06), sat(vTint * 2.0)), vec3(0.055, 0.05, 0.044), sat(vTint * 2.0 - 1.0) * 0.7);
  cGran *= 0.8 + 0.35 * n1.a + 0.2 * n2.a;
  cGran = mix(cGran, cGran * 0.4, smoothstep(0.3, 0.6, n4.a) * k4 * 0.7);
  cGran = mix(cGran, vec3(0.2, 0.18, 0.15), smoothstep(0.4, 0.7, -n4.a) * k4 * 0.4);
  vec3 cSand = mix(vec3(0.16, 0.105, 0.055), vec3(0.215, 0.155, 0.085), vTint) * (0.78 + 0.4 * lam.a) * (0.9 + 0.2 * n4.a * k4);
  vec3 cSlate = mix(vec3(0.042, 0.047, 0.056), vec3(0.074, 0.076, 0.078), vTint) * (0.88 + 0.22 * lam.a);
  // milky, with clearer veins through it
  vec3 cQuartz = mix(vec3(0.25, 0.235, 0.205), vec3(0.28, 0.24, 0.185), vTint) * (0.8 + 0.3 * smoothstep(0.25, 0.0, abs(n2.a)));
  vec3 cIron = mix(vec3(0.125, 0.052, 0.026), vec3(0.165, 0.08, 0.034), vTint) * (0.8 + 0.4 * n2.a);
  cIron = mix(cIron, vec3(0.23, 0.13, 0.045), sat(n3.a * 1.5) * 0.4 * k3);
  // flint: a dark glassy heart wherever it has been chipped, a pale chalky rind everywhere else
  float heart = smoothstep(-0.05, 0.15, n1.a + 0.3 * n2.a);
  vec3 cFlint = mix(vec3(0.25, 0.24, 0.21), vec3(0.032, 0.033, 0.04), heart);
  vec3 base = gran * cGran + sandst * cSand + slate * cSlate + quartz * cQuartz + iron * cIron + flint * cFlint;

  // it came out of the ground and still wears it: caked on in patches, dusted on top, packed into every pit.
  // Less of it holds on what is smooth
  float up = sat(s.N.y * 0.6 + 0.4);
  float dirt = sat(0.25 + vDirt + 0.75 * smoothstep(-0.1, 0.5, n1.a + 0.5 * n2.a) + 0.35 * up + 0.3 * sat(-n3.a) * k3 + pit);
  dirt *= 1.0 - 0.3 * (quartz + flint * heart + slate);
  vec3 soilc = mix(vec3(0.12, 0.07, 0.036), vec3(0.17, 0.105, 0.055), sat(n2.a + 0.5));
  base = mix(base, soilc, dirt * 0.88);
  s.alb = max(base * (1.0 - 0.6 * pit), vec3(0.008));
  float rough = gran * 0.78 + sandst * 0.96 + slate * 0.58 + quartz * 0.42 + iron * 0.9 + flint * mix(0.92, 0.3, heart);
  s.rough = mix(rough, 0.96, dirt);
  s.f0 = mix(0.04 + 0.012 * quartz, 0.02, dirt);
  s.trans = 0.22 * quartz * (1.0 - dirt); s.near = 0.0;
  s.ao = (0.7 + 0.3 * sat(0.5 + n2.a)) * (1.0 - 0.6 * pit);
  s.glint = step(0.985 - 0.02 * quartz, hash13(floor(O * 1100.0))) * keep(0.0012, px) * (1.0 - dirt) * (gran + sandst * 0.6 + 2.0 * quartz);
  gl_FragColor = vec4(shade(vP, s, Ng, vSky), 1.0);
}`;

export function rockMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG });
}

// ---- woody roots: tubes, textured in the straightened space of the root so the bark runs along it ----
const ROOT_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aRad;
attribute float aAO;
attribute float aSeed;
varying vec3 vP; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vR; varying float vAO; varying float vSeed;
void main() {
  vP = position; vN = normal; vT = aTan; vUv = uv; vR = aRad; vAO = aAO; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const ROOT_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vR; varying float vAO; varying float vSeed;
void main() {
  vec3 N = normalize(vN), T = normalize(vT);
  float th = vUv.x * 6.2832, cs = cos(th), sn = sin(th);
  vec3 q = vec3(cs * vR, sn * vR, vUv.y) + vSeed * 3.7;
  float px = footprint(vP);
  vec3 sa = vec3(9.0, 9.0, 2.2), sb = vec3(34.0, 34.0, 8.0);
  vec4 a = nz(q * sa), b = nz(q * sb + 0.3), c = nz(q * vec3(22.0, 22.0, 9.0) + 0.6), d = nz(q * 75.0);
  float kb = keep(0.004, px), kd = keep(0.002, px);
  float crease = smoothstep(0.22, 0.0, abs(c.a));
  vec3 g = 0.0035 * a.rgb * sa + 0.0011 * b.rgb * sb * kb + 0.0005 * 75.0 * d.rgb * kd + c.rgb * sign(c.a) * crease * 0.1;
  vec3 B = cross(T, N);
  vec3 gw = (g.x * cs + g.y * sn) * N + (-g.x * sn + g.y * cs) * B + g.z * T;
  Surf s;
  s.N = normalize(N - (gw - N * dot(gw, N)));
  vec3 tanc = vec3(0.13, 0.07, 0.032), dark = vec3(0.045, 0.024, 0.012), pale = vec3(0.24, 0.15, 0.075);
  vec3 alb = mix(tanc, pale, sat(a.a * 0.8 + 0.3));
  alb = mix(alb, dark, crease * crease * 0.22 + 0.35 * sat(-a.a * 1.4));
  alb *= 0.85 + 0.3 * b.a * kb;
  // soil rubbed on where the root meets the wall
  alb = mix(vec3(0.14, 0.08, 0.038), alb, smoothstep(0.15, 0.7, vAO));
  s.alb = alb; s.rough = 0.8; s.f0 = 0.035; s.trans = 0.0; s.glint = 0.0; s.near = 0.02;
  s.ao = mix(0.35, 1.0, vAO) * (1.0 - 0.25 * crease);
  float sky = smoothstep(-0.5, 0.05, vP.z);
  gl_FragColor = vec4(shade(vP, s, N, sky), 1.0);
}`;

export function rootMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: ROOT_VERT, fragmentShader: ROOT_FRAG });
}

// ---- fine roots: ribbons that turn to whoever is looking (the eye, or the torch when it draws its shadow) ----
const HAIR_VERT = /* glsl */ `
attribute vec3 aTan;
attribute float aSide;
attribute float aW;
attribute float aSeed;
uniform float uPixel;
varying vec3 vP; varying vec3 vSideV; varying vec3 vEyeV; varying float vAcross; varying float vCover; varying float vSeed;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 toEye = cameraPosition - wp;
  float dist = length(toEye);
  toEye /= dist;
  vec3 side = normalize(cross(mat3(modelMatrix) * aTan, toEye) + vec3(1e-5, 0.0, 0.0));
  float w = max(aW, dist * uPixel * 1.05);
  vCover = aW / w;
  vP = wp + side * (aSide * w * 0.5);
  vSideV = side; vEyeV = toEye; vAcross = aSide; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;

const HAIR_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vSideV; varying vec3 vEyeV; varying float vAcross; varying float vCover; varying float vSeed;
uniform vec3 uHairA, uHairB;
void main() {
  float x = clamp(vAcross, -1.0, 1.0);
  vec3 N = normalize(vSideV * x + vEyeV * sqrt(max(1.0 - x * x, 0.02)));
  Surf s;
  s.N = N;
  s.alb = mix(uHairA, uHairB, fract(vSeed * 7.31)) * (0.8 + 0.4 * fract(vSeed * 3.17));
  s.rough = 0.7; s.f0 = 0.03; s.ao = 1.0; s.trans = 0.3; s.glint = 0.0; s.near = 0.09;
  float sky = smoothstep(-0.5, 0.05, vP.z);
  gl_FragColor = vec4(shade(vP, s, vEyeV, sky), vCover);
}`;

const HAIR_DEPTH_FRAG = /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`;

export function hairMaterial(pixel: { value: number }, a = new THREE.Vector3(0.09, 0.048, 0.022), b = new THREE.Vector3(0.24, 0.15, 0.075)) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uPixel: pixel, uHairA: { value: a }, uHairB: { value: b } }, vertexShader: HAIR_VERT, fragmentShader: HAIR_FRAG, side: THREE.DoubleSide, alphaToCoverage: true,
  });
}
export function hairDepthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: (2 * Math.tan((56 * Math.PI) / 180)) / SHADOW_RES } },
    vertexShader: HAIR_VERT, fragmentShader: HAIR_DEPTH_FRAG, side: THREE.DoubleSide, colorWrite: false,
  });
}


// ---- whoever lives here: a dark hide under the fur, and eyes that give the torch straight back ----
const HIDE_VERT = /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vO;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz; vN = mat3(modelMatrix) * normal; vO = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const HIDE_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vO;
uniform vec3 uNose;
void main() {
  vec3 N = normalize(vN);
  vec4 n1 = nz(vO * 9.0), n2 = nz(vO * 60.0 + 0.3);
  // the nose is bare, pebbled leather with a little wet on it
  float nose = smoothstep(0.04, 0.028, distance(vO, uNose));
  Surf s;
  vec3 g = n2.rgb * 60.0 * 0.0003 * nose;
  s.N = normalize(N - g);
  s.alb = mix(vec3(0.014, 0.011, 0.009) * (0.8 + 0.5 * n1.a), vec3(0.006, 0.0045, 0.004), nose);
  s.rough = mix(0.95, 0.82, nose); s.f0 = 0.02;
  s.ao = 1.0; s.trans = 0.0; s.glint = 0.0; s.near = 0.02;
  gl_FragColor = vec4(shade(vP, s, N, 0.0), 1.0);
}`;
export function hideMaterial(nose: THREE.Vector3) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uNose: { value: nose } }, vertexShader: HIDE_VERT, fragmentShader: HIDE_FRAG });
}

const EYE_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vO;
uniform vec3 uFwd; uniform float uOpen;
void main() {
  vec3 N = normalize(vN), Nl = normalize(vO);
  vec3 V = normalize(cameraPosition - vP);
  // the lid comes down from above
  float open = step(Nl.y, mix(-1.3, 0.8, uOpen));
  Surf s;
  s.N = N;
  s.alb = mix(vec3(0.022, 0.017, 0.014), vec3(0.01, 0.006, 0.004), open);
  s.rough = mix(0.9, 0.1, open); s.f0 = 0.05; s.ao = 1.0; s.trans = 0.0; s.glint = 0.0; s.near = 0.02;
  vec3 col = shade(vP, s, N, 0.0);
  // the tapetum: light that comes in along the line of sight goes back out along it
  vec3 L = uLightPos - vP;
  float d2 = dot(L, L);
  vec3 l = L * inversesqrt(d2);
  float pupil = smoothstep(0.45, 0.85, dot(Nl, uFwd));
  float retro = pow(max(dot(l, V), 0.0), 60.0);
  col += vec3(1.0, 0.84, 0.46) * (16.0 * pupil * retro * open * max(dot(N, V), 0.0) * uLightI * (cookie(dot(-l, uLightDir)) + 0.01) / (d2 + 0.8));
  gl_FragColor = vec4(col, 1.0);
}`;
export function eyeMaterial(fwd: THREE.Vector3, open: { value: number }) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uFwd: { value: fwd }, uOpen: open }, vertexShader: HIDE_VERT, fragmentShader: EYE_FRAG });
}

// ---- bedding: straw and leaves carried in, each a bent strip lying where it fell ----
const LITTER_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aDir;
attribute vec3 aUp;
attribute vec4 aShape; // length, width, curve, leaf
attribute vec2 aLook;  // seed, how exposed it is in the heap
varying vec3 vP; varying vec3 vN; varying float vX; varying float vT; varying float vLeaf; varying vec2 vLook;
void main() {
  float t = position.y, u = t - 0.5;
  vec3 side = normalize(cross(aDir, aUp));
  vec3 up = cross(side, aDir);
  vec3 c = aPos + aDir * (u * aShape.x) + up * (aShape.z * aShape.x * (0.25 - u * u));
  vec3 tang = aDir - up * (2.0 * aShape.z * u);
  float w = aShape.y * mix(1.0 - 0.7 * pow(abs(2.0 * u), 3.0), sin(3.14159 * pow(t, 0.8)), aShape.w);
  vP = c + side * (position.x * w);
  vN = cross(side, tang);
  vX = position.x * 2.0; vT = t; vLeaf = aShape.w; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;
const LITTER_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying float vX; varying float vT; varying float vLeaf; varying vec2 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float r1 = fract(vLook.x * 7.31), r2 = fract(vLook.x * 3.17);
  vec3 straw = mix(vec3(0.15, 0.11, 0.05), vec3(0.3, 0.24, 0.125), r1 * r1) * (0.5 + 0.5 * r2);
  vec3 leaf = mix(mix(vec3(0.115, 0.135, 0.085), vec3(0.20, 0.125, 0.065), smoothstep(0.3, 0.7, r1)), vec3(0.16, 0.07, 0.04), smoothstep(0.75, 1.0, r1));
  // a pale midrib, and the mottling of something dead for a while
  leaf *= 0.75 + 0.35 * nz(vP * 40.0).a;
  leaf = mix(leaf, leaf * 1.5 + 0.02, smoothstep(0.12, 0.03, abs(vX)));
  Surf s;
  s.N = N;
  s.alb = mix(straw, leaf, vLeaf);
  s.rough = 0.62; s.f0 = 0.04; s.trans = mix(0.35, 0.2, vLeaf); s.glint = 0.0; s.near = 0.02;
  s.ao = vLook.y;
  gl_FragColor = vec4(shade(vP, s, N, 0.0), 1.0);
}`;
export function litterMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: LITTER_VERT, fragmentShader: LITTER_FRAG, side: THREE.DoubleSide });
}
export function litterDepthMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: LITTER_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', side: THREE.DoubleSide, colorWrite: false });
}

// ---- what hangs in the air: motes in the beam, and the crumbs that come down ----
const MOTE_VERT = /* glsl */ `
precision highp sampler2DShadow;
attribute vec3 aSeed;
uniform sampler2DShadow uShadow;
uniform mat4 uLightVP;
uniform vec3 uLightPos, uLightDir, uLightCol, uMouth;
uniform float uLightI, uTime, uScale, uDay;
varying vec3 vCol; varying float vSoft;
float cookieV(float c) {
  float a = acos(clamp(c, -1.0, 1.0));
  return exp(-(a * a) / (0.17 * 0.17)) + 0.16 * exp(-(a * a) / (0.42 * 0.42));
}
void main() {
  const float BOX = 2.6;
  // an endless field that travels with the eye
  vec3 drift = vec3(sin(uTime * 0.11 + aSeed.y * 40.0) * 0.03, -uTime * 0.004 * (0.3 + aSeed.x), cos(uTime * 0.09 + aSeed.z * 40.0) * 0.03);
  vec3 P = (fract(aSeed + drift / BOX - cameraPosition / BOX) - 0.5) * BOX + cameraPosition;
  vec3 L = uLightPos - P;
  float d2 = dot(L, L);
  vec3 l = L * inversesqrt(d2);
  float e = uLightI * cookieV(dot(-l, uLightDir)) / (d2 + 0.01);
  vec4 sc = uLightVP * vec4(P, 1.0);
  vec3 sp = sc.xyz / sc.w * 0.5 + 0.5;
  if (sc.w > 0.0 && sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0) e *= texture(uShadow, sp);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  float dist = -mv.z;
  float size = (0.0006 + 0.0012 * fract(aSeed.x * 91.7)) * uScale / max(dist, 0.02);
  // close to the lens a mote is a soft disc of the same total light
  float blur = 1.0 + 3.0 * smoothstep(0.4, 0.05, dist);
  float ps = clamp(size * blur, 1.0, 9.0);
  float energy = size * size / (ps * ps);
  float dm = distance(P, uMouth);
  float day = uDay * 0.25 / (0.25 + dm * dm);
  vCol = (uLightCol * e + vec3(0.8, 0.9, 1.0) * day) * min(energy, 0.5) * 0.09 * smoothstep(0.08, 0.25, dist);
  vSoft = ps;
  gl_PointSize = ps;
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vCol; varying float vSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = smoothstep(1.0, mix(0.2, 0.8, clamp(vSoft / 20.0, 0.0, 1.0)), r);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

export function moteMaterial(scale: { value: number }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uScale: scale }, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

const CRUMB_VERT = /* glsl */ `
attribute vec4 aData; // size, seed, alive, dust
uniform float uScale;
varying vec3 vP; varying float vSeed; varying float vDust;
void main() {
  vP = position; vSeed = aData.y; vDust = aData.w;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = aData.z * clamp(aData.x * uScale / max(-mv.z, 0.02), 1.0, 40.0);
  gl_Position = projectionMatrix * mv;
}`;
const CRUMB_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying float vSeed; varying float vDust;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * 2.0;
  // a lumpy little silhouette, not a disc
  float ang = atan(c.y, c.x);
  float rr = length(c) / (0.72 + 0.2 * sin(ang * 3.0 + vSeed * 40.0) + 0.08 * sin(ang * 7.0 + vSeed * 90.0));
  if (rr > 1.0) discard;
  vec3 V = normalize(cameraPosition - vP);
  vec3 R = normalize(cross(V, vec3(0.0, 1.0, 0.0))), Uu = cross(R, V);
  Surf s;
  s.N = normalize(R * c.x * 0.9 - Uu * c.y * 0.9 + V * sqrt(max(1.0 - rr * rr, 0.05)));
  s.alb = mix(vec3(0.10, 0.055, 0.028), vec3(0.24, 0.14, 0.07), fract(vSeed * 13.7));
  s.rough = 0.95; s.f0 = 0.02; s.ao = 1.0; s.trans = 0.0; s.glint = 0.0; s.near = 0.03;
  gl_FragColor = vec4(shade(vP, s, V, 0.0), 1.0);
}`;

export function crumbMaterial(scale: { value: number }) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uScale: scale }, vertexShader: CRUMB_VERT, fragmentShader: CRUMB_FRAG });
}


// ---- grass: a blade is one arc, leaning away from its crown ----
const GRASS_VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aShape; // height, width, bend, heading
attribute vec2 aLook;  // tint, seed
uniform float uTime;
varying vec3 vP; varying vec3 vN; varying vec3 vSide; varying float vT; varying float vX; varying vec2 vLook;
void main() {
  float t = position.y;
  float bend = max(0.08, aShape.z + 0.12 * sin(uTime * 1.3 + aRoot.x * 2.7 + aRoot.z * 1.9 + aLook.y * 6.0) + 0.05 * sin(uTime * 3.1 + aLook.y * 40.0));
  vec3 d = vec3(cos(aShape.w), 0.0, sin(aShape.w));
  vec3 side = vec3(-d.z, 0.0, d.x);
  float a = bend * t;
  vec3 c = aRoot + (d * (1.0 - cos(a)) + vec3(0.0, sin(a), 0.0)) * (aShape.x / bend);
  vec3 tang = d * sin(a) + vec3(0.0, cos(a), 0.0);
  vP = c + side * (position.x * aShape.y * (1.0 - 0.9 * t * t));
  vN = cross(side, tang);
  vSide = side; vT = t; vX = position.x * 2.0; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;
const GRASS_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vSide; varying float vT; varying float vX; varying vec2 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 Ng = N;
  // folded along its midrib
  N = normalize(N + vSide * vX * 0.55 * (gl_FrontFacing ? 1.0 : -1.0));
  vec3 green = mix(vec3(0.045, 0.085, 0.018), vec3(0.085, 0.12, 0.03), vLook.x);
  vec3 straw = vec3(0.26, 0.21, 0.10);
  float dry = smoothstep(0.55, 0.95, vLook.x + 0.35 * fract(vLook.y * 7.7)) ;
  vec3 alb = mix(green, straw, max(dry, smoothstep(0.75, 1.0, vT) * 0.6));
  alb = mix(straw * 0.45, alb, smoothstep(0.0, 0.3, vT));
  alb *= 0.85 + 0.3 * fract(vLook.y * 13.3);
  Surf s;
  s.N = N; s.alb = alb; s.rough = 0.55; s.f0 = 0.04; s.trans = 0.55; s.glint = 0.0; s.near = 0.0;
  s.ao = mix(0.22, 1.0, smoothstep(0.0, 0.55, vT));
  gl_FragColor = vec4(shade(vP, s, Ng, 1.0), 1.0);
}`;
export function grassMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide });
}

export function soilMaterial(flat = false) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uFlat: { value: flat ? 1 : 0 } },
    vertexShader: SOIL_VERT,
    fragmentShader: SOIL_FRAG,
  });
}

/** The ground as depth only, through the very same vertex shader as its lit pass. */
export function soilDepthMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: SOIL_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', colorWrite: false });
}

/** Depth only, for the torch's shadow map. */
export function depthMaterial() {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false });
  m.side = THREE.DoubleSide;
  return m;
}

export { COMMON, SOIL };
