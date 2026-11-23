// Ferns, towering over a worm. A fern is a crown of fronds arching out of the moss; each frond a thin rachis
// with pinnae down both sides, each pinna a strip folded along its midrib, whose lobed pinnule outline is cut
// in the fragment shader, so the leaf edge is crisp without a vertex per lobe. Autumn: a few still green, most
// gold to rust, the tips ahead of the base. Spore dots (sori) under the leaflets.
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { groundHeight, clearing, puddleAt } from './world';
import { buildDew } from './dew';

const CELL = 2.6;
// placed out to here: with the haze lighter, stands appearing seven metres off were plain to see as you walked
const RANGE = matchMedia('(pointer: coarse)').matches ? 9 : 12;
const DROP = RANGE + 2.5;
const FADE = 0.8; // seconds a stand takes to dissolve in (or a new level of detail to dissolve over the old)

const START = { x: 0.12, z: -0.62 }; // a fern's crown just ahead of where you start
// level of detail: pinnae per side (close together, overlapping a little), rows along a pinna, rachis rings.
// Mid ferns get half the pinnae, each wider; far ones are a card per frond, the pinnae cut in its outline.
const LODS = [
  { pinnae: 36, rows: 7, segs: 16, widen: 1, card: false },
  { pinnae: 18, rows: 3, segs: 8, widen: 1.5, card: false },
  { pinnae: 0, rows: 0, segs: 8, widen: 1, card: true }, // far, in the haze: the whole frond one shape
];
const LOD_NEAR = 4.5; // cell centre this close: full detail
const LOD_MID = 8; // then the middle level up to here, the far one beyond
const RACHIS_SIDES = 4;
type Lod = (typeof LODS)[number];

interface Buf { pos: number[]; nor: number[]; leaf: number[]; frond: number[]; idx: number[]; drops: number[] }

const v3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One frond into the buffers: rachis from `base` arching out along `out`. */
function addFrond(b: Buf, lod: Lod, base: THREE.Vector3, out: THREE.Vector3, L: number, rise: number, droop: number, stage: number, phase: number, rand: () => number) {
  const { pinnae: PINNAE, rows: ROWS, segs: RACHIS_SEGS } = lod;
  // the rachis: a cubic bezier, up out of the crown, arching over, the tip hooking down (a quadratic, it could only
  // bend once and read stiff)
  const p0 = base.clone();
  const p1 = base.clone().addScaledVector(UP, L * 0.55 * rise).addScaledVector(out, L * 0.08);
  const p2 = base.clone().addScaledVector(out, L * 0.55).addScaledVector(UP, L * 0.62 * rise);
  // (the tip sinks but stays over the moss: below the crown, whole fronds had lain on the ground)
  const p3 = base.clone().addScaledVector(out, L * 0.9).addScaledVector(UP, L * Math.max(0.12, 0.34 * rise - droop * 1.1));
  const at = (t: number, o: THREE.Vector3) => {
    const s = 1 - t;
    return o.set(0, 0, 0).addScaledVector(p0, s * s * s).addScaledVector(p1, 3 * s * s * t).addScaledVector(p2, 3 * s * t * t).addScaledVector(p3, t * t * t);
  };
  const tan = (t: number, o: THREE.Vector3) => {
    const s = 1 - t;
    return o.copy(p1).sub(p0).multiplyScalar(3 * s * s).addScaledVector(p2.clone().sub(p1), 6 * s * t).addScaledVector(p3.clone().sub(p2), 3 * t * t).normalize();
  };
  const side = new THREE.Vector3().crossVectors(out, UP).normalize();
  const P = v3(), T = v3(), N = v3();
  const frondAttr = (t: number) => [stage, phase, t, rand()]; // autumn stage, sway phase, along the frond, seed
  if (lod.card) {
    // far: the whole frond one strip along the rachis, as wide as its pinnae reach, its sides drooping as they do;
    // the pinnae are cut in its outline by the shader (part 2)
    const start = b.pos.length / 3;
    const Q = v3(), fn = v3();
    for (let i = 0; i <= lod.segs; i++) {
      const t = i / lod.segs;
      at(t, P); tan(t, T);
      fn.crossVectors(side, T).normalize();
      if (fn.y < 0) fn.negate();
      const shape = t < 0.22 ? 0 : Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.82)), 0.75) * (1 - 0.35 * t);
      const w = L * 0.3 * Math.max(shape, 0.02);
      for (const c of [-1, 0, 1]) {
        Q.copy(P).addScaledVector(side, c * w).addScaledVector(fn, -Math.abs(c) * w * 0.4).addScaledVector(T, Math.abs(c) * w * 0.25);
        b.pos.push(Q.x, Q.y, Q.z);
        b.nor.push(fn.x, fn.y, fn.z);
        b.leaf.push(t, c, 2);
        b.frond.push(...frondAttr(t));
      }
    }
    for (let i = 0; i < lod.segs; i++) for (let c = 0; c < 2; c++) {
      const a = start + i * 3 + c, bb = a + 1, d = a + 3, e = a + 4;
      b.idx.push(a, bb, d, bb, e, d);
    }
    return;
  }
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
    // in pairs, opposite each other (alternating, they read wrong), from a quarter of the way up: the stipe below
    // is bare (leafy to the crown, the whole fern had seemed to come down to the ground)
    const t = 0.24 + 0.74 * k / PINNAE;
    at(t, P); tan(t, T);
    // the frond's own plane: across is the side direction, its normal faces up-ish
    const fn = v3().crossVectors(side, T).normalize();
    if (fn.y < 0) fn.negate();
    const shape = Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.82)), 0.75) * (1 - 0.35 * t);
    const Lp = L * 0.3 * shape * (0.9 + 0.2 * rand());
    if (Lp < 0.004) continue;
    const Wp = Lp * 0.15 * lod.widen; // half width: a pinna three to four times as long as it is wide, nearly overlapping its neighbours
    D.copy(side).multiplyScalar(s).addScaledVector(T, 0.5).normalize(); // angled towards the tip
    A.crossVectors(fn, D).normalize(); // across the pinna, roughly along the rachis
    const fold = 0.25 + 0.2 * rand();
    const start = b.pos.length / 3;
    for (let r = 0; r <= ROWS; r++) {
      const u = r / ROWS;
      // a pinna runs straight out from the rachis for its first third, then curves down under its own weight and
      // sweeps toward the frond's tip, a sickle (curving from the rachis on, it looked not to be attached)
      const bend = Math.max(0, u - 0.33) / 0.67;
      C.copy(P).addScaledVector(D, u * Lp).addScaledVector(fn, -bend * bend * Lp * 0.45).addScaledVector(T, bend * bend * Lp * 0.22);
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
      // wound so the front face is the upper side (across × out = -fn the other way): the shader takes the side
      // from gl_FrontFacing, and wound the other way the sunlit top was lit as the underside, dark, with the sori
      b.idx.push(a, d, bb, bb, d, e);
    }
    // dew: a drop or two sitting in the fold along the midrib, and now and then one hanging under the tip
    for (let k = 0; k < 2; k++) if (rand() < 0.5) {
      const u = 0.25 + 0.6 * rand();
      const bend = Math.max(0, u - 0.33) / 0.67;
      C.copy(P).addScaledVector(D, u * Lp).addScaledVector(fn, -bend * bend * Lp * 0.45 + Wp * fold + 0.002).addScaledVector(T, bend * bend * Lp * 0.22);
      b.drops.push(C.x, C.y, C.z, 0.002 + 0.003 * rand());
    }
    if (rand() < 0.2) {
      C.copy(P).addScaledVector(D, Lp).addScaledVector(fn, -Lp * 0.45 - 0.005).addScaledVector(T, Lp * 0.22);
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
    const droop = (0.08 + rand() * 0.25) * L;
    // a frond is still green or has turned orange and copper, hardly ever between (all of them in between had
    // made the stands one straw gold); green and orange side by side in a stand, more turned the further on it is
    const stage = rand() < 0.65 - 0.5 * fernStage ? 0.04 + 0.14 * rand() : 0.58 + 0.3 * rand();
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
  private cells = new Map<string, { mesh: THREE.Object3D | null; crowns: { x: number; z: number }[]; lod: number; born: number }>();
  // the level a cell had before: dissolving away under the new one, then gone
  private leaving: { mesh: THREE.Object3D; born: number }[] = [];
  private clock = 0;

  constructor(setup: (m: THREE.ShaderMaterial) => void, private dewMaterial: THREE.Material) {
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(this.material);
    // per stand, set as each is drawn: how far it has dissolved in (or, leaving, out)
    this.material.uniforms.uFade = { value: 1 };
    this.material.uniforms.uFadeOut = { value: 0 };
  }

  /** Dissolve a stand's mesh in (or out) from a time on: the shared material's fade set just before it is drawn. */
  private fading(mesh: THREE.Object3D, born: number, out: boolean) {
    const mat = this.material;
    const fern = mesh.children[0] as THREE.Mesh;
    fern.onBeforeRender = () => {
      mat.uniforms.uFade.value = Math.min(1, (this.clock - born) / FADE);
      mat.uniforms.uFadeOut.value = out ? 1 : 0;
      mat.uniformsNeedUpdate = true;
    };
  }

  private build(ix: number, iz: number, lod: number) {
    const r = mulberry32((Math.imul(ix, 0x2c1b3c6d) ^ Math.imul(iz, 0x297a2d39) ^ 0x5eed) >>> 0);
    const crowns: { x: number; z: number }[] = [];
    const sizes: number[] = [];
    // the stand you start in: a big fern just ahead, arching over you
    if (ix === Math.floor(START.x / CELL) && iz === Math.floor(START.z / CELL)) { crowns.push({ ...START }); sizes.push(1.6); }
    if (r() < 0.7) {
      const n = 2 + Math.floor(r() * 4); // ferns grow in stands: crawl in under them
      const gx = (ix + 0.2 + 0.6 * r()) * CELL, gz = (iz + 0.2 + 0.6 * r()) * CELL;
      for (let i = 0; i < n; i++) {
        const x = gx + (r() - 0.5) * 1.8, z = gz + (r() - 0.5) * 1.8;
        // none in a clearing, smaller towards its edge
        const open = clearing(x, z);
        const size = (1.0 + r() * 0.5) * (1 - 0.45 * open); // (a quarter smaller than they were)
        if (open > 0.45) continue;
        if (Math.hypot(x, z) < 0.3 || crowns.some((c) => Math.hypot(c.x - x, c.z - z) < 0.45)) continue;
        const pd = puddleAt(x, z);
        if (pd && pd.u < 1.06) continue; // ferns stand on the mossy bank, arching over the water
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
  update(px: number, pz: number, dt = 0) {
    this.clock += dt;
    // the old levels done dissolving: gone
    this.leaving = this.leaving.filter((l) => {
      if (this.clock - l.born < FADE) return true;
      this.root.remove(l.mesh); disposeAll(l.mesh);
      return false;
    });
    const i0 = Math.floor(px / CELL), k0 = Math.floor(pz / CELL);
    const R = Math.ceil(RANGE / CELL);
    let changed = false;
    for (let dz = -R; dz <= R && !changed; dz++) for (let dx = -R; dx <= R && !changed; dx++) {
      const ix = i0 + dx, iz = k0 + dz;
      const d = Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz);
      if (d > RANGE) continue;
      const lod = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : 2;
      const key = `${ix},${iz}`;
      const have = this.cells.get(key);
      if (have && have.lod === lod) continue;
      // a new stand dissolves in; a new level dissolves in over the old one, which dissolves out under it (the
      // same dither, mirrored: between them every pixel is drawn once)
      const c = { ...this.build(ix, iz, lod), born: this.clock };
      if (have?.mesh) { this.fading(have.mesh, this.clock, true); this.leaving.push({ mesh: have.mesh, born: this.clock }); }
      this.cells.set(key, c);
      if (c.mesh) { this.fading(c.mesh, this.clock, false); this.root.add(c.mesh); }
      changed = true;
    }
    for (const [key, c] of this.cells) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz) < DROP) continue;
      if (c.mesh) { this.root.remove(c.mesh); disposeAll(c.mesh); }
      this.cells.delete(key);
      // (out past DROP, in the haze: simply gone)
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
uniform float uFade, uFadeOut;

void main() {
  // dissolving in (or out, under a new level of detail): a fixed dither on the screen, mirrored for the one going
  if (uFade < 1.0 || uFadeOut > 0.5) {
    vec2 q = fract(gl_FragCoord.xy * vec2(0.1031, 0.1030));
    q += dot(q, q.yx + 33.33);
    float h = fract((q.x + q.y) * q.x);
    if (uFadeOut > 0.5 ? h < uFade : h > uFade) discard;
  }
  float u = vLeaf.x, c = vLeaf.y;
  bool pinna = vLeaf.z > 0.5;
  bool card = vLeaf.z > 1.5;
  // pinnules: lobes down each side of the pinna, deep cut towards the midrib, small teeth on each lobe,
  // the whole outline narrowing to the pinna's tip
  // the lobes lean towards the pinna's tip, narrow and pointed, cut almost to the midrib, finely toothed: lacy, as
  // a lady fern's (eight broad rounded lobes had read as oak leaves). Where a pinnule is only a few pixels it
  // smooths out to the pinna's outline instead of shimmering.
  float P = 28.0; // pinnules close together, nearly touching
  float sp, fine, hw;
  if (card) {
    // a far frond, one card: opposite pairs of pinnae out from the rachis, slanting to the tip, tapering, a little
    // toothed; where they would be finer than a pixel, just the outline
    float pv = (u - abs(c) * 0.05) * 40.0;
    float f = fract(pv) - 0.5;
    float thick = 0.36 * (1.0 - pow(abs(c), 1.6)) * (0.85 + 0.15 * abs(sin(abs(c) * 38.0)));
    float solid = smoothstep(0.3, 0.7, fwidth(pv));
    if (u < 0.22 || abs(c) > 0.97 || (abs(f) > thick && abs(c) > 0.04 && solid < 0.5)) discard;
    u = abs(c); // along a pinna, for the colour
    sp = pv; fine = 0.0; hw = 1.0;
  } else {
    // (a pinnule right at the rachis, and the base whole: starting on a notch, with only a hairline midrib there,
    // the pinnae had looked as if they floated beside the stalk)
    // oblong pinnules with round blunt tips, cut not quite to the midrib, faintly toothed (pointed ones had read
    // spiky): each a half disc at the end of a parallel-sided lobe
    sp = (u - abs(c) * 0.15) * P + 0.5;
    float fr = fract(sp) * 2.0 - 1.0; // -1 .. 1 across one pinnule
    float lobe = sqrt(max(0.0, 1.0 - fr * fr * 1.15));
    float teeth = 0.025 * abs(sin(sp * 3.14159 * 6.0)) * abs(c) * lobe;
    fine = 1.0 - smoothstep(0.1, 0.3, fwidth(u) * P);
    hw = (1.0 - pow(u, 1.25)) * mix(0.78, 0.3 + 0.7 * lobe + teeth, fine);
    hw = max(hw, 0.6 * (1.0 - smoothstep(0.0, 0.08, u)));
    if (pinna && abs(c) > hw) discard;
  }
  if (nearFade(vWorldPos, 0.05, 0.16) < 0.5) discard;
  DEPTH_ONLY // the shadow pass: past the discards, nothing more to work out

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  bool under = !gl_FrontFacing;
  if (under) N = -N;
  vec3 L = normalize(uLightDir);

  // autumn: green, then gold, then rust and brown; the tip of a frond and of a pinna turn first
  float stage = clamp(vFrond.x + 0.35 * vFrond.z + 0.15 * u - 0.15, 0.0, 1.0);
  // (straw and copper, not a bright yellow: a saturated yellow lit up every sharp edge)
  vec3 green = vec3(0.08, 0.2, 0.035), gold = vec3(0.42, 0.27, 0.09), rust = vec3(0.46, 0.17, 0.045), brown = vec3(0.18, 0.08, 0.03);
  vec3 col = stage < 0.4 ? mix(green, gold, stage / 0.4) : stage < 0.75 ? mix(gold, rust, (stage - 0.4) / 0.35) : mix(rust, brown, (stage - 0.75) / 0.25);
  col *= 0.85 + 0.3 * vFrond.w;
  if (pinna) {
    // the midrib and a vein into each pinnule: paler on a green one, darker on a turned one
    float mid = 1.0 - smoothstep(0.0, 0.05, abs(c));
    float vein = (1.0 - smoothstep(0.0, 0.05, abs(fract(sp) - 0.5) * 2.0 - 0.92)) * step(0.08, abs(c)) * fine;
    vec3 rib = stage < 0.3 ? col * 1.3 + 0.02 : col * 0.55;
    col = mix(col, rib, clamp(mid + 0.4 * vein, 0.0, 1.0) * 0.6);
    // sori: rows of rust spore dots under each pinnule, either side of its vein
    if (under && !card) {
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
  lit += rimLight(N, V) * col * 2.0 * rimShade(shadow);
  // with the sun behind you, the pinnae turned to it catch it: the counterpart of the glow through them
  lit += (SUN_GLOW * 0.8 + col * 0.6) * pow(max(dot(N, L) * 0.5 + 0.5, 0.0), 2.0) * withSun(V, L) * sunCatch(vWorldPos, shadow) * (pinna ? 1.0 : 0.4);
  // the crown sits in the moss: dark at the foot
  lit *= mix(0.4, 1.0, smoothstep(0.0, 0.12, vFrond.z));
  gl_FragColor = vec4(tonemap(grade(lit)), 1.0);
  #include <colorspace_fragment>
}
`;
