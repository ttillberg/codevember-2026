import * as THREE from 'three';
import { clamp, fbm2D, mulberry32, smoothstep } from './rng';
import { sampleFastFbm3 } from './noise3d';

const IS_COMPACT_TEX =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) <= 820);

export const CARVE_TEX_W = IS_COMPACT_TEX ? 512 : 1024;
export const CARVE_TEX_H = IS_COMPACT_TEX ? 170 : 340;

export interface StrawberryTextures {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  translucency: THREE.CanvasTexture;
}

export interface BlueberryTextures {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

export interface WoodTextures {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  carving: THREE.CanvasTexture;
}

/**
 * Evaluates normalized heart/strawberry slice radial boundary in [-1, 1] UV space.
 * Center (0, 0), crown (top/wide shoulders) at +Y, tapered apex at -Y.
 */
export function strawberryBoundaryRadius(angle: number): number {
  const sy = Math.sin(angle);
  const cx = Math.cos(angle);
  const shoulder = 0.86 + 0.14 * smoothstep(-0.3, 0.55, sy);
  const tip = 1.0 - 0.18 * smoothstep(-0.35, -0.98, sy) * (1 - Math.abs(cx) * 0.4);
  const crownDip = 1.0 - 0.10 * Math.pow(Math.max(0, sy), 6.0);
  const width = 0.84 + 0.12 * Math.pow(Math.abs(cx), 2.0);
  return shoulder * tip * crownDip * width * 0.90;
}

/**
 * Photorealistic macro botanical strawberry slice texture set:
 * - Deep velvety ruby-crimson outer skin with recessed dark-amber achenes right on the scalloped rim
 * - Juicy translucent fiery scarlet cortex with delicate organic vascular fibers
 * - Warm glowing salmon-cream translucent heart core (never stark chalk-white!)
 */
export function createStrawberryTextures(seed = 103): StrawberryTextures {
  const size = IS_COMPACT_TEX ? 256 : 512;
  const albCanvas = document.createElement('canvas');
  const bmpCanvas = document.createElement('canvas');
  const sssCanvas = document.createElement('canvas');
  albCanvas.width = bmpCanvas.width = sssCanvas.width = size;
  albCanvas.height = bmpCanvas.height = sssCanvas.height = size;

  const albCtx = albCanvas.getContext('2d')!;
  const bmpCtx = bmpCanvas.getContext('2d')!;
  const sssCtx = sssCanvas.getContext('2d')!;

  const albImg = albCtx.createImageData(size, size);
  const bmpImg = bmpCtx.createImageData(size, size);
  const sssImg = sssCtx.createImageData(size, size);

  const rand = mulberry32(seed);
  const seedOff = rand() * 30;

  // Recessed perimeter achenes sitting RIGHT along the outer skin rim (rn ~ 0.94..0.98)
  const acheneCount = 28;
  const achenes: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < acheneCount; i++) {
    const a = (i / acheneCount) * Math.PI * 2 - Math.PI + (rand() - 0.5) * 0.06;
    const br = strawberryBoundaryRadius(a);
    const ar = br * (0.945 + rand() * 0.025);
    achenes.push({ x: Math.cos(a) * ar, y: Math.sin(a) * ar });
  }

  for (let py = 0; py < size; py++) {
    const ny = 1.0 - (py / (size - 1)) * 2.0;
    for (let px = 0; px < size; px++) {
      const nx = (px / (size - 1)) * 2.0 - 1.0;

      const r = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const bR = strawberryBoundaryRadius(ang);
      const rn = r / Math.max(0.001, bR);

      // Multi-scale fibrous botanical noise (true 2D FBM — ~2x faster than 3D slice)
      const nCell = fbm2D(nx * 28 + seedOff, ny * 28 + 13.1, 4);
      const nMed = fbm2D(nx * 7.5 + seedOff, ny * 7.5 + 47.3, 3);
      const nFine = fbm2D(nx * 54 + seedOff, ny * 54 + 92.7, 2);

      // Crisp high-contrast radiating vascular filaments streaming inward from perimeter seeds toward core
      const radialWarp = (nMed - 0.5) * 2.8;
      const veinA = 0.5 + 0.5 * Math.sin(ang * 24.0 + radialWarp);
      const veinB = 0.5 + 0.5 * Math.sin(ang * 42.0 - radialWarp * 0.7);
      const fineVeins =
        (Math.pow(veinA, 3.2) * 0.68 + Math.pow(veinB, 4.5) * 0.32) *
        smoothstep(0.14, 0.36, rn) *
        smoothstep(0.95, 0.70, rn);

      // Tighter, crisper luminous translucent vascular core (high contrast against rich ruby outer cortex!)
      const coreShiftY = ny - 0.06;
      const coreR = Math.hypot(nx * 1.42, coreShiftY * 1.04);
      const corePerturb = (nMed - 0.5) * 0.14 + Math.cos(ang * 5.0 + seedOff) * 0.032;
      const coreMask = 1.0 - smoothstep(0.14, 0.44, coreR + corePerturb);
      const innerHeart = 1.0 - smoothstep(0.03, 0.20, Math.hypot(nx * 1.5, (ny - 0.04) * 1.1));

      // Broad rich saturated scarlet-ruby outer cortex & deep velvety dark-red outer skin rim
      const outerCortex = smoothstep(0.42, 0.88, rn);
      const skinEdge = smoothstep(0.74, 0.99, rn);

      // Deep juicy saturated scarlet-crimson flesh
      let cr = 200 + (nCell - 0.5) * 32 + (nFine - 0.5) * 14;
      let cg = 13 + (nCell - 0.5) * 14;
      let cb = 13 + (nCell - 0.5) * 12;

      // Deep velvety ruby-crimson outer cortex
      cr = cr * (1 - outerCortex * 0.28) + 136 * (outerCortex * 0.28);
      cg = cg * (1 - outerCortex * 0.78) + 3 * (outerCortex * 0.78);
      cb = cb * (1 - outerCortex * 0.66) + 8 * (outerCortex * 0.66);

      // Richer dark ripe-crimson / burgundy outer edge & bevel skin (frames each slice with deep red contrast!)
      cr = cr * (1 - skinEdge * 0.56) + 64 * (skinEdge * 0.56);
      cg *= 1 - skinEdge * 0.78;
      cb *= 1 - skinEdge * 0.62;

      // Crisp pale creamy-rose vascular starburst threads (fading gently before the deep dark-red outer edge)
      const veinEdgeFade = smoothstep(0.91, 0.68, rn);
      cr = cr + (254 - cr) * fineVeins * 0.56 * veinEdgeFade;
      cg = cg + (176 - cg) * fineVeins * 0.56 * veinEdgeFade;
      cb = cb + (164 - cb) * fineVeins * 0.52 * veinEdgeFade;

      // Luminous creamy-peach translucent central heart core
      const coreWeight = clamp(coreMask * (0.84 + nCell * 0.16), 0, 1);
      cr = cr + (252 - cr) * coreWeight * 0.80;
      cg = cg + (188 - cg) * coreWeight * 0.80;
      cb = cb + (172 - cb) * coreWeight * 0.76;

      // Bright translucent vascular halo right around inner core
      const ringCore = Math.exp(-Math.pow((coreR + corePerturb - 0.20) / 0.085, 2.0));
      cr = cr + (255 - cr) * ringCore * 0.42;
      cg = cg + (214 - cg) * ringCore * 0.44;
      cb = cb + (198 - cb) * ringCore * 0.40;

      // Rich warm crimson-salmon center pocket
      cr = cr + (226 - cr) * innerHeart * 0.52;
      cg = cg + (68 - cg) * innerHeart * 0.52;
      cb = cb + (62 - cb) * innerHeart * 0.48;

      let bumpVal = 128 + (nCell - 0.5) * 48 + (nFine - 0.5) * 26 - fineVeins * 24 - innerHeart * 32;
      let sssVal = (146 + coreWeight * 94 - outerCortex * 58 + (nCell - 0.5) * 24) * (1.0 - skinEdge * 0.48);

      // Tiny recessed natural dark-amber/bronze seeds (achenes) right on the scalloped edge
      if (rn > 0.84 && rn < 1.08) {
        for (let k = 0; k < acheneCount; k++) {
          const ac = achenes[k];
          const dx = nx - ac.x;
          const dy = ny - ac.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 0.001936) {
            const d = Math.sqrt(d2);
            const dimple = smoothstep(0.044, 0.018, d);
            cr *= 1 - dimple * 0.42;
            cg *= 1 - dimple * 0.55;
            cb *= 1 - dimple * 0.55;
            bumpVal -= dimple * 56;
            if (d < 0.016) {
              const seedM = smoothstep(0.016, 0.007, d);
              // Natural warm toasted amber-ochre seed (photorealistic, never bright lemon yellow!)
              cr = cr * (1 - seedM) + 188 * seedM;
              cg = cg * (1 - seedM) + 126 * seedM;
              cb = cb * (1 - seedM) + 46 * seedM;
              bumpVal += seedM * 72;
              sssVal *= 1 - seedM * 0.78;
            }
          }
        }
      }

      const idx = (py * size + px) * 4;
      albImg.data[idx] = clamp(Math.round(cr), 0, 255);
      albImg.data[idx + 1] = clamp(Math.round(cg), 0, 255);
      albImg.data[idx + 2] = clamp(Math.round(cb), 0, 255);
      albImg.data[idx + 3] = 255;

      const b = clamp(Math.round(bumpVal), 0, 255);
      bmpImg.data[idx] = bmpImg.data[idx + 1] = bmpImg.data[idx + 2] = b;
      bmpImg.data[idx + 3] = 255;

      const s = clamp(Math.round(sssVal), 0, 255);
      sssImg.data[idx] = sssImg.data[idx + 1] = sssImg.data[idx + 2] = s;
      sssImg.data[idx + 3] = 255;
    }
  }

  albCtx.putImageData(albImg, 0, 0);
  bmpCtx.putImageData(bmpImg, 0, 0);
  sssCtx.putImageData(sssImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;

  const bump = new THREE.CanvasTexture(bmpCanvas);
  bump.anisotropy = 4;

  const translucency = new THREE.CanvasTexture(sssCanvas);
  translucency.anisotropy = 4;

  return { albedo, bump, translucency };
}

/**
 * Procedural macro Blueberry texture set:
 * Deep dark navy-indigo skin + chalky dusty-blue epicuticular waxy bloom + detailed 5-point calyx star.
 */
export function createBlueberryTextures(seed = 207): BlueberryTextures {
  const size = IS_COMPACT_TEX ? 256 : 512;
  const albCanvas = document.createElement('canvas');
  const bmpCanvas = document.createElement('canvas');
  const rghCanvas = document.createElement('canvas');
  albCanvas.width = bmpCanvas.width = rghCanvas.width = size;
  albCanvas.height = bmpCanvas.height = rghCanvas.height = size;

  const albCtx = albCanvas.getContext('2d')!;
  const bmpCtx = bmpCanvas.getContext('2d')!;
  const rghCtx = rghCanvas.getContext('2d')!;

  const albImg = albCtx.createImageData(size, size);
  const bmpImg = bmpCtx.createImageData(size, size);
  const rghImg = rghCtx.createImageData(size, size);

  const rand = mulberry32(seed);
  const off = rand() * 40;

  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    const phi = v * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);

    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const theta = u * Math.PI * 2;
      const sx = Math.cos(theta) * sinP;
      const sy = cosP;
      const sz = Math.sin(theta) * sinP;

      const nBloom = sampleFastFbm3(sx * 0.56 + off, sy * 0.56, sz * 0.56);
      const nFine = sampleFastFbm3(sx * 2.9 + off + 4.3, sy * 2.9, sz * 2.9);

      // Deep rich velvety midnight-indigo / dark navy-plum wet blueberry skin
      let cr = 12 + nFine * 11;
      let cg = 13 + nFine * 12;
      let cb = 30 + nFine * 22;

      // Very delicate natural skin tone variation (NO chalky white freezer-frost blotches!)
      const bloomMask = smoothstep(0.42, 0.78, nBloom) * smoothstep(0.06, 0.22, v);
      cr = cr + (44 - cr) * bloomMask * 0.42;
      cg = cg + (50 - cg) * bloomMask * 0.44;
      cb = cb + (82 - cb) * bloomMask * 0.48;

      // Sculpted 5-pointed calyx star crater & natural dark-plum sepal rims at top pole
      const starWave = 0.5 + 0.5 * Math.cos(theta * 5.0);
      const calyxCrater = 1.0 - smoothstep(0.03, 0.095, v);
      const calyxRim = Math.exp(-Math.pow((v - (0.095 + starWave * 0.032)) / 0.025, 2.0));

      // Subtle natural dark dusty-plum sepal rim (wet & organic, never chalky grey frost)
      cr = cr + (72 - cr) * calyxRim * 0.48;
      cg = cg + (62 - cg) * calyxRim * 0.44;
      cb = cb + (82 - cb) * calyxRim * 0.48;

      // Dark sunken calyx interior cavity
      cr = cr * (1 - calyxCrater * 0.78) + 12 * (calyxCrater * 0.78);
      cg = cg * (1 - calyxCrater * 0.82) + 9 * (calyxCrater * 0.82);
      cb = cb * (1 - calyxCrater * 0.78) + 15 * (calyxCrater * 0.78);

      const roughVal = 34 + bloomMask * 56 + (nFine - 0.5) * 22 + calyxRim * 38;
      const bumpVal = 128 + (nFine - 0.5) * 56 - calyxCrater * 72 + calyxRim * 64;

      const idx = (py * size + px) * 4;
      albImg.data[idx] = clamp(Math.round(cr), 0, 255);
      albImg.data[idx + 1] = clamp(Math.round(cg), 0, 255);
      albImg.data[idx + 2] = clamp(Math.round(cb), 0, 255);
      albImg.data[idx + 3] = 255;

      const b = clamp(Math.round(bumpVal), 0, 255);
      bmpImg.data[idx] = bmpImg.data[idx + 1] = bmpImg.data[idx + 2] = b;
      bmpImg.data[idx + 3] = 255;

      const r = clamp(Math.round(roughVal), 25, 235);
      rghImg.data[idx] = rghImg.data[idx + 1] = rghImg.data[idx + 2] = r;
      rghImg.data[idx + 3] = 255;
    }
  }

  albCtx.putImageData(albImg, 0, 0);
  bmpCtx.putImageData(bmpImg, 0, 0);
  rghCtx.putImageData(rghImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.anisotropy = 8;

  const bump = new THREE.CanvasTexture(bmpCanvas);
  bump.wrapS = THREE.RepeatWrapping;

  const roughness = new THREE.CanvasTexture(rghCanvas);
  roughness.wrapS = THREE.RepeatWrapping;

  return { albedo, bump, roughness };
}

/**
 * Procedural warm toasted-birch wooden popsicle stick texture:
 * Rich warm honey-tan natural birch fibers, crisp longitudinal pores, subtle juice-damp darkening near ice line.
 */
export function createWoodTextures(seed = 311): WoodTextures {
  const w = IS_COMPACT_TEX ? 128 : 256;
  const h = IS_COMPACT_TEX ? 256 : 512;
  const albCanvas = document.createElement('canvas');
  const bmpCanvas = document.createElement('canvas');
  albCanvas.width = bmpCanvas.width = w;
  albCanvas.height = bmpCanvas.height = h;

  const albCtx = albCanvas.getContext('2d')!;
  const bmpCtx = bmpCanvas.getContext('2d')!;
  const albImg = albCtx.createImageData(w, h);
  const bmpImg = bmpCtx.createImageData(w, h);

  const rand = mulberry32(seed);
  const off = rand() * 50;

  for (let py = 0; py < h; py++) {
    const v = py / (h - 1); // 0 = top inside ice, 1 = bottom handle
    for (let px = 0; px < w; px++) {
      const u = px / (w - 1);

      const warp = fbm2D(u * 4.2 + off, v * 1.4 + 5.1, 3) * 0.42;
      const grain = fbm2D(u * 36.0 + warp * 9.0 + off, v * 2.5 + 21.3, 4);
      const fineFiber = fbm2D(u * 135.0 + off, v * 12.0 + 54.7, 2);
      const microPore = fbm2D(u * 210.0 + off, v * 46.0 + 87.2, 2);
      const ring = 0.5 + 0.5 * Math.sin((u * 18.0 + warp * 12.0) * Math.PI);

      // Rich warm honey-birch wood tone (matches natural wet studio birch stick in reference!)
      const poreDark = smoothstep(0.68, 0.90, microPore) * 26;
      let cr = 186 + (grain - 0.5) * 44 - ring * 18 + (fineFiber - 0.5) * 22 - poreDark;
      let cg = 132 + (grain - 0.5) * 38 - ring * 18 + (fineFiber - 0.5) * 18 - poreDark * 0.9;
      let cb = 82 + (grain - 0.5) * 28 - ring * 14 + (fineFiber - 0.5) * 14 - poreDark * 0.7;

      // Subtle natural side bevel shading along stick edges
      const edgeShade = smoothstep(0.32, 0.50, Math.abs(u - 0.5));
      cr *= 1 - edgeShade * 0.16;
      cg *= 1 - edgeShade * 0.18;
      cb *= 1 - edgeShade * 0.16;

      // Damp berry-juice wicking near the ice contact line
      const damp = 1.0 - smoothstep(0.16, 0.46, v + (grain - 0.5) * 0.08);
      cr = cr * (1 - damp * 0.12) + 158 * (damp * 0.10);
      cg = cg * (1 - damp * 0.24);
      cb = cb * (1 - damp * 0.26);

      const bumpVal = 128 + (fineFiber - 0.5) * 76 + (grain - 0.5) * 44 - poreDark * 1.4;

      const idx = (py * w + px) * 4;
      albImg.data[idx] = clamp(Math.round(cr), 0, 255);
      albImg.data[idx + 1] = clamp(Math.round(cg), 0, 255);
      albImg.data[idx + 2] = clamp(Math.round(cb), 0, 255);
      albImg.data[idx + 3] = 255;

      const b = clamp(Math.round(bumpVal), 0, 255);
      bmpImg.data[idx] = bmpImg.data[idx + 1] = bmpImg.data[idx + 2] = b;
      bmpImg.data[idx + 3] = 255;
    }
  }

  albCtx.putImageData(albImg, 0, 0);
  bmpCtx.putImageData(bmpImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;

  const bump = new THREE.CanvasTexture(bmpCanvas);
  bump.anisotropy = 4;

  // High-res dedicated carving depth + bevel mask mapped strictly to the hidden upper birch stick
  // underneath the ice cream (1024x340 -> exact 3.01:1 square-texel match to stick span 0.53 x 0.176!)
  const cw = CARVE_TEX_W;
  const ch = CARVE_TEX_H;
  const carveCanvas = document.createElement('canvas');
  carveCanvas.width = cw;
  carveCanvas.height = ch;
  const cCtx = carveCanvas.getContext('2d')!;

  const drawTrackedCentered = (
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    tracking: number,
  ) => {
    const chars = Array.from(text);
    const widths = chars.map((chChar) => ctx.measureText(chChar).width);
    const totalW = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
    let cursor = cx - totalW * 0.5;
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cursor + widths[i] * 0.5, cy);
      cursor += widths[i] + tracking;
    }
  };

  const renderCarving = () => {
    // Scratch crisp pass (R channel = V-groove depth) & soft bevel pass (G channel = pressed edge compression)
    const sharpCanvas = document.createElement('canvas');
    sharpCanvas.width = cw;
    sharpCanvas.height = ch;
    const sCtx = sharpCanvas.getContext('2d')!;

    const softCanvas = document.createElement('canvas');
    softCanvas.width = cw;
    softCanvas.height = ch;
    const bCtx = softCanvas.getContext('2d')!;

    const paintLetters = (ctx: CanvasRenderingContext2D, blurPx: number) => {
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Crisp artisanal laser/chisel-carved birch lettering centered on the hidden upper shaft (~2x bolder)
      const sc = cw / 1024;
      ctx.font = `700 ${Math.round(84 * sc)}px "IBM Plex Sans", "Inter", "Helvetica Neue", system-ui, sans-serif`;
      drawTrackedCentered(ctx, 'THEO TILLBERG', cw * 0.5, ch * 0.34, 9.0 * sc);

      ctx.font = `600 ${Math.round(62 * sc)}px "IBM Plex Sans", "Inter", "Helvetica Neue", system-ui, sans-serif`;
      drawTrackedCentered(ctx, 'CODEVEMBER 26 - MELT', cw * 0.5, ch * 0.69, 4.5 * sc);
      ctx.restore();
    };

    const blurSc = cw / 1024;
    paintLetters(sCtx, 2.2 * blurSc);
    paintLetters(bCtx, 5.4 * blurSc);

    const sData = sCtx.getImageData(0, 0, cw, ch).data;
    const bData = bCtx.getImageData(0, 0, cw, ch).data;
    const outImg = cCtx.createImageData(cw, ch);
    for (let i = 0; i < outImg.data.length; i += 4) {
      outImg.data[i] = sData[i + 3]; // R = crisp V-groove depth
      outImg.data[i + 1] = bData[i + 3]; // G = soft pressed-wood halo
      outImg.data[i + 2] = 0;
      outImg.data[i + 3] = 255;
    }
    cCtx.putImageData(outImg, 0, 0);
  };

  renderCarving();
  const carving = new THREE.CanvasTexture(carveCanvas);
  carving.anisotropy = 8;
  carving.generateMipmaps = true;
  carving.minFilter = THREE.LinearMipmapLinearFilter;
  carving.magFilter = THREE.LinearFilter;
  carving.wrapS = THREE.ClampToEdgeWrapping;
  carving.wrapT = THREE.ClampToEdgeWrapping;

  // Re-bake cleanly once IBM Plex Sans finishes loading (skip if already loaded or disposed!)
  let carveDisposed = false;
  carving.addEventListener('dispose', () => {
    carveDisposed = true;
  });
  if (
    typeof document !== 'undefined' &&
    document.fonts &&
    document.fonts.ready &&
    (!document.fonts.check || !document.fonts.check('700 84px "IBM Plex Sans"'))
  ) {
    document.fonts.ready.then(() => {
      if (carveDisposed) return;
      renderCarving();
      carving.needsUpdate = true;
    });
  }

  return { albedo, bump, carving };
}

function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fbm2(x: number, y: number, octaves: number): number {
  return fbm2D(x, y, octaves);
}

export interface ToppingTextureSet {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

/**
 * Generates organic juicy cellular skin & micro-fuzz textures for raspberry drupelets.
 * Kept near warm luminous neutral so per-drupelet linear vertex colors can freely paint
 * deep ruby-crimson, occasional odd unripe/blush/peach/plum drupelets, halved hollow cup walls,
 * and delicate pale botanical hairs without crushing green/blue channels!
 */
export function createRaspberryTextures(seed: number): ToppingTextureSet {
  const size = IS_COMPACT_TEX ? 128 : 256;
  const albCanvas = createOffscreenCanvas(size, size);
  const bumpCanvas = createOffscreenCanvas(size, size);
  const roughCanvas = createOffscreenCanvas(size, size);
  const aCtx = albCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const off = seed * 11.7;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const n1 = fbm2(u * 9 + off, v * 9, 3);
      const n2 = fbm2(u * 28 + off * 1.4, v * 28, 2);
      const nFine = fbm2(u * 62 + off * 2.1, v * 62, 2);
      const fuzz = smoothstep(0.56, 0.92, nFine);

      // Subtle juicy skin mottling + fine micro-vellum variation (neutral warm-white base for vertex-color tinting)
      const base = 212 + n1 * 32 + (n2 - 0.5) * 16 + fuzz * 10;
      const r = clamp(base + 8, 0, 255);
      const g = clamp(base - 4, 0, 255);
      const b = clamp(base - 2, 0, 255);
      const bumpV = clamp(104 + n1 * 62 + n2 * 52 + fuzz * 36, 0, 255);
      const roughV = clamp(88 + fuzz * 86 + (1 - n1) * 44, 0, 255);

      const idx = (py * size + px) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;

      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bumpV;
      bImg.data[idx + 3] = 255;

      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = roughV;
      rImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  return { albedo, bump, roughness };
}

/**
 * Generates tempered dark chocolate chunk textures (rich espresso cocoa + subtle fracture micro-grain).
 */
export function createChocolateChunkTextures(seed: number): ToppingTextureSet {
  const size = IS_COMPACT_TEX ? 128 : 256;
  const albCanvas = createOffscreenCanvas(size, size);
  const bumpCanvas = createOffscreenCanvas(size, size);
  const roughCanvas = createOffscreenCanvas(size, size);
  const aCtx = albCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const off = seed * 15.3;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const nMacro = fbm2(u * 6 + off, v * 6, 3);
      const nGrain = fbm2(u * 28 + off * 2.1, v * 28, 3);
      const chip = smoothstep(0.60, 0.88, nMacro);

      const r = clamp(44 + nMacro * 24 + chip * 12, 0, 255);
      const g = clamp(22 + nMacro * 14 + chip * 7, 0, 255);
      const b = clamp(12 + nMacro * 8 + chip * 4, 0, 255);
      const bumpV = clamp(100 + nGrain * 85 + nMacro * 45, 0, 255);
      const roughV = clamp(92 + nGrain * 75 + (1 - chip) * 28, 0, 255);

      const idx = (py * size + px) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;
      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bumpV;
      bImg.data[idx + 3] = 255;
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = roughV;
      rImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  return { albedo, bump, roughness };
}

/**
 * Generates vibrant sun-yellow dimpled lemon zest peel textures (citrus oil-gland pores + pale pith rim).
 */
export function createLemonZestTextures(seed: number): ToppingTextureSet {
  const size = IS_COMPACT_TEX ? 128 : 256;
  const albCanvas = createOffscreenCanvas(size, size);
  const bumpCanvas = createOffscreenCanvas(size, size);
  const roughCanvas = createOffscreenCanvas(size, size);
  const aCtx = albCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const off = seed * 9.3;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      // Subtle dimpled citrus oil-gland pores across the peel
      const dimple = Math.sin(u * Math.PI * 22 + off) * Math.sin(v * Math.PI * 10 + off * 0.7);
      const pore = smoothstep(0.35, 0.95, dimple * 0.5 + 0.5);
      const n = fbm2(u * 12 + off, v * 12, 3);
      // Slight pale creamy pith along very outer edge v near 0/1
      const edgePith = smoothstep(0.36, 0.50, Math.abs(v - 0.5));

      let r = 248 + n * 7 - pore * 12;
      let g = 212 + n * 18 - pore * 18;
      let b = 26 + n * 24 + edgePith * 145;
      r = clamp(r + edgePith * 6, 0, 255);
      g = clamp(g + edgePith * 28, 0, 255);
      b = clamp(b, 0, 255);

      const bumpV = clamp(155 - pore * 95 + n * 35, 0, 255);
      const roughV = clamp(82 + edgePith * 90 + pore * 30, 0, 255);

      const idx = (py * size + px) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;
      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bumpV;
      bImg.data[idx + 3] = 255;
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = roughV;
      rImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  return { albedo, bump, roughness };
}

/**
 * Generates crunchy baked kaksmulor (cookie crumbles) textures:
 * 'dark' = rich Oreo-style dark cocoa wafer crumb; 'butter' = toasted golden-brown butter biscuit crumb.
 */
export function createKaksmulorTextures(seed: number, variant: 'dark' | 'butter'): ToppingTextureSet {
  const size = IS_COMPACT_TEX ? 128 : 256;
  const albCanvas = createOffscreenCanvas(size, size);
  const bumpCanvas = createOffscreenCanvas(size, size);
  const roughCanvas = createOffscreenCanvas(size, size);
  const aCtx = albCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const off = seed * 13.9;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      const crumb = fbm2(u * 20 + off, v * 20, 4);
      const pores = smoothstep(0.28, 0.78, fbm2(u * 42 + off * 1.7, v * 42, 2));
      const bakeSpeck = smoothstep(0.68, 0.94, crumb);

      let r: number;
      let g: number;
      let b: number;
      if (variant === 'dark') {
        // Deep matte dark cocoa cookie wafer (authentic Oreo-style cookies & cream!)
        r = clamp(20 + crumb * 20 + bakeSpeck * 12 - (1 - pores) * 8, 8, 64);
        g = clamp(15 + crumb * 16 + bakeSpeck * 9 - (1 - pores) * 7, 7, 52);
        b = clamp(14 + crumb * 14 + bakeSpeck * 8 - (1 - pores) * 6, 7, 48);
      } else {
        // Warm toasted golden-brown Swedish shortbread / digestive cookie crumble
        r = clamp(146 + crumb * 52 - (1 - pores) * 26, 84, 218);
        g = clamp(102 + crumb * 42 - (1 - pores) * 22, 54, 174);
        b = clamp(56 + crumb * 28 - (1 - pores) * 18, 28, 116);
      }

      const bumpV = clamp(65 + crumb * 125 + pores * 65, 0, 255);
      const roughV = clamp(195 + (1 - pores) * 48 + crumb * 18, 0, 255);

      const idx = (py * size + px) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;
      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = bumpV;
      bImg.data[idx + 3] = 255;
      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = roughV;
      rImg.data[idx + 3] = 255;
    }
  }
  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  return { albedo, bump, roughness };
}

/**
 * Per-seed procedural texture cache so Customize toggles reuse baked CanvasTextures in <1ms.
 * Call `disposeSeedTextureCache()` when switching to a new seed (`New mix`) or tearing down.
 */
const _seedTexCache = new Map<string, StrawberryTextures | BlueberryTextures | WoodTextures | ToppingTextureSet>();

function getOrBake<T extends StrawberryTextures | BlueberryTextures | WoodTextures | ToppingTextureSet>(
  key: string,
  factory: () => T,
): T {
  const existing = _seedTexCache.get(key) as T | undefined;
  if (existing) return existing;
  const created = factory();
  _seedTexCache.set(key, created);
  return created;
}

export function getCachedStrawberryTextures(seed: number): StrawberryTextures {
  return getOrBake(`strawberry:${seed}`, () => createStrawberryTextures(seed));
}

export function getCachedBlueberryTextures(seed: number): BlueberryTextures {
  return getOrBake(`blueberry:${seed}`, () => createBlueberryTextures(seed));
}

export function getCachedWoodTextures(seed: number): WoodTextures {
  return getOrBake(`wood:${seed}`, () => createWoodTextures(seed));
}

export function getCachedRaspberryTextures(seed: number): ToppingTextureSet {
  return getOrBake(`raspberry:${seed}`, () => createRaspberryTextures(seed));
}

export function getCachedChocolateChunkTextures(seed: number): ToppingTextureSet {
  return getOrBake(`chocolate:${seed}`, () => createChocolateChunkTextures(seed));
}

export function getCachedLemonZestTextures(seed: number): ToppingTextureSet {
  return getOrBake(`lemon:${seed}`, () => createLemonZestTextures(seed));
}

export function getCachedKaksmulorTextures(seed: number, variant: 'dark' | 'butter'): ToppingTextureSet {
  return getOrBake(`kaksmulor:${variant}:${seed}`, () => createKaksmulorTextures(seed, variant));
}

export function disposeSeedTextureCache(): void {
  for (const entry of _seedTexCache.values()) {
    for (const tex of Object.values(entry)) {
      if (tex instanceof THREE.Texture) tex.dispose();
    }
  }
  _seedTexCache.clear();
}

/**
 * Macro backlit photography studio PMREM environment:
 * Luminous warm-cream rear lightbox + crisp side specular strip-lights + dark front negative-fill flags.
 */
export function createMacroStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xb8a39a);

  const tempGeos: THREE.BufferGeometry[] = [];
  const tempMats: THREE.Material[] = [];
  const addCard = (
    w: number,
    h: number,
    mat: THREE.MeshBasicMaterial,
    pos: [number, number, number],
    lookAt?: [number, number, number],
  ) => {
    const g = new THREE.PlaneGeometry(w, h);
    tempGeos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (lookAt) m.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    envScene.add(m);
  };

  const backMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.95, 2.75), side: THREE.DoubleSide });
  const leftMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 3.5, 3.45), side: THREE.DoubleSide });
  const rightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.3, 3.2), side: THREE.DoubleSide });
  const topMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.28, 2.18), side: THREE.DoubleSide });
  const negMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.06, 0.07), side: THREE.DoubleSide });
  tempMats.push(backMat, leftMat, rightMat, topMat, negMat);

  addCard(14, 14, backMat, [0, 0.2, -6.5]);
  addCard(2.0, 12, leftMat, [-5.8, 0.5, 2.2], [0, 0.3, 0]);
  addCard(2.2, 12, rightMat, [5.8, 0.6, 2.0], [0, 0.3, 0]);
  addCard(8, 3.0, topMat, [0, 6.2, 1.0], [0, 0, 0]);
  addCard(3.4, 9, negMat, [-4.0, 0, 5.2], [0, 0, 0]);
  addCard(3.4, 9, negMat, [4.0, 0, 5.2], [0, 0, 0]);

  const rt = pmrem.fromScene(envScene, 0.025);
  pmrem.dispose();
  for (const g of tempGeos) g.dispose();
  for (const m of tempMats) m.dispose();
  return rt.texture;
}
