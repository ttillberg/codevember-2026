# Guidelines

## Layout

```
01/ … 30/        one folder per day, two-digit, zero-padded
template/        copied by `pnpm new NN`, never built or deployed
scripts/         new.mjs (scaffold), build.mjs (build all + index + README), words.mjs (prompt list)
docs/            this
dist/            build output, gitignored
.github/         deploy workflow
```

Each day is a standalone Vite + TypeScript project with its own `package.json`, `vite.config.ts`, `index.html` and `src/`. Days never import from each other. There is no shared package. If you copy the same helper three times, then talk about it.

## Create a day

```sh
pnpm new 07        # copies template/ → 07/, fills in day, word, date
pnpm install       # links the new workspace package
pnpm -C 07 dev     # http://localhost:5173
```

Add deps per day: `pnpm -C 07 add three`.

## Metadata

Lives in each day's `package.json`:

```json
{
  "name": "day-07",
  "description": "Hollow",
  "codevember": { "day": 7, "word": "Hollow", "date": "2026-11-07" }
}
```

`description` is what the root index shows under the word. Change it to a one-liner about the experiment. `codevember.word` is the prompt word and stays as is.

Each day also has a short `README.md`: what it is, what was tried, what was learned. The build does not read it.

Optional `NN/screengrab.png`: a square shot of the experiment, no UI, 1200 × 1200. The build copies it to `dist/NN/screengrab.png`, the index shows it in the day's square, and the day's `index.html` can point `og:image` at `https://ttillberg.github.io/codevember-2026/NN/screengrab.png`.

## Process captures

Every day keeps a trail of its own making in `NN/process/` (gitignored), for timelapses:

```sh
pnpm grab 08                  # screenshot of the dev server (http://localhost:5173/), 1280 × 800
pnpm grab 08 --video 6        # 6 s clip, mp4 through ffmpeg
pnpm grab 08 --url http://localhost:5174/ --wait 3000
pnpm grab 08 --next png       # print the next file name, to save a shot taken another way
pnpm grab 08 --timelapse      # stitch every png into NN/process/NN-timelapse.mp4
```

Files are numbered in order: `NN-0001-YYYYMMDD-HHMMSS.png`. Same viewport every time so the frames line up. Grab whenever something visibly changes: a first light, a new look, a fix you can see. A clip when the change is motion. The dev server must be running; headless system Chrome, WebGPU included.

## Build and deploy

```sh
pnpm build
```

Runs, in order:

1. `vite build` in each `NN/` with `CODEVEMBER_BASE=/codevember-2026/NN/`, copied to `dist/NN/`
2. generates `dist/index.html`: a white page with a square per day of the month, linked once built, showing its screengrab
3. rewrites the table in the root `README.md` between `<!-- days:start -->` and `<!-- days:end -->`

Commit the README change. CI runs the same command on push to `main` and deploys `dist/` to GitHub Pages via Actions. One day failing to build fails the whole deploy, on purpose.

Live: https://ttillberg.github.io/codevember-2026/

## Conventions

- Code, comments, commit messages in English.
- Commits: `feat: day 07 hollow`, `fix: 03 resize on mobile`. Lowercase, imperative, short.
- No typecheck in CI. Vite only transpiles. Run `pnpm -C 07 exec tsc` yourself if you care.
- Vite config per day is deliberately duplicated. Don't centralise it.
- Keep the `.back` link in `index.html` so every day links back to the index.
