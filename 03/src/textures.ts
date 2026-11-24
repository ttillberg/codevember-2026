import * as THREE from 'three';
import { clamp, fbm3, mulberry32, smoothstep } from './rng';

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
  const size = 512;
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
  const achenes: Array<{ ang: number; r: number }> = [];
  for (let i = 0; i < acheneCount; i++) {
    const a = (i / acheneCount) * Math.PI * 2 - Math.PI + (rand() - 0.5) * 0.06;
    const br = strawberryBoundaryRadius(a);
    achenes.push({ ang: a, r: br * (0.945 + rand() * 0.025) });
  }

  for (let py = 0; py < size; py++) {
    const ny = 1.0 - (py / (size - 1)) * 2.0;
    for (let px = 0; px < size; px++) {
      const nx = (px / (size - 1)) * 2.0 - 1.0;

      const r = Math.hypot(nx, ny);
      const ang = Math.atan2(ny, nx);
      const bR = strawberryBoundaryRadius(ang);
      const rn = r / Math.max(0.001, bR);

      // Multi-scale fibrous botanical noise
      const nCell = fbm3(nx * 28 + seedOff, ny * 28, 1.3, 4);
      const nMed = fbm3(nx * 7.5 + seedOff, ny * 7.5, 4.7, 3);
      const nFine = fbm3(nx * 54 + seedOff, ny * 54, 9.2, 2);

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

      // Broad rich saturated scarlet-ruby outer cortex & deep velvety crimson skin rim
      const outerCortex = smoothstep(0.46, 0.90, rn);
      const skinEdge = smoothstep(0.84, 1.00, rn);

      // Deep juicy saturated scarlet-crimson flesh
      let cr = 204 + (nCell - 0.5) * 32 + (nFine - 0.5) * 14;
      let cg = 14 + (nCell - 0.5) * 14;
      let cb = 14 + (nCell - 0.5) * 12;

      // Deep velvety ruby-crimson outer cortex
      cr = cr * (1 - outerCortex * 0.20) + 162 * (outerCortex * 0.20);
      cg = cg * (1 - outerCortex * 0.72) + 4 * (outerCortex * 0.72);
      cb = cb * (1 - outerCortex * 0.60) + 10 * (outerCortex * 0.60);

      // Dark ruby-burgundy outer skin perimeter (pops crisply through backlit ice!)
      cr = cr * (1 - skinEdge * 0.36) + 108 * (skinEdge * 0.36);
      cg *= 1 - skinEdge * 0.65;
      cb *= 1 - skinEdge * 0.45;

      // Crisp pale creamy-rose vascular starburst threads (clearly legible through frosted ice!)
      cr = cr + (254 - cr) * fineVeins * 0.58;
      cg = cg + (178 - cg) * fineVeins * 0.58;
      cb = cb + (166 - cb) * fineVeins * 0.55;

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
      let sssVal = 148 + coreWeight * 92 - outerCortex * 52 + (nCell - 0.5) * 24;

      // Tiny recessed natural dark-amber/bronze seeds (achenes) right on the scalloped edge
      for (let k = 0; k < achenes.length; k++) {
        const ac = achenes[k];
        const ax = Math.cos(ac.ang) * ac.r;
        const ay = Math.sin(ac.ang) * ac.r;
        const d = Math.hypot(nx - ax, ny - ay);
        if (d < 0.044) {
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
  const size = 512;
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

      const nBloom = fbm3(sx * 3.4 + off, sy * 3.4, sz * 3.4, 4);
      const nFine = fbm3(sx * 18.0 + off, sy * 18.0, sz * 18.0, 3);

      // Deep dark navy-plum berry skin
      let cr = 16 + nFine * 14;
      let cg = 16 + nFine * 15;
      let cb = 36 + nFine * 26;

      // Dusty pale slate-blue waxy bloom patches
      const bloomMask = smoothstep(0.36, 0.72, nBloom) * smoothstep(0.05, 0.20, v);
      cr = cr + (96 - cr) * bloomMask * 0.56;
      cg = cg + (108 - cg) * bloomMask * 0.58;
      cb = cb + (146 - cb) * bloomMask * 0.65;

      // Sculpted 5-pointed calyx star crater & dusty-mauve sepal rims at top pole
      const starWave = 0.5 + 0.5 * Math.cos(theta * 5.0);
      const calyxCrater = 1.0 - smoothstep(0.03, 0.095, v);
      const calyxRim = Math.exp(-Math.pow((v - (0.095 + starWave * 0.032)) / 0.025, 2.0));

      // Pale dusty-lavender-grey sepal lip (very recognizable on macro blueberries!)
      cr = cr + (134 - cr) * calyxRim * 0.55;
      cg = cg + (122 - cg) * calyxRim * 0.52;
      cb = cb + (142 - cb) * calyxRim * 0.55;

      // Dark sunken calyx interior cavity
      cr = cr * (1 - calyxCrater * 0.75) + 18 * (calyxCrater * 0.75);
      cg = cg * (1 - calyxCrater * 0.80) + 14 * (calyxCrater * 0.80);
      cb = cb * (1 - calyxCrater * 0.75) + 20 * (calyxCrater * 0.75);

      const roughVal = 46 + bloomMask * 118 + (nFine - 0.5) * 28 + calyxRim * 45;
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
  const w = 256;
  const h = 512;
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

      const warp = fbm3(u * 4.2 + off, v * 1.4, 0.5, 3) * 0.42;
      const grain = fbm3(u * 36.0 + warp * 9.0 + off, v * 2.5, 2.1, 4);
      const fineFiber = fbm3(u * 135.0 + off, v * 12.0, 5.4, 2);
      const microPore = fbm3(u * 210.0 + off, v * 46.0, 8.7, 2);
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

  return { albedo, bump };
}

/**
 * Macro backlit photography studio PMREM environment:
 * Luminous warm-cream rear lightbox + crisp side specular strip-lights + dark front negative-fill flags.
 */
export function createMacroStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xb8a39a);

  const backBox = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.95, 2.75), side: THREE.DoubleSide }),
  );
  backBox.position.set(0, 0.2, -6.5);
  envScene.add(backBox);

  const leftStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 3.5, 3.45), side: THREE.DoubleSide }),
  );
  leftStrip.position.set(-5.8, 0.5, 2.2);
  leftStrip.lookAt(0, 0.3, 0);
  envScene.add(leftStrip);

  const rightStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 3.3, 3.2), side: THREE.DoubleSide }),
  );
  rightStrip.position.set(5.8, 0.6, 2.0);
  rightStrip.lookAt(0, 0.3, 0);
  envScene.add(rightStrip);

  const topStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 3.0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.28, 2.18), side: THREE.DoubleSide }),
  );
  topStrip.position.set(0, 6.2, 1.0);
  topStrip.lookAt(0, 0, 0);
  envScene.add(topStrip);

  const negMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.06, 0.07), side: THREE.DoubleSide });
  const negL = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), negMat);
  negL.position.set(-4.0, 0, 5.2);
  negL.lookAt(0, 0, 0);
  envScene.add(negL);

  const negR = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), negMat);
  negR.position.set(4.0, 0, 5.2);
  negR.lookAt(0, 0, 0);
  envScene.add(negR);

  const rt = pmrem.fromScene(envScene, 0.025);
  pmrem.dispose();
  return rt.texture;
}
