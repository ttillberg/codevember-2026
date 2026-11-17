// An endless moss carpet, built in square chunks around the walker. Every field (height, coverage, species,
// pillows) is a function of the world position, so neighbouring chunks agree at their edges and a chunk
// rebuilt later comes back the same. Near chunks are fine and carry fronds; far ones are coarse shells only;
// chunks behind are thrown away.
import * as THREE from 'three';
import { fbm3 } from './noise';
import { deadAt, pillowAt } from './rock';
import { buildFronds, type Fronds } from './fronds';
import { buildDew } from './dew';
import { mulberry32 } from './noise';

export const SPECIES = 5; // feather, star, lichen, cushion, coral
export const CHUNK = 1.0; // world units per chunk side

export function groundHeight(x: number, z: number) {
  // broad swells plus hummocks: moss carpets are never flat
  return fbm3(x * 0.6, 0, z * 0.6, 3, 11) * 0.12 + fbm3(x * 2.2, 1, z * 2.2, 3, 12) * 0.045;
}

const ss = THREE.MathUtils.smoothstep;

/** Moss age at a point (0 = bare humus): a carpet with holes, thicker on the hummocks. */
export function mossAt(x: number, y: number, z: number) {
  const holes = fbm3(x * 1.3, 0, z * 1.3, 3, 21) + 1.6 * (y - 0.02);
  const cover = ss(holes, -0.5, -0.36);
  if (cover < 0.04) return 0;
  return cover * (0.78 + 0.22 * (fbm3(x * 4, y * 4, z * 4, 2, 24) * 0.5 + 0.5));
}

// level of detail by distance from the walker: grid step and fronds
interface Lod { step: number; fronds: number }
export function makeLods(coarse: boolean): Lod[] {
  return [
    { step: coarse ? 0.024 : 0.016, fronds: coarse ? 5000 : 13000 },
    { step: 0.03, fronds: coarse ? 1200 : 3000 },
    { step: 0.06, fronds: 0 },
  ];
}
// distance (to the chunk's nearest point) up to which each level is used; past the last, dropped. Phones see less.
const LOD_RANGES = { fine: [2.0, 3.4, 6.0], coarse: [1.5, 2.6, 4.5] };
const LOD_HOLD = 0.35; // a chunk keeps its level this far past a boundary: no flip-flop as you turn

export interface Chunk {
  key: string;
  cx: number;
  cz: number;
  lod: number;
  group: THREE.Group;
  geo: THREE.BufferGeometry;
  fronds: Fronds | null;
  dispose(): void;
}

/** One chunk's surface: a grid with every per-vertex field the shell shader reads. */
function chunkGeometry(cx: number, cz: number, step: number) {
  const n = Math.round(CHUNK / step);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const count = (n + 1) * (n + 1);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const mnor = new Float32Array(count * 3);
  const surf = new Float32Array(count * 3);
  const fields = new Float32Array(count * 4);
  const moss = new Float32Array(count);
  const species = new Float32Array(count * SPECIES);
  const w = new Float32Array(SPECIES);
  // heights once, on the grid plus a border wide enough for the moss normal's stencil, so normals are
  // differences of numbers already there instead of eight more noise lookups per vertex
  const B = Math.max(1, Math.round(0.08 / step)); // the moss grows along a smoother normal, over ±0.08
  const G = n + 1 + 2 * B;
  const hgt = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let k = 0; k < G; k++) hgt[j * G + k] = groundHeight(x0 + (k - B) * step, z0 + (j - B) * step);
  const H = (k: number, j: number) => hgt[(j + B) * G + (k + B)];
  const setN = (arr: Float32Array, i: number, k: number, j: number, e: number) => {
    const dx = (H(k + e, j) - H(k - e, j)) / (2 * e * step), dz = (H(k, j + e) - H(k, j - e)) / (2 * e * step);
    const l = Math.hypot(dx, 1, dz);
    arr[i * 3] = -dx / l; arr[i * 3 + 1] = 1 / l; arr[i * 3 + 2] = -dz / l;
  };
  for (let j = 0, i = 0; j <= n; j++) for (let k = 0; k <= n; k++, i++) {
    const x = x0 + k * step, z = z0 + j * step;
    const y = H(k, j);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    setN(nor, i, k, j, 1);
    setN(mnor, i, k, j, B);
    surf[i * 3 + 1] = x; surf[i * 3 + 2] = z;
    // no pincushion on the ground, so its clump field is not needed: 1 everywhere
    fields[i * 4] = deadAt(x, y, z); fields[i * 4 + 1] = pillowAt(x, y, z); fields[i * 4 + 2] = 1;
    const m = mossAt(x, y, z);
    moss[i] = m;
    // species, from fields: glittering wood-moss is the carpet; pincushion domes in their own patches,
    // haircap in damp clumps, a little green reindeer moss
    const f = (s: number, kk: number) => fbm3(x * kk, y * kk, z * kk, 3, s);
    w[0] = 1.0;
    w[1] = 1.4 * ss(f(31, 1.4), 0.05, 0.3);
    w[2] = 0; // reindeer lichen: on stones and dry logs, not in a damp carpet
    w[3] = 0; // pincushion: only on boulder crowns; in big ground patches its bare shells read as flat facets
    w[4] = 0.6 * ss(f(34, 2.0), 0.15, 0.35);
    let sum = 0;
    for (let c = 0; c < SPECIES; c++) { w[c] = w[c] ** 3; sum += w[c]; }
    for (let c = 0; c < SPECIES; c++) species[i * SPECIES + c] = w[c] / sum;
  }
  const idx = new Uint32Array(n * n * 6);
  for (let j = 0, t = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const a = j * (n + 1) + k, b = a + 1, c = a + n + 1, d = c + 1;
    idx.set([a, c, b, b, c, d], t);
    t += 6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('mossNormal', new THREE.BufferAttribute(mnor, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(surf, 3));
  geo.setAttribute('fields', new THREE.BufferAttribute(fields, 4));
  geo.setAttribute('moss', new THREE.BufferAttribute(moss, 1));
  const ib = new THREE.InterleavedBuffer(species, SPECIES);
  geo.setAttribute('speciesW', new THREE.InterleavedBufferAttribute(ib, 4, 0));
  geo.setAttribute('speciesW2', new THREE.InterleavedBufferAttribute(ib, 1, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // radius: half the diagonal, plus the swells, the moss and the fronds standing on it
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2), CHUNK * 0.71 + 0.3);
  return { geo, moss, species, count };
}

export interface WorldHooks {
  shellMat: THREE.ShaderMaterial;
  shells: number;
  setupFronds(m: THREE.ShaderMaterial): void; // shared uniforms and moss size
  dewMaterial: THREE.Material;
}

/**
 * Grow moss on a surface: the shells, and fronds where there is moss.
 * The geometry needs the shell attributes (see chunkGeometry); moss and species are per vertex.
 */
export function dressSurface(
  hooks: WorldHooks, geo: THREE.BufferGeometry, moss: Float32Array, species: Float32Array, count: number,
  frondCount: number, seed: number,
) {
  const group = new THREE.Group();
  const shells = new THREE.InstancedMesh(geo, hooks.shellMat, hooks.shells);
  // culled by the chunk's bounding sphere, padded for what the vertex shaders push out
  shells.boundingSphere = geo.boundingSphere ? geo.boundingSphere.clone() : null;
  group.add(shells);
  let fronds: Fronds | null = null;
  const disposables: { dispose(): void }[] = [geo, shells]; // the shells' instance buffer too
  if (frondCount > 0) {
    const weight = new Float32Array(count);
    for (let i = 0; i < count; i++) weight[i] = ss(moss[i], 0.05, 0.4);
    fronds = buildFronds(geo, weight, frondCount, seed, { dome: false, straws: false });
    const mat = fronds.mesh.material as THREE.ShaderMaterial;
    hooks.setupFronds(mat);
    const tex = fronds.ageTexture.image.data as Float32Array;
    const ptex = fronds.puffTexture.image.data as Float32Array;
    const pillow = geo.attributes.fields as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      tex[i * 4] = moss[i];
      tex[i * 4 + 1] = species[i * SPECIES];
      tex[i * 4 + 2] = species[i * SPECIES + 1];
      tex[i * 4 + 3] = species[i * SPECIES + 2];
      ptex[i * 4 + 1] = pillow.getY(i);
      ptex[i * 4 + 2] = species[i * SPECIES + 3];
    }
    fronds.ageTexture.needsUpdate = true;
    fronds.puffTexture.needsUpdate = true;
    fronds.mesh.userData.fronds = true;
    fronds.mesh.geometry.boundingSphere = geo.boundingSphere!.clone();
    fronds.mesh.frustumCulled = true;
    group.add(fronds.mesh);
    disposables.push(fronds.mesh.geometry, mat, fronds.ageTexture, fronds.puffTexture);
  }
  return { group, fronds, disposables };
}

export class World {
  readonly root = new THREE.Group();
  chunks = new Map<string, Chunk>();
  changed = false; // set when chunks came or went: the shadow map is stale
  private lods: Lod[];
  private range: number[];
  constructor(private hooks: WorldHooks, private coarse: boolean) {
    this.lods = makeLods(coarse);
    this.range = coarse ? LOD_RANGES.coarse : LOD_RANGES.fine;
  }

  private build(cx: number, cz: number, lod: number): Chunk {
    const L = this.lods[lod];
    const { geo, moss, species, count } = chunkGeometry(cx, cz, L.step);
    const seed = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
    const { group, fronds, disposables } = dressSurface(this.hooks, geo, moss, species, count, L.fronds, seed);
    if (lod === 0) {
      // dew in the moss: drops caught at the frond tips, thickest on the full, mature carpet
      const r = mulberry32(seed + 9);
      const drops: number[] = [];
      for (let k = 0; k < (this.coarse ? 500 : 1400); k++) {
        const x = cx * CHUNK + r() * CHUNK, z = cz * CHUNK + r() * CHUNK;
        const y = groundHeight(x, z), m = mossAt(x, y, z);
        if (m < 0.35 || r() > m) continue;
        drops.push(x, y + 0.055 * m * (0.75 + 0.45 * r()) + 0.008, z, 0.0022 + 0.0045 * Math.pow(r(), 2));
      }
      if (drops.length) {
        const dew = buildDew(drops, this.hooks.dewMaterial);
        dew.geometry.boundingSphere = geo.boundingSphere!.clone();
        dew.frustumCulled = true;
        group.add(dew);
        disposables.push(dew.geometry);
      }
    }
    return {
      key: `${cx},${cz}`, cx, cz, lod, group, geo, fronds,
      dispose() { for (const d of disposables) d.dispose(); },
    };
  }

  /**
   * Keep the chunks around the walker: build what is missing, swap the level of detail where it changed,
   * drop what is out of range. At most `budget` builds per call, nearest and in front first, so a step
   * across a chunk border never stalls a frame for long.
   */
  update(px: number, pz: number, fx: number, fz: number, budget = 2) {
    const want: { cx: number; cz: number; lod: number; prio: number }[] = [];
    const LOD_RANGE = this.range;
    const R = LOD_RANGE[LOD_RANGE.length - 1];
    const c0x = Math.floor(px / CHUNK), c0z = Math.floor(pz / CHUNK);
    const r = Math.ceil(R / CHUNK) + 1;
    const keep = new Set<string>();
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const cx = c0x + dx, cz = c0z + dz;
      // distance to the chunk's nearest point, not its centre: the one you stand in is always near
      const nx = THREE.MathUtils.clamp(px, cx * CHUNK, cx * CHUNK + CHUNK), nz = THREE.MathUtils.clamp(pz, cz * CHUNK, cz * CHUNK + CHUNK);
      const d = Math.hypot(nx - px, nz - pz);
      // behind the walker the range is short: nothing back there is seen for long
      const ahead = ((cx + 0.5) * CHUNK - px) * fx + ((cz + 0.5) * CHUNK - pz) * fz;
      const range = ahead < -1.2 ? 1.5 : R;
      const key = `${cx},${cz}`;
      const have = this.chunks.get(key);
      if (d > range + (have ? LOD_HOLD : 0)) continue;
      const lod = LOD_RANGE.findIndex((m) => d <= m);
      keep.add(key);
      if (have && (have.lod === lod || (lod >= 0 && Math.abs(d - LOD_RANGE[Math.min(have.lod, lod)]) < LOD_HOLD))) continue;
      if (lod < 0) continue;
      want.push({ cx, cz, lod, prio: d - Math.max(0, ahead) * 0.5 });
    }
    for (const [key, ch] of this.chunks) {
      if (keep.has(key)) continue;
      this.root.remove(ch.group);
      ch.dispose();
      this.chunks.delete(key);
      this.changed = true;
    }
    want.sort((a, b) => a.prio - b.prio);
    for (const w of want.slice(0, budget)) {
      const key = `${w.cx},${w.cz}`;
      const old = this.chunks.get(key);
      const ch = this.build(w.cx, w.cz, w.lod);
      if (old) { this.root.remove(old.group); old.dispose(); }
      this.chunks.set(key, ch);
      this.root.add(ch.group);
      this.changed = true;
    }
    return want.length; // still to build
  }

  /**
   * Set up for the shadow pass (or back): the fronds and dew go, and so does every chunk farther than `reach`
   * from the shadow map's centre, which it would only draw outside its own box.
   */
  forShadow(on: boolean, cx = 0, cz = 0, reach = 0) {
    for (const ch of this.chunks.values()) {
      for (const o of ch.group.children) if (o.userData.fronds) o.visible = !on;
      ch.group.visible = !on || Math.hypot((ch.cx + 0.5) * CHUNK - cx, (ch.cz + 0.5) * CHUNK - cz) < reach;
    }
  }
}
