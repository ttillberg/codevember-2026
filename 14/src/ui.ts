// The furniture: the bar (the string, the scale, the arp) and the mixer beside it, bottom centre
// (bottom right with a mouse), and a word in the middle now and then. Settings live in settings.ts.

import { PRESETS } from './presets';

export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * A press on a button. iOS sends no click while another finger is down (on the string), so a
 * finger acts on its own lift; a mouse (and the keyboard) still clicks.
 */
export function onTap(el: HTMLElement, fn: () => void) {
  let downId = -1;
  let lastTouch = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') downId = e.pointerId;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || e.pointerId !== downId) return;
    downId = -1;
    lastTouch = performance.now();
    fn();
  });
  el.addEventListener('pointercancel', () => (downId = -1));
  el.addEventListener('click', () => {
    // the click a finger's tap may still bring after its lift: already done
    if (performance.now() - lastTouch < 600) return;
    fn();
  });
}

function button(cls: string, label: string, html: string) {
  const b = el('button', cls);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.innerHTML = html;
  // no focus from a press, so Space never presses it again
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}


// ------------------------------------------------------------------ the bar
// Like the bar of day 07: icons in a frosted pill. A picker shows only its current choice;
// press it and the choices stack up above it (drag up to one and let go, or tap and tap one).
// A knob is a level: hold and drag up, or tap to pin its gauge open and drag on that.

const svg = (body: string, extra = '') =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

/** one per string: what it is, in a line */
const ICON_PRESET: Record<string, string> = {
  // the string pulled aside
  tension: svg('<path d="M12 2.5 L17.5 12 L12 21.5"/><circle cx="17.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  // a wine glass
  glass: svg('<path d="M7 3h10c0 5.5-2.2 8.5-5 8.5S7 8.5 7 3z"/><path d="M12 11.5V20M8.5 20.5h7"/>'),
  // a round wooden body and its hole
  wood: svg('<path d="M12 3c2.6 0 3.6 1.8 3.6 3.6 0 1.5-.9 2.3-.9 3.3 0 1 2.6 2 2.6 5.1 0 3.2-2.4 5.5-5.3 5.5S6.7 18.2 6.7 15c0-3.1 2.6-4.1 2.6-5.1 0-1-.9-1.8-.9-3.3C8.4 4.8 9.4 3 12 3z"/><circle cx="12" cy="14.6" r="1.8"/>'),
  // a square wave
  square: svg('<path d="M2.5 15.5h3v-7h6.5v7h6.5v-7h3"/>'),
  // a speaker cabinet
  doom: svg('<rect x="5" y="2.5" width="14" height="19" rx="1.5"/><circle cx="12" cy="8.2" r="2.6"/><circle cx="12" cy="15.8" r="2.6"/>'),
};

/** a scale as a clock: the twelve semitones round, the root on top, its notes lit */
function scaleIcon(notes: number[]) {
  let b = '';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = (12 + 8.5 * Math.sin(a)).toFixed(2);
    const y = (12 - 8.5 * Math.cos(a)).toFixed(2);
    b += notes.includes(k)
      ? `<circle cx="${x}" cy="${y}" r="${k === 0 ? 2.4 : 1.9}" fill="currentColor" stroke="none"/>`
      : `<circle cx="${x}" cy="${y}" r=".8" fill="currentColor" stroke="none" opacity=".45"/>`;
  }
  return svg(b);
}

/** a groove as its sixteen steps: accents tall, plain notes half, ghosts short */
function grooveIcon(vel: string | null) {
  if (!vel) return svg('<path d="M3 12h18" stroke-dasharray="1.5 3.2"/>');
  let b = '';
  for (let i = 0; i < 16; i++) {
    const hgt = ({ X: 14, x: 8, g: 3.5 } as Record<string, number>)[vel[i]];
    if (!hgt) continue;
    const x = (2.6 + i * 1.25).toFixed(2);
    b += `<rect x="${x}" y="${(12 - hgt / 2).toFixed(2)}" width=".9" height="${hgt}" rx=".45" fill="currentColor" stroke="none"/>`;
  }
  return svg(b);
}

/** popovers slide sideways to stay this far inside the screen */
const EDGE = 8;
/** a piece of the bar: its button and the popover over it */
function knobBox(label: string, key?: string) {
  const box = el('div', 'knob named');
  const b = button('kb', label, '');
  const pop = el('div', 'gauge');
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  // its name, written over it, outside the bar (gone while its popover is up)
  box.append(b, pop, el('span', 'lbl', label));
  if (!TOUCH) {
    const tip = el('span', 'tip', label);
    if (key) tip.append(el('kbd', '', key));
    b.append(tip);
  }
  // slid sideways to stay on screen; the labels go left on the right half
  const place = () => {
    // (from its own width, not its box: it may be mid-transition, scaled down)
    const kr = box.getBoundingClientRect();
    const cx = kr.left + kr.width / 2;
    const half = pop.offsetWidth / 2;
    const dx = Math.max(EDGE - (cx - half), Math.min(0, innerWidth - EDGE - (cx + half)));
    pop.style.setProperty('--dx', `${dx}px`);
    const br = b.getBoundingClientRect();
    pop.classList.toggle('flip', br.left + br.width / 2 > innerWidth / 2);
  };
  return { box, b, pop, place };
}

/** closes on a press anywhere outside `box` (the string too: it still gets the press) */
function dismiss(box: HTMLElement, close: () => void) {
  window.addEventListener('pointerdown', (e) => !box.contains(e.target as Node) && close(), true);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}

function picker<T>(o: { label: string; key?: string; items: T[]; name(v: T): string; icon(v: T): string; pick(i: number): void }) {
  const { box, b, pop, place } = knobBox(o.label, o.key);
  const face = el('span', 'face');
  b.prepend(face);
  const rows = o.items.map((v, i) => {
    const r = button('row', o.name(v), o.icon(v));
    r.dataset.i = String(i);
    r.append(el('span', 'name', o.name(v)));
    pop.append(r);
    return r;
  });
  pop.classList.add('pick');
  let cur = 0;
  let open = false;
  let hot = -1;
  // the press that opened it: a drag from it picks where it ends, a tap leaves it open
  let drag: { id: number; y: number; moved: boolean } | null = null;
  const show = () => rows.forEach((r, i) => r.classList.toggle('on', (hot >= 0 ? hot : cur) === i));
  const setOpen = (on: boolean) => {
    open = on;
    b.classList.toggle('on', on);
    pop.classList.toggle('open', on);
    box.classList.toggle('open', on);
    if (!on) (hot = -1), (drag = null);
    else place();
    show();
  };
  const choose = (i: number) => {
    setOpen(false);
    if (i === cur) return;
    // (it shows what was picked itself; `set` from outside is only for changes made elsewhere)
    set(i);
    o.pick(i);
  };
  // the row at this height, wherever the finger is sideways; past the top, the top one; back
  // down over the button, none
  const rowAt = (y: number) => {
    const bottom = rows[0].getBoundingClientRect().bottom;
    if (y > bottom + 6) return -1;
    let best = -1;
    let bestD = Infinity;
    rows.forEach((r, i) => {
      const q = r.getBoundingClientRect();
      const d = Math.abs(q.top + q.height / 2 - y);
      if (d < bestD) (bestD = d), (best = i);
    });
    return best;
  };
  b.addEventListener('pointerdown', (e) => {
    if (open) return setOpen(false);
    drag = { id: e.pointerId, y: e.clientY, moved: false };
    setOpen(true);
  });
  window.addEventListener('pointermove', (e) => {
    if (!open || !drag || e.pointerId !== drag.id) return;
    if (Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) (hot = rowAt(e.clientY)), show();
  });
  const up = (e: PointerEvent) => {
    if (!open || !drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    const i = rowAt(e.clientY);
    if (i >= 0) choose(i);
    else setOpen(false);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', () => drag && setOpen(false));
  // tapped open: a row picks on its own lift (a finger on the string blocks iOS's click)
  rows.forEach((r, i) => onTap(r, () => !drag && choose(i)));
  dismiss(box, () => open && setOpen(false));
  const set = (i: number) => {
    cur = i;
    face.innerHTML = o.icon(o.items[i]);
    b.setAttribute('aria-label', `${o.label}: ${o.name(o.items[i])}`);
    show();
  };
  set(0);
  return { box, set };
}

/**
 * A level in the mixer: a horizontal slider, its name on the left and its number on the right.
 * Press anywhere on it and the level goes there and follows the finger; the wheel nudges it.
 */
function hslider(o: { label: string; value: number; put(t: number): void }) {
  const row = el('div', 'hs');
  row.setAttribute('role', 'slider');
  row.setAttribute('aria-label', o.label);
  row.tabIndex = 0;
  const fill = el('span', 'fill');
  const num = el('b', '');
  row.append(fill, el('span', 'name', o.label), num);
  let t = o.value;
  let id = -1;
  const draw = () => {
    row.style.setProperty('--t', String(t));
    num.textContent = String(Math.round(t * 100));
    row.setAttribute('aria-valuenow', String(Math.round(t * 100)));
  };
  const to = (v: number) => {
    t = Math.min(1, Math.max(0, v));
    o.put(t);
    draw();
  };
  // (measured once a press, not on every move: the draw would force a layout each time)
  let r = row.getBoundingClientRect();
  const at = (e: PointerEvent) => to((e.clientX - r.left - 8) / (r.width - 16));
  row.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    id = e.pointerId;
    r = row.getBoundingClientRect();
    row.setPointerCapture?.(e.pointerId);
    row.classList.add('on');
    at(e);
  });
  // (on the window: a finger whose capture iOS drops still gets here)
  window.addEventListener('pointermove', (e) => e.pointerId === id && at(e));
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    row.classList.remove('on');
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  row.addEventListener('wheel', (e) => (e.preventDefault(), to(t - Math.sign(e.deltaY) * 0.02)), { passive: false });
  row.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to(t + 0.05);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to(t - 0.05);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  draw();
  /** `show`: changed elsewhere, only drawn (the handler isn't run again) */
  return { row, show: (v: number) => ((t = Math.min(1, Math.max(0, v))), draw()) };
}

/** the mixer's button: three faders */
const ICON_MIX =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 6h18M3 12h18M3 18h18" opacity="0.45"/><circle cx="8" cy="6" r="2.2" fill="currentColor"/><circle cx="15" cy="12" r="2.2" fill="currentColor"/><circle cx="11" cy="18" r="2.2" fill="currentColor"/></svg>';

/**
 * The mixer: one button beside the bar; tap it and its sliders open over it, one under the other
 * (sustain, reverb, pad, harmonics, delay). Tap it again, or press anywhere else, and they close.
 */
function mixer(rows: Array<{ label: string; value: number; put(t: number): void }>) {
  const { box, b, pop, place } = knobBox('Mix');
  const face = el('span', 'face');
  face.innerHTML = ICON_MIX;
  b.prepend(face);
  pop.classList.add('mix');
  const sliders = rows.map((o) => hslider(o));
  for (const sl of sliders) pop.append(sl.row);
  let open = false;
  const setOpen = (on: boolean) => {
    open = on;
    b.classList.toggle('on', on);
    pop.classList.toggle('open', on);
    box.classList.toggle('open', on);
    if (on) place();
  };
  b.addEventListener('pointerdown', () => setOpen(!open));
  dismiss(box, () => open && setOpen(false));
  return { box, sliders };
}

/** the mixer's levels, 0..1 each, in its order */
export const LEVELS = [
  ['sustain', 'Sustain'],
  ['room', 'Reverb'],
  ['pad', 'Pad'],
  ['harm', 'Harmonics'],
  ['delay', 'Delay'],
] as const;
export type LevelKey = (typeof LEVELS)[number][0];

export interface UiHandlers {
  preset(i: number): void;
  /** a level moved (the mixer shows it already) */
  level(key: LevelKey, t: number): void;
  /** -1 off, else the pattern */
  arp(mode: number): void;
  scale(i: number): void;
}

export interface BarInit {
  scales: Array<{ label: string; notes: number[] }>;
  patterns: ReadonlyArray<{ label: string; vel: string }>;
  levels: Record<LevelKey, number>;
}

export function createUi(h: UiHandlers, init: BarInit) {
  // bottom centre: the string and its scale | the groove
  const bar = el('div', 'bar');
  const instrument = picker({
    label: 'String', items: PRESETS, name: (p) => p.label, icon: (p) => ICON_PRESET[p.id] ?? ICON_PRESET.tension, pick: (i) => h.preset(i),
  });
  const scale = picker({
    label: 'Scale', key: 'S', items: init.scales, name: (s) => s.label, icon: (s) => scaleIcon(s.notes), pick: (i) => h.scale(i),
  });
  const arpItems: Array<{ label: string; vel: string | null }> = [{ label: 'Off', vel: null }, ...init.patterns];
  const arp = picker({
    label: 'Arp', key: 'A', items: arpItems, name: (a) => a.label, icon: (a) => grooveIcon(a.vel), pick: (i) => h.arp(i - 1),
  });
  // the levels: one button, a slider each over it
  const mix = mixer(LEVELS.map(([key, label]) => ({ label, value: init.levels[key], put: (t: number) => h.level(key, t) })));
  bar.append(instrument.box, scale.box, arp.box);
  // the mixer on its own, beside the bar
  const solo = el('div', 'solo');
  solo.append(mix.box);
  const dock = el('div', 'dock');
  dock.append(bar, solo);

  const toastEl = el('div', 'toast');
  document.body.append(dock, toastEl);
  // (changes made elsewhere, a key or a snapshot: only shown)
  return {
    setPreset: (i: number) => instrument.set(i),
    setScale: (i: number) => scale.set(i),
    setArp: (mode: number) => arp.set(mode + 1),
    showLevel: (key: LevelKey, t: number) => mix.sliders[LEVELS.findIndex(([k]) => k === key)].show(t),
    /** a word in the middle of the screen for a moment */
    toast(text: string) {
      toastEl.textContent = text;
      toastEl.classList.remove('show');
      void toastEl.offsetWidth;
      toastEl.classList.add('show');
    },
  };
}
