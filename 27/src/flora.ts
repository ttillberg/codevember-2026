// What grows through the roof: woody roots that cross the tunnels (tubes, still) and the fine roots that hang from
// them and from the ceiling (ribbons, on springs). The fine ones give way to the head as it comes through.
import * as THREE from 'three';
import { Perlin } from './noise';
import type { World, RailEdge } from './world';
import { rootMaterial, hairMaterial, hairDepthMaterial } from './gfx';

const UP = new THREE.Vector3(0, 1, 0);
const HEAD = 0.105; // nothing hangs closer to the lens than this

class Frame {
  c = new THREE.Vector3(); T = new THREE.Vector3(); side = new THREE.Vector3(); up = new THREE.Vector3();
  constructor(private world: World) {}
  at(e: RailEdge, s: number) {
    s = Math.max(0.04, Math.min(e.len - 0.04, s));
    this.world.railPoint(e, s, this.c);
    this.world.railTangent(e, s, this.T);
    this.side.crossVectors(this.T, UP).normalize();
    this.up.crossVectors(this.side, this.T);
    return this;
  }
  /** unit direction across the tunnel, phi from straight up */
  dir(phi: number, out: THREE.Vector3) {
    return out.copy(this.up).multiplyScalar(Math.cos(phi)).addScaledVector(this.side, Math.sin(phi));
  }
}

interface Tubes { pos: number[]; nrm: number[]; tan: number[]; uv: number[]; rad: number[]; seed: number[]; idx: number[]; pts: number[] }

function addTube(out: Tubes, path: THREE.Vector3[], radius: (t: number) => number, sides: number, seed: number) {
  const n = path.length;
  // (and where the root runs, for whatever grows round it: growth.ts)
  for (let i = 0; i < n; i += 2) out.pts.push(path[i].x, path[i].y, path[i].z, radius(i / (n - 1)));
  const base = out.pos.length / 3;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), ax = new THREE.Vector3(), v = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    T.copy(path[Math.min(i + 1, n - 1)]).sub(path[Math.max(i - 1, 0)]).normalize();
    if (i === 0) {
      N.copy(Math.abs(T.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).addScaledVector(T, -T.dot(Math.abs(T.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0))).normalize();
    } else {
      // carry the frame along without twisting it
      ax.crossVectors(prevT, T);
      const s = ax.length();
      if (s > 1e-6) N.applyAxisAngle(ax.multiplyScalar(1 / s), Math.asin(Math.min(1, s)));
      N.addScaledVector(T, -N.dot(T)).normalize();
      len += path[i].distanceTo(path[i - 1]);
    }
    prevT.copy(T);
    B.crossVectors(T, N);
    const r = radius(i / (n - 1));
    for (let k = 0; k <= sides; k++) {
      const th = (k / sides) * Math.PI * 2;
      v.copy(N).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
      out.nrm.push(v.x, v.y, v.z);
      out.pos.push(path[i].x + v.x * r, path[i].y + v.y * r, path[i].z + v.z * r);
      out.tan.push(T.x, T.y, T.z);
      out.uv.push(k / sides, len);
      out.rad.push(r);
      out.seed.push(seed);
    }
  }
  const row = sides + 1;
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < sides; k++) {
      const a = base + i * row + k, b = a + 1, c = a + row, d = c + 1;
      out.idx.push(a, b, c, b, d, c);
    }
}

interface Strand { start: number; n: number; parent: number; stiff: number; asleep: boolean; shed: number }

export class Flora {
  roots!: THREE.Mesh;
  /** x, y, z, radius along every root: what grows round them wants to know */
  rootPts: number[] = [];
  hairs!: THREE.Mesh;
  hairDepth = hairDepthMaterial();
  pixel = { value: 0.001 };
  /** a fine root was pulled: its anchor, for the dirt to come from */
  onTug: (p: THREE.Vector3) => void = () => {};

  // strand points
  private P!: Float32Array; private Q!: Float32Array; private R!: Float32Array; private seg!: Float32Array;
  private strands: Strand[] = [];
  private pts: number[] = []; private widths: number[] = []; private seeds: number[] = [];
  private posAttr!: THREE.BufferAttribute; private tanAttr!: THREE.BufferAttribute;
  private acc = 0;

  constructor(private world: World, rnd: () => number) {
    const P = new Perlin(91);
    const fr = new Frame(world);
    const tubes: Tubes = { pos: [], nrm: [], tan: [], uv: [], rad: [], seed: [], idx: [], pts: [] };
    const dir = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    const tmp = new THREE.Vector3();

    const strand = (anchor: THREE.Vector3, d0: THREE.Vector3, L: number, w: number, parent: number): number => {
      const n = Math.max(3, Math.min(16, Math.round(L / 0.016) + 1));
      const seg = L / (n - 1);
      const start = this.pts.length / 3;
      const d = d0.clone().normalize();
      const p = anchor.clone();
      const seed = rnd();
      const curl = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.4, rnd() - 0.5).multiplyScalar(0.5);
      for (let i = 0; i < n; i++) {
        this.pts.push(p.x, p.y, p.z);
        this.widths.push(w * (1 - 0.65 * (i / (n - 1))));
        this.seeds.push(seed);
        curl.x += (rnd() - 0.5) * 0.35; curl.z += (rnd() - 0.5) * 0.35;
        d.x += curl.x * 0.5 + (rnd() - 0.5) * 0.16; d.z += curl.z * 0.5 + (rnd() - 0.5) * 0.16; d.y += curl.y * 0.3 - 0.14;
        d.normalize();
        p.addScaledVector(d, seg);
      }
      this.strands.push({ start, n, parent, stiff: Math.min(0.2, 0.035 + w * 28 + 0.004 / L), asleep: true, shed: rnd() * 3 });
      return start;
    };
    /** a fine root with a few finer ones off it */
    const rootlet = (anchor: THREE.Vector3, d0: THREE.Vector3, L: number, w: number) => {
      const s0 = strand(anchor, d0, L, w, -1);
      const n = this.strands[this.strands.length - 1].n;
      for (let i = 1; i < n - 1; i++) {
        for (let k = 0; k < 2; k++) {
          if (rnd() > 0.5) continue;
          tmp.set(this.pts[(s0 + i) * 3], this.pts[(s0 + i) * 3 + 1], this.pts[(s0 + i) * 3 + 2]);
          dir.set(rnd() - 0.5, -0.25 - rnd() * 0.5, rnd() - 0.5);
          strand(tmp, dir, 0.015 + rnd() * 0.06 * Math.min(1, L / 0.12 + 0.3), w * 0.5, s0 + i);
        }
      }
    };

    const hang = (path: THREE.Vector3[], r: (t: number) => number, every: number) => {
      let acc = rnd() * every;
      for (let i = 1; i < path.length - 1; i++) {
        acc += path[i].distanceTo(path[i - 1]);
        if (acc < every) continue;
        acc = rnd() * every * 0.5;
        const rr = r(i / (path.length - 1));
        const a = path[i].clone();
        a.y -= rr * 0.8;
        if (world.sample(a.x, a.y - 0.04, a.z) > -0.02) continue;
        const room = world.march(a, down, 0.7);
        const L = Math.min(0.04 + rnd() * rnd() * 0.34, room - 0.03);
        if (L < 0.03) continue;
        dir.set((rnd() - 0.5) * 0.5, -1, (rnd() - 0.5) * 0.5);
        rootlet(a, dir, L, 0.0004 + rnd() * 0.0009);
      }
    };

    /** a root stays in the ground: by the mouth, where a march finds no wall, it would otherwise arc out over the grass */
    const bury = (p: THREE.Vector3, r: number) => {
      const top = world.terrainH(p.x, p.z) - r - 0.06;
      if (p.y > top) p.y = top;
      return p;
    };
    const woody = (e: RailEdge, s: number, thick: number) => {
      const sgn = rnd() < 0.5 ? -1 : 1;
      const phi0 = sgn * (1.0 + rnd() * 0.8), phi1 = -sgn * (0.25 + rnd() * 1.3);
      const span = (0.3 + rnd() * 0.9) * (rnd() < 0.5 ? -1 : 1);
      const sag = -0.012 + rnd() * rnd() * 0.13;
      const rr = thick;
      const K = 8;
      const ctrl: THREE.Vector3[] = [];
      const ph = rnd() * 40;
      const along = (t: number) => s + (t - 0.5) * span;
      for (let k = 0; k <= K; k++) {
        const t = k / K;
        const phi = phi0 + (phi1 - phi0) * t + 0.35 * P.n(t * 3.1, ph, 0.5);
        fr.at(e, along(t)).dir(phi, dir);
        const tw = world.march(fr.c, dir, 1.0);
        let rho = tw - rr * 0.35 - Math.sin(Math.PI * t) * sag;
        if (k === 0 || k === K) rho = tw + 0.09;
        else rho = Math.max(rho, 0.16 + rr);
        ctrl.push(bury(fr.c.clone().addScaledVector(dir, rho), rr));
      }
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      const path = curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / 0.02)));
      const rad = (t: number) => rr * (1 - 0.32 * t) * (1 + 0.14 * P.n(t * 9, ph, 3.3));
      addTube(tubes, path, rad, rr > 0.02 ? 12 : 8, rnd() * 10);
      hang(path, rad, 0.022 + rnd() * 0.03);
      // branches that creep off along the wall
      const nb = rnd() < 0.7 ? 1 + Math.floor(rnd() * 2) : 0;
      for (let b = 0; b < nb; b++) {
        const t0 = 0.2 + rnd() * 0.6;
        const start = path[Math.floor(t0 * (path.length - 1))];
        const bs = rnd() < 0.5 ? -1 : 1, as = (rnd() < 0.5 ? -1 : 1) * (0.07 + rnd() * 0.1);
        const phiB = phi0 + (phi1 - phi0) * t0;
        const rb = rr * (0.35 + rnd() * 0.25);
        const bc = [start.clone()];
        const KB = 4 + Math.floor(rnd() * 3);
        for (let k = 1; k <= KB; k++) {
          fr.at(e, along(t0) + as * k).dir(phiB + bs * k * (0.16 + rnd() * 0.12), dir);
          const tw = world.march(fr.c, dir, 1.0);
          const rho = k === KB ? tw + 0.06 : Math.max(tw - rb * 0.3 - (rnd() < 0.3 ? 0.03 : 0), 0.15 + rb);
          bc.push(bury(fr.c.clone().addScaledVector(dir, rho), rb));
        }
        const bcurve = new THREE.CatmullRomCurve3(bc, false, 'centripetal');
        const bpath = bcurve.getSpacedPoints(Math.max(6, Math.ceil(bcurve.getLength() / 0.02)));
        const brad = (t: number) => rb * (1 - 0.5 * t);
        addTube(tubes, bpath, brad, 7, rnd() * 10);
        hang(bpath, brad, 0.03 + rnd() * 0.04);
      }
    };

    /** hairs straight out of the roof and the upper walls */
    const ceilingHairs = (e: RailEdge, s: number, count: number, spread: number) => {
      for (let i = 0; i < count; i++) {
        const phi = (rnd() * 2 - 1) * 1.25;
        fr.at(e, s + (rnd() - 0.5) * spread).dir(phi, dir);
        const tw = world.march(fr.c, dir, 1.0);
        if (tw >= 1.0) continue;
        const a = fr.c.clone().addScaledVector(dir, tw + 0.012);
        const d0 = dir.clone().multiplyScalar(-0.6).add(new THREE.Vector3((rnd() - 0.5) * 0.6, -0.7, (rnd() - 0.5) * 0.6));
        const L = Math.min(0.03 + rnd() * rnd() * 0.24, tw + 0.2);
        rootlet(a, d0, L, 0.0004 + rnd() * 0.0008);
      }
    };

    for (const e of world.edges) {
      if (e.open) {
        // the lip of the hole: what the turf lets hang
        ceilingHairs(e, e.len - 0.12, 40, 0.3);
        continue;
      }
      let s = 0.25 + rnd() * 0.5;
      while (s < e.len - 0.25) {
        // roots come in thickets with bare stretches between; fewer, the deeper it goes
        const depth = Math.min(1, Math.max(0, -fr.at(e, s).c.y / 1.6));
        const rich = 0.5 + 0.5 * P.n(fr.c.x * 0.9, fr.c.y * 0.9 + 7.7, fr.c.z * 0.9) * 2.2 - depth * 0.25;
        if (rich > 0.15) {
          const count = 1 + Math.floor(rnd() * 2.4 * Math.min(1, rich + 0.35));
          for (let i = 0; i < count; i++) woody(e, s + (rnd() - 0.5) * 0.3, i === 0 && rnd() < 0.5 ? 0.024 + rnd() * 0.026 : 0.008 + rnd() * 0.016);
          ceilingHairs(e, s, Math.round(16 + rnd() * 26), 0.9);
        } else if (rich > -0.2) ceilingHairs(e, s, Math.round(8 + rnd() * 12), 0.9);
        s += 0.55 + rnd() * 0.7;
      }
    }

    // ---- woody roots mesh ----
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(tubes.pos);
    const ao = new Float32Array(pos.length / 3);
    for (let i = 0; i < ao.length; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = tubes.nrm[i * 3], ny = tubes.nrm[i * 3 + 1], nz = tubes.nrm[i * 3 + 2];
      // how much open air is there just off the bark
      const a = -world.sample(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03), b = -world.sample(x + nx * 0.08, y + ny * 0.08, z + nz * 0.08);
      ao[i] = Math.max(0.05, Math.min(1, 0.5 * Math.min(1, Math.max(0, a / 0.03)) + 0.5 * Math.min(1, Math.max(0, b / 0.08))));
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tubes.nrm), 3));
    g.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(tubes.tan), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tubes.uv), 2));
    g.setAttribute('aRad', new THREE.BufferAttribute(new Float32Array(tubes.rad), 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(tubes.seed), 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(tubes.idx), 1));
    this.rootPts = tubes.pts;
    this.roots = new THREE.Mesh(g, rootMaterial());
    this.roots.frustumCulled = false;

    // ---- fine roots ----
    const np = this.pts.length / 3;
    this.P = new Float32Array(this.pts);
    this.Q = new Float32Array(this.pts);
    this.R = new Float32Array(this.pts);
    this.seg = new Float32Array(np);
    const hp = new Float32Array(np * 6), ht = new Float32Array(np * 6), hs = new Float32Array(np * 2), hw = new Float32Array(np * 2), hseed = new Float32Array(np * 2);
    const hidx: number[] = [];
    // (how far along its strand each point is from where the strand comes out of the roof, metres: there it is in
    // the roof's own shadow. A strand that grows off another one has no such place)
    const hroot = new Float32Array(np * 2);
    for (const st of this.strands) {
      let along = 0;
      for (let i = 0; i < st.n; i++) {
        const p = st.start + i;
        if (i > 0) this.seg[p] = Math.hypot(this.R[p * 3] - this.R[p * 3 - 3], this.R[p * 3 + 1] - this.R[p * 3 - 2], this.R[p * 3 + 2] - this.R[p * 3 - 1]);
        along += this.seg[p];
        hroot[p * 2] = hroot[p * 2 + 1] = st.parent < 0 ? along : 1;
        hs[p * 2] = -1; hs[p * 2 + 1] = 1;
        hw[p * 2] = hw[p * 2 + 1] = this.widths[p];
        hseed[p * 2] = hseed[p * 2 + 1] = this.seeds[p];
        if (i < st.n - 1) hidx.push(p * 2, p * 2 + 1, p * 2 + 2, p * 2 + 1, p * 2 + 3, p * 2 + 2);
      }
    }
    const hg = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(hp, 3).setUsage(THREE.DynamicDrawUsage);
    this.tanAttr = new THREE.BufferAttribute(ht, 3).setUsage(THREE.DynamicDrawUsage);
    hg.setAttribute('position', this.posAttr);
    hg.setAttribute('aTan', this.tanAttr);
    hg.setAttribute('aSide', new THREE.BufferAttribute(hs, 1));
    hg.setAttribute('aW', new THREE.BufferAttribute(hw, 1));
    hg.setAttribute('aSeed', new THREE.BufferAttribute(hseed, 1));
    hg.setAttribute('aRootD', new THREE.BufferAttribute(hroot, 1));
    hg.setIndex(new THREE.BufferAttribute(new Uint32Array(hidx), 1));
    this.hairs = new THREE.Mesh(hg, hairMaterial(this.pixel));
    this.hairs.frustumCulled = false;
    for (const st of this.strands) this.write(st);
    this.posAttr.needsUpdate = this.tanAttr.needsUpdate = true;
    console.log(`flora: ${tubes.idx.length / 3} root triangles, ${this.strands.length} fine roots, ${np} points`);
  }

  private write(st: Strand) {
    const P = this.P, hp = this.posAttr.array as Float32Array, ht = this.tanAttr.array as Float32Array;
    for (let i = 0; i < st.n; i++) {
      const p = st.start + i, a = Math.max(st.start, p - 1), b = Math.min(st.start + st.n - 1, p + 1);
      let tx = P[b * 3] - P[a * 3], ty = P[b * 3 + 1] - P[a * 3 + 1], tz = P[b * 3 + 2] - P[a * 3 + 2];
      const l = 1 / (Math.hypot(tx, ty, tz) + 1e-9);
      tx *= l; ty *= l; tz *= l;
      for (let k = 0; k < 2; k++) {
        const o = (p * 2 + k) * 3;
        hp[o] = P[p * 3]; hp[o + 1] = P[p * 3 + 1]; hp[o + 2] = P[p * 3 + 2];
        ht[o] = tx; ht[o + 1] = ty; ht[o + 2] = tz;
      }
    }
  }

  update(dt: number, eye: THREE.Vector3, move: THREE.Vector3, speed: number) {
    const H = 1 / 60;
    this.acc = Math.min(this.acc + dt, H * 3);
    const steps = Math.floor(this.acc / H);
    if (!steps) return;
    this.acc -= steps * H;
    const { P, Q, R, seg } = this;
    const ex = eye.x, ey = eye.y, ez = eye.z;
    let lo = Infinity, hi = -1;
    const tug = new THREE.Vector3();
    for (const st of this.strands) {
      const a = st.start * 3;
      const near = (R[a] - ex) ** 2 + (R[a + 1] - ey) ** 2 + (R[a + 2] - ez) ** 2 < 1.1 * 1.1;
      if (!near && st.asleep) continue;
      let energy = 0, touched = false;
      for (let it = 0; it < steps; it++) {
        // the anchor: fixed in the ground, or riding on the root it grows from
        let ox = 0, oy = 0, oz = 0;
        if (st.parent >= 0) {
          const pp = st.parent * 3;
          P[a] = P[pp]; P[a + 1] = P[pp + 1]; P[a + 2] = P[pp + 2];
          ox = P[a] - R[a]; oy = P[a + 1] - R[a + 1]; oz = P[a + 2] - R[a + 2];
        }
        for (let i = 1; i < st.n; i++) {
          const p = (st.start + i) * 3;
          const k = st.stiff * (1 - 0.55 * (i / st.n));
          let x = P[p], y = P[p + 1], z = P[p + 2];
          const vx = (x - Q[p]) * 0.93, vy = (y - Q[p + 1]) * 0.93, vz = (z - Q[p + 2]) * 0.93;
          Q[p] = x; Q[p + 1] = y; Q[p + 2] = z;
          x += vx + (R[p] + ox - x) * k; y += vy + (R[p + 1] + oy - y) * k; z += vz + (R[p + 2] + oz - z) * k;
          // the head: a soft bow wave ahead of it, and a hard ball nothing gets inside
          const dx = x - ex, dy = y - ey, dz = z - ez;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
          if (d < 0.24) {
            const push = ((0.24 - d) / 0.24) * speed * 0.0035;
            x += (dx / d) * push + move.x * push * 0.8; y += (dy / d) * push * 0.4; z += (dz / d) * push + move.z * push * 0.8;
            if (d < HEAD) { const f = HEAD / d; x = ex + dx * f; y = ey + dy * f; z = ez + dz * f; touched = true; }
          }
          P[p] = x; P[p + 1] = y; P[p + 2] = z;
          energy += vx * vx + vy * vy + vz * vz;
        }
        // keep its length
        for (let i = 1; i < st.n; i++) {
          const p = (st.start + i) * 3, q = p - 3;
          const dx = P[p] - P[q], dy = P[p + 1] - P[q + 1], dz = P[p + 2] - P[q + 2];
          const f = seg[st.start + i] / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9);
          P[p] = P[q] + dx * f; P[p + 1] = P[q + 1] + dy * f; P[p + 2] = P[q + 2] + dz * f;
        }
      }
      st.shed -= dt;
      if (touched && st.shed <= 0 && st.parent < 0) { st.shed = 2.5 + Math.random() * 4; this.onTug(tug.set(R[a], R[a + 1], R[a + 2])); }
      st.asleep = !near && energy < 1e-9;
      this.write(st);
      lo = Math.min(lo, st.start); hi = Math.max(hi, st.start + st.n);
    }
    if (hi > 0) {
      for (const a of [this.posAttr, this.tanAttr]) {
        a.clearUpdateRanges();
        a.addUpdateRange(lo * 6, (hi - lo) * 6);
        a.needsUpdate = true;
      }
    }
  }
}
