// Infinite swipe carousel for the brush swatches on phones: the centred item is the
// active brush, one neighbour visible on each side, wraps around forever.
export interface Carousel {
  goTo(index: number, animate?: boolean): void;
  destroy(): void;
}

export function setupCarousel(
  container: HTMLElement,
  items: HTMLElement[],
  spacing: number,
  onSelect: (index: number) => void,
  initial = 0,
): Carousel {
  const n = items.length;
  let pos = initial; // continuous index, centre item = round(pos) mod n
  let dragging = false;
  let startX = 0;
  let startPos = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let anim = 0;
  let selected = ((Math.round(initial) % n) + n) % n;

  container.classList.add('carousel');

  function layout() {
    for (let i = 0; i < n; i++) {
      let rel = i - pos;
      rel = ((rel + n / 2) % n + n) % n - n / 2; // wrap into [-n/2, n/2)
      const a = Math.abs(rel);
      const el = items[i];
      el.style.transform = `translate(-50%, 0) translateX(${rel * spacing}px) scale(${a < 1 ? 1 - 0.25 * a : 0.75})`;
      el.style.opacity = String(a > 2.2 ? 0 : a > 1 ? 0.35 : 1 - 0.65 * a);
      el.style.pointerEvents = a > 1.6 ? 'none' : '';
      el.classList.toggle('active', i === selected);
    }
  }

  function select() {
    const idx = ((Math.round(pos) % n) + n) % n;
    if (idx !== selected) {
      selected = idx;
      onSelect(idx);
    }
  }

  function snapTo(target: number) {
    cancelAnimationFrame(anim);
    const from = pos;
    const t0 = performance.now();
    const dur = 260;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      pos = from + (target - from) * e;
      layout();
      if (k < 1) anim = requestAnimationFrame(tick);
      else { pos = target; select(); layout(); }
    };
    anim = requestAnimationFrame(tick);
  }

  const onDown = (e: PointerEvent) => {
    dragging = true;
    cancelAnimationFrame(anim);
    startX = lastX = e.clientX;
    startPos = pos;
    lastT = performance.now();
    velocity = 0;
    try { container.setPointerCapture(e.pointerId); } catch { /* synthetic events have no pointer */ }
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = (e.clientX - lastX) / dt;
    lastX = e.clientX; lastT = now;
    pos = startPos - (e.clientX - startX) / spacing;
    layout();
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const moved = Math.abs(e.clientX - startX);
    if (moved < 6) {
      // tap: which item was tapped?
      const el = (e.target as HTMLElement).closest('.sw') as HTMLElement | null;
      const i = el ? items.indexOf(el) : -1;
      if (i >= 0) {
        let rel = i - pos;
        rel = ((rel + n / 2) % n + n) % n - n / 2;
        snapTo(pos + rel);
      } else snapTo(Math.round(pos));
      return;
    }
    // flick: carry momentum a little, then snap
    const target = Math.round(pos - velocity * 120 / spacing);
    snapTo(target);
  };

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);

  layout();

  return {
    goTo(index, animate = true) {
      let rel = index - pos;
      rel = ((rel + n / 2) % n + n) % n - n / 2;
      if (animate) snapTo(pos + rel);
      else { pos += rel; selected = index; layout(); }
    },
    destroy() {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.classList.remove('carousel');
    },
  };
}
