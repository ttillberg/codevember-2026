import { jdFromDate } from './kepler';

// Simulated time lives outside React so the frame loop never re-renders anything.
export const clock = {
  jd: jdFromDate(new Date()),
  speed: 30, // days per second
  paused: false,
};

// Scene positions, written by each planet every frame, read by the label layer.
export const bodies = new Map<string, import('three').Vector3>();
export const radii = new Map<string, number>();
// Each ring's current tilt, written by its planet every frame, read by the chains.
export const tilts = new Map<string, import('three').Quaternion>();
