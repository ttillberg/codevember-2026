// What is drawn while the real thing is built. The skins are a physical material with a few hundred
// lines of scales on top, the heads three more of them: left to the first frame, building them held
// the page still for seconds. So the knot shows at once in this instead, the same meshes moving the
// same way, in a plain clay of each snake's colours, lit from the key's side and darker where the
// bodies press on each other; the ground in its own texture under the contact shadows. One small
// program for all of it, drawn straight to the screen, no post, while the rest compiles off the thread.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aAO;
uniform float uHasAO;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vAO;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vAO = mix(1.0, aAO, uHasAO);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec2 uRepeat;
uniform sampler2D uContact;
uniform float uHasContact;
uniform float uSpan;
uniform vec3 uKey;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vAO;
void main() {
  vec3 n = normalize(vN);
  vec3 base = uColor;
  if (uHasMap > 0.5) base *= texture2D(uMap, vUv * uRepeat).rgb;
  // the key, a little sky from above, the rest in the occlusion
  float key = max(dot(n, uKey), 0.0);
  vec3 c = base * (0.18 + 0.85 * key + 0.25 * max(n.y, 0.0)) * vAO;
  if (uHasContact > 0.5) {
    vec2 cuv = vW.xz / uSpan + 0.5;
    float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
    c *= mix(1.0, texture2D(uContact, vec2(cuv.x, 1.0 - cuv.y)).r, inside);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const KEY = new THREE.Vector3(0.9, 2.2, 0.7).normalize();

export function previewMaterial(color: THREE.Color, o: { map?: THREE.Texture; repeat?: number; contact?: THREE.Texture; span?: number; ao?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uMap: { value: o.map ?? null },
      uHasMap: { value: o.map ? 1 : 0 },
      uRepeat: { value: new THREE.Vector2(o.repeat ?? 1, o.repeat ?? 1) },
      uContact: { value: o.contact ?? null },
      uHasContact: { value: o.contact ? 1 : 0 },
      uSpan: { value: o.span ?? 1 },
      uKey: { value: KEY },
      uHasAO: { value: o.ao ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** a snake's clay: halfway between the two colours its scales light up in, which come out of its pattern */
export function snakeColor(pixel: { on: number[]; off: number[] }) {
  const on = new THREE.Color().setRGB(pixel.on[0] / 255, pixel.on[1] / 255, pixel.on[2] / 255, THREE.SRGBColorSpace);
  const off = new THREE.Color().setRGB(pixel.off[0] / 255, pixel.off[1] / 255, pixel.off[2] / 255, THREE.SRGBColorSpace);
  return off.lerp(on, 0.45);
}
