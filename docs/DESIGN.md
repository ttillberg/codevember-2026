# Design

How a day looks and is put together, so thirty of them read as one month. Taken from 08, 09 and 12, which set it; the template starts here. The index page (`scripts/build.mjs`) uses the same title and type.

## The page

- One scene, full screen, nothing scrolls (a phone layout may, as 08's does). The page background is the scene's backdrop, and `<meta name="theme-color">` is that same colour.
- `<head>` as in `template/index.html`: title `NN · Word · Codevember 2026`, `description` and `og:description` the one-liner from `package.json`, `og:image` at `https://ttillberg.github.io/codevember-2026/NN/screengrab.png` (1200 square), `twitter:card` `summary_large_image`, `viewport-fit=cover`.
- Nothing on the page can be selected: `user-select: none`, no touch callout, no tap highlight, on `html, body` (the template has it). A drag belongs to the scene. Text meant to be copied opts back in.
- `?clean` hides all page furniture, title included, and leaves the scene. The recorder hides it anyway, but a day with a clean mode looks better in its own clip and screengrab.

## Black or white

A day is either light or dark, and its furniture has one ink for it:

| | backdrop | ink |
| --- | --- | --- |
| light | light grey or paper, e.g. `#e6e6e8` | `#1c1c1c` |
| dark | near black or the scene's own dark, e.g. `#0b0b0d`, `#1d3320` | `#f4f4f2` |

No greys for text that matters, no colour for the furniture: colour belongs to the scene. A day that offers both (09 with `?dark`) puts `.dark` on `<html>` and flips the ink.

## The title plate

Top left, `max(24px, safe-area)` from the corner (16 px on a phone). Two lines: the day in heavy capitals, then the way home, the prompt word in Japanese and the author's handle after it.

```html
<div class="plate"><div class="head"><b>12 Feather</b><i><a class="home" href="https://ttillberg.github.io/codevember-2026/">Codevember 2026 <span lang="ja">羽根</span></a> · <a class="home" href="https://x.com/theo_t">@theo_t</a></i></div></div>
```

- `b`: IBM Plex Sans 700, 56 px, line height 0.9, letter spacing −0.02em, uppercase. 34–36 px on a phone (`max-width: 640px`).
- `i`: Inter 600, 14 px, letter spacing 0.12em, uppercase, 6 px under the title. 9–10 px on a phone.
- The plate never takes a press (`pointer-events: none`), only the links do. It is the only way back to the index: no `.back` link.
- The way home is the absolute URL of the index, never `../`, so a copy of the day still leads back to the month. The handle after the dot links to X. `<meta name="author">` says the same in the head.
- Under the plate, a day may add one or two lines of what it is, in the same caps.

## Type

- **Titles and big headings:** IBM Plex Sans 700.
- **Everything else:** Inter, then Helvetica Neue, Helvetica, Arial. Labels, buttons and small headings in caps at 600 with 0.12em spacing; running text in sentence case at 13 px, 400.
- Both from Google Fonts in one link: `family=IBM+Plex+Sans:wght@700&family=Inter:wght@400;600&display=swap`.
- No monospace, no third face. Days 05 to 12 were made with Helvetica Neue for their furniture.

## Furniture

- **Top left:** the plate.
- **Top right:** help (`?`), full screen, view modes. Round buttons, 30–34 px, on a frosted ground (`backdrop-filter: blur(8px)`), in the ink.
- **Bottom centre:** the tool bar, if the day has tools.
- **Bottom right:** settings, a gear, only in dev or with `?settings`. The workbench for tuning, not for visitors.
- Keys have a visible key cap in the help (08's `.key`). Touch gets the same tools without keys: where the finger lands says what it does.

## About

`NN/about/` holds how the day is shown off: `demo.md` (the recipe), `screengrab.png`, `screengrab.mp4` and the gitignored `x.mp4`. See "About" in `GUIDELINES.md` and the `demo` skill.
