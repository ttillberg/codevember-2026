// The opening: everything dark until the scene has loaded, then the sun lights up and its light spreads out over
// the planets. `ready` is when the candy was in (0 until then); `value` runs 0 to 1 from then.
export const intro = { ready: 0, value: 0 };

export const INTRO_TIME = 6; // seconds
const ease = (t: number) => t * t * (3 - 2 * t);
const span = (from: number, to: number) => ease(Math.min(1, Math.max(0, (intro.value - from) / (to - from))));

// The sun's own glow first, its light on the planets a beat behind, the rest of the room last.
export const sunGlow = () => span(0, 0.45);
export const sunLight = () => span(0.15, 0.8);
export const roomLight = () => span(0.3, 1);
