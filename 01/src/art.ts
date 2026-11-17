import { isFold, type Net, type Panel, type V2 } from './net';

// What is printed: flat colour, ink outlines, drawn in sheet coordinates (y up) and clipped to
// each panel by the sheet. The pieces here are shared; each building draws its own panels.

export const C = {
  ink: '#2a2622',
  frame: '#f7f3ea',
  glass: '#3d6b70',
  tab: '#f4efe4',
  hatch: '#d8d0bf',
  paper: '#fbf9f4',
  back: '#f6f3ec',
};

export const r = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
export const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
export const poly = (pts: V2[], fill: string, extra = '') =>
  `<polygon points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${fill}" ${extra}/>`;
export const inked = (w = 0.5) => `stroke="${C.ink}" stroke-width="${w}"`;

export interface WindowStyle { frame?: string; glass?: string; bars?: 'cross' | 'six' | 'none'; sill?: boolean }

// a window: frame, glass, bars, a sill
export function window(x: number, y: number, w = 7, h = 12, s: WindowStyle = {}) {
  const frame = s.frame ?? C.frame;
  const f = Math.min(1, w * 0.14);
  let out = r(x, y, w, h, frame, inked()) + r(x + f, y + f, w - 2 * f, h - 2 * f, s.glass ?? C.glass);
  const bars = s.bars ?? 'six';
  if (bars !== 'none') {
    out += line(x + w / 2, y + f, x + w / 2, y + h - f, frame, 0.8);
    out += line(x + f, y + h * 0.62, x + w - f, y + h * 0.62, frame, 0.8);
    if (bars === 'six') out += line(x + f, y + h * 0.32, x + w - f, y + h * 0.32, frame, 0.5);
  }
  if (s.sill ?? true) out += r(x - 0.6, y - 0.8, w + 1.2, 0.8, frame, inked());
  return out;
}

export function door(x: number, y: number, w: number, h: number, leaf: string, frame = C.frame) {
  return (
    r(x - 1, y, w + 2, h + 1, frame, inked()) +
    r(x, y, w, h - 4, leaf, inked()) +
    r(x + 0.6, y + h - 3.4, w - 1.2, 2.8, C.glass) + // transom
    line(x + w / 2, y + 1.5, x + w / 2, y + h - 5.5, C.ink, 0.4) +
    `<circle cx="${x + w / 2 + 1}" cy="${y + (h - 4) / 2}" r="0.4" fill="${frame}"/>`
  );
}

// windows spread evenly across a width
export function row(x0: number, width: number, y: number, n: number, w = 7, h = 12, s: WindowStyle = {}) {
  const gap = (width - n * w) / (n + 1);
  let out = '';
  for (let i = 0; i < n; i++) out += window(x0 + gap + i * (w + gap), y, w, h, s);
  return out;
}

// roof tiles on a rectangle: courses parallel to the eave, joints staggered, a ridge cap
export function tiles(x0: number, y0: number, w: number, L: number, eaveAtBottom: boolean, fill: string, dark: string) {
  let s = r(x0, y0, w, L, fill);
  const course = 4;
  for (let i = 1; i * course < L; i++) {
    const y = eaveAtBottom ? y0 + i * course : y0 + L - i * course;
    s += line(x0, y, x0 + w, y, dark, 0.5);
    const off = i % 2 ? 0 : 2.5;
    for (let x = x0 + off; x < x0 + w; x += 5) {
      const yb = eaveAtBottom ? y - course : y;
      s += line(x, yb, x, yb + course, dark, 0.35);
    }
  }
  s += r(x0, eaveAtBottom ? y0 + L - 2 : y0, w, 2, dark);
  return s;
}

// a panel's box in sheet mm
export function box(p: Panel) {
  const xs = p.poly.map((v) => v[0]);
  const ys = p.poly.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// glue tabs: plain card, hatched
export function tabArt(p: Panel) {
  const { x0, y0, x1, y1 } = box(p);
  let s = r(x0, y0, x1 - x0, y1 - y0, C.tab);
  for (let k = x0 - (y1 - y0); k < x1; k += 2.2) s += line(k, y0, k + (y1 - y0), y1, C.hatch, 0.35);
  return s;
}

// art in a panel's own frame: o its origin, u along its hinge, v away from it (all sheet mm)
export function framed(o: V2, u: V2, art: string) {
  const v: V2 = [-u[1], u[0]];
  return `<g transform="matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${o[0]} ${o[1]})">${art}</g>`;
}

export type Art = (p: Panel) => string;

// The whole printed sheet as one SVG, mm in, y up flipped to SVG's y down: the texture.
// back: the blank side, its fold lines scored, and whatever a building prints there.
export function sheetSvg(
  net: Net, art: Art, sheet: { x: number; y: number; w: number; h: number }, pxPerMm: number, back = false, backArt?: Art,
) {
  const pts = (poly: V2[]) => poly.map(([x, y]) => `${x},${y}`).join(' ');
  let defs = '';
  let ink = '';
  let folds = '';
  for (const p of net.panels) {
    defs += `<clipPath id="clip-${p.id}"><polygon points="${pts(p.poly)}"/></clipPath>`;
    const a = back ? backArt?.(p) : art(p);
    if (a) ink += `<g clip-path="url(#clip-${p.id})">${a}</g>`;
    for (let i = 0; i < p.poly.length; i++) {
      const u = p.poly[i];
      const w = p.poly[(i + 1) % p.poly.length];
      if (isFold(net, p, u, w)) folds += `M${u[0]} ${u[1]}L${w[0]} ${w[1]}`;
    }
  }
  const W = Math.round(sheet.w * pxPerMm);
  const H = Math.round(sheet.h * pxPerMm);
  const scored = back
    ? `<path d="${folds}" fill="none" stroke="#b9b1a2" stroke-width="0.45" stroke-dasharray="2 1.4"/>`
    : `<path d="${folds}" fill="none" stroke="${C.ink}" stroke-width="0.3" stroke-dasharray="1.6 1.2" opacity="0.7"/>`;
  return {
    W, H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${sheet.x} ${-sheet.y - sheet.h} ${sheet.w} ${sheet.h}">
  <defs>${defs}</defs>
  <g transform="scale(1,-1)">
    <rect x="${sheet.x}" y="${sheet.y}" width="${sheet.w}" height="${sheet.h}" fill="${back ? C.back : C.paper}"/>
    ${ink}
    ${scored}
  </g>
</svg>`,
  };
}

// draw in a hinged panel's own frame: origin the middle of its hinge, x along it, y into it
export function onPanel(p: Panel, art: string) {
  const [a, b] = p.hinge!;
  const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  // y (x turned left) must point into the panel
  const c = p.poly.reduce<V2>((s, q) => [s[0] + q[0] / p.poly.length, s[1] + q[1] / p.poly.length], [0, 0]);
  if ((c[0] - m[0]) * -u[1] + (c[1] - m[1]) * u[0] < 0) u = [-u[0], -u[1]];
  return framed(m, u, art);
}

// rows of shingles or slates: courses with staggered joints
export function shingles(x0: number, x1: number, y0: number, y1: number, fill: string, dark: string, course = 2.4) {
  let s = r(x0, y0, x1 - x0, y1 - y0, fill);
  for (let i = 0, y = y0 + course; y < y1; i++, y += course) {
    s += line(x0, y, x1, y, dark, 0.35);
    for (let x = x0 + (i % 2 ? course / 2 : 0); x < x1; x += course) s += line(x, y - course, x, y, dark, 0.2);
  }
  return s;
}
