import { useEffect, useRef, useState } from 'react';
import { clearDrips } from './drips';
import { paint } from './Balloon';
import type { Brush } from './paint';
import { resetTool, tool, type Finish } from './tool';

// The media, and the options each one answers to.
type Medium = 'glaze' | 'bristle' | 'spray' | 'flat' | 'scrape';
const MEDIA: Medium[] = ['glaze', 'bristle', 'spray', 'flat', 'scrape'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

// The media as little pictures: a drop, a bristle brush, a spray can, a flat swatch, a blade.
const MEDIUM_ICON: Record<Medium, string> = {
  glaze: 'M8 2.5c2.5 3.5 4 5.5 4 7.5a4 4 0 0 1-8 0c0-2 1.5-4 4-7.5z',
  bristle: 'M4 3h8v4H4zM5 7v5M7 7v6M9 7v6M11 7v5',
  spray: 'M6 6h4v7.5H6zM7 6V4.5h2V6M9 3h1.5M11.5 3.5l1-1M11.5 5h1.5',
  flat: 'M3 4h10v8H3z',
  scrape: 'M3 11l7-7 3 3-7 7H3zM9 5l3 3',
};
const MediumIcon = ({ m }: { m: Medium }) => (
  <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    <path d={MEDIUM_ICON[m]} />
  </svg>
);

type Num = 'size' | 'flow' | 'liquid' | 'watery';
const RANGE: Record<Num, { min: number; max: number; step: number }> = {
  size: { min: 0.01, max: 0.2, step: 0.005 },
  flow: { min: 0, max: 1, step: 0.01 },
  liquid: { min: 0, max: 1, step: 0.01 },
  watery: { min: 0, max: 1, step: 0.01 },
};
const OPTIONS: Record<Medium, Num[]> = {
  glaze: ['flow', 'watery'],
  bristle: ['flow', 'liquid'],
  spray: ['flow', 'liquid'],
  flat: ['flow'],
  scrape: ['flow'],
};

// A knob in the bar, like a volume control: hold the button and drag up or down, a tall gauge shows while you hold.
// It works on a 0..1 value; the wheel over the button nudges it too.
const TRAVEL = 140; // px of drag for the whole range, the gauge's height
function Knob({ name, t, put, face, track }: {
  name: string; t: number; put: (t: number) => void; face: React.ReactNode; track: React.ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const [, bump] = useState(0);
  const start = useRef({ y: 0, t: 0 });
  // Let go anywhere closes it, even if the capture got lost on the way.
  useEffect(() => {
    if (!held) return;
    const up = () => setHeld(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [held]);
  const to = (v: number) => { put(Math.min(1, Math.max(0, v))); bump((n) => n + 1); };
  return (
    <div className="ft-knob">
      <button aria-label={name} title={`${name} (hold and drag)`} className={held ? 'on' : ''}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, t }; setHeld(true); }}
        onPointerMove={(e) => { if (held) to(start.current.t + (start.current.y - e.clientY) / TRAVEL); }}
        onWheel={(e) => to(t - Math.sign(e.deltaY) * 0.02)}>
        {face}
      </button>
      <div className={`ft-gauge${held ? ' open' : ''}`}>
        <div className="ft-gauge-track" style={{ '--t': t } as React.CSSProperties}>{track}</div>
      </div>
    </div>
  );
}

// Size: a dot that grows with the brush, the gauge fills up like a volume bar.
function SizeKnob() {
  const { min, max } = RANGE.size;
  const t = (tool.size - min) / (max - min);
  return (
    <Knob name="size" t={t} put={(v) => { tool.size = min + v * (max - min); }}
      face={<i className="ft-dot" style={{ width: 6 + t * 20, height: 6 + t * 20 }} />}
      track={<><span className="ft-fill" /><b>{Math.round(t * 100)}</b></>} />
  );
}

// Colour: one strip, black at the bottom, through every hue, to white at the top.
const HUES = ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'];
const STOPS: [number, number[]][] = [
  [0, [0, 0, 0]],
  ...HUES.map((h, i): [number, number[]] => [0.12 + (i / 6) * 0.76, [...h.slice(1)].map((c) => (c === 'f' ? 255 : 0))]),
  [1, [255, 255, 255]],
];
const STRIP = `linear-gradient(to top, ${STOPS.map(([p, c]) => `rgb(${c}) ${p * 100}%`).join(', ')})`;
function stripAt(t: number) {
  const i = Math.max(1, STOPS.findIndex(([p]) => p >= t));
  const [p0, a] = STOPS[i - 1], [p1, b] = STOPS[i];
  const k = (t - p0) / (p1 - p0);
  return '#' + a.map((c, j) => Math.round(c + (b[j] - c) * k).toString(16).padStart(2, '0')).join('');
}
// Where a colour sits on the strip: the closest of a few hundred samples.
function stripOf(hex: string) {
  const n = parseInt(hex.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= 400; i++) {
    const m = parseInt(stripAt(i / 400).slice(1), 16);
    const d = [(m >> 16) & 255, (m >> 8) & 255, m & 255].reduce((s, c, j) => s + (c - rgb[j]) ** 2, 0);
    if (d < bestD) { bestD = d; best = i / 400; }
  }
  return best;
}
let colorT: number | null = null;
function ColorKnob() {
  if (colorT === null || stripAt(colorT) !== tool.hex) colorT = stripOf(tool.hex); // changed elsewhere, or first time
  return (
    <Knob name="color" t={colorT} put={(v) => { colorT = v; tool.hex = stripAt(v); }}
      face={<i className="ft-swatch" style={{ background: tool.hex }} />}
      track={<><span className="ft-strip" style={{ background: STRIP }} /><span className="ft-mark" style={{ background: tool.hex }} /></>} />
  );
}

// A floating frosted panel holding every control, Figma style.
// It writes straight into `tool`; it re-renders after any click, input or key.
export function Panel() {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    // Space toggles auto draw.
    const key = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); tool.auto = !tool.auto; again(); } };
    window.addEventListener('keydown', key);
    const events = ['click', 'input', 'keyup'];
    events.forEach((ev) => window.addEventListener(ev, again));
    return () => { events.forEach((ev) => window.removeEventListener(ev, again)); window.removeEventListener('keydown', key); };
  }, []);
  // Buttons give up focus after a click so the space bar stays the auto toggle.
  const set = (fn: () => void) => { fn(); (document.activeElement as HTMLElement | null)?.blur?.(); };

  const chips = <T extends string>(items: T[], cur: string, apply: (v: T) => void) => (
    <div className="ft-chips">
      {items.map((v) => (
        <button key={v} className={cur === v ? 'on' : ''} onClick={() => set(() => { apply(v); })}>{v}</button>
      ))}
    </div>
  );
  const slider = (k: Num) => (
    <label key={k} className="ft-row">
      <span>{k}</span>
      <input type="range" {...RANGE[k]} value={tool[k]}
        style={{ '--p': `${((tool[k] - RANGE[k].min) / (RANGE[k].max - RANGE[k].min)) * 100}%` } as React.CSSProperties}
        onInput={(e) => { tool[k] = parseFloat((e.target as HTMLInputElement).value); }} onChange={() => {}} />
    </label>
  );

  return (
    <>
    {/* The media, as big icons in a frosted bar under the balloon. */}
    <div className="ft-media">
      {MEDIA.map((m) => (
        <button key={m} title={m} aria-label={m} className={tool.brush === m ? 'on' : ''} onClick={() => set(() => { tool.brush = m; })}>
          <MediumIcon m={m} />
        </button>
      ))}
      <span className="ft-sep" />
      <SizeKnob />
      <ColorKnob />
    </div>
    <div className="ft-drawer">
        <section>
          <h4>{tool.brush}</h4>
          {(OPTIONS[tool.brush as Medium] ?? []).map(slider)}
        </section>
        <section>
          <h4>Paint</h4>
          {chips(FINISHES, tool.finish, (v) => { tool.finish = v; })}
        </section>
        <section>
          <h4>Settings</h4>
          <div className="ft-chips">
            <button className={tool.auto ? 'on' : ''} onClick={() => set(() => { tool.auto = !tool.auto; })}>Auto draw</button>
            <button className={tool.inertia ? 'on' : ''} onClick={() => set(() => { tool.inertia = !tool.inertia; })}>Inertia</button>
            <button onClick={() => set(() => { paint.clear(); clearDrips(); })}>Clear</button>
            <button onClick={() => set(resetTool)}>Reset tools</button>
          </div>
        </section>
        <p className="ft-help"><b>Click + drag</b> paint and turn<br /><b>Cmd + move</b> turn without painting<br /><b>Space</b> auto draw</p>
    </div>
    </>
  );
}
