// The fall, baked. The pane is handed over as convex shards; they are let go in a wave from the last impact,
// simulated with Rapier faster than real time, and every frame goes back to the page as positions and
// rotations. The page plays them as they arrive, so the fall is as smooth as its frame rate whatever the count.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Body } from './shards';

export interface BakeRequest {
  type: 'bake';
  run: number;
  bodies: Body[];
  impact: [number, number]; // world x, y of the last bullet
  width: number;
  y0: number;
  seed: number;
}

export interface FramesMessage {
  type: 'frames';
  run: number;
  first: number;
  count: number;
  /** count × bodies × 7: position, quaternion */
  data: Float32Array;
  /** count: how hard glass hit the floor during that frame */
  hits: Float32Array;
  done: boolean;
}

/** The sim runs in decimetres: 8 mm shards are small for a solver tuned for metres. */
const S = 10;
const FPS = 60;
const SUB = 2;
const MAX_SECONDS = 7;

const ready = RAPIER.init();
let current = 0;

function rng32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

self.onmessage = async (e: MessageEvent<BakeRequest>) => {
  const req = e.data;
  if (req.type !== 'bake') return;
  current = req.run;
  await ready;
  bake(req);
};

async function bake(req: BakeRequest) {
  const rand = rng32(req.seed);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.7320508;
  const world = new RAPIER.World({ x: 0, y: -9.81 * S, z: 0 });
  world.timestep = 1 / (FPS * SUB);

  const G_SHARD = 0x0001, G_TINY = 0x0002, G_WORLD = 0x0004;
  const groups = (member: number, filter: number) => (member << 16) | filter;

  // floor, and the channel the pane stands in
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(80, 5, 80).setTranslation(0, -5, 0).setFriction(0.7).setRestitution(0.3).setCollisionGroups(groups(G_WORLD, G_SHARD | G_TINY)), ground);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid((req.width / 2 + 0.03) * S, (req.y0 / 2) * S, 0.022 * S).setTranslation(0, (req.y0 / 2) * S, -0.004 * S)
      .setFriction(0.5).setRestitution(0.2).setCollisionGroups(groups(G_WORLD, G_SHARD | G_TINY)),
    ground,
  );

  const n = req.bodies.length;
  const bodies: RAPIER.RigidBody[] = [];
  const release = new Float32Array(n);
  const kick = new Float32Array(n * 6);
  const state = new Uint8Array(n); // 0 held, 1 falling, 2 stuck in the channel for good
  const prevVy = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const b = req.bodies[i];
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.c[0] * S, b.c[1] * S, b.c[2] * S));
    if (b.tiny) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(b.half[0] * S, b.half[1] * S, b.half[2] * S).setFriction(0.6).setRestitution(0.35).setCollisionGroups(groups(G_TINY, G_WORLD)), body);
    } else {
      let made = 0;
      for (const h of b.hulls) {
        const pts = new Float32Array(h.length);
        for (let k = 0; k < h.length; k++) pts[k] = h[k] * S;
        const desc = RAPIER.ColliderDesc.convexHull(pts);
        if (!desc) continue;
        world.createCollider(desc.setFriction(0.45).setRestitution(0.22).setCollisionGroups(groups(G_SHARD, G_SHARD | G_WORLD)), body);
        made++;
      }
      if (!made) world.createCollider(RAPIER.ColliderDesc.ball(0.004 * S).setCollisionGroups(groups(G_TINY, G_WORLD)), body);
    }
    bodies.push(body);
    // the pane lets go from the last impact outwards, then from the top down
    const dx = b.c[0] - req.impact[0], dy = b.c[1] - req.impact[1];
    const d = Math.hypot(dx, dy);
    release[i] = (d / 2.6) * (0.75 + rand() * 0.5) + rand() * 0.03;
    if (b.low && b.c[1] - req.y0 < 0.16 && rand() < 0.7) { state[i] = 2; continue; }
    last = Math.max(last, release[i]);
    // the bullet pushes what is near it through, the rest gets a nudge either way
    const near = Math.exp(-d / 0.1);
    const out = d > 1e-4 ? 1 / d : 0;
    kick[i * 6] = dx * out * (0.9 * near + 0.08) + gauss() * 0.08;
    kick[i * 6 + 1] = dy * out * (0.9 * near) + gauss() * 0.08;
    kick[i * 6 + 2] = -2.8 * near * (0.5 + rand()) + (rand() < 0.68 ? -1 : 1) * (0.1 + rand() * 0.35);
    const w = 1.5 + 9 * near + (b.tiny ? 6 : 0);
    kick[i * 6 + 3] = gauss() * w; kick[i * 6 + 4] = gauss() * w; kick[i * 6 + 5] = gauss() * w * 0.5;
  }

  const maxFrames = MAX_SECONDS * FPS;
  const CHUNK = 6;
  let data = new Float32Array(CHUNK * n * 7);
  let hits = new Float32Array(CHUNK);
  let inChunk = 0, first = 0, quiet = 0;
  for (let f = 0; f < maxFrames; f++) {
    const t = f / FPS;
    let hit = 0;
    for (let s = 0; s < SUB; s++) {
      const ts = t + s / (FPS * SUB);
      for (let i = 0; i < n; i++) {
        if (state[i] !== 0 || release[i] > ts) continue;
        state[i] = 1;
        const body = bodies[i];
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        body.setLinvel({ x: kick[i * 6] * S, y: kick[i * 6 + 1] * S, z: kick[i * 6 + 2] * S }, true);
        body.setAngvel({ x: kick[i * 6 + 3], y: kick[i * 6 + 4], z: kick[i * 6 + 5] }, true);
      }
      world.step();
      for (let i = 0; i < n; i++) {
        if (state[i] !== 1) continue;
        const vy = bodies[i].linvel().y / S;
        if (prevVy[i] < -0.6 && vy > prevVy[i] * 0.5) hit += Math.min(1, -prevVy[i] / 4) * Math.min(1, req.bodies[i].area / 0.002 + 0.15);
        prevVy[i] = vy;
      }
    }
    let awake = 0;
    const o = inChunk * n * 7;
    for (let i = 0; i < n; i++) {
      const body = bodies[i];
      const p = body.translation(), q = body.rotation();
      const k = o + i * 7;
      data[k] = p.x / S; data[k + 1] = p.y / S; data[k + 2] = p.z / S;
      data[k + 3] = q.x; data[k + 4] = q.y; data[k + 5] = q.z; data[k + 6] = q.w;
      if (state[i] === 1 && !body.isSleeping()) awake++;
    }
    hits[inChunk] = hit;
    inChunk++;
    quiet = t > last + 0.5 && awake === 0 ? quiet + 1 : 0;
    const done = f === maxFrames - 1 || quiet > 20;
    if (inChunk === CHUNK || done) {
      const msg: FramesMessage = { type: 'frames', run: req.run, first, count: inChunk, data: data.subarray(0, inChunk * n * 7), hits: hits.subarray(0, inChunk), done };
      const copy = { ...msg, data: msg.data.slice(), hits: msg.hits.slice() };
      (self as unknown as Worker).postMessage(copy, [copy.data.buffer, copy.hits.buffer]);
      first += inChunk; inChunk = 0;
      // let a newer request in
      await new Promise((r) => setTimeout(r, 0));
      if (current !== req.run) break;
    }
    if (done) break;
  }
  world.free();
}
