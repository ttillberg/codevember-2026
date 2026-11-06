import { Suspense, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { PCFShadowMap, Vector3 } from 'three';
import { bodies, clock, tilts } from './clock';
import { deckHeight, ringPath } from './layout';
import type { Scale } from './kepler';
import { Chains } from './Chains';
import { Floor } from './Floor';
import { Hud } from './Hud';
import { Labels } from './Labels';
import { Planet } from './Planet';
import { PLANETS } from './planets';
import { Sun } from './Sun';
import type { View } from './views';

// Mounted first, so it advances time before any planet reads it.
function Tick() {
  useFrame((_, dt) => {
    if (!clock.paused) clock.jd += clock.speed * Math.min(dt, 0.1);
  });
  return null;
}

// Dev only: lets a script point the camera at a body, window.__look('Jupiter', 4), and inspect the state.
function DevHooks() {
  const { camera, controls } = useThree();
  if (import.meta.env.DEV) {
    (window as any).__look = (name: string, dist = 4) => {
      const b = bodies.get(name);
      const c = controls as any;
      if (!b || !c) return;
      c.target.copy(b);
      camera.position.set(b.x, b.y + dist * 0.5, b.z + dist);
      c.update();
    };
    (window as any).__orrery = { bodies, tilts, ringPath, deckHeight, PLANETS };
  }
  return null;
}

const ISO = new Vector3(1, 1, 1).normalize().multiplyScalar(300); // 45 deg round, 35.26 deg up
const FRAME_HEIGHT = 75; // world units the orthographic views fit vertically

// Perspective for looking around; orthographic front and isometric for checking the rings' tilt angles.
function Cameras({ view }: { view: View }) {
  const { size } = useThree();
  if (view === 'persp') return <PerspectiveCamera makeDefault position={[0, 30, 100]} fov={40} near={0.1} far={800} />;
  return (
    <OrthographicCamera
      makeDefault
      position={view === 'front' ? [0, 0, 300] : ISO.toArray()}
      zoom={size.height / FRAME_HEIGHT}
      near={-1000}
      far={2000}
    />
  );
}

export function App() {
  const [labels, setLabels] = useState(false); // L toggles
  const [mode, setMode] = useState<Scale>('sqrt');
  const [view, setView] = useState<View>('persp'); // O cycles
  return (
    <>
      <Canvas shadows={{ type: PCFShadowMap }} dpr={[1, 2]}>
        <Cameras view={view} />
        <color attach="background" args={['#07080b']} />
        <Tick />
        <DevHooks />
        {/* No ambient, no environment: the bulb is the only light in the room. */}
        <Floor mode={mode} />
        <Suspense fallback={null}>
          <Sun mode={mode} />
        </Suspense>
        {PLANETS.map((p) => (
          <Planet key={p.name} p={p} mode={mode} />
        ))}
        {/* After the planets, so it reads this frame's tilts. */}
        <Chains mode={mode} />
        <Labels visible={labels} />
        <OrbitControls key={view} target={[0, 0, 0]} enableDamping makeDefault minDistance={0.001} maxDistance={260} />
        {/* Only the filament is brighter than 1, so only it blooms. */}
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={1.2} radius={0.7} />
          <ToneMapping mode={ToneMappingMode.AGX} />
        </EffectComposer>
      </Canvas>
      <Hud labels={labels} setLabels={setLabels} mode={mode} setMode={setMode} view={view} setView={setView} />
    </>
  );
}
