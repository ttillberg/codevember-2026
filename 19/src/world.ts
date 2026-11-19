// The block of rock: a voxel grid, one u32 per cell.
//
//   bits 0-2    type: air, water, sediment, rock, ground
//   bits 3-6    layer, the colour and the hardness (LAYERS)
//   bits 8-9    shade, the lamination: thin lighter and darker beds inside a layer
//   bit  10     weak: a vertical joint, wears four times as fast
//   bits 12-15  water only: energy, 15 when it just fell, 0 when it has been still
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

export function buildWorld(seed: number): Uint32Array<ArrayBuffer> {
  const cells = new Uint32Array(GX * GY * GZ);

  // the plinth
  cells.fill(GROUND | (GROUND_LAYER << 3), 0, GX * GZ * GROUND_H);

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
        cells[x + GX * (z + GZ * y)] =
          ROCK | (layer << 3) | (shade << 8) | (weak ? 1 << 10 : 0) | (dist << 16);
      }
    }
  }
  return cells;
}
