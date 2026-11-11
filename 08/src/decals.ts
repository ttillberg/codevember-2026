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

/** A seeded random stream, mulberry32: the same seed deals the same wear every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The two paints: sand on the struts that run along w, graphite on the rest. */
export const SAND = '#d9b985', GRAPHITE = '#3a3a3d';
// the sleeve's texture is wrapped once round a tube 0.09 in radius and 0.26 long (Machine's R_SLEEVE, SLEEVE): a canvas
// unit runs this much longer round the tube than along it, so a mark drawn on it is squeezed back by it (the marks
// came out drawn out round the tube, for a while)
const SLEEVE_STRETCH = ((2 * Math.PI * 0.09) / 512) / (0.26 / 416);
const STICKER_INK = '#141414';
const STICKER_WHITE = '#f4f3ef', STICKER_GOLD = '#c9a43a'; // pmndrs' square stickers // the mark on a sticker
const STICKER_GLOSS = '#3a3a3a'; // the sticker in the roughness sheet: about a quarter of the paint's roughness, glossy
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
export function grunge(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, color: string, alpha: number, bump?: CanvasRenderingContext2D) {
  const src = sheet('scratch', color);
  if (!src) return;
  // the sheet as a repeating pattern at about a quarter of its size, turned any way, flipped either way and shifted:
  // fine wear everywhere, no grain in common between parts, and never scaled up, so it stays crisp
  const lay = (ctx: CanvasRenderingContext2D, img: CanvasImageSource, m: DOMMatrix, a: number) => {
    const pat = ctx.createPattern(img, 'repeat');
    if (!pat) return;
    pat.setTransform(m);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };
  const turn = (k: number) => new DOMMatrix().translateSelf(r() * w, r() * h).rotateSelf(r() * 360).scaleSelf(k * (r() < 0.5 ? -1 : 1), k * (r() < 0.5 ? -1 : 1));
  // soft: all over, faint
  const k1 = 0.22 + r() * 0.1;
  lay(g, src, turn(k1), alpha * 0.7);
  // hard: a patch of it, bigger and darker, where the part has been dragged over something; into the heights too
  if (r() < 0.75) {
    const k2 = 0.3 + r() * 0.15, m = turn(k2);
    const cx = r() * w, cy = r() * h, rx = w * (0.18 + r() * 0.22), ry = h * (0.18 + r() * 0.25), rot = r() * Math.PI;
    const clip = (ctx: CanvasRenderingContext2D) => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); ctx.clip(); };
    g.save(); clip(g); lay(g, src, m, Math.min(1, alpha * 1.8)); g.restore();
    if (bump) {
      const dark = sheet('scratch', '#000000');
      if (dark) { bump.save(); clip(bump); lay(bump, dark, m, 1); bump.restore(); }
    }
  }
}

/** A height sheet (white, scratches dark) and the normal map made from it: the hard wear as tiny grooves. */
export function bumpSheet(w: number, h: number) {
  const hc = document.createElement('canvas');
  hc.width = w; hc.height = h;
  const hg = hc.getContext('2d')!;
  hg.fillStyle = '#ffffff';
  hg.fillRect(0, 0, w, h);
  const nc = document.createElement('canvas');
  nc.width = w; nc.height = h;
  const flat = nc.getContext('2d')!;
  flat.fillStyle = '#8080ff'; // a flat normal everywhere until the bake, so nothing shines oddly meanwhile
  flat.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(nc);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  /** Read the heights and write the normals; call once the hard wear is on the sheet. */
  const bake = (strength = 1.6) => {
    const src = hg.getImageData(0, 0, w, h).data;
    const ng = nc.getContext('2d')!;
    const id = ng.createImageData(w, h), px = id.data;
    const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) * strength, gv = (at(x, y - 1) - at(x, y + 1)) * strength; // v runs up
      const inv = 1 / Math.hypot(gx, gv, 1);
      const o = (y * w + x) * 4;
      px[o] = (-gx * inv * 0.5 + 0.5) * 255; px[o + 1] = (-gv * inv * 0.5 + 0.5) * 255; px[o + 2] = (inv * 0.5 + 0.5) * 255; px[o + 3] = 255;
    }
    ng.putImageData(id, 0, 0);
    t.needsUpdate = true;
  };
  return { hg, t, bake };
}

/** A plain sleeve with a scrape or two on it, for the few undecaled sleeves that have been knocked about. */
export function scuffSleeve(base: string, seed: number): THREE.CanvasTexture {
  const { c, g } = sharp(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const r = rng(seed);
  const sand = base !== GRAPHITE;
  if (sand) gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#3e3429', '#f6ead0', 14);
  else gouges(g, r, W, H, 1 + Math.floor(r() * 2), '#a8a8ac', '#000000', 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const bump = bumpSheet(W, H);
  t.userData.bump = bump.t;
  withLogos(() => { grunge(g, r, W, H, WEAR_INK(base), 0.55, bump.hg); bump.bake(); t.needsUpdate = true; });
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
  t.wrapS = t.wrapT = THREE.RepeatWrapping; // so a part can shift it round the tube and mirror it
  const bump = bumpSheet(w, h);
  t.userData.bump = bump.t;
  withLogos(() => { grunge(g, r, w, h, WEAR_INK(base), 0.32 + r() * 0.16, bump.hg); bump.bake(); t.needsUpdate = true; });
  return t;
}

/** Brushed metal for the rods: the silver with a fine grain along the rod, and on a couple of them a CE mark etched
 * into it, dark and faint, as if laser-marked through the brushing. The grain is canvas y, the rod's length. */
/** How many times round the rod the brushed canvas is long: the rod shows a window of it sized to its length. */
export const ROD_SPAN = 8;
export function brushed(base: string, seed: number, mark = false): THREE.CanvasTexture {
  const w = 256, h = 256 * ROD_SPAN;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  g.lineCap = 'butt';
  for (let i = 0; i < 450 * ROD_SPAN; i++) {
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
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (mark) {
    // mid-rod, reading along it, once; drawn again a turn either side only so it wraps whole over the seam
    const mx = r() * w, my = h / 2, sz = 56;
    withLogos(() => {
      const img = logo('ce', 160, '#4a4a4e');
      if (!img) return;
      g.save();
      g.globalAlpha = 0.7;
      for (const o of [-w, 0, w]) {
        g.save(); g.translate(mx + o, my); g.rotate(Math.PI / 2); g.drawImage(img, -sz / 2, -sz / 2, sz, sz); g.restore();
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
  // the stickers: three.js on a round one in the sleeve's accent; pmndrs on a square one, white or gold, the mark black
  // on both (pmndrs bare in the ink, for a while); each glossy against the matt paint and raised a little off it
  const sticker = brand === 'three' ? { round: true, size: 200, k: 1.45, fill: d.accent }
    : brand === 'pmndrs' ? { round: false, size: 156, k: 1.32, fill: d.seed % 2 ? STICKER_WHITE : STICKER_GOLD } : null;
  const shape = (q: CanvasRenderingContext2D, s: number) => {
    q.beginPath();
    if (sticker?.round) q.arc(0, 0, s / 2, 0, Math.PI * 2); else q.roundRect(-s / 2, -s / 2, s, s, s * 0.07);
  };
  // the stickers' gloss: a roughness sheet, matt white all over but the sticker
  const gloss = sticker ? sharp(W, H) : null;
  if (gloss) { gloss.g.fillStyle = '#ffffff'; gloss.g.fillRect(0, 0, W, H); }
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
        // three.js 200 (160, then 320 bare, for a while), pmndrs three times what it was (52), each on its sticker
        const size = sticker ? sticker.size : 34;
        const stick = sticker ? size * sticker.k : 0;
        const img = logo(brand, size * 2, sticker ? STICKER_INK : d.ink);
        if (img) {
          const reach = sticker && !sticker.round ? stick * 0.72 : Math.max(size, stick) / 2; // a turned square reaches out to its corners
          const cx = bx + o + Math.max(size, stick) / 2, cy = Math.min(Math.max(my, reach), H - reach); // a big mark kept on the sleeve
          if (stick) {
            const card = (q: CanvasRenderingContext2D, fill: string) => {
              q.save(); q.translate(cx, cy); q.scale(1 / SLEEVE_STRETCH, 1); q.rotate(ang); q.globalAlpha = 1; q.fillStyle = fill;
              shape(q, stick); q.fill(); q.restore();
            };
            card(g, sticker!.fill);
            if (gloss) { gloss.g.save(); if (d.flip) { gloss.g.translate(W / 2, H / 2); gloss.g.rotate(Math.PI); gloss.g.translate(-W / 2, -H / 2); } card(gloss.g, STICKER_GLOSS); gloss.g.restore(); }
          }
          g.save();
          g.translate(cx, cy);
          g.scale(1 / SLEEVE_STRETCH, 1); // round on the tube, not drawn out round it
          g.rotate(ang);
          g.globalAlpha = 1;
          g.drawImage(img, -size / 2, -size / 2, size, size);
          g.restore();
        }
      }
      if (small && !sticker) { // no small print under a sticker
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
  const sand = d.base !== GRAPHITE;
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
  const bump = bumpSheet(W, H);
  t.userData.bump = bump.t;
  const rough = gloss ? new THREE.CanvasTexture(gloss.c) : null;
  if (rough) { rough.wrapS = THREE.RepeatWrapping; t.userData.rough = rough; t.userData.bumpScale = 1.4; } // a sticker's sleeve: its relief shown full, so the rim reads (the paint's 0.35)
  // the sticker raised off the paint, a little: in the height sheet a smooth plateau where it is, the wear wiped
  // off it, and round its edge a soft fall to the paint, so the light catches a rim all the way round (flat, for a while)
  const emboss = (q: CanvasRenderingContext2D) => {
    if (!sticker) return;
    const stick = sticker.size * sticker.k, reach = sticker.round ? stick / 2 : stick * 0.72, cy = Math.min(Math.max(my, reach), H - reach);
    q.save();
    if (d.flip) { q.translate(W / 2, H / 2); q.rotate(Math.PI); q.translate(-W / 2, -H / 2); }
    for (const o of [0, W]) {
      q.save(); q.translate(bx + o + stick / 2, cy); q.scale(1 / SLEEVE_STRETCH, 1); q.rotate(ang);
      q.filter = 'blur(3px)'; q.strokeStyle = '#000000'; q.lineWidth = 12; // a deep, soft fall (a faint one, #5a5a5a 7 wide, for a while: unseen)
      shape(q, stick + 10); q.stroke();
      q.filter = 'none'; q.fillStyle = '#ffffff';
      shape(q, stick); q.fill();
      q.restore();
    }
    q.restore();
  };
  withLogos(() => { grunge(g, r, W, H, WEAR_INK(d.base), 0.5, bump.hg); emboss(bump.hg); bump.bake(); drawBrand(); t.needsUpdate = true; if (rough) rough.needsUpdate = true; });
  return t;
}
