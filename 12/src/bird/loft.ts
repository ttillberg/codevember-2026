import * as THREE from 'three';
import type { Species } from './species';
import { catmull, clamp, DEG, lerp, smoothstep } from './util';

// The body is one lofted surface from the tail root (s = 0) to the base of the
// bill (s = sections - 1). Everything that lives on the skin (feathers, the eye
// sockets, tract borders) is addressed in loft space: (s, angle) where angle 0
// is the belly line, PI the back line and PI/2 the bird's left flank.

export interface SurfacePoint {
  p: THREE.Vector3;
  n: THREE.Vector3;
  /** unit tangent pointing toward the tail: the way feathers lie */
  t: THREE.Vector3;
}

const SPINE_ORDER = ['tail', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'head'] as const;
export type SpineBone = (typeof SPINE_ORDER)[number];

export class Loft {
  readonly count: number;
  private ys: number[];
  private zs: number[];
  private as: number[];
  private ws: number[];
  private rds: number[];
  private rvs: number[];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  constructor(readonly species: Species) {
    const s = species.sections;
    this.count = s.length;
    this.ys = s.map((k) => k.y);
    this.zs = s.map((k) => k.z);
    this.as = s.map((k) => k.a * DEG);
    this.ws = s.map((k) => k.w);
    this.rds = s.map((k) => k.rd);
    this.rvs = s.map((k) => k.rv);
  }

  get sMax() {
    return this.count - 1;
  }

  center(s: number, out: THREE.Vector3) {
    return out.set(0, catmull(this.ys, s), catmull(this.zs, s));
  }

  /** axis direction (toward the head) at s */
  axis(s: number, out: THREE.Vector3) {
    const a = catmull(this.as, s);
    return out.set(0, Math.sin(a), Math.cos(a));
  }

  point(s: number, ang: number, out: THREE.Vector3) {
    const a = catmull(this.as, s);
    const w = Math.max(catmull(this.ws, s), 0.004);
    const rd = Math.max(catmull(this.rds, s), 0.004);
    const rv = Math.max(catmull(this.rvs, s), 0.004);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    // slightly squared-off cross-section: fuller flanks, like a real bird
    const k = 1 + 0.06 * Math.sin(ang * 2) ** 2;
    const d = -ca * (ca > 0 ? rv : rd) * k;
    const cy = catmull(this.ys, s);
    const cz = catmull(this.zs, s);
    out.set(sa * w * k, cy + Math.cos(a) * d, cz - Math.sin(a) * d);
    // the folded wings: pushed straight out from the axis
    const h = this.wingBulge(s, ang);
    if (h > 0) {
      const l = Math.hypot(out.x, out.y - cy, out.z - cz) || 1;
      const f = 1 + h / l;
      out.set(out.x * f, cy + (out.y - cy) * f, cz + (out.z - cz) * f);
    }
    return out;
  }

  surface(s: number, ang: number, out: SurfacePoint) {
    const e = 0.01;
    const s0 = clamp(s, 0, this.sMax);
    this.point(s0, ang, out.p);
    const sa = Math.max(s0 - e, 0);
    const sb = Math.min(s0 + e, this.sMax);
    this.point(sb, ang, this.a).sub(this.point(sa, ang, this.b)); // d/ds, toward the head
    this.point(s0, ang + e, this.b).sub(this.point(s0, ang - e, this.c)); // d/dang
    out.n.crossVectors(this.b, this.a).normalize();
    // tangent toward the tail, orthogonal to the normal
    out.t.copy(this.a).multiplyScalar(-1);
    out.t.addScaledVector(out.n, -out.t.dot(out.n)).normalize();
    return out;
  }

  // --- the folded wing, as a strip of the body ------------------------------------------
  // Wing space: u runs 0 at the shoulder to 1 at the rump end of the strip, v runs -1 at
  // its leading (belly-side) edge to +1 at its trailing (back-side) edge.

  private wingHalfWidth(u: number) {
    const [w0, w1, w2] = this.species.wing.rest.width;
    return u < 0.35 ? lerp(w0, w1, smoothstep(0, 0.35, u)) : lerp(w1, w2, smoothstep(0.35, 1, u));
  }

  /** Half-width of the strip as an angle round the body at s. */
  private wingHalfAngle(s: number, u: number) {
    const r = (catmull(this.ws, s) + (catmull(this.rds, s) + catmull(this.rvs, s)) / 2) / 2;
    return this.wingHalfWidth(u) / Math.max(r, 0.03);
  }

  /** Where a point of the loft sits in wing space (either side). v is unbounded. */
  wingUV(s: number, ang: number) {
    const R = this.species.wing.rest;
    const TAU = Math.PI * 2;
    let a = ((ang % TAU) + TAU) % TAU;
    if (a > Math.PI) a = TAU - a;
    const u = (R.from[0] - s) / (R.from[0] - R.to[0]);
    const uc = clamp(u, 0, 1);
    const centre = lerp(R.from[1], R.to[1], uc) * DEG;
    return { u, v: (a - centre) / this.wingHalfAngle(s, uc) };
  }

  /** The loft coordinates of a wing-space point; sign +1 = left wing, -1 = right. */
  wingAt(u: number, v: number, sign: number) {
    const R = this.species.wing.rest;
    const s = lerp(R.from[0], R.to[0], u);
    const a = lerp(R.from[1], R.to[1], clamp(u, 0, 1)) * DEG + v * this.wingHalfAngle(clamp(s, 0, this.sMax), clamp(u, 0, 1));
    return { s, ang: sign > 0 ? a : Math.PI * 2 - a };
  }

  private wingBulge(s: number, ang: number) {
    const { u, v } = this.wingUV(s, ang);
    if (u <= 0 || u >= 1 || Math.abs(v) >= 1) return 0;
    const k = 1 - v * v;
    return this.species.wing.rest.height * smoothstep(0, 0.1, u) * (1 - smoothstep(0.8, 1, u)) * k * k;
  }

  /** Up to two spine bones and their weights for a point at s. */
  weights(s: number): [SpineBone, number, SpineBone, number] {
    const sp = this.species.spine;
    for (let i = 0; i < SPINE_ORDER.length - 1; i++) {
      const a = SPINE_ORDER[i];
      const b = SPINE_ORDER[i + 1];
      if (s <= sp[b] || i === SPINE_ORDER.length - 2) {
        const f = smoothstep(sp[a], sp[b], s);
        return [a, 1 - f, b, f];
      }
    }
    return ['head', 1, 'head', 0];
  }

  /**
   * Full skin binding for a surface point: two spine bones plus the sternum,
   * a leaf bone under the breast and flanks that the breath pushes around.
   */
  skin(s: number, ang: number): { bones: [string, string, string, string]; weights: [number, number, number, number] } {
    const sp = this.species.spine;
    const belly = 0.5 + 0.5 * Math.cos(ang);
    // the throat hangs off the head: skin on the front of the neck follows the bones above it
    const throat = belly * belly * this.species.throatPull * smoothstep(sp.chest - 0.2, sp.neck1 - 0.3, s) * (1 - smoothstep(sp.head, sp.head + 0.6, s));
    const w = this.weights(s + throat);
    const along = smoothstep(sp.hips - 0.4, sp.spine, s) * (1 - smoothstep(sp.chest + 0.2, sp.neck1 + 0.3, s));
    const st = 0.6 * along * (0.35 + 0.65 * belly);
    return { bones: [w[0], w[2], 'sternum', 'root'], weights: [w[1] * (1 - st), w[3] * (1 - st), st, 0] };
  }

  /** 0 at the bill, 1 at the tail root: the coordinate the ruffle wave travels along. */
  bodyCoord(s: number) {
    return 1 - clamp(s / this.sMax, 0, 1);
  }
}
