// Wax caps: small, pale, slimy little mushrooms, white to grey, in troops on the wet ground round the standing water, and now and
// then out of a wall. One lathe-turned shape, instanced; each comes out of its surface and then turns up.
import * as THREE from 'three';
import type { World } from './world';
import type { Growth } from './growth';
import { fungusMaterial, fungusDepthMaterial } from './gfx';

export function buildFungi(world: World, growth: Growth, rnd: () => number): { mesh: THREE.Mesh; depth: THREE.Material } {
  // the profile: [part, radius, height, the profile's normal out, and along], stem then gills then the skin of the cap
  const RINGS = [
    [0, 1.35, 0.0, 1, 0], [0, 1.0, 0.3, 1, 0], [0, 0.95, 1.0, 1, 0],
    [1, 0.2, 0.16, 0.2, -1], [1, 1.0, 0.0, 0.3, -1],
    [2, 1.0, 0.07, 1, 0.25], [2, 0.86, 0.36, 0.86, 0.5], [2, 0.56, 0.7, 0.72, 0.7], [2, 0.24, 0.93, 0.45, 0.9], [2, 0.0, 1.0, 0, 1],
  ];
  const SEG = 9;
  const lp: number[] = [], prof: number[] = [], pn: number[] = [], li: number[] = [];
  RINGS.forEach((r, j) => {
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      lp.push(Math.cos(a), 0, Math.sin(a));
      prof.push(r[0], r[1], r[2]);
      pn.push(r[3], r[4]);
      if (j < RINGS.length - 1) {
        const p = j * SEG + i, q = j * SEG + ((i + 1) % SEG);
        li.push(p, p + SEG, q, q, p + SEG, q + SEG);
      }
    }
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  geo.setAttribute('aProf', new THREE.BufferAttribute(new Float32Array(prof), 3));
  geo.setAttribute('aPn', new THREE.BufferAttribute(new Float32Array(pn), 2));
  geo.setIndex(li);

  const aPos: number[] = [], aNrm: number[] = [], aShape: number[] = [], aLook: number[] = [];
  // white and grey only: snow, ivory, a pale ash, a mouse grey, a darker slate
  const COLS = [[0.58, 0.57, 0.53], [0.52, 0.5, 0.44], [0.4, 0.4, 0.38], [0.27, 0.265, 0.25], [0.17, 0.17, 0.165]];
  const n = new THREE.Vector3(), m = new THREE.Vector3(), q = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), back = new THREE.Vector3();
  const drowned = (p: THREE.Vector3) => world.puddles.some((w) => p.y < w.y + 0.006 && Math.hypot(p.x - w.x, p.z - w.z) < w.r + 0.02);
  /** a troop of them round c, on a surface facing nrm */
  const troop = (c: THREE.Vector3, nrm: THREE.Vector3, count: number) => {
    const col = COLS[Math.floor(rnd() * COLS.length)];
    const big = 0.6 + rnd() * 0.75;
    u.set(nrm.z, 0.3, -nrm.x).cross(nrm).normalize();
    v.crossVectors(nrm, u);
    for (let k = 0; k < count; k++) {
      const a = rnd() * 6.283, r = k ? 0.008 + rnd() * 0.045 : 0;
      q.copy(c).addScaledVector(nrm, 0.05).addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
      if (world.sample(q.x, q.y, q.z) > -0.005) continue;
      back.copy(nrm).negate();
      const t = world.march(q, back, 0.13);
      if (t >= 0.13) continue;
      q.addScaledVector(back, t);
      world.normalAt(q.x, q.y, q.z, m);
      // not from a roof (they would have to grow down), not under water
      if (m.y < -0.3 || drowned(q)) continue;
      const s = big * (0.45 + rnd() * 0.75);
      const capR = (0.0045 + rnd() * 0.0055) * s;
      // out of a wall the stem is longer: it has a way to go before it is up
      const h = (0.012 + rnd() * 0.02) * s * (1.25 - 0.35 * Math.max(0, m.y));
      aPos.push(q.x, q.y, q.z);
      aNrm.push(m.x, m.y, m.z);
      // young ones are sharp little cones, old ones have opened out
      aShape.push(h, capR, capR * (0.2 + rnd() * 0.1), 0.55 + rnd() * 0.7);
      const k2 = 0.8 + 0.4 * rnd();
      aLook.push(col[0] * k2, col[1] * k2, col[2] * k2, rnd());
    }
  };
  const down = new THREE.Vector3(0, -1, 0);
  // round every puddle: on the wet ground just clear of the water
  for (const w of world.puddles) {
    const troops = 3 + Math.floor(rnd() * 3);
    for (let i = 0, tries = 0; i < troops && tries < 40; tries++) {
      const a = rnd() * 6.283, r = w.r + 0.02 + rnd() * rnd() * 0.4;
      q.set(w.x + Math.cos(a) * r, w.y + 0.22, w.z + Math.sin(a) * r);
      if (world.sample(q.x, q.y, q.z) > -0.01) continue;
      const t = world.march(q, down, 0.5);
      if (t >= 0.5) continue;
      n.copy(q).addScaledVector(down, t);
      if (n.y < w.y + 0.006) continue;
      world.normalAt(n.x, n.y, n.z, m);
      const before = aPos.length;
      troop(n.clone(), m.clone(), 3 + Math.floor(rnd() * 7));
      if (aPos.length > before) i++;
    }
  }
  // and every so often out of a wall, likeliest where the mould is: low on the sides, in the corner with the floor
  const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3(), d = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const g = [0, 0, 0];
  for (const e of world.edges) {
    if (e.open) continue;
    for (let i = Math.round(e.len * 3); i > 0; i--) {
      const s = rnd() * e.len;
      world.railPoint(e, s, c);
      world.railTangent(e, s, T);
      side.crossVectors(T, up).normalize();
      up2.crossVectors(side, T);
      const phi = (0.8 + rnd() * 1.7) * (rnd() < 0.5 ? -1 : 1);
      d.copy(up2).multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
      const t = world.march(c, d, 0.9);
      if (t >= 0.9) continue;
      c.addScaledVector(d, t);
      world.normalAt(c.x, c.y, c.z, n);
      if (n.y < -0.25) continue;
      growth.at(c.x, c.y, c.z, n.y, 0, g);
      if (rnd() > 0.22 + 0.6 * g[2]) continue;
      troop(c.clone(), n.clone(), 1 + Math.floor(rnd() * rnd() * 6));
    }
  }
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(aPos), 3));
  geo.setAttribute('aNrm', new THREE.InstancedBufferAttribute(new Float32Array(aNrm), 3));
  geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(aShape), 4));
  geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 4));
  geo.instanceCount = aPos.length / 3;
  const mesh = new THREE.Mesh(geo, fungusMaterial());
  mesh.frustumCulled = false;
  console.log(`fungi: ${geo.instanceCount} wax caps`);
  return { mesh, depth: fungusDepthMaterial() };
}
