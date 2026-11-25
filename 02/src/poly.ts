import { Vec3, add3, cross3, dot3, len3, lerp3, mulberry32, norm3, scale3, sub3 } from './math';

export interface Plane {
  n: Vec3; // outward unit normal
  d: number; // inside satisfies dot(n, p) <= d
}

export interface Face {
  n: Vec3;
  d: number;
  verts: Vec3[]; // CCW when viewed from outside (along -n)
  /** True if this face is an internal Voronoi fracture face rather than an outer surface. */
  internal?: boolean;
  /** True if this face belongs to a smooth curved spherical shell (e.g. Earth globe crust). */
  outer?: boolean;
  /** Normalized crack arrival delay [0..1] for internal crack propagation animation. */
  crackDelay?: number;
}

export interface Poly {
  faces: Face[];
  volume: number;
  centroid: Vec3;
  min: Vec3;
  max: Vec3;
}

const EPS = 1e-5;

/** Create an axis-aligned rectangular glass block centered at the origin. */
export function makeBoxPoly(hx: number, hy: number, hz: number): Poly {
  const faces: Face[] = [
    {
      n: [1, 0, 0], d: hx,
      verts: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    },
    {
      n: [-1, 0, 0], d: hx,
      verts: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]],
    },
    {
      n: [0, 1, 0], d: hy,
      verts: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
    },
    {
      n: [0, -1, 0], d: hy,
      verts: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]],
    },
    {
      n: [0, 0, 1], d: hz,
      verts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
    },
    {
      n: [0, 0, -1], d: hz,
      verts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]],
    },
  ];
  // Fix winding on each face so cross(v1-v0, v2-v0) aligns with n
  for (const f of faces) ensureCCW(f.verts, f.n);
  return finalizePoly(faces);
}

/**
 * Create a smooth strictly-convex geodesic sphere (subdivided icosahedron, 320 faces at subdiv=2)
 * marked with `outer: true` so triangulatePoly / triangulateShards emit silky radial surface normals
 * on the Earth's crust while newly clipped cross-sections stay razor-sharp flat!
 */
export function makeSpherePoly(radius = 0.30, subdivisions = 2): Poly {
  const t = (1 + Math.sqrt(5)) * 0.5;
  const baseVerts: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => norm3(v as Vec3));

  let tris: Array<[Vec3, Vec3, Vec3]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map(([a, b, c]) => [baseVerts[a], baseVerts[b], baseVerts[c]]);

  const mid = (a: Vec3, b: Vec3): Vec3 => norm3([(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]);

  for (let s = 0; s < subdivisions; s++) {
    const next: Array<[Vec3, Vec3, Vec3]> = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }

  const faces: Face[] = tris.map(([a, b, c]) => {
    const va = scale3(a, radius);
    const vb = scale3(b, radius);
    const vc = scale3(c, radius);
    const n = norm3(cross3(sub3(vb, va), sub3(vc, va)));
    const verts: Vec3[] = [va, vb, vc];
    // Guarantee outward normal pointing away from origin
    const outward = dot3(n, va) >= 0 ? n : ([-n[0], -n[1], -n[2]] as Vec3);
    ensureCCW(verts, outward);
    return {
      n: outward,
      d: dot3(outward, va),
      verts,
      outer: true,
    };
  });

  return finalizePoly(faces);
}

/** Create the initial sculptural glass block (used for guided Shape/Letter carving). */
export function makeInitialBlock(size = 0.56): Poly {
  const hx = size * 0.5;
  const hy = size * 0.54; // slightly taller cubic proportion, sculptural like the reference
  const hz = size * 0.5;
  return makeBoxPoly(hx, hy, hz);
}

/**
 * Create a faceted optical crystal polyhedron (14-20 crisp convex faces) so clear,
 * uncolored crystal catches dramatic studio negative-fill edges & prismatic diamond fire!
 */
export function makeCrystalPoly(size = 0.56, variant = 0): Poly {
  const s = size * 0.5;
  const v = ((variant % 4) + 4) % 4;
  let poly: Poly = makeBoxPoly(s * 1.15, s * 1.38, s * 1.15);

  const cut = (n: Vec3, d: number) => {
    const next = clipPoly(poly, norm3(n), d);
    if (next && next.volume > 1e-4) poly = next;
  };

  if (v === 0) {
    // 1. Hexagonal terminated quartz crystal (6 prism sides + 6 crown tip facets + tapered base)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.18;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      cut([ca, 0, sa], s * 0.72);
      // Pointed crystal crown facets
      cut([ca * 0.78, 0.62, sa * 0.78], s * 0.88);
      // Tapered crystal bottom facets
      cut([ca * 0.74, -0.67, sa * 0.74], s * 0.86);
    }
    cut([0, 1, 0], s * 1.24);
    cut([0, -1, 0], s * 1.18);
  } else if (v === 1) {
    // 2. Emerald-cut / octagonal diamond gem (8 crown facets + 8 deep pavilion facets + flat table)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      cut([ca, 0, sa], s * 0.92);
      cut([ca * 0.68, 0.73, sa * 0.68], s * 0.80);
      cut([ca * 0.80, -0.60, sa * 0.80], s * 0.78);
    }
    cut([0, 1, 0], s * 0.64);
    cut([0, -1, 0], s * 0.96);
  } else if (v === 2) {
    // 3. Bold cut crystal octahedron-prism (14 crisp optical bevel facets!)
    poly = makeBoxPoly(s * 0.96, s * 1.04, s * 0.96);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          cut([sx, sy, sz], s * 1.02);
        }
      }
    }
  } else {
    // 4. Beveled architectural prism (tall faceted Baccarat monolith with 45° edge chamfers)
    poly = makeBoxPoly(s * 0.88, s * 1.12, s * 0.88);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        cut([sx, 0, sz], s * 0.92);
      }
    }
    for (const sx of [-1, 1]) {
      cut([sx, 0.78, 0], s * 1.04);
      cut([sx, -0.78, 0], s * 1.04);
    }
    for (const sz of [-1, 1]) {
      cut([0, 0.78, sz], s * 1.04);
      cut([0, -0.78, sz], s * 1.04);
    }
  }

  return poly;
}

function ensureCCW(verts: Vec3[], n: Vec3) {
  if (verts.length < 3) return;
  let nx = 0, ny = 0, nz = 0;
  const p0 = verts[0];
  for (let i = 1; i < verts.length - 1; i++) {
    const e1 = sub3(verts[i], p0);
    const e2 = sub3(verts[i + 1], p0);
    const c = cross3(e1, e2);
    nx += c[0]; ny += c[1]; nz += c[2];
  }
  if (nx * n[0] + ny * n[1] + nz * n[2] < 0) {
    verts.reverse();
  }
}

function dedupePolygon(verts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const v of verts) {
    const prev = out[out.length - 1];
    if (!prev || len3(sub3(v, prev)) > 1e-5) {
      out.push(v);
    }
  }
  if (out.length > 1 && len3(sub3(out[0], out[out.length - 1])) <= 1e-5) {
    out.pop();
  }
  return out;
}

function polygonArea(verts: Vec3[], n: Vec3): number {
  if (verts.length < 3) return 0;
  let nx = 0, ny = 0, nz = 0;
  const p0 = verts[0];
  for (let i = 1; i < verts.length - 1; i++) {
    const c = cross3(sub3(verts[i], p0), sub3(verts[i + 1], p0));
    nx += c[0]; ny += c[1]; nz += c[2];
  }
  return 0.5 * Math.abs(nx * n[0] + ny * n[1] + nz * n[2]);
}

/** Compute volume, volume-weighted centroid, and AABB of a closed convex polyhedron. */
export function finalizePoly(faces: Face[]): Poly {
  let vol6 = 0;
  let cx = 0, cy = 0, cz = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // Use average of all face vertices as reference origin to keep tet math numerically tight
  let rx = 0, ry = 0, rz = 0, count = 0;
  for (const f of faces) {
    for (const v of f.verts) {
      rx += v[0]; ry += v[1]; rz += v[2]; count++;
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (count === 0) {
    return { faces: [], volume: 0, centroid: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0] };
  }
  const ref: Vec3 = [rx / count, ry / count, rz / count];

  for (const f of faces) {
    const vs = f.verts;
    if (vs.length < 3) continue;
    const a = sub3(vs[0], ref);
    for (let i = 1; i < vs.length - 1; i++) {
      const b = sub3(vs[i], ref);
      const c = sub3(vs[i + 1], ref);
      const v6 = dot3(a, cross3(b, c));
      vol6 += v6;
      cx += v6 * (a[0] + b[0] + c[0]) * 0.25;
      cy += v6 * (a[1] + b[1] + c[1]) * 0.25;
      cz += v6 * (a[2] + b[2] + c[2]) * 0.25;
    }
  }

  const volume = Math.max(0, vol6 / 6);
  const centroid: Vec3 = vol6 > 1e-10
    ? [ref[0] + cx / vol6, ref[1] + cy / vol6, ref[2] + cz / vol6]
    : ref;

  return {
    faces,
    volume,
    centroid,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/** Order coplanar intersection points around a plane normal into a clean convex CCW loop. */
function orderCoplanarPoints(pts: Vec3[], n: Vec3): Vec3[] {
  // Deduplicate first
  const uniq: Vec3[] = [];
  for (const p of pts) {
    let dup = false;
    for (const q of uniq) {
      if (len3(sub3(p, q)) < 1e-4) { dup = true; break; }
    }
    if (!dup) uniq.push(p);
  }
  if (uniq.length < 3) return [];

  // Centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of uniq) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const c: Vec3 = [cx / uniq.length, cy / uniq.length, cz / uniq.length];

  // Orthonormal tangent basis (u, v) on the plane
  const ref: Vec3 = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(cross3(n, ref));
  const v = cross3(n, u);

  const angled = uniq.map((p) => {
    const r = sub3(p, c);
    return { p, a: Math.atan2(dot3(r, v), dot3(r, u)) };
  });
  angled.sort((a, b) => a.a - b.a);
  const ordered = angled.map((x) => x.p);
  ensureCCW(ordered, n);
  return ordered;
}

/**
 * Clip a convex polyhedron against the half-space dot(n, p) <= d.
 * Returns null if the result is empty.
 */
export function clipPoly(poly: Poly, n: Vec3, d: number, markCapInternal = false): Poly | null {
  const keptFaces: Face[] = [];
  const capPts: Vec3[] = [];
  let anyInside = false;
  let anyOutside = false;

  for (const f of poly.faces) {
    const vs = f.verts;
    const dists = vs.map((v) => dot3(n, v) - d);
    for (const dd of dists) {
      if (dd <= EPS) anyInside = true;
      if (dd > EPS) anyOutside = true;
    }

    const out: Vec3[] = [];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const da = dists[i];
      const db = dists[(i + 1) % vs.length];
      const inA = da <= EPS;
      const inB = db <= EPS;

      if (inA) out.push(a);
      if (Math.abs(da) <= EPS) capPts.push(a);

      if (inA !== inB) {
        const t = da / (da - db);
        const p = lerp3(a, b, Math.max(0, Math.min(1, t)));
        out.push(p);
        capPts.push(p);
      }
    }

    const clean = dedupePolygon(out);
    if (clean.length >= 3 && polygonArea(clean, f.n) > 1e-8) {
      keptFaces.push({ ...f, verts: clean });
    }
  }

  if (!anyInside || keptFaces.length === 0) return null;
  if (!anyOutside) return poly;

  if (capPts.length >= 3) {
    const cap = orderCoplanarPoints(capPts, n);
    if (cap.length >= 3 && polygonArea(cap, n) > 1e-8) {
      keptFaces.push({ n: [...n] as Vec3, d, verts: cap, internal: markCapInternal });
    }
  }

  if (keptFaces.length < 4) return null;
  const res = finalizePoly(keptFaces);
  return res.volume > 1e-8 ? res : null;
}

export interface SplitResult {
  /** Half-space dot(n, p) <= d */
  neg: Poly | null;
  /** Half-space dot(n, p) >= d */
  pos: Poly | null;
  /** Exact cross-section polygon on the cutting plane (ordered CCW around n). */
  section: Vec3[];
}

/** Split a convex polyhedron by plane dot(n, p) = d into both halves plus the exact cross-section loop. */
export function splitPoly(poly: Poly, n: Vec3, d: number): SplitResult {
  const neg = clipPoly(poly, n, d, false);
  const pos = clipPoly(poly, [-n[0], -n[1], -n[2]], -d, false);
  const section = intersectPolyPlane(poly, n, d);
  return { neg, pos, section };
}

/** Return the exact CCW intersection polygon where plane dot(n, p) = d slices `poly` (empty if no cut). */
export function intersectPolyPlane(poly: Poly, n: Vec3, d: number): Vec3[] {
  const pts: Vec3[] = [];
  let hasNeg = false;
  let hasPos = false;

  for (const f of poly.faces) {
    const vs = f.verts;
    const dists = vs.map((v) => dot3(n, v) - d);
    for (const dd of dists) {
      if (dd < -EPS) hasNeg = true;
      if (dd > EPS) hasPos = true;
    }
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const da = dists[i];
      const db = dists[(i + 1) % vs.length];
      if (Math.abs(da) <= EPS) pts.push(a);
      else if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        pts.push(lerp3(a, b, t));
      }
    }
  }
  if (!hasNeg || !hasPos) return [];
  return orderCoplanarPoints(pts, n);
}

/** Extract half-space planes (for exact GPU ray-convex-polyhedron refraction). Max 64 planes. */
export function polyPlanes(poly: Poly): Plane[] {
  return poly.faces.slice(0, 64).map((f) => ({ n: f.n, d: f.d }));
}

/** Extract unique vertices of a convex polyhedron (for Rapier convex hull collider). */
export function polyUniqueVerts(poly: Poly): Vec3[] {
  const out: Vec3[] = [];
  for (const f of poly.faces) {
    for (const v of f.verts) {
      let dup = false;
      for (const u of out) {
        if (len3(sub3(v, u)) < 1e-4) { dup = true; break; }
      }
      if (!dup) out.push(v);
    }
  }
  return out;
}

export interface ShatterShard {
  /** Convex polyhedron in ORIGINAL cube local coordinates (so it keeps its exact Sommerso colour!). */
  poly: Poly;
  /** Centroid in original cube local coordinates. */
  centroid: Vec3;
  /** Local vertices relative to `centroid` (for Rapier rigid body & shard mesh). */
  hullVerts: Float32Array;
  volume: number;
  /** Optional pre-split child shards that replace this shard if it strikes the floor hard! */
  children?: ShatterShard[];
}

export interface CrackFace {
  verts: Vec3[];
  n: Vec3;
  delay: number; // [0..1] propagation order from the cut seam
}

export interface SurfaceCrackSeg {
  a: Vec3;
  b: Vec3;
  faceN: Vec3;
  /** Width tapering from root to tip (metres) */
  wa: number;
  wb: number;
  /** Arrival times in seconds from cut (0..~0.28s) */
  ta: number;
  tb: number;
  /** Random slant tilt for realistic TIR glint variation */
  slant: number;
  /** 0 = hairline ring, 1 = bold primary radial / crushed stress zone */
  boldness: number;
}

export interface ShatterResult {
  shards: ShatterShard[];
  crackFaces: CrackFace[];
  surfaceCracks: SurfaceCrackSeg[];
}

/** Point-in-convex-polyhedron test. */
export function isInsidePoly(poly: Poly, p: Vec3, margin = 0): boolean {
  for (const f of poly.faces) {
    if (dot3(f.n, p) - f.d > -margin) return false;
  }
  return true;
}

/**
 * 3D Voronoi shatter of a severed convex glass piece (`cutPoly`).
 * Seeds are biased denser near the cleave plane for realistic splinters along the cut
 * and chunkier shards toward the outer face.
 * Every resulting shard is a guaranteed watertight convex polyhedron, and every
 * internal bisector face becomes a crisp 3D WebGPU crack surface.
 */
export function shatterPoly(
  cutPoly: Poly,
  cutNormal: Vec3,
  cutD: number,
  targetCount: number,
  rng: () => number,
): ShatterResult {
  const [minX, minY, minZ] = cutPoly.min;
  const [maxX, maxY, maxZ] = cutPoly.max;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;

  // Estimate thickness along cutNormal from cut plane
  let maxDepth = 0.01;
  for (const f of cutPoly.faces) {
    for (const v of f.verts) {
      const dist = Math.abs(dot3(cutNormal, v) - cutD);
      if (dist > maxDepth) maxDepth = dist;
    }
  }

  // Generate Voronoi sites strictly inside cutPoly
  const sites: Vec3[] = [];
  const count = Math.max(12, Math.min(140, targetCount));
  let attempts = 0;
  while (sites.length < count && attempts < count * 45) {
    attempts++;
    const p: Vec3 = [
      minX + rng() * dx,
      minY + rng() * dy,
      minZ + rng() * dz,
    ];
    if (!isInsidePoly(cutPoly, p, 0.0015)) continue;

    // Bias denser near the cleave face so fine crystal splinters form along the cut
    const distFromCut = Math.abs(dot3(cutNormal, p) - cutD) / maxDepth;
    if (rng() > 0.30 + 0.70 * Math.pow(1 - distFromCut, 0.75)) continue;

    // Avoid nearly identical sites
    let tooClose = false;
    const minSep = Math.pow(cutPoly.volume / count, 1 / 3) * 0.28;
    for (const s of sites) {
      if (len3(sub3(p, s)) < minSep) { tooClose = true; break; }
    }
    if (tooClose) continue;
    sites.push(p);
  }

  if (sites.length < 3) {
    sites.push(cutPoly.centroid);
    sites.push(add3(cutPoly.centroid, scale3(cutNormal, maxDepth * 0.15)));
  }

  // Pick a crack origin near the center of the cut face for dramatic radial crack propagation
  const crackOrigin: Vec3 = sub3(
    cutPoly.centroid,
    scale3(cutNormal, dot3(cutNormal, cutPoly.centroid) - cutD),
  );
  let maxOriginDist = 0.01;
  for (const f of cutPoly.faces) {
    for (const v of f.verts) {
      const d = len3(sub3(v, crackOrigin));
      if (d > maxOriginDist) maxOriginDist = d;
    }
  }

  const shards: ShatterShard[] = [];
  const crackFaces: CrackFace[] = [];

  for (let i = 0; i < sites.length; i++) {
    const si = sites[i];
    // Sort other sites by distance to si; clipping against nearest 34 neighbors gives exact 3D Voronoi cells fast
    const order = sites
      .map((sj, j) => ({ j, sj, dist2: dot3(sub3(sj, si), sub3(sj, si)) }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.dist2 - b.dist2);

    const maxNeighbors = Math.min(order.length, 34);
    let cell: Poly | null = cutPoly;
    for (let ni = 0; ni < maxNeighbors; ni++) {
      const { sj } = order[ni];
      if (!cell) break;
      const diff = sub3(sj, si);
      const l = len3(diff);
      if (l < 1e-6) continue;
      const n: Vec3 = [diff[0] / l, diff[1] / l, diff[2] / l];
      const mid = scale3(add3(si, sj), 0.5);
      const d = dot3(n, mid);

      // Quick AABB reject: if max corner along n is already <= d, skip
      const maxCorner =
        (n[0] > 0 ? cell.max[0] : cell.min[0]) * n[0] +
        (n[1] > 0 ? cell.max[1] : cell.min[1]) * n[1] +
        (n[2] > 0 ? cell.max[2] : cell.min[2]) * n[2];
      if (maxCorner <= d + EPS) continue;

      cell = clipPoly(cell, n, d, true);
    }

    if (!cell || cell.volume < 1e-7) continue;

    // Collect internal Voronoi fracture faces (keep only one side per shared pair)
    // Tag delay strictly by distance from the cutting plane so the internal shatter wave
    // sweeps cleanly in sync with the exterior fracture seams!
    for (const f of cell.faces) {
      if (!f.internal) continue;
      const key = f.n[0] * 1.0 + f.n[1] * 1.371 + f.n[2] * 1.913;
      if (key < 0) continue;
      let fx = 0, fy = 0, fz = 0;
      for (const v of f.verts) { fx += v[0]; fy += v[1]; fz += v[2]; }
      const fc: Vec3 = [fx / f.verts.length, fy / f.verts.length, fz / f.verts.length];
      const cutDist = Math.max(0, Math.abs(dot3(cutNormal, fc) - cutD)) / maxDepth;
      const delay = Math.max(0, Math.min(0.95, cutDist * 0.85 + rng() * 0.12));
      crackFaces.push({ verts: f.verts, n: f.n, delay });
    }

    const uniq = polyUniqueVerts(cell);
    const hullVerts = new Float32Array(uniq.length * 3);
    const c = cell.centroid;
    for (let k = 0; k < uniq.length; k++) {
      hullVerts[k * 3] = uniq[k][0] - c[0];
      hullVerts[k * 3 + 1] = uniq[k][1] - c[1];
      hullVerts[k * 3 + 2] = uniq[k][2] - c[2];
    }

    shards.push({
      poly: cell,
      centroid: c,
      hullVerts,
      volume: cell.volume,
    });
  }

  // Secondary fracture preparation: pre-split ~half of the shards into 4–7 smaller convex children
  // so landing on the studio floor produces dramatic secondary bursts of crystal glass!
  const byVol = shards
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => b.s.volume - a.s.volume);
  const maxBreakable = Math.min(44, Math.floor(shards.length * 0.58));
  let brokenPrep = 0;
  for (const { s } of byVol) {
    if (brokenPrep >= maxBreakable) break;
    if (s.volume < 0.00008) break;
    if (rng() > 0.85) continue;
    const subCount = 4 + Math.floor(rng() * 4); // 4..7 children
    const kids = splitShardIntoChildren(s.poly, subCount, rng);
    if (kids.length >= 2) {
      s.children = kids;
      brokenPrep++;
    }
  }

  const surfaceCracks = generateSurfaceCracks(cutPoly, shards, cutNormal, cutD, maxDepth, rng);
  return { shards, crackFaces, surfaceCracks };
}

/** Fast mini-Voronoi split of a single convex shard into 3–5 watertight child shards for floor-impact breaking. */
function splitShardIntoChildren(poly: Poly, count: number, rng: () => number): ShatterShard[] {
  const [minX, minY, minZ] = poly.min;
  const [maxX, maxY, maxZ] = poly.max;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;

  const sites: Vec3[] = [];
  let attempts = 0;
  while (sites.length < count && attempts < count * 25) {
    attempts++;
    const p: Vec3 = [minX + rng() * dx, minY + rng() * dy, minZ + rng() * dz];
    if (!isInsidePoly(poly, p, 0.0008)) continue;
    sites.push(p);
  }
  if (sites.length < 2) return [];

  const out: ShatterShard[] = [];
  for (let i = 0; i < sites.length; i++) {
    const si = sites[i];
    let cell: Poly | null = poly;
    for (let j = 0; j < sites.length; j++) {
      if (i === j || !cell) continue;
      const diff = sub3(sites[j], si);
      const l = len3(diff);
      if (l < 1e-6) continue;
      const n: Vec3 = [diff[0] / l, diff[1] / l, diff[2] / l];
      const mid = scale3(add3(si, sites[j]), 0.5);
      cell = clipPoly(cell, n, dot3(n, mid), true);
    }
    if (!cell || cell.volume < 1e-7) continue;
    const uniq = polyUniqueVerts(cell);
    const hullVerts = new Float32Array(uniq.length * 3);
    const c = cell.centroid;
    for (let k = 0; k < uniq.length; k++) {
      hullVerts[k * 3] = uniq[k][0] - c[0];
      hullVerts[k * 3 + 1] = uniq[k][1] - c[1];
      hullVerts[k * 3 + 2] = uniq[k][2] - c[2];
    }
    out.push({ poly: cell, centroid: c, hullVerts, volume: cell.volume });
  }
  return out;
}

/**
 * Extract the EXACT 3D Voronoi shard fracture seams where internal fracture planes meet the
 * outside surfaces of `cutPoly`, plus fine stress micro-whiskers along junctions!
 * - 100% coherent with the rigid shards that explode apart in Stage 2 (no bullet-hole cliché!)
 * - Directional wave progression: seams literally unzip outward away from the cutting plane
 *   in lockstep with the subtle internal 3D fracture planes.
 * - Subdivided with subtle organic glass micro-kinks so every fracture line feels crystalline, not CAD-straight.
 */
function generateSurfaceCracks(
  cutPoly: Poly,
  shards: ShatterShard[],
  cutNormal: Vec3,
  cutD: number,
  maxDepth: number,
  rng: () => number,
): SurfaceCrackSeg[] {
  const allSegs: SurfaceCrackSeg[] = [];
  const seenEdges = new Set<string>();
  const invDepth = 1 / Math.max(0.015, maxDepth);

  // Quantize 3D point for clean shared-edge deduplication
  const ptKey = (p: Vec3) =>
    `${Math.round(p[0] * 2500)},${Math.round(p[1] * 2500)},${Math.round(p[2] * 2500)}`;

  const edgeTime = (p: Vec3, jitter: number): number => {
    // Sweeps outward from the cutting plane (dist = 0 -> t = 0) across the severed chunk (dist = maxDepth -> t ~ 0.28s)
    const dist = Math.max(0, Math.abs(dot3(cutNormal, p) - cutD)) * invDepth;
    // Slight nonlinear ease so the cleave edge snaps instantly and the wave ripples crisply through the body
    return Math.max(0, Math.pow(dist, 0.85) * 0.27 + jitter);
  };

  // Helper: check if midpoint lies on any OTHER outer face plane of cutPoly (meaning it's an original outer cube edge, not a crack)
  const isOriginalOuterEdge = (mid: Vec3, faceN: Vec3): boolean => {
    for (const cf of cutPoly.faces) {
      if (dot3(cf.n, faceN) > 0.98) continue;
      if (Math.abs(dot3(cf.n, mid) - cf.d) < 0.0018) return true;
    }
    return false;
  };

  for (const shard of shards) {
    for (const f of shard.poly.faces) {
      // Only outer surfaces of the severed chunk (f.internal === false)
      if (f.internal) continue;
      const vs = f.verts;
      const m = vs.length;
      if (m < 3) continue;

      // Compute shard outer face centroid for subtle inward micro-whiskers
      let fcx = 0, fcy = 0, fcz = 0;
      for (const v of vs) { fcx += v[0]; fcy += v[1]; fcz += v[2]; }
      const faceCenter: Vec3 = [fcx / m, fcy / m, fcz / m];

      for (let i = 0; i < m; i++) {
        const a = vs[i];
        const b = vs[(i + 1) % m];
        const edgeLen = len3(sub3(b, a));
        if (edgeLen < 0.0025) continue;

        const mid = scale3(add3(a, b), 0.5);
        if (isOriginalOuterEdge(mid, f.n)) continue;

        // Deduplicate shared Voronoi edge between two neighboring shards on the same outer face
        const ka = ptKey(a);
        const kb = ptKey(b);
        const eKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seenEdges.has(eKey)) continue;
        seenEdges.add(eKey);

        // Order endpoints so A is closer to the cutting plane than B (clean directional unzip!)
        const dA = Math.abs(dot3(cutNormal, a) - cutD);
        const dB = Math.abs(dot3(cutNormal, b) - cutD);
        const p0 = dA <= dB ? a : b;
        const p1 = dA <= dB ? b : a;

        const tang = norm3(sub3(p1, p0));
        const perp = norm3(cross3(f.n, tang));
        const slant = (rng() - 0.5) * 1.6;
        const jitter = (rng() - 0.5) * 0.032;

        // Finer razor-sharp crystal seams (bolder right along the cleave edge)
        const nearCut = Math.exp(-Math.min(dA, dB) * invDepth * 1.6);
        const baseW = 0.00095 + nearCut * 0.00070 + rng() * 0.00045;
        const boldness = Math.min(1, 0.50 + nearCut * 0.38 + rng() * 0.22);

        // Subdivide seam into 2–3 micro-kinked segments so it looks like real jagged fractured crystal
        const subDivs = edgeLen > 0.045 ? 3 : edgeLen > 0.018 ? 2 : 1;
        let prev = p0;
        let prevT = edgeTime(p0, jitter);
        for (let k = 1; k <= subDivs; k++) {
          const frac = k / subDivs;
          let next = lerp3(p0, p1, frac);
          if (k < subDivs) {
            const kink = (rng() - 0.5) * Math.min(0.0032, edgeLen * 0.08);
            next = add3(next, scale3(perp, kink));
          }
          const nextT = Math.max(prevT + 0.006, edgeTime(next, jitter));
          allSegs.push({
            a: prev,
            b: next,
            faceN: f.n,
            wa: baseW,
            wb: baseW,
            ta: prevT,
            tb: nextT,
            slant: slant + (k - 1) * 0.18,
            boldness,
          });
          prev = next;
          prevT = nextT;
        }

        // Occasional fine secondary stress whisker shooting slightly into the crystal cell from the seam!
        if (edgeLen > 0.016 && rng() < 0.34) {
          const toIn = sub3(faceCenter, mid);
          const inDist = len3(toIn);
          if (inDist > 0.008) {
            const inDir = norm3(add3(scale3(toIn, 1 / inDist), scale3(tang, (rng() - 0.5) * 0.7)));
            const wLen = Math.min(inDist * 0.65, 0.008 + rng() * 0.018);
            const tip = add3(mid, scale3(inDir, wLen));
            const tMid = edgeTime(mid, jitter) + 0.018;
            allSegs.push({
              a: mid,
              b: tip,
              faceN: f.n,
              wa: baseW * 0.68,
              wb: baseW * 0.14,
              ta: tMid,
              tb: tMid + 0.045 + rng() * 0.035,
              slant: -slant,
              boldness: boldness * 0.7,
            });
          }
        }
      }

      // Also trace subtle crushed-crystal seams along the cleave boundary itself!
      const isCutFace = Math.abs(dot3(f.n, cutNormal)) > 0.96;
      if (!isCutFace) {
        for (let i = 0; i < m; i++) {
          const a = vs[i];
          const b = vs[(i + 1) % m];
          const da = Math.abs(dot3(cutNormal, a) - cutD);
          const db = Math.abs(dot3(cutNormal, b) - cutD);
          if (da < 0.003 && db < 0.003) {
            const l = len3(sub3(b, a));
            if (l < 0.004) continue;
            const ka = ptKey(a), kb = ptKey(b);
            const eKey = `cut:${ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`}`;
            if (seenEdges.has(eKey)) continue;
            seenEdges.add(eKey);
            allSegs.push({
              a, b, faceN: f.n,
              wa: 0.0020, wb: 0.0020,
              ta: 0.0, tb: 0.022,
              slant: (rng() - 0.5) * 1.4,
              boldness: 0.95,
            });
          }
        }
      }
    }
  }

  return allSegs;
}

/**
 * Triangulate exterior surface cracks into slanted double-walled glass fracture ribbons lying flush on each outer face.
 * Vertex layout (10 floats = 40 bytes):
 * [px, py, pz, nx, ny, nz, across (-1..+1), time (s), slant, boldness]
 */
export function triangulateSurfaceCracks(segs: SurfaceCrackSeg[]): Float32Array {
  const out = new Float32Array(segs.length * 6 * 10);
  let o = 0;
  for (const s of segs) {
    const dir = sub3(s.b, s.a);
    const l = len3(dir);
    if (l < 1e-5) continue;
    const tang: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
    const side = norm3(cross3(s.faceN, tang));
    const lift = scale3(s.faceN, 0.0005);
    const aL = add3(add3(s.a, lift), scale3(side, -s.wa));
    const aR = add3(add3(s.a, lift), scale3(side, s.wa));
    const bL = add3(add3(s.b, lift), scale3(side, -s.wb));
    const bR = add3(add3(s.b, lift), scale3(side, s.wb));
    const [nx, ny, nz] = s.faceN;

    const push = (p: Vec3, across: number, t: number) => {
      out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2];
      out[o++] = nx; out[o++] = ny; out[o++] = nz;
      out[o++] = across; out[o++] = t; out[o++] = s.slant; out[o++] = s.boldness;
    };

    push(aL, -1, s.ta);
    push(aR, 1, s.ta);
    push(bR, 1, s.tb);

    push(aL, -1, s.ta);
    push(bR, 1, s.tb);
    push(bL, -1, s.tb);
  }
  return out.subarray(0, o);
}

/** Triangulate a convex polyhedron into interleaved [px, py, pz, nx, ny, nz] vertices. */
export function triangulatePoly(poly: Poly): Float32Array {
  let triCount = 0;
  for (const f of poly.faces) {
    if (f.verts.length >= 3) triCount += f.verts.length - 2;
  }
  const out = new Float32Array(triCount * 3 * 6);
  let o = 0;
  for (const f of poly.faces) {
    const vs = f.verts;
    if (vs.length < 3) continue;
    const smooth = !!f.outer;
    const [fnx, fny, fnz] = f.n;
    const v0 = vs[0];
    for (let i = 1; i < vs.length - 1; i++) {
      const v1 = vs[i];
      const v2 = vs[i + 1];
      for (const v of [v0, v1, v2]) {
        const n = smooth ? norm3(v) : ([fnx, fny, fnz] as Vec3);
        out[o++] = v[0]; out[o++] = v[1]; out[o++] = v[2];
        out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2];
      }
    }
  }
  return out;
}

/**
 * Triangulate a Poisoned Black Diamond bomb gem with razor-sharp obsidian crystal shards
 * erupting outward from its facets for an unmistakable spiky silhouette while preserving
 * the clean convex core `poly` for physics and hit detection.
 */
export function triangulateBombPoly(poly: Poly, seed = 1): Float32Array {
  const core = triangulatePoly(poly);
  const rng = mulberry32((seed ^ 0x51a7b0b) >>> 0);

  // Rank faces by area so primary shards grow from the boldest, well-spaced facets around 360°
  const candidates: Array<{ centroid: Vec3; n: Vec3; area: number; radius: number }> = [];
  for (const f of poly.faces) {
    const vs = f.verts;
    if (vs.length < 3) continue;
    const area = polygonArea(vs, f.n);
    if (area < 1e-4) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const v of vs) { cx += v[0]; cy += v[1]; cz += v[2]; }
    const inv = 1 / vs.length;
    const centroid: Vec3 = [cx * inv, cy * inv, cz * inv];
    let rSum = 0;
    for (const v of vs) rSum += len3(sub3(v, centroid));
    candidates.push({ centroid, n: f.n, area, radius: rSum * inv });
  }
  candidates.sort((a, b) => b.area - a.area);

  const picked: typeof candidates = [];
  for (const cand of candidates) {
    let tooClose = false;
    for (const p of picked) {
      if (dot3(cand.n, p.n) > 0.76) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      picked.push(cand);
      if (picked.length >= 14) break;
    }
  }

  // Collect flat-shaded outward-facing spike triangles as [px, py, pz, nx, ny, nz]
  const spikeVerts: number[] = [];
  const pushTri = (a: Vec3, b: Vec3, c: Vec3, refCenter: Vec3) => {
    const rawN = cross3(sub3(b, a), sub3(c, a));
    const nLen = len3(rawN);
    if (nLen < 1e-7) return;
    let n: Vec3 = [rawN[0] / nLen, rawN[1] / nLen, rawN[2] / nLen];
    const triMid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    let p1 = b;
    let p2 = c;
    if (dot3(n, sub3(triMid, refCenter)) < 0) {
      n = [-n[0], -n[1], -n[2]];
      p1 = c;
      p2 = b;
    }
    for (const v of [a, p1, p2]) {
      spikeVerts.push(v[0], v[1], v[2], n[0], n[1], n[2]);
    }
  };

  const addShard = (
    baseCenter: Vec3,
    dir: Vec3,
    t1: Vec3,
    t2: Vec3,
    sides: number,
    rMajor: number,
    rMinor: number,
    length: number,
    tipJitter: number,
  ) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2 + (rng() - 0.5) * 0.30;
      const ca = Math.cos(ang) * rMajor;
      const sa = Math.sin(ang) * rMinor;
      // Subtle per-vertex axial stagger keeps the shard looking fractured rather than lathe-turned
      const axial = (rng() - 0.5) * 0.012;
      ring.push(
        add3(
          baseCenter,
          add3(add3(scale3(t1, ca), scale3(t2, sa)), scale3(dir, axial)),
        ),
      );
    }
    const tip = add3(
      add3(baseCenter, scale3(dir, length)),
      add3(scale3(t1, (rng() - 0.5) * tipJitter), scale3(t2, (rng() - 0.5) * tipJitter)),
    );
    const refCenter = add3(baseCenter, scale3(dir, length * 0.14));
    for (let i = 0; i < sides; i++) {
      pushTri(ring[i], ring[(i + 1) % sides], tip, refCenter);
    }
  };

  for (let pi = 0; pi < picked.length; pi++) {
    const { centroid, n, radius } = picked[pi];
    const up: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u0 = norm3(cross3(up, n));
    const v0 = norm3(cross3(n, u0));
    const phi = rng() * Math.PI * 2;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const t1 = add3(scale3(u0, cp), scale3(v0, sp));
    const t2 = add3(scale3(u0, -sp), scale3(v0, cp));

    // Bold sculpted obsidian crystal blade growing organically out of the facet
    const baseEmbed = 0.030;
    const baseC = add3(
      add3(centroid, scale3(n, -baseEmbed)),
      add3(scale3(t1, (rng() - 0.5) * radius * 0.18), scale3(t2, (rng() - 0.5) * radius * 0.18)),
    );
    const rMajor = Math.max(0.050, Math.min(0.088, radius * (0.58 + rng() * 0.22)));
    const rMinor = rMajor * (0.56 + rng() * 0.26);
    const spikeLen = baseEmbed + 0.084 + rng() * 0.062;
    addShard(baseC, n, t1, t2, 4, rMajor, rMinor, spikeLen, 0.034);

    // Overlapping angled companion shard beside most primary blades for a jagged mineral cluster feel
    if (pi % 3 !== 2) {
      const tilt = 0.42 + rng() * 0.26; // ~24°–39° cant
      const secDir = norm3(add3(n, add3(scale3(t1, tilt), scale3(t2, (rng() - 0.5) * 0.26))));
      const secT1 = norm3(cross3(t2, secDir));
      const secT2 = norm3(cross3(secDir, secT1));
      const secBase = add3(baseC, scale3(t1, rMajor * 0.36));
      const secRMajor = rMajor * (0.56 + rng() * 0.18);
      const secRMinor = secRMajor * (0.58 + rng() * 0.24);
      const secLen = spikeLen * (0.58 + rng() * 0.24);
      addShard(secBase, secDir, secT1, secT2, 3, secRMajor, secRMinor, secLen, 0.020);
    }
  }

  const out = new Float32Array(core.length + spikeVerts.length);
  out.set(core, 0);
  out.set(spikeVerts, core.length);
  return out;
}

/**
 * Triangulate internal crack faces into interleaved:
 * [px, py, pz, nx, ny, nz, crackDelay, edgeFlag] (8 floats per vertex).
 * Uses fan from polygon centroid so `edgeFlag` = 0 at interior centroid and 1 on polygon boundary
 * (giving razor-sharp gleaming crystal fracture veins along every 3D crack edge!).
 */
export function triangulateCracks(faces: CrackFace[]): Float32Array {
  let triCount = 0;
  for (const f of faces) {
    if (f.verts.length >= 3) triCount += f.verts.length * 2;
  }
  const out = new Float32Array(triCount * 3 * 8);
  let o = 0;
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const vs = f.verts;
    const m = vs.length;
    if (m < 3) continue;
    const [nx, ny, nz] = f.n;
    let cx = 0, cy = 0, cz = 0;
    for (const v of vs) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= m; cy /= m; cz /= m;

    for (let i = 0; i < m; i++) {
      const v1 = vs[i];
      const v2 = vs[(i + 1) % m];
      // Front side (centroid has edgeFlag = 0, outer polygon edge vertices have edgeFlag = 1)
      out[o++] = cx; out[o++] = cy; out[o++] = cz; out[o++] = nx; out[o++] = ny; out[o++] = nz; out[o++] = f.delay; out[o++] = 0.0;
      out[o++] = v1[0]; out[o++] = v1[1]; out[o++] = v1[2]; out[o++] = nx; out[o++] = ny; out[o++] = nz; out[o++] = f.delay; out[o++] = 1.0;
      out[o++] = v2[0]; out[o++] = v2[1]; out[o++] = v2[2]; out[o++] = nx; out[o++] = ny; out[o++] = nz; out[o++] = f.delay; out[o++] = 1.0;
      // Back side
      out[o++] = cx; out[o++] = cy; out[o++] = cz; out[o++] = -nx; out[o++] = -ny; out[o++] = -nz; out[o++] = f.delay; out[o++] = 0.0;
      out[o++] = v2[0]; out[o++] = v2[1]; out[o++] = v2[2]; out[o++] = -nx; out[o++] = -ny; out[o++] = -nz; out[o++] = f.delay; out[o++] = 1.0;
      out[o++] = v1[0]; out[o++] = v1[1]; out[o++] = v1[2]; out[o++] = -nx; out[o++] = -ny; out[o++] = -nz; out[o++] = f.delay; out[o++] = 1.0;
    }
  }
  return out;
}

/**
 * Triangulate a set of shattered shards into interleaved vertex data:
 * [relX, relY, relZ, nx, ny, nz, origX, origY, origZ, shardId] (10 floats per vertex).
 * `rel` is relative to each shard's centroid (transformed by Rapier rigid-body pose);
 * `orig` is in the original cube's local coordinates (for exact Sommerso colour preservation!).
 */
export function triangulateShards(shards: ShatterShard[], baseShardId: number): Float32Array {
  let triCount = 0;
  for (const s of shards) {
    for (const f of s.poly.faces) {
      if (f.verts.length >= 3) triCount += f.verts.length - 2;
    }
  }
  const out = new Float32Array(triCount * 3 * 10);
  let o = 0;
  for (let si = 0; si < shards.length; si++) {
    const s = shards[si];
    const [cx, cy, cz] = s.centroid;
    const id = baseShardId + si;
    for (const f of s.poly.faces) {
      const vs = f.verts;
      if (vs.length < 3) continue;
      const smooth = !!f.outer;
      const [fnx, fny, fnz] = f.n;
      const v0 = vs[0];
      for (let i = 1; i < vs.length - 1; i++) {
        const v1 = vs[i];
        const v2 = vs[i + 1];
        for (const v of [v0, v1, v2]) {
          const n = smooth ? norm3(v) : ([fnx, fny, fnz] as Vec3);
          out[o++] = v[0] - cx; out[o++] = v[1] - cy; out[o++] = v[2] - cz;
          out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2];
          out[o++] = v[0]; out[o++] = v[1]; out[o++] = v[2];
          out[o++] = id;
        }
      }
    }
  }
  return out;
}
