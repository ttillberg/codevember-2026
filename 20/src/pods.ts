import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { POD_SUN } from './materials';

// The other pod in the hall, and the machines the controls (bottom left, main.ts) will run. The twin of this one
// hangs from a trolley on a girder out in the hall, where the eye looks up as the page opens, its number painted
// on it in a script no one here reads, as this one has its own.

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

type Shape = 'ours' | 'round' | 'long' | 'twin' | 'box';
const NUMBER = [4, 7]; // this pod's
// (there were five others: a ball, a capsule, two balls, a box; only the twin of this one is left. prim() still
// makes the rest, if they are wanted back)
const PODS: { shape: Shape; num: number[]; hang?: [number, number, number] }[] = [
  // the twin, close: under the girder just behind this one, to the right as the eye first sees it, near enough to
  // show through the haze (x, the height of its middle, z; the girder is found above it)
  { shape: 'ours', num: [4, 1], hang: [9, 9, -6] },
  { shape: 'ours', num: NUMBER }, // this one
];

/** a machine the controls can take: something that runs along a line, one way or the other */
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

export function pods(o: {
  scene: THREE.Scene;
  pod: THREE.Object3D;
  /** where the pod's middle is, in the world, as it hangs at rest */
  podAt: THREE.Vector3;
  crane: Crane;
  spans: { a: THREE.Vector3; b: THREE.Vector3 }[];
  lifts: Lift[];
}) {
  const { scene, pod, crane } = o;

  // ---------- this pod's number, on the flank the eye sees first
  const plates = pod.getObjectByName('plates') as THREE.Mesh | undefined;
  // (not painted on it any more: its flank has its 03 and the rest of its markings back, from the model. The twin
  // keeps its number in the script)
  void plates;

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
    let k = 1; // (the first spot is straight behind this pod, from the eye: the next one shows)
    PODS.forEach((p, i) => {
      if (p.shape === 'ours' && p.num === NUMBER) return; // this one hangs where it hangs
      const h = p.hang;
      const placed = h && o.spans.find((s) => Math.abs(s.a.z - h[2]) < 0.1 && s.a.y > h[1] + 4 && s.a.x < h[0] && s.b.x > h[0] && s.a.y < h[1] + 20);
      const spot = placed ? { s: placed, c: new THREE.Vector3(h[0], placed.a.y, h[2]) } : spots[k++ % spots.length];
      const a = spot.s.a, b = spot.s.b;
      const L = placed ? a.y - h![1] : 7;
      const trolley = new THREE.Group();
      trolley.position.set(spot.c.x + (placed ? 0 : i % 2 ? -2 : 2), a.y - 0.15, a.z);
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

  // the other pods: a trolley pushed along, a pod swinging under it (driven from the controls, later)
  return {
    pods: podMachines,
    lifts: liftMachines,
    update(dt: number) {
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
    },
  };
}
// (filled as they are made)
const podMachines: Machine[] = [];
