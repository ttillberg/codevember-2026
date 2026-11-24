// The human eye. Either it is the sphere itself, right under the films (world.next.eye),
// or it sits smaller inside a frosted jelly sphere (world.next.jelly).
//
// Anatomy & optics:
// - Custom +Z polar sphere geometry with a smooth C2 corneal dome bulge and subtle
//   external scleral sulcus right at the limbus (apex at radius 1.0, never clipping films).
// - Pre-baked high-res iris (pale blue, sea-green, warm amber-brown central heterochromia)
//   and vascular sclera textures (eyeBake.ts) paired with a lightweight optical shader
//   (eyeShader.ts) for corneal refraction, caustics, and radial pupil stretch.
// - Living oculomotor behavior: smooth pursuit, physiological saccades with slight
//   overshoot, micro-saccades + fine tremor, and pupillary light/exposure/near reflexes
//   (including reacting as films are peeled away to let studio light hit the eye).

import {
  BufferAttribute, BufferGeometry, DirectionalLight, Matrix3, Matrix4, Mesh,
  MeshPhysicalMaterial, Quaternion, Vector3,
} from 'three';
import { R } from './state';
import type { Ctx, Module } from './state';
import { idAt } from './filmops';
import { R_PUPIL_REF, bakeEyeTextures } from './eyeBake';
import { eyeFragmentHooks, eyeFragmentPars, eyeVertexMain, eyeVertexPars } from './eyeShader';

// Anatomical proportions (human eyeball: ~24mm globe, ~12mm corneal/iris diameter).
const LIMBUS = 31.5 * Math.PI / 180; // ~0.55 rad -> sin(31.5°) ≈ 0.522 of globe radius
const CORNEA_IOR = 1.376;            // real human cornea / aqueous humor IOR
const R_SCLERA = 0.979;              // scleral globe radius (corneal apex sits at 1.000)

// Pupil radii in iris radii (real human pupil: ~1.8mm constricted .. ~7mm dilated on ~11.8mm iris).
const PUPIL_MIN  = 0.17; // bright light / strong near focus
const PUPIL_REST = 0.34; // calm indoor studio light
const PUPIL_DARK = 0.52; // covered by opaque films or dark backdrop
const PUPIL_MAX  = 0.58;

// Oculomotor dynamics (human gaze: smooth pursuit + ballistic saccades + micro-saccades + drift).
const PURSUIT = { w: 10.5, z: 0.72 }; // smooth following with subtle organic damping
const SACCADE = { w: 52,   z: 0.84 }; // crisp ballistic jump with tiny physiological overshoot
const SACCADE_AT = 0.13;              // rad error threshold to fire a saccade
const MICRO = 0.0085;                 // subtle micro-saccade amplitude (rad)
const MAX_YAW = 0.64;                 // ~37 deg comfortable horizontal gaze range
const MAX_PITCH = 0.46;               // ~26 deg comfortable vertical gaze range

const JELLY_RADIUS = 0.52 * R;

// Smooth C2 corneal dome & external scleral sulcus profile r(theta), with r(0) = 1.000.
function eyeRadius(theta: number): number {
  const u = theta / LIMBUS;
  const t = Math.max(0, Math.min(1, 1 - u / 1.08));
  // Quintic smoothstep dome rising +0.021 above sclera to apex 1.000
  const dome = (1.0 - R_SCLERA) * (t * t * t * (t * (t * 6 - 15) + 10));
  // Subtle external scleral sulcus dip right around the limbus (u ≈ 1.02)
  const ds = (u - 1.02) / 0.16;
  const sulcus = -0.0028 * Math.exp(-ds * ds);
  return R_SCLERA + dome + sulcus;
}

// Build a +Z-axis polar sphere so triangle rings align concentrically with the cornea &
// limbal sulcus, with denser ring spacing across the cornea and exact analytic normals.
function createEyeballGeometry(): BufferGeometry {
  const radialSegs = 128;
  // Build non-uniform theta rings: high density on cornea & limbus, smooth across sclera
  const thetas: number[] = [];
  const frontRings = 44;  // 0 .. 42 deg
  const backRings = 56;   // 42 .. 180 deg
  const split = 42 * Math.PI / 180;
  for (let i = 0; i <= frontRings; i++) {
    thetas.push((i / frontRings) * split);
  }
  for (let i = 1; i <= backRings; i++) {
    const t = i / backRings;
    thetas.push(split + t * (Math.PI - split));
  }

  const ringCount = thetas.length;
  const cols = radialSegs + 1;
  const verts = ringCount * cols;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);

  const eps = 1e-4;
  for (let iy = 0; iy < ringCount; iy++) {
    const th = thetas[iy];
    const r = eyeRadius(th);
    const dr = (eyeRadius(Math.min(Math.PI, th + eps)) - eyeRadius(Math.max(0, th - eps))) /
      (Math.min(Math.PI, th + eps) - Math.max(0, th - eps) || 1);
    const sinTh = Math.sin(th);
    const cosTh = Math.cos(th);

    // Analytic outward normal for surface r(theta): normalize(r * e_r - dr * e_theta)
    const nr = r;
    const nt = -dr;
    const nLen = Math.hypot(nr, nt) || 1;
    const cR = nr / nLen;
    const cT = nt / nLen;
    // In cylindrical (rho, z): e_r = (sinTh, cosTh), e_theta = (cosTh, -sinTh)
    const nRho = cR * sinTh + cT * cosTh;
    const nZ   = cR * cosTh - cT * sinTh;

    for (let ix = 0; ix <= radialSegs; ix++) {
      const u = ix / radialSegs;
      const ph = u * Math.PI * 2;
      const cosPh = Math.cos(ph);
      const sinPh = Math.sin(ph);

      const idx = iy * cols + ix;
      pos[idx * 3]     = r * sinTh * cosPh;
      pos[idx * 3 + 1] = r * sinTh * sinPh;
      pos[idx * 3 + 2] = r * cosTh;

      nrm[idx * 3]     = nRho * cosPh;
      nrm[idx * 3 + 1] = nRho * sinPh;
      nrm[idx * 3 + 2] = nZ;

      uvs[idx * 2]     = u;
      uvs[idx * 2 + 1] = 1 - th / Math.PI;
    }
  }

  const indices: number[] = [];
  for (let iy = 0; iy < ringCount - 1; iy++) {
    for (let ix = 0; ix < radialSegs; ix++) {
      const a = iy * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Right-handed outward winding (viewed from +Z)
      if (iy > 0) indices.push(a, c, b);
      if (iy < ringCount - 2) indices.push(b, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function createEye(ctx: Ctx): Module {
  const { world, renderer, scene, camera } = ctx;
  const darkMode = new URLSearchParams(location.search).has('dark');

  const geo = createEyeballGeometry();
  const baked = bakeEyeTextures(LIMBUS, renderer.capabilities.getMaxAnisotropy());

  const mat = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 0.72,
  });

  const rLimb = eyeRadius(LIMBUS);
  const irisZ = rLimb * Math.cos(LIMBUS);
  const limbR = rLimb * Math.sin(LIMBUS);

  const uniforms = {
    tIrisCol:   { value: baked.irisColor },
    tIrisData:  { value: baked.irisData },
    tScleraCol: { value: baked.scleraColor },
    tScleraNrm: { value: baked.scleraNormal },
    uCam:       { value: new Vector3(0, 0, 5) },
    uLight:     { value: new Vector3(0, 0, 1) },
    uToView:    { value: new Matrix3() },
    uPupil:     { value: PUPIL_REST },
    uPupilRef:  { value: R_PUPIL_REF },
    uGlow:      { value: 0 },
    uLimbAngle: { value: LIMBUS },
    uLimbR:     { value: limbR },
    uIrisZ:     { value: irisZ },
    uIor:       { value: CORNEA_IOR },
  };

  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${eyeVertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${eyeVertexMain}`);
    let f = s.fragmentShader.replace(
      '#include <clipping_planes_pars_fragment>',
      `#include <clipping_planes_pars_fragment>\n${eyeFragmentPars}`,
    );
    for (const [at, code] of eyeFragmentHooks) f = f.replace(at, `${at}\n${code}`);
    s.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'human-eye-v1';

  const eye = new Mesh(geo, mat);
  eye.visible = false;
  scene.add(eye);

  const FRONT = new Vector3(0, 0, 1);
  const dir = new Vector3(), eyeAt = new Vector3(), ray = new Vector3(), toLight = new Vector3(0, 0, 1);
  const half = new Vector3(), tmp = new Vector3(), probe = new Vector3();
  const q = new Quaternion(), qi = new Quaternion(), rotInv = new Quaternion();
  const m4 = new Matrix4();
  let light: DirectionalLight | null | undefined;

  // Gaze state: spring toward target + physiological micro-saccades + slow ocular drift
  const gaze = { x: 0, y: 0, vx: 0, vy: 0 };
  const target = { x: 0, y: 0 };
  const micro = { x: 0, y: 0, tx: 0, ty: 0, next: 0.35 };
  let jumping = 0;
  let fixate = 0.8;
  let pupilR = PUPIL_REST;
  let exposureSmooth = 0.5;
  let lastX = -1, lastY = -1, speed = 0, time = 0;

  // 5-point front sampling offsets for measuring how much film currently shades the pupil
  const PROBES = [
    [0, 0, 1],
    [0.24, 0, 0.97],
    [-0.24, 0, 0.97],
    [0, 0.24, 0.97],
    [0, -0.24, 0.97],
  ];

  // Estimate light transmission through whichever films cover the front of the eyeball (0..1).
  function measureLightExposure(whole: boolean): number {
    if (!whole || !world.show.films || world.films.length === 0) return 1;
    rotInv.copy(world.rotation).invert();
    let sum = 0;
    for (let p = 0; p < PROBES.length; p++) {
      probe.set(PROBES[p][0], PROBES[p][1], PROBES[p][2]).applyQuaternion(rotInv);
      let trans = 1;
      for (let k = 0; k < world.films.length; k++) {
        if (idAt(world.films[k], probe.x, probe.y, probe.z) !== 0) {
          trans *= 1 - world.layers[k].opacity * 0.85;
        }
      }
      sum += trans;
    }
    return sum / PROBES.length;
  }

  function softClamp(v: number, lim: number): number {
    return lim * Math.tanh(v / lim);
  }

  function aim(dt: number) {
    const look = world.look;
    if (look.on) {
      const w = window.innerWidth, h = window.innerHeight;
      eyeAt.setFromMatrixPosition(camera.matrixWorld);
      ray.set((look.x / w) * 2 - 1, -(look.y / h) * 2 + 1, 0.5).unproject(camera).sub(eyeAt).normalize();
      const t = (eyeAt.z - 1.65 * R) / Math.max(1e-3, -ray.z);
      tmp.copy(eyeAt).addScaledVector(ray, t).normalize();
      target.x = softClamp(Math.atan2(tmp.x, tmp.z), MAX_YAW);
      target.y = softClamp(Math.asin(Math.max(-1, Math.min(1, tmp.y))), MAX_PITCH);
    } else if ((fixate -= dt) <= 0) {
      // Natural idle fixation: mostly holds calm eye contact, with brief curious glances
      if (Math.random() < 0.55) {
        fixate = 1.4 + Math.random() * 2.8;
        target.x = (Math.random() - 0.5) * 0.05;
        target.y = (Math.random() - 0.5) * 0.04;
      } else {
        fixate = 0.65 + Math.random() * 1.4;
        target.x = (Math.random() - 0.5) * 0.48;
        target.y = (Math.random() - 0.5) * 0.28;
      }
    }
  }

  function move(dt: number) {
    const ex = target.x - gaze.x, ey = target.y - gaze.y;
    const err = Math.hypot(ex, ey);
    if (jumping <= 0 && err > SACCADE_AT) jumping = 0.045 + err * 0.11;
    jumping -= dt;
    const s = jumping > 0 ? SACCADE : PURSUIT;
    const n = Math.ceil(dt / 0.004);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      gaze.vx += (s.w * s.w * (target.x - gaze.x) - 2 * s.z * s.w * gaze.vx) * h;
      gaze.vy += (s.w * s.w * (target.y - gaze.y) - 2 * s.z * s.w * gaze.vy) * h;
      gaze.x += gaze.vx * h;
      gaze.y += gaze.vy * h;
    }

    // Physiological micro-saccades (tiny quick fixation adjustments 1-3x/sec)
    if ((micro.next -= dt) <= 0) {
      micro.next = 0.26 + Math.random() * 0.72;
      const a = Math.random() * Math.PI * 2;
      const r = MICRO * (0.35 + Math.random() * 0.65);
      micro.tx = micro.tx * 0.28 + Math.cos(a) * r;
      micro.ty = micro.ty * 0.28 + Math.sin(a) * r;
    }
    const k = 1 - Math.exp(-48 * dt);
    micro.x += (micro.tx - micro.x) * k;
    micro.y += (micro.ty - micro.y) * k;
  }

  function updatePupil(dt: number, whole: boolean) {
    const look = world.look;
    const w = window.innerWidth, h = window.innerHeight;
    const fovY = (camera.fov * Math.PI) / 180;
    const radius = whole ? R : JELLY_RADIUS;
    const px = (radius / (camera.position.z * Math.tan(fovY / 2))) * (h / 2);

    const v = dt > 0 && lastX >= 0 ? Math.hypot(look.x - lastX, look.y - lastY) / dt : 0;
    lastX = look.x; lastY = look.y;
    speed += ((look.on ? v : 0) - speed) * (1 - Math.exp(-5 * dt));

    // Light reaching the pupil: films covering it shade it; peeling them floods light in
    const expNow = measureLightExposure(whole);
    exposureSmooth += (expNow - exposureSmooth) * (1 - Math.exp(-3.5 * dt));

    // Direct light reflex when turning towards the key light
    const lightAlign = Math.max(0, dir.dot(toLight) - 0.52) / 0.48;
    // Near triad / accommodation reflex when pointer or peeling finger is right over the eye
    const near = look.on ? Math.max(0, 1 - Math.hypot(look.x - w / 2, look.y - h / 2) / (1.25 * px)) : 0;
    // Brief attentive dilation on sudden fast pointer motion across the visual field
    const startled = Math.min(1, speed / (5.5 * px)) * 0.065;
    const fingerNear = world.finger.active ? 0.42 : 0;

    // Ambient baseline adapts to film cover and light/dark backdrop
    const ambientBase = darkMode ? PUPIL_DARK * 0.88 : PUPIL_REST;
    const base = ambientBase + (1 - exposureSmooth) * (PUPIL_DARK - ambientBase);

    // Subtle living pupillary hippus (gentle organic physiological oscillation ~0.2-0.5 Hz)
    const hippus =
      0.014 * Math.sin(time * 0.72) +
      0.009 * Math.sin(time * 1.63 + 1.1) +
      0.005 * Math.sin(time * 2.87 + 2.4);

    // Light & near focus constrict; sudden motion briefly dilates
    const constrict = Math.min(1, near * 0.48 + fingerNear * 0.45 + lightAlign * 0.58 * exposureSmooth);
    const want = Math.min(
      PUPIL_MAX,
      Math.max(PUPIL_MIN, base + (PUPIL_MIN - base) * constrict + startled + hippus),
    );

    // Asymmetric human iris musculature: sphincter constricts briskly (~0.28s), dilator relaxes slowly (~1.1s)
    const rate = want < pupilR ? 4.2 : 1.05;
    pupilR += (want - pupilR) * (1 - Math.exp(-rate * dt));
    uniforms.uPupil.value = pupilR;
  }

  return {
    update(dt) {
      const whole = world.next.eye;
      eye.visible = whole || world.next.jelly !== null;
      if (!eye.visible) return;
      time += dt;

      // Corneal apex is at radius 1.0, so 0.9975 * R keeps the entire eye cleanly under the films
      eye.scale.setScalar(whole ? 0.9975 * R : JELLY_RADIUS);

      if (light === undefined) {
        light = (scene.children.find((o) => o instanceof DirectionalLight) as DirectionalLight) ?? null;
      }
      if (light) toLight.copy(light.position).sub(light.target.position).normalize();

      aim(dt);
      move(dt);

      // Slow fine physiological ocular drift on top of gaze + micro-saccades
      const driftX = 0.0032 * Math.sin(time * 0.53 + 0.4) + 0.0018 * Math.sin(time * 1.31);
      const driftY = 0.0026 * Math.cos(time * 0.47 + 1.2) + 0.0014 * Math.sin(time * 1.17);
      const yaw = gaze.x + micro.x + driftX;
      const pitch = gaze.y + micro.y + driftY;

      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      eye.quaternion.copy(q.setFromUnitVectors(FRONT, dir));
      updatePupil(dt, whole);

      // Camera & key light in eye-local space for the lightweight optical shader
      eye.updateMatrixWorld();
      camera.updateMatrixWorld();
      eyeAt.setFromMatrixPosition(camera.matrixWorld);
      uniforms.uCam.value.copy(eyeAt).applyMatrix4(m4.copy(eye.matrixWorld).invert());
      qi.copy(eye.quaternion).invert();
      uniforms.uLight.value.copy(toLight).applyQuaternion(qi);
      uniforms.uToView.value.getNormalMatrix(m4.multiplyMatrices(camera.matrixWorldInverse, eye.matrixWorld));

      // Subtle red retinal reflex only when eye looks closely between camera and key light
      half.copy(eyeAt).normalize().add(toLight).normalize();
      uniforms.uGlow.value = Math.pow(Math.max(0, dir.dot(half)), 28);
    },
  };
}
