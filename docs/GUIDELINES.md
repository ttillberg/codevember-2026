# Guidelines

## Layout

```
01/ … 30/        one folder per day, two-digit, zero-padded
template/        copied by `pnpm new NN`, never built or deployed
scripts/         new.mjs (scaffold), build.mjs (build all + index + README), grab.mjs + clip.mjs (captures), words.mjs (prompt list)
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

## About: demo, screengrab, clip

Each day has an `NN/about/` folder for how it is shown off:

```
NN/about/demo.md          the recipe: what ten seconds of this day should show, and the steps to play it
NN/about/screengrab.png   a square shot, no UI, 1200 × 1200: the share image and the index square's poster
NN/about/screengrab.mp4   a 10 s loop, 480 × 480, played in the index square
NN/about/x.mp4            a 60 s video, 1080 × 1080, for X (gitignored, never committed)
```

All optional, whichever is there is used. The build copies them to `dist/NN/screengrab.*`, so the day's `index.html` can point `og:image` at `https://ttillberg.github.io/codevember-2026/NN/screengrab.png`.

```sh
pnpm grab 08 --clip                                     # screengrab.mp4 from the live site, played by demo.md
pnpm grab 08 --clip --url http://localhost:5173/        # from the dev server instead
pnpm grab 08 --clip --still                             # and a new screengrab.png (the last frame), else only if missing
pnpm grab 08 --x                                        # x.mp4, the 60 s video
```

`demo.md` is frontmatter (`query` added to the url, `warmup` ms, `seconds`, `xseconds`, `ink: white` for a dark day so its title on the index is white), a few lines for people, then blocks of steps: ` ```setup ` (played before the clip starts) and ` ```steps ` (during it) for the index clip, ` ```x-setup ` and ` ```x ` for the X video. Steps are `drag x,y x,y … 450ms [meta|shift|alt|control]`, `move x,y`, `key Space`, `wait 1500`, in a 1200 × 1200 viewport with everything but the canvas hidden. A day with its own clean mode (`?clean`) and its own motion needs only the frontmatter. The format is documented at the top of `scripts/clip.mjs`.

Grab the clip once the day is done: every change to the day dates it. The `demo` skill (`.claude/skills/demo/`) picks what to show with you and writes `demo.md`.

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
2. generates `dist/index.html`: a white page with a square per day of the month, linked once built, playing its clip or showing its screengrab
3. rewrites the table in the root `README.md` between `<!-- days:start -->` and `<!-- days:end -->`

Commit the README change. CI runs the same command on push to `main` and deploys `dist/` to GitHub Pages via Actions. One day failing to build fails the whole deploy, on purpose.

Live: https://ttillberg.github.io/codevember-2026/

## Conventions

- Code, comments, commit messages in English.
- Commits: `feat: day 07 hollow`, `fix: 03 resize on mobile`. Lowercase, imperative, short.
- No typecheck in CI. Vite only transpiles. Run `pnpm -C 07 exec tsc` yourself if you care.
- Vite config per day is deliberately duplicated. Don't centralise it.
- Every day has the title plate, its link the way back to the index. Look, type, black or white, furniture: `docs/DESIGN.md`.
