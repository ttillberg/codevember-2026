// Light or dark. Starts from the system's choice, a pick in settings is kept. The page takes it from
// data-theme on <html>; the scene from the colours here, changed in place so nothing is rebuilt.
import { Color } from 'three';
import { uniform } from 'three/tsl';

export type Theme = 'light' | 'dark';
const KEY = 'codevember-07-theme';
const system: Theme = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
export let theme: Theme = (() => { try { const t = localStorage.getItem(KEY); return t === 'dark' || t === 'light' ? t : system; } catch { return system; } })();

// The shadow is given in linear rgb, as the shader takes it. The dark background is lifted: tone mapping presses the
// darks down, #2e2e2c comes out about #1c1c1a, the page's own dark. The room's reflections are dimmed in the dark, or
// the clear balloon glows like a lamp.
const LOOK: Record<Theme, { bg: string; rubber: string; shadow: [number, number, number]; shadowA: number; env: number }> = {
  light: { bg: '#e9e6e0', rubber: '#000000', shadow: [0.12, 0.11, 0.1], shadowA: 0.36, env: 1 },
  dark: { bg: '#2e2e2c', rubber: '#8f8e8b', shadow: [0, 0, 0], shadowA: 0.5, env: 0.35 },
};
export const envIntensity = () => LOOK[theme].env;
export const BG = new Color(LOOK[theme].bg);
export const uRubber = uniform(new Color(LOOK[theme].rubber)); // the clear rubber's edge: dark on light, light on dark
export const uShadow = uniform(new Color().setRGB(...LOOK[theme].shadow));
export const uShadowA = uniform(LOOK[theme].shadowA);

function apply() {
  document.documentElement.dataset.theme = theme;
  const l = LOOK[theme];
  BG.set(l.bg);
  (uRubber.value as Color).set(l.rubber);
  (uShadow.value as Color).setRGB(...l.shadow);
  uShadowA.value = l.shadowA;
}
apply();

export const setTheme = (t: Theme) => {
  theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  apply();
};
