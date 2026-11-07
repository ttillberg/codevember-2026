import { useState } from 'react';
import { SWATCHES, tool, type Finish } from './tool';
import type { Brush } from './paint';

const BRUSHES: Brush[] = ['round', 'spray', 'bristle', 'scrape'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

export function Palette() {
  const [, bump] = useState(0);
  const set = (fn: () => void) => { fn(); bump((n) => n + 1); };
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
      <label className="size">
        size
        <input
          type="range" min={0.01} max={0.2} step={0.005} defaultValue={tool.size}
          onInput={(e) => { tool.size = parseFloat((e.target as HTMLInputElement).value); }}
        />
      </label>
    </div>
  );
}
