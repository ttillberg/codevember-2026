// The workbench: a gear bottom right (only in dev, or with ?settings), a frosted card of
// sliders over it. Values are remembered per viewer (localStorage, best effort).
import { onTap } from './ui';

export interface Range {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  set(v: number): void;
}

const STORE = 'codevember-14-settings';

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}
function save(v: Record<string, number>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private mode: fine */
  }
}

const GEAR = (() => {
  const c = 12, ro = 9.5, ri = 7;
  const p = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  let d = '';
  for (let k = 0; k < 8; k++) {
    const t = k * 45;
    d += `${k === 0 ? 'M' : 'L'}${p(ri, t - 14)}L${p(ro, t - 8)}L${p(ro, t + 8)}L${p(ri, t + 14)}`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="${d}Z"/><circle cx="12" cy="12" r="3"/></svg>`;
})();

export function createSettings(items: Range[], readout?: () => string) {
  const stored = load();
  const values: Record<string, number> = {};

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'round set-btn';
  button.setAttribute('aria-label', 'Settings');
  button.innerHTML = GEAR;
  button.addEventListener('mousedown', (e) => e.preventDefault());

  const panel = document.createElement('div');
  panel.className = 'settings';
  panel.hidden = true;
  const head = document.createElement('div');
  head.className = 'set-head';
  head.innerHTML = '<b>Settings</b><output class="read"></output>';
  panel.append(head);
  const read = head.querySelector('output')!;

  for (const it of items) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = it.label;
    const out = document.createElement('output');
    name.append(out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(it.min);
    input.max = String(it.max);
    input.step = String(it.step);
    const digits = Math.max(0, -Math.floor(Math.log10(it.step) + 1e-9));
    const v0 = typeof stored[it.key] === 'number' ? stored[it.key] : it.value;
    const apply = (v: number) => {
      out.textContent = v.toFixed(digits);
      it.set(v);
    };
    input.value = String(v0);
    values[it.key] = v0;
    apply(v0);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      values[it.key] = v;
      apply(v);
      save(values);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    row.append(name, input);
    panel.append(row);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'reset';
  reset.textContent = 'Reset to defaults';
  onTap(reset, () => {
    save({});
    location.reload();
  });
  panel.append(reset);

  const open = (on: boolean) => {
    panel.hidden = !on;
    button.classList.toggle('on', on);
  };
  button.addEventListener('pointerdown', (e) => e.stopPropagation());
  onTap(button, () => open(panel.hidden));
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => e.key === 'Escape' && open(false));
  if (readout) setInterval(() => !panel.hidden && (read.textContent = readout()), 250);

  document.body.append(button, panel);

}
