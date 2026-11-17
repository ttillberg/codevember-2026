import type { Saved } from './game';
import type { Placed } from './hud';
import { modelById } from './models';
import { fresh, signature, upgrade, type Store } from './upgrade';

// What this browser keeps of the day: the board and what stands on it, every sheet left part
// done, where you were. One record under one key, versioned (see upgrade).

const KEY = 'day-01:save';
const OLD_TOWN = 'day-01:town'; // before the record, version 0

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return upgrade(JSON.parse(raw));
    const town = JSON.parse(localStorage.getItem(OLD_TOWN) ?? '[]');
    localStorage.removeItem(OLD_TOWN);
    return upgrade({ v: 0, town });
  } catch {
    return fresh();
  }
}
const store = read();
function write() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode, or full: this visit only */ }
}
write();

export const kept = () => store;
export function setTown(town: Placed[]) { store.town = town; write(); }
export function setAt(at: string | null) { if (store.at !== at) { store.at = at; write(); } }
export const card = (id: string) => store.cards[id]?.card ?? null;
export function putCard(s: Saved) {
  const m = modelById(s.model);
  if (!m) return;
  store.cards[s.model] = { sig: signature(m.net), card: s };
  write();
}
export function dropCard(id: string) { if (store.cards[id]) { delete store.cards[id]; write(); } }

// the sheet on the mat now: kept every few seconds, and as the page goes away
let live: (() => Saved) | null = null;
export function watch(save: (() => Saved) | null) { live = save; }
const flush = () => { if (live) putCard(live()); };
const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', hidden);
const every = setInterval(flush, 4000);
import.meta.hot?.dispose(() => {
  flush();
  removeEventListener('pagehide', flush);
  document.removeEventListener('visibilitychange', hidden);
  clearInterval(every);
});
