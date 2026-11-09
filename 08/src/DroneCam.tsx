import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { drone, toCell, faceQuad } from './drone';
import { device, DEVICE_URL } from './device';

// The device's camera, in a corner of the page. It renders cell space: the cube the device is in, rigid, and the
// rooms continuing straight through its faces, as in a net. Nothing telescopes here; from inside, a tesseract is
// just rooms. The eye is a 180 degree fisheye: the room is drawn into a cube map from the eye and that is unwrapped
// with an equidistant lens, a right angle out to each side edge. Two views, swapped by a click on the frame: the
// eye itself, or a chase camera a little behind and above, with the device in the picture. Takes over the render
// loop: main scene first, then this one in a scissored viewport.

// square; the side matches the .cam rule in style.css exactly: max(120, min(clamp(220, 26vw, 360), 100vw - 48, 100vh - 150))
export const CAM = {
  w: () => Math.max(120, Math.min(Math.min(360, Math.max(220, innerWidth * 0.26)), innerWidth - 48, innerHeight - 150)),
  ratio: 1, right: 24, bottom: 72,
};

const SAND = '#d9b985', GRAPHITE = '#3a3a3d';
const R_STRUT = 0.075, R_NODE = 0.11;
const CUBE = 512; // the cube map's face size
const SIZE_CAM = 0.17; // the device's radius in cell space

type Edge = { index: number; row: number; through: boolean }; // through: the cube sits off along this row, so the edge runs the held axis

const FISHEYE = new THREE.ShaderMaterial({
  uniforms: { tCube: { value: null }, rot: { value: new THREE.Matrix3() }, aspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform samplerCube tCube; uniform mat3 rot; uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0; p.y /= aspect; // a right angle out to the side edge
      float r = length(p);
      float theta = r * 1.5707963;
      vec2 u = r > 1e-5 ? p / r : vec2(0.0);
      vec3 d = rot * vec3(sin(theta) * u, -cos(theta));
      vec4 col = textureCube(tCube, d);
      gl_FragColor = vec4(mix(col.rgb, vec3(0.708, 0.694, 0.658), smoothstep(1.0, 1.02, r)), 1.0); // a disc, the paper outside
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});

export function DroneCam() {
  const { gl, scene, camera, size } = useThree();
  const gltf = useGLTF(DEVICE_URL);
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
    const dev = device(gltf.scene, SIZE_CAM);
    cs.add(dev.g);
    const flash = faceQuad('#c9e35b');
    cs.add(flash.mesh);
    // the eye: a cube map rendered from where it is, unwrapped by the fisheye onto a quad that fills the frame
    const rt = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    const eye = new THREE.CubeCamera(0.03, 40, rt);
    cs.add(eye);
    FISHEYE.uniforms.tCube.value = rt.texture;
    const lens = new THREE.Scene();
    lens.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), FISHEYE));
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      cs, net, edges, struts, dev, flash, eye, lens, flat, sand, graphite,
      q: new THREE.Quaternion(), look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1,
      pos: new THREE.Vector3(), eyeAt: new THREE.Vector3(), heading: new THREE.Quaternion(),
    };
  }, [gltf]);

  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), camUp: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), tilt: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

  useFrame(() => {
    // the main picture. setViewport and setScissor take CSS pixels and apply the pixel ratio themselves.
    const W = size.width, H = size.height;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
    gl.render(scene, camera);

    // the device: where it is and where it is going, in cell space
    const c = toCell(drone.p);
    tmp.pos.set(c[0], c[1], c[2]);
    tmp.vel.set(c[0] - cell.last[0], c[1] - cell.last[1], c[2] - cell.last[2]);
    cell.last = c;
    // the look: the way it is going; at the controls, the way the eye points
    if (drone.pilot) cell.look.lerp(tmp.at.set(0, 0, -1).applyQuaternion(drone.q), 0.25).normalize();
    else if (tmp.vel.lengthSq() > 1e-8 && tmp.vel.lengthSq() < 0.25) cell.look.lerp(tmp.vel.normalize(), 0.08).normalize();
    // No gimbal lock: the view keeps its own up from the last frame, so looking straight up or down a room is just
    // another direction. It leans back towards the room's up only while the look is level, slowly.
    const { camUp } = tmp;
    camUp.set(0, 1, 0).applyQuaternion(cell.q);
    camUp.lerp(tmp.up, 0.04 * (1 - Math.abs(cell.look.y))).normalize();
    const follow = drone.view === 'follow';
    if (follow) {
      // a chase camera: behind, a little above and off to one side, eased; the device in three-quarter view
      tmp.axis.crossVectors(cell.look, camUp).normalize();
      tmp.at.copy(tmp.pos).addScaledVector(cell.look, -0.42).addScaledVector(camUp, 0.16).addScaledVector(tmp.axis, 0.3);
      if (cell.eyeAt.lengthSq() === 0) cell.eyeAt.copy(tmp.at);
      cell.eyeAt.lerp(tmp.at, 0.12);
      cell.pos.copy(cell.eyeAt);
      tmp.at.copy(tmp.pos).addScaledVector(cell.look, 0.4);
    } else {
      cell.eyeAt.set(0, 0, 0);
      cell.pos.copy(tmp.pos);
      tmp.at.copy(tmp.pos).add(cell.look);
    }
    tmp.m.lookAt(cell.pos, tmp.at, camUp);
    tmp.q.setFromRotationMatrix(tmp.m);
    cell.q.slerp(tmp.q, 0.2);
    cell.dev.g.visible = follow;
    cell.dev.shield(drone.shield); cell.dev.shutter(drone.shutter);
    if (follow) {
      cell.dev.g.position.copy(tmp.pos);
      tmp.m.lookAt(new THREE.Vector3(), cell.look, camUp); // the eye looks along -z
      tmp.q.setFromRotationMatrix(tmp.m);
      tmp.axis.crossVectors(camUp, cell.look);
      if (tmp.axis.lengthSq() > 1e-8) {
        tmp.tilt.setFromAxisAngle(tmp.axis.normalize(), 0.2);
        tmp.q.premultiply(tmp.tilt);
      }
      cell.heading.slerp(tmp.q, 0.1);
      cell.dev.g.quaternion.copy(cell.heading);
    }

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
    cell.flash.mat.opacity = 0.6 * drone.flash.a;

    // the eye: the room into the cube map, then the lens into the corner
    const w = Math.round(CAM.w()), h = Math.round(CAM.w() / CAM.ratio);
    cell.cs.environment = scene.environment;
    cell.eye.position.copy(cell.pos);
    cell.eye.update(gl, cell.cs);
    FISHEYE.uniforms.rot.value.setFromMatrix4(tmp.m.makeRotationFromQuaternion(cell.q));
    FISHEYE.uniforms.aspect.value = w / h;
    const x = W - CAM.right - w, y = CAM.bottom;
    gl.setScissorTest(true);
    gl.setScissor(x, y, w, h);
    gl.setViewport(x, y, w, h);
    gl.render(cell.lens, cell.flat);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
  }, 1);

  return null;
}
