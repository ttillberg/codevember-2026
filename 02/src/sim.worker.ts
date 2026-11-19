// The fall, baked. The pane is handed over as convex shards; they are let go in a wave from the last impact,
// simulated with Rapier faster than real time, and every frame goes back to the page as positions and
// rotations. The page plays them as they arrive, so the fall is as smooth as its frame rate whatever the count.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Body } from './shards';

export interface BakeRequest {
  type: 'bake';
  run: number;
  bodies: Body[];
  /** world x, y of every blow: where a ball goes through */
  impacts: [number, number][];
  width: number;
  y0: number;
  seed: number;
  /** the balls as they reach the glass: position, velocity, spin, radius. The pose of the first is the last body of every frame. */
  balls: { p: number[]; v: number[]; w: number[]; r: number }[];
  cfg: SimConfig;
  /** part of the pane stays up: the pieces must leave backwards, not slide down inside it */
  standing?: boolean;
}

/** What the settings panel turns. */
export interface SimConfig { gravity: number; ballDensity: number; pushBack: number; pushOut: number; reach: number; spin: number; front: number; bounce: number; friction: number; stuck: number; seconds: number }
export const SIM_DEFAULTS: SimConfig = { gravity: 9.81, ballDensity: 4, pushBack: 13, pushOut: 4.5, reach: 0.3, spin: 16, front: 7, bounce: 0.22, friction: 0.45, stuck: 0.5, seconds: 7 };

export interface FramesMessage {
  type: 'frames';
  run: number;
  first: number;
  count: number;
  /** count × (bodies + 1) × 7: position, quaternion; the ball last */
  data: Float32Array;
  /** count: how hard glass hit the floor during that frame */
  hits: Float32Array;
  done: boolean;
}

/** The sim runs in decimetres: 8 mm shards are small for a solver tuned for metres. */
const S = 10;
const FPS = 60;
const SUB = 2;

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
  const cfg = { ...SIM_DEFAULTS, ...req.cfg };
  const world = new RAPIER.World({ x: 0, y: -cfg.gravity * S, z: 0 });
  world.timestep = 1 / (FPS * SUB);

  const G_SHARD = 0x0001, G_TINY = 0x0002, G_WORLD = 0x0004, G_BALL = 0x0008;
  const groups = (member: number, filter: number) => (member << 16) | filter;

  // floor, and the channel the pane stands in
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(80, 5, 80).setTranslation(0, -5, 0).setFriction(0.7).setRestitution(0.3).setCollisionGroups(groups(G_WORLD, G_SHARD | G_TINY | G_BALL)), ground);
  // the back wall, for the ball
  world.createCollider(RAPIER.ColliderDesc.cuboid(80, 80, 5).setTranslation(0, 0, (-2.4 - 0.5) * S).setRestitution(0.4).setCollisionGroups(groups(G_WORLD, G_SHARD | G_TINY | G_BALL)), ground);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid((req.width / 2 + 0.03) * S, (req.y0 / 2) * S, 0.022 * S).setTranslation(0, (req.y0 / 2) * S, -0.004 * S)
      .setFriction(0.5).setRestitution(0.2).setCollisionGroups(groups(G_WORLD, G_SHARD | G_TINY | G_BALL)),
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
        world.createCollider(desc.setFriction(cfg.friction).setRestitution(cfg.bounce).setCollisionGroups(groups(G_SHARD, G_SHARD | G_WORLD | G_BALL)), body);
        made++;
      }
      if (!made) world.createCollider(RAPIER.ColliderDesc.ball(0.004 * S).setCollisionGroups(groups(G_TINY, G_WORLD)), body);
    }
    bodies.push(body);
    // the pane lets go from the last impact outwards, then from the top down
    let dx = 0, dy = 0, d = Infinity;
    for (const im of req.impacts) {
      const ex = b.c[0] - im[0], ey = b.c[1] - im[1], e = Math.hypot(ex, ey);
      if (e < d) { d = e; dx = ex; dy = ey; }
    }
    // what the ball is about to go through is loose at once, the rest follows within a few frames
    release[i] = d < 0.2 ? 0 : ((d - 0.2) / cfg.front) * (0.75 + rand() * 0.5) + rand() * 0.02;
    if (b.low && b.c[1] - req.y0 < 0.14 && d > 0.25 && !req.standing && rand() < cfg.stuck) { state[i] = 2; continue; }
    last = Math.max(last, release[i]);
    // the bullet pushes what is near it through, the rest gets a nudge either way
    const near = Math.exp(-d / cfg.reach);
    const out = d > 1e-4 ? 1 / d : 0;
    // a hard kick: the middle is blown out the back in a cone, the rim of the pane is thrown outwards
    kick[i * 6] = dx * out * (cfg.pushOut * near + 0.5) * (req.standing ? 0.35 : 1) * (0.5 + rand()) + gauss() * 0.3;
    kick[i * 6 + 1] = dy * out * (cfg.pushOut * near + 0.4) * (req.standing ? 0.35 : 1) * (0.5 + rand()) + gauss() * 0.3 + 1.2 * near;
    kick[i * 6 + 2] = -cfg.pushBack * near * (0.35 + rand()) - (req.standing ? 1.6 : 0.4) - rand() * 1.4;
    const w = cfg.spin * (0.25 + near) + (b.tiny ? 8 : 0);
    kick[i * 6 + 3] = gauss() * w; kick[i * 6 + 4] = gauss() * w; kick[i * 6 + 5] = gauss() * w * 0.5;
  }

  // the balls: far heavier than a real one, so the glass does not slow them: they go through as if nothing was there
  const balls = req.balls.map((bl) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(bl.p[0] * S, bl.p[1] * S, bl.p[2] * S)
        .setLinvel(bl.v[0] * S, bl.v[1] * S, bl.v[2] * S).setAngvel({ x: bl.w[0], y: bl.w[1], z: bl.w[2] }).setCcdEnabled(true),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(bl.r * S).setDensity(cfg.ballDensity).setRestitution(0.55).setFriction(0.6).setCollisionGroups(groups(G_BALL, G_SHARD | G_WORLD)), body);
    return body;
  });
  const ball = balls[0];

  const maxFrames = Math.round(cfg.seconds * FPS);
  const CHUNK = 6;
  const N7 = (n + 1) * 7;
  let data = new Float32Array(CHUNK * N7);
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
    const o = inChunk * N7;
    for (let i = 0; i < n; i++) {
      const body = bodies[i];
      const p = body.translation(), q = body.rotation();
      const k = o + i * 7;
      data[k] = p.x / S; data[k + 1] = p.y / S; data[k + 2] = p.z / S;
      data[k + 3] = q.x; data[k + 4] = q.y; data[k + 5] = q.z; data[k + 6] = q.w;
      if (state[i] === 1 && !body.isSleeping()) awake++;
    }
    {
      const p = ball.translation(), q = ball.rotation(), k = o + n * 7;
      data[k] = p.x / S; data[k + 1] = p.y / S; data[k + 2] = p.z / S;
      data[k + 3] = q.x; data[k + 4] = q.y; data[k + 5] = q.z; data[k + 6] = q.w;
      for (const bb of balls) { const lv = bb.linvel(); if (!bb.isSleeping() && Math.hypot(lv.x, lv.y, lv.z) > 0.3 * S) awake++; }
    }
    hits[inChunk] = hit;
    inChunk++;
    quiet = t > last + 0.5 && awake === 0 ? quiet + 1 : 0;
    const done = f === maxFrames - 1 || quiet > 20;
    if (inChunk === CHUNK || done) {
      const msg: FramesMessage = { type: 'frames', run: req.run, first, count: inChunk, data: data.subarray(0, inChunk * N7), hits: hits.subarray(0, inChunk), done };
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
