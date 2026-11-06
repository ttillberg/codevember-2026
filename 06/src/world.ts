import { Vector3 } from 'three';

// Where each planet bean actually is right now (after the physics), written by the beans every frame and read by
// anything that wants to steer round them.
export const planetPositions = new Map<string, Vector3>();
if (import.meta.env.DEV) (window as any).__planets = planetPositions; // dev: inspect from the console
