import * as THREE from 'three';

export interface MonitorKnobs {
  color: number;    // 0..1 (default 0.5 -> 1.0x saturation)
  tint: number;     // 0..1 (default 0.5 -> 0 hue shift)
  bright: number;   // 0..1 (default 0.5 -> neutral)
  contrast: number; // 0..1 (default 0.5 -> neutral)
}

export interface MonitorHit {
  kind: 'screen' | 'power' | 'hatch' | 'knob';
  knob?: keyof MonitorKnobs;
}

export class Commodore1702 {
  readonly root = new THREE.Group();
  readonly screenMesh: THREE.Mesh;
  readonly powerButton: THREE.Mesh;
  readonly hatchPivot = new THREE.Group();
  readonly hatchMesh: THREE.Mesh;
  readonly knobMeshes: Record<keyof MonitorKnobs, THREE.Mesh>;
  readonly interactiveMeshes: THREE.Object3D[] = [];

  private readonly crtMaterial: THREE.ShaderMaterial;
  private readonly ledMaterial: THREE.MeshStandardMaterial;
  private readonly ledLight: THREE.PointLight;
  private readonly screenGlowLight: THREE.PointLight;
  private readonly screenTexture: THREE.CanvasTexture;

  powered = true;
  hatchOpen = false;
  readonly knobs: MonitorKnobs = {
    color: 0.52,
    tint: 0.5,
    bright: 0.52,
    contrast: 0.54,
  };

  // Animation states
  private powerAnim = 0.0; // starts at 0 and warms up smoothly on boot!
  private powerOffFlash = 0.0;
  private degaussAnim = 1.0;
  private hatchAngle = 0.0;
  private buttonDepth = 1.0;

  constructor(c64Canvas: HTMLCanvasElement) {
    // Live texture from the 384x272 C64 screen
    this.screenTexture = new THREE.CanvasTexture(c64Canvas);
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.magFilter = THREE.LinearFilter;
    this.screenTexture.generateMipmaps = false;
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;

    // Procedural materials for 1983 Commodore 1702 injection-molded ABS plastic
    const grainTex = makePlasticGrainTexture();
    const plasticMain = new THREE.MeshStandardMaterial({
      color: 0xa89d8b,
      roughness: 0.62,
      metalness: 0.04,
      bumpMap: grainTex,
      bumpScale: 0.004,
    });
    const plasticRear = new THREE.MeshStandardMaterial({
      color: 0x948977,
      roughness: 0.68,
      metalness: 0.04,
      bumpMap: grainTex,
      bumpScale: 0.005,
    });
    const plasticDark = new THREE.MeshStandardMaterial({
      color: 0x282522,
      roughness: 0.52,
      metalness: 0.08,
      bumpMap: grainTex,
      bumpScale: 0.0025,
    });
    const plasticRecess = new THREE.MeshStandardMaterial({
      color: 0x181614,
      roughness: 0.75,
      metalness: 0.05,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x151413,
      roughness: 0.9,
      metalness: 0.02,
    });
    const metalAccent = new THREE.MeshStandardMaterial({
      color: 0xbab4a8,
      roughness: 0.34,
      metalness: 0.68,
    });

    // Overall proportions (1 unit = 10 cm)
    // Width 3.56, Height 3.24, Front body depth 2.25, Rear tapered neck 1.45
    const W = 3.56;
    const H = 3.24;
    const bodyY = H / 2 + 0.11; // lifted by rubber feet

    const cabinet = new THREE.Group();
    cabinet.position.y = bodyY;
    this.root.add(cabinet);

    // 1. Main outer shell (front boxy block with beveled rounded profile)
    const frontDepth = 2.15;
    const shellShape = roundedRectShape(W, H, 0.12);
    const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
      depth: frontDepth - 0.08,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 4,
      curveSegments: 12,
    });
    shellGeo.center();
    const frontShell = new THREE.Mesh(shellGeo, plasticMain);
    frontShell.position.z = 0.0;
    frontShell.castShadow = true;
    frontShell.receiveShadow = true;
    cabinet.add(frontShell);

    // Subtle dark parting seam line around the cabinet ~0.48 from front
    const seamShape = roundedRectShape(W + 0.015, H + 0.015, 0.125);
    const seamHole = roundedRectShape(W - 0.04, H - 0.04, 0.10);
    seamShape.holes.push(seamHole);
    const seamGeo = new THREE.ExtrudeGeometry(seamShape, {
      depth: 0.016,
      bevelEnabled: false,
      curveSegments: 10,
    });
    seamGeo.center();
    const seamMesh = new THREE.Mesh(seamGeo, plasticRecess);
    seamMesh.position.z = frontDepth / 2 - 0.52;
    cabinet.add(seamMesh);

    // 2. Front dark charcoal face recess (housing CRT bezel + lower control strip)
    const faceZ = frontDepth / 2 + 0.032;
    const faceW = W - 0.24;
    const faceH = H - 0.24;

    // Dark bezel backing plate (sits behind the CRT tube and lower control strip, never clips the curved glass!)
    const facePlateShape = roundedRectShape(faceW, faceH, 0.07);
    const facePlateGeo = new THREE.ExtrudeGeometry(facePlateShape, {
      depth: 0.04,
      bevelEnabled: false,
      curveSegments: 10,
    });
    facePlateGeo.center();
    const facePlate = new THREE.Mesh(facePlateGeo, plasticDark);
    facePlate.position.z = faceZ - 0.14;
    facePlate.receiveShadow = true;
    cabinet.add(facePlate);

    // Recessed matte dark surround behind the lower control strip
    const lowerBacking = new THREE.Mesh(
      new THREE.BoxGeometry(faceW - 0.02, 0.64, 0.14),
      plasticDark,
    );
    lowerBacking.position.set(0, -1.20, faceZ - 0.06);
    cabinet.add(lowerBacking);

    // 3. CRT Bezel frame (thick molded surround with beveled opening for the 4:3 tube)
    const screenW = 2.72;
    const screenH = 2.02;
    const screenCenterY = 0.27;

    const bezelOuter = roundedRectShape(faceW - 0.02, 2.38, 0.055);
    const bezelInner = roundedRectShape(screenW, screenH, 0.16);
    bezelOuter.holes.push(bezelInner);
    const bezelGeo = new THREE.ExtrudeGeometry(bezelOuter, {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.022,
      bevelSize: 0.022,
      bevelSegments: 4,
      curveSegments: 20,
    });
    bezelGeo.center();
    const bezelMesh = new THREE.Mesh(bezelGeo, plasticDark);
    bezelMesh.position.set(0, screenCenterY, faceZ + 0.015);
    bezelMesh.castShadow = true;
    bezelMesh.receiveShadow = true;
    cabinet.add(bezelMesh);

    // Deep inner shadow collar framing the glass edges (outside the visible screen opening)
    const innerMaskOuter = roundedRectShape(screenW + 0.22, screenH + 0.22, 0.19);
    const innerMaskHole = roundedRectShape(screenW - 0.01, screenH - 0.01, 0.155);
    innerMaskOuter.holes.push(innerMaskHole);
    const innerMaskGeo = new THREE.ExtrudeGeometry(innerMaskOuter, {
      depth: 0.20,
      bevelEnabled: false,
      curveSegments: 20,
    });
    innerMaskGeo.center();
    const innerMask = new THREE.Mesh(innerMaskGeo, plasticRecess);
    innerMask.position.set(0, screenCenterY, faceZ - 0.02);
    cabinet.add(innerMask);

    // 4. Curved 4:3 CRT Glass Screen + Custom GLSL CRT Shader
    // Sits cleanly in front of the outer shell face and tucked inside the deep beveled bezel opening!
    const crtGeo = makeCurvedCrtGeometry(screenW + 0.18, screenH + 0.18, 48, 36, 0.095);
    this.crtMaterial = makeCrtShaderMaterial(this.screenTexture);
    this.screenMesh = new THREE.Mesh(crtGeo, this.crtMaterial);
    this.screenMesh.position.set(0, screenCenterY, faceZ + 0.012);
    this.screenMesh.userData.hit = { kind: 'screen' } satisfies MonitorHit;
    cabinet.add(this.screenMesh);
    this.interactiveMeshes.push(this.screenMesh);

    // 5. Lower front control strip (Commodore 1702 nameplate, speaker grille, hatch + knobs, power)
    const stripY = -1.21;
    const stripZ = faceZ + 0.015;

    // Fine brushed silver divider trim line between CRT bezel and lower strip
    const trimBar = new THREE.Mesh(new THREE.BoxGeometry(faceW - 0.06, 0.018, 0.03), metalAccent);
    trimBar.position.set(0, -0.94, stripZ + 0.045);
    cabinet.add(trimBar);

    // Recessed control strip base
    const stripBack = new THREE.Mesh(new THREE.BoxGeometry(faceW - 0.08, 0.48, 0.05), plasticRecess);
    stripBack.position.set(0, stripY, stripZ + 0.005);
    cabinet.add(stripBack);

    // 5a. Commodore 1702 silkscreen badge on lower-left
    const badgeTex = makeCommodoreBadgeTexture();
    const badgeMat = new THREE.MeshStandardMaterial({
      map: badgeTex,
      roughness: 0.38,
      metalness: 0.25,
    });
    const badgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.36), badgeMat);
    badgeMesh.position.set(-1.00, stripY, stripZ + 0.034);
    cabinet.add(badgeMesh);

    // 5b. Slotted speaker grille (center-left)
    const grilleGroup = new THREE.Group();
    grilleGroup.position.set(-0.14, stripY, stripZ + 0.032);
    const grilleMat = new THREE.MeshStandardMaterial({
      color: 0x3b3733,
      roughness: 0.48,
      metalness: 0.12,
    });
    const ribGeo = new THREE.BoxGeometry(0.02, 0.32, 0.026);
    for (let i = 0; i < 11; i++) {
      const rib = new THREE.Mesh(ribGeo, grilleMat);
      rib.position.x = (i - 5) * 0.042;
      grilleGroup.add(rib);
    }
    cabinet.add(grilleGroup);

    // 5c. Control bay with 4 knurled rotary knobs behind a flip-down tinted hatch!
    const bayX = 0.62;
    const bayW = 0.94;
    const bayH = 0.36;

    // Recessed faceplate with knob labels
    const labelTex = makeControlLabelsTexture();
    const bayPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(bayW - 0.04, bayH - 0.02),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.1 }),
    );
    bayPlate.position.set(bayX, stripY, stripZ + 0.028);
    cabinet.add(bayPlate);

    const knobNames: (keyof MonitorKnobs)[] = ['color', 'tint', 'bright', 'contrast'];
    const knobGeo = new THREE.CylinderGeometry(0.056, 0.062, 0.075, 20);
    knobGeo.rotateX(Math.PI / 2);
    const knobMat = new THREE.MeshStandardMaterial({
      color: 0x35312d,
      roughness: 0.42,
      metalness: 0.2,
    });
    const notchMat = new THREE.MeshBasicMaterial({ color: 0xded9ce });
    const notchGeo = new THREE.BoxGeometry(0.011, 0.032, 0.012);

    const knobMeshes = {} as Record<keyof MonitorKnobs, THREE.Mesh>;
    for (let i = 0; i < knobNames.length; i++) {
      const kName = knobNames[i];
      const kx = bayX - 0.315 + i * 0.21;
      const knob = new THREE.Mesh(knobGeo, knobMat);
      knob.position.set(kx, stripY + 0.025, stripZ + 0.055);
      knob.userData.hit = { kind: 'knob', knob: kName } satisfies MonitorHit;
      const notch = new THREE.Mesh(notchGeo, notchMat);
      notch.position.set(0, 0.028, 0.036);
      knob.add(notch);
      cabinet.add(knob);
      knobMeshes[kName] = knob;
      this.interactiveMeshes.push(knob);
    }
    this.knobMeshes = knobMeshes;
    this.syncKnobRotations();

    // Flip-down smoked acrylic control cover door (hinged at bottom)
    this.hatchPivot.position.set(bayX, stripY - bayH / 2, stripZ + 0.095);
    cabinet.add(this.hatchPivot);

    const hatchMat = new THREE.MeshPhysicalMaterial({
      color: 0x201c19,
      roughness: 0.16,
      metalness: 0.05,
      transmission: 0.35,
      transparent: true,
      opacity: 0.84,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });
    const hatchGeo = new THREE.BoxGeometry(bayW, bayH, 0.022);
    this.hatchMesh = new THREE.Mesh(hatchGeo, hatchMat);
    this.hatchMesh.position.set(0, bayH / 2, 0);
    this.hatchMesh.userData.hit = { kind: 'hatch' } satisfies MonitorHit;
    // Tiny silver finger ridge on top edge of hatch
    const hatchLip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.018, 0.03), metalAccent);
    hatchLip.position.set(0, bayH / 2 - 0.03, 0.012);
    this.hatchMesh.add(hatchLip);
    this.hatchPivot.add(this.hatchMesh);
    this.interactiveMeshes.push(this.hatchMesh);

    // 5d. Power LED & tactile Power push-button (far right)
    const pwrX = 1.36;

    // Power label strip
    const pwrLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.12),
      new THREE.MeshBasicMaterial({ map: makePowerLabelTexture(), transparent: true }),
    );
    pwrLabel.position.set(pwrX, stripY - 0.135, stripZ + 0.034);
    cabinet.add(pwrLabel);

    // Glowing rectangular green power LED
    this.ledMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d4020,
      emissive: 0x4dff68,
      emissiveIntensity: 2.2,
      roughness: 0.25,
    });
    const ledMesh = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.042, 0.022), this.ledMaterial);
    ledMesh.position.set(pwrX, stripY + 0.125, stripZ + 0.036);
    cabinet.add(ledMesh);

    this.ledLight = new THREE.PointLight(0x4dff68, 0.18, 0.9, 2.0);
    this.ledLight.position.set(pwrX, stripY + 0.125, stripZ + 0.16);
    cabinet.add(this.ledLight);

    // Square physical Power push-button
    const btnBezel = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.15, 0.03), plasticRecess);
    btnBezel.position.set(pwrX, stripY - 0.01, stripZ + 0.034);
    cabinet.add(btnBezel);

    const btnMat = new THREE.MeshStandardMaterial({
      color: 0x3b3631,
      roughness: 0.42,
      metalness: 0.12,
    });
    this.powerButton = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.11, 0.095), btnMat);
    this.powerButton.position.set(pwrX, stripY - 0.01, stripZ + 0.055);
    this.powerButton.userData.hit = { kind: 'power' } satisfies MonitorHit;
    // Small white/cream power cap inset
    const btnDot = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.016, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xd8d2c5, roughness: 0.5 }),
    );
    btnDot.position.set(0, 0, 0.048);
    this.powerButton.add(btnDot);
    cabinet.add(this.powerButton);
    this.interactiveMeshes.push(this.powerButton);

    // 6. Top cooling louver vents (iconic Commodore 1702 slotted top)
    const ventGroup = new THREE.Group();
    const ventY = H / 2 + 0.035;
    for (let i = 0; i < 12; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.025, 0.038), plasticRecess);
      slot.position.set(0, ventY, -0.82 + i * 0.088);
      ventGroup.add(slot);
    }
    cabinet.add(ventGroup);

    // 7. Side recessed carry handles (left & right walls)
    for (const side of [-1, 1]) {
      const handleRecess = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.24, 0.92),
        plasticRecess,
      );
      handleRecess.position.set(side * (W / 2 + 0.018), 0.22, -0.05);
      cabinet.add(handleRecess);

      const handleLip = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.045, 0.94),
        plasticMain,
      );
      handleLip.position.set(side * (W / 2 + 0.024), 0.34, -0.05);
      cabinet.add(handleLip);
    }

    // 8. Tapered rear CRT neck housing (distinctive 1702 trapezoid back)
    const neckDepth = 1.48;
    const neckGeo = makeTaperedBackGeometry(W - 0.34, H - 0.38, 1.98, 1.72, neckDepth);
    const neckMesh = new THREE.Mesh(neckGeo, plasticRear);
    neckMesh.position.set(0, 0.04, -frontDepth / 2 - neckDepth / 2 + 0.06);
    neckMesh.castShadow = true;
    neckMesh.receiveShadow = true;
    cabinet.add(neckMesh);

    // Rear ventilation slots on top of the CRT neck
    for (let i = 0; i < 7; i++) {
      const rSlot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.04), plasticRecess);
      rSlot.position.set(0, 1.24 - i * 0.055, -frontDepth / 2 - 0.16 - i * 0.155);
      rSlot.rotation.x = 0.34;
      cabinet.add(rSlot);
    }

    // Rear spec sticker & RCA composite jacks (rewarding when orbiting around the back!)
    const backZ = -frontDepth / 2 - neckDepth + 0.052;
    const specPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.22, 0.54),
      new THREE.MeshStandardMaterial({
        map: makeRearSpecTexture(),
        roughness: 0.6,
        metalness: 0.1,
      }),
    );
    specPlate.position.set(0, 0.36, backZ);
    specPlate.rotation.y = Math.PI;
    cabinet.add(specPlate);

    // Rear recessed RCA jack panel (Yellow Video, White Audio, Red Chroma, Black Luma)
    const jackBay = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.38, 0.08), plasticRecess);
    jackBay.position.set(0, -0.34, backZ + 0.03);
    cabinet.add(jackBay);

    const jackColors = [0xd6b532, 0xd8d5cc, 0xb83834, 0x303030];
    const rcaOuterGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.09, 14);
    rcaOuterGeo.rotateX(Math.PI / 2);
    const rcaInnerGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.11, 12);
    rcaInnerGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < jackColors.length; i++) {
      const jx = -0.39 + i * 0.26;
      const col = new THREE.Mesh(
        rcaOuterGeo,
        new THREE.MeshStandardMaterial({ color: jackColors[i], roughness: 0.45 }),
      );
      col.position.set(jx, -0.34, backZ - 0.01);
      cabinet.add(col);
      const pin = new THREE.Mesh(rcaInnerGeo, metalAccent);
      pin.position.set(jx, -0.34, backZ - 0.015);
      cabinet.add(pin);
    }

    // Thick rubber power cord curving down from rear onto the desk
    const cordCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.55, -0.62, backZ + 0.04),
      new THREE.Vector3(-0.62, -0.82, backZ - 0.32),
      new THREE.Vector3(-0.88, -bodyY + 0.04, backZ - 0.58),
      new THREE.Vector3(-1.45, -bodyY + 0.035, backZ - 1.25),
      new THREE.Vector3(-2.3, -bodyY + 0.035, backZ - 2.3),
    ]);
    const cordMesh = new THREE.Mesh(
      new THREE.TubeGeometry(cordCurve, 28, 0.036, 10, false),
      rubberMat,
    );
    cordMesh.castShadow = true;
    cabinet.add(cordMesh);

    // 9. Four molded rubber feet under the cabinet
    const footGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.12, 16);
    const footCoords: [number, number][] = [
      [-W / 2 + 0.42, frontDepth / 2 - 0.36],
      [W / 2 - 0.42, frontDepth / 2 - 0.36],
      [-W / 2 + 0.46, -frontDepth / 2 + 0.36],
      [W / 2 - 0.46, -frontDepth / 2 + 0.36],
    ];
    for (const [fx, fz] of footCoords) {
      const foot = new THREE.Mesh(footGeo, rubberMat);
      foot.position.set(fx, 0.06, fz);
      foot.castShadow = true;
      foot.receiveShadow = true;
      this.root.add(foot);
    }

    // 10. Dynamic CRT ambient bounce light (casts C64 screen color onto desk & bezel!)
    this.screenGlowLight = new THREE.PointLight(0x5258d8, 2.2, 8.5, 1.7);
    this.screenGlowLight.position.set(0, bodyY + screenCenterY, faceZ + 1.15);
    this.root.add(this.screenGlowLight);
  }

  togglePower(): boolean {
    this.powered = !this.powered;
    if (this.powered) {
      this.degaussAnim = 1.0;
      this.powerOffFlash = 0.0;
    } else {
      this.powerOffFlash = 1.0;
    }
    return this.powered;
  }

  toggleHatch(): boolean {
    this.hatchOpen = !this.hatchOpen;
    return this.hatchOpen;
  }

  adjustKnob(name: keyof MonitorKnobs, delta: number) {
    this.knobs[name] = Math.max(0, Math.min(1, this.knobs[name] + delta));
    this.syncKnobRotations();
    this.syncShaderKnobs();
  }

  private syncKnobRotations() {
    for (const key of Object.keys(this.knobs) as (keyof MonitorKnobs)[]) {
      // -135 deg .. +135 deg
      this.knobMeshes[key].rotation.z = -(this.knobs[key] - 0.5) * Math.PI * 1.5;
    }
  }

  private syncShaderKnobs() {
    const u = this.crtMaterial.uniforms;
    u.uColor.value = this.knobs.color;
    u.uTint.value = this.knobs.tint;
    u.uBright.value = this.knobs.bright;
    u.uContrast.value = this.knobs.contrast;
  }

  markScreenDirty() {
    this.screenTexture.needsUpdate = true;
  }

  update(dt: number, elapsed: number, glowRgb: [number, number, number]) {
    // Smooth CRT filament warm-up / power-off collapse
    if (this.powered) {
      this.powerAnim = Math.min(1, this.powerAnim + dt * 1.45);
      this.powerOffFlash = Math.max(0, this.powerOffFlash - dt * 2.5);
    } else {
      this.powerAnim = Math.max(0, this.powerAnim - dt * 4.2);
      this.powerOffFlash = Math.max(0, this.powerOffFlash - dt * 1.35);
    }

    if (this.degaussAnim > 0) {
      this.degaussAnim = Math.max(0, this.degaussAnim - dt * 1.3);
    }

    // Physical power button push animation
    const targetDepth = this.powered ? 1.0 : 0.0;
    this.buttonDepth += (targetDepth - this.buttonDepth) * Math.min(1, dt * 18);
    this.powerButton.position.z = 2.15 / 2 + 0.032 + 0.015 + 0.072 - this.buttonDepth * 0.028;

    // Flip-down control door animation
    const targetAngle = this.hatchOpen ? Math.PI * 0.56 : 0.0;
    this.hatchAngle += (targetAngle - this.hatchAngle) * Math.min(1, dt * 12);
    this.hatchPivot.rotation.x = this.hatchAngle;

    // Green power LED glow
    const ledStrength = this.powered ? 1.0 : 0.0;
    this.ledMaterial.emissiveIntensity = 0.05 + ledStrength * 2.4;
    this.ledLight.intensity = ledStrength * 0.22;

    // CRT shader uniforms
    const u = this.crtMaterial.uniforms;
    u.uTime.value = elapsed;
    u.uPower.value = this.powerAnim;
    u.uOffFlash.value = this.powerOffFlash;
    u.uDegauss.value = this.degaussAnim;

    // Dynamic ambient screen bounce light tinted by live C64 screen colors
    const glowGain = this.powerAnim * (0.75 + this.knobs.bright * 0.65);
    this.screenGlowLight.color.setRGB(
      Math.max(0.08, glowRgb[0]),
      Math.max(0.08, glowRgb[1]),
      Math.max(0.10, glowRgb[2]),
    );
    this.screenGlowLight.intensity = glowGain * 2.5;
  }
}

// ---- Geometry & procedural texture helpers ----

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

function makeCurvedCrtGeometry(
  width: number,
  height: number,
  segX: number,
  segY: number,
  bulge: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / (width * 0.5);
    const ny = y / (height * 0.5);
    // Pillowed 4:3 CRT glass bulge (paraboloid with slightly steeper corners)
    const r2 = nx * nx * 0.85 + ny * ny * 0.85;
    const z = bulge * Math.max(0, 1.0 - r2 * 0.58 - (nx * nx * ny * ny) * 0.14);
    pos.setZ(i, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeTaperedBackGeometry(
  frontW: number,
  frontH: number,
  backW: number,
  backH: number,
  depth: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, depth, 2, 2, 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // t = 0 at front (+depth/2), t = 1 at back (-depth/2)
    const t = Math.max(0, Math.min(1, 0.5 - z / depth));
    const ease = t * t * (3 - 2 * t);
    const w = THREE.MathUtils.lerp(frontW, backW, ease);
    const h = THREE.MathUtils.lerp(frontH, backH, ease);
    pos.setX(i, x * w);
    pos.setY(i, y * h);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeCrtShaderMaterial(screenTex: THREE.CanvasTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScreen: { value: screenTex },
      uTime: { value: 0 },
      uPower: { value: 0 },
      uOffFlash: { value: 0 },
      uDegauss: { value: 0 },
      uColor: { value: 0.52 },
      uTint: { value: 0.5 },
      uBright: { value: 0.52 },
      uContrast: { value: 0.54 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;

      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPos.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScreen;
      uniform float uTime;
      uniform float uPower;
      uniform float uOffFlash;
      uniform float uDegauss;
      uniform float uColor;
      uniform float uTint;
      uniform float uBright;
      uniform float uContrast;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;

      // Subtle CRT barrel warp with authentic slight overscan so the raster tucks cleanly behind the rounded bezel
      vec2 barrelUv(vec2 uv) {
        vec2 c = (uv * 2.0 - 1.0) * 0.94;
        vec2 off = c.yx * 0.14;
        c += c * off * off;
        return c * 0.5 + 0.5;
      }

      // Crisp sub-pixel texel interpolation (sharp pixels without harsh shimmering)
      vec3 sampleC64(vec2 uv) {
        vec2 res = vec2(384.0, 272.0);
        vec2 p = uv * res;
        vec2 f = fract(p);
        vec2 i = floor(p);
        // Smoothstep with narrow transition gives authentic CRT horizontal softness
        vec2 w = smoothstep(0.18, 0.82, f);
        vec2 suv = (i + w + 0.5) / res;
        // Slight composite chroma softness horizontally
        vec3 c0 = texture2D(uScreen, suv).rgb;
        vec3 cL = texture2D(uScreen, suv - vec2(0.55 / res.x, 0.0)).rgb;
        vec3 cR = texture2D(uScreen, suv + vec2(0.55 / res.x, 0.0)).rgb;
        return c0 * 0.72 + (cL + cR) * 0.14;
      }

      vec3 hueShift(vec3 col, float angle) {
        const vec3 k = vec3(0.57735, 0.57735, 0.57735);
        float c = cos(angle);
        return col * c + cross(k, col) * sin(angle) + k * dot(k, col) * (1.0 - c);
      }

      void main() {
        vec2 uv = barrelUv(vUv);

        // Subtle degauss wave on power-on
        if (uDegauss > 0.001) {
          float wave = sin(uv.y * 18.0 - uTime * 28.0) * 0.009 * uDegauss * uDegauss;
          uv.x += wave;
        }

        // Base unpowered dark CRT glass color (classic greenish-charcoal phosphor)
        vec3 glassBase = vec3(0.036, 0.044, 0.042);

        vec3 col = glassBase;
        float inBounds = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

        if (uPower > 0.002 && inBounds > 0.5) {
          // Warm-up raster vertical expansion
          float rasterOpen = smoothstep(0.0, 0.45, uPower);
          vec2 ruv = uv;
          ruv.y = (ruv.y - 0.5) / max(0.02, rasterOpen) + 0.5;
          float rasterMask = step(0.0, ruv.y) * step(ruv.y, 1.0);

          vec3 raw = sampleC64(clamp(ruv, 0.0, 1.0));

          // Soft 4-tap phosphor bloom / halation
          vec2 bOff = vec2(2.2 / 384.0, 2.2 / 272.0);
          vec3 bloom = (
            texture2D(uScreen, clamp(ruv + vec2(bOff.x, 0.0), 0.0, 1.0)).rgb +
            texture2D(uScreen, clamp(ruv - vec2(bOff.x, 0.0), 0.0, 1.0)).rgb +
            texture2D(uScreen, clamp(ruv + vec2(0.0, bOff.y), 0.0, 1.0)).rgb +
            texture2D(uScreen, clamp(ruv - vec2(0.0, bOff.y), 0.0, 1.0)).rgb
          ) * 0.25;

          vec3 phosphor = raw + bloom * 0.16;

          // Subtle horizontal scanlines (272 lines)
          float scan = sin(ruv.y * 272.0 * 3.14159265) * 0.5 + 0.5;
          float scanMul = mix(0.84, 1.06, pow(scan, 0.7));
          phosphor *= scanMul;

          // Very fine vertical phosphor triad shimmer
          float triad = sin(ruv.x * 384.0 * 3.14159265 * 2.0) * 0.5 + 0.5;
          phosphor *= mix(0.95, 1.03, triad);

          // Front-panel Color / Tint / Brightness / Contrast controls
          float luma = dot(phosphor, vec3(0.299, 0.587, 0.114));
          float sat = uColor * 2.0; // 0..2
          phosphor = mix(vec3(luma), phosphor, sat);
          phosphor = hueShift(phosphor, (uTint - 0.5) * 1.1);
          float contrast = 0.55 + uContrast * 1.05;
          float bright = (uBright - 0.5) * 0.45;
          phosphor = (phosphor - 0.5) * contrast + 0.5 + bright;
          phosphor = max(vec3(0.0), phosphor);

          // Filament brightness fade-in + subtle 50Hz breathing
          float filament = smoothstep(0.08, 0.85, uPower);
          float flicker = 0.992 + 0.008 * sin(uTime * 37.0);
          col = mix(glassBase, phosphor * 1.12 * flicker, filament * rasterMask);
        }

        // Authentic CRT power-off beam collapse (horizontal white line -> glowing center dot)
        if (uOffFlash > 0.002) {
          vec2 c = vUv - 0.5;
          float linePhase = smoothstep(0.42, 1.0, uOffFlash);
          float halfW = mix(0.015, 0.48, linePhase);
          float halfH = mix(0.004, 0.014, linePhase);
          float lineGlow = exp(-(c.y * c.y) / (halfH * halfH)) * smoothstep(halfW + 0.04, halfW * 0.4, abs(c.x));
          float dotGlow = exp(-(c.x * c.x + c.y * c.y) / 0.0014) * uOffFlash;
          vec3 flashCol = vec3(0.88, 0.94, 1.0) * (lineGlow * linePhase * 2.2 + dotGlow * 1.8);
          col += flashCol;
        }

        // Bezel edge shadow & curved CRT corner vignette
        vec2 edge = abs(vUv * 2.0 - 1.0);
        float cornerVig = smoothstep(1.38, 0.92, length(edge));
        float borderShadow = smoothstep(1.0, 0.92, max(edge.x, edge.y));
        col *= mix(0.62, 1.0, cornerVig * borderShadow);

        // Convex CRT glass specular Fresnel reflection (soft studio window glow)
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);
        vec3 R = reflect(-V, N);
        // Subtle soft warm room reflection from upper-left window + cool rim
        float winRefl = smoothstep(0.42, 0.85, dot(R, normalize(vec3(-0.35, 0.55, 0.75))));
        float rimRefl = smoothstep(0.15, 0.8, R.y) * 0.14;
        vec3 glassSpec = vec3(0.85, 0.88, 0.95) * (fresnel * 0.24 + winRefl * 0.095 + rimRefl * 0.06);

        gl_FragColor = vec4(col + glassSpec, 1.0);
      }
    `,
  });
}

function makePlasticGrainTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 115 + Math.floor(Math.random() * 28);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

function makeCommodoreBadgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;

  // Dark anodized brushed panel
  ctx.fillStyle = '#1e1c1a';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, y, c.width, 1);
  }

  // Iconic Commodore C= chicken-lips logo
  const cx = 62;
  const cy = 66;
  const outerR = 32;
  const innerR = 17;

  // Blue outer C arc
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0.42, Math.PI * 2 - 0.42);
  ctx.arc(cx, cy, innerR, Math.PI * 2 - 0.56, 0.56, true);
  ctx.closePath();
  ctx.fillStyle = '#3d63b8';
  ctx.fill();

  // Top blue flag
  ctx.beginPath();
  ctx.moveTo(cx + 12, cy - 16);
  ctx.lineTo(cx + 42, cy - 16);
  ctx.lineTo(cx + 31, cy - 3);
  ctx.lineTo(cx + 12, cy - 3);
  ctx.closePath();
  ctx.fillStyle = '#3d63b8';
  ctx.fill();

  // Bottom red flag
  ctx.beginPath();
  ctx.moveTo(cx + 12, cy + 3);
  ctx.lineTo(cx + 31, cy + 3);
  ctx.lineTo(cx + 42, cy + 16);
  ctx.lineTo(cx + 12, cy + 16);
  ctx.closePath();
  ctx.fillStyle = '#c83e36';
  ctx.fill();
  ctx.restore();

  // "commodore" wordmark
  ctx.fillStyle = '#e8e3d8';
  ctx.font = '700 44px "IBM Plex Sans", Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('commodore', 118, 66);

  // Subtle model subtitle
  ctx.fillStyle = '#9d9688';
  ctx.font = '600 17px Inter, sans-serif';
  ctx.fillText('COLOR VIDEO MONITOR   1702', 32, 126);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeControlLabelsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 196;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1917';
  ctx.fillRect(0, 0, c.width, c.height);

  const labels = ['COLOR', 'TINT', 'BRIGHT', 'CONTR'];
  ctx.fillStyle = '#bdb6a8';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < labels.length; i++) {
    const x = 82 + i * 116;
    ctx.fillText(labels[i], x, 162);
    // Tiny dial ticks around knob socket
    ctx.strokeStyle = 'rgba(210, 202, 188, 0.35)';
    ctx.lineWidth = 2;
    for (let t = -3; t <= 3; t++) {
      const a = -Math.PI / 2 + t * 0.42;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 34, 82 + Math.sin(a) * 34);
      ctx.lineTo(x + Math.cos(a) * 42, 82 + Math.sin(a) * 42);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePowerLabelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#b9b2a4';
  ctx.font = '600 26px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POWER', 96, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRearSpecTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 224;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1a18';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#8b8476';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);

  ctx.fillStyle = '#ded8cb';
  ctx.font = '700 28px "IBM Plex Sans", sans-serif';
  ctx.fillText('COMMODORE MODEL 1702', 28, 52);

  ctx.fillStyle = '#a7a092';
  ctx.font = '600 18px Inter, sans-serif';
  ctx.fillText('COLOR VIDEO MONITOR · NTSC / PAL', 28, 90);
  ctx.fillText('AC 220V ~ 50/60Hz   65W   FUSE 1.6A', 28, 124);
  ctx.fillText('CAUTION: HIGH VOLTAGE INSIDE', 28, 158);
  ctx.fillText('SERIAL NO.  1702-83-004192   MADE IN JAPAN', 28, 192);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
