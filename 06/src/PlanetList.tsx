import { useEffect } from 'react';
import { PLANETS } from './planets';
import { pick, usePicked } from './selection';

// A curiosity for each planet, shown with its facts on the right when it's picked.
export const CURIOSITY: Record<string, string> = {
  Mercury: 'A year lasts 88 days, but from one sunrise to the next takes 176.',
  Venus: 'It spins backwards, so slowly that its day is longer than its year.',
  Earth: 'Its Moon drifts about 3.8 cm further away every year.',
  Mars: 'Olympus Mons, its biggest volcano, is nearly three times as tall as Everest.',
  Jupiter: 'More than twice as heavy as all the other planets put together.',
  Saturn: 'So light for its size that it would float, given a big enough bath.',
  Uranus: 'It rolls round the sun on its side: each pole gets 42 years of daylight.',
  Neptune: 'The windiest planet, its gusts over 2,000 km/h.',
};

// The moons in the scene, by planet, named in the facts when it's picked.
export const MOONS: Record<string, string[]> = {
  Earth: ['Moon'],
  Mars: ['Phobos', 'Deimos'],
  Jupiter: ['Io', 'Europa', 'Ganymede', 'Callisto'],
  Saturn: ['Titan'],
  Uranus: ['Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon'],
  Neptune: ['Triton'],
};

// The planets down the left, in order out from the sun. Click one to fly to it; the arrow keys step through them.
export function PlanetList() {
  const picked = usePicked();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const at = PLANETS.findIndex((p) => p.name === picked);
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : PLANETS.length - 1) : (at + step + PLANETS.length) % PLANETS.length;
      pick(PLANETS[next].name);
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [picked]);
  return (
    <nav className="planets">
      {PLANETS.map((p) => (
        <button key={p.name} className={p.name === picked ? 'on' : ''} onClick={(e) => (pick(p.name === picked ? null : p.name), e.currentTarget.blur())}>
          {p.name}
        </button>
      ))}
    </nav>
  );
}
