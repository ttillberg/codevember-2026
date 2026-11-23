// Spruce and birch trunks, columns rising out of the moss into the haze. One per cell of a coarse grid, by hash.
// Three levels of detail, each an instanced mesh sharing one material: near trunks have their root flare in
// fine geometry, mid ones a coarser version, far ones are octagonal columns. Trunks are sorted into the
// levels as you move. The bark is a shader: spruce, small round scales overlapping like tiles, their lower edges
// lifted, bump-mapped by finite differences, algae and crust lichen; up close fibres on the scales. Each
// stands on a little hill of the ground's own moss (world.ts).
import * as THREE from 'three';
import { mossLighting } from './shaders';
import { groundHeight, TREE_CELL, trunkInCell, type Trunk } from './world';


const RANGE = 34; // trunks are placed this far out
const LOD_DIST = [4.5, 12]; // fine up to here, mid up to the next, far beyond
const HEIGHT = 30;
const MAX = 600;

export { TREE_CELL, trunkInCell, type Trunk } from './world';

/**
 * A unit trunk (radius 1 at breast height, HEIGHT tall) with its root flare: buttresses spreading out low down
 * and sinking into the ground. Rings are packed towards the foot, where the detail is.
 */
const buttress = (a: number) => Math.pow(Math.abs(Math.sin(a * 2.5 + 0.7)), 3) * 0.7 + Math.pow(Math.abs(Math.sin(a * 1.5 + 2.1)), 4) * 0.5;
/** The unit trunk's radius at an angle (its own) and a height over its foot. */
const radius = (a: number, y: number, fl = 1) => {
  const flare = (Math.exp(-Math.max(y, 0) / 0.28) * (0.15 + 0.7 * buttress(a)) + Math.exp(-Math.max(y, 0) / 2.5) * 0.1) * fl;
  const taper = 1 - 0.65 * (y / HEIGHT);
  return taper * (1 + flare);
};
/** Where a trunk's foot is: the bottom of the unit trunk, a little into the ground. */
export const trunkFoot = (t: Trunk) => groundHeight(t.x, t.z) - 0.03;
/** A trunk's bark, from its middle, at a world angle round it (atan2 of z, x) and a height over its foot. */
export const trunkRadius = (t: Trunk, phi: number, y: number) => t.r * radius(phi + t.turn, y / t.h, t.birch ? BIRCH_FLARE : 1);
/** a birch's foot spreads less: a swelling, not buttresses */
const BIRCH_FLARE = 0.45;

function trunkGeometry(radial: number, rings: number, fl = 1) {
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const ys: number[] = [];
  for (let j = 0; j <= rings; j++) ys.push(-0.25 + (HEIGHT + 0.25) * Math.pow(j / rings, 2.6));
  for (let j = 0; j <= rings; j++) {
    const y = ys[j];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const r = radius(a, y, fl);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      // normal from the radius' change around and up
      const e = 0.01;
      const dra = (radius(a + e, y, fl) - radius(a - e, y, fl)) / (2 * e);
      const dry = (radius(a, y + e, fl) - radius(a, y - e, fl)) / (2 * e);
      const n = new THREE.Vector3(Math.cos(a) * r + Math.sin(a) * dra, -dry * r, Math.sin(a) * r - Math.cos(a) * dra).normalize();
      nrm.push(n.x, n.y, n.z);
      uvs.push(i / radial, y);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) {
    const a = j * (radial + 1) + i, b = a + radial + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); // around 0..1, height in units
  g.setIndex(idx);
  return g;
}

export class Trees {
  readonly root = new THREE.Group();
  trunks: Trunk[] = []; // all placed, for collisions and the autofocus
  changed = false;
  readonly levels: THREE.InstancedMesh[];
  readonly birches: THREE.InstancedMesh[];
  private cellKey = '';
  private lastSort = new THREE.Vector2(Infinity, Infinity);

  constructor(setup: (m: THREE.ShaderMaterial) => void) {
    const make = (birch: boolean) => {
      const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {}, defines: birch ? { BIRCH: 1 } : {} });
      setup(mat);
      const fl = birch ? BIRCH_FLARE : 1;
      return [trunkGeometry(48, 40, fl), trunkGeometry(16, 14, fl), trunkGeometry(8, 3, fl)].map((g) => {
        const m = new THREE.InstancedMesh(g, mat, MAX);
        m.count = 0;
        m.frustumCulled = false;
        this.root.add(m);
        return m;
      });
    };
    this.levels = make(false);
    this.birches = make(true);
  }

  update(px: number, pz: number) {
    const ix0 = Math.floor(px / TREE_CELL), iz0 = Math.floor(pz / TREE_CELL);
    const key = `${ix0},${iz0}`;
    if (key !== this.cellKey) {
      this.cellKey = key;
      const R = Math.ceil(RANGE / TREE_CELL);
      this.trunks = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const t = trunkInCell(ix0 + dx, iz0 + dz);
        if (!t || Math.hypot(t.x - px, t.z - pz) > RANGE) continue;
        if (Math.hypot(t.x, t.z) < 1.6) continue; // none right where you start
        this.trunks.push(t);
      }
      this.lastSort.set(Infinity, Infinity);
    }
    // sort into the levels every half step
    if (Math.hypot(px - this.lastSort.x, pz - this.lastSort.y) < 0.5) return;
    this.lastSort.set(px, pz);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const counts = [0, 0, 0], bcounts = [0, 0, 0];
    for (const t of this.trunks) {
      const d = Math.hypot(t.x - px, t.z - pz) - t.r;
      const lod = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      const lvl = (t.birch ? this.birches : this.levels)[lod];
      const cn = t.birch ? bcounts : counts;
      if (cn[lod] >= MAX) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.turn);
      s.set(t.r, t.h, t.r); // a spruce shorter: the unit trunk squashed
      p.set(t.x, trunkFoot(t), t.z);
      lvl.setMatrixAt(cn[lod]++, m.compose(p, q, s));
    }
    this.levels.forEach((l, i) => { l.count = counts[i]; l.instanceMatrix.needsUpdate = true; });
    this.birches.forEach((l, i) => { l.count = bcounts[i]; l.instanceMatrix.needsUpdate = true; });
    this.changed = true;
  }

  /** Is the point inside a trunk? For the autofocus. */
  hit(x: number, y: number, z: number, among: Trunk[] = this.trunks) {
    // the root flare, about its average: the full buttress was too wide, and standing by a trunk the focus fell
    // in the air in front of it
    for (const t of among) {
      const dy = Math.max(0, y - groundHeight(t.x, t.z));
      if (Math.hypot(x - t.x, z - t.z) < t.r * (1.02 + 0.5 * Math.exp(-dy / 0.28))) return true;
    }
    return false;
  }

  /** Trunks are solid: the pushed-out position. */
  collide(x: number, z: number, pad: number) {
    for (const t of this.trunks) {
      const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz), min = t.r * 1.5 + pad; // the root flare
      if (d < min && d > 1e-6) { x = t.x + (dx / d) * min; z = t.z + (dz / d) * min; }
    }
    return [x, z];
  }
}

// noise
const common = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
`;

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vBark; // around (in units of circumference at the trunk's radius), height
varying float vR;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  float r = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  #else
  float r = 1.0, sy = 1.0;
  #endif
  vec4 wp = modelMatrix * lp;
  vNormal = normalize(mat3(modelMatrix) * ln);
  vBark = vec2(uv.x * 6.2831853 * r, uv.y * sy); // in metres on a squashed trunk too
  vWorldPos = wp.xyz;
  vR = r;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vBark;
varying float vR;
${common}
// Up close, the grain on a plate: fine vertical fibres, hairline cracks and subtle micro-pitting.
float grain(vec2 b) {
  float fib = n21(b * vec2(210.0, 22.0)) * 0.55 + n21(b * vec2(460.0, 55.0)) * 0.45;
  float pit = n21(b * vec2(120.0, 85.0));
  return fib * 0.68 + pit * 0.32;
}

// Mature Scots pine / spruce bark (after reference): crisp, predominantly vertical dark rough charcoal-grey
// fissures with heavily shredded vertical bark fibres, separating tall jagged jigsaw-like papery plates
// (~5 cm wide x 16 cm tall) in dusty ash-taupe and warm cinnamon-terracotta peeling in sharp thin layers,
// with olive moss clinging inside the crevices. All horizontal frequencies wrap cleanly round the trunk.
float CIRC; // trunk circumference in metres
float wNoise(vec2 b, float around, float up, vec2 off) {
  float u = fract(b.x / CIRC);
  float x = u * around;
  vec2 q = vec2(x, b.y * up) + off;
  vec2 q2 = vec2(x - around, b.y * up) + off;
  return mix(n21(q), n21(q2), smoothstep(0.88, 1.0, u));
}

// Deep vertical fissure & ridge field: returns (ridge 0 in chasm .. 1 on plateau, rough shredded crevice bark).
vec2 fissureField(vec2 b, float px) {
  float nA = max(10.0, floor(CIRC * 13.0 + 0.5)); // vertical ridges ~7.5 cm apart
  float nB = max(18.0, floor(CIRC * 24.0 + 0.5)); // branching secondary vertical cracks
  float nC = max(36.0, floor(CIRC * 58.0 + 0.5)); // sharp torn-edge crags
  // subtle vertical meander (keeps furrows running predominantly straight up and down like pine bark)
  float wx = (wNoise(b, max(6.0, floor(CIRC * 7.0)), 1.4, vec2(1.7, 3.1)) - 0.5) * 0.05
           + (wNoise(b, nB, 5.5, vec2(7.3, 2.4)) - 0.5) * 0.018;
  vec2 bw = vec2(b.x + wx, b.y);
  // tall vertical channels (6-8x taller than wide)
  float f1 = abs(wNoise(bw, nA, 1.5, vec2(4.2, 1.1)) - 0.5) * 2.0;
  float f2 = abs(wNoise(bw, nB, 3.2, vec2(13.5, 6.7)) - 0.5) * 2.0;
  // high-frequency splintered wall edge so fissures look craggy and chipped, never smooth curves
  float jag = (wNoise(bw, nC, 16.0, vec2(9.1, 4.3)) - 0.5) * 0.28 * (1.0 - smoothstep(0.008, 0.032, px));
  float ch = min(f1, f2 * 1.15 + 0.1) + jag;
  float aa = max(0.025, px * 3.5);
  float ridge = smoothstep(0.20 - aa, 0.38 + aa, ch);
  // rough, craggy, vertically shredded bark inside the fissures (strong contrast between splinters and deep gaps)
  float s1 = wNoise(bw, max(36.0, floor(CIRC * 68.0)), 18.0, vec2(2.1, 8.8));
  float s2 = wNoise(bw, max(72.0, floor(CIRC * 150.0)), 42.0, vec2(11.4, 3.2));
  float s3 = wNoise(bw, max(120.0, floor(CIRC * 280.0)), 90.0, vec2(5.7, 1.9));
  float shred = s1 * 0.45 + s2 * 0.35 + s3 * 0.20;
  return vec2(ridge, shred);
}

// Tall jagged flaky plates sitting on the ridges (single 3x3 Voronoi pass, wrapped around the trunk).
// Outputs: plate mask (0 in crack .. 1 on flat plate), peeling flake depth (0..1), plate id, flake lip, bevel.
void barkPlates(vec2 b, float px, out float plate, out float flake, out float cellId, out float lip, out vec2 bevel) {
  float around = max(14.0, floor(CIRC * 16.5 + 0.5)); // plates ~6 cm wide
  float perY = 6.2;                                    // plates ~16 cm tall (tall vertical slabs)
  float ang = b.x / CIRC;
  vec2 p = vec2(ang * around, b.y * perY);
  // crisp multi-scale torn-paper warp: modest macro curve + sharp fine jagged edges
  float wFade = 1.0 - smoothstep(0.008, 0.032, px);
  float w1 = wNoise(b, around * 0.6, 2.4, vec2(2.3, 5.1)) - 0.5;
  float w2 = wNoise(b, around * 1.8, 7.5, vec2(8.7, 1.9)) - 0.5;
  float w3 = wNoise(b, around * 5.0, 22.0, vec2(4.5, 9.2)) - 0.5;
  p += vec2(w1 * 0.42 + w2 * 0.24 + w3 * 0.14 * wFade, w1 * 0.35 + w2 * 0.22 + w3 * 0.12 * wFade);
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0;
  vec2 id = vec2(0.0), q1 = vec2(0.0), q2 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = i + o;
    c.x = mod(c.x, around);
    vec2 pt = o + 0.14 + 0.72 * vec2(h21(c), h21(c + 17.3));
    float l = length((pt - f) * vec2(1.0, 0.9));
    if (l < f1) { f2 = f1; q2 = q1; f1 = l; q1 = pt; id = c; } else if (l < f2) { f2 = l; q2 = pt; }
  }
  float edge = f2 - f1;
  float rag = ((n21(p * vec2(7.0, 6.0)) - 0.5) * 0.12 + (n21(p * vec2(19.0, 15.0)) - 0.5) * 0.07) * wFade;
  float aa = max(0.014, px * 4.0);
  plate = smoothstep(0.025, 0.085 + aa, edge + rag);
  vec2 dq = q2 - q1;
  float bevelMask = (1.0 - smoothstep(0.015, 0.11 + aa, edge + rag)) * smoothstep(0.0, 0.03, edge + rag);
  bevel = normalize(dq + 1e-5) * bevelMask;
  cellId = h21(id + 3.1);
  // sharp, torn papery peeling layers on each plate (3 distinct overlapping flakes with thin dark shadow edges)
  vec2 fp = b * vec2(26.0, 14.0) + vec2(cellId * 17.3, cellId * 11.1);
  fp += (vec2(n21(fp * 0.4), n21(fp * 0.4 + 5.7)) - 0.5) * 2.4
      + (vec2(n21(fp * 1.8 + 2.3), n21(fp * 1.8 + 8.1)) - 0.5) * 0.75 * wFade;
  float fl = n21(fp) * 0.62 + n21(fp * 2.8 + 3.1) * 0.38;
  float flAa = max(0.008, px * 6.5);
  float s1 = smoothstep(0.34 - flAa, 0.34 + flAa, fl);
  float s2 = smoothstep(0.58 - flAa, 0.58 + flAa, fl);
  float s3 = smoothstep(0.76 - flAa, 0.76 + flAa, fl);
  flake = (s1 + s2 + s3) / 3.0;
  // razor-thin dark shadow right along each peeling flake step
  lip = (smoothstep(0.34 - flAa * 2.8, 0.34, fl) * (1.0 - s1)
       + smoothstep(0.58 - flAa * 2.8, 0.58, fl) * (1.0 - s2)
       + smoothstep(0.76 - flAa * 2.8, 0.76, fl) * (1.0 - s3)) * wFade;
}
#ifdef BIRCH
// Birch bark, in metres along it (round, up), drawn from what is there rather than from soft noise:
//  - the white: chalky, going cream, faintly streaked round the trunk by the paper's own fibres, mottled grey
//  - lenticels: short dark dashes in rows round the trunk, lens-shaped, of all lengths, each a little raised
//  - the paper peeling: thin strips going round part of the trunk, a shade pinker, lifted, their lower edge
//    curled out (a bright lip, a dark line under it)
//  - black marks: crusty, rough-edged, in broken bands and chevrons, cracked across inside
//  - at the foot an old birch's black bark, split in vertical fissures, low and uneven
// The relief is a height, its normal by finite differences, eased out where it is smaller than a pixel.
float BR; // this trunk's radius
float BU, BC; // where round the trunk (0..1) and its circumference
// Noise round the trunk at k (times six) per metre round, o up it: straight round, so a mark is level (a circle
// in the noise with the height added to one axis sheared it, diagonal on the side facing you); the last tenth
// round crossfades into the first, so it closes without a seam.
float nw(float k, vec2 o) {
  float L = BC * 6.0 * k, x = BU * L;
  return mix(n21(vec2(x, 0.0) + o), n21(vec2(x - L, 0.0) + o), smoothstep(0.9, 1.0, BU));
}
float nw(float k, float o) { return nw(k, vec2(o)); }
float PX; // a pixel's size on the bark, in metres: detail finer than it is eased out (it aliased into stripes)
// the bark at b: its colour (out) and its height
float birchAt(vec2 b, out vec3 col, out float dark) {
  float C = 6.2831853 * BR;
  float u = b.x / C; // 0..1 round
  BU = u; BC = C;
  float h = 0.0;
  // the white
  col = vec3(0.82, 0.8, 0.75) * (0.88 + 0.14 * nw(2.0, vec2(0.0, b.y * 3.0)));
  col *= 0.95 + 0.05 * n21(vec2(floor(u * max(8.0, floor(C * 60.0))) * 1.7, b.y * 500.0)) * (1.0 - smoothstep(0.0005, 0.002, PX)); // fibres, round
  col = mix(col, vec3(0.62, 0.62, 0.6), smoothstep(0.6, 0.85, nw(4.0, vec2(2.0, b.y * 9.0))) * 0.25); // grey mottling
  // the paper peeling in strips
  float py = b.y * 7.0 + 0.6 * nw(1.5, 11.0);
  float pid = floor(py), pf = fract(py);
  float has = step(h21(vec2(pid, 5.0)), 0.5) * smoothstep(0.45, 0.6, nw(2.0, vec2(pid * 3.1, 1.0)));
  float strip = has * smoothstep(0.5, 0.53, pf) * (1.0 - smoothstep(0.84, 0.86, pf));
  col = mix(col, vec3(0.88, 0.78, 0.7), strip * 0.6);
  float lip = has * smoothstep(0.82, 0.85, pf) * (1.0 - smoothstep(0.85, 0.87, pf)); // the curled edge
  float under = has * smoothstep(0.86, 0.875, pf) * (1.0 - smoothstep(0.875, 0.91, pf)); // its shadow
  col = mix(col, vec3(0.96, 0.92, 0.86), lip * 0.6);
  col = mix(col, vec3(0.32, 0.27, 0.24), under * 0.7);
  h += strip * 0.4 + lip * 0.9 - under * 0.3;
  // lenticels: rows about two centimetres apart, cells about four round, a dash in about half
  float NA = max(6.0, floor(C * 25.0));
  float ry = b.y * 55.0 + 0.35 * nw(3.0, 0.0);
  float rid = floor(ry);
  float x = u * NA + h21(vec2(rid, 2.0)) * NA; // each row shifted round
  float cid = mod(floor(x), NA), fx = fract(x);
  float fy = fract(ry) - 0.5 - (h21(vec2(cid, rid + 7.0)) - 0.5) * 0.4;
  float k1 = h21(vec2(cid, rid)), k2 = h21(vec2(cid + 3.3, rid)), k3 = h21(vec2(cid, rid + 1.9));
  float cx = 0.3 + 0.4 * k2, hl = min(0.08 + 0.42 * k3 * k3, min(cx, 1.0 - cx) - 0.02);
  float dx = abs(fx - cx) / hl;
  float th = (0.06 + 0.05 * k2) * sqrt(max(0.0, 1.0 - dx * dx)); // lens-shaped: thin at the ends
  float len = step(k1, 0.7) * (1.0 - smoothstep(th * 0.6, th, abs(fy))) * step(dx, 1.0);
  float lrim = step(k1, 0.7) * (1.0 - smoothstep(th, th * 1.9, abs(fy))) * step(dx, 1.05) * (1.0 - len);
  float lfade = 1.0 - smoothstep(0.003, 0.008, PX); // rows two centimetres apart: further off, a faint grey
  len *= lfade; lrim *= lfade;
  col = mix(col, vec3(0.26, 0.21, 0.18), len);
  col = mix(col, col * 0.86, lrim * 0.5);
  col *= 1.0 - 0.06 * (1.0 - lfade);
  h += len * 0.6 + lrim * 0.25;
  // black marks: rough edged, crusty, cracked across
  // (horizontal: wider than tall, dashes and bands round the trunk)
  float m = nw(0.7, vec2(3.0, b.y * 24.0)) * 0.6 + nw(1.8, vec2(1.0, b.y * 55.0)) * 0.4; // thin: a few centimetres tall, a hand or more wide
  m += 0.12 * (nw(10.0, vec2(0.0, b.y * 55.0)) - 0.5) * (1.0 - smoothstep(0.004, 0.012, PX));
  m += 0.06 * (nw(30.0, vec2(0.0, b.y * 160.0)) - 0.5) * (1.0 - smoothstep(0.0015, 0.005, PX));
  m += 0.1 * smoothstep(0.55, 0.85, n21(vec2(b.y * 1.4, 9.0))); // in bands
  float me = 0.0075 + PX * 1.5; // the edge as soft as a pixel, no softer
  float mk = smoothstep(0.685 - me, 0.685 + me, m);
  float crack = (1.0 - smoothstep(0.03, 0.09, abs(fract(b.y * 70.0 + 1.5 * nw(9.0, vec2(0.0, b.y * 20.0))) - 0.5)))
    * (1.0 - smoothstep(0.002, 0.006, PX)); // fourteen millimetres apart: off before they alias
  vec3 crust = mix(vec3(0.07, 0.065, 0.06), vec3(0.16, 0.15, 0.14), mix(nw(30.0, vec2(0.0, b.y * 90.0)), 0.5, smoothstep(0.002, 0.006, PX)));
  crust = mix(crust, vec3(0.015), crack);
  col = mix(col, crust, mk);
  h += mk * (0.5 + 0.4 * nw(25.0, vec2(0.0, b.y * 70.0)) - 0.6 * crack);
  // the foot: black fissured bark, low and uneven, here and there a spike climbing a fissure
  float reach = 0.1 + 0.3 * nw(1.2, 4.0) + 0.45 * pow(nw(5.0, 2.0), 4.0) + 0.06 * nw(14.0, vec2(0.0, b.y * 3.0));
  float foot = 1.0 - smoothstep(0.0, 0.08, b.y - reach);
  foot = max(foot, step(0.72, nw(7.0, vec2(0.0, b.y * 12.0))) * (1.0 - smoothstep(reach, reach + 0.5, b.y)));
  // plates split by deep cracks running up, uneven: the cracks where a noise stretched up the trunk crosses
  // its middle, two of them, so they branch and join
  float n1 = nw(7.0, vec2(0.0, b.y * 2.2)), n2 = nw(13.0, vec2(5.0, b.y * 4.0));
  float cr = min(abs(n1 - 0.5) * 2.0, abs(n2 - 0.5) * 2.0 + 0.15);
  float plate = smoothstep(0.04, 0.16, cr);
  vec3 black = mix(vec3(0.012, 0.011, 0.01), mix(vec3(0.045, 0.04, 0.036), vec3(0.1, 0.09, 0.08), nw(24.0, vec2(0.0, b.y * 30.0))), plate);
  col = mix(col, black, foot);
  h = mix(h, plate * (0.4 + 0.2 * nw(20.0, vec2(0.0, b.y * 25.0))), foot);
  dark = max(mk, foot);
  return h;
}
void main() {
  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  BR = vR;
  PX = length(fwidth(vBark));
  vec2 b = vBark;
  vec3 col; float dark;
  float h = birchAt(b, col, dark);
  // far: the detail smaller than a pixel goes to its average, a soft white with a little grey
  float px = length(fwidth(vBark));
  float fine = 1.0 - smoothstep(0.002, 0.006, px);
  col = mix(col, mix(vec3(0.74, 0.72, 0.68), col, 0.55), (1.0 - fine) * (1.0 - dark)); // the black marks stay black far off
  // the relief: a millimetre or two, by finite differences round and up
  if (fine > 0.01) {
    vec3 c1; float d1;
    float e = 0.0008;
    float hx = birchAt(b + vec2(e, 0.0), c1, d1), hy = birchAt(b + vec2(0.0, e), c1, d1);
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-5), B = cross(T, N);
    N = normalize(N - (T * (hx - h) + B * (hy - h)) / e * 0.0012 * fine);
  }
  // green-grey algae low on the shaded side
  float side = 0.5 + 0.5 * dot(normalize(vec3(vNormal.x, 0.0, vNormal.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  col = mix(col, col * vec3(0.72, 0.8, 0.62), side * (1.0 - smoothstep(0.3, 1.6, b.y)) * smoothstep(0.4, 0.7, n21(vBark * vec2(6.0, 3.0))) * 0.6 * (1.0 - dark));
  col *= mix(0.7, 1.0, smoothstep(-0.2, 0.3, b.y)); // into the moss
  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0);
  float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);
  // white bark is lit by everything round it: a strong fill, so it stays white in the shade (not the black: lit as
  // much, the black went a lilac grey)
  vec3 c = col * (mix(0.62, 0.3, dark) * skyTint(N, 1.0) + 1.5 * diff * shadow + mix(0.25, 0.1, dark) * wrap);
  // the low sun warms the white where it reaches
  c += col * vec3(0.55, 0.3, 0.1) * diff * shadow;
  // backlit, the edge glows; a little sheen on the paper
  c += col * pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, L), 0.0) * 1.2;
  c += vec3(1.0, 0.9, 0.75) * pow(max(dot(reflect(-L, N), V), 0.0), 30.0) * 0.12 * shadow * (1.0 - dark);
  c += rimLight(N, V) * col * 0.8;
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
#else
void main() {
  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out
  vec3 N0 = normalize(vNormal);
  vec3 N = N0;
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 T0 = normalize(cross(N0, vec3(0.0, 1.0, 0.0)) + 1e-5), B0 = cross(T0, N0);

  CIRC = 6.2831853 * vR;
  float px = length(fwidth(vBark)); // world metres per pixel on the bark: prevents crack shimmering at distance
  float macroFade = 1.0 - smoothstep(0.025, 0.075, px);
  float midFade = 1.0 - smoothstep(0.010, 0.034, px);
  float fineFade = 1.0 - smoothstep(0.004, 0.016, px);

  vec2 fis = fissureField(vBark, px);
  float ridge = fis.x;  // 0 deep chasm .. 1 ridge plateau
  float shred = fis.y;  // rough vertical shredded fibres inside fissures

  float plate, flake, cell, lip;
  vec2 bevel;
  barkPlates(vBark, px, plate, flake, cell, lip, bevel);
  // plates sit on the ridge plateaus; where a fissure cuts through, the rough crevice bark shows instead
  float onPlate = ridge * plate;
  float h = ridge * (0.45 + 0.4 * plate + 0.15 * flake) + (1.0 - ridge) * shred * 0.28;

  // pixel-width-aware bump normal: deep chasms & rough shredded crevices cast crisp relief without aliasing
  if (macroFade > 0.01) {
    float e = max(0.0022, px * 0.65);
    vec2 fx = fissureField(vBark + vec2(e, 0.0), px);
    vec2 fy = fissureField(vBark + vec2(0.0, e), px);
    float hx = fx.x * 0.85 + (1.0 - fx.x) * fx.y * 0.45;
    float hy = fy.x * 0.85 + (1.0 - fy.x) * fy.y * 0.45;
    float hc = ridge * 0.85 + (1.0 - ridge) * shred * 0.45;
    vec2 grad = vec2(hx - hc, hy - hc) / e * 0.015 * macroFade;
    // crisp bevel normal along each plate's stepped jagged rim
    grad += bevel * ridge * 0.65 * midFade;
    N = normalize(N - (T0 * grad.x + B0 * grad.y));
  }
  // crisp micro-grain and shredded splinters up close (stays active through 2–3 m closeups)
  float g = 0.5;
  if (fineFade > 0.01) {
    float e = max(0.0012, px * 0.55);
    g = grain(vBark);
    float gx = grain(vBark + vec2(e, 0.0)) - g, gy = grain(vBark + vec2(0.0, e)) - g;
    float gk = mix(0.0038, 0.0011, onPlate) * fineFade; // very craggy in crevices, smooth papery plates
    N = normalize(N - (T0 * gx + B0 * gy) / e * gk);
  }

  // ---- colours calibrated to the reference pine bark photo:
  // 1. Deep crevices: textured, weathered charcoal-grey shredded bark (pale grey splinter ridges over near-black cracks)
  vec3 chasm = vec3(0.006, 0.006, 0.007);
  float splinter = smoothstep(0.28, 0.78, shred);
  vec3 roughGrey = mix(vec3(0.024, 0.025, 0.028), vec3(0.135, 0.132, 0.130), splinter);
  roughGrey *= 0.65 + 0.65 * n21(vBark * vec2(48.0, 12.0));
  vec3 creviceCol = mix(chasm, roughGrey, smoothstep(0.02, 0.36, ridge + shred * 0.32));

  // 2. Large flaky plates: layered papery slabs mixing pale weathered ash-taupe and dusty terracotta-cinnamon
  float warmth = smoothstep(0.12, 0.88, cell * 0.55 + n21(vBark * vec2(5.5, 2.6) + 2.1) * 0.45);
  vec3 ashTaupe = mix(vec3(0.115, 0.105, 0.10), vec3(0.19, 0.165, 0.15), cell);
  vec3 cinnamon = mix(vec3(0.145, 0.072, 0.042), vec3(0.22, 0.112, 0.062), warmth);
  vec3 rustChip = vec3(0.175, 0.078, 0.038);
  // outer weathered papery flakes are paler taupe/ash-brown; peeled layers reveal warm dusty cinnamon
  vec3 plateCol = mix(rustChip, cinnamon, smoothstep(0.0, 0.5, flake));
  plateCol = mix(plateCol, ashTaupe, smoothstep(0.42, 0.95, flake) * (0.48 + 0.52 * (1.0 - warmth)));
  // subtle vertical papery marbling across each slab
  plateCol *= 0.84 + 0.32 * n21(vBark * vec2(22.0, 6.5) + cell * 11.0);
  // fine dark hairline cracks crossing the flat plates + tiny bark pits
  float fineCrack = (1.0 - smoothstep(0.018, 0.065, abs(n21(vBark * vec2(32.0, 18.0) + cell * 7.0) - 0.5))) * midFade;
  plateCol *= 1.0 - 0.5 * fineCrack;
  plateCol *= mix(1.0, 0.78 + 0.44 * g, fineFade);
  // crisp thin dark drop-shadow along each peeling papery flake edge
  plateCol *= 1.0 - 0.62 * clamp(lip, 0.0, 1.0);

  // combine rough charcoal-grey crevices with dusty cinnamon/taupe flaky plates
  vec3 col = mix(creviceCol, plateCol, onPlate);
  // crisp dark cliff shadow right where a raised plate drops into a crevice
  float cliffAO = smoothstep(0.0, 0.32, ridge) * mix(0.32, 1.0, smoothstep(0.0, 0.35, plate));
  col *= mix(1.0, 0.45 + 0.55 * cliffAO, macroFade);
  // far away: ease smoothly to the average weathered grey-cinnamon furrowed tone
  col = mix(vec3(0.085, 0.072, 0.064), col, mix(0.45, 1.0, macroFade));

  // olive-green moss & algae nestled inside the damp vertical crevices (never washing across dry plates)
  float side = 0.5 + 0.5 * dot(normalize(vec3(N0.x, 0.0, N0.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  float creviceMoss = (1.0 - onPlate * 0.92) * smoothstep(0.36, 0.72, n21(vBark * vec2(4.2, 1.8) + 3.0) * (0.45 + 0.7 * side));
  float lowMoss = (1.0 - smoothstep(0.0, 1.6, max(vBark.y, 0.0))) * 0.42;
  float mossAmt = clamp(creviceMoss * (0.45 + lowMoss), 0.0, 0.78);
  col = mix(col, mix(vec3(0.036, 0.058, 0.016), vec3(0.08, 0.11, 0.028), splinter), mossAmt);
  // sparse pale-grey crust lichen flecks on weathered plates
  float speck = smoothstep(0.42, 0.78, n21(vBark * vec2(65.0, 48.0) + 3.0)) * midFade;
  col = mix(col, vec3(0.20, 0.21, 0.19), smoothstep(0.65, 0.77, n21(vBark * vec2(2.6, 1.6) + 7.0)) * onPlate * 0.42 * speck);

  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0);
  // deep fissures self-shadow so the recessed cracks stay dark against sunlit plates
  float cavity = mix(0.22, 1.0, smoothstep(0.06, 0.58, ridge) * mix(0.35, 1.0, plate));
  diff *= mix(1.0, cavity, macroFade);
  vec3 c = col * (0.40 * skyTint(N, 1.0) * mix(0.48, 1.0, cavity) + 2.0 * diff * shadow);
  // subtle warm sun catch on sunlit plates without turning crevices orange
  float sway = 0.7 + 0.3 * n21(vec2(vBark.y * 0.15, vWorldPos.x * 0.3 + vWorldPos.z * 0.7));
  c += vec3(0.36, 0.19, 0.07) * col * 1.4 * diff * mix(0.35, 1.0, shadow) * sway * (0.2 + 0.8 * onPlate);
  // backlit rough silhouette rim
  c += col * pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, L), 0.0) * 1.15 * (0.3 + 0.7 * onPlate) * (0.4 + 0.6 * h);
  c *= mix(0.45, 1.0, smoothstep(-0.2, 0.25, vBark.y)); // dark where it sinks into the moss
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
#endif
`;
