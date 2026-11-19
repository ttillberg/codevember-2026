// ?debug: a small panel of the look's knobs, bottom right. Sliders write straight into the objects
// they are given; a choice is a row of buttons.
type Slider = { kind: 'slider'; obj: Record<string, number>; key: string; label: string; min: number; max: number; step: number };
type Choice = { kind: 'choice'; label: string; options: string[]; get: () => number; set: (i: number) => void };
export type Row = Slider | Choice | { kind: 'title'; label: string };

export function debugPanel(rows: Row[]) {
  const el = document.createElement('div');
  el.className = 'debug';
  const head = document.createElement('button');
  head.className = 'debug-head';
  head.textContent = 'debug';
  head.onclick = () => el.classList.toggle('folded');
  el.append(head);
  const body = document.createElement('div');
  body.className = 'debug-body';
  el.append(body);
  for (const r of rows) {
    const row = document.createElement('label');
    row.className = 'debug-row';
    if (r.kind === 'title') {
      row.className = 'debug-title';
      row.textContent = r.label;
    } else if (r.kind === 'slider') {
      const name = document.createElement('span');
      name.textContent = r.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(r.min); input.max = String(r.max); input.step = String(r.step);
      input.value = String(r.obj[r.key]);
      const val = document.createElement('output');
      const show = () => (val.textContent = (+r.obj[r.key]).toFixed(r.step < 0.01 ? 3 : r.step < 1 ? 2 : 0));
      show();
      input.oninput = () => { r.obj[r.key] = +input.value; show(); };
      row.append(name, input, val);
    } else {
      const name = document.createElement('span');
      name.textContent = r.label;
      const btns = document.createElement('span');
      btns.className = 'debug-choice';
      const bs = r.options.map((o, i) => {
        const b = document.createElement('button');
        b.textContent = o;
        b.onclick = (e) => { e.preventDefault(); r.set(i); mark(); };
        return b;
      });
      const mark = () => bs.forEach((b, i) => b.classList.toggle('on', i === r.get()));
      mark();
      btns.append(...bs);
      row.append(name, btns);
    }
    body.append(row);
  }
  // keep pointer events on the panel off the canvas
  for (const ev of ['pointerdown', 'pointermove', 'wheel'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
  document.body.append(el);
}
