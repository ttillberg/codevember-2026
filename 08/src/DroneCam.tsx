import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { drone, toCell, faceQuad, roomAt, toRoom, type CellMap } from './drone';
import { quad } from './Drones';
import { beamHits, BEAMS } from './Laser';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

// The drone's camera, in a corner of the page. It renders cell space: the cube the drone is in, rigid, and the six
// neighbouring cubes continuing straight through its faces, as in a net. Nothing telescopes here; from inside, a
// tesseract is just rooms. Two views, swapped by a click on the frame: the drone's own eyes, or a chase camera a
// little behind and above it, with the quad in the picture. Takes over the render loop: main scene first, then this
// one in a scissored viewport.

export const CAM = { w: () => Math.min(380, Math.max(240, innerWidth * 0.28)), ratio: 1.6, right: 24, bottom: 72 };

const SAND = '#d9b985', GRAPHITE = '#3a3a3d';
const R_STRUT = 0.075, R_NODE = 0.11;

type Edge = { index: number; row: number; through: boolean }; // through: the cube sits off along this row, so the edge runs the held axis

export function DroneCam() {
  const { gl, scene, camera, size } = useThree();
  const cell = useMemo(() => {
    const cs = new THREE.Scene();
    cs.background = new THREE.Color('#dad9d4');
    cs.fog = new THREE.FogExp2('#dad9d4', 0.5); // the rooms beyond fade into the paper
    cs.add(new THREE.HemisphereLight('#ffffff', '#8a8780', 1.0));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(2, 5, 3);
    cs.add(sun);
    // the rooms: a box of 5 × 5 × 5 cubes round this one. When the net recentres on a new room the only cubes born
    // are a whole slab on the far side, four units out at the least, already in the fog; nothing pops in nearby.
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55 });
    const offsets: number[][] = [];
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) offsets.push([x, y, z]);
    const edges: Edge[] = [];
    const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 20), paint, offsets.length * 12);
    const nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE, 20, 14), black, offsets.length * 8);
    struts.frustumCulled = nodes.frustumCulled = false;
    const dummy = new THREE.Object3D();
    let e = 0, nn = 0;
    for (const o of offsets) {
      const c = [o[0] * 2, o[1] * 2, o[2] * 2];
      for (let k = 0; k < 3; k++) {
        const [i, j] = [0, 1, 2].filter((r) => r !== k);
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const pos = [0, 0, 0]; pos[i] = a; pos[j] = b;
          dummy.position.set(c[0] + pos[0], c[1] + pos[1], c[2] + pos[2]);
          dummy.rotation.set(k === 2 ? Math.PI / 2 : 0, 0, k === 0 ? Math.PI / 2 : 0);
          dummy.updateMatrix();
          struts.setMatrixAt(e, dummy.matrix);
          edges.push({ index: e++, row: k, through: o[k] !== 0 });
        }
      }
      for (let n = 0; n < 8; n++) {
        dummy.position.set(c[0] + (n & 1 ? 1 : -1), c[1] + (n & 2 ? 1 : -1), c[2] + (n & 4 ? 1 : -1));
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        nodes.setMatrixAt(nn++, dummy.matrix);
      }
    }
    const net = new THREE.Group();
    net.add(struts, nodes);
    cs.add(net);
    const sand = new THREE.Color(SAND), graphite = new THREE.Color(GRAPHITE);
    const cam = new THREE.PerspectiveCamera(95, CAM.ratio, 0.03, 40);
    const q = quad(0.14);
    cs.add(q.g);
    const flash = faceQuad('#c9e35b');
    cs.add(flash.mesh);
    // the lasers where they cross this room and the rooms round it, two walls out: each room's cell has its own map,
    // the hits on that cell's walls go through it and are joined. All rooms in one set of segments per beam and layer.
    const rooms: number[][] = [];
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
      if (Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) rooms.push([x, y, z]);
    }
    const beams = BEAMS.map(() => [{ w: 1, o: 0.75, core: true }, { w: 3, o: 0.22, core: false }, { w: 8, o: 0.07, core: false }].map((l) => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions([0, 0, 0, 0, 0, 0]);
      geo.setColors([1, 1, 1, 1, 1, 1]);
      const mat = new LineMaterial({ linewidth: l.w, vertexColors: true, toneMapped: false, transparent: true, opacity: l.o, depthWrite: false, fog: true });
      const line = new LineSegments2(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      cs.add(line);
      return { line, geo, mat, core: l.core };
    }));
    return { cs, net, edges, struts, cam, q, flash, beams, rooms, maps: [] as CellMap[], sand, graphite, look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1, eye: new THREE.Vector3(), spin: 0, heading: new THREE.Quaternion() };
  }, []);

  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

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
    cell.cam.up.set(0, 1, 0);
    const follow = drone.view === 'follow';
    if (follow) {
      // a chase camera: behind and a little above, eased; the quad in frame, nosing along its way
      tmp.at.copy(tmp.pos).addScaledVector(cell.look, -0.42).addScaledVector(tmp.up, 0.16);
      if (cell.eye.lengthSq() === 0) cell.eye.copy(tmp.at);
      cell.eye.lerp(tmp.at, 0.12);
      cell.cam.position.copy(cell.eye);
      cell.cam.lookAt(tmp.at.copy(tmp.pos).addScaledVector(cell.look, 0.4));
    } else {
      cell.eye.set(0, 0, 0);
      cell.cam.position.copy(tmp.pos);
      cell.cam.lookAt(tmp.at.copy(tmp.pos).add(cell.look));
    }
    cell.q.g.visible = follow;
    if (follow) {
      cell.q.g.position.copy(tmp.pos);
      tmp.m.lookAt(new THREE.Vector3(), tmp.at.copy(cell.look).negate(), tmp.up);
      tmp.q.setFromRotationMatrix(tmp.m);
      tmp.axis.crossVectors(tmp.up, cell.look).normalize();
      tmp.tilt.setFromAxisAngle(tmp.axis, 0.25);
      tmp.q.premultiply(tmp.tilt);
      cell.heading.slerp(tmp.q, 0.1);
      cell.q.g.quaternion.copy(cell.heading);
      cell.spin += 0.9;
      cell.q.rotors.forEach((r, i) => { r.rotation.y = cell.spin * (i % 2 ? 1 : -1); });
    }

    if (cell.crossings !== drone.crossings) {
      cell.crossings = drone.crossings;
      cell.maps = cell.rooms.map((o) => roomAt(o));
      cell.net.position.set(drone.centre[0], drone.centre[1], drone.centre[2]);
      // colour: an edge is sand if it runs along w in 4D. In the centre cube and the neighbours' side edges that is
      // the row's axis; a neighbour's edges through its face run along the axis the centre cube holds.
      for (const e of cell.edges) {
        const axis = e.through ? drone.held : drone.axisOf[e.row];
        cell.struts.setColorAt(e.index, axis === 3 ? cell.sand : cell.graphite);
      }
      if (cell.struts.instanceColor) cell.struts.instanceColor.needsUpdate = true;
    }

    drone.flash.corners.forEach((c4, i) => { const c3 = toCell(c4); cell.flash.set(i, tmp.at.set(c3[0], c3[1], c3[2])); });
    cell.flash.done();
    cell.flash.mat.opacity = 0.6 * drone.flash.a;

    // each laser's hits on each room's walls, joined in order along the beam, as segments
    const w = Math.round(CAM.w()), h = Math.round(CAM.w() / CAM.ratio);
    const paper = cell.cs.background as THREE.Color, col = new THREE.Color();
    BEAMS.forEach((b, bi) => {
      const layers = cell.beams[bi];
      for (const l of layers) l.mat.resolution.set(w, h);
      const pts: number[] = [], cols: number[] = [], cores: number[] = [];
      for (const room of cell.maps) {
        const mine = beamHits[bi].filter((x) => (x.i === room.held && x.si === room.sign) || (x.j === room.held && x.sj === room.sign));
        for (let n = 1; n < mine.length; n++) for (const x of [mine[n - 1], mine[n]]) {
          const c3 = toRoom(room, x.p4);
          pts.push(c3[0], c3[1], c3[2]);
          col.copy(paper).lerp(b.tint, x.k); cols.push(col.r, col.g, col.b);
          col.copy(paper).lerp(b.core, x.k); cores.push(col.r, col.g, col.b);
        }
      }
      if (pts.length < 6) { for (const l of layers) l.line.visible = false; return; }
      for (const l of layers) {
        l.geo.setPositions(pts); l.geo.setColors(l.core ? cores : cols); l.line.computeLineDistances(); l.line.visible = true;
      }
    });
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
