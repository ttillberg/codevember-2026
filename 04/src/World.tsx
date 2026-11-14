// Everything that stands still: grass, asphalt, paint, buildings, trees.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three';
import { buildGround, clearOf, onRoad, WALK } from './geo';
import { cumLen, offset, pointOn, rng, type Net } from './net';
import { Town, type Block } from './Town';

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
  // rough ground, not a lawn: scrub, dry patches, and red earth where it has been dug
  vec3 dry = vec3(0.47, 0.45, 0.28);
  diffuseColor.rgb = mix(diffuseColor.rgb, dry, smoothstep(0.45, 0.75, big) * 0.3);
  diffuseColor.rgb *= 0.72 + 0.42 * mid + 0.14 * fine;
  float dug = smoothstep(0.66, 0.72, fbm(p * 0.018 + 70.0)) * smoothstep(0.35, 0.6, fbm(p * 0.11 + 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.36, 0.26) * (0.85 + 0.3 * fine), dug * 0.85);
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
const SLAB = `
  float w = fbm(p * 0.06 + 11.0), f = vn(p * 1.7);
  diffuseColor.rgb *= 0.84 + 0.22 * w + 0.08 * f;
  // joints, and where the rain collects
  diffuseColor.rgb *= 1.0 - 0.07 * step(0.94, fract(p.x / 4.0)) - 0.07 * step(0.94, fract(p.y / 4.0));
  diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.6, 0.75, fbm(p * 0.25 + 40.0));
`;
const ROOF = `
  float w = fbm(p * 0.08), f = vn(p * 1.3);
  diffuseColor.rgb *= 0.86 + 0.2 * w + 0.06 * f;
`;

export function World({ net, blocks }: { net: Net; blocks: Block[] }) {
  const ground = useMemo(() => buildGround(net), [net]);
  const mats = useMemo(
    () => ({
      grass: grained(0x466029, GRASS, 'grass', 1),
      walk: grained(0xa5a39b, SLAB, 'slab'),
      kerb: grained(0xb3b0a8, ROOF, 'kerb'),
      pad: grained(0x787a79, LOT, 'lot'),
      // sun-bleached, the way a road looks from the air
      road: grained(0x6b6d6f, ASPHALT, 'asphalt', 0.9),
      white: grained(0xe6e5de, PAINT, 'paint', 0.7),
      yellow: grained(0xcfae4a, PAINT, 'paint', 0.7),
    }),
    [],
  );
  useEffect(() => () => Object.values(ground).forEach((g) => g.dispose()), [ground]);


  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={mats.grass}>
        <planeGeometry args={[5000, 5000]} />
      </mesh>
      <mesh geometry={ground.walk} material={mats.walk} receiveShadow />
      <mesh geometry={ground.kerb} material={mats.kerb} receiveShadow />
      <mesh geometry={ground.pad} material={mats.pad} receiveShadow />
      <mesh geometry={ground.road} material={mats.road} receiveShadow />
      <mesh geometry={ground.white} material={mats.white} receiveShadow />
      <mesh geometry={ground.yellow} material={mats.yellow} receiveShadow />
      <mesh geometry={ground.decks} material={mats.kerb} castShadow receiveShadow />
      <Buildings net={net} />
      <Town net={net} blocks={blocks} paving={mats.walk} />
      <Trees net={net} blocks={blocks} />
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

function Trees({ net, blocks }: { net: Net; blocks: Block[] }) {
  const ref = useRef<InstancedMesh>(null), firs = useRef<InstancedMesh>(null);
  // everything is planted once; a road painted through only fells what is in its way
  const wood = useMemo(() => {
    const r = rng(23);
    const out: { x: number; y: number; blobs: { m: Matrix4; c: Color }[]; fir: boolean }[] = [];
    const o = new Object3D();
    const clump = (x: number, y: number) => 0.5 + 0.5 * Math.sin(x * 0.013 + 1.7) * Math.cos(y * 0.017 - 0.4) + 0.3 * Math.sin((x + y) * 0.041);
    // where the dark, pointed trees stand together
    const stand = (x: number, y: number) => Math.sin(x * 0.006 + 2) * Math.cos(y * 0.008 + 1) > 0.3;
    for (let i = 0; i < 10000; i++) {
      const x = (r() - 0.5) * 900, y = (r() - 0.5) * 860;
      const keep = r() <= 0.2 + clump(x, y) * 0.65;
      const kind = r();
      const fir = kind > 0.3 && r() < (stand(x, y) ? 0.7 : 0.08);
      const bush = kind <= 0.3;
      const size = bush ? 0.9 + r() * 1.1 : fir ? 2 + r() * 1.4 : 2.4 + r() * 3.2;
      const hue = fir
        ? new Color().setHSL(0.36 + r() * 0.06, 0.3 + r() * 0.15, 0.09 + r() * 0.05)
        : new Color().setHSL(0.22 + r() * 0.11, 0.3 + r() * 0.25, (r() < 0.12 ? 0.22 : 0.11) + r() * 0.08);
      const blobs: { m: Matrix4; c: Color }[] = [];
      if (fir) {
        const h = size * (2.8 + r() * 1.4);
        o.position.set(x, h / 2 + 0.6, y); o.scale.set(size, h, size); o.rotation.set(0, r() * 6, 0);
        o.updateMatrix();
        blobs.push({ m: o.matrix.clone(), c: hue });
      } else {
        const n = bush ? 1 + ((r() * 2) | 0) : 2 + ((r() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const s = size * (0.6 + r() * 0.5);
          o.position.set(x + (r() - 0.5) * size * 0.9, (bush ? 0.5 : 0.9) * size + r() * size * 0.5, y + (r() - 0.5) * size * 0.9);
          o.scale.set(s, s * (0.75 + r() * 0.3), s);
          o.rotation.set(r() * 3, r() * 3, r() * 3);
          o.updateMatrix();
          blobs.push({ m: o.matrix.clone(), c: hue.clone().offsetHSL(0, 0, (r() - 0.5) * 0.04) });
        }
      }
      if (keep) out.push({ x, y, blobs, fir });
    }
    return out;
  }, []);
  const CAP = 5200, FIRS = 1500;

  useLayoutEffect(() => {
    const m = ref.current!, f = firs.current!;
    const up = blocks;
    let i = 0, j = 0;
    for (const t of wood) {
      if (!clearOf(net, t.x, t.y, 6)) continue;
      if (up.some((b) => t.x > b.x0 - 5 && t.x < b.x1 + 5 && t.y > b.y0 - 5 && t.y < b.y1 + 5)) continue;
      if (t.fir) {
        if (j < FIRS) { f.setMatrixAt(j, t.blobs[0].m); f.setColorAt(j++, t.blobs[0].c); }
      } else if (i + t.blobs.length <= CAP - 600) {
        for (const b of t.blobs) { m.setMatrixAt(i, b.m); m.setColorAt(i++, b.c); }
      }
    }
    // street trees: a row down each side of every proper road, in the outer strip of the sidewalk
    const o = new Object3D(), c = new Color();
    const blocked = (x: number, y: number) => [...net.pads, ...net.buildings].some((q) => x > q.x0 - 2 && x < q.x1 + 2 && y > q.y0 - 2 && y < q.y1 + 2);
    for (const r of net.roads) {
      if (r.look < 2 || r.bridge || r.ring) continue;
      for (const side of [-1, 1]) {
        const line = offset(r.base, side * (r.hw + WALK - 0.2));
        const cum = cumLen(line);
        for (let d = 9; d < cum[cum.length - 1] - 8 && i < CAP; d += 15) {
          const p = pointOn(line, cum, d);
          if (blocked(p.x, p.y) || onRoad(net, p.x, p.y, r, 1.5)) continue;
          const k = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1;
          const s = 2.3 + k * 1.1;
          o.position.set(p.x, s * 1.25, p.y); o.scale.set(s, s * 0.9, s); o.rotation.set(k * 3, k * 5, 0);
          o.updateMatrix();
          m.setMatrixAt(i, o.matrix);
          m.setColorAt(i++, c.setHSL(0.27 + k * 0.04, 0.4, 0.13 + k * 0.05));
        }
      }
    }
    m.count = i; f.count = j;
    for (const q of [m, f]) {
      q.instanceMatrix.needsUpdate = true;
      if (q.instanceColor) q.instanceColor.needsUpdate = true;
    }
  }, [wood, net, blocks]);

  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, CAP]} castShadow receiveShadow frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={firs} args={[undefined, undefined, FIRS]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}
