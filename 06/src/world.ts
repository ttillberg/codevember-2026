import { Vector3 } from 'three';

// Where each planet bean actually is right now (after the physics), written by the beans every frame and read by
// anything that wants to steer round them.
export const planetPositions = new Map<string, Vector3>();
// Whether something at `at`, `radius` across, is in the way of the camera's view of the planet in focus: between
// them along the line of sight and near enough to it to block it.
const along = new Vector3(), toward = new Vector3();
export function inTheWay(camera: Vector3, focus: Vector3, at: Vector3, radius: number) {
  along.subVectors(focus, camera);
  const length = along.length();
  if (length < 1e-6) return false;
  along.divideScalar(length);
  toward.subVectors(at, camera);
  const t = toward.dot(along);
  if (t <= 0 || t >= length - radius) return false; // behind the camera, or at or past the focus
  return toward.addScaledVector(along, -t).length() < radius + 0.4;
}

// And the same for the moons, by name.
export const moonPositions = new Map<string, Vector3>();
if (import.meta.env.DEV) (window as any).__planets = planetPositions; // dev: inspect from the console
