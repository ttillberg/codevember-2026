import { useEffect, useRef, useState } from 'react';
import { clearDrips } from './drips';
import { paint } from './Balloon';
import type { Brush } from './paint';
import { resetTool, tool, type Finish } from './tool';

// The media, and the options each one answers to.
type Medium = 'glaze' | 'bristle' | 'spray' | 'flat' | 'scrape';
const MEDIA: Medium[] = ['glaze', 'bristle', 'spray', 'flat', 'scrape'];
const FINISHES: Finish[] = ['matte', 'gloss', 'metal'];

// The media as little pictures: a pointed paintbrush, a bristle brush, a spray can, a marker with a big round nib, an eraser.
// The paintbrush, the marker and the eraser are drawn upright and tilted into place.
const MEDIUM_ICON: Record<Medium, string> = {
  glaze: 'M7.3 7l.3-5.2a.4.4 0 0 1 .8 0L8.7 7M6.6 7h2.8v2H6.6zM6.6 9c0 2 .7 3.6 1.4 5 .7-1.4 1.4-3 1.4-5',
  bristle: 'M4 3h8v4H4zM5 7v5M7 7v6M9 7v6M11 7v5',
  spray: 'M6 6h4v7.5H6zM7 6V4.5h2V6M9 3h1.5M11.5 3.5l1-1M11.5 5h1.5',
  flat: 'M6 2.5h4v7H6zM6 4.5h4M6 9.5l.9 2.1a1.2 1.2 0 0 0 2.2 0L10 9.5',
  scrape: 'M4.5 5.5h7A1.5 1.5 0 0 1 13 7v2a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 9V7a1.5 1.5 0 0 1 1.5-1.5zM7.5 5.5v5',
};
const MEDIUM_TILT: Partial<Record<Medium, string>> = { glaze: 'rotate(45 8 8)', flat: 'rotate(45 8 8)', scrape: 'rotate(-40 8 8)' };
const MediumIcon = ({ m }: { m: Medium }) => (
  // The pictures span about 11 units; 34px brings them to the colour swatch's 24px, a thinner stroke keeps the line ~1.5px.
  <svg width="34" height="34" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={MEDIUM_ICON[m]} transform={MEDIUM_TILT[m]} />
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
// It reads and writes a 0..1 value itself (get/put) so it redraws as you drag; the wheel over the button nudges it too.
const TRAVEL = 140; // px of drag for the whole range, the gauge's height
function Knob({ name, get, put, face, track }: {
  name: string; get: () => number; put: (t: number) => void;
  face: (t: number) => React.ReactNode; track: (t: number) => React.ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const [, bump] = useState(0);
  const start = useRef({ x: 0, y: 0, t: 0 });
  // Let go anywhere closes it, even if the capture got lost on the way.
  useEffect(() => {
    if (!held) return;
    const up = () => setHeld(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [held]);
  const t = get();
  const to = (v: number) => { put(Math.min(1, Math.max(0, v))); bump((n) => n + 1); };
  return (
    <div className="ft-knob">
      <button aria-label={name} title={`${name} (hold and drag)`} className={held ? 'on' : ''}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY, t }; setHeld(true); }}
        onPointerMove={(e) => { if (held) to(start.current.t + (start.current.y - e.clientY + e.clientX - start.current.x) / TRAVEL); }} // up or right raises
        onWheel={(e) => to(t - Math.sign(e.deltaY) * 0.02)}>
        {face(t)}
      </button>
      <div className={`ft-gauge${held ? ' open' : ''}`}>
        <div className="ft-gauge-track" style={{ '--t': t } as React.CSSProperties}>{track(t)}</div>
      </div>
    </div>
  );
}

// A volume ramp: a wedge from nothing to big, filled up to the size.
const RAMP = 'M1 22 L25 4 L25 22 Z';
const SizeRamp = ({ t }: { t: number }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" className="ft-ramp">
    <clipPath id="ft-ramp-fill"><rect x="0" y="0" width={1 + t * 24} height="26" /></clipPath>
    <path d={RAMP} className="ft-ramp-bg" />
    <path d={RAMP} clipPath="url(#ft-ramp-fill)" />
  </svg>
);

// Size: a volume ramp on the button, the gauge fills up like a volume bar.
function SizeKnob() {
  const { min, max } = RANGE.size;
  return (
    <Knob name="size" get={() => (tool.size - min) / (max - min)} put={(v) => { tool.size = min + v * (max - min); }}
      face={(t) => <SizeRamp t={t} />}
      track={(t) => <><span className="ft-fill" /><b>{Math.round(t * 100)}</b></>} />
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
const colorGet = () => {
  if (colorT === null || stripAt(colorT) !== tool.hex) colorT = stripOf(tool.hex); // changed elsewhere, or first time
  return colorT;
};
function ColorKnob() {
  return (
    <Knob name="color" get={colorGet} put={(v) => { colorT = v; tool.hex = stripAt(v); }}
      face={() => <i className="ft-swatch" style={{ background: tool.hex }} />}
      track={() => <><span className="ft-strip" style={{ background: STRIP }} /><span className="ft-mark" style={{ background: tool.hex }} /></>} />
  );
}

// A picker in the bar: only the current choice shows. Press it and the choices pop up above; drag up to one and let
// go to pick it, or tap and then click one. A press elsewhere closes it.
function Picker<T extends string>({ name, items, cur, put, icon, solid }: {
  name: string; items: T[]; cur: T; put: (v: T) => void; icon: (v: T) => React.ReactNode;
  solid?: boolean; // picked shows as black, for icons; off for swatches that carry their own look (a ring instead)
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState<T | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef({ y: 0, moved: false, down: false });
  // The choice in the row at this height, wherever the pointer is sideways; past the top it's the top one.
  // Back down under the popover (over the button) it's none, so letting go there changes nothing.
  const rowAt = (y: number) => {
    const rows = [...(box.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])];
    const bottom = Math.max(...rows.map((r) => r.getBoundingClientRect().bottom));
    if (!rows.length || y > bottom + 6) return null;
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const r of rows) {
      const { top, height } = r.getBoundingClientRect();
      const d = Math.abs(top + height / 2 - y);
      if (d < bestD) { bestD = d; best = r; }
    }
    return (best?.dataset.item as T | undefined) ?? null;
  };
  const pick = (v: T) => { put(v); setOpen(false); setHot(null); };
  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      if (!drag.current.down) return;
      if (Math.abs(e.clientY - drag.current.y) > 6) drag.current.moved = true;
      setHot(rowAt(e.clientY));
    };
    const up = (e: PointerEvent) => {
      if (!drag.current.down) return;
      drag.current.down = false;
      const v = rowAt(e.clientY);
      if (drag.current.moved) { if (v) pick(v); else setOpen(false); } // a drag picks where it ends; a tap leaves it open
      setHot(null);
    };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={`ft-knob${solid ? '' : ' swatches'}`} ref={box}>
      <button aria-label={`${name}: ${cur}`} title={`${cur} (press to change)`} className={open ? 'on' : ''}
        onPointerDown={(e) => {
          e.preventDefault();
          if (open) { setOpen(false); return; }
          drag.current = { y: e.clientY, moved: false, down: true };
          setOpen(true);
        }}>
        {icon(cur)}
      </button>
      <div className={`ft-gauge ft-pick${open ? ' open' : ''}`}>
        {items.map((v) => (
          <button key={v} data-item={v} title={v} aria-label={v}
            className={(hot ?? cur) === v ? 'on' : ''} onClick={() => pick(v)}>
            {icon(v)}
            <span>{v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// One option as a slider: the name and value over a pill track. Drag anywhere on it, the value under the pointer.
function OptionSlider({ k }: { k: Num }) {
  const [, bump] = useState(0);
  const { min, max } = RANGE[k];
  const t = (tool[k] - min) / (max - min);
  const at = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    tool[k] = min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (max - min);
    bump((n) => n + 1);
  };
  return (
    <div className="ft-slide" style={{ '--t': t } as React.CSSProperties}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}>
      <div className="ft-slide-text"><span>{k}</span><b>{Math.round(t * 100)}</b></div>
      <div className="ft-slide-track"><i /></div>
    </div>
  );
}

// The current medium's options, behind a little sliders button next to it.
const OptionsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
    <path d="M2.5 5h11M2.5 11h11" />
    <circle cx="6" cy="5" r="1.6" fill="currentColor" /><circle cx="10.5" cy="11" r="1.6" fill="currentColor" />
  </svg>
);
// A small icon button in the bar that opens a popover above it; a press elsewhere or escape closes it.
function Pop({ name, icon, className, small, children }: {
  name: string; icon: React.ReactNode; className: string; small?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="ft-knob" ref={box}>
      <button aria-label={name} title={name} className={`${small ? 'ft-opts' : ''}${open ? ' on' : ''}`}
        onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}
      </button>
      <div className={`ft-gauge ft-popover ${className}${open ? ' open' : ''}`}>{children}</div>
    </div>
  );
}

// A gear: eight teeth.
const GEAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 4.7 : 6.4, a0 = (i / 16) * Math.PI * 2 - 0.12, a1 = ((i + 1) / 16) * Math.PI * 2 - 0.12 - 0.12;
    pts.push(`${8 + r * Math.cos(a0)} ${8 + r * Math.sin(a0)}`, `${8 + r * Math.cos(a1)} ${8 + r * Math.sin(a1)}`);
  }
  return `M${pts.join(' L')} Z`;
})();
// 30px puts a 12.8 unit gear or a 12 unit ring at 24px across, the colour swatch's size.
const Icon = ({ children, size = 30, stroke = 0.8 }: { children: React.ReactNode; size?: number; stroke?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
// Solid, the hole punched through with evenodd.
const GearIcon = () => (
  <Icon><path d={`${GEAR} M10.2 8 A2.2 2.2 0 1 0 5.8 8 A2.2 2.2 0 1 0 10.2 8 Z`} fill="currentColor" fillRule="evenodd" stroke="none" /></Icon>
);
const HelpIcon = () => (
  <Icon><circle cx="8" cy="8" r="6" /><path d="M6.25 6.4a1.8 1.8 0 1 1 2.6 1.6c-.55.28-.85.65-.85 1.2v.3" /><circle cx="8" cy="11.2" r="0.5" fill="currentColor" stroke="none" /></Icon>
);

// A row in a popover menu: a label, and a little switch when it toggles.
const Row = ({ label, on, hint, act }: { label: string; on?: boolean; hint?: string; act: () => void }) => (
  <button className="ft-row" onClick={act}>
    <span>{label}</span>
    {hint && <kbd>{hint}</kbd>}
    {on !== undefined && <i className={`ft-switch${on ? ' on' : ''}`} />}
  </button>
);

// The finishes as little black balls: soft for matte, a sharp highlight for gloss, a chrome horizon for metal.
const FinishBall = ({ f }: { f: Finish }) => <i className={`ft-ball ${f}`} />;

// The bar holding every control. It writes straight into `tool`; it re-renders after any click, input or key.
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

  return (
    <>
    {/* Every control, in a frosted bar under the balloon. */}
    <div className="ft-media">
      <Picker name="medium" items={MEDIA} cur={tool.brush as Medium} put={(m) => { tool.brush = m; }} icon={(m) => <MediumIcon m={m} />} solid />
      <Pop name={`${tool.brush} options`} icon={<OptionsIcon />} className="ft-sliders" small>
        {OPTIONS[tool.brush as Medium].map((k) => <OptionSlider key={`${tool.brush}-${k}`} k={k} />)}
      </Pop>
      <span className="ft-sep" />
      <SizeKnob />
      <ColorKnob />
      <Picker name="paint" items={FINISHES} cur={tool.finish} put={(f) => { tool.finish = f; }} icon={(f) => <FinishBall f={f} />} />
      <span className="ft-sep" />
      <div className="ft-pair">
        <Pop name="settings" icon={<GearIcon />} className="ft-menu">
          <Row label="Auto draw" hint="Space" on={tool.auto} act={() => set(() => { tool.auto = !tool.auto; })} />
          <Row label="Inertia" on={tool.inertia} act={() => set(() => { tool.inertia = !tool.inertia; })} />
          <hr />
          <div className="ft-actions">
            <button onClick={() => set(() => { paint.clear(); clearDrips(); })}>
              <Icon size={14} stroke={1.4}><circle cx="8" cy="8" r="5.5" /><path d="M4.1 11.9l7.8-7.8" /></Icon>Clear
            </button>
            <button onClick={() => set(resetTool)}>
              <Icon size={14} stroke={1.4}><path d="M3 3v3.5h3.5" /><path d="M3.4 6.2A5.3 5.3 0 1 1 3.3 10" /></Icon>Reset tools
            </button>
          </div>
        </Pop>
        <Pop name="help" icon={<HelpIcon />} className="ft-menu ft-help">
          <p><b>Click + drag</b> paint and turn</p>
          <p><b>Cmd + move</b> turn without painting</p>
          <p><b>Space</b> auto draw</p>
        </Pop>
      </div>
    </div>
    </>
  );
}
