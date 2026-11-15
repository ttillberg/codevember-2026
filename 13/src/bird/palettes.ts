import * as THREE from 'three';

// Colour turns of the magpie's own plumage: for each of gorget, crown, body
// pigment and body sheen, a hue turn (degrees, round the grey axis), a
// saturation and a value. Applied in the feather shader through
// PlumageUniforms.uPal, so a change is free and can blend. Black and white do
// not turn, so these only change the gloss on the wings and tail.

type Turn = [hue: number, sat: number, val: number];

export interface Palette {
  name: string;
  gorget: Turn;
  crown: Turn;
  body: Turn;
  sheen: Turn;
}

export const PALETTES: Palette[] = [
  { name: 'Blue gloss', gorget: [0, 1, 1], crown: [0, 1, 1], body: [0, 1, 1], sheen: [0, 1, 1] },
  { name: 'Green gloss', gorget: [0, 1, 1], crown: [0, 1, 1], body: [-55, 0.9, 1], sheen: [-55, 1, 1] },
  { name: 'Violet gloss', gorget: [0, 1, 1], crown: [0, 1, 1], body: [40, 0.9, 1], sheen: [40, 1, 1] },
  { name: 'Plain ink', gorget: [0, 1, 1], crown: [0, 1, 1], body: [0, 0.1, 0.8], sheen: [0, 0.1, 1] },
];

const L = [0.2126, 0.7152, 0.0722];

/** hue turn round the grey axis, then saturation about luminance, then value */
export function turnMatrix([hue, sat, val]: Turn, out = new THREE.Matrix3()) {
  const a = THREE.MathUtils.degToRad(hue);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 / 3;
  const q = Math.sqrt(k);
  // Rodrigues about (1,1,1)/√3: red → green → blue as the hue rises
  const rot = new THREE.Matrix3().set(
    c + k * (1 - c), k * (1 - c) - q * s, k * (1 - c) + q * s,
    k * (1 - c) + q * s, c + k * (1 - c), k * (1 - c) - q * s,
    k * (1 - c) - q * s, k * (1 - c) + q * s, c + k * (1 - c),
  );
  const g = 1 - sat;
  const satM = new THREE.Matrix3().set(
    L[0] * g + sat, L[1] * g, L[2] * g,
    L[0] * g, L[1] * g + sat, L[2] * g,
    L[0] * g, L[1] * g, L[2] * g + sat,
  );
  return out.multiplyMatrices(satM, rot).multiplyScalar(val);
}

export function paletteMatrices(p: Palette): THREE.Matrix3[] {
  return [turnMatrix(p.gorget), turnMatrix(p.crown), turnMatrix(p.body), turnMatrix(p.sheen)];
}
