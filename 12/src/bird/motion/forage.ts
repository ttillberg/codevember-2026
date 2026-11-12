import * as THREE from 'three';
import type { Pose, Solver } from '../pose';
import { clamp, damp, rand, smoothstep } from '../util';
import type { Layer, Mind } from './mind';

// Picking food out of the air. A seed drifting into view takes over the gaze
// (mind.focus: the gaze layer goes bill-on and keeps re-fixating it). If it is
// within reach, after a moment of sizing it up the bird strikes: a small
// wind-up, then the bill tip is driven onto the seed's predicted position by
// the solver's reach IK in well under a fifth of a second, the bill opening on
// the way and snapping shut on contact. Then a short hold, the neck folds
// back, and a gulp with a little toss of the head.

type State = 'idle' | 'watch' | 'windup' | 'strike' | 'hold' | 'retract' | 'swallow';

const minJerk = (u: number) => u * u * u * (10 + u * (-15 + 6 * u));

export class ForageLayer implements Layer {
  readonly name = 'forage';
  enabled = true;
  /** how far the neck will unfold / tuck to bring the bill tip onto a seed */
  reachOut = 0.3;
  reachIn = 0.2;
  /** how close the tip must be when the bill shuts for it to count */
  catchRadius = 0.05;

  state: State = 'idle';
  private id = -1;
  private t0 = 0;
  private dur = 0.15;
  private decideAt = 0;
  private watchUntil = 0;
  private readyAt = 0;
  private retried = false;
  private ignore = new Map<number, number>();
  private target = new THREE.Vector3();
  private w = 0;
  private wFrom = 0;
  private lean = 0;
  private yaw = 0;
  private rel = new THREE.Vector3();
  private focus = new THREE.Vector3();

  constructor(
    private mind: Mind,
    private solver: Solver,
    private headRest: THREE.Vector3,
    private pick: (id: number) => void,
  ) {
    mind.on('startle', () => {
      // a fright drops everything
      this.release(this.mind, 'idle');
      this.readyAt = this.mind.t + 1.5;
    });
  }

  private seed(m: Mind) {
    return m.food.find((f) => f.id === this.id);
  }

  /** How much the neck would have to unfold (+) or tuck (−) for the tip to touch p; null if out of reach. */
  private slideFor(p: THREE.Vector3): number | null {
    const r = this.rel.copy(p).sub(this.headRest);
    const dist = r.length();
    const yaw = Math.atan2(r.x, r.z);
    const elev = Math.asin(clamp(r.y / Math.max(dist, 1e-6), -1, 1));
    if (Math.abs(yaw) > 2.0 || elev < -0.95 || elev > 1.3 || p.y < -0.12) return null;
    const slide = dist - this.solver.billReach;
    return slide > this.reachOut || slide < -this.reachIn ? null : slide;
  }

  private inView(p: THREE.Vector3) {
    const r = this.rel.copy(p).sub(this.headRest);
    return Math.abs(Math.atan2(r.x, r.z)) < 2.2 && r.length() < 2.2 && p.y > -0.9;
  }

  private release(m: Mind, to: State) {
    this.state = to;
    this.t0 = m.t;
    this.wFrom = this.w;
    if (to === 'idle') {
      m.focus = null;
      m.gazeLock = false;
      this.id = -1;
    }
  }

  private begin(m: Mind, to: State, dur: number) {
    this.state = to;
    this.t0 = m.t;
    this.dur = dur;
    this.wFrom = this.w;
  }

  update(m: Mind, p: Pose) {
    const t = m.t;
    const u = clamp((t - this.t0) / this.dur, 0, 1);
    let seed = this.seed(m);

    switch (this.state) {
      case 'idle': {
        this.w = damp(this.w, 0, 22, m.dt);
        if (t < this.readyAt) break;
        // the nearest thing worth a look
        let best = null as (typeof m.food)[number] | null;
        let bestD = Infinity;
        for (const f of m.food) {
          if ((this.ignore.get(f.id) ?? 0) > t || !this.inView(f.pos)) continue;
          const d = f.pos.distanceTo(this.headRest) - (this.slideFor(f.pos) !== null ? 1 : 0);
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
        if (best) {
          this.id = best.id;
          this.state = 'watch';
          this.decideAt = 0;
          this.watchUntil = t + rand(m.rng, 3, 6);
          m.focus = this.focus.copy(best.pos);
          m.focusId++;
          m.excite(0.25);
        }
        break;
      }
      case 'watch': {
        this.w = damp(this.w, 0, 22, m.dt);
        if (!seed || !this.inView(seed.pos)) {
          this.release(m, 'idle');
          break;
        }
        m.focus = this.focus.copy(seed.pos);
        if (this.slideFor(seed.pos) === null) {
          // out of reach: just watch it go by for a while
          this.decideAt = 0;
          if (t > this.watchUntil) {
            this.ignore.set(seed.id, t + rand(m.rng, 4, 8));
            this.release(m, 'idle');
            this.readyAt = t + rand(m.rng, 0.3, 1);
          }
          break;
        }
        // in reach: size it up for a moment, bill-on, then go
        if (!this.decideAt) this.decideAt = t + rand(m.rng, 0.35, 1.1);
        if (t >= this.decideAt && !m.saccading && m.freeze <= 0) {
          m.gazeLock = true;
          this.retried = false;
          this.begin(m, 'windup', rand(m.rng, 0.09, 0.13));
        }
        break;
      }
      case 'windup': {
        if (!seed) {
          this.release(m, 'idle');
          break;
        }
        // a hair of recoil before the strike
        const k = Math.sin(u * Math.PI * 0.5);
        this.rel.copy(seed.pos).sub(this.headRest).normalize();
        p.headShift.addScaledVector(this.rel, -0.03 * k);
        p.bodyShift.y -= 0.006 * k;
        if (u >= 1) {
          const slide = this.slideFor(seed.pos) ?? 0;
          this.lean = slide;
          this.yaw = Math.atan2(seed.pos.x - this.headRest.x, seed.pos.z - this.headRest.z);
          this.begin(m, 'strike', clamp(0.13 + Math.abs(slide) * 0.2, 0.12, 0.2));
        }
        break;
      }
      case 'strike': {
        if (!seed) {
          this.begin(m, 'retract', 0.2);
          break;
        }
        // lead it: aim where it will be when the bill gets there
        this.target.copy(seed.pos).addScaledVector(seed.vel, (1 - u) * this.dur);
        this.w = this.wFrom + (1 - this.wFrom) * (1 - Math.pow(1 - u, 3));
        p.jaw += smoothstep(0.3, 0.75, u) * (1 - smoothstep(0.93, 1, u)) * 0.75;
        if (u >= 1) {
          if (this.solver.tip.distanceTo(seed.pos) < this.catchRadius) {
            this.pick(seed.id);
            m.excite(0.1);
            this.begin(m, 'hold', rand(m.rng, 0.12, 0.22));
          } else if (!this.retried && this.slideFor(seed.pos) !== null) {
            // missed: one quick second stab
            this.retried = true;
            this.begin(m, 'strike', 0.1);
          } else {
            this.ignore.set(seed.id, t + rand(m.rng, 3, 5));
            this.begin(m, 'retract', 0.22);
          }
        }
        break;
      }
      case 'hold':
        this.w = 1;
        if (u >= 1) this.begin(m, 'retract', 0.2);
        break;
      case 'retract':
        this.w = this.wFrom * (1 - minJerk(u));
        if (u >= 1) {
          m.focus = null;
          this.begin(m, 'swallow', rand(m.rng, 0.38, 0.48));
        }
        break;
      case 'swallow': {
        // gulp: a quick toss of the head, the bill parts and shuts, the throat bobs
        this.w = 0;
        const toss = Math.sin(Math.PI * smoothstep(0, 0.55, u)) * 0.26;
        p.headPitch += toss;
        p.headShift.y += toss * 0.03;
        p.jaw += Math.sin(Math.PI * smoothstep(0.12, 0.5, u)) * 0.4;
        const bob = Math.sin(Math.PI * smoothstep(0.35, 0.95, u));
        p.gorget += bob * 0.16;
        p.addLift(0.2, 0.12, bob * 0.12);
        if (u >= 1) {
          this.release(m, 'idle');
          this.readyAt = t + rand(m.rng, 0.4, 1.3);
        }
        break;
      }
    }

    if (this.w > 0.001) {
      p.reachTarget.copy(this.target);
      p.reachWeight = this.w;
      // the body goes with it: lean into a long reach, rock back from a close one, turn a little
      p.bodyPitch += this.w * clamp(this.lean * 0.75, -0.16, 0.24);
      p.bodyYaw += this.w * this.yaw * 0.14;
      p.bodyShift.y -= this.w * 0.008;
      p.headStabil *= 1 - this.w;
    }
  }
}
