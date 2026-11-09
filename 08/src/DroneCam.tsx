import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { drone, target, toCell, toCellWith, faceQuad, pieceMesh, PIECE_R, SIZE_MAIN, SIZE_CELL } from './drone';
import { ringOut } from './device';
import { SAND, GRAPHITE } from './decals';

// The device's camera, in a corner of the page. It renders cell space: the cube the device is in, rigid, and the
// rooms continuing straight through its faces, as in a net. Nothing telescopes here; from inside, a tesseract is
// just rooms. The eye is a 180 degree fisheye: the room is drawn into a cube map from the eye and that is unwrapped
// with an equidistant lens, a right angle out to each side edge. Takes over the render loop: main scene first, then
// this one in a scissored viewport.

// the corner, square; the side matches the .cam rule in style.css exactly: max(120, min(clamp(220, 26vw, 360), 100vw - 48, 100vh - 150))
const CAM = {
  w: () => Math.max(120, Math.min(Math.min(360, Math.max(220, innerWidth * 0.26)), innerWidth - 48, innerHeight - 150)),
  right: 24, bottom: 72,
};
const LOCK_RANGE = 1.1; // cell units from the piece within which the lock bracket shows, at the controls

const R_STRUT = 0.075, R_NODE = 0.11;
const CUBE = 512; // the cube map's face size
const PIECE_K = SIZE_CELL / SIZE_MAIN; // the piece scaled with the device

type Edge = { index: number; row: number; through: boolean }; // through: the cube sits off along this row, so the edge runs the held axis

const FISHEYE = new THREE.ShaderMaterial({
  uniforms: { tCube: { value: null }, rot: { value: new THREE.Matrix3() } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform samplerCube tCube; uniform mat3 rot;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0; // a right angle out to the side edge
      float r = length(p);
      float theta = r * 1.5707963;
      vec2 u = r > 1e-5 ? p / r : vec2(0.0);
      vec3 d = rot * vec3(sin(theta) * u, -cos(theta));
      vec4 col = textureCube(tCube, d);
      gl_FragColor = vec4(col.rgb, 1.0 - smoothstep(0.995, 1.005, r)); // a disc; outside it the page shows through
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, transparent: true,
});

export function DroneCam() {
  const { gl, scene, camera, size } = useThree();
  const cell = useMemo(() => {
    const cs = new THREE.Scene();
    cs.background = new THREE.Color('#ebebe8'); // the page's paper
    cs.fog = new THREE.Fog('#ebebe8', 1.6, 5.2); // clear through this room, the fog sets in from the next one and the rooms beyond fade into the paper
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
    // neighbouring cubes share their corners and edges: each is drawn once
    const edges: Edge[] = [];
    const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 20), paint, offsets.length * 12);
    const nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE, 20, 14), black, offsets.length * 8);
    struts.frustumCulled = nodes.frustumCulled = false;
    const dummy = new THREE.Object3D(), seen = new Set<string>();
    let e = 0, nn = 0;
    for (const o of offsets) {
      const c = [o[0] * 2, o[1] * 2, o[2] * 2];
      for (let k = 0; k < 3; k++) {
        const [i, j] = [0, 1, 2].filter((r) => r !== k);
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const pos = [0, 0, 0]; pos[i] = a; pos[j] = b;
          dummy.position.set(c[0] + pos[0], c[1] + pos[1], c[2] + pos[2]);
          const key = `e${dummy.position.toArray()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dummy.rotation.set(k === 2 ? Math.PI / 2 : 0, 0, k === 0 ? Math.PI / 2 : 0);
          dummy.updateMatrix();
          struts.setMatrixAt(e, dummy.matrix);
          edges.push({ index: e++, row: k, through: o[k] !== 0 });
        }
      }
      for (let n = 0; n < 8; n++) {
        dummy.position.set(c[0] + (n & 1 ? 1 : -1), c[1] + (n & 2 ? 1 : -1), c[2] + (n & 4 ? 1 : -1));
        const key = `n${dummy.position.toArray()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        nodes.setMatrixAt(nn++, dummy.matrix);
      }
    }
    struts.count = e; nodes.count = nn;
    const net = new THREE.Group();
    net.add(struts, nodes);
    cs.add(net);
    const sand = new THREE.Color(SAND), graphite = new THREE.Color(GRAPHITE);
    const flash = faceQuad();
    cs.add(flash.mesh);
    const piece = pieceMesh(PIECE_K, false); // as big against the device here as in the main picture, and out of the fog
    piece.visible = false;
    cs.add(piece);
    const grabbed = pieceMesh(PIECE_K, false);
    grabbed.visible = false;
    cs.add(grabbed);
    // the eye: a cube map rendered from where it is, unwrapped by the fisheye onto a quad that fills the frame
    const rt = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    const eye = new THREE.CubeCamera(0.03, 40, rt);
    cs.add(eye);
    FISHEYE.uniforms.tCube.value = rt.texture;
    const lens = new THREE.Scene();
    lens.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), FISHEYE));
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      cs, net, edges, struts, flash, piece, grabbed, eye, lens, flat, sand, graphite,
      q: new THREE.Quaternion(), look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1,
      pos: new THREE.Vector3(), lockEl: null as HTMLElement | null,
    };
  }, []);

  const tmp = useMemo(() => ({ vel: new THREE.Vector3(), ring: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), camUp: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

  useFrame(() => {
    // setViewport and setScissor take CSS pixels and apply the pixel ratio themselves
    const W = size.width, H = size.height;
    const w = Math.round(CAM.w()), h = w, x = W - CAM.right - w, y = CAM.bottom;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
    gl.render(scene, camera);

    // the device: where it is and where it is going, in cell space
    const c = toCell(drone.p);
    cell.pos.fromArray(c);
    tmp.vel.set(c[0] - cell.last[0], c[1] - cell.last[1], c[2] - cell.last[2]);
    cell.last = c;
    // the look: the way it is going; at the controls, the way the eye points
    if (drone.pilot) cell.look.lerp(tmp.at.set(0, 0, -1).applyQuaternion(drone.q), 0.25).normalize();
    else if (tmp.vel.lengthSq() > 1e-8 && tmp.vel.lengthSq() < 0.25) cell.look.lerp(tmp.vel.normalize(), 0.08).normalize();
    // No gimbal lock: the view keeps its own up from the last frame, so looking straight up or down a room is just
    // another direction. It leans back towards the room's up only while the look is level, slowly.
    const { camUp } = tmp;
    camUp.set(0, 1, 0).applyQuaternion(cell.q);
    // at the controls the view's up is the eye's own, so a drag in the view turns the way it is dragged
    if (drone.pilot) camUp.lerp(tmp.axis.set(0, 1, 0).applyQuaternion(drone.q), 0.25).normalize();
    else camUp.lerp(tmp.up, 0.04 * (1 - Math.abs(cell.look.y))).normalize();
    tmp.at.copy(cell.pos).add(cell.look);
    tmp.m.lookAt(cell.pos, tmp.at, camUp);
    tmp.q.setFromRotationMatrix(tmp.m);
    cell.q.slerp(tmp.q, 0.2);
    // the grip reaches the piece in cell space too: its distance here over the device's size here, for the taken piece
    let at = drone.gripAt;
    if (target.up && target.map) { const t3 = toCellWith(target.map, target.p); at = tmp.at.fromArray(t3).distanceTo(cell.pos) / SIZE_CELL; }

    if (cell.crossings !== drone.crossings) {
      cell.crossings = drone.crossings;
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
    const f3 = toCell(drone.flash.p4);
    cell.flash.pulse(tmp.at.set(f3[0], f3[1], f3[2]), Math.SQRT2, drone.flash.t, drone.flash.color);
    // the piece, in its own cell's room of the net
    cell.piece.visible = target.up && target.scale > 0.02 && !!target.map;
    if (cell.piece.visible) {
      const c3 = toCellWith(target.map!, target.p);
      cell.piece.position.set(c3[0], c3[1], c3[2]);
      cell.piece.scale.setScalar(target.scale);
      cell.piece.rotation.y += 0.013; cell.piece.rotation.z = 0.5;
    }
    // the one just taken, in the ring in front of the eye, riding in
    cell.grabbed.visible = drone.taken > 0.02 && !!drone.grabMap;
    if (cell.grabbed.visible) {
      const fwd = tmp.at.set(0, 0, -1).applyQuaternion(drone.q);
      const ring = tmp.ring.copy(cell.pos).addScaledVector(fwd, ringOut(drone.grip, at) * SIZE_CELL);
      const g3 = toCellWith(drone.grabMap!, drone.grab4);
      cell.grabbed.position.set(g3[0], g3[1], g3[2]).lerp(ring, drone.grabK);
      cell.grabbed.scale.setScalar(drone.taken);
    }

    // the lock: at the controls, the piece in this cell and close, a bracket round it in the view, LOCK while
    // closing in and LOCKED once the catch has taken over. The piece's place in the view is the fisheye's own map:
    // its direction in the eye's frame, the angle off the axis as the radius, the lens then stretched by the aspect
    const lockEl = (cell.lockEl ??= document.getElementById('lock'));
    if (lockEl) {
      let show = false;
      if (drone.pilot && target.up && target.map && target.map.held === drone.held && target.map.sign === drone.sign) {
        const t3 = toCell(target.p), d = tmp.axis.set(t3[0] - c[0], t3[1] - c[1], t3[2] - c[2]), dist = d.length();
        if (dist < LOCK_RANGE && dist > 1e-6) {
          d.divideScalar(dist).applyQuaternion(tmp.q.copy(cell.q).invert());
          const theta = Math.acos(Math.max(-1, Math.min(1, -d.z))), r = theta / (Math.PI / 2), l = Math.hypot(d.x, d.y) || 1;
          if (r < 1.02) {
            const vw = w, vh = h, vx = x, vtop = H - y - h; // the corner, in CSS pixels from the top left
            const px = vx + ((r * d.x / l) + 1) / 2 * vw, py = vtop + (1 - (r * d.y / l)) / 2 * vh;
            const ballPx = ((PIECE_R * PIECE_K) / dist / (Math.PI / 2)) * (vw / 2);
            const size = Math.max(28, ballPx * 3.4) * (drone.docking ? 0.62 : 1);
            lockEl.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
            lockEl.style.width = lockEl.style.height = `${size.toFixed(1)}px`;
            lockEl.classList.toggle('on', drone.docking);
            show = true;
          }
        }
      }
      lockEl.style.display = show ? 'block' : 'none';
    }

    // the eye: the room into the cube map, then the lens onto the page
    cell.cs.environment = scene.environment;
    cell.eye.position.copy(cell.pos);
    cell.eye.update(gl, cell.cs);
    FISHEYE.uniforms.rot.value.setFromMatrix4(tmp.m.makeRotationFromQuaternion(cell.q));
    gl.setScissorTest(true);
    gl.setScissor(x, y, w, h);
    gl.setViewport(x, y, w, h);
    gl.render(cell.lens, cell.flat);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
  }, 1);

  return null;
}
