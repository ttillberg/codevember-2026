import * as THREE from 'three';

// What else is in the air, all of it sparse and quiet:
//   motes – specks of dust drifting on a slow breeze, catching the light as they turn
//   down  – now and then a ruffle shakes loose a wisp of down that floats away
//   fly   – once in a long while a small fly zips through, mostly out of focus
//   seeds – a passing parachute seed, carried across on the breeze (via the seed system)
// The down and the fly write depth, so the lens blurs them by their own distance.
// A speck of dust is too small for that (a blur gather averages it away): it
// draws itself as the disc the lens would make of it, adding a little light.

const MOTES = 40;
const AMBIENT = 17;

export interface AmbientOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** where the middle of the picture is (the bird) */
  center: THREE.Vector3;
  /** the lens (post's depth-of-field uniforms): out-of-focus specks are drawn as faint discs */
  dof?: () => Record<string, THREE.IUniform>;
  /** let a parachute seed drift across: start point and breeze */
  passSeed?: (at: THREE.Vector3, wind: THREE.Vector3) => void;
}

interface Down {
  obj: THREE.Mesh;
  vel: THREE.Vector3;
  /** the way it was thrown: it keeps drifting that way a while */
  away: THREE.Vector3;
  age: number;
  life: number;
  fall: number;
  phase: number;
  spin: number;
}

function downTexture() {
  // a wisp of down: a short shaft, soft barbs all along it, fluffier at the base
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const x0 = 32;
  g.globalAlpha = 0.9;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x0, 92);
  g.quadraticCurveTo(x0 + 2, 50, x0 - 1, 14);
  g.stroke();
  for (let i = 0; i < 70; i++) {
    const u = rnd();
    const y = 90 - u * 76;
    const x = x0 + (1 - u) * 1.5;
    const side = rnd() < 0.5 ? -1 : 1;
    const len = (10 + rnd() * 16) * (0.55 + 0.8 * Math.sin(Math.PI * (0.15 + u * 0.8)));
    const a = side * (0.5 + rnd() * 0.7);
    g.globalAlpha = 0.25 + rnd() * 0.45;
    g.lineWidth = 0.7 + rnd() * 0.7;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.sin(a) * len * 0.5, y - Math.cos(a) * len * 0.3, x + Math.sin(a) * len, y - Math.cos(a) * len * (0.4 + rnd() * 0.5) + (rnd() - 0.5) * 6);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAmbient(o: AmbientOptions) {
  const { scene, camera, renderer, center } = o;
  const group = new THREE.Group();
  group.name = 'ambient';
  scene.add(group);

  // --- motes -------------------------------------------------------------------
  const pos = new Float32Array(MOTES * 3);
  const size = new Float32Array(MOTES);
  const seed = new Float32Array(MOTES);
  const vel: THREE.Vector3[] = [];
  const age = new Float32Array(MOTES);
  const life = new Float32Array(MOTES).fill(-1); // < 0: free
  const base = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    seed[i] = Math.random();
    vel.push(new THREE.Vector3());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uMinPx: { value: 1.2 }, uTime: { value: 0 }, uFocus: { value: 3.3 }, uAperture: { value: 0 }, uMaxCoc: { value: 14 }, uDpr: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      uniform float uScale, uMinPx, uTime, uFocus, uAperture, uMaxCoc, uDpr;
      varying float vGlint, vCov;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float z = -mv.z;
        float px = aSize * uScale / z;
        // the lens's blur circle here, as post works it out (CSS px radius)
        float coc = min(uAperture * abs(1.0 / uFocus - 1.0 / z) * (uFocus / 3.3), uMaxCoc) * uDpr;
        float sharp = max(px, uMinPx);
        float d = max(sharp, coc * 1.6);
        // the same light spread over a bigger disc, kept from vanishing entirely
        vCov = clamp(px / uMinPx, 0.0, 1.0) * clamp(pow(sharp / d, 2.0) * 1.2, 0.07, 1.0);
        gl_PointSize = aSize > 0.0 ? d : 0.0;
        // a flake turning in the light: mostly dull, now and then it catches
        float k = uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0;
        vGlint = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(k) * sin(k * 2.3 + 1.0), 3.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlint, vCov;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float a = (1.0 - smoothstep(0.4, 1.0, r)) * vCov;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * vGlint * a * 0.9, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
  });
  const motes = new THREE.Points(geo, moteMat);
  motes.frustumCulled = false;
  group.add(motes);

  function spawnMote(i: number, at: THREE.Vector3 | null, v: THREE.Vector3 | null, lifeS: number) {
    if (at) pos.set([at.x, at.y, at.z], i * 3);
    else {
      // somewhere around the bird, more of them behind than in front
      pos[i * 3] = center.x + (Math.random() - 0.5) * 3.6;
      pos[i * 3 + 1] = center.y + (Math.random() - 0.45) * 2.0;
      pos[i * 3 + 2] = center.z - 1.7 + Math.random() * 3.1;
    }
    vel[i].copy(v ?? new THREE.Vector3());
    age[i] = 0;
    life[i] = lifeS;
    // mostly tiny specks, a few bigger flakes
    base[i] = Math.random() < 0.85 ? 0.0025 + Math.random() * 0.003 : 0.006 + Math.random() * 0.005;
  }
  const free = () => {
    for (let i = 0; i < MOTES; i++) if (life[i] < 0) return i;
    return -1;
  };

  // --- down ------------------------------------------------------------------
  const downGeo = new THREE.PlaneGeometry(0.04, 0.06);
  downGeo.translate(0, 0.012, 0);
  const downMat = new THREE.MeshStandardMaterial({
    color: 0xc4bec8,
    map: downTexture(),
    roughness: 1,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    alphaTest: 0.04,
  });
  const downs: Down[] = [];

  // --- fly ---------------------------------------------------------------------
  const fly = new THREE.Group();
  const flyBody = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.008, 0.0075, 0.02), new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.45 }));
  const wingGeo = new THREE.CircleGeometry(0.014, 10).scale(1, 0.55, 1).translate(0.014, 0, 0);
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xdfe6e0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const flyWings = [new THREE.Mesh(wingGeo, wingMat), new THREE.Mesh(wingGeo, wingMat)];
  for (const w of flyWings) {
    // flat over the back, then beat about the body's long axis
    w.rotation.order = 'ZXY';
    w.rotation.x = -Math.PI / 2;
    w.position.y = 0.004;
  }
  flyWings[1].scale.x = -1;
  fly.add(flyBody, ...flyWings);
  fly.visible = false;
  group.add(fly);
  let flyCurve: THREE.CatmullRomCurve3 | null = null;
  let flyT = 0;
  let flyDur = 2;
  let flyAt = 25 + Math.random() * 40;
  const flyPrev = new THREE.Vector3();

  function flyBy() {
    // across the frame, behind or in front of the bird, on a buzzing wavy line;
    // now and then right past it
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = Math.random();
    const z = r < 0.4 ? -0.7 + Math.random() * 0.5 : r < 0.8 ? -0.15 + Math.random() * 0.55 : 0.8 + Math.random() * 0.6;
    const y0 = center.y + (Math.random() - 0.4) * 1.0;
    const pts: THREE.Vector3[] = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      pts.push(new THREE.Vector3(center.x + side * (-2.6 + 5.2 * u), y0 + (Math.random() - 0.5) * 0.35 + Math.sin(u * 5) * 0.08, z + (Math.random() - 0.5) * 0.4));
    }
    flyCurve = new THREE.CatmullRomCurve3(pts);
    flyT = 0;
    flyDur = 2.2 + Math.random() * 1.4;
    fly.visible = true;
    fly.position.copy(pts[0]);
    flyPrev.copy(pts[0]);
  }

  // --- passing seeds -------------------------------------------------------------
  let seedAt = 15 + Math.random() * 25;
  function passSeed() {
    if (!o.passSeed) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const at = new THREE.Vector3(center.x - side * 2.3, center.y + 0.5 + Math.random() * 0.7, center.z - 1.3 + Math.random() * 2.4);
    o.passSeed(at, new THREE.Vector3(side * (0.07 + Math.random() * 0.05), 0.012, (Math.random() - 0.5) * 0.02));
  }

  // --- wind ----------------------------------------------------------------------
  const wind = new THREE.Vector3();
  const dbs = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  let time = 0;

  for (let i = 0; i < AMBIENT; i++) {
    spawnMote(i, null, null, 8 + Math.random() * 18);
    age[i] = Math.random() * life[i];
  }

  return {
    group,
    /** a ruffle: dust off the plumage, and sometimes a wisp of down. at: a spot on the body; out: away from it */
    shed(at: THREE.Vector3, out: THREE.Vector3, feather: boolean) {
      const n = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        const i = free();
        if (i < 0) break;
        tmp.copy(out).multiplyScalar(0.06 + Math.random() * 0.08);
        tmp.x += (Math.random() - 0.5) * 0.08;
        tmp.y += 0.02 + Math.random() * 0.06;
        tmp.z += (Math.random() - 0.5) * 0.08;
        spawnMote(i, new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.08, at.y + (Math.random() - 0.5) * 0.12, at.z + (Math.random() - 0.5) * 0.08), tmp, 4 + Math.random() * 5);
        base[i] *= 0.8;
      }
      if (!feather) return;
      const obj = new THREE.Mesh(downGeo, downMat);
      obj.position.copy(at);
      obj.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      obj.scale.setScalar(0.01);
      group.add(obj);
      downs.push({
        obj,
        vel: out.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.1, 0)),
        away: out.clone().multiplyScalar(0.06),
        age: 0,
        life: 16 + Math.random() * 10,
        fall: 0.045 + Math.random() * 0.03,
        phase: Math.random() * 100,
        spin: (Math.random() - 0.5) * 1.5,
      });
    },
    /** let the fly through now (debug, settings) */
    flyBy,
    /** where the fly is, if it is within `r` of `p` */
    flyNear(p: THREE.Vector3, r: number): THREE.Vector3 | null {
      return fly.visible && fly.position.distanceTo(p) < r ? fly.position : null;
    },
    update(dt: number) {
      time += dt;
      moteMat.uniforms.uTime.value = time;
      renderer.getDrawingBufferSize(dbs);
      moteMat.uniforms.uScale.value = dbs.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      moteMat.uniforms.uMinPx.value = 1.3 * renderer.getPixelRatio();
      moteMat.uniforms.uDpr.value = renderer.getPixelRatio();
      const lens = o.dof?.();
      if (lens) {
        moteMat.uniforms.uFocus.value = lens.uFocus.value;
        moteMat.uniforms.uAperture.value = lens.uAperture.value;
        moteMat.uniforms.uMaxCoc.value = lens.uMaxCoc.value;
      }
      // a slow breeze that turns and dies down
      wind.set(Math.sin(time * 0.07) * 0.025 + Math.sin(time * 0.19 + 1) * 0.01, Math.sin(time * 0.11) * 0.006, Math.cos(time * 0.05) * 0.015);

      let live = 0;
      for (let i = 0; i < MOTES; i++) if (life[i] >= 0) live++;
      for (let i = 0; i < MOTES; i++) {
        if (life[i] < 0) {
          size[i] = 0;
          // keep the ambient few alive
          if (live < AMBIENT && Math.random() < dt * 2) {
            spawnMote(i, null, null, 10 + Math.random() * 18);
            live++;
          }
          continue;
        }
        age[i] += dt;
        if (age[i] > life[i]) {
          life[i] = -1;
          size[i] = 0;
          continue;
        }
        const s = seed[i] * 50;
        const k = time * 0.4 + s;
        // its own wander on top of the breeze, settling slowly
        tmp.set(Math.sin(k * 1.3) * 0.012, Math.sin(k * 0.9 + 2) * 0.008 - 0.004, Math.cos(k * 1.1) * 0.01).add(wind);
        vel[i].lerp(tmp, 1 - Math.exp(-dt * 0.8));
        pos[i * 3] += vel[i].x * dt;
        pos[i * 3 + 1] += vel[i].y * dt;
        pos[i * 3 + 2] += vel[i].z * dt;
        // fades in and out by shrinking: they come and go, they never pop
        const u = age[i] / life[i];
        size[i] = base[i] * Math.min(1, u * 6, (1 - u) * 6);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;

      for (const d of downs) {
        d.age += dt;
        const k = time + d.phase;
        // a leaf's fall, slowed right down: it sways side to side and tips with the swing
        tmp.set(Math.sin(k * 1.4) * 0.05, -d.fall + Math.sin(k * 2.8) * 0.012, Math.cos(k * 1.1) * 0.03).add(wind).addScaledVector(d.away, Math.exp(-d.age * 0.25));
        d.vel.lerp(tmp, 1 - Math.exp(-dt * 1.2));
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.y += d.spin * dt;
        d.obj.rotation.z = Math.sin(k * 1.4) * 0.6;
        d.obj.rotation.x = 0.3 + Math.cos(k * 1.1) * 0.35;
        d.obj.scale.setScalar(Math.max(0, Math.min(1, d.age * 3, (d.life - d.age) * 0.5)));
      }
      for (let i = downs.length - 1; i >= 0; i--) {
        if (downs[i].age > downs[i].life) {
          group.remove(downs[i].obj);
          downs.splice(i, 1);
        }
      }

      if (dt > 0 && time > flyAt && !fly.visible) {
        flyBy();
        flyAt = time + 50 + Math.random() * 70;
      }
      if (fly.visible && flyCurve) {
        flyT += dt / flyDur;
        if (flyT >= 1) {
          fly.visible = false;
          flyCurve = null;
        } else {
          flyPrev.copy(fly.position);
          // quick in, a moment's hover somewhere in the middle, quick out
          flyCurve.getPointAt(THREE.MathUtils.clamp(flyT + (0.8 * Math.sin(Math.PI * 2 * flyT)) / (Math.PI * 2), 0, 1), fly.position);
          // jitter: a fly never flies a clean line
          fly.position.x += Math.sin(time * 37) * 0.006;
          fly.position.y += Math.sin(time * 29 + 1) * 0.008;
          if (fly.position.distanceToSquared(flyPrev) > 1e-8) fly.lookAt(tmp.copy(fly.position).sub(flyPrev).add(fly.position));
          const beat = Math.sin(time * 210) * 0.7;
          flyWings[0].rotation.z = beat;
          flyWings[1].rotation.z = -beat;
        }
      }

      if (dt > 0 && time > seedAt) {
        passSeed();
        seedAt = time + 35 + Math.random() * 45;
      }
    },
  };
}
