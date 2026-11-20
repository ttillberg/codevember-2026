import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { POD_SUN } from './materials';

// A game for the curious. Beside the pod's door there is a small controller; press it and a hologram comes up,
// bottom left, that runs the machines of the hall. Its menus are in a script no one here reads. The pods hanging
// in the hall are listed by their shapes and their numbers, and each has its number painted on it in the same
// script: pick one and you have its crane, and it moves, wherever it hangs. Find this one, run it to the dock at
// the far end of its girder, gently, and the door opens. The hoists are on the menu too. (What comes out, and the
// way down, are for later.)

// ---------- the script: each glyph a few strokes on a box 2 wide and 3 tall
type Glyph = [number, number][][];
const GLYPHS: Glyph[] = [
  [[[0, 0], [2, 0], [2, 3]], [[0, 1.5], [1.2, 1.5]]],
  [[[1, 0], [1, 3]], [[0, 3], [2, 3]], [[0, 0.8], [1, 0]]],
  [[[0, 0], [2, 1.2], [0, 3]], [[2, 3], [2, 2.2]]],
  [[[0, 0], [0, 3], [2, 3]], [[1, 0], [2, 0.8]]],
  [[[0, 1], [1, 0], [2, 1], [1, 2]], [[1, 2], [1, 3]]],
  [[[0, 0], [2, 0]], [[1, 0], [1, 1.6]], [[0, 3], [1, 1.6], [2, 3]]],
  [[[0, 3], [0, 0], [2, 1.5]], [[1.2, 2.4], [2, 3]]],
  [[[0, 0], [2, 3]], [[2, 0], [1.2, 1.2]], [[0, 3], [0.8, 1.8]]],
  [[[0, 1.5], [2, 1.5]], [[1, 0], [1, 3]], [[0, 0], [0, 0.6]], [[2, 3], [2, 2.4]]],
  [[[0, 0], [2, 0], [0, 3], [2, 3]]],
];
const wordWidth = (n: number, h: number) => n * (2 * h) / 3 + (n - 1) * h * 0.3;
/** a word of the script, its top left at x, y, `h` tall */
function drawWord(g: CanvasRenderingContext2D, word: number[], x: number, y: number, h: number) {
  const s = h / 3;
  word.forEach((n, i) => {
    const ox = x + i * (2 * s + s * 0.9);
    for (const stroke of GLYPHS[n]) {
      g.beginPath();
      stroke.forEach(([u, v], k) => (k ? g.lineTo(ox + u * s, y + v * s) : g.moveTo(ox + u * s, y + v * s)));
      g.stroke();
    }
  });
}

// ---------- the pods, as the menu draws them: outlines on a box 40 wide, 60 tall
type Shape = 'ours' | 'round' | 'long' | 'twin' | 'box';
const SHAPES: Record<Shape, { body: string; lines: string }> = {
  // this pod front on: wide shoulders, a seam down it, the hatch's window high on the right
  ours: { body: 'M13 5h14l8 11-2 25-9 15h-8L7 41 5 16z', lines: 'M20 5l-2 51M23 12h4v10h-4z' },
  round: { body: 'M3 30a17 17 0 1 0 34 0a17 17 0 1 0-34 0z', lines: 'M3 30h34' },
  long: { body: 'M13 10a7 7 0 0 1 14 0v40a7 7 0 0 1-14 0z', lines: 'M13 22h14M13 38h14' },
  twin: { body: 'M9 18a11 11 0 1 0 22 0a11 11 0 1 0-22 0zM9 43a11 11 0 1 0 22 0a11 11 0 1 0-22 0z', lines: 'M20 29v3' },
  box: { body: 'M8 10h24l2 2v36l-2 2H8l-2-2V12z', lines: 'M6 22h28M6 34h28' },
};
const NUMBER = [4, 7]; // this pod's
const PODS: { shape: Shape; num: number[] }[] = [
  { shape: 'round', num: [4, 7] },
  { shape: 'long', num: [0, 3] },
  { shape: 'ours', num: [4, 1] },
  { shape: 'box', num: [8, 5] },
  { shape: 'ours', num: NUMBER }, // this one
  { shape: 'twin', num: [6, 2] },
];
const WORDS = { pods: [3, 9, 0], lifts: [1, 6], fans: [5, 2, 8], back: [9], dock: [2, 0], link: [8, 4, 1] };

/** a machine the hologram can take: something that runs along a line, one way or the other */
interface Machine {
  kind: 'pod' | 'lift';
  shape?: Shape;
  num: number[];
  lo: number;
  hi: number;
  dock?: number;
  at(): number;
  speed(): number;
  link(): void;
  push(d: number): void;
}

/** paint a word of the script on a mesh, where a ray from `from` (a direction, from the mesh's middle) meets it */
function paint(mesh: THREE.Mesh, word: number[], from: THREE.Vector3, size: number, lift = 0) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d')!;
  g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = 15; g.lineCap = 'square';
  const h = 102, w = wordWidth(word.length, h);
  drawWord(g, word, 128 - w / 2, 18, h);
  g.fillRect(128 - w / 2 - 6, 18 + h + 16, w + 12, 7); // a bar under it, as stencils have
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.62, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  mat.defines = { ...POD_SUN, NO_POINT: '' };
  mesh.updateWorldMatrix(true, false);
  const mid = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).add(new THREE.Vector3(0, lift, 0));
  const hit = new THREE.Raycaster(mid.clone().addScaledVector(from, 8), from.clone().negate()).intersectObject(mesh)[0];
  if (!hit?.face) return;
  const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  const m = new THREE.Matrix4().lookAt(hit.point.clone().add(n), hit.point, new THREE.Vector3(0, 1, 0));
  const decal = new THREE.Mesh(new DecalGeometry(mesh, hit.point, new THREE.Euler().setFromRotationMatrix(m), new THREE.Vector3(size, size * 0.62, size)), mat);
  decal.geometry.applyMatrix4(mesh.matrixWorld.clone().invert()); // (made in the world: into the mesh's own space, to go where it goes)
  mesh.add(decal);
}

export interface Crane {
  link(): void;
  push(d: number): void;
  at(): number;
  speed(): number;
  dock: number;
  end: number;
}
interface Lift { lo: number; hi: number; at(): number; speed(): number; link(): void; push(d: number): void }

export function game(o: {
  scene: THREE.Scene;
  pod: THREE.Object3D;
  /** where the pod's middle is, in the world, as it hangs at rest */
  podAt: THREE.Vector3;
  door: THREE.Object3D;
  crane: Crane;
  spans: { a: THREE.Vector3; b: THREE.Vector3 }[];
  lifts: Lift[];
  fans: { on: boolean }[];
  /** the pod is in the dock: open the door */
  docked(): void;
}) {
  const { scene, pod, door, crane } = o;

  // ---------- this pod's number, on the flank the eye sees first
  const plates = pod.getObjectByName('plates') as THREE.Mesh | undefined;
  if (plates) paint(plates, NUMBER, new THREE.Vector3(-0.55, 0.05, 0.83).normalize(), 0.5, -0.15);

  // ---------- the other pods, hanging from trolleys on girders out in the hall, where the eye looks up as the
  // page opens; each its own shape and its number painted on the side that faces this one
  const others: { m: Machine; trolley: THREE.Group; hanger: THREE.Group; x: number; v: number; push: number; ang: number; vang: number; a: THREE.Vector3; L: number }[] = [];
  {
    const look = new THREE.Vector3(0.56, 0, -0.83);
    const spots = o.spans
      .filter((s) => Math.abs(s.a.y - 22) < 0.1 && s.b.x - s.a.x > 10)
      .map((s) => ({ s, c: s.a.clone().add(s.b).multiplyScalar(0.5) }))
      .filter(({ c }) => { const d = Math.hypot(c.x - o.podAt.x, c.z - o.podAt.z); return d > 14 && d < 50; })
      .sort((p, q) => q.c.clone().sub(o.podAt).setY(0).normalize().dot(look) - p.c.clone().sub(o.podAt).setY(0).normalize().dot(look));
    const white = new THREE.MeshStandardMaterial({ color: 0xcfd0cc, roughness: 0.42, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.8 });
    // the twin of this pod, the one easy to take for it: its outside only, in a few meshes, no lights, no glass
    // (by the mesh's own name, or its object's where the glb split it by material: pod_1, pod_2; not by whatever it
    // hangs under, or all of this pod's small things would come along)
    const KEEP = new Set(['pod', 'plates', 'door', 'door_plates', 'door_frame', 'door_board', 'deck', 'hoses', 'blocks', 'under', 'mech']);
    const twin = () => {
      const c = pod.clone(true);
      const drop: THREE.Object3D[] = [];
      c.traverse((x) => {
        if ((x as THREE.Light).isLight) drop.push(x);
        else if ((x as THREE.Mesh).isMesh && !KEEP.has(x.name.replace(/[._]\d+$/, ''))) drop.push(x);
      });
      for (const x of drop) x.removeFromParent();
      c.traverse((x) => { x.castShadow = false; });
      c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1);
      c.applyMatrix4(new THREE.Matrix4().makeTranslation(-o.podAt.x, -o.podAt.y, -o.podAt.z).multiply(pod.matrixWorld));
      return c;
    };
    const prim = (shape: Shape) => {
      const g = new THREE.Group();
      const add = (geo: THREE.BufferGeometry, y = 0, m = white) => { const x = new THREE.Mesh(geo, m); x.position.y = y; g.add(x); return x; };
      if (shape === 'round') { add(new THREE.SphereGeometry(1.35, 32, 20)); add(new THREE.CylinderGeometry(1.38, 1.38, 0.18, 32), 0, dark); }
      else if (shape === 'long') { add(new THREE.CapsuleGeometry(0.62, 2.6, 8, 24)); add(new THREE.CylinderGeometry(0.65, 0.65, 0.12, 24), 0.6, dark); add(new THREE.CylinderGeometry(0.65, 0.65, 0.12, 24), -0.6, dark); }
      else if (shape === 'twin') { add(new THREE.SphereGeometry(0.85, 28, 18), 0.95); add(new THREE.SphereGeometry(0.85, 28, 18), -0.95); add(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16), 0, dark); }
      else { add(new THREE.BoxGeometry(1.6, 2.5, 1.5)); add(new THREE.BoxGeometry(1.66, 0.12, 1.56), 0.42, dark); add(new THREE.BoxGeometry(1.66, 0.12, 1.56), -0.42, dark); }
      return g;
    };
    const wire = new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 1, roughness: 0.4 });
    let k = 0;
    PODS.forEach((p, i) => {
      if (p.shape === 'ours' && p.num === NUMBER) return; // this one hangs where it hangs
      const spot = spots[k++ % spots.length];
      const a = spot.s.a, b = spot.s.b;
      const L = 7;
      const trolley = new THREE.Group();
      trolley.position.set(spot.c.x + (i % 2 ? -2 : 2), a.y - 0.15, a.z);
      const truck = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 1.7), dark);
      trolley.add(truck);
      const hanger = new THREE.Group();
      trolley.add(hanger);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L - 1.2, 6).translate(0, -(L - 1.2) / 2, 0), wire);
      hanger.add(rope);
      const body = p.shape === 'ours' ? twin() : prim(p.shape);
      body.position.y -= L;
      // turned to face this pod, so its number shows
      const face = new THREE.Group();
      face.rotation.y = Math.atan2(o.podAt.x - trolley.position.x, o.podAt.z - trolley.position.z) + (p.shape === 'ours' ? 0.7 : 0);
      face.add(body);
      hanger.add(face);
      scene.add(trolley);
      trolley.updateWorldMatrix(true, true);
      // its number, on the side towards this pod
      const toward = o.podAt.clone().sub(trolley.position).setY(0).normalize();
      let target: THREE.Mesh | undefined;
      body.traverse((x) => { if (!target && (x as THREE.Mesh).isMesh && (x.name === 'plates' || p.shape !== 'ours')) target = x as THREE.Mesh; });
      if (target) paint(target, p.num, toward, p.shape === 'ours' ? 0.5 : 0.9, p.shape === 'ours' ? -0.15 : 0);
      const lo = a.x + 1.6, hi = b.x - 1.6;
      const st = { x: trolley.position.x, v: 0, push: 0, ang: 0, vang: 0 };
      const m: Machine = {
        kind: 'pod', shape: p.shape, num: p.num, lo, hi,
        at: () => st.x, speed: () => st.v, link: () => {}, push: (d) => { st.push = d; },
      };
      others.push(Object.assign(st, { m, trolley, hanger, a, L }) as never);
      podMachines[i] = m;
    });
  }

  // ---------- this pod, and the hoists, as machines
  podMachines[PODS.findIndex((p) => p.num === NUMBER)] = {
    kind: 'pod', shape: 'ours', num: NUMBER, lo: -crane.end, hi: crane.end, dock: crane.dock,
    at: crane.at, speed: crane.speed, link: crane.link, push: crane.push,
  };
  const liftMachines: Machine[] = o.lifts.map((l, i) => ({ kind: 'lift', num: [(i * 3 + 1) % 10, (9 - i * 2 + 10) % 10], ...l }));

  // ---------- the controller: a small box on the pod, just past the door's free edge, its lens blinking
  const ctl = new THREE.Group();
  const hitArea = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  const lens = new THREE.MeshBasicMaterial({ color: 0x6ff3ff });
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.035), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.8 }));
    body.position.z = 0.017;
    body.castShadow = true;
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 16).rotateX(Math.PI / 2), lens);
    eye.position.set(0, 0.035, 0.037);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.004), lens);
    slot.position.set(0, -0.03, 0.036);
    ctl.add(body, eye, slot, hitArea);
    // where: in the door's own space its outward face is +x and the hinge runs along z; its free edge is the
    // side of y farther from the hinge. A little past that, on the pod
    door.updateWorldMatrix(true, true);
    const db = new THREE.Box3();
    const inv = door.matrixWorld.clone().invert();
    door.traverse((m) => { const mesh = m as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.computeBoundingBox(); db.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld))); } });
    const free = Math.abs(db.max.y) > Math.abs(db.min.y) ? 1 : -1;
    const local = new THREE.Vector3(db.max.x, free > 0 ? db.max.y + 0.14 : db.min.y - 0.14, (db.min.z + db.max.z) / 2 + 0.15);
    const at = local.clone().applyMatrix4(door.matrixWorld);
    const out = new THREE.Vector3(1, 0, 0).transformDirection(door.matrixWorld);
    const hits = new THREE.Raycaster(at.clone().addScaledVector(out, 0.6), out.clone().negate(), 0, 1.5).intersectObject(pod, true);
    const h = hits.find((x) => { let p: THREE.Object3D | null = x.object; while (p && p !== door) p = p.parent; return !p && x.object.visible; });
    const n = h?.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : out;
    ctl.position.copy(h ? h.point : at);
    ctl.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), n.clone().negate(), new THREE.Vector3(0, 0, 1).transformDirection(door.matrixWorld)));
    pod.attach(ctl);
  }

  // ---------- the hologram: a panel drawn into a canvas, shown on a quad over the scene with a shader that makes
  // it light: scanlines, a flicker, rows that slip now and then, edges split a little, coming up from a line
  const W = 320, H = 252, K = 2; // its size on screen, css px, and the canvas's pixels to one
  const cv = document.createElement('canvas');
  cv.width = W * K; cv.height = H * K;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv); // (its colours as they are: drawn straight to the screen, after the tone mapping)
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const holoMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, boot: { value: 0 }, size: { value: new THREE.Vector2(W, H) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float time, boot;
      uniform vec2 size;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        // comes up from a line across the middle
        float open = smoothstep(0.0, 1.0, boot);
        if (abs(uv.y - 0.5) > 0.5 * open + 0.004) discard;
        // a row slips sideways now and then
        float row = floor(uv.y * size.y / 3.0);
        float slip = step(0.993, hash(row + floor(time * 12.0))) * (hash(row * 1.7) - 0.5) * 0.04;
        uv.x += slip;
        vec4 c = texture2D(map, uv);
        // the edges split a little, red one way, blue the other
        float r = texture2D(map, uv + vec2(0.003, 0.0)).a, b = texture2D(map, uv - vec2(0.003, 0.0)).a;
        vec3 col = c.rgb + vec3(r - c.a, 0.0, b - c.a) * 0.35;
        float scan = 0.78 + 0.22 * sin(vUv.y * size.y * 3.14159 * 0.7 - time * 6.0);
        float flick = 0.9 + 0.1 * sin(time * 31.0) * sin(time * 7.7) + step(0.985, hash(floor(time * 20.0))) * 0.35;
        float a = max(c.a, max(r, b) * 0.6);
        gl_FragColor = vec4(col * scan * flick, a * scan * flick);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), holoMat);
  // and a dark glass behind it, so it reads against the bright haze (light alone cannot darken)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x01070b, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  glass.renderOrder = -1;
  const hud = new THREE.Scene();
  hud.add(glass, quad);
  const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const rect = { x: 24, y: 24, w: W, h: H }; // where the panel is on screen: left, bottom, css px
  let shown = false;
  let bootT = 0;

  type Screen = 'root' | 'pods' | 'lifts' | 'fans' | 'drive';
  let screen: Screen = 'root';
  let driving: Machine | null = null;
  let held = 0;
  let hover = '';
  let shake: { id: string; t: number } | null = null;
  let done = false;
  const linked = new Set<Machine>();
  const regions: { id: string; x: number; y: number; w: number; h: number }[] = [];

  const CYAN = '#8ff4ff';
  const draw = () => {
    regions.length = 0;
    g.setTransform(K, 0, 0, K, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineCap = 'square';
    g.lineJoin = 'miter';
    // the ground: a faint fill, a frame with its corners cut
    g.fillStyle = 'rgba(70, 200, 240, 0.13)';
    g.strokeStyle = CYAN;
    g.lineWidth = 1.2;
    g.shadowColor = 'rgba(120, 235, 255, 0.9)';
    g.shadowBlur = 8;
    const frame = new Path2D('M10 1H310L319 10V242L310 251H10L1 242V10Z');
    g.fill(frame);
    g.stroke(frame);
    const button = (id: string, x: number, y: number, w: number, h: number, on = false) => {
      regions.push({ id, x, y, w, h });
      let dx = 0;
      if (shake?.id === id) dx = Math.sin(shake.t * 60) * 4 * Math.max(0, 1 - shake.t / 0.4);
      g.save();
      g.translate(dx, 0);
      g.fillStyle = on ? 'rgba(120, 235, 255, 0.3)' : hover === id ? 'rgba(120, 235, 255, 0.14)' : 'rgba(120, 235, 255, 0.04)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(143, 244, 255, 0.55)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.restore();
      return dx;
    };
    const word = (wd: number[], cx: number, y: number, h: number) => {
      g.strokeStyle = CYAN;
      g.lineWidth = Math.max(1.3, h / 7);
      drawWord(g, wd, cx - wordWidth(wd.length, h) / 2, y, h);
    };
    const sil = (shape: Shape, cx: number, cy: number, h: number) => {
      g.save();
      g.translate(cx - (h * 40) / 60 / 2, cy - h / 2);
      g.scale(h / 60, h / 60);
      g.fillStyle = 'rgba(120, 235, 255, 0.22)';
      g.strokeStyle = CYAN;
      g.lineWidth = 1.6;
      const b = new Path2D(SHAPES[shape].body);
      g.fill(b); g.stroke(b);
      g.stroke(new Path2D(SHAPES[shape].lines));
      g.restore();
    };
    const icon = (k: 'pods' | 'lifts' | 'fans', cx: number, cy: number, h: number) => {
      if (k === 'pods') return sil('ours', cx, cy, h);
      g.save();
      g.translate(cx - (h * 40) / 60 / 2, cy - h / 2);
      g.scale(h / 60, h / 60);
      g.strokeStyle = CYAN; g.fillStyle = 'rgba(120, 235, 255, 0.22)'; g.lineWidth = 1.6;
      if (k === 'lifts') { g.stroke(new Path2D('M12 4v52M28 4v52')); g.fillRect(13, 24, 14, 12); g.strokeRect(13, 24, 14, 12); g.stroke(new Path2D('M20 8l-4 6h8zM20 52l-4-6h8z')); }
      else { g.stroke(new Path2D('M4 30a16 16 0 1 0 32 0a16 16 0 1 0-32 0')); const bl = new Path2D('M20 30l2-14 5 2zM20 30l12 7-3 4zM20 30l-14 6-1-5z'); g.fill(bl); g.stroke(bl); }
      g.restore();
    };
    // the top: back, what this is, close
    if (screen !== 'root') { button('back', 12, 10, 30, 24); word(WORDS.back, 27, 15, 14); }
    const t = screen === 'drive' ? WORDS.link : screen === 'root' ? [] : WORDS[screen];
    if (t.length) word(t, W / 2, 14, 15);
    button('close', W - 42, 10, 30, 24);
    g.strokeStyle = CYAN; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(W - 33, 16); g.lineTo(W - 21, 28); g.moveTo(W - 21, 16); g.lineTo(W - 33, 28); g.stroke();
    // a grid of tiles under the top
    const tiles = (n: number, each: (i: number, x: number, y: number, w: number, h: number) => void) => {
      const cols = 3, gap = 8, x0 = 12, y0 = 44, tw = (W - 2 * x0 - (cols - 1) * gap) / cols;
      const rows = Math.ceil(n / cols), th = Math.min(96, (H - y0 - 12 - (rows - 1) * gap) / rows);
      for (let i = 0; i < n; i++) each(i, x0 + (i % cols) * (tw + gap), y0 + Math.floor(i / cols) * (th + gap), tw, th);
    };
    if (screen === 'root') {
      const ks = ['pods', 'lifts', 'fans'] as const;
      tiles(3, (i, x, y, w, h) => { const dx = button(ks[i], x, y + 30, w, h + 40); icon(ks[i], x + w / 2 + dx, y + 30 + (h + 40) / 2 - 12, 62); word(WORDS[ks[i]], x + w / 2 + dx, y + h + 46, 12); });
    } else if (screen === 'pods') {
      tiles(PODS.length, (i, x, y, w, h) => {
        const dx = button('pod' + i, x, y, w, h, driving === podMachines[i]);
        sil(PODS[i].shape, x + w / 2 + dx, y + h / 2 - 8, h - 36);
        word(PODS[i].num, x + w / 2 + dx, y + h - 22, 13);
      });
    } else if (screen === 'lifts') {
      tiles(liftMachines.length, (i, x, y, w, h) => {
        const dx = button('lift' + i, x, y, w, h, driving === liftMachines[i]);
        icon('lifts', x + w / 2 + dx, y + h / 2 - 8, h - 36);
        word(liftMachines[i].num, x + w / 2 + dx, y + h - 22, 13);
      });
    } else if (screen === 'fans') {
      tiles(o.fans.length, (i, x, y, w, h) => {
        button('fan' + i, x, y, w, h, o.fans[i].on);
        g.globalAlpha = o.fans[i].on ? 1 : 0.4;
        icon('fans', x + w / 2, y + h / 2 - 8, h - 36);
        word([(i * 3) % 10, (i * 7 + 2) % 10], x + w / 2, y + h - 22, 13);
        g.globalAlpha = 1;
      });
    } else if (driving) {
      const m = driving;
      const u = (m.at() - m.lo) / (m.hi - m.lo);
      g.strokeStyle = CYAN; g.lineWidth = 2;
      if (m.kind === 'pod') {
        // the girder, the pod on it, the dock if it has one
        const x0 = 30, x1 = W - 30, y = 70;
        g.beginPath(); g.moveTo(x0 - 8, y); g.lineTo(x1 + 8, y); g.stroke();
        g.lineWidth = 1;
        for (let x = x0 - 8; x <= x1 + 8; x += 12) { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.stroke(); }
        if (m.dock !== undefined) {
          const dx = x0 + ((m.dock - m.lo) / (m.hi - m.lo)) * (x1 - x0);
          g.setLineDash([3, 3]); g.beginPath(); g.moveTo(dx, y + 4); g.lineTo(dx, y + 78); g.stroke(); g.setLineDash([]);
          word(WORDS.dock, dx, 44, 11);
        }
        const cx = x0 + u * (x1 - x0);
        g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + 14); g.stroke();
        sil(m.shape!, cx, y + 44, 56);
      } else {
        // the mast, the cage on it
        const y0 = 52, y1 = 166, x = W / 2;
        g.beginPath(); g.moveTo(x - 12, y0 - 6); g.lineTo(x - 12, y1 + 6); g.moveTo(x + 12, y0 - 6); g.lineTo(x + 12, y1 + 6); g.stroke();
        const cy = y1 - u * (y1 - y0);
        g.fillStyle = 'rgba(120, 235, 255, 0.3)'; g.fillRect(x - 9, cy - 8, 18, 16); g.strokeRect(x - 9, cy - 8, 18, 16);
        word(m.num, x + 40, cy - 7, 13);
      }
      // the lever: either way, held
      const by = H - 60;
      const back = m.kind === 'pod' ? 'left' : 'down', fore = m.kind === 'pod' ? 'right' : 'up';
      button('push-1', 14, by, 64, 46, held === -1);
      button('push1', W - 78, by, 64, 46, held === 1);
      const arrow = (cx: number, cy: number, dir: string) => {
        g.fillStyle = CYAN;
        g.beginPath();
        if (dir === 'left') { g.moveTo(cx - 9, cy); g.lineTo(cx + 7, cy - 9); g.lineTo(cx + 7, cy + 9); }
        else if (dir === 'right') { g.moveTo(cx + 9, cy); g.lineTo(cx - 7, cy - 9); g.lineTo(cx - 7, cy + 9); }
        else if (dir === 'up') { g.moveTo(cx, cy - 9); g.lineTo(cx - 9, cy + 7); g.lineTo(cx + 9, cy + 7); }
        else { g.moveTo(cx, cy + 9); g.lineTo(cx - 9, cy - 7); g.lineTo(cx + 9, cy - 7); }
        g.fill();
      };
      arrow(46, by + 23, back);
      arrow(W - 46, by + 23, fore);
      // how fast
      const v = Math.min(1, Math.abs(m.speed()) / (m.kind === 'pod' ? 0.6 : 1.4));
      g.strokeStyle = 'rgba(143, 244, 255, 0.55)'; g.lineWidth = 1;
      g.strokeRect(92, by + 19, W - 184, 8);
      g.fillStyle = CYAN; g.fillRect(92, by + 19, (W - 184) * v, 8);
      if (done && m === podMachines[PODS.findIndex((p) => p.num === NUMBER)]) word([4, 7, 2, 0], W / 2, by - 30, 14);
    }
    tex.needsUpdate = true;
  };

  const press = (id: string) => {
    if (id === 'close') { shown = false; release(); return; }
    if (id === 'back') { release(); screen = screen === 'drive' ? (driving?.kind === 'lift' ? 'lifts' : 'pods') : 'root'; draw(); return; }
    if (id === 'pods' || id === 'lifts' || id === 'fans') { screen = id; bootT = 0.6; draw(); return; }
    if (id.startsWith('pod') || id.startsWith('lift')) {
      const m = id.startsWith('pod') ? podMachines[+id.slice(3)] : liftMachines[+id.slice(4)];
      if (!linked.has(m)) { m.link(); linked.add(m); }
      driving = m;
      screen = 'drive';
      bootT = 0.6;
      draw();
      return;
    }
    if (id.startsWith('fan')) { const f = o.fans[+id.slice(3)]; f.on = !f.on; draw(); return; }
    if (id.startsWith('push') && driving) { held = id === 'push1' ? 1 : -1; driving.push(held); draw(); }
  };
  const release = () => { if (held && driving) driving.push(0); held = 0; };

  /** a css px point on the page to a point in the panel, or null */
  const local = (e: { clientX: number; clientY: number }) => {
    const x = e.clientX - rect.x, y = e.clientY - (innerHeight - rect.y - rect.h);
    return x >= 0 && y >= 0 && x <= rect.w && y <= rect.h ? { x: (x / rect.w) * W, y: (y / rect.h) * H } : null;
  };
  const at = (p: { x: number; y: number }) => regions.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.id ?? '';
  let down = false;
  window.addEventListener('keydown', (e) => {
    if (!shown || screen !== 'drive' || !driving || e.repeat) return;
    const k: Record<string, number> = driving.kind === 'pod' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowDown: -1, ArrowUp: 1 };
    const d = k[e.key];
    if (d) { held = d; driving.push(d); }
  });
  window.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) release(); });

  let blink = 0;
  return {
    /** what the controller is, to be pressed */
    target: hitArea,
    /** where the player is, for the debug panel's copy */
    state: () => ({ shown, screen, driving: driving ? `${driving.kind} ${driving.num.join('')}` : null, linked: linked.size, docked: done }),
    open() {
      shown = true;
      bootT = 0;
      if (!driving) screen = 'root';
      draw();
    },
    /** the page's pointer, first to the hologram: true if it was for it */
    pointer(type: 'down' | 'move' | 'up', e: PointerEvent) {
      if (!shown) return false;
      const p = local(e);
      if (type === 'move') {
        const h = p ? at(p) : '';
        if (h !== hover) { hover = h; draw(); }
        return down;
      }
      if (type === 'up') { const was = down; down = false; release(); if (screen === 'drive') draw(); return was; }
      if (!p) return false;
      down = true;
      const id = at(p);
      if (id) press(id);
      else if (screen === 'pods' || screen === 'lifts') { /* the ground of the panel: nothing */ }
      return true;
    },
    resize(w: number, h: number) {
      const small = w < 640;
      rect.w = Math.min(W, w - 32);
      rect.h = (rect.w / W) * H;
      rect.x = small ? 16 : 24;
      rect.y = small ? 16 : 24;
      hudCam.right = w; hudCam.top = h; hudCam.updateProjectionMatrix();
      quad.scale.set(rect.w, rect.h, 1);
      quad.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, 0);
      glass.position.copy(quad.position);
    },
    update(dt: number) {
      blink += dt;
      lens.color.setRGB(0.25, 0.85, 1).multiplyScalar(shown ? 1 : 0.35 + 0.65 * (Math.sin(blink * 3) > 0.6 ? 1 : 0.15));
      // the other pods: a trolley pushed along, a pod swinging under it
      for (const p of others) {
        p.v += (p.push * 0.22 - 0.35 * p.v) * dt;
        const was = p.v;
        p.x += p.v * dt;
        if (p.x < p.m.lo || p.x > p.m.hi) { p.x = THREE.MathUtils.clamp(p.x, p.m.lo, p.m.hi); p.v *= -0.15; }
        const acc = (p.v - was) / Math.max(dt, 1e-3);
        p.vang += (-(9.8 / p.L) * p.ang - 0.12 * p.vang - acc / p.L) * dt;
        p.ang += p.vang * dt;
        p.trolley.position.x = p.x;
        p.hanger.rotation.z = p.ang;
      }
      if (shake) { shake.t += dt; if (shake.t > 0.4) shake = null; }
      if (!done) {
        const ours = podMachines[PODS.findIndex((p) => p.num === NUMBER)];
        if (linked.has(ours) && Math.abs(ours.at() - crane.dock) < 0.3 && Math.abs(ours.speed()) < 0.12) { done = true; o.docked(); }
      }
      if (shown) {
        bootT += dt;
        holoMat.uniforms.time.value += dt;
        holoMat.uniforms.boot.value = Math.min(1, bootT / 0.35);
        const b = holoMat.uniforms.boot.value;
        glass.scale.set(rect.w - 4, Math.max(1, (rect.h - 4) * b * b * (3 - 2 * b)), 1);
        if (screen === 'drive') draw();
      }
    },
    render(renderer: THREE.WebGLRenderer) {
      if (!shown) return;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.render(hud, hudCam);
      renderer.autoClear = auto;
    },
  };
}
// (filled as they are made)
const podMachines: Machine[] = [];
