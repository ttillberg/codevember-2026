import * as THREE from 'three';
import { isFold, type House, type Sheet, type V2 } from './net';
import { sheetSvg } from './art';

// The card in 3D. Everything lives in sheet space (mm, y up, print on +z) under one root,
// which lays the sheet face up on the mat. Each panel is its own group so it can fold;
// the waste is the sheet with the net as a hole.

export const THICK = 0.35;
// the cut line is a scored groove this wide: the piece and the frame stop short of it,
// a thin membrane of card bridges it until it pops
export const GAP = 1;

// move some edges of a convex CCW polygon inwards (off[i] for edge i → i+1), corners re-met
function inset(poly: V2[], off: number[]): V2[] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    return { px: a[0] - dy * off[i], py: a[1] + dx * off[i], dx, dy };
  });
  return poly.map((_, i) => meet(lines[(i + n - 1) % n], lines[i]));
}

// offset a CCW loop outwards by d, mitred
function grow(loop: V2[], d: number): V2[] {
  return inset(loop, loop.map(() => -d));
}

function meet(l: { px: number; py: number; dx: number; dy: number }, m: { px: number; py: number; dx: number; dy: number }): V2 {
  const den = l.dx * m.dy - l.dy * m.dx;
  if (Math.abs(den) < 1e-9) return [m.px, m.py];
  const t = ((m.px - l.px) * m.dy - (m.py - l.py) * m.dx) / den;
  return [l.px + l.dx * t, l.py + l.dy * t];
}

const shape = (poly: V2[]) => new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));

// back: the blank side, only its fold lines scored in, for whoever folds it.
// Returned at once, drawn when the SVG has decoded (a frame or two).
export function printTexture(house: House, sheet: Sheet, renderer: THREE.WebGLRenderer, back = false) {
  const max = renderer.capabilities.maxTextureSize;
  const pxPerMm = Math.min(back ? 6 : 12, max / Math.max(sheet.w, sheet.h));
  const { svg, W, H } = sheetSvg(house, sheet, pxPerMm, back);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = back ? '#f6f3ec' : '#fbf9f4';
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // shape UVs are sheet mm: map them onto the sheet
  tex.repeat.set(1 / sheet.w, 1 / sheet.h);
  tex.offset.set(-sheet.x / sheet.w, -sheet.y / sheet.h);
  const img = new Image();
  img.onload = () => { g.drawImage(img, 0, 0, W, H); tex.needsUpdate = true; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return tex;
}

export function makePaper(house: House, sheet: Sheet, loop: V2[], tex: THREE.Texture, backTex: THREE.Texture) {
  // extrude groups: 0 the caps (the top one is under the print, so: the back), 1 the cut edges
  const body = [
    new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: '#f6f3ec', roughness: 0.92 }),
  ];
  const print = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.82,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });

  // one sheet of card: an extruded body (white core and edges) and a printed skin on top
  const card = (s: THREE.Shape) => {
    const g = new THREE.Group();
    const solid = new THREE.ExtrudeGeometry(s, { depth: THICK, bevelEnabled: false, curveSegments: 1 });
    solid.translate(0, 0, -THICK);
    const m = new THREE.Mesh(solid, body);
    m.castShadow = m.receiveShadow = true;
    const skin = new THREE.Mesh(new THREE.ShapeGeometry(s, 1), print);
    skin.receiveShadow = true;
    g.add(m, skin);
    return g;
  };

  // sheet space → world: x → x, y → -z, print (+z) → up; centred, resting on the mat
  const root = new THREE.Group();
  const cx = sheet.x + sheet.w / 2;
  const cy = sheet.y + sheet.h / 2;
  root.matrix.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  root.matrix.setPosition(-cx, THICK, cy);
  root.matrixAutoUpdate = false;

  // the piece: one group per panel, folded later by setting their matrices
  const piece = new THREE.Group();
  const panels = new Map<string, THREE.Group>();
  for (const p of house.panels) {
    const n = p.poly.length;
    const off = p.poly.map((a, i) => (isFold(house, p, a, p.poly[(i + 1) % n]) ? 0 : GAP / 2));
    const g = card(shape(inset(p.poly, off)));
    g.matrixAutoUpdate = false;
    g.name = p.id;
    panels.set(p.id, g);
    piece.add(g);
  }

  const waste = new THREE.Group();
  const frame = shape([[sheet.x, sheet.y], [sheet.x + sheet.w, sheet.y], [sheet.x + sheet.w, sheet.y + sheet.h], [sheet.x, sheet.y + sheet.h]]);
  frame.holes.push(new THREE.Path(grow(loop, GAP / 2).map(([x, y]) => new THREE.Vector2(x, y))));
  waste.add(card(frame));

  root.add(piece, waste);

  // where the root lies: rest is its orientation (flips add up), place() moves it off that,
  // turned about a pivot and raised
  const rest = root.matrix.clone();
  const rx = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const X = new THREE.Vector3(1, 0, 0);
  const place = (theta = 0, pivot = new THREE.Vector3(), up = 0, axis = X) => {
    root.matrix
      .makeTranslation(pivot.x, pivot.y + up, pivot.z)
      .multiply(rx.makeRotationAxis(axis, theta))
      .multiply(tmp.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .multiply(rest);
  };
  const settleRest = () => rest.copy(root.matrix);
  const getRest = () => rest.clone();
  const setRest = (m: THREE.Matrix4) => rest.copy(m);
  const home = root.matrix.clone();
  const resetRest = () => { rest.copy(home); root.matrix.copy(home); };

  // the pointer: a world ray, met with the sheet's own plane
  const inv = new THREE.Matrix4();
  const hit = (ray: THREE.Ray): V2 | null => {
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    const r = ray.clone().applyMatrix4(inv);
    if (Math.abs(r.direction.z) < 1e-6) return null;
    const t = -r.origin.z / r.direction.z;
    return [r.origin.x + r.direction.x * t, r.origin.y + r.direction.y * t];
  };
  const toWorld = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z).applyMatrix4(root.matrix);

  // the net alone: what the camera frames while the sheet is whole, its margin may run off screen
  const netBox = new THREE.Box3().setFromPoints(loop.map(([x, y]) => toWorld(x, y)));
  netBox.max.y = 2;

  return { root, piece, panels, waste, hit, toWorld, netBox, place, settleRest, resetRest, getRest, setRest };
}
export type Paper = ReturnType<typeof makePaper>;
