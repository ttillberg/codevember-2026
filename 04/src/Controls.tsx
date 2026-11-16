// The controls on the picture: the time and its hold, the overlays, and the bar of tools with undo and redo.
// They are plain DOM over the canvas, so a press on them never reaches the ground.
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { Brush, Tool } from './Painter';
import { BridgeIcon, ClockIcon, ClockOffIcon, EraseIcon, RedoIcon, RoadIcon, SmearIcon, TraceIcon, UndoIcon } from './Icons';

/** How far a drag on the time has to go for an hour: px per hour. */
const PX_PER_HOUR = 40;

/** Hours to HH:MM, 24 h, zero padded. */
export const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const wrap = (h: number) => ((h % 24) + 24) % 24;

/**
 * The time of day, top right: a clock that holds or runs, and the time itself. Dragging it sideways sets the hour.
 * The text is written into the DOM by `readout` (Sun in App.tsx), so the running time does not re-render the page.
 */
export function TimeControl({ now, readout, first, hold, onHold, onSet }: {
  /** the hour as the sky has it now, read at the start of a drag */
  now: MutableRefObject<number>;
  readout: RefObject<HTMLSpanElement | null>;
  /** the text it starts with; written once, after that `readout` owns it */
  first: string;
  hold: boolean;
  onHold: () => void;
  onSet: (h: number) => void;
}) {
  const drag = useRef<{ x: number; h: number } | null>(null);
  return (
    <div className="pill">
      <button className={hold ? 'on' : ''} aria-label={hold ? 'Run time' : 'Hold time'} title={hold ? 'Run time' : 'Hold time'} onClick={onHold}>
        {hold ? <ClockOffIcon /> : <ClockIcon />}
      </button>
      <div
        className="time" aria-label="Time of day, drag to change" title="Drag to change the time"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, h: now.current };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          onSet(wrap(d.h + (e.clientX - d.x) / PX_PER_HOUR));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <span ref={readout}>{first}</span>
      </div>
    </div>
  );
}

/** The overlays on the picture: a button each that switches one on or off. A second one is one more entry here. */
export function Overlays({ items }: { items: { id: string; label: string; icon: ReactNode; on: boolean; toggle: () => void }[] }) {
  return (
    <div className="pill">
      {items.map((o) => (
        <button key={o.id} className={o.on ? 'on' : ''} aria-label={o.label} title={o.label} aria-pressed={o.on} onClick={o.toggle}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

/** Each brush, its name, its icon, and how else to reach it than through the bar. */
const BRUSHES: [Brush, string, () => ReactNode, string?][] = [
  ['road', 'Road', RoadIcon],
  ['bridge', 'Bridge', BridgeIcon, '⌘ drag'],
  ['smear', 'Smear', SmearIcon, '⇧ drag'],
  ['erase', 'Erase', EraseIcon],
];

/** What a button is, over it after a short hover: its name, and its key in a chip. As on day 07. */
const Tip = ({ tip, keys }: { tip: string; keys?: string }) => <span className="tip" aria-hidden>{tip}{keys && <kbd>{keys}</kbd>}</span>;

/**
 * The bar at the bottom: the brush, trace beside it, then undo and redo. Icons only.
 * The brush works as the pickers on day 07 do: the button shows the brush in hand; press it and the others stand up above it;
 * drag up to one and let go to take it, or tap and then tap one. Their names come up beside them under the pointer.
 * Trace is a way of reading the traffic, not a brush: on, it is the tool; off, the brush comes back.
 */
export function Bar({ tool, brush, onTool, onBrush, canUndo, canRedo, onUndo, onRedo }: {
  tool: Tool; brush: Brush;
  onTool: (t: Tool) => void; onBrush: (b: Brush) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState<Brush | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef({ y: 0, moved: false, down: false });
  const pick = (b: Brush) => { onBrush(b); onTool(b); setOpen(false); setHot(null); };
  useEffect(() => {
    // what trace has to say stands where the brushes stand up: it steps aside while they do
    document.documentElement.classList.toggle('picking', open);
    if (!open) return;
    /** the brush whose button is at this height, whatever the pointer does sideways; under the lowest of them, none */
    const at = (y: number): Brush | null => {
      const rows = [...(box.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
      if (!rows.length || y > Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)) + 6) return null;
      let best: HTMLElement | null = null, bd = Infinity;
      for (const r of rows) {
        const { top, height } = r.getBoundingClientRect(), d = Math.abs(top + height / 2 - y);
        if (d < bd) { bd = d; best = r; }
      }
      return (best?.dataset.item as Brush | undefined) ?? null;
    };
    const move = (e: PointerEvent) => {
      if (!drag.current.down) return;
      if (Math.abs(e.clientY - drag.current.y) > 6) drag.current.moved = true;
      setHot(at(e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (!drag.current.down) return;
      drag.current.down = false;
      // a drag takes the one it ends on; a tap leaves them standing
      if (drag.current.moved) { const b = at(e.clientY); if (b) pick(b); else setOpen(false); }
      setHot(null);
    };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointerdown', away);
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      removeEventListener('pointerdown', away); removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const current = BRUSHES.find(([b]) => b === brush)!;
  const painting = tool !== 'trace';
  return (
    <div className="pill bar">
      <div className="knob" ref={box}>
        <button
          className={painting ? 'on' : ''} aria-label={`Brush: ${current[1]}`} aria-haspopup="menu" aria-expanded={open}
          onPointerDown={(e) => {
            e.preventDefault();
            if (open) return setOpen(false);
            // from trace, the first press only takes the brush back up
            if (!painting) return onTool(brush);
            drag.current = { y: e.clientY, moved: false, down: true };
            setOpen(true);
          }}
        >
          {current[2]()}
          {!open && <Tip tip={current[1]} keys="T" />}
        </button>
        <div className={`picks${open ? ' open' : ''}`} role="menu">
          {BRUSHES.filter(([b]) => b !== brush).map(([b, label, Icon, keys]) => (
            <button key={b} data-item={b} role="menuitem" aria-label={label} className={hot === b ? 'on' : ''} onClick={() => pick(b)}>
              <Icon />
              <span>{label}{keys && <kbd>{keys}</kbd>}</span>
            </button>
          ))}
        </div>
      </div>
      <button className={painting ? '' : 'on'} aria-label="Trace" aria-pressed={!painting} onClick={() => onTool(painting ? 'trace' : brush)}>
        <TraceIcon />
        <Tip tip="Trace" keys="R" />
      </button>
      <span className="sep" />
      <button aria-label="Undo" disabled={!canUndo} onClick={onUndo}><UndoIcon /><Tip tip="Undo" keys="⌘Z" /></button>
      <button aria-label="Redo" disabled={!canRedo} onClick={onRedo}><RedoIcon /><Tip tip="Redo" keys="⇧⌘Z" /></button>
    </div>
  );
}
