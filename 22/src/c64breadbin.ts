import * as THREE from 'three';

interface KeySpec {
  label: string;
  shiftLabel?: string; // secondary shifted symbol printed above main legend (e.g. '!' above '1')
  petscii?: string;    // front-skirt graphic hint printed on the angled front face
  key: string;         // KeyboardEvent.key emitted when clicked or matched when typed
  aliases?: string[];  // extra keys that depress this physical cap
  w: number;           // width in key units (1u = standard key)
  col: number;         // x offset in key units
  row: number;         // 0..4
  fn?: boolean;        // dark-taupe F1/F3/F5/F7 column on right
}

interface LiveKey {
  mesh: THREE.Mesh;
  restY: number;
  press: number;
}

// Authentic Commodore 64C 66-key layout (4 sculpted cream rows + long spacebar + 4 dark-taupe F-keys)
const KEY_SPECS: KeySpec[] = [
  // Row 0 (top number row with authentic C64 dual legends!)
  { label: '←', key: '_', w: 1, col: 0, row: 0 },
  { label: '1', shiftLabel: '!', petscii: 'BLK', key: '1', aliases: ['!'], w: 1, col: 1, row: 0 },
  { label: '2', shiftLabel: '"', petscii: 'WHT', key: '2', aliases: ['"', '@'], w: 1, col: 2, row: 0 },
  { label: '3', shiftLabel: '#', petscii: 'RED', key: '3', aliases: ['#'], w: 1, col: 3, row: 0 },
  { label: '4', shiftLabel: '$', petscii: 'CYN', key: '4', aliases: ['$'], w: 1, col: 4, row: 0 },
  { label: '5', shiftLabel: '%', petscii: 'PUR', key: '5', aliases: ['%'], w: 1, col: 5, row: 0 },
  { label: '6', shiftLabel: '&', petscii: 'GRN', key: '6', aliases: ['&'], w: 1, col: 6, row: 0 },
  { label: '7', shiftLabel: "'", petscii: 'BLU', key: '7', aliases: ["'"], w: 1, col: 7, row: 0 },
  { label: '8', shiftLabel: '(', petscii: 'YEL', key: '8', aliases: ['('], w: 1, col: 8, row: 0 },
  { label: '9', shiftLabel: ')', petscii: 'RVS', key: '9', aliases: [')'], w: 1, col: 9, row: 0 },
  { label: '0', petscii: 'OFF', key: '0', w: 1, col: 10, row: 0 },
  { label: '+', petscii: '╋', key: '+', w: 1, col: 11, row: 0 },
  { label: '-', petscii: '━', key: '-', aliases: ['_'], w: 1, col: 12, row: 0 },
  { label: '£', petscii: '◥', key: '\\', w: 1, col: 13, row: 0 },
  { label: 'HOME', shiftLabel: 'CLR', key: 'Home', w: 1, col: 14, row: 0 },
  { label: 'DEL', shiftLabel: 'INST', key: 'Backspace', w: 1, col: 15, row: 0 },
  { label: 'f 1', shiftLabel: 'f 2', key: 'F1', w: 1.48, col: 16.65, row: 0, fn: true },

  // Row 1 (QWERTY)
  { label: 'CTRL', key: 'Control', w: 1.5, col: 0, row: 1 },
  { label: 'Q', petscii: '● ├', key: 'q', w: 1, col: 1.5, row: 1 },
  { label: 'W', petscii: '○ ┤', key: 'w', w: 1, col: 2.5, row: 1 },
  { label: 'E', petscii: '━ ┴', key: 'e', w: 1, col: 3.5, row: 1 },
  { label: 'R', petscii: '━ ┬', key: 'r', w: 1, col: 4.5, row: 1 },
  { label: 'T', petscii: '│ ▎', key: 't', w: 1, col: 5.5, row: 1 },
  { label: 'Y', petscii: '│ ▍', key: 'y', w: 1, col: 6.5, row: 1 },
  { label: 'U', petscii: '╭ ▌', key: 'u', w: 1, col: 7.5, row: 1 },
  { label: 'I', petscii: '╮ ▄', key: 'i', w: 1, col: 8.5, row: 1 },
  { label: 'O', petscii: '┏ ▆', key: 'o', w: 1, col: 9.5, row: 1 },
  { label: 'P', petscii: '┓ ▇', key: 'p', w: 1, col: 10.5, row: 1 },
  { label: '@', petscii: '━ ▀', key: '@', w: 1, col: 11.5, row: 1 },
  { label: '*', petscii: '─ ◣', key: '*', w: 1, col: 12.5, row: 1 },
  { label: '↑', petscii: 'π', key: '^', w: 1, col: 13.5, row: 1 },
  { label: 'RESTORE', key: 'F9', w: 1.5, col: 14.5, row: 1 },
  { label: 'f 3', shiftLabel: 'f 4', key: 'F3', w: 1.48, col: 16.65, row: 1, fn: true },

  // Row 2 (ASDF + RETURN)
  { label: 'STOP', shiftLabel: 'RUN', key: 'Escape', w: 1, col: 0, row: 2 },
  { label: 'LOCK', shiftLabel: 'SHIFT', key: 'CapsLock', w: 1, col: 1, row: 2 },
  { label: 'A', petscii: '♠ ┌', key: 'a', w: 1, col: 2, row: 2 },
  { label: 'S', petscii: '♥ ┐', key: 's', w: 1, col: 3, row: 2 },
  { label: 'D', petscii: '━ ┘', key: 'd', w: 1, col: 4, row: 2 },
  { label: 'F', petscii: '━ └', key: 'f', w: 1, col: 5, row: 2 },
  { label: 'G', petscii: '│ ▌', key: 'g', w: 1, col: 6, row: 2 },
  { label: 'H', petscii: '│ ▐', key: 'h', w: 1, col: 7, row: 2 },
  { label: 'J', petscii: '╰ ▄', key: 'j', w: 1, col: 8, row: 2 },
  { label: 'K', petscii: '╯ ▀', key: 'k', w: 1, col: 9, row: 2 },
  { label: 'L', petscii: '┗ ▖', key: 'l', w: 1, col: 10, row: 2 },
  { label: ':', shiftLabel: '[', key: ':', aliases: ['['], w: 1, col: 11, row: 2 },
  { label: ';', shiftLabel: ']', key: ';', aliases: [']'], w: 1, col: 12, row: 2 },
  { label: '=', key: '=', w: 1, col: 13, row: 2 },
  { label: 'RETURN', key: 'Enter', w: 2, col: 14, row: 2 },
  { label: 'f 5', shiftLabel: 'f 6', key: 'F5', w: 1.48, col: 16.65, row: 2, fn: true },

  // Row 3 (ZXCV + CRSR)
  { label: 'C=', key: 'Alt', w: 1, col: 0, row: 3 },
  { label: 'SHIFT', key: 'Shift', w: 1.5, col: 1, row: 3 },
  { label: 'Z', petscii: '♦ ┼', key: 'z', w: 1, col: 2.5, row: 3 },
  { label: 'X', petscii: '♣ ╳', key: 'x', w: 1, col: 3.5, row: 3 },
  { label: 'C', petscii: '─ ▂', key: 'c', w: 1, col: 4.5, row: 3 },
  { label: 'V', petscii: '╳ ▎', key: 'v', w: 1, col: 5.5, row: 3 },
  { label: 'B', petscii: '│ ▍', key: 'b', w: 1, col: 6.5, row: 3 },
  { label: 'N', petscii: '╱ ▗', key: 'n', w: 1, col: 7.5, row: 3 },
  { label: 'M', petscii: '╲ ▘', key: 'm', w: 1, col: 8.5, row: 3 },
  { label: ',', shiftLabel: '<', key: ',', aliases: ['<'], w: 1, col: 9.5, row: 3 },
  { label: '.', shiftLabel: '>', key: '.', aliases: ['>'], w: 1, col: 10.5, row: 3 },
  { label: '/', shiftLabel: '?', key: '/', aliases: ['?'], w: 1, col: 11.5, row: 3 },
  { label: 'SHIFT', key: 'Shift', w: 1.5, col: 12.5, row: 3 },
  { label: 'CRSR', shiftLabel: '↕', key: 'ArrowDown', aliases: ['ArrowUp'], w: 1, col: 14, row: 3 },
  { label: 'CRSR', shiftLabel: '↔', key: 'ArrowRight', aliases: ['ArrowLeft'], w: 1, col: 15, row: 3 },
  { label: 'f 7', shiftLabel: 'f 8', key: 'F7', w: 1.48, col: 16.65, row: 3, fn: true },

  // Row 4 (long cream C64C Spacebar)
  { label: '', key: ' ', w: 9, col: 3.2, row: 4 },
];

/**
 * High-detail 3D Commodore 64C sleek low-profile wedge computer modeled after the real hardware:
 * - Warm cream-beige sloped wedge shell with 12 full-width horizontal rear cooling louvers
 * - Recessed dark keyboard bay + separate vertical bay for the 4 dark-taupe F-keys
 * - 66 sculpted cylindrical-dished cream keycaps with dual legends & front-face PETSCII graphics
 * - Upper-left red POWER LED + lower-right recessed "commodore 64 PERSONAL COMPUTER" nameplate
 * - Rear/side ports + all desk cables routed to the 1702 monitor, 1541 drive, wall power, and TAC-2
 */
export class Commodore64Breadbin {
  readonly root = new THREE.Group();
  readonly interactiveMeshes: THREE.Object3D[] = [];

  private readonly liveKeys: LiveKey[] = [];
  private readonly keyLookup = new Map<string, LiveKey[]>();

  constructor(tac2CableEntry: THREE.Vector3) {
    const grainTex = makeGrainTex();
    const caseMat = new THREE.MeshStandardMaterial({
      color: 0xd6cfc0, // iconic warm cream-beige Commodore 64C ABS
      roughness: 0.50,
      metalness: 0.04,
      bumpMap: grainTex,
      bumpScale: 0.0032,
    });
    const louverGrooveMat = new THREE.MeshStandardMaterial({
      color: 0x625c52, // crisp deep shadow grooves between the horizontal rear slats
      roughness: 0.78,
    });
    const wellMat = new THREE.MeshStandardMaterial({
      color: 0x1e1c1a,
      roughness: 0.82,
      metalness: 0.05,
    });
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x171616,
      roughness: 0.62,
      metalness: 0.06,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x22201e,
      roughness: 0.48,
      metalness: 0.08,
    });
    const serialCableMat = new THREE.MeshStandardMaterial({
      color: 0x2b2825,
      roughness: 0.58,
      metalness: 0.05,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x9c9992,
      roughness: 0.36,
      metalness: 0.78,
    });

    // Real Commodore 64C low-profile dimensions (~40.4 cm W x 21.8 cm D x 5.2 cm rear height)
    const W = 4.04;
    const H = 0.52;
    const D = 2.18;
    const rearZ = 1.62;
    const centerZ = rearZ + D / 2;

    const c64 = new THREE.Group();
    c64.position.set(0.0, 0, centerZ);
    this.root.add(c64);

    // 1. Sleek low-profile Commodore 64C wedge profile
    // Shape X maps to world Z after rotateY(-Math.PI/2): -hd = rear, +hd = front wrist lip
    const hd = D / 2;
    const wedge = new THREE.Shape();
    wedge.moveTo(-hd + 0.03, 0.02);
    wedge.lineTo(hd - 0.04, 0.02);
    wedge.lineTo(hd, 0.13);
    wedge.quadraticCurveTo(hd, 0.21, hd - 0.06, 0.22);          // sleek low front wrist lip
    wedge.lineTo(-hd + 0.66, 0.43);                              // gentle sloped keyboard deck
    wedge.lineTo(-hd + 0.58, H - 0.02);                          // crisp step up to louvered rear deck
    wedge.lineTo(-hd + 0.06, H);                                 // flat rear louver plateau
    wedge.quadraticCurveTo(-hd, H, -hd, H - 0.07);
    wedge.lineTo(-hd, 0.06);
    wedge.quadraticCurveTo(-hd, 0.02, -hd + 0.03, 0.02);

    const bodyGeo = new THREE.ExtrudeGeometry(wedge, {
      depth: W - 0.06,
      bevelEnabled: true,
      bevelThickness: 0.028,
      bevelSize: 0.028,
      bevelSegments: 4,
      curveSegments: 10,
    });
    bodyGeo.center();
    bodyGeo.rotateY(-Math.PI / 2);

    // Position body so its bottom rests cleanly at y = 0 on the desk
    bodyGeo.computeBoundingBox();
    const minY = bodyGeo.boundingBox!.min.y;
    const body = new THREE.Mesh(bodyGeo, caseMat);
    body.position.set(0, -minY, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    c64.add(body);

    // Subtle crisp parting line running around lower front/side edge
    const seam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.008, 0.012, D + 0.008), wellMat);
    seam.position.set(0, 0.095, 0);
    c64.add(seam);

    // 2. Signature Commodore 64C full-width horizontal slatted rear cooling louvers!
    const topPlateauY = bodyGeo.boundingBox!.max.y - minY;

    const louverGroup = new THREE.Group();
    const louverStartZ = -hd + 0.075;
    const louverEndZ = -hd + 0.57;
    const numLouvers = 11;
    const louverPitch = (louverEndZ - louverStartZ) / numLouvers;

    // Dark recessed vent tray underneath the slats
    const ventTray = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.03, 0.016, louverEndZ - louverStartZ + 0.03),
      louverGrooveMat,
    );
    ventTray.position.set(0, topPlateauY - 0.004, (louverStartZ + louverEndZ) * 0.5);
    louverGroup.add(ventTray);

    // 11 crisp angled cream horizontal slats running edge-to-edge across the rear deck!
    const slatGeo = new THREE.BoxGeometry(W - 0.02, 0.018, louverPitch * 0.56);
    for (let i = 0; i < numLouvers; i++) {
      const sz = louverStartZ + (i + 0.5) * louverPitch;
      const slat = new THREE.Mesh(slatGeo, caseMat);
      slat.position.set(0, topPlateauY + 0.005, sz);
      slat.rotation.x = 0.08;
      slat.receiveShadow = true;
      louverGroup.add(slat);
    }
    c64.add(louverGroup);

    // 3. Sloped Keyboard Deck Group (exact angle of the C64C front wedge slope!)
    const deckStartZ = -hd + 0.66;
    const deckEndZ = hd - 0.06;
    const deckStartY = topPlateauY - 0.088;
    const deckEndY = topPlateauY - 0.302;
    const deckAngle = Math.atan2(deckStartY - deckEndY, deckEndZ - deckStartZ);

    const deckGroup = new THREE.Group();
    deckGroup.position.set(0, (deckStartY + deckEndY) * 0.5 + 0.004, (deckStartZ + deckEndZ) * 0.5);
    deckGroup.rotation.x = deckAngle;
    c64.add(deckGroup);

    // Recessed dark keyboard bays + subtle chamfered bevel frames around the cutouts!
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0xc5beb0, // slightly shaded warm-cream chamfer sloping down into the dark well
      roughness: 0.56,
      metalness: 0.04,
    });
    const addChamferedWell = (cx: number, cz: number, bw: number, bd: number) => {
      const well = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.032, bd), wellMat);
      well.position.set(cx, -0.002, cz);
      deckGroup.add(well);

      // Subtle 4-sided 45° chamfered lip framing the recessed keyboard opening
      const rim = 0.022;
      const topLip = new THREE.Mesh(new THREE.BoxGeometry(bw + rim * 2, 0.014, rim), bezelMat);
      topLip.position.set(cx, 0.013, cz - bd / 2 - rim * 0.45);
      topLip.rotation.x = 0.45;
      deckGroup.add(topLip);

      const botLip = new THREE.Mesh(new THREE.BoxGeometry(bw + rim * 2, 0.014, rim), bezelMat);
      botLip.position.set(cx, 0.013, cz + bd / 2 + rim * 0.45);
      botLip.rotation.x = -0.45;
      deckGroup.add(botLip);

      const leftLip = new THREE.Mesh(new THREE.BoxGeometry(rim, 0.014, bd + rim * 2), bezelMat);
      leftLip.position.set(cx - bw / 2 - rim * 0.45, 0.013, cz);
      leftLip.rotation.z = -0.45;
      deckGroup.add(leftLip);

      const rightLip = new THREE.Mesh(new THREE.BoxGeometry(rim, 0.014, bd + rim * 2), bezelMat);
      rightLip.position.set(cx + bw / 2 + rim * 0.45, 0.013, cz);
      rightLip.rotation.z = 0.45;
      deckGroup.add(rightLip);
    };

    addChamferedWell(-0.22, -0.10, 3.16, 0.83);
    addChamferedWell(-0.26, 0.39, 1.79, 0.22);
    addChamferedWell(1.62, -0.10, 0.33, 0.83);

    // Subtle upper-left red POWER LED + printed "POWER" label (just like the real C64C!)
    const pwrLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.045),
      new THREE.MeshStandardMaterial({
        map: makePowerLabelTex(),
        roughness: 0.55,
        transparent: true,
      }),
    );
    pwrLabel.rotation.x = -Math.PI / 2;
    pwrLabel.position.set(-1.89, 0.022, -0.53);
    deckGroup.add(pwrLabel);

    const redLedMat = new THREE.MeshStandardMaterial({
      color: 0x701210,
      emissive: 0xff2b1c,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    });
    const redLed = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.016, 0.018), redLedMat);
    redLed.position.set(-1.89, 0.022, -0.48);
    deckGroup.add(redLed);

    const ledLight = new THREE.PointLight(0xff2b1c, 0.04, 0.28, 2.0);
    ledLight.position.set(-1.89, 0.05, -0.48);
    deckGroup.add(ledLight);

    // Iconic lower-right recessed "C= commodore 64 / PERSONAL COMPUTER" metallic badge (photo 3!)
    const badgeRecess = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.014, 0.20), louverGrooveMat);
    badgeRecess.position.set(1.30, 0.012, 0.41);
    deckGroup.add(badgeRecess);

    const badgeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.81, 0.18),
      new THREE.MeshStandardMaterial({
        map: makeC64CBadgeTexture(),
        roughness: 0.36,
        metalness: 0.42,
      }),
    );
    badgeMesh.rotation.x = -Math.PI / 2;
    badgeMesh.position.set(1.30, 0.021, 0.41);
    deckGroup.add(badgeMesh);

    // 4. Build all 66 high-detail sculpted cylindrical-dished C64C keycaps sharing ONE combined atlas!
    const unit = 0.194;
    const keyH = 0.132;
    const { keycapMat, uvRectFor } = makeC64CKeycapAtlasMaterial(unit, keyH);

    const startX = -1.78;
    const startZ = -0.40;

    for (let idx = 0; idx < KEY_SPECS.length; idx++) {
      const spec = KEY_SPECS[idx];
      const kw = spec.w * unit - 0.018;
      const kd = unit - 0.020;

      const geo = makeDishedC64CKeycapGeo(kw, keyH, kd, uvRectFor(idx));
      const keyMesh = new THREE.Mesh(geo, keycapMat);

      const kx = startX + (spec.col + spec.w * 0.5) * unit;
      const kz = startZ + spec.row * (unit + 0.006);
      const restY = 0.068;

      keyMesh.position.set(kx, restY, kz);
      keyMesh.receiveShadow = true;
      keyMesh.userData.hit = { kind: 'key', key: spec.key };
      deckGroup.add(keyMesh);
      this.interactiveMeshes.push(keyMesh);

      const live: LiveKey = { mesh: keyMesh, restY, press: 0 };
      this.liveKeys.push(live);

      const register = (k: string) => {
        const lk = k.length === 1 ? k.toLowerCase() : k;
        const list = this.keyLookup.get(lk) ?? [];
        list.push(live);
        this.keyLookup.set(lk, list);
      };
      register(spec.key);
      if (spec.aliases) spec.aliases.forEach(register);
    }

    // 5. Rear & Right-Side Ports + Molded Plug Boots
    const portFaceZ = -hd - 0.024;
    const cartSlot = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.16, 0.05), wellMat);
    cartSlot.position.set(-1.26, 0.25, portFaceZ);
    c64.add(cartSlot);

    const rfShield = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.04), metalMat);
    rfShield.position.set(-0.56, 0.25, portFaceZ);
    c64.add(rfShield);

    for (const px of [-0.14, 0.34, 0.92, 1.48]) {
      const pRec = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 0.04), wellMat);
      pRec.position.set(px, 0.24, portFaceZ);
      c64.add(pRec);
    }

    const addDinBoot = (localX: number) => {
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.060, 0.22, 16), bootMat);
      boot.rotation.x = Math.PI / 2;
      boot.position.set(localX, 0.24, portFaceZ - 0.09);
      boot.castShadow = true;
      c64.add(boot);

      const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.042, 0.10, 12), bootMat);
      relief.rotation.x = Math.PI / 2;
      relief.position.set(localX, 0.24, portFaceZ - 0.22);
      c64.add(relief);
    };
    addDinBoot(-0.14); // Video DIN
    addDinBoot(0.34);  // Serial IEC DIN

    // Right-side Control Port 1 DB-9 Joystick plug + Power DIN plug
    const joyBoot = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.18), bootMat);
    joyBoot.position.set(W / 2 + 0.07, 0.20, -hd + 0.56);
    joyBoot.castShadow = true;
    c64.add(joyBoot);

    const pwrBoot = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.060, 0.20, 14), bootMat);
    pwrBoot.rotation.z = Math.PI / 2;
    pwrBoot.position.set(W / 2 + 0.08, 0.21, -hd + 0.24);
    pwrBoot.castShadow = true;
    c64.add(pwrBoot);

    // 6. Real Desk Cables connecting C64C -> 1702 Monitor, 1541 Drive, Wall Power & TAC-2 Joystick!
    const addCable = (pts: [number, number, number][], radius: number, mat: THREE.Material) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 52, radius, 10, false), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };

    const c64X = 0.0;

    // A. Monitor Video/Audio DIN -> snakes behind C64C, around left flank of 1702 -> rear RCA jacks
    addCable(
      [
        [c64X - 0.14, 0.24, rearZ - 0.22],
        [c64X - 0.55, 0.11, rearZ - 0.32],
        [-1.42, 0.028, 1.24],
        [-1.98, 0.028, 1.05],
        [-2.04, 0.028, 0.15],
        [-1.92, 0.032, -1.25],
        [-1.18, 0.12, -2.55],
        [-0.38, 1.15, -2.82],
        [-0.39, 1.38, -2.56],
      ],
      0.028,
      cableMat,
    );
    addCable(
      [
        [-1.18, 0.12, -2.55],
        [-0.42, 0.88, -2.86],
        [-0.13, 1.38, -2.56],
      ],
      0.020,
      cableMat,
    );
    for (const [rx, hex] of [[-0.39, 0xd8b836], [-0.13, 0xe0ddd4]] as [number, number][]) {
      const rcaPlug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.044, 0.044, 0.18, 12),
        new THREE.MeshStandardMaterial({ color: hex, roughness: 0.42 }),
      );
      rcaPlug.rotation.x = Math.PI / 2;
      rcaPlug.position.set(rx, 1.38, -2.62);
      this.root.add(rcaPlug);
    }

    // B. 1541 Serial IEC Cable -> snakes between 1702 & 1541 -> rear DIN serial port of 1541
    addCable(
      [
        [c64X + 0.34, 0.24, rearZ - 0.22],
        [c64X + 0.72, 0.11, rearZ - 0.30],
        [1.50, 0.028, 1.26],
        [1.96, 0.028, 0.85],
        [1.98, 0.028, -0.40],
        [2.06, 0.032, -1.85],
        [2.42, 0.16, -2.74],
        [2.78, 0.46, -2.48],
      ],
      0.030,
      serialCableMat,
    );

    // C. TAC-2 Joystick Cable: loops cleanly from C64C Control Port 1 -> back grommet of Suncom TAC-2!
    const joyPortX = c64X + W / 2 + 0.15;
    const joyPortZ = rearZ + 0.56;
    addCable(
      [
        [joyPortX, 0.20, joyPortZ],
        [joyPortX + 0.22, 0.08, joyPortZ - 0.12],
        [2.56, 0.024, 1.98],
        [2.88, 0.028, 1.96],
        [tac2CableEntry.x - 0.04, 0.055, tac2CableEntry.z - 0.14],
        [tac2CableEntry.x, tac2CableEntry.y, tac2CableEntry.z],
      ],
      0.022,
      cableMat,
    );

    // D. Heavy C64C Power Cable -> exits right side, curves past 1541 toward wall
    const pwrPortX = c64X + W / 2 + 0.16;
    const pwrPortZ = rearZ + 0.24;
    addCable(
      [
        [pwrPortX, 0.21, pwrPortZ],
        [pwrPortX + 0.40, 0.10, pwrPortZ - 0.16],
        [3.42, 0.034, 1.72],
        [4.38, 0.034, 1.15],
        [4.56, 0.034, -0.45],
        [4.46, 0.034, -2.15],
        [4.20, 0.034, -3.15],
      ],
      0.034,
      cableMat,
    );

    // E. 1541 Rear Power Cord -> trails back to wall
    addCable(
      [
        [3.38, 0.44, -2.34],
        [3.62, 0.18, -2.74],
        [3.88, 0.032, -3.02],
        [4.05, 0.032, -3.28],
      ],
      0.032,
      cableMat,
    );
  }

  /** Visually depress the matching 3D C64C keycap whenever a key is typed! */
  triggerKey(key: string) {
    const lk = key.length === 1 ? key.toLowerCase() : key;
    const matches = this.keyLookup.get(lk);
    if (matches) {
      for (const m of matches) m.press = 1.0;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.liveKeys.length; i++) {
      const k = this.liveKeys[i];
      if (k.press > 0.001) {
        k.press = Math.max(0, k.press - dt * 8.5);
        k.mesh.position.y = k.restY - k.press * 0.052;
      } else if (k.mesh.position.y !== k.restY) {
        k.mesh.position.y = k.restY;
      }
    }
  }
}

/**
 * Builds a high-detail sculpted Commodore 64C keycap with:
 * - Subtle molded chamfers along all 4 vertical corner ribs and the entire top perimeter rim
 * - Tapered trapezoidal skirt (wider base, tighter crown, subtle rear slant)
 * - Cylindrical dished top surface (light scoops naturally across each keycap!)
 * - Top face UVs mapped to the legend zone AND front skirt UVs mapped to the PETSCII front-legend zone!
 */
function makeDishedC64CKeycapGeo(
  w: number,
  h: number,
  d: number,
  uvRect: [number, number, number, number],
): THREE.BufferGeometry {
  // 6x4x6 grid whose outer stops are remapped to a crisp subtle chamfer width (1.2 mm real scale!)
  const geo = new THREE.BoxGeometry(w, h, d, 6, 4, 6);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const norm = geo.attributes.normal;

  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const halfD = d * 0.5;
  const c = Math.min(0.015, w * 0.09, d * 0.09); // subtle perimeter & corner chamfer width
  const cy = Math.min(0.013, h * 0.11);          // subtle top-lip vertical chamfer drop
  const taperX = Math.max(0.75, 1 - 0.048 / w);
  const taperZ = 0.72;

  // Record original face orientation BEFORE deforming vertices
  const faceDir: ('top' | 'front' | 'other')[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    if (norm.getY(i) > 0.8) faceDir[i] = 'top';
    else if (norm.getZ(i) > 0.8) faceDir[i] = 'front';
    else faceDir[i] = 'other';
  }

  // Helper to remap uniform 6-segment normalized coord (-1..1) so outer band = exact chamfer width c
  const remapXZ = (coord: number, half: number): number => {
    const s = Math.sign(coord);
    const a = Math.abs(coord) / half; // 0, 1/3, 2/3, 1
    if (a > 0.99) return s * half;
    if (a > 0.60) return s * (half - c);
    if (a > 0.25) return s * (half - c) * 0.48;
    return 0;
  };

  // Remap uniform 4-segment Y (-halfH..+halfH) so the top band = exact top-edge chamfer height cy
  const remapY = (coord: number): number => {
    const t = (coord + halfH) / h; // 0, 0.25, 0.5, 0.75, 1.0
    if (t > 0.99) return halfH;
    if (t > 0.70) return halfH - cy;
    if (t > 0.45) return halfH * 0.35;
    if (t > 0.20) return -halfH * 0.32;
    return -halfH;
  };

  const topHalfW = halfW * taperX;
  const topHalfD = halfD * taperZ;
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Map top face (+Y) into top 112/192 of atlas cell, front face (+Z) into bottom 80/192 skirt band!
  const [u0, v0, u1, v1] = uvRect;
  const du = u1 - u0;
  const dv = v1 - v0;
  const skirtFrac = 80 / 192;
  const splitV = v0 + dv * skirtFrac;

  for (let i = 0; i < pos.count; i++) {
    let x = remapXZ(pos.getX(i), halfW);
    let y = remapY(pos.getY(i));
    let z = remapXZ(pos.getZ(i), halfD);

    const onXEdge = Math.abs(Math.abs(x) - halfW) < 1e-4;
    const onZEdge = Math.abs(Math.abs(z) - halfD) < 1e-4;
    const onTop = Math.abs(y - halfH) < 1e-4;

    // 1. Subtle 45° molded vertical corner chamfer on all 4 corners of the keycap
    if (onXEdge && onZEdge) {
      x -= Math.sign(x) * c * 0.42;
      z -= Math.sign(z) * c * 0.42;
    }

    // 2. Subtle top-perimeter chamfer bevel around the upper lip of every keycap
    if (onTop && (onXEdge || onZEdge)) {
      if (onXEdge) x -= Math.sign(x) * c * 0.82;
      if (onZEdge) z -= Math.sign(z) * c * 0.82;
      y -= cy * 0.52;
    }

    // 3. Authentic Commodore trapezoidal skirt taper + slight rearward slant
    const t = Math.max(0, Math.min(1, (y + halfH) / h));
    const easeT = Math.pow(t, 0.85);
    const sx = 1 + (taperX - 1) * easeT;
    const sz = 1 + (taperZ - 1) * easeT;
    const zShift = -0.014 * easeT;

    // 4. Gentle cylindrical finger scoop across the interior top surface
    let yDish = 0;
    if (t > 0.94 && !onXEdge && !onZEdge) {
      const nx = x / Math.max(0.01, halfW - c);
      const nz = z / Math.max(0.01, halfD - c);
      yDish = -(1 - nx * nx) * 0.010 * (1 - Math.abs(nz) * 0.25);
    }

    const fx = x * sx;
    const fy = y + yDish;
    const fz = z * sz + zShift;
    pos.setXYZ(i, fx, fy, fz);

    // 5. Compute true physical-space UVs so remapped chamfers & wide keys never stretch legends!
    if (faceDir[i] === 'top') {
      const su = clamp01(0.5 + fx / (2 * topHalfW));
      const sv = clamp01(0.5 - (fz + 0.014) / (2 * topHalfD));
      uv.setXY(i, u0 + (0.03 + su * 0.94) * du, splitV + (0.03 + sv * 0.94) * (v1 - splitV));
    } else if (faceDir[i] === 'front') {
      const su = clamp01(0.5 + fx / (2 * halfW));
      const sv = clamp01((fy + halfH) / h);
      uv.setXY(i, u0 + (0.03 + su * 0.94) * du, v0 + (0.04 + sv * 0.92) * (splitV - v0));
    } else {
      // Solid cream or grey corner inside this key's own atlas cell (never bleeds text onto side walls)
      uv.setXY(i, u0 + du * 0.025, v1 - dv * 0.025);
    }
  }
  geo.computeVertexNormals();

  return geo;
}

function makeC64CKeycapAtlasMaterial(
  unit: number,
  keyH: number,
): {
  keycapMat: THREE.MeshStandardMaterial;
  uvRectFor: (idx: number) => [number, number, number, number];
} {
  const cols = 9;
  const rows = 8;
  const cellW = 160;
  const cellH = 192;
  const topH = 112;
  const skirtH = cellH - topH; // 80 px dedicated to front skirt (zero vertical stretch!)
  const W = cols * cellW;
  const H = rows * cellH;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ded7c9';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const canvasTopAspect = cellW / topH;
  const canvasFrontAspect = cellW / skirtH;
  const kd = unit - 0.020;

  for (let i = 0; i < KEY_SPECS.length; i++) {
    const spec = KEY_SPECS[i];
    const ox = (i % cols) * cellW;
    const oy = Math.floor(i / cols) * cellH;

    const bgHex = spec.fn ? '#7f7a71' : '#ded7c9';
    const skirtHex = spec.fn ? '#716c63' : '#d2cab9';
    const fgHex = spec.fn ? '#1d1b19' : '#252321';
    const petsciiHex = '#4b4741';

    // Fill key cell background (top + slightly shaded front skirt)
    ctx.fillStyle = bgHex;
    ctx.fillRect(ox, oy, cellW, topH);

    // Soft dished-top subtle specular highlight
    const grad = ctx.createRadialGradient(
      ox + cellW * 0.5,
      oy + topH * 0.42,
      6,
      ox + cellW * 0.5,
      oy + topH * 0.5,
      cellW * 0.54,
    );
    grad.addColorStop(0, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.09)');
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, cellW, topH);

    ctx.fillStyle = skirtHex;
    ctx.fillRect(ox, oy + topH, cellW, skirtH);

    // Exact physical aspect compensation so wide keys (RETURN, SHIFT, CTRL, RESTORE, F1..F7) never stretch!
    const kw = spec.w * unit - 0.018;
    const taperX = Math.max(0.75, 1 - 0.048 / kw);
    const taperZ = 0.72;
    const physTopAspect = (kw * taperX) / (kd * taperZ);
    const topScaleX = canvasTopAspect / physTopAspect;

    const cx = ox + cellW * 0.5;
    ctx.save();
    ctx.translate(cx, oy);
    ctx.scale(topScaleX, 1);
    ctx.fillStyle = fgHex;

    if (spec.shiftLabel && spec.label) {
      const longShift = spec.shiftLabel.length > 2;
      const longMain = spec.label.length > 2;
      const shiftSize = spec.fn ? 22 : longShift ? 19 : 26;
      const mainSize = spec.fn ? 22 : longMain ? 20 : 32;
      ctx.font = `700 ${shiftSize}px "IBM Plex Sans", Inter, sans-serif`;
      ctx.fillText(spec.shiftLabel, 0, topH * 0.30);
      ctx.font = `700 ${mainSize}px "IBM Plex Sans", Inter, sans-serif`;
      ctx.fillText(spec.label, 0, topH * 0.70);
    } else if (spec.label) {
      const len = spec.label.length;
      const size = len > 5 ? 24 : len > 2 ? 27 : len === 2 ? 34 : 44;
      ctx.font = `700 ${size}px "IBM Plex Sans", Inter, sans-serif`;
      ctx.fillText(spec.label, 0, topH * 0.51);
    }
    ctx.restore();

    // Exact aspect-compensated crisp front-skirt legends (BLK..OFF & subtle C64 PETSCII graphics!)
    if (spec.petscii) {
      const physFrontAspect = kw / keyH;
      const frontScaleX = canvasFrontAspect / physFrontAspect;
      ctx.save();
      ctx.translate(cx, oy + topH + skirtH * 0.46);
      ctx.scale(frontScaleX, 1);
      ctx.fillStyle = petsciiHex;
      const isWord = /^[A-Z]{3}$/.test(spec.petscii);
      ctx.font = isWord
        ? '700 13px "IBM Plex Sans", Inter, sans-serif'
        : '600 15px "IBM Plex Sans", Inter, sans-serif';
      ctx.fillText(spec.petscii, 0, 0);
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const keycapMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.03,
  });

  const uvRectFor = (idx: number): [number, number, number, number] => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const u0 = col / cols;
    const u1 = (col + 1) / cols;
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    return [u0, v0, u1, v1];
  };

  return { keycapMat, uvRectFor };
}

function makePowerLabelTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 56;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 192, 56);
  ctx.fillStyle = '#3a3632';
  ctx.font = '700 28px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('POWER', 8, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Iconic Commodore 64C lower-right recessed metallic grey-silver badge:
 * "C= commodore 64 / PERSONAL COMPUTER" (matching photo 3!).
 */
function makeC64CBadgeTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 112;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#8d8880');
  grad.addColorStop(0.5, '#9d988f');
  grad.addColorStop(1, '#7f7a72');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Subtle C= monochrome silver-white emblem on left
  const cx = 42;
  const cy = 42;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0.42, Math.PI * 2 - 0.42);
  ctx.arc(cx, cy, 9.5, Math.PI * 2 - 0.56, 0.56, true);
  ctx.closePath();
  ctx.fillStyle = '#f2efe8';
  ctx.fill();
  ctx.fillRect(cx + 8, cy - 9, 17, 6.5);
  ctx.fillRect(cx + 8, cy + 2.5, 17, 6.5);

  ctx.fillStyle = '#f4f1ea';
  ctx.font = '700 44px "IBM Plex Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('commodore', 76, 44);
  ctx.font = '700 46px "IBM Plex Sans", sans-serif';
  ctx.fillText('64', 418, 45);

  ctx.fillStyle = 'rgba(244, 241, 234, 0.88)';
  ctx.font = '600 22px Inter, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('PERSONAL COMPUTER', 78, 86);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
  tex.repeat.set(5, 3);
  return tex;
}
