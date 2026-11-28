// What there is to do down here. The thing on the lower level sits on a nest, and in the nest is one egg. It cannot be
// walked up to: it has to be drawn off its nest and led away round the loop of tunnels behind it, and the nest come
// at from the other side. Lift the egg and it knows; then the way out is barred, and that takes leading it round a
// loop too. Out under the sky with the egg is the end of it.
import * as THREE from 'three';
import type { World } from './world';
import type { Beast } from './beast';
import { eggMaterial, litterMaterial, litterDepthMaterial, depthMaterial } from './gfx';

/** an egg standing on its blunt end at the origin: length and girth in metres */
export function eggGeometry(length = 0.068, girth = 0.05): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI;
    // rounder below, drawn out above
    pts.push(new THREE.Vector2(Math.max(0, (girth / 2) * Math.sin(t) * (1 + 0.2 * Math.cos(t))), (-length / 2) * Math.cos(t)));
  }
  const g = new THREE.LatheGeometry(pts, 32);
  g.computeVertexNormals();
  return g;
}

export class Game {
  /** the nest, and the egg while it lies in it */
  group = new THREE.Group();
  /** the egg while we have it */
  held: THREE.Mesh;
  casters: { obj: THREE.Mesh; depth: THREE.Material }[] = [];
  carrying = false;
  won = false;
  /** where the nest is */
  nest = new THREE.Vector3();
  onTake: () => void = () => {};
  onWin: () => void = () => {};
  private egg: THREE.Mesh;
  private lift = 0;
  private v = new THREE.Vector3();

  constructor(private world: World, beast: Beast, rnd: () => number) {
    const geo = eggGeometry();
    this.egg = new THREE.Mesh(geo, eggMaterial());
    this.held = new THREE.Mesh(geo, eggMaterial(0.07));
    this.egg.frustumCulled = this.held.frustumCulled = false;
    this.held.visible = false;

    // the nest: right under where it sits, at the foot of its run. It broods
    const lair = beast.lair;
    const down = new THREE.Vector3(0, -1, 0);
    if (lair) {
      const e = world.edges[lair.ei];
      world.railPoint(e, Math.max(0.06, lair.s - 0.3), this.nest);
      this.nest.y -= Math.min(0.6, world.march(this.nest, down, 0.6));
    }
    const floorAt = (x: number, z: number) => {
      const o = new THREE.Vector3(x, this.nest.y + 0.25, z);
      if (world.sample(o.x, o.y, o.z) > -0.01) return NaN;
      const t = world.march(o, down, 0.6);
      return t >= 0.6 ? NaN : o.y - t;
    };
    // a ring of root hair, straw and leaf pulled round into a cup (the den's bedding, a few hundred pieces of it)
    const SEG = 4;
    const lp: number[] = [], li: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      lp.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
      if (i < SEG) { const k = i * 2; li.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    lg.setIndex(li);
    const aPos: number[] = [], aDir: number[] = [], aUp: number[] = [], aShape: number[] = [], aLook: number[] = [];
    for (let i = 0; i < 700; i++) {
      const ang = rnd() * Math.PI * 2, r = 0.05 + Math.abs(rnd() + rnd() - 1) * 0.13;
      const x = this.nest.x + Math.cos(ang) * r, z = this.nest.z + Math.sin(ang) * r;
      const y = floorAt(x, z);
      if (Number.isNaN(y)) continue;
      // lying round the ring, not across it; heaped highest at the rim
      const rim = Math.exp(-(((r - 0.1) / 0.045) ** 2)), h = rnd();
      const yaw = ang + Math.PI / 2 + (rnd() - 0.5) * 0.9, tilt = (rnd() - 0.5) * 0.5;
      const leaf = rnd() < 0.08;
      aPos.push(x, y + 0.004 + 0.035 * rim * h, z);
      aDir.push(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
      aUp.push((rnd() - 0.5) * 0.9, 1, (rnd() - 0.5) * 0.9);
      if (leaf) aShape.push(0.05 + rnd() * 0.05, 0.01 + rnd() * 0.01, (rnd() - 0.5) * 0.9, 1);
      else aShape.push(0.06 + rnd() * rnd() * 0.16, 0.001 + rnd() * 0.002, (rnd() - 0.5) * 0.9, 0);
      aLook.push(rnd(), 0.35 + 0.65 * h);
    }
    lg.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(aPos), 3));
    lg.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(aDir), 3));
    lg.setAttribute('aUp', new THREE.InstancedBufferAttribute(new Float32Array(aUp), 3));
    lg.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(aShape), 4));
    lg.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 2));
    lg.instanceCount = aPos.length / 3;
    const litter = new THREE.Mesh(lg, litterMaterial());
    litter.frustumCulled = false;
    this.group.add(litter, this.egg);
    this.casters.push({ obj: litter, depth: litterDepthMaterial() }, { obj: this.egg, depth: depthMaterial() });
    this.lay();
  }

  /** the egg, lying in the nest a little on its side */
  private lay() {
    this.egg.position.copy(this.nest);
    this.egg.position.y += 0.03;
    this.egg.rotation.set(1.25, 0.6, 0.2);
    this.egg.visible = true;
    this.held.visible = false;
    this.carrying = false;
  }

  /** It has had us: whatever we carried goes back where it came from. True if there was anything. */
  drop(): boolean {
    const had = this.carrying;
    this.lay();
    return had;
  }

  /** Start with the egg already in hand (for looking at the way out). */
  take() {
    this.carrying = true;
    this.lift = 0;
    this.egg.visible = false;
    this.held.visible = true;
    this.onTake();
  }

  update(dt: number, time: number, eye: THREE.Vector3, camQ: THREE.Quaternion, inside: boolean, pace: number) {
    if (this.won) return;
    this.group.visible = eye.distanceTo(this.nest) < 9;
    if (!this.carrying) {
      // close enough to put a paw on it: it is ours
      if (inside && eye.distanceTo(this.nest) < 0.45) this.take();
      return;
    }
    // carried low in front, just under the lamp where its light spills on it, lifted into view as it is picked up;
    // it rides the stride
    this.lift += (1 - this.lift) * (1 - Math.exp(-dt / 0.35));
    this.v.set(0.085, -0.1 - 0.12 * (1 - this.lift) + 0.004 * Math.sin(time * 7.3) * pace, -0.27).applyQuaternion(camQ);
    this.held.position.copy(eye).add(this.v);
    this.held.quaternion.copy(camQ);
    this.held.rotateZ(0.35 + 0.05 * Math.sin(time * 3.7) * pace);
    this.held.rotateX(-0.25);
    // out under the sky with it
    if (!inside && eye.z > 0.3) { this.won = true; this.onWin(); }
  }
}
