// The fungarium: a sheet of field-book paper with a grid, one cell per species, each with a little rendered
// specimen and its names. Open a cell for the specimen large, turning slowly, growing up out of nothing:
// "Grow again" replays it (handy for tuning the growth), "Throw these" makes it what your spores grow.
// It has its own small renderer and scene, lit like the forest at dusk but with no shadow map.
import * as THREE from 'three';
import { Fungi, type FungusKind } from './fungi';

export interface Species { kind: FungusKind; sv: string; en: string; latin: string; note: string; seed: number; scale: number }

export const SPECIES: Species[] = [
  {
    kind: 'funnel', sv: 'Trattkantarell', en: 'Yellowfoot', latin: 'Craterellus tubaeformis', seed: 11, scale: 1.1,
    note: 'In clusters in mossy spruce forest, late autumn. A hollow yellow stem flaring into a dark funnel with a wavy rim; pale grey ridges underneath.',
  },
  {
    kind: 'finger', sv: 'Kamfingersvamp', en: 'Crested coral', latin: 'Clavulina cristata', seed: 5, scale: 1.0,
    note: 'Little branching tufts in moss and needle litter under spruce. Thin wandering fingers, white to golden, forking at the tips.',
  },
  {
    kind: 'chanterelle', sv: 'Kantarell', en: 'Chanterelle', latin: 'Cantharellus cibarius', seed: 7, scale: 1.0,
    note: 'Egg-yolk yellow all through, in mossy spruce and birch forest from summer into autumn. A fleshy cap with a dip in the middle and a thick, wavy, rolled rim; blunt forking ridges run down the stem instead of gills.',
  },
  {
    kind: 'puffball', sv: 'Vårtig röksvamp', en: 'Common puffball', latin: 'Lycoperdon perlatum', seed: 3, scale: 1.0,
    note: 'Little white pears covered in warts, in moss and needle litter. Ripe, they brown and open a pore at the top: in the forest, tap one or crawl into it and it puffs out a cloud of spores.',
  },
  {
    kind: 'agaric', sv: 'Röd flugsvamp', en: 'Fly agaric', latin: 'Amanita muscaria', seed: 4, scale: 1.0,
    note: 'In mossy birch and spruce forest, late summer into autumn. It comes up as a white egg; the red cap breaks through the veil, which stays on it as white warts, and leaves a skirt hanging on the stem. Poisonous.',
  },
];

export class Fungarium {
  private el: HTMLElement;
  private grid: HTMLElement;
  private detail: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.001, 10);
  private fungi: Fungi | null = null;
  private uniforms: Record<string, { value: unknown }>;
  private current: Species | null = null;
  private spin = 0;
  private raf = 0;
  private last = 0;
  selected: FungusKind = 'funnel';
  isOpen = false;
  /** Each species' specimen as an image, once drawn (for the bar at the bottom too). */
  thumbs = new Map<FungusKind, string>();

  constructor(private onSelect: (kind: FungusKind) => void) {
    // lit like the forest at dusk, from the side and a little behind so the flesh glows, no shadow map
    const L = new THREE.Vector3(0.7, 0.35, -0.55).normalize();
    this.uniforms = {
      uCavityAO: { value: 0 }, uLightDir: { value: L }, uLightDirC: { value: L }, uRimDir: { value: L }, uRim: { value: 1.6 },
      uHemi: { value: 1 }, uTone: { value: 2 }, uExposure: { value: 1.5 }, toneMappingExposure: { value: 1 },
      uShadowMap: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowFloor: { value: 1 },
      uTime: { value: 0 },
    };
    this.el = document.createElement('div');
    this.el.className = 'fungarium';
    this.el.innerHTML = `
      <div class="sheet">
        <button class="close" type="button" aria-label="Close">×</button>
        <header><b>Fungarium</b><i>What your spores can grow. Pick one to see it grow, and to throw it.</i></header>
        <div class="grid"></div>
        <div class="detail" hidden>
          <button class="back" type="button">← All</button>
          <canvas></canvas>
          <div class="names"><b></b><i></i><em></em></div>
          <p></p>
          <div class="acts"><button class="regrow" type="button">Grow again</button><button class="pick" type="button">Throw these</button></div>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    this.grid = this.el.querySelector('.grid')!;
    this.detail = this.el.querySelector('.detail')!;
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.querySelector('.back')!.addEventListener('click', () => this.showGrid());
    this.el.querySelector('.regrow')!.addEventListener('click', () => this.current && this.plant(this.current, false));
    this.el.querySelector('.pick')!.addEventListener('click', () => {
      if (!this.current) return;
      this.select(this.current.kind);
      this.onSelect(this.selected);
      this.close();
    });
    for (const s of SPECIES) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.kind = s.kind;
      cell.innerHTML = `<span class="pic"></span><b>${s.sv}</b><i>${s.latin}</i>`;
      cell.addEventListener('click', () => this.showDetail(s));
      this.grid.appendChild(cell);
    }
    this.markSelected();
  }

  /** Draw the specimens now (they are otherwise drawn the first time the sheet opens). */
  drawThumbs() { this.ensureRenderer(); return this.thumbs; }

  /** Mark this species as the one your spores grow, without telling anyone. */
  select(kind: FungusKind) {
    this.selected = kind;
    this.markSelected();
  }

  private ensureRenderer() {
    if (this.renderer) return;
    const canvas = this.el.querySelector<HTMLCanvasElement>('.detail canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.fungi = new Fungi((m) => { for (const k of Object.keys(this.uniforms)) m.uniforms[k] = this.uniforms[k]; });
    this.scene.add(this.fungi.group);
    this.thumbnails();
  }

  /** One grown specimen per species, drawn once into each grid cell. */
  private thumbnails() {
    const r = this.renderer!;
    const size = 220;
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    for (const s of SPECIES) {
      this.plant(s, true);
      this.frame(0.6);
      r.render(this.scene, this.camera);
      const url = r.domElement.toDataURL('image/png');
      this.thumbs.set(s.kind, url);
      const pic = this.grid.querySelector<HTMLElement>(`.cell[data-kind="${s.kind}"] .pic`)!;
      pic.style.backgroundImage = `url(${url})`;
    }
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
  }

  /** Put this species' cluster in the middle, grown or growing from nothing. */
  private plant(s: Species, grown: boolean) {
    const f = this.fungi!;
    for (const c of [...f.list]) f.remove(c);
    f.spawn(s.kind, 0, 0, 0, { grown, seed: s.seed, scale: s.scale });
    this.current = s;
  }

  /** Frame the camera on the cluster from a turn angle. */
  private frame(turn: number) {
    const c = this.fungi!.list[0];
    const h = c ? Math.max(c.height, 0.04) : 0.08;
    const d = h * 3.1;
    this.camera.position.set(Math.sin(turn) * d, h * 0.75, Math.cos(turn) * d);
    this.camera.lookAt(0, h * 0.42, 0);
  }

  private showDetail(s: Species) {
    this.grid.hidden = true;
    this.el.querySelector('header')!.hidden = true;
    this.detail.hidden = false;
    (this.detail.querySelector('.names b') as HTMLElement).textContent = s.sv;
    (this.detail.querySelector('.names i') as HTMLElement).textContent = s.latin;
    (this.detail.querySelector('.names em') as HTMLElement).textContent = s.en;
    (this.detail.querySelector('p') as HTMLElement).textContent = s.note;
    (this.detail.querySelector('.pick') as HTMLElement).textContent = this.selected === s.kind ? 'Throwing these' : 'Throw these';
    this.resize();
    this.plant(s, false);
    this.spin = 0.4;
  }

  private showGrid() {
    this.detail.hidden = true;
    this.grid.hidden = false;
    this.el.querySelector('header')!.hidden = false;
  }

  private markSelected() {
    for (const c of this.grid.querySelectorAll<HTMLElement>('.cell')) c.classList.toggle('on', c.dataset.kind === this.selected);
  }

  /** Square, as wide as the sheet allows but never more than half the screen's height, so the names and the
   * buttons always show under it. */
  private resize() {
    const r = this.renderer!;
    const canvas = r.domElement;
    const w = Math.round(Math.min(this.detail.clientWidth || 300, innerHeight * 0.5));
    canvas.style.width = canvas.style.height = `${w}px`;
    r.setSize(w, w, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }

  open() {
    this.ensureRenderer();
    this.el.classList.add('open');
    this.isOpen = true;
    this.showGrid();
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.isOpen) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!this.detail.hidden) {
        this.uniforms.uTime.value = (this.uniforms.uTime.value as number) + dt;
        this.fungi!.update(dt, this.uniforms.uTime.value as number);
        this.spin += dt * 0.25;
        this.frame(this.spin);
        this.renderer!.render(this.scene, this.camera);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    this.el.classList.remove('open');
    this.isOpen = false;
    cancelAnimationFrame(this.raf);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
}
