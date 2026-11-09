import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { drone, toCell } from './drone';

// The drone's own camera, in a corner of the page. It renders cell space: the cube the drone is in, rigid, and the
// six neighbouring cubes continuing straight through its faces, as in a net. Nothing telescopes here; from inside,
// a tesseract is just rooms. Takes over the render loop: main scene first, then this one in a scissored viewport.

export const CAM = { w: () => Math.min(380, Math.max(240, innerWidth * 0.28)), ratio: 1.6, right: 24, bottom: 72 };

const SAND = '#d9b985', GRAPHITE = '#3a3a3d';
const R_STRUT = 0.075, R_NODE = 0.11;

type Edge = { mesh: THREE.Mesh; row: number; cube: number }; // cube -1 the centre, else the face row k*2 + (sign>0)

export function DroneCam() {
  const { gl, scene, camera, size } = useThree();
  const cell = useMemo(() => {
    const cs = new THREE.Scene();
    cs.background = new THREE.Color('#dad9d4');
    cs.add(new THREE.HemisphereLight('#ffffff', '#8a8780', 1.0));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(2, 5, 3);
    cs.add(sun);
    const sand = new THREE.MeshStandardMaterial({ color: SAND, roughness: 0.75 });
    const graphite = new THREE.MeshStandardMaterial({ color: GRAPHITE, roughness: 0.62 });
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55 });
    const cyl = new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 20);
    const sph = new THREE.SphereGeometry(R_NODE, 20, 14);
    const net = new THREE.Group();
    cs.add(net);
    const edges: Edge[] = [];
    /** A cube of edges and corners centred at c. Edge along row k, at the other two coords ±1. */
    const cube = (c: number[], id: number) => {
      for (let k = 0; k < 3; k++) {
        const [i, j] = [0, 1, 2].filter((r) => r !== k);
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const m = new THREE.Mesh(cyl, graphite);
          const pos = [0, 0, 0]; pos[i] = a; pos[j] = b;
          m.position.set(c[0] + pos[0], c[1] + pos[1], c[2] + pos[2]);
          if (k === 0) m.rotation.z = Math.PI / 2;
          if (k === 2) m.rotation.x = Math.PI / 2;
          net.add(m);
          edges.push({ mesh: m, row: k, cube: id });
        }
      }
      for (let n = 0; n < 8; n++) {
        const s = new THREE.Mesh(sph, black);
        s.position.set(c[0] + (n & 1 ? 1 : -1), c[1] + (n & 2 ? 1 : -1), c[2] + (n & 4 ? 1 : -1));
        net.add(s);
      }
    };
    cube([0, 0, 0], -1);
    for (let k = 0; k < 3; k++) for (const sgn of [-1, 1]) {
      const c = [0, 0, 0]; c[k] = 2 * sgn;
      cube(c, k * 2 + (sgn > 0 ? 1 : 0));
    }
    const cam = new THREE.PerspectiveCamera(95, CAM.ratio, 0.03, 40);
    return { cs, net, edges, cam, sand, graphite, look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1 };
  }, []);

  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), at: new THREE.Vector3() }), []);

  useFrame(() => {
    // the main picture. setViewport and setScissor take CSS pixels and apply the pixel ratio themselves.
    const W = size.width, H = size.height;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
    gl.render(scene, camera);

    if (document.body.classList.contains('clean')) return;

    // the drone's: where it is and where it is going, in cell space
    const c = toCell(drone.p);
    tmp.pos.set(c[0], c[1], c[2]);
    tmp.vel.set(c[0] - cell.last[0], c[1] - cell.last[1], c[2] - cell.last[2]);
    cell.last = c;
    if (tmp.vel.lengthSq() > 1e-8 && tmp.vel.lengthSq() < 0.25) cell.look.lerp(tmp.vel.normalize(), 0.08).normalize();
    cell.cam.position.copy(tmp.pos);
    cell.cam.up.set(0, 1, 0);
    cell.cam.lookAt(tmp.at.copy(tmp.pos).add(cell.look));

    if (cell.crossings !== drone.crossings) {
      cell.crossings = drone.crossings;
      cell.net.position.set(drone.centre[0], drone.centre[1], drone.centre[2]);
      // colour: an edge is sand if it runs along w in 4D. In the centre cube and the neighbours' side edges that is
      // the row's axis; a neighbour's edges through its face run along the axis the centre cube holds.
      for (const e of cell.edges) {
        const through = e.cube >= 0 && Math.floor(e.cube / 2) === e.row;
        const axis = through ? drone.held : drone.axisOf[e.row];
        e.mesh.material = axis === 3 ? cell.sand : cell.graphite;
      }
    }

    const w = Math.round(CAM.w()), h = Math.round(CAM.w() / CAM.ratio);
    const x = W - CAM.right - w, y = CAM.bottom;
    cell.cam.aspect = w / h;
    cell.cam.updateProjectionMatrix();
    cell.cs.environment = scene.environment;
    gl.setScissorTest(true);
    gl.setScissor(x, y, w, h);
    gl.setViewport(x, y, w, h);
    gl.render(cell.cs, cell.cam);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
  }, 1);

  return null;
}
