// 01 / Fold — a sheet of lines folding along a moving crease.
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

const ROWS = 40;
const COLS = 120;

function frame(t: number) {
  const s = t * 0.001;
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, w, h);

  // crease position sweeps across, lines "fold" over it
  const crease = (Math.sin(s * 0.5) * 0.5 + 0.5) * w;
  const angle = Math.sin(s * 0.8) * Math.PI * 0.5;

  ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++) {
    const y = (r / ROWS) * h;
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) {
      const x = (c / COLS) * w;
      const d = x - crease;
      // past the crease, fold back along the crease by the current angle
      const fx = d > 0 ? crease + d * Math.cos(angle) : x;
      const fy = d > 0 ? y + d * Math.sin(angle) * 0.35 : y;
      c === 0 ? ctx.moveTo(fx, fy) : ctx.lineTo(fx, fy);
    }
    const shade = 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(angle));
    ctx.strokeStyle = `rgba(255, 181, 71, ${shade})`;
    ctx.stroke();
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
