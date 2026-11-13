---
query:
warmup: 8000
seconds: 10
---
# {{DAY}} / {{WORD}}, demo

How to show this day off in ten seconds: what the clip on the index plays. `pnpm grab {{DAY}} --clip` reads this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport.

```steps
wait 1000
```
