import type { LevelPlan, ThrowSpec } from './levels.ts';

export interface LevelValidationFailure {
  level: number;
  stageHalfW: number;
  reason: string;
}

const Y0 = -0.82;
const DESPAWN_Y = -0.90;
const SLICEABLE_MIN_Y = 0.18;
/** Gem radius (~0.18m) + human finger/blade safety margin so you never have to thread a 1px needle! */
const BLACK_CLEARANCE = 0.23;
const SLASH_HALF_LEN = 0.22;
const SAMPLE_DT = 0.04;
/** Every colored gem must have at least this much continuous safe-sliceable window (seconds). */
const MIN_SAFE_WINDOW_SEC = 0.24;

interface Arc {
  th: ThrowSpec;
  x0: number;
  vx0: number;
  vy0: number;
  tEnd: number;
}

function buildArc(th: ThrowSpec, stageHalfW: number): Arc {
  const x0 = th.lane * stageHalfW;
  const xApex = th.targetLane * stageHalfW;
  const vy0 = Math.sqrt(2 * th.gravity * (th.apex - Y0));
  const tApex = vy0 / th.gravity;
  const vx0 = (xApex - x0) / Math.max(0.25, tApex);
  // Solve y0 + vy0*dt - 0.5*g*dt^2 = DESPAWN_Y on the way down
  const disc = vy0 * vy0 + 2 * th.gravity * (Y0 - DESPAWN_Y);
  const flightDur = (vy0 + Math.sqrt(Math.max(0, disc))) / th.gravity;
  return { th, x0, vx0, vy0, tEnd: th.time + flightDur };
}

function posAt(a: Arc, t: number): [number, number] | null {
  if (t < a.th.time || t > a.tEnd) return null;
  const dt = t - a.th.time;
  return [
    a.x0 + a.vx0 * dt,
    Y0 + a.vy0 * dt - 0.5 * a.th.gravity * dt * dt,
  ];
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
function distPointToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-8) return Math.hypot(px - ax, py - ay);
  const u = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return Math.hypot(px - (ax + abx * u), py - (ay + aby * u));
}

/** Precomputed 8 blade slash directions around the clock. */
const SLASH_DIRS: Array<[number, number]> = Array.from({ length: 8 }, (_, k) => {
  const ang = (k * Math.PI) / 8;
  return [Math.cos(ang) * SLASH_HALF_LEN, Math.sin(ang) * SLASH_HALF_LEN];
});

/**
 * Validate that a LevelPlan is 100% fair and solvable at the given responsive `stageHalfW`:
 * - Has at least 1 colored gem and valid material IDs.
 * - Max concurrent airborne gems stays playable (<= 8).
 * - Every colored gem stays inside viewport bounds near apex and has >= MIN_SAFE_WINDOW_SEC of
 *   continuous airtime where a realistic blade slash through its center stays >= BLACK_CLEARANCE
 *   away from every currently airborne Poisoned Black Diamond.
 */
export function validateLevel(plan: LevelPlan, stageHalfW: number): LevelValidationFailure | null {
  if (plan.throws.length === 0 || plan.clearCount < 1) {
    return { level: plan.level, stageHalfW, reason: 'No colored gems in level' };
  }

  for (const th of plan.throws) {
    if (th.poisoned && th.gemId !== 1) {
      return { level: plan.level, stageHalfW, reason: `Poisoned gem has wrong gemId ${th.gemId}` };
    }
    if (!th.poisoned && (th.gemId < 2 || th.gemId > 8)) {
      return { level: plan.level, stageHalfW, reason: `Colored gem has invalid gemId ${th.gemId}` };
    }
  }

  const arcs = plan.throws.map((th) => buildArc(th, stageHalfW));
  const poisonArcs = arcs.filter((a) => a.th.poisoned);
  const maxT = arcs.reduce((m, a) => Math.max(m, a.tEnd), 0);

  // 1. Check max concurrent airborne gems never overloads playability or MAX_CUT_SLOTS
  for (let t = 0; t <= maxT; t += 0.08) {
    let active = 0;
    for (const a of arcs) {
      if (t >= a.th.time && t <= a.tEnd) active++;
    }
    if (active > 8) {
      return { level: plan.level, stageHalfW, reason: `Too many concurrent gems (${active}) at t=${t.toFixed(2)}s` };
    }
  }

  // 2. Check every single colored gem has a fair, continuous safe-slicing window!
  const maxAllowedX = stageHalfW * 1.18 + 0.05;
  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i];
    if (a.th.poisoned) continue;

    let bestSafeRun = 0;
    let curSafeRun = 0;
    let visibleTime = 0;

    for (let t = a.th.time; t <= a.tEnd; t += SAMPLE_DT) {
      const p = posAt(a, t);
      if (!p) continue;
      const [gx, gy] = p;
      if (gy < SLICEABLE_MIN_Y) {
        curSafeRun = 0;
        continue;
      }
      visibleTime += SAMPLE_DT;

      if (Math.abs(gx) > maxAllowedX) {
        curSafeRun = 0;
        continue;
      }

      // Gather all currently visible airborne Black Diamonds at time t
      const activeBlacks: Array<[number, number]> = [];
      for (const ba of poisonArcs) {
        const bp = posAt(ba, t);
        if (bp && bp[1] >= -0.30) activeBlacks.push(bp);
      }

      let safeNow = activeBlacks.length === 0;
      if (!safeNow) {
        // Check if at least one realistic blade slash through (gx, gy) clears every Black Diamond
        for (const [dx, dy] of SLASH_DIRS) {
          let slashOk = true;
          for (const [bx, by] of activeBlacks) {
            if (distPointToSeg(bx, by, gx - dx, gy - dy, gx + dx, gy + dy) < BLACK_CLEARANCE) {
              slashOk = false;
              break;
            }
          }
          if (slashOk) {
            safeNow = true;
            break;
          }
        }
      }

      if (safeNow) {
        curSafeRun += SAMPLE_DT;
        if (curSafeRun > bestSafeRun) bestSafeRun = curSafeRun;
      } else {
        curSafeRun = 0;
      }
    }

    if (visibleTime < 0.65) {
      return {
        level: plan.level,
        stageHalfW,
        reason: `Gem #${i} visible airtime too short (${visibleTime.toFixed(2)}s)`,
      };
    }
    if (bestSafeRun < MIN_SAFE_WINDOW_SEC) {
      return {
        level: plan.level,
        stageHalfW,
        reason: `Gem #${i} (t=${a.th.time.toFixed(2)}s) blocked by Black Diamond (max safe window ${bestSafeRun.toFixed(2)}s < ${MIN_SAFE_WINDOW_SEC}s)`,
      };
    }
  }

  return null;
}
