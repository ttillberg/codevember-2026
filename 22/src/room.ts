import * as THREE from 'three';

/**
 * 1984 Swedish bedroom desk & dimly-lit heritage Swedish botanical wallpaper ("tapet") wall.
 * Back wall uses FrontSide so orbiting behind the 1702 to inspect its rear RCA jacks never clips.
 */
export function buildSwedishRoom(): THREE.Group {
  const room = new THREE.Group();

  // 1. Lived-in 1984 wooden desk with grain, scratches, pen test marks, mug ring & old tape marks
  const deskMaps = makeDeskTextures();
  const deskMat = new THREE.MeshStandardMaterial({
    map: deskMaps.color,
    roughnessMap: deskMaps.roughness,
    bumpMap: deskMaps.bump,
    bumpScale: 0.012,
    roughness: 0.92, // modulated by roughnessMap (satin worn wood + matte tape residue + glossy tape strip)
    metalness: 0.04,
  });
  // Main textured desk top centered around the active desk area (-9..+9, z: -3.5..+6.5)
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), deskMat);
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(0, 0, 1.5);
  desk.receiveShadow = true;
  room.add(desk);

  // Subtle dark outer surround plane beyond the desk edges so extreme orbits stay seamless
  const outerFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 32),
    new THREE.MeshStandardMaterial({ color: 0x16120f, roughness: 0.9 }),
  );
  outerFloor.rotation.x = -Math.PI / 2;
  outerFloor.position.set(0, -0.005, 4);
  room.add(outerFloor);

  // Soft baked contact shadow under the 1702 monitor & 1541 drive
  const shadowTex = makeContactShadowTexture();
  const monitorShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.4),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.78,
    }),
  );
  monitorShadow.rotation.x = -Math.PI / 2;
  monitorShadow.position.set(0, 0.004, -0.35);
  room.add(monitorShadow);

  const driveShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 4.4),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    }),
  );
  driveShadow.rotation.x = -Math.PI / 2;
  driveShadow.position.set(3.05, 0.004, -0.82);
  driveShadow.rotation.z = 0.18;
  room.add(driveShadow);

  // 2. Heritage Swedish botanical wallpaper wall (Boråstapeter / Duro 1970s-80s style)
  const wallZ = -3.45;
  const { map: wallTex, bump: wallBump } = makeSwedishWallpaperTextures();
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    bumpMap: wallBump,
    bumpScale: 0.012,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), wallMat);
  wall.position.set(0, 6.2, wallZ);
  wall.receiveShadow = true;
  room.add(wall);

  // Classic Swedish painted wooden molding rail along the wall just above the desk
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xbcb6aa,
    roughness: 0.62,
    metalness: 0.03,
    side: THREE.FrontSide,
  });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(30, 0.34, 0.08), trimMat);
  trim.position.set(0, 0.17, wallZ + 0.04);
  trim.receiveShadow = true;
  room.add(trim);

  // Subtle top lip on the wooden trim
  const trimLip = new THREE.Mesh(new THREE.BoxGeometry(30, 0.055, 0.11), trimMat);
  trimLip.position.set(0, 0.35, wallZ + 0.055);
  room.add(trimLip);

  return room;
}

/**
 * Generates a seamless 512x512 classic 1980s Swedish "småblommig" wallpaper ("tapet"):
 * warm oatmeal-putty matte textured paper speckled with dainty dusty-blue three-leaf
 * micro-sprigs alternating left/right in a delicate half-drop diamond repeat.
 */
function makeSwedishWallpaperTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;

  // Warm muted Swedish oatmeal-grey-cream paper ground (sits gently in cozy evening light)
  ctx.fillStyle = '#aba69c';
  ctx.fillRect(0, 0, S, S);

  // Authentic matte speckled paper fiber grain
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const light = Math.random() > 0.48;
    ctx.fillStyle = light ? 'rgba(248, 244, 234, 0.06)' : 'rgba(52, 48, 42, 0.055)';
    ctx.fillRect(x, y, 2, 2);
  }

  // Faint vertical wallpaper strip seam at tile edge
  ctx.fillStyle = 'rgba(40, 36, 30, 0.08)';
  ctx.fillRect(0, 0, 2, S);
  ctx.fillStyle = 'rgba(255, 252, 245, 0.045)';
  ctx.fillRect(2, 0, 1, S);

  // Draw one dainty dusty-blue Swedish 3-leaf micro-sprig
  const drawSprig = (x: number, y: number, flip: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip, 1);
    ctx.rotate(-0.18);

    // Subtle wispy stem
    ctx.strokeStyle = '#5c7286';
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.quadraticCurveTo(1, 2, 0, -4);
    ctx.stroke();

    // Three tiny soft dusty-blue teardrop leaves / petals
    const leaves: [number, number, number, number, number][] = [
      [0, -8, 0.02, 3.0, 6.2],       // center top petal
      [-5.2, -2.5, -0.78, 2.7, 5.5], // left leaf
      [5.4, -1.8, 0.72, 2.6, 5.3],   // right leaf
    ];
    for (const [lx, ly, rot, rx, ry] of leaves) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rot);
      ctx.fillStyle = '#586e82';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tiny muted highlight inside leaf for hand-printed block-print softness
      ctx.fillStyle = 'rgba(154, 176, 196, 0.32)';
      ctx.beginPath();
      ctx.ellipse(-0.4, -0.8, rx * 0.45, ry * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  };

  // Delicate half-drop diamond repeat (6 columns x 6 rows across 512px)
  const cols = 6;
  const rows = 6;
  const dx = S / cols;
  const dy = S / rows;

  for (let row = 0; row < rows; row++) {
    const offsetX = (row % 2) * (dx * 0.5);
    const flip = row % 2 === 0 ? 1 : -1;
    for (let col = -1; col <= cols; col++) {
      const px = col * dx + offsetX + dx * 0.25;
      const py = row * dy + dy * 0.5;
      // Wrap across tile boundaries seamlessly
      for (const wx of [-S, 0, S]) {
        const tx = px + wx;
        if (tx >= -24 && tx <= S + 24) {
          drawSprig(tx, py, flip);
        }
      }
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(9.5, 5.0);
  map.anisotropy = 8;

  // Subtle matte paper-fiber bump texture
  const b = document.createElement('canvas');
  b.width = 128;
  b.height = 128;
  const bctx = b.getContext('2d')!;
  const img = bctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 112 + Math.floor(Math.random() * 32);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  const bump = new THREE.CanvasTexture(b);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(24, 12);

  return { map, bump };
}

function makeDeskTextures(): {
  color: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const W = 2048;
  const H = 1152;
  const colC = document.createElement('canvas');
  const rghC = document.createElement('canvas');
  const bmpC = document.createElement('canvas');
  colC.width = rghC.width = bmpC.width = W;
  colC.height = rghC.height = bmpC.height = H;

  const cCtx = colC.getContext('2d')!;
  const rCtx = rghC.getContext('2d')!;
  const bCtx = bmpC.getContext('2d')!;

  // Seeded deterministic PRNG
  let seed = 19841122;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) & 0xffff) / 0x10000;
  };

  // Helper: map world desk (x in -9..9, z in -3.5..6.5) -> texture pixels (px, py)
  // Note: PlaneGeometry(18, 10) rotated -PI/2 around X puts top of canvas (y=0) at z=-3.5 (wall)
  // and bottom of canvas (y=H) at z=+6.5 (front edge of desk).
  const toPx = (wx: number, wz: number): [number, number] => [
    ((wx + 9) / 18) * W,
    ((wz + 3.5) / 10) * H,
  ];

  // 1. Warm dark stained wood grain base (horizontal planks)
  cCtx.fillStyle = '#332820';
  cCtx.fillRect(0, 0, W, H);
  rCtx.fillStyle = 'rgb(138,138,138)'; // satin varnished wood (~0.54)
  rCtx.fillRect(0, 0, W, H);
  bCtx.fillStyle = 'rgb(128,128,128)';
  bCtx.fillRect(0, 0, W, H);

  for (let y = 0; y < H; y++) {
    const grain =
      Math.sin(y * 0.055) * 9 +
      Math.sin(y * 0.17 + 1.1) * 5 +
      Math.sin(y * 0.43) * 2.5 +
      (rand() - 0.5) * 6;
    const r = Math.max(24, Math.min(78, Math.round(54 + grain)));
    const g = Math.max(18, Math.min(64, Math.round(42 + grain * 0.82)));
    const b = Math.max(14, Math.min(52, Math.round(32 + grain * 0.68)));
    cCtx.fillStyle = `rgb(${r},${g},${b})`;
    cCtx.fillRect(0, y, W, 1);

    const rv = Math.max(105, Math.min(185, Math.round(142 - grain * 1.4)));
    rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rCtx.fillRect(0, y, W, 1);

    const bv = Math.max(108, Math.min(148, Math.round(128 + grain * 0.8)));
    bCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.fillRect(0, y, W, 1);
  }

  // Subtle plank glue seams across the desk
  for (const wz of [-1.2, 1.4, 4.1]) {
    const [, py] = toPx(0, wz);
    cCtx.fillStyle = 'rgba(14, 10, 8, 0.35)';
    cCtx.fillRect(0, py, W, 2);
    bCtx.fillStyle = 'rgb(76,76,76)';
    bCtx.fillRect(0, py, W, 2);
  }

  // Gentle worn arm-rest polish patch in front of the monitor (slightly warmer & glossier)
  const [wearX, wearY] = toPx(0.0, 2.7);
  const wearGrad = cCtx.createRadialGradient(wearX, wearY, 40, wearX, wearY, 440);
  wearGrad.addColorStop(0, 'rgba(128, 98, 70, 0.14)');
  wearGrad.addColorStop(1, 'rgba(128, 98, 70, 0)');
  cCtx.fillStyle = wearGrad;
  cCtx.fillRect(wearX - 440, wearY - 440, 880, 880);

  const wearR = rCtx.createRadialGradient(wearX, wearY, 30, wearX, wearY, 420);
  wearR.addColorStop(0, 'rgba(84, 84, 84, 0.55)');
  wearR.addColorStop(1, 'rgba(84, 84, 84, 0)');
  rCtx.fillStyle = wearR;
  rCtx.fillRect(wearX - 420, wearY - 420, 840, 840);

  // 2. Subtle desk wear: ~5 quiet varied scratches + whisper-thin craft-knife cuts (from cutting paper on the wood)
  const drawScratch = (x0: number, y0: number, ang: number, len: number, width: number, alpha: number) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const cx = (x0 + x1) * 0.5 + (rand() - 0.5) * (len * 0.08);
    const cy = (y0 + y1) * 0.5 + (rand() - 0.5) * (len * 0.08);

    cCtx.save();
    cCtx.strokeStyle = `rgba(148, 120, 90, ${alpha.toFixed(3)})`;
    cCtx.lineWidth = width;
    cCtx.lineCap = 'round';
    cCtx.beginPath();
    cCtx.moveTo(x0, y0);
    cCtx.quadraticCurveTo(cx, cy, x1, y1);
    cCtx.stroke();
    cCtx.restore();

    rCtx.save();
    rCtx.strokeStyle = `rgba(205, 205, 205, ${(alpha * 2.2).toFixed(3)})`;
    rCtx.lineWidth = width + 0.4;
    rCtx.beginPath();
    rCtx.moveTo(x0, y0);
    rCtx.quadraticCurveTo(cx, cy, x1, y1);
    rCtx.stroke();
    rCtx.restore();

    bCtx.save();
    bCtx.strokeStyle = 'rgba(72, 72, 72, 0.55)';
    bCtx.lineWidth = width;
    bCtx.beginPath();
    bCtx.moveTo(x0, y0);
    bCtx.quadraticCurveTo(cx, cy, x1, y1);
    bCtx.stroke();
    bCtx.restore();
  };

  // Just 5 varied, understated scratches across the desk
  const scratches: [number, number, number, number, number, number][] = [
    [-2.85, 1.75, 0.22, 118, 1.3, 0.14],
    [-1.45, 3.35, -0.41, 64, 0.9, 0.11],
    [1.65, 1.85, 0.78, 86, 1.1, 0.12],
    [2.75, 3.10, -0.15, 142, 1.5, 0.13],
    [-3.60, 2.70, 1.12, 48, 0.85, 0.10],
  ];
  for (const [wx, wz, ang, len, wid, alp] of scratches) {
    const [px, py] = toPx(wx, wz);
    drawScratch(px, py, ang, len, wid, alp);
  }

  // Razor-thin hairline craft-knife cuts (like cutting paper directly on the desk without a mat — barely noticeable!)
  const drawKnifeCut = (wx: number, wz: number, ang: number, len: number) => {
    const [x0, y0] = toPx(wx, wz);
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;

    // Tiny dark hairline groove + barely-there pale edge catch
    cCtx.save();
    cCtx.strokeStyle = 'rgba(18, 12, 8, 0.34)';
    cCtx.lineWidth = 0.75;
    cCtx.beginPath();
    cCtx.moveTo(x0, y0);
    cCtx.lineTo(x1, y1);
    cCtx.stroke();
    cCtx.strokeStyle = 'rgba(155, 128, 96, 0.10)';
    cCtx.lineWidth = 0.6;
    cCtx.beginPath();
    cCtx.moveTo(x0 + 0.6, y0 + 0.6);
    cCtx.lineTo(x1 + 0.6, y1 + 0.6);
    cCtx.stroke();
    cCtx.restore();

    rCtx.save();
    rCtx.strokeStyle = 'rgba(195, 195, 195, 0.45)';
    rCtx.lineWidth = 0.9;
    rCtx.beginPath();
    rCtx.moveTo(x0, y0);
    rCtx.lineTo(x1, y1);
    rCtx.stroke();
    rCtx.restore();

    bCtx.save();
    bCtx.strokeStyle = 'rgb(44, 44, 44)';
    bCtx.lineWidth = 0.85;
    bCtx.beginPath();
    bCtx.moveTo(x0, y0);
    bCtx.lineTo(x1, y1);
    bCtx.stroke();
    bCtx.restore();
  };

  // A couple quiet clusters of straight ruler/craft-knife hairlines near the front work area
  const cuts: [number, number, number, number][] = [
    [-2.05, 2.72, 0.04, 155],
    [-2.02, 2.80, 0.05, 128],
    [-1.92, 2.66, 0.02, 92],
    [-1.68, 2.55, 1.54, 118],
    [-1.62, 2.59, 1.56, 84],
    [1.38, 2.22, -0.08, 134],
    [1.42, 2.29, -0.06, 98],
    [1.72, 2.15, 0.62, 74],
    [1.82, 2.86, 0.03, 146],
  ];
  for (const [wx, wz, ang, len] of cuts) {
    drawKnifeCut(wx, wz, ang, len);
  }

  // Subtle curved drag scuff where the 1541 drive was pushed around
  for (const [wx, wz, rad] of [[2.9, 1.3, 120]]) {
    const [px, py] = toPx(wx, wz);
    cCtx.save();
    cCtx.strokeStyle = 'rgba(148, 120, 88, 0.11)';
    cCtx.lineWidth = 1.6;
    cCtx.beginPath();
    cCtx.arc(px, py, rad, 0.3, 1.45);
    cCtx.stroke();
    cCtx.restore();
  }

  // 3. Old Scotch / masking tape marks & tacky dusty residue rectangles on the desk!
  const drawTapeResidue = (wx: number, wz: number, rot: number, tw: number, th: number, stillStuck: boolean) => {
    const [px, py] = toPx(wx, wz);
    for (const ctx of [cCtx, rCtx, bCtx]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
    }

    // Helper for serrated tape-dispenser zig-zag ends!
    const traceTape = (ctx: CanvasRenderingContext2D) => {
      const hw = tw / 2;
      const hh = th / 2;
      const teeth = 5;
      ctx.beginPath();
      ctx.moveTo(-hw, -hh);
      ctx.lineTo(hw, -hh);
      // Right serrated edge
      for (let i = 0; i < teeth; i++) {
        const ty0 = -hh + (i / teeth) * th;
        const ty1 = -hh + ((i + 0.5) / teeth) * th;
        const ty2 = -hh + ((i + 1) / teeth) * th;
        ctx.lineTo(hw + 4.5, ty1);
        ctx.lineTo(hw, ty2);
        void ty0;
      }
      ctx.lineTo(-hw, hh);
      // Left serrated edge
      for (let i = teeth - 1; i >= 0; i--) {
        const ty1 = -hh + ((i + 0.5) / teeth) * th;
        const ty2 = -hh + (i / teeth) * th;
        ctx.lineTo(-hw - 4.5, ty1);
        ctx.lineTo(-hw, ty2);
      }
      ctx.closePath();
    };

    if (stillStuck) {
      // Actual old slightly-yellowed translucent Scotch tape strip left stuck on the desk (subtle!)
      traceTape(cCtx);
      cCtx.fillStyle = 'rgba(210, 196, 158, 0.13)';
      cCtx.fill();
      cCtx.strokeStyle = 'rgba(226, 214, 180, 0.17)';
      cCtx.lineWidth = 1.1;
      cCtx.stroke();

      cCtx.fillStyle = 'rgba(238, 230, 206, 0.10)';
      cCtx.fillRect(-tw * 0.48, -th * 0.44, tw * 0.14, th * 0.88);

      // Glossy tape strip mostly reveals itself through light reflection
      traceTape(rCtx);
      rCtx.fillStyle = 'rgb(62, 62, 62)';
      rCtx.fill();

      traceTape(bCtx);
      bCtx.fillStyle = 'rgb(140, 140, 140)';
      bCtx.fill();
    } else {
      // Ghostly peeled-off tape residue mark: whisper-faint adhesive sheen
      traceTape(cCtx);
      cCtx.fillStyle = 'rgba(176, 162, 136, 0.065)';
      cCtx.fill();
      cCtx.strokeStyle = 'rgba(190, 176, 150, 0.12)';
      cCtx.lineWidth = 1.4;
      cCtx.stroke();

      for (let i = 0; i < 32; i++) {
        const lx = (rand() - 0.5) * tw * 0.96;
        const ly = (rand() - 0.5) * th * 0.94;
        cCtx.fillStyle = rand() > 0.4 ? 'rgba(194, 182, 158, 0.12)' : 'rgba(24, 18, 12, 0.15)';
        cCtx.fillRect(lx, ly, 1.8, 1.4);
      }

      traceTape(rCtx);
      rCtx.fillStyle = 'rgb(202, 202, 202)';
      rCtx.fill();

      traceTape(bCtx);
      bCtx.fillStyle = 'rgb(133, 133, 133)';
      bCtx.fill();
    }

    for (const ctx of [cCtx, rCtx, bCtx]) ctx.restore();
  };

  // Three subtle, lived-in tape marks (one still stuck near the paper, two peeled-off adhesive ghosts)
  drawTapeResidue(-2.45, 2.55, -0.34, 114, 28, true);  // yellowed translucent Scotch tape left stuck near left of paper
  drawTapeResidue(-1.78, 1.90, 0.52, 96, 26, false);   // ghostly peeled tape adhesive mark
  drawTapeResidue(2.12, 2.48, -0.58, 108, 26, false);  // dusty tape residue between BIC pen & 1541

  // 4. Tiny blue & red BIC pen "get the ink flowing" test scribbles near where the pen rests!
  const [penX, penY] = toPx(1.55, 2.92);
  cCtx.save();
  cCtx.strokeStyle = 'rgba(32, 74, 168, 0.48)';
  cCtx.lineWidth = 2.0;
  cCtx.lineCap = 'round';
  cCtx.beginPath();
  for (let i = 0; i < 16; i++) {
    const sx = penX + i * 3.4;
    const sy = penY + (i % 2 === 0 ? -9 : 9) + (rand() - 0.5) * 3;
    if (i === 0) cCtx.moveTo(sx, sy);
    else cCtx.lineTo(sx, sy);
  }
  cCtx.stroke();
  cCtx.restore();

  // 5. Subtle faint cup / mug ring on the far left of the desk
  const [mugX, mugY] = toPx(-3.15, 2.95);
  cCtx.save();
  cCtx.strokeStyle = 'rgba(176, 152, 122, 0.14)';
  cCtx.lineWidth = 5.5;
  cCtx.beginPath();
  cCtx.arc(mugX, mugY, 52, 0.2, Math.PI * 1.85);
  cCtx.stroke();
  cCtx.restore();

  rCtx.save();
  rCtx.strokeStyle = 'rgba(205, 205, 205, 0.55)';
  rCtx.lineWidth = 6.5;
  rCtx.beginPath();
  rCtx.arc(mugX, mugY, 52, 0.2, Math.PI * 1.85);
  rCtx.stroke();
  rCtx.restore();

  const color = new THREE.CanvasTexture(colC);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 8;

  const roughness = new THREE.CanvasTexture(rghC);
  roughness.anisotropy = 8;

  const bump = new THREE.CanvasTexture(bmpC);
  bump.anisotropy = 8;

  return { color, roughness, bump };
}

function makeContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.48);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.52)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
