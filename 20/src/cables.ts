import * as THREE from 'three';

// A cable: a verlet rope between a socket in the ceiling and a plug on the pod. Both ends are pinned, the plug end
// by two points so the cable leaves the pod the way the plug points. The pod drives the cables, never the reverse.

const POINTS = 40; // of the rope that is simulated
const SUB = 3; // rings of the tube to each of them: the rope's points are 25 cm apart, and a tube bent only there
// shows every bend as a corner; between them it follows a curve through them
const RINGS = (POINTS - 1) * SUB + 1;
const SIDES = 16; // round it (10 showed as flats along its edge of light)
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
    this.positions = new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3);
    this.normals = new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3), 3);
    geo.setAttribute('position', this.positions);
    geo.setAttribute('normal', this.normals);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(RINGS * SIDES * 3).fill(1), 3)); // (the rubber takes the pod's baked shade: none here)
    // uv: round it, and along it in ribs, one every 1.3 radii as on the pod's hoses
    const uv = new Float32Array(RINGS * SIDES * 2);
    for (let i = 0; i < RINGS; i++) {
      for (let k = 0; k < SIDES; k++) {
        uv[(i * SIDES + k) * 2] = k / SIDES;
        uv[(i * SIDES + k) * 2 + 1] = ((i / SUB) * this.seg) / (1.3 * radius);
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let i = 0; i < RINGS - 1; i++) {
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

  /** skin the rope: rings along a curve through its points (Catmull-Rom), the frame carried along so the tube
   *  does not twist */
  skin() {
    const { p, radius } = this;
    const pos = this.positions.array as Float32Array;
    const nor = this.normals.array as Float32Array;
    nrm.set(1, 0, 0);
    for (let r = 0; r < RINGS; r++) {
      const i = Math.min(POINTS - 2, Math.floor(r / SUB));
      const u = r / SUB - i;
      const a0 = Math.max(0, i - 1) * 3, a1 = i * 3, a2 = (i + 1) * 3, a3 = Math.min(POINTS - 1, i + 2) * 3;
      const u2 = u * u, u3 = u2 * u;
      // where the ring is, and which way the curve runs there
      for (let c = 0; c < 3; c++) {
        const p0 = p[a0 + c], p1 = p[a1 + c], p2 = p[a2 + c], p3 = p[a3 + c];
        const at = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u3);
        const go = 0.5 * (p2 - p0 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (3 * p1 - p0 - 3 * p2 + p3) * u2);
        if (c === 0) { a.x = at; t.x = go; } else if (c === 1) { a.y = at; t.y = go; } else { a.z = at; t.z = go; }
      }
      t.normalize();
      nrm.addScaledVector(t, -nrm.dot(t));
      if (nrm.lengthSq() < 1e-8) nrm.set(0, 0, 1).addScaledVector(t, -t.z);
      nrm.normalize();
      bin.crossVectors(t, nrm);
      for (let k = 0; k < SIDES; k++) {
        const ang = (k / SIDES) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const o = (r * SIDES + k) * 3;
        const nx = nrm.x * c + bin.x * s;
        const ny = nrm.y * c + bin.y * s;
        const nz = nrm.z * c + bin.z * s;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
        pos[o] = a.x + nx * radius;
        pos[o + 1] = a.y + ny * radius;
        pos[o + 2] = a.z + nz * radius;
      }
    }
    this.positions.needsUpdate = true;
    this.normals.needsUpdate = true;
  }
}
