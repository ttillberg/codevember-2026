// The controls on the picture: the time and its hold, the ways of reading the traffic, the brushes, and undo and redo.
// They are plain DOM over the canvas, so a press on them never reaches the ground.
import { useRef, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { Brush, Tool } from './Painter';
import { BridgeIcon, ClockIcon, EraseIcon, RedoIcon, RoadIcon, SmearIcon, UndoIcon } from './Icons';

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
        // any way the hand goes: to the right and up is later, to the left and down earlier
        const by = e.clientX - d.x - (e.clientY - d.y);
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

/** Top right, one bar: the clock, then the overlays on the picture, a button each that switches one on or off. */
export function Overlays({ lead, items }: { lead?: ReactNode; items: { id: string; label: string; keys?: string; icon: ReactNode; on: boolean; toggle: () => void }[] }) {
  return (
    <div className="pill">
      {lead}
      {items.map((o) => (
        <button key={o.id} className={o.on ? 'on' : ''} aria-label={o.label} title={o.keys ? `${o.label} (${o.keys})` : o.label} aria-pressed={o.on} onClick={o.toggle}>
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


/**
 * The brushes, all of them in sight: one press takes one. Along the bottom: in the middle on a desk, from the left on a phone.
 * None is lit while trace is on: then a press on the ground reads the traffic and paints nothing.
 */
export function Brushes({ tool, onPick }: { tool: Tool; onPick: (b: Brush) => void }) {
  return (
    <div className="pill brushes" role="toolbar" aria-label="Brushes">
      {BRUSHES.map(([b, label, Icon, keys]) => (
        <button key={b} className={tool === b ? 'on' : ''} aria-label={label} aria-pressed={tool === b} onClick={() => onPick(b)}>
          <Icon />
          <Tip tip={label} keys={keys ?? 'T'} />
        </button>
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
