import * as THREE from 'three';
import { project, type M4, type V4 } from './tesseract';
import { rng } from './decals';

// The device's wake: puffs of vapour, each born behind it in 4D and projected like everything else, so the wake turns
// with the machine. A puff is a point sprite with a lumpy cloud texture, turning slowly as it grows and thins out. It
// is tinted with the colour of the cell it was left in, light and foggy, so the wake tells the cells apart.

const N = 2400; // puffs alive at most
const LIFE = 8; // seconds a puff lasts
const FOG = 0.45; // how far a puff's tint is washed towards white
const OPACITY = 0.16; // the whole wake's strength: soft, the laser carries the line (0.12 before more clouds)

/** A lumpy cloud: a handful of soft discs round the middle, under a soft edge. Only the alpha is used. */
function puffTexture(): THREE.Texture {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rng(11);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * S * 0.22, r = S * (0.16 + rnd() * 0.16);
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.6)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
  }
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const VERT = /* glsl */ `
  attribute float birth;
  attribute float seed;
  attribute float grow; // the puff's size against the usual, a big one now and then
  attribute vec3 drift;
  attribute vec3 tint;
  uniform float uTime, uScale, uLife, uOpacity;
  varying float vA, vRot;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    float age = uTime - birth;
    float u = clamp(age / uLife, 0.0, 1.0);
    vec3 p = position + drift * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = grow * mix(0.035, 0.13, pow(u, 0.5));
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    float fadeIn = smoothstep(0.0, 0.06, u);
    vA = fadeIn * (1.0 - u) * (1.0 - u) * uOpacity / pow(grow, 0.9); // the big ones are faint, a haze the small ones sit in
    if (age < 0.0 || age > uLife) { vA = 0.0; gl_PointSize = 0.0; }
    vRot = seed * 6.2831 + age * (seed - 0.5) * 0.9;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vA, vRot;
  varying vec3 vTint;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
    float a = texture2D(uMap, uv).a * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vTint, a);
  }
`;

export function makeSmoke() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), birth = new Float32Array(N).fill(-1e9), seed = new Float32Array(N), grow = new Float32Array(N).fill(1), drift = new Float32Array(N * 3), tint = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('birth', new THREE.BufferAttribute(birth, 1));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('grow', new THREE.BufferAttribute(grow, 1));
  geo.setAttribute('drift', new THREE.BufferAttribute(drift, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uLife: { value: LIFE }, uOpacity: { value: OPACITY }, uMap: { value: puffTexture() } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  const p4: V4[] = Array.from({ length: N }, () => [0, 0, 0, 0] as V4);
  let head = 0;
  const v = new THREE.Vector3(), col = new THREE.Color(), white = new THREE.Color('#ffffff');
  return {
    points,
    /** A puff at `p` in 4D, now, tinted `hex` washed towards white, `grow` times the usual size (a random small one
     * if left out); the big ones come out faint. */
    spawn(p: V4, now: number, hex: string, grow0?: number) {
      const i = head; head = (head + 1) % N;
      p4[i] = p.slice() as V4;
      birth[i] = now; seed[i] = Math.random();
      grow[i] = grow0 ?? 0.6 + Math.random() * 0.6;
      (geo.attributes.grow as THREE.BufferAttribute).needsUpdate = true;
      col.set(hex).lerp(white, FOG);
      tint[i * 3] = col.r; tint[i * 3 + 1] = col.g; tint[i * 3 + 2] = col.b;
      (geo.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
      drift[i * 3] = (Math.random() - 0.5) * 0.012; drift[i * 3 + 1] = 0.004 + Math.random() * 0.008; drift[i * 3 + 2] = (Math.random() - 0.5) * 0.012;
      (geo.attributes.birth as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.seed as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.drift as THREE.BufferAttribute).needsUpdate = true;
    },
    /** Project the live puffs under the pose `m`; `pxPerUnit` is the screen's height in pixels over the view's height at distance 1. */
    update(m: M4, now: number, pxPerUnit: number) {
      for (let i = 0; i < N; i++) {
        if (now - birth[i] > LIFE) continue;
        project(m, p4[i], v);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      mat.uniforms.uTime.value = now;
      mat.uniforms.uScale.value = pxPerUnit;
    },
  };
}
