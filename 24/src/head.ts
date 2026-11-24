// The heads, modelled in Blender (model/heads.py → public/python.glb, public/corn.glb): a python's and
// a colubrid's, skin with baked scales, two eyes and a forked tongue. Each species paints its own
// colours on its family's head (public/heads/<species>.jpg, the same scales). Here they get their eyes
// (iris and pupil drawn in the shader on the eye's own sphere: a vertical slit for the boids, round for
// the colubrids, under a glassy spectacle) and the tongue flick.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Species } from './species';

export interface Head {
  group: THREE.Group;
  /** place at the neck ring, looking along fwd */
  place(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3): void;
  update(dt: number, time: number, excited: number): void;
  /** its paint, for the neck to take its colours from (skin.ts) */
  paint: THREE.Texture | null;
}

function eyeMaterial(sp: Species, radius: number) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.45,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    ior: 1.4,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uR = { value: radius };
    const lin = (c: number[]) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255);
    sh.uniforms.uSlit = { value: sp.eye.slit ? 1 : 0 };
    sh.uniforms.uIn = { value: lin(sp.eye.inner) };
    sh.uniforms.uOut = { value: lin(sp.eye.outer) };
    sh.uniforms.uPupil = { value: lin(sp.eye.pupil ?? [1, 1, 1]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uR; uniform float uSlit; uniform vec3 uIn; uniform vec3 uOut; uniform vec3 uPupil; varying vec3 vLocal;
float eh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // the eye's local +y looks out, +x is up the head
  vec3 q = vLocal / uR;
  vec2 p = vec2(q.x, q.z);
  float rho = length(p);
  float ang = atan(p.y, p.x);
  vec3 col;
  float pupil;
  col = mix(uIn, uOut, smoothstep(0.2, 0.88, rho));
  if (uSlit > 0.5) {
    // boids: fine dark veins, flecks, a vertical slit
    float vein = smoothstep(0.55, 1.0, sin(ang * 70.0 + sin(ang * 13.0) * 2.0 + rho * 9.0)) * 0.35;
    col *= 1.0 - vein;
    col += uIn * 0.2 * smoothstep(0.6, 0.0, abs(rho - 0.45)) * eh(floor(vec2(ang * 30.0, rho * 12.0)));
    pupil = length(vec2(p.x / 0.62, p.y / 0.1));
  } else {
    // colubrids: flecked, a bright ring round a round pupil
    float fleck = smoothstep(0.6, 1.0, sin(ang * 50.0 + sin(ang * 9.0) * 3.0)) * 0.3;
    col *= 1.0 - fleck;
    col += uIn * 0.3 * smoothstep(0.15, 0.0, abs(rho - 0.42));
    pupil = rho / 0.36;
  }
  col = mix(uPupil, col, smoothstep(0.96, 1.06, pupil));
  // dark ring round the iris and a dark back
  col *= 1.0 - smoothstep(0.8, 0.98, rho) * 0.85;
  col *= step(0.0, q.y);
  diffuseColor.rgb = col;
}`);
  };
  return m;
}

export function createHead(gltf: GLTF, sp: Species, paint?: THREE.Texture): Head {
  const root = gltf.scene.getObjectByName(sp.shape)!;
  const group = new THREE.Group();
  const inner = root.clone(true);
  inner.position.set(0, 0, 0);
  inner.quaternion.identity();
  group.add(inner);

  const head = inner.getObjectByName(sp.shape + '_head') as THREE.Mesh;
  const skin = head.material as THREE.MeshStandardMaterial;
  const phys = new THREE.MeshPhysicalMaterial({
    map: paint ?? skin.map,
    normalMap: skin.normalMap,
    roughnessMap: skin.roughnessMap,
    roughness: 1,
    metalness: 0,
    clearcoat: sp.clearcoat,
    clearcoatRoughness: 0.25,
    iridescence: sp.iridescence,
    iridescenceIOR: 1.55,
    iridescenceThicknessMinimum: 180,
    iridescenceThicknessMaximum: 420,
    sheen: sp.shape === 'python' ? 0 : 0.15,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffd8b0),
  });
  if (phys.normalMap) phys.normalScale.set(1, 1);
  head.material = phys;
  head.castShadow = true;
  head.receiveShadow = true;

  for (const tag of ['L', 'R']) {
    const eye = inner.getObjectByName(`${sp.shape}_eye_${tag}`) as THREE.Mesh;
    eye.geometry.computeBoundingSphere();
    eye.material = eyeMaterial(sp, eye.geometry.boundingSphere!.radius);
    eye.castShadow = false;
  }

  const tongue = inner.getObjectByName(sp.shape + '_tongue') as THREE.Mesh;
  tongue.geometry.computeBoundingBox();
  const tlen = tongue.geometry.boundingBox!.max.x;
  const tongueBase = tongue.position.clone();
  const tongueMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(sp.tongue[0] / 255, sp.tongue[1] / 255, sp.tongue[2] / 255),
    roughness: 0.25,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  });
  const tu = { uWig: { value: 0 }, uTime: { value: 0 }, uLen: { value: tlen } };
  tongueMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, tu);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWig; uniform float uTime; uniform float uLen;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float tx = clamp(transformed.x / uLen, 0.0, 1.0);
transformed.y += sin(uTime * 46.0 - tx * 3.0) * uWig * tx * tx * uLen * 0.35;
transformed.z *= 1.0 + uWig * 0.6 * tx * tx;`);
    if (sp.shape === 'corn') {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTx;')
      sh.vertexShader = sh.vertexShader.replace('uniform float uLen;', 'uniform float uLen; varying float vTx;')
        .replace('float tx = clamp', 'vTx = transformed.x / uLen; float tx = clamp');
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.01), smoothstep(0.62, 0.75, vTx));`);
    }
  };
  tongue.material = tongueMat;
  tongue.visible = false;

  const basis = new THREE.Matrix4();
  const right = new THREE.Vector3();
  const upO = new THREE.Vector3();
  // the flick: out, flutter, back
  let flickT = -1;
  let nextFlick = 1 + Math.random() * 3;

  return {
    group,
    paint: phys.map,
    place(pos, fwd, up) {
      right.crossVectors(fwd, up).normalize();
      upO.crossVectors(right, fwd).normalize();
      basis.makeBasis(fwd, upO, right);
      group.position.copy(pos);
      group.quaternion.setFromRotationMatrix(basis);
    },
    update(dt, time, excited) {
      nextFlick -= dt * (1 + excited * 2);
      if (nextFlick < 0 && flickT < 0) {
        flickT = 0;
        nextFlick = 2 + Math.random() * 5;
      }
      if (flickT >= 0) {
        flickT += dt;
        const dur = 0.75;
        const t = flickT / dur;
        const out = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.82) / 0.18));
        tongue.visible = out > 0.01;
        tongue.position.copy(tongueBase);
        tongue.position.x -= (1 - out) * tlen * 1.05;
        tu.uWig.value = Math.sin(Math.min(1, t) * Math.PI) * 0.9;
        tu.uTime.value = time;
        if (t >= 1) {
          flickT = -1;
          tongue.visible = false;
        }
      }
    },
  };
}
