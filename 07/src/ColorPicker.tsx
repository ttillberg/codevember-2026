import { useEffect, useState, type PointerEvent } from 'react';
import { tool } from './tool';

// One rectangle with every colour: hue across, white at the top through the pure colour in the middle to black at
// the bottom. x and y are 0..1 positions in it.
type Pos = { x: number; y: number };

function toHex({ x, y }: Pos) {
  const h = x * 360, s = y < 0.5 ? y * 2 : 1, v = y < 0.5 ? 1 : (1 - y) * 2;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Where a colour sits in the rectangle, or null when it is not in it (the greys, a swatch from the old UI).
function posOf(hex: string): Pos | null {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const s = d / max, v = max;
  const pos = v > 0.995 ? { x: h / 360, y: s / 2 } : s > 0.995 ? { x: h / 360, y: 1 - v / 2 } : null;
  return pos && toHex(pos) === hex ? pos : null;
}

export function ColorPicker() {
  const [pos, setPos] = useState<Pos | null>(() => posOf(tool.hex));
  // The colour changed elsewhere (the old UI): follow it, or hide the marker if it isn't in the rectangle.
  useEffect(() => { if (!pos || toHex(pos) !== tool.hex) setPos(posOf(tool.hex)); });
  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const next = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    tool.hex = toHex(next);
    setPos(next);
  };
  return (
    <div
      className="cp"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}
    >
      {pos && <i style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, background: tool.hex }} />}
    </div>
  );
}
