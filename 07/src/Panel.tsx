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
// It writes straight into `tool` like the old palette; the old UI's changes show up here because we re-render after
// any click, input or key.
export function Panel() {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    const events = ['click', 'input', 'keyup'];
    events.forEach((ev) => window.addEventListener(ev, again));
    return () => { events.forEach((ev) => window.removeEventListener(ev, again)) };
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
    <div className="ft-drawer">
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
  );
}
