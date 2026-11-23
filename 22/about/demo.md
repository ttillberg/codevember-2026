---
query: ?clean
warmup: 2600
ink: white
seconds: 10
---
# 22 / Echo, demo

Ten seconds on the 1984 Swedish bedroom desk: the Commodore 1702 CRT, Commodore 64C keyboard, 1541 floppy drive, Suncom TAC-2 joystick, orange telescoping lamp, Batman wall clock, and scribbled cheat sheet. The classic three-line echo program (`10 INPUT A$`, `20 PRINT A$`, `30 GOTO 10`) is typed live onto the C64, run, and echoes a greeting back—setting off 3D bedroom fireworks behind the monitor while the camera gently drifts. `pnpm grab 22 --clip` reads this file (see `scripts/clip.mjs`). Coordinates are in a 1200 × 1200 viewport.

```steps
# Kick off live typing of the 3-line echo program + celebratory fireworks!
js void (async () => { const type = async (s) => { for (const ch of s) { window.dispatchEvent(new KeyboardEvent('keydown', { key: ch })); await new Promise((r) => setTimeout(r, 52)); } window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await new Promise((r) => setTimeout(r, 260)); }; await new Promise((r) => setTimeout(r, 350)); await type('10 INPUT A$'); await type('20 PRINT A$'); await type('30 GOTO 10'); await type('RUN'); await new Promise((r) => setTimeout(r, 200)); await type('HELLO 1984'); await new Promise((r) => setTimeout(r, 1200)); await type('ECHO... ECHO...'); })()
wait 1800
drag 600,540 500,515 2800ms
wait 900
drag 500,515 620,540 2800ms
wait 1600
```
