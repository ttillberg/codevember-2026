---
name: demo
description: Plan and record how a Codevember day is shown off — pick its key points, grill the user on what to show and how, write NN/about/demo.md, then record the 10 s index clip and the 60 s X video. Use when the user says "demo", "show off", "clip", "video for X", "screengrab video" or names a day to film.
---

# Demo a day

Goal: `NN/about/demo.md` that the recorder plays, and from it `NN/about/screengrab.mp4` (10 s index loop, committed) and `NN/about/x.mp4` (60 s for X, gitignored). The format of `demo.md` is documented at the top of `scripts/clip.mjs`. Read it first.

## 1. Learn the day

- `NN/README.md`, `NN/package.json` description, the existing `NN/about/demo.md` if any.
- The controls: grep `NN/src` for `pointerdown`, `keydown`, `URLSearchParams`. Note keys, modifier drags, and any clean/demo/attract mode (`?clean`, `?probe`, `?demo`...).
- Look at it: open `https://ttillberg.github.io/codevember-2026/NN/` (or the dev server) at 1200 × 1200 and screenshot it. The recorder hides everything but the canvas, so judge the canvas alone.

## 2. Pick the key points

From the README and what you saw, list 3–5 things worth showing: what is unique, what moves, what a hand does to it, the best-looking state. Short, concrete, one line each. Say which one you would lead with.

## 3. Grill the user

One question at a time (AskUserQuestion), your recommendation first. Do not move on until each is settled. Cover:

- **The index clip (10 s, loops, 480 px square, no sound):** one idea only. What it opens on, what happens, does the loop seam matter.
- **The X video (60 s, 1080 square):** the hook in the first 3 s, then 3–4 beats in order, ending on the strongest frame. Which key points make the cut.
- **How each beat is driven:** the day's own motion, a `?clean`-style mode, a scripted hand (`drag`, `key`, `wait`), or a `setup` block that prepares the state off camera. If a scripted hand would be fragile, propose adding a `?demo` mode to the day instead, and ask.
- **Settings:** query string, warmup, anything random that should be pinned for the shot.

## 4. Write demo.md

Frontmatter (`query`, `warmup`, `seconds`, `xseconds`), a few lines for people saying what the clip and the video show, then the blocks: `setup` and `steps` for the index clip, `x-setup` and `x` for the X video. Coordinates are in the 1200 × 1200 viewport; take them from your screenshot. Comment the steps with `#`.

## 5. Record and review

```sh
pnpm grab NN --clip            # about/screengrab.mp4 (and screengrab.png if missing; --still to replace it)
pnpm grab NN --x               # about/x.mp4
pnpm grab NN --clip --url http://localhost:5173/    # from the dev server, for unpushed work
```

Check each before showing it: a contact strip, then read the image.

```sh
ffmpeg -y -loglevel error -i NN/about/screengrab.mp4 -vf "fps=1/2,scale=200:200,tile=5x1" -frames:v 1 <scratchpad>/NN-strip.png
ffmpeg -y -loglevel error -i NN/about/x.mp4 -vf "fps=1/6,scale=200:200,tile=5x2" -frames:v 1 <scratchpad>/NN-x-strip.png
```

Black or blank first frames: raise `warmup`. A hand that misses: fix the coordinates from a screenshot. After three tries that still miss, stop and ask (a `?demo` mode in the day is usually the answer).

## 6. Hand over

`pnpm build`, look at the index (`.claude/launch.json` has `index`, port 4174). Show the strips and the path of `x.mp4`. Do not commit until the user has looked; `x.mp4` is never committed.
