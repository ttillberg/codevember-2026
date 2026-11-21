// Boulders, after the splash: if there are little stones in the moss there should be big ones too. Day 05's
// boulder (rock.ts: a convex hull of points on a squashed sphere, subdivided, its edges rounded), grown over with
// the same moss as the ground (world.ts's dressSurface: the shells, and fronds near you): moss over the top and
// down the sides, pincushion domes on the crown, the grey stone showing on the steep and the under sides.
//
// A few templates are built once (the hull, the subdivision and the baked cavity are the slow part); each boulder
// placed is one of them turned, scaled and set half sunk in the ground, its moss fields worked out where it stands.
// By hash on a coarse grid out to RANGE, one a frame; fronds only on the near ones (added as you come close).
import * as THREE from 'three';
import { buildRock, deadAt, pillowAt, domeAt, type Surface } from './rock';
import { fbm3, mulberry32 } from './noise';
import { groundHeight, dressSurface, shellsForShadow, trunkInCell, clearing, SPECIES, TREE_CELL, type WorldHooks } from './world';
import { oakInCell, OAK_CELL } from './oak';

const coarse = matchMedia('(pointer: coarse)').matches;
const CELL = 7;
const RANGE = coarse ? 10 : 15;
const DROP = RANGE + 3;
const FROND_NEAR = coarse ? 3.5 : 5.5; // fronds on the ones this near
const FROND_DENSITY = coarse ? 1500 : 3500; // per square metre of moss
const ss = THREE.MathUtils.smoothstep;

interface Boulder {
  key: string; x: number; z: number; r: number; seed: number;
  group: THREE.Group; disposables: { dispose(): void }[]; fronds: boolean;
}

export class Boulders {
  readonly root = new THREE.Group();
  private templates: Surface[];
  private list = new Map<string, Boulder | null>();
  changed = false;

  constructor(private hooks: WorldHooks) {
    this.templates = [11, 23, 37, 51].map((s) => buildRock(s, coarse ? 2 : 3, 1));
  }

  /** One boulder in a grid cell, or none: away from the start and from trunks, more of them in the open. */
  private spot(ix: number, iz: number) {
    const r = mulberry32((Math.imul(ix, 0x6b43a9b5) ^ Math.imul(iz, 0x2545f491) ^ 0xb01d) >>> 0);
    const x = (ix + 0.2 + 0.6 * r()) * CELL, z = (iz + 0.2 + 0.6 * r()) * CELL;
    if (r() > 0.35 + 0.3 * clearing(x, z)) return null;
    // boulders, not stones: a metre and a half to three across, now and then a big one of four or more
    const size = 0.55 + 0.6 * r() * r() + (r() < 0.15 ? 0.6 : 0);
    if (Math.hypot(x, z) < 3 + size) return null;
    const tix = Math.floor(x / TREE_CELL), tiz = Math.floor(z / TREE_CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const t = trunkInCell(tix + dx, tiz + dz);
      if (t && Math.hypot(t.x - x, t.z - z) < t.r * 1.6 + size * 1.4) return null;
    }
    // nor in an oak's foot
    const oix = Math.floor(x / OAK_CELL), oiz = Math.floor(z / OAK_CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const o = oakInCell(oix + dx, oiz + dz);
      if (o && Math.hypot(o.x - x, o.z - z) < 2.0 + size * 1.4) return null;
    }
    return { x, z, size, seed: Math.floor(r() * 1e9) };
  }

  private build(key: string, s: { x: number; z: number; size: number; seed: number }, fronds: boolean): Boulder {
    const r = mulberry32(s.seed);
    const T = this.templates[Math.floor(r() * this.templates.length)];
    const src = T.geometry;
    const n = src.attributes.position.count;
    const yaw = r() * Math.PI * 2, sy = 0.75 + 0.35 * r(), sk = 0.9 + 0.2 * r();
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    // set in the ground: its flat bottom (at -0.62) a fifth of its height under the moss
    const y0 = groundHeight(s.x, s.z) + 0.62 * s.size * sy - 0.22 * s.size * sy;
    const P = src.attributes.position.array as Float32Array, N = src.attributes.normal.array as Float32Array;
    const MN = src.attributes.mossNormal.array as Float32Array, cav = src.attributes.cavity.array as Float32Array;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), mnor = new Float32Array(n * 3);
    const surf = new Float32Array(n * 3), fields = new Float32Array(n * 4), moss = new Float32Array(n);
    const species = new Float32Array(n * SPECIES), w = new Float32Array(SPECIES);
    // fronds only in the thick of the moss and facing up: at its thin edge, down a steep side, they hung like a
    // dark curtain of hair
    const frondW = new Float32Array(n);
    const rot = (a: Float32Array, o: Float32Array, i: number) => {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      o[i * 3] = c * x + sn * z; o[i * 3 + 1] = y; o[i * 3 + 2] = -sn * x + c * z;
    };
    let mossArea = 0;
    for (let i = 0; i < n; i++) {
      const lx = P[i * 3] * s.size * sk, ly = P[i * 3 + 1] * s.size * sy, lz = P[i * 3 + 2] * s.size;
      const x = s.x + c * lx + sn * lz, y = y0 + ly, z = s.z - sn * lx + c * lz;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      rot(N, nor, i); rot(MN, mnor, i);
      const ny = nor[i * 3 + 1];
      surf[i * 3] = 2; surf[i * 3 + 1] = x + 0.4 * y; surf[i * 3 + 2] = z - 0.4 * y;
      fields[i * 4] = deadAt(x, y, z); fields[i * 4 + 1] = pillowAt(x, y, z); fields[i * 4 + 2] = domeAt(x, y, z); fields[i * 4 + 3] = cav[i];
      // moss over the top and down the sides, thinning to bare stone on the steep and under sides, in patches
      const patch = fbm3(x * 2.4, y * 2.4, z * 2.4, 3, s.seed % 97) * 0.5 + 0.5;
      const m = ss(ny, -0.25, 0.45) * ss(patch, 0.18, 0.42);
      moss[i] = m;
      frondW[i] = ss(m, 0.55, 0.85) * ss(ny, 0.05, 0.45);
      if (m > 0.3) mossArea += T.area[i] * s.size * s.size;
      // species: the wood moss's carpet, pincushion domes on the crown, a little reindeer lichen and haircap
      const f = (k: number, seed: number) => fbm3(x * k, y * k, z * k, 2, seed);
      w[0] = 1.0;
      w[1] = 0.8 * ss(f(1.6, 61), 0.05, 0.3);
      w[2] = 0.5 * ss(f(2.2, 62), 0.15, 0.35) * ss(ny, 0.3, 0.8);
      w[3] = 1.5 * ss(ny, 0.55, 0.9) * ss(f(1.8, 63), -0.1, 0.25);
      w[4] = 0.4 * ss(f(2.0, 64), 0.2, 0.35);
      let sum = 0;
      for (let k = 0; k < SPECIES; k++) { w[k] = w[k] ** 3; sum += w[k]; }
      for (let k = 0; k < SPECIES; k++) species[i * SPECIES + k] = w[k] / sum;
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
    geo.setIndex(src.index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(s.x, y0, s.z), s.size * 1.5 + 0.2);
    const count = fronds ? Math.min(30000, Math.round(mossArea * FROND_DENSITY)) : 0;
    const d = dressSurface(this.hooks, geo, moss, species, n, count, s.seed, frondW);
    this.root.add(d.group);
    return { key, x: s.x, z: s.z, r: s.size * 1.25, seed: s.seed, group: d.group, disposables: d.disposables, fronds };
  }

  private drop(b: Boulder) {
    this.root.remove(b.group);
    for (const d of b.disposables) d.dispose();
  }

  /** Place one coming into range (or give a near one its fronds), take away the ones gone out. */
  update(px: number, pz: number) {
    const i0 = Math.floor(px / CELL), k0 = Math.floor(pz / CELL);
    const R = Math.ceil(RANGE / CELL);
    let done = false;
    for (let dz = -R; dz <= R && !done; dz++) for (let dx = -R; dx <= R && !done; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      const key = `${ix},${iz}`;
      const have = this.list.get(key);
      if (have === null) continue;
      if (have) {
        // coming near: built again with its fronds
        if (!have.fronds && Math.hypot(have.x - px, have.z - pz) < FROND_NEAR) {
          const s = { x: have.x, z: have.z, size: have.r / 1.25, seed: have.seed };
          this.drop(have);
          this.list.set(key, this.build(key, s, true));
          this.changed = done = true;
        }
        continue;
      }
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) > RANGE + CELL * 0.5) continue;
      const s = this.spot(ix, iz);
      this.list.set(key, s ? this.build(key, s, Math.hypot(s.x - px, s.z - pz) < FROND_NEAR) : null);
      if (s) this.changed = done = true;
    }
    for (const [key, b] of this.list) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) < DROP + CELL * 0.5) continue;
      if (b) { this.drop(b); this.changed = true; }
      this.list.delete(key);
    }
    return done;
  }

  /** Boulders are solid: the pushed-out position. */
  collide(x: number, z: number, pad: number) {
    for (const b of this.list.values()) {
      if (!b) continue;
      const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), min = b.r + pad;
      if (d < min && d > 1e-6) { x = b.x + (dx / d) * min; z = b.z + (dz / d) * min; }
    }
    return [x, z];
  }

  /** For the shadow map: the stone and its shells, not the fronds. */
  forShadow(on: boolean) {
    for (const b of this.list.values()) if (b) { for (const o of b.group.children) if (o.userData.fronds) o.visible = !on; shellsForShadow(b.group, on); }
  }
}
