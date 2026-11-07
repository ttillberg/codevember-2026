import { jdFromDate } from './kepler';

// Simulated time lives outside React so the frame loop never re-renders anything.
export const clock = {
  jd: jdFromDate(new Date()),
  speed: 30, // days per second
  paused: false,
};

// How fast the scene's own motions run (spins, wriggles, wobbles, the belt, the pod), as a multiplier on real
// time: still when paused, full at the fastest speed (×5, 30 days a second) they were tuned at, and slower with the
// clock, eased (a square root) so slow motion still moves.
export const FULL_SPEED = 30;
// Simulated days going by each real second: none while paused.
export const daysPerSecond = () => (clock.paused ? 0 : clock.speed);
export const motion = () => (clock.paused ? 0 : Math.sqrt(clock.speed / FULL_SPEED));
