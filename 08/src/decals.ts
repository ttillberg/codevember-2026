import * as THREE from 'three';
import { logo, sheet, withLogos } from './logos';

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
  /** The mark on this sleeve, if any: the machine hands them out, two of each, so they do not repeat. */
  brand?: Brand | null;
};
export type Brand = 'word' | 'three' | 'pmndrs' | 'github';

/** Is a hex colour on the light side? Decides whether wear shows dark or light on it. */
const isLight = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 110; };
const WEAR_INK = (base: string) => (isLight(base) ? '#4a3d2c' : '#9a9a9e');

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
/** A canvas of w x h logical units drawn at `k` times the pixels: the same coordinates, finer detail. */
function sharp(w: number, h: number, k = 2) {
  const c = document.createElement('canvas');
  c.width = w * k; c.height = h * k;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  return { c, g };
}
const SMALL = ['CODEVEMBER 2026 · DAY 08', 'R3F · DREI · THREE', 'MAX 2.5 BAR', 'W-AXIS ONLY', 'ASYNC//SYSTEMS · UNIT 08', 'TELESCOPIC · 3 STG'];




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

/** Rough wear from the scratch sheet: a random window of it laid over the canvas in `color`. The sheet is dense,
 * so a window of a third of it at most, and the alpha keeps it in the paint rather than on top of it. */
export function grunge(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, color: string, alpha: number) {
  const src = sheet('scratch', color);
  if (!src) return;
  // the sheet as a repeating pattern at about a quarter of its size, turned any way, flipped either way and shifted:
  // fine wear everywhere, no grain in common between parts, and never scaled up, so it stays crisp
  const pat = g.createPattern(src, 'repeat');
  if (!pat) return;
  const k = 0.22 + r() * 0.1;
  pat.setTransform(new DOMMatrix().translateSelf(r() * w, r() * h).rotateSelf(r() * 360).scaleSelf(k * (r() < 0.5 ? -1 : 1), k * (r() < 0.5 ? -1 : 1)));
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = pat;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** A plain sleeve with a scrape or two on it, for the few undecaled sleeves that have been knocked about. */
export function scuffSleeve(base: string, seed: number): THREE.CanvasTexture {
  const { c, g } = sharp(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const r = rng(seed);
  const sand = base !== GRAPHITE_BASE;
  if (sand) gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#3e3429', '#f6ead0', 14);
  else gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#a8a8ac', '#000000', 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  withLogos(() => { grunge(g, r, W, H, WEAR_INK(base), 0.55); t.needsUpdate = true; });
  return t;
}

/** Plain paint with a little wear all over: for the sleeves and stages that carry nothing else. A small canvas,
 * a light window of the sheet; the machine keeps a handful per colour and deals them out. */
export function wear(base: string, seed: number): THREE.CanvasTexture {
  const w = 256, h = 208;
  const { c, g } = sharp(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  withLogos(() => { grunge(g, r, w, h, WEAR_INK(base), 0.32 + r() * 0.16); t.needsUpdate = true; });
  return t;
}

/** Brushed metal for the rods: the silver with a fine grain along the rod, and on a couple of them a CE mark etched
 * into it, dark and faint, as if laser-marked through the brushing. The grain is canvas y, the rod's length. */
export function brushed(base: string, seed: number, mark = false): THREE.CanvasTexture {
  const w = 256, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  g.lineCap = 'butt';
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y0 = r() * h, len = 40 + r() * 300;
    g.strokeStyle = r() < 0.5 ? '#ffffff' : '#9a9a9e';
    g.globalAlpha = 0.04 + r() * 0.1;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 1.5, y0 + len); g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (mark) {
    const mx = r() * w, my = 120 + r() * (h - 240), ang = r() < 0.5 ? 0 : Math.PI / 2;
    withLogos(() => {
      const img = logo('ce', 160, '#4a4a4e');
      if (!img) return;
      g.save();
      g.globalAlpha = 0.7;
      for (const o of [-w, 0, w]) { // and again either side, so it wraps round the seam
        g.save(); g.translate(mx + o, my); g.rotate(ang); g.drawImage(img, -40, -40, 80, 80); g.restore();
      }
      g.restore();
      t.needsUpdate = true;
    });
  }
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
  const { c, g } = sharp(W, H);
  const r = rng(d.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

  g.fillStyle = d.base;
  g.fillRect(0, 0, W, H);
  // a sleeve carries a few of these, not all: hazard band, brand, serial, barcode, tab, pictogram
  const has = { hazard: r() < 0.35, brand: !!d.brand, serial: r() < 0.5, barcode: r() < 0.3, tab: r() < 0.5 };
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

  // brand, round the tube: one mark per sleeve, the real ones, small, the GitHub one smallest; or the wordmark.
  // The marks are images: the block is laid on when they have loaded, and the texture flagged.
  const brand = d.brand ?? null;
  const bx = 20 + Math.floor(r() * 100);
  const small = r() < 0.5 ? pick(SMALL) : null;
  // a mark lands anywhere along the sleeve, at any angle, so no two sit alike
  const my = 70 + r() * (H - 160), ang = (r() - 0.5) * Math.PI * 2;
  const drawBrand = () => {
    if (!has.brand) return;
    g.save();
    upright();
    g.fillStyle = d.ink;
    g.textBaseline = 'middle';
    g.globalAlpha = 0.92;
    for (const o of [0, W]) { // twice, so it wraps round the seam
      if (brand === 'word') {
        g.font = '800 46px "Helvetica Neue", Helvetica, Arial, sans-serif';
        g.fillText('CDVMBR 08', bx + o, 110);
      } else if (brand) {
        const size = brand === 'github' ? 34 : brand === 'three' ? 160 : 52;
        const img = logo(brand, size * 2, d.ink);
        if (img) {
          g.save();
          g.translate(bx + o + size / 2, my);
          g.rotate(ang);
          g.drawImage(img, -size / 2, -size / 2, size, size);
          g.restore();
        }
      }
      if (small && brand !== 'three') {
        g.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
        g.fillText(small, bx + 2 + o, 166);
      }
    }
    g.restore();
  };

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
  withLogos(() => { grunge(g, r, W, H, WEAR_INK(d.base), 0.5); drawBrand(); t.needsUpdate = true; });
  return t;
}
