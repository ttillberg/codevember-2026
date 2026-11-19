// The block of rock: a voxel grid, one u32 per cell.
//
//   bits 0-2    type: air, water, sediment, rock, ground, plant
//               (a water voxel is only the picture of the water, which is a depth per column: sim.wgsl)
//   bits 3-6    layer, the colour and the hardness (LAYERS)
//   bits 8-9    shade, the lamination: thin lighter and darker beds inside a layer
//   bit  10     weak: a vertical joint, wears four times as fast
//   bits 8-11   water only: how full this voxel is, 1..15 (a film is drawn faint)
//   bits 12-15  water only: how fast it runs, 15 white water, 0 still
//               rock only: weakness, 0..15. Most rock is sound; here and there is a pocket of
//               rotten rock, a lens a few voxels across lying along the beds. That is where the
//               weather gets in first, and gnaws on from.
//   bits 16-27  rock only: steps to the ground through rock, how it knows it still stands

export const GX = 192;
export const GY = 160;
export const GZ = 192;
export const GROUND_H = 8;
export const CUBE = 128;

export const AIR = 0;
export const WATER = 1;
export const SED = 2;
export const ROCK = 3;
export const GROUND = 4;

// soft: how fast it wears, 1 is plain sandstone. The hard thin beds are what make ledges.
export const LAYERS: { name: string; color: string; soft: number }[] = [
  { name: 'kayenta', color: '#7d3d2d', soft: 0.18 },
  { name: 'navajo', color: '#d8703a', soft: 1.0 },
  { name: 'salmon', color: '#e29766', soft: 0.6 },
  { name: 'caprock', color: '#efd3a9', soft: 0.25 },
  { name: 'deep red', color: '#b24c2b', soft: 0.45 },
  { name: 'pale band', color: '#f2c8a2', soft: 1.3 },
  { name: 'shale', color: '#96573a', soft: 1.7 },
  { name: 'ironstone', color: '#5c383c', soft: 0.06 },
];
// what grows, drawn with the same layer bits: grass, grass, leaves, leaves, wood, and (14) cactus
export const GREEN: Record<number, string> = { 8: '#8fa04a', 9: '#6f8f3f', 10: '#4f7d3c', 11: '#3d6a3a', 12: '#5b3d2a', 14: '#5f9a6e' };
// what lies buried: bone, drawn with layer 13, and all but proof against the weather
export const BONE_LAYER = 13;
export const BONE_COLOR = '#fbf6e6';
export const BONE_SOFT = 0.001; // a thousandth of plain sandstone: digging one out, it is what is left
export const GROUND_LAYER = 15;
export const GROUND_COLOR = '#2e2927';

// bottom to top: [layer, thickness in voxels]
const BANDS: [number, number][] = [
  [0, 16], [4, 10], [7, 2], [1, 18], [5, 4], [2, 12], [7, 2], [6, 8],
  [1, 20], [3, 5], [4, 10], [2, 9], [7, 2], [1, 14], [5, 3], [3, 30],
];

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function hash3(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise3(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const at = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), ux), lerp(at(0, 1, 0), at(1, 1, 0), ux), uy),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), ux), lerp(at(0, 1, 1), at(1, 1, 1), ux), uy),
    uz,
  );
}

// A block, as it starts: the voxels, and per column the water (depth, wear, bed, discharge: sim.wgsl col)
// and what grows (cover, the bed it grew on, moisture, wall tufts: sim.wgsl veg).
export type World = { cells: Uint32Array<ArrayBuffer>; col: Float32Array<ArrayBuffer>; veg: Float32Array<ArrayBuffer> };

type P3 = [number, number, number];

// ---------- what lies buried ----------
//
// Skeletons, standing in the rock as they stood: bone is rock of its own layer, so hard that the
// weather takes what is round it and leaves it. They are drawn here with two tools, a bone (every
// voxel within a radius of a line) and a shell (the skull), in the animal's own frame: x along
// it, nose first, y up, z across. Each is set a little way in behind one of the block's faces,
// side on to it, where taking that face off will find it.
function bury(cells: Uint32Array, seed: number) {
  const x0 = (GX - CUBE) / 2;
  const z0 = (GZ - CUBE) / 2;
  const put = (x: number, y: number, z: number) => {
    if (x < x0 || z < z0 || x >= x0 + CUBE || z >= z0 + CUBE || y < GROUND_H || y >= GROUND_H + CUBE) return;
    const i = x + GX * (z + GZ * y);
    if ((cells[i] & 7) !== ROCK) return;
    const shade = 2 + (hash3(x, y, z, seed + 31) < 0.3 ? 1 : 0);
    cells[i] = ROCK | (BONE_LAYER << 3) | (shade << 8) | (cells[i] & 0x0fff0000);
  };
  // k is the animal's scale: the models are drawn large and set in the rock at half that.
  // A bone is never thinner than a voxel, whatever the scale.
  type Frame = { k: number; at: (p: P3) => P3; back: (p: P3) => P3 };
  // `flat` squeezes the animal across, towards a slab: pressed in the rock, a side view of it.
  const frame = (px: number, py: number, pz: number, yaw: number, k = 1, flat = 1): Frame => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const kz = k * flat;
    return {
      k,
      at: ([x, y, z]) => [px + x * c * k - z * s * kz, py + y * k, pz + x * s * k + z * c * kz],
      back: ([x, y, z]) => [((x - px) * c + (z - pz) * s) / k, (y - py) / k, (-(x - px) * s + (z - pz) * c) / kz],
    };
  };
  const bone = (f: Frame, a: P3, b: P3, thick: number) => {
    const r = Math.max(thick * f.k, 0.6);
    const A = f.at(a);
    const B = f.at(b);
    const d: P3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(A[k], B[k]) - r));
    const hi = [0, 1, 2].map((k) => Math.ceil(Math.max(A[k], B[k]) + r));
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
      const t = Math.max(0, Math.min(1, ((x - A[0]) * d[0] + (y - A[1]) * d[1] + (z - A[2]) * d[2]) / dd));
      if (Math.hypot(x - A[0] - d[0] * t, y - A[1] - d[1] * t, z - A[2] - d[2] * t) <= r) put(x, y, z);
    }
  };
  // bones end to end, from one thickness to another
  const chain = (f: Frame, pts: P3[], r0: number, r1 = r0) => {
    for (let i = 0; i + 1 < pts.length; i++) bone(f, pts[i], pts[i + 1], r0 + ((r1 - r0) * i) / Math.max(1, pts.length - 2));
  };
  const both = (f: Frame, pts: P3[], r0: number, r1 = r0) => {
    chain(f, pts, r0, r1);
    chain(f, pts.map(([x, y, z]) => [x, y, -z] as P3), r0, r1);
  };
  // a hollow ball, with holes in it
  const shell = (f: Frame, c: P3, rad: P3, holes: { c: P3; r: number }[] = []) => {
    const m = Math.max(...rad) * f.k + 1;
    const small = f.k < 0.6; // too small for a hollow or for eye sockets: a knob of bone
    const C = f.at(c);
    for (let y = Math.floor(C[1] - m); y <= C[1] + m; y++) for (let z = Math.floor(C[2] - m); z <= C[2] + m; z++) for (let x = Math.floor(C[0] - m); x <= C[0] + m; x++) {
      const l = f.back([x, y, z]);
      const d = Math.hypot((l[0] - c[0]) / rad[0], (l[1] - c[1]) / rad[1], (l[2] - c[2]) / rad[2]);
      if (d > 1 || (!small && d < 0.6)) continue;
      if (!small && holes.some((h) => Math.hypot(l[0] - h.c[0], l[1] - h.c[1], l[2] - h.c[2]) < h.r)) continue;
      put(x, y, z);
    }
  };
  // ribs: hoops hung from the spine, wide at the shoulder and closing under the belly
  const ribs = (f: Frame, xs: number[], spine: (x: number) => number, wide: number, deep: number) => {
    // small, every other rib: closer than that and they run together into a slab
    for (const x of f.k < 0.6 ? xs.filter((_, i) => i % 2 === 0) : xs) {
      const y = spine(x);
      both(f, [[x, y, 0], [x, y - deep * 0.22, wide * 0.85], [x, y - deep * 0.62, wide], [x, y - deep, wide * 0.5]], 0.75);
    }
  };

  const mammoth = (f: Frame) => {
    const spine: P3[] = [[-13, 15, 0], [-9, 18, 0], [-2, 20, 0], [5, 22.5, 0], [10, 22, 0], [14, 19.5, 0]];
    chain(f, spine, 1.15);
    chain(f, [[-13, 15, 0], [-15, 12.5, 0], [-16, 9.5, 0]], 0.8, 0.6); // tail
    ribs(f, [-4, -1, 2, 5, 8], (x) => 20 + (x + 2) * 0.33, 5.2, 12);
    bone(f, [-10, 17, -4.5], [-10, 17, 4.5], 1.4); // hips
    both(f, [[9, 21, 2.5], [8.5, 16.5, 4.6]], 1.2); // shoulder blades
    both(f, [[8.5, 16.5, 4.6], [9.5, 8, 4.4], [8.5, 0, 4.4]], 1.1); // forelegs
    both(f, [[-10, 17, 4.5], [-8.5, 8.5, 4.3], [-10, 0, 4.3]], 1.1); // hind legs
    both(f, [[8.5, 0, 4.4], [10.5, 0, 4.4]], 1.2); // feet
    both(f, [[-10, 0, 4.3], [-8, 0, 4.3]], 1.2);
    shell(f, [17.5, 19.5, 0], [4.2, 5.2, 3.6], [{ c: [19.2, 20, 3.2], r: 1.5 }, { c: [19.2, 20, -3.2], r: 1.5 }]);
    both(f, [[15, 15, 2.2], [19.5, 13.5, 1.8]], 0.9); // jaw
    // tusks: down and forward out of the face, then sweeping up and in
    both(f, [[19.5, 15.5, 2.2], [22.5, 10, 3.6], [26.5, 7, 4.6], [30.5, 8, 4.1], [33, 11.5, 2.6], [33.5, 14.5, 1.4]], 1.15, 0.7);
  };

  const longNeck = (f: Frame) => {
    chain(f, [[-36, 4, 0], [-29, 6.5, 0], [-20, 10, 0], [-10, 14, 0]], 0.7, 1.1); // tail
    chain(f, [[-10, 14, 0], [0, 16, 0], [10, 15, 0]], 1.2); // back
    chain(f, [[10, 15, 0], [17, 21, 0], [22.5, 28.5, 0], [26, 35.5, 0]], 1.1, 0.8); // neck
    shell(f, [28.6, 37, 0], [3, 2, 1.8], [{ c: [29.4, 37.4, 1.6], r: 0.9 }, { c: [29.4, 37.4, -1.6], r: 0.9 }]);
    ribs(f, [-7, -4.5, -2, 0.5, 3, 5.5, 8], (x) => 15.6 - Math.abs(x) * 0.12, 4.6, 9.5);
    bone(f, [-9, 14, -4], [-9, 14, 4], 1.3);
    both(f, [[-9, 14, 4], [-7.5, 7, 4], [-9, 0, 4]], 1.15);
    both(f, [[8, 15, 3.6], [9, 7.5, 3.8], [8, 0, 3.8]], 1.1);
  };

  // a tyrannosaur: on two legs, the tail out behind to balance a head too big for it
  const tyrant = (f: Frame) => {
    chain(f, [[-30, 16, 0], [-20, 17, 0], [-10, 19, 0]], 0.7, 1.1); // tail
    chain(f, [[-10, 19, 0], [0, 20, 0], [8, 22, 0]], 1.25); // back
    chain(f, [[8, 22, 0], [12, 26, 0], [14, 29, 0]], 1.15); // neck
    shell(f, [19.5, 30, 0], [6, 3.6, 2.8], [{ c: [17.5, 31.5, 2.6], r: 1.2 }, { c: [17.5, 31.5, -2.6], r: 1.2 }]);
    both(f, [[14.5, 27, 1.8], [24.5, 26, 1.2]], 0.85); // jaw
    ribs(f, [-4, -1, 2, 5], (x) => 19.8 + x * 0.25, 3.8, 8);
    bone(f, [-7, 19, -3.5], [-7, 19, 3.5], 1.4); // hips
    both(f, [[-7, 19, 3.5], [-3, 11, 3.8], [-7.5, 5, 3.8], [-5, 0, 3.8]], 1.3); // legs
    both(f, [[-5, 0, 3.8], [-1, 0, 3.8]], 1.15); // feet
    both(f, [[7, 20, 2.5], [9.5, 17, 2.8], [11, 17.5, 2.8]], 0.6); // the little arms
  };

  // an ammonite: a flat coil lying in its bed
  const ammonite = (f: Frame, r: number) => {
    let prev: P3 | null = null;
    for (let a = 0; a <= Math.PI * 5; a += 0.25) {
      const rr = (r * (0.18 + 0.82 * a)) / (Math.PI * 5);
      const p: P3 = [Math.cos(a) * rr, 0, Math.sin(a) * rr];
      if (prev) bone(f, prev, p, 0.5 + 0.45 * (a / (Math.PI * 5)));
      prev = p;
    }
  };

  // behind a face: 0 the +z face and 1 the +x face (the two a first look shows), 2 and 3 the far ones.
  // `along` is the place along the face, `in` how far behind it, `up` the height of the feet.
  const SMALL = 1 / 2;
  const behind = (face: number, along: number, inn: number, up: number, flip: boolean, flat = 1): Frame => {
    const cx = GX / 2;
    const cz = GZ / 2;
    const h = CUBE / 2;
    const turn = flip ? Math.PI : 0;
    if (face === 0) return frame(cx + along, GROUND_H + up, cz + h - inn, turn, SMALL, flat);
    if (face === 1) return frame(cx + h - inn, GROUND_H + up, cz + along, Math.PI / 2 + turn, SMALL, flat);
    if (face === 2) return frame(cx + along, GROUND_H + up, cz - h + inn, turn, SMALL, flat);
    return frame(cx - h + inn, GROUND_H + up, cz + along, Math.PI / 2 + turn, SMALL, flat);
  };
  const r = (k: number) => hash2(k, 77, seed);
  // The first mammoth is in one of the two near faces, and pressed flat: a slab of it lying in
  // the surface of the wall, all of it to be seen from the side from the start, the way a
  // fossil is found. The rest stand whole, anywhere behind any face, a few voxels in or a good way.
  const first = r(1) < 0.5 ? 0 : 1;
  mammoth(behind(first, (r(2) - 0.5) * 60, 0.8, 30 + r(4) * 60, r(5) < 0.5, 0.12));
  // and one tyrannosaur somewhere, two long necks and two more mammoths
  const beasts = [tyrant, longNeck, mammoth, longNeck, mammoth];
  for (let n = 0; n < beasts.length; n++) {
    const q = (k: number) => hash2(200 + n * 10 + k, 77, seed);
    beasts[n](behind(Math.floor(q(1) * 4), (q(2) - 0.5) * 70, 4 + q(3) * q(3) * 36, 4 + q(4) * 90, q(5) < 0.5));
  }
  for (let k = 0; k < 12; k++) {
    const f = frame(x0 + 8 + r(20 + k) * (CUBE - 16), GROUND_H + 6 + r(40 + k) * (CUBE - 14), z0 + 8 + r(60 + k) * (CUBE - 16), r(80 + k) * 6.28);
    ammonite(f, 1.5 + r(100 + k) * 2);
  }
}

// ---------- how it starts ----------
//
// Not a bare block: a lake on top with a river running out of it both ways, cut into the rock and
// full to just under the brim, and grass. One level for all of the water, so it lies still until
// something disturbs it. The river stops short of the edges: over the side it would be gone.
function landscape(cells: Uint32Array, seed: number) {
  const col = new Float32Array(GX * GZ * 4);
  const veg = new Float32Array(GX * GZ * 4);
  const x0 = (GX - CUBE) / 2;
  const z0 = (GZ - CUBE) / 2;
  const top = GROUND_H + CUBE; // the first air above the block
  const r = (k: number) => hash2(k, 99, seed);

  const lx = GX / 2 + (r(1) - 0.5) * 34;
  const lz = GZ / 2 + (r(2) - 0.5) * 34;
  const lr = 11 + r(3) * 5;
  // the river: two arms out of the lake, winding, each a row of points with how far along it is
  const arms: [number, number, number][][] = [];
  const heading = r(4) * Math.PI * 2;
  for (let k = 0; k < 2; k++) {
    const a = heading + k * Math.PI + (r(5 + k) - 0.5) * 0.9;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const s = t * 85;
      const wob = (9 * Math.sin(t * 5.2 + r(7 + k) * 6) + 4 * Math.sin(t * 13 + r(9 + k) * 6)) * Math.min(1, t * 3);
      const x = lx + Math.cos(a) * s - Math.sin(a) * wob;
      const z = lz + Math.sin(a) * s + Math.cos(a) * wob;
      if (x < x0 + 10 || z < z0 + 10 || x > x0 + CUBE - 10 || z > z0 + CUBE - 10) break;
      pts.push([x, z, t]);
    }
    arms.push(pts);
  }

  for (let z = 0; z < GZ; z++) {
    for (let x = 0; x < GX; x++) {
      const i = (x + GX * z) * 4;
      const on = x >= x0 && z >= z0 && x < x0 + CUBE && z < z0 + CUBE;
      if (!on) { col[i + 2] = GROUND_H; continue; }
      // how deep the water has cut here, and how far it is to the water
      const shore = lr * (0.72 + 0.56 * vnoise(x / 9, z / 9, seed + 20));
      const dl = Math.hypot(x - lx, z - lz);
      let depth = dl < shore ? 1.4 + 5.6 * (1 - (dl / shore) ** 2) : 0;
      let away = dl - shore;
      for (const pts of arms) {
        for (const [px, pz, t] of pts) {
          const d = Math.hypot(x - px, z - pz);
          const w = 3.3 - 1.3 * t + 0.8 * vnoise(x / 6, z / 6, seed + 21);
          if (d < w) depth = Math.max(depth, 0.9 + 2.6 * (1 - (d / w) ** 2));
          away = Math.min(away, d - w);
        }
      }
      const cut = Math.round(depth);
      for (let y = top - cut; y < top; y++) cells[x + GX * (z + GZ * y)] = AIR;
      col[i] = cut > 0 ? cut - 0.7 : 0;
      col[i + 2] = top - cut;
      // what grows: a wood along the water, grass further off (only where there is soil: sim.wgsl grow)
      veg[i] = cut > 0 ? 0 : away < 12 ? 3 : away < 22 ? 0.9 : 0.5;
      veg[i + 1] = top - cut;
      veg[i + 2] = 1;
    }
  }
  return { col, veg };
}

export function buildWorld(seed: number): World {
  const cells = new Uint32Array(GX * GY * GZ);

  // the tray the block stands on: a round one, as wide as the grid lets it be, just clear of the block's corners
  const rim = GX / 2 - 1;
  for (let z = 0; z < GZ; z++) {
    for (let x = 0; x < GX; x++) {
      if (Math.hypot(x + 0.5 - GX / 2, z + 0.5 - GZ / 2) > rim) continue;
      for (let y = 0; y < GROUND_H; y++) cells[x + GX * (z + GZ * y)] = GROUND | (GROUND_LAYER << 3);
    }
  }

  // which layer at which (warped) height
  const PAD = 16;
  const bandAt: number[] = [];
  for (const [layer, thick] of BANDS) for (let i = 0; i < thick; i++) bandAt.push(layer);

  const x0 = (GX - CUBE) / 2;
  const z0 = (GZ - CUBE) / 2;
  const tiltX = (hash2(1, 2, seed) - 0.5) * 0.14;
  const tiltZ = (hash2(3, 4, seed) - 0.5) * 0.14;

  for (let z = z0; z < z0 + CUBE; z++) {
    for (let x = x0; x < x0 + CUBE; x++) {
      const warp =
        tiltX * (x - GX / 2) +
        tiltZ * (z - GZ / 2) +
        12 * (vnoise(x / 48, z / 48, seed) - 0.5) +
        3 * (vnoise(x / 13, z / 13, seed + 1) - 0.5);
      const lam = 2 * vnoise(x / 7, z / 7, seed + 2);
      // joints: the level lines of a noise, thin curved sheets through the whole height
      const weak =
        Math.abs(vnoise(x / 30, z / 30, seed + 3) - 0.5) < 0.014 ||
        Math.abs(vnoise(x / 22, z / 22, seed + 4) - 0.5) < 0.01;
      for (let y = GROUND_H; y < GROUND_H + CUBE; y++) {
        const yw = y - GROUND_H + warp + PAD;
        const layer = bandAt[Math.max(0, Math.min(bandAt.length - 1, Math.floor(yw)))];
        const shade = Math.floor(hash2(Math.floor(yw + lam), layer, seed + 5) * 4);
        const dist = y - GROUND_H + 1;
        // weakness: lenses along the beds (flat: the noise is squeezed in y), big and small, and grain
        const n =
          0.55 * vnoise3(x / 11, yw / 4, z / 11, seed + 6) +
          0.3 * vnoise3(x / 4.5, yw / 2, z / 4.5, seed + 7) +
          0.15 * hash3(x, y, z, seed + 8);
        const rot = Math.max(0, Math.min(15, Math.round((n - 0.36) * 40)));
        cells[x + GX * (z + GZ * y)] =
          ROCK | (layer << 3) | (shade << 8) | (weak ? 1 << 10 : 0) | (rot << 12) | (dist << 16);
      }
    }
  }
  bury(cells, seed);
  return { cells, ...landscape(cells, seed) };
}
