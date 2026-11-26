import * as THREE from 'three';
import { R_FLOOR, R_PIPE_FLOOR, R_WALL, type LevelConfig, type SphereGrid } from './maze';
import type { BallLayer, ReadyPortal } from './physics';

export interface TelemetryFrameState {
  time: number;
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

const FONT_TITLE = '600 10.5px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
const FONT_SUB = '500 9px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';

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

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
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
    const s = Math.round(halfSize * 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.strokeRect(snap(cx - halfSize), snap(cy - halfSize), s, s);

    ctx.fillStyle = accentTick || strokeStyle;
    ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);

    if (accentTick) {
      const tx = snap(cx + halfSize + 5);
      const ty = snap(cy);
      ctx.strokeStyle = accentTick;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx - 2.5, ty);
      ctx.lineTo(tx + 2.5, ty);
      ctx.moveTo(tx, ty - 2.5);
      ctx.lineTo(tx, ty + 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Precision 1px vector connecting line (dashed when occluded / inactive) */
  private drawLinkLine(
    a: ProjectedPoint,
    b: ProjectedPoint,
    strokeStyle: string,
    alpha: number,
    dashed = false,
    lineWidth = 1,
  ) {
    if (alpha <= 0.02) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(snap(a.x), snap(a.y));
    ctx.lineTo(snap(b.x), snap(b.y));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Floating borderless two-line monospace label (subtle alabaster halo for readability over bright walls)
   * with automatic collision avoidance and clean thin leader line.
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
    const padX = 5;
    const padY = 3;
    const boxW = Math.ceil(Math.max(tw, sw) + padX * 2 + 4);
    const boxH = 26;

    const rightBias = anchorX < this.width * 0.56 ? 1 : -1;
    const candidates: [number, number][] =
      prefer === 'top'
        ? [
            [-boxW * 0.5, -48],
            [24 * rightBias - (rightBias < 0 ? boxW : 0), -34],
            [-boxW * 0.5, 24],
            [24 * -rightBias - (-rightBias < 0 ? boxW : 0), -34],
          ]
        : prefer === 'bottom'
          ? [
              [-boxW * 0.5, 24],
              [24 * rightBias - (rightBias < 0 ? boxW : 0), 12],
              [-boxW * 0.5, -46],
            ]
          : [
              [24 * rightBias - (rightBias < 0 ? boxW : 0), -30],
              [-boxW * 0.5, -46],
              [24 * rightBias - (rightBias < 0 ? boxW : 0), 12],
              [24 * -rightBias - (-rightBias < 0 ? boxW : 0), -30],
              [-boxW * 0.5, 24],
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
        (r) => cx < r.x + r.w + 6 && cx + boxW + 6 > r.x && cy < r.y + r.h + 4 && cy + boxH + 4 > r.y,
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

    // Thin crisp elbow leader line routed strictly to the nearest OUTSIDE edge (never crossing over text!)
    if (drawLeader) {
      const boxCx = bx + boxW * 0.5;
      const boxCy = by + boxH * 0.5;
      let ex = bx;
      let ey = boxCy;
      const verticallyStacked = anchorX >= bx - 6 && anchorX <= bx + boxW + 6;
      if (verticallyStacked) {
        ex = bx + 1;
        ey = anchorY > boxCy ? by + boxH : by;
      } else if (boxCx < anchorX) {
        ex = bx + boxW + 2;
        ey = by + 7;
      } else {
        ex = bx - 2;
        ey = by + 7;
      }
      const elbowX = verticallyStacked ? ex : anchorX + (ex - anchorX) * 0.42;
      ctx.globalAlpha = alpha * 0.44;
      ctx.strokeStyle = COLOR_INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(snap(anchorX), snap(anchorY));
      ctx.lineTo(snap(elbowX), snap(ey));
      if (!verticallyStacked) ctx.lineTo(snap(ex), snap(ey));
      ctx.stroke();
    }

    // Ultra-subtle translucent studio tint behind text (no heavy box outline — floats cleanly like reference)
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = 'rgba(236, 233, 226, 0.76)';
    ctx.fillRect(bx, by, boxW, boxH);

    // Crisp 2px vertical accent hair-tick on left
    ctx.globalAlpha = alpha * 0.92;
    ctx.fillStyle = accent;
    ctx.fillRect(bx, by + 2, 2, boxH - 4);

    // Title line
    ctx.globalAlpha = alpha;
    ctx.font = FONT_TITLE;
    ctx.fillStyle = COLOR_INK;
    ctx.textBaseline = 'top';
    ctx.fillText(title, bx + padX + 2, by + padY);

    // Status / subtitle line
    ctx.globalAlpha = alpha * 0.72;
    ctx.font = FONT_SUB;
    ctx.fillStyle = accent === COLOR_MUTED ? COLOR_MUTED : COLOR_INK;
    ctx.fillText(sub, bx + padX + 2, by + padY + 12);
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
    ctx.lineWidth = 1.1;
    // Draw geodesic arc segments with subtle fade toward the gravity pole
    for (let i = 0; i < steps; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a.visible || !b.visible) continue;
      const frontMid = 0.5 * (a.front + b.front);
      ctx.globalAlpha = baseAlpha * this.depthAlpha(frontMid, 1.0, 0.28);
      ctx.setLineDash(frontMid < 0.04 ? [3, 4] : [5, 3]);
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
        const head = 5.5;
        const wing = 3.2;
        ctx.setLineDash([]);
        ctx.globalAlpha = baseAlpha * 1.35 * this.depthAlpha(p1.front, 1.0, 0.35);
        ctx.strokeStyle = COLOR_INK;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(p1.x - ux * head + px * wing, p1.y - uy * head + py * wing);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x - ux * head - px * wing, p1.y - uy * head - py * wing);
        ctx.stroke();

        // Compact floating monospace force readout near the chevron
        if (theta > 0.14 && p1.front > 0.05) {
          const text = `GRAV ${gForce.toFixed(2)}G`;
          ctx.font = FONT_SUB;
          const tw = ctx.measureText(text).width;
          const side = px >= 0 ? 1 : -1;
          const bx = Math.round(p1.x + side * (10 + (side > 0 ? 0 : tw + 8)));
          const by = Math.round(p1.y + py * 8 - 7);
          const bw = Math.ceil(tw + 8);
          const bh = 14;
          const overlaps = placed.some(
            (r) => bx < r.x + r.w + 4 && bx + bw + 4 > r.x && by < r.y + r.h + 4 && by + bh + 4 > r.y,
          );
          if (!overlaps) {
            placed.push({ x: bx, y: by, w: bw, h: bh });
            ctx.globalAlpha = baseAlpha * 1.15;
            ctx.fillStyle = 'rgba(236, 233, 226, 0.72)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.globalAlpha = baseAlpha * 1.35;
            ctx.fillStyle = COLOR_INK;
            ctx.textBaseline = 'top';
            ctx.fillText(text, bx + 4, by + 2.5);
          }
        }
      }
    }
    ctx.restore();
  }

  render(st: TelemetryFrameState) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (!this.enabled || st.inTransition) return;

    st.sphereRoot.updateMatrixWorld();
    this.sphereCenter.setFromMatrixPosition(st.sphereRoot.matrixWorld);

    const placed: LabelRect[] = [];
    const { grid, level, camera, sphereRoot, time } = st;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.0);

    const ballP = this.projectLocal(st.ballDir, st.ballRadius, sphereRoot, camera);

    // =========================================================================
    // 1. START / NORTH POLE 00:00
    // =========================================================================
    const startP = this.projectLocal(NORTH_DIR, R_FLOOR + 0.012, sphereRoot, camera);
    if (startP.visible && startP.front > 0.14) {
      const a = this.depthAlpha(startP.front, 0.72, 0.0);
      this.drawNodeSquare(startP.x, startP.y, 5, COLOR_INK, a * 0.8);
      this.drawCallout(startP.x, startP.y, 'START', 'NORTH POLE 00:00', COLOR_MUTED, a, placed, 'top', true);
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

      // Subtle tether from chrome ball -> active next target
      if (ballP.visible && p.visible) {
        const distPx = Math.hypot(p.x - ballP.x, p.y - ballP.y);
        if (distPx > 26) {
          this.drawLinkLine(ballP, p, accent, this.depthAlpha(p.front, 0.5, 0.2), p.front < 0.08, 1);
        }
      }

      if (p.visible) {
        const a = this.depthAlpha(p.front, 0.94, 0.3);
        const bHalf = (nextCp.isFinish ? 22 : 18) + pulse * 1.6;
        this.drawBrackets(p.x, p.y, bHalf, 6, p.front > 0.05 ? COLOR_INK : accent, a, 1.3);
        this.drawNodeSquare(p.x, p.y, 4.5, COLOR_INK, a * 0.85, accent);

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
        this.drawBrackets(swP.x, swP.y, 14 + emphasis * 3, 5, swColor, Math.min(1, swAlpha + emphasis * 0.2), 1.25);
        this.drawNodeSquare(swP.x, swP.y, 3.5, COLOR_INK, swAlpha, swColor);
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

        this.drawLinkLine(swP, doorP, swColor, linkAlpha, !bothFront || !isClosed, emphasis > 0.15 ? 1.4 : 1);

        const dAlpha = Math.min(1, this.depthAlpha(doorP.front, 0.86, 0.2) + emphasis * 0.22);
        this.drawNodeSquare(doorP.x, doorP.y, 4.5, swColor, dAlpha, isClosed ? swColor : COLOR_MINT);

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

        this.drawLinkLine(swP, shP, swColor, linkAlpha, !bothFront || !isOpen, emphasis > 0.15 ? 1.4 : 1);

        const sAlpha = Math.min(1, this.depthAlpha(shP.front, 0.86, 0.2) + emphasis * 0.22);
        this.drawNodeSquare(shP.x, shP.y, 5, swColor, sAlpha, isOpen ? COLOR_MINT : swColor);

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
        this.drawLinkLine(shP, nextTargetP, COLOR_TEAL, bothFront ? 0.34 : 0.14, true, 1);
      }

      if (linkedShutterSet.has(sh.id) && !isReadyHere) continue;

      const sAlpha = this.depthAlpha(shP.front, 0.84, 0.16);
      if (shP.front > 0.08 || isReadyHere) {
        if (isReadyHere) {
          this.drawBrackets(shP.x, shP.y, 18 + st.readyDwell * 3, 6, COLOR_MINT, 0.94, 1.35);
        }
        this.drawNodeSquare(shP.x, shP.y, 4.5, COLOR_INK, sAlpha * 0.82, COLOR_MINT);

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
      this.drawNodeSquare(ballP.x, ballP.y, 5.5, COLOR_INK, bAlpha * 0.68, isLocked ? accent : undefined);
    }
  }
}
