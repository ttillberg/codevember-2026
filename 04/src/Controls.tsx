// The controls on the picture: the time and its hold, the ways of reading the traffic, the brushes, and undo and redo.
// They are plain DOM over the canvas, so a press on them never reaches the ground.
import { Fragment, useRef, type MutableRefObject, type ReactNode, type RefObject, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Brush, Tool } from './Painter';
import { BridgeIcon, ClockIcon, EraseIcon, RedoIcon, RoadIcon, SmearIcon, UndoIcon, EyeIcon, GrowIcon, ShrinkIcon } from './Icons';

/** How far a drag on the time has to go for an hour: px per hour. And how far before it is a drag and not a tap. */
const PX_PER_HOUR = 40, TAP = 5;

/** Hours to HH:MM, 24 h, zero padded. */
export const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const wrap = (h: number) => ((h % 24) + 24) % 24;

/** What a button is, over it after a short hover: its name, and its key in a chip. As on day 07. */
const Tip = ({ tip, keys }: { tip: string; keys?: string }) => <span className="tip" aria-hidden>{tip}{keys && <kbd>{keys}</kbd>}</span>;

/** Turn the hands of the clock to this hour: written straight onto the button, so the running time does not re-render the page. */
export function showTime(el: HTMLElement | null, h: number) {
  if (!el) return;
  el.style.setProperty('--hour', `${((h % 12) / 12) * 360}deg`);
  el.style.setProperty('--minute', `${(h % 1) * 360}deg`);
}

/**
 * The time of day: a clock whose hands show it. A tap holds the time or lets it run; a drag winds it, forwards to the
 * right or up, back to the left or down. `readout` is the button the hands are turned on (Sun in App.tsx).
 */
export function TimeControl({ now, readout, hold, onHold, onSet }: {
  /** the hour as the sky has it now, read at the start of a drag */
  now: MutableRefObject<number>;
  readout: RefObject<HTMLButtonElement | null>;
  hold: boolean;
  onHold: () => void;
  onSet: (h: number) => void;
}) {
  const drag = useRef<{ x: number; y: number; h: number; moved: boolean } | null>(null);
  const label = hold ? 'Run time' : 'Hold time';
  return (
    <button
      ref={readout} className={`clock${hold ? ' on' : ''}`} aria-label={`${label}, drag to change the time`} aria-pressed={hold}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, h: now.current, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // any way the hand goes: to the right and down is later, to the left and up earlier
        const by = e.clientX - d.x + (e.clientY - d.y);
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP) return;
        d.moved = true;
        onSet(wrap(d.h + by / PX_PER_HOUR));
      }}
      onPointerUp={() => {
        // a press that went nowhere is a tap
        if (drag.current && !drag.current.moved) onHold();
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
      // the keyboard has no pointer: Enter and space come as a click with no press before it
      onClick={(e) => { if (e.detail === 0) onHold(); }}
    >
      <ClockIcon />
      <Tip tip={label} keys="drag" />
    </button>
  );
}

/** What is shown on the picture: an eye that opens a short list, each line a thing to show or not. */
/** One thing in the eye's list with more than two ways to be: its name, the ways, the one it is, and how to set another. */
export interface Choice { id: string; label: string; options: readonly (readonly [string, string])[]; value: string; set: (v: string) => void }

export function ViewMenu({ items, choices = [], onReset }: { items: { id: string; label: string; on: boolean; toggle: () => void }[]; choices?: Choice[]; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="view" ref={box}>
      <button className={open ? 'on' : ''} aria-label="View" title="View" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <EyeIcon />
      </button>
      {open && (
        <div className="menu" role="group" aria-label="View">
          {items.map((o) => (
            <label key={o.id}>
              <input type="checkbox" checked={o.on} onChange={o.toggle} />
              <span>{o.label}</span>
            </label>
          ))}
          {choices.map((c) => (
            <div key={c.id} className="choice" role="radiogroup" aria-label={c.label}>
              <span>{c.label}</span>
              <div>
                {c.options.map(([v, name]) => (
                  <button key={v} role="radio" aria-checked={c.value === v} className={c.value === v ? 'on' : ''} onClick={() => c.set(v)}>{name}</button>
                ))}
              </div>
            </div>
          ))}
          {onReset && <button className="reset" onClick={onReset}>Reset to defaults</button>}
        </div>
      )}
    </div>
  );
}

/** Top right, one bar: the clock, then the overlays on the picture, a button each that switches one on or off. */
export function Overlays({ lead, tail, items }: { lead?: ReactNode; tail?: ReactNode; items: { id: string; label: string; keys?: string; icon: ReactNode; on: boolean; toggle: () => void }[] }) {
  return (
    <div className="pill">
      {lead}
      {items.map((o) => (
        <button key={o.id} className={o.on ? 'on' : ''} aria-label={o.label} title={o.keys ? `${o.label} (${o.keys})` : o.label} aria-pressed={o.on} onClick={o.toggle}>
          {o.icon}
        </button>
      ))}
      {tail}
    </div>
  );
}

/** Each brush, its name, its icon, and how else to reach it than through the bar. */
const BRUSHES: [Brush, string, () => ReactNode, string?][] = [
  ['road', 'Road', RoadIcon, 'R'],
  ['bridge', 'Bridge', BridgeIcon, 'B'],
  ['smear', 'Smear', SmearIcon, '⌥ drag'],
  ['erase', 'Erase', EraseIcon],
];


/**
 * The brushes, all of them in sight: one press takes one. Along the bottom: in the middle on a desk, from the left on a phone.
 * None is lit while trace is on: then a press on the ground reads the traffic and paints nothing.
 */
/**
 * The size brush is two: one makes the roads it is drawn over a size bigger, the other a size smaller. A press takes it
 * up and opens the two over it; a press on one of them picks it. The button shows the one that is held.
 */
function SizeBrush({ on, grow, onPick, onGrow }: { on: boolean; grow: boolean; onPick: () => void; onGrow: (bigger: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc); };
  }, [open]);
  const name = grow ? 'Bigger' : 'Smaller';
  return (
    <div className="pick" ref={box}>
      <button className={on ? 'on' : ''} aria-label={`Size: ${name}`} aria-pressed={on} aria-haspopup="true" aria-expanded={open} onClick={() => { onPick(); setOpen((v) => !v); }}>
        {grow ? <GrowIcon /> : <ShrinkIcon />}
        {!open && <Tip tip={name} keys="T" />}
      </button>
      {open && (
        <div className="pill choices" role="group" aria-label="Size">
          <button className={grow ? 'on' : ''} aria-label="Bigger" aria-pressed={grow} onClick={() => { onGrow(true); setOpen(false); }}><GrowIcon /><Tip tip="Bigger" /></button>
          <button className={grow ? '' : 'on'} aria-label="Smaller" aria-pressed={!grow} onClick={() => { onGrow(false); setOpen(false); }}><ShrinkIcon /><Tip tip="Smaller" /></button>
        </div>
      )}
    </div>
  );
}

/** How far the smear can reach, and how wide the eraser can rub, metres; and how far a drag on a brush goes for the whole of a range, px. */
export const SMEAR_MIN = 25, SMEAR_MAX = 140, ERASE_MIN = 3, ERASE_MAX = 40;
const TRAVEL = 140;

/**
 * A brush that is a knob, as the brushes of day 07 are: a press takes it up, and a drag on it, up or to the right,
 * sets its size, with a gauge over it while it is held. A tap pins the gauge open, to drag on the gauge itself;
 * a press elsewhere or escape closes it.
 */
function KnobBrush({ name, hotkey, icon, min, max, on, reach, onPick, onSet }: { name: string; hotkey: string; icon: ReactNode; min: number; max: number; on: boolean; reach: number; onPick: () => void; onSet: (reach: number) => void }) {
  const [held, setHeld] = useState(false);
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef({ x: 0, y: 0, t: 0, moved: false, wasPinned: false });
  const t = (reach - min) / (max - min);
  const to = (v: number) => onSet(Math.round(min + Math.min(1, Math.max(0, v)) * (max - min)));
  // let go anywhere ends the hold, even if the capture got lost on the way; a tap pins the gauge
  useEffect(() => {
    if (!held) return;
    const up = () => { setHeld(false); setPinned(!start.current.moved && !start.current.wasPinned); };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  }, [held]);
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setPinned(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(false); };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc); };
  }, [pinned]);
  const at = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    to(1 - (e.clientY - r.top) / r.height);
  };
  const open = held || pinned;
  return (
    <div className="pick" ref={box}>
      <button
        className={on ? 'on' : ''} aria-label={`${name}, ${reach} m`} aria-pressed={on} style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, y: e.clientY, t, moved: false, wasPinned: pinned };
          onPick();
          setHeld(true);
        }}
        onPointerMove={(e) => {
          if (!held) return;
          const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) start.current.moved = true;
          // up or to the right is wider
          if (start.current.moved) to(start.current.t + (dx - dy) / TRAVEL);
        }}
        onWheel={(e) => to(t - Math.sign(e.deltaY) * 0.03)}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') to(t + 0.05); if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') to(t - 0.05); }}
        // the keyboard has no pointer: Enter and space come as a click with no press before it
        onClick={(e) => { if (e.detail === 0) { onPick(); setPinned((v) => !v); } }}
      >
        {icon}
        {!open && <Tip tip={name} keys={hotkey} />}
      </button>
      {open && (
        <div className={`gauge${pinned ? ' pinned' : ''}`}>
          <div
            className="track" style={{ '--t': t } as CSSProperties}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
            onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}
          >
            <span className="fill" />
            <b>{reach}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function Brushes({ tool, sized, grow, reach, rub, onPick, onGrow, onSmear, onRub }: { tool: Tool; sized?: boolean; grow: boolean; reach: number; rub: number; onPick: (b: Brush) => void; onGrow: (bigger: boolean) => void; onSmear: (reach: number) => void; onRub: (reach: number) => void }) {
  return (
    <div className="pill brushes" role="toolbar" aria-label="Brushes">
      {BRUSHES.map(([b, label, Icon, keys]) => (
        <Fragment key={b}>
          {sized && b === 'erase' && <SizeBrush on={tool === 'size'} grow={grow} onPick={() => onPick('size')} onGrow={onGrow} />}
          {b === 'smear' ? <KnobBrush name="Smear" hotkey="S" icon={<SmearIcon />} min={SMEAR_MIN} max={SMEAR_MAX} on={tool === b} reach={reach} onPick={() => onPick(b)} onSet={onSmear} />
            : b === 'erase' ? <KnobBrush name="Erase" hotkey="E" icon={<EraseIcon />} min={ERASE_MIN} max={ERASE_MAX} on={tool === b} reach={rub} onPick={() => onPick(b)} onSet={onRub} /> : (
            <button className={tool === b ? 'on' : ''} aria-label={label} aria-pressed={tool === b} onClick={() => onPick(b)}>
              <Icon />
              <Tip tip={label} keys={keys ?? 'T'} />
            </button>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Undo and redo, bottom right, out of the way of the brushes. */
export function History({ canUndo, canRedo, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  return (
    <div className="pill history">
      <button aria-label="Undo" disabled={!canUndo} onClick={onUndo}><UndoIcon /><Tip tip="Undo" keys="⌘Z" /></button>
      <button aria-label="Redo" disabled={!canRedo} onClick={onRedo}><RedoIcon /><Tip tip="Redo" keys="⇧⌘Z" /></button>
    </div>
  );
}
