// What else lives down here (model/beast.py -> public/beast.glb): mole-bodied, bald wedge of a head, clouded eyes, a
// jaw of needles. It waits at the far end of a long straight look down a deep tunnel: from there it is two points of
// light, the lamp sent back by its eyes, and nothing happens. It will not be walked up to: a few body lengths off
// our legs give out and we stop. And then it starts towards us, crawling, slowly, coming out of the dark as it comes.
// We can stand there, or turn and run: it is far slower than we are, but it comes after us through the tunnels the
// way we went, wherever that is, and does not give up while we are down here. Only the day it keeps out of: it stops where the dark
// begins, a few metres in from the mouth, and waits there. Wherever we stop it
// comes right up, stops, and stands there in the lamp for a while. Then it gathers itself, comes through the air
// and bites: we go over backwards, the torch is thrown about in our hand, cuts out. That is the end of us: black, its
// eyes out of the black, the torch catching for an instant, black; and we begin again at the mouth. (The next
// line is from before there was dying:) Then there is no light, and so
// is it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { World } from './world';
import { beastMaterial, beastDepthMaterial, BEAST_EYES } from './gfx';

const KIND: Record<string, number> = { skin: 0, fur_base: 1, mouth: 2, teeth: 3, claws: 4, eye: 5 };
const FUR_LAYERS = 6;
/** where the middle of the open mouth is, from the model's origin, at the end of the leap */
const MOUTH = new THREE.Vector3(0, 0.26, 0.27);
type State = 'away' | 'lurk' | 'stalk' | 'crouch' | 'leap' | 'bite' | 'gone';
/** how fast it crawls, metres a second: slowly. It is in no hurry */
const CRAWL = 0.24;
/** how near it comes before it stops and stands there, looking */
const STAND = 1.25;
/** robbed, it does not crawl: how fast it comes while we can see it, and when we cannot (we run at 1.05) */
const RAGE = 0.62, RAGE_UNSEEN = 1.3;
/** how long it keeps after us once it has lost sight of us, before it goes back to bar the way out */
const MEMORY = 4;
/** how long we are dead for, seconds, before it all begins again */
const DEATH = 6.8;
/** how near the mouth of the burrow it will come, metres of tunnel: it keeps out of the day, and waits where the dark begins */
const SHY = 3.0;
/** the ground one cycle of the `crawl` clip covers, metres: its playback is timed by this so the planted paws do not slide */
const STRIDE = 0.264;
const LIMBS = ['arm_upper_L', 'arm_upper_R', 'leg_upper_L', 'leg_upper_R', 'arm_lower_L', 'arm_lower_R', 'spine2'];
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Beast {
  group = new THREE.Group();
  /** what of it throws a shadow, and what does not (the fur): filled in when the model has loaded */
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];
  noShadow: THREE.Object3D[] = [];
  onReady: () => void = () => {};
  /** the jaws shut on us */
  onSnap: (p: THREE.Vector3) => void = () => {};
  /** it has had us, the dark is over: everything begins again (and whatever we carried is back where it was) */
  onCaught: () => void = () => {};
  /** its egg is gone: no more crawling, and it knows the one way out */
  angry = false;
  state: State = 'away';
  /** how hard the head is being shaken, 0 to 1 */
  shake = 0;
  /** the light going out, 0 to 1 */
  /** how far over backwards it has knocked us, 0 to 1 */
  fall = 0;
  /** how wildly the torch is being thrown about in our hand, 0 to 1 */
  flail = 0;
  /** what the torch is giving: 1 as it was, 0 out */
  lamp = 1;
  /** how much of the picture is taken away, 0 to 1: after it has had us there is nothing to see */
  dark = 0;
  /** how much of the view it fills: the exposure is pulled down for it */
  close = 0;
  private ready = false;
  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private now?: THREE.AnimationAction;
  /** the walk cycle, laid over whatever else is playing while it is on the move (if the model has one) */
  private walk?: THREE.AnimationAction;
  private t = 0;
  /** since the bite: the dark, the torch coming back, getting up. Below zero when none of that is going on */
  private rec = -1;
  private snaps = 0;
  private from = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private seen = 0;
  /** the way we went since it last saw us, as places on the rails: it follows that, not the shortest way to us */
  private crumbs: { e: number; s: number }[] = [];
  /** how much longer it will keep after us without seeing us */
  private keen = 0;
  /** where it bars the way out when it is angry: the first fork in from the mouth */
  private gate = { e: 0, s: 0 };
  /** where it is on the rails: it goes about the burrow the way we do, so there is nowhere we can go that it cannot */
  private at = { ei: 0, s: 0 };
  /** how far it is from every node to every other, through the tunnels */
  private far: number[][] = [];
  /** how long we have been out under the sky with it after us */
  private lost = 0;
  /** how long it has stood in front of us, and how long it means to */
  private stood = 0;
  private patience = 2;
  private pace = 0;
  private bones: Record<string, THREE.Object3D> = {};
  /** per swung bone: what the clip had it at, and what we left it at (the mixer only writes a bone when its clip moves it) */
  private swung: Record<string, { base: THREE.Quaternion; left: THREE.Quaternion }> = {};
  private stride = 0;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private ax = new THREE.Vector3();
  /** where it can wait: the floor of a deep tunnel with a long clear look at it from somewhere along the rails */
  private spots: { ei: number; s: number; sight: number; from: { ei: number; s: number }; at: THREE.Vector3 }[] = [];

  constructor(private world: World, private rnd: () => number) {
    this.group.rotation.order = 'YXZ';
    this.group.visible = false;
    this.scout();
    this.survey();
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
        if (clip.name !== 'idle' && clip.name !== 'crawl') a.setLoop(THREE.LoopOnce, 1);
        this.actions[clip.name] = a;
      }
      for (const n of LIMBS) { const b = gltf.scene.getObjectByName(n); if (b) this.bones[n] = b; }
      this.walk = this.actions.crawl;
      this.group.add(gltf.scene);
      this.ready = true;
      this.home();
      this.onReady();
    });
  }

  /** we are held: no running while it has us, nor after */
  get holds() { return this.state === 'crouch' || this.state === 'leap' || this.state === 'bite' || this.rec >= 0; }
  /** how much it is on the move just now, 0 standing to 1 at its stride: for the ear (its footfalls) */
  get moving() { return this.state === 'stalk' ? this.stride : 0; }
  /**
   * Where it is in its walk, 0 to 1 round the cycle of the `crawl` clip. Its paws come down at 0.40 (hind right),
   * 0.46 (fore left), 0.90 (hind left) and 0.96 (fore right).
   */
  get cycle() { const w = this.walk; return w && w.isRunning() ? (w.time / w.getClip().duration) % 1 : 0; }
  /** it has had us, and we have not begun again yet; and for how long */
  get dead() { return this.rec >= 0; }
  get deadFor() { return Math.max(0, this.rec); }

  private play(name: string) {
    this.walk?.stop();
    this.now?.stop();
    this.now = this.actions[name];
    this.now?.reset().setEffectiveWeight(1).play();
  }

  /** Put it on the floor of a tunnel, s metres along edge ei. */
  place(ei: number, s: number) {
    const { world } = this;
    this.at.ei = ei; this.at.s = s;
    world.railPoint(world.edges[ei], s, this.a);
    const t = world.march(this.a, this.b.set(0, -1, 0), 0.6);
    this.group.position.copy(this.a).addScaledVector(this.b, Math.min(t, 0.6));
    this.group.rotation.set(0, this.rnd() * 6.283, 0);
    this.group.visible = true;
    this.state = 'lurk';
    this.seen = 0;
    this.play('idle');
  }

  /** The length of the shortest way between every two nodes, through the tunnels (not out under the sky). */
  private survey() {
    const { nodes, edges } = this.world;
    const n = nodes.length;
    const d = (this.far = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity))));
    for (const e of edges) if (!e.open) d[e.a][e.b] = d[e.b][e.a] = Math.min(d[e.a][e.b], e.len);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
    // the gate: in from the mouth to the first place the way forks. Everything that leaves comes through there
    const inner = (v: number) => this.world.adj[v].filter((i) => !edges[i].open);
    let node = edges.find((e) => e.open)?.b ?? 0, via = -1;
    for (let guard = 0; guard < 8 && inner(node).length - (via < 0 ? 0 : 1) === 1; guard++) {
      via = inner(node).find((i) => i !== via)!;
      node = edges[via].a === node ? edges[via].b : edges[via].a;
    }
    if (via >= 0) this.gate = { e: via, s: edges[via].a === node ? 0.05 : edges[via].len - 0.05 };
  }

  /**
   * After us along the rails, `step` metres of the shortest way to where we are (edge pe, ps metres along it). Returns
   * how far it got. Out under the sky it does not follow: it comes as far as the mouth.
   */
  private pursue(step: number, pe: number, ps: number): number {
    const W = this.world, E = W.edges, at = this.at;
    if (E[pe].open) {
      // the tunnel that leads in from the mouth, at its mouth end
      const n = E[pe].b, ei = W.adj[n].find((i) => !E[i].open);
      if (ei === undefined) return 0;
      pe = ei; ps = E[ei].a === n ? 0.5 : E[ei].len - 0.5;
    }
    const toNode = (n: number) => Math.min(this.far[n][E[pe].a] + ps, this.far[n][E[pe].b] + E[pe].len - ps);
    // how much tunnel there is between it and the mouth
    const mouth = E.find((e) => e.open)?.b ?? 0;
    const toMouth = () => Math.min(this.far[E[at.ei].a][mouth] + at.s, this.far[E[at.ei].b][mouth] + E[at.ei].len - at.s);
    const ei0 = at.ei, s0 = at.s, d0 = toMouth();
    let moved = 0;
    for (let guard = 0; guard < 4 && step > 1e-5; guard++) {
      const e = E[at.ei];
      if (at.ei === pe) {
        const d = ps - at.s, m = Math.min(Math.abs(d), step);
        at.s += Math.sign(d) * m; moved += m;
        break;
      }
      // whichever end of this tunnel is the shorter way round to us
      // (standing exactly on a node the two ways round are the same length to the last bit: then on along the
      // tunnel it has just come into, not back out of it)
      const viaA = at.s + toNode(e.a), viaB = e.len - at.s + toNode(e.b);
      const goB = Math.abs(viaA - viaB) < 1e-6 ? at.s < e.len / 2 : viaB < viaA;
      const m = Math.min(goB ? e.len - at.s : at.s, step);
      at.s += goB ? m : -m; moved += m; step -= m;
      if (step <= 1e-5) break;
      // at its end: into the tunnel that leads on
      const n = goB ? e.b : e.a;
      let best = -1, bd = Infinity;
      for (const ei of W.adj[n]) {
        if (ei === at.ei || E[ei].open) continue;
        const o = E[ei];
        const d = ei === pe ? (o.a === n ? ps : o.len - ps) : o.len + toNode(o.a === n ? o.b : o.a);
        if (d < bd) { bd = d; best = ei; }
      }
      if (best < 0) break;
      at.ei = best; at.s = E[best].a === n ? 0 : E[best].len;
    }
    // it will not come up into the day: no step that takes it nearer the mouth than the dark reaches
    const d1 = toMouth();
    if (d1 < SHY && d1 < d0) { at.ei = ei0; at.s = s0; return 0; }
    if (moved > 0) {
      W.railPoint(E[at.ei], at.s, this.a);
      const t = W.march(this.a, this.b.set(0, -1, 0), 0.6);
      this.group.position.copy(this.a).addScaledVector(this.b, Math.min(t, 0.6));
    }
    return moved;
  }

  /** Every place it could wait, and for each the furthest point of the rails it can be seen from. Longest look first. */
  private scout() {
    const { world } = this;
    const pts: { ei: number; s: number; p: THREE.Vector3 }[] = [];
    world.edges.forEach((e, ei) => {
      if (e.open) return;
      for (let s = 0.3; s < e.len - 0.2; s += 0.3) pts.push({ ei, s, p: world.railPoint(e, s, new THREE.Vector3()) });
    });
    const d = new THREE.Vector3(), head = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    const u = new THREE.Vector3(), v = new THREE.Vector3(), o = new THREE.Vector3();
    /** a look down a tunnel, not through a chink in a wall: a hand's breadth of clear air all round the line */
    const clear = (a: THREE.Vector3, dist: number) => {
      u.set(-d.z, 0, d.x).normalize();
      v.crossVectors(d, u);
      for (const [x, y] of [[0, 0], [0.09, 0], [-0.09, 0], [0, 0.07], [0, -0.07]]) {
        o.copy(a).addScaledVector(u, x).addScaledVector(v, y);
        if (world.sample(o.x, o.y, o.z) > -0.01 || world.march(o, d, dist) < dist - 0.2) return false;
      }
      return true;
    };
    for (const b of pts) {
      if (b.p.y > -0.95 || b.p.distanceTo(world.den.c) < 2.2) continue;
      head.copy(b.p);
      head.y -= Math.min(world.march(b.p, down, 0.6), 0.6) - 0.16;
      const eb = world.edges[b.ei];
      let best = 0, from = b;
      for (const a of pts) {
        // from its own tunnel, or one that opens into it
        const ea = world.edges[a.ei];
        if (a.ei !== b.ei && ea.a !== eb.a && ea.a !== eb.b && ea.b !== eb.a && ea.b !== eb.b) continue;
        const dist = a.p.distanceTo(head);
        if (dist <= best || dist > 7) continue;
        d.copy(head).sub(a.p).normalize();
        if (clear(a.p, dist)) { best = dist; from = a; }
      }
      if (best >= 2.4) this.spots.push({ ei: b.ei, s: b.s, sight: best, from: { ei: from.ei, s: from.s }, at: head.clone() });
    }
    // (and of two as long, the deeper: it is at the bottom of a run, we come on it from above)
    this.spots.sort((x, y) => y.sight - 0.5 * y.at.y - (x.sight - 0.5 * x.at.y));
  }

  /** Where it lives: the far end of the longest look there is on the lower level (or anywhere, if that is short). */
  get lair() {
    const low = this.spots.find((s) => s.ei >= 16);
    return low && low.sight >= 2.8 ? low : this.spots[0];
  }

  /** Where the lair is seen from, furthest off: where a look at it starts, and where we come to after it has had us. */
  get approach() {
    const f = this.lair;
    return f && { ei: f.from.ei, s: f.from.s, at: f.at, sight: f.sight };
  }

  /** Back to its lair, calm. */
  home() {
    const l = this.lair;
    this.angry = false;
    this.crumbs.length = 0;
    if (l) this.place(l.ei, l.s);
  }

  /** Its egg has been lifted. Wherever it is, it stops crawling. */
  enrage() {
    this.angry = true;
    this.keen = 0;
    if (this.state === 'lurk') { this.state = 'stalk'; this.lost = 0; this.stood = 0; }
    this.patience = 0.5;
  }

  /** How far it is from us through the tunnels, metres: the ear's distance (three metres of earth is not three of air). */
  tunnelDistance(where: { e: number; s: number }): number {
    const E = this.world.edges, at = this.at;
    let pe = where.e, ps = where.s, extra = 0;
    if (E[pe].open) {
      // out under the sky: down to the mouth, and on from there
      const n = E[pe].b, ei = this.world.adj[n].find((i) => !E[i].open);
      if (ei === undefined) return Infinity;
      extra = E[pe].len - ps; pe = ei; ps = E[ei].a === n ? 0 : E[ei].len;
    }
    if (pe === at.ei) return extra + Math.abs(ps - at.s);
    const a = E[pe], be = E[at.ei];
    const from = (n: number) => Math.min(this.far[n][be.a] + at.s, this.far[n][be.b] + be.len - at.s);
    return extra + Math.min(ps + from(a.a), a.len - ps + from(a.b));
  }

  /** is there clear air from the eye to its head */
  private sees(eye: THREE.Vector3): boolean {
    this.a.copy(this.group.position); this.a.y += 0.15;
    this.b.copy(this.a).sub(eye);
    const d = this.b.length();
    return this.world.march(eye, this.b.normalize(), d) >= d - 0.25;
  }

  /**
   * How much of our speed is left to us, going the way we are going (dir: up or down the edge we are on): it will not
   * be walked up to. From a few body lengths off the legs slow, and short of it they stop. Only when it is ahead of
   * us in the tunnels: one lying the same way in the next tunnel over stops nobody.
   */
  bars(eye: THREE.Vector3, where: { e: number; s: number }, dir: number): number {
    if (!this.ready || !this.group.visible || (this.state !== 'lurk' && this.state !== 'stalk')) return 1;
    const dist = this.group.position.distanceTo(eye);
    if (dist > 3.7) return 1;
    const E = this.world.edges, e = E[where.e], at = this.at;
    let ahead = Infinity;
    if (at.ei === where.e) { if ((at.s - where.s) * dir > 0) ahead = Math.abs(at.s - where.s); }
    else if (!e.open) {
      // ahead of us, if the short way to it is on the way we are going and not back the way we came
      const be = E[at.ei];
      const from = (n: number) => Math.min(this.far[n][be.a] + at.s, this.far[n][be.b] + be.len - at.s);
      const fwd = (dir > 0 ? e.len - where.s : where.s) + from(dir > 0 ? e.b : e.a);
      const back = (dir > 0 ? where.s : e.len - where.s) + from(dir > 0 ? e.a : e.b);
      if (fwd < back) ahead = fwd;
    } else ahead = dist;
    if (ahead > 4.5 || !this.sees(eye)) return 1;
    return sstep(2.3, 3.5, dist);
  }

  /** There is no clip of it walking: the legs are swung on top of whatever clip is playing, diagonal pairs together. */
  private crawl(dist: number, dt: number) {
    this.pace += (dist / 0.17) * Math.PI * 2;
    // (the swing dies away when it stops, and comes back as it sets off)
    this.stride += ((dist > 0 ? 1 : 0) - this.stride) * (1 - Math.exp(-dt / 0.25));
    const ph = this.pace, g = this.group, k = this.stride;
    const swing = (name: string, angle: number, axis: 'x' | 'y') => {
      const b = this.bones[name];
      if (!b?.parent) return;
      // on top of the clip's pose, not of last frame's swing: where the clip holds a bone still the mixer leaves
      // it alone, and the swings would pile up
      const w = (this.swung[name] ??= { base: b.quaternion.clone(), left: new THREE.Quaternion(9, 9, 9, 9) });
      if (b.quaternion.equals(w.left)) b.quaternion.copy(w.base); else w.base.copy(b.quaternion);
      // about the animal's own sideways (or upright) axis, whatever way the bone's own axes lie
      b.parent.getWorldQuaternion(this.q).invert();
      this.ax.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, 0).applyQuaternion(g.quaternion).applyQuaternion(this.q);
      b.quaternion.premultiply(this.q2.setFromAxisAngle(this.ax, angle * k));
      w.left.copy(b.quaternion);
    };
    swing('spine2', 0.07 * Math.sin(ph), 'y');
    swing('arm_upper_L', 0.42 * Math.sin(ph), 'x');
    swing('arm_upper_R', -0.42 * Math.sin(ph), 'x');
    swing('leg_upper_R', 0.3 * Math.sin(ph), 'x');
    swing('leg_upper_L', -0.3 * Math.sin(ph), 'x');
    // the paw that is coming forward is lifted
    swing('arm_lower_L', -0.3 * Math.max(0, Math.cos(ph)), 'x');
    swing('arm_lower_R', -0.3 * Math.max(0, -Math.cos(ph)), 'x');
  }

  /** take the swing back off, before a clip of its own takes over */
  private settle() {
    for (const name in this.swung) {
      const b = this.bones[name], w = this.swung[name];
      if (b.quaternion.equals(w.left)) b.quaternion.copy(w.base);
      w.left.set(9, 9, 9, 9);
    }
    this.walk?.stop();
    this.now?.setEffectiveWeight(1);
    this.stride = 0;
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
  private onto(eye: THREE.Vector3, look: THREE.Vector3, out: THREE.Vector3, off = 0.2) {
    this.a.copy(MOUTH).applyQuaternion(this.group.quaternion);
    return out.copy(eye).addScaledVector(look, off).sub(this.a);
  }

  update(dt: number, eye: THREE.Vector3, look: THREE.Vector3, inside: boolean, where: { e: number; s: number }) {
    if (!this.ready) return;
    const g = this.group;
    this.shake *= Math.exp(-dt / 0.12);
    if (this.rec >= 0) {
      // It has had us, and that is the end of us. Black. Out of the black, its eyes, twice, right over us; the torch
      // catches for a tenth of a second, three times, and it is still there. Then black again, and we begin again
      const r = (this.rec += dt);
      // (flat on our back the head rolls: from the roof to back along the tunnel, where there is room for what is on us)
      this.close = 0; this.flail = 0;
      this.fall = 1 - 0.6 * sstep(0.05, 0.9, r);
      // it has not gone: over us, its head drawn back a little, looking straight at us down the line we look up it.
      // Never further back than the earth lets it
      this.face(eye, 1);
      g.rotation.x = Math.min(1.3, Math.asin(Math.max(-1, Math.min(1, look.y))));
      const room = this.world.march(eye, look, 0.9) - 0.24;
      this.onto(eye, look, g.position, Math.max(0.16, Math.min(room, 0.2 + 0.26 * sstep(0.2, 1.2, r))));
      this.mixer.update(dt * 0.35);
      const swell = (a: number, b: number) => sstep(a, a + 0.18, r) * (1 - sstep(b - 0.25, b, r));
      const eyes = Math.max(swell(1.3, 1.9), swell(3.5, 4.2));
      const flash = (r > 2.4 && r < 2.47) || (r > 2.62 && r < 2.76) || (r > 4.75 && r < 4.82);
      this.lamp = flash ? 0.35 + 0.65 * Math.random() : 0;
      this.dark = flash ? 0 : 1 - eyes;
      BEAST_EYES.value = flash ? 0 : eyes;
      if (r > DEATH) {
        this.rec = -1;
        this.lamp = 1; this.dark = 0; this.fall = 0;
        BEAST_EYES.value = 0;
        g.rotation.x = 0;
        this.home();
        this.onCaught();
      }
      return;
    }
    if (this.state === 'away' || this.state === 'gone') return;
    const dist = g.position.distanceTo(eye);
    if (this.state === 'lurk') {
      if (this.angry) { this.state = 'stalk'; this.lost = 0; this.stood = 0; return; }
      g.visible = dist < 9;
      if (!g.visible) return;
      this.face(eye, 1 - Math.exp(-dt / 0.5));
      this.mixer.update(dt);
      // from far off it lets us look. Once we have come as near as we can and stood there a moment, it starts
      if (inside && dist < 3.3 && this.sees(eye)) {
        this.seen += dt * (dist < 2.7 ? 1 : 0.4);
        if (this.seen > 1.1) { this.state = 'stalk'; this.lost = 0; this.stood = 0; this.keen = MEMORY; this.patience = 1.8 + this.rnd() * 1.6; }
      }
      return;
    }
    if (this.state === 'stalk') {
      const sees = this.sees(eye);
      // it comes up to us and stops: right there in the lamp, for as long as it cares to
      const near = dist < STAND && sees;
      this.stood = near ? this.stood + dt : Math.max(0, this.stood - dt * 0.5);
      // after us through the tunnels, the way we went (not the shortest way: it can be led round), for as long as we
      // are down here. Slowly while we can see it; out of our sight it makes up ground
      const here = this.world.edges[where.e].open ? undefined : where;
      // (robbed, its place is the way out: it only leaves that for us when we are close enough to be worth it)
      if (sees && (!this.angry || dist < 3.3)) { this.crumbs.length = 0; this.keen = MEMORY; } else this.keen -= dt;
      const last = this.crumbs[this.crumbs.length - 1];
      if (here && (!last || last.e !== here.e || Math.abs(last.s - here.s) > 0.3) && this.crumbs.length < 600) this.crumbs.push({ e: here.e, s: here.s });
      while (this.crumbs.length > 1 && this.at.ei === this.crumbs[0].e && Math.abs(this.at.s - this.crumbs[0].s) < 0.15) this.crumbs.shift();
      // robbed, and with no notion any more of where we are: it goes to bar the way out, by the shortest way there
      const barring = this.angry && this.keen <= 0;
      const to = barring ? this.gate : this.crumbs[0] ?? where;
      if (barring) this.crumbs.length = 0;
      const speed = this.angry ? (sees ? RAGE : RAGE_UNSEEN) : sees ? CRAWL : CRAWL * 1.9;
      g.visible = true;
      this.from.copy(g.position);
      const moved = near ? 0 : this.pursue(speed * dt, to.e, to.s);
      // nose the way it is going; and at us, once it is close and can see us
      if (sees && dist < 2.6) this.face(eye, 1 - Math.exp(-dt / 0.2));
      else if (moved > 1e-5) this.face(this.a.copy(g.position).multiplyScalar(2).sub(this.from), 1 - Math.exp(-dt / 0.25));
      if (this.walk) {
        // the cycle, at the rate the ground is going by, faded in over the idle as it sets off and out as it stops
        this.stride += ((moved > 0 ? 1 : 0) - this.stride) * (1 - Math.exp(-dt / 0.3));
        if (!this.walk.isRunning()) this.walk.reset().play();
        this.walk.setEffectiveWeight(this.stride);
        this.now?.setEffectiveWeight(1 - this.stride);
        this.walk.timeScale = moved > 0 ? moved / dt / (STRIDE / this.walk.getClip().duration) : 0.35;
        this.mixer.update(dt);
      } else {
        this.mixer.update(dt);
        this.crawl(moved, dt);
      }
      if (this.stood > this.patience) { this.settle(); this.state = 'crouch'; this.t = 0; this.play('crouch'); }
      // only out under the sky are we rid of it: it stops inside the mouth, and waits again
      else if ((this.lost = inside ? 0 : this.lost + dt) > 4) { this.settle(); this.state = 'lurk'; this.seen = 0; }
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
      // it hits: over we go, backwards, and the torch with us
      this.fall = 0.75 * sstep(0.28, 0.5, this.t);
      this.flail = sstep(0.25, 0.45, this.t);
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
      this.fall += (1 - this.fall) * (1 - Math.exp(-dt / 0.1));
      this.flail = 1;
      // the torch is knocked about, cuts in and out, and is out
      this.lamp = this.t < 0.3 ? 1 : this.t < 0.55 ? (Math.random() < 0.5 ? 1 : 0.08) : 0;
      if (this.t >= 0.6) { this.state = 'gone'; this.t = 0; this.rec = 0; this.lamp = 0; this.dark = 1; }
    }
  }
}
