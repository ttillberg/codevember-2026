import * as THREE from 'three';

// Blood: at each drip point a drop swells for a few seconds, lets go with whatever speed the pod has there,
// and falls out of sight. Small, dark, one at a time: you should notice it late.

const MAX = 32;
const RADIUS = 0.016;
const GRAVITY = 9.8;

interface Source {
  at: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  grow: number; // 0..1, the drop hanging
  every: number; // seconds to swell
}
interface Drop {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
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
  private drops: Drop[] = [];

  constructor(points: THREE.Object3D[]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a0306, roughness: 0.12, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, MAX);
    this.mesh.frustumCulled = false;
    this.sources = points.map((at, i) => ({
      at,
      pos: at.getWorldPosition(new THREE.Vector3()),
      vel: new THREE.Vector3(),
      grow: (i * 0.37) % 1,
      every: 3.2 + i * 2.3,
    }));
    for (let i = 0; i < MAX - points.length; i++) this.drops.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), alive: false });
  }

  update(dt: number) {
    let n = 0;
    for (const s of this.sources) {
      s.at.getWorldPosition(now);
      if (dt > 0) s.vel.subVectors(now, s.pos).divideScalar(dt);
      s.pos.copy(now);
      s.grow += dt / s.every;
      // a hard swing shakes it loose early
      if (s.grow >= 1 || (s.grow > 0.35 && s.vel.length() > 1.6)) {
        const d = this.drops.find((d) => !d.alive);
        if (d) {
          d.alive = true;
          d.pos.copy(s.pos);
          d.vel.copy(s.vel);
        }
        s.grow = 0;
        s.every = 2.6 + Math.random() * 4.5;
      }
      // the hanging drop: a bead that lengthens before it goes
      const g = s.grow;
      const r = RADIUS * (0.35 + 0.65 * g);
      scl.set(r, r * (1 + 0.9 * g * g), r);
      m.compose(now.set(s.pos.x, s.pos.y - r * 0.8, s.pos.z), quat.identity(), scl);
      this.mesh.setMatrixAt(n++, m);
    }
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.vel.y -= GRAVITY * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < -30) {
        d.alive = false;
        continue;
      }
      const speed = d.vel.length();
      quat.setFromUnitVectors(up, dir.copy(d.vel).divideScalar(speed || 1));
      scl.set(RADIUS * 0.8, RADIUS * (1 + Math.min(4, speed * 0.3)), RADIUS * 0.8);
      m.compose(d.pos, quat, scl);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
