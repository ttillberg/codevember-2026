import * as THREE from 'three';
import { R_BALL, R_SHELL, R_WALL } from './maze';

export const STUDIO_FLOOR_Y = -1.18;

export type FinalePhase = 'idle' | 'lift' | 'fall' | 'unsealed';

export interface FinaleCallbacks {
  onLiftStart?: () => void;
  onSealPop?: () => void;
  onMarbleBounce?: (strength: number) => void;
  onShellBounce?: (strength: number) => void;
  onSmokeBurst?: (pan: number) => void;
}

export interface FinaleFrameResult {
  phase: FinalePhase;
  corePos: THREE.Vector3;
  coreQuat: THREE.Quaternion;
  ballPos: THREE.Vector3;
  ballDirXZ: THREE.Vector3;
  ballSpeed: number;
  followBlend: number;
  outerShellVisible: boolean;
  intactBallVisible: boolean;
  useFinaleCorePose: boolean;
  shadowScale: number;
  shadowOpacity: number;
  camShakeX: number;
  camShakeY: number;
  readyForReplay: boolean;
}

interface ShellDomeBody {
  group: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  angVel: THREE.Vector3;
  apexLocal: THREE.Vector3;
  comOffsetLocal: THREE.Vector3;
  bounces: number;
  settled: boolean;
}

interface SmokePuff {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  age: number;
  maxAge: number;
  startRadius: number;
  endRadius: number;
  maxAlpha: number;
  rotation: number;
  rotSpeed: number;
  seed: number;
  buoyancy: number;
  drag: number;
  turbulence: number;
}

// Luminous hot-pink & deep electric magenta studio smoke flare palette
const SMOKE_PINK_HEX = [0xff5ca8, 0xff77b7, 0xff449c, 0xff8bc4];
const SMOKE_MAGENTA_HEX = [0xd90b78, 0xe6007e, 0xc7006e, 0xf0138c];

function pickSmokeColor(kind: 'pink' | 'magenta'): number {
  const arr = kind === 'pink' ? SMOKE_PINK_HEX : SMOKE_MAGENTA_HEX;
  return arr[Math.floor(Math.random() * arr.length)];
}

function createRadialShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(26, 23, 18, 0.62)');
  grad.addColorStop(0.36, 'rgba(32, 29, 24, 0.34)');
  grad.addColorStop(0.7, 'rgba(40, 37, 32, 0.10)');
  grad.addColorStop(1.0, 'rgba(48, 45, 40, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a custom instanced volumetric FBM smoke billboard mesh:
 * - Single draw call for hundreds of soft billowing 3D-lit cauliflower smoke puffs
 * - Perturbed pseudo-spherical normal + studio softbox key-light scattering (luminous sunlit neon-pastel tops,
 *   deep rich chroma underside folds, wispy turbulent FBM edges — zero hard billboard edges!)
 */
function createVolumetricSmokeSystem(maxPuffs: number): {
  mesh: THREE.Mesh;
  centerAttr: THREE.InstancedBufferAttribute;
  colorAttr: THREE.InstancedBufferAttribute;
  paramsAttr: THREE.InstancedBufferAttribute;
  material: THREE.ShaderMaterial;
  geometry: THREE.InstancedBufferGeometry;
} {
  const baseQuad = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = baseQuad.index;
  geometry.attributes.position = baseQuad.attributes.position;
  geometry.attributes.uv = baseQuad.attributes.uv;
  baseQuad.dispose();

  const centers = new Float32Array(maxPuffs * 3);
  const colors = new Float32Array(maxPuffs * 3);
  const params = new Float32Array(maxPuffs * 4); // (radius, alpha, rotation, seed)

  const centerAttr = new THREE.InstancedBufferAttribute(centers, 3);
  const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
  const paramsAttr = new THREE.InstancedBufferAttribute(params, 4);
  centerAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  paramsAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('aCenter', centerAttr);
  geometry.setAttribute('aColor', colorAttr);
  geometry.setAttribute('aParams', paramsAttr);
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(-0.52, 0.72, 0.46).normalize() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec3 aColor;
      attribute vec4 aParams;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vCamRight;
      varying vec3 vCamUp;
      varying vec3 vCamFwd;

      void main() {
        float radius = aParams.x;
        float alpha = aParams.y;
        float rot = aParams.z;
        float seed = aParams.w;

        vUv = uv;
        vColor = aColor;
        vAlpha = alpha;
        vSeed = seed;

        // Camera-aligned billboard basis in world space
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vCamRight = camRight;
        vCamUp = camUp;
        vCamFwd = camFwd;

        float c = cos(rot);
        float s = sin(rot);
        vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * radius;

        vec3 worldPos = aCenter + camRight * p.x + camUp * p.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLightDir;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vCamRight;
      varying vec3 vCamUp;
      varying vec3 vCamFwd;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float val = 0.0;
        float amp = 0.52;
        mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          val += amp * vnoise(p);
          p = m * p * 2.04 + vec2(1.7, 9.2);
          amp *= 0.5;
        }
        return val;
      }

      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r2 = dot(q, q);
        if (r2 > 1.0) discard;

        // Slowly boiling turbulent FBM warp for organic billowing smoke cauliflower edges
        vec2 seedOff = vec2(vSeed * 13.7, vSeed * 29.3);
        float drift = uTime * 0.24;
        vec2 warp = vec2(
          fbm(q * 1.9 + seedOff + vec2(0.0, -drift)),
          fbm(q * 1.9 + seedOff + vec2(5.2, 1.3 - drift * 0.8))
        ) - 0.5;

        vec2 p = q + warp * 0.42;
        float n = fbm(p * 2.35 + seedOff + vec2(0.0, -drift * 1.15));
        float nDetail = fbm(p * 4.4 + seedOff + vec2(2.1, -drift * 1.5));

        // Sculpted volumetric radial falloff carved by multi-octave noise (billowy cauliflower cloud silhouettes)
        float radial = 1.0 - smoothstep(0.18, 0.94, length(q) + (n - 0.48) * 0.52);
        float density = clamp(radial * (0.68 + 0.62 * n + 0.28 * nDetail), 0.0, 1.0);
        density = smoothstep(0.10, 0.80, density);
        if (density < 0.01) discard;

        // Pseudo-3D spherical normal perturbed by FBM billows for authentic studio volumetric shading!
        float nz = sqrt(max(0.02, 1.0 - min(0.98, r2)));
        float nx = q.x + (n - 0.5) * 1.15 + (nDetail - 0.5) * 0.55;
        float ny = q.y + (n - 0.5) * 1.15 - (nDetail - 0.5) * 0.42;
        vec3 worldN = normalize(vCamRight * nx + vCamUp * ny - vCamFwd * nz);

        float ndl = dot(worldN, uLightDir) * 0.5 + 0.5;
        // Self-shadowed billowing depth: luminous sunlit top-left ridge, rich saturated core & shaded underside
        vec3 deepCol = vColor * vec3(0.48, 0.42, 0.54);
        vec3 litCol = mix(vColor, vec3(1.0, 0.99, 0.98), 0.36);
        vec3 col = mix(deepCol, vColor, smoothstep(0.14, 0.58, ndl));
        col = mix(col, litCol, smoothstep(0.55, 0.94, ndl) * 0.72);

        // Soft translucent silver-lining scatter along thin wispy outer fringes
        float rimScatter = smoothstep(0.08, 0.42, density) * (1.0 - smoothstep(0.42, 0.9, density));
        col = mix(col, litCol, rimScatter * 0.34);

        float outAlpha = clamp(density * vAlpha, 0.0, 0.92);
        gl_FragColor = vec4(col, outAlpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  return { mesh, centerAttr, colorAttr, paramsAttr, material, geometry };
}

/**
 * Builds one intact clear polycarbonate shell hemisphere (north or south) with a clean
 * molded equatorial interlock flange lip & subtle detached seal tab so the popped seal reads unmistakably.
 */
function buildHemisphereDome(
  isNorth: boolean,
  domeMat: THREE.Material,
  innerDomeMat: THREE.Material,
  lipMat: THREE.Material,
  tapeMat: THREE.Material,
  disposables: Array<{ dispose: () => void }>,
): { group: THREE.Group; comOffsetLocal: THREE.Vector3; apexLocal: THREE.Vector3; aoExcluded: THREE.Object3D[] } {
  const group = new THREE.Group();
  const aoExcluded: THREE.Object3D[] = [];

  const sign = isNorth ? 1 : -1;
  const comY = sign * R_SHELL * 0.36;
  const comOffsetLocal = new THREE.Vector3(0, comY, 0);
  const apexLocal = new THREE.Vector3(0, sign, 0);

  const phiStart = isNorth ? 0 : Math.PI * 0.5;
  const phiLength = Math.PI * 0.5;

  const outerGeo = new THREE.SphereGeometry(R_SHELL, 64, 28, 0, Math.PI * 2, phiStart, phiLength);
  outerGeo.translate(0, -comY, 0);
  const outerMesh = new THREE.Mesh(outerGeo, domeMat);
  outerMesh.renderOrder = 10;
  group.add(outerMesh);
  aoExcluded.push(outerMesh);

  const innerGeo = new THREE.SphereGeometry(R_SHELL - 0.016, 48, 20, 0, Math.PI * 2, phiStart, phiLength);
  innerGeo.translate(0, -comY, 0);
  const innerMesh = new THREE.Mesh(innerGeo, innerDomeMat);
  innerMesh.renderOrder = 9;
  group.add(innerMesh);
  aoExcluded.push(innerMesh);

  const lipGeo = new THREE.TorusGeometry(R_SHELL - 0.006, 0.0105, 14, 96);
  lipGeo.rotateX(Math.PI / 2);
  lipGeo.translate(0, -comY, 0);
  const lipMesh = new THREE.Mesh(lipGeo, lipMat);
  lipMesh.renderOrder = 11;
  group.add(lipMesh);
  aoExcluded.push(lipMesh);

  const flangeGeo = new THREE.TorusGeometry(R_SHELL - 0.022, 0.006, 10, 84);
  flangeGeo.rotateX(Math.PI / 2);
  flangeGeo.translate(0, -comY + sign * 0.006, 0);
  const flangeMesh = new THREE.Mesh(flangeGeo, lipMat);
  flangeMesh.renderOrder = 11;
  group.add(flangeMesh);
  aoExcluded.push(flangeMesh);

  const stubGeo = new THREE.PlaneGeometry(0.32, 0.11, 8, 2);
  const posAttr = stubGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const a = x / R_SHELL + (isNorth ? 0.36 : Math.PI + 0.18);
    const curl = Math.max(0, -sign * y) * 0.38;
    const r = R_SHELL + 0.006 + curl;
    posAttr.setXYZ(i, Math.sin(a) * r, y - comY + sign * 0.03, Math.cos(a) * r);
  }
  stubGeo.computeVertexNormals();
  const stubMesh = new THREE.Mesh(stubGeo, tapeMat);
  stubMesh.renderOrder = 12;
  group.add(stubMesh);
  aoExcluded.push(stubMesh);

  disposables.push(outerGeo, innerGeo, lipGeo, flangeGeo, stubGeo);
  return { group, comOffsetLocal, apexLocal, aoExcluded };
}

/**
 * Grand Finale sequence when all 10 levels are completed (or triggered via ?debug -> Test finale):
 *  1. Brief anticipation lift & shudder
 *  2. Gravity drop of the complete sphere onto the studio floor (Y = -1.18)
 *  3. Clean equatorial seal pop: the two intact clear polycarbonate hemispheres separate left & right,
 *     leaving the real intact 3D labyrinth core resting unharmed on the floor
 *  4. The full 6-dot frosted sea-glass marble escapes and rolls away across the endless studio floor
 *     while the camera glides smoothly behind it
 *  5. Lush volumetric hot-pink & neon-green colored smoke plumes billow out of the unsealed sphere
 *     and curl gracefully along the marble's journey into freedom
 */
export class FinaleSequence {
  readonly group = new THREE.Group();
  readonly aoExcluded: THREE.Object3D[] = [];

  phase: FinalePhase = 'idle';

  private built = false;
  private phaseTime = 0;
  private unsealTime = 0;
  private sphereY = 0;
  private sphereVelY = 0;
  private camShake = 0;

  // Real intact labyrinth core rigid-body state
  private readonly corePos = new THREE.Vector3();
  private readonly coreVel = new THREE.Vector3();
  private readonly coreQuat = new THREE.Quaternion();
  private readonly coreAngVel = new THREE.Vector3();
  private coreBounces = 0;

  // Two intact clear polycarbonate hemispheres
  private domes: ShellDomeBody[] = [];

  // Freed sea-glass marble (recursive clone preserving all 6 octahedral calibration dots!)
  private freeBallMesh: THREE.Object3D | null = null;
  private readonly ballPos = new THREE.Vector3();
  private readonly ballVel = new THREE.Vector3();
  private readonly ballDirXZ = new THREE.Vector3(0.5, 0, -0.866).normalize();
  private readonly ballQuat = new THREE.Quaternion();
  private ballBounces = 0;

  // Ground contact shadows: [0] core, [1] north dome, [2] south dome, [3] freed marble
  private shadowInstanced: THREE.InstancedMesh | null = null;

  // Volumetric hot-pink & neon-green smoke system
  private readonly MAX_PUFFS = 220;
  private puffs: SmokePuff[] = [];
  private smokeCenterAttr: THREE.InstancedBufferAttribute | null = null;
  private smokeColorAttr: THREE.InstancedBufferAttribute | null = null;
  private smokeParamsAttr: THREE.InstancedBufferAttribute | null = null;
  private smokeMat: THREE.ShaderMaterial | null = null;
  private smokeGeo: THREE.InstancedBufferGeometry | null = null;
  private smokeSortIndices: number[] = [];
  private smokeSortDists: Float32Array = new Float32Array(220);
  private coreSmokeTimer = 0;
  private trailSmokeTimer = 0;
  private horizonSmokeTimer = 0;
  private nextColorFlip = false;

  // Scratch math
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpDeltaQ = new THREE.Quaternion();
  private readonly tmpWorldApex = new THREE.Vector3();
  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(
    private readonly sourceBallMesh: THREE.Mesh,
    private readonly sourcePlasticMat: THREE.MeshPhysicalMaterial,
  ) {
    this.group.visible = false;
  }

  private ensureBuilt() {
    if (this.built) return;
    this.built = true;

    // 1. Freed frosted 6-dot sea-glass marble — recursive clone(true) preserves ALL 6 dark-slate calibration dots!
    const ballClone = this.sourceBallMesh.clone(true);
    ballClone.visible = true;
    ballClone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.renderOrder = 5;
      }
    });
    this.group.add(ballClone);
    this.freeBallMesh = ballClone;

    // 2. Two intact crystal-clear polycarbonate shell hemispheres
    const innerDomeMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef3f8,
      roughness: 0.1,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      ior: 1.49,
      envMapIntensity: 1.35,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.BackSide,
    });

    const lipMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8e4dc,
      roughness: 0.22,
      metalness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.65,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });

    const tapeMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4f1ea,
      roughness: 0.52,
      metalness: 0.0,
      clearcoat: 0.24,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.disposables.push(innerDomeMat, lipMat, tapeMat);

    for (const isNorth of [true, false]) {
      const builtDome = buildHemisphereDome(isNorth, this.sourcePlasticMat, innerDomeMat, lipMat, tapeMat, this.disposables);
      this.group.add(builtDome.group);
      this.aoExcluded.push(...builtDome.aoExcluded);
      this.domes.push({
        group: builtDome.group,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        angVel: new THREE.Vector3(),
        apexLocal: builtDome.apexLocal,
        comOffsetLocal: builtDome.comOffsetLocal,
        bounces: 0,
        settled: false,
      });
    }

    // 3. Soft studio floor contact shadows (core + north dome + south dome + freed marble)
    const shadowTex = createRadialShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.88,
    });
    const shadowInstanced = new THREE.InstancedMesh(shadowGeo, shadowMat, 4);
    shadowInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadowInstanced.renderOrder = -1;
    shadowInstanced.frustumCulled = false;
    this.group.add(shadowInstanced);
    this.aoExcluded.push(shadowInstanced);
    this.shadowInstanced = shadowInstanced;
    this.disposables.push(shadowTex, shadowGeo, shadowMat);

    // 4. Volumetric Hot-Pink & Neon-Green Smoke System (single draw call)
    const smoke = createVolumetricSmokeSystem(this.MAX_PUFFS);
    this.group.add(smoke.mesh);
    this.aoExcluded.push(smoke.mesh);
    this.smokeCenterAttr = smoke.centerAttr;
    this.smokeColorAttr = smoke.colorAttr;
    this.smokeParamsAttr = smoke.paramsAttr;
    this.smokeMat = smoke.material;
    this.smokeGeo = smoke.geometry;
    this.disposables.push(smoke.geometry, smoke.material);

    for (let i = 0; i < this.MAX_PUFFS; i++) {
      this.puffs.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        color: new THREE.Color(),
        age: 0,
        maxAge: 3,
        startRadius: 0.2,
        endRadius: 1.0,
        maxAlpha: 0.5,
        rotation: 0,
        rotSpeed: 0,
        seed: i * 0.37,
        buoyancy: 0.45,
        drag: 1.2,
        turbulence: 0.25,
      });
    }
  }

  /** Start the finale from the sphere's current world orientation */
  start(sphereQuat: THREE.Quaternion, _ballLocalDir: THREE.Vector3, cb?: FinaleCallbacks) {
    this.ensureBuilt();
    this.phase = 'lift';
    this.phaseTime = 0;
    this.unsealTime = 0;
    this.sphereY = 0;
    this.sphereVelY = 0;
    this.camShake = 0;
    this.corePos.set(0, 0, 0);
    this.coreQuat.copy(sphereQuat);
    this.coreSmokeTimer = 0;
    this.trailSmokeTimer = 0;
    this.horizonSmokeTimer = 0.35;

    for (const p of this.puffs) p.active = false;
    if (this.smokeGeo) this.smokeGeo.instanceCount = 0;
    this.group.visible = false;
    cb?.onLiftStart?.();
  }

  stop() {
    this.phase = 'idle';
    this.phaseTime = 0;
    this.unsealTime = 0;
    this.sphereY = 0;
    this.sphereVelY = 0;
    this.camShake = 0;
    for (const p of this.puffs) p.active = false;
    if (this.smokeGeo) this.smokeGeo.instanceCount = 0;
    this.group.visible = false;
  }

  private spawnSmokePuff(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    kind: 'pink' | 'magenta',
    startRadius: number,
    endRadius: number,
    maxAge: number,
    maxAlpha: number,
    buoyancy = 0.48,
    drag = 1.25,
    turbulence = 0.24,
  ) {
    let slot: SmokePuff | null = null;
    let oldestSlot: SmokePuff | null = null;
    let oldestRatio = -1;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if (!p.active) {
        slot = p;
        break;
      }
      const r = p.age / p.maxAge;
      if (r > oldestRatio) {
        oldestRatio = r;
        oldestSlot = p;
      }
    }
    const target = slot || oldestSlot;
    if (!target) return;

    target.active = true;
    target.pos.set(x, y, z);
    target.vel.set(vx, vy, vz);
    target.color.setHex(pickSmokeColor(kind));
    target.age = 0;
    target.maxAge = maxAge;
    target.startRadius = startRadius;
    target.endRadius = endRadius;
    target.maxAlpha = maxAlpha;
    target.rotation = Math.random() * Math.PI * 2;
    target.rotSpeed = (Math.random() - 0.5) * 0.45;
    target.seed = Math.random() * 100;
    target.buoyancy = buoyancy;
    target.drag = drag;
    target.turbulence = turbulence;
  }

  /** Release a billowing colored volumetric smoke flare cloud at (cx, cy, cz) */
  private spawnSmokeFlareBurst(cx: number, cy: number, cz: number, kind: 'pink' | 'magenta', count = 10, scale = 1.0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.95) * scale;
      this.spawnSmokePuff(
        cx + (Math.random() - 0.5) * 0.35 * scale,
        Math.max(STUDIO_FLOOR_Y + 0.14, cy + (Math.random() - 0.5) * 0.25 * scale),
        cz + (Math.random() - 0.5) * 0.35 * scale,
        Math.cos(a) * spd,
        (0.45 + Math.random() * 0.85) * scale,
        Math.sin(a) * spd,
        kind,
        (0.24 + Math.random() * 0.16) * scale,
        (0.95 + Math.random() * 0.65) * scale,
        2.8 + Math.random() * 1.8,
        0.58 + Math.random() * 0.18,
        0.42 + Math.random() * 0.25,
        1.15,
        0.32,
      );
    }
  }

  /** Playful post-finale interaction: billow twin pink + magenta smoke clouds ahead of the marble and give it a joyful hop */
  celebrateTap(worldXHint = 0, cb?: FinaleCallbacks) {
    if (this.phase !== 'unsealed') return;
    const rightX = -this.ballDirXZ.z;
    const rightZ = this.ballDirXZ.x;
    const ahead = 2.6 + Math.random() * 0.85;
    const lateral = THREE.MathUtils.clamp(worldXHint * 1.4, -1.6, 1.6);
    const fx = this.ballPos.x + this.ballDirXZ.x * ahead + rightX * lateral;
    const fz = this.ballPos.z + this.ballDirXZ.z * ahead + rightZ * lateral;
    this.spawnSmokeFlareBurst(fx - rightX * 0.35, STUDIO_FLOOR_Y + 0.36, fz - rightZ * 0.35, 'pink', 9, 1.05);
    this.spawnSmokeFlareBurst(fx + rightX * 0.35, STUDIO_FLOOR_Y + 0.36, fz + rightZ * 0.35, 'magenta', 9, 1.05);
    cb?.onSmokeBurst?.(THREE.MathUtils.clamp(worldXHint, -0.8, 0.8));

    // Give the freed 6-dot marble a playful forward boost & hop!
    this.ballVel.x += this.ballDirXZ.x * 0.42;
    this.ballVel.z += this.ballDirXZ.z * 0.42;
    if (this.ballPos.y <= STUDIO_FLOOR_Y + R_BALL + 0.015) {
      this.ballVel.y = 0.68;
    }
  }

  private triggerSealPop(sphereQuat: THREE.Quaternion, cb?: FinaleCallbacks) {
    this.phase = 'unsealed';
    this.phaseTime = 0;
    this.unsealTime = 0;
    this.camShake = 0.68;
    this.group.visible = true;

    const impactCenter = new THREE.Vector3(0, this.sphereY, 0);

    // 1. Intact 3D Labyrinth Core bounces softly and rolls gently left-back on the studio floor
    this.corePos.copy(impactCenter);
    this.coreQuat.copy(sphereQuat);
    this.coreVel.set(-0.55, 1.16, -0.35);
    this.coreAngVel.set(-0.55, 0.35, 0.45);
    this.coreBounces = 0;

    // 2. Pop the two intact clear polycarbonate hemispheres apart left & right
    const worldNorthPole = new THREE.Vector3(0, 1, 0).applyQuaternion(sphereQuat);
    const northGoesRight = worldNorthPole.x >= 0 ? 1 : -1;

    for (let i = 0; i < 2; i++) {
      const d = this.domes[i];
      const side = i === 0 ? northGoesRight : -northGoesRight;
      d.pos.copy(d.comOffsetLocal).applyQuaternion(sphereQuat).add(impactCenter);
      d.pos.y = Math.max(STUDIO_FLOOR_Y + 0.32, d.pos.y);
      d.quat.copy(sphereQuat);
      d.vel.set(side * (side > 0 ? 1.85 : 1.38), i === 0 ? 1.58 : 1.35, side > 0 ? -0.45 : 0.16);
      d.angVel.set(side * -0.95, side * 1.15, -side * 1.9);
      d.bounces = 0;
      d.settled = false;
      d.group.position.copy(d.pos);
      d.group.quaternion.copy(d.quat);
    }

    // 3. The 6-dot frosted sea-glass marble hops out front-right and rolls AWAY into freedom!
    this.ballDirXZ.set(0.5, 0, -0.866).normalize();
    this.ballPos.set(0.36, STUDIO_FLOOR_Y + R_BALL + 0.42, 0.56);
    this.ballVel.set(this.ballDirXZ.x * 1.24, 1.48, this.ballDirXZ.z * 1.24);
    this.ballQuat.identity();
    this.ballBounces = 0;
    if (this.freeBallMesh) {
      this.freeBallMesh.position.copy(this.ballPos);
      this.freeBallMesh.quaternion.copy(this.ballQuat);
    }

    // 4. Pressurized pink (left) & deep magenta (right) volumetric smoke bursting straight out of the unsealed equator!
    this.spawnSmokeFlareBurst(-0.62, impactCenter.y + 0.12, -0.25, 'pink', 18, 1.15);
    this.spawnSmokeFlareBurst(0.68, impactCenter.y + 0.12, -0.35, 'magenta', 18, 1.15);

    cb?.onSealPop?.();
  }

  private computeDomeFloorClearance(d: ShellDomeBody): number {
    this.tmpWorldApex.copy(d.apexLocal).applyQuaternion(d.quat).normalize();
    const ay = this.tmpWorldApex.y;
    const comOffset = R_SHELL * 0.36;
    const sphereCenterRelY = -comOffset * ay;
    const rimDrop = R_SHELL * Math.sqrt(Math.max(0, 1 - ay * ay));
    const downExtent = ay < 0 ? R_SHELL : rimDrop;
    return Math.max(0.18, downExtent - sphereCenterRelY);
  }

  step(dt: number, sphereQuat: THREE.Quaternion, cameraPos: THREE.Vector3, cb?: FinaleCallbacks): FinaleFrameResult {
    const clampedDt = Math.min(dt, 0.04);

    if (this.phase === 'idle') {
      return {
        phase: 'idle',
        corePos: this.corePos.set(0, 0, 0),
        coreQuat: sphereQuat,
        ballPos: this.ballPos.set(0, 0, 0),
        ballDirXZ: this.ballDirXZ,
        ballSpeed: 0,
        followBlend: 0,
        outerShellVisible: true,
        intactBallVisible: true,
        useFinaleCorePose: false,
        shadowScale: 1,
        shadowOpacity: 1,
        camShakeX: 0,
        camShakeY: 0,
        readyForReplay: false,
      };
    }

    this.phaseTime += clampedDt;

    // --- PHASE 1: Anticipation lift + subtle shudder ---
    if (this.phase === 'lift') {
      const dur = 0.48;
      const u = Math.min(1, this.phaseTime / dur);
      const easeOut = 1 - Math.pow(1 - u, 3);
      this.sphereY = easeOut * 0.34;
      const shudder = Math.sin(u * Math.PI) * 0.015;
      const sx = Math.sin(this.phaseTime * 54) * shudder;
      const sz = Math.cos(this.phaseTime * 61) * shudder;
      this.corePos.set(sx, this.sphereY, sz);
      this.coreQuat.copy(sphereQuat);

      if (u >= 1) {
        this.phase = 'fall';
        this.phaseTime = 0;
        this.sphereVelY = -0.35;
      }

      return {
        phase: 'lift',
        corePos: this.corePos,
        coreQuat: this.coreQuat,
        ballPos: this.corePos,
        ballDirXZ: this.ballDirXZ,
        ballSpeed: 0,
        followBlend: 0,
        outerShellVisible: true,
        intactBallVisible: true,
        useFinaleCorePose: true,
        shadowScale: 1.0 + this.sphereY * 0.35,
        shadowOpacity: Math.max(0.45, 1.0 - this.sphereY * 0.55),
        camShakeX: 0,
        camShakeY: 0,
        readyForReplay: false,
      };
    }

    // --- PHASE 2: Gravity drop straight onto the studio floor ---
    if (this.phase === 'fall') {
      const impactY = STUDIO_FLOOR_Y + R_SHELL;
      this.sphereVelY -= 12.6 * clampedDt;
      this.sphereY += this.sphereVelY * clampedDt;
      this.corePos.set(0, this.sphereY, 0);
      this.coreQuat.copy(sphereQuat);

      if (this.sphereY <= impactY) {
        this.sphereY = impactY;
        this.triggerSealPop(sphereQuat, cb);
      } else {
        const distToFloor = Math.max(0, this.sphereY - impactY);
        return {
          phase: 'fall',
          corePos: this.corePos,
          coreQuat: this.coreQuat,
          ballPos: this.corePos,
          ballDirXZ: this.ballDirXZ,
          ballSpeed: 0,
          followBlend: 0,
          outerShellVisible: true,
          intactBallVisible: true,
          useFinaleCorePose: true,
          shadowScale: 0.74 + distToFloor * 0.5,
          shadowOpacity: Math.min(1.0, 0.72 + (1 - Math.min(1, distToFloor)) * 0.35),
          camShakeX: 0,
          camShakeY: 0,
          readyForReplay: false,
        };
      }
    }

    // --- PHASE 3: Unsealed intact labyrinth + 2 clear domes + rolling 6-dot marble + volumetric pink/neon-green smoke ---
    this.unsealTime += clampedDt;
    this.camShake = Math.max(0, this.camShake - clampedDt * 3.0);
    const shakeAmp = this.camShake * this.camShake * 0.036;
    const camShakeX = (Math.sin(this.unsealTime * 68) * 0.7 + Math.cos(this.unsealTime * 43) * 0.3) * shakeAmp;
    const camShakeY = (Math.cos(this.unsealTime * 74) * 0.7 + Math.sin(this.unsealTime * 51) * 0.3) * shakeAmp;

    // 3a. Step intact 3D labyrinth core
    const coreFloorY = STUDIO_FLOOR_Y + R_WALL;
    this.coreVel.y -= 9.8 * clampedDt;
    this.corePos.addScaledVector(this.coreVel, clampedDt);

    if (this.corePos.y < coreFloorY) {
      this.corePos.y = coreFloorY;
      if (this.coreVel.y < -0.18) {
        const strength = Math.min(1, -this.coreVel.y / 3.8);
        if (this.coreBounces < 3) cb?.onShellBounce?.(strength);
        this.coreBounces++;
        this.coreVel.y = -this.coreVel.y * 0.38;
      } else {
        this.coreVel.y = 0;
      }
      const coreDamp = Math.exp(-1.7 * clampedDt);
      this.coreVel.x *= coreDamp;
      this.coreVel.z *= coreDamp;
    }

    const coreHoriz = Math.hypot(this.coreVel.x, this.coreVel.z);
    if (this.corePos.y <= coreFloorY + 0.02 && coreHoriz > 1e-4) {
      this.tmpAxis.set(this.coreVel.z / coreHoriz, 0, -this.coreVel.x / coreHoriz);
      this.tmpDeltaQ.setFromAxisAngle(this.tmpAxis, (coreHoriz * clampedDt) / R_WALL);
      this.coreQuat.premultiply(this.tmpDeltaQ).normalize();
      this.coreAngVel.multiplyScalar(Math.exp(-4.0 * clampedDt));
    } else {
      const wMag = this.coreAngVel.length();
      if (wMag > 1e-4) {
        this.tmpAxis.copy(this.coreAngVel).multiplyScalar(1 / wMag);
        this.tmpDeltaQ.setFromAxisAngle(this.tmpAxis, wMag * clampedDt);
        this.coreQuat.premultiply(this.tmpDeltaQ).normalize();
      }
    }

    // 3b. Step the two clear polycarbonate domes
    for (let i = 0; i < this.domes.length; i++) {
      const d = this.domes[i];
      if (!d.settled) {
        d.vel.y -= 9.8 * clampedDt;
        d.pos.addScaledVector(d.vel, clampedDt);

        const wMag = d.angVel.length();
        if (wMag > 1e-4) {
          this.tmpAxis.copy(d.angVel).multiplyScalar(1 / wMag);
          this.tmpDeltaQ.setFromAxisAngle(this.tmpAxis, wMag * clampedDt);
          d.quat.premultiply(this.tmpDeltaQ).normalize();
        }

        const clearance = this.computeDomeFloorClearance(d);
        const floorLimit = STUDIO_FLOOR_Y + clearance;

        if (d.pos.y < floorLimit) {
          d.pos.y = floorLimit;
          if (d.vel.y < -0.22) {
            const strength = Math.min(1, -d.vel.y / 4.2);
            if (d.bounces < 3) cb?.onShellBounce?.(strength * 0.72);
            d.bounces++;
            d.vel.y = -d.vel.y * 0.34;
            d.angVel.multiplyScalar(0.75);
          } else {
            d.vel.y = 0;
          }

          this.tmpWorldApex.copy(d.apexLocal).applyQuaternion(d.quat).normalize();
          const targetSign = this.tmpWorldApex.y >= 0 ? 1 : -1;
          this.tmpDir.set(0, targetSign, 0);
          this.tmpAxis.crossVectors(this.tmpWorldApex, this.tmpDir);
          d.angVel.addScaledVector(this.tmpAxis, 4.2 * clampedDt);

          const linDamp = Math.exp(-2.65 * clampedDt);
          const angDamp = Math.exp(-2.8 * clampedDt);
          d.vel.x *= linDamp;
          d.vel.z *= linDamp;
          d.angVel.multiplyScalar(angDamp);

          if (d.vel.lengthSq() < 0.0006 && d.angVel.lengthSq() < 0.004 && Math.abs(this.tmpWorldApex.y) > 0.94) {
            d.vel.set(0, 0, 0);
            d.angVel.set(0, 0, 0);
            d.settled = true;
          }
        }

        const dx = d.pos.x - this.corePos.x;
        const dz = d.pos.z - this.corePos.z;
        const dist = Math.hypot(dx, dz);
        const minSep = R_WALL + R_SHELL * 0.88;
        if (dist > 1e-4 && dist < minSep && this.unsealTime > 0.24) {
          const push = (minSep - dist) * 0.35;
          d.pos.x += (dx / dist) * push;
          d.pos.z += (dz / dist) * push;
        }

        d.group.position.copy(d.pos);
        d.group.quaternion.copy(d.quat);
      }
    }

    // 3c. Step the freed 6-dot frosted sea-glass marble rolling away across the endless studio floor!
    const ballFloorY = STUDIO_FLOOR_Y + R_BALL;
    this.ballVel.y -= 9.6 * clampedDt;
    this.ballPos.addScaledVector(this.ballVel, clampedDt);

    if (this.ballPos.y < ballFloorY) {
      this.ballPos.y = ballFloorY;
      if (this.ballVel.y < -0.16) {
        const strength = Math.min(1, -this.ballVel.y / 3.8);
        if (this.ballBounces < 5) cb?.onMarbleBounce?.(strength);
        this.ballBounces++;
        this.ballVel.y = -this.ballVel.y * 0.5;
      } else {
        this.ballVel.y = 0;
      }

      // Steady joyful rolling cruise away into the open horizon (+X, -Z with a subtle organic curve!)
      const cruiseHeading = -1.04 + Math.sin(this.unsealTime * 0.36) * 0.14;
      const targetDirX = Math.cos(cruiseHeading);
      const targetDirZ = Math.sin(cruiseHeading);
      const cruiseSpeed = 1.05;
      const steer = 1 - Math.exp(-1.55 * clampedDt);
      this.ballVel.x += (targetDirX * cruiseSpeed - this.ballVel.x) * steer;
      this.ballVel.z += (targetDirZ * cruiseSpeed - this.ballVel.z) * steer;
    }

    const horizSpeed = Math.hypot(this.ballVel.x, this.ballVel.z);
    if (horizSpeed > 1e-4) {
      this.ballDirXZ.set(this.ballVel.x / horizSpeed, 0, this.ballVel.z / horizSpeed);
      this.tmpAxis.set(this.ballVel.z / horizSpeed, 0, -this.ballVel.x / horizSpeed);
      this.tmpDeltaQ.setFromAxisAngle(this.tmpAxis, (horizSpeed * clampedDt) / R_BALL);
      this.ballQuat.premultiply(this.tmpDeltaQ).normalize();
    }

    if (this.freeBallMesh) {
      this.freeBallMesh.position.copy(this.ballPos);
      this.freeBallMesh.quaternion.copy(this.ballQuat);
    }

    // 3d. Update soft floor contact shadows (core + 2 domes + freed marble)
    if (this.shadowInstanced) {
      const coreH = Math.max(0, this.corePos.y - coreFloorY);
      const coreS = 2.65 * (1 + coreH * 0.25) * Math.max(0.45, 1 - coreH * 0.2);
      this.tmpPos.set(this.corePos.x + 0.14 + coreH * 0.12, STUDIO_FLOOR_Y + 0.002, this.corePos.z - 0.05);
      this.tmpQuat.identity();
      this.tmpScale.set(coreS, 1, coreS);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.shadowInstanced.setMatrixAt(0, this.tmpMat);

      for (let i = 0; i < 2; i++) {
        const d = this.domes[i];
        const h = Math.max(0, d.pos.y - (STUDIO_FLOOR_Y + 0.36));
        const s = 1.68 * (1 + h * 0.3) * Math.max(0.35, 1 - h * 0.25);
        this.tmpPos.set(d.pos.x + 0.1 + h * 0.12, STUDIO_FLOOR_Y + 0.0025 + i * 0.0005, d.pos.z - 0.04);
        this.tmpScale.set(s, 1, s);
        this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.shadowInstanced.setMatrixAt(1 + i, this.tmpMat);
      }

      const ballH = Math.max(0, this.ballPos.y - ballFloorY);
      const ballS = R_BALL * 4.6 * (1 + ballH * 0.45) * Math.max(0.32, 1 - ballH * 0.25);
      this.tmpPos.set(this.ballPos.x + 0.02 + ballH * 0.1, STUDIO_FLOOR_Y + 0.004, this.ballPos.z - 0.02);
      this.tmpScale.set(ballS, 1, ballS);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.shadowInstanced.setMatrixAt(3, this.tmpMat);

      this.shadowInstanced.instanceMatrix.needsUpdate = true;
    }

    // 3e. Emit lush volumetric hot-pink & neon-green smoke plumes!
    // (i) Twin rising plumes behind the unsealed labyrinth core during the first 4.5s
    if (this.unsealTime < 4.5) {
      this.coreSmokeTimer -= clampedDt;
      if (this.coreSmokeTimer <= 0) {
        this.coreSmokeTimer = 0.085;
        this.spawnSmokePuff(
          this.corePos.x - 0.48 + (Math.random() - 0.5) * 0.45,
          STUDIO_FLOOR_Y + 0.38 + Math.random() * 0.3,
          this.corePos.z - 0.45 + (Math.random() - 0.5) * 0.35,
          -0.28 + (Math.random() - 0.5) * 0.38,
          0.62 + Math.random() * 0.45,
          -0.18 + (Math.random() - 0.5) * 0.35,
          'pink',
          0.26,
          1.25 + Math.random() * 0.45,
          3.2 + Math.random() * 1.4,
          0.56,
          0.44,
          1.0,
          0.3,
        );
        this.spawnSmokePuff(
          this.corePos.x + 0.65 + (Math.random() - 0.5) * 0.45,
          STUDIO_FLOOR_Y + 0.36 + Math.random() * 0.3,
          this.corePos.z - 0.55 + (Math.random() - 0.5) * 0.35,
          0.34 + (Math.random() - 0.5) * 0.38,
          0.58 + Math.random() * 0.45,
          -0.22 + (Math.random() - 0.5) * 0.35,
          'magenta',
          0.26,
          1.25 + Math.random() * 0.45,
          3.2 + Math.random() * 1.4,
          0.54,
          0.44,
          1.0,
          0.3,
        );
      }
    }

    // (ii) Delicate curling wisps drifting up beside the rolling marble's wake (keeping the marble itself crystal-clear!)
    this.trailSmokeTimer -= clampedDt;
    if (this.trailSmokeTimer <= 0 && this.unsealTime > 0.35) {
      this.trailSmokeTimer = 0.16;
      const rightX = -this.ballDirXZ.z;
      const rightZ = this.ballDirXZ.x;
      this.nextColorFlip = !this.nextColorFlip;
      const sideSign = this.nextColorFlip ? 1 : -1;
      this.spawnSmokePuff(
        this.ballPos.x - this.ballDirXZ.x * 0.14 + rightX * sideSign * 0.14,
        STUDIO_FLOOR_Y + 0.05,
        this.ballPos.z - this.ballDirXZ.z * 0.14 + rightZ * sideSign * 0.14,
        rightX * sideSign * (0.24 + Math.random() * 0.16),
        0.22 + Math.random() * 0.16,
        rightZ * sideSign * (0.24 + Math.random() * 0.16),
        this.nextColorFlip ? 'pink' : 'magenta',
        0.06,
        0.3 + Math.random() * 0.14,
        1.85 + Math.random() * 0.85,
        0.32,
        0.24,
        1.35,
        0.2,
      );
    }

    // (iii) Hero sculpted pink & magenta smoke flare clouds billowing along the horizon ahead of the rolling marble!
    this.horizonSmokeTimer -= clampedDt;
    if (this.horizonSmokeTimer <= 0) {
      this.horizonSmokeTimer = 0.85 + Math.random() * 0.42;
      const rightX = -this.ballDirXZ.z;
      const rightZ = this.ballDirXZ.x;
      const ahead = 2.9 + Math.random() * 1.25;
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.05);
      const kind: 'pink' | 'magenta' = side < 0 ? 'pink' : 'magenta';
      const hx = this.ballPos.x + this.ballDirXZ.x * ahead + rightX * side;
      const hz = this.ballPos.z + this.ballDirXZ.z * ahead + rightZ * side;
      this.spawnSmokeFlareBurst(hx, STUDIO_FLOOR_Y + 0.22, hz, kind, 9, 1.12);
      cb?.onSmokeBurst?.(THREE.MathUtils.clamp(side * 0.45, -0.8, 0.8));
    }

    // 3f. Step all active smoke puffs, sort back-to-front relative to camera, and upload instance buffers
    if (this.smokeMat && this.smokeGeo && this.smokeCenterAttr && this.smokeColorAttr && this.smokeParamsAttr) {
      this.smokeMat.uniforms.uTime.value = this.unsealTime;
      this.smokeSortIndices.length = 0;

      for (let i = 0; i < this.puffs.length; i++) {
        const p = this.puffs[i];
        if (!p.active) continue;
        p.age += clampedDt;
        if (p.age >= p.maxAge) {
          p.active = false;
          continue;
        }
        const damp = Math.exp(-p.drag * clampedDt);
        p.vel.x *= damp;
        p.vel.z *= damp;
        p.vel.y = p.vel.y * Math.exp(-p.drag * 0.65 * clampedDt) + p.buoyancy * clampedDt;

        // Gentle organic swirling curl
        const swirl = p.turbulence * clampedDt;
        p.vel.x += Math.sin(this.unsealTime * 1.3 + p.seed) * swirl;
        p.vel.z += Math.cos(this.unsealTime * 1.1 + p.seed * 1.3) * swirl;

        p.pos.addScaledVector(p.vel, clampedDt);
        if (p.pos.y < STUDIO_FLOOR_Y + 0.08) {
          p.pos.y = STUDIO_FLOOR_Y + 0.08;
          p.vel.y = Math.max(0.08, Math.abs(p.vel.y) * 0.3);
        }
        p.rotation += p.rotSpeed * clampedDt;

        const dx = p.pos.x - cameraPos.x;
        const dy = p.pos.y - cameraPos.y;
        const dz = p.pos.z - cameraPos.z;
        this.smokeSortDists[i] = dx * dx + dy * dy + dz * dz;
        this.smokeSortIndices.push(i);
      }

      // Back-to-front depth sort for silky artifact-free translucent smoke layering
      this.smokeSortIndices.sort((a, b) => this.smokeSortDists[b] - this.smokeSortDists[a]);

      const cArr = this.smokeCenterAttr.array as Float32Array;
      const colArr = this.smokeColorAttr.array as Float32Array;
      const pArr = this.smokeParamsAttr.array as Float32Array;

      const count = this.smokeSortIndices.length;
      for (let k = 0; k < count; k++) {
        const p = this.puffs[this.smokeSortIndices[k]];
        const u = p.age / p.maxAge;
        // Fast billowy bloom-in, long silky dissipation
        const grow = 1 - Math.pow(1 - u, 2.2);
        const radius = p.startRadius + (p.endRadius - p.startRadius) * grow;
        const fadeIn = Math.min(1, u / 0.14);
        const fadeOut = Math.pow(Math.max(0, 1 - Math.max(0, u - 0.22) / 0.78), 1.55);
        const alpha = p.maxAlpha * fadeIn * fadeOut;

        const i3 = k * 3;
        const i4 = k * 4;
        cArr[i3] = p.pos.x;
        cArr[i3 + 1] = p.pos.y;
        cArr[i3 + 2] = p.pos.z;
        colArr[i3] = p.color.r;
        colArr[i3 + 1] = p.color.g;
        colArr[i3 + 2] = p.color.b;
        pArr[i4] = radius;
        pArr[i4 + 1] = alpha;
        pArr[i4 + 2] = p.rotation;
        pArr[i4 + 3] = p.seed;
      }

      this.smokeGeo.instanceCount = count;
      this.smokeCenterAttr.needsUpdate = true;
      this.smokeColorAttr.needsUpdate = true;
      this.smokeParamsAttr.needsUpdate = true;
    }

    // Smoothly transition from wide seal-pop establishing shot (0) into low tracking follow behind the rolling 6-dot marble (1)
    const rawFollow = THREE.MathUtils.clamp((this.unsealTime - 0.72) / 2.2, 0, 1);
    const followBlend = rawFollow * rawFollow * (3 - 2 * rawFollow);

    return {
      phase: 'unsealed',
      corePos: this.corePos,
      coreQuat: this.coreQuat,
      ballPos: this.ballPos,
      ballDirXZ: this.ballDirXZ,
      ballSpeed: this.ballPos.y <= ballFloorY + 0.02 ? horizSpeed : 0,
      followBlend,
      outerShellVisible: false,
      intactBallVisible: false,
      useFinaleCorePose: true,
      shadowScale: 0,
      shadowOpacity: 0,
      camShakeX,
      camShakeY,
      readyForReplay: this.unsealTime >= 1.9,
    };
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
