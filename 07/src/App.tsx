import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { Balloon } from './Balloon';
import { Shadow } from './Shadow';
import { Panel } from './Panel';
import { Snapshot } from './snapshot';
import { backgroundNode, envIntensity } from './theme';
import { useFrame } from '@react-three/fiber';
import { studioTexture } from './env';
import { useMemo } from 'react';

// The room's reflections follow the theme.
function Env() {
  useFrame(({ scene }) => { scene.environmentIntensity = envIntensity(); });
  return null;
}

export function App() {
  const studio = useMemo(studioTexture, []);
  return (
    <>
      <Canvas
        camera={{ position: [0, 1.55, 6.7], fov: 32 }}
        gl={async (props) => {
          const renderer = new WebGPURenderer({ ...(props as any), antialias: true });
          await renderer.init();
          return renderer;
        }}
      >
        <primitive attach="backgroundNode" object={backgroundNode} />
        <primitive attach="environment" object={studio} />
        <directionalLight position={[3, 5, 4]} intensity={1.2} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#cfd8ff" />
        <Balloon />
        <Shadow />
        <Snapshot />
        <Env />
      </Canvas>
      <div id="reticle" className="reticle" />
      <Panel />
    </>
  );
}
