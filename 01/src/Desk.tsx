import { useMemo } from 'react';
import * as THREE from 'three';

// The desk: a green cutting mat with its grid, and one sun. Everything rests on it at y = 0.

const MAT = '#2b5546';

export function Desk() {
  const mat = useMemo(makeMat, []);
  return (
    <>
      <color attach="background" args={[MAT]} />
      <hemisphereLight args={['#fffaf2', '#5d7d70', 1.5]} />
      <directionalLight
        color="#fff3e2"
        intensity={2.1}
        position={[-160, 420, 260]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-170}
        shadow-camera-right={170}
        shadow-camera-top={170}
        shadow-camera-bottom={-170}
        shadow-camera-near={50}
        shadow-camera-far={1200}
        shadow-bias={-0.0004}
        shadow-normalBias={0.08}
        shadow-radius={4}
      />
      <primitive object={mat} />
    </>
  );
}

// cutting mat: green, a 10 mm grid, every 50 mm a stronger line
function makeMat() {
  const px = 512;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = MAT;
  g.fillRect(0, 0, px, px);
  const step = px / 5;
  g.strokeStyle = 'rgba(160, 205, 185, 0.32)';
  g.lineWidth = 1.5;
  for (let i = 1; i < 5; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, px); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(px, i * step); g.stroke();
  }
  g.strokeStyle = 'rgba(175, 220, 200, 0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, px, px);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const size = 3000;
  tex.repeat.set(size / 50, size / 50);
  tex.anisotropy = 8;
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.receiveShadow = true;
  return mat;
}
