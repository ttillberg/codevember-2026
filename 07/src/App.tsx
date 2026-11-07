import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { Balloon } from './Balloon';
import { Palette } from './Palette';
import { makeStudio } from './env';
import { useMemo } from 'react';

export function App() {
  const studio = useMemo(makeStudio, []);
  return (
    <>
      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 40 }}
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
      </Canvas>
      <div id="reticle" className="reticle" />
      <p className="hint">the balloon turns on its own, move to lean it, hold to paint</p>
      <Palette />
    </>
  );
}
