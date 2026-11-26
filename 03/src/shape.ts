import { clamp, smoothstep } from './rng';
import { sampleFastFbm3 } from './noise3d';

/**
 * Shared dimensional & parametric melt shape of the molded berry popsicle.
 * Used consistently by `fruits.ts`, `popsicleIce.ts`, and `waterDrops.ts` so
 * solid fruits, refractive ice, trapped air bubbles, and separate water drops
 * stay physically locked to the exact same melting silhouette.
 */
const STICK_WIDTH = 0.215;
const STICK_DEPTH = 0.042;
const STICK_BEVEL_THICKNESS = STICK_DEPTH * 0.19;
const STICK_BEVEL_SIZE = STICK_BEVEL_THICKNESS * 0.7;

export const DEFAULT_INITIAL_MELT = 0.035;
export const DEFAULT_BOTTOM_POOL = 1.05;
/** Global melt threshold at which freezer hoarfrost finishes thawing and structural melt-down begins */
export const FROST_CLEAR_MELT = 0.18;

/**
 * Maps global melt progress [0..1] to structural body melt-down [0..1].
 * Holds strictly at 0 while freezer frost is still thawing (`melt <= FROST_CLEAR_MELT`)
 * so the popsicle keeps its crisp molded silhouette until frost is gone, then eases
 * smoothly from 0 -> 1.
 */
export function getStructuralMelt(melt: number): number {
  const m = clamp(melt, 0, 1);
  if (m <= FROST_CLEAR_MELT) return 0;
  const lin = (m - FROST_CLEAR_MELT) / (1.0 - FROST_CLEAR_MELT);
  const easeIn = smoothstep(0, 0.10, lin);
  return lin * (0.35 + 0.65 * easeIn);
}

export const POPSICLE = {
  /** Base unmelted vertical bounds */
  yTop: 1.12,
  yBottom: -1.02,
  /** Normalized height where unmelted top dome begins */
  domeStartNorm: 0.735,
  /** Half-width at upper shoulder and slightly flared bottom */
  halfWidthTop: 0.545,
  halfWidthBottom: 0.625,
  /** Half-thickness (Z) of the molded slab */
  halfDepth: 0.215,
  /** Twin vertical flute horizontal centers (±X) */
  fluteX: 0.165,
  /** Sleek delicate flute Gaussian half-width and subtle molded depth (matching reference photo!) */
  fluteWidth: 0.036,
  fluteDepth: 0.024,
  /** Wood stick bounds & shared bevel geometry */
  stickWidth: STICK_WIDTH,
  stickDepth: STICK_DEPTH,
  stickBevelThickness: STICK_BEVEL_THICKNESS,
  stickBevelSize: STICK_BEVEL_SIZE,
  /** Outer wooden stick edge X (including rounded bevel) */
  stickEdgeX: STICK_WIDTH * 0.5 + STICK_BEVEL_SIZE,
  stickTopY: 0.54,
  stickBottomY: -1.48,
} as const;

/** Shared non-linear vertical sampling map concentrating rows near the top dome & bottom lip */
export function mapPopsicleVNorm(t: number): number {
  return t * 0.55 + (0.5 - 0.5 * Math.cos(t * Math.PI)) * 0.45;
}

/** Unmelted outer half-width at normalized body height `hNorm` in [0, 1] */
export function baseHalfWidthAt(hNorm: number): number {
  const h = clamp(hNorm, 0, 1);
  let hw = POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * h;
  if (h > POPSICLE.domeStartNorm) {
    const dt = clamp((h - POPSICLE.domeStartNorm) / (1.0 - POPSICLE.domeStartNorm), 0, 1);
    hw *= Math.sqrt(Math.max(0, 1.0 - dt * dt));
  }
  return hw;
}

export interface HeatSpot {
  x: number;
  y: number;
  /** Accumulated local thermal melt dose [0..1+] */
  heat: number;
}

export interface MeltFieldState {
  /** Global deterministic melt progress [0..1] (starts ~0.035 for glistening ready-to-drip still) */
  melt: number;
  /** Elapsed simulation time in seconds */
  time: number;
  /** Seed offset for deterministic organic melt waves */
  seedOffset: number;
  /** Persistent local heat spots painted by pointer hover / press */
  heatSpots: HeatSpot[];
  /** Current live pointer warmth on popsicle plane (0..1) */
  pointerHeat: number;
  pointerX: number;
  pointerY: number;
  /** Bottom-rim downward pooling morph intensity (driven by Drop Debug 'Bot Pool' slider) */
  bottomPool?: number;
  /** Live morph target weights [outerLeft, innerLeft, innerRight, outerRight] fed by draining syrup layers */
  bottomLobes?: [number, number, number, number];
  /** Live gravity stretch & elastic capillary recoil [L0, L1, R0, R1] coupled to all 6 hanging bottom drops */
  pendantPull?: [number, number, number, number];
}

/**
 * Evaluates accumulated local pointer-induced melt boost at (x, y).
 */
export function sampleLocalHeat(x: number, y: number, state: MeltFieldState): number {
  const spots = state.heatSpots;
  if (spots.length === 0) return 0;
  let boost = 0;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (s.heat <= 0.0005) continue;
    const dx = x - s.x;
    const dy = (y - s.y) * 0.85;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.85) continue;
    // Soft thermal diffusion radius ~0.34
    boost += s.heat * Math.exp(-d2 / 0.115);
  }
  return clamp(boost, 0, 0.85);
}

export interface MeltBounds {
  yTop: number;
  yBot: number;
  /** Rigid downward gravity slide along the wet wooden stick near the end of the melt (<= 0) */
  slideY: number;
  /** 1 while solid popsicle body exists, smoothly dissolving to 0 right as the final ice bead merges into the stick */
  iceAmount: number;
  /** True once the ice has completely melted away, leaving only the bare glazed stick */
  iceGone: boolean;
}

/**
 * Shared live vertical bounds & endgame dissolve state for a given melt progress [0..1].
 * Keeps 0..0.50 faithful to the classic slow backlit melt, then smoothly collapses the
 * remaining ice sleeve onto the upper wooden stick and lets it slide smoothly downward
 * along the slick wet wood toward the very end until only the bare glazed stick remains.
 */
export function getMeltBounds(melt: number): MeltBounds {
  const m = getStructuralMelt(melt);
  const collapse = smoothstep(0.40, 0.975, m);
  const collapse2 = collapse * collapse;

  // Final melting slush collar clings around the embedded wooden stick, then loses friction and slides downward!
  const yFinal = -0.46;
  const yTopBase = POPSICLE.yTop - m * 0.72;
  const yBotBase = POPSICLE.yBottom + m * 0.14;

  const slideT = smoothstep(0.64, 0.90, m);
  const slideY = -0.88 * slideT * slideT;

  const yTop = yTopBase + (yFinal - yTopBase) * Math.pow(collapse, 1.38) + slideY;
  const yBot = yBotBase + (yFinal - yBotBase) * (collapse2 * 0.90 + Math.pow(collapse, 3.0) * 0.10) + slideY;
  // By structural melt ~0.885 the shrunk ice cross-section sits flush inside the birch stick; dissolve iceAmount
  // in lockstep so no phantom ice collar or mid-stick liquid cutoff lingers once the ice is visibly gone.
  const iceAmount = 1.0 - smoothstep(0.78, 0.885, m);
  const iceGone = m >= 0.895 || yTop - yBot < 0.014;
  return { yTop, yBot, slideY, iceAmount, iceGone };
}

export interface ProfileFrameCache {
  rawMelt: number;
  m: number;
  yTop: number;
  yBot: number;
  slideY: number;
  bodyH: number;
  iceAmount: number;
  collapse: number;
  endRound: number;
  bulletTaper: number;
  radialCollapseW: number;
  radialCollapseD: number;
  domeStart: number;
  botBevel: number;
  flatKeep: number;
  fluteCenter: number;
  waveScale: number;
  erodeScale: number;
  carveGate: number;
  so: number;
  timeMacroY: number;
  timeRivY: number;
  poolAmt: number;
  w0: number;
  w1: number;
  w2: number;
  w3: number;
  pullL0: number;
  pullL1: number;
  pullR0: number;
  pullR1: number;
  hasHeatSpots: boolean;
}

export interface ProfileRowCache {
  yBase: number;
  hNorm: number;
  bodyHalfW: number;
  halfW: number;
  halfD: number;
  capFactor: number;
  domeDepthFactor: number;
  bodyBlend: number;
  invExpX: number;
  invExpZ: number;
  fluteVerticalMask: number;
  botProximity: number;
  rimBellyMask: number;
  xL0: number;
  xL1: number;
  xR0: number;
  xR1: number;
  invSL0: number;
  invSL1: number;
  invSR0: number;
  invSR1: number;
}

const _sharedFrameCache: ProfileFrameCache = {
  rawMelt: 0,
  m: 0,
  yTop: POPSICLE.yTop,
  yBot: POPSICLE.yBottom,
  slideY: 0,
  bodyH: POPSICLE.yTop - POPSICLE.yBottom,
  iceAmount: 1,
  collapse: 0,
  endRound: 0,
  bulletTaper: 0,
  radialCollapseW: 1,
  radialCollapseD: 1,
  domeStart: POPSICLE.domeStartNorm,
  botBevel: 0.072,
  flatKeep: 0.86,
  fluteCenter: POPSICLE.fluteX,
  waveScale: 1,
  erodeScale: 0,
  carveGate: 0,
  so: 0,
  timeMacroY: 0,
  timeRivY: 0,
  poolAmt: 0,
  w0: 1,
  w1: 1,
  w2: 1,
  w3: 1,
  pullL0: 0,
  pullL1: 0,
  pullR0: 0,
  pullR1: 0,
  hasHeatSpots: false,
};

const _sharedRowCache: ProfileRowCache = {
  yBase: 0,
  hNorm: 0,
  bodyHalfW: 0.5,
  halfW: 0.5,
  halfD: 0.2,
  capFactor: 1,
  domeDepthFactor: 1,
  bodyBlend: 1,
  invExpX: 0.5,
  invExpZ: 0.5,
  fluteVerticalMask: 0,
  botProximity: 0,
  rimBellyMask: 0,
  xL0: -0.35,
  xL1: -0.2,
  xR0: 0.2,
  xR1: 0.35,
  invSL0: 10,
  invSL1: 10,
  invSR0: 10,
  invSR1: 10,
};

/** Precomputes frame-invariant melt parameters once before rebuilding the full popsicle mesh. */
export function prepareProfileFrame(state: MeltFieldState, out: ProfileFrameCache = _sharedFrameCache): ProfileFrameCache {
  const rawMelt = clamp(state.melt, 0, 1);
  const m = getStructuralMelt(rawMelt);
  const { yTop, yBot, slideY, iceAmount } = getMeltBounds(rawMelt);
  const collapse = smoothstep(0.40, 0.975, m);
  const endRound = smoothstep(0.72, 0.94, m);
  const bulletTaper = smoothstep(0.06, 0.72, m);

  out.rawMelt = rawMelt;
  out.m = m;
  out.yTop = yTop;
  out.yBot = yBot;
  out.slideY = slideY;
  out.bodyH = Math.max(0.02, yTop - yBot);
  out.iceAmount = iceAmount;
  out.collapse = collapse;
  out.endRound = endRound;
  out.bulletTaper = bulletTaper;
  out.radialCollapseW = 1.0 - Math.pow(collapse, 1.58) * 0.85;
  out.radialCollapseD = 1.0 - Math.pow(collapse, 1.50) * 0.88;
  out.domeStart = POPSICLE.domeStartNorm - bulletTaper * 0.14 - endRound * 0.08;
  out.botBevel = 0.072 + bulletTaper * 0.24 + endRound * 0.16;
  out.flatKeep = 0.86 * (1.0 - bulletTaper * 0.62) * (1.0 - endRound * 0.85);
  out.fluteCenter = POPSICLE.fluteX * (1.0 - m * 0.25);
  out.waveScale = (1.0 - collapse * 0.78) * iceAmount;
  // Porous crystalline silhouette erosion emerges after ~1/3 melt once smooth molded skin melts away
  out.erodeScale = smoothstep(0.30, 0.52, rawMelt) * (1.0 - collapse * 0.42) * iceAmount;
  out.carveGate = smoothstep(FROST_CLEAR_MELT - 0.02, FROST_CLEAR_MELT + 0.05, rawMelt);
  out.so = state.seedOffset;
  out.timeMacroY = state.time * 0.012;
  out.timeRivY = state.time * 0.035;

  const activeRim = 1.0 - smoothstep(0.66, 0.90, m);
  // Keep bottom silhouette crisp until freezer frost clears and structural melt begins
  const thawPool = smoothstep(0.008, 0.18, m);
  out.poolAmt = clamp(state.bottomPool ?? DEFAULT_BOTTOM_POOL, 0, 2.2) * thawPool * activeRim;

  const lobes = state.bottomLobes;
  const pull = state.pendantPull;
  const tSlow = state.time * 0.65;
  out.w0 = (lobes ? lobes[0] : 1) * (1.0 + 0.04 * Math.sin(tSlow + 0.4));
  out.w1 = (lobes ? lobes[1] : 1) * (1.0 + 0.04 * Math.sin(tSlow * 1.15 + 1.9));
  out.w2 = (lobes ? lobes[2] : 1) * (1.0 + 0.04 * Math.sin(tSlow * 0.95 + 3.4));
  out.w3 = (lobes ? lobes[3] : 1) * (1.0 + 0.04 * Math.sin(tSlow * 1.10 + 4.8));
  out.pullL0 = pull ? pull[0] : 0;
  out.pullL1 = pull ? pull[1] : 0;
  out.pullR0 = pull ? pull[2] : 0;
  out.pullR1 = pull ? pull[3] : 0;

  let hasHeat = false;
  const spots = state.heatSpots;
  for (let i = 0; i < spots.length; i++) {
    if (spots[i].heat > 0.0005) {
      hasHeat = true;
      break;
    }
  }
  out.hasHeatSpots = hasHeat;
  return out;
}

/** Shared melted cross-section evaluation for both mesh rows and `iceContainmentDepth`. */
function evalCrossSectionAtHeight(
  hNorm: number,
  m: number,
  bulletTaper: number,
  endRound: number,
  radialCollapseW: number,
  radialCollapseD: number,
  domeStart: number,
  botBevel: number,
  flatKeep: number,
  clampBottomDepth: boolean,
  out: { bodyHalfW: number; halfW: number; halfD: number; capFactor: number; domeDepthFactor: number },
): void {
  const widthShrink = (1.0 - m * 0.44 * (0.62 + 0.58 * hNorm)) * radialCollapseW;
  let halfW = (POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm) * widthShrink;
  halfW *= 1.0 - bulletTaper * (1.0 - endRound * 0.55) * 0.22 * smoothstep(0.35, 0.92, hNorm);

  const depthShrink = (1.0 - m * 0.48 * (0.68 + 0.45 * hNorm)) * radialCollapseD;
  let halfD = POPSICLE.halfDepth * depthShrink;

  let capFactor = 1.0;
  let domeDepthFactor = 1.0;
  if (hNorm > domeStart) {
    const t = clamp((hNorm - domeStart) / Math.max(0.1, 1.0 - domeStart), 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1.0 - t * t));
    capFactor = sinA;
    domeDepthFactor = Math.pow(sinA, 0.74);
  }
  if (hNorm < botBevel) {
    const t = clamp(1.0 - hNorm / botBevel, 0, 1);
    const sinB = Math.sqrt(Math.max(0, 1.0 - t * t));
    capFactor *= flatKeep + (1.0 - flatKeep) * sinB;
    domeDepthFactor *= clampBottomDepth ? Math.max(0.22, sinB) : sinB;
  }

  out.bodyHalfW = halfW;
  out.halfW = halfW * capFactor;
  out.halfD = halfD * domeDepthFactor;
  out.capFactor = capFactor;
  out.domeDepthFactor = domeDepthFactor;
}

const _csScratch = { bodyHalfW: 0, halfW: 0, halfD: 0, capFactor: 1, domeDepthFactor: 1 };

/** Precomputes row-invariant parameters once per latitude ring `iv`. */
export function prepareProfileRow(
  vNorm: number,
  frame: ProfileFrameCache,
  out: ProfileRowCache = _sharedRowCache,
): ProfileRowCache {
  const yBase = frame.yBot + (frame.yTop - frame.yBot) * vNorm;
  const hNorm = clamp((yBase - frame.yBot) / frame.bodyH, 0, 1);

  evalCrossSectionAtHeight(
    hNorm,
    frame.m,
    frame.bulletTaper,
    frame.endRound,
    frame.radialCollapseW,
    frame.radialCollapseD,
    frame.domeStart,
    frame.botBevel,
    frame.flatKeep,
    false,
    _csScratch,
  );

  const bodyBlend = smoothstep(0.03, 0.14, hNorm) * smoothstep(0.98, 0.78, hNorm) * (1.0 - frame.bulletTaper * 0.65);
  out.yBase = yBase;
  out.hNorm = hNorm;
  out.bodyHalfW = _csScratch.bodyHalfW;
  out.halfW = _csScratch.halfW;
  out.halfD = _csScratch.halfD;
  out.capFactor = _csScratch.capFactor;
  out.domeDepthFactor = _csScratch.domeDepthFactor;
  out.bodyBlend = bodyBlend;
  out.invExpX = 2.0 / (2.0 + 1.15 * bodyBlend);
  out.invExpZ = 2.0 / (2.0 + 1.45 * bodyBlend);
  out.fluteVerticalMask = smoothstep(0.06, 0.15, hNorm) * smoothstep(0.92, 0.78, hNorm);

  if (hNorm < 0.24 && frame.poolAmt > 0.005) {
    out.botProximity = Math.pow(smoothstep(0.24, 0.0, hNorm), 1.40);
    out.rimBellyMask = smoothstep(0.20, 0.036, hNorm) * smoothstep(0.0, 0.025, hNorm);
    const stickHalfW = POPSICLE.stickWidth * 0.5;
    const liveW = Math.max(stickHalfW + 0.08, _csScratch.bodyHalfW * 0.86);
    const availSpan = Math.max(0.075, liveW - stickHalfW);
    out.xL0 = -(stickHalfW + availSpan * 0.62);
    out.xL1 = -(stickHalfW + availSpan * 0.20);
    out.xR0 = +(stickHalfW + availSpan * 0.24);
    out.xR1 = +(stickHalfW + availSpan * 0.65);
    out.invSL0 = 1.0 / Math.max(0.056, availSpan * 0.28);
    out.invSL1 = 1.0 / Math.max(0.046, availSpan * 0.23);
    out.invSR0 = 1.0 / Math.max(0.058, availSpan * 0.28);
    out.invSR1 = 1.0 / Math.max(0.050, availSpan * 0.24);
  } else {
    out.botProximity = 0;
    out.rimBellyMask = 0;
  }
  return out;
}

/**
 * High-speed inner vertex evaluation using precomputed frame/row caches and trig LUTs
 * (bit-identical output to `evaluatePopsicleProfile`, ~3x faster with zero allocations).
 */
export function evaluatePopsicleVertex(
  sinT: number,
  cosT: number,
  frame: ProfileFrameCache,
  row: ProfileRowCache,
  state: MeltFieldState,
  outPos: { x: number; y: number; z: number; hang?: number },
): void {
  let y = row.yBase;
  const sgnX = sinT >= 0 ? 1 : -1;
  const sgnZ = cosT >= 0 ? 1 : -1;
  const absSinT = Math.abs(sinT);
  const absCosT = Math.abs(cosT);

  let x = sgnX * Math.pow(absSinT, row.invExpX) * row.halfW;
  let z = sgnZ * Math.pow(absCosT, row.invExpZ) * row.halfD;

  const localHeat = frame.hasHeatSpots ? sampleLocalHeat(x, y, state) * frame.carveGate : 0;
  const effMelt = clamp(frame.m + localHeat * 0.55, 0, 1);

  // Twin crisp vertical molded flutes on front (+Z) and back (-Z) faces (skip 4x exp when masked out!)
  const fluteSharpness = Math.max(0, 1.0 - smoothstep(0.04, 0.58, effMelt));
  if (row.fluteVerticalMask > 0 && fluteSharpness > 0 && absCosT > 0.18) {
    const fluteFaceMask = smoothstep(0.18, 0.52, absCosT);
    const fluteW = POPSICLE.fluteWidth * (1.0 + effMelt * 0.85);
    const invFluteW = 1.0 / fluteW;
    const dL = (x + frame.fluteCenter) * invFluteW;
    const dR = (x - frame.fluteCenter) * invFluteW;
    const groove = Math.exp(-dL * dL * 1.45) + Math.exp(-dR * dR * 1.45);
    const rL = (Math.abs(x + frame.fluteCenter) - fluteW * 1.05) / (fluteW * 0.65);
    const rR = (Math.abs(x - frame.fluteCenter) - fluteW * 1.05) / (fluteW * 0.65);
    const ridge = Math.exp(-rL * rL) + Math.exp(-rR * rR);
    z +=
      sgnZ *
      (-groove * POPSICLE.fluteDepth + ridge * POPSICLE.fluteDepth * 0.16) *
      row.fluteVerticalMask *
      fluteFaceMask *
      fluteSharpness;
  }

  // Local pointer heat carves a smooth glossy melted depression & slumps downward slightly!
  if (localHeat > 0.001) {
    const carve = localHeat * 0.22 * (0.4 + 0.6 * row.bodyBlend) * frame.iceAmount;
    x *= 1.0 - carve * 0.55;
    z *= 1.0 - carve * 0.78;
    y -= localHeat * 0.065 * smoothstep(0.05, 0.3, row.hNorm) * frame.iceAmount;
  }

  // Organic wet melt surface undulation + post-1/3 porous crystalline micro-erosion bumps (anchored via yLocal!)
  const so = frame.so;
  const yLocal = y - frame.slideY;
  const nMacro = sampleFastFbm3(x * 2.4 + so, yLocal * 1.7 + frame.timeMacroY, z * 2.4) - 0.5;
  const nRivulet = sampleFastFbm3(x * 7.8 + so * 1.7, yLocal * 1.9 + frame.timeRivY, z * 4.5) - 0.5;
  const slushFactor = smoothstep(0.08, 0.45, effMelt);
  const nSlush =
    slushFactor > 0 || frame.erodeScale > 0
      ? sampleFastFbm3(x * 18.0 + so * 2.3, yLocal * 17.0, z * 18.0) - 0.5
      : 0;
  // Crisp eroded crystalline micro-tooth along the melted silhouette & body after ~1/3 in (calm on bottom liquid pouch!)
  const erodeBodyMask = 1.0 - row.botProximity * 0.84;
  let crystalErode = 0;
  if (frame.erodeScale > 0.002 && erodeBodyMask > 0.02) {
    const nToothRaw = sampleFastFbm3(x * 34.0 + so * 4.1, yLocal * 36.0, z * 34.0);
    const nTooth = (nToothRaw - 0.5) * 1.18 + (Math.abs(nToothRaw - 0.5) - 0.22) * 0.55;
    crystalErode = (nSlush * 0.020 + nTooth * 0.018) * frame.erodeScale * erodeBodyMask;
  }
  const meltAmp = (0.004 + effMelt * 0.052) * frame.waveScale;

  const edgeWave =
    nMacro * meltAmp * (0.65 + 0.55 * absSinT) +
    nRivulet * (0.0025 + effMelt * 0.018) * frame.waveScale +
    nSlush * (0.014 * slushFactor) * frame.waveScale;

  // Apply crisp crystalline micro-erosion strongly on the X silhouette edges and more gently on Z faces
  // so front faces showcase crisp pixel-level ice-pebble relief instead of coarse vertex lumps!
  x += sgnX * (edgeWave + crystalErode) * (0.48 + 0.52 * absSinT) * row.capFactor;
  z += sgnZ * (edgeWave + crystalErode * 0.42) * 0.78 * row.domeDepthFactor;

  // === SLEEK GRAVITY-WEIGHTED UNDERSIDE MENISCUS & GENTLE POOLING SWELLS ===
  // Physically bounded by capillary surface tension above the 6 drop break-off sites rather than heavy stalactites.
  let hangFactor = 0;
  if (row.botProximity > 0) {
    const stickHalfW = POPSICLE.stickWidth * 0.5;
    const nBotSmooth = sampleFastFbm3(x * 3.6 + so * 1.1, so * 0.5, Math.abs(z) * 3.2);
    const broadWave = Math.max(0, nBotSmooth - 0.36) * 0.014;

    const gL0 = Math.exp(-Math.pow(Math.abs(x - row.xL0) * row.invSL0, 2.2));
    const gL1 = Math.exp(-Math.pow(Math.abs(x - row.xL1) * row.invSL1, 2.2));
    const gR0 = Math.exp(-Math.pow(Math.abs(x - row.xR0) * row.invSR0, 2.2));
    const gR1 = Math.exp(-Math.pow(Math.abs(x - row.xR1) * row.invSR1, 2.2));

    const lobeL0 = gL0 * (0.040 * frame.w0 + Math.max(-0.012, frame.pullL0 * 0.024));
    const lobeL1 = gL1 * (0.028 * frame.w1 + Math.max(-0.010, frame.pullL1 * 0.018));
    const lobeR0 = gR0 * (0.038 * frame.w2 + Math.max(-0.012, frame.pullR0 * 0.022));
    const lobeR1 = gR1 * (0.026 * frame.w3 + Math.max(-0.009, frame.pullR1 * 0.016));

    const fL = (x + stickHalfW + 0.010) / 0.048;
    const fR = (x - stickHalfW - 0.010) / 0.048;
    const sc = x / (stickHalfW * 0.68);
    // Gentle capillary pouch fillet curving down toward the stick during active melt (crisp when frozen, sleek at endgame!)
    const activeFillet = smoothstep(0.08, 0.24, frame.m) * (1.0 - smoothstep(0.60, 0.78, frame.m));
    const filletL = Math.exp(-fL * fL) * (0.022 + 0.024 * activeFillet) * (0.7 + 0.3 * frame.w1);
    const filletR = Math.exp(-fR * fR) * (0.018 + 0.022 * activeFillet) * (0.7 + 0.3 * frame.w2);
    const stickCenter = Math.exp(-sc * sc);

    const underWeight = 0.74 + 0.26 * (1.0 - Math.min(1, Math.abs(z) / Math.max(0.04, row.halfD)));
    const rawSag =
      ((broadWave + lobeL0 + lobeL1 + lobeR0 + lobeR1) * (1.0 - stickCenter * 0.88) + filletL + filletR) *
      frame.poolAmt;
    const softMax = 0.088;
    const totalSag = ((softMax * rawSag) / (softMax + rawSag)) * underWeight;
    const sagHere = totalSag * row.botProximity;
    y -= sagHere;
    hangFactor = clamp(sagHere / 0.048, 0, 1);

    const lipSwell = (0.006 + sagHere * 0.34) * row.rimBellyMask;
    z += sgnZ * lipSwell * (0.58 + 0.42 * absCosT) * (1.0 - stickCenter * 0.58);
    x += sgnX * lipSwell * 0.16 * absSinT;
  }

  outPos.x = x;
  outPos.y = y;
  outPos.z = z;
  outPos.hang = hangFactor;
}

/**
 * Evaluates current melted vertical bounds and horizontal half-width at height y.
 */
export function evaluatePopsicleProfile(
  vNorm: number, // 0 = bottom pole, 1 = top pole
  theta: number, // angle around Y axis: 0 = +Z front, PI/2 = +X right, PI = -Z back, -PI/2 = -X left
  state: MeltFieldState,
  outPos: { x: number; y: number; z: number; hang?: number },
): void {
  const frame = prepareProfileFrame(state, _sharedFrameCache);
  const row = prepareProfileRow(vNorm, frame, _sharedRowCache);
  evaluatePopsicleVertex(Math.sin(theta), Math.cos(theta), frame, row, state, outPos);
}

export interface IceContainmentInfo {
  /** Signed containment distance (>0 inside ice, ~0 on surface, <0 outside) */
  depth: number;
  /** Signed horizontal clearance from X side wall (`halfW - |x|`) */
  dx: number;
  /** Signed front/back thickness clearance from Z face (`halfD - |z|`) */
  dz: number;
  /** Signed vertical clearance above bottom lip (`y - yBot`) */
  dyBot: number;
  /** Signed vertical clearance below top dome (`yTop - y`) */
  dyTop: number;
}

const _containmentScratch: IceContainmentInfo = { depth: 0, dx: 0, dz: 0, dyBot: 0, dyTop: 0 };

/**
 * Full 3D signed-distance containment & per-axis clearance query against the live melted ice body.
 * Positive strictly inside the live melted ice, ~0 on the ice surface, and smoothly negative outside.
 */
export function sampleIceContainment(
  x: number,
  y: number,
  z: number,
  state: MeltFieldState,
  out: IceContainmentInfo = _containmentScratch,
): IceContainmentInfo {
  const rawMelt = clamp(state.melt, 0, 1);
  const m = getStructuralMelt(rawMelt);
  const { yTop, yBot, iceAmount, iceGone } = getMeltBounds(rawMelt);
  if (iceGone) {
    out.depth = -99.0;
    out.dx = -99.0;
    out.dz = -99.0;
    out.dyBot = -99.0;
    out.dyTop = -99.0;
    return out;
  }

  const collapse = smoothstep(0.40, 0.975, m);
  const endRound = smoothstep(0.72, 0.94, m);
  const yClamped = clamp(y, yBot, yTop);
  const hNorm = clamp((yClamped - yBot) / Math.max(0.02, yTop - yBot), 0, 1);
  const bulletTaper = smoothstep(0.06, 0.72, m);
  const radialCollapseW = 1.0 - Math.pow(collapse, 1.58) * 0.85;
  const radialCollapseD = 1.0 - Math.pow(collapse, 1.50) * 0.88;
  const domeStart = POPSICLE.domeStartNorm - bulletTaper * 0.14 - endRound * 0.08;
  const botBevel = 0.072 + bulletTaper * 0.24 + endRound * 0.16;
  const flatKeep = 0.86 * (1.0 - bulletTaper * 0.62) * (1.0 - endRound * 0.85);

  evalCrossSectionAtHeight(
    hNorm,
    m,
    bulletTaper,
    endRound,
    radialCollapseW,
    radialCollapseD,
    domeStart,
    botBevel,
    flatKeep,
    true,
    _csScratch,
  );
  let halfW = _csScratch.halfW;
  let halfD = _csScratch.halfD;

  const carveGate = smoothstep(FROST_CLEAR_MELT - 0.02, FROST_CLEAR_MELT + 0.05, rawMelt);
  const localHeat = sampleLocalHeat(x, yClamped, state) * carveGate;
  const carve = localHeat * 0.22 * iceAmount;
  halfW *= 1.0 - carve * 0.55;
  halfD *= 1.0 - carve * 0.78;

  // Smooth superelliptical boundary in XZ for accurate 3D collision & containment
  const nx = Math.abs(x) / Math.max(0.015, halfW);
  const nz = Math.abs(z) / Math.max(0.012, halfD);
  const p = 2.6 - bulletTaper * 0.5;
  const rNorm = Math.pow(Math.pow(nx, p) + Math.pow(nz, p), 1.0 / p);
  const radialScale = Math.min(halfW, halfD) + (Math.max(halfW, halfD) - Math.min(halfW, halfD)) * (nx / Math.max(1e-4, nx + nz));
  const radialDepth = (1.0 - rNorm) * radialScale;

  const dyTop = yTop - y;
  const dyBot = y - yBot;
  const vertDepth = Math.min(dyTop, dyBot);

  out.dx = halfW - Math.abs(x);
  out.dz = halfD - Math.abs(z);
  out.dyBot = dyBot;
  out.dyTop = dyTop;
  if (radialDepth >= 0 && vertDepth >= 0) {
    out.depth = Math.min(radialDepth, vertDepth);
  } else {
    const outR = Math.max(0, -radialDepth);
    const outV = Math.max(0, -vertDepth);
    out.depth = -Math.hypot(outR, outV);
  }
  return out;
}

/**
 * Continuous 3D signed-distance containment query:
 * Positive strictly inside the live melted ice, ~0 on the ice surface,
 * and smoothly negative (true Euclidean outside distance) everywhere outside
 * with ZERO discontinuity across y = yBot or y = yTop!
 */
export function iceContainmentDepth(x: number, y: number, z: number, state: MeltFieldState): number {
  return sampleIceContainment(x, y, z, state, _containmentScratch).depth;
}

export interface ExactIceSurfaceInfo {
  /** Closest surface point on the live rendered popsicle mesh */
  sx: number;
  sy: number;
  sz: number;
  /** Outward unit normal of the live rendered popsicle mesh */
  nx: number;
  ny: number;
  nz: number;
  /** Signed distance outside the exact rendered surface (>0 outside, 0 on skin, <0 inside) */
  signedOut: number;
  /** True when the live ice is gone */
  iceGone: boolean;
}

const _exactRow0: ProfileRowCache = { ..._sharedRowCache };
const _exactRowP: ProfileRowCache = { ..._sharedRowCache };
const _exactRowM: ProfileRowCache = { ..._sharedRowCache };
const _exactPtA = { x: 0, y: 0, z: 0 };
const _exactPtB = { x: 0, y: 0, z: 0 };
const _exactPtTp = { x: 0, y: 0, z: 0 };
const _exactPtTm = { x: 0, y: 0, z: 0 };
const _exactPtVp = { x: 0, y: 0, z: 0 };
const _exactPtVm = { x: 0, y: 0, z: 0 };

/**
 * Queries the exact live rendered popsicle mesh surface (including flutes, melt waves, crystal erosion,
 * pointer heat dimples, and bottom rim swell) closest to `(x, y, z)`, returning the exact surface point,
 * outward unit normal, and signed outward clearance (`> 0` outside ice, `< 0` inside ice).
 */
export function sampleExactIceSurface(
  x: number,
  y: number,
  z: number,
  frame: ProfileFrameCache,
  state: MeltFieldState,
  out: ExactIceSurfaceInfo,
): ExactIceSurfaceInfo {
  if (frame.iceAmount <= 0.001) {
    out.sx = 0;
    out.sy = frame.yBot;
    out.sz = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.signedOut = 99.0;
    out.iceGone = true;
    return out;
  }

  const vNorm = clamp((y - frame.yBot) / frame.bodyH, 0.002, 0.998);
  const row = prepareProfileRow(vNorm, frame, _exactRow0);

  // Candidate A: exact front/back face match preserving X
  const uxA = clamp(Math.abs(x) / Math.max(0.015, row.halfW), 0, 0.996);
  const sinA = (x >= 0 ? 1 : -1) * Math.pow(uxA, 1.0 / row.invExpX);
  const cosA = (z >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, 1.0 - sinA * sinA));
  evaluatePopsicleVertex(sinA, cosA, frame, row, state, _exactPtA);

  let sinT = sinA;
  let cosT = cosA;
  let sx = _exactPtA.x;
  let sy = _exactPtA.y;
  let sz = _exactPtA.z;

  // Candidate B: side-wall match preserving Z when near the curved left/right edge
  if (uxA >= 0.68) {
    const uzB = clamp(Math.abs(z) / Math.max(0.012, row.halfD), 0, 0.996);
    const cosB = (z >= 0 ? 1 : -1) * Math.pow(uzB, 1.0 / row.invExpZ);
    const sinB = (x >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, 1.0 - cosB * cosB));
    evaluatePopsicleVertex(sinB, cosB, frame, row, state, _exactPtB);
    const dSqA = (x - _exactPtA.x) * (x - _exactPtA.x) + (z - _exactPtA.z) * (z - _exactPtA.z);
    const dSqB = (x - _exactPtB.x) * (x - _exactPtB.x) + (z - _exactPtB.z) * (z - _exactPtB.z);
    if (dSqB < dSqA) {
      sinT = sinB;
      cosT = cosB;
      sx = _exactPtB.x;
      sy = _exactPtB.y;
      sz = _exactPtB.z;
    }
  }

  // Exact outward normal via surface tangents: (dP/dTheta) × (dP/dvNorm)
  const theta = Math.atan2(sinT, cosT);
  const dTh = 0.045;
  evaluatePopsicleVertex(Math.sin(theta + dTh), Math.cos(theta + dTh), frame, row, state, _exactPtTp);
  evaluatePopsicleVertex(Math.sin(theta - dTh), Math.cos(theta - dTh), frame, row, state, _exactPtTm);
  const vP = Math.min(0.999, vNorm + 0.012);
  const vM = Math.max(0.001, vNorm - 0.012);
  const rowP = prepareProfileRow(vP, frame, _exactRowP);
  const rowM = prepareProfileRow(vM, frame, _exactRowM);
  evaluatePopsicleVertex(sinT, cosT, frame, rowP, state, _exactPtVp);
  evaluatePopsicleVertex(sinT, cosT, frame, rowM, state, _exactPtVm);

  const tx = _exactPtTp.x - _exactPtTm.x;
  const ty = _exactPtTp.y - _exactPtTm.y;
  const tz = _exactPtTp.z - _exactPtTm.z;
  const vx = _exactPtVp.x - _exactPtVm.x;
  const vy = _exactPtVp.y - _exactPtVm.y;
  const vz = _exactPtVp.z - _exactPtVm.z;

  let nx = ty * vz - tz * vy;
  let ny = tz * vx - tx * vz;
  let nz = tx * vy - ty * vx;
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen > 1e-6) {
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
  } else {
    nx = sinT;
    ny = 0;
    nz = cosT;
  }

  let signedOut = (x - sx) * nx + (y - sy) * ny + (z - sz) * nz;
  if (y > frame.yTop) {
    signedOut = Math.max(signedOut, y - frame.yTop);
  } else if (vNorm <= 0.002 && y < sy) {
    signedOut = Math.max(signedOut, sy - y);
  }

  out.sx = sx;
  out.sy = sy;
  out.sz = sz;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  out.signedOut = signedOut;
  out.iceGone = false;
  return out;
}
