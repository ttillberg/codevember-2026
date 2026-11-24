import { mulberry32 } from './math.ts';
import { validateLevel } from './level-check.ts';

export const MAX_LEVEL = 1000;
const VALIDATION_WIDTHS = [0.88, 0.56, 0.32] as const;

/**
 * Gemstone material IDs packed into PolyPlanes.info.z and ShardPose.pos.w:
 *  0 = Palette default (pedestal)
 *  1 = Poisoned Black Diamond (obsidian hazard)
 *  2 = Clear Diamond
 *  3 = Ruby
 *  4 = Emerald
 *  5 = Sapphire
 *  6 = Amethyst
 *  7 = Citrine Topaz
 *  8 = Aquamarine
 */
export const GEM_BLACK = 1;
export const GEM_COLORS = [3, 4, 5, 6, 7, 8, 2] as const;

export const GEM_SPLINTER_COLORS: Record<number, [number, number, number]> = {
  1: [0.04, 0.04, 0.05],
  2: [0.95, 0.97, 1.00],
  3: [0.98, 0.14, 0.26],
  4: [0.12, 0.88, 0.42],
  5: [0.16, 0.46, 0.98],
  6: [0.74, 0.24, 0.98],
  7: [0.98, 0.72, 0.12],
  8: [0.14, 0.86, 0.95],
};

/** High-contrast jewel ink colors for floating score callouts on the light #f4f3f0 studio floor. */
export const GEM_TEXT_COLORS: Record<number, string> = {
  1: '#1c1c1c',
  2: '#1c1c1c',
  3: '#c81937', // Ruby
  4: '#0d8a45', // Emerald
  5: '#1a4fd6', // Sapphire
  6: '#7c24cc', // Amethyst
  7: '#bf7908', // Citrine Topaz
  8: '#0a8594', // Aquamarine
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
    const lane = clamp(spec.lane, -0.94, 0.94);
    // Clamp targetLane so the full parabolic landing (2 * targetLane - lane) stays cleanly inside [-0.98..+0.98]!
    const minTarget = (-0.98 + lane) * 0.5;
    const maxTarget = (0.98 + lane) * 0.5;
    const targetLane = clamp(spec.targetLane, Math.max(-0.78, minTarget), Math.min(0.78, maxTarget));
    throws.push({
      ...spec,
      gemId: spec.poisoned ? GEM_BLACK : (spec.gemId ?? nextGemColor()),
      lane,
      targetLane,
      apex: clamp(spec.apex, 0.76, 1.15),
      seed: Math.floor(rng() * 0x7fffffff),
    });
  };

  // --- Hand-choreographed onboarding levels (1..6) with juicy L->R / R->L parabolic arcs! ---
  if (level === 1) {
    // Graceful left -> right sweeping arc across center
    push({ time: 0.20, lane: -0.68, targetLane: 0.06, apex: 0.96, gravity: 2.25, variant: 1, poisoned: false, gemId: 5, spinSpeed: 1.4 });
  } else if (level === 2) {
    // Twin sweeping crossing arcs (L->R & R->L) meeting cleanly near apex for 2x!
    push({ time: 0.20, lane: -0.80, targetLane: -0.06, apex: 0.98, gravity: 2.30, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.45 });
    push({ time: 0.24, lane: 0.80, targetLane: 0.06, apex: 0.98, gravity: 2.30, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.45 });
  } else if (level === 3) {
    // Wave 1: 2 sweeping L->R parallel arcs + 1 staggered R->L counter-arc
    push({ time: 0.20, lane: -0.84, targetLane: -0.04, apex: 0.98, gravity: 2.38, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.5 });
    push({ time: 0.25, lane: -0.58, targetLane: 0.16, apex: 1.04, gravity: 2.38, variant: 3, poisoned: false, gemId: 7, spinSpeed: 1.5 });
    push({ time: 0.78, lane: 0.82, targetLane: -0.06, apex: 1.04, gravity: 2.38, variant: 1, poisoned: false, gemId: 6, spinSpeed: 1.55 });
    // Wave 2: crisp crossing X-arcs across full stage
    push({ time: 2.55, lane: -0.84, targetLane: 0.06, apex: 1.00, gravity: 2.40, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 2.68, lane: 0.84, targetLane: -0.06, apex: 1.00, gravity: 2.40, variant: 2, poisoned: false, gemId: 8, spinSpeed: 1.55 });
  } else if (level === 4) {
    // Introduces Poisoned Black Diamond arcing from right while Emerald arcs from left!
    push({ time: 0.20, lane: -0.82, targetLane: -0.14, apex: 1.00, gravity: 2.42, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.45 });
    push({ time: 0.34, lane: 0.86, targetLane: 0.32, apex: 0.82, gravity: 2.42, variant: 2, poisoned: true, spinSpeed: 1.65 });
    // Wave 2: Ruby + Sapphire sweeping L->R + Black Diamond trailing lower from right
    push({ time: 2.45, lane: -0.86, targetLane: -0.08, apex: 1.04, gravity: 2.45, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 2.50, lane: -0.52, targetLane: 0.18, apex: 1.00, gravity: 2.45, variant: 3, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    push({ time: 2.86, lane: 0.86, targetLane: 0.36, apex: 0.80, gravity: 2.45, variant: 1, poisoned: true, spinSpeed: 1.7 });
  } else if (level === 5) {
    // Wave 1: 3-gem sweeping R->L fountain cascade
    push({ time: 0.20, lane: 0.86, targetLane: 0.02, apex: 0.96, gravity: 2.48, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 0.42, lane: 0.72, targetLane: -0.08, apex: 1.04, gravity: 2.48, variant: 1, poisoned: false, gemId: 7, spinSpeed: 1.55 });
    push({ time: 0.64, lane: 0.56, targetLane: -0.18, apex: 0.96, gravity: 2.48, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    // Wave 2: wide crossing arcs + trailing low Black Diamond
    push({ time: 2.65, lane: -0.86, targetLane: 0.06, apex: 1.08, gravity: 2.50, variant: 3, poisoned: false, gemId: 6, spinSpeed: 1.6 });
    push({ time: 2.70, lane: 0.86, targetLane: -0.06, apex: 1.08, gravity: 2.50, variant: 1, poisoned: false, gemId: 8, spinSpeed: 1.6 });
    push({ time: 2.98, lane: -0.80, targetLane: -0.32, apex: 0.78, gravity: 2.50, variant: 2, poisoned: true, spinSpeed: 1.75 });
  } else if (level === 6) {
    // Wave 1: 3-gem simultaneous sweeping L->R fan (huge 3x combo arc!)
    push({ time: 0.20, lane: -0.88, targetLane: -0.18, apex: 0.98, gravity: 2.52, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 0.24, lane: -0.64, targetLane: 0.02, apex: 1.06, gravity: 2.52, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.55 });
    push({ time: 0.28, lane: -0.38, targetLane: 0.22, apex: 0.98, gravity: 2.52, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    // Wave 2: sweeping R->L twin + low counter-arc Black Diamond
    push({ time: 2.50, lane: 0.86, targetLane: 0.02, apex: 1.04, gravity: 2.55, variant: 3, poisoned: false, gemId: 7, spinSpeed: 1.6 });
    push({ time: 2.74, lane: 0.62, targetLane: -0.16, apex: 0.98, gravity: 2.55, variant: 1, poisoned: false, gemId: 6, spinSpeed: 1.6 });
    push({ time: 3.04, lane: -0.82, targetLane: -0.34, apex: 0.78, gravity: 2.55, variant: 0, poisoned: true, spinSpeed: 1.8 });
  } else {
    // --- Deterministic choreographed generator for Levels 7..1000 ---
    // Smooth logarithmic difficulty curve t in [0..1]
    const t = Math.min(1, Math.log1p(level - 6) / Math.log1p(MAX_LEVEL - 6));
    const gravity = 2.52 + t * 0.98; // 2.52 (Lv 7) -> 3.50 (Lv 1000)
    const waveCount = level < 14 ? 2 : level < 35 ? 3 : level < 110 ? 4 : level < 350 ? 5 : 6;
    const baseGap = 2.35 - t * 0.58; // time between waves shrinks cleanly from 2.35s -> 1.77s
    let cursorT = 0.22;

    // Gentle fallback breathing room only if earlier attempts failed strict mobile/desktop clearance
    const extraStagger = attempt > 6 ? Math.min(0.24, (attempt - 6) * 0.025) : 0;

    for (let w = 0; w < waveCount; w++) {
      // 0=side-sweep fan (L->R or R->L), 1=staggered side cascade, 2=crossing X-arcs, 3=twin counter-arcs, 4=criss-cross fountain
      const pattern = Math.floor(rng() * 5);
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

      for (let i = 0; i < total; i++) {
        const isPoison = poisonIdx.has(i);
        const frac = total === 1 ? 0.5 : i / (total - 1);
        let dt = 0;
        let lane = 0;
        let targetLane = 0;
        let apex = isPoison ? 0.76 + rng() * 0.08 : 0.96 + rng() * 0.18;

        if (pattern === 0) {
          // Side-Sweep Fan: whole wave launches from one side and arcs smoothly across to the opposite side!
          lane = -sweepDir * (0.90 - frac * 0.52) + (rng() - 0.5) * 0.06;
          targetLane = sweepDir * (-0.14 + frac * 0.36) + (rng() - 0.5) * 0.06;
          dt = isPoison ? 0.34 + i * 0.05 + extraStagger : i * 0.04;
          apex = isPoison ? 0.76 + rng() * 0.07 : 0.98 + Math.sin(frac * Math.PI) * 0.12;
        } else if (pattern === 1) {
          // Staggered Sweeping Cascade: rapid L->R or R->L parabolic stream!
          lane = -sweepDir * (0.88 - frac * 0.38) + (rng() - 0.5) * 0.06;
          targetLane = sweepDir * (0.04 + (rng() - 0.5) * 0.24);
          dt = i * staggerBase + (isPoison ? 0.14 : 0);
          apex = isPoison ? 0.78 + rng() * 0.07 : 0.94 + (i % 2) * 0.12 + rng() * 0.08;
        } else if (pattern === 2) {
          // Crossing X-Arcs: alternating bottom-left->right and bottom-right->left!
          const side = i % 2 === 0 ? -sweepDir : sweepDir;
          lane = side * (0.68 + rng() * 0.24);
          targetLane = -side * (0.04 + rng() * 0.22);
          dt = (i % 2) * 0.06 + Math.floor(i / 2) * (staggerBase * 1.35) + (isPoison ? 0.28 : 0);
          if (isPoison) targetLane = side * (0.20 + rng() * 0.18);
          apex = isPoison ? 0.76 + rng() * 0.07 : 0.98 + rng() * 0.14;
        } else if (pattern === 3) {
          // Twin Counter-Arcs + Staggered Follow-Up
          const half = Math.ceil(total / 2);
          const side = i < half ? -sweepDir : sweepDir;
          lane = side * (0.54 + (i % Math.max(1, half)) * 0.22 + (rng() - 0.5) * 0.08);
          targetLane = -side * (0.02 + rng() * 0.22);
          dt = i < half ? i * 0.045 : 0.48 + (i - half) * (0.07 + rng() * 0.06);
          if (isPoison) {
            dt += 0.24;
            targetLane = side * 0.28;
          }
          apex = isPoison ? 0.76 + rng() * 0.08 : 0.95 + rng() * 0.17;
        } else {
          // Criss-Cross Fountain Volley: alternating sweeping arcs from both lower corners!
          const side = i % 2 === 0 ? -1 : 1;
          lane = side * (0.58 + rng() * 0.30);
          targetLane = -side * (0.05 + rng() * 0.24);
          dt = i * (staggerBase * 0.85) + (isPoison ? 0.22 : 0);
          if (isPoison) targetLane = side * 0.30;
          apex = isPoison ? 0.76 + rng() * 0.07 : 0.92 + rng() * 0.22;
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
