// The opening: the sun glows up in the dark straight away, while the rest loads; once the candy is in, its light
// spreads out over the planets. `born` is the first frame, `ready` when the candy was in (0 until then); `value`
// runs 0 to 1 from then.
export const intro = { born: 0, ready: 0, value: 0 };
const SUN_UP = 2.5; // seconds for the sun's own glow to come up

export const INTRO_TIME = 6; // seconds
const ease = (t: number) => t * t * (3 - 2 * t);
const span = (from: number, to: number) => ease(Math.min(1, Math.max(0, (intro.value - from) / (to - from))));

// The sun's own glow first, its light on the planets a beat behind, the rest of the room last.
export const sunGlow = () => (intro.born ? ease(Math.min(1, (performance.now() - intro.born) / 1000 / SUN_UP)) : 0);
export const sunLight = () => span(0.15, 0.8);
export const roomLight = () => span(0.3, 1);
