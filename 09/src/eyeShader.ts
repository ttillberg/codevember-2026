// GLSL for the eye, patched into MeshPhysicalMaterial so the scene's light and environment
// light it. Everything is in the eye's object space: unit sphere, looking down +z.
//
// From the outside in: a clear dome (the cornea, the sphere surface itself, glossy via
// clearcoat), the iris lying below it on a flatter cap (the view ray is refracted through
// the dome to find it), a slit pupil cut in the iris, and the dark inside behind it. Round
// the dome, on the ball: a blue-black band, a thin cream rim, and the dark back.

export const eyeVertexPars = /* glsl */ `
varying vec3 vEyeObj;
`;

export const eyeVertexMain = /* glsl */ `
vEyeObj = transformed;
`;

export const eyeFragmentPars = /* glsl */ `
varying vec3 vEyeObj;
uniform vec3 uCam;        // camera, object space
uniform vec3 uLight;      // towards the key light, object space
uniform mat3 uToView;     // object normal to view normal
uniform float uSlit;      // pupil half width, iris radii
uniform float uSlitLen;   // pupil half length, iris radii
uniform float uSlitTilt;
uniform float uGlow;      // how lined up the eye is with light and camera, 0..1
uniform float uLimbCos;   // cos of the dome's edge angle
uniform float uLimbR;     // sin of it: the iris radius seen from the front
uniform vec4 uIrisSph;    // the iris cap: a flatter sphere, centre xyz, radius w
uniform float uIor;
uniform float uCellScale;
uniform float uBump;
uniform vec3 cIrisMid, cIrisEdge, cIrisLine, cFleck, cBand, cBandHi, cCream, cBack, cBackWarm, cVessel, cRetina;

struct EyeS { vec3 alb; vec3 n; vec3 emit; float rough; float spec; float lit; float wrap; };
EyeS eS;

float eHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 eHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float eNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(eHash(i), eHash(i + vec2(1, 0)), u.x), mix(eHash(i + vec2(0, 1)), eHash(i + vec2(1, 1)), u.x), u.y);
}
float eHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float eNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(eHash3(i), eHash3(i + vec3(1, 0, 0)), u.x), mix(eHash3(i + vec3(0, 1, 0)), eHash3(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(eHash3(i + vec3(0, 0, 1)), eHash3(i + vec3(1, 0, 1)), u.x), mix(eHash3(i + vec3(0, 1, 1)), eHash3(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}

// Cells: distance to the nearest cell border (x) and to the cell's own point (y). en is the
// border's normal, pointing out of the cell: the border distance falls along it. toPt is
// the vector to the cell's point.
vec2 eCells(vec2 x, out vec2 en, out vec2 toPt) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0), mr = vec2(0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + eHash2(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float ed = 8.0;
  en = vec2(1, 0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + eHash2(n + g) - f;
    vec2 dr = r - mr;
    if (dot(dr, dr) > 1e-5) {
      vec2 nn = normalize(dr);
      float d = dot(0.5 * (mr + r), nn);
      if (d < ed) { ed = d; en = nn; }
    }
  }
  toPt = mr;
  return vec2(ed, sqrt(md));
}

// The slit: a lens (two circles' overlap) when narrow, rounder when it opens. < 0 inside.
float eSlit(vec2 u, float w, float L) {
  float rc = (L * L + w * w) / (2.0 * w);
  float lens = max(length(u - vec2(rc - w, 0.0)) - rc, length(u + vec2(rc - w, 0.0)) - rc);
  float oval = (length(u / vec2(w, L)) - 1.0) * w;
  return mix(lens, oval, smoothstep(0.12, 0.45, w / L));
}

void eyeIris(vec3 p, vec3 V) {
  // refract the view ray through the dome, find where it meets the iris cap below
  vec3 T = refract(V, p, 1.0 / uIor);
  vec3 o = p - uIrisSph.xyz;
  float b = dot(o, T);
  float c = dot(o, o) - uIrisSph.w * uIrisSph.w;
  float disc = b * b - c;
  float t = -b - sqrt(max(disc, 0.0));
  vec3 h = p + T * max(t, 0.0);
  vec2 hu = h.xy / uLimbR;              // 0 at the centre, 1 at the rim
  float rho = length(hu);
  // the slit's frame, tilted a little
  float cs = cos(uSlitTilt), sn = sin(uSlitTilt);
  vec2 u = vec2(cs * hu.x + sn * hu.y, -sn * hu.x + cs * hu.y);

  // the tissue stretches with the slit: map back to where it lies when the slit is shut
  float L = uSlitLen, w = uSlit;
  float wl = w * max(0.0, 1.0 - (u.y * u.y) / (L * L));
  float ext = sqrt(max(1.0 - u.y * u.y, 1e-3));
  float xr = max(abs(u.x) - wl, 0.0) / max(ext - wl, 1e-3) * ext;
  vec2 q = vec2(sign(u.x) * xr, u.y);

  // a fine net of cells, outlined by paler lines, slightly domed
  vec2 wq = q + 0.09 * (vec2(eNoise(q * 5.0 + 3.1), eNoise(q * 5.0 + 9.7)) - 0.5);
  wq += 0.025 * (vec2(eNoise(wq * 17.0 + 1.3), eNoise(wq * 17.0 + 6.1)) - 0.5);
  vec2 en1, en2, tp1, tp2;
  float s1 = uCellScale, s2 = uCellScale * 2.6;
  vec2 c1 = eCells(wq * s1, en1, tp1);
  vec2 c2 = eCells(wq * s2 + 5.3, en2, tp2);
  float aa1 = length(fwidth(wq)) * s1;
  float aa2 = aa1 * 2.6;
  float line1 = 1.0 - smoothstep(0.0, 0.07 + aa1, c1.x);
  float line2 = (1.0 - smoothstep(0.008, 0.05 + aa2, c2.x)) * (1.0 - smoothstep(0.25, 0.7, aa2));
  float mott = eNoise(wq * 3.0 + 1.7);
  float mott2 = eNoise(wq * 9.0 + 4.2);

  vec3 col = mix(cIrisMid, cIrisEdge, smoothstep(0.2, 1.0, rho) * (0.7 + 0.5 * mott));
  col *= (0.78 + 0.44 * mott) * (0.88 + 0.24 * mott2);
  float broken = smoothstep(0.2, 0.8, eNoise(wq * 7.0 + 11.0));
  float speck = (1.0 - smoothstep(0.08, 0.2 + aa2, c2.y)) * smoothstep(0.6, 0.75, eNoise(wq * 9.0 + 2.0)) * (1.0 - smoothstep(0.2, 0.6, aa2));
  col = mix(col, cIrisLine, clamp(line1 * (0.06 + 0.28 * broken) + line2 * 0.1 * broken + speck * 0.1, 0.0, 1.0));
  float fl = smoothstep(0.7, 0.86, eNoise(wq * 13.0 + 7.0)) * (1.0 - line1);
  col = mix(col, cFleck, fl * 0.55);
  // a faint paler seam running pole to pole
  float sx = q.x + 0.34 + 0.07 * sin(q.y * 2.3 + 0.6);
  float seam = exp(-sx * sx / 0.0012) * smoothstep(1.0, 0.3, abs(q.y));
  col = mix(col, cIrisLine, seam * 0.22);
  // darker towards the rim, where it dives under the band
  col *= mix(1.0, 0.3, smoothstep(0.7, 1.0, rho));

  // relief
  // each cell a soft pillow (height -F1^2), the seams fall on the pale lines
  vec2 g = (2.0 * tp1 * s1 + 0.12 * 2.0 * tp2 * s2 * (1.0 - smoothstep(0.3, 0.8, aa2))) * 0.05;
  g *= uBump;
  vec2 gh = vec2(cs * g.x - sn * g.y, sn * g.x + cs * g.y) / uLimbR;
  vec3 nI = normalize(h - uIrisSph.xyz);
  vec3 n = normalize(nI - vec3(gh, 0.0));

  // the slit, with a thin darker border
  float sd = eSlit(u, w, L);
  float aaS = fwidth(sd) * 1.2 + 1e-4;
  float hole = 1.0 - smoothstep(-aaS, aaS, sd);
  col *= mix(0.35, 1.0, smoothstep(0.0, 0.03, sd));

  // light focused by the dome falls on the far side of the iris; the near rim is in shade
  vec2 l2 = uLight.xy;
  float ll = length(l2);
  float side = ll > 1e-3 ? dot(normalize(h.xy + 1e-5), -l2 / ll) * smoothstep(0.0, 0.7, ll) : 0.0;
  float lit = (1.0 + 1.8 * smoothstep(-0.2, 1.0, side) * smoothstep(0.2, 0.95, rho))
            * (1.0 - 0.6 * smoothstep(0.1, 1.0, -side) * smoothstep(0.7, 1.0, rho));
  // a grazing ray that misses the cap ends in the dark angle at the rim
  float rim = smoothstep(-0.02, 0.0, -disc) + smoothstep(0.97, 1.02, rho);
  col *= 1.0 - 0.85 * clamp(rim, 0.0, 1.0);

  // inside: dark, with the faintest red glow when light and eye line up
  vec3 inside = cRetina * (0.004 + uGlow * 0.06) * smoothstep(0.0, -0.08, sd);
  eS.alb = mix(col, vec3(0.003), hole);
  eS.n = mix(n, nI, hole);
  eS.emit = inside * hole;
  eS.rough = 0.42;
  eS.spec = mix(0.12, 0.0, hole);
  eS.lit = mix(lit, 1.0, hole);
  eS.wrap = 0.55 * (1.0 - hole);
}

void eyeBall(vec3 p) {
  float ang = acos(clamp(p.z, -1.0, 1.0)) - acos(uLimbCos);
  vec2 d = normalize(p.xy + 1e-5);
  // the band is wider at the bottom and towards one side
  float bw = 0.2 + 0.22 * smoothstep(0.1, -1.0, d.y) + 0.08 * smoothstep(0.2, 1.0, -d.x);
  float gr = eNoise3(p * 60.0);
  float gr2 = eNoise3(p * 26.0 + 3.0);
  vec3 band = mix(cBand, cBandHi, (0.15 + 0.3 * gr2) * smoothstep(0.0, bw, ang) * (0.4 + 0.6 * smoothstep(0.2, -0.8, d.y)));
  band *= 0.75 + 0.5 * gr;
  // a thin deep red seam where it meets the iris
  band = mix(band, cIrisEdge * 0.35, exp(-ang * ang / 0.0003));
  float creamW = 0.028 + 0.015 * gr2;
  vec3 cream = cCream * (0.85 + 0.25 * gr);
  // the back: blue-black into dark red-brown, a few fine vessels
  float back = smoothstep(bw + creamW, bw + creamW + 0.9, ang);
  vec3 bk = mix(cBack, cBackWarm, back);
  vec3 wp = p * 3.5 + 0.6 * vec3(eNoise3(p * 2.0), eNoise3(p * 2.0 + 7.0), eNoise3(p * 2.0 + 13.0));
  float v = 1.0 - abs(eNoise3(wp) * 2.0 - 1.0);
  float v2 = 1.0 - abs(eNoise3(wp * 2.3 + 4.0) * 2.0 - 1.0);
  float ves = smoothstep(0.95, 0.99, v) + 0.6 * smoothstep(0.96, 0.995, v2);
  bk = mix(bk, cVessel, clamp(ves, 0.0, 1.0) * 0.35 * smoothstep(bw + creamW, bw + creamW + 0.3, ang));

  float aa = fwidth(ang) + 1e-4;
  float toCream = smoothstep(bw - aa, bw + aa, ang);
  float toBack = smoothstep(bw + creamW - aa - 0.02, bw + creamW + aa + 0.02, ang);
  vec3 col = mix(band, cream, toCream);
  col = mix(col, bk, toBack);
  eS.alb = col;
  eS.n = p;
  eS.emit = vec3(0.0);
  eS.rough = mix(0.5, 0.6, toBack);
  eS.spec = 0.4;
  eS.lit = 1.0;
  eS.wrap = mix(0.25, 0.5, toCream * (1.0 - toBack));
}

void eyeShade() {
  vec3 p = normalize(vEyeObj);
  vec3 V = normalize(p - uCam);
  float ang = acos(clamp(p.z, -1.0, 1.0)) - acos(uLimbCos);
  float aa = fwidth(ang) * 1.5 + 1e-4;
  if (ang < aa) {
    eyeIris(p, V);
    if (ang > -aa) {
      EyeS a = eS;
      eyeBall(p);
      float k = smoothstep(-aa, aa, ang);
      eS.alb = mix(a.alb, eS.alb, k);
      eS.n = normalize(mix(a.n, eS.n, k));
      eS.emit = mix(a.emit, eS.emit, k);
      eS.rough = mix(a.rough, eS.rough, k);
      eS.spec = mix(a.spec, eS.spec, k);
      eS.lit = mix(a.lit, eS.lit, k);
      eS.wrap = mix(a.wrap, eS.wrap, k);
    }
  } else {
    eyeBall(p);
  }
}
`;

// Where each piece goes in the physical material's fragment shader.
export const eyeFragmentHooks: Array<[string, string]> = [
  ['#include <color_fragment>', `
  eyeShade();
  diffuseColor.rgb = eS.alb;`],
  ['#include <normal_fragment_maps>', `
  normal = normalize(uToView * eS.n);`],
  ['#include <emissivemap_fragment>', `
  totalEmissiveRadiance += eS.emit;`],
  ['#include <lights_physical_fragment>', `
  material.roughness = clamp(eS.rough + geometryRoughness, 0.045, 1.0);
  material.specularColor *= eS.spec;
  material.specularColorBlended *= eS.spec;
  material.specularF90 *= eS.spec;`],
  ['#include <lights_fragment_end>', `
  #if NUM_DIR_LIGHTS > 0
  {
    // light that went into the tissue and came out round the terminator, redder
    vec3 ld = directionalLights[0].direction;
    float ndl = dot(normal, ld);
    float wr = max(0.0, (ndl + eS.wrap) / (1.0 + eS.wrap)) - max(ndl, 0.0);
    reflectedLight.directDiffuse *= eS.lit;
    reflectedLight.directDiffuse += directionalLights[0].color * wr * RECIPROCAL_PI * material.diffuseContribution * vec3(1.0, 0.5, 0.35) * eS.lit;
  }
  #endif`],
];
