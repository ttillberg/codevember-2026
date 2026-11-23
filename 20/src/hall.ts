import * as THREE from 'three';
import { COVER, hallSteel } from './materials';
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
export function buildHall(scene: THREE.Scene, hang: THREE.Vector3, maxTexture = 4096, steelAs: string | null = null) {
  const fullSteel = steelAs === 'full';
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ROOF = 75; // high up, in the haze

  // ---------- steel: every bar one instance of a unit box, stretched from a to b

  // Cheap but good to look at: only the hall's own bay round the pod is built bar by bar. Everything further out,
  // which is nearly all of it and stands in the haze, is a light frame: the same towers, girders and stagings with
  // bays three times as long and members a little heavier, so they hold at that distance. A third of the bars,
  // and drawn in a few big blocks instead of hundreds of small ones.
  const bars: THREE.Matrix4[] = [];
  const lite: THREE.Matrix4[] = [];
  let sink = bars;
  const nodes: THREE.Vector3[] = []; // joints of the far frame, where a lamp might be
  const NEAR = { x: 15, z0: -39, z1: 27, y0: -30, y1: 34 };
  // (fullSteel: all of it bar by bar, as it was, to set the light frame against: ?steel=full)
  const farAt = (x: number, y: number, z: number) => !fullSteel && (Math.abs(x) > NEAR.x || z < NEAR.z0 || z > NEAR.z1 || y < NEAR.y0 || y > NEAR.y1);
  const up = V(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const bar = (a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) => {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return;
    q.setFromUnitVectors(up, d.divideScalar(len));
    sink.push(m4.compose(a.clone().add(b).multiplyScalar(0.5), q, V(w, len, h)).clone());
  };

  /** a box truss from a to b, `side` its half width, `rise` its height, panels about `panel` long. Far off (or
   *  where `light` says so) a light one: long panels, a post each side and a diagonal, nothing across */
  const truss = (a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, rise: THREE.Vector3, panel: number, chord = 0.16, web = 0.07, light?: boolean) => {
    const mid = a.clone().lerp(b, 0.5);
    const far = fullSteel ? false : light ?? farAt(mid.x, mid.y, mid.z);
    const was = sink;
    sink = far ? lite : bars;
    if (far) { panel *= 3; chord *= 1.25; web *= 1.5; }
    const corners = [side.clone().negate(), side.clone(), side.clone().negate().add(rise), side.clone().add(rise)];
    for (const c of corners) bar(a.clone().add(c), b.clone().add(c), chord);
    const n = Math.max(1, Math.round(a.distanceTo(b) / panel));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const [l0, r0, l1, r1] = corners.map((c) => p.clone().add(c));
      bar(l0, l1, web); bar(r0, r1, web);
      if (!far) { bar(l0, r0, web); bar(l1, r1, web); } else nodes.push(i % 2 ? l0 : r1);
      if (i === n) continue;
      const p2 = a.clone().lerp(b, (i + 1) / n);
      const [l2, r2, l3, r3] = corners.map((c) => p2.clone().add(c));
      if (i % 2) { bar(l0, l3, web); bar(r0, r3, web); } else { bar(l1, l2, web); bar(r1, r2, web); }
    }
    sink = was;
  };

  /** a lattice tower, w wide, from y0 to y1: bar by bar where it passes the pod's bay, a light one above, below
   *  and everywhere else (long bays, a diagonal on two faces of each in turn) */
  const tower = (x: number, z: number, y0: number, y1: number, w: number) => {
    const h = w / 2;
    const cs = [V(-h, 0, -h), V(h, 0, -h), V(h, 0, h), V(-h, 0, h)];
    const was = sink;
    const run = (a: number, b: number, far: boolean) => {
      if (b - a < 0.5) return;
      sink = far ? lite : bars;
      for (const c of cs) bar(V(x + c.x, a, z + c.z), V(x + c.x, b, z + c.z), far ? 0.26 : 0.22);
      const step = w * 1.2 * (far ? 3 : 1);
      for (let y = a, k = 0; y < b; y += step, k++) {
        const top = Math.min(b, y + step);
        if (far) nodes.push(V(x + cs[k % 4].x * 1.15, y + 0.4, z + cs[k % 4].z * 1.15));
        for (let i = 0; i < 4; i++) {
          const p = cs[i], n = cs[(i + 1) % 4];
          bar(V(x + p.x, y, z + p.z), V(x + n.x, y, z + n.z), far ? 0.14 : 0.1);
          if (far && (k + i) % 2) continue;
          const flip = (k + (far ? i >> 1 : i)) % 2 ? 1 : 0;
          bar(V(x + p.x, flip ? top : y, z + p.z), V(x + n.x, flip ? y : top, z + n.z), far ? 0.1 : 0.07);
        }
      }
    };
    if (farAt(x, 0, z)) run(y0, y1, true);
    else { run(y0, NEAR.y0, true); run(Math.max(y0, NEAR.y0), Math.min(y1, NEAR.y1), false); run(NEAR.y1, y1, true); }
    sink = was;
  };

  const TX = 12; // the towers either side of the pod
  const WX = 60; // the wall on the sun's side
  const LEVELS = [-14, 22, 44, 62]; // girders across and along
  // the structure goes on in every direction, a grid of towers out into the haze; none near the eye
  const COLS = [-60, -44, -28, -TX, TX, 28, 44];
  const ROWS = [54, 39, 24, -6, -21, -36, -51, -66];
  const rows = [24, -6, -21, -36]; // the hall's own rows round the pod, with catwalks along them
  const near = (x: number, z: number) => Math.abs(x) <= TX && z <= 24 && z >= -36;
  const spans: { a: THREE.Vector3; b: THREE.Vector3 }[] = []; // the girders across, for other pods to hang from (game.ts)
  for (const z of ROWS) {
    for (const x of COLS) tower(x, z, -45, ROOF, 2.4);
    for (let i = 0; i < COLS.length - 1; i++) {
      const a = COLS[i], b = COLS[i + 1];
      // girders across: every level round the pod, every other one further out, staggered row by row
      const k = ROWS.indexOf(z);
      const ys = near(a, z) && near(b, z) ? LEVELS : LEVELS.filter((_, j) => (j + i + k) % 2 === 0);
      for (const y of ys) { truss(V(a, y, z), V(b, y, z), V(0, 0, 0.8), V(0, 2.2, 0), 2.2); spans.push({ a: V(a, y, z), b: V(b, y, z) }); }
    }
    // the roof's trusses, deep ones, right across
    truss(V(COLS[0] - 6, ROOF - 4, z), V(WX, ROOF - 4, z), V(0, 0, 0.6), V(0, 4, 0), 3, 0.2, 0.09, true);
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
  truss(V(-TX, gy, hang.z), V(TX, gy, hang.z), V(0, 0, 0.6), V(0, 1.8, 0), 1.8, 0.2, 0.08, false);
  sink = lite;
  for (let x = COLS[0] - 6; x <= WX; x += 8) bar(V(x, ROOF - 4, ROWS[0] + 6), V(x, ROOF - 4, ROWS[ROWS.length - 1] - 6), 0.3, 0.5);
  sink = bars;
  // a frame round the hang point where the hoses come down from, a grating hung under the girder: on a trolley
  // that runs along it (main.ts drives it), so its bars are kept apart from the hall's, which stand still
  const carriage: THREE.Matrix4[] = [];
  {
    const n0 = bars.length;
    const y = gy - 0.15, s = 1.9;
    const c = [V(-s, y, -s), V(s, y, -s), V(s, y, s), V(-s, y, s)].map((p) => p.add(V(hang.x, 0, hang.z)));
    for (let i = 0; i < 4; i++) bar(c[i], c[(i + 1) % 4], 0.14, 0.2);
    for (let i = 1; i < 6; i++) {
      const t = -s + (2 * s * i) / 6;
      bar(V(hang.x + t, y, hang.z - s), V(hang.x + t, y, hang.z + s), 0.06);
    }
    for (const p of c) bar(p, V(p.x, gy, hang.z + Math.sign(p.z - hang.z) * 0.6), 0.06);
    // the trolley itself: a beam across under the girder's chords, a truck with two wheels on each chord
    bar(V(hang.x, gy - 0.05, hang.z - 0.9), V(hang.x, gy - 0.05, hang.z + 0.9), 0.22, 0.18);
    for (const z of [-0.6, 0.6]) for (const x of [-0.35, 0.35]) bar(V(hang.x + x, gy - 0.05, hang.z + z), V(hang.x + x, gy + 0.32, hang.z + z), 0.08);
    for (const z of [-0.6, 0.6]) bar(V(hang.x - 0.45, gy + 0.32, hang.z + z), V(hang.x + 0.45, gy + 0.32, hang.z + z), 0.1, 0.16);
    carriage.push(...bars.splice(n0));
  }

  // the roof: across each bay, bands of glass between strips of deck, glazing bars across the glass; the deck
  // is solid to the sun, the glass not, so the light comes in in bands, cut by the bars
  const X0 = COLS[0] - 6, Z0 = ROWS[0] + 6, Z1 = ROWS[ROWS.length - 1] - 6;
  const deck: THREE.Matrix4[] = [];
  const box = (c: THREE.Vector3, size: THREE.Vector3) => deck.push(new THREE.Matrix4().compose(c, new THREE.Quaternion(), size));
  // glass only in the middle: a deck all round the edge, EDGE wide, so the light comes down in the middle of the hall
  const EDGE = 24, GZ0 = Z0 - EDGE, GZ1 = Z1 + EDGE;
  const GLASS: [number, number][] = [];
  for (let x = X0, k = 0; x < WX; x += 3, k++) {
    if (k % 2 && x >= X0 + EDGE && x + 3 <= WX - EDGE) {
      GLASS.push([x, x + 3]);
      box(V(x + 1.5, ROOF + 0.3, (Z0 + GZ0) / 2), V(3, 0.4, Z0 - GZ0)); // the deck at either end of the band
      box(V(x + 1.5, ROOF + 0.3, (GZ1 + Z1) / 2), V(3, 0.4, GZ1 - Z1));
      continue;
    }
    box(V(x + 1.5, ROOF + 0.3, (Z0 + Z1) / 2), V(3, 0.4, Z0 - Z1));
  }
  sink = lite;
  for (const [x0, x1] of GLASS) {
    for (let z = GZ0; z > GZ1; z -= 1.4) bar(V(x0, ROOF + 0.3, z), V(x1, ROOF + 0.3, z), 0.08, 0.16);
    bar(V((x0 + x1) / 2, ROOF + 0.3, GZ0), V((x0 + x1) / 2, ROOF + 0.3, GZ1), 0.06, 0.12);
  }
  sink = bars;
  const FAN_R = 6.5, HUB = 1.1, BLADES = 5;
  // two bigger ones up in the sun's wall, near the end: the first just where the eye looks up to as the page
  // opens, behind the steel but peeking out from under it. The sun itself comes in through them
  const SIDE_SCALE = 1.4;
  // (there were two, side by side up near the end; taken out. The code stays for any put back)
  const SIDE_FANS: { at: THREE.Vector3; angle: number; speed: number; on: boolean; run: number }[] = [];
  // the far wall: solid, small openings in a few rows, not every bay, and a square cut out for each fan
  const HOLES: THREE.Vector3[] = [];
  {
    const SQ = FAN_R * SIDE_SCALE + 0.5;
    const rects: number[][] = []; // z0, z1, y0, y1
    const side = (c: THREE.Vector3, size: THREE.Vector3) => rects.push([c.z - size.z / 2, c.z + size.z / 2, c.y - size.y / 2, c.y + size.y / 2]);
    const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const BANDS = [14, 32, 48, 62];
    const H = 1.4, W = 1.0;
    let y = -46;
    for (const b of BANDS) {
      side(V(WX, (y + b) / 2, (Z0 + Z1) / 2), V(0.5, b - y, Z0 - Z1));   // solid up to the band
      let z = Z0;
      for (let c = Z0 - 2.5; c > Z1 + 1; c -= 4.5) {
        if (rnd() < 0.45) continue;
        side(V(WX, b + H / 2, (z + c + W / 2) / 2), V(0.5, H, z - (c + W / 2)));
        if (!SIDE_FANS.some((f) => Math.abs(c - f.at.z) < SQ + W && Math.abs(b + H / 2 - f.at.y) < SQ + H)) HOLES.push(V(WX, b + H / 2, c));
        z = c - W / 2;
      }
      side(V(WX, b + H / 2, (z + Z1) / 2), V(0.5, H, z - Z1));
      y = b + H;
    }
    side(V(WX, (y + ROOF + 0.5) / 2, (Z0 + Z1) / 2), V(0.5, ROOF + 0.5 - y, Z0 - Z1));
    // the fans' squares cut out of it: each piece that overlaps one split round it
    for (const f of SIDE_FANS) {
      const [h0, h1, k0, k1] = [f.at.z - SQ, f.at.z + SQ, f.at.y - SQ, f.at.y + SQ];
      for (const r of rects.splice(0)) {
        const [z0, z1, y0, y1] = r;
        if (z1 <= h0 || z0 >= h1 || y1 <= k0 || y0 >= k1) { rects.push(r); continue; }
        if (y0 < k0) rects.push([z0, z1, y0, k0]);
        if (y1 > k1) rects.push([z0, z1, k1, y1]);
        const m0 = Math.max(y0, k0), m1 = Math.min(y1, k1);
        if (z0 < h0) rects.push([z0, h0, m0, m1]);
        if (z1 > h1) rects.push([h1, z1, m0, m1]);
      }
    }
    for (const [z0, z1, y0, y1] of rects) if (z1 - z0 > 0.01 && y1 - y0 > 0.01) box(V(WX, (y0 + y1) / 2, (z0 + z1) / 2), V(0.5, y1 - y0, z1 - z0));
  }
  // the end wall the eye looks at: solid, but for a row of square holes, each a vent with a huge fan in it
  const FZ = Z1;
  // between the towers, high up between the girders at 44 and 62 m, the light behind them coming in a little down and across
  const FANS = [-20, 0, 20].map((x, i) => ({ at: V(x, 53, FZ), angle: i * 0.7, speed: (i % 2 ? -1 : 1) * (0.2 + 0.04 * i), on: true, run: 1 }));
  const FAN_DIR = V(0.12, -0.28, 1).normalize();
  {
    const S = 2 * FAN_R + 1, lo = FANS[0].at.y - S / 2, hi = FANS[0].at.y + S / 2;
    const wall = (x0: number, x1: number, y0: number, y1: number) => box(V((x0 + x1) / 2, (y0 + y1) / 2, FZ), V(x1 - x0, y1 - y0, 0.5));
    wall(X0, WX, -46, lo);
    wall(X0, WX, hi, ROOF + 0.5);
    let x = X0;
    for (const f of FANS) { wall(x, f.at.x - S / 2, lo, hi); x = f.at.x + S / 2; }
    wall(x, WX, lo, hi);
  }

  // scaffolding: tubes on a 2 x 1.3 m grid, a lift of ledgers every 2 m, braces up the outside in turn, boards
  // on every third lift; wrapped round some of the towers, part of the way up
  const scaffold = (cx: number, cz: number, nx: number, nz: number, y0: number, lifts: number) => {
    const BX = 2, BZ = 1.3, LIFT = 2;
    const x0 = cx - (nx * BX) / 2, z0 = cz - (nz * BZ) / 2;
    const at = (i: number, k: number, l: number) => V(x0 + i * BX, y0 + l * LIFT, z0 + k * BZ);
    const top = lifts;
    if (farAt(cx, y0 + (lifts * LIFT) / 2, cz)) {
      // far off: the standards, and on every third lift one ledger and one run of boards down each side, a brace
      // up each face between them
      sink = lite;
      for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
        if (i > 0 && i < nx && k > 0 && k < nz) continue;
        bar(at(i, k, 0), at(i, k, top), 0.07);
      }
      for (let l = 3; l <= top; l += 3) {
        for (const k of [0, nz]) {
          bar(at(0, k, l), at(nx, k, l), 0.07);
          bar(at(0, k, l).add(V(0, 0.03, k ? -0.55 : 0.55)), at(nx, k, l).add(V(0, 0.03, k ? -0.55 : 0.55)), 1.0, 0.05);
          if ((l / 3) % 2) bar(at(0, k, l - 3), at(nx, k, l), 0.06); else bar(at(nx, k, l - 3), at(0, k, l), 0.06);
        }
        for (const i of [0, nx]) {
          bar(at(i, 0, l), at(i, nz, l), 0.07);
          bar(at(i, 0, l).add(V(i ? -0.55 : 0.55, 0.03, 0)), at(i, nz, l).add(V(i ? -0.55 : 0.55, 0.03, 0)), 0.05, 1.0);
        }
      }
      sink = bars;
      return;
    }
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
  // and near the pod, in its own bay, bar by bar: round the towers the eye looks past, at the heights it looks at
  scaffold(TX, -21, 3, 4, 0, 12);
  scaffold(-TX, -6, 3, 4, -14, 11);
  scaffold(-TX, 24, 3, 4, -8, 8);

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
    // (bar by bar where it passes the pod's bay, in long bays elsewhere)
    for (let y = -45, k = 0; y < h.hi + 6; k++) {
      const far = farAt(h.x, y, h.z);
      const step = far ? 4.5 : 1.5, top = Math.min(h.hi + 6, y + step);
      sink = far ? lite : bars;
      for (const c of cs) bar(V(h.x + c.x, y, h.z + c.z), V(h.x + c.x, top, h.z + c.z), far ? 0.08 : 0.06);
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        bar(V(h.x + a.x, y, h.z + a.z), V(h.x + b.x, y, h.z + b.z), far ? 0.06 : 0.04);
        if (k % 2 === i % 2) bar(V(h.x + a.x, y, h.z + a.z), V(h.x + b.x, top, h.z + b.z), far ? 0.05 : 0.03);
      }
      y = top;
    }
    sink = lite;
    // ties back to the tower every 9 m
    const dx = towardTower(h);
    for (let y = -40; y < h.hi; y += 9) bar(V(h.x + dx * s, y, h.z), V(h.x + dx * 2, y, h.z), 0.06);
    sink = bars;
  }

  // ---------- the fine steel: what a hall like this has and nobody draws. Landings on the hoists' masts with their
  // railings and gates, a caged ladder up every mast, and the catwalks' railings finished (a knee rail, a toe
  // board, a brace in every bay). Some nine thousand bars more, and shown only while the eye is on the hall and
  // not on the pod (main.ts): those shots begin with a cut, so nothing is seen to come or go, and while the pod
  // is the picture none of it is drawn
  const fine: THREE.Matrix4[] = [];
  sink = fine;
  for (const h of HOISTS) {
    const side = -towardTower(h);
    // the ladder, on the mast's face away from the cage: stringers, a rung every 30 cm, a hoop every 90, straps down the hoops
    const lx = h.x - side * 0.4, lz = h.z;
    const y0 = h.lo - 2, y1 = h.hi + 4;
    for (const dz of [-0.22, 0.22]) bar(V(lx - side * 0.12, y0, lz + dz), V(lx - side * 0.12, y1, lz + dz), 0.05, 0.02);
    for (let y = y0 + 0.3; y < y1; y += 0.3) bar(V(lx - side * 0.12, y, lz - 0.22), V(lx - side * 0.12, y, lz + 0.22), 0.025);
    const hoop = [[0.12, -0.36], [0.5, -0.36], [0.78, -0.16], [0.78, 0.16], [0.5, 0.36], [0.12, 0.36]];
    for (let y = y0 + 2.2; y < y1; y += 0.9) {
      for (let i = 0; i < hoop.length - 1; i++) bar(V(lx - side * hoop[i][0], y, lz + hoop[i][1]), V(lx - side * hoop[i + 1][0], y, lz + hoop[i + 1][1]), 0.04, 0.008);
    }
    for (const k of [1, 2, 3, 4]) bar(V(lx - side * hoop[k][0], y0 + 2.2, lz + hoop[k][1]), V(lx - side * hoop[k][0], y1, lz + hoop[k][1]), 0.03, 0.006);
    // a landing at every stop, beside where the cage comes to rest: a grating, railings round three sides, a gate
    const cx = h.x + side * 1.25;
    for (let y = h.lo; y <= h.hi; y += 6) {
      const z0 = h.z + 1.15, z1 = z0 + 1.5, x0 = cx - 0.8, x1 = cx + 0.8;
      for (const x of [x0, x1]) bar(V(x, y - 0.06, z0), V(x, y - 0.06, z1), 0.06, 0.12);
      for (const z of [z0, z1]) bar(V(x0, y - 0.06, z), V(x1, y - 0.06, z), 0.06, 0.12);
      for (let x = x0 + 0.1; x < x1; x += 0.1) bar(V(x, y - 0.02, z0), V(x, y - 0.02, z1), 0.012, 0.03); // the grating
      const rail = (a: THREE.Vector3, b: THREE.Vector3) => {
        const n = Math.max(1, Math.round(a.distanceTo(b) / 0.75));
        for (let i = 0; i <= n; i++) { const q = a.clone().lerp(b, i / n); bar(q, q.clone().setY(y + 1.1), 0.035); }
        for (const u of [1.1, 0.55]) bar(a.clone().setY(y + u), b.clone().setY(y + u), 0.035);
        bar(a.clone().setY(y + 0.07), b.clone().setY(y + 0.07), 0.01, 0.14); // toe board
        for (let i = 0; i < n; i++) bar(a.clone().lerp(b, i / n).setY(y + 0.14), a.clone().lerp(b, (i + 1) / n).setY(y + 0.55), 0.015); // a brace in each bay
      };
      rail(V(x0, y, z0), V(x0, y, z1)); rail(V(x0, y, z1), V(x1, y, z1)); rail(V(x1, y, z1), V(x1, y, z0));
      // the gate towards the cage: a frame, a bar across, a cross
      bar(V(x0, y + 1.1, z0), V(x1, y + 1.1, z0), 0.03); bar(V(x0, y + 0.2, z0), V(x1, y + 0.2, z0), 0.03);
      bar(V(x0, y + 0.2, z0), V(x1, y + 1.1, z0), 0.015); bar(V(x1, y + 0.2, z0), V(x0, y + 1.1, z0), 0.015);
      // and two brackets back to the mast under it
      for (const z of [z0 + 0.1, z1 - 0.1]) bar(V(h.x, y - 1.2, h.z + 0.4), V(cx, y - 0.1, z), 0.04);
    }
  }
  // the catwalks' railings, finished
  for (const x of [-TX, TX]) {
    const cx = x - Math.sign(x) * 2.2;
    for (const y of [-6, 12]) {
      const z0 = rows[0] + 2, z1 = rows[rows.length - 1] - 2;
      for (const dx of [-0.6, 0.6]) {
        bar(V(cx + dx, y + 0.55, z0), V(cx + dx, y + 0.55, z1), 0.035);
        bar(V(cx + dx, y + 0.2, z0), V(cx + dx, y + 0.2, z1), 0.01, 0.15);
        for (let z = z0, k = 0; z > z1 + 1.5; z -= 1.5, k++) bar(V(cx + dx, y + (k % 2 ? 1.1 : 0.2), z), V(cx + dx, y + (k % 2 ? 0.2 : 1.1), z - 1.5), 0.015);
      }
      for (let z = z0 - 0.15; z > z1; z -= 0.15) bar(V(cx - 0.6, y + 0.03, z), V(cx + 0.6, y + 0.03, z), 0.012, 0.03); // the grating under foot
    }
  }
  sink = bars;

  const steel = hallSteel(new THREE.MeshStandardMaterial({ color: 0x2b2e32, roughness: 0.62, metalness: 0.55 }));
  // and the same without the grit, for the debug panel to set against it (most of the steel is far off in the haze)
  const plainSteel = new THREE.MeshStandardMaterial({ color: 0x2b2e32, roughness: 0.62, metalness: 0.55 });
  const steelBlocks: THREE.InstancedMesh[] = [];
  const bareBars: THREE.InstancedMesh[] = []; // the bars alone, without the roof and the wall: ?no=scaffolding
  // the steel in blocks of the hall, one instanced mesh each with its own bounds, so that every camera (the eye,
  // the pod's tight sun, the skylight) draws only the blocks it can see, not all 40 000 bars every time
  const unit = new THREE.BoxGeometry(1, 1, 1);
  // the light frame far off is not lit at all: out there it is a dark shape in the haze and nothing else, and the
  // lights, their shadow maps and the grit were being worked out for every pixel of it (?steel=lit: lit all the same)
  const farSteel = steelAs === 'lit' ? steel : new THREE.MeshBasicMaterial({ color: 0x0c0d0f });
  const chunked = (list: THREE.Matrix4[], cell: THREE.Vector3, into?: THREE.InstancedMesh[], material: THREE.Material = steel) => {
    const blocks = new Map<string, THREE.Matrix4[]>();
    const at = new THREE.Vector3();
    for (const m of list) {
      at.setFromMatrixPosition(m);
      const key = `${Math.floor(at.x / cell.x)},${Math.floor(at.y / cell.y)},${Math.floor(at.z / cell.z)}`;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key)!.push(m);
    }
    for (const ms of blocks.values()) {
      const mesh = new THREE.InstancedMesh(unit, material, ms.length);
      if (material === steel) steelBlocks.push(mesh);
      into?.push(mesh);
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
  chunked(bars, V(16, 24, 15), bareBars);
  chunked(lite, V(64, 80, 60), bareBars, farSteel); // the light frame far off: a few big blocks
  const fineBlocks: THREE.InstancedMesh[] = [];
  chunked(fine, V(32, 48, 30), fineBlocks);
  for (const m of fineBlocks) { m.visible = false; m.castShadow = false; }
  if (import.meta.env.DEV) console.info(`hall fine steel: ${fine.length} bars, ${fineBlocks.length} blocks`);
  if (import.meta.env.DEV) console.info(`hall steel: ${bars.length} bars near, ${lite.length} far, ${bareBars.length} blocks`);
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

  // the trolley, and the block under it: a sheave in a frame
  const trolley = new THREE.Group();
  {
    const mesh = new THREE.InstancedMesh(unit, steel, carriage.length);
    carriage.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = mesh.receiveShadow = true;
    const wheel = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 18).rotateX(Math.PI / 2);
    const wm = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.5, metalness: 0.8 });
    for (const z of [-0.6, 0.6]) for (const x of [-0.35, 0.35]) {
      const w = new THREE.Mesh(wheel, wm);
      w.position.set(hang.x + x, gy + 0.13, hang.z + z + 0.13 * Math.sign(z));
      w.castShadow = true;
      trolley.add(w);
    }
    trolley.add(mesh);
    scene.add(trolley);
  }
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.45, metalness: 0.8 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), mat);
    frame.position.set(hang.x, hang.y + 0.12, hang.z);
    const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), mat);
    sheave.rotation.x = Math.PI / 2;
    sheave.position.set(hang.x, hang.y + 0.15, hang.z);
    frame.castShadow = sheave.castShadow = true;
    trolley.add(frame, sheave);
  }

  // the fans: a plate round each hole cut round, a drum through the wall, struts holding the motor, five broad
  // blades on a hub, and the daylight behind, bright through the haze; the light through them is in rays.ts
  const rotors: THREE.Group[] = [];
  const shutters: { side: boolean; leaves: THREE.Mesh[] }[] = [];
  // (a leaf: from its inner edge out past the rim, wide enough to cover its fifth of the opening and more)
  const leafGeo = new THREE.BoxGeometry(FAN_R + 0.6, 2 * FAN_R + 0.4, 0.03).translate((FAN_R + 0.6) / 2, 0, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide });
  // each wall's: where they are (1 open, 0 shut), where they are going, how fast
  let liftsOn = false, liftTime = 0; // the hoists stand where they are until set going
  const iris = { end: { s: 1, to: 1, v: 0 }, side: { s: 1, to: 1, v: 0 } }; // (open to start with: the light the hall starts in)
  {
    const S = 2 * FAN_R + 1;
    const plate = new THREE.Shape().moveTo(-S / 2, -S / 2).lineTo(S / 2, -S / 2).lineTo(S / 2, S / 2).lineTo(-S / 2, S / 2).closePath();
    plate.holes.push(new THREE.Path().absarc(0, 0, FAN_R + 0.15, 0, Math.PI * 2, true));
    const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.5, bevelEnabled: false, curveSegments: 64 });
    const drum = new THREE.CylinderGeometry(FAN_R + 0.15, FAN_R + 0.15, 2.6, 64, 1, true).rotateX(Math.PI / 2);
    const inner = steel.clone();
    inner.side = THREE.DoubleSide;
    const day = new THREE.MeshBasicMaterial({ color: 0xdfe6ee, fog: false });
    const disc = new THREE.CircleGeometry(FAN_R + 0.2, 64);
    const strut = new THREE.BoxGeometry(FAN_R, 0.3, 0.3).translate(FAN_R / 2, 0, 0);
    const motor = new THREE.CylinderGeometry(1.3, 1.3, 2.2, 32).rotateX(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(HUB, HUB, 0.9, 32).rotateX(Math.PI / 2);
    const nose = new THREE.SphereGeometry(HUB, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.6);
    // a blade, seen down the axis: narrow at the root, broad at the tip; pitched a third of the way round its length
    const tip = FAN_R - 0.25;
    const outline = new THREE.Shape().moveTo(HUB * 0.8, -0.5).lineTo(tip, -1.3).quadraticCurveTo(tip + 0.35, 0, tip, 1.3).lineTo(HUB * 0.8, 0.5).closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.06, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -0.03);
    // (the ones in the sun's wall stand in its way: plate, drum, struts and motor go into its map, which is drawn
    // once, so the light comes in round; the blades turn and are worked out where the light is marched, rays.ts)
    let still = false;
    const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, z: number) => {
      const o = new THREE.Mesh(g, m);
      o.position.z = z;
      o.receiveShadow = true;
      o.castShadow = o.userData.still = still && m !== day;
      parent.add(o);
      return o;
    };
    for (const f of [...FANS, ...SIDE_FANS]) {
      const g = new THREE.Group();
      g.position.copy(f.at);
      still = SIDE_FANS.includes(f);
      if (still) { g.rotation.y = -Math.PI / 2; g.scale.setScalar(SIDE_SCALE); } // facing in from the sun's side
      add(g, plateGeo, steel, -0.25);
      add(g, drum, inner, -0.4);
      add(g, disc, day, -1.8);
      for (let k = 0; k < 3; k++) add(g, strut, steel, -0.6).rotation.z = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      add(g, motor, steel, -0.4);
      still = false;
      const rotor = new THREE.Group();
      rotor.position.z = 0.7;
      add(rotor, hub, steel, 0);
      add(rotor, nose, steel, 0.45);
      for (let k = 0; k < BLADES; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k * 2 * Math.PI) / BLADES;
        add(arm, bladeGeo, inner, 0).rotation.x = Math.PI / 6;
        rotor.add(arm);
      }
      rotor.rotation.z = f.angle;
      g.add(rotor);
      rotors.push(rotor);
      // the leaf shutter behind it, outside the wall: five blades, each a plate whose inner edge is one side of a
      // five-sided opening; they slide in from five sides (turning a little as they come) until they meet in the
      // middle. Open, they are back behind the wall
      const iris = new THREE.Group();
      iris.position.z = -1.0;
      const leaves: THREE.Mesh[] = [];
      for (let k = 0; k < 5; k++) {
        const pivot = new THREE.Group();
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.z = k * 0.012; // (each over the last, as the blades of a shutter lie)
        pivot.add(leaf);
        iris.add(pivot);
        leaves.push(leaf);
      }
      g.add(iris);
      shutters.push({ side: SIDE_FANS.includes(f), leaves });
      scene.add(g);
    }
  }
  /** set a wall's shutters: s 1 open, 0 shut */
  const setLeaves = (side: boolean, s: number) => {
    const a = s * (FAN_R + 0.3) - 0.08, turn = (1 - s) * 0.3;
    for (const sh of shutters) {
      if (sh.side !== side) continue;
      sh.leaves.forEach((leaf, k) => { leaf.parent!.rotation.z = turn + (k * 2 * Math.PI) / 5; leaf.position.x = a; });
    }
  };
  setLeaves(false, 1);
  setLeaves(true, 1);

  // the small windows in the sun's wall: daylight, so as much as the roof lets in (update)
  const windowGlow = new THREE.MeshBasicMaterial({ color: 0xc4ccd6 });
  const WINDOW = new THREE.Color(0xc4ccd6);
  // the glass in the roof and the windows: bright, the sky through them, seen through the haze
  {
    const glow = new THREE.MeshBasicMaterial({ color: 0xdfe6ee, fog: false });
    const pane = new THREE.PlaneGeometry(1, 1);
    for (const [x0, x1] of GLASS) {
      const m = new THREE.Mesh(pane, glow);
      m.scale.set(x1 - x0, GZ0 - GZ1, 1);
      m.rotation.x = Math.PI / 2;
      m.position.set((x0 + x1) / 2, ROOF + 0.9, (GZ0 + GZ1) / 2);
      scene.add(m);
    }
    // (the small windows in the sun's wall in the haze like the rest, so they do not stand out of it as specks)
    const far = windowGlow;
    for (const h of HOLES) {
      const m = new THREE.Mesh(pane, far);
      m.scale.set(1, 1.4, 1);
      m.rotation.y = -Math.PI / 2;
      m.position.set(WX + 0.6, h.y, h.z);
      scene.add(m);
    }
  }

  // ---------- the roof's shutter: as on a shop front, but over the whole roof. Slats run from the far end on the sun's
  // side right across to a drum at this end, between the deck and the glass, and roll up onto it: the hall starts
  // dark and the light comes in as it rolls, band by band of glass from the sun's side over to here. Its shadow
  // is worked out where the light is (materials.ts, rays.ts); only the pod's own sun has it drawn in its map
  const SHUT_Y = ROOF + 0.7, SLAT = 0.6, RUN = WX - X0, R0 = 1.1, THICK_SLAT = 0.07;
  // It stops at the glass's two ends. Shut, its edge lies just past the last band of glass on the sun's side, and
  // the first slat it rolls back lets light in. (It ran on over the 24 m of solid deck to the wall, and to open it
  // had to roll all of that back first: six seconds of nothing after the button.) Open, it is rolled back to just
  // short of the first band on this side: all of the glass is clear. (It stopped at a quarter of the roof, over
  // two of the bands.) What is left of it lies over the deck there, out of sight from below.
  // (a metre and a half past the glass: its shadow's edge is 0.6 m soft, and the sun comes in on the slant, under
  // the slats' end and down through the glass's opening in the deck, 20 cm or so of it. At 0.7 m a sliver of
  // sun still got by, and the dark under the roof had dots in it. Open, 2.5 m short of the first band, for the
  // light in the air, which comes on over 8 m behind the edge, rays.ts)
  const SHUT_AT = (GLASS[GLASS.length - 1][1] + 1.5 - X0) / RUN, OPEN_AT = (GLASS[0][0] - 2.5 - X0) / RUN;
  COVER.glass.value.set(GLASS[0][0], GLASS[GLASS.length - 1][1], GZ1, GZ0);
  let shut = SHUT_AT, shutTo = SHUT_AT, shutV = 0; // how much of the roof it covers, where it is going, how fast: shut to start with
  /** how much of the day is let in: 0 shut, 0.75 open (the figure the lights were set to, when open was a quarter covered) */
  const dayIn = () => 0.75 * THREE.MathUtils.clamp((SHUT_AT - shut) / (SHUT_AT - OPEN_AT), 0, 1);
  const shutter = new THREE.Group();
  const slatMat = new THREE.MeshStandardMaterial({ color: 0x34373b, roughness: 0.5, metalness: 0.75 });
  // (each a little wider than its pitch, so they overlap: shut, no glass glows through between them)
  const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(SLAT + 0.04, THICK_SLAT, Z0 - Z1 + 2), slatMat, Math.ceil(RUN / SLAT) + 1);
  slats.castShadow = true;
  slats.frustumCulled = false;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, Z0 - Z1 + 2, 48).rotateX(Math.PI / 2), slatMat);
  drum.castShadow = true;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.4, Z0 - Z1 + 4), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6, metalness: 0.6 }));
  housing.position.set(X0 - 2.6, SHUT_Y + 2.3, (Z0 + Z1) / 2);
  housing.castShadow = true;
  shutter.add(slats, drum, housing);
  scene.add(shutter);
  const lay = () => {
    const L = shut * RUN;
    const n = Math.floor(L / SLAT);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) slats.setMatrixAt(i, m.makeTranslation(X0 + L - (i + 0.5) * SLAT, SHUT_Y, (Z0 + Z1) / 2));
    slats.count = n;
    slats.instanceMatrix.needsUpdate = true;
    // the drum fattens with what is wound on it, and turns as it winds
    const r = Math.sqrt(R0 * R0 + ((1 - shut) * RUN * THICK_SLAT) / Math.PI);
    drum.scale.set(r, 1, r);
    drum.position.set(X0 - 2.6, SHUT_Y + r - 0.1, (Z0 + Z1) / 2);
    drum.rotation.z = -((1 - shut) * RUN) / r;
    COVER.x.value.set(X0 - 1, X0 + L, 0.6, L > 0.05 ? 1 : 0);
  };
  lay();

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
  let mapDue = 0; // seconds to the next drawing of the sun's map while the shutter moves
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
  let shaftK = 1;
  const roofBase = roof.intensity;
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
  // And all over the hall, not only by the pod: down from the roof's glass along the sun, where a band of it lets
  // the sun through, and in from the windows in the sun's wall. (With cones only round the pod, the eye drawn back
  // saw them for what they were, light kept to one corner of the hall: they were faded out with the distance. Now
  // they are everywhere the light comes in, and stay.) Each from a fixed place, seeded; the roof's go with the
  // shutter over the glass they come through, the windows' with the daylight
  const roofShafts: { mat: THREE.ShaderMaterial; x: number }[] = [];
  {
    const rnd = (() => { let a = 2024; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const down = sun.target.position.clone().sub(sun.position).normalize();
    for (let i = 0; i < 16; i++) {
      const [x0, x1] = GLASS[Math.floor(rnd() * GLASS.length)];
      const from = V(x0 + (x1 - x0) * rnd(), ROOF, GZ1 + (GZ0 - GZ1) * rnd());
      if (from.distanceTo(roof.position) < 10) continue; // (the one over the pod is its own)
      shaft(from, down, 70 + 30 * rnd(), 1.0 + 0.8 * rnd(), 4 + 3 * rnd(), 0xc8d4e0, 0.05 + 0.05 * rnd());
      roofShafts.push({ mat: shafts[shafts.length - 1], x: from.x });
    }
    for (let i = 0; i < 8; i++) {
      const h = HOLES[Math.floor(rnd() * HOLES.length)];
      const from = V(WX - 0.5, h.y, h.z);
      if (from.y > ROOF - 10 || from.y < -20) continue;
      shaft(from, V(-1, down.y * 0.8, down.z).normalize(), 40 + 25 * rnd(), 0.7, 3 + 2 * rnd(), 0x8fa4b8, 0.04 + 0.04 * rnd());
    }
  }

  // ---------- dust in the light over the pod

  const DUST = 450;
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
    new THREE.PointsMaterial({ size: 0.022, map: new THREE.CanvasTexture(dot), color: 0x8a939c, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }), // discreet
  );
  scene.add(motes);

  // lamps far off: specks of light on the far frame, as if on panels and switchboards out there. Not lights at
  // all: two sets of points, one draw each, the reds breathing slowly. They are what gives the dark its depth
  const lampsFar: THREE.Points[] = [];
  {
    const rnd = (() => { let a = 91; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const steady: number[] = [], steadyC: number[] = [], red: number[] = [], redC: number[] = [];
    const c = new THREE.Color();
    for (const n of nodes) {
      if (rnd() > 0.2) continue;
      const d = Math.hypot(n.x, n.y, n.z);
      const dim = (2.4 * (0.3 + 0.7 * rnd())) / (1 + (d / 60) ** 2); // (the haze, by hand: they are not fogged)
      const pick = rnd();
      if (pick < 0.1) { red.push(n.x, n.y, n.z); c.set(0xff2a14).multiplyScalar(dim * 1.3); redC.push(c.r, c.g, c.b); continue; }
      c.set(pick < 0.72 ? 0xffb060 : 0xcfe0ff).multiplyScalar(dim);
      steady.push(n.x, n.y, n.z); steadyC.push(c.r, c.g, c.b);
    }
    const map = new THREE.CanvasTexture(dot);
    for (const [at, col] of [[steady, steadyC], [red, redC]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.8, map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      pts.frustumCulled = false;
      scene.add(pts);
      lampsFar.push(pts);
    }
    if (import.meta.env.DEV) console.info(`hall lamps far: ${steady.length / 3} steady, ${red.length / 3} red`);
  }

  // ---------- and many more of them, small: panels, controllers, call buttons. Still not lights: points, one draw
  // for the hall's and one for each hoist's cage, a shader that blinks them. On the steel that is there: the far
  // frame's joints (a single lamp blinking, or a panel: a little grid of them, some steady, some blinking, one or
  // two flickering as a thing that is working does), every landing up the hoists' masts (a call button, green, and
  // a lamp over it), and the cages (a row of buttons, a lamp that blinks while it runs)
  const blink = { time: { value: 0 }, scale: { value: 1 } };
  const panelMaterial = () => new THREE.ShaderMaterial({
    uniforms: blink,
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute vec4 beat; // rate (Hz), phase, how much of a beat it is on, 1 if it flickers
      uniform float time, scale; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float on = step(fract(time * beat.x + beat.y), beat.z);
        if (beat.w > 0.5) on *= step(0.35, fract(sin(floor(time * 9.0 + beat.y * 40.0) * 12.9898) * 43758.5453));
        // (a point is never under two pixels: smaller than that it is dimmer instead; and the haze, by hand)
        float px = 0.09 * scale * projectionMatrix[1][1] / d; // 9 cm across, in pixels
        gl_PointSize = max(px, 2.0);
        vC = 1.7 * color * on * min(1.0, px * px / 4.0 + 0.3) / (1.0 + (d / 70.0) * (d / 70.0));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vC * smoothstep(1.0, 0.2, r), 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  {
    const rnd = (() => { let a = 4711; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const COLOURS = [0xffb060, 0xffb060, 0x7dffa0, 0xff3a22, 0xcfe0ff, 0xffd98a];
    const c = new THREE.Color();
    const make = (fill: (put: (x: number, y: number, z: number, hex: number, gain: number, rate: number, on: number, flicker?: boolean) => void) => void) => {
      const at: number[] = [], col: number[] = [], beat: number[] = [];
      fill((x, y, z, hex, gain, rate, on, flicker = false) => {
        at.push(x, y, z); c.set(hex).multiplyScalar(gain); col.push(c.r, c.g, c.b); beat.push(rate, rnd(), on, flicker ? 1 : 0);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('beat', new THREE.Float32BufferAttribute(beat, 4));
      const pts = new THREE.Points(g, panelMaterial());
      pts.frustumCulled = false;
      return pts;
    };
    const any = () => COLOURS[Math.floor(rnd() * COLOURS.length)];
    const fixed = make((put) => {
      for (const n of nodes) {
        const pick = rnd();
        if (pick < 0.22) put(n.x, n.y, n.z, any(), 1.6, 0.4 + 1.2 * rnd(), 0.5); // one lamp, blinking
        else if (pick < 0.36) {
          // a panel: two or three rows of lamps, 12 cm apart, on the side of the joint
          const along = rnd() < 0.5, rows = 2 + Math.floor(rnd() * 2), cols = 3 + Math.floor(rnd() * 3);
          for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            if (rnd() < 0.25) continue;
            const u = (j - (cols - 1) / 2) * 0.12, k = rnd();
            put(n.x + (along ? u : 0.3), n.y + 0.9 + i * 0.12, n.z + (along ? 0.3 : u), any(), 1.2, 0.3 + 2 * rnd(), k < 0.45 ? 1 : 0.5, k > 0.85);
          }
        }
      }
      for (const h of HOISTS) {
        const side = -towardTower(h);
        for (let y = h.lo; y <= h.hi; y += 6) {
          put(h.x + side * 0.45, y + 1.2, h.z + 0.45, 0x7dffa0, 1.4, 1, 1);            // the call button
          put(h.x + side * 0.45, y + 2.4, h.z + 0.45, 0xff3a22, 1.6, 0.5 + rnd() * 0.4, 0.5); // the lamp over the landing
        }
      }
      // lamps along the railings: one on the top rail every 4.5 m down both sides of the two catwalks, turn about,
      // and one on the outer corner of every hoist landing. Steady, warm, a little bigger than a panel's; now and
      // then one that is failing. (Lamps to look at, not lights: they light nothing, and cost one more point each)
      for (const x of [-TX, TX]) {
        const cx = x - Math.sign(x) * 2.2;
        for (const y of [-6, 12]) {
          for (let z = rows[0] + 2 - 1.5, k = 0; z > rows[rows.length - 1] - 2; z -= 4.5, k++) {
            const failing = rnd() < 0.08;
            put(cx + (k % 2 ? 0.6 : -0.6), y + 1.16, z, 0xffd9a8, 3.2, failing ? 2.5 : 1, 1, failing);
          }
        }
      }
      for (const h of HOISTS) {
        const side = -towardTower(h);
        for (let y = h.lo; y <= h.hi; y += 6) put(h.x + side * 2.05, y + 1.16, h.z + 2.65, 0xffd9a8, 3.0, 1, 1);
      }
    });
    const size = new THREE.Vector2();
    fixed.onBeforeRender = (r) => { blink.scale.value = r.getDrawingBufferSize(size).y / 2; };
    scene.add(fixed);
    lampsFar.push(fixed);
    for (const car of cars) {
      const pts = make((put) => {
        for (let j = 0; j < 5; j++) put(0.7, 1.05 + j * 0.09, -0.9, j === 0 ? 0xff3a22 : j % 2 ? 0x7dffa0 : 0xffb060, 1.3, 1, 1); // its buttons
        put(0, 2.45, 0, 0xffb060, 2.2, 1.4, 0.5); // and the lamp on its roof, blinking
        put(-0.7, 1.4, 0.9, 0xcfe0ff, 1.2, 3, 1, true); // something in it at work
      });
      car.add(pts);
      lampsFar.push(pts);
    }
    if (import.meta.env.DEV) console.info(`hall panel lamps: ${fixed.geometry.attributes.position.count} fixed, ${cars.length * 7} on the cages`);
  }

  const fansOut = { list: FANS, dir: FAN_DIR, radius: FAN_R, hub: HUB, blades: BLADES, wallZ: FZ, side: SIDE_FANS, sideScale: SIDE_SCALE, wallX: WX, shutter: { end: 1, side: 1 } };
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
    set shaftGain(g: number) { shaftK = g; for (const s of shafts) s.uniforms.strength.value = s.userData.strength * g; },
    air,
    roofY: ROOF,
    /** the hall's steel with its grit, or plain */
    plainSteel(on: boolean) { for (const m of steelBlocks) m.material = on ? plainSteel : steel; },
    /** the scaffolding (every bar of steel; the roof and the wall stay) there or not, shadows and all: for debugging */
    /** the fine steel: only while the eye is on the hall itself */
    detail(on: boolean) { if (fineBlocks[0]?.visible !== on) for (const m of fineBlocks) m.visible = on; },
    scaffolding(on: boolean) { for (const m of bareBars) m.visible = on; for (const l of lampsFar) l.visible = on; sunDirty = true; },
    /** materials not in the scene yet, which still have to take the scene's shared uniforms */
    spare: [plainSteel],
    /** what runs along the girder with the pod: move it along x */
    trolley,
    spans,
    /** the hoists' cages, each to be taken in hand */
    /** how fast the roof's shutter is rolling, 0 still, 1 at full speed (the sound hears it) */
    get rolling() { return Math.abs(shutV) / 0.06; },
    /** where the hoists' cages are, in the world */
    cages: cars.map((c) => c.position),
    lifts: cars.map((c) => {
      const h = c.userData.hoist as (typeof HOISTS)[number];
      return {
        lo: h.lo, hi: h.hi,
        at: () => c.position.y,
        speed: () => (c.userData.hand?.v as number | undefined) ?? 0,
        link: () => { c.userData.hand ??= { push: 0, v: 0 }; },
        push: (d: number) => { if (c.userData.hand) c.userData.hand.push = d; },
      };
    }),
    /** the fans in the end wall, for the light through them (rays.ts): where, how far round, which way it comes */
    fans: fansOut,
    /** a wall's fans' leaf shutters: open or shut */
    fanShutter(side: boolean, open: boolean) { (side ? iris.side : iris.end).to = open ? 1 : 0; },
    /** the tight sun on the pod, wherever it has swung to; as the wide one is set (the debug panel too) */
    follow(at: THREE.Vector3) {
      podSun.color.copy(sun.color);
      podSun.intensity = sun.intensity;
      const toward = sun.position.clone().sub(sun.target.position).normalize();
      podSun.target.position.copy(at);
      podSun.position.copy(at).addScaledVector(toward, 120);
    },
    /** the shutter: open (rolled up) or shut */
    roofOpen(open: boolean) { shutTo = open ? OPEN_AT : SHUT_AT; },
    /** the same, at once (no rolling: the debug page starts with it open) */
    roofSet(open: boolean) { shut = shutTo = open ? OPEN_AT : SHUT_AT; shutV = 0; lay(); },
    /** how much of the roof is open, 0..1 */
    get open() { return dayIn(); },
    /** the hoists' own rounds: still until set going (a cue of the opening, later) */
    liftsRun(on: boolean) { liftsOn = on; },
    update(time: number, dt: number) {
      blink.time.value = time;
      if (liftsOn) liftTime += dt;
      // the red lamps far off breathe, slowly
      (lampsFar[1].material as THREE.PointsMaterial).opacity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 1.3)) ** 2;
      // the shutter: heavy, slow to start and to stop, a few metres a second at most
      if (shut !== shutTo || shutV) {
        const d = shutTo - shut, a = 0.012, vmax = 0.06;
        const want = Math.sign(d) * Math.min(vmax, Math.sqrt(2 * a * Math.abs(d)));
        shutV += THREE.MathUtils.clamp(want - shutV, -a * dt, a * dt);
        shut = THREE.MathUtils.clamp(shut + shutV * dt, 0, 1);
        if (Math.abs(d) < 1e-4 && Math.abs(shutV) < 1e-3) { shut = shutTo; shutV = 0; }
        lay();
        // The sun's map has the shutter's slats in it, whatever is switched off while it is drawn (two ways of
        // keeping them out were tried and did not), and it is drawn once: drawn with the roof shut, as the page
        // starts, it kept the sun out of the air for good, and no shafts came from the roof once it had opened.
        // So it is drawn again as the shutter goes, twice a second, and once more where it stops
        if ((mapDue -= dt) <= 0 || shut === shutTo) { mapDue = 0.5; sunDirty = true; }
      }
      // the leaf shutters: two seconds and a bit, eased at both ends
      for (const [side, st] of [[false, iris.end], [true, iris.side]] as const) {
        if (st.s === st.to && !st.v) continue;
        const d = st.to - st.s, a = 1.6, vmax = 0.55;
        const want = Math.sign(d) * Math.min(vmax, Math.sqrt(2 * a * Math.abs(d)));
        st.v += THREE.MathUtils.clamp(want - st.v, -a * dt, a * dt);
        st.s = THREE.MathUtils.clamp(st.s + st.v * dt, 0, 1);
        if (Math.abs(d) < 1e-3 && Math.abs(st.v) < 0.02) { st.s = st.to; st.v = 0; }
        setLeaves(side, st.s);
      }
      fansOut.shutter.end = iris.end.s;
      fansOut.shutter.side = iris.side.s;
      const toward = sun.position.clone().sub(sun.target.position).normalize();
      COVER.sun.value.set(toward.x, toward.y, toward.z, SHUT_Y);
      // the skylight over the pod and its shaft come with the open roof over it
      const over = THREE.MathUtils.smoothstep(roof.position.x, X0 + shut * RUN - 1.5, X0 + shut * RUN + 1.5);
      roof.intensity = roofBase * over;
      shafts[0].uniforms.strength.value = shafts[0].userData.strength * shaftK * over;
      windowGlow.color.copy(WINDOW).multiplyScalar(0.12 + 0.88 * dayIn());
      // and the faked shafts of the windows come and go with the daylight, as the windows' lights do (main.ts)
      for (let i = 1; i < shafts.length; i++) shafts[i].uniforms.strength.value = shafts[i].userData.strength * shaftK * (0.12 + 0.88 * dayIn());
      // (the roof's own, over the glass the shutter has rolled back from, and dark where it still covers it)
      for (const r of roofShafts) r.mat.uniforms.strength.value = r.mat.userData.strength * shaftK * THREE.MathUtils.smoothstep(r.x, X0 + shut * RUN - 1.5, X0 + shut * RUN + 1.5);
      dome.material.uniforms.gain.value = (scene.fog as THREE.Fog).far;
      for (const s of shafts) s.uniforms.time.value = time;
      // (one switched off, from the hologram (game.ts), runs down slowly, and up again)
      [...FANS, ...SIDE_FANS].forEach((f, i) => {
        f.run += ((f.on ? 1 : 0) - f.run) * Math.min(1, dt * 0.35);
        f.angle += f.speed * f.run * dt;
        rotors[i].rotation.z = f.angle;
      });
      for (const c of cars) {
        const h = c.userData.hoist as (typeof HOISTS)[number];
        // in someone's hand (the hologram, game.ts): up or down as the lever is pushed, heavy, to the ends
        const hand = c.userData.hand as { push: number; v: number } | undefined;
        if (hand) {
          hand.v += (hand.push * 1.2 - 0.8 * hand.v) * dt;
          c.position.y = THREE.MathUtils.clamp(c.position.y + hand.v * dt, h.lo, h.hi);
          if (c.position.y === h.lo || c.position.y === h.hi) hand.v = 0;
          continue;
        }
        // up, wait, down, wait: a smooth ride between the ends
        const span = h.hi - h.lo, ride = span / h.speed, cycle = 2 * ride + 16;
        const t = (liftTime + h.phase * 10) % cycle;
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
