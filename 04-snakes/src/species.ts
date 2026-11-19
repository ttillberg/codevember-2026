// The eight snakes as data: size, scales, colour. Lengths in metres.
// Two head shapes are modelled in Blender (model/heads.py): a python's (the boids: green tree,
// ball, carpet, Burmese) and a colubrid's (corn, king, milk, garter). Each species paints its own
// colours on its family's head, and its own pattern on the body (skin.ts, by `pattern`).
export type Shape = 'python' | 'corn';
type RGB = [number, number, number];

export interface Species {
  name: string;
  /** whose head: the GLB modelled for that family */
  shape: Shape;
  length: number; // neck to tail tip (set from the track)
  radius: number; // thickest: the size its family's head is modelled at
  neck: number; // at the head, the Blender head's neck ring
  headLength: number;
  headWidth: number; // half
  vent: number; // where the tail starts, 0..1 along the body
  rows: number; // dorsal scale rows round the body
  scaleAspect: number; // scale length / width
  ventralWidth: number; // fraction of the girth the belly plates cover
  speed: number; // m/s crawling
  lift: number; // how high it raises its head
  // look
  pattern: number; // which body pattern in skin.ts
  iridescence: number;
  roughness: number;
  clearcoat: number;
  /** the skin between scales, where a bend parts them (sRGB 0..255) */
  bare: RGB;
  /** iris, centre to rim; a vertical slit or a round pupil; pupil colour, black but for the albino.
   * Eye and tongue colours are linear, times 255 */
  eye: { inner: RGB; outer: RGB; slit: boolean; pupil?: RGB };
  tongue: RGB;
  seed?: number; // this one snake's scales and markings
}

const PY = {
  shape: 'python' as const, length: 1, radius: 0.0215, neck: 0.0122, headLength: 0.056, headWidth: 0.02,
  vent: 0.94, scaleAspect: 1.15, ventralWidth: 0.22, speed: 0.018, lift: 0.07,
};
const CO = {
  shape: 'corn' as const, length: 1, radius: 0.0165, neck: 0.0098, headLength: 0.034, headWidth: 0.0122,
  vent: 0.93, scaleAspect: 1.3, ventralWidth: 0.26, speed: 0.022, lift: 0.05,
};

/** largest first in each family: the thickest tracks get the biggest snakes */
export const BOIDS: Species[] = [
  {
    ...PY, name: 'burmese', pattern: 4, rows: 80, iridescence: 0.18, roughness: 0.32, clearcoat: 0.35,
    bare: [236, 222, 196], eye: { inner: [200, 60, 70], outer: [120, 20, 30], slit: true, pupil: [90, 6, 14] }, tongue: [150, 40, 50],
  },
  {
    ...PY, name: 'ball', pattern: 2, rows: 70, iridescence: 0.12, roughness: 0.36, clearcoat: 0.3,
    bare: [120, 96, 70], eye: { inner: [30, 22, 14], outer: [8, 6, 4], slit: true }, tongue: [10, 10, 12],
  },
  {
    ...PY, name: 'python', pattern: 0, rows: 96, iridescence: 0.22, roughness: 0.4, clearcoat: 0.3,
    bare: [120, 150, 96], eye: { inner: [107, 115, 84], outer: [51, 61, 38], slit: true }, tongue: [5, 5, 6],
  },
  {
    ...PY, name: 'carpet', pattern: 3, rows: 64, iridescence: 0.1, roughness: 0.34, clearcoat: 0.32,
    bare: [150, 130, 70], eye: { inner: [120, 80, 30], outer: [30, 20, 8], slit: true }, tongue: [8, 8, 10],
  },
];
export const COLUBRIDS: Species[] = [
  {
    ...CO, name: 'king', pattern: 5, rows: 34, iridescence: 0.05, roughness: 0.26, clearcoat: 0.5,
    bare: [150, 140, 126], eye: { inner: [24, 16, 10], outer: [6, 4, 3], slit: false }, tongue: [12, 10, 10],
  },
  {
    ...CO, name: 'corn', pattern: 1, rows: 40, iridescence: 0, roughness: 0.3, clearcoat: 0.45,
    bare: [196, 176, 156], eye: { inner: [158, 56, 15], outer: [64, 18, 8], slit: false }, tongue: [64, 4, 5],
  },
  {
    ...CO, name: 'milk', pattern: 6, rows: 32, iridescence: 0, roughness: 0.24, clearcoat: 0.55,
    bare: [170, 150, 130], eye: { inner: [14, 10, 8], outer: [4, 3, 2], slit: false }, tongue: [16, 8, 8],
  },
  {
    ...CO, name: 'garter', pattern: 7, rows: 26, iridescence: 0, roughness: 0.38, clearcoat: 0.35,
    bare: [150, 150, 110], eye: { inner: [90, 60, 20], outer: [20, 14, 6], slit: false }, tongue: [150, 20, 24],
  },
];
