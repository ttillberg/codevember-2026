import { create } from 'zustand';
import { kept, setAt, setTown as keepTown } from './store';
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
  // a quarter turn of the view about what is on the mat: +1 the way a drag to the right goes
  turnView(dir: number): void;
  // the buttons' zoom: in by a factor, out below 1 (never past the fit)
  zoom(f: number): void;
  // spin: a quarter turn about up, +1 the near side going right; tip: a quarter turn over,
  // the top falling the way of the screen drag (dx, dy)
  actions: { undo(): void; redo(): void; flip(): void; reset(): void; spin(dir: number): void; tip(dx: number, dy: number): void };
}

const nothing = () => {};
const q = new URLSearchParams(location.search);
// ?model=id starts on that sheet (?cut alone: the first), ?board at the board; else where you
// were last time
const saved = kept();
const asked = modelById(q.get('model')) ?? (q.has('cut') ? modelById('lillatorg') : null);
const start = asked ?? (q.has('board') ? null : modelById(saved.at));

export const useHud = create<Hud>(() => ({
  model: start?.id ?? null,
  board: !start && (q.has('board') || saved.at === 'board'),
  hint: '',
  canUndo: false,
  canRedo: false,
  ready: false,
  town: saved.town,
  turnView: nothing,
  zoom: nothing,
  actions: { undo: nothing, redo: nothing, flip: nothing, reset: nothing, spin: nothing, tip: nothing },
}));

// the board and where you are live in this browser (see store)
const where = (s: Hud) => s.model ?? (s.board ? 'board' : null);
setAt(where(useHud.getState()));
useHud.subscribe((s, was) => {
  if (s.town !== was.town) keepTown(s.town);
  if (s.model !== was.model || s.board !== was.board) setAt(where(s));
});

export const setTown = (f: (t: Placed[]) => Placed[]) => useHud.setState((s) => ({ town: f(s.town) }));
