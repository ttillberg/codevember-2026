import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Mesh } from 'three';
import { sunRadius, type Scale } from './kepler';

const URL = `${import.meta.env.BASE_URL}bulb.glb`;

// bulb.glb is in millimetres, base contact at y = 0 (see blender/bulb.py).
const GLASS_R = 30; // envelope radius at its widest
const GLASS_Y = 73; // height of that widest ring, the bulb's optical centre
const BOTTOM_Y = -0.7; // solder contact

const scaleOf = (mode: Scale) => sunRadius(mode) / GLASS_R;

// The sun is an incandescent bulb, like the lamp in the middle of Wright of Derby's orrery. It hangs upside down
// from a cord, cap up, so the decks can cascade down underneath it.
export function Sun({ mode }: { mode: Scale }) {
  const { scene } = useGLTF(URL);
  const k = scaleOf(mode);
  // The light sits inside the glass: none of the bulb may cast a shadow, or it would black out the room.
  useEffect(() => {
    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = false;
    });
  }, [scene]);
  const top = (GLASS_Y - BOTTOM_Y) * k; // the solder contact, now the highest point
  return (
    <group>
      {/* decay 1, not the physical 2: inverse square would leave the outer rings in the dark. */}
      <pointLight
        intensity={LIGHT}
        decay={1}
        color="#ffd2a0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0015}
        shadow-normalBias={0.03}
        shadow-camera-near={0.5}
        shadow-camera-far={220}
      />
      <primitive object={scene} scale={k} rotation-x={Math.PI} position-y={GLASS_Y * k} />
      <mesh position-y={top + CORD / 2}>
        <cylinderGeometry args={[0.12, 0.12, CORD, 12]} />
        <meshStandardMaterial color="#141414" roughness={0.8} />
      </mesh>
    </group>
  );
}

const CORD = 300; // runs up out of frame
const LIGHT = 45;

useGLTF.preload(URL);
