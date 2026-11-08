// A small studio to reflect: an equirect gradient with a window, a light strip and a floor, drawn into a data texture. No files, no
// network, and the renderer builds the PMREM from it like from any environment map.
import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, RGBAFormat } from 'three';

const W = 512, H = 256;

function box(u: number, v: number, cu: number, cv: number, hw: number, hh: number, soft: number) {
  const du = Math.min(Math.abs(u - cu), 1 - Math.abs(u - cu));
  const x = Math.max(0, 1 - Math.max(0, du - hw) / soft);
  const y = Math.max(0, 1 - Math.max(0, Math.abs(v - cv) - hh) / soft);
  return x * x * (3 - 2 * x) * y * y * (3 - 2 * y);
}

// One studio for the whole scene: the environment, and the soap film reads it for its window reflections.
let studio: DataTexture | null = null;
export const studioTexture = () => (studio ??= makeStudio());

function makeStudio() {
  const data = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1); // 0 at the bottom row of the texture
    for (let i = 0; i < W; i++) {
      const u = i / W;
      // Warm grey room, lighter towards the ceiling, a darker floor below a soft horizon.
      const floor = 1 - Math.min(1, Math.max(0, (v - 0.44) / 0.04));
      let r = 0.42 + 0.3 * v - floor * 0.2, g = 0.41 + 0.29 * v - floor * 0.2, b = 0.4 + 0.27 * v - floor * 0.19;
      // A crisp four-pane window up and to the left (the bars cut thin dark lines), a cooler strip low on the right.
      const bars = Math.min(1, Math.abs(u - 0.2) / 0.004) * Math.min(1, Math.abs(v - 0.78) / 0.008);
      const key = box(u, v, 0.2, 0.78, 0.07, 0.09, 0.012) * bars * 6;
      const glow = box(u, v, 0.2, 0.78, 0.07, 0.09, 0.12) * 0.6;
      const fill = box(u, v, 0.72, 0.35, 0.16, 0.025, 0.03) * 1.4;
      r += key + glow + fill * 0.85; g += key + glow + fill * 0.9; b += key + glow * 1.02 + fill * 1.0;
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
