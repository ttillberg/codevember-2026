import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { renderDof } from './dof';
import * as THREE from 'three';
import { drone, target, toCell, toCellWith, faceQuad, PIECE_R, SIZE_MAIN, SIZE_CELL, LOCK_RANGE } from './drone';
import { ringOut } from './device';
import { GRAPHITE } from './decals';
import { st } from './state';

// The device's camera, the whole page behind the machine. It renders cell space: the cube the device is in, rigid,
// and the rooms continuing straight through its faces, as in a net. Nothing telescopes here; from inside, a
// tesseract is just rooms, drawn as outlined tubes. The eye is a 180 degree fisheye: the room is drawn into a cube
// map from the eye and that is unwrapped with an equidistant lens. Takes over the render loop: the lens first, then
// the main scene over it through the depth of field.

// the eye's panel: the whole page behind the machine, fading in from nothing at the left edge to full at the right, and
// even full only at `strength`, so it sits back as a ground (it was the right third, fading over its left part, at
// full strength; a full-page view with the machine moved right was tried before that and dropped)
const STRENGTH = 0.4;
/** The first person view's switch: maximized, the whole page behind the machine as above; not (to start), the window
 * split in two, the machine in one half and the view in the other, at full strength, no fade (a square in the left
 * column, a square top right and a strip down the right side before). */
export const eyeView = { max: false };
/** The split: with the probe in and its view shown, not maximized, 'side', the machine and the view side by side; on a
 * phone held upright, 'stack', the machine over the view; otherwise none. */
export function splitOf(W: number, H: number): 'side' | 'stack' | null {
  if (!eyeShown(W, H) || eyeView.max) return null;
  return W <= 640 && H > W ? 'stack' : 'side';
}
/** The view at all: the probe in and the view not hidden; on a phone only at the controls, orbit and follow having
 * the whole screen for the machine. */
export function eyeShown(W: number, H: number) {
  return drone.on && st.grid && (drone.pilot || !(W <= 640 || H <= 500));
}
/** What the page tells the layout: under ?clean there is no text; textBottom, the text's foot, measured each frame. */
export const page = { clean: false, textBottom: 0 };
type Rect = { x: number; y: number; w: number; h: number; round?: boolean }; // CSS px, from the top left; round, a disc in the square
/** Where the machine goes and where the view goes. The machine never under the text: beside the text column, or under
 * it on an upright phone; split, the room left over halved between the machine and the view (the view off, or
 * maximized behind it all, the machine has all of it). */
export function regionsOf(W: number, H: number): { main: Rect; cam: Rect | null; aim?: { x: number; y: number } } {
  const split = splitOf(W, H), upright = W <= 640 && H > W;
  // a phone: the machine has all the room under (or beside) the text, and the view is a little disc over it, bottom
  // middle upright, bottom right on its side; the machine aimed off its middle, a third of the way down (or across),
  // so the disc never hides the probe (the room was halved between the two, for a while)
  if (upright) {
    const top = page.clean ? 0 : Math.min(H * 0.45, page.textBottom + 8);
    const main = { x: 0, y: top, w: W, h: H - top };
    if (!split) return { main, cam: null };
    const d = Math.round(Math.min(260, Math.max(160, W * 0.6)));
    return { main, cam: { x: Math.round((W - d) / 2), y: H - PIP_GAP - d, w: d, h: d, round: true }, aim: { x: W / 2, y: top + main.h / 3 } };
  }
  const low = H <= 500;
  const left = page.clean ? 0 : Math.min(W * 0.45, (low ? 260 : 380) + 48); // the column and its gutters
  if (low) {
    const main = { x: left, y: 0, w: W - left, h: H };
    if (!split) return { main, cam: null };
    const d = Math.round(Math.min(220, H * 0.55));
    return { main, cam: { x: W - PIP_GAP - d, y: H - PIP_GAP - d, w: d, h: d, round: true }, aim: { x: left + main.w / 3, y: H / 2 } };
  }
  // a desktop: the machine has all the room beside the column, and the view is in the column, as wide as it, over the
  // mode pills, square at most and lower (landscape) where the text above leaves less room, down to COL_MIN_H (it was
  // half the room beside the column, for a while)
  const main = { x: left, y: 0, w: W - left, h: H };
  if (!split) return { main, cam: null };
  const w = Math.min(380, W - 48), h = Math.round(Math.max(COL_MIN_H, Math.min(w, H - COL_OVER - page.textBottom - 16)));
  return { main, cam: { x: 24, y: H - COL_OVER - h, w, h } };
}
const PIP_GAP = 24; // the phone's disc in from the edges (CSS px)
const COL_OVER = 76, COL_MIN_H = 120; // the view in the column: how far up from the bottom, over the mode pills, and its least height (CSS px)
// the fog the far rooms fade into, by the view's size: minimized, a grey, and the view's background that grey too, so
// the rooms go into it; maximized, the page's paper, and no background, the page itself between the lines
const FOG_MINI = new THREE.Color('#bdbdb9'), FOG_MAX = new THREE.Color('#f4f4f2');

const CUBE = 1024; // the cube map's face size: fine enough for a hull a pixel or so wide through the lens
const R_STRUT = 0.04, R_NODE = 0.06; // the outlined rooms: the tube, the joint
// the outline round them, as an angle: the hull is pushed out by this times its distance from the eye, so it is the same
// hairline near and far, about a pixel through the lens (it was a fixed 0.013, fat up close and lost far off)
const INK = 0.0022;

/** The inverted hull's ink, a hairline at any distance: each vertex out along its normal by INK times how far it is
 * from the eye, in view space, after the instance and the model. */
function inkMat(fog = true) {
  const m = new THREE.MeshBasicMaterial({ color: GRAPHITE, side: THREE.BackSide, fog });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4(transformed, 1.0);
      vec3 inkN = normal;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        inkN = mat3(instanceMatrix) * inkN;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      mvPosition.xyz += normalize(mat3(modelViewMatrix) * inkN) * (${INK.toFixed(5)} * length(mvPosition.xyz));
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return m;
}
const PIECE_K = SIZE_CELL / SIZE_MAIN; // the piece scaled with the device

const FISHEYE = new THREE.ShaderMaterial({
  uniforms: { tCube: { value: null }, rot: { value: new THREE.Matrix3() }, fade: { value: 0 }, strength: { value: STRENGTH } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform samplerCube tCube; uniform mat3 rot;
    uniform float fade; // device pixels: transparent at the left edge, full here, at the right
    uniform float strength; // the most it ever shows
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0; // a right angle out to the side edge
      float r = length(p);
      float theta = r * 1.5707963;
      vec2 u = r > 1e-5 ? p / r : vec2(0.0);
      vec3 d = rot * vec3(sin(theta) * u, -cos(theta));
      vec4 col = textureCube(tCube, d);
      float a = 1.0 - smoothstep(0.995, 1.005, r); // a disc; outside it the page shows through
      a *= smoothstep(0.0, fade, gl_FragCoord.x) * strength; // and out to the left into the page, and never all there
      gl_FragColor = vec4(col.rgb / max(col.a, 1e-4), a * col.a); // the lines alone, the page between; no tone mapping, no pass of any kind on the view
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, transparent: true,
});

export function DroneCam() {
  const { gl, scene, camera, size } = useThree();
  const cell = useMemo(() => {
    const cs = new THREE.Scene();
    cs.background = null; // set each frame by the view's size (FOG_MINI, FOG_MAX)
    cs.fog = new THREE.Fog(FOG_MAX, 1.6, 5.2); // clear through this room, the fog sets in from the next one and the rooms beyond fade into it
    cs.add(new THREE.HemisphereLight('#ffffff', '#8a8780', 1.0));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(2, 5, 3);
    cs.add(sun);
    // the rooms: a box of 5 × 5 × 5 cubes round this one. When the net recentres on a new room the only cubes born
    // are a whole slab on the far side, four units out at the least, already in the fog; nothing pops in nearby.
    const offsets: number[][] = [];
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) offsets.push([x, y, z]);
    // ink on paper, through the cube map: a tube filled with the page's paper and round it an outline, the inverted
    // hull (inkMat), a copy showing only its back faces, in one graphite, the joints the same. Neighbouring cubes share
    // their edges and joints: each is drawn once
    const tubes = (() => {
      const fill = new THREE.MeshBasicMaterial({ color: '#f2f2ef' });
      const ink = inkMat();
      const n = offsets.length;
      const parts = [
        new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 16), fill, n * 12),
        new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 16), ink, n * 12),
        new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE, 16, 12), fill, n * 8),
        new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE, 16, 12), ink, n * 8),
      ];
      const dummy = new THREE.Object3D(), done = new Set<string>();
      let e = 0, v = 0;
      for (const o of offsets) {
        const c = [o[0] * 2, o[1] * 2, o[2] * 2];
        for (let k = 0; k < 3; k++) {
          const [i, j] = [0, 1, 2].filter((r) => r !== k);
          for (const a of [-1, 1]) for (const b of [-1, 1]) {
            dummy.position.set(c[0], c[1], c[2]); dummy.position.setComponent(i, c[i] + a); dummy.position.setComponent(j, c[j] + b);
            const key = `e${dummy.position.toArray()}`;
            if (done.has(key)) continue;
            done.add(key);
            dummy.rotation.set(k === 2 ? Math.PI / 2 : 0, 0, k === 0 ? Math.PI / 2 : 0);
            dummy.updateMatrix();
            parts[0].setMatrixAt(e, dummy.matrix); parts[1].setMatrixAt(e++, dummy.matrix);
          }
        }
        for (let q = 0; q < 8; q++) {
          dummy.position.set(c[0] + (q & 1 ? 1 : -1), c[1] + (q & 2 ? 1 : -1), c[2] + (q & 4 ? 1 : -1));
          const key = `n${dummy.position.toArray()}`;
          if (done.has(key)) continue;
          done.add(key);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          parts[2].setMatrixAt(v, dummy.matrix); parts[3].setMatrixAt(v++, dummy.matrix);
        }
      }
      parts[0].count = parts[1].count = e; parts[2].count = parts[3].count = v;
      const g = new THREE.Group();
      for (const m of parts) { m.frustumCulled = false; g.add(m); }
      return g;
    })();
    cs.add(tubes);
    const flash = faceQuad();
    cs.add(flash.mesh);
    // the piece is outlined the same way, a ball of paper and an ink hull round it, as big against the device here as in
    // the main picture and out of the fog; the taken one too
    const rBall = PIECE_R * PIECE_K;
    const ballGeo = new THREE.SphereGeometry(rBall, 24, 16);
    const ballMats = [new THREE.MeshBasicMaterial({ color: '#f2f2ef', fog: false }), inkMat(false)];
    const ball = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(ballGeo, ballMats[0]), new THREE.Mesh(ballGeo, ballMats[1])); g.visible = false; cs.add(g); return g; };
    const piece = ball(), grabbed = ball();
    // the eye: a cube map rendered from where it is, unwrapped by the fisheye onto a quad that fills the frame
    const rt = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
    const eye = new THREE.CubeCamera(0.03, 40, rt);
    cs.add(eye);
    FISHEYE.uniforms.tCube.value = rt.texture;
    const lens = new THREE.Scene();
    lens.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), FISHEYE));
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      cs, tubes, flash, piece, grabbed, eye, lens, flat,
      q: new THREE.Quaternion(), look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1,
      pos: new THREE.Vector3(), lockEl: null as HTMLElement | null, eyeX: -1, eyeY: -1, camX: -1, camH: -1, plateEl: null as Element | null, lockLast: '', over: null as number[] | null, // the bracket's last style, written only on change
      grabOf: null as number[] | null, grabLocal: new THREE.Vector3(), // the piece taken, and where it was from the eye then, in its frame
    };
  }, []);

  const tmp = useMemo(() => ({ vel: new THREE.Vector3(), ring: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), camUp: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), axis: new THREE.Vector3(), clear: new THREE.Color() }), []);

  useFrame(() => {
    const lockEl = (cell.lockEl ??= document.getElementById('lock'));
    // the text's foot, for the layout (an upright phone puts the machine under it)
    page.textBottom = (cell.plateEl ??= document.querySelector('.plate'))?.getBoundingClientRect().bottom ?? 0;
    const auto = gl.autoClear;
    // the camera grid off, or no beetle: no eye, no lock bracket, just the page and the machine
    if (eyeShown(size.width, size.height)) drawEye(); else { setLock(lockEl, 'none'); gl.setRenderTarget(null); gl.clear(); }
    gl.autoClear = false;
    // the machine over the lens, through the depth of field, only in its own part, never under the text
    const W = size.width, H = size.height, { main } = regionsOf(W, H);
    renderDof(gl, scene, camera, [main.x, H - main.y - main.h, main.w, main.h]);
    if (cell.over) { // the phone's disc: over the machine, not under it
      const [x, y, w, h] = cell.over;
      gl.setViewport(x, y, w, h);
      gl.setScissorTest(true); gl.setScissor(x, y, w, h);
      gl.render(cell.lens, cell.flat);
      gl.setScissorTest(false); gl.setViewport(0, 0, W, H);
      cell.over = null;
    }
    gl.autoClear = auto;
  }, 1);

  /** The bracket's style as one string, written only when it changes: a style write every frame recalcs the page. */
  function setLock(el: HTMLElement | null, style: string) {
    if (!el || style === cell.lockLast) return;
    cell.lockLast = style;
    if (style === 'none') { el.style.display = 'none'; return; }
    const [t, sz, on] = style.split('|');
    el.style.display = 'block'; el.style.transform = t; el.style.width = el.style.height = sz; el.classList.toggle('on', on === '1');
  }

  /** The eye: where it is and looks in cell space, the room into the cube map, the lens onto the cleared page. */
  function drawEye() {
    // setViewport takes CSS pixels and applies the pixel ratio itself
    const W = size.width, H = size.height;
    // what the view fills: the whole page, maximized, or its part of it (S wide, SH high; sx, sy its corner from the
    // bottom left, GL's way; top its top from the page's top); its top right corner to the page as --eye-x, --eye-y,
    // for its buttons
    const { cam: part } = regionsOf(W, H), full = !part;
    const r = part ?? { x: 0, y: 0, w: W, h: H };
    const S = r.w, SH = r.h, sx = r.x, sy = H - r.y - r.h, top = r.y;
    if (sx + S !== cell.eyeX || top !== cell.eyeY || sx !== cell.camX || SH !== cell.camH) {
      cell.camX = sx; cell.camH = SH;
      cell.eyeX = sx + S; cell.eyeY = top;
      document.documentElement.style.setProperty('--eye-x', `${sx + S}px`);
      document.documentElement.style.setProperty('--eye-y', `${top}px`);
      document.documentElement.style.setProperty('--cam-x', `${sx}px`); // its left edge, for the hairline
      document.documentElement.style.setProperty('--cam-h', `${SH}px`); // and its height, for the pad over it
    }
    // the lens's square round its middle, big enough that the disc covers all of it; the phone's disc, in it
    const w = r.round ? S : Math.hypot(S, SH), h = w;
    const x = sx + S / 2 - w / 2, y = sy + SH / 2 - h / 2;
    const [bx0, by0, bx1, by1] = [sx, top, sx + S, top + SH]; // where the lock can show, from the top left

    // the device: where it is and where it is going, in cell space
    const c = toCell(drone.p);
    cell.pos.fromArray(c);
    tmp.vel.set(c[0] - cell.last[0], c[1] - cell.last[1], c[2] - cell.last[2]);
    cell.last = c;
    // P: the eye's look held too, not easing on after the device has stopped
    if (!drone.frozen) {
    // the look: the way it is going; at the controls, the way the eye points
    if (drone.pilot) cell.look.lerp(tmp.at.set(0, 0, -1).applyQuaternion(drone.q), 0.25).normalize();
    // the way it is going on the whole, eased hard: the path weaves about once a second and the view should not
    else if (tmp.vel.lengthSq() > 1e-8 && tmp.vel.lengthSq() < 0.25) cell.look.lerp(tmp.vel.normalize(), 0.03).normalize();
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
    }
    // the grip reaches the piece in cell space too: its distance here over the device's size here, for the taken piece
    let at = drone.gripAt;
    if (target.up && target.map) { const t3 = toCellWith(target.map, target.p); at = tmp.at.fromArray(t3).distanceTo(cell.pos) / SIZE_CELL; }

    if (cell.crossings !== drone.crossings) {
      cell.crossings = drone.crossings;
      cell.tubes.position.set(drone.centre[0], drone.centre[1], drone.centre[2]);
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
    // the one just taken, in the scoop in front of the eye, riding in
    cell.grabbed.visible = drone.taken > 0.02 && !!drone.grabMap;
    if (cell.grabbed.visible) {
      const fwd = tmp.at.set(0, 0, -1).applyQuaternion(drone.q);
      const ring = tmp.ring.copy(cell.pos).addScaledVector(fwd, ringOut(drone.grip, at) * SIZE_CELL);
      // it goes with the device from where it was when taken, and is drawn from there into the bowl
      if (cell.grabOf !== drone.grab4) { cell.grabOf = drone.grab4; cell.grabLocal.fromArray(toCellWith(drone.grabMap!, drone.grab4)).sub(cell.pos).applyQuaternion(tmp.q.copy(drone.q).invert()); }
      cell.grabbed.position.copy(cell.grabLocal).applyQuaternion(drone.q).add(cell.pos).lerp(ring, drone.grabK);
      cell.grabbed.scale.setScalar(drone.taken);
    }

    // the lock: at the controls, the piece in this cell and close, a bracket round it in the view, LOCK while
    // closing in and LOCKED once the catch has taken over. The piece's place in the view is the fisheye's own map:
    // its direction in the eye's frame, the angle off the axis as the radius, the lens then stretched by the aspect
    {
      let lock = 'none';
      if (drone.pilot && target.up && target.map && target.map.held === drone.held && target.map.sign === drone.sign) {
        const t3 = toCell(target.p), d = tmp.axis.set(t3[0] - c[0], t3[1] - c[1], t3[2] - c[2]), dist = d.length();
        if (dist < LOCK_RANGE && dist > 1e-6) {
          d.divideScalar(dist).applyQuaternion(tmp.q.copy(cell.q).invert());
          const theta = Math.acos(Math.max(-1, Math.min(1, -d.z))), r = theta / (Math.PI / 2), l = Math.hypot(d.x, d.y) || 1;
          const vw = w, vh = h, vx = x, vtop = H - y - h; // the lens's square, in CSS pixels from the top left
          const bx = vx + ((r * d.x / l) + 1) / 2 * vw, by = vtop + (1 - (r * d.y / l)) / 2 * vh;
          if (r < 1.02 && bx > bx0 && bx < bx1 && by > by0 && by < by1) { // in the view, faint or not
            const ballPx = ((PIECE_R * PIECE_K) / dist / (Math.PI / 2)) * (vw / 2);
            const size = Math.max(28, ballPx * 3.4) * (drone.docking ? 0.62 : 1);
            lock = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) translate(-50%, -50%)|${size.toFixed(1)}px|${drone.docking ? 1 : 0}`;
          }
        }
      }
      setLock(cell.lockEl, lock);
    }

    // the eye: the room into the cube map, then the lens into the panel, then the machine over it all
    cell.cs.environment = scene.environment;
    (cell.cs.fog as THREE.Fog).color.copy(full ? FOG_MAX : FOG_MINI);
    cell.cs.background = full ? null : FOG_MINI;
    cell.eye.position.copy(cell.pos);
    const wasA = gl.getClearAlpha();
    gl.getClearColor(tmp.clear);
    gl.setClearColor(0x000000, 0); // each face cleared to nothing as it renders
    cell.eye.update(gl, cell.cs);
    gl.setClearColor(tmp.clear, wasA);
    gl.autoClear = false; // from here the page is cleared once, by hand, and the lens and the machine go over it
    FISHEYE.uniforms.rot.value.setFromMatrix4(tmp.m.makeRotationFromQuaternion(cell.q));
    FISHEYE.uniforms.fade.value = full ? W * gl.getPixelRatio() : 0; // the half: no fade
    FISHEYE.uniforms.strength.value = full ? STRENGTH : 1; // and all there
    gl.setRenderTarget(null);
    gl.setViewport(0, 0, W, H);
    gl.clear();
    if (r.round) { cell.over = [x, y, w, h]; return; } // drawn after the machine, over it
    gl.setViewport(x, y, w, h);
    if (!full) { gl.setScissorTest(true); gl.setScissor(sx, sy, S, SH); }
    gl.render(cell.lens, cell.flat);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
  }

  return null;
}
