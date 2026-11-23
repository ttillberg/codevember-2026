import * as THREE from 'three';

interface Rocket {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  color: THREE.Color;
  accent: THREE.Color;
}

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  age: number;
  life: number;
  size: number;
  twinkle: number;
}

interface BurstFlash {
  pos: THREE.Vector3;
  color: THREE.Color;
  life: number;
  maxLife: number;
}

const C64_FIREWORK_PALETTE = [
  [0x70e8ff, 0xffffff], // VIC-II cyan + white crackle
  [0xffe15a, 0xff9a3c], // C64 yellow + warm amber gold
  [0xff5e62, 0xffc371], // coral red + peach
  [0x74f28c, 0xd8ff96], // C64 bright green + lime
  [0xd284ff, 0x86c5ff], // C64 light purple + sky blue
];

const MAX_SPARKS = 1400;

/**
 * 3D celebratory fireworks bursting behind and above the Commodore 1702 monitor
 * when the user successfully writes and runs an Echo program on the C64!
 * Casts live colored PointLight flashes onto the Swedish wallpaper and desk.
 */
export class EchoFireworks {
  readonly root = new THREE.Group();

  private readonly rockets: Rocket[] = [];
  private readonly sparks: Spark[] = [];
  private readonly flashes: BurstFlash[] = [];
  private readonly pendingLaunches: { delay: number; x: number; targetY: number }[] = [];

  private readonly positions = new Float32Array(MAX_SPARKS * 3);
  private readonly colors = new Float32Array(MAX_SPARKS * 3);
  private readonly trailPositions = new Float32Array(MAX_SPARKS * 6);
  private readonly trailColors = new Float32Array(MAX_SPARKS * 6);
  private readonly geo: THREE.BufferGeometry;
  private readonly trailGeo: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private readonly burstLight: THREE.PointLight;
  private readonly onPop?: () => void;

  constructor(onPop?: () => void) {
    this.onPop = onPop;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: 0.24,
      map: makeSparkSpriteTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.root.add(this.points);

    // Fine velocity-aligned glowing spark streaks so every starburst blooms with real firework trails!
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    this.trailGeo.setDrawRange(0, 0);

    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trails = new THREE.LineSegments(this.trailGeo, trailMat);
    trails.frustumCulled = false;
    this.root.add(trails);

    // Live dynamic light flash that illuminates the Swedish wallpaper, CRT bezel, and clock!
    this.burstLight = new THREE.PointLight(0xffffff, 0, 14, 1.5);
    this.burstLight.position.set(0, 3.6, -2.0);
    this.root.add(this.burstLight);
  }

  /** Launch a celebratory multi-salvo fireworks show behind and around the monitor! */
  celebrate() {
    const schedule = [
      { delay: 0.0, x: -2.45, targetY: 3.15 },
      { delay: 0.24, x: 2.35, targetY: 2.85 },
      { delay: 0.56, x: -0.25, targetY: 3.85 },
      { delay: 0.92, x: -3.05, targetY: 2.55 },
      { delay: 1.24, x: 2.75, targetY: 3.25 },
      { delay: 1.68, x: 0.85, targetY: 3.92 },
      { delay: 2.08, x: -2.15, targetY: 3.45 },
      { delay: 2.42, x: 2.10, targetY: 2.70 },
      { delay: 2.82, x: -0.95, targetY: 3.88 },
    ];
    for (const item of schedule) {
      this.pendingLaunches.push(item);
    }
  }

  private launchRocket(x: number, targetY: number) {
    const pair = C64_FIREWORK_PALETTE[Math.floor(Math.random() * C64_FIREWORK_PALETTE.length)];
    const z = -2.25 + (Math.random() - 0.5) * 0.65;
    const startY = 1.05;
    const fuse = 0.40 + Math.random() * 0.14;
    // Exact initial vy so the rocket peaks cleanly at targetY right in front of the wallpaper!
    const vy = (targetY - startY + 0.5 * 2.4 * fuse * fuse) / fuse;
    this.rockets.push({
      pos: new THREE.Vector3(x, startY, z),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.45, vy, (Math.random() - 0.5) * 0.18),
      fuse,
      color: new THREE.Color(pair[0]),
      accent: new THREE.Color(pair[1]),
    });
  }

  private detonate(r: Rocket) {
    this.onPop?.();

    this.flashes.push({
      pos: r.pos.clone(),
      color: r.color.clone(),
      life: 0.34,
      maxLife: 0.34,
    });

    const count = 95;
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) break;
      // Spherical starburst distribution with slight organic speed jitter
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const speed = (1.35 + Math.random() * 1.45) * (i % 7 === 0 ? 0.55 : 1.0);

      const vx = Math.sin(phi) * Math.cos(theta) * speed;
      const vy = Math.cos(phi) * speed * 0.92 + 0.35;
      const vz = Math.sin(phi) * Math.sin(theta) * speed * 0.45; // keep mostly clear of the back wall

      const useAccent = Math.random() < 0.32;
      this.sparks.push({
        pos: r.pos.clone(),
        vel: new THREE.Vector3(vx, vy, vz),
        color: (useAccent ? r.accent : r.color).clone(),
        age: 0,
        life: 1.05 + Math.random() * 0.65,
        size: 1.0,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt: number) {
    // 1. Trigger scheduled launches
    for (let i = this.pendingLaunches.length - 1; i >= 0; i--) {
      this.pendingLaunches[i].delay -= dt;
      if (this.pendingLaunches[i].delay <= 0) {
        this.launchRocket(this.pendingLaunches[i].x, this.pendingLaunches[i].targetY);
        this.pendingLaunches.splice(i, 1);
      }
    }

    // 2. Step ascending rockets & emit warm comet trail sparks
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.pos.addScaledVector(r.vel, dt);
      r.vel.y -= 2.4 * dt;
      r.fuse -= dt;

      if (this.sparks.length < MAX_SPARKS) {
        this.sparks.push({
          pos: r.pos.clone(),
          vel: new THREE.Vector3(
            (Math.random() - 0.5) * 0.35,
            -0.4 - Math.random() * 0.4,
            (Math.random() - 0.5) * 0.25,
          ),
          color: new THREE.Color(0xffdfa0),
          age: 0,
          life: 0.28 + Math.random() * 0.14,
          size: 0.7,
          twinkle: 0,
        });
      }

      if (r.fuse <= 0 || r.pos.y > 4.65) {
        this.detonate(r);
        this.rockets.splice(i, 1);
      }
    }

    // 3. Step starburst sparks with gravity, air drag & twinkle fade
    const drag = Math.pow(0.26, dt);
    let drawCount = 0;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.multiplyScalar(drag);
      s.vel.y -= 1.45 * dt; // soft firework droop
      s.pos.addScaledVector(s.vel, dt);
      // Keep sparks in front of the bedroom wall (z = -3.45)
      if (s.pos.z < -3.32) s.pos.z = -3.32;

      const t = s.age / s.life;
      const fade = Math.pow(1 - t, 1.35);
      const crackle = t > 0.55 ? 0.65 + 0.35 * Math.sin(s.age * 36 + s.twinkle) : 1.0;
      const brightness = fade * crackle * 1.45;

      const idx = drawCount * 3;
      this.positions[idx] = s.pos.x;
      this.positions[idx + 1] = s.pos.y;
      this.positions[idx + 2] = s.pos.z;

      const rCol = Math.min(1, s.color.r * brightness);
      const gCol = Math.min(1, s.color.g * brightness);
      const bCol = Math.min(1, s.color.b * brightness);
      this.colors[idx] = rCol;
      this.colors[idx + 1] = gCol;
      this.colors[idx + 2] = bCol;

      // Velocity streak tail (head -> faded tail)
      const tIdx = drawCount * 6;
      const tailScale = 0.085;
      this.trailPositions[tIdx] = s.pos.x;
      this.trailPositions[tIdx + 1] = s.pos.y;
      this.trailPositions[tIdx + 2] = s.pos.z;
      this.trailPositions[tIdx + 3] = s.pos.x - s.vel.x * tailScale;
      this.trailPositions[tIdx + 4] = s.pos.y - s.vel.y * tailScale;
      this.trailPositions[tIdx + 5] = s.pos.z - s.vel.z * tailScale;

      this.trailColors[tIdx] = rCol;
      this.trailColors[tIdx + 1] = gCol;
      this.trailColors[tIdx + 2] = bCol;
      this.trailColors[tIdx + 3] = rCol * 0.12;
      this.trailColors[tIdx + 4] = gCol * 0.12;
      this.trailColors[tIdx + 5] = bCol * 0.12;

      drawCount++;
    }

    this.geo.setDrawRange(0, drawCount);
    this.trailGeo.setDrawRange(0, drawCount * 2);
    if (drawCount > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.trailGeo.attributes.position.needsUpdate = true;
      this.trailGeo.attributes.color.needsUpdate = true;
    }

    // 4. Update dynamic burst illumination light
    if (this.flashes.length > 0) {
      let strongest = this.flashes[0];
      for (let i = this.flashes.length - 1; i >= 0; i--) {
        const f = this.flashes[i];
        f.life -= dt;
        if (f.life <= 0) {
          this.flashes.splice(i, 1);
        } else if (f.life / f.maxLife > strongest.life / strongest.maxLife) {
          strongest = f;
        }
      }
      if (this.flashes.length > 0) {
        const intensity = Math.pow(strongest.life / strongest.maxLife, 1.6) * 8.5;
        this.burstLight.position.copy(strongest.pos);
        this.burstLight.color.copy(strongest.color);
        this.burstLight.intensity = intensity;
      } else {
        this.burstLight.intensity = 0;
      }
    } else if (this.burstLight.intensity > 0) {
      this.burstLight.intensity = 0;
    }
  }
}

function makeSparkSpriteTexture(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.22, 'rgba(255, 252, 235, 0.92)');
  g.addColorStop(0.55, 'rgba(255, 235, 190, 0.30)');
  g.addColorStop(1.0, 'rgba(255, 220, 150, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
