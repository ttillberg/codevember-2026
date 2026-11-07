import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, type Group, Vector3 } from 'three';
import { clock } from './clock';
import { PLANETS } from './planets';
import { planetAt } from './scale';

// Whether the orbits are drawn, switched from the planet list (or O).
export const orbitsShown = { value: false };

const ORBIT_Y = 12.6; // the orbits' plane, where the planets ride

// Each planet's orbit as a thin, faint line in the colour of its sweet. Sampled finely over one year from the same
// Kepler elements that place the planet, worked out once from today's elements (they drift too slowly to matter).
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
const OPACITY = 0.35;

export function Orbits() {
  const group = useRef<Group>(null!);
  const lines = useMemo(
    () =>
      PLANETS.map((p) => {
        const year = Math.pow(p.el.a, 1.5) * 365.25, steps = 720, points: number[] = [], at = new Vector3();
        for (let i = 0; i <= steps; i++) {
          planetAt(p, clock.jd + (i / steps) * year, at).y += ORBIT_Y;
          points.push(at.x, at.y, at.z);
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
        return { name: p.name, geometry: g };
      }),
    [],
  );
  useFrame(() => (group.current.visible = orbitsShown.value));
  return (
    <group ref={group} visible={false}>
      {lines.map((l) => (
        <line key={l.name}>
          <primitive object={l.geometry} attach="geometry" />
          <lineBasicMaterial color={COLOURS[l.name] ?? '#d8dbe4'} transparent opacity={OPACITY} depthWrite={false} />
        </line>
      ))}
    </group>
  );
}
