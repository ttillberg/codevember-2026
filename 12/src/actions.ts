// The things to do with the bird, behind one round button bottom right.
// A tap opens a little frosted column of icons over it (it stays open: tap away or the
// button again to close). A press held a moment opens it too, and then the finger slides
// up to an icon and lets go on it: one movement, the way a long press works on a phone.

export interface Action {
  id: string;
  label: string;
  /** key shown beside the label where there is a keyboard */
  key?: string;
  icon: string;
  run(): void;
}

const svg = (body: string) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // the button itself: a round little hummingbird looking left, one curve from the back of
  // its head over the crown and out into a short beak, closed back to the chin; a big eye
  // with a glint
  bird: svg('<path d="M18.1 17.1A6.2 6.2 0 1 0 8.9 9.4C8.5 10.5 7.2 11.4 3.3 12.4l5.1-.3"/><circle cx="14" cy="11" r="1.9" fill="currentColor" stroke="none"/><circle cx="13.4" cy="10.4" r=".55" fill="#1f3a1c" stroke="none"/>'),
  // food: a dandelion seed, its parachute of hairs
  food: svg('<path d="M12 10.5L3.8 8.3M12 10.5L5.5 5.0M12 10.5L8.4 2.8M12 10.5L12.0 2.0M12 10.5L15.6 2.8M12 10.5L18.5 5.0M12 10.5L20.2 8.3" stroke-width="1.1"/><path d="M12 10.5v7"/><path d="M12 17.3c-.9 0-1.3 1-1.1 2.1L12 22l1.1-2.6c.2-1.1-.2-2.1-1.1-2.1z" fill="currentColor"/>'),
  gnat: svg('<ellipse cx="12" cy="14.5" rx="3" ry="5"/><circle cx="12" cy="7.6" r="1.9"/><path d="M9.2 11.5C6 8.5 3.5 9.5 3.6 11.8c.1 1.6 2.7 1.8 5.6.9M14.8 11.5c3.2-3 5.7-2 5.6.3-.1 1.6-2.7 1.8-5.6.9M10.6 6 9 3.8M13.4 6 15 3.8"/>'),
  sing: svg('<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path d="M9 9.5l10-2"/>'),
  // ruffle: a feather
  ruffle: svg('<path d="M19.5 4.5C13 5 7.5 9.5 6 17l-1.5 2.5"/><path d="M19.5 4.5c-.5 6-4.5 11-12.5 12.5"/><path d="M9.5 13.5l3.5-3.5M8.5 11h3.5M11.5 8.5h3"/>'),
  // fly off: a pair of wings
  fly: svg('<path d="M11 16C9.5 10.5 6.5 6.5 2 5c.3 2.6 1.1 4.4 2.4 5.6-.9.2-1.4.2-2 .1 1.2 2.6 2.9 4 5.3 4.4-.6.4-1.2.6-1.9.7C7.6 16.6 9.1 16.9 11 16z"/><path d="M13 16c1.5-5.5 4.5-9.5 9-11-.3 2.6-1.1 4.4-2.4 5.6.9.2 1.4.2 2 .1-1.2 2.6-2.9 4-5.3 4.4.6.4 1.2.6 1.9.7-1.8.8-3.3 1.1-5.2.2z"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.2" r="1.2"/>'),
  settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
};

/** how long a press waits before it opens the menu to slide along */
const HOLD_MS = 220;

export function createActionMenu(actions: Action[]) {
  const root = document.createElement('div');
  root.className = 'actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'act-main';
  button.setAttribute('aria-label', 'Things to do');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${ICONS.bird}<span class="x" aria-hidden="true"></span>`;
  const menu = document.createElement('div');
  menu.className = 'act-menu';
  menu.setAttribute('role', 'menu');

  const items = actions.map((a, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act-item';
    b.dataset.id = a.id;
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-label', a.label);
    // (the stagger: nearest the button first)
    b.style.setProperty('--i', String(actions.length - 1 - i));
    b.innerHTML = `${a.icon}<span class="act-label">${a.label}${a.key ? `<kbd>${a.key}</kbd>` : ''}</span>`;
    menu.append(b);
    return b;
  });
  root.append(menu, button);
  document.body.append(root);

  let open = false;
  function setOpen(on: boolean) {
    open = on;
    root.classList.toggle('open', on);
    button.setAttribute('aria-expanded', String(on));
    if (!on) hover(null);
  }
  let lit: HTMLButtonElement | null = null;
  function hover(b: HTMLButtonElement | null) {
    lit?.classList.remove('lit');
    lit = b;
    lit?.classList.add('lit');
  }
  function fire(b: HTMLButtonElement) {
    const a = actions[items.indexOf(b)];
    // a little press on the icon, whichever way it was chosen
    b.classList.remove('fired');
    void b.offsetWidth;
    b.classList.add('fired');
    a.run();
  }

  // the main button: a tap toggles, a hold opens for a slide
  let holdTimer = 0;
  let holding = false;
  let pressed = false;
  const itemAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('.act-item');
    return el && items.includes(el) ? el : null;
  };
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pressed = true;
    holding = false;
    button.setPointerCapture(e.pointerId);
    clearTimeout(holdTimer);
    if (!open) {
      holdTimer = window.setTimeout(() => {
        holding = true;
        setOpen(true);
        navigator.vibrate?.(8);
      }, HOLD_MS);
    }
  });
  button.addEventListener('pointermove', (e) => {
    if (holding) hover(itemAt(e.clientX, e.clientY));
  });
  const release = (e: PointerEvent) => {
    if (!pressed) return;
    pressed = false;
    clearTimeout(holdTimer);
    e.stopPropagation();
    if (holding) {
      // let go on an icon: that one, and the menu folds away
      holding = false;
      const b = itemAt(e.clientX, e.clientY);
      if (b) fire(b);
      setOpen(false);
      return;
    }
    setOpen(!open);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', () => {
    pressed = holding = false;
    clearTimeout(holdTimer);
  });
  // a keyboard (or a screen reader) clicks without pointer events
  button.addEventListener('click', (e) => {
    if (e.detail === 0) setOpen(!open);
  });

  // the icons, tapped while the menu is open: it stays open for another
  for (const b of items) {
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerup', (e) => e.stopPropagation());
    b.addEventListener('click', () => fire(b));
    b.addEventListener('pointerenter', () => hover(b));
    b.addEventListener('pointerleave', () => lit === b && hover(null));
  }
  // anywhere else closes it (and that press does nothing else: see swallows)
  let closedBy = -1;
  window.addEventListener('pointerdown', (e) => {
    if (open && !holding && !root.contains(e.target as Node)) {
      setOpen(false);
      closedBy = e.pointerId;
    } else closedBy = -1;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  return {
    root,
    setOpen,
    isOpen: () => open,
    /** this press only closed the menu: the scene shouldn't take it as a tap */
    swallows: (e: PointerEvent) => e.pointerId === closedBy,
  };
}
