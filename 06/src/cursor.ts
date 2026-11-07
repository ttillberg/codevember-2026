// The pointer over the scene says what a press would do: a hand to grab and turn the view, a closed hand while
// dragging, a pointing hand over a planet (click to fly to it), a crosshair with cmd (or ctrl) held (click to throw).
export const cursor = { over: false, drag: false, aim: false };
let el: HTMLElement | null = null;

export function updateCursor() {
  if (!el) return;
  el.style.cursor = cursor.drag ? 'grabbing' : cursor.aim ? 'crosshair' : cursor.over ? 'pointer' : 'grab';
}

// Watches the canvas and the keyboard; returns the cleanup.
export function watchCursor(canvas: HTMLElement) {
  el = canvas;
  const down = (e: PointerEvent) => e.button === 0 && !cursor.aim && ((cursor.drag = true), updateCursor());
  const up = () => ((cursor.drag = false), updateCursor());
  const keys = (e: KeyboardEvent) => ((cursor.aim = e.metaKey || e.ctrlKey), updateCursor());
  const away = () => ((cursor.aim = cursor.drag = false), updateCursor());
  canvas.addEventListener('pointerdown', down);
  addEventListener('pointerup', up);
  addEventListener('keydown', keys);
  addEventListener('keyup', keys);
  addEventListener('blur', away);
  updateCursor();
  return () => {
    canvas.removeEventListener('pointerdown', down);
    removeEventListener('pointerup', up);
    removeEventListener('keydown', keys);
    removeEventListener('keyup', keys);
    removeEventListener('blur', away);
    el = null;
  };
}
