import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { threeMark, pmndrsMark, githubMark, scratches } from './decals';

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

// Marks on the body. The meshes in the file have no UVs, so these are decals: a patch of the body's own triangles, cut
// and projected onto a transparent canvas, a child of the mesh it sits on (so a hinged petal carries its own).
const INK = '#d8d8d4';
const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const rngOf = (seed: number) => { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); };
const decalMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({
  map, transparent: true, depthTest: true, depthWrite: false, roughness: 0.6, metalness: 0.05,
  polygonOffset: true, polygonOffsetFactor: -4,
});

let marks: { three: THREE.Material; pmndrs: THREE.Material; serial: THREE.Material; github: THREE.Material; scuff: THREE.Material[] } | null = null;
function makeMarks() {
  const three = decalMat(canvasTex(256, 256, (g) => { g.strokeStyle = INK; g.lineWidth = 5; g.globalAlpha = 0.85; threeMark(g, 128, 130, 200); }));
  const pmndrs = decalMat(canvasTex(256, 256, (g) => { g.globalAlpha = 0.85; pmndrsMark(g, 36, 36, 184, INK); }));
  const serial = decalMat(canvasTex(512, 64, (g) => {
    g.fillStyle = INK; g.globalAlpha = 0.8;
    g.font = '700 30px Menlo, "Courier New", monospace';
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText('CDVMBR 08 · UNIT 01', 256, 34);
  }));
  const github = decalMat(canvasTex(128, 128, (g) => { g.globalAlpha = 0.8; githubMark(g, 32, 32, 64, INK); }));
  const scuff = [11, 29, 47, 63, 83].map((seed) => decalMat(canvasTex(256, 256, (g) => {
    scratches(g, rngOf(seed), 256, 256, 9, '#e6e6e0', '#000000', 0.5);
  })));
  return { three, pmndrs, serial, github, scuff };
}

const _o = new THREE.Object3D();
/** A decal of `w` x `h` model units on `mesh`, centred on world point p with the surface normal n; "up" on the texture points to -z. */
function stick(mesh: THREE.Mesh, mat: THREE.Material, p: THREE.Vector3, n: THREE.Vector3, w: number, h: number, roll = 0) {
  _o.position.copy(p);
  _o.up.set(0, 0, -1);
  if (Math.abs(n.z) > 0.9) _o.up.set(0, 1, 0);
  _o.lookAt(p.clone().add(n)); // +z along the normal: the texture reads right from outside
  _o.rotateZ(roll);
  const geo = new DecalGeometry(mesh, p, _o.rotation, new THREE.Vector3(w, h, 0.3));
  geo.applyMatrix4(mesh.matrixWorld.clone().invert()); // the decal comes out in world space; hang it on the mesh
  const d = new THREE.Mesh(geo, mat);
  d.frustumCulled = false;
  d.renderOrder = 2;
  mesh.add(d);
}

/** A point of the mesh's outer skin, found by a ray from outside to the middle of its box. */
function skin(mesh: THREE.Mesh, at = 0) {
  const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const dir = c.clone().normalize();
  if (at) dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize(), at);
  const ray = new THREE.Raycaster(dir.clone().multiplyScalar(4).add(c.clone().multiplyScalar(0)), dir.clone().negate());
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit || !hit.face) return null;
  const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  return { p: hit.point, n };
}

function dress(g: THREE.Group) {
  g.updateMatrixWorld(true);
  marks ??= makeMarks();
  const m = marks;
  const core = g.getObjectByName('core') as THREE.Mesh;
  const onCore = (dir: [number, number, number], mat: THREE.Material, w: number, h: number, roll = 0) => {
    const n = new THREE.Vector3(...dir).normalize();
    stick(core, mat, n.clone().multiplyScalar(0.7), n, w, h, roll);
  };
  onCore([0.45, 0.85, -0.45], m.three, 0.26, 0.26);
  onCore([-0.45, 0.85, -0.45], m.pmndrs, 0.2, 0.2);
  onCore([0, -0.85, -0.5], m.serial, 0.5, 0.0625);
  onCore([0.6, -0.3, 0.7], m.scuff[4], 0.7, 0.7, 0.5);
  [0, 1, 2, 3].forEach((k) => {
    const wall = g.getObjectByName(`wall_${k}`) as THREE.Mesh;
    const hit = skin(wall);
    if (!hit) return;
    stick(wall, m.scuff[k], hit.p, hit.n, 0.9, 0.9, k * 1.1);
    if (k === 0) {
      const h2 = skin(wall, 0.25);
      if (h2) stick(wall, m.github, h2.p, h2.n, 0.1, 0.1);
    }
  });
}

/** A copy of the loaded model at `size` (its radius), with its hinges wired. Materials are shared between copies. */
export function device(model: THREE.Object3D, size: number): Device {
  const g = model.clone(true) as THREE.Group;
  dress(g);
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
