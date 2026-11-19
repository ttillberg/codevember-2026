// Show-off videos of a day, played by the recipe in NN/about/demo.md. Run through `pnpm grab NN --clip | --x`.
//
//   --clip   the index clip: NN/about/screengrab.mp4, 10 s, 480 square, committed. Also NN/about/screengrab.png
//            (1200 square, the last frame) if there is none yet, or always with --still.
//   --x      the post for X: NN/about/x.mp4, 60 s, 1080 square, gitignored, with the page's sound (whatever
//            a Web Audio graph sends to the speakers, recorded in the page and laid under the frames).
//
// demo.md: frontmatter, then prose for people, then the blocks the recorder plays.
//
//   ---
//   query: ?clean        appended to the day's url
//   warmup: 8000         ms to let it load and settle before anything is played
//   seconds: 10          length of the index clip
//   xseconds: 60         length of the X video
//   ink: white           the title over the index square: black (default) or white on a dark day
//   crop: 600            the index clip shows only the middle of the viewport, this many px square (zoomed in)
//   ---
//   ```init              JavaScript run in the page before it loads (localStorage, a fixed seed...)
//   ```setup             played after the warmup, before the index clip starts: what it should open on
//   ```steps             played during the index clip
//   ```x-setup           the same for the X video (falls back to setup)
//   ```x                 played during the X video
//
// Steps, one a line, # for comments:
//   drag 360,430 610,390 860,440 450ms     press, pass through the points (each leg 450 ms, eased), release
//   drag 600,600 600,300 800ms meta        same with keys held (meta, shift, alt, control, or any key as +c)
//   move 600,600 300ms                     move without pressing
//   key Space                              press a key
//   wheel 400 600,600                      scroll (zoom), down positive, at a point (the middle by default)
//   js document.querySelector('[data-choice="M"]').click()      run in the page
//   wait 1500                              do nothing for a while
//
// Coordinates are in the 1200 × 1200 viewport. Everything on the page but the canvas is hidden while recording.
// Frames come from the page's screencast as JPEGs with their timestamps, so the video keeps real time.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, HOMEPAGE } from './lib.mjs';

const SIZE = 1200;
export const HIDE = 'body * { visibility: hidden !important; } canvas { visibility: visible !important; } html, body { cursor: none !important; }';
const MODES = {
  clip: { file: 'screengrab.mp4', out: 480, crf: 26, secs: (d) => d.seconds, setup: 'setup', steps: 'steps' },
  x: { file: 'x.mp4', out: 1080, crf: 18, secs: (d) => d.xseconds, setup: 'x-setup', steps: 'x', sound: true },
};

export function readDemo(dir) {
  const file = join(ROOT, dir, 'about', 'demo.md');
  if (!existsSync(file)) throw new Error(`${dir}/about/demo.md is missing`);
  const md = readFileSync(file, 'utf8');
  const meta = { query: '', warmup: 8000, seconds: 10, xseconds: 60 };
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  for (const line of fm ? fm[1].split('\n') : []) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2].trim();
  }
  const blocks = {};
  for (const b of md.matchAll(/```([\w-]+)\n([\s\S]*?)```/g)) {
    blocks[b[1]] = b[1] === 'init' ? [b[2]] : b[2].split('\n').map((l) => l.replace(/^#.*|\s#\s.*$/, '').trim()).filter(Boolean);
  }
  return { ...meta, blocks };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's sound, for --x: everything connected to an AudioContext's speakers is also sent to a recorder.
// The context is often made on the first gesture, after the recording started: the recorder starts then,
// and remembers how late, so the sound is laid in at the right time.
const AUDIO_TAP = `(() => {
  const connect = AudioNode.prototype.connect;
  // (one context, the first live one to reach its speakers: a day has one)
  const grab = (window.__grabAudio = { on: false, t0: 0, rec: null, chunks: [], late: 0, tap: null });
  const start = () => {
    if (!grab.on || grab.rec || !grab.tap) return;
    const rec = new MediaRecorder(grab.tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    rec.ondataavailable = (e) => e.data.size && grab.chunks.push(e.data);
    rec.start(250);
    grab.rec = rec;
    grab.late = (performance.now() - grab.t0) / 1000;
  };
  grab.begin = () => { grab.on = true; grab.t0 = performance.now(); start(); };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      if (!grab.tap) { grab.tap = this.context.createMediaStreamDestination(); start(); }
      if (grab.tap.context === this.context) connect.call(this, grab.tap);
    }
    return r;
  };
})();`;

/** stop the page's recorder and hand back its sound (webm) and how late into the video it started */
async function takeAudio(page) {
  return page.evaluate(async () => {
    const g = window.__grabAudio;
    if (!g?.rec) return null;
    await new Promise((r) => { g.rec.onstop = r; g.rec.stop(); });
    const buf = new Uint8Array(await new Blob(g.chunks, { type: 'audio/webm' }).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), late: g.late };
  });
}
const KEYS = { meta: 'Meta', shift: 'Shift', alt: 'Alt', control: 'Control' };

export async function play(page, line) {
  const [cmd, ...rest] = line.split(/\s+/);
  if (cmd === 'wait') return sleep(Number(rest[0]));
  if (cmd === 'key') return page.keyboard.press(rest[0]);
  if (cmd === 'wheel') { await page.mouse.move(...(rest[1] ?? '600,600').split(',').map(Number)); return page.mouse.wheel(0, Number(rest[0])); }
  if (cmd === 'js') return page.evaluate(line.slice(3));
  if (cmd !== 'drag' && cmd !== 'move') throw new Error(`demo.md: unknown step "${line}"`);
  const pts = rest.filter((w) => w.includes(',')).map((w) => w.split(',').map(Number));
  const ms = Number(rest.find((w) => /^\d+ms$/.test(w))?.slice(0, -2) ?? 500);
  const mods = rest.filter((w) => KEYS[w] || w.startsWith('+')).map((w) => KEYS[w] ?? w.slice(1));
  for (const m of mods) await page.keyboard.down(m);
  if (cmd === 'move') pts.unshift(null);
  else {
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1] ?? pts[i], [bx, by] = pts[i];
    const n = Math.max(2, Math.round(ms / 40)); // (a move can take a frame or two on a heavy page)
    const t0 = Date.now();
    for (let k = 1; k <= n; k++) {
      const t = k / n, e = t * t * (3 - 2 * t); // eased, like a hand
      await page.mouse.move(ax + (bx - ax) * e, ay + (by - ay) * e);
      // on the clock: a slow move doesn't stretch the leg
      await sleep(Math.max(0, t0 + ms * t - Date.now()));
    }
  }
  if (cmd === 'drag') await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

export async function clip(dir, { mode = 'clip', base, still = false } = {}) {
  const m = MODES[mode];
  const demo = readDemo(dir);
  const secs = m.secs(demo);
  const setup = demo.blocks[m.setup] ?? demo.blocks.setup ?? [];
  const steps = demo.blocks[m.steps] ?? [];
  const url = `${base ?? `${HOMEPAGE}/${dir}/`}${demo.query}`;
  const about = join(ROOT, dir, 'about');
  const mp4 = join(about, m.file);
  const png = join(about, 'screengrab.png');
  const tmp = mkdtempSync(join(tmpdir(), `clip-${dir}-`));

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
  });
  const ctx = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  if (m.sound) await page.addInitScript(AUDIO_TAP);
  if (demo.blocks.init) await page.addInitScript(demo.blocks.init[0]);
  console.log(`▶ ${url} (${mode}, ${secs} s)`);
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(demo.warmup);
  for (const s of setup) await play(page, s);

  // screencast: every frame the page paints, as a JPEG with the time it was painted
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(tmp, name), Buffer.from(f.data, 'base64'));
    frames.push({ name, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE, maxHeight: SIZE });
  const t0 = Date.now() / 1000;
  if (m.sound) await page.evaluate(() => window.__grabAudio?.begin());
  const end = sleep(secs * 1000);
  for (const s of steps) await play(page, s);
  await end;
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  const audio = m.sound ? await takeAudio(page) : null;
  if (mode === 'clip' && (still || !existsSync(png))) {
    await page.screenshot({ path: png });
    console.log(png);
  }
  await browser.close();

  try {
    if (!frames.length) throw new Error('no frames came in');
    // each frame lasts until the next one; the clip runs from t0 to t1
    const list = frames.map((f, i) => {
      const next = i + 1 < frames.length ? frames[i + 1].t : f.t + (t1 - frames.at(-1).t);
      return `file '${f.name}'\nduration ${Math.max(next - f.t, 0.001).toFixed(4)}`;
    });
    writeFileSync(join(tmp, 'list.txt'), list.join('\n') + `\nfile '${frames.at(-1).name}'\n`);
    console.log(`${frames.length} frames over ${(t1 - t0).toFixed(1)} s`);
    // with sound, the frames go to a silent video first and the sound is laid under it after
    const silent = audio ? join(tmp, 'silent.mp4') : mp4;
    const r = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-t', String(secs),
      '-vf', `fps=30,${mode === 'clip' && demo.crop ? `crop=${demo.crop}:${demo.crop},` : ''}scale=${m.out}:${m.out}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(m.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', silent,
    ], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
    // the sound under it, from when the page started making it
    if (audio) {
      const webm = join(tmp, 'sound.webm');
      writeFileSync(webm, Buffer.from(audio.b64, 'base64'));
      const a = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', silent, '-itsoffset', audio.late.toFixed(3), '-i', webm,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-t', String(secs), '-movflags', '+faststart', mp4,
      ], { stdio: 'inherit' });
      if (a.status !== 0) renameSync(silent, mp4);
      console.log(a.status === 0 ? `sound from ${audio.late.toFixed(2)} s` : 'no sound: muxing failed, kept the silent video');
    } else if (m.sound) console.log('no sound: the page made none');
    console.log(mp4);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
