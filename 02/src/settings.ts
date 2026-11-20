// The workbench: every number worth turning, in a panel. Only with ?debug (or ?settings): for tuning, not for
// visitors. Sections fold, and what is folded, what is open and every value are kept in localStorage.
// Cracks apply from the next bullet, the simulation from the next break, the scene at once.

export interface Item { key: string; label: string; min: number; max: number; step: number; def: number }
export interface Section { id: string; title: string; note?: string; items: Item[] }

const it = (key: string, label: string, min: number, max: number, step: number, def: number): Item => ({ key, label, min, max, step, def });

export const SECTIONS: Section[] = [
  {
    id: 'scene', title: 'Scene', items: [
      it('panes', 'Panes', 1, 3, 1, 2),
      it('gap', 'Gap, cm', 3, 80, 1, 25),
      it('temper', '2nd tempered', 0, 1, 1, 1),
      it('exposure', 'Exposure', 0.3, 2.5, 0.01, 1),
      it('wall', 'Wall light', 0, 2.5, 0.01, 1),
      it('floor', 'Floor light', 0, 2.5, 0.01, 1),
      it('tint', 'Glass tint', 0, 4, 0.01, 1),
      it('refl', 'Reflections', 0, 4, 0.01, 1),
      it('bend', 'Refraction', 0, 0.08, 0.001, 0.014),
      it('wavy', 'Waviness', 0, 0.3, 0.005, 0.06),
      it('seam', 'Crack edge light', 0, 1.5, 0.01, 0.16),
      it('dark', 'Crack darkness', 0, 1, 0.01, 1),
      it('shadow', 'Floor shadow', 0, 1, 0.01, 0.58),
      it('dust', 'Dust', 0, 3, 0.05, 1),
      it('sway', 'Camera sway', 0, 4, 0.05, 1),
      it('pace', 'Fall speed', 0.05, 1.5, 0.01, 1),
      it('slow', 'Held speed', 0.01, 0.5, 0.01, 0.07),
    ],
  },
  {
    id: 'cracks', title: 'Cracks', note: 'From the next bullet', items: [
      it('radials', 'Radials', 4, 60, 1, 20),
      it('radialsVar', 'Radials, spread', 0, 30, 1, 12),
      it('longP', 'Long ones', 0, 1, 0.01, 0.5),
      it('length', 'Length, m', 0.02, 1, 0.01, 0.2),
      it('lengthVar', 'Length, spread', 0, 1.5, 0.01, 0.8),
      it('wander', 'Wander', 0, 3, 0.01, 0.45),
      it('kink', 'Kinks', 0, 0.8, 0.01, 0.16),
      it('branch', 'Forks, per m', 0, 25, 0.1, 5),
      it('rings', 'Rings, near', 0, 1, 0.01, 0.65),
      it('ringsFar', 'Rings, far', 0, 1, 0.01, 0.3),
      it('hole', 'Hole, mm', 2, 30, 0.1, 6.2),
      it('slant', 'Slant', 0, 0.9, 0.01, 0.42),
      it('shardArea', 'Shard size, cm²', 4, 200, 1, 22),
      it('dice', 'Tempered dice, cm', 1.4, 6, 0.1, 2.4),
      it('blow', 'Blow strength', 0.3, 5, 0.05, 2.4),
    ],
  },
  {
    id: 'sim', title: 'Simulation', note: 'From the next break', items: [
      it('kick', 'Ball speed, m/s', 2, 80, 0.5, 30),
      it('ballSize', 'Ball radius, cm', 3, 30, 0.5, 11),
      it('ballDensity', 'Ball weight', 0.02, 12, 0.02, 4),
      it('gravity', 'Gravity, m/s²', 0, 30, 0.1, 9.81),
      it('pushBack', 'Push back', 0, 40, 0.5, 13),
      it('pushOut', 'Push outwards', 0, 20, 0.1, 4.5),
      it('reach', 'Reach, m', 0.05, 1.5, 0.01, 0.3),
      it('spin', 'Spin', 0, 60, 0.5, 16),
      it('front', 'Release front, m/s', 0.5, 40, 0.5, 7),
      it('bounce', 'Bounce', 0, 0.9, 0.01, 0.22),
      it('friction', 'Friction', 0, 1.5, 0.01, 0.45),
      it('stuck', 'Left standing', 0, 1, 0.01, 0.5),
      it('seconds', 'Baked seconds', 2, 15, 0.5, 7),
      it('contacts', 'Sounds per frame', 0, 24, 1, 8),
    ],
  },
];

export type Values = Record<string, number>;
const KEY = 'codevember-02-debug';

export function defaults(): Values {
  const v: Values = {};
  for (const s of SECTIONS) for (const i of s.items) v[i.key] = i.def;
  return v;
}

interface Saved { values?: Values; folded?: Record<string, boolean>; open?: boolean }
function load(): Saved {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Saved; } catch { return {}; }
}
function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* no storage: the panel still works */ }
}

/** Builds the panel, fills `values` with what was saved, and calls onChange after every change. */
export function mountPanel(values: Values, onChange: () => void) {
  const saved = load();
  const folded = saved.folded ?? { cracks: true, sim: true };
  let open = saved.open ?? true;
  for (const s of SECTIONS) for (const i of s.items) {
    const v = saved.values?.[i.key];
    if (typeof v === 'number' && isFinite(v)) values[i.key] = Math.min(i.max, Math.max(i.min, v));
  }
  const keep = () => save({ values, folded, open });

  const root = document.createElement('div');
  root.className = 'debug';
  const gear = document.createElement('button');
  gear.className = 'debug-gear';
  gear.title = 'Settings'; gear.setAttribute('aria-label', 'Settings');
  gear.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>';
  const box = document.createElement('div');
  box.className = 'debug-box';
  const show = () => { box.hidden = !open; gear.classList.toggle('on', open); };
  gear.addEventListener('click', () => { open = !open; show(); keep(); });

  const inputs: { item: Item; range: HTMLInputElement; out: HTMLElement }[] = [];
  const fmt = (i: Item, v: number) => v.toFixed(i.step >= 1 ? 0 : i.step >= 0.1 ? 1 : i.step >= 0.01 ? 2 : 3);
  for (const s of SECTIONS) {
    const sec = document.createElement('section');
    const head = document.createElement('button');
    head.className = 'debug-head';
    head.innerHTML = `<span>${s.title}</span>${s.note ? `<small>${s.note}</small>` : ''}<i></i>`;
    const body = document.createElement('div');
    body.className = 'debug-body';
    const fold = () => { body.hidden = !!folded[s.id]; head.classList.toggle('folded', !!folded[s.id]); head.setAttribute('aria-expanded', String(!folded[s.id])); };
    head.addEventListener('click', () => { folded[s.id] = !folded[s.id]; fold(); keep(); });
    for (const item of s.items) {
      const row = document.createElement('label');
      row.className = 'debug-row';
      const name = document.createElement('span');
      name.textContent = item.label;
      const range = document.createElement('input');
      range.type = 'range'; range.id = `debug-${item.key}`;
      range.min = String(item.min); range.max = String(item.max); range.step = String(item.step);
      range.value = String(values[item.key]);
      const out = document.createElement('output');
      out.textContent = fmt(item, values[item.key]);
      range.addEventListener('input', () => {
        values[item.key] = Number(range.value);
        out.textContent = fmt(item, values[item.key]);
        row.classList.toggle('changed', values[item.key] !== item.def);
        onChange(); keep();
      });
      // a double tap on the name puts the value back
      name.addEventListener('dblclick', () => { range.value = String(item.def); range.dispatchEvent(new Event('input')); });
      row.classList.toggle('changed', values[item.key] !== item.def);
      row.append(name, range, out);
      body.append(row);
      inputs.push({ item, range, out });
    }
    sec.append(head, body);
    box.append(sec);
    fold();
  }
  const foot = document.createElement('div');
  foot.className = 'debug-foot';
  const reset = document.createElement('button');
  reset.textContent = 'Reset all';
  reset.addEventListener('click', () => {
    for (const { item, range, out } of inputs) {
      values[item.key] = item.def; range.value = String(item.def); out.textContent = fmt(item, item.def);
      range.closest('.debug-row')!.classList.remove('changed');
    }
    onChange(); keep();
  });
  const copy = document.createElement('button');
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    const changed: Values = {};
    for (const { item } of inputs) if (values[item.key] !== item.def) changed[item.key] = values[item.key];
    navigator.clipboard?.writeText(JSON.stringify(changed, null, 1)).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy values'), 1200); }).catch(() => { copy.textContent = 'Could not copy'; });
  });
  foot.append(reset, copy);
  box.append(foot);
  root.append(box, gear);
  document.body.append(root);
  show();
  onChange();
}
