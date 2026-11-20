import * as THREE from 'three';

// One thread, start to end. The whole path is laid out up front (seeded, so it is the same cocoon every time)
// and the worm only reveals it: guy lines out to the twigs first, then a loose floss, then the shell in figure
// eights, from the outside in. The thread is drawn as plain 1 px lines, added up into a float target: how many
// threads cross a pixel. A second pass turns that count into silk: thin lets the glow inside through, thick hides it.

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');

const N = 420_000; // points of thread
const AXES = new THREE.Vector3(0.56, 1, 0.56); // the cocoon, an ellipsoid
const LEG = 70; // points in one guy line
const LEGS = 36;
const GUY = LEG * LEGS;

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function layThread(): Float32Array {
  const rnd = mulberry32(20);
  const pos = new Float32Array(N * 3);
  let i = 0;
  const put = (x: number, y: number, z: number) => {
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    i++;
  };
  const randDir = (): [number, number, number] => {
    const y = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };

  // 1. guy lines: out to a twig somewhere off screen, back to a point near the cocoon, out again
  const anchors: [number, number, number][] = [];
  for (let k = 0; k < 9; k++) {
    const d = randDir();
    d[1] = d[1] * 0.6 + 0.25; // more of them up than down
    const l = Math.hypot(d[0], d[1], d[2]);
    const r = (6 + rnd() * 3) / l;
    anchors.push([d[0] * r, d[1] * r, d[2] * r]);
  }
  let cur = anchors[0];
  let last = 0;
  for (let leg = 0; leg < LEGS; leg++) {
    let to: [number, number, number];
    if (leg % 2) {
      let k = last;
      while (k === last) k = Math.floor(rnd() * anchors.length);
      last = k;
      to = anchors[k];
    } else {
      const d = randDir();
      const r = 1.2 + rnd() * 0.5;
      to = [d[0] * AXES.x * r, d[1] * AXES.y * r, d[2] * AXES.z * r];
    }
    const sag = 0.03 * Math.hypot(to[0] - cur[0], to[1] - cur[1], to[2] - cur[2]);
    for (let k = 1; k <= LEG; k++) {
      const s = k / LEG;
      put(cur[0] + (to[0] - cur[0]) * s, cur[1] + (to[1] - cur[1]) * s - 4 * s * (1 - s) * sag, cur[2] + (to[2] - cur[2]) * s);
    }
    cur = to;
  }

  // 2. floss, then shell. d is where the worm is on the unit sphere, v the way it creeps; its head swings a
  // figure eight across that way. Loose and wide at first, then tight, and the radius shrinks as the wall thickens.
  const d = new THREE.Vector3(cur[0] / AXES.x, cur[1] / AXES.y, cur[2] / AXES.z).normalize();
  const v = new THREE.Vector3(...randDir());
  const t2 = new THREE.Vector3();
  const q = new THREE.Vector3();
  let phi = 0;
  const first = i;
  while (i < N) {
    const s = (i - first) / (N - first);
    const loose = 1 - smoothstep(0, 0.09, s);
    const swing = 0.3 + 0.7 * loose;
    const creep = 0.0013 + 0.004 * loose;
    const turn = 0.02 + 0.08 * loose;
    const r = randDir();
    v.x += r[0] * turn;
    v.y += r[1] * turn;
    v.z += r[2] * turn;
    v.addScaledVector(d, -v.dot(d)).normalize();
    d.addScaledVector(v, creep).normalize();
    v.addScaledVector(d, -v.dot(d)).normalize();
    phi += (Math.PI * 2) / (56 + 12 * Math.sin(i * 0.0007));
    t2.crossVectors(d, v);
    q.copy(d)
      .addScaledVector(t2, Math.sin(phi) * swing)
      .addScaledVector(v, Math.sin(phi) * Math.cos(phi) * swing)
      .normalize();
    const wander = Math.sin(i * 0.013 + 1.3) * Math.sin(i * 0.0041 + 0.2);
    const fuzz = Math.sin(i * 0.21) * Math.sin(i * 0.037 + 2);
    const rf = 1.09 - 0.19 * s + loose * (0.2 + 0.2 * wander) + 0.02 * fuzz;
    put(q.x * AXES.x * rf, q.y * AXES.y * rf, q.z * AXES.z * rf);
  }
  return pos;
}

// ---------- the thread, counted

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(layThread(), 3));

const threadMat = new THREE.ShaderMaterial({
  uniforms: {
    uHead: { value: 0 },
    uAxes: { value: AXES },
    uLight: { value: new THREE.Vector3(-0.5, 0.6, 0.62).normalize() }, // view space
  },
  vertexShader: /* glsl */ `
    uniform float uHead;
    uniform vec3 uAxes;
    uniform vec3 uLight;
    varying vec3 vAcc;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * (position / (uAxes * uAxes)));
      float facing = dot(n, normalize(-mv.xyz));
      float lit = clamp(dot(n, uLight) * 0.5 + 0.5, 0.0, 1.0);
      float w = facing > 0.0 ? 1.0 : 0.45; // the far wall counts for less
      float head = exp(-(uHead - float(gl_VertexID)) / 240.0); // the newest stretch, still wet
      vAcc = vec3(w, w * lit, head);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vAcc;
    void main() { gl_FragColor = vec4(vAcc, 1.0); }`,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  depthTest: false,
  depthWrite: false,
  transparent: true,
});

const thread = new THREE.Line(geo, threadMat);
thread.frustumCulled = false;
const tilt = new THREE.Group();
tilt.rotation.z = 0.32;
tilt.add(thread);
const pivot = new THREE.Group();
pivot.add(tilt);
const scene = new THREE.Scene();
scene.add(pivot);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

const acc = new THREE.WebGLRenderTarget(2, 2, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  samples: 4,
});

// ---------- the count, turned into silk

const silkMat = new THREE.ShaderMaterial({
  uniforms: {
    tAcc: { value: acc.texture },
    uCentre: { value: new THREE.Vector2(0.5, 0.5) },
    uAxis: { value: new THREE.Vector2(0, 1) }, // the cocoon's long axis on screen, world units
    uUnit: { value: 0.2 }, // one world unit, in screen heights
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uK: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tAcc;
    uniform vec2 uCentre, uAxis;
    uniform float uUnit, uAspect, uTime, uK;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 a = texture2D(tAcc, vUv).rgb;
      float lit = a.g / max(a.r, 1e-4);
      float through = exp(-a.r * uK);

      vec2 p = (vUv - uCentre) * vec2(uAspect, 1.0) / uUnit;
      vec3 bg = vec3(0.043, 0.047, 0.059) + vec3(0.045, 0.036, 0.028) * exp(-dot(p, p) * 0.1);

      // what is inside: a warm body, breathing
      float len = max(length(uAxis), 0.56);
      vec2 dir = uAxis / max(length(uAxis), 1e-4);
      float along = dot(p, dir) / (0.8 * len);
      float across = dot(p, vec2(-dir.y, dir.x)) / 0.46;
      float breath = 0.86 + 0.14 * sin(uTime * 0.9);
      float g = exp(-(along * along + across * across) * 1.7) * breath;
      vec3 amber = vec3(1.0, 0.6, 0.24);

      vec3 silk = vec3(0.97, 0.91, 0.79) * mix(0.16, 1.0, lit) + amber * g * 0.5;
      vec3 col = (bg + amber * g * 0.85) * through + silk * (1.0 - through);
      col += vec3(1.0, 0.94, 0.78) * (1.0 - exp(-a.b * 1.4));
      col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), silkMat);
screen.frustumCulled = false;
const screenScene = new THREE.Scene();
screenScene.add(screen);
const screenCam = new THREE.Camera();

// ---------- size

let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  acc.setSize(Math.round(w * dpr), Math.round(h * dpr));
  camera.aspect = w / h;
  // the cocoon is 2 units tall: half the screen's height, less on a narrow one
  const visH = Math.max(2 / 0.5, 2.6 / camera.aspect);
  camera.position.set(0, 0, visH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
  camera.updateProjectionMatrix();
  silkMat.uniforms.uAspect.value = camera.aspect;
  silkMat.uniforms.uUnit.value = 1 / visH;
  silkMat.uniforms.uK.value = 0.16 * dpr; // a 1 px line is half as wide on a 2x screen
}
window.addEventListener('resize', resize);
resize();

// ---------- turn it by hand

let yaw = 0.4;
let pitch = 0.12;
let vyaw = 0;
let vpitch = 0;
let held = false;
let px = 0;
let py = 0;
canvas.addEventListener('pointerdown', (e) => {
  held = true;
  px = e.clientX;
  py = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!held) return;
  vyaw = (e.clientX - px) * 0.006;
  vpitch = (e.clientY - py) * 0.006;
  yaw += vyaw;
  pitch = Math.min(1.1, Math.max(-1.1, pitch + vpitch));
  px = e.clientX;
  py = e.clientY;
});
const release = () => (held = false);
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---------- spin

// ?p=0.5 starts with half the thread out
let count = Math.min(1, Math.max(0, Number(query.get('p')) || 0)) * N;
// points a second: the guy lines one by one, then faster and faster
const rate = (c: number) => 150 + 2500 * smoothstep(GUY, GUY + 24_000, c);

const centre = new THREE.Vector3();
const top = new THREE.Vector3();
let then = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - then) / 1000);
  then = now;

  count = Math.min(N, count + rate(count) * dt);
  geo.setDrawRange(0, Math.max(2, Math.floor(count)));
  threadMat.uniforms.uHead.value = count;

  if (!held) {
    yaw += vyaw + 0.05 * dt;
    pitch = Math.min(1.1, Math.max(-1.1, pitch + vpitch));
    vyaw *= 0.94;
    vpitch *= 0.94;
  }
  pivot.rotation.set(pitch, yaw, 0);
  pivot.updateMatrixWorld(true);

  centre.set(0, 0, 0).project(camera);
  top.set(0, 1, 0).applyMatrix4(thread.matrixWorld).project(camera);
  const u = silkMat.uniforms;
  u.uCentre.value.set(centre.x * 0.5 + 0.5, centre.y * 0.5 + 0.5);
  u.uAxis.value.set(((top.x - centre.x) * 0.5 * camera.aspect) / u.uUnit.value, ((top.y - centre.y) * 0.5) / u.uUnit.value);
  u.uTime.value = now / 1000;

  renderer.setRenderTarget(acc);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(screenScene, screenCam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
