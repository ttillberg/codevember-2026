import RAPIER from '@dimforge/rapier3d-compat';

export interface ChildShardBakeInput {
  /** Slot index in the flat output shard array */
  slotIndex: number;
  hullVerts: Float32Array;
  /** Offset from parent centroid in local cube coordinates */
  localOffset: [number, number, number];
  volume: number;
}

export interface ShardBakeInput {
  /** Slot index in the flat output shard array */
  slotIndex: number;
  hullVerts: Float32Array;
  initPos: [number, number, number];
  initQuat: [number, number, number, number];
  linVel: [number, number, number];
  angVel: [number, number, number];
  volume: number;
  /** Minimum impact speed (m/s) to trigger secondary break on floor/pile collision */
  breakSpeed?: number;
  children?: ChildShardBakeInput[];
}

export interface StaticObstacleInput {
  hullVerts: Float32Array;
  pos: [number, number, number];
  quat: [number, number, number, number];
}

export interface BakeRequest {
  id: number;
  totalSlots: number;
  shards: ShardBakeInput[];
  staticObstacles: StaticObstacleInput[];
  maxFrames?: number;
  fps?: number;
}

export interface BakeResponse {
  id: number;
  numShards: number;
  numFrames: number;
  fps: number;
  bakeMs: number;
  /** Packed [px, py, pz, qx, qy, qz, qw] per slot per frame (py < -100 means hidden/inactive) */
  frames: Float32Array;
  /** Packed [frame, x, y, z, size, strength, kind] per contact event (kind: 0=floor, 1=glass, 2=secondary shatter!) */
  contacts: Float32Array;
}

const SCALE = 10; // simulate in decimetres so thin glass shards stay well above solver slop
const INV_SCALE = 1 / SCALE;

let rapierReady: Promise<void> | null = null;
function ensureRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

function makeScaledHull(verts: Float32Array): RAPIER.ColliderDesc | null {
  if (verts.length < 12) return null;
  const scaled = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) scaled[i] = verts[i] * SCALE;
  let desc = RAPIER.ColliderDesc.convexHull(scaled);
  if (!desc) {
    // Fallback to AABB cuboid if nearly degenerate splinter
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < scaled.length; i += 3) {
      if (scaled[i] < minX) minX = scaled[i]; if (scaled[i] > maxX) maxX = scaled[i];
      if (scaled[i + 1] < minY) minY = scaled[i + 1]; if (scaled[i + 1] > maxY) maxY = scaled[i + 1];
      if (scaled[i + 2] < minZ) minZ = scaled[i + 2]; if (scaled[i + 2] > maxZ) maxZ = scaled[i + 2];
    }
    desc = RAPIER.ColliderDesc.cuboid(
      Math.max(0.03, (maxX - minX) * 0.5),
      Math.max(0.03, (maxY - minY) * 0.5),
      Math.max(0.03, (maxZ - minZ) * 0.5),
    );
  }
  return desc;
}

function qRot(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): [number, number, number] {
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [
    v[0] + q.w * tx + (q.y * tz - q.z * ty),
    v[1] + q.w * ty + (q.z * tx - q.x * tz),
    v[2] + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

self.onmessage = async (ev: MessageEvent<BakeRequest>) => {
  await ensureRapier();
  const t0 = performance.now();
  const req = ev.data;
  const fps = req.fps ?? 60;
  const dt = 1 / fps;
  const maxFrames = req.maxFrames ?? 270;
  const totalSlots = req.totalSlots;

  const world = new RAPIER.World({ x: 0, y: -9.81 * SCALE, z: 0 });
  world.timestep = dt;
  world.numSolverIterations = 6;

  // Collision group bitmasks:
  // Group 1 (0x0001): Studio floor & static resting pile
  // Group 2 (0x0002): Primary medium/large shards (collide with floor + each other)
  // Group 4 (0x0004): Tiny / secondary child splinters (collide with floor + resting pile)
  const CG_FLOOR = (0x0001 << 16) | 0x0007;
  const CG_SHARD = (0x0002 << 16) | 0x0003;
  const CG_TINY = (0x0004 << 16) | 0x0001;

  // Flat studio floor at y = 0 (smooth studio epoxy so shards skitter wide!)
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.0 * SCALE, 0),
  );
  const floorCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(16 * SCALE, 1.0 * SCALE, 16 * SCALE)
      .setFriction(0.25)
      .setRestitution(0.38)
      .setCollisionGroups(CG_FLOOR),
    floorBody,
  );
  const floorHandle = floorCol.handle;

  // Previously resting shards on the studio floor (so new pieces bounce off the glass pile!)
  const maxObs = Math.min(req.staticObstacles.length, 160);
  const startObs = req.staticObstacles.length - maxObs;
  for (let i = startObs; i < req.staticObstacles.length; i++) {
    const o = req.staticObstacles[i];
    const desc = makeScaledHull(o.hullVerts);
    if (!desc) continue;
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(o.pos[0] * SCALE, o.pos[1] * SCALE, o.pos[2] * SCALE)
        .setRotation({ x: o.quat[0], y: o.quat[1], z: o.quat[2], w: o.quat[3] }),
    );
    world.createCollider(desc.setFriction(0.42).setRestitution(0.26).setCollisionGroups(CG_FLOOR), rb);
  }

  // Active rigid bodies indexed by flat slotIndex (null = hidden/broken/not yet spawned)
  const slotBodies: Array<RAPIER.RigidBody | null> = new Array(totalSlots).fill(null);
  const slotMeta: Array<ShardBakeInput | null> = new Array(totalSlots).fill(null);
  const slotBroken = new Uint8Array(totalSlots);
  const colToSlot = new Map<number, number>();
  const slotSizes = new Float32Array(totalSlots);

  const sortedVols = req.shards.map((s) => s.volume).sort((a, b) => b - a);
  const fullColThresh = sortedVols.length > 44 ? sortedVols[43] : 0;

  for (const s of req.shards) {
    const slot = s.slotIndex;
    const isTiny = s.volume < fullColThresh && !s.children;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(s.initPos[0] * SCALE, s.initPos[1] * SCALE, s.initPos[2] * SCALE)
      .setRotation({ x: s.initQuat[0], y: s.initQuat[1], z: s.initQuat[2], w: s.initQuat[3] })
      .setLinvel(s.linVel[0] * SCALE, s.linVel[1] * SCALE, s.linVel[2] * SCALE)
      .setAngvel({ x: s.angVel[0], y: s.angVel[1], z: s.angVel[2] })
      .setLinearDamping(0.11)
      .setAngularDamping(0.22)
      .setCcdEnabled(!isTiny);
    const rb = world.createRigidBody(rbDesc);

    const colDesc = makeScaledHull(s.hullVerts);
    if (colDesc) {
      colDesc
        .setDensity(2.5)
        .setFriction(0.25)
        .setRestitution(0.38)
        .setCollisionGroups(isTiny ? CG_TINY : CG_SHARD)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const col = world.createCollider(colDesc, rb);
      colToSlot.set(col.handle, slot);
    }

    slotBodies[slot] = rb;
    slotMeta[slot] = s;
    slotSizes[slot] = Math.pow(Math.max(1e-7, s.volume), 2 / 3);
  }

  const frames = new Float32Array(maxFrames * totalSlots * 7);
  const contactList: number[] = [];
  const events = new RAPIER.EventQueue(true);

  let actualFrames = 0;
  let calmStreak = 0;
  let breakSeed = req.id * 2654435761;
  const rand = () => {
    breakSeed = (breakSeed + 0x6d2b79f5) | 0;
    let t = Math.imul(breakSeed ^ (breakSeed >>> 15), 1 | breakSeed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Frame 0 = initial state (hidden children marked with py = -999)
  for (let slot = 0; slot < totalSlots; slot++) {
    const rb = slotBodies[slot];
    const o = slot * 7;
    if (!rb) {
      frames[o + 1] = -999;
      frames[o + 6] = 1;
    } else {
      const p = rb.translation();
      const q = rb.rotation();
      frames[o] = p.x * INV_SCALE;
      frames[o + 1] = p.y * INV_SCALE;
      frames[o + 2] = p.z * INV_SCALE;
      frames[o + 3] = q.x;
      frames[o + 4] = q.y;
      frames[o + 5] = q.z;
      frames[o + 6] = q.w;
    }
  }
  actualFrames = 1;

  for (let f = 1; f < maxFrames; f++) {
    world.step(events);

    const frameContacts: Array<{ x: number; y: number; z: number; size: number; strength: number; kind: number }> = [];
    const toBreak: Array<{ slot: number; impactSpeed: number }> = [];

    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const s1 = colToSlot.get(h1);
      const s2 = colToSlot.get(h2);
      if (s1 === undefined && s2 === undefined) return;

      const isFloor = h1 === floorHandle || h2 === floorHandle;
      const idx = s1 !== undefined ? s1 : s2!;
      const rb1 = slotBodies[idx];
      if (!rb1) return;

      const v1 = rb1.linvel();
      let rvx = v1.x, rvy = v1.y, rvz = v1.z;
      let size = slotSizes[idx];
      if (s1 !== undefined && s2 !== undefined && slotBodies[s2]) {
        const v2 = slotBodies[s2]!.linvel();
        rvx -= v2.x; rvy -= v2.y; rvz -= v2.z;
        size = Math.min(slotSizes[s1], slotSizes[s2]);
      }
      const speed = Math.hypot(rvx, rvy, rvz) * INV_SCALE;
      if (speed < 0.25) return;

      const p = rb1.translation();
      // Check if a breakable parent shard hit the floor or pile hard enough to split into smaller pieces!
      const checkBreak = (sl: number) => {
        if (slotBroken[sl]) return;
        const meta = slotMeta[sl];
        if (!meta || !meta.children || meta.children.length < 2) return;
        const thresh = meta.breakSpeed ?? 1.85;
        // Require a few frames of flight so it breaks on landing, not at spawn
        if (f > 6 && speed >= thresh && (isFloor || p.y < 0.28 * SCALE)) {
          slotBroken[sl] = 1;
          toBreak.push({ slot: sl, impactSpeed: speed });
        }
      };
      if (s1 !== undefined) checkBreak(s1);
      if (s2 !== undefined) checkBreak(s2);

      frameContacts.push({
        x: p.x * INV_SCALE,
        y: Math.max(0.005, p.y * INV_SCALE),
        z: p.z * INV_SCALE,
        size,
        strength: Math.min(12, speed),
        kind: isFloor ? 0 : 1,
      });
    });

    // Perform secondary breaks right after stepping!
    for (const br of toBreak) {
      const parentRb = slotBodies[br.slot];
      const meta = slotMeta[br.slot];
      if (!parentRb || !meta || !meta.children) continue;

      const pp = parentRb.translation();
      const pq = parentRb.rotation();
      const plv = parentRb.linvel();
      const pav = parentRb.angvel();

      // Record a dedicated secondary-shatter event (kind = 2) for audio + splinter spark burst!
      contactList.push(
        f,
        pp.x * INV_SCALE,
        Math.max(0.015, pp.y * INV_SCALE),
        pp.z * INV_SCALE,
        slotSizes[br.slot],
        Math.min(10, br.impactSpeed),
        2,
      );

      // Remove parent rigid body & spawn its child crystal shards at its exact pose & momentum!
      world.removeRigidBody(parentRb);
      slotBodies[br.slot] = null;

      for (const ch of meta.children) {
        const offWorld = qRot(pq, ch.localOffset);
        const cx = pp.x + offWorld[0] * SCALE;
        const cy = Math.max(0.012 * SCALE, pp.y + offWorld[1] * SCALE);
        const cz = pp.z + offWorld[2] * SCALE;

        // Energetic outward secondary shatter burst so fragments shoot & skitter far across the floor!
        const ol = Math.hypot(offWorld[0], offWorld[1], offWorld[2]) || 1;
        const pop = (1.15 + rand() * 1.45) * Math.min(2.6, 0.75 + br.impactSpeed * 0.34);
        const cvx = plv.x * 0.84 + (offWorld[0] / ol) * pop * SCALE + (rand() - 0.5) * 1.15 * SCALE;
        const cvy = Math.max(0.75 * SCALE, Math.abs(plv.y) * 0.44 + (0.65 + rand() * 1.05) * SCALE);
        const cvz = plv.z * 0.84 + (offWorld[2] / ol) * pop * SCALE + (rand() - 0.5) * 1.15 * SCALE;

        const cRb = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(cx, cy, cz)
            .setRotation(pq)
            .setLinvel(cvx, cvy, cvz)
            .setAngvel({
              x: pav.x * 0.7 + (rand() - 0.5) * 18,
              y: pav.y * 0.7 + (rand() - 0.5) * 18,
              z: pav.z * 0.7 + (rand() - 0.5) * 18,
            })
            .setLinearDamping(0.12)
            .setAngularDamping(0.24),
        );
        const cDesc = makeScaledHull(ch.hullVerts);
        if (cDesc) {
          cDesc
            .setDensity(2.5)
            .setFriction(0.24)
            .setRestitution(0.34)
            .setCollisionGroups(CG_TINY)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
          const col = world.createCollider(cDesc, cRb);
          colToSlot.set(col.handle, ch.slotIndex);
        }
        slotBodies[ch.slotIndex] = cRb;
        slotSizes[ch.slotIndex] = Math.pow(Math.max(1e-7, ch.volume), 2 / 3);
      }
    }

    if (frameContacts.length > 0) {
      frameContacts.sort((a, b) => b.strength * b.size - a.strength * a.size);
      const keep = Math.min(8, frameContacts.length);
      for (let k = 0; k < keep; k++) {
        const c = frameContacts[k];
        contactList.push(f, c.x, c.y, c.z, c.size, c.strength, c.kind);
      }
    }

    let moving = 0;
    const base = f * totalSlots * 7;
    for (let slot = 0; slot < totalSlots; slot++) {
      const rb = slotBodies[slot];
      const o = base + slot * 7;
      if (!rb) {
        frames[o + 1] = -999;
        frames[o + 6] = 1;
        continue;
      }
      const p = rb.translation();
      const q = rb.rotation();
      frames[o] = p.x * INV_SCALE;
      frames[o + 1] = p.y * INV_SCALE;
      frames[o + 2] = p.z * INV_SCALE;
      frames[o + 3] = q.x;
      frames[o + 4] = q.y;
      frames[o + 5] = q.z;
      frames[o + 6] = q.w;

      const lv = rb.linvel();
      const av = rb.angvel();
      const spd = Math.hypot(lv.x, lv.y, lv.z) * INV_SCALE;
      const rotSpd = Math.hypot(av.x, av.y, av.z);
      if (f > 20 && p.y < 0.22 * SCALE && spd < 0.12 && rotSpd < 0.55) {
        rb.setLinvel({ x: lv.x * 0.82, y: lv.y * 0.82, z: lv.z * 0.82 }, false);
        rb.setAngvel({ x: av.x * 0.72, y: av.y * 0.72, z: av.z * 0.72 }, false);
        if (spd < 0.03 && rotSpd < 0.15) {
          rb.sleep();
        }
      }
      if (!rb.isSleeping() && p.y > -2 * SCALE && (spd > 0.04 || rotSpd > 0.18)) {
        moving++;
      }
    }

    actualFrames = f + 1;
    if (moving === 0) {
      calmStreak++;
      if (calmStreak >= 14 && f > 40) break;
    } else {
      calmStreak = 0;
    }
  }

  world.free();
  const trimmedFrames = frames.slice(0, actualFrames * totalSlots * 7);
  const contacts = new Float32Array(contactList);
  const resp: BakeResponse = {
    id: req.id,
    numShards: totalSlots,
    numFrames: actualFrames,
    fps,
    bakeMs: performance.now() - t0,
    frames: trimmedFrames,
    contacts,
  };
  (self as unknown as Worker).postMessage(resp, [trimmedFrames.buffer, contacts.buffer]);
};
