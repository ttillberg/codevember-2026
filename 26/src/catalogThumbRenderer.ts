import * as THREE from 'three';
import {
  MM,
  buildHouseNet,
  getColorSchemesForHouse,
  type BuiltHouseNet,
  type HouseNetSpec,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiMaterials,
  type WashiFiberTextures,
} from './origamiPaperMesh';

export type CatalogViewMode = '3d' | 'flat';

export const THUMB_SIZE = 240;
const MAX_CACHE_ENTRIES = 360;

const BACKDROP_3D = '#f5f4f0';
const BACKDROP_FLAT_WHITE = '#eae8e0';
const BACKDROP_FLAT_COLOR = '#f5f4f0';

const SUN_DIR_COLOR = new THREE.Vector3(5.8, 21.0, 3.6).normalize();
const SUN_DIR_WHITE = new THREE.Vector3(10.5, 19.0, 8.2).normalize();
const SUN_DIR_FLAT = new THREE.Vector3(11.0, 14.0, 9.5).normalize();

export interface CatalogThumbRendererOptions {
  /** Shared main WebGLRenderer (eliminates creating a second WebGL context!) */
  renderer: THREE.WebGLRenderer;
  /** Shared RoomEnvironment PMREM texture from the main stage */
  envTexture: THREE.Texture | null;
  /** Shared procedural washi fiber texture pair from the main stage */
  sharedWashiTextures?: WashiFiberTextures;
}

/**
 * Single-WebGL-context offscreen thumbnail renderer for the Generations Catalog Grid.
 * Reuses the main stage's WebGLRenderer, RoomEnvironment, and washi textures, rendering into a
 * tiny 240×240 4× MSAA HalfFloat target followed by a 1-quad NeutralToneMapping + sRGB + Y-flip
 * blit pass so thumbnails match the main stage bit-for-bit with ZERO second GPU context!
 */
export class CatalogThumbRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sharedEnvTexture: THREE.Texture | null;
  private readonly sharedWashiTextures: WashiFiberTextures | undefined;

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private fill: THREE.DirectionalLight | null = null;
  private flatMatPlane: THREE.Mesh | null = null;
  private materials: OrigamiMaterials | null = null;

  private hdrTarget: THREE.WebGLRenderTarget | null = null;
  private readbackTarget: THREE.WebGLRenderTarget | null = null;
  private blitScene: THREE.Scene | null = null;
  private blitCamera: THREE.OrthographicCamera | null = null;
  private blitMesh: THREE.Mesh | null = null;
  private blitUniforms: {
    uSrc: { value: THREE.Texture | null };
    uExposure: { value: number };
    uBackdropSrgb: { value: THREE.Vector3 };
  } | null = null;

  private pixelBuf: Uint8Array | null = null;
  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private scratchImageData: ImageData | null = null;

  private readonly savedClearColor = new THREE.Color();
  private readonly tmpBackdropColor = new THREE.Color();
  private cache = new Map<string, HTMLCanvasElement>();

  constructor(opts: CatalogThumbRendererOptions) {
    this.renderer = opts.renderer;
    this.sharedEnvTexture = opts.envTexture;
    this.sharedWashiTextures = opts.sharedWashiTextures;
  }

  private ensureInit(): void {
    if (this.scene) return;

    const scene = new THREE.Scene();
    scene.background = null;
    if (this.sharedEnvTexture) {
      scene.environment = this.sharedEnvTexture;
      scene.environmentIntensity = 0.08;
    }

    const camera = new THREE.PerspectiveCamera(28, 1, 0.3, 650);

    const hemi = new THREE.HemisphereLight('#fffef9', '#dfd9ce', 1.78);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fffdf6', 2.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.00022;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = 2.4;
    scene.add(sun);

    const fill = new THREE.DirectionalLight('#f5f4f0', 0.28);
    fill.position.set(-14, 9, -10);
    scene.add(fill);

    // Subtle shadow-catching cutting mat plane used ONLY in Flat mode so cut-sheets float cleanly
    const matGeo = new THREE.PlaneGeometry(400, 400);
    matGeo.rotateX(-Math.PI * 0.5);
    const matMaterial = new THREE.ShadowMaterial({ opacity: 0.14 });
    const flatMatPlane = new THREE.Mesh(matGeo, matMaterial);
    flatMatPlane.position.y = -0.18;
    flatMatPlane.receiveShadow = true;
    flatMatPlane.visible = false;
    scene.add(flatMatPlane);

    const materials = createOrigamiMaterials(this.renderer.capabilities.getMaxAnisotropy(), {
      enableProjection: false,
      sharedTextures: this.sharedWashiTextures,
    });

    // 4× MSAA Linear HalfFloat render target for crisp anti-aliased HDR specimen rendering
    const hdrTarget = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Single-sample RGBA8 target for NeutralToneMapping + sRGB + GPU Y-flip readback
    const readbackTarget = new THREE.WebGLRenderTarget(THUMB_SIZE, THUMB_SIZE, {
      type: THREE.UnsignedByteType,
      samples: 0,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    const blitUniforms = {
      uSrc: { value: hdrTarget.texture as THREE.Texture | null },
      uExposure: { value: 1.08 },
      uBackdropSrgb: { value: new THREE.Vector3(0.960784, 0.956863, 0.941176) },
    };

    const blitMat = new THREE.ShaderMaterial({
      uniforms: blitUniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          // Flip Y on GPU so readRenderTargetPixels returns upright top-to-bottom rows directly!
          vUv = vec2(uv.x, 1.0 - uv.y);
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSrc;
        uniform float uExposure;
        uniform vec3 uBackdropSrgb;
        varying vec2 vUv;

        // Exact Three.js NeutralToneMapping operator (modelviewer.dev)
        vec3 neutralToneMap(vec3 color, float exposure) {
          const float StartCompression = 0.76;
          const float Desaturation = 0.15;
          color *= exposure;
          float x = min(color.r, min(color.g, color.b));
          float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
          color -= offset;
          float peak = max(color.r, max(color.g, color.b));
          if (peak < StartCompression) return color;
          float d = 1.0 - StartCompression;
          float newPeak = 1.0 - d * d / (peak + d - StartCompression);
          color *= newPeak / peak;
          float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
          return mix(color, vec3(newPeak), g);
        }

        vec3 linearToSrgb(vec3 lin) {
          vec3 c = max(lin, vec3(0.0));
          return mix(
            pow(c, vec3(0.41666)) * 1.055 - vec3(0.055),
            c * 12.92,
            vec3(lessThanEqual(c, vec3(0.0031308)))
          );
        }

        void main() {
          vec4 raw = texture2D(uSrc, vUv);
          float a = clamp(raw.a, 0.0, 1.0);
          // Un-premultiply MSAA / shadow coverage, tone-map foreground ONLY, then composite onto exact CSS card backdrop!
          vec3 fgLin = a > 0.0005 ? (raw.rgb / a) : vec3(0.0);
          vec3 fgSrgb = linearToSrgb(neutralToneMap(fgLin, uExposure));
          vec3 outRgb = mix(uBackdropSrgb, clamp(fgSrgb, 0.0, 1.0), a);
          gl_FragColor = vec4(outRgb, 1.0);
        }
      `,
    });

    const blitScene = new THREE.Scene();
    const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
    blitMesh.frustumCulled = false;
    blitScene.add(blitMesh);

    const scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = THUMB_SIZE;
    scratchCanvas.height = THUMB_SIZE;
    const scratchCtx = scratchCanvas.getContext('2d')!;
    const scratchImageData = scratchCtx.createImageData(THUMB_SIZE, THUMB_SIZE);

    this.scene = scene;
    this.camera = camera;
    this.hemi = hemi;
    this.sun = sun;
    this.fill = fill;
    this.flatMatPlane = flatMatPlane;
    this.materials = materials;
    this.hdrTarget = hdrTarget;
    this.readbackTarget = readbackTarget;
    this.blitScene = blitScene;
    this.blitCamera = blitCamera;
    this.blitMesh = blitMesh;
    this.blitUniforms = blitUniforms;
    this.pixelBuf = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4);
    this.scratchCanvas = scratchCanvas;
    this.scratchCtx = scratchCtx;
    this.scratchImageData = scratchImageData;
  }

  private setBackdropHex(hex: string): void {
    const u = this.blitUniforms!;
    // Parse exact CSS sRGB channels without linearizing!
    const v = parseInt(hex.slice(1), 16);
    u.uBackdropSrgb.value.set(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  }

  private configureLighting(
    spec: HouseNetSpec,
    colorEnabled: boolean,
    viewMode: CatalogViewMode,
    shadowExtent: number,
  ): void {
    const hemi = this.hemi!;
    const sun = this.sun!;
    const fill = this.fill!;
    const materials = this.materials!;
    const blitUniforms = this.blitUniforms!;
    if (this.flatMatPlane) {
      this.flatMatPlane.visible = viewMode === 'flat';
    }

    // Crisp crease visibility in flat cut-sheet view
    materials.foldLine.opacity = viewMode === 'flat' ? 0.34 : 0.14;
    materials.foldLineMountain.opacity = viewMode === 'flat' ? 0.48 : 0.22;

    const sunDir =
      viewMode === 'flat'
        ? SUN_DIR_FLAT
        : colorEnabled
          ? SUN_DIR_COLOR
          : SUN_DIR_WHITE;

    if (colorEnabled) {
      this.setBackdropHex(viewMode === 'flat' ? BACKDROP_FLAT_COLOR : BACKDROP_3D);
      materials.setColorSchemes(
        getColorSchemesForHouse(spec.outsideColor, spec.topology === 'village'),
        Math.max(4.5, (spec.H + 22) * MM),
      );
      materials.inside.color.set(viewMode === 'flat' ? spec.outsideColor : '#fbfaf7');
      materials.edge.color.set('#fbfaf7');
      hemi.color.set('#fffdf8');
      hemi.groundColor.set('#e0ddd6');
      hemi.intensity = 1.50;
      sun.color.set('#fffdf9');
      sun.intensity = 1.18;
      fill.color.set('#f8f7f2');
      fill.intensity = 0.24;
      blitUniforms.uExposure.value = 1.02;
    } else {
      // In white-on-white Flat mode, set a warm stone-ivory mat (#eae8e0) beneath bright cotton paper
      // so every single-cutout perimeter, punched window opening, and crease pattern reads crisply!
      this.setBackdropHex(viewMode === 'flat' ? BACKDROP_FLAT_WHITE : BACKDROP_3D);
      materials.setOutsideColor(viewMode === 'flat' ? '#fdfcf8' : '#f5f4f0');
      materials.inside.color.set(viewMode === 'flat' ? '#fdfcf8' : '#fbfaf7');
      materials.edge.color.set('#f8f7f3');
      hemi.color.set('#fffef9');
      hemi.groundColor.set('#dfd9ce');
      hemi.intensity = viewMode === 'flat' ? 1.65 : 1.78;
      sun.color.set('#fffdf6');
      sun.intensity = viewMode === 'flat' ? 1.85 : 2.05;
      fill.color.set('#f5f4f0');
      fill.intensity = 0.28;
      blitUniforms.uExposure.value = 1.08;
    }

    const e = Math.max(12, shadowExtent);
    const sunDist = Math.max(26, e * 1.75);
    sun.position.copy(sunDir).multiplyScalar(sunDist);
    sun.shadow.camera.left = -e;
    sun.shadow.camera.right = e;
    sun.shadow.camera.top = e;
    sun.shadow.camera.bottom = -e;
    sun.shadow.camera.near = Math.max(2, sunDist - e * 2.2);
    sun.shadow.camera.far = sunDist + e * 2.6;
    sun.shadow.normalBias = 0.016 * (e / 14);
    sun.shadow.camera.updateProjectionMatrix();
  }

  private frameCamera(net: BuiltHouseNet, viewMode: CatalogViewMode): number {
    const camera = this.camera!;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));

    if (viewMode === 'flat') {
      const { minX, maxX, minY, maxY } = net.flatBounds;
      const cx = (minX + maxX) * 0.5 * MM;
      const cz = -(minY + maxY) * 0.5 * MM;
      const halfSpan = Math.max(maxX - minX, maxY - minY) * 0.5 * MM;
      const yaw = 0.22;
      const pitch = 1.18;
      const dist = Math.max(18, (halfSpan / (0.68 * tanV)) * 1.16);
      camera.position.set(
        cx + dist * Math.cos(pitch) * Math.sin(yaw),
        dist * Math.sin(pitch),
        cz + dist * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.lookAt(cx, 0, cz);
      return Math.max(14, halfSpan * 1.45);
    }

    // 3D hero framing: tight sculptural specimen crop so 10-per-row silhouettes read boldly!
    const hWorld = net.foldedHeightMm * MM;
    const rWorld = net.foldedRadiusMm * MM;
    const isVillage = net.spec.topology === 'village';
    const isTall =
      net.spec.topology === 'setback' || net.spec.topology === 'oct' || net.spec.roofType === 'spire';

    const yaw = isVillage ? 0.58 : 0.52;
    const pitch = isVillage ? 0.64 : isTall ? 0.44 : 0.50;
    const distForH = hWorld / (0.64 * 2 * tanV);
    const distForW = rWorld / ((isVillage ? 0.74 : 0.62) * tanV);
    const dist = Math.max(18, distForH, distForW) * 1.02;
    const lookY = isVillage ? hWorld * 0.24 : hWorld * 0.42;

    camera.position.set(
      dist * Math.cos(pitch) * Math.sin(yaw),
      lookY + dist * Math.sin(pitch),
      dist * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(0, lookY, 0);
    return Math.max(14, rWorld + hWorld * 0.95);
  }

  public getCached(cacheKey: string): HTMLCanvasElement | null {
    const hit = this.cache.get(cacheKey);
    if (!hit) return null;
    // Refresh LRU order
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, hit);
    return hit;
  }

  public renderToCanvas(
    cacheKey: string,
    spec: HouseNetSpec,
    targetCanvas: HTMLCanvasElement,
    colorEnabled: boolean,
    viewMode: CatalogViewMode,
    windowOpenMode: WindowOpenMode = 'random',
    windowOpenRatio = 0.35,
  ): void {
    const cached = this.getCached(cacheKey);
    if (cached) {
      this.blit(cached, targetCanvas);
      return;
    }

    this.ensureInit();
    const renderer = this.renderer;
    const scene = this.scene!;
    const camera = this.camera!;
    const materials = this.materials!;
    const hdrTarget = this.hdrTarget!;
    const readbackTarget = this.readbackTarget!;
    const pixelBuf = this.pixelBuf!;
    const scratchCanvas = this.scratchCanvas!;
    const scratchCtx = this.scratchCtx!;
    const scratchImageData = this.scratchImageData!;

    const net = buildHouseNet(spec);
    const rig = buildOrigamiHouseRig(net, materials, false);
    rig.setWindowOpen(windowOpenMode, windowOpenRatio);
    const foldVal = viewMode === '3d' ? 1 : 0;
    for (const id of rig.panelIds) {
      rig.updatePanelVisual(id, foldVal, 0, false);
    }
    rig.setFoldLinesVisible(viewMode === 'flat');
    rig.setPaperRelief(1, viewMode === 'flat');
    materials.setProjection(null);

    const shadowExtent = this.frameCamera(net, viewMode);
    this.configureLighting(spec, colorEnabled, viewMode, shadowExtent);

    // Save main renderer state cleanly before rendering offscreen specimen
    const prevTarget = renderer.getRenderTarget();
    const prevToneMapping = renderer.toneMapping;
    const prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    scene.add(rig.root);

    // Pass 1: 4× MSAA Linear HDR render over transparent background
    renderer.autoClear = true;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(this.tmpBackdropColor.setHex(0x000000), 0);
    renderer.setRenderTarget(hdrTarget);
    renderer.render(scene, camera);

    // Pass 2: NeutralToneMapping + sRGB + GPU Y-flip + crisp exact backdrop composite
    renderer.setRenderTarget(readbackTarget);
    renderer.render(this.blitScene!, this.blitCamera!);

    renderer.readRenderTargetPixels(readbackTarget, 0, 0, THUMB_SIZE, THUMB_SIZE, pixelBuf);

    // Restore main renderer state bit-for-bit
    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevToneMapping;
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this.savedClearColor, prevClearAlpha);

    scene.remove(rig.root);
    rig.dispose();

    // Transfer upright RGBA bytes into scratch canvas -> LRU cache + target tile
    scratchImageData.data.set(pixelBuf);
    scratchCtx.putImageData(scratchImageData, 0, 0);

    const snap = document.createElement('canvas');
    snap.width = THUMB_SIZE;
    snap.height = THUMB_SIZE;
    const snapCtx = snap.getContext('2d');
    if (snapCtx) {
      snapCtx.drawImage(scratchCanvas, 0, 0, THUMB_SIZE, THUMB_SIZE);
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, snap);
    }

    this.blit(scratchCanvas, targetCanvas);
  }

  private blit(source: HTMLCanvasElement, target: HTMLCanvasElement): void {
    if (target.width !== THUMB_SIZE || target.height !== THUMB_SIZE) {
      target.width = THUMB_SIZE;
      target.height = THUMB_SIZE;
    }
    const ctx = target.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(source, 0, 0, target.width, target.height);
    }
  }

  public dispose(): void {
    this.cache.clear();
    if (this.flatMatPlane) {
      this.flatMatPlane.geometry.dispose();
      (this.flatMatPlane.material as THREE.Material).dispose();
      this.flatMatPlane = null;
    }
    if (this.blitMesh) {
      this.blitMesh.geometry.dispose();
      (this.blitMesh.material as THREE.Material).dispose();
      this.blitMesh = null;
    }
    this.hdrTarget?.dispose();
    this.hdrTarget = null;
    this.readbackTarget?.dispose();
    this.readbackTarget = null;
    this.materials?.dispose();
    this.materials = null;
    this.scene = null;
    this.camera = null;
    this.blitScene = null;
    this.blitCamera = null;
    this.pixelBuf = null;
    this.scratchCanvas = null;
    this.scratchCtx = null;
    this.scratchImageData = null;
  }
}
