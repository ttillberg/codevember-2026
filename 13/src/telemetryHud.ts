import * as THREE from 'three';
import {
  R_BALL_CENTER,
  R_BALL_PIPE,
  R_FLOOR,
  R_PIPE_FLOOR,
  R_SHELL,
  R_WALL,
  type LevelConfig,
  type SphereGrid,
  type WallSlot,
} from './maze';
import type { BallLayer, ReadyPortal } from './physics';

export interface TelemetryFrameState {
  time: number;
  elapsedSec: number;
  camera: THREE.PerspectiveCamera;
  sphereRoot: THREE.Object3D;
  grid: SphereGrid;
  level: LevelConfig;
  ballDir: THREE.Vector3;
  ballRadius: number;
  ballLayer: BallLayer;
  gravityWorldDir: THREE.Vector3;
  clearedMask: boolean[];
  nextCpIdx: number;
  allCleared: boolean;
  readyPortal: ReadyPortal;
  readyDwell: number;
  toggleMask: number;
  togglePulse: Float32Array;
  wallExt: Float32Array;
  shutterOpen: Float32Array;
  inTransition: boolean;
}

interface ProjectedPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  front: number;
  visible: boolean;
}

interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT_TITLE = '600 7.5px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
const FONT_SUB = '500 6.5px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
const FONT_MICRO = '500 6.5px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
// Matches the physical Ø120MM stamp on the polycarbonate outer shell (radius = 60mm)
const MM_PER_UNIT = 60 / R_SHELL;

const COLOR_INK = '#1c1c1c';
const COLOR_MUTED = '#5a5650';
const COLOR_AMBER = '#d9620f';
const COLOR_TEAL = '#0d9688';
const COLOR_MINT = '#12995c';
const COLOR_RED = '#d61414';
const COLOR_BLUE = '#1050e8';

const NORTH_DIR = new THREE.Vector3(0, 1, 0);

function snap(v: number): number {
  return Math.round(v) + 0.5;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fmtTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Optical vector tracking HUD overlay:
 * Projects live 3D sphere landmarks (START / NORTH POLE 00:00, sequential TARGET 1..N with
 * ACTIVE/INACTIVE/CLEARED state, SWITCH A/B linked by hairline vectors to related DOORs & PORTALs,
 * and SOUTH POLE EXIT) into crisp 1px tracking geometry and floating monospace labels.
 */
export class TelemetryOverlay {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private enabled = true;

  // Scratch vectors (zero per-frame allocations)
  private readonly worldPos = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();
  private readonly sphereCenter = new THREE.Vector3();
  private readonly outwardWorld = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly ballWorldDir = new THREE.Vector3();
  private readonly gravArcDir = new THREE.Vector3();
  private readonly gravArcAxis = new THREE.Vector3();
  private readonly gravArcQuat = new THREE.Quaternion();

  // Cached grid adjacency & live A* shortest path distance to active next target
  private cachedGrid: SphereGrid | null = null;
  private cachedAdj: WallSlot[][] = [];
  private aStarCacheKey = '';
  private aStarCachedMm = 0;
  private aStarFirstStepDir: THREE.Vector3 | null = null;
  private aStarTailMm = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  private ensureAdjacency(grid: SphereGrid) {
    if (this.cachedGrid === grid) return;
    this.cachedGrid = grid;
    this.cachedAdj = Array.from({ length: grid.cells.length }, () => []);
    for (const w of grid.walls) {
      this.cachedAdj[w.cellA].push(w);
      this.cachedAdj[w.cellB].push(w);
    }
  }

  /**
   * Computes exact A* shortest maze path distance (in mm on the Ø120MM sphere) from the ball's
   * current cell/pipe node to the active next target across both layers and toggle states.
   */
  private computeAStarDistanceMm(st: TelemetryFrameState): number {
    const { grid, level, ballDir, ballLayer, nextCpIdx, toggleMask } = st;
    if (nextCpIdx < 0 || nextCpIdx >= level.checkpoints.length) return 0;
    const targetCp = level.checkpoints[nextCpIdx];
    this.ensureAdjacency(grid);

    const isPipe = ballLayer === 'pipe';
    let curLoc = 0;
    let bestDot = -2;
    if (isPipe) {
      for (let i = 0; i < grid.pipeNodes.length; i++) {
        const d = ballDir.dot(grid.pipeNodes[i].dir);
        if (d > bestDot) {
          bestDot = d;
          curLoc = i;
        }
      }
    } else {
      for (let i = 0; i < grid.cells.length; i++) {
        const d = ballDir.dot(grid.cells[i].centerDir);
        if (d > bestDot) {
          bestDot = d;
          curLoc = i;
        }
      }
    }

    const startLayer = isPipe ? 1 : 0;
    const goalLayer = targetCp.layer === 'pipe' ? 1 : 0;
    const goalLoc = goalLayer === 1 ? targetCp.pipeNodeId : targetCp.cellId;

    // Already in the target cell/node: exact direct arc distance
    if (startLayer === goalLayer && curLoc === goalLoc) {
      const r = isPipe ? R_BALL_PIPE : R_BALL_CENTER;
      return Math.acos(Math.max(-1, Math.min(1, ballDir.dot(targetCp.dir)))) * r * MM_PER_UNIT;
    }

    const cacheKey = `${level.level}:${startLayer}:${curLoc}:${nextCpIdx}:${toggleMask}`;
    if (cacheKey !== this.aStarCacheKey) {
      this.aStarCacheKey = cacheKey;
      const { cells, walls, shutters, pipeNodes, pipeEdges } = grid;
      const maxMask = 1 << level.toggles.length;
      const locStride = Math.max(cells.length, pipeNodes.length);
      const encode = (layer: number, loc: number, mask: number) => (mask * 2 + layer) * locStride + loc;

      const cellToToggle = new Int8Array(cells.length).fill(-1);
      for (const tg of level.toggles) cellToToggle[tg.cellId] = tg.id;

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

      const dirOf = (layer: number, loc: number) => (layer === 1 ? pipeNodes[loc].dir : cells[loc].centerDir);
      const heuristic = (layer: number, loc: number) => {
        const d = Math.max(-1, Math.min(1, dirOf(layer, loc).dot(targetCp.dir)));
        return Math.acos(d) * R_BALL_PIPE * MM_PER_UNIT;
      };

      const startKey = encode(startLayer, curLoc, toggleMask);
      const gScore = new Map<number, number>([[startKey, 0]]);
      const parentMap = new Map<number, { prev: number; layer: number; loc: number }>();
      // Lightweight binary-scan open set (graph has ~100–500 reachable nodes, runs in <0.05ms)
      const open: { key: number; layer: number; loc: number; mask: number; g: number; f: number }[] = [
        { key: startKey, layer: startLayer, loc: curLoc, mask: toggleMask, g: 0, f: heuristic(startLayer, curLoc) },
      ];
      const closed = new Set<number>();

      let foundKey = -1;
      let foundDist = -1;

      while (open.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
          if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        const cur = open[bestIdx];
        open[bestIdx] = open[open.length - 1];
        open.pop();

        if (closed.has(cur.key)) continue;
        closed.add(cur.key);

        if (cur.layer === goalLayer && cur.loc === goalLoc) {
          foundKey = cur.key;
          foundDist = cur.g;
          break;
        }

        const relax = (nLayer: number, nLoc: number, nMask: number, stepCost: number) => {
          const nk = encode(nLayer, nLoc, nMask);
          if (closed.has(nk)) return;
          const ng = cur.g + stepCost;
          const prevG = gScore.get(nk);
          if (prevG === undefined || ng < prevG) {
            gScore.set(nk, ng);
            parentMap.set(nk, { prev: cur.key, layer: nLayer, loc: nLoc });
            open.push({ key: nk, layer: nLayer, loc: nLoc, mask: nMask, g: ng, f: ng + heuristic(nLayer, nLoc) });
          }
        };

        if (cur.layer === 0) {
          const wState = wallsByMask[cur.mask];
          const curDir = cells[cur.loc].centerDir;
          const list = this.cachedAdj[cur.loc];
          for (let i = 0; i < list.length; i++) {
            const w = list[i];
            if (wState[w.id]) continue;
            const nxt = w.cellA === cur.loc ? w.cellB : w.cellA;
            const arcMm = Math.acos(Math.max(-1, Math.min(1, curDir.dot(cells[nxt].centerDir)))) * R_BALL_CENTER * MM_PER_UNIT;
            relax(0, nxt, cur.mask, arcMm);
            const tgIdx = cellToToggle[nxt];
            if (tgIdx >= 0) {
              relax(0, nxt, cur.mask ^ (1 << tgIdx), arcMm);
            }
          }
          const shId = cells[cur.loc].shutterId;
          if (shId >= 0 && shuttersByMask[cur.mask][shId]) {
            relax(1, shutters[shId].pipeNodeId, cur.mask, (R_BALL_CENTER - R_BALL_PIPE) * MM_PER_UNIT);
          }
        } else {
          const pNode = pipeNodes[cur.loc];
          for (let i = 0; i < pNode.edgeIds.length; i++) {
            const e = pipeEdges[pNode.edgeIds[i]];
            const nxt = e.nodeA === cur.loc ? e.nodeB : e.nodeA;
            relax(1, nxt, cur.mask, e.arcLen * R_BALL_PIPE * MM_PER_UNIT);
          }
          if (pNode.shutterId >= 0 && shuttersByMask[cur.mask][pNode.shutterId]) {
            relax(0, shutters[pNode.shutterId].cellId, cur.mask, (R_BALL_CENTER - R_BALL_PIPE) * MM_PER_UNIT);
          }
        }
      }

      if (foundKey >= 0) {
        this.aStarCachedMm = foundDist;
        // Trace back to first step from startKey so live sub-cell rolling updates smoothly!
        let trace = foundKey;
        let firstNode: { layer: number; loc: number } | null = null;
        while (trace !== startKey) {
          const p = parentMap.get(trace);
          if (!p) break;
          if (p.prev === startKey) {
            firstNode = { layer: p.layer, loc: p.loc };
            break;
          }
          trace = p.prev;
        }
        if (firstNode && firstNode.layer === startLayer) {
          this.aStarFirstStepDir = dirOf(firstNode.layer, firstNode.loc);
          const firstKey = encode(firstNode.layer, firstNode.loc, toggleMask);
          const firstStepG = gScore.get(firstKey) ?? 0;
          this.aStarTailMm = Math.max(0, foundDist - firstStepG);
        } else {
          this.aStarFirstStepDir = null;
          this.aStarTailMm = foundDist;
        }
      } else {
        this.aStarCachedMm = -1;
        this.aStarFirstStepDir = null;
        this.aStarTailMm = 0;
      }
    }

    if (this.aStarCachedMm < 0) return -1;
    if (this.aStarFirstStepDir) {
      const r = isPipe ? R_BALL_PIPE : R_BALL_CENTER;
      const liveFirst = Math.acos(Math.max(-1, Math.min(1, ballDir.dot(this.aStarFirstStepDir)))) * r * MM_PER_UNIT;
      return liveFirst + this.aStarTailMm;
    }
    return this.aStarCachedMm;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  resize(cssWidth: number, cssHeight: number) {
    this.width = Math.max(1, cssWidth);
    this.height = Math.max(1, cssHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  private projectLocal(
    localDir: THREE.Vector3,
    radius: number,
    sphereRoot: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
  ): ProjectedPoint {
    this.worldPos.copy(localDir).multiplyScalar(radius).applyMatrix4(sphereRoot.matrixWorld);
    this.outwardWorld.subVectors(this.worldPos, this.sphereCenter).normalize();
    this.toCam.subVectors(camera.position, this.worldPos).normalize();
    const front = this.outwardWorld.dot(this.toCam);

    this.ndc.copy(this.worldPos).project(camera);
    const nx = (this.ndc.x + 1) * 0.5;
    const ny = (1 - this.ndc.y) * 0.5;
    return {
      x: nx * this.width,
      y: ny * this.height,
      nx,
      ny,
      front,
      visible: this.ndc.z >= -1 && this.ndc.z <= 1,
    };
  }

  private depthAlpha(front: number, baseFront = 0.88, baseBack = 0.18): number {
    const t = clamp01((front + 0.14) / 0.42);
    const smooth = t * t * (3 - 2 * t);
    return baseBack + (baseFront - baseBack) * smooth;
  }

  /** Open 4-corner optical tracking brackets `┌ ┐ └ ┘` */
  private drawBrackets(
    cx: number,
    cy: number,
    halfSize: number,
    arm: number,
    strokeStyle: string,
    alpha: number,
    lineWidth = 1.25,
  ) {
    if (alpha <= 0.02) return;
    const ctx = this.ctx;
    const x0 = snap(cx - halfSize);
    const y0 = snap(cy - halfSize);
    const x1 = snap(cx + halfSize);
    const y1 = snap(cy + halfSize);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + arm);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + arm, y0);
    ctx.moveTo(x1 - arm, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + arm);
    ctx.moveTo(x1, y1 - arm);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - arm, y1);
    ctx.moveTo(x0 + arm, y1);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0, y1 - arm);
    ctx.stroke();
    ctx.restore();
  }

  /** Tiny square tracking node `□` with center pixel dot and optional accent `+` tick */
  private drawNodeSquare(
    cx: number,
    cy: number,
    halfSize: number,
    strokeStyle: string,
    alpha: number,
    accentTick?: string,
  ) {
    if (alpha <= 0.02) return;
    const ctx = this.ctx;
    const s = Math.max(3, Math.round(halfSize * 2));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 0.75;
    ctx.strokeRect(snap(cx - halfSize), snap(cy - halfSize), s, s);

    ctx.fillStyle = accentTick || strokeStyle;
    ctx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);

    if (accentTick) {
      const tx = snap(cx + halfSize + 3);
      const ty = snap(cy);
      ctx.strokeStyle = accentTick;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(tx - 1.6, ty);
      ctx.lineTo(tx + 1.6, ty);
      ctx.moveTo(tx, ty - 1.6);
      ctx.lineTo(tx, ty + 1.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Precision hairline vector connecting line (dashed when occluded / inactive) */
  private drawLinkLine(
    a: ProjectedPoint,
    b: ProjectedPoint,
    strokeStyle: string,
    alpha: number,
    dashed = false,
    lineWidth = 0.75,
  ) {
    if (alpha <= 0.02) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(snap(a.x), snap(a.y));
    ctx.lineTo(snap(b.x), snap(b.y));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Micro-scale floating borderless two-line monospace label (~50% Leica viewfinder proportions)
   * with automatic collision avoidance and razor-thin leader line.
   */
  private drawCallout(
    anchorX: number,
    anchorY: number,
    title: string,
    sub: string,
    accent: string,
    alpha: number,
    placed: LabelRect[],
    prefer: 'top' | 'bottom' | 'auto' = 'auto',
    drawLeader = true,
  ) {
    if (alpha <= 0.05) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = FONT_TITLE;
    const tw = ctx.measureText(title).width;
    ctx.font = FONT_SUB;
    const sw = ctx.measureText(sub).width;
    const padX = 3.5;
    const padY = 2.5;
    const boxW = Math.ceil(Math.max(tw, sw) + padX * 2 + 2);
    const boxH = 18;

    const rightBias = anchorX < this.width * 0.56 ? 1 : -1;
    const candidates: [number, number][] =
      prefer === 'top'
        ? [
            [-boxW * 0.5, -26],
            [14 * rightBias - (rightBias < 0 ? boxW : 0), -19],
            [-boxW * 0.5, 13],
            [14 * -rightBias - (-rightBias < 0 ? boxW : 0), -19],
          ]
        : prefer === 'bottom'
          ? [
              [-boxW * 0.5, 13],
              [14 * rightBias - (rightBias < 0 ? boxW : 0), 7],
              [-boxW * 0.5, -25],
            ]
          : [
              [14 * rightBias - (rightBias < 0 ? boxW : 0), -17],
              [-boxW * 0.5, -25],
              [14 * rightBias - (rightBias < 0 ? boxW : 0), 7],
              [14 * -rightBias - (-rightBias < 0 ? boxW : 0), -17],
              [-boxW * 0.5, 13],
            ];

    const marginX = 16;
    const marginTop = 88;
    const marginBottom = 78;
    let bestX = Math.max(marginX, Math.min(this.width - boxW - marginX, anchorX + candidates[0][0]));
    let bestY = Math.max(marginTop, Math.min(this.height - boxH - marginBottom, anchorY + candidates[0][1]));

    for (const [ox, oy] of candidates) {
      const cx = Math.max(marginX, Math.min(this.width - boxW - marginX, anchorX + ox));
      const cy = Math.max(marginTop, Math.min(this.height - boxH - marginBottom, anchorY + oy));
      const overlaps = placed.some(
        (r) => cx < r.x + r.w + 4 && cx + boxW + 4 > r.x && cy < r.y + r.h + 3 && cy + boxH + 3 > r.y,
      );
      if (!overlaps) {
        bestX = cx;
        bestY = cy;
        break;
      }
    }

    const bx = Math.round(bestX);
    const by = Math.round(bestY);
    placed.push({ x: bx, y: by, w: boxW, h: boxH });

    if (drawLeader) {
      const boxCx = bx + boxW * 0.5;
      const boxCy = by + boxH * 0.5;
      let ex = bx;
      let ey = boxCy;
      const verticallyStacked = anchorX >= bx - 4 && anchorX <= bx + boxW + 4;
      if (verticallyStacked) {
        ex = bx + 1;
        ey = anchorY > boxCy ? by + boxH : by;
      } else if (boxCx < anchorX) {
        ex = bx + boxW + 1;
        ey = by + 4;
      } else {
        ex = bx - 1;
        ey = by + 4;
      }
      const elbowX = verticallyStacked ? ex : anchorX + (ex - anchorX) * 0.42;
      ctx.globalAlpha = alpha * 0.3;
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(snap(anchorX), snap(anchorY));
      ctx.lineTo(snap(elbowX), snap(ey));
      if (!verticallyStacked) ctx.lineTo(snap(ex), snap(ey));
      ctx.stroke();
    }

    // Airy semitransparent studio veil behind micro text
    ctx.globalAlpha = alpha * 0.42;
    ctx.fillStyle = 'rgba(236, 233, 226, 0.56)';
    ctx.fillRect(bx, by, boxW, boxH);

    // Subtle 1px vertical accent hair-tick on left
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = accent;
    ctx.fillRect(bx, by + 1.5, 1.2, boxH - 3);

    // Micro monospace title line
    ctx.globalAlpha = alpha * 0.74;
    ctx.font = FONT_TITLE;
    ctx.fillStyle = COLOR_INK;
    ctx.textBaseline = 'top';
    ctx.fillText(title, bx + padX + 1, by + padY);

    // Micro status / subtitle line
    ctx.globalAlpha = alpha * 0.56;
    ctx.font = FONT_SUB;
    ctx.fillStyle = accent === COLOR_MUTED ? COLOR_MUTED : COLOR_INK;
    ctx.fillText(sub, bx + padX + 1, by + padY + 8);
    ctx.restore();
  }

  private projectWorld(
    worldDir: THREE.Vector3,
    radius: number,
    camera: THREE.PerspectiveCamera,
  ): ProjectedPoint {
    this.worldPos.copy(worldDir).multiplyScalar(radius).add(this.sphereCenter);
    this.outwardWorld.copy(worldDir).normalize();
    this.toCam.subVectors(camera.position, this.worldPos).normalize();
    const front = this.outwardWorld.dot(this.toCam);

    this.ndc.copy(this.worldPos).project(camera);
    const nx = (this.ndc.x + 1) * 0.5;
    const ny = (1 - this.ndc.y) * 0.5;
    return {
      x: nx * this.width,
      y: ny * this.height,
      nx,
      ny,
      front,
      visible: this.ndc.z >= -1 && this.ndc.z <= 1,
    };
  }

  /** Draw a curved 3D-projected geodesic gravitation pull line from the steel ball toward the gravity pole */
  private drawGravitationLine(st: TelemetryFrameState, placed: LabelRect[]) {
    this.ballWorldDir.copy(st.ballDir).applyQuaternion(st.sphereRoot.quaternion).normalize();
    const gDir = st.gravityWorldDir;
    const dot = Math.max(-1, Math.min(1, this.ballWorldDir.dot(gDir)));
    const theta = Math.acos(dot);
    // At equilibrium right in the reticle center: stay completely clean
    if (theta < 0.055) return;

    this.gravArcAxis.crossVectors(this.ballWorldDir, gDir);
    if (this.gravArcAxis.lengthSq() < 1e-8) return;
    this.gravArcAxis.normalize();

    const gForce = Math.sin(Math.min(Math.PI * 0.5, theta));
    const arcRadius = st.ballRadius + 0.022;
    const steps = 18;
    const pts: ProjectedPoint[] = [];

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      this.gravArcQuat.setFromAxisAngle(this.gravArcAxis, theta * f);
      this.gravArcDir.copy(this.ballWorldDir).applyQuaternion(this.gravArcQuat).normalize();
      pts.push(this.projectWorld(this.gravArcDir, arcRadius, st.camera));
    }

    const ctx = this.ctx;
    const baseAlpha = clamp01((theta - 0.055) / 0.16) * 0.52;

    ctx.save();
    ctx.strokeStyle = COLOR_INK;
    ctx.lineWidth = 0.8;
    // Draw geodesic arc segments with subtle fade toward the gravity pole
    for (let i = 0; i < steps; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a.visible || !b.visible) continue;
      const frontMid = 0.5 * (a.front + b.front);
      ctx.globalAlpha = baseAlpha * this.depthAlpha(frontMid, 1.0, 0.28);
      ctx.setLineDash(frontMid < 0.04 ? [2, 3] : [3.5, 2.5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Crisp micro directional chevron along the pull direction (at ~55% of the arc)
    const midIdx = Math.floor(steps * 0.55);
    const p0 = pts[midIdx - 1];
    const p1 = pts[midIdx];
    const p2 = pts[midIdx + 1];
    if (p0 && p1 && p2 && p1.visible) {
      const dx = p2.x - p0.x;
      const dy = p2.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len > 1.5) {
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const head = 3.2;
        const wing = 1.9;
        ctx.setLineDash([]);
        ctx.globalAlpha = baseAlpha * 1.35 * this.depthAlpha(p1.front, 1.0, 0.35);
        ctx.strokeStyle = COLOR_INK;
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        ctx.moveTo(p1.x - ux * head + px * wing, p1.y - uy * head + py * wing);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x - ux * head - px * wing, p1.y - uy * head - py * wing);
        ctx.stroke();

        // Micro floating monospace force readout near the chevron
        if (theta > 0.14 && p1.front > 0.05) {
          const text = `GRAV ${gForce.toFixed(2)}G`;
          ctx.font = FONT_SUB;
          const tw = ctx.measureText(text).width;
          const side = px >= 0 ? 1 : -1;
          const bx = Math.round(p1.x + side * (6 + (side > 0 ? 0 : tw + 5)));
          const by = Math.round(p1.y + py * 5 - 4);
          const bw = Math.ceil(tw + 5);
          const bh = 9;
          const overlaps = placed.some(
            (r) => bx < r.x + r.w + 3 && bx + bw + 3 > r.x && by < r.y + r.h + 3 && by + bh + 3 > r.y,
          );
          if (!overlaps) {
            placed.push({ x: bx, y: by, w: bw, h: bh });
            ctx.globalAlpha = baseAlpha * 0.52;
            ctx.fillStyle = 'rgba(236, 233, 226, 0.55)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.globalAlpha = baseAlpha * 0.92;
            ctx.fillStyle = COLOR_INK;
            ctx.textBaseline = 'top';
            ctx.fillText(text, bx + 2.5, by + 1.5);
          }
        }
      }
    }
    ctx.restore();
  }

  /** Last computed projected sphere silhouette in CSS pixels */
  readonly sphereScreen = { cx: 0, cy: 0, radius: 0 };

  /**
   * Draw precision flat GUI checkpoint & switch indicator dots along a thin orbital arc
   * hugging the right contour of the 3D sphere (no pill container, no drop shadow).
   */
  private drawOrbitalLightsArc(st: TelemetryFrameState) {
    const ctx = this.ctx;
    const { level, camera, clearedMask, nextCpIdx, allCleared, toggleMask } = st;

    // Exact projected screen center & pixel radius of the outer polycarbonate shell
    this.ndc.copy(this.sphereCenter).project(camera);
    const cx = (this.ndc.x + 1) * 0.5 * this.width;
    const cy = (1 - this.ndc.y) * 0.5 * this.height;
    const dist = camera.position.distanceTo(this.sphereCenter);
    const fovRad = (camera.fov * Math.PI) / 180;
    const sinA = Math.min(0.95, R_SHELL / Math.max(R_SHELL + 0.05, dist));
    const tanA = sinA / Math.sqrt(1 - sinA * sinA);
    const spherePxR = (tanA / Math.tan(fovRad * 0.5)) * (this.height * 0.5);

    this.sphereScreen.cx = cx;
    this.sphereScreen.cy = cy;
    this.sphereScreen.radius = spherePxR;

    const isCompact = this.width < 640;
    const marginRight = isCompact ? 18 : 26;
    const idealOffset = isCompact ? 16 : Math.max(20, Math.min(32, spherePxR * 0.068));
    const maxArcR = Math.max(90, this.width - cx - marginRight);
    const arcR = Math.min(spherePxR + idealOffset, maxArcR);

    const cpCount = level.checkpoints.length;
    const swCount = level.toggles.length;
    const hasSw = swCount > 0;

    // Compute taller, airier arc positions (in radians around 3 o'clock, top -> bottom)
    const dotStepPx = isCompact ? 25 : 32;
    const sepGapPx = isCompact ? 16 : 20;
    const dAng = dotStepPx / arcR;
    const sepAng = sepGapPx / arcR;

    const cpSpan = Math.max(0, cpCount - 1) * dAng;
    const swSpan = hasSw ? Math.max(0, swCount - 1) * dAng : 0;
    const totalSpan = cpSpan + (hasSw ? sepAng * 2 + swSpan : 0);
    const startAng = -totalSpan * 0.5;
    const endAng = totalSpan * 0.5;
    const railPad = (isCompact ? 20 : 26) / arcR;
    const dotR = isCompact ? 4.0 : 4.6;
    const gapPx = isCompact ? 4.0 : 5.0;

    // Collect every occupied angular interval [ang - halfGap, ang + halfGap] so curved rail segments
    // stop cleanly with generous breathing space before & after every circle and tick (zero intersections!)
    const gaps: { a0: number; a1: number }[] = [];
    for (let i = 0; i < cpCount; i++) {
      const ang = startAng + i * dAng;
      const cleared = !!clearedMask[i] || allCleared;
      const isNext = !cleared && i === nextCpIdx;
      const outerR = isNext ? dotR + 3.4 : dotR + 0.6;
      const halfAng = (outerR + gapPx) / arcR;
      gaps.push({ a0: ang - halfAng, a1: ang + halfAng });
    }
    if (hasSw) {
      const sepCenterAng = startAng + cpSpan + sepAng;
      const sepHalf = 5.5 / arcR;
      gaps.push({ a0: sepCenterAng - sepHalf, a1: sepCenterAng + sepHalf });

      const swStartAng = sepCenterAng + sepAng;
      for (let i = 0; i < swCount; i++) {
        const ang = swStartAng + i * dAng;
        const halfAng = (dotR + 0.6 + gapPx) / arcR;
        gaps.push({ a0: ang - halfAng, a1: ang + halfAng });
      }
    }
    gaps.sort((u, v) => u.a0 - v.a0);

    ctx.save();

    // 1. Hairline precision instrument arc hugging the right limb, segmented cleanly around every circle
    ctx.strokeStyle = COLOR_INK;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    let cursorAng = startAng - railPad;
    const railEndAng = endAng + railPad;
    for (let i = 0; i < gaps.length; i++) {
      const g = gaps[i];
      if (g.a0 > cursorAng + 0.002) {
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, cursorAng, Math.min(railEndAng, g.a0));
        ctx.stroke();
      }
      cursorAng = Math.max(cursorAng, g.a1);
    }
    if (railEndAng > cursorAng + 0.002) {
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, cursorAng, railEndAng);
      ctx.stroke();
    }

    // Tiny radial end-cap ticks at top & bottom of the orbital rail
    const drawRadialTick = (ang: number, innerOff: number, outerOff: number, alpha: number) => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(cx + ca * (arcR - innerOff), cy + sa * (arcR - innerOff));
      ctx.lineTo(cx + ca * (arcR + outerOff), cy + sa * (arcR + outerOff));
      ctx.stroke();
    };
    drawRadialTick(startAng - railPad, 3.5, 3.5, 0.28);
    drawRadialTick(endAng + railPad, 3.5, 3.5, 0.28);

    // 2. Checkpoint indicator dots along the arc (cleanly isolated in their rail gaps)
    for (let i = 0; i < cpCount; i++) {
      const cp = level.checkpoints[i];
      const ang = startAng + i * dAng;
      const x = cx + Math.cos(ang) * arcR;
      const y = cy + Math.sin(ang) * arcR;

      const cleared = !!clearedMask[i] || allCleared;
      const isNext = !cleared && i === nextCpIdx;
      const isPipe = cp.layer === 'pipe';

      if (cleared) {
        ctx.globalAlpha = 0.96;
        ctx.fillStyle = '#24cc7e';
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else if (isNext) {
        const fillCol = isPipe ? '#24cfc0' : '#f58420';
        ctx.globalAlpha = 0.52;
        ctx.strokeStyle = fillCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, dotR + 3.2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.fillStyle = fillCol;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = isPipe ? 0.62 : 0.36;
        ctx.strokeStyle = isPipe ? '#12998c' : COLOR_INK;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, dotR - 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 3. Radial separator tick + Switch indicator dots (Red A / Blue B) along the lower portion of the arc
    if (hasSw) {
      const sepCenterAng = startAng + cpSpan + sepAng;
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = 1;
      drawRadialTick(sepCenterAng, 4.5, 4.5, 0.32);

      const swStartAng = sepCenterAng + sepAng;
      for (let i = 0; i < swCount; i++) {
        const tg = level.toggles[i];
        const on = (toggleMask & (1 << tg.id)) !== 0;
        const col = tg.colorId === 0 ? COLOR_RED : COLOR_BLUE;
        const ang = swStartAng + i * dAng;
        const x = cx + Math.cos(ang) * arcR;
        const y = cy + Math.sin(ang) * arcR;

        ctx.beginPath();
        if (on) {
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.globalAlpha = 0.96;
          ctx.fillStyle = col;
          ctx.fill();
        } else {
          ctx.arc(x, y, dotR - 0.2, 0, Math.PI * 2);
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  clear() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  render(st: TelemetryFrameState) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    st.sphereRoot.updateMatrixWorld();
    this.sphereCenter.setFromMatrixPosition(st.sphereRoot.matrixWorld);

    // Always draw the curved orbital progress/switch GUI arc hugging the globe (even if tracking HUD is toggled off)
    this.drawOrbitalLightsArc(st);

    if (!this.enabled || st.inTransition) return;

    const placed: LabelRect[] = [];
    const { grid, level, camera, sphereRoot, time } = st;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.0);

    const ballP = this.projectLocal(st.ballDir, st.ballRadius, sphereRoot, camera);

    // =========================================================================
    // 1. START / NORTH POLE MM:SS (live elapsed level timer)
    // =========================================================================
    const startP = this.projectLocal(NORTH_DIR, R_FLOOR + 0.012, sphereRoot, camera);
    if (startP.visible && startP.front > 0.14) {
      const a = this.depthAlpha(startP.front, 0.72, 0.0);
      this.drawNodeSquare(startP.x, startP.y, 2.8, COLOR_INK, a * 0.8);
      this.drawCallout(
        startP.x,
        startP.y,
        'START',
        `NORTH POLE ${fmtTimer(st.elapsedSec)}`,
        COLOR_MUTED,
        a,
        placed,
        'top',
        true,
      );
    }

    // =========================================================================
    // 2. ACTIVE NEXT TARGET ONLY (TARGET N or unlocked SOUTH POLE EXIT)
    // =========================================================================
    const nextCp = !st.allCleared && st.nextCpIdx >= 0 ? level.checkpoints[st.nextCpIdx] : null;
    let nextTargetP: ProjectedPoint | null = null;
    if (nextCp) {
      const cpR = nextCp.layer === 'pipe' ? R_PIPE_FLOOR + 0.01 : R_FLOOR + 0.012;
      const p = this.projectLocal(nextCp.dir, cpR, sphereRoot, camera);
      nextTargetP = p;
      const isPipe = nextCp.layer === 'pipe';
      const accent = nextCp.isFinish ? COLOR_MINT : isPipe ? COLOR_TEAL : COLOR_AMBER;

      // Subtle tether from marble -> active next target + micro ABS & A* distance readout
      if (ballP.visible && p.visible) {
        const dx = p.x - ballP.x;
        const dy = p.y - ballP.y;
        const distPx = Math.hypot(dx, dy);
        if (distPx > 22) {
          const lineA = this.depthAlpha(p.front, 0.5, 0.2);
          this.drawLinkLine(ballP, p, accent, lineA, p.front < 0.08, 0.75);

          if (distPx > 54) {
            const absMm =
              Math.acos(Math.max(-1, Math.min(1, st.ballDir.dot(nextCp.dir)))) * st.ballRadius * MM_PER_UNIT;
            const aStarMm = this.computeAStarDistanceMm(st);
            const aStarStr = aStarMm >= 0 ? `${aStarMm.toFixed(1)}` : '--';
            const dimText = `ABS ${absMm.toFixed(1)}  A* ${aStarStr}mm`;

            let angle = Math.atan2(dy, dx);
            if (angle > Math.PI * 0.5) angle -= Math.PI;
            else if (angle < -Math.PI * 0.5) angle += Math.PI;

            const mx = (ballP.x + p.x) * 0.5;
            const my = (ballP.y + p.y) * 0.5;

            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(angle);
            ctx.font = FONT_MICRO;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            const tw = ctx.measureText(dimText).width;
            ctx.globalAlpha = Math.min(0.4, lineA * 0.68);
            ctx.fillStyle = 'rgba(236, 233, 226, 0.55)';
            ctx.fillRect(-tw * 0.5 - 2.5, -10.5, tw + 5, 8.5);
            ctx.globalAlpha = Math.min(0.72, lineA * 1.2);
            ctx.fillStyle = accent;
            ctx.fillText(dimText, 0, -3);
            ctx.restore();
          }
        }
      }

      if (p.visible) {
        const a = this.depthAlpha(p.front, 0.94, 0.3);
        const bHalf = (nextCp.isFinish ? 11 : 9.5) + pulse * 0.9;
        this.drawBrackets(p.x, p.y, bHalf, 3.5, p.front > 0.05 ? COLOR_INK : accent, a, 0.9);
        this.drawNodeSquare(p.x, p.y, 2.5, COLOR_INK, a * 0.85, accent);

        const title = nextCp.isFinish ? 'EXIT' : `TARGET ${st.nextCpIdx + 1}`;
        const sub = nextCp.isFinish
          ? p.front > 0.05
            ? 'SOUTH POLE · OPEN'
            : 'SOUTH POLE · FAR SIDE'
          : isPipe
            ? p.front > 0.05
              ? 'ACTIVE · SUB-RAIL'
              : 'SUB-RAIL · FAR SIDE'
            : p.front > 0.05
              ? 'ACTIVE'
              : 'ACTIVE · FAR SIDE';

        this.drawCallout(p.x, p.y, title, sub, accent, this.depthAlpha(p.front, 0.96, 0.46), placed, 'top', true);
      }
    }

    // =========================================================================
    // 3. SWITCHES (SWITCH A / B) + VECTOR LINKS TO RELATED DOORS & PORTALS
    // =========================================================================
    for (let ti = 0; ti < level.toggles.length; ti++) {
      const tg = level.toggles[ti];
      const swColor = tg.colorId === 0 ? COLOR_RED : COLOR_BLUE;
      const isOn = (st.toggleMask & (1 << tg.id)) !== 0;
      const justFlipped = st.togglePulse[tg.id] || 0;
      const isSeated = st.readyPortal.kind === 'toggle' && st.readyPortal.toggleId === tg.id;
      const emphasis = Math.max(justFlipped, isSeated ? 0.75 : 0);

      const swP = this.projectLocal(tg.dir, R_FLOOR + 0.015, sphereRoot, camera);
      const swAlpha = this.depthAlpha(swP.front, 0.92, 0.22);

      if (swP.front > -0.1 || emphasis > 0.1) {
        this.drawBrackets(swP.x, swP.y, 7.5 + emphasis * 1.6, 3, swColor, Math.min(1, swAlpha + emphasis * 0.2), 0.85);
        this.drawNodeSquare(swP.x, swP.y, 2.2, COLOR_INK, swAlpha, swColor);
        if (swP.front > 0.06 || emphasis > 0.1) {
          this.drawCallout(
            swP.x,
            swP.y,
            `SWITCH ${tg.label}`,
            isOn ? 'ACTIVE' : 'INACTIVE',
            swColor,
            Math.min(1, this.depthAlpha(swP.front, 0.9, 0.36) + emphasis * 0.2),
            placed,
            'auto',
            true,
          );
        }
      }

      // Direct hairline vector lines from SWITCH -> every RELATED DOOR
      for (let wi = 0; wi < tg.wallIds.length; wi++) {
        const wid = tg.wallIds[wi];
        const w = grid.walls[wid];
        if (!w) continue;
        const ext = st.wallExt[wid];
        const isClosed = ext > 0.5;
        const doorR = R_FLOOR + (R_WALL - R_FLOOR) * ext + 0.01;
        const doorP = this.projectLocal(w.midDir, doorR, sphereRoot, camera);
        const bothFront = swP.front > 0.05 && doorP.front > 0.05;
        const linkAlpha = Math.min(
          0.92,
          Math.max(swAlpha, this.depthAlpha(doorP.front, 0.84, 0.18)) * (bothFront ? 0.58 : 0.24) + emphasis * 0.38,
        );

        this.drawLinkLine(swP, doorP, swColor, linkAlpha, !bothFront || !isClosed, emphasis > 0.15 ? 1.0 : 0.75);

        const dAlpha = Math.min(1, this.depthAlpha(doorP.front, 0.86, 0.2) + emphasis * 0.22);
        this.drawNodeSquare(doorP.x, doorP.y, 2.5, swColor, dAlpha, isClosed ? swColor : COLOR_MINT);

        if (doorP.front > 0.16 || emphasis > 0.15) {
          this.drawCallout(
            doorP.x,
            doorP.y,
            `DOOR ${tg.label}${wi + 1}`,
            isClosed ? 'CLOSED' : 'OPEN',
            swColor,
            Math.min(0.95, this.depthAlpha(doorP.front, 0.82, 0.3) + emphasis * 0.25),
            placed,
            'auto',
            true,
          );
        }
      }

      // Direct hairline vector lines from SWITCH -> every RELATED PORTAL IRIS
      for (let si = 0; si < tg.shutterIds.length; si++) {
        const sid = tg.shutterIds[si];
        const sh = grid.shutters[sid];
        if (!sh) continue;
        const isOpen = st.shutterOpen[sid] > 0.5;
        const shP = this.projectLocal(sh.dir, R_FLOOR + 0.012, sphereRoot, camera);
        const bothFront = swP.front > 0.05 && shP.front > 0.05;
        const linkAlpha = Math.min(
          0.92,
          Math.max(swAlpha, this.depthAlpha(shP.front, 0.84, 0.18)) * (bothFront ? 0.56 : 0.24) + emphasis * 0.38,
        );

        this.drawLinkLine(swP, shP, swColor, linkAlpha, !bothFront || !isOpen, emphasis > 0.15 ? 1.0 : 0.75);

        const sAlpha = Math.min(1, this.depthAlpha(shP.front, 0.86, 0.2) + emphasis * 0.22);
        this.drawNodeSquare(shP.x, shP.y, 2.8, swColor, sAlpha, isOpen ? COLOR_MINT : swColor);

        if (shP.front > 0.18 || emphasis > 0.15) {
          this.drawCallout(
            shP.x,
            shP.y,
            `PORTAL ${sh.label}`,
            isOpen ? `OPEN · SW ${tg.label}` : `CLOSED · SW ${tg.label}`,
            swColor,
            Math.min(0.95, this.depthAlpha(shP.front, 0.82, 0.3) + emphasis * 0.25),
            placed,
            'auto',
            true,
          );
        }
      }
    }

    // =========================================================================
    // 4. OPEN UNLINKED PORTAL SHUTTERS (PORTAL A, PORTAL B, ...)
    // =========================================================================
    const linkedShutterSet = new Set<number>();
    for (const tg of level.toggles) {
      for (const sid of tg.shutterIds) linkedShutterSet.add(sid);
    }

    const needPipePortal = st.ballLayer === 'pipe' || (nextCp !== null && nextCp.layer === 'pipe');

    for (let i = 0; i < grid.shutters.length; i++) {
      const sh = grid.shutters[i];
      if (st.shutterOpen[i] < 0.5) continue;

      const isReadyHere =
        (st.readyPortal.kind === 'shutter-enter' || st.readyPortal.kind === 'shutter-exit') &&
        st.readyPortal.shutterId === sh.id;
      const shP = this.projectLocal(sh.dir, R_FLOOR + 0.01, sphereRoot, camera);

      if (needPipePortal && nextTargetP && nextCp?.layer === 'pipe') {
        const bothFront = shP.front > 0.05 && nextTargetP.front > 0.05;
        this.drawLinkLine(shP, nextTargetP, COLOR_TEAL, bothFront ? 0.34 : 0.14, true, 0.75);
      }

      if (linkedShutterSet.has(sh.id) && !isReadyHere) continue;

      const sAlpha = this.depthAlpha(shP.front, 0.84, 0.16);
      if (shP.front > 0.08 || isReadyHere) {
        if (isReadyHere) {
          this.drawBrackets(shP.x, shP.y, 9.5 + st.readyDwell * 1.6, 3.5, COLOR_MINT, 0.94, 0.95);
        }
        this.drawNodeSquare(shP.x, shP.y, 2.5, COLOR_INK, sAlpha * 0.82, COLOR_MINT);

        if (shP.front > 0.2 || isReadyHere) {
          this.drawCallout(
            shP.x,
            shP.y,
            `PORTAL ${sh.label}`,
            st.ballLayer === 'pipe' ? 'OPEN · EXIT' : 'OPEN',
            COLOR_MINT,
            isReadyHere ? 0.95 : this.depthAlpha(shP.front, 0.76, 0.2),
            placed,
            'auto',
            true,
          );
        }
      }
    }

    // =========================================================================
    // 5. GEODESIC GRAVITATION PULL LINE + SUBTLE BALL TRACKER NODE
    // =========================================================================
    this.drawGravitationLine(st, placed);

    if (ballP.visible && ballP.front > -0.1) {
      const bAlpha = this.depthAlpha(ballP.front, 0.68, 0.2);
      const isLocked = st.readyPortal.kind !== 'none';
      const accent =
        st.readyPortal.kind === 'toggle'
          ? COLOR_RED
          : isLocked
            ? COLOR_MINT
            : COLOR_INK;
      this.drawNodeSquare(ballP.x, ballP.y, 3, COLOR_INK, bAlpha * 0.68, isLocked ? accent : undefined);
    }
  }
}
