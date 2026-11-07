import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, type Group, Line, LineDashedMaterial, Vector3 } from 'three';
import { clock } from './clock';
import { PLANETS } from './planets';
import { planetAt } from './scale';
import { focus } from './CameraRig';
import { pickedNow } from './selection';
import { roomLight } from './intro';

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
const DASH = 0.35, GAP = 0.25; // scene units
// Shown by themselves when the camera is this far from the sun or more, faded out by NEAR.
const NEAR = 26, FAR = 32; // the default view sits about 36 out
const SUN = new Vector3(0, 12.6, 0);

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
        const line = new Line(g, new LineDashedMaterial({ vertexColors: true, transparent: true, depthWrite: false, dashSize: DASH, gapSize: GAP }));
        line.computeLineDistances();
        return { name: p.name, geometry: g, year, steps, line };
      }),
    [start],
  );
  const shown = useRef<string | null>(null); // the planet in focus, kept while the focus fades out again
  useFrame(({ camera }) => {
    // On by themselves once the camera's far out, gone again close in; the switch keeps them on regardless.
    const far = camera.position.distanceTo(SUN), t = Math.min(1, Math.max(0, (far - NEAR) / (FAR - NEAR)));
    const base = orbitsShown.value ? 1 : t * t * (3 - 2 * t);
    // In focus, only the focused planet's own orbit stays: the rest fade out.
    const picked = pickedNow();
    if (picked) shown.current = picked;
    else if (focus.amount < 0.01) shown.current = null;
    const room = roomLight();
    const fades = lines.map((l) => (l.name === shown.current ? Math.max(base * (1 - focus.amount), focus.amount) : orbitsShown.value ? 1 : base * (1 - focus.amount)));
    for (let i = 0; i < fades.length; i++) fades[i] *= room;
    group.current.visible = fades.some((f) => f > 0.01);
    if (!group.current.visible) return;
    lines.forEach((l, n) => {
      const fade = fades[n];
      l.line.visible = fade > 0.01;
      if (!l.line.visible) return;
      const now = (((clock.jd - start) / l.year) % 1 + 1) % 1, colour = l.geometry.getAttribute('color') as BufferAttribute;
      for (let i = 0; i <= l.steps; i++) {
        const behind = (((now - i / l.steps) % 1) + 1) % 1; // 0 at the planet, towards 1 round behind it
        colour.setW(i, OPACITY * fade * Math.pow(1 - behind, 1.6));
      }
      colour.needsUpdate = true;
    });
  });
  return (
    <group ref={group} visible={false}>
      {lines.map((l) => (
        <primitive key={l.name} object={l.line} />
      ))}
    </group>
  );
}
