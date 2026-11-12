import * as THREE from 'three';

// Other hummingbirds, as colour turns of the mountain-gem's own plumage: for
// each of gorget, crown, body pigment and body sheen, a hue turn (degrees,
// round the grey axis), a saturation and a value. Applied in the feather
// shader through PlumageUniforms.uPal, so a change is free and can blend.

type Turn = [hue: number, sat: number, val: number];

export interface Palette {
  name: string;
  gorget: Turn;
  crown: Turn;
  body: Turn;
  sheen: Turn;
}

export const PALETTES: Palette[] = [
  { name: 'Purple-throated mountain-gem', gorget: [0, 1, 1], crown: [0, 1, 1], body: [0, 1, 1], sheen: [0, 1, 1] },
  { name: 'Ruby-throated', gorget: [102, 1.3, 0.78], crown: [-45, 0.95, 0.9], body: [170, 0.55, 1.05], sheen: [0, 0.08, 1.9] },
  { name: "Anna's", gorget: [55, 1.05, 1.1], crown: [150, 1.05, 1.05], body: [175, 0.5, 1.1], sheen: [150, 0.4, 1.0] },
  { name: 'Sapphire-throated', gorget: [-28, 1.3, 0.6], crown: [105, 1, 1], body: [150, 0.75, 1], sheen: [32, 1.15, 1] },
  { name: 'Fiery-throated', gorget: [116, 1.25, 0.82], crown: [55, 1, 0.95], body: [185, 0.7, 0.95], sheen: [-92, 1.2, 1.15] },
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
