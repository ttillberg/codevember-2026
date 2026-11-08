import { useMemo } from 'react';
import { CircleGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { exp, length, smoothstep, uv, vec3 } from 'three/tsl';
import { uShadow, uShadowA } from './theme';

// A soft dark disc on the floor under the balloon: not a real shadow, the balloon is clear and casts little,
// just enough to put it on something.
export function Shadow() {
  const geo = useMemo(() => new CircleGeometry(2, 64), []);
  const mat = useMemo(() => {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    const d = length(uv().sub(0.5)).mul(2);
    m.colorNode = uShadow;
    m.opacityNode = smoothstep(1, 0.15, d).mul(uShadowA);
    return m;
  }, []);
  // The caustic: a clear ball is a lens, so the key light gathers into a bright soft spot inside its shadow, on the
  // side away from the light. A wide glow and a tighter core.
  const caustic = useMemo(() => {
    const m = new MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    const d = length(uv().sub(0.5)).mul(2);
    m.colorNode = vec3(1, 0.97, 0.9);
    m.opacityNode = exp(d.mul(d).mul(-9)).mul(0.4).add(exp(d.mul(d).mul(-60)).mul(0.5));
    return m;
  }, []);
  const spot = useMemo(() => new CircleGeometry(0.55, 48), []);
  return (
    <>
      <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.45, 0]} renderOrder={-1} />
      <mesh geometry={spot} material={caustic} rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, -1.445, -0.75]} renderOrder={-1} />
    </>
  );
}
