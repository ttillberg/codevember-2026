// What lies on the moss and stands up out of it, after the splash. From a worm's eye the floor is seen edge on, so
// what gives it life is what stands up: flat things show only right under you. By hash on a grid of cells round
// you, placed one cell a frame as they come in range and taken away as they go; each kind one instanced mesh,
// repacked when the cells change.
//  - wood sorrel (harsyra): dense clumps of little plants, three heart-shaped leaflets folded a little along the
//    midrib on a thin stem well up out of the moss; a fresh light green that glows with the sun behind it
//  - woodland grass (wavy hair-grass / autumn sedge): loose tufts of thin arching blades rising above the moss
//  - woodland wildflowers (starflower, wood violet, tormentil, twinflower): small delicate blossoms on thin stems
//  - pixie-cup lichens: little grey-green goblets on stalks in groups, now and then a group with red tips
//  - reindeer lichen: pale, finely branched cushions, more of them in the clearings
//  - stones: lumpy, half sunk, grey with pale crust lichen, moss on their tops
//  - fallen birch leaves: curled, yellow to orange to brown; many under a birch; some wedged on edge in the moss
// Leaves, sorrel, grass and flowers are lightweight instanced cards/strips with their shape cut in the fragment
// shader; cups, cushions and stones are small meshes, textured from their world position.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, noise3 } from './noise';
import { mossLighting } from './shaders';
import { groundHeight, mossAt, trunkInCell, puddleAt, clearing, TREE_CELL } from './world';

const coarse = matchMedia('(pointer: coarse)').matches;
const CELL = 1.0;
const RANGE = coarse ? 4.5 : 6;
const DROP = RANGE + 1.5;

type Kind = 'LEAF' | 'SORREL' | 'GRASS' | 'FLOWER' | 'CUP' | 'CUSHION' | 'STONE';
const MAX: Record<Kind, number> = {
  LEAF: 9000, SORREL: 9000,
  GRASS: coarse ? 5500 : 12000,
  FLOWER: coarse ? 1200 : 2800,
  CUP: 5000, CUSHION: 1500, STONE: 800,
};
// levels of detail for the lumps: near they were angular, 320 triangles in all. The shape is a noise of
// the direction from the middle, so every level is the same stone. Sorted again as you move.
const LUMP_LOD = [1.6, 4.0]; // near up to here, then mid, then far
const LUMP_DETAIL = [coarse ? 8 : 12, 6, 3]; // (three's detail: 20 (d + 1)² triangles, 3,400 near, 320 far)
const RESORT = 0.35; // metres moved before the lumps are sorted into their levels again
type Cell = Record<Kind, { m: number[]; d: number[] }>;

/** how much birch is overhead here: 1 under one, falling off over six metres */
function birchNear(x: number, z: number) {
  const ix = Math.floor(x / TREE_CELL), iz = Math.floor(z / TREE_CELL);
  let b = 0;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const t = trunkInCell(ix + dx, iz + dz);
    if (!t || !t.birch) continue;
    b = Math.max(b, 1 - Math.hypot(t.x - x, t.z - z) / 6);
  }
  return b;
}

/** the moss's top at a point: things lie on it */
const mossTop = (x: number, z: number) => { const g = groundHeight(x, z); return g + 0.032 * mossAt(x, g, z); };

/** A leaf card: across -0.5..0.5 (x), along 0..1 (z), flat; the vertex shader curls it. */
function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 4, 6);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/**
 * A wood sorrel plant, its top at the origin, leaflets one unit long: a thin stem down from it (to -1, the
 * vertex shader stretches it to the plant's height) and three leaflets out at a third of a turn each, a little
 * folded along the midrib and drooping at the tips. uv: (across -0.5..0.5, along 0..1); part 0 stem, 1 leaflet.
 */
function sorrelGeometry() {
  const pos: number[] = [], uv: number[] = [], part: number[] = [], idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    const a = s * Math.PI / 2, cx = Math.cos(a) * 0.04, cz = Math.sin(a) * 0.04;
    const b = pos.length / 3;
    pos.push(-cx, -1, -cz, cx, -1, cz, -cx, 0, -cz, cx, 0, cz);
    uv.push(-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1);
    part.push(0, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const NA = 3, NL = 4;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const b = pos.length / 3;
    for (let j = 0; j <= NL; j++) {
      const t = j / NL;
      for (let i = 0; i < NA; i++) {
        const s = i / (NA - 1) - 0.5;
        const y = Math.abs(s) * 0.25 - 0.12 * t * t;
        pos.push(dx * t + px * s, y, dz * t + pz * s);
        uv.push(s, t);
        part.push(1);
      }
    }
    for (let j = 0; j < NL; j++) for (let i = 0; i < NA - 1; i++) {
      const q = b + j * NA + i;
      idx.push(q, q + NA, q + 1, q + 1, q + NA, q + NA + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A slender grass blade, 1 unit tall along +y, slight V-fold across x (-0.5..0.5); vertex shader arches and sways it. */
function grassGeometry() {
  const NA = 3, NL = 5;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NL; j++) {
    const t = j / NL;
    const w = 1 - Math.pow(t, 1.35) * 0.92; // tapers to a needle point
    for (let i = 0; i < NA; i++) {
      const s = i / (NA - 1) - 0.5;
      pos.push(s * w, t, 0); // flat in z (z is scaled by blade height h for the arch, not blade width w)
      uv.push(s, t);
    }
  }
  for (let j = 0; j < NL; j++) for (let i = 0; i < NA - 1; i++) {
    const q = j * NA + i;
    idx.push(q, q + 1, q + NA, q + 1, q + NA + 1, q + NA);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A small woodland wildflower: thin crossed stem down to -1 (stretched by iData.x like sorrel, part = 0)
 * and a softly cupped blossom disc at the origin (part = 1, uv -0.5..0.5; petals cut in the fragment shader).
 */
function flowerGeometry() {
  const pos: number[] = [], uv: number[] = [], part: number[] = [], idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    const a = s * Math.PI / 2, cx = Math.cos(a) * 0.032, cz = Math.sin(a) * 0.032;
    const b = pos.length / 3;
    pos.push(-cx, -1, -cz, cx, -1, cz, -cx, 0, -cz, cx, 0, cz);
    uv.push(-0.5, 0, 0.5, 0, -0.5, 1, 0.5, 1);
    part.push(0, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const N = 4;
  const b = pos.length / 3;
  // nod the blossom head gently forward (~34°) on its upright stem so petals face a low worm's eye
  const nod = 0.6, cn = Math.cos(nod), sn = Math.sin(nod);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = i / N - 0.5, z = j / N - 0.5;
    const y0 = (x * x + z * z) * 0.68 - 0.03;
    pos.push(x, y0 * cn - z * sn, y0 * sn + z * cn);
    uv.push(x, z);
    part.push(1);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = b + j * (N + 1) + i;
    idx.push(q, q + N + 1, q + 1, q + 1, q + N + 1, q + N + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A pixie cup, one unit tall: a thin stalk flaring into a goblet, open (the inside drawn too). uv.y: up 0..1. */
function cupGeometry() {
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [[0.07, 0], [0.065, 0.3], [0.08, 0.5], [0.16, 0.7], [0.3, 0.88], [0.36, 0.97], [0.34, 1.0], [0.28, 0.96], [0.12, 0.86]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 10);
  return g;
}

/** A lump, one unit across, displaced by a noise: a stone (flattened by its scale) or a lichen cushion. */
function lumpGeometry(seed: number, amount: number, flatBottom: boolean, detail = 3) {
  // (merged: the icosahedron comes unindexed, and its normals came out flat, a faceted shard)
  const g = mergeVertices(new THREE.IcosahedronGeometry(0.5, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const d = 1 + amount * noise3(n.x * 1.6, n.y * 1.6, n.z * 1.6, seed) + amount * 0.35 * noise3(n.x * 4.5, n.y * 4.5, n.z * 4.5, seed + 1);
    v.multiplyScalar(d);
    if (flatBottom && v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Floor {
  readonly root = new THREE.Group();
  readonly flora: THREE.Object3D[] = []; // grass and wildflowers (for debug toggle & skipping sub-texel shadow pass)
  private cells = new Map<string, Cell>();
  private meshes = {} as Record<Kind, THREE.InstancedMesh[]>;
  private data = {} as Record<Kind, THREE.InstancedBufferAttribute[]>;
  private packedAt = new THREE.Vector2(Infinity, Infinity);
  private floraVis: boolean[] = [];
  changed = false;

  constructor(setup: (m: THREE.ShaderMaterial) => void) {
    const geos: Record<Kind, THREE.BufferGeometry[]> = {
      LEAF: [leafGeometry()], SORREL: [sorrelGeometry()],
      GRASS: [grassGeometry()], FLOWER: [flowerGeometry()],
      CUP: [cupGeometry()],
      CUSHION: LUMP_DETAIL.map((d) => lumpGeometry(41, 0.22, true, d)),
      STONE: LUMP_DETAIL.map((d) => lumpGeometry(43, 0.18, true, d)),
    };
    for (const kind of Object.keys(geos) as Kind[]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader, side: THREE.DoubleSide,
        uniforms: { uFar: { value: RANGE } },
        defines: { [kind]: 1 },
      });
      setup(mat);
      this.meshes[kind] = [];
      this.data[kind] = [];
      for (const geo of geos[kind]) {
        const data = new THREE.InstancedBufferAttribute(new Float32Array(MAX[kind] * 4), 4);
        geo.setAttribute('iData', data);
        const m = new THREE.InstancedMesh(geo, mat, MAX[kind]);
        m.count = 0;
        m.frustumCulled = false;
        this.root.add(m);
        if (kind === 'GRASS' || kind === 'FLOWER') this.flora.push(m);
        this.meshes[kind].push(m);
        this.data[kind].push(data);
      }
    }
  }

  /** Sub-millimetre grass blades and tiny flowers are too fine for the shadow map: skip them in the shadow pass. */
  forShadow(on: boolean) {
    if (on) {
      this.floraVis = this.flora.map((o) => o.visible);
      for (const o of this.flora) o.visible = false;
    } else {
      this.flora.forEach((o, i) => { o.visible = this.floraVis[i] ?? true; });
    }
  }

  private build(ix: number, iz: number): Cell {
    const r = mulberry32((Math.imul(ix, 0x51ed27) ^ Math.imul(iz, 0x2f9be6d) ^ 0x1eaf) >>> 0);
    const out: Cell = {
      LEAF: { m: [], d: [] }, SORREL: { m: [], d: [] },
      GRASS: { m: [], d: [] }, FLOWER: { m: [], d: [] },
      CUP: { m: [], d: [] }, CUSHION: { m: [], d: [] }, STONE: { m: [], d: [] },
    };
    const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const put = (kind: Kind, d: number[]) => { out[kind].m.push(...mat.compose(p, q, s).elements); out[kind].d.push(...d); };
    const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL;
    const open = clearing(cx, cz);
    // leaves: a few anywhere, many under a birch; some wedged on edge in the moss, where they show.
    // On a puddle, a fallen leaf floats flat on the surface or lies dark on the bed.
    const nl = Math.floor(2 + r() * 3 + 26 * birchNear(cx, cz) * (0.6 + 0.4 * r()));
    for (let i = 0; i < nl; i++) {
      const x = (ix + r()) * CELL, z = (iz + r()) * CELL;
      const pd = puddleAt(x, z);
      const inWater = pd !== null && pd.u < 0.96;
      const edge = !inWater && r() < 0.4;
      const floats = inWater && r() < 0.55;
      p.set(x, floats ? pd.puddle.y + 0.0018 : inWater ? groundHeight(x, z) + 0.004 : mossTop(x, z) + (edge ? 0.0 : 0.018), z);
      const tilt = edge ? (r() < 0.5 ? -1 : 1) * (0.9 + 0.5 * r()) : inWater ? (r() - 0.5) * 0.06 : (r() - 0.5) * 0.5;
      q.setFromEuler(e.set(tilt, r() * Math.PI * 2, inWater ? (r() - 0.5) * 0.06 : (r() - 0.5) * 0.5, 'YXZ'));
      const sz = 0.04 + 0.035 * r();
      s.set(sz * (0.75 + 0.1 * r()), sz, sz);
      // curl, colour (yellow .. orange .. brown), decay, seed
      put('LEAF', [inWater ? 0.06 * r() : (r() - 0.3) * 0.35, r() * r(), r() < 0.2 ? r() : 0, r()]);
    }
    // wood sorrel: a dense clump in about two cells in five
    if (r() < 0.4) {
      const n = 18 + Math.floor(r() * 26);
      const gx = (ix + 0.2 + 0.6 * r()) * CELL, gz = (iz + 0.2 + 0.6 * r()) * CELL;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.34;
        const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.04) continue;
        const leaf = 0.018 + 0.013 * r(); // a leaflet two or three centimetres long
        const h = 0.07 + 0.07 * r() * (1 - 0.5 * d / 0.34); // its stem out of the moss, taller in the middle
        p.set(x, mossTop(x, z) + h, z);
        q.setFromEuler(e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4, 'YXZ'));
        s.set(leaf, leaf, leaf);
        put('SORREL', [(h + 0.02) / leaf, r(), r(), r()]);
      }
    }
    // woodland grass: loose tufts of slender, wispy hair-grass & fine sedge rising above the moss (10–28 cm)
    const tufts = r() < 0.58 + 0.22 * open ? 1 + (r() < 0.5 ? 1 : 0) : 0;
    for (let tf = 0; tf < tufts; tf++) {
      const gx = (ix + 0.15 + 0.7 * r()) * CELL, gz = (iz + 0.15 + 0.7 * r()) * CELL;
      const gPd = puddleAt(gx, gz);
      if (gPd && gPd.u < 1.03) continue;
      // taller, lusher tufts near damp puddle rims and bright clearings
      const lush = gPd && gPd.u < 1.38 ? 1.25 : 1 + 0.18 * open;
      const tone = r(); // shared tint per tuft: deep woodland olive .. straw gold .. autumn russet
      const n = 14 + Math.floor(r() * 14);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.15;
        const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.02) continue;
        if (Math.hypot(x, z) < 0.3) continue;
        const h = (0.10 + 0.18 * Math.pow(r(), 0.9)) * lush;
        const w = 0.0016 + 0.0022 * r(); // hair-thin blades, never wide straps
        p.set(x, mossTop(x, z) - 0.012, z);
        q.setFromEuler(e.set((r() - 0.5) * 0.22, a + (r() - 0.5) * 1.1, (r() - 0.5) * 0.15, 'YXZ'));
        s.set(w, h, h); // z scaled with h so vertex-shader arch stays proportional
        // arch, colour tone (green -> gold -> russet), tip dryness, phase seed
        put('GRASS', [0.22 + 0.65 * r(), Math.min(1, Math.max(0, tone + (r() - 0.5) * 0.25)), r(), r()]);
      }
    }
    // woodland wildflowers: small delicate patches (starflower, wood violet, tormentil, twinflower)
    // blossoms nod/tilt naturally so they read from a low worm's eye as well as from above
    if (r() < 0.38 + 0.24 * open) {
      const sp = r(); // 0..0.44 white starflower, ..0.70 violet-blue, ..0.87 butter-yellow, ..1.0 blush-pink
      const gx = (ix + 0.2 + 0.6 * r()) * CELL, gz = (iz + 0.2 + 0.6 * r()) * CELL;
      const n = 6 + Math.floor(r() * 8);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.38;
        const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.05) continue;
        if (Math.hypot(x, z) < 0.45) continue; // keep clear of the opening fungi
        const sz = (sp < 0.44 ? 0.028 : sp < 0.7 ? 0.026 : 0.024) * (0.8 + 0.45 * r());
        const h = 0.10 + 0.11 * r() * (1 - 0.25 * d / 0.38);
        const tilt = (r() - 0.5) * 0.4; // subtle stem lean; blossom head already nods in geometry
        p.set(x, mossTop(x, z) + h, z);
        q.setFromEuler(e.set(tilt, r() * Math.PI * 2, (r() - 0.5) * 0.35, 'YXZ'));
        s.set(sz, sz, sz);
        // stem ratio, species selector, hue jitter, phase seed
        put('FLOWER', [(h + 0.02) / sz, sp, r(), r()]);
      }
    }
    // pixie cups: a group in about one cell in four; a third of the groups red-tipped
    if (r() < 0.25) {
      const n = 6 + Math.floor(r() * 16), red = r() < 0.33 ? 1 : 0;
      const gx = (ix + 0.2 + 0.6 * r()) * CELL, gz = (iz + 0.2 + 0.6 * r()) * CELL;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.12;
        const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.04) continue;
        const hgt = 0.035 + 0.03 * r(); // (over the moss's fronds: a fairy tale's, a little)
        p.set(x, mossTop(x, z) + 0.008, z);
        q.setFromEuler(e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4, 'YXZ'));
        s.set(hgt * (0.8 + 0.4 * r()), hgt, hgt * (0.8 + 0.4 * r()));
        put('CUP', [red, r(), r(), r()]);
      }
    }
    // reindeer lichen: pale cushions, more in the open
    if (r() < 0.12 + 0.35 * open) {
      const n = 1 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const x = (ix + 0.15 + 0.7 * r()) * CELL, z = (iz + 0.15 + 0.7 * r()) * CELL;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.06) continue;
        const w = 0.1 + 0.12 * r();
        p.set(x, mossTop(x, z) + 0.012, z);
        q.setFromEuler(e.set(0, r() * Math.PI * 2, 0));
        s.set(w, w * (0.6 + 0.3 * r()), w * (0.8 + 0.3 * r()));
        put('CUSHION', [r(), r(), r(), r()]);
      }
    }
    // stones: now and then one or two, half sunk
    if (r() < 0.14) {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const x = (ix + 0.15 + 0.7 * r()) * CELL, z = (iz + 0.15 + 0.7 * r()) * CELL;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 0.85) continue; // allow stones along the shoreline bank
        const w = 0.08 + 0.22 * r() * r();
        p.set(x, groundHeight(x, z) + w * 0.18, z);
        q.setFromEuler(e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5));
        s.set(w * (0.8 + 0.5 * r()), w * (0.55 + 0.3 * r()), w * (0.8 + 0.5 * r()));
        put('STONE', [r(), r(), r(), r()]);
      }
    }
    return out;
  }

  private repack(px: number, pz: number) {
    this.packedAt.set(px, pz);
    for (const kind of Object.keys(this.meshes) as Kind[]) {
      const meshes = this.meshes[kind], datas = this.data[kind];
      const levels = meshes.length;
      const n = new Array(levels).fill(0);
      for (const c of this.cells.values()) {
        const m = c[kind].m, d = c[kind].d;
        for (let i = 0; i < m.length / 16; i++) {
          let lv = 0;
          if (levels > 1) {
            const dist = Math.hypot(m[i * 16 + 12] - px, m[i * 16 + 14] - pz);
            lv = dist < LUMP_LOD[0] ? 0 : dist < LUMP_LOD[1] ? 1 : 2;
          }
          if (n[lv] >= MAX[kind]) continue;
          (meshes[lv].instanceMatrix.array as Float32Array).set(m.slice(i * 16, i * 16 + 16), n[lv] * 16);
          (datas[lv].array as Float32Array).set(d.slice(i * 4, i * 4 + 4), n[lv] * 4);
          n[lv]++;
        }
      }
      meshes.forEach((mesh, lv) => { mesh.count = n[lv]; mesh.instanceMatrix.needsUpdate = true; datas[lv].needsUpdate = true; });
    }
    this.changed = true;
  }

  /** Place the cells coming into range (one per call), take away the ones gone out. True if one was placed. */
  update(px: number, pz: number) {
    const i0 = Math.floor(px / CELL), k0 = Math.floor(pz / CELL);
    const R = Math.ceil(RANGE / CELL);
    let dirty = false, placed = false;
    for (let dz = -R; dz <= R && !placed; dz++) for (let dx = -R; dx <= R && !placed; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) > RANGE) continue;
      const key = `${ix},${iz}`;
      if (this.cells.has(key)) continue;
      this.cells.set(key, this.build(ix, iz));
      placed = dirty = true;
    }
    for (const key of this.cells.keys()) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) < DROP) continue;
      this.cells.delete(key);
      dirty = true;
    }
    // (and the lumps sorted into their levels again once you have moved a little)
    if (dirty || Math.hypot(px - this.packedAt.x, pz - this.packedAt.y) > RESORT) this.repack(px, pz);
    return placed;
  }
}

const vertexShader = /* glsl */ `
attribute vec4 iData;
#if defined(SORREL) || defined(FLOWER)
attribute float part;
varying float vPart;
#endif
uniform float uTime;
uniform vec4 uWalker; // walker's foot position (xyz), crouch (w)
uniform vec2 uWalkDir; // walker's facing XZ for left/right parting
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vData;
varying vec3 vLocal;
void main() {
  vec3 p = position;
  vec3 n = normal;
  #ifdef LEAF
  // curled: the halves up (or down) from the midrib, the tip lifting a little
  p.y += iData.x * (p.x * p.x * 1.6) + abs(iData.x) * 0.25 * p.z * p.z;
  n = normalize(vec3(-iData.x * 3.2 * p.x, 1.0, -abs(iData.x) * 0.5 * p.z));
  #endif
  #ifdef SORREL
  vPart = part;
  if (part < 0.5) p.y *= iData.x; // the stem, down into the moss
  #endif
  #ifdef GRASS
  // slender blade arching outward along +z and swaying softly in the forest breeze
  float t = p.y;
  float bend = iData.x * t * t;
  p.z += bend;
  p.y -= bend * bend * 0.28;
  float sway = sin(uTime * 1.4 + iData.w * 40.0 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 1.3) * 0.045 * t * t;
  p.z += sway;
  p.x += sway * 4.0;
  // tilt normal with the arch so sunlit blades catch golden sheen along the curve
  n = normalize(vec3(0.0, 0.25 + 1.4 * iData.x * t, 1.0));
  #endif
  #ifdef FLOWER
  vPart = part;
  float sw = sin(uTime * 1.35 + iData.w * 45.0 + instanceMatrix[3].x * 1.9 + instanceMatrix[3].z * 1.5) * 0.32;
  if (part < 0.5) {
    // stem stands roughly upright down into the moss, flexing slightly at the head
    float st = uv.y * uv.y;
    p.y *= iData.x;
    p.x += sw * st;
    p.z += sw * 0.6 * st;
  } else {
    p.x += sw;
    p.z += sw * 0.6;
  }
  #endif
  vLocal = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  #if defined(GRASS) || defined(SORREL) || defined(FLOWER)
  // brush aside left/right as the walker crawls through, keeping roots anchored in the moss
  {
    vec2 rootXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    vec2 d = rootXZ - uWalker.xz;
    float dist = length(d);
    float rad = 0.36 + 0.06 * uWalker.w;
    float dy = abs(wp.y - uWalker.y);
    float push = smoothstep(rad, 0.04, dist) * smoothstep(0.5, 0.1, dy);
    if (push > 0.001) {
      #ifdef GRASS
      float bendW = position.y * position.y;
      float stemH = length(instanceMatrix[1].xyz);
      #else
      float bendW = part < 0.5 ? uv.y * uv.y : 1.0;
      float stemH = length(instanceMatrix[1].xyz) * iData.x;
      #endif
      vec2 away = dist > 1e-4 ? d / dist : vec2(1.0, 0.0);
      vec2 right = vec2(-uWalkDir.y, uWalkDir.x);
      float side = dot(d, right);
      float sidePush = clamp(side / 0.07, -1.0, 1.0) + (iData.w < 0.5 ? -0.35 : 0.35) * (1.0 - smoothstep(0.0, 0.08, abs(side)));
      vec2 dir = normalize(away * 0.45 + right * sidePush * 0.9);
      float amt = push * push * min(stemH * 0.82, 0.22) * bendW;
      wp.xz += dir * amt;
      wp.y -= amt * 0.45 * push;
      wn = normalize(wn + vec3(dir.x, 0.0, dir.y) * push * 0.7 * bendW);
    }
  }
  #endif
  vWorldPos = wp.xyz;
  vNormal = wn;
  vUv = uv;
  #ifdef LEAF
  vUv = vec2(position.x, position.z);
  #endif
  vData = iData;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
uniform float uFar;
${mossLighting}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vData;
varying vec3 vLocal;
#if defined(SORREL) || defined(FLOWER)
varying float vPart;
#endif
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  if (nearFade(vWorldPos, 0.02, 0.05) < 0.5) discard;
  float a = vUv.x, t = vUv.y; // across, along
  vec3 col = vec3(0.5);
  float thin = 0.0, wet = 0.0;
  vec3 N = normalize(vNormal);
  #ifdef LEAF
  // a birch leaf: a stalk, then broad near the base, coming to a point; the edge doubly toothed
  float stalk = smoothstep(0.1, 0.13, t);
  float u = clamp((t - 0.1) / 0.9, 0.0, 1.0);
  float w = 0.5 * pow(sin(3.14159 * pow(u, 0.62)), 0.9) * (1.0 - 0.15 * u);
  w *= 1.0 - 0.07 * abs(sin(u * 46.0)) - 0.03 * abs(sin(u * 23.0 + 1.0));
  w = mix(0.025, w, stalk);
  if (abs(a) > w || t > 0.995) discard;
  vec3 yel = vec3(0.88, 0.6, 0.1), ora = vec3(0.8, 0.3, 0.06), bro = vec3(0.42, 0.2, 0.08);
  float hue = vData.y;
  col = hue < 0.5 ? mix(yel, ora, hue * 2.0) : mix(ora, bro, (hue - 0.5) * 2.0);
  col = mix(col, bro, smoothstep(0.6, 1.0, abs(a) / max(w, 1e-3)) * 0.35);
  float spot = smoothstep(0.62, 0.7, n21(vUv * 9.0 + vData.w * 50.0)) * step(0.01, vData.z);
  col = mix(col, vec3(0.16, 0.1, 0.05), spot * 0.8);
  float side = abs(fract((u - abs(a) * 0.9) * 8.0) - 0.5);
  float vein = max(1.0 - smoothstep(0.0, 0.02, abs(a)), (1.0 - smoothstep(0.02, 0.06, side)) * 0.6);
  col *= 1.0 + 0.18 * vein * stalk;
  col *= 0.88 + 0.2 * n21(vUv * vec2(30.0, 20.0) + vData.w * 10.0);
  thin = 0.7;
  #endif
  #ifdef SORREL
  if (vPart < 0.5) {
    if (abs(a) > 0.32) discard;
    col = mix(vec3(0.42, 0.28, 0.2), vec3(0.42, 0.6, 0.26), t);
    thin = 0.5;
  } else {
    // a leaflet: a heart, narrow at the stem, two round lobes at the tip with a notch between
    float w = 0.5 * pow(sin(1.5708 * min(t * 1.05, 1.0)), 0.75);
    float notch = 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.22, abs(a)));
    float lobe = 1.0 - 0.14 * pow(abs(a) / 0.5, 2.0);
    if (abs(a) > w || t > notch * lobe) discard;
    col = mix(vec3(0.26, 0.5, 0.12), vec3(0.36, 0.58, 0.16), vData.z);
    col = mix(col, col * vec3(0.9, 0.7, 0.8), step(0.92, vData.w) * 0.6);
    col *= 1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.03, abs(a)));
    col *= 1.0 - 0.18 * smoothstep(0.7, 1.0, abs(a) / max(w, 1e-3));
    thin = 1.0; wet = 0.4;
  }
  #endif
  #ifdef GRASS
  // dissolve out gently at medium distance so tufts never pop at the cell edge
  {
    float d = distance(cameraPosition, vWorldPos);
    float fk = 1.0 - smoothstep(uFar - 1.4, uFar - 0.1, d);
    float fh = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (fh > fk) discard;
  }
  // deep woodland green at the base turning olive, straw-gold or autumn russet toward the tip
  vec3 gBase = vec3(0.04, 0.13, 0.02);
  vec3 gMid = mix(vec3(0.12, 0.26, 0.05), vec3(0.32, 0.27, 0.08), vData.y);
  vec3 gTip = mix(vec3(0.42, 0.36, 0.11), vec3(0.44, 0.20, 0.06), vData.z);
  col = mix(gBase, gMid, smoothstep(0.0, 0.55, t));
  col = mix(col, gTip, smoothstep(0.45, 0.98, t) * (0.35 + 0.65 * vData.y));
  col *= 0.85 + 0.22 * (1.0 - smoothstep(0.0, 0.18, abs(a))); // bright central rib
  thin = 0.65; wet = 0.22;
  #endif
  #ifdef FLOWER
  {
    float d = distance(cameraPosition, vWorldPos);
    float fk = 1.0 - smoothstep(uFar - 1.4, uFar - 0.1, d);
    float fh = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    if (fh > fk) discard;
  }
  if (vPart < 0.5) {
    if (abs(a) > 0.34) discard;
    col = mix(vec3(0.18, 0.26, 0.09), vec3(0.28, 0.44, 0.14), t);
    thin = 0.4;
  } else {
    float r = length(vUv);
    float ang = atan(vUv.y, vUv.x);
    float sp = vData.y;
    float petals = sp < 0.44 ? 6.0 : sp < 0.70 ? 5.0 : sp < 0.87 ? 4.0 : 5.0;
    float wave = 0.5 + 0.5 * cos(ang * petals);
    float edge = sp < 0.44 ? (0.14 + 0.36 * pow(wave, 0.72)) : (0.17 + 0.33 * pow(wave, 0.52));
    if (r > edge) discard;
    vec3 pCol, cCol;
    if (sp < 0.44) {
      // starflower / wood anemone: crisp cream-white petals, warm golden-yellow stamens
      pCol = mix(vec3(0.86, 0.84, 0.76), vec3(0.96, 0.94, 0.90), smoothstep(0.12, 0.42, r));
      pCol *= mix(vec3(1.0), vec3(1.0, 0.93, 0.95), vData.z * 0.4);
      cCol = vec3(0.88, 0.64, 0.10);
    } else if (sp < 0.70) {
      // wood violet / harebell: dusky periwinkle-violet with pale throat & gold eye
      pCol = mix(vec3(0.45, 0.48, 0.82), vec3(0.24, 0.26, 0.64), smoothstep(0.14, 0.45, r));
      pCol = mix(pCol, vec3(0.38, 0.24, 0.56), vData.z * 0.45);
      cCol = vec3(0.85, 0.72, 0.22);
    } else if (sp < 0.87) {
      // tormentil: warm butter-yellow woodland star
      pCol = mix(vec3(0.92, 0.62, 0.06), vec3(0.98, 0.82, 0.16), smoothstep(0.1, 0.42, r));
      cCol = vec3(0.68, 0.34, 0.04);
    } else {
      // twinflower: soft pale rose-blush
      pCol = mix(vec3(0.82, 0.48, 0.54), vec3(0.94, 0.78, 0.82), smoothstep(0.12, 0.44, r));
      cCol = vec3(0.92, 0.74, 0.26);
    }
    // subtle petal shading toward center & delicate crease along each petal's rib
    col = mix(cCol, pCol * (0.88 + 0.16 * wave), smoothstep(0.08, 0.15, r));
    thin = 0.9; wet = 0.2;
  }
  #endif
  #ifdef CUP
  // a pixie cup: grey-green, granular, the rim scalloped and paler; red-tipped ones carry scarlet on the rim
  float up = vLocal.y;
  col = mix(vec3(0.4, 0.48, 0.34), vec3(0.56, 0.62, 0.48), up);
  col *= 0.8 + 0.35 * n3(vWorldPos * 2200.0);
  float rim = smoothstep(0.9, 0.97, up);
  col = mix(col, vec3(0.8, 0.82, 0.72), rim * 0.4);
  col = mix(col, vec3(0.75, 0.08, 0.05), rim * vData.x * smoothstep(0.4, 0.6, n3(vWorldPos * 900.0)));
  col *= mix(0.6, 1.0, smoothstep(0.0, 0.35, up)); // in the moss, darker
  thin = 0.3;
  #endif
  #ifdef CUSHION
  // reindeer lichen: a pale grey-green tangle of fine branches, dark gaps between, the tips paler
  float br = n3(vWorldPos * 700.0) * 0.6 + n3(vWorldPos * 1600.0) * 0.4;
  col = mix(vec3(0.5, 0.53, 0.45), vec3(0.7, 0.72, 0.64), smoothstep(0.35, 0.75, br)); // (paler, they shone out like stones)
  col *= mix(0.45, 1.0, smoothstep(0.25, 0.5, br));
  col *= mix(0.55, 1.0, smoothstep(-0.1, 0.25, vLocal.y)); // shaded underneath
  N = normalize(N + (vec3(n3(vWorldPos * 900.0), n3(vWorldPos * 900.0 + 7.0), n3(vWorldPos * 900.0 + 13.0)) - 0.5) * 0.9);
  thin = 0.35;
  #endif
  #ifdef STONE
  // a stone: grey granite, flecked; pale crust lichen in patches; moss on the top
  col = vec3(0.46, 0.45, 0.42) * (0.75 + 0.4 * n3(vWorldPos * 60.0));
  col *= 0.85 + 0.3 * step(0.7, n3(vWorldPos * 900.0));
  col = mix(col, vec3(0.62, 0.64, 0.56), smoothstep(0.6, 0.66, n3(vWorldPos * 40.0 + vData.x * 10.0)) * 0.8);
  // moss over the top and creeping down the sides, ragged at its edge: a velvet of tiny shoots, lit gold at the tips
  float top = smoothstep(-0.25, 0.35, N.y + 0.35 * (n3(vWorldPos * 30.0 + 3.0) - 0.5) + 0.25 * (n3(vWorldPos * 120.0) - 0.5));
  float shoots = n3(vWorldPos * 1500.0) * 0.6 + n3(vWorldPos * 3500.0) * 0.4;
  vec3 moss = mix(vec3(0.1, 0.18, 0.04), vec3(0.3, 0.42, 0.1), shoots) * (0.8 + 0.4 * n3(vWorldPos * 40.0));
  moss = mix(moss, vec3(0.55, 0.5, 0.15), smoothstep(0.75, 0.95, shoots) * 0.5);
  col = mix(col, moss, top);
  N = normalize(N + (vec3(n3(vWorldPos * 300.0), n3(vWorldPos * 300.0 + 5.0), n3(vWorldPos * 300.0 + 9.0)) - 0.5) * mix(0.5, 1.2, top));
  thin = 0.25 * top;
  wet = 0.3;
  #endif
  #if defined(STONE) || defined(CUSHION)
  // the foot: lying in wet ground it is dark, soil and algae stain it up from the moss, unevenly; only the top
  // dries pale (all pale they stood out of the moss as if dropped on it)
  float dry = smoothstep(-0.1, 0.32, vLocal.y + 0.12 * (n3(vWorldPos * 35.0) - 0.5));
  col = mix(col * vec3(0.32, 0.3, 0.24) + vec3(0.012, 0.016, 0.006), col, dry);
  wet += (1.0 - dry) * 0.4;
  #endif
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uLightDir);
  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out
  float shadow = clamp((shadowAt(vWorldPos, N) - uShadowFloor) / max(1.0 - uShadowFloor, 1e-3), 0.0, 1.0);
  float diff = max(dot(N, L), 0.0);
  float thru = pow(max(dot(-V, L), 0.0), 2.0) * thin;
  vec3 c = col * (mix(0.1, 0.26, shadow) * skyTint(N, 1.0) + 1.3 * diff * shadow)
         + col * vec3(1.5, 1.2, 0.55) * thru * max(shadow, 0.25) * 1.2
         + vec3(1.0, 0.9, 0.75) * pow(max(dot(reflect(-L, N), V), 0.0), 40.0) * wet * shadow;
  c += rimLight(N, V) * col * 1.5 * mix(0.3, 1.0, shadow); // (shadow is 0..1 here)
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
