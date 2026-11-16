// The faces of sixties housing: slab blocks with open galleries, painted estates, striped towers.
// Drawn once on a canvas, four bays by four floors a sheet, and tiled over the walls.
// Alpha says how much of the building's own paint shows through.
// A second sheet of each says what shines after dark: the rooms behind the glass, each with its own lamp.
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { rng } from './net';

/** metres a bay is wide and a floor is high */
export const BAY = 3.2, FLOOR = 3;
/** bays and floors on one sheet */
export const CELLS = 4;
export const GALLERY = 0, PAINTED = 1, STRIPED = 2, BANDED = 3, LOW = 4;

const C = 128, S = C * CELLS;
// the lamps people have: mostly warm bulbs, some cold tubes, a television
const LAMPS = ['#ffd596', '#ffd596', '#ffc97a', '#ffe2b4', '#e4ecff', '#d2e6ff', '#fff0d0', '#9fc0ff'];
const CLOTH = ['#f4f1ea', '#f4f1ea', '#e9e2d0', '#c7473f', '#2f5fa8', '#2c2f36', '#e3b23c', '#e58fa6', '#3d9a86', '#7fb0d8'];

interface Pen {
  r: () => number;
  /** a flat patch; tint is how much of the house paint it takes */
  box(x: number, y: number, w: number, h: number, fill: string, tint?: number): void;
  /** darken from top to bottom, for the shade under a slab and the dirt on a wall */
  shade(x: number, y: number, w: number, h: number, top: number, bottom: number): void;
  /** what shines here at night, and black where something stands in front of it */
  lit(x: number, y: number, w: number, h: number, fill: string): void;
}

const pick = <T>(p: Pen, a: T[]) => a[(p.r() * a.length) | 0];

/** washing on a pole */
function wash(p: Pen, x0: number, x1: number, y: number) {
  p.box(x0, y - 1, x1 - x0, 1.5, '#8a8f8c');
  for (let x = x0 + p.r() * 6; x < x1 - 8;) {
    const w = 5 + p.r() * 8, h = 9 + p.r() * 14;
    p.box(x, y, w, h, pick(p, CLOTH));
    x += w + 1 + p.r() * 5;
  }
}

/** the box of an air conditioner */
function cooler(p: Pen, x: number, y: number) {
  p.shade(x - 1, y + 11, 19, 7, 0.3, 0);
  p.box(x, y, 17, 12, '#d9d8d1');
  p.box(x + 2, y + 2, 9, 8, '#7f8584');
  p.box(x + 13, y + 2, 2, 8, '#a9adaa');
}

function pane(p: Pen, x: number, y: number, w: number, h: number, frame = '#d7d5cc') {
  p.box(x, y, w, h, frame);
  const n = Math.max(1, Math.round(w / 22)), pw = (w - 3) / n;
  for (let i = 0; i < n; i++) {
    const k = p.r();
    // most are dark, some have a curtain drawn or the light on
    const glass = k < 0.6 ? '#2f3a41' : k < 0.75 ? '#4e5b62' : k < 0.88 ? pick(p, ['#b9a98a', '#8fa39b', '#c9c2b4', '#a8848a']) : '#d9c98f';
    p.box(x + 3 + i * pw, y + 3, pw - 3, h - 6, glass);
    // behind a drawn curtain the lamp is the colour of the curtain
    p.lit(x + 3 + i * pw, y + 3, pw - 3, h - 6, k >= 0.75 && k < 0.88 ? glass : LAMPS[((k * 977) | 0) % LAMPS.length]);
    if (p.r() < 0.5) p.box(x + 3 + i * pw, y + 3 + (h - 6) * 0.45, pw - 3, 2, frame);
  }
}

/** Open galleries behind a white frame: doors with green shutters, the washing out over the rail. */
function gallery(p: Pen) {
  p.box(0, 0, C, C, '#33393d');
  // the back wall of the gallery, in the shade of the floor above
  p.box(0, 26, C, 92, '#a7a69c', 0.5);
  // one bulb for the whole gallery: its back wall glows a little
  p.lit(0, 26, C, 58, '#4a3a22');
  const door = pick(p, ['#2f8f7c', '#2f8f7c', '#3a7f96', '#6f8f5a']);
  const dx = 16 + p.r() * 14;
  p.box(dx, 34, 34, 84, door);
  p.lit(dx, 34, 34, 50, '#20180e');
  for (let y = 38; y < 116; y += 5) p.box(dx + 2, y, 30, 1.5, '#1f5f54');
  p.box(dx + 16.5, 34, 1.5, 84, '#1f5f54');
  if (p.r() < 0.8) pane(p, dx + 44, 44, 40, 42, door);
  p.shade(0, 12, C, 60, 0.7, 0.1);
  // rail
  p.box(0, 84, C, 3, '#e9e7df');
  p.box(0, 100, C, 2, '#d9d7cf');
  for (let x = 16; x < C; x += 16) p.box(x, 84, 1.5, 34, '#cfcdc5');
  if (p.r() < 0.7) wash(p, 14, C - 6, 20 + p.r() * 6);
  if (p.r() < 0.45) wash(p, 20, 20 + 40 + p.r() * 50, 87);
  if (p.r() < 0.35) cooler(p, 100 - p.r() * 60, 88);
  // slab edge and post
  p.box(0, 116, C, 12, '#ebe9e1', 0.15);
  p.box(0, 0, C, 10, '#ebe9e1', 0.15);
  p.shade(0, 0, C, 10, 0.25, 0.05);
  p.box(0, 0, 9, C, '#f0eee6', 0.1);
  p.box(9, 0, 2, C, '#b9b7ae');
  if (p.r() < 0.5) p.shade(20 + p.r() * 90, 118, 6 + p.r() * 10, 10, 0.25, 0);
}

/** A painted estate: wall in one strong colour, cream piers and slab lines, a window to a room and a cooler under it. */
function painted(p: Pen) {
  p.box(0, 0, C, C, '#f2f2f2', 1);
  p.box(18, 22, 96, 60, '#cfcfcf', 1);
  pane(p, 22, 26, 88, 52, '#e6dfc6');
  p.shade(18, 22, 96, 14, 0.45, 0);
  // the panel under the sill
  p.box(18, 84, 96, 30, '#dedede', 1);
  if (p.r() < 0.55) cooler(p, 26 + p.r() * 60, 88);
  if (p.r() < 0.4) { p.box(30, 82, 70, 2, '#9a9f9c'); wash(p, 32, 98, 84); }
  p.box(0, 116, C, 12, '#efe6c8');
  p.shade(0, 0, C, 8, 0.25, 0);
  p.box(0, 0, 11, C, '#efe6c8');
  p.box(11, 0, 2, C, '#b4b4b4', 1);
  if (p.r() < 0.4) p.shade(20 + p.r() * 80, 84, 8 + p.r() * 12, 32, 0.22, 0);
}

/** A tower in stripes: white, the paint, and lilac grey, floor after floor. */
function striped(p: Pen) {
  p.box(0, 0, C, C, '#c9c6d3');
  p.box(0, 0, 44, C, '#eeeef0');
  p.box(44, 0, 40, C, '#f0f0f0', 1);
  pane(p, 6, 30, 32, 44, '#dcdce0');
  pane(p, 90, 30, 32, 44, '#b3b0c0');
  if (p.r() < 0.6) pane(p, 52, 38, 24, 30, '#e8e8e8');
  for (const x of [6, 90]) if (p.r() < 0.45) cooler(p, x + p.r() * 14, 78);
  if (p.r() < 0.3) wash(p, 6, 40, 76);
  p.box(0, 120, C, 4, '#5d4f7c');
  p.box(0, 124, C, 4, '#eeeef0');
  p.shade(0, 0, C, 6, 0.2, 0);
  p.box(43, 0, 1.5, C, '#8d89a0');
  p.box(84, 0, 1.5, C, '#8d89a0');
}

/** A long block in bands: a ribbon of windows, and the paint on the wall under it. */
function banded(p: Pen) {
  p.box(0, 0, C, C, '#ecebe4');
  p.box(0, 20, C, 50, '#3a4348');
  const n = 3, w = C / n;
  for (let i = 0; i < n; i++) pane(p, i * w + 1, 22, w - 2, 46, '#e3e1d8');
  p.shade(0, 20, C, 16, 0.5, 0);
  p.box(0, 74, C, 44, '#f2f2f2', 1);
  p.shade(0, 74, C, 44, 0, 0.12);
  if (p.r() < 0.45) cooler(p, 10 + p.r() * 90, 76);
  if (p.r() < 0.35) wash(p, 10 + p.r() * 30, 80 + p.r() * 40, 72);
  p.box(0, 118, C, 10, '#ecebe4');
  p.shade(0, 0, C, 8, 0.2, 0);
  if (p.r() < 0.5) p.shade(p.r() * 110, 74, 5 + p.r() * 12, 44, 0.2, 0);
}

/** Shop, workshop, somebody's house: rendered wall, a window here and there, shutters. */
function low(p: Pen) {
  p.box(0, 0, C, C, '#f0f0f0', 1);
  p.shade(0, 0, C, C, 0, 0.1);
  if (p.r() < 0.65) {
    const x = 20 + p.r() * 40, w = 34 + p.r() * 24;
    pane(p, x, 34, w, 46, '#cfcabb');
    const sh = pick(p, ['#3d7f73', '#6a5a48', '#3f6f93', '#8a3f38']);
    p.box(x - 9, 34, 8, 46, sh);
    p.box(x + w + 1, 34, 8, 46, sh);
    p.shade(x - 9, 34, w + 18, 10, 0.35, 0);
    if (p.r() < 0.4) cooler(p, x + p.r() * (w - 17), 84);
  }
  if (p.r() < 0.6) p.shade(p.r() * 110, 0, 6 + p.r() * 14, 60 + p.r() * 60, 0.2, 0);
  p.box(0, 124, C, 4, '#d6d6d6', 1);
}

const STYLES = [gallery, painted, striped, banded, low];
/** The layer where a style's lights are: this many after its paint. */
export const GLOW = STYLES.length;

/** One sheet as paint, as mask and as lights, for looking at. */
export function sheet(style: number) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  };
  const col = make(), mask = make(), glow = make();
  const a = col.getContext('2d')!, b = mask.getContext('2d')!, g = glow.getContext('2d')!;
  for (const c of [b, g]) { c.fillStyle = '#000'; c.fillRect(0, 0, S, S); }
  const p: Pen = {
    r: rng(100 + style * 17),
    box(x, y, w, h, fill, tint = 0) {
      a.fillStyle = fill; a.fillRect(x, y, w, h);
      const g = Math.round(tint * 255);
      b.fillStyle = `rgb(${g},${g},${g})`; b.fillRect(x, y, w, h);
    },
    lit(x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); },
    shade(x, y, w, h, top, bottom) {
      const g = a.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, `rgba(20,24,28,${top})`);
      g.addColorStop(1, `rgba(20,24,28,${bottom})`);
      a.fillStyle = g; a.fillRect(x, y, w, h);
    },
  };
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      for (const c of [a, b, g]) c.setTransform(1, 0, 0, 1, i * C, j * C);
      STYLES[style](p);
    }
  }
  return { col, mask, glow };
}

let made: DataArrayTexture | null = null;

/** All the sheets as layers of one texture: the paint of every style, then the lights of every style. */
export function facades(): DataArrayTexture {
  if (made) return made;
  const data = new Uint8Array(S * S * 4 * STYLES.length * 2);
  STYLES.forEach((_, k) => {
    const { col, mask, glow } = sheet(k);
    const a = col.getContext('2d')!.getImageData(0, 0, S, S).data, b = mask.getContext('2d')!.getImageData(0, 0, S, S).data;
    const c = glow.getContext('2d')!.getImageData(0, 0, S, S).data;
    // the canvas counts rows from the top, the texture from the ground
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const from = (y * S + x) * 4, to = k * S * S * 4 + ((S - 1 - y) * S + x) * 4;
        data[to] = a[from]; data[to + 1] = a[from + 1]; data[to + 2] = a[from + 2]; data[to + 3] = b[from];
        const lit = to + GLOW * S * S * 4;
        data[lit] = c[from]; data[lit + 1] = c[from + 1]; data[lit + 2] = c[from + 2]; data[lit + 3] = 255;
      }
    }
  });
  const t = new DataArrayTexture(data, S, S, STYLES.length * 2);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return (made = t);
}
