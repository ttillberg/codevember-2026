# For agents

This repo is 30 small, independent experiments. Your job is usually one of them.

1. Read `docs/GUIDELINES.md`, and `docs/DESIGN.md` for how a day looks.
2. Scaffold with `pnpm new NN`, never by hand or by copying another day.
3. Work only inside `NN/`. Do not touch other days, `template/`, `scripts/` or the workflow unless asked.
4. Do not create shared packages, utils folders at the root, or abstractions across days.
5. Grab the process: `pnpm grab NN` (or `--video 5` for motion) each time the experiment visibly changes. See "Process captures" in the guidelines.
6. Before finishing: `pnpm build` must pass. Commit the README table change it produces.
7. Update the day's `README.md` and `package.json` `description` with what the experiment actually is.
   And its `about/demo.md`: what it should show in 10 s and in 60 s (the `demo` skill). Then `pnpm grab NN --clip` for the index, `--x` for X.
8. Pushing is the user's call. Show `git status` and ask.

Prompt words are in `scripts/words.mjs`. Today's word is not a rule, it is a starting point.
