import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import data from './tracks.json';
import { PERIOD, SCARE, createSnake, createWorld, loadTracks, type Snake } from './physics';
import { BOIDS, COLUBRIDS, type Species } from './species';
import { createBody, type Body } from './body';
import { createSkin } from './skin';
import { createHead, type Head } from './head';
import { LOOK, createPost, handheld } from './post';
import { debugPanel } from './debug';

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');

const BG = 0x0b0b0d;
const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
// no multisampling on the canvas: the scene is drawn multisampled into its own target (post.ts) and
// only a flat quad reaches the screen
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// the patch the knot was baked onto, and how much of it the camera frames (bake.ts)
const { area: AREA, view: VIEW } = data;
const SPAN = Math.max(AREA.w, AREA.h) + 0.16; // the pile and a margin, either way up
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
}

// from above, a little off plumb, the mess bleeding off every edge
const portrait = window.innerHeight > window.innerWidth;
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.08;
controls.maxDistance = 1.6; // set from the framing in resize()
controls.maxPolarAngle = 1.0;
controls.rotateSpeed = 0.6;
controls.screenSpacePanning = true;

// --- light ------------------------------------------------------------------------
const key = new THREE.DirectionalLight(0xfff2e2, 2.6);
key.position.set(0.9, 2.2, 0.7);
key.castShadow = true;
// the shadow map over the pile and no further
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -SPAN / 2;
key.shadow.camera.right = SPAN / 2;
key.shadow.camera.top = SPAN / 2;
key.shadow.camera.bottom = -SPAN / 2;
key.shadow.camera.near = 1;
key.shadow.camera.far = 5;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.004;
key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc8dcff, 1.6);
rim.position.set(-1.2, 1.0, -1.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x8a96a0, 0x1a1410, 0.35));

// --- contact shadows: the bodies drawn from above, soft, darker the closer to the ground ----
const CONTACT_SPAN = SPAN;
const contact = (() => {
  const size = 768;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  // one soft blob, stamped per sphere
  const blob = document.createElement('canvas');
  blob.width = blob.height = 64;
  {
    const b = blob.getContext('2d')!;
    const grd = b.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = grd;
    b.fillRect(0, 0, 64, 64);
  }
  return {
    tex,
    draw(list: { pos: Float32Array; rad: Float32Array; n: number }[]) {
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size, size);
      const k = size / CONTACT_SPAN;
      for (const s of list) {
        for (let i = 0; i < s.n; i += 1) {
          const x = (s.pos[i * 3] / CONTACT_SPAN + 0.5) * size;
          const y = (s.pos[i * 3 + 2] / CONTACT_SPAN + 0.5) * size;
          const lift = Math.max(0, s.pos[i * 3 + 1] - s.rad[i]);
          const a = 0.2 * Math.max(0, 1 - lift / 0.06);
          if (a <= 0.01) continue;
          const r = (s.rad[i] * 1.6 + lift * 0.8) * k;
          g.globalAlpha = a;
          g.drawImage(blob, x - r, y - r, r * 2, r * 2);
        }
      }
      tex.needsUpdate = true;
    },
  };
})();

// --- ground: dark slate, fading into the night ------------------------------------
let ground!: THREE.Mesh;
{
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  // value noise, a few octaves
  const rnd = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number, f: number) => {
    const xi = Math.floor(x * f), yi = Math.floor(y * f);
    const xf = x * f - xi, yf = y * f - yi;
    const w = (k: number) => (((xi + k) % f) + f) % f;
    const a = rnd(w(0), yi % f), b = rnd(w(1), yi % f), c = rnd(w(0), (yi + 1) % f), d = rnd(w(1), (yi + 1) % f);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = noise(u, v, 8) * 0.5 + noise(u, v, 32) * 0.3 + noise(u, v, 128) * 0.2;
      const c = 24 + n * 26;
      const o = (y * size + x) * 4;
      img.data[o] = c * 0.98; img.data[o + 1] = c * 0.95; img.data[o + 2] = c * 0.9; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = 8;
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, bumpMap: tex, bumpScale: 0.6 }),
  );
  ground.rotation.x = -Math.PI / 2;
  (ground.material as THREE.MeshStandardMaterial).onBeforeCompile = (sh) => {
    sh.uniforms.uContact = { value: contact.tex };
    sh.uniforms.uSpan = { value: CONTACT_SPAN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uContact; uniform float uSpan; varying vec2 vGround;')
      .replace('#include <opaque_fragment>', `vec2 cuv = vGround / uSpan + 0.5;
float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
outgoingLight *= mix(1.0, texture2D(uContact, vec2(cuv.x, 1.0 - cuv.y)).r, inside);
#include <opaque_fragment>`);
  };
  ground.receiveShadow = true;
  scene.add(ground);
}

// --- the snakes ----------------------------------------------------------------------
// eight of them, eight species, on the tracks the knot was baked into (bake.ts): the boids on the
// thick loops, the colubrids on the thin ones, the biggest species on the thickest loop of its kind
const tracks = loadTracks(portrait);
const order = (sp: number) => tracks.map((t, k) => ({ t, k })).filter((o) => o.t.species === sp).sort((a, b) => b.t.radius - a.t.radius);
const chosen: Species[] = [];
order(0).forEach((o, i) => (chosen[o.k] = BOIDS[i % BOIDS.length]));
order(1).forEach((o, i) => (chosen[o.k] = COLUBRIDS[i % COLUBRIDS.length]));
const kinds = tracks.map((t, k) => {
  const base = chosen[k];
  const f = t.radius / base.radius;
  return {
    f,
    // as long as it lies on its track: four fifths of the loop (physics.ts)
    sp: { ...base, length: t.len * 0.8 - base.headLength * f, radius: t.radius, neck: base.neck * f, headLength: base.headLength * f, headWidth: base.headWidth * f, lift: base.lift * f * 0.6, seed: base.pattern * 17 + 3 + k * 5.3 },
  };
});
const snakes: Snake[] = tracks.map((t, k) => createSnake(kinds[k].sp, t, k, t.len * ((k * 0.381966) % 1), k + 1));
const world = createWorld(snakes);
world.step(1 / 60);
const skins = snakes.map((s) => createSkin(s.sp));
const bodies: Body[] = snakes.map((s, k) => {
  const b = createBody(s, skins[k]);
  scene.add(b.mesh);
  return b;
});
const heads: (Head | null)[] = snakes.map(() => null);

// two heads modelled, a python's and a colubrid's; each species' own colours painted on its family's.
// Made as they come, but put on only once their shaders are built (see loading, below)
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const base = import.meta.env.BASE_URL;
const headsMade = Promise.all((['python', 'corn'] as const).map((shape) => loader.loadAsync(`${base}${shape}.glb`).then((gltf) =>
  Promise.all(snakes.map(async (s, k) => {
    if (s.sp.shape !== shape) return;
    let paint: THREE.Texture | undefined;
    if (s.sp.name !== shape) {
      paint = await texLoader.loadAsync(`${base}heads/${s.sp.name}.jpg`).catch(() => undefined);
      if (paint) {
        // as glTF has its textures: not flipped, sRGB, sharp at a glance
        paint.flipY = false;
        paint.colorSpace = THREE.SRGBColorSpace;
        paint.anisotropy = 8;
      }
    }
    const h = createHead(gltf, s.sp, paint);
    h.group.scale.setScalar(kinds[k].f);
    heads[k] = h;
    // into the scene as it comes: in the drawing at once (the picture isn't drawn till it's built)
    scene.add(h.group);
    // the neck takes the head's colours (skin.ts)
    if (h.paint) {
      const u = skins[k].userData.uniforms;
      u.tHead.value = h.paint;
      u.uHeadOn.value = 1;
    }
  })),
).catch(() => { /* no heads then: the bodies alone */ })));

// --- touch -------------------------------------------------------------------------------
// tap a snake and its scales play; hold it and it gets away along its track, the longer the faster
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpV = new THREE.Vector3();
// a snake held down: after a moment it starts to get away, faster the longer it is held
let held: { s: Snake; i: number; t: number } | null = null;

/** the ray through the pointer, set on `ray` */
function aim(ev: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pick(ev: PointerEvent) {
  aim(ev);
  return pickRay();
}
/** the nearest body along the ray through a point on the screen (-1..1), and how far */
function pickAt(x: number, y: number) {
  ndc.set(x, y);
  ray.setFromCamera(ndc, camera);
  return pickRay();
}
function pickRay() {
  let best: { s: Snake; i: number; t: number } | null = null;
  const o = ray.ray.origin, d = ray.ray.direction;
  for (const s of snakes) {
    for (let i = 0; i < s.n; i++) {
      tmpV.set(s.pos[i * 3] - o.x, s.pos[i * 3 + 1] - o.y, s.pos[i * 3 + 2] - o.z);
      const tc = tmpV.dot(d);
      const d2 = tmpV.lengthSq() - tc * tc;
      const R = s.rad[i] * 1.15;
      if (d2 > R * R) continue;
      const t = tc - Math.sqrt(R * R - d2);
      if (!best || t < best.t) best = { s, i, t };
    }
  }
  return best;
}

// a click sets the focus: on the bit of body clicked (it stays on it as the snake moves), or on the
// ground; until the first click it is on whatever is in the middle of the screen
let focusOn: { s: Snake; i: number } | THREE.Vector3 | null = null;
let downX = 0, downY = 0, downHit = false;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

canvas.addEventListener('pointerdown', (ev) => {
  downX = ev.clientX; downY = ev.clientY;
  const p = pick(ev);
  downHit = !!p;
  if (!p) return;
  focusOn = { s: p.s, i: p.i };
  // a tap sets off the snake's pixel animation in its scales, and the line runs out of the scale tapped
  const at = scaleAt(p.s, ev);
  if (at) {
    const u = skins[snakes.indexOf(p.s)].userData.uniforms;
    (u.uSpark.value as THREE.Vector4[])[sparkNext++ % 4].set(at.along, at.row, time, 1);
    // the line once the animation is done
    u.uTextT0.value = time + 0.75;
    u.uTextCol.value = at.col;
  }
  // on a snake a press doesn't turn the camera; held, it sends the snake off
  held = { s: p.s, i: p.i, t: 0 };
  controls.enabled = false;
  canvas.setPointerCapture(ev.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (ev) => {
  if (held) return;
  if (ev.pointerType === 'mouse') canvas.style.cursor = pick(ev) ? 'grab' : '';
});

/** the scale under the pointer: where the ray meets the body's own mesh, in the skin's own scale
 * coordinates (along, in scale lengths; round, in rows), so whatever is put there stays on the skin */
const tri = new THREE.Triangle(), bary = new THREE.Vector3();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
let sparkNext = 0;
function scaleAt(s: Snake, ev: PointerEvent) {
  const k = snakes.indexOf(s);
  const mesh = bodies[k].mesh;
  mesh.geometry.computeBoundingSphere();
  aim(ev);
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit || !hit.face) return null;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const body = mesh.geometry.getAttribute('aBody') as THREE.BufferAttribute;
  const { a, b, c } = hit.face;
  tri.set(va.fromBufferAttribute(pos, a), vb.fromBufferAttribute(pos, b), vc.fromBufferAttribute(pos, c));
  tri.getBarycoord(hit.point, bary);
  const sA = body.getX(a) * bary.x + body.getX(b) * bary.y + body.getX(c) * bary.z;
  const sV = body.getY(a) * bary.x + body.getY(b) * bary.y + body.getY(c) * bary.z;
  const vw = s.sp.ventralWidth;
  const row = Math.round(((sV - vw / 2) / (1 - vw)) * s.sp.rows);
  const off = (((row % 2) + 2) % 2) * 0.5;
  const col = Math.round(sA - off);
  return { along: col + off, row, col };
}

function release() {
  if (!held) return;
  held = null;
  controls.enabled = true;
  canvas.style.cursor = '';
}
canvas.addEventListener('pointerup', (ev) => {
  // a click on the ground (not a drag of the camera) focuses there
  if (!downHit && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 6) {
    aim(ev);
    const at = new THREE.Vector3();
    if (ray.ray.intersectPlane(groundPlane, at)) focusOn = at;
  }
  release();
});
canvas.addEventListener('pointercancel', release);

// --- ?debug ---------------------------------------------------------------------------------
if (query.has('debug')) {
  debugPanel([
    { kind: 'title', label: 'ssao' },
    { kind: 'choice', label: 'show', options: ['picture', 'occlusion'], get: () => LOOK.view, set: (i) => (LOOK.view = i) },
    { kind: 'slider', obj: LOOK, key: 'ao', label: 'strength', min: 0, max: 3, step: 0.05 },
    { kind: 'slider', obj: LOOK, key: 'aoRadius', label: 'reach m', min: 0.003, max: 0.08, step: 0.001 },
    { kind: 'title', label: 'lens' },
    { kind: 'slider', obj: LOOK, key: 'aperture', label: 'aperture', min: 0, max: 0.04, step: 0.001 },
    { kind: 'slider', obj: LOOK, key: 'maxBlur', label: 'max blur', min: 0, max: 30, step: 1 },
    { kind: 'title', label: 'grade' },
    { kind: 'slider', obj: LOOK, key: 'grade', label: 'grade', min: 0, max: 1.5, step: 0.05 },
    { kind: 'slider', obj: LOOK, key: 'grain', label: 'grain', min: 0, max: 0.08, step: 0.002 },
    { kind: 'slider', obj: LOOK, key: 'vignette', label: 'vignette', min: 0, max: 1, step: 0.02 },
  ]);
}

// --- loop ---------------------------------------------------------------------------------
const post = createPost(renderer);
// the focus is pulled by hand onto its mark, a little late
let focus = 0.35;
const focusV = new THREE.Vector3();
const shake = { rot: new THREE.Euler(), pos: new THREE.Vector3() };
const qShake = new THREE.Quaternion();
const keep = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
let placed = false;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.setSize(w, h);
  camera.aspect = w / h;
  // the mess covers the screen: the camera backs off until one side of it just reaches the edges
  // well inside the pile: nothing but skin from edge to edge
  const tw = (portrait ? AREA.h : AREA.w) * VIEW, th = (portrait ? AREA.w : AREA.h) * VIEW;
  const seen = Math.min(th, tw / camera.aspect); // metres of ground top to bottom
  const d = seen / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // a little further out than that, never so far the pile's edge and the bare ground show
  controls.maxDistance = d * 1.3;
  if (!placed) {
    camera.position.set(0, d * Math.cos(0.12), d * Math.sin(0.12));
    placed = true;
  }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
function frame(ts: number) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  time += dt;
  if (held) {
    held.t += dt;
    if (held.t > 0.3) world.stroke(held.s, held.i, Math.min(1, 0.45 + (held.t - 0.3) * 0.8));
  }
  world.step(dt);
  skins.forEach((m) => (m.userData.uniforms.uTime.value = time));
  contact.draw(snakes);
  for (let k = 0; k < snakes.length; k++) {
    const b = bodies[k];
    b.update(time, world);
    const h = heads[k];
    if (h) {
      h.place(b.neck.pos, b.neck.fwd, b.neck.up);
      h.update(dt, time, Math.max(snakes[k].rush, snakes[k].lift / snakes[k].sp.lift));
    }
  }
  controls.update();
  let want = focus;
  if (!focusOn) {
    const hitC = pickAt(0, 0);
    if (hitC) want = hitC.t;
  } else {
    if (focusOn instanceof THREE.Vector3) focusV.copy(focusOn);
    else focusV.set(focusOn.s.pos[focusOn.i * 3], focusOn.s.pos[focusOn.i * 3 + 1], focusOn.s.pos[focusOn.i * 3 + 2]);
    // the depth along the view, as the lens sees it
    want = -focusV.applyMatrix4(camera.matrixWorldInverse).z;
  }
  focus += (want - focus) * (1 - Math.exp(-dt * 3));
  // held in the hand: the sway goes on top of where the controls put the camera, and comes off again
  keep.pos.copy(camera.position);
  keep.quat.copy(camera.quaternion);
  handheld(time, shake);
  camera.position.add(shake.pos.applyQuaternion(camera.quaternion));
  camera.quaternion.multiply(qShake.setFromEuler(shake.rot));
  camera.updateMatrixWorld();
  // the drawing until the picture is built, then the picture fades in over it (loading, below)
  if (revealing && reveal < 1) reveal = Math.min(1, reveal + dt / REVEAL);
  post.render(scene, camera, focus, time, THREE.MathUtils.smoothstep(reveal, 0, 1), reveal < 1 ? drawWire : null);
  camera.position.copy(keep.pos);
  camera.quaternion.copy(keep.quat);
  camera.updateMatrixWorld();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- loading -------------------------------------------------------------------------------
// The knot shows at once as a drawing, its wireframe in the ink of the title, and moves and can be
// touched, while the real shaders are built off the thread, the heads come in (into the drawing as
// they do) and the textures go up, one a frame. Then the picture fades in over the drawing, as day
// 12's does, with nothing left for its first frames to build.
const REVEAL = 1.6; // seconds
let reveal = 0;
let revealing = false;
const wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
// lines are never culled: the far side of every body would show through. So the bodies go into the
// depth first, a hair further back than they are, and only the lines in front of them get drawn
const hideMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
// the drawing: the bodies, not the ground, not the heads (their mesh is so fine it draws solid: they
// come in with the picture)
function drawWire() {
  const g = ground.visible;
  ground.visible = false;
  for (const h of heads) if (h) h.group.visible = false;
  renderer.shadowMap.autoUpdate = false;
  scene.overrideMaterial = hideMat;
  renderer.render(scene, camera);
  const ac = renderer.autoClear;
  renderer.autoClear = false;
  scene.overrideMaterial = wireMat;
  renderer.render(scene, camera);
  renderer.autoClear = ac;
  scene.overrideMaterial = null;
  renderer.shadowMap.autoUpdate = true;
  for (const h of heads) if (h) h.group.visible = true;
  ground.visible = g;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
async function load() {
  // two frames of the drawing first: where the browser can't build off the thread, the page stands
  // still on it, not on black
  await nextFrame();
  await nextFrame();
  // ?loader: held on the drawing, for looking at it
  if (query.has('loader')) return;
  await headsMade;
  try {
    await post.compile(scene, camera, scene);
    await nextFrame();
    // three asks the GPU about a program the first time it draws with it, a round trip that waits on
    // the frame in flight: ask now. And every texture uploaded, one a frame
    const materials = new Set<THREE.Material>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of [m].flat()) materials.add(x);
    });
    const textures = new Set<THREE.Texture>();
    for (const m of materials) {
      (renderer.properties.get(m) as { programs?: Map<string, { getUniforms(): unknown }> }).programs?.forEach((p) => p.getUniforms());
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      for (const u of Object.values((m.userData.uniforms ?? {}) as Record<string, { value: unknown }>)) if (u.value instanceof THREE.Texture) textures.add(u.value);
    }
    for (const t of textures) {
      await nextFrame();
      renderer.initTexture(t);
    }
    // built isn't finished: the driver makes the rest of a program on its first draw (Metal its
    // pipelines), a third of a second at once if left to the reveal. So each part is drawn once,
    // alone, into the picture's own target, unseen, one a frame
    const parts: THREE.Object3D[] = [...bodies.map((b) => b.mesh), ground, ...heads.flatMap((h) => (h ? [h.group] : []))];
    for (const p of parts) {
      await nextFrame();
      const was = parts.map((q) => q.visible);
      parts.forEach((q) => (q.visible = q === p));
      post.drawScene(scene, camera);
      parts.forEach((q, i) => (q.visible = was[i]));
    }
    await nextFrame();
  } catch {
    /* built on the first frame then */
  }
  revealing = true;
  document.body.classList.remove('loading');
}
void load();

Object.assign(window, { __snakes: { SCARE, LOOK, PERIOD, skins, world, snakes, tracks, camera, controls, bodies, renderer, scene, contact } });
