// The body: a tube swept along the physics chain, rebuilt every frame. Its cross-section is a
// snake's, not a hose's: a flat belly with rounded corners, higher sides, a low ridge along the
// spine for the python, and a plain circle at the neck so it fits the Blender head.
// Each vertex also carries where it is on the skin (scale coordinates, which never slide) and
// how stretched it is: on the outside of a bend the scales part and the skin shows between.
import * as THREE from 'three';
import type { Snake, World } from './physics';

const SUB = 2; // rings per sphere
const RAD = 36; // vertices round
const SEC = 8; // directions the occlusion is worked out in

export interface Body {
  mesh: THREE.Mesh;
  update(time: number, world: World): void;
  /** where the head goes: the neck ring centre and its frame */
  neck: { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 };
}

function profileTable(n: number, top: number, bottom: number, ridge: number) {
  const pts = new Float32Array((RAD + 1) * 2);
  const nor = new Float32Array((RAD + 1) * 2);
  const spow = (a: number, p: number) => Math.sign(a) * Math.abs(a) ** p;
  const at = (al: number): [number, number] => {
    const c = Math.cos(al), s = Math.sin(al);
    const isTop = c < 0;
    const e = isTop ? n : 3.4 * (n / 2.2);
    const x = 1.0 * spow(s, 2 / e);
    let y = (isTop ? top : bottom) * spow(-c, 2 / e);
    const da = al - Math.PI;
    y += ridge * Math.exp(-(da * da) / 0.09);
    return [x, y];
  };
  for (let j = 0; j <= RAD; j++) {
    const al = (j / RAD) * Math.PI * 2;
    const [x, y] = at(al);
    const [x1, y1] = at(al + 1e-3);
    const [x0, y0] = at(al - 1e-3);
    const tx = x1 - x0, ty = y1 - y0;
    // outward: tangent rotated (the profile runs counter-clockwise seen from the tail)
    let nx = ty, ny = -tx;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    pts[j * 2] = x; pts[j * 2 + 1] = y;
    nor[j * 2] = nx; nor[j * 2 + 1] = ny;
  }
  return { pts, nor };
}

export function createBody(s: Snake, material: THREE.Material): Body {
  const K = s.headK;
  const np = s.n - K;
  const PLUG = 2;
  const rings = PLUG + (np - 1) * SUB + 1 + 1;
  const vcount = rings * (RAD + 1);
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const tan = new Float32Array(vcount * 3);
  const body = new Float32Array(vcount * 4); // a (scale units along), v (round), radius, stretch
  const body2 = new Float32Array(vcount * 2); // s (metres along), metres per scale unit
  const ao = new Float32Array(vcount);
  const idx: number[] = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let j = 0; j < RAD; j++) {
      const a = r * (RAD + 1) + j, b = a + 1, c = a + RAD + 2, d = a + RAD + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const norAttr = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
  const tanAttr = new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage);
  const bodyAttr = new THREE.BufferAttribute(body, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', norAttr);
  geo.setAttribute('aTan', tanAttr);
  geo.setAttribute('aBody', bodyAttr);
  geo.setAttribute('aBody2', new THREE.BufferAttribute(body2, 2));
  const aoAttr = new THREE.BufferAttribute(ao, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAO', aoAttr);
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const sp = s.sp;
  const shapeBody = profileTable(sp.shape === 'python' ? 2.1 : 2.4, 0.95, 0.8, sp.shape === 'python' ? 0.07 : 0.02);
  const shapeNeck = profileTable(2, 1, 1, 0);

  // rest layout, fixed: arc length, radius, scale coordinate of each ring
  const ringS = new Float32Array(rings);
  const ringR = new Float32Array(rings);
  const ringF = new Float32Array(rings); // fractional sphere index
  const ringA = new Float32Array(rings);
  const ringM = new Float32Array(rings);
  for (let r = 0; r < rings; r++) {
    let f: number;
    if (r < PLUG) f = K - (PLUG - r) * 0.5;
    else if (r === rings - 1) f = s.n - 1 + 0.15;
    else f = K + (r - PLUG) / SUB;
    ringF[r] = f;
    ringS[r] = (f - K) * s.seg;
    const i0 = Math.min(s.n - 1, Math.max(K, Math.floor(f)));
    const i1 = Math.min(s.n - 1, i0 + 1);
    const t = Math.min(1, Math.max(0, f - i0));
    ringR[r] = r < PLUG ? sp.neck * 0.92 : r === rings - 1 ? 0 : s.rad[i0] + (s.rad[i1] - s.rad[i0]) * t;
  }
  // dorsal scale: row spacing from the girth, length from the aspect; the coordinate along is
  // the integral of 1 / length, so scales shrink toward neck and tail as on the animal
  for (let r = 0; r < rings; r++) {
    const rr = Math.max(ringR[r], sp.neck * 0.25);
    const spacing = ((1 - sp.ventralWidth) * 2 * Math.PI * rr) / sp.rows;
    ringM[r] = spacing * sp.scaleAspect;
    ringA[r] = r === 0 ? ringS[0] / ringM[r] : ringA[r - 1] + (ringS[r] - ringS[r - 1]) / ringM[r];
  }
  // metres along and metres per scale never change: written once
  for (let r = 0; r < rings; r++) {
    for (let j = 0; j <= RAD; j++) {
      const o = r * (RAD + 1) + j;
      body2[o * 2] = ringS[r];
      body2[o * 2 + 1] = ringM[r];
    }
  }

  const C = new Float32Array(rings * 3);
  const T = new Float32Array(rings * 3);
  const U = new Float32Array(rings * 3);
  // the spine drawn is the chain itself: on its track it is as smooth as the track
  const P = s.pos;
  const v3 = new THREE.Vector3();
  const neck = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };

  function point(f: number, out: Float32Array, o: number) {
    // Catmull-Rom through the spheres
    const n = s.n;
    const i = Math.floor(f);
    const t = f - i;
    const g = (k: number, a: number) => P[Math.min(n - 1, Math.max(0, k)) * 3 + a];
    for (let a = 0; a < 3; a++) {
      const p0 = g(i - 1, a), p1 = g(i, a), p2 = g(i + 1, a), p3 = g(i + 2, a);
      const t2 = t * t, t3 = t2 * t;
      out[o + a] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
  }

  // spheres near a ring, from either snake, that can shade it
  const near: number[] = [];
  const sec = new Float32Array(SEC);
  let gr = 0;
  let gx = 0, gy = 0, gz = 0;
  let gWorld: World;
  const visit = (k: number, i: number) => {
    const o = gWorld.snakes[k];
    if (o === s && Math.abs(i - ringF[gr]) < 5) return;
    const dx = o.pos[i * 3] - gx, dy = o.pos[i * 3 + 1] - gy, dz = o.pos[i * 3 + 2] - gz;
    const R = ringR[gr] + 0.025 + o.rad[i];
    if (dx * dx + dy * dy + dz * dz < R * R) near.push(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2], o.rad[i]);
  };
  function gather(r: number, world: World) {
    near.length = 0;
    gr = r; gx = C[r * 3]; gy = C[r * 3 + 1]; gz = C[r * 3 + 2]; gWorld = world;
    world.near(gx, gz, visit);
  }

  function update(time: number, world: World) {
    // centres: the plug rings carry on the neck's line into the head
    const fx = P[K * 3] - P[0], fy = P[K * 3 + 1] - P[1], fz = P[K * 3 + 2] - P[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    for (let r = 0; r < rings; r++) {
      const f = ringF[r];
      if (r < PLUG) {
        const back = (K - f) * s.seg;
        C[r * 3] = P[K * 3] - (fx / fl) * back;
        C[r * 3 + 1] = P[K * 3 + 1] - (fy / fl) * back;
        C[r * 3 + 2] = P[K * 3 + 2] - (fz / fl) * back;
      } else if (r === rings - 1) {
        const n = s.n - 1;
        const tx = P[n * 3] - P[(n - 1) * 3], ty = P[n * 3 + 1] - P[(n - 1) * 3 + 1], tz = P[n * 3 + 2] - P[(n - 1) * 3 + 2];
        C[r * 3] = P[n * 3] + tx * 0.15; C[r * 3 + 1] = P[n * 3 + 1] + ty * 0.15; C[r * 3 + 2] = P[n * 3 + 2] + tz * 0.15;
      } else point(f, C, r * 3);
    }
    // tangents toward the tail, then an up that follows the world's but never flips
    for (let r = 0; r < rings; r++) {
      const a = Math.max(0, r - 1), b = Math.min(rings - 1, r + 1);
      let x = C[b * 3] - C[a * 3], y = C[b * 3 + 1] - C[a * 3 + 1], z = C[b * 3 + 2] - C[a * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      T[r * 3] = x; T[r * 3 + 1] = y; T[r * 3 + 2] = z;
      // world up, minus its part along the body
      let ux = -y * x, uy = 1 - y * y, uz = -y * z;
      const wl = Math.hypot(ux, uy, uz);
      if (r > 0) {
        // the previous up carried over
        let px = U[(r - 1) * 3], py = U[(r - 1) * 3 + 1], pz = U[(r - 1) * 3 + 2];
        const d = px * x + py * y + pz * z;
        px -= d * x; py -= d * y; pz -= d * z;
        const pl = Math.hypot(px, py, pz) || 1;
        const w = 0.25 * Math.min(1, wl * 1.5);
        ux = (px / pl) * (1 - w) + (wl > 1e-4 ? ux / wl : 0) * w;
        uy = (py / pl) * (1 - w) + (wl > 1e-4 ? uy / wl : 0) * w;
        uz = (pz / pl) * (1 - w) + (wl > 1e-4 ? uz / wl : 0) * w;
      }
      const ul = Math.hypot(ux, uy, uz) || 1;
      U[r * 3] = ux / ul; U[r * 3 + 1] = uy / ul; U[r * 3 + 2] = uz / ul;
    }
    const breath = 1 + 0.018 * Math.sin(time * 1.1 + s.pathIndex);
    for (let r = 0; r < rings; r++) {
      gather(r, world);
      const tx = T[r * 3], ty = T[r * 3 + 1], tz = T[r * 3 + 2];
      const ux = U[r * 3], uy = U[r * 3 + 1], uz = U[r * 3 + 2];
      // side = up x tangent
      const lx = uy * tz - uz * ty, ly = uz * tx - ux * tz, lz = ux * ty - uy * tx;
      // curvature, in the ring's frame
      const a = Math.max(0, r - 1), b = Math.min(rings - 1, r + 1);
      const ds = Math.max(1e-4, (ringF[b] - ringF[a]) * s.seg);
      const kx = (T[b * 3] - T[a * 3]) / ds, ky = (T[b * 3 + 1] - T[a * 3 + 1]) / ds, kz = (T[b * 3 + 2] - T[a * 3 + 2]) / ds;
      const kl = kx * lx + ky * ly + kz * lz;
      const ku = kx * ux + ky * uy + kz * uz;
      const R = ringR[r];
      const mid = Math.min(1, Math.max(0, (ringS[r] - 0.1) / 0.2)) * Math.max(0, 1 - ringS[r] / (sp.length * 0.8));
      const rr = R * (1 + (breath - 1) * mid);
      const nb = Math.min(1, Math.max(0, ringS[r] / 0.07)); // neck: round, body: snake
      const drop = rr * 0.06 * nb; // the flat belly sits on the ground
      // occlusion from the bodies against this ring, in a few directions round it
      for (let k = 0; k < SEC; k++) {
        const al = (k / SEC) * Math.PI * 2;
        const sx = Math.sin(al), sy = -Math.cos(al);
        const wx = lx * sx + ux * sy, wy = ly * sx + uy * sy, wz = lz * sx + uz * sy;
        const vx = C[r * 3] + wx * rr, vy = C[r * 3 + 1] + wy * rr, vz = C[r * 3 + 2] + wz * rr;
        let occ = 0;
        for (let q = 0; q < near.length; q += 4) {
          const dx = near[q] - vx, dy = near[q + 1] - vy, dz = near[q + 2] - vz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
          const facing = (dx * wx + dy * wy + dz * wz) / d;
          if (facing <= 0) continue;
          const rr2 = near[q + 3] / Math.max(d, near[q + 3] * 1.05);
          occ += facing * rr2 * rr2 * 1.1;
        }
        sec[k] = occ;
      }
      for (let j = 0; j <= RAD; j++) {
        const o = (r * (RAD + 1) + j);
        const px = shapeNeck.pts[j * 2] * (1 - nb) + shapeBody.pts[j * 2] * nb;
        const py = shapeNeck.pts[j * 2 + 1] * (1 - nb) + shapeBody.pts[j * 2 + 1] * nb;
        let nx = shapeNeck.nor[j * 2] * (1 - nb) + shapeBody.nor[j * 2] * nb;
        let ny = shapeNeck.nor[j * 2 + 1] * (1 - nb) + shapeBody.nor[j * 2 + 1] * nb;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl; ny /= nl;
        const ox = px * rr, oy = py * rr - drop;
        pos[o * 3] = C[r * 3] + lx * ox + ux * oy;
        pos[o * 3 + 1] = C[r * 3 + 1] + ly * ox + uy * oy;
        pos[o * 3 + 2] = C[r * 3 + 2] + lz * ox + uz * oy;
        nor[o * 3] = lx * nx + ux * ny;
        nor[o * 3 + 1] = ly * nx + uy * ny;
        nor[o * 3 + 2] = lz * nx + uz * ny;
        tan[o * 3] = tx; tan[o * 3 + 1] = ty; tan[o * 3 + 2] = tz;
        // stretch: the outside of a bend is longer than the centre line
        const st = 1 - (kl * px + ku * py) * rr;
        body[o * 4] = ringA[r];
        body[o * 4 + 1] = j / RAD;
        body[o * 4 + 2] = Math.max(R, sp.neck * 0.25);
        body[o * 4 + 3] = Math.min(1.8, Math.max(0.6, st));
        // occlusion: the ground under it and the bodies against it
        const vy = pos[o * 3 + 1], wy = nor[o * 3 + 1];
        const fs = (j / RAD) * SEC, k0 = Math.floor(fs) % SEC, ft = fs - Math.floor(fs);
        let occ = sec[k0] + (sec[(k0 + 1) % SEC] - sec[k0]) * ft;
        occ += Math.max(0, -wy) * Math.max(0, 1 - vy / 0.035) * 0.9 + Math.max(0, 1 - vy / 0.012) * 0.3;
        ao[o] = 1 / (1 + 1.6 * occ);
      }
    }
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;
    tanAttr.needsUpdate = true;
    bodyAttr.needsUpdate = true;
    aoAttr.needsUpdate = true;

    // the neck frame for the head
    const r0 = PLUG;
    neck.pos.set(C[r0 * 3], C[r0 * 3 + 1], C[r0 * 3 + 2]);
    neck.fwd.set(fx, fy, fz).normalize().negate();
    v3.set(U[r0 * 3], U[r0 * 3 + 1], U[r0 * 3 + 2]);
    neck.up.copy(v3).addScaledVector(neck.fwd, -v3.dot(neck.fwd)).normalize();
  }

  return { mesh, update, neck };
}
