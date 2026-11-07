// Light or dark. Starts from the system's choice, a pick in settings is kept. The page takes it from
// data-theme on <html>; the scene from the colours here, changed in place so nothing is rebuilt.
import { Color } from 'three';
import { uniform } from 'three/tsl';

export type Theme = 'light' | 'dark';
const KEY = 'codevember-07-theme';
const system: Theme = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
// Dark mode is parked for now: always light, whatever the system or a saved pick says. Flip to bring it back.
export const DARK_ENABLED = false;
export let theme: Theme = !DARK_ENABLED ? 'light' : (() => { try { const t = localStorage.getItem(KEY); return t === 'dark' || t === 'light' ? t : system; } catch { return system; } })();

// The shadow is given in linear rgb, as the shader takes it. Dark is plain black. The room's reflections are dimmed
// in the dark, or the clear balloon glows like a lamp.
// rim: the pale glow along the edge. In the dark the edge is kept faint, a hint of the rubber, not a halo.
const LOOK: Record<Theme, { bg: string; rubber: string; shadow: [number, number, number]; shadowA: number; env: number; rim: number }> = {
  light: { bg: '#e9e6e0', rubber: '#000000', shadow: [0.12, 0.11, 0.1], shadowA: 0.36, env: 1, rim: 0.35 },
  dark: { bg: '#000000', rubber: '#3a3a38', shadow: [0, 0, 0], shadowA: 0.5, env: 0.2, rim: 0.06 },
};
export const envIntensity = () => LOOK[theme].env;
export const BG = new Color(LOOK[theme].bg);
export const uRubber = uniform(new Color(LOOK[theme].rubber)); // the clear rubber's edge: dark on light, light on dark
export const uShadow = uniform(new Color().setRGB(...LOOK[theme].shadow));
export const uShadowA = uniform(LOOK[theme].shadowA);
export const uRim = uniform(LOOK[theme].rim);

function apply() {
  document.documentElement.dataset.theme = theme;
  const l = LOOK[theme];
  BG.set(l.bg);
  (uRubber.value as Color).set(l.rubber);
  (uShadow.value as Color).setRGB(...l.shadow);
  uShadowA.value = l.shadowA;
  uRim.value = l.rim;
}
apply();

export const setTheme = (t: Theme) => {
  theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  apply();
};
