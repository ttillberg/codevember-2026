import * as THREE from 'three';
import { clamp, fbm3, smoothstep } from './rng';
import { getMeltBounds, MeltFieldState, POPSICLE, sampleLocalHeat } from './shape';

export const FILM_U = 64;
const FILM_V = 64;

export interface LiquidFilmSystem {
  /**
   * 96x96 DataTexture (RepeatWrapping in S, ClampToEdge in T, LinearFilter):
   *   R = liquid glaze thickness h [0..1]
   *   G = precomputed smooth horizontal meniscus slope (0.5 + 0.5 * dh/du)
   *   B = precomputed smooth vertical meniscus slope (0.5 + 0.5 * dh/dv)
   *   A = damp wet trace memory [0..1] (stays glossy after a liquid lobe flows past!)
   */
  texture: THREE.DataTexture;
  /** Accumulated bottom-rim drainage flux per column u ∈ [0..FILM_U-1] during last step */
  bottomFlux: Float32Array;
  /** How far glossy berry-syrup runoff has crept down the wooden stick [0..1] */
  stickWetness: number;
  /** Sample liquid thickness h at (uNorm ∈ [0,1), vNorm ∈ [0,1]) */
  sampleThickness(uNorm: number, vNorm: number): number;
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

  for (let iv = 0; iv < FILM_V; iv++) {
    for (let iu = 0; iu < FILM_U; iu++) {
      const iuL = (iu - 1 + FILM_U) % FILM_U;
      const iuR = (iu + 1) % FILM_U;
      roughGradU[iv * FILM_U + iu] = rough[iv * FILM_U + iuR] - rough[iv * FILM_U + iuL];
    }
  }

  let stickWetness = 0.0;

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
        texData[o + 1] = clamp(Math.round((0.5 + clamp(dhdu * 2.2, -0.5, 0.5)) * 255), 0, 255);
        texData[o + 2] = clamp(Math.round((0.5 + clamp(dhdv * 2.2, -0.5, 0.5)) * 255), 0, 255);
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

    // Frame 0: faint initial glistening wet collar at the warm dome shoulders & subtle dampness near bottom rim
    // (preserves the crisp frosted backlit look of reference.jpg while poised to ooze viscous glaze lobes!)
    for (let iv = 0; iv < FILM_V; iv++) {
      const v = iv / (FILM_V - 1);
      for (let iu = 0; iu < FILM_U; iu++) {
        const idx = iv * FILM_U + iu;
        const r = rough[idx];
        const domeGlaze = smoothstep(0.76, 0.96, v) * (0.14 + 0.16 * (1 - r));
        const bottomPool = smoothstep(0.14, 0.01, v) * (0.12 + 0.12 * (1 - r));
        const baseDamp = 0.04 + 0.05 * (1 - r);
        h[idx] = baseDamp + domeGlaze + bottomPool;
        wetMem[idx] = clamp(h[idx] * 1.6, 0, 0.55);
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
      // 1. Source term: slow ambient melt (strongest on warm dome/edges) + intense localized pointer melt!
      for (let iv = 0; iv < FILM_V; iv++) {
        const v = iv / (FILM_V - 1);
        const wy = yBot + (yTop - yBot) * v;
        const domeWarmth = 0.55 + 0.85 * smoothstep(0.45, 0.96, v);

        for (let iu = 0; iu < FILM_U; iu++) {
          const idx = iv * FILM_U + iu;
          const theta = (iu / FILM_U) * Math.PI * 2;
          const wx = Math.sin(theta) * halfW;
          const isFront = Math.cos(theta) > -0.15;

          let meltSource = 0.012 * domeWarmth * meltRate * (0.7 + 0.6 * (1 - rough[idx]));

          // Pointer warmth pours freshly melted glossy berry syrup directly into the surface liquid film!
          if (isFront && state.pointerHeat > 0.01) {
            const dx = wx - state.pointerX;
            const dy = wy - state.pointerY;
            const d2 = dx * dx + dy * dy;
            if (d2 < 0.28) {
              const wPtr = Math.exp(-d2 / 0.065) * state.pointerHeat;
              meltSource += wPtr * 0.34 * meltSpeedMul;
            }
          }

          // Persistent warm spots gently keep weeping meltwater
          if (isFront && state.heatSpots.length > 0) {
            const lh = sampleLocalHeat(wx, wy, state);
            if (lh > 0.02) {
              meltSource += lh * 0.032 * meltSpeedMul;
            }
          }

          h[idx] = Math.min(1.45, h[idx] + meltSource * subDt);
          hNext[idx] = h[idx];
        }
      }

      // 2. Nonlinear viscous gravity lubrication flow (q ∝ max(0, h - h_pin)^2.2!)
      //    + surface-tension lateral cohesion & micro-roughness fingering!
      const hPinBase = 0.14;
      const gravCoeff = 2.65 * (0.85 + state.melt * 0.75);
      const latDiffCoeff = 0.48;
      const steerCoeff = 0.62;

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
          const hPin = hPinBase * (0.72 + 0.52 * rough[idx]) * (1.0 - wMem * 0.48);
          const excess = hC - hPin;

          // A) Nonlinear downhill viscous lobe flux (creates realistic bulging glaze fronts & viscous tongues!)
          if (excess > 0) {
            // Smooth cubic-like viscous mobility (clamped for rock-solid CFL stability!)
            const mobility = Math.pow(excess, 2.05) * (0.55 + 0.95 * (1.0 - rough[idx])) * (1.0 + wMem * 0.85);
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

    // Track total bottom drainage into glossy wet berry-syrup creeping progressively down the wooden stick!
    let totalDrain = 0;
    for (let iu = 0; iu < FILM_U; iu++) totalDrain += bottomFlux[iu];
    stickWetness = clamp(stickWetness + totalDrain * 0.018 + dt * 0.0025 * meltRate, 0.0, 1.0);

    packTexture();
  }

  function dispose() {
    texture.dispose();
  }

  seedInitialFilm();

  return {
    texture,
    bottomFlux,
    get stickWetness() {
      return stickWetness;
    },
    sampleThickness,
    deposit,
    reset,
    update,
    dispose,
  };
}
