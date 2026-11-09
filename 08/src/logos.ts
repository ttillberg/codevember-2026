// The real marks, from public/logos: three.js (strokes), the GitHub octicon (a fill), the pmndrs avatar (white on
// black); and the scratch sheet in public/tex, dark scuffs on white. Loaded once; the decals draw their text at
// once and lay these on when they arrive, then flag their textures. Each is tinted to the decal's ink: the SVGs by
// their alpha, the pmndrs bitmap by its brightness, the scratches by their darkness.

export type LogoName = 'three' | 'github' | 'pmndrs' | 'scratch';
const SRC: Record<LogoName, string> = { three: 'logos/three.svg', github: 'logos/github.svg', pmndrs: 'logos/pmndrs.png', scratch: 'tex/scratches.png' };
const COUNT = Object.keys(SRC).length;

const imgs: Partial<Record<LogoName, HTMLImageElement>> = {};
let loading: Promise<void> | null = null;
const waiting: (() => void)[] = [];

function load(): Promise<void> {
  loading ??= Promise.all((Object.keys(SRC) as LogoName[]).map((name) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { imgs[name] = img; done(); };
    img.onerror = () => done(); // a missing logo leaves a gap, not a broken scene
    img.src = `${import.meta.env.BASE_URL}${SRC[name]}`;
  }))).then(() => { for (const fn of waiting.splice(0)) fn(); });
  return loading;
}

/** Run fn once the logos are here; at once if they already are. */
export function withLogos(fn: () => void) {
  if (loading && Object.keys(imgs).length === COUNT) fn();
  else { waiting.push(fn); void load(); }
}

const tinted = new Map<string, HTMLCanvasElement>();
/** Make the image's shape its alpha where it is not already, then fill the shape with the colour. */
function key(g: CanvasRenderingContext2D, name: LogoName, w: number, h: number, color: string) {
  if (name === 'pmndrs' || name === 'scratch') {
    const id = g.getImageData(0, 0, w, h), px = id.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      px[i + 3] = Math.round(px[i + 3] * (name === 'pmndrs' ? lum : 1 - lum));
    }
    g.putImageData(id, 0, 0);
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
}

/** A logo as a square canvas of `size` px in `color` on transparent, or null if it never loaded. */
export function logo(name: LogoName, size: number, color: string): HTMLCanvasElement | null {
  const img = imgs[name];
  if (!img) return null;
  const k = `${name}/${size}/${color}`;
  const hit = tinted.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // the pmndrs avatar has the mark small in the middle of its square: zoom in on it
  const zoom = name === 'pmndrs' ? 2.4 : 1;
  g.drawImage(img, (size - size * zoom) / 2, (size - size * zoom) / 2, size * zoom, size * zoom);
  key(g, name, size, size, color);
  tinted.set(k, c);
  return c;
}

/** A sheet (the scratches) at its own size in `color` on transparent, or null if it never loaded. */
export function sheet(name: LogoName, color: string): HTMLCanvasElement | null {
  const img = imgs[name];
  if (!img) return null;
  const k = `${name}/sheet/${color}`;
  const hit = tinted.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  key(g, name, c.width, c.height, color);
  tinted.set(k, c);
  return c;
}
