import * as THREE from 'three';
import { clamp, fbm3, smoothstep } from './rng';
import { getMeltBounds, MeltFieldState, POPSICLE, sampleLocalHeat } from './shape';

export const FILM_U = 64;
const FILM_V = 64;
const RIME_U = 128;
const RIME_V = 128;

export interface FrostMeltSample {
  u: number;
  v: number;
  melted: number;
}

export interface LiquidFilmSystem {
  /**
   * 64x64 DataTexture (RepeatWrapping in S, ClampToEdge in T, LinearFilter):
   *   R = liquid glaze thickness h [0..1]
   *   G = precomputed smooth horizontal meniscus slope (0.5 + 0.5 * dh/du)
   *   B = precomputed smooth vertical meniscus slope (0.5 + 0.5 * dh/dv)
   *   A = damp wet trace memory [0..1] (stays glossy after a liquid lobe flows past!)
   */
  texture: THREE.DataTexture;
  /**
   * 128x128 single-channel RedFormat DataTexture (RepeatWrapping in S, ClampToEdge in T, LinearFilter):
   *   R = freezer-fresh powdery hoarfrost rime coat [0..1] (instantly melts under pointer!)
   */
  rimeTexture: THREE.DataTexture;
  /** Accumulated bottom-rim drainage flux per column u ∈ [0..FILM_U-1] during last step */
  bottomFlux: Float32Array;
  /** How far glossy berry-syrup runoff has crept down the wooden stick [0..1] */
  stickWetness: number;
  /** Average remaining freezer rime across the front/sides [0..1] */
  avgRime: number;
  /** Sample liquid thickness h at (uNorm ∈ [0,1), vNorm ∈ [0,1]) */
  sampleThickness(uNorm: number, vNorm: number): number;
  /** Sample freezer hoarfrost rime thickness [0..1] at (uNorm, vNorm) */
  sampleRime(uNorm: number, vNorm: number): number;
  /** Instantly melt powdery hoarfrost along a pointer swipe segment and return where frost turned to water */
  meltFrostSegment(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    strength?: number,
    radius?: number,
  ): FrostMeltSample[];
  /** Sync deterministic ambient rime state when melt is scrubbed/set directly */
  syncRimeToMelt(melt: number): void;
  /** Deposit local liquid volume (e.g. when a swollen condensation bead ruptures into the glaze!) */
  deposit(uNorm: number, vNorm: number, amount: number, radiusCells?: number): void;
  reset(): void;
  update(state: MeltFieldState, dt: number, meltSpeedMul: number): void;
  dispose(): void;
}

/**
 * Real-time 2D nonlinear thin-film lubrication PDE (Nusselt / Huppert viscous gravity flow)
 * mapped directly onto the popsicle surface (uNorm × vNorm):
 *
 *   dh/dt = S_melt - div( K * max(0, h - h_pin)^2.2 * g_down - D * h * grad(h) )
 *
 * Because gravity flux scales nonlinearly with thickness above pinning threshold h_pin,
 * melted berry-ice naturally forms organic, cohesive, slow-creeping glossy syrup lobes,
 * viscous fingering tongues, and continuous glistening wet sheets (matching `process/melt`)
 * rather than independent linear falling particles!
 */
export function createLiquidFilmSystem(seed: number): LiquidFilmSystem {
  const N = FILM_U * FILM_V;
  const h = new Float32Array(N);
  const hNext = new Float32Array(N);
  const hSmoothB = new Float32Array(N);
  const wetMem = new Float32Array(N);
  const rough = new Float32Array(N);
  const roughGradU = new Float32Array(N);
  const bottomFlux = new Float32Array(FILM_U);

  // RGBA Uint8 texture buffer for universal hardware bilinear filtering
  const texData = new Uint8Array(N * 4);
  const texture = new THREE.DataTexture(texData, FILM_U, FILM_V, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // High-res 128x128 interactive freezer hoarfrost rime grid & RedFormat DataTexture
  const N_RIME = RIME_U * RIME_V;
  const rime = new Float32Array(N_RIME);
  const rimePrev = new Float32Array(N_RIME);
  const rimePattern = new Float32Array(N_RIME);
  const ridgeField = new Float32Array(N_RIME);
  const thawOrder = new Float32Array(N_RIME);
  const rimeTexData = new Uint8Array(N_RIME);
  const rimeTexture = new THREE.DataTexture(rimeTexData, RIME_U, RIME_V, THREE.RedFormat, THREE.UnsignedByteType);
  rimeTexture.wrapS = THREE.RepeatWrapping;
  rimeTexture.wrapT = THREE.ClampToEdgeWrapping;
  rimeTexture.minFilter = THREE.LinearFilter;
  rimeTexture.magFilter = THREE.LinearFilter;
  rimeTexture.generateMipmaps = false;
  rimeTexture.unpackAlignment = 1;

  // Deterministic porous ice micro-roughness & subtle fingering topography across (u, v)
  const off = seed * 19.7;
  for (let iv = 0; iv < FILM_V; iv++) {
    const v = iv / (FILM_V - 1);
    for (let iu = 0; iu < FILM_U; iu++) {
      const ang = (iu / FILM_U) * Math.PI * 2;
      const sx = Math.sin(ang);
      const cz = Math.cos(ang);
      const nMacro = fbm3(sx * 3.4 + off, v * 4.2, cz * 3.4, 3);
      const nFine = fbm3(sx * 9.5 + off * 1.6, v * 11.5, cz * 9.5, 2);
      rough[iv * FILM_U + iu] = nMacro * 0.68 + nFine * 0.32;
    }
  }

  // Exact 3D raised-ridge vs recessed-groove map (NO top->down bias!):
  // Exposed outer bevel edges (left, right, top arch, bottom lip) + the 3 raised vertical ridges
  // (left bar, center spine bar, right bar) absorb warmth FIRST -> lightly premelted at t=0 and melt first,
  // while the 2 recessed vertical flute grooves (±0.165) shelter thick crystalline frost longest!
  for (let iv = 0; iv < RIME_V; iv++) {
    const v = iv / (RIME_V - 1);
    // Match popsicleIce.ts non-linear vTable height mapping so grooves & ridges lock 1:1 to 3D geometry!
    const hNorm = v * 0.55 + (0.5 - 0.5 * Math.cos(v * Math.PI)) * 0.45;
    let halfW = POPSICLE.halfWidthBottom + (POPSICLE.halfWidthTop - POPSICLE.halfWidthBottom) * hNorm;
    if (hNorm > 0.735) {
      const t = clamp((hNorm - 0.735) / 0.265, 0, 1);
      halfW *= Math.sqrt(Math.max(0.01, 1 - t * t));
    }
    const topArchRidge = smoothstep(0.80, 0.99, hNorm);
    const botBevelRidge = smoothstep(0.12, 0.012, hNorm);
    const fluteVert = smoothstep(0.06, 0.14, hNorm) * smoothstep(0.93, 0.80, hNorm);

    for (let iu = 0; iu < RIME_U; iu++) {
      const idx = iv * RIME_U + iu;
      const ang = (iu / RIME_U) * Math.PI * 2;
      const sx = Math.sin(ang);
      const cz = Math.cos(ang);
      const absSx = Math.abs(sx);
      const absCz = Math.abs(cz);
      const faceMask = smoothstep(0.24, 0.58, absCz);

      const nA = fbm3(sx * 4.5 + off * 1.3, hNorm * 5.4, cz * 4.5, 3);
      const nB = fbm3(sx * 14.5 + off * 2.1, hNorm * 16.5, cz * 14.5, 2);
      const pat = clamp(nA * 0.58 + nB * 0.42, 0, 1);
      rimePattern[idx] = pat;

      // Left & right outer curved silhouette ridges + top dome arch + bottom bevel
      const sideRidge = smoothstep(0.56, 0.94, absSx);
      const outerRidge = Math.max(sideRidge, topArchRidge, botBevelRidge * (0.62 + 0.38 * absSx));

      // Exact X coordinate on the superellipse slab, lightly warped by low-frequency noise
      // so frost boundaries along the 3 raised vertical bars break up organically rather than ruler-straight.
      const x = Math.sign(sx) * Math.pow(absSx, 2.0 / 3.15) * halfW;
      const xWarp = (nA - 0.5) * 0.034;
      const absXWarp = Math.abs(x + xWarp);

      // The 2 narrow recessed vertical flute grooves (±0.165, matching shape.ts fluteWidth=0.036):
      // sheltered valleys that hold powdery frost LONGEST!
      const fluteDist = Math.abs(absXWarp - POPSICLE.fluteX);
      const grooveValley = Math.exp(-Math.pow(fluteDist / 0.035, 2.0)) * fluteVert * faceMask;

      // The 3 raised vertical ridges (center bar |x|<0.12 + left/right bars |x|>0.20):
      // exposed raised panels that seamlessly join the top arch & bottom bevel (no horizontal gap!)
      // and premelt slightly & thaw FIRST together with the outer edges!
      const centerBar = Math.exp(-Math.pow(Math.abs(x + xWarp) / 0.118, 3.0));
      const sideBars = smoothstep(0.195, 0.255, absXWarp);
      const raisedBars = clamp(Math.max(centerBar, sideBars) * (1.0 - grooveValley * 0.96), 0, 1) * faceMask;

      const ridge = clamp(Math.max(outerRidge, raisedBars * 0.88) * (1.0 - grooveValley * 0.92), 0, 1);
      ridgeField[idx] = ridge;

      // Low thawOrder on outer edges & all 3 raised vertical bars -> lightly premelted & melt first;
      // high thawOrder inside the 2 narrow recessed flute grooves -> keep snowy frost longest!
      thawOrder[idx] = clamp(0.86 - ridge * 0.64 + grooveValley * 0.24 - (1.0 - pat) * 0.28, 0, 1);
    }
  }

  for (let iv = 0; iv < FILM_V; iv++) {
    for (let iu = 0; iu < FILM_U; iu++) {
      const iuL = (iu - 1 + FILM_U) % FILM_U;
      const iuR = (iu + 1) % FILM_U;
      roughGradU[iv * FILM_U + iu] = rough[iv * FILM_U + iuR] - rough[iv * FILM_U + iuL];
    }
  }

  let stickWetness = 0.0;
  let avgRime = 0.92;

  function packRimeTexture() {
    let sum = 0;
    for (let i = 0; i < N_RIME; i++) {
      const val = clamp(rime[i], 0, 1);
      rimeTexData[i] = Math.round(val * 255);
      sum += val;
    }
    avgRime = sum / N_RIME;
    rimeTexture.needsUpdate = true;
  }

  function sampleRime(uNorm: number, vNorm: number): number {
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const fu = uW * RIME_U;
    const fv = vC * (RIME_V - 1);
    const iu0 = Math.floor(fu) % RIME_U;
    const iu1 = (iu0 + 1) % RIME_U;
    const iv0 = Math.min(RIME_V - 1, Math.floor(fv));
    const iv1 = Math.min(RIME_V - 1, iv0 + 1);
    const tu = fu - Math.floor(fu);
    const tv = fv - iv0;
    const a = rime[iv0 * RIME_U + iu0] * (1 - tu) + rime[iv0 * RIME_U + iu1] * tu;
    const b = rime[iv1 * RIME_U + iu0] * (1 - tu) + rime[iv1 * RIME_U + iu1] * tu;
    return a * (1 - tv) + b * tv;
  }

  function syncRimeToMelt(melt: number) {
    // At melt = 0.035 (fresh out of fridge): outer ridges + the 3 raised vertical bars are slightly premelted
    // while thick snowy frost sits inside the 2 recessed vertical grooves; frost melts off the ridges FIRST!
    if (melt >= 0.24) {
      rime.fill(0);
    } else {
      const progress = clamp((melt - 0.035) / 0.205, 0, 1);
      const recede = 0.22 + progress * 0.96;
      for (let i = 0; i < N_RIME; i++) {
        const raw = (thawOrder[i] - recede) / 0.44 + 0.56;
        rime[i] = clamp(raw, 0, 1);
      }
    }
    packRimeTexture();

    // When scrubbing directly to mid/late melt, also seed realistic undulating sticky glaze waves
    // descending from the dome so the creeping sticky layering is immediately visible!
    if (melt > 0.07) {
      const glazeProgress = clamp((melt - 0.07) / 0.45, 0, 1);
      for (let iv = 0; iv < FILM_V; iv++) {
        const v = iv / (FILM_V - 1);
        for (let iu = 0; iu < FILM_U; iu++) {
          const idx = iv * FILM_U + iu;
          const ang = (iu / FILM_U) * Math.PI * 2;
          const r = rough[idx];
          // Organic multi-lobe creeping syrup sheet advancing downward with melt!
          const lobe1 = 0.5 + 0.5 * Math.sin(ang * 2.0 + seed * 1.7 + r * 3.2);
          const lobe2 = 0.5 + 0.5 * Math.cos(ang * 3.0 - seed * 2.3 + v * 2.5);
          const frontV = clamp(0.86 - glazeProgress * (0.58 + 0.34 * lobe1 + 0.16 * lobe2), 0.04, 0.94);
          const sheet = smoothstep(frontV - 0.07, frontV + 0.09, v);
          const leadingLip = Math.exp(-Math.pow((v - frontV) / 0.065, 2.0)) * (0.45 + 0.55 * lobe1);
          const botPool = smoothstep(0.18, 0.01, v) * glazeProgress * 0.55;
          const waveH = (sheet * (0.34 + 0.28 * lobe2) + leadingLip * 0.42 + botPool) * smoothstep(0.06, 0.22, melt);
          h[idx] = clamp(0.03 + waveH * (0.82 + 0.32 * (1 - r)), 0, 1.35);
          wetMem[idx] = clamp(sheet * 0.78 + leadingLip * 0.85 + botPool, 0, 0.95);
        }
      }
      packTexture();
    }
  }

  function stampMeltFrost(uNorm: number, vNorm: number, strength: number, radius: number): number {
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const ru = radius * 0.72;
    const rv = radius * 1.12;
    const maxDu = Math.ceil(ru * RIME_U) + 1;
    const maxDv = Math.ceil(rv * RIME_V) + 1;
    const cu = Math.floor(uW * RIME_U) % RIME_U;
    const cv = Math.min(RIME_V - 1, Math.floor(vC * (RIME_V - 1)));

    let meltedSum = 0;
    let cellCount = 0;

    for (let dv = -maxDv; dv <= maxDv; dv++) {
      const iv = cv + dv;
      if (iv < 0 || iv >= RIME_V) continue;
      const ny = dv / (rv * RIME_V);
      const ny2 = ny * ny;
      if (ny2 > 1.35) continue;

      for (let du = -maxDu; du <= maxDu; du++) {
        const nx = du / (ru * RIME_U);
        const d2 = nx * nx + ny2;
        if (d2 > 1.35) continue;

        const iu = (cu + du + RIME_U) % RIME_U;
        const idx = iv * RIME_U + iu;
        const prev = rime[idx];
        if (prev <= 0.002) continue;

        // Organic crystalline melt boundary perturbation so thawed trails look feathery & real!
        const jitter = (rimePattern[idx] - 0.5) * 0.36;
        const effD = Math.sqrt(d2) + jitter * 0.42;
        if (effD >= 1.0) continue;

        const w = 1.0 - effD * effD;
        const falloff = w * w;
        const delta = Math.min(prev, falloff * strength);
        if (delta > 0.001) {
          rime[idx] = prev - delta;
          meltedSum += delta;
          cellCount++;
        }
      }
    }

    if (meltedSum > 0.004) {
      // Leave an instant glossy wet sticky syrup sheen right where the freezer frost just melted!
      const filmBoost = Math.min(0.34, (meltedSum / Math.max(8, cellCount * 0.35)) * 0.32);
      deposit(uW, vC, filmBoost, 2);
    }

    return cellCount > 0 ? meltedSum / Math.max(10, Math.sqrt(cellCount) * 3.2) : 0;
  }

  function meltFrostSegment(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    strength = 0.92,
    radius = 0.068,
  ): FrostMeltSample[] {
    let du = u1 - u0;
    if (du > 0.5) du -= 1;
    if (du < -0.5) du += 1;
    const dv = v1 - v0;
    const dist = Math.hypot(du * 1.4, dv);
    const steps = clamp(Math.ceil(dist / 0.018), 1, 10);
    const out: FrostMeltSample[] = [];
    let anyChanged = false;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = (u0 + du * t + 1) % 1;
      const v = clamp(v0 + dv * t, 0.01, 0.99);
      const melted = stampMeltFrost(u, v, strength, radius);
      if (melted > 0.008) {
        anyChanged = true;
        out.push({ u, v, melted });
      }
    }

    if (anyChanged) {
      packRimeTexture();
      packTexture();
    }
    return out;
  }

  function sampleThickness(uNorm: number, vNorm: number): number {
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const fu = uW * FILM_U;
    const fv = vC * (FILM_V - 1);
    const iu0 = Math.floor(fu) % FILM_U;
    const iu1 = (iu0 + 1) % FILM_U;
    const iv0 = Math.min(FILM_V - 1, Math.floor(fv));
    const iv1 = Math.min(FILM_V - 1, iv0 + 1);
    const tu = fu - Math.floor(fu);
    const tv = fv - iv0;
    const a = h[iv0 * FILM_U + iu0] * (1 - tu) + h[iv0 * FILM_U + iu1] * tu;
    const b = h[iv1 * FILM_U + iu0] * (1 - tu) + h[iv1 * FILM_U + iu1] * tu;
    return a * (1 - tv) + b * tv;
  }

  function deposit(uNorm: number, vNorm: number, amount: number, radiusCells = 2) {
    const uW = ((uNorm % 1) + 1) % 1;
    const vC = clamp(vNorm, 0, 1);
    const cu = Math.floor(uW * FILM_U) % FILM_U;
    const cv = Math.min(FILM_V - 1, Math.floor(vC * (FILM_V - 1)));
    const r2 = radiusCells * radiusCells + 0.5;
    for (let dv = -radiusCells; dv <= radiusCells; dv++) {
      const iv = cv + dv;
      if (iv < 0 || iv >= FILM_V) continue;
      for (let du = -radiusCells; du <= radiusCells; du++) {
        const d2 = du * du + dv * dv;
        if (d2 > r2) continue;
        const w = Math.exp(-d2 / (radiusCells * 0.9 + 0.5));
        const iu = (cu + du + FILM_U) % FILM_U;
        const idx = iv * FILM_U + iu;
        h[idx] = Math.min(1.4, h[idx] + amount * w);
        wetMem[idx] = Math.min(1.0, wetMem[idx] + amount * w * 1.4);
      }
    }
  }

  function smoothPass(src: Float32Array, dst: Float32Array) {
    for (let iv = 0; iv < FILM_V; iv++) {
      const ivD = Math.max(0, iv - 1);
      const ivU = Math.min(FILM_V - 1, iv + 1);
      for (let iu = 0; iu < FILM_U; iu++) {
        const iuL = (iu - 1 + FILM_U) % FILM_U;
        const iuR = (iu + 1) % FILM_U;
        const c = src[iv * FILM_U + iu];
        const n = src[ivU * FILM_U + iu];
        const s = src[ivD * FILM_U + iu];
        const l = src[iv * FILM_U + iuL];
        const r = src[iv * FILM_U + iuR];
        dst[iv * FILM_U + iu] = c * 0.40 + (n + s + l + r) * 0.15;
      }
    }
  }

  function packTexture() {
    // 1 Gaussian smoothing pass + hardware bilinear filtering keeps liquid glaze lobes silky-smooth at ~3x lower CPU cost!
    smoothPass(h, hSmoothB);

    for (let iv = 0; iv < FILM_V; iv++) {
      const ivD = Math.max(0, iv - 1);
      const ivU = Math.min(FILM_V - 1, iv + 1);
      for (let iu = 0; iu < FILM_U; iu++) {
        const iuL = (iu - 1 + FILM_U) % FILM_U;
        const iuR = (iu + 1) % FILM_U;

        const idx = iv * FILM_U + iu;
        const hC = hSmoothB[idx];

        const hTL = hSmoothB[ivU * FILM_U + iuL];
        const hT = hSmoothB[ivU * FILM_U + iu];
        const hTR = hSmoothB[ivU * FILM_U + iuR];
        const hL = hSmoothB[iv * FILM_U + iuL];
        const hR = hSmoothB[iv * FILM_U + iuR];
        const hBL = hSmoothB[ivD * FILM_U + iuL];
        const hB = hSmoothB[ivD * FILM_U + iu];
        const hBR = hSmoothB[ivD * FILM_U + iuR];

        const dhdu = ((hTR + 2 * hR + hBR) - (hTL + 2 * hL + hBL)) * 0.125;
        const dhdv = ((hTL + 2 * hT + hTR) - (hBL + 2 * hB + hBR)) * 0.125;

        const o = idx * 4;
        texData[o] = clamp(Math.round(hC * 255), 0, 255);
        texData[o + 1] = clamp(Math.round((0.5 + clamp(dhdu * 3.4, -0.5, 0.5)) * 255), 0, 255);
        texData[o + 2] = clamp(Math.round((0.5 + clamp(dhdv * 3.4, -0.5, 0.5)) * 255), 0, 255);
        texData[o + 3] = clamp(Math.round(wetMem[idx] * 255), 0, 255);
      }
    }
    texture.needsUpdate = true;
  }

  function seedInitialFilm() {
    h.fill(0);
    wetMem.fill(0);
    bottomFlux.fill(0);
    stickWetness = 0.0;

    // Seed ridge-premelted freezer frost first, then prime subtle wet sheen strictly on the premelted ridges!
    syncRimeToMelt(0.035);

    for (let iv = 0; iv < FILM_V; iv++) {
      const rIv = Math.min(RIME_V - 1, iv * 2);
      for (let iu = 0; iu < FILM_U; iu++) {
        const idx = iv * FILM_U + iu;
        const rIdx = rIv * RIME_U + ((iu * 2) % RIME_U);
        const r = rough[idx];
        const premeltWet = clamp(1.0 - rime[rIdx], 0, 1);
        const baseDamp = 0.014 + 0.020 * (1 - r);
        h[idx] = baseDamp + premeltWet * 0.11;
        wetMem[idx] = clamp(baseDamp * 0.8 + premeltWet * 0.42, 0, 0.55);
      }
    }
    packTexture();
  }

  function reset() {
    seedInitialFilm();
  }

  function update(state: MeltFieldState, dt: number, meltSpeedMul: number) {
    bottomFlux.fill(0);
    if (dt <= 0) {
      return;
    }

    const { yTop, yBot, iceGone } = getMeltBounds(state.melt);
    if (iceGone) {
      stickWetness = 1.0;
      return;
    }

    const meltRate = (1.0 + state.melt * 2.4) * meltSpeedMul;
    const substeps = 1;
    const subDt = Math.min(0.033, dt);

    const halfW = POPSICLE.halfWidthBottom * (1.0 - clamp(state.melt, 0, 1) * 0.45);

    for (let step = 0; step < substeps; step++) {
      // 1. Source term: pulsing viscous syrup surges along the upper dome & warmed shoulders/ridges
      //    so thick cohesive sticky glaze sheets roll organically down over the sweating ice beneath!
      const tWave = state.time * 0.42;
      for (let iv = 0; iv < FILM_V; iv++) {
        const v = iv / (FILM_V - 1);
        const wy = yBot + (yTop - yBot) * v;
        const domeFeed = smoothstep(0.42, 0.95, v);

        for (let iu = 0; iu < FILM_U; iu++) {
          const idx = iv * FILM_U + iu;
          const theta = (iu / FILM_U) * Math.PI * 2;
          const wx = Math.sin(theta) * halfW;
          const isFront = Math.cos(theta) > -0.15;

          // Multi-lobe slow pulsing surge creates real undulating sticky glaze wave fronts (like macro melt timelapse!)
          const pulseA = 0.5 + 0.5 * Math.sin(tWave + theta * 2.0 + rough[idx] * 4.8);
          const pulseB = 0.5 + 0.5 * Math.cos(tWave * 0.68 - theta * 3.0 + v * 3.6);
          const surge = Math.pow(pulseA * 0.62 + pulseB * 0.38, 1.55);

          let meltSource =
            (0.0045 + domeFeed * (0.016 + 0.036 * surge)) *
            meltRate *
            (0.68 + 0.64 * (1 - rough[idx]));

          // Pointer warmth pours freshly melted glossy berry syrup directly into the surface liquid film!
          if (isFront && state.pointerHeat > 0.01) {
            const dx = wx - state.pointerX;
            const dy = wy - state.pointerY;
            const d2 = dx * dx + dy * dy;
            if (d2 < 0.28) {
              const wPtr = Math.exp(-d2 / 0.065) * state.pointerHeat;
              meltSource += wPtr * 0.42 * meltSpeedMul;
            }
          }

          // Persistent warm spots gently keep weeping meltwater
          if (isFront && state.heatSpots.length > 0) {
            const lh = sampleLocalHeat(wx, wy, state);
            if (lh > 0.02) {
              meltSource += lh * 0.042 * meltSpeedMul;
            }
          }

          h[idx] = Math.min(1.48, h[idx] + meltSource * subDt);
          hNext[idx] = h[idx];
        }
      }

      // 2. Nonlinear viscous gravity lubrication flow (Huppert roll-wave shock fronts: q ∝ max(0, h - h_pin)^2.3!)
      //    + surface-tension lateral cohesion & micro-roughness fingering!
      const hPinBase = 0.21;
      const gravCoeff = 3.35 * (0.85 + state.melt * 0.80);
      const latDiffCoeff = 0.32;
      const steerCoeff = 0.68;

      for (let iv = 0; iv < FILM_V; iv++) {
        const v = iv / (FILM_V - 1);
        // Gravity tangent component is gentler on top flat dome, full on vertical walls
        const gravSlope = 0.45 + 0.55 * smoothstep(1.0, 0.76, v);

        for (let iu = 0; iu < FILM_U; iu++) {
          const idx = iv * FILM_U + iu;
          const hC = h[idx];
          if (hC <= 0.002) continue;

          // Pre-wetted paths have noticeably lower pinning threshold -> incoming glaze surges along wet trails!
          const wMem = wetMem[idx];
          const hPin = hPinBase * (0.72 + 0.52 * rough[idx]) * (1.0 - wMem * 0.45);
          const excess = hC - hPin;

          // A) Nonlinear downhill viscous lobe flux (creates distinct bulging sticky glaze fronts & viscous tongues!)
          if (excess > 0) {
            const mobility = Math.pow(excess, 2.30) * (0.52 + 0.98 * (1.0 - rough[idx])) * (1.0 + wMem * 0.90);
            let qDown = gravCoeff * gravSlope * mobility * subDt;
            qDown = Math.min(qDown, hC * 0.44);

            hNext[idx] -= qDown;

            if (iv > 0) {
              // Slight organic meandering split around frost bumps & toward wetter neighboring column!
              const iuL = (iu - 1 + FILM_U) % FILM_U;
              const iuR = (iu + 1) % FILM_U;
              const idxDL = (iv - 1) * FILM_U + iuL;
              const idxD = (iv - 1) * FILM_U + iu;
              const idxDR = (iv - 1) * FILM_U + iuR;

              const wetPull = (wetMem[idxDR] - wetMem[idxDL]) * 0.35;
              const roughPush = -roughGradU[idx] * steerCoeff;
              const bias = clamp(wetPull + roughPush, -0.34, 0.34);

              const wR = Math.max(0.06, 0.14 + bias * 0.42);
              const wL = Math.max(0.06, 0.14 - bias * 0.42);
              const wC = 1.0 - wL - wR;

              hNext[idxDL] += qDown * wL;
              hNext[idxD] += qDown * wC;
              hNext[idxDR] += qDown * wR;
            } else {
              // Drained right off the bottom lip -> feeds hanging bottom pendant drops & wooden stick runoff!
              bottomFlux[iu] += qDown;
            }
          }

          // B) Smooth lateral capillary leveling / spreading so lobes stay cohesive, thick, and liquid-smooth!
          const iuL = (iu - 1 + FILM_U) % FILM_U;
          const iuR = (iu + 1) % FILM_U;
          const idxL = iv * FILM_U + iuL;
          const idxR = iv * FILM_U + iuR;
          const lapU = h[idxL] + h[idxR] - 2.0 * hC;
          // Only spread where wet enough (keeps dry/frost edges crisp like `frame_0065 -> 0069`!)
          const spreadFactor = smoothstep(0.06, 0.32, hC);
          const dLat = clamp(latDiffCoeff * spreadFactor * lapU * subDt, -hC * 0.18, 0.18);
          hNext[idx] += dLat;
        }
      }

      // 3. Commit step & update damp glossy surface memory (leaves lasting wet tracks where glaze flowed!)
      const memDecay = Math.exp(-subDt * 0.045);
      for (let i = 0; i < N; i++) {
        const val = clamp(hNext[i], 0, 1.45);
        h[i] = val;
        wetMem[i] = Math.max(wetMem[i] * memDecay, smoothstep(0.10, 0.42, val));
      }
    }

    // Melt remaining freezer hoarfrost INWARD from the 3 raised vertical ridges, outer bevels & any pointer-wiped edges
    // (purely ridge-first + thermal front propagation — ZERO top->down wipe!)
    if (avgRime > 0.001) {
      rimePrev.set(rime);
      const baseErode = (0.022 + smoothstep(0.04, 0.24, state.melt) * 0.34) * meltSpeedMul * dt;
      const fullClear = smoothstep(0.20, 0.30, state.melt);
      for (let iv = 0; iv < RIME_V; iv++) {
        const ivD = Math.max(0, iv - 1);
        const ivU = Math.min(RIME_V - 1, iv + 1);
        const fIv = Math.min(FILM_V - 1, iv >> 1);
        for (let iu = 0; iu < RIME_U; iu++) {
          const idx = iv * RIME_U + iu;
          const prev = rimePrev[idx];
          if (prev <= 0) continue;

          const iuL = (iu - 1 + RIME_U) % RIME_U;
          const iuR = (iu + 1) % RIME_U;
          // Inward-creeping thaw front: frost cells bordering already-melted ridges or pointer trails melt much faster!
          const thawedNeighbors =
            (rimePrev[iv * RIME_U + iuL] < 0.35 ? 1 : 0) +
            (rimePrev[iv * RIME_U + iuR] < 0.35 ? 1 : 0) +
            (rimePrev[ivD * RIME_U + iu] < 0.35 ? 1 : 0) +
            (rimePrev[ivU * RIME_U + iu] < 0.35 ? 1 : 0);
          const edgeCreep = thawedNeighbors * 0.45;

          const ridgeBias = 0.10 + 2.35 * ridgeField[idx] + edgeCreep * 1.35;
          const hHere = h[fIv * FILM_U + (iu >> 1)];
          const glazeErode = smoothstep(0.14, 0.38, hHere) * 0.48 * dt;
          const patternEase = 1.24 - 0.48 * rimePattern[idx];
          const next = prev - (baseErode * ridgeBias * patternEase + glazeErode + fullClear * 0.95 * dt);
          rime[idx] = next > 0.002 ? next : 0;
        }
      }
      packRimeTexture();
    }

    // Track total bottom drainage into glossy wet berry-syrup creeping progressively down the wooden stick!
    let totalDrain = 0;
    for (let iu = 0; iu < FILM_U; iu++) totalDrain += bottomFlux[iu];
    stickWetness = clamp(stickWetness + totalDrain * 0.018 + dt * 0.0025 * meltRate, 0.0, 1.0);

    packTexture();
  }

  function dispose() {
    texture.dispose();
    rimeTexture.dispose();
  }

  seedInitialFilm();

  return {
    texture,
    rimeTexture,
    bottomFlux,
    get stickWetness() {
      return stickWetness;
    },
    get avgRime() {
      return avgRime;
    },
    sampleThickness,
    sampleRime,
    meltFrostSegment,
    syncRimeToMelt,
    deposit,
    reset,
    update,
    dispose,
  };
}
