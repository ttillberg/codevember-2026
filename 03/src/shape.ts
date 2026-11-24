import { clamp, fbm3, smoothstep } from './rng';

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

  // Global melt gently shortens the top dome faster than the bottom (gravity + warm air)
  const topRecede = m * 0.72;
  const botRecede = m * 0.14;
  const yTop = POPSICLE.yTop - topRecede;
  const yBot = POPSICLE.yBottom + botRecede;

  // Map vNorm in [0, 1] with concentrated resolution near top dome & bottom lip
  const s = vNorm;
  // Base vertical coordinate
  let y = yBot + (yTop - yBot) * s;

  // Normalized height along current body [0..1]
  const hNorm = clamp((y - yBot) / Math.max(0.15, yTop - yBot), 0, 1);

  // Base trapezoid half-width (classic downward flare at t=0 -> narrows into tapered rounded bullet like process/melt!)
  const bulletTaper = smoothstep(0.08, 0.72, m);
  const widthShrink = 1.0 - m * 0.44 * (0.62 + 0.58 * hNorm);
  let halfW = (POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm) * widthShrink;
  // Upper body narrows gently into bullet tip as it melts (matching process/melt frames 0120-0135!)
  halfW *= 1.0 - bulletTaper * 0.22 * smoothstep(0.35, 0.92, hNorm);

  // Base slab half-depth
  const depthShrink = 1.0 - m * 0.48 * (0.68 + 0.45 * hNorm);
  let halfD = POPSICLE.halfDepth * depthShrink;

  // Top dome rounding (gradually extends downward as sharp top shoulders melt away)
  const domeStart = 0.735 - bulletTaper * 0.14;
  let capFactor = 1.0;
  let domeDepthFactor = 1.0;
  if (hNorm > domeStart) {
    const t = clamp((hNorm - domeStart) / Math.max(0.1, 1.0 - domeStart), 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1.0 - t * t));
    capFactor = sinA;
    domeDepthFactor = Math.pow(sinA, 0.74);
  }

  // Bottom rounded bevel lip: crisp flat popsicle bottom at t=0 -> rounds smoothly inward around stick (frame_0120!)
  const botBevel = 0.072 + bulletTaper * 0.24;
  if (hNorm < botBevel) {
    const t = clamp(1.0 - hNorm / botBevel, 0, 1);
    const sinB = Math.sqrt(Math.max(0, 1.0 - t * t));
    // Smoothly pulls bottom corners inward toward the stick as melt advances
    const flatKeep = 0.86 * (1.0 - bulletTaper * 0.62);
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
    const carve = localHeat * 0.22 * (0.4 + 0.6 * bodyBlend);
    x *= 1.0 - carve * 0.55;
    z *= 1.0 - carve * 0.78;
    y -= localHeat * 0.065 * smoothstep(0.05, 0.3, hNorm);
  }

  // Organic wet melt surface undulation + porous slush micro-erosion bumps (process/melt frames 0078-0096!)
  const so = state.seedOffset;
  const nMacro = fbm3(x * 2.4 + so, y * 1.7 + state.time * 0.012, z * 2.4, 3) - 0.5;
  const nRivulet = fbm3(x * 7.8 + so * 1.7, y * 1.9 + state.time * 0.035, z * 4.5, 3) - 0.5;
  const nSlush = fbm3(x * 16.5 + so * 2.3, y * 15.5, z * 16.5, 2) - 0.5;
  const slushFactor = smoothstep(0.08, 0.45, effMelt);
  const meltAmp = 0.010 + effMelt * 0.052;

  const sideEdge = Math.abs(sinT);
  const edgeWave =
    nMacro * meltAmp * (0.65 + 0.55 * sideEdge) +
    nRivulet * (0.0045 + effMelt * 0.018) +
    nSlush * (0.016 * slushFactor);

  x += sgnX * edgeWave * (0.45 + 0.55 * sideEdge) * capFactor;
  z += sgnZ * edgeWave * 0.78 * domeDepthFactor;

  // Sticky accumulated berry-syrup pooling relief along the entire bottom rim (matching reference close-up!):
  // Soft rounded scalloped viscous lobes, plump wet lip swell, and smooth symmetric liquid fillets embracing the stick!
  if (hNorm < 0.13) {
    const botProximity = smoothstep(0.13, 0.0, hNorm);
    const rimEdgeMask = smoothstep(0.10, 0.015, hNorm);
    const activeRim = 1.0 - smoothstep(0.55, 0.92, m);
    const poolGrow = 0.85 + 0.30 * smoothstep(0.0, 0.30, m);

    // Soft rounded asymmetric sticky pooling swells evenly across left & right bottom underside
    const nBotA = fbm3(x * 8.5 + so * 1.3, so * 0.5, z * 6.5, 3);
    const nBotB = fbm3(x * 19.0 - so * 2.1, so * 1.1, z * 14.0, 2);
    const waveLobes =
      Math.max(0, Math.sin(x * 21.0 + so * 1.1) * 0.5 + 0.5) * 0.009 +
      Math.max(0, Math.sin(x * 38.0 - so * 2.3 + 1.4) * 0.5 + 0.5) * 0.0055 +
      Math.max(0, nBotA - 0.36) * 0.018 +
      Math.max(0, nBotB - 0.44) * 0.011;

    // Gentle pool sag around hero bottom-left & subtle bottom-right drop zones
    const bulgeL = Math.exp(-Math.pow((x + 0.43) / 0.105, 2.0)) * 0.014;
    const bulgeR = Math.exp(-Math.pow((x - 0.35) / 0.095, 2.0)) * 0.011;

    // Smooth symmetric curved pink liquid fillets tucked tightly against BOTH left & right wood stick edges!
    const stickHalfW = POPSICLE.stickWidth * 0.5;
    const filletL = Math.exp(-Math.pow((x + stickHalfW + 0.014) / 0.036, 2.0)) * 0.014;
    const filletR = Math.exp(-Math.pow((x - stickHalfW - 0.014) / 0.036, 2.0)) * 0.014;
    const stickCenter = Math.exp(-Math.pow(x / (stickHalfW * 0.90), 2.0));

    const totalSag = Math.min(
      0.030,
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
 * Fast analytical signed-distance-like containment query:
 * Returns positive value when point (x, y, z) is deeply inside the current melted ice,
 * ~0 at the ice surface, and negative when exposed outside the ice.
 */
export function iceContainmentDepth(x: number, y: number, z: number, state: MeltFieldState): number {
  const m = clamp(state.melt, 0, 1);
  const yTop = POPSICLE.yTop - m * 0.72;
  const yBot = POPSICLE.yBottom + m * 0.14;
  if (y > yTop || y < yBot) {
    return -Math.max(y - yTop, yBot - y);
  }
  const hNorm = clamp((y - yBot) / Math.max(0.15, yTop - yBot), 0, 1);
  const bulletTaper = smoothstep(0.08, 0.72, m);
  const widthShrink = 1.0 - m * 0.44 * (0.62 + 0.58 * hNorm);
  let halfW = (POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm) * widthShrink;
  halfW *= 1.0 - bulletTaper * 0.22 * smoothstep(0.35, 0.92, hNorm);

  const depthShrink = 1.0 - m * 0.48 * (0.68 + 0.45 * hNorm);
  let halfD = POPSICLE.halfDepth * depthShrink;

  const domeStart = 0.735 - bulletTaper * 0.14;
  if (hNorm > domeStart) {
    const t = clamp((hNorm - domeStart) / Math.max(0.1, 1.0 - domeStart), 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1.0 - t * t));
    halfW *= sinA;
    halfD *= Math.pow(sinA, 0.74);
  }

  const botBevel = 0.072 + bulletTaper * 0.24;
  if (hNorm < botBevel) {
    const t = clamp(1.0 - hNorm / botBevel, 0, 1);
    const sinB = Math.sqrt(Math.max(0, 1.0 - t * t));
    const flatKeep = 0.86 * (1.0 - bulletTaper * 0.62);
    halfW *= flatKeep + (1.0 - flatKeep) * sinB;
    halfD *= Math.max(0.22, sinB);
  }

  const localHeat = sampleLocalHeat(x, y, state);
  const carve = localHeat * 0.22;
  halfW *= 1.0 - carve * 0.55;
  halfD *= 1.0 - carve * 0.78;

  // Smooth superelliptical boundary approximation in XZ for accurate 3D collision & bounce normals!
  const nx = Math.abs(x) / Math.max(0.02, halfW);
  const nz = Math.abs(z) / Math.max(0.02, halfD);
  const p = 2.6 - bulletTaper * 0.5;
  const rNorm = Math.pow(Math.pow(nx, p) + Math.pow(nz, p), 1.0 / p);
  const radialScale = Math.min(halfW, halfD) + (Math.max(halfW, halfD) - Math.min(halfW, halfD)) * (nx / Math.max(1e-4, nx + nz));
  const radialDepth = (1.0 - rNorm) * radialScale;

  const dyTop = yTop - y;
  const dyBot = y - yBot;
  return Math.min(radialDepth, dyTop, dyBot);
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
