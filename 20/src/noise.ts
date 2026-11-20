import * as THREE from 'three';

/** value noise on a 32³ lattice, smoothed, tiling: what the march samples for its smoke */
function noise3d() {
  const N = 32, R = 4; // 4 texels a lattice cell, so trilinear filtering stands in for the smoothstep
  const hash = (x: number, y: number, z: number) => {
    const h = Math.sin(((x % N) + N) % N * 127.1 + (((y % N) + N) % N) * 311.7 + (((z % N) + N) % N) * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const S = N * R;
  const data = new Uint8Array(S * S * S);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const fx = x / R, fy = y / R, fz = z / R;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const ux = sm(fx - ix), uy = sm(fy - iy), uz = sm(fz - iz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const v = l(
      l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), ux), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), ux), uy),
      l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), ux), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), ux), uy),
      uz,
    );
    data[x + y * S + z * S * S] = Math.round(v * 255);
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
