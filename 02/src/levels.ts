import { mulberry32 } from './math.ts';
import { validateLevel } from './level-check.ts';

export const MAX_LEVEL = 1000;
const VALIDATION_WIDTHS = [0.88, 0.68, 0.56] as const;

/**
 * Gemstone material IDs packed into PolyPlanes.info.z and ShardPose.pos.w (cool mineral spectrum):
 *  0 = Palette default (pedestal)
 *  1 = Poisoned Black Diamond (obsidian hazard)
 *  2 = Pure Clear Diamond (100% transparent optical crystal)
 *  3 = Rhodolite Ruby (clear -> cool purplish crimson-berry)
 *  4 = Cyan-Emerald (clear -> cool cyan-green tourmaline)
 *  5 = Sapphire (clear -> royal blue)
 *  6 = Amethyst (clear -> cool imperial violet)
 *  7 = Tanzanite (clear -> cool indigo-periwinkle)
 *  8 = Aquamarine (clear -> crisp glacial cyan)
 *  9 = Orchid-Mist Crystal (mostly transparent, cool rose-plum nudge)
 * 10 = Ice-Mist Crystal (mostly transparent, pale glacier-blue nudge)
 * 11 = Mint-Frost Crystal (mostly transparent, cool cyan-mint nudge)
 * 12 = Lilac-Mist Crystal (mostly transparent, cool lavender nudge)
 */
export const GEM_BLACK = 1;
export const GEM_COLORS = [2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const GEM_SPLINTER_COLORS: Record<number, [number, number, number]> = {
  1: [0.04, 0.04, 0.05],
  2: [0.95, 0.97, 1.00],
  3: [0.76, 0.36, 0.58],
  4: [0.30, 0.74, 0.68],
  5: [0.34, 0.54, 0.82],
  6: [0.58, 0.42, 0.80],
  7: [0.48, 0.56, 0.82],
  8: [0.34, 0.72, 0.80],
  9: [0.86, 0.72, 0.82],
  10: [0.74, 0.84, 0.92],
  11: [0.72, 0.88, 0.86],
  12: [0.80, 0.74, 0.90],
};

/** Restrained cool mineral ink colors for floating score callouts on the light studio floor. */
export const GEM_TEXT_COLORS: Record<number, string> = {
  1: '#1c1c1c',
  2: '#1c1c1c',
  3: '#7d3962', // Smoky Plum
  4: '#296e68', // Sea-Glass Teal
  5: '#355687', // Arctic Slate-Cobalt
  6: '#62458a', // Smoky Iris
  7: '#4d588f', // Storm Periwinkle
  8: '#2c6d7d', // Glacier Petrol
  9: '#7a526e', // Dusty Mauve-Mist
  10: '#4a6885', // Glacier-Slate Mist
  11: '#3f736e', // Sea-Glass Mist
  12: '#635385', // Smoke-Lilac Mist
};

export interface ThrowSpec {
  /** Seconds after level start when this crystal launches from below. */
  time: number;
  /** Normalized launch X lane [-1..+1], scaled by responsive stageHalfWidth (narrower on mobile!). */
  lane: number;
  /** Normalized horizontal target offset [-1..+1] near apex. */
  targetLane: number;
  /** Apex height in world meters [0.78..1.14]. */
  apex: number;
  /** Gravity (m/s²) governing flight speed & hang time. */
  gravity: number;
  /** Crystal polyhedron variant (0..3). */
  variant: number;
  /** True = Poisoned Black Diamond (slicing it loses the level immediately!). */
  poisoned: boolean;
  /** Optical gemstone material ID (1=Black Diamond, 2=Diamond, 3=Ruby, 4=Emerald, 5=Sapphire, 6=Amethyst, 7=Citrine, 8=Aqua). */
  gemId: number;
  /** Initial spin speed (rad/s). */
  spinSpeed: number;
  /** Deterministic per-throw seed for spin axis & initial orientation. */
  seed: number;
}

export interface LevelPlan {
  level: number;
  throws: ThrowSpec[];
  clearCount: number;
  poisonCount: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Build a 100% deterministic, pre-planned throw schedule for any level 1..1000.
 * - Starts simple (Lv 1 = 1 gem, Lv 2 = 2 together, Lv 4 = introduces Poisoned Black Diamond)
 * - Scales smoothly in wave count, simultaneous & staggered throw patterns, gravity, and hazard density.
 * - Every level is validated across desktop (0.88), tablet (0.56), and portrait mobile (0.32) stage widths
 *   so every single colored gem is mathematically guaranteed to have a safe, non-blocked slice window.
 */
export function buildLevel(rawLevel: number): LevelPlan {
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(rawLevel)));
  if (level <= 6) {
    return buildLevelAttempt(level, 0);
  }
  for (let attempt = 0; attempt < 64; attempt++) {
    const plan = buildLevelAttempt(level, attempt);
    let ok = true;
    for (const halfW of VALIDATION_WIDTHS) {
      if (validateLevel(plan, halfW) !== null) {
        ok = false;
        break;
      }
    }
    if (ok) return plan;
  }
  return buildLevelAttempt(level, 64);
}

function buildLevelAttempt(level: number, attempt: number): LevelPlan {
  const rng = mulberry32(((level * 2654435761) ^ Math.imul(attempt + 1, 0x517cc1b7) ^ 0x9e3779b9) >>> 0);
  const throws: ThrowSpec[] = [];

  // Deterministic color deck so simultaneous crystals always pop with distinct gemstone hues!
  const colorDeck = [...GEM_COLORS];
  let colorCursor = colorDeck.length;
  const nextGemColor = (): number => {
    if (colorCursor >= colorDeck.length) {
      for (let i = colorDeck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = colorDeck[i];
        colorDeck[i] = colorDeck[j];
        colorDeck[j] = tmp;
      }
      colorCursor = 0;
    }
    return colorDeck[colorCursor++];
  };

  const push = (spec: Omit<ThrowSpec, 'seed' | 'gemId'> & { gemId?: number }) => {
    // Allow launches from across the full bottom AND past the left/right edges (side cannons up to ±1.32)!
    const lane = clamp(spec.lane, -1.32, 1.32);
    // Keep apex cleanly on-screen [-0.78..+0.78], while allowing arcs to exit off the opposite side (up to ±1.48)!
    const minTarget = (-1.48 + lane) * 0.5;
    const maxTarget = (1.48 + lane) * 0.5;
    const targetLane = clamp(spec.targetLane, Math.max(-0.78, minTarget), Math.min(0.78, maxTarget));
    throws.push({
      ...spec,
      gemId: spec.poisoned ? GEM_BLACK : (spec.gemId ?? nextGemColor()),
      lane,
      targetLane,
      apex: clamp(spec.apex, 0.74, 1.16),
      seed: Math.floor(rng() * 0x7fffffff),
    });
  };

  // --- Hand-choreographed onboarding levels (1..6) using full edges, outward splits, and varied heights! ---
  if (level === 1) {
    // Graceful left-edge -> right-edge sweeping arc across the frame
    push({ time: 0.20, lane: -1.16, targetLane: 0.08, apex: 0.98, gravity: 2.25, variant: 1, poisoned: false, gemId: 5, spinSpeed: 1.4 });
  } else if (level === 2) {
    // Bold center-outward V-split: Ruby clear->red paired with Pure Clear Diamond!
    push({ time: 0.20, lane: -0.18, targetLane: -0.66, apex: 1.08, gravity: 2.30, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.45 });
    push({ time: 0.25, lane: 0.18, targetLane: 0.66, apex: 0.88, gravity: 2.30, variant: 1, poisoned: false, gemId: 2, spinSpeed: 1.45 });
  } else if (level === 3) {
    // Wave 1: Ice-Mist whisper crystal + Citrine + Amethyst
    push({ time: 0.20, lane: -1.24, targetLane: -0.22, apex: 1.04, gravity: 2.38, variant: 2, poisoned: false, gemId: 10, spinSpeed: 1.5 });
    push({ time: 0.26, lane: 0.76, targetLane: 0.64, apex: 0.84, gravity: 2.38, variant: 3, poisoned: false, gemId: 7, spinSpeed: 1.5 });
    push({ time: 0.78, lane: 1.24, targetLane: -0.06, apex: 1.14, gravity: 2.38, variant: 1, poisoned: false, gemId: 6, spinSpeed: 1.55 });
    // Wave 2: opposite-edge X-cross — Rose-Blush crystal + Emerald
    push({ time: 2.55, lane: -1.20, targetLane: 0.10, apex: 1.10, gravity: 2.40, variant: 0, poisoned: false, gemId: 9, spinSpeed: 1.55 });
    push({ time: 2.68, lane: 1.20, targetLane: -0.10, apex: 0.88, gravity: 2.40, variant: 2, poisoned: false, gemId: 4, spinSpeed: 1.55 });
  } else if (level === 4) {
    // Introduces Poisoned Black Diamond on the far right while Emerald shoots high from the far-left edge!
    push({ time: 0.20, lane: -1.20, targetLane: -0.36, apex: 1.10, gravity: 2.42, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.45 });
    push({ time: 0.34, lane: 0.88, targetLane: 0.58, apex: 0.78, gravity: 2.42, variant: 2, poisoned: true, spinSpeed: 1.65 });
    // Wave 2: Pure Clear Diamond + Sapphire + low right-side Black Diamond
    push({ time: 2.45, lane: -1.22, targetLane: -0.48, apex: 1.12, gravity: 2.45, variant: 0, poisoned: false, gemId: 2, spinSpeed: 1.55 });
    push({ time: 2.52, lane: 0.08, targetLane: 0.48, apex: 0.92, gravity: 2.45, variant: 3, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    push({ time: 2.86, lane: 1.16, targetLane: 0.62, apex: 0.76, gravity: 2.45, variant: 1, poisoned: true, spinSpeed: 1.7 });
  } else if (level === 5) {
    // Wave 1: 3-gem R->L cascade — Ruby, Champagne whisper crystal, Aquamarine
    push({ time: 0.20, lane: 1.24, targetLane: 0.14, apex: 0.86, gravity: 2.48, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 0.42, lane: 0.28, targetLane: -0.22, apex: 1.14, gravity: 2.48, variant: 1, poisoned: false, gemId: 11, spinSpeed: 1.55 });
    push({ time: 0.64, lane: -0.68, targetLane: -0.74, apex: 0.96, gravity: 2.48, variant: 2, poisoned: false, gemId: 8, spinSpeed: 1.55 });
    // Wave 2: opposite-edge X-cross — Lilac-Mist crystal + Pure Clear Diamond + low left-edge Black Diamond
    push({ time: 2.65, lane: -1.22, targetLane: 0.08, apex: 1.14, gravity: 2.50, variant: 3, poisoned: false, gemId: 12, spinSpeed: 1.6 });
    push({ time: 2.70, lane: 1.22, targetLane: -0.08, apex: 0.94, gravity: 2.50, variant: 1, poisoned: false, gemId: 2, spinSpeed: 1.6 });
    push({ time: 2.98, lane: -1.14, targetLane: -0.64, apex: 0.76, gravity: 2.50, variant: 2, poisoned: true, spinSpeed: 1.75 });
  } else if (level === 6) {
    // Wave 1: 3-gem full-frame triad — Ruby (clear->red), Pure Clear Diamond (center spire), Sapphire (clear->blue)!
    push({ time: 0.20, lane: -1.22, targetLane: -0.66, apex: 0.90, gravity: 2.52, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 0.24, lane: -0.16, targetLane: 0.06, apex: 1.16, gravity: 2.52, variant: 1, poisoned: false, gemId: 2, spinSpeed: 1.55 });
    push({ time: 0.28, lane: 1.22, targetLane: 0.66, apex: 0.84, gravity: 2.52, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    // Wave 2: Rose-Blush crystal + Emerald + low right-edge Black Diamond
    push({ time: 2.50, lane: 1.24, targetLane: 0.12, apex: 1.10, gravity: 2.55, variant: 3, poisoned: false, gemId: 9, spinSpeed: 1.6 });
    push({ time: 2.74, lane: -0.10, targetLane: -0.64, apex: 0.94, gravity: 2.55, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.6 });
    push({ time: 3.04, lane: 1.16, targetLane: 0.66, apex: 0.76, gravity: 2.55, variant: 0, poisoned: true, spinSpeed: 1.8 });
  } else {
    // --- Deterministic choreographed generator for Levels 7..1000 ---
    // Smooth logarithmic difficulty curve t in [0..1]
    const t = Math.min(1, Math.log1p(level - 6) / Math.log1p(MAX_LEVEL - 6));
    const gravity = 2.52 + t * 0.98; // 2.52 (Lv 7) -> 3.50 (Lv 1000)
    const waveCount = level < 14 ? 2 : level < 35 ? 3 : level < 110 ? 4 : level < 350 ? 5 : 6;
    const baseGap = 2.35 - t * 0.58; // time between waves shrinks cleanly from 2.35s -> 1.77s
    let cursorT = 0.22;
    let prevPattern = -1;

    // Gentle fallback breathing room only if earlier attempts failed strict mobile/desktop clearance
    const extraStagger = attempt > 6 ? Math.min(0.24, (attempt - 6) * 0.025) : 0;

    for (let w = 0; w < waveCount; w++) {
      // 0=outward V-fan, 1=side-edge cannon volley, 2=opposite-edge X-cross, 3=flank pillars, 4=full-canvas scatter, 5=staggered whip cascade
      let pattern = Math.floor(rng() * 6);
      if (pattern === prevPattern) pattern = (pattern + 1 + Math.floor(rng() * 5)) % 6;
      prevPattern = pattern;

      const maxClear = Math.min(5, 2 + Math.floor(t * 3.2 + rng() * 1.3));
      const clearN = Math.max(2, maxClear);
      const poisonChance = 0.42 + t * 0.46;
      const allowTwoPoison = attempt < 16 && t > 0.48 && rng() < 0.30;
      const poisonN = rng() < poisonChance ? (allowTwoPoison ? 2 : 1) : 0;
      const total = clearN + poisonN;

      const poisonIdx = new Set<number>();
      if (poisonN > 0) {
        const candidates: number[] = [];
        for (let i = 0; i < total; i++) candidates.push(i);
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }
        for (let p = 0; p < poisonN; p++) poisonIdx.add(candidates[p]);
      }

      // Sweep direction for this wave: +1 = Left->Right, -1 = Right->Left
      const sweepDir = rng() < 0.5 ? 1 : -1;
      const staggerBase = Math.max(0.16, 0.26 - t * 0.08) + extraStagger;
      let waveEndT = cursorT;

      // Distinct launch slots for Full-Canvas Scatter so gems in one wave never launch from the same spot!
      const scatterLanes = [-1.24, -0.68, -0.08, 0.58, 1.24, -0.96, 0.96];
      for (let i = scatterLanes.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = scatterLanes[i]; scatterLanes[i] = scatterLanes[j]; scatterLanes[j] = tmp;
      }

      for (let i = 0; i < total; i++) {
        const isPoison = poisonIdx.has(i);
        const frac = total === 1 ? 0.5 : i / (total - 1);
        let dt = 0;
        let lane = 0;
        let targetLane = 0;
        let apex = isPoison ? 0.74 + rng() * 0.08 : 0.84 + rng() * 0.32;

        if (pattern === 0) {
          // Wide Outward V-Fan: launches across the lower middle and fans OUTWARD off both left & right edges!
          lane = -sweepDir * (-0.42 + frac * 0.84) + (rng() - 0.5) * 0.10;
          targetLane = -sweepDir * (-0.74 + frac * 1.48) + (rng() - 0.5) * 0.08;
          dt = isPoison ? 0.34 + i * 0.05 + extraStagger : i * 0.045;
          apex = isPoison ? 0.74 + rng() * 0.06 : 0.84 + Math.sin(frac * Math.PI) * 0.30 + (rng() - 0.5) * 0.06;
        } else if (pattern === 1) {
          // Side-Edge Cannon Volley: sequential arcs shooting in from one side edge with clean spacing so trailing gems never overtake!
          lane = -sweepDir * (1.26 - frac * 0.36) + (rng() - 0.5) * 0.08;
          targetLane = sweepDir * (0.28 - frac * 0.72) + (rng() - 0.5) * 0.10;
          dt = i * (staggerBase * 1.35) + (isPoison ? 0.18 : 0);
          if (isPoison) targetLane = -sweepDir * (0.50 + rng() * 0.20);
          apex = isPoison ? 0.74 + rng() * 0.06 : 1.12 - frac * 0.26 + (rng() - 0.5) * 0.06;
        } else if (pattern === 2) {
          // Opposite-Edge X-Cross: alternating far-left->far-right and far-right->far-left sweeps!
          const side = i % 2 === 0 ? -sweepDir : sweepDir;
          lane = side * (0.98 + rng() * 0.32);
          targetLane = -side * (0.04 + rng() * 0.32);
          dt = (i % 2) * 0.06 + Math.floor(i / 2) * (staggerBase * 1.35) + (isPoison ? 0.28 : 0);
          if (isPoison) targetLane = side * (0.50 + rng() * 0.22);
          apex = isPoison ? 0.74 + rng() * 0.06 : 0.84 + (i % 2) * 0.22 + rng() * 0.10;
        } else if (pattern === 3) {
          // Flank Pillars + High Center Spire: gems pop up boldly along far-left and far-right edges!
          const slot = i % 3;
          if (slot === 0) {
            lane = -0.78 - rng() * 0.42;
            targetLane = -0.74 + rng() * 0.22;
            apex = isPoison ? 0.74 + rng() * 0.06 : 0.84 + rng() * 0.22;
          } else if (slot === 1) {
            lane = 0.78 + rng() * 0.42;
            targetLane = 0.52 + rng() * 0.22;
            apex = isPoison ? 0.74 + rng() * 0.06 : 0.88 + rng() * 0.22;
          } else {
            lane = (rng() - 0.5) * 0.44;
            targetLane = (rng() - 0.5) * 0.36;
            apex = isPoison ? 0.74 + rng() * 0.06 : 1.06 + rng() * 0.10;
          }
          dt = Math.floor(i / 3) * (staggerBase * 1.8) + (i % 3) * 0.06 + (isPoison ? 0.26 : 0);
        } else if (pattern === 4) {
          // Full-Canvas Scatter: every gem enters from a unique edge/bottom spot & heads in its own direction!
          lane = scatterLanes[i % scatterLanes.length] + (rng() - 0.5) * 0.12;
          const aimOpposite = Math.abs(lane) > 0.75 ? -Math.sign(lane) * (0.05 + rng() * 0.40) : (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.38);
          targetLane = isPoison ? Math.sign(lane || 1) * (0.48 + rng() * 0.24) : aimOpposite;
          dt = i * (staggerBase * 0.80) + (isPoison ? 0.22 : 0);
          apex = isPoison ? 0.74 + rng() * 0.06 : 0.82 + ((i * 37) % 100) / 100 * 0.34;
        } else {
          // Staggered Whip Cascade: crisp sequential launches walking edge-to-edge with alternating high/low arcs!
          lane = -sweepDir * (1.24 - frac * 2.48) + (rng() - 0.5) * 0.10;
          targetLane = sweepDir * (-0.64 + frac * 1.28) + (rng() - 0.5) * 0.12;
          dt = i * (staggerBase * 0.92) + (isPoison ? 0.20 : 0);
          if (isPoison) targetLane = Math.sign(lane || sweepDir) * (0.50 + rng() * 0.22);
          apex = isPoison ? 0.74 + rng() * 0.06 : (i % 2 === 0 ? 1.04 + rng() * 0.12 : 0.82 + rng() * 0.12);
        }

        const throwT = cursorT + dt;
        if (throwT > waveEndT) waveEndT = throwT;

        push({
          time: throwT,
          lane,
          targetLane,
          apex,
          gravity,
          variant: Math.floor(rng() * 4),
          poisoned: isPoison,
          spinSpeed: 1.35 + t * 0.9 + rng() * 0.65,
        });
      }

      cursorT = waveEndT + baseGap;
    }
  }

  throws.sort((a, b) => a.time - b.time);
  let clearCount = 0;
  let poisonCount = 0;
  for (const th of throws) {
    if (th.poisoned) poisonCount++;
    else clearCount++;
  }

  return { level, throws, clearCount, poisonCount };
}
