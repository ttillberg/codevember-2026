// The controls on the picture: the time and its hold, the ways of reading the traffic, the brushes, and undo and redo.
// They are plain DOM over the canvas, so a press on them never reaches the ground.
import { useRef, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { Brush, Tool } from './Painter';
import { BridgeIcon, ClockIcon, ClockOffIcon, EraseIcon, RedoIcon, RoadIcon, SmearIcon, UndoIcon } from './Icons';

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
export function Overlays({ items }: { items: { id: string; label: string; keys?: string; icon: ReactNode; on: boolean; toggle: () => void }[] }) {
  return (
    <div className="pill">
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

/** What a button is, over it after a short hover: its name, and its key in a chip. As on day 07. */
const Tip = ({ tip, keys }: { tip: string; keys?: string }) => <span className="tip" aria-hidden>{tip}{keys && <kbd>{keys}</kbd>}</span>;

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
