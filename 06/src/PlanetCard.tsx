import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { clock } from './clock';
import { elementsAt, position } from './kepler';
import { PLANETS } from './planets';
import { CURIOSITY, MOONS } from './PlanetList';
import { COLOURS } from './Orbits';
import { pick, typing, usePicked } from './selection';

// Only touches the page when the text actually changes.
const write = (el: HTMLElement | null, text: string) => void (el && el.textContent !== text && (el.textContent = text));

// The flavour each planet's bean would be.
const FLAVOUR: Record<string, string> = {
  Mercury: 'dark chocolate button, white nonpareils on top',
  Earth: 'a ball of blue and green nonpareils, a popcorn Moon',
  Venus: 'hard butter caramel',
  Mars: 'cinnamon fire chilli bean, two little ones in tow',
  Jupiter: 'coconut roll round a liquorice core',
  Saturn: 'a big gumball, with a ring of little ones',
  Uranus: 'sugared spearmint gum, rolling round on its side',
  Neptune: 'blueberry jelly rolled in nonpareils',
};

const AU_KM = 149597870.7;
const GM_SUN = 1.32712440018e11; // km³/s²

const duration = (days: number) => {
  const d = Math.abs(days);
  return d < 2 ? `${(d * 24).toFixed(1)} h` : `${d.toFixed(1)} days`;
};

// The picked planet's facts on the right, plain text: what sweet it is, a curiosity, and a few numbers, the live
// ones updated every frame.
export function PlanetCard() {
  const name = usePicked();
  const planet = PLANETS.find((p) => p.name === name);
  const distance = useRef<HTMLElement>(null);
  const speed = useRef<HTMLElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => !typing(e) && e.key === 'Escape' && pick(null);
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  // Distance from the sun and orbital speed, from the same Kepler maths that places the bean.
  useEffect(() => {
    if (!planet) return;
    const v = new Vector3();
    let raf = 0;
    const loop = () => {
      const el = elementsAt(planet.el, planet.rate, clock.jd);
      const r = position(el, v).length();
      const kms = Math.sqrt(GM_SUN * (2 / (r * AU_KM) - 1 / (el.a * AU_KM)));
      write(distance.current, `${r.toFixed(3)} au`);
      write(speed.current, `${kms.toFixed(1)} km/s`);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [planet]);

  if (!planet) return null;
  return <Info planet={planet} distance={distance} speed={speed} />;
}

function Info({ planet, distance, speed }: { planet: (typeof PLANETS)[number]; distance: React.RefObject<HTMLElement | null>; speed: React.RefObject<HTMLElement | null> }) {
  const years = Math.pow(planet.el.a, 1.5);
  return (
    <aside className="info">
      <h2 style={{ color: COLOURS[planet.name] }}>{planet.name}</h2>
      <p className="flavour">{FLAVOUR[planet.name]}</p>
      <p className="curiosity">{CURIOSITY[planet.name]}</p>
      <dl>
        <dt>from the sun</dt>
        <dd ref={distance} />
        <dt>orbital speed</dt>
        <dd ref={speed} />
        <dt>year</dt>
        <dd>{years < 2 ? `${(years * 365.25).toFixed(0)} days` : `${years.toFixed(1)} years`}</dd>
        <dt>day</dt>
        <dd>
          {duration(planet.day)}
          {planet.day < 0 ? ', backwards' : ''}
        </dd>
        <dt>radius</dt>
        <dd>{Math.round(planet.km).toLocaleString('en')} km</dd>
        <dt>axial tilt</dt>
        <dd>{planet.tilt.toFixed(1)}°</dd>
        <dt>eccentricity</dt>
        <dd>{planet.el.e.toFixed(3)}</dd>
        {MOONS[planet.name] && (
          <>
            <dt>{MOONS[planet.name].length > 1 ? 'moons' : 'moon'}</dt>
            <dd className="names">{MOONS[planet.name].join(', ')}</dd>
          </>
        )}
      </dl>
    </aside>
  );
}
