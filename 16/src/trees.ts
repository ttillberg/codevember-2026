// Spruce trunks, columns rising out of the moss into the haze. One per cell of a coarse grid, by hash.
// Three levels of detail, each an instanced mesh sharing one material: near trunks have their root flare in
// fine geometry, mid ones a coarser version, far ones are octagonal columns. Trunks are sorted into the
// levels as you move. The bark is a shader: plates and deep vertical furrows bump-mapped from screen-space
// derivatives, crust lichen, and moss climbing the foot.
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
// bark height: irregular scales (a cell noise, stretched a little up the trunk), the cracks between them
// deeper where the cells' edges run up and down, as the trunk has grown wider
float barkH(vec2 b) {
  vec2 p = vec2(b.x * 17.0, b.y * 11.0);
  p.x += 0.6 * n21(p * 0.35);
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0;
  vec2 d1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 c = o + vec2(h21(i + o), h21(i + o + 17.3)) * 0.85 + 0.075;
    vec2 d = c - f;
    float l = length(d);
    if (l < f1) { f2 = f1; f1 = l; d1 = d; } else if (l < f2) f2 = l;
  }
  float edge = f2 - f1;
  float crack = smoothstep(0.0, 0.3, edge);
  float dome = 1.0 - 0.35 * f1; // each scale a little rounded
  return crack * dome * (0.8 + 0.2 * n21(p * 1.7));
}
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float h = barkH(vBark);
  // bump from screen-space derivatives of the bark height
  vec3 dpdx = dFdx(vWorldPos), dpdy = dFdy(vWorldPos);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  N = normalize(abs(det) * N - grad * 0.02);

  vec3 col = mix(vec3(0.015, 0.011, 0.008), mix(vec3(0.10, 0.075, 0.058), vec3(0.18, 0.15, 0.12), n21(vBark * vec2(3.0, 1.0))), h);
  // crust lichen in pale patches on the plates
  col = mix(col, vec3(0.32, 0.34, 0.27), smoothstep(0.62, 0.7, n21(vBark * vec2(2.2, 1.4) + 7.0)) * h * 0.8);
  // moss climbing the foot, higher on the shaded side, into the furrows first
  float side = 0.5 + 0.5 * dot(normalize(vec3(N.x, 0.0, N.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
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
