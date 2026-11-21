import * as THREE from 'three';

// Blood: little of it. One run, at the door: a bead hangs where the seam's run ends, fills, and lets a drop go
// every second or two, not evenly; the drop falls, draws out a little as it speeds up, and is gone in the dark.
// (It was a stream that broke into drops at two points, 1400 beads of it, then two unbroken lines nine metres
// long: too much, both.)

const MAX = 8; // drops in the air at once (three or four, in fact)
const RADIUS = 0.0042; // a drop
const GRAVITY = 9.8;
const FLOOR = -30; // out of sight below this

const m = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();
const at = new THREE.Vector3();

export class Blood {
  readonly mesh: THREE.InstancedMesh;
  private pos = new THREE.Vector3();
  private last = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private fill = 0; // the bead: 0 just let go, 1 about to
  private wait = 1.2; // seconds this bead takes to fill
  private p = new Float32Array(MAX * 3);
  private v = new Float32Array(MAX * 3);
  private live = new Uint8Array(MAX);
  private running = false;

  /** `point`: where it drips from (an empty on the pod) */
  constructor(private point: THREE.Object3D) {
    // (redder than blood in the dark of the hall can be, and with a little light of its own: as a dark red lit by
    // nothing it was black on black, and not there)
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c0508, emissive: 0x3a0003, roughness: 0.12, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat, MAX + 1);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    point.getWorldPosition(this.pos);
  }

  /** none of it until the door is opened (main.ts): then it starts, and never stops */
  start() { this.running = true; }

  /** `eye` and `px` (the size of a CSS pixel one metre from it): a drop 8 mm across is thinner than a pixel from
   *  where the eye lands, on a phone, so none is drawn smaller than a pixel and a half */
  update(dt: number, eye?: THREE.Vector3, px = 0) {
    if (dt <= 0) return;
    if (!this.running) { this.mesh.count = 0; return; }
    const least = (q: THREE.Vector3) => (eye ? 0.75 * px * q.distanceTo(eye) : 0);
    this.last.copy(this.pos);
    this.point.getWorldPosition(this.pos);
    this.vel.subVectors(this.pos, this.last).divideScalar(dt);
    // the bead fills; full, it lets a drop go and starts again, a little sooner or later each time
    this.fill += dt / this.wait;
    if (this.fill >= 1) {
      this.fill = 0;
      this.wait = 0.9 + Math.random() * 1.3;
      const i = this.live.indexOf(0);
      if (i >= 0) {
        this.live[i] = 1;
        this.p.set([this.pos.x, this.pos.y - RADIUS * 2, this.pos.z], i * 3);
        this.v.set([this.vel.x * 0.9, this.vel.y * 0.9 - 0.1, this.vel.z * 0.9], i * 3);
      }
    }
    let n = 0;
    // the bead: small just after a drop, hanging longer as it fills
    {
      const f = this.fill * this.fill;
      const r = Math.max(RADIUS * (0.55 + 0.6 * f), least(this.pos));
      scl.set(r, r * (1.05 + 0.75 * f), r);
      m.compose(at.set(this.pos.x, this.pos.y - scl.y * 0.8, this.pos.z), quat.identity(), scl);
      this.mesh.setMatrixAt(n++, m);
    }
    for (let i = 0; i < MAX; i++) {
      if (!this.live[i]) continue;
      const o = i * 3;
      this.v[o + 1] -= GRAVITY * dt;
      this.p[o] += this.v[o] * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += this.v[o + 2] * dt;
      if (this.p[o + 1] < FLOOR) { this.live[i] = 0; continue; }
      dir.set(this.v[o], this.v[o + 1], this.v[o + 2]);
      const speed = dir.length();
      dir.divideScalar(speed || 1);
      at.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      const r = Math.max(RADIUS, least(at));
      quat.setFromUnitVectors(up, dir);
      scl.set(r, r * (1.1 + Math.min(1.3, speed * 0.1)), r); // drawn out a little as it speeds up
      m.compose(at, quat, scl);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
