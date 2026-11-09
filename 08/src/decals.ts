import * as THREE from 'three';

// Decal textures for the sleeves, drawn on canvases: brand, serial, barcode, a hazard band at the mouth, a coloured
// tab. Canvas x runs round the tube, canvas y along it, the top of the canvas at the sleeve's open end.

export const ACCENTS = ['#ef5f9f', '#c9e35b', '#f2703f', '#8e7cf0'];

export type Decal = {
  base: string;
  ink: string;
  serial: string;
  axis: string;
  seed: number;
  accent: string;
  /** The sleeve at the far end hangs the other way up: turn the lettering round so both ends read alike. */
  flip?: boolean;
};

const W = 512, H = 416;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAPHITE_BASE = '#3a3a3d';
const SMALL = ['CODEVEMBER 2026 · DAY 08', 'R3F · DREI · THREE', 'MAX 2.5 BAR', 'W-AXIS ONLY', 'ASYNC//SYSTEMS · UNIT 08', 'TELESCOPIC · 3 STG'];

/** The three.js mark: a triangle cut into n rows of triangles, in strokes, tilted like the logo. (x, y) is the centre. */
export function threeMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, n = 4) {
  const h = size * Math.sqrt(3) / 2;
  g.save();
  g.translate(x, y);
  g.rotate(0.3);
  g.translate(-size / 2, -h / 3);
  const A = [0, 0], B = [size, 0], C = [size / 2, h];
  const at = (p: number[], q: number[], t: number) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    for (const [p, q, r] of [[A, B, C], [B, C, A], [C, A, B]]) {
      const u = at(p, r, t), v = at(q, r, t);
      g.moveTo(u[0], u[1]); g.lineTo(v[0], v[1]);
    }
  }
  g.lineJoin = 'round';
  g.stroke();
  g.restore();
}

/** The pmndrs mark: a cluster of pixel squares, a big one top right, the overlap of two a half-tone. (x, y) is the top left. */
export function pmndrsMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const u = size / 60;
  g.save();
  g.translate(x, y);
  g.scale(u, u);
  g.fillStyle = color;
  g.fillRect(22, 0, 40, 40); // big
  g.fillRect(0, 18, 22, 22); // left
  g.fillRect(22, 40, 20, 20); // below
  g.globalCompositeOperation = 'destination-out'; // the overlap lets the surface through, half
  g.globalAlpha = 0.55;
  g.fillRect(22, 18, 20, 22);
  g.restore();
}

// GitHub octicon `mark-github`, 16x16 viewBox, MIT
const GITHUB = typeof Path2D !== 'undefined'
  ? new Path2D('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z')
  : null;

/** The GitHub mark, filled. (x, y) is the top left. */
export function githubMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  if (!GITHUB) return;
  g.save();
  g.translate(x, y);
  g.scale(size / 16, size / 16);
  g.fillStyle = color;
  g.fill(GITHUB);
  g.restore();
}

/** Hairline scratches and nicks on a canvas: mostly along y, a few across, light and dark at low alpha. */
export function scratches(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, n: number, light: string, dark: string, alpha = 0.22) {
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const along = r() < 0.7;
    const x = r() * w, y = r() * h;
    const len = (along ? 0.1 + r() * 0.35 : 0.04 + r() * 0.12) * (along ? h : w);
    const a = (along ? Math.PI / 2 : 0) + (r() - 0.5) * 0.5;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    g.strokeStyle = r() < 0.65 ? light : dark;
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.lineWidth = 0.5 + r() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + dx / 2 + (r() - 0.5) * 4, y + dy / 2 + (r() - 0.5) * 4, x + dx, y + dy);
    g.stroke();
  }
  g.restore();
}

/** A few proper scrapes: each a cluster of two or three near-parallel gouges, a `core` where the paint is off, a
 * `rim` round it, wider and offset. Bold enough to read from the main view at a sleeve's few pixels; use them in a
 * couple of places, not all over. On sand the core is dark (graphite under the paint), on graphite it is light. */
export function gouges(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, n: number, core: string, rim: string, scale = 1) {
  const light = core, dark = rim;
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const along = r() < 0.6;
    // start so the whole scrape fits on the canvas, whichever way it runs
    const len = along ? h * (0.4 + r() * 0.3) : w * (0.3 + r() * 0.3);
    const sc = along ? scale : scale * 0.35; // across the sleeve the strokes stay finer, or they turn to blobs
    const x = along ? w * (0.1 + r() * 0.8) : w * (0.08 + r() * 0.55), y = along ? h * (0.06 + r() * 0.24) : h * (0.15 + r() * 0.7);
    const a = (along ? Math.PI / 2 : 0) + (r() - 0.5) * 0.7;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const strands = 2 + Math.floor(r() * 2);
    for (let k = 0; k < strands; k++) {
      const off = (k - (strands - 1) / 2) * (3 + r() * 3) * sc;
      const ox = -Math.sin(a) * off, oy = Math.cos(a) * off;
      const shrink = 0.7 + r() * 0.3;
      const x0 = x + ox + dx * (1 - shrink) * r(), y0 = y + oy + dy * (1 - shrink) * r();
      const bend = (r() - 0.5) * 10 * sc;
      const path = () => {
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + dx * shrink / 2 - Math.sin(a) * bend, y0 + dy * shrink / 2 + Math.cos(a) * bend, x0 + dx * shrink, y0 + dy * shrink);
      };
      g.strokeStyle = dark; g.globalAlpha = 0.55; g.lineWidth = (3 + r() * 2.5) * sc;
      path(); g.translate(0.8 * sc, 1.2 * sc); g.stroke(); g.translate(-0.8 * sc, -1.2 * sc);
      g.strokeStyle = light; g.globalAlpha = 0.8; g.lineWidth = (1.6 + r() * 1.8) * sc;
      path(); g.stroke();
    }
  }
  g.restore();
}

/** A plain sleeve with a scrape or two on it, for the few undecaled sleeves that have been knocked about. */
export function scuffSleeve(base: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const r = rng(seed);
  const sand = base !== GRAPHITE_BASE;
  if (sand) gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#3e3429', '#f6ead0', 14);
  else gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#a8a8ac', '#000000', 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One shared scratch map for the dark rubber and graphite parts: a mid grey, scuffed lighter (rougher) and darker (glossier). */
export function scratchMap(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d4d4d4';
  g.fillRect(0, 0, 256, 256);
  const r = rng(77);
  scratches(g, () => r(), 256, 256, 40, '#ffffff', '#7a7a7a', 0.5);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function sleeveDecal(d: Decal): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(d.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

  g.fillStyle = d.base;
  g.fillRect(0, 0, W, H);
  // a sleeve carries a few of these, not all: hazard band, brand, serial, barcode, tab, pictogram
  const has = { hazard: r() < 0.35, brand: true, serial: r() < 0.5, barcode: r() < 0.3, tab: r() < 0.5 };
  if (!has.brand && !has.serial) has.serial = true;

  // hazard band at the mouth
  const hz = 34;
  if (has.hazard) {
  g.save();
  g.beginPath(); g.rect(0, 0, W, hz); g.clip();
  g.fillStyle = d.ink;
  for (let x = -hz; x < W + hz; x += 36) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 18, 0); g.lineTo(x + 18 + hz, hz); g.lineTo(x + hz, hz); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = d.ink;
  g.fillRect(0, hz, W, 3);
  }

  // a hairline
  g.fillStyle = d.ink;
  g.globalAlpha = 0.35;
  g.fillRect(0, H - 28, W, 2);
  g.globalAlpha = 1;

  // lettering: canvas x runs round the tube the way a viewer outside reads it, so text is drawn as is
  const upright = () => { if (d.flip) { g.translate(W / 2, H / 2); g.rotate(Math.PI); g.translate(-W / 2, -H / 2); } };

  // brand, round the tube: one logo per sleeve, small, the GitHub one smallest
  if (has.brand) {
  g.save();
  upright();
  g.fillStyle = d.ink;
  g.strokeStyle = d.ink;
  g.textBaseline = 'middle';
  const logo = (['word', 'three', 'pmndrs', 'github'] as const)[d.seed % 4];
  const bx = 20 + Math.floor(r() * 100);
  g.globalAlpha = 0.92;
  for (const o of [0, W]) { // twice, so it wraps round the seam
    g.font = '800 46px "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (logo === 'three') {
      g.lineWidth = 2;
      threeMark(g, bx + 24 + o, 100, 44);
      g.fillText('three.js', bx + 62 + o, 110);
    } else if (logo === 'pmndrs') {
      pmndrsMark(g, bx + o, 82, 40, d.ink);
      g.fillText('pmndrs', bx + 52 + o, 110);
    } else {
      g.fillText('CDVMBR 08', bx + o, 110);
    }
    g.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
    if (logo === 'github') {
      githubMark(g, bx + o, 140, 24, d.ink);
      g.fillText('OPEN SOURCE', bx + 34 + o, 152);
    } else if (r() < 0.5) {
      g.fillText(pick(SMALL), bx + 2 + o, 166);
    }
  }
  g.restore();
  }

  // serial, along the tube
  if (has.serial) {
  g.save();
  upright();
  g.translate(W - 96, H - 40);
  g.rotate(-Math.PI / 2);
  g.font = '900 54px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText(d.serial, 0, 0);
  g.font = '600 18px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillText(`AXIS ${d.axis} · ASYNC SYSTEMS`, 0, 22);
  g.restore();
  }

  // barcode
  if (has.barcode) {
  g.save();
  upright();
  g.translate(40, 200);
  let x = 0;
  while (x < 150) {
    const w = 2 + Math.floor(r() * 5);
    if (r() < 0.55) g.fillRect(x, 0, w, 120);
    x += w + 2;
  }
  g.font = '500 14px Menlo, monospace';
  g.fillText(`${d.serial.replace('—', '')}-${Math.floor(r() * 9000 + 1000)}`, 0, 140);
  g.restore();
  }

  // a coloured tab, and a black one
  if (has.tab) {
    g.fillStyle = d.accent;
    g.fillRect(220 + Math.floor(r() * 60), 210, 44, 16);
    g.fillStyle = d.ink;
    g.fillRect(220 + Math.floor(r() * 60), 236, 70, 6);
  }
  // a worn prototype: hairline scratches, and the paint rubbed thin at the lips
  const sand = d.base !== GRAPHITE_BASE;
  const light = sand ? '#f4e6c4' : '#a4a4a8', dark = sand ? '#6e5a3a' : '#111111';
  scratches(g, r, W, H, 16, light, dark);
  if (r() < 0.35) gouges(g, r, W, H, 1, sand ? '#3e3429' : '#a8a8ac', sand ? '#f6ead0' : '#000000', 14);
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const top = r() < 0.5;
    const x = r() * W, y = top ? r() * 14 : H - r() * 14;
    g.strokeStyle = r() < 0.75 ? light : dark;
    g.globalAlpha = 0.1 + r() * 0.2;
    g.lineWidth = 0.7 + r() * 1.1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 5); g.stroke();
  }
  g.restore();


  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
