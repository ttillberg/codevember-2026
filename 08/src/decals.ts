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

const BRANDS = ['ASYNC SYSTEMS', '非同期システム', 'HYPER//CUBE', 'テッセラクト', 'ASYNC SYSTEMS', '超立方体 UNIT 77'];
const SMALL = ['4D · 2.60 · STICKY', 'FIELD SVC 2 · 非同期', 'MAX 2.5 BAR', 'W-AXIS ONLY', 'ASYNC//SYSTEMS · UNIT 77', 'TELESCOPIC · 3 STG'];

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

  // brand, round the tube. The cylinder's u runs the other way round, so text round it is drawn mirrored.
  if (has.brand) {
  g.save();
  g.translate(W, 0);
  g.scale(-1, 1);
  g.fillStyle = d.ink;
  g.font = '800 46px "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.textBaseline = 'middle';
  const brand = pick(BRANDS);
  const bx = Math.floor(r() * 120);
  g.fillText(brand, bx, 110);
  g.fillText(brand, bx + W, 110);
  g.font = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif';
  if (r() < 0.5) g.fillText(pick(SMALL), bx + 2, 150 + 16);
  g.restore();
  }

  // serial, along the tube
  if (has.serial) {
  g.save();
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
  g.translate(40, 200);
  let x = 0;
  while (x < 150) {
    const w = 2 + Math.floor(r() * 5);
    if (r() < 0.55) g.fillRect(x, 0, w, 120);
    x += w + 2;
  }
  g.font = '500 14px Menlo, monospace';
  g.translate(150, 140);
  g.scale(-1, 1);
  g.fillText(`${d.serial.replace('—', '')}-${Math.floor(r() * 9000 + 1000)}`, 0, 0);
  g.restore();
  }

  // a coloured tab, and a black one
  if (has.tab) {
    g.fillStyle = d.accent;
    g.fillRect(220 + Math.floor(r() * 60), 210, 44, 16);
    g.fillStyle = d.ink;
    g.fillRect(220 + Math.floor(r() * 60), 236, 70, 6);
  }
  // a little pictogram: the net of a cube
  if (has.picto) {
    g.fillStyle = d.ink;
    const px = 300, py = 290;
    for (const [i, j] of [[0, 0], [1, 0], [2, 0], [1, 1], [1, -1], [3, 0]]) g.fillRect(px + i * 22, py + j * 22, 18, 18);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
