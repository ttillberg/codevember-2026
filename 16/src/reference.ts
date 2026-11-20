// ?debug: the splash as a reference beside the scene, to work toward its look. A small window under the title
// plate; R (or a click on it) makes it big, over the right half of the screen, R again hides it, and again brings
// it back small. Its clicks and keys are its own: not a throw.
const CSS = `
.reference { position: fixed; z-index: 19; left: 24px; top: 128px; width: min(30vw, 420px); aspect-ratio: 1080 / 607;
  border-radius: 6px; overflow: hidden; cursor: zoom-in; box-shadow: 0 0 0 1px rgba(244, 244, 242, 0.35), 0 10px 30px rgba(0, 0, 0, 0.5);
  transition: width 0.25s ease, top 0.25s ease, left 0.25s ease; }
.reference img { width: 100%; height: 100%; object-fit: cover; display: block; }
.reference .tag { position: absolute; left: 8px; bottom: 6px; font: 600 10px/1 Inter, sans-serif; letter-spacing: 0.1em;
  text-transform: uppercase; color: #f4f4f2; opacity: 0.8; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
.reference.big { left: auto; right: 0; top: 0; width: 50vw; height: 100vh; aspect-ratio: auto; border-radius: 0; cursor: zoom-out; }
.reference.big img { object-fit: cover; object-position: 60% 50%; }
.reference.off { display: none; }
`;

export function reference(src: string) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement('div');
  el.className = 'reference';
  el.innerHTML = `<img src="${src}" alt="the reference" /><span class="tag">Reference · R</span>`;
  for (const ev of ['pointerdown', 'pointerup', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
  document.body.append(el);
  // small → big → hidden → small
  const cycle = () => {
    if (el.classList.contains('off')) el.classList.remove('off');
    else if (el.classList.contains('big')) { el.classList.remove('big'); el.classList.add('off'); }
    else el.classList.add('big');
  };
  el.addEventListener('click', () => el.classList.toggle('big'));
  addEventListener('keydown', (e) => { if (e.code === 'KeyR' && !e.repeat) cycle(); });
}
