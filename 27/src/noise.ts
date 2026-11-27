import * as THREE from 'three';

export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number) {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

/** Improved Perlin noise, optionally periodic on the lattice (rep cells). */
export class Perlin {
  private p = new Uint8Array(512);
  constructor(seed = 1) {
    const r = mulberry32(seed);
    const a = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = a[i & 255];
  }
  n(x: number, y: number, z: number, rep = 0): number {
    const p = this.p;
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    let X1 = X + 1, Y1 = Y + 1, Z1 = Z + 1;
    if (rep) {
      X = ((X % rep) + rep) % rep; X1 = ((X1 % rep) + rep) % rep;
      Y = ((Y % rep) + rep) % rep; Y1 = ((Y1 % rep) + rep) % rep;
      Z = ((Z % rep) + rep) % rep; Z1 = ((Z1 % rep) + rep) % rep;
    }
    X &= 255; Y &= 255; Z &= 255; X1 &= 255; Y1 &= 255; Z1 &= 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, A1 = p[X] + Y1, B = p[X1] + Y, B1 = p[X1] + Y1;
    const AA = p[A] + Z, AB = p[A1] + Z, BA = p[B] + Z, BB = p[B1] + Z;
    const AAz = p[A] + Z1, ABz = p[A1] + Z1, BAz = p[B] + Z1, BBz = p[B1] + Z1;
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      l(l(grad(p[AAz], x, y, z - 1), grad(p[BAz], x - 1, y, z - 1), u), l(grad(p[ABz], x, y - 1, z - 1), grad(p[BBz], x - 1, y - 1, z - 1), u), v),
      w,
    );
  }
}

/**
 * A tileable 3D noise for the shaders: rgb = gradient (d/du, u the texture coordinate), a = value in about [-1, 1].
 * One fetch gives a height and its slope, so a bump costs one tap per octave.
 */
export function bakeNoiseTexture(size = 64, seed = 7): THREE.Data3DTexture {
  const P = new Perlin(seed);
  const n = size;
  const val = new Float32Array(n * n * n);
  const A = 6, B = 13;
  let i = 0;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const u = x / n, v = y / n, w = z / n;
        val[i++] = 1.25 * P.n(u * A, v * A, w * A, A) + 0.5 * P.n(u * B + 3.1, v * B + 1.7, w * B + 9.2, B);
      }
  const data = new Uint16Array(n * n * n * 4);
  const at = (x: number, y: number, z: number) => val[((x + n) % n) + n * (((y + n) % n) + n * ((z + n) % n))];
  const h = THREE.DataUtils.toHalfFloat;
  i = 0;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        data[i++] = h((at(x + 1, y, z) - at(x - 1, y, z)) * n * 0.5);
        data[i++] = h((at(x, y + 1, z) - at(x, y - 1, z)) * n * 0.5);
        data[i++] = h((at(x, y, z + 1) - at(x, y, z - 1)) * n * 0.5);
        data[i++] = h(at(x, y, z));
      }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
