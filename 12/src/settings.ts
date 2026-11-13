// The settings wheel, top right: a frosted card of switches, sliders and a few
// actions. Values are remembered per viewer (localStorage, best effort).

export type Setting =
  | { kind: 'toggle'; key: string; label: string; value: boolean; set(v: boolean): void }
  | { kind: 'range'; key: string; label: string; value: number; min: number; max: number; step: number; set(v: number): void }
  | { kind: 'select'; key: string; label: string; value: string; options: string[]; set(v: string): void }
  | { kind: 'action'; label: string; run(): void }
  | { kind: 'heading'; label: string };

type Value = number | boolean | string;

const STORE = 'codevember-12-settings';

function load(): Record<string, Value> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function save(v: Record<string, Value>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private mode: fine */
  }
}

const gear = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

/**
 * overrides: values that win over the stored ones for this visit (URL flags such as ?still).
 * They are not saved unless the control itself is touched.
 */
export function createSettings(items: Setting[], overrides: Record<string, Value> = {}) {
  const stored = load();
  const values: Record<string, Value> = {};

  const button = document.createElement('button');
  button.className = 'gear';
  button.type = 'button';
  button.setAttribute('aria-label', 'Settings');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = gear;

  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.hidden = true;

  // stored (or the default) → the control → the scene; then every change back the same way, and saved
  function bind<T extends Value>(key: string, def: T, valid: (v: Value) => boolean, el: HTMLElement, event: string, read: () => T, write: (v: T) => void, set: (v: T) => void) {
    const keep = key in stored && valid(stored[key]) ? (stored[key] as T) : def;
    const v = key in overrides ? (overrides[key] as T) : keep;
    values[key] = keep;
    write(v);
    set(v);
    el.addEventListener(event, () => {
      const v = read();
      values[key] = v;
      set(v);
      save(values);
    });
  }

  for (const it of items) {
    if (it.kind === 'heading') {
      const h = document.createElement('h5');
      h.textContent = it.label;
      panel.append(h);
      continue;
    }
    if (it.kind === 'action') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act';
      b.textContent = it.label;
      b.addEventListener('click', () => it.run());
      panel.append(b);
      continue;
    }
    const row = document.createElement('label');
    row.className = `row ${it.kind}`;
    const name = document.createElement('span');
    name.textContent = it.label;
    if (it.kind === 'select') {
      const sel = document.createElement('select');
      for (const o of it.options) sel.append(new Option(o, o));
      bind(it.key, it.value, (v) => typeof v === 'string' && it.options.includes(v), sel, 'change', () => sel.value, (v) => (sel.value = v), it.set);
      row.append(name, sel);
    } else {
      const input = document.createElement('input');
      if (it.kind === 'toggle') {
        input.type = 'checkbox';
        bind(it.key, it.value, (v) => typeof v === 'boolean', input, 'change', () => input.checked, (v) => (input.checked = v), it.set);
      } else {
        input.type = 'range';
        input.min = String(it.min);
        input.max = String(it.max);
        input.step = String(it.step);
        bind(it.key, it.value, (v) => typeof v === 'number', input, 'input', () => Number(input.value), (v) => (input.value = String(v)), it.set);
      }
      row.append(name, input);
    }
    panel.append(row);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'act reset';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    save({});
    location.reload();
  });
  panel.append(reset);

  const open = (on: boolean) => {
    panel.hidden = !on;
    button.setAttribute('aria-expanded', String(on));
    button.classList.toggle('on', on);
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    open(panel.hidden);
  });
  // clicks inside the card stay inside; a click on the scene closes it
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('pointerup', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') open(false);
  });

  document.body.append(button, panel);
  return { button, panel, open, isOpen: () => !panel.hidden };
}
