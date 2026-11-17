import { create } from 'zustand';
import { kept } from './keep';
import { modelById } from './models';

// What the page around the scene shows, and the buttons' doings. The game writes it, the HUD
// reads it. Kept apart from the game so editing either leaves the other be.

// a building standing on the board: where (mm, board centre 0,0) and how many quarter turns
export interface Placed { key: string; id: string; x: number; z: number; turn: number }

export interface Hud {
  model: string | null; // the sheet on the mat, none while picking or at the board
  board: boolean; // at the board
  hint: string;
  canUndo: boolean;
  canRedo: boolean;
  ready: boolean; // built and standing: it can go on the board
  town: Placed[];
  actions: { undo(): void; redo(): void; flip(): void; reset(): void };
}

const nothing = () => {};
const q = new URLSearchParams(location.search);
// a reload carries on with the card it had; ?model=id starts on one (?cut alone: the first)
const start = modelById(kept()?.model) ?? modelById(q.get('model')) ?? (q.has('cut') ? modelById('lillatorg') : null);

// the board lives in this browser
const TOWN = 'day-01:town';
function load(): Placed[] {
  try {
    const t = JSON.parse(localStorage.getItem(TOWN) ?? '[]');
    return Array.isArray(t) ? t.filter((p) => modelById(p.id)) : [];
  } catch {
    return [];
  }
}

export const useHud = create<Hud>(() => ({
  model: start?.id ?? null,
  board: !start && q.has('board'),
  hint: '',
  canUndo: false,
  canRedo: false,
  ready: false,
  town: load(),
  actions: { undo: nothing, redo: nothing, flip: nothing, reset: nothing },
}));

useHud.subscribe((s, was) => {
  if (s.town === was.town) return;
  try { localStorage.setItem(TOWN, JSON.stringify(s.town)); } catch { /* private mode: this visit only */ }
});

export const setTown = (f: (t: Placed[]) => Placed[]) => useHud.setState((s) => ({ town: f(s.town) }));
