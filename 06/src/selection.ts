import { useSyncExternalStore } from 'react';

// Which planet is picked, if any: shared by the planets you click in the scene and the close up card.
let picked: string | null = null;
const listeners = new Set<() => void>();

export function pick(name: string | null) {
  picked = name;
  listeners.forEach((l) => l());
}

// Whether a key press is someone typing into a field (the date), so the keyboard shortcuts leave it alone.
export const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement;

// The picked planet right now, for frame loops that mustn't re-render.
export const pickedNow = () => picked;

export function usePicked() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => picked,
  );
}
