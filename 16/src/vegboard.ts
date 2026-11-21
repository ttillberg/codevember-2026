// ?debug: the vegetation panel, to see what each kind of plant does to the picture by taking it away. A checkbox
// per kind, on the meshes no other code shows and hides (the shadow pass hides some roots and cells for its draw:
// those are left alone). Stacked between the look panel and the soundboard; sizes and amounts come later.
import type * as THREE from 'three';
import { debugStack } from './debugStack';

const CSS = `
.vegboard { flex: none; padding: 10px 12px 12px; box-sizing: border-box; border-radius: 10px; background: rgba(14, 12, 8, 0.82);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px rgba(244, 244, 242, 0.18);
  color: #f4f4f2; font: 500 11px/1.3 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; user-select: none; }
.vegboard.folded > :not(header) { display: none !important; }
.vegboard header { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.vegboard header span { flex: 1; }
.vegboard button { padding: 4px 7px; border: 0; border-radius: 5px; background: rgba(244, 244, 242, 0.1); color: inherit; font: inherit; cursor: pointer; }
.vegboard button:hover { background: rgba(244, 244, 242, 0.2); }
.vegboard .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-top: 8px; }
.vegboard label { display: flex; gap: 6px; align-items: center; }
`;

export interface VegKind { name: string; objects: THREE.Object3D[] }

/** kinds: what each checkbox shows and hides; changed: called after, to draw the shadow map again */
export function vegboard(kinds: VegKind[], changed: () => void, actions: { label: string; run: () => void }[] = []) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('div');
  el.className = 'vegboard';
  for (const ev of ['pointerdown', 'pointerup', 'keydown', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
  const stack = debugStack();
  stack.insertBefore(el, stack.querySelector('.soundboard'));
  const add = <T extends HTMLElement = HTMLElement>(parent: HTMLElement, tag: string, props: object = {}): T => {
    const n = Object.assign(document.createElement(tag), props) as T;
    parent.append(n);
    return n;
  };

  const head = add(el, 'header');
  add(head, 'span', { textContent: 'Vegetation' });
  const boxes: HTMLInputElement[] = [];
  const all = add(head, 'button', { textContent: 'All' });
  all.onclick = () => {
    const on = boxes.some((b) => !b.checked);
    for (const b of boxes) { b.checked = on; b.onchange?.(new Event('change')); }
  };
  const fold = add(head, 'button', { textContent: '–' });
  fold.onclick = () => { el.classList.toggle('folded'); fold.textContent = el.classList.contains('folded') ? '+' : '–'; };

  const grid = add(el, 'div', { className: 'grid' });
  // jumps: to see a kind up close without walking there
  if (actions.length) {
    const row = add(el, 'div', { className: 'grid' });
    for (const a of actions) { const b = add(row, 'button', { textContent: a.label }); b.onclick = a.run; }
  }
  for (const k of kinds) {
    const l = add(grid, 'label');
    const c = add<HTMLInputElement>(l, 'input', { type: 'checkbox', checked: k.objects.every((o) => o.visible) });
    add(l, 'span', { textContent: k.name });
    c.onchange = () => { for (const o of k.objects) o.visible = c.checked; changed(); };
    boxes.push(c);
  }
}
