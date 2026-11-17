// Spruce trunks, columns rising out of the moss into the haze. One per cell of a coarse grid, by hash.
// Three levels of detail, each an instanced mesh sharing one material: near trunks have their root flare in
// fine geometry, mid ones a coarser version, far ones are octagonal columns. Trunks are sorted into the
// levels as you move. The bark is a shader: long plates and deep wandering furrows, flaking in layers, bump-mapped
// by finite differences, algae and crust lichen; up close fibres and papery scales on the plates, and a
// cushion of moss round the foot, swelling the outline, its shoots fuzzy and lime at the tips.
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
    // the root flare, about its average: the full buttress was too wide, and standing by a trunk the focus fell
    // in the air in front of it
    for (const t of this.trunks) {
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

// shared by both stages: noise, and where the moss on the foot reaches (higher on the shaded side, a ragged line)
const common = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// 0 bare .. 1 deep in the moss: a skirt all round the foot, climbing the shaded side, its top edge ragged
float mossCover(vec2 b, float side) {
  float line = 0.18 + 0.25 * side * side + 0.12 * n21(b * vec2(1.6, 1.0)) + 0.07 * n21(b * vec2(7.0, 3.0)) + 0.04 * n21(b * vec2(26.0, 11.0));
  return 1.0 - smoothstep(line - 0.08, line, b.y);
}
`;

const vertexShader = /* glsl */ `
uniform vec3 uLightDir;
${common}
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
  vNormal = normalize(mat3(modelMatrix) * ln);
  vBark = vec2(uv.x * 6.2831853 * r, uv.y);
  // the moss on the foot is a cushion a couple of centimetres thick, swelling in clumps: the outline bulges
  vec3 L = normalize(uLightDir);
  float side = 0.5 + 0.5 * dot(normalize(vec3(vNormal.x, 0.0, vNormal.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  float cover = mossCover(vBark, side);
  wp.xyz += vNormal * cover * (0.012 + 0.016 * n21(vBark * vec2(14.0, 10.0)));
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
// moss strands: a fine fuzz of little shoots, bright where their tips catch the light
float fuzz(vec2 b) { return n21(b * vec2(90.0, 70.0)) * 0.5 + n21(b * vec2(260.0, 200.0)) * 0.5; }
// the shoots' tips: a scatter of small points, one per cell at most, glinting like the moss on the ground
float tips(vec2 b) {
  float t = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 q = b * (k == 0 ? vec2(150.0, 120.0) : vec2(320.0, 260.0)) + float(k) * 7.7;
    vec2 i = floor(q), f = fract(q);
    vec2 pt = 0.25 + 0.5 * vec2(h21(i), h21(i + 5.1));
    float on = step(0.45, h21(i + 9.3));
    t = max(t, on * smoothstep(0.32, 0.0, length((f - pt) * vec2(1.0, 0.7))) * (0.6 + 0.4 * h21(i + 2.2)));
  }
  return t;
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
  // rough enough to break the light up at arm's length, so the plates do not shade smooth like plastic
  float h = furrow * (0.6 + 0.3 * layers + 0.26 * rough - 0.1 * scaleCrack);
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
  vec3 N0 = normalize(vNormal);
  vec3 T0 = normalize(cross(N0, vec3(0.0, 1.0, 0.0)) + 1e-5), B0 = cross(T0, N0);
  float side = 0.5 + 0.5 * dot(normalize(vec3(N0.x, 0.0, N0.z) + 1e-4), normalize(vec3(-L.x, 0.0, -L.z)));
  float cover = mossCover(vBark, side);
  // the moss fills the furrows first and lies over the plates where it is deep
  float moss = smoothstep(0.35, 0.6, cover + 0.6 * (1.0 - h) * smoothstep(0.0, 0.3, cover + 0.15) + 0.25 * (n21(vBark * vec2(11.0, 8.0)) - 0.5));
  // the fine detail only once it is bigger than a pixel or so: the grain, and the moss's fuzz
  float fineFade = 1.0 - smoothstep(0.35, 1.1, length(fwidth(vBark)) * 260.0);
  float g = 0.5, fz = 0.5;
  if (fineFade > 0.01) {
    float e = 0.0012;
    g = grain(vBark);
    float gk = 0.0016 * fineFade * bv.y * (1.0 - moss);
    if (gk > 0.0) N = normalize(N - (T0 * (grain(vBark + vec2(e, 0.0)) - g) + B0 * (grain(vBark + vec2(0.0, e)) - g)) / e * gk);
    if (moss > 0.0) {
      fz = fuzz(vBark);
      vec3 Nm = normalize(N0 - (T0 * (fuzz(vBark + vec2(e, 0.0)) - fz) + B0 * (fuzz(vBark + vec2(0.0, e)) - fz)) / e * 0.0005 * fineFade);
      N = normalize(mix(N, Nm, moss));
    }
  }
  if (moss > 0.0 && fineFade <= 0.01) N = normalize(mix(N, N0, moss));

  float furrow = bv.y, layers = bv.z, cell = bv.w;
  // grey weathered tops, red-brown where flakes came away, near black down the furrows
  vec3 top = mix(vec3(0.12, 0.105, 0.09), vec3(0.155, 0.14, 0.125), cell);
  vec3 under = mix(vec3(0.135, 0.085, 0.06), vec3(0.17, 0.10, 0.07), cell);
  vec3 col = mix(under, top, 0.25 + 0.75 * smoothstep(0.2, 0.9, layers));
  col *= 0.85 + 0.3 * n21(vBark * vec2(40.0, 14.0));
  // the grain: darker between the fibres, the scales' edges catching a little pale
  col *= mix(1.0, 0.55 + 0.9 * g, fineFade * furrow);
  col = mix(col, vec3(0.2, 0.18, 0.16), smoothstep(0.62, 0.8, g) * 0.35 * fineFade * furrow);
  col = mix(vec3(0.016, 0.012, 0.009), col, mix(0.6, 1.0, near) * furrow + (1.0 - near) * 0.5 * (1.0 - furrow));
  col = mix(vec3(0.13, 0.105, 0.085), col, mix(0.5, 1.0, near)); // far: the average
  // green algae on the shaded side, crust lichen in pale patches on the plates
  col = mix(col, vec3(0.10, 0.13, 0.06), smoothstep(0.45, 0.75, n21(vBark * vec2(1.2, 0.5) + 3.0) * side + 0.15 * side) * 0.6 * furrow);
  // lichen in specks, not a smooth wash; and mottling, dark and pale blotches across the plates
  float speck = smoothstep(0.35, 0.75, n21(vBark * vec2(60.0, 45.0) + 3.0));
  col = mix(col, vec3(0.30, 0.31, 0.25), smoothstep(0.62, 0.72, n21(vBark * vec2(2.2, 1.4) + 7.0)) * h * 0.65 * speck);
  col *= 0.75 + 0.5 * n21(vBark * vec2(14.0, 6.0) + 11.0);
  // the moss on the foot: dark down in it, green, the tips of the shoots lime and catching the light; deeper
  // in the cushion it is fuller and brighter, browner and thinner where it peters out up the trunk
  float body = mix(n21(vBark * 9.0), fz, fineFade);
  vec3 mossCol = mix(vec3(0.004, 0.011, 0.003), vec3(0.016, 0.045, 0.007), smoothstep(0.25, 0.85, body));
  if (moss > 0.0 && fineFade > 0.01) mossCol += vec3(0.07, 0.1, 0.022) * tips(vBark) * fineFade;
  else mossCol += vec3(0.01, 0.015, 0.003); // far: the glints on average
  mossCol = mix(mossCol * vec3(1.3, 0.9, 0.7), mossCol, smoothstep(0.2, 0.8, cover));
  col = mix(col, mossCol, moss);

  float shadow = shadowAt(vWorldPos, N);
  // moss lets light through and round: a softer, wrapped diffuse
  float diff = mix(max(dot(N, L), 0.0), max(dot(N, L) + 0.35, 0.0) / 1.35, moss);
  // down a furrow's walls the plates either side shade it: no sun in there, so the walls do not shine
  diff *= mix(smoothstep(0.25, 0.85, furrow), 1.0, max(moss, 1.0 - near));
  vec3 c = col * (0.4 * skyTint(N, 1.0) + 2.0 * diff * shadow);
  // the low sun behind a trunk lights its edge
  // (only off the plates, broken by their roughness: a smooth even rim was what read as plastic)
  c += col * pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, L), 0.0) * 1.4 * furrow * (0.4 + 0.6 * n21(vBark * vec2(30.0, 12.0)));
  c *= mix(0.45, 1.0, smoothstep(-0.2, 0.25, vBark.y)); // dark where it goes into the moss
  gl_FragColor = vec4(tonemap(grade(c)), 1.0);
  #include <colorspace_fragment>
}
`;
