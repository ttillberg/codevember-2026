// The on-screen controls. Plain DOM, laid out by style.css: a tool switch, undo and redo,
// bench, and a settings sheet with the finishes and the sliders for the feel. Only the
// controls take pointers, never the space between them: that belongs to the canvas.

import type { Tool } from './state';
import { tune } from './peel';
import type { Tune } from './peel';

/** What a swatch needs of a finish (layers.ts). */
export interface Finish { name: string; color: number; opacity: number }

export interface UiHandlers {
  tools: readonly Tool[];
  /** Films, then bases. */
  finishes: readonly [readonly Finish[], readonly Finish[]];
  onTool(t: Tool): void;
  /** Pick finish `variant` for `index` (0 film, 1 base). */
  onFinish(index: number, variant: number): void;
  onBench(): void;
  onBack(): void;
  onRedo(): void;
}

export interface Ui {
  setTool(t: Tool): void;
  /** Mark finish `variant` of `index` (0 film, 1 base) as the one in use. */
  setFinish(index: number, variant: number): void;
  /** Read every slider back from `tune`. */
  syncSliders(): void;
  /** Steps that can be undone and redone; 0 disables the button. */
  setHistory(undo: number, redo: number): void;
}

// How the film behaves in the hand: [key, label, min, max, what it does].
const KNOBS: Array<[keyof Tune, string, number, number, string]> = [
  ['elastic', 'stretch', 0, 0.6, 'How far the film stretches before the pull reaches the front. 0 follows the finger exactly, higher is rubbery and lags.'],
  ['adhesion', 'cling', 0, 6, 'How hard the film sticks. Higher needs a longer pull before each bit lets go.'],
  ['shear', 'shear', 0, 15, 'How much film dragged flat along the surface holds out, compared with film folded back and peeled. Higher keeps the peel a narrow tongue along the pull.'],
  ['load', 'front', 0, 4, 'How much a wide peel front weighs. At 0 width makes no difference. Only matters with cling above 0.'],
  ['stiff', 'taut', 0.1, 1, 'How tight the loose sheet is. Low is slack, 1 is taut. Looks only.'],
  ['lift', 'lift', 0, 1, 'How the hand pulls. 0 drags the film flat back over itself. 1 lifts it up and away as it goes, so the finger stays over the place where the film comes off.'],
  ['ghost', 'ghost', 0, 1, 'How visible the lifted film stays behind the front. 0 fades out, 1 stays solid. Looks only.'],
  ['rough', 'rough', 0, 1, 'How unevenly the film sticks from spot to spot. 0 gives a clean front, 1 a stuttering one.'],
  ['tear', 'tear', 0, 10, 'Strength. The film breaks off when the peel front gets this wide, sooner on a fast pull. 0 never breaks.'],
  ['edge', 'edge', 0, 1, 'How much more easily the film lets go along a free edge than in the middle. Higher lets the peel run out along a cut, so the front meets it as an arc.'],
  ['straight', 'straight', 0, 1, 'Above 0.5 the lifted film is a taut flat sheet: stuck film lying under it lets go, so the front runs straight from edge to edge. Below 0.5 each spot only answers for itself.'],
  ['grip', 'grip', 1, 12, 'How wide a strip of the edge the finger holds. Narrow gathers the film to a point, wide pulls it off flat. Takes effect on the next grab.'],
];

const THUMB = 14;       // px, keep in step with the slider thumb in style.css
const DEAD = 4;         // px a touch moves before it counts as a drag, not a tap
const INFO_MS = 8000;   // how long a touched setting's text stays up
const BENCH = 'Reset to the test scene: whole film and three fixed cuts';
const FINISHES = ['film', 'base'];

// ------------------------------------------------------------------------------- icons

const SVG = 'http://www.w3.org/2000/svg';

function icon(d: string, extra = ''): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${d}"/>${extra}`;
  return s;
}

/** A hooked arrow back to the left. Redo is the same, mirrored in CSS. */
const UNDO = 'M8.5 4.5 4 9l4.5 4.5M4 9h10a5.5 5.5 0 0 1 0 11h-3.5';

/** Eight teeth round a ring, as one closed outline. */
function gear(): string {
  const c = 12, ro = 10, ri = 7.4;
  const p = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  let d = '';
  for (let k = 0; k < 8; k++) {
    const t = k * 45;
    d += `${k === 0 ? 'M' : 'L'}${p(ri, t - 15)}L${p(ro, t - 9)}L${p(ro, t + 9)}L${p(ri, t + 15)}`;
  }
  return d + 'Z';
}

// ---------------------------------------------------------------------------------- dom

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, onPress: () => void, label?: string) {
  const b = el('button', cls);
  b.type = 'button';
  b.tabIndex = -1;
  if (label) { b.title = label; b.setAttribute('aria-label', label); }
  // No focus from a press, so space and enter never press it again.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onPress);
  return b;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;

export function createUi(h: UiHandlers): Ui {
  const root = el('div', 'ui');
  // iOS only shows :active with a touch listener somewhere above.
  root.addEventListener('touchstart', () => {}, { passive: true });

  // Tool switch: one segment per tool and a thumb that slides under the active one.
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Tool');
  seg.append(el('span', 'seg-thumb'));
  const toolButtons = h.tools.map((t, i) => {
    const b = button('seg-btn', () => h.onTool(t));
    b.textContent = t;
    b.title = `${t} (${i + 1})`;
    b.setAttribute('role', 'radio');
    seg.append(b);
    return b;
  });

  // Undo and redo, one pill.
  const hist = el('div', 'hist');
  const undo = button('btn icon undo', h.onBack, 'Undo (Cmd/Ctrl+Z, or z)');
  undo.setAttribute('aria-label', 'Undo');
  const count = el('span', 'count');
  undo.append(icon(UNDO), count);
  const redo = button('btn icon redo', h.onRedo, 'Redo (Shift+Cmd/Ctrl+Z, or y)');
  redo.setAttribute('aria-label', 'Redo');
  redo.append(icon(UNDO));
  hist.append(undo, redo);

  const bench = button('btn bench', h.onBench, BENCH);
  bench.textContent = 'bench';

  // Settings: the gear opens the sheet.
  const gearButton = button('btn icon gear', () => setOpen(!open), 'Settings');
  gearButton.append(icon(gear(), '<circle cx="12" cy="12" r="3"/>'));
  gearButton.setAttribute('aria-expanded', 'false');

  const sheet = el('div', 'sheet');
  const body = el('div', 'sheet-body');
  sheet.append(body);

  // The text for the setting last touched (or hovered), above the sheet.
  const info = el('div', 'info');
  info.setAttribute('role', 'status');
  const infoName = el('b', '');
  const infoText = el('span', '');
  info.append(infoName, infoText);
  let infoTimer = 0;
  let infoKey = '';
  function showInfo(name: string, text: string, ms = 0) {
    clearTimeout(infoTimer);
    infoKey = name;
    infoName.textContent = name;
    infoText.textContent = text;
    info.classList.add('show');
    if (ms > 0) infoTimer = window.setTimeout(hideInfo, ms);
  }
  function hideInfo() {
    clearTimeout(infoTimer);
    info.classList.remove('show');
    infoKey = '';
  }
  // It never takes a pointer; a press anywhere outside the sheet puts it away.
  window.addEventListener('pointerdown', (e) => { if (!sheet.contains(e.target as Node)) hideInfo(); }, true);

  // Finishes: a row of swatches each, the film shown over the base it lies on.
  let base = h.finishes[1][0].color;
  const groups = FINISHES.map((kind, index) => {
    const group = el('div', `finish ${kind}`);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', kind);
    const head = el('div', 'finish-head');
    const name = el('span', 'finish-name');
    head.append(el('span', 'finish-kind', kind), name);
    const strip = el('div', 'swatches');
    const swatches = h.finishes[index].map((f, variant) => {
      const b = button('swatch', () => h.onFinish(index, variant), f.name);
      b.setAttribute('aria-label', `${kind} ${f.name}`);
      b.setAttribute('role', 'radio');
      b.append(el('span', 'chip'));
      strip.append(b);
      return b;
    });
    group.append(head, strip);
    body.append(group);
    return { name, swatches, list: h.finishes[index] };
  });
  function paintSwatches() {
    groups[0].swatches.forEach((b, i) => {
      const f = groups[0].list[i];
      (b.firstChild as HTMLElement).style.background =
        `linear-gradient(${rgba(f.color, f.opacity)}, ${rgba(f.color, f.opacity)}), ${hex(base)}`;
    });
    groups[1].swatches.forEach((b, i) => {
      (b.firstChild as HTMLElement).style.background = hex(groups[1].list[i].color);
    });
  }

  const knobs = el('div', 'knobs');
  body.append(knobs);
  const sliders = KNOBS.map(([key, label, min, max, text]) => {
    const cell = el('div', 'knob');
    const value = el('span', 'knob-v');
    const input = el('input', 'knob-in');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String((max - min) / 100);
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-description', text);
    const name = el('span', 'knob-k', label);
    name.append(el('i', 'knob-i', 'i'));
    cell.append(name, value, input);
    knobs.append(cell);

    const show = () => {
      value.textContent = tune[key].toFixed(2);
      input.style.setProperty('--p', String((tune[key] - min) / (max - min)));
    };
    const write = (v: number) => {
      input.value = String(v);
      tune[key] = Number(input.value); // snapped and clamped by the input
      show();
    };
    input.addEventListener('input', () => write(Number(input.value)));
    input.addEventListener('focus', () => showInfo(label, text));
    input.addEventListener('blur', () => { if (infoKey === label) hideInfo(); });

    // The whole cell is the handle, captured so a drag never reaches the canvas or scrolls.
    // Mouse: the thumb jumps to the press. Touch: a tap only shows what the setting does,
    // a sideways drag moves the value from where it was.
    let held = -1, touch = false, moved = false, x0 = 0, v0 = 0;
    const span = () => Math.max(1, input.getBoundingClientRect().width - THUMB);
    const at = (x: number) => {
      const r = input.getBoundingClientRect();
      write(min + Math.min(1, Math.max(0, (x - r.left - THUMB / 2) / span())) * (max - min));
    };
    cell.addEventListener('pointerdown', (e) => {
      if (held !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      held = e.pointerId;
      touch = e.pointerType !== 'mouse';
      moved = false;
      x0 = e.clientX;
      v0 = tune[key];
      try { cell.setPointerCapture(held); } catch { /* fine */ }
      cell.classList.add('held');
      showInfo(label, text);
      if (!touch) at(e.clientX);
    });
    cell.addEventListener('pointermove', (e) => {
      if (e.pointerId !== held) return;
      if (!touch) { at(e.clientX); return; }
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < DEAD) return;
      moved = true;
      write(v0 + (dx / span()) * (max - min));
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      held = -1;
      cell.classList.remove('held');
      if (touch) showInfo(label, text, INFO_MS);
    };
    cell.addEventListener('pointerup', release);
    cell.addEventListener('pointercancel', release);
    // Hover is the tooltip for a mouse.
    cell.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && held === -1) showInfo(label, text); });
    cell.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && held === -1 && infoKey === label) hideInfo(); });

    return { key, input, show };
  });

  let open = false;
  function setOpen(o: boolean) {
    open = o;
    sheet.classList.toggle('open', o);
    sheet.inert = !o;
    gearButton.classList.toggle('on', o);
    gearButton.setAttribute('aria-expanded', String(o));
    if (!o) hideInfo();
  }
  setOpen(false);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });

  root.append(info, sheet, seg, hist, bench, gearButton);
  document.body.append(root);

  return {
    setTool(t) {
      const i = h.tools.indexOf(t);
      seg.style.setProperty('--i', String(i));
      toolButtons.forEach((b, k) => {
        b.classList.toggle('on', k === i);
        b.setAttribute('aria-checked', String(k === i));
      });
    },
    setFinish(index, variant) {
      const g = groups[index];
      g.name.textContent = g.list[variant].name;
      g.swatches.forEach((b, k) => {
        b.classList.toggle('on', k === variant);
        b.setAttribute('aria-checked', String(k === variant));
      });
      if (index === 1) base = g.list[variant].color;
      paintSwatches();
    },
    syncSliders() {
      for (const s of sliders) { s.input.value = String(tune[s.key]); s.show(); }
    },
    setHistory(n, m) {
      count.textContent = n > 0 ? String(n) : '';
      undo.disabled = n === 0;
      redo.disabled = m === 0;
    },
  };
}
