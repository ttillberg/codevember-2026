// The settings wheel, top right: a frosted card of switches, sliders and a few
// actions. Values are remembered per viewer (localStorage, best effort).

export type Setting =
  | { kind: 'toggle'; key: string; label: string; value: boolean; set(v: boolean): void }
  | { kind: 'range'; key: string; label: string; value: number; min: number; max: number; step: number; set(v: number): void }
  | { kind: 'select'; key: string; label: string; value: string; options: string[]; set(v: string): void }
  | { kind: 'action'; label: string; run(): void }
  | { kind: 'heading'; label: string };

const STORE = 'codevember-12-settings';

function load(): Record<string, number | boolean | string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function save(v: Record<string, number | boolean | string>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private mode: fine */
  }
}

const gear = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

export function createSettings(items: Setting[]) {
  const stored = load();
  const values: Record<string, number | boolean | string> = {};

  const button = document.createElement('button');
  button.className = 'gear';
  button.type = 'button';
  button.setAttribute('aria-label', 'Settings');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = gear;

  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.hidden = true;

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
    if (it.kind === 'select') {
      const row = document.createElement('label');
      row.className = 'row select';
      const name = document.createElement('span');
      name.textContent = it.label;
      const sel = document.createElement('select');
      for (const o of it.options) sel.append(new Option(o, o));
      const v = typeof stored[it.key] === 'string' && it.options.includes(stored[it.key] as string) ? (stored[it.key] as string) : it.value;
      sel.value = v;
      values[it.key] = v;
      it.set(v);
      sel.addEventListener('change', () => {
        values[it.key] = sel.value;
        it.set(sel.value);
        save(values);
      });
      row.append(name, sel);
      panel.append(row);
      continue;
    }
    const row = document.createElement('label');
    row.className = `row ${it.kind}`;
    const name = document.createElement('span');
    name.textContent = it.label;
    const input = document.createElement('input');
    if (it.kind === 'toggle') {
      input.type = 'checkbox';
      const v = typeof stored[it.key] === 'boolean' ? (stored[it.key] as boolean) : it.value;
      input.checked = v;
      values[it.key] = v;
      it.set(v);
      input.addEventListener('change', () => {
        values[it.key] = input.checked;
        it.set(input.checked);
        save(values);
      });
      row.append(name, input);
    } else {
      input.type = 'range';
      input.min = String(it.min);
      input.max = String(it.max);
      input.step = String(it.step);
      const v = typeof stored[it.key] === 'number' ? (stored[it.key] as number) : it.value;
      input.value = String(v);
      values[it.key] = v;
      it.set(v);
      input.addEventListener('input', () => {
        values[it.key] = Number(input.value);
        it.set(Number(input.value));
        save(values);
      });
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
