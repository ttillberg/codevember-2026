// The colour as two knobs: a hue round the wheel, and a brightness from black through the pure hue (at the middle)
// to white. Both live on `tool` so they're remembered; tool.hex, which the painter reads, is made from them.
import { tool } from './tool';

type RGB = [number, number, number]; // 0..255
const HUES: RGB[] = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 0, 0]];
const hex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function hueRgb(h: number): RGB {
  const x = Math.min(0.99999, Math.max(0, h)) * 6, i = Math.floor(x), k = x - i;
  const a = HUES[i], b = HUES[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
export function compose(h: number, s: number) {
  const c = hueRgb(h);
  if (s < 0.5) return hex(c.map((v) => v * s * 2) as RGB);
  const w = (s - 0.5) * 2;
  return hex(c.map((v) => v + (255 - v) * w) as RGB);
}

// Back from a hex (one set elsewhere, a preset from before): the nearest hue and brightness.
function derive(x: string) {
  const n = parseInt(x.slice(1), 16), c: RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mx = Math.max(...c), mn = Math.min(...c);
  if (mx === mn) return { hue: tool.hue, shade: mx / 255 }; // a grey: keep the hue, as dark or light as it is
  let shade: number, base: RGB;
  if (mx < 255 || mn === 0) { shade = mx / 510; base = c.map((v) => (v - mn) / (mx - mn) * 255) as RGB; }
  else { shade = 0.5 + mn / 510; base = c.map((v) => (v - mn) / (255 - mn) * 255) as RGB; }
  const [r, g, b] = base.map((v) => v / 255), d = Math.max(r, g, b) - Math.min(r, g, b);
  let h = Math.max(r, g, b) === r ? ((g - b) / d) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h / 6) % 1 + 1) % 1;
  return { hue: h, shade };
}
// Keep hue and brightness in step with tool.hex, wherever it came from.
export function syncColour() {
  if (compose(tool.hue, tool.shade) === tool.hex) return;
  const d = derive(tool.hex);
  tool.hue = d.hue; tool.shade = d.shade;
}
export function setColour(h: number, s: number) {
  tool.hue = h; tool.shade = s; tool.hex = compose(h, s);
}
