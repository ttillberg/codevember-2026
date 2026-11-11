import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { scratches, gouges, grunge, rng } from './decals';
import { logo, withLogos, type LogoName } from './logos';

// The device: a ball modelled in Blender (model/device.blend), exported to public/device.glb. A graphite core
// with one principal eye looking along -z, a blue collar, two green ring pods on the sides, and round it four shell
// petals, the walls: hinged at the back, open they trail like fins, shut they close the ball with only the eye out.
// Eight blades round the eye are its shutter. Radius 1 in the file; scaled here.

export const DEVICE_URL = `${import.meta.env.BASE_URL}device.glb`;
useGLTF.preload(DEVICE_URL);

export type Device = {
  g: THREE.Group;
  /** The scoop: `k` 0 home to 1 out on its arm in front of the eye, `at` how far out its bowl's centre is at full reach,
   * in device radii from the centre; `shut` 0 open to 1 closed, the blade swung over the bowl's mouth. */
  grip: (k: number, at: number, shut: number) => void;
  /** Clip every part of this copy to one side of these planes (needs the renderer's local clipping on). */
  clip: (planes: THREE.Plane[]) => void;
  /** Going through a wall: the seam at `plane` (world space, its clip plane) glows in `hex` and dithers away near it, so
   * the two copies interleave there rather than fight; `k` 0 to 1, how much. */
  warp: (plane: THREE.Plane, hex: string, k: number, t: number) => void;
  /** Tint the whole copy with a glow of `hex`, `k` strong: 0 as made. */
  tint: (hex: string, k: number) => void;
  /** Fade the whole copy: 1 as made, 0 gone; each material keeps its own opacity to fade from. */
  fade: (k: number) => void;
  /** 0 open (fins back) to 1 shut (the walls closed round the body). */
  shield: (k: number) => void;
  /** The brows, the four arcs round the eye: turned this far round the eye's axis (rad). */
  brow: (a: number) => void;
  /** 0 open to 1 shut, the blades across the eye. */
  shutter: (k: number) => void;
};

// Marks on the body. The meshes in the file have no UVs, so these are decals: a patch of the body's own triangles, cut
// and projected onto a transparent canvas, a child of the mesh it sits on (so a hinged petal carries its own).
const INK = '#d8d8d4';
const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const decalMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({
  map, transparent: true, depthTest: true, depthWrite: false, roughness: 0.6, metalness: 0.05,
  polygonOffset: true, polygonOffsetFactor: -4,
});

let marks: { three: THREE.Material; pmndrs: THREE.Material; serial: THREE.Material; github: THREE.Material; scuff: THREE.Material[] } | null = null;
function makeMarks() {
  // the marks are images: drawn on when they have loaded, and the texture flagged
  const mark = (name: LogoName) => {
    const tex = canvasTex(256, 256, () => {});
    withLogos(() => {
      const g = (tex.image as HTMLCanvasElement).getContext('2d')!;
      const img = logo(name, 512, INK);
      if (img) { g.globalAlpha = 0.85; g.drawImage(img, 16, 16, 224, 224); }
      tex.needsUpdate = true;
    });
    return decalMat(tex);
  };
  const three = mark('three'), pmndrs = mark('pmndrs'), github = mark('github');
  const serial = decalMat(canvasTex(512, 64, (g) => {
    g.fillStyle = INK; g.globalAlpha = 0.8;
    g.font = '700 30px Menlo, "Courier New", monospace';
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText('CDVMBR 08 · UNIT 01', 256, 34);
  }));
  // scuffs: hairlines and, when the sheet is here, a window of real wear; two of them also get a proper scrape
  const scuff = [11, 29, 47, 63, 83].map((seed, i) => {
    const r = rng(seed);
    const tex = canvasTex(256, 256, (g) => {
      scratches(g, r, 256, 256, 9, '#e6e6e0', '#000000', 0.5);
      if (i === 1 || i === 4) gouges(g, r, 256, 256, 1, '#d2d2cc', '#000000', 2.6);
    });
    withLogos(() => {
      grunge((tex.image as HTMLCanvasElement).getContext('2d')!, r, 256, 256, '#c8c8c4', 0.7);
      tex.needsUpdate = true;
    });
    return decalMat(tex);
  });
  return { three, pmndrs, serial, github, scuff };
}

const _o = new THREE.Object3D();
/** A decal of `w` x `h` model units on `mesh`, centred on world point p with the surface normal n; "up" on the texture points to -z. */
function stick(mesh: THREE.Mesh, mat: THREE.Material, p: THREE.Vector3, n: THREE.Vector3, w: number, h: number, roll = 0) {
  _o.position.copy(p);
  _o.up.set(0, 0, -1);
  if (Math.abs(n.z) > 0.9) _o.up.set(0, 1, 0);
  _o.lookAt(p.clone().add(n)); // +z along the normal: the texture reads right from outside
  _o.rotateZ(roll);
  const geo = new DecalGeometry(mesh, p, _o.rotation, new THREE.Vector3(w, h, 0.3));
  geo.applyMatrix4(mesh.matrixWorld.clone().invert()); // the decal comes out in world space; hang it on the mesh
  const d = new THREE.Mesh(geo, mat);
  d.frustumCulled = false;
  d.renderOrder = 2;
  mesh.add(d);
}

/** A point of the mesh's outer skin, found by a ray from outside to the middle of its box. */
function skin(mesh: THREE.Mesh, at = 0) {
  const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const dir = c.clone().normalize();
  if (at) dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize(), at);
  const ray = new THREE.Raycaster(dir.clone().multiplyScalar(4), dir.clone().negate());
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit || !hit.face) return null;
  const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  return { p: hit.point, n };
}

function dress(g: THREE.Group) {
  g.updateMatrixWorld(true);
  marks ??= makeMarks();
  const m = marks;
  const core = g.getObjectByName('core') as THREE.Mesh;
  const onCore = (dir: [number, number, number], mat: THREE.Material, w: number, h: number, roll = 0) => {
    const n = new THREE.Vector3(...dir).normalize();
    stick(core, mat, n.clone().multiplyScalar(0.7), n, w, h, roll);
  };
  onCore([0.45, 0.85, -0.45], m.three, 0.55, 0.55);
  onCore([-0.45, 0.85, -0.45], m.pmndrs, 0.2, 0.2);
  onCore([0, -0.85, -0.5], m.serial, 0.5, 0.0625);
  onCore([0.6, -0.3, 0.7], m.scuff[4], 0.7, 0.7, 0.5);
  [0, 1, 2, 3].forEach((k) => {
    const wall = g.getObjectByName(`wall_${k}`) as THREE.Mesh;
    const hit = skin(wall);
    if (!hit) return;
    // no scuffs on the wings any more: a honeycomb under them instead (honeycomb, in the copy's own material)
    if (k === 0) {
      const h2 = skin(wall, 0.25);
      if (h2) stick(wall, m.github, h2.p, h2.n, 0.1, 0.1);
    }
  });
}

// The works that move the walls, built here on the model: at each hinge a barrel with a steel pin through it, and
// a linear actuator, a cylinder on the core and a rod to the inside of the petal, that strokes as the petal turns.
// Model units; the eye looks along -z, the petals sit on ±x and ±y, hinged 150 degrees back from the eye.
const EYE = new THREE.Vector3(0, 0, -1);
const SIDES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)];
const onSphere = (side: THREE.Vector3, latDeg: number, r: number) => {
  const a = (latDeg * Math.PI) / 180;
  return new THREE.Vector3().addScaledVector(EYE, Math.cos(a)).addScaledVector(side, Math.sin(a)).multiplyScalar(r);
};
const Y = new THREE.Vector3(0, 1, 0);
const SCOOP_R = 0.27; // the bowl's radius, model units: the piece is 0.21 in them
type Works = Record<'graphite' | 'steel' | 'cup' | 'bladeMat', THREE.Material> & Record<'barrel' | 'rod' | 'lug' | 'hinge' | 'pin' | 'bowl' | 'blade' | 'scoopPin', THREE.BufferGeometry>;
let works: Works | null = null;
function makeWorks(): Works {
  const graphite = new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.5, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c8c8cc', roughness: 0.3, metalness: 0.9 });
  const cup = new THREE.MeshStandardMaterial({ color: '#d4d4d8', roughness: 0.22, metalness: 0.95, side: THREE.DoubleSide }); // seen inside and out
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }); // the half that scoops, black
  // a half shell, its dome towards the device (+z), its mouth ahead (-z)
  const shell = (r: number) => new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
  const along = (r: number) => new THREE.CylinderGeometry(r, r, 1, 20).translate(0, 0.5, 0); // from the origin up its y, unit long
  return {
    graphite, steel, cup, bladeMat,
    bowl: shell(SCOOP_R), blade: shell(SCOOP_R * 0.96), scoopPin: new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12),
    barrel: along(0.045), rod: along(0.02), lug: new THREE.SphereGeometry(0.048, 16, 12),
    hinge: new THREE.CylinderGeometry(0.042, 0.042, 0.3, 16), pin: new THREE.CylinderGeometry(0.018, 0.018, 0.42, 12),
  };
}
/** How far out from the centre the scoop's bowl is, in model units, at extension `k` reaching for a piece `at` away. */
export const ringOut = (k: number, at: number) => 1.28 + (Math.max(0.95, Math.min(3.2, at)) - 1.28) * k;

/** The matrix of `o` relative to its ancestor `anc`, from local matrices (kept current by the caller). */
function relTo(o: THREE.Object3D, anc: THREE.Object3D, m = new THREE.Matrix4()) {
  m.identity();
  for (let p: THREE.Object3D | null = o; p && p !== anc; p = p.parent) m.premultiply(p.matrix);
  return m;
}

/** A wing's shell is a piece of a sphere: its centre, in the geometry's own space, by a least-squares fit of its points,
 * so the inside of the shell (facing it) can be told from the outside. */
function shellCentre(geo: THREE.BufferGeometry) {
  const p = geo.attributes.position, A = Array.from({ length: 4 }, () => [0, 0, 0, 0, 0]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), row = [2 * x, 2 * y, 2 * z, 1], b = x * x + y * y + z * z;
    for (let a = 0; a < 4; a++) { for (let c = 0; c < 4; c++) A[a][c] += row[a] * row[c]; A[a][4] += row[a] * b; }
  }
  for (let c = 0; c < 4; c++) { // Gauss-Jordan on the normal equations
    let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = A[r][c] / (A[c][c] || 1e-12); for (let k = c; k < 5; k++) A[r][k] -= f * A[c][k]; }
  }
  return new THREE.Vector3(A[0][4] / A[0][0], A[1][4] / A[1][1], A[2][4] / A[2][2]);
}

/** Under the wings, a honeycomb: fine hexagonal ribs in a lighter graphite on the inside of each shell (the faces
 * turned to its centre), laid on from three sides by position (no UVs needed), each side weighted by how squarely
 * the surface faces it, so the seams do not show. */
const WHITE_PLASTIC = '#efefeb';
// the warp at a wall, in world units against a probe some 0.063 across: the glowing band, the dithered band twice it,
// how much at most thins away there, and the rings' frequency
const WARP_W = 0.022, WARP_THIN = 0.7, WARP_RINGS = 420;
const BACK_K = 0.55; // the back's ring and glow, against their size as made
const BROW_R = 0.73; // the brows' reach from the middle: on the core (0.7), at its collar (0.72), not hovering off it (0.8 for a moment)
const BLACK = '#121214'; // the blue, gone to black
const HEX = 16; // hexagons across a model unit
function honeycomb(m: THREE.MeshStandardMaterial, centre: THREE.Vector3) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHexC = { value: centre };
    sh.vertexShader = 'varying vec3 vHexP; varying vec3 vHexN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHexP = position; vHexN = normal;');
    sh.fragmentShader = `varying vec3 vHexP; varying vec3 vHexN; uniform vec3 uHexC;
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  vec2 q = abs(dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw);
  return 0.5 - max(dot(q, s * 0.5), q.x);
}
float hexRib(vec2 p) { return 1.0 - smoothstep(0.025, 0.07, hexEdge(p * ${HEX.toFixed(1)})); }
` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec3 w = pow(abs(normalize(vHexN)), vec3(4.0)); w /= (w.x + w.y + w.z);
    float rib = hexRib(vHexP.yz) * w.x + hexRib(vHexP.xz) * w.y + hexRib(vHexP.xy) * w.z;
    vec3 hexN = gl_FrontFacing ? normalize(vHexN) : -normalize(vHexN); // the side seen: a shell drawn from both sides
    rib *= smoothstep(0.1, 0.4, -dot(hexN, normalize(vHexP - uHexC))); // the inside of the shell only
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.16, 0.18), rib * 0.85);
  }`);
  };
  m.customProgramCacheKey = () => 'hexwing';
  m.needsUpdate = true;
}

/** A copy of the loaded model at `size` (its radius), with its hinges wired. Every mesh gets a material of its own,
 * for clipping planes and a tint of its own. */
const tintColor = new THREE.Color();
const _rel = new THREE.Matrix4(), _back = new THREE.Vector3();
export function device(model: THREE.Object3D, size: number): Device {
  const g = model.clone(true) as THREE.Group;
  dress(g);
  g.scale.setScalar(size);
  // the rest pose in the file is open; the hinges turn in a fixed ratio from there (blender: leaf 95 -> 160, wall -55 -> 0)
  const walls = [0, 1, 2, 3].map((k) => { const w = g.getObjectByName(`wall_${k}`)!; return { o: w, rest: w.rotation.x }; });
  // the back: the ring, its throat and the glow in it smaller and set into the shell rather than standing out of it
  // (the ring 0.26 across at 0.69, out past the core's curve, for a while)
  // flush with the core's curve where they sit (0.7 across it), the throat a hair below the ring's lip, the glow at its floor
  for (const [name, z] of [['back_ring', 0.688], ['back_throat', 0.668], ['back_glow', 0.697]] as const) {
    const o = g.getObjectByName(name);
    if (o) { o.scale.multiplyScalar(BACK_K); o.position.z = z; }
  }
  // the brows: the four arcs that hung by the wings' lips, off the body; taken off the hinges onto one ring on the
  // core, drawn in to sit close round it, so they turn together round the eye's axis
  const root = g.getObjectByName('core')!.parent!;
  g.updateMatrixWorld(true);
  const brows = new THREE.Group();
  root.add(brows);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  let browR = 0;
  for (let k = 0; k < 4; k++) {
    const l = g.getObjectByName(`wall_light_${k}`) as THREE.Mesh | undefined;
    if (!l) continue;
    l.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(inv, l.matrixWorld);
    l.parent!.remove(l);
    m.decompose(l.position, l.quaternion, l.scale);
    brows.add(l);
    l.geometry.computeBoundingSphere();
    browR = Math.max(browR, l.geometry.boundingSphere!.center.clone().applyMatrix4(l.matrix).length());
  }
  if (browR > 0) brows.scale.setScalar(BROW_R / browR); // in close, just off the core (they hung out round the wings, for a while)
  // and glass between them: the four arcs lie on one band round the eye's axis; a clear glass band fills it, the arcs
  // its frame, turning with them (open between them, for a while)
  {
    let lo = { z: Infinity, r: 0 }, hi = { z: -Infinity, r: 0 };
    const v = new THREE.Vector3();
    for (const l of brows.children as THREE.Mesh[]) {
      const pos = l.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(l.matrix);
        const r = Math.hypot(v.x, v.y);
        if (v.z < lo.z) lo = { z: v.z, r }; if (v.z > hi.z) hi = { z: v.z, r };
      }
    }
    if (Number.isFinite(lo.z) && hi.z > lo.z) {
      // a lathe round z through the band's two rims, a little inside the arcs so it reads as set into them
      const pts = [new THREE.Vector2(lo.r * 0.995, lo.z), new THREE.Vector2(hi.r * 0.995, hi.z)];
      const geo = new THREE.LatheGeometry(pts, 96).rotateX(Math.PI / 2);
      const glass = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: '#eef4f6', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6,
      }));
      glass.renderOrder = 3;
      brows.add(glass);
    }
  }

  // the works: hinges and actuators, in the frame the core sits in
  works ??= makeWorks();
  const W = works;
  const frame = g.getObjectByName('core')!.parent!;
  const acts = walls.map((w, k) => {
    const side = SIDES[k];
    const axis = new THREE.Vector3().crossVectors(side, EYE).normalize(); // across the petal's meridian: the hinge line
    const hingeAt = onSphere(side, 150, 0.965);
    for (const [geo, mat] of [[W.hinge, W.graphite], [W.pin, W.steel]] as const) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(hingeAt);
      m.quaternion.setFromUnitVectors(Y, axis);
      frame.add(m);
    }
    // mounts: a lug on the core, and one on the petal's inside, fixed in the petal's own frame in the closed pose
    const coreAt = onSphere(side, 112, 0.69);
    w.o.rotation.x = 0; w.o.updateMatrix();
    const wallAt = onSphere(side, 100, 0.955); // on the wall's inside, touching it (0.915, a little in the air, for a while)
    const local = wallAt.clone().applyMatrix4(relTo(w.o, frame).invert());
    const lugA = new THREE.Mesh(W.lug, W.graphite); lugA.position.copy(coreAt); frame.add(lugA);
    const lugB = new THREE.Mesh(W.lug, W.graphite); lugB.position.copy(local); w.o.add(lugB);
    const barrel = new THREE.Mesh(W.barrel, W.graphite); frame.add(barrel);
    const rod = new THREE.Mesh(W.rod, W.steel); frame.add(rod);
    w.o.rotation.x = w.rest; w.o.updateMatrix();
    return { w, coreAt, local, barrel, rod, d: new THREE.Vector3(), at: new THREE.Vector3() };
  });
  // the grip is a scoop, as for ice cream: a steel bowl on an arm out of the eye cap, its mouth to the piece, and in
  // it a blade, a second shell nested in the bowl, that swings over the mouth on two pins at the rim and shuts the
  // piece in. Home it is folded into the cap; out, the bowl's centre lands on the piece.
  const gripParts = (() => {
    const grp = new THREE.Group();
    frame.add(grp);
    const arm = new THREE.Mesh(W.barrel, W.graphite); grp.add(arm);
    arm.position.set(0, 0, -0.7); arm.quaternion.setFromUnitVectors(Y, EYE); // from the cap towards the bowl
    const head = new THREE.Group(); grp.add(head); // at the bowl's centre
    const bowl = new THREE.Mesh(W.bowl, W.cup); head.add(bowl);
    const swing = new THREE.Group(); head.add(swing); // turns about the pins, across the bowl
    swing.add(new THREE.Mesh(W.blade, W.bladeMat));
    for (const x of [-1, 1]) {
      const pin = new THREE.Mesh(W.scoopPin, W.graphite);
      pin.position.set(x * SCOOP_R, 0, 0); pin.rotation.z = Math.PI / 2;
      head.add(pin);
    }
    return { grp, arm, head, swing };
  })();
  const grip = (k: number, at: number, shut: number) => {
    const { grp, arm, head, swing } = gripParts;
    grp.visible = k > 0.01;
    // it unfolds out of the cap over the first stretch, so it never pops in or out
    grp.scale.setScalar(THREE.MathUtils.smoothstep(k, 0, 0.2));
    const centre = ringOut(k, at); // the bowl's centre, out from the device's
    arm.scale.set(0.8, centre - SCOOP_R - 0.7 + 0.04, 0.8); // from the cap to the back of the bowl
    head.position.set(0, 0, -centre);
    swing.rotation.x = Math.PI * shut; // nested in the bowl, then over its mouth
  };
  grip(0, 1, 0); // home: the reach does not matter
  const stroke = () => {
    for (const a of acts) {
      a.w.o.updateMatrix();
      a.at.copy(a.local).applyMatrix4(relTo(a.w.o, frame, _rel));
      a.d.subVectors(a.at, a.coreAt);
      const L = a.d.length(); a.d.divideScalar(L);
      // the cylinder from the core mount, two thirds of the shortest stroke long; the rod from the petal mount back into it
      a.barrel.position.copy(a.coreAt); a.barrel.quaternion.setFromUnitVectors(Y, a.d); a.barrel.scale.set(1, Math.min(L - 0.04, 0.3), 1);
      a.rod.position.copy(a.at); a.rod.quaternion.setFromUnitVectors(Y, _back.copy(a.d).negate()); a.rod.scale.set(1, L - 0.05, 1);
    }
  };
  stroke();
  const leaves = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const l = g.getObjectByName(`leaf_${i}`)!; return { o: l, rest: l.rotation.y }; });
  // every material of this copy, gathered once; the tintable ones keep their own emissive as made
  const mats: THREE.Material[] = [], tinted: { m: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      const m = (mesh.material = (mesh.material as THREE.Material).clone()) as THREE.MeshStandardMaterial;
      if (m.transparent) m.depthWrite = false; // the glass
      // no bare metal on it: what was steel or chrome is a white plastic now, satin (metal against the graphite, for a while)
      if (m.metalness > 0.5) { m.metalness = 0; m.roughness = 0.35; m.color?.set(WHITE_PLASTIC); m.map = null; }
      // no blue on it either: the collar, the brows and the back glow black, gloss, lit only by a crossing's tint (blue, for a while)
      if (m.name === 'blue') { m.color.set(BLACK); m.emissive.set('#000000'); m.roughness = 0.3; }
      if (/^wall_\d$/.test(mesh.name)) honeycomb(m, shellCentre(mesh.geometry)); // under the wings (on the core, for a moment)
      mats.push(m);
      if (m.emissive) tinted.push({ m, base: m.emissive.clone() });
      o.frustumCulled = false;
    }
  });
  // the warp at a wall: shared uniforms for every material of this copy, laid on after whatever each already does
  const warpU = { uWarp: { value: new THREE.Vector4(0, 1, 0, 1e4) }, uWarpK: { value: 0 }, uWarpC: { value: new THREE.Color() }, uWarpT: { value: 0 } };
  for (const m of mats) {
    const before = m.onBeforeCompile.bind(m);
    m.onBeforeCompile = (sh, gl) => {
      before(sh, gl);
      Object.assign(sh.uniforms, warpU);
      sh.vertexShader = 'varying vec3 vWarpW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWarpW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vWarpW; uniform vec4 uWarp; uniform float uWarpK; uniform vec3 uWarpC; uniform float uWarpT;
const float WARP_BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
` + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float warpD = abs(dot(uWarp.xyz, vWarpW) + uWarp.w);
  if (uWarpK > 0.0) {
    // near the seam the body thins away to a dither, so the two copies interleave there, not fight
    float thin = uWarpK * ${WARP_THIN.toFixed(2)} * (1.0 - smoothstep(0.0, ${WARP_W.toFixed(4)} * 2.0, warpD));
    ivec2 wq = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
    if (thin > (WARP_BAYER[wq.x + wq.y * 4] + 0.5) / 16.0) discard;
  }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (uWarpK > 0.0) {
    // and the seam glows in the colour of the cell beyond, in rings running out from it
    float edge = 1.0 - smoothstep(0.0, ${WARP_W.toFixed(4)}, warpD);
    float rings = 0.55 + 0.45 * sin(warpD * ${WARP_RINGS.toFixed(1)} - uWarpT * 14.0);
    totalEmissiveRadiance += uWarpC * edge * rings * uWarpK * 2.4;
  }`);
    };
    const key = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => key() + '|warp';
    m.needsUpdate = true;
  }
  let shieldK = -1;
  // for fade: each material's own opacity and transparency, as made
  const fades = mats.map((m) => ({ m, opacity: m.opacity, transparent: m.transparent }));
  let faded = false, fadeK = 1;
  return {
    g,
    clip: (planes) => { for (const m of mats) m.clippingPlanes = planes; },
    warp: (plane, hex, k, time) => {
      warpU.uWarp.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      warpU.uWarpK.value = k; warpU.uWarpC.value.set(hex); warpU.uWarpT.value = time;
    },
    tint: (hex, k) => {
      tintColor.set(hex);
      for (const t of tinted) t.m.emissive.copy(t.base).lerp(tintColor, k * 0.55);
    },
    fade: (k) => {
      const on = k < 0.999;
      if (on === faded && (!on || Math.abs(k - fadeK) < 0.003)) return;
      for (const f of fades) {
        // made transparent only while fading, so the opaque parts sort as they did; a switch needs a new program
        const tr = on || f.transparent;
        if (f.m.transparent !== tr) { f.m.transparent = tr; f.m.needsUpdate = true; }
        f.m.opacity = f.opacity * (on ? k : 1);
      }
      faded = on; fadeK = k;
    },
    grip,
    brow: (a) => { brows.rotation.z = a; },
    shield: (k) => {
      if (Math.abs(k - shieldK) < 1e-4) return; // at rest: nothing moves
      shieldK = k;
      for (const w of walls) w.o.rotation.x = w.rest * (1 - k);
      stroke();
    },
    shutter: (k) => { for (const l of leaves) l.o.rotation.y = l.rest * (1 + (65 / 95) * k); },
  };
}
