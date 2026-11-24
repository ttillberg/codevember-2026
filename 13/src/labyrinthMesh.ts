import * as THREE from 'three';
import {
  R_BALL,
  R_FLOOR,
  R_SHELL,
  R_WALL,
  WALL_HALF_WIDTH,
  sphToDir,
  type Checkpoint,
  type SphereMaze,
  type VertexPost,
  type WallSegment,
} from './maze';
import {
  createDecalLabelTexture,
  createLedHaloTexture,
  createMatteGrainTextures,
  createMetalBallTexture,
  createPlasticScratchTextures,
  createTapeTexture,
} from './textures';

export interface LedVisual {
  checkpoint: Checkpoint;
  domeMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
  haloMesh: THREE.Mesh;
  localPos: THREE.Vector3;
}

export interface LabyrinthRig {
  root: THREE.Group;
  ballMesh: THREE.Mesh;
  plasticShell: THREE.Mesh;
  plasticMat: THREE.MeshPhysicalMaterial;
  scratchOverlayMesh: THREE.Mesh;
  scratchOverlayMat: THREE.MeshStandardMaterial;
  leds: LedVisual[];
  aoExcluded: THREE.Object3D[];
  activeLight: THREE.PointLight;
  clearedLight: THREE.PointLight;
  updateLeds: (time: number, clearedMask: boolean[], nextIndex: number, allCleared: boolean) => void;
  setPlasticOpacity: (scale: number) => void;
  setScratchStrength: (scale: number) => void;
  dispose: () => void;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIdx);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    const count = pos.count;

    positions.set(pos.array as Float32Array, vOffset * 3);
    normals.set(norm.array as Float32Array, vOffset * 3);
    if (uv) {
      uvs.set(uv.array as Float32Array, vOffset * 2);
    }

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        indices[iOffset + i] = idx[i] + vOffset;
      }
      iOffset += idx.length;
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Builds a single curved, draft-angled, top-beveled spherical wall rib along a lat/lon arc.
 */
function buildWallArcGeometry(wall: WallSegment): THREE.BufferGeometry {
  const rBase = R_FLOOR - 0.018;
  const rBevelStart = R_WALL - 0.022;
  const rTop = R_WALL;

  // Cross-section profile from left base -> left upper -> left bevel -> right bevel -> right upper -> right base
  // Width has subtle injection-molding draft angle (wider at floor, narrower at bevel)
  const hwBase = WALL_HALF_WIDTH * 1.07;
  const hwUpper = WALL_HALF_WIDTH * 0.96;
  const hwTop = WALL_HALF_WIDTH * 0.68;

  const profile: [number, number][] = [
    [-hwBase, rBase],
    [-hwUpper, rBevelStart],
    [-hwTop, rTop],
    [hwTop, rTop],
    [hwUpper, rBevelStart],
    [hwBase, rBase],
  ];

  // Number of subdivisions along the arc for smooth spherical curvature
  const arcLen =
    wall.kind === 'lat'
      ? Math.abs(wall.thetaEnd - wall.thetaStart) * Math.sin(wall.phiStart)
      : Math.abs(wall.phiEnd - wall.phiStart);
  const steps = Math.max(6, Math.ceil(arcLen * 28));

  const ringCount = steps + 1;
  const profCount = profile.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const pt = new THREE.Vector3();

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const phi = wall.kind === 'lat' ? wall.phiStart : wall.phiStart + (wall.phiEnd - wall.phiStart) * t;
    const theta = wall.kind === 'lon' ? wall.thetaStart : wall.thetaStart + (wall.thetaEnd - wall.thetaStart) * t;

    sphToDir(phi, theta, dir);

    if (wall.kind === 'lat') {
      // Tangent along +theta
      tangent.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
    } else {
      // Tangent along +phi
      tangent.set(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
    }
    // Binormal perpendicular to wall along sphere surface
    binormal.crossVectors(dir, tangent).normalize();

    for (let p = 0; p < profCount; p++) {
      const [offset, radius] = profile[p];
      // Project offset gently onto curved surface at radius
      pt.copy(dir).multiplyScalar(radius).addScaledVector(binormal, offset * radius);
      // Re-normalize to exact radius so top sits perfectly concentric with outer plastic shell
      pt.normalize().multiplyScalar(radius);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(t * arcLen * 2.2, p / (profCount - 1));
    }
  }

  for (let s = 0; s < steps; s++) {
    for (let p = 0; p < profCount - 1; p++) {
      const a = s * profCount + p;
      const b = (s + 1) * profCount + p;
      const c = (s + 1) * profCount + (p + 1);
      const d = s * profCount + (p + 1);
      // Outward-facing winding: (b - a) x (d - a) = tangent x binormal = +radial
      indices.push(a, b, d, b, c, d);
    }
  }

  void ringCount;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a smooth beveled radial corner post at a wall junction so all wall ends & corners are cleanly rounded.
 */
function buildPostGeometry(post: VertexPost): THREE.BufferGeometry {
  const rBase = R_FLOOR - 0.018;
  const rBevelStart = R_WALL - 0.022;
  const rTop = R_WALL;

  const hwBase = WALL_HALF_WIDTH * 1.07 * rBase;
  const hwUpper = WALL_HALF_WIDTH * 0.96 * rBevelStart;
  const hwTop = WALL_HALF_WIDTH * 0.68 * rTop;

  // Lathe profile around local +Y axis (radial outward)
  const lathePts = [
    new THREE.Vector2(hwBase, rBase),
    new THREE.Vector2(hwUpper, rBevelStart),
    new THREE.Vector2(hwTop, rTop),
    new THREE.Vector2(0.0001, rTop + 0.001),
  ];
  const geo = new THREE.LatheGeometry(lathePts, 14);

  // Align local +Y to post.dir
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), post.dir);
  geo.applyQuaternion(q);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a curved rectangular patch lying smoothly on a sphere of radius `radius`,
 * oriented along the equator with a gentle hand-applied tilt angle.
 */
function buildCurvedTapePatch(
  radius: number,
  centerTheta: number,
  angularWidth: number,
  angularHeight: number,
  tiltRad: number,
): THREE.BufferGeometry {
  const segX = 40;
  const segY = 10;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltRad);
  const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), centerTheta);
  const v = new THREE.Vector3();

  for (let iy = 0; iy <= segY; iy++) {
    const vCoord = iy / segY;
    const lat = (vCoord - 0.5) * angularHeight;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let ix = 0; ix <= segX; ix++) {
      const uCoord = ix / segX;
      const lon = (uCoord - 0.5) * angularWidth;
      // Local patch centered around +Z so u goes left->right across front face
      v.set(cosLat * Math.sin(lon), sinLat, cosLat * Math.cos(lon));
      v.applyQuaternion(qTilt);
      v.applyQuaternion(qSpin);
      normals.push(v.x, v.y, v.z);
      positions.push(v.x * radius, v.y * radius, v.z * radius);
      uvs.push(uCoord, vCoord);
    }
  }

  const stride = segX + 1;
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds a small spherical decal patch seated flush on the inner track floor.
 */
function buildFloorDecalPatch(dir: THREE.Vector3, radius: number, angularRadius: number): THREE.BufferGeometry {
  const seg = 8;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangentX = new THREE.Vector3().crossVectors(up, dir).normalize();
  const tangentY = new THREE.Vector3().crossVectors(dir, tangentX).normalize();
  const v = new THREE.Vector3();

  for (let iy = 0; iy <= seg; iy++) {
    const ty = (iy / seg) * 2 - 1;
    for (let ix = 0; ix <= seg; ix++) {
      const tx = (ix / seg) * 2 - 1;
      v.copy(dir)
        .addScaledVector(tangentX, tx * angularRadius)
        .addScaledVector(tangentY, ty * angularRadius)
        .normalize();
      normals.push(v.x, v.y, v.z);
      positions.push(v.x * radius, v.y * radius, v.z * radius);
      uvs.push(ix / seg, iy / seg);
    }
  }

  const stride = seg + 1;
  for (let iy = 0; iy < seg; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds a miniature machined slotted countersunk stainless screw group oriented along local +Y.
 */
function createMicroScrew(
  steelMat: THREE.MeshStandardMaterial,
  darkSlotMat: THREE.MeshStandardMaterial,
  scale = 1,
): THREE.Group {
  const g = new THREE.Group();

  // Recessed countersunk bezel ring
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.033 * scale, 0.036 * scale, 0.008 * scale, 18), darkSlotMat);
  collar.position.y = -0.002 * scale;
  g.add(collar);

  // Machined slightly domed screw head
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * scale, 0.027 * scale, 0.011 * scale, 18), steelMat);
  head.position.y = 0.001 * scale;
  g.add(head);

  // Crisp machined screwdriver slot
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.042 * scale, 0.005 * scale, 0.0065 * scale), darkSlotMat);
  slot.position.y = 0.005 * scale;
  g.add(slot);

  return g;
}

export function buildLabyrinthRig(maze: SphereMaze): LabyrinthRig {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const aoExcluded: THREE.Object3D[] = [];

  const { roughnessMap: matteRough, bumpMap: matteBump } = createMatteGrainTextures();
  disposables.push(matteRough, matteBump);

  // 1. Inner Track Floor Core (warm architectural matte beige)
  const floorGeo = new THREE.SphereGeometry(R_FLOOR, 88, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xcfc3b0, // warm Scandinavian sand-beige for crisp sculptural contrast under bone-white walls
    roughness: 0.8,
    roughnessMap: matteRough,
    bumpMap: matteBump,
    bumpScale: 0.0024,
    metalness: 0.0,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.receiveShadow = true;
  floorMesh.castShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  // Subtle recessed equatorial hairline groove on the inner core
  const innerSeamGeo = new THREE.TorusGeometry(R_FLOOR + 0.001, 0.0024, 8, 96);
  innerSeamGeo.rotateX(Math.PI / 2);
  const innerSeamMat = new THREE.MeshStandardMaterial({
    color: 0xa89f8f,
    roughness: 0.88,
    metalness: 0.0,
  });
  const innerSeam = new THREE.Mesh(innerSeamGeo, innerSeamMat);
  root.add(innerSeam);
  disposables.push(innerSeamGeo, innerSeamMat);

  // 2. Sculpted Matte Bone-White Labyrinth Walls + Rounded Corner Posts
  const wallGeos: THREE.BufferGeometry[] = [];
  for (const w of maze.solidWalls) {
    wallGeos.push(buildWallArcGeometry(w));
  }
  for (const post of maze.posts) {
    wallGeos.push(buildPostGeometry(post));
  }
  const mergedWallGeo = mergeGeometries(wallGeos);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf1ede5, // crisp matte warm-white ABS
    roughness: 0.5,
    roughnessMap: matteRough,
    bumpMap: matteBump,
    bumpScale: 0.0015,
    metalness: 0.0,
  });
  const wallsMesh = new THREE.Mesh(mergedWallGeo, wallMat);
  wallsMesh.castShadow = true;
  wallsMesh.receiveShadow = true;
  root.add(wallsMesh);
  disposables.push(mergedWallGeo, wallMat);

  // 3. Precision Machined Micro-Screws embedded into selected wall posts & equatorial assembly tabs
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xd6d8dc,
    metalness: 0.92,
    roughness: 0.24,
  });
  const darkSlotMat = new THREE.MeshStandardMaterial({
    color: 0x3b3935,
    metalness: 0.45,
    roughness: 0.65,
  });
  disposables.push(steelMat, darkSlotMat);

  // Pick 6 well-distributed high-degree wall junction posts across the sphere for assembly screws
  const sortedPosts = [...maze.posts].sort((a, b) => b.degree - a.degree);
  const screwPosts: VertexPost[] = [];
  for (const post of sortedPosts) {
    if (screwPosts.length >= 6) break;
    if (post.phi < 0.35 || post.phi > Math.PI - 0.35) continue;
    const tooClose = screwPosts.some((other) => other.dir.dot(post.dir) > 0.45);
    if (!tooClose) screwPosts.push(post);
  }

  const upAxis = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < screwPosts.length; i++) {
    const post = screwPosts[i];
    const screw = createMicroScrew(steelMat, darkSlotMat, 1.0);
    screw.position.copy(post.dir).multiplyScalar(R_WALL - 0.002);
    screw.quaternion.setFromUnitVectors(upAxis, post.dir);
    // Give each screw a slightly different realistic slot orientation
    screw.rotateY(i * 1.17 + 0.4);
    root.add(screw);
  }

  // 4 tiny equatorial shell-alignment micro-fasteners around the polycarbonate seam
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const microPin = createMicroScrew(steelMat, darkSlotMat, 0.62);
    microPin.position.copy(dir).multiplyScalar(R_SHELL - 0.003);
    microPin.quaternion.setFromUnitVectors(upAxis, dir);
    microPin.rotateY(i * 0.9 + 0.2);
    root.add(microPin);
  }

  // 4. Start Marker Pad-Print at North Pole
  const startDecalTex = createDecalLabelTexture('00', 'START');
  const startDecalGeo = buildFloorDecalPatch(maze.startCell.centerDir, R_FLOOR + 0.0025, 0.19);
  const startDecalMat = new THREE.MeshStandardMaterial({
    map: startDecalTex,
    transparent: true,
    roughness: 0.78,
    depthWrite: false,
  });
  const startDecalMesh = new THREE.Mesh(startDecalGeo, startDecalMat);
  root.add(startDecalMesh);
  aoExcluded.push(startDecalMesh);
  disposables.push(startDecalTex, startDecalGeo, startDecalMat);

  // Tiny recessed stainless pilot dimple at Start
  const startRingGeo = new THREE.TorusGeometry(0.044, 0.0055, 10, 28);
  startRingGeo.rotateX(Math.PI / 2);
  const startRing = new THREE.Mesh(startRingGeo, steelMat);
  startRing.position.copy(maze.startCell.centerDir).multiplyScalar(R_FLOOR + 0.003);
  startRing.quaternion.setFromUnitVectors(upAxis, maze.startCell.centerDir);
  root.add(startRing);
  disposables.push(startRingGeo);

  // 5. Checkpoint LEDs inside the labyrinth
  const haloTex = createLedHaloTexture();
  disposables.push(haloTex);

  const bezelGeo = new THREE.TorusGeometry(0.033, 0.0065, 10, 24);
  bezelGeo.rotateX(Math.PI / 2);
  const domeGeo = new THREE.SphereGeometry(0.025, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const haloGeo = new THREE.PlaneGeometry(0.24, 0.24);
  disposables.push(bezelGeo, domeGeo, haloGeo);

  const leds: LedVisual[] = [];

  for (const cp of maze.checkpoints) {
    const qAlign = new THREE.Quaternion().setFromUnitVectors(upAxis, cp.dir);

    // Pad-printed floor index ring around LED
    const labelTex = createDecalLabelTexture(cp.label, cp.isFinish ? 'END' : 'CHK');
    const decalGeo = buildFloorDecalPatch(cp.dir, R_FLOOR + 0.0025, 0.165);
    const decalMat = new THREE.MeshStandardMaterial({
      map: labelTex,
      transparent: true,
      roughness: 0.78,
      depthWrite: false,
    });
    const decalMesh = new THREE.Mesh(decalGeo, decalMat);
    root.add(decalMesh);
    aoExcluded.push(decalMesh);
    disposables.push(labelTex, decalGeo, decalMat);

    // Machined bezel ring
    const bezel = new THREE.Mesh(bezelGeo, steelMat);
    bezel.position.copy(cp.dir).multiplyScalar(R_FLOOR + 0.002);
    bezel.quaternion.copy(qAlign);
    root.add(bezel);

    // Translucent diffused LED dome
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xffe4c4,
      emissive: new THREE.Color(0xff7d22),
      emissiveIntensity: 0.4,
      roughness: 0.25,
      metalness: 0.05,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(cp.dir).multiplyScalar(R_FLOOR - 0.001);
    dome.quaternion.copy(qAlign);
    root.add(dome);
    disposables.push(domeMat);

    // Soft additive halo hugging the track floor around the LED
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      color: 0xff8c2b,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.copy(cp.dir).multiplyScalar(R_FLOOR + 0.022);
    haloMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cp.dir);
    root.add(haloMesh);
    aoExcluded.push(haloMesh);
    disposables.push(haloMat);

    leds.push({
      checkpoint: cp,
      domeMat,
      haloMat,
      haloMesh,
      localPos: cp.dir.clone().multiplyScalar(R_FLOOR + 0.075),
    });
  }

  // Two real interior point lights so lit LEDs wash adjacent white labyrinth walls softly!
  const activeLight = new THREE.PointLight(0xff8424, 0.55, 0.85, 1.8);
  const clearedLight = new THREE.PointLight(0x34d984, 0.0, 0.85, 1.8);
  root.add(activeLight);
  root.add(clearedLight);

  // 6. Precision Bearing Steel Metal Ball
  const ballGeo = new THREE.SphereGeometry(R_BALL, 36, 28);
  const ballRoughTex = createMetalBallTexture();
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xd9dce2,
    metalness: 0.99,
    roughness: 0.09,
    roughnessMap: ballRoughTex,
    envMapIntensity: 2.1,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  root.add(ballMesh);
  disposables.push(ballGeo, ballRoughTex, ballMat);

  // 7. Thin Crystal-Clear Plastic Outer Shell + Very Light Scratches
  const { roughnessMap: scratchRough, bumpMap: scratchBump, scratchAlphaMap } = createPlasticScratchTextures();
  disposables.push(scratchRough, scratchBump, scratchAlphaMap);

  const shellGeo = new THREE.SphereGeometry(R_SHELL, 88, 64);
  const plasticOpacityUniform = { value: 1.0 };

  const plasticMat = new THREE.MeshPhysicalMaterial({
    color: 0xfdfcf9,
    roughness: 0.055,
    roughnessMap: scratchRough,
    bumpMap: scratchBump,
    bumpScale: 0.0032,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.048,
    reflectivity: 0.92,
    ior: 1.49,
    envMapIntensity: 2.35,
    transparent: true,
    opacity: 1.0,
    depthWrite: false, // crucial: keeps inner labyrinth crisp for GTAO/SSAO!
  });

  // Fresnel thin-film opacity shaping: crystal clear head-on, luminous thin-plastic rim at grazing angles
  plasticMat.onBeforeCompile = (shader) => {
    shader.uniforms.uPlasticScale = plasticOpacityUniform;
    shader.fragmentShader =
      'uniform float uPlasticScale;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        vec3 viewDir = normalize(vViewPosition);
        float ndotv = clamp(abs(dot(normalize(normal), viewDir)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.55);
        float specEnergy = max(max(reflectedLight.directSpecular.r, reflectedLight.directSpecular.g), reflectedLight.directSpecular.b)
                         + max(max(reflectedLight.indirectSpecular.r, reflectedLight.indirectSpecular.g), reflectedLight.indirectSpecular.b) * 0.65;
        float shellAlpha = clamp((0.022 + fresnel * 0.44 + specEnergy * 0.36) * uPlasticScale, 0.0, 0.8);
        gl_FragColor.a = shellAlpha;
        #include <dithering_fragment>
        `,
      );
  };

  const plasticShell = new THREE.Mesh(shellGeo, plasticMat);
  plasticShell.renderOrder = 10;
  root.add(plasticShell);
  aoExcluded.push(plasticShell);
  disposables.push(shellGeo, plasticMat);

  // Subtle hairline scratch-gleam layer right on the clear shell surface (catches studio key light subtly)
  const scratchOverlayMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    alphaMap: scratchAlphaMap,
    transparent: true,
    opacity: 0.56,
    roughness: 0.22,
    metalness: 0.14,
    depthWrite: false,
  });
  const scratchOverlayMesh = new THREE.Mesh(shellGeo, scratchOverlayMat);
  scratchOverlayMesh.scale.setScalar(1.0008);
  scratchOverlayMesh.renderOrder = 11;
  root.add(scratchOverlayMesh);
  aoExcluded.push(scratchOverlayMesh);
  disposables.push(scratchOverlayMat);

  // Delicate translucent equatorial parting seam where the two thin plastic hemispheres meet
  const outerSeamGeo = new THREE.TorusGeometry(R_SHELL + 0.001, 0.0038, 10, 120);
  outerSeamGeo.rotateX(Math.PI / 2);
  const outerSeamMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8d3c9,
    roughness: 0.32,
    metalness: 0.0,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const outerSeam = new THREE.Mesh(outerSeamGeo, outerSeamMat);
  outerSeam.renderOrder = 12;
  root.add(outerSeam);
  aoExcluded.push(outerSeam);
  disposables.push(outerSeamGeo, outerSeamMat);

  // 8. Transparent Adhesive Tape Strips ("MADE IN SWEDEN ...") wrapped smoothly over the plastic shell
  const primaryTape = createTapeTexture('primary');
  const primaryTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0042, 0.38, 0.96, 0.21, 0.11);
  const primaryTapeMat = new THREE.MeshPhysicalMaterial({
    map: primaryTape.map,
    roughnessMap: primaryTape.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.3,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const primaryTapeMesh = new THREE.Mesh(primaryTapeGeo, primaryTapeMat);
  primaryTapeMesh.renderOrder = 14;
  root.add(primaryTapeMesh);
  aoExcluded.push(primaryTapeMesh);
  disposables.push(primaryTape.map, primaryTape.roughnessMap, primaryTapeGeo, primaryTapeMat);

  const secondaryTape = createTapeTexture('secondary');
  const secondaryTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0042, Math.PI + 0.18, 0.78, 0.17, -0.075);
  const secondaryTapeMat = new THREE.MeshPhysicalMaterial({
    map: secondaryTape.map,
    roughnessMap: secondaryTape.roughnessMap,
    roughness: 0.44,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.35,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const secondaryTapeMesh = new THREE.Mesh(secondaryTapeGeo, secondaryTapeMat);
  secondaryTapeMesh.renderOrder = 14;
  root.add(secondaryTapeMesh);
  aoExcluded.push(secondaryTapeMesh);
  disposables.push(secondaryTape.map, secondaryTape.roughnessMap, secondaryTapeGeo, secondaryTapeMat);

  // LED Animation Updater
  const colorAmber = new THREE.Color(0xff6b14);
  const colorStandby = new THREE.Color(0xe58a3c);
  const colorCleared = new THREE.Color(0x1fd178);
  const colorFinishGlow = new THREE.Color(0x36e68e);

  let lastClearedIdx = -1;

  function updateLeds(time: number, clearedMask: boolean[], nextIndex: number, allCleared: boolean) {
    let newestCleared = -1;
    for (let i = 0; i < leds.length; i++) {
      if (clearedMask[i]) newestCleared = i;
    }
    if (newestCleared !== -1) lastClearedIdx = newestCleared;

    for (let i = 0; i < leds.length; i++) {
      const led = leds[i];
      const cleared = clearedMask[i];

      if (allCleared) {
        const wave = 0.5 + 0.5 * Math.sin(time * 3.4 - i * 0.9);
        led.domeMat.color.setHex(0xc8ffe0);
        led.domeMat.emissive.copy(colorFinishGlow);
        led.domeMat.emissiveIntensity = 2.0 + wave * 2.0;
        led.haloMat.color.copy(colorFinishGlow);
        led.haloMat.opacity = 0.36 + wave * 0.34;
        led.haloMesh.scale.setScalar(1.0 + wave * 0.24);
      } else if (cleared) {
        const breathe = 0.5 + 0.5 * Math.sin(time * 1.6 + i * 1.3);
        led.domeMat.color.setHex(0xc8ffdf);
        led.domeMat.emissive.copy(colorCleared);
        led.domeMat.emissiveIntensity = 2.2 + breathe * 0.55;
        led.haloMat.color.copy(colorCleared);
        led.haloMat.opacity = 0.42 + breathe * 0.12;
        led.haloMesh.scale.setScalar(1.0 + breathe * 0.08);
      } else if (i === nextIndex) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
        led.domeMat.color.setHex(0xffe1c2);
        led.domeMat.emissive.copy(colorAmber);
        led.domeMat.emissiveIntensity = 2.1 + pulse * 2.2;
        led.haloMat.color.copy(colorAmber);
        led.haloMat.opacity = 0.42 + pulse * 0.36;
        led.haloMesh.scale.setScalar(0.98 + pulse * 0.3);
      } else {
        // Quiet warm standby pulse so upcoming checkpoints peek warmly from inside the tracks
        const idle = 0.5 + 0.5 * Math.sin(time * 1.2 + i * 1.7);
        led.domeMat.color.setHex(0xf6dec4);
        led.domeMat.emissive.copy(colorStandby);
        led.domeMat.emissiveIntensity = 0.65 + idle * 0.45;
        led.haloMat.color.copy(colorStandby);
        led.haloMat.opacity = 0.18 + idle * 0.1;
        led.haloMesh.scale.setScalar(0.76);
      }
    }

    if (allCleared && leds.length > 0) {
      const idx = Math.floor(time * 1.8) % leds.length;
      activeLight.color.copy(colorFinishGlow);
      activeLight.position.copy(leds[idx].localPos);
      activeLight.intensity = 1.1;
      clearedLight.intensity = 0.0;
    } else {
      if (nextIndex >= 0 && nextIndex < leds.length) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
        activeLight.color.copy(colorAmber);
        activeLight.position.copy(leds[nextIndex].localPos);
        activeLight.intensity = 0.75 + pulse * 0.65;
      } else {
        activeLight.intensity = 0.0;
      }

      if (lastClearedIdx >= 0 && lastClearedIdx < leds.length && clearedMask[lastClearedIdx]) {
        clearedLight.color.copy(colorCleared);
        clearedLight.position.copy(leds[lastClearedIdx].localPos);
        clearedLight.intensity = 0.85;
      } else {
        clearedLight.intensity = 0.0;
      }
    }
  }

  function setPlasticOpacity(scale: number) {
    plasticOpacityUniform.value = scale;
  }

  function setScratchStrength(scale: number) {
    scratchOverlayMat.opacity = 0.34 * scale;
    plasticMat.bumpScale = 0.0022 * scale;
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return {
    root,
    ballMesh,
    plasticShell,
    plasticMat,
    scratchOverlayMesh,
    scratchOverlayMat,
    leds,
    aoExcluded,
    activeLight,
    clearedLight,
    updateLeds,
    setPlasticOpacity,
    setScratchStrength,
    dispose,
  };
}
