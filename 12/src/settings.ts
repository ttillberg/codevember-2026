// The settings: a frosted card of switches and sliders (and a few workbench buttons),
// behind its own round button top right. Values are remembered per viewer (localStorage, best effort).

export type Setting =
  | { kind: 'toggle'; key: string; label: string; value: boolean; set(v: boolean): void }
  | { kind: 'range'; key: string; label: string; value: number; min: number; max: number; step: number; set(v: number): void }
  | { kind: 'select'; key: string; label: string; value: string; options: string[]; set(v: string): void }
  | { kind: 'action'; label: string; key?: string; run(): void }
  | { kind: 'heading'; label: string };

import { ICONS } from './actions';

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

/**
 * overrides: values that win over the stored ones for this visit (URL flags such as ?still).
 * They are not saved unless the control itself is touched.
 */
export function createSettings(items: Setting[], overrides: Record<string, Value> = {}) {
  const stored = load();
  const values: Record<string, Value> = {};

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'set-btn';
  button.setAttribute('aria-label', 'Settings');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = ICONS.settings;

  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Settings');
  const head = document.createElement('div');
  head.className = 'set-head';
  head.innerHTML = '<b>Settings</b>';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'set-close';
  close.setAttribute('aria-label', 'Close settings');
  close.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
  close.addEventListener('click', () => open(false));
  head.append(close);
  // the heading stays, what's under it scrolls
  const body = document.createElement('div');
  body.className = 'set-body';
  panel.append(head, body);
  // the workbench buttons in a row of pills
  let acts: HTMLElement | null = null;

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
    if (it.kind !== 'action') acts = null;
    if (it.kind === 'heading') {
      const h = document.createElement('h5');
      h.textContent = it.label;
      body.append(h);
      continue;
    }
    if (it.kind === 'action') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act';
      b.textContent = it.label;
      // its key, where there is a keyboard
      if (it.key) {
        const k = document.createElement('kbd');
        k.textContent = it.key;
        b.append(k);
      }
      b.addEventListener('click', () => it.run());
      if (!acts) {
        acts = document.createElement('div');
        acts.className = 'acts';
        body.append(acts);
      }
      acts.append(b);
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
        const out = document.createElement('output');
        const digits = Math.max(0, -Math.floor(Math.log10(it.step) + 1e-9));
        // the readout, and how far along the track is filled
        const show = (v: number) => {
          out.textContent = v.toFixed(digits);
          input.style.setProperty('--p', `${((v - it.min) / (it.max - it.min)) * 100}%`);
        };
        bind(it.key, it.value, (v) => typeof v === 'number', input, 'input', () => Number(input.value), (v) => (input.value = String(v)), (v) => (show(v), it.set(v)));
        name.append(out);
      }
      row.append(name, input);
    }
    body.append(row);
  }

  // reset: a full button right under the last control (the workbench comes after it)
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset';
  reset.textContent = 'Reset to defaults';
  reset.addEventListener('click', () => {
    save({});
    location.reload();
  });
  const rows = body.querySelectorAll('.row');
  const last = rows[rows.length - 1];
  if (last) last.after(reset);
  else body.prepend(reset);

  function open(on: boolean) {
    panel.hidden = !on;
    button.classList.toggle('on', on);
    button.setAttribute('aria-expanded', String(on));
  }
  button.addEventListener('pointerdown', (e) => e.stopPropagation());
  button.addEventListener('click', () => open(panel.hidden));
  // clicks inside the card stay inside; a click on the scene closes it
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('pointerup', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') open(false);
  });

  document.body.append(button, panel);
  return { button, panel, open, isOpen: () => !panel.hidden };
}
