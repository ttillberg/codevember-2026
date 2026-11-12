// The eye. Either it is the sphere itself, right under the films (world.next.eye), or it
// sits small in the middle of a jelly sphere (world.next.jelly), blurred by it. It watches
// the pointer, and the finger while it pulls.
//
// A tree frog's eye: an orange iris under a clear wet dome, a vertical slit pupil, a
// blue-black band and a thin cream rim round it. All of it is drawn in the shader
// (eyeShader.ts) on a plain sphere; this file moves it: gaze, micro-saccades, the pupil.

import {
  Color, DirectionalLight, Matrix3, Matrix4, Mesh, MeshPhysicalMaterial, Quaternion,
  SphereGeometry, Vector3, Vector4,
} from 'three';
import { R } from './state';
import type { Ctx, Module } from './state';
import { eyeFragmentHooks, eyeFragmentPars, eyeVertexMain, eyeVertexPars } from './eyeShader';

// Look. Colours are sRGB.
const COLORS = {
  irisMid: '#a8380a',   // the iris, yellower in the middle
  irisEdge: '#7a1806',  // deeper red-orange towards the rim
  irisLine: '#e07a34',  // the pale net between the cells
  fleck: '#7c170a',     // darker red flecks
  band: '#0b0c16',      // the blue-black band round the iris
  bandHi: '#2c2c56',    // its blue-violet sheen
  cream: '#c9c08e',     // the thin rim outside it
  back: '#0a0d18',      // the back of the ball, blue-black...
  backWarm: '#3a1910',  // ...into dark red-brown
  vessel: '#6a1a10',
  retina: '#ff5a1e',    // the glow inside the pupil
};
const LIMBUS = 55 * Math.PI / 180; // the dome's edge, from the axis
const DEPTH = 0.2;      // how far below the dome's top the iris lies, in radii
const IOR = 1.34;       // of the dome, bends the view onto the iris
const CELLS = 11;       // cells across one iris radius
const BUMP = 0.25;        // relief of the cells
const SLIT_LEN = 0.74;  // pupil half length, iris radii
const SLIT_TILT = 0.12; // rad
const SLIT_MIN = 0.012; // pupil half width shut down to a hairline...
const SLIT_REST = 0.085; // ...at rest...
const SLIT_MAX = 0.3;   // ...and wide open, iris radii

// Life.
const PURSUIT = { w: 9, z: 0.5 };   // spring following the pointer: overshoots a little
const SACCADE = { w: 48, z: 0.8 };  // fast jump when the target is far
const SACCADE_AT = 0.14;            // rad of error that triggers a jump
const MICRO = 0.012;                // micro-saccade size, rad

const RADIUS = 0.5 * R;

export function createEye(ctx: Ctx): Module {
  const { world, scene, camera } = ctx;
  const geo = new SphereGeometry(1, 128, 96);
  const mat = new MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.45, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.8,
  });

  // the iris cap: a sphere through the dome's edge, DEPTH below its top
  const cL = Math.cos(LIMBUS), sL = Math.sin(LIMBUS);
  const top = 1 - DEPTH;
  const zc = (top * top - 1) / (2 * (top - cL));
  const col = (k: keyof typeof COLORS) => ({ value: new Color(COLORS[k]) });
  const uniforms = {
    uCam: { value: new Vector3(0, 0, 5) },
    uLight: { value: new Vector3(0, 0, 1) },
    uToView: { value: new Matrix3() },
    uSlit: { value: SLIT_REST },
    uSlitLen: { value: SLIT_LEN },
    uSlitTilt: { value: SLIT_TILT },
    uGlow: { value: 0 },
    uLimbCos: { value: cL },
    uLimbR: { value: sL },
    uIrisSph: { value: new Vector4(0, 0, zc, top - zc) },
    uIor: { value: IOR },
    uCellScale: { value: CELLS },
    uBump: { value: BUMP },
    cIrisMid: col('irisMid'), cIrisEdge: col('irisEdge'), cIrisLine: col('irisLine'), cFleck: col('fleck'),
    cBand: col('band'), cBandHi: col('bandHi'), cCream: col('cream'), cBack: col('back'),
    cBackWarm: col('backWarm'), cVessel: col('vessel'), cRetina: col('retina'),
  };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${eyeVertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${eyeVertexMain}`);
    let f = s.fragmentShader.replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${eyeFragmentPars}`);
    for (const [at, code] of eyeFragmentHooks) f = f.replace(at, `${at}\n${code}`);
    s.fragmentShader = f;
  };

  const eye = new Mesh(geo, mat);
  eye.visible = false;
  scene.add(eye);

  const FRONT = new Vector3(0, 0, 1);
  const dir = new Vector3(), eyeAt = new Vector3(), ray = new Vector3(), toLight = new Vector3(0, 0, 1);
  const half = new Vector3(), tmp = new Vector3();
  const q = new Quaternion(), qi = new Quaternion();
  const m4 = new Matrix4();
  let light: DirectionalLight | null | undefined;

  // gaze as yaw/pitch, a spring towards the target, micro-saccades on top
  const gaze = { x: 0, y: 0, vx: 0, vy: 0 };
  const target = { x: 0, y: 0 };
  const micro = { x: 0, y: 0, tx: 0, ty: 0, next: 0.3 };
  let jumping = 0;           // seconds left in a saccade
  let fixate = 0;            // idle: seconds till it looks somewhere else
  let slit = SLIT_REST;
  let lastX = -1, lastY = -1, speed = 0, time = 0;

  function aim(dt: number) {
    const look = world.look;
    if (look.on) {
      // the point under the pointer, a little in front of the sphere
      const w = window.innerWidth, h = window.innerHeight;
      eyeAt.setFromMatrixPosition(camera.matrixWorld);
      ray.set((look.x / w) * 2 - 1, -(look.y / h) * 2 + 1, 0.5).unproject(camera).sub(eyeAt).normalize();
      const t = (eyeAt.z - 1.6 * R) / Math.max(1e-3, -ray.z);
      tmp.copy(eyeAt).addScaledVector(ray, t).normalize();
      target.x = Math.atan2(tmp.x, tmp.z);
      target.y = Math.asin(Math.max(-1, Math.min(1, tmp.y)));
    } else if ((fixate -= dt) <= 0) {
      // nobody there: it looks out at you, now and then somewhere else for a moment
      fixate = 0.6 + Math.random() * 2.6;
      if (Math.random() < 0.45) { target.x = 0; target.y = 0; }
      else { target.x = (Math.random() - 0.5) * 0.6; target.y = (Math.random() - 0.5) * 0.36; }
    }
  }

  function move(dt: number) {
    const ex = target.x - gaze.x, ey = target.y - gaze.y;
    if (jumping <= 0 && Math.hypot(ex, ey) > SACCADE_AT) jumping = 0.05 + Math.hypot(ex, ey) * 0.12;
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
    // micro-saccades: tiny quick jumps a few times a second, pulled back to the target
    if ((micro.next -= dt) <= 0) {
      micro.next = 0.18 + Math.random() * 0.6;
      const a = Math.random() * Math.PI * 2, r = MICRO * (0.4 + Math.random() * 0.6);
      micro.tx = micro.tx * 0.3 + Math.cos(a) * r;
      micro.ty = micro.ty * 0.3 + Math.sin(a) * r;
    }
    const k = 1 - Math.exp(-55 * dt);
    micro.x += (micro.tx - micro.x) * k;
    micro.y += (micro.ty - micro.y) * k;
  }

  function pupil(dt: number, whole: boolean) {
    const look = world.look;
    // how close the pointer is to the eye on screen, and how fast it moves
    const w = window.innerWidth, h = window.innerHeight;
    const fovY = (camera.fov * Math.PI) / 180;
    const radius = whole ? R : RADIUS;
    const px = (radius / (camera.position.z * Math.tan(fovY / 2))) * (h / 2);
    const v = dt > 0 && lastX >= 0 ? Math.hypot(look.x - lastX, look.y - lastY) / dt : 0;
    lastX = look.x; lastY = look.y;
    speed += ((look.on ? v : 0) - speed) * (1 - Math.exp(-6 * dt));
    const near = look.on ? Math.max(0, 1 - Math.hypot(look.x - w / 2, look.y - h / 2) / (1.3 * px)) : 0;
    const fast = Math.min(1, speed / (4 * px));
    const finger = world.finger.active ? 0.85 : 0;
    // looking towards the light closes it a little
    const bright = Math.max(0, dir.dot(toLight) - 0.6) / 0.4;
    const stim = Math.min(1, Math.max(near * 0.6, fast, finger) + bright * 0.4);
    // slow breathing of the pupil (hippus) when nothing happens, wider when alone
    const hippus = 0.022 * Math.sin(time * 0.8) + 0.014 * Math.sin(time * 1.93 + 1.3) + 0.008 * Math.sin(time * 3.1 + 0.4);
    const rest = (look.on ? SLIT_REST : SLIT_REST * 1.9) + hippus;
    const want = Math.min(SLIT_MAX, Math.max(SLIT_MIN, rest + (SLIT_MIN - rest) * stim));
    // it shuts fast and opens slowly
    slit += (want - slit) * (1 - Math.exp(-(want < slit ? 7 : 1.1) * dt));
    uniforms.uSlit.value = slit;
  }

  return {
    update(dt) {
      const whole = world.next.eye;
      eye.visible = whole || world.next.jelly !== null;
      if (!eye.visible) return;
      time += dt;
      // as the sphere it fills it, a hair under the lowest film
      eye.scale.setScalar(whole ? 0.9975 * R : RADIUS);

      if (light === undefined) light = (scene.children.find((o) => o instanceof DirectionalLight) as DirectionalLight) ?? null;
      if (light) toLight.copy(light.position).sub(light.target.position).normalize();

      aim(dt);
      move(dt);
      const yaw = gaze.x + micro.x, pitch = gaze.y + micro.y;
      dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      eye.quaternion.copy(q.setFromUnitVectors(FRONT, dir));
      pupil(dt, whole);

      // camera and light in the eye's own space, for the shader
      eye.updateMatrixWorld();
      camera.updateMatrixWorld();
      eyeAt.setFromMatrixPosition(camera.matrixWorld);
      uniforms.uCam.value.copy(eyeAt).applyMatrix4(m4.copy(eye.matrixWorld).invert());
      qi.copy(eye.quaternion).invert();
      uniforms.uLight.value.copy(toLight).applyQuaternion(qi);
      uniforms.uToView.value.getNormalMatrix(m4.multiplyMatrices(camera.matrixWorldInverse, eye.matrixWorld));
      // the glow inside shows when the eye looks between the light and the camera
      half.copy(eyeAt).normalize().add(toLight).normalize();
      uniforms.uGlow.value = Math.pow(Math.max(0, dir.dot(half)), 24);
    },
  };
}
