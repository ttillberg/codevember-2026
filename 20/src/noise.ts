import * as THREE from 'three';

/** value noise on a 32³ lattice, smoothed, tiling: what the march samples for its smoke */
function noise3d() {
  const N = 32, R = 4; // 4 texels a lattice cell, so trilinear filtering stands in for the smoothstep
  // the lattice hashed once (32³ sines, not eight for each of the 128³ texels: that stood a phone still for most
  // of a second), and the smoothstep weights, the same for every cell
  const L = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    L[x + y * N + z * N * N] = h - Math.floor(h);
  }
  const S = N * R;
  const data = new Uint8Array(S * S * S);
  const W = Array.from({ length: R }, (_, i) => { const t = i / R; return t * t * (3 - 2 * t); });
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  for (let z = 0; z < S; z++) {
    const iz = (z / R) | 0, uz = W[z % R], z0 = iz * N * N, z1 = ((iz + 1) % N) * N * N;
    for (let y = 0; y < S; y++) {
      const iy = (y / R) | 0, uy = W[y % R], y0 = iy * N, y1 = ((iy + 1) % N) * N;
      for (let x = 0; x < S; x++) {
        const ix = (x / R) | 0, ux = W[x % R], x1 = (ix + 1) % N;
        const v = l(
          l(l(L[ix + y0 + z0], L[x1 + y0 + z0], ux), l(L[ix + y1 + z0], L[x1 + y1 + z0], ux), uy),
          l(l(L[ix + y0 + z1], L[x1 + y0 + z1], ux), l(L[ix + y1 + z1], L[x1 + y1 + z1], ux), uy),
          uz,
        );
        data[x + y * S + z * S * S] = Math.round(v * 255);
      }
    }
  }
  const t = new THREE.Data3DTexture(data, S, S, S);
  t.format = THREE.RedFormat;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** one for everything that wants smooth noise in a shader: the grit on every surface, the smoke in the rays */
export const NOISE3D = noise3d();
