import './style.css';
import {
  Vec3,
  Quat,
  add3,
  cross3,
  dot3,
  len3,
  mat4Invert,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mulberry32,
  norm3,
  qConj,
  qFromAxisAngle,
  qIdentity,
  qMul,
  qNorm,
  qRotate,
  qSlerp,
  scale3,
  sub3,
} from './math';
import {
  Plane,
  Poly,
  ShatterShard,
  intersectPolyPlane,
  makeCrystalPoly,
  makeInitialBlock,
  polyPlanes,
  shatterPoly,
  splitPoly,
  triangulateCracks,
  triangulatePoly,
  triangulateShards,
  triangulateSurfaceCracks,
} from './poly';
import { CARVE_PRESETS, CarveId, CarvePlan, buildCarvePlan } from './carve';
import { GEM_BLACK, GEM_SPLINTER_COLORS, GEM_TEXT_COLORS, LevelPlan, MAX_LEVEL, ThrowSpec, buildLevel } from './levels';
import { PALETTES, samplePaletteColor } from './palettes';
import { CutPieceUpload, GpuEngine, MAX_CUT_SLOTS, MAX_SHARDS, SplinterSpawn } from './gpu';
import { Sound } from './audio';
import type { BakeRequest, BakeResponse, ChildShardBakeInput, ShardBakeInput, StaticObstacleInput } from './sim.worker';
import SimWorker from './sim.worker?worker';

const qs = new URLSearchParams(location.search);
const CLEAN = qs.has('clean');
const DEBUG = qs.has('debug') || location.hash === '#debug' || import.meta.env.DEV;
if (CLEAN) document.documentElement.classList.add('clean');

const BLOCK_SIZE = 0.56;
const CRYSTAL_SIZE = 0.36;
const HALF_SIZE: Vec3 = [BLOCK_SIZE * 0.5, BLOCK_SIZE * 0.54, BLOCK_SIZE * 0.5];
const CRYSTAL_HALF_SIZE: Vec3 = [CRYSTAL_SIZE * 0.5, CRYSTAL_SIZE * 0.54, CRYSTAL_SIZE * 0.5];
const PEDESTAL_CENTER: Vec3 = [0.0, 0.52, 0.0];
const ORIG_BLOCK_VOL = BLOCK_SIZE * BLOCK_SIZE * BLOCK_SIZE * 1.08;
const TOSS_GRAVITY = 2.60;
const CHUNK_GRAVITY = 4.20;
const ENABLE_CRACKLE = false;
const EXPLODE_ON_GROUND = true;

// Adaptive perf budgets so Safari iOS / mobile stays silky 60fps with bounded GPU & JS memory!
const IS_MOBILE =
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024);
const MAX_DPR = IS_MOBILE ? 1.5 : 2;
const SPLINTER_CAP = IS_MOBILE ? 768 : 4096;
const SPLINTER_SCALE = IS_MOBILE ? 0.35 : 1.0;
const CAUSTIC_RES = IS_MOBILE ? 512 : 1024;
const MAX_SHARD_BATCHES = IS_MOBILE ? 8 : 18;
const MAX_FLOOR_OBSTACLES = IS_MOBILE ? 36 : 96;
const EMPTY_F32 = new Float32Array(0);

// Studio camera: smoothly pulls back & levels framing in Toss mode for pure below-up leaps & juggling room
const PEDESTAL_CAM_EYE: Vec3 = [0.0, 0.96, 2.22];
const PEDESTAL_CAM_TARGET: Vec3 = [0.0, 0.40, 0.0];
const TOSS_CAM_EYE: Vec3 = [0.0, 0.88, 2.72];
const TOSS_CAM_TARGET: Vec3 = [0.0, 0.56, 0.0];
let camEye: Vec3 = [...PEDESTAL_CAM_EYE] as Vec3;
let camTarget: Vec3 = [...PEDESTAL_CAM_TARGET] as Vec3;
const CAM_FOV = (38 * Math.PI) / 180;

// Key studio light: upper-left-front for rich coloured floor caustics
const LIGHT_DIR: Vec3 = norm3([-0.50, 0.84, 0.34]);

const cfg = {
  ior: 1.56,
  dispersion: 0.062,
  causticStrength: 1.35,
  shardCount: IS_MOBILE ? 36 : 72,
  explodeForce: 2.35,
  crackDuration: 0.36,
  exposure: 1.06,
};

interface PendingChunk {
  cutPoly: Poly;
  shards: ShatterShard[];
  localPushDir: Vec3;
  worldPos: Vec3;
  worldVel: Vec3;
  ballistic: boolean;
}

interface PendingCut {
  chunks: PendingChunk[];
  flatShards: ShatterShard[];
  parentChunkIdx: number[];
  crackElapsed: number;
  crackDur: number;
  cutQuat: Quat;
  cutAngVel: Vec3;
  ballistic: boolean;
  shattering: boolean;
  bakeId: number;
}

interface ActiveScatter {
  baseShardId: number;
  numShards: number;
  fps: number;
  numFrames: number;
  frames: Float32Array;
  contacts: Float32Array;
  nextContact: number;
  elapsed: number;
  settled: boolean;
  gemId: number;
  shards: ShatterShard[];
}

interface FallingChunk {
  slotIdx: number;
  cutPoly: Poly;
  worldPos: Vec3;
  worldVel: Vec3;
  quat: Quat;
  angVel: Vec3;
  targetShards: number;
  gemId: number;
  bakeStarted: boolean;
  bakeId: number;
  flatShards: ShatterShard[];
  parentShards: ShatterShard[];
  bakedResp: BakeResponse | null;
  hitGroundWaiting: boolean;
  detonated: boolean;
}

interface FlyingCrystal {
  id: number;
  slotIdx: number;
  poly: Poly;
  startVol: number;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: Vec3;
  gravity: number;
  poisoned: boolean;
  gemId: number;
  slices: number;
  lastSlicedAt: number;
  swipeEntered: boolean;
  swipeDist: number;
  enterX: number;
  enterY: number;
}

interface FloatingCallout {
  x: number;
  y: number;
  text: string;
  sub?: string;
  color: string;
  age: number;
  maxAge: number;
  emphasis: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  t: number; // ms
  inGlass: boolean;
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const trailCanvas = document.getElementById('trail') as HTMLCanvasElement;
const trailCtx = trailCanvas.getContext('2d')!;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const hudLevelEl = document.getElementById('hud-level') as HTMLElement;
const hudScoreEl = document.getElementById('hud-score') as HTMLElement;
const hudBestEl = document.getElementById('hud-best') as HTMLElement;
const bannerEl = document.getElementById('banner') as HTMLButtonElement;
const soundBtn = document.getElementById('sound') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const fatalEl = document.getElementById('fatal') as HTMLDivElement;

const sound = new Sound();
const gpu = new GpuEngine(canvas, { maxSplinters: SPLINTER_CAP, causticRes: CAUSTIC_RES });
const worker = new SimWorker();

// State
let rng = mulberry32(Number(qs.get('seed')) || 202602);
let paletteIdx = 0;
let crystalVariant = 0;
let blockParts: Poly[] = [makeCrystalPoly(CRYSTAL_SIZE, 0)];

// Shape / Letter carving state
let carveId: CarveId = (qs.get('shape') as CarveId) || 'free';
let carvePlan: CarvePlan | null = buildCarvePlan(carveId);
let carveStepIdx = 0;

// Stationary sculptural glass pose with subtle pointer-parallax tilt (locks steady while slashing!)
const INIT_YAW = -0.34;
const INIT_PITCH = 0.16;
let baseQuat: Quat = qNorm(
  qMul(
    qFromAxisAngle([1, 0, 0], INIT_PITCH),
    qFromAxisAngle([0, 1, 0], INIT_YAW),
  ),
);
let mouseQuat: Quat = qIdentity();
let targetMouseQuat: Quat = qIdentity();
let blockQuat: Quat = [...baseQuat] as Quat;
let blockPos: Vec3 = [...PEDESTAL_CENTER] as Vec3;
let blockVel: Vec3 = [0, 0, 0];
let blockAngVel: Vec3 = [0, 0, 0];

// 1,000-Level Deterministic Diamond Cutter Game state!
type GamePhase = 'playing' | 'failing' | 'lost' | 'cleared';
let tossMode = carveId === 'free' && qs.get('toss') !== '0';
let currentLevel = Math.max(1, Math.min(MAX_LEVEL, Number(qs.get('level')) || 1));
let levelPlan: LevelPlan = buildLevel(currentLevel);
let levelTime = 0;
let nextThrowIdx = 0;
let nextWarnIdx = 0;
let nextPopIdx = 0;
let gamePhase: GamePhase = 'playing';
let score = 0;
let bestScore = (() => {
  try { return Number(localStorage.getItem('shatter-2026-best') || '0') || 0; } catch { return 0; }
})();
let failFreezeTimer = 0;
let failReason = '';
let shakeTimer = 0;
let shakeAmp = 0;
let failFlash = 0;
let clearWaitTimer = 0;
let replayPending = false;
let replayDelayTimer = 0;

let nextCrystalId = 1;
const flyingCrystals: FlyingCrystal[] = [];
const callouts: FloatingCallout[] = [];
let hitStopTimer = 0;

// Fruit Ninja scoring: same-direction combo accumulator (3+ gems = +N bonus) + Blitz streak!
let strokeDirX = 0;
let strokeDirY = 0;
let lastSwooshAt = -99999;
let lastSwooshDirX = 0;
let lastPointerMoveAt = 0;
let swooshAccumDist = 0;
let strokeMultiCount = 0;
let strokeLastHitAt = -99999;
let strokeLastPos: Vec3 = [0, 0.7, 0];
let strokeLastGemId = 2;
const strokeHitIds = new Set<number>();
let blitzTier = 0;
let lastComboAt = -99999;
const BLITZ_BONUS = [0, 5, 10, 15, 20, 30] as const;
const BLITZ_LABEL = ['', 'BLITZ', 'SUPER BLITZ', 'MEGA BLITZ', 'ULTRA BLITZ', 'UNBELIEVABLE'] as const;

/** Responsive stage width: narrower on portrait mobile screens so crystals never leave the viewport! */
function getTossStageLayout(): { eyeZ: number; stageHalfW: number } {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const eyeZ = aspect < 0.72 ? 3.28 : aspect < 0.95 ? 3.02 : aspect < 1.2 ? 2.86 : 2.72;
  const halfHAtZ0 = eyeZ * Math.tan(CAM_FOV * 0.5);
  const halfWAtZ0 = halfHAtZ0 * aspect;
  // Tight safe stage on phones (~0.32m half-width on iPhone portrait), generous wide stage on desktop (0.88m)
  const stageHalfW = Math.max(0.24, Math.min(0.88, halfWAtZ0 * 0.62));
  return { eyeZ, stageHalfW };
}

let freeSym = false;
let crackleOn = ENABLE_CRACKLE;
let autoShatter = true;
let slowMode = false;
let shiftSlow = false;
let paused = false;
let canCut = false;

// Active live cutting plane(s) (in Free mode, only active while swiping!)
let activePlane1N: Vec3 = norm3([1, 0, 0]);
let activePlane1R = 0.18;
let activePlane2N: Vec3 | null = null;
let activePlane2R = -1;
let displayPlane1N: Vec3 = [...activePlane1N] as Vec3;
let displayPlane1R = activePlane1R;
let displayPlane2N: Vec3 | null = null;
let displayPlane2R = -1;
let showCutLine = false;

// Pending cracking piece + independent falling crystal chunks (explode ONLY on ground impact!)
let pending: PendingCut | null = null;
let bakingCutVisual: PendingCut | null = null;
const inFlightBakes = new Map<number, PendingCut>();
const fallingChunks: FallingChunk[] = [];
const fallingBakes = new Map<number, FallingChunk>();
let nextBakeId = 1;
let nextShardId = 0;
const scatters: ActiveScatter[] = [];
const floorObstacles: StaticObstacleInput[] = [];

// Swipe / slash state (Fruit Ninja style!)
let activePointerId = -1;
let swiping = false;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeCurX = 0;
let swipeCurY = 0;
let swipePrevDirX = 0;
let swipePrevDirY = 0;
let swipeInGlassDist = 0;
let swipeEnteredGlass = false;
let swipeDidSlice = false;
let slashFlash = 0; // brief razor flash brightness on cleave
const trailPts: TrailPoint[] = [];

let viewProj: Float32Array = new Float32Array(16);
let invViewProj: Float32Array = new Float32Array(16);

function updateCamera() {
  const aspect = Math.max(0.2, canvas.width / Math.max(1, canvas.height));
  const proj = mat4Perspective(CAM_FOV, aspect, 0.05, 40.0);
  const view = mat4LookAt(camEye, camTarget, [0, 1, 0]);
  viewProj = mat4Mul(proj, view);
  invViewProj = mat4Invert(viewProj);
}

/** Project a world-space point to CSS pixel coordinates { x, y, visible }. */
function projectToScreen(wp: Vec3): { x: number; y: number; visible: boolean } {
  const cx = viewProj[0] * wp[0] + viewProj[4] * wp[1] + viewProj[8] * wp[2] + viewProj[12];
  const cy = viewProj[1] * wp[0] + viewProj[5] * wp[1] + viewProj[9] * wp[2] + viewProj[13];
  const cw = viewProj[3] * wp[0] + viewProj[7] * wp[1] + viewProj[11] * wp[2] + viewProj[15];
  if (cw <= 0.001) return { x: -999, y: -999, visible: false };
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * window.innerWidth,
    y: (0.5 - ndcY * 0.5) * window.innerHeight,
    visible: ndcX >= -1.05 && ndcX <= 1.05 && ndcY >= -1.05 && ndcY <= 1.05,
  };
}

/** Unproject CSS pixel coordinate (clientX, clientY) to a unit world ray direction from CAM_EYE. */
function screenToRay(clientX: number, clientY: number): Vec3 {
  const ndcX = (clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  const ndcY = 1 - (clientY / Math.max(1, window.innerHeight)) * 2;
  const x0 = invViewProj[0] * ndcX + invViewProj[4] * ndcY + invViewProj[12];
  const y0 = invViewProj[1] * ndcX + invViewProj[5] * ndcY + invViewProj[13];
  const z0 = invViewProj[2] * ndcX + invViewProj[6] * ndcY + invViewProj[14];
  const w0 = invViewProj[3] * ndcX + invViewProj[7] * ndcY + invViewProj[15];

  const x1 = invViewProj[0] * ndcX + invViewProj[4] * ndcY + invViewProj[8] + invViewProj[12];
  const y1 = invViewProj[1] * ndcX + invViewProj[5] * ndcY + invViewProj[9] + invViewProj[13];
  const z1 = invViewProj[2] * ndcX + invViewProj[6] * ndcY + invViewProj[10] + invViewProj[14];
  const w1 = invViewProj[3] * ndcX + invViewProj[7] * ndcY + invViewProj[11] + invViewProj[15];

  const p0: Vec3 = [x0 / w0, y0 / w0, z0 / w0];
  const p1: Vec3 = [x1 / w1, y1 / w1, z1 / w1];
  return norm3(sub3(p1, p0));
}

/** Exact ray vs a single convex polyhedron positioned at (pos, quat). */
function rayHitsPolyAt(clientX: number, clientY: number, poly: Poly, pos: Vec3, quat: Quat): boolean {
  const worldDir = screenToRay(clientX, clientY);
  const invQ = qConj(quat);
  const ro = qRotate(invQ, sub3(camEye, pos));
  const rd = norm3(qRotate(invQ, worldDir));

  let tMin = 0;
  let tMax = 1e6;
  for (const f of poly.faces) {
    const num = f.d - dot3(f.n, ro);
    const denom = dot3(f.n, rd);
    if (Math.abs(denom) < 1e-7) {
      if (num < 0) return false;
    } else {
      const t = num / denom;
      if (denom > 0) tMax = Math.min(tMax, t);
      else tMin = Math.max(tMin, t);
      if (tMin > tMax) return false;
    }
  }
  return tMax > 0.01;
}

/** Exact ray vs convex polyhedron hit test in world space against the pedestal/carve block. */
function rayHitsBlock(clientX: number, clientY: number): boolean {
  if (blockParts.length === 0) return false;
  for (const poly of blockParts) {
    if (rayHitsPolyAt(clientX, clientY, poly, blockPos, blockQuat)) return true;
  }
  return false;
}

/**
 * Compute exact 3D cutting plane spanned by camEye and screen swipe segment (x0,y0) -> (x1,y1)
 * relative to `refCenter`, oriented with d >= 0 so n points toward the piece furthest from center!
 */
function swipeToWorldPlaneAt(x0: number, y0: number, x1: number, y1: number, refCenter: Vec3): { n: Vec3; d: number } | null {
  if (Math.hypot(x1 - x0, y1 - y0) < 10) return null;
  const r0 = screenToRay(x0, y0);
  const r1 = screenToRay(x1, y1);
  const cr = cross3(r0, r1);
  const l = len3(cr);
  if (l < 1e-5) return null;
  let n: Vec3 = [cr[0] / l, cr[1] / l, cr[2] / l];
  let d = dot3(sub3(camEye, refCenter), n);
  if (d < 0) {
    n = [-n[0], -n[1], -n[2]];
    d = -d;
  }
  return { n, d };
}

function swipeToWorldPlane(x0: number, y0: number, x1: number, y1: number): { n: Vec3; d: number } | null {
  return swipeToWorldPlaneAt(x0, y0, x1, y1, blockPos);
}

function uploadMainBlocks() {
  gpu.setMainBlocks(
    blockParts.map((p) => ({
      verts: triangulatePoly(p),
      planes: polyPlanes(p),
    })),
  );
}

/** Update live cutting line(s) & glowing cross-section preview loops. */
function updateLivePreview() {
  // Case A: Guided Shape / Letter Carve Plan
  if (carvePlan) {
    if (pending || carveStepIdx >= carvePlan.steps.length) {
      canCut = false;
      showCutLine = false;
      activePlane2N = null;
      activePlane2R = -1;
      gpu.setSectionLoops([], camEye);
      return;
    }

    const step = carvePlan.steps[carveStepIdx];
    const loops: Vec3[][] = [];

    if (step.kind === 'plane') {
      showCutLine = true;
      const p0 = step.planes[0];
      activePlane1N = norm3(qRotate(blockQuat, p0.n));
      activePlane1R = p0.d;
      if (step.planes.length > 1) {
        const p1 = step.planes[1];
        activePlane2N = norm3(qRotate(blockQuat, p1.n));
        activePlane2R = p1.d;
      } else {
        activePlane2N = null;
        activePlane2R = -1;
      }

      for (const pl of step.planes) {
        for (const bp of blockParts) {
          const loop = intersectPolyPlane(bp, pl.n, pl.d);
          if (loop.length >= 3) {
            loops.push(loop.map((pt) => add3(blockPos, qRotate(blockQuat, pt))));
          }
        }
      }
      canCut = true;
      gpu.setSectionLoops(loops, camEye);
      return;
    } else {
      const c0 = step.chunks[0];
      const isInteriorHole = Math.abs(c0.pushDir[2]) > 0.85;
      showCutLine = !isInteriorHole;
      activePlane1N = norm3(qRotate(blockQuat, c0.cutPlane.n));
      activePlane1R = Math.max(0.02, c0.cutPlane.d);
      if (step.chunks.length > 1 && !isInteriorHole) {
        const c1 = step.chunks[1];
        activePlane2N = norm3(qRotate(blockQuat, c1.cutPlane.n));
        activePlane2R = Math.max(0.02, c1.cutPlane.d);
      } else {
        activePlane2N = null;
        activePlane2R = -1;
      }

      for (const ch of step.chunks) {
        for (const f of ch.poly.faces) {
          if (Math.abs(f.n[2]) > 0.9 && f.verts.length >= 3) {
            loops.push(f.verts.map((pt) => add3(blockPos, qRotate(blockQuat, pt))));
          }
        }
      }
      canCut = true;
      gpu.setSectionLoops(loops, camEye);
      return;
    }
  }

  // Case B: Free Fruit-Ninja Slicing Mode — glass stays 100% pure & unobstructed until you swipe!
  if (!swiping || swipeDidSlice || blockParts.length === 0) {
    canCut = false;
    showCutLine = false;
    activePlane2N = null;
    activePlane2R = -1;
    gpu.setSectionLoops([], camEye);
    return;
  }

  const wp = swipeToWorldPlane(swipeStartX, swipeStartY, swipeCurX, swipeCurY);
  if (!wp) {
    canCut = false;
    showCutLine = false;
    gpu.setSectionLoops([], camEye);
    return;
  }

  showCutLine = true;
  activePlane1N = wp.n;
  activePlane1R = wp.d;
  if (freeSym && wp.d > 0.015) {
    activePlane2N = [-wp.n[0], -wp.n[1], -wp.n[2]];
    activePlane2R = wp.d;
  } else {
    activePlane2N = null;
    activePlane2R = -1;
  }

  const invQ = qConj(blockQuat);
  const localPlanes: Plane[] = [{ n: norm3(qRotate(invQ, wp.n)), d: wp.d }];
  if (activePlane2N) {
    localPlanes.push({ n: norm3(qRotate(invQ, activePlane2N)), d: wp.d });
  }

  const loops: Vec3[][] = [];
  let valid = false;
  for (const pl of localPlanes) {
    for (const bp of blockParts) {
      const loop = intersectPolyPlane(bp, pl.n, pl.d);
      if (loop.length >= 3) {
        const sp = splitPoly(bp, pl.n, pl.d);
        if (sp.neg && sp.pos && sp.neg.volume > 0.00005 && sp.pos.volume > 0.00005) {
          valid = true;
          loops.push(loop.map((pt) => add3(blockPos, qRotate(blockQuat, pt))));
        }
      }
    }
  }
  canCut = valid;
  gpu.setSectionLoops(loops, camEye);
}

function updateHudUI() {
  const showGame = tossMode && !carvePlan;
  hudEl.hidden = !showGame;
  if (!showGame) return;
  hudLevelEl.textContent = String(currentLevel);
  hudScoreEl.textContent = String(score);
  hudBestEl.textContent = String(bestScore);
}

function showReplayBanner() {
  bannerEl.hidden = false;
  canvas.classList.add('replay-ready');
}

function hideBanner() {
  bannerEl.hidden = true;
  canvas.classList.remove('replay-ready');
}

function spawnCallout(worldPos: Vec3, text: string, sub?: string, emphasis = false, color = '#1c1c1c') {
  const sp = projectToScreen(worldPos);
  if (!sp.visible) return;
  callouts.push({
    x: sp.x,
    y: sp.y - 18,
    text,
    sub,
    color,
    age: 0,
    maxAge: emphasis ? 0.92 : 0.56,
    emphasis,
  });
}

function addScore(pts: number, worldPos?: Vec3, label?: string, sub?: string, emphasis = false, gemId = 0) {
  score += pts;
  if (score > bestScore) {
    bestScore = score;
    try { localStorage.setItem('shatter-2026-best', String(bestScore)); } catch { /* ignore */ }
  }
  if (worldPos && label) {
    spawnCallout(worldPos, label, sub, emphasis, GEM_TEXT_COLORS[gemId] ?? '#1c1c1c');
  }
  updateHudUI();
}

/** Resolve an accumulated Fruit Ninja same-direction combo (3+ gems -> +N bonus, plus Blitz streak!). */
function flushStrokeCombo(nowMs: number) {
  const n = strokeMultiCount;
  const pos: Vec3 = [...strokeLastPos] as Vec3;
  const gemId = strokeLastGemId;
  strokeMultiCount = 0;
  strokeHitIds.clear();
  strokeLastHitAt = -99999;

  if (n < 3) return;

  const pan = Math.max(-1, Math.min(1, pos[0] * 0.9));
  sound.comboChime(n, pan);
  addScore(n, pos, `${n}× COMBO`, `+${n}`, true, gemId);

  // Fruit Ninja Blitz streak: chaining combos back-to-back within 5.5s escalates +5 -> +10 -> +15 -> +20 -> +30!
  if (nowMs - lastComboAt <= 5500) {
    blitzTier = Math.min(BLITZ_BONUS.length - 1, blitzTier + 1);
    const blitzPts = BLITZ_BONUS[blitzTier];
    const blitzPos: Vec3 = [pos[0], pos[1] - 0.16, pos[2]];
    addScore(blitzPts, blitzPos, BLITZ_LABEL[blitzTier], `+${blitzPts}`, true, gemId);
  } else {
    blitzTier = 0;
  }
  lastComboAt = nowMs;
}

function updateActionUI() {
  updateHudUI();
}

function burstSplinters(
  origins: Vec3[],
  localOrigins: Vec3[],
  baseVel: Vec3,
  count: number,
  spread: number,
  sizeMin: number,
  sizeMax: number,
  gemId = 0,
) {
  if (origins.length === 0) return;
  const scaledCount = Math.max(1, Math.min(SPLINTER_CAP, Math.round(count * SPLINTER_SCALE)));
  const pal = PALETTES[paletteIdx];
  const gemCol = GEM_SPLINTER_COLORS[gemId];
  const spawns: SplinterSpawn[] = [];
  for (let i = 0; i < scaledCount; i++) {
    const idx = Math.floor(rng() * origins.length);
    const o = origins[idx];
    const lo = localOrigins[idx];
    const jitter: Vec3 = [(rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03];
    const dir = norm3([
      baseVel[0] + (rng() - 0.5) * spread * 2,
      baseVel[1] + (rng() - 0.32) * spread * 2,
      baseVel[2] + (rng() - 0.5) * spread * 2,
    ]);
    const speed = len3(baseVel) * (0.4 + rng() * 0.9) + rng() * spread;
    spawns.push({
      pos: add3(o, jitter),
      vel: scale3(dir, speed),
      size: sizeMin + Math.pow(rng(), 2.2) * (sizeMax - sizeMin),
      maxAge: IS_MOBILE ? 4.5 + rng() * 3.5 : 8 + rng() * 8,
      color: gemCol ? ([...gemCol] as Vec3) : samplePaletteColor(lo, carvePlan ? HALF_SIZE : CRYSTAL_HALF_SIZE, pal),
      spinSpeed: 8 + rng() * 22,
    });
  }
  gpu.spawnSplinters(spawns);
}

/** Lowest world-space Y coordinate among all vertices of a convex polyhedron at (pos, quat). */
function getPolyMinWorldY(poly: Poly, pos: Vec3, quat: Quat): number {
  let minY = Infinity;
  for (const f of poly.faces) {
    for (const v of f.verts) {
      const wy = pos[1] + qRotate(quat, v)[1];
      if (wy < minY) minY = wy;
    }
  }
  return minY;
}

/** Integrate quaternion forward by angular velocity vector over dt seconds. */
function stepQuat(q: Quat, angVel: Vec3, dt: number): Quat {
  const ang = len3(angVel) * dt;
  if (ang <= 1e-5) return [...q] as Quat;
  return qNorm(qMul(qFromAxisAngle(norm3(angVel), ang), q));
}

/** Allocate a free GPU CutSlot (0..MAX_CUT_SLOTS-1); if full, detonate the oldest/lowest falling chunk. */
function allocCutSlot(): number {
  const used = new Set<number>();
  for (const fc of flyingCrystals) used.add(fc.slotIdx);
  for (const ch of fallingChunks) used.add(ch.slotIdx);
  for (let i = 0; i < MAX_CUT_SLOTS; i++) {
    if (!used.has(i)) return i;
  }
  // All slots occupied: free the lowest falling chunk first
  if (fallingChunks.length > 0) {
    let oldest = fallingChunks[0];
    for (const c of fallingChunks) {
      if (c.worldPos[1] < oldest.worldPos[1]) oldest = c;
    }
    const freed = oldest.slotIdx;
    if (oldest.bakedResp) {
      detonateFallingChunk(oldest);
    } else {
      gpu.clearCutSlot(freed);
      oldest.detonated = true;
      const idx = fallingChunks.indexOf(oldest);
      if (idx >= 0) fallingChunks.splice(idx, 1);
    }
    return freed;
  }
  return 0;
}

/** Pre-bake a falling crystal chunk's Rapier floor-impact explosion just before touchdown so detonation has ZERO lag! */
function startFallingChunkBake(ch: FallingChunk, dtHit: number) {
  if (ch.bakeStarted) return;
  ch.bakeStarted = true;

  const hitPos: Vec3 = [
    ch.worldPos[0] + ch.worldVel[0] * dtHit,
    ch.worldPos[1] + ch.worldVel[1] * dtHit - 0.5 * CHUNK_GRAVITY * dtHit * dtHit,
    ch.worldPos[2] + ch.worldVel[2] * dtHit,
  ];
  const hitVel: Vec3 = [
    ch.worldVel[0],
    ch.worldVel[1] - CHUNK_GRAVITY * dtHit,
    ch.worldVel[2],
  ];
  const hitQuat = stepQuat(ch.quat, ch.angVel, dtHit);
  const minHitY = getPolyMinWorldY(ch.cutPoly, hitPos, hitQuat);
  if (minHitY < 0.015) {
    hitPos[1] += 0.015 - minHitY;
  }

  // Seed Voronoi fracture densest along the bottom ground-impact surface!
  const localDown = norm3(qRotate(qConj(hitQuat), [0, -1, 0]));
  const { shards } = shatterPoly(ch.cutPoly, localDown, carvePlan ? 0.20 : 0.13, ch.targetShards, rng);
  if (shards.length === 0) {
    ch.detonated = true;
    gpu.clearCutSlot(ch.slotIdx);
    return;
  }

  const flatShards: ShatterShard[] = [];
  for (const s of shards) flatShards.push(s);
  for (const s of shards) {
    if (s.children) {
      for (const kid of s.children) flatShards.push(kid);
    }
  }
  ch.parentShards = shards;
  ch.flatShards = flatShards;

  const chunkCW = add3(hitPos, qRotate(hitQuat, ch.cutPoly.centroid));
  const impactSpeed = Math.abs(hitVel[1]);
  const impactBoost = Math.min(1.65, 0.72 + impactSpeed * 0.22);

  let childCursor = shards.length;
  const shardInputs: ShardBakeInput[] = [];

  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const relWorld = qRotate(hitQuat, s.centroid);
    const initPos: Vec3 = [
      hitPos[0] + relWorld[0],
      Math.max(0.028, hitPos[1] + relWorld[1]),
      hitPos[2] + relWorld[2],
    ];
    const fromCenter = sub3(initPos, chunkCW);
    const radXZ = norm3([fromCenter[0] + (rng() - 0.5) * 0.06, 0, fromCenter[2] + (rng() - 0.5) * 0.06]);
    const f = cfg.explodeForce * impactBoost * (0.68 + rng() * 0.85);
    const linVel: Vec3 = [
      hitVel[0] * 0.52 + radXZ[0] * (1.25 * f) + (rng() - 0.5) * 0.95,
      Math.max(0.38, 0.45 + rng() * 1.35 + impactSpeed * 0.22),
      hitVel[2] * 0.52 + radXZ[2] * (1.25 * f) + (rng() - 0.5) * 0.95,
    ];
    const angVelShard: Vec3 = [
      (rng() - 0.5) * 18,
      (rng() - 0.5) * 18,
      (rng() - 0.5) * 18,
    ];

    let children: ChildShardBakeInput[] | undefined;
    if (s.children && s.children.length >= 2) {
      children = s.children.map((kid) => ({
        slotIndex: childCursor++,
        hullVerts: kid.hullVerts,
        localOffset: sub3(kid.centroid, s.centroid),
        volume: kid.volume,
      }));
    }

    shardInputs.push({
      slotIndex: i,
      hullVerts: s.hullVerts,
      initPos,
      initQuat: hitQuat,
      linVel,
      angVel: angVelShard,
      volume: s.volume,
      breakSpeed: 1.05 + rng() * 0.85,
      children,
    });
  }

  const bakeId = nextBakeId++;
  ch.bakeId = bakeId;
  fallingBakes.set(bakeId, ch);

  const req: BakeRequest = {
    id: bakeId,
    totalSlots: flatShards.length,
    shards: shardInputs,
    staticObstacles: floorObstacles.slice(-MAX_FLOOR_OBSTACLES),
    maxFrames: IS_MOBILE ? 210 : 260,
    fps: 60,
  };
  worker.postMessage(req);
}

/** Detonate a falling crystal chunk the exact instant it hits the white studio floor! */
function detonateFallingChunk(ch: FallingChunk) {
  if (ch.detonated || !ch.bakedResp) return;
  ch.detonated = true;

  const bake = ch.bakedResp;
  ch.bakedResp = null;

  gpu.clearCutSlot(ch.slotIdx);
  const idx = fallingChunks.indexOf(ch);
  if (idx >= 0) fallingChunks.splice(idx, 1);

  const rate = slowMode || shiftSlow ? 0.28 : 1.0;
  sound.shatter(rate);

  // Upward shower of glittering clear crystal splinters on floor impact!
  const worldOrigins = ch.parentShards.map((s) => {
    const rw = qRotate(ch.quat, s.centroid);
    return [ch.worldPos[0] + rw[0], Math.max(0.02, ch.worldPos[1] + rw[1]), ch.worldPos[2] + rw[2]] as Vec3;
  });
  const localOrigins = ch.parentShards.map((s) => s.centroid);
  burstSplinters(
    worldOrigins,
    localOrigins,
    [ch.worldVel[0] * 0.45, 1.45, ch.worldVel[2] * 0.45],
    440,
    cfg.explodeForce * 1.35,
    0.0017,
    0.0072,
    ch.gemId,
  );

  const totalSlots = ch.flatShards.length;
  if (nextShardId + totalSlots > MAX_SHARDS) {
    gpu.clearShards();
    scatters.length = 0;
    floorObstacles.length = 0;
    nextShardId = 0;
  }

  const baseId = nextShardId;
  nextShardId += totalSlots;

  const meshVerts = triangulateShards(ch.flatShards, baseId);
  gpu.addShardBatch(meshVerts, baseId, totalSlots, MAX_SHARD_BATCHES);

  for (let i = 0; i < totalSlots; i++) {
    const o = i * 7;
    const py = bake.frames[o + 1];
    const active = py > -100;
    gpu.setShardPose(
      baseId + i,
      [bake.frames[o], active ? py : -999, bake.frames[o + 2]],
      [bake.frames[o + 3], bake.frames[o + 4], bake.frames[o + 5], bake.frames[o + 6]],
      active,
      ch.gemId,
    );
  }
  gpu.flushShardPoses(nextShardId);

  scatters.push({
    baseShardId: baseId,
    numShards: totalSlots,
    fps: bake.fps,
    numFrames: bake.numFrames,
    frames: bake.frames,
    contacts: bake.contacts,
    nextContact: 0,
    elapsed: 0,
    settled: false,
    gemId: ch.gemId,
    shards: ch.flatShards,
  });
}

/** Immediately shatter a polyhedron mid-air (used for the dramatic all-explodes loss climax!). */
function explodePolyMidAir(poly: Poly, pos: Vec3, quat: Quat, vel: Vec3, gemId: number, shardBudget: number) {
  const { shards } = shatterPoly(poly, [0, 1, 0], 0, shardBudget, rng);
  if (shards.length === 0) return;

  const flatShards: ShatterShard[] = [];
  for (const s of shards) flatShards.push(s);
  for (const s of shards) {
    if (s.children) {
      for (const kid of s.children) flatShards.push(kid);
    }
  }

  const chunkCW = add3(pos, qRotate(quat, poly.centroid));
  let childCursor = shards.length;
  const shardInputs: ShardBakeInput[] = [];

  for (let i = 0; i < shards.length; i++) {
    const s = shards[i];
    const relWorld = qRotate(quat, s.centroid);
    const initPos: Vec3 = [pos[0] + relWorld[0], Math.max(0.04, pos[1] + relWorld[1]), pos[2] + relWorld[2]];
    const fromC = sub3(initPos, chunkCW);
    const rad = len3(fromC) > 1e-4 ? norm3(fromC) : norm3([rng() - 0.5, rng() - 0.3, rng() - 0.5]);
    const f = cfg.explodeForce * (1.05 + rng() * 0.95);
    const linVel: Vec3 = [
      vel[0] * 0.3 + rad[0] * f * 1.45 + (rng() - 0.5) * 1.2,
      vel[1] * 0.25 + rad[1] * f * 1.15 + 0.95 + rng() * 1.1,
      vel[2] * 0.3 + rad[2] * f * 1.45 + (rng() - 0.5) * 1.2,
    ];
    let children: ChildShardBakeInput[] | undefined;
    if (s.children && s.children.length >= 2) {
      children = s.children.map((kid) => ({
        slotIndex: childCursor++,
        hullVerts: kid.hullVerts,
        localOffset: sub3(kid.centroid, s.centroid),
        volume: kid.volume,
      }));
    }
    shardInputs.push({
      slotIndex: i,
      hullVerts: s.hullVerts,
      initPos,
      initQuat: quat,
      linVel,
      angVel: [(rng() - 0.5) * 20, (rng() - 0.5) * 20, (rng() - 0.5) * 20],
      volume: s.volume,
      breakSpeed: 1.05 + rng() * 0.85,
      children,
    });
  }

  burstSplinters(
    shards.map((s) => {
      const rw = qRotate(quat, s.centroid);
      return [pos[0] + rw[0], Math.max(0.03, pos[1] + rw[1]), pos[2] + rw[2]] as Vec3;
    }),
    shards.map((s) => s.centroid),
    [0, 1.2, 0],
    260,
    cfg.explodeForce * 1.65,
    0.0018,
    0.0082,
    gemId,
  );

  // Use a one-shot FallingChunk marked hitGroundWaiting so worker.onmessage immediately launches its scatter!
  const fakeChunk: FallingChunk = {
    slotIdx: -1,
    cutPoly: poly,
    worldPos: [...pos] as Vec3,
    worldVel: [...vel] as Vec3,
    quat: [...quat] as Quat,
    angVel: [0, 0, 0],
    targetShards: shardBudget,
    gemId,
    bakeStarted: true,
    bakeId: 0,
    flatShards,
    parentShards: shards,
    bakedResp: null,
    hitGroundWaiting: true,
    detonated: false,
  };
  const bakeId = nextBakeId++;
  fakeChunk.bakeId = bakeId;
  fallingBakes.set(bakeId, fakeChunk);

  worker.postMessage({
    id: bakeId,
    totalSlots: flatShards.length,
    shards: shardInputs,
    staticObstacles: floorObstacles.slice(-MAX_FLOOR_OBSTACLES),
    maxFrames: IS_MOBILE ? 210 : 250,
    fps: 60,
  } as BakeRequest);
}

/** Dramatic Lose Trigger: ALL PAUSES -> SCREEN SHAKES -> ALL EXPLODES! */
function triggerGameFail(reason: string) {
  if (gamePhase === 'failing' || gamePhase === 'lost') return;
  gamePhase = 'failing';
  failReason = reason;
  failFreezeTimer = 0.42;
  shakeTimer = 0.82;
  shakeAmp = 0.068;
  failFlash = 1.0;
  sound.wake();
  sound.failFreeze();
  hideBanner();
  updateActionUI();
}

/** Climax of loss freeze: EVERY crystal and falling piece on screen explodes simultaneously! */
function explodeEverythingNow() {
  const totalPieces = flyingCrystals.length + fallingChunks.length;
  const budget = Math.max(22, Math.min(54, Math.round(130 / Math.max(1, totalPieces))));

  // Explode every flying crystal (colored gems & poisoned black diamonds!)
  for (const fc of [...flyingCrystals]) {
    gpu.clearCutSlot(fc.slotIdx);
    explodePolyMidAir(fc.poly, fc.pos, fc.quat, fc.vel, fc.gemId, budget);
  }
  flyingCrystals.length = 0;

  // Explode every tumbling cut half currently in the air
  for (const ch of [...fallingChunks]) {
    if (ch.detonated) continue;
    gpu.clearCutSlot(ch.slotIdx);
    if (ch.bakedResp) {
      detonateFallingChunk(ch);
    } else {
      ch.detonated = true;
      explodePolyMidAir(ch.cutPoly, ch.worldPos, ch.quat, ch.worldVel, ch.gemId, budget);
    }
  }
  fallingChunks.length = 0;

  // Even if the missed crystal already fell off-screen and nothing else was visible, burst a shockwave from bottom center!
  if (totalPieces === 0) {
    burstSplinters(
      [[0, 0.12, 0]],
      [[0, 0, 0]],
      [0, 2.2, 0],
      380,
      3.4,
      0.0022,
      0.0085,
      GEM_BLACK,
    );
  }

  sound.bombExplode();
  sound.shatter(0.68);
  shakeTimer = Math.max(shakeTimer, 0.36);
  shakeAmp = Math.max(shakeAmp, 0.055);
  gamePhase = 'lost';
  replayPending = true;
  replayDelayTimer = 2.0;

  updateActionUI();
}

/** Start (or retry) a deterministic level 1..1000 cleanly! */
function startLevel(lv: number, resetScore = false) {
  currentLevel = Math.max(1, Math.min(MAX_LEVEL, Math.floor(lv)));
  if (resetScore) {
    score = 0;
    blitzTier = 0;
    lastComboAt = -99999;
  }

  pending = null;
  bakingCutVisual = null;
  inFlightBakes.clear();
  flyingCrystals.length = 0;
  fallingChunks.length = 0;
  fallingBakes.clear();
  callouts.length = 0;
  gpu.clearAllCutSlots();
  blockParts = [];
  gpu.setMainBlocks([]);

  levelPlan = buildLevel(currentLevel);
  levelTime = 0;
  nextThrowIdx = 0;
  nextWarnIdx = 0;
  nextPopIdx = 0;
  gamePhase = 'playing';
  failFreezeTimer = 0;
  clearWaitTimer = 0;
  replayPending = false;
  replayDelayTimer = 0;
  hitStopTimer = 0;
  strokeMultiCount = 0;
  strokeHitIds.clear();
  strokeLastHitAt = -99999;

  hideBanner();
  updateActionUI();
}

/** Spawn one deterministic ThrowSpec from the active LevelPlan, scaled cleanly to the viewport width! */
function spawnScheduledThrow(th: ThrowSpec) {
  const { stageHalfW } = getTossStageLayout();
  const trng = mulberry32(th.seed);
  const poly = makeCrystalPoly(CRYSTAL_SIZE, th.variant);
  const slotIdx = allocCutSlot();

  const x0 = th.lane * stageHalfW;
  const xApex = th.targetLane * stageHalfW;
  const y0 = -0.82;
  // Assign a clean depth plane (front-most free slot, stepping slightly behind any airborne gem so crossing trajectories never clip!)
  const zCandidates = [0.08, -0.34, -0.76, 0.46, -1.16];
  let z0 = zCandidates[0];
  let bestClearance = -1;
  for (const zc of zCandidates) {
    let minDz = Infinity;
    for (const other of flyingCrystals) {
      const dz = Math.abs(zc - other.pos[2]);
      if (dz < minDz) minDz = dz;
    }
    if (minDz >= 0.40) {
      z0 = zc;
      break;
    }
    if (minDz > bestClearance) {
      bestClearance = minDz;
      z0 = zc;
    }
  }
  const vy0 = Math.sqrt(2 * th.gravity * (th.apex - y0));
  const tApex = vy0 / th.gravity;
  const vx0 = (xApex - x0) / Math.max(0.25, tApex);
  const vz0 = 0;

  const pos: Vec3 = [x0, y0, z0];
  const vel: Vec3 = [vx0, vy0, vz0];
  const quat = qNorm(
    qMul(
      qFromAxisAngle([0, 1, 0], (trng() - 0.5) * Math.PI * 1.4),
      qMul(
        qFromAxisAngle([1, 0, 0], (trng() - 0.5) * 0.85),
        qFromAxisAngle([0, 0, 1], (trng() - 0.5) * 0.65),
      ),
    ),
  );
  const spinAxis = norm3([(trng() - 0.5) * 1.6, 0.5 + trng() * 1.1, (trng() - 0.5) * 1.4]);
  const angVel = scale3(spinAxis, th.spinSpeed);

  gpu.setCutSlot(
    slotIdx,
    {
      verts: triangulatePoly(poly),
      planes: polyPlanes(poly),
      crackVerts: new Float32Array(0),
      surfaceCrackVerts: new Float32Array(0),
    },
    pos,
    quat,
    th.gemId,
  );

  flyingCrystals.push({
    id: nextCrystalId++,
    slotIdx,
    poly,
    startVol: Math.max(0.01, poly.volume),
    pos,
    vel,
    quat,
    angVel,
    gravity: th.gravity,
    poisoned: th.poisoned,
    gemId: th.gemId,
    slices: 0,
    lastSlicedAt: -1000,
    swipeEntered: false,
    swipeDist: 0,
    enterX: 0,
    enterY: 0,
  });

  // Gem launch sound: clean pop plays right as it launches (~0.18s before entering view from below!)
  const launchPan = Math.max(-0.85, Math.min(0.85, (x0 / Math.max(0.25, stageHalfW)) * 0.78));
  if (th.poisoned) {
    sound.launch(launchPan, true);
  } else {
    sound.gemPop(launchPan);
  }
}

/** Spawn a solid tumbling crystal chunk that falls under gravity and explodes ONLY on ground impact! */
function spawnFallingCrystalChunk(
  cutPoly: Poly,
  livePos: Vec3,
  liveQuat: Quat,
  liveVel: Vec3,
  liveAngVel: Vec3,
  pushWorld: Vec3,
  section: Vec3[],
  targetShards: number,
  isBallistic: boolean,
  sparkCount: number,
  gemId = 0,
) {
  const initVel: Vec3 = isBallistic
    ? add3(liveVel, add3(scale3(pushWorld, 0.72), [0, 0.22, 0]))
    : add3(scale3(pushWorld, 0.85), [0, 0.36, 0]);
  const kickAxis = cross3(pushWorld, [0, 1, 0]);
  const kLen = len3(kickAxis);
  const initAngVel: Vec3 = add3(
    isBallistic ? scale3(liveAngVel, 0.75) : [0, 0, 0],
    kLen > 1e-3
      ? add3(scale3(kickAxis, 3.2 / kLen), [(rng() - 0.5) * 2.2, (rng() - 0.5) * 2.2, (rng() - 0.5) * 2.2])
      : [(rng() - 0.5) * 4.5, (rng() - 0.5) * 4.5, (rng() - 0.5) * 4.5],
  );

  const slotIdx = allocCutSlot();
  const initPos: Vec3 = add3(livePos, scale3(pushWorld, 0.012));
  const initQuat: Quat = [...liveQuat] as Quat;
  gpu.setCutSlot(
    slotIdx,
    {
      verts: triangulatePoly(cutPoly),
      planes: polyPlanes(cutPoly),
      crackVerts: new Float32Array(0),
      surfaceCrackVerts: new Float32Array(0),
    },
    initPos,
    initQuat,
    gemId,
  );

  fallingChunks.push({
    slotIdx,
    cutPoly,
    worldPos: initPos,
    worldVel: initVel,
    quat: initQuat,
    angVel: initAngVel,
    targetShards,
    gemId,
    bakeStarted: false,
    bakeId: 0,
    flatShards: [],
    parentShards: [],
    bakedResp: null,
    hitGroundWaiting: false,
    detonated: false,
  });

  const sectionWorld = section.map((pt) => add3(livePos, qRotate(liveQuat, pt)));
  burstSplinters(
    sectionWorld.length > 0 ? sectionWorld : [add3(livePos, qRotate(liveQuat, cutPoly.centroid))],
    section.length > 0 ? section : [cutPoly.centroid],
    add3(isBallistic ? scale3(liveVel, 0.45) : [0, 0, 0], add3(scale3(pushWorld, 0.95), [0, 0.28, 0])),
    sparkCount,
    1.05,
    0.0018,
    0.0068,
    gemId,
  );
}

/** Slice one airborne FlyingCrystal along the 3D plane of the swipe segment (x0,y0) -> (x1,y1)! */
function sliceFlyingCrystal(fc: FlyingCrystal, x0: number, y0: number, x1: number, y1: number, nowMs: number): boolean {
  if (gamePhase !== 'playing') return false;

  // POISONED BLACK DIAMOND -> instant dramatic loss (all pauses -> screen shakes -> all explodes)!
  if (fc.poisoned) {
    slashFlash = 1.0;
    triggerGameFail('Hit a black diamond');
    return true;
  }

  const wp = swipeToWorldPlaneAt(x0, y0, x1, y1, fc.pos);
  if (!wp) return false;

  const invQ = qConj(fc.quat);
  const localPlanes: Plane[] = [{ n: norm3(qRotate(invQ, wp.n)), d: wp.d }];
  if (freeSym && wp.d > 0.012) {
    const n2: Vec3 = [-wp.n[0], -wp.n[1], -wp.n[2]];
    localPlanes.push({ n: norm3(qRotate(invQ, n2)), d: wp.d });
  }

  let kept: Poly | null = fc.poly;
  const cutCandidates: Array<{ cutPoly: Poly; localN: Vec3; localD: number; localPush: Vec3; section: Vec3[] }> = [];

  for (const pl of localPlanes) {
    if (!kept) break;
    const sp = splitPoly(kept, pl.n, pl.d);
    if (sp.neg && sp.pos && sp.neg.volume > 0.00005 && sp.pos.volume > 0.00005) {
      const distNeg = len3(sp.neg.centroid);
      const distPos = len3(sp.pos.centroid);
      if (distPos >= distNeg) {
        kept = sp.neg;
        cutCandidates.push({ cutPoly: sp.pos, localN: pl.n, localD: pl.d, localPush: pl.n, section: sp.section });
      } else {
        kept = sp.pos;
        const invN: Vec3 = [-pl.n[0], -pl.n[1], -pl.n[2]];
        cutCandidates.push({ cutPoly: sp.neg, localN: invN, localD: -pl.d, localPush: invN, section: sp.section });
      }
    }
  }

  if (cutCandidates.length === 0 || !kept) return false;

  sound.wake();
  sound.cleave(0.14, false);
  slashFlash = 1.0;
  hitStopTimer = 0.028;
  fc.slices++;
  fc.lastSlicedAt = nowMs;

  const livePos: Vec3 = [...fc.pos] as Vec3;
  const liveQuat: Quat = [...fc.quat] as Quat;
  const liveVel: Vec3 = [...fc.vel] as Vec3;
  const liveAngVel: Vec3 = [...fc.angVel] as Vec3;
  const pan = Math.max(-1, Math.min(1, livePos[0] * 0.9));

  // --- FRUIT NINJA SCORING ---
  // 1) Base hit: +1 per gem (in the gem's jewel color).
  // 2) Same-direction Combo (3+ gems in one swipe): +N bonus flushed when the swipe ends / turns / times out.
  // 3) Precision Critical (tight surgical dead-center cleave <= 8.5mm): +10 CRITICAL!
  // 4) Jewel Cutter Extra Cut (max 2x slices per gem): +1!
  const isCritical = wp.d < 0.0085 && !freeSym && fc.slices === 1;
  if (fc.slices === 1) {
    if (!strokeHitIds.has(fc.id)) {
      strokeHitIds.add(fc.id);
      strokeMultiCount++;
      strokeLastHitAt = nowMs;
      strokeLastPos = livePos;
      strokeLastGemId = fc.gemId;
    }
    if (isCritical) {
      sound.comboChime(4, pan);
      addScore(11, livePos, 'CRITICAL', '+10', true, fc.gemId);
    } else {
      addScore(1, livePos, '+1', undefined, false, fc.gemId);
    }
  } else {
    sound.comboChime(fc.slices + 1, pan);
    addScore(1, livePos, `CUT ×${fc.slices}`, '+1', true, fc.gemId);
  }

// Dead-center bullseye, 2nd cut cap (max 2x slices per gem), OR small remaining core -> split BOTH halves cleanly and send both tumbling to explode on the ground!
  const isBullseye = wp.d < 0.030 && !freeSym;
  const finished = isBullseye || fc.slices >= 2 || kept.volume < fc.startVol * 0.25;

  if (finished) {
    const primary = cutCandidates[0];
    const oppN: Vec3 = [-primary.localN[0], -primary.localN[1], -primary.localN[2]];
    cutCandidates.push({
      cutPoly: kept,
      localN: oppN,
      localD: -primary.localD,
      localPush: oppN,
      section: primary.section,
    });
    gpu.clearCutSlot(fc.slotIdx);
    const idx = flyingCrystals.indexOf(fc);
    if (idx >= 0) flyingCrystals.splice(idx, 1);
  } else {
    // Surviving crystal piece stays aloft with a crisp juggle pop so you can earn Jewel Cutter extra cuts!
    fc.poly = kept;
    gpu.setCutSlot(
      fc.slotIdx,
      {
        verts: triangulatePoly(kept),
        planes: polyPlanes(kept),
        crackVerts: new Float32Array(0),
        surfaceCrackVerts: new Float32Array(0),
      },
      fc.pos,
      fc.quat,
      fc.gemId,
    );
    const { stageHalfW } = getTossStageLayout();
    const mainPushW = norm3(qRotate(liveQuat, cutCandidates[0].localPush));
    const targetJuggleY = Math.min(1.12, Math.max(fc.pos[1] + 0.18, 0.86));
    const juggleVy = Math.sqrt(2 * fc.gravity * Math.max(0.10, targetJuggleY - fc.pos[1]));
    const pullX = Math.abs(fc.pos[0]) > stageHalfW * 0.7 ? -fc.pos[0] * 0.65 : -fc.pos[0] * 0.28;
    fc.vel = [
      fc.vel[0] * 0.45 + pullX - mainPushW[0] * 0.22,
      juggleVy,
      fc.vel[2] * 0.25 - mainPushW[2] * 0.10,
    ];
    const kickAxis = cross3(mainPushW, [0, 1, 0]);
    const kLen = len3(kickAxis);
    if (kLen > 1e-3) {
      fc.angVel = add3(scale3(fc.angVel, 0.7), scale3(kickAxis, 2.2 / kLen));
    }
  }

  // Keep shard budget balanced across multi-crystal waves so large salvos stay silky 60fps!
  const perChunkBudget = Math.round(cfg.shardCount * (cutCandidates.length > 1 ? 0.46 : 0.64));
  for (const c of cutCandidates) {
    const volRatio = Math.min(1.22, Math.max(0.42, Math.pow(c.cutPoly.volume / 0.0075, 0.62)));
    const targetShards = Math.round(perChunkBudget * volRatio);
    const pushWorld = norm3(qRotate(liveQuat, c.localPush));
    spawnFallingCrystalChunk(
      c.cutPoly,
      livePos,
      liveQuat,
      liveVel,
      liveAngVel,
      pushWorld,
      c.section,
      targetShards,
      true,
      cutCandidates.length > 1 ? 34 : 48,
      fc.gemId,
    );
  }

  updateActionUI();
  return true;
}

/**
 * STAGE 1: Execute a slice along `customWorldPlane` (from Fruit Ninja swipe!) or the next Carve step!
 * If a previous piece is still cracking, immediately bursts it so rapid combo slashes never stall!
 */
function executeSlice(customWorldPlane?: { n: Vec3; d: number } | null): boolean {
  // Rapid combo slash: if a previous cut is still cracking, shatter it immediately!
  if (pending) {
    triggerShatter();
  }

  if (carvePlan && carveStepIdx >= carvePlan.steps.length) {
    resetBlock();
    return true;
  }

  if (blockParts.length === 0) return false;

  sound.wake();

  const cutCandidates: Array<{ cutPoly: Poly; localN: Vec3; localD: number; localPush: Vec3; section: Vec3[] }> = [];

  if (carvePlan) {
    const step = carvePlan.steps[carveStepIdx];
    carveStepIdx++;

    if (step.kind === 'plane') {
      let currentParts = [...blockParts];
      for (const pl of step.planes) {
        const nextKept: Poly[] = [];
        for (const bp of currentParts) {
          const sp = splitPoly(bp, pl.n, pl.d);
          if (sp.neg && sp.pos && sp.neg.volume > 0.00012 && sp.pos.volume > 0.00012) {
            nextKept.push(sp.neg);
            cutCandidates.push({
              cutPoly: sp.pos,
              localN: pl.n,
              localD: pl.d,
              localPush: pl.n,
              section: sp.section,
            });
          } else {
            nextKept.push(sp.neg ?? bp);
          }
        }
        currentParts = nextKept;
      }
      if (currentParts.length > 0) blockParts = currentParts;
    } else {
      blockParts = step.nextParts;
      for (const ch of step.chunks) {
        cutCandidates.push({
          cutPoly: ch.poly,
          localN: ch.cutPlane.n,
          localD: ch.cutPlane.d,
          localPush: norm3(ch.pushDir),
          section: [],
        });
      }
    }
  } else {
    if (!customWorldPlane) return false;
    const invQ = qConj(blockQuat);
    const localPlanes: Plane[] = [{ n: norm3(qRotate(invQ, customWorldPlane.n)), d: customWorldPlane.d }];
    if (freeSym && customWorldPlane.d > 0.015) {
      const n2: Vec3 = [-customWorldPlane.n[0], -customWorldPlane.n[1], -customWorldPlane.n[2]];
      localPlanes.push({ n: norm3(qRotate(invQ, n2)), d: customWorldPlane.d });
    }

    let currentParts = [...blockParts];
    for (const pl of localPlanes) {
      const nextKept: Poly[] = [];
      for (const bp of currentParts) {
        const sp = splitPoly(bp, pl.n, pl.d);
        if (sp.neg && sp.pos && sp.neg.volume > 0.00005 && sp.pos.volume > 0.00005) {
          // Remove the piece furthest away from center (0, 0, 0)!
          const distNeg = len3(sp.neg.centroid);
          const distPos = len3(sp.pos.centroid);
          if (distPos >= distNeg) {
            nextKept.push(sp.neg);
            cutCandidates.push({ cutPoly: sp.pos, localN: pl.n, localD: pl.d, localPush: pl.n, section: sp.section });
          } else {
            nextKept.push(sp.pos);
            const invN: Vec3 = [-pl.n[0], -pl.n[1], -pl.n[2]];
            cutCandidates.push({ cutPoly: sp.neg, localN: invN, localD: -pl.d, localPush: invN, section: sp.section });
          }
        } else {
          nextKept.push(bp);
        }
      }
      currentParts = nextKept;
    }
    if (currentParts.length > 0) blockParts = currentParts;
  }

  if (cutCandidates.length === 0) {
    updateLivePreview();
    updateActionUI();
    return false;
  }

  cutCandidates.sort((a, b) => b.cutPoly.volume - a.cutPoly.volume);
  const chosen = cutCandidates.slice(0, 2);

  const livePos: Vec3 = [...blockPos] as Vec3;
  const liveQuat: Quat = [...blockQuat] as Quat;
  const liveVel: Vec3 = [...blockVel] as Vec3;
  uploadMainBlocks();

  const perChunkBudget = chosen.length > 1 ? Math.round(cfg.shardCount * 0.62) : cfg.shardCount;
  const isBallistic = false;

  // Ground-explosion mode (default when Auto is ON): severed crystal halves stay intact while tumbling
  // through the air under gravity and ONLY explode the exact moment they slam into the studio floor!
  if (EXPLODE_ON_GROUND && autoShatter) {
    slashFlash = 1.0;
    sound.cleave(0.14, false);

    for (let ci = 0; ci < chosen.length; ci++) {
      const c = chosen[ci];
      const refVol = carvePlan ? 0.026 : 0.0075;
      const volRatio = Math.min(1.45, Math.max(0.42, Math.pow(c.cutPoly.volume / refVol, 0.65)));
      const targetShards = Math.round(perChunkBudget * volRatio);
      const pushWorld = norm3(qRotate(liveQuat, c.localPush));

      // Crisp clean separation velocity + tumbling spin as the severed crystal falls toward the floor
      const initVel: Vec3 = isBallistic
        ? add3(liveVel, add3(scale3(pushWorld, 0.72), [0, 0.24, 0]))
        : add3(scale3(pushWorld, 0.85), [0, 0.36, 0]);
      const kickAxis = cross3(pushWorld, [0, 1, 0]);
      const kLen = len3(kickAxis);
      const initAngVel: Vec3 = add3(
        isBallistic ? scale3(blockAngVel, 0.75) : [0, 0, 0],
        kLen > 1e-3
          ? add3(scale3(kickAxis, 3.2 / kLen), [(rng() - 0.5) * 2.2, (rng() - 0.5) * 2.2, (rng() - 0.5) * 2.2])
          : [(rng() - 0.5) * 4.5, (rng() - 0.5) * 4.5, (rng() - 0.5) * 4.5],
      );

      const slotIdx = allocCutSlot();
      const initPos: Vec3 = add3(livePos, scale3(pushWorld, 0.012));
      const initQuat: Quat = [...liveQuat] as Quat;
      gpu.setCutSlot(
        slotIdx,
        {
          verts: triangulatePoly(c.cutPoly),
          planes: polyPlanes(c.cutPoly),
          crackVerts: new Float32Array(0),
          surfaceCrackVerts: new Float32Array(0),
        },
        initPos,
        initQuat,
      );

      fallingChunks.push({
        slotIdx,
        cutPoly: c.cutPoly,
        worldPos: initPos,
        worldVel: initVel,
        quat: initQuat,
        angVel: initAngVel,
        targetShards,
        gemId: 0,
        bakeStarted: false,
        bakeId: 0,
        flatShards: [],
        parentShards: [],
        bakedResp: null,
        hitGroundWaiting: false,
        detonated: false,
      });

      // Tiny razor-spark spray right along the diamond cleave seam
      const sectionWorld = c.section.map((pt) => add3(livePos, qRotate(liveQuat, pt)));
      burstSplinters(
        sectionWorld.length > 0 ? sectionWorld : [add3(livePos, qRotate(liveQuat, c.cutPoly.centroid))],
        c.section.length > 0 ? c.section : [c.cutPoly.centroid],
        add3(isBallistic ? scale3(liveVel, 0.45) : [0, 0, 0], add3(scale3(pushWorld, 0.95), [0, 0.30, 0])),
        chosen.length > 1 ? 45 : 65,
        1.05,
        0.0020,
        0.0075,
      );
    }

    updateActionUI();
    return true;
  }

  const pendingChunks: PendingChunk[] = [];
  const uploads: CutPieceUpload[] = [];
  const flatShards: ShatterShard[] = [];
  const parentChunkIdx: number[] = [];

  for (let ci = 0; ci < chosen.length; ci++) {
    const c = chosen[ci];
    const volRatio = Math.min(1.45, Math.max(0.38, Math.pow(c.cutPoly.volume / 0.026, 0.7)));
    const targetShards = Math.round(perChunkBudget * volRatio);
    const { shards, crackFaces, surfaceCracks } = shatterPoly(c.cutPoly, c.localN, c.localD, targetShards, rng);

    const pushWorld = norm3(qRotate(liveQuat, c.localPush));
    const chunkVel: Vec3 = isBallistic
      ? add3(liveVel, add3(scale3(pushWorld, 0.85), [0, 0.32, 0]))
      : [0, 0, 0];

    pendingChunks.push({
      cutPoly: c.cutPoly,
      shards,
      localPushDir: c.localPush,
      worldPos: [...livePos] as Vec3,
      worldVel: chunkVel,
      ballistic: isBallistic,
    });
    uploads.push({
      verts: triangulatePoly(c.cutPoly),
      planes: polyPlanes(c.cutPoly),
      crackVerts: crackleOn ? triangulateCracks(crackFaces) : new Float32Array(0),
      surfaceCrackVerts: crackleOn ? triangulateSurfaceCracks(surfaceCracks) : new Float32Array(0),
    });

    const sectionWorld = c.section.map((pt) => add3(livePos, qRotate(liveQuat, pt)));
    burstSplinters(
      sectionWorld.length > 0 ? sectionWorld : [add3(livePos, qRotate(liveQuat, c.cutPoly.centroid))],
      c.section.length > 0 ? c.section : [c.cutPoly.centroid],
      add3(isBallistic ? scale3(liveVel, 0.5) : [0, 0, 0], add3(scale3(pushWorld, 1.05), [0, 0.35, 0])),
      chosen.length > 1 ? 85 : 130,
      1.2,
      0.0026,
      0.009,
    );
  }

  for (let ci = 0; ci < pendingChunks.length; ci++) {
    for (const s of pendingChunks[ci].shards) {
      flatShards.push(s);
      parentChunkIdx.push(ci);
    }
  }
  for (const ch of pendingChunks) {
    for (const s of ch.shards) {
      if (s.children) {
        for (const kid of s.children) flatShards.push(kid);
      }
    }
  }

  const crackDur = crackleOn ? (isBallistic ? Math.min(0.20, cfg.crackDuration) : cfg.crackDuration) : 0.001;
  slashFlash = 1.0;

  const cutSpinKick = isBallistic ? add3(blockAngVel, [(rng() - 0.5) * 3.5, (rng() - 0.5) * 3.5, (rng() - 0.5) * 3.5]) : [0, 0, 0] as Vec3;

  pending = {
    chunks: pendingChunks,
    flatShards,
    parentChunkIdx,
    crackElapsed: 0,
    crackDur,
    cutQuat: [...liveQuat] as Quat,
    cutAngVel: cutSpinKick,
    ballistic: isBallistic,
    shattering: false,
    bakeId: 0,
  };

  gpu.setCutPieces(uploads);

  if (!crackleOn && autoShatter) {
    // Crackle deactivated + Auto ON: kick off Rapier shatter immediately while keeping the clean crack-free chunk visible during the brief bake!
    bakingCutVisual = pending;
    triggerShatter();
  } else {
    bakingCutVisual = null;
    sound.cleave(crackDur, crackleOn);
    updateActionUI();
  }
  return true;
}

/**
 * STAGE 2: Explode & scatter all active cracked chunks into Rapier rigid shards + GPU splinters!
 * Moves `pending` into `inFlightBakes` immediately so rapid Fruit Ninja combo slashes never block!
 */
function triggerShatter() {
  if (!pending) return;
  sound.wake();

  const p = pending;
  pending = null;
  p.shattering = true;

  const liveQuat: Quat = p.ballistic ? ([...p.cutQuat] as Quat) : ([...blockQuat] as Quat);
  const pFrac = Math.min(1, p.crackElapsed / Math.max(0.05, p.crackDur));
  const drift = 0.003 + 0.009 * (1 - Math.pow(1 - pFrac, 2.4));

  const liveNormals = p.chunks.map((ch) => norm3(qRotate(liveQuat, ch.localPushDir)));
  const chunkBasePos = p.chunks.map((ch, idx) =>
    ch.ballistic ? ch.worldPos : add3(blockPos, scale3(liveNormals[idx], drift)),
  );
  const chunkCentroidsWorld = p.chunks.map((ch, idx) =>
    add3(chunkBasePos[idx], qRotate(liveQuat, ch.cutPoly.centroid)),
  );

  const splCount = Math.round(680 / Math.max(1, p.chunks.length));
  for (let ci = 0; ci < p.chunks.length; ci++) {
    const ch = p.chunks[ci];
    const worldOrigins = ch.shards.map((s) => add3(chunkBasePos[ci], qRotate(liveQuat, s.centroid)));
    const localOrigins = ch.shards.map((s) => s.centroid);
    burstSplinters(
      worldOrigins,
      localOrigins,
      add3(ch.worldVel, add3(scale3(liveNormals[ci], cfg.explodeForce * 1.15), [0, 0.95, 0])),
      splCount,
      cfg.explodeForce * 1.35,
      0.0022,
      0.0095,
    );
  }

  const rate = slowMode || shiftSlow ? 0.28 : 1.0;
  sound.shatter(rate);

  const bakeId = nextBakeId++;
  p.bakeId = bakeId;
  inFlightBakes.set(bakeId, p);

  const totalParents = p.parentChunkIdx.length;
  let childCursor = totalParents;
  const shardInputs: ShardBakeInput[] = [];

  for (let parentSlot = 0; parentSlot < totalParents; parentSlot++) {
    const s = p.flatShards[parentSlot];
    const ci = p.parentChunkIdx[parentSlot];
    const ch = p.chunks[ci];
    const pushN = liveNormals[ci];
    const baseP = chunkBasePos[ci];
    const chunkCW = chunkCentroidsWorld[ci];

    const relWorld = qRotate(liveQuat, s.centroid);
    const initPos: Vec3 = [baseP[0] + relWorld[0], Math.max(0.03, baseP[1] + relWorld[1]), baseP[2] + relWorld[2]];
    const fromChunk = sub3(initPos, chunkCW);
    const radial = len3(fromChunk) > 1e-4 ? norm3(fromChunk) : pushN;
    const f = cfg.explodeForce * (0.68 + rng() * 0.85);
    const linVel: Vec3 = [
      ch.worldVel[0] * 0.72 + pushN[0] * (1.05 * f) + radial[0] * (0.88 * f) + (rng() - 0.5) * 0.95,
      ch.worldVel[1] * 0.65 + pushN[1] * (0.52 * f) + radial[1] * (0.62 * f) + 0.65 + rng() * 0.9,
      ch.worldVel[2] * 0.72 + pushN[2] * (1.05 * f) + radial[2] * (0.88 * f) + (rng() - 0.5) * 0.95,
    ];
    const angVelShard: Vec3 = [
      (rng() - 0.5) * 15,
      (rng() - 0.5) * 15,
      (rng() - 0.5) * 15,
    ];

    let children: ChildShardBakeInput[] | undefined;
    if (s.children && s.children.length >= 2) {
      children = s.children.map((kid) => ({
        slotIndex: childCursor++,
        hullVerts: kid.hullVerts,
        localOffset: sub3(kid.centroid, s.centroid),
        volume: kid.volume,
      }));
    }

    shardInputs.push({
      slotIndex: parentSlot,
      hullVerts: s.hullVerts,
      initPos,
      initQuat: liveQuat,
      linVel,
      angVel: angVelShard,
      volume: s.volume,
      breakSpeed: 1.15 + rng() * 0.85,
      children,
    });
  }

  const req: BakeRequest = {
    id: bakeId,
    totalSlots: p.flatShards.length,
    shards: shardInputs,
    staticObstacles: floorObstacles.slice(-MAX_FLOOR_OBSTACLES),
    maxFrames: IS_MOBILE ? 210 : 260,
    fps: 60,
  };
  worker.postMessage(req);
  updateActionUI();
}

worker.onmessage = (ev: MessageEvent<BakeResponse>) => {
  const bake = ev.data;

  // Check if this bake belongs to a ground-exploding FallingChunk!
  const fc = fallingBakes.get(bake.id);
  if (fc) {
    fallingBakes.delete(bake.id);
    if (fc.detonated) return;
    fc.bakedResp = bake;
    if (fc.hitGroundWaiting) {
      detonateFallingChunk(fc);
    }
    return;
  }

  const p = inFlightBakes.get(bake.id);
  if (!p) return;
  inFlightBakes.delete(bake.id);

  // Only clear GPU cut slots if no newer cut has already taken them over!
  if (bakingCutVisual && bakingCutVisual.bakeId === bake.id) {
    bakingCutVisual = null;
  }
  if (!pending && !bakingCutVisual && fallingChunks.length === 0) {
    gpu.clearAllCutSlots();
  }

  const totalSlots = p.flatShards.length;
  if (nextShardId + totalSlots > MAX_SHARDS) {
    gpu.clearShards();
    scatters.length = 0;
    floorObstacles.length = 0;
    nextShardId = 0;
  }

  const baseId = nextShardId;
  nextShardId += totalSlots;

  const meshVerts = triangulateShards(p.flatShards, baseId);
  gpu.addShardBatch(meshVerts, baseId, totalSlots, MAX_SHARD_BATCHES);

  for (let i = 0; i < totalSlots; i++) {
    const o = i * 7;
    const py = bake.frames[o + 1];
    const active = py > -100;
    gpu.setShardPose(
      baseId + i,
      [bake.frames[o], active ? py : -999, bake.frames[o + 2]],
      [bake.frames[o + 3], bake.frames[o + 4], bake.frames[o + 5], bake.frames[o + 6]],
      active,
    );
  }
  gpu.flushShardPoses(nextShardId);

  scatters.push({
    baseShardId: baseId,
    numShards: totalSlots,
    fps: bake.fps,
    numFrames: bake.numFrames,
    frames: bake.frames,
    contacts: bake.contacts,
    nextContact: 0,
    elapsed: 0,
    settled: false,
    gemId: 0,
    shards: p.flatShards,
  });

  updateLivePreview();
  updateActionUI();
};

function setTossMode(on: boolean) {
  tossMode = on && !carvePlan;
  resetBlock();
}

function selectCarveMode(id: CarveId) {
  carveId = id;
  carvePlan = buildCarvePlan(id);
  carveStepIdx = 0;
  tossMode = id === 'free';
  resetBlock();
}

function resetBlock() {
  pending = null;
  bakingCutVisual = null;
  inFlightBakes.clear();
  fallingChunks.length = 0;
  fallingBakes.clear();
  gpu.clearAllCutSlots();
  carveStepIdx = 0;
  hitStopTimer = 0;

  if (tossMode && !carvePlan) {
    replayFromStart();
    updateLivePreview();
    updateActionUI();
    return;
  }

  hideBanner();
  flyingCrystals.length = 0;
  blockParts = [carvePlan ? makeInitialBlock(BLOCK_SIZE) : makeCrystalPoly(CRYSTAL_SIZE, crystalVariant++)];
  blockPos = [...PEDESTAL_CENTER] as Vec3;
  blockVel = [0, 0, 0];
  blockAngVel = [0, 0, 0];
  uploadMainBlocks();

  const isLetter = CARVE_PRESETS.find((p) => p.id === carveId)?.group === 'letter';
  baseQuat = qNorm(
    qMul(
      qFromAxisAngle([1, 0, 0], isLetter ? 0.12 : INIT_PITCH),
      qFromAxisAngle([0, 1, 0], isLetter ? -0.22 : INIT_YAW),
    ),
  );
  mouseQuat = qIdentity();
  targetMouseQuat = qIdentity();
  blockQuat = [...baseQuat] as Quat;
  updateLivePreview();
  updateActionUI();
}

function sweepFloor() {
  gpu.clearShards();
  scatters.length = 0;
  floorObstacles.length = 0;
  nextShardId = 0;
}

/** Clean up all floor shards/splinters and restart fresh from Level 1! */
function replayFromStart() {
  setPaused(false);
  sweepFloor();
  startLevel(1, true);
}

function setPaused(on: boolean) {
  paused = on;
  pauseBtn.classList.toggle('paused', paused);
  pauseBtn.setAttribute('aria-pressed', String(paused));
  pauseBtn.title = paused ? 'Resume (P)' : 'Pause (P)';
  if (paused) {
    swiping = false;
    activePointerId = -1;
  }
}

// =========================================================================
// Fruit Ninja Swipe-to-Slice Interaction!
// =========================================================================
function updateTargetFromPointer(clientX: number, clientY: number) {
  const nx = (clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  const ny = (clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  // Gentle sculptural inspection parallax when hovering (locks steady while slashing!)
  const yaw = nx * 0.48;
  const pitch = ny * 0.30;
  targetMouseQuat = qNorm(
    qMul(
      qFromAxisAngle([1, 0, 0], pitch),
      qFromAxisAngle([0, 1, 0], yaw),
    ),
  );
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (gamePhase === 'lost' && !bannerEl.hidden) {
    sound.wake();
    replayFromStart();
    return;
  }
  if (paused) return;
  sound.wake();
  activePointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);

  swiping = true;
  swipeStartX = e.clientX;
  swipeStartY = e.clientY;
  swipeCurX = e.clientX;
  swipeCurY = e.clientY;
  swipePrevDirX = 0;
  swipePrevDirY = 0;
  lastSwooshDirX = 0;
  lastPointerMoveAt = performance.now();
  swooshAccumDist = 0;
  strokeDirX = 0;
  strokeDirY = 0;
  strokeMultiCount = 0;
  strokeHitIds.clear();
  strokeLastHitAt = -99999;
  swipeInGlassDist = 0;
  swipeDidSlice = false;
  const inGlass = rayHitsBlock(e.clientX, e.clientY);
  swipeEnteredGlass = inGlass;
  trailPts.push({ x: e.clientX, y: e.clientY, t: performance.now(), inGlass });
});

canvas.addEventListener('pointermove', (e) => {
  if (!swiping || e.pointerId !== activePointerId) {
    if (e.pointerType === 'mouse') {
      updateTargetFromPointer(e.clientX, e.clientY);
    }
    return;
  }

  const now = performance.now();
  const moveDtSec = Math.max(0.004, (now - lastPointerMoveAt) * 0.001);
  lastPointerMoveAt = now;
  const prevX = swipeCurX;
  const prevY = swipeCurY;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  const stepDist = Math.hypot(dx, dy);
  const speedPxPerSec = stepDist / moveDtSec;
  swooshAccumDist += stepDist;
  swipeCurX = e.clientX;
  swipeCurY = e.clientY;

  // Detect sharp direction change -> re-anchor slash & reset same-direction multi-hit xN combo!
  if (stepDist > 4) {
    const ux = dx / stepDist;
    const uy = dy / stepDist;
    if (strokeDirX !== 0 || strokeDirY !== 0) {
      const sameDirDot = ux * strokeDirX + uy * strokeDirY;
      if (sameDirDot < 0.42) {
        flushStrokeCombo(now);
        strokeDirX = ux;
        strokeDirY = uy;
      } else {
        // Smoothly track curved swipe tangent while still moving in the same general direction
        const mx = strokeDirX * 0.72 + ux * 0.28;
        const my = strokeDirY * 0.72 + uy * 0.28;
        const ml = Math.hypot(mx, my) || 1;
        strokeDirX = mx / ml;
        strokeDirY = my / ml;
      }
    } else {
      strokeDirX = ux;
      strokeDirY = uy;
    }

    if (!swipeEnteredGlass && (swipePrevDirX !== 0 || swipePrevDirY !== 0)) {
      const turnDot = ux * swipePrevDirX + uy * swipePrevDirY;
      if (turnDot < 0.32) {
        swipeStartX = prevX;
        swipeStartY = prevY;
      }
    }
    swipePrevDirX = ux;
    swipePrevDirY = uy;

    // Frame-rate-independent directional LTR / RTL katana swoosh on brisk strokes (works on 60Hz & 120Hz!)
    const reversedX = lastSwooshDirX !== 0 && ux * lastSwooshDirX < -0.25;
    if (reversedX) swooshAccumDist = Math.max(swooshAccumDist, 22);
    const minCooldown = reversedX ? 105 : 175;
    if (swooshAccumDist >= 22 && speedPxPerSec >= 420 && now - lastSwooshAt >= minCooldown) {
      sound.wake();
      const curPan = (swipeCurX / Math.max(1, window.innerWidth)) * 2 - 1;
      const dirSign = Math.abs(ux) > 0.12 ? Math.sign(ux) : 0;
      const panFrom = curPan - dirSign * 0.50;
      const panTo = curPan + dirSign * 0.56;
      const intensity = Math.min(1, (speedPxPerSec - 380) / 1800);
      sound.swoosh(panFrom, panTo, intensity);
      lastSwooshAt = now;
      lastSwooshDirX = ux;
      swooshAccumDist = 0;
    }
  }

  // Multi-crystal Game Mode: sweep the blade across ALL flying crystals in one directional stroke!
  if (tossMode && !carvePlan) {
    if (gamePhase !== 'playing') {
      if (stepDist > 2) trailPts.push({ x: e.clientX, y: e.clientY, t: now, inGlass: false });
      return;
    }
    const samples = Math.max(1, Math.min(7, Math.ceil(stepDist / 12)));
    let anyEndHit = false;
    const snapshot = [...flyingCrystals];
    for (const fc of snapshot) {
      if (gamePhase !== 'playing') break;
      if (!flyingCrystals.includes(fc)) continue;
      if (now - fc.lastSlicedAt < 170) continue;

      let hitSeg = false;
      let endHit = false;
      for (let s = 1; s <= samples; s++) {
        const f = s / samples;
        const sx = prevX + dx * f;
        const sy = prevY + dy * f;
        const h = rayHitsPolyAt(sx, sy, fc.poly, fc.pos, fc.quat);
        if (h) hitSeg = true;
        if (s === samples) endHit = h;
      }
      if (endHit) anyEndHit = true;

      if (hitSeg) {
        // Poisoned Black Diamond triggers IMMEDIATELY on first blade contact!
        if (fc.poisoned) {
          sliceFlyingCrystal(fc, prevX, prevY, swipeCurX, swipeCurY, now);
          break;
        }
        if (!fc.swipeEntered) {
          fc.swipeEntered = true;
          fc.enterX = prevX;
          fc.enterY = prevY;
          fc.swipeDist = 0;
        }
        fc.swipeDist += stepDist;
      }

      if (fc.swipeEntered) {
        const chord = Math.hypot(swipeCurX - fc.enterX, swipeCurY - fc.enterY);
        if ((!endHit && chord >= 22) || (fc.swipeDist >= 34 && chord >= 28)) {
          sliceFlyingCrystal(fc, fc.enterX, fc.enterY, swipeCurX, swipeCurY, now);
          fc.swipeEntered = false;
          fc.swipeDist = 0;
        }
      }
    }

    if (stepDist > 2) {
      trailPts.push({ x: e.clientX, y: e.clientY, t: now, inGlass: anyEndHit });
    }
    return;
  }

  // Swept 5-sample hit test along (prev -> cur) for Pedestal / Guided Carve mode!
  let segHitGlass = false;
  let endInGlass = false;
  const samples = Math.max(1, Math.min(6, Math.ceil(stepDist / 14)));
  for (let s = 1; s <= samples; s++) {
    const f = s / samples;
    const sx = prevX + dx * f;
    const sy = prevY + dy * f;
    const hit = rayHitsBlock(sx, sy);
    if (hit) segHitGlass = true;
    if (s === samples) endInGlass = hit;
  }

  if (segHitGlass) {
    if (!swipeEnteredGlass) {
      // Anchor start just before entering the glass if the user was waving around waiting
      const curChord = Math.hypot(prevX - swipeStartX, prevY - swipeStartY);
      if (curChord > 180) {
        swipeStartX = prevX - swipePrevDirX * 60;
        swipeStartY = prevY - swipePrevDirY * 60;
      }
    }
    swipeEnteredGlass = true;
    swipeInGlassDist += stepDist;
  }

  if (stepDist > 2) {
    trailPts.push({ x: e.clientX, y: e.clientY, t: now, inGlass: endInGlass });
  }

  // True Fruit Ninja feel: cleave the instant your blade passes cleanly through the glass (or cuts deep into a flying cube)!
  // Once a slice triggers in a continuous hold, wait until the blade exits the glass before arming the return Z-slash.
  if (swipeDidSlice && !endInGlass) {
    swipeStartX = swipeCurX;
    swipeStartY = swipeCurY;
    swipeEnteredGlass = false;
    swipeInGlassDist = 0;
    swipeDidSlice = false;
  }

  const chord = Math.hypot(swipeCurX - swipeStartX, swipeCurY - swipeStartY);
  const exitedGlass = swipeEnteredGlass && !endInGlass && chord >= 30;
  const deepMidAirSlash = tossMode && swipeEnteredGlass && swipeInGlassDist >= 42 && chord >= 42;

  if (!swipeDidSlice && (exitedGlass || deepMidAirSlash)) {
    let didCut = false;
    if (carvePlan) {
      didCut = executeSlice(null);
    } else {
      const wp = swipeToWorldPlane(swipeStartX, swipeStartY, swipeCurX, swipeCurY);
      if (wp) didCut = executeSlice(wp);
    }
    if (didCut) {
      swipeStartX = swipeCurX;
      swipeStartY = swipeCurY;
      swipeEnteredGlass = false;
      swipeInGlassDist = 0;
      swipeDidSlice = true;
    }
  }
});

function endSwipe(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return;
  const now = performance.now();

  if (tossMode && !carvePlan) {
    if (gamePhase === 'playing') {
      for (const fc of [...flyingCrystals]) {
        if (fc.swipeEntered) {
          const chord = Math.hypot(swipeCurX - fc.enterX, swipeCurY - fc.enterY);
          if (chord >= 16) {
            sliceFlyingCrystal(fc, fc.enterX, fc.enterY, swipeCurX, swipeCurY, now);
          }
          fc.swipeEntered = false;
          fc.swipeDist = 0;
        }
      }
    }
    flushStrokeCombo(now);
    swiping = false;
    activePointerId = -1;
    swipeEnteredGlass = false;
    swipeInGlassDist = 0;
    swipeDidSlice = false;
    return;
  }

  const chord = Math.hypot(swipeCurX - swipeStartX, swipeCurY - swipeStartY);

  if (!swipeDidSlice) {
    if (chord >= 22) {
      // Shorter slash that ended inside or near the glass -> cleave cleanly on release!
      if (carvePlan) {
        executeSlice(null);
      } else {
        const wp = swipeToWorldPlane(swipeStartX, swipeStartY, swipeCurX, swipeCurY);
        if (wp) executeSlice(wp);
      }
    } else {
      // Quick tap / click without swiping:
      // - If Auto is off and a cut is poised -> Shatter!
      // - In Shape/Letter mode -> Carve next step!
      if (pending && !autoShatter) {
        triggerShatter();
      } else if (carvePlan) {
        executeSlice(null);
      }
    }
  }

  swiping = false;
  activePointerId = -1;
  swipeEnteredGlass = false;
  swipeInGlassDist = 0;
  swipeDidSlice = false;
}

canvas.addEventListener('pointerup', endSwipe);
canvas.addEventListener('pointercancel', () => {
  for (const fc of flyingCrystals) {
    fc.swipeEntered = false;
    fc.swipeDist = 0;
  }
  swiping = false;
  activePointerId = -1;
  swipeEnteredGlass = false;
  swipeInGlassDist = 0;
  swipeDidSlice = false;
});

/** Render the tapered katana slash ribbon + minimal studio score callouts + fail pulse on the 2D HUD canvas. */
function renderSlashTrail(nowMs: number, rawDt: number) {
  const w = trailCanvas.width;
  const h = trailCanvas.height;
  const cssW = Math.max(1, window.innerWidth);
  const cssH = Math.max(1, window.innerHeight);
  const dpr = w / cssW;
  trailCtx.clearRect(0, 0, w, h);

  // Prune old trail points (> 220 ms)
  const maxAge = 220;
  while (trailPts.length > 0 && nowMs - trailPts[0].t > maxAge) {
    trailPts.shift();
  }

  trailCtx.save();
  trailCtx.scale(dpr, dpr);

  // Subtle dark obsidian vignette pulse during fail freeze / shake
  if (failFlash > 0.01) {
    const grad = trailCtx.createRadialGradient(cssW * 0.5, cssH * 0.5, Math.min(cssW, cssH) * 0.25, cssW * 0.5, cssH * 0.5, Math.max(cssW, cssH) * 0.72);
    grad.addColorStop(0, 'rgba(20, 20, 24, 0)');
    grad.addColorStop(1, `rgba(20, 20, 24, ${(0.28 * failFlash).toFixed(3)})`);
    trailCtx.fillStyle = grad;
    trailCtx.fillRect(0, 0, cssW, cssH);
  }

  // Draw tapered katana slash ribbon
  if (trailPts.length >= 2) {
    type Pt = (typeof trailPts)[number];
    const strokes: Pt[][] = [];
    let cur: Pt[] = [trailPts[0]];
    for (let i = 1; i < trailPts.length; i++) {
      if (trailPts[i].t - trailPts[i - 1].t > 90) {
        if (cur.length >= 2) strokes.push(cur);
        cur = [trailPts[i]];
      } else {
        cur.push(trailPts[i]);
      }
    }
    if (cur.length >= 2) strokes.push(cur);

    const drawRibbon = (pts: Pt[], halfWidthPx: number, fillStyle: CanvasGradient | string) => {
      const n = pts.length;
      const leftX = new Float32Array(n);
      const leftY = new Float32Array(n);
      const rightX = new Float32Array(n);
      const rightY = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(n - 1, i + 1)];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        const nx = -ty;
        const ny = tx;

        const u = i / (n - 1);
        const ageLife = Math.max(0, 1 - (nowMs - pts[i].t) / maxAge);
        const tipPinch = i === n - 1 ? 0 : Math.min(1, (1 - u) * 5.5);
        const tailTaper = Math.pow(u * ageLife, 1.15);
        const r = halfWidthPx * tailTaper * tipPinch;

        leftX[i] = pts[i].x + nx * r;
        leftY[i] = pts[i].y + ny * r;
        rightX[i] = pts[i].x - nx * r;
        rightY[i] = pts[i].y - ny * r;
      }

      trailCtx.beginPath();
      trailCtx.moveTo(leftX[0], leftY[0]);
      for (let i = 1; i < n; i++) trailCtx.lineTo(leftX[i], leftY[i]);
      for (let i = n - 1; i >= 0; i--) trailCtx.lineTo(rightX[i], rightY[i]);
      trailCtx.closePath();
      trailCtx.fillStyle = fillStyle;
      trailCtx.fill();
    };

    const boost = 1 + slashFlash * 0.65;
    for (const stroke of strokes) {
      const first = stroke[0];
      const last = stroke[stroke.length - 1];
      const headLife = Math.max(0, 1 - (nowMs - last.t) / maxAge);
      if (headLife <= 0.01) continue;

      const outerGrad = trailCtx.createLinearGradient(first.x, first.y, last.x, last.y);
      outerGrad.addColorStop(0, 'rgba(24, 24, 28, 0)');
      outerGrad.addColorStop(0.55, `rgba(24, 24, 28, ${(0.34 * headLife).toFixed(3)})`);
      outerGrad.addColorStop(1, `rgba(20, 20, 24, ${(0.72 * headLife).toFixed(3)})`);
      drawRibbon(stroke, 4.2 * boost, outerGrad);

      const innerGrad = trailCtx.createLinearGradient(first.x, first.y, last.x, last.y);
      innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      innerGrad.addColorStop(0.45, `rgba(255, 255, 255, ${(0.65 * headLife).toFixed(3)})`);
      innerGrad.addColorStop(1, `rgba(255, 255, 255, ${(0.98 * headLife).toFixed(3)})`);
      drawRibbon(stroke, 2.0 * boost, innerGrad);
    }
  }

  // Draw floating studio score callouts (+10, 3x +30, CUT +15)
  if (!CLEAN && callouts.length > 0) {
    trailCtx.textAlign = 'center';
    trailCtx.textBaseline = 'middle';
    for (let i = callouts.length - 1; i >= 0; i--) {
      const c = callouts[i];
      c.age += rawDt;
      if (c.age >= c.maxAge) {
        callouts.splice(i, 1);
        continue;
      }
      const u = c.age / c.maxAge;
      const alpha = u < 0.14 ? u / 0.14 : Math.max(0, 1 - (u - 0.14) / 0.86);
      const lift = (1 - Math.pow(1 - u, 2.2)) * (c.emphasis ? 46 : 32);
      const y = c.y - lift;

      trailCtx.globalAlpha = alpha;
      trailCtx.lineJoin = 'round';
      trailCtx.lineWidth = c.emphasis ? 4.5 : 3.5;
      trailCtx.strokeStyle = 'rgba(244, 243, 240, 0.88)';
      trailCtx.font = c.emphasis ? '700 22px "IBM Plex Sans", sans-serif' : '700 16px "IBM Plex Sans", sans-serif';
      trailCtx.strokeText(c.text, c.x, y);
      trailCtx.fillStyle = c.color;
      trailCtx.fillText(c.text, c.x, y);
      if (c.sub) {
        trailCtx.font = '700 10px "Inter", sans-serif';
        trailCtx.lineWidth = 3;
        trailCtx.strokeText(c.sub, c.x, y + 17);
        trailCtx.fillStyle = c.color;
        trailCtx.fillText(c.sub, c.x, y + 17);
      }
    }
    trailCtx.globalAlpha = 1;
  }

  trailCtx.restore();
}

bannerEl.addEventListener('click', () => {
  replayFromStart();
});

soundBtn.addEventListener('click', () => {
  sound.wake();
  sound.setMuted(!sound.muted);
  soundBtn.classList.toggle('muted', sound.muted);
});

pauseBtn.addEventListener('click', () => {
  setPaused(!paused);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Shift') { shiftSlow = true; return; }
  if (e.code === 'Space') {
    e.preventDefault();
    if (gamePhase === 'lost') replayFromStart();
    else if (pending && !autoShatter) triggerShatter();
    else if (carvePlan) executeSlice(null);
    else if (tossMode) setPaused(!paused);
  } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (tossMode && !carvePlan) setPaused(!paused);
  } else if (e.key === '[') {
    if (tossMode && !carvePlan) startLevel(Math.max(1, currentLevel - 1), false);
  } else if (e.key === ']') {
    if (tossMode && !carvePlan) startLevel(Math.min(MAX_LEVEL, currentLevel + 1), false);
  } else if (e.key === 'r' || e.key === 'R') {
    resetBlock();
  } else if (e.key === 'c' || e.key === 'C') {
    sweepFloor();
  } else if (e.key === 'm' || e.key === 'M') {
    sound.wake();
    sound.setMuted(!sound.muted);
    soundBtn.classList.toggle('muted', sound.muted);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') shiftSlow = false;
});

function handleResize() {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  gpu.resize(w, h);
  trailCanvas.width = w;
  trailCanvas.height = h;
  updateCamera();
}

async function boot() {
  try {
    await gpu.init();
  } catch (err) {
    fatalEl.hidden = false;
    fatalEl.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  handleResize();
  window.addEventListener('resize', handleResize);

  const initLayout = getTossStageLayout();
  camEye = tossMode ? [0, TOSS_CAM_EYE[1], initLayout.eyeZ] : ([...PEDESTAL_CAM_EYE] as Vec3);
  camTarget = [...(tossMode ? TOSS_CAM_TARGET : PEDESTAL_CAM_TARGET)] as Vec3;
  updateCamera();
  if (carveId !== 'free') {
    selectCarveMode(carveId);
  } else if (tossMode) {
    startLevel(currentLevel, false);
    updateLivePreview();
    updateActionUI();
  } else {
    uploadMainBlocks();
    updateLivePreview();
    updateActionUI();
  }

  (window as unknown as Record<string, unknown>).shatter = {
    slice: (x0: number, y0: number, x1: number, y1: number) => {
      if (tossMode && !carvePlan) {
        const now = performance.now();
        let count = 0;
        for (const fc of [...flyingCrystals]) {
          if (sliceFlyingCrystal(fc, x0, y0, x1, y1, now)) count++;
        }
        return count > 0;
      }
      const wp = swipeToWorldPlane(x0, y0, x1, y1);
      return wp ? executeSlice(wp) : false;
    },
    carve: () => executeSlice(null),
    shatter: triggerShatter,
    reset: resetBlock,
    sweep: sweepFloor,
    setLevel: (lv: number) => startLevel(lv, false),
    toss: () => startLevel(currentLevel, false),
    setToss: setTossMode,
    getGameState: () => ({
      level: currentLevel,
      phase: gamePhase,
      score,
      bestScore,
      flyingCount: flyingCrystals.length,
      stageHalfW: getTossStageLayout().stageHalfW,
    }),
    getBlockScreenPos: () => {
      if (tossMode && !carvePlan && flyingCrystals.length > 0) {
        const fc = flyingCrystals[0];
        return { ...projectToScreen(fc.pos), state: gamePhase, worldPos: [...fc.pos], score, count: flyingCrystals.length };
      }
      return { ...projectToScreen(blockPos), state: gamePhase, worldPos: [...blockPos], score, count: flyingCrystals.length };
    },
    getFlyingScreenPos: () => flyingCrystals.map((fc) => ({
      id: fc.id,
      poisoned: fc.poisoned,
      slices: fc.slices,
      ...projectToScreen(fc.pos),
      worldPos: [...fc.pos],
    })),
    setCarve: selectCarveMode,
    setSym: (on: boolean) => {
      freeSym = on;
    },
    setCrackle: (on: boolean) => {
      crackleOn = on;
      if (!crackleOn && pending && autoShatter) triggerShatter();
    },
    setAuto: (on: boolean) => {
      autoShatter = on;
    },
    setPalette: (i: number) => {
      paletteIdx = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
    },
    setPaused,
    cfg,
  };

  let lastTs = performance.now();

  function frame(ts: number) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.05, Math.max(0.001, (ts - lastTs) * 0.001));
    lastTs = ts;
    const activeDt = paused ? 0 : rawDt;
    const time = ts * 0.001;
    const rate = slowMode || shiftSlow ? 0.22 : 1.0;
    const isFrozen = paused || (tossMode && !carvePlan && gamePhase === 'failing');
    const simDt = isFrozen ? 0 : rawDt * rate;

    slashFlash *= Math.exp(-activeDt * 11.0);
    failFlash *= Math.exp(-activeDt * 3.8);
    if (hitStopTimer > 0) hitStopTimer = Math.max(0, hitStopTimer - activeDt);
    if (!paused && strokeMultiCount > 0 && ts - strokeLastHitAt > 180) {
      flushStrokeCombo(ts);
    }
    const flightDt = simDt * (hitStopTimer > 0 ? 0.18 : 1.0);

    // Smooth camera transition + responsive portrait mobile zoom + dramatic fail screen shake!
    const { eyeZ } = getTossStageLayout();
    const goalEye: Vec3 = tossMode && !carvePlan ? [0, TOSS_CAM_EYE[1], eyeZ] : PEDESTAL_CAM_EYE;
    const goalTarget: Vec3 = tossMode && !carvePlan ? TOSS_CAM_TARGET : PEDESTAL_CAM_TARGET;
    const camLerp = 1 - Math.exp(-rawDt * 6.5);
    camEye = [
      camEye[0] + (goalEye[0] - camEye[0]) * camLerp,
      camEye[1] + (goalEye[1] - camEye[1]) * camLerp,
      camEye[2] + (goalEye[2] - camEye[2]) * camLerp,
    ];
    camTarget = [
      camTarget[0] + (goalTarget[0] - camTarget[0]) * camLerp,
      camTarget[1] + (goalTarget[1] - camTarget[1]) * camLerp,
      camTarget[2] + (goalTarget[2] - camTarget[2]) * camLerp,
    ];

    let shakeX = 0;
    let shakeY = 0;
    if (shakeTimer > 0) {
      shakeTimer = Math.max(0, shakeTimer - activeDt);
      const env = Math.min(1, shakeTimer / 0.45);
      const amp = shakeAmp * env * env;
      shakeX = (Math.sin(time * 88.0) * 0.65 + Math.cos(time * 137.0) * 0.35) * amp;
      shakeY = (Math.cos(time * 96.0) * 0.65 + Math.sin(time * 149.0) * 0.35) * amp;
    }
    const baseEye = camEye;
    const baseTgt = camTarget;
    camEye = [baseEye[0] + shakeX, baseEye[1] + shakeY, baseEye[2]];
    camTarget = [baseTgt[0] + shakeX * 0.55, baseTgt[1] + shakeY * 0.55, baseTgt[2]];
    updateCamera();
    camEye = baseEye;
    camTarget = baseTgt;

    // 1. 1,000-Level Diamond Cutter Game vs. Stationary studio pedestal
    if (tossMode && !carvePlan) {
      if (paused) {
        // Simulation frozen cleanly while paused
      } else if (gamePhase === 'failing') {
        // ALL PAUSES while SCREEN SHAKES -> then ALL EXPLODES!
        failFreezeTimer -= activeDt;
        if (failFreezeTimer <= 0) {
          explodeEverythingNow();
        }
      } else if (gamePhase === 'playing') {
        levelTime += simDt;

        // Subtle warning cue ~0.22s BEFORE a Poisoned Black Diamond launches from below!
        while (nextWarnIdx < levelPlan.throws.length && levelTime >= levelPlan.throws[nextWarnIdx].time - 0.22) {
          const wth = levelPlan.throws[nextWarnIdx];
          if (wth.poisoned) {
            sound.blackWarning(Math.max(-0.85, Math.min(0.85, wth.lane * 0.78)));
          }
          nextWarnIdx++;
        }

        // Spawn deterministic pre-planned throws right on schedule!
        while (nextThrowIdx < levelPlan.throws.length && levelTime >= levelPlan.throws[nextThrowIdx].time) {
          spawnScheduledThrow(levelPlan.throws[nextThrowIdx]);
          nextThrowIdx++;
        }

        // Advance all live flying crystals along their below-up ballistic arcs
        for (let i = flyingCrystals.length - 1; i >= 0; i--) {
          const fc = flyingCrystals[i];
          fc.vel[1] -= fc.gravity * flightDt;
          fc.pos = add3(fc.pos, scale3(fc.vel, flightDt));
          fc.vel[2] *= Math.exp(-flightDt * 2.8);
          fc.quat = stepQuat(fc.quat, fc.angVel, flightDt);

          // Check falling off the bottom edge!
          if (fc.vel[1] < 0 && fc.pos[1] < -0.90) {
            gpu.clearCutSlot(fc.slotIdx);
            flyingCrystals.splice(i, 1);

            // Missed a clear crystal without hitting it -> LOSE (same pause / shake / explode-all effect)!
            if (!fc.poisoned && fc.slices === 0) {
              triggerGameFail('Missed a crystal');
              break;
            }
          }
        }

        // Smooth depth-layer separation: if two gems share an XY trajectory, slip the newer one cleanly behind (-Z) so they never clip!
        if (gamePhase === 'playing' && flyingCrystals.length > 1) {
          const sepBlend = 1 - Math.exp(-flightDt * 16);
          for (let i = 0; i < flyingCrystals.length; i++) {
            for (let j = i + 1; j < flyingCrystals.length; j++) {
              const a = flyingCrystals[i];
              const b = flyingCrystals[j];
              const dXY = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
              if (dXY < 0.48) {
                const prox = Math.min(1, (0.48 - dXY) / 0.16);
                const needZ = 0.42 * prox;
                const dz = a.pos[2] - b.pos[2];
                if (Math.abs(dz) < needZ) {
                  // Newer (higher id) or already-deeper gem slips slightly behind (-Z)
                  const bBehind = Math.abs(dz) > 0.02 ? b.pos[2] < a.pos[2] : b.id > a.id;
                  const back = bBehind ? b : a;
                  const front = bBehind ? a : b;
                  const deficit = needZ - (front.pos[2] - back.pos[2]);
                  if (deficit > 0) {
                    back.pos[2] -= deficit * 0.78 * sepBlend;
                    front.pos[2] += deficit * 0.22 * sepBlend;
                  }
                }
              }
            }
          }
        }

        for (const fc of flyingCrystals) {
          gpu.updateCutSlotPose(fc.slotIdx, fc.pos, fc.quat);
        }

        // Level Clear check: all throws launched and all crystals resolved cleanly!
        if (gamePhase === 'playing' && nextThrowIdx >= levelPlan.throws.length && flyingCrystals.length === 0) {
          gamePhase = 'cleared';
          clearWaitTimer = 0.65;
          sound.levelClear();
          updateActionUI();
        }
      } else if (gamePhase === 'cleared') {
        clearWaitTimer -= activeDt;
        if (clearWaitTimer <= 0) {
          startLevel(currentLevel < MAX_LEVEL ? currentLevel + 1 : 1, currentLevel >= MAX_LEVEL);
        }
      } else if (gamePhase === 'lost' && replayPending) {
        // Wait until all exploding shards have finished settling on the floor, then 2 seconds later show REPLAY!
        const allSettled = fallingBakes.size === 0 && scatters.every((s) => s.settled);
        if (allSettled) {
          replayDelayTimer -= activeDt;
          if (replayDelayTimer <= 0) {
            replayPending = false;
            showReplayBanner();
          }
        }
      }
    } else if (!swiping) {
      blockPos = [...PEDESTAL_CENTER] as Vec3;
      const breathQ = qNorm(
        qMul(
          qFromAxisAngle([0, 1, 0], Math.sin(time * 0.45) * 0.045),
          qFromAxisAngle([1, 0, 0], Math.cos(time * 0.35) * 0.022),
        ),
      );
      const follow = 1 - Math.exp(-rawDt * 7.5);
      mouseQuat = qSlerp(mouseQuat, targetMouseQuat, follow);
      blockQuat = qNorm(qMul(mouseQuat, qMul(breathQ, baseQuat)));
    }

    updateLivePreview();
    updateActionUI();

    const glide = carvePlan ? 1 - Math.exp(-rawDt * 10.5) : 1.0;
    displayPlane1N = norm3([
      displayPlane1N[0] + (activePlane1N[0] - displayPlane1N[0]) * glide,
      displayPlane1N[1] + (activePlane1N[1] - displayPlane1N[1]) * glide,
      displayPlane1N[2] + (activePlane1N[2] - displayPlane1N[2]) * glide,
    ]);
    displayPlane1R += (activePlane1R - displayPlane1R) * glide;
    if (activePlane2N) {
      if (!displayPlane2N) {
        displayPlane2N = [...activePlane2N] as Vec3;
        displayPlane2R = activePlane2R;
      } else {
        displayPlane2N = norm3([
          displayPlane2N[0] + (activePlane2N[0] - displayPlane2N[0]) * glide,
          displayPlane2N[1] + (activePlane2N[1] - displayPlane2N[1]) * glide,
          displayPlane2N[2] + (activePlane2N[2] - displayPlane2N[2]) * glide,
        ]);
        displayPlane2R += (activePlane2R - displayPlane2R) * glide;
      }
    } else {
      displayPlane2N = null;
      displayPlane2R = -1;
    }

    // Advance independent falling crystal chunks -> explode ONLY when each chunk hits the ground!
    for (let i = fallingChunks.length - 1; i >= 0; i--) {
      const ch = fallingChunks[i];
      if (ch.detonated) {
        fallingChunks.splice(i, 1);
        continue;
      }

      if (!ch.hitGroundWaiting) {
        ch.worldVel[1] -= CHUNK_GRAVITY * simDt;
        ch.worldPos = add3(ch.worldPos, scale3(ch.worldVel, simDt));
        ch.quat = stepQuat(ch.quat, ch.angVel, simDt);
        const minY = getPolyMinWorldY(ch.cutPoly, ch.worldPos, ch.quat);

        // Pre-bake Rapier floor-impact shatter ~0.22s before touchdown so impact explosion is instantaneous!
        if (!ch.bakeStarted && ch.worldVel[1] < -0.1 && minY < 0.56) {
          const vy = -ch.worldVel[1];
          const disc = vy * vy + 2 * CHUNK_GRAVITY * Math.max(0, minY - 0.015);
          const dtHit = Math.max(0, Math.min(0.28, (-vy + Math.sqrt(disc)) / CHUNK_GRAVITY));
          startFallingChunkBake(ch, dtHit);
        }

        if (minY <= 0.015 && ch.worldVel[1] <= 0.05) {
          ch.worldPos[1] += 0.015 - minY;
          ch.hitGroundWaiting = true;
          gpu.updateCutSlotPose(ch.slotIdx, ch.worldPos, ch.quat);
          if (!ch.bakeStarted) {
            startFallingChunkBake(ch, 0);
          }
          if (ch.bakedResp) {
            detonateFallingChunk(ch);
            continue;
          }
        } else {
          gpu.updateCutSlotPose(ch.slotIdx, ch.worldPos, ch.quat);
        }
      } else if (ch.bakedResp) {
        detonateFallingChunk(ch);
      }
    }

    // Advance Stage 1: manual / legacy cracking severed chunk(s) (used when Auto is OFF)
    let crackTime = 0;
    let cutOffsets: Vec3[] = [];
    let cutQuat: Quat = blockQuat;
    const activeCutVis = pending ?? bakingCutVisual;
    if (activeCutVis) {
      activeCutVis.crackElapsed += rawDt;
      const timeScale = 0.36 / Math.max(0.08, activeCutVis.crackDur);
      crackTime = crackleOn && pending ? pending.crackElapsed * timeScale : 0;
      const pFrac = Math.min(1, activeCutVis.crackElapsed / Math.max(0.05, activeCutVis.crackDur));

      if (activeCutVis.ballistic) {
        activeCutVis.cutQuat = stepQuat(activeCutVis.cutQuat, activeCutVis.cutAngVel, flightDt);
        cutQuat = activeCutVis.cutQuat;
        cutOffsets = activeCutVis.chunks.map((ch, idx) => {
          ch.worldVel[1] -= TOSS_GRAVITY * flightDt;
          ch.worldPos = add3(ch.worldPos, scale3(ch.worldVel, flightDt));
          gpu.updateCutSlotPose(idx, ch.worldPos, cutQuat);
          return sub3(ch.worldPos, blockPos);
        });
      } else {
        cutQuat = blockQuat;
        const drift = 0.003 + 0.009 * (1 - Math.pow(1 - pFrac, 2.4));
        cutOffsets = activeCutVis.chunks.map((ch, idx) => {
          const off = scale3(norm3(qRotate(blockQuat, ch.localPushDir)), drift);
          gpu.updateCutSlotPose(idx, add3(blockPos, off), cutQuat);
          return off;
        });
      }

      if (pending && autoShatter && pFrac >= 1) {
        bakingCutVisual = pending;
        triggerShatter();
      }
    }

    // Advance Stage 2 (Rapier baked scatter playback + secondary floor breaks + rate-limited audio clinks!)
    let posesDirty = false;
    let frameClinks = 0;
    const maxFrameClinks = IS_MOBILE ? 3 : 7;
    for (let si = scatters.length - 1; si >= 0; si--) {
      const sc = scatters[si];
      if (sc.settled) continue;
      sc.elapsed += simDt;
      const exactFrame = sc.elapsed * sc.fps;
      const f0 = Math.min(sc.numFrames - 1, Math.floor(exactFrame));
      const f1 = Math.min(sc.numFrames - 1, f0 + 1);
      const frac = Math.max(0, Math.min(1, exactFrame - f0));

      const stride = sc.numShards * 7;
      for (let i = 0; i < sc.numShards; i++) {
        const o0 = f0 * stride + i * 7;
        const o1 = f1 * stride + i * 7;
        const py0 = sc.frames[o0 + 1];
        const py1 = sc.frames[o1 + 1];
        if (py0 < -100) {
          gpu.setShardPose(sc.baseShardId + i, [0, -999, 0], [0, 0, 0, 1], false);
          continue;
        }
        if (py1 < -100) {
          gpu.setShardPose(
            sc.baseShardId + i,
            [sc.frames[o0], py0, sc.frames[o0 + 2]],
            [sc.frames[o0 + 3], sc.frames[o0 + 4], sc.frames[o0 + 5], sc.frames[o0 + 6]],
            true,
            sc.gemId,
          );
          continue;
        }
        const px = sc.frames[o0] + (sc.frames[o1] - sc.frames[o0]) * frac;
        const py = py0 + (py1 - py0) * frac;
        const pz = sc.frames[o0 + 2] + (sc.frames[o1 + 2] - sc.frames[o0 + 2]) * frac;
        const q = qSlerp(
          [sc.frames[o0 + 3], sc.frames[o0 + 4], sc.frames[o0 + 5], sc.frames[o0 + 6]],
          [sc.frames[o1 + 3], sc.frames[o1 + 4], sc.frames[o1 + 5], sc.frames[o1 + 6]],
          frac,
        );
        gpu.setShardPose(sc.baseShardId + i, [px, py, pz], q, true, sc.gemId);
      }
      posesDirty = true;

      while (sc.nextContact < sc.contacts.length) {
        const cFrame = sc.contacts[sc.nextContact];
        if (cFrame > exactFrame) break;
        const cx = sc.contacts[sc.nextContact + 1];
        const cy = sc.contacts[sc.nextContact + 2];
        const cz = sc.contacts[sc.nextContact + 3];
        const cSize = sc.contacts[sc.nextContact + 4];
        const cStrength = sc.contacts[sc.nextContact + 5];
        const cKind = sc.contacts[sc.nextContact + 6];
        sc.nextContact += 7;

        const pan = Math.max(-1, Math.min(1, cx * 0.75));
        if (cKind === 2) {
          if (frameClinks < maxFrameClinks) {
            sound.miniShatter(pan, rate);
            frameClinks++;
          }
          burstSplinters(
            [[cx, Math.max(0.015, cy), cz]],
            [[(rng() - 0.5) * 0.35, -0.22 + rng() * 0.44, (rng() - 0.5) * 0.35]],
            [0, 1.15, 0],
            56,
            1.55,
            0.0020,
            0.008,
            sc.gemId,
          );
        } else {
          if (frameClinks < maxFrameClinks) {
            sound.clink(cSize, cStrength, cKind, pan, rate);
            frameClinks++;
          }
          if (cKind === 0 && cStrength > 1.8) {
            burstSplinters(
              [[cx, Math.max(0.01, cy), cz]],
              [[(rng() - 0.5) * 0.3, -0.15 + rng() * 0.35, (rng() - 0.5) * 0.3]],
              [0, 0.55 * Math.min(3, cStrength * 0.4), 0],
              Math.min(18, Math.round(cStrength * 3.5)),
              0.9,
              0.0022,
              0.007,
              sc.gemId,
            );
          }
        }
      }

      if (f0 >= sc.numFrames - 1) {
        sc.settled = true;
        const lastBase = (sc.numFrames - 1) * stride;
        for (let i = 0; i < sc.numShards; i++) {
          const o = lastBase + i * 7;
          const py = sc.frames[o + 1];
          if (py > -0.5 && py < 0.8) {
            floorObstacles.push({
              hullVerts: sc.shards[i].hullVerts,
              pos: [sc.frames[o], py, sc.frames[o + 2]],
              quat: [sc.frames[o + 3], sc.frames[o + 4], sc.frames[o + 5], sc.frames[o + 6]],
            });
          }
        }
        // Cap floorObstacles and immediately release settled animation buffers so RAM never leaks!
        if (floorObstacles.length > MAX_FLOOR_OBSTACLES) {
          floorObstacles.splice(0, floorObstacles.length - MAX_FLOOR_OBSTACLES);
        }
        sc.frames = EMPTY_F32;
        sc.contacts = EMPTY_F32;
        sc.shards = [];
        scatters.splice(si, 1);
      }
    }
    if (posesDirty) {
      gpu.flushShardPoses(nextShardId);
    }

    gpu.render({
      viewProj,
      invViewProj,
      camPos: camEye,
      time,
      dt: simDt,
      lightDir: LIGHT_DIR,
      causticStrength: cfg.causticStrength,
      blockCenter: tossMode && !carvePlan ? [0, -5, 0] : blockPos,
      blockQuat,
      halfSize: carvePlan ? HALF_SIZE : CRYSTAL_HALF_SIZE,
      ior: cfg.ior,
      dispersion: cfg.dispersion,
      palette: PALETTES[paletteIdx],
      crackProgress: crackTime,
      planeHover: swiping ? 1.0 : 0.0,
      cutRadius: displayPlane1R,
      cutPlaneN: displayPlane1N,
      cutPlane2N: showCutLine ? displayPlane2N : null,
      cutRadius2: displayPlane2R,
      cutOffsets,
      cutQuat,
      hasCutPiece: !!(pending || bakingCutVisual || fallingChunks.length > 0 || flyingCrystals.length > 0),
      planeAlpha: showCutLine ? 1.0 : 0.0,
      canCut,
      exposure: cfg.exposure,
    });

    renderSlashTrail(ts, rawDt);
  }

  requestAnimationFrame(frame);
}

boot();
