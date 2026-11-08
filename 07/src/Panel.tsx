import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clearDrips } from './drips';
import { paint } from './Balloon';
import { QUALITY, quality, setQuality, type Quality } from './paint';
import { resetTool, save, tool, type Finish } from './tool';
import { downloadPng } from './snapshot';
import { DARK_ENABLED, setTheme, theme } from './theme';
import { hueStrip, setColour, shadeStrip, syncColour } from './color';

// The media, and the options each one answers to.
type Medium = 'glaze' | 'bristle' | 'spray' | 'pencil' | 'erase';
const MEDIA: Medium[] = ['glaze', 'bristle', 'spray', 'pencil', 'erase'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

// Every bar icon is drawn at the colour swatch's height, 24px, top and bottom on the same lines. Fit measures the
// drawing's real outline (sampled along each shape, so tilted ones fit tight, not by their tilted box) and frames it.
// Lines keep `line` px whatever the scale.
const H = 24;
function Fit({ children, line = 0, className }: { children: React.ReactNode; line?: number; className?: string }) {
  const g = useRef<SVGGElement>(null);
  const [box, setBox] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const root = g.current;
    if (!root) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const inv = root.getCTM()?.inverse();
    for (const el of root.querySelectorAll<SVGGeometryElement>('path, circle, rect, ellipse, polygon')) {
      if (el.closest('clipPath')) continue;
      const m = inv?.multiply(el.getCTM()!);
      const n = el.getTotalLength();
      for (let i = 0; i <= 120; i++) {
        let q = el.getPointAtLength((i / 120) * n);
        if (m) q = q.matrixTransform(m);
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }
    }
    if (!isFinite(x0)) return;
    const pad = (line / 2) * ((y1 - y0) / (H - line));
    setBox([x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2]);
  }, []); // once: the outlines are constants (a different icon remounts through its key); only clip rects move
  const [x, y, w, h] = box ?? [0, 0, 16, 16];
  return (
    <svg height={H} width={(H * w) / h} viewBox={`${x} ${y} ${w} ${h}`} className={`ft-fit ${className ?? ''}`}
      fill="none" stroke="currentColor" strokeWidth={line} strokeLinecap="round" strokeLinejoin="round">
      <g ref={g}>{children}</g>
    </svg>
  );
}

// The media as little pictures: a pointed paintbrush, a bristle brush, a spray can, a pencil with a big round point, an eraser.
// The paintbrush, the can, the pencil and the eraser are drawn upright and tilted into place.
const MEDIUM_ICON: Record<Medium, string> = {
  glaze: 'M7.3 7l.3-5.2a.4.4 0 0 1 .8 0L8.7 7M6.6 7h2.8v2H6.6zM6.6 9c0 2 .7 3.6 1.4 5 .7-1.4 1.4-3 1.4-5',
  bristle: 'M4 3h8v4H4zM5 7v5M7 7v6M9 7v6M11 7v5',
  spray: 'M6 6h4v7.5H6zM7 6V4.5h2V6M9 3h1.5M11.5 3.5l1-1M11.5 5h1.5',
  pencil: 'M6 2.5h4v7H6zM6 4.5h4M6 9.5l.9 2.1a1.2 1.2 0 0 0 2.2 0L10 9.5',
  erase: 'M4.5 5.5h7A1.5 1.5 0 0 1 13 7v2a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 9V7a1.5 1.5 0 0 1 1.5-1.5zM7.5 5.5v5',
};
const MEDIUM_TILT: Partial<Record<Medium, string>> = { glaze: 'rotate(45 8 8)', spray: 'rotate(-45 9.2 8.2)', pencil: 'rotate(45 8 8)', erase: 'rotate(-40 8 8)' };
const MediumIcon = ({ m }: { m: Medium }) => (
  <Fit key={m} line={1.5}><path d={MEDIUM_ICON[m]} transform={MEDIUM_TILT[m]} /></Fit>
);

type Num = 'size' | 'flow' | 'liquid' | 'watery';
const RANGE: Record<Num, { min: number; max: number }> = {
  size: { min: 0.01, max: 0.2 },
  flow: { min: 0, max: 1 },
  liquid: { min: 0, max: 1 },
  watery: { min: 0, max: 1 },
};
// What each medium answers to beyond size, flow and colour; it sits beside the medium in the bar.
const OPTIONS: Record<Medium, Num[]> = {
  glaze: ['watery'],
  bristle: ['liquid'],
  spray: ['liquid'],
  pencil: [],
  erase: [],
};

// Shortcuts: hold a key and its popover opens; move the mouse to set it, let go of the key to keep it.
// The pointer is tracked all the time so a key press knows where the mouse starts.
const mouse = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { capture: true });
function useHotkey(code: string | undefined, down: () => void, up: () => void) {
  const cb = useRef({ down, up });
  cb.current = { down, up };
  useEffect(() => {
    if (!code) return;
    const kd = (e: KeyboardEvent) => {
      if (e.code !== code || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      cb.current.down();
    };
    const ku = (e: KeyboardEvent) => { if (e.code === code) cb.current.up(); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [code]);
}

// An open popover closes on a press outside its box, or on escape.
function useDismiss(box: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) cb.current(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current(); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
}

// Opened by its key, a popover sits under the cursor: the point (ax, ay) inside it lands on the mouse, held PAD px
// inside the screen. It's placed absolutely in its knob (the bar is transformed, so fixed would be relative to it).
const PAD = 12;
type At = { left: number; top: number } | null;
function placeAt(pop: HTMLElement, host: HTMLElement, ax: number, ay: number): At {
  const w = pop.offsetWidth, h = pop.offsetHeight, r = host.getBoundingClientRect();
  const x = Math.min(innerWidth - w - PAD, Math.max(PAD, mouse.x - ax));
  const y = Math.min(innerHeight - h - PAD, Math.max(PAD, mouse.y - ay));
  return { left: x - r.left, top: y - r.top };
}
// Opened from its button, a popover is centred over it but slid sideways to stay PAD px inside the screen.
// The slide is worked out while it's closed, so it opens already in place (and grows from its button, see the CSS)
// instead of gliding in sideways; it isn't re-read while open, so nothing is measured during a drag.
function useClamp(pop: React.RefObject<HTMLElement | null>, host: React.RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const e = pop.current, h = host.current;
    if (open || !e || !h) return;
    const r = h.getBoundingClientRect(), w = e.offsetWidth, left = r.left + r.width / 2 - w / 2;
    const dx = Math.max(PAD - left, 0) + Math.min(innerWidth - PAD - (left + w), 0);
    e.style.setProperty('--dx', `${dx}px`);
  });
}
const atStyle = (at: At): React.CSSProperties | undefined =>
  at ? { left: at.left, top: at.top, bottom: 'auto', transform: 'none', transition: 'opacity 0.15s' } : undefined;

// A styled tooltip over a bar button: its name and its key. Shows after a short hover, never while its popover is up.
const Tip = ({ tip, hotkey }: { tip?: string; hotkey?: string }) =>
  tip ? <span className="ft-tip" aria-hidden>{tip}{hotkey && <kbd>{hotkey.slice(3)}</kbd>}</span> : null;

// A knob in the bar, like a volume control: hold the button and drag up or down, a tall gauge shows while you hold.
// It reads and writes a 0..1 value itself (get/put) so it redraws as you drag; the wheel over the button nudges it too.
const TRAVEL = 140; // px of drag for the whole range, the gauge's height
function Knob({ name, tip, get, put, face, track, hotkey }: {
  name: string; tip?: string; get: () => number; put: (t: number) => void; hotkey?: string;
  face: (t: number) => React.ReactNode; track: (t: number) => React.ReactNode;
}) {
  const [held, setHeld] = useState(false);
  // A click without a drag pins the gauge open: then drag on the gauge itself, the value under the pointer.
  // A press elsewhere, escape, or another click on the button closes it.
  const [pinned, setPinned] = useState(false);
  const [, bump] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const gauge = useRef<HTMLDivElement>(null);
  const trackEl = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<At>(null);
  const start = useRef({ x: 0, y: 0, t: 0, moved: false, wasPinned: false, key: false });
  // Let go anywhere ends the hold, even if the capture got lost on the way; a tap pins it.
  // Held by its key instead, the gauge opens under the cursor at the current level, the value follows the mouse on it,
  // and the key's release ends it.
  useEffect(() => {
    if (!held || start.current.key) return;
    const up = () => { setHeld(false); setPinned(!start.current.moved && !start.current.wasPinned); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [held]);
  useEffect(() => {
    if (!held || !start.current.key) return;
    const move = () => {
      const r = trackEl.current?.getBoundingClientRect();
      if (r) to(1 - (mouse.y - r.top) / r.height);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [held]);
  useHotkey(hotkey, () => {
    start.current = { ...start.current, key: true };
    if (gauge.current && box.current) setSpot(placeAt(gauge.current, box.current, gauge.current.offsetWidth / 2, 6 + (1 - get()) * TRAVEL));
    setPinned(false);
    setHeld(true);
  }, () => { if (start.current.key) { start.current.key = false; setHeld(false); } });
  useDismiss(box, pinned, () => setPinned(false));
  const t = get();
  const to = (v: number) => { put(Math.min(1, Math.max(0, v))); bump((n) => n + 1); };
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    to(1 - (e.clientY - r.top) / r.height);
  };
  const open = held || pinned;
  useClamp(gauge, box, open);
  return (
    <div className="ft-knob" ref={box}>
      <button aria-label={name} className={open ? 'on' : ''}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, y: e.clientY, t, moved: false, wasPinned: pinned, key: false };
          setSpot(null);
          setHeld(true);
        }}
        onPointerMove={(e) => {
          if (!held || start.current.key) return;
          const d = start.current.y - e.clientY + e.clientX - start.current.x; // up or right raises
          if (Math.abs(e.clientY - start.current.y) + Math.abs(e.clientX - start.current.x) > 4) start.current.moved = true;
          if (start.current.moved) to(start.current.t + d / TRAVEL);
        }}
        onWheel={(e) => to(t - Math.sign(e.deltaY) * 0.02)}>
        {face(t)}
        <Tip tip={tip} hotkey={hotkey} />
      </button>
      <div ref={gauge} className={`ft-gauge${open ? ' open' : ''}${pinned ? ' pinned' : ''}`} style={atStyle(spot)}>
        <div ref={trackEl} className="ft-gauge-track" style={{ '--t': t } as React.CSSProperties}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}>
          {track(t)}
        </div>
      </div>
    </div>
  );
}

// A volume ramp: a wedge from nothing to big, filled up to the size.
const RAMP = 'M1 22 L25 4 L25 22 Z';
const SizeRamp = ({ t }: { t: number }) => (
  // Outlined, so the empty part of the wedge still reads.
  <Fit className="ft-ramp" line={1.5}>
    <clipPath id="ft-ramp-fill"><rect x="0" y="0" width={1 + t * 24} height="26" /></clipPath>
    <path d={RAMP} className="ft-ramp-bg" />
    <path d={RAMP} clipPath="url(#ft-ramp-fill)" />
  </Fit>
);

// Flow: an opacity mark, a disc split on the diagonal. One half is solid; the other goes from the empty grey to
// solid as the flow rises, mixed as plain colour rather than drawn see-through.
const FlowDisc = ({ t }: { t: number }) => (
  <Fit className="ft-ramp">
    <path d="M4.5 21.5A12 12 0 0 1 21.5 4.5z" />
    <path d="M21.5 4.5A12 12 0 0 1 4.5 21.5z" style={{ fill: `color-mix(in srgb, currentColor ${Math.round(t * 100)}%, var(--empty))` }} />
  </Fit>
);
// Watery or liquid, the medium's own option: a drop filled up to the level, like the ramp.
const DROP = 'M13 2.5C17.2 8 19.5 11.6 19.5 15.5a6.5 6.5 0 0 1-13 0C6.5 11.6 8.8 8 13 2.5z';
const WetDrop = ({ t }: { t: number }) => (
  <Fit className="ft-ramp">
    <clipPath id="ft-drop-fill"><rect x="0" y={22 - t * 19.5} width="26" height="26" /></clipPath>
    <path d={DROP} className="ft-ramp-bg" />
    <path d={DROP} clipPath="url(#ft-drop-fill)" />
  </Fit>
);
// A knob on one of the tool's numbers, mapped through its range; the gauge fills up like a volume bar.
function RangeKnob({ k, tip, hotkey, face }: { k: Num; tip: string; hotkey: string; face: (t: number) => React.ReactNode }) {
  const { min, max } = RANGE[k];
  return (
    <Knob name={k} tip={tip} hotkey={hotkey} get={() => (tool[k] - min) / (max - min)} put={(v) => { tool[k] = min + v * (max - min); }}
      face={face} track={(t) => <><span className="ft-fill" /><b>{Math.round(t * 100)}</b></>} />
  );
}

// Colour: the hue round the wheel on one knob, its brightness, black through the pure hue to white, on the next.
function ColorKnob() {
  return (
    <Knob name="color" tip="Colour" hotkey="KeyC" get={() => { syncColour(); return tool.hue; }} put={(v) => setColour(v, tool.shade)}
      face={() => <i className="ft-swatch" style={{ background: tool.hex }} />}
      track={() => <><span className="ft-strip" style={{ background: hueStrip(tool.shade) }} /><span className="ft-mark" style={{ background: tool.hex }} /></>} />
  );
}
// A sun: a disc and eight rays.
const SUN_DISC = 'M17 13a4 4 0 1 1-8 0a4 4 0 1 1 8 0z';
const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  return `M${13 + c * 6.5} ${13 + s * 6.5}L${13 + c * 10} ${13 + s * 10}`;
}).join('');
function ShadeKnob() {
  return (
    <Knob name="brightness" tip="Brightness" hotkey="KeyL" get={() => { syncColour(); return tool.shade; }} put={(v) => setColour(tool.hue, v)}
      face={() => <Fit line={1.5}><path d={SUN_RAYS} /><path d={SUN_DISC} fill="currentColor" stroke="none" /></Fit>}
      track={() => <><span className="ft-strip" style={{ background: shadeStrip(tool.hue) }} /><span className="ft-mark" style={{ background: tool.hex }} /></>} />
  );
}

// A picker in the bar: only the current choice shows. Press it and the choices pop up above; drag up to one and let
// go to pick it, or tap and then click one. A press elsewhere closes it.
function Picker<T extends string>({ name, tip, items, cur, put, icon, solid, others, hotkey }: {
  name: string; tip?: string; items: T[]; cur: T; put: (v: T) => void; icon: (v: T) => React.ReactNode; hotkey?: string;
  others?: boolean; // the popover lists only the other choices, the current one is already on the button
  solid?: boolean; // picked shows as black, for icons; off for swatches that carry their own look (a ring instead)
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState<T | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const popEl = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<At>(null);
  const [flip, setFlip] = useState(false); // opened on the right half, the labels go on the left so they stay on screen
  const drag = useRef({ y: 0, moved: false, down: false, key: false });
  const shown = items.filter((v) => !others || v !== cur);
  // Held by its key, the popover opens under the cursor with the current choice on it (or, listing only the others,
  // just above it, so nothing is picked until you move up); the row under the mouse is picked when the key is let go.
  useHotkey(hotkey, () => {
    drag.current = { y: mouse.y, moved: true, down: true, key: true };
    const el = popEl.current;
    if (el && box.current) {
      const i = shown.indexOf(cur), h = el.offsetHeight;
      setAt(placeAt(el, box.current, el.offsetWidth / 2, i < 0 ? h + 16 : h - (6 + 23 + i * 48)));
    }
    setFlip(mouse.x > innerWidth / 2);
    setHot(null);
    setOpen(true);
  }, () => {
    if (!drag.current.key) return;
    drag.current.key = false; drag.current.down = false;
    if (hot) pick(hot); else setOpen(false);
  });
  // The choice in the row at this height, wherever the pointer is sideways; past the top it's the top one.
  // Back down under the popover (over the button) it's none, so letting go there changes nothing.
  const rowAt = (y: number) => {
    const rows = [...(box.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
    const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom));
    if (!rows.length || y > bottom + 6) return null;
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const r of rows) {
      const { top, height } = r.getBoundingClientRect();
      const d = Math.abs(top + height / 2 - y);
      if (d < bestD) { bestD = d; best = r; }
    }
    return (best?.dataset.item as T | undefined) ?? null;
  };
  const pick = (v: T) => { put(v); save(); setOpen(false); setHot(null); };
  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      if (!drag.current.down) return;
      if (Math.abs(e.clientY - drag.current.y) > 6) drag.current.moved = true;
      setHot(rowAt(e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (!drag.current.down || drag.current.key) return;
      drag.current.down = false;
      const v = rowAt(e.clientY);
      if (drag.current.moved) { if (v) pick(v); else setOpen(false); } // a drag picks where it ends; a tap leaves it open
      setHot(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [open]);
  useDismiss(box, open, () => setOpen(false));
  useClamp(popEl, box, open);
  return (
    <div className={`ft-knob${solid ? '' : ' swatches'}`} ref={box}>
      <button aria-label={`${name}: ${cur}`} className={open ? 'on' : ''}
        onPointerDown={(e) => {
          e.preventDefault();
          if (open) { setOpen(false); return; }
          drag.current = { y: e.clientY, moved: false, down: true, key: false };
          setAt(null);
          setFlip(false);
          setOpen(true);
        }}>
        {icon(cur)}
        <Tip tip={tip} hotkey={hotkey} />
      </button>
      <div ref={popEl} className={`ft-gauge ft-pick${open ? ' open' : ''}${flip ? ' flip' : ''}`} style={atStyle(at)}>
        {shown.map((v) => (
          <button key={v} data-item={v} aria-label={v}
            className={(hot ?? cur) === v ? 'on' : ''} onClick={() => pick(v)}>
            {icon(v)}
            <span>{v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A small icon button in the bar that opens a popover above it; a press elsewhere or escape closes it.
function Pop({ name, tip, icon, className, children }: {
  name: string; tip?: string; icon: React.ReactNode; className: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useDismiss(box, open, () => setOpen(false));
  useClamp(pop, box, open);
  return (
    <div className="ft-knob" ref={box}>
      <button aria-label={name} className={open ? 'on' : ''}
        onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}
        <Tip tip={tip} />
      </button>
      <div ref={pop} className={`ft-gauge ft-popover ${className}${open ? ' open' : ''}`}>{children}</div>
    </div>
  );
}

// A gear: eight teeth.
const GEAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 4.7 : 6.4, a0 = (i / 16) * Math.PI * 2 - 0.12, a1 = ((i + 1) / 16) * Math.PI * 2 - 0.12 - 0.12;
    pts.push(`${8 + r * Math.cos(a0)} ${8 + r * Math.sin(a0)}`, `${8 + r * Math.cos(a1)} ${8 + r * Math.sin(a1)}`);
  }
  return `M${pts.join(' L')} Z`;
})();
// A plain small icon, for the menu buttons.
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
// Solid, the hole punched through with evenodd.
const GearIcon = () => (
  <Fit><path d={`${GEAR} M10.2 8 A2.2 2.2 0 1 0 5.8 8 A2.2 2.2 0 1 0 10.2 8 Z`} fill="currentColor" fillRule="evenodd" stroke="none" /></Fit>
);
const HelpIcon = () => (
  <Fit line={1.5}><circle cx="8" cy="8" r="6" /><path d="M6.25 6.4a1.8 1.8 0 1 1 2.6 1.6c-.55.28-.85.65-.85 1.2v.3" /><circle cx="8" cy="11.2" r="0.5" fill="currentColor" stroke="none" /></Fit>
);

// A row in a popover menu: a label, and a little switch when it toggles.
const Row = ({ label, on, hint, act }: { label: string; on?: boolean; hint?: string; act: () => void }) => (
  <button className="ft-row" onClick={act}>
    <span>{label}</span>
    {hint && <kbd>{hint}</kbd>}
    {on !== undefined && <i className={`ft-switch${on ? ' on' : ''}`} />}
  </button>
);

// The finishes as little grey balls, in the icons' grey: soft for matte, a sharp highlight for gloss, a chrome horizon for metal.
const FinishBall = ({ f }: { f: Finish }) => <i className={`ft-ball ${f}`} />;

// The bar holding every control. It writes straight into `tool`; it re-renders after any click, input or key.
export function Panel() {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    // Space toggles auto draw; delete (or backspace) clears the balloon.
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); tool.auto = !tool.auto; again(); }
      if ((e.code === 'Delete' || e.code === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); paint.clear(); clearDrips();
      }
    };
    window.addEventListener('keydown', key);
    const events = ['click', 'input', 'keyup'];
    events.forEach((ev) => window.addEventListener(ev, again));
    return () => { events.forEach((ev) => window.removeEventListener(ev, again)); window.removeEventListener('keydown', key); };
  }, []);
  // Buttons give up focus after a click so the space bar stays the auto toggle.
  const set = (fn: () => void) => { fn(); (document.activeElement as HTMLElement | null)?.blur?.(); };

  return (
    <>
    {/* Every control, in a frosted bar under the balloon. */}
    <div className="ft-media">
      <Picker name="medium" tip="Brush" items={MEDIA} cur={tool.brush as Medium} put={(m) => { tool.brush = m; }} icon={(m) => <MediumIcon m={m} />} solid others hotkey="KeyB" />
      {OPTIONS[tool.brush as Medium].map((k) => (
        <RangeKnob key={k} k={k} tip={k === 'watery' ? 'Watery' : 'Liquid'} hotkey="KeyW" face={(t) => <WetDrop t={t} />} />
      ))}
      <span className="ft-sep" />
      <RangeKnob k="size" tip="Size" hotkey="KeyS" face={(t) => <SizeRamp t={t} />} />
      <RangeKnob k="flow" tip="Flow" hotkey="KeyF" face={(t) => <FlowDisc t={t} />} />
      <ColorKnob />
      <ShadeKnob />
      <Picker name="paint" tip="Material" items={FINISHES} cur={tool.finish} put={(f) => { tool.finish = f; }} icon={(f) => <FinishBall f={f} />} hotkey="KeyM" />
      <span className="ft-sep" />
      <Pop name="settings" tip="Settings" icon={<GearIcon />} className="ft-menu">
        <Row label="Auto draw" hint="Space" on={tool.auto} act={() => set(() => { tool.auto = !tool.auto; })} />
        <Row label="Inertia" on={tool.inertia} act={() => set(() => { tool.inertia = !tool.inertia; })} />
        {DARK_ENABLED && <Row label="Dark mode" on={theme === 'dark'} act={() => set(() => setTheme(theme === 'dark' ? 'light' : 'dark'))} />}
        {/* Picking a size reloads: the targets and shaders are built on it. */}
        <label className="ft-row ft-select">
          <span>Texture</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            {(Object.keys(QUALITY) as Quality[]).map((q) => (
              <option key={q} value={q}>{({ low: 'LOW', medium: 'MED', high: 'HIGH' } as const)[q]}</option>
            ))}
          </select>
        </label>
        <hr />
        <div className="ft-actions">
          <button onClick={() => set(() => { paint.clear(); clearDrips(); })}>
            <Icon><circle cx="8" cy="8" r="5.5" /><path d="M4.1 11.9l7.8-7.8" /></Icon>Clear<kbd>Del</kbd>
          </button>
          <button onClick={() => set(resetTool)}>
            <Icon><path d="M3 3v3.5h3.5" /><path d="M3.4 6.2A5.3 5.3 0 1 1 3.3 10" /></Icon>Reset tools
          </button>
          <button onClick={() => set(downloadPng)}>
            <Icon><path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M3 13.5h10" /></Icon>Download PNG
          </button>
        </div>
      </Pop>
    </div>
    {/* Help sits on its own in the top right corner, out of the bar's way. */}
    <div className="ft-media ft-corner">
      <Pop name="help" tip="Help" icon={<HelpIcon />} className="ft-menu ft-help">
        <p><b>Click + drag</b> paint and turn</p>
        <p><b>Cmd + move</b> or <b>two fingers</b> turn without painting</p>
        <p><b>Space</b> auto draw</p>
        <p><b>Del</b> clear the balloon</p>
        <p><b>Shift + 0–9</b> save a preset, <b>0–9</b> recall it</p>
        <p><b>Hold B M S F C L W</b> brush, material, size, flow, colour, light, water: move the mouse, let go</p>
      </Pop>
    </div>
    </>
  );
}
