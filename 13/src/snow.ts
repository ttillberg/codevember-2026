import * as THREE from 'three';

const MAX = 520;
const MIN_Y = -1.2;
const MAX_Y = 3.7;

export function createSnow(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const rng = () => Math.random();
  const pos = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const speed = new Float32Array(MAX);
  const drift = new Float32Array(MAX);
  const phase = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) {
    pos[i * 3] = (rng() - 0.5) * 8.0;
    pos[i * 3 + 1] = MIN_Y + rng() * (MAX_Y - MIN_Y);
    pos[i * 3 + 2] = (rng() - 0.5) * 6.5;
    size[i] = 0.45 + rng() * 1.35;
    speed[i] = 0.14 + rng() * 0.34;
    drift[i] = (rng() - 0.5) * 0.12;
    phase[i] = rng() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSize: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uPixelRatio, uSize;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float z = max(-mv.z, 0.1);
        // Keep the range below the clamp for most depths so the size slider
        // remains visible instead of flattening every flake to the same size.
        gl_PointSize = clamp(aSize * uSize * uPixelRatio * 55.0 / z, 1.0, 32.0);
        vDepth = clamp((z - 1.0) / 8.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vDepth;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float alpha = (1.0 - smoothstep(0.55, 1.0, r)) * mix(0.88, 0.55, vDepth);
        gl_FragColor = vec4(vec3(0.93, 0.97, 1.0), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'snow';
  points.frustumCulled = false;
  points.renderOrder = 6;
  scene.add(points);

  let amount = 0.45;
  let active = Math.round(MAX * amount);
  function setAmount(v: number) {
    amount = THREE.MathUtils.clamp(v, 0, 1);
    active = Math.round(MAX * amount);
    for (let i = active; i < MAX; i++) size[i] = 0;
    for (let i = 0; i < active; i++) if (size[i] === 0) size[i] = 0.45 + rng() * 1.35;
    (geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
  function setSize(v: number) {
    material.uniforms.uSize.value = THREE.MathUtils.clamp(v, 0.2, 2.5);
  }
  function update(dt: number, time: number) {
    for (let i = 0; i < active; i++) {
      const o = i * 3;
      pos[o + 1] -= speed[i] * dt;
      pos[o] += (drift[i] + Math.sin(time * 0.35 + phase[i]) * 0.012) * dt;
      pos[o + 2] += Math.cos(time * 0.27 + phase[i]) * 0.008 * dt;
      if (pos[o + 1] < MIN_Y) {
        pos[o + 1] = MAX_Y + rng() * 0.7;
        pos[o] = (rng() - 0.5) * 8.0;
        pos[o + 2] = (rng() - 0.5) * 6.5;
      }
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  function setPixelRatio() {
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  setAmount(amount);
  return { points, setAmount, setSize, setPixelRatio, update };
}
