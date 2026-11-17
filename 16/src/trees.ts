// Spruce trunks, columns rising out of the moss into the haze. One per cell of a coarse grid, by hash.
// Three levels of detail, each an instanced mesh sharing one material: near trunks have their root flare in
// fine geometry, mid ones a coarser version, far ones are octagonal columns. Trunks are sorted into the
// levels as you move. The bark is a shader: long plates and deep wandering furrows, flaking in layers, bump-mapped
// by finite differences, algae and crust lichen, and moss climbing the foot.
import * as THREE from 'three';
import { mulberry32 } from './noise';
import { mossLighting } from './shaders';
import { groundHeight } from './world';

export const TREE_CELL = 3.6;
const RANGE = 34; // trunks are placed this far out
const LOD_DIST = [4.5, 12]; // fine up to here, mid up to the next, far beyond
const HEIGHT = 30;
const MAX = 600;

export interface Trunk { x: number; z: number; r: number; turn: number; key: string }

export function trunkInCell(ix: number, iz: number): Trunk | null {
  const r = mulberry32((Math.imul(ix, 0x5bd1e995) ^ Math.imul(iz, 0x1b873593) ^ 0x7ee5) >>> 0);
  if (r() > 0.45) return null;
  const x = (ix + 0.15 + 0.7 * r()) * TREE_CELL, z = (iz + 0.15 + 0.7 * r()) * TREE_CELL;
  return { x, z, r: 0.3 + 0.32 * r(), turn: r() * Math.PI * 2, key: `${ix},${iz}` };
}

/**
 * A unit trunk (radius 1 at breast height, HEIGHT tall) with its root flare: buttresses spreading out low down
 * and sinking into the ground. Rings are packed towards the foot, where the detail is.
 */
function trunkGeometry(radial: number, rings: number) {
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const buttress = (a: number) => Math.pow(Math.abs(Math.sin(a * 2.5 + 0.7)), 3) * 0.7 + Math.pow(Math.abs(Math.sin(a * 1.5 + 2.1)), 4) * 0.5;
  const radius = (a: number, y: number) => {
    const flare = Math.exp(-Math.max(y, 0) / 0.28) * (0.15 + 0.7 * buttress(a)) + Math.exp(-Math.max(y, 0) / 2.5) * 0.1;
    const taper = 1 - 0.65 * (y / HEIGHT);
    return taper * (1 + flare);
  };
  const ys: number[] = [];
  for (let j = 0; j <= rings; j++) ys.push(-0.25 + (HEIGHT + 0.25) * Math.pow(j / rings, 2.6));
  for (let j = 0; j <= rings; j++) {
    const y = ys[j];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const r = radius(a, y);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      // normal from the radius' change around and up
      const e = 0.01;
      const dra = (radius(a + e, y) - radius(a - e, y)) / (2 * e);
      const dry = (radius(a, y + e) - radius(a, y - e)) / (2 * e);
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
  private levels: THREE.InstancedMesh[];
  private cellKey = '';
  private lastSort = new THREE.Vector2(Infinity, Infinity);

  constructor(setup: (m: THREE.ShaderMaterial) => void) {
    const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader, side: THREE.DoubleSide, uniforms: {} });
    setup(mat);
    this.levels = [trunkGeometry(48, 40), trunkGeometry(16, 14), trunkGeometry(8, 3)].map((g) => {
      const m = new THREE.InstancedMesh(g, mat, MAX);
      m.count = 0;
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    });
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
    const counts = [0, 0, 0];
    for (const t of this.trunks) {
      const d = Math.hypot(t.x - px, t.z - pz) - t.r;
      const lod = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      const lvl = this.levels[lod];
      if (counts[lod] >= MAX) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.turn);
      s.set(t.r, 1, t.r);
      p.set(t.x, groundHeight(t.x, t.z) - 0.03, t.z);
      lvl.setMatrixAt(counts[lod]++, m.compose(p, q, s));
    }
    this.levels.forEach((l, i) => { l.count = counts[i]; l.instanceMatrix.needsUpdate = true; });
    this.changed = true;
  }

  /** Is the point inside a trunk? For the autofocus. */
  hit(x: number, y: number, z: number) {
    for (const t of this.trunks) if (Math.hypot(x - t.x, z - t.z) < t.r * (y < 0.4 ? 1.6 : 1.0)) return true;
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
  float r = length(instanceMatrix[0].xyz);
  #else
  float r = 1.0;
  #endif
  vec4 wp = modelMatrix * lp;
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * ln);
  vBark = vec2(uv.x * 6.2831853 * r, uv.y);
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
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// Pine-like bark: long plates running up the trunk, split by deep wandering furrows that join and part, with
// fewer cracks across; each plate flaking off in layers, grey on top, red-brown where a flake has come away.
// A cell noise stretched up the trunk, with a whole number of cells around so it wraps without a seam, and
// its coordinates warped by sines of the angle (which wrap too) so the furrows wander.
float AROUND; // cells around this trunk
const float PER_Y = 6.5; // cells per unit up
vec4 barkV(vec2 b) {
  float ang = b.x / (6.2831853 * vR); // 0..1 around
  vec2 p = vec2(ang * AROUND, b.y * PER_Y);
  float a = ang * 6.2831853;
  p.x += 0.45 * sin(a * 3.0 + b.y * 1.3) + 0.3 * sin(a * 7.0 - b.y * 2.9) + 0.18 * sin(a * 13.0 + b.y * 5.3);
  p.y += 0.25 * sin(a * 5.0 + b.y * 0.7);
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0;
  vec2 id = vec2(0.0), q1 = vec2(0.0), q2 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = i + o;
    c.x = mod(c.x, AROUND);
    vec2 pt = o + vec2(h21(c), h21(c + 17.3)) * vec2(0.8, 0.9) + vec2(0.1, 0.05);
    vec2 d = (pt - f) * vec2(1.0, 0.55); // distance counted short up the trunk: plates come out long
    float l = length(d);
    if (l < f1) { f2 = f1; q2 = q1; f1 = l; q1 = pt; id = c; } else if (l < f2) { f2 = l; q2 = pt; }
  }
  float edge = f2 - f1;
  // the furrow: a deep narrow V, its floor broken
  // ragged: the edge eaten into at two scales, so a furrow's walls are broken, not drawn
  float rag = (n21(p * vec2(5.0, 2.5)) - 0.5) * 0.12 + (n21(p * vec2(14.0, 7.0)) - 0.5) * 0.06;
  // an edge between cells side by side runs up the trunk: a deep, wide furrow; one between cells one over
  // the other runs across: a narrow shallow crack, so the plates read as long strips and not a net
  vec2 dq = (q2 - q1) * vec2(1.0, 0.55);
  float upright = smoothstep(0.35, 0.8, abs(dq.x) / (length(dq) + 1e-4));
  float furrow = smoothstep(0.02, mix(0.1, 0.32, upright), edge + rag);
  furrow = sqrt(furrow); // steep walls, a rounded shoulder
  furrow = mix(1.0 - 0.45 * (1.0 - furrow), furrow, upright);
  // the plate: flat-topped, flaking in two or three layers, the steps wandering across it
  float fl = n21(p * vec2(2.6, 1.3) + id * 7.31) * 0.75 + n21(p * vec2(6.0, 3.0) + id * 3.7) * 0.25;
  float t = fl * 2.6;
  float layers = (floor(t) + smoothstep(0.35, 0.55, fract(t))) / 2.6;
  // the plate's own surface: rough, with fine cracks across it where the outer scales split
  float rough = n21(p * vec2(16.0, 9.0)) * 0.6 + n21(p * vec2(37.0, 21.0)) * 0.4;
  float scaleCrack = smoothstep(0.06, 0.0, abs(fract(p.y * 3.0 + 0.6 * n21(p * vec2(4.0, 1.0) + id)) - 0.5) - 0.44) * smoothstep(0.55, 0.75, n21(p * 2.0 + id)) * n21(p * vec2(9.0, 3.0));
  float h = furrow * (0.6 + 0.3 * layers + 0.12 * rough - 0.06 * scaleCrack);
  return vec4(h, furrow, layers, h21(id + 3.1));
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  AROUND = max(6.0, floor(6.2831853 * vR * 17.0 + 0.5));
  vec4 bv = barkV(vBark);
  float h = bv.x;
  // far away the cells are smaller than a pixel: ease the relief and the contrast out instead of shimmering
  float px = length(fwidth(vBark)) * PER_Y * 1.6;
  float near = 1.0 - smoothstep(0.25, 0.9, px);
  // the normal from the height's slope along the bark, around and up (finite differences, so it is the same
  // up close as far away), tilted by a furrow a few centimetres deep
  if (near > 0.01) {
    float e = 0.004;
    float hx = barkV(vBark + vec2(e, 0.0)).x, hy = barkV(vBark + vec2(0.0, e)).x;
    vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-5), B = cross(T, N);
    N = normalize(N - (T * (hx - h) + B * (hy - h)) / e * 0.022 * near);
  }

  float furrow = bv.y, layers = bv.z, cell = bv.w;
  // grey weathered tops, red-brown where flakes came away, near black down the furrows
  vec3 top = mix(vec3(0.12, 0.105, 0.09), vec3(0.155, 0.14, 0.125), cell);
  vec3 under = mix(vec3(0.135, 0.085, 0.06), vec3(0.17, 0.10, 0.07), cell);
  vec3 col = mix(under, top, 0.25 + 0.75 * smoothstep(0.2, 0.9, layers));
  col *= 0.85 + 0.3 * n21(vBark * vec2(40.0, 14.0));
  col = mix(vec3(0.016, 0.012, 0.009), col, mix(0.6, 1.0, near) * furrow + (1.0 - near) * 0.5 * (1.0 - furrow));
  col = mix(vec3(0.13, 0.105, 0.085), col, mix(0.5, 1.0, near)); // far: the average
  // green algae on the shaded side, crust lichen in pale patches on the plates
  float side = 0.5 + 0.5 * dot(normalize(vec3(N.x, 0.0, N.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  col = mix(col, vec3(0.10, 0.13, 0.06), smoothstep(0.45, 0.75, n21(vBark * vec2(1.2, 0.5) + 3.0) * side + 0.15 * side) * 0.6 * furrow);
  col = mix(col, vec3(0.32, 0.34, 0.27), smoothstep(0.66, 0.72, n21(vBark * vec2(2.2, 1.4) + 7.0)) * h * 0.7);
  // moss climbing the foot, higher on the shaded side, into the furrows first
  float mossLine = 0.08 + 0.5 * side + 0.25 * n21(vBark * vec2(1.5, 2.0));
  float moss = (1.0 - smoothstep(mossLine - 0.15, mossLine, vBark.y)) * (0.5 + 0.5 * (1.0 - h)) * smoothstep(0.3, 0.6, n21(vBark * 6.0) + 0.3 * (1.0 - h));
  col = mix(col, mix(vec3(0.012, 0.035, 0.008), vec3(0.03, 0.07, 0.012), n21(vBark * 9.0)), moss);

  float shadow = shadowAt(vWorldPos, N);
  float diff = max(dot(N, L), 0.0);
  vec3 c = col * (0.4 * skyTint(N, 1.0) + 2.0 * diff * shadow);
  // the low sun behind a trunk lights its edge
  c += col * pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, L), 0.0) * 3.0;
  c *= mix(0.45, 1.0, smoothstep(-0.2, 0.25, vBark.y)); // dark where it goes into the moss
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
