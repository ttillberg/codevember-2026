// The block of rock: a voxel grid, one u32 per cell.
//
//   bits 0-2    type: air, water, sediment, rock, ground, plant (and WALL, what sim.wgsl sees off the grid)
//               (a water voxel is only the picture of the water, which is a depth per column: sim.wgsl)
//   bits 3-7    layer, the colour and the hardness (LAYERS, and EXTRA from 8 up)
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
// the block in the grid: its low corner in x and z, and the first air above it
export const X0 = (GX - CUBE) / 2;
export const Z0 = (GZ - CUBE) / 2;
export const TOP = GROUND_H + CUBE;
// The round tray the block stands on, its radius. A little more than half the grid: the block's
// corners (90 from the middle) stand well in from its rim, not on it. Out towards the corners of
// the grid there is room for that; where the tray runs past the grid's sides, four slivers of
// it, it is only drawn (common.wgsl cellAt), and nothing can lie there.
export const TRAY = 101;

// the shaders get these from main.ts, under the same names
export const TYPES = { AIR: 0, WATER: 1, SED: 2, ROCK: 3, GROUND: 4, PLANT: 5, WALL: 7 };
const { AIR, ROCK, GROUND } = TYPES;

const idx = (x: number, y: number, z: number) => x + GX * (z + GZ * y);
const onBlock = (x: number, z: number) => x >= X0 && z >= Z0 && x < X0 + CUBE && z < Z0 + CUBE;

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
// The layers that are not rock beds, drawn with the same bits. What grows (sim.wgsl stamp): grass
// and leaves in two tones each, wood, cactus. What lies buried: bone, all but proof against the
// weather, a thousandth of plain sandstone: digging one out, it is what is left. And the tray.
// From METAL up, the rest of what lies buried (sim.wgsl lasting): a saucer (METAL to LAMP: its
// hull, the glass of its dome, seen through (common.wgsl march), and its lamps), and gold.
export const EXTRA = { GRASS: 8, LEAF: 10, WOOD: 12, BONE: 13, CACTUS: 14, GROUND_LAYER: 15, METAL: 16, GLASS: 17, LAMP: 18, GOLD: 19 };
export const EXTRA_LAYERS: Record<number, { color: string; soft: number }> = {
  [EXTRA.GRASS]: { color: '#8fa04a', soft: 0 },
  [EXTRA.GRASS + 1]: { color: '#6f8f3f', soft: 0 },
  [EXTRA.LEAF]: { color: '#4f7d3c', soft: 0 },
  [EXTRA.LEAF + 1]: { color: '#3d6a3a', soft: 0 },
  [EXTRA.WOOD]: { color: '#5b3d2a', soft: 0 },
  [EXTRA.BONE]: { color: '#fbf6e6', soft: 0.001 },
  [EXTRA.CACTUS]: { color: '#5f9a6e', soft: 0 },
  [EXTRA.GROUND_LAYER]: { color: '#2e2927', soft: 0 },
  [EXTRA.METAL]: { color: '#9aa6ad', soft: 0 },
  [EXTRA.GLASS]: { color: '#b4e4ea', soft: 0 },
  [EXTRA.LAMP]: { color: '#f3c24a', soft: 0 },
  [EXTRA.GOLD]: { color: '#eeb02a', soft: 0 },
};

// bottom to top: [layer, thickness in voxels]
const BANDS: [number, number][] = [
  [0, 16], [4, 10], [7, 2], [1, 18], [5, 4], [2, 12], [7, 2], [6, 8],
  [1, 20], [3, 5], [4, 10], [2, 9], [7, 2], [1, 14], [5, 3], [3, 30],
];

function hash3(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hash2 = (x: number, y: number, seed: number) => hash3(x, y, 0, seed);
const smooth = (f: number) => f * f * (3 - 2 * f);

function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Value noise in 3D, asked up one column: x and z stay put, so the corners are only looked up
// (and blended along x) when y comes into a new cell, not for every voxel.
function columnNoise(x: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const ux = smooth(x - xi);
  const uz = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const edge = (yi: number, dz: number) => lerp(hash3(xi, yi, zi + dz, seed), hash3(xi + 1, yi, zi + dz, seed), ux);
  let at = NaN; // the cell y is in, and its four edges along x: near and far in z, low and high in y
  let e = [0, 0, 0, 0];
  return (y: number) => {
    const yi = Math.floor(y);
    if (yi !== at) {
      e = yi === at + 1 ? [e[2], e[3], edge(yi + 1, 0), edge(yi + 1, 1)] : [edge(yi, 0), edge(yi, 1), edge(yi + 1, 0), edge(yi + 1, 1)];
      at = yi;
    }
    const uy = smooth(y - yi);
    return lerp(lerp(e[0], e[2], uy), lerp(e[1], e[3], uy), uz);
  };
}

// A block, as it starts: the voxels, and per column the water (depth, wear, bed, discharge: sim.wgsl col)
// and what grows (cover, the bed it grew on, moisture, wall tufts: sim.wgsl veg).
// And the saucer that lies in it (bury): a model of it on its own, upright, in a small grid
// (MODEL, its own middle at MODEL_AT), for when it flies; where it lies in the block, the three
// axes it lies along (its own x, up and z) and the way out through the nearest face; and probes,
// cells round it that are open once it has been dug out. And how much gold there is.
export type Saucer = { model: Uint32Array<ArrayBuffer>; at: P3; axes: P3[]; out: P3; probes: number[] };
export type World = { cells: Uint32Array<ArrayBuffer>; col: Float32Array<ArrayBuffer>; veg: Float32Array<ArrayBuffer>; saucer: Saucer; gold: number };
export const MODEL: P3 = [48, 24, 48];
export const MODEL_AT: P3 = [24, 8, 24];

export type P3 = [number, number, number];

// ---------- what lies buried ----------
//
// Skeletons, standing in the rock as they stood: bone is rock of its own layer, so hard that the
// weather takes what is round it and leaves it. They are drawn here with two tools, a bone (every
// voxel within a radius of a line) and a knob (the skull), in the animal's own frame: x along
// it, nose first, y up, z across. Each is set a little way in behind one of the block's faces,
// side on to it, where taking that face off will find it.
function bury(cells: Uint32Array, seed: number): { saucer: Saucer; gold: number } {
  // what the tools draw with: the layer, its shade (-1: bone's own mottle), and whether they
  // draw in the open too, inside a hollow, or only where there is rock to turn
  const pen = { layer: EXTRA.BONE, shade: -1, air: false };
  // and what they draw on: the block, or for the saucer's model a small grid of its own
  const block = { cells, has: (x: number, y: number, z: number) => onBlock(x, z) && y >= GROUND_H && y < TOP, at: idx };
  let on = block;
  let gold = 0;
  const put = (x: number, y: number, z: number) => {
    if (!on.has(x, y, z)) return;
    const i = on.at(x, y, z);
    const t = on.cells[i] & 7;
    if (t !== ROCK && !(pen.air && t === AIR)) return;
    const shade = pen.shade >= 0 ? pen.shade : 2 + (hash3(x, y, z, seed + 31) < 0.3 ? 1 : 0);
    if (pen.layer === EXTRA.GOLD && ((on.cells[i] >> 3) & 31) !== EXTRA.GOLD) gold++;
    on.cells[i] = ROCK | (pen.layer << 3) | (shade << 8) | (on.cells[i] & 0x0fff0000);
  };
  const dig = (x: number, y: number, z: number) => {
    if (on.has(x, y, z)) on.cells[on.at(x, y, z)] = AIR;
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
  // a ball of bone, as wide, high and deep as `rad` (at this size a skull has no room for a hollow or for eye sockets)
  const knob = (f: Frame, c: P3, rad: P3) => {
    const m = Math.max(...rad) * f.k + 1;
    const C = f.at(c);
    for (let y = Math.floor(C[1] - m); y <= C[1] + m; y++) for (let z = Math.floor(C[2] - m); z <= C[2] + m; z++) for (let x = Math.floor(C[0] - m); x <= C[0] + m; x++) {
      const l = f.back([x, y, z]);
      if (Math.hypot((l[0] - c[0]) / rad[0], (l[1] - c[1]) / rad[1], (l[2] - c[2]) / rad[2]) <= 1) put(x, y, z);
    }
  };
  // ribs: hoops hung from the spine, wide at the shoulder and closing under the belly
  const ribs = (f: Frame, xs: number[], spine: (x: number) => number, wide: number, deep: number) => {
    // every other rib: at this size, closer than that and they run together into a slab
    for (const x of xs.filter((_, i) => i % 2 === 0)) {
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
    knob(f, [17.5, 19.5, 0], [4.2, 5.2, 3.6]);
    both(f, [[15, 15, 2.2], [19.5, 13.5, 1.8]], 0.9); // jaw
    // tusks: down and forward out of the face, then sweeping up and in
    both(f, [[19.5, 15.5, 2.2], [22.5, 10, 3.6], [26.5, 7, 4.6], [30.5, 8, 4.1], [33, 11.5, 2.6], [33.5, 14.5, 1.4]], 1.15, 0.7);
  };

  const longNeck = (f: Frame) => {
    chain(f, [[-36, 4, 0], [-29, 6.5, 0], [-20, 10, 0], [-10, 14, 0]], 0.7, 1.1); // tail
    chain(f, [[-10, 14, 0], [0, 16, 0], [10, 15, 0]], 1.2); // back
    chain(f, [[10, 15, 0], [17, 21, 0], [22.5, 28.5, 0], [26, 35.5, 0]], 1.1, 0.8); // neck
    knob(f, [28.6, 37, 0], [3, 2, 1.8]);
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
    knob(f, [19.5, 30, 0], [6, 3.6, 2.8]);
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

  // ---------- and what is not a skeleton ----------

  // a frame leaning over: y is its own up, tipped `lean` from upright towards the heading `to`
  const leaning = (c: P3, lean: number, to: number): Frame => {
    const [sl, cl, st, ct] = [Math.sin(lean), Math.cos(lean), Math.sin(to), Math.cos(to)];
    const axes: P3[] = [[cl * ct, -sl, cl * st], [sl * ct, cl, sl * st], [-st, 0, ct]];
    return {
      k: 1,
      at: (p) => [0, 1, 2].map((i) => c[i] + p[0] * axes[0][i] + p[1] * axes[1][i] + p[2] * axes[2][i]) as P3,
      back: (p) => axes.map((a) => (p[0] - c[0]) * a[0] + (p[1] - c[1]) * a[1] + (p[2] - c[2]) * a[2]) as P3,
    };
  };
  const box = (c: P3, m: number, each: (x: number, y: number, z: number) => void) => {
    for (let y = Math.floor(c[1] - m); y <= c[1] + m; y++) for (let z = Math.floor(c[2] - m); z <= c[2] + m; z++) for (let x = Math.floor(c[0] - m); x <= c[0] + m; x++) each(x, y, z);
  };

  // A flying saucer, where it came down, on a slant. A lens of metal with seams in it, lamps
  // round the rim, a glass dome, and under the dome a cabin, hollow and empty.
  const SAUCER = 20; // its radius
  const saucer = (f: Frame) => {
    box(f.at([0, 0, 0]), SAUCER + 2, (x, y, z) => {
      const [lx, h, lz] = f.back([x, y, z]);
      const r = Math.hypot(lx, lz);
      const dome = Math.hypot(r, h - 3); // from the middle of the ball the dome is the top of
      const lens = 1 - (r / SAUCER) ** 2;
      if (dome < 7 && h > 1.5) dig(x, y, z);
      else if (r <= SAUCER && h <= 1 + 4 * lens && h >= -0.8 - 3.2 * lens) {
        const turn = (Math.atan2(lz, lx) / (2 * Math.PI) + 0.5) * 12; // twelve lamps, twelve plates
        const lamp = r > SAUCER - 1.7 && Math.abs((turn % 1) - 0.5) < 0.2;
        const seam = Math.abs(r - 9.5) < 0.5 || Math.abs(r - 15) < 0.5 || (r > 9.5 && turn % 1 < 0.1);
        pen.layer = lamp ? EXTRA.LAMP : EXTRA.METAL;
        pen.shade = lamp ? Math.floor(turn) & 3 : seam ? 0 : 3; // a lamp's shade is its turn to be lit (render.wgsl)
        put(x, y, z);
      } else if (dome <= 8.5 && h > 0) {
        pen.layer = EXTRA.GLASS;
        put(x, y, z);
      }
    });
    Object.assign(pen, { layer: EXTRA.BONE, shade: -1, air: false });
  };
  // Round it, just clear of the hull: a ring off the rim, a ring over it and one under, the top
  // of the dome and the belly. In its own frame.
  const SAUCER_PROBES: P3[] = [[0, 13.5, 0], [0, -6.5, 0]];
  for (let k = 0; k < 12; k++) {
    const [c, sn] = [Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)];
    SAUCER_PROBES.push([c * (SAUCER + 2), 0, sn * (SAUCER + 2)]);
    if (k % 3 !== 2) SAUCER_PROBES.push([c * 11, k % 3 ? -6 : 8, sn * 11], [c * 11, k % 3 ? 8 : -6, sn * 11]);
  }

  // Gold: a vein, a thread wandering up through the beds and forking, a nugget here and there.
  // In the upper half of the block: not far to dig for from the top.
  const vein = (n: number) => {
    const q = (k: number) => hash2(900 + n * 100 + k, 77, seed);
    const f = frame(0, 0, 0, 0);
    let k = 10;
    const run = (from: P3, heading: number, steps: number) => {
      let p = from;
      for (let s = 0; s < steps; s++) {
        heading += (q(k++) - 0.5) * 1.6;
        const next: P3 = [p[0] + Math.cos(heading) * 5, p[1] + 0.5 + q(k++) * 3, p[2] + Math.sin(heading) * 5];
        bone(f, p, next, 0.6 + 0.5 * q(k++));
        if (q(k++) < 0.3) knob(f, next, [1.7, 1.5, 1.7]);
        if (steps > 5 && s % 3 === 2) run(next, heading + (q(k++) < 0.5 ? 1.3 : -1.3), 4);
        p = next;
      }
    };
    run([X0 + 16 + q(1) * (CUBE - 32), GROUND_H + 45 + q(2) * 35, Z0 + 16 + q(3) * (CUBE - 32)], q(4) * 6.28, 9);
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
    const f = frame(X0 + 8 + r(20 + k) * (CUBE - 16), GROUND_H + 6 + r(40 + k) * (CUBE - 14), Z0 + 8 + r(60 + k) * (CUBE - 16), r(80 + k) * 6.28);
    ammonite(f, 1.5 + r(100 + k) * 2);
  }

  pen.layer = EXTRA.GOLD;
  for (let n = 0; n < 3; n++) vein(n);
  // The saucer is behind one of the two far faces: nothing of it in a first look. A point `inn`
  // behind a far face, `along` it and `up`:
  const far = (face: number, along: number, inn: number, up: number): P3 =>
    face === 2 ? [GX / 2 + along, GROUND_H + up, Z0 + inn] : [X0 + inn, GROUND_H + up, GZ / 2 + along];
  const face = r(300) < 0.5 ? 2 : 3;
  // The saucer leans, and lies a little way in: the nearest of its rim is some voxels of rock
  // behind the face, nothing of it to be seen until that face has been worked on.
  const lean = 0.25 + r(301) * 0.2;
  const to = r(302) * 6.28;
  const out = face === 2 ? Math.sin(to) : Math.cos(to); // how much of the lean is towards the face
  const reach = SAUCER * Math.sqrt(1 - (Math.sin(lean) * out) ** 2); // how far the rim gets that way
  const lies = leaning(far(face, -5 + r(303) * 35, reach + 5 + r(308) * 7, 38 + r(304) * 46), lean, to);
  saucer(lies);

  // the saucer once more, upright and on its own, for when it flies
  const model = new Uint32Array(MODEL[0] * MODEL[1] * MODEL[2]);
  on = {
    cells: model,
    has: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < MODEL[0] && y < MODEL[1] && z < MODEL[2],
    at: (x, y, z) => x + MODEL[0] * (z + MODEL[2] * y),
  };
  pen.air = true;
  saucer(leaning(MODEL_AT, 0, 0));
  on = block;
  const at = lies.at([0, 0, 0]);
  const axes = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as P3[]).map((e) => lies.at(e).map((v, i) => v - at[i]) as P3);
  const probes = SAUCER_PROBES.map((q) => lies.at(q).map(Math.round) as P3)
    .filter(([x, y, z]) => x >= 0 && y >= 0 && z >= 0 && x < GX && y < GY && z < GZ)
    .map(([x, y, z]) => idx(x, y, z));
  return { saucer: { model, at, axes, out: face === 2 ? [0, 0, -1] : [-1, 0, 0], probes }, gold };
}

// ---------- how it starts ----------
//
// Not a bare block: a lake on top with a river running out of it both ways, cut into the rock and
// full to just under the brim, and grass. One level for all of the water, so it lies still until
// something disturbs it. The river stops short of the edges: over the side it would be gone.
function landscape(cells: Uint32Array, seed: number) {
  const col = new Float32Array(GX * GZ * 4);
  const veg = new Float32Array(GX * GZ * 4);
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
      if (x < X0 + 10 || z < Z0 + 10 || x > X0 + CUBE - 10 || z > Z0 + CUBE - 10) break;
      pts.push([x, z, t]);
    }
    arms.push(pts);
  }

  for (let z = 0; z < GZ; z++) {
    for (let x = 0; x < GX; x++) {
      const i = (x + GX * z) * 4;
      if (!onBlock(x, z)) { col[i + 2] = GROUND_H; continue; }
      // how deep the water has cut here, and how far it is to the water
      const shore = lr * (0.72 + 0.56 * vnoise(x / 9, z / 9, seed + 20));
      const dl = Math.hypot(x - lx, z - lz);
      let depth = dl < shore ? 1.4 + 5.6 * (1 - (dl / shore) ** 2) : 0;
      let away = dl - shore;
      const ragged = 0.8 * vnoise(x / 6, z / 6, seed + 21); // the river's banks are not straight
      for (const pts of arms) {
        for (const [px, pz, t] of pts) {
          const d = Math.hypot(x - px, z - pz);
          const w = 3.3 - 1.3 * t + ragged;
          if (d < w) depth = Math.max(depth, 0.9 + 2.6 * (1 - (d / w) ** 2));
          away = Math.min(away, d - w);
        }
      }
      const cut = Math.round(depth);
      for (let y = TOP - cut; y < TOP; y++) cells[idx(x, y, z)] = AIR;
      col[i] = cut > 0 ? cut - 0.7 : 0;
      col[i + 2] = TOP - cut;
      // what grows: a wood along the water, grass further off (only where there is soil: sim.wgsl grow)
      veg[i] = cut > 0 ? 0 : away < 12 ? 3 : away < 22 ? 0.9 : 0.5;
      veg[i + 1] = TOP - cut;
      veg[i + 2] = 1;
    }
  }
  return { col, veg };
}

// `bare`: only what lies buried, the rock gone from round it. To see what there is to find.
export function buildWorld(seed: number, bare = false): World {
  const cells = new Uint32Array(GX * GY * GZ);

  // the tray the block stands on: a round one, what of it the grid has room for
  for (let z = 0; z < GZ; z++) {
    for (let x = 0; x < GX; x++) {
      if (Math.hypot(x + 0.5 - GX / 2, z + 0.5 - GZ / 2) > TRAY) continue;
      for (let y = 0; y < GROUND_H; y++) cells[idx(x, y, z)] = GROUND | (EXTRA.GROUND_LAYER << 3);
    }
  }

  // which layer at which (warped) height
  const PAD = 16;
  const bandAt: number[] = [];
  for (const [layer, thick] of BANDS) for (let i = 0; i < thick; i++) bandAt.push(layer);

  const tiltX = (hash2(1, 2, seed) - 0.5) * 0.14;
  const tiltZ = (hash2(3, 4, seed) - 0.5) * 0.14;

  for (let z = Z0; z < Z0 + CUBE; z++) {
    for (let x = X0; x < X0 + CUBE; x++) {
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
      // weakness: lenses along the beds (flat: the noise is squeezed in y), big and small, and grain
      const lens = columnNoise(x / 11, z / 11, seed + 6);
      const fine = columnNoise(x / 4.5, z / 4.5, seed + 7);
      for (let y = GROUND_H; y < TOP; y++) {
        const yw = y - GROUND_H + warp + PAD;
        const layer = bandAt[Math.max(0, Math.min(bandAt.length - 1, Math.floor(yw)))];
        const shade = Math.floor(hash2(Math.floor(yw + lam), layer, seed + 5) * 4);
        const dist = y - GROUND_H + 1;
        const n = 0.55 * lens(yw / 4) + 0.3 * fine(yw / 2) + 0.15 * hash3(x, y, z, seed + 8);
        const rot = Math.max(0, Math.min(15, Math.round((n - 0.36) * 40)));
        cells[idx(x, y, z)] =
          ROCK | (layer << 3) | (shade << 8) | (weak ? 1 << 10 : 0) | (rot << 12) | (dist << 16);
      }
    }
  }
  const buried = bury(cells, seed);
  if (bare) {
    for (let i = 0; i < cells.length; i++) if ((cells[i] & 7) === ROCK && ((cells[i] >> 3) & 31) < 8) cells[i] = AIR;
    const col = new Float32Array(GX * GZ * 4);
    for (let i = 2; i < col.length; i += 4) col[i] = GROUND_H;
    return { cells, col, veg: new Float32Array(GX * GZ * 4), ...buried };
  }
  return { cells, ...landscape(cells, seed), ...buried };
}
