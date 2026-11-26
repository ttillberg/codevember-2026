import * as THREE from 'three';

export interface AimReticleRig {
  group: THREE.Group;
  setPose: (dir: THREE.Vector3, upHint: THREE.Vector3, active: number) => void;
  dispose: () => void;
}

/**
 * Builds a minimalist 3D curved optical aiming reticle hugging the outer polycarbonate sphere shell.
 * Four curved great-circle crosshair arms + a delicate curved center ring frame the gravity pull center
 * directly on the curved 3D sphere surface.
 */
export function createAimReticle(radius: number): AimReticleRig {
  const group = new THREE.Group();
  const positions: number[] = [];
  const indices: number[] = [];
  let vOffset = 0;

  const pushStrip = (pts: THREE.Vector3[], halfWidth: number, closed = false) => {
    const n = pts.length;
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const side = new THREE.Vector3();
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      if (!closed && i === 0) {
        tangent.subVectors(next, curr).normalize();
      } else if (!closed && i === n - 1) {
        tangent.subVectors(curr, prev).normalize();
      } else {
        tangent.subVectors(next, prev).normalize();
      }
      normal.copy(curr).normalize();
      side.crossVectors(normal, tangent).normalize();

      pA.copy(curr).addScaledVector(side, -halfWidth).normalize().multiplyScalar(radius);
      pB.copy(curr).addScaledVector(side, halfWidth).normalize().multiplyScalar(radius);
      positions.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
    }

    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const iNext = (i + 1) % n;
      const a = vOffset + i * 2;
      const b = a + 1;
      const c = vOffset + iNext * 2;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    vOffset += n * 2;
  };

  // 1. Small hairline curved spherical center ring
  const ringSegs = 64;
  const ringTheta = 0.036;
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i < ringSegs; i++) {
    const a = (i / ringSegs) * Math.PI * 2;
    ringPts.push(
      new THREE.Vector3(
        Math.sin(ringTheta) * Math.cos(a) * radius,
        Math.sin(ringTheta) * Math.sin(a) * radius,
        Math.cos(ringTheta) * radius,
      ),
    );
  }
  pushStrip(ringPts, 0.0011, true);

  // 2. Four razor-thin curved great-circle crosshair arms (+X, -X, +Y, -Y) hugging the sphere curvature
  const armSegs = 12;
  const armStart = 0.056;
  const armEnd = 0.205;
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const armPts: THREE.Vector3[] = [];
    for (let i = 0; i <= armSegs; i++) {
      const th = armStart + (armEnd - armStart) * (i / armSegs);
      armPts.push(new THREE.Vector3(dx * Math.sin(th) * radius, dy * Math.sin(th) * radius, Math.cos(th) * radius));
    }
    pushStrip(armPts, 0.0011, false);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x1c1c1c,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 16;
  group.add(mesh);

  const basisX = new THREE.Vector3();
  const basisY = new THREE.Vector3();
  const basisZ = new THREE.Vector3();
  const rotMat = new THREE.Matrix4();

  function setPose(dir: THREE.Vector3, upHint: THREE.Vector3, active: number) {
    basisZ.copy(dir).normalize();
    basisX.crossVectors(upHint, basisZ);
    if (basisX.lengthSq() < 1e-6) {
      basisX.set(1, 0, 0);
    } else {
      basisX.normalize();
    }
    basisY.crossVectors(basisZ, basisX).normalize();
    rotMat.makeBasis(basisX, basisY, basisZ);
    group.quaternion.setFromRotationMatrix(rotMat);
    mat.opacity = 0.42 + active * 0.43;
  }

  return {
    group,
    setPose,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface StudioRig {
  envMap: THREE.Texture;
  shadowPlane: THREE.Mesh;
  backdropMesh: THREE.Mesh;
  dispose: () => void;
}

/**
 * Generates a clean Scandinavian photographic studio softbox environment map via PMREMGenerator.
 * Includes large diffused overhead/key softboxes, cool fill, crisp rim strip, and dark negative-fill
 * bounce cards so the bearing-steel ball and thin clear plastic shell exhibit crisp, authentic studio reflections.
 */
function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xe6e3dc);

  const addPanel = (
    color: number,
    intensity: number,
    w: number,
    h: number,
    pos: [number, number, number],
    lookAt: [number, number, number] = [0, 0, 0],
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.lookAt(...lookAt);
    envScene.add(mesh);
  };

  // Overhead horizontal studio softbox
  addPanel(0xfffdf8, 3.2, 8.2, 4.4, [-1.2, 5.4, 2.2]);
  // Main key softbox (upper-left-front — creates clean curved rectangular highlight on clear plastic shell)
  addPanel(0xfffaf0, 3.9, 5.4, 5.2, [-4.8, 3.2, 4.0]);
  // Cool daylight fill panel (right-front)
  addPanel(0xf0f4fb, 1.9, 5.8, 4.6, [5.8, 1.2, 3.2]);
  // Crisp narrow back-right rim softbox (gives razor-clean reflection on clear plastic rim)
  addPanel(0xffffff, 3.8, 2.0, 6.8, [4.2, 2.6, -4.8]);
  // Subtle warm studio floor bounce
  addPanel(0xe5dfd4, 1.05, 14, 14, [0, -5.5, 0]);

  // Studio negative-fill dark flags (essential for high-contrast chrome & clear polycarbonate realism!)
  addPanel(0x2a2927, 1.0, 4.2, 5.4, [-6.5, -1.6, -2.5]);
  addPanel(0x343330, 1.0, 3.6, 4.2, [5.8, -2.2, -1.6]);
  addPanel(0x464440, 1.0, 5.5, 2.4, [0, -2.8, 6.4]);

  const rt = pmrem.fromScene(envScene, 0.032);
  pmrem.dispose();
  envScene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });

  return rt.texture;
}

/**
 * Soft studio contact shadow texture rendered beneath the sphere on the seamless cyclorama floor.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(32, 29, 24, 0.48)');
  grad.addColorStop(0.28, 'rgba(36, 33, 28, 0.28)');
  grad.addColorStop(0.6, 'rgba(44, 41, 36, 0.09)');
  grad.addColorStop(1.0, 'rgba(48, 45, 40, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function setupStudio(renderer: THREE.WebGLRenderer, scene: THREE.Scene): StudioRig {
  const envMap = createStudioEnvironment(renderer);
  scene.environment = envMap;
  // Moderate environment bounce on matte walls so directional softbox shadows & SSAO sculpt the tracks clearly,
  // while chrome steel & clear plastic boost envMapIntensity per-material.
  scene.environmentIntensity = 0.56;

  // Sculptural Scandinavian studio cyclorama gradient dome (cool mist zenith -> warm backlit horizon -> grounded stone floor)
  const backdropGeo = new THREE.SphereGeometry(28, 32, 24);
  const backdropMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0xd2dae3) },    // airy cool Nordic mist slate
      uMid: { value: new THREE.Color(0xf1ece2) },    // luminous warm studio alabaster sweep
      uBottom: { value: new THREE.Color(0xcbc1b2) }, // grounded warm architectural limestone
      uGlow: { value: new THREE.Color(0xfaf7f0) },   // soft diffused cyclorama backlight
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      varying vec2 vScreenUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        vec4 clip = projectionMatrix * viewMatrix * wp;
        vScreenUv = clip.xy / max(clip.w, 0.0001) * 0.5 + 0.5;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBottom;
      uniform vec3 uGlow;
      varying vec3 vWorldDir;
      varying vec2 vScreenUv;
      void main() {
        // Blend screen vertical sweep with subtle 3D world elevation so the gradient reads richly at 32deg FOV
        float sy = clamp(vScreenUv.y, 0.0, 1.0);
        float wy = clamp(vWorldDir.y * 1.4 + 0.5, 0.0, 1.0);
        float t = mix(sy, wy, 0.25);

        // Smooth 3-stop studio sweep: warm limestone floor -> luminous alabaster mid -> cool Nordic mist top
        vec3 col = mix(uBottom, uMid, smoothstep(0.0, 0.48, t));
        col = mix(col, uTop, smoothstep(0.46, 1.0, t));

        // Soft off-center studio softbox backlight halo behind the sphere (upper-left bias matching key light)
        vec2 haloVec = (vScreenUv - vec2(0.46, 0.52)) * vec2(1.15, 1.0);
        float halo = exp(-dot(haloVec, haloVec) * 4.2);
        col = mix(col, uGlow, halo * 0.48);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const backdropMesh = new THREE.Mesh(backdropGeo, backdropMat);
  backdropMesh.renderOrder = -10;
  scene.add(backdropMesh);

  // Soft studio hemisphere ambient bounce (balanced for rich sculptural shadow modeling)
  const hemi = new THREE.HemisphereLight(0xfaf8f3, 0xbab1a2, 0.55);
  scene.add(hemi);

  // Primary softbox key light (upper-left-front) with crisp tight shadows inside tracks & windows
  const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.48);
  keyLight.position.set(-2.9, 3.8, 3.3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1.5;
  keyLight.shadow.camera.far = 12.0;
  keyLight.shadow.camera.left = -1.32;
  keyLight.shadow.camera.right = 1.32;
  keyLight.shadow.camera.top = 1.32;
  keyLight.shadow.camera.bottom = -1.32;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.01;
  keyLight.shadow.radius = 2.5;
  scene.add(keyLight);

  // Cool neutral fill light (right-front) — classic 3:1 studio key-to-fill ratio
  const fillLight = new THREE.DirectionalLight(0xe8eff8, 0.34);
  fillLight.position.set(4.1, 1.1, 2.4);
  scene.add(fillLight);

  // Crisp studio rim light (back-top-right)
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.58);
  rimLight.position.set(2.5, 3.1, -3.6);
  scene.add(rimLight);

  // Grounded soft studio contact shadow under the sphere
  const shadowTex = createContactShadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(3.1, 3.1);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 1.0,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.position.set(0.18, -1.18, -0.06);
  shadowPlane.renderOrder = -2;
  scene.add(shadowPlane);

  return {
    envMap,
    shadowPlane,
    backdropMesh,
    dispose: () => {
      envMap.dispose();
      backdropGeo.dispose();
      backdropMat.dispose();
      shadowTex.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
    },
  };
}
