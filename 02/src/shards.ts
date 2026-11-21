// From the faces of the crack graph to shards: a mesh for the renderer (front, back and the crack surfaces as
// side walls, the same quads the cracks were drawn with) and convex pieces for the physics.
import earcut from 'earcut';
import type { Pane } from './cracks';

/** floats per vertex: position 3, normal 3, pane uv 2, depth in the glass 0…1, birth time, shard id, kind */
export const STRIDE = 12;

export interface Body {
  /** centre of the shard in the world, metres */
  c: [number, number, number];
  area: number;
  /** too small for a hull of its own: a box that only meets the floor */
  tiny: boolean;
  /** convex pieces, points relative to c */
  hulls: Float32Array[];
  /** half extents, for the tiny ones */
  half: [number, number, number];
  /** stands on the bottom of the frame */
  low: boolean;
  /** held together with every other shard of this group by a strip of tape: they fall as one */
  group?: number;
  /** one piece of a larger shard that is still whole: they fall as one until it lands hard, then each for itself */
  parent?: number;
}

export interface ShardSet {
  count: number;
  walls: Float32Array;
  faces: Float32Array;
  bodies: Body[];
  /** the outlines of everything that leaves the pane, in pane space, to cut it out of what stays */
  cut: number[][];
  /** part of the pane stays standing */
  kept: boolean;
  /** one entry per strip of tape that falls: a shard of it (its id, its centre), to hang the tape itself on */
  groups: { group: number; id: number; c: [number, number, number] }[];
}

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Douglas-Peucker on a closed loop of indices into xs, ys. */
function simplify(loop: number[], xs: number[], ys: number[], tol: number): number[] {
  const n = loop.length;
  if (n <= 4) return loop;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(xs[loop[i]] - xs[loop[0]], ys[loop[i]] - ys[loop[0]]);
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const at = (i: number) => loop[i % n];
  const rec = (a: number, b: number) => {
    if (b - a < 2) return;
    const ax = xs[at(a)], ay = ys[at(a)], bx = xs[at(b)], by = ys[at(b)];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(cross(ax, ay, bx, by, xs[at(i)], ys[at(i)])) / len;
      if (d > md) { md = d; m = i; }
    }
    if (m < 0) return;
    keep[m] = 1; rec(a, m); rec(m, b);
  };
  rec(0, far); rec(far, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(loop[i]);
  return out.length >= 3 ? out : loop;
}

function isConvex(poly: number[], xs: number[], ys: number[]) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    if (cross(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]) < -1e-9) return false;
  }
  return true;
}

/** Triangles merged while they stay convex (Hertel-Mehlhorn, greedy). */
function convexParts(loop: number[], xs: number[], ys: number[]): number[][] {
  if (isConvex(loop, xs, ys)) return [loop];
  const flat: number[] = [];
  for (const i of loop) flat.push(xs[i], ys[i]);
  const tri = earcut(flat);
  let polys: number[][] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const p = [loop[tri[i]], loop[tri[i + 1]], loop[tri[i + 2]]];
    if (cross(xs[p[0]], ys[p[0]], xs[p[1]], ys[p[1]], xs[p[2]], ys[p[2]]) < 0) p.reverse();
    polys.push(p);
  }
  let merged = true;
  while (merged && polys.length > 1) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const A = polys[i], B = polys[j];
        for (let a = 0; a < A.length; a++) {
          const a0 = A[a], a1 = A[(a + 1) % A.length];
          const b = B.indexOf(a1);
          if (b < 0 || B[(b + 1) % B.length] !== a0) continue;
          // A from a1 round to a0, then B from a0 round to a1, without the shared edge
          const m: number[] = [];
          for (let k = 0; k < A.length - 1; k++) m.push(A[(a + 1 + k) % A.length]);
          for (let k = 0; k < B.length - 1; k++) m.push(B[(b + 1 + k) % B.length]);
          if (!isConvex(m, xs, ys)) continue;
          polys[i] = m; polys.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  if (polys.length > 6) {
    const area = (p: number[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; s += xs[u] * ys[v] - xs[v] * ys[u]; } return s; };
    polys = polys.sort((p, q) => area(q) - area(p)).slice(0, 6);
  }
  return polys;
}

/** y0 is the height of the bottom of the pane above the floor. The front of the glass is z = 0, the back z = -T. */
/** With `standing`, the largest face stays where it is, if it stands in the channel: it is not a shard.
 *  Nor is anything `held` (by tape). */
/** `layer` is which pane this is, and `z` where its front stands: several can stand behind each other. */
/** `parentOf` says which larger shard a point of the pane is in, when the graph was cut twice, coarse then fine:
 *  the faces are the fine pieces, and those of one larger shard go as one until it breaks. The cuts between
 *  them are walls of kind 3: not to be seen while it is whole. */
export function buildShards(pane: Pane, y0: number, standing = false, gone: (loop: number[]) => boolean = () => false, layer = 0, z = 0, dice = false, held: (loop: number[]) => number = () => -1, groupBase = 0, parentOf?: (x: number, y: number) => number): ShardSet {
  const { nx, ny, ox, oy, W, T } = pane;
  const loops = pane.faces().filter((l) => !gone(l)); // without what left in an earlier fall
  // which larger shard each face is of, and which face is across each edge
  const N = nx.length;
  const across = new Map<number, number>();
  const parent = new Int32Array(loops.length).fill(-1);
  if (parentOf) loops.forEach((loop, li) => {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < loop.length; i++) {
      const u = loop[i], v = loop[(i + 1) % loop.length];
      const w = nx[u] * ny[v] - nx[v] * ny[u];
      a += w; cx += (nx[u] + nx[v]) * w; cy += (ny[u] + ny[v]) * w;
      across.set(u * N + v, li);
    }
    if (a > 2e-8 && held(loop) < 0) parent[li] = parentOf(cx / (3 * a), cy / (3 * a));
  });
  const walls: number[] = [];
  const faces: number[] = [];
  const bodies: Body[] = [];
  const hx = W / 2;
  const cut: number[][] = [];
  let keep: number[] | null = null;
  if (standing) {
    let big = 0;
    for (const loop of loops) { const a = pane.area(loop); if (a > big) { big = a; keep = loop; } }
    if (keep && (big < 0.2 * W * pane.H || !keep.some((u, i) => ny[u] < 1e-6 && ny[keep![(i + 1) % keep!.length]] < 1e-6))) keep = null;
  }
  let taped = false;
  const groups: ShardSet['groups'] = [];
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li];
    const n = loop.length;
    if (loop === keep) continue;
    // under tape: with a pane still standing around it, it stays where it is, part of that pane. With none,
    // the strip has nothing to hang from: its pieces go, but as one, stuck to the tape
    const tape = held(loop);
    if (tape >= 0 && keep) { taped = true; continue; }
    let a = 0, cx = 0, cy = 0, low = false;
    for (let i = 0; i < n; i++) {
      const u = loop[i], v = loop[(i + 1) % n];
      const w = nx[u] * ny[v] - nx[v] * ny[u];
      a += w; cx += (nx[u] + nx[v]) * w; cy += (ny[u] + ny[v]) * w;
      if (ny[u] < 1e-6 && ny[v] < 1e-6) low = true;
    }
    a /= 2;
    if (a < 1e-8) continue;
    cx /= 6 * a; cy /= 6 * a;
    // what the bullet took with it
    let shot = false;
    for (const im of pane.impacts) if (Math.hypot(cx - im.x, cy - im.y) < im.r) { shot = true; break; }
    cut.push(loop.flatMap((u) => [nx[u], ny[u]])); // the splinters of a bullet hole too: they are gone already
    if (shot) continue;

    const id = bodies.length;
    const wx = cx - hx, wy = cy + y0, wz = z - T / 2;
    const flat: number[] = [];
    for (const u of loop) flat.push(nx[u], ny[u]);
    const tri = earcut(flat);
    for (let i = 0; i < tri.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const u = loop[tri[i + k]];
        faces.push(nx[u] - cx, ny[u] - cy, T / 2, 0, 0, 1, nx[u], ny[u], 0, -1e3, id, layer * 10);
      }
      for (let k = 2; k >= 0; k--) {
        const u = loop[tri[i + k]];
        faces.push(nx[u] + ox[u] - cx, ny[u] + oy[u] - cy, -T / 2, 0, 0, -1, nx[u], ny[u], 1, -1e3, id, layer * 10);
      }
    }
    for (let i = 0; i < n; i++) {
      const u = loop[i], v = loop[(i + 1) % n];
      const other = parent[li] >= 0 ? across.get(v * N + u) : undefined;
      const inner = other !== undefined && parent[other] === parent[li];
      pushWall(walls, nx[u] - cx, ny[u] - cy, nx[v] - cx, ny[v] - cy, ox[u], oy[u], ox[v], oy[v], T / 2, T, nx[u], ny[u], nx[v], ny[v], -1e3, -1e3, id, layer * 10 + (inner ? 3 : 0), 1);
    }

    // (the dice of tempered glass are too many to have a hull each: they meet the floor, not each other)
    const tiny = dice || a < 1.5e-4;
    let hulls: Float32Array[] = [];
    let half: [number, number, number] = [0, 0, T / 2];
    if (tiny) {
      let ex = 0, ey = 0;
      for (const u of loop) { ex = Math.max(ex, Math.abs(nx[u] - cx)); ey = Math.max(ey, Math.abs(ny[u] - cy)); }
      half = [Math.max(0.002, ex * 0.8), Math.max(0.002, ey * 0.8), T / 2];
    } else {
      const simple = simplify(loop, nx, ny, 0.0015);
      const k = 0.97;
      hulls = convexParts(simple, nx, ny).map((poly) => {
        const pts = new Float32Array(poly.length * 6);
        poly.forEach((u, i) => {
          pts[i * 6] = (nx[u] - cx) * k; pts[i * 6 + 1] = (ny[u] - cy) * k; pts[i * 6 + 2] = T / 2;
          pts[i * 6 + 3] = (nx[u] + ox[u] - cx) * k; pts[i * 6 + 4] = (ny[u] + oy[u] - cy) * k; pts[i * 6 + 5] = -T / 2;
        });
        return pts;
      });
    }
    if (tape >= 0) {
      if (!groups.some((g) => g.group === groupBase + tape)) groups.push({ group: groupBase + tape, id, c: [wx, wy, wz] });
      bodies.push({ c: [wx, wy, wz], area: a, tiny, hulls, half, low, group: groupBase + tape });
    } else if (parent[li] >= 0) bodies.push({ c: [wx, wy, wz], area: a, tiny, hulls, half, low, parent: layer * 100000 + parent[li] });
    else bodies.push({ c: [wx, wy, wz], area: a, tiny, hulls, half, low });
  }
  return { count: bodies.length, walls: new Float32Array(walls), faces: new Float32Array(faces), bodies, cut, kept: !!keep || taped, groups };
}

/** One crack surface, from the front of the glass at a → b to the back at a + slant → b + slant.
  *  The normal points to the right of a → b, the outside of a counter-clockwise shard. */
export function pushWall(
  out: number[], ax: number, ay: number, bx: number, by: number, oax: number, oay: number, obx: number, oby: number,
  zf: number, T: number, ua: number, va: number, ub: number, vb: number, ta: number, tb: number, id: number, kind: number, side: number,
) {
  const zb = zf - T;
  // normal of the quad, to the right of a → b
  const ex = bx - ax, ey = by - ay;
  const dx = (oax + obx) / 2, dy = (oay + oby) / 2;
  // (e, 0) × (d, -T)
  let nx = ey * -T, ny = -ex * -T, nz = ex * dy - ey * dx;
  nx = -nx; ny = -ny; nz = -nz;
  if (nx * ey - ny * ex < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const k = kind;
  const A = [ax, ay, zf, nx, ny, nz, ua, va, 0, ta, id, k];
  const B = [bx, by, zf, nx, ny, nz, ub, vb, 0, tb, id, k];
  const C = [bx + obx, by + oby, zb, nx, ny, nz, ub, vb, 1, tb, id, k];
  const D = [ax + oax, ay + oay, zb, nx, ny, nz, ua, va, 1, ta, id, k];
  out.push(...A, ...B, ...C, ...A, ...C, ...D);
}

/** No more than `most` shards with a hull of their own: past that the smallest become tiny ones, a box that
 *  meets the floor and the walls but not other glass. What a simulation costs is glass meeting glass. */
export function limitHulls(set: ShardSet, most: number) {
  const full = set.bodies.filter((b) => !b.tiny).sort((a, b) => a.area - b.area);
  for (let i = 0; i < full.length - most; i++) {
    const b = full[i];
    let ex = 0, ey = 0, ez = 0;
    for (const h of b.hulls) for (let k = 0; k < h.length; k += 3) { ex = Math.max(ex, Math.abs(h[k])); ey = Math.max(ey, Math.abs(h[k + 1])); ez = Math.max(ez, Math.abs(h[k + 2])); }
    b.tiny = true; b.hulls = [];
    b.half = [Math.max(0.002, ex * 0.8), Math.max(0.002, ey * 0.8), ez || b.half[2]];
  }
}

/** Several panes' shards as one set, for one fall: ids run on from one to the next. */
export function mergeSets(parts: ShardSet[]): ShardSet {
  let base = 0, nw = 0, nf = 0;
  for (const p of parts) { nw += p.walls.length; nf += p.faces.length; }
  const walls = new Float32Array(nw), faces = new Float32Array(nf);
  const bodies: Body[] = [];
  const groups: ShardSet['groups'] = [];
  let ow = 0, of = 0;
  for (const p of parts) {
    walls.set(p.walls, ow); faces.set(p.faces, of);
    for (let i = ow + 10; i < ow + p.walls.length; i += STRIDE) walls[i] += base;
    for (let i = of + 10; i < of + p.faces.length; i += STRIDE) faces[i] += base;
    ow += p.walls.length; of += p.faces.length;
    bodies.push(...p.bodies);
    for (const g of p.groups) groups.push({ ...g, id: g.id + base });
    base += p.count;
  }
  return { count: base, walls, faces, bodies, cut: [], kept: parts.some((p) => p.kept), groups };
}
