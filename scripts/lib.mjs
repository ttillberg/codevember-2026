import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('..', import.meta.url).pathname;
export const DAY_RE = /^\d{2}$/;

export const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
export const REPO = rootPkg.name;
export const HOMEPAGE = rootPkg.homepage.replace(/\/$/, '');
export const GITHUB = `https://github.com/${rootPkg.repository.replace(/^github:/, '')}`;

/** All day folders present on disk, sorted, with their package.json metadata. */
export function listDays() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DAY_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .filter((name) => existsSync(join(ROOT, name, 'package.json')))
    .map((name) => {
      const pkg = JSON.parse(readFileSync(join(ROOT, name, 'package.json'), 'utf8'));
      const meta = pkg.codevember ?? {};
      return {
        dir: name,
        day: Number(name),
        word: meta.word ?? '',
        date: meta.date ?? '',
        description: pkg.description ?? '',
      };
    });
}
