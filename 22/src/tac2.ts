import * as THREE from 'three';

/**
 * Authentic Suncom TAC-2 ("Totally Accurate Controller") joystick modeled closely
 * from the real hardware:
 * - Rounded matte-satin pebble-grained black casing with mid-height parting seam
 * - Brushed-silver metallic top plate rising into a flared volcano collar cone
 * - Iconic 8 black-and-red radial T-arrow directional markings around the cone
 * - Twin concave vermilion-orange corner fire buttons in recessed black bezels
 * - Chunky matte-black shaft topped with a large high-gloss jet-black ball-top
 */
export class Tac2Joystick {
  readonly root = new THREE.Group();
  readonly interactiveMeshes: THREE.Object3D[] = [];
  readonly cableEntryWorld = new THREE.Vector3();

  private readonly stickPivot = new THREE.Group();
  private readonly leftBtn: THREE.Mesh;
  private readonly rightBtn: THREE.Mesh;
  private readonly btnRestY: number;

  private targetTiltX = 0;
  private targetTiltZ = 0;
  private tiltX = 0;
  private tiltZ = 0;
  private fireAnim = 0;
  private fireHeld = false;
  private pulseTimer = 0;

  constructor() {
    const pebbleBump = makePebbleBumpTex();

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x171718,
      roughness: 0.44,
      metalness: 0.08,
      bumpMap: pebbleBump,
      bumpScale: 0.0028,
    });
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0x0b0b0c,
      roughness: 0.85,
    });
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x1b1b1c,
      roughness: 0.42,
      metalness: 0.14,
    });
    const ballMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0d0e,
      roughness: 0.14,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
    });
    const orangeBtnMat = new THREE.MeshStandardMaterial({
      color: 0xea4424, // authentic vibrant Suncom TAC-2 vermilion-orange fire buttons!
      roughness: 0.28,
      metalness: 0.04,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x131314,
      roughness: 0.78,
    });

    const joy = new THREE.Group();
    this.root.add(joy);

    // 1. Generously rounded black TAC-2 casing (~10.8 cm x 11.0 cm x 3.5 cm)
    const W = 1.08;
    const D = 1.10;
    const H = 0.34;
    const bevel = 0.068;

    const baseShape = roundedRectShape(W - bevel * 2, D - bevel * 2, 0.18);
    const baseGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: H - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 6,
      curveSegments: 16,
    });
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.translate(0, bevel, 0);
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    baseMesh.userData.hit = { kind: 'joystick' };
    joy.add(baseMesh);
    this.interactiveMeshes.push(baseMesh);

    // Crisp horizontal shell parting seam around the lower waist of the TAC-2
    const seamShape = roundedRectShape(W + 0.008, D + 0.008, 0.22);
    const seamGeo = new THREE.ExtrudeGeometry(seamShape, {
      depth: 0.012,
      bevelEnabled: false,
      curveSegments: 14,
    });
    seamGeo.rotateX(-Math.PI / 2);
    seamGeo.translate(0, 0.135, 0);
    const seamMesh = new THREE.Mesh(seamGeo, seamMat);
    joy.add(seamMesh);

    // 2. Inset brushed-silver metallic faceplate on top
    const plateW = 0.74;
    const plateD = 0.76;
    const plateShape = roundedRectShape(plateW, plateD, 0.065);
    const plateGeo = new THREE.ShapeGeometry(plateShape, 12);
    plateGeo.rotateX(-Math.PI / 2);
    // Normalize ShapeGeometry UVs cleanly into 0..1
    const pPos = plateGeo.attributes.position;
    const pUv = plateGeo.attributes.uv;
    for (let i = 0; i < pPos.count; i++) {
      pUv.setXY(i, pPos.getX(i) / plateW + 0.5, 0.5 - pPos.getZ(i) / plateD);
    }

    const plateMat = new THREE.MeshStandardMaterial({
      map: makeTac2BasePlateTexture(),
      roughness: 0.30,
      metalness: 0.74,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, H + 0.003, 0.01);
    plate.receiveShadow = true;
    joy.add(plate);

    // 3. Signature raised brushed-silver volcano collar cone with 8 black-and-red T-markings!
    const conePts = [
      new THREE.Vector2(0.285, 0.0),
      new THREE.Vector2(0.235, 0.022),
      new THREE.Vector2(0.182, 0.068),
      new THREE.Vector2(0.145, 0.125),
      new THREE.Vector2(0.124, 0.155),
    ];
    const coneGeo = new THREE.LatheGeometry(conePts, 48);
    const coneMat = new THREE.MeshStandardMaterial({
      map: makeTac2ConeTexture(),
      roughness: 0.28,
      metalness: 0.72,
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.position.set(0, H + 0.002, 0.03);
    coneMesh.castShadow = true;
    coneMesh.receiveShadow = true;
    joy.add(coneMesh);

    // Black recessed top cup collar inside the volcano peak
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.020, 12, 28), rubberMat);
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.set(0, H + 0.155, 0.03);
    joy.add(cupRim);

    const cupWell = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.088, 0.04, 24), seamMat);
    cupWell.position.set(0, H + 0.135, 0.03);
    joy.add(cupWell);

    // 4. Twin concave vermilion-orange circular fire buttons in recessed black bezels!
    const bezelGeo = new THREE.CylinderGeometry(0.132, 0.140, 0.026, 28);
    // Concave top-dished LatheGeometry for realistic pressed-thumb fire buttons
    const btnPts = [
      new THREE.Vector2(0.112, 0.0),
      new THREE.Vector2(0.112, 0.036),
      new THREE.Vector2(0.104, 0.056),
      new THREE.Vector2(0.086, 0.064),
      new THREE.Vector2(0.048, 0.057),
      new THREE.Vector2(0.0, 0.053),
    ];
    const btnCapGeo = new THREE.LatheGeometry(btnPts, 28);

    this.btnRestY = H + 0.004;
    const makeFireBtn = (bx: number, bz: number) => {
      const bezel = new THREE.Mesh(bezelGeo, rubberMat);
      bezel.position.set(bx, H + 0.008, bz);
      joy.add(bezel);

      const btn = new THREE.Mesh(btnCapGeo, orangeBtnMat);
      btn.position.set(bx, this.btnRestY, bz);
      btn.castShadow = true;
      btn.receiveShadow = true;
      btn.userData.hit = { kind: 'joystick-fire' };
      joy.add(btn);
      this.interactiveMeshes.push(btn);
      return btn;
    };

    // Classic TAC-2 upper-left & upper-right corner fire buttons
    this.leftBtn = makeFireBtn(-0.33, -0.32);
    this.rightBtn = makeFireBtn(0.33, -0.32);

    // 5. Pivoting chunky matte-black straight shaft + large high-gloss jet-black ball-top!
    this.stickPivot.position.set(0, H + 0.06, 0.03);
    joy.add(this.stickPivot);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.44, 22), shaftMat);
    shaft.position.y = 0.24;
    shaft.castShadow = true;
    shaft.userData.hit = { kind: 'joystick' };
    this.stickPivot.add(shaft);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.215, 36, 28), ballMat);
    ball.position.y = 0.62;
    ball.castShadow = true;
    ball.receiveShadow = true;
    ball.userData.hit = { kind: 'joystick' };
    this.stickPivot.add(ball);
    this.interactiveMeshes.push(shaft, ball);

    // 6. Molded ribbed rubber cable strain-relief exiting the back edge (-Z)
    const grommet = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.044, 0.14, 14), rubberMat);
    grommet.rotation.x = Math.PI / 2;
    grommet.position.set(0, 0.15, -D / 2 - 0.04);
    joy.add(grommet);

    // Subtle embossed "SUNCOM" oval plaque on front black rim
    const suncomPlaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.065),
      new THREE.MeshStandardMaterial({
        map: makeSuncomEmbossedTex(),
        roughness: 0.48,
        metalness: 0.1,
        transparent: true,
      }),
    );
    suncomPlaque.rotation.x = -Math.PI / 2;
    suncomPlaque.position.set(0, H + 0.004, 0.455);
    joy.add(suncomPlaque);

    // Place on the right side of the desk right beside the C64C and in front of the 1541 drive
    this.root.position.set(2.74, 0, 2.52);
    this.root.rotation.y = -0.18;

    this.root.updateMatrixWorld(true);
    this.cableEntryWorld.set(0, 0.15, -D / 2 - 0.10).applyMatrix4(this.root.matrixWorld);
  }

  /** Trigger a short physical stick tilt from keyboard input (e.g. A/D/Arrows or click). */
  nudge(dx: number, dz: number, holdSeconds = 0.16) {
    this.targetTiltZ = -dx * 0.34;
    this.targetTiltX = dz * 0.34;
    this.pulseTimer = holdSeconds;
  }

  pressFire(hold = false) {
    this.fireAnim = 1.0;
    this.fireHeld = hold;
  }

  releaseFire() {
    this.fireHeld = false;
  }

  update(dt: number) {
    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      if (this.pulseTimer <= 0) {
        this.targetTiltX = 0;
        this.targetTiltZ = 0;
      }
    }

    const k = Math.min(1, dt * 22);
    this.tiltX += (this.targetTiltX - this.tiltX) * k;
    this.tiltZ += (this.targetTiltZ - this.tiltZ) * k;
    this.stickPivot.rotation.x = this.tiltX;
    this.stickPivot.rotation.z = this.tiltZ;

    if (!this.fireHeld) {
      this.fireAnim = Math.max(0, this.fireAnim - dt * 9.5);
    }
    const btnY = this.btnRestY - this.fireAnim * 0.026;
    this.leftBtn.position.y = btnY;
    this.rightBtn.position.y = btnY;
  }
}

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

function makeBrushedMetalBase(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#c8c6c1');
  grad.addColorStop(0.35, '#dfddd8');
  grad.addColorStop(0.65, '#b8b6b0');
  grad.addColorStop(1, '#cfcdc7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Fine brushed aluminum grain lines
  for (let y = 0; y < h; y += 2) {
    const a = 0.02 + Math.random() * 0.045;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(30,30,32,${a})`;
    ctx.fillRect(0, y, w, 1);
  }
}

function makeTac2BasePlateTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  makeBrushedMetalBase(ctx, S, S);

  // Subtle metallic bevel edge border
  ctx.strokeStyle = 'rgba(40, 40, 42, 0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, S - 6, S - 6);

  // Signature curved orange-red & black segmented arc marks flanking the top corners
  const drawArcDashes = (side: number) => {
    ctx.save();
    ctx.translate(S / 2, S * 0.52);
    for (let i = 0; i < 4; i++) {
      const ang = side < 0 ? -Math.PI * 0.80 + i * 0.08 : -Math.PI * 0.20 - i * 0.08;
      const r = 192;
      ctx.save();
      ctx.rotate(ang);
      ctx.fillStyle = '#19191a';
      ctx.fillRect(r - 8, -11, 16, 22);
      ctx.fillStyle = '#e84324';
      ctx.fillRect(r - 4, -8, 8, 16);
      ctx.restore();
    }
    ctx.restore();
  };
  drawArcDashes(-1);
  drawArcDashes(1);

  // Bottom brushed-black "TAC-2 / Totally Accurate Controller" logo printed on silver plate
  ctx.fillStyle = '#181819';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 700 44px "IBM Plex Sans", sans-serif';
  ctx.fillText('TAC-2', S / 2, S - 66);

  ctx.fillStyle = '#363638';
  ctx.font = 'italic 600 17px Inter, sans-serif';
  ctx.fillText('Totally Accurate Controller', S / 2, S - 32);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generates the wrap-around radial texture for the TAC-2 flared silver volcano collar,
 * featuring the 8 iconic black "T" compass markings with bright vermilion-red center bars!
 */
function makeTac2ConeTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  makeBrushedMetalBase(ctx, W, H);

  // Dark brushed band near the top lip of the cone
  ctx.fillStyle = 'rgba(20, 20, 22, 0.14)';
  ctx.fillRect(0, 0, W, 28);

  // 8 bold radial black "T" shapes with bright red vertical center stripes (exact TAC-2 motif!)
  const count = 8;
  const step = W / count;
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) * step;
    // Wide black horizontal crossbar near bottom of cone skirt
    ctx.fillStyle = '#161617';
    ctx.fillRect(cx - 38, H * 0.58, 76, 32);
    // Vertical black stem rising up the cone
    ctx.fillRect(cx - 18, H * 0.24, 36, H * 0.48);
    // Iconic vibrant vermilion-red center stripe inside each T!
    ctx.fillStyle = '#ea4222';
    ctx.fillRect(cx - 7, H * 0.26, 14, H * 0.42);
    ctx.fillRect(cx - 14, H * 0.64, 28, 10);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeSuncomEmbossedTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(6, 8, 244, 48, 22);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = '700 26px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SUNCOM', 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePebbleBumpTex(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 105 + Math.floor(Math.random() * 44);
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
