import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { bodies, radii } from './clock';
import { PLANETS } from './planets';

// Plain divs moved by transform every frame. drei's <Html> makes one React root per label, which React 19 complains about.
export function Labels({ visible }: { visible: boolean }) {
  const { camera, size } = useThree();
  const els = useMemo(() => {
    const layer = document.createElement('div');
    layer.className = 'labels';
    const items = PLANETS.map((p) => {
      const d = document.createElement('div');
      d.className = 'label';
      d.textContent = p.name;
      layer.appendChild(d);
      return { p, d };
    });
    return { layer, items };
  }, []);

  useEffect(() => {
    document.body.appendChild(els.layer);
    return () => els.layer.remove();
  }, [els]);

  useEffect(() => {
    els.layer.style.display = visible ? '' : 'none';
  }, [els, visible]);

  const v = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!visible) return;
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const { p, d } of els.items) {
      const b = bodies.get(p.name);
      if (!b) continue;
      // Anchor under the marble's screen-space bottom edge.
      v.copy(b).addScaledVector(up, -(radii.get(p.name) ?? p.radius)).project(camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      d.style.transform = `translate(${x}px, ${y}px) translate(-50%, 4px)`;
      d.style.visibility = behind ? 'hidden' : '';
    }
  });
  return null;
}
