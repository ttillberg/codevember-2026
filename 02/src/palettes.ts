import { Vec3 } from './math';

export interface Palette {
  id: string;
  name: string;
  /** Absorption tint colors (linear RGB, 0..1 transmittance targets) */
  bottom: Vec3;   // lower zone & bevels (e.g. burnt vermilion-orange)
  core: Vec3;     // warm inner heart (e.g. chartreuse / golden yellow)
  top: Vec3;      // upper & outer crown (e.g. smoky sapphire / steel-blue)
  edge: Vec3;     // thick edge deep accent (e.g. deep cobalt / indigo)
  /** Absorption density scale */
  density: number;
}

/**
 * Palettes inspired by Venetian Sommerso architectural glass.
 * Default ("Sommerso") matches the amber/vermilion base, golden-chartreuse heart,
 * and smoky sapphire-blue upper glass of the studio reference.
 */
export const PALETTES: Palette[] = [
  {
    id: 'crystal',
    name: 'Crystal',
    bottom: [0.955, 0.968, 0.982],
    core: [0.988, 0.993, 0.998],
    top: [0.945, 0.962, 0.982],
    edge: [0.64, 0.68, 0.74],
    density: 0.72,
  },
  {
    id: 'sommerso',
    name: 'Sommerso',
    bottom: [0.98, 0.20, 0.015],
    core: [0.92, 0.88, 0.04],
    top: [0.12, 0.44, 0.84],
    edge: [0.03, 0.11, 0.28],
    density: 3.6,
  },
  {
    id: 'solstice',
    name: 'Solstice',
    bottom: [0.96, 0.08, 0.24],
    core: [0.98, 0.72, 0.08],
    top: [0.08, 0.64, 0.74],
    edge: [0.04, 0.15, 0.28],
    density: 3.4,
  },
  {
    id: 'forest',
    name: 'Verdigris',
    bottom: [0.90, 0.44, 0.02],
    core: [0.56, 0.88, 0.16],
    top: [0.05, 0.44, 0.50],
    edge: [0.02, 0.12, 0.20],
    density: 3.5,
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    bottom: [0.72, 0.12, 0.78],
    core: [0.96, 0.46, 0.54],
    top: [0.12, 0.34, 0.92],
    edge: [0.04, 0.08, 0.32],
    density: 3.4,
  },
];

/** CPU mirror of the WGSL Sommerso colour lookup (used to tint GPU splinters at spawn). */
export function samplePaletteColor(localPos: Vec3, halfSize: Vec3, pal: Palette): Vec3 {
  const nx = localPos[0] / Math.max(0.01, halfSize[0]);
  const ny = localPos[1] / Math.max(0.01, halfSize[1]); // -1 bottom .. +1 top
  const nz = localPos[2] / Math.max(0.01, halfSize[2]);
  const r2 = Math.min(1.5, Math.hypot(nx, nz));

  // Smooth vertical bands: vermilion/orange base -> chartreuse inner belly -> sapphire upper glass
  const tBase = smoothstep(-0.18, -0.58, ny + 0.16 * r2 * r2);
  const tCore = Math.exp(-Math.pow((ny + 0.08) / 0.48, 2)) * Math.exp(-r2 * r2 * 0.75);
  const tTop = smoothstep(-0.25, 0.65, ny);

  let r = pal.top[0] * (0.45 + 0.55 * tTop) + pal.core[0] * tCore * 0.75;
  let g = pal.top[1] * (0.45 + 0.55 * tTop) + pal.core[1] * tCore * 0.75;
  let b = pal.top[2] * (0.45 + 0.55 * tTop) + pal.core[2] * tCore * 0.75;

  // Blend core dominance in inner belly
  const cMix = Math.min(0.88, tCore * 0.95);
  r = r * (1 - cMix) + pal.core[0] * cMix;
  g = g * (1 - cMix) + pal.core[1] * cMix;
  b = b * (1 - cMix) + pal.core[2] * cMix;

  // Blend fiery base at bottom & lower outer facets
  r = r * (1 - tBase) + pal.bottom[0] * tBase;
  g = g * (1 - tBase) + pal.bottom[1] * tBase;
  b = b * (1 - tBase) + pal.bottom[2] * tBase;

  return [Math.min(1, Math.max(0.02, r)), Math.min(1, Math.max(0.02, g)), Math.min(1, Math.max(0.02, b))];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
