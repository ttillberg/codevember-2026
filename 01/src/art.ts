import { isFold, type House, type Panel } from './net';

// What is printed on each panel: a Nyhavn-ish facade in flat colour, ink outlines.
// Drawn in sheet coordinates (y up), clipped to the panel by the caller.

export const C = {
  ink: '#2a2622',
  wall: '#eeb33f',
  roof: '#d6582f',
  roofDark: '#b8441f',
  frame: '#f7f3ea',
  glass: '#3d6b70',
  door: '#2f5d48',
  plinth: '#8f8a80',
  base: '#d9d2c3',
  tab: '#f4efe4',
  hatch: '#d8d0bf',
  paper: '#fbf9f4',
};

const r = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;
const inked = `stroke="${C.ink}" stroke-width="0.5"`;

// a six-pane window: white frame, dark glass, cross bars
function window(x: number, y: number, w = 7, h = 12) {
  const f = 1;
  return (
    r(x, y, w, h, C.frame, inked) +
    r(x + f, y + f, w - 2 * f, h - 2 * f, C.glass) +
    line(x + w / 2, y + f, x + w / 2, y + h - f, C.frame, 0.8) +
    line(x + f, y + h * 0.62, x + w - f, y + h * 0.62, C.frame, 0.8) +
    line(x + f, y + h * 0.32, x + w - f, y + h * 0.32, C.frame, 0.5) +
    r(x - 0.6, y - 0.8, w + 1.2, 0.8, C.frame, inked) // sill
  );
}

function door(x: number, y: number, w = 9, h = 17) {
  return (
    r(x - 1, y, w + 2, h + 2, C.frame, inked) +
    r(x, y, w, h - 4, C.door, inked) +
    r(x + 0.6, y + h - 3.4, w - 1.2, 2.8, C.glass) + // transom
    line(x + w / 2, y + 1.5, x + w / 2, y + h - 5.5, C.ink, 0.4) +
    r(x + 1.2, y + 2, w / 2 - 2, h - 8, 'none', `stroke="${C.ink}" stroke-width="0.3"`) +
    r(x + w / 2 + 0.8, y + 2, w / 2 - 2, h - 8, 'none', `stroke="${C.ink}" stroke-width="0.3"`) +
    `<circle cx="${x + w / 2 + 1}" cy="${y + (h - 4) / 2}" r="0.4" fill="${C.frame}"/>` +
    r(x - 2, y - 1.5, w + 4, 1.5, C.plinth, inked) // step
  );
}

// windows spread evenly across a width
function row(x0: number, width: number, y: number, n: number, w = 7, h = 12) {
  const gap = (width - n * w) / (n + 1);
  let s = '';
  for (let i = 0; i < n; i++) s += window(x0 + gap + i * (w + gap), y, w, h);
  return s;
}

function wallBands(x0: number, width: number, H: number) {
  return r(x0, 0, width, 5, C.plinth) + line(x0, 5, x0 + width, 5, C.ink, 0.4) +
    r(x0, H - 4, width, 4, C.frame) + line(x0, H - 4, x0 + width, H - 4, C.ink, 0.4);
}

function gableArt(h: House, x0: number, front: boolean) {
  const { W, H, R } = h;
  let s = r(x0, 0, W, H + R, C.wall) + wallBands(x0, W, H);
  if (front) {
    s += door(x0 + W / 2 - 4.5, 5, 9, 17);
    s += window(x0 + 4, 9, 7, 11) + window(x0 + W - 11, 9, 7, 11);
  } else {
    s += row(x0, W, 9, 3, 7, 11);
  }
  s += row(x0, W, 30, 3) + row(x0, W, 51, 3);
  // attic: one window and an oculus under the peak
  s += window(x0 + W / 2 - 3.5, H + 2, 7, 10);
  s += `<circle cx="${x0 + W / 2}" cy="${H + R - 7}" r="2.4" fill="${C.glass}" stroke="${C.frame}" stroke-width="0.9"/>`;
  return s;
}

function sideArt(h: House, x0: number) {
  const { D, H } = h;
  return r(x0, 0, D, H, C.wall) + wallBands(x0, D, H) + row(x0, D, 9, 4, 7, 11) + row(x0, D, 30, 4) + row(x0, D, 51, 4);
}

// tiles: courses parallel to the eave, joints staggered
function roofArt(h: House, p: Panel) {
  const [x0, y0] = p.origin;
  const { D, L, H } = h;
  const eaveAtBottom = Math.abs(y0 - H) < 1e-6;
  let s = r(x0, y0, D, L, C.roof);
  const course = 4;
  for (let i = 1; i * course < L; i++) {
    const y = eaveAtBottom ? y0 + i * course : y0 + L - i * course;
    s += line(x0, y, x0 + D, y, C.roofDark, 0.5);
    const off = i % 2 ? 0 : 2.5;
    for (let x = x0 + off; x < x0 + D; x += 5) {
      const yb = eaveAtBottom ? y - course : y;
      s += line(x, yb, x, yb + course, C.roofDark, 0.35);
    }
  }
  // ridge cap on the shared ridge edge
  const ridge = eaveAtBottom ? y0 + L - 2 : y0;
  s += r(x0, ridge, D, 2, C.roofDark);
  return s;
}

function tabArt(p: Panel) {
  const xs = p.poly.map((v) => v[0]);
  const ys = p.poly.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let s = r(x0, y0, x1 - x0, y1 - y0, C.tab);
  for (let k = x0 - (y1 - y0); k < x1; k += 2.2) s += line(k, y0, k + (y1 - y0), y1, C.hatch, 0.35);
  return s;
}

export function panelArt(h: House, p: Panel) {
  switch (p.face) {
    case 'front': return gableArt(h, p.origin[0], true);
    case 'back': return gableArt(h, p.origin[0], false);
    case 'side': return sideArt(h, p.origin[0]);
    case 'roof': return roofArt(h, p);
    case 'base': return r(p.origin[0], p.origin[1], h.W, h.D, C.base);
    case 'tab': return tabArt(p);
  }
}

// The whole printed sheet as one SVG, mm in, y up flipped to SVG's y down: the texture.
export function sheetSvg(h: House, sheet: { x: number; y: number; w: number; h: number }, pxPerMm: number, back = false) {
  const pts = (poly: [number, number][]) => poly.map(([x, y]) => `${x},${y}`).join(' ');
  let defs = '';
  let art = '';
  let folds = '';
  for (const p of h.panels) {
    defs += `<clipPath id="clip-${p.id}"><polygon points="${pts(p.poly)}"/></clipPath>`;
    art += `<g clip-path="url(#clip-${p.id})">${panelArt(h, p)}</g>`;
    for (let i = 0; i < p.poly.length; i++) {
      const a = p.poly[i];
      const c = p.poly[(i + 1) % p.poly.length];
      const seg = `M${a[0]} ${a[1]}L${c[0]} ${c[1]}`;
      if (isFold(h, p, a, c)) folds += seg;
    }
  }
  const W = Math.round(sheet.w * pxPerMm);
  const H = Math.round(sheet.h * pxPerMm);
  return {
    W, H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${sheet.x} ${-sheet.y - sheet.h} ${sheet.w} ${sheet.h}">
  <defs>${defs}</defs>
  <g transform="scale(1,-1)">
    <rect x="${sheet.x}" y="${sheet.y}" width="${sheet.w}" height="${sheet.h}" fill="${back ? '#f6f3ec' : C.paper}"/>
    ${back ? `<path d="${folds}" fill="none" stroke="#b9b1a2" stroke-width="0.45" stroke-dasharray="2 1.4"/>` : `${art}
    <path d="${folds}" fill="none" stroke="${C.ink}" stroke-width="0.3" stroke-dasharray="1.6 1.2" opacity="0.7"/>
`}
  </g>
</svg>`,
  };
}
