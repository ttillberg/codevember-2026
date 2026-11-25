import { clamp, smoothstep } from './rng';
import { sampleFastFbm3 } from './noise3d';

/**
 * Shared dimensional & parametric melt shape of the molded berry popsicle.
 * Used consistently by `fruits.ts`, `popsicleIce.ts`, and `waterDrops.ts` so
 * solid fruits, refractive ice, trapped air bubbles, and separate water drops
 * stay physically locked to the exact same melting silhouette.
 */
export const POPSICLE = {
  /** Base unmelted vertical bounds */
  yTop: 1.12,
  yBottom: -1.02,
  /** Dome transition Y */
  yDomeStart: 0.56,
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
  /** Wood stick bounds */
  stickWidth: 0.215,
  stickDepth: 0.042,
  stickTopY: -0.36,
  stickBottomY: -2.25,
} as const;

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
}

/**
 * Evaluates accumulated local pointer-induced melt boost at (x, y).
 */
export function sampleLocalHeat(x: number, y: number, state: MeltFieldState): number {
  let boost = 0;
  const spots = state.heatSpots;
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (s.heat <= 0.0005) continue;
    const dx = x - s.x;
    const dy = (y - s.y) * 0.85;
    const d2 = dx * dx + dy * dy;
    // Soft thermal diffusion radius ~0.34
    const w = Math.exp(-d2 / 0.115);
    boost += s.heat * w;
  }
  return clamp(boost, 0, 0.85);
}

export interface MeltBounds {
  yTop: number;
  yBot: number;
  /** 1 while solid popsicle body exists, smoothly dissolving to 0 by melt = 0.975 */
  iceAmount: number;
  /** True once the ice has completely melted away, leaving only the bare sticky stick */
  iceGone: boolean;
}

/**
 * Shared live vertical bounds & endgame dissolve state for a given melt progress [0..1].
 * Keeps 0..0.50 faithful to the classic slow backlit melt, then smoothly collapses the
 * remaining ice sleeve onto the upper wooden stick until only the bare sticky stick remains.
 */
export function getMeltBounds(melt: number): MeltBounds {
  const m = clamp(melt, 0, 1);
  const collapse = smoothstep(0.40, 0.975, m);
  const collapse2 = collapse * collapse;

  // Final melting slush collar clings smoothly around the upper wooden stick shaft before vanishing
  const yFinal = -0.66;
  const yTopBase = POPSICLE.yTop - m * 0.72;
  const yBotBase = POPSICLE.yBottom + m * 0.14;

  const yTop = yTopBase + (yFinal - yTopBase) * Math.pow(collapse, 1.38);
  const yBot = yBotBase + (yFinal - yBotBase) * (collapse2 * 0.90 + Math.pow(collapse, 3.0) * 0.10);
  const iceAmount = 1.0 - smoothstep(0.84, 0.975, m);
  const iceGone = m >= 0.975 || yTop - yBot < 0.014;
  return { yTop, yBot, iceAmount, iceGone };
}

/**
 * Evaluates current melted vertical bounds and horizontal half-width at height y.
 */
export function evaluatePopsicleProfile(
  vNorm: number, // 0 = bottom pole, 1 = top pole
  theta: number, // angle around Y axis: 0 = +Z front, PI/2 = +X right, PI = -Z back, -PI/2 = -X left
  state: MeltFieldState,
  outPos: { x: number; y: number; z: number },
): void {
  const m = clamp(state.melt, 0, 1);
  const { yTop, yBot, iceAmount } = getMeltBounds(m);
  const collapse = smoothstep(0.40, 0.975, m);
  const endRound = smoothstep(0.72, 0.94, m);

  // Map vNorm in [0, 1] with concentrated resolution near top dome & bottom lip
  const s = vNorm;
  // Base vertical coordinate
  let y = yBot + (yTop - yBot) * s;

  // Normalized height along current body [0..1]
  const hNorm = clamp((y - yBot) / Math.max(0.02, yTop - yBot), 0, 1);

  // Base trapezoid half-width (classic downward flare at t=0 -> narrows into tapered rounded bullet -> melts flush into stick!)
  const bulletTaper = smoothstep(0.08, 0.72, m);
  const radialCollapseW = 1.0 - Math.pow(collapse, 1.58) * 0.85;
  const radialCollapseD = 1.0 - Math.pow(collapse, 1.50) * 0.88;
  const widthShrink = (1.0 - m * 0.44 * (0.62 + 0.58 * hNorm)) * radialCollapseW;
  let halfW = (POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm) * widthShrink;
  // Upper body narrows gently into bullet tip during mid-melt, then softens into a smooth round melting cushion near the end
  halfW *= 1.0 - bulletTaper * (1.0 - endRound * 0.55) * 0.22 * smoothstep(0.35, 0.92, hNorm);

  // Base slab half-depth (thins smoothly until flush beneath the wet wooden stick face before iceGone)
  const depthShrink = (1.0 - m * 0.48 * (0.68 + 0.45 * hNorm)) * radialCollapseD;
  let halfD = POPSICLE.halfDepth * depthShrink;

  // Top dome rounding (gradually extends downward as sharp top shoulders melt away)
  const domeStart = 0.735 - bulletTaper * 0.14 - endRound * 0.08;
  let capFactor = 1.0;
  let domeDepthFactor = 1.0;
  if (hNorm > domeStart) {
    const t = clamp((hNorm - domeStart) / Math.max(0.1, 1.0 - domeStart), 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1.0 - t * t));
    capFactor = sinA;
    domeDepthFactor = Math.pow(sinA, 0.74);
  }

  // Bottom rounded bevel lip: crisp flat popsicle bottom at t=0 -> rounds smoothly inward around stick
  const botBevel = 0.072 + bulletTaper * 0.24 + endRound * 0.16;
  if (hNorm < botBevel) {
    const t = clamp(1.0 - hNorm / botBevel, 0, 1);
    const sinB = Math.sqrt(Math.max(0, 1.0 - t * t));
    // Smoothly pulls bottom corners inward toward the stick as melt advances
    const flatKeep = 0.86 * (1.0 - bulletTaper * 0.62) * (1.0 - endRound * 0.85);
    capFactor *= flatKeep + (1.0 - flatKeep) * sinB;
    domeDepthFactor *= sinB;
  }

  halfW *= capFactor;
  halfD *= domeDepthFactor;

  // Superellipse cross-section in XZ: crisp flat slab faces at t=0 -> softens toward cylindrical ovoid as it melts!
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);

  const bodyBlend = smoothstep(0.03, 0.14, hNorm) * smoothstep(0.98, 0.78, hNorm) * (1.0 - bulletTaper * 0.65);
  const expX = 2.0 + 1.15 * bodyBlend;
  const expZ = 2.0 + 1.45 * bodyBlend;

  const sgnX = sinT >= 0 ? 1 : -1;
  const sgnZ = cosT >= 0 ? 1 : -1;
  let x = sgnX * Math.pow(Math.abs(sinT), 2.0 / expX) * halfW;
  let z = sgnZ * Math.pow(Math.abs(cosT), 2.0 / expZ) * halfD;

  // Twin crisp vertical molded flutes on front (+Z) and back (-Z) faces!
  const fluteVerticalMask =
    smoothstep(0.06, 0.15, hNorm) *
    smoothstep(0.92, 0.78, hNorm) *
    smoothstep(0.18, 0.52, Math.abs(cosT));

  // Flutes soften and flatten as global + local heat melts the ice
  const localHeat = sampleLocalHeat(x, y, state);
  const effMelt = clamp(m + localHeat * 0.55, 0, 1);
  const fluteSharpness = Math.max(0, 1.0 - smoothstep(0.04, 0.58, effMelt));
  const fluteCenter = POPSICLE.fluteX * (1.0 - m * 0.25);
  const fluteW = POPSICLE.fluteWidth * (1.0 + effMelt * 0.85);

  const dL = (x + fluteCenter) / fluteW;
  const dR = (x - fluteCenter) / fluteW;
  const groove = Math.exp(-dL * dL * 1.45) + Math.exp(-dR * dR * 1.45);
  // Subtle raised shoulder ridge right alongside each flute makes the twin specular stripes POP!
  const ridgeL = Math.exp(-Math.pow((Math.abs(x + fluteCenter) - fluteW * 1.05) / (fluteW * 0.65), 2.0));
  const ridgeR = Math.exp(-Math.pow((Math.abs(x - fluteCenter) - fluteW * 1.05) / (fluteW * 0.65), 2.0));
  const fluteDisplacement =
    (-groove * POPSICLE.fluteDepth + (ridgeL + ridgeR) * POPSICLE.fluteDepth * 0.16) *
    fluteVerticalMask *
    fluteSharpness;

  z += sgnZ * fluteDisplacement;

  // Local pointer heat carves a smooth glossy melted depression & slumps downward slightly!
  if (localHeat > 0.001) {
    const carve = localHeat * 0.22 * (0.4 + 0.6 * bodyBlend) * iceAmount;
    x *= 1.0 - carve * 0.55;
    z *= 1.0 - carve * 0.78;
    y -= localHeat * 0.065 * smoothstep(0.05, 0.3, hNorm) * iceAmount;
  }

  // Organic wet melt surface undulation + porous slush micro-erosion bumps (fast baked 3D FBM lookup!)
  const so = state.seedOffset;
  const nMacro = sampleFastFbm3(x * 2.4 + so, y * 1.7 + state.time * 0.012, z * 2.4) - 0.5;
  const nRivulet = sampleFastFbm3(x * 7.8 + so * 1.7, y * 1.9 + state.time * 0.035, z * 4.5) - 0.5;
  const nSlush = sampleFastFbm3(x * 16.5 + so * 2.3, y * 15.5, z * 16.5) - 0.5;
  const slushFactor = smoothstep(0.08, 0.45, effMelt);
  const waveScale = (1.0 - collapse * 0.78) * iceAmount;
  const meltAmp = (0.010 + effMelt * 0.052) * waveScale;

  const sideEdge = Math.abs(sinT);
  const edgeWave =
    nMacro * meltAmp * (0.65 + 0.55 * sideEdge) +
    nRivulet * (0.0045 + effMelt * 0.018) * waveScale +
    nSlush * (0.016 * slushFactor) * waveScale;

  x += sgnX * edgeWave * (0.45 + 0.55 * sideEdge) * capFactor;
  z += sgnZ * edgeWave * 0.78 * domeDepthFactor;

  // Sticky accumulated berry-syrup pooling relief along the entire bottom rim (matching reference close-up!):
  // Soft rounded scalloped viscous lobes, plump wet lip swell, and smooth symmetric liquid fillets embracing the stick!
  if (hNorm < 0.13) {
    const botProximity = smoothstep(0.13, 0.0, hNorm);
    const rimEdgeMask = smoothstep(0.10, 0.015, hNorm);
    const activeRim = 1.0 - smoothstep(0.48, 0.78, m);
    const poolGrow = 0.85 + 0.30 * smoothstep(0.0, 0.30, m);

    // Soft rounded asymmetric sticky pooling swells evenly across left & right bottom underside
    const nBotA = sampleFastFbm3(x * 8.5 + so * 1.3, so * 0.5, z * 6.5);
    const nBotB = sampleFastFbm3(x * 19.0 - so * 2.1, so * 1.1, z * 14.0);
    const waveLobes =
      Math.max(0, Math.sin(x * 21.0 + so * 1.1) * 0.5 + 0.5) * 0.0075 +
      Math.max(0, Math.sin(x * 38.0 - so * 2.3 + 1.4) * 0.5 + 0.5) * 0.0045 +
      Math.max(0, nBotA - 0.36) * 0.015 +
      Math.max(0, nBotB - 0.44) * 0.009;

    // Distinct curved viscous accumulation bellies on bottom-left & bottom-right where liquid gathers & drops grow!
    const bulgeL = Math.exp(-Math.pow((x + 0.35) / 0.115, 2.0)) * 0.020;
    const bulgeR = Math.exp(-Math.pow((x - 0.34) / 0.105, 2.0)) * 0.015;

    // Smooth symmetric curved pink liquid fillets tucked tightly against BOTH left & right wood stick edges!
    const stickHalfW = POPSICLE.stickWidth * 0.5;
    const filletL = Math.exp(-Math.pow((x + stickHalfW + 0.014) / 0.036, 2.0)) * 0.014;
    const filletR = Math.exp(-Math.pow((x - stickHalfW - 0.014) / 0.036, 2.0)) * 0.014;
    const stickCenter = Math.exp(-Math.pow(x / (stickHalfW * 0.90), 2.0));

    const totalSag = Math.min(
      0.034,
      ((waveLobes + bulgeL + bulgeR) * (1.0 - stickCenter * 0.80) + filletL + filletR) * poolGrow,
    );
    y -= totalSag * botProximity * activeRim;

    // Plump swollen viscous lip bulging gently outward in Z & X where sticky liquid pools at the bottom rim!
    const lipSwell = (0.008 + waveLobes * 0.55) * rimEdgeMask * activeRim * poolGrow;
    z += sgnZ * lipSwell * (0.55 + 0.45 * Math.abs(cosT)) * (1.0 - stickCenter * 0.55);
    x += sgnX * lipSwell * 0.38 * sideEdge;
  }

  outPos.x = x;
  outPos.y = y;
  outPos.z = z;
}

/**
 * Continuous 3D signed-distance containment query:
 * Positive strictly inside the live melted ice, ~0 on the ice surface,
 * and smoothly negative (true Euclidean outside distance) everywhere outside
 * with ZERO discontinuity across y = yBot or y = yTop!
 */
export function iceContainmentDepth(x: number, y: number, z: number, state: MeltFieldState): number {
  const m = clamp(state.melt, 0, 1);
  const { yTop, yBot, iceAmount, iceGone } = getMeltBounds(m);
  if (iceGone) return -99.0;

  const collapse = smoothstep(0.40, 0.975, m);
  const endRound = smoothstep(0.72, 0.94, m);
  const yClamped = clamp(y, yBot, yTop);
  const hNorm = clamp((yClamped - yBot) / Math.max(0.02, yTop - yBot), 0, 1);
  const bulletTaper = smoothstep(0.08, 0.72, m);
  const radialCollapseW = 1.0 - Math.pow(collapse, 1.58) * 0.85;
  const radialCollapseD = 1.0 - Math.pow(collapse, 1.50) * 0.88;
  const widthShrink = (1.0 - m * 0.44 * (0.62 + 0.58 * hNorm)) * radialCollapseW;
  let halfW = (POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm) * widthShrink;
  halfW *= 1.0 - bulletTaper * (1.0 - endRound * 0.55) * 0.22 * smoothstep(0.35, 0.92, hNorm);

  const depthShrink = (1.0 - m * 0.48 * (0.68 + 0.45 * hNorm)) * radialCollapseD;
  let halfD = POPSICLE.halfDepth * depthShrink;

  const domeStart = 0.735 - bulletTaper * 0.14 - endRound * 0.08;
  if (hNorm > domeStart) {
    const t = clamp((hNorm - domeStart) / Math.max(0.1, 1.0 - domeStart), 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1.0 - t * t));
    halfW *= sinA;
    halfD *= Math.pow(sinA, 0.74);
  }

  const botBevel = 0.072 + bulletTaper * 0.24 + endRound * 0.16;
  if (hNorm < botBevel) {
    const t = clamp(1.0 - hNorm / botBevel, 0, 1);
    const sinB = Math.sqrt(Math.max(0, 1.0 - t * t));
    const flatKeep = 0.86 * (1.0 - bulletTaper * 0.62) * (1.0 - endRound * 0.85);
    halfW *= flatKeep + (1.0 - flatKeep) * sinB;
    halfD *= Math.max(0.22, sinB);
  }

  const localHeat = sampleLocalHeat(x, yClamped, state);
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

  if (radialDepth >= 0 && vertDepth >= 0) {
    return Math.min(radialDepth, vertDepth);
  }
  const outR = Math.max(0, -radialDepth);
  const outV = Math.max(0, -vertDepth);
  return -Math.hypot(outR, outV);
}

/**
 * Computes the unit outward normal of the live melting ice boundary at (x, y, z)
 * via central finite differences of `iceContainmentDepth`.
 */
export function iceSurfaceOutwardNormal(
  x: number,
  y: number,
  z: number,
  state: MeltFieldState,
  out: { x: number; y: number; z: number },
): void {
  const e = 0.012;
  const dx = iceContainmentDepth(x + e, y, z, state) - iceContainmentDepth(x - e, y, z, state);
  const dy = iceContainmentDepth(x, y + e, z, state) - iceContainmentDepth(x, y - e, z, state);
  const dz = iceContainmentDepth(x, y, z + e, state) - iceContainmentDepth(x, y, z - e, state);
  // Outward points toward decreasing containment depth (-grad)
  const nx = -dx;
  const ny = -dy;
  const nz = -dz;
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-5) {
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
  } else {
    out.x = Math.sign(x || 1);
    out.y = 0;
    out.z = Math.sign(z || -1);
    const l2 = Math.hypot(out.x, out.z) || 1;
    out.x /= l2;
    out.z /= l2;
  }
}
