import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, REPO, HOMEPAGE, GITHUB, listDays } from './lib.mjs';
import { WORDS } from './words.mjs';

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
  // optional NN/screengrab.png: the day's share image and its square on the index
  d.screengrab = existsSync(join(ROOT, d.dir, 'screengrab.png'));
  if (d.screengrab) cpSync(join(ROOT, d.dir, 'screengrab.png'), join(dist, d.dir, 'screengrab.png'));
}

// 2. Root index.html: a square per day of the month, the built ones linked, with their screengrab if any
const built = new Map(days.map((d) => [d.day, d]));
const squares = WORDS.map((word, i) => {
  const day = i + 1;
  const dir = String(day).padStart(2, '0');
  const d = built.get(day);
  const label = `<span class="label"><span class="day">${dir}</span> ${escapeHtml(d?.word || word)}</span>`;
  if (!d) return `      <div class="sq empty">${label}</div>`;
  const img = d.screengrab ? `<img src="./${dir}/screengrab.png" alt="" loading="lazy" />` : '';
  const title = d.description && d.description !== d.word ? ` title="${escapeHtml(d.description)}"` : '';
  return `      <a class="sq${d.screengrab ? ' has-img' : ''}" href="./${dir}/"${title}>${img}${label}</a>`;
}).join('\n');

writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codevember 2026</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 40px 16px; background: #fff; color: #111; font: 13px/1.4 ui-monospace, Menlo, monospace; }
    main { max-width: 1080px; margin: 0 auto; }
    h1 { font-size: 13px; font-weight: 400; margin: 0 0 4px; }
    p { margin: 0 0 24px; color: #888; }
    a { color: inherit; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .sq { position: relative; aspect-ratio: 1; display: block; overflow: hidden; border: 1px solid #e4e4e4; text-decoration: none; }
    .sq img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .2s ease; }
    .sq:hover img { transform: scale(1.04); }
    a.sq:hover { border-color: #111; }
    .label { position: absolute; left: 8px; bottom: 6px; font-size: 11px; }
    .sq.has-img .label { color: #111; background: rgba(255, 255, 255, .8); padding: 1px 4px; }
    .day { color: #888; }
    .sq.empty { color: #bbb; border-style: dashed; }
    footer { margin-top: 40px; color: #888; }
  </style>
</head>
<body>
  <main>
    <h1>Codevember 2026</h1>
    <p>${days.length} of 30 days. <a href="${GITHUB}">Source</a>.</p>
    <div class="grid">
${squares}
    </div>
    <footer>Prompt list by <a href="https://x.com/thespite">@thespite</a>.</footer>
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

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
