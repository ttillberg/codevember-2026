import * as THREE from 'three';
import type { Species } from './species';
import { catmull, clamp, DEG, smoothstep } from './util';

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
    out.set(sa * w * k, catmull(this.ys, s) + Math.cos(a) * d, catmull(this.zs, s) - Math.sin(a) * d);
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

  /**
   * How far a root-space point stands outside the skin of the trunk (negative = inside),
   * good enough to lay wing feathers on the body. Writes the skin normal there into `n`.
   * Points past the tail root count as clear.
   */
  clearance(P: THREE.Vector3, n?: THREE.Vector3, sLimit = 5.6): number {
    const c = new THREE.Vector3();
    const ax = new THREE.Vector3();
    let best = 0;
    let bestV = Infinity;
    const N = 90;
    for (let k = 0; k <= N; k++) {
      const s = (k / N) * sLimit;
      this.center(s, c);
      this.axis(s, ax);
      const v = Math.abs((P.x - c.x) * ax.x + (P.y - c.y) * ax.y + (P.z - c.z) * ax.z);
      if (v < bestV) {
        bestV = v;
        best = s;
      }
    }
    this.center(best, c);
    this.axis(best, ax);
    if (best === 0 && (P.y - c.y) * ax.y + (P.z - c.z) * ax.z < -0.01) {
      n?.set(Math.sign(P.x) * 0.5, 0.4, -0.75).normalize();
      return 1;
    }
    const a = catmull(this.as, best);
    const dcoord = (P.y - c.y) * Math.cos(a) - (P.z - c.z) * Math.sin(a);
    const w = Math.max(catmull(this.ws, best), 0.004);
    const r = Math.max(dcoord > 0 ? catmull(this.rds, best) : catmull(this.rvs, best), 0.004);
    const ang = Math.atan2(P.x / w, -dcoord / r);
    const rel = Math.hypot(P.x - c.x, P.y - c.y, P.z - c.z);
    const cc = c;
    const sp: SurfacePoint = { p: new THREE.Vector3(), n: n ?? new THREE.Vector3(), t: new THREE.Vector3() };
    this.surface(best, ang, sp);
    return rel - sp.p.distanceTo(cc);
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
