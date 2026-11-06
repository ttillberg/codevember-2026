import { useSyncExternalStore } from 'react';

// Which planet is picked, if any: shared by the planets you click in the scene and the close up card.
let picked: string | null = null;
const listeners = new Set<() => void>();

export function pick(name: string | null) {
  picked = name;
  listeners.forEach((l) => l());
}

export function usePicked() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => picked,
  );
}
