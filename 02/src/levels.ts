import { mulberry32 } from './math';

export const MAX_LEVEL = 1000;

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
 * - Starts simple (Lv 1 = 1 clear crystal, Lv 2 = 2 together, Lv 4 = introduces Poisoned Black Diamond)
 * - Scales smoothly in wave count, simultaneous & staggered throw patterns, gravity, and hazard density.
 * - Lanes are normalized [-1..+1] so desktop gets a wide studio stage and portrait mobile stays tightly framed.
 */
export function buildLevel(rawLevel: number): LevelPlan {
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(rawLevel)));
  const rng = mulberry32((level * 2654435761) ^ 0x9e3779b9);
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
    throws.push({
      ...spec,
      gemId: spec.poisoned ? GEM_BLACK : (spec.gemId ?? nextGemColor()),
      lane: clamp(spec.lane, -0.95, 0.95),
      targetLane: clamp(spec.targetLane, -0.88, 0.88),
      apex: clamp(spec.apex, 0.76, 1.15),
      seed: Math.floor(rng() * 0x7fffffff),
    });
  };

  // --- Hand-choreographed onboarding levels (1..6) ---
  if (level === 1) {
    push({ time: 0.20, lane: 0.0, targetLane: 0.0, apex: 0.94, gravity: 2.25, variant: 1, poisoned: false, gemId: 5, spinSpeed: 1.3 });
  } else if (level === 2) {
    // Two vivid gems together (Ruby + Emerald) -> teaches single-stroke 2x multi-hit!
    push({ time: 0.20, lane: -0.48, targetLane: -0.28, apex: 0.96, gravity: 2.30, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.4 });
    push({ time: 0.24, lane: 0.48, targetLane: 0.28, apex: 0.96, gravity: 2.30, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.4 });
  } else if (level === 3) {
    // Wave 1: 2 simultaneous + 1 staggered center follow-up
    push({ time: 0.20, lane: -0.58, targetLane: -0.25, apex: 0.95, gravity: 2.38, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.45 });
    push({ time: 0.24, lane: 0.58, targetLane: 0.25, apex: 0.95, gravity: 2.38, variant: 3, poisoned: false, gemId: 7, spinSpeed: 1.45 });
    push({ time: 0.78, lane: 0.0, targetLane: 0.05, apex: 1.04, gravity: 2.38, variant: 1, poisoned: false, gemId: 6, spinSpeed: 1.5 });
    // Wave 2: 2 crossing crystals
    push({ time: 2.55, lane: -0.72, targetLane: 0.35, apex: 0.98, gravity: 2.40, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.5 });
    push({ time: 2.68, lane: 0.72, targetLane: -0.35, apex: 0.98, gravity: 2.40, variant: 2, poisoned: false, gemId: 8, spinSpeed: 1.5 });
  } else if (level === 4) {
    // Introduces Poisoned Black Diamond cleanly separated from glowing gems!
    push({ time: 0.20, lane: -0.55, targetLane: -0.36, apex: 0.96, gravity: 2.42, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.4 });
    push({ time: 0.28, lane: 0.55, targetLane: 0.42, apex: 0.92, gravity: 2.42, variant: 2, poisoned: true, spinSpeed: 1.6 });
    // Wave 2: Ruby + Sapphire + staggered Black Diamond
    push({ time: 2.45, lane: -0.62, targetLane: -0.28, apex: 1.02, gravity: 2.45, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.5 });
    push({ time: 2.49, lane: 0.08, targetLane: 0.26, apex: 1.00, gravity: 2.45, variant: 3, poisoned: false, gemId: 5, spinSpeed: 1.5 });
    push({ time: 2.74, lane: 0.72, targetLane: 0.56, apex: 0.84, gravity: 2.45, variant: 1, poisoned: true, spinSpeed: 1.7 });
  } else if (level === 5) {
    // Wave 1: 3-gem staggered sweep (Ruby -> Citrine -> Sapphire)
    push({ time: 0.20, lane: -0.74, targetLane: -0.45, apex: 0.95, gravity: 2.48, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.5 });
    push({ time: 0.42, lane: 0.0, targetLane: 0.0, apex: 1.02, gravity: 2.48, variant: 1, poisoned: false, gemId: 7, spinSpeed: 1.5 });
    push({ time: 0.64, lane: 0.74, targetLane: 0.45, apex: 0.95, gravity: 2.48, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.5 });
    // Wave 2: Amethyst + Aquamarine crossing + Black Diamond center low
    push({ time: 2.65, lane: -0.78, targetLane: 0.28, apex: 1.06, gravity: 2.50, variant: 3, poisoned: false, gemId: 6, spinSpeed: 1.6 });
    push({ time: 2.69, lane: 0.78, targetLane: -0.28, apex: 1.06, gravity: 2.50, variant: 1, poisoned: false, gemId: 8, spinSpeed: 1.6 });
    push({ time: 2.86, lane: 0.0, targetLane: 0.02, apex: 0.80, gravity: 2.50, variant: 2, poisoned: true, spinSpeed: 1.7 });
  } else if (level === 6) {
    // Wave 1: 3-gem simultaneous fan (Ruby + Emerald + Sapphire!)
    push({ time: 0.20, lane: -0.70, targetLane: -0.52, apex: 0.98, gravity: 2.52, variant: 0, poisoned: false, gemId: 3, spinSpeed: 1.55 });
    push({ time: 0.23, lane: 0.0, targetLane: 0.0, apex: 1.04, gravity: 2.52, variant: 1, poisoned: false, gemId: 4, spinSpeed: 1.55 });
    push({ time: 0.26, lane: 0.70, targetLane: 0.52, apex: 0.98, gravity: 2.52, variant: 2, poisoned: false, gemId: 5, spinSpeed: 1.55 });
    // Wave 2: Citrine + Amethyst + Black Diamond
    push({ time: 2.50, lane: -0.66, targetLane: -0.18, apex: 1.02, gravity: 2.55, variant: 3, poisoned: false, gemId: 7, spinSpeed: 1.6 });
    push({ time: 2.74, lane: 0.66, targetLane: 0.28, apex: 0.96, gravity: 2.55, variant: 1, poisoned: false, gemId: 6, spinSpeed: 1.6 });
    push({ time: 2.94, lane: -0.15, targetLane: -0.45, apex: 0.82, gravity: 2.55, variant: 0, poisoned: true, spinSpeed: 1.8 });
  } else {
    // --- Deterministic choreographed generator for Levels 7..1000 ---
    // Smooth logarithmic difficulty curve t in [0..1]
    const t = Math.min(1, Math.log1p(level - 6) / Math.log1p(MAX_LEVEL - 6));
    const gravity = 2.52 + t * 0.98; // 2.52 (Lv 7) -> 3.50 (Lv 1000)
    const waveCount = level < 14 ? 2 : level < 35 ? 3 : level < 110 ? 4 : level < 350 ? 5 : 6;
    const baseGap = 2.25 - t * 0.62; // time between waves shrinks cleanly from 2.25s -> 1.63s
    let cursorT = 0.22;

    for (let w = 0; w < waveCount; w++) {
      const pattern = Math.floor(rng() * 5); // 0=fan, 1=cascade, 2=cross, 3=double-burst, 4=fountain
      const maxClear = Math.min(5, 2 + Math.floor(t * 3.4 + rng() * 1.4));
      const clearN = Math.max(2, maxClear);
      const poisonChance = 0.42 + t * 0.46;
      const poisonN = rng() < poisonChance ? (t > 0.45 && rng() < 0.35 ? 2 : 1) : 0;
      const total = clearN + poisonN;

      // Build clean non-overlapping lanes in [-0.88, +0.88]
      const lanes: number[] = [];
      for (let i = 0; i < total; i++) {
        const u = total === 1 ? 0.5 : i / (total - 1);
        const span = Math.min(0.88, 0.44 + (total - 1) * 0.14);
        lanes.push((u * 2 - 1) * span + (rng() - 0.5) * 0.08);
      }

      // Choose which indices are poisoned (prefer outer or offset lanes so clear combos remain fair & readable!)
      const poisonIdx = new Set<number>();
      if (poisonN > 0) {
        const candidates: number[] = [];
        for (let i = 0; i < total; i++) candidates.push(i);
        // Shuffle candidates deterministically
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }
        for (let p = 0; p < poisonN; p++) poisonIdx.add(candidates[p]);
      }

      const flipDir = rng() < 0.5 ? 1 : -1;
      const staggerBase = 0.24 - t * 0.10; // tighter stagger at higher levels
      let waveEndT = cursorT;

      for (let i = 0; i < total; i++) {
        const idx = flipDir > 0 ? i : total - 1 - i;
        const isPoison = poisonIdx.has(idx);
        const lane = lanes[idx];
        let dt = 0;
        let targetLane = lane * (0.55 + rng() * 0.25);
        let apex = 0.88 + rng() * 0.22;

        if (pattern === 0) {
          // Simultaneous Fan — awesome multi-hit combo!
          dt = i * 0.035 + (isPoison ? 0.14 : 0);
          apex = isPoison ? 0.80 + rng() * 0.10 : 0.94 + Math.cos(lane * 1.4) * 0.12;
        } else if (pattern === 1) {
          // Staggered Cascade left->right or right->left
          dt = i * staggerBase;
          targetLane = lane * 0.62 + flipDir * 0.12;
          apex = 0.86 + (i % 2) * 0.12 + rng() * 0.08;
        } else if (pattern === 2) {
          // Crossing X-Salvo
          dt = (i % 2) * 0.06 + Math.floor(i / 2) * (staggerBase * 1.35);
          targetLane = -lane * (0.45 + rng() * 0.25);
          apex = isPoison ? 0.80 + rng() * 0.08 : 0.96 + rng() * 0.14;
        } else if (pattern === 3) {
          // Twin Pop + Staggered Follow-Up
          const half = Math.ceil(total / 2);
          dt = i < half ? i * 0.04 : 0.46 + (i - half) * (0.06 + rng() * 0.06);
          targetLane = lane * 0.50 + (rng() - 0.5) * 0.24;
          apex = 0.88 + rng() * 0.22;
        } else {
          // Rapid Fountain Volley
          dt = i * (staggerBase * 0.78);
          targetLane = -lane * 0.30 + (rng() - 0.5) * 0.32;
          apex = 0.84 + rng() * 0.26;
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
