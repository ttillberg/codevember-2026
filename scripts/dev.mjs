// `pnpm dev` from the repo root: runs a day's dev server, the day taken from, in order,
//   pnpm dev 18                  the argument
//   a day-NN-word branch         the worktree a day session works in
// Inside a day's folder `pnpm dev` is that day's own script and never gets here.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const arg = process.argv[2];
const branch = spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const n = Number(arg ?? branch.match(/^day-(\d{2})-/)?.[1]);
const dir = String(n).padStart(2, '0');
if (!Number.isInteger(n) || !existsSync(join(ROOT, dir, 'package.json'))) {
  console.error(`which day? pnpm dev <NN>, or run it in a day-NN-word branch (this is ${branch || 'no branch'})`);
  process.exit(1);
}
const r = spawnSync('pnpm', ['-C', dir, 'dev', ...process.argv.slice(arg ? 3 : 2)], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status ?? 1);
