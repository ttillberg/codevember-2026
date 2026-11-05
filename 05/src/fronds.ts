// Instanced moss fronds: a ribbon bent along a cubic bezier in the vertex shader,
// hooked tip, serrated edge, one side branch. Age comes from a float texture that
// mirrors the per-vertex moss attribute.
import * as THREE from 'three';
import { fbm3, mulberry32 } from './noise';
import { deadAt, pillowAt } from './rock';

export interface Fronds {
  mesh: THREE.Mesh;
  ageTexture: THREE.DataTexture;
  puffTexture: THREE.DataTexture;
}

// Ribbon template: x in [-1,1] across, y in [0,1] along, z = strip (0 main, 1 branch)
function ribbonTemplate(mainSegs: number, branchSegs: number, leafSegs: number, leaves: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const addStrip = (segs: number, strip: number) => {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pos.push(-1, t, strip, 1, t, strip);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  addStrip(mainSegs, 0);
  addStrip(branchSegs, 1);
  for (let k = 0; k < leaves; k++) addStrip(leafSegs, 2 + k);
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}

export function buildFronds(rock: THREE.BufferGeometry, fertility: Float32Array, count: number, seed = 3): Fronds {
  const rand = mulberry32(seed);
  const position = rock.attributes.position as THREE.BufferAttribute;
  // fronds stand along the smoothed moss normal when there is one, so they agree with the shells
  const normal = (rock.attributes.mossNormal ?? rock.attributes.normal) as THREE.BufferAttribute;
  const index = rock.index!.array;
  const triCount = index.length / 3;

  // cumulative triangle weight = area * fertility: no instances wasted where moss never grows
  const cum = new Float32Array(triCount);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < triCount; i++) {
    a.fromBufferAttribute(position, index[i * 3]);
    b.fromBufferAttribute(position, index[i * 3 + 1]);
    c.fromBufferAttribute(position, index[i * 3 + 2]);
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    const fert = (fertility[index[i * 3]] + fertility[index[i * 3 + 1]] + fertility[index[i * 3 + 2]]) / 3;
    total += area * Math.pow(fert, 1.5);
    cum[i] = total;
  }

  const iPos = new Float32Array(count * 3);
  const iNor = new Float32Array(count * 3);
  const iTan = new Float32Array(count * 3);
  const iSeed = new Float32Array(count * 4);
  const iVert = new Float32Array(count);
  const iClump = new Float32Array(count);
  const iDead = new Float32Array(count);
  const iStraw = new Float32Array(count); // straw-rich areas: about a tenth of the surface
  const iPick = new Float32Array(count); // species pick threshold: a smooth field, so mixed zones form patches not noise

  const n = new THREE.Vector3(), t = new THREE.Vector3(), p = new THREE.Vector3();
  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // pick triangle by area
    const r = rand() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1; else hi = mid;
    }
    const tri = lo;
    const ia = index[tri * 3], ib = index[tri * 3 + 1], ic = index[tri * 3 + 2];
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    p.set(0, 0, 0).addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
    na.fromBufferAttribute(normal, ia);
    nb.fromBufferAttribute(normal, ib);
    nc.fromBufferAttribute(normal, ic);
    n.set(0, 0, 0).addScaledVector(na, w).addScaledVector(nb, u).addScaledVector(nc, v).normalize();
    // any tangent; the shader spins it by a random yaw
    t.set(0, 1, 0);
    if (Math.abs(n.y) > 0.9) t.set(1, 0, 0);
    t.addScaledVector(n, -t.dot(n)).normalize();

    iPos.set([p.x, p.y, p.z], i * 3);
    iNor.set([n.x, n.y, n.z], i * 3);
    iTan.set([t.x, t.y, t.z], i * 3);
    iSeed.set([rand(), rand(), rand(), rand()], i * 4);
    iVert[i] = w >= u && w >= v ? ia : u >= v ? ib : ic;
    // same pillow field as the shell shader, so undercoat and fronds agree
    iDead[i] = deadAt(p.x, p.y, p.z);
    iStraw[i] = THREE.MathUtils.smoothstep(fbm3(p.x * 1.7, p.y * 1.7, p.z * 1.7, 3, 61), 0.22, 0.38);
    iPick[i] = THREE.MathUtils.clamp(fbm3(p.x * 4.5, p.y * 4.5, p.z * 4.5, 3, 83) * 0.9 + 0.5 + (rand() - 0.5) * 0.12, 0, 1);
    iClump[i] = pillowAt(p.x, p.y, p.z);
  }

  const tpl = ribbonTemplate(4, 2, 1, 6);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(tpl.pos, 3));
  geo.setIndex(new THREE.BufferAttribute(tpl.idx, 1));
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iNor', new THREE.InstancedBufferAttribute(iNor, 3));
  geo.setAttribute('iTan', new THREE.InstancedBufferAttribute(iTan, 3));
  geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 4));
  geo.setAttribute('iVert', new THREE.InstancedBufferAttribute(iVert, 1));
  geo.setAttribute('iClump', new THREE.InstancedBufferAttribute(iClump, 1));
  geo.setAttribute('iDead', new THREE.InstancedBufferAttribute(iDead, 1));
  geo.setAttribute('iStraw', new THREE.InstancedBufferAttribute(iStraw, 1));
  geo.setAttribute('iPick', new THREE.InstancedBufferAttribute(iPick, 1));
  geo.instanceCount = count;

  // age texture: one float per rock vertex
  const vertexCount = position.count;
  const texW = Math.ceil(Math.sqrt(vertexCount));
  const texH = Math.ceil(vertexCount / texW);
  const ageTexture = new THREE.DataTexture(new Float32Array(texW * texH * 4), texW, texH, THREE.RGBAFormat, THREE.FloatType);
  ageTexture.magFilter = ageTexture.minFilter = THREE.NearestFilter;
  ageTexture.needsUpdate = true;
  // R = puff, G = the (dynamic) pillow field, B = the cushion weight (the fifth, coral, is the remainder)
  const puffTexture = new THREE.DataTexture(new Float32Array(texW * texH * 4), texW, texH, THREE.RGBAFormat, THREE.FloatType);
  puffTexture.magFilter = puffTexture.minFilter = THREE.NearestFilter;
  puffTexture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    vertexShader: frondVertex,
    fragmentShader: frondFragment,
    side: THREE.DoubleSide,
    uniforms: {
      uAge: { value: ageTexture },
      uPuff: { value: puffTexture },
      uAgeSize: { value: new THREE.Vector2(texW, texH) },
      uLen: { value: 0.032 },
      uStarLen: { value: 0.038 },
      uLichenLen: { value: 0.07 },
      uBulge: { value: 0.035 },
      uWidth: { value: 0.0042 },
      uLightDir: { value: new THREE.Vector3(1.2, 2.0, 1.0).normalize() },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
    },
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, ageTexture, puffTexture };
}

const frondVertex = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iNor;
attribute vec3 iTan;
attribute vec4 iSeed;
attribute float iVert;
attribute float iClump;
attribute float iDead;
attribute float iStraw;
attribute float iPick;

uniform sampler2D uAge;
uniform sampler2D uPuff;
uniform vec2 uAgeSize;
uniform float uLen;
uniform float uStarLen;
uniform float uLichenLen;
uniform float uBulge;
uniform float uWidth;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vT;
varying float vAge;
varying float vHue;
varying float vStrip;
varying float vClump;
varying float vSpecies;
varying float vDead;
varying float vShade;
varying float vStraw;

float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }

vec3 bezier(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float s = 1.0 - t;
  return s*s*s*p0 + 3.0*s*s*t*p1 + 3.0*s*t*t*p2 + t*t*t*p3;
}
vec3 bezierTangent(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {
  float s = 1.0 - t;
  return 3.0*s*s*(p1-p0) + 6.0*s*t*(p2-p1) + 3.0*t*t*(p3-p2);
}

void main() {
  float ix = mod(iVert, uAgeSize.x);
  float iy = floor(iVert / uAgeSize.x);
  vec4 cell = texture2D(uAge, (vec2(ix, iy) + 0.5) / uAgeSize);
  float age = cell.r;
  vec4 pp = texture2D(uPuff, (vec2(ix, iy) + 0.5) / uAgeSize);
  float puff = pp.r;
  float clumpV = pp.g; // live pillow field, the brush can rearrange it
  // draw this instance's species from the vertex's weights: mixed zones interleave
  // weights are normalised on the CPU: feather, star, lichen in the age texture, cushion in the puff texture,
  // coral is the remainder. Cushion has no fronds.
  vec4 wgt = vec4(cell.gba, pp.b);
  float pick = iPick; // smooth field: neighbours pick alike, so weights turn into patches
  float c1 = wgt.x, c2 = c1 + wgt.y, c3 = c2 + wgt.z, c4 = c3 + wgt.w;
  float species = pick < c1 ? 0.0 : (pick < c2 ? 1.0 : (pick < c3 ? 2.0 : (pick < c4 ? 3.0 : 4.0)));
  float strip = position.z;
  float t = position.y;
  // a few percent of instances are a single thin grass straw instead, whatever the species
  // 1% of instances are straws, up to 9% in straw-rich areas, and tops get more than sides
  float upness = smoothstep(-0.1, 0.9, iNor.y);
  float strawP = mix(0.01, 0.09, iStraw) * mix(0.3, 1.6, upness);
  float straw = step(1.0 - strawP, hash(iSeed.y * 31.7 + iSeed.z * 7.3));
  // cull: no moss, or strips this species does not use
  bool unused;
  if (straw > 0.5) unused = strip > 0.5 || age < 0.3;
  else if (species < 0.5) unused = strip >= 2.0;                  // feather: stem + branch
  else if (species < 1.5) unused = strip == 1.0 || iSeed.w < 0.25; // star: lightly thinned rosettes
  else if (species < 2.5) unused = false;                           // lichen: every instance, all strips
  else if (species < 3.5) unused = true;                            // cushion: shells only
  else unused = false;                                              // coral: every instance, all strips
  if (age < 0.03 || unused) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // local frame, spun by a random yaw
  vec3 N = normalize(iNor);
  vec3 T0 = normalize(iTan - N * dot(iTan, N));
  vec3 B0 = cross(N, T0);
  float yaw = iSeed.x * 6.2831853;
  vec3 T = T0 * cos(yaw) + B0 * sin(yaw);
  vec3 B = cross(N, T);

  float grown = smoothstep(0.0, 1.0, age) * mix(1.0, 0.75, iDead); // dead moss sits lower
  vec3 C, D, across;
  float w;

  if (straw > 0.5) {
    // ---- grass straw: tall, very thin, a gentle lean and a slight S-curve
    // height and bend both random per straw: most stand nearly straight, a few lean hard
    // most straws short, a long tail of taller ones: quarter height is the norm, 4x is rare
    // straws on upward faces grow a lot longer
    float L = uLen * (0.6 + 4.0 * pow(iSeed.y, 4.0)) * (0.5 + 0.5 * grown) * mix(1.0, 2.2, upness);
    float bend = pow(hash(iSeed.x * 9.1 + iSeed.w * 3.3), 2.5) * 1.3;
    vec3 leanDir = T * bend;
    vec3 wob = B * 0.1 * L * hash(iSeed.z * 5.7 + iSeed.x * 2.9);
    C = N * t * L + leanDir * t * t * L * 0.7 + wob * sin(t * 4.0 + iSeed.w * 6.0);
    D = normalize(N * L + leanDir * 2.0 * t * L * 0.7 + wob * 4.0 * cos(t * 4.0 + iSeed.w * 6.0));
    across = normalize(cross(D, B));
    w = uWidth * 0.16 * (1.0 - 0.7 * t);
  } else if (species >= 1.5) {
    // ---- reindeer lichen: a curving stem with twigs forking off along its length.
    // Coral (green reindeer moss) is the same build: shorter, thicker, twigs spread wider into round clumps.
    float coral = step(3.5, species);
    // wide spread of heights, skewed short with a few tall ones poking out
    float L = uLichenLen * (0.5 + 1.1 * pow(iSeed.y, 1.4)) * (0.3 + 0.7 * grown) * mix(0.7, 1.0, clumpV) * mix(1.0, 0.7, coral);
    vec3 leanDir = T * (iSeed.z - 0.5) * 0.8;
    vec3 wob = B * 0.12 * L;
    if (strip < 0.5) {
      C = N * t * L + leanDir * t * t * L + wob * sin(t * 5.0 + iSeed.w * 6.0);
      D = normalize(N * L + leanDir * 2.0 * t * L + wob * 5.0 * cos(t * 5.0 + iSeed.w * 6.0));
      across = normalize(cross(D, B));
      w = uWidth * 0.5 * (1.0 - 0.5 * t) * mix(1.0, 1.25, coral);
    } else {
      float k = strip - 1.0;                                     // 0..6
      float h0 = 0.25 + 0.1 * k + 0.08 * hash(iSeed.z * 9.0 + k);
      vec3 root = N * h0 * L + leanDir * h0 * h0 * L + wob * sin(h0 * 5.0 + iSeed.w * 6.0);
      float ang = k * 2.4 + (hash(iSeed.w * 7.0 + k) - 0.5) * 1.2;
      vec3 side = T * cos(ang) + B * sin(ang);
      float elev = mix(0.55 + 0.5 * hash(iSeed.x * 3.0 + k), 0.25 + 0.55 * hash(iSeed.x * 3.0 + k), coral);
      float Lb = L * (0.45 + 0.3 * hash(iSeed.y * 5.0 + k)) * (1.15 - h0) * mix(1.0, 1.35, coral);
      vec3 d0 = normalize(side * cos(elev) + N * sin(elev));
      C = root + d0 * t * Lb + N * t * t * Lb * 0.25;
      D = normalize(d0 + N * t * 0.5);
      across = normalize(cross(D, side));
      w = uWidth * 0.36 * (1.0 - 0.75 * t) * mix(1.0, 1.2, coral);
    }
  } else if (species >= 0.5) {
    // ---- star moss: straight stem, rosette of stiff pointed leaves at the top
    float L = uStarLen * (0.6 + 0.4 * iSeed.y) * (0.3 + 0.7 * grown) * mix(0.55, 1.0, clumpV);
    vec3 leanDir = T * (iSeed.z - 0.5) * 0.5;
    if (strip < 0.5) {
      C = N * t * L + leanDir * t * t * L;
      D = normalize(N * L + leanDir * 2.0 * t * L);
      across = normalize(cross(D, B));
      w = uWidth * 0.3 * (1.0 - 0.3 * t);
    } else {
      float k = strip - 2.0;
      float ang = k * 1.0472 + (hash(iSeed.w * 7.0 + k) - 0.5) * 0.9;
      vec3 dir = T * cos(ang) + B * sin(ang);
      float elev = 0.2 + 0.45 * hash(iSeed.x * 3.0 + k);      // radians above the tangent plane
      float Ll = L * (0.6 + 0.3 * hash(iSeed.y * 5.0 + k));
      float h0 = 0.75 + 0.25 * hash(iSeed.z * 9.0 + k);       // where on the stem it sits
      vec3 top = N * h0 * L + leanDir * h0 * h0 * L;
      vec3 d0 = dir * cos(elev) + N * sin(elev);
      C = top + d0 * t * Ll - N * t * t * Ll * 0.25;            // slight droop
      D = normalize(d0 - N * t * 0.5);
      across = normalize(cross(D, N));
      w = uWidth * 0.6 * (1.0 - t);                             // pointed
    }
  } else {
  // ---- feather moss
  // same skewed height spread as the lichen, a bit tighter
  float L = uLen * (0.4 + 0.9 * pow(iSeed.y, 1.5)) * (0.35 + 0.65 * grown) * mix(0.45, 1.0, clumpV);
  float lean = 0.3 + 0.7 * iSeed.z;      // how far it tips over
  float hook = 0.4 + 0.6 * iSeed.w;      // how hard the tip curls back

  // main stem: rises, leans along T, tip hooks back down and sideways
  vec3 p0 = vec3(0.0);
  vec3 p1 = N * 0.45 * L + T * 0.12 * L * lean;
  vec3 p2 = N * 0.80 * L + T * 0.55 * L * lean + B * 0.1 * L;
  vec3 p3 = N * (0.80 - 0.35 * hook) * L + T * (0.55 + 0.35 * hook) * L * lean + B * 0.25 * L * (iSeed.w - 0.5);

  if (strip < 0.5) {
    C = bezier(p0, p1, p2, p3, t);
    D = bezierTangent(p0, p1, p2, p3, t);
  } else {
    // side branch leaving the stem at 45%, heading off to the side, smaller, own hook
    float tb = 0.45;
    vec3 root = bezier(p0, p1, p2, p3, tb);
    vec3 dir = normalize(bezierTangent(p0, p1, p2, p3, tb));
    vec3 side = normalize(B * (iSeed.z > 0.5 ? 1.0 : -1.0) + T * 0.3);
    float Lb = L * 0.5;
    vec3 q1 = root + (dir * 0.5 + side * 0.5) * Lb * 0.4;
    vec3 q2 = root + (dir * 0.3 + side * 0.9) * Lb * 0.8;
    vec3 q3 = root + (dir * -0.1 + side * 1.0) * Lb;
    C = bezier(root, q1, q2, q3, t);
    D = bezierTangent(root, q1, q2, q3, t);
  }
  D = normalize(D);
  across = normalize(cross(D, N + B * 0.3));

  // serrated, tapering leaf edge
  float serr = 0.55 + 0.45 * abs(sin(t * 22.0 + iSeed.y * 9.0));
  w = uWidth * (1.0 - 0.75 * t) * serr * (strip < 0.5 ? 1.0 : 0.65) * (0.5 + 0.5 * grown);
  }
  vec3 local = C + across * position.x * w;

  // ride the mound: same displacement the rock shells use
  float wCoral = max(0.0, 1.0 - c4);
  float cushW = wgt.w;
  float profileF = mix(age * age, 1.0 - (1.0 - age) * (1.0 - age), cushW);
  float pilF = mix(clumpV, mix(0.8, 1.0, clumpV), cushW);
  float bulge = profileF * mix(0.3, 1.0, pilF) * uBulge * (dot(wgt, vec4(1.0, 0.6, 0.5, 1.7)) + wCoral * 0.9) + puff * uBulge * 1.4 * smoothstep(0.0, 0.3, age);
  vec3 p = iPos + N * bulge + local;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * cross(D, across));
  vT = t;
  vAge = age;
  vHue = iSeed.x;
  vStrip = strip;
  vClump = clumpV;
  vSpecies = species;
  // yellow only as a sprinkle of single fronds; the area field is a darker-moss patch instead
  float sprinkle = step(0.9, hash(iSeed.w * 17.3 + iSeed.x * 4.1)) * (0.6 + 0.4 * iSeed.z);
  vDead = sprinkle;
  vShade = iDead;
  vStraw = straw;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frondFragment = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
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

varying vec3 vNormal;
varying vec3 vWorldPos;
varying float vT;
varying float vAge;
varying float vHue;
varying float vStrip;
varying float vClump;
varying float vSpecies;
varying float vDead;
varying float vShade;
varying float vStraw;


// colour grade for the moss only: a touch of exposure, saturation and contrast, in linear light
vec3 grade(vec3 c) {
  c *= 1.3;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.35);
  c = (c - 0.18) * 1.1 + 0.18;
  return max(c, 0.0);
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);

  vec3 root, tip, col;
  if (vStraw > 0.5) {
    // pale straw, lighter towards the tip
    root = vec3(0.10, 0.11, 0.03);
    tip = mix(vec3(0.34, 0.40, 0.12), vec3(0.42, 0.44, 0.18), vHue);
    col = mix(root, tip, pow(vT, 0.7));
  } else if (vSpecies >= 3.5) {
    // green reindeer moss: dark green in the clump, mid green twig tips
    root = vec3(0.004, 0.018, 0.004);
    tip = mix(vec3(0.07, 0.17, 0.035), vec3(0.11, 0.22, 0.05), vHue);
    col = mix(root, tip, smoothstep(0.1, 0.9, vT));
  } else if (vSpecies >= 1.5) {
    // reindeer lichen: pale sage, matte, brown at the very base
    root = vec3(0.14, 0.09, 0.04);
    tip = mix(vec3(0.42, 0.47, 0.30), vec3(0.50, 0.52, 0.34), vHue);
    col = mix(root, tip, smoothstep(0.0, 0.25, vT));
  } else if (vSpecies >= 0.5) {
    // star moss: reddish stem, deep green leaves, pale yellow-green tips
    bool stem = vStrip < 0.5;
    root = stem ? vec3(0.08, 0.03, 0.01) : vec3(0.015, 0.07, 0.01);
    vec3 tipOld = vec3(0.12, 0.32, 0.04);
    vec3 tipYoung = vec3(0.13, 0.19, 0.03);
    tip = mix(tipYoung, tipOld, smoothstep(0.2, 0.9, vAge));
    tip = mix(tip, vec3(0.05, 0.16, 0.02), vHue * 0.5);
    col = stem ? mix(root, vec3(0.05, 0.14, 0.02), vT) : mix(root, tip, pow(vT, 1.6));
    // pale tips on the leaves
    if (!stem) col = mix(col, vec3(0.28, 0.46, 0.09), smoothstep(0.7, 1.0, vT) * 0.55);
  } else {
    root = vec3(0.03, 0.03, 0.006);
    vec3 tipYoung = vec3(0.34, 0.33, 0.07);
    vec3 tipOld = vec3(0.22, 0.50, 0.045);
    tip = mix(tipYoung, tipOld, smoothstep(0.2, 0.9, vAge));
    tip = mix(tip, vec3(0.38, 0.42, 0.07), vHue * 0.35);
    col = mix(root, tip, pow(vT, 0.6));
  }

  // bleached patches: yellow-brown, a little paler at the tips
  vec3 deadCol = vSpecies >= 1.5 ? vec3(0.30, 0.24, 0.14) : mix(vec3(0.30, 0.20, 0.05), vec3(0.56, 0.44, 0.12), vT);
  deadCol *= 0.85 + 0.3 * vHue;
  col = mix(col, deadCol, vDead);
  tip = mix(tip, deadCol, vDead);
  // bright towards the top and on upward faces, darker down the sides; dark patches only low down
  float top = smoothstep(-0.4, 0.9, N.y) * 0.55 + smoothstep(-0.7, 1.9, vWorldPos.y) * 0.45;
  float bottomDark = mix(0.72, 1.0, smoothstep(-0.75, 0.5, vWorldPos.y));
  float lift = vSpecies >= 3.5 ? 0.5 : 1.0; // coral stays deep green even on top
  col *= mix(1.0 - 0.22 * lift, 1.0 + 0.22 * lift, top) * bottomDark;
  tip *= mix(1.0 - 0.22 * lift, 1.0 + 0.22 * lift, top) * bottomDark;
  float shade = vShade * (1.0 - 0.75 * top) * 0.8;
  col *= mix(1.0, 0.55, shade);
  tip *= mix(1.0, 0.6, shade);

  float ao = mix(0.3, 1.0, vT) * mix(0.85, 1.0, vClump);
  float shadow = shadowAt(vWorldPos, N);
  float wrap = pow(max(dot(N, L) * 0.65 + 0.35, 0.0), 1.4) * shadow;
  float back = max(dot(-N, L), 0.0) * 0.35; // leaves glow a bit when lit from behind
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.2;
  bool lichen = vSpecies >= 1.5 && vSpecies < 3.5;
  float gain = lichen ? 0.9 : (vSpecies >= 3.5 ? 0.8 : (vSpecies >= 0.5 ? 0.75 : 1.0));
  float ambient = lichen ? 0.55 : 0.34;  // lichen is matte, mostly ambient
  float wrapK = lichen ? 0.45 : 0.75;
  vec3 lit = col * ao * (ambient * mix(0.7, 1.0, shadow) + wrapK * wrap + back * shadow) * gain + tip * rim * shadow;
  gl_FragColor = vec4(grade(lit), 1.0);
  #include <colorspace_fragment>
}
`;
