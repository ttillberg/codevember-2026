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
  /** world metres one pixel covers at one metre's distance (set on resize) */
  uPix: { value: 0.001 },
  /** the head, and the way it is going: what grows in the way is brushed aside by it */
  uWalker: { value: new THREE.Vector3(0, 9, 0) },
  uWalkDir: { value: new THREE.Vector3(0, 0, -1) },
  /** how much we are stirring what grows round us: 0 at rest, 1 at a run */
  uStir: { value: 0 },
  /** standing water: x, the level of its surface, z, reach (0: none) */
  uPuddle: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
  uRipple: { value: 0 },
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
  // (the lamp has a face a few centimetres across: right up against it the inverse square levels off)
  vec3 e = uLightCol * (uLightI * ck * sh / (d2 + 0.012 + s.near));
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
  vec3 c = torch(P, V, s, Ng) + bounce(P, s) + daylight(P, s, sky);
  if (sky > 0.0) {
    // the hillside has an end (the grid does), and its top is cut off flat: before it gets there it is lost in the
    // white of the day, the very colour of the sky, so there is no edge to see
    vec3 q = (P - uMouth) / vec3(3.0, 1.1, 1.5);
    if (q.z < 0.0) q.z *= 0.25;
    c = mix(c, vec3(0.93, 0.94, 0.96) * uDay, smoothstep(0.68, 1.0, length(q)) * sky);
  }
  return c;
}

// how many world metres one pixel covers here: octaves finer than that are faded out instead of sparkling
float footprint(vec3 P) { return length(fwidth(P)) * 0.7; }
float keep(float feature, float px) { return sat(feature / (px * 2.5) - 0.6); }
`;

const SOIL = /* glsl */ `
uniform sampler3D uCells;
uniform vec4 uPuddle[8];
uniform float uRipple;
// how much of this pixel is under standing water (soil() sets it, the fragment shader adds what the water mirrors)
float soilWater = 0.0;
float soilDepth = 0.0;
vec4 cz(vec3 p) { return texture(uCells, p); }
// The noise volumes tile, and a wall shows it: the same lump every hand's breadth, in rows. So every octave looks at
// the ground through its own rotation, the middle ones twice over at scales that share no measure, and all of them
// through a warp from the octave below. Nothing lines up with anything, or with the wall.
const mat3 R1 = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
const mat3 R2 = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
const mat3 R3 = mat3(0.6, 0.0, 0.8, 0.48, 0.8, -0.36, -0.64, 0.6, 0.48);

float turfMask(vec3 P) {
  vec3 q = P - vec3(0.0, -0.05, 0.0);
  q.y *= 0.8;
  return sat((length(q) - (0.3 + 0.1 * nz(P * 0.35).a)) / 0.2);
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
  // standing water: in a few bowls in the floor, up to a level. The floor's own lumps draw its shoreline
  float depth = -1.0;
  for (int i = 0; i < 8; i++) {
    vec4 q = uPuddle[i];
    if (q.w <= 0.0) continue;
    vec2 d = P.xz - q.xz;
    float rr = dot(d, d) / (q.w * q.w);
    if (rr < 1.0) depth = max(depth, (q.y - P.y) - 0.03 * smoothstep(0.6, 1.0, rr));
  }
  float water = smoothstep(0.0, 0.003, depth) * smoothstep(0.2, 0.6, N.y) * under;
  float mud = smoothstep(-0.022, 0.0, depth) * under; // the wet rim, a finger's width above the water
  soilWater = water; soilDepth = depth;
  float damp = sat(smoothstep(-1.2, -1.6, yy) * 0.8 + sat(-wB.a * 2.4 - 0.9) + mud) * under;                      // deep down, and in patches
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
  if (water > 0.0) {
    // the bed, seen through the water: everything on it is still there, wet, darker the deeper, a little murky,
    // its relief softened by the surface it is seen through
    alb *= mix(vec3(1.0), mix(vec3(0.6, 0.57, 0.48), vec3(0.3, 0.27, 0.2), sat(depth / 0.035)), water);
    s.N = normalize(mix(s.N, N, 0.55 * water));
  }
  s.alb = alb;
  s.rough = mix(mix(0.97, 0.6, damp), 0.66, stone);
  s.f0 = mix(0.018 + 0.022 * damp, 0.04, stone);
  s.ao = ao * mix(0.55, 1.0, cav) * (1.0 - 0.6 * crack) * (1.0 - 0.8 * pit);
  s.trans = 0.0; s.near = 0.0;
  vec3 cell = floor(P * 1400.0);
  // (each a round grain, soft at the edge: up close the bare cells were little squares)
  s.glint = step(0.992 - 0.012 * sand, hash13(cell)) * smoothstep(0.5, 0.22, length(fract(P * 1400.0) - 0.5)) * keep(0.0012, px) * (1.0 - water);
  s.f0 *= 1.0 - water; // (the shine is the surface's, added where the soil is drawn)
  return s;
}
`;

const SOIL_VERT = /* glsl */ `
attribute float aAO;
attribute float aSky;
attribute vec3 aGrow;
varying vec3 vP; varying vec3 vN; varying float vAO; varying float vSky; varying vec3 vGrow;
void main() {
  vP = position; vN = normal; vAO = aAO; vSky = aSky; vGrow = aGrow;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`.replace('void main', 'invariant gl_Position;\nvoid main');

const SOIL_FRAG = COMMON + SOIL + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying float vAO; varying float vSky; varying vec3 vGrow;
uniform float uFlat;
void main() {
  vec3 Ng = normalize(vN);
  Surf s = soil(vP, Ng, vAO, vSky);
  // what grows here stains the ground under it: the shells over it (growth.ts) are only the strands
  if (vGrow.x + vGrow.y + vGrow.z > 0.01) {
    float gp = 0.6 + 0.6 * nz(vP * 37.0).a;
    s.alb = mix(s.alb, vec3(0.014, 0.026, 0.007), sat(vGrow.x * 1.3) * 0.85);
    s.alb = mix(s.alb, s.alb * 0.6 + vec3(0.02, 0.012, 0.006), sat(vGrow.y) * 0.5);
    s.alb = mix(s.alb, vec3(0.19, 0.195, 0.18), sat(vGrow.z * gp) * 0.5);
    s.glint *= 1.0 - sat(vGrow.x + vGrow.z);
  }
  if (uFlat > 0.5) { s.near = 0.0; s.N = Ng; s.alb = vec3(0.18, 0.11, 0.065); s.rough = 0.9; s.glint = 0.0; s.ao = vAO; }
  vec3 col = shade(vP, s, Ng, vSky);
  if (soilWater > 0.0) {
    vec3 V = normalize(cameraPosition - vP);
    // all but flat: just enough unrest that the lamp's image is a soft spot and not a pin
    vec4 rp = nz(vec3(vP.x * 7.0, uTime * 0.12, vP.z * 7.0));
    float amp = 0.003 + 0.012 * uRipple;
    vec3 Nw = normalize(vec3(rp.r * amp, 1.0, rp.b * amp));
    // the meniscus: at the shore the surface climbs the bank, and that edge catches the light
    float rim = smoothstep(0.0035, 0.0, soilDepth);
    Nw = normalize(mix(Nw, Ng, 0.65 * rim));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(Nw, V), 0.0), 5.0);
    // The surface is a mirror, and the only light is the torch. So it shows two things. The lamp itself, from the
    // one angle where the surface sends it back to the eye: looking down into the water under our own nose. And,
    // at a flat angle, whatever of the roof beyond the torch happens to light. No patterns of light on it or off it.
    Surf w;
    float film = 0.35 + 0.65 * smoothstep(-0.25, 0.45, nz(vec3(vP.x * 5.0, uTime * 0.02, vP.z * 5.0)).a);
    w.alb = vec3(0.035, 0.027, 0.019) * film; w.N = Nw; w.rough = 0.1; w.f0 = 0.02; w.ao = 1.0; w.trans = 0.0; w.glint = 0.0; w.near = 0.0;
    vec3 top = torch(vP, V, w, Ng) + bounce(vP, w);
    vec3 R = reflect(-V, Nw);
    vec3 Q = vP + R * min(0.42 / max(R.y, 0.08), 2.5);
    vec3 L = uLightPos - Q;
    float d2 = dot(L, L);
    float e = uLightI * cookie(dot(-L * inversesqrt(d2), uLightDir)) / (d2 + 0.02);
    vec3 roof = uLightCol * vec3(0.14, 0.085, 0.045) * (e * 0.3);
    col = mix(col, col * (1.0 - F) * (1.0 - 0.2 * film) + top + roof * F, soilWater);
    // (faint, and broken: it shows where the bank happens to be turned right, not as a ring drawn round the puddle)
    vec3 Lp = uLightPos - vP;
    float dp2 = dot(Lp, Lp);
    float ep = uLightI * cookie(dot(-Lp * inversesqrt(dp2), uLightDir)) / (dp2 + 0.03);
    float shore = smoothstep(0.0, 0.001, soilDepth) * smoothstep(0.003, 0.0012, soilDepth);
    shore *= smoothstep(0.1, 0.6, nz(vec3(vP.x * 23.0, 0.3, vP.z * 23.0)).a + 0.25);
    col += uLightCol * (ep * shore * 0.014);
  }
  gl_FragColor = vec4(col, 1.0);
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
  vec3 cQuartz = mix(vec3(0.19, 0.18, 0.155), vec3(0.215, 0.185, 0.14), vTint) * (0.8 + 0.3 * smoothstep(0.25, 0.0, abs(n2.a)));
  vec3 cIron = mix(vec3(0.125, 0.052, 0.026), vec3(0.165, 0.08, 0.034), vTint) * (0.8 + 0.4 * n2.a);
  cIron = mix(cIron, vec3(0.23, 0.13, 0.045), sat(n3.a * 1.5) * 0.4 * k3);
  // flint: a dark glassy heart wherever it has been chipped, a pale chalky rind everywhere else
  float heart = smoothstep(-0.05, 0.15, n1.a + 0.3 * n2.a);
  vec3 cFlint = mix(vec3(0.17, 0.165, 0.145), vec3(0.032, 0.033, 0.04), heart);
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
  s.trans = 0.22 * quartz * (1.0 - dirt); s.near = 0.035;
  s.ao = (0.7 + 0.3 * sat(0.5 + n2.a)) * (1.0 - 0.6 * pit);
  s.glint = step(0.985 - 0.02 * quartz, hash13(floor(O * 1100.0))) * smoothstep(0.5, 0.22, length(fract(O * 1100.0) - 0.5)) * keep(0.0012, px) * (1.0 - dirt) * (gran + sandst * 0.6 + 2.0 * quartz);
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
attribute vec3 aGrow;
varying vec3 vP; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vR; varying float vAO; varying float vSeed; varying vec3 vGrow;
void main() {
  vP = position; vN = normal; vT = aTan; vUv = uv; vR = aRad; vAO = aAO; vSeed = aSeed; vGrow = aGrow;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const ROOT_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vT; varying vec2 vUv; varying float vR; varying float vAO; varying float vSeed; varying vec3 vGrow;
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
  // moss in the light, mould in the damp: the bark under the strands takes their colour
  alb = mix(alb, vec3(0.016, 0.03, 0.008), sat(vGrow.x * 1.3) * 0.8);
  alb = mix(alb, vec3(0.19, 0.195, 0.18), sat(vGrow.z * (0.6 + 0.6 * d.a)) * 0.45);
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
attribute float aRootD; // metres along the strand from where it comes out of the roof
uniform float uPixel;
varying vec3 vP; varying vec3 vSideV; varying vec3 vEyeV; varying float vAcross; varying float vCover; varying float vSeed; varying float vRootD;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 toEye = cameraPosition - wp;
  float dist = length(toEye);
  toEye /= dist;
  vec3 side = normalize(cross(mat3(modelMatrix) * aTan, toEye) + vec3(1e-5, 0.0, 0.0));
  float w = max(aW, dist * uPixel * 1.05);
  vCover = aW / w;
  vP = wp + side * (aSide * w * 0.5);
  vSideV = side; vEyeV = toEye; vAcross = aSide; vSeed = aSeed; vRootD = aRootD;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;

const HAIR_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vSideV; varying vec3 vEyeV; varying float vAcross; varying float vCover; varying float vSeed; varying float vRootD;
uniform vec3 uHairA, uHairB;
void main() {
  float x = clamp(vAcross, -1.0, 1.0);
  vec3 N = normalize(vSideV * x + vEyeV * sqrt(max(1.0 - x * x, 0.02)));
  Surf s;
  s.N = N;
  s.alb = mix(uHairA, uHairB, fract(vSeed * 7.31)) * (0.8 + 0.4 * fract(vSeed * 3.17));
  s.rough = 0.7; s.f0 = 0.03; s.ao = 1.0; s.trans = 0.3; s.glint = 0.0; s.near = 0.09;
  float sky = smoothstep(-0.5, 0.05, vP.z);
  // where it comes out of the roof it is in the roof's shadow: dark for its first centimetre, so that it grows out of
  // the earth and is not stuck on it
  gl_FragColor = vec4(shade(vP, s, vEyeV, sky) * mix(0.22, 1.0, smoothstep(0.0, 0.012, vRootD)), vCover);
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
  s.rough = 0.95; s.f0 = 0.02; s.ao = 1.0; s.trans = 0.0; s.glint = 0.0; s.near = 0.08;
  gl_FragColor = vec4(shade(vP, s, V, 0.0), 1.0);
}`;

export function crumbMaterial(scale: { value: number }) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uScale: scale }, vertexShader: CRUMB_VERT, fragmentShader: CRUMB_FRAG });
}



// ---- what grows: shells (after day 16's moss) and the strands that hang from the roof ----
const SHELL_VERT = /* glsl */ `
attribute vec3 aGrow; // moss, root felt, mould
attribute float aAO;
attribute float aSky;
uniform float uScale, uPix;
uniform vec3 uWalker;
varying vec3 vP; varying vec3 vBase; varying vec3 vN; varying vec3 vGrow; varying float vT; varying float vAO; varying float vSky;
void main() {
  // the outermost layer is drawn first: what it covers of the layers under it is never shaded.
  // (And never the surface itself: that is the ground's own, stained.)
  float t = 1.0 - float(gl_InstanceID) / float(SHELLS);
  // how tall each grows: a moss cushion a couple of centimetres, root hair a hand's breadth, mould a few millimetres.
  // (Thin growth is short, but not in proportion: its edge is still a pile, not a film.)
  vec3 gw = pow(max(aGrow, vec3(0.0)), vec3(0.6));
  float far0 = distance(position, cameraPosition);
  // (grown in between three metres and two: nothing pops, and past three it is thrown out)
  float h = max(max(gw.x * 0.026, gw.y * mix(0.05, 0.075, clamp(-normal.y, 0.0, 1.0))), gw.z * 0.012) * uScale * smoothstep(3.0, 2.0, far0);
  vec3 p = position + normal * (h * t);
  // root hair hangs
  p.y -= gw.y * 0.03 * uScale * t * t;
  // and all of it gives way to the head
  vec3 dw = p - uWalker;
  float dist = length(dw);
  p += (dw / max(dist, 1e-4)) * (smoothstep(0.36, 0.1, dist) * t * t * h * 1.6);
  vP = p; vBase = position; vN = normal; vGrow = aGrow; vT = t; vAO = aAO; vSky = aSky;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  // The layers are most of what this costs, so whole triangles are thrown out here, before a pixel is touched:
  // where nothing grows; where the strands would be finer than a pixel (only the low nap is kept); past three metres
  float far = distance(p, cameraPosition);
  float px = far * uPix * 0.7;
  float top = mix(0.3, 1.01, clamp(0.005 / (px * 2.5) - 0.6, 0.0, 1.0));
  if (h < 1e-5 || t > top || far > 3.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const SHELL_FRAG = COMMON + /* glsl */ `
uniform sampler3D uCells;
const mat3 S1 = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
const mat3 S2 = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
varying vec3 vP; varying vec3 vBase; varying vec3 vN; varying vec3 vGrow; varying float vT; varying float vAO; varying float vSky;
// lit like everything else, but cheaply: one tap of the shadow map, no gloss. There are many layers of this.
vec3 shadeFuzz(vec3 P, Surf s, vec3 Ng, float sky) {
  vec3 L = uLightPos - P;
  float d2 = dot(L, L), d = sqrt(d2);
  vec3 l = L / d;
  float ck = cookie(dot(-l, uLightDir));
  float sh = 1.0;
  vec4 sc = uLightVP * vec4(P + Ng * (0.0012 + 0.0035 * d) + l * (0.002 + 0.004 * d), 1.0);
  if (sc.w > 0.0) {
    vec3 q = sc.xyz / sc.w * 0.5 + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z < 1.0) sh = texture(uShadow, q);
  }
  float ndl = dot(s.N, l);
  vec3 e = uLightCol * (uLightI * ck * sh / (d2 + 0.012 + s.near));
  return min(e * s.alb / PI * (max(ndl, 0.0) + s.trans * max(-ndl, 0.0)) * mix(1.0, s.ao, 0.35), vec3(600.0)) + bounce(P, s) + daylight(P, s, sky);
}
void main() {
  vec3 g = vGrow;
  float gm = max(g.x, max(g.y, g.z));
  if (gm < 0.1) discard;
  float uu = vT;
  float moss = step(g.y, g.x) * step(g.z, g.x);
  float mould = (1.0 - moss) * step(g.y, g.z);
  float felt = 1.0 - moss - mould;
  vec3 Ng = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  // Day 05's fuzz: the pile is a noise on the surface it grows from, the same noise in every layer, and a layer
  // keeps only what is denser than a bar that rises with it. Low down nearly everything passes, a dense nap;
  // at the top only the peaks are left, the tips. And the sample point leans as it goes up, so strands curve
  // instead of standing in columns that would show the layers as lines.
  // Most of what the layers cost is this test, run for every layer over every pixel they cover, and most of the time
  // it says no. So the bar is worked out first, and each noise is only fetched if the ones before it, with the most
  // the rest could possibly add, might still clear it. The same pixels are kept, exactly; fewer fetches are made.
  // (The noise's value is within 1.75 of zero, so each of the two terms is at most 1.375; the cells' at most 0.25.)
  float bar = moss * 0.3 + felt * 0.4 + mould * 0.27;
  // (thinner where the growth is thin, and thinner seen edge on, where the layers would line up)
  float need = bar + 0.55 * uu + (1.0 - gm) * 0.35 + 0.3 * uu * (1.0 - abs(dot(Ng, V)));
  if (need > 1.375 * 0.75 + 0.25) discard;
  vec3 lean = textureLod(uNoise, S1 * vBase * 9.0, 0.0).rgb * 0.0011;
  lean.y -= felt * 0.006;
  vec3 q = vBase + lean * uu * uu;
  float fs = moss + felt * 0.8 + mould * 2.2;
  // (root hair runs long: its noise is stretched along the way it hangs)
  vec3 qs = q * vec3(1.0, mix(1.0, 0.3, felt), 1.0);
  float coarse = 0.5 + 0.5 * textureLod(uNoise, S1 * qs * 24.0 * fs, 0.0).a;
  if (coarse * 0.45 + 1.375 * 0.3 + 0.25 < need) discard;
  float mid = 0.5 + 0.5 * textureLod(uNoise, S2 * qs * 64.0 * fs + 0.37, 0.0).a;
  if (coarse * 0.45 + mid * 0.3 + 0.25 < need) discard;
  vec4 c = textureLod(uCells, S2 * qs * 62.0 * fs, 0.0);
  float dens = coarse * 0.45 + mid * 0.3 + (1.0 - c.r * 1.4) * 0.25;
  if (dens < need) discard;
  // dark down in the pile, lit at the tips; each tuft a little its own colour
  float own = c.a;
  vec3 cm = mix(vec3(0.008, 0.018, 0.004), mix(vec3(0.045, 0.1, 0.018), vec3(0.085, 0.105, 0.025), own), uu * uu);
  cm = mix(cm, vec3(0.14, 0.11, 0.035), step(0.93, c.b) * uu); // a dead tip here and there
  vec3 cf = mix(vec3(0.05, 0.03, 0.015), mix(vec3(0.2, 0.125, 0.065), vec3(0.32, 0.22, 0.12), own), uu);
  float blot = nz(vBase * 2.6 + 0.4).a;
  vec3 cu = mix(vec3(0.13, 0.13, 0.12), mix(vec3(0.42, 0.43, 0.4), vec3(0.26, 0.36, 0.33), sat(blot * 1.6 - 0.2)), uu);
  cu = mix(cu, vec3(0.4, 0.36, 0.19), sat(-blot * 1.8 - 0.5) * uu);
  Surf s;
  s.alb = moss * cm + felt * cf + mould * cu;
  s.N = normalize(Ng + lean * 160.0 * uu);
  s.rough = 0.8; s.f0 = 0.03; s.ao = vAO * mix(0.25, 1.0, uu); s.trans = 0.35; s.glint = 0.0; s.near = 0.03;
  gl_FragColor = vec4(shadeFuzz(vP, s, Ng, vSky), 1.0);
}`;
export function shellMaterial(layers: number, scale = 1) {
  return new THREE.ShaderMaterial({ defines: { SHELLS: layers }, uniforms: { ...U, uScale: { value: scale } }, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG });
}

const TUFT_VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec3 aDir;
attribute vec4 aShape; // length, width, curl, kind (0 root hair, 1 moss, 2 mould, 3 dead grass)
attribute vec2 aLook;
uniform float uTime;
uniform vec3 uWalker, uWalkDir;
varying vec3 vP; varying vec3 vN; varying float vT; varying float vKind; varying vec2 vLook;
void main() {
  float t = position.y;
  // only what is near is drawn at all: past two metres a strand is thrown out here, before a pixel is touched
  // (it would be finer than one anyway), and between there and a metre and a half it grows in, so nothing pops
  float far = distance(aRoot, cameraPosition);
  float show = smoothstep(2.0, 1.4, far);
  float len = aShape.x * show;
  vec3 d = normalize(aDir);
  vec3 side = normalize(cross(d, vec3(sin(aLook.x * 40.0), 0.3, cos(aLook.x * 40.0))));
  vec3 fwd = cross(side, d);
  // out of the roof the way it grew, then down: it hangs
  vec3 c = aRoot + d * (len * t * (1.0 - 0.5 * t)) + vec3(0.0, -1.0, 0.0) * (len * 0.5 * t * t) + fwd * (aShape.z * len * t * t);
  // the air down here barely moves, but it moves
  float sw = sin(uTime * 1.1 + aLook.x * 37.0 + aRoot.x * 2.3) * 0.1 + sin(uTime * 2.7 + aLook.x * 91.0) * 0.03;
  c += side * (sw * len * t * t);
  // brushed aside by the head, as day 16's grass is by the crawler: parted left and right of the way we go and
  // dragged a little along it, the root staying put, and nothing left hanging in the lens
  vec3 dw = c - uWalker;
  float dist = length(dw);
  float push = smoothstep(0.3, 0.06, dist) * t * t;
  if (push > 0.001) {
    vec3 right = normalize(cross(uWalkDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 dir = normalize(dw / max(dist, 1e-4) * 0.5 + right * clamp(dot(dw, right) / 0.07, -1.0, 1.0) * 0.9 + uWalkDir * 0.5);
    c += dir * (push * min(len * 0.9, 0.16));
    vec3 out2 = c - uWalker;
    float d2 = length(out2);
    if (d2 < 0.1) c = uWalker + out2 * (0.1 / max(d2, 1e-4));
  }
  vP = c + side * (position.x * aShape.y * (1.0 - 0.75 * t));
  vN = fwd;
  vT = t; vKind = aShape.w; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  if (show <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const TUFT_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying float vT; varying float vKind; varying vec2 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float k = floor(vKind + 0.5);
  vec3 hair = mix(vec3(0.11, 0.065, 0.032), vec3(0.3, 0.2, 0.11), vLook.y);
  vec3 moss = mix(vec3(0.02, 0.045, 0.01), vec3(0.075, 0.12, 0.03), vLook.y) * mix(0.7, 1.2, vT);
  vec3 mould = mix(vec3(0.28, 0.285, 0.265), vec3(0.46, 0.47, 0.44), vLook.y);
  vec3 straw = mix(vec3(0.2, 0.155, 0.075), vec3(0.32, 0.26, 0.14), vLook.y);
  Surf s;
  // (4: the moss-like stuff of the dark, olive going to brown)
  vec3 dusk = mix(vec3(0.03, 0.032, 0.012), vec3(0.085, 0.075, 0.03), vLook.y) * mix(0.7, 1.25, vT);
  s.alb = k < 0.5 ? hair : k < 1.5 ? moss : k < 2.5 ? mould : k < 3.5 ? straw : dusk;
  s.N = N; s.rough = 0.7; s.f0 = 0.03; s.ao = mix(0.5, 1.0, vT); s.trans = 0.4; s.glint = 0.0; s.near = 0.07;
  float sky = smoothstep(-0.5, 0.05, vP.z);
  // (the same at the root of every strand: its first few millimetres are the dark of the roof it comes out of)
  gl_FragColor = vec4(shade(vP, s, N, sky) * mix(0.22, 1.0, smoothstep(0.0, 0.1, vT)), 1.0);
}`;
export function tuftMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: TUFT_VERT, fragmentShader: TUFT_FRAG, side: THREE.DoubleSide });
}

// ---- grass: a blade is one arc, leaning away from its crown ----
const GRASS_VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aShape; // height, width, bend, heading
attribute vec2 aLook;  // tint, seed
uniform float uTime, uStir;
uniform vec3 uWalker, uWalkDir;
varying vec3 vP; varying vec3 vN; varying vec3 vSide; varying float vT; varying float vX; varying vec2 vLook;
void main() {
  float t = position.y;
  // nearly still while we are; our going through it sets what is round us shaking
  float stir = uStir * smoothstep(1.5, 0.25, distance(aRoot, uWalker));
  float bend = max(0.08, aShape.z + (0.055 + 0.12 * stir) * sin(uTime * 1.0 + aRoot.x * 2.7 + aRoot.z * 1.9 + aLook.y * 6.0) + (0.02 + 0.07 * stir) * sin(uTime * 2.3 + aLook.y * 40.0) + 0.09 * stir * sin(uTime * 5.7 + aLook.y * 23.0));
  vec3 d = vec3(cos(aShape.w), 0.0, sin(aShape.w));
  vec3 side = vec3(-d.z, 0.0, d.x);
  float a = bend * t;
  vec3 c = aRoot + (d * (1.0 - cos(a)) + vec3(0.0, sin(a), 0.0)) * (aShape.x / bend);
  vec3 tang = d * sin(a) + vec3(0.0, cos(a), 0.0);
  // brushed aside as we come through: parted left and right of the way we go, the root staying where it is
  vec3 dw = c - uWalker;
  float dist = length(dw);
  float push = smoothstep(0.34, 0.06, dist) * t * t;
  if (push > 0.001) {
    vec3 right = normalize(cross(uWalkDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 dir = normalize(dw / max(dist, 1e-4) * 0.5 + right * clamp(dot(dw, right) / 0.07, -1.0, 1.0) * 0.9 + uWalkDir * 0.4);
    c += dir * push * min(aShape.x * 0.8, 0.2);
    c.y -= push * push * aShape.x * 0.3;
  }
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

// ---- herbs and flowers by the mouth: every instance one strip of one plant, its stem, a leaf or a petal ----
const HERB_VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aStem; // height, bend, heading, seed
attribute vec4 aPart; // where up the stem it sits (below 0: it is the stem), length, width, angle round the stem
attribute vec4 aLook; // colour, kind (0 stem, 1 leaf, 2 petal, 3 the middle of a flower)
uniform float uTime, uStir;
uniform vec3 uWalker, uWalkDir;
varying vec3 vP; varying vec3 vN; varying vec3 vSide; varying float vT; varying float vX; varying float vAO; varying vec4 vLook;
void main() {
  float t = position.y;
  float H = aStem.x;
  float stir = uStir * smoothstep(1.5, 0.25, distance(aRoot, uWalker));
  float bend = max(0.08, aStem.y + (0.05 + 0.11 * stir) * sin(uTime * 1.0 + aRoot.x * 2.7 + aRoot.z * 1.9 + aStem.w * 6.0) + (0.018 + 0.06 * stir) * sin(uTime * 2.3 + aStem.w * 40.0) + 0.08 * stir * sin(uTime * 5.7 + aStem.w * 23.0));
  vec3 d = vec3(cos(aStem.z), 0.0, sin(aStem.z));
  vec3 side = vec3(-d.z, 0.0, d.x);
  // the stem is one arc, as a blade of grass is; a leaf or a flower rides on its point of it
  float ts = aPart.x < 0.0 ? t : aPart.x;
  float a = bend * ts;
  vec3 c = aRoot + (d * (1.0 - cos(a)) + vec3(0.0, sin(a), 0.0)) * (H / bend);
  vec3 tang = d * sin(a) + vec3(0.0, cos(a), 0.0);
  // brushed aside with the grass
  vec3 dw = c - uWalker;
  float dist = length(dw);
  float push = smoothstep(0.34, 0.06, dist) * ts * ts;
  if (push > 0.001) {
    vec3 right = normalize(cross(uWalkDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 dir = normalize(dw / max(dist, 1e-4) * 0.5 + right * clamp(dot(dw, right) / 0.07, -1.0, 1.0) * 0.9 + uWalkDir * 0.4);
    c += dir * push * min(H * 0.8, 0.2);
    c.y -= push * push * H * 0.3;
  }
  vec3 ws = side;
  float w = aPart.z * (1.0 - 0.5 * t);
  float kind = aLook.w;
  if (aPart.x >= 0.0) {
    // out from the stem at its own angle round it and a little along it, then curling back
    vec3 o = cos(aPart.w) * side + sin(aPart.w) * cross(tang, side);
    float spread = kind > 2.5 ? 0.4 : kind > 1.5 ? 0.9 : 0.72;
    float droop = kind > 1.5 ? 0.12 : 0.5;
    vec3 e = normalize(o * spread + tang * (1.0 - spread));
    c += e * (aPart.y * t) - tang * (aPart.y * droop * t * t);
    vec3 et = normalize(e - tang * (2.0 * droop * t));
    ws = normalize(cross(et, tang));
    tang = et;
    w = aPart.z * sin(3.14159 * pow(t, kind > 1.5 ? 1.3 : 0.8));
  }
  vP = c + ws * (position.x * w);
  vN = cross(ws, tang);
  vSide = ws; vT = t; vX = position.x * 2.0; vLook = aLook;
  vAO = mix(0.5, 1.0, smoothstep(0.0, 0.08, c.y - aRoot.y));
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;
const HERB_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vSide; varying float vT; varying float vX; varying float vAO; varying vec4 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 Ng = N;
  float k = vLook.w;
  vec3 alb = vLook.rgb;
  Surf s;
  s.trans = 0.5;
  if (k < 0.5) alb *= mix(0.6, 1.0, vT);
  else if (k < 1.5) {
    // a leaf: folded along a paler midrib
    N = normalize(N + vSide * vX * 0.45 * (gl_FrontFacing ? 1.0 : -1.0));
    alb = mix(alb, alb * 1.5 + 0.01, smoothstep(0.14, 0.03, abs(vX)));
  } else {
    // a petal: thin, the day comes through it; darker into the throat
    alb *= mix(0.7, 1.0, smoothstep(0.0, 0.5, vT));
    s.trans = 0.75;
  }
  s.N = N; s.alb = alb; s.rough = 0.5; s.f0 = 0.04; s.glint = 0.0; s.near = 0.0; s.ao = vAO;
  gl_FragColor = vec4(shade(vP, s, Ng, 1.0), 1.0);
}`;
export function herbMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: HERB_VERT, fragmentShader: HERB_FRAG, side: THREE.DoubleSide });
}

// ---- wax caps: a stem and a cap turned on a lathe, out of the wall and then up ----
const FUNGUS_VERT = /* glsl */ `
attribute vec3 aProf;  // 0 stem, 1 gills, 2 the skin of the cap; radius; height (each in its own measure)
attribute vec2 aPn;    // the profile's normal: outwards, along the axis
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec4 aShape; // height, cap radius, stem radius, how tall the cap is to its radius
attribute vec4 aLook;  // colour, seed
varying vec3 vP; varying vec3 vN; varying vec3 vK; varying vec2 vXZ; varying vec4 vLook;
void main() {
  // small things: past four metres they are not drawn at all
  float show = smoothstep(4.0, 3.2, distance(aPos, cameraPosition));
  vec3 n0 = normalize(aNrm);
  // they grow towards up, each a little off it
  vec3 upv = normalize(vec3(sin(aLook.w * 50.0) * 0.3, 1.0, cos(aLook.w * 31.0) * 0.3));
  vec3 B = cross(n0, upv);
  float bl = length(B);
  B = bl > 0.05 ? B / bl : normalize(cross(upv, vec3(1.0, 0.0, 0.3)));
  float h = aShape.x * show, cr = aShape.y * show, sr = aShape.z * show;
  float cap = step(0.5, aProf.x);
  float t = mix(aProf.z, 1.0, cap);
  vec3 T = normalize(mix(n0, upv, t));
  vec3 c = aPos - n0 * 0.004 + (n0 * (t - 0.5 * t * t) + upv * (0.5 * t * t)) * h;
  vec3 Z = cross(T, B);
  vec3 radial = B * position.x + Z * position.z;
  // no cap is round
  float oval = 1.0 + 0.1 * ((position.x * position.x - position.z * position.z) * sin(aLook.w * 77.0) + 2.0 * position.x * position.z * cos(aLook.w * 77.0));
  float r = mix(sr * aProf.y, cr * aProf.y * oval, cap);
  c += T * (cap * cr * aShape.w * aProf.z);
  vP = c + radial * r;
  vN = mix(radial, normalize(radial * (aPn.x * aShape.w) + T * aPn.y), cap);
  vK = aProf; vXZ = position.xz; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  if (show <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FUNGUS_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vK; varying vec2 vXZ; varying vec4 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float th = atan(vXZ.y, vXZ.x);
  vec3 col = vLook.rgb;
  vec3 pale = mix(col, vec3(0.56, 0.54, 0.48), 0.6);
  // the stem: paler than the cap, a little dirty at the foot
  vec3 stem = mix(vec3(0.36, 0.33, 0.27), pale, smoothstep(0.0, 0.5, vK.z));
  // the gills: thick, far apart, waxy
  vec3 gills = pale * (0.62 + 0.38 * smoothstep(-0.2, 0.6, sin(th * 30.0)));
  // the skin: deepest on the crown, thinning to the colour of the gills at the rim, where it is lined
  vec3 skin = col * mix(1.0, 0.72, smoothstep(0.55, 1.0, vK.z));
  float rim = smoothstep(0.4, 0.06, vK.z);
  skin = mix(skin, pale, rim * 0.45) * (1.0 - 0.14 * rim * sin(th * 30.0));
  float k = vK.x;
  Surf s;
  s.alb = k < 1.0 ? mix(stem, gills, sat(k)) : mix(gills, skin, sat(k - 1.0));
  s.N = N;
  // waxy and wet: the lamp sits on the cap as a highlight
  s.rough = mix(0.42, 0.2, sat(k - 1.0)); s.f0 = 0.045; s.trans = 0.3; s.glint = 0.0; s.near = 0.03;
  s.ao = k < 1.0 ? mix(mix(0.45, 0.95, smoothstep(0.0, 0.4, vK.z)), 0.5, sat(k)) : mix(0.5, 1.0, sat(k - 1.0));
  gl_FragColor = vec4(shade(vP, s, N, 0.0), 1.0);
}`;
export function fungusMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: FUNGUS_VERT, fragmentShader: FUNGUS_FRAG, side: THREE.DoubleSide });
}
export function fungusDepthMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: FUNGUS_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', side: THREE.DoubleSide, colorWrite: false });
}

// ---- the beast (model/beast.py): a skinned hide, and its wiry fur as shells of the same skinned mesh ----
const BEAST_VERT = /* glsl */ `
attribute vec4 color;
attribute float _fur;
uniform float uShell; // 0: the hide itself. Above: how far up the fur this layer is
#include <skinning_pars_vertex>
varying vec3 vP; varying vec3 vN; varying vec3 vRest; varying vec3 vCol; varying float vFur;
void main() {
  vec3 objectNormal = normal;
  vec3 transformed = position + normal * (uShell * 0.024 * _fur);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  wp.y -= uShell * uShell * 0.009 * _fur; // it hangs
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * objectNormal);
  vRest = position; vCol = color.rgb; vFur = _fur;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAST_FRAG = COMMON + /* glsl */ `
uniform sampler3D uCells;
uniform float uShell;
uniform vec4 uPart; // roughness, f0, how much light comes through, kind (0 skin, 1 hide under fur, 2 mouth, 3 teeth, 4 claws, 5 eye)
uniform float uEyes; // a light of their own in its eyes: for the dark after it has had us
varying vec3 vP; varying vec3 vN; varying vec3 vRest; varying vec3 vCol; varying float vFur;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float kind = uPart.w;
  vec3 alb = vCol;
  Surf s;
  s.rough = uPart.x; s.f0 = uPart.y; s.trans = uPart.z; s.glint = 0.0; s.ao = 1.0;
  // (it is seen from a hand's breadth, in the lamp: the inverse square is levelled off a good deal)
  s.near = 0.1;
  if (uShell > 0.0) {
    // wiry fur: each strand a cell in the hide's own space, the same cell in every layer, thinning to its tip
    vec4 c = texture(uCells, vRest * 42.0);
    if (vFur < 0.2 || 1.0 - c.r * 2.3 < uShell * 0.95 + (1.0 - vFur) * 0.5) discard;
    alb = mix(vec3(0.012, 0.01, 0.008), mix(vec3(0.06, 0.047, 0.034), vec3(0.17, 0.14, 0.105), c.b), uShell * uShell);
    s.ao = mix(0.3, 1.0, uShell); s.rough = 0.6; s.trans = 0.4;
  } else if (kind < 0.5) {
    // bald and scaly: pebbled, every scale a cell with a dark seam round it
    vec4 c = texture(uCells, vRest * 17.0);
    float seam = smoothstep(0.0, 0.13, c.g);
    alb *= mix(0.4, 1.0, seam) * (0.75 + 0.5 * c.b);
    s.rough = mix(0.8, 0.42, seam);
    s.ao = mix(0.55, 1.0, seam);
  } else if (kind < 1.5) {
    alb *= 0.6;
  } else if (kind < 2.5) {
    // wet
    alb *= 0.85 + 0.3 * nz(vRest * 60.0).a;
  }
  s.alb = alb; s.N = N;
  // its hide gives nothing back until we are close: from down a tunnel there is only the dark, and the eyes in it
  vec3 col = shade(vP, s, N, 0.0) * smoothstep(3.2, 1.9, distance(vP, cameraPosition));
  if (kind > 4.5) {
    // clouded over, but something at the back of it still sends the lamp home: and what is sent straight back does
    // not thin out with distance as the rest does. From the far end of a tunnel it is two points of light and
    // nothing else; they catch even the edge of the beam
    vec3 V = normalize(cameraPosition - vP);
    vec3 Lv = uLightPos - vP;
    float d2 = dot(Lv, Lv);
    vec3 l = Lv * inversesqrt(d2);
    // (the eyes sit on the sides of the head: seen from in front they are all but edge on, and shine all the same)
    float back = pow(max(dot(N, V), 0.0), 0.35) * pow(max(dot(l, V), 0.0), 24.0);
    col += vec3(0.7, 0.9, 0.8) * uLightCol * ((0.25 + uLightI * cookie(dot(-l, uLightDir))) * 20.0 / (0.35 * d2 + 3.0)) * back;
    col += vec3(0.7, 0.9, 0.8) * (uEyes * 0.6 * pow(max(dot(N, V), 0.0), 0.6));
  }
  gl_FragColor = vec4(col, 1.0);
}`;
/** shared by every part of it: how much its eyes burn by themselves */
export const BEAST_EYES = { value: 0 };
const BEAST_PARTS = [[0.55, 0.04, 0.0], [0.8, 0.03, 0.2], [0.2, 0.05, 0.35], [0.25, 0.05, 0.25], [0.35, 0.05, 0.1], [0.12, 0.05, 0.3]];
export function beastMaterial(kind: number, shell = 0) {
  const p = BEAST_PARTS[kind];
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uShell: { value: shell }, uPart: { value: new THREE.Vector4(p[0], p[1], p[2], kind) }, uEyes: BEAST_EYES },
    vertexShader: BEAST_VERT, fragmentShader: BEAST_FRAG, side: THREE.DoubleSide,
  });
}
export function beastDepthMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { uShell: { value: 0 } }, vertexShader: BEAST_VERT, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', side: THREE.DoubleSide, colorWrite: false });
}

// ---- the egg: leathery, pale, freckled ----
const EGG_VERT = /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vRest;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vRest = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const EGG_FRAG = COMMON + /* glsl */ `
uniform sampler3D uCells;
uniform float uDim;
varying vec3 vP; varying vec3 vN; varying vec3 vRest;
void main() {
  vec3 N = normalize(vN);
  // freckles: the middles of some cells, thicker towards the blunt end; and under them a cloudier mottle
  vec4 c = texture(uCells, vRest * 30.0 + 0.37);
  float freckle = smoothstep(0.2, 0.09, c.r) * step(0.42 - 3.0 * vRest.y, c.b);
  float cloud = nz(vRest * 22.0).a;
  vec3 alb = mix(vec3(0.5, 0.46, 0.36), vec3(0.62, 0.59, 0.5), sat(0.5 + cloud));
  alb = mix(alb, vec3(0.17, 0.11, 0.07), freckle * 0.85);
  Surf s;
  s.alb = alb; s.N = normalize(N + nz(vRest * 70.0).rgb * 0.004);
  // (it is carried a hand from the lamp: without a softened falloff it would be a white blank)
  s.rough = 0.42; s.f0 = 0.04; s.trans = 0.12; s.glint = 0.0; s.ao = 1.0; s.near = 0.3;
  gl_FragColor = vec4(shade(vP, s, N, smoothstep(-0.4, 0.3, vP.z)) * uDim, 1.0);
}`;
/** dim: how much of its light it keeps (in the hand it is right under the lamp, and would burn out) */
export function eggMaterial(dim = 1) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uDim: { value: dim } }, vertexShader: EGG_VERT, fragmentShader: EGG_FRAG });
}

// ---- bones (bones.ts): small, dry, old ivory. Their tone is in the vertex colours; here only the dirt of this place ----
const BONE_VERT = /* glsl */ `
attribute vec3 color;
attribute vec3 aLook;
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying vec3 vLook;
void main() {
  vP = position; vN = normal; vC = color; vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const BONE_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying vec3 vC; varying vec3 vLook;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  // vLook: how high this is above what the bone lies on (m), its own dice, how long it has lain
  float cloud = nz(vP * 55.0 + vLook.y * 7.0).a, fine = nz(vP * 260.0).a;
  vec3 alb = vC * (0.9 + 0.22 * cloud + 0.08 * fine);
  // earth has crept up it from below, further the longer it has lain, and into its upward faces as dust
  float crept = smoothstep(0.004 + 0.012 * vLook.z, 0.0, vLook.x + 0.004 * cloud);
  float dust = vLook.z * smoothstep(0.1, 0.9, N.y) * smoothstep(-0.25, 0.3, cloud);
  alb = mix(alb, vec3(0.13, 0.09, 0.06), max(crept * 0.75, dust * 0.45));
  Surf s;
  s.alb = alb; s.N = normalize(N + nz(vP * 180.0).rgb * 0.03);
  s.rough = 0.5; s.f0 = 0.04; s.trans = 0.1; s.glint = 0.0; s.near = 0.06;
  s.ao = mix(0.35, 1.0, smoothstep(0.0, 0.007, vLook.x));
  gl_FragColor = vec4(shade(vP, s, N, 0.0), 1.0);
}`;
export function boneMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: BONE_VERT, fragmentShader: BONE_FRAG, side: THREE.DoubleSide });
}

// ---- the small life of the place (life.ts): silk, the things that spun it, beetles, worms ----
// Silk: old threads, most of them broken. Lines, added to the picture: a thread is too thin to shade, it only gives
// back a little of whatever light is on it, and from more than a few metres off it is not there.
const WEB_VERT = /* glsl */ `
attribute vec2 aSway; // how free this point of the thread is to move (0 where it is fixed), and the thread's own number
uniform float uTime;
uniform vec3 uWalker;
varying vec3 vP;
void main() {
  vec3 p = position;
  // the air down here barely moves, but a thread shows it
  p += vec3(sin(uTime * 0.9 + aSway.y * 20.0), 0.3 * sin(uTime * 1.3 + aSway.y * 7.0), cos(uTime * 0.7 + aSway.y * 13.0)) * (0.004 * aSway.x);
  // and gives when we come through it
  vec3 dw = p - uWalker;
  float dist = length(dw);
  p += (dw / max(dist, 1e-4)) * (smoothstep(0.32, 0.06, dist) * aSway.x * 0.07);
  vP = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (distance(p, cameraPosition) > 4.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const WEB_FRAG = COMMON + /* glsl */ `
varying vec3 vP;
void main() {
  vec3 L = uLightPos - vP;
  float d2 = dot(L, L);
  vec3 l = L * inversesqrt(d2);
  float e = uLightI * cookie(dot(-l, uLightDir)) / (d2 + 0.06);
  vec4 sc = uLightVP * vec4(vP + l * 0.01, 1.0);
  if (sc.w > 0.0) {
    vec3 q = sc.xyz / sc.w * 0.5 + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z < 1.0) e *= texture(uShadow, q);
  }
  // (and what day gets in at the mouth)
  vec3 Lm = uMouth - vP;
  float dm2 = dot(Lm, Lm);
  vec3 day = uSky * (uDay * (0.05 / (0.05 + dm2)) * smoothstep(2.6, 0.4, sqrt(dm2)));
  // A line on the screen is a pixel wide however far off it is, and a thread is not: so it is given less light the
  // further it is, and never much. And silk does not shine evenly along its length: it glints, here and there.
  float far = distance(vP, cameraPosition);
  float fade = smoothstep(4.5, 2.2, far) * min(1.0, 0.7 / far);
  float glint = 0.3 + 0.7 * smoothstep(-0.15, 0.75, nz(vP * 38.0).a) + 1.2 * smoothstep(0.82, 1.1, nz(vP * 95.0 + 0.3).a);
  gl_FragColor = vec4((uLightCol * e * 0.05 + day * 0.03) * fade * glint, 1.0);
}`;
export function webMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U }, vertexShader: WEB_VERT, fragmentShader: WEB_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
}

// Spiders and beetles: a few millimetres each, one small mesh instanced. Their legs go when they walk.
const BUG_VERT = /* glsl */ `
attribute vec2 aLimb;  // which leg (its turn in the gait), and how far out along it (0 on the body)
attribute float aStep; // how much this one is walking just now
attribute float aSeed;
uniform float uTime;
varying vec3 vP; varying vec3 vN; varying float vLimb; varying float vSeed;
void main() {
  vec3 p = position;
  float ph = uTime * 34.0 + aLimb.x * 3.14159 + aSeed * 10.0;
  p.z += sin(ph) * 0.4 * aLimb.y * aStep;
  p.y += max(0.0, cos(ph)) * 0.22 * aLimb.y * aStep;
  vec4 wp = instanceMatrix * vec4(p, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(instanceMatrix) * normal);
  vLimb = aLimb.y; vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
  // (a thing this size is nothing at all from three metres)
  if (distance(vP, cameraPosition) > 3.2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const BUG_FRAG = COMMON + /* glsl */ `
uniform float uKind; // 0 a spider, 1 a beetle
varying vec3 vP; varying vec3 vN; varying float vLimb; varying float vSeed;
void main() {
  vec3 N = normalize(vN);
  Surf s;
  // a spider is nearly black; a beetle is black with a little bronze or green in its shine
  // (dark: against a lit wall a pale one is not there at all)
  vec3 spider = mix(vec3(0.006, 0.005, 0.004), vec3(0.02, 0.015, 0.011), vSeed);
  vec3 beetle = mix(vec3(0.012, 0.012, 0.014), vec3(0.03, 0.022, 0.012), vSeed);
  s.alb = mix(spider, beetle, uKind) * mix(1.0, 0.6, vLimb);
  s.N = N;
  s.rough = mix(0.7, 0.22, uKind * (1.0 - step(0.01, vLimb)));
  s.f0 = mix(0.03, 0.09, uKind); s.ao = 1.0; s.trans = 0.0; s.glint = 0.0; s.near = 0.03;
  gl_FragColor = vec4(shade(vP, s, N, smoothstep(-0.4, 0.3, vP.z)), 1.0);
}`;
export function bugMaterial(kind: number) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uKind: { value: kind } }, vertexShader: BUG_VERT, fragmentShader: BUG_FRAG });
}

// Earthworms: a tube half out of the wet ground, lying on it, that draws itself along in waves.
const WORM_VERT = /* glsl */ `
attribute vec3 aShape; // length, thickness, its own number
uniform float uTime;
varying vec3 vP; varying vec3 vN; varying float vT; varying float vSeed;
void main() {
  // position: (cos, sin) round the ring, and z how far along, 0 to 1
  float t = position.z, L = aShape.x, seed = aShape.z;
  // the wave that goes down it: where it passes, the worm is short and thick; between, long and thin
  float wave = sin(t * 13.0 - uTime * 1.5 + seed * 6.0);
  float tt = t + 0.022 * wave;
  float r = aShape.y * (1.0 + 0.24 * wave) * smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.86, t);
  // lying on the ground in a lazy curve, its tail end still in it
  float side = sin(tt * 3.4 + seed * 9.0 + 0.4 * sin(uTime * 0.5 + seed * 4.0)) * 0.16 * L * tt;
  float up = aShape.y * 0.9 - max(0.0, 0.16 - tt) * L * 0.5 + 0.03 * L * sin(tt * 3.14159) * (0.5 + 0.5 * sin(uTime * 0.4 + seed * 3.0));
  vec3 c = vec3(side, up, tt * L);
  vec3 p = c + vec3(position.x, position.y, 0.0) * r;
  vec4 wp = instanceMatrix * vec4(p, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(instanceMatrix) * vec3(position.x, position.y, 0.0));
  vT = t; vSeed = seed;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (distance(vP, cameraPosition) > 3.2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const WORM_FRAG = COMMON + /* glsl */ `
varying vec3 vP; varying vec3 vN; varying float vT; varying float vSeed;
void main() {
  vec3 N = normalize(vN);
  // ringed all the way down, with the one pale saddle a third of the way along
  float ring = smoothstep(0.0, 0.25, abs(fract(vT * 46.0) - 0.5) * 2.0);
  // (the colour of the ground it lives in, with only a little flesh in it)
  vec3 col = mix(vec3(0.15, 0.105, 0.085), vec3(0.22, 0.16, 0.13), vSeed);
  col = mix(col, vec3(0.3, 0.24, 0.2), smoothstep(0.26, 0.3, vT) * smoothstep(0.42, 0.38, vT));
  col *= mix(0.72, 1.0, ring) * mix(1.15, 0.85, vT);
  Surf s;
  s.alb = col; s.N = N;
  // wet
  s.rough = 0.26; s.f0 = 0.045; s.ao = 0.9; s.trans = 0.35; s.glint = 0.0; s.near = 0.03;
  gl_FragColor = vec4(shade(vP, s, N, 0.0), 1.0);
}`;
export function wormMaterial() {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: WORM_VERT, fragmentShader: WORM_FRAG });
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
