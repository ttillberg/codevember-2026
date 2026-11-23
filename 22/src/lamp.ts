import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Vintage 1970s/80s Scandinavian orange telescoping desk lamp modeled in Blender
 * (`22/model/lamp.py` -> `22/public/lamp.glb`). Clicking anywhere on the lamp
 * toggles the warm tungsten desk lighting on/off.
 */
export class OrangeDeskLamp {
  readonly root = new THREE.Group();
  readonly interactiveMeshes: THREE.Object3D[] = [];

  readonly spotLight: THREE.SpotLight;
  readonly wallGlow: THREE.PointLight;

  private bulbMat: THREE.MeshStandardMaterial | null = null;
  private innerShadeMat: THREE.MeshStandardMaterial | null = null;
  private switchRocker: THREE.Object3D | null = null;

  lit = true;
  private lightAnim = 1.0;

  constructor(onReady?: () => void) {
    // Live warm tungsten SpotLight (re-parented onto Blender's `light_origin` / `light_target` once loaded)
    this.spotLight = new THREE.SpotLight(0xffdfb0, 28, 19, Math.PI * 0.46, 0.62, 1.4);
    this.spotLight.position.set(1.75, 3.25, 0.25);
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.set(1024, 1024);
    this.spotLight.shadow.bias = -0.0004;
    this.spotLight.shadow.normalBias = 0.02;
    this.root.add(this.spotLight);

    const fallbackTarget = new THREE.Object3D();
    fallbackTarget.position.set(3.2, 0.2, 1.0);
    this.root.add(fallbackTarget);
    this.spotLight.target = fallbackTarget;

    // Warm wall bounce glow near the shade
    this.wallGlow = new THREE.PointLight(0xffcb88, 4.4, 12.5, 1.55);
    this.wallGlow.position.set(0.55, 3.65, -0.55);
    this.root.add(this.wallGlow);

    // Clamped off-screen to the left desk border so the full-size shade hangs big in the mid-left open space
    // cleanly below the title text and clear of both the 1702 monitor and cheat sheet
    this.root.position.set(-7.62, -1.46, 0.35);
    this.root.rotation.set(0, -0.06, -0.32);
    this.root.scale.setScalar(1.34);

    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}lamp.glb`;
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      this.root.add(model);

      let lightOrigin: THREE.Object3D | null = null;
      let lightTarget: THREE.Object3D | null = null;
      let shadeOuter: THREE.Object3D | null = null;

      model.traverse((obj) => {
        if (obj.name === 'light_origin') lightOrigin = obj;
        if (obj.name === 'light_target') lightTarget = obj;
        if (obj.name === 'switch_rocker') this.switchRocker = obj;
        if (obj.name === 'shade_outer') shadeOuter = obj;

        if (obj instanceof THREE.Mesh) {
          const skipShadow = obj.name === 'bulb' || obj.name === 'shade_inner' || obj.name.startsWith('cord_');
          obj.castShadow = !skipShadow;
          obj.receiveShadow = true;
          obj.userData.hit = { kind: 'lamp' };
          this.interactiveMeshes.push(obj);

          if (obj.name === 'bulb' && obj.material instanceof THREE.MeshStandardMaterial) {
            this.bulbMat = obj.material;
          }
          if (obj.name === 'shade_inner' && obj.material instanceof THREE.MeshStandardMaterial) {
            this.innerShadeMat = obj.material;
          }
        }
      });

      // Slap a slightly crooked, heat-curled 1980s Garbage Pail Kids sticker onto the flared orange shade!
      if (shadeOuter) {
        const sticker = buildLampShadeSticker();
        (shadeOuter as THREE.Object3D).add(sticker);
        this.interactiveMeshes.push(sticker);
      }

      // Attach live SpotLight precisely to the Blender shade's bulb origin & aim axis
      if (lightOrigin && lightTarget) {
        const originObj = lightOrigin as THREE.Object3D;
        const targetObj = lightTarget as THREE.Object3D;
        originObj.add(this.spotLight);
        this.spotLight.position.set(0, 0, 0);
        this.spotLight.target = targetObj;
      }

      onReady?.();
    }, undefined, (err) => {
      console.warn('Failed to load desk lamp model:', err);
    });
  }

  toggle(): boolean {
    this.lit = !this.lit;
    return this.lit;
  }

  update(dt: number) {
    const target = this.lit ? 1 : 0;
    this.lightAnim += (target - this.lightAnim) * Math.min(1, dt * 16);

    this.spotLight.intensity = this.lightAnim * 28;
    this.wallGlow.intensity = this.lightAnim * 4.4;
    if (this.bulbMat) {
      this.bulbMat.emissiveIntensity = this.lightAnim * 3.6;
    }
    if (this.innerShadeMat) {
      this.innerShadeMat.emissiveIntensity = this.lightAnim * 0.78;
    }
    if (this.switchRocker) {
      this.switchRocker.rotation.x = this.lit ? -0.28 : 0.28;
    }
  }
}

/**
 * Builds a curved conical collector-card sticker wrapped onto the right flank of `shade_outer`,
 * with a subtle beveled paper border, soft contact shadow, and a jagged torn/peeled-off corner
 * exposing the red enamel and a sliver of rough white paper backing underneath.
 */
function buildLampShadeSticker(): THREE.Mesh {
  const segU = 22;
  const segV = 22;
  const geo = new THREE.PlaneGeometry(1, 1, segU, segV);
  const pos = geo.attributes.position;

  // Exact conical flare coordinates of `shade_outer` (Y-up in glTF space)
  const yTop = -0.545;
  const rTop = 0.355;
  const yBot = -0.940;
  const rBot = 0.610;
  const flareLen = Math.hypot(rBot - rTop, yTop - yBot); // 0.470

  // Classic 250x350 (5:7) collector card proportions + small margin for contact shadow
  const stickerH = 0.43;
  const stickerW = stickerH * (250 / 350);
  const sCenter = flareLen * 0.55;
  const thetaCenter = 0.94; // right flank of the shade flare (matches sketch!)
  const tilt = 0.03;        // aligned naturally along the right conical slope
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // -0.5..+0.5
    const v = pos.getY(i); // -0.5..+0.5 (+0.5 = top)

    const dx = u * stickerW * cosT - v * stickerH * sinT;
    const ds = u * stickerW * sinT + v * stickerH * cosT;

    const s = sCenter - ds;
    const t = s / flareLen;
    const r = rTop + (rBot - rTop) * t;
    const y = yTop + (yBot - yTop) * t;
    const theta = thetaCenter + dx / Math.max(0.15, r);

    // Subtle physical card thickness with a gentle beveled perimeter drop-off at the outer 6% edge
    const edgeDist = Math.min(0.5 - Math.abs(u), 0.5 - Math.abs(v));
    const bevelRise = Math.min(1, edgeDist / 0.045);
    const cardThickness = 0.002 + bevelRise * 0.0065;

    // Slight warm-bulb curl near the torn upper-right corner
    const peelU = Math.max(0, u - 0.14);
    const peelV = Math.max(0, v - 0.14);
    const peelLift = peelU * peelV * 0.09;

    const rOff = r + cardThickness + peelLift;
    pos.setXYZ(i, Math.sin(theta) * rOff, y, Math.cos(theta) * rOff);
  }
  geo.computeVertexNormals();

  // Offscreen weathered collector card texture + beveled border bump map
  const W = 512;
  const H = 716;
  const colCanvas = document.createElement('canvas');
  colCanvas.width = W;
  colCanvas.height = H;
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = W;
  bumpCanvas.height = H;

  const colTex = new THREE.CanvasTexture(colCanvas);
  colTex.colorSpace = THREE.SRGBColorSpace;
  colTex.anisotropy = 8;

  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.anisotropy = 4;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    renderWeatheredCollectorCard(colCanvas, bumpCanvas, img);
    colTex.needsUpdate = true;
    bumpTex.needsUpdate = true;
  };
  img.src = `${import.meta.env.BASE_URL}gpk-sticker.jpg`;

  const mat = new THREE.MeshPhysicalMaterial({
    map: colTex,
    bumpMap: bumpTex,
    bumpScale: 0.012,
    roughness: 0.34,
    metalness: 0.02,
    clearcoat: 0.38,
    clearcoatRoughness: 0.24,
    transparent: true,
    alphaTest: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.hit = { kind: 'lamp' };
  return mesh;
}

/**
 * Composites the Garbage Pail Kids collector card with:
 * - Soft outer contact shadow on the enamel
 * - Crisp rounded card silhouette with subtle beveled paper border
 * - Jagged torn/removed top-right corner chunk + tiny lower-left scratch nick exposing white fibrous tear edge
 */
function renderWeatheredCollectorCard(
  colCanvas: HTMLCanvasElement,
  bumpCanvas: HTMLCanvasElement,
  img: HTMLImageElement,
) {
  const W = colCanvas.width;
  const H = colCanvas.height;
  const ctx = colCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;

  const pad = 16;
  const cw = W - pad * 2;
  const ch = H - pad * 2;
  const r = 14;

  // Jagged torn-out top-right corner + tiny picked-away left edge notch
  const traceTearOut = (c: CanvasRenderingContext2D, expand = 0) => {
    // 1. Main torn-off top-right chunk (jagged ripped paper profile!)
    c.beginPath();
    c.moveTo(W * 0.62 - expand, 0);
    c.lineTo(W, 0);
    c.lineTo(W, H * 0.30 + expand);
    c.lineTo(W * 0.90 - expand * 0.8, H * 0.27 + expand * 0.5);
    c.lineTo(W * 0.85 - expand, H * 0.21 + expand * 0.5);
    c.lineTo(W * 0.78 - expand, H * 0.22 + expand * 0.6);
    c.lineTo(W * 0.74 - expand, H * 0.14 + expand * 0.5);
    c.lineTo(W * 0.68 - expand, H * 0.10 + expand * 0.5);
    c.lineTo(W * 0.65 - expand, H * 0.04 + expand * 0.3);
    c.closePath();

    // 2. Tiny picked-at edge chip along the lower-left border
    c.moveTo(0, H * 0.73 - expand);
    c.lineTo(pad + 18 + expand, H * 0.75 - expand * 0.4);
    c.lineTo(pad + 11 + expand, H * 0.79);
    c.lineTo(pad + 22 + expand, H * 0.83 + expand * 0.3);
    c.lineTo(pad + 8 + expand, H * 0.86 + expand * 0.5);
    c.lineTo(0, H * 0.87 + expand);
    c.closePath();
  };

  // --- 1. Color + Alpha Canvas ---
  ctx.clearRect(0, 0, W, H);

  // Soft dark contact shadow hugging the beveled card edge
  ctx.save();
  ctx.shadowColor = 'rgba(18, 4, 0, 0.55)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#e8e2d4';
  ctx.beginPath();
  ctx.roundRect(pad, pad, cw, ch, r);
  ctx.fill();
  ctx.restore();

  // Clip card interior and draw artwork with slight vintage 1985 warm paper tone
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, pad, cw, ch, r);
  ctx.clip();

  ctx.fillStyle = '#f2ede2';
  ctx.fillRect(pad, pad, cw, ch);
  ctx.drawImage(img, pad + 4, pad + 4, cw - 8, ch - 8);

  // Subtle warm-bulb aging tint
  ctx.fillStyle = 'rgba(245, 224, 185, 0.10)';
  ctx.fillRect(pad, pad, cw, ch);

  // Subtle beveled border lighting (bright top-left paper rim, shaded bottom-right rim!)
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(255, 252, 245, 0.55)';
  ctx.beginPath();
  ctx.roundRect(pad + 3, pad + 3, cw - 6, ch - 6, r - 2);
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(65, 52, 42, 0.32)';
  ctx.beginPath();
  ctx.roundRect(pad + 1, pad + 1, cw - 2, ch - 2, r);
  ctx.stroke();

  // Exposed rough white fibrous paper-backing lip right along the torn edges!
  ctx.save();
  traceTearOut(ctx, 11);
  ctx.fillStyle = '#ece6d8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 105, 88, 0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // Faint diagonal paper crease near the tear
  ctx.strokeStyle = 'rgba(255, 250, 240, 0.32)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.52, pad);
  ctx.lineTo(W - pad, H * 0.42);
  ctx.stroke();
  ctx.restore();

  // Punch out the completely removed torn corner & nick cleanly to transparent alpha!
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  traceTearOut(ctx, 0);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // --- 2. Beveled Border & Tear-Shelf Bump Map ---
  bCtx.fillStyle = '#000000';
  bCtx.fillRect(0, 0, W, H);

  // Beveled card body (smooth soft ramp from outer border to raised card surface)
  bCtx.save();
  bCtx.shadowColor = '#ffffff';
  bCtx.shadowBlur = 10;
  bCtx.fillStyle = '#ffffff';
  bCtx.beginPath();
  bCtx.roundRect(pad + 5, pad + 5, cw - 10, ch - 10, Math.max(4, r - 4));
  bCtx.fill();
  bCtx.restore();

  // Lower step shelf on the torn fibrous white paper backing
  bCtx.save();
  traceTearOut(bCtx, 11);
  bCtx.fillStyle = '#999999';
  bCtx.fill();
  bCtx.restore();

  // Zero height in the removed torn-out area
  bCtx.save();
  traceTearOut(bCtx, 0);
  bCtx.fillStyle = '#000000';
  bCtx.fill();
  bCtx.restore();
}
