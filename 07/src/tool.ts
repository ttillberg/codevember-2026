// The current tool, read every frame by the painter. Plain object, no React state: the UI writes, the brush reads.
import type { Brush } from './paint';

export type Finish = 'matte' | 'gloss' | 'metal';
export const FINISH: Record<Finish, { rough: number; metal: number }> = {
  matte: { rough: 0.97, metal: 0 },
  gloss: { rough: 0.18, metal: 0 },
  metal: { rough: 0.3, metal: 1 },
};

export const tool = {
  brush: 'bristle' as Brush,
  finish: 'gloss' as Finish,
  hex: '#00aaff', // a cyan blue, between cyan and blue: made from hue and shade
  hue: 0.5556, // round the wheel, 0 red .. 1 red again
  shade: 0.5, // 0 black, 0.5 the pure hue, 1 white
  size: 0.086, // pole to pole units, 40% along the size knob
  flow: 0.9,
  auto: false, // paint without holding the button
  inertia: true, // it keeps turning once let go
  liquid: 0.4, // 0 stiff paint that stays put, 1 thin paint with long legs
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
if (tool.brush === 'round' || (tool.brush as string) === 'flat') tool.brush = 'pencil'; // round is gone from the UI, flat is now pencil
// Written only when something changed: this runs on every click and key.
let saved = '';
export const save = () => {
  const s = JSON.stringify(tool);
  if (s === saved) return;
  saved = s;
  try { localStorage.setItem(KEY, s); } catch { /* ignore */ }
};
for (const ev of ['click', 'input', 'keyup']) window.addEventListener(ev, save);

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  // sRGB to linear, the paint target is linear.
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
