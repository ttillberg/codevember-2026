import { create } from 'zustand';
import { kept } from './keep';
import { modelById } from './models';

// What the page around the scene shows, and the buttons' doings. The game writes it, the HUD
// reads it. Kept apart from the game so editing either leaves the other be.

export interface Hud {
  model: string | null; // the card on the mat, none while picking
  hint: string;
  canUndo: boolean;
  canRedo: boolean;
  actions: { undo(): void; redo(): void; flip(): void; reset(): void };
}

const nothing = () => {};
const q = new URLSearchParams(location.search);
// a reload carries on with the card it had; ?model=id starts on one (?cut alone: the first)
const start = modelById(kept()?.model) ?? modelById(q.get('model')) ?? (q.has('cut') ? modelById('lillatorg') : null);

export const useHud = create<Hud>(() => ({
  model: start?.id ?? null,
  hint: '',
  canUndo: false,
  canRedo: false,
  actions: { undo: nothing, redo: nothing, flip: nothing, reset: nothing },
}));
