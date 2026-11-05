import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';
import { wordFor, dateFor } from './words.mjs';

const arg = process.argv[2];
const day = Number(arg);
if (!arg || !Number.isInteger(day) || day < 1 || day > 30) {
  console.error('usage: pnpm new <01-30>');
  process.exit(1);
}

const dir = String(day).padStart(2, '0');
const dest = join(ROOT, dir);
if (existsSync(dest)) {
  console.error(`${dir}/ already exists`);
  process.exit(1);
}

const word = wordFor(day);
const date = dateFor(day);

cpSync(join(ROOT, 'template'), dest, { recursive: true });

// Fill in package.json
const pkgPath = join(dest, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = `day-${dir}`;
pkg.description = word;
pkg.codevember = { day, word, date };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Fill in README + index.html placeholders
for (const file of ['README.md', 'index.html']) {
  const p = join(dest, file);
  const txt = readFileSync(p, 'utf8')
    .replaceAll('{{DAY}}', dir)
    .replaceAll('{{WORD}}', word)
    .replaceAll('{{DATE}}', date);
  writeFileSync(p, txt);
}

console.log(`created ${dir}/ — ${word} (${date})`);
console.log(`next: pnpm install && pnpm -C ${dir} dev`);
