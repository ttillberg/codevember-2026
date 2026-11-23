import * as THREE from 'three';
import type { DiskActivityState } from './c64/basic';

/**
 * A 3D Commodore 1541 5.25" floppy disk drive resting beside the 1702 monitor.
 * Features a glowing green POWER LED, active/blinking red DRIVE LED, clickable
 * drive latch + ejecting 5.25" "GAMES DISK '84" floppy disk.
 */
export class Commodore1541 {
  readonly root = new THREE.Group();
  readonly interactiveMeshes: THREE.Object3D[] = [];

  private readonly leverPivot = new THREE.Group();
  private readonly floppyGroup = new THREE.Group();
  private readonly driveLedMat: THREE.MeshStandardMaterial;
  private readonly driveLedLight: THREE.PointLight;

  diskInserted = true;
  private activity: DiskActivityState = 'idle';
  private insertAnim = 1.0; // 1 = inserted & latched, 0 = ejected & open
  private ledTimer = 0;

  constructor() {
    const W = 2.02;
    const H = 0.98;
    const D = 3.15;
    const bodyY = H / 2 + 0.06;

    const grainTex = makeGrainTex();
    const plasticMain = new THREE.MeshStandardMaterial({
      color: 0xa79c89,
      roughness: 0.62,
      metalness: 0.04,
      bumpMap: grainTex,
      bumpScale: 0.004,
    });
    const plasticDark = new THREE.MeshStandardMaterial({
      color: 0x26221f,
      roughness: 0.52,
      metalness: 0.08,
      bumpMap: grainTex,
      bumpScale: 0.002,
    });
    const plasticRecess = new THREE.MeshStandardMaterial({
      color: 0x141210,
      roughness: 0.8,
      metalness: 0.05,
    });
    const leverMat = new THREE.MeshStandardMaterial({
      color: 0x1d1a18,
      roughness: 0.36,
      metalness: 0.14,
    });
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x151413,
      roughness: 0.9,
      metalness: 0.02,
    });

    const chassis = new THREE.Group();
    chassis.position.y = bodyY;
    this.root.add(chassis);

    // 1. Main boxy 1541 outer shell with subtle rounded corners
    const shellShape = roundedRectShape(W, H, 0.075);
    const shellGeo = new THREE.ExtrudeGeometry(shellShape, {
      depth: D - 0.06,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 3,
      curveSegments: 10,
    });
    shellGeo.center();
    const shell = new THREE.Mesh(shellGeo, plasticMain);
    shell.castShadow = true;
    shell.receiveShadow = true;
    chassis.add(shell);

    // Subtle horizontal case seam around middle of 1541
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.068, 0.015, D + 0.005),
      plasticRecess,
    );
    seam.position.y = -0.04;
    chassis.add(seam);

    // Top cooling louver vents along rear half
    for (let i = 0; i < 11; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.022, 0.042), plasticRecess);
      slot.position.set(0, H / 2 + 0.026, -1.25 + i * 0.092);
      chassis.add(slot);
    }

    // 2. Dark recessed front faceplate (classic 1541 black/brown drive bay)
    const frontZ = D / 2 + 0.015;
    const faceW = W - 0.14;
    const faceH = H - 0.14;

    const facePlate = new THREE.Mesh(new THREE.BoxGeometry(faceW, faceH, 0.06), plasticDark);
    facePlate.position.set(0, 0, frontZ - 0.01);
    facePlate.receiveShadow = true;
    chassis.add(facePlate);

    // Top brushed nameplate strip: Commodore 1541
    const badgeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(faceW - 0.08, 0.21),
      new THREE.MeshStandardMaterial({
        map: make1541BadgeTexture(),
        roughness: 0.36,
        metalness: 0.24,
      }),
    );
    badgeMesh.position.set(0, faceH / 2 - 0.13, frontZ + 0.024);
    chassis.add(badgeMesh);

    // 3. Horizontal 5.25" floppy disk slot recess + central finger notch
    const slotY = -0.02;
    const slotRecess = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.075, 0.07), plasticRecess);
    slotRecess.position.set(0, slotY, frontZ + 0.004);
    chassis.add(slotRecess);

    const fingerNotch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.07), plasticRecess);
    fingerNotch.position.set(0, slotY - 0.02, frontZ + 0.004);
    chassis.add(fingerNotch);

    // 4. 5.25" Floppy Disk ("GAMES DISK '84") that slides out when ejected!
    const floppyJacketMat = new THREE.MeshStandardMaterial({
      color: 0x1a1919,
      roughness: 0.65,
      metalness: 0.08,
    });
    const floppyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 0.022, 1.38),
      floppyJacketMat,
    );
    floppyMesh.castShadow = true;
    floppyMesh.userData.hit = { kind: 'drive' };
    this.floppyGroup.add(floppyMesh);

    // Cream floppy paper label visible when partially ejected!
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.42),
      new THREE.MeshStandardMaterial({
        map: makeFloppyLabelTexture(),
        roughness: 0.85,
      }),
    );
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.set(0.12, 0.012, 0.36);
    labelMesh.userData.hit = { kind: 'drive' };
    this.floppyGroup.add(labelMesh);

    this.floppyGroup.position.set(0, slotY, frontZ - 0.58);
    chassis.add(this.floppyGroup);
    this.interactiveMeshes.push(floppyMesh, labelMesh);

    // 5. Iconic rotating 1541 drive latch lever (center of slot)
    this.leverPivot.position.set(0, slotY + 0.04, frontZ + 0.036);
    chassis.add(this.leverPivot);

    const leverHub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.055, 0.04, 14), leverMat);
    leverHub.rotation.x = Math.PI / 2;
    leverHub.userData.hit = { kind: 'drive' };
    this.leverPivot.add(leverHub);

    const leverBar = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.27, 0.048), leverMat);
    leverBar.position.set(0, -0.10, 0.018);
    leverBar.castShadow = true;
    leverBar.userData.hit = { kind: 'drive' };
    this.leverPivot.add(leverBar);
    this.interactiveMeshes.push(leverHub, leverBar);

    // Invisible slightly wider click hitbox across the front bay for effortless clicking
    const bayHit = new THREE.Mesh(
      new THREE.BoxGeometry(1.65, 0.52, 0.14),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    bayHit.position.set(0, slotY - 0.04, frontZ + 0.04);
    bayHit.userData.hit = { kind: 'drive' };
    chassis.add(bayHit);
    this.interactiveMeshes.push(bayHit);

    // 6. POWER (green) & DRIVE (red) LEDs along lower-right of faceplate
    const ledY = -0.30;
    const ledLabelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.11),
      new THREE.MeshBasicMaterial({ map: makeLedLabelsTexture(), transparent: true }),
    );
    ledLabelPlane.position.set(0.54, ledY - 0.075, frontZ + 0.025);
    chassis.add(ledLabelPlane);

    // Green POWER LED
    const pwrLedMat = new THREE.MeshStandardMaterial({
      color: 0x1a3d1f,
      emissive: 0x4cff68,
      emissiveIntensity: 2.0,
      roughness: 0.25,
    });
    const pwrLed = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.034, 0.02), pwrLedMat);
    pwrLed.position.set(0.36, ledY, frontZ + 0.026);
    chassis.add(pwrLed);

    // Red DRIVE access LED + dynamic red point light!
    this.driveLedMat = new THREE.MeshStandardMaterial({
      color: 0x3b1212,
      emissive: 0xff2a20,
      emissiveIntensity: 0.06,
      roughness: 0.25,
    });
    const driveLed = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.034, 0.02), this.driveLedMat);
    driveLed.position.set(0.72, ledY, frontZ + 0.026);
    chassis.add(driveLed);

    this.driveLedLight = new THREE.PointLight(0xff2c20, 0.0, 1.35, 2.0);
    this.driveLedLight.position.set(0.72, ledY, frontZ + 0.18);
    chassis.add(this.driveLedLight);

    // 7. Rear serial DIN jacks & black power/IEC cables
    const backZ = -D / 2 - 0.02;
    const dinGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.06, 12);
    dinGeo.rotateX(Math.PI / 2);
    for (const dx of [-0.45, -0.22]) {
      const din = new THREE.Mesh(dinGeo, plasticRecess);
      din.position.set(dx, -0.08, backZ);
      chassis.add(din);
    }

    // Four rubber feet
    const footGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.07, 14);
    const fx = W / 2 - 0.28;
    const fz = D / 2 - 0.34;
    for (const [x, z] of [[-fx, fz], [fx, fz], [-fx, -fz], [fx, -fz]]) {
      const foot = new THREE.Mesh(footGeo, rubberMat);
      foot.position.set(x, 0.035, z);
      foot.castShadow = true;
      this.root.add(foot);
    }

    // Place right next to the Commodore 1702 monitor, pushed back so an ejected floppy clears the TAC-2 cleanly
    this.root.position.set(3.05, 0, -0.82);
    this.root.rotation.y = -0.18;
  }

  setActivity(state: DiskActivityState) {
    this.activity = state;
    this.ledTimer = 0;
  }

  toggleDisk(): boolean {
    this.diskInserted = !this.diskInserted;
    if (this.diskInserted && this.activity === 'error') {
      this.activity = 'idle';
    }
    return this.diskInserted;
  }

  update(dt: number, elapsed: number) {
    this.ledTimer += dt;

    // Smooth floppy insertion & latch lever animation
    const target = this.diskInserted ? 1 : 0;
    this.insertAnim += (target - this.insertAnim) * Math.min(1, dt * 11);

    // Lever: 0 rad (down/locked) when inserted, -PI/2 (horizontal/open) when ejected
    this.leverPivot.rotation.z = -(1 - this.insertAnim) * (Math.PI * 0.48);

    // Floppy slides smoothly outward when ejected so its "GAMES DISK '84" label shows!
    const frontZ = 3.15 / 2 + 0.015;
    this.floppyGroup.position.z = frontZ - 0.58 + (1 - this.insertAnim) * 0.72;

    // Red DRIVE LED state (idle / read / write / rapid 1541 error blink)
    let red = 0.0;
    if (this.activity === 'read' || this.activity === 'write') {
      // Bright steady crimson with subtle seek flicker
      red = 0.85 + 0.15 * Math.sin(elapsed * 42.0);
    } else if (this.activity === 'error') {
      // Classic 1541 flashing red error LED (~2.5 Hz)
      red = Math.sin(this.ledTimer * 16.0) > 0 ? 1.0 : 0.0;
    }

    this.driveLedMat.emissiveIntensity = 0.05 + red * 3.2;
    this.driveLedLight.intensity = red * 0.48;
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

function makeGrainTex(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 116 + Math.floor(Math.random() * 26);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function make1541BadgeTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // Silver/dark brushed anodized strip
  ctx.fillStyle = '#1b1917';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#a9a295';
  ctx.fillRect(0, h - 4, w, 3);

  // Rainbow accent block
  const stripes = ['#cc3a32', '#de7a28', '#e5c136', '#4da34e', '#3c68b8'];
  stripes.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(14, 12 + i * 7, 16, 6);
  });

  ctx.fillStyle = '#ebe5d8';
  ctx.font = '700 28px "IBM Plex Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('commodore', 42, 30);

  ctx.fillStyle = '#d4cec0';
  ctx.font = '700 28px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('1541', w - 18, 30);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeLedLabelsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#aba496';
  ctx.font = '600 20px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POWER', 64, 24);
  ctx.fillText('DRIVE', 192, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloppyLabelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ebe4d4';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#c83a32';
  ctx.fillRect(0, 0, c.width, 22);
  ctx.fillStyle = '#1f3e88';
  ctx.font = '700 24px "IBM Plex Sans", sans-serif';
  ctx.fillText("GAMES DISK '84", 18, 66);
  ctx.fillStyle = '#4a453c';
  ctx.font = '600 15px Inter, sans-serif';
  ctx.fillText('ECHO · DODGE · GUESS · CAVE', 18, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
