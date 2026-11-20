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
// Up close, the grain on a plate: fibres running up the trunk a few millimetres apart, and the outer bark
// peeling in small papery scales, each a little step. In metres along the bark.
float grain(vec2 b) {
  float fib = n21(b * vec2(220.0, 45.0)) * 0.55 + n21(b * vec2(520.0, 110.0)) * 0.45;
  float fl = n21(b * vec2(55.0, 34.0) + n21(b * vec2(9.0, 5.0)) * 2.0) * 3.0;
  float scale = (floor(fl) + smoothstep(0.42, 0.58, fract(fl))) / 3.0;
  float crumb = n21(b * vec2(110.0, 80.0));
  return fib * 0.35 + scale * 0.4 + crumb * 0.25;
}
// Spruce bark: thin round scales a couple of centimetres across, overlapping like roof tiles, each one's
// lower edge lifted off the trunk so it catches the light above and drops a little shadow below; shallow
// cracks between them, and here and there a scale gone, showing red-brown underneath. A cell noise with a
// whole number of cells around so it wraps without a seam, its rows nudged by sines of the angle (which wrap
// too) so they do not line up.
float AROUND; // cells around this trunk
const float PER_Y = 30.0; // cells per unit up: a scale is about three centimetres tall
vec4 barkV(vec2 b) {
  float ang = b.x / (6.2831853 * vR); // 0..1 around
  vec2 p = vec2(ang * AROUND, b.y * PER_Y);
  float a = ang * 6.2831853;
  p.y += 0.35 * sin(a * 7.0 + b.y * 2.0) + 0.2 * sin(a * 19.0 - b.y * 5.0);
  // the cells warped by a noise round the trunk (a circle in it, so it wraps): curved, uneven scales, not tiles
  float K = AROUND * 0.11;
  vec2 w = vec2(cos(a), sin(a)) * K;
  p += (vec2(n21(w + vec2(0.0, p.y * 0.6)), n21(w * 1.3 + vec2(5.2, p.y * 0.5))) - 0.5) * vec2(0.9, 0.7);
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0;
  vec2 id = vec2(0.0), q1 = vec2(0.0), q2 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = i + o;
    c.x = mod(c.x, AROUND);
    vec2 pt = o + 0.15 + 0.7 * vec2(h21(c), h21(c + 17.3));
    float l = length((pt - f) * vec2(1.0, 0.8));
    if (l < f1) { f2 = f1; q2 = q1; f1 = l; q1 = pt; id = c; } else if (l < f2) { f2 = l; q2 = pt; }
  }
  float edge = f2 - f1;
  // where one scale's lower edge lies over the next a dark gap shows under it; beside each other they only
  // just part, so the scales read as overlapping tiles and not a net of outlines
  float rag = (n21(p * vec2(4.0, 3.0)) - 0.5) * 0.1 + (n21(p * vec2(11.0, 9.0)) - 0.5) * 0.06;
  vec2 dq = q2 - q1;
  float under = smoothstep(0.2, 0.7, -dq.y / (length(dq) + 1e-4)); // the neighbour is below this scale
  float crack = smoothstep(0.0, mix(0.03, 0.14, under), edge + rag);
  crack = mix(1.0 - 0.18 * (1.0 - crack), crack, under);
  // the scale: rises towards its lower edge, which stands off the trunk; a slight dome across
  vec2 d = f - q1; // from the scale's middle
  float lift = clamp(0.5 - d.y * 0.9, 0.0, 1.0);
  float dome = 1.0 - clamp(f1 * 1.4, 0.0, 1.0);
  // some scales have come away: a step down to the red-brown underneath
  float gone = step(h21(id + 8.1), 0.035);
  float rough = n21(p * vec2(3.0, 2.5)) * 0.5 + n21(p * vec2(7.0, 6.0)) * 0.3 + n21(p * vec2(17.0, 13.0)) * 0.2;
  float h = crack * (0.5 + 0.35 * lift + 0.1 * dome + 0.25 * rough - 0.3 * gone);
  return vec4(h, crack, 1.0 - gone, h21(id + 3.1));
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
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  AROUND = max(12.0, floor(6.2831853 * vR * 40.0 + 0.5)); // scales about 2.5 cm wide
  vec4 bv = barkV(vBark);
  float h = bv.x;
  // far away the cells are smaller than a pixel: ease the relief and the contrast out instead of shimmering
  float px = length(fwidth(vBark)) * PER_Y * 1.6;
  float near = 1.0 - smoothstep(0.25, 0.9, px);
  // the normal from the height's slope along the bark, around and up (finite differences, so it is the same
  // up close as far away), tilted by scales a few millimetres thick
  if (near > 0.01) {
    float e = 0.0015;
    float hx = barkV(vBark + vec2(e, 0.0)).x, hy = barkV(vBark + vec2(0.0, e)).x;
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-5), B = cross(T, N);
    N = normalize(N - (T * (hx - h) + B * (hy - h)) / e * 0.004 * near);
  }
  vec3 N0 = normalize(vNormal);
  vec3 T0 = normalize(cross(N0, vec3(0.0, 1.0, 0.0)) + 1e-5), B0 = cross(T0, N0);
  float side = 0.5 + 0.5 * dot(normalize(vec3(N0.x, 0.0, N0.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  // the fine detail only once it is bigger than a pixel or so: the grain
  float fineFade = 1.0 - smoothstep(0.35, 1.1, length(fwidth(vBark)) * 260.0);
  float g = 0.5;
  if (fineFade > 0.01) {
    float e = 0.0012;
    g = grain(vBark);
    float gk = 0.0014 * fineFade * bv.y;
    if (gk > 0.0) N = normalize(N - (T0 * (grain(vBark + vec2(e, 0.0)) - g) + B0 * (grain(vBark + vec2(0.0, e)) - g)) / e * gk);
  }

  float furrow = bv.y, layers = bv.z, cell = bv.w;
  // dark grey weathered scales, each a shade different, red-brown where one came away, near black in the cracks
  vec3 top = mix(vec3(0.062, 0.055, 0.048), vec3(0.105, 0.095, 0.082), cell);
  vec3 under = mix(vec3(0.075, 0.052, 0.04), vec3(0.095, 0.065, 0.048), cell);
  vec3 col = mix(under, top, layers);
  col *= 0.85 + 0.3 * n21(vBark * vec2(40.0, 14.0));
  // the grain: darker between the fibres, the scales' edges catching a little pale
  col *= mix(1.0, 0.55 + 0.9 * g, fineFade * furrow);
  col = mix(col, vec3(0.2, 0.18, 0.16), smoothstep(0.62, 0.8, g) * 0.35 * fineFade * furrow);
  // up close each scale is weathered unevenly: pale flaky patches and dark pits
  float wx = n21(vBark * vec2(150.0, 110.0) + cell * 9.0);
  col *= mix(1.0, 0.6 + 0.8 * wx, fineFade);
  col = mix(col, vec3(0.17, 0.16, 0.145), smoothstep(0.7, 0.85, n21(vBark * vec2(70.0, 55.0) + 4.0)) * 0.5 * fineFade * layers);
  col = mix(vec3(0.014, 0.012, 0.01), col, mix(0.6, 1.0, near) * furrow + (1.0 - near) * 0.5 * (1.0 - furrow));
  col = mix(vec3(0.085, 0.078, 0.07), col, mix(0.5, 1.0, near)); // far: the average
  // green algae on the shaded side, crust lichen in pale patches on the scales
  col = mix(col, vec3(0.10, 0.13, 0.06), smoothstep(0.45, 0.75, n21(vBark * vec2(1.2, 0.5) + 3.0) * side + 0.15 * side) * 0.6 * furrow);
  // lichen in specks, not a smooth wash; and mottling, dark and pale blotches across the bark
  float speck = smoothstep(0.35, 0.75, n21(vBark * vec2(60.0, 45.0) + 3.0));
  col = mix(col, vec3(0.24, 0.25, 0.21), smoothstep(0.6, 0.72, n21(vBark * vec2(2.2, 1.4) + 7.0)) * h * 0.6 * speck);
  col *= 0.75 + 0.5 * n21(vBark * vec2(14.0, 6.0) + 11.0);

  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0);
  // down the gaps the scales either side shade it: no sun in there, so the walls do not shine
  diff *= mix(smoothstep(0.1, 0.7, furrow), 1.0, 1.0 - near);
  vec3 c = col * (0.4 * skyTint(N, 1.0) + 2.0 * diff * shadow);
  // the bark is nearly black, so the low sun on it barely showed: where it reaches, the trunk's side catches the
  // warm gold, through its own pattern so the scales still read. Smooth, not broken by the canopy's spots: in spots
  // it came out as white flakes, a birch's bark, and the haze let only the bright ones through
  float sway = 0.7 + 0.3 * n21(vec2(vBark.y * 0.15, vWorldPos.x * 0.3 + vWorldPos.z * 0.7));
  c += vec3(1.25, 0.56, 0.15) * (col * 3.0 + 0.008) * diff * sway;
  // the low sun behind a trunk lights its edge
  // (only off the plates, broken by their roughness: a smooth even rim was what read as plastic)
  c += col * pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, L), 0.0) * 1.4 * furrow * (0.4 + 0.6 * n21(vBark * vec2(30.0, 12.0)));
  c *= mix(0.45, 1.0, smoothstep(-0.2, 0.25, vBark.y)); // dark where it goes into the moss
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
#endif
`;
