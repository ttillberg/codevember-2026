// The tool bar, after day 07's: icons in a frosted pill under the scene.
//
//   RAIN  WIND  HOSE  SCRATCH  DYNAMITE  |  SIZE  FORCE
//
// A tap on a tool picks it. Size and force are knobs, the same two for every tool, each showing
// and setting the value of the tool in hand: hold the knob and drag, up or right, and a tall
// gauge shows while you hold. A tap pins the gauge open, to drag on it directly; a press
// elsewhere closes it. The wheel over a knob nudges it. Both can also be dragged on the scene
// itself (main.ts): cmd for the size, shift and cmd for the force.

const TRAVEL = 140; // px of drag for the whole range, the gauge's height

type BarTool = { id: number; name: string; key: string; icon: string };
type BarKnob = {
  name: string;
  key?: string; // how to set it from the scene, shown in its tip
  face(t: number): string; // the button's picture at this value, an svg
  get(): number; // 0..1, for the tool in hand
  put(t: number): void;
};

// 24 px line icons (Feather's cloud-rain, droplet and wind; the scratch is a garden trowel,
// digging down to the left; the dynamite is a taped stick with a lit fuse and spark).
export const ICONS = {
  rain: 'M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  water: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  wind: 'M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2',
  scratch:
    'M14.55 6.91L17.94 3.51C18.64 2.81 19.78 2.81 20.49 3.51C21.19 4.22 21.19 5.36 20.49 6.06L17.09 9.45Z' +
    'M15.82 8.18L12.85 11.15' +
    'M9.03 7.33L16.67 14.97L14.12 17.52C11.15 20.49 7.33 20.91 3.51 20.49C3.09 16.67 3.51 12.85 6.48 9.88Z' +
    'M10.64 13.36L7.42 16.58',
  dynamite:
    'M11.4 7.8L16.2 12.6L8.2 20.6C7.6 21.2 6.5 21.2 5.9 20.6L3.4 18.1C2.8 17.5 2.8 16.4 3.4 15.8Z' +
    'M9.0 10.2L13.8 15.0' +
    'M6.1 13.1L10.9 17.9' +
    'M13.8 10.2C15.3 8.7 15.1 6.7 16.9 5.8' +
    'M19.2 2.2V4.0M19.2 6.8V8.6M16.0 5.4H17.8M20.6 5.4H22.4',
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

export function buildBar(host: HTMLElement, tools: BarTool[], knobs: BarKnob[], on: { select(id: number): void; elapsed(): number; gold(): number }) {
  const buttons = new Map<number, HTMLButtonElement>();
  const boxes = new Map<number, HTMLElement>();
  const redraw: (() => void)[] = [];
  const peeks = new Map<string, (open: boolean) => void>();

  for (const tool of tools) {
    const box = document.createElement('div');
    box.className = 'knob';
    box.innerHTML = `<button aria-label="${tool.name}">${svg(tool.icon)}${tip(tool.name, tool.key)}</button>`;
    host.append(box);
    const button = box.querySelector('button')!;
    buttons.set(tool.id, button);
    boxes.set(tool.id, box);
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

  // Gold that has been picked up lies in a heap on the bar's shoulder. It is drawn the way a
  // heap comes about: nuggets dropped one by one on the middle, each rolling down to where it lies.
  // Clicking the heap opens a DM to @theo_t on X to claim a gift.
  const DM_ID = '21615587'; // @theo_t
  const formatTime = (seconds: number) => {
    const s = Math.max(1, Math.round(seconds));
    if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
    if (s < 3600) {
      const m = Math.floor(s / 60);
      return `${s % 60 ? 'over ' : ''}${m} ${m === 1 ? 'minute' : 'minutes'}`;
    }
    const h = Math.floor(s / 3600);
    return `${s % 3600 ? 'over ' : ''}${h} ${h === 1 ? 'hour' : 'hours'}`;
  };
  const heap = document.createElement('a');
  heap.className = 'heap';
  heap.target = '_blank';
  heap.rel = 'noopener noreferrer';
  heap.setAttribute('aria-label', 'Claim gift via DM to @theo_t');
  heap.setAttribute('aria-hidden', 'true');
  heap.tabIndex = -1;
  const updateHref = () => {
    const g = on.gold();
    const text = `I found ${g} ${g === 1 ? 'voxel' : 'voxels'} gold after digging pixels for ${formatTime(on.elapsed())} (screenshot attached)`;
    heap.href = `https://x.com/messages/compose?recipient_id=${DM_ID}&text=${encodeURIComponent(text)}`;
  };
  heap.addEventListener('pointerdown', (e) => { e.stopPropagation(); updateHref(); });
  heap.addEventListener('pointerenter', updateHref);
  heap.addEventListener('focus', updateHref);
  host.append(heap);
  const COLS = 13;
  const ROWS = 9;
  const NUGGET = 5; // px
  const drawHeap = (n: number) => {
    const high: number[] = new Array(COLS).fill(0);
    let nuggets = '';
    for (let i = 0; i < n; i++) {
      let c = (COLS >> 1) + ((i * 7) % 3) - 1;
      for (;;) {
        const l = c > 0 ? high[c - 1] : 99;
        const r = c < COLS - 1 ? high[c + 1] : 99;
        if (Math.min(l, r) >= high[c]) break;
        c += l < r || (l === r && i % 2 === 0) ? -1 : 1;
      }
      const y = ROWS - 1 - Math.min(high[c]++, ROWS - 1);
      nuggets += `<rect x="${c * NUGGET}" y="${y * NUGGET}" width="${NUGGET}" height="${NUGGET}" fill="${['#eeb02a', '#d99a1c', '#f6cf5a'][(i * 5) % 3]}"/>`;
    }
    const peak = Math.max(1, ...high);
    const h = peak * NUGGET;
    const y0 = (ROWS - peak) * NUGGET;
    updateHref();
    heap.innerHTML =
      `<svg width="${COLS * NUGGET}" height="${h}" viewBox="0 ${y0} ${COLS * NUGGET} ${h}" shape-rendering="crispEdges">${nuggets}</svg>` +
      tip('Claim gift', '@theo_t');
    heap.classList.toggle('some', n > 0);
    heap.setAttribute('aria-hidden', String(n === 0));
    heap.tabIndex = n > 0 ? 0 : -1;
  };

  // the values changed from outside the bar (a drag on the scene, another tool)
  const refresh = () => {
    for (const draw of redraw) draw();
  };
  return {
    // show which tool is picked, and the knobs at its values
    select(id: number) {
      for (const [i, b] of buttons) b.classList.toggle('on', i === id);
      refresh();
    },
    // show or hide a collectible tool in the bar
    reveal(id: number, shown: boolean) {
      const box = boxes.get(id);
      if (!box) return;
      box.classList.toggle('locked', !shown);
      box.setAttribute('aria-hidden', String(!shown));
      const b = buttons.get(id);
      if (b) b.tabIndex = shown ? 0 : -1;
    },
    refresh,
    heap: drawHeap,
    // a knob's gauge held open from outside, while its value is dragged on the scene
    peek(name: string, open: boolean) {
      peeks.get(name)?.(open);
    },
  };
}
