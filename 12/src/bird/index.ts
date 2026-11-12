import * as THREE from 'three';
import type { Bird, BirdContext } from './types';
import { MOUNTAIN_GEM, type Species } from './species';
import { buildRig, type Rig } from './rig';
import { buildPlumageGeometry } from './plumageGeometry';
import { createPlumageDepthMaterial, createPlumageMaterial, type PlumageUniforms } from './plumageMaterial';
import { buildParts } from './parts';
import { createSolver, Pose } from './pose';
import { Mind, type Layer } from './motion/mind';
import { PostureLayer } from './motion/posture';
import { BreathLayer } from './motion/breath';
import { GazeLayer } from './motion/gaze';
import { BlinkLayer } from './motion/blink';
import { RuffleLayer } from './motion/ruffle';
import { TailLayer } from './motion/tail';
import { WingLayer } from './motion/wings';
import { StartleLayer } from './motion/startle';

/** The bird plus the handles a UI, a debugger or a new behaviour would want. */
export interface BirdHandle extends Bird {
  species: Species;
  rig: Rig;
  pose: Pose;
  mind: Mind;
  /** Behaviour layers, run in order every frame. Push your own. */
  layers: Layer[];
  layer<T extends Layer>(name: string): T;
  /** Feather shader uniforms: uFlash, uGlint, uSheen are free to tune. */
  plumage: PlumageUniforms;
  stats: { bones: number; contourFeathers: number; flightFeathers: number; vertices: number; triangles: number };
  /** Hook that runs after the layers and before the solver: last word on the pose. */
  onPose: ((pose: Pose, mind: Mind) => void) | null;
}

export interface BirdOptions {
  species?: Species;
  seed?: number;
}

export function createBird(_ctx: BirdContext, options: BirdOptions = {}): BirdHandle {
  const species = options.species ?? MOUNTAIN_GEM;
  const root = new THREE.Group();
  root.name = 'bird';

  const rig = buildRig(species);
  root.add(rig.rootBone);

  const plumageGeo = buildPlumageGeometry(rig);
  const { material: plumageMat, uniforms } = createPlumageMaterial();
  const contour = new THREE.SkinnedMesh(plumageGeo.contour, plumageMat);
  contour.name = 'bird.contour';
  const flight = new THREE.SkinnedMesh(plumageGeo.flight, plumageMat);
  flight.name = 'bird.flight';
  const fuzz = new THREE.SkinnedMesh(plumageGeo.fuzz, plumageMat);
  fuzz.name = 'bird.fuzz';
  fuzz.frustumCulled = false;
  fuzz.bind(rig.skeleton, new THREE.Matrix4());
  fuzz.receiveShadow = true;
  const plumageDepth = createPlumageDepthMaterial(uniforms);
  for (const m of [contour, flight]) {
    m.customDepthMaterial = plumageDepth;
    m.castShadow = true;
    m.frustumCulled = false;
    m.bind(rig.skeleton, new THREE.Matrix4());
    m.receiveShadow = true;
  }
  const parts = buildParts(rig);
  root.add(contour, flight, fuzz, ...parts.meshes);

  const pose = new Pose();
  const solve = createSolver(rig, uniforms);
  const mind = new Mind(species, options.seed ?? species.seed);
  const startle = new StartleLayer(mind);
  const layers: Layer[] = [new PostureLayer(mind), new BreathLayer(), new GazeLayer(mind), new BlinkLayer(mind), new RuffleLayer(mind), new TailLayer(mind), new WingLayer(mind), startle];

  const headRest = rig.rest.head.worldPos.clone();
  const local = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let attention: THREE.Vector3 | null = null;

  const handle: BirdHandle = {
    root,
    species,
    rig,
    pose,
    mind,
    layers,
    layer: <T extends Layer>(name: string) => {
      const l = layers.find((x) => x.name === name);
      if (!l) throw new Error(`no layer ${name}`);
      return l as T;
    },
    plumage: uniforms,
    stats: { bones: rig.list.length, ...plumageGeo.stats },
    onPose: null,
    update(dt) {
      if (attention) {
        root.updateWorldMatrix(true, false);
        mind.attention = local.copy(attention).applyMatrix4(inv.copy(root.matrixWorld).invert());
      } else {
        mind.attention = null;
      }
      mind.step(dt, headRest);
      pose.reset();
      for (const l of layers) if (l.enabled) l.update(mind, pose);
      handle.onPose?.(pose, mind);
      solve(pose);
    },
    setAttention(target) {
      attention = target;
    },
    startle(strength = 1) {
      startle.fire(Math.min(Math.max(strength, 0), 1));
    },
    dispose() {
      plumageGeo.contour.dispose();
      plumageGeo.flight.dispose();
      plumageGeo.fuzz.dispose();
      plumageMat.dispose();
      plumageDepth.dispose();
      parts.dispose();
      rig.skeleton.dispose();
      debugCleanup?.();
    },
  };

  const debugCleanup = installDebug(handle);
  // settle into the first pose so frame 0 is not the bind pose
  handle.update(0, 0);
  return handle;
}

/**
 * URL switches, all optional:
 *   ?gaze=yaw,pitch,roll   pin the head (degrees);  ?pose=front|profile|up|back as shortcuts
 *   ?quiet                 no spontaneous behaviour (breathing and tremor stay)
 *   ?arousal=0..1          pin the mood
 *   ?fluff=rad  ?spread=0..1  ?fan=0..1  ?blink=0..1
 *   ?bones  ?skin (hide feathers)  ?noflash
 * and window.__bird for poking.
 */
function installDebug(bird: BirdHandle) {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  (window as unknown as { __bird: BirdHandle }).__bird = bird;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : null);
  const poses: Record<string, [number, number, number]> = { front: [0, 22, 0], profile: [88, 16, 0], up: [10, 40, 8], back: [-110, 10, 0], three: [38, 20, -4] };
  const pose = q.get('pose');
  if (pose && poses[pose]) bird.mind.pinGaze = poses[pose];
  const gaze = q.get('gaze');
  if (gaze) {
    const [y = 0, p = 0, r = 0] = gaze.split(',').map(Number);
    bird.mind.pinGaze = [y, p, r];
  }
  if (q.has('quiet')) bird.mind.quiet = true;
  const arousal = num('arousal');
  const fluff = num('fluff');
  const spread = num('spread');
  const fan = num('fan');
  const blink = num('blink');
  if (arousal !== null || fluff !== null || spread !== null || fan !== null || blink !== null) {
    bird.onPose = (p, m) => {
      if (arousal !== null) m.arousal = m.baseline = arousal;
      if (fluff !== null) p.fluff = fluff;
      if (spread !== null) p.wing.L.spread = p.wing.R.spread = spread;
      if (fan !== null) p.tailFan = fan;
      if (blink !== null) p.nict = p.lidLower = p.lidUpper = blink;
    };
  }
  if (q.has('nofuzz')) bird.root.traverse((o) => o.name === 'bird.fuzz' && (o.visible = false));
  if (q.has('noflash')) bird.plumage.uFlash.value = bird.plumage.uGlint.value = 0;
  if (q.has('skin')) bird.root.traverse((o) => o.name.match(/contour|flight|fuzz/) && (o.visible = false));
  if (q.has('wire')) {
    bird.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (o.name === 'bird.skin' && m) {
        m.wireframe = true;
        m.color.set(0xffffff);
        m.emissive.set(0x888888);
      }
    });
  }
  let helper: THREE.SkeletonHelper | null = null;
  if (q.has('bones')) {
    helper = new THREE.SkeletonHelper(bird.rig.rootBone);
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 10;
    bird.root.add(helper);
  }
  return () => {
    helper?.dispose();
  };
}

export type { Bird, BirdContext } from './types';
export type { Species } from './species';
export { MOUNTAIN_GEM } from './species';
export { Pose } from './pose';
export type { Layer, Mind } from './motion/mind';
