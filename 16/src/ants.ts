// Carpenter ants (hästmyra, Camponotus herculeanus, the biggest ant in Sweden, up to 15 mm, black with a dark red
// thorax, nesting inside spruce trunks): trails from the trunk out over the moss to where they forage, ants going
// both ways along them. Half the trunks near you have one, by hash. A trail is sampled every centimetre: over the moss's
// top, wandering, then up the trunk on the side facing the nest. Each ant keeps its own lane a few millimetres
// off the line, its own pace, and now and then stops a moment, as they do when they meet.
// One instanced mesh, about 14 mm long: a black gaster and head, a dark red thorax, six legs that step
// in two tripods and two antennae that feel about, all moved in the vertex shader.
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { groundHeight, mossAt, puddleAt } from './world';
import { trunkFoot, trunkRadius, type Trunk } from './trees';

const MAX = 1500; // ants drawn at most
const NEAR = 6; // trails within this of you exist
const SEE = 4.5; // ants further than this are under a pixel or two: not drawn
const STEP = 0.01; // trail samples, a centimetre apart
const CLIMB = 1.8; // how far up the trunk the trail goes

interface Ant { s: number; dir: number; speed: number; lane: number; phase: number; rest: number }
interface Trail { key: string; pts: Float32Array; ups: Float32Array; n: number; ants: Ant[] }

// over the moss's top, where the frond tips are, so they show (down in it they were lost)
const ground = (x: number, z: number) => { const g = groundHeight(x, z); return g + 0.068 * mossAt(x, g, z) + 0.006; };
function groundUp(x: number, z: number, ups: number[]) {
  const e = 0.02, gx = ground(x + e, z) - ground(x - e, z), gz = ground(x, z + e) - ground(x, z - e);
  const nl = Math.hypot(gx, 2 * e, gz);
  ups.push(-gx / nl, (2 * e) / nl, -gz / nl);
}

const inPuddle = (x: number, z: number) => { const pd = puddleAt(x, z); return pd !== null && pd.u < 1.06; };

/**
 * A lone ant crossing in front of you, a scout off its trail: a wandering line over the moss from one side of
 * the view to the other, a hand or two ahead, walked once. Skipped if the path crosses a puddle.
 */
function makeStray(cam: THREE.Camera): Trail | null {
  const f = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  const sx = -f.z, sz = f.x;
  const d = 0.25 + Math.random() * 0.15, half = 0.15 + d * 0.4, slant = (Math.random() - 0.5) * 0.6;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const w = Math.random() * 6.28, k = 2 + Math.random() * 3;
  const pts: number[] = [], ups: number[] = [];
  const steps = Math.ceil((2 * half) / STEP);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, t = (u * 2 - 1) * half * dir;
    const ahead = d + t * slant + 0.03 * Math.sin(u * k * Math.PI + w);
    const x = cam.position.x + f.x * ahead + sx * t, z = cam.position.z + f.z * ahead + sz * t;
    if (inPuddle(x, z)) return null;
    pts.push(x, ground(x, z), z);
    groundUp(x, z, ups);
  }
  const n = pts.length / 3;
  return { key: 'stray', pts: new Float32Array(pts), ups: new Float32Array(ups), n, ants: [{ s: 0, dir: 1, speed: 0.035 + 0.02 * Math.random(), lane: 0, phase: Math.random() * 100, rest: 0 }] };
}

/** A trail for this trunk, or null (half have none). Avoids puddles by picking a dry direction or stopping at the bank. */
function makeTrail(t: Trunk): Trail | null {
  const r = mulberry32((Math.imul(Math.round(t.x * 100), 0x2c1b3c6d) ^ Math.imul(Math.round(t.z * 100), 0x297a2d39) ^ 0xa17) >>> 0);
  if (r() > 0.5) return null;
  const a0 = r() * Math.PI * 2; // the nest lies this way from the trunk
  const far = t.r * 1.5 + 1.4 + 1.6 * r();
  const w1 = r() * 6.28, w2 = r() * 6.28, k1 = 2 + r() * 2, k2 = 5 + r() * 4;
  // pick the first candidate direction from the trunk whose ground leg stays dry (fallback: trim at the bank)
  let a = a0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const cand = a0 + attempt * 1.0472;
    const ex = Math.cos(cand), ez = Math.sin(cand), px = -ez, pz = ex;
    let wet = false;
    for (let s = 0; s <= 24 && !wet; s++) {
      const u = s / 24, d = far * (1 - u);
      const wig = Math.sin(u * Math.PI) * (0.18 * Math.sin(u * k1 * Math.PI + w1) + 0.05 * Math.sin(u * k2 * Math.PI + w2));
      if (inPuddle(t.x + ex * d + px * wig, t.z + ez * d + pz * wig)) wet = true;
    }
    if (!wet) { a = cand; break; }
  }
  const nx = t.x + Math.cos(a) * far, nz = t.z + Math.sin(a) * far;
  const pts: number[] = [], ups: number[] = [];
  // over the moss: from the nest to the bark, wandering a little either side of the straight line
  const ex = Math.cos(a), ez = Math.sin(a), px = -ez, pz = ex;
  let lx = nx, lz = nz;
  const steps = Math.ceil(far / STEP);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, d = far * (1 - u);
    const wig = Math.sin(u * Math.PI) * (0.18 * Math.sin(u * k1 * Math.PI + w1) + 0.05 * Math.sin(u * k2 * Math.PI + w2));
    const x = t.x + ex * d + px * wig, z = t.z + ez * d + pz * wig;
    // never walk through water: if the outer end hits a puddle, start the trail on the dry bank nearer the trunk
    if (inPuddle(x, z)) { pts.length = 0; ups.length = 0; continue; }
    // stop at the bark (the root flare too)
    const phi = Math.atan2(z - t.z, x - t.x);
    const y = ground(x, z);
    if (Math.hypot(x - t.x, z - t.z) <= trunkRadius(t, phi, Math.max(0, y - trunkFoot(t))) + 0.003) break;
    pts.push(x, y, z);
    groundUp(x, z, ups); // the ground's normal, from its slope
    lx = x; lz = z;
  }
  if (pts.length < 30) return null;
  // up the bark, on the side facing the nest, drifting round a little as it goes
  const phi0 = Math.atan2(lz - t.z, lx - t.x);
  const h0 = pts[pts.length - 2] - trunkFoot(t);
  const drift = (r() - 0.5) * 0.6;
  for (let h = h0; h < CLIMB; h += STEP) {
    const phi = phi0 + drift * Math.sin((h / CLIMB) * Math.PI * 0.5) + 0.04 * Math.sin(h * 9 + w1);
    const R = trunkRadius(t, phi, h) + 0.0015;
    pts.push(t.x + Math.cos(phi) * R, trunkFoot(t) + h, t.z + Math.sin(phi) * R);
    ups.push(Math.cos(phi), 0, Math.sin(phi));
  }
  const n = pts.length / 3;
  const L = n * STEP;
  const ants: Ant[] = [];
  const count = Math.round(L * (14 + 10 * r())); // per metre of trail
  for (let i = 0; i < count; i++) {
    ants.push({ s: r() * L, dir: r() < 0.5 ? 1 : -1, speed: 0.025 + 0.02 * r(), lane: (r() - 0.5) * 0.012, phase: r() * 100, rest: 0 });
  }
  return { key: `${t.x.toFixed(2)},${t.z.toFixed(2)}`, pts: new Float32Array(pts), ups: new Float32Array(ups), n, ants };
}

/** The ant, nine millimetres long, along +z, its feet on y = 0. */
function antGeometry() {
  const pos: number[] = [], nrm: number[] = [], leg: number[] = [], root: number[] = [], tone: number[] = [];
  const ellipsoid = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, t: number) => {
    const g = new THREE.SphereGeometry(1, 10, 7).toNonIndexed();
    const p = g.attributes.position, nn = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(cx + p.getX(i) * rx, cy + p.getY(i) * ry, cz + p.getZ(i) * rz);
      const v = new THREE.Vector3(nn.getX(i) / rx, nn.getY(i) / ry, nn.getZ(i) / rz).normalize();
      nrm.push(v.x, v.y, v.z);
      leg.push(0); root.push(0, 0, 0); tone.push(t);
    }
  };
  // a thin three-sided tube through points, for legs and antennae
  const tube = (ps: THREE.Vector3[], rad: number, id: number, t: number) => {
    const rt = ps[0];
    for (let k = 0; k < ps.length - 1; k++) {
      const a = ps[k], b = ps[k + 1];
      const d = b.clone().sub(a).normalize();
      const u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const s1 = u.clone().cross(d).normalize(), s2 = d.clone().cross(s1).normalize();
      const ring = [0, 1, 2].map((j) => s1.clone().multiplyScalar(Math.cos((j * Math.PI * 2) / 3)).addScaledVector(s2, Math.sin((j * Math.PI * 2) / 3)));
      for (let j = 0; j < 3; j++) {
        const n0 = ring[j], n1 = ring[(j + 1) % 3];
        const q = [a.clone().addScaledVector(n0, rad), b.clone().addScaledVector(n0, rad), b.clone().addScaledVector(n1, rad), a.clone().addScaledVector(n1, rad)];
        for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
          for (const i of [i0, i1, i2]) {
            pos.push(q[i].x, q[i].y, q[i].z);
            const nv = i === 0 || i === 1 ? n0 : n1;
            nrm.push(nv.x, nv.y, nv.z);
            leg.push(id); root.push(rt.x, rt.y, rt.z); tone.push(t);
          }
        }
      }
    }
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  ellipsoid(0, 0.0017, -0.0029, 0.0016, 0.0014, 0.0023, 0); // gaster, black
  ellipsoid(0, 0.0016, -0.0004, 0.0005, 0.0007, 0.0005, 1); // petiole
  ellipsoid(0, 0.0019, 0.001, 0.0008, 0.0008, 0.0016, 1); // thorax
  ellipsoid(0, 0.0021, 0.0033, 0.0012, 0.001, 0.0011, 0.25); // head, near black
  ellipsoid(0, 0.0019, 0.0044, 0.0005, 0.0003, 0.0004, 0); // mandibles
  // legs: three pairs from the thorax, each a femur up and out, a tibia down to the moss
  const zs = [0.0018, 0.0009, 0.0];
  const reach = [0.0016, 0.0002, -0.0022];
  zs.forEach((z, p) => {
    for (const s of [-1, 1]) {
      const id = 1 + p * 2 + (s > 0 ? 1 : 0);
      tube([V(s * 0.0006, 0.0015, z), V(s * 0.0022, 0.0026, z + reach[p] * 0.5), V(s * 0.0034, 0.0, z + reach[p])], 0.00016, id, 0.35);
    }
  });
  // antennae: elbowed, up from the head and forward
  for (const s of [-1, 1]) tube([V(s * 0.0005, 0.0028, 0.0039), V(s * 0.0011, 0.0046, 0.0046), V(s * 0.0019, 0.0042, 0.0068)], 0.00012, s > 0 ? 8 : 7, 0.35);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('leg', new THREE.Float32BufferAttribute(leg, 1));
  g.setAttribute('root', new THREE.Float32BufferAttribute(root, 3));
  g.setAttribute('tone', new THREE.Float32BufferAttribute(tone, 1));
  return g;
}

const vertexShader = /* glsl */ `
uniform float uTime;
attribute float leg;
attribute vec3 root;
attribute float tone;
attribute float aPhase; // where this ant is in its stride
attribute float aWalk; // 0 standing .. 1 walking
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vTone;
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
void main() {
  vec3 p = position;
  vec3 n = normal;
  if (leg > 0.5 && leg < 6.5) {
    // two tripods: front and back on one side with the middle on the other, half a stride apart
    float pair = floor((leg - 1.0) * 0.5), side = mod(leg - 1.0, 2.0);
    float tri = mod(pair + side, 2.0);
    float ph = aPhase + tri * 3.14159;
    float swing = sin(ph) * 0.45 * aWalk;
    float lift = max(0.0, cos(ph)) * 0.0007 * aWalk * smoothstep(0.0, 0.004, length(p.xz - root.xz));
    p = root + rotY(p - root, side > 0.5 ? -swing : swing);
    n = rotY(n, side > 0.5 ? -swing : swing);
    p.y += lift;
  } else if (leg > 6.5) {
    // antennae feel about, faster than the legs
    float a = sin(aPhase * 0.7 + leg * 2.1) * 0.35 + sin(uTime * 3.0 + leg) * 0.15;
    p = root + rotY(p - root, a);
    n = rotY(n, a);
  } else {
    // the body rocks a hair with the stride
    p.y += sin(aPhase * 2.0) * 0.00012 * aWalk;
  }
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vTone = tone;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vTone;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  // carpenter ant: black, the thorax a dark red; glossy chitin
  vec3 col = mix(vec3(0.008, 0.007, 0.006), vec3(0.075, 0.026, 0.013), vTone);
  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0) * shadow;
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 40.0) * 0.6 * shadow + pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.05;
  vec3 c = col * (0.5 * skyTint(N, 1.0) + 2.0 * diff) + vec3(1.0, 0.85, 0.6) * spec;
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;

export class Ants {
  readonly mesh: THREE.InstancedMesh;
  private trails = new Map<string, Trail>();
  private phase: THREE.InstancedBufferAttribute;
  private walk: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private stray: Trail | null = null;
  private strayIn = 4 + Math.random() * 6; // seconds to the next one crossing in front of you

  constructor(setup: (m: THREE.ShaderMaterial) => void, private camera: THREE.Camera) {
    const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: {} });
    setup(mat);
    const g = antGeometry();
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.walk = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('aPhase', this.phase);
    g.setAttribute('aWalk', this.walk);
    this.mesh = new THREE.InstancedMesh(g, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Trails come and go with the trunks near you; every ant takes its step. */
  update(dt: number, px: number, pz: number, trunks: Trunk[]) {
    for (const t of trunks) {
      if (Math.hypot(t.x - px, t.z - pz) > NEAR) continue;
      const key = `${t.x.toFixed(2)},${t.z.toFixed(2)}`;
      if (this.trails.has(key)) continue;
      const tr = makeTrail(t);
      this.trails.set(key, tr ?? { key, pts: new Float32Array(0), ups: new Float32Array(0), n: 0, ants: [] });
    }
    for (const [key, tr] of this.trails) {
      const [x, z] = key.split(',').map(Number);
      if (Math.hypot(x - px, z - pz) > NEAR + 2) this.trails.delete(key);
      void tr;
    }
    // now and then a lone one comes by in front of you; gone when it has crossed
    if (this.stray && this.stray.ants[0].s >= (this.stray.n - 1) * STEP) this.stray = null;
    if (!this.stray && (this.strayIn -= dt) <= 0) {
      this.stray = makeStray(this.camera);
      this.strayIn = this.stray ? 10 + Math.random() * 25 : 3 + Math.random() * 4;
    }
    const ph = this.phase.array as Float32Array, wk = this.walk.array as Float32Array;
    const f = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), p = new THREE.Vector3();
    let count = 0;
    const all = this.stray ? [...this.trails.values(), this.stray] : this.trails.values();
    for (const tr of all) {
      if (!tr.n) continue;
      const stray = tr === this.stray;
      const L = (tr.n - 1) * STEP;
      for (const a of tr.ants) {
        // now and then one stops a moment, as when two meet
        if (a.rest > 0) a.rest -= dt;
        else {
          a.s += a.dir * a.speed * dt;
          if (Math.random() < dt * 0.08) a.rest = 0.3 + Math.random() * 0.9;
        }
        if (stray && a.s >= L) continue;
        if (a.s > L) { a.s = L; a.dir = -1; }
        if (a.s < 0) { a.s = 0; a.dir = 1; }
        const walking = a.rest > 0 ? 0 : 1;
        a.phase += dt * a.speed * 900 * walking; // a stride every few millimetres
        if (count >= MAX) continue;
        const u = a.s / STEP, i = Math.min(tr.n - 2, Math.floor(u)), k = u - i;
        const P = tr.pts, U = tr.ups;
        p.set(P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * k, P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * k, P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * k);
        if (Math.hypot(p.x - px, p.z - pz) > SEE) continue;
        f.set(P[i * 3 + 3] - P[i * 3], P[i * 3 + 4] - P[i * 3 + 1], P[i * 3 + 5] - P[i * 3 + 2]).multiplyScalar(a.dir);
        up.set(U[i * 3], U[i * 3 + 1], U[i * 3 + 2]);
        f.addScaledVector(up, -f.dot(up)).normalize();
        side.crossVectors(up, f).normalize();
        // its own lane, wandering a few millimetres
        p.addScaledVector(side, a.lane + 0.003 * Math.sin(a.phase * 0.013 + a.lane * 300));
        // a big worker, about 14 mm
        const sc = stray ? 3.1 : 1.55; // the one crossing in front of you twice the size, a cheat that does not show
        this.m.makeBasis(side.multiplyScalar(sc), up.multiplyScalar(sc), f.multiplyScalar(sc)).setPosition(p);
        this.mesh.setMatrixAt(count, this.m);
        ph[count] = a.phase;
        wk[count] = walking;
        count++;
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phase.needsUpdate = true;
    this.walk.needsUpdate = true;
  }
}
