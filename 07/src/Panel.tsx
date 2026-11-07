import { useEffect, useState } from 'react';
import { clearDrips } from './drips';
import { paint } from './Balloon';
import type { Brush } from './paint';
import { ColorPicker } from './ColorPicker';
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
    </div>
    <div className="ft-drawer">
        <section>
          <h4>{tool.brush}</h4>
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
    </>
  );
}
