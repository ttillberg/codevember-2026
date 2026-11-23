# 22 / Echo

2026-11-22

A Commodore 1702 CRT monitor and 1541 floppy disk drive running a Commodore 64 BASIC V2 emulator, with an 8-year-old's scribbled cheat sheet lying in front of the screen. Inspired by a first computer program: taking input on a C64 and echoing it back.

```sh
pnpm -C 22 dev
```

## What's on the desk

- **Commodore 1702 CRT Monitor** (`src/monitor.ts`): curved 4:3 glass tube with custom CRT shader (scanlines, phosphor bloom, Fresnel glass reflection, warm-up bloom, and power-off beam collapse), live screen bounce lighting, clickable **POWER** push-button with green LED, and a flip-down smoked acrylic flap hiding interactive **COLOR / TINT / BRIGHT / CONTR** knobs.
- **Commodore 1541 Floppy Drive** (`src/drive1541.ts`, `src/c64/disk.ts`): steady green `POWER` LED, glowing/flashing red `DRIVE` access LED, stepper-motor seek sound, and a clickable drive latch that slides out the 5.25" `"GAMES DISK '84"` floppy. Pre-loaded with seven real BASIC V2 programs (`ECHO`, `DODGE`, `GUESS`, `CAVE`, `MAZE`, `PIANO`, `AI`) and `localStorage` persistence for user `SAVE`s.
- **Handwritten cheat sheet & BIC 4-Colour pen** (`src/cheatsheet.ts`, `src/bicpen.ts`): lined school notebook paper resting in front of the monitor, drawn with curved ballpoint-pen strokes and doodles giving half-finished hints rather than the full answer, with a clickable two-tone blue/white BIC 4-Colour pen beside it (clicks through Blue, Red, Green, Black). Click the paper (or `?`) to pick it up beside the CRT while you type.
- **Commodore 64C & Suncom TAC-2 Joystick** (`src/c64breadbin.ts`, `src/tac2.ts`): sleek cream-beige C64C with full-width horizontal rear cooling louvers, 66 sculpted cylindrical-dished keycaps with dual legends & front-face PETSCII graphics, dark-taupe F-keys, recessed lower-right `commodore 64 PERSONAL COMPUTER` badge, and live animated keycaps as you type (also clickable in 3D), plus a Suncom TAC-2 joystick wired into Control Port 1 (rounded black casing, brushed-silver volcano collar with 8 black-and-red T-markings, twin concave vermilion-orange fire buttons, and glossy black ball-top that tilts and clicks on arrow/WASD/Space keys or direct clicks) alongside monitor video/audio, 1541 serial IEC, and power cables.
- **1984 Swedish bedroom desk, orange lamp & wall clock** (`src/room.ts`, `src/lamp.ts`, `src/clock.ts`, `src/sketches.ts`): stained wood desk with subtle hairline knife cuts and old tape marks, heritage *småblommig* Swedish wallpaper, a Blender-modeled burnt-orange telescoping desk lamp (`model/lamp.py` → `public/lamp.glb`, clickable to toggle warm lighting vs. late-night CRT-glow mode), a high-mounted 1980s Batman wall clock keeping real local time (click to toggle soft quartz ticking), and scattered 8-year-old game sketches off to the left.

## C64 BASIC V2 & shortcuts

- Full 40×25 PETSCII screen editor with authentic 8×8 ROM bitmaps and 16-color Colodore palette (`src/c64/charset.ts`, `src/c64/screen.ts`).
- Interpreter (`src/c64/basic.ts`) supports `PRINT`/`?`, `INPUT`, `GET`, `GOTO`, `GOSUB`/`RETURN`, `FOR`/`NEXT`, `IF`/`THEN`, `DIM`, `DATA`/`READ`/`RESTORE`, `LIST`, `RUN`, `NEW`, `CLR`, `CONT`, `LOAD`/`SAVE`/`VERIFY` on device `8`, `SYS 64738` reset, VIC-II `POKE`s (`53280`, `53281`, `646`, `1024+`, `55296+`), and SID Voice 1 ADSR synth (`54272..54296`).
- **`Esc`** or **`Ctrl+C`** — `RUN/STOP` (quit any loop and silence SID)
- **`Ctrl+L`** — clear screen (`CLR`)
- **`Cmd+C`** (`Ctrl+Shift+C`) — copy the whole BASIC program (`LIST`) to clipboard
- **`Cmd+V`** (`Ctrl+V`) — paste single lines or full multi-line BASIC listings directly into memory
- **Double-click screen** (or top-right focus button) — zoom between desk view and close-up typing view
