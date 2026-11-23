import * as THREE from 'three';

/**
 * Vintage 1980s glossy-black-rimmed Batman wall clock hanging on the Swedish wallpaper
 * above the 1541 floppy drive, keeping real local time with a ticking quartz red second hand.
 */
export class RetroWallClock {
  readonly root = new THREE.Group();
  readonly hitMesh: THREE.Mesh;

  private readonly hourHand = new THREE.Group();
  private readonly minuteHand = new THREE.Group();
  private readonly secondHand = new THREE.Group();

  tickSoundOn = true;
  private lastSecond = -1;
  private onTickCallback?: (second: number) => void;

  constructor(onTick?: (second: number) => void) {
    this.onTickCallback = onTick;

    const R = 0.92; // ~18.4 cm radius (classic 1980s kid's bedroom wall clock)
    const depth = 0.17;

    const clock = new THREE.Group();
    this.root.add(clock);

    const blackGloss = new THREE.MeshStandardMaterial({
      color: 0x111112,
      roughness: 0.16,
      metalness: 0.12,
    });
    const handDark = new THREE.MeshStandardMaterial({
      color: 0x26262a,
      roughness: 0.45,
      metalness: 0.25,
    });
    const handRed = new THREE.MeshStandardMaterial({
      color: 0xe23236,
      roughness: 0.32,
      metalness: 0.15,
    });

    // 1. Cylindrical black casing body
    const bodyGeo = new THREE.CylinderGeometry(R, R * 0.96, depth, 40);
    bodyGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, blackGloss);
    body.position.z = depth * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    clock.add(body);

    // 2. Rounded glossy black front bezel rim
    const bezelGeo = new THREE.TorusGeometry(R - 0.03, 0.055, 16, 48);
    const bezel = new THREE.Mesh(bezelGeo, blackGloss);
    bezel.position.z = depth;
    bezel.castShadow = true;
    clock.add(bezel);

    // 3. Printed 1980s retro Batman dial face (sits cleanly in front of the black casing cap!)
    const dialTex = makeBatmanDialTexture();
    const dialMat = new THREE.MeshStandardMaterial({
      map: dialTex,
      roughness: 0.62,
      metalness: 0.0,
    });
    const dial = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 44), dialMat);
    dial.position.z = depth + 0.004;
    dial.receiveShadow = true;
    clock.add(dial);

    // 4. Real 3D clock hands (hour, minute, red quartz second hand + center red pin)
    const handZ = depth + 0.016;

    // Hour hand (matte charcoal, rounded tip)
    const hrBar = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.46, 0.012), handDark);
    hrBar.position.y = 0.20;
    this.hourHand.add(hrBar);
    this.hourHand.position.z = handZ;
    clock.add(this.hourHand);

    // Minute hand (longer charcoal bar)
    const minBar = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.66, 0.012), handDark);
    minBar.position.y = 0.30;
    this.minuteHand.add(minBar);
    this.minuteHand.position.z = handZ + 0.014;
    clock.add(this.minuteHand);

    // Red quartz second hand (slender needle with tail counterweight)
    const secNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.78, 0.008), handRed);
    secNeedle.position.y = 0.25;
    this.secondHand.add(secNeedle);
    this.secondHand.position.z = handZ + 0.026;
    clock.add(this.secondHand);

    // Center red cap pin
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.032, 16), handRed);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = handZ + 0.028;
    clock.add(cap);

    // 5. Clear slightly reflective front acrylic clock lens
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(R - 0.042, 40), glassMat);
    glass.position.z = depth + 0.054;
    glass.userData.hit = { kind: 'clock' };
    clock.add(glass);
    this.hitMesh = glass;

    // Soft contact shadow directly on the wallpaper behind the clock
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 2.55, R * 2.55),
      new THREE.MeshBasicMaterial({
        map: makeWallShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    shadow.position.set(0.08, -0.10, 0.006);
    clock.add(shadow);

    // Hang high on the Swedish bedroom wall so the top ~20% crops naturally at the top edge of the frame!
    this.root.scale.setScalar(1.15);
    this.root.position.set(3.22, 4.18, -3.44);
    this.syncTime(false);
  }

  toggleTickSound(): boolean {
    this.tickSoundOn = !this.tickSoundOn;
    return this.tickSoundOn;
  }

  update() {
    this.syncTime(true);
  }

  private syncTime(triggerSound: boolean) {
    const now = new Date();
    const sec = now.getSeconds();
    const ms = now.getMilliseconds();
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;

    if (sec !== this.lastSecond) {
      if (triggerSound && this.lastSecond >= 0 && this.tickSoundOn) {
        this.onTickCallback?.(sec);
      }
      this.lastSecond = sec;
    }

    // Authentic quartz 1-second step with tiny elastic overshoot bounce!
    const bounce = ms < 95 ? Math.sin((ms / 95) * Math.PI) * 0.022 : 0;
    this.secondHand.rotation.z = -(sec / 60) * Math.PI * 2 - bounce;
    this.minuteHand.rotation.z = -(min / 60) * Math.PI * 2;
    this.hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
  }
}

/**
 * Draws the 1980s retro Batman clock face:
 * lavender-grid upper half, crisp cream-white lower half, bat-wing silhouette & cowl,
 * bold red-and-yellow "BAT MAN" lettering, lavender perimeter ring, twin 6-o'clock bars,
 * and mini red badges at 12, 3, and 9.
 */
function makeBatmanDialTexture(): THREE.CanvasTexture {
  const S = 512;
  const cx = S / 2;
  const cy = S / 2;
  const R = S * 0.47;

  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;

  // Clean warm off-white dial ground
  ctx.fillStyle = '#faf8f0';
  ctx.fillRect(0, 0, S, S);

  // Clip to inner ring for the lavender 80s grid on the top half
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.90, 0, Math.PI * 2);
  ctx.clip();

  // Lavender upper half (slightly past midline, just like the vintage clock!)
  const splitY = cy + 28;
  ctx.fillStyle = '#a48ee4';
  ctx.fillRect(0, 0, S, splitY);

  // Crisp white 1980s graph-paper grid lines over the lavender half
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.lineWidth = 2.6;
  const step = 28;
  for (let x = cx % step; x < S; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, splitY);
    ctx.stroke();
  }
  for (let y = splitY; y >= 0; y -= step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }
  ctx.restore();

  // Lavender thin circular outer track ring
  ctx.strokeStyle = '#977fd9';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.90, 0, Math.PI * 2);
  ctx.stroke();

  // Twin vertical lavender bars at 6 o'clock
  ctx.fillStyle = '#977fd9';
  ctx.fillRect(cx - 10, cy + R * 0.74, 6, R * 0.20);
  ctx.fillRect(cx + 4, cy + R * 0.74, 6, R * 0.20);

  // Tiny red mini-logos at 12, 3, and 9 o'clock
  const drawMiniBadge = (bx: number, by: number) => {
    ctx.save();
    ctx.translate(bx, by);
    ctx.fillStyle = '#e03e32';
    ctx.beginPath();
    ctx.moveTo(-22, 6);
    ctx.quadraticCurveTo(-10, -8, 0, -4);
    ctx.quadraticCurveTo(10, -8, 22, 6);
    ctx.quadraticCurveTo(8, 2, 0, 8);
    ctx.quadraticCurveTo(-8, 2, -22, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 9px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAT MAN', 0, 2);
    ctx.restore();
  };
  drawMiniBadge(cx, cy - R * 0.89);
  drawMiniBadge(cx - R * 0.88, cy);
  drawMiniBadge(cx + R * 0.88, cy);

  // Iconic vintage bat-wing silhouette & pointed cowl across the middle
  ctx.save();
  ctx.translate(cx, cy + 16);

  // White backing halo so the dark silhouette pops cleanly off the lavender grid
  const traceBat = (scale: number) => {
    ctx.beginPath();
    ctx.moveTo(0, -68 * scale);
    // Pointed bat ears & cowl
    ctx.lineTo(-10 * scale, -44 * scale);
    ctx.lineTo(-22 * scale, -66 * scale);
    ctx.lineTo(-26 * scale, -34 * scale);
    // Left bat wing sweeping out & down
    ctx.quadraticCurveTo(-82 * scale, -54 * scale, -148 * scale, -6 * scale);
    ctx.quadraticCurveTo(-162 * scale, 34 * scale, -172 * scale, 88 * scale);
    ctx.quadraticCurveTo(-110 * scale, 48 * scale, -56 * scale, 64 * scale);
    ctx.quadraticCurveTo(-24 * scale, 56 * scale, 0, 82 * scale);
    // Right bat wing (mirror)
    ctx.quadraticCurveTo(24 * scale, 56 * scale, 56 * scale, 64 * scale);
    ctx.quadraticCurveTo(110 * scale, 48 * scale, 172 * scale, 88 * scale);
    ctx.quadraticCurveTo(162 * scale, 34 * scale, 148 * scale, -6 * scale);
    ctx.quadraticCurveTo(82 * scale, -54 * scale, 26 * scale, -34 * scale);
    ctx.lineTo(22 * scale, -66 * scale);
    ctx.lineTo(10 * scale, -44 * scale);
    ctx.closePath();
  };

  traceBat(1.04);
  ctx.fillStyle = '#faf8f0';
  ctx.fill();

  traceBat(1.0);
  ctx.fillStyle = '#2d2926';
  ctx.fill();

  // Tiny classic comic face & white eyes inside the cowl
  ctx.fillStyle = '#f5e7d2';
  ctx.beginPath();
  ctx.arc(0, -14, 11, 0.1, Math.PI - 0.1);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-7, -23, 5, 3);
  ctx.fillRect(2, -23, 5, 3);

  // Bold 1980s red-orange "BAT" and "MAN" block letters with bright yellow outline
  ctx.font = '700 66px "IBM Plex Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const drawLogoWord = (word: string, x: number, y: number) => {
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#241f1c';
    ctx.lineWidth = 10;
    ctx.strokeText(word, x, y);
    ctx.strokeStyle = '#f5df4d';
    ctx.lineWidth = 6;
    ctx.strokeText(word, x, y);
    ctx.fillStyle = '#e54632';
    ctx.fillText(word, x, y);
  };

  drawLogoWord('BAT', -78, 22);
  drawLogoWord('MAN', 82, 22);

  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeWallShadowTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.24, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
  g.addColorStop(0.62, 'rgba(0, 0, 0, 0.45)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
