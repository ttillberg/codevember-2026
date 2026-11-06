import { useEffect, useRef, useState } from 'react';
import { clock } from './clock';
import { dateFromJd, jdFromDate, SCALES, type Scale } from './kepler';
import { VIEWS, type View } from './views';

const SPEEDS = [
  { label: '1d', v: 1 },
  { label: '1w', v: 7 },
  { label: '1m', v: 30 },
  { label: '1y', v: 365.25 },
];

type Props = {
  labels: boolean;
  setLabels: (b: boolean) => void;
  mode: Scale;
  setMode: (m: Scale) => void;
  view: View;
  setView: (v: View) => void;
};

const next = (m: Scale) => SCALES[(SCALES.indexOf(m) + 1) % SCALES.length];
const nextView = (v: View) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];

export function Hud({ labels, setLabels, mode, setMode, view, setView }: Props) {
  const date = useRef<HTMLSpanElement>(null);
  const [speed, setSpeed] = useState(clock.speed);
  const [paused, setPaused] = useState(clock.paused);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (date.current) date.current.textContent = dateFromJd(clock.jd).toISOString().slice(0, 10);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    clock.speed = speed;
    clock.paused = paused;
  }, [speed, paused]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPaused((p) => !p);
      if (e.key === 'l') setLabels(!labels);
      if (e.key === 'p') setMode(next(mode));
      if (e.key === 'o') setView(nextView(view));
      const n = Number(e.key);
      if (n >= 1 && n <= SPEEDS.length) setSpeed(SPEEDS[n - 1].v);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [labels, setLabels, mode, setMode, view, setView]);

  return (
    <div className="hud">
      <button onClick={() => setPaused(!paused)}>{paused ? '▶' : '❚❚'}</button>
      <span className="date" ref={date} />
      {SPEEDS.map((s) => (
        <button key={s.label} className={s.v === speed ? 'on' : ''} onClick={() => setSpeed(s.v)}>
          {s.label}/s
        </button>
      ))}
      <button onClick={() => (clock.jd = jdFromDate(new Date()))}>now</button>
      <button onClick={() => setMode(next(mode))}>scale: {mode}</button>
      <button onClick={() => setView(nextView(view))}>view: {view}</button>
    </div>
  );
}
