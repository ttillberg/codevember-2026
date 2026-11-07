import { useEffect, useState } from 'react';
import { SWATCHES, resetTool, tool, type Finish } from './tool';
import type { Brush } from './paint';

const BRUSHES: Brush[] = ['flat', 'round', 'spray', 'bristle', 'glaze', 'scrape'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

export function Palette() {
  const [rev, bump] = useState(0);
  // Buttons give up focus after a click so the space bar stays the auto toggle and never re-presses them.
  const set = (fn: () => void) => { fn(); bump((n) => n + 1); (document.activeElement as HTMLElement | null)?.blur?.(); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); set(() => { tool.auto = !tool.auto; }); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="palette">
      <div className="swatches">
        {SWATCHES.map((s) => (
          <button
            key={s.hex}
            title={s.name}
            className={tool.hex === s.hex ? 'on' : ''}
            style={{ background: s.hex }}
            onClick={() => set(() => { tool.hex = s.hex; })}
          />
        ))}
      </div>
      <div className="brushes">
        {BRUSHES.map((b) => (
          <button key={b} className={tool.brush === b ? 'on' : ''} onClick={() => set(() => { tool.brush = b; })}>
            {b}
          </button>
        ))}
      </div>
      <div className="brushes">
        {FINISHES.map((f) => (
          <button key={f} className={tool.finish === f ? 'on' : ''} onClick={() => set(() => { tool.finish = f; })}>
            {f}
          </button>
        ))}
      </div>
      <button className={`auto ${tool.auto ? 'on' : ''}`} onClick={() => set(() => { tool.auto = !tool.auto; })}>
        auto
      </button>
      <label className="size">
        watery
        <input
          key={rev}
          type="range" min={0} max={1} step={0.01} defaultValue={tool.watery}
          onInput={(e) => { tool.watery = parseFloat((e.target as HTMLInputElement).value); }}
        />
      </label>
      <label className="size">
        liquid
        <input
          key={rev}
          type="range" min={0} max={1} step={0.01} defaultValue={tool.liquid}
          onInput={(e) => { tool.liquid = parseFloat((e.target as HTMLInputElement).value); }}
        />
      </label>
      <label className="size">
        size
        <input
          key={rev}
          type="range" min={0.01} max={0.2} step={0.005} defaultValue={tool.size}
          onInput={(e) => { tool.size = parseFloat((e.target as HTMLInputElement).value); }}
        />
      </label>
      <button className="auto" onClick={() => set(resetTool)}>
        reset
      </button>
    </div>
  );
}
