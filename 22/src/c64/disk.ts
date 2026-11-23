// Virtual Commodore 1541 floppy disk with built-in playable C64 BASIC V2 games
// and localStorage persistence for user SAVE / LOAD programs.

export interface DiskProgram {
  name: string;
  lines: Record<number, string>;
  builtin?: boolean;
}

const STORAGE_KEY = 'codevember-2026-day22-1541-disk-v1';

// Built-in playable C64 BASIC V2 programs stored on "GAMES DISK 84"
const BUILTIN_PROGRAMS: DiskProgram[] = [
  {
    name: 'ECHO',
    builtin: true,
    lines: {
      10: 'PRINT CHR$(147)',
      20: 'PRINT "*** ECHO CANYON ***"',
      30: 'PRINT "(PRESS ESC TO QUIT)"',
      40: 'PRINT',
      50: 'INPUT "SHOUT";A$',
      60: 'IF A$="" THEN 50',
      70: 'FOR I=1 TO 4',
      80: 'POKE 53280,14-I',
      90: 'PRINT SPC(I*3);A$;"..."',
      100: 'FOR D=1 TO 80:NEXT D',
      110: 'NEXT I',
      120: 'POKE 53280,14',
      130: 'PRINT',
      140: 'GOTO 50',
    },
  },
  {
    name: 'DODGE',
    builtin: true,
    lines: {
      10: 'POKE 53280,0:POKE 53281,0:POKE 646,13',
      20: 'PRINT CHR$(147)',
      30: 'PRINT "   *** ASTEROID DODGE ***"',
      40: 'PRINT "   A = LEFT    D = RIGHT"',
      50: 'PRINT "   PRESS ANY KEY TO FLY"',
      60: 'GET K$:IF K$="" THEN 60',
      70: 'X=18:SC=0:MX=INT(RND(1)*34)+2:MY=1',
      80: 'M2=INT(RND(1)*34)+2:Y2=-6',
      90: 'PRINT CHR$(147)',
      100: 'GET K$',
      110: 'IF K$="A" AND X>1 THEN X=X-2',
      120: 'IF K$="D" AND X<35 THEN X=X+2',
      130: 'PRINT CHR$(19);"SCORE:";SC;"   (A/D MOVE, ESC QUIT)"',
      140: 'MY=MY+1:Y2=Y2+1',
      150: 'IF MY>22 THEN MY=2:MX=INT(RND(1)*34)+2:SC=SC+10',
      160: 'IF Y2>22 THEN Y2=2:M2=INT(RND(1)*34)+2:SC=SC+10',
      170: 'POKE 1024+MY*40+MX,42:POKE 55296+MY*40+MX,7',
      180: 'IF Y2>1 THEN POKE 1024+Y2*40+M2,42:POKE 55296+Y2*40+M2,10',
      190: 'POKE 1024+22*40+X,60:POKE 1024+22*40+X+1,1:POKE 1024+22*40+X+2,62',
      200: 'POKE 55296+22*40+X,3:POKE 55296+22*40+X+1,1:POKE 55296+22*40+X+2,3',
      210: 'IF MY=22 AND ABS(MX-(X+1))<2 THEN 300',
      220: 'IF Y2=22 AND ABS(M2-(X+1))<2 THEN 300',
      230: 'FOR D=1 TO 75:NEXT D',
      240: 'POKE 1024+MY*40+MX,32',
      250: 'IF Y2>1 THEN POKE 1024+Y2*40+M2,32',
      260: 'POKE 1024+22*40+X,32:POKE 1024+22*40+X+1,32:POKE 1024+22*40+X+2,32',
      270: 'GOTO 100',
      300: 'POKE 53280,2:POKE 54296,15:POKE 54273,8:POKE 54276,33',
      310: 'PRINT CHR$(147)',
      320: 'PRINT "      *** BOOM! GAME OVER ***"',
      330: 'PRINT:PRINT "      FINAL SCORE:";SC',
      340: 'FOR D=1 TO 45:NEXT D:POKE 54276,0',
      350: 'PRINT:PRINT "      PRESS SPACE TO PLAY AGAIN"',
      360: 'GET K$:IF K$<>" " THEN 360',
      370: 'POKE 53280,0:GOTO 70',
    },
  },
  {
    name: 'GUESS',
    builtin: true,
    lines: {
      10: 'PRINT CHR$(147)',
      20: 'PRINT "  *** GUESS MY NUMBER (1-100) ***"',
      30: 'PRINT',
      40: 'N=INT(RND(1)*100)+1:T=0',
      50: 'INPUT "YOUR GUESS";G',
      60: 'T=T+1',
      70: 'IF G<N THEN PRINT "TOO LOW!":GOTO 50',
      80: 'IF G>N THEN PRINT "TOO HIGH!":GOTO 50',
      90: 'POKE 53280,5:POKE 54296,15:POKE 54273,35:POKE 54276,17',
      100: 'PRINT:PRINT "YES! IT WAS";N;"IN";T;"TRIES!"',
      110: 'FOR D=1 TO 40:NEXT D:POKE 54276,0:POKE 53280,14',
      120: 'INPUT "PLAY AGAIN (Y/N)";A$',
      130: 'IF LEFT$(A$,1)="Y" THEN 10',
      140: 'PRINT "BYE!":END',
    },
  },
  {
    name: 'CAVE',
    builtin: true,
    lines: {
      10: 'PRINT CHR$(147):POKE 53280,0:POKE 53281,0:POKE 646,3',
      20: 'PRINT "*** THE ECHO CAVE ***"',
      30: 'PRINT "COMMANDS: N, S, LOOK, SHOUT, TAKE"',
      40: 'R=1:K=0',
      50: 'PRINT',
      60: 'IF R=1 THEN PRINT "YOU STAND AT A MISTY CAVE MOUTH. PATH S."',
      70: 'IF R=2 THEN PRINT "A WIDE STONE HALL. EXITS N AND S."',
      80: 'IF R=3 THEN PRINT "A GLOWING CRYSTAL CHAMBER! EXIT N."',
      90: 'IF R=3 AND K=0 THEN PRINT "A BLUE CRYSTAL HUMS ON A LEDGE."',
      100: 'INPUT "> ";C$',
      110: 'IF C$="S" AND R<3 THEN R=R+1:GOTO 50',
      120: 'IF C$="N" AND R>1 THEN R=R-1:GOTO 50',
      130: 'IF C$="LOOK" THEN 50',
      140: 'IF C$="SHOUT" THEN PRINT "ECHO... ECHO... ECHO...":GOTO 100',
      150: 'IF C$="TAKE" AND R=3 AND K=0 THEN K=1:PRINT "THE CRYSTAL RINGS! YOU WIN!":GOTO 100',
      160: 'PRINT "NOTHING HAPPENS.":GOTO 100',
    },
  },
  {
    name: 'MAZE',
    builtin: true,
    lines: {
      10: 'POKE 53280,6:POKE 53281,6:POKE 646,14',
      20: 'PRINT CHR$(147)',
      30: 'PRINT CHR$(205.5+RND(1));',
      40: 'GOTO 30',
    },
  },
  {
    name: 'PIANO',
    builtin: true,
    lines: {
      10: 'PRINT CHR$(147):POKE 53280,0:POKE 53281,0:POKE 646,1',
      20: 'PRINT "  *** C64 SID PIANO ***"',
      30: 'PRINT "  KEYS: A S D F G H J K"',
      40: 'PRINT "  ESC = QUIT"',
      50: 'POKE 54296,15:POKE 54277,9:POKE 54278,0',
      60: 'GET K$:IF K$="" THEN 60',
      70: 'F=0',
      80: 'IF K$="A" THEN F=17',
      90: 'IF K$="S" THEN F=19',
      100: 'IF K$="D" THEN F=21',
      110: 'IF K$="F" THEN F=22',
      120: 'IF K$="G" THEN F=25',
      130: 'IF K$="H" THEN F=28',
      140: 'IF K$="J" THEN F=32',
      150: 'IF K$="K" THEN F=34',
      160: 'IF F=0 THEN 60',
      170: 'POKE 54276,16:POKE 54273,F:POKE 54276,17',
      180: 'POKE 53280,F-INT(F/14)*14+1',
      190: 'PRINT K$;" ";',
      200: 'GOTO 60',
    },
  },
  {
    name: 'AI',
    builtin: true,
    lines: {
      10: 'POKE 53280,0:POKE 53281,0:POKE 646,1:PRINT CHR$(147)',
      20: 'PRINT "   *** C64 AI AGENT V0.64 ***"',
      30: 'PRINT "   64K CONTEXT  38911 TOKENS FREE"',
      40: 'PRINT:PRINT "   CHOOSE YOUR MODEL:"',
      50: 'PRINT "   1) CLAUDE 64"',
      60: 'PRINT "   2) GEMINI 64"',
      70: 'PRINT "   3) CODEX 64"',
      80: 'PRINT:INPUT "MODEL (1-3)";M',
      90: 'IF M<1 OR M>3 THEN 80',
      100: 'IF M=1 THEN N$="CLAUDE":C=8:TC=10',
      110: 'IF M=2 THEN N$="GEMINI":C=14:TC=3',
      120: 'IF M=3 THEN N$="CODEX":C=5:TC=13',
      130: 'POKE 53280,C:POKE 646,TC:TK=38911',
      140: 'PRINT CHR$(147);"*** ";N$;" 64 ONLINE (ESC TO QUIT) ***"',
      150: 'POKE 646,1:PRINT',
      160: 'INPUT "> ";Q$',
      170: 'IF Q$="" THEN 160',
      180: 'POKE 646,TC:PRINT "* THINKING";',
      190: 'POKE 54296,12:POKE 54277,3:POKE 54278,0',
      200: 'FOR I=1 TO 4:PRINT ".";',
      210: 'POKE 54276,16:POKE 54273,18+I*4:POKE 54276,17',
      220: 'FOR D=1 TO 45:NEXT D:NEXT I:PRINT',
      230: 'TK=TK-LEN(Q$)*17-120:IF TK<0 THEN TK=38911:PRINT "(CONTEXT COMPACTED!)"',
      240: 'POKE 646,1:R=INT(RND(1)*4)+1',
      250: 'IF Q$="ECHO" THEN PRINT N$;": 10 INPUT A$:20 PRINT A$:30 GOTO 10":GOTO 460',
      260: 'IF LEFT$(Q$,2)="HI" OR LEFT$(Q$,5)="HELLO" THEN PRINT N$;": READY TO SHIP IN 64K!":GOTO 460',
      270: 'IF LEFT$(Q$,3)="FIX" OR LEFT$(Q$,3)="BUG" THEN PRINT N$;": FIXED! (MAYBE 2 NEW BUGS)":GOTO 460',
      280: 'ON M GOTO 300,350,400',
      300: 'IF R=1 THEN PRINT "CLAUDE: YOU ARE ABSOLUTELY RIGHT ABOUT"',
      305: 'IF R=1 THEN PRINT "  ";Q$;"!"',
      310: 'IF R=2 THEN PRINT "CLAUDE: LET ME REFACTOR ";Q$;" INTO 12 FILES."',
      320: 'IF R=3 THEN PRINT "CLAUDE: GREAT CATCH ON ";Q$;"! SO SUBTLE."',
      330: 'IF R=4 THEN PRINT "CLAUDE: APOLOGIES! REWRITING ";Q$;"..."',
      340: 'GOTO 460',
      350: 'IF R=1 THEN PRINT "GEMINI: REASONING OVER ";Q$;" IN 1 PASS..."',
      360: 'IF R=2 THEN PRINT "GEMINI: HERE ARE 3 ANGLES ON ";Q$;":"',
      370: 'IF R=3 THEN PRINT "GEMINI: DEEP THINKING ABOUT ";Q$;" -> DONE!"',
      380: 'IF R=4 THEN PRINT "GEMINI: MULTIMODAL ";Q$;" SYNTHESIZED!"',
      390: 'GOTO 460',
      400: 'IF R=1 THEN PRINT "CODEX: GREPPED ";Q$;". PATCH APPLIED."',
      410: 'IF R=2 THEN PRINT "CODEX: RUNNING TESTS ON ";Q$;"... GREEN!"',
      420: 'IF R=3 THEN PRINT "CODEX: 1. PLAN ";Q$;" 2. SHIP IT."',
      430: 'IF R=4 THEN PRINT "CODEX: DIFF READY FOR ";Q$;". LGTM."',
      460: 'POKE 646,12:PRINT "  [";TK;" TOKENS LEFT]":POKE 646,1:PRINT',
      470: 'GOTO 160',
    },
  },
];

export class C64FloppyDisk {
  readonly diskTitle = 'GAMES DISK 84   ';
  readonly diskId = '22 2A';
  inserted = true;

  private programs = new Map<string, DiskProgram>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    this.programs.clear();
    for (const p of BUILTIN_PROGRAMS) {
      this.programs.set(p.name, { name: p.name, lines: { ...p.lines }, builtin: true });
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as unknown;
        if (Array.isArray(saved)) {
          for (const p of saved) {
            if (!p || typeof p !== 'object' || typeof (p as DiskProgram).name !== 'string') continue;
            const rawLines = (p as DiskProgram).lines;
            if (!rawLines || typeof rawLines !== 'object' || Array.isArray(rawLines)) continue;
            const cleanLines: Record<number, string> = {};
            for (const [k, v] of Object.entries(rawLines)) {
              const ln = Number(k);
              if (Number.isInteger(ln) && ln >= 0 && ln <= 63999 && typeof v === 'string') {
                cleanLines[ln] = v;
              }
            }
            const upper = (p as DiskProgram).name.trim().toUpperCase();
            if (upper) {
              this.programs.set(upper, { name: upper, lines: cleanLines });
            }
          }
        }
      }
    } catch {
      // Ignore storage restrictions
    }
  }

  private persistUserPrograms() {
    try {
      const custom: DiskProgram[] = [];
      for (const prog of this.programs.values()) {
        if (!prog.builtin) custom.push(prog);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch {
      // Ignore quota/private mode errors
    }
  }

  listEntries(): { name: string; blocks: number }[] {
    const out: { name: string; blocks: number }[] = [];
    for (const prog of this.programs.values()) {
      const chars = Object.values(prog.lines).reduce((acc, s) => acc + s.length + 6, 0);
      const blocks = Math.max(1, Math.ceil(chars / 120));
      out.push({ name: prog.name, blocks });
    }
    return out;
  }

  /** Format an authentic Commodore 1541 directory listing (for LOAD "$",8 + LIST). */
  formatDirectory(): string[] {
    const entries = this.listEntries();
    const usedBlocks = entries.reduce((a, e) => a + e.blocks, 0);
    const freeBlocks = Math.max(0, 664 - usedBlocks);

    // Reverse video disk header using PETSCII RVS ON (18) / RVS OFF (146)
    const header = `0 ${String.fromCharCode(18)}"${this.diskTitle}" ${this.diskId}${String.fromCharCode(146)}`;
    const lines = [header];
    for (const e of entries) {
      const numCol = String(e.blocks).padEnd(5, ' ');
      const quoted = `"${e.name}"`.padEnd(19, ' ');
      lines.push(`${numCol}${quoted}PRG`);
    }
    lines.push(`${freeBlocks} BLOCKS FREE.`);
    return lines;
  }

  find(pattern: string): DiskProgram | null {
    const clean = pattern.trim().toUpperCase().replace(/^0:/, '');
    if (!clean || clean === '*') {
      const first = this.programs.values().next();
      return first.done ? null : first.value;
    }
    // Exact match first
    const exact = this.programs.get(clean);
    if (exact) return exact;

    // Wildcard prefix match e.g. "DOD*"
    const starIdx = clean.indexOf('*');
    if (starIdx >= 0) {
      const prefix = clean.slice(0, starIdx);
      for (const prog of this.programs.values()) {
        if (prog.name.startsWith(prefix)) return prog;
      }
    }
    return null;
  }

  save(rawName: string, programMap: Map<number, string>): { ok: boolean; error?: string; name: string } {
    const overwrite = rawName.trim().startsWith('@');
    const clean = rawName
      .trim()
      .replace(/^@/, '')
      .replace(/^0:/, '')
      .toUpperCase()
      .slice(0, 16);

    if (!clean || clean === '$') {
      return { ok: false, error: 'SYNTAX', name: clean };
    }
    if (this.programs.has(clean) && !overwrite) {
      // Allow easy overwrite on a virtual disk for smooth UX, or replace cleanly
    }
    const lines: Record<number, string> = {};
    for (const [k, v] of programMap) lines[k] = v;

    this.programs.set(clean, { name: clean, lines, builtin: false });
    this.persistUserPrograms();
    return { ok: true, name: clean };
  }
}
