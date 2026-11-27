import * as THREE from 'three';
import {
  ARCHITECTURAL_COLOR_SCHEMES,
  ARCHITECTURAL_PAPER_PALETTE,
  buildHouseNet,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  createWashiFiberTextures,
  type OrigamiHouseRig,
  type OrigamiMaterials,
  type WashiFiberTextures,
} from './origamiPaperMesh';
import {
  createIslandWorld,
  type CityBuildingPlot,
  type IslandRoad,
  type IslandTerrainField,
  type IslandTree,
  type IslandWorld,
  type IslandWorldOptions,
} from './cityGenerator';

const BACKDROP = '#f5f4f0';
const SUN_DIR_WHITE = new THREE.Vector3(26, 38, 22).normalize();
const SUN_DIR_COLOR = new THREE.Vector3(20, 42, 18).normalize();
const ISLAND_FOG_DENSITY = 0.0034;

// Tactile paint-to-fold radii
const PAINT_BRUSH_RADIUS = 4.4;
const CLICK_BURST_RADIUS = 7.2;
const ROAD_REVEAL_RADIUS = 5.4;
const MAX_RIPPLES = 10;
const CHUNK_GRID = 4;
const CHUNK_EXTENT = 44;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Crisp cardstock paper-fold easing with a tiny tactile overshoot settle at 1.0 */
function easePaperSnap(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const base = 1 - Math.pow(1 - t, 3.1);
  const snap = Math.sin(t * Math.PI * 1.65) * 0.032 * Math.pow(t, 2.2) * (1 - t);
  return Math.max(0, Math.min(1.035, base + snap));
}

// ---------------------------------------------------------------------------
// Procedural Island Terrain, Spatial-Reveal Roads & Instanced Trees
// ---------------------------------------------------------------------------

function buildIslandTerrainGeometry(terrain: IslandTerrainField, extent = 48, segs = 96): THREE.BufferGeometry {
  const stride = segs + 1;
  const step = (extent * 2) / segs;
  const minC = -extent;
  const eps = 0.35;

  const positions = new Float32Array(stride * stride * 3);
  const normals = new Float32Array(stride * stride * 3);
  const inlands = new Float32Array(stride * stride);

  for (let j = 0; j <= segs; j++) {
    const z = minC + j * step;
    for (let i = 0; i <= segs; i++) {
      const x = minC + i * step;
      const y = terrain.heightAt(x, z);
      const vIdx = j * stride + i;
      const o = vIdx * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;

      const hL = terrain.heightAt(x - eps, z);
      const hR = terrain.heightAt(x + eps, z);
      const hD = terrain.heightAt(x, z - eps);
      const hU = terrain.heightAt(x, z + eps);
      const nx = hL - hR;
      const ny = 2 * eps;
      const nz = hD - hU;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[o] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;

      inlands[vIdx] = terrain.signedInland(x, z);
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if ((i + j) % 2 === 0) {
        indices.push(a, c, b, b, c, d);
      } else {
        indices.push(a, c, d, a, d, b);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('aInland', new THREE.BufferAttribute(inlands, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

interface MountedRoadRibbon {
  road: IslandRoad;
  mesh: THREE.Mesh;
  curbLines: THREE.LineSegments;
  curReveal: Float32Array;
  targetReveal: Float32Array;
  meshRevealAttr: THREE.BufferAttribute;
  curbRevealAttr: THREE.BufferAttribute;
  dirty: boolean;
}

function buildRevealableRoadRibbon(
  road: IslandRoad,
  terrain: IslandTerrainField,
  roadMat: THREE.MeshStandardMaterial,
  curbMat: THREE.LineBasicMaterial,
): MountedRoadRibbon {
  const pts = road.points;
  const n = pts.length;
  const halfW = road.width * 0.5;

  const verts = new Float32Array(n * 3 * 3);
  const meshReveal = new Float32Array(n * 3);
  const indices: number[] = [];

  const curbVerts = new Float32Array(Math.max(0, n - 1) * 4 * 3);
  const curbReveal = new Float32Array(Math.max(0, n - 1) * 4);

  const leftPts: [number, number, number][] = [];
  const rightPts: [number, number, number][] = [];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = road.closed && i === 0 ? pts[n - 2] : pts[Math.max(0, i - 1)];
    const next = road.closed && i === n - 1 ? pts[1] : pts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const nx = -tz;
    const nz = tx;

    const lx = p.x - nx * halfW;
    const lz = p.z - nz * halfW;
    const rx = p.x + nx * halfW;
    const rz = p.z + nz * halfW;

    const ly = terrain.heightAt(lx, lz) + 0.125;
    const cy = terrain.heightAt(p.x, p.z) + 0.135;
    const ry = terrain.heightAt(rx, rz) + 0.125;

    const baseV = i * 3;
    const o = baseV * 3;
    verts[o] = lx;
    verts[o + 1] = ly;
    verts[o + 2] = lz;
    verts[o + 3] = p.x;
    verts[o + 4] = cy;
    verts[o + 5] = p.z;
    verts[o + 6] = rx;
    verts[o + 7] = ry;
    verts[o + 8] = rz;

    leftPts.push([lx, ly + 0.016, lz]);
    rightPts.push([rx, ry + 0.016, rz]);

    if (i < n - 1) {
      const nb = (i + 1) * 3;
      indices.push(baseV, baseV + 1, nb, baseV + 1, nb + 1, nb);
      indices.push(baseV + 1, baseV + 2, nb + 1, baseV + 2, nb + 2, nb + 1);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const o = i * 12;
    const l0 = leftPts[i];
    const l1 = leftPts[i + 1];
    const r0 = rightPts[i];
    const r1 = rightPts[i + 1];
    curbVerts[o] = l0[0];
    curbVerts[o + 1] = l0[1];
    curbVerts[o + 2] = l0[2];
    curbVerts[o + 3] = l1[0];
    curbVerts[o + 4] = l1[1];
    curbVerts[o + 5] = l1[2];
    curbVerts[o + 6] = r0[0];
    curbVerts[o + 7] = r0[1];
    curbVerts[o + 8] = r0[2];
    curbVerts[o + 9] = r1[0];
    curbVerts[o + 10] = r1[1];
    curbVerts[o + 11] = r1[2];
  }

  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const meshRevealAttr = new THREE.BufferAttribute(meshReveal, 1);
  meshRevealAttr.setUsage(THREE.DynamicDrawUsage);
  rGeo.setAttribute('aReveal', meshRevealAttr);
  rGeo.setIndex(indices);
  rGeo.computeVertexNormals();

  const mesh = new THREE.Mesh(rGeo, roadMat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;

  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(curbVerts, 3));
  const curbRevealAttr = new THREE.BufferAttribute(curbReveal, 1);
  curbRevealAttr.setUsage(THREE.DynamicDrawUsage);
  cGeo.setAttribute('aReveal', curbRevealAttr);

  const curbLines = new THREE.LineSegments(cGeo, curbMat);
  curbLines.visible = false;

  return {
    road,
    mesh,
    curbLines,
    curReveal: new Float32Array(n),
    targetReveal: new Float32Array(n),
    meshRevealAttr,
    curbRevealAttr,
    dirty: false,
  };
}

interface InstancedTreeEntry {
  data: IslandTree;
  trunkIndex: number;
  crownVariant: 0 | 1 | 2;
  crownIndex: number;
  swayVelX: number;
  swayVelZ: number;
  swayX: number;
  swayZ: number;
}

function createTreeVariantGeometries(): {
  trunk: THREE.BufferGeometry;
  cypress: THREE.BufferGeometry;
  pine: THREE.BufferGeometry;
  umbrella: THREE.BufferGeometry;
} {
  const trunk = new THREE.CylinderGeometry(0.065, 0.095, 0.78, 5);
  trunk.translate(0, 0.34, 0);

  const cypress = new THREE.ConeGeometry(0.30, 2.35, 6);
  cypress.translate(0, 1.48, 0);

  const pine = new THREE.ConeGeometry(0.50, 1.75, 6);
  pine.translate(0, 1.24, 0);

  const umbrella = new THREE.DodecahedronGeometry(0.60, 0);
  umbrella.scale(1.18, 0.54, 1.12);
  umbrella.translate(0, 1.08, 0);

  return { trunk, cypress, pine, umbrella };
}

interface BakedHouseData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  whiteCols: Float32Array;
  indices: Uint32Array;
}

interface SettledChunk {
  key: number;
  houses: MountedIslandHouse[];
  mesh: THREE.Mesh | null;
  dirty: boolean;
}

/**
 * Lazily-mounted full-detail island house:
 * stays pure lightweight metadata until the user paints/folds it, then bakes into one of
 * 16 spatial chunk meshes (disposing its individual rig!) so 900+ houses render in <=16 draw calls!
 */
interface MountedIslandHouse {
  plot: CityBuildingPlot;
  rig: OrigamiHouseRig | null;
  wrapper: THREE.Group | null;
  plinth: THREE.Mesh | null;
  chunkKey: number;
  baked: BakedHouseData | null;
  inChunk: boolean;
  plinthW: number;
  plinthD: number;
  plinthH: number;
  targetFold: 0 | 1;
  progress: number;
  delay: number;
  duration: number;
  pulseAge: number;
}

interface SurfaceRipple {
  active: boolean;
  age: number;
  maxAge: number;
  maxRadius: number;
  mesh: THREE.LineLoop;
  mat: THREE.LineBasicMaterial;
}

export interface CityViewStats {
  active: boolean;
  seed: number;
  hills: number;
  foldedCount: number;
  totalPlots: number;
  rooftopCount: number;
  roadRevealRatio: number;
  camPos: [number, number, number];
}

export interface CityViewCallbacks {
  onWorldStats?: (stats: CityViewStats) => void;
  onSelectPlot?: (plot: CityBuildingPlot) => void;
}

// ---------------------------------------------------------------------------
// 3/4-Top Interactive Italian Mountain Island Diorama (`CityView`)
// ---------------------------------------------------------------------------

export class CityView {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public world: IslandWorld | null = null;

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly islandRoot = new THREE.Group();

  private readonly matPool: OrigamiMaterials[] = [];
  private readonly ownedWashiTex: WashiFiberTextures | null;
  private readonly terrainMat: THREE.MeshStandardMaterial;
  private readonly seaMat: THREE.MeshStandardMaterial;
  private readonly roadMat: THREE.MeshStandardMaterial;
  private readonly curbMat: THREE.LineBasicMaterial;
  private readonly plinthMat: THREE.MeshStandardMaterial;
  private readonly trunkMat: THREE.MeshStandardMaterial;
  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly contourMinorMat: THREE.LineBasicMaterial;
  private readonly contourMajorMat: THREE.LineBasicMaterial;
  private readonly cityShadowDepthMat: THREE.MeshDepthMaterial;
  /** Shared dual-palette standard material for settled static houses (1 draw call/house, instant White<->Color toggle!) */
  private readonly settledHouseMat: THREE.MeshStandardMaterial;
  private readonly settledUniforms = { uColorMix: { value: 0 } };
  private readonly unitPlinthGeo: THREE.BoxGeometry;
  private readonly treeGeos: ReturnType<typeof createTreeVariantGeometries>;
  private shadowDirty = true;

  private readonly seaMesh: THREE.Mesh;
  private readonly seaUniforms = {
    uTime: { value: 0 },
    uColorMix: { value: 0 },
    uOrientAng: { value: 0 },
    uHarmA: { value: new THREE.Vector4(2.2, 1.6, 0.9, 0.5) },
    uHarmP: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  private readonly terrainUniforms = {
    uShoreColor: { value: new THREE.Color('#eae1cf') },
    uSlopeColor: { value: new THREE.Color('#f5f4f0') },
    uCliffColor: { value: new THREE.Color('#e6e3db') },
    uCrestColor: { value: new THREE.Color('#fbfaf6') },
  };

  private readonly brushRing: THREE.LineLoop;
  private readonly brushRingMat: THREE.LineBasicMaterial;
  private readonly ripples: SurfaceRipple[] = [];
  private rippleCursor = 0;

  // Mounted world runtime collections
  private terrainMesh: THREE.Mesh | null = null;
  private staticGeos: THREE.BufferGeometry[] = [];
  private mountedRoads: MountedRoadRibbon[] = [];
  private mountedHouses: MountedIslandHouse[] = [];
  private settledChunks: SettledChunk[] = [];
  private treeEntries: InstancedTreeEntry[] = [];
  private trunkInstMesh: THREE.InstancedMesh | null = null;
  private crownInstMeshes: [THREE.InstancedMesh | null, THREE.InstancedMesh | null, THREE.InstancedMesh | null] = [
    null,
    null,
    null,
  ];
  private readonly tmpTreeDummy = new THREE.Object3D();

  private colorEnabled = false;
  private winOpenMode: WindowOpenMode = 'random';
  private winOpenRatio = 0.35;
  private elapsedTime = 0;

  // Classic 3/4-top diorama orbit camera state
  private curYaw = 0.42;
  private targetYaw = 0.42;
  private curPitch = 0.72;
  private targetPitch = 0.72;
  private curDist = 114;
  private targetDist = 114;
  private curTarget = new THREE.Vector3(0, 4.8, 0.5);
  private targetPos = new THREE.Vector3(0, 4.8, 0.5);

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmpV1 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly callbacks: CityViewCallbacks;
  private hudDirty = false;
  private hudEmitAccum = 0;

  // Pointer & multi-touch interaction state:
  //   - Normal click / 1-finger drag -> POPULATE HOUSES (`paint`)
  //   - Cmd+drag / Ctrl+drag / Right-drag / 2-finger swipe / 2-finger touch -> ROTATE (`orbit` / `orbit2`)
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private dragMode: 'none' | 'paint' | 'orbit' | 'orbit2' = 'none';
  private primaryPointerId: number | null = null;
  private lastPx = 0;
  private lastPy = 0;
  private lastTwoMidX = 0;
  private lastTwoMidY = 0;
  private lastPinchDist = 0;
  private lastTouchX = Number.NaN;
  private lastTouchZ = Number.NaN;
  private brushIdleTime = 99;

  constructor(
    maxAnisotropy: number,
    envTexture: THREE.Texture | null,
    callbacks: CityViewCallbacks = {},
    sharedWashiTextures?: WashiFiberTextures,
  ) {
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.FogExp2(BACKDROP, ISLAND_FOG_DENSITY);
    if (envTexture) {
      this.scene.environment = envTexture;
      this.scene.environmentIntensity = 0.08;
    }

    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 500);

    this.hemi = new THREE.HemisphereLight('#fffef9', '#dfd9ce', 1.72);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fffdf6', 2.02);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00024;
    this.sun.shadow.normalBias = 0.032;
    this.sun.shadow.radius = 2.6;
    const ext = 48;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 190;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight('#f5f4f0', 0.30);
    this.fill.position.set(-34, 24, -22);
    this.scene.add(this.fill);

    this.scene.add(this.islandRoot);

    this.terrainMat = this.createIslandTerrainMaterial();
    this.seaMat = this.createMediterraneanSeaMaterial();
    this.roadMat = this.createRevealableRoadMaterial();
    this.curbMat = this.createRevealableCurbMaterial();

    this.ownedWashiTex = sharedWashiTextures ? null : createWashiFiberTextures(maxAnisotropy);
    const washiTex = sharedWashiTextures ?? this.ownedWashiTex!;
    const poolSize = ARCHITECTURAL_PAPER_PALETTE.length;
    for (let i = 0; i < poolSize; i++) {
      this.matPool.push(
        createOrigamiMaterials(maxAnisotropy, {
          enableProjection: false,
          sharedTextures: washiTex,
          singlePassDuplex: true,
          flatGroundColor: this.terrainMat.color,
        }),
      );
    }

    this.cityShadowDepthMat = this.createSmoothShadowDepthMaterial();
    this.settledHouseMat = this.createSettledHouseMaterial(washiTex);
    this.plinthMat = new THREE.MeshStandardMaterial({
      color: '#eeece5',
      roughness: 0.94,
      metalness: 0.0,
    });
    this.trunkMat = new THREE.MeshStandardMaterial({
      color: '#d8d2c6',
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    });
    this.treeMat = new THREE.MeshStandardMaterial({
      color: '#e6e4dc',
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });
    this.contourMinorMat = new THREE.LineBasicMaterial({
      color: 0xc8c3b8,
      transparent: true,
      opacity: 0.42,
    });
    this.contourMajorMat = new THREE.LineBasicMaterial({
      color: 0xaeaa9e,
      transparent: true,
      opacity: 0.72,
    });

    this.unitPlinthGeo = new THREE.BoxGeometry(1, 1, 1);
    this.treeGeos = createTreeVariantGeometries();

    const seaGeo = new THREE.PlaneGeometry(540, 540, 120, 120);
    seaGeo.rotateX(-Math.PI * 0.5);
    this.seaMesh = new THREE.Mesh(seaGeo, this.seaMat);
    this.seaMesh.position.y = 0.0;
    this.seaMesh.receiveShadow = true;
    this.scene.add(this.seaMesh);

    const ringPts: THREE.Vector3[] = [];
    const ringSegs = 40;
    for (let i = 0; i < ringSegs; i++) {
      const a = (i / ringSegs) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    this.brushRingMat = new THREE.LineBasicMaterial({
      color: 0x1c1c1c,
      transparent: true,
      opacity: 0.24,
      depthTest: false,
    });
    this.brushRing = new THREE.LineLoop(ringGeo, this.brushRingMat);
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 8;
    this.scene.add(this.brushRing);

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const rMat = new THREE.LineBasicMaterial({
        color: 0x1c1c1c,
        transparent: true,
        opacity: 0,
        depthTest: false,
      });
      const rLoop = new THREE.LineLoop(ringGeo, rMat);
      rLoop.visible = false;
      rLoop.renderOrder = 7;
      this.scene.add(rLoop);
      this.ripples.push({
        active: false,
        age: 0,
        maxAge: 0.7,
        maxRadius: 6,
        mesh: rLoop,
        mat: rMat,
      });
    }

    this.applyLightingAndColors();
    this.syncCamera();
  }

  private createSettledHouseMaterial(washiTex: WashiFiberTextures): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      bumpMap: washiTex.bumpMap,
      bumpScale: 0.008,
      roughness: 0.91,
      metalness: 0.0,
    });
    mat.customProgramCacheKey = () => 'italian-island-settled-house-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uColorMix = this.settledUniforms.uColorMix;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec3 aWhiteCol;\nvarying vec3 vWhiteCol;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWhiteCol = aWhiteCol;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uColorMix;\nvarying vec3 vWhiteCol;`)
        .replace(
          '#include <color_fragment>',
          `#if defined( USE_COLOR_ALPHA )
            diffuseColor *= vColor;
          #elif defined( USE_COLOR )
            diffuseColor.rgb *= mix(vWhiteCol, vColor.rgb, uColorMix);
          #endif`,
        );
    };
    return mat;
  }

  private createSmoothShadowDepthMaterial(): THREE.MeshDepthMaterial {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mat.customProgramCacheKey = () => 'island-city-smooth-shadow-depth-v1';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying float vPanelAngle;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec3 panelWorldUp = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vPanelAngle = acos(clamp(panelWorldUp.y, -1.0, 1.0));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vPanelAngle;
float bayer4x4Shadow(vec2 fc) {
  vec2 p = mod(floor(fc), 4.0);
  float x0 = mod(p.x, 2.0);
  float y0 = mod(p.y, 2.0);
  float x1 = floor(p.x * 0.5);
  float y1 = floor(p.y * 0.5);
  float m0 = 2.0 * abs(x0 - y0) + y0;
  float m1 = 2.0 * abs(x1 - y1) + y1;
  return (4.0 * m0 + m1 + 0.5) / 16.0;
}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
float shadowVis = smoothstep(0.11, 0.74, vPanelAngle);
if (shadowVis <= 0.001) discard;
if (shadowVis < 0.999 && shadowVis < bayer4x4Shadow(gl_FragCoord.xy)) discard;`,
        );
    };
    return mat;
  }

  private createIslandTerrainMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#f5f4f0',
      roughness: 0.94,
      metalness: 0.0,
      flatShading: true,
    });
    mat.customProgramCacheKey = () => 'italian-island-paper-terrain-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uShoreColor = this.terrainUniforms.uShoreColor;
      shader.uniforms.uSlopeColor = this.terrainUniforms.uSlopeColor;
      shader.uniforms.uCliffColor = this.terrainUniforms.uCliffColor;
      shader.uniforms.uCrestColor = this.terrainUniforms.uCrestColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aInland;
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;
varying float vInland;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
vInland = aInland;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uShoreColor;
uniform vec3 uSlopeColor;
uniform vec3 uCliffColor;
uniform vec3 uCrestColor;
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;
varying float vInland;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float elev = vTerrainWorldPos.y;
float steep = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);
float shoreMask = (1.0 - smoothstep(0.6, 4.2, vInland)) * smoothstep(-2.0, 0.1, vInland) * (1.0 - smoothstep(0.5, 2.2, elev));
vec3 col = mix(uSlopeColor, uShoreColor, clamp(shoreMask, 0.0, 1.0));
float cliffMask = smoothstep(0.14, 0.44, steep) * smoothstep(0.8, 5.5, elev);
col = mix(col, uCliffColor, cliffMask * 0.82);
float crestMask = smoothstep(10.5, 18.0, elev) * (1.0 - steep * 0.5);
col = mix(col, uCrestColor, clamp(crestMask, 0.0, 1.0));
diffuseColor.rgb = col;`,
        );
    };
    return mat;
  }

  private createMediterraneanSeaMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.88,
      metalness: 0.01,
      flatShading: true,
    });
    mat.customProgramCacheKey = () => 'italian-island-paper-sea-v2';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.seaUniforms.uTime;
      shader.uniforms.uColorMix = this.seaUniforms.uColorMix;
      shader.uniforms.uOrientAng = this.seaUniforms.uOrientAng;
      shader.uniforms.uHarmA = this.seaUniforms.uHarmA;
      shader.uniforms.uHarmP = this.seaUniforms.uHarmP;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
varying vec3 vSeaWorldPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec4 wPos0 = modelMatrix * vec4(transformed, 1.0);
float r0 = length(wPos0.xz);
float calm = smoothstep(24.0, 44.0, r0);
float w1 = sin(wPos0.x * 0.16 + uTime * 0.70 + wPos0.z * 0.09) * 0.15;
float w2 = cos(wPos0.z * 0.13 - uTime * 0.56 - wPos0.x * 0.07) * 0.12;
transformed.y += (w1 + w2) * calm;
vSeaWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTime;
uniform float uColorMix;
uniform float uOrientAng;
uniform vec4 uHarmA;
uniform vec4 uHarmP;
varying vec3 vSeaWorldPos;
float wrapPi(float a) {
  return mod(a + 3.14159265, 6.2831853) - 3.14159265;
}
float approxCoastR(float worldAng) {
  float a = worldAng - uOrientAng;
  float baseR = 33.4 + 2.6 * cos(2.0 * a);
  float dBay = wrapPi(a - 1.5707963);
  float bayNotch = -6.6 * exp(-(dBay * dBay) / 0.16);
  float dL = wrapPi(a - 0.8507963);
  float dR = wrapPi(a - 2.3307963);
  float capes = 4.0 * exp(-(dL * dL) / 0.1156) + 3.6 * exp(-(dR * dR) / 0.1296);
  float org = uHarmA.x * sin(2.0 * a + uHarmP.x)
            + uHarmA.y * cos(3.0 * a + uHarmP.y)
            + uHarmA.z * sin(4.0 * a + uHarmP.z)
            + uHarmA.w * cos(5.0 * a + uHarmP.w);
  return max(21.5, baseR + bayNotch + capes + org);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float r = length(vSeaWorldPos.xz);
float ang = atan(vSeaWorldPos.z, vSeaWorldPos.x);
float offshore = max(0.0, r - approxCoastR(ang));
float shallow = exp(-offshore * 0.072);
float ringWave = sin(offshore * 1.15 - uTime * 1.05 + sin(ang * 5.0) * 0.75);
float foamLine = smoothstep(0.86, 0.98, ringWave) * exp(-offshore * 0.11) * smoothstep(0.0, 1.5, offshore);
float shoreEdge = exp(-offshore * 0.65);

vec3 whiteDeep = vec3(0.455, 0.635, 0.755);
vec3 whiteShallow = vec3(0.605, 0.765, 0.840);
vec3 whiteFoam = vec3(0.958, 0.954, 0.940);
vec3 wSea = mix(whiteDeep, whiteShallow, shallow);
wSea = mix(wSea, whiteFoam, clamp(foamLine * 0.38 + shoreEdge * 0.68, 0.0, 1.0));

vec3 colDeep = vec3(0.275, 0.490, 0.650);
vec3 colShallow = vec3(0.440, 0.660, 0.755);
vec3 colFoam = vec3(0.950, 0.945, 0.928);
vec3 cSea = mix(colDeep, colShallow, shallow);
cSea = mix(cSea, colFoam, clamp(foamLine * 0.42 + shoreEdge * 0.72, 0.0, 1.0));

vec3 studioPaper = vec3(0.960784, 0.956863, 0.941176);
float horizonFade = smoothstep(82.0, 195.0, r);
vec3 seaCol = mix(mix(wSea, cSea, uColorMix), studioPaper, horizonFade);
diffuseColor.rgb *= seaCol;`,
        );
    };
    return mat;
  }

  private createRevealableRoadMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#e5e0d5',
      roughness: 0.94,
      metalness: 0.0,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    mat.customProgramCacheKey = () => 'italian-island-reveal-road-v1';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aReveal;\nvarying float vReveal;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vReveal = aReveal;
transformed.y -= (1.0 - smoothstep(0.0, 0.8, aReveal)) * 0.06;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vReveal;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float vis = smoothstep(0.02, 0.92, vReveal);
if (vis <= 0.005) discard;
diffuseColor.a *= vis;`,
        );
    };
    return mat;
  }

  private createRevealableCurbMaterial(): THREE.LineBasicMaterial {
    const mat = new THREE.LineBasicMaterial({
      color: 0xb7b1a4,
      transparent: true,
      opacity: 0.65,
    });
    mat.customProgramCacheKey = () => 'italian-island-reveal-curb-v1';
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aReveal;\nvarying float vReveal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvReveal = aReveal;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vReveal;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float vis = smoothstep(0.06, 0.95, vReveal);
if (vis <= 0.005) discard;
diffuseColor.a *= vis;`,
        );
    };
    return mat;
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public setColorEnabled(enabled: boolean): void {
    this.colorEnabled = Boolean(enabled);
    this.applyLightingAndColors();
  }

  public setWindowOpen(mode: WindowOpenMode, ratio: number): void {
    this.winOpenMode = mode;
    this.winOpenRatio = Math.max(0, Math.min(1, ratio));
    let anyChunkDirty = false;
    for (const h of this.mountedHouses) {
      h.rig?.setWindowOpen(this.winOpenMode, this.winOpenRatio);
      if (h.baked || h.inChunk) {
        h.baked = null;
        if (h.inChunk) {
          h.inChunk = false;
          this.settledChunks[h.chunkKey].dirty = true;
          anyChunkDirty = true;
        }
        if (h.progress >= 0.999) {
          this.applyHouseVisual(h, h.progress);
        }
      }
    }
    if (anyChunkDirty) {
      this.flushDirtyChunks(this.settledChunks.length);
    }
  }

  private applyLightingAndColors(): void {
    this.seaUniforms.uColorMix.value = this.colorEnabled ? 1 : 0;
    this.settledUniforms.uColorMix.value = this.colorEnabled ? 1 : 0;
    this.shadowDirty = true;

    if (this.colorEnabled) {
      this.hemi.color.set('#fffdf8');
      this.hemi.groundColor.set('#dfd9cf');
      this.hemi.intensity = 1.54;
      this.sun.color.set('#fffdf9');
      this.sun.intensity = 1.28;
      this.fill.intensity = 0.26;
      this.terrainMat.color.set('#f3efe6');
      this.terrainUniforms.uShoreColor.value.set('#e8d8bc');
      this.terrainUniforms.uSlopeColor.value.set('#f2eee5');
      this.terrainUniforms.uCliffColor.value.set('#ddd8ce');
      this.terrainUniforms.uCrestColor.value.set('#faf8f2');
      this.roadMat.color.set('#e2d9c6');
      this.plinthMat.color.set('#eae5da');
      this.trunkMat.color.set('#b8a995');
      this.treeMat.color.set('#7c9979');
      const len = ARCHITECTURAL_COLOR_SCHEMES.length;
      for (let i = 0; i < this.matPool.length; i++) {
        const m = this.matPool[i];
        m.setColorSchemes([
          ARCHITECTURAL_COLOR_SCHEMES[i % len],
          ARCHITECTURAL_COLOR_SCHEMES[(i + 2) % len],
          ARCHITECTURAL_COLOR_SCHEMES[(i + 5) % len],
          ARCHITECTURAL_COLOR_SCHEMES[(i + 3) % len],
        ]);
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#fbfaf7');
      }
    } else {
      this.hemi.color.set('#fffef9');
      this.hemi.groundColor.set('#dfd9ce');
      this.hemi.intensity = 1.74;
      this.sun.color.set('#fffdf6');
      this.sun.intensity = 2.02;
      this.fill.intensity = 0.30;
      this.terrainMat.color.set('#f5f4f0');
      this.terrainUniforms.uShoreColor.value.set('#ece4d4');
      this.terrainUniforms.uSlopeColor.value.set('#f5f4f0');
      this.terrainUniforms.uCliffColor.value.set('#e7e4dc');
      this.terrainUniforms.uCrestColor.value.set('#fcfbf8');
      this.roadMat.color.set('#e6e2d8');
      this.plinthMat.color.set('#efede6');
      this.trunkMat.color.set('#d7d2c7');
      this.treeMat.color.set('#e8e6de');
      for (const m of this.matPool) {
        m.setOutsideColor('#f5f4f0');
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#f8f7f3');
      }
    }

    const sunDir = this.colorEnabled ? SUN_DIR_COLOR : SUN_DIR_WHITE;
    this.sun.target.position.set(0, 5, 0);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(sunDir.x * 88, 5 + sunDir.y * 88, sunDir.z * 88);
  }

  private clearIsland(): void {
    for (const h of this.mountedHouses) {
      h.rig?.dispose();
      h.rig = null;
      h.wrapper = null;
      h.plinth = null;
      h.baked = null;
      h.inChunk = false;
    }
    this.mountedHouses.length = 0;
    for (const ch of this.settledChunks) {
      ch.mesh?.geometry.dispose();
      ch.mesh = null;
      ch.houses.length = 0;
    }
    this.settledChunks.length = 0;
    this.shadowDirty = true;
    for (const r of this.mountedRoads) {
      r.mesh.geometry.dispose();
      r.curbLines.geometry.dispose();
    }
    this.mountedRoads.length = 0;
    this.treeEntries.length = 0;
    if (this.trunkInstMesh) {
      this.trunkInstMesh.dispose();
      this.trunkInstMesh = null;
    }
    for (let v = 0; v < 3; v++) {
      if (this.crownInstMeshes[v]) {
        this.crownInstMeshes[v]!.dispose();
        this.crownInstMeshes[v] = null;
      }
    }
    for (const g of this.staticGeos) g.dispose();
    this.staticGeos.length = 0;
    this.islandRoot.clear();
    this.terrainMesh = null;
    this.brushRing.visible = false;
    for (const rp of this.ripples) {
      rp.active = false;
      rp.mesh.visible = false;
    }
  }

  public rebuild(opts: IslandWorldOptions, resetCamera = true): IslandWorld {
    this.clearIsland();
    const world = createIslandWorld(opts);
    this.world = world;

    const h = world.terrain.coastHarmonics;
    this.seaUniforms.uOrientAng.value = h.orientAng;
    this.seaUniforms.uHarmA.value.set(h.a2, h.a3, h.a4, h.a5);
    this.seaUniforms.uHarmP.value.set(h.p2, h.p3, h.p4, h.p5);

    // 1. Sculpted Italian limestone paper island terrain
    const tGeo = buildIslandTerrainGeometry(world.terrain, 48, 96);
    this.staticGeos.push(tGeo);
    const tMesh = new THREE.Mesh(tGeo, this.terrainMat);
    tMesh.receiveShadow = true;
    tMesh.castShadow = true;
    this.terrainMesh = tMesh;
    this.islandRoot.add(tMesh);

    // 2. Crisp Marching Squares topographic contour lines across cliffs & mountain ridges
    if (world.contours.length > 0 && world.hills > 0.02) {
      const minorPts: number[] = [];
      const majorPts: number[] = [];
      for (const seg of world.contours) {
        const dst = seg.isMajor ? majorPts : minorPts;
        dst.push(seg.a[0], seg.y + 0.036, seg.a[1], seg.b[0], seg.y + 0.036, seg.b[1]);
      }
      if (minorPts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(minorPts, 3));
        this.staticGeos.push(g);
        this.islandRoot.add(new THREE.LineSegments(g, this.contourMinorMat));
      }
      if (majorPts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
        this.staticGeos.push(g);
        this.islandRoot.add(new THREE.LineSegments(g, this.contourMajorMat));
      }
    }

    // 3. Hidden-until-built serpentine switchback road + hillside contour roads (`aReveal` starts at 0!)
    for (const road of world.roads) {
      const ribbon = buildRevealableRoadRibbon(road, world.terrain, this.roadMat, this.curbMat);
      this.mountedRoads.push(ribbon);
      this.islandRoot.add(ribbon.mesh);
      this.islandRoot.add(ribbon.curbLines);
    }

    // 4. Batched InstancedMesh Mediterranean cypresses & stone pines (4 draw calls total!)
    if (world.trees.length > 0) {
      const counts: [number, number, number] = [0, 0, 0];
      for (const tr of world.trees) counts[tr.variant]++;

      const trunkMesh = new THREE.InstancedMesh(this.treeGeos.trunk, this.trunkMat, world.trees.length);
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      this.trunkInstMesh = trunkMesh;
      this.islandRoot.add(trunkMesh);

      const geos = [this.treeGeos.cypress, this.treeGeos.pine, this.treeGeos.umbrella] as const;
      for (let v = 0; v < 3; v++) {
        if (counts[v] > 0) {
          const cm = new THREE.InstancedMesh(geos[v], this.treeMat, counts[v]);
          cm.castShadow = true;
          cm.receiveShadow = true;
          this.crownInstMeshes[v] = cm;
          this.islandRoot.add(cm);
        }
      }

      const cursors: [number, number, number] = [0, 0, 0];
      const dummy = this.tmpTreeDummy;
      world.trees.forEach((tr, tIdx) => {
        const cIdx = cursors[tr.variant]++;
        dummy.position.set(tr.x, tr.y - 0.04, tr.z);
        dummy.rotation.set(0, tr.rotY, 0);
        dummy.scale.setScalar(tr.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(tIdx, dummy.matrix);
        this.crownInstMeshes[tr.variant]!.setMatrixAt(cIdx, dummy.matrix);
        this.treeEntries.push({
          data: tr,
          trunkIndex: tIdx,
          crownVariant: tr.variant,
          crownIndex: cIdx,
          swayVelX: 0,
          swayVelZ: 0,
          swayX: 0,
          swayZ: 0,
        });
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      for (let v = 0; v < 3; v++) {
        if (this.crownInstMeshes[v]) this.crownInstMeshes[v]!.instanceMatrix.needsUpdate = true;
      }
    }

    // 5. Initialize 4×4 spatial settled-house chunks (<=16 draw calls for 950+ houses!) & register plots lazily
    this.settledChunks = Array.from({ length: CHUNK_GRID * CHUNK_GRID }, (_, key) => ({
      key,
      houses: [],
      mesh: null,
      dirty: false,
    }));
    const chunkCell = (CHUNK_EXTENT * 2) / CHUNK_GRID;
    for (const plot of world.plots) {
      const gx = Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor((plot.x + CHUNK_EXTENT) / chunkCell)));
      const gz = Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor((plot.z + CHUNK_EXTENT) / chunkCell)));
      const chunkKey = gz * CHUNK_GRID + gx;
      const entry: MountedIslandHouse = {
        plot,
        rig: null,
        wrapper: null,
        plinth: null,
        chunkKey,
        baked: null,
        inChunk: false,
        plinthW: plot.footprintW + 0.10,
        plinthD: plot.footprintD + 0.10,
        plinthH: Math.max(0.32, plot.baseY - plot.groundMinY + 0.96),
        targetFold: 0,
        progress: 0,
        delay: 0,
        duration: 0.82 + (plot.index % 5) * 0.04,
        pulseAge: 99,
      };
      this.mountedHouses.push(entry);
      this.settledChunks[chunkKey].houses.push(entry);
    }

    if (resetCamera) {
      this.curYaw = this.targetYaw = 0.42 + world.terrain.coastHarmonics.orientAng;
      this.curPitch = this.targetPitch = 0.72;
      this.curDist = this.targetDist = 116;
      const midY = 3.2 + world.hills * 2.8;
      this.curTarget.set(0, midY, 0.5);
      this.targetPos.set(0, midY, 0.5);
    }

    this.applyLightingAndColors();
    this.syncCamera();
    this.emitStats();
    return world;
  }

  /** Lazily build a house's full-detail OrigamiHouseRig on the exact frame it starts rising! */
  private ensureHouseRigMounted(h: MountedIslandHouse): void {
    if (h.rig) return;
    const { plot } = h;
    const matSet = this.matPool[plot.colorIndex % this.matPool.length];
    const net = buildHouseNet(plot.spec);
    const rig = buildOrigamiHouseRig(net, matSet, false, 'city');
    rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
    rig.setPaperRelief(1);

    const wrapper = new THREE.Group();
    wrapper.position.set(plot.x, plot.baseY, plot.z);
    wrapper.rotation.y = plot.yaw;

    const plinth = new THREE.Mesh(this.unitPlinthGeo, this.plinthMat);
    plinth.scale.set(h.plinthW, 0.01, h.plinthD);
    plinth.visible = false;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    wrapper.add(plinth);

    rig.root.rotation.y = 0;
    rig.root.scale.setScalar(plot.scale);
    rig.root.position.y *= plot.scale;
    rig.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.customDepthMaterial = this.cityShadowDepthMat;
      }
    });
    if (rig.baseMesh) {
      rig.baseMesh.castShadow = false;
    }
    wrapper.add(rig.root);
    this.islandRoot.add(wrapper);

    h.rig = rig;
    h.wrapper = wrapper;
    h.plinth = plinth;
  }

  private disposeHouseRig(h: MountedIslandHouse): void {
    if (h.wrapper) {
      this.islandRoot.remove(h.wrapper);
      h.wrapper = null;
    }
    if (h.rig) {
      h.rig.dispose();
      h.rig = null;
    }
    h.plinth = null;
  }

  /**
   * Extract a settled upright house's panels + shutters + retaining plinth into island-local typed arrays
   * so up to 960+ stacked multi-story houses batch into <=16 spatial chunk draw calls (locked 60 FPS!).
   */
  private extractBakedHouseData(h: MountedIslandHouse): void {
    if (!h.rig || !h.wrapper || !h.plinth) return;
    if (!h.baked) {
      h.rig.root.visible = true;
      h.plinth.visible = true;
      this.islandRoot.updateMatrixWorld(true);
      h.wrapper.updateMatrixWorld(true);

      const invRoot = this.islandRoot.matrixWorld.clone().invert();
      const matSet = this.matPool[h.plot.colorIndex % this.matPool.length];
      const len = ARCHITECTURAL_PAPER_PALETTE.length;
      const slotCols = [
        new THREE.Color(ARCHITECTURAL_PAPER_PALETTE[h.plot.colorIndex % len]),
        new THREE.Color(ARCHITECTURAL_PAPER_PALETTE[(h.plot.colorIndex + 2) % len]),
        new THREE.Color(ARCHITECTURAL_PAPER_PALETTE[(h.plot.colorIndex + 5) % len]),
        new THREE.Color(ARCHITECTURAL_PAPER_PALETTE[(h.plot.colorIndex + 3) % len]),
      ];
      const insideCol = new THREE.Color('#fbfaf7');
      const edgeColorMode = new THREE.Color('#fbfaf7');
      const edgeWhiteMode = new THREE.Color('#f8f7f3');
      const whiteExt = new THREE.Color('#f5f4f0');
      const plinthColorMode = new THREE.Color('#eae5da');
      const plinthWhiteMode = new THREE.Color('#efede6');

      const meshes: Array<{ mesh: THREE.Mesh; slotIdx: number; isPlinth: boolean }> = [];
      meshes.push({ mesh: h.plinth, slotIdx: -1, isPlinth: true });
      h.rig.root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.visible) return;
        let ancestor: THREE.Object3D | null = obj.parent;
        while (ancestor && ancestor !== h.wrapper) {
          if (!ancestor.visible) return;
          ancestor = ancestor.parent;
        }
        const mat = obj.material;
        let slotIdx = 0;
        if (matSet.duplexSlots) {
          const idx = matSet.duplexSlots.indexOf(mat as THREE.MeshStandardMaterial);
          if (idx >= 0) slotIdx = idx;
        }
        meshes.push({ mesh: obj, slotIdx, isPlinth: false });
      });

      let totalVerts = 0;
      let totalIdx = 0;
      for (const item of meshes) {
        const g = item.mesh.geometry;
        totalVerts += g.attributes.position.count;
        totalIdx += g.index ? g.index.count : g.attributes.position.count;
      }

      const positions = new Float32Array(totalVerts * 3);
      const normals = new Float32Array(totalVerts * 3);
      const uvs = new Float32Array(totalVerts * 2);
      const colors = new Float32Array(totalVerts * 3);
      const whiteCols = new Float32Array(totalVerts * 3);
      const indices = new Uint32Array(totalIdx);

      const localMat = new THREE.Matrix4();
      const normMat = new THREE.Matrix3();
      const vPos = new THREE.Vector3();
      const vNorm = new THREE.Vector3();

      let vOff = 0;
      let iOff = 0;
      for (const item of meshes) {
        const g = item.mesh.geometry;
        const pAttr = g.attributes.position;
        const nAttr = g.attributes.normal;
        const uvAttr = g.attributes.uv;
        localMat.multiplyMatrices(invRoot, item.mesh.matrixWorld);
        normMat.getNormalMatrix(localMat);
        const extCol = item.isPlinth ? plinthColorMode : slotCols[item.slotIdx % 4];

        for (let i = 0; i < pAttr.count; i++) {
          vPos.fromBufferAttribute(pAttr, i).applyMatrix4(localMat);
          const rawNy = nAttr ? nAttr.getY(i) : 0;
          if (nAttr) {
            vNorm.fromBufferAttribute(nAttr, i).applyMatrix3(normMat).normalize();
          } else {
            vNorm.set(0, 1, 0);
          }

          const o3 = (vOff + i) * 3;
          positions[o3] = vPos.x;
          positions[o3 + 1] = vPos.y;
          positions[o3 + 2] = vPos.z;
          normals[o3] = vNorm.x;
          normals[o3 + 1] = vNorm.y;
          normals[o3 + 2] = vNorm.z;

          const o2 = (vOff + i) * 2;
          if (uvAttr) {
            uvs[o2] = uvAttr.getX(i);
            uvs[o2 + 1] = uvAttr.getY(i);
          }

          let cRGB: THREE.Color;
          let wRGB: THREE.Color;
          if (item.isPlinth) {
            cRGB = plinthColorMode;
            wRGB = plinthWhiteMode;
          } else if (rawNy > 0.5) {
            cRGB = insideCol;
            wRGB = insideCol;
          } else if (rawNy > -0.5) {
            cRGB = edgeColorMode;
            wRGB = edgeWhiteMode;
          } else {
            cRGB = extCol;
            wRGB = whiteExt;
          }
          colors[o3] = cRGB.r;
          colors[o3 + 1] = cRGB.g;
          colors[o3 + 2] = cRGB.b;
          whiteCols[o3] = wRGB.r;
          whiteCols[o3 + 1] = wRGB.g;
          whiteCols[o3 + 2] = wRGB.b;
        }

        if (g.index) {
          const arr = g.index.array;
          for (let k = 0; k < arr.length; k++) indices[iOff + k] = arr[k] + vOff;
          iOff += arr.length;
        } else {
          for (let k = 0; k < pAttr.count; k++) indices[iOff + k] = vOff + k;
          iOff += pAttr.count;
        }
        vOff += pAttr.count;
      }

      h.baked = { positions, normals, uvs, colors, whiteCols, indices };
    }

    if (!h.inChunk) {
      h.inChunk = true;
      this.settledChunks[h.chunkKey].dirty = true;
    }
  }

  /** Rebuild a single spatial chunk mesh from all settled houses inside it, freeing their temporary rigs! */
  private rebuildSettledChunk(chunk: SettledChunk): void {
    chunk.dirty = false;
    let totalVerts = 0;
    let totalIdx = 0;
    for (const h of chunk.houses) {
      if (!h.inChunk || !h.baked) continue;
      totalVerts += h.baked.positions.length / 3;
      totalIdx += h.baked.indices.length;
    }

    if (chunk.mesh) {
      this.islandRoot.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = null;
    }

    if (totalVerts === 0) {
      this.shadowDirty = true;
      return;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const colors = new Float32Array(totalVerts * 3);
    const whiteCols = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIdx);

    let vOff = 0;
    let iOff = 0;
    for (const h of chunk.houses) {
      if (!h.inChunk || !h.baked) continue;
      const b = h.baked;
      const vCount = b.positions.length / 3;
      positions.set(b.positions, vOff * 3);
      normals.set(b.normals, vOff * 3);
      uvs.set(b.uvs, vOff * 2);
      colors.set(b.colors, vOff * 3);
      whiteCols.set(b.whiteCols, vOff * 3);
      for (let k = 0; k < b.indices.length; k++) {
        indices[iOff + k] = b.indices[k] + vOff;
      }
      vOff += vCount;
      iOff += b.indices.length;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    merged.setAttribute('aWhiteCol', new THREE.BufferAttribute(whiteCols, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    merged.computeBoundingSphere();

    const mesh = new THREE.Mesh(merged, this.settledHouseMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.islandRoot.add(mesh);
    chunk.mesh = mesh;

    // Now that the chunk displays these settled houses cleanly, free their articulated rigs (zero flicker!)
    for (const h of chunk.houses) {
      if (h.inChunk && h.rig) {
        this.disposeHouseRig(h);
      }
    }
    this.shadowDirty = true;
  }

  private flushDirtyChunks(maxChunks = 2): void {
    let rebuilt = 0;
    for (const ch of this.settledChunks) {
      if (!ch.dirty) continue;
      this.rebuildSettledChunk(ch);
      rebuilt++;
      if (rebuilt >= maxChunks) break;
    }
  }

  public consumeShadowDirty(): boolean {
    if (!this.shadowDirty) return false;
    this.shadowDirty = false;
    return true;
  }

  private applyHouseVisual(h: MountedIslandHouse, rawProgress: number, pulse = 0): void {
    this.shadowDirty = true;
    if (rawProgress <= 0.002) {
      if (h.inChunk) {
        h.inChunk = false;
        this.rebuildSettledChunk(this.settledChunks[h.chunkKey]);
      }
      if (h.rig) this.disposeHouseRig(h);
      return;
    }

    // Ultra-fast spatial-chunk batched path whenever settled upright & not fluttering!
    if (rawProgress >= 0.999 && Math.abs(pulse) < 0.0005 && h.baked) {
      if (!h.inChunk) {
        h.inChunk = true;
        const ch = this.settledChunks[h.chunkKey];
        if (!h.wrapper) {
          this.rebuildSettledChunk(ch);
        } else {
          ch.dirty = true;
        }
      }
      return;
    }

    // If this house was previously baked into a spatial chunk, pull it out cleanly before animating!
    if (h.inChunk) {
      h.inChunk = false;
      this.rebuildSettledChunk(this.settledChunks[h.chunkKey]);
    }

    this.ensureHouseRigMounted(h);
    const rig = h.rig!;
    const wrapper = h.wrapper!;
    const plinth = h.plinth!;
    wrapper.visible = true;
    rig.root.visible = true;

    const fold = easePaperSnap(rawProgress);
    const wallFold = smoothstep(0.0, 0.68, Math.min(1, fold)) + Math.max(0, fold - 1) * 0.6;
    const roofFold = smoothstep(0.24, 0.94, Math.min(1, fold)) + Math.max(0, fold - 1) * 0.8 - pulse * 0.09;
    const capFold = smoothstep(0.50, 1.0, Math.min(1, fold)) - pulse * 0.06;

    for (const id of rig.panelIds) {
      const stage = rig.net.panelMap.get(id)?.stage;
      const pFold = stage === 'cap' ? capFold : stage === 'roof' ? roofFold : wallFold;
      rig.updatePanelVisual(id, Math.max(0, Math.min(1.04, pFold)), 0, false);
    }

    const houseLifting = wallFold > 0.04;
    rig.panels.forEach((pv) => {
      pv.mesh.castShadow = houseLifting;
    });
    const showDetails = wallFold > 0.14;
    for (const det of rig.details) {
      det.pivot.visible = showDetails;
      det.pivot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = houseLifting && showDetails;
      });
    }
    if (rig.baseMesh) {
      rig.baseMesh.castShadow = false;
    }
    rig.setFoldLinesVisible(wallFold > 0.12 && rawProgress < 0.56);

    rig.root.scale.set(
      h.plot.scale * (1 + pulse * 0.03),
      h.plot.scale * (1 - pulse * 0.05),
      h.plot.scale * (1 + pulse * 0.03),
    );

    const pRise = smoothstep(0.08, 0.50, Math.min(1, wallFold));
    plinth.visible = pRise > 0.01;
    if (plinth.visible) {
      plinth.scale.set(h.plinthW, Math.max(0.01, h.plinthH * pRise), h.plinthD);
      plinth.position.y = -h.plinthH * 0.5 * pRise;
    }

    // Extract & queue into spatial chunk the moment it settles cleanly upright!
    if (rawProgress >= 0.999 && Math.abs(pulse) < 0.0005) {
      this.extractBakedHouseData(h);
    }
  }

  /** Spatial road unveiling: reveals any serpentine/corniche/terrace road segments near folded houses + bridges short gaps! */
  private recomputeRoadRevealTargets(): void {
    const foldedHouses: Array<{ x: number; z: number }> = [];
    for (const h of this.mountedHouses) {
      if (h.targetFold === 1) {
        foldedHouses.push({ x: h.plot.x, z: h.plot.z });
      }
    }

    if (foldedHouses.length === 0) {
      for (const r of this.mountedRoads) {
        r.targetReveal.fill(0);
        r.dirty = true;
      }
      return;
    }

    const r2Max = ROAD_REVEAL_RADIUS * ROAD_REVEAL_RADIUS;
    for (const r of this.mountedRoads) {
      const pts = r.road.points;
      const n = pts.length;
      const next = new Uint8Array(n);

      for (let i = 0; i < n; i++) {
        const px = pts[i].x;
        const pz = pts[i].z;
        for (let k = 0; k < foldedHouses.length; k++) {
          const dx = foldedHouses[k].x - px;
          const dz = foldedHouses[k].z - pz;
          if (dx * dx + dz * dz <= r2Max) {
            next[i] = 1;
            break;
          }
        }
      }

      // Bridge short unlit gaps (<= 10 vertices) along the same road so serpentine curves flow seamlessly!
      const maxGap = r.road.kind === 'serpentine' ? 14 : 9;
      let lastLit = -1;
      for (let i = 0; i < n; i++) {
        if (next[i]) {
          if (lastLit >= 0 && i - lastLit > 1 && i - lastLit <= maxGap) {
            for (let g = lastLit + 1; g < i; g++) next[g] = 1;
          }
          lastLit = i;
        }
      }
      // If serpentine starts lighting near the harbor, connect cleanly down to the harbor edge
      if (r.road.kind === 'serpentine') {
        for (let i = 0; i < Math.min(n, 20); i++) {
          if (next[i]) {
            for (let g = 0; g < i; g++) next[g] = 1;
            break;
          }
        }
      }

      for (let i = 0; i < n; i++) {
        const val = next[i];
        if (r.targetReveal[i] !== val) {
          r.targetReveal[i] = val;
          r.dirty = true;
        }
      }
    }
  }

  private spawnSurfaceRipple(wx: number, wz: number, maxRadius: number, maxAge = 0.62): void {
    if (!this.world) return;
    const rp = this.ripples[this.rippleCursor];
    this.rippleCursor = (this.rippleCursor + 1) % MAX_RIPPLES;
    const y = this.world.terrain.heightAt(wx, wz) + 0.16;
    const eps = 0.4;
    const hL = this.world.terrain.heightAt(wx - eps, wz);
    const hR = this.world.terrain.heightAt(wx + eps, wz);
    const hD = this.world.terrain.heightAt(wx, wz - eps);
    const hU = this.world.terrain.heightAt(wx, wz + eps);
    this.tmpV1.set(hL - hR, 2 * eps, hD - hU).normalize();
    this.tmpQ.setFromUnitVectors(this.upAxis, this.tmpV1);

    rp.active = true;
    rp.age = 0;
    rp.maxAge = maxAge;
    rp.maxRadius = maxRadius;

    rp.mesh.position.set(wx, y, wz);
    rp.mesh.quaternion.copy(this.tmpQ);
    rp.mesh.scale.setScalar(0.5);
    rp.mat.opacity = 0.36;
    rp.mesh.visible = true;
  }

  private nudgeNearbyTrees(bx: number, bz: number): void {
    for (const tr of this.treeEntries) {
      const dx = tr.data.x - bx;
      const dz = tr.data.z - bz;
      const d = Math.hypot(dx, dz);
      if (d > 6.2 || d < 1e-4) continue;
      const falloff = (1 - d / 6.2) * 0.65;
      tr.swayVelX += (dz / d) * falloff;
      tr.swayVelZ += (-dx / d) * falloff;
    }
  }

  public touchAt(wx: number, wz: number, radius = PAINT_BRUSH_RADIUS, isClick = false, unfold = false): number {
    let triggered = 0;
    let pulsed = 0;
    const targetVal: 0 | 1 = unfold ? 0 : 1;

    for (const h of this.mountedHouses) {
      const d = Math.hypot(h.plot.x - wx, h.plot.z - wz);
      if (d > radius) continue;

      if (h.targetFold !== targetVal) {
        h.targetFold = targetVal;
        h.delay = isClick ? d * 0.028 : d * 0.018;
        triggered++;
        if (targetVal === 1) {
          this.nudgeNearbyTrees(h.plot.x, h.plot.z);
        }
      } else if (isClick && targetVal === 1 && h.progress > 0.85 && d < 3.6) {
        h.pulseAge = 0;
        pulsed++;
      }
    }

    if (triggered > 0) {
      this.recomputeRoadRevealTargets();
      this.spawnSurfaceRipple(wx, wz, isClick ? radius * 0.90 : radius * 0.68, isClick ? 0.68 : 0.44);
      this.hudDirty = true;
    } else if (isClick && pulsed > 0) {
      this.spawnSurfaceRipple(wx, wz, 3.2, 0.42);
    }

    return triggered;
  }

  public setCityFold(target: 0 | 1, instant = false): void {
    for (const h of this.mountedHouses) {
      h.targetFold = target;
      if (instant) {
        h.delay = 0;
        h.progress = target;
        h.pulseAge = 99;
        this.applyHouseVisual(h, target);
      } else {
        const order = target === 1 ? h.plot.elevOrder : 1 - h.plot.elevOrder;
        h.delay = order * 2.55;
      }
    }
    if (instant) {
      this.flushDirtyChunks(this.settledChunks.length);
    }
    this.recomputeRoadRevealTargets();
    if (instant) {
      this.syncAllRoadRevealInstant();
    }
    this.hudDirty = true;
    this.emitStats();
  }

  private syncAllRoadRevealInstant(): void {
    for (const r of this.mountedRoads) {
      let maxV = 0;
      for (let i = 0; i < r.curReveal.length; i++) {
        const v = r.targetReveal[i];
        r.curReveal[i] = v;
        if (v > maxV) maxV = v;
      }
      this.uploadRoadRevealBuffer(r, maxV);
      r.dirty = false;
    }
  }

  private uploadRoadRevealBuffer(r: MountedRoadRibbon, maxV: number): void {
    const visible = maxV > 0.005;
    r.mesh.visible = visible;
    r.curbLines.visible = visible;
    if (!visible) return;

    const mArr = r.meshRevealAttr.array as Float32Array;
    const cArr = r.curbRevealAttr.array as Float32Array;
    const n = r.curReveal.length;
    for (let i = 0; i < n; i++) {
      const v = r.curReveal[i];
      const o3 = i * 3;
      mArr[o3] = v;
      mArr[o3 + 1] = v;
      mArr[o3 + 2] = v;
    }
    for (let i = 0; i < n - 1; i++) {
      const v0 = r.curReveal[i];
      const v1 = r.curReveal[i + 1];
      const o4 = i * 4;
      cArr[o4] = v0;
      cArr[o4 + 1] = v1;
      cArr[o4 + 2] = v0;
      cArr[o4 + 3] = v1;
    }
    r.meshRevealAttr.needsUpdate = true;
    r.curbRevealAttr.needsUpdate = true;
  }

  public setCameraView(yaw: number, pitch: number, dist: number, tx = 0, ty = 4.8, tz = 0.5): void {
    this.curYaw = this.targetYaw = yaw;
    this.curPitch = this.targetPitch = Math.max(0.22, Math.min(1.38, pitch));
    this.curDist = this.targetDist = Math.max(34, Math.min(165, dist));
    this.curTarget.set(tx, ty, tz);
    this.targetPos.set(tx, ty, tz);
    this.syncCamera();
  }

  private syncCamera(): void {
    const cx = this.curTarget.x + this.curDist * Math.cos(this.curPitch) * Math.sin(this.curYaw);
    const cy = this.curTarget.y + this.curDist * Math.sin(this.curPitch);
    const cz = this.curTarget.z + this.curDist * Math.cos(this.curPitch) * Math.cos(this.curYaw);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.curTarget);
  }

  public update(dt: number): void {
    if (!this.world) return;
    this.elapsedTime += dt;
    this.seaUniforms.uTime.value = this.elapsedTime;

    // 1. Silky 3/4-top orbit camera interpolation
    const k = 1 - Math.exp(-8.5 * dt);
    this.curYaw += (this.targetYaw - this.curYaw) * k;
    this.curPitch += (this.targetPitch - this.curPitch) * k;
    this.curDist += (this.targetDist - this.curDist) * k;
    this.curTarget.lerp(this.targetPos, k);
    this.syncCamera();

    // 2. Animate origami houses (time-budgeted lazy rig mounting + progressive 16-chunk batching!)
    let mountedThisFrame = 0;
    for (const h of this.mountedHouses) {
      let changed = false;
      if (h.delay > 0) {
        h.delay = Math.max(0, h.delay - dt);
      } else {
        const diff = h.targetFold - h.progress;
        if (Math.abs(diff) > 0.0005) {
          if (!h.rig && h.targetFold === 1) {
            if (mountedThisFrame >= 14) continue; // pace lazy rig builds gently across frames -> zero stutter!
            mountedThisFrame++;
          }
          const speed = h.targetFold === 1 ? 1 / h.duration : 1.65;
          if (diff > 0) h.progress = Math.min(1, h.progress + dt * speed);
          else h.progress = Math.max(0, h.progress - dt * speed);
          changed = true;
        }
      }

      let pulse = 0;
      if (h.pulseAge < 0.55) {
        h.pulseAge += dt;
        const u = Math.min(1, h.pulseAge / 0.55);
        pulse = Math.sin(u * Math.PI * 2.0) * (1 - u) * (1 - u);
        changed = true;
      }

      if (changed) {
        this.applyHouseVisual(h, h.progress, pulse);
      }
    }
    this.flushDirtyChunks(3);

    // 3. Smoothly unveil/hide road ribbons
    const roadRate = 1 - Math.exp(-4.5 * dt);
    for (const r of this.mountedRoads) {
      if (!r.dirty) continue;
      let stillMoving = false;
      let maxV = 0;
      for (let i = 0; i < r.curReveal.length; i++) {
        const diff = r.targetReveal[i] - r.curReveal[i];
        if (Math.abs(diff) > 0.004) {
          r.curReveal[i] += diff * roadRate;
          stillMoving = true;
        } else {
          r.curReveal[i] = r.targetReveal[i];
        }
        if (r.curReveal[i] > maxV) maxV = r.curReveal[i];
      }
      this.uploadRoadRevealBuffer(r, maxV);
      r.dirty = stillMoving;
    }

    // 4. Damped harmonic spring sway on nearby instanced cypresses & pines
    const stiffness = 24.0;
    const damping = 5.4;
    let trunkDirty = false;
    const crownDirty: [boolean, boolean, boolean] = [false, false, false];
    const dummy = this.tmpTreeDummy;
    for (const tr of this.treeEntries) {
      if (
        Math.abs(tr.swayX) > 0.0005 ||
        Math.abs(tr.swayZ) > 0.0005 ||
        Math.abs(tr.swayVelX) > 0.0005 ||
        Math.abs(tr.swayVelZ) > 0.0005
      ) {
        tr.swayVelX += (-stiffness * tr.swayX - damping * tr.swayVelX) * dt;
        tr.swayVelZ += (-stiffness * tr.swayZ - damping * tr.swayVelZ) * dt;
        tr.swayX += tr.swayVelX * dt;
        tr.swayZ += tr.swayVelZ * dt;

        dummy.position.set(tr.data.x, tr.data.y - 0.04, tr.data.z);
        dummy.rotation.set(
          Math.max(-0.14, Math.min(0.14, tr.swayX)),
          tr.data.rotY,
          Math.max(-0.14, Math.min(0.14, tr.swayZ)),
        );
        dummy.scale.setScalar(tr.data.scale);
        dummy.updateMatrix();
        this.trunkInstMesh?.setMatrixAt(tr.trunkIndex, dummy.matrix);
        this.crownInstMeshes[tr.crownVariant]?.setMatrixAt(tr.crownIndex, dummy.matrix);
        trunkDirty = true;
        crownDirty[tr.crownVariant] = true;
      }
    }
    if (trunkDirty && this.trunkInstMesh) this.trunkInstMesh.instanceMatrix.needsUpdate = true;
    for (let v = 0; v < 3; v++) {
      if (crownDirty[v] && this.crownInstMeshes[v]) this.crownInstMeshes[v]!.instanceMatrix.needsUpdate = true;
    }

    // 5. Fade idle brush ring & expand hillside ripples
    if (this.brushRing.visible && this.dragMode !== 'paint') {
      this.brushIdleTime += dt;
      const fade = 1 - smoothstep(0.45, 0.95, this.brushIdleTime);
      this.brushRingMat.opacity = 0.24 * fade;
      if (fade <= 0.005) this.brushRing.visible = false;
    }
    for (const rp of this.ripples) {
      if (!rp.active) continue;
      rp.age += dt;
      if (rp.age >= rp.maxAge) {
        rp.active = false;
        rp.mesh.visible = false;
        continue;
      }
      const u = rp.age / rp.maxAge;
      const sc = 0.6 + (rp.maxRadius - 0.6) * (1 - Math.pow(1 - u, 2.2));
      rp.mesh.scale.setScalar(sc);
      rp.mat.opacity = 0.36 * (1 - u) * (1 - u);
    }

    this.hudEmitAccum += dt;
    if (this.hudDirty && this.hudEmitAccum >= 0.12) {
      this.hudDirty = false;
      this.hudEmitAccum = 0;
      this.emitStats();
    }
  }

  private raycastIslandTerrain(clientX: number, clientY: number, canvas: HTMLCanvasElement): THREE.Intersection | null {
    if (!this.terrainMesh || !this.world) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    if (hits.length === 0) return null;
    const pt = hits[0].point;
    if (pt.y < 0.18 || this.world.terrain.signedInland(pt.x, pt.z) < 0.2) return null;
    return hits[0];
  }

  private updateBrushRingAt(hit: THREE.Intersection | null, radius = PAINT_BRUSH_RADIUS): void {
    if (!hit || !this.world) {
      this.brushRing.visible = false;
      return;
    }
    const { x, y, z } = hit.point;
    const eps = 0.4;
    const hL = this.world.terrain.heightAt(x - eps, z);
    const hR = this.world.terrain.heightAt(x + eps, z);
    const hD = this.world.terrain.heightAt(x, z - eps);
    const hU = this.world.terrain.heightAt(x, z + eps);
    this.tmpV1.set(hL - hR, 2 * eps, hD - hU).normalize();
    this.tmpQ.setFromUnitVectors(this.upAxis, this.tmpV1);
    this.brushRing.position.set(x, y + 0.18, z);
    this.brushRing.quaternion.copy(this.tmpQ);
    this.brushRing.scale.setScalar(radius * 0.62);
    this.brushIdleTime = 0;
    this.brushRingMat.opacity = 0.26;
    this.brushRing.visible = true;
  }

  public onPointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);

    // Two simultaneous touch fingers -> orbit + pinch zoom!
    if (this.activePointers.size >= 2) {
      const pts = Array.from(this.activePointers.values());
      this.dragMode = 'orbit2';
      this.lastTwoMidX = (pts[0].x + pts[1].x) * 0.5;
      this.lastTwoMidY = (pts[0].y + pts[1].y) * 0.5;
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this.brushRing.visible = false;
      canvas.style.cursor = 'grabbing';
      return;
    }

    this.primaryPointerId = e.pointerId;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;

    // Cmd + click, Ctrl + click, or Right-click (incl. two-finger click) -> ROTATE!
    if (e.metaKey || e.ctrlKey || e.button === 2) {
      this.dragMode = 'orbit';
      this.brushRing.visible = false;
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Otherwise -> POPULATE HOUSES right where you touch & drag!
    this.dragMode = 'paint';
    const hit = this.raycastIslandTerrain(e.clientX, e.clientY, canvas);
    this.updateBrushRingAt(hit, CLICK_BURST_RADIUS * 0.72);
    if (hit) {
      this.lastTouchX = hit.point.x;
      this.lastTouchZ = hit.point.z;
      this.touchAt(hit.point.x, hit.point.z, CLICK_BURST_RADIUS, true, e.altKey);
      canvas.style.cursor = 'crosshair';
    }
  }

  public onPointerMove(e: PointerEvent, canvas: HTMLCanvasElement): void {
    const tracked = this.activePointers.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
    }

    // Two-finger touch rotate + pinch zoom
    if (this.dragMode === 'orbit2' && this.activePointers.size >= 2) {
      const pts = Array.from(this.activePointers.values());
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;
      const dx = midX - this.lastTwoMidX;
      const dy = midY - this.lastTwoMidY;
      this.lastTwoMidX = midX;
      this.lastTwoMidY = midY;
      this.targetYaw -= dx * 0.0068;
      this.targetPitch = Math.max(0.22, Math.min(1.36, this.targetPitch + dy * 0.0056));

      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (this.lastPinchDist > 8 && dist > 8) {
        this.targetDist = Math.max(34, Math.min(165, this.targetDist * (this.lastPinchDist / dist)));
      }
      this.lastPinchDist = dist;
      return;
    }

    // Cmd-drag / Ctrl-drag / Right-drag orbit
    if (this.dragMode === 'orbit') {
      if (e.pointerId !== this.primaryPointerId) return;
      const dx = e.clientX - this.lastPx;
      const dy = e.clientY - this.lastPy;
      this.lastPx = e.clientX;
      this.lastPy = e.clientY;
      this.targetYaw -= dx * 0.0068;
      this.targetPitch = Math.max(0.22, Math.min(1.36, this.targetPitch + dy * 0.0056));
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Active click-drag / 1-finger drag painting houses across the island!
    if (this.dragMode === 'paint') {
      if (e.pointerId !== this.primaryPointerId) return;
      const hit = this.raycastIslandTerrain(e.clientX, e.clientY, canvas);
      this.updateBrushRingAt(hit, PAINT_BRUSH_RADIUS);
      if (hit) {
        const distFromLast = Number.isFinite(this.lastTouchX)
          ? Math.hypot(hit.point.x - this.lastTouchX, hit.point.z - this.lastTouchZ)
          : 999;
        if (distFromLast > 0.55) {
          this.lastTouchX = hit.point.x;
          this.lastTouchZ = hit.point.z;
          this.touchAt(hit.point.x, hit.point.z, PAINT_BRUSH_RADIUS, false, e.altKey);
        }
      }
      return;
    }

    // Passive hover: show subtle aiming ring on island (never folds until you press!)
    if (e.metaKey || e.ctrlKey) {
      this.brushRing.visible = false;
      canvas.style.cursor = 'grab';
      return;
    }
    const hit = this.raycastIslandTerrain(e.clientX, e.clientY, canvas);
    this.updateBrushRingAt(hit, PAINT_BRUSH_RADIUS);
    canvas.style.cursor = hit ? 'crosshair' : 'default';
  }

  public onPointerUp(e: PointerEvent, canvas: HTMLCanvasElement): void {
    this.activePointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (this.activePointers.size === 0) {
      this.dragMode = 'none';
      this.primaryPointerId = null;
      this.lastTouchX = Number.NaN;
      this.lastTouchZ = Number.NaN;
      canvas.style.cursor = 'default';
    } else if (this.activePointers.size === 1) {
      this.dragMode = 'none';
      this.primaryPointerId = null;
    }
  }

  /**
   * Two-finger trackpad swipe -> ROTATE island smoothly!
   * Two-finger trackpad pinch (`e.ctrlKey`) or `Cmd + scroll` -> ZOOM!
   */
  public onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) {
      const gain = e.ctrlKey ? 0.011 : 0.0014;
      const scale = Math.exp(e.deltaY * gain);
      this.targetDist = Math.max(34, Math.min(165, this.targetDist * scale));
      return;
    }
    this.brushRing.visible = false;
    this.targetYaw += e.deltaX * 0.0052;
    this.targetPitch = Math.max(0.22, Math.min(1.36, this.targetPitch + e.deltaY * 0.0044));
  }

  public getStats(): CityViewStats {
    let foldedCount = 0;
    for (const h of this.mountedHouses) {
      if (h.targetFold === 1) foldedCount++;
    }
    let roadSum = 0;
    let roadSamples = 0;
    for (const r of this.mountedRoads) {
      for (let i = 0; i < r.targetReveal.length; i++) {
        roadSum += r.targetReveal[i];
        roadSamples++;
      }
    }
    return {
      active: true,
      seed: this.world?.seed ?? 0,
      hills: this.world?.hills ?? 0.72,
      foldedCount,
      totalPlots: this.mountedHouses.length,
      rooftopCount: this.world?.rooftopCount ?? 0,
      roadRevealRatio: roadSamples > 0 ? Math.round((roadSum / roadSamples) * 1000) / 1000 : 0,
      camPos: [
        Math.round(this.camera.position.x * 10) / 10,
        Math.round(this.camera.position.y * 10) / 10,
        Math.round(this.camera.position.z * 10) / 10,
      ],
    };
  }

  private emitStats(): void {
    this.callbacks.onWorldStats?.(this.getStats());
  }

  public dispose(): void {
    this.clearIsland();
    for (const m of this.matPool) m.dispose();
    if (this.ownedWashiTex) {
      this.ownedWashiTex.map.dispose();
      this.ownedWashiTex.bumpMap.dispose();
    }
    this.terrainMat.dispose();
    this.seaMat.dispose();
    this.roadMat.dispose();
    this.curbMat.dispose();
    this.plinthMat.dispose();
    this.trunkMat.dispose();
    this.treeMat.dispose();
    this.contourMinorMat.dispose();
    this.contourMajorMat.dispose();
    this.cityShadowDepthMat.dispose();
    this.settledHouseMat.dispose();
    this.unitPlinthGeo.dispose();
    this.treeGeos.trunk.dispose();
    this.treeGeos.cypress.dispose();
    this.treeGeos.pine.dispose();
    this.treeGeos.umbrella.dispose();
    this.seaMesh.geometry.dispose();
    this.brushRing.geometry.dispose();
    this.brushRingMat.dispose();
    for (const rp of this.ripples) rp.mat.dispose();
  }
}
