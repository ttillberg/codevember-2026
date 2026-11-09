import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

// The device: a ball modelled in Blender (model/device.blend), exported to public/device.glb. A graphite core
// with one principal eye looking along -z, a blue collar, two green ring pods on the sides, and round it four shell
// petals, the walls: hinged at the back, open they trail like fins, shut they close the ball with only the eye out.
// Eight blades round the eye are its shutter. Radius 1 in the file; scaled here.

export const DEVICE_URL = `${import.meta.env.BASE_URL}device.glb`;
useGLTF.preload(DEVICE_URL);

export type Device = {
  g: THREE.Group;
  /** 0 open (fins back) to 1 shut (the walls closed round the body). */
  shield: (k: number) => void;
  /** 0 open to 1 shut, the blades across the eye. */
  shutter: (k: number) => void;
};

/** A copy of the loaded model at `size` (its radius), with its hinges wired. Materials are shared between copies. */
export function device(model: THREE.Object3D, size: number): Device {
  const g = model.clone(true) as THREE.Group;
  g.scale.setScalar(size);
  // the rest pose in the file is open; the hinges turn in a fixed ratio from there (blender: leaf 95 -> 160, wall -55 -> 0)
  const walls = [0, 1, 2, 3].map((k) => { const w = g.getObjectByName(`wall_${k}`)!; return { o: w, rest: w.rotation.x }; });
  const leaves = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const l = g.getObjectByName(`leaf_${i}`)!; return { o: l, rest: l.rotation.y }; });
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m.transparent) m.depthWrite = false; // the glass
      o.frustumCulled = false;
    }
  });
  return {
    g,
    shield: (k) => { for (const w of walls) w.o.rotation.x = w.rest * (1 - k); },
    shutter: (k) => { for (const l of leaves) l.o.rotation.y = l.rest * (1 + (65 / 95) * k); },
  };
}
