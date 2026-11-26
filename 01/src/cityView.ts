import * as THREE from 'three';
import {
  ARCHITECTURAL_PAPER_PALETTE,
  buildHouseNet,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiHouseRig,
  type OrigamiMaterials,
} from './origamiPaperMesh';
import {
  CITY_CHUNK_SIZE,
  createCoastalWorld,
  type CityBoat,
  type CityBuildingPlot,
  type CityChunkData,
  type CityPier,
  type CityStreetStyle,
  type CityTerrainField,
  type CityTree,
  type CityWingMassing,
  type CoastalWorld,
  type CoastalWorldOptions,
} from './cityGenerator';

export type CityWaveMode = 'wave' | 'folded' | 'flat';

const BACKDROP = '#f5f4f0';
const SUN_DIR_WHITE = new THREE.Vector3(24, 42, 19).normalize();
const SUN_DIR_COLOR = new THREE.Vector3(16, 46, 14).normalize();

const MAX_LOD_PLOTS_PER_CHUNK = 28;
const TIER0_ENTER = 112;
const TIER0_EXIT = 124;
const TIER1_ENTER = 198;
const TIER1_EXIT = 212;
const CHUNK_LOAD_RADIUS = 325;
const CHUNK_UNLOAD_RADIUS = 360;
const LOD0_ENTER_DIST = 92;
const LOD0_EXIT_DIST = 102;
const WAVE_NEAR = 14.0;
const WAVE_FAR = 92.0;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Exact CPU mirror of the GPU LOD1/LOD2 fold-wave shader formula! */
export function evaluateFoldWave(
  bx: number,
  bz: number,
  foldJitter: number,
  focusX: number,
  focusZ: number,
  waveMode: CityWaveMode,
): number {
  if (waveMode === 'folded') return 1;
  if (waveMode === 'flat') return 0;
  const dFwd = focusZ - bz;
  const dLat = Math.abs(bx - focusX);
  const wMetric = dFwd + 0.24 * dLat + foldJitter;
  return 1 - smoothstep(WAVE_NEAR, WAVE_FAR, wMetric);
}

// ---------------------------------------------------------------------------
// Fast Procedural Geometry Builders (Terrain Skirts, Merged Trees, LOD Massing)
// ---------------------------------------------------------------------------

/** Build a chunk terrain mesh with exact analytical normals & downward border skirts (ZERO LOD cracks!). */
function buildChunkTerrainGeometry(
  terrain: CityTerrainField,
  cx: number,
  cz: number,
  segs: number,
): THREE.BufferGeometry {
  const x0 = cx * CITY_CHUNK_SIZE;
  const z0 = cz * CITY_CHUNK_SIZE;
  const stride = segs + 1;
  const step = CITY_CHUNK_SIZE / segs;
  const eps = 0.45;

  const topCount = stride * stride;
  const skirtVerts = stride * 4;
  const totalVerts = topCount + skirtVerts;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);

  const evalNormal = (x: number, z: number): [number, number, number] => {
    const hL = terrain.heightAt(x - eps, z);
    const hR = terrain.heightAt(x + eps, z);
    const hD = terrain.heightAt(x, z - eps);
    const hU = terrain.heightAt(x, z + eps);
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };

  for (let j = 0; j <= segs; j++) {
    const z = z0 + j * step;
    for (let i = 0; i <= segs; i++) {
      const x = x0 + i * step;
      const y = terrain.heightAt(x, z);
      const idx = (j * stride + i) * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      const [nx, ny, nz] = evalNormal(x, z);
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Downward border skirts along all 4 chunk edges so Tier 0/1/2 neighbors NEVER reveal a hairline seam!
  const skirtDrop = 1.65;
  let sCursor = topCount;
  const addSkirtEdge = (topIndices: number[], flip: boolean) => {
    const baseS = sCursor;
    for (let k = 0; k < topIndices.length; k++) {
      const ti = topIndices[k] * 3;
      const si = sCursor * 3;
      positions[si] = positions[ti];
      positions[si + 1] = positions[ti + 1] - skirtDrop;
      positions[si + 2] = positions[ti + 2];
      normals[si] = normals[ti];
      normals[si + 1] = normals[ti + 1];
      normals[si + 2] = normals[ti + 2];
      sCursor++;
    }
    for (let k = 0; k < topIndices.length - 1; k++) {
      const t0 = topIndices[k];
      const t1 = topIndices[k + 1];
      const b0 = baseS + k;
      const b1 = baseS + k + 1;
      if (flip) {
        indices.push(t0, t1, b0, t1, b1, b0);
      } else {
        indices.push(t0, b0, t1, t1, b0, b1);
      }
    }
  };

  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let k = 0; k <= segs; k++) {
    north.push(k);
    south.push(segs * stride + k);
    west.push(k * stride);
    east.push(k * stride + segs);
  }
  addSkirtEdge(north, false);
  addSkirtEdge(south, true);
  addSkirtEdge(west, true);
  addSkirtEdge(east, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

/** Merge low-poly architectural massing + roof prisms + retaining plinths for ALL buildings in a chunk into ONE draw call! */
function buildChunkLodBuildingsGeometry(plots: CityBuildingPlot[], tier: 1 | 2): THREE.BufferGeometry | null {
  if (plots.length === 0) return null;

  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const origins: number[] = [];
  const metas: number[] = [];

  const tmpColor = new THREE.Color();
  const plinthColor = new THREE.Color('#ece9e1');
  const paletteLen = ARCHITECTURAL_PAPER_PALETTE.length;

  const pushTri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    rgb: THREE.Color,
    ox: number,
    oy: number,
    oz: number,
    bIdx: number,
    jitter: number,
  ) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-7) return;
    nx /= len;
    ny /= len;
    nz /= len;

    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    col.push(rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b, rgb.r, rgb.g, rgb.b);
    origins.push(ox, oy, oz, ox, oy, oz, ox, oy, oz);
    metas.push(bIdx, jitter, bIdx, jitter, bIdx, jitter);
  };

  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    rgb: THREE.Color,
    ox: number,
    oy: number,
    oz: number,
    bIdx: number,
    jitter: number,
  ) => {
    pushTri(a, b, c, rgb, ox, oy, oz, bIdx, jitter);
    pushTri(a, c, d, rgb, ox, oy, oz, bIdx, jitter);
  };

  const emitWing = (
    p: CityBuildingPlot,
    w: CityWingMassing,
    rgb: THREE.Color,
    cosY: number,
    sinY: number,
    includeRoofDetail: boolean,
  ) => {
    const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
      p.x + (w.cx + lx) * cosY + (w.cz + lz) * sinY,
      p.baseY + ly,
      p.z - (w.cx + lx) * sinY + (w.cz + lz) * cosY,
    ];
    const hw = w.W * 0.5;
    const hd = w.D * 0.5;
    const H = w.H;
    const ox = p.x;
    const oy = p.baseY;
    const oz = p.z;
    const idx = p.index;
    const jit = p.foldJitter;

    const b00 = toWorld(-hw, 0, -hd);
    const b10 = toWorld(hw, 0, -hd);
    const b11 = toWorld(hw, 0, hd);
    const b01 = toWorld(-hw, 0, hd);

    const t00 = toWorld(-hw, H, -hd);
    const t10 = toWorld(hw, H, -hd);
    const t11 = toWorld(hw, H, hd);
    const t01 = toWorld(-hw, H, hd);

    // 4 exterior walls (CCW outward)
    pushQuad(b01, b11, t11, t01, rgb, ox, oy, oz, idx, jit); // front (+Z)
    pushQuad(b11, b10, t10, t11, rgb, ox, oy, oz, idx, jit); // right (+X)
    pushQuad(b10, b00, t00, t10, rgb, ox, oy, oz, idx, jit); // back (-Z)
    pushQuad(b00, b01, t01, t00, rgb, ox, oy, oz, idx, jit); // left (-X)

    const rise = Math.max(0.45, Math.min(hw * Math.tan(Math.max(0.35, w.pitch)), H * 1.45));

    if (!includeRoofDetail && (w.roofType === 'flat' || w.roofType === 'butterfly')) {
      pushQuad(t01, t11, t10, t00, rgb, ox, oy, oz, idx, jit);
      return;
    }

    if (w.roofType === 'flat') {
      pushQuad(t01, t11, t10, t00, rgb, ox, oy, oz, idx, jit);
    } else if (w.roofType === 'spire') {
      const spireH = H + Math.max(rise * 1.35, hw * 1.9);
      const apex = toWorld(0, spireH, 0);
      pushTri(t01, t11, apex, rgb, ox, oy, oz, idx, jit);
      pushTri(t11, t10, apex, rgb, ox, oy, oz, idx, jit);
      pushTri(t10, t00, apex, rgb, ox, oy, oz, idx, jit);
      pushTri(t00, t01, apex, rgb, ox, oy, oz, idx, jit);
    } else if (w.roofType === 'mansard') {
      const r = Math.max(0.24, Math.min(0.6, w.mansardRatio || 0.36));
      const mw = hw * r;
      const md = hd * r;
      const mh = H + rise * 0.78;
      const m00 = toWorld(-mw, mh, -md);
      const m10 = toWorld(mw, mh, -md);
      const m11 = toWorld(mw, mh, md);
      const m01 = toWorld(-mw, mh, md);
      pushQuad(t01, t11, m11, m01, rgb, ox, oy, oz, idx, jit);
      pushQuad(t11, t10, m10, m11, rgb, ox, oy, oz, idx, jit);
      pushQuad(t10, t00, m00, m10, rgb, ox, oy, oz, idx, jit);
      pushQuad(t00, t01, m01, m00, rgb, ox, oy, oz, idx, jit);
      pushQuad(m01, m11, m10, m00, rgb, ox, oy, oz, idx, jit);
    } else if (w.roofType === 'hip') {
      const ridgeHalf = Math.max(0.15, hd - hw * 0.7);
      const rF = toWorld(0, H + rise * 0.92, ridgeHalf);
      const rB = toWorld(0, H + rise * 0.92, -ridgeHalf);
      pushTri(t01, t11, rF, rgb, ox, oy, oz, idx, jit);
      pushTri(t10, t00, rB, rgb, ox, oy, oz, idx, jit);
      pushQuad(t11, t10, rB, rF, rgb, ox, oy, oz, idx, jit);
      pushQuad(t00, t01, rF, rB, rgb, ox, oy, oz, idx, jit);
    } else if (w.roofType === 'shed') {
      const sh = H + rise * 0.82;
      const s00 = toWorld(-hw, sh, -hd);
      const s01 = toWorld(-hw, sh, hd);
      pushTri(t01, t11, s01, rgb, ox, oy, oz, idx, jit);
      pushTri(t10, t00, s00, rgb, ox, oy, oz, idx, jit);
      pushQuad(t00, t01, s01, s00, rgb, ox, oy, oz, idx, jit);
      pushQuad(s01, t11, t10, s00, rgb, ox, oy, oz, idx, jit);
    } else if (w.roofType === 'butterfly') {
      const bh = H + rise * 0.6;
      const bL0 = toWorld(-hw, bh, -hd);
      const bL1 = toWorld(-hw, bh, hd);
      const bR0 = toWorld(hw, bh, -hd);
      const bR1 = toWorld(hw, bh, hd);
      const vF = toWorld(0, H, hd);
      const vB = toWorld(0, H, -hd);
      pushQuad(bL1, vF, vB, bL0, rgb, ox, oy, oz, idx, jit);
      pushQuad(vF, bR1, bR0, vB, rgb, ox, oy, oz, idx, jit);
      pushTri(t01, vF, bL1, rgb, ox, oy, oz, idx, jit);
      pushTri(vF, t11, bR1, rgb, ox, oy, oz, idx, jit);
      pushTri(t10, vB, bR0, rgb, ox, oy, oz, idx, jit);
      pushTri(vB, t00, bL0, rgb, ox, oy, oz, idx, jit);
    } else {
      // Classic gable / stepped / gambrel / sawtooth pitched ridge
      const rF = toWorld(0, H + rise, hd);
      const rB = toWorld(0, H + rise, -hd);
      pushTri(t01, t11, rF, rgb, ox, oy, oz, idx, jit);
      pushTri(t10, t00, rB, rgb, ox, oy, oz, idx, jit);
      pushQuad(t11, t10, rB, rF, rgb, ox, oy, oz, idx, jit);
      pushQuad(t00, t01, rF, rB, rgb, ox, oy, oz, idx, jit);
    }
  };

  for (const p of plots) {
    const cosY = Math.cos(p.yaw);
    const sinY = Math.sin(p.yaw);

    // 1. Retaining plinth extending below lowest hillside corner
    const plinthH = Math.max(0.32, p.baseY - p.groundMinY + 0.9);
    const phw = p.footprintW * 0.5 + 0.08;
    const phd = p.footprintD * 0.5 + 0.08;
    const pw = (lx: number, ly: number, lz: number): [number, number, number] => [
      p.x + lx * cosY + lz * sinY,
      p.baseY + ly,
      p.z - lx * sinY + lz * cosY,
    ];
    const pb00 = pw(-phw, -plinthH, -phd);
    const pb10 = pw(phw, -plinthH, -phd);
    const pb11 = pw(phw, -plinthH, phd);
    const pb01 = pw(-phw, -plinthH, phd);
    const pt00 = pw(-phw, -0.005, -phd);
    const pt10 = pw(phw, -0.005, -phd);
    const pt11 = pw(phw, -0.005, phd);
    const pt01 = pw(-phw, -0.005, phd);

    pushQuad(pb01, pb11, pt11, pt01, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter);
    pushQuad(pb11, pb10, pt10, pt11, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter);
    pushQuad(pb10, pb00, pt00, pt10, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter);
    pushQuad(pb00, pb01, pt01, pt00, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter);

    // 2. Building wings (Tier 1 builds every wing with exact roof silhouette; Tier 2 builds compact silhouette!)
    if (tier === 2 && p.wings.length > 1) {
      const lead = p.wings[0];
      tmpColor.set(ARCHITECTURAL_PAPER_PALETTE[p.colorIndex % paletteLen]);
      emitWing(
        p,
        {
          ...lead,
          cx: 0,
          cz: 0,
          W: p.footprintW * 0.96,
          D: p.footprintD * 0.96,
        },
        tmpColor,
        cosY,
        sinY,
        false,
      );
    } else {
      for (const w of p.wings) {
        const slotOffsets = [0, 2, 5, 3];
        const cIdx = (p.colorIndex + slotOffsets[w.colorSlot % 4]) % paletteLen;
        tmpColor.set(ARCHITECTURAL_PAPER_PALETTE[cIdx]);
        emitWing(p, w, tmpColor, cosY, sinY, tier === 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aBuildOrigin', new THREE.Float32BufferAttribute(origins, 3));
  geo.setAttribute('aBuildMeta', new THREE.Float32BufferAttribute(metas, 2));
  geo.computeBoundingSphere();
  return geo;
}

/** Merge multiple transformed BufferGeometries into one compact geometry (zero extra draw calls!) */
function mergeSimpleGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of parts) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const idx = new Uint32Array(totalIdx);

  let vOff = 0;
  let iOff = 0;
  for (const g of parts) {
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    pos.set(pAttr.array as Float32Array, vOff * 3);
    if (nAttr) {
      norm.set(nAttr.array as Float32Array, vOff * 3);
    }
    if (g.index) {
      const arr = g.index.array;
      for (let k = 0; k < arr.length; k++) idx[iOff + k] = arr[k] + vOff;
      iOff += arr.length;
    } else {
      for (let k = 0; k < pAttr.count; k++) idx[iOff + k] = vOff + k;
      iOff += pAttr.count;
    }
    vOff += pAttr.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function buildMergedTreesGeometries(
  trees: CityTree[],
  detailed: boolean,
): { trunks: THREE.BufferGeometry | null; foliage: THREE.BufferGeometry | null } {
  if (trees.length === 0) return { trunks: null, foliage: null };

  const trunkParts: THREE.BufferGeometry[] = [];
  const foliageParts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const tr of trees) {
    t.set(tr.x, tr.y, tr.z);
    q.setFromAxisAngle(up, tr.rotY);
    s.setScalar(tr.scale);
    m.compose(t, q, s);

    if (detailed) {
      const trk = new THREE.CylinderGeometry(0.08, 0.11, 0.95, 5);
      trk.translate(0, 0.18, 0);
      trk.applyMatrix4(m);
      trunkParts.push(trk);
    }

    if (!detailed || tr.variant === 0) {
      const cone = new THREE.ConeGeometry(0.48, 2.0, detailed ? 6 : 5);
      cone.translate(0, 1.32, 0);
      cone.applyMatrix4(m);
      foliageParts.push(cone);
    } else if (tr.variant === 1) {
      const bot = new THREE.ConeGeometry(0.64, 1.15, 6);
      bot.translate(0, 0.92, 0);
      bot.applyMatrix4(m);
      const top = new THREE.ConeGeometry(0.44, 0.95, 6);
      top.translate(0, 1.56, 0);
      top.applyMatrix4(m);
      foliageParts.push(bot, top);
    } else {
      const can = new THREE.DodecahedronGeometry(0.58, 0);
      can.scale(1.0, 0.88, 1.0);
      can.translate(0, 1.06, 0);
      can.applyMatrix4(m);
      foliageParts.push(can);
    }
  }

  return {
    trunks: mergeSimpleGeometries(trunkParts),
    foliage: mergeSimpleGeometries(foliageParts),
  };
}

function buildMergedPiersGeometry(piers: CityPier[]): THREE.BufferGeometry | null {
  if (piers.length === 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const t = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const pier of piers) {
    t.set(pier.x, 0, pier.z);
    q.setFromAxisAngle(up, pier.yaw);
    m.compose(t, q, s);

    // Paper pier deck extending along local `+Z` from shore out into the sea
    const deck = new THREE.BoxGeometry(pier.width, 0.24, pier.length);
    deck.translate(0, pier.deckY, pier.length * 0.5);
    deck.applyMatrix4(m);
    parts.push(deck);

    // Minimalist architectural pier pilings dipping into the water
    const pilingSteps = Math.max(2, Math.floor(pier.length / 3.4));
    for (let k = 1; k <= pilingSteps; k++) {
      const zOff = (k / pilingSteps) * (pier.length - 0.5);
      for (const side of [-1, 1]) {
        const pile = new THREE.CylinderGeometry(0.11, 0.11, 2.2, 5);
        pile.translate(side * (pier.width * 0.42), pier.deckY - 1.1, zOff);
        pile.applyMatrix4(m);
        parts.push(pile);
      }
    }
  }
  return mergeSimpleGeometries(parts);
}

/** Build one cute reusable folded-origami paper sailboat geometry (hull + tall crisp triangular sails!) */
function createSailboatGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Faceted origami paper hull
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, 1.35);
  hullShape.lineTo(0.46, 0.2);
  hullShape.lineTo(0.36, -0.95);
  hullShape.lineTo(-0.36, -0.95);
  hullShape.lineTo(-0.46, 0.2);
  hullShape.closePath();
  const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 0.34, bevelEnabled: false });
  hull.rotateX(Math.PI * 0.5);
  hull.translate(0, 0.32, 0);
  parts.push(hull);

  // Main triangular folded origami sail
  const mainSail = new THREE.BufferGeometry();
  const mVerts = new Float32Array([
    0.02, 0.34, 0.85,
    0.02, 0.34, -0.58,
    0.02, 2.55, -0.25,
    -0.02, 0.34, -0.58,
    -0.02, 0.34, 0.85,
    -0.02, 2.55, -0.25,
  ]);
  mainSail.setAttribute('position', new THREE.BufferAttribute(mVerts, 3));
  mainSail.computeVertexNormals();
  parts.push(mainSail);

  // Secondary jib sail angled slightly for origami crispness
  const jib = new THREE.BufferGeometry();
  const jVerts = new Float32Array([
    0.04, 0.36, 1.18,
    0.04, 0.36, 0.25,
    0.04, 1.82, 0.28,
    -0.04, 0.36, 0.25,
    -0.04, 0.36, 1.18,
    -0.04, 1.82, 0.28,
  ]);
  jib.setAttribute('position', new THREE.BufferAttribute(jVerts, 3));
  jib.computeVertexNormals();
  parts.push(jib);

  return mergeSimpleGeometries(parts)!;
}

// ---------------------------------------------------------------------------
// Mounted Runtime Types
// ---------------------------------------------------------------------------

interface MountedLod0Building {
  plot: CityBuildingPlot;
  rig: OrigamiHouseRig;
  wrapper: THREE.Group;
  plinth: THREE.Mesh;
  plinthH: number;
  curFold: number;
  pickables: THREE.Object3D[];
}

interface MountedChunk {
  data: CityChunkData;
  tier: 0 | 1 | 2;
  group: THREE.Group;
  staticGroup: THREE.Group;
  staticGeos: THREE.BufferGeometry[];
  lodMesh: THREE.Mesh | null;
  lodMat: THREE.MeshStandardMaterial | null;
  lodGeo: THREE.BufferGeometry | null;
  lodActiveMask: Float32Array;
  lod0Map: Map<number, MountedLod0Building>;
  boatMeshes: Array<{ mesh: THREE.Mesh; boat: CityBoat }>;
}

export interface CityViewStats {
  active: boolean;
  seed: number;
  style: CityStreetStyle;
  hills: number;
  flying: boolean;
  waveMode: CityWaveMode;
  flightS: number;
  camPos: [number, number, number];
  activeChunks: number;
  lod0Buildings: number;
  lod1Buildings: number;
  lod2Buildings: number;
  totalPlots: number;
  rooftopCount: number;
}

export interface CityViewCallbacks {
  onWorldStats?: (stats: CityViewStats) => void;
  onHoverPlot?: (plot: CityBuildingPlot | null) => void;
  onSelectPlot?: (plot: CityBuildingPlot) => void;
  onFlyChange?: (flying: boolean) => void;
}

// ---------------------------------------------------------------------------
// Infinite Coastal Origami City View (3-Tier LOD + GPU Fold Wave + Curved Flight)
// ---------------------------------------------------------------------------

export class CityView {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public world: CoastalWorld | null = null;

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly cityRoot = new THREE.Group();
  private readonly hoverOutline: THREE.LineLoop;

  // Shared LOD0 OrigamiMaterials pool (8 architectural paper tones, zero redundant texture churn!)
  private readonly matPool: OrigamiMaterials[] = [];
  private readonly terrainMat: THREE.MeshStandardMaterial;
  private readonly streetMat: THREE.MeshStandardMaterial;
  private readonly promenadeMat: THREE.MeshStandardMaterial;
  private readonly plazaMat: THREE.MeshStandardMaterial;
  private readonly plinthMat: THREE.MeshStandardMaterial;
  private readonly pierMat: THREE.MeshStandardMaterial;
  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly boatMat: THREE.MeshStandardMaterial;
  private readonly contourMinorMat: THREE.LineBasicMaterial;
  private readonly contourMajorMat: THREE.LineBasicMaterial;
  private readonly curbMat: THREE.LineBasicMaterial;
  private readonly sailboatGeo: THREE.BufferGeometry;

  // Infinite camera-following folded paper sea
  private readonly seaMesh: THREE.Mesh;
  private readonly seaMat: THREE.MeshStandardMaterial;
  private readonly seaUniforms = {
    uTime: { value: 0 },
    uColorMix: { value: 0 },
    uCoastA: { value: new THREE.Vector4(21, 13, 7, 3) },
    uCoastF: { value: new THREE.Vector4(0.0041, 0.0097, 0.0183, 0.0317) },
    uCoastP: { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  // Shared GPU fold-wave uniforms synced across every LOD1/LOD2 chunk material!
  private readonly sharedLodUniforms = {
    uWaveFocus: { value: new THREE.Vector2(0, -36) },
    uWaveMode: { value: 0 },
    uColorMix: { value: 0 },
    uWhitePaperColor: { value: new THREE.Color('#f5f4f0') },
  };

  private readonly chunks = new Map<string, MountedChunk>();
  private readonly plotLookup = new Map<string, CityBuildingPlot>();
  private pickableMeshes: THREE.Object3D[] = [];
  private pickablesDirty = false;

  private colorEnabled = false;
  private winOpenMode: WindowOpenMode = 'random';
  private winOpenRatio = 0.35;
  private waveMode: CityWaveMode = 'wave';

  // Curved Coastal Glider Flight state (`s` increases monotonically along infinite coast!)
  private flying = true;
  private flightS = 0;
  private readonly flightSpeed = 10.5;
  private elapsedTime = 0;

  // Glider smooth look/zoom offsets while flying + Free-orbit state when paused
  private flyYawOff = 0;
  private targetFlyYawOff = 0;
  private flyPitchOff = 0;
  private targetFlyPitchOff = 0;
  private flyAltOff = 0;
  private targetFlyAltOff = 0;

  private curCamPos = new THREE.Vector3(0, 22, 0);
  private curLookAt = new THREE.Vector3(16, 2, -54);
  private curBankRoll = 0;
  private waveFocus = new THREE.Vector2(8, -36);

  // Free orbit camera state (seamless handoff when pausing Flight!)
  private curYaw = -0.35;
  private targetYaw = -0.35;
  private curPitch = 0.34;
  private targetPitch = 0.34;
  private curDist = 58;
  private targetDist = 58;
  private curTarget = new THREE.Vector3(16, 2, -54);
  private targetPos = new THREE.Vector3(16, 2, -54);

  private hoveredPlotId: string | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly callbacks: CityViewCallbacks;
  private hudEmitAccum = 0;

  // Pointer state
  private dragMode: 'none' | 'orbit' | 'pan' = 'none';
  private pointerId: number | null = null;
  private lastPx = 0;
  private lastPy = 0;
  private movedDist = 0;

  constructor(maxAnisotropy: number, envTexture: THREE.Texture | null, callbacks: CityViewCallbacks = {}) {
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.Fog(BACKDROP, 165, 375);
    if (envTexture) {
      this.scene.environment = envTexture;
      this.scene.environmentIntensity = 0.08;
    }

    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 520);

    this.hemi = new THREE.HemisphereLight('#fffef9', '#dfd9ce', 1.76);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fffdf6', 2.02);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00032;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 2.4;
    const ext = 72;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.near = 12;
    this.sun.shadow.camera.far = 230;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight('#f5f4f0', 0.28);
    this.fill.position.set(-38, 26, -24);
    this.scene.add(this.fill);

    this.scene.add(this.cityRoot);

    // Build shared OrigamiMaterials pool across ALL 8 architectural paper tones
    const poolSize = ARCHITECTURAL_PAPER_PALETTE.length;
    for (let i = 0; i < poolSize; i++) {
      this.matPool.push(createOrigamiMaterials(maxAnisotropy));
    }

    this.terrainMat = new THREE.MeshStandardMaterial({
      color: '#f5f4f0',
      roughness: 0.95,
      metalness: 0.0,
    });
    this.streetMat = new THREE.MeshStandardMaterial({
      color: '#e7e4dc',
      roughness: 0.96,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.promenadeMat = new THREE.MeshStandardMaterial({
      color: '#e2dfd6',
      roughness: 0.94,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.plazaMat = new THREE.MeshStandardMaterial({
      color: '#ebe8e0',
      roughness: 0.95,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.plinthMat = new THREE.MeshStandardMaterial({
      color: '#eeece5',
      roughness: 0.94,
      metalness: 0.0,
    });
    this.pierMat = new THREE.MeshStandardMaterial({
      color: '#eae6dc',
      roughness: 0.92,
      metalness: 0.0,
    });
    this.treeMat = new THREE.MeshStandardMaterial({
      color: '#ebe9e2',
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });
    this.boatMat = new THREE.MeshStandardMaterial({
      color: '#fbfaf6',
      roughness: 0.88,
      metalness: 0.0,
      flatShading: true,
    });

    this.contourMinorMat = new THREE.LineBasicMaterial({
      color: 0xcbc6bc,
      transparent: true,
      opacity: 0.44,
    });
    this.contourMajorMat = new THREE.LineBasicMaterial({
      color: 0xb1aca0,
      transparent: true,
      opacity: 0.72,
    });
    this.curbMat = new THREE.LineBasicMaterial({
      color: 0xbcb7ac,
      transparent: true,
      opacity: 0.62,
    });

    this.sailboatGeo = createSailboatGeometry();

    // Infinite camera-snapped Folded Paper Sea mesh with faceted origami waves & embossed shoreline foam contours!
    const seaGeo = new THREE.PlaneGeometry(660, 660, 128, 128);
    seaGeo.rotateX(-Math.PI * 0.5);
    this.seaMat = this.createPaperSeaMaterial();
    this.seaMesh = new THREE.Mesh(seaGeo, this.seaMat);
    this.seaMesh.position.y = 0.0;
    this.seaMesh.receiveShadow = true;
    this.seaMesh.frustumCulled = false;
    this.scene.add(this.seaMesh);

    // Crisp hover highlight loop for nearby clickable LOD0 buildings
    const hoverGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, -1),
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(-1, 0, 1),
    ]);
    const hoverMat = new THREE.LineBasicMaterial({
      color: 0x1c1c1c,
      transparent: true,
      opacity: 0.72,
    });
    this.hoverOutline = new THREE.LineLoop(hoverGeo, hoverMat);
    this.hoverOutline.visible = false;
    this.scene.add(this.hoverOutline);

    this.applyLightingAndColors();
  }

  private createPaperSeaMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.84,
      metalness: 0.02,
      flatShading: true,
    });
    mat.customProgramCacheKey = () => 'coastal-paper-sea-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.seaUniforms.uTime;
      shader.uniforms.uColorMix = this.seaUniforms.uColorMix;
      shader.uniforms.uCoastA = this.seaUniforms.uCoastA;
      shader.uniforms.uCoastF = this.seaUniforms.uCoastF;
      shader.uniforms.uCoastP = this.seaUniforms.uCoastP;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec4 uCoastA;
          uniform vec4 uCoastF;
          uniform vec4 uCoastP;
          varying vec3 vSeaWorldPos;
          varying float vSeaDistCoast;
          float evalSeaCoastX(float z) {
            return uCoastA.x * sin(z * uCoastF.x + uCoastP.x)
                 + uCoastA.y * sin(z * uCoastF.y + uCoastP.y)
                 + uCoastA.z * cos(z * uCoastF.z + uCoastP.z)
                 + uCoastA.w * sin(z * uCoastF.w + uCoastP.w);
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wPos0 = modelMatrix * vec4(transformed, 1.0);
          float cX = evalSeaCoastX(wPos0.z);
          float seaDist = cX - wPos0.x;
          float swellMask = smoothstep(-0.5, 7.5, seaDist);
          float wave1 = sin(wPos0.x * 0.145 + uTime * 0.85 + wPos0.z * 0.055) * 0.36;
          float wave2 = cos(wPos0.z * 0.115 - uTime * 0.64 - wPos0.x * 0.04) * 0.28;
          float wave3 = sin((wPos0.x - wPos0.z) * 0.24 + uTime * 1.15) * 0.13;
          transformed.y += (wave1 + wave2 + wave3) * swellMask;
          vSeaWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vSeaDistCoast = seaDist;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uColorMix;
          varying vec3 vSeaWorldPos;
          varying float vSeaDistCoast;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float offshore = max(0.0, vSeaDistCoast);
          float shallow = exp(-offshore * 0.048);
          // Crisp embossed paper wave rings rippling parallel to the curving shoreline!
          float rippleWave = sin(offshore * 1.05 - uTime * 1.45 + sin(vSeaWorldPos.z * 0.085) * 1.6);
          float foamLine = smoothstep(0.76, 0.95, rippleWave) * exp(-offshore * 0.052) * smoothstep(0.0, 1.1, offshore);
          float shoreEdge = exp(-offshore * 0.45) * smoothstep(-0.6, 0.3, vSeaDistCoast);

          // White-on-white museum paper sea: sculptural cool silver-parchment facets with crisp white shoreline rings
          vec3 whiteDeep = vec3(0.565, 0.602, 0.618);
          vec3 whiteShallow = vec3(0.695, 0.722, 0.720);
          vec3 whiteFoam = vec3(0.955, 0.950, 0.928);
          vec3 whiteSea = mix(whiteDeep, whiteShallow, shallow);
          whiteSea = mix(whiteSea, whiteFoam, clamp(foamLine * 0.80 + shoreEdge * 0.88, 0.0, 1.0));

          // Architectural Coastal Color Mode: serene Nordic/Mediterranean slate-cerulean paper sea
          vec3 colDeep = vec3(0.245, 0.405, 0.495);
          vec3 colShallow = vec3(0.415, 0.585, 0.625);
          vec3 colFoam = vec3(0.930, 0.924, 0.895);
          vec3 colorSea = mix(colDeep, colShallow, shallow);
          colorSea = mix(colorSea, colFoam, clamp(foamLine * 0.84 + shoreEdge * 0.92, 0.0, 1.0));

          diffuseColor.rgb *= mix(whiteSea, colorSea, uColorMix);`,
        );
    };
    return mat;
  }

  private createChunkLodBuildingMaterial(lodActiveMask: Float32Array, tier: 1 | 2): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: tier === 1 ? 0.93 : 0.96,
      metalness: 0.0,
    });
    mat.customProgramCacheKey = () => 'coastal-city-lod-building-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaveFocus = this.sharedLodUniforms.uWaveFocus;
      shader.uniforms.uWaveMode = this.sharedLodUniforms.uWaveMode;
      shader.uniforms.uColorMix = this.sharedLodUniforms.uColorMix;
      shader.uniforms.uWhitePaperColor = this.sharedLodUniforms.uWhitePaperColor;
      shader.uniforms.uLod0Active = { value: lodActiveMask };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aBuildOrigin;
          attribute vec2 aBuildMeta;
          uniform vec2 uWaveFocus;
          uniform float uWaveMode;
          uniform float uLod0Active[${MAX_LOD_PLOTS_PER_CHUNK}];
          varying float vLodCull;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          int bIdx = int(floor(aBuildMeta.x + 0.5));
          float lod0Flag = 0.0;
          if (bIdx >= 0 && bIdx < ${MAX_LOD_PLOTS_PER_CHUNK}) {
            lod0Flag = uLod0Active[bIdx];
          }
          vLodCull = lod0Flag;

          float fVal = 1.0;
          if (uWaveMode > 1.5) {
            fVal = 0.0;
          } else if (uWaveMode < 0.5) {
            float dFwd = uWaveFocus.y - aBuildOrigin.z;
            float dLat = abs(aBuildOrigin.x - uWaveFocus.x);
            float wMetric = dFwd + 0.24 * dLat + aBuildMeta.y;
            fVal = 1.0 - smoothstep(${WAVE_NEAR.toFixed(1)}, ${WAVE_FAR.toFixed(1)}, wMetric);
          }

          vec3 rel = transformed - aBuildOrigin;
          if (lod0Flag > 0.5) {
            rel = vec3(0.0);
          } else if (rel.y >= 0.0) {
            float rise = fVal * fVal * (3.0 - 2.0 * fVal);
            float flare = 1.0 + (1.0 - rise) * 0.22;
            rel.xz *= flare;
            rel.y = rel.y * max(0.015, rise) + (1.0 - rise) * 0.04;
          } else {
            float pRise = smoothstep(0.02, 0.42, fVal);
            rel.y *= pRise;
            if (pRise < 0.01) rel.xz *= 0.0;
          }
          transformed = aBuildOrigin + rel;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          if (vLodCull > 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uColorMix;
          uniform vec3 uWhitePaperColor;`,
        )
        .replace(
          '#include <color_fragment>',
          `#if defined( USE_COLOR_ALPHA )
            diffuseColor *= vColor;
          #elif defined( USE_COLOR )
            diffuseColor.rgb *= mix(uWhitePaperColor, vColor.rgb, uColorMix);
          #endif`,
        );
    };
    return mat;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public setColorEnabled(enabled: boolean): void {
    this.colorEnabled = enabled;
    this.applyLightingAndColors();
  }

  public setSpinEnabled(_enabled: boolean): void {
    // Retained for API symmetry; coastal flight replaces stationary turntable spin
  }

  public setFlying(flying: boolean): void {
    if (this.flying === flying) return;
    this.flying = flying;
    if (!flying) {
      // Seamless handoff into Free Orbit from the exact current glider lens!
      const lookDir = new THREE.Vector3().subVectors(this.curCamPos, this.curLookAt);
      const dist = Math.max(18, Math.min(130, lookDir.length()));
      this.curTarget.copy(this.curLookAt);
      this.targetPos.copy(this.curLookAt);
      this.curDist = this.targetDist = dist;
      this.curYaw = this.targetYaw = Math.atan2(lookDir.x, lookDir.z);
      const horiz = Math.hypot(lookDir.x, lookDir.z);
      this.curPitch = this.targetPitch = Math.max(0.16, Math.min(1.36, Math.atan2(lookDir.y, horiz)));
    } else {
      // Resume smoothly from the closest point along the infinite flight curve
      this.flightS = Math.max(0, -this.curCamPos.z);
      this.flyYawOff = this.targetFlyYawOff = 0;
      this.flyPitchOff = this.targetFlyPitchOff = 0;
      this.flyAltOff = this.targetFlyAltOff = 0;
    }
    this.callbacks.onFlyChange?.(this.flying);
    this.emitStats();
  }

  public isFlying(): boolean {
    return this.flying;
  }

  public getWaveMode(): CityWaveMode {
    return this.waveMode;
  }

  public setWaveMode(mode: CityWaveMode): void {
    this.waveMode = mode;
    this.sharedLodUniforms.uWaveMode.value = mode === 'wave' ? 0 : mode === 'folded' ? 1 : 2;
    this.updateActiveLod0Folds(true);
    this.emitStats();
  }

  /** Legacy helper mapping `0 -> 'flat'`, `1 -> 'wave'` (or `'folded'`) */
  public setCityFold(target: 0 | 1, instant = false): void {
    this.setWaveMode(target === 0 ? 'flat' : instant ? 'folded' : 'wave');
  }

  public getFoldTarget(): 0 | 1 {
    return this.waveMode === 'flat' ? 0 : 1;
  }

  public replayFoldWave(): void {
    this.setWaveMode('wave');
  }

  public setWindowOpen(mode: WindowOpenMode, ratio: number): void {
    this.winOpenMode = mode;
    this.winOpenRatio = Math.max(0, Math.min(1, ratio));
    for (const ch of this.chunks.values()) {
      for (const b of ch.lod0Map.values()) {
        b.rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
      }
    }
  }

  public advanceFlight(deltaS: number): void {
    this.flightS = Math.max(0, this.flightS + deltaS);
    if (this.world) {
      const sample = this.world.sampleFlight(this.flightS);
      this.curCamPos.set(sample.pos[0], sample.pos[1], sample.pos[2]);
      this.curLookAt.set(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]);
      this.curBankRoll = sample.bankRoll;
      this.waveFocus.set(sample.focusX, sample.focusZ);
      this.sharedLodUniforms.uWaveFocus.value.copy(this.waveFocus);
      this.syncCameraFromFlight();
      this.streamChunks(true);
      this.updateActiveLod0Folds(true);
      this.emitStats();
    }
  }

  public setCameraView(yaw: number, pitch: number, dist: number, tx = 16, ty = 2.2, tz = -42): void {
    this.flying = false;
    this.curYaw = this.targetYaw = yaw;
    this.curPitch = this.targetPitch = Math.max(0.16, Math.min(1.38, pitch));
    this.curDist = this.targetDist = Math.max(16, Math.min(150, dist));
    this.curTarget.set(tx, ty, tz);
    this.targetPos.set(tx, ty, tz);
    this.syncCameraFromOrbit();
    this.streamChunks(true);
    this.updateActiveLod0Folds(true);
    this.callbacks.onFlyChange?.(false);
  }

  private applyLightingAndColors(): void {
    this.sharedLodUniforms.uColorMix.value = this.colorEnabled ? 1 : 0;
    this.seaUniforms.uColorMix.value = this.colorEnabled ? 1 : 0;

    if (this.colorEnabled) {
      this.hemi.color.set('#fffdf8');
      this.hemi.groundColor.set('#dfd9cf');
      this.hemi.intensity = 1.52;
      this.sun.color.set('#fffdf9');
      this.sun.intensity = 1.24;
      this.fill.intensity = 0.24;
      this.terrainMat.color.set('#f3f0e8');
      this.streetMat.color.set('#e5e1d7');
      this.promenadeMat.color.set('#dfdace');
      this.plazaMat.color.set('#e9e6dd');
      this.plinthMat.color.set('#ece8df');
      this.pierMat.color.set('#dfd6c5');
      this.treeMat.color.set('#a2b59c');
      this.boatMat.color.set('#fcfbf7');
      const len = ARCHITECTURAL_PAPER_PALETTE.length;
      for (let i = 0; i < this.matPool.length; i++) {
        const m = this.matPool[i];
        m.setOutsideColors([
          ARCHITECTURAL_PAPER_PALETTE[i % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 2) % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 5) % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 3) % len],
        ]);
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#fbfaf7');
      }
    } else {
      this.hemi.color.set('#fffef9');
      this.hemi.groundColor.set('#dfd9ce');
      this.hemi.intensity = 1.76;
      this.sun.color.set('#fffdf6');
      this.sun.intensity = 2.02;
      this.fill.intensity = 0.28;
      this.terrainMat.color.set('#f5f4f0');
      this.streetMat.color.set('#e7e4dc');
      this.promenadeMat.color.set('#e2dfd7');
      this.plazaMat.color.set('#eae7df');
      this.plinthMat.color.set('#efede6');
      this.pierMat.color.set('#eae7df');
      this.treeMat.color.set('#ebe9e2');
      this.boatMat.color.set('#fbfaf6');
      for (const m of this.matPool) {
        m.setOutsideColor('#f5f4f0');
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#f8f7f3');
      }
    }
  }

  private disposeChunk(ch: MountedChunk): void {
    for (const b of ch.lod0Map.values()) {
      b.rig.dispose();
      b.plinth.geometry.dispose();
    }
    ch.lod0Map.clear();
    for (const g of ch.staticGeos) g.dispose();
    ch.staticGeos.length = 0;
    if (ch.lodGeo) ch.lodGeo.dispose();
    if (ch.lodMat) ch.lodMat.dispose();
    for (const p of ch.data.plots) {
      this.plotLookup.delete(p.id);
    }
    this.cityRoot.remove(ch.group);
    this.pickablesDirty = true;
  }

  private clearAllChunks(): void {
    for (const ch of this.chunks.values()) {
      this.disposeChunk(ch);
    }
    this.chunks.clear();
    this.plotLookup.clear();
    this.pickableMeshes = [];
    this.pickablesDirty = false;
    this.hoveredPlotId = null;
    this.hoverOutline.visible = false;
    this.callbacks.onHoverPlot?.(null);
  }

  public rebuild(opts: CoastalWorldOptions, resetFlight = true): CoastalWorld {
    this.clearAllChunks();
    const world = createCoastalWorld(opts);
    this.world = world;

    // Sync exact coastline harmonics to GPU paper sea shader
    const h = world.terrain.coastHarmonics;
    this.seaUniforms.uCoastA.value.set(h.a1, h.a2, h.a3, h.a4);
    this.seaUniforms.uCoastF.value.set(h.f1, h.f2, h.f3, h.f4);
    this.seaUniforms.uCoastP.value.set(h.p1, h.p2, h.p3, h.p4);

    if (resetFlight) {
      this.flightS = 0;
      this.flyYawOff = this.targetFlyYawOff = 0;
      this.flyPitchOff = this.targetFlyPitchOff = 0;
      this.flyAltOff = this.targetFlyAltOff = 0;
    }

    const sample = world.sampleFlight(this.flightS);
    this.curCamPos.set(sample.pos[0], sample.pos[1], sample.pos[2]);
    this.curLookAt.set(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]);
    this.curBankRoll = sample.bankRoll;
    this.waveFocus.set(sample.focusX, sample.focusZ);
    this.sharedLodUniforms.uWaveFocus.value.copy(this.waveFocus);

    if (this.flying) {
      this.syncCameraFromFlight();
    } else {
      this.curTarget.copy(this.curLookAt);
      this.targetPos.copy(this.curLookAt);
      this.syncCameraFromOrbit();
    }

    this.applyLightingAndColors();
    // Initial synchronous burst fills the immediate coastal vista on frame 0 with zero blank sky!
    this.streamChunks(true);
    this.updateActiveLod0Folds(true);
    this.emitStats();
    return world;
  }

  private buildChunkStaticVisuals(ch: MountedChunk, tier: 0 | 1 | 2): void {
    const world = this.world!;
    const { terrain } = world;
    const { data } = ch;

    for (const g of ch.staticGeos) g.dispose();
    ch.staticGeos.length = 0;
    ch.staticGroup.clear();
    ch.boatMeshes.length = 0;

    // 1. Sculpted terrain mesh with LOD-matched resolution & downward zero-crack border skirts
    const terrainSegs = tier === 0 ? 22 : tier === 1 ? 11 : 5;
    const tGeo = buildChunkTerrainGeometry(terrain, data.cx, data.cz, terrainSegs);
    ch.staticGeos.push(tGeo);
    const tMesh = new THREE.Mesh(tGeo, this.terrainMat);
    tMesh.receiveShadow = tier <= 1;
    tMesh.castShadow = false;
    ch.staticGroup.add(tMesh);

    // 2. Marching Squares topographic contour lines (Tier 0: minor+major; Tier 1: major only; Tier 2: none)
    if (tier <= 1 && data.hasLand && terrain.hills > 0.02) {
      const contours = world.extractChunkContours(data.cx, data.cz, tier === 0 ? 22 : 12, 0.65);
      if (contours.length > 0) {
        const minorPts: number[] = [];
        const majorPts: number[] = [];
        for (const seg of contours) {
          if (tier === 1 && !seg.isMajor) continue;
          const dst = seg.isMajor ? majorPts : minorPts;
          dst.push(seg.a[0], seg.y + 0.032, seg.a[1], seg.b[0], seg.y + 0.032, seg.b[1]);
        }
        if (minorPts.length > 0) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(minorPts, 3));
          ch.staticGeos.push(g);
          ch.staticGroup.add(new THREE.LineSegments(g, this.contourMinorMat));
        }
        if (majorPts.length > 0) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
          ch.staticGeos.push(g);
          ch.staticGroup.add(new THREE.LineSegments(g, this.contourMajorMat));
        }
      }
    }

    // 3. Terrain-draped streets + waterfront promenade + crisp curb lines
    const curbPts: number[] = [];
    const streetGeos: THREE.BufferGeometry[] = [];
    const promGeos: THREE.BufferGeometry[] = [];

    for (const st of data.streets) {
      if (tier === 2 && st.kind !== 'promenade') continue;
      if (tier === 1 && st.kind === 'lane') continue;
      const pts = st.points;
      if (pts.length < 2) continue;

      const halfW = st.width * 0.5;
      const verts: number[] = [];
      const indices: number[] = [];
      const leftEdge: [number, number, number][] = [];
      const rightEdge: [number, number, number][] = [];

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        let tx = next[0] - prev[0];
        let tz = next[1] - prev[1];
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const nx = -tz;
        const nz = tx;

        const lx = p[0] - nx * halfW;
        const lz = p[1] - nz * halfW;
        const rx = p[0] + nx * halfW;
        const rz = p[1] + nz * halfW;

        const ly = terrain.heightAt(lx, lz) + 0.06;
        const cy = terrain.heightAt(p[0], p[1]) + 0.068;
        const ry = terrain.heightAt(rx, rz) + 0.06;

        const base = i * 3;
        verts.push(lx, ly, lz, p[0], cy, p[1], rx, ry, rz);
        if (tier === 0) {
          leftEdge.push([lx, ly + 0.015, lz]);
          rightEdge.push([rx, ry + 0.015, rz]);
        }

        if (i < pts.length - 1) {
          const nBase = (i + 1) * 3;
          indices.push(base, base + 1, nBase, base + 1, nBase + 1, nBase);
          indices.push(base + 1, base + 2, nBase + 1, base + 2, nBase + 2, nBase + 1);
        }
      }

      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      rGeo.setIndex(indices);
      rGeo.computeVertexNormals();
      if (st.kind === 'promenade') promGeos.push(rGeo);
      else streetGeos.push(rGeo);

      if (tier === 0) {
        for (let i = 0; i < leftEdge.length - 1; i++) {
          curbPts.push(...leftEdge[i], ...leftEdge[i + 1], ...rightEdge[i], ...rightEdge[i + 1]);
        }
      }
    }

    const mergedStreets = mergeSimpleGeometries(streetGeos);
    if (mergedStreets) {
      ch.staticGeos.push(mergedStreets);
      const m = new THREE.Mesh(mergedStreets, this.streetMat);
      m.receiveShadow = tier <= 1;
      ch.staticGroup.add(m);
    }
    const mergedProm = mergeSimpleGeometries(promGeos);
    if (mergedProm) {
      ch.staticGeos.push(mergedProm);
      const m = new THREE.Mesh(mergedProm, this.promenadeMat);
      m.receiveShadow = tier <= 1;
      ch.staticGroup.add(m);
    }

    // 4. Terrain-draped plazas (Tier 0 & Tier 1)
    if (tier <= 1 && data.plazas.length > 0) {
      const plazaGeos: THREE.BufferGeometry[] = [];
      for (const pl of data.plazas) {
        const segs = tier === 0 ? 22 : 12;
        const verts: number[] = [pl.x, terrain.heightAt(pl.x, pl.z) + 0.078, pl.z];
        const indices: number[] = [];
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const vx = pl.x + Math.cos(a) * pl.radius;
          const vz = pl.z + Math.sin(a) * pl.radius;
          verts.push(vx, terrain.heightAt(vx, vz) + 0.075, vz);
        }
        for (let s = 0; s < segs; s++) {
          const next = (s + 1) % segs;
          indices.push(0, 1 + next, 1 + s);
        }
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        pGeo.setIndex(indices);
        pGeo.computeVertexNormals();
        plazaGeos.push(pGeo);
      }
      const mergedPlazas = mergeSimpleGeometries(plazaGeos);
      if (mergedPlazas) {
        ch.staticGeos.push(mergedPlazas);
        const pm = new THREE.Mesh(mergedPlazas, this.plazaMat);
        pm.receiveShadow = true;
        ch.staticGroup.add(pm);
      }
    }

    if (curbPts.length > 0) {
      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPts, 3));
      ch.staticGeos.push(cGeo);
      ch.staticGroup.add(new THREE.LineSegments(cGeo, this.curbMat));
    }

    // 5. Coastal piers extending into the folded paper sea (Tier 0 & Tier 1)
    if (tier <= 1 && data.piers.length > 0) {
      const pierGeo = buildMergedPiersGeometry(data.piers);
      if (pierGeo) {
        ch.staticGeos.push(pierGeo);
        const pm = new THREE.Mesh(pierGeo, this.pierMat);
        pm.castShadow = tier === 0;
        pm.receiveShadow = true;
        ch.staticGroup.add(pm);
      }
    }

    // 6. Grounded folded origami paper trees (batched to 1–2 draw calls per chunk; skipped at Tier 2)
    if (tier <= 1 && data.trees.length > 0) {
      const { trunks, foliage } = buildMergedTreesGeometries(data.trees, tier === 0);
      if (trunks) {
        ch.staticGeos.push(trunks);
        const tm = new THREE.Mesh(trunks, this.plinthMat);
        tm.castShadow = tier === 0;
        tm.receiveShadow = true;
        ch.staticGroup.add(tm);
      }
      if (foliage) {
        ch.staticGeos.push(foliage);
        const fm = new THREE.Mesh(foliage, this.treeMat);
        fm.castShadow = tier === 0;
        fm.receiveShadow = true;
        ch.staticGroup.add(fm);
      }
    }

    // 7. Tiny folded origami sailboats bobbing in sheltered bays (Tier 0 & Tier 1)
    if (tier <= 1 && data.boats.length > 0) {
      for (const boat of data.boats) {
        const bm = new THREE.Mesh(this.sailboatGeo, this.boatMat);
        bm.position.set(boat.x, 0.04, boat.z);
        bm.rotation.y = boat.yaw;
        bm.scale.setScalar(boat.scale);
        bm.castShadow = tier === 0;
        bm.receiveShadow = true;
        ch.staticGroup.add(bm);
        ch.boatMeshes.push({ mesh: bm, boat });
      }
    }

    // 8. Single-draw-call GPU-foldable LOD1 / LOD2 building mesh!
    const wantLodTier: 1 | 2 = tier <= 1 ? 1 : 2;
    if (ch.lodMesh) {
      ch.group.remove(ch.lodMesh);
      ch.lodMesh = null;
    }
    if (ch.lodGeo) {
      ch.lodGeo.dispose();
      ch.lodGeo = null;
    }
    if (ch.lodMat) {
      ch.lodMat.dispose();
      ch.lodMat = null;
    }

    const lodGeo = buildChunkLodBuildingsGeometry(data.plots, wantLodTier);
    if (lodGeo) {
      const lodMat = this.createChunkLodBuildingMaterial(ch.lodActiveMask, wantLodTier);
      const lodMesh = new THREE.Mesh(lodGeo, lodMat);
      lodMesh.castShadow = tier === 0;
      lodMesh.receiveShadow = tier <= 1;
      ch.lodGeo = lodGeo;
      ch.lodMat = lodMat;
      ch.lodMesh = lodMesh;
      ch.group.add(lodMesh);
    }

    ch.tier = tier;
  }

  private mountLod0Building(ch: MountedChunk, plot: CityBuildingPlot): void {
    if (ch.lod0Map.has(plot.index)) return;
    const matSet = this.matPool[plot.colorIndex % this.matPool.length];
    const net = buildHouseNet(plot.spec);
    const rig = buildOrigamiHouseRig(net, matSet, false);
    rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
    rig.setPaperRelief(1);

    const wrapper = new THREE.Group();
    wrapper.position.set(plot.x, plot.baseY, plot.z);
    wrapper.rotation.y = plot.yaw;

    const plinthH = Math.max(0.28, plot.baseY - plot.groundMinY + 0.95);
    const plinthGeo = new THREE.BoxGeometry(plot.footprintW + 0.16, plinthH, plot.footprintD + 0.16);
    const plinth = new THREE.Mesh(plinthGeo, this.plinthMat);
    plinth.position.y = -plinthH * 0.5;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    plinth.userData.cityPlotId = plot.id;
    wrapper.add(plinth);

    const pickables: THREE.Object3D[] = [plinth];
    rig.root.rotation.y = 0;
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.userData.cityPlotId = plot.id;
        pickables.push(obj);
      }
    });
    wrapper.add(rig.root);
    ch.group.add(wrapper);

    const initFold = evaluateFoldWave(
      plot.x,
      plot.z,
      plot.foldJitter,
      this.waveFocus.x,
      this.waveFocus.y,
      this.waveMode,
    );
    const mounted: MountedLod0Building = {
      plot,
      rig,
      wrapper,
      plinth,
      plinthH,
      curFold: -1,
      pickables,
    };
    this.applyLod0FoldState(mounted, initFold);
    ch.lod0Map.set(plot.index, mounted);

    // Hide this building's proxy in the chunk's GPU LOD1 mesh instantly (zero z-fighting!)
    if (plot.index < MAX_LOD_PLOTS_PER_CHUNK) {
      ch.lodActiveMask[plot.index] = 1.0;
    }
    this.pickablesDirty = true;
  }

  private unmountLod0Building(ch: MountedChunk, plotIdx: number): void {
    const b = ch.lod0Map.get(plotIdx);
    if (!b) return;
    ch.group.remove(b.wrapper);
    b.rig.dispose();
    b.plinth.geometry.dispose();
    ch.lod0Map.delete(plotIdx);
    if (plotIdx < MAX_LOD_PLOTS_PER_CHUNK) {
      ch.lodActiveMask[plotIdx] = 0.0;
    }
    this.pickablesDirty = true;
  }

  private applyLod0FoldState(b: MountedLod0Building, fold: number): void {
    b.curFold = fold;
    for (const id of b.rig.panelIds) {
      b.rig.updatePanelVisual(id, fold, 0, false);
    }
    b.rig.setFoldLinesVisible(fold < 0.48);

    // Smoothly emerge the retaining plinth with the early fold so no bare pedestals stick out ahead of the wave
    const pRise = smoothstep(0.02, 0.42, fold);
    b.plinth.visible = pRise > 0.01;
    if (b.plinth.visible) {
      b.plinth.scale.y = Math.max(0.01, pRise);
      b.plinth.position.y = -b.plinthH * 0.5 * pRise;
    }
  }

  private updateActiveLod0Folds(forceAll = false): void {
    const fx = this.waveFocus.x;
    const fz = this.waveFocus.y;
    for (const ch of this.chunks.values()) {
      for (const b of ch.lod0Map.values()) {
        const nextFold = evaluateFoldWave(b.plot.x, b.plot.z, b.plot.foldJitter, fx, fz, this.waveMode);
        if (forceAll || Math.abs(nextFold - b.curFold) > 0.0018) {
          this.applyLod0FoldState(b, nextFold);
        }
      }
    }
  }

  private streamChunks(syncBurst: boolean): void {
    const world = this.world;
    if (!world) return;

    const camX = this.curCamPos.x;
    const camZ = this.curCamPos.z;
    // Bias chunk streaming anchor forward along flight look direction so distant coastal headlands fill the horizon!
    const anchorX = camX * 0.55 + this.curLookAt.x * 0.45;
    const anchorZ = camZ * 0.55 + this.curLookAt.z * 0.45;

    // 1. Unload distant chunks past unload horizon (zero memory growth during infinite flight!)
    for (const [key, ch] of this.chunks) {
      const d = Math.hypot(ch.data.centerX - anchorX, ch.data.centerZ - anchorZ);
      if (d > CHUNK_UNLOAD_RADIUS) {
        this.disposeChunk(ch);
        this.chunks.delete(key);
      }
    }

    // 2. Gather desired chunks within load radius sorted near -> far
    const cxCenter = Math.floor(anchorX / CITY_CHUNK_SIZE);
    const czCenter = Math.floor(anchorZ / CITY_CHUNK_SIZE);
    const cRad = Math.ceil(CHUNK_LOAD_RADIUS / CITY_CHUNK_SIZE);

    const missing: Array<{ cx: number; cz: number; dist: number; tier: 0 | 1 | 2 }> = [];
    for (let dz = -cRad; dz <= cRad; dz++) {
      for (let dx = -cRad; dx <= cRad; dx++) {
        const cx = cxCenter + dx;
        const cz = czCenter + dz;
        const centerX = (cx + 0.5) * CITY_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * CITY_CHUNK_SIZE;
        const dAnchor = Math.hypot(centerX - anchorX, centerZ - anchorZ);
        if (dAnchor > CHUNK_LOAD_RADIUS) continue;

        const dCam = Math.hypot(centerX - camX, centerZ - camZ);
        const key = `${cx},${cz}`;
        const existing = this.chunks.get(key);

        if (!existing) {
          const tier: 0 | 1 | 2 = dCam < TIER0_ENTER ? 0 : dCam < TIER1_ENTER ? 1 : 2;
          missing.push({ cx, cz, dist: dCam, tier });
        } else {
          // Hysteresis LOD tier transitions so chunks right on a distance boundary never thrash
          let nextTier = existing.tier;
          if (existing.tier === 0 && dCam > TIER0_EXIT) nextTier = dCam < TIER1_ENTER ? 1 : 2;
          else if (existing.tier === 1) {
            if (dCam < TIER0_ENTER) nextTier = 0;
            else if (dCam > TIER1_EXIT) nextTier = 2;
          } else if (existing.tier === 2 && dCam < TIER1_EXIT - 10) {
            nextTier = dCam < TIER0_ENTER ? 0 : 1;
          }

          if (nextTier !== existing.tier) {
            // If downgrading out of Tier 0, release all LOD0 origami rigs cleanly back to GPU LOD1/LOD2
            if (nextTier > 0 && existing.lod0Map.size > 0) {
              for (const idx of Array.from(existing.lod0Map.keys())) {
                this.unmountLod0Building(existing, idx);
              }
            }
            this.buildChunkStaticVisuals(existing, nextTier);
          }
        }
      }
    }

    missing.sort((a, b) => a.dist - b.dist);

    // Time-budgeted chunk creation (instant burst on startup/teleport; silky <= 4.2ms per frame while flying!)
    const tStart = performance.now();
    const budgetMs = syncBurst ? 180 : 4.2;
    let builtCount = 0;
    for (const req of missing) {
      if (!syncBurst && builtCount >= 2 && performance.now() - tStart > budgetMs) break;
      const data = world.generateChunk(req.cx, req.cz);
      const group = new THREE.Group();
      const staticGroup = new THREE.Group();
      group.add(staticGroup);
      this.cityRoot.add(group);

      const ch: MountedChunk = {
        data,
        tier: req.tier,
        group,
        staticGroup,
        staticGeos: [],
        lodMesh: null,
        lodMat: null,
        lodGeo: null,
        lodActiveMask: new Float32Array(MAX_LOD_PLOTS_PER_CHUNK),
        lod0Map: new Map(),
        boatMeshes: [],
      };
      for (const p of data.plots) {
        this.plotLookup.set(p.id, p);
      }
      this.buildChunkStaticVisuals(ch, req.tier);
      this.chunks.set(data.key, ch);
      builtCount++;
    }

    // 3. Incremental LOD0 OrigamiHouseRig upgrades (closest hero houses first, capped per frame for 60fps!)
    const lod0Candidates: Array<{ ch: MountedChunk; plot: CityBuildingPlot; dist: number }> = [];
    for (const ch of this.chunks.values()) {
      if (ch.tier !== 0) continue;
      for (const plot of ch.data.plots) {
        const d = Math.hypot(plot.x - camX, plot.z - camZ);
        const mounted = ch.lod0Map.has(plot.index);
        if (mounted && d > LOD0_EXIT_DIST) {
          this.unmountLod0Building(ch, plot.index);
        } else if (!mounted && d < LOD0_ENTER_DIST) {
          lod0Candidates.push({ ch, plot, dist: d });
        }
      }
    }

    lod0Candidates.sort((a, b) => a.dist - b.dist);
    const maxRigBuilds = syncBurst ? 36 : 2;
    let rigsBuilt = 0;
    for (const item of lod0Candidates) {
      if (rigsBuilt >= maxRigBuilds) break;
      if (!syncBurst && rigsBuilt >= 1 && performance.now() - tStart > 5.5) break;
      this.mountLod0Building(item.ch, item.plot);
      rigsBuilt++;
    }
  }

  private syncSunAndSea(): void {
    // Snap directional shadow camera in texel-aligned steps around waveFocus so shadows NEVER crawl or shimmer!
    const shadowStep = 144 / 2048;
    const sx = Math.round(this.waveFocus.x / shadowStep) * shadowStep;
    const sz = Math.round(this.waveFocus.y / shadowStep) * shadowStep;
    const sunDir = this.colorEnabled ? SUN_DIR_COLOR : SUN_DIR_WHITE;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(sx + sunDir.x * 105, sunDir.y * 105, sz + sunDir.z * 105);

    // Snap infinite folded paper sea mesh to 4-unit grid beneath camera so faceted waves stay rock-steady!
    const seaStep = 4.0;
    this.seaMesh.position.x = Math.round(this.curCamPos.x / seaStep) * seaStep;
    this.seaMesh.position.z = Math.round((this.curCamPos.z - 60) / seaStep) * seaStep;
  }

  private syncCameraFromFlight(): void {
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.curCamPos);

    // Apply optional subtle user look-around offset while gliding along the curved path!
    if (Math.abs(this.flyYawOff) > 1e-4 || Math.abs(this.flyPitchOff) > 1e-4) {
      const dir = new THREE.Vector3().subVectors(this.curLookAt, this.curCamPos);
      const len = dir.length();
      const baseYaw = Math.atan2(dir.x, dir.z);
      const basePitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      const y = baseYaw + this.flyYawOff;
      const p = Math.max(-0.95, Math.min(0.45, basePitch + this.flyPitchOff));
      const adjustedLook = new THREE.Vector3(
        this.curCamPos.x + Math.cos(p) * Math.sin(y) * len,
        this.curCamPos.y + Math.sin(p) * len,
        this.curCamPos.z + Math.cos(p) * Math.cos(y) * len,
      );
      this.camera.lookAt(adjustedLook);
    } else {
      this.camera.lookAt(this.curLookAt);
    }

    if (Math.abs(this.curBankRoll) > 1e-5) {
      this.camera.rotateZ(this.curBankRoll);
    }
    this.syncSunAndSea();
  }

  private syncCameraFromOrbit(): void {
    const cx = this.curTarget.x + this.curDist * Math.cos(this.curPitch) * Math.sin(this.curYaw);
    const cy = this.curTarget.y + this.curDist * Math.sin(this.curPitch);
    const cz = this.curTarget.z + this.curDist * Math.cos(this.curPitch) * Math.cos(this.curYaw);
    this.curCamPos.set(cx, cy, cz);
    this.curLookAt.copy(this.curTarget);
    this.waveFocus.set(this.curTarget.x, this.curTarget.z);
    this.sharedLodUniforms.uWaveFocus.value.copy(this.waveFocus);

    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(this.curCamPos);
    this.camera.lookAt(this.curTarget);
    this.syncSunAndSea();
  }

  public update(dt: number): void {
    if (!this.world) return;
    this.elapsedTime += dt;
    this.seaUniforms.uTime.value = this.elapsedTime;

    const k = 1 - Math.exp(-6.5 * dt);

    if (this.flying) {
      this.flightS += dt * this.flightSpeed;
      const sample = this.world.sampleFlight(this.flightS);

      // Gentle auto-recenter of look-around offset when not dragging
      if (this.dragMode === 'none') {
        this.targetFlyYawOff *= Math.exp(-1.8 * dt);
        this.targetFlyPitchOff *= Math.exp(-1.8 * dt);
      }
      this.flyYawOff += (this.targetFlyYawOff - this.flyYawOff) * k;
      this.flyPitchOff += (this.targetFlyPitchOff - this.flyPitchOff) * k;
      this.flyAltOff += (this.targetFlyAltOff - this.flyAltOff) * k;

      const desiredPos = new THREE.Vector3(sample.pos[0], Math.max(10, sample.pos[1] + this.flyAltOff), sample.pos[2]);
      const desiredLook = new THREE.Vector3(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]);
      this.curCamPos.lerp(desiredPos, 1 - Math.exp(-8.0 * dt));
      this.curLookAt.lerp(desiredLook, 1 - Math.exp(-6.0 * dt));
      this.curBankRoll += (sample.bankRoll - this.curBankRoll) * (1 - Math.exp(-4.5 * dt));

      this.waveFocus.set(sample.focusX, sample.focusZ);
      this.sharedLodUniforms.uWaveFocus.value.copy(this.waveFocus);
      this.syncCameraFromFlight();
    } else {
      this.curYaw += (this.targetYaw - this.curYaw) * k;
      this.curPitch += (this.targetPitch - this.curPitch) * k;
      this.curDist += (this.targetDist - this.curDist) * k;
      this.curTarget.lerp(this.targetPos, k);
      this.syncCameraFromOrbit();
    }

    // Stream infinite coastal chunks & incremental LOD0 upgrades
    this.streamChunks(false);

    // Sync active LOD0 origami building folds with the sweeping wave
    this.updateActiveLod0Folds(false);

    // Gently bob coastal origami sailboats on the paper waves
    const t = this.elapsedTime;
    for (const ch of this.chunks.values()) {
      for (const item of ch.boatMeshes) {
        const ph = item.boat.phase;
        item.mesh.position.y = 0.04 + Math.sin(t * 1.45 + ph) * 0.14;
        item.mesh.rotation.z = Math.sin(t * 1.15 + ph * 1.3) * 0.075;
        item.mesh.rotation.x = Math.cos(t * 0.92 + ph * 0.7) * 0.045;
      }
    }

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.4) {
      this.hudEmitAccum = 0;
      this.emitStats();
    }
  }

  public getStats(): CityViewStats {
    let lod0 = 0;
    let lod1 = 0;
    let lod2 = 0;
    let totalPlots = 0;
    let rooftopCount = 0;

    for (const ch of this.chunks.values()) {
      const n = ch.data.plots.length;
      const n0 = ch.lod0Map.size;
      totalPlots += n;
      rooftopCount += ch.data.rooftopCount;
      lod0 += n0;
      if (ch.tier <= 1) lod1 += Math.max(0, n - n0);
      else lod2 += n;
    }

    return {
      active: true,
      seed: this.world?.seed ?? 0,
      style: this.world?.style ?? 'mix',
      hills: this.world?.hills ?? 0.55,
      flying: this.flying,
      waveMode: this.waveMode,
      flightS: Math.round(this.flightS * 10) / 10,
      camPos: [
        Math.round(this.curCamPos.x * 10) / 10,
        Math.round(this.curCamPos.y * 10) / 10,
        Math.round(this.curCamPos.z * 10) / 10,
      ],
      activeChunks: this.chunks.size,
      lod0Buildings: lod0,
      lod1Buildings: lod1,
      lod2Buildings: lod2,
      totalPlots,
      rooftopCount,
    };
  }

  private emitStats(): void {
    this.callbacks.onWorldStats?.(this.getStats());
  }

  private rebuildPickablesIfNeeded(): void {
    if (!this.pickablesDirty) return;
    this.pickablesDirty = false;
    const list: THREE.Object3D[] = [];
    for (const ch of this.chunks.values()) {
      for (const b of ch.lod0Map.values()) {
        for (const obj of b.pickables) list.push(obj);
      }
    }
    this.pickableMeshes = list;
  }

  private pickPlotAt(clientX: number, clientY: number, canvas: HTMLCanvasElement): CityBuildingPlot | null {
    this.rebuildPickablesIfNeeded();
    if (this.pickableMeshes.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickableMeshes, false);
    if (hits.length === 0) return null;
    const id = hits[0].object.userData.cityPlotId;
    if (typeof id !== 'string') return null;
    return this.plotLookup.get(id) ?? null;
  }

  private setHoverPlot(plot: CityBuildingPlot | null): void {
    const nextId = plot ? plot.id : null;
    if (nextId === this.hoveredPlotId) return;
    this.hoveredPlotId = nextId;
    if (plot) {
      const pos = this.hoverOutline.geometry.attributes.position as THREE.BufferAttribute;
      const pad = 0.24;
      const hw = plot.footprintW * 0.5 + pad;
      const hd = plot.footprintD * 0.5 + pad;
      const c = Math.cos(plot.yaw);
      const s = Math.sin(plot.yaw);
      const corners: [number, number][] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
      for (let i = 0; i < 4; i++) {
        const [lx, lz] = corners[i];
        pos.setXYZ(i, plot.x + lx * c + lz * s, plot.baseY + 0.08, plot.z - lx * s + lz * c);
      }
      pos.needsUpdate = true;
      this.hoverOutline.visible = true;
    } else {
      this.hoverOutline.visible = false;
    }
    this.callbacks.onHoverPlot?.(plot);
  }

  public onPointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    this.pointerId = e.pointerId;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    this.movedDist = 0;
    this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    canvas.setPointerCapture(e.pointerId);
  }

  public onPointerMove(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (this.dragMode === 'none') {
      const plot = this.pickPlotAt(e.clientX, e.clientY, canvas);
      this.setHoverPlot(plot);
      canvas.style.cursor = plot ? 'pointer' : 'grab';
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastPx;
    const dy = e.clientY - this.lastPy;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    this.movedDist += Math.hypot(dx, dy);

    if (this.flying) {
      // Smooth glider look-around while flying! (Shift-drag pauses flight to freely pan anywhere)
      if (this.dragMode === 'pan') {
        this.setFlying(false);
      } else {
        this.targetFlyYawOff = Math.max(-1.15, Math.min(1.15, this.targetFlyYawOff - dx * 0.0045));
        this.targetFlyPitchOff = Math.max(-0.48, Math.min(0.36, this.targetFlyPitchOff - dy * 0.0038));
      }
    } else if (this.dragMode === 'orbit') {
      this.targetYaw -= dx * 0.0065;
      this.targetPitch = Math.max(0.14, Math.min(1.38, this.targetPitch + dy * 0.0055));
    } else {
      // Infinite free pan across the coastal world!
      const panScale = this.curDist * 0.0018;
      const rightX = Math.cos(this.curYaw);
      const rightZ = -Math.sin(this.curYaw);
      const fwdX = -Math.sin(this.curYaw);
      const fwdZ = -Math.cos(this.curYaw);
      this.targetPos.x += -dx * panScale * rightX + dy * panScale * fwdX;
      this.targetPos.z += -dx * panScale * rightZ + dy * panScale * fwdZ;
      if (this.world) {
        this.targetPos.y = Math.max(1.2, this.world.terrain.heightAt(this.targetPos.x, this.targetPos.z) + 1.4);
      }
    }
    canvas.style.cursor = 'grabbing';
  }

  public onPointerUp(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (e.pointerId !== this.pointerId) return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const wasClick = this.movedDist < 6 && e.button === 0;
    this.dragMode = 'none';
    this.pointerId = null;
    canvas.style.cursor = 'grab';
    if (wasClick) {
      const plot = this.pickPlotAt(e.clientX, e.clientY, canvas);
      if (plot) {
        this.callbacks.onSelectPlot?.(plot);
      }
    }
  }

  public onWheel(e: WheelEvent): void {
    if (this.flying) {
      this.targetFlyAltOff = Math.max(-8, Math.min(34, this.targetFlyAltOff + e.deltaY * 0.018));
    } else {
      const scale = Math.exp(e.deltaY * 0.0011);
      this.targetDist = Math.max(16, Math.min(150, this.targetDist * scale));
    }
  }

  public getStreetStyle(): CityStreetStyle {
    return this.world?.style ?? 'mix';
  }

  public dispose(): void {
    this.clearAllChunks();
    for (const m of this.matPool) m.dispose();
    this.terrainMat.dispose();
    this.streetMat.dispose();
    this.promenadeMat.dispose();
    this.plazaMat.dispose();
    this.plinthMat.dispose();
    this.pierMat.dispose();
    this.treeMat.dispose();
    this.boatMat.dispose();
    this.contourMinorMat.dispose();
    this.contourMajorMat.dispose();
    this.curbMat.dispose();
    this.sailboatGeo.dispose();
    this.seaMesh.geometry.dispose();
    this.seaMat.dispose();
    this.hoverOutline.geometry.dispose();
    (this.hoverOutline.material as THREE.Material).dispose();
  }
}
