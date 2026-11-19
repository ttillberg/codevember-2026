// The tool bar, after day 07's: icons in a frosted pill under the scene.
//
//   RAIN  HOSE  WIND  SCRATCH  |  SIZE  FORCE
//
// A tap on a tool picks it. Size and force are knobs, the same two for every tool, each showing
// and setting the value of the tool in hand: hold the knob and drag, up or right, and a tall
// gauge shows while you hold. A tap pins the gauge open, to drag on it directly; a press
// elsewhere closes it. The wheel over a knob nudges it. Both can also be dragged on the scene
// itself (main.ts): cmd for the size, shift and cmd for the force.

const TRAVEL = 140; // px of drag for the whole range, the gauge's height

export type BarTool = { id: number; name: string; key: string; icon: string };
export type BarKnob = {
  name: string;
  key?: string; // how to set it from the scene, shown in its tip
  face(t: number): string; // the button's picture at this value, an svg
  get(): number; // 0..1, for the tool in hand
  put(t: number): void;
};

// 24 px line icons (Feather's cloud-rain, droplet and wind; the scratch is three claw marks).
export const ICONS = {
  rain: 'M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  water: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  wind: 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2',
  scratch: 'M8 3L4.5 21M13.5 3L10 21M19 3l-3.5 18',
};

const SVG = 'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const svg = (d: string) => `<svg ${SVG}><path d="${d}"/></svg>`;
const tip = (name: string, key?: string) => `<span class="tip" aria-hidden="true">${name}${key ? `<kbd>${key}</kbd>` : ''}</span>`;

// Size: a ring, the brush at its biggest, and a disc in it as big as the brush is now.
export const sizeFace = (t: number) =>
  `<svg ${SVG}><circle cx="12" cy="12" r="10.5" class="empty"/><circle cx="12" cy="12" r="${(2 + 8.5 * t).toFixed(2)}" fill="currentColor" stroke="none"/></svg>`;

// Force: a volume ramp, a wedge from nothing to a lot, filled up to where it is now (day 07's).
const RAMP = 'M1.5 20.5 L22.5 4.5 L22.5 20.5 Z';
export const forceFace = (t: number) =>
  `<svg ${SVG} class="ramp"><clipPath id="force-fill"><rect x="0" y="0" width="${(1.5 + 21 * t).toFixed(2)}" height="24"/></clipPath>` +
  `<path d="${RAMP}" class="empty"/><path d="${RAMP}" clip-path="url(#force-fill)" fill="currentColor"/></svg>`;

export function buildBar(host: HTMLElement, tools: BarTool[], knobs: BarKnob[], on: { select(id: number): void }) {
  const buttons = new Map<number, HTMLButtonElement>();
  const redraw: (() => void)[] = [];
  const peeks = new Map<string, (open: boolean) => void>();

  for (const tool of tools) {
    const box = document.createElement('div');
    box.className = 'knob';
    box.innerHTML = `<button aria-label="${tool.name}">${svg(tool.icon)}${tip(tool.name, tool.key)}</button>`;
    host.append(box);
    const button = box.querySelector('button')!;
    buttons.set(tool.id, button);
    button.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus off it, keys stay the scene's
    button.addEventListener('click', () => on.select(tool.id));
  }

  const sep = document.createElement('span');
  sep.className = 'sep';
  host.append(sep);

  for (const knob of knobs) {
    const box = document.createElement('div');
    box.className = 'knob dial';
    box.innerHTML =
      `<button aria-label="${knob.name}"><span class="face"></span>${tip(knob.name, knob.key)}</button>` +
      `<div class="gauge"><div class="track"><span class="fill"></span><b></b></div></div>`;
    host.append(box);
    const button = box.querySelector('button')!;
    const face = box.querySelector<HTMLElement>('.face')!;
    const gauge = box.querySelector<HTMLElement>('.gauge')!;
    const track = box.querySelector<HTMLElement>('.track')!;
    const label = box.querySelector('b')!;

    let held = false;
    let pinned = false;
    let peeked = false; // shown from outside, while the value is being dragged on the scene
    let start = { x: 0, y: 0, t: 0, moved: false, wasPinned: false };

    const draw = () => {
      const t = knob.get();
      face.innerHTML = knob.face(t);
      track.style.setProperty('--t', String(t));
      label.textContent = String(Math.round(t * 100));
    };
    const show = () => {
      const open = held || pinned || peeked;
      gauge.classList.toggle('open', open);
      gauge.classList.toggle('pinned', pinned);
      button.classList.toggle('held', open);
    };
    const to = (v: number) => {
      knob.put(Math.min(1, Math.max(0, v)));
      draw();
    };
    draw();
    redraw.push(draw);
    peeks.set(knob.name, (open) => { peeked = open; show(); });

    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { button.setPointerCapture(e.pointerId); } catch { /* a made-up pointer in a test */ }
      start = { x: e.clientX, y: e.clientY, t: knob.get(), moved: false, wasPinned: pinned };
      held = true;
      show();
    });
    button.addEventListener('pointermove', (e) => {
      if (!held) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (start.moved) to(start.t + (dx - dy) / TRAVEL); // up or right raises
    });
    const up = () => {
      if (!held) return;
      held = false;
      pinned = !start.moved && !start.wasPinned; // a tap pins it, a tap again lets it go
      show();
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('wheel', (e) => {
      e.preventDefault();
      to(knob.get() - Math.sign(e.deltaY) * 0.02);
    }, { passive: false });

    // pinned open, the gauge takes the pointer: the value under it
    const at = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      to(1 - (e.clientY - r.top) / r.height);
    };
    track.addEventListener('pointerdown', (e) => {
      try { track.setPointerCapture(e.pointerId); } catch { /* a made-up pointer in a test */ }
      at(e);
    });
    track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) at(e); });
    window.addEventListener('pointerdown', (e) => {
      if (pinned && !box.contains(e.target as Node)) { pinned = false; show(); }
    });
    window.addEventListener('keydown', (e) => {
      if (pinned && e.key === 'Escape') { pinned = false; show(); }
    });
  }

  return {
    // show which tool is picked, and the knobs at its values
    select(id: number) {
      for (const [i, b] of buttons) b.classList.toggle('on', i === id);
      for (const draw of redraw) draw();
    },
    // the values changed from outside the bar (a drag on the scene)
    refresh() {
      for (const draw of redraw) draw();
    },
    // a knob's gauge held open from outside, while its value is dragged on the scene
    peek(name: string, open: boolean) {
      peeks.get(name)?.(open);
    },
  };
}
