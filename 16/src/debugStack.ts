// ?debug: the panels (look, soundboard) stacked in one column on the right, scrolling together when they are taller
// than the screen. Each panel folds to its header on its own.
let stack: HTMLElement | null = null;

export function debugStack() {
  if (stack) return stack;
  const style = document.createElement('style');
  style.textContent = `.debug-stack { position: fixed; z-index: 20; top: 70px; right: 12px; width: 300px; max-height: calc(100vh - 82px);
  overflow: auto; display: flex; flex-direction: column; gap: 8px; }`;
  document.head.append(style);
  stack = document.createElement('div');
  stack.className = 'debug-stack';
  document.body.append(stack);
  return stack;
}
