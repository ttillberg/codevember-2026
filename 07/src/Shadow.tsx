import { useMemo } from 'react';
import { CircleGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { length, smoothstep, uv } from 'three/tsl';
import { uShadow, uShadowA } from './theme';

// A soft dark disc on the floor under the balloon: not a real shadow, the balloon is clear and casts little,
// just enough to put it on something.
export function Shadow() {
  const geo = useMemo(() => new CircleGeometry(1.6, 64), []);
  const mat = useMemo(() => {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    const d = length(uv().sub(0.5)).mul(2);
    m.colorNode = uShadow;
    m.opacityNode = smoothstep(1, 0.15, d).mul(uShadowA);
    return m;
  }, []);
  return <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.06, 0]} renderOrder={-1} />;
}
