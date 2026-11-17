# Codevember 2026

One mini project per day during November 2026, by [Theo Tillberg](https://x.com/theo_t). Not every day, and that's fine.

Following the prompt list shared by [@thespite](https://x.com/thespite/status/2116974998212772095).

Live: https://ttillberg.github.io/codevember-2026/

<!-- days:start -->
| Day | Word | Experiment | Source |
| --- | --- | --- | --- |
| 01 | Fold | [View](https://ttillberg.github.io/codevember-2026/01/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/01) |
| 02 | Shatter | — | — |
| 03 | Melt | — | — |
| 04 | Tangle | [View](https://ttillberg.github.io/codevember-2026/04/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/04) |
| 05 | Moss | [View](https://ttillberg.github.io/codevember-2026/05/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/05) |
| 06 | Orrery | [View](https://ttillberg.github.io/codevember-2026/06/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/06) |
| 07 | Hollow | [View](https://ttillberg.github.io/codevember-2026/07/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/07) |
| 08 | Tesseract | [View](https://ttillberg.github.io/codevember-2026/08/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/08) |
| 09 | Membrane | [View](https://ttillberg.github.io/codevember-2026/09/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/09) |
| 10 | Caustic | — | — |
| 11 | Rust | — | — |
| 12 | Feather | [View](https://ttillberg.github.io/codevember-2026/12/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/12) |
| 13 | Labyrinth | — | — |
| 14 | Tension | [View](https://ttillberg.github.io/codevember-2026/14/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/14) |
| 15 | Mirage | — | — |
| 16 | Spore | [View](https://ttillberg.github.io/codevember-2026/16/) | [Code](https://github.com/ttillberg/codevember-2026/tree/main/16) |
| 17 | Kelp | — | — |
| 18 | Pendulum | — | — |
| 19 | Erosion | — | — |
| 20 | Cocoon | — | — |
| 21 | Bolt | — | — |
| 22 | Echo | — | — |
| 23 | Magma | — | — |
| 24 | Nest | — | — |
| 25 | Veil | — | — |
| 26 | Anamorph | — | — |
| 27 | Burrow | — | — |
| 28 | Hive | — | — |
| 29 | Portal | — | — |
| 30 | Dissolve | — | — |
<!-- days:end -->

## Working on it

```sh
pnpm install
pnpm new 05          # scaffold day 05 from template/
pnpm -C 05 dev       # dev server for one day
pnpm build           # build every day into dist/, regenerate index + this table
```

See [docs/GUIDELINES.md](docs/GUIDELINES.md).

### Before and after

A change you can see should show itself in its pull request: one picture, before on the left and after on the right. As well as it can be done, and only where it tells something. It must cost next to nothing and never bend the code or the way of working to get it.

The cheap way is to take the first picture early. Once you know what is going to change, and before changing it, grab the view that shows it (`pnpm grab NN`, into `NN/process/`). Then work towards the result, grabbing as you go as the guidelines already ask. When it is done, the first grab and the last are the two references, for free: same view, same size.

```sh
ffmpeg -i NN/process/<first>.png -i NN/process/<last>.png -filter_complex hstack -q:v 4 NN/about/before-after.jpg
```

Commit that one file (it is written over each time, and the build does not ship it) and put it in the pull request body by its address at the commit:

```md
![before and after](https://raw.githubusercontent.com/ttillberg/codevember-2026/<commit>/NN/about/before-after.jpg)
```

Leave it out when there is nothing to see (logic, performance, docs), when the change is motion that a still does not show (a clip in `NN/process/` is enough, say so in the text), or when getting the same view twice would take real work.

## License

MIT
