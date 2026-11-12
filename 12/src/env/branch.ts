import * as THREE from 'three';
import { mulberry } from './backdrop';

// The perch: a mossy twig along X whose top passes through the origin, plus a
// side shoot with bright lime buds like in the footage.

const PERCH_R = 0.09;

function tube(curve: THREE.Curve<THREE.Vector3>, radius: (u: number) => number, segs: number, radial: number, bumpSeed: number) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rng = mulberry(bumpSeed);
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
      nor.push(n.x, n.y, n.z);
      uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
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
  // main perch, rising to the right like the footage
  const perch = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.0, -1.5, -0.9),
    new THREE.Vector3(-3.2, -0.75, -0.35),
    new THREE.Vector3(-1.4, -0.36, -0.1),
    new THREE.Vector3(0, -PERCH_R, 0),
    new THREE.Vector3(0.9, 0.08, 0.12),
    new THREE.Vector3(1.8, 0.34, 0.05),
  ]);
  // nudge so the top surface sits exactly at the origin
  const len = perch.getLength();
  const bark = barkMaterial(len);
  // radius is exactly PERCH_R at x = 0 (the toes assume it), thicker to the left
  const tmp = new THREE.Vector3();
  const gPerch = tube(
    perch,
    (u) => PERCH_R * Math.min(1 - 0.18 * perch.getPointAt(u, tmp).x, 2.2) * (u > 0.97 ? 1 - (u - 0.97) * 20 : 1),
    320,
    28,
    3,
  );
  const mPerch = new THREE.Mesh(gPerch, bark);
  mPerch.receiveShadow = true; // no self-shadow: it banded at the shadow frustum edge
  group.add(mPerch);

  // side shoot with buds, off the right end, in front of the tail
  const shoot = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.95, 0.07, 0.1),
    new THREE.Vector3(1.15, 0.25, 0.22),
    new THREE.Vector3(1.25, 0.5, 0.18),
    new THREE.Vector3(1.4, 0.68, 0.1),
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
  const rng = mulberry(21);
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

  return { group, radius: PERCH_R };
}

// The Blender perch (model/branch.blend → public/branch.glb), with baked bark,
// moss and buds. Same contract as the procedural one: radius PERCH_R at x = 0,
// top surface through the origin.
export async function loadBranch(url: string) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const group = gltf.scene;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    // the big twig self-shadowed into bands at the shadow frustum edge; small parts cast
    m.castShadow = !/perch/i.test(m.name);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mat as THREE.MeshStandardMaterial;
      // moss cards are alpha-tested: let the MSAA resolve their edges
      if (s.alphaTest > 0) {
        s.alphaToCoverage = true;
        s.alphaTest = 0.4;
      }
      // the grade lifts exposure: keep the moss from going neon
      if (/moss/i.test(s.name)) s.color.multiplyScalar(0.95);
      s.envMapIntensity = 0.8;
    }
  });
  return { group, radius: PERCH_R };
}
