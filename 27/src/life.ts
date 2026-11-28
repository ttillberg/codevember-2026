// The small life of the place, all of it easy to miss: old silk in the corners, most of it broken; a few spiders no
// bigger than a grain of rice on it and on the walls; a beetle here and there going about its business; worms half
// out of the wet ground. None of it is drawn from more than a few metres off, and there is not much of it.
import * as THREE from 'three';
import type { World } from './world';
import { webMaterial, bugMaterial, wormMaterial } from './gfx';

interface Bug { p: THREE.Vector3; n: THREE.Vector3; h: THREE.Vector3; size: number; wait: number; walk: number; step: number; speed: number; shy: boolean; i: number }

/** a mesh out of pieces: balls for the body, three-sided sticks for the legs. aLimb: the leg's turn, and how far out along it */
function bugGeometry(spider: boolean): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], limb: number[] = [], idx: number[] = [];
  const ball = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) => {
    const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const p = g.getAttribute('position'), base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      pos.push(cx + x * rx, cy + y * ry, cz + z * rz);
      const n = new THREE.Vector3(x / rx, y / ry, z / rz).normalize();
      nrm.push(n.x, n.y, n.z);
      limb.push(0, 0);
      idx.push(base + i);
    }
  };
  /** a leg as a bent line of points, each stretch a thin prism */
  const leg = (pts: number[][], turn: number, r: number) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = new THREE.Vector3(...(pts[k] as [number, number, number])), b = new THREE.Vector3(...(pts[k + 1] as [number, number, number]));
      const d = b.clone().sub(a).normalize();
      const u = new THREE.Vector3(0, 1, 0).cross(d).normalize(), v = d.clone().cross(u);
      const base = pos.length / 3;
      for (const [q, w] of [[a, k / (pts.length - 1)], [b, (k + 1) / (pts.length - 1)]] as [THREE.Vector3, number][]) {
        for (let j = 0; j < 3; j++) {
          const ang = (j / 3) * Math.PI * 2;
          const o = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
          const rr = r * (1 - 0.6 * w);
          pos.push(q.x + o.x * rr, q.y + o.y * rr, q.z + o.z * rr);
          nrm.push(o.x, o.y, o.z);
          limb.push(turn, w);
        }
      }
      for (let j = 0; j < 3; j++) { const j2 = (j + 1) % 3; idx.push(base + j, base + 3 + j, base + j2, base + j2, base + 3 + j, base + 3 + j2); }
    }
  };
  if (spider) {
    // (in units of its own body: about a millimetre and a half)
    ball(0, 0.75, -0.95, 0.85, 0.7, 1.1);
    ball(0, 0.62, 0.45, 0.6, 0.42, 0.7);
    [[0.9, 1.9], [0.25, 2.3], [-0.45, 2.3], [-1.2, 2.0]].forEach(([fwd, out], k) => {
      for (const sx of [-1, 1]) leg([[sx * 0.4, 0.6, 0.45 + fwd * 0.25], [sx * out * 0.5, 1.5, 0.45 + fwd * 0.9], [sx * out, 0.0, 0.45 + fwd * 1.5]], k + (sx > 0 ? 1 : 0), 0.085);
    });
  } else {
    ball(0, 0.55, -0.35, 0.82, 0.55, 1.3);
    ball(0, 0.5, 0.95, 0.68, 0.42, 0.5);
    ball(0, 0.42, 1.5, 0.36, 0.26, 0.3);
    [[0.9, 1.3], [0.1, 1.5], [-0.8, 1.45]].forEach(([z, out], k) => {
      for (const sx of [-1, 1]) leg([[sx * 0.6, 0.4, z], [sx * out * 0.75, 0.55, z + 0.15 * (1 - k)], [sx * out, 0.0, z + 0.3 * (1 - k)]], k + (sx > 0 ? 1 : 0), 0.07);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(limb), 2));
  g.setIndex(idx);
  return g;
}

export class Life {
  group = new THREE.Group();
  /** where the webs hang (their hubs) */
  webSpots: THREE.Vector3[] = [];
  private bugs: { mesh: THREE.InstancedMesh; step: THREE.InstancedBufferAttribute; list: Bug[] }[] = [];
  private m = new THREE.Matrix4();
  private x = new THREE.Vector3();
  private q = new THREE.Vector3();
  private back = new THREE.Vector3();
  private nn = new THREE.Vector3();

  constructor(private world: World, rnd: () => number) {
    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
    const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3(), d = new THREE.Vector3();
    /** where a look from the rail at an angle round the tunnel meets the wall, or null */
    const wall = (e: World['edges'][number], s: number, phi: number, reach = 0.9): THREE.Vector3 | null => {
      world.railPoint(e, s, c);
      world.railTangent(e, s, T);
      side.crossVectors(T, up).normalize();
      up2.crossVectors(side, T);
      d.copy(up2).multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
      const t = world.march(c, d, reach);
      return t >= reach ? null : c.clone().addScaledVector(d, t - 0.004);
    };

    // ---- silk ----
    const wp: number[] = [], ws: number[] = [];
    let threads = 0;
    /** a thread from a to b that sags; `whole` false: it has parted, and the end of it hangs */
    const thread = (a: THREE.Vector3, b: THREE.Vector3, sag: number, whole: boolean, n = 8) => {
      const seed = rnd(), to = whole ? 1 : 0.35 + 0.4 * rnd();
      let px = a.x, py = a.y, pz = a.z;
      for (let i = 1; i <= n; i++) {
        const t = (i / n) * to, w = Math.sin(Math.PI * t);
        let x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t - sag * w, z = a.z + (b.z - a.z) * t;
        // (the broken end goes down, not across)
        if (!whole) { const k = (i / n) ** 2, drop = Math.min(0.07, 2.5 * a.distanceTo(b)); x = a.x + (x - a.x) * (1 - 0.5 * k); z = a.z + (z - a.z) * (1 - 0.5 * k); y -= drop * k * (0.5 + rnd() * 0.2); }
        if (world.sample(x, y, z) > -0.002) break;
        const s0 = whole ? Math.sin(Math.PI * ((i - 1) / n)) : ((i - 1) / n), s1 = whole ? w : i / n;
        wp.push(px, py, pz, x, y, z);
        ws.push(s0, seed, s1, seed);
        px = x; py = y; pz = z;
      }
      threads++;
    };
    const spiderSpots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    /** where there is a web already: one to a place is enough */
    const webAt: THREE.Vector3[] = [];
    for (const e of world.edges) {
      if (e.open) continue;
      for (let i = Math.round(e.len * 1.7); i > 0; i--) {
        const s = 0.2 + rnd() * Math.max(0.1, e.len - 0.4);
        // a corner up under the roof, to one side
        const sg = rnd() < 0.5 ? -1 : 1, phi0 = sg * (0.35 + rnd() * 0.9), phi1 = phi0 + sg * (0.45 + rnd() * 0.6);
        const a = wall(e, s, phi0), b = wall(e, s + (rnd() - 0.5) * 0.3, phi1);
        if (!a || !b) continue;
        const span = a.distanceTo(b);
        if (span < 0.1 || span > 0.55) continue;
        if (!webAt.some((w) => w.distanceTo(a) < 2.8)) {
          // What is left of a web, and still a web: a hub hung in the corner, spokes out from it, and round them the
          // turns of the spiral, a finger's width apart. One to a place. Every spoke goes all the way to a wall,
          // across the tunnel if that is where the wall is, or it is not there at all: nothing ends in the air.
          // And it is torn where things go through: the part of it that hung in the way.
          const hub = a.clone().lerp(b, 0.35 + 0.3 * rnd());
          const rail = world.railPoint(e, s, new THREE.Vector3());
          hub.lerp(rail, 0.2 + 0.1 * rnd());
          if (world.sample(hub.x, hub.y, hub.z) > -0.04) continue;
          // its plane: across the tunnel, turned a little
          world.railTangent(e, s, T);
          const u = a.clone().sub(hub).normalize();
          const w = new THREE.Vector3().crossVectors(u, T).normalize();
          const turn = (rnd() - 0.5) * 0.5;
          const v = w.clone().multiplyScalar(Math.cos(turn)).addScaledVector(T, Math.sin(turn)).normalize();
          const count = 13 + Math.floor(rnd() * 6), a0 = rnd() * 6.283;
          // each spoke: which way, how far to the wall, and whether our way through the tunnel crosses it
          const sp: { d: THREE.Vector3; len: number; cut: boolean; ang: number }[] = [];
          const toRail = rail.clone().sub(hub);
          for (let k = 0; k < count; k++) {
            const ang = a0 + ((k + (rnd() - 0.5) * 0.3) / count) * Math.PI * 2;
            const dk = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang)).normalize();
            const t = world.march(hub, dk, 1.2);
            if (t >= 1.2 || t < 0.05) continue;
            // (how near the line of it comes to where the eye goes)
            const along = Math.max(0, Math.min(t, toRail.dot(dk)));
            const miss = toRail.clone().addScaledVector(dk, -along).length();
            sp.push({ d: dk, len: t - 0.003, cut: miss < 0.17, ang });
          }
          if (sp.length < 7) continue;
          const whole = sp.filter((q) => !q.cut);
          if (whole.length < 5) continue;
          webAt.push(a.clone());
          this.webSpots.push(hub.clone());
          const R = Math.max(0.06, Math.min(0.17, 0.85 * Math.min(...whole.map((q) => q.len))));
          const at = (q: { d: THREE.Vector3 }, r: number) => hub.clone().addScaledVector(q.d, r);
          for (const q of sp) {
            // (the ones in the way are gone altogether: no stubs left hanging)
            if (!q.cut) thread(at(q, 0), at(q, q.len), q.len * 0.012, true, q.len > 0.3 ? 12 : 6);
          }
          // the spiral, turn after turn, between spokes that are both there and not too far apart
          const gap = (Math.PI * 2) / count;
          for (let r = 0.012 + 0.006 * rnd(); r < R; r += 0.0065 + 0.0035 * rnd()) {
            for (let k = 0; k < sp.length; k++) {
              const p = sp[k], q = sp[(k + 1) % sp.length];
              let da = q.ang - p.ang;
              if (da < 0) da += Math.PI * 2;
              if (da > gap * 1.8) continue;
              // (a turn hangs between two spokes that are there, or it is not there either)
              if (p.cut || q.cut || rnd() < 0.05) continue;
              thread(at(p, r * (1 + (rnd() - 0.5) * 0.06)), at(q, r * (1 + (rnd() - 0.5) * 0.06)), 0.0006, true, 2);
            }
          }
          if (rnd() < 0.6) { const q = whole[0], end = at(q, q.len); world.normalAt(end.x, end.y, end.z, d); spiderSpots.push({ p: end, n: d.clone() }); }
        } else {
          // or only a line or two across a corner, and not where there is a web already
          if (span > 0.3 || rnd() < 0.6 || webAt.some((w) => w.distanceTo(a) < 1.6)) continue;
          for (let k = 1 + Math.floor(rnd() * 2); k > 0; k--) {
            const a2 = wall(e, s + (rnd() - 0.5) * 0.08, phi0 + (rnd() - 0.5) * 0.2), b2 = wall(e, s + (rnd() - 0.5) * 0.2, phi1 + (rnd() - 0.5) * 0.25);
            if (a2 && b2 && a2.distanceTo(b2) < 0.3) thread(a2, b2, a2.distanceTo(b2) * (0.08 + 0.14 * rnd()), rnd() < 0.6);
          }
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wp), 3));
    wg.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(ws), 2));
    const webs = new THREE.LineSegments(wg, webMaterial());
    webs.frustumCulled = false;
    this.group.add(webs);

    // ---- spiders and beetles ----
    const crowd = (spider: boolean, spots: { p: THREE.Vector3; n: THREE.Vector3 }[]) => {
      const geo = bugGeometry(spider);
      const mesh = new THREE.InstancedMesh(geo, bugMaterial(spider ? 0 : 1), spots.length);
      const step = new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1);
      const seed = new THREE.InstancedBufferAttribute(new Float32Array(spots.length), 1);
      step.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aStep', step);
      geo.setAttribute('aSeed', seed);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      const list: Bug[] = spots.map((sp, i) => {
        seed.setX(i, rnd());
        const h = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
        h.addScaledVector(sp.n, -h.dot(sp.n)).normalize();
        // a spider is a millimetre or two of body, hardly there; a beetle a little more
        return { p: sp.p.clone(), n: sp.n.clone(), h, size: spider ? 0.001 + rnd() * 0.0009 : 0.0013 + rnd() * 0.0012, wait: rnd() * 10, walk: 0, step: 0, speed: spider ? 0.05 : 0.014, shy: spider, i };
      });
      const set = { mesh, step, list };
      list.forEach((b) => this.put(set, b));
      this.bugs.push(set);
      this.group.add(mesh);
    };
    // spiders: by what is left of their webs, and one or two out on a wall
    for (const e of world.edges) {
      if (e.open || rnd() > 0.5) continue;
      const p = wall(e, rnd() * e.len, (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.3));
      if (p) { world.normalAt(p.x, p.y, p.z, d); spiderSpots.push({ p, n: d.clone() }); }
    }
    crowd(true, spiderSpots);
    // beetles: on the floor mostly, along the foot of a wall
    const beetleSpots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (const e of world.edges) {
      if (e.open) continue;
      for (let i = Math.round(e.len * 0.55 + rnd()); i > 0; i--) {
        const p = wall(e, rnd() * e.len, (rnd() < 0.5 ? -1 : 1) * (2.3 + rnd() * 0.75));
        if (!p) continue;
        world.normalAt(p.x, p.y, p.z, d);
        if (d.y > 0.2 && !world.puddles.some((w) => p.y < w.y + 0.01 && Math.hypot(p.x - w.x, p.z - w.z) < w.r)) beetleSpots.push({ p, n: d.clone() });
      }
    }
    crowd(false, beetleSpots);

    // ---- worms: where it is wet (round the pools), and now and then anywhere low down ----
    const wormSpots: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (const w of world.puddles) {
      for (let i = 0, tries = 0; i < 3 && tries < 30; tries++) {
        const a = rnd() * 6.283, r = w.r + 0.03 + rnd() * 0.35;
        c.set(w.x + Math.cos(a) * r, w.y + 0.2, w.z + Math.sin(a) * r);
        if (world.sample(c.x, c.y, c.z) > -0.01) continue;
        const t = world.march(c, down, 0.5);
        if (t >= 0.5) continue;
        const p = c.clone().addScaledVector(down, t);
        if (p.y < w.y + 0.006) continue;
        world.normalAt(p.x, p.y, p.z, d);
        wormSpots.push({ p, n: d.clone() });
        i++;
      }
    }
    for (const e of world.edges) {
      if (e.open || rnd() > 0.45) continue;
      const p = wall(e, rnd() * e.len, (rnd() < 0.5 ? -1 : 1) * (1.9 + rnd() * 1.1));
      if (p && p.y < -0.6) { world.normalAt(p.x, p.y, p.z, d); wormSpots.push({ p, n: d.clone() }); }
    }
    const ring: number[] = [], ri: number[] = [], RINGS = 20, SIDES = 6;
    for (let j = 0; j <= RINGS; j++)
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        ring.push(Math.cos(a), Math.sin(a), j / RINGS);
        if (j < RINGS) { const p = j * SIDES + k, q = j * SIDES + ((k + 1) % SIDES); ri.push(p, q, p + SIDES, q, q + SIDES, p + SIDES); }
      }
    const tube = new THREE.BufferGeometry();
    tube.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ring), 3));
    tube.setIndex(ri);
    const shape = new Float32Array(wormSpots.length * 3);
    const worms = new THREE.InstancedMesh(tube, wormMaterial(), wormSpots.length);
    wormSpots.forEach((sp, i) => {
      shape.set([0.045 + rnd() * 0.052, 0.00165 + rnd() * 0.00105, rnd()], i * 3);
      // lying along the ground, whichever way; its own up is the ground's
      const h = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
      h.addScaledVector(sp.n, -h.dot(sp.n)).normalize();
      this.x.crossVectors(sp.n, h);
      this.m.makeBasis(this.x, sp.n, h).setPosition(sp.p);
      worms.setMatrixAt(i, this.m);
    });
    tube.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 3));
    worms.frustumCulled = false;
    this.group.add(worms);
    console.log(`life: ${threads} threads of silk, ${spiderSpots.length} spiders, ${beetleSpots.length} beetles, ${wormSpots.length} worms`);
  }

  /** stand a bug on its place: its own up the surface's, its nose the way it is heading */
  private put(set: { mesh: THREE.InstancedMesh }, b: Bug) {
    this.x.crossVectors(b.n, b.h).normalize();
    this.m.makeBasis(this.x, b.n, b.h).scale(this.q.setScalar(b.size)).setPosition(b.p);
    set.mesh.setMatrixAt(b.i, this.m);
  }

  /** They mostly sit. Now and then one walks a hand's breadth; a spider we come right up to is gone up the wall. */
  update(dt: number, eye: THREE.Vector3) {
    const { world } = this;
    for (const set of this.bugs) {
      let moved = false;
      for (const b of set.list) {
        const far = b.p.distanceTo(eye);
        if (far > 4) continue;
        if (b.shy && far < 0.3 && b.walk <= 0) {
          // away from us, along the wall
          b.h.copy(b.p).sub(eye);
          b.h.addScaledVector(b.n, -b.h.dot(b.n)).normalize();
          b.walk = 0.5 + Math.random() * 0.5;
        }
        if (b.walk <= 0 && (b.wait -= dt) < 0) {
          b.wait = 4 + Math.random() * 14;
          b.walk = 0.4 + Math.random() * (b.shy ? 0.8 : 3);
          // a new way to go, not far off the old one
          this.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          b.h.addScaledVector(this.q, 1.2);
          b.h.addScaledVector(b.n, -b.h.dot(b.n)).normalize();
        }
        const want = b.walk > 0 ? 1 : 0;
        if (b.step !== want) { b.step += (want - b.step) * Math.min(1, dt / 0.12); if (Math.abs(b.step - want) < 0.02) b.step = want; set.step.setX(b.i, b.step); set.step.needsUpdate = true; }
        if (b.walk <= 0) continue;
        b.walk -= dt;
        // a step along the surface, and down onto it again; where there is none to be had, the other way
        this.q.copy(b.p).addScaledVector(b.h, b.speed * dt * (b.shy && far < 0.45 ? 2.5 : 1)).addScaledVector(b.n, 0.02);
        this.back.copy(b.n).negate();
        const t = world.sample(this.q.x, this.q.y, this.q.z) > -0.002 ? 1 : world.march(this.q, this.back, 0.06);
        if (t >= 0.06) { b.h.negate(); b.walk = Math.min(b.walk, 0.3); continue; }
        b.p.copy(this.q).addScaledVector(this.back, t);
        world.normalAt(b.p.x, b.p.y, b.p.z, this.nn);
        b.n.lerp(this.nn, 0.5).normalize();
        b.h.addScaledVector(b.n, -b.h.dot(b.n)).normalize();
        this.put(set, b);
        moved = true;
      }
      if (moved) set.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
