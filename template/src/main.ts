const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const ctx = canvas.getContext('2d')!;

let w = 0;
let h = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(t: number) {
  ctx.clearRect(0, 0, w, h);
  // draw here, t is ms
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
