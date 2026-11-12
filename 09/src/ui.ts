// The on-screen controls. Plain DOM, laid out by style.css: a bar under the sphere (the tool
// picker, undo and redo, and while developing the gear), the help in the top right corner,
// and the settings sheet the gear opens, with two tabs: the layers (each film and the sphere,
// and how each looks) and the feel (sliders for the peel). Only the controls take pointers,
// never the space between them: that belongs to the canvas.

import type { Tool } from './state';
import type { LayerEdit } from './layers';
import { tune } from './peel';
import type { Tune } from './peel';

/** What a swatch needs of a finish (layers.ts). */
export interface Finish { name: string; color: number; opacity: number }

/** A layer as the list shows it. Colours are hex numbers (0xrrggbb). */
export interface LayerView {
  name: string;
  color: number; opacity: number; roughness: number; metalness: number;
  print: 'none' | 'label' | 'net'; ink: number;
}

export interface UiHandlers {
  tools: readonly Tool[];
  /** Film presets, then base presets. */
  finishes: readonly [readonly Finish[], readonly Finish[]];
  /** What is drawn on top (world.show). The toggles write here. */
  show: { debug: boolean; grid: boolean; films: boolean };
  /** Every setting as text, for the copy button. */
  settings(): string;
  /** The most films there can be. */
  maxFilms: number;
  /** The films now, top first. */
  films(): LayerView[];
  /** The sphere under them. */
  base(): LayerView;
  onAddFilm(): void;
  onRemoveFilm(index: number): void;
  /** Change the look of film `index`; -1 is the base. */
  onEdit(index: number, edit: LayerEdit): void;
  /** Load preset `variant` (an index into finishes[0], or finishes[1] for the base) into film `index`; -1 is the base. */
  onPreset(index: number, variant: number): void;
  onTool(t: Tool): void;
  onBack(): void;
  onRedo(): void;
  /** Every film whole again. */
  onReset(): void;
}

export interface Ui {
  setTool(t: Tool): void;
  /** The stack or a look changed: read films() and base() again and redraw the list. Keep
   *  the selection if that row still exists. */
  syncLayers(): void;
  /** Read every slider back from `tune`. */
  syncSliders(): void;
  /** Read the toggles back from `show`. */
  syncShow(): void;
  /** Steps that can be undone and redone; 0 disables the button. */
  setHistory(undo: number, redo: number): void;
}

// How the film behaves in the hand: [key, label, min, max, what it does].
const KNOBS: Array<[keyof Tune, string, number, number, string]> = [
  ['elastic', 'stretch', 0, 0.6, 'How far the film stretches before the pull reaches the front. 0 follows the finger exactly, higher is rubbery and lags.'],
  ['adhesion', 'cling', 0, 6, 'How hard the film sticks. Higher needs a longer pull before each bit lets go.'],
  ['shear', 'shear', 0, 15, 'How much film dragged flat along the surface holds out, compared with film folded back and peeled. Higher keeps the peel a narrow tongue along the pull.'],
  ['load', 'front', 0, 4, 'How much a wide peel front weighs. At 0 width makes no difference. Only matters with cling above 0.'],
  ['lift', 'lift', 0, 1, 'How the hand pulls. 0 drags the film flat back over itself. 1 lifts it up and away as it goes, so the finger stays over the place where the film comes off.'],
  ['ghost', 'ghost', 0, 1, 'How visible the lifted film stays behind the front. 0 fades out, 1 stays solid. Looks only.'],
  ['height', 'band', 0, 2, 'How much of the lifted film is shown: it is cut off where it rises higher than this above the sphere (in radii). The rest of what is in the hand is not drawn.'],
  ['rough', 'rough', 0, 1, 'How unevenly the film sticks from spot to spot. 0 gives a clean front, 1 a stuttering one.'],
  ['tear', 'tear', 0, 10, 'Strength. The film breaks off when the peel front gets this wide, sooner on a fast pull. 0 never breaks.'],
  ['edge', 'edge', 0, 1, 'How much more easily the film lets go along a free edge than in the middle. Higher lets the peel run out along a cut, so the front meets it as an arc.'],
  ['straight', 'straight', 0, 1, 'Above 0.5 the lifted film is a taut flat sheet: stuck film lying under it lets go, so the front runs straight from edge to edge. Below 0.5 each spot only answers for itself.'],
  ['grip', 'grip', 1, 12, 'How wide a strip of the edge the finger holds. Narrow gathers the film to a point, wide pulls it off flat. Takes effect on the next grab.'],
];

// The look of a layer: [key, label, what it does]. All 0..1.
type Look = 'opacity' | 'roughness' | 'metalness';
const LOOKS: Array<[Look, string, string]> = [
  ['opacity', 'opacity', 'How much of what is under the film it hides. 0 is clear, 1 opaque.'],
  ['roughness', 'rough', 'How matte the surface is. 0 is a mirror gloss, 1 dead matte.'],
  ['metalness', 'metal', '0 a dielectric like film or paper, 1 a metal: its colour is then the colour of its reflections.'],
];
const PRINTS = ['none', 'label', 'net'] as const;

const THUMB = 14;       // px, keep in step with the slider thumb in style.css
const DEAD = 4;         // px a touch moves before it counts as a drag, not a tap
const INFO_MS = 8000;   // how long a touched setting's text stays up

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
/** The pointing hand of day 08's cheat sheet, as a manual draws it: the index up, the other
 *  three folded in a row of knuckles, the thumb curled in. In its own units, the fingertip at
 *  the origin and the wrist at y 38. */
const HAND = 'M-4.5 21V4.5A4.5 4.5 0 0 1 4.5 4.5V17C5 13.5 11.5 13.5 11.5 17.5C12 15 17 15.5 17 19.5C17.5 17.5 21.5 18.5 21 22.5C21 30 19 34 16.5 38H-7.5C-10.5 34 -13 31 -14 27C-15.5 23 -14.5 19 -11.5 18.5C-8.5 18 -6 20 -4.5 21Z';
const HAND_LINES = 'M4.5 17V22M11.5 17.5V23M17 19.5V24.5M-4.5 21C-6 23 -6.5 26 -6 28';
/** The tools: a finger with a blade beside it, a finger, a blade, a ruler with its ticks,
 *  four claw marks. */
const KNIFE = 'M4.5 19.5 9 15M9 15l9.5-11.5c1.6 2.6 1.4 6.2-.6 8.8L12.5 18.5z';
const hand = (at: string) => `<g transform="${at}"><path vector-effect="non-scaling-stroke" d="${HAND}"/><path vector-effect="non-scaling-stroke" d="${HAND_LINES}"/></g>`;
const TOOL_ICON: Record<Tool, string> = {
  combo: '',
  peel: '',
  knife: KNIFE,
  ruler: 'M3.5 16 16 3.5l4.5 4.5L8 20.5zM7.5 12l2 2M10.5 9l2 2M13.5 6l2 2',
  scratch: 'M6.5 4c-1.4 5-1.4 11 0 16M10.5 4c-1.4 5-1.4 11 0 16M14.5 4c-1.4 5-1.4 11 0 16M18.5 5.5c-1.2 4.4-1.2 9 0 13',
};
/** What a tool's icon has beside its one path (the hand is drawn in its own units, scaled in). */
const TOOL_EXTRA: Partial<Record<Tool, string>> = {
  combo: hand('translate(7.4 6.2) scale(0.42)') + `<path vector-effect="non-scaling-stroke" transform="translate(11.6 0.6) scale(0.56)" d="${KNIFE}"/>`,
  peel: hand('translate(10.4 2.2) scale(0.52)'),
};
const toolIcon = (t: Tool) => icon(TOOL_ICON[t], TOOL_EXTRA[t] ?? '');
const TOOL_TIP: Record<Tool, string> = { combo: 'Peel and cut', peel: 'Peel', knife: 'Knife', ruler: 'Ruler', scratch: 'Scratch' };
/** The modifier that turns peeling into cutting, as this keyboard prints it. */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '\u2318' : 'Ctrl';
/** No keys under a finger: a touch screen gets its gestures and no shortcuts. */
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
/** The help, in sections (as on day 07): the gesture or keys, then what it does. A string in
 *  [brackets] is drawn as a key cap. */
const HELP: Array<[string, string, Array<[string, string]>]> = TOUCH ? [
  ['Peel and cut', 'where the finger lands says which', [
    ['Drag an edge', 'peel'],
    ['Drag on the film', 'knife'],
    ['Drag from outside', 'turn'],
    ['Two fingers on the film', 'scratch'],
    ['Two fingers outside', 'ruler'],
  ]],
  ['Tool', '', [
    ['Tap', 'open it'],
    ['Hold + drag', 'pick'],
  ]],
  ['History', '', [
    ['The arrows', 'undo, redo'],
    ['The round arrow', 'start over'],
  ]],
] : [
  ['Peel and cut', 'where the press lands says which', [
    ['Drag an edge', 'peel'],
    ['Drag on the film', 'knife'],
    ['Drag from outside', 'turn'],
    [`[${MOD}] + drag`, 'ruler'],
    ['[\u21e7] + drag', 'scratch'],
  ]],
  ['Tools', 'hold T, move, let go', [
    ['[T]', 'tool menu'],
    ['[1] [2] [3] [4] [5]', 'pick a tool'],
  ]],
  ['History', '', [
    [`[${MOD}] [Z]`, 'undo'],
    [`[\u21e7] [${MOD}] [Z]`, 'redo'],
    ['[R]', 'start over'],
  ]],
];
/** An arrow round on itself: start over. */
const RESET = 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2';
const PLUS = 'M12 6v12M6 12h12';
const MINUS = 'M7 12h10';

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

/** A panel that a button opens. Keeps the open state on both, closes on Escape and, when a
 *  `scope` is given, on a press anywhere outside it. `changed` hears every change. */
function popover(opener: HTMLElement, panel: HTMLElement, scope: HTMLElement | null, changed?: (open: boolean) => void) {
  let open = false;
  const set = (o: boolean) => {
    open = o;
    panel.classList.toggle('open', o);
    panel.inert = !o;
    opener.classList.toggle('on', o);
    opener.setAttribute('aria-expanded', String(o));
    changed?.(o);
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) set(false); });
  if (scope) window.addEventListener('pointerdown', (e) => { if (open && !scope.contains(e.target as Node)) set(false); }, true);
  set(false);
  return { set, get open() { return open; } };
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
/** A film's colour at its opacity over what it lies on. */
const over = (c: number, a: number, under: number) => `linear-gradient(${rgba(c, a)}, ${rgba(c, a)}), ${hex(under)}`;

interface KnobSpec { label: string; min: number; max: number; text: string; get(): number; set(v: number): void }

export function createUi(h: UiHandlers): Ui {
  const root = el('div', 'ui');
  // iOS only shows :active with a touch listener somewhere above.
  root.addEventListener('touchstart', () => {}, { passive: true });

  // Every control in one frosted pill under the sphere (the bar of day 07): the tools, undo
  // and redo, and the gear for the settings.
  const bar = el('div', 'bar');
  /** What a button is, shown over it on hover, with its key. */
  const tip = (b: HTMLElement, text: string, ...keys: string[]) => {
    b.removeAttribute('title');
    const t = el('span', 'tip', text);
    for (const key of keys) t.append(el('kbd', '', key));
    b.append(t);
  };
  const sep = () => el('span', 'bar-sep');
  // The tool: one button showing the one in use. Pressed, the others stack up over it, each
  // with its name and how it is reached; a press dragged up picks the one it is let go on, a
  // tap leaves them open to pick from. (The picker of day 07.)
  const pick = el('div', 'pick');
  const toolButton = button('tool', () => {}, 'Tool');
  toolButton.setAttribute('aria-haspopup', 'true');
  const pop = el('div', 'pick-pop');
  pick.append(toolButton, pop);
  bar.append(pick);
  let hot: Tool | null = null;
  /** A press on the button, or the T key held (`key`): then the stack is under the cursor. */
  const held = { y: 0, moved: false, down: false, key: false };
  const mouse = { x: 0, y: 0 };
  const toolRows = new Map<Tool, HTMLButtonElement>();
  const keysOf = (t: Tool) => [String(h.tools.indexOf(t) + 1)];
  const setHot = (t: Tool | null) => { hot = t; for (const [k, b] of toolRows) b.classList.toggle('on', k === t); };
  const picker = popover(toolButton, pop, pick, (o) => { if (!o) setHot(null); });
  /** The tool of the row at this height, wherever the pointer is sideways; past the top the
   *  top one, back down over the button none: letting go there changes nothing. */
  function rowAt(y: number): Tool | null {
    let best: Tool | null = null, bestD = Infinity, bottom = -Infinity;
    for (const [t, b] of toolRows) {
      const r = b.getBoundingClientRect();
      bottom = Math.max(bottom, r.bottom);
      const d = Math.abs(r.top + r.height / 2 - y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return y > bottom + 6 ? null : best;
  }
  function choose(t: Tool) { picker.set(false); h.onTool(t); }
  /** The button shows `t`; the stack lists the others, the first of them nearest the button. */
  function showTool(t: Tool) {
    toolButton.replaceChildren(toolIcon(t));
    toolButton.setAttribute('aria-label', `Tool: ${TOOL_TIP[t]}`);
    tip(toolButton, TOOL_TIP[t], 'T');
    toolRows.clear();
    pop.replaceChildren();
    for (const o of h.tools) {
      if (o === t) continue;
      const b = button('', () => choose(o), TOOL_TIP[o]);
      b.removeAttribute('title');
      const label = el('span', 'pick-label', TOOL_TIP[o]);
      for (const k of keysOf(o)) label.append(el('kbd', '', k));
      b.append(toolIcon(o), label);
      toolRows.set(o, b);
      pop.append(b);
    }
  }
  /** Move the closed stack somewhere else at once: without this its opening transition would
   *  also carry it there, and it would glide in from where it last was. */
  function jump(place: () => void) {
    pop.style.transition = 'none';
    place();
    void pop.offsetWidth; // the new place is taken in before the transition is back
    pop.style.transition = '';
  }
  /** The stack back over its button (after the T key put it under the cursor). */
  function placeHome() {
    if (!pop.classList.contains('at')) return;
    jump(() => {
      pop.classList.remove('at', 'flip');
      pop.style.left = pop.style.top = '';
    });
  }
  toolButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (picker.open) { picker.set(false); return; }
    placeHome();
    held.y = e.clientY; held.moved = false; held.down = true; held.key = false;
    picker.set(true);
  });
  // Held by its key, T, the stack opens just above the cursor, wherever that is, so nothing
  // is picked until the pointer moves up into it; the row under the pointer is picked when
  // the key is let go, and letting go off the stack changes nothing. (As on day 07.)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const PAD = 8, w = pop.offsetWidth, hgt = pop.offsetHeight, r = pick.getBoundingClientRect();
    const x = Math.min(window.innerWidth - w - PAD, Math.max(PAD, mouse.x - w / 2));
    const y = Math.min(window.innerHeight - hgt - PAD, Math.max(PAD, mouse.y - (hgt + 16)));
    jump(() => {
      pop.classList.add('at');
      pop.classList.toggle('flip', mouse.x > window.innerWidth / 2); // the names on the side there is room
      pop.style.left = `${x - r.left}px`;
      pop.style.top = `${y - r.top}px`;
    });
    held.y = mouse.y; held.moved = true; held.down = true; held.key = true;
    picker.set(true);
    setHot(null);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'KeyT' || !held.key) return;
    held.key = false; held.down = false;
    const t = hot;
    if (picker.open) { if (t) choose(t); else picker.set(false); }
  });
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!picker.open || !held.down) return;
    if (Math.abs(e.clientY - held.y) > 6) held.moved = true;
    if (held.moved) setHot(rowAt(e.clientY));
  });
  window.addEventListener('pointerup', (e) => {
    if (!picker.open || !held.down || held.key) return;
    held.down = false;
    if (!held.moved) return; // a tap: the stack stays open
    const t = rowAt(e.clientY);
    if (t) choose(t); else picker.set(false);
  });
  window.addEventListener('pointercancel', () => { held.down = false; });
  showTool(h.tools[0]);

  const undo = button('undo', h.onBack, 'Undo');
  undo.append(icon(UNDO));
  tip(undo, 'Undo', `${MOD} Z`);
  const redo = button('redo', h.onRedo, 'Redo');
  redo.append(icon(UNDO));
  tip(redo, 'Redo', `\u21e7 ${MOD} Z`);
  const reset = button('reset', h.onReset, 'Start over');
  reset.append(icon(RESET));
  tip(reset, 'Start over', 'R');

  // Settings: the gear opens the sheet.
  const gearButton = button('gear', () => sheetPop.set(!sheetPop.open), 'Settings');
  gearButton.append(icon(gear(), '<circle cx="12" cy="12" r="3"/>'));
  tip(gearButton, 'Settings');
  // The settings are a workbench, not part of the piece: the gear is there while developing
  // (and with ?settings in the address), not on the published page.
  const withSettings = import.meta.env.DEV || new URLSearchParams(location.search).has('settings');
  bar.append(sep(), undo, redo, reset);
  if (withSettings) bar.append(sep(), gearButton);

  // The sheet: two tabs over a body that scrolls on its own.
  const sheet = el('div', 'sheet');
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', 'sheet-body');
  sheet.append(tabs, body);
  const panes = { layers: el('div', 'pane layers'), feel: el('div', 'pane feel') };
  const tabButtons = (Object.keys(panes) as Array<keyof typeof panes>).map((k) => {
    const b = button('tab', () => setTab(k));
    b.textContent = k;
    b.setAttribute('role', 'tab');
    tabs.append(b);
    body.append(panes[k]);
    return { k, b };
  });
  function setTab(k: keyof typeof panes) {
    for (const t of tabButtons) {
      t.b.classList.toggle('on', t.k === k);
      t.b.setAttribute('aria-selected', String(t.k === k));
      panes[t.k].hidden = t.k !== k;
    }
    body.scrollTop = 0;
  }

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

  // A slider cell. The whole cell is the handle, captured so a drag never reaches the canvas
  // or scrolls. Mouse: the thumb jumps to the press. Touch: a tap only shows what the
  // setting does, a sideways drag moves the value from where it was.
  function knob(s: KnobSpec) {
    const cell = el('div', 'knob');
    const value = el('span', 'knob-v');
    const input = el('input', 'knob-in');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String((s.max - s.min) / 100);
    input.setAttribute('aria-label', s.label);
    input.setAttribute('aria-description', s.text);
    const name = el('span', 'knob-k', s.label);
    name.append(el('i', 'knob-i', 'i'));
    cell.append(name, value, input);

    const show = () => {
      const v = s.get();
      input.value = String(v);
      value.textContent = v.toFixed(2);
      input.style.setProperty('--p', String((v - s.min) / (s.max - s.min)));
    };
    const write = (v: number) => {
      input.value = String(v);
      s.set(Number(input.value)); // snapped and clamped by the input
      show();
    };
    input.addEventListener('input', () => write(Number(input.value)));
    input.addEventListener('focus', () => showInfo(s.label, s.text));
    input.addEventListener('blur', () => { if (infoKey === s.label) hideInfo(); });

    let held = -1, touch = false, moved = false, x0 = 0, v0 = 0;
    const span = () => Math.max(1, input.getBoundingClientRect().width - THUMB);
    const at = (x: number) => {
      const r = input.getBoundingClientRect();
      write(s.min + Math.min(1, Math.max(0, (x - r.left - THUMB / 2) / span())) * (s.max - s.min));
    };
    cell.addEventListener('pointerdown', (e) => {
      if (held !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      held = e.pointerId;
      touch = e.pointerType !== 'mouse';
      moved = false;
      x0 = e.clientX;
      v0 = s.get();
      try { cell.setPointerCapture(held); } catch { /* fine */ }
      cell.classList.add('held');
      showInfo(s.label, s.text);
      if (!touch) at(e.clientX);
    });
    cell.addEventListener('pointermove', (e) => {
      if (e.pointerId !== held) return;
      if (!touch) { at(e.clientX); return; }
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < DEAD) return;
      moved = true;
      write(v0 + (dx / span()) * (s.max - s.min));
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      held = -1;
      cell.classList.remove('held');
      if (touch) showInfo(s.label, s.text, INFO_MS);
    };
    cell.addEventListener('pointerup', release);
    cell.addEventListener('pointercancel', release);
    // Hover is the tooltip for a mouse.
    cell.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && held === -1) showInfo(s.label, s.text); });
    cell.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && held === -1 && infoKey === s.label) hideInfo(); });

    show();
    return { cell, show };
  }

  // A colour well: a dot and a word over a native picker that takes the press.
  function colourWell(label: string, onPick: (c: number) => void) {
    const well = el('label', 'well');
    const dot = el('span', 'well-dot');
    const input = el('input', '');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => onPick(parseInt(input.value.slice(1), 16)));
    well.append(dot, el('span', '', label), input);
    return {
      well,
      set(c: number) {
        const v = hex(c);
        if (input.value !== v) input.value = v;
        dot.style.background = v;
      },
    };
  }

  // -------------------------------------------------------------------------- layers

  // One row per film, top first, then the sphere. A tap on a row opens its settings under it.
  let films: LayerView[] = [];
  let base: LayerView = { name: '', color: 0, opacity: 1, roughness: 0, metalness: 0, print: 'none', ink: 0 };
  /** The open row: a film's index, -1 the base, null none. */
  let sel: number | null = null;
  let builtCount = -1;
  let builtSel: number | null = null;
  const look = (i: number) => (i === -1 ? base : films[i]);

  const head = el('div', 'layers-head');
  const headName = el('span', 'layers-count');
  const add = button('btn icon add', () => {
    if (sel !== null && sel >= 0) sel++; // the new film goes on top, the rest move down
    h.onAddFilm();
  }, 'Add a film on top');
  add.append(icon(PLUS));
  head.append(headName, add);
  const list = el('div', 'layer-list');
  panes.layers.append(head, list);

  interface Row { chip: HTMLElement; name: HTMLElement; meta: HTMLElement; minus: HTMLButtonElement | null }
  let rows: Row[] = [];
  let panel: { update(): void } | null = null;

  function row(i: number): Row {
    const r = el('div', 'layer');
    r.setAttribute('role', 'button');
    r.setAttribute('aria-expanded', String(sel === i));
    r.classList.toggle('on', sel === i);
    r.addEventListener('click', () => { sel = sel === i ? null : i; syncLayers(); });
    const chip = el('span', 'chip');
    const text = el('span', 'layer-text');
    const name = el('span', 'layer-name');
    const meta = el('span', 'layer-meta');
    text.append(name, meta);
    r.append(chip, text);
    let minus: HTMLButtonElement | null = null;
    if (i >= 0) {
      minus = button('layer-minus', () => {
        if (sel === i) sel = null;
        else if (sel !== null && sel > i) sel--;
        h.onRemoveFilm(i);
      }, 'Remove this film');
      minus.append(icon(MINUS));
      minus.addEventListener('click', (e) => e.stopPropagation());
      r.append(minus);
    } else r.append(el('span', 'layer-tag', 'base'));
    list.append(r);
    return { chip, name, meta, minus };
  }

  function paintRows() {
    headName.textContent = `films ${films.length} / ${h.maxFilms}`;
    add.disabled = films.length >= h.maxFilms;
    rows.forEach((r, k) => {
      const i = k < films.length ? k : -1;
      const v = look(i);
      r.chip.style.background = i === -1 ? hex(v.color) : over(v.color, v.opacity, base.color);
      r.name.textContent = v.name;
      r.meta.textContent = i === -1
        ? `rough ${v.roughness.toFixed(2)}`
        : `${v.opacity.toFixed(2)}${v.print === 'none' ? '' : ' · ' + v.print}`;
      if (r.minus) r.minus.disabled = films.length <= 1;
    });
  }

  // The settings of layer i: presets, colour, the look sliders, and for a film the print.
  function settings(i: number) {
    const film = i >= 0;
    const box = el('div', 'layer-set');
    const presets = h.finishes[film ? 0 : 1];
    const strip = el('div', 'swatches');
    strip.setAttribute('aria-label', 'presets');
    const swatches = presets.map((f, variant) => {
      const b = button('swatch', () => h.onPreset(i, variant), f.name);
      b.append(el('span', 'chip'));
      strip.append(b);
      return b;
    });
    box.append(strip);

    const sliders = el('div', 'knobs');
    const knobs = LOOKS.filter(([key]) => film || key !== 'opacity').map(([key, label, text]) =>
      knob({ label, min: 0, max: 1, text, get: () => look(i)[key], set: (v) => h.onEdit(i, { [key]: v }) }));
    for (const k of knobs) sliders.append(k.cell);
    box.append(sliders);

    const line = el('div', 'layer-line');
    const colour = colourWell('colour', (c) => h.onEdit(i, { color: c }));
    line.append(colour.well);
    let print: { pick: HTMLButtonElement[]; ink: ReturnType<typeof colourWell> } | null = null;
    if (film) {
      const group = el('div', 'mini-seg');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', 'print');
      const pick = PRINTS.map((p) => {
        const b = button('mini', () => h.onEdit(i, { print: p }), `print: ${p}`);
        b.textContent = p;
        b.setAttribute('role', 'radio');
        group.append(b);
        return b;
      });
      const ink = colourWell('ink', (c) => h.onEdit(i, { ink: c }));
      line.append(group, ink.well);
      print = { pick, ink };
    }
    box.append(line);

    return {
      box,
      update() {
        const v = look(i);
        presets.forEach((f, k) => {
          (swatches[k].firstChild as HTMLElement).style.background = film ? over(f.color, f.opacity, base.color) : hex(f.color);
          swatches[k].classList.toggle('on', f.name === v.name);
        });
        for (const k of knobs) k.show();
        colour.set(v.color);
        if (print) {
          PRINTS.forEach((p, k) => {
            print!.pick[k].classList.toggle('on', v.print === p);
            print!.pick[k].setAttribute('aria-checked', String(v.print === p));
          });
          print.ink.set(v.ink);
          print.ink.well.hidden = v.print === 'none';
        }
      },
    };
  }

  /** Redraw the rows when their number or the open one changed, otherwise only their values,
   *  so a slider being dragged stays the same element under the finger. */
  function syncLayers() {
    films = h.films();
    base = h.base();
    if (sel !== null && sel >= films.length) sel = null;
    if (films.length !== builtCount || sel !== builtSel) {
      list.replaceChildren();
      rows = [];
      panel = null;
      for (let k = 0; k <= films.length; k++) {
        const i = k < films.length ? k : -1;
        rows.push(row(i));
        if (sel === i) {
          const s = settings(i);
          list.append(s.box);
          panel = s;
        }
      }
      builtCount = films.length;
      builtSel = sel;
    }
    paintRows();
    panel?.update();
  }

  // ---------------------------------------------------------------------------- feel

  const knobs = el('div', 'knobs');
  panes.feel.append(knobs);
  const sliders = KNOBS.map(([key, label, min, max, text]) => {
    const k = knob({ label, min, max, text, get: () => tune[key], set: (v) => { tune[key] = v; } });
    knobs.append(k.cell);
    return k;
  });

  // Under the sliders: what is drawn on top, and the settings as text.
  const extras = el('div', 'extras');
  panes.feel.append(extras);
  const toggles = ([['debug', 'debug', 'Outline of what a press would grab, the finger marker and the tension lines'], ['grid', 'grid', 'The millimetre grid on the sphere'], ['films', 'films', 'The films. Off, they are hidden (not removed) and the bare sphere shows']] as const)
    .map(([key, label, text]) => {
      const b = button('btn chip', () => { h.show[key] = !h.show[key]; paint(); }, text);
      b.textContent = label;
      b.setAttribute('role', 'switch');
      const paint = () => { b.classList.toggle('on', h.show[key]); b.setAttribute('aria-checked', String(h.show[key])); };
      extras.append(b);
      return paint;
    });
  const copy = button('btn chip', () => {
    const text = h.settings();
    const done = (ok: boolean) => {
      copy.textContent = ok ? 'copied' : 'no clipboard';
      window.setTimeout(() => { copy.textContent = 'copy'; }, 1200);
    };
    // The clipboard API needs https or localhost; on a phone over the LAN it is not there.
    const byHand = () => {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;left:0;top:0;opacity:0;';
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* fine */ }
      t.remove();
      done(ok);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), byHand);
    else byHand();
  }, 'Copy every setting as text');
  copy.textContent = 'copy';
  extras.append(copy);

  // it stays open while peeling: no press outside closes it
  const sheetPop = popover(gearButton, sheet, null, (o) => { if (!o) hideInfo(); });
  setTab('layers');

  // Help, on its own in the top right corner (as on day 07): a flat question mark, and under
  // it what a drag does where and which keys there are.
  const help = el('div', 'help');
  const helpButton = button('help-btn', () => helper.set(!helper.open), 'Help');
  helpButton.removeAttribute('title');
  const q = document.createElementNS(SVG, 'svg');
  q.setAttribute('viewBox', '0 0 16 16');
  q.setAttribute('aria-hidden', 'true');
  q.innerHTML = '<circle cx="8" cy="8" r="6"/><path d="M6.25 6.4a1.8 1.8 0 1 1 2.6 1.6c-.55.28-.85.65-.85 1.2v.3"/><circle class="dot" cx="8" cy="11.25" r="0.65"/>';
  helpButton.append(q);
  const helpPop = el('div', 'help-pop');
  const dos = el('div', 'dos');
  for (const [name, note, rows] of HELP) {
    const head = el('h5', '', name);
    if (note) head.append(el('span', '', note));
    dos.append(head);
    for (const [how, what] of rows) {
      const a = el('span', 'how');
      // [x] is a key cap, the rest plain words
      for (const part of how.split(/(\[[^\]]+\])/)) {
        if (!part) continue;
        if (part.startsWith('[')) a.append(el('kbd', 'key', part.slice(1, -1)));
        else a.append(part);
      }
      dos.append(a, el('span', 'what', what));
    }
  }
  helpPop.append(dos);
  help.append(helpButton, helpPop);
  const helper = popover(helpButton, helpPop, help);

  root.append(info, sheet, bar, help);
  document.body.append(root);

  return {
    setTool(t) {
      if (picker.open) picker.set(false);
      showTool(t);
    },
    syncLayers,
    syncShow() { for (const paint of toggles) paint(); },
    syncSliders() { for (const s of sliders) s.show(); },
    setHistory(n, m) {
      undo.disabled = n === 0;
      redo.disabled = m === 0;
    },
  };
}
