import * as THREE from 'three';

/**
 * Two-layer adaptive sphere labyrinth topology:
 * - UPPER SURFACE (R_FLOOR = 0.855 .. R_WALL = 1.000):
 *   8-band, 62-cell spherical grid with 132 thin modular wall slots & 66 steady corner poles.
 *   Certain cells hold 6-blade mechanical DIAPHRAGM IRIS SHUTTERS that open real circular holes
 *   straight through the floor shell; panels directly over the lower tunnels are TRANSPARENT
 *   polycarbonate inspection windows.
 * - UNDERNEATH HALF-PIPE TUBE SYSTEM (R_PIPE_FLOOR = 0.625):
 *   A simpler, sculpted U-shaped half-pipe channel network connecting all 6 diaphragm shutter
 *   ports beneath the upper maze — visible right through the transparent window panels!
 */

export const R_CORE_INNER = 0.525;
export const R_PIPE_FLOOR = 0.625;
export const R_FLOOR_INNER = 0.826;
export const R_FLOOR = 0.855;
export const R_WALL = 1.0;
export const R_BALL = 0.068;
export const R_BALL_CENTER = R_FLOOR + R_BALL;
export const R_BALL_PIPE = R_PIPE_FLOOR + R_BALL;
export const R_SHELL = 1.024;
export const WALL_HALF_WIDTH = 0.036;
export const R_IRIS_HOLE = 0.114; // circular opening radius in radians (~0.097 world units at R_FLOOR)

export interface BandSpec {
  phiStart: number;
  phiEnd: number;
  count: number;
}

const DEG = Math.PI / 180;

export const BANDS: BandSpec[] = [
  { phiStart: 0 * DEG, phiEnd: 19 * DEG, count: 1 },
  { phiStart: 19 * DEG, phiEnd: 43 * DEG, count: 6 },
  { phiStart: 43 * DEG, phiEnd: 66 * DEG, count: 12 },
  { phiStart: 66 * DEG, phiEnd: 90 * DEG, count: 12 },
  { phiStart: 90 * DEG, phiEnd: 114 * DEG, count: 12 },
  { phiStart: 114 * DEG, phiEnd: 137 * DEG, count: 12 },
  { phiStart: 137 * DEG, phiEnd: 161 * DEG, count: 6 },
  { phiStart: 161 * DEG, phiEnd: 180 * DEG, count: 1 },
];

export type PanelKind = 'solid' | 'window' | 'shutter';

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
  panelKind: PanelKind;
  shutterId: number; // -1 if not a shutter cell
}

export type WallKind = 'lat' | 'lon';

export interface WallSlot {
  id: number;
  kind: WallKind;
  cellA: number;
  cellB: number;
  phiStart: number;
  phiEnd: number;
  thetaStart: number;
  thetaEnd: number;
  midDir: THREE.Vector3;
  locked: boolean;
  hasArrow: boolean;
  postA: number;
  postB: number;
}

export interface VertexPost {
  id: number;
  phi: number;
  theta: number;
  dir: THREE.Vector3;
  wallIds: number[];
  locked: boolean;
}

export interface ShutterPort {
  id: number;
  cellId: number;
  label: string;
  phi: number;
  theta: number;
  dir: THREE.Vector3;
  pipeNodeId: number;
}

export interface PipeNode {
  id: number;
  dir: THREE.Vector3;
  shutterId: number; // -1 for interior hub junction
  edgeIds: number[];
}

export interface PipeEdge {
  id: number;
  nodeA: number;
  nodeB: number;
  arcLen: number; // radians along great circle
}

export type CheckpointLayer = 'upper' | 'pipe';

export interface Checkpoint {
  index: number;
  cellId: number; // -1 if located at an interior pipe node
  pipeNodeId: number; // -1 if on upper surface
  layer: CheckpointLayer;
  label: string;
  dir: THREE.Vector3;
  isFinish: boolean;
}

export interface LevelConfig {
  level: number; // 1..5
  name: string;
  subtitle: string;
  seed: number;
  raisedWalls: boolean[];
  /** Boolean mask per ShutterPort id: true = diaphragm iris OPEN, false = diaphragm iris CLOSED flush */
  openShutters: boolean[];
  startCellId: number;
  checkpoints: Checkpoint[];
}

export interface SphereGrid {
  cells: Cell[];
  walls: WallSlot[];
  posts: VertexPost[];
  shutters: ShutterPort[];
  pipeNodes: PipeNode[];
  pipeEdges: PipeEdge[];
  levels: LevelConfig[];
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

function isGraphConnected(cellCount: number, adj: WallSlot[][], closedMask: boolean[]): boolean {
  const seen = new Uint8Array(cellCount);
  const q: number[] = [0];
  seen[0] = 1;
  let visited = 1;
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    for (const w of adj[u]) {
      if (closedMask[w.id]) continue;
      const v = w.cellA === u ? w.cellB : w.cellA;
      if (!seen[v]) {
        seen[v] = 1;
        visited++;
        q.push(v);
      }
    }
  }
  return visited === cellCount;
}

/**
 * Helper: find cell index by (band, col).
 */
function findCell(cells: Cell[], band: number, col: number): Cell {
  const spec = BANDS[band];
  const wrapped = ((col % spec.count) + spec.count) % spec.count;
  return cells.find((c) => c.band === band && c.col === wrapped)!;
}

function buildLevelConfig(
  level: number,
  name: string,
  subtitle: string,
  seed: number,
  openFractionOfClosed: number,
  upperCheckpointCount: number,
  pipeCheckpointNodeIds: number[],
  openShutters: boolean[],
  lonBias: number,
  cells: Cell[],
  walls: WallSlot[],
  adj: WallSlot[][],
  pipeNodes: PipeNode[],
): LevelConfig {
  const rng = mulberry32(seed);
  const raised = walls.map(() => true);

  const visited = new Uint8Array(cells.length);
  const startId = 0;
  const finishId = cells.length - 1;
  const stack: number[] = [startId];
  visited[startId] = 1;

  while (stack.length > 0) {
    const u = stack[stack.length - 1];
    const options = adj[u].filter((w) => {
      if (w.locked) return false;
      const v = w.cellA === u ? w.cellB : w.cellA;
      return !visited[v];
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const scored = options.map((w) => {
      const v = w.cellA === u ? w.cellB : w.cellA;
      let weight = rng();
      if (w.kind === 'lon') weight += lonBias;
      if (cells[v].band === BANDS.length - 1) weight -= 0.4;
      return { w, v, weight };
    });
    scored.sort((a, b) => b.weight - a.weight);
    const pick = scored[0];
    raised[pick.w.id] = false;
    visited[pick.v] = 1;
    stack.push(pick.v);
  }

  if (openFractionOfClosed > 0) {
    const extraCandidates = walls.filter((w) => raised[w.id] && !w.locked);
    for (let i = extraCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [extraCandidates[i], extraCandidates[j]] = [extraCandidates[j], extraCandidates[i]];
    }
    const toOpen = Math.floor(extraCandidates.length * openFractionOfClosed);
    for (let i = 0; i < toOpen; i++) {
      raised[extraCandidates[i].id] = false;
    }
  }

  // BFS for upper-surface checkpoints (avoiding shutter & window cells so LEDs sit cleanly on solid panels!)
  const parent = new Int32Array(cells.length).fill(-1);
  const dist = new Int32Array(cells.length).fill(-1);
  const q: number[] = [startId];
  dist[startId] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const w of adj[u]) {
      if (raised[w.id]) continue;
      const v = w.cellA === u ? w.cellB : w.cellA;
      if (dist[v] === -1) {
        dist[v] = dist[u] + 1;
        parent[v] = u;
        q.push(v);
      }
    }
  }

  const path: number[] = [];
  let cur = finishId;
  while (cur !== -1) {
    path.push(cur);
    cur = parent[cur];
  }
  path.reverse();

  const solidPathCells = path.filter(
    (cid) => cid !== startId && cid !== finishId && cells[cid].panelKind === 'solid',
  );
  const upperIntermediate = Math.max(1, upperCheckpointCount - 1);
  const chosenUpper: number[] = [];

  for (let k = 1; k <= upperIntermediate; k++) {
    if (solidPathCells.length === 0) break;
    const idx = Math.min(
      solidPathCells.length - 1,
      Math.round((k * (solidPathCells.length - 1)) / (upperIntermediate + 1)),
    );
    const cid = solidPathCells[idx];
    if (!chosenUpper.includes(cid)) chosenUpper.push(cid);
  }

  if (chosenUpper.length < upperIntermediate) {
    const fallback = cells
      .filter(
        (c) =>
          c.id !== startId &&
          c.id !== finishId &&
          c.panelKind === 'solid' &&
          !chosenUpper.includes(c.id) &&
          dist[c.id] > 0,
      )
      .sort((a, b) => dist[a.id] - dist[b.id]);
    while (chosenUpper.length < upperIntermediate && fallback.length > 0) {
      const idx = Math.floor(((chosenUpper.length + 1) / (upperIntermediate + 1)) * fallback.length);
      const chosen = fallback.splice(Math.min(idx, fallback.length - 1), 1)[0];
      chosenUpper.push(chosen.id);
    }
  }

  const checkpoints: Checkpoint[] = [];

  // Interleave upper-surface checkpoints + underneath half-pipe checkpoints, ending with 13 END at South Pole!
  let idxCounter = 0;
  for (let i = 0; i < chosenUpper.length; i++) {
    const c = cells[chosenUpper[i]];
    checkpoints.push({
      index: idxCounter,
      cellId: c.id,
      pipeNodeId: -1,
      layer: 'upper',
      label: String(idxCounter + 1).padStart(2, '0'),
      dir: c.centerDir.clone(),
      isFinish: false,
    });
    idxCounter++;

    // Insert under-deck half-pipe checkpoint cleanly into the sequence
    if (i < pipeCheckpointNodeIds.length) {
      const pn = pipeNodes[pipeCheckpointNodeIds[i]];
      checkpoints.push({
        index: idxCounter,
        cellId: -1,
        pipeNodeId: pn.id,
        layer: 'pipe',
        label: `U${i + 1}`,
        dir: pn.dir.clone(),
        isFinish: false,
      });
      idxCounter++;
    }
  }

  // Any remaining under-deck checkpoints
  for (let i = chosenUpper.length; i < pipeCheckpointNodeIds.length; i++) {
    const pn = pipeNodes[pipeCheckpointNodeIds[i]];
    checkpoints.push({
      index: idxCounter,
      cellId: -1,
      pipeNodeId: pn.id,
      layer: 'pipe',
      label: `U${i + 1}`,
      dir: pn.dir.clone(),
      isFinish: false,
    });
    idxCounter++;
  }

  // Final South Pole END checkpoint
  const fin = cells[finishId];
  checkpoints.push({
    index: idxCounter,
    cellId: fin.id,
    pipeNodeId: -1,
    layer: 'upper',
    label: '13',
    dir: fin.centerDir.clone(),
    isFinish: true,
  });

  return {
    level,
    name,
    subtitle,
    seed,
    raisedWalls: raised,
    openShutters,
    startCellId: startId,
    checkpoints,
  };
}

export function createSphereGrid(): SphereGrid {
  const cells: Cell[] = [];
  const bandOffsets: number[] = [];

  for (let b = 0; b < BANDS.length; b++) {
    bandOffsets.push(cells.length);
    const spec = BANDS[b];
    const dTheta = (Math.PI * 2) / spec.count;
    for (let c = 0; c < spec.count; c++) {
      const thetaMin = c * dTheta;
      const thetaMax = (c + 1) * dTheta;
      const centerPhi =
        b === 0 ? 0.0001 : b === BANDS.length - 1 ? Math.PI - 0.0001 : 0.5 * (spec.phiStart + spec.phiEnd);
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
        panelKind: 'solid',
        shutterId: -1,
      });
    }
  }

  // --- 1. Place 6 Diaphragm Iris Shutter Ports symmetrically around the sphere ---
  // Notice: front hero view looks around theta ~ 1.85 rad (col 3-4 of 12-cell bands, col 1-2 of 6-cell bands),
  // so Shutter A (band 2, col 2) and Shutter B (band 3, col 5) and Shutter F (band 4, col 3) sit right in view!
  const shutterSpecs: { band: number; col: number; label: string }[] = [
    { band: 2, col: 2, label: 'A' }, // Upper-front-right
    { band: 3, col: 4, label: 'B' }, // Mid-front-left
    { band: 4, col: 1, label: 'C' }, // Lower-right
    { band: 2, col: 8, label: 'D' }, // Upper-back
    { band: 3, col: 10, label: 'E' }, // Mid-back-right
    { band: 4, col: 7, label: 'F' }, // Lower-back-left
  ];

  const shutters: ShutterPort[] = [];
  const pipeNodes: PipeNode[] = [];

  for (let i = 0; i < shutterSpecs.length; i++) {
    const sp = shutterSpecs[i];
    const cell = findCell(cells, sp.band, sp.col);
    cell.panelKind = 'shutter';
    cell.shutterId = i;

    const nodeId = pipeNodes.length;
    pipeNodes.push({
      id: nodeId,
      dir: cell.centerDir.clone(),
      shutterId: i,
      edgeIds: [],
    });

    shutters.push({
      id: i,
      cellId: cell.id,
      label: sp.label,
      phi: cell.centerPhi,
      theta: cell.centerTheta,
      dir: cell.centerDir.clone(),
      pipeNodeId: nodeId,
    });
  }

  // Add 3 interior half-pipe junction hubs (sitting directly under transparent window cells!)
  const hubSpecs: { band: number; col: number }[] = [
    { band: 3, col: 2 }, // Front-center window hub (connects A, B, C right in front of the viewer!)
    { band: 3, col: 7 }, // Back-left window hub (connects B, D, F)
    { band: 3, col: 11 }, // Right-back window hub (connects A, C, E, D)
  ];
  const hubNodeIds: number[] = [];
  for (const hs of hubSpecs) {
    const cell = findCell(cells, hs.band, hs.col);
    const nodeId = pipeNodes.length;
    pipeNodes.push({
      id: nodeId,
      dir: cell.centerDir.clone(),
      shutterId: -1,
      edgeIds: [],
    });
    hubNodeIds.push(nodeId);
  }

  // Connect the simpler, mind-warping underneath half-pipe tube network (9 smooth curved tubes!)
  // Node indices: 0=A, 1=B, 2=C, 3=D, 4=E, 5=F, 6=HubFront, 7=HubBackLeft, 8=HubBackRight
  const pipePairs: [number, number][] = [
    [0, 6], // A -> Front Hub
    [1, 6], // B -> Front Hub
    [2, 6], // C -> Front Hub
    [1, 7], // B -> Back-Left Hub
    [3, 7], // D -> Back-Left Hub
    [5, 7], // F -> Back-Left Hub
    [2, 8], // C -> Back-Right Hub
    [4, 8], // E -> Back-Right Hub
    [3, 8], // D -> Back-Right Hub
    [6, 8], // Front Hub -> Back-Right Hub (equatorial scenic ring!)
  ];

  const pipeEdges: PipeEdge[] = [];
  for (const [a, b] of pipePairs) {
    const dot = Math.max(-1, Math.min(1, pipeNodes[a].dir.dot(pipeNodes[b].dir)));
    const arcLen = Math.acos(dot);
    const id = pipeEdges.length;
    pipeEdges.push({ id, nodeA: a, nodeB: b, arcLen });
    pipeNodes[a].edgeIds.push(id);
    pipeNodes[b].edgeIds.push(id);
  }

  // --- 2. Mark floor panels directly above the half-pipe network as TRANSPARENT WINDOWS ---
  // Sample points along every half-pipe edge and mark underlying mid-band cells as transparent clear windows!
  const samplePt = new THREE.Vector3();
  for (const edge of pipeEdges) {
    const dA = pipeNodes[edge.nodeA].dir;
    const dB = pipeNodes[edge.nodeB].dir;
    const samples = 10;
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      samplePt.copy(dA).lerp(dB, t).normalize();
      // Find closest cell
      let bestCell: Cell | null = null;
      let bestDot = -2;
      for (const c of cells) {
        if (c.band === 0 || c.band === BANDS.length - 1) continue;
        const d = c.centerDir.dot(samplePt);
        if (d > bestDot) {
          bestDot = d;
          bestCell = c;
        }
      }
      if (bestCell && bestCell.panelKind === 'solid') {
        bestCell.panelKind = 'window';
      }
    }
  }

  // --- 3. Build steady corner posts & 132 thin wall slots ---
  const posts: VertexPost[] = [];
  const postKeyToId = new Map<string, number>();

  const getOrCreatePost = (phi: number, theta: number): number => {
    const normTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const kTheta = Math.round(normTheta * 1000) % Math.round(Math.PI * 2 * 1000);
    const key = `${Math.round(phi * 1000)}_${kTheta}`;
    const existing = postKeyToId.get(key);
    if (existing !== undefined) return existing;
    const id = posts.length;
    posts.push({
      id,
      phi,
      theta: normTheta,
      dir: sphToDir(phi, normTheta),
      wallIds: [],
      locked: false,
    });
    postKeyToId.set(key, id);
    return id;
  };

  const walls: WallSlot[] = [];
  const addWall = (
    kind: WallKind,
    cellA: number,
    cellB: number,
    phiStart: number,
    phiEnd: number,
    thetaStart: number,
    thetaEnd: number,
  ) => {
    const id = walls.length;
    const postA = getOrCreatePost(phiStart, thetaStart);
    const postB = getOrCreatePost(phiEnd, thetaEnd);
    const midPhi = 0.5 * (phiStart + phiEnd);
    const midTheta = 0.5 * (thetaStart + thetaEnd);
    walls.push({
      id,
      kind,
      cellA,
      cellB,
      phiStart,
      phiEnd,
      thetaStart,
      thetaEnd,
      midDir: sphToDir(midPhi, midTheta),
      locked: false,
      hasArrow: false,
      postA,
      postB,
    });
    posts[postA].wallIds.push(id);
    posts[postB].wallIds.push(id);
  };

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

  const adj: WallSlot[][] = Array.from({ length: cells.length }, () => []);
  for (const w of walls) {
    adj[w.cellA].push(w);
    adj[w.cellB].push(w);
  }

  // --- 4. Locked structural skeleton (~16 anchor walls) ---
  const lockedMask = walls.map(() => false);
  const lockRng = mulberry32(1301);
  const lockCandidates = walls
    .filter((w) => w.kind === 'lat' && cells[w.cellA].band >= 1 && cells[w.cellB].band <= 6)
    .sort(() => lockRng() - 0.5);

  const cradleWall = walls.find((w) => w.kind === 'lat' && w.cellA === 0 && w.thetaStart >= 1.0 && w.thetaStart <= 2.2);
  let lockedCount = 0;
  if (cradleWall) {
    lockedMask[cradleWall.id] = true;
    cradleWall.locked = true;
    posts[cradleWall.postA].locked = true;
    posts[cradleWall.postB].locked = true;
    lockedCount++;
  }

  for (const w of lockCandidates) {
    if (lockedCount >= 16) break;
    if (w.locked) continue;
    const tooClose = walls.some((o) => o.locked && o.midDir.dot(w.midDir) > 0.72);
    if (tooClose) continue;
    lockedMask[w.id] = true;
    if (isGraphConnected(cells.length, adj, lockedMask)) {
      w.locked = true;
      posts[w.postA].locked = true;
      posts[w.postB].locked = true;
      lockedCount++;
    } else {
      lockedMask[w.id] = false;
    }
  }

  // Subtle actuator arrows on selected morphing walls
  const arrowRng = mulberry32(4413);
  const arrowCandidates = walls.filter((w) => !w.locked && w.kind === 'lat').sort(() => arrowRng() - 0.5);
  let arrowCount = 0;
  for (const w of arrowCandidates) {
    if (arrowCount >= 12) break;
    const tooClose = walls.some((o) => o.hasArrow && o.midDir.dot(w.midDir) > 0.62);
    if (tooClose) continue;
    w.hasArrow = true;
    arrowCount++;
  }

  // --- 5. Five curated levels: morphing upper walls + morphing diaphragm shutters + under-deck LEDs! ---
  // Each level opens a curated subset of the 6 diaphragm shutters (A..F) and puts 1-2 LEDs in the half-pipes below!
  const levels: LevelConfig[] = [
    buildLevelConfig(
      1,
      '01 · OPEN',
      'GENTLE INTRO',
      1311,
      0.44,
      2,
      [hubNodeIds[0]], // 1 under-deck LED right under the front transparent window!
      [true, true, false, true, true, false], // A & B open, C closed (shows both open & closed iris on front!)
      0.18,
      cells,
      walls,
      adj,
      pipeNodes,
    ),
    buildLevelConfig(
      2,
      '02 · EQUATOR',
      'SUB-DECK LOOP',
      2623,
      0.3,
      3,
      [hubNodeIds[0]],
      [true, false, true, true, false, true], // shutters morph! B & E iris shut, D & F iris open!
      0.35,
      cells,
      walls,
      adj,
      pipeNodes,
    ),
    buildLevelConfig(
      3,
      '03 · SPIRAL',
      'DUAL LAYER',
      3937,
      0.16,
      3,
      [hubNodeIds[0], hubNodeIds[1]], // 2 under-deck half-pipe LEDs!
      [true, true, false, true, true, false],
      0.52,
      cells,
      walls,
      adj,
      pipeNodes,
    ),
    buildLevelConfig(
      4,
      '04 · HELIX',
      'TIGHT PORTALS',
      5249,
      0.06,
      3,
      [hubNodeIds[1], hubNodeIds[2]],
      [false, true, true, false, true, true],
      0.25,
      cells,
      walls,
      adj,
      pipeNodes,
    ),
    buildLevelConfig(
      5,
      '05 · MASTER',
      'FULL ADAPTIVE',
      6571,
      0.0,
      4,
      [hubNodeIds[0], hubNodeIds[2]],
      [true, true, true, true, true, true], // All 6 diaphragm shutters open!
      0.42,
      cells,
      walls,
      adj,
      pipeNodes,
    ),
  ];

  return { cells, walls, posts, shutters, pipeNodes, pipeEdges, levels };
}
