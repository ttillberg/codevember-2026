// The crowns, after the splash, where the light seeps down through the leaves: spruce boughs and birch twigs on
// the trunks, from a couple of metres up into the haze. From down in the moss they show mostly ten to thirty metres
// off, so every trunk in range gets them. Each a card with its shape cut in the fragment shader, instanced, one
// mesh for the boughs and one for the birch leaves; the light shafts (post.ts) are counted from the depth, so the
// sun now comes down in beams between the leaves. Not in the shadow map: the floor's light already comes in canopy
// spots (shaders.ts canopyAt).
//  - spruce boughs: in whorls up the trunk, long low down and short high up, drooping and turning up at the tip;
//    a lobed, ragged outline of shoots; dark, the needles' edges glowing gold-green with the sun behind them
//  - birch: hanging curtains of fine twigs with small leaves, yellow-green to gold, thin, so they glow against the
//    sun: the splash's light through the crowns
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { trunkFoot, trunkRadius, type Trunk } from './trees';

const coarse = matchMedia('(pointer: coarse)').matches;
const MAX_BOUGH = coarse ? 12000 : 30000, MAX_LEAF = coarse ? 2500 : 6000;
const HEIGHT = 30; // trees.ts
const CROWN_TOP = 28; // a spruce's boughs go nearly to the top of its trunk (trees.ts HEIGHT, 30): no bare pole above

/**
 * A mid/far bough card: a gently arched main spray along +x (0..1, across z -0.5..0.5) plus a drooping
 * hanging twig curtain underneath along its spine, so seen from below or the side at mid-distance it has
 * real 3D conifer volume instead of reading as a flat paper plane.
 */
function boughGeometry() {
  const main = new THREE.PlaneGeometry(1, 1, 6, 4);
  main.rotateX(-Math.PI / 2);
  main.translate(0.5, 0, 0);
  // gentle cross-arch so outer shoots droop naturally off the central bough
  const mp = main.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < mp.count; i++) {
    const z = mp.getZ(i);
    mp.setY(i, -0.14 * z * z * 4);
  }
  main.computeVertexNormals();

  // hanging spruce-twig skirt underneath (two gently splayed vertical-ish curtains along the bough)
  const pos = [...(mp.array as Float32Array)];
  const nor = [...((main.attributes.normal as THREE.BufferAttribute).array as Float32Array)];
  const uv = [...((main.attributes.uv as THREE.BufferAttribute).array as Float32Array)];
  const idx = Array.from(main.index!.array);
  const skirt = (zOff: number, tilt: number) => {
    const base = pos.length / 3;
    const NU = 6, NV = 2;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV; // 0 at bough spine .. 1 hanging down
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const drop = 0.24 * Math.sin(Math.PI * Math.pow(u, 0.85)) * v;
        pos.push(u, -drop, zOff + tilt * drop);
        nor.push(0, 0.2, zOff >= 0 ? 0.98 : -0.98);
        // map skirt onto the same (u, across) space as the main bough so the needle-tuft shader cuts both seamlessly
        uv.push(u, 0.5 + (zOff >= 0 ? 1 : -1) * (0.12 + 0.36 * v));
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + NU + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  skirt(0.06, 0.35);
  skirt(-0.06, -0.35);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/**
 * A birch branch anchored at the trunk (0, 0, 0) and reaching out along +x (0..1):
 *  - part 0: a slender dark woody limb curving gently out and up, with two forked side-twigs (no floating curtains)
 *  - part 1: angled and drooping foliage cards clustered along the outer two-thirds, tilted at varied angles so
 *    looking straight up from a worm's eye shows airy birch leaves instead of edge-on horizontal splinters
 */
function curtainGeometry() {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], part: number[] = [], idx: number[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], pt: number) => {
    const k = pos.length / 3;
    const pts = [a, b, c, d], uvs = [ua, ub, uc, ud];
    for (let i = 0; i < 4; i++) {
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      nor.push(n.x, n.y, n.z);
      uv.push(uvs[i][0], uvs[i][1]);
      part.push(pt);
    }
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  };
  // slender woody limb from trunk (0,0,0) arching gently up and outward, plus 2 forks
  const limb = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, r0: number, r1: number, segs = 4) => {
    const at = (t: number) => {
      const s = 1 - t;
      return v(0, 0, 0).addScaledVector(p0, s * s).addScaledVector(p1, 2 * s * t).addScaledVector(p2, t * t);
    };
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const a = at(t0), b = at(t1);
      const dir = b.clone().sub(a).normalize();
      const s1 = v(0, 1, 0).cross(dir);
      if (s1.lengthSq() < 1e-4) s1.set(0, 0, 1); else s1.normalize();
      const s2 = dir.clone().cross(s1).normalize();
      const ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
      for (const s of [s1, s2]) {
        const n = s === s1 ? s2 : s1;
        quad(
          a.clone().addScaledVector(s, -ra), a.clone().addScaledVector(s, ra),
          b.clone().addScaledVector(s, -rb), b.clone().addScaledVector(s, rb),
          n, [0, t0], [1, t0], [0, t1], [1, t1], 0,
        );
      }
    }
  };
  limb(v(0, 0, 0), v(0.45, 0.24, 0.02), v(0.95, 0.22, -0.02), 0.015, 0.003, 5);
  limb(v(0.32, 0.14, 0.01), v(0.58, 0.24, 0.18), v(0.82, 0.12, 0.34), 0.008, 0.002, 3);
  limb(v(0.42, 0.18, 0.01), v(0.66, 0.24, -0.16), v(0.88, 0.10, -0.32), 0.008, 0.002, 3);

  // foliage sprays: tilted canopies (visible when looking UP from below) + gently drooping weeping drapes
  const card = (cx: number, cy: number, cz: number, w: number, h: number, rx: number, ry: number, rz: number, curve: number) => {
    const e = new THREE.Euler(rx, ry, rz, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(e);
    const n = v(0, 1, 0).applyQuaternion(q).normalize();
    const NU = 2, NV = 3;
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const vt = j / NV; // 0 top (attached to twig) .. 1 hanging/outer tip
      for (let i = 0; i <= NU; i++) {
        const ut = i / NU - 0.5;
        const p = v(ut * w, -vt * h, -vt * vt * curve).applyQuaternion(q);
        pos.push(cx + p.x, cy + p.y, cz + p.z);
        nor.push(n.x, n.y, n.z);
        uv.push(ut, vt);
        part.push(1);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + NU + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };
  // shallow canopy fans (angled ~40-55° so looking up from the moss shows full delicate leaves, not edge-on lines)
  card(0.62, 0.26, 0.02, 0.58, 0.68, 0.85, 0.2, 0.15, 0.12);
  card(0.84, 0.18, 0.26, 0.48, 0.60, 0.65, 1.1, -0.25, 0.14);
  card(0.86, 0.16, -0.24, 0.48, 0.60, 0.72, -1.05, 0.2, 0.14);
  // graceful weeping birch curtain hanging off the mid/outer limb
  card(0.52, 0.20, 0.12, 0.44, 0.72, 0.22, 0.6, 0.1, 0.1);
  card(0.76, 0.22, -0.06, 0.46, 0.76, 0.28, -0.7, -0.1, 0.1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

/**
 * A spruce bough near you, as it is: a branch along +x (0..1, drooped by the vertex shader as the card is), side
 * shoots out and forward, alternating, short toward the tip, and on the long ones shoots of their own; needles all
 * round every twig (a bottle brush, not a comb), pointing forward. Some shoots gone gold at their outer ends, as in
 * autumn. Built once. Attributes: part (0 wood, 1 needle), t (along a needle, base 0 .. tip 1), gold (0..1).
 */
function boughModel(seed: number) {
  const rnd = mulberry32(seed);
  const pos: number[] = [], nor: number[] = [], part: number[] = [], tt: number[] = [], gold: number[] = [], idx: number[] = [];
  const step = coarse ? 0.018 : 0.012, round = coarse ? 3 : 5;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, pt: number, t0: number, t1: number, g: number) => {
    const i = pos.length / 3;
    for (const [p, t] of [[a, t0], [b, t0], [c, t1], [d, t1]] as [THREE.Vector3, number][]) {
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); part.push(pt); tt.push(t); gold.push(g);
    }
    idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  };
  /** a twig from p0 along dir, its wood a thin strip and needles all round it */
  const twig = (p0: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, g: number) => {
    const side = v(0, 1, 0).cross(dir).normalize(); // across the twig, flat
    const up = dir.clone().cross(side).normalize();
    // the wood: two crossed strips, tapering
    for (const s of [side, up]) {
      const tip = p0.clone().addScaledVector(dir, len);
      quad(p0.clone().addScaledVector(s, r0), p0.clone().addScaledVector(s, -r0), tip.clone().addScaledVector(s, r0 * 0.3), tip.clone().addScaledVector(s, -r0 * 0.3), up, 0, 0, 0, 0);
    }
    for (let d = step * 0.5; d < len; d += step * (0.8 + 0.4 * rnd())) {
      const at = p0.clone().addScaledVector(dir, d);
      const outer = d / len;
      const nl = 0.034 * (0.85 + 0.3 * rnd()) * (1 - 0.35 * outer * outer); // shorter at the tip
      const gg = g * THREE.MathUtils.smoothstep(outer, 0.35, 0.9);
      for (let k = 0; k < round; k++) {
        const ph = (k + rnd() * 0.6) / round * Math.PI * 2;
        const radial = side.clone().multiplyScalar(Math.cos(ph)).addScaledVector(up, Math.sin(ph));
        const nd = dir.clone().multiplyScalar(0.65).addScaledVector(radial, 0.76).normalize();
        const w = v(0, 0, 0).crossVectors(nd, dir).normalize().multiplyScalar(0.003);
        const base = at.clone().addScaledVector(radial, r0 * 0.6), tip = base.clone().addScaledVector(nd, nl);
        const n = v(0, 0, 0).crossVectors(w, nd).normalize();
        quad(base.clone().add(w), base.clone().sub(w), tip.clone().addScaledVector(w, 0.25), tip.clone().addScaledVector(w, -0.25), n, 1, 0, 1, gg);
      }
    }
  };
  // the branch, a little crooked
  const dir0 = v(1, 0.02, 0).normalize();
  twig(v(0, 0, 0), dir0, 1.0, 0.012, rnd() < 0.5 ? 0.6 * rnd() : 0);
  // side shoots, alternating, out and forward, shorter toward the tip
  let left = rnd() < 0.5;
  for (let u = 0.07; u < 0.93; u += 0.05 + 0.025 * rnd()) {
    left = !left;
    const len = 0.32 * Math.pow(1 - u, 0.6) + 0.05;
    const dir = v(0.75, -0.08 + 0.1 * rnd(), (left ? -1 : 1) * (0.62 + 0.15 * rnd())).normalize();
    const g = rnd() < 0.45 ? 0.55 + 0.45 * rnd() : 0.15 * rnd();
    const p0 = v(u, 0.02 * u, 0);
    twig(p0, dir, len, 0.006, g);
    // and on the long ones, shoots of their own
    if (len > 0.16) for (let s = 0.3; s < 0.85; s += 0.28) {
      const q0 = p0.clone().addScaledVector(dir, len * s);
      const sd = dir.clone().multiplyScalar(0.8).add(v(0.3, 0, (left ? 1 : -1) * 0.35 * (rnd() < 0.5 ? -1 : 1))).normalize();
      twig(q0, sd, len * 0.35, 0.004, g);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  geo.setAttribute('nt', new THREE.Float32BufferAttribute(tt, 1));
  geo.setAttribute('gold', new THREE.Float32BufferAttribute(gold, 1));
  geo.setIndex(idx);
  return geo;
}

// near boughs are the model, far ones the card; across a band round NEAR they dissolve into each other
const NEAR = coarse ? 5.0 : 7.0; // (a model is some 11,000 vertices: a few hundred is plenty)
const MAX_NEAR = coarse ? 80 : 300;
const CANOPY_SIZE = 96, CANOPY_PX = coarse ? 256 : 384; // metres, pixels: a quarter metre a pixel

export class Foliage {
  readonly root = new THREE.Group();
  readonly boughs: THREE.InstancedMesh;
  readonly leaves: THREE.InstancedMesh;
  private bdata: THREE.InstancedBufferAttribute;
  private ldata: THREE.InstancedBufferAttribute;
  readonly model: THREE.InstancedMesh;
  private mdata: THREE.InstancedBufferAttribute;
  private placed: Trunk[] | null = null;
  // every bough placed: its matrix, its data, where it hangs from (sorted into card or model as you move)
  private allM = new Float32Array(MAX_BOUGH * 16);
  private allD = new Float32Array(MAX_BOUGH * 4);
  private allN = 0;
  private sortedAt = new THREE.Vector3(Infinity, 0, 0);
  // the crowns' shade on the floor, seen from above: the crowns are too high to see from a worm's eye, but their
  // shade is what lies on the ground. Every bough card and birch curtain a soft dark spot, moved along the sun by
  // its height (where its shadow falls on the plane y = 0); drawn again when the crowns or the sun move.
  // shaders.ts canopyAt reads it under its fine spots of sun.
  readonly canopyCanvas = document.createElement('canvas');
  readonly canopyMap: THREE.CanvasTexture;
  readonly canopyBox = new THREE.Vector3(0, 0, CANOPY_SIZE); // x, z of its corner, its size in metres
  private canopyAt = new THREE.Vector2(Infinity, Infinity);
  canopyDirty = true;

  constructor(setup: (m: THREE.ShaderMaterial) => void, private light: THREE.Vector3) {
    this.canopyCanvas.width = this.canopyCanvas.height = CANOPY_PX;
    this.canopyMap = new THREE.CanvasTexture(this.canopyCanvas);
    this.canopyMap.flipY = false;
    this.canopyMap.colorSpace = THREE.NoColorSpace;
    const make = (geo: THREE.BufferGeometry, max: number, kind: string) => {
      const data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      geo.setAttribute('iData', data);
      const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {}, defines: { [kind]: 1 } });
      setup(mat);
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.count = 0;
      m.frustumCulled = false;
      this.root.add(m);
      return [m, data] as const;
    };
    [this.boughs, this.bdata] = make(boughGeometry(), MAX_BOUGH, 'BOUGH');
    [this.leaves, this.ldata] = make(curtainGeometry(), MAX_LEAF, 'LEAVES');
    [this.model, this.mdata] = make(boughModel(7), MAX_NEAR, 'MODEL');
  }

  /** The boughs into the card or the model by how near they hang to the eye (both, across the band between). */
  private sort(cam: THREE.Vector3) {
    this.sortedAt.copy(cam);
    const CM = this.boughs.instanceMatrix.array as Float32Array, CD = this.bdata.array as Float32Array;
    const MM = this.model.instanceMatrix.array as Float32Array, MD = this.mdata.array as Float32Array;
    let nc = 0, nm = 0;
    for (let i = 0; i < this.allN; i++) {
      const o = i * 16;
      const d = Math.hypot(this.allM[o + 12] - cam.x, this.allM[o + 13] - cam.y, this.allM[o + 14] - cam.z);
      if (d > NEAR - 0.5) { CM.set(this.allM.subarray(o, o + 16), nc * 16); CD.set(this.allD.subarray(i * 4, i * 4 + 4), nc * 4); nc++; }
      if (d < NEAR + 0.5 && nm < MAX_NEAR) { MM.set(this.allM.subarray(o, o + 16), nm * 16); MD.set(this.allD.subarray(i * 4, i * 4 + 4), nm * 4); nm++; }
    }
    this.boughs.count = nc; this.model.count = nm;
    this.boughs.instanceMatrix.needsUpdate = this.model.instanceMatrix.needsUpdate = true;
    this.bdata.needsUpdate = this.mdata.needsUpdate = true;
  }

  /** The crowns' shade into the map, around the eye. */
  private drawCanopy(cam: THREE.Vector3) {
    this.canopyDirty = false;
    const S = CANOPY_SIZE, N = CANOPY_PX, k = N / S;
    const x0 = Math.round(cam.x / 4) * 4 - S / 2, z0 = Math.round(cam.z / 4) * 4 - S / 2;
    this.canopyAt.set(cam.x, cam.z);
    this.canopyBox.set(x0, z0, S);
    const L = this.light, sx = L.x / Math.max(L.y, 0.05), sz = L.z / Math.max(L.y, 0.05);
    const ctx = this.canopyCanvas.getContext('2d')!;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, N, N);
    ctx.fillStyle = '#000';
    const spot = (M: Float32Array, o: number, lx: number, ly: number, size: number, alpha: number) => {
      // the card's middle in the world, and its size from its matrix
      const x = M[o] * lx + M[o + 4] * ly + M[o + 12], y = M[o + 1] * lx + M[o + 5] * ly + M[o + 13], z = M[o + 2] * lx + M[o + 6] * ly + M[o + 14];
      const len = Math.hypot(M[o], M[o + 1], M[o + 2]);
      // (heights squeezed toward the crowns' middle: projected at their own, each tree's boughs from 1 to 28 m
      // up lay along the sun in one streak 25 m long, the floor in stripes; this way a tree is a patch, gaps between)
      const yp = 10 + (y - 10) * 0.3;
      // each spot a little bigger or smaller, thicker or thinner: a crown in clumps
      const j = Math.sin(o * 12.9898 + y * 78.233) * 43758.5453, jr = j - Math.floor(j);
      const px = (x - yp * sx - x0) * k, pz = (z - yp * sz - z0) * k, r = Math.max(0.6, len * size * k * (0.6 + 0.8 * jr));
      if (px < -r || pz < -r || px > N + r || pz > N + r) return;
      ctx.globalAlpha = alpha * (0.5 + jr);
      ctx.beginPath();
      ctx.arc(px, pz, r, 0, Math.PI * 2);
      ctx.fill();
    };
    // (lightly each: thousands overlap, at 0.28 the floor under the wood had gone all one shade)
    for (let i = 0; i < this.allN; i++) spot(this.allM, i * 16, 0.5, 0, 0.4, 0.09);
    const LM = this.leaves.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.leaves.count; i++) spot(LM, i * 16, 0.65, 0.1, 0.45, 0.06); // birch: thin, light lets through
    // soften: a blurred copy over itself
    ctx.globalAlpha = 1;
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(this.canopyCanvas, 0, 0);
    ctx.filter = 'none';
    this.canopyMap.needsUpdate = true;
  }

  /** Hang the crowns on the trunks in range: again only when the trees' set of trunks has changed. */
  update(trunks: Trunk[], cam: THREE.Vector3) {
    if (this.canopyDirty || Math.hypot(cam.x - this.canopyAt.x, cam.z - this.canopyAt.y) > 12) {
      if (trunks === this.placed) this.drawCanopy(cam);
    }
    if (trunks === this.placed) {
      if (cam.distanceTo(this.sortedAt) > 0.4) this.sort(cam);
      return;
    }
    this.canopyDirty = true;
    this.placed = trunks;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const LD = this.ldata.array as Float32Array;
    let nb = 0, nl = 0;
    // nearest trunks first so if MAX_BOUGH or MAX_LEAF ever fills on far trees, near/mid crowns stay complete
    const ordered = trunks.slice().sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    for (const t of ordered) {
      const r = mulberry32((Math.imul(Math.round(t.x * 100), 0x7feb352d) ^ Math.imul(Math.round(t.z * 100), 0x846ca68b) ^ 0xf011) >>> 0);
      const foot = trunkFoot(t);
      if (t.spruce) {
        // a spruce, lower and compact: a dense dark cone from two or three metres up to its top, the boughs long low
        // down and short at the top, the lowest few grey and dying
        const top = HEIGHT * t.h - 0.6, low = 2.0 + r() * 1.5; // (from two metres: lower, they were in the way)
        // (a cone: as long low down it had read as a column, the trunk showing in bands between the whorls)
        for (let h = low; h < top && nb < MAX_BOUGH; h += 0.2 + 0.15 * r() + h * 0.006) {
          const n = 6 + Math.floor(r() * 3), a0 = r() * Math.PI * 2;
          const u = (h - low) / (top - low);
          const reach = (0.15 + 3.6 * Math.pow(1 - u, 1.35)) * (0.85 + 0.3 * r()) * (0.75 + t.r);
          for (let k = 0; k < n && nb < MAX_BOUGH; k++) {
            const az = a0 + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
            const rad = trunkRadius(t, az, h) * 0.9;
            p.set(t.x + Math.cos(az) * rad, foot + h, t.z + Math.sin(az) * rad);
            q.setFromEuler(e.set(0, -az, -0.05 - 0.2 * r(), 'YXZ'));
            const L = reach * (0.8 + 0.4 * r());
            s.set(L, L, L * (0.75 + 0.25 * r()));
            m.compose(p, q, s).toArray(this.allM, nb * 16);
            this.allD.set([0.35 + 0.35 * r(), 0.15 * r(), r(), Math.max(0, 1 - (h - low) / 1.5) * r()], nb * 4);
            nb++;
          }
        }
      } else if (!t.birch) {
        // a pine, after the reference: branches from eight to twelve metres up, but few and open, two or three a
        // whorl a metre or more apart, turned up toward the light; the lowest grey and bare, the needles thicker
        // toward the top (dense whorls to the ground made it a spruce)
        const low = 8 + r() * 4;
        for (let h = low; h < CROWN_TOP && nb < MAX_BOUGH; h += 0.9 + 0.8 * r()) {
          const n = 2 + Math.floor(r() * 2), a0 = r() * Math.PI * 2;
          const u = (h - low) / (CROWN_TOP - low);
          const reach = (0.6 + 2.4 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.2 + u * 0.9)), 0.7)) * (0.8 + 0.4 * r()) * (0.6 + t.r);
          for (let k = 0; k < n && nb < MAX_BOUGH; k++) {
            const az = a0 + (k / n) * Math.PI * 2 + (r() - 0.5) * 1.0;
            const rad = trunkRadius(t, az, h) * 0.9;
            p.set(t.x + Math.cos(az) * rad, foot + h, t.z + Math.sin(az) * rad);
            // out along az, tipped up: a pine's branches climb
            q.setFromEuler(e.set(0, -az, 0.15 + 0.3 * r(), 'YXZ'));
            const L = reach * (0.75 + 0.5 * r());
            s.set(L, L, L * (0.6 + 0.25 * r()));
            m.compose(p, q, s).toArray(this.allM, nb * 16);
            // little droop; the lower third grey and bare
            this.allD.set([0.1 + 0.2 * r(), 0.3 * r(), r(), Math.max(0, 1 - u * 3) * (0.5 + 0.5 * r())], nb * 4);
            nb++;
          }
        }
      } else {
        // birch: slender branches anchored right into the white bark from ~4 m all the way to the crown tip.
        // High up (> 12 m) we cheat cheaply with wider vertical steps and slightly larger upward-reaching sprays,
        // plus a crown-top plume so the white trunk never sticks out as an empty pole.
        const top = HEIGHT * t.h - 0.35;
        const low = 3.8 + r() * 1.2;
        for (let h = low; h < top && nl < MAX_LEAF; ) {
          const u = (h - low) / Math.max(top - low, 1);
          const high = h > 11.5;
          const branches = high ? 2 : 2 + (r() < 0.4 ? 1 : 0);
          const a0 = r() * Math.PI * 2;
          // broad airy mid-crown tapering cleanly to a rounded top, slightly scaled up high for cheap coverage
          const crown = Math.sin(Math.PI * Math.min(1, 0.16 + u * 0.8));
          const reach = (0.75 + 1.45 * Math.pow(crown, 0.65)) * (high ? 1.22 : 1.0) * (0.8 + 0.4 * r());
          for (let k = 0; k < branches && nl < MAX_LEAF; k++) {
            const az = a0 + (k / branches) * Math.PI * 2 + (r() - 0.5) * 0.85;
            const rad = trunkRadius(t, az, h) * 0.82;
            p.set(t.x + Math.cos(az) * rad, foot + h, t.z + Math.sin(az) * rad);
            // upper branches angle steeper upward to envelop the trunk top
            const lift = (high ? 0.25 + 0.35 * u : 0.08 + 0.22 * r());
            q.setFromEuler(e.set((r() - 0.5) * 0.18, -az, lift, 'YXZ'));
            const L = reach * (0.85 + 0.35 * r());
            s.set(L, L * (0.9 + 0.3 * r()), L * (0.9 + 0.3 * r()));
            m.compose(p, q, s).toArray(this.leaves.instanceMatrix.array as Float32Array, nl * 16);
            LD.set([r(), r(), r(), r()], nl * 4);
            nl++;
          }
          h += high ? (1.2 + 0.8 * r()) : (0.6 + 0.55 * r());
        }
        // crown-top cap: 3 upward-reaching sprays right at the tip so no bare white pole pokes through
        for (let k = 0; k < 3 && nl < MAX_LEAF; k++) {
          const az = (k / 3) * Math.PI * 2 + r() * 0.7;
          const ht = top - 0.6 + r() * 0.4;
          p.set(t.x, foot + ht, t.z);
          q.setFromEuler(e.set((r() - 0.5) * 0.15, -az, 0.65 + 0.25 * r(), 'YXZ'));
          const L = 1.15 + 0.45 * r();
          s.set(L, L * 1.1, L * 1.1);
          m.compose(p, q, s).toArray(this.leaves.instanceMatrix.array as Float32Array, nl * 16);
          LD.set([r(), r(), r(), r()], nl * 4);
          nl++;
        }
      }
    }
    this.allN = nb;
    this.leaves.count = nl;
    this.leaves.instanceMatrix.needsUpdate = true;
    this.ldata.needsUpdate = true;
    this.sort(cam);
  }

  /** Not in the shadow map: the floor's light comes in canopy spots already. */
  forShadow(on: boolean) { this.root.visible = !on; }
}

const vertexShader = /* glsl */ `
attribute vec4 iData;
uniform float uTime;
#ifdef MODEL
attribute float part;
attribute float nt;
attribute float gold;
varying vec3 vModel; // part, along a needle, gold
#elif defined(LEAVES)
attribute float part;
varying float vPart;
#endif
varying float vFar; // 0 .. 1 across the band where the model and the card dissolve into each other
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vData;
void main() {
  vec3 p = position;
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFar = clamp((distance(cameraPosition, origin) - (${NEAR.toFixed(1)} - 0.5)) / 1.0, 0.0, 1.0);
  #if defined(BOUGH) || defined(MODEL)
  // drooping out from the trunk, the tip turning up; swaying a little, more at the tip
  float u = p.x;
  p.y += -iData.x * u * u + iData.y * u * u * u * u;
  p.y += sin(uTime * 0.8 + iData.z * 30.0) * 0.015 * u * u;
  #ifdef MODEL
  vUv = vec2(u, p.z);
  vModel = vec3(part, nt, gold);
  #else
  // bough card + hanging twig skirts share uv.x (0..1 along bough) and uv.y - 0.5 (-0.5..0.5 across/down)
  vUv = vec2(uv.x, uv.y - 0.5);
  #endif
  #else
  // birch branch anchored at trunk (x = 0): gentle breeze sway increasing toward the outer tips & hanging sprays
  vPart = part;
  float tip = clamp(p.x, 0.0, 1.0);
  float hang = max(0.0, -p.y);
  float sway = sin(uTime * 1.05 + iData.z * 40.0 + p.x * 2.0) * (0.025 * tip * tip + 0.035 * hang * hang);
  p.z += sway;
  p.y += sway * 0.35;
  vUv = uv;
  #endif
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vData = iData;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uLightDir;
${mossLighting}
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vData;
varying float vFar;
#ifdef MODEL
varying vec3 vModel;
#elif defined(LEAVES)
varying float vPart;
#endif
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 col;
  float thin;
  float seed = vData.z * 50.0;
  #if defined(BOUGH) || defined(MODEL)
  // the model near, the card far: across the band a fixed dither, mirrored between the two
  vec2 dq = fract(gl_FragCoord.xy * vec2(0.1031, 0.1030));
  dq += dot(dq, dq.yx + 33.33);
  float dh = fract((dq.x + dq.y) * dq.x);
  #endif
  #ifdef MODEL
  if (dh < vFar) discard;
  // needles: dark green, paler toward their tips; some shoots gold at their outer ends; the wood brown
  col = mix(vec3(0.035, 0.07, 0.025), vec3(0.11, 0.19, 0.06), vModel.y * 0.8 + 0.2 * h21(vec2(vUv.x * 300.0, seed)));
  col = mix(col, mix(vec3(0.62, 0.48, 0.08), vec3(0.85, 0.68, 0.16), vModel.y), vModel.z);
  col = mix(col, vec3(0.12, 0.08, 0.05), step(vModel.x, 0.5));
  col = mix(col, vec3(0.09, 0.08, 0.07), vData.w * 0.85);
  thin = 0.6 * step(0.5, vModel.x) * (1.0 - vData.w);
  #elif defined(BOUGH)
  if (dh >= vFar) discard;
  // mid/far conifer bough: broken into irregular bottle-brush needle tufts on crooked side-shoots with
  // genuine sky gaps between clusters and spiky UV-space needle bristles along every tuft edge (no flat
  // palm-leaf slab and no screen-space TV-static stipple). Pixel-footprint filtering keeps far crowns soft.
  float u = vUv.x, a = vUv.y, aa = abs(a);
  float px = length(fwidth(vUv));
  float detail = 1.0 - smoothstep(0.008, 0.045, px); // crisp individual needle tufts mid-range, softer far off

  // irregular organic outline tapering toward tip and base
  float env = 0.48 * pow(sin(3.14159 * pow(clamp(u, 0.0, 1.0), 0.78)), 0.58);
  env *= 0.62 + 0.55 * n21(vec2(u * 6.5, seed)) + 0.22 * n21(vec2(u * 16.0, seed + 4.3));
  float e = aa / max(env, 1e-3); // 0 along spine .. 1 at outer tip
  if (e > 1.08) discard;

  // crooked woody central stem (peeking out between gaps)
  float spineOff = (n21(vec2(u * 5.0, seed + 2.0)) - 0.5) * 0.055;
  float stemW = mix(0.022, 0.004, u);
  float isWood = 1.0 - smoothstep(stemW * 0.4, stemW + px, abs(a - spineOff));

  // angled irregular side-shoot clusters (angled ~40° forward along +u, warped so they never read as a rigid palm comb)
  float sideSign = a >= 0.0 ? 1.0 : -1.0;
  vec2 shootP = vec2(u - aa * 0.62, aa);
  vec2 warp = (vec2(n21(shootP * 8.0 + seed), n21(shootP * 8.0 + seed + 13.7)) - 0.5) * 0.14;
  vec2 sp = shootP + warp;

  // irregular clumps of sub-branches with real open gaps between them
  float clumps = n21(vec2(sp.x * 13.0, sp.y * 5.5) + seed * 1.3) * 0.58
               + n21(vec2(sp.x * 27.0, sp.y * 14.0) + seed * 2.1) * 0.42;
  // directional fine needle bristles fanning forward-outward from each shoot
  vec2 np = vec2(sp.x * 32.0 - sp.y * 18.0, sp.x * 14.0 + sp.y * 85.0);
  float bristles = n21(np + seed) * 0.55 + n21(np * 2.1 + seed * 3.7) * 0.45;
  float fineNeedles = mix(0.5, bristles, detail);

  // combine envelope, shoot clumps, and spiky needle tips so holes open naturally between clusters
  float density = (1.0 - smoothstep(0.18, 1.02, e)) * 0.65
                + clumps * 0.55
                + (fineNeedles - 0.5) * 0.42;
  // denser near the woody spine, airy and feathery toward outer shoots & tips
  float thresh = mix(0.46, 0.72, smoothstep(0.05, 0.85, e));
  // far away, soften the cutout slightly so sub-pixel needle tips don't sparkle
  float cut = density - thresh;
  if (cut < 0.0 && isWood < 0.5) discard;

  // internal 3D tuft shading: deep shadow inside the bough core & cluster undersides, brighter fresh tips
  float tuftLight = smoothstep(0.0, 0.35, cut) * 0.35 + fineNeedles * 0.35 + smoothstep(0.35, 0.95, e) * 0.3;
  vec3 deepPine = vec3(0.015, 0.036, 0.014);
  vec3 freshTip = vec3(0.068, 0.13, 0.038);
  vec3 needleCol = mix(deepPine, freshTip, clamp(tuftLight, 0.0, 1.0));
  // subtle hint of warm autumn shoot tips (matching boughModel's outer gold softly)
  float autumn = smoothstep(0.68, 0.92, n21(sp * 9.0 + seed + 7.1)) * smoothstep(0.4, 0.95, e) * 0.28;
  needleCol = mix(needleCol, vec3(0.34, 0.25, 0.06), autumn);
  // dark woody twig spine peeking through gaps
  vec3 woodCol = vec3(0.09, 0.06, 0.038);
  col = mix(needleCol, woodCol, isWood * (1.0 - smoothstep(0.05, 0.22, cut)));
  // dead lower boughs weathered grey-brown
  col = mix(col, vec3(0.08, 0.072, 0.064), vData.w * 0.85);
  // backlight comes through outer needle bristles and thin cluster margins
  thin = (1.0 - isWood) * (1.0 - vData.w) * (0.2 + 0.55 * (1.0 - smoothstep(0.0, 0.28, cut))) * (0.35 + 0.65 * smoothstep(0.2, 0.9, e));
  // break up flat-card normal slightly per needle cluster so light models rounded conifer tufts
  float nx = (n21(sp * 22.0 + seed + 1.1) - 0.5) * 0.65 * detail;
  float nz = (n21(sp * 22.0 + seed + 5.7) - 0.5) * 0.65 * detail;
  vec3 Ntuft = normalize(vNormal + vec3(nx, 0.25 * sideSign * (fineNeedles - 0.5), nz));
  #else
  // birch branch & foliage sprays: part 0 is the dark slender woody limb attached to the trunk;
  // part 1 is an airy spray of fine weeping twigs carrying small diamond-shaped autumn birch leaves
  if (vPart < 0.5) {
    // dark purplish-brown silver birch twig, a hint of pale bark near the trunk join
    col = mix(vec3(0.22, 0.20, 0.17), vec3(0.075, 0.055, 0.044), smoothstep(0.0, 0.25, vUv.y));
    thin = 0.0;
  } else {
    float x = vUv.x, d = vUv.y; // x: -0.5..0.5 across, d: 0 top (twig) .. 1 outer/hanging tip
    float px = length(fwidth(vUv));
    // soft organic cluster envelope so leaves never get chopped by a rectangular card border
    float env = 0.46 * pow(sin(3.14159 * clamp(d * 0.96 + 0.02, 0.0, 1.0)), 0.55) * (0.78 + 0.32 * n21(vec2(d * 4.5, seed)));
    if (abs(x) > env || d < 0.02 || d > 0.97) discard;

    // 2-3 fine gently-curving weeping twigs (subtle bend, never thick corkscrew sine waves)
    float twigs = 2.6;
    float curve = 0.09 * sin(d * 3.2 + seed) + 0.04 * sin(d * 7.5 + seed * 1.7);
    float tx = (x + 0.5) * twigs + curve;
    float ti = floor(tx), tf = fract(tx) - 0.5;
    float twigW = mix(0.015, 0.005, d); // hair-thin dark shoot tapering to the tip
    float twig = (1.0 - smoothstep(twigW * 0.5, twigW + px * 1.4, abs(tf))) * step(d, 0.92);

    // small diamond/deltoid birch leaves tucked right alongside each twig (two staggered layers for natural density)
    float hitLeaf = 0.0;
    float leafTone = 0.5;
    for (int lay = 0; lay < 2; lay++) {
      float fl = float(lay);
      float row = d * (10.0 + fl * 3.0) + h21(vec2(ti + fl * 5.0, seed)) * 3.0;
      float ri = floor(row), rf = fract(row) - 0.5;
      float side = mod(ri + fl, 2.0) < 1.0 ? -1.0 : 1.0;
      float k = h21(vec2(ti * 7.0 + ri + fl * 19.0, seed));
      float k2 = h21(vec2(ri + fl * 11.0, ti * 3.0 + seed));
      if (k < 0.24) continue; // airy natural gaps
      // tucked close to the twig so leaves stay attached (no floating gap)
      vec2 lp = vec2(tf - side * (0.11 + 0.07 * k2), rf - (k - 0.5) * 0.32);
      float ang = side * (0.55 + 0.35 * k2) + (k - 0.5) * 0.5;
      lp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * lp;
      // deltoid birch leaf: broad rounded base tapering to a crisp pointed tip
      float sz = 0.25 + 0.14 * k;
      float uL = lp.y / sz; // -1 base .. +1 tip
      float wL = (1.0 - smoothstep(-0.35, 1.0, uL)) * smoothstep(-0.95, -0.35, uL) * 0.72;
      float inside = step(abs(lp.x / sz), wL) * step(-0.95, uL) * step(uL, 1.0);
      if (inside > 0.5) {
        hitLeaf = 1.0;
        leafTone = h21(vec2(ri + fl * 13.0, ti * 5.0 + seed));
      }
    }
    if (hitLeaf < 0.5 && twig < 0.5) discard;
    vec3 green = vec3(0.24, 0.36, 0.08);
    vec3 gold = vec3(0.76, 0.58, 0.11);
    vec3 amber = vec3(0.52, 0.28, 0.08);
    col = mix(green, gold, smoothstep(0.18, 0.78, leafTone * 0.7 + vData.x * 0.45));
    col = mix(col, amber, step(0.86, leafTone) * 0.65);
    col *= 0.84 + 0.26 * n21(vUv * 24.0 + seed);
    col = mix(col, vec3(0.08, 0.06, 0.045), twig * (1.0 - hitLeaf * 0.7));
    thin = hitLeaf * 0.9;
  }
  #endif
  #ifdef BOUGH
  vec3 N = Ntuft;
  #else
  vec3 N = normalize(vNormal);
  #endif
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uLightDir);
  // up there the canopy's own spots light it (no shadow map reaches that high)
  float lit = canopyAt(vWorldPos);
  float diff = max(dot(N, L), 0.0) * 0.6 + 0.4;
  // the sun through it from behind: thin leaves and the needles' edges glow
  float thru = pow(max(dot(-V, L), 0.0), 3.0) * thin;
  vec3 c = col * (0.35 * skyTint(N, 1.0) + 1.1 * diff * lit)
         + col * vec3(1.7, 1.35, 0.6) * thru * (0.35 + 0.65 * lit) * 2.2;
  c += rimLight(N, V) * col * 1.2;
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
