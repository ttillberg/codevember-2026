import { Vector3 } from 'three';

// Where each planet bean actually is right now (after the physics), written by the beans every frame and read by
// anything that wants to steer round them.
export const planetPositions = new Map<string, Vector3>();
// And how fast each is being moved, so things riding along with a planet move with it smoothly, not in the physics'
// fixed steps.
export const planetVelocities = new Map<string, Vector3>();
// And the same for the moons, by name.
export const moonPositions = new Map<string, Vector3>();
if (import.meta.env.DEV) (window as any).__planets = planetPositions; // dev: inspect from the console
