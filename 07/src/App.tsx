import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { Balloon } from './Balloon';
import { Shadow } from './Shadow';
import { Panel } from './Panel';
import { Snapshot } from './snapshot';
import { makeStudio } from './env';
import { useMemo } from 'react';

export function App() {
  const studio = useMemo(makeStudio, []);
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
        <color attach="background" args={['#e9e6e0']} />
        <primitive attach="environment" object={studio} />
        <directionalLight position={[3, 5, 4]} intensity={1.2} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#cfd8ff" />
        <Balloon />
        <Shadow />
        <Snapshot />
      </Canvas>
      <div id="reticle" className="reticle" />
      <Panel />
    </>
  );
}
