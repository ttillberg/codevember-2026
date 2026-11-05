// Faceted boulder: icosphere clipped against random planes, roughened with noise.
// Returns indexed geometry (shared verts) plus adjacency for moss growth.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { fbm3, mulberry32 } from './noise';

export interface Surface {
  geometry: THREE.BufferGeometry;
  adjacency: Uint32Array[]; // per vertex: neighbour indices
  fertility: Float32Array; // 0..1, how willing moss is to spread here
  dead: Float32Array; // 0..1, bleached yellow-brown patches
  pillow: Float32Array; // 0..1, where the moss mounds up
}

// Mound field, shared by rock vertices and frond instances so both layers bulge together.
export function pillowAt(x: number, y: number, z: number) {
  const v = fbm3(x * 9, y * 9, z * 9, 2, 5) * 0.65 + fbm3(x * 22, y * 22, z * 22, 2, 6) * 0.35;
  return THREE.MathUtils.smoothstep(v, -0.35, 0.35);
}

// Shared by rock vertices and frond instances so both layers agree on where the moss is dying.
export function deadAt(x: number, y: number, z: number) {
  const v = fbm3(x * 3.2, y * 3.2, z * 3.2, 3, 42) + 0.35 * fbm3(x * 11, y * 11, z * 11, 2, 43);
  return THREE.MathUtils.smoothstep(v, 0.12, 0.5);
}

// Loop / midpoint subdivision of an indexed triangle mesh. `smooth` applies Loop weights,
// which rounds edges; without it the facets stay planar and only get denser.
export function subdivide(pos: Float32Array, idx: Uint32Array, smooth: boolean) {
  const n = pos.length / 3;
  const key = (i: number, j: number) => (i < j ? i * n + j : j * n + i);
  const edgeOpp = new Map<number, number[]>();
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
      const k = key(a, b);
      if (!edgeOpp.has(k)) edgeOpp.set(k, []);
      edgeOpp.get(k)!.push(c);
      nb[a].add(b); nb[b].add(a);
    }
  }
  const out: number[] = [];
  // old vertices, smoothed by Loop's beta weights
  for (let i = 0; i < n; i++) {
    const k = nb[i].size;
    if (!smooth || k === 0) { out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); continue; }
    const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
    let x = 0, y = 0, z = 0;
    for (const j of nb[i]) { x += pos[j * 3]; y += pos[j * 3 + 1]; z += pos[j * 3 + 2]; }
    const w = 1 - k * beta;
    out.push(pos[i * 3] * w + x * beta, pos[i * 3 + 1] * w + y * beta, pos[i * 3 + 2] * w + z * beta);
  }
  // edge vertices
  const edgeVert = new Map<number, number>();
  for (const [k, opp] of edgeOpp) {
    const a = Math.floor(k / n), b = k % n;
    let x, y, z;
    if (smooth && opp.length === 2) {
      x = 0.375 * (pos[a * 3] + pos[b * 3]) + 0.125 * (pos[opp[0] * 3] + pos[opp[1] * 3]);
      y = 0.375 * (pos[a * 3 + 1] + pos[b * 3 + 1]) + 0.125 * (pos[opp[0] * 3 + 1] + pos[opp[1] * 3 + 1]);
      z = 0.375 * (pos[a * 3 + 2] + pos[b * 3 + 2]) + 0.125 * (pos[opp[0] * 3 + 2] + pos[opp[1] * 3 + 2]);
    } else {
      x = 0.5 * (pos[a * 3] + pos[b * 3]);
      y = 0.5 * (pos[a * 3 + 1] + pos[b * 3 + 1]);
      z = 0.5 * (pos[a * 3 + 2] + pos[b * 3 + 2]);
    }
    edgeVert.set(k, out.length / 3);
    out.push(x, y, z);
  }
  const newIdx: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ab = edgeVert.get(key(a, b))!, bc = edgeVert.get(key(b, c))!, ca = edgeVert.get(key(c, a))!;
    newIdx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return { pos: Float32Array.from(out), idx: Uint32Array.from(newIdx) };
}

export function buildRock(seed = 7, linearLevels = 3, smoothLevels = 2): Surface {
  const rand = mulberry32(seed);

  // A random low-poly boulder: convex hull of a handful of points on a squashed sphere,
  // plus a ring on the bottom plane so it sits flat.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 26; i++) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    v.multiplyScalar(0.88 + 0.17 * rand());
    v.x *= 1.25; v.y *= 0.9; v.z *= 1.05;
    if (v.y < -0.62) v.y = -0.62;
    points.push(v);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * (0.55 + 0.15 * rand()), -0.62, Math.sin(a) * (0.45 + 0.15 * rand())));
  }
  let hull: THREE.BufferGeometry = new ConvexGeometry(points);
  hull.deleteAttribute('normal');
  hull.deleteAttribute('uv');
  hull = mergeVertices(hull);

  let sub = {
    pos: new Float32Array((hull.attributes.position as THREE.BufferAttribute).array as Float32Array),
    idx: Uint32Array.from(hull.index!.array),
  };
  for (let i = 0; i < linearLevels; i++) sub = subdivide(sub.pos, sub.idx, false);
  for (let i = 0; i < smoothLevels; i++) sub = subdivide(sub.pos, sub.idx, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(sub.pos, 3));
  geo.setIndex(new THREE.BufferAttribute(sub.idx, 1));
  // No surface noise: the stone is plain, the facets and rounded edges are the whole look.
  return finishSurface(geo, seed);
}

/** Turn any indexed geometry (positions + index) into a paintable surface: normals, adjacency and the per-vertex fields. */
export function finishSurface(geo: THREE.BufferGeometry, seed = 7): Surface {
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const norAttr = geo.attributes.normal as THREE.BufferAttribute;
  const n = posAttr.count;
  const p = new THREE.Vector3();

  // Adjacency from the index buffer.
  const index = geo.index!.array;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const adjacency = sets.map((s) => Uint32Array.from(s));

  // Fertility: moss likes the upper side, and patches of the surface are just inhospitable.
  const fertility = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(posAttr, i);
    const up = THREE.MathUtils.smoothstep(norAttr.getY(i), -0.35, 0.7);
    const patch = fbm3(p.x * 2.2, p.y * 2.2, p.z * 2.2, 3, seed + 20) * 0.5 + 0.5;
    fertility[i] = THREE.MathUtils.clamp((0.15 + 0.85 * up) * (0.4 + 0.9 * patch), 0, 1);
  }

  const dead = new Float32Array(n);
  const pillow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(posAttr, i);
    dead[i] = deadAt(p.x, p.y, p.z);
    pillow[i] = pillowAt(p.x, p.y, p.z);
  }

  // a smoothed normal field for the moss to grow along. The rock keeps its crisp facets, but shells and fronds
  // extrude along normals that turn gradually across an edge, so the layers never fan apart into streaks.
  let mn = new Float32Array((norAttr.array as Float32Array).subarray(0, n * 3));
  let next = new Float32Array(n * 3);
  for (let it = 0; it < 10; it++) {
    for (let i = 0; i < n; i++) {
      let x = mn[i * 3], y = mn[i * 3 + 1], z = mn[i * 3 + 2];
      for (const j of adjacency[i]) { x += mn[j * 3]; y += mn[j * 3 + 1]; z += mn[j * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      next[i * 3] = x / l; next[i * 3 + 1] = y / l; next[i * 3 + 2] = z / l;
    }
    [mn, next] = [next, mn];
  }
  geo.setAttribute('mossNormal', new THREE.BufferAttribute(mn, 3));

  return { geometry: geo, adjacency, fertility, dead, pillow };
}
