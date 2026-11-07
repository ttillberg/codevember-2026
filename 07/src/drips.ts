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
  travelled: number; // since the last trail stamp, pole-to-pole units
  stuck: number;     // seconds without grip
  thin: boolean;     // spray: a thin flat leg that tapers off, no bead, no thickness, so no relief
};

export const dripSettings = {
  speed: 0.12,    // pole-to-pole units a second, at full mass and full grip
  legs: 7,        // leg length in brush sizes, at full liquid, for a drop of mass 1
  width: 0.09,    // trail diameter in brush sizes
  bead: 0.45,     // bead diameter in brush sizes, at mass 1
  max: 400,
  // Where a drop forms: paint piles up in a coarse map as the brush lays it (one pass of the default brush
  // comes to about 1.3), and dries out of it slowly. A cell over the threshold lets a drop go with the excess.
  threshold: 1.2, // at full liquid; stiffer paint needs more
  dry: 0.12,      // per second, share of the pile that sets
};

const drips: Drip[] = [];
const g2 = { x: 0, y: 0 };

const PW = 512, PH = 256;
const pile = new Float32Array(PW * PH);

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

/** A brush dab lands: pile its paint up where it falls, and let a drop go where there is too much. */
export function maybeSpawn(d: Dab, liquid: number, g: Vector3, held = false) {
  if (liquid <= 0.02) return;
  const spray = d.brush === 'spray';
  const threshold = dripSettings.threshold / Math.max(liquid, 0.02) ** 2.5; // steep: stiff paint hardly ever
  // The dab's paint over its disc, in cells; the disc is as wide in u as the sphere is narrow there.
  // Spray lays a thin coat that never drips on its own; only the can held on one spot pools enough. Pencil
  // and washes never drip.
  const amount = d.flow * (spray ? (held ? 0.5 : 0) : d.brush === 'pencil' || d.brush === 'glaze' ? 0 : d.load ?? 0.85);
  if (amount <= 0) return;
  const ry = Math.max(1, Math.round(d.size * 0.5 * PH));
  const rx = Math.max(1, Math.round(ry / Math.max(Math.sin((1 - d.v) * Math.PI), 0.05) * 0.5 * (PW / PH)));
  const cx = Math.round(d.u * PW), cy = Math.round(d.v * PH);
  for (let j = -ry; j <= ry; j++) {
    const y = cy + j;
    if (y < 0 || y >= PH) continue;
    for (let i = -rx; i <= rx; i++) {
      const fall = 1 - Math.hypot(i / rx, j / ry);
      if (fall <= 0) continue;
      const x = ((cx + i) % PW + PW) % PW;
      const k = y * PW + x;
      pile[k] += amount * fall;
      // Each spot lets go at its own moment, so the legs don't line up like a comb.
      if (pile[k] > threshold * (0.7 + Math.random() * 0.6) && drips.length < dripSettings.max) {
        const u = x / PW, v = y / PH;
        const gr = gravityAt(u, v, g);
        if (gr.grip < 0.2) continue;
        // The drop gathers the paint around it, a brush's width, so there is one drop per spot and the spot has
        // to fill up again before the next.
        let gathered = 0;
        const reach = 0.9 + Math.random() * 1.4;
        const gy = Math.round(ry * reach), gx = Math.round(rx * reach);
        for (let jj = -gy; jj <= gy; jj++) {
          const yy = y + jj;
          if (yy < 0 || yy >= PH) continue;
          for (let ii = -gx; ii <= gx; ii++) {
            if (Math.hypot(ii / gx, jj / gy) > 1) continue;
            const kk = yy * PW + ((x + ii) % PW + PW) % PW;
            const take = pile[kk] * 0.6;
            pile[kk] -= take;
            gathered += take;
          }
        }
        const mass = Math.min(1.3, gathered / (threshold * gx * gy * 0.8)) * liquid * (0.35 + Math.random() ** 1.5 * 1.1) * (spray ? 0.6 : 1);
        drips.push({
          u, v, rgb: d.rgb, rough: d.rough, metal: d.metal,
          mass, width: d.size * dripSettings.width * (0.8 + mass * 0.3) * (spray ? 0.5 : 1), seed: Math.random() * 1000,
          travelled: 0, stuck: 0, thin: spray,
        });
      }
    }
  }
}

/** Forget every drop and all piled paint. */
export function clearDrips() { drips.length = 0; pile.fill(0); }

/** The pile sets with time. Call once a frame. */
export function dryPile(dt: number) {
  const k = 1 - dripSettings.dry * dt;
  for (let i = 0; i < pile.length; i++) if (pile[i] > 0) pile[i] *= k;
}

/** Move every drop and stamp its trail; beads where they stop. */
export function stepDrips(dt: number, g: Vector3, size: number, liquid: number, paint: PaintLayer) {
  const legLength = size * dripSettings.legs * Math.max(liquid, 0.05);
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    const gr = gravityAt(d.u, d.v, g);
    const step = dripSettings.speed * dt * gr.grip * Math.min(1, d.mass + 0.3);
    const spent = step / legLength;
    // Stop: no grip here for a while (the bottom of the balloon as it hangs; a turn passing through counts for
    // nothing), or the drop is spent.
    d.stuck = gr.grip < 0.15 ? d.stuck + dt : 0;
    if (d.stuck > 0.5 || d.mass <= 0) {
      // Thick paint ends in a fat wet bead the run pass may carry on; a spray leg just thins out and stops.
      if (!d.thin) paint.add({
        u: ((d.u % 1) + 1) % 1, v: d.v, angle: 0, seed: d.seed,
        size: size * dripSettings.bead * (0.5 + Math.max(d.mass, 0) + 0.5),
        rgb: d.rgb, flow: 1, brush: 'round', rough: d.rough, metal: d.metal, load: 1.2, wet: 0.3,
      });
      drips.splice(i, 1);
      continue;
    }
    d.u += gr.dx * step / (2 * Math.max(Math.sin(gr.theta), 0.05));
    d.v = Math.min(0.999, Math.max(0.001, d.v + gr.dy * step));
    d.mass -= spent;
    // The trail is stamped by distance, not by frame: a drop that is held up leaves no blot.
    d.travelled += step;
    // A spray leg tapers off over its last stretch, so it ends in a point.
    const width = d.width * (d.thin ? 0.4 + 0.6 * Math.min(1, d.mass * 4) : 1);
    if (d.travelled < width * 0.25) continue;
    d.travelled = 0;
    const angle = Math.atan2(gr.dy, gr.dx);
    // Inside the stroke it came from there is nothing to add: the trail starts where the paint ends.
    const cell = (Math.min(PH - 1, Math.round(d.v * PH))) * PW + ((Math.round(d.u * PW) % PW + PW) % PW);
    if (pile[cell] > 1.0) continue;
    paint.add({
      u: ((d.u % 1) + 1) % 1, v: d.v, angle, seed: d.seed, size: width,
      // Laid dry, so the run pass leaves it alone.
      rgb: d.rgb, flow: 0.6, brush: d.thin ? 'pencil' : 'round', rough: d.rough, metal: d.metal, load: d.thin ? 0 : 0.55, wet: 0,
    });
  }
}

export function dripCount() { return drips.length; }
