import {
  ACESFilmicToneMapping, Color, DirectionalLight, PerspectiveCamera, PMREMGenerator,
  Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Ctx, Module } from './state';
import { createWorld, createSim } from './sim';
import { createMembrane } from './membrane';
import { createFx } from './fx';
import { createEye } from './eye';

const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
// A pale backdrop. ?dark: the near-black one instead.
const light = !new URLSearchParams(location.search).has('dark');
if (!light) document.documentElement.classList.add('dark');
scene.background = new Color(light ? 0xe6e6e8 : 0x0b0b0d);
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// The camera never moves: orbiting turns the sphere, so highlights slide over the surface.
const camera = new PerspectiveCamera(32, 1, 0.1, 50);
camera.position.set(0, 0, 4.6);

const key = new DirectionalLight(0xffffff, 2.2);
key.position.set(-2.5, 3, 4);
scene.add(key);

const world = createWorld();
const ctx: Ctx = { world, renderer, scene, camera, canvas };

// Order matters: sim moves the state, membrane and fx draw it.
const modules: Module[] = [createSim(ctx), createEye(ctx), createMembrane(ctx), createFx(ctx)];

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Portrait: keep the same margin around the sphere, a cut has to start outside it.
  camera.position.z = w < h ? 4.6 * (h / w) : 4.6;
  camera.updateProjectionMatrix();
  for (const m of modules) m.resize?.(w, h);
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  world.time += dt;
  for (const m of modules) m.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

// For poking at it from the console and from capture scripts.
(window as unknown as { world: typeof world }).world = world;
