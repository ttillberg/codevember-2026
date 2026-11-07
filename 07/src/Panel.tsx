import { useEffect, useRef, useState } from 'react';
import { clearDrips } from './drips';
import { paint } from './Balloon';
import type { Brush } from './paint';
import { ColorPicker } from './ColorPicker';
import { resetTool, tool, type Finish } from './tool';

// The media, and the options each one answers to.
type Medium = 'glaze' | 'bristle' | 'spray' | 'flat' | 'scrape';
const MEDIA: Medium[] = ['glaze', 'bristle', 'spray', 'flat', 'scrape'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

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

const icon = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  auto: 'M5 3.5v9l7-4.5z',
  clear: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  reset: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3',
  tune: 'M2.5 5h11M2.5 11h11M10 3v4M6 9v4',
};

// A minimal floating toolbar at the bottom, Figma style, with a drawer that slides up from it holding every control.
// It writes straight into `tool` like the old palette; the old UI's changes show up here because we re-render after
// any click, input or key.
export function Panel() {
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const events = ['click', 'input', 'keyup'];
    events.forEach((ev) => window.addEventListener(ev, again));
    window.addEventListener('pointerdown', out);
    return () => { events.forEach((ev) => window.removeEventListener(ev, again)); window.removeEventListener('pointerdown', out); };
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
        onInput={(e) => { tool[k] = parseFloat((e.target as HTMLInputElement).value); }} onChange={() => {}} />
    </label>
  );

  return (
    <div className="ft" ref={root}>
      <div className={`ft-drawer ${open ? 'open' : ''}`}>
        <section>
          <h4>Medium</h4>
          {chips(MEDIA, tool.brush, (v) => { tool.brush = v; })}
          {(OPTIONS[tool.brush as Medium] ?? []).map(slider)}
        </section>
        <section>
          <h4>Size</h4>
          {slider('size')}
        </section>
        <section>
          <h4>Color</h4>
          <ColorPicker />
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
      <button className="ft-btn" title="Color" onClick={() => setOpen(true)}>
        <i className="ft-dot" style={{ background: tool.hex }} />
      </button>
      <button className="ft-btn txt" title="Brush" onClick={() => setOpen(true)}>{tool.brush}</button>
      <button className="ft-btn txt" title="Finish" onClick={() => setOpen(true)}>{tool.finish}</button>
      <div className="ft-sep" />
      <input
        className="ft-size" type="range" title="Size" min={0.01} max={0.2} step={0.005} value={tool.size}
        onInput={(e) => { tool.size = parseFloat((e.target as HTMLInputElement).value); }} onChange={() => {}}
      />
      <button className={`ft-btn ${open ? 'on' : ''}`} title="Drawer" onClick={() => setOpen(!open)}>{icon(ICONS.tune)}</button>
      <div className="ft-sep" />
      <button className={`ft-btn ${tool.auto ? 'on' : ''}`} title="Auto paint (space)" onClick={() => set(() => { tool.auto = !tool.auto; })}>{icon(ICONS.auto)}</button>
      <button className="ft-btn" title="Clear" onClick={() => set(() => { paint.clear(); clearDrips(); })}>{icon(ICONS.clear)}</button>
      <button className="ft-btn" title="Reset tool" onClick={() => set(resetTool)}>{icon(ICONS.reset)}</button>
    </div>
  );
}
