import * as THREE from 'three';

// Blood: it never stops. At each drip point a bead hangs and a thin run comes off it, a thread at first, the
// bits of it so close they overlap, that pinches into drops as it falls and speeds up (a stream breaks up like
// that, unevenly). The flow swells and thins on its own, a swing of the pod throws more out, and the run
// trails behind the point as it moves, so the stream bends with the swing.

const MAX = 1400;
const RATE = 34; // bits of the stream a second, at full flow
const RADIUS = 0.0045;
const GRAVITY = 9.8;
const FLOOR = -30; // out of sight below this

interface Source {
  at: THREE.Object3D;
  pos: THREE.Vector3;
  last: THREE.Vector3;
  vel: THREE.Vector3;
  acc: number; // bits owed
  phase: number;
}

const m = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();
const now = new THREE.Vector3();

export class Blood {
  readonly mesh: THREE.InstancedMesh;
  private sources: Source[];
  // the stream, a ring: position, velocity, age, radius, when it pinches off
  private p = new Float32Array(MAX * 3);
  private v = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(Infinity);
  private r = new Float32Array(MAX);
  private pinch = new Float32Array(MAX);
  private head = 0;
  private time = 0;

  constructor(points: THREE.Object3D[]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a0306, roughness: 0.12, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, MAX + points.length);
    this.mesh.frustumCulled = false;
    this.sources = points.map((at, i) => {
      const pos = at.getWorldPosition(new THREE.Vector3());
      return { at, pos, last: pos.clone(), vel: new THREE.Vector3(), acc: 0, phase: i * 2.1 };
    });
  }

  /** how much is coming out at a point just now, 0..1: slow swells, never quite dry */
  private flow(s: Source) {
    const t = this.time + s.phase;
    return 0.55 + 0.25 * Math.sin(t * 0.7) + 0.2 * Math.sin(t * 1.9 + 1.3);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    let n = 0;
    for (const s of this.sources) {
      s.last.copy(s.pos);
      s.at.getWorldPosition(s.pos);
      s.vel.subVectors(s.pos, s.last).divideScalar(dt);
      const f = this.flow(s);
      // a hard swing throws more of it out
      s.acc += RATE * f * (1 + Math.min(2, s.vel.length())) * dt;
      const k = Math.min(Math.floor(s.acc), 12);
      s.acc -= Math.floor(s.acc);
      for (let j = 0; j < k; j++) {
        // spread along the way the point went this frame, each already as old as it would be, so the run is even
        const a = (j + Math.random()) / k;
        const old = (1 - a) * dt;
        const i = this.head;
        this.head = (this.head + 1) % MAX;
        now.lerpVectors(s.last, s.pos, a);
        const vx = s.vel.x * 0.9 + (Math.random() - 0.5) * 0.02;
        const vy = s.vel.y * 0.9 - 0.25 - GRAVITY * old;
        const vz = s.vel.z * 0.9 + (Math.random() - 0.5) * 0.02;
        this.p.set([now.x + vx * old, now.y + vy * old, now.z + vz * old], i * 3);
        this.v.set([vx, vy, vz], i * 3);
        this.age[i] = old;
        this.r[i] = RADIUS * (0.75 + 0.45 * f) * (0.85 + Math.random() * 0.3);
        this.pinch[i] = 0.12 + Math.random() * 0.22;
      }
      // the bead it all runs off, a little fuller when more is coming
      const r = RADIUS * (1.6 + 0.6 * f);
      scl.set(r, r * 1.35, r);
      m.compose(now.set(s.pos.x, s.pos.y - r * 0.9, s.pos.z), quat.identity(), scl);
      this.mesh.setMatrixAt(n++, m);
    }
    const spacing = 1 / RATE;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) continue;
      const o = i * 3;
      this.v[o + 1] -= GRAVITY * dt;
      this.p[o] += this.v[o] * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += this.v[o + 2] * dt;
      this.age[i] += dt;
      if (this.p[o + 1] < FLOOR) {
        this.age[i] = Infinity;
        continue;
      }
      dir.set(this.v[o], this.v[o + 1], this.v[o + 2]);
      const speed = dir.length();
      dir.divideScalar(speed || 1);
      const r = this.r[i];
      // young, a stretch of thread long enough to reach the next bit; older, pinched into a drop, a little drawn out
      const thread = 0.65 * speed * spacing + r;
      const drop = r * (1.15 + Math.min(1.5, speed * 0.12));
      const t = THREE.MathUtils.smoothstep(this.age[i], this.pinch[i], this.pinch[i] + 0.12);
      const len = THREE.MathUtils.lerp(thread, drop, t);
      const thin = THREE.MathUtils.lerp(0.8, 1.15, t); // a thread is thinner than the drop it gathers into
      quat.setFromUnitVectors(up, dir);
      scl.set(r * thin, len, r * thin);
      m.compose(now.set(this.p[o], this.p[o + 1], this.p[o + 2]), quat, scl);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
