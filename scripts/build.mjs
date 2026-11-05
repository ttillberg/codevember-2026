import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
}

// 2. Root index.html
const cards = days
  .map(
    (d) => `      <a class="card" href="./${d.dir}/">
        <span class="day">${d.dir}</span>
        <span class="word">${d.word}</span>
        ${d.description && d.description !== d.word ? `<span class="desc">${escapeHtml(d.description)}</span>` : ''}
      </a>`,
  )
  .join('\n');

writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codevember 2026</title>
  <style>
    :root { color-scheme: dark; --bg: #0b0b0d; --fg: #e8e8ea; --muted: #7a7a82; --card: #15151a; --accent: #ffb547; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 48px 24px; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-monospace, Menlo, monospace; }
    main { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
    p { margin: 0 0 32px; color: var(--muted); }
    a { color: inherit; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 2px; padding: 16px; background: var(--card); border-radius: 8px; text-decoration: none; transition: transform .12s ease, background .12s ease; }
    .card:hover { transform: translateY(-2px); background: #1c1c23; }
    .day { color: var(--accent); font-size: 12px; }
    .word { font-size: 17px; font-weight: 600; }
    .desc { color: var(--muted); font-size: 12px; }
    footer { margin-top: 48px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Codevember 2026</h1>
    <p>${days.length} of 30 days. <a href="${GITHUB}">Source</a>.</p>
    <div class="grid">
${cards}
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
