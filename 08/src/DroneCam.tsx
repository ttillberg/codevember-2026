import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { drone, target, toCell, toCellWith, faceQuad, pieceMesh, PIECE_R, SIZE_MAIN, SIZE_CELL, LOCK_RANGE } from './drone';
import { ringOut } from './device';
import { GRAPHITE } from './decals';
import { st } from './state';

// The device's camera, the right third of the page behind the machine. It renders cell space: the cube the device
// is in, rigid, and the rooms continuing straight through its faces, as in a net. Nothing telescopes here; from
// inside, a tesseract is just rooms. The eye is a 180 degree fisheye: the room is drawn into a cube map from the eye
// and that is unwrapped with an equidistant lens. Takes over the render loop: this one first, in a scissored
// viewport, then the main scene over it.

// the eye's panel: the right third of the page, full height, fading out over its left part into the page; the same
// in both modes (a full-page view at the controls was tried, the machine moved right, and dropped)
const CAM = { share: 1 / 3, fade: 0.45 };
/** 0 at a, 1 at b, eased: the fade's ramp. */
const ramp = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

const CUBE = 512; // the cube map's face size
const SEGS = 24; // pieces to an edge of a room, so it bends as the lens bends it
const RING_SEGS = 24, R_JOINT = 0.07, R_DETAIL = 0.11; // a joint's circle: its pieces, its radius in cell units, and round the joint ball in the drawing
// the centre line's pattern over an edge's pieces, an architect's dash-dot: a long dash, a gap, a dot, a gap
const DASH = [1, 1, 1, 1, 0, 1, 0];
const R_STRUT = 0.04, R_NODE = 0.06, R_INK = 0.013; // the outlined rooms: the tube, the joint, the outline round both
const PIECE_K = SIZE_CELL / SIZE_MAIN; // the piece scaled with the device

// The rooms are drawn as true hairlines, a pixel wide on the screen. Through the cube map a line would be blown up
// by the lens and blur, so they skip it: each edge, cut in short pieces, is put straight through the same
// equidistant lens in the vertex shader, at the screen's own resolution, after the lens has drawn the rest. Fog as
// in the room, and the panel's fade.
const HAIR = new THREE.ShaderMaterial({
  uniforms: { rotInv: { value: new THREE.Matrix3() }, uEye: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(GRAPHITE) }, uFog: { value: 1 } },
  vertexShader: `
    uniform mat3 rotInv; uniform vec3 uEye; uniform float uFog;
    varying float vA;
    #ifdef RING
      // a circle round a joint, turned to face the eye: its centre is the position, its angle round it an attribute
      attribute float ang;
      uniform float uRing;
    #endif
    void main() {
      vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
      #ifdef RING
        vec3 n = normalize(wp - uEye);
        vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        wp += uRing * (cos(ang) * t1 + sin(ang) * cross(n, t1));
      #endif
      vec3 d = wp - uEye;
      float dist = length(d);
      vec3 l = rotInv * (d / max(dist, 1e-5)); // in the eye's frame, looking down -z
      float theta = acos(clamp(-l.z, -1.0, 1.0));
      float s = length(l.xy);
      vec2 p = (theta / 1.5707963) * (s > 1e-6 ? l.xy / s : vec2(0.0)); // a right angle out to the side edge
      // the fog of the room; and nothing from right behind, where the lens wraps round
      vA = mix(1.0, 1.0 - smoothstep(1.6, 5.2, dist), uFog) * (1.0 - smoothstep(2.5, 2.8, theta));
      gl_Position = vec4(p, 0.0, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uColor;
    uniform vec2 fade;
    float ramp(float x, vec2 f) { float t = clamp((x - f.x) / (f.y - f.x), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    varying float vA;
    void main() {
      float a = vA * ramp(gl_FragCoord.x, fade);
      if (a < 0.003) discard;
      gl_FragColor = vec4(uColor, a);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false, transparent: true,
});

/** Another hairline material on the same lens, its view and fade shared with HAIR's: out of the fog or not, rings
 * of radius `ring` round joints or plain lines. */
function hairMat(fog: boolean, ring = 0, color?: string) {
  const m = HAIR.clone();
  m.uniforms = { ...HAIR.uniforms, uFog: { value: fog ? 1 : 0 }, uRing: { value: ring } };
  if (color) m.uniforms.uColor = { value: new THREE.Color(color) };
  if (ring) m.defines = { RING: '' };
  return m;
}

const FISHEYE = new THREE.ShaderMaterial({
  uniforms: { tCube: { value: null }, rot: { value: new THREE.Matrix3() }, fade: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform samplerCube tCube; uniform mat3 rot;
    uniform vec2 fade; // device pixels: transparent at x, full at y
    float ramp(float x, vec2 f) { float t = clamp((x - f.x) / (f.y - f.x), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0; // a right angle out to the side edge
      float r = length(p);
      float theta = r * 1.5707963;
      vec2 u = r > 1e-5 ? p / r : vec2(0.0);
      vec3 d = rot * vec3(sin(theta) * u, -cos(theta));
      vec4 col = textureCube(tCube, d);
      float a = 1.0 - smoothstep(0.995, 1.005, r); // a disc; outside it the page shows through
      a *= ramp(gl_FragCoord.x, fade); // and out to the left into the page
      gl_FragColor = vec4(col.rgb, a);
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
    const offsets: number[][] = [];
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) offsets.push([x, y, z]);
    // neighbouring cubes share their edges: each is drawn once, a hairline in short pieces (HAIR), in a scene of its
    // own, drawn after the lens
    const pts: number[] = [], dash: number[] = [], seen = new Set<string>();
    for (const o of offsets) {
      const c = [o[0] * 2, o[1] * 2, o[2] * 2];
      for (let k = 0; k < 3; k++) {
        const [i, j] = [0, 1, 2].filter((r) => r !== k);
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const m = [c[0], c[1], c[2]]; m[i] += a; m[j] += b; // the edge's middle; it runs along k, two long
          const key = m.join();
          if (seen.has(key)) continue;
          seen.add(key);
          for (let s = 0; s < SEGS; s++) for (const t of [s, s + 1]) {
            const q = [m[0], m[1], m[2]]; q[k] += -1 + (2 * t) / SEGS;
            pts.push(q[0], q[1], q[2]);
            if (DASH[s % DASH.length]) dash.push(q[0], q[1], q[2]); // the centre line: the same pieces, dash and dot
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const net = new THREE.LineSegments(geo, HAIR);
    net.frustumCulled = false;
    const hair = new THREE.Scene();
    hair.add(net);
    // the panel's fade, shared with the lens
    HAIR.uniforms.fade = FISHEYE.uniforms.fade;
    // a circle round every joint, the corners shared like the edges, each a ring of pieces facing the eye (RING)
    const rp: number[] = [], ra: number[] = [];
    for (let x = -5; x <= 5; x += 2) for (let y = -5; y <= 5; y += 2) for (let z = -5; z <= 5; z += 2)
      for (let s = 0; s < RING_SEGS; s++) for (const t of [s, s + 1]) { rp.push(x, y, z); ra.push((t / RING_SEGS) * Math.PI * 2); }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    ringGeo.setAttribute('ang', new THREE.Float32BufferAttribute(ra, 1));
    const rings = new THREE.LineSegments(ringGeo, hairMat(true, R_JOINT));
    rings.frustumCulled = false;
    net.add(rings); // they go with the net
    // the drawing (st.eye 'drawing'): the outlined tubes of the cube map with, over them, each edge's centre line, a
    // thin dash-dot hairline in a lighter grey, running on through the joints as an architect's centre lines run
    // past the work, and a detail circle round every joint
    const centreGeo = new THREE.BufferGeometry();
    centreGeo.setAttribute('position', new THREE.Float32BufferAttribute(dash, 3));
    const centre = new THREE.LineSegments(centreGeo, hairMat(true, 0, '#8d8d8a'));
    centre.frustumCulled = false;
    net.add(centre);
    // or, the other way to draw them (st.eye drawing or outline), through the cube map: ink on paper, a tube filled with the
    // page's paper and round it an outline, the inverted hull, a fatter copy showing only its back faces, in one
    // graphite, the joints the same
    const tubes = (() => {
      const fill = new THREE.MeshBasicMaterial({ color: '#f2f2ef' });
      const ink = new THREE.MeshBasicMaterial({ color: GRAPHITE, side: THREE.BackSide });
      const n = offsets.length;
      const parts = [
        new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT, R_STRUT, 2, 16), fill, n * 12),
        new THREE.InstancedMesh(new THREE.CylinderGeometry(R_STRUT + R_INK, R_STRUT + R_INK, 2, 16), ink, n * 12),
        new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE, 16, 12), fill, n * 8),
        new THREE.InstancedMesh(new THREE.SphereGeometry(R_NODE + R_INK, 16, 12), ink, n * 8),
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
    const piece = pieceMesh(PIECE_K, false); // as big against the device here as in the main picture, and out of the fog
    piece.visible = false;
    cs.add(piece);
    const grabbed = pieceMesh(PIECE_K, false);
    grabbed.visible = false;
    // the piece here is a geometric outline, a geodesic ball in hairlines through the lens like the rooms, out of
    // the fog, in the same graphite; the steel ball and its lamps are left out of the cube map
    const ballMat = hairMat(false);
    const ballGeo = (() => {
      const e = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(PIECE_R * PIECE_K, 1)).getAttribute('position');
      const out: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
      for (let i = 0; i < e.count; i += 2) {
        a.fromBufferAttribute(e, i); b.fromBufferAttribute(e, i + 1);
        for (let s = 0; s < 4; s++) for (const t of [s, s + 1]) { q.lerpVectors(a, b, t / 4); out.push(q.x, q.y, q.z); } // pieces, for the lens
      }
      return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    })();
    // with the outlined rooms it is outlined too, the same way: a ball of paper and an ink hull round it, in the cube
    // map, the outline a touch bolder than the tubes' since the ball is small
    const rBall = PIECE_R * PIECE_K;
    const inked = [new THREE.SphereGeometry(rBall, 24, 16), new THREE.SphereGeometry(rBall * 1.22, 24, 16)];
    const inkedMats = [new THREE.MeshBasicMaterial({ color: '#f2f2ef', fog: false }), new THREE.MeshBasicMaterial({ color: GRAPHITE, side: THREE.BackSide, fog: false })]; // out of the fog, as the piece was
    const balls = [piece, grabbed].map((g) => {
      for (const c of g.children) c.visible = false; // the steel ball, the lamps
      const l = new THREE.LineSegments(ballGeo, ballMat);
      l.frustumCulled = false;
      hair.add(l);
      const o = new THREE.Group();
      o.add(new THREE.Mesh(inked[0], inkedMats[0]), new THREE.Mesh(inked[1], inkedMats[1]));
      g.add(o);
      return { g, l, o };
    });
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
      cs, net, rings, centre, tubes, hair, flash, piece, grabbed, balls, eye, lens, flat,
      q: new THREE.Quaternion(), look: new THREE.Vector3(0, 0, -1), last: [0, 0, 0], crossings: -1,
      pos: new THREE.Vector3(), lockEl: null as HTMLElement | null,
      grabOf: null as number[] | null, grabLocal: new THREE.Vector3(), // the piece taken, and where it was from the eye then, in its frame
    };
  }, []);

  const tmp = useMemo(() => ({ vel: new THREE.Vector3(), ring: new THREE.Vector3(), at: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), camUp: new THREE.Vector3(0, 1, 0), m: new THREE.Matrix4(), q: new THREE.Quaternion(), axis: new THREE.Vector3(), clear: new THREE.Color() }), []);

  useFrame(() => {
    // setViewport and setScissor take CSS pixels and apply the pixel ratio themselves
    const W = size.width, H = size.height;
    // the panel, and the lens's square round its middle, big enough that the disc covers the whole panel
    const pw = W * CAM.share, px = W - pw;
    const w = Math.hypot(pw, H), h = w, x = px + (pw - w) / 2, y = (H - h) / 2;
    const fade0: [number, number] = [px, px + pw * CAM.fade];
    const alphaAt = (bx: number) => ramp(bx, ...fade0);

    // the device: where it is and where it is going, in cell space
    const c = toCell(drone.p);
    cell.pos.fromArray(c);
    tmp.vel.set(c[0] - cell.last[0], c[1] - cell.last[1], c[2] - cell.last[2]);
    cell.last = c;
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
    // the grip reaches the piece in cell space too: its distance here over the device's size here, for the taken piece
    let at = drone.gripAt;
    if (target.up && target.map) { const t3 = toCellWith(target.map, target.p); at = tmp.at.fromArray(t3).distanceTo(cell.pos) / SIZE_CELL; }

    if (cell.crossings !== drone.crossings) {
      cell.crossings = drone.crossings;
      cell.net.position.set(drone.centre[0], drone.centre[1], drone.centre[2]); cell.tubes.position.copy(cell.net.position);
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
    // their outlines go where they go
    for (const { g, l, o } of cell.balls) {
      l.visible = g.visible && st.eye === 'hairline'; o.visible = st.eye !== 'hairline';
      l.position.copy(g.position); l.rotation.copy(g.rotation); l.scale.copy(g.scale);
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
          const vw = w, vh = h, vx = x, vtop = H - y - h; // the lens's square, in CSS pixels from the top left
          const bx = vx + ((r * d.x / l) + 1) / 2 * vw, by = vtop + (1 - (r * d.y / l)) / 2 * vh;
          if (r < 1.02 && alphaAt(bx) > 0.35) { // in the panel, not out in its fade
            const ballPx = ((PIECE_R * PIECE_K) / dist / (Math.PI / 2)) * (vw / 2);
            const size = Math.max(28, ballPx * 3.4) * (drone.docking ? 0.62 : 1);
            lockEl.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) translate(-50%, -50%)`;
            lockEl.style.width = lockEl.style.height = `${size.toFixed(1)}px`;
            lockEl.classList.toggle('on', drone.docking);
            show = true;
          }
        }
      }
      lockEl.style.display = show ? 'block' : 'none';
    }

    // the rooms one of three ways (st.eye): the drawing, outlined tubes in the cube map with the centre lines and
    // detail circles over them after the lens; the tubes alone; or the hairlines alone. The piece goes with the tubes
    // or the hairlines (balls)
    const ink = st.eye !== 'hairline';
    cell.tubes.visible = ink && st.grid; // the camera grid off: no rooms, the piece alone
    cell.net.visible = st.eye !== 'outline' && st.grid;
    HAIR.visible = st.eye === 'hairline'; // the net's own lines; its children have their own materials
    cell.centre.visible = st.eye === 'drawing';
    cell.rings.material.uniforms.uRing.value = st.eye === 'drawing' ? R_DETAIL : R_JOINT;
    // the eye: the room into the cube map, then the lens into the panel, then the machine over it all
    cell.cs.environment = scene.environment;
    cell.eye.position.copy(cell.pos);
    cell.eye.update(gl, cell.cs);
    FISHEYE.uniforms.rot.value.setFromMatrix4(tmp.m.makeRotationFromQuaternion(cell.q));
    HAIR.uniforms.rotInv.value.copy(FISHEYE.uniforms.rot.value).transpose();
    HAIR.uniforms.uEye.value.copy(cell.pos);
    const dpr = gl.getPixelRatio();
    FISHEYE.uniforms.fade.value.set(fade0[0] * dpr, fade0[1] * dpr);
    const auto = gl.autoClear; gl.autoClear = false;
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
    gl.setClearColor(gl.getClearColor(tmp.clear), gl.getClearAlpha()); // the cube map's paper background left its colour as the clear
    gl.clear();
    gl.setScissorTest(true);
    gl.setScissor(px, 0, pw, H);
    gl.setViewport(x, y, w, h);
    gl.render(cell.lens, cell.flat);
    gl.render(cell.hair, cell.flat); // the rooms' hairlines, through the same lens, at the screen's resolution
    gl.setScissorTest(false);
    gl.setViewport(0, 0, W, H);
    gl.render(scene, camera); // the lens writes no depth, so the machine draws over it whole
    gl.autoClear = auto;
  }, 1);

  return null;
}
