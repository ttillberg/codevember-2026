import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Group, NeutralToneMapping, Vector3 } from 'three';
import { PlanetCandy } from './Beans';
import { clock } from './clock';
import { elementsAt, position } from './kepler';
import { PLANETS } from './planets';
import { pick, usePicked } from './selection';

// The flavour each planet's bean would be.
const FLAVOUR: Record<string, string> = {
  Mercury: 'dark chocolate button, white nonpareils on top',
  Earth: 'blue raspberry and lime, a silver Moon on the side',
  Venus: 'hard butter caramel',
  Mars: 'cinnamon fire chili, two little chilis in tow',
  Jupiter: 'toffee swirl',
  Saturn: 'a big gumball, with a ring of little ones',
  Uranus: 'sugared spearmint gum, rolling round on its side',
  Neptune: 'blueberry jelly rolled in nonpareils',
};

const AU_KM = 149597870.7;
const GM_SUN = 1.32712440018e11; // km³/s²

// The bean, turning slowly on its own, lit by a small studio.
function Spin({ name }: { name: string }) {
  const ref = useRef<Group>(null!);
  useFrame((_, dt) => {
    ref.current.rotation.y += dt * 0.5;
    ref.current.rotation.x = 0.35 + Math.sin(performance.now() / 2400) * 0.15;
  });
  return (
    <group ref={ref}>
      <PlanetCandy name={name} shadows={false} />
    </group>
  );
}

const duration = (days: number) => {
  const d = Math.abs(days);
  return d < 2 ? `${(d * 24).toFixed(1)} h` : `${d.toFixed(1)} days`;
};

// A close up of the picked planet on the right: its bean turning, and a few facts, the live ones updated every frame.
export function PlanetCard() {
  const name = usePicked();
  const planet = PLANETS.find((p) => p.name === name);
  const distance = useRef<HTMLElement>(null);
  const speed = useRef<HTMLElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && pick(null);
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
      if (distance.current) distance.current.textContent = `${r.toFixed(3)} au`;
      if (speed.current) speed.current.textContent = `${kms.toFixed(1)} km/s`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [planet]);

  if (!planet) return null;
  const years = Math.pow(planet.el.a, 1.5);
  return (
    <aside className="card">
      <button className="close" onClick={() => pick(null)} aria-label="Close">
        ×
      </button>
      <div className="view">
        <Canvas camera={{ position: [0, 0, 9], fov: 35 }} dpr={[1, 2]} gl={{ toneMapping: NeutralToneMapping }}>
          <Environment resolution={128}>
            <Lightformer intensity={3} position={[0, 6, 4]} scale={[8, 4, 1]} />
            <Lightformer intensity={1.5} position={[-6, 0, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
            <Lightformer intensity={1} position={[6, -2, 2]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} />
          </Environment>
          <directionalLight position={[3, 4, 5]} intensity={1.2} />
          <Spin name={planet.name} />
        </Canvas>
      </div>
      <h2>{planet.name}</h2>
      <p className="flavour">{FLAVOUR[planet.name]}</p>
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
      </dl>
    </aside>
  );
}
