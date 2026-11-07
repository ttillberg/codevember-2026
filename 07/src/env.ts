// A small studio to reflect: an equirect gradient with two soft boxes, drawn into a data texture. No files, no
// network, and the renderer builds the PMREM from it like from any environment map.
import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, RGBAFormat } from 'three';

const W = 256, H = 128;

function box(u: number, v: number, cu: number, cv: number, hw: number, hh: number, soft: number) {
  const du = Math.min(Math.abs(u - cu), 1 - Math.abs(u - cu));
  const x = Math.max(0, 1 - Math.max(0, du - hw) / soft);
  const y = Math.max(0, 1 - Math.max(0, Math.abs(v - cv) - hh) / soft);
  return x * x * (3 - 2 * x) * y * y * (3 - 2 * y);
}

export function makeStudio() {
  const data = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1); // 0 at the bottom row of the texture
    for (let i = 0; i < W; i++) {
      const u = i / W;
      // Warm grey room, lighter towards the ceiling.
      let r = 0.42 + 0.3 * v, g = 0.41 + 0.29 * v, b = 0.4 + 0.27 * v;
      // A big softbox up and to the left, a cooler strip low on the right.
      const key = box(u, v, 0.2, 0.78, 0.08, 0.1, 0.1) * 3.5;
      const fill = box(u, v, 0.72, 0.35, 0.16, 0.03, 0.08) * 1.2;
      r += key + fill * 0.85; g += key + fill * 0.9; b += key + fill * 1.0;
      const k = (j * W + i) * 4;
      data[k] = r; data[k + 1] = g; data[k + 2] = b; data[k + 3] = 1;
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
