// Drips as particles. A dab from the brush may let go a drop; the drop slides down the balloon along gravity,
// lays a thin dry trail behind it, loses mass with the distance, and where it stops (mass spent, or gravity has
// no grip on that part of the surface) it leaves a bead. Few, narrow, straight legs with a drop at the end, like
// spray paint on a wall; the run pass in the texture does the soft tongues along a stroke's edge.
import { Vector3 } from 'three';
import type { Dab, PaintLayer } from './paint';

type Drip = {
  u: number; v: number;
  rgb: [number, number, number]; rough: number; metal: number;
  mass: number;      // what is left to spend, in pole-to-pole units of leg
  width: number;     // trail diameter, pole-to-pole units
  seed: number;
};

export const dripSettings = {
  chance: 0.05,   // per brush dab, at full liquid (scaled by liquid squared)
  speed: 0.12,    // pole-to-pole units a second, at full mass and full grip
  legs: 7,        // leg length in brush sizes, at full liquid, for a drop of mass 1
  width: 0.14,    // trail diameter in brush sizes
  bead: 0.45,     // bead diameter in brush sizes, at mass 1
  max: 400,
};

const drips: Drip[] = [];
const g2 = { x: 0, y: 0 };

// Gravity on the sphere at (u, v) in texture space, direction and grip, as in the run pass: the object-space
// gravity on the tangents of three's sphere mapping.
function gravityAt(u: number, v: number, g: Vector3) {
  const phi = u * 2 * Math.PI, theta = (1 - v) * Math.PI;
  const tu = { x: Math.sin(phi), y: 0, z: Math.cos(phi) };
  const tv = { x: Math.cos(phi) * Math.cos(theta), y: Math.sin(theta), z: -Math.sin(phi) * Math.cos(theta) };
  g2.x = g.x * tu.x + g.y * tu.y + g.z * tu.z;
  g2.y = g.x * tv.x + g.y * tv.y + g.z * tv.z;
  const grip = Math.hypot(g2.x, g2.y);
  return { dx: g2.x / Math.max(grip, 1e-6), dy: g2.y / Math.max(grip, 1e-6), grip, theta };
}

/** A brush dab passes by: maybe let a drop go from its lower edge. */
export function maybeSpawn(d: Dab, liquid: number, g: Vector3) {
  if (drips.length >= dripSettings.max) return;
  if (Math.random() > dripSettings.chance * liquid * liquid) return;
  const gr = gravityAt(d.u, d.v, g);
  if (gr.grip < 0.2) return;
  // Most drops are small and stop soon, a few go far.
  const mass = (0.15 + Math.random() ** 2 * 1.1) * liquid;
  // Start half a brush down the slope, so the leg comes out from under the stroke.
  const r = d.size * 0.5;
  drips.push({
    u: d.u + gr.dx * r / (2 * Math.max(Math.sin(gr.theta), 0.05)), v: d.v + gr.dy * r,
    rgb: d.rgb, rough: d.rough, metal: d.metal,
    mass, width: d.size * dripSettings.width * (0.7 + mass * 0.5), seed: Math.random() * 1000,
  });
}

/** Move every drop and stamp its trail; beads where they stop. */
export function stepDrips(dt: number, g: Vector3, size: number, liquid: number, paint: PaintLayer) {
  const legLength = size * dripSettings.legs * Math.max(liquid, 0.05);
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    const gr = gravityAt(d.u, d.v, g);
    const step = dripSettings.speed * dt * gr.grip * Math.min(1, d.mass + 0.3);
    const spent = step / legLength;
    // Stop: no grip here (the bottom of the balloon as it hangs), or the drop is spent.
    if (gr.grip < 0.15 || d.mass <= 0) {
      paint.add({
        u: ((d.u % 1) + 1) % 1, v: d.v, angle: 0, seed: d.seed, size: size * dripSettings.bead * (0.5 + Math.max(d.mass, 0) + 0.5),
        rgb: d.rgb, flow: 1, brush: 'round', rough: d.rough, metal: d.metal, load: 1.0, wet: 0.3,
      });
      drips.splice(i, 1);
      continue;
    }
    d.u += gr.dx * step / (2 * Math.max(Math.sin(gr.theta), 0.05));
    d.v = Math.min(0.999, Math.max(0.001, d.v + gr.dy * step));
    d.mass -= spent;
    const angle = Math.atan2(gr.dy, gr.dx);
    paint.add({
      u: ((d.u % 1) + 1) % 1, v: d.v, angle, seed: d.seed, size: d.width,
      rgb: d.rgb, flow: 0.45, brush: 'round', rough: d.rough, metal: d.metal, load: 0.35, wet: 0,
    });
  }
}

export function dripCount() { return drips.length; }
