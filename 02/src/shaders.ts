// All the GLSL. The room is analytic: a floor, a back wall and a few lamps, so anything can ask what it sees
// along a ray (`look`), the backdrop pass as much as a crack surface mirroring the room from inside the glass.

const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform float uFlash;
uniform sampler2D uShadow;
uniform vec4 uLook; // exposure, wall light, floor light, crack darkness

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
vec3 rot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 rotInv(vec4 q, vec3 v) { return rot(vec4(-q.xyz, q.w), v); }

const float WALL_Z = -2.4;
// the floor shadow map covers x -2…2, z -2.4…1.6
vec2 shadowUv(vec3 p) { return vec2(p.x / 4.0 + 0.5, (p.z + 2.4) / 4.0); }

vec3 floorCol(vec3 p) {
  float n = fbm(p.xz * 3.0) * 0.6 + vnoise(p.xz * 41.0) * 0.25 + vnoise(p.xz * 97.0) * 0.15;
  vec3 alb = mix(vec3(0.12, 0.118, 0.115), vec3(0.24, 0.228, 0.215), n);
  vec2 g = abs(fract(p.xz / 1.2 + 0.5) - 0.5) * 1.2;
  alb *= 1.0 - 0.4 * smoothstep(0.005, 0.0, min(g.x, g.y));
  vec2 q = p.xz - vec2(0.0, -0.25);
  float pool = exp(-dot(q, q) / 1.5);
  float sh = texture(uShadow, shadowUv(p)).r;
  float lit = 0.05 + 1.3 * pool * sh;
  vec3 f = p - vec3(0.0, 0.5, 2.0);
  lit += uFlash * 3.0 / (1.0 + dot(f, f));
  return alb * lit * vec3(1.0, 0.95, 0.88) * uLook.z;
}
vec3 wallCol(vec3 p) {
  vec2 q = (p.xy - vec2(0.1, 0.7)) * vec2(1.0, 1.25);
  float pool = exp(-dot(q, q) / 1.25);
  float n = fbm(p.xy * 2.2);
  vec3 alb = vec3(0.56, 0.5, 0.44) * (0.8 + 0.4 * n);
  alb *= 1.0 - 0.16 * smoothstep(0.01, 0.0, abs(fract(p.x / 0.3) - 0.5) * 0.3);
  float lit = 0.025 + 0.9 * pool + uFlash * 0.5;
  lit *= mix(0.5, 1.0, smoothstep(0.0, 0.45, p.y));
  return alb * lit * smoothstep(5.0, 2.5, p.y) * uLook.y;
}
vec3 studio(vec3 d) {
  vec3 c = vec3(0.012, 0.012, 0.014);
  float key = dot(d, normalize(vec3(-0.4, 0.85, 0.35)));
  c += vec3(1.0, 0.97, 0.92) * 9.0 * smoothstep(0.72, 0.9, key);
  c += vec3(1.0, 0.98, 0.95) * 70.0 * smoothstep(0.988, 0.997, key); // the bulb itself: what a turning shard flashes with
  c += vec3(0.75, 0.88, 1.0) * 5.0 * smoothstep(0.95, 0.975, dot(d, normalize(vec3(0.9, 0.3, 0.3))));
  c += vec3(1.0, 0.95, 0.9) * 1.1 * smoothstep(0.8, 1.0, dot(d, normalize(vec3(0.3, 0.4, 1.0)))) * smoothstep(0.0, 0.25, d.y);
  c += vec3(1.0, 0.8, 0.5) * 14.0 * uFlash * smoothstep(0.5, 1.0, d.z) * smoothstep(0.0, 0.3, d.y);
  return c;
}
vec3 look(vec3 ro, vec3 rd) {
  float tf = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;
  float tw = rd.z < -1e-4 ? (WALL_Z - ro.z) / rd.z : 1e9;
  if (tf < tw && tf < 1e8) return floorCol(ro + rd * tf);
  if (tw < 1e8) return wallCol(ro + rd * tw);
  return studio(rd);
}
vec3 tone(vec3 c) { c *= uLook.x; c = c / (1.0 + c * 0.35); return pow(c, vec3(0.4545)); }
`;

export const ROOM_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aMat;
uniform mat4 uVP;
out vec3 vW; out float vMat;
void main() { vW = aPos; vMat = aMat; gl_Position = uVP * vec4(aPos, 1.0); }
`;

export const ROOM_FS = COMMON + /* glsl */ `
in vec3 vW; in float vMat;
uniform vec3 uCam;
out vec4 o;
void main() {
  vec3 c;
  if (vMat < 0.5) c = floorCol(vW);
  else if (vMat < 1.5) c = wallCol(vW);
  else if (vMat > 2.5) c = wallCol(vec3(vW.z + 1.2, vW.y, WALL_Z)) * 0.8; // a side wall
  else {
    // the channel the pane stands in: dark steel with a line of light along its top edge
    vec3 V = normalize(vW - uCam);
    c = vec3(0.022, 0.022, 0.025) + 0.05 * smoothstep(0.024, 0.03, vW.y) * step(0.0, vW.z) + 0.02 * uFlash;
  }
  o = vec4(tone(c), 1.0);
}
`;

// one vertex shader for everything made of glass: the cracked pane in place, or shards with a pose each
export const GLASS_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aD; // depth in the glass 0…1, birth, shard id, kind
uniform mat4 uVP;
uniform highp sampler2D uXf;
uniform float uUseXf;
uniform float uToFloor;
out vec3 vW; out vec3 vN; out vec3 vNl; out vec2 vUv; out vec4 vD; flat out vec4 vQ;
vec3 rot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec4 q = vec4(0, 0, 0, 1);
  vec3 p = aPos, n = aNrm;
  if (uUseXf > 0.5) {
    int id = int(aD.z + 0.5);
    ivec2 tc = ivec2((id * 2) % 1024, (id * 2) / 1024);
    vec4 a = texelFetch(uXf, tc, 0);
    q = texelFetch(uXf, tc + ivec2(1, 0), 0);
    p = a.xyz + rot(q, aPos);
    n = rot(q, aNrm);
  }
  vW = p; vN = n; vNl = aNrm; vUv = aUv; vD = aD; vQ = q;
  if (uToFloor > 0.5) {
    // the shadow on the floor, straight into the floor map
    vec3 L = normalize(vec3(0.18, -1.0, -0.62));
    vec3 f = p - L * (p.y / L.y);
    gl_Position = vec4(f.x / 2.0, (f.z + 2.4) / 2.0 - 1.0, 0.0, 1.0);
  } else gl_Position = uVP * vec4(p, 1.0);
}
`;

export const SHADOW_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vD;
uniform float uNow; uniform float uShade; uniform float uCut;
uniform sampler2D uMask; uniform vec3 uPane;
out vec4 o;
// the masks of all panes are stacked in one texture; the pane a vertex belongs to is the tens of its kind
vec2 maskUv(vec2 uv, float kind) { float l = floor(kind / 10.0 + 0.01); return vec2(uv.x / uPane.x, (uv.y / uPane.y + uPane.z - 1.0 - l) / uPane.z); }
void main() {
  if (vD.y > uNow) discard;
  vec4 m = texture(uMask, maskUv(vUv, vD.w));
  if (m.r > 0.5 || (uCut > 0.5 && m.b > 0.5)) discard;
  o = vec4(uShade);
}
`;

// a crack surface. Light inside the glass that meets it is mirrored: it either leaves through a face, and the
// crack shows the room from somewhere else, or it is sent along the pane and stays in: that is the dark line.
export const WALL_FS = COMMON + /* glsl */ `
in vec3 vW; in vec3 vN; in vec3 vNl; in vec2 vUv; in vec4 vD; flat in vec4 vQ;
uniform vec3 uCam; uniform float uNow; uniform float uSeam; uniform float uCut; uniform float uUseXf;
uniform sampler2D uMask; uniform vec3 uPane;
out vec4 o;
// the masks of all panes are stacked in one texture; the pane a vertex belongs to is the tens of its kind
vec2 maskUv(vec2 uv, float kind) { float l = floor(kind / 10.0 + 0.01); return vec2(uv.x / uPane.x, (uv.y / uPane.y + uPane.z - 1.0 - l) / uPane.z); }
void main() {
  if (vD.y > uNow) discard;
  // (once pieces have left, the cracks that stay were chosen one by one: no mask for them)
  if (uCut < 0.5 && texture(uMask, maskUv(vUv, vD.w)).r > 0.5) discard;
  vec3 V = normalize(vW - uCam);
  vec3 Vl = rotInv(vQ, V);
  // hackle: the surface of a fracture is not smooth
  vec2 hp = vUv * 420.0 + vD.x * 5.0;
  vec3 h = vec3(vnoise(hp) - 0.5, vnoise(hp + 31.7) - 0.5, vnoise(hp + 73.1) - 0.5);
  vec3 Nl = normalize(vNl + h * 0.5);
  float sz = Vl.z < 0.0 ? 1.0 : -1.0;
  vec3 Vg = refract(Vl, vec3(0, 0, sz), 1.0 / 1.5);
  vec3 Rg = reflect(Vg, Nl);
  float esc = max(smoothstep(0.7, 0.8, abs(Rg.z)), 1.0 - uLook.w);
  vec3 og = refract(Rg, vec3(0, 0, -sign(Rg.z)), 1.5);
  vec3 seen = dot(og, og) > 0.0 ? look(vW, rot(vQ, og)) : vec3(0.0);
  vec3 trapped = vec3(0.006, 0.02, 0.018) + vec3(0.25, 0.5, 0.45) * uFlash * 0.25;
  vec3 c = mix(trapped, seen * vec3(0.82, 0.95, 0.9), esc);
  // a shard on its own: the light it has gathered through its faces leaves by its edges, bottle green
  if (uUseXf > 0.5) {
    vec2 lp = vW.xz - vec2(0.0, -0.25);
    c += vec3(0.004, 0.04, 0.024) * (0.2 + 1.1 * exp(-dot(lp, lp) / 1.5) + 2.0 * uFlash) * (0.5 + vnoise(hp * 0.2));
  }
  // where the crack meets the surface the edge is chipped and catches light
  float seam = exp(-vD.x * 10.0) + 0.5 * exp(-(1.0 - vD.x) * 10.0);
  float glint = pow(vnoise(vUv * 900.0 + Vl.xy * 14.0), 6.0);
  c += vec3(0.6, 0.85, 0.8) * seam * (uSeam + 1.6 * glint + uFlash);
  // the tip of a running crack flashes
  c += vec3(0.8, 1.0, 0.95) * 1.5 * exp(-(uNow - vD.y) / 0.05);
  if (mod(vD.w, 10.0) > 1.5) c = mix(c, vec3(0.55, 0.62, 0.6) * (0.5 + uFlash * 2.0), 0.55); // the crushed rim of the hole
  o = vec4(tone(c), 1.0);
}
`;

// a face of the glass: what is behind it, bent a little, plus what it mirrors
export const FACE_FS = COMMON + /* glsl */ `
in vec3 vW; in vec3 vN; in vec3 vNl; in vec2 vUv; in vec4 vD; flat in vec4 vQ;
uniform vec3 uCam; uniform mat4 uView; uniform vec2 uRes; uniform float uBend; uniform float uCut; uniform float uNow; uniform vec3 uGlass; // tint, waviness, reflections
uniform float uFrost; uniform sampler2D uRoom; uniform vec3 uTargets[3]; // each: x, y on the pane and its radius, metres
uniform sampler2D uScene; uniform sampler2D uMask; uniform vec3 uPane;
out vec4 o;
// the masks of all panes are stacked in one texture; the pane a vertex belongs to is the tens of its kind
vec2 maskUv(vec2 uv, float kind) { float l = floor(kind / 10.0 + 0.01); return vec2(uv.x / uPane.x, (uv.y / uPane.y + uPane.z - 1.0 - l) / uPane.z); }
void main() {
  if (vD.y > uNow) discard; // shards cut ahead of the blow that frees them
  vec4 m = texture(uMask, maskUv(vUv, vD.w));
  if (m.r > 0.5 || (uCut > 0.5 && m.b > 0.5)) discard; // blue: where pieces have left the standing pane
  // float glass is never flat
  vec2 w = vec2(fbm(vUv * 5.0 + 3.0), fbm(vUv * 5.0 + 19.0)) - 0.5;
  vec3 N = normalize(vN + rot(vQ, vec3(w * uGlass.y, 0.0)));
  vec3 V = normalize(vW - uCam);
  if (dot(N, V) > 0.0) N = -N;
  vec3 Nv = mat3(uView) * N;
  vec2 suv = gl_FragCoord.xy / uRes;
  // a slab shifts what is behind it sideways by a fraction of its thickness, more the steeper it is seen
  vec2 off = -Nv.xy * uBend * gl_FragCoord.w * vec2(uRes.y / uRes.x, 1.0);
  off *= min(1.0, 0.025 / (length(off) + 1e-5));
  vec3 c = vec3(texture(uScene, suv + off * 0.93).r, texture(uScene, suv + off).g, texture(uScene, suv + off * 1.07).b);
  if (uFrost > 0.001) {
    // frosted: the room behind is a blur, but what is in the glass itself, its cracks, is right at the
    // surface and stays sharp. The room is kept apart for that (uRoom): where the two pictures differ is a crack
    vec3 room = texture(uRoom, suv + off).rgb;
    float crack = smoothstep(0.03, 0.14, length(c - room));
    float a = hash(gl_FragCoord.xy) * 6.283;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 px = vec2(uRes.y / uRes.x, 1.0) * uFrost * 0.035;
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      vec2 d = R * (sqrt((fi + 0.5) / 16.0) * vec2(cos(fi * 2.4), sin(fi * 2.4)));
      blur += texture(uRoom, suv + off + d * px).rgb;
    }
    blur = mix(blur / 16.0, vec3(0.5, 0.52, 0.51) * (0.75 + uFlash), uFrost * 0.22);
    c = mix(blur, c, crack);
  }
  // green, and greener the longer the way through it: a pane seen from the front is nearly clear, a shard on edge is not
  c *= pow(vec3(0.93, 0.975, 0.955), vec3(uGlass.x / max(abs(dot(N, V)), 0.14)));
  // the targets, in dark matt tape: a small circle with a dot in its empty middle, and four long strokes
  // around it. Nothing touches: there is a gap between each stroke and the circle. By pane coordinates, so a
  // shard keeps its part of one
  for (int i = 0; i < 3; i++) {
    vec2 d = (vUv - uTargets[i].xy) / max(uTargets[i].z, 1e-5);
    vec2 q = abs(d);
    if (max(q.x, q.y) < 1.05) {
      float r = length(d);
      float aa = fwidth(r) * 1.2 + 1e-4;
      float ring = smoothstep(0.022 + aa, 0.022, abs(r - 0.3));
      float along = max(q.x, q.y); // how far out along its stroke
      float stroke = smoothstep(0.022 + aa, 0.022, min(q.x, q.y)) * smoothstep(0.38 - aa, 0.38, along) * smoothstep(1.0 + aa, 1.0, along);
      float dot_ = smoothstep(0.03 + aa, 0.03, r);
      float ink = max(ring, max(stroke, dot_));
      vec3 tape = vec3(0.04, 0.042, 0.046) * (0.85 + 0.3 * vnoise(vUv * 900.0)) * (0.7 + uFlash * 2.0);
      c = mix(c, tape, ink * 0.94);
    }
  }
  float F = 0.06 + 0.94 * pow(1.0 - max(dot(-V, N), 0.0), 4.0);
  c += tone(look(vW, reflect(V, N))) * F * uGlass.z;
  // crushed glass around the hole scatters white
  float frost = m.g * (0.9 + 0.7 * vnoise(vUv * 1500.0));
  c = mix(c, vec3(0.62, 0.68, 0.66) * (0.55 + uFlash * 3.0), clamp(frost, 0.0, 0.85));
  o = vec4(c, 1.0);
}
`;

export const QUAD_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main() { o = vec4(texture(uTex, vUv).rgb, 1.0); }
`;

// drawn last, multiplied in: corners fall off
export const VIGNETTE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; uniform float uFade; out vec4 o;
void main() {
  vec2 q = vUv - 0.5;
  float v = smoothstep(0.95, 0.25, length(q)) * 0.55 + 0.45;
  o = vec4(vec3(v * uFade), 1.0);
}
`;

// glass in grains and splinters. Each turns as it flies and as the eye moves: dull most of the time, then a
// flash of the lamp. Most are grains, a few are long
export const DUST_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aP; // position, life 0…1
layout(location = 1) in float aSeed;
uniform mat4 uVP; uniform float uPx; uniform vec3 uCam;
out float vA; out vec3 vR;
void main() {
  gl_Position = uVP * vec4(aP.xyz, 1.0);
  float ph = aSeed * 91.0 + dot(aP.xyz, vec3(190.0, 230.0, 170.0)) + dot(uCam, vec3(9.0));
  float tw = 0.5 + 0.5 * sin(ph);
  float big = pow(fract(aSeed * 7.3), 5.0);
  // (one that flies at the lens is gone before it fills the picture)
  vA = aP.w * (0.1 + 0.55 * tw * tw + 6.0 * pow(tw, 26.0)) * smoothstep(0.25, 0.7, gl_Position.w);
  float a = aSeed * 40.0 + ph * 0.12;
  vR = vec3(cos(a), sin(a), 1.0 + 3.5 * big);
  gl_PointSize = clamp(uPx * (0.0016 + 0.013 * big) / gl_Position.w, 1.5, 28.0);
}
`;

export const DUST_FS = /* glsl */ `#version 300 es
precision highp float;
in float vA; in vec3 vR; uniform float uFlash; out vec4 o;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  q = vec2(q.x * vR.x + q.y * vR.y, (q.y * vR.x - q.x * vR.y) * vR.z);
  float a = smoothstep(0.5, 0.1, length(q)) * vA;
  o = vec4(vec3(0.72, 0.92, 0.86) * a * (0.5 + uFlash * 3.0), 1.0);
}
`;

// glass ground to powder: soft puffs that hang in the air and drift. They go into the picture of the room, so
// frosted glass in front of them blurs them like the rest of it
export const HAZE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec4 aP; // position, how thick it still is
layout(location = 1) in vec2 aS; // radius in metres, seed
uniform mat4 uVP; uniform float uPx;
out float vA; out float vSeed; out vec3 vW;
void main() {
  gl_Position = uVP * vec4(aP.xyz, 1.0);
  float px = uPx * aS.x * 2.0 / max(gl_Position.w, 0.05);
  // (a point is only allowed to be so large: past that it thins out)
  vA = aP.w * min(1.0, 240.0 / px) * smoothstep(0.3, 0.9, gl_Position.w); vSeed = aS.y; vW = aP.xyz;
  gl_PointSize = min(px, 240.0);
  if (aP.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const HAZE_FS = COMMON + /* glsl */ `
in float vA; in float vSeed; in vec3 vW;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float body = max(exp(-dot(q, q) * 14.0) - 0.03, 0.0);
  // not a ball: wisps, each puff turned its own way
  float t = vSeed * 6.283;
  vec2 w = mat2(cos(t), -sin(t), sin(t), cos(t)) * q;
  float n = 0.55 * vnoise(w * vec2(3.0, 6.0) + vSeed * 37.0) + 0.45 * vnoise(w * vec2(7.0, 13.0) + vSeed * 91.0);
  float a = body * (0.08 + 2.1 * n * n) * vA;
  // lit by the lamp over the floor, and by the shot: paler than a dark room, darker than a bright one
  vec2 p = vW.xz - vec2(0.0, -0.25);
  float lit = 0.07 + 0.34 * exp(-dot(p, p) / 1.5) + uFlash * 1.2;
  o = vec4(tone(vec3(0.74, 0.8, 0.78) * lit) * a, a);
}
`;

// tape: grey cloth with a dull sheen. Same vertices as the glass, so a strip can ride on a shard
export const TAPE_FS = COMMON + /* glsl */ `
in vec3 vW; in vec2 vUv;
out vec4 o;
void main() {
  vec2 q = vW.xz - vec2(0.0, -0.25);
  float weave = 0.9 + 0.1 * vnoise(vUv * vec2(700.0, 1400.0)) + 0.06 * vnoise(vUv * 60.0);
  vec3 c = vec3(0.2, 0.205, 0.215) * weave * (0.3 + 0.85 * exp(-dot(q, q) / 1.8) + uFlash);
  o = vec4(tone(c), 1.0);
}
`;
