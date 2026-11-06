import { jdFromDate } from './kepler';

// Simulated time lives outside React so the frame loop never re-renders anything.
export const clock = {
  jd: jdFromDate(new Date()),
  speed: 30, // days per second
  paused: false,
};
