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

/** A bough: a strip out along +x (0..1), across z (-0.5..0.5); the vertex shader droops it. */
function boughGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 6, 2);
  g.rotateX(-Math.PI / 2);
  g.translate(0.5, 0, 0);
  return g;
}
/** A birch curtain: two crossed vertical cards hanging down from the origin (0 .. -1), across -0.5..0.5. */
function curtainGeometry() {
  const a = new THREE.PlaneGeometry(1, 1, 1, 4);
  a.translate(0, -0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const pos = [...(a.attributes.position.array as Float32Array), ...(b.attributes.position.array as Float32Array)];
  const uv = [...(a.attributes.uv.array as Float32Array), ...(b.attributes.uv.array as Float32Array)];
  const n = a.attributes.position.count;
  const idx = [...Array.from(a.index!.array), ...Array.from(b.index!.array, (i) => i + n)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
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

// near boughs are the model, far ones the card; across a metre round NEAR they dissolve into each other
const NEAR = 5.0; // (a model is some 11,000 vertices: a few hundred is plenty)
const MAX_NEAR = coarse ? 80 : 240;
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
    for (let i = 0; i < this.leaves.count; i++) spot(LM, i * 16, 0, -0.5, 0.4, 0.06); // birch: thin, light lets through
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
    for (const t of trunks) {
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
        // birch: branches from four metres up, each hanging a curtain of twigs out from the trunk
        for (let h = 4 + r(); h < 15 && nl < MAX_LEAF; h += 0.5 + 0.6 * r()) {
          const az = r() * Math.PI * 2;
          const out = (0.5 + 1.4 * r()) * (1 - 0.4 * h / 15);
          p.set(t.x + Math.cos(az) * out, foot + h, t.z + Math.sin(az) * out);
          q.setFromEuler(e.set((r() - 0.5) * 0.2, r() * Math.PI, (r() - 0.5) * 0.2));
          const len = 0.9 + 1.2 * r();
          s.set(len * (0.7 + 0.4 * r()), len, len * (0.7 + 0.4 * r()));
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
  vUv = vec2(u, p.z);
  #ifdef MODEL
  vModel = vec3(part, nt, gold);
  #endif
  #else
  // a curtain: swaying, more at the bottom
  float d = -p.y;
  p.x += sin(uTime * 0.9 + iData.z * 40.0) * 0.03 * d * d;
  vUv = vec2(p.x + p.z, d); // across (one card or the other), down
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
  // a spruce bough further off (near ones are the model): a dark mass hanging in clumps, a few holes where the
  // light comes through, its edge soft with needles. A fishbone of shoots with a clean midrib, crisply cut and
  // gold at the tips, had read from a distance as palm fronds: no midrib, the edge a dither the lens blurs into
  // fuzz, and no gold.
  float u = vUv.x, a = vUv.y, aa = abs(a);
  float env = 0.5 * pow(sin(3.14159 * pow(clamp(u, 0.0, 1.0), 0.8)), 0.55);
  env *= 0.5 + 0.65 * n21(vec2(u * 7.0, seed)) + 0.15 * n21(vec2(u * 19.0, seed + 4.0)); // clumps along it
  float e = aa / max(env, 1e-3); // 0 in the middle .. 1 at the edge
  // the edge: a band where it thins out, at random per pixel, so it reads as needles and not a cut
  vec2 eq = fract(gl_FragCoord.xy * vec2(0.0973, 0.1099) + 0.37);
  eq += dot(eq, eq.yx + 19.19);
  float eh = fract((eq.x + eq.y) * eq.y);
  float wob = (n21(vec2(u * 40.0, a * 40.0) + seed) - 0.5) * 0.35;
  if (eh < smoothstep(0.55, 1.0, e + wob)) discard;
  // holes in the mass, now and then
  if (e > 0.35 && n21(vec2(u * 18.0, a * 18.0) + seed * 1.7) > 0.86) discard;
  // dark green, a little lighter toward the edge and the tip; low boughs dead and grey
  float lift = smoothstep(0.4, 1.0, e) * 0.5 + smoothstep(0.65, 1.0, u) * 0.4;
  col = mix(vec3(0.028, 0.05, 0.022), vec3(0.075, 0.12, 0.045), clamp(lift + 0.3 * n21(vec2(u * 50.0, aa * 50.0) + seed), 0.0, 1.0));
  // (no gold far off: the yellow shoots are a detail, the model's near you; far, they lit up the outline)
  col = mix(col, vec3(0.09, 0.08, 0.07), vData.w * 0.85);
  thin = 0.45 * (1.0 - vData.w) * smoothstep(0.3, 0.9, e); // the sun through it only at its thin edge
  #else
  // birch twigs hanging in a curtain that narrows to its tips, leaves along them on either side, jittered, some
  // missing: yellow-green going gold, a few already brown (a grid of even dots read as a printed pattern)
  float x = vUv.x, d = vUv.y;
  float env = 0.5 * (0.25 + 0.75 * pow(sin(3.14159 * min(d * 1.1, 1.0)), 0.6)) * (0.75 + 0.35 * n21(vec2(d * 4.0, seed)));
  if (abs(x) > env || d > 0.97) discard;
  float twigs = 3.0;
  float tx = (x + 0.5) * twigs + 0.25 * sin(d * 5.0 + seed) + 0.15 * sin(d * 13.0 + seed * 2.0);
  float ti = floor(tx), tf = fract(tx) - 0.5;
  float row = d * 9.0 + h21(vec2(ti, seed)) * 3.0;
  float ri = floor(row), rf = fract(row) - 0.5;
  float side = mod(ri, 2.0) < 1.0 ? -1.0 : 1.0;
  float k = h21(vec2(ti * 7.0 + ri, seed));
  float k2 = h21(vec2(ri, ti * 3.0 + seed));
  vec2 lp = vec2(tf - side * (0.2 + 0.1 * k2), rf - (k - 0.5) * 0.35);
  // a birch leaf: a pointed oval, hanging a little askew
  float ang = side * 0.6 + (k2 - 0.5) * 0.8;
  lp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * lp;
  float leaf = length(lp * vec2(2.2, 1.35)) + 0.25 * max(0.0, -lp.y * 1.35) - 0.42 * (0.75 + 0.45 * k);
  float twig = abs(tf) < 0.02 ? 1.0 : 0.0;
  if ((leaf > 0.0 || k < 0.22) && twig < 0.5) discard;
  vec3 green = vec3(0.32, 0.42, 0.1), gold = vec3(0.78, 0.6, 0.12), brown = vec3(0.45, 0.28, 0.1);
  float g = h21(vec2(ri, ti + seed));
  col = mix(green, gold, smoothstep(0.2, 0.8, g * 0.7 + vData.x * 0.5));
  col = mix(col, brown, step(0.9, g) * 0.8);
  col *= 0.85 + 0.25 * k2;
  col = mix(col, vec3(0.1, 0.08, 0.06), twig);
  thin = 1.0 - twig;
  #endif
  vec3 N = normalize(vNormal);
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
