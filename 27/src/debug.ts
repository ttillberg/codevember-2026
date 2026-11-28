// ?debug: a small panel over the scene, for turning a pass by eye and for trying what a frame can do without. No
// library: ranges bound to plain numbers, their values shown, and a button that copies them as JSON so they can be
// handed back and made the defaults; switches, with one over them that throws them all; a line that says how the
// frame is doing. Not loaded at all without ?debug.
export interface Knob { label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void }
export interface Toggle { label: string; get: () => boolean; set: (on: boolean) => void }
export interface Section {
  title: string;
  knobs?: Knob[];
  toggles?: Toggle[];
  /** a switch over the switches: its name */
  all?: string;
  /** a line of text, read again twice a second */
  readout?: () => string;
  buttons?: { label: string; run: () => void }[];
}

export function debugPanel(sections: Section[]) {
  const css = document.createElement('style');
  css.textContent = `
    .dbg { position: fixed; z-index: 40; left: 16px; bottom: 16px; width: 250px; max-height: calc(100vh - 32px); overflow: auto; padding: 12px 14px 10px; box-sizing: border-box;
      background: rgba(12, 10, 8, 0.82); color: #f4f4f2; border-radius: 10px; box-shadow: inset 0 0 0 1px rgba(244, 244, 242, 0.18);
      font: 500 11px/1.3 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .dbg h4 { margin: 0 0 8px; font: 600 10px/1 inherit; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7; }
    .dbg section + section { margin-top: 14px; padding-top: 12px; box-shadow: inset 0 1px 0 rgba(244, 244, 242, 0.14); }
    .dbg label { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; margin: 0 0 7px; }
    .dbg output { font-variant-numeric: tabular-nums; opacity: 0.8; }
    .dbg input { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: #f4f4f2; }
    .dbg label.tog { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; cursor: pointer; }
    .dbg label.tog input { width: auto; flex: none; }
    .dbg label.all { margin-bottom: 9px; font-weight: 700; }
    .dbg .say { display: block; margin: 8px 0 2px; white-space: pre-line; }
    .dbg .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .dbg button { flex: 1 0 auto; padding: 6px 9px 5px; border: 0; border-radius: 6px; cursor: pointer; color: inherit; background: rgba(244, 244, 242, 0.12);
      font: 600 10px/1 inherit; letter-spacing: 0.1em; text-transform: uppercase; }
    .dbg button:hover { background: rgba(244, 244, 242, 0.22); }`;
  document.head.append(css);
  const el = document.createElement('div');
  el.className = 'dbg';
  const button = (label: string, to: HTMLElement) => { const b = document.createElement('button'); b.textContent = label; to.append(b); return b; };
  const row = (to: HTMLElement) => { const r = document.createElement('div'); r.className = 'row'; to.append(r); return r; };

  for (const { title, knobs = [], toggles = [], all, readout, buttons = [] } of sections) {
    const sec = document.createElement('section');
    const h = document.createElement('h4');
    h.textContent = title;
    sec.append(h);

    const start = knobs.map((k) => k.get());
    const shows = knobs.map((k) => {
      const label = document.createElement('label');
      const name = document.createElement('span'), out = document.createElement('output'), input = document.createElement('input');
      name.textContent = k.label;
      input.type = 'range';
      input.min = String(k.min); input.max = String(k.max); input.step = String(k.step);
      const show = () => { input.value = String(k.get()); out.textContent = String(+k.get().toFixed(4)); };
      input.addEventListener('input', () => { k.set(Number(input.value)); show(); });
      label.append(name, out, input);
      sec.append(label);
      show();
      return show;
    });
    if (knobs.length) {
      const r = row(sec);
      const copy = button('Copy', r);
      copy.addEventListener('click', () => {
        const text = JSON.stringify(Object.fromEntries(knobs.map((k) => [k.label, +k.get().toFixed(4)])));
        navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); }, () => console.log(text));
        console.log(`${title}: ${text}`);
      });
      button('Reset', r).addEventListener('click', () => { knobs.forEach((k, i) => k.set(start[i])); shows.forEach((show) => show()); });
    }

    const check = (label: string, cls: string, change: (on: boolean) => void) => {
      const l = document.createElement('label'), input = document.createElement('input'), name = document.createElement('span');
      l.className = cls;
      input.type = 'checkbox';
      name.textContent = label;
      input.addEventListener('change', () => { change(input.checked); sync(); });
      l.append(input, name);
      sec.append(l);
      return input;
    };
    // (the one over them all is on when they all are, and half on when some are)
    const master = all && toggles.length ? check(all, 'tog all', (on) => toggles.forEach((t) => t.set(on))) : null;
    const boxes = toggles.map((t) => check(t.label, 'tog', (on) => t.set(on)));
    const sync = () => {
      const on = toggles.map((t, i) => (boxes[i].checked = t.get()));
      if (master) { master.checked = on.every(Boolean); master.indeterminate = !master.checked && on.some(Boolean); }
    };
    sync();
    // (they can be thrown from elsewhere too: ?fast, the console)
    if (toggles.length) setInterval(sync, 500);

    if (readout) {
      const out = document.createElement('output');
      out.className = 'say';
      sec.append(out);
      const say = () => { out.textContent = readout(); };
      say();
      setInterval(say, 500);
    }
    if (buttons.length) {
      const r = row(sec);
      for (const b of buttons) button(b.label, r).addEventListener('click', () => b.run());
    }
    el.append(sec);
  }
  // (the panel's presses are its own: not a look, not a run)
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'keydown']) el.addEventListener(type, (ev) => ev.stopPropagation());
  document.body.append(el);
}
