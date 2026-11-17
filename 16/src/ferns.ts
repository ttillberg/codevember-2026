// Ferns, towering over a worm. A fern is a crown of fronds arching out of the moss; each frond a thin rachis
// with pinnae down both sides, each pinna a strip folded along its midrib, whose lobed pinnule outline is cut
// in the fragment shader, so the leaf edge is crisp without a vertex per lobe. Autumn: a few still green, most
// gold to rust, the tips ahead of the base. Spore dots (sori) under the leaflets.
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { groundHeight } from './world';
import { buildDew } from './dew';

const CELL = 2.6;
const RANGE = 7;
const DROP = 9.5;

const START = { x: 0.12, z: -0.62 }; // a fern's crown just ahead of where you start
// level of detail: pinnae per side (spaced about a pinna's width apart), rows along a pinna, rachis rings.
// Far ferns get half the pinnae, each twice as wide, so the frond keeps its outline in the haze.
const LODS = [
  { pinnae: 16, rows: 7, segs: 14, widen: 1 },
  { pinnae: 8, rows: 3, segs: 6, widen: 1.9 },
];
const LOD_NEAR = 4.5; // cell centre this close: full detail
const RACHIS_SIDES = 4;
type Lod = (typeof LODS)[number];

interface Buf { pos: number[]; nor: number[]; leaf: number[]; frond: number[]; idx: number[]; drops: number[] }

const v3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One frond into the buffers: rachis from `base` arching out along `out`. */
function addFrond(b: Buf, lod: Lod, base: THREE.Vector3, out: THREE.Vector3, L: number, rise: number, droop: number, stage: number, phase: number, rand: () => number) {
  const { pinnae: PINNAE, rows: ROWS, segs: RACHIS_SEGS } = lod;
  // the rachis: a quadratic bezier, up out of the crown, arching over, the tip sinking
  const p0 = base.clone();
  const p1 = base.clone().addScaledVector(UP, L * 0.62 * rise).addScaledVector(out, L * 0.18);
  const p2 = base.clone().addScaledVector(out, L * 0.78).addScaledVector(UP, L * (0.42 * rise - droop));
  const at = (t: number, o: THREE.Vector3) => o.set(0, 0, 0).addScaledVector(p0, (1 - t) * (1 - t)).addScaledVector(p1, 2 * t * (1 - t)).addScaledVector(p2, t * t);
  const tan = (t: number, o: THREE.Vector3) => o.copy(p1).sub(p0).multiplyScalar(2 * (1 - t)).addScaledVector(p2.clone().sub(p1), 2 * t).normalize();
  const side = new THREE.Vector3().crossVectors(out, UP).normalize();
  const P = v3(), T = v3(), N = v3();
  const frondAttr = (t: number) => [stage, phase, t, rand()]; // autumn stage, sway phase, along the frond, seed
  // rachis: a thin tube, tapering
  {
    const start = b.pos.length / 3;
    for (let i = 0; i <= RACHIS_SEGS; i++) {
      const t = i / RACHIS_SEGS;
      at(t, P); tan(t, T);
      const n1 = v3().crossVectors(T, side).normalize(), n2 = side;
      const r = THREE.MathUtils.lerp(0.0045, 0.0012, t) * (L / 1.0);
      for (let k = 0; k < RACHIS_SIDES; k++) {
        const a = (k / RACHIS_SIDES) * Math.PI * 2;
        N.copy(n1).multiplyScalar(Math.cos(a)).addScaledVector(n2, Math.sin(a));
        b.pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
        b.nor.push(N.x, N.y, N.z);
        b.leaf.push(t, 0, 0); // u along, across 0, part 0 = rachis
        b.frond.push(...frondAttr(t));
      }
    }
    for (let i = 0; i < RACHIS_SEGS; i++) for (let k = 0; k < RACHIS_SIDES; k++) {
      const a = start + i * RACHIS_SIDES + k, c = start + i * RACHIS_SIDES + ((k + 1) % RACHIS_SIDES);
      b.idx.push(a, a + RACHIS_SIDES, c, c, a + RACHIS_SIDES, c + RACHIS_SIDES);
    }
  }
  // pinnae down both sides, from a little above the base to the tip
  const C = v3(), D = v3(), A = v3(), Q = v3();
  for (let k = 0; k < PINNAE; k++) for (const s of [-1, 1]) {
    const t = 0.1 + 0.88 * (k + (s > 0 ? 0.5 : 0)) / PINNAE; // alternate a little
    at(t, P); tan(t, T);
    // the frond's own plane: across is the side direction, its normal faces up-ish
    const fn = v3().crossVectors(side, T).normalize();
    if (fn.y < 0) fn.negate();
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.04) / 0.98)), 0.75) * (1 - 0.35 * t);
    const Lp = L * 0.3 * shape * (0.9 + 0.2 * rand());
    if (Lp < 0.004) continue;
    const Wp = Lp * 0.11 * lod.widen; // half width: a pinna is about five times as long as it is wide
    D.copy(side).multiplyScalar(s).addScaledVector(T, 0.5).normalize(); // angled towards the tip
    A.crossVectors(fn, D).normalize(); // across the pinna, roughly along the rachis
    const fold = 0.25 + 0.2 * rand();
    const start = b.pos.length / 3;
    for (let r = 0; r <= ROWS; r++) {
      const u = r / ROWS;
      // a pinna runs out and curves down under its own weight
      C.copy(P).addScaledVector(D, u * Lp).addScaledVector(fn, -u * u * Lp * 0.3);
      for (let c = -1; c <= 1; c++) {
        Q.copy(C).addScaledVector(A, c * Wp).addScaledVector(fn, (1 - Math.abs(c)) * Wp * fold); // folded up at the midrib
        b.pos.push(Q.x, Q.y, Q.z);
        // normal: the frond plane, tilted by the fold
        N.copy(fn).addScaledVector(A, -c * fold * 0.8).normalize();
        b.nor.push(N.x, N.y, N.z);
        b.leaf.push(u, c, 1); // part 1 = pinna
        b.frond.push(...frondAttr(t));
      }
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < 2; c++) {
      const a = start + r * 3 + c, bb = a + 1, d = a + 3, e = a + 4;
      b.idx.push(a, bb, d, bb, e, d);
    }
    // dew: a drop or two sitting in the fold along the midrib, and now and then one hanging under the tip
    for (let k = 0; k < 2; k++) if (rand() < 0.5) {
      const u = 0.25 + 0.6 * rand();
      C.copy(P).addScaledVector(D, u * Lp).addScaledVector(fn, -u * u * Lp * 0.3 + Wp * fold + 0.002);
      b.drops.push(C.x, C.y, C.z, 0.002 + 0.003 * rand());
    }
    if (rand() < 0.2) {
      C.copy(P).addScaledVector(D, Lp).addScaledVector(fn, -Lp * 0.3 - 0.005);
      b.drops.push(C.x, C.y, C.z, 0.004 + 0.003 * rand());
    }
  }
}

function buildFern(b: Buf, lod: Lod, x: number, z: number, size: number, seed: number) {
  const rand = mulberry32(seed);
  const n = 6 + Math.floor(rand() * 6);
  const crown = new THREE.Vector3(x, groundHeight(x, z) - 0.02, z);
  const a0 = rand() * Math.PI * 2;
  // most of the fern has turned; how far depends on the fern
  const fernStage = rand();
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const base = crown.clone().addScaledVector(out, 0.015);
    const L = size * (0.6 + 0.5 * rand());
    // the outer, older fronds lie lower and droop more
    const rise = 0.95 + 0.4 * rand(); // up high and arching over: room for a worm underneath
    const droop = rand() * 0.22 * L;
    const stage = THREE.MathUtils.clamp(fernStage + (rand() - 0.5) * 0.35, 0, 1);
    addFrond(b, lod, base, out, L, rise, droop, stage, rand() * 6.28, rand);
  }
}

function disposeAll(o: THREE.Object3D) {
  o.traverse((m) => { if (m instanceof THREE.Mesh) m.geometry.dispose(); });
}

export class Ferns {
  readonly root = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  crowns: { x: number; z: number }[] = [];
  changed = false;
  private cells = new Map<string, { mesh: THREE.Object3D | null; crowns: { x: number; z: number }[]; lod: number }>();

  constructor(setup: (m: THREE.ShaderMaterial) => void, private dewMaterial: THREE.Material) {
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(this.material);
  }

  private build(ix: number, iz: number, lod: number) {
    const r = mulberry32((Math.imul(ix, 0x2c1b3c6d) ^ Math.imul(iz, 0x297a2d39) ^ 0x5eed) >>> 0);
    const crowns: { x: number; z: number }[] = [];
    const sizes: number[] = [];
    // the stand you start in: a big fern just ahead, arching over you
    if (ix === Math.floor(START.x / CELL) && iz === Math.floor(START.z / CELL)) { crowns.push({ ...START }); sizes.push(2.0); }
    if (r() < 0.7) {
      const n = 2 + Math.floor(r() * 4); // ferns grow in stands: crawl in under them
      const gx = (ix + 0.2 + 0.6 * r()) * CELL, gz = (iz + 0.2 + 0.6 * r()) * CELL;
      for (let i = 0; i < n; i++) {
        const x = gx + (r() - 0.5) * 1.8, z = gz + (r() - 0.5) * 1.8;
        const size = 1.3 + r() * 0.7;
        if (Math.hypot(x, z) < 0.3 || crowns.some((c) => Math.hypot(c.x - x, c.z - z) < 0.45)) continue;
        crowns.push({ x, z });
        sizes.push(size);
      }
    }
    if (!crowns.length) return { mesh: null, crowns, lod };
    const b: Buf = { pos: [], nor: [], leaf: [], frond: [], idx: [], drops: [] };
    crowns.forEach((c, i) => buildFern(b, LODS[lod], c.x, c.z, sizes[i], Math.floor(r() * 1e9)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute('leaf', new THREE.Float32BufferAttribute(b.leaf, 3));
    g.setAttribute('frond', new THREE.Float32BufferAttribute(b.frond, 4));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(g, this.material));
    if (lod === 0 && b.drops.length) mesh.add(buildDew(b.drops, this.dewMaterial));
    return { mesh, crowns, lod };
  }

  /** For the shadow pass: hide the cells farther than `reach` from its centre (and show them all again after). */
  forShadow(on: boolean, cx = 0, cz = 0, reach = 0) {
    for (const [key, c] of this.cells) {
      if (!c.mesh) continue;
      const [ix, iz] = key.split(',').map(Number);
      c.mesh.visible = !on || Math.hypot((ix + 0.5) * CELL - cx, (iz + 0.5) * CELL - cz) < reach;
    }
  }

  /** Place the cells coming into range and swap their detail as you come and go (one build per call), take away the ones gone out. */
  update(px: number, pz: number) {
    const i0 = Math.floor(px / CELL), k0 = Math.floor(pz / CELL);
    const R = Math.ceil(RANGE / CELL);
    let changed = false;
    for (let dz = -R; dz <= R && !changed; dz++) for (let dx = -R; dx <= R && !changed; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      const d = Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz);
      if (d > RANGE) continue;
      const lod = d < LOD_NEAR ? 0 : 1;
      const key = `${ix},${iz}`;
      const have = this.cells.get(key);
      if (have && have.lod === lod) continue;
      const c = this.build(ix, iz, lod);
      if (have?.mesh) { this.root.remove(have.mesh); disposeAll(have.mesh); }
      this.cells.set(key, c);
      if (c.mesh) this.root.add(c.mesh);
      changed = true;
    }
    for (const [key, c] of this.cells) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) < DROP) continue;
      if (c.mesh) { this.root.remove(c.mesh); disposeAll(c.mesh); }
      this.cells.delete(key);
      changed = true;
    }
    if (changed) {
      this.crowns = [...this.cells.values()].flatMap((c) => c.crowns);
      this.changed = true;
    }
    return changed;
  }
}

const vertexShader = /* glsl */ `
attribute vec3 leaf; // along the pinna (or the rachis), across -1..1, part (0 rachis, 1 pinna)
attribute vec4 frond; // autumn stage, sway phase, along the frond, seed
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLeaf;
varying vec4 vFrond;
void main() {
  // the air moves the fronds: more towards the tip, each frond on its own phase
  float t = frond.z;
  float w = t * t;
  vec3 sway = vec3(sin(uTime * 0.9 + frond.y), 0.0, cos(uTime * 0.7 + frond.y * 1.3)) * 0.018 * w
            + vec3(0.0, sin(uTime * 2.3 + frond.y * 3.0 + leaf.x * 2.0) * 0.004 * w * leaf.z, 0.0);
  vec4 wp = modelMatrix * vec4(position + sway, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLeaf = leaf;
  vFrond = frond;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLeaf;
varying vec4 vFrond;

void main() {
  float u = vLeaf.x, c = vLeaf.y;
  bool pinna = vLeaf.z > 0.5;
  // pinnules: lobes down each side of the pinna, deep cut towards the midrib, small teeth on each lobe,
  // the whole outline narrowing to the pinna's tip
  // the lobes lean towards the pinna's tip, oblong, cut almost to the midrib
  float P = 8.0;
  float lobe = abs(sin((u - abs(c) * 0.18) * P * 3.14159));
  float teeth = 0.05 * abs(sin((u - abs(c) * 0.18) * P * 3.14159 * 5.0)) * abs(c);
  float hw = (1.0 - pow(u, 1.3)) * (0.14 + 0.86 * pow(lobe, 0.8)) + teeth;
  if (pinna && abs(c) > hw) discard;
  if (nearFade(vWorldPos, 0.05, 0.16) < 0.5) discard;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  bool under = !gl_FrontFacing;
  if (under) N = -N;
  vec3 L = normalize(uLightDir);

  // autumn: green, then gold, then rust and brown; the tip of a frond and of a pinna turn first
  float stage = clamp(vFrond.x + 0.35 * vFrond.z + 0.15 * u - 0.15, 0.0, 1.0);
  vec3 green = vec3(0.04, 0.11, 0.02), gold = vec3(0.40, 0.27, 0.04), rust = vec3(0.32, 0.10, 0.03), brown = vec3(0.13, 0.06, 0.025);
  vec3 col = stage < 0.4 ? mix(green, gold, stage / 0.4) : stage < 0.75 ? mix(gold, rust, (stage - 0.4) / 0.35) : mix(rust, brown, (stage - 0.75) / 0.25);
  col *= 0.85 + 0.3 * vFrond.w;
  if (pinna) {
    // a paler midrib, and a vein into each pinnule
    float mid = 1.0 - smoothstep(0.0, 0.06, abs(c));
    float vein = (1.0 - smoothstep(0.0, 0.05, abs(fract(u * P - 0.5 * abs(c)) - 0.5) * 2.0 - 0.92)) * step(0.08, abs(c));
    col = mix(col, col * 1.3 + 0.02, clamp(mid + 0.4 * vein, 0.0, 1.0) * 0.5);
    // sori: rows of rust spore dots under each pinnule, either side of its vein
    if (under) {
      vec2 g = vec2(fract(u * P * 2.0) - 0.5, abs(c) - 0.45 * hw);
      float dot1 = 1.0 - smoothstep(0.12, 0.2, length(g * vec2(1.0, 4.5)));
      col = mix(col * 0.85, vec3(0.30, 0.12, 0.04), dot1 * step(0.15, u) * 0.9);
    }
  } else {
    col = mix(vec3(0.10, 0.05, 0.02), col * 0.7, smoothstep(0.0, 0.3, u)); // the stipe is dark low down
  }

  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0);
  // thin leaves: the low sun comes through them, gold
  float thru = pow(max(dot(-V, L), 0.0), 3.0) * (pinna ? 0.9 : 0.3);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 60.0) * 0.9; // wet: a sharp sheen
  vec3 lit = col * (0.2 * skyTint(N, 1.0) + 1.3 * diff * shadow) + col * vec3(1.5, 1.15, 0.55) * thru * shadow + vec3(1.0, 0.85, 0.6) * spec * shadow;
  lit += rimLight(N, V) * col * 2.0;
  // with the sun behind you, the pinnae turned to it catch it: the counterpart of the glow through them
  lit += (SUN_GLOW * 0.8 + col * 0.6) * pow(max(dot(N, L) * 0.5 + 0.5, 0.0), 2.0) * withSun(V, L) * sunCatch(vWorldPos, shadow) * (pinna ? 1.0 : 0.4);
  // the crown sits in the moss: dark at the foot
  lit *= mix(0.4, 1.0, smoothstep(0.0, 0.12, vFrond.z));
  gl_FragColor = vec4(tonemap(grade(lit)), 1.0);
  #include <colorspace_fragment>
}
`;
