import { useMemo } from 'react';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshStandardMaterial } from 'three';

// Small deterministic PRNG so every planet keeps the same marble across reloads.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

type VaneShape = { twist: number; cup: number; bend: number; stripes: number[]; wobble: number; phase: number };

const WHITE = new Color('#f4f1ea');

// One cat's eye vane: a broad blade that fills nearly the whole disc of the sphere, cupped across its width,
// bent along its length and twisted about its axis. White streaks run lengthwise, the edges thin out lighter.
// Everything stays inside the unit sphere: |x| <= 0.62 sqrt(1 - v^2) and the cup offset is small.
function vaneGeometry(color: string, sh: VaneShape, across = 20, along = 56) {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const base = new Color(color);
  const c = new Color();
  for (let j = 0; j <= along; j++) {
    const v = (j / along) * 2 - 1;
    const half = 0.62 * Math.sqrt(Math.max(0, 1 - v * v));
    const th = v * sh.twist + sh.phase;
    const ct = Math.cos(th), st = Math.sin(th);
    for (let i = 0; i <= across; i++) {
      const x = (i / across) * 2 - 1;
      const X = x * half;
      const Z = (sh.cup * (x * x - 0.33) + sh.bend * (v * v - 0.33)) * half;
      pos.push(ct * X + st * Z, v, -st * X + ct * Z);

      // Lengthwise white streaks that wander a little.
      let w = 0;
      for (const s of sh.stripes) {
        const d = x - s - sh.wobble * Math.sin(v * 3.1 + s * 7);
        w = Math.max(w, Math.exp(-(d * d) / 0.0012));
      }
      const edge = Math.pow(Math.abs(x), 6) * 0.45; // thin edges read lighter
      const shade = 0.82 + 0.18 * (1 - Math.abs(v)); // a touch darker towards the poles
      c.copy(base).multiplyScalar(shade).lerp(WHITE, Math.min(1, w * 0.85 + edge));
      col.push(c.r, c.g, c.b);
    }
  }
  const row = across + 1;
  for (let j = 0; j < along; j++)
    for (let i = 0; i < across; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function design(colors: readonly string[], seed: number) {
  const r = rng(seed);
  const n = r() < 0.7 ? 3 : 4;
  const twist = 0.4 + r() * 0.7;
  const vanes = Array.from({ length: n }, (_, i) => {
    const stripes = Array.from({ length: 1 + Math.floor(r() * 3) }, () => r() * 1.6 - 0.8);
    const shape: VaneShape = {
      twist,
      cup: (r() * 0.5 + 0.2) * (r() < 0.5 ? -1 : 1),
      bend: r() * 0.3 - 0.15,
      stripes,
      wobble: 0.05 + r() * 0.1,
      phase: (i * Math.PI) / n + (r() - 0.5) * 0.25,
    };
    return vaneGeometry(colors[i % colors.length], shape);
  });
  // A few tiny trapped air bubbles.
  const bubbles = Array.from({ length: 4 + Math.floor(r() * 6) }, () => {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = 0.55 + r() * 0.35;
    const s = Math.sqrt(1 - u * u);
    return { p: [rad * s * Math.cos(a), rad * u, rad * s * Math.sin(a)] as [number, number, number], r: 0.012 + r() * 0.022 };
  });
  return { vanes, bubbles };
}

// Opaque glass still lets some light through: a bit of each vane's own colour is added as emission,
// so the side facing away from the bulb glows dimly instead of going black.
const vaneMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: DoubleSide });
vaneMaterial.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.14;',
  );
};

type Props = { colors: readonly string[]; tint: string; seed: number; ring?: number };

// Unit-radius cat's eye marble: clear glass shell, broad twisted vanes inside. Scale it from the parent.
export function Marble({ colors, tint, seed, ring }: Props) {
  const { vanes, bubbles } = useMemo(() => design(colors, seed), [colors, seed]);
  return (
    <group>
      <group scale={[0.8, 0.72, 0.8]}>
        {vanes.map((g, i) => (
          <mesh key={i} geometry={g} material={vaneMaterial} castShadow receiveShadow />
        ))}
      </group>
      {ring !== undefined && (
        // Saturn's ring lives inside the glass, an outer one would hit the rail and roll along.
        <mesh rotation={[-Math.PI / 2 + (ring * Math.PI) / 180, 0, 0]} castShadow receiveShadow>
          <ringGeometry args={[0.6, 0.9, 96]} />
          <meshStandardMaterial color="#e8d8b0" roughness={0.5} side={DoubleSide} />
        </mesh>
      )}
      {bubbles.map((b, i) => (
        <mesh key={i} position={b.p} scale={b.r}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color="#cfd6da" roughness={0.1} metalness={0.2} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[1, 64, 32]} />
        <meshPhysicalMaterial
          transmission={1}
          thickness={0.7}
          roughness={0.02}
          ior={1.5}
          clearcoat={1}
          clearcoatRoughness={0}
          attenuationColor={tint}
          attenuationDistance={3}
        />
      </mesh>
    </group>
  );
}
