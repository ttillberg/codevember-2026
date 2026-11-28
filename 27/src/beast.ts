// What else lives down here (model/beast.py -> public/beast.glb): mole-bodied, bald wedge of a head, clouded eyes, a
// jaw of needles. It waits in the lower tunnels, facing whoever comes. Within a couple of body lengths it gathers
// itself, comes through the air at the lamp and bites. Then the light is gone for a moment, and so is it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { World } from './world';
import { beastMaterial, beastDepthMaterial } from './gfx';

const KIND: Record<string, number> = { skin: 0, fur_base: 1, mouth: 2, teeth: 3, claws: 4, eye: 5 };
const FUR_LAYERS = 6;
/** where the middle of the open mouth is, from the model's origin, at the end of the leap */
const MOUTH = new THREE.Vector3(0, 0.26, 0.27);
type State = 'away' | 'lurk' | 'crouch' | 'leap' | 'bite' | 'gone';
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Beast {
  group = new THREE.Group();
  /** what of it throws a shadow, and what does not (the fur): filled in when the model has loaded */
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];
  noShadow: THREE.Object3D[] = [];
  onReady: () => void = () => {};
  /** the jaws shut on us */
  onSnap: (p: THREE.Vector3) => void = () => {};
  state: State = 'away';
  /** how hard the head is being shaken, 0 to 1 */
  shake = 0;
  /** the light going out, 0 to 1 */
  dark = 0;
  /** how much of the view it fills: the exposure is pulled down for it */
  close = 0;
  private ready = false;
  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private now?: THREE.AnimationAction;
  private t = 0;
  private cool = 0;
  private snaps = 0;
  private from = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private first = true;

  constructor(private world: World, private rnd: () => number) {
    this.group.rotation.order = 'YXZ';
    this.group.visible = false;
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}beast.glb`).then((gltf) => {
      const depth = beastDepthMaterial();
      const meshes: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
      for (const m of meshes) {
        const kind = KIND[(m.material as THREE.Material).name] ?? 0;
        m.material = beastMaterial(kind);
        m.frustumCulled = false;
        this.casters.push({ obj: m, depth });
        if (kind !== 1) continue;
        // the fur: the same skinned mesh again and again, each a layer further out along the normal
        for (let i = 1; i <= FUR_LAYERS; i++) {
          const sh = new THREE.SkinnedMesh(m.geometry, beastMaterial(1, i / FUR_LAYERS));
          sh.position.copy(m.position); sh.quaternion.copy(m.quaternion); sh.scale.copy(m.scale);
          sh.bind(m.skeleton, m.bindMatrix);
          sh.frustumCulled = false;
          m.parent!.add(sh);
          this.noShadow.push(sh);
        }
      }
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const a = this.mixer.clipAction(clip);
        a.clampWhenFinished = true;
        if (clip.name !== 'idle') a.setLoop(THREE.LoopOnce, 1);
        this.actions[clip.name] = a;
      }
      this.group.add(gltf.scene);
      this.ready = true;
      this.onReady();
    });
  }

  /** we are held: no running while it has us */
  get holds() { return this.state === 'crouch' || this.state === 'leap' || this.state === 'bite'; }

  private play(name: string) {
    this.now?.stop();
    this.now = this.actions[name];
    this.now?.reset().play();
  }

  /** Put it on the floor of a tunnel, s metres along edge ei. */
  place(ei: number, s: number) {
    const { world } = this;
    world.railPoint(world.edges[ei], s, this.a);
    const t = world.march(this.a, this.b.set(0, -1, 0), 0.6);
    this.group.position.copy(this.a).addScaledVector(this.b, Math.min(t, 0.6));
    this.group.rotation.set(0, this.rnd() * 6.283, 0);
    this.group.visible = true;
    this.state = 'lurk';
    this.play('idle');
  }

  /** Somewhere low down and well away from the eye. The first time, on the long run down. */
  private hide(eye: THREE.Vector3) {
    const { world } = this;
    const spots: [number, number][] = [];
    world.edges.forEach((e, ei) => {
      if (e.open) return;
      for (let s = 0.5; s < e.len - 0.5; s += 0.35) {
        world.railPoint(e, s, this.a);
        if (this.a.y < -0.95 && this.a.distanceTo(eye) > 3.2 && this.a.distanceTo(world.den.c) > 2.2) spots.push([ei, s]);
      }
    });
    if (!spots.length) return;
    let pick = spots[Math.floor(this.rnd() * spots.length)];
    if (this.first) {
      const deep = spots.filter(([ei]) => ei >= 16);
      if (deep.length) pick = deep[Math.floor(deep.length * 0.5)];
      this.first = false;
    }
    this.place(pick[0], pick[1]);
  }

  /** turn to face the eye; k how fast */
  private face(eye: THREE.Vector3, k: number) {
    const g = this.group;
    const want = Math.atan2(eye.x - g.position.x, eye.z - g.position.z);
    let d = want - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * k;
  }

  /** where its origin has to be for the open mouth to be right on the lens */
  private onto(eye: THREE.Vector3, look: THREE.Vector3, out: THREE.Vector3) {
    this.a.copy(MOUTH).applyQuaternion(this.group.quaternion);
    return out.copy(eye).addScaledVector(look, 0.2).sub(this.a);
  }

  update(dt: number, eye: THREE.Vector3, look: THREE.Vector3, inside: boolean) {
    if (!this.ready) return;
    const g = this.group;
    this.shake *= Math.exp(-dt / 0.12);
    if (this.state === 'away') {
      this.dark = 0; this.close = 0;
      if ((this.cool -= dt) < 0 && inside) this.hide(eye);
      return;
    }
    if (this.state === 'gone') {
      // the light comes back, and there is nothing there
      this.t += dt;
      this.dark = 1 - sstep(0.45, 1.7, this.t);
      this.close = 0;
      if (this.t > 1.7) { this.state = 'away'; this.cool = 25 + this.rnd() * 25; }
      return;
    }
    const dist = g.position.distanceTo(eye);
    if (this.state === 'lurk') {
      g.visible = dist < 7;
      if (!g.visible) return;
      this.face(eye, 1 - Math.exp(-dt / 0.5));
      this.mixer.update(dt);
      if (inside && dist < 1.75) {
        // only if it can be got at: nothing of the ground in between
        this.a.copy(g.position); this.a.y += 0.15;
        this.b.copy(this.a).sub(eye);
        const d = this.b.length();
        if (this.world.march(eye, this.b.normalize(), d) >= d - 0.25) { this.state = 'crouch'; this.t = 0; this.play('crouch'); }
      }
      return;
    }
    this.mixer.update(dt);
    this.t += dt;
    if (this.state === 'crouch') {
      this.face(eye, 1 - Math.exp(-dt / 0.08));
      if (this.t >= 0.4) { this.state = 'leap'; this.t = 0; this.from.copy(g.position); this.play('leap'); }
    } else if (this.state === 'leap') {
      // off the ground after the push, and at the lamp: rearing as it comes, mouth first
      const k = sstep(0.1, 0.5, this.t);
      this.face(eye, 1);
      g.rotation.x = (-0.3 + 0.8 * look.y) * k;
      this.onto(eye, look, this.b);
      g.position.lerpVectors(this.from, this.b, k);
      g.position.y += Math.sin(Math.PI * k) * 0.07;
      this.close = k;
      if (this.t >= 0.5) { this.state = 'bite'; this.t = 0; this.snaps = 0; this.shake = 0.6; this.play('bite'); }
    } else if (this.state === 'bite') {
      this.face(eye, 1);
      g.rotation.x = -0.3 + 0.8 * look.y;
      this.onto(eye, look, g.position);
      // two snaps, and each one is felt
      if ((this.snaps === 0 && this.t > 0.14) || (this.snaps === 1 && this.t > 0.41)) {
        this.snaps++;
        this.shake = 1;
        this.onSnap(this.a.copy(eye).addScaledVector(look, 0.15));
      }
      this.dark = sstep(0.43, 0.56, this.t);
      if (this.t >= 0.6) { this.state = 'gone'; this.t = 0; g.visible = false; g.rotation.x = 0; this.now?.stop(); }
    }
  }
}
