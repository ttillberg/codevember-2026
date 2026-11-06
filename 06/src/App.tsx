import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { Mesh, Vector3 } from 'three';
import { clock } from './clock';
import { elementsAt, orbitPath, planetRadius, position, sunRadius, toScene, type Scale } from './kepler';
import { PLANETS, type Planet } from './planets';

const MODE: Scale = 'sqrt';
const J2000 = 2451545;

// Mounted first, so it advances time before any planet reads it.
function Tick() {
  useFrame((_, dt) => {
    if (!clock.paused) clock.jd += clock.speed * Math.min(dt, 0.1);
  });
  return null;
}

function Body({ p }: { p: Planet }) {
  const ref = useRef<Mesh>(null!);
  const path = useMemo(() => orbitPath(elementsAt(p.el, p.rate, J2000)).map((v) => toScene(v, MODE)), [p]);
  const loop = useMemo(() => [...path, path[0]], [path]);
  const tmp = useMemo(() => new Vector3(), []);
  useFrame(() => {
    position(elementsAt(p.el, p.rate, clock.jd), tmp);
    ref.current.position.copy(toScene(tmp, MODE));
  });
  return (
    <>
      <Line points={loop} color="#555" lineWidth={1} />
      <mesh ref={ref}>
        <sphereGeometry args={[planetRadius(p, MODE), 32, 16]} />
        <meshStandardMaterial color="#ccc" />
      </mesh>
    </>
  );
}

export function App() {
  return (
    <Canvas camera={{ position: [0, 30, 100], fov: 40, near: 0.1, far: 800 }} dpr={[1, 2]}>
      <color attach="background" args={['#07080b']} />
      <Tick />
      <mesh>
        <sphereGeometry args={[sunRadius(MODE), 48, 24]} />
        <meshBasicMaterial color="#ffd2a0" />
      </mesh>
      <pointLight intensity={2000} decay={2} color="#fff1e0" />
      <ambientLight intensity={0.15} />
      {PLANETS.map((p) => (
        <Body key={p.name} p={p} />
      ))}
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  );
}
