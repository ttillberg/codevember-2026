import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mulberry32 } from '../bird/util';
import { MOUNTAIN_GEM } from '../bird/species';
import { phone } from '../device';
import type { PerchFrame } from '../bird/types';

// The perch: a mossy twig along X whose top passes through the origin, plus a
// side shoot with bright lime buds like in the footage.

// the twig's radius at x = 0: what the toes are built for (thinned to 0.45 of the first
// model, see model/thin.py)
const PERCH_R = MOUNTAIN_GEM.legs.perchRadius;

/** Where on the twig the bird sits (a little right of its middle, so more of the twig shows to the left). */
export const GRIP_X = 0.2;

/** The twig's radius at world x: PERCH_R at x = 0, thicker to the left. */
export function perchRadiusAt(x: number) {
  return PERCH_R * Math.min(1 - 0.18 * x, 2.2);
}

/** The stretch of twig, world x, the bird may hop along. */
export const PERCH_RANGE: [number, number] = [GRIP_X - 0.45, GRIP_X + 0.45];

/**
 * The perch frame at world x on this twig (its 'perch' mesh), for bird.setPerch.
 * A ray straight down over the twig's middle at x finds its top; the tangent and up
 * come from two neighbours. The twig never moves, so each x is cast once: the hop's
 * search asks the same handful of spots over and over.
 */
export function perchFrames(root: THREE.Object3D, range = PERCH_RANGE) {
  root.updateMatrixWorld(true);
  const src = root.getObjectByName('perch') as THREE.Mesh | undefined;
  // (only ever cast at, never drawn: nothing on the GPU to free when the twig is swapped)
  const mesh = src ? cropPerch(src, range[0] - 0.1, range[1] + 0.1) : null;
  // its vertices in world space, to find the middle of a slice across it
  const pts = mesh ? (mesh.geometry.getAttribute('position').clone().applyMatrix4(mesh.matrixWorld).array as Float32Array) : new Float32Array();
  const ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -1, 0);
  const hits: THREE.Intersection[] = [];
  const cache = new Map<number, PerchFrame | null>();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  /** the twig doesn't run along z = 0: it wanders back and forth, a few cm by the grip */
  function midZ(x: number) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.abs(pts[i] - x) > 0.006) continue;
      lo = Math.min(lo, pts[i + 2]);
      hi = Math.max(hi, pts[i + 2]);
    }
    return lo <= hi ? (lo + hi) / 2 : 0;
  }
  function top(x: number, out: THREE.Vector3) {
    if (!mesh) return null;
    ray.ray.origin.set(x, 2, midZ(x));
    hits.length = 0;
    ray.intersectObject(mesh, false, hits);
    const h = hits[0];
    return h ? out.copy(h.point) : null;
  }
  return (x: number, out: PerchFrame) => {
    const key = Math.round(x * 1000);
    let f = cache.get(key);
    if (f === undefined) {
      f = { point: new THREE.Vector3(), up: new THREE.Vector3(), tangent: new THREE.Vector3(), radius: perchRadiusAt(x) };
      if (top(x, f.point) && top(x - 0.03, pa) && top(x + 0.03, pb)) {
        f.tangent.copy(pb).sub(pa).normalize();
        f.up.set(0, 1, 0).addScaledVector(f.tangent, -f.tangent.y).normalize();
      } else f = null;
      cache.set(key, f);
    }
    if (!f) return null;
    out.point.copy(f.point);
    out.up.copy(f.up);
    out.tangent.copy(f.tangent);
    out.radius = f.radius;
    return out;
  };
}

// just the stretch of twig the bird can stand on, for the rays: the whole glb is ~50k
// triangles, and a hop's search casts a hundred rays at once
function cropPerch(mesh: THREE.Mesh, x0: number, x1: number) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const n = g.index ? g.index.count : pos.count;
  const at = (i: number) => (g.index ? g.index.getX(i) : i);
  const out: number[] = [];
  for (let t = 0; t < n; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const lo = Math.min(pos.getX(a), pos.getX(b), pos.getX(c));
    const hi = Math.max(pos.getX(a), pos.getX(b), pos.getX(c));
    if (hi < x0 || lo > x1) continue;
    for (const k of [a, b, c]) out.push(pos.getX(k), pos.getY(k), pos.getZ(k));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const m = new THREE.Mesh(geo, mesh.material);
  m.matrixAutoUpdate = false;
  m.matrixWorld.copy(mesh.matrixWorld);
  return m;
}

function tube(curve: THREE.Curve<THREE.Vector3>, radius: (u: number) => number, segs: number, radial: number, bumpSeed: number, rough = 0) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rng = mulberry32(bumpSeed);
  // (rough: old wood, more knots and burrs, a lumpy outline)
  const knots = Array.from({ length: 6 + Math.round(rough * 18) }, () => ({ u: rng(), a: rng() * Math.PI * 2, s: 0.25 + rng() * (0.35 + rough * 0.3) }));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      let r = radius(u);
      // bark ridges + a few knots
      r *= 1 + (1 + rough * 1.6) * (0.035 * Math.sin(a * 7 + u * 40) + 0.02 * Math.sin(a * 13 - u * 90));
      r *= 1 + rough * (0.1 * Math.sin(u * 23 + a * 2) + 0.07 * Math.sin(u * 61 - a * 3) + 0.05 * Math.sin(u * 131 + a));
      for (const k of knots) {
        const du = (u - k.u) * 18;
        const da = Math.cos(a - k.a);
        r *= 1 + k.s * Math.exp(-du * du) * Math.max(da, 0) ** 3;
      }
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      // (wound so the faces look out: the perch raycast and the normals need it)
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Ink, not bark. The limb is not lit: the fragment says how much ink the brush left there
 * and writes that as a grey (white = bare paper), which the grade then lays on the paper.
 * A loaded brush is dense at its two edges and thinner down the middle; where it runs dry
 * it skips in long streaks (flying white); short dark strokes go across for the texture
 * of old wood; and moss dots are dabbed on last. `thin` 0 = an old trunk in a broad wash,
 * 1 = a twig in one dark line.
 */
function barkMaterial(length: number, thin: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLen = { value: length };
    s.uniforms.uThin = { value: thin };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNor; varying vec2 vUv2;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * objectNormal); vUv2 = uv;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos; varying vec3 vWNor; varying vec2 vUv2; uniform float uLen; uniform float uThin;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `{
  // Everything here is laid out along the limb and round it, so it turns with the wood.
  float along = vUv2.x * uLen;
  float around = vUv2.y;
  vec3 wn = normalize(vWNor);
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
  float fresnel = pow(clamp(rim, 0.0, 1.0), 2.0);
  vec3 q = vec3(along, cos(around * 6.2832) * 0.16, sin(around * 6.2832) * 0.16) * 6.0;
  // ran: a first pale wash, uneven, heavier under the limb where it turns away
  float d = mix(0.3, 0.62, smoothstep(0.3, 0.7, fbm(q * vec3(0.16, 0.9, 0.9) + 1.0)));
  d += 0.3 * smoothstep(0.15, -0.8, wn.y);
  // cun: long broken fissures down the wood, in darker ink
  float r1 = 1.0 - abs(2.0 * n3(q * vec3(0.55, 9.0, 9.0) + 3.0 + 1.5 * fbm(q * vec3(0.5, 2.0, 2.0))) - 1.0);
  float fiss = smoothstep(0.78, 0.95, r1) * smoothstep(0.3, 0.52, fbm(q * vec3(0.12, 1.6, 1.6) + 13.0));
  d = max(d, 0.9 * fiss);
  // and short strokes across it, in patches
  float cun = smoothstep(0.56, 0.68, fbm(q * vec3(1.3, 2.4, 2.4) + 9.0)) * smoothstep(0.36, 0.58, fbm(q * vec3(0.28, 1.2, 1.2) + 21.0));
  d = max(d, 0.8 * cun);
  // scars where twigs were lost: a dark ring, pale wood inside
  vec2 sc = vec2(along * 1.25, around * 3.0);
  vec2 si = floor(sc);
  vec2 sf = fract(sc) - 0.5 + (vec2(h3(vec3(si, 1.0)), h3(vec3(si, 2.0))) - 0.5) * 0.3;
  float rr = length(sf * vec2(1.0, 0.75));
  float scar = step(0.7, h3(vec3(si, 7.0)));
  d = mix(d, 0.08, scar * (1.0 - smoothstep(0.1, 0.17, rr)));
  d = max(d, scar * 0.9 * (1.0 - smoothstep(0.025, 0.06, abs(rr - 0.2))));
  // flying white: the brush runs dry in streaks
  d *= 1.0 - 0.6 * smoothstep(0.58, 0.72, fbm(q * vec3(0.2, 7.0, 7.0) + 5.0)) * (1.0 - fiss);
  // gou: the contour, drawn round it all
  d = max(d, 0.97 * smoothstep(0.42, 0.75, rim));
  // a twig is one loaded stroke, paler where the brush lifted
  d = mix(d, mix(0.7, 1.0, smoothstep(0.3, 0.6, fbm(vec3(along * 3.0, 0.0, 4.0)))), uThin);
  // dian: moss dots dabbed on last, gathered on the upper side, big and small
  float gather = smoothstep(0.42, 0.6, fbm(vWPos * 1.6 + 5.0)) * smoothstep(-0.3, 0.5, wn.y);
  for (int k = 0; k < 2; k++) {
    vec3 cell = vWPos * (k == 0 ? 6.5 : 14.0) + float(k) * 17.0;
    vec3 ci = floor(cell);
    vec3 cf = fract(cell) - 0.5 + (vec3(h3(ci + 1.3), h3(ci + 2.7), h3(ci + 4.1)) - 0.5) * 0.45;
    float dab = (1.0 - smoothstep(0.15, 0.26, length(cf))) * step(0.8, h3(ci)) * gather;
    d = max(d, dab * (1.0 - 0.85 * uThin));
  }
  d = clamp(d, 0.0, 1.0);
  // Ink-black wood first; only the driest brush streaks lift to a pale
  // structural highlight, like the white grain on a plum branch.
  float wash = clamp(1.3 * pow(1.0 - d, 2.4), 0.0, 1.0);
  float broadGrain = smoothstep(0.72, 0.9, wash) * 0.14;
  float fissureGrain = smoothstep(0.72, 0.96, fiss) * 0.1;
  float crossGrain = smoothstep(0.72, 0.94, cun) * 0.06;
  // A second, finer noise pass keeps the white structure from reading as a
  // single contour line and gives the bark a layered, fibrous direction.
  float fineGrain = 1.0 - abs(2.0 * n3(q * vec3(0.34, 15.0, 15.0) + 27.0) - 1.0);
  fineGrain = smoothstep(0.86, 0.98, fineGrain) * smoothstep(0.24, 0.82, fbm(q * vec3(0.22, 1.4, 1.4) + 31.0)) * 0.08;
  float edgeGrain = smoothstep(0.68, 0.96, fresnel) * 0.16;
  float highlight = clamp(broadGrain + fissureGrain + crossGrain + fineGrain + edgeGrain, 0.0, 1.0);
  vec3 darkWood = vec3(0.028, 0.018, 0.017);
  vec3 midWood = vec3(0.09, 0.055, 0.05);
  vec3 paleGrain = vec3(0.68, 0.7, 0.67);
  vec3 wood = mix(darkWood, midWood, smoothstep(0.22, 0.68, wash) * 0.55);
  gl_FragColor.rgb = mix(wood, paleGrain, highlight);
}
#include <dithering_fragment>`,
      );
  };
  return m;
}

export function createBranch() {
  const group = new THREE.Group();
  const sm = THREE.MathUtils.smoothstep;
  // the perch: a side branch of the old trunk, running out to the left and thinning to a
  // tip. Where the bird can stand its radius is perchRadiusAt, as the toes expect.
  const perch = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.0, -1.414, -0.927),
    new THREE.Vector3(-3.2, -0.709, -0.364),
    new THREE.Vector3(-1.4, -0.312, -0.11),
    new THREE.Vector3(-0.7, -0.199, -0.039),
    new THREE.Vector3(0, -0.041, 0),
    new THREE.Vector3(0.5, 0.059, 0.072),
    new THREE.Vector3(0.9, 0.142, 0.113),
    new THREE.Vector3(1.3, 0.193, 0.077),
    new THREE.Vector3(1.8, 0.24, 0.04),
  ]);
  const len = perch.getLength();
  const tmp = new THREE.Vector3();
  const perchR = (x: number) => {
    let r = perchRadiusAt(x);
    if (x < -0.6) r *= Math.max(Math.pow(sm(x, -2.9, -0.6), 0.75), 0.02);
    if (x > 1.25) r *= 1 - 0.75 * sm(x, 1.25, 1.8);
    return r;
  };
  const mPerch = new THREE.Mesh(tube(perch, (u) => perchR(perch.getPointAt(u, tmp).x), 320, 28, 3, 0.25), barkMaterial(len, 0.4));
  mPerch.name = 'perch';
  group.add(mPerch);

  // the old trunk: up from the lower left behind the perch, through its root, on up and out of the picture
  const trunk = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.5, -2.5, -0.65),
    new THREE.Vector3(-0.5, -1.75, -0.5),
    new THREE.Vector3(0.25, -1.25, -0.52),
    new THREE.Vector3(0.6, -0.6, -0.34),
    new THREE.Vector3(1.05, -0.2, -0.2),
    new THREE.Vector3(1.2, 0.15, -0.04),
    new THREE.Vector3(1.44, 0.6, -0.08),
    new THREE.Vector3(1.3, 1.05, -0.12),
    new THREE.Vector3(1.2, 1.4, -0.16),
    new THREE.Vector3(1.45, 1.9, -0.2),
    new THREE.Vector3(1.3, 2.7, -0.25),
  ], false, 'catmullrom', 0.3);
  const trunkLen = trunk.getLength();
  const trunkR = (u: number) => 0.175 - 0.125 * Math.pow(u, 0.75);
  group.add(new THREE.Mesh(tube(trunk, trunkR, 320, 26, 11, 1), barkMaterial(trunkLen, 0)));
  // stumps where limbs broke off long ago
  const stumpMat = barkMaterial(0.3, 0.12);
  const stump = (at: THREE.Vector3, dir: THREE.Vector3, L: number, r: number, seed: number) => {
    const c = new THREE.LineCurve3(at.clone(), at.clone().addScaledVector(dir.normalize(), L));
    group.add(new THREE.Mesh(tube(c, (u) => r * (1 - 0.25 * u) * (1 - 0.95 * THREE.MathUtils.smoothstep(u, 0.86, 1)), 10, 12, seed, 0.6), stumpMat));
  };
  stump(trunk.getPointAt(0.2), new THREE.Vector3(0.7, 0.5, 0.5), 0.16, 0.06, 31);
  stump(trunk.getPointAt(0.36), new THREE.Vector3(-0.8, 0.3, 0.5), 0.13, 0.055, 32);
  stump(trunk.getPointAt(0.5), new THREE.Vector3(0.9, -0.1, 0.4), 0.12, 0.045, 33);
  stump(trunk.getPointAt(0.7), new THREE.Vector3(0.8, 0.3, -0.4), 0.11, 0.035, 34);
  stump(trunk.getPointAt(0.84), new THREE.Vector3(-0.8, 0.2, 0.5), 0.09, 0.028, 35);
  // a second limb forking off it above the perch
  const limb = new THREE.CatmullRomCurve3([
    trunk.getPointAt(0.56),
    new THREE.Vector3(1.02, 0.98, 0.1),
    new THREE.Vector3(0.9, 1.4, 0.16),
    new THREE.Vector3(1.0, 1.85, 0.12),
  ], false, 'catmullrom', 0.3);
  group.add(new THREE.Mesh(tube(limb, (u) => 0.06 - 0.044 * u, 100, 14, 17, 0.6), barkMaterial(limb.getLength(), 0.3)));

  // --- twigs and blossom ---------------------------------------------------------
  const rng = mulberry32(21);
  const twigMat = barkMaterial(1, 1);
  // every flower, bud and calyx goes into one mesh: flat pigment, a vertex colour each
  const P: number[] = [];
  const C: number[] = [];
  const A: number[] = [];
  const v = new THREE.Vector3();
  const put3 = (m: THREE.Matrix4, x: number, y: number, z: number, c: THREE.Color, ao = 1) => {
    v.set(x, y, z).applyMatrix4(m);
    P.push(v.x, v.y, v.z);
    C.push(c.r, c.g, c.b);
    A.push(ao);
  };
  // White plum blossoms: keep a small warm/cool range so the petals read as
  // layered paper instead of a single flat white disc against the red wall.
  const tones = [0xf4f1e7, 0xffffff, 0xd8d6cc, 0xe7e5db, 0xfffdf4].map((h) => new THREE.Color(h));
  const heartCol = new THREE.Color(0x4a070c);
  const stamenCol = new THREE.Color(0xe6b33f);
  const calyxCol = new THREE.Color(0x1a0f0c);
  const pale = new THREE.Color();
  const deep = new THREE.Color();
  /** five round petals about a dark heart, in the XY plane facing +Z; cup 0 = wide open, 1 = half closed */
  const flower = (m: THREE.Matrix4, tone: THREE.Color, cup: number) => {
    const SEG = 10;
    const off = 0.62 * (1 - 0.4 * cup);
    const rad = 0.46 * (1 - 0.2 * cup);
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI * 2 + 0.3;
      const cx = Math.cos(a0) * off;
      const cy = Math.sin(a0) * off;
      // each petal its own water: paler in the middle, the pigment gone to the rim
      pale.copy(tone).lerp(tones[4], 0.35 + rng() * 0.4);
      deep.copy(tone).multiplyScalar(0.8 + rng() * 0.3);
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const b = ((i + 1) / SEG) * Math.PI * 2;
        const za = 0.1 + cup * 0.75 * (0.6 + 0.4 * Math.cos(a - a0));
        const zb = 0.1 + cup * 0.75 * (0.6 + 0.4 * Math.cos(b - a0));
        // Darken the folded root of each petal to fake contact occlusion;
        // the outer rim stays brighter so the five-petal structure separates.
        put3(m, cx, cy, 0.05 + cup * 0.35, pale, 0.42 - cup * 0.08);
        put3(m, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, za, deep, 0.96);
        put3(m, cx + Math.cos(b) * rad, cy + Math.sin(b) * rad, zb, deep, 0.96);
      }
    }
    // the heart, and a ring of stamen dots round it
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = ((i + 1) / 8) * Math.PI * 2;
      put3(m, 0, 0, 0.16, heartCol);
      put3(m, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.16, stamenCol);
      put3(m, Math.cos(b) * 0.2, Math.sin(b) * 0.2, 0.16, stamenCol);
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng();
      const r = 0.34 + rng() * 0.16;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      put3(m, x, y + 0.05, 0.2, stamenCol);
      put3(m, x - 0.045, y - 0.03, 0.2, stamenCol);
      put3(m, x + 0.045, y - 0.03, 0.2, stamenCol);
    }
  };
  const ball = new THREE.IcosahedronGeometry(1, 1).getAttribute('position');
  const sphere = (m: THREE.Matrix4, c: THREE.Color) => {
    for (let i = 0; i < ball.count; i++) put3(m, ball.getX(i), ball.getY(i), ball.getZ(i), c);
  };
  // every twig and spur goes into one mesh too (hundreds of meshes took a minute to compile, one a frame)
  const TP: number[] = [];
  const TU: number[] = [];
  const TI: number[] = [];
  const inkAdd = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const base = TP.length / 3;
    for (let i = 0; i < pos.count; i++) {
      TP.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      TU.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) TI.push(base + idx.getX(i));
    g.dispose();
  };
  // the nodes of the twigs (where a bud or a leaf was): small bumps of ink, one mesh
  const NP: number[] = [];
  const node = (at: THREE.Vector3, r: number) => {
    for (let i = 0; i < ball.count; i++) NP.push(at.x + ball.getX(i) * r, at.y + ball.getY(i) * r * 0.8, at.z + ball.getZ(i) * r);
  };
  const zAxis = new THREE.Vector3(0, 0, 1);
  const face = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  const flowerScaleRng = mulberry32(97);
  const flowerRanges: { start: number; end: number; anchor: THREE.Vector3; variation: number }[] = [];
  /** a blossom at `at`, growing from `stem` (the point of the twig under it) */
  const blossom = (at: THREE.Vector3, stem: THREE.Vector3, kind: number) => {
    const start = P.length / 3;
    const variation = 0.65 + flowerScaleRng() * 0.7;
    const tone = tones[Math.floor(rng() * 4)];
    if (kind < 0.3) {
      // a bud: a red bead in a dark calyx
      const r = 0.013 + rng() * 0.011;
      sphere(mat4.compose(at, quat.identity(), scl.set(r, r * 1.1, r)), tone);
      face.copy(stem).sub(at).normalize();
      sphere(mat4.compose(at.clone().addScaledVector(face, r * 0.75), quat.identity(), scl.setScalar(r * 0.72)), calyxCol);
      flowerRanges.push({ start, end: P.length / 3, anchor: at.clone(), variation });
      return;
    }
    // open flowers face the painter, each a little its own way; half-open ones turn aside
    const cup = kind < 0.55 ? 0.6 + rng() * 0.4 : rng() * 0.2;
    face.set((rng() - 0.35) * (1.2 + cup), (rng() - 0.4) * (1.0 + cup), 1).normalize();
    quat.setFromUnitVectors(zAxis, face).multiply(spin.setFromAxisAngle(zAxis, rng() * Math.PI * 2));
    const size = (0.042 + rng() * 0.032) * (1 - 0.2 * cup);
    flower(mat4.compose(at.clone().addScaledVector(face, 0.018), quat, scl.setScalar(size)), tone, cup);
    // its calyx, behind
    sphere(mat4.compose(at.clone().addScaledVector(face, -0.004), quat, scl.setScalar(size * 0.3)), calyxCol);
    flowerRanges.push({ start, end: P.length / 3, anchor: at.clone(), variation });
  };
  /**
   * A twig from `from` along `dir`, kinked the way plum wood grows; short thorny spurs off
   * it, blossom in clusters along it (`bloom` 0..1 how thickly), and a side twig or two.
   */
  const birdClear = (p: THREE.Vector3) => {
    const dx = (p.x - GRIP_X) / 0.82;
    const dy = (p.y - 0.64) / 1.08;
    const dz = p.z / 0.68;
    return dx * dx + dy * dy + dz * dz < 1;
  };
  const twig = (
    from: THREE.Vector3,
    dir: THREE.Vector3,
    length: number,
    r0: number,
    depth: number,
    bloom: number,
    kink = 0.6,
    avoidBird = false,
  ) => {
    const pts = [from.clone()];
    const d = dir.clone().normalize();
    const p = from.clone();
    const N = 5;
    for (let i = 1; i <= N; i++) {
      d.add(new THREE.Vector3(rng() - 0.5, rng() - 0.3, (rng() - 0.5) * 0.5).multiplyScalar(kink)).normalize();
      p.addScaledVector(d, (length / N) * (0.7 + rng() * 0.6));
      pts.push(p.clone());
    }
    // (low tension: the kinks stay kinks)
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.12);
    const q = new THREE.Vector3();
    if (avoidBird) {
      for (let i = 0; i <= 12; i++) {
        if (birdClear(curve.getPointAt(i / 12, q))) return;
      }
    }
    inkAdd(tube(curve, (u) => r0 * (1 - u * 0.8), 48, 7, Math.floor(rng() * 1e6)));
    const t = new THREE.Vector3();
    for (let i = 0, nn = Math.round(length * 11); i < nn; i++) {
      const u = 0.05 + rng() * 0.9;
      node(curve.getPointAt(u, q), r0 * (1 - u * 0.8) * (1.5 + rng() * 0.7));
    }
    // spurs: stubs a few cm long, square off the twig
    const spurs = Math.round(length * 7 * (kink / 0.6));
    for (let i = 0; i < spurs; i++) {
      const u = 0.1 + rng() * 0.85;
      curve.getPointAt(u, q);
      curve.getTangentAt(u, t);
      const out = new THREE.Vector3(rng() - 0.5, rng() - 0.5, (rng() - 0.5) * 0.6).cross(t).normalize().addScaledVector(t, 0.3).normalize();
      const L = 0.03 + rng() * 0.06;
      const tip = q.clone().addScaledVector(out, L);
      const spur = new THREE.LineCurve3(q.clone(), tip);
      inkAdd(tube(spur, (uu) => r0 * (1 - u * 0.8) * 0.6 * (1 - uu * 0.85), 4, 5, 1));
      if (rng() < bloom) blossom(tip, q, rng());
    }
    // blossom in clusters: a knot of them, a gap, another
    const clusters = Math.max(1, Math.round(length * 4.2 * bloom));
    for (let c = 0; c < clusters; c++) {
      const u = 0.12 + ((c + rng() * 0.7) / clusters) * 0.88;
      curve.getPointAt(Math.min(u, 1), q);
      const n = 1 + Math.floor(rng() * rng() * 3.5);
      for (let k = 0; k < n; k++) {
        const at = q.clone().add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, (rng() - 0.3) * 0.8).multiplyScalar(0.03 + 0.07 * k));
        // buds toward the tip of the twig, open flowers lower down
        blossom(at, q, Math.min(rng() + (1 - u) * 0.45, 1));
      }
    }
    if (depth < 2) {
      for (const u of depth ? [0.5] : [0.3, 0.55, 0.8]) {
        if (rng() < 0.25) continue;
        curve.getPointAt(u, q);
        curve.getTangentAt(u, t);
        const out = new THREE.Vector3(rng() - 0.5, rng() - 0.25, (rng() - 0.5) * 0.5).normalize().multiplyScalar(0.95).addScaledVector(t, 0.45);
        twig(q.clone(), out, length * (0.3 + rng() * 0.3), r0 * (1 - u * 0.8) * 0.75, depth + 1, bloom, 0.6, avoidBird);
      }
    }
  };
  // twigs off the perch, clear of the stretch the bird hops along
  const onPerch = (x: number) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i <= 400; i++) {
      const e = Math.abs(perch.getPointAt(i / 400, tmp).x - x);
      if (e < bd) {
        bd = e;
        best = i / 400;
      }
    }
    return perch.getPointAt(best, new THREE.Vector3());
  };
  twig(onPerch(0.92), new THREE.Vector3(-0.1, 1, 0.25), 0.5, 0.014, 0, 0.9);
  twig(onPerch(-0.45), new THREE.Vector3(-0.3, 1, 0.15), 0.6, 0.016, 0, 0.8);
  twig(onPerch(-0.8), new THREE.Vector3(-0.35, -0.8, 0.3), 0.55, 0.015, 0, 1);
  twig(onPerch(-1.3), new THREE.Vector3(-0.1, 1, -0.05), 0.75, 0.017, 0, 0.9);
  twig(onPerch(-1.75), new THREE.Vector3(-0.6, -0.5, 0.2), 0.5, 0.013, 0, 1);
  twig(onPerch(-2.2), new THREE.Vector3(-0.5, 0.8, 0.1), 0.6, 0.012, 0, 0.8);
  // Rightward plum shoots: different lengths, gauges and kinks make them read
  // as grown branches rather than repeated copies. In this camera, -X/+Z is
  // the painter-facing direction marked in the composition.
  twig(trunk.getPointAt(0.48), new THREE.Vector3(-1.1, 0.14, 0.38), 1.05, 0.018, 0, 0.82, 0.78, true);
  twig(trunk.getPointAt(0.63), new THREE.Vector3(-0.9, 0.34, 0.48), 0.84, 0.015, 0, 0.76, 0.7, true);
  twig(limb.getPointAt(0.56), new THREE.Vector3(-1.05, -0.04, 0.3), 0.74, 0.013, 0, 0.7, 0.82, true);
  twig(onPerch(-0.05), new THREE.Vector3(-0.82, 0.2, 0.42), 0.64, 0.012, 0, 0.62, 0.7, true);
  twig(onPerch(GRIP_X + 0.05), new THREE.Vector3(-1.2, 0.06, 0.34), 1.35, 0.018, 0, 0.55, 0.62, true);
  twig(trunk.getPointAt(0.58), new THREE.Vector3(-1.15, 0.22, 0.42), 1.15, 0.016, 0, 0.62, 0.68, true);
  // off the trunk: the lower left full of blossom, the top right fuller still
  twig(trunk.getPointAt(0.2), new THREE.Vector3(-0.9, 0.5, 0.5), 0.8, 0.02, 0, 1);
  twig(trunk.getPointAt(0.3), new THREE.Vector3(0.9, 0.1, 0.4), 0.5, 0.016, 0, 0.9);
  twig(trunk.getPointAt(0.38), new THREE.Vector3(-0.7, -0.5, 0.5), 0.5, 0.016, 0, 1);
  twig(trunk.getPointAt(0.66), new THREE.Vector3(0.8, 0.5, 0.3), 0.7, 0.018, 0, 1);
  twig(trunk.getPointAt(0.8), new THREE.Vector3(-0.6, 0.8, 0.4), 0.6, 0.016, 0, 1);
  twig(trunk.getPointAt(0.9), new THREE.Vector3(0.7, 0.7, 0.3), 0.6, 0.015, 0, 1);
  twig(limb.getPointAt(0.45), new THREE.Vector3(-0.8, 0.4, 0.3), 0.55, 0.014, 0, 1);
  twig(limb.getPointAt(1), new THREE.Vector3(-0.2, 1, 0.1), 0.6, 0.014, 0, 1);

  // Two visible scaffold limbs fill the empty left and right sides of the
  // painter's view. They start at different heights and use the same recursive
  // twig growth, so each one tapers, kinks and forks naturally.
  twig(trunk.getPointAt(0.43), new THREE.Vector3(1.2, 0.05, -0.3), 1.55, 0.024, 0, 0.5, 0.58, true);
  twig(trunk.getPointAt(0.61), new THREE.Vector3(-1.2, 0.08, 0.34), 1.6, 0.023, 0, 0.52, 0.58, true);
  twig(trunk.getPointAt(0.73), new THREE.Vector3(0.98, 0.24, -0.24), 1.2, 0.017, 0, 0.46, 0.65, true);
  twig(trunk.getPointAt(0.34), new THREE.Vector3(-0.96, 0.22, 0.3), 1.1, 0.016, 0, 0.48, 0.65, true);

  // Depth branches: the perch is the X axis and the bird stands on Y, so
  // these shoots deliberately grow along both Z directions. Their staggered
  // anchors keep some twigs close to the lens and others behind the bird as
  // the camera orbits, giving the depth-of-field pass real foreground layers.
  twig(onPerch(-1.35), new THREE.Vector3(-0.12, 0.24, 1.0), 1.45, 0.015, 0, 0.62, 0.56, true);
  twig(onPerch(-1.85), new THREE.Vector3(0.1, 0.16, -1.0), 1.2, 0.012, 0, 0.52, 0.62, true);
  twig(onPerch(1.12), new THREE.Vector3(0.08, 0.3, -1.0), 1.1, 0.014, 0, 0.58, 0.58, true);
  twig(trunk.getPointAt(0.78), new THREE.Vector3(-0.12, 0.28, 1.0), 1.3, 0.016, 0, 0.56, 0.62, true);
  twig(trunk.getPointAt(0.28), new THREE.Vector3(0.16, 0.2, -1.0), 1.05, 0.013, 0, 0.5, 0.6, true);
  twig(limb.getPointAt(0.72), new THREE.Vector3(-0.06, 0.25, 1.0), 0.98, 0.012, 0, 0.48, 0.6, true);

  // this year's long shoots: thin, nearly straight, a few buds, standing up off the old wood
  twig(onPerch(-0.62), new THREE.Vector3(0.1, 1, 0.1), 0.95, 0.008, 2, 0.35, 0.16);
  twig(onPerch(-1.05), new THREE.Vector3(-0.25, 1, 0.2), 0.8, 0.007, 2, 0.3, 0.16);
  twig(onPerch(-1.6), new THREE.Vector3(0.15, 1, -0.1), 0.7, 0.007, 2, 0.35, 0.16);
  twig(onPerch(1.05), new THREE.Vector3(-0.3, 1, 0.3), 0.75, 0.007, 2, 0.3, 0.16);
  twig(trunk.getPointAt(0.45), new THREE.Vector3(-0.7, 0.7, 0.4), 0.9, 0.009, 2, 0.4, 0.16);
  twig(trunk.getPointAt(0.6), new THREE.Vector3(0.6, 0.8, 0.4), 0.8, 0.008, 2, 0.35, 0.16);
  twig(trunk.getPointAt(0.76), new THREE.Vector3(0.3, 1, 0.5), 0.7, 0.007, 2, 0.4, 0.16);
  twig(limb.getPointAt(0.7), new THREE.Vector3(0.5, 0.8, 0.3), 0.7, 0.007, 2, 0.4, 0.16);
  twig(trunk.getPointAt(0.26), new THREE.Vector3(-0.5, 0.9, 0.5), 0.85, 0.008, 2, 0.35, 0.16);

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(TP, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(TU, 2));
  tg.setIndex(TI);
  tg.computeVertexNormals();
  group.add(new THREE.Mesh(tg, twigMat));
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(NP, 3));
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((NP.length / 3) * 2), 2));
  ng.computeVertexNormals();
  group.add(new THREE.Mesh(ng, twigMat));

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  bg.setAttribute('aAO', new THREE.Float32BufferAttribute(A, 1));
  const blossomMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  blossomMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.58, 1.0, vAO);');
  };
  const blossoms = new THREE.Mesh(bg, blossomMaterial);
  blossoms.name = 'blossoms';
  group.add(blossoms);

  const flowerBase = new Float32Array(P);
  const flowerPosition = bg.getAttribute('position') as THREE.BufferAttribute;
  let flowerScalePercent = 100;
  let flowerRandomPercent = 0;
  let flowerCountPercent = 100;
  const applyFlowerScale = () => {
    const scale = flowerScalePercent / 100;
    const random = flowerRandomPercent / 100;
    const visibleCount = Math.ceil((flowerRanges.length * flowerCountPercent) / 100);
    for (let rangeIndex = 0; rangeIndex < flowerRanges.length; rangeIndex++) {
      const range = flowerRanges[rangeIndex];
      const { anchor } = range;
      // 100% random varies each flower by up to ±35%; 0% keeps the
      // current base size exactly.
      const factor = rangeIndex < visibleCount ? scale * THREE.MathUtils.lerp(1, range.variation, random) : 0;
      for (let i = range.start; i < range.end; i++) {
        const j = i * 3;
        flowerPosition.setXYZ(
          i,
          anchor.x + (flowerBase[j] - anchor.x) * factor,
          anchor.y + (flowerBase[j + 1] - anchor.y) * factor,
          anchor.z + (flowerBase[j + 2] - anchor.z) * factor,
        );
      }
    }
    flowerPosition.needsUpdate = true;
  };
  const setFlowerScale = (percent: number) => {
    flowerScalePercent = THREE.MathUtils.clamp(percent, 0, 100);
    applyFlowerScale();
  };
  const setFlowerRandom = (percent: number) => {
    flowerRandomPercent = THREE.MathUtils.clamp(percent, 0, 100);
    applyFlowerScale();
  };
  const setFlowerCount = (percent: number) => {
    flowerCountPercent = THREE.MathUtils.clamp(percent, 0, 100);
    applyFlowerScale();
  };
  applyFlowerScale();

  return { group, setFlowerScale, setFlowerRandom, setFlowerCount };
}

// The Blender perch (model/branch.blend → public/branch.glb), with baked bark,
// moss and buds. Same contract as the procedural one: radius PERCH_R at x = 0,
// top surface through the origin.
export async function loadBranch(url: string, onProgress?: (e: ProgressEvent) => void) {
  const gltf = await new GLTFLoader().loadAsync(url, onProgress);
  const group = gltf.scene;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    // the big twig self-shadowed into bands at the shadow frustum edge; small parts cast
    m.castShadow = !/perch|hairs/i.test(m.name);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      // colour, AO (ORM r) and root-to-tip darkening are all baked in the glb
      s.envMapIntensity = 0.8;
    }
  });
  // the twig's felt, moss and fine hairs are made here, not in the glb (baked cards read as straw and fir trees)
  const perch = group.getObjectByName('perch') as THREE.Mesh | undefined;
  let fuzz: THREE.Object3D | null = null;
  if (perch) {
    fuzz = fuzzShells(perch);
    group.add(fuzz);
    // and the fine pale hairs the flowers have, on the twig too
    const flowerHairs = group.getObjectByName('hairs') as THREE.Mesh | undefined;
    if (flowerHairs) group.add(fineHairs(perch, flowerHairs.material as THREE.Material));
  }
  return { group, fuzz };
}

function put(a: Float32Array, i: number, x: number, y: number, z: number) {
  a[i] = x;
  a[i + 1] = y;
  a[i + 2] = z;
}

// Fine hairs, one thin tapered triangle each, scattered over the twig and
// leaning along it, like the ones on the shoot and flowers (same material).
function fineHairs(perch: THREE.Mesh, material: THREE.Material) {
  const COUNT = phone ? 7000 : 16000;
  const sampler = new MeshSurfaceSampler(perch).build();
  const rng = mulberry32(31);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  // filled in place and trimmed after: growing arrays of a hundred thousand numbers held up the loader
  const pos = new Float32Array(COUNT * 9);
  const nor = new Float32Array(COUNT * 9);
  const uv = new Float32Array(COUNT * 6);
  let made = 0;
  for (let tries = 0; made < COUNT && tries < COUNT * 4; tries++) {
    sampler.sample(p, n);
    // none where the toes grip, few on the old woody end and underneath
    if (Math.abs(p.x - GRIP_X) < 0.17 || p.x < -2.8) continue;
    if (n.y < -0.3 && rng() < 0.7) continue;
    t.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(n).normalize();
    b.crossVectors(n, t);
    const lean = 0.45 + rng() * 0.5; // 0 = upright, 1 = flat on the bark
    const len = 0.005 + rng() * rng() * 0.014;
    dir.copy(n).multiplyScalar(1 - lean).addScaledVector(t, lean).normalize();
    const w = 0.00045 + rng() * 0.0003;
    const base = p.addScaledVector(n, -0.001);
    const o = made * 9;
    put(pos, o, base.x - b.x * w, base.y - b.y * w, base.z - b.z * w);
    put(pos, o + 3, base.x + b.x * w, base.y + b.y * w, base.z + b.z * w);
    put(pos, o + 6, base.x + dir.x * len, base.y + dir.y * len, base.z + dir.z * len);
    for (let k = 0; k < 9; k += 3) put(nor, o + k, n.x, n.y, n.z);
    // the flower hairs' gradient texture runs root (v = 0) to tip (v = 1): (0, 0) (1, 0) (0.5, 1), zeros already there
    uv[made * 6 + 2] = 1;
    uv[made * 6 + 4] = 0.5;
    uv[made * 6 + 5] = 1;
    made++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, made * 9), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, made * 9), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv.slice(0, made * 6), 2));
  const m = new THREE.Mesh(g, material);
  m.name = 'twig.hairs';
  m.position.copy(perch.position);
  m.quaternion.copy(perch.quaternion);
  m.scale.copy(perch.scale);
  m.receiveShadow = true;
  return m;
}

// Felt on the twig: N copies of the perch surface pushed out along the normal,
// each keeping only the strands that reach that high. Strands are cells of 3D
// noise that wander sideways as they rise, so they curl and tangle instead of
// standing straight. Colour comes from the bark under it, dark at the root,
// paler and warmer at the tip. Alpha to coverage softens the fibre edges.
const SHELLS = phone ? 7 : 14;
const FUZZ_H = 0.03; // moss height; the felt only reaches ~0.014 of it
/** left of this the felt is gone (vGrip is 0 from x = -3.2), so no shell draws there */
const FELT_X0 = -3.25;

// The shells' own perch: only the triangles the felt can reach. The rest were drawn
// SHELLS times over only to be thrown away. Same vertex buffers, a shorter index.
function feltGeometry(src: THREE.BufferGeometry) {
  const pos = src.getAttribute('position');
  const n = src.index ? src.index.count : pos.count;
  const at = (i: number) => (src.index ? src.index.getX(i) : i);
  const idx = new Uint32Array(n);
  let k = 0;
  for (let t = 0; t < n; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    if (Math.max(pos.getX(a), pos.getX(b), pos.getX(c)) <= FELT_X0) continue;
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  for (const name in src.attributes) g.setAttribute(name, src.attributes[name]);
  g.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? idx.slice(0, k) : Uint16Array.from(idx.subarray(0, k)), 1));
  return g;
}

function fuzzShells(perch: THREE.Mesh) {
  const src = perch.material as THREE.MeshStandardMaterial;
  const geo = feltGeometry(perch.geometry);
  const group = new THREE.Group();
  group.name = 'fuzz';
  for (let i = 1; i <= SHELLS; i++) {
    const h = i / SHELLS;
    const mat = new THREE.MeshStandardMaterial({
      map: src.map,
      normalMap: src.normalMap,
      color: new THREE.Color(1, 1, 1),
      roughness: 1,
      metalness: 0,
      alphaTest: 0.5,
      alphaToCoverage: true,
      envMapIntensity: 0.6,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uH = { value: h };
      sh.uniforms.uLen = { value: FUZZ_H };
      sh.uniforms.uGrip = { value: GRIP_X };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uH; uniform float uLen; uniform float uGrip; varying vec3 vFP; varying float vGrip;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           // no felt where the toes grip, and it thins out toward the old woody left end
           float gx = abs(position.x - uGrip);
           vGrip = mix(0.22, 1.0, smoothstep(0.14, 0.24, gx)) * (1.0 - smoothstep(-2.6, -3.2, position.x));
           transformed += objectNormal * uH * uLen * vGrip;
           vFP = position;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uH; varying vec3 vFP; varying float vGrip;
           float fh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
           float fn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
             return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `{
             // strands wander as they rise, so each one curls
             vec3 q = vFP * 520.0;
             q += vec3(fn(vFP * 90.0), fn(vFP * 90.0 + 7.3), fn(vFP * 90.0 + 3.1)) * 3.0 * uH;
             vec3 c = floor(q);
             vec3 f = fract(q) - 0.5;
             // moss where the baked bark is green: cushions, taller, denser
             float green = smoothstep(0.004, 0.03, diffuseColor.g - max(diffuseColor.r, diffuseColor.b) * 0.9);
             float r = mix(0.42, 0.12, uH) * mix(1.0, 0.8, green);
             float strand = 1.0 - smoothstep(r * 0.6, r, length(f.xz + f.y * 0.3));
             float a = 0.0;
             // (the height noise only matters inside a strand, the cushions only on moss)
             if (strand > 0.0) {
               // per cell: a strand of random height, thick at the root, tapering
               // clumps and partings: strand height follows a slow noise
               float clump = fn(vFP * 14.0) * 0.7 + fn(vFP * 41.0) * 0.5;
               float tall = fh(c) * (0.25 + 0.9 * clump) * 0.3;
               if (green > 0.0) {
                 float cushion = smoothstep(0.2, 0.75, fn(vFP * 22.0) * 0.8 + fn(vFP * 61.0) * 0.4);
                 tall = mix(tall, (0.35 + 0.7 * fh(c + 1.7)) * cushion, green);
               }
               a = strand * step(uH, tall) * vGrip;
             }
             // a dense low underlayer so it reads as felt, not as stubble
             if (uH < 0.22) a = max(a, (1.0 - smoothstep(0.08, 0.22, uH)) * step(0.55, fn(q * 0.5)) * vGrip);
             diffuseColor.a = a;
             // (no colour for what the alpha test throws away)
             if (a > 0.0) {
               // root dark, tips paler, warmer and greyed where they catch the light
               vec3 tip = mix(diffuseColor.rgb * vec3(1.35, 1.15, 0.95), vec3(dot(diffuseColor.rgb, vec3(0.33)) * 1.6), 0.25);
               tip = mix(tip, diffuseColor.rgb * vec3(1.5, 1.6, 0.9), green); // moss tips go yellow-green
               diffuseColor.rgb = mix(diffuseColor.rgb * 0.45, tip, smoothstep(0.0, 1.0, uH)) * (0.8 + 0.4 * fh(c + 3.0));
             }
           }
           #include <alphatest_fragment>`,
        );
    };
    const m = new THREE.Mesh(geo, mat);
    m.name = `fuzz.${i}`;
    m.position.copy(perch.position);
    m.quaternion.copy(perch.quaternion);
    m.scale.copy(perch.scale);
    m.receiveShadow = true;
    m.renderOrder = i;
    group.add(m);
  }
  return group;
}
