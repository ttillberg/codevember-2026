import type { Saved } from './game';

// Dev: when Vite reloads the whole page (an edit no component takes), the card is saved just
// before and handed back on load. Hot updates don't come here: the scene carries those itself.

const KEY = 'day-01:card';
let live: (() => Saved) | null = null;

export function keep(save: () => Saved) {
  live = save;
}

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    if (!live) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(live())); } catch { /* private mode: start over */ }
  });
}

export function kept(): Saved | null {
  if (!import.meta.hot) return null;
  try {
    const s = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
