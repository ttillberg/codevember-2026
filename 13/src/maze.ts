import * as THREE from 'three';

/**
 * Tighter two-layer adaptive sphere puzzle topology:
 * - 8-band, 82-cell spherical grid (1–8–16–16–16–16–8–1), 176 thin wall slots & 88 steady corner poles.
 * - 6 mechanical 6-blade diaphragm iris shutters connecting to an underneath sculpted half-pipe tube network
 *   visible through transparent polycarbonate floor window panels.
 * - Mechanical floor Toggle Pads (Coral A, Cobalt B) that flip linked retractable gate walls (opening one
 *   passage while closing another) and/or open & close linked diaphragm shutters in real time.
 * - Strict sequential checkpoints (01 -> 02 -> ... -> 13 END) across 10 curated, state-space-BFS-verified levels.
 */

export const R_CORE_INNER = 0.525;
export const R_PIPE_FLOOR = 0.635;
export const R_FLOOR_INNER = 0.842;
export const R_FLOOR = 0.87;
export const R_WALL = 1.0;
export const R_BALL = 0.056;
export const R_BALL_CENTER = R_FLOOR + R_BALL;
export const R_BALL_PIPE = R_PIPE_FLOOR + R_BALL;
export const R_SHELL = 1.024;
export const WALL_HALF_WIDTH = 0.026; // sleek thin walls for tighter 82-cell combinations
export const R_IRIS_HOLE = 0.092; // clean circular drop aperture sized for 0.056 bearing inside tighter cells

export interface BandSpec {
  phiStart: number;
  phiEnd: number;
  count: number;
}

const DEG = Math.PI / 180;

export const BANDS: BandSpec[] = [
  { phiStart: 0 * DEG, phiEnd: 19 * DEG, count: 1 },
  { phiStart: 19 * DEG, phiEnd: 40 * DEG, count: 8 },
  { phiStart: 40 * DEG, phiEnd: 65 * DEG, count: 16 },
  { phiStart: 65 * DEG, phiEnd: 90 * DEG, count: 16 },
  { phiStart: 90 * DEG, phiEnd: 115 * DEG, count: 16 },
  { phiStart: 115 * DEG, phiEnd: 140 * DEG, count: 16 },
  { phiStart: 140 * DEG, phiEnd: 161 * DEG, count: 8 },
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
  shutterId: number;
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
  shutterId: number;
  edgeIds: number[];
}

export interface PipeEdge {
  id: number;
  nodeA: number;
  nodeB: number;
  arcLen: number;
}

export type CheckpointLayer = 'upper' | 'pipe';

export interface Checkpoint {
  index: number;
  cellId: number;
  pipeNodeId: number;
  layer: CheckpointLayer;
  label: string;
  dir: THREE.Vector3;
  isFinish: boolean;
}

export type ToggleColorId = 0 | 1; // 0 = Coral-Red (A), 1 = Cobalt-Blue (B)

export interface TogglePad {
  id: number; // 0 or 1 (bit index in toggleMask)
  colorId: ToggleColorId;
  label: string; // 'A' or 'B'
  cellId: number;
  dir: THREE.Vector3;
  /** Wall slot ids controlled by this toggle (flips raised <-> retracted when toggled!) */
  wallIds: number[];
  /** Shutter port ids controlled by this toggle (flips open <-> closed when toggled!) */
  shutterIds: number[];
}

export interface LevelSolutionStats {
  solvable: boolean;
  minSteps: number;
  portalTransitions: number;
  toggleFlips: number;
}

export interface LevelConfig {
  level: number; // 1..10
  name: string;
  nameJa: string;
  difficulty: string;
  seed: number;
  /** Base wall state when toggleMask === 0 (true = raised, false = retracted) */
  raisedWalls: boolean[];
  /** Base shutter state when toggleMask === 0 (true = open, false = closed) */
  openShutters: boolean[];
  /** Mechanical floor toggles active on this level */
  toggles: TogglePad[];
  startCellId: number;
  /** Strictly sequential checkpoints: player must trigger index 0, then 1, ..., then Finish */
  checkpoints: Checkpoint[];
  stats: LevelSolutionStats;
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

export function computeEffectiveWalls(level: LevelConfig, toggleMask: number, wallCount: number): boolean[] {
  const out = level.raisedWalls.slice(0, wallCount);
  for (const tg of level.toggles) {
    if ((toggleMask & (1 << tg.id)) !== 0) {
      for (const wid of tg.wallIds) {
        out[wid] = !out[wid];
      }
    }
  }
  return out;
}

export function computeEffectiveShutters(level: LevelConfig, toggleMask: number, shutterCount: number): boolean[] {
  const out = level.openShutters.slice(0, shutterCount);
  for (const tg of level.toggles) {
    if ((toggleMask & (1 << tg.id)) !== 0) {
      for (const sid of tg.shutterIds) {
        out[sid] = !out[sid];
      }
    }
  }
  return out;
}

function findCell(cells: Cell[], band: number, col: number): Cell {
  const spec = BANDS[band];
  const wrapped = ((col % spec.count) + spec.count) % spec.count;
  return cells.find((c) => c.band === band && c.col === wrapped)!;
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
 * Exact State-Space BFS Solver verifying every level's sequential checkpoints, toggles & portal drops!
 * State = (layer: 0 upper | 1 pipe, locId, toggleMask: 0..3, cpIdx: 0..K)
 */
export function solveLevel(
  level: Omit<LevelConfig, 'stats'>,
  cells: Cell[],
  walls: WallSlot[],
  adj: WallSlot[][],
  shutters: ShutterPort[],
  pipeNodes: PipeNode[],
  pipeEdges: PipeEdge[],
): LevelSolutionStats {
  const totalCps = level.checkpoints.length;
  const maxMask = 1 << level.toggles.length;
  const cellToToggle = new Int8Array(cells.length).fill(-1);
  for (const tg of level.toggles) cellToToggle[tg.cellId] = tg.id;

  // Precompute wall/shutter open tables per toggleMask
  const wallsByMask: boolean[][] = [];
  const shuttersByMask: boolean[][] = [];
  for (let m = 0; m < maxMask; m++) {
    const wArr = level.raisedWalls.slice();
    const sArr = level.openShutters.slice();
    for (const tg of level.toggles) {
      if ((m & (1 << tg.id)) !== 0) {
        for (const wid of tg.wallIds) if (!walls[wid].locked) wArr[wid] = !wArr[wid];
        for (const sid of tg.shutterIds) sArr[sid] = !sArr[sid];
      }
    }
    wallsByMask.push(wArr);
    shuttersByMask.push(sArr);
  }

  const locStride = Math.max(cells.length, pipeNodes.length);
  const encode = (layer: number, loc: number, mask: number, cp: number) =>
    (((cp * maxMask + mask) * 2 + layer) * locStride + loc);

  const visited = new Set<number>();
  interface NodeState {
    layer: number;
    loc: number;
    mask: number;
    cp: number;
    steps: number;
    portals: number;
    flips: number;
  }

  const startKey = encode(0, level.startCellId, 0, 0);
  visited.add(startKey);
  const queue: NodeState[] = [{ layer: 0, loc: level.startCellId, mask: 0, cp: 0, steps: 0, portals: 0, flips: 0 }];

  const advanceCp = (layer: number, loc: number, cp: number): number => {
    let next = cp;
    while (next < totalCps) {
      const target = level.checkpoints[next];
      if (layer === 0 && target.layer === 'upper' && target.cellId === loc) {
        next++;
      } else if (layer === 1 && target.layer === 'pipe' && target.pipeNodeId === loc) {
        next++;
      } else {
        break;
      }
    }
    return next;
  };

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur.cp >= totalCps) {
      return {
        solvable: true,
        minSteps: cur.steps,
        portalTransitions: cur.portals,
        toggleFlips: cur.flips,
      };
    }

    const pushState = (layer: number, loc: number, mask: number, portals: number, flips: number) => {
      const nextCp = advanceCp(layer, loc, cur.cp);
      const key = encode(layer, loc, mask, nextCp);
      if (visited.has(key)) return;
      visited.add(key);
      queue.push({ layer, loc, mask, cp: nextCp, steps: cur.steps + 1, portals, flips });
    };

    if (cur.layer === 0) {
      // 1. Roll to adjacent upper cell through any currently retracted wall
      const wState = wallsByMask[cur.mask];
      for (const w of adj[cur.loc]) {
        if (wState[w.id]) continue;
        const nextCell = w.cellA === cur.loc ? w.cellB : w.cellA;
        const tgIdx = cellToToggle[nextCell];
        if (tgIdx >= 0) {
          // Stepping onto a toggle pad flips its bit!
          pushState(0, nextCell, cur.mask ^ (1 << tgIdx), cur.portals, cur.flips + 1);
        }
        pushState(0, nextCell, cur.mask, cur.portals, cur.flips);
      }

      // 2. Drop through an open diaphragm shutter at current cell
      const shId = cells[cur.loc].shutterId;
      if (shId >= 0 && shuttersByMask[cur.mask][shId]) {
        pushState(1, shutters[shId].pipeNodeId, cur.mask, cur.portals + 1, cur.flips);
      }
    } else {
      // 1. Travel along underneath half-pipe edges
      const pNode = pipeNodes[cur.loc];
      for (const eid of pNode.edgeIds) {
        const e = pipeEdges[eid];
        const nextNode = e.nodeA === cur.loc ? e.nodeB : e.nodeA;
        pushState(1, nextNode, cur.mask, cur.portals, cur.flips);
      }

      // 2. Emerge back up through an open diaphragm shutter
      if (pNode.shutterId >= 0 && shuttersByMask[cur.mask][pNode.shutterId]) {
        pushState(0, shutters[pNode.shutterId].cellId, cur.mask, cur.portals + 1, cur.flips);
      }
    }
  }

  return { solvable: false, minSteps: -1, portalTransitions: 0, toggleFlips: 0 };
}

/**
 * Helper to compute BFS distances on the upper deck from a source cell given a wall mask.
 */
function bfsUpper(startId: number, cells: Cell[], adj: WallSlot[][], raised: boolean[]): { dist: Int32Array; parent: Int32Array } {
  const dist = new Int32Array(cells.length).fill(-1);
  const parent = new Int32Array(cells.length).fill(-1);
  const q = [startId];
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
  return { dist, parent };
}

/**
 * Carves a deterministic spanning tree on the upper deck, optionally splitting into isolated
 * Northern & Southern continents (barrierBand) so the player MUST use portals or toggle gates!
 */
function carveUpperWalls(
  seed: number,
  lonBias: number,
  extraOpenFraction: number,
  splitEquator: boolean,
  cells: Cell[],
  walls: WallSlot[],
  adj: WallSlot[][],
): boolean[] {
  const rng = mulberry32(seed);
  const raised = walls.map(() => true);

  const isBarrierWall = (w: WallSlot) => {
    if (!splitEquator) return false;
    // Complete equatorial barrier between Band 3 (north equator) and Band 4 (south equator)!
    const bA = cells[w.cellA].band;
    const bB = cells[w.cellB].band;
    return (bA === 3 && bB === 4) || (bA === 4 && bB === 3);
  };

  const visited = new Uint8Array(cells.length);
  const carveComponent = (rootCell: number) => {
    const stack = [rootCell];
    visited[rootCell] = 1;
    while (stack.length > 0) {
      const u = stack[stack.length - 1];
      const options = adj[u].filter((w) => {
        if (w.locked || isBarrierWall(w)) return false;
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
        if (cells[v].band === BANDS.length - 1) weight -= 0.45;
        return { w, v, weight };
      });
      scored.sort((a, b) => b.weight - a.weight);
      const pick = scored[0];
      raised[pick.w.id] = false;
      visited[pick.v] = 1;
      stack.push(pick.v);
    }
  };

  carveComponent(0);
  if (splitEquator) {
    // Carve southern continent separately from the South Pole!
    carveComponent(cells.length - 1);
  }

  if (extraOpenFraction > 0) {
    const candidates = walls.filter((w) => raised[w.id] && !w.locked && !isBarrierWall(w));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.floor(candidates.length * extraOpenFraction);
    for (let i = 0; i < count; i++) raised[candidates[i].id] = false;
  }

  return raised;
}

/**
 * Finds the unique tree wall on the path from `fromCell` to `toCell` (to turn into a clean puzzle gate!).
 */
function findPathWallBetween(
  fromCell: number,
  toCell: number,
  cells: Cell[],
  adj: WallSlot[][],
  raised: boolean[],
  preferNearTarget = true,
): WallSlot | null {
  const { dist, parent } = bfsUpper(fromCell, cells, adj, raised);
  if (dist[toCell] <= 0) return null;
  const path: number[] = [];
  let c = toCell;
  while (c !== -1) {
    path.push(c);
    c = parent[c];
  }
  path.reverse();
  const order: number[] = [];
  for (let i = 0; i < path.length - 1; i++) order.push(i);
  if (preferNearTarget) order.reverse();

  for (const idx of order) {
    const u = path[idx];
    const v = path[idx + 1];
    const w = adj[u].find((seg) => !seg.locked && ((seg.cellA === u && seg.cellB === v) || (seg.cellA === v && seg.cellB === u)));
    if (w) return w;
  }
  return null;
}

interface LevelBlueprint {
  level: number;
  name: string;
  nameJa: string;
  difficulty: string;
  seed: number;
  lonBias: number;
  extraOpen: number;
  splitEquator: boolean;
  openShutters: boolean[];
  /** Plan of sequential checkpoints: either { band, col } on upper deck or { pipeHub: 0|1|2 } in sub-pipe */
  cpSpecs: ({ band: number; col: number; isFinish?: boolean } | { pipeHub: number })[];
  /** Toggle puzzle specs: each places a TogglePad at a reachable solid cell, seals a gate wall to a target cp, and closes a counter-gate or flips shutters! */
  toggleSpecs: {
    colorId: ToggleColorId;
    label: string;
    padBand: number;
    padCol: number;
    /** Seal the path leading to this checkpoint index until toggled */
    gateToCpIndex?: number;
    /** Also link a counter-wall (initially OPEN, closes when toggled!) near this cell/cp */
    closeCounterToCpIndex?: number;
    /** Optional equatorial gate wall col (between Band 3 & Band 4) that opens when toggled */
    equatorGateCol?: number;
    /** Diaphragm shutter IDs that flip open/closed when this toggle is pressed */
    shutterIds?: number[];
  }[];
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

  // --- 1. Six Diaphragm Iris Shutters spanning Northern & Southern Hemispheres (bands 2..5, 16 cols) ---
  // Hero front view centers around theta ~ 1.25 rad (col 3-4 of 16-cell bands).
  const shutterSpecs: { band: number; col: number; label: string }[] = [
    { band: 2, col: 3, label: 'A' }, // North-front (easy access from Start!)
    { band: 4, col: 2, label: 'B' }, // South-front-right (across the equator!)
    { band: 3, col: 6, label: 'C' }, // North-left
    { band: 5, col: 7, label: 'D' }, // South-back-left
    { band: 2, col: 11, label: 'E' }, // North-back
    { band: 4, col: 13, label: 'F' }, // South-right-back
  ];

  const shutters: ShutterPort[] = [];
  const pipeNodes: PipeNode[] = [];

  for (let i = 0; i < shutterSpecs.length; i++) {
    const sp = shutterSpecs[i];
    const cell = findCell(cells, sp.band, sp.col);
    cell.panelKind = 'shutter';
    cell.shutterId = i;

    const nodeId = pipeNodes.length;
    pipeNodes.push({ id: nodeId, dir: cell.centerDir.clone(), shutterId: i, edgeIds: [] });
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

  // 3 Interior Half-Pipe Junction Hubs (sitting directly beneath transparent floor window panels!)
  const hubSpecs: { band: number; col: number }[] = [
    { band: 3, col: 3 }, // Hub 0 (node 6): Front-center directly visible right on boot!
    { band: 4, col: 8 }, // Hub 1 (node 7): Back-left southern hub
    { band: 3, col: 13 }, // Hub 2 (node 8): Back-right northern hub
  ];
  const hubNodeIds: number[] = [];
  for (const hs of hubSpecs) {
    const cell = findCell(cells, hs.band, hs.col);
    const nodeId = pipeNodes.length;
    pipeNodes.push({ id: nodeId, dir: cell.centerDir.clone(), shutterId: -1, edgeIds: [] });
    hubNodeIds.push(nodeId);
  }

  // Connected sculptural underneath half-pipe network bridging all 6 shutters across the equator!
  // 0=A(N), 1=B(S), 2=C(N), 3=D(S), 4=E(N), 5=F(S), 6=HubFront, 7=HubBackLeft, 8=HubBackRight
  const pipePairs: [number, number][] = [
    [0, 6], // A (North) <-> HubFront
    [1, 6], // B (South) <-> HubFront
    [2, 6], // C (North-Left) <-> HubFront
    [2, 7], // C <-> HubBackLeft
    [3, 7], // D (South) <-> HubBackLeft
    [4, 7], // E (North-Back) <-> HubBackLeft
    [4, 8], // E <-> HubBackRight
    [5, 8], // F (South) <-> HubBackRight
    [1, 8], // B <-> HubBackRight
    [6, 8], // HubFront <-> HubBackRight
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

  // Mark floor cells directly above the half-pipe network as TRANSPARENT POLYCARBONATE WINDOWS
  const samplePt = new THREE.Vector3();
  for (const edge of pipeEdges) {
    const dA = pipeNodes[edge.nodeA].dir;
    const dB = pipeNodes[edge.nodeB].dir;
    for (let s = 0; s <= 10; s++) {
      samplePt.copy(dA).lerp(dB, s / 10).normalize();
      let bestCell: Cell | null = null;
      let bestDot = -2;
      for (const c of cells) {
        if (c.band <= 1 || c.band >= BANDS.length - 2) continue;
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

  // --- 2. Build 88 steady corner poles & 176 thin modular wall slots ---
  const posts: VertexPost[] = [];
  const postKeyToId = new Map<string, number>();

  const getOrCreatePost = (phi: number, theta: number): number => {
    const normTheta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const kTheta = Math.round(normTheta * 1000) % Math.round(Math.PI * 2 * 1000);
    const key = `${Math.round(phi * 1000)}_${kTheta}`;
    const existing = postKeyToId.get(key);
    if (existing !== undefined) return existing;
    const id = posts.length;
    posts.push({ id, phi, theta: normTheta, dir: sphToDir(phi, normTheta), wallIds: [], locked: false });
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
    walls.push({
      id,
      kind,
      cellA,
      cellB,
      phiStart,
      phiEnd,
      thetaStart,
      thetaEnd,
      midDir: sphToDir(0.5 * (phiStart + phiEnd), 0.5 * (thetaStart + thetaEnd)),
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
      addWall('lon', base + c, base + next, spec.phiStart, spec.phiEnd, (c + 1) * dTheta, (c + 1) * dTheta);
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
      addWall('lat', upperBase + uCol, lowerBase + lCol, phi, phi, k * dTheta, (k + 1) * dTheta);
    }
  }

  const adj: WallSlot[][] = Array.from({ length: cells.length }, () => []);
  for (const w of walls) {
    adj[w.cellA].push(w);
    adj[w.cellB].push(w);
  }

  // --- 3. Permanently Locked Structural Anchor Walls (~18 walls with etched padlocks) ---
  const lockedMask = walls.map(() => false);
  const lockRng = mulberry32(1309);
  const lockCandidates = walls
    .filter((w) => w.kind === 'lat' && cells[w.cellA].band >= 1 && cells[w.cellB].band <= 6)
    .sort(() => lockRng() - 0.5);

  // Front-upper polar cradle wall so the steel ball rests visibly at 00 START on boot
  const cradleWall = walls.find((w) => w.kind === 'lat' && w.cellA === 0 && w.thetaStart >= 0.7 && w.thetaStart <= 1.7);
  let lockedCount = 0;
  if (cradleWall) {
    lockedMask[cradleWall.id] = true;
    cradleWall.locked = true;
    posts[cradleWall.postA].locked = true;
    posts[cradleWall.postB].locked = true;
    lockedCount++;
  }

  for (const w of lockCandidates) {
    if (lockedCount >= 18) break;
    if (w.locked) continue;
    // Keep locked walls out of the equatorial split seam so toggle gates can cleanly open equatorial bridges!
    if (cells[w.cellA].band === 3 && cells[w.cellB].band === 4) continue;
    const tooClose = walls.some((o) => o.locked && o.midDir.dot(w.midDir) > 0.76);
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

  const arrowRng = mulberry32(4419);
  const arrowCandidates = walls.filter((w) => !w.locked && w.kind === 'lat').sort(() => arrowRng() - 0.5);
  let arrowCount = 0;
  for (const w of arrowCandidates) {
    if (arrowCount >= 14) break;
    const tooClose = walls.some((o) => o.hasArrow && o.midDir.dot(w.midDir) > 0.65);
    if (tooClose) continue;
    w.hasArrow = true;
    arrowCount++;
  }

  // Helper: pick nearest solid cell to (band, col) that isn't already used by a checkpoint or toggle
  const pickSolidCell = (band: number, col: number, avoidIds: Set<number>): Cell => {
    const spec = BANDS[band];
    for (let d = 0; d < spec.count; d++) {
      for (const sgn of d === 0 ? [0] : [1, -1]) {
        const c = findCell(cells, band, col + sgn * d);
        if (c.panelKind === 'solid' && !avoidIds.has(c.id)) return c;
      }
    }
    // Fallback to any solid cell in neighboring band
    for (const c of cells) {
      if (c.panelKind === 'solid' && !avoidIds.has(c.id) && c.id !== 0 && c.id !== cells.length - 1) return c;
    }
    return findCell(cells, band, col);
  };

  // --- 4. Ten Curated Progressive Puzzle Levels (01 dead easy -> 10 super hard!) ---
  const blueprints: LevelBlueprint[] = [
    // LEVEL 01: FIRST ROLL — crisp winding corridors with clear turns around the sphere (01 -> 02 -> 13), no portals, no switches
    {
      level: 1,
      name: 'FIRST ROLL',
      nameJa: '初転',
      difficulty: 'EASY · TURN',
      seed: 1019,
      lonBias: 0.28,
      extraOpen: 0.36,
      splitEquator: false,
      openShutters: [false, false, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 7 },
        { band: 5, col: 10 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [],
    },
    // LEVEL 02: PORTAL INTRO — split equator with turning corridors on both sides (01 -> Shutter A -> U2 -> Shutter B -> 13)
    {
      level: 2,
      name: 'IRIS PORTAL',
      nameJa: '虹彩門',
      difficulty: 'EASY · PORTAL',
      seed: 2029,
      lonBias: 0.32,
      extraOpen: 0.3,
      splitEquator: true,
      openShutters: [true, true, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 4 },
        { pipeHub: 0 }, // Glowing right beneath front window!
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [],
    },
    // LEVEL 03: FIRST SWITCH — split equator bridged by Red gate (SW A is 100% required!)
    {
      level: 3,
      name: 'FIRST SWITCH',
      nameJa: '初切換',
      difficulty: 'PLAN · SWITCH',
      seed: 3041,
      lonBias: 0.26,
      extraOpen: 0.22,
      splitEquator: true,
      openShutters: [false, false, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 6 },
        { band: 5, col: 4 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 2,
          padCol: 1,
          equatorGateCol: 4, // Must flip Red A to drop the glowing equator gate bridge into South!
          closeCounterToCpIndex: 0, // Flipping A closes a counter-wall near 01!
        },
      ],
    },
    // LEVEL 04: UNDERPASS — Equator completely walled off! Must drop through North shutter into half-pipe to reach South!
    {
      level: 4,
      name: 'UNDERPASS',
      nameJa: '地下道',
      difficulty: 'PLAN · SPLIT',
      seed: 4057,
      lonBias: 0.32,
      extraOpen: 0.18,
      splitEquator: true,
      openShutters: [true, true, true, false, false, false],
      cpSpecs: [
        { band: 2, col: 8 },
        { pipeHub: 0 },
        { band: 5, col: 11 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [],
    },
    // LEVEL 05: SHUTTER LOCK — Equator walled off & exit Shutter B starts CLOSED! Must flip Red Toggle A to iris Shutter B OPEN!
    {
      level: 5,
      name: 'SHUTTER LOCK',
      nameJa: '閉門鍵',
      difficulty: 'PLAN · IRIS',
      seed: 5077,
      lonBias: 0.36,
      extraOpen: 0.08,
      splitEquator: true,
      openShutters: [true, false, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 11 },
        { pipeHub: 0 },
        { band: 5, col: 9 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 2,
          padCol: 14,
          shutterIds: [1], // Pressing Red A irises South Shutter B OPEN so you can emerge in the South!
          closeCounterToCpIndex: 0,
        },
      ],
    },
    // LEVEL 06: COUNTERWEIGHT — Flipping Coral A opens the path to 02 while closing a gate & swapping shutters!
    {
      level: 6,
      name: 'COUNTERWEIGHT',
      nameJa: '均衡',
      difficulty: 'TRICKY',
      seed: 6089,
      lonBias: 0.4,
      extraOpen: 0.0,
      splitEquator: false,
      openShutters: [true, false, true, true, false, false],
      cpSpecs: [
        { band: 2, col: 14 },
        { band: 5, col: 5 },
        { pipeHub: 1 },
        { band: 6, col: 2 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 1,
          padCol: 3,
          gateToCpIndex: 1,
          closeCounterToCpIndex: 3,
          shutterIds: [1, 2],
        },
      ],
    },
    // LEVEL 07: DUAL CIRCUIT — Two independent Toggles (Coral A & Cobalt B) controlling separate gates and portals!
    {
      level: 7,
      name: 'DUAL CIRCUIT',
      nameJa: '二重回路',
      difficulty: 'HARD',
      seed: 7109,
      lonBias: 0.48,
      extraOpen: 0.0,
      splitEquator: true,
      openShutters: [true, false, true, false, false, false],
      cpSpecs: [
        { band: 2, col: 10 },
        { pipeHub: 0 },
        { band: 5, col: 1 },
        { band: 5, col: 12 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 1,
          padCol: 6,
          shutterIds: [1],
          closeCounterToCpIndex: 0,
        },
        {
          colorId: 1,
          label: 'B',
          padBand: 5,
          padCol: 4,
          gateToCpIndex: 3,
          shutterIds: [5],
        },
      ],
    },
    // LEVEL 08: WINDING VAULT — Pure zero-loop spanning tree, split equator + dual mandatory toggles + multi-portal zig-zag!
    {
      level: 8,
      name: 'WINDING VAULT',
      nameJa: '迷廊',
      difficulty: 'HARD',
      seed: 8123,
      lonBias: 0.52,
      extraOpen: 0.0,
      splitEquator: true,
      openShutters: [true, false, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 1 },
        { pipeHub: 2 },
        { band: 5, col: 10 },
        { band: 1, col: 5 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 2,
          padCol: 7,
          equatorGateCol: 10,
          shutterIds: [1, 3], // Must flip Red A to open the South route & shutters!
        },
        {
          colorId: 1,
          label: 'B',
          padBand: 6,
          padCol: 6,
          gateToCpIndex: 4, // Must flip Blue B to unlock 13 END!
          shutterIds: [2],
        },
      ],
    },
    // LEVEL 09: PARADOX — Split equator, pure tight corridors, alternating North -> Pipe -> South -> North -> Pipe -> South!
    {
      level: 9,
      name: 'PARADOX',
      nameJa: '逆説',
      difficulty: 'VERY HARD',
      seed: 9137,
      lonBias: 0.48,
      extraOpen: 0.0,
      splitEquator: true,
      openShutters: [true, false, false, false, false, false],
      cpSpecs: [
        { band: 2, col: 14 },
        { pipeHub: 1 },
        { band: 5, col: 9 },
        { band: 1, col: 1 },
        { pipeHub: 2 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 2,
          padCol: 5,
          shutterIds: [1, 4],
          equatorGateCol: 1,
        },
        {
          colorId: 1,
          label: 'B',
          padBand: 5,
          padCol: 14,
          gateToCpIndex: 5,
          shutterIds: [2, 5],
        },
      ],
    },
    // LEVEL 10: MASTER SPHERE — Super hard finale! Split equator, 6 strict sequential checkpoints across both decks & dual cross-linked toggles!
    {
      level: 10,
      name: 'MASTER SPHERE',
      nameJa: '極球',
      difficulty: 'SUPER HARD',
      seed: 10177,
      lonBias: 0.56,
      extraOpen: 0.0,
      splitEquator: true,
      openShutters: [false, false, true, false, false, false],
      cpSpecs: [
        { band: 2, col: 10 },
        { pipeHub: 0 },
        { band: 5, col: 11 },
        { pipeHub: 2 },
        { band: 2, col: 1 },
        { band: 7, col: 0, isFinish: true },
      ],
      toggleSpecs: [
        {
          colorId: 0,
          label: 'A',
          padBand: 1,
          padCol: 5,
          shutterIds: [0, 1],
          gateToCpIndex: 4,
          closeCounterToCpIndex: 0,
        },
        {
          colorId: 1,
          label: 'B',
          padBand: 6,
          padCol: 4,
          gateToCpIndex: 5,
          closeCounterToCpIndex: 2,
          shutterIds: [4, 5],
        },
      ],
    },
  ];

  const levels: LevelConfig[] = blueprints.map((bp) => {
    const raisedWalls = carveUpperWalls(bp.seed, bp.lonBias, bp.extraOpen, bp.splitEquator, cells, walls, adj);
    const openShutters = bp.openShutters.slice();

    const usedCells = new Set<number>([0]);
    const checkpoints: Checkpoint[] = [];

    for (let i = 0; i < bp.cpSpecs.length; i++) {
      const spec = bp.cpSpecs[i];
      if ('pipeHub' in spec) {
        const pn = pipeNodes[hubNodeIds[spec.pipeHub]];
        checkpoints.push({
          index: i,
          cellId: -1,
          pipeNodeId: pn.id,
          layer: 'pipe',
          label: `U${i + 1}`,
          dir: pn.dir.clone(),
          isFinish: false,
        });
      } else {
        const isFinish = !!spec.isFinish;
        const c = isFinish ? cells[cells.length - 1] : pickSolidCell(spec.band, spec.col, usedCells);
        usedCells.add(c.id);
        checkpoints.push({
          index: i,
          cellId: c.id,
          pipeNodeId: -1,
          layer: 'upper',
          label: isFinish ? '13' : String(i + 1).padStart(2, '0'),
          dir: c.centerDir.clone(),
          isFinish,
        });
      }
    }

    // Build mechanical Toggle Pads & wire their gate walls (raising blocked gates & linking counter-walls!)
    const toggles: TogglePad[] = [];
    const claimedGateWalls = new Set<number>();

    for (let ti = 0; ti < bp.toggleSpecs.length; ti++) {
      const ts = bp.toggleSpecs[ti];
      const padCell = pickSolidCell(ts.padBand, ts.padCol, usedCells);
      usedCells.add(padCell.id);
      const wallIds: number[] = [];

      // 1. Primary gate wall: initially RAISED (blocking access to target checkpoint until toggled!)
      if (ts.gateToCpIndex !== undefined && checkpoints[ts.gateToCpIndex]?.layer === 'upper') {
        const targetCell = checkpoints[ts.gateToCpIndex].cellId;
        const srcCell = cells[targetCell].band >= 4 && bp.splitEquator ? cells.length - 1 : 0;
        // Find an open corridor wall leading into targetCell (different from padCell's own side!)
        const gateWall = findPathWallBetween(
          targetCell === cells.length - 1 ? padCell.id : srcCell,
          targetCell,
          cells,
          adj,
          raisedWalls,
          true,
        );
        if (gateWall && !claimedGateWalls.has(gateWall.id)) {
          // Make sure closing this gate does NOT block access to padCell itself from srcCell!
          raisedWalls[gateWall.id] = true;
          const checkReach = bfsUpper(srcCell, cells, adj, raisedWalls);
          if (srcCell === 0 && checkReach.dist[padCell.id] === -1) {
            // Revert if it blocked the switch itself
            raisedWalls[gateWall.id] = false;
          } else {
            claimedGateWalls.add(gateWall.id);
            wallIds.push(gateWall.id);
          }
        }
      }

      // 2. Counter-gate wall: initially OPEN (retracted), POPS OUT when toggled!
      if (ts.closeCounterToCpIndex !== undefined && checkpoints[ts.closeCounterToCpIndex]?.layer === 'upper') {
        const targetCell = checkpoints[ts.closeCounterToCpIndex].cellId;
        const srcCell = cells[targetCell].band >= 4 && bp.splitEquator ? cells.length - 1 : 0;
        const counterWall = findPathWallBetween(srcCell, targetCell, cells, adj, raisedWalls, true);
        if (counterWall && !claimedGateWalls.has(counterWall.id) && !raisedWalls[counterWall.id]) {
          claimedGateWalls.add(counterWall.id);
          wallIds.push(counterWall.id);
        }
      }

      // 3. Optional equatorial bridge gate wall (starts RAISED on split equator, retracts when toggled!)
      if (ts.equatorGateCol !== undefined) {
        const nCell = findCell(cells, 3, ts.equatorGateCol);
        const sCell = findCell(cells, 4, ts.equatorGateCol);
        const eqWall = adj[nCell.id].find(
          (w) => !w.locked && ((w.cellA === nCell.id && w.cellB === sCell.id) || (w.cellA === sCell.id && w.cellB === nCell.id)),
        );
        if (eqWall && !claimedGateWalls.has(eqWall.id)) {
          raisedWalls[eqWall.id] = true;
          claimedGateWalls.add(eqWall.id);
          wallIds.push(eqWall.id);
        }
      }

      toggles.push({
        id: ti,
        colorId: ts.colorId,
        label: ts.label,
        cellId: padCell.id,
        dir: padCell.centerDir.clone(),
        wallIds,
        shutterIds: ts.shutterIds ? ts.shutterIds.slice() : [],
      });
    }

    const partial: Omit<LevelConfig, 'stats'> = {
      level: bp.level,
      name: bp.name,
      nameJa: bp.nameJa,
      difficulty: bp.difficulty,
      seed: bp.seed,
      raisedWalls,
      openShutters,
      toggles,
      startCellId: 0,
      checkpoints,
    };

    let stats = solveLevel(partial, cells, walls, adj, shutters, pipeNodes, pipeEdges);

    // Safety net: if a counter-gate ever caused a subtle deadlock, drop that counter-gate and re-verify!
    if (!stats.solvable) {
      for (const tg of toggles) {
        tg.wallIds = tg.wallIds.filter((wid) => raisedWalls[wid]); // keep opening gates, drop blocking counter-gates
      }
      stats = solveLevel(partial, cells, walls, adj, shutters, pipeNodes, pipeEdges);
    }

    return { ...partial, stats };
  });

  return { cells, walls, posts, shutters, pipeNodes, pipeEdges, levels };
}
