import * as THREE from 'three';

// A camera-facing colour board. It is deliberately unlit and does not belong
// to the environment map, so the vermilion background cannot tint the bird.
const RED = 0x8e2f2b;

export function createBackdrop() {
  const material = new THREE.MeshBasicMaterial({
    color: RED,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = 'red-background-board';
  mesh.frustumCulled = false;
  // Draw first, then let the bird, branch and lights render over the board.
  mesh.renderOrder = -1000;
  return { mesh, material };
}
