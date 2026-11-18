// A slingshot in hand, as a shooter's weapon: a forked hazel twig, gnome-sized, held out low in the middle,
// two bands of red rubber to a leather pouch with the pinch of spores in it. Hold and the pouch is drawn back at
// you, the bands stretching; let go and it snaps out past the fork, the bands quivering as it settles, and the
// fork kicks. It bobs with your steps and lags a little behind the turn of your head.
//
// Drawn on its own, over the finished picture, with its own camera at the eye (so the depth of field and the
// haze leave it alone, and it never goes into the moss), into a multisampled target since the scene has no
// antialiasing, then laid over the screen.
import * as THREE from 'three';

const WOOD = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
const CORD = new THREE.MeshStandardMaterial({ color: 0x3e2a1a, roughness: 0.7 }); // the leather thong of the grip
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x7a1c12, roughness: 0.55 });
const LEATHER = new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 0.75 });
const LOAD = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 1, emissive: 0x8a6a3a, emissiveIntensity: 0.4 });

// where the fork stands in the eye's space (metres; the eye is a gnome's, the slingshot a gnome's toy)
const AT = new THREE.Vector3(0, -0.049, -0.175); // centred, under the sight
const PULL = 0.055; // how far back the pouch comes at full draw

// ---- the wood, whittled: each piece a tube swept along a curve whose radius is carved point by point, so the cuts
// show in the outline and catch the light, coloured per vertex: grey-brown bark, the honey wood under it where
// it is peeled, the fresh faces of the cuts paler still and their bottoms darker
const C = (hex: number) => new THREE.Color(hex);
const BARK = C(0x45372b), BARK2 = C(0x8c7a62), PEELED = C(0xc39a63), FACE = C(0xdcb886), DEEP = C(0x7c5a36), END = C(0xd2b17e), PITH = C(0x8a6a44);
function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** What the knife left at a point: how deep (metres, inwards) and what colour. t runs 0..1 along the piece, a round it. */
type Carve = (t: number, a: number) => { cut: number; col: THREE.Color };
/** A tube along `curve`, its radius r(t) less the carving, closed with an end grain disc at each end. */
function whittle(curve: THREE.Curve<THREE.Vector3>, r: (t: number) => number, carve: Carve, segs = 140, round = 40, caps = [true, true]) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= round; j++) {
      const a = (j / round) * Math.PI * 2;
      const { cut, col: c } = carve(t, a);
      const rr = r(t) - cut;
      q.copy(p).addScaledVector(N, Math.cos(a) * rr).addScaledVector(B, Math.sin(a) * rr);
      pos.push(q.x, q.y, q.z);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < round; j++) {
    const a = i * (round + 1) + j, b = a + round + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  // the ends: cut across, pale with a darker pith
  for (const [i, sign] of [[0, -1], [segs, 1]] as const) {
    if (!caps[sign > 0 ? 1 : 0]) continue; // (no end where one piece goes into another)
    curve.getPointAt(i / segs, p);
    const centre = pos.length / 3;
    pos.push(p.x, p.y, p.z);
    col.push(PITH.r, PITH.g, PITH.b);
    const ring = i * (round + 1);
    for (let j = 0; j < round; j++) idx.push(...(sign > 0 ? [centre, ring + j, ring + j + 1] : [centre, ring + j + 1, ring + j]));
    for (let j = 0; j <= round; j++) { const k = (ring + j) * 3; col[k] = END.r; col[k + 1] = END.g; col[k + 2] = END.b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, WOOD);
}
/** Bark: rough, in grey-brown streaks along the grain, with now and then a lenticel. */
function bark(t: number, a: number, len: number, seed: number) {
  const along = t * len * 900, around = a * 3.2;
  // fissures along the grain: a noise stretched lengthwise, sharpened into ridges and the dark cracks between
  const f = vnoise(around * 2.4 + seed, along * 0.12), ridge = 1 - Math.abs(f * 2 - 1);
  const n = vnoise(around * 1.0 + seed, along * 0.25) * 0.5 + ridge * 0.5;
  const lent = vnoise(around * 2.2 + seed * 3, along * 0.5) > 0.84 ? 1 : 0; // little pale slits across
  return { cut: (1 - ridge) * 0.00045 + n * 0.0001 - lent * 0.0001, col: BARK.clone().lerp(BARK2, Math.pow(ridge, 1.5) * 0.85 + n * 0.15).lerp(PEELED, lent * 0.4) };
}
/** Peeled wood, smooth, a faint grain along it. */
function peeled(t: number, a: number, len: number) {
  const g = vnoise(a * 6, t * len * 2600);
  return { cut: 0, col: PEELED.clone().lerp(DEEP, g * 0.18) };
}

export class Slingshot {
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private rig = new THREE.Group(); // bob and sway
  private fork = new THREE.Group(); // kicks
  private pouchMesh: THREE.Group;
  private load: THREE.Mesh;
  private bands: THREE.Mesh[] = [];
  private tips: THREE.Vector3[];
  private rt: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sun: THREE.DirectionalLight;
  // the pouch on a spring along the line of the shot (0 at rest, negative drawn back at you)
  private x = 0;
  private v = 0;
  private draw = 0;
  private kick = 0;
  private kickV = 0;
  private loaded = 1;
  // down out of view and back, to reload or to swap the spores: how far down (0..1), whether it is going down,
  // how long it stays down, and the wait after a shot before it goes
  private lower = 0;
  private going = false;
  private downFor = 0;
  private reloadIn = -1;
  private lagYaw = 0;
  private lagPitch = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  visible = true;

  constructor() {
    this.cam = new THREE.PerspectiveCamera(40, 1, 0.003, 2);
    // the fork: a handle splitting into two arms that bow out and up
    const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
    // the handle, peeled: a grip wound with a leather thong at the bottom, above it a band of chip carving, two rows
    // of triangles cut in facing each other with a zigzag left standing between, a ring groove each side of it,
    // then the bark again up into the fork
    const hCurve = new THREE.CatmullRomCurve3([v(0.0012, -0.047), v(0.0004, -0.03), v(0, -0.012), v(0, 0)]);
    const HL = hCurve.getLength();
    const handle = whittle(hCurve, (t) => 0.0035 + 0.0004 * Math.pow(1 - t, 6) + 0.0003 * t, (t, a) => {
      if (t > 0.94) {
        const b = bark(t, a, HL, 1);
        return t < 0.97 ? { cut: b.cut + 0.0003 * (1 - (t - 0.94) / 0.03), col: b.col.lerp(PEELED, 1 - (t - 0.94) / 0.03) } : b; // the bark's edge, cut down to the wood
      }
      // ring grooves: a V each, its sides fresh, its bottom dark
      for (const g0 of [0.66, 0.92]) {
        const d = Math.abs(t - g0) / 0.014;
        if (d < 1) return { cut: 0.0006 * (1 - d), col: FACE.clone().lerp(DEEP, 1 - d) };
      }
      if (t > 0.675 && t < 0.905) {
        // chip carving: the band split into two rows; in each, triangles round it, the lower row's pointing up, the
        // upper's down, each cut in deepest at its centre; their sloping faces catch the light
        // (three rows of six round: nine round in two rows were tall slivers that read as stripes)
        const s2 = (t - 0.675) / 0.23 * 3, row = Math.min(2, Math.floor(s2)), sv = s2 - row;
        const u = (a / (Math.PI * 2)) * 6 + row * 0.5, fu = u - Math.floor(u);
        const w = Math.abs(fu - 0.5) * 2; // 0 at a triangle's middle, 1 at its sides
        const h = row % 2 ? 1 - sv : sv; // 0 at its base, 1 at its point
        const inside = 1 - w - h * 0.85;
        if (inside > 0) return { cut: Math.min(inside, 0.35) * 0.0022, col: FACE.clone().lerp(DEEP, Math.min(1, inside * 2.2)) };
        return peeled(t, a, HL);
      }
      return peeled(t, a, HL);
    }, 160, 48, [true, false]);
    this.fork.add(handle);
    // the grip: a leather thong wound round the bottom of the handle, a helix of it
    const turns = 11, h0 = -0.0455, h1 = -0.0265;
    const helix = new THREE.CatmullRomCurve3(Array.from({ length: turns * 16 + 1 }, (_, i) => {
      const u = i / (turns * 16), y = h0 + (h1 - h0) * u, a = u * turns * Math.PI * 2, r = 0.0042;
      return v(0.0011 - 0.0007 * u + Math.cos(a) * r, y, Math.sin(a) * r);
    }));
    this.fork.add(new THREE.Mesh(new THREE.TubeGeometry(helix, turns * 24, 0.00085, 8, false), CORD));
    // the arms, in their bark, peeled near the tips where the bands go round, a notch cut for them to sit in
    const arm = (pts: THREE.Vector3[], seed: number) => {
      const c = new THREE.CatmullRomCurve3(pts), L = c.getLength();
      return whittle(c, (t) => 0.0031 - 0.0007 * t + 0.0004 * Math.exp(-Math.pow((t - 0.42) / 0.05, 2)), (t, a) => {
        if (t > 0.8) {
          const d = Math.abs(t - 0.88) / 0.025;
          if (d < 1) return { cut: 0.0007 * (1 - d * d), col: FACE.clone().lerp(DEEP, 1 - d) }; // the notch
          return peeled(t, a, L);
        }
        return bark(t, a, L, seed); // (the bump at 0.42 a knot where a twig was taken off)
      }, 120, 32, [false, true]);
    };
    this.fork.add(arm([v(0, -0.002), v(-0.008, 0.008), v(-0.015, 0.02), v(-0.016, 0.033)], 5));
    this.fork.add(arm([v(0, -0.002), v(0.008, 0.009), v(0.014, 0.021), v(0.015, 0.032)], 9));
    // the crotch: a swelling of bark where the arms part
    const knot = whittle(new THREE.CatmullRomCurve3([v(0, -0.006), v(0, -0.001), v(0, 0.004)]), (t) => 0.0036 + 0.0012 * Math.sin(t * Math.PI), (t, a) => { const b = bark(t, a, 0.01, 3); b.cut *= 0.25; return b; }, 20, 32, [false, false]); // smoothed: the fissures crossed there in a jumble
    this.fork.add(knot);
    this.tips = [v(-0.0158, 0.0298), v(0.0148, 0.0288)];
    // the bands are wound round just below the tips
    for (const t of this.tips) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.0029, 0.0009, 12, 32), RUBBER);
      wrap.position.copy(t);
      wrap.rotation.x = Math.PI / 2;
      this.fork.add(wrap);
    }
    // the pouch: a patch of leather cupped round the load
    this.pouchMesh = new THREE.Group();
    const leather = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 48, 32, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), LEATHER);
    leather.rotation.x = -Math.PI / 2;
    leather.scale.set(1.0, 0.75, 0.6);
    leather.material = LEATHER.clone();
    (leather.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    this.pouchMesh.add(leather);
    this.load = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 40, 28), LOAD);
    this.load.position.set(0, 0.0032, -0.001); // peeking over the leather's edge
    this.pouchMesh.add(this.load);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 1, 14), RUBBER);
      this.bands.push(b);
      this.rig.add(b);
    }
    this.rig.add(this.fork, this.pouchMesh);
    this.scene.add(this.rig);
    // lit as the scene is: the low gold sun, a warm dim fill
    this.scene.add(new THREE.HemisphereLight(0xb8a27a, 0x2a2416, 0.9));
    this.sun = new THREE.DirectionalLight(0xffd7a0, 2.2);
    this.scene.add(this.sun, this.sun.target);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    const mat = new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  }

  setSize(w: number, h: number, fov: number, aspect: number) {
    this.rt.setSize(w, h);
    this.cam.fov = fov;
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  /** Where the pouch is in the world now, for the shot to leave from. */
  pouchWorld(eye: THREE.Camera, out = new THREE.Vector3()) {
    this.rig.updateMatrixWorld();
    return eye.localToWorld(this.pouchMesh.getWorldPosition(out));
  }

  /** Let go: the pouch snaps out, the fork kicks, it is empty a moment. */
  fire() {
    // a flick on a phone fires without a draw: as if drawn halfway
    if (this.x > -PULL * 0.4) this.x = -PULL * 0.5;
    this.draw = 0;
    this.kickV += 9;
    this.loaded = 0;
    this.reloadIn = 0.26; // the snap and quiver first, then down to reload
  }

  /** Other spores: down out of view and up again with them. */
  swap() {
    this.going = true;
    this.downFor = 0.05;
  }

  update(dt: number, eye: THREE.Camera, sunDir: THREE.Vector3, charging: boolean, bob: number, walking: number, yaw: number, pitch: number) {
    // drawn while held; a spring otherwise, which overshoots past the fork and quivers back
    this.draw += ((charging ? 1 : 0) - this.draw) * Math.min(1, dt * (charging ? 3.5 : 20));
    if (charging) { this.x += (-PULL * this.draw - this.x) * Math.min(1, dt * 12); this.v = 0; }
    else {
      this.v += (-this.x * 1400 - this.v * 9) * dt;
      this.x += this.v * dt;
    }
    this.kickV += (-this.kick * 500 - this.kickV * 18) * dt;
    this.kick += this.kickV * dt;
    // a shot: after the snap, down super quick, filled while out of sight, and up again
    if (this.reloadIn > 0 && (this.reloadIn -= dt) <= 0) { this.going = true; this.downFor = 0.04; }
    if (this.going) {
      this.lower = Math.min(1, this.lower + dt / 0.08);
      if (this.lower >= 1 && (this.downFor -= dt) <= 0) {
        this.going = false;
        this.loaded = 1;
        this.x = 0; this.v = 0;
      }
    } else this.lower = Math.max(0, this.lower - dt / 0.15);
    const e = this.lower * this.lower * (3 - 2 * this.lower);
    // lags behind the head: turning right, it trails left, and catches up
    const dy = yaw - this.lastYaw, dp = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    this.lagYaw = (this.lagYaw + dy * 0.6) * Math.exp(-dt * 9);
    this.lagPitch = (this.lagPitch + dp * 0.6) * Math.exp(-dt * 9);
    // held out, bobbing with the steps
    const bx = Math.sin(bob) * 0.003 * walking, by = -Math.abs(Math.cos(bob)) * 0.003 * walking;
    this.rig.position.set(AT.x + bx + this.lagYaw * 0.05, AT.y + by - this.lagPitch * 0.05 + 0.006 * this.draw - 0.075 * e, AT.z);
    this.rig.rotation.set(-0.12 + this.kick * 0.25 - 0.6 * e, this.lagYaw * 0.4, -0.04 + Math.sin(bob) * 0.03 * walking);
    this.fork.position.z = this.kick * 0.006;
    // the pouch: between the tips, drawn back along the shot (toward the eye: +z in the rig), a little down
    const mid = this.tips[0].clone().add(this.tips[1]).multiplyScalar(0.5);
    this.pouchMesh.position.set(mid.x, mid.y - 0.003 + this.x * 0.15, mid.z + 0.004 - this.x);
    this.pouchMesh.rotation.x = -this.x * 4;
    this.load.visible = this.loaded > 0.5;
    (this.load.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 0.8 * this.draw;
    // the bands: from each tip to the pouch's sides
    for (let i = 0; i < 2; i++) {
      const a = this.tips[i].clone().add(this.fork.position);
      const b = this.pouchMesh.position.clone().add(new THREE.Vector3(i ? 0.006 : -0.006, 0, 0));
      const m = this.bands[i];
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.set(1 - 0.35 * this.draw, a.distanceTo(b), 1 - 0.35 * this.draw); // thinner stretched
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    // the sun as the eye sees it
    this.sun.position.copy(sunDir).transformDirection(eye.matrixWorldInverse);
    this.sun.target.position.set(0, 0, 0);
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.visible) return;
    const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quad, this.quadCam);
    renderer.autoClear = auto;
  }
}
