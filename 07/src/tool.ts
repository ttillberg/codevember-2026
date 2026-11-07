// The current tool, read every frame by the painter. Plain object, no React state: the UI writes, the brush reads.
import type { Brush } from './paint';

export type Finish = 'matte' | 'gloss' | 'metal';
export const FINISH: Record<Finish, { rough: number; metal: number }> = {
  matte: { rough: 0.85, metal: 0 },
  gloss: { rough: 0.18, metal: 0 },
  metal: { rough: 0.3, metal: 1 },
};

export const SWATCHES: { name: string; hex: string }[] = [
  { name: 'Cadmium red', hex: '#e63b2e' },
  { name: 'Marigold', hex: '#f6a21c' },
  { name: 'Lemon', hex: '#f4e04d' },
  { name: 'Leaf', hex: '#3fa34d' },
  { name: 'Cobalt', hex: '#2457c5' },
  { name: 'Violet', hex: '#7b3fbf' },
  { name: 'Rose', hex: '#f08cae' },
  { name: 'Titanium white', hex: '#f4f1ea' },
  { name: 'Ivory black', hex: '#1b1a19' },
];

export const tool = {
  brush: 'round' as Brush,
  finish: 'gloss' as Finish,
  hex: SWATCHES[0].hex,
  size: 0.06, // pole to pole units
  flow: 0.9,
  auto: false, // paint without holding the button
  liquid: 0.3, // 0 stiff paint that stays put, 1 thin paint with long legs
  watery: 0.5, // the glaze: 0 a firm blob, 1 a wide thin wash that spreads and mixes
};

const DEFAULTS = { ...tool };
export const resetTool = () => { Object.assign(tool, DEFAULTS); };

// Remember the tool between visits. The UI writes straight into `tool`, so save after any click, slider move or key.
const KEY = 'codevember-07-tool';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  for (const k of Object.keys(tool) as (keyof typeof tool)[]) {
    if (typeof saved[k] === typeof tool[k]) (tool as Record<string, unknown>)[k] = saved[k];
  }
} catch { /* no storage, no memory */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tool)); } catch { /* ignore */ } };
for (const ev of ['click', 'input', 'keyup']) window.addEventListener(ev, save);

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  // sRGB to linear, the paint target is linear.
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
