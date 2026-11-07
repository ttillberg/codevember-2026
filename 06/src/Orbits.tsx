import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, type Group, Vector3 } from 'three';
import { clock } from './clock';
import { PLANETS } from './planets';
import { planetAt } from './scale';

// Whether the orbits are drawn, switched from the planet list (or O).
export const orbitsShown = { value: false };

const ORBIT_Y = 12.6; // the orbits' plane, where the planets ride

// Each planet's orbit as a thin line in the colour of its sweet, sampled finely over one year from the same Kepler
// elements that place the planet, worked out once (they drift too slowly to matter).
const COLOURS: Record<string, string> = {
  Mercury: '#a8704a',
  Venus: '#e6a23c',
  Earth: '#3fcc45',
  Mars: '#e0262e',
  Jupiter: '#f2d65a',
  Saturn: '#f5c46c',
  Uranus: '#2fc4d0',
  Neptune: '#4f6ad8',
};
const OPACITY = 0.6; // at the planet; fading off behind it

// Each orbit fades like a trail: brightest at the planet, thinning away behind it round the orbit, almost gone just
// ahead of it. The orbit is sampled over one year from when it was made, so where the planet is along it now is
// just how far through its year it is.
export function Orbits() {
  const group = useRef<Group>(null!);
  const start = useMemo(() => clock.jd, []);
  const lines = useMemo(
    () =>
      PLANETS.map((p) => {
        const year = Math.pow(p.el.a, 1.5) * 365.25, steps = 720, points: number[] = [], at = new Vector3();
        for (let i = 0; i <= steps; i++) {
          planetAt(p, start + (i / steps) * year, at).y += ORBIT_Y;
          points.push(at.x, at.y, at.z);
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
        // Colour and alpha per point, the alpha set every frame.
        const c = new Color(COLOURS[p.name] ?? '#d8dbe4'), colours = new Float32Array((steps + 1) * 4);
        for (let i = 0; i <= steps; i++) colours.set([c.r, c.g, c.b, 0], i * 4);
        g.setAttribute('color', new BufferAttribute(colours, 4));
        return { name: p.name, geometry: g, year, steps };
      }),
    [start],
  );
  useFrame(() => {
    group.current.visible = orbitsShown.value;
    if (!orbitsShown.value) return;
    for (const l of lines) {
      const now = (((clock.jd - start) / l.year) % 1 + 1) % 1, colour = l.geometry.getAttribute('color') as BufferAttribute;
      for (let i = 0; i <= l.steps; i++) {
        const behind = (((now - i / l.steps) % 1) + 1) % 1; // 0 at the planet, towards 1 round behind it
        colour.setW(i, OPACITY * Math.pow(1 - behind, 1.6));
      }
      colour.needsUpdate = true;
    }
  });
  return (
    <group ref={group} visible={false}>
      {lines.map((l) => (
        <line key={l.name}>
          <primitive object={l.geometry} attach="geometry" />
          <lineBasicMaterial vertexColors transparent depthWrite={false} />
        </line>
      ))}
    </group>
  );
}
