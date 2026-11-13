// Process capture: a screenshot or a short clip of a running day, for timelapses.
// Files land in NN/process/ (gitignored) as NN-0001-YYYYMMDD-HHMMSS.png|mp4.
//
//   pnpm grab 08                    screenshot of http://localhost:5173/
//   pnpm grab 08 --video 6          6 s clip (webm, converted to mp4 if ffmpeg is there)
//   pnpm grab 08 --url http://localhost:5174/ --wait 3000 --size 1280x800
//   pnpm grab 08 --next png         only print the next file path (to save a shot taken elsewhere)
//   pnpm grab 08 --timelapse        stitch every png in process/ into NN-timelapse.mp4
//
// Show-off videos are something else, played by NN/about/demo.md, see clip.mjs:
//   pnpm grab 08 --clip             NN/about/screengrab.mp4, the 10 s index loop, from the live site
//   pnpm grab 08 --clip --url http://localhost:5173/ --still    from the dev server, and a new screengrab.png
//   pnpm grab 08 --x                NN/about/x.mp4, 60 s, 1080 square, for X (gitignored)
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const day = Number(args[0]);
if (!Number.isInteger(day) || day < 1 || day > 30) {
  console.error('usage: pnpm grab <01-30> [--video s] [--url u] [--wait ms] [--size WxH] [--next ext] [--timelapse] [--clip [--still] | --x]');
  process.exit(1);
}
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  const v = args[i + 1];
  return i < 0 ? fallback : v === undefined || v.startsWith('--') ? true : v;
};

const dir = String(day).padStart(2, '0');

if (flag('clip') || flag('x')) {
  const { clip } = await import('./clip.mjs');
  await clip(dir, { mode: flag('x') ? 'x' : 'clip', base: opt('url', undefined), still: flag('still') });
  process.exit(0);
}
const out = join(ROOT, dir, 'process');
mkdirSync(out, { recursive: true });

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

function nextPath(ext) {
  const re = new RegExp(`^${dir}-(\\d{4})-`);
  const last = readdirSync(out).reduce((m, f) => Math.max(m, Number(f.match(re)?.[1] ?? 0)), 0);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return join(out, `${dir}-${String(last + 1).padStart(4, '0')}-${stamp}.${ext}`);
}

if (opt('next')) {
  console.log(nextPath(opt('next') === true ? 'png' : opt('next')));
  process.exit(0);
}

if (opt('timelapse')) {
  if (!hasFfmpeg) throw new Error('timelapse needs ffmpeg');
  const fps = Number(opt('fps', 4));
  const file = join(out, `${dir}-timelapse.mp4`);
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(fps),
    '-pattern_type', 'glob', '-i', join(out, `${dir}-*.png`),
    '-vf', 'scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
    '-c:v', 'libx264', '-r', '30', file,
  ], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(file);
  process.exit(0);
}

const url = opt('url', 'http://localhost:5173/');
const wait = Number(opt('wait', 2000));
const [width, height] = String(opt('size', '1280x800')).split('x').map(Number);
const video = opt('video') ? Number(opt('video') === true ? 5 : opt('video')) : 0;

const { chromium } = await import('playwright-core');
// System Chrome, so WebGPU is there; new headless has a GPU on macOS.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const tmp = join(out, '.video');
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  ...(video ? { recordVideo: { dir: tmp, size: { width, height } } } : {}),
});
const page = await context.newPage();
try {
  await page.goto(url, { waitUntil: 'load' });
} catch {
  console.error(`could not open ${url}. Is \`pnpm -C ${dir} dev\` running?`);
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(wait);

let file;
if (video) {
  await page.waitForTimeout(video * 1000);
  const webm = await page.video().path();
  await context.close();
  if (hasFfmpeg) {
    file = nextPath('mp4');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: 'inherit' });
  } else {
    file = nextPath('webm');
    renameSync(webm, file);
  }
  rmSync(tmp, { recursive: true, force: true });
} else {
  file = nextPath('png');
  await page.screenshot({ path: file });
}
await browser.close();
if (!existsSync(file)) process.exit(1);
console.log(file);
