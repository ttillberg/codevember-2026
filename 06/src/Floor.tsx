import { useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Scale } from './kepler';
import { lowestPoint } from './layout';

// Just below the lowest deck; the bulb hangs from above.
export const floorY = (mode: Scale) => Math.min(-2, lowestPoint(mode) - 1);

const SIZE = 400;
const TILE = 5; // one texture tile = 5 units: four fine lines and one heavier

// A lit test floor: the grid is a texture on a plain standard material, so it is only visible where the
// bulb reaches it and it catches every shadow.
function gridTexture() {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2c30';
  g.fillRect(0, 0, px, px);
  g.fillStyle = '#4a4e56';
  for (let i = 1; i < 5; i++) {
    const x = Math.round((i / 5) * px);
    g.fillRect(x, 0, 1, px);
    g.fillRect(0, x, px, 1);
  }
  g.fillStyle = '#6a707a';
  g.fillRect(0, 0, 2, px);
  g.fillRect(0, 0, px, 2);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(SIZE / TILE, SIZE / TILE);
  t.anisotropy = 8;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function Floor({ mode }: { mode: Scale }) {
  const map = useMemo(gridTexture, []);
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={floorY(mode)} receiveShadow>
      <planeGeometry args={[SIZE, SIZE]} />
      <meshStandardMaterial map={map} roughness={0.85} />
    </mesh>
  );
}
