import * as THREE from 'three';

// A cable: a verlet rope between a socket in the ceiling and a plug on the pod. Both ends are pinned, the plug end
// by two points so the cable leaves the pod the way the plug points. The pod drives the cables, never the reverse.

const POINTS = 40;
const SIDES = 10;
const GRAVITY = 9.8;
const ITERATIONS = 14;

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const t = new THREE.Vector3();
const nrm = new THREE.Vector3();
const bin = new THREE.Vector3();

export class Cable {
  readonly mesh: THREE.Mesh;
  private p = new Float32Array(POINTS * 3);
  private q = new Float32Array(POINTS * 3); // the step before
  private seg: number;
  private positions: THREE.BufferAttribute;
  private normals: THREE.BufferAttribute;

  constructor(
    private socket: THREE.Vector3,
    private plug: THREE.Object3D,
    private radius: number,
    slack: number,
    material: THREE.Material,
  ) {
    plug.getWorldPosition(b);
    this.seg = (socket.distanceTo(b) * slack) / (POINTS - 1);
    for (let i = 0; i < POINTS; i++) {
      const s = i / (POINTS - 1);
      a.lerpVectors(socket, b, s);
      a.toArray(this.p, i * 3);
      a.toArray(this.q, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(POINTS * SIDES * 3), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(POINTS * SIDES * 3), 3);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('normal', this.normals);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(POINTS * SIDES * 3).fill(1), 3)); // (the rubber takes the pod's baked shade: none here)
    // uv: round it, and along it in ribs, one every 1.3 radii as on the pod's hoses
    const uv = new Float32Array(POINTS * SIDES * 2);
    for (let i = 0; i < POINTS; i++) {
      for (let k = 0; k < SIDES; k++) {
        uv[(i * SIDES + k) * 2] = k / SIDES;
        uv[(i * SIDES + k) * 2 + 1] = (i * this.seg) / (1.3 * radius);
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) {
      for (let k = 0; k < SIDES; k++) {
        const k1 = (k + 1) % SIDES;
        const r0 = i * SIDES;
        const r1 = r0 + SIDES;
        index.push(r0 + k, r0 + k1, r1 + k, r0 + k1, r1 + k1, r1 + k);
      }
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** one fixed step. `collide` pushes a world point out of the pod. */
  step(dt: number, collide: (p: Float32Array, i: number) => void) {
    const { p, q, seg } = this;
    const drag = 0.992;
    for (let i = 1; i < POINTS - 2; i++) {
      for (let c = 0; c < 3; c++) {
        const j = i * 3 + c;
        const v = (p[j] - q[j]) * drag;
        q[j] = p[j];
        p[j] += v - (c === 1 ? GRAVITY * dt * dt : 0);
      }
    }
    // the ends
    this.socket.toArray(p, 0);
    this.plug.getWorldPosition(b);
    b.toArray(p, (POINTS - 1) * 3);
    // the plug points along its local Z in Blender, which the exporter turns into local Y
    t.set(0, 1, 0).transformDirection(this.plug.matrixWorld);
    b.addScaledVector(t, seg).toArray(p, (POINTS - 2) * 3);

    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < POINTS - 1; i++) this.link(i, i + 1, seg, 1);
      // a thick cable does not kink: every other point is softly held two segments away, so a bend spreads out
      for (let i = 0; i < POINTS - 2; i++) this.link(i, i + 2, seg * 2, 0.14);
      for (let i = 0; i < POINTS - 4; i++) this.link(i, i + 4, seg * 4, 0.05);
    }
    for (let i = 1; i < POINTS - 4; i++) collide(p, i * 3);
  }

  private link(i: number, j: number, rest: number, k: number) {
    const p = this.p;
    const i3 = i * 3;
    const j3 = j * 3;
    const dx = p[j3] - p[i3];
    const dy = p[j3 + 1] - p[i3 + 1];
    const dz = p[j3 + 2] - p[i3 + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const wi = i === 0 || i >= POINTS - 2 ? 0 : 1;
    const wj = j === 0 || j >= POINTS - 2 ? 0 : 1;
    if (wi + wj === 0) return;
    const f = ((d - rest) / d / (wi + wj)) * k;
    p[i3] += dx * f * wi;
    p[i3 + 1] += dy * f * wi;
    p[i3 + 2] += dz * f * wi;
    p[j3] -= dx * f * wj;
    p[j3 + 1] -= dy * f * wj;
    p[j3 + 2] -= dz * f * wj;
  }

  /** skin the rope: a ring per point, the frame carried along so the tube does not twist */
  skin() {
    const { p, radius } = this;
    const pos = this.positions.array as Float32Array;
    const nor = this.normals.array as Float32Array;
    nrm.set(1, 0, 0);
    for (let i = 0; i < POINTS; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(POINTS - 1, i + 1) * 3;
      t.set(p[i1] - p[i0], p[i1 + 1] - p[i0 + 1], p[i1 + 2] - p[i0 + 2]).normalize();
      nrm.addScaledVector(t, -nrm.dot(t));
      if (nrm.lengthSq() < 1e-8) nrm.set(0, 0, 1).addScaledVector(t, -t.z);
      nrm.normalize();
      bin.crossVectors(t, nrm);
      for (let k = 0; k < SIDES; k++) {
        const ang = (k / SIDES) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const o = (i * SIDES + k) * 3;
        const nx = nrm.x * c + bin.x * s;
        const ny = nrm.y * c + bin.y * s;
        const nz = nrm.z * c + bin.z * s;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
        pos[o] = p[i * 3] + nx * radius;
        pos[o + 1] = p[i * 3 + 1] + ny * radius;
        pos[o + 2] = p[i * 3 + 2] + nz * radius;
      }
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
  }
}
