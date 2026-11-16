import { create } from 'zustand';

// What the page around the scene shows, and the buttons' doings. The game writes it, the HUD
// reads it. Kept apart from the game so editing either leaves the other be.

export interface Hud {
  hint: string;
  canUndo: boolean;
  canRedo: boolean;
  actions: { undo(): void; redo(): void; flip(): void; reset(): void };
}

const nothing = () => {};

export const useHud = create<Hud>(() => ({
  hint: '',
  canUndo: false,
  canRedo: false,
  actions: { undo: nothing, redo: nothing, flip: nothing, reset: nothing },
}));
