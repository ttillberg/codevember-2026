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

const BRANDS = ['CDVMBR 08', 'three.js', 'pmndrs', 'CDVMBR 08', 'ASYNC SYSTEMS'];
const SMALL = ['CODEVEMBER 2026 · DAY 08', 'R3F · DREI · THREE', 'MAX 2.5 BAR', 'W-AXIS ONLY', 'ASYNC//SYSTEMS · UNIT 08', 'TELESCOPIC · 3 STG'];

/** The three.js mark: a triangle cut into triangles, two levels down, in strokes. */
function threeMark(g: CanvasRenderingContext2D, x: number, y: number, size: number, depth: number) {
  const h = size * Math.sqrt(3) / 2;
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x + size, y); g.lineTo(x + size / 2, y + h); g.closePath();
  g.stroke();
  if (depth === 0) return;
  threeMark(g, x, y, size / 2, depth - 1);
  threeMark(g, x + size / 2, y, size / 2, depth - 1);
  threeMark(g, x + size / 4, y + h / 2, size / 2, depth - 1);
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
  const has = { hazard: r() < 0.35, brand: r() < 0.6, serial: r() < 0.5, barcode: r() < 0.3, tab: r() < 0.5, picto: r() < 0.25 };
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

  // brand, round the tube
  if (has.brand) {
  g.save();
  upright();
  g.fillStyle = d.ink;
  g.font = '800 46px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.textBaseline = 'middle';
  const brand = pick(BRANDS);
  const bx = Math.floor(r() * 120);
  if (brand === 'three.js') { // the mark before the word
    g.lineWidth = 3; g.strokeStyle = d.ink;
    threeMark(g, bx, 88, 44, 2); threeMark(g, bx + W, 88, 44, 2);
    g.fillText(brand, bx + 56, 110); g.fillText(brand, bx + W + 56, 110);
  } else {
    g.fillText(brand, bx, 110);
    g.fillText(brand, bx + W, 110);
  }
  g.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
  if (r() < 0.5) g.fillText(pick(SMALL), bx + 2, 150 + 16);
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
  // a little pictogram: the three.js mark
  if (has.picto) {
    g.lineWidth = 2.5; g.strokeStyle = d.ink;
    threeMark(g, 300, 280, 64, 2);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
