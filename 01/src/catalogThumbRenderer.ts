import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ARCHITECTURAL_PAPER_PALETTE,
  MM,
  buildHouseNet,
  type BuiltHouseNet,
  type HouseNetSpec,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiMaterials,
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

/**
 * Lazy single-context offscreen WebGL thumbnail renderer for the Generations Catalog Grid.
 * Uses the exact same materials, tone mapping, and white/pastel gallery lighting as the main stage,
 * blits directly into tile `<canvas>` elements with zero base64 encoding overhead, and LRU-caches tiles.
 */
export class CatalogThumbRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private fill: THREE.DirectionalLight | null = null;
  private flatMatPlane: THREE.Mesh | null = null;
  private materials: OrigamiMaterials | null = null;
  private readonly bgColor = new THREE.Color(BACKDROP_3D);
  private cache = new Map<string, HTMLCanvasElement>();

  private ensureInit(): void {
    if (this.renderer) return;

    const canvas = document.createElement('canvas');
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = this.bgColor;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.08;
    pmrem.dispose();

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

    const materials = createOrigamiMaterials(renderer.capabilities.getMaxAnisotropy(), {
      enableProjection: false,
    });

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.hemi = hemi;
    this.sun = sun;
    this.fill = fill;
    this.flatMatPlane = flatMatPlane;
    this.materials = materials;
  }

  private configureLighting(spec: HouseNetSpec, colorEnabled: boolean, viewMode: CatalogViewMode, shadowExtent: number): void {
    const scene = this.scene!;
    const renderer = this.renderer!;
    const hemi = this.hemi!;
    const sun = this.sun!;
    const fill = this.fill!;
    const materials = this.materials!;
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
      this.bgColor.set(viewMode === 'flat' ? BACKDROP_FLAT_COLOR : BACKDROP_3D);
      scene.background = this.bgColor;
      if (spec.topology === 'village') {
        const baseIdx = Math.max(0, ARCHITECTURAL_PAPER_PALETTE.indexOf(spec.outsideColor));
        const len = ARCHITECTURAL_PAPER_PALETTE.length;
        materials.setOutsideColors([
          ARCHITECTURAL_PAPER_PALETTE[baseIdx % len],
          ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 2) % len],
          ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 5) % len],
          ARCHITECTURAL_PAPER_PALETTE[(baseIdx + 3) % len],
        ]);
      } else {
        materials.setOutsideColor(spec.outsideColor);
      }
      materials.inside.color.set(viewMode === 'flat' ? spec.outsideColor : '#fbfaf7');
      materials.edge.color.set('#fbfaf7');
      hemi.color.set('#fffdf8');
      hemi.groundColor.set('#e0ddd6');
      hemi.intensity = 1.50;
      sun.color.set('#fffdf9');
      sun.intensity = 1.18;
      fill.color.set('#f8f7f2');
      fill.intensity = 0.24;
      renderer.toneMappingExposure = 1.02;
    } else {
      // In white-on-white Flat mode, set a warm stone-ivory mat (#e6e4dc) beneath bright cotton paper
      // so every single-cutout perimeter, punched window opening, and crease pattern reads crisply!
      this.bgColor.set(viewMode === 'flat' ? BACKDROP_FLAT_WHITE : BACKDROP_3D);
      scene.background = this.bgColor;
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
      renderer.toneMappingExposure = viewMode === 'flat' ? 1.08 : 1.08;
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
    const scene = this.scene!;
    const renderer = this.renderer!;
    const camera = this.camera!;
    const materials = this.materials!;

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

    scene.add(rig.root);
    renderer.render(scene, camera);
    scene.remove(rig.root);
    rig.dispose();

    // Store crisp snapshot in LRU cache
    const snap = document.createElement('canvas');
    snap.width = THUMB_SIZE;
    snap.height = THUMB_SIZE;
    const snapCtx = snap.getContext('2d');
    if (snapCtx) {
      snapCtx.drawImage(renderer.domElement, 0, 0, THUMB_SIZE, THUMB_SIZE);
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, snap);
    }

    this.blit(renderer.domElement, targetCanvas);
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
    this.materials?.dispose();
    this.materials = null;
    if (this.scene?.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
