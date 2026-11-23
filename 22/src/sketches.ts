import * as THREE from 'three';

/**
 * A small scattered stack of naive 8-year-old game drawings & graph-paper C64 sprite sketches
 * tucked over on the far-left side of the desk near the orange lamp (barely out of the default
 * frame — discovered when orbiting left!).
 */
export function buildKidSketches(): THREE.Group {
  const group = new THREE.Group();

  const specs = [
    {
      canvas: makeSpriteGridSketch(),
      w: 1.55,
      h: 2.05,
      x: -5.15,
      y: 0.008,
      z: 2.35,
      rotY: 0.32,
      curl: 0.05,
    },
    {
      canvas: makeGameLevelSketch(),
      w: 2.05,
      h: 1.52,
      x: -5.95,
      y: 0.015,
      z: 1.65,
      rotY: -0.24,
      curl: 0.07,
    },
    {
      canvas: makeDungeonMapSketch(),
      w: 1.48,
      h: 1.92,
      x: -5.55,
      y: 0.022,
      z: 2.85,
      rotY: -0.58,
      curl: 0.09,
    },
    {
      canvas: makeSpaceDoodleSketch(),
      w: 1.38,
      h: 1.72,
      x: -6.45,
      y: 0.012,
      z: 2.45,
      rotY: 0.14,
      curl: 0.06,
    },
  ];

  for (const s of specs) {
    const tex = new THREE.CanvasTexture(s.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const geo = new THREE.PlaneGeometry(s.w, s.h, 12, 12);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const nx = x / (s.w * 0.5);
      const nz = z / (s.h * 0.5);
      const edge = Math.max(0, nx + nz - 1.05);
      const lift = edge * edge * s.curl + Math.sin(nx * 2.4) * 0.004;
      pos.setY(i, lift);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.91,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

// ---- Shared naive ballpoint-pen helpers ----

function makePaperBase(w: number, h: number, tint = '#f2ebda'): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(80,64,40,0.03)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  return [c, ctx];
}

function wobbleLine(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  color: string,
  width = 3,
  jitter = 2.5,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) * 0.5 + (Math.random() - 0.5) * jitter;
    const my = (y0 + y1) * 0.5 + (Math.random() - 0.5) * jitter;
    ctx.quadraticCurveTo(mx, my, x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}

function scribbleFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  // Kid filling a graph-paper pixel square with messy diagonal ballpoint pen strokes!
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const step = 6;
  for (let d = 3; d < w + h - 3; d += step) {
    const x0 = x + Math.max(2, d - h + 2);
    const y0 = y + Math.min(h - 2, d);
    const x1 = x + Math.min(w - 2, d);
    const y1 = y + Math.max(2, d - w + 2);
    ctx.moveTo(x0 + (Math.random() - 0.5) * 2, y0 + (Math.random() - 0.5) * 2);
    ctx.lineTo(x1 + (Math.random() - 0.5) * 2, y1 + (Math.random() - 0.5) * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Sheet 1: Squared math graph paper with an 8-year-old's C64 spaceship & alien sprite grids! */
function makeSpriteGridSketch(): HTMLCanvasElement {
  const w = 512;
  const h = 680;
  const [c, ctx] = makePaperBase(w, h, '#f3eedf');

  // Light blue school math graph-paper grid
  ctx.strokeStyle = 'rgba(92, 148, 198, 0.28)';
  ctx.lineWidth = 1.2;
  const cell = 32;
  for (let x = 0; x <= w; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const BLUE = 'rgba(26, 66, 162, 0.85)';
  const RED = 'rgba(196, 44, 38, 0.85)';
  const GREEN = 'rgba(38, 138, 66, 0.85)';

  // Hand-scribbled pixel spaceship on the grid!
  const ship = [
    '...1....',
    '..111...',
    '..121...',
    '.11111..',
    '1112111.',
    '1.111.1.',
    '..2.2...',
  ];
  const ox = 96;
  const oy = 96;
  for (let r = 0; r < ship.length; r++) {
    for (let col = 0; col < ship[r].length; col++) {
      const ch = ship[r][col];
      if (ch === '1') scribbleFill(ctx, ox + col * cell, oy + r * cell, cell, cell, BLUE);
      if (ch === '2') scribbleFill(ctx, ox + col * cell, oy + r * cell, cell, cell, RED);
    }
  }
  // Box around sprite
  wobbleLine(ctx, [[ox, oy], [ox + 8 * cell, oy], [ox + 8 * cell, oy + 7 * cell], [ox, oy + 7 * cell], [ox, oy]], BLUE, 2.5);

  // Little classic space-invader alien below in green BIC pen!
  const alien = [
    '..1...1.',
    '...1.1..',
    '..11111.',
    '.11.1.11',
    '11111111',
    '1.11111.',
    '1.1...1.',
    '...1.1..',
  ];
  const ay = 384;
  for (let r = 0; r < alien.length; r++) {
    for (let col = 0; col < alien[r].length; col++) {
      if (alien[r][col] === '1') scribbleFill(ctx, ox + col * cell, ay + r * cell, cell, cell, GREEN);
    }
  }
  wobbleLine(ctx, [[ox, ay], [ox + 8 * cell, ay], [ox + 8 * cell, ay + 8 * cell], [ox, ay + 8 * cell], [ox, ay]], GREEN, 2.5);

  // Little red arrows & stars in margin
  wobbleLine(ctx, [[370, 165], [415, 162], [448, 178]], RED, 3);
  wobbleLine(ctx, [[382, 152], [368, 165], [385, 178]], RED, 3);
  return c;
}

/** Sheet 2: Naive 8-year-old landscape drawing of a video game level (hero, laser, UFO, mountains!) */
function makeGameLevelSketch(): HTMLCanvasElement {
  const w = 680;
  const h = 512;
  const [c, ctx] = makePaperBase(w, h, '#f6f1e4');

  const BLUE = 'rgba(26, 64, 158, 0.85)';
  const RED = 'rgba(196, 44, 38, 0.86)';
  const GREEN = 'rgba(40, 136, 66, 0.85)';
  const BLACK = 'rgba(34, 32, 30, 0.82)';

  // Wobbly screen TV border drawn by a kid!
  wobbleLine(ctx, [[38, 42], [640, 36], [646, 468], [34, 474], [38, 42]], BLACK, 4.2, 5);

  // Jagged green mountain ground & platforms
  wobbleLine(
    ctx,
    [[44, 412], [125, 340], [185, 396], [260, 318], [335, 398], [418, 365], [495, 305], [575, 392], [638, 380]],
    GREEN,
    4.5,
    4,
  );
  // Floating ledges
  wobbleLine(ctx, [[150, 255], [270, 252]], BLUE, 5, 3);
  wobbleLine(ctx, [[360, 215], [475, 218]], BLUE, 5, 3);

  // Little stick-figure hero jumping on left platform
  const hx = 195;
  const hy = 205;
  ctx.save();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.arc(hx, hy - 14, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  wobbleLine(ctx, [[hx, hy], [hx, hy + 30]], BLUE, 3.6);
  wobbleLine(ctx, [[hx - 16, hy + 12], [hx + 22, hy + 8]], BLUE, 3.4); // arm holding laser!
  wobbleLine(ctx, [[hx, hy + 30], [hx - 14, hy + 50]], BLUE, 3.4);
  wobbleLine(ctx, [[hx, hy + 30], [hx + 15, hy + 48]], BLUE, 3.4);

  // Red dashed laser beam pew-pew!
  for (let i = 0; i < 6; i++) {
    const lx = 236 + i * 38;
    wobbleLine(ctx, [[lx, 206 - i * 8], [lx + 24, 202 - i * 8]], RED, 4.0, 1.5);
  }

  // Big naive flying saucer boss on the upper right!
  const ux = 518;
  const uy = 148;
  wobbleLine(
    ctx,
    [[ux - 70, uy], [ux - 38, uy - 24], [ux + 38, uy - 24], [ux + 72, uy], [ux + 34, uy + 24], [ux - 36, uy + 24], [ux - 70, uy]],
    RED,
    4.2,
    3,
  );
  // Glass dome on UFO
  wobbleLine(ctx, [[ux - 32, uy - 22], [ux - 18, uy - 54], [ux + 18, uy - 54], [ux + 32, uy - 22]], BLUE, 3.5, 2);
  // Angry eyes on alien inside dome
  wobbleLine(ctx, [[ux - 10, uy - 36], [ux - 4, uy - 32]], BLACK, 3.2);
  wobbleLine(ctx, [[ux + 10, uy - 36], [ux + 4, uy - 32]], BLACK, 3.2);

  // Explosion star bursts
  for (const [sx, sy, r] of [[448, 165, 24], [118, 118, 18], [322, 102, 14]]) {
    const order = [0, 2, 4, 1, 3, 0];
    const pts: [number, number][] = order.map((idx) => {
      const a = -Math.PI / 2 + (idx * Math.PI * 2) / 5;
      return [sx + Math.cos(a) * r, sy + Math.sin(a) * r];
    });
    wobbleLine(ctx, pts, RED, 2.8, 1.5);
  }

  // Three little hearts (lives) top-left
  for (let i = 0; i < 3; i++) {
    const bx = 76 + i * 34;
    const by = 78;
    wobbleLine(ctx, [[bx, by + 12], [bx - 12, by - 2], [bx - 6, by - 12], [bx, by - 4], [bx + 6, by - 12], [bx + 12, by - 2], [bx, by + 12]], RED, 3.2, 1);
  }

  return c;
}

/** Sheet 3: Lined notebook paper with a naive top-down cave/dungeon adventure map! */
function makeDungeonMapSketch(): HTMLCanvasElement {
  const w = 512;
  const h = 640;
  const [c, ctx] = makePaperBase(w, h, '#f0e9d7');

  ctx.strokeStyle = 'rgba(84, 138, 198, 0.28)';
  ctx.lineWidth = 1.4;
  for (let y = 72; y < h - 20; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const BLUE = 'rgba(26, 62, 152, 0.85)';
  const RED = 'rgba(194, 42, 38, 0.86)';

  // Connected cave rooms drawn as wobbly boxes with corridors!
  const rooms: [number, number, number, number][] = [
    [160, 440, 170, 120],
    [140, 250, 210, 125],
    [44, 110, 140, 105],
    [290, 95, 165, 115],
  ];
  for (const [rx, ry, rw, rh] of rooms) {
    wobbleLine(ctx, [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh], [rx, ry]], BLUE, 3.8, 4);
  }
  // Corridors connecting rooms
  wobbleLine(ctx, [[232, 440], [234, 375]], BLUE, 3.5);
  wobbleLine(ctx, [[262, 440], [260, 375]], BLUE, 3.5);
  wobbleLine(ctx, [[165, 250], [122, 215]], BLUE, 3.5);
  wobbleLine(ctx, [[310, 250], [348, 210]], BLUE, 3.5);

  // Big red X marks the treasure in top-right room!
  wobbleLine(ctx, [[348, 126], [402, 178]], RED, 5.0, 2);
  wobbleLine(ctx, [[402, 126], [348, 178]], RED, 5.0, 2);

  // Dotted path from start room to treasure
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const px = 245 + Math.sin(t * 3.1) * 50 + t * 115;
    const py = 500 - t * 340;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return c;
}

/** Sheet 4: Loose half-scribbled space rocket & planet doodle */
function makeSpaceDoodleSketch(): HTMLCanvasElement {
  const w = 480;
  const h = 600;
  const [c, ctx] = makePaperBase(w, h, '#eee7d6');

  const BLUE = 'rgba(26, 64, 158, 0.82)';
  const RED = 'rgba(196, 44, 38, 0.84)';
  const GREEN = 'rgba(38, 136, 66, 0.82)';

  // Ringed Saturn planet
  ctx.save();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(175, 195, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = RED;
  ctx.beginPath();
  ctx.ellipse(175, 198, 108, 24, -0.28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Chunky naive rocket blasting diagonally up-right
  wobbleLine(
    ctx,
    [[290, 420], [360, 275], [395, 295], [326, 440], [290, 420]],
    BLUE,
    4.0,
    3,
  );
  wobbleLine(ctx, [[360, 275], [405, 245], [395, 295]], RED, 4.0, 2);
  wobbleLine(ctx, [[290, 420], [254, 445], [276, 466], [308, 434]], RED, 3.8, 2);
  wobbleLine(ctx, [[326, 440], [344, 480], [312, 474], [308, 434]], RED, 3.8, 2);
  // Squiggly green/red exhaust flames
  wobbleLine(ctx, [[296, 445], [268, 502], [294, 485], [274, 535], [312, 462]], RED, 3.8, 3);
  wobbleLine(ctx, [[120, 440], [185, 435], [178, 495], [116, 498], [120, 440]], GREEN, 3.4, 3);

  return c;
}
