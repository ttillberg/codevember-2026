// ?debug: a small panel of sliders over the scene, for turning a pass by eye. No library: a few ranges bound to plain
// numbers, their values shown, and a button that copies them all as JSON so they can be handed back and made the
// defaults. Not loaded at all without ?debug.
export interface Knob { label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void }

export function debugPanel(title: string, knobs: Knob[]) {
  const css = document.createElement('style');
  css.textContent = `
    .dbg { position: fixed; z-index: 40; left: 16px; bottom: 16px; width: 250px; padding: 12px 14px 10px; box-sizing: border-box;
      background: rgba(12, 10, 8, 0.82); color: #f4f4f2; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(244, 244, 242, 0.18);
      font: 500 11px/1.3 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .dbg h4 { margin: 0 0 8px; font: 600 10px/1 inherit; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7; }
    .dbg label { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; margin: 0 0 7px; }
    .dbg output { font-variant-numeric: tabular-nums; opacity: 0.8; }
    .dbg input { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: #f4f4f2; }
    .dbg .row { display: flex; gap: 6px; margin-top: 4px; }
    .dbg button { flex: 1; padding: 6px 0 5px; border: 0; border-radius: 6px; cursor: pointer; color: inherit; background: rgba(244, 244, 242, 0.12);
      font: 600 10px/1 inherit; letter-spacing: 0.1em; text-transform: uppercase; }
    .dbg button:hover { background: rgba(244, 244, 242, 0.22); }`;
  document.head.append(css);
  const el = document.createElement('div');
  el.className = 'dbg';
  const h = document.createElement('h4');
  h.textContent = title;
  el.append(h);
  const start = knobs.map((k) => k.get());
  const rows = knobs.map((k) => {
    const label = document.createElement('label');
    const name = document.createElement('span'), out = document.createElement('output'), input = document.createElement('input');
    name.textContent = k.label;
    input.type = 'range';
    input.min = String(k.min); input.max = String(k.max); input.step = String(k.step);
    const show = () => { input.value = String(k.get()); out.textContent = String(+k.get().toFixed(4)); };
    input.addEventListener('input', () => { k.set(Number(input.value)); show(); });
    label.append(name, out, input);
    el.append(label);
    show();
    return show;
  });
  const row = document.createElement('div');
  row.className = 'row';
  const copy = document.createElement('button'), reset = document.createElement('button');
  copy.textContent = 'Copy';
  reset.textContent = 'Reset';
  copy.addEventListener('click', () => {
    const text = JSON.stringify(Object.fromEntries(knobs.map((k) => [k.label, +k.get().toFixed(4)])));
    navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); }, () => console.log(text));
    console.log(`${title}: ${text}`);
  });
  reset.addEventListener('click', () => { knobs.forEach((k, i) => k.set(start[i])); rows.forEach((show) => show()); });
  row.append(copy, reset);
  el.append(row);
  // (the panel's presses are its own: not a look, not a run)
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown']) el.addEventListener(type, (ev) => ev.stopPropagation());
  document.body.append(el);
}
