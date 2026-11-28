// The air of the burrow: motes that only show where the beam passes through them, and the dirt that lets go of the
// roof when something disturbs it. Crumbs fall under real gravity, bounce once or twice and stay where they land.
import * as THREE from 'three';
import type { World } from './world';
import { moteMaterial, crumbMaterial } from './gfx';

const MOTES = 1400;
const CRUMBS = 7000;

interface Emitter { p: THREE.Vector3; rate: number; left: number; spread: number; acc: number; size: number }

export class Dust {
  motes: THREE.Points;
  crumbs: THREE.Points;
  /** gl_PointSize of one metre at one metre: the drawing buffer's height over 2·tan(fov/2) */
  scale = { value: 800 };
  private pos = new Float32Array(CRUMBS * 3);
  private vel = new Float32Array(CRUMBS * 3);
  private data = new Float32Array(CRUMBS * 4);
  private state = new Uint8Array(CRUMBS); // 0 free, 1 falling, 2 lying
  private age = new Float32Array(CRUMBS);
  private next = 0;
  private emitters: Emitter[] = [];
  private posAttr: THREE.BufferAttribute;
  private dataAttr: THREE.BufferAttribute;
  private n = new THREE.Vector3();

  constructor(private world: World) {
    const mg = new THREE.BufferGeometry();
    const seed = new Float32Array(MOTES * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.motes = new THREE.Points(mg, moteMaterial(this.scale));
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 10;

    const cg = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.dataAttr = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('position', this.posAttr);
    cg.setAttribute('aData', this.dataAttr);
    this.crumbs = new THREE.Points(cg, crumbMaterial(this.scale));
    this.crumbs.frustumCulled = false;
  }

  /** Dirt comes away from around p for a moment. */
  crumble(p: THREE.Vector3, amount = 1, size = 1) {
    this.emitters.push({ p: p.clone(), rate: 380 * amount + 120 * Math.random(), left: 0.35 + Math.random() * 1.0 * amount, spread: 0.03 + 0.05 * amount, acc: 0, size });
  }

  /** Grit thrown up and back from a point on the floor, as from under a paw. */
  kick(p: THREE.Vector3, back: THREE.Vector3, n = 6) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % CRUMBS;
      const j = i * 3, up = 0.35 + Math.random() * 0.9, out = 0.15 + Math.random() * 0.55;
      this.pos[j] = p.x + (Math.random() - 0.5) * 0.03; this.pos[j + 1] = p.y + Math.random() * 0.006; this.pos[j + 2] = p.z + (Math.random() - 0.5) * 0.03;
      this.vel[j] = back.x * out + (Math.random() - 0.5) * 0.5; this.vel[j + 1] = up; this.vel[j + 2] = back.z * out + (Math.random() - 0.5) * 0.5;
      const r = Math.random();
      this.data[i * 4] = Math.random() < 0.5 ? 0.0004 + r * 0.0008 : 0.001 + r * r * 0.007;
      this.data[i * 4 + 1] = Math.random(); this.data[i * 4 + 2] = 1; this.data[i * 4 + 3] = 0;
      this.state[i] = 1; this.age[i] = 0;
    }
    this.posAttr.needsUpdate = this.dataAttr.needsUpdate = true;
  }

  private spawn(e: Emitter) {
    const i = this.next;
    this.next = (this.next + 1) % CRUMBS;
    const j = i * 3;
    this.pos[j] = e.p.x + (Math.random() - 0.5) * e.spread * 2;
    this.pos[j + 1] = e.p.y - Math.random() * 0.02;
    this.pos[j + 2] = e.p.z + (Math.random() - 0.5) * e.spread * 2;
    // start in the open, not inside the roof
    for (let k = 0; k < 6 && this.world.sample(this.pos[j], this.pos[j + 1], this.pos[j + 2]) > -0.006; k++) this.pos[j + 1] -= 0.012;
    this.vel[j] = (Math.random() - 0.5) * 0.12;
    this.vel[j + 1] = -Math.random() * 0.25;
    this.vel[j + 2] = (Math.random() - 0.5) * 0.12;
    // mostly dust and grit, now and then a proper clod
    const r = Math.random();
    this.data[i * 4] = (Math.random() < 0.5 ? 0.0004 + r * 0.0008 : Math.random() < 0.06 ? 0.008 + r * 0.014 : 0.0012 + r * r * r * 0.009) * e.size;
    this.data[i * 4 + 1] = Math.random();
    this.data[i * 4 + 2] = 1;
    this.data[i * 4 + 3] = 0;
    this.state[i] = 1;
    this.age[i] = 0;
  }

  update(dt: number) {
    const { pos, vel, state, world, n } = this;
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.acc += e.rate * dt * Math.min(1, e.left * 3);
      while (e.acc >= 1) { e.acc -= 1; this.spawn(e); }
      e.left -= dt;
      if (e.left <= 0) this.emitters.splice(k, 1);
    }
    let any = false;
    for (let i = 0; i < CRUMBS; i++) {
      if (state[i] !== 1) continue;
      any = true;
      // whatever is still rattling about after a few seconds has found its place
      if ((this.age[i] += dt) > 4) {
        state[i] = 2;
        for (const p of world.puddles) if (pos[i * 3 + 1] < p.y + 0.004 && (pos[i * 3] - p.x) ** 2 + (pos[i * 3 + 2] - p.z) ** 2 < p.r * p.r) { state[i] = 0; this.data[i * 4 + 2] = 0; }
        continue;
      }
      const j = i * 3;
      const size = this.data[i * 4];
      // the smallest ones feel the air
      const drag = Math.exp(-dt * (0.007 / size));
      vel[j] *= drag; vel[j + 2] *= drag;
      vel[j + 1] = (vel[j + 1] - 9.81 * dt) * drag;
      const x = pos[j] + vel[j] * dt, y = pos[j + 1] + vel[j + 1] * dt, z = pos[j + 2] + vel[j + 2] * dt;
      if (world.sample(x, y, z) > -size * 0.5) {
        world.normalAt(x, y, z, n, 0.02);
        const vn = vel[j] * n.x + vel[j + 1] * n.y + vel[j + 2] * n.z;
        if (vn < 0) {
          // bounce, losing most of it; what is left carries it on down any slope
          vel[j] = (vel[j] - 1.25 * vn * n.x) * 0.6; vel[j + 1] = (vel[j + 1] - 1.25 * vn * n.y) * 0.6; vel[j + 2] = (vel[j + 2] - 1.25 * vn * n.z) * 0.6;
        }
        if (n.y > 0.45 && vel[j] * vel[j] + vel[j + 1] * vel[j + 1] + vel[j + 2] * vel[j + 2] < 0.12) {
          state[i] = 2;
          // what comes to rest under water is gone from sight
          for (const p of world.puddles) if (y < p.y + 0.004 && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) { state[i] = 0; this.data[i * 4 + 2] = 0; }
        }
      } else { pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; }
    }
    if (any || this.emitters.length) this.posAttr.needsUpdate = this.dataAttr.needsUpdate = true;
  }
}
