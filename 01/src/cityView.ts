import * as THREE from 'three';
import {
  ARCHITECTURAL_PAPER_PALETTE,
  buildHouseNet,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  createWashiFiberTextures,
  type OrigamiHouseRig,
  type OrigamiMaterials,
  type WashiFiberTextures,
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

const MAX_LOD_PLOTS_PER_CHUNK = 64;
const TIER0_ENTER = 136;
const TIER0_EXIT = 152;
const TIER1_ENTER = 195;
const TIER1_EXIT = 212;
const CHUNK_LOAD_RADIUS = 325;
const CHUNK_UNLOAD_RADIUS = 360;
const LOD0_ENTER_DIST = 84;
const LOD0_EXIT_DIST = 98;
const WAVE_NEAR = 18.0;
const WAVE_FAR = 78.0;
const MAX_SMOKE_PUFFS = 420;
const CITY_FOG_DENSITY = 0.0052;

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

/**
 * Merge low-poly architectural massing + roof prisms + flat floor nets + retaining plinths for ALL buildings
 * in a chunk into ONE draw call, baking exact 2-bone ground/eave origami hinge kinematics per face so
 * EVERY LOD1 & LOD2 building genuinely folds UP from a flat cross-shaped paper sheet on the ground!
 */
function buildChunkLodBuildingsGeometry(plots: CityBuildingPlot[], tier: 1 | 2): THREE.BufferGeometry | null {
  if (plots.length === 0) return null;

  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const origins: number[] = [];
  const metas: number[] = [];
  const hingePos: number[] = [];
  const hingeAxis: number[] = [];
  const foldSpec: number[] = [];

  const tmpColor = new THREE.Color();
  const plinthColor = new THREE.Color('#ece9e1');
  const floorColor = new THREE.Color('#faf9f5');
  const paletteLen = ARCHITECTURAL_PAPER_PALETTE.length;

  interface FaceHinge {
    px: number;
    py: number;
    pz: number;
    ax: number;
    az: number;
    /** `-1` = plinth, `0` = flat floor on ground, `>0` = wall height `H` (for walls & attached roof flaps) */
    wallH: number;
    /** Extra roof fold angle in radians (`0` for walls & vertical gables; `>0` for roof slopes/caps) */
    roofAng: number;
  }

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
    h: FaceHinge,
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
    hingePos.push(h.px, h.py, h.pz, h.px, h.py, h.pz, h.px, h.py, h.pz);
    hingeAxis.push(h.ax, 0, h.az, h.ax, 0, h.az, h.ax, 0, h.az);
    foldSpec.push(h.wallH, h.roofAng, h.wallH, h.roofAng, h.wallH, h.roofAng);
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
    h: FaceHinge,
  ) => {
    pushTri(a, b, c, rgb, ox, oy, oz, bIdx, jitter, h);
    pushTri(a, c, d, rgb, ox, oy, oz, bIdx, jitter, h);
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
    const axisWorld = (ax: number, az: number): [number, number] => [
      ax * cosY + az * sinY,
      -ax * sinY + az * cosY,
    ];
    const hw = w.W * 0.5;
    const hd = w.D * 0.5;
    const H = w.H;
    const ox = p.x;
    const oy = p.baseY;
    const oz = p.z;
    const idx = p.index;
    const jit = p.foldJitter;

    // 4 ground-edge wall hinges with exact outward-unfolding right-hand axes!
    const makeWallHinge = (lx: number, lz: number, ax: number, az: number, roofAng = 0, wallH = H): FaceHinge => {
      const [px, py, pz] = toWorld(lx, 0, lz);
      const [wax, waz] = axisWorld(ax, az);
      return { px, py, pz, ax: wax, az: waz, wallH, roofAng };
    };

    const hFloor: FaceHinge = { px: ox, py: oy, pz: oz, ax: 1, az: 0, wallH: 0, roofAng: 0 };
    const hFront = makeWallHinge(0, hd, 1, 0);
    const hBack = makeWallHinge(0, -hd, -1, 0);
    const hRight = makeWallHinge(hw, 0, 0, -1);
    const hLeft = makeWallHinge(-hw, 0, 0, 1);

    const b00 = toWorld(-hw, 0.02, -hd);
    const b10 = toWorld(hw, 0.02, -hd);
    const b11 = toWorld(hw, 0.02, hd);
    const b01 = toWorld(-hw, 0.02, hd);

    // Flat paper floor quad anchored on the ground (`wallH = 0`) — visible as a crisp flat base sheet at fold=0!
    pushQuad(b01, b11, b10, b00, floorColor, ox, oy, oz, idx, jit, hFloor);

    const f00 = toWorld(-hw, 0, -hd);
    const f10 = toWorld(hw, 0, -hd);
    const f11 = toWorld(hw, 0, hd);
    const f01 = toWorld(-hw, 0, hd);
    const t00 = toWorld(-hw, H, -hd);
    const t10 = toWorld(hw, H, -hd);
    const t11 = toWorld(hw, H, hd);
    const t01 = toWorld(-hw, H, hd);

    // 4 exterior walls hinging 90° straight up off the flat ground!
    pushQuad(f01, f11, t11, t01, rgb, ox, oy, oz, idx, jit, hFront); // front (+Z)
    pushQuad(f11, f10, t10, t11, rgb, ox, oy, oz, idx, jit, hRight); // right (+X)
    pushQuad(f10, f00, t00, t10, rgb, ox, oy, oz, idx, jit, hBack); // back (-Z)
    pushQuad(f00, f01, t01, t00, rgb, ox, oy, oz, idx, jit, hLeft); // left (-X)

    const rise = Math.max(0.45, Math.min(hw * Math.tan(Math.max(0.35, w.pitch)), H * 1.45));

    if (!includeRoofDetail && (w.roofType === 'flat' || w.roofType === 'butterfly')) {
      const hFlat = makeWallHinge(-hw, 0, 0, 1, Math.PI * 0.5);
      pushQuad(t01, t11, t10, t00, rgb, ox, oy, oz, idx, jit, hFlat);
      return;
    }

    if (w.roofType === 'flat') {
      const hFlat = makeWallHinge(-hw, 0, 0, 1, Math.PI * 0.5);
      pushQuad(t01, t11, t10, t00, rgb, ox, oy, oz, idx, jit, hFlat);
    } else if (w.roofType === 'spire') {
      const spireRise = Math.max(rise * 1.35, hw * 1.9);
      const apex = toWorld(0, H + spireRise, 0);
      const angX = Math.atan2(hw, spireRise);
      const angZ = Math.atan2(hd, spireRise);
      pushTri(t01, t11, apex, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, hd, 1, 0, angZ));
      pushTri(t11, t10, apex, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angX));
      pushTri(t10, t00, apex, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, -hd, -1, 0, angZ));
      pushTri(t00, t01, apex, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, angX));
    } else if (w.roofType === 'mansard') {
      const r = Math.max(0.24, Math.min(0.6, w.mansardRatio || 0.36));
      const mw = hw * r;
      const md = hd * r;
      const mRise = rise * 0.78;
      const mh = H + mRise;
      const m00 = toWorld(-mw, mh, -md);
      const m10 = toWorld(mw, mh, -md);
      const m11 = toWorld(mw, mh, md);
      const m01 = toWorld(-mw, mh, md);
      const angX = Math.atan2(hw - mw, mRise);
      const angZ = Math.atan2(hd - md, mRise);
      pushQuad(t01, t11, m11, m01, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, hd, 1, 0, angZ));
      pushQuad(t11, t10, m10, m11, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angX));
      pushQuad(t10, t00, m00, m10, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, -hd, -1, 0, angZ));
      pushQuad(t00, t01, m01, m00, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, angX));
      pushQuad(m01, m11, m10, m00, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, Math.PI * 0.5, mh));
    } else if (w.roofType === 'hip') {
      const ridgeHalf = Math.max(0.15, hd - hw * 0.7);
      const hRise = rise * 0.92;
      const rF = toWorld(0, H + hRise, ridgeHalf);
      const rB = toWorld(0, H + hRise, -ridgeHalf);
      const angX = Math.atan2(hw, hRise);
      const angZ = Math.atan2(Math.max(0.15, hd - ridgeHalf), hRise);
      pushTri(t01, t11, rF, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, hd, 1, 0, angZ));
      pushTri(t10, t00, rB, rgb, ox, oy, oz, idx, jit, makeWallHinge(0, -hd, -1, 0, angZ));
      pushQuad(t11, t10, rB, rF, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angX));
      pushQuad(t00, t01, rF, rB, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, angX));
    } else if (w.roofType === 'shed') {
      const sRise = rise * 0.82;
      const sh = H + sRise;
      const s00 = toWorld(-hw, sh, -hd);
      const s01 = toWorld(-hw, sh, hd);
      const angShed = Math.atan2(w.W, sRise);
      pushTri(t01, t11, s01, rgb, ox, oy, oz, idx, jit, hFront);
      pushTri(t10, t00, s00, rgb, ox, oy, oz, idx, jit, hBack);
      pushQuad(t00, t01, s01, s00, rgb, ox, oy, oz, idx, jit, hLeft);
      pushQuad(s01, t11, t10, s00, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angShed));
    } else if (w.roofType === 'butterfly') {
      const bRise = rise * 0.6;
      const bh = H + bRise;
      const bL0 = toWorld(-hw, bh, -hd);
      const bL1 = toWorld(-hw, bh, hd);
      const bR0 = toWorld(hw, bh, -hd);
      const bR1 = toWorld(hw, bh, hd);
      const vF = toWorld(0, H, hd);
      const vB = toWorld(0, H, -hd);
      const angButt = Math.PI * 0.5 + Math.atan2(bRise, hw);
      pushQuad(bL1, vF, vB, bL0, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, angButt, bh));
      pushQuad(vF, bR1, bR0, vB, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angButt, bh));
      pushTri(t01, vF, bL1, rgb, ox, oy, oz, idx, jit, hFront);
      pushTri(vF, t11, bR1, rgb, ox, oy, oz, idx, jit, hFront);
      pushTri(t10, vB, bR0, rgb, ox, oy, oz, idx, jit, hBack);
      pushTri(vB, t00, bL0, rgb, ox, oy, oz, idx, jit, hBack);
    } else {
      // Classic gable / stepped / gambrel / sawtooth pitched ridge:
      // Triangular gable peaks stay coplanar with front/back walls (`roofAng = 0`), while the two
      // pitched roof flaps hinge smoothly off the left & right wall eaves!
      const rF = toWorld(0, H + rise, hd);
      const rB = toWorld(0, H + rise, -hd);
      const angGable = Math.atan2(hw, rise);
      pushTri(t01, t11, rF, rgb, ox, oy, oz, idx, jit, hFront);
      pushTri(t10, t00, rB, rgb, ox, oy, oz, idx, jit, hBack);
      pushQuad(t11, t10, rB, rF, rgb, ox, oy, oz, idx, jit, makeWallHinge(hw, 0, 0, -1, angGable));
      pushQuad(t00, t01, rF, rB, rgb, ox, oy, oz, idx, jit, makeWallHinge(-hw, 0, 0, 1, angGable));
    }
  };

  for (const p of plots) {
    const cosY = Math.cos(p.yaw);
    const sinY = Math.sin(p.yaw);

    // 1. Retaining plinth extending below lowest hillside corner (`wallH = -1`)
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
    const hPlinth: FaceHinge = { px: p.x, py: p.baseY, pz: p.z, ax: 1, az: 0, wallH: -1, roofAng: 0 };

    pushQuad(pb01, pb11, pt11, pt01, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter, hPlinth);
    pushQuad(pb11, pb10, pt10, pt11, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter, hPlinth);
    pushQuad(pb10, pb00, pt00, pt10, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter, hPlinth);
    pushQuad(pb00, pb01, pt01, pt00, plinthColor, p.x, p.baseY, p.z, p.index, p.foldJitter, hPlinth);

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
  geo.setAttribute('aHingePos', new THREE.Float32BufferAttribute(hingePos, 3));
  geo.setAttribute('aHingeAxis', new THREE.Float32BufferAttribute(hingeAxis, 3));
  geo.setAttribute('aFoldSpec', new THREE.Float32BufferAttribute(foldSpec, 2));
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius += 14;
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

const MAX_CITY_BOATS = 160;

interface MountedLod0Building {
  plot: CityBuildingPlot;
  rig: OrigamiHouseRig;
  wrapper: THREE.Group;
  plinth: THREE.Mesh;
  plinthW: number;
  plinthD: number;
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
  /** Per-chunk LOD material allocated ONLY for Tier-0 chunks (Tier 1 & Tier 2 share static materials!) */
  lodMat: THREE.MeshStandardMaterial | null;
  lodGeo: THREE.BufferGeometry | null;
  lodActiveMask: Float32Array;
  lod0Map: Map<number, MountedLod0Building>;
}

interface SmokePuff {
  active: boolean;
  isFog: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  rot: number;
  vRot: number;
  seed: number;
  peakAlpha: number;
}

export interface CityViewStats {
  active: boolean;
  seed: number;
  style: CityStreetStyle;
  hills: number;
  flying: boolean;
  waveMode: CityWaveMode;
  smokeEnabled: boolean;
  flightS: number;
  camPos: [number, number, number];
  activeChunks: number;
  lod0Buildings: number;
  lod1Buildings: number;
  lod2Buildings: number;
  totalPlots: number;
  rooftopCount: number;
  activeSmokePuffs: number;
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

  // Shared LOD0 OrigamiMaterials pool (8 architectural paper tones sharing 1 washi texture pair, zero projection overhead!)
  private readonly matPool: OrigamiMaterials[] = [];
  private readonly ownedWashiTex: WashiFiberTextures | null;
  private readonly smokeNoiseTex: THREE.DataTexture;
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
  private readonly unitPlinthGeo: THREE.BoxGeometry;
  private readonly sharedTier1LodMat: THREE.MeshStandardMaterial;
  private readonly sharedTier2LodMat: THREE.MeshStandardMaterial;
  /** Shared custom shadow depth material fading LOD0 shadows smoothly from 0% (flat) -> 100% (~42 deg) with zero pop! */
  private readonly cityShadowDepthMat: THREE.MeshDepthMaterial;

  // Single-draw-call instanced coastal origami sailboats across ALL active chunks!
  private readonly boatsInstancedMesh: THREE.InstancedMesh;
  private readonly activeBoats: CityBoat[] = [];
  private boatsDirty = false;
  private readonly tmpBoatDummy = new THREE.Object3D();

  // Infinite camera-following folded paper sea
  private readonly seaMesh: THREE.Mesh;
  private readonly seaMat: THREE.MeshStandardMaterial;

  // Single-draw-call volumetric camera-facing fBm real smoke & drifting coastal sea-fog banks!
  private readonly smokeMesh: THREE.Mesh;
  private readonly smokeGeo: THREE.InstancedBufferGeometry;
  private readonly smokeMat: THREE.ShaderMaterial;
  private readonly smokePosBuf: Float32Array;
  private readonly smokeDataBuf: Float32Array;
  private readonly smokeStyleBuf: Float32Array;
  private readonly smokePosAttr: THREE.InstancedBufferAttribute;
  private readonly smokeDataAttr: THREE.InstancedBufferAttribute;
  private readonly smokeStyleAttr: THREE.InstancedBufferAttribute;
  private readonly smokeUniforms: {
    uNoiseTex: { value: THREE.DataTexture | null };
    uColorMix: { value: number };
    uFogColor: { value: THREE.Color };
    uFogDensity: { value: number };
  } = {
    uNoiseTex: { value: null },
    uColorMix: { value: 0 },
    uFogColor: { value: new THREE.Color(BACKDROP) },
    uFogDensity: { value: CITY_FOG_DENSITY },
  };
  private readonly tmpV1 = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly smokePuffs: SmokePuff[] = [];
  private readonly smokeOrder: number[] = [];
  private readonly smokeDepths = new Float32Array(MAX_SMOKE_PUFFS);
  private smokeCursor = 0;
  private smokeActiveCount = 0;
  private smokeRandState = 1337;
  private fogEmitAccum = 0;
  private readonly seaUniforms = {
    uTime: { value: 0 },
    uColorMix: { value: 0 },
    uCoastA: { value: new THREE.Vector4(21, 13, 7, 3) },
    uCoastF: { value: new THREE.Vector4(0.0041, 0.0097, 0.0183, 0.0317) },
    uCoastP: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  private readonly terrainUniforms = {
    uBeachColor: { value: new THREE.Color('#e6d6b8') },
    uWetSandColor: { value: new THREE.Color('#d2be98') },
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
  private smokeEnabled = false;
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

  constructor(
    maxAnisotropy: number,
    envTexture: THREE.Texture | null,
    callbacks: CityViewCallbacks = {},
    sharedWashiTextures?: WashiFiberTextures,
  ) {
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.FogExp2(BACKDROP, CITY_FOG_DENSITY);
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

    this.terrainMat = this.createCoastalTerrainMaterial();

    // Build shared OrigamiMaterials pool across ALL 8 architectural paper tones sharing ONE washi texture pair
    // with projection shaders disabled & single-pass duplex shaders (flat edges suppressed, 3× fewer draw calls!)
    this.ownedWashiTex = sharedWashiTextures ? null : createWashiFiberTextures(maxAnisotropy);
    const washiTex = sharedWashiTextures ?? this.ownedWashiTex!;
    const poolSize = ARCHITECTURAL_PAPER_PALETTE.length;
    for (let i = 0; i < poolSize; i++) {
      this.matPool.push(
        createOrigamiMaterials(maxAnisotropy, {
          enableProjection: false,
          sharedTextures: washiTex,
          singlePassDuplex: true,
          flatGroundColor: this.terrainMat.color,
        }),
      );
    }

    this.cityShadowDepthMat = this.createSmoothCityShadowDepthMaterial();
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
    this.unitPlinthGeo = new THREE.BoxGeometry(1, 1, 1);
    this.sharedTier1LodMat = this.createChunkLodBuildingMaterial(null, 1);
    this.sharedTier2LodMat = this.createChunkLodBuildingMaterial(null, 2);

    this.boatsInstancedMesh = new THREE.InstancedMesh(this.sailboatGeo, this.boatMat, MAX_CITY_BOATS);
    this.boatsInstancedMesh.count = 0;
    this.boatsInstancedMesh.castShadow = true;
    this.boatsInstancedMesh.receiveShadow = true;
    this.boatsInstancedMesh.frustumCulled = false;
    this.scene.add(this.boatsInstancedMesh);

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

    // Volumetric camera-facing fBm real smoke plumes (where houses fold up) + drifting coastal sea-fog banks!
    const baseQuad = new THREE.PlaneGeometry(1, 1);
    this.smokeGeo = new THREE.InstancedBufferGeometry();
    this.smokeGeo.index = baseQuad.index;
    this.smokeGeo.attributes.position = baseQuad.attributes.position;
    this.smokeGeo.attributes.uv = baseQuad.attributes.uv;
    this.smokePosBuf = new Float32Array(MAX_SMOKE_PUFFS * 3);
    this.smokeDataBuf = new Float32Array(MAX_SMOKE_PUFFS * 4);
    this.smokeStyleBuf = new Float32Array(MAX_SMOKE_PUFFS * 2);
    this.smokePosAttr = new THREE.InstancedBufferAttribute(this.smokePosBuf, 3);
    this.smokeDataAttr = new THREE.InstancedBufferAttribute(this.smokeDataBuf, 4);
    this.smokeStyleAttr = new THREE.InstancedBufferAttribute(this.smokeStyleBuf, 2);
    this.smokePosAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeDataAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeStyleAttr.setUsage(THREE.DynamicDrawUsage);
    this.smokeGeo.setAttribute('aInstPos', this.smokePosAttr);
    this.smokeGeo.setAttribute('aInstData', this.smokeDataAttr);
    this.smokeGeo.setAttribute('aInstStyle', this.smokeStyleAttr);
    this.smokeGeo.instanceCount = 0;

    this.smokeNoiseTex = this.createSeamlessSmokeNoiseTexture();
    this.smokeUniforms.uNoiseTex.value = this.smokeNoiseTex;
    this.smokeMat = this.createRealSmokeMaterial();
    this.smokeMesh = new THREE.Mesh(this.smokeGeo, this.smokeMat);
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 4;
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      this.smokePuffs.push({
        active: false,
        isFog: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        maxAge: 1,
        startScale: 2,
        endScale: 6,
        rot: 0,
        vRot: 0,
        seed: 0,
        peakAlpha: 0.5,
      });
    }
    this.scene.add(this.smokeMesh);

    this.applyLightingAndColors();
  }

  /**
   * Pre-bake a seamless tileable `256×256` RGBA multi-octave fBm texture ONCE at startup
   * so the volumetric smoke fragment shader uses 3 fast hardware bilinear taps instead of 16 ALU octaves!
   */
  private createSeamlessSmokeNoiseTexture(): THREE.DataTexture {
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    const hashP = (ix: number, iy: number, period: number, seed: number): number => {
      const wx = ((ix % period) + period) % period;
      const wy = ((iy % period) + period) % period;
      let h = (Math.imul(wx, 374761393) + Math.imul(wy, 668265263) + Math.imul(seed, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const tileNoise = (u: number, v: number, period: number, seed: number): number => {
      const x = u * period;
      const y = v * period;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const a = hashP(ix, iy, period, seed);
      const b = hashP(ix + 1, iy, period, seed);
      const c = hashP(ix, iy + 1, period, seed);
      const d = hashP(ix + 1, iy + 1, period, seed);
      return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    };
    const tileFbm = (u: number, v: number, basePeriod: number, seed: number): number => {
      let sum = 0;
      let amp = 0.5;
      let p = basePeriod;
      let norm = 0;
      for (let o = 0; o < 4; o++) {
        sum += amp * tileNoise(u, v, p, seed + o * 31);
        norm += amp;
        amp *= 0.5;
        p *= 2;
      }
      return sum / norm;
    };

    for (let y = 0; y < N; y++) {
      const v = y / N;
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const o = (y * N + x) * 4;
        data[o] = Math.round(tileFbm(u, v, 4, 17) * 255);
        data[o + 1] = Math.round(tileFbm(u, v, 4, 97) * 255);
        data[o + 2] = Math.round(tileFbm(u, v, 8, 211) * 255);
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Shared custom shadow depth material for City LOD0 origami panels:
   * computes each panel's true world lift angle (`acos(panelUp.y)`) and applies a 4×4 ordered Bayer
   * dither filtered by PCFSoftShadowMap so shadows stay 0% while flat on the floor (`0..6°`) and
   * darken seamlessly from `0% -> 100%` over `6°..42°` with ZERO binary shadow pop!
   */
  private createSmoothCityShadowDepthMaterial(): THREE.MeshDepthMaterial {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mat.customProgramCacheKey = () => 'coastal-city-smooth-shadow-depth-v1';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vPanelAngle;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec3 panelWorldUp = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vPanelAngle = acos(clamp(panelWorldUp.y, -1.0, 1.0));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vPanelAngle;
float bayer4x4Shadow(vec2 fc) {
  vec2 p = mod(floor(fc), 4.0);
  float x0 = mod(p.x, 2.0);
  float y0 = mod(p.y, 2.0);
  float x1 = floor(p.x * 0.5);
  float y1 = floor(p.y * 0.5);
  float m0 = 2.0 * abs(x0 - y0) + y0;
  float m1 = 2.0 * abs(x1 - y1) + y1;
  return (4.0 * m0 + m1 + 0.5) / 16.0;
}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
float shadowVis = smoothstep(0.11, 0.74, vPanelAngle);
if (shadowVis <= 0.001) discard;
if (shadowVis < 0.999 && shadowVis < bayer4x4Shadow(gl_FragCoord.xy)) discard;`,
        );
    };
    return mat;
  }

  /**
   * Real procedural volumetric smoke & sea-mist billboard shader backed by a pre-baked seamless fBm texture:
   *  - 3 fast bilinear texture lookups (domain warp + cloud + directional sun-tap self-shadowing!)
   *  - Exponential coastal distance fog matching `FogExp2` + near-lens fade so mist never pops!
   */
  private createRealSmokeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: this.smokeUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexShader: /* glsl */ `
        attribute vec3 aInstPos;
        attribute vec4 aInstData;  // (size, rot, alpha, age01)
        attribute vec2 aInstStyle; // (seed, isFog)
        varying vec2 vUv;
        varying float vAlpha;
        varying float vAge01;
        varying float vSeed;
        varying float vIsFog;
        varying float vFogDepth;

        void main() {
          vUv = uv;
          vAlpha = aInstData.z;
          vAge01 = aInstData.w;
          vSeed = aInstStyle.x;
          vIsFog = aInstStyle.y;

          vec4 mvCenter = modelViewMatrix * vec4(aInstPos, 1.0);
          float c = cos(aInstData.y);
          float s = sin(aInstData.y);
          vec2 aspect = mix(vec2(1.08, 1.04), vec2(2.65, 0.72), vIsFog);
          vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aspect * aInstData.x;
          vec4 mvPos = mvCenter + vec4(corner, 0.0, 0.0);
          vFogDepth = max(0.0, -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoiseTex;
        uniform float uColorMix;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vAge01;
        varying float vSeed;
        varying float vIsFog;
        varying float vFogDepth;

        void main() {
          if (vAlpha < 0.004) discard;
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;

          vec2 seedOff = vec2(fract(vSeed * 0.173), fract(vSeed * 0.291));
          float scale = mix(0.42, 0.30, vIsFog);
          vec2 baseUv = p * scale + seedOff;
          vec2 drift = vec2(vAge01 * 0.04, -vAge01 * 0.11);

          // 3 ultra-fast hardware bilinear fBm lookups (domain warp + cloud + directional sun self-shadow!)
          vec3 warpTap = texture2D(uNoiseTex, baseUv * 0.85).rgb;
          vec2 warpedUv = baseUv + (warpTap.rg - 0.5) * 0.28 + drift;
          vec3 cloudTap = texture2D(uNoiseTex, warpedUv).rgb;
          float cloud = cloudTap.r * 0.72 + cloudTap.b * 0.28;

          // Soft feathery radial falloff shaped organically by the fBm turbulence
          float radial = smoothstep(0.98, 0.14, r + (0.48 - cloud) * 0.62);
          float wispy = smoothstep(0.22, 0.78, cloud);
          float nearFade = smoothstep(4.5, 15.0, vFogDepth);
          float alpha = radial * wispy * vAlpha * nearFade;
          if (alpha < 0.005) discard;

          // Soft directional sunlit highlight on pure white dust (zero dark/soot/fire tones!)
          vec3 sunTap = texture2D(uNoiseTex, warpedUv + vec2(0.065, 0.085)).rgb;
          float sunCloud = sunTap.r * 0.72 + sunTap.b * 0.28;
          float lit = clamp(0.58 + (cloud - sunCloud) * 1.45 + p.y * 0.24, 0.0, 1.0);

          // Pure white chalk/plaster dust smoke: luminous bright white crest, whisper-soft warm-white belly
          vec3 dustShadow = vec3(0.915, 0.910, 0.896);
          vec3 dustLight = vec3(1.000, 0.998, 0.994);
          vec3 smokeCol = mix(dustShadow, dustLight, lit);

          vec3 fogBankCol = mix(vec3(0.968, 0.965, 0.954), vec3(0.955, 0.968, 0.970), uColorMix);
          vec3 col = mix(smokeCol, fogBankCol, vIsFog);

          // Match exact #f5f4f0 sRGB coastal studio backdrop so distant smoke dissolves seamlessly into FogExp2!
          vec3 studioFogRgb = vec3(0.960784, 0.956863, 0.941176);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          col = mix(col, studioFogRgb, clamp(fogFactor * 0.88, 0.0, 1.0));
          alpha *= (1.0 - clamp(fogFactor * 0.72, 0.0, 0.92));

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }

  private nextSmokeRand(): number {
    this.smokeRandState = (Math.imul(this.smokeRandState, 1664525) + 1013904223) >>> 0;
    return this.smokeRandState / 4294967296;
  }

  private clearSmoke(): void {
    this.smokeActiveCount = 0;
    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      this.smokePuffs[i].active = false;
    }
    this.smokeGeo.instanceCount = 0;
  }

  private spawnSmokePuff(
    isFog: boolean,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    startScale: number,
    endScale: number,
    maxAge: number,
    peakAlpha: number,
  ): void {
    const p = this.smokePuffs[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE_PUFFS;
    p.active = true;
    p.isFog = isFog;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.maxAge = maxAge;
    p.startScale = startScale;
    p.endScale = endScale;
    p.rot = this.nextSmokeRand() * Math.PI * 2;
    p.vRot = (this.nextSmokeRand() - 0.5) * (isFog ? 0.08 : 0.65);
    p.seed = this.nextSmokeRand() * 100.0;
    p.peakAlpha = peakAlpha;
  }

  private updateSmoke(dt: number): void {
    const fx = this.waveFocus.x;
    const fz = this.waveFocus.y;
    const camX = this.curCamPos.x;
    const camY = this.curCamPos.y;
    const camZ = this.curCamPos.z;

    // 1. Emit billowing pure-white ground dust where houses fold up (only when Smoke setting is enabled!)
    if (this.smokeEnabled && this.waveMode === 'wave') {
      for (const ch of this.chunks.values()) {
        if (ch.tier > 1) continue;
        if (Math.hypot(ch.data.centerX - camX, ch.data.centerZ - camZ) > 215) continue;
        for (const plot of ch.data.plots) {
          const f = evaluateFoldWave(plot.x, plot.z, plot.foldJitter, fx, fz, this.waveMode);
          if (f <= 0.03 || f >= 0.95) continue;
          const activity = Math.sin(f * Math.PI);
          // Fine white ground dust rolling outward along base creases & rising softly as walls hinge up!
          const prob = activity * 7.2 * dt;
          if (this.nextSmokeRand() < prob) {
            const ang = this.nextSmokeRand() * Math.PI * 2;
            const fpRad = Math.max(plot.footprintW, plot.footprintD) * (0.32 + this.nextSmokeRand() * 0.44);
            const sx = plot.x + Math.cos(ang) * fpRad;
            const sz = plot.z + Math.sin(ang) * fpRad;
            const sy = plot.baseY + 0.18 + f * 1.25 + this.nextSmokeRand() * 0.45;
            const outSpeed = 1.05 + this.nextSmokeRand() * 1.55;
            const vx = Math.cos(ang) * outSpeed + 0.65; // gentle onshore sea breeze!
            const vz = Math.sin(ang) * outSpeed - 0.25;
            const vy = 0.85 + this.nextSmokeRand() * 1.15;
            const s0 = 1.9 + this.nextSmokeRand() * 1.4;
            const s1 = s0 * (2.5 + this.nextSmokeRand() * 1.15);
            const maxAge = 1.8 + this.nextSmokeRand() * 1.3;
            const peak = (0.56 + this.nextSmokeRand() * 0.26) * (0.68 + 0.32 * activity);
            this.spawnSmokePuff(false, sx, sy, sz, vx, vy, vz, s0, s1, maxAge, peak);
          }
        }
      }
    }

    // 2. Emit soft, wide drifting coastal sea-fog banks lazily skimming the shoreline & hillsides!
    if (this.world) {
      this.fogEmitAccum += dt * 7.5;
      while (this.fogEmitAccum >= 1) {
        this.fogEmitAccum -= 1;
        const zAhead = camZ - (35 + this.nextSmokeRand() * 175);
        const cX = this.world.terrain.coastX(zAhead);
        const xOff = (this.nextSmokeRand() - 0.38) * 115; // straddles coves, shoreline & rolling hills!
        const fxPos = cX + xOff;
        const groundY = Math.max(0, this.world.terrain.heightAt(fxPos, zAhead));
        const fyPos = groundY + 1.8 + this.nextSmokeRand() * 6.5;
        const s0 = 15 + this.nextSmokeRand() * 11;
        const s1 = s0 * 1.45;
        this.spawnSmokePuff(
          true,
          fxPos,
          fyPos,
          zAhead,
          0.95 + this.nextSmokeRand() * 0.75,
          0.08 + this.nextSmokeRand() * 0.14,
          (this.nextSmokeRand() - 0.5) * 0.5,
          s0,
          s1,
          5.5 + this.nextSmokeRand() * 3.5,
          0.22 + this.nextSmokeRand() * 0.14,
        );
      }
    }

    // 3. Advance smoke & fog physics + collect active indices for back-to-front depth sorting
    const drag = Math.exp(-0.95 * dt);
    this.smokeOrder.length = 0;

    for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
      const p = this.smokePuffs[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      if (!p.isFog) {
        p.vx *= drag;
        p.vz *= drag;
        p.vy = p.vy * Math.exp(-0.42 * dt) + 0.16 * dt;
        // Subtle curling swirl turbulence as real smoke rises
        const swirl = Math.sin(p.age * 2.2 + p.seed) * 0.55;
        p.x += (p.vx + swirl) * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      p.rot += p.vRot * dt;

      const dx = p.x - camX;
      const dy = p.y - camY;
      const dz = p.z - camZ;
      this.smokeDepths[i] = dx * dx + dy * dy + dz * dz;
      this.smokeOrder.push(i);
    }

    // Sort back-to-front so layered volumetric plumes & coastal fog composite silkily with zero popping!
    const depths = this.smokeDepths;
    this.smokeOrder.sort((a, b) => depths[b] - depths[a]);

    const count = this.smokeOrder.length;
    for (let k = 0; k < count; k++) {
      const p = this.smokePuffs[this.smokeOrder[k]];
      const u = p.age / p.maxAge;
      const scaleEase = 1 - Math.pow(1 - u, 2.0);
      const sc = p.startScale + (p.endScale - p.startScale) * scaleEase;
      const fadeIn = smoothstep(0.0, p.isFog ? 0.25 : 0.12, u);
      const fadeOut = Math.pow(1 - smoothstep(p.isFog ? 0.55 : 0.28, 1.0, u), 1.4);
      const alpha = p.peakAlpha * fadeIn * fadeOut;

      const p3 = k * 3;
      this.smokePosBuf[p3] = p.x;
      this.smokePosBuf[p3 + 1] = p.y;
      this.smokePosBuf[p3 + 2] = p.z;

      const d4 = k * 4;
      this.smokeDataBuf[d4] = sc;
      this.smokeDataBuf[d4 + 1] = p.rot;
      this.smokeDataBuf[d4 + 2] = alpha;
      this.smokeDataBuf[d4 + 3] = u;

      const s2 = k * 2;
      this.smokeStyleBuf[s2] = p.seed;
      this.smokeStyleBuf[s2 + 1] = p.isFog ? 1.0 : 0.0;
    }

    this.smokeActiveCount = count;
    this.smokeGeo.instanceCount = count;
    this.smokePosAttr.needsUpdate = true;
    this.smokeDataAttr.needsUpdate = true;
    this.smokeStyleAttr.needsUpdate = true;
  }

  private prewarmWaveSmoke(): void {
    this.clearSmoke();
    for (let step = 0; step < 12; step++) {
      this.updateSmoke(0.22);
    }
  }

  /**
   * Sculpted coastal paper terrain with a warm sand-beige beach ribbon hugging the curving shoreline,
   * subtle damp shoreline sand kissing the waves, and sandy beaches around offshore islets!
   */
  private createCoastalTerrainMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#f5f4f0',
      roughness: 0.95,
      metalness: 0.0,
    });
    mat.customProgramCacheKey = () => 'coastal-paper-terrain-beach-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCoastA = this.seaUniforms.uCoastA;
      shader.uniforms.uCoastF = this.seaUniforms.uCoastF;
      shader.uniforms.uCoastP = this.seaUniforms.uCoastP;
      shader.uniforms.uBeachColor = this.terrainUniforms.uBeachColor;
      shader.uniforms.uWetSandColor = this.terrainUniforms.uWetSandColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vTerrainWorldPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec4 uCoastA;
uniform vec4 uCoastF;
uniform vec4 uCoastP;
uniform vec3 uBeachColor;
uniform vec3 uWetSandColor;
varying vec3 vTerrainWorldPos;
float evalTerrainCoastX(float z) {
  return uCoastA.x * sin(z * uCoastF.x + uCoastP.x)
       + uCoastA.y * sin(z * uCoastF.y + uCoastP.y)
       + uCoastA.z * cos(z * uCoastF.z + uCoastP.z)
       + uCoastA.w * sin(z * uCoastF.w + uCoastP.w);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float tCoastX = evalTerrainCoastX(vTerrainWorldPos.z);
float tInland = vTerrainWorldPos.x - tCoastX;
// Warm beige paper beach extending cleanly from water edge to coastal promenade (slightly wider in sheltered coves!)
float coveWiden = smoothstep(-6.0, 22.0, tCoastX) * 1.8 + sin(vTerrainWorldPos.z * 0.055) * 0.55;
float mainBeach = (1.0 - smoothstep(5.4 + coveWiden * 0.35, 7.6 + coveWiden, tInland))
                * smoothstep(-4.5, -0.2, tInland);
// Sandy beige shore around offshore paper islets too!
float isletBeach = step(tInland, -6.0) * (1.0 - smoothstep(0.45, 2.2, vTerrainWorldPos.y));
float beachMask = clamp(max(mainBeach, isletBeach), 0.0, 1.0);
// Damp darker sand kiss right where the blue paper sea laps the beach
float wetMask = (1.0 - smoothstep(0.02, 0.34, vTerrainWorldPos.y))
              * smoothstep(-1.4, 0.04, vTerrainWorldPos.y)
              * beachMask;
vec3 sandRgb = mix(uBeachColor, uWetSandColor, wetMask * 0.72);
diffuseColor.rgb = mix(diffuseColor.rgb, sandRgb, beachMask);`,
        );
    };
    return mat;
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

          // Tactile Japanese origami paper-blue sea in White Mode: serene matte sky/cerulean paper with crisp white wave rings!
          vec3 whiteDeep = vec3(0.275, 0.485, 0.665);
          vec3 whiteShallow = vec3(0.445, 0.655, 0.775);
          vec3 whiteFoam = vec3(0.960, 0.955, 0.938);
          vec3 whiteSea = mix(whiteDeep, whiteShallow, shallow);
          whiteSea = mix(whiteSea, whiteFoam, clamp(foamLine * 0.80 + shoreEdge * 0.88, 0.0, 1.0));

          // Architectural Coastal Color Mode: richer Nordic/Mediterranean cobalt-cerulean paper sea
          vec3 colDeep = vec3(0.185, 0.390, 0.575);
          vec3 colShallow = vec3(0.355, 0.575, 0.695);
          vec3 colFoam = vec3(0.945, 0.938, 0.912);
          vec3 colorSea = mix(colDeep, colShallow, shallow);
          colorSea = mix(colorSea, colFoam, clamp(foamLine * 0.84 + shoreEdge * 0.92, 0.0, 1.0));

          diffuseColor.rgb *= mix(whiteSea, colorSea, uColorMix);`,
        );
    };
    return mat;
  }

  private createChunkLodBuildingMaterial(
    lodActiveMask: Float32Array | null,
    tier: 1 | 2,
  ): THREE.MeshStandardMaterial {
    const hasLodMask = lodActiveMask !== null;
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: tier === 1 ? 0.93 : 0.96,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    mat.customProgramCacheKey = () =>
      hasLodMask ? 'coastal-city-lod-origami-v2' : 'coastal-city-lod-static-v2';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaveFocus = this.sharedLodUniforms.uWaveFocus;
      shader.uniforms.uWaveMode = this.sharedLodUniforms.uWaveMode;
      shader.uniforms.uColorMix = this.sharedLodUniforms.uColorMix;
      shader.uniforms.uWhitePaperColor = this.sharedLodUniforms.uWhitePaperColor;
      if (hasLodMask) {
        shader.uniforms.uLod0Active = { value: lodActiveMask };
      }

      const lodMaskUniforms = hasLodMask
        ? `uniform float uLod0Active[${MAX_LOD_PLOTS_PER_CHUNK}];
          varying float vLodCull;`
        : '';

      const lodMaskLookup = hasLodMask
        ? `int bIdx = int(floor(aBuildMeta.x + 0.5));
          float lod0Flag = 0.0;
          if (bIdx >= 0 && bIdx < ${MAX_LOD_PLOTS_PER_CHUNK}) {
            lod0Flag = uLod0Active[bIdx];
          }
          vLodCull = lod0Flag;`
        : `float lod0Flag = 0.0;`;

      let vs = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aBuildOrigin;
          attribute vec2 aBuildMeta;
          attribute vec3 aHingePos;
          attribute vec3 aHingeAxis;
          attribute vec2 aFoldSpec;
          uniform vec2 uWaveFocus;
          uniform float uWaveMode;
          ${lodMaskUniforms}
          varying float vIsFloorOrPlinth;

          vec3 rotAxisOrigami(vec3 v, vec3 k, float theta) {
            float c = cos(theta);
            float s = sin(theta);
            return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
          }

          float evalCityFoldWave(vec3 origin, float jitter) {
            if (uWaveMode > 1.5) return 0.0;
            if (uWaveMode > 0.5) return 1.0;
            float dFwd = uWaveFocus.y - origin.z;
            float dLat = abs(origin.x - uWaveFocus.x);
            float wMetric = dFwd + 0.24 * dLat + jitter;
            return 1.0 - smoothstep(${WAVE_NEAR.toFixed(1)}, ${WAVE_FAR.toFixed(1)}, wMetric);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float nFoldVal = evalCityFoldWave(aBuildOrigin, aBuildMeta.y);
          float nWallFold = smoothstep(0.0, 0.72, nFoldVal);
          float nRoofFold = smoothstep(0.28, 1.0, nFoldVal);
          if (aFoldSpec.x > 0.0) {
            if (aFoldSpec.y > 0.001) {
              objectNormal = rotAxisOrigami(objectNormal, aHingeAxis, (1.0 - nRoofFold) * aFoldSpec.y);
            }
            objectNormal = rotAxisOrigami(objectNormal, aHingeAxis, (1.0 - nWallFold) * 1.5707963);
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          ${lodMaskLookup}
          vIsFloorOrPlinth = aFoldSpec.x <= 0.0 ? 1.0 : 0.0;

          float fVal = evalCityFoldWave(aBuildOrigin, aBuildMeta.y);
          float wallFold = smoothstep(0.0, 0.72, fVal);
          float roofFold = smoothstep(0.28, 1.0, fVal);

          if (lod0Flag > 0.5) {
            transformed = aBuildOrigin;
          } else if (aFoldSpec.x > 0.0) {
            // Real 2-bone origami hinge fold: roof flap hinges off moving eave, wall hinges 90° off flat ground!
            vec3 pt = transformed;
            if (aFoldSpec.y > 0.001) {
              vec3 eavePivot = aHingePos + vec3(0.0, aFoldSpec.x, 0.0);
              pt = eavePivot + rotAxisOrigami(pt - eavePivot, aHingeAxis, (1.0 - roofFold) * aFoldSpec.y);
            }
            pt = aHingePos + rotAxisOrigami(pt - aHingePos, aHingeAxis, (1.0 - wallFold) * 1.5707963);
            // Tiny 0.025 ground-lift epsilon when flat so laid-out paper nets never z-fight the hillside!
            pt.y += (1.0 - wallFold) * 0.025;
            transformed = pt;
          } else if (aFoldSpec.x < -0.5) {
            // Retaining plinth stays tucked flush beneath flat paper until walls start lifting
            float pRise = smoothstep(0.06, 0.48, wallFold);
            vec3 rel = transformed - aBuildOrigin;
            rel.y *= pRise;
            if (pRise < 0.01) rel.xz *= 0.0;
            transformed = aBuildOrigin + rel;
          }`,
        );

      if (hasLodMask) {
        vs = vs.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          if (vLodCull > 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }`,
        );
      }
      shader.vertexShader = vs;

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uColorMix;
          uniform vec3 uWhitePaperColor;
          varying float vIsFloorOrPlinth;`,
        )
        .replace(
          '#include <color_fragment>',
          `#if defined( USE_COLOR_ALPHA )
            diffuseColor *= vColor;
          #elif defined( USE_COLOR )
            // Authentic duplex origami paper: flat unfolded inside faces (!gl_FrontFacing) show crisp
            // warm cotton white, flipping to the pastel/architectural exterior color as walls hinge up!
            vec3 paperRgb = (gl_FrontFacing || vIsFloorOrPlinth > 0.5)
              ? mix(uWhitePaperColor, vColor.rgb, uColorMix)
              : uWhitePaperColor;
            diffuseColor.rgb *= paperRgb;
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

  public isSmokeEnabled(): boolean {
    return this.smokeEnabled;
  }

  public setSmokeEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.smokeEnabled === next) return;
    this.smokeEnabled = next;
    if (!next) {
      // Immediately clear folding dust puffs while preserving subtle horizon coastal mist
      for (let i = 0; i < MAX_SMOKE_PUFFS; i++) {
        if (!this.smokePuffs[i].isFog) this.smokePuffs[i].active = false;
      }
      this.updateSmoke(0);
    } else if (this.waveMode === 'wave') {
      this.prewarmWaveSmoke();
    }
    this.emitStats();
  }

  public setSpinEnabled(_enabled: boolean): void {
    // Retained for API symmetry; coastal flight replaces stationary turntable spin
  }

  public setFlying(flying: boolean): void {
    if (this.flying === flying) return;
    this.flying = flying;
    if (!flying) {
      // Seamless handoff into Free Orbit from the exact current glider lens!
      const lookDir = this.tmpV1.subVectors(this.curCamPos, this.curLookAt);
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
    if (mode === 'flat') this.clearSmoke();
    else if (mode === 'wave') this.prewarmWaveSmoke();
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
      this.updateBoats(this.elapsedTime);
      this.prewarmWaveSmoke();
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
    this.smokeUniforms.uColorMix.value = this.colorEnabled ? 1 : 0;

    if (this.colorEnabled) {
      this.hemi.color.set('#fffdf8');
      this.hemi.groundColor.set('#dfd9cf');
      this.hemi.intensity = 1.52;
      this.sun.color.set('#fffdf9');
      this.sun.intensity = 1.24;
      this.fill.intensity = 0.24;
      this.terrainMat.color.set('#f3f0e8');
      this.terrainUniforms.uBeachColor.value.set('#e5d2ae');
      this.terrainUniforms.uWetSandColor.value.set('#cbb286');
      this.streetMat.color.set('#e5e1d7');
      this.promenadeMat.color.set('#e2d6bf');
      this.plazaMat.color.set('#e9e6dd');
      this.plinthMat.color.set('#ece8df');
      this.pierMat.color.set('#e2d5bc');
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
      this.terrainUniforms.uBeachColor.value.set('#e7d8bc');
      this.terrainUniforms.uWetSandColor.value.set('#d2be99');
      this.streetMat.color.set('#e7e4dc');
      this.promenadeMat.color.set('#e5dac5');
      this.plazaMat.color.set('#eae7df');
      this.plinthMat.color.set('#efede6');
      this.pierMat.color.set('#e6dcc9');
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
    this.boatsDirty = true;
  }

  private clearAllChunks(): void {
    for (const ch of this.chunks.values()) {
      this.disposeChunk(ch);
    }
    this.chunks.clear();
    this.plotLookup.clear();
    this.pickableMeshes = [];
    this.pickablesDirty = false;
    this.activeBoats.length = 0;
    this.boatsInstancedMesh.count = 0;
    this.boatsDirty = false;
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
    this.updateBoats(this.elapsedTime);
    this.prewarmWaveSmoke();
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

    // 1. Sculpted terrain mesh with LOD-matched resolution & downward zero-crack border skirts
    // Keep Tier 0 & Tier 1 visuals 100% identical so crossing TIER0_ENTER never pops terrain, trees, curbs, or shadows!
    const terrainSegs = tier <= 1 ? 16 : 5;
    const tGeo = buildChunkTerrainGeometry(terrain, data.cx, data.cz, terrainSegs);
    ch.staticGeos.push(tGeo);
    const tMesh = new THREE.Mesh(tGeo, this.terrainMat);
    tMesh.receiveShadow = tier <= 1;
    tMesh.castShadow = false;
    ch.staticGroup.add(tMesh);

    // 2. Marching Squares topographic contour lines (Tier 0 & Tier 1 identical; Tier 2 omitted in far fog)
    if (tier <= 1 && data.hasLand && terrain.hills > 0.02) {
      const contours = world.extractChunkContours(data.cx, data.cz, 18, 0.65);
      if (contours.length > 0) {
        const minorPts: number[] = [];
        const majorPts: number[] = [];
        for (const seg of contours) {
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
        if (tier <= 1) {
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

      if (tier <= 1) {
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

    // 4. Terrain-draped plazas (Tier 0 & Tier 1 identical)
    if (tier <= 1 && data.plazas.length > 0) {
      const plazaGeos: THREE.BufferGeometry[] = [];
      for (const pl of data.plazas) {
        const segs = 18;
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

    // 5. Coastal piers extending into the folded paper sea (Tier 0 & Tier 1 identical)
    if (tier <= 1 && data.piers.length > 0) {
      const pierGeo = buildMergedPiersGeometry(data.piers);
      if (pierGeo) {
        ch.staticGeos.push(pierGeo);
        const pm = new THREE.Mesh(pierGeo, this.pierMat);
        pm.castShadow = true;
        pm.receiveShadow = true;
        ch.staticGroup.add(pm);
      }
    }

    // 6. Grounded folded origami paper trees (identical full silhouettes across Tier 0 & Tier 1 -> ZERO tree pop!)
    if (tier <= 1 && data.trees.length > 0) {
      const { trunks, foliage } = buildMergedTreesGeometries(data.trees, true);
      if (trunks) {
        ch.staticGeos.push(trunks);
        const tm = new THREE.Mesh(trunks, this.plinthMat);
        tm.castShadow = true;
        tm.receiveShadow = true;
        ch.staticGroup.add(tm);
      }
      if (foliage) {
        ch.staticGeos.push(foliage);
        const fm = new THREE.Mesh(foliage, this.treeMat);
        fm.castShadow = true;
        fm.receiveShadow = true;
        ch.staticGroup.add(fm);
      }
    }

    // 7. Tiny folded origami sailboats are batched globally into ONE single InstancedMesh!
    this.boatsDirty = true;

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
      // Only Tier-0 chunks ever mount LOD0 rigs (and need per-chunk uLod0Active); Tier 1 & 2 share 2 static materials!
      const lodMat =
        tier === 0
          ? this.createChunkLodBuildingMaterial(ch.lodActiveMask, 1)
          : tier === 1
            ? this.sharedTier1LodMat
            : this.sharedTier2LodMat;
      const lodMesh = new THREE.Mesh(lodGeo, lodMat);
      // Near buildings (<116u) cast real per-panel animated shadows via LOD0 OrigamiHouseRig;
      // keeping `lodMesh.castShadow = false` avoids ghost shadows from untransformed LOD vertex positions!
      lodMesh.castShadow = false;
      lodMesh.receiveShadow = tier <= 1;
      ch.lodGeo = lodGeo;
      ch.lodMat = tier === 0 ? lodMat : null;
      ch.lodMesh = lodMesh;
      ch.group.add(lodMesh);
    }

    ch.tier = tier;
  }

  /** Instant, zero-pop Tier 0 <-> Tier 1 transition (static meshes & LOD1 geometry stay untouched!). */
  private swapChunkLodTier01(ch: MountedChunk, nextTier: 0 | 1): void {
    if (ch.lodMesh) {
      if (nextTier === 0) {
        if (!ch.lodMat) {
          ch.lodMat = this.createChunkLodBuildingMaterial(ch.lodActiveMask, 1);
        }
        ch.lodMesh.material = ch.lodMat;
      } else {
        ch.lodMesh.material = this.sharedTier1LodMat;
        if (ch.lodMat) {
          ch.lodMat.dispose();
          ch.lodMat = null;
        }
      }
    }
    ch.tier = nextTier;
  }

  private mountLod0Building(ch: MountedChunk, plot: CityBuildingPlot): void {
    if (ch.lod0Map.has(plot.index)) return;
    const matSet = this.matPool[plot.colorIndex % this.matPool.length];
    const net = buildHouseNet(plot.spec);
    const rig = buildOrigamiHouseRig(net, matSet, false, 'city');
    rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
    rig.setPaperRelief(1);

    const wrapper = new THREE.Group();
    wrapper.position.set(plot.x, plot.baseY, plot.z);
    wrapper.rotation.y = plot.yaw;

    const plinthW = plot.footprintW + 0.16;
    const plinthD = plot.footprintD + 0.16;
    const plinthH = Math.max(0.28, plot.baseY - plot.groundMinY + 0.95);
    const plinth = new THREE.Mesh(this.unitPlinthGeo, this.plinthMat);
    plinth.scale.set(plinthW, plinthH, plinthD);
    plinth.position.y = -plinthH * 0.5;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    plinth.userData.cityPlotId = plot.id;
    wrapper.add(plinth);

    const pickables: THREE.Object3D[] = [plinth];
    rig.root.rotation.y = 0;
    rig.root.scale.setScalar(plot.scale);
    rig.root.position.y *= plot.scale;
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.userData.cityPlotId = plot.id;
        obj.customDepthMaterial = this.cityShadowDepthMat;
        pickables.push(obj);
      }
    });
    if (rig.baseMesh) {
      rig.baseMesh.castShadow = false;
    }
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
      plinthW,
      plinthD,
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
    ch.lod0Map.delete(plotIdx);
    if (plotIdx < MAX_LOD_PLOTS_PER_CHUNK) {
      ch.lodActiveMask[plotIdx] = 0.0;
    }
    this.pickablesDirty = true;
  }

  private applyLod0FoldState(b: MountedLod0Building, fold: number): void {
    b.curFold = fold;
    // Match the exact 2-stage origami choreography of the GPU LOD1 shader:
    // walls hinge 90° up off the flat ground FIRST, then roof slopes & skylight caps sweep shut!
    const wallFold = smoothstep(0.0, 0.72, fold);
    const roofFold = smoothstep(0.28, 1.0, fold);
    const capFold = smoothstep(0.54, 1.0, fold);

    for (const id of b.rig.panelIds) {
      const stage = b.rig.net.panelMap.get(id)?.stage;
      const pFold = stage === 'cap' ? capFold : stage === 'roof' ? roofFold : wallFold;
      b.rig.updatePanelVisual(id, pFold, 0, false);
    }
    // Gate shadow pass uniformly on wall lift (0.04 ~ 3.6 deg, STILL below cityShadowDepthMat's 6.3 deg fade start!)
    // so walls AND attached roofs enter the shadow pass at 0% opacity and darken smoothly together with ZERO pop!
    const houseLifting = wallFold > 0.04;
    b.rig.panels.forEach((pv) => {
      pv.mesh.castShadow = houseLifting;
    });
    const showDetails = wallFold > 0.14;
    for (const det of b.rig.details) {
      det.pivot.visible = showDetails;
      det.pivot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = houseLifting && showDetails;
      });
    }
    if (b.rig.baseMesh) {
      b.rig.baseMesh.castShadow = false;
    }
    // Keep crease lines hidden while flat on the floor so flat pre-wave sheets show zero lines/edges!
    b.rig.setFoldLinesVisible(wallFold > 0.14 && fold < 0.48);

    // Smoothly emerge the retaining plinth only as walls start hinging up off the flat ground
    const pRise = smoothstep(0.10, 0.52, wallFold);
    b.plinth.visible = pRise > 0.01;
    if (b.plinth.visible) {
      b.plinth.scale.set(b.plinthW, Math.max(0.01, b.plinthH * pRise), b.plinthD);
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

    // Forward-biased view anchor hugging the coastal corridor so Tier 0 & LOD0 focus full ×4 detail
    // right along the coastline ahead of the camera strictly BEFORE each house begins folding!
    const viewAnchorX = this.flying ? camX * 0.30 + this.curLookAt.x * 0.70 : this.curTarget.x;
    const viewAnchorZ = this.flying ? camZ - 64 : this.curTarget.z;

    const missing: Array<{ cx: number; cz: number; dist: number; tier: 0 | 1 | 2 }> = [];
    for (let dz = -cRad; dz <= cRad; dz++) {
      for (let dx = -cRad; dx <= cRad; dx++) {
        const cx = cxCenter + dx;
        const cz = czCenter + dz;
        const centerX = (cx + 0.5) * CITY_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * CITY_CHUNK_SIZE;
        const dAnchor = Math.hypot(centerX - anchorX, centerZ - anchorZ);
        if (dAnchor > CHUNK_LOAD_RADIUS) continue;

        const dView = Math.hypot(centerX - viewAnchorX, centerZ - viewAnchorZ);
        const key = `${cx},${cz}`;
        const existing = this.chunks.get(key);

        if (!existing) {
          const tier: 0 | 1 | 2 = dView < TIER0_ENTER ? 0 : dView < TIER1_ENTER ? 1 : 2;
          missing.push({ cx, cz, dist: dView, tier });
        } else {
          // Hysteresis LOD tier transitions so chunks right on a distance boundary never thrash
          let nextTier = existing.tier;
          if (existing.tier === 0 && dView > TIER0_EXIT) nextTier = dView < TIER1_ENTER ? 1 : 2;
          else if (existing.tier === 1) {
            if (dView < TIER0_ENTER) nextTier = 0;
            else if (dView > TIER1_EXIT) nextTier = 2;
          } else if (existing.tier === 2 && dView < TIER1_EXIT - 10) {
            nextTier = dView < TIER0_ENTER ? 0 : 1;
          }

          if (nextTier !== existing.tier) {
            // If downgrading out of Tier 0, release all LOD0 origami rigs cleanly back to GPU LOD1/LOD2
            if (nextTier > 0 && existing.lod0Map.size > 0) {
              for (const idx of Array.from(existing.lod0Map.keys())) {
                this.unmountLod0Building(existing, idx);
              }
            }
            if (existing.tier <= 1 && nextTier <= 1) {
              // Fast 0-pop Tier 0 <-> Tier 1 material swap without rebuilding static terrain/trees/streets!
              this.swapChunkLodTier01(existing, nextTier as 0 | 1);
            } else {
              this.buildChunkStaticVisuals(existing, nextTier);
            }
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
      };
      for (const p of data.plots) {
        this.plotLookup.set(p.id, p);
      }
      this.buildChunkStaticVisuals(ch, req.tier);
      this.chunks.set(data.key, ch);
      builtCount++;
    }

    // 3. Wave-ahead coastal LOD0 upgrades: mount every visible coastal house strictly BEFORE `fold > 0`
    //    while keeping far-inland offscreen hillside plots in lightweight 1-draw-call GPU LOD1!
    const fx = this.waveFocus.x;
    const fz = this.waveFocus.y;
    const isWave = this.waveMode === 'wave';
    const lod0Candidates: Array<{ ch: MountedChunk; plot: CityBuildingPlot; prio: number; urgent: boolean }> = [];
    for (const ch of this.chunks.values()) {
      if (ch.tier !== 0) continue;
      for (const plot of ch.data.plots) {
        const d = Math.hypot(plot.x - viewAnchorX, plot.z - viewAnchorZ);
        const behindCam = this.flying && plot.z > camZ + 10;
        const tooFarInland = this.flying && plot.x > viewAnchorX + 74;
        const wMetric = isWave ? fz - plot.z + 0.24 * Math.abs(plot.x - fx) + plot.foldJitter : d;
        const wantLod0 = isWave ? wMetric < WAVE_FAR + 16 && d < 114 && !tooFarInland : d < LOD0_ENTER_DIST && !tooFarInland;
        const keepLod0 = isWave ? wMetric < WAVE_FAR + 28 && d < 128 && (!this.flying || plot.x <= viewAnchorX + 86) : d < LOD0_EXIT_DIST;
        const mounted = ch.lod0Map.has(plot.index);
        if (mounted && (behindCam || !keepLod0)) {
          this.unmountLod0Building(ch, plot.index);
        } else if (!mounted && !behindCam && wantLod0) {
          lod0Candidates.push({
            ch,
            plot,
            prio: isWave ? wMetric : d,
            urgent: isWave && wMetric < WAVE_FAR + 12,
          });
        }
      }
    }

    lod0Candidates.sort((a, b) => a.prio - b.prio);
    const maxRigBuilds = syncBurst ? 220 : 12;
    let rigsBuilt = 0;
    for (const item of lod0Candidates) {
      if (!item.urgent) {
        if (rigsBuilt >= maxRigBuilds) break;
        if (!syncBurst && rigsBuilt >= 2 && performance.now() - tStart > 8.5) break;
      }
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
      const dir = this.tmpV1.subVectors(this.curLookAt, this.curCamPos);
      const len = dir.length();
      const baseYaw = Math.atan2(dir.x, dir.z);
      const basePitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      const y = baseYaw + this.flyYawOff;
      const p = Math.max(-0.95, Math.min(0.45, basePitch + this.flyPitchOff));
      this.tmpV2.set(
        this.curCamPos.x + Math.cos(p) * Math.sin(y) * len,
        this.curCamPos.y + Math.sin(p) * len,
        this.curCamPos.z + Math.cos(p) * Math.cos(y) * len,
      );
      this.camera.lookAt(this.tmpV2);
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

      this.tmpV1.set(sample.pos[0], Math.max(10, sample.pos[1] + this.flyAltOff), sample.pos[2]);
      this.tmpV2.set(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]);
      this.curCamPos.lerp(this.tmpV1, 1 - Math.exp(-8.0 * dt));
      this.curLookAt.lerp(this.tmpV2, 1 - Math.exp(-6.0 * dt));
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

    // Emit & animate billowing paper smoke puffs right where houses are folding up!
    this.updateSmoke(dt);

    // Gently bob ALL coastal origami sailboats across active chunks in 1 single InstancedMesh draw call!
    this.updateBoats(this.elapsedTime);

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.4) {
      this.hudEmitAccum = 0;
      this.emitStats();
    }
  }

  private updateBoats(t: number): void {
    if (this.boatsDirty) {
      this.boatsDirty = false;
      this.activeBoats.length = 0;
      for (const ch of this.chunks.values()) {
        if (ch.tier > 1 || ch.data.boats.length === 0) continue;
        for (const boat of ch.data.boats) {
          if (this.activeBoats.length >= MAX_CITY_BOATS) break;
          this.activeBoats.push(boat);
        }
      }
      this.boatsInstancedMesh.count = this.activeBoats.length;
    }
    const count = this.activeBoats.length;
    if (count === 0) return;

    const dummy = this.tmpBoatDummy;
    for (let i = 0; i < count; i++) {
      const boat = this.activeBoats[i];
      const ph = boat.phase;
      dummy.position.set(boat.x, 0.04 + Math.sin(t * 1.45 + ph) * 0.14, boat.z);
      dummy.rotation.set(
        Math.cos(t * 0.92 + ph * 0.7) * 0.045,
        boat.yaw,
        Math.sin(t * 1.15 + ph * 1.3) * 0.075,
      );
      dummy.scale.setScalar(boat.scale);
      dummy.updateMatrix();
      this.boatsInstancedMesh.setMatrixAt(i, dummy.matrix);
    }
    this.boatsInstancedMesh.instanceMatrix.needsUpdate = true;
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
      smokeEnabled: this.smokeEnabled,
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
      activeSmokePuffs: this.smokeActiveCount,
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
    if (this.ownedWashiTex) {
      this.ownedWashiTex.map.dispose();
      this.ownedWashiTex.bumpMap.dispose();
    }
    this.smokeNoiseTex.dispose();
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
    this.unitPlinthGeo.dispose();
    this.sharedTier1LodMat.dispose();
    this.sharedTier2LodMat.dispose();
    this.cityShadowDepthMat.dispose();
    this.boatsInstancedMesh.dispose();
    this.seaMesh.geometry.dispose();
    this.seaMat.dispose();
    this.smokeGeo.dispose();
    this.smokeMat.dispose();
    this.hoverOutline.geometry.dispose();
    (this.hoverOutline.material as THREE.Material).dispose();
  }
}
