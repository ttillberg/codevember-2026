// What hangs in the air: mist lying on the ground in the morning, and a few clouds that drift over with their shadows.
// None of it is a volume: four flat sheets of the same noise, at their own heights, that stay where they are in the
// world while they follow the drone about.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, ShaderMaterial, Uniform, Vector2, Vector3, type Group } from 'three';
import { HOUR, NIGHT, NOW, SKY } from './haze';

/** Noise that repeats: a few sizes of soft lattice laid on each other, in one channel. */
function noise(size = 256) {
  const data = new Uint8Array(size * size);
  const rand = (x: number, y: number, n: number, seed: number) => {
    const s = Math.sin((((x % n) + n) % n) * 127.1 + (((y % n) + n) % n) * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5;
      for (let o = 0, n = 4; o < 4; o++, n *= 2, amp *= 0.5) {
        const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = ease(fx - ix), ty = ease(fy - iy);
        const a = rand(ix, iy, n, o), b = rand(ix + 1, iy, n, o), c = rand(ix, iy + 1, n, o), d = rand(ix + 1, iy + 1, n, o);
        v += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
      data[y * size + x] = Math.round((v / 0.9375) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RedFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * One sheet: `span` metres to a round of the noise, `cut` how much of it is clear air, `soft` how wide its edges are,
 * `drift` metres a second it moves, `off` where on the noise it reads (a shadow reads where its cloud is).
 */
function sheet(map: DataTexture, o: { span: number; cut: number; soft: number; drift: [number, number]; off?: [number, number]; over?: boolean }) {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map }, uNow: NOW, uInk: new Uniform(new Vector3(1, 1, 1)), uMuch: new Uniform(0),
      uSpan: { value: 1 / o.span }, uCut: { value: o.cut }, uSoft: { value: o.soft }, uDrift: { value: new Vector2(...o.drift) }, uOff: { value: new Vector2(...(o.off ?? [0, 0])) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vAt;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vAt = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uNow, uMuch, uSpan, uCut, uSoft; uniform vec3 uInk; uniform vec2 uDrift, uOff;
      varying vec2 vAt;
      void main() {
        vec2 p = (vAt + uOff - uDrift * uNow) * uSpan;
        // two sizes that slide past each other, so no shape is seen twice
        float n = texture2D(uMap, p).r * 0.62 + texture2D(uMap, p * 2.3 + vec2(0.37, 0.11) + uDrift.yx * uNow * uSpan * 0.6).r * 0.38;
        float a = smoothstep(uCut, uCut + uSoft, n) * uMuch;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uInk, a);
      }`,
    transparent: true, depthWrite: false, depthTest: !o.over,
  });
}

/** How high the clouds are, metres. */
const HIGH = 340;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How much mist there is at this hour: it gathers before dawn, is thickest as the sun comes up at seven, and is burnt off by ten. */
export const mistAt = (h: number) => smooth(4, 6.5, h) * (1 - smooth(8, 10.5, h));

export function Air() {
  const group = useRef<Group>(null);
  const mats = useMemo(() => {
    const map = noise();
    const wind: [number, number] = [9, 4];
    return {
      low: sheet(map, { span: 520, cut: 0.42, soft: 0.3, drift: [2.2, 1] }),
      high: sheet(map, { span: 760, cut: 0.5, soft: 0.26, drift: [3.4, 1.6], off: [310, 120] }),
      cloud: sheet(map, { span: 950, cut: 0.53, soft: 0.2, drift: wind }),
      shade: sheet(map, { span: 950, cut: 0.53, soft: 0.26, drift: wind, over: true }),
    };
  }, []);

  useFrame(({ camera }) => {
    // the sheets go where the drone goes, in steps, and the noise stays where it is in the world
    group.current!.position.set(Math.round(camera.position.x / 50) * 50, 0, Math.round(camera.position.z / 50) * 50);
    const n = NIGHT.value, mist = mistAt(HOUR.value), day = 1 - n;
    // they take the colour of the light that is on them: gold when the sun is low, nearly white at noon, the moon's at night
    const sun = SKY.sun, tint = (c: number, much: number) => 1 + (c - 1) * much;
    // by night the mist only shows what light there is under it
    const grey = 0.05 + 0.6 * day;
    for (const m of [mats.low, mats.high]) m.uniforms.uInk.value.set(grey * tint(sun.r, 0.85), grey * tint(sun.g, 0.85), grey * tint(sun.b, 0.85));
    mats.low.uniforms.uMuch.value = 0.4 * mist;
    mats.high.uniforms.uMuch.value = 0.26 * mist;
    const white = 0.05 + 0.72 * day;
    mats.cloud.uniforms.uInk.value.set(white * tint(sun.r, 0.85), white * tint(sun.g, 0.85), white * tint(sun.b, 0.85));
    mats.cloud.uniforms.uMuch.value = 0.22 + 0.4 * day;
    mats.shade.uniforms.uInk.value.set(0.02, 0.03, 0.06);
    mats.shade.uniforms.uMuch.value = 0.36 * day;
    // the shadow lies away from the sun, further the lower it stands
    const far = Math.min(900, HIGH / Math.tan(SKY.el));
    mats.shade.uniforms.uOff.value.set(-Math.sin(SKY.phi) * far, Math.cos(SKY.phi) * far);
  });

  const flat = { 'rotation-x': -Math.PI / 2, raycast: () => null, frustumCulled: false } as const;
  return (
    <group ref={group}>
      <mesh {...flat} position-y={0.7} renderOrder={-1} material={mats.shade}><planeGeometry args={[7000, 7000]} /></mesh>
      <mesh {...flat} position-y={7} material={mats.low}><planeGeometry args={[7000, 7000]} /></mesh>
      <mesh {...flat} position-y={16} material={mats.high}><planeGeometry args={[7000, 7000]} /></mesh>
      <mesh {...flat} position-y={HIGH} material={mats.cloud}><planeGeometry args={[7000, 7000]} /></mesh>
    </group>
  );
}
