import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, type Points, ShaderMaterial, Vector3 } from 'three';
import { motion } from './clock';
import { rng } from './random';

// The stars: a sphere of them far out round everything, most faint and small, a few bright, the odd one warm or blue,
// thicker in a band across the sky like the Milky Way. Each twinkles a little, in time with the scene.
const COUNT = 5000;
const RADIUS = 200; // inside the camera's far plane
const BAND = new Vector3(0.3, 1, 0.45).normalize(); // the band's pole: it runs round the sky square to this

export function Stars() {
  const { geometry, material } = useMemo(() => {
    const rnd = rng(41);
    const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), size = new Float32Array(COUNT), phase = new Float32Array(COUNT);
    const d = new Vector3(), c = new Color(), tints = ['#ffffff', '#ffffff', '#ffffff', '#fff1d6', '#d8e6ff', '#ffe2c2'];
    for (let i = 0; i < COUNT; ) {
      const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
      d.set(Math.cos(a) * ring, y, Math.sin(a) * ring);
      // Half of them only kept near the band, so it reads thicker there.
      if (i % 2 === 1 && Math.abs(d.dot(BAND)) > 0.12 + rnd() * 0.1) continue;
      pos.set([d.x * RADIUS, d.y * RADIUS, d.z * RADIUS], i * 3);
      c.set(tints[Math.floor(rnd() * tints.length)]).multiplyScalar(0.25 + 0.35 * rnd()); // faint, mostly
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.2 + rnd() ** 6 * 3; // mostly tiny, now and then a bigger one
      phase[i] = rnd() * 100;
      i++;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('size', new BufferAttribute(size, 1));
    g.setAttribute('phase', new BufferAttribute(phase, 1));
    const m = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float phase;
        attribute vec3 color;
        uniform float uTime, uScale;
        varying vec3 vColour;
        varying float vTwinkle;
        void main() {
          vColour = color;
          vTwinkle = 0.75 + 0.25 * sin(uTime * (1.3 + fract(phase) * 2.0) + phase);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColour;
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColour * vTwinkle * a * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, []);
  const sky = useRef<Points>(null!);
  useFrame(({ gl, camera }, dt) => {
    material.uniforms.uTime.value += dt * motion();
    material.uniforms.uScale.value = gl.getPixelRatio();
    // A sky: centred on the camera wherever it goes, so every star stays the same way off and inside the far plane.
    sky.current.position.copy(camera.position);
  });
  return <points ref={sky} geometry={geometry} material={material} frustumCulled={false} />;
}
