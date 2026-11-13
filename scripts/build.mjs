import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, REPO, HOMEPAGE, GITHUB, listDays } from './lib.mjs';
import { WORDS } from './words.mjs';
import { readDemo } from './clip.mjs';

const days = listDays();
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

// 1. Build each day with its base path, copy into dist/NN/
for (const d of days) {
  const base = `/${REPO}/${d.dir}/`;
  console.log(`\n▶ building ${d.dir} (${d.word}) base=${base}`);
  execSync('pnpm exec vite build', {
    cwd: join(ROOT, d.dir),
    stdio: 'inherit',
    env: { ...process.env, CODEVEMBER_BASE: base },
  });
  cpSync(join(ROOT, d.dir, 'dist'), join(dist, d.dir), { recursive: true });
  // optional NN/about/screengrab.png (the share image) and screengrab.mp4 (a 10 s loop for the index square,
  // the png its poster), whichever is there; a bare NN/screengrab.png still counts. Served at NN/screengrab.*
  d.screengrab = copyMedia(d.dir, 'screengrab.png');
  d.clip = copyMedia(d.dir, 'screengrab.mp4');
  // the title over it is black, or white on a dark day (ink: white in demo.md)
  d.ink = existsSync(join(ROOT, d.dir, 'about', 'demo.md')) && readDemo(d.dir).ink === 'white' ? 'white' : 'black';
}

// 2. Root index.html: a square per day of the month, the built ones linked, with their screengrab if any
const built = new Map(days.map((d) => [d.day, d]));
const squares = WORDS.map((word, i) => {
  const day = i + 1;
  const dir = String(day).padStart(2, '0');
  const d = built.get(day);
  const label = `<span class="label">${dir} ${escapeHtml(d?.word || word)}</span>`;
  if (!d) return `      <div class="sq empty">${label}</div>`;
  const poster = d.screengrab ? `./${dir}/screengrab.png` : '';
  const img = d.clip
    ? `<video src="./${dir}/screengrab.mp4"${poster ? ` poster="${poster}"` : ''} autoplay muted loop playsinline preload="auto"></video>`
    : poster ? `<img src="${poster}" alt="" loading="lazy" />` : '';
  const title = d.description && d.description !== d.word ? ` title="${escapeHtml(d.description)}"` : '';
  return `      <a class="sq${d.screengrab || d.clip ? ' has-img' : ''} ink-${d.ink}" href="./${dir}/"${title}>${img}${label}</a>`;
}).join('\n');

writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codevember 2026</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@700&family=Inter:wght@400;600&display=swap" />
  <style>
    /* the days' title block (08, 09, 12): heavy Plex capitals, Helvetica caps under it */
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #fff; color: #1c1c1c; font: 13px/1.4 Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; }
    main { max-width: 1200px; margin: 0 auto; }
    a { color: inherit; }
    h1 {
      margin: 0; white-space: nowrap;
      font: 700 56px/0.9 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      letter-spacing: -0.02em; text-transform: uppercase;
    }
    .caps { font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
    .sub { margin: 6px 0 32px; font-size: 14px; line-height: 1.15; }
    .sub a, footer a { text-decoration: none; }
    .ico { width: 0.85em; height: 0.85em; margin-right: 0.3em; vertical-align: -0.08em; fill: currentColor; }
    .sub a:hover, footer a:hover { text-decoration: underline; }
    footer { margin-top: 32px; font-size: 14px; line-height: 1.15; }
    /* edge to edge: half a hairline inside each square, so two neighbours make one line */
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .sq { position: relative; aspect-ratio: 1; display: block; overflow: hidden; box-shadow: inset 0 0 0 0.5px #e4e4e4; text-decoration: none; }
    .sq img, .sq video { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .2s ease; }
    .sq:hover img, .sq:hover video { transform: scale(1.04); }
    /* the day's title top left, in the sub line's caps */
    .label {
      position: absolute; top: 10px; left: 10px; right: 10px;
      font-size: 14px; line-height: 1.15; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    }
    .ink-black .label { color: #1c1c1c; }
    .ink-white .label { color: #f4f4f2; }
    .sq.empty { color: #bbb; }
    @media (max-width: 640px) {
      body { padding: 16px; }
      h1 { font-size: 36px; }
      .sub { font-size: 10px; margin-bottom: 24px; }
      footer { font-size: 10px; margin-top: 24px; }
      .grid { grid-template-columns: repeat(2, 1fr); }
      .label { top: 8px; left: 8px; right: 8px; font-size: 10px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Codevember 2026</h1>
    <p class="sub caps">${days.length} of 30 days · <a href="${GITHUB}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57l-.02-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>Source</a> · <a href="https://x.com/theo_t"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.6l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z"/></svg>@theo_t</a></p>
    <div class="grid">
${squares}
    </div>
    <footer class="caps">Prompt list and initiative by <a href="https://x.com/thespite">@thespite</a></footer>
  </main>
</body>
</html>
`,
);

// 3. README table between markers
const byDay = new Map(days.map((d) => [d.day, d]));
const rows = WORDS.map((word, i) => {
  const day = i + 1;
  const dir = String(day).padStart(2, '0');
  const d = byDay.get(day);
  return d
    ? `| ${dir} | ${word} | [View](${HOMEPAGE}/${dir}/) | [Code](${GITHUB}/tree/main/${dir}) |`
    : `| ${dir} | ${word} | — | — |`;
});
const table = ['| Day | Word | Experiment | Source |', '| --- | --- | --- | --- |', ...rows].join('\n');

const readmePath = join(ROOT, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const start = '<!-- days:start -->';
const end = '<!-- days:end -->';
const a = readme.indexOf(start);
const b = readme.indexOf(end);
if (a === -1 || b === -1) throw new Error('README.md is missing days:start / days:end markers');
writeFileSync(readmePath, readme.slice(0, a + start.length) + '\n' + table + '\n' + readme.slice(b));

console.log(`\n✔ built ${days.length} day(s) into dist/, README updated`);

function copyMedia(dir, name) {
  const src = [join(ROOT, dir, 'about', name), join(ROOT, dir, name)].find((p) => existsSync(p));
  if (src) cpSync(src, join(dist, dir, name));
  return Boolean(src);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
