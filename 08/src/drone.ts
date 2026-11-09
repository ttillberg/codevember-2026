import * as THREE from 'three';
import type { V4 } from './tesseract';

// The drone as the drone sees itself: the state the cell camera reads.
//
// Inside its cell the drone lives in a plain cube. Cell space is an affine map c = A p + b from 4D to 3D: each row
// takes one of the cell's three free axes. Through a face the neighbouring cell continues straight on, as in a net,
// so when the drone crosses a face the row that mapped the face's axis is remade to map the axis that was held,
// pointing inward, and shifted by two cells. The camera keeps looking the way it was going; nothing jumps.
export const drone = {
  p: [0, 0, 0, 0] as V4,
  held: 0, // the coordinate held at ±1 in the current cell
  sign: 1,
  A: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as number[][],
  b: [0, 0, 0],
  axisOf: [1, 2, 3], // the 4D axis each cell-space row runs along
  centre: [0, 0, 0], // the current cell's centre in cell space
  crossings: 0,
  /** The corner camera: the drone's own eyes, or a chase camera behind it. A click on the frame swaps. */
  /** Someone at the controls: keys from the page, the device's orientation (its eye along -z) and speed, in cell
   * space. On its own it flies its legs; piloted it has momentum, thrust along the eye, yaw and pitch. */
  pilot: false,
  keys: { thrust: 0, strafe: 0 }, // held, -1 0 1: along the eye, and across it to the right
  /** The look from the trackpad: radians to turn right and up, gathered by the page, spent by the device each frame. */
  turn: [0, 0],
  q: new THREE.Quaternion(),
  cvel: [0, 0, 0],
  /** The walls round the body, 0 open to 1 shut, and the shutter over the eye, same scale; the cam's copy follows. */
  shield: 0,
  shutter: 0,
  /** The grip out in front of the eye, 0 home to 1 out with the claws shut, and how far out the ring must go, in
   * device radii, to be on the piece. */
  grip: 0,
  gripAt: 1.83,
  /** The piece just taken: how big it still is (0 once swallowed), where it was in 4D and in which cell, and how far
   * it has been drawn from there into the ring, 0 to 1. */
  taken: 0,
  grab4: [0, 0, 0, 0] as V4,
  grabMap: null as CellMap | null,
  grabK: 0,
  /** The face being passed: its four corners in 4D and how hard it is lit, 0 to 1. */
  /** The wall just gone through: its corners, where it was crossed, in 4D, seconds since (none, -1), and the colour
   * of the cell entered. It ripples out from the crossing, like a wave from a button pressed. */
  flash: { corners: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as V4[], p4: [0, 0, 0, 0] as V4, t: -1, color: '#c9e35b' },
};

/** The piece: a small steel ball with a pinhead lamp on each axis, six, flashing fast. `blink(t)` runs them. */
export const PIECE_R = 0.02;
// the lamps' colour is the colour of the cell the piece is in; one material in the fog, one out of it for the eye
const lampMats = [true, false].map((fog) => new THREE.MeshStandardMaterial({ color: '#ff6a3a', emissive: '#ff6a3a', emissiveIntensity: 0, toneMapped: false, fog }));
export function lampColor(hex: string) { for (const m of lampMats) { m.color.set(hex); m.emissive.set(hex); } }
/** `fog` off, the piece shows through the rooms' haze, for the eye's view, where the rooms beyond fade. */
export function pieceMesh(scale = 1, fog = true) {
  const g = new THREE.Group();
  const r = PIECE_R * scale;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: '#d4d4d8', roughness: 0.3, metalness: 0.95, fog })));
  const lampGeo = new THREE.SphereGeometry(r * 0.2, 8, 6);
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const lamp = new THREE.Mesh(lampGeo, lampMats[fog ? 0 : 1]);
    lamp.position.set(x * r * 0.96, y * r * 0.96, z * r * 0.96);
    g.add(lamp);
  }
  return g;
}
/** The lamp: a quick double flash every half second or so. */
export function blink(t: number) {
  const u = t % 0.7;
  const on = (u < 0.06 || (u > 0.14 && u < 0.2)) ? 5 : 0;
  for (const m of lampMats) m.emissiveIntensity = on;
}

export const RIPPLE = 1.1; // seconds a wall's ripple lasts

const RIPPLE_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RIPPLE_FRAG = /* glsl */ `
  uniform vec3 uColor, uCentre;
  uniform float uT, uSize, uDur;
  varying vec3 vPos;
  void main() {
    if (uT < 0.0) discard;
    float u = uT / uDur;
    float dn = distance(vPos, uCentre) / uSize; // 1 at the far side of the wall, about
    float r = 1.6 * u;
    float ring = exp(-pow((dn - r) / 0.07, 2.0));
    float fill = (1.0 - smoothstep(r - 0.4, r, dn)) * 0.4;
    float a = (ring * 0.9 + fill) * pow(1.0 - u, 1.5) * 0.8;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

/** A flat square between four points, redrawn every frame, with a ripple of colour running out from a point on it. */
export function faceQuad() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#c9e35b') }, uCentre: { value: new THREE.Vector3() }, uT: { value: -1 }, uSize: { value: 1 }, uDur: { value: RIPPLE } },
    vertexShader: RIPPLE_VERT, fragmentShader: RIPPLE_FRAG,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  return {
    mesh, mat,
    set: (i: number, v: THREE.Vector3) => pos.setXYZ(i, v.x, v.y, v.z),
    done: () => { pos.needsUpdate = true; },
    /** The ripple: out from `centre`, over a wall `size` across to its far side, `t` seconds in (none, below 0). */
    pulse(centre: THREE.Vector3, size: number, t: number, hex: string) {
      mesh.visible = t >= 0;
      mat.uniforms.uCentre.value.copy(centre);
      mat.uniforms.uSize.value = size;
      mat.uniforms.uT.value = t;
      (mat.uniforms.uColor.value as THREE.Color).set(hex);
    },
  };
}

/** Start in the cell with `held` at `sign`: rows are the free axes in order. */
export function startCell(held: number, sign: number) {
  drone.held = held; drone.sign = sign;
  drone.axisOf = [0, 1, 2, 3].filter((a) => a !== held);
  drone.A = drone.axisOf.map((a) => [0, 1, 2, 3].map((i) => (i === a ? 1 : 0)));
  drone.b = [0, 0, 0];
  drone.centre = [0, 0, 0];
}

export type CellMap = { held: number; sign: number; A: number[][]; b: number[]; axisOf: number[]; centre: number[] };

/** The crossing rule: through the face where row `k`'s axis is `t` (in 4D), the new cell holds that axis and frees
 * the axis that was held, inward, two rooms on in cell space. The row may run its axis backwards, so the side of the
 * room the wall is on is `t` times the row's sign; the next room is on that side, and the freed axis runs in from it. */
function crossRow(c: CellMap, k: number, t: number) {
  const f = c.axisOf[k];
  const old = c.held, s = c.sign;
  const side = t * c.A[k][f];
  c.A[k] = [0, 1, 2, 3].map((i) => (i === old ? -side * s : 0));
  c.b[k] = c.centre[k] + 2 * side;
  c.centre[k] += 2 * side;
  c.axisOf[k] = old;
  c.held = f; c.sign = t;
}

/** The cells, numbered by held axis and side: 0..7, and a colour and a name for each, for the trail and the readout. */
export const cellIdOf = (map: { held: number; sign: number }) => map.held * 2 + (map.sign > 0 ? 1 : 0);
export const cellId = () => cellIdOf(drone);
export const CELL_HEX = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d87'];
export const cellName = () => `${drone.sign > 0 ? '+' : '\u2212'}${'xyzw'[drone.held]}`;

/** Cross the face on axis `f` at side `t`: the new cell holds f, and frees the axis that was held. */
export function crossInto(f: number, t: number) {
  const k = drone.axisOf.indexOf(f);
  if (k < 0) return; // the held axis has no wall to cross
  crossRow(drone, k, t);
  drone.crossings++;
}

/** Where a 4D point is in cell space. */
export function toCell(p: V4, out: number[] = [0, 0, 0]): number[] {
  for (let k = 0; k < 3; k++) out[k] = drone.A[k][0] * p[0] + drone.A[k][1] * p[1] + drone.A[k][2] * p[2] + drone.A[k][3] * p[3] + drone.b[k];
  return out;
}

/** Back from cell space: the held coordinate on its wall, each row's axis from its row. Rows hold one ±1 each. */
export function fromCell(c: number[], out: V4 = [0, 0, 0, 0]): V4 {
  out[drone.held] = drone.sign;
  for (let k = 0; k < 3; k++) { const a = drone.axisOf[k]; out[a] = (c[k] - drone.b[k]) / drone.A[k][a]; }
  return out;
}

/** A direction in cell space back to 4D under a map: nothing along its held axis, each row's axis from its row. */
export function dirFromCellWith(map: CellMap, c: number[], out: V4 = [0, 0, 0, 0]): V4 {
  out[map.held] = 0;
  for (let k = 0; k < 3; k++) { const a = map.axisOf[k]; out[a] = c[k] / map.A[k][a]; }
  return out;
}
export const dirFromCell = (c: number[], out?: V4) => dirFromCellWith(drone, c, out);

/** A map crossed through the wall where 4D axis `axis` is `sign`: the cell on the other side, as the net sees it. */
export function mapAcross(map: CellMap, axis: number, sign: number): CellMap {
  const c: CellMap = { held: map.held, sign: map.sign, A: map.A.map((r) => r.slice()), b: map.b.slice(), axisOf: map.axisOf.slice(), centre: map.centre.slice() };
  const k = map.axisOf.indexOf(axis);
  if (k >= 0) crossRow(c, k, sign); // the held axis has no wall of its own; then the copy is this cell
  return c;
}
/** The map of the cell on the other side of the wall where 4D axis `axis` is `sign`: the current map crossed there. */
export const otherMap = (axis: number, sign: number) => mapAcross(drone, axis, sign);

/** Where a 4D point is in a map's cell space. */
export function toCellWith(map: CellMap, p: V4, out: number[] = [0, 0, 0]): number[] {
  for (let k = 0; k < 3; k++) out[k] = map.A[k][0] * p[0] + map.A[k][1] * p[1] + map.A[k][2] * p[2] + map.A[k][3] * p[3] + map.b[k];
  return out;
}

/** The piece the device goes for: a bit of metal in a cell two walls away. `up` while it is there to be had; `scale`
 * grows as it emerges and shrinks as it is taken; `map` is its cell's map, for the cam, fixed when it is set. */
export const target = {
  p: [0, 0, 0, 0] as V4,
  up: false,
  scale: 0,
  map: null as CellMap | null,
};

/** The four joints of the wall on row `k`, side `t`, of the current cell, in 4D. */
export function wallCorners(k: number, t: number): V4[] {
  const a = drone.axisOf[k], side = t * drone.A[k][a];
  const free = [0, 1, 2, 3].filter((i) => i !== a && i !== drone.held);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const c: V4 = [0, 0, 0, 0];
    c[drone.held] = drone.sign; c[a] = side; c[free[0]] = u; c[free[1]] = v;
    return c;
  });
}
