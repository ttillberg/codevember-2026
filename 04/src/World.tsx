// Everything that stands still: grass, asphalt, paint, buildings, trees.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Vector3 } from 'three';
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
export function grained(color: number, body: string, key: string, roughness = 0.95) {
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
  vec3 dry = vec3(0.52, 0.44, 0.24);
  diffuseColor.rgb = mix(diffuseColor.rgb, dry, smoothstep(0.35, 0.7, big) * 0.55);
  // autumn: what has come down lies in drifts, yellow and rust
  float drift = smoothstep(0.5, 0.72, fbm(p * 0.05 + 23.0)) * smoothstep(0.35, 0.7, vn(p * 1.6 + 4.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.78, 0.46, 0.06), vec3(0.6, 0.16, 0.04), vn(p * 0.3 + 9.0)), drift * 0.75);
  diffuseColor.rgb *= 0.72 + 0.42 * mid + 0.14 * fine;
  float dug = smoothstep(0.66, 0.72, fbm(p * 0.018 + 70.0)) * smoothstep(0.35, 0.6, fbm(p * 0.11 + 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.36, 0.26) * (0.85 + 0.3 * fine), dug * 0.85);
`;
const ASPHALT = `
  float wear = fbm(p * 0.07), fine = vn(p * 3.0), patchy = smoothstep(0.55, 0.6, fbm(p * 0.035 + 9.0));
  diffuseColor.rgb *= 0.86 + 0.22 * wear + 0.08 * fine;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.78, patchy * 0.5);
  // tar poured along the cracks, and a manhole now and then
  float crack = smoothstep(0.015, 0.0, abs(fbm(p * 0.045 + 60.0) - 0.5)) * step(0.5, vn(p * 0.02 + 8.0));
  diffuseColor.rgb *= 1.0 - 0.3 * crack;
  vec2 mh = floor(p / 23.0);
  diffuseColor.rgb *= 1.0 - 0.4 * step(length(p - (mh + 0.2 + 0.6 * vec2(h21(mh), h21(mh + 3.0))) * 23.0), 0.45) * step(0.5, h21(mh + 9.0));
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
  // small tiles between the joints, a few of them replaced with whatever was at hand
  vec2 tile = floor(p / 0.8);
  diffuseColor.rgb *= 0.95 + 0.1 * h21(tile);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.4, 0.34), step(0.93, h21(tile + 7.0)) * 0.5);
  diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.6, 0.75, fbm(p * 0.25 + 40.0));
  // leaves swept by the wind into the low places
  float lf = smoothstep(0.42, 0.62, fbm(p * 0.12 + 51.0)) * smoothstep(0.45, 0.75, vn(p * 2.4));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.85, 0.52, 0.06), vec3(0.62, 0.2, 0.05), vn(p * 0.5 + 2.0)), lf * 0.7);
`;
const ROOF = `
  float w = fbm(p * 0.08), f = vn(p * 1.3);
  diffuseColor.rgb *= 0.86 + 0.2 * w + 0.06 * f;
`;
/** A flat roof from above: felt laid in strips, patched with tar, puddled where it sags. */
const FELT = `
  float w = fbm(p * 0.08), f = vn(p * 1.3);
  diffuseColor.rgb *= 0.84 + 0.22 * w + 0.06 * f;
  diffuseColor.rgb *= 1.0 - 0.1 * step(0.93, fract(p.y / 2.2));
  float tar = smoothstep(0.6, 0.64, fbm(p * 0.16 + 13.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.21), tar * 0.55);
  float wet = smoothstep(0.66, 0.7, fbm(p * 0.11 + 77.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.56, 0.6), wet * 0.7);
  // moss and rust creep in from the damp
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.33, 0.16), smoothstep(0.55, 0.8, fbm(p * 0.3 + 5.0)) * 0.3);
`;

export function World({ net, blocks, trees = true }: { net: Net; blocks: Block[]; trees?: boolean }) {
  const ground = useMemo(() => buildGround(net), [net]);
  const mats = useMemo(
    () => ({
      grass: grained(0x56602b, GRASS, 'grass', 1),
      walk: grained(0xa5a39b, SLAB, 'slab'),
      felt: grained(0xffffff, FELT, 'felt', 0.85),
      kerb: grained(0xb3b0a8, ROOF, 'kerb'),
      pad: grained(0x787a79, LOT, 'lot'),
      // sun-bleached, the way a road looks from the air
      road: grained(0x6b6d6f, ASPHALT, 'asphalt', 0.9),
      white: grained(0xe6e5de, PAINT, 'paint', 0.7),
      yellow: grained(0xcfae4a, PAINT, 'paint', 0.7),
      guide: grained(0xd08c00, PAINT, 'paint', 0.9),
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
      <mesh geometry={ground.guide} material={mats.guide} receiveShadow />
      <mesh geometry={ground.kerb} material={mats.kerb} receiveShadow />
      <mesh geometry={ground.pad} material={mats.pad} receiveShadow />
      <mesh geometry={ground.road} material={mats.road} receiveShadow />
      <mesh geometry={ground.white} material={mats.white} receiveShadow />
      <mesh geometry={ground.yellow} material={mats.yellow} receiveShadow />
      <mesh geometry={ground.decks} material={mats.kerb} castShadow receiveShadow />
      <Buildings net={net} />
      <Town net={net} blocks={blocks} paving={mats.walk} roofing={mats.felt} />
      <group visible={trees}>
        <Trees net={net} blocks={blocks} />
      </group>
    </group>
  );
}

function Buildings({ net }: { net: Net }) {
  const units = useRef<InstancedMesh>(null);
  const roofs = useMemo(() => new Map<number, MeshStandardMaterial>(), []);
  const roof = (c: number) => roofs.get(c) ?? roofs.set(c, grained(c, FELT, 'felt')).get(c)!;

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

/** What a leaf tree wears in November: some still green, most gone yellow, a few on fire. */
function leaf(k: number, v: number, bush = false) {
  const c = new Color();
  if (k < (bush ? 0.45 : 0.14)) return c.setHSL(0.2 + v * 0.08, 0.3 + v * 0.15, 0.12 + v * 0.07);
  if (k < 0.5) return c.setHSL(0.095 + v * 0.03, 0.85, 0.25 + v * 0.07);
  if (k < 0.76) return c.setHSL(0.05 + v * 0.03, 1, 0.27 + v * 0.07);
  if (k < 0.93) return c.setHSL(0.0 + v * 0.02, 0.95, 0.2 + v * 0.07);
  return c.setHSL(0.07 + v * 0.02, 0.4, 0.11 + v * 0.05);
}

const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** A crown is a few of these: a loose ball of leaves, each its own small card, darker towards the middle. */
function tuft() {
  const r = rng(71), n = phone ? 40 : 72;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const dir = new Vector3(), face = new Vector3(), t = new Vector3(), b = new Vector3(), c = new Vector3(), q = new Vector3();
  for (let i = 0; i < n; i++) {
    dir.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const rad = 0.45 + r() * 0.7;
    c.copy(dir).multiplyScalar(rad);
    // a leaf faces out, more or less, and hangs a little
    face.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.3).add(dir).normalize();
    t.set(r() - 0.5, r() - 0.9, r() - 0.5).cross(face).normalize();
    b.copy(face).cross(t);
    const len = (phone ? 0.42 : 0.32) * (0.7 + r() * 0.7), wid = len * (0.55 + r() * 0.3);
    const at = pos.length / 3;
    for (const [u, v] of [[-len, 0], [-len * 0.1, wid], [len, 0], [-len * 0.1, -wid]]) {
      q.copy(c).addScaledVector(t, u).addScaledVector(b, v);
      pos.push(q.x, q.y, q.z);
    }
    // lit like the ball it sits on, with a little of its own tilt
    q.copy(dir).multiplyScalar(0.8).addScaledVector(face, 0.5).normalize();
    // the inside of a crown is in its own shade; now and then a leaf has turned further than the rest
    const g = (0.5 + 0.5 * Math.min(1, rad)) * (0.8 + r() * 0.4), turned = r() < 0.18;
    for (let k = 0; k < 4; k++) { nor.push(q.x, q.y, q.z); col.push(g, g * (turned ? 0.78 : 1), g * (turned ? 0.7 : 1)); }
    idx.push(at, at + 2, at + 1, at, at + 3, at + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

/** Fallen leaves: a round patch under a tree, thick at the trunk and thinning out. */
function fallen() {
  const m = new MeshStandardMaterial({ roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec2 vLo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLo = position.xy; vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec2 vLo;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float d = length(vLo);
        float n = fbm(vWp.xz * 0.6), fine = vn(vWp.xz * 3.1);
        diffuseColor.rgb *= 0.75 + 0.5 * fine;
        diffuseColor.a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.7) * (0.35 + 0.6 * smoothstep(0.3, 0.7, fine));`);
  };
  m.customProgramCacheKey = () => 'fallen';
  return m;
}

function Trees({ net, blocks }: { net: Net; blocks: Block[] }) {
  const ref = useRef<InstancedMesh>(null), firs = useRef<InstancedMesh>(null), floor = useRef<InstancedMesh>(null), stems = useRef<InstancedMesh>(null);
  const crown = useMemo(tuft, []);
  const litter = useMemo(fallen, []);
  // everything is planted once; a road painted through only fells what is in its way
  const wood = useMemo(() => {
    const r = rng(23);
    const out: { x: number; y: number; blobs: { m: Matrix4; c: Color }[]; fir: boolean; size: number }[] = [];
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
        : leaf(r(), r(), bush);
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
      if (keep) out.push({ x, y, blobs, fir, size: bush ? 0 : size });
    }
    return out;
  }, []);
  const CAP = 5200, FIRS = 1500, LITTER = 2600, STEMS = 3200;

  useLayoutEffect(() => {
    const m = ref.current!, f = firs.current!, fl = floor.current!, st = stems.current!;
    const up = blocks;
    let i = 0, j = 0, l = 0, e = 0;
    const bark = new Color(0x3a3229);
    const stem = (x: number, y: number, h: number, w: number) => {
      if (e >= STEMS) return;
      o.position.set(x, h / 2, y); o.scale.set(w, h, w); o.rotation.set(0, 0, 0);
      o.updateMatrix();
      st.setMatrixAt(e, o.matrix);
      st.setColorAt(e++, bark);
    };
    const o = new Object3D(), c = new Color();
    // what it has dropped lies under it, a little brighter than what still hangs
    const drop = (x: number, y: number, s: number, hue: Color) => {
      if (l >= LITTER) return;
      o.position.set(x, 0.09, y); o.scale.set(s, s, 1); o.rotation.set(-Math.PI / 2, 0, x);
      o.updateMatrix();
      fl.setMatrixAt(l, o.matrix);
      fl.setColorAt(l++, c.copy(hue).offsetHSL(0, 0, 0.03));
    };
    for (const t of wood) {
      if (!clearOf(net, t.x, t.y, 6)) continue;
      if (up.some((b) => t.x > b.x0 - 5 && t.x < b.x1 + 5 && t.y > b.y0 - 5 && t.y < b.y1 + 5)) continue;
      if (t.fir) {
        if (j < FIRS) { f.setMatrixAt(j, t.blobs[0].m); f.setColorAt(j++, t.blobs[0].c); }
      } else if (i + t.blobs.length <= CAP - 600) {
        for (const b of t.blobs) { m.setMatrixAt(i, b.m); m.setColorAt(i++, b.c); }
        // the green ones have not let go yet
        if (t.size) stem(t.x, t.y, t.size * 1.3, t.size * 0.09);
        if (t.size && t.blobs[0].c.g < t.blobs[0].c.r * 1.05) drop(t.x, t.y, t.size * 1.9, t.blobs[0].c);
      }
    }
    // street trees: a row down each side of every proper road, in the outer strip of the sidewalk
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
          stem(p.x, p.y, s * 1.3, s * 0.08);
          o.position.set(p.x, s * 1.45, p.y); o.scale.set(s * 0.85, s * 1.1, s * 0.85); o.rotation.set(0, k * 5, 0);
          o.updateMatrix();
          m.setMatrixAt(i, o.matrix);
          // ginkgos, planted all at once: the whole street turns the same week
          const hue = k < 0.12 ? c.setHSL(0.2, 0.4, 0.15) : c.setHSL(0.105 + k * 0.02, 0.82, 0.27 + k * 0.06);
          m.setColorAt(i++, hue);
          if (k >= 0.12) drop(p.x, p.y, s * 1.7, hue);
        }
      }
    }
    m.count = i; f.count = j; fl.count = l; st.count = e;
    for (const q of [m, f, fl, st]) {
      q.instanceMatrix.needsUpdate = true;
      if (q.instanceColor) q.instanceColor.needsUpdate = true;
    }
  }, [wood, net, blocks]);

  return (
    <>
      <instancedMesh ref={ref} args={[crown, undefined, CAP]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={1} vertexColors side={DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={stems} args={[undefined, undefined, STEMS]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.6, 1, 1, 5]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={floor} args={[undefined, undefined, LITTER]} material={litter} receiveShadow frustumCulled={false}>
        <circleGeometry args={[1, 14]} />
      </instancedMesh>
      <instancedMesh ref={firs} args={[undefined, undefined, FIRS]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}
