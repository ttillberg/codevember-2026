// The pouch you hold: a little kraft-paper packet of spores at the bottom of the screen, with the specimen
// you throw on its label, held like a shooter's weapon. Only the one in hand shows. Swapping (1 to 9 and 0,
// or the wheel) drops it out of view and brings the next one up, as in Quake; it bobs
// while you crawl and jerks up when you throw. Shift and a number plants that species' specimen at the sight. Tapping the packet opens the fungarium.
import type { FungusKind } from './fungi';
import { SPECIES, type Species } from './fungarium';

const DOWN = 0.14, UP = 0.22; // seconds to drop out of view, and to come back up

export class Pouch {
  private el: HTMLElement;
  private hold: HTMLElement;
  private pic: HTMLElement;
  private label: HTMLElement;
  private thumbs = new Map<FungusKind, string>();
  private wheelAt = 0;
  private shown: FungusKind;
  private drop = 0; // 0 in hand .. 1 out of view
  private kickT = 0;
  selected: FungusKind = 'funnel';

  constructor(private onSelect: (kind: FungusKind) => void, private onPlant: (s: Species) => void, private blocked: () => boolean, private onOpen: () => void) {
    this.shown = this.selected;
    this.el = document.createElement('div');
    this.el.className = 'pouch';
    this.el.innerHTML = `
      <button class="hold" type="button" aria-label="Spores in hand; tap for the fungarium, to pick another kind">
        <svg class="paper" viewBox="0 0 120 160" aria-hidden="true">
          <defs>
            <linearGradient id="kraft" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#c49a62" /><stop offset="0.55" stop-color="#a87d48" /><stop offset="1" stop-color="#8a6236" />
            </linearGradient>
          </defs>
          <path d="M8 22 L112 20 L116 156 Q60 162 4 157 Z" fill="url(#kraft)" />
          <path d="M8 22 L112 20 L113 40 Q60 44 7 41 Z" fill="#000" opacity="0.14" />
          <path d="M7 41 Q60 44 113 40" fill="none" stroke="#f4e6c8" stroke-opacity="0.35" stroke-width="1" />
          <path d="M60 21 C 58 10, 70 6, 76 12 M60 21 C 62 10, 48 4, 44 11" fill="none" stroke="#e8dcc0" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span class="label"><span class="pic"></span><b></b><i></i><kbd></kbd></span>
      </button>`;
    this.hold = this.el.querySelector('.hold')!;
    this.pic = this.el.querySelector('.pic')!;
    this.label = this.el.querySelector('.label')!;
    this.hold.addEventListener('click', () => this.onOpen()); // the packet opens the fungarium, to pick another
    document.body.appendChild(this.el);
    this.paint();

    addEventListener('keydown', (e) => {
      if (this.blocked() || e.metaKey || e.ctrlKey || e.altKey) return;
      const m = /^Digit(\d)$/.exec(e.code);
      if (!m) return;
      const s = SPECIES[(Number(m[1]) + 9) % 10]; // 1 is the first, 0 the tenth
      if (!s) return;
      e.preventDefault();
      if (e.shiftKey) this.onPlant(s);
      else this.pick(s.kind, true);
    });
    addEventListener('wheel', (e) => {
      if (this.blocked() || Math.abs(e.deltaY) < 4) return;
      const now = performance.now();
      if (now - this.wheelAt < 140) return; // one notch, one swap
      this.wheelAt = now;
      this.cycle(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  /** The specimens, once the fungarium has drawn them. */
  setThumbs(thumbs: Map<FungusKind, string>) {
    this.thumbs = thumbs;
    this.paint();
  }

  private cycle(dir: number) {
    const n = SPECIES.length;
    const i = SPECIES.findIndex((s) => s.kind === this.selected);
    this.pick(SPECIES[(i + dir + n) % n].kind, true);
  }

  /** Take another kind in hand; `tell` passes it on (not when the fungarium is the one telling us). */
  pick(kind: FungusKind, tell: boolean) {
    this.selected = kind;
    if (tell) this.onSelect(kind);
  }

  /** A throw: the packet jerks up. */
  kick() { this.kickT = 1; }

  private paint() {
    const i = SPECIES.findIndex((x) => x.kind === this.shown);
    const s = SPECIES[i];
    const url = this.thumbs.get(s.kind);
    this.pic.style.backgroundImage = url ? `url(${url})` : '';
    (this.label.querySelector('b') as HTMLElement).textContent = s.sv;
    (this.label.querySelector('i') as HTMLElement).textContent = s.latin;
    (this.label.querySelector('kbd') as HTMLElement).textContent = String((i + 1) % 10);
  }

  /** Every frame: the swap, the bob while crawling (`phase` the gait, `walking` 0..1), the throw's jerk. */
  update(dt: number, phase: number, walking: number) {
    // swap: down while what shows is not what is selected, the label changes out of view, then up
    if (this.shown !== this.selected) {
      this.drop = Math.min(1, this.drop + dt / DOWN);
      if (this.drop >= 1) { this.shown = this.selected; this.paint(); }
    } else this.drop = Math.max(0, this.drop - dt / UP);
    const d = this.shown !== this.selected ? this.drop * this.drop : this.drop ** 3; // falls away, pops up and settles
    this.kickT = Math.max(0, this.kickT - dt * 3.2);
    const k = Math.sin(Math.min(1, this.kickT) * Math.PI) * this.kickT;
    // the bob of a hand carried by six quick legs: a small figure eight
    const bx = Math.sin(phase) * 3 * walking, by = Math.abs(Math.cos(phase)) * 3 * walking;
    this.hold.style.transform =
      `translate(${bx.toFixed(2)}px, calc(${(d * 115).toFixed(2)}% + ${(by - k * 18).toFixed(2)}px)) rotate(${(-4 + k * 5 + bx * 0.4).toFixed(2)}deg)`;
  }
}
