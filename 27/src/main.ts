import * as THREE from 'three';
import { World, sstep } from './world';
import { U, LIGHT_COL, SHADOW_RES, cookie, soilMaterial, soilDepthMaterial, depthMaterial } from './gfx';
import { Post } from './post';
import { mulberry32 } from './noise';
import { Rocks } from './rocks';
import { Flora } from './flora';
import { Dust } from './dust';
import { buildGrass, buildHerbs } from './outside';
import { buildFungi } from './fungi';
import { Beast } from './beast';
import { Den, buildDebris } from './den';
import { Fog } from './fog';
import { Growth } from './growth';

const params = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (params.has('clean')) document.body.classList.add('clean');
// ?auto: crawls in by itself (clips, process videos)
const auto = params.has('auto');

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = true;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.012, 80);
const post = new Post(renderer);
// the air: ?nofog for the frame without it
const fog = new Fog(matchMedia('(pointer: coarse)').matches ? 12 : 20);
fog.on = !params.has('nofog');

// ---- the world ----
const t0 = performance.now();
const world = new World(27);
const rnd = mulberry32(2711);
const rocks = new Rocks(world, rnd);
const soil = new THREE.Mesh(world.buildGeometry(), soilMaterial(params.has('flat')));
soil.frustumCulled = false;
scene.add(soil);
// laid down first as depth only, so the costly soil shader runs once per pixel however the tunnels overlap
const soilPre = new THREE.Mesh(soil.geometry, soilDepthMaterial());
soilPre.frustumCulled = false;
soilPre.renderOrder = -5;
scene.add(soilPre);
const rockMeshes = rocks.build(rnd);
const flora = new Flora(world, rnd);
const dust = new Dust(world);
const grass = buildGrass(world, rnd);
// (their own dice, so that adding them moved nothing else)
const herbs = buildHerbs(world, mulberry32(1127));
/** the hillside's plants: drawn only while they can be seen */
const hillside = [grass, herbs];
// what grows: moss by the mouth, root felt and mould inside, round the roots and the stones (growth.ts)
const growth = new Growth(world, rocks.sets, flora.rootPts);
const LAYERS = matchMedia('(pointer: coarse)').matches ? 6 : 10;
const grown: THREE.Object3D[] = [];
{
  const onSoil = growth.dress(soil.geometry, false), onRoots = growth.dress(flora.roots.geometry, true);
  if (onSoil) grown.push(growth.shells(onSoil, LAYERS, 1));
  if (onRoots) grown.push(growth.shells(onRoots, Math.max(4, LAYERS - 4), 0.45));
  grown.push(growth.tufts(rnd));
  console.log(`growth: shells over ${(onSoil?.index!.count ?? 0) / 3} + ${(onRoots?.index!.count ?? 0) / 3} triangles, ${LAYERS} layers`);
}
scene.add(...grown);
const fungi = buildFungi(world, growth, mulberry32(3301));
scene.add(fungi.mesh);
scene.add(...rockMeshes, flora.roots, flora.hairs, grass, herbs, dust.crumbs, dust.motes);
/** dirt comes down from p: the crumbs, and the dust they leave hanging in the air behind them */
function crumble(p: THREE.Vector3, amount: number, size = 1) {
  dust.crumble(p, amount, size);
  fog.puff(tmpC.copy(p).setY(p.y - 0.06), 0.35 + amount * 0.75, 0.05 + 0.03 * amount, 0.2 + 0.2 * amount, 4 + 3 * amount, -0.32);
}
rocks.onShift = (p, amount) => crumble(p, 0.5 + amount * 0.6);
flora.onTug = (p) => crumble(p, 0.25, 0.7);
const den = new Den(world, rnd, flora.pixel);
scene.add(den.group);
den.onStir = (p) => crumble(p, 1.1);
const debris = buildDebris(world, rnd);
scene.add(debris.mesh);
console.log(`burrow: ${world.nx}×${world.ny}×${world.nz} cells, ${soil.geometry.index!.count / 3} triangles, ${(performance.now() - t0) | 0} ms`);

U.uMouth.value.copy(world.entrance).add(new THREE.Vector3(0, 0.12, 0.2));
world.puddles.forEach((p, i) => U.uPuddle.value[i].set(p.x, p.y, p.z, p.r));

// the sky seen from the hole: overcast, one flat pale grey with nothing in it, far brighter than anything the torch can do
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(60, 24, 12),
  new THREE.ShaderMaterial({
    uniforms: { uSky: U.uSky, uDay: U.uDay },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); }`,
    fragmentShader: `precision highp float; varying vec3 vD; uniform vec3 uSky; uniform float uDay;
      void main(){ gl_FragColor = vec4(vec3(0.93, 0.94, 0.96) * uDay, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  }),
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

// ---- the torch's shadow ----
const shadowDepth = new THREE.DepthTexture(SHADOW_RES, SHADOW_RES, THREE.UnsignedIntType);
shadowDepth.compareFunction = THREE.LessEqualCompare;
shadowDepth.minFilter = shadowDepth.magFilter = THREE.LinearFilter;
const shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, { depthTexture: shadowDepth, depthBuffer: true });
const lightCam = new THREE.PerspectiveCamera(112, 1, 0.02, 18);
const depthMat = depthMaterial();
/** what the torch throws a shadow of, and with which depth-only material */
const casters: { obj: THREE.Mesh | THREE.Points | THREE.LineSegments; depth: THREE.Material; keep?: THREE.Material | THREE.Material[] }[] = [
  { obj: soil, depth: depthMat }, { obj: flora.roots, depth: depthMat }, { obj: flora.hairs, depth: flora.hairDepth },
  ...rockMeshes.map((obj) => ({ obj, depth: depthMat })),
  ...den.casters,
  { obj: debris.mesh, depth: debris.depth },
  { obj: fungi.mesh, depth: fungi.depth },
];
const noShadow: THREE.Object3D[] = [sky, dust.motes, dust.crumbs, grass, herbs, soilPre, ...grown];
// and the other thing that lives here (beast.ts): it comes when its model has loaded
const beast = new Beast(world, mulberry32(666));
scene.add(beast.group);
beast.onReady = () => { casters.push(...beast.casters); noShadow.push(...beast.noShadow); };
beast.onSnap = (p) => fog.puff(p, 0.9, 0.06, 0.3, 3.5, -0.1);

// ---- look, crawl ----
const SPEED = 1.05;
/** one full cycle of the front paws, left then right, in metres of ground covered */
const STRIDE = 0.55;
const nav = { e: 0, s: 0, dir: 1, v: 0, sign: 1, entered: false, step: 0 };
const look = { yaw: 0, pitch: 0, yawT: 0, pitchT: 0, yaw0: 0, pitch0: 0 };
const aim = { x: 0, y: 0, mouse: false };
const input = { down: false, id: -1, x: 0, y: 0, x0: 0, y0: 0, t: 0, moved: 0, mode: '' as '' | 'look' | 'crawl', fwd: false, back: false, left: false, right: false, wheel: 0 };

const camPos = new THREE.Vector3();
const camQ = new THREE.Quaternion();
const lookDir = new THREE.Vector3();
const lightPos = new THREE.Vector3();
const lightDir = new THREE.Vector3(0, 0, -1);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
let travelled = 0;
let torchReach = 1;
let bob = 0;
/** where we are in the stride: the left forepaw lands at 0, the right at π */
let gait = 0;
const basePos = new THREE.Vector3();
const gaitOff = new THREE.Vector3();

{
  const e = world.edges[0];
  world.railPoint(e, 0, camPos);
  const d = world.railPoint(e, e.len, tmpA).sub(camPos).normalize();
  look.yaw = look.yawT = look.yaw0 = Math.atan2(-d.x, -d.z);
  look.pitch = look.pitchT = look.pitch0 = Math.asin(d.y) - 0.02;
}

function fromYawPitch(yaw: number, pitch: number, out: THREE.Vector3) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

canvas.addEventListener('pointerdown', (ev) => {
  if (input.down) return;
  canvas.setPointerCapture(ev.pointerId);
  Object.assign(input, { down: true, id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t: performance.now(), moved: 0, mode: '' });
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerType === 'mouse') {
    aim.mouse = true;
    aim.x = (ev.clientX / innerWidth) * 2 - 1;
    aim.y = 1 - (ev.clientY / innerHeight) * 2;
  }
  if (!input.down || ev.pointerId !== input.id) return;
  const dx = ev.clientX - input.x, dy = ev.clientY - input.y;
  input.x = ev.clientX; input.y = ev.clientY;
  input.moved = Math.hypot(ev.clientX - input.x0, ev.clientY - input.y0);
  if (!input.mode && input.moved > (ev.pointerType === 'mouse' ? 5 : 12)) input.mode = 'look';
  if (input.mode) {
    const k = (camera.fov * Math.PI) / 180 / innerHeight;
    look.yawT += dx * k * 1.15;
    look.pitchT += dy * k * 1.15;
  }
});
const release = (ev: PointerEvent) => {
  if (ev.pointerId !== input.id) return;
  if (!input.mode && performance.now() - input.t < 260) nav.step = 1.4; // a tap: one short dash
  input.down = false;
  input.mode = '';
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); input.wheel += -ev.deltaY * 0.0022; input.wheel = Math.max(-1.2, Math.min(1.2, input.wheel)); }, { passive: false });
const key = (ev: KeyboardEvent, on: boolean) => {
  switch (ev.code) {
    case 'KeyW': case 'ArrowUp': input.fwd = on; break;
    case 'KeyS': case 'ArrowDown': input.back = on; break;
    case 'KeyA': case 'ArrowLeft': input.left = on; break;
    case 'KeyD': case 'ArrowRight': input.right = on; break;
    default: return;
  }
  ev.preventDefault();
};
addEventListener('keydown', (ev) => key(ev, true));
addEventListener('keyup', (ev) => key(ev, false));

function switchEdge(node: number, over: number, moveDir: THREE.Vector3) {
  let best = -1, bestDot = -Infinity;
  for (const i of world.adj[node]) {
    const c = world.edges[i];
    if (i === nav.e || (c.open && nav.entered)) continue;
    world.railTangent(c, c.a === node ? 0.15 : c.len - 0.15, tmpC);
    if (c.a !== node) tmpC.negate();
    const d = tmpC.dot(moveDir);
    if (d > bestDot) { bestDot = d; best = i; }
  }
  const cur = world.edges[nav.e];
  if (best < 0) { nav.s = cur.a === node ? 0 : cur.len; nav.v = 0; nav.step = 0; return; }
  const c = world.edges[best];
  nav.e = best;
  nav.s = c.a === node ? over : c.len - over;
  nav.dir = (c.a === node ? 1 : -1) * nav.sign;
}

/** A forepaw comes down: side -1 left, +1 right. Grit jumps from under it. */
const pawPos = new THREE.Vector3(), pawBack = new THREE.Vector3();
function footfall(side: number) {
  if (!nav.entered || nav.v < SPEED * 0.4) return;
  pawBack.set(lookDir.x, 0, lookDir.z).normalize();
  pawPos.copy(camPos).addScaledVector(pawBack, 0.12).addScaledVector(tmpC.set(-pawBack.z, 0, pawBack.x), side * 0.085);
  const t = world.march(pawPos, tmpC.set(0, -1, 0), 0.5);
  if (t >= 0.5) return;
  pawPos.y -= t - 0.006;
  dust.kick(pawPos, pawBack.multiplyScalar(-nav.sign), 9 + Math.floor(Math.random() * 10));
  // and a little cloud of it that we leave behind us
  fog.puff(pawPos, 0.5, 0.05, 0.27, 2.6, 0.14);
}

function crawl(dt: number) {
  if (input.down && !input.mode && performance.now() - input.t > 240) input.mode = 'crawl';
  let want = 0;
  if (input.mode === 'crawl' || input.fwd) want = 1;
  else if (input.back) want = -1;
  if (Math.abs(input.wheel) > 0.01) {
    want = Math.sign(input.wheel);
    input.wheel -= Math.sign(input.wheel) * Math.min(Math.abs(input.wheel), dt * SPEED * 1.6);
  }
  if (nav.step > 0 && !want) want = 1;
  if (auto && clock > 1.2 && !want) want = 1;
  // it has us: no running
  if (beast.holds) { want = 0; nav.v *= Math.exp(-dt / 0.05); }
  if (want) nav.sign = want;
  nav.v += ((want ? SPEED : 0) - nav.v) * (1 - Math.exp(-dt / 0.18));
  if (nav.v < 1e-4) return;
  const e = world.edges[nav.e];
  world.railTangent(e, nav.s, tmpA);
  const d = tmpA.dot(lookDir);
  if (Math.abs(d) > 0.15) nav.dir = Math.sign(d);
  // each paw pushes: the ground comes in surges, not at a steady rate
  const ds = nav.v * dt * (1 + 0.18 * Math.cos(2 * gait - 1.6));
  const before = Math.floor(gait / Math.PI);
  gait += (ds / STRIDE) * 2 * Math.PI;
  if (Math.floor(gait / Math.PI) !== before) footfall(Math.floor(gait / Math.PI) % 2 === 0 ? -1 : 1);
  nav.step = Math.max(0, nav.step - ds);
  travelled += ds;
  nav.s += nav.dir * nav.sign * ds;
  tmpB.copy(lookDir).multiplyScalar(nav.sign);
  if (nav.s > e.len) switchEdge(e.b, nav.s - e.len, tmpB);
  else if (nav.s < 0) switchEdge(e.a, -nav.s, tmpB);
  if (!world.edges[nav.e].open && !nav.entered) { nav.entered = true; document.body.classList.add('inside'); }
}

function wrapPi(a: number) { return a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI; }

function updateCamera(dt: number, time: number) {
  const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  look.yawT += turn * dt * 1.5;
  const e = world.edges[nav.e];
  // the path pulls the eye along while crawling, unless a finger is steering
  const moving = nav.v / SPEED;
  if (moving > 0.05 && input.mode !== 'look' && !turn) {
    const ahead = nav.s + nav.dir * nav.sign * 0.8;
    world.railPoint(e, ahead, tmpA).sub(world.railPoint(e, nav.s, tmpB));
    if (tmpA.lengthSq() > 0.02 && nav.sign > 0) {
      tmpA.normalize();
      const k = (1 - Math.exp(-dt / 0.3)) * moving;
      look.yawT += wrapPi(Math.atan2(-tmpA.x, -tmpA.z) - look.yawT) * k;
      look.pitchT += (Math.asin(tmpA.y) * 0.8 - look.pitchT) * k * 0.6;
    }
  }
  // before the hole there is only the hole to look at
  if (!nav.entered) {
    const lim = 0.4 + 2.8 * sstep(0.45, 1.0, nav.s / e.len);
    look.yawT = look.yaw0 + Math.max(-lim, Math.min(lim, wrapPi(look.yawT - look.yaw0)));
    look.pitchT = Math.max(look.pitch0 - lim * 0.7, Math.min(look.pitch0 + lim * 0.55, look.pitchT));
  }
  look.pitchT = Math.max(-1.35, Math.min(1.35, look.pitchT));
  const k = 1 - Math.exp(-dt / 0.07);
  look.yaw += (look.yawT - look.yaw) * k;
  look.pitch += (look.pitchT - look.pitch) * k;
  fromYawPitch(look.yaw, look.pitch, lookDir);

  // the body: on the rail, a little behind it, low, the nose not far off the floor
  world.railPoint(e, nav.s, tmpA);
  bob += dt * 2.2;
  tmpA.y += -0.02 + Math.sin(time * 1.3) * 0.002;
  if (basePos.lengthSq() === 0) basePos.copy(tmpA);
  basePos.lerp(tmpA, 1 - Math.exp(-dt / 0.12));

  // the gait of something low and heavy-shouldered at a run. Each forepaw takes the weight in turn: the shoulder on
  // that side drops and the head tips with it, the body swings over the planted paw, and every landing is a dip.
  const g = gait, m = moving * moving;
  const roll = 0.058 * Math.sin(g + 0.2) * m;
  const yawG = 0.02 * Math.sin(g + 1.0) * m;
  const pitchG = (0.013 * Math.sin(2 * g - 0.4) - 0.02) * m; // and the head carried a little down
  gaitOff.set(-0.013 * Math.sin(g + 0.3) * m, (-0.011 * Math.cos(2 * g - 0.9) - 0.0035 * Math.cos(4 * g - 1.2)) * m, 0);
  // (and when the jaws shut on us the head is shaken)
  const sk = beast.shake;
  camQ.setFromEuler(new THREE.Euler(look.pitch + pitchG + sk * 0.07 * Math.sin(time * 61), look.yaw + yawG + sk * 0.06 * Math.sin(time * 47 + 1), roll + sk * 0.1 * Math.sin(time * 53 + 2), 'YXZ'));
  // sideways along the shoulders, up and down in the world
  tmpB.set(1, 0, 0).applyQuaternion(camQ);
  camPos.copy(basePos).addScaledVector(tmpB, gaitOff.x);
  camPos.y += gaitOff.y;
  camera.position.copy(camPos);
  camera.quaternion.copy(camQ);
  camera.updateMatrixWorld();
}

function updateTorch(dt: number, time: number) {
  const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * camera.aspect;
  const ax = aim.mouse ? aim.x : 0, ay = aim.mouse ? aim.y : 0;
  // carried, not mounted: it trails the stride by a beat and swings wider than the head does
  const run = (nav.v / SPEED) ** 2;
  tmpA.set(ax * tanH * 0.85 + 0.03 * Math.sin(gait - 0.5) * run, ay * tanV * 0.85 + 0.035 * Math.cos(2 * gait - 1.5) * run, -1).normalize().applyQuaternion(camQ);
  tmpA.x += Math.sin(time * 2.1) * 0.004 + Math.sin(time * 5.3) * 0.002;
  tmpA.y += Math.sin(time * 1.7 + 1.0) * 0.004;
  lightDir.lerp(tmpA.normalize(), 1 - Math.exp(-dt / 0.11)).normalize();
  // held beside the head; pulled in when there is no room for the arm
  tmpB.set(0.085, -0.07, -0.02).applyQuaternion(camQ);
  let reach = 1;
  while (reach > 0.1 && world.sample(camPos.x + tmpB.x * reach, camPos.y + tmpB.y * reach, camPos.z + tmpB.z * reach) > -0.05) reach -= 0.25;
  torchReach += (reach - torchReach) * (1 - Math.exp(-dt / 0.15));
  lightPos.copy(camPos).addScaledVector(tmpB, torchReach);
  U.uLightPos.value.copy(lightPos);
  U.uLightDir.value.copy(lightDir);
  lightCam.position.copy(lightPos);
  lightCam.up.set(0, 1, 0).applyQuaternion(camQ);
  lightCam.lookAt(tmpA.copy(lightPos).add(lightDir));
  lightCam.updateMatrixWorld();
  U.uLightVP.value.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);

  // what the hotspot lands on glows back
  const tb = world.march(lightPos, lightDir, 12);
  hotspotDist = Math.min(tb, den.hit(lightPos, lightDir));
  U.uBouncePos.value.copy(lightPos).addScaledVector(lightDir, Math.max(0.02, tb - 0.06));
  U.uBounceCol.value.set(0.95, 0.62, 0.38).multiply(LIGHT_COL).multiplyScalar(U.uLightI.value * 0.03);
}

let exposure = 0.25;
let hotspotDist = 2;
function meter(dt: number) {
  const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * camera.aspect;
  const I = U.uLightI.value, day = U.uDay.value;
  let sum = 0, wsum = 0;
  for (const gy of [-0.55, 0, 0.55])
    for (const gx of [-0.6, 0, 0.6]) {
      tmpA.set(gx * tanH, gy * tanV, -1).normalize().applyQuaternion(camQ);
      const t = world.march(camPos, tmpA, 14);
      let lum: number;
      if (t >= 14) lum = day * 0.9;
      else {
        tmpB.copy(camPos).addScaledVector(tmpA, t);
        const open = 1 - sstep(0.1, 0.3, world.terrainH(tmpB.x, tmpB.z) - tmpB.y);
        const dm = tmpB.distanceTo(U.uMouth.value);
        const inside = (0.05 / (0.05 + dm * dm)) * sstep(2.6, 0.4, dm) * 1.4 * 0.5;
        lum = day * 0.045 * (open * 4.5 + (1 - open) * inside);
        tmpC.copy(tmpB).sub(lightPos);
        const d2 = tmpC.lengthSq();
        const ang = Math.acos(Math.min(1, tmpC.dot(lightDir) / Math.sqrt(d2)));
        lum += (I * cookie(ang) / (d2 + 0.012)) * 0.04;
      }
      const w = gx === 0 && gy === 0 ? 3 : 1;
      sum += w * Math.sqrt(lum);
      wsum += w;
    }
  // metered like a camera does: centre-weighted, and the bright part of the frame counts for more than the dark
  let target = Math.max(0.12, Math.min(90, 0.3 / (sum / wsum) ** 2));
  // and never so open that the pool of light itself burns out, however much dark there is around it
  target = Math.min(target, 1.0 / ((I * 1.16 * 0.04) / (hotspotDist * hotspotDist + 0.012) + 1e-5));
  if (!Number.isFinite(target)) target = exposure;
  const tau = target < exposure ? 0.22 : 0.85;
  // the first moments: no adapting from a guess, the frame opens already metered and fades up from black
  if (clock < 0.4) exposure = target;
  exposure *= Math.exp(Math.log(target / exposure) * (1 - Math.exp(-dt / tau)));
  // (with it on the lens the meter knows nothing of it: stopped down by hand; and after the bite, dark)
  post.exposure = exposure * sstep(0.1, 1.1, clock) * (1 - 0.3 * beast.close) * (1 - beast.dark);
}

let resScale = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio, 1.5) * resScale;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // a phone held upright still gets a usable width of view
  camera.fov = Math.min(96, (2 * Math.atan(Math.tan((62 * Math.PI) / 360) * Math.max(1, 1.25 / camera.aspect)) * 180) / Math.PI);
  camera.updateProjectionMatrix();
  post.setSize(Math.round(w * dpr), Math.round(h * dpr));
  fog.setSize(Math.round(w * dpr), Math.round(h * dpr));
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  flora.pixel.value = (2 * tanV) / (h * dpr);
  U.uPix.value = flora.pixel.value;
  dust.scale.value = (h * dpr) / (2 * tanV);
}

function renderShadow() {
  for (const c of casters) { c.keep = c.obj.material; c.obj.material = c.depth; }
  // (what was already hidden stays hidden after: the hillside, once we are in)
  for (const o of noShadow) { o.userData.shown = o.visible; o.visible = false; }
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, lightCam);
  for (const c of casters) c.obj.material = c.keep!;
  for (const o of noShadow) o.visible = o.userData.shown;
}

// ---- what our passing does to the place ----
const prevPos = new THREE.Vector3().copy(camPos);
const moveDir = new THREE.Vector3(0, 0, -1);
let nextFall = 0.9;
let trickle = 2;
function disturb(dt: number) {
  tmpA.copy(camPos).sub(prevPos);
  prevPos.copy(camPos);
  const speed = tmpA.length() / Math.max(dt, 1e-4);
  if (speed > 0.02) moveDir.copy(tmpA).normalize();
  rocks.update(dt, camPos, moveDir, speed);
  flora.update(dt, camPos, moveDir, speed);
  // now and then the roof ahead lets some dirt go
  if (nav.entered && travelled > nextFall) {
    nextFall = travelled + 0.45 + Math.random() * 1.1;
    const e = world.edges[nav.e];
    world.railPoint(e, nav.s + nav.dir * nav.sign * (0.45 + Math.random() * 0.8), tmpA);
    tmpB.set(Math.random() * 0.7 - 0.35, 1, Math.random() * 0.7 - 0.35).normalize();
    const t = world.march(tmpA, tmpB, 1);
    if (t < 1) crumble(tmpA.addScaledVector(tmpB, t - 0.01), 0.5 + Math.random() * 1.1);
  }
  // and the place is never quite still: somewhere within the reach of the torch a little is always trickling down
  if (nav.entered && (trickle -= dt) < 0) {
    trickle = 0.7 + Math.random() * 2.2;
    tmpB.set(Math.random() - 0.5, 0.25 + Math.random() * 0.9, Math.random() - 0.5).addScaledVector(lookDir, 0.9).normalize();
    const t = world.march(camPos, tmpB, 3.2);
    if (t < 3.2 && t > 0.3) {
      // a point on the roof or high on a wall: the dirt is let go just clear of it
      tmpA.copy(camPos).addScaledVector(tmpB, t - 0.02);
      dust.crumble(tmpA, 0.12 + Math.random() * 0.25, 0.8);
      fog.puff(tmpA, 0.25, 0.04, 0.16, 3, -0.25);
    }
  }
  dust.update(dt);
  den.update(dt, clock, camPos);
  // the hillside is thrown out once we are in: nothing of it can be seen from round the first bend, nor, before
  // that, with our back to the mouth. Hidden is not drawn at all: not a vertex of it is run
  const seen = camPos.z > -2.6 && (camPos.z > -0.5 || lookDir.dot(tmpA.copy(U.uMouth.value).sub(camPos).normalize()) > -0.15);
  for (const o of hillside) o.visible = seen;
}

let clock = 0;
function tick(dt: number) {
  clock += dt;
  const time = clock;
  U.uTime.value = time;
  // our running shivers whatever water is near
  U.uRipple.value += (nav.v / SPEED - U.uRipple.value) * (1 - Math.exp(-dt / 0.6));
  U.uWalker.value.copy(camPos);
  U.uWalkDir.value.set(moveDir.x, 0, moveDir.z).normalize();
  // quick to rise as we set off, slow to settle once we stop
  const stirTo = Math.min(1, Math.abs(nav.v) / SPEED);
  U.uStir.value += (stirTo - U.uStir.value) * (1 - Math.exp(-dt / (stirTo > U.uStir.value ? 0.18 : 1.1)));
  crawl(dt);
  updateCamera(dt, time);
  beast.update(dt, camPos, lookDir, nav.entered);
  updateTorch(dt, time);
  meter(dt);
  disturb(dt);
  U.uShadow.value = null;
  renderShadow();
  U.uShadow.value = shadowDepth;
  renderer.setRenderTarget(post.scene);
  renderer.clear();
  renderer.render(scene, camera);
  fog.update(dt);
  post.render(time, fog.render(renderer, post.scene, camera));
}
let last = performance.now();
let slowAcc = 0, slowN = 0, slowRuns = 0;
function frame(now: number) {
  const raw = (now - last) / 1000;
  tick(Math.min(0.05, raw));
  last = now;
  // two slow seconds in a row: give up some pixels (a hidden tab ticks slowly too, that is not the GPU's fault)
  if (!document.hidden && raw < 0.2) {
    slowAcc += raw;
    if (++slowN >= 60) {
      slowRuns = slowAcc / slowN > 0.021 ? slowRuns + 1 : 0;
      if (slowRuns >= 2 && resScale > 0.5) { resScale = Math.max(0.5, resScale * 0.82); slowRuns = 0; resize(); }
      slowAcc = slowN = 0;
    }
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// dev: jump somewhere. burrow.go('B', 0, yawDeg, pitchDeg) puts the eye on the first edge at node B.
Object.assign(window, {
  burrow: {
    world, nav, look, camera, U, post, dust, flora, rocks, den, fog, scene, soil, renderer, aim, fungi, hillside, beast,
    go(name: string, along = 0, yaw?: number, pitch = 0) {
      const n = world.nodes.findIndex((x) => x.name === name);
      // arrive on the last edge listed at the node (the one that leads to it), looking the way it runs
      const ei = [...world.adj[n]].reverse().find((i) => !world.edges[i].open) ?? world.adj[n][0];
      const e = world.edges[ei];
      nav.e = ei; nav.s = e.a === n ? along : e.len - along; nav.entered = !e.open; nav.v = 0;
      world.railPoint(e, nav.s, camPos);
      basePos.copy(camPos);
      if (yaw === undefined) {
        world.railTangent(e, nav.s, tmpA);
        if (e.a === n) tmpA.negate();
        look.yaw = look.yawT = Math.atan2(-tmpA.x, -tmpA.z);
        look.pitch = look.pitchT = Math.asin(tmpA.y) * 0.8;
      } else { look.yaw = look.yawT = (yaw * Math.PI) / 180; look.pitch = look.pitchT = (pitch * Math.PI) / 180; }
      document.body.classList.toggle('inside', nav.entered);
    },
    get exposure() { return exposure; },
    /** run the scene for a while without waiting for the screen (a hidden tab ticks slowly) */
    run(seconds: number) { for (let t = 0; t < seconds; t += 1 / 60) tick(1 / 60); },
    /** milliseconds per frame with the GPU forced to finish */
    bench(n = 20) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      tick(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t = performance.now();
      for (let i = 0; i < n; i++) { tick(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t) / n;
    },
    input,
  },
});

// ?at=N,1.6: start somewhere else (node name, metres short of it): for clips and for looking at one corner
{
  const at = params.get('at')?.split(',');
  const b = (window as unknown as { burrow: { go(n: string, a?: number, y?: number, p?: number): void } }).burrow;
  if (at && world.nodes.some((n) => n.name === at[0])) b.go(at[0], Number(at[1] ?? 0), at[2] === undefined ? undefined : Number(at[2]), Number(at[3] ?? 0));
}
