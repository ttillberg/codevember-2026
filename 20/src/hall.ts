import * as THREE from 'three';
import { hallSteel } from './materials';
import { NOISE3D } from './noise';

const HAZE_TOP = 55;
/** the render targets the scene itself is drawn into (main.ts); any other is the transmission pass's */
export const SCENE_TARGETS = new Set<THREE.RenderTarget>(); // where the haze is at its brightest

// the haze is lit from above: fog thickens to a brighter grey the higher up it is, so the steel stands dark
// against it up there and sinks into the dark below
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogAt = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogAt = instanceMatrix * fogAt;
  #endif
  vFogY = (modelMatrix * fogAt).y;
#endif`;
// the fog is a THREE.Fog that is not linear: its `near` is the density (exp2), its `far` how much brighter the
// haze is high up than down low (same hue), so the debug panel can set both without recompiling anything
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n varying float vFogY;');
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogFactor = 1.0 - exp( - fogNear * fogNear * vFogDepth * vFogDepth );
  vec3 fogLit = fogColor * mix( 1.0, fogFar, smoothstep( -6.0, ${HAZE_TOP.toFixed(1)}, vFogY ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogLit, fogFactor );
#endif`;

/**
 * The hall, made up: lattice steel going up into the haze (towers, girders, catwalks, a roof of trusses with
 * skylights), the girder the pod hangs from, light from the roof and from windows in the sides, and the shafts of
 * that light in the fog, faked as soft additive cones with dust drifting through.
 */
export function buildHall(scene: THREE.Scene, hang: THREE.Vector3, maxTexture = 4096) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ROOF = 75; // high up, in the haze

  // ---------- steel: every bar one instance of a unit box, stretched from a to b

  const bars: THREE.Matrix4[] = [];
  const up = V(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const bar = (a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) => {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return;
    q.setFromUnitVectors(up, d.divideScalar(len));
    bars.push(m4.compose(a.clone().add(b).multiplyScalar(0.5), q, V(w, len, h)).clone());
  };

  /** a box truss from a to b, `side` its half width, `rise` its height, panels about `panel` long */
  const truss = (a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, rise: THREE.Vector3, panel: number, chord = 0.16, web = 0.07) => {
    const corners = [side.clone().negate(), side.clone(), side.clone().negate().add(rise), side.clone().add(rise)];
    for (const c of corners) bar(a.clone().add(c), b.clone().add(c), chord);
    const n = Math.max(1, Math.round(a.distanceTo(b) / panel));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const [l0, r0, l1, r1] = corners.map((c) => p.clone().add(c));
      bar(l0, l1, web); bar(r0, r1, web); bar(l0, r0, web); bar(l1, r1, web);
      if (i === n) continue;
      const p2 = a.clone().lerp(b, (i + 1) / n);
      const [l2, r2, l3, r3] = corners.map((c) => p2.clone().add(c));
      if (i % 2) { bar(l0, l3, web); bar(r0, r3, web); } else { bar(l1, l2, web); bar(r1, r2, web); }
    }
  };

  /** a lattice tower, w wide, from y0 to y1 */
  const tower = (x: number, z: number, y0: number, y1: number, w: number) => {
    const h = w / 2;
    const cs = [V(-h, 0, -h), V(h, 0, -h), V(h, 0, h), V(-h, 0, h)];
    for (const c of cs) bar(V(x + c.x, y0, z + c.z), V(x + c.x, y1, z + c.z), 0.22);
    const step = w * 1.2;
    for (let y = y0, k = 0; y < y1; y += step, k++) {
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        bar(V(x + a.x, y, z + a.z), V(x + b.x, y, z + b.z), 0.1);
        const flip = (k + i) % 2 ? 1 : 0;
        bar(V(x + a.x, y + step * flip, z + a.z), V(x + b.x, y + step * (1 - flip), z + b.z), 0.07);
      }
    }
  };

  const TX = 12; // the towers either side of the pod
  const WX = 60; // the wall on the sun's side
  const LEVELS = [-14, 22, 44, 62]; // girders across and along
  // the structure goes on in every direction, a grid of towers out into the haze; none near the eye
  const COLS = [-60, -44, -28, -TX, TX, 28, 44];
  const ROWS = [54, 39, 24, -6, -21, -36, -51, -66];
  const rows = [24, -6, -21, -36]; // the hall's own rows round the pod, with catwalks along them
  const near = (x: number, z: number) => Math.abs(x) <= TX && z <= 24 && z >= -36;
  for (const z of ROWS) {
    for (const x of COLS) tower(x, z, -45, ROOF, 2.4);
    for (let i = 0; i < COLS.length - 1; i++) {
      const a = COLS[i], b = COLS[i + 1];
      // girders across: every level round the pod, every other one further out, staggered row by row
      const k = ROWS.indexOf(z);
      const ys = near(a, z) && near(b, z) ? LEVELS : LEVELS.filter((_, j) => (j + i + k) % 2 === 0);
      for (const y of ys) truss(V(a, y, z), V(b, y, z), V(0, 0, 0.8), V(0, 2.2, 0), 2.2);
    }
    // the roof's trusses, deep ones, right across
    truss(V(COLS[0] - 6, ROOF - 4, z), V(WX, ROOF - 4, z), V(0, 0, 0.6), V(0, 4, 0), 3, 0.2, 0.09);
  }
  for (const x of COLS) {
    if (Math.abs(x) === TX) continue; // (along the hall's own rows below)
    for (let i = 0; i < ROWS.length - 1; i++) {
      const ys = LEVELS.filter((_, j) => (j + i + COLS.indexOf(x)) % 2 === 1);
      for (const y of ys) truss(V(x, y, ROWS[i]), V(x, y, ROWS[i + 1]), V(0.8, 0, 0), V(0, 2.2, 0), 2.2);
    }
  }
  for (const x of [-TX, TX]) {
    for (const y of [22, 44]) {
      truss(V(x, y, ROWS[0]), V(x, y, rows[0]), V(0.8, 0, 0), V(0, 2.2, 0), 2.2);
      truss(V(x, y, rows[rows.length - 1]), V(x, y, ROWS[ROWS.length - 1]), V(0.8, 0, 0), V(0, 2.2, 0), 2.2);
    }
  }
  for (const x of [-TX, TX]) {
    for (const y of LEVELS) truss(V(x, y, rows[0]), V(x, y, rows[rows.length - 1]), V(0.8, 0, 0), V(0, 2.2, 0), 2.2);
    // a catwalk along the inside of each row of towers, rails and all
    const cx = x - Math.sign(x) * 2.2;
    for (const y of [-6, 12]) {
      const z0 = rows[0] + 2, z1 = rows[rows.length - 1] - 2;
      bar(V(cx - 0.6, y, z0), V(cx - 0.6, y, z1), 0.12, 0.25);
      bar(V(cx + 0.6, y, z0), V(cx + 0.6, y, z1), 0.12, 0.25);
      for (let z = z0; z > z1; z -= 1.5) {
        bar(V(cx - 0.6, y, z), V(cx + 0.6, y, z), 0.05);
        bar(V(cx - 0.6, y, z), V(cx - 0.6, y + 1.1, z), 0.04);
        bar(V(cx + 0.6, y, z), V(cx + 0.6, y + 1.1, z), 0.04);
      }
      bar(V(cx - 0.6, y + 1.1, z0), V(cx - 0.6, y + 1.1, z1), 0.05);
      bar(V(cx + 0.6, y + 1.1, z0), V(cx + 0.6, y + 1.1, z1), 0.05);
    }
  }
  // the girder it hangs from, across the hall, and the rails between the roof trusses
  const gy = hang.y + 0.35;
  truss(V(-TX, gy, hang.z), V(TX, gy, hang.z), V(0, 0, 0.6), V(0, 1.8, 0), 1.8, 0.2, 0.08);
  for (let x = COLS[0] - 6; x <= WX; x += 8) bar(V(x, ROOF - 4, ROWS[0] + 6), V(x, ROOF - 4, ROWS[ROWS.length - 1] - 6), 0.3, 0.5);
  // a frame round the hang point where the hoses come down from, a grating hung under the girder
  {
    const y = gy - 0.15, s = 1.9;
    const c = [V(-s, y, -s), V(s, y, -s), V(s, y, s), V(-s, y, s)].map((p) => p.add(V(hang.x, 0, hang.z)));
    for (let i = 0; i < 4; i++) bar(c[i], c[(i + 1) % 4], 0.14, 0.2);
    for (let i = 1; i < 6; i++) {
      const t = -s + (2 * s * i) / 6;
      bar(V(hang.x + t, y, hang.z - s), V(hang.x + t, y, hang.z + s), 0.06);
    }
    for (const p of c) bar(p, V(p.x, gy, hang.z + Math.sign(p.z - hang.z) * 0.6), 0.06);
  }

  // the roof: across each bay, bands of glass between strips of deck, glazing bars across the glass; the deck
  // is solid to the sun, the glass not, so the light comes in in bands, cut by the bars
  const X0 = COLS[0] - 6, Z0 = ROWS[0] + 6, Z1 = ROWS[ROWS.length - 1] - 6;
  const deck: THREE.Matrix4[] = [];
  const box = (c: THREE.Vector3, size: THREE.Vector3) => deck.push(new THREE.Matrix4().compose(c, new THREE.Quaternion(), size));
  const GLASS: [number, number][] = [];
  for (let x = X0, k = 0; x < WX; x += 3, k++) {
    if (k % 2) { GLASS.push([x, x + 3]); continue; }
    box(V(x + 1.5, ROOF + 0.3, (Z0 + Z1) / 2), V(3, 0.4, Z0 - Z1));
  }
  for (const [x0, x1] of GLASS) {
    for (let z = Z0; z > Z1; z -= 1.4) bar(V(x0, ROOF + 0.3, z), V(x1, ROOF + 0.3, z), 0.08, 0.16);
    bar(V((x0 + x1) / 2, ROOF + 0.3, Z0), V((x0 + x1) / 2, ROOF + 0.3, Z1), 0.06, 0.12);
  }
  // the far wall: solid, small openings in a few rows, not every bay
  const HOLES: THREE.Vector3[] = [];
  {
    const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const BANDS = [14, 32, 48, 62];
    const H = 1.4, W = 1.0;
    let y = -46;
    for (const b of BANDS) {
      box(V(WX, (y + b) / 2, (Z0 + Z1) / 2), V(0.5, b - y, Z0 - Z1));   // solid up to the band
      let z = Z0;
      for (let c = Z0 - 2.5; c > Z1 + 1; c -= 4.5) {
        if (rnd() < 0.45) continue;
        box(V(WX, b + H / 2, (z + c + W / 2) / 2), V(0.5, H, z - (c + W / 2)));
        HOLES.push(V(WX, b + H / 2, c));
        z = c - W / 2;
      }
      box(V(WX, b + H / 2, (z + Z1) / 2), V(0.5, H, z - Z1));
      y = b + H;
    }
    box(V(WX, (y + ROOF + 0.5) / 2, (Z0 + Z1) / 2), V(0.5, ROOF + 0.5 - y, Z0 - Z1));
  }

  // scaffolding: tubes on a 2 x 1.3 m grid, a lift of ledgers every 2 m, braces up the outside in turn, boards
  // on every third lift; wrapped round some of the towers, part of the way up
  const scaffold = (cx: number, cz: number, nx: number, nz: number, y0: number, lifts: number) => {
    const BX = 2, BZ = 1.3, LIFT = 2;
    const x0 = cx - (nx * BX) / 2, z0 = cz - (nz * BZ) / 2;
    const at = (i: number, k: number, l: number) => V(x0 + i * BX, y0 + l * LIFT, z0 + k * BZ);
    const top = lifts;
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      if (i > 0 && i < nx && k > 0 && k < nz) continue;   // round the outside only, the tower inside
      bar(at(i, k, 0), at(i, k, top), 0.05);
    }
    for (let l = 1; l <= top; l++) {
      for (let i = 0; i < nx; i++) { bar(at(i, 0, l), at(i + 1, 0, l), 0.05); bar(at(i, nz, l), at(i + 1, nz, l), 0.05); }
      for (let k = 0; k < nz; k++) { bar(at(0, k, l), at(0, k + 1, l), 0.05); bar(at(nx, k, l), at(nx, k + 1, l), 0.05); }
      if (l % 3 === 0) {
        // boards on this lift, and a toe board
        for (let i = 0; i < nx; i++) for (const k of [0, nz]) {
          const a = at(i, k, l), b = at(i + 1, k, l), into = k ? -0.55 : 0.55;
          bar(a.clone().add(V(0, 0.03, into)), b.clone().add(V(0, 0.03, into)), 1.0, 0.04);
        }
        for (let k = 0; k < nz; k++) for (const i of [0, nx]) {
          const a = at(i, k, l), b = at(i, k + 1, l), into = i ? -0.55 : 0.55;
          bar(a.clone().add(V(into, 0.03, 0)), b.clone().add(V(into, 0.03, 0)), 0.04, 1.0);
        }
      }
      if (l % 2) {
        for (let i = l % 4 === 1 ? 0 : 1; i < nx; i += 2) { bar(at(i, 0, l - 1), at(i + 1, 0, l), 0.045); bar(at(i, nz, l - 1), at(i + 1, nz, l), 0.045); }
        for (let k = l % 4 === 1 ? 0 : 1; k < nz; k += 2) { bar(at(0, k, l - 1), at(0, k + 1, l), 0.045); bar(at(nx, k, l - 1), at(nx, k + 1, l), 0.045); }
      }
    }
  };
  scaffold(TX, -6, 3, 4, -20, 16);
  scaffold(28, -21, 3, 4, -12, 22);
  scaffold(-TX, -36, 3, 4, 4, 10);
  scaffold(44, 24, 3, 4, -30, 14);
  scaffold(-28, 24, 3, 4, -24, 26);
  scaffold(-44, -21, 3, 4, -40, 30);
  scaffold(-28, -51, 3, 4, 0, 18);
  scaffold(28, 54, 3, 4, -16, 24);
  scaffold(-TX, 39, 3, 4, -36, 20);
  scaffold(-60, 54, 3, 4, -10, 28);
  scaffold(44, -66, 3, 4, -20, 22);
  scaffold(TX, -51, 3, 4, 10, 14);

  // hoists: a narrow lattice mast up the side of a tower, a cage on it going up and down
  const HOISTS: { x: number; z: number; lo: number; hi: number; speed: number; phase: number }[] = [
    { x: TX + 2.4, z: -1.2, lo: -18, hi: 44, speed: 0.7, phase: 0 },
    { x: 28 - 4.2, z: -21, lo: -10, hi: 56, speed: 1.0, phase: 2.5 },
    { x: -28 + 4.2, z: 24, lo: -24, hi: 50, speed: 0.8, phase: 7 },
    { x: -44 + 4.2, z: -21, lo: -36, hi: 40, speed: 0.9, phase: 3.5 },
    { x: -TX - 2.4, z: -21, lo: -30, hi: 40, speed: 0.6, phase: 5 },
  ];
  // which way the tower a hoist stands by is, along x
  const towardTower = (h: { x: number }) => Math.sign(COLS.reduce((a, b) => (Math.abs(b - h.x) < Math.abs(a - h.x) ? b : a)) - h.x);
  for (const h of HOISTS) {
    const s = 0.4;
    const cs = [V(-s, 0, -s), V(s, 0, -s), V(s, 0, s), V(-s, 0, s)];
    for (const c of cs) bar(V(h.x + c.x, -45, h.z + c.z), V(h.x + c.x, h.hi + 6, h.z + c.z), 0.06);
    for (let y = -45, k = 0; y < h.hi + 6; y += 1.5, k++) {
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        bar(V(h.x + a.x, y, h.z + a.z), V(h.x + b.x, y, h.z + b.z), 0.04);
        if (k % 2 === i % 2) bar(V(h.x + a.x, y, h.z + a.z), V(h.x + b.x, y + 1.5, h.z + b.z), 0.03);
      }
    }
    // ties back to the tower every 9 m
    const dx = towardTower(h);
    for (let y = -40; y < h.hi; y += 9) bar(V(h.x + dx * s, y, h.z), V(h.x + dx * 2, y, h.z), 0.06);
  }

  const steel = hallSteel(new THREE.MeshStandardMaterial({ color: 0x2b2e32, roughness: 0.62, metalness: 0.55 }));
  // the steel in blocks of the hall, one instanced mesh each with its own bounds, so that every camera (the eye,
  // the pod's tight sun, the skylight) draws only the blocks it can see, not all 40 000 bars every time
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const chunked = (list: THREE.Matrix4[], cell: THREE.Vector3) => {
    const blocks = new Map<string, THREE.Matrix4[]>();
    const at = new THREE.Vector3();
    for (const m of list) {
      at.setFromMatrixPosition(m);
      const key = `${Math.floor(at.x / cell.x)},${Math.floor(at.y / cell.y)},${Math.floor(at.z / cell.z)}`;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key)!.push(m);
    }
    for (const ms of blocks.values()) {
      const mesh = new THREE.InstancedMesh(unit, steel, ms.length);
      ms.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.still = true; // into the sun's map that is drawn once
      // not in what the frosted window sees through: only the inside of the pod is behind it
      mesh.onBeforeRender = (r) => { const t = r.getRenderTarget(); if (t && !SCENE_TARGETS.has(t)) { mesh.userData.n = mesh.count; mesh.count = 0; } };
      mesh.onAfterRender = () => { if (mesh.userData.n !== undefined) { mesh.count = mesh.userData.n; delete mesh.userData.n; } };
      scene.add(mesh);
    }
    return blocks.size;
  };
  chunked(bars, V(16, 24, 15));
  chunked(deck, V(400, 400, 400)); // the roof and the wall: few and long, one block

  // the hoists' cars: a cage of bars round a floor, a roof, a lamp; they ride up and down, stop, wait, go on
  const cars: THREE.Group[] = [];
  {
    const mat = hallSteel(new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.55, metalness: 0.6 }));
    const mesh = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.7, metalness: 0.4, transparent: true, opacity: 0.55 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const piece = (g: THREE.Group, m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const p = new THREE.Mesh(box, m);
      p.position.set(x, y, z); p.scale.set(w, h, d);
      p.castShadow = p.receiveShadow = m !== mesh;
      g.add(p);
    };
    for (const h of HOISTS) {
      const g = new THREE.Group();
      const W = 1.5, D = 2.2, Hh = 2.3;
      piece(g, mat, 0, 0, 0, W, 0.12, D);
      piece(g, mat, 0, Hh, 0, W, 0.08, D);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) piece(g, mat, (x * W) / 2, Hh / 2, (z * D) / 2, 0.06, Hh, 0.06);
      for (const y of [1.1]) {
        piece(g, mat, 0, y, -D / 2, W, 0.05, 0.05); piece(g, mat, 0, y, D / 2, W, 0.05, 0.05);
        piece(g, mat, -W / 2, y, 0, 0.05, 0.05, D); piece(g, mat, W / 2, y, 0, 0.05, 0.05, D);
      }
      piece(g, mesh, 0, Hh / 2, -D / 2, W, Hh, 0.02); piece(g, mesh, 0, Hh / 2, D / 2, W, Hh, 0.02);
      piece(g, mesh, -W / 2, Hh / 2, 0, 0.02, Hh, D);
      piece(g, lamp, 0, Hh - 0.1, 0, 0.18, 0.05, 0.18);
      // on the side of the mast away from the tower
      const side = -towardTower(h);
      g.position.set(h.x + side * (0.4 + W / 2 + 0.1), h.lo, h.z);
      g.userData.hoist = h;
      scene.add(g);
      cars.push(g);
    }
  }

  // the block at the hang point: a sheave in a frame
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.45, metalness: 0.8 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), mat);
    frame.position.set(hang.x, hang.y + 0.12, hang.z);
    const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), mat);
    sheave.rotation.x = Math.PI / 2;
    sheave.position.set(hang.x, hang.y + 0.15, hang.z);
    frame.castShadow = sheave.castShadow = true;
    frame.userData.still = sheave.userData.still = true;
    scene.add(frame, sheave);
  }

  // the glass in the roof and the windows: bright, the sky through them, seen through the haze
  {
    const glow = new THREE.MeshBasicMaterial({ color: 0xdfe6ee, fog: false });
    const pane = new THREE.PlaneGeometry(1, 1);
    for (const [x0, x1] of GLASS) {
      const m = new THREE.Mesh(pane, glow);
      m.scale.set(x1 - x0, Z0 - Z1, 1);
      m.rotation.x = Math.PI / 2;
      m.position.set((x0 + x1) / 2, ROOF + 0.9, (Z0 + Z1) / 2);
      scene.add(m);
    }
    for (const h of HOLES) {
      const m = new THREE.Mesh(pane, glow);
      m.scale.set(1, 1.4, 1);
      m.rotation.y = -Math.PI / 2;
      m.position.set(WX + 0.6, h.y, h.z);
      scene.add(m);
    }
  }

  let dome!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  // the haze beyond everything, the same grey as the fog at each height
  {
    dome = new THREE.Mesh(
      new THREE.SphereGeometry(95, 32, 16), // inside the eye's far plane
      new THREE.ShaderMaterial({
        uniforms: { low: { value: (scene.fog as THREE.Fog).color }, gain: { value: 9 } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 low; varying vec3 vDir;
          uniform float gain;
          void main() { gl_FragColor = vec4(low * mix(1.0, gain, smoothstep(-0.05, 0.35, vDir.y)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -1;
    dome.userData.noAO = true;
    scene.add(dome);
  }

  // ---------- light: the sun through the roof and the windows, the skylight over the pod, the sides

  // the sun, high on the right and a little behind: through the glass it falls in bands, cut by every bar and
  // truss in the way; its shadow map is also what the light in the haze is marched against (rays.ts)
  const sun = new THREE.DirectionalLight(0xe8eef4, 2.2);
  // its shadow map fitted tight round the hall as the sun sees it, a rectangle, as fine as the GPU allows: the
  // pod is lit through the bars by the same map the haze is marched against, so it has to be sharp
  const air = new THREE.Box3(V(X0, -46, Z1), V(WX, ROOF, Z0));
  const toSun = V(0.64, 1, -0.06).normalize();
  air.getCenter(sun.target.position);
  sun.position.copy(sun.target.position).addScaledVector(toSun, 200);
  {
    const view = new THREE.Matrix4().lookAt(sun.position, sun.target.position, V(0, 1, 0)).setPosition(sun.position).invert();
    const lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      const c = V(i & 1 ? air.max.x : air.min.x, i & 2 ? air.max.y : air.min.y, i & 4 ? air.max.z : air.min.z).applyMatrix4(view);
      lo.min(c); hi.max(c);
    }
    Object.assign(sun.shadow.camera, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: -hi.z - 2, far: -lo.z + 2 });
    const big = Math.min(8192, maxTexture);
    const w = hi.x - lo.x, h = hi.y - lo.y;
    sun.shadow.mapSize.set(Math.round((big * w) / Math.max(w, h)), Math.round((big * h) / Math.max(w, h)));
  }
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.radius = 1;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.castShadow = true;
  // the hall stands still: its map is drawn once (and again when the sun is moved), the pod's own sun does the rest
  sun.shadow.autoUpdate = false;
  scene.add(sun, sun.target);
  // (4 px, not 1: the pod's window draws the scene behind it at a third of this, and a target 0 px wide is an error)
  const dummy = new THREE.WebGLRenderTarget(4, 4);
  /** draw the hall's sun map: only what stands still casts into it, nothing else is drawn but the shadows */
  const bakeSun = (renderer: THREE.WebGLRenderer, eye: THREE.Camera) => {
    const off: THREE.Object3D[] = [];
    scene.traverse((o) => { if (o.castShadow && !o.userData.still) { o.castShadow = false; off.push(o); } });
    const others: THREE.LightShadow[] = [];
    scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.shadow && l !== sun && l.shadow.autoUpdate) { l.shadow.autoUpdate = false; others.push(l.shadow); } });
    sun.shadow.needsUpdate = true;
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(dummy);
    renderer.render(scene, eye);
    renderer.setRenderTarget(was);
    for (const o of off) o.castShadow = true;
    for (const sh of others) sh.autoUpdate = true;
  };
  let sunDirty = true;
  // and the same sun again, for the pod alone (materials.ts): a map 4.4 m across that follows it, 2 mm a texel,
  // from far enough up the light that the roof and every bar in between still cast into it
  const podSun = new THREE.DirectionalLight(sun.color, sun.intensity);
  podSun.castShadow = true;
  podSun.shadow.mapSize.set(2048, 2048);
  Object.assign(podSun.shadow.camera, { left: -2.2, right: 2.2, bottom: -2.2, top: 2.2, near: 1, far: 200 });
  podSun.shadow.camera.updateProjectionMatrix();
  podSun.shadow.bias = -0.0003;
  podSun.shadow.normalBias = 0.004;
  podSun.shadow.radius = 1;
  scene.add(podSun, podSun.target);

  const roof = new THREE.SpotLight(0xe6edf5, 7, 0, 0.06, 0.55, 0); // one skylight right over it, through the girder's gap
  roof.position.set(-8.5, ROOF - 4, 9);
  roof.target.position.set(0, 0.4, 0);
  roof.castShadow = true;
  roof.shadow.mapSize.set(2048, 2048);
  roof.shadow.camera.near = 50;
  roof.shadow.camera.far = 95;
  roof.shadow.bias = -0.0004;
  roof.shadow.normalBias = 0.02;
  const left = new THREE.SpotLight(0x9fb4c8, 1.6, 0, 0.12, 0.8, 0); // cold, from a window in the left wall
  left.position.set(-34, 12, -6);
  left.target.position.set(0, 0.5, 0);
  const right = new THREE.SpotLight(0xd8cbb8, 0.9, 0, 0.14, 0.8, 0); // warmer, low from the right
  right.position.set(32, 5, -14);
  right.target.position.set(0, 0.2, 0);
  scene.add(roof, roof.target, left, left.target, right, right.target);

  // ---------- shafts: cones of light in the fog

  const shaftMat = (color: number, strength: number) =>
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength }, time: { value: 0 }, tNoise: { value: NOISE3D } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying float vAlong;
        void main() {
          vLocal = position;
          vAlong = 1.0 - uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float strength;
        uniform float time;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying float vAlong;
        uniform highp sampler3D tNoise;
        float noise(vec3 p) { return texture(tNoise, p / 32.0).r; } // (noise.ts: the same value noise, from a texture)
        void main() {
          vec3 toEye = cameraPosition - vWorld;
          float dist = length(toEye);
          float edge = pow(abs(dot(normalize(vNormal), toEye / dist)), 2.2); // thin at the rim, as a lit column of haze is
          float along = smoothstep(0.0, 0.06, vAlong) * (1.0 - smoothstep(0.3, 1.0, vAlong));
          // streaks that run down the shaft, drifting
          float n = noise(vec3(vLocal.x * 1.6, vLocal.y * 0.05 - time * 0.04, vLocal.z * 1.6)) * 0.6
                  + noise(vec3(vLocal.x * 4.0 + time * 0.1, vLocal.y * 0.2, vLocal.z * 4.0)) * 0.4;
          float a = strength * edge * along * (0.45 + 0.75 * n);
          a *= smoothstep(0.6, 4.0, dist) * (1.0 - 0.7 * smoothstep(25.0, 90.0, dist));
          #ifndef TONE_MAPPING
            // drawn into a target before the tone mapping (the AO pass needs that), where the tone curve's toe no
            // longer swallows the faint rim of each cone: do it here, the faint part gone, the rest brought up
            a = TOE_GAIN * max(a - TOE, 0.0);
          #endif
          gl_FragColor = vec4(color * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      defines: { TOE: '0.012', TOE_GAIN: '2.8' },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });

  const shafts: THREE.ShaderMaterial[] = [];
  /** a cone of light from `from` along `dir`, r0 wide where it starts, r1 where it ends `len` on */
  const shaft = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, color: number, strength: number) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 40, 1, true);
    g.translate(0, -len / 2, 0); // the top at the source
    const mat = shaftMat(color, strength);
    shafts.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(V(0, -1, 0), dir.clone().normalize());
    m.renderOrder = 2;
    m.userData.noAO = true; // light in the air, nothing to shade
    mat.userData.strength = strength;
    scene.add(m);
  };
  const toPod = roof.target.position.clone().sub(roof.position);
  shaft(roof.position, toPod, toPod.length() * 1.25, 0.5, 3.6, 0xc8d4e0, 0.14);
  // and the windows in the sides
  shaft(left.position, left.target.position.clone().sub(left.position), 48, 1.6, 4.2, 0x8fa4b8, 0.08);
  shaft(V(-34, 18, -22), V(1, -0.32, 0.14), 50, 1.4, 3.6, 0x8fa4b8, 0.07);
  shaft(right.position, right.target.position.clone().sub(right.position), 45, 1.4, 3.4, 0xc8b8a0, 0.06);

  // ---------- dust in the light over the pod

  const DUST = 700;
  const dust = new Float32Array(DUST * 3);
  const seeds = new Float32Array(DUST);
  const dustAt = (i: number, fresh: boolean) => {
    // somewhere in the roof shaft, between the girder and well below the pod
    const y = fresh ? -6 + Math.random() * 17 : 11;
    const t = (roof.position.y - y) / -toPod.y;
    const r = Math.sqrt(Math.random()) * 0.9 * (0.5 + (3.1 * t) / 1.25);
    const a = Math.random() * Math.PI * 2;
    dust[i * 3] = roof.position.x + toPod.x * t + Math.cos(a) * r;
    dust[i * 3 + 1] = y;
    dust[i * 3 + 2] = roof.position.z + toPod.z * t + Math.sin(a) * r;
    seeds[i] = Math.random() * 100;
  };
  for (let i = 0; i < DUST; i++) dustAt(i, true);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  {
    const g = dot.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  const motes = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ size: 0.035, map: new THREE.CanvasTexture(dot), color: 0x9aa4ae, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(motes);

  return {
    podSun,
    /** the sun was moved: its map is drawn again before the next frame */
    moveSun() { sunDirty = true; },
    /** before each frame: the hall's sun map, if it is due */
    prepare(renderer: THREE.WebGLRenderer, eye: THREE.Camera) {
      if (!sunDirty) return;
      sunDirty = false;
      bakeSun(renderer, eye);
    },
    roof,
    left,
    right,
    sun,
    /** all the faked shafts brighter or dimmer at once */
    set shaftGain(g: number) { for (const s of shafts) s.uniforms.strength.value = s.userData.strength * g; },
    air,
    roofY: ROOF,
    /** the tight sun on the pod, wherever it has swung to; as the wide one is set (the debug panel too) */
    follow(at: THREE.Vector3) {
      podSun.color.copy(sun.color);
      podSun.intensity = sun.intensity;
      const toward = sun.position.clone().sub(sun.target.position).normalize();
      podSun.target.position.copy(at);
      podSun.position.copy(at).addScaledVector(toward, 120);
    },
    update(time: number, dt: number) {
      dome.material.uniforms.gain.value = (scene.fog as THREE.Fog).far;
      for (const s of shafts) s.uniforms.time.value = time;
      for (const c of cars) {
        // up, wait, down, wait: a smooth ride between the ends
        const h = c.userData.hoist as (typeof HOISTS)[number];
        const span = h.hi - h.lo, ride = span / h.speed, cycle = 2 * ride + 16;
        const t = (time + h.phase * 10) % cycle;
        const u = t < ride ? t / ride : t < ride + 8 ? 1 : t < 2 * ride + 8 ? 1 - (t - ride - 8) / ride : 0;
        c.position.y = h.lo + span * u * u * (3 - 2 * u);
      }
      for (let i = 0; i < DUST; i++) {
        const s = seeds[i];
        dust[i * 3] += Math.sin(time * 0.3 + s) * 0.05 * dt;
        dust[i * 3 + 1] -= (0.03 + 0.03 * Math.sin(s)) * dt;
        dust[i * 3 + 2] += Math.cos(time * 0.27 + s * 1.3) * 0.05 * dt;
        if (dust[i * 3 + 1] < -6) dustAt(i, false);
      }
      dustGeo.attributes.position.needsUpdate = true;
    },
  };
}
