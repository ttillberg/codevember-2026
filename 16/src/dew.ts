// Dew: water drops sitting on the moss and the ferns. Each drop is a quad turned to the eye, shaded as a
// little sphere of water: a dark rim where the light bends away, a bright refracted inside, a hard glint of
// the sun off the front, and when you look towards the sun, a gold spot of light coming through it. The
// lens turns the ones out of focus into sparkling discs.
import * as THREE from 'three';
import { mossLighting } from './shaders';

export function makeDewMaterial(setup: (m: THREE.ShaderMaterial) => void) {
  const m = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uPx: { value: 800 } }, // px per unit at one unit away, for a minimum on-screen size
    transparent: true,
    depthWrite: false,
    // premultiplied: the body darkens what is behind a little, the glints add on top
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  setup(m);
  return m;
}

/** A mesh of drops at (x, y, z, radius) quadruples. */
export function buildDew(drops: number[], material: THREE.Material) {
  const n = drops.length / 4;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('iDrop', new THREE.InstancedBufferAttribute(new Float32Array(drops), 4));
  g.instanceCount = n;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // after the opaque world
  mesh.userData.fronds = true; // too small for the shadow map
  return mesh;
}

const vertexShader = /* glsl */ `
attribute vec4 iDrop; // centre, radius
uniform float uPx;
varying vec2 vUv;
varying vec3 vCentre;
varying float vFade;
void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(iDrop.xyz, 1.0);
  float dist = -mv.z;
  // never smaller than about a pixel and a half: a sub-pixel drop only flickers. The ones that would be
  // smaller fade instead, so far drops thin out into a faint sparkle.
  float r = iDrop.w;
  float minR = 0.75 * dist / uPx;
  vFade = clamp(r / minR, 0.0, 1.0);
  r = max(r, minR);
  mv.xy += position.xy * r;
  vUv = position.xy;
  vCentre = (modelMatrix * vec4(iDrop.xyz, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec2 vUv;
varying vec3 vCentre;
varying float vFade;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  if (nearFade(vCentre, 0.02, 0.05) < 0.5) discard;
  // the sphere's normal, in view space, then in world space
  vec3 nv = vec3(vUv, sqrt(1.0 - d2));
  mat3 invView = transpose(mat3(viewMatrix));
  vec3 N = normalize(invView * nv);
  vec3 V = normalize(cameraPosition - vCentre);
  vec3 L = normalize(uLightDir);
  float shadow = shadowAt(vCentre, vec3(0.0, 1.0, 0.0));
  float fres = pow(1.0 - nv.z, 3.0);
  // inside: a drop is a lens, it shows a bright, upside-down world: warm light at the bottom of the drop
  vec3 inside = mix(vec3(0.02, 0.04, 0.015), vec3(0.30, 0.24, 0.12), 1.0 - smoothstep(-0.8, 0.2, vUv.y)) * (0.5 + 0.5 * shadow);
  // the dark ring where light bends away at the edge
  float rim = smoothstep(0.55, 0.95, sqrt(d2));
  vec3 body = mix(inside, vec3(0.01, 0.012, 0.008), rim * 0.85);
  // glint: the sun's reflection, small and hard, and a softer sky one
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(N, H), 0.0), 400.0) * 22.0 * max(shadow, 0.25);
  float sky = pow(max(dot(reflect(-V, N), vec3(0.0, 1.0, 0.0)), 0.0), 8.0) * 0.25 * fres;
  // looking towards the sun: the drop gathers it into a gold spot on the far side
  vec3 Lv = mat3(viewMatrix) * L;
  vec2 spot = -Lv.xy * 0.45;
  // each drop's own size and shape send it a little differently: some catch it, most only glow
  float own = fract(sin(dot(vCentre.xz, vec2(91.7, 37.3))) * 4375.85);
  float thru = pow(max(dot(-V, L), 0.0), 3.0) * exp(-dot(vUv - spot, vUv - spot) * 40.0) * mix(1.0, 7.0, own * own) * max(shadow, 0.3);
  vec3 light = vec3(1.0, 0.86, 0.6) * glint + vec3(0.9, 0.85, 0.7) * sky + vec3(1.0, 0.7, 0.3) * thru;
  float a = mix(0.3, 0.85, rim) * vFade;
  // premultiplied: the body over what is behind with its alpha, the glints adding light on top
  gl_FragColor = vec4(tonemap(grade(body)) * a + tonemap(grade(light)) * vFade, a);
  #include <colorspace_fragment>
}
`;
