// Render a scene into a target and hand back a PNG data URL: the swatches, the eraser, the glyph thumbnails
// and the object miniature all go through here. Clears to transparent and puts the renderer back after.
import * as THREE from 'three';

interface Readback { pixels: Uint8Array; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData }
const readbacks = new Map<string, Readback>(); // one buffer and canvas per size, reused across calls

function readbackFor(w: number, h: number): Readback {
  const key = `${w}x${h}`;
  let r = readbacks.get(key);
  if (!r) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    r = { pixels: new Uint8Array(w * h * 4), canvas, ctx, img: ctx.createImageData(w, h) };
    readbacks.set(key, r);
  }
  return r;
}

export function renderToDataURL(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, rt: THREE.WebGLRenderTarget): string {
  const w = rt.width, h = rt.height;
  const { pixels, canvas, ctx, img } = readbackFor(w, h);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setClearAlpha(0);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  // GL rows run bottom-up
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
