import * as THREE from 'three';

/**
 * Variable-band spherical labyrinth topology covering the full 360° sphere.
 * 7 latitude bands:
 *   Band 0: North pole cap (1 cell)
 *   Band 1: 6 cells  (60° each)
 *   Band 2: 12 cells (30° each)
 *   Band 3: 12 cells (30° each, equator)
 *   Band 4: 12 cells (30° each)
 *   Band 5: 6 cells  (60° each)
 *   Band 6: South pole cap (1 cell)
 * Total: 50 clean, spacious, nearly-square cells ("not too complex").
 */

export const R_FLOOR = 0.84;
export const R_WALL = 1.0;
export const R_BALL = 0.074;
export const R_BALL_CENTER = R_FLOOR + R_BALL;
export const R_SHELL = 1.024;
export const WALL_HALF_WIDTH = 0.056; // sleek molded wall thickness ~0.112 on unit sphere

export interface BandSpec {
  phiStart: number; // colatitude radians [0..PI]
  phiEnd: number;
  count: number;
}

const DEG = Math.PI / 180;

export const BANDS: BandSpec[] = [
  { phiStart: 0 * DEG, phiEnd: 20 * DEG, count: 1 },
  { phiStart: 20 * DEG, phiEnd: 46 * DEG, count: 6 },
  { phiStart: 46 * DEG, phiEnd: 74 * DEG, count: 12 },
  { phiStart: 74 * DEG, phiEnd: 106 * DEG, count: 12 },
  { phiStart: 106 * DEG, phiEnd: 134 * DEG, count: 12 },
  { phiStart: 134 * DEG, phiEnd: 160 * DEG, count: 6 },
  { phiStart: 160 * DEG, phiEnd: 180 * DEG, count: 1 },
];

export interface Cell {
  id: number;
  band: number;
  col: number;
  phiMin: number;
  phiMax: number;
  thetaMin: number;
  thetaMax: number;
  centerPhi: number;
  centerTheta: number;
  centerDir: THREE.Vector3;
}

export type WallKind = 'lat' | 'lon';

export interface WallSegment {
  id: number;
  kind: WallKind;
  cellA: number;
  cellB: number;
  open: boolean;
  // For 'lat': constant phi, spanning [thetaStart, thetaEnd]
  // For 'lon': constant theta, spanning [phiStart, phiEnd]
  phiStart: number;
  phiEnd: number;
  thetaStart: number;
  thetaEnd: number;
}

export interface VertexPost {
  phi: number;
  theta: number;
  dir: THREE.Vector3;
  degree: number;
}

export interface Checkpoint {
  index: number; // 0..N-1
  cellId: number;
  label: string;
  phi: number;
  theta: number;
  dir: THREE.Vector3;
  isFinish: boolean;
}

export interface SphereMaze {
  seed: number;
  cells: Cell[];
  walls: WallSegment[];
  solidWalls: WallSegment[];
  posts: VertexPost[];
  startCell: Cell;
  checkpoints: Checkpoint[];
  solutionPath: number[];
}

export function sphToDir(phi: number, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
  const sinPhi = Math.sin(phi);
  return out.set(sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSphereMaze(seed = 1307): SphereMaze {
  const rng = mulberry32(seed);
  const cells: Cell[] = [];
  const bandOffsets: number[] = [];

  for (let b = 0; b < BANDS.length; b++) {
    bandOffsets.push(cells.length);
    const spec = BANDS[b];
    const dTheta = (Math.PI * 2) / spec.count;
    for (let c = 0; c < spec.count; c++) {
      const thetaMin = c * dTheta;
      const thetaMax = (c + 1) * dTheta;
      const centerPhi = b === 0 ? 0.0001 : b === BANDS.length - 1 ? Math.PI - 0.0001 : 0.5 * (spec.phiStart + spec.phiEnd);
      const centerTheta = spec.count === 1 ? 0 : 0.5 * (thetaMin + thetaMax);
      cells.push({
        id: cells.length,
        band: b,
        col: c,
        phiMin: spec.phiStart,
        phiMax: spec.phiEnd,
        thetaMin,
        thetaMax,
        centerPhi,
        centerTheta,
        centerDir: sphToDir(centerPhi, centerTheta),
      });
    }
  }

  const walls: WallSegment[] = [];
  const addWall = (
    kind: WallKind,
    cellA: number,
    cellB: number,
    phiStart: number,
    phiEnd: number,
    thetaStart: number,
    thetaEnd: number,
  ) => {
    walls.push({
      id: walls.length,
      kind,
      cellA,
      cellB,
      open: false,
      phiStart,
      phiEnd,
      thetaStart,
      thetaEnd,
    });
  };

  // 1. Longitude walls between adjacent columns within each band
  for (let b = 0; b < BANDS.length; b++) {
    const spec = BANDS[b];
    if (spec.count <= 1) continue;
    const base = bandOffsets[b];
    const dTheta = (Math.PI * 2) / spec.count;
    for (let c = 0; c < spec.count; c++) {
      const next = (c + 1) % spec.count;
      const theta = (c + 1) * dTheta;
      addWall('lon', base + c, base + next, spec.phiStart, spec.phiEnd, theta, theta);
    }
  }

  // 2. Latitude walls between consecutive bands
  for (let b = 0; b < BANDS.length - 1; b++) {
    const upper = BANDS[b];
    const lower = BANDS[b + 1];
    const upperBase = bandOffsets[b];
    const lowerBase = bandOffsets[b + 1];
    const phi = upper.phiEnd;
    const maxCount = Math.max(upper.count, lower.count);
    const dTheta = (Math.PI * 2) / maxCount;

    for (let k = 0; k < maxCount; k++) {
      const uCol = Math.floor((k * upper.count) / maxCount);
      const lCol = Math.floor((k * lower.count) / maxCount);
      const t0 = k * dTheta;
      const t1 = (k + 1) * dTheta;
      addWall('lat', upperBase + uCol, lowerBase + lCol, phi, phi, t0, t1);
    }
  }

  // Build adjacency list over walls
  const adj: WallSegment[][] = Array.from({ length: cells.length }, () => []);
  for (const w of walls) {
    adj[w.cellA].push(w);
    adj[w.cellB].push(w);
  }

  // Recursive backtracker with mild winding preference (creates clean flowing corridors)
  const visited = new Uint8Array(cells.length);
  const stack: { cell: number; prevKind: WallKind | null }[] = [{ cell: 0, prevKind: null }];
  visited[0] = 1;

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const options = adj[top.cell].filter((w) => {
      const other = w.cellA === top.cell ? w.cellB : w.cellA;
      return !visited[other];
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    // Slightly favor turning/flowing rather than pure straight drops to the south pole
    const scored = options.map((w) => {
      const other = w.cellA === top.cell ? w.cellB : w.cellA;
      let weight = rng();
      // Encourage horizontal exploration around latitude bands so corridors wrap gracefully
      if (w.kind === 'lon') weight += 0.28;
      // Avoid opening multiple walls out of the polar caps right away
      if (cells[other].band === BANDS.length - 1) weight -= 0.35;
      return { w, other, weight };
    });
    scored.sort((a, b) => b.weight - a.weight);
    const pick = scored[0];
    pick.w.open = true;
    visited[pick.other] = 1;
    stack.push({ cell: pick.other, prevKind: pick.w.kind });
  }

  // Keep a pure spanning tree (zero 2x2 open rooms) so every track reads cleanly as a continuous sculptural corridor.
  // Pick a graceful winding seed that wraps cleanly around all hemispheres.

  // Find shortest path from North Pole (0) to South Pole (cells.length - 1) using BFS
  const startId = 0;
  const finishId = cells.length - 1;
  const parent = new Int32Array(cells.length).fill(-1);
  const dist = new Int32Array(cells.length).fill(-1);
  const q: number[] = [startId];
  dist[startId] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const w of adj[u]) {
      if (!w.open) continue;
      const v = w.cellA === u ? w.cellB : w.cellA;
      if (dist[v] === -1) {
        dist[v] = dist[u] + 1;
        parent[v] = u;
        q.push(v);
      }
    }
  }

  // Reconstruct path North -> South
  const solutionPath: number[] = [];
  let cur = finishId;
  while (cur !== -1) {
    solutionPath.push(cur);
    cur = parent[cur];
  }
  solutionPath.reverse();

  // Pick 5 checkpoints: 4 evenly spaced along the journey + the South Pole finish!
  // If solutionPath is short, also include deep branch cells on different longitudes so checkpoints span the globe.
  const targetIntermediate = 4;
  const checkpointIds: number[] = [];
  if (solutionPath.length >= targetIntermediate + 3) {
    for (let k = 1; k <= targetIntermediate; k++) {
      const idx = Math.round((k * (solutionPath.length - 1)) / (targetIntermediate + 1));
      const cid = solutionPath[idx];
      if (!checkpointIds.includes(cid) && cid !== startId && cid !== finishId) {
        checkpointIds.push(cid);
      }
    }
  }

  // Fill any missing checkpoints with well-separated cells by BFS distance
  if (checkpointIds.length < targetIntermediate) {
    const candidates = cells
      .filter((c) => c.id !== startId && c.id !== finishId && !checkpointIds.includes(c.id))
      .sort((a, b) => dist[a.id] - dist[b.id]);
    while (checkpointIds.length < targetIntermediate && candidates.length > 0) {
      const idx = Math.floor(((checkpointIds.length + 1) / (targetIntermediate + 1)) * candidates.length);
      const chosen = candidates.splice(Math.min(idx, candidates.length - 1), 1)[0];
      checkpointIds.push(chosen.id);
    }
  }
  checkpointIds.push(finishId);

  const checkpoints: Checkpoint[] = checkpointIds.map((cid, i) => {
    const c = cells[cid];
    const isFinish = cid === finishId;
    return {
      index: i,
      cellId: cid,
      label: isFinish ? '13' : String(i + 1).padStart(2, '0'),
      phi: c.centerPhi,
      theta: c.centerTheta,
      dir: c.centerDir.clone(),
      isFinish,
    };
  });

  const solidWalls = walls.filter((w) => !w.open);

  // Collect unique corner vertex posts where solid walls meet (for smooth rounded wall junctions)
  const postMap = new Map<string, VertexPost>();
  const registerPost = (phi: number, theta: number) => {
    const normTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const key = `${Math.round(phi * 1000)}_${Math.round(normTheta * 1000) % Math.round(Math.PI * 2 * 1000)}`;
    const existing = postMap.get(key);
    if (existing) {
      existing.degree++;
    } else {
      postMap.set(key, {
        phi,
        theta: normTheta,
        dir: sphToDir(phi, normTheta),
        degree: 1,
      });
    }
  };

  for (const w of solidWalls) {
    registerPost(w.phiStart, w.thetaStart);
    registerPost(w.phiEnd, w.thetaEnd);
  }

  return {
    seed,
    cells,
    walls,
    solidWalls,
    posts: Array.from(postMap.values()),
    startCell: cells[startId],
    checkpoints,
    solutionPath,
  };
}
