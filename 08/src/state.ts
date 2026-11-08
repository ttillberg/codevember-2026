import { DOOR_STEP, STEPS } from './fold';

const DOOR_T = DOOR_STEP / STEPS;

// Shared mutable state between the scene and the page. Read every frame, no React in the loop.
export const state = {
  t: 0, // fold progress, 0 net .. 1 tesseract
  target: 0, // where t is heading, a step boundary
  auto: true, // fold step by step, spin, unfold, over and over
  spin: true, // turn in 4D while folded
  wait: 2.5, // seconds left at this boundary before auto moves on
  angles: [0, 0, 0], // XW, YW, ZW
  rest: 0, // seconds since t reached the target
  still: true, // no 4D turn on, angles at whole turns
};

/** Where each cell's part letter sits on screen, written by the scene, read by the page. */
export const labels = Array.from({ length: 8 }, () => ({ on: false, x: 0, y: 0 }));

export const STEP_TIME = 1.5; // seconds to fold one step
export const UNFOLD_TIME = 3; // seconds to unfold the lot
export const HOLD_NET = 3;
export const HOLD_STEP = 1.4;
export const HOLD_FOLDED = 11;

/** Auto: after a rest at a step boundary, go to the next one; from the tesseract, all the way back. */
export function advance() {
  if (state.target >= 1) {
    state.target = 0;
    state.wait = HOLD_NET;
  } else {
    state.target = Math.min(1, Math.round(state.target * STEPS + 1) / STEPS);
    // a long rest on the closed wardrobe (it turns in 4D there) and on the open one
    state.wait = state.target >= DOOR_T ? HOLD_FOLDED : HOLD_STEP;
  }
}

/** Jump to step i (0 = the net, STEPS = the tesseract). Takes over from auto. */
export function goTo(i: number) {
  state.auto = false;
  state.target = i / STEPS;
}
