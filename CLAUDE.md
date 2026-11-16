# Codevember 2026

Read `docs/AGENTS.md` first, then `docs/GUIDELINES.md` and `docs/DESIGN.md`. They describe how a day is created, built and deployed. Do not improvise structure.

## Naming

A session that works on a day is named `day-NN-word`: the day zero-padded, the prompt word in lowercase, from `scripts/words.mjs`. Day 12 is `day-12-feather`, day 26 `day-26-anamorph`.

- Set it as soon as you know the day: the session title (the app's `set_session_title` tool, when there is one), the worktree and its branch.
- A second piece of work on the same day adds what it is: `day-12-feather-labels`.
- Work across days or on the repo itself (index, scripts, docs) is not a day and needs no such name.
