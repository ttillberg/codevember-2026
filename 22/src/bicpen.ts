import * as THREE from 'three';

const BIC_COLORS = [
  { name: 'blue', hex: 0x1e53b8 },
  { name: 'red', hex: 0xc92a26 },
  { name: 'green', hex: 0x268b44 },
  { name: 'black', hex: 0x1b1a19 },
] as const;

/**
 * The iconic BIC 4-Couleurs Original ballpoint pen resting beside the cheat sheet:
 * sky-blue lower barrel tapering smoothly into a rounded blue bullet nose, thin black
 * center band, white upper barrel with four colored click sliders, curved white clip,
 * and signature little white ball at the top. Clicking cycles the four colors!
 */
export class Bic4ColorPen {
  readonly root = new THREE.Group();
  readonly hitMesh: THREE.Mesh;

  private readonly sliders: THREE.Group[] = [];
  private readonly sliderAnim = [1, 0, 0, 0]; // 1 = clicked down, 0 = up
  private readonly nibMat: THREE.MeshStandardMaterial;
  private readonly nibMesh: THREE.Mesh;

  activeIndex = 0; // starts on Blue
  private hovered = false;
  private hoverLift = 0;
  private readonly baseY = 0.056;

  constructor() {
    // Pen lies along local +X axis (bullet tip at -X, white ball at +X), total length ~1.48 units
    const pen = new THREE.Group();
    this.root.add(pen);

    const bicBlueMat = new THREE.MeshStandardMaterial({
      color: 0x3b7bc2, // authentic glossy BIC 4-Couleurs sky blue
      roughness: 0.22,
      metalness: 0.05,
    });
    const bicWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf2efe8,
      roughness: 0.24,
      metalness: 0.04,
    });
    const blackRingMat = new THREE.MeshStandardMaterial({
      color: 0x171616,
      roughness: 0.38,
      metalness: 0.1,
    });
    const brassTipMat = new THREE.MeshStandardMaterial({
      color: 0xd4c082,
      roughness: 0.25,
      metalness: 0.85,
    });

    const R = 0.055;

    // 1. Sky-blue lower barrel + smooth rounded bullet nose (LatheGeometry, outward normals!)
    // Lathe rotates around Y; we rotateZ(-PI/2) so +Y becomes +X and -Y becomes -X (tip).
    const lowerPts = [
      new THREE.Vector2(0.011, -0.74), // tip opening
      new THREE.Vector2(0.022, -0.72),
      new THREE.Vector2(0.036, -0.67),
      new THREE.Vector2(0.046, -0.58),
      new THREE.Vector2(R * 0.94, -0.42),
      new THREE.Vector2(R * 1.0, 0.06), // meets black center band
    ];
    const lowerGeo = new THREE.LatheGeometry(lowerPts, 28);
    lowerGeo.rotateZ(-Math.PI / 2);
    const lowerBarrel = new THREE.Mesh(lowerGeo, bicBlueMat);
    lowerBarrel.castShadow = true;
    lowerBarrel.receiveShadow = true;
    pen.add(lowerBarrel);

    // Extending fine brass/colored ballpoint nib peeking out of the blue bullet nose
    this.nibMat = new THREE.MeshStandardMaterial({
      color: BIC_COLORS[0].hex,
      roughness: 0.35,
      metalness: 0.45,
    });
    const nibTip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.010, 0.042, 10), brassTipMat);
    nibTip.rotation.z = Math.PI / 2;
    const nibInk = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 8), this.nibMat);
    nibInk.position.x = -0.022;
    this.nibMesh = new THREE.Mesh();
    this.nibMesh.add(nibTip, nibInk);
    this.nibMesh.position.x = -0.755;
    pen.add(this.nibMesh);

    // 2. Signature thin dark-black separation ring between blue lower & white upper barrels
    const ringGeo = new THREE.CylinderGeometry(R * 1.005, R * 1.005, 0.024, 24);
    ringGeo.rotateZ(Math.PI / 2);
    const centerRing = new THREE.Mesh(ringGeo, blackRingMat);
    centerRing.position.x = 0.072;
    pen.add(centerRing);

    // 3. Glossy white upper barrel (x: +0.084 .. +0.635, gentle taper toward crown)
    const upperPts = [
      new THREE.Vector2(R * 1.0, 0.084),
      new THREE.Vector2(R * 0.98, 0.42),
      new THREE.Vector2(R * 0.88, 0.62),
      new THREE.Vector2(R * 0.62, 0.665),
      new THREE.Vector2(0.018, 0.675),
    ];
    const upperGeo = new THREE.LatheGeometry(upperPts, 28);
    upperGeo.rotateZ(-Math.PI / 2);
    const upperBarrel = new THREE.Mesh(upperGeo, bicWhiteMat);
    upperBarrel.castShadow = true;
    upperBarrel.receiveShadow = true;
    pen.add(upperBarrel);

    // 4. Iconic little white lanyard ball perched on a tiny neck at the top!
    const neckGeo = new THREE.CylinderGeometry(0.013, 0.017, 0.036, 12);
    neckGeo.rotateZ(Math.PI / 2);
    const neck = new THREE.Mesh(neckGeo, bicWhiteMat);
    neck.position.x = 0.688;
    pen.add(neck);

    const topBall = new THREE.Mesh(new THREE.SphereGeometry(0.029, 16, 12), bicWhiteMat);
    topBall.position.x = 0.722;
    topBall.castShadow = true;
    pen.add(topBall);

    // 5. Sleek molded white pocket clip curving smoothly out of the white upper crown
    const clipShape = new THREE.Shape();
    clipShape.moveTo(0.62, R * 0.78);
    clipShape.quadraticCurveTo(0.42, R + 0.058, 0.14, R + 0.042);
    clipShape.lineTo(0.11, R + 0.015);
    clipShape.lineTo(0.17, R + 0.015);
    clipShape.quadraticCurveTo(0.40, R + 0.025, 0.54, R * 0.88);
    clipShape.closePath();
    const clipGeo = new THREE.ExtrudeGeometry(clipShape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelSize: 0.003,
      bevelThickness: 0.003,
      bevelSegments: 2,
    });
    clipGeo.translate(0, 0, -0.016);
    const clip = new THREE.Mesh(clipGeo, bicWhiteMat);
    clip.rotation.x = Math.PI * 0.58; // angles cleanly along the side
    clip.castShadow = true;
    pen.add(clip);

    // 6. Four sleek colored click sliders nested in the white upper barrel!
    const angles = [0.55, -0.55, Math.PI - 0.55, Math.PI + 0.55];
    for (let i = 0; i < BIC_COLORS.length; i++) {
      const slotGroup = new THREE.Group();
      slotGroup.rotation.x = angles[i];
      pen.add(slotGroup);

      const sliderPivot = new THREE.Group();
      const tabMat = new THREE.MeshStandardMaterial({
        color: BIC_COLORS[i].hex,
        roughness: 0.28,
        metalness: 0.05,
      });

      // Sleek elongated curved thumb slider (matches real BIC 4-Couleurs sliders)
      const tab = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.14, 6, 12), tabMat);
      tab.rotation.z = Math.PI / 2;
      tab.position.set(0, R * 0.90, 0);
      tab.castShadow = true;
      sliderPivot.add(tab);

      // Subtle raised rear thumb catch
      const catchLip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.028, 0.026), tabMat);
      catchLip.position.set(0.068, R * 0.96, 0);
      sliderPivot.add(catchLip);

      slotGroup.add(sliderPivot);
      this.sliders.push(sliderPivot);
    }

    // Forgiving hitbox wrapping the pen for effortless clicking
    const hitGeo = new THREE.BoxGeometry(1.64, 0.24, 0.28);
    this.hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    this.hitMesh.userData.hit = { kind: 'pen' };
    pen.add(this.hitMesh);

    // Rest casually on the desk right beside the BASIC CHEAT SHEET paper
    this.root.position.set(-2.22, this.baseY, 1.24);
    this.root.rotation.y = 0.45;
  }

  clickNextColor(): string {
    this.activeIndex = (this.activeIndex + 1) % BIC_COLORS.length;
    this.nibMat.color.setHex(BIC_COLORS[this.activeIndex].hex);
    return BIC_COLORS[this.activeIndex].name;
  }

  setHovered(on: boolean) {
    this.hovered = on;
  }

  update(dt: number) {
    const targetHover = this.hovered ? 1 : 0;
    this.hoverLift += (targetHover - this.hoverLift) * Math.min(1, dt * 14);
    this.root.position.y = this.baseY + this.hoverLift * 0.028;

    let nibPop = 0;
    for (let i = 0; i < this.sliders.length; i++) {
      const target = i === this.activeIndex ? 1 : 0;
      this.sliderAnim[i] += (target - this.sliderAnim[i]) * Math.min(1, dt * 24);
      // Up position near top crown: x = 0.56, Clicked down: x = 0.455
      this.sliders[i].position.x = 0.56 - this.sliderAnim[i] * 0.105;
      if (i === this.activeIndex) nibPop = this.sliderAnim[i];
    }

    this.nibMesh.position.x = -0.735 - nibPop * 0.028;
  }
}
