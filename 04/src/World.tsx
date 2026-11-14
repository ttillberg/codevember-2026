// Everything that stands still: grass, asphalt, paint, buildings, trees.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three';
import { buildGround, clearOf } from './geo';
import { rng, type Net } from './net';

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

/** World-space grain on a material, so a flat colour reads as a surface. */
function grained(color: number, body: string, key: string, roughness = 0.95) {
  const m = new MeshStandardMaterial({ color, roughness, metalness: 0, side: DoubleSide });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\n' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec2 p = vWp.xz; ' + body + ' }');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

const GRASS = `
  float big = fbm(p * 0.012), mid = fbm(p * 0.09 + 31.0), fine = vn(p * 2.1);
  vec3 dry = vec3(0.50, 0.46, 0.27);
  diffuseColor.rgb = mix(diffuseColor.rgb, dry, smoothstep(0.45, 0.75, big) * 0.35);
  diffuseColor.rgb *= 0.82 + 0.3 * mid + 0.12 * fine;
  // mower stripes, barely
  diffuseColor.rgb *= 1.0 + 0.025 * sin(p.x * 0.9 + p.y * 0.35);
`;
const ASPHALT = `
  float wear = fbm(p * 0.07), fine = vn(p * 3.0), patchy = smoothstep(0.55, 0.6, fbm(p * 0.035 + 9.0));
  diffuseColor.rgb *= 0.86 + 0.22 * wear + 0.08 * fine;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.78, patchy * 0.5);
`;
const LOT = `
  float wear = fbm(p * 0.05 + 3.0), fine = vn(p * 2.5), stain = smoothstep(0.62, 0.75, fbm(p * 0.4));
  diffuseColor.rgb *= 0.84 + 0.26 * wear + 0.1 * fine;
  diffuseColor.rgb *= 1.0 - 0.25 * stain;
`;
const PAINT = `
  float worn = fbm(p * 0.9);
  diffuseColor.rgb *= 0.78 + 0.3 * worn;
  diffuseColor.a = 1.0;
`;
const ROOF = `
  float w = fbm(p * 0.08), f = vn(p * 1.3);
  diffuseColor.rgb *= 0.86 + 0.2 * w + 0.06 * f;
`;

export function World({ net }: { net: Net }) {
  const ground = useMemo(() => buildGround(net), [net]);
  const mats = useMemo(
    () => ({
      grass: grained(0x4f6a2c, GRASS, 'grass', 1),
      kerb: grained(0x9f9c94, ROOF, 'kerb'),
      pad: grained(0x5b5c5e, LOT, 'lot'),
      road: grained(0x3b3c3f, ASPHALT, 'asphalt', 0.9),
      white: grained(0xd9d8d0, PAINT, 'paint', 0.7),
      yellow: grained(0xc79d1f, PAINT, 'paint', 0.7),
    }),
    [],
  );
  useEffect(() => () => Object.values(ground).forEach((g) => g.dispose()), [ground]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={mats.grass}>
        <planeGeometry args={[5000, 5000]} />
      </mesh>
      <mesh geometry={ground.kerb} material={mats.kerb} receiveShadow />
      <mesh geometry={ground.pad} material={mats.pad} receiveShadow />
      <mesh geometry={ground.road} material={mats.road} receiveShadow />
      <mesh geometry={ground.white} material={mats.white} receiveShadow />
      <mesh geometry={ground.yellow} material={mats.yellow} receiveShadow />
      <mesh geometry={ground.decks} material={mats.kerb} castShadow receiveShadow />
      <Buildings net={net} />
      <Trees net={net} />
    </group>
  );
}

function Buildings({ net }: { net: Net }) {
  const units = useRef<InstancedMesh>(null);
  const roofs = useMemo(() => new Map<number, MeshStandardMaterial>(), []);
  const roof = (c: number) => roofs.get(c) ?? roofs.set(c, grained(c, ROOF, 'roof')).get(c)!;

  // rooftop units: what makes a big box read as a big box from above
  const boxes = useMemo(() => {
    const r = rng(11);
    const out: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (const b of net.buildings) {
      if (b.canopy) continue;
      const n = Math.round(((b.x1 - b.x0) * (b.y1 - b.y0)) / 550) + 1;
      for (let i = 0; i < n; i++) {
        const sx = 2 + r() * 2.5, sz = 1.6 + r() * 2;
        out.push({ x: b.x0 + 5 + r() * (b.x1 - b.x0 - 10), z: b.y0 + 5 + r() * (b.y1 - b.y0 - 10), y: b.h + 0.4 + 0.6, sx, sy: 1.2 + r() * 0.6, sz });
      }
    }
    return out;
  }, [net]);

  useLayoutEffect(() => {
    const o = new Object3D();
    boxes.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.scale.set(b.sx, b.sy, b.sz);
      o.updateMatrix();
      units.current!.setMatrixAt(i, o.matrix);
    });
    units.current!.instanceMatrix.needsUpdate = true;
  }, [boxes]);

  return (
    <group>
      {net.buildings.map((b, i) => {
        const w = b.x1 - b.x0, d = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2;
        if (b.canopy)
          return (
            <group key={i}>
              <mesh position={[cx, b.h, cz]} castShadow receiveShadow material={roof(b.roof)}>
                <boxGeometry args={[w, 0.7, d]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[cx + (s * w) / 3, b.h / 2, cz]} castShadow>
                  <boxGeometry args={[0.5, b.h, 0.5]} />
                  <meshStandardMaterial color={b.wall} />
                </mesh>
              ))}
            </group>
          );
        return (
          <group key={i}>
            <mesh position={[cx, b.h / 2, cz]} castShadow receiveShadow>
              <boxGeometry args={[w, b.h, d]} />
              <meshStandardMaterial color={b.wall} roughness={0.9} />
            </mesh>
            {/* the roof deck, inside a rim of wall */}
            <mesh position={[cx, b.h + 0.03, cz]} rotation-x={-Math.PI / 2} receiveShadow material={roof(b.roof)}>
              <planeGeometry args={[w - 1, d - 1]} />
            </mesh>
          </group>
        );
      })}
      <instancedMesh ref={units} args={[undefined, undefined, boxes.length]} castShadow receiveShadow>
        <boxGeometry />
        <meshStandardMaterial color={0xaeb0b0} roughness={0.6} metalness={0.3} />
      </instancedMesh>
    </group>
  );
}

function Trees({ net }: { net: Net }) {
  const ref = useRef<InstancedMesh>(null);
  // the wood is planted once; a road painted through it only fells what is in its way
  const wood = useMemo(() => {
    const r = rng(23);
    const out: { x: number; y: number; blobs: { m: Matrix4; c: Color }[] }[] = [];
    const o = new Object3D();
    const clump = (x: number, y: number) => 0.5 + 0.5 * Math.sin(x * 0.013 + 1.7) * Math.cos(y * 0.017 - 0.4) + 0.3 * Math.sin((x + y) * 0.041);
    for (let i = 0; i < 9000; i++) {
      const x = (r() - 0.5) * 1100, y = (r() - 0.5) * 1000;
      const keep = r() <= clump(x, y) * 0.55;
      const size = 2.2 + r() * 3;
      const hue = new Color().setHSL(0.24 + r() * 0.08, 0.32 + r() * 0.2, 0.13 + r() * 0.09);
      const n = 2 + ((r() * 3) | 0);
      const blobs: { m: Matrix4; c: Color }[] = [];
      for (let k = 0; k < n; k++) {
        const s = size * (0.6 + r() * 0.5);
        o.position.set(x + (r() - 0.5) * size * 0.9, size * 0.9 + r() * size * 0.5, y + (r() - 0.5) * size * 0.9);
        o.scale.set(s, s * (0.75 + r() * 0.3), s);
        o.rotation.set(r() * 3, r() * 3, r() * 3);
        o.updateMatrix();
        blobs.push({ m: o.matrix.clone(), c: hue.clone().offsetHSL(0, 0, (r() - 0.5) * 0.04) });
      }
      if (keep) out.push({ x, y, blobs });
    }
    return out;
  }, []);
  const CAP = 3200;

  useLayoutEffect(() => {
    const m = ref.current!;
    let i = 0;
    for (const t of wood) {
      if (i + t.blobs.length > CAP) break;
      if (!clearOf(net, t.x, t.y, 7)) continue;
      for (const b of t.blobs) {
        m.setMatrixAt(i, b.m);
        m.setColorAt(i, b.c);
        i++;
      }
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [wood, net]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CAP]} castShadow receiveShadow frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  );
}
