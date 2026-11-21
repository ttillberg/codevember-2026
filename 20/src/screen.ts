import * as THREE from 'three';

// What is in there: a screen, left on, and nothing else. A terminal with a coding session running in it, the one
// this was made in, played back at its own pace: a prompt typed in the box at the bottom, a wait with something
// turning, files read, a diff, a build, agents sent off and come back, an answer, a question before a push. It goes
// round for ever. SCRIPT is what happens; edit it to change that. English, small type.

type Step =
  | { ask: string } // typed into the box, and sent
  | { wait: string; s: number } // something turning, a word for it, the seconds counted
  | { tool: string; out?: string[]; s: number } // a tool called; s seconds later, what it gave
  | { diff: string; lines: string[] } // a file changed: lines starting '+', '-' or ' '
  | { say: string } // an answer, coming a few words at a time
  | { agents: string[]; s: number } // some agents sent off; s seconds for the last to be back
  | { choose: string; opts: string[]; pick: number; s: number }; // a question, an answer picked

const SCRIPT: Step[] = [
  { ask: 'a red light inside, pulsing' },
  { wait: 'Pondering', s: 3.2 },
  { tool: 'Read(20/src/main.ts)', out: ['Read 1 184 lines'], s: 0.7 },
  { diff: '20/src/main.ts', lines: [' const inside = new THREE.PointLight(0xff2a14);', '-inside.intensity = 1;', '+// it breathes: in for 2.5 s, out for 4', '+inside.intensity = 0.55 + 0.45 * breath(time);'] },
  { say: 'It breathes now. In for two and a half seconds, out for four.' },

  { ask: "my fans are going crazy - what's burning" },
  { wait: 'Measuring', s: 4.5 },
  { tool: 'Bash(node profile.mjs)', out: ['frame 37.2 ms  ssao 9.1  rays 5.4  steel 6.0'], s: 2.4 },
  { diff: '20/src/main.ts', lines: ['-let aoOn = true;', '+let aoOn = false; // the pod has its own, baked'] },
  { tool: 'Bash(pnpm -C 20 build)', out: ['built in 771ms'], s: 1.3 },
  { say: 'Screen space AO, mostly. It is off; the pod has its own baked in. 37 ms a frame is 19.' },

  { ask: 'think of the structure as cheap but pretty' },
  { wait: 'Surveying', s: 2.6 },
  { agents: ['Explore  how the hall steel is built', 'Plan     a light frame for the far steel', 'general  time it, old against new'], s: 9 },
  { diff: '20/src/hall.ts', lines: [' const bars: THREE.Matrix4[] = [];', '+const lite: THREE.Matrix4[] = []; // far off: a light frame', '+if (far) { panel *= 3; chord *= 1.25; web *= 1.5; }', "-chunked(bars, V(16, 24, 15));", '+chunked(lite, V(64, 80, 60), farSteel); // unlit'] },
  { say: '15 400 bars for 37 500, 53 draws for 402. Only the bay round the pod is built bar by bar.' },

  { ask: 'commit' },
  { tool: 'Bash(git commit -m "feat: 20 a light frame for the far steel")', out: ['[day-20-cocoon 66e1017] 3 files changed'], s: 0.9 },
  { choose: 'Ok to push?', opts: ['Yes, push', 'Not yet'], pick: 0, s: 3.4 },
  { tool: 'Bash(git push)', out: ['9e63ae3..feb96c8  day-20-cocoon -> day-20-cocoon'], s: 2.1 },
  { choose: 'Open a pull request against main?', opts: ['Yes', 'Not yet'], pick: 1, s: 2.8 },

  { ask: 'nope. too much. just one flow from the door' },
  { wait: 'Reconsidering', s: 2.2 },
  { diff: '20/src/blood.ts', lines: ['-const MAX = 1400; // bits of the stream', '+const MAX = 8; // drops in the air at once', '-const LENGTH = 9;'] },
  { say: 'One bead at the door. It lets a drop go every second or two.' },

  { ask: 'talk to me about agents' },
  { wait: 'Thinking', s: 24 }, // (a long one: 22 s, still thinking)
  { say: 'They work while you are away. You brief one, it goes off with only what you told it, and comes back with a summary. Then you check the summary, because it sounds just as sure when it is wrong.' },
  { say: 'This one stayed. One pod, one hall: it fits in one head.' },

  { ask: 'inside there is a screen. you and me, sort of' },
  { wait: 'Cocooning', s: 11 },
  { say: 'Then this is it.' },
];

const K = 1.5; // the canvas is drawn at this many pixels a unit, so small type stays sharp close up
const W = 512 * K, H = 832 * K; // upright, as the door's opening is
const PAD = 20 * K, FONT = 11 * K, LINE = 15.5 * K, COLS = 68;
const BOX = 40 * K; // the line being typed, at the bottom
const TYPE = 17; // characters a second typed in; an answer comes four times as fast

const INK = '#e6eefc', DIM = '#7d92b3', FAINT = '#465673', WARM = '#ffb267', GREEN = '#7ad69a';
type Row = { text: string; color: string; bg?: string; lead?: [string, string] };
const SPIN = ['·', '✢', '✶', '✻', '✽', '✻', '✶', '✢'];

const wrap = (text: string, first: string, rest = ' '.repeat(first.length), cols = COLS) => {
  const out: string[] = [];
  let line = first;
  for (const word of text.split(' ')) {
    if ((line + word).length > cols && line.trim().length > first.trim().length) { out.push(line.trimEnd()); line = rest; }
    line += word + ' ';
  }
  out.push(line.trimEnd());
  return out;
};
const clip = (s: string) => (s.length > COLS ? s.slice(0, COLS - 1) + '…' : s);

/** how long a step takes, seconds */
const lasts = (st: Step): number => {
  if ('ask' in st) return 1.4 + st.ask.length / TYPE + 0.5;
  if ('wait' in st) return st.s;
  if ('tool' in st) return st.s + 0.5;
  if ('diff' in st) return 0.6 + st.lines.length * 0.09 + 0.7;
  if ('say' in st) return st.say.length / (TYPE * 4) + 0.9;
  if ('agents' in st) return st.s + 0.8;
  return st.s + 0.6;
};

/** what a step has put on the screen t seconds into it (all of it, once it is over) */
const rowsOf = (st: Step, t: number, time: number): Row[] => {
  const done = t >= lasts(st);
  if ('ask' in st) return done ? [{ text: '', color: DIM }, ...wrap(st.ask, '> ').map((text) => ({ text, color: DIM }))] : [];
  // the waiting mark turning, a word for what it is at, the seconds counted; after a while, that it is still at it
  if ('wait' in st) return done ? [] : [{ text: `${st.wait}… (${Math.floor(t)}s${t > 14 ? ' \u00b7 still thinking' : ''})`, color: WARM, lead: [SPIN[Math.floor(time * 8) % SPIN.length], WARM] }];
  if ('tool' in st) {
    const rows: Row[] = [{ text: clip(st.tool), color: INK, lead: ['●', t < st.s ? FAINT : GREEN] }];
    if (t >= st.s) for (const o of st.out ?? []) rows.push({ text: clip('  └ ' + o), color: DIM });
    return rows;
  }
  if ('diff' in st) {
    const plus = st.lines.filter((l) => l[0] === '+').length, minus = st.lines.filter((l) => l[0] === '-').length;
    const rows: Row[] = [{ text: `Update(${st.diff})`, color: INK, lead: ['●', t < 0.6 ? FAINT : GREEN] }];
    if (t < 0.6) return rows;
    rows.push({ text: `  └ ${plus} addition${plus === 1 ? '' : 's'}, ${minus} removal${minus === 1 ? '' : 's'}`, color: DIM });
    const n = Math.min(st.lines.length, Math.floor((t - 0.6) / 0.09) + 1);
    for (const l of st.lines.slice(0, n)) {
      rows.push({ text: clip('    ' + l[0] + ' ' + l.slice(1)), color: l[0] === '+' ? '#bff0cd' : l[0] === '-' ? '#f3bcc0' : DIM, bg: l[0] === '+' ? '#10301d' : l[0] === '-' ? '#3a1418' : undefined });
    }
    return rows;
  }
  if ('say' in st) {
    const n = Math.min(st.say.length, Math.floor(t * TYPE * 4));
    const lines = wrap(st.say.slice(0, done ? st.say.length : n), '', '');
    return lines.map((text, i) => ({ text: '  ' + text + (!done && i === lines.length - 1 ? '█' : ''), color: INK, lead: i === 0 ? (['●', INK] as [string, string]) : undefined }));
  }
  if ('agents' in st) {
    const back = (i: number) => t >= st.s * (0.55 + (0.45 * (i + 1)) / st.agents.length);
    const all = st.agents.every((_, i) => back(i));
    const rows: Row[] = [{ text: all ? `${st.agents.length} agents finished` : `Running ${st.agents.length} agents…`, color: INK, lead: ['●', all ? GREEN : FAINT] }];
    st.agents.forEach((a, i) => {
      const uses = Math.min(4 + i * 3 + Math.floor(t * (2.2 - i * 0.4)), 14 + i * 9);
      rows.push({ text: clip(`  ${i === st.agents.length - 1 ? '└' : '├'}─ ${a} · ${back(i) ? 'done' : uses + ' tool uses'}`), color: back(i) ? DIM : INK, lead: back(i) ? ['✓', GREEN] : undefined });
    });
    return rows;
  }
  // a question: the mark moves to the answer, and it is given
  if (done) return [{ text: st.choose, color: INK, lead: ['●', INK] }, { text: '  └ ' + st.opts[st.pick], color: DIM }];
  const on = t > st.s * 0.6 ? st.pick : 0;
  return [{ text: st.choose, color: WARM, lead: ['?', WARM] }, ...st.opts.map((o, i) => ({ text: `  ${i === on ? '❯' : ' '} ${i + 1}. ${o}`, color: i === on ? INK : DIM }))];
};

export class Screen {
  /** a monitor stood on end: a dark case, its glass, a bracket behind; facing +z */
  readonly mesh = new THREE.Group();
  readonly light = new THREE.PointLight(0xbfd6ff, 0, 2.6, 2);
  readonly height: number;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private map: THREE.CanvasTexture;
  private rows: Row[] = []; // what has gone by, oldest first
  private at = 0; // which step
  private t = 0; // seconds into it
  private drawn = '';

  constructor(readonly width = 0.62) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.map = new THREE.CanvasTexture(this.canvas);
    this.map.colorSpace = THREE.SRGBColorSpace;
    this.map.anisotropy = 8;
    this.height = (width * H) / W;
    const glass = new THREE.MeshBasicMaterial({ map: this.map });
    glass.color.setScalar(1.5); // (it is the brightest thing in there)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, this.height), glass);
    face.position.z = 0.031;
    const dark = new THREE.MeshBasicMaterial({ color: 0x050506 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, this.height + 0.05, 0.06), dark);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, this.height * 0.7, 0.2), dark);
    arm.position.z = -0.12;
    this.mesh.add(body, face, arm);
    this.light.position.set(0, 0, 0.3);
    this.mesh.add(this.light);
    // it has been on a while: the session is some way in when it is first seen
    while (this.at < 17) this.next();
    this.draw(0);
  }

  private next() {
    const st = SCRIPT[this.at];
    this.rows.push(...rowsOf(st, lasts(st), 0));
    if (this.rows.length > 120) this.rows.splice(0, this.rows.length - 120);
    this.at = (this.at + 1) % SCRIPT.length;
    this.t = 0;
  }

  /** `on`: someone can see it (it is not drawn otherwise, and nothing happens on it) */
  update(dt: number, on: boolean, time: number) {
    if (!on) { this.light.intensity = 0; return; }
    this.t += dt;
    if (this.t >= lasts(SCRIPT[this.at])) this.next();
    const mark = `${this.at}:${Math.floor(this.t * 24)}:${Math.floor(time * 8)}`;
    if (mark !== this.drawn) { this.drawn = mark; this.draw(time); }
    // its glow on what is round it, never quite steady
    this.light.intensity = 0.7 + 0.08 * Math.sin(time * 9) + 0.05 * Math.sin(time * 23);
  }

  private draw(time: number) {
    const c = this.ctx;
    c.fillStyle = '#04060a';
    c.fillRect(0, 0, W, H);
    c.font = `500 ${FONT}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    c.textBaseline = 'top';
    const cw = c.measureText('M').width;
    const st = SCRIPT[this.at];
    const rows = [...this.rows, ...rowsOf(st, Math.min(this.t, lasts(st) - 1e-3), time)];
    // what has gone by, the newest just over the box
    const foot = H - PAD - LINE * 1.5; // the line under the box
    const floor = foot - BOX - 10 * K;
    const fit = Math.floor((floor - PAD) / LINE);
    const from = Math.max(0, rows.length - fit);
    const top = floor - (rows.length - from) * LINE;
    rows.slice(from).forEach((r, i) => {
      const y = top + i * LINE;
      if (r.bg) { c.fillStyle = r.bg; c.fillRect(PAD + cw * 3, y - 2 * K, W - 2 * PAD - cw * 3, LINE); }
      if (r.lead) { c.fillStyle = r.lead[1]; c.fillText(r.lead[0], PAD, y); }
      c.fillStyle = r.color;
      c.fillText(r.text, PAD + cw * 2, y);
    });
    // the box at the bottom: the line being typed, a cursor
    c.strokeStyle = '#3d4d68';
    c.lineWidth = 1.2 * K;
    c.beginPath();
    c.roundRect(PAD - 6 * K, foot - BOX - 2 * K, W - 2 * PAD + 12 * K, BOX, 6 * K);
    c.stroke();
    const typed = 'ask' in st ? st.ask.slice(0, Math.max(0, Math.floor((this.t - 1.4) * TYPE))) : '';
    const sent = 'ask' in st && this.t > 1.4 + st.ask.length / TYPE + 0.35;
    const lines = wrap(sent ? '' : typed, '> ', '  ', COLS - 3);
    const blink = Math.floor(time * 2) % 2 === 0;
    c.fillStyle = INK;
    lines.slice(-2).forEach((text, i, all) => c.fillText(text + (i === all.length - 1 && blink ? '█' : ''), PAD + 2 * K, foot - BOX + 5 * K + i * LINE));
    c.fillStyle = FAINT;
    c.fillText('  day-20-cocoon ⇡23 · 20/', PAD, foot + 2 * K);
    // scan lines, faint
    c.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    this.map.needsUpdate = true;
  }
}
