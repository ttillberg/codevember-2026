// Everything that stands still: grass, asphalt, paint, buildings, trees.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NIGHT, glowing } from './haze';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Uniform, Vector3 } from 'three';
import { boxed, buildGround, clearOf, onRoad, WALK } from './geo';
import { cumLen, offset, place, pointOn, rng, saltOf, type Net } from './net';

/** A tile of the grid, and where its middle lies. */
export interface Tile { i: number; j: number; x: number; y: number }
const HOME: Tile = { i: 0, j: 0, x: 0, y: 0 };
import { Town, type Block } from './Town';
import { settle, soaked, wet } from './wet';

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

/** How much of the street lamps' sodium light a road gives back after dark, so a road reads as a road and not as a row of dots. */
const LIT = 'vec3(1.0, 0.52, 0.14)';

/** For the trees, whose materials are made in the markup: they take the light of the place at night, on the side that faces it. */
const lit = (m: MeshStandardMaterial | null) => { if (m) glowing(m, 0.8, true); };

/** World-space grain on a material, so a flat colour reads as a surface. `lit` is what it gives back of the lamps at night. */
export function grained(color: number, body: string, key: string, roughness = 0.95, lit = 0, takes = 1, aloft = false) {
  const m = new MeshStandardMaterial({ color, roughness, metalness: 0, side: DoubleSide });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\n' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ vec2 p = vWp.xz; ' + body + ' }');
    if (lit) {
      s.uniforms.uNight = NIGHT;
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${LIT} * ${lit.toFixed(3)} * uNight;`);
    }
  };
  m.customProgramCacheKey = () => key + (lit ? 'lit' + lit : '');
  // `takes`: how much of the lamps' light it gives back at night. Asphalt and paint most: the road is what the lamps are for
  return glowing(m, takes, false, aloft);
}

const GRASS = `
  float big = fbm(p * 0.012), mid = fbm(p * 0.09 + 31.0), fine = vn(p * 2.1);
  // rough ground, not a lawn: scrub, dry patches, and red earth where it has been dug
  vec3 dry = vec3(0.52, 0.44, 0.24);
  // evenly dry: in big patches it read as the shadows of clouds
  diffuseColor.rgb = mix(diffuseColor.rgb, dry, (0.4 + 0.2 * big) * DRY);
  // what has come down lies in drifts: leaves in autumn, petals in spring
  float drift = smoothstep(0.5, 0.72, fbm(p * 0.05 + 23.0)) * smoothstep(0.35, 0.7, vn(p * 1.6 + 4.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(DRIFT_A, DRIFT_B, vn(p * 0.3 + 9.0)), drift * DRIFT_K);
  // only a little light and dark across it: more reads as the shadows of clouds
  diffuseColor.rgb *= 0.88 + 0.1 * mid + 0.14 * fine;
  float dug = smoothstep(0.66, 0.72, fbm(p * 0.018 + 70.0)) * smoothstep(0.35, 0.6, fbm(p * 0.11 + 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.36, 0.26) * (0.85 + 0.3 * fine), dug * 0.85);
  // winter: snow where nobody walks
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96) * (0.9 + 0.1 * fine), SNOW * smoothstep(0.22, 0.5, fbm(p * 0.035 + 3.0)));
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
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(DRIFT_A, DRIFT_B, vn(p * 0.5 + 2.0)), lf * DRIFT_K);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.94), SNOW * 0.6 * smoothstep(0.4, 0.62, fbm(p * 0.09 + 8.0)));
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

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
/** what the ground wears: the grass, how dry it is, what lies in drifts on it and how much, and the snow */
const GROUND: Record<Season, { grass: number; dry: number; a: string; b: string; k: number; snow: number }> = {
  spring: { grass: 0x5f7c30, dry: 0.2, a: 'vec3(0.95, 0.72, 0.8)', b: 'vec3(0.98, 0.95, 0.9)', k: 0.4, snow: 0 },
  summer: { grass: 0x4d6a2a, dry: 0.4, a: 'vec3(0.6, 0.55, 0.3)', b: 'vec3(0.5, 0.45, 0.25)', k: 0.15, snow: 0 },
  autumn: { grass: 0x56602b, dry: 0.55, a: 'vec3(0.78, 0.46, 0.06)', b: 'vec3(0.6, 0.16, 0.04)', k: 0.75, snow: 0 },
  winter: { grass: 0x6f7257, dry: 0.6, a: 'vec3(0.4, 0.3, 0.2)', b: 'vec3(0.3, 0.24, 0.18)', k: 0.3, snow: 0.92 },
};
const worn = (body: string, s: Season) => {
  const g = GROUND[s];
  return body.replaceAll('DRIFT_A', g.a).replaceAll('DRIFT_B', g.b).replaceAll('DRIFT_K', g.k.toFixed(2)).replaceAll('DRY', g.dry.toFixed(2)).replaceAll('SNOW', g.snow.toFixed(2));
};

/** What the park, the pitch and the school ask of the trees: where none of the woods may stand, and the ones planted along the walks. */
export interface Glade { keep: (x: number, y: number) => boolean; trees: { x: number; y: number; s: number; k: number }[] }

export function World({ net, blocks, wood, trees = true, season = 'autumn', tile = HOME }: {
  net: Net; blocks: Block[];
  /** which tile of the grid this is the ground of: each has its own, made from its part of the network */
  tile?: Tile;
  /** the place as the trees know it: a frame behind the ground, so that felling them is not part of laying a road */
  wood?: { net: Net; blocks: Block[]; green?: Glade };
  trees?: boolean; season?: Season;
}) {
  const ground = useMemo(() => buildGround(net), [net]);
  const mats = useMemo(
    () => ({
      grass: grained(GROUND[season].grass, worn(GRASS, season), 'grass' + season, 1, 0, 0.5),
      // what lies along the roads goes with them while a smear is dragged; the lots and the concrete of the houses stay
      walk: wet(grained(0xa5a39b, worn(SLAB, season), 'slab' + season, 0.95, 0.1, 1, true), 'ground'),
      paving: grained(0xa5a39b, worn(SLAB, season), 'slab' + season),
      felt: grained(0xffffff, FELT, 'felt', 0.85),
      kerb: wet(grained(0xb3b0a8, ROOF, 'kerb', 0.95, 0, 1, true), 'ground'),
      rim: grained(0xb3b0a8, ROOF, 'kerb'),
      pad: grained(0x787a79, LOT, 'lot', 0.95, 0, 2),
      // sun-bleached, the way a road looks from the air. After dark every road shines a little by itself, lamp or no lamp:
      // a cheat, so that no stretch of road is ever lost in the dark. The lamps are there to be looked at, and add to it
      road: wet(grained(0x6b6d6f, ASPHALT, 'asphalt', 0.9, 0.5, 1.5, true), 'ground'),
      white: wet(grained(0xe6e5de, PAINT, 'paint', 0.7, 0.55, 1.4, true), 'ground'),
      yellow: wet(grained(0xcfae4a, PAINT, 'paint', 0.7, 0.55, 1.4, true), 'ground'),
      guide: wet(grained(0xd08c00, PAINT, 'paint', 0.9), 'ground'),
    }),
    [season],
  );
  useEffect(() => () => Object.values(ground).forEach((g) => g.dispose()), [ground]);
  // the ground shown now is made from these roads: pushed only by as much as the hand has moved since
  useLayoutEffect(() => settle('ground', net), [ground, net]);


  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={mats.grass}>
        <planeGeometry args={[5000, 5000]} />
      </mesh>
      <mesh geometry={ground.walk} material={mats.walk} receiveShadow />
      <mesh geometry={ground.yard} material={mats.paving} receiveShadow />
      <mesh geometry={ground.guide} material={mats.guide} receiveShadow />
      <mesh geometry={ground.kerb} material={mats.kerb} receiveShadow />
      <mesh geometry={ground.rim} material={mats.rim} receiveShadow />
      <mesh geometry={ground.pad} material={mats.pad} receiveShadow />
      <mesh geometry={ground.road} material={mats.road} receiveShadow />
      <mesh geometry={ground.white} material={mats.white} receiveShadow />
      <mesh geometry={ground.yellow} material={mats.yellow} receiveShadow />
      <mesh geometry={ground.decks} material={mats.kerb} castShadow receiveShadow />
      <Buildings net={net} />
      <Town net={net} blocks={blocks} paving={mats.paving} roofing={mats.felt} />
      <group visible={trees}>
        <Trees net={(wood ?? { net }).net} blocks={(wood ?? { blocks }).blocks} glade={wood?.green} season={season} tile={tile} />
      </group>
    </group>
  );
}

function Buildings({ net }: { net: Net }) {
  const units = useRef<InstancedMesh>(null);
  const roofs = useMemo(() => new Map<number, MeshStandardMaterial>(), []);
  const roof = (c: number) => roofs.get(c) ?? roofs.set(c, grained(c, FELT, 'felt')).get(c)!;
  // the walls keep the material they were first given: the sheds come and go with their tile, and one made anew at
  // night came out white
  const wallsOf = useMemo(() => new Map<number, MeshStandardMaterial>(), []);
  const wall = (c: number) => wallsOf.get(c) ?? wallsOf.set(c, new MeshStandardMaterial({ color: c, roughness: 0.9 })).get(c)!;

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
              <mesh position={[cx, b.h, cz]} castShadow receiveShadow material={roof(b.roof)} dispose={null}>
                <boxGeometry args={[w, 0.7, d]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[cx + (s * w) / 3, b.h / 2, cz]} castShadow material={wall(b.wall)} dispose={null}>
                  <boxGeometry args={[0.5, b.h, 0.5]} />
                </mesh>
              ))}
            </group>
          );
        return (
          <group key={i}>
            <mesh position={[cx, b.h / 2, cz]} castShadow receiveShadow material={wall(b.wall)} dispose={null}>
              <boxGeometry args={[w, b.h, d]} />
            </mesh>
            {/* the roof deck, inside a rim of wall */}
            <mesh position={[cx, b.h + 0.03, cz]} rotation-x={-Math.PI / 2} receiveShadow material={roof(b.roof)} dispose={null}>
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

/** What a leaf tree wears. In November: some still green, most gone yellow, a few on fire. */
function leaf(k: number, v: number, bush = false, season: Season = 'autumn') {
  const c = new Color();
  // spring: new leaves, and one tree in five in blossom, pink or white
  if (season === 'spring') return k < 0.12 && !bush ? c.setHSL(0.93 + v * 0.05, 0.7, 0.66) : k < 0.2 && !bush ? c.setHSL(0.12, 0.35, 0.8) : c.setHSL(0.22 + v * 0.07, 0.6, 0.22 + v * 0.1);
  if (season === 'summer') return c.setHSL(0.25 + v * 0.09, 0.42 + v * 0.15, 0.13 + v * 0.08);
  // winter: twigs, and the odd bush that keeps its green
  if (season === 'winter') return bush && k < 0.4 ? c.setHSL(0.3, 0.3, 0.12) : c.setHSL(0.06 + v * 0.03, 0.2, 0.1 + v * 0.05);
  if (k < (bush ? 0.45 : 0.14)) return c.setHSL(0.2 + v * 0.08, 0.3 + v * 0.15, 0.12 + v * 0.07);
  if (k < 0.5) return c.setHSL(0.095 + v * 0.03, 0.85, 0.25 + v * 0.07);
  if (k < 0.76) return c.setHSL(0.05 + v * 0.03, 1, 0.27 + v * 0.07);
  if (k < 0.93) return c.setHSL(0.0 + v * 0.02, 0.95, 0.2 + v * 0.07);
  return c.setHSL(0.07 + v * 0.02, 0.4, 0.11 + v * 0.05);
}

const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/**
 * A pine, in the box a cone would fill: a stem and six skirts of boughs, each ragged at the hem and drooping,
 * the lower ones wide, dark where they tuck in under the one above and paler at the tips.
 */
function pine() {
  const r = rng(53), T = 6, N = 7;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = (x: number, y: number, z: number, cr: number, cg: number, cb: number) => { pos.push(x, y, z); col.push(cr, cg, cb); return pos.length / 3 - 1; };
  // the stem: brown against the green every tree is tinted with
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
    const p = [v(Math.cos(a0) * 0.07, -0.75, Math.sin(a0) * 0.07, 2.4, 1, 0.6), v(Math.cos(a1) * 0.07, -0.75, Math.sin(a1) * 0.07, 2.4, 1, 0.6), v(Math.cos(a1) * 0.05, 0, Math.sin(a1) * 0.05, 2, 0.9, 0.5), v(Math.cos(a0) * 0.05, 0, Math.sin(a0) * 0.05, 2, 0.9, 0.5)];
    idx.push(p[0], p[2], p[1], p[0], p[3], p[2]);
  }
  for (let k = 0; k < T; k++) {
    const f = k / T, rad = 0.1 + 0.9 * Math.pow(1 - f, 0.85);
    const bot = -0.34 + 0.72 * f, top = k === T - 1 ? 0.5 : bot + 0.3;
    const turn = r() * 6;
    const rim: number[] = [];
    for (let i = 0; i < N * 2; i++) {
      const a = turn + (i / (N * 2)) * Math.PI * 2, tip = i % 2 === 0;
      // a bough reaches out and hangs; between two the hem is drawn in and up
      const d = rad * (tip ? 0.85 + r() * 0.3 : 0.5 + r() * 0.15), y = bot + (tip ? -r() * 0.05 : 0.07 + r() * 0.03);
      const g = tip ? 1.1 + r() * 0.35 : 0.6;
      rim.push(v(Math.cos(a) * d, y, Math.sin(a) * d, g * (tip ? 1.05 : 1), g, g * 0.9));
    }
    for (let i = 0; i < N * 2; i++) {
      // each face its own point at the top, so the shade under the skirt above does not smear round
      const apex = v(0, top, 0, 0.5, 0.5, 0.5);
      idx.push(apex, rim[(i + 1) % (N * 2)], rim[i]);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

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

// the woods of every tile planted so far, by season and tile
const WOODS = new Map<string, { x: number; y: number; blobs: { m: Matrix4; c: Color }[]; fir: boolean; size: number; deep: boolean }[]>();

function Trees({ net, blocks, glade, season, tile }: { net: Net; blocks: Block[]; glade?: Glade; season: Season; tile: Tile }) {
  const ref = useRef<InstancedMesh>(null), firs = useRef<InstancedMesh>(null), floor = useRef<InstancedMesh>(null), stems = useRef<InstancedMesh>(null);
  const crown = useMemo(tuft, []);
  const PINE = useMemo(pine, []);
  // in winter most of the leaves are gone: only a third of the cards are drawn
  useLayoutEffect(() => { crown.setDrawRange(0, season === 'winter' ? Math.floor(crown.index!.count / 18) * 6 : Infinity); }, [crown, season]);
  // the street trees are planted last: from these on, each one goes with its road while a smear is dragged
  const first = useMemo(() => ({ crown: new Uniform(1e9), stem: new Uniform(1e9), litter: new Uniform(1e9) }), []);
  const litter = useMemo(() => wet(fallen(), 'trees', first.litter), [first]);
  const soak = useMemo(() => ({ crown: soaked('trees', first.crown), stem: soaked('trees', first.stem) }), [first]);
  // everything is planted once; a road painted through only fells what is in its way
  const wood = useMemo(() => {
    let r = rng(23);
    const out: { x: number; y: number; blobs: { m: Matrix4; c: Color }[]; fir: boolean; size: number; deep: boolean }[] = [];
    const o = new Object3D();
    const clump = (x: number, y: number) => 0.5 + 0.5 * Math.sin(x * 0.013 + 1.7) * Math.cos(y * 0.017 - 0.4) + 0.3 * Math.sin((x + y) * 0.041);
    // where the dark, pointed trees stand together
    const stand = (x: number, y: number) => Math.sin(x * 0.006 + 2) * Math.cos(y * 0.008 + 1) > 0.3;
    const at = (i: number, j: number) => Math.abs(Math.sin(i * 127.1 + j * 311.7) * 43758.5453) % 1;
    // and where it is forest: thick stands with open ground between them, not trees dotted evenly over everything
    const forest = (x: number, y: number) => Math.sin(x * 0.011 + 0.6) * Math.cos(y * 0.013 - 1.1) + 0.5 * Math.sin((x - y) * 0.023 + 2) + 0.25 * Math.sin(x * 0.05) * Math.sin(y * 0.047);
    // every tile is planted by its own number: first the middle, as the place on its own has it, then, when it
    // lies among others, the rim that leaves bare
    for (const t of [tile]) {
    // (a tile that was in the window before keeps the trees it had)
    const key = season + ':' + t.i + ',' + t.j, was = WOODS.get(key);
    if (was) { for (const w of was) out.push(w); continue; }
    const part: typeof out = [];
    if (place.on) WOODS.set(key, part);
    for (const rim of place.on ? [0, 1] : [0])
    for (let i = 0, n = rim ? 41000 : 22000; i < n; i++) {
      if (i === 0) r = rng(23 + saltOf(t.i, t.j) + rim * 7);
      const lx = (r() - 0.5) * (rim ? 1200 : 900), ly = (r() - 0.5) * (rim ? 1200 : 860);
      if (rim && Math.abs(lx) < 450 && Math.abs(ly) < 430) continue;
      const x = lx + t.x, y = ly + t.y;
      const deep = forest(x, y);
      // the edge of a wood thins out over a few metres
      // out in the open they stand a few together: one spot in a cell here and there, and whatever falls within reach of it
      const gx = Math.floor(x / 30), gy = Math.floor(y / 30);
      const spot = at(gx, gy) < 0.3 + clump(x, y) * 0.25
        && Math.hypot(x - (gx + 0.25 + 0.5 * at(gx + 7, gy)) * 30, y - (gy + 0.25 + 0.5 * at(gx, gy + 13)) * 30) < 5 + 5 * at(gx + 3, gy + 5);
      const thick = !spot && r() <= Math.min(1, (deep - 0.25) * 5);
      // under the trees there is little room for bushes
      const kind = deep > 0.45 ? 0.3 + r() * 0.7 : r();
      // but out in front of a wood they stand thick: scrub where the trees give out
      const keep = spot || thick || (kind <= 0.3 && deep > 0.02 && deep <= 0.25 && at(Math.floor(x * 3), Math.floor(y * 3)) < 0.55);
      const fir = kind > 0.3 && r() < (stand(x, y) ? 0.7 : 0.08);
      const bush = kind <= 0.3;
      const size = bush ? 0.9 + r() * 1.1 : fir ? 2 + r() * 1.4 : 2.4 + r() * 3.2;
      const hue = fir
        ? new Color().setHSL(0.36 + r() * 0.06, 0.3 + r() * 0.15, (0.09 + r() * 0.05) * (season === 'winter' ? 1.9 : 1))
        : leaf(r(), r(), bush, season);
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
      if (keep) part.push({ x, y, blobs, fir, size: bush ? 0 : size, deep: !spot });
    }
    for (const w of part) out.push(w);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, tile.i, tile.j]);
  const MORE = place.on ? 2 : 1, CAP = 12000 * MORE, FIRS = 3000 * MORE, LITTER = 4500 * MORE, STEMS = 6000 * MORE;

  useLayoutEffect(() => {
    const m = ref.current!, f = firs.current!, fl = floor.current!, st = stems.current!;
    const up = blocks;
    // leaves come down in autumn, petals in spring
    const lets = season === 'autumn' || season === 'spring';
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
    // the houses by where they stand, a square of 64 m at a time: a tree asks only those beside it
    const near = new Map<string, typeof up>();
    for (const b of up) {
      for (let gx = Math.floor((b.x0 - 18) / 64); gx <= Math.floor((b.x1 + 18) / 64); gx++) {
        for (let gy = Math.floor((b.y0 - 18) / 64); gy <= Math.floor((b.y1 + 18) / 64); gy++) {
          const k = gx + ':' + gy, l = near.get(k);
          if (l) l.push(b); else near.set(k, [b]);
        }
      }
    }
    for (const t of wood) {
      if (!clearOf(net, t.x, t.y, 6)) continue;
      // a wood keeps its distance from a house: a yard's width of open ground. A little house stands in among the trees
      const gap = t.deep ? 18 : 5;
      if (near.get(Math.floor(t.x / 64) + ':' + Math.floor(t.y / 64))?.some((b) => { const g = b.small ? (t.size ? 4.5 : 3.6) : gap; return t.x > b.x0 - g && t.x < b.x1 + g && t.y > b.y0 - g && t.y < b.y1 + g; })) continue;
      // and none of it on the pitch, in the school yard or on a walk of the park
      if (glade && !glade.keep(t.x, t.y)) continue;
      if (t.fir) {
        if (j < FIRS) { f.setMatrixAt(j, t.blobs[0].m); f.setColorAt(j++, t.blobs[0].c); }
      } else if (i + t.blobs.length <= CAP - 600) {
        for (const b of t.blobs) { m.setMatrixAt(i, b.m); m.setColorAt(i++, b.c); }
        // the green ones have not let go yet
        if (t.size) stem(t.x, t.y, t.size * 1.3, t.size * 0.09);
        if (lets && t.size && t.blobs[0].c.g < t.blobs[0].c.r * 1.05) drop(t.x, t.y, t.size * 1.9, t.blobs[0].c);
      }
    }
    // street trees: a row down each side of every proper road, in the outer strip of the sidewalk
    first.crown.value = i; first.stem.value = e; first.litter.value = l;
    const solid = [...net.pads, ...net.buildings];
    const inBox = boxed(solid), blocked = (x: number, y: number) => inBox(x, y, 2);
    // the trees of the park, planted along its walks: each on its own, a clean stem and a round crown
    for (const t of glade?.trees ?? []) {
      if (i + 2 > CAP - 600 || !clearOf(net, t.x, t.y, 3)) continue;
      const hue = leaf(t.k, (t.k * 7.3) % 1, false, season);
      stem(t.x, t.y, t.s * 1.3, t.s * 0.09);
      for (const [dx, dy, dz, k] of [[0, 1.5, 0, 1], [0.35, 1.15, 0.3, 0.75]]) {
        o.position.set(t.x + dx * t.s, dy * t.s, t.y + dz * t.s); o.scale.set(t.s * k, t.s * k, t.s * k); o.rotation.set(0, t.k * 5, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i++, hue);
      }
      if (lets && hue.g < hue.r * 1.05) drop(t.x, t.y, t.s * 1.8, hue);
    }
    for (const r of net.roads) {
      if (r.rank < 2 || r.bridge || r.ring) continue;
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
          const hue = season === 'spring' ? c.setHSL(0.21 + k * 0.03, 0.6, 0.26 + k * 0.06) : season === 'summer' ? c.setHSL(0.25 + k * 0.03, 0.5, 0.17 + k * 0.05)
            : season === 'winter' ? c.setHSL(0.07, 0.2, 0.12 + k * 0.04) : k < 0.12 ? c.setHSL(0.2, 0.4, 0.15) : c.setHSL(0.105 + k * 0.02, 0.82, 0.27 + k * 0.06);
          m.setColorAt(i++, hue);
          if (season === 'autumn' && k >= 0.12) drop(p.x, p.y, s * 1.7, hue);
        }
      }
    }
    m.count = i; f.count = j; fl.count = l; st.count = e;
    settle('trees', net);
    for (const q of [m, f, fl, st]) {
      q.instanceMatrix.needsUpdate = true;
      if (q.instanceColor) q.instanceColor.needsUpdate = true;
    }
  }, [wood, net, blocks, glade, season, first]);

  return (
    <>
      <instancedMesh ref={ref} args={[crown, undefined, CAP]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial ref={lit} roughness={1} vertexColors side={DoubleSide} {...soak.crown} />
      </instancedMesh>
      <instancedMesh ref={stems} args={[undefined, undefined, STEMS]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.6, 1, 1, 5]} />
        <meshStandardMaterial roughness={1} {...soak.stem} />
      </instancedMesh>
      <instancedMesh ref={floor} args={[undefined, undefined, LITTER]} material={litter} receiveShadow frustumCulled={false}>
        <circleGeometry args={[1, 14]} />
      </instancedMesh>
      <instancedMesh ref={firs} args={[PINE, undefined, FIRS]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial ref={lit} roughness={1} flatShading vertexColors side={DoubleSide} />
      </instancedMesh>
    </>
  );
}
