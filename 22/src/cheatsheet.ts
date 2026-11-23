import * as THREE from 'three';

/**
 * A dog-eared sheet of lined school notebook paper resting on the desk right in front
 * of the Commodore 1702 monitor, hand-scribbled in blue & red ballpoint pen by an 8-year-old.
 * Shares its high-res canvas between the 3D desk mesh and the close-up reader overlay.
 */
export class DeskCheatPaper {
  readonly root = new THREE.Group();
  readonly hitMesh: THREE.Mesh;
  readonly canvas: HTMLCanvasElement;

  private hovered = false;
  private lift = 0;
  private readonly baseY = 0.012;

  constructor() {
    this.canvas = renderCheatSheetCanvas();
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    // Slightly wide torn notebook sheet sitting right in front of the monitor
    const W = 1.92;
    const H = 2.28;
    const geo = new THREE.PlaneGeometry(W, H, 18, 22);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const nx = x / (W * 0.5);
      const nz = z / (H * 0.5);
      // Soft center fold + gently curled dog-eared bottom-right corner
      const crease = Math.exp(-nz * nz * 20) * 0.016;
      const cornerDist = Math.max(0, nx + nz - 1.04);
      const cornerCurl = cornerDist * cornerDist * 0.16;
      const edgeLift = Math.max(0, -nz - 0.72) * 0.035;
      const wave = Math.sin(nx * 2.1 + 0.4) * 0.006 + Math.cos(nz * 2.5) * 0.005;
      pos.setY(i, crease + cornerCurl + edgeLift + wave);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.hit = { kind: 'paper' };
    this.root.add(mesh);
    this.hitMesh = mesh;

    // Resting naturally on the left side of the desk beside the C64 keyboard & monitor
    this.root.scale.setScalar(0.86);
    this.root.position.set(-2.96, this.baseY, 2.25);
    this.root.rotation.y = 0.16;
  }

  setHovered(on: boolean) {
    this.hovered = on;
  }

  update(dt: number) {
    const target = this.hovered ? 1 : 0;
    this.lift += (target - this.lift) * Math.min(1, dt * 12);
    this.root.position.y = this.baseY + this.lift * 0.045;
    this.root.rotation.x = -this.lift * 0.04;
  }
}

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) & 0xffff) / 0x10000;
  };
}

// Smooth Catmull-Rom curve control points in [0..1] x [0..1] (0=cap top, 1=baseline, >1=descender)
// Mixed-case kid printing: rounded loopy lowercase + bouncy uppercase!
type Stroke = [number, number][];
const GLYPHS: Record<string, { w: number; s: Stroke[] }> = {
  // Lowercase (genuine rounded kid printing)
  a: { w: 0.58, s: [[[0.78, 0.46], [0.50, 0.36], [0.20, 0.50], [0.16, 0.78], [0.36, 0.98], [0.66, 0.92], [0.80, 0.62]], [[0.78, 0.40], [0.76, 0.76], [0.84, 0.98]]] },
  b: { w: 0.58, s: [[[0.20, 0.02], [0.18, 0.55], [0.20, 0.98]], [[0.20, 0.52], [0.50, 0.38], [0.80, 0.54], [0.78, 0.84], [0.50, 0.99], [0.20, 0.92]]] },
  c: { w: 0.52, s: [[[0.82, 0.48], [0.56, 0.36], [0.24, 0.48], [0.16, 0.74], [0.30, 0.96], [0.64, 0.98], [0.86, 0.86]]] },
  d: { w: 0.60, s: [[[0.76, 0.48], [0.48, 0.38], [0.20, 0.52], [0.16, 0.80], [0.38, 0.98], [0.68, 0.92], [0.78, 0.68]], [[0.80, 0.02], [0.78, 0.56], [0.82, 0.98]]] },
  e: { w: 0.56, s: [[[0.20, 0.66], [0.54, 0.64], [0.82, 0.56], [0.76, 0.40], [0.48, 0.36], [0.20, 0.52], [0.18, 0.80], [0.40, 0.98], [0.76, 0.92]]] },
  f: { w: 0.44, s: [[[0.80, 0.14], [0.58, 0.02], [0.38, 0.16], [0.36, 0.58], [0.38, 0.98]], [[0.14, 0.46], [0.48, 0.44], [0.78, 0.44]]] },
  g: { w: 0.58, s: [[[0.78, 0.46], [0.48, 0.36], [0.20, 0.52], [0.20, 0.80], [0.46, 0.96], [0.76, 0.82]], [[0.78, 0.42], [0.76, 0.92], [0.64, 1.24], [0.36, 1.32], [0.14, 1.18]]] },
  h: { w: 0.58, s: [[[0.20, 0.02], [0.18, 0.55], [0.20, 0.98]], [[0.20, 0.62], [0.42, 0.40], [0.70, 0.44], [0.80, 0.70], [0.82, 0.98]]] },
  i: { w: 0.28, s: [[[0.48, 0.42], [0.48, 0.72], [0.52, 0.98]], [[0.46, 0.16], [0.52, 0.20]]] },
  k: { w: 0.56, s: [[[0.20, 0.02], [0.18, 0.54], [0.20, 0.98]], [[0.78, 0.42], [0.44, 0.62], [0.22, 0.70]], [[0.40, 0.64], [0.64, 0.84], [0.84, 0.98]]] },
  l: { w: 0.28, s: [[[0.46, 0.02], [0.46, 0.56], [0.50, 0.96], [0.64, 0.98]]] },
  m: { w: 0.82, s: [[[0.12, 0.40], [0.12, 0.72], [0.14, 0.98]], [[0.14, 0.56], [0.30, 0.38], [0.46, 0.52], [0.48, 0.98]], [[0.48, 0.56], [0.66, 0.38], [0.84, 0.52], [0.88, 0.98]]] },
  n: { w: 0.58, s: [[[0.18, 0.40], [0.18, 0.72], [0.20, 0.98]], [[0.20, 0.58], [0.44, 0.38], [0.74, 0.48], [0.80, 0.76], [0.82, 0.98]]] },
  o: { w: 0.58, s: [[[0.52, 0.38], [0.22, 0.48], [0.16, 0.74], [0.32, 0.96], [0.62, 0.96], [0.84, 0.78], [0.80, 0.48], [0.52, 0.38]]] },
  p: { w: 0.58, s: [[[0.20, 0.40], [0.18, 0.88], [0.20, 1.32]], [[0.20, 0.52], [0.48, 0.38], [0.78, 0.52], [0.78, 0.82], [0.50, 0.98], [0.20, 0.90]]] },
  r: { w: 0.46, s: [[[0.24, 0.40], [0.24, 0.72], [0.26, 0.98]], [[0.24, 0.60], [0.44, 0.40], [0.72, 0.38], [0.84, 0.46]]] },
  s: { w: 0.52, s: [[[0.78, 0.46], [0.54, 0.36], [0.24, 0.44], [0.24, 0.60], [0.56, 0.68], [0.80, 0.80], [0.74, 0.96], [0.44, 1.00], [0.18, 0.90]]] },
  t: { w: 0.44, s: [[[0.46, 0.10], [0.44, 0.58], [0.48, 0.94], [0.68, 0.98]], [[0.18, 0.42], [0.48, 0.40], [0.78, 0.38]]] },
  u: { w: 0.58, s: [[[0.20, 0.40], [0.18, 0.76], [0.36, 0.98], [0.64, 0.94], [0.78, 0.68]], [[0.78, 0.40], [0.78, 0.74], [0.84, 0.98]]] },
  v: { w: 0.54, s: [[[0.14, 0.40], [0.32, 0.74], [0.50, 0.98], [0.68, 0.70], [0.86, 0.40]]] },
  w: { w: 0.78, s: [[[0.08, 0.40], [0.22, 0.96], [0.46, 0.56], [0.68, 0.96], [0.90, 0.40]]] },
  y: { w: 0.56, s: [[[0.16, 0.40], [0.34, 0.74], [0.52, 0.94]], [[0.84, 0.40], [0.62, 0.84], [0.40, 1.18], [0.22, 1.32]]] },
  z: { w: 0.54, s: [[[0.18, 0.42], [0.52, 0.40], [0.82, 0.42], [0.50, 0.70], [0.16, 0.96], [0.52, 0.96], [0.86, 0.94]]] },

  // Uppercase (bouncy hand-printed)
  A: { w: 0.64, s: [[[0.10, 0.98], [0.32, 0.44], [0.50, 0.04], [0.70, 0.50], [0.90, 0.98]], [[0.22, 0.66], [0.52, 0.64], [0.80, 0.62]]] },
  B: { w: 0.60, s: [[[0.16, 0.04], [0.16, 0.52], [0.18, 0.98]], [[0.16, 0.06], [0.62, 0.04], [0.82, 0.24], [0.64, 0.48], [0.18, 0.50], [0.72, 0.54], [0.86, 0.76], [0.68, 0.98], [0.18, 0.98]]] },
  C: { w: 0.60, s: [[[0.84, 0.18], [0.58, 0.02], [0.26, 0.16], [0.14, 0.52], [0.26, 0.88], [0.58, 0.98], [0.86, 0.84]]] },
  D: { w: 0.62, s: [[[0.16, 0.04], [0.16, 0.52], [0.18, 0.98]], [[0.16, 0.06], [0.58, 0.08], [0.84, 0.34], [0.84, 0.68], [0.58, 0.96], [0.18, 0.98]]] },
  E: { w: 0.56, s: [[[0.80, 0.06], [0.46, 0.04], [0.18, 0.06], [0.18, 0.52], [0.20, 0.96], [0.54, 0.98], [0.84, 0.94]], [[0.18, 0.50], [0.48, 0.48], [0.72, 0.48]]] },
  F: { w: 0.54, s: [[[0.80, 0.06], [0.48, 0.04], [0.18, 0.06], [0.18, 0.54], [0.20, 0.98]], [[0.18, 0.50], [0.46, 0.48], [0.70, 0.48]]] },
  G: { w: 0.64, s: [[[0.82, 0.18], [0.54, 0.02], [0.22, 0.18], [0.14, 0.54], [0.26, 0.90], [0.60, 0.98], [0.84, 0.82], [0.84, 0.54], [0.52, 0.54]]] },
  H: { w: 0.62, s: [[[0.16, 0.04], [0.16, 0.54], [0.18, 0.98]], [[0.82, 0.04], [0.82, 0.52], [0.84, 0.98]], [[0.16, 0.52], [0.50, 0.48], [0.82, 0.48]]] },
  I: { w: 0.36, s: [[[0.26, 0.06], [0.50, 0.05], [0.74, 0.06]], [[0.50, 0.06], [0.48, 0.54], [0.50, 0.96]], [[0.24, 0.98], [0.50, 0.96], [0.76, 0.96]]] },
  K: { w: 0.60, s: [[[0.18, 0.04], [0.18, 0.52], [0.20, 0.98]], [[0.82, 0.08], [0.48, 0.34], [0.20, 0.52], [0.52, 0.74], [0.86, 0.98]]] },
  L: { w: 0.54, s: [[[0.20, 0.04], [0.18, 0.56], [0.20, 0.96], [0.54, 0.98], [0.86, 0.94]]] },
  M: { w: 0.74, s: [[[0.10, 0.98], [0.16, 0.06], [0.50, 0.56], [0.84, 0.06], [0.90, 0.98]]] },
  N: { w: 0.62, s: [[[0.16, 0.98], [0.16, 0.06], [0.52, 0.54], [0.82, 0.96], [0.84, 0.06]]] },
  O: { w: 0.64, s: [[[0.52, 0.04], [0.22, 0.18], [0.14, 0.54], [0.26, 0.88], [0.56, 0.98], [0.84, 0.82], [0.88, 0.46], [0.76, 0.14], [0.52, 0.04]]] },
  P: { w: 0.58, s: [[[0.18, 0.98], [0.16, 0.48], [0.18, 0.04], [0.64, 0.06], [0.84, 0.26], [0.68, 0.50], [0.18, 0.52]]] },
  R: { w: 0.60, s: [[[0.18, 0.98], [0.16, 0.48], [0.18, 0.04], [0.64, 0.06], [0.82, 0.26], [0.66, 0.50], [0.18, 0.52]], [[0.46, 0.52], [0.68, 0.76], [0.88, 0.98]]] },
  S: { w: 0.56, s: [[[0.80, 0.18], [0.54, 0.04], [0.24, 0.14], [0.20, 0.36], [0.50, 0.50], [0.80, 0.64], [0.80, 0.86], [0.50, 0.98], [0.18, 0.88]]] },
  T: { w: 0.58, s: [[[0.12, 0.08], [0.50, 0.05], [0.88, 0.06]], [[0.50, 0.06], [0.48, 0.54], [0.50, 0.98]]] },
  U: { w: 0.62, s: [[[0.18, 0.06], [0.18, 0.68], [0.36, 0.96], [0.66, 0.96], [0.82, 0.68], [0.84, 0.06]]] },
  V: { w: 0.60, s: [[[0.14, 0.06], [0.32, 0.56], [0.50, 0.98], [0.68, 0.54], [0.86, 0.06]]] },
  W: { w: 0.78, s: [[[0.08, 0.06], [0.28, 0.96], [0.50, 0.48], [0.72, 0.96], [0.92, 0.06]]] },
  Y: { w: 0.58, s: [[[0.14, 0.06], [0.34, 0.34], [0.50, 0.52], [0.68, 0.30], [0.86, 0.06]], [[0.50, 0.52], [0.48, 0.76], [0.50, 0.98]]] },

  // Digits & symbols
  '0': { w: 0.58, s: [[[0.52, 0.04], [0.22, 0.18], [0.14, 0.54], [0.26, 0.88], [0.54, 0.98], [0.82, 0.82], [0.86, 0.46], [0.74, 0.14], [0.52, 0.04]]] },
  '1': { w: 0.40, s: [[[0.26, 0.24], [0.50, 0.06], [0.50, 0.54], [0.52, 0.96]], [[0.26, 0.98], [0.52, 0.96], [0.78, 0.96]]] },
  '2': { w: 0.56, s: [[[0.18, 0.24], [0.42, 0.04], [0.72, 0.10], [0.82, 0.32], [0.58, 0.60], [0.18, 0.96], [0.54, 0.96], [0.88, 0.94]]] },
  '3': { w: 0.56, s: [[[0.20, 0.16], [0.52, 0.04], [0.78, 0.20], [0.70, 0.44], [0.42, 0.50], [0.76, 0.58], [0.82, 0.82], [0.54, 0.98], [0.18, 0.88]]] },
  '4': { w: 0.58, s: [[[0.68, 0.06], [0.40, 0.38], [0.14, 0.66], [0.54, 0.66], [0.88, 0.64]], [[0.68, 0.06], [0.66, 0.56], [0.68, 0.98]]] },
  '5': { w: 0.56, s: [[[0.78, 0.06], [0.48, 0.06], [0.24, 0.08], [0.20, 0.48], [0.56, 0.42], [0.82, 0.62], [0.76, 0.88], [0.46, 0.98], [0.18, 0.88]]] },
  '6': { w: 0.56, s: [[[0.74, 0.10], [0.42, 0.06], [0.20, 0.34], [0.18, 0.74], [0.44, 0.98], [0.76, 0.88], [0.80, 0.62], [0.54, 0.48], [0.20, 0.60]]] },
  '7': { w: 0.54, s: [[[0.16, 0.08], [0.52, 0.06], [0.84, 0.08], [0.62, 0.52], [0.40, 0.98]]] },
  '8': { w: 0.56, s: [[[0.52, 0.48], [0.24, 0.34], [0.24, 0.14], [0.50, 0.04], [0.76, 0.16], [0.74, 0.36], [0.50, 0.48], [0.20, 0.66], [0.22, 0.88], [0.52, 0.98], [0.80, 0.86], [0.78, 0.64], [0.52, 0.48]]] },
  '$': { w: 0.58, s: [[[0.78, 0.22], [0.50, 0.10], [0.24, 0.22], [0.26, 0.42], [0.74, 0.56], [0.76, 0.78], [0.48, 0.90], [0.20, 0.80]], [[0.50, 0.0], [0.48, 0.52], [0.50, 1.04]]] },
  '?': { w: 0.52, s: [[[0.20, 0.22], [0.46, 0.04], [0.76, 0.14], [0.78, 0.36], [0.50, 0.56], [0.48, 0.72]], [[0.48, 0.90], [0.52, 0.96]]] },
  '!': { w: 0.28, s: [[[0.50, 0.04], [0.48, 0.42], [0.48, 0.72]], [[0.48, 0.90], [0.52, 0.96]]] },
  '=': { w: 0.54, s: [[[0.18, 0.46], [0.50, 0.44], [0.82, 0.44]], [[0.18, 0.70], [0.50, 0.68], [0.82, 0.68]]] },
  '+': { w: 0.52, s: [[[0.50, 0.28], [0.48, 0.56], [0.50, 0.84]], [[0.20, 0.56], [0.50, 0.54], [0.80, 0.54]]] },
  '_': { w: 0.58, s: [[[0.08, 0.96], [0.50, 0.95], [0.92, 0.96]]] },
  ',': { w: 0.26, s: [[[0.54, 0.82], [0.48, 0.98], [0.38, 1.12]]] },
  '.': { w: 0.24, s: [[[0.46, 0.88], [0.54, 0.94]]] },
  ':': { w: 0.26, s: [[[0.48, 0.42], [0.52, 0.48]], [[0.48, 0.84], [0.52, 0.90]]] },
  ';': { w: 0.28, s: [[[0.48, 0.42], [0.52, 0.48]], [[0.52, 0.82], [0.46, 0.98], [0.38, 1.10]]] },
  '(': { w: 0.36, s: [[[0.68, 0.06], [0.38, 0.30], [0.32, 0.56], [0.40, 0.82], [0.68, 0.98]]] },
  ')': { w: 0.36, s: [[[0.32, 0.06], [0.62, 0.30], [0.68, 0.56], [0.60, 0.82], [0.32, 0.98]]] },
  '"': { w: 0.36, s: [[[0.30, 0.04], [0.28, 0.28]], [[0.66, 0.04], [0.62, 0.28]]] },
  '/': { w: 0.44, s: [[[0.84, 0.06], [0.50, 0.52], [0.16, 0.98]]] },
};

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function renderCheatSheetCanvas(): HTMLCanvasElement {
  const w = 720;
  const h = 860;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const rand = makeRng(19842209);

  // Warm school notebook paper
  const paperGrad = ctx.createLinearGradient(0, 0, w, h);
  paperGrad.addColorStop(0, '#f5efde');
  paperGrad.addColorStop(0.55, '#eee6d3');
  paperGrad.addColorStop(1, '#e3d9c3');
  ctx.fillStyle = paperGrad;
  ctx.fillRect(0, 0, w, h);

  // Organic paper fibers
  for (let i = 0; i < 6500; i++) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(88, 70, 44, 0.032)' : 'rgba(255, 255, 255, 0.045)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Torn spiral notches along top edge
  ctx.fillStyle = 'rgba(42, 34, 26, 0.16)';
  for (let x = 22; x < w - 16; x += 26) {
    ctx.beginPath();
    ctx.arc(x, 0, 5.5, 0, Math.PI);
    ctx.fill();
  }

  // Classic light blue ruled lines
  ctx.strokeStyle = 'rgba(78, 136, 198, 0.30)';
  ctx.lineWidth = 1.6;
  for (let y = 114; y < h - 24; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Faint red vertical school margin line
  ctx.strokeStyle = 'rgba(210, 88, 92, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(86, 0);
  ctx.lineTo(86, h);
  ctx.stroke();

  // Horizontal fold crease across middle
  const fold = ctx.createLinearGradient(0, h * 0.49, 0, h * 0.53);
  fold.addColorStop(0, 'rgba(60, 48, 32, 0.0)');
  fold.addColorStop(0.5, 'rgba(60, 48, 32, 0.075)');
  fold.addColorStop(1, 'rgba(60, 48, 32, 0.0)');
  ctx.fillStyle = fold;
  ctx.fillRect(0, h * 0.49, w, h * 0.04);

  // Subtle dog-eared shadow bottom-right
  ctx.beginPath();
  ctx.moveTo(w - 78, h);
  ctx.lineTo(w, h - 78);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(90, 74, 52, 0.14)';
  ctx.fill();

  const BLUE_RGB: [number, number, number] = [24, 58, 146];
  const RED_RGB: [number, number, number] = [194, 42, 38];

  // Authentic Bic ballpoint pen stroke renderer: smooth spline + downstroke pressure + ink blobs
  const drawBallpoint = (pts: [number, number][], rgb: [number, number, number], baseW: number) => {
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Sample smooth Catmull-Rom curve
    const dense: [number, number][] = [];
    const steps = 8;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        dense.push([
          catmullRom(p0[0], p1[0], p2[0], p3[0], t),
          catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        ]);
      }
    }
    dense.push(pts[pts.length - 1]);

    // Tiny ballpoint ink touch blob at start of stroke
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.82)`;
    ctx.beginPath();
    ctx.arc(dense[0][0], dense[0][1], baseW * 0.56, 0, Math.PI * 2);
    ctx.fill();

    // Draw segments with subtle pressure variation (heavier on downstrokes)
    for (let i = 1; i < dense.length; i++) {
      const [x0, y0] = dense[i - 1];
      const [x1, y1] = dense[i];
      const dy = y1 - y0;
      const pressure = dy > 0 ? 1.12 : 0.88;
      const wSeg = baseW * pressure * (0.92 + rand() * 0.16);
      const alpha = 0.74 + rand() * 0.18;

      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(2)})`;
      ctx.lineWidth = wSeg;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Write hand-printed 8-year-old text with natural uneven slant, size, spacing & baseline drift
  const writeHand = (
    text: string,
    x: number,
    y: number,
    size: number,
    rgb: [number, number, number] = BLUE_RGB,
    penW = 3.2,
    slope = -0.012,
  ) => {
    let cx = x;
    let cy = y;
    const slantBase = -0.08; // gentle forward/back child slant
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') {
        cx += size * (0.40 + (rand() - 0.5) * 0.12);
        cy += size * slope * 0.4;
        continue;
      }
      const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
      const gw = (g?.w ?? 0.55) * size;
      const scaleH = size * (0.88 + rand() * 0.24);
      const scaleW = gw * (0.88 + rand() * 0.22);
      const tilt = slantBase + (rand() - 0.5) * 0.22;
      const bobY = (rand() - 0.5) * size * 0.15;

      if (g) {
        for (const stroke of g.s) {
          const pts: [number, number][] = stroke.map(([gx, gy]) => {
            const lx = (gx - 0.5) * scaleW + (rand() - 0.5) * 1.4;
            const ly = (gy - 1.0) * scaleH + (rand() - 0.5) * 1.4;
            // Slight italic shear + tilt
            const sx = lx - ly * 0.08;
            const rx = sx * Math.cos(tilt) - ly * Math.sin(tilt);
            const ry = sx * Math.sin(tilt) + ly * Math.cos(tilt);
            return [cx + scaleW * 0.5 + rx, cy + bobY + ry];
          });
          drawBallpoint(pts, rgb, penW);
        }
      }
      cx += scaleW + size * (0.10 + rand() * 0.09);
      cy += (scaleW + size * 0.12) * slope;
    }
  };

  // ---- Header: "BASIC CHEAT SHEET" ----
  writeHand('BASIC CHEAT SHEET', 98, 94, 37, BLUE_RGB, 3.9, -0.014);
  drawBallpoint([[98, 105], [260, 101], [415, 97], [534, 94]], BLUE_RGB, 3.2);
  drawBallpoint([[112, 112], [290, 108], [480, 104]], BLUE_RGB, 2.0);

  // Cute kid-drawn smiling boxy computer doodle top-right
  drawKidComputer(568, 38, 80, BLUE_RGB, RED_RGB, drawBallpoint);

  // ---- Echo program scribbled cheats ----
  writeHand('make it echo:', 100, 162, 26, BLUE_RGB, 2.8, -0.01);

  writeHand('10 INPUT A$', 106, 214, 34, BLUE_RGB, 3.6, -0.01);
  writeHand('(words!)', 378, 210, 22, BLUE_RGB, 2.4, 0.015);

  // Line 20: crossed-out "echo" -> "PRINT ???"
  writeHand('20', 106, 266, 34, BLUE_RGB, 3.6, -0.01);
  writeHand('echo', 176, 266, 31, BLUE_RGB, 2.9, -0.008);
  // Messy red scribble crossing out "echo"
  drawBallpoint(
    [[170, 262], [192, 240], [210, 266], [234, 240], [252, 266], [274, 244], [284, 260]],
    RED_RGB,
    3.6,
  );
  drawBallpoint([[168, 253], [228, 250], [286, 252]], RED_RGB, 2.8);
  writeHand('PRINT ???', 302, 264, 34, BLUE_RGB, 3.6, -0.015);

  // Line 30: GOTO __ with huge loopy arrow back up to 10
  writeHand('30 GOTO __', 106, 318, 34, BLUE_RGB, 3.6, -0.006);

  // Big sweeping curved hand-drawn arrow looping back up to line 10!
  drawBallpoint(
    [[356, 308], [488, 326], [596, 286], [600, 212], [552, 174], [496, 178]],
    BLUE_RGB,
    3.3,
  );
  drawBallpoint([[516, 162], [492, 178], [516, 194]], BLUE_RGB, 3.3);
  writeHand('loop!', 526, 258, 22, RED_RGB, 2.6, 0.07);

  // Don't forget RUN
  writeHand('then type  RUN', 108, 372, 29, BLUE_RGB, 3.2, -0.01);
  drawBallpoint([[314, 380], [362, 379], [412, 377]], BLUE_RGB, 2.8);

  // Big red-circled EMERGENCY ESC note!
  drawBallpoint(
    [[96, 424], [116, 394], [350, 390], [588, 398], [608, 426], [590, 456], [344, 460], [110, 456], [94, 428], [114, 398]],
    RED_RGB,
    3.4,
  );
  writeHand('stuck?? press  ESC !!', 118, 439, 31, RED_RGB, 3.6, -0.005);

  // Hand-drawn squiggly divider
  const wave: [number, number][] = [];
  for (let x = 98; x <= 638; x += 26) {
    wave.push([x, 502 + Math.sin(x * 0.075) * 6]);
  }
  drawBallpoint(wave, BLUE_RGB, 2.3);

  // Handy quick cheats below
  writeHand('LIST = see code', 102, 548, 26, BLUE_RGB, 3.0, -0.006);
  writeHand('NEW  = erase all', 102, 590, 26, BLUE_RGB, 3.0, -0.004);
  writeHand('CMD+C/V = copy/paste list!', 102, 634, 24, BLUE_RGB, 2.8, -0.006);

  // Floppy drive games & save/load cheats!
  writeHand('GAMES ON DISK!!', 102, 692, 26, RED_RGB, 3.2, -0.012);
  drawBallpoint([[102, 700], [238, 696], [352, 692]], RED_RGB, 2.2);
  writeHand('LOAD "$",8', 108, 738, 28, BLUE_RGB, 3.3, -0.006);
  writeHand('then LIST', 326, 736, 21, BLUE_RGB, 2.4, 0.01);
  writeHand('LOAD "DODGE",8', 108, 782, 28, BLUE_RGB, 3.3, -0.006);
  writeHand('SAVE "MINE",8', 108, 826, 28, BLUE_RGB, 3.3, -0.004);

  // Tiny rocket doodle in left margin + stars on right
  drawKidRocket(42, 558, BLUE_RGB, RED_RGB, drawBallpoint);
  drawKidStar(586, 744, 26, RED_RGB, drawBallpoint);
  drawKidStar(636, 784, 16, BLUE_RGB, drawBallpoint);

  return c;
}

function drawKidComputer(
  x: number,
  y: number,
  s: number,
  ink: [number, number, number],
  red: [number, number, number],
  pen: (pts: [number, number][], rgb: [number, number, number], w: number) => void,
) {
  pen([[x, y], [x + s, y - 2], [x + s + 2, y + s * 0.8], [x - 2, y + s * 0.82], [x, y]], ink, 2.8);
  pen([[x + 10, y + 11], [x + s - 10, y + 10], [x + s - 9, y + s * 0.56], [x + 10, y + s * 0.58], [x + 10, y + 11]], ink, 2.1);
  // Smiley face inside CRT
  pen([[x + 25, y + 23], [x + 26, y + 27]], ink, 3.2);
  pen([[x + s - 25, y + 23], [x + s - 24, y + 27]], ink, 3.2);
  pen([[x + 24, y + 36], [x + s * 0.5, y + 43], [x + s - 24, y + 35]], ink, 2.4);
  pen([[x + s - 17, y + s * 0.69], [x + s - 12, y + s * 0.69]], red, 4.4);
}

function drawKidStar(
  cx: number,
  cy: number,
  r: number,
  rgb: [number, number, number],
  pen: (pts: [number, number][], rgb: [number, number, number], w: number) => void,
) {
  const order = [0, 2, 4, 1, 3, 0];
  const pts: [number, number][] = order.map((idx) => {
    const a = -Math.PI / 2 + (idx * Math.PI * 2) / 5;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  pen(pts, rgb, 2.6);
}

function drawKidRocket(
  cx: number,
  cy: number,
  ink: [number, number, number],
  red: [number, number, number],
  pen: (pts: [number, number][], rgb: [number, number, number], w: number) => void,
) {
  pen([[cx, cy - 34], [cx + 12, cy - 10], [cx + 12, cy + 20], [cx - 12, cy + 20], [cx - 12, cy - 10], [cx, cy - 34]], ink, 2.4);
  pen([[cx - 12, cy + 6], [cx - 22, cy + 24], [cx - 12, cy + 20]], ink, 2.2);
  pen([[cx + 12, cy + 6], [cx + 22, cy + 24], [cx + 12, cy + 20]], ink, 2.2);
  pen([[cx - 4, cy - 4], [cx + 4, cy - 4], [cx + 4, cy + 4], [cx - 4, cy + 4], [cx - 4, cy - 4]], ink, 2.0);
  pen([[cx - 7, cy + 22], [cx - 2, cy + 38], [cx + 2, cy + 28], [cx + 6, cy + 40], [cx + 8, cy + 22]], red, 2.5);
}
