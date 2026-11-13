import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mulberry32 } from '../bird/util';
import { MOUNTAIN_GEM } from '../bird/species';
import { phone } from '../device';

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

function tube(curve: THREE.Curve<THREE.Vector3>, radius: (u: number) => number, segs: number, radial: number, bumpSeed: number) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rng = mulberry32(bumpSeed);
  const knots = Array.from({ length: 6 }, () => ({ u: rng(), a: rng() * Math.PI * 2, s: 0.25 + rng() * 0.35 }));
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
      r *= 1 + 0.035 * Math.sin(a * 7 + u * 40) + 0.02 * Math.sin(a * 13 - u * 90);
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

function barkMaterial(length: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLen = { value: length };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNor; varying vec2 vUv2;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * objectNormal); vUv2 = uv;',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos; varying vec3 vWNor; varying vec2 vUv2; uniform float uLen;
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float along = vUv2.x * uLen;
  float streak = fbm(vec3(along * 6.0, vUv2.y * 3.0, 0.0) + vWPos * 2.0);
  vec3 bark = mix(vec3(0.16, 0.085, 0.05), vec3(0.36, 0.2, 0.11), streak);
  bark *= 0.75 + 0.5 * fbm(vWPos * 38.0);
  // moss on the up-facing side, patchy
  float up = clamp(vWNor.y, 0.0, 1.0);
  float moss = smoothstep(0.45, 0.75, fbm(vWPos * 9.0) + up * 0.35 - 0.1) * smoothstep(0.0, 0.5, up + 0.2);
  vec3 mossC = mix(vec3(0.10, 0.17, 0.02), vec3(0.30, 0.42, 0.05), fbm(vWPos * 60.0));
  diffuseColor.rgb = mix(bark, mossC, moss * 0.75);
  // lichen speckle
  float lic = smoothstep(0.78, 0.82, fbm(vWPos * 25.0 + 7.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.58, 0.45), lic * 0.5);
}`,
      );
  };
  return m;
}

export function createBranch() {
  const group = new THREE.Group();
  // main perch, rising to the right like the footage. Its axis follows the glb's (measured
  // from it), so nothing jumps when the glb takes over from this one after loading
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
  const bark = barkMaterial(len);
  const tmp = new THREE.Vector3();
  const gPerch = tube(
    perch,
    (u) => perchRadiusAt(perch.getPointAt(u, tmp).x) * (u > 0.97 ? 1 - (u - 0.97) * 20 : 1),
    320,
    28,
    3,
  );
  const mPerch = new THREE.Mesh(gPerch, bark);
  mPerch.name = 'perch';
  mPerch.receiveShadow = true; // no self-shadow: it banded at the shadow frustum edge
  group.add(mPerch);

  // side shoot with buds, off the right end, in front of the tail
  const shoot = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.07, 0.11, 0.26),
    new THREE.Vector3(1.18, 0.3, 0.28),
    new THREE.Vector3(1.28, 0.5, 0.2),
    new THREE.Vector3(1.41, 0.7, 0.09),
  ]);
  const shootMat = new THREE.MeshStandardMaterial({ color: 0x4f7a18, roughness: 0.65 });
  const mShoot = new THREE.Mesh(tube(shoot, (u) => 0.022 * (1 - u * 0.6), 60, 10, 9), shootMat);
  mShoot.castShadow = true;
  group.add(mShoot);

  const budMat = new THREE.MeshPhysicalMaterial({
    color: 0x7fc21a,
    roughness: 0.5,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xc8f050),
    emissive: 0x223a00,
  });
  const budGeo = new THREE.SphereGeometry(1, 16, 12);
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.008, 1, 6);
  stemGeo.translate(0, 0.5, 0);
  const rng = mulberry32(21);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < 9; i++) {
    const u = 0.2 + (i / 8) * 0.78;
    shoot.getPointAt(u, p);
    shoot.getTangentAt(u, t);
    const side = new THREE.Vector3(rng() - 0.5, rng() * 0.6, rng() - 0.5).normalize();
    const L = 0.06 + rng() * 0.08;
    const stem = new THREE.Mesh(stemGeo, shootMat);
    stem.position.copy(p);
    stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), side.clone().add(t.clone().multiplyScalar(0.4)).normalize());
    stem.scale.set(1, L, 1);
    group.add(stem);
    const tip = p.clone().addScaledVector(side.clone().add(t.clone().multiplyScalar(0.4)).normalize(), L);
    for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
      const bud = new THREE.Mesh(budGeo, budMat);
      const r = 0.018 + rng() * 0.018;
      bud.scale.set(r, r * 1.25, r);
      bud.position.copy(tip).add(new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.05));
      bud.castShadow = true;
      group.add(bud);
    }
  }

  return { group };
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
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
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
    pos.push(base.x - b.x * w, base.y - b.y * w, base.z - b.z * w, base.x + b.x * w, base.y + b.y * w, base.z + b.z * w,
      base.x + dir.x * len, base.y + dir.y * len, base.z + dir.z * len);
    for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
    // the flower hairs' gradient texture runs root (v = 0) to tip (v = 1)
    uv.push(0, 0, 1, 0, 0.5, 1);
    made++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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

function fuzzShells(perch: THREE.Mesh) {
  const src = perch.material as THREE.MeshStandardMaterial;
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
             // per cell: a strand of random height, thick at the root, tapering
             // clumps and partings: strand height follows a slow noise
             float clump = fn(vFP * 14.0) * 0.7 + fn(vFP * 41.0) * 0.5;
             float tall = fh(c) * (0.25 + 0.9 * clump);
             // moss where the baked bark is green: cushions, taller, denser
             float green = smoothstep(0.004, 0.03, diffuseColor.g - max(diffuseColor.r, diffuseColor.b) * 0.9);
             float cushion = smoothstep(0.2, 0.75, fn(vFP * 22.0) * 0.8 + fn(vFP * 61.0) * 0.4);
             tall = mix(tall * 0.3, (0.35 + 0.7 * fh(c + 1.7)) * cushion, green);
             float r = mix(0.42, 0.12, uH) * mix(1.0, 0.8, green);
             float strand = 1.0 - smoothstep(r * 0.6, r, length(f.xz + f.y * 0.3));
             float a = strand * step(uH, tall) * vGrip;
             // a dense low underlayer so it reads as felt, not as stubble
             if (uH < 0.22) a = max(a, (1.0 - smoothstep(0.08, 0.22, uH)) * step(0.55, fn(q * 0.5)) * vGrip);
             diffuseColor.a = a;
             // root dark, tips paler, warmer and greyed where they catch the light
             vec3 tip = mix(diffuseColor.rgb * vec3(1.35, 1.15, 0.95), vec3(dot(diffuseColor.rgb, vec3(0.33)) * 1.6), 0.25);
             tip = mix(tip, diffuseColor.rgb * vec3(1.5, 1.6, 0.9), green); // moss tips go yellow-green
             diffuseColor.rgb = mix(diffuseColor.rgb * 0.45, tip, smoothstep(0.0, 1.0, uH)) * (0.8 + 0.4 * fh(c + 3.0));
           }
           #include <alphatest_fragment>`,
        );
    };
    const m = new THREE.Mesh(perch.geometry, mat);
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
