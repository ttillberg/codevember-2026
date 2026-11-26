import * as THREE from 'three';
import {
  R_BALL,
  R_BALL_CENTER,
  R_BALL_PIPE,
  R_IRIS_HOLE,
  WALL_HALF_WIDTH,
  sphToDir,
  type LevelConfig,
  type PipeEdge,
  type SphereGrid,
  type WallSlot,
} from './maze';

export type BallLayer = 'upper' | 'dropping' | 'pipe' | 'rising';

export type ReadyPortal =
  | { kind: 'none' }
  | { kind: 'shutter-enter'; shutterId: number }
  | { kind: 'shutter-exit'; shutterId: number }
  | { kind: 'finish-drop' }
  | { kind: 'toggle'; toggleId: number; label: string };

export interface PhysicsEvents {
  onWallHit?: (strength: number) => void;
  onCheckpoint?: (index: number, allCleared: boolean) => void;
  onDropIntoPipe?: (shutterId: number) => void;
  onEmergeFromPipe?: (shutterId: number) => void;
  onToggle?: (toggleId: number, active: boolean) => void;
}

const TWO_PI = Math.PI * 2;

function clampAngleToArc(theta: number, start: number, end: number): number {
  const span = end - start;
  const rel = (((theta - start) % TWO_PI) + TWO_PI) % TWO_PI;
  if (rel <= span) return start + rel;
  const distToEnd = rel - span;
  const distToStart = TWO_PI - rel;
  return distToEnd < distToStart ? end : start;
}

function closestPointOnWall(dir: THREE.Vector3, wall: WallSlot, out: THREE.Vector3): THREE.Vector3 {
  if (wall.kind === 'lat') {
    let theta = Math.atan2(dir.z, dir.x);
    if (theta < 0) theta += TWO_PI;
    const tc = clampAngleToArc(theta, wall.thetaStart, wall.thetaEnd);
    return sphToDir(wall.phiStart, tc, out);
  }
  const cosT = Math.cos(wall.thetaStart);
  const sinT = Math.sin(wall.thetaStart);
  const horiz = Math.max(0, dir.x * cosT + dir.z * sinT);
  const phi = Math.atan2(horiz, dir.y);
  const pc = Math.max(wall.phiStart, Math.min(wall.phiEnd, phi));
  return sphToDir(pc, wall.thetaStart, out);
}

function slerpVec(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const omega = Math.acos(dot);
  const sinO = Math.sin(omega);
  if (sinO < 1e-5) return out.copy(a);
  const wA = Math.sin((1 - t) * omega) / sinO;
  const wB = Math.sin(t * omega) / sinO;
  return out.set(a.x * wA + b.x * wB, a.y * wA + b.y * wB, a.z * wA + b.z * wB).normalize();
}

export class SphereBallPhysics {
  readonly dir = new THREE.Vector3(0, 1, 0);
  readonly vel = new THREE.Vector3(0, 0, 0);
  readonly ballQuat = new THREE.Quaternion();
  layer: BallLayer = 'upper';
  radius = R_BALL_CENTER;
  cleared: boolean[] = [];
  allCleared = false;
  speed = 0;
  readyPortal: ReadyPortal = { kind: 'none' };
  /** 0..1 progress while resting calmly on/under a ready hole (reaches 1 after 1.0s and activates like a tap) */
  readyPortalDwell = 0;

  private level: LevelConfig;
  private readonly minWallAngle = WALL_HALF_WIDTH * 1.03 + R_BALL / R_BALL_CENTER;
  private readonly minPostAngle = WALL_HALF_WIDTH * 1.12 + R_BALL / R_BALL_CENTER;
  private readonly gravityMag = 7.4;
  private readonly linearDamp = 1.85;
  private readonly restitution = 0.24;
  private readonly maxSpeed = 3.35;
  private readonly restActivateSec = 1.0;

  // Portal transition, underneath half-pipe & mechanical toggle switch state
  private activeShutterId = -1;
  private lastEntryShutterId = -1;
  private suppressDwellShutterId = -1;
  private suppressDwellToggleId = -1;
  private readyPortalKey = '';
  private readyDwellSec = 0;
  private transT = 0;
  private readonly transStartDir = new THREE.Vector3();
  private portalCooldown = 0;
  private pipeEdgeId = 0;
  private pipeT = 0;
  private pipeSpeed = 0;
  toggleMask = 0;
  private toggleCooldown = 0;

  // Scratch vectors
  private readonly invQuat = new THREE.Quaternion();
  private readonly localGravity = new THREE.Vector3();
  private readonly gTan = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly rollAxis = new THREE.Vector3();
  private readonly rollDelta = new THREE.Quaternion();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpTan = new THREE.Vector3();

  constructor(private readonly grid: SphereGrid, initialLevel: LevelConfig) {
    this.level = initialLevel;
    this.cleared = initialLevel.checkpoints.map(() => false);
    this.reset();
  }

  setLevel(level: LevelConfig, resetPosition = false) {
    this.level = level;
    this.cleared = level.checkpoints.map(() => false);
    this.allCleared = false;
    this.toggleMask = 0;
    this.toggleCooldown = 0;
    this.readyPortal = { kind: 'none' };
    this.readyPortalDwell = 0;
    this.readyPortalKey = '';
    this.readyDwellSec = 0;
    this.suppressDwellShutterId = -1;
    this.suppressDwellToggleId = -1;
    if (resetPosition) {
      this.reset();
    }
  }

  reset() {
    this.dir.copy(this.grid.cells[this.level.startCellId].centerDir).normalize();
    this.vel.set(0, 0, 0);
    this.ballQuat.identity();
    this.layer = 'upper';
    this.radius = R_BALL_CENTER;
    this.activeShutterId = -1;
    this.lastEntryShutterId = -1;
    this.suppressDwellShutterId = -1;
    this.suppressDwellToggleId = -1;
    this.transT = 0;
    this.portalCooldown = 0;
    this.toggleMask = 0;
    this.toggleCooldown = 0;
    this.cleared = this.level.checkpoints.map(() => false);
    this.allCleared = false;
    this.speed = 0;
    this.readyPortal = { kind: 'none' };
    this.readyPortalDwell = 0;
    this.readyPortalKey = '';
    this.readyDwellSec = 0;
  }

  /** Helper for demo / inspection: drop the ball directly into a specific shutter's half-pipe */
  enterPipeAtShutter(shutterId: number) {
    const shutter = this.grid.shutters[shutterId];
    if (!shutter) return;
    const node = this.grid.pipeNodes[shutter.pipeNodeId];
    const edgeId = node.edgeIds[0];
    const edge = this.grid.pipeEdges[edgeId];
    this.layer = 'pipe';
    this.radius = R_BALL_PIPE;
    this.lastEntryShutterId = shutterId;
    this.suppressDwellShutterId = shutterId;
    this.pipeEdgeId = edgeId;
    this.pipeT = edge.nodeA === node.id ? 0.02 : 0.98;
    this.pipeSpeed = edge.nodeA === node.id ? 0.55 : -0.55;
    this.dir.copy(node.dir);
    this.vel.set(0, 0, 0);
    this.portalCooldown = 0.7;
    this.readyPortal = { kind: 'none' };
    this.readyPortalDwell = 0;
    this.readyPortalKey = '';
    this.readyDwellSec = 0;
  }

  private clearReadyDwell() {
    this.readyPortalDwell = 0;
    this.readyPortalKey = '';
    this.readyDwellSec = 0;
  }

  /** Advance 1-second rest-to-activate dwell timer; triggers the exact same action as tapping once full */
  private updateReadyPortalDwell(dt: number, shutterOpen: Float32Array, events?: PhysicsEvents) {
    const rp = this.readyPortal;
    if (rp.kind === 'none') {
      this.clearReadyDwell();
      return;
    }

    // Prevent accidental yo-yo auto-retrigger on the exact hole or switch we just activated until the ball moves clear
    if ((rp.kind === 'shutter-enter' || rp.kind === 'shutter-exit') && rp.shutterId === this.suppressDwellShutterId) {
      this.clearReadyDwell();
      return;
    }
    if (rp.kind === 'toggle' && rp.toggleId === this.suppressDwellToggleId) {
      this.clearReadyDwell();
      return;
    }

    const key =
      rp.kind === 'finish-drop'
        ? 'finish'
        : rp.kind === 'toggle'
          ? `toggle:${rp.toggleId}`
          : `${rp.kind}:${rp.shutterId}`;
    if (key !== this.readyPortalKey) {
      this.readyPortalKey = key;
      this.readyDwellSec = 0;
    }

    const restSpeedLimit = rp.kind === 'shutter-exit' ? 0.48 : 0.44;
    if (this.speed <= restSpeedLimit) {
      this.readyDwellSec += dt;
    } else {
      this.readyDwellSec = Math.max(0, this.readyDwellSec - dt * 2.5);
    }

    this.readyPortalDwell = Math.min(1, this.readyDwellSec / this.restActivateSec);
    if (this.readyDwellSec >= this.restActivateSec) {
      this.activateReadyPortal(shutterOpen, events);
    }
  }

  /** Single-tap (or 1-second rest) trigger when the steel ball is seated on an open hole or floor switch */
  activateReadyPortal(shutterOpen: Float32Array, events?: PhysicsEvents): boolean {
    const rp = this.readyPortal;
    if (rp.kind === 'none') return false;

    if (rp.kind === 'shutter-enter') {
      if (this.layer !== 'upper' || this.portalCooldown > 0) return false;
      if (shutterOpen[rp.shutterId] < 0.72) return false;
      this.layer = 'dropping';
      this.activeShutterId = rp.shutterId;
      this.transT = 0;
      this.transStartDir.copy(this.dir);
      this.readyPortal = { kind: 'none' };
      this.clearReadyDwell();
      events?.onDropIntoPipe?.(rp.shutterId);
      return true;
    }

    if (rp.kind === 'shutter-exit') {
      if (this.layer !== 'pipe' || this.portalCooldown > 0) return false;
      if (shutterOpen[rp.shutterId] < 0.72) return false;
      this.layer = 'rising';
      this.activeShutterId = rp.shutterId;
      this.transT = 0;
      this.transStartDir.copy(this.dir);
      this.readyPortal = { kind: 'none' };
      this.clearReadyDwell();
      events?.onEmergeFromPipe?.(rp.shutterId);
      return true;
    }

    if (rp.kind === 'finish-drop') {
      if (this.layer !== 'upper' || this.allCleared) return false;
      const nextIdx = this.getNextCheckpointIndex();
      if (nextIdx < 0) return false;
      const cp = this.level.checkpoints[nextIdx];
      if (!cp.isFinish) return false;
      this.cleared[nextIdx] = true;
      this.allCleared = this.cleared.every(Boolean);
      this.readyPortal = { kind: 'none' };
      this.clearReadyDwell();
      events?.onCheckpoint?.(nextIdx, this.allCleared);
      return true;
    }

    if (rp.kind === 'toggle') {
      if (this.layer !== 'upper' || this.toggleCooldown > 0) return false;
      this.toggleCooldown = 0.38;
      this.suppressDwellToggleId = rp.toggleId;
      this.toggleMask ^= 1 << rp.toggleId;
      this.clearReadyDwell();
      events?.onToggle?.(rp.toggleId, (this.toggleMask & (1 << rp.toggleId)) !== 0);
      return true;
    }

    return false;
  }

  getNextCheckpointIndex(): number {
    for (let i = 0; i < this.cleared.length; i++) {
      if (!this.cleared[i]) return i;
    }
    return -1;
  }

  getClearedCount(): number {
    let count = 0;
    for (const c of this.cleared) if (c) count++;
    return count;
  }

  private edgeTangentAt(edge: PipeEdge, t: number, out: THREE.Vector3): THREE.Vector3 {
    const dA = this.grid.pipeNodes[edge.nodeA].dir;
    const dB = this.grid.pipeNodes[edge.nodeB].dir;
    const t0 = Math.max(0, t - 0.005);
    const t1 = Math.min(1, t + 0.005);
    slerpVec(dA, dB, t0, this.tmpA);
    slerpVec(dA, dB, t1, this.tmpB);
    return out.subVectors(this.tmpB, this.tmpA).normalize();
  }

  private pickNextPipeBranch(nodeId: number, currentEdgeId: number, incomingDir: THREE.Vector3): { edgeId: number; atStart: boolean; alignment: number } {
    const node = this.grid.pipeNodes[nodeId];
    // Combine current momentum direction + tangential gravity at the junction bowl
    const gDot = this.localGravity.dot(node.dir);
    this.gTan.copy(this.localGravity).addScaledVector(node.dir, -gDot);
    const desired = this.tmpA.copy(incomingDir).multiplyScalar(0.75).addScaledVector(this.gTan, 0.22);
    const dLen = desired.length();
    if (dLen > 1e-5) desired.multiplyScalar(1 / dLen);

    let bestEdge = currentEdgeId;
    let bestAtStart = this.grid.pipeEdges[currentEdgeId].nodeA === nodeId;
    let bestScore = -2;

    for (const eid of node.edgeIds) {
      const e = this.grid.pipeEdges[eid];
      const atStart = e.nodeA === nodeId;
      const otherDir = this.grid.pipeNodes[atStart ? e.nodeB : e.nodeA].dir;
      // Tangent pointing AWAY from node along edge e
      this.tmpB.copy(otherDir).addScaledVector(node.dir, -otherDir.dot(node.dir)).normalize();
      let score = this.tmpB.dot(desired);
      // Slight preference against immediately reversing down the exact edge we arrived on
      if (eid === currentEdgeId && node.edgeIds.length > 1) score -= 0.28;
      if (score > bestScore) {
        bestScore = score;
        bestEdge = eid;
        bestAtStart = atStart;
      }
    }

    return { edgeId: bestEdge, atStart: bestAtStart, alignment: bestScore };
  }

  step(
    dt: number,
    sphereQuat: THREE.Quaternion,
    gravityWorldDir: THREE.Vector3,
    wallExtensions: Float32Array,
    shutterOpen: Float32Array,
    events?: PhysicsEvents,
  ) {
    const clampedDt = Math.min(dt, 0.04);
    if (this.portalCooldown > 0) this.portalCooldown = Math.max(0, this.portalCooldown - clampedDt);
    if (this.toggleCooldown > 0) this.toggleCooldown = Math.max(0, this.toggleCooldown - clampedDt);

    this.invQuat.copy(sphereQuat).invert();
    // Gravity pulls toward the camera (as if holding the sphere overhead: ball seeks 50% / 50% of screen!)
    this.localGravity.copy(gravityWorldDir).normalize().multiplyScalar(this.gravityMag).applyQuaternion(this.invQuat);

    // --- 1. DROPPING THROUGH OPEN DIAPHRAGM SHUTTER (Upper -> Half-Pipe) ---
    if (this.layer === 'dropping') {
      this.readyPortal = { kind: 'none' };
      const shutter = this.grid.shutters[this.activeShutterId];
      this.transT = Math.min(1, this.transT + clampedDt / 0.19);
      const easeIn = this.transT * this.transT;
      this.dir.copy(this.transStartDir).lerp(shutter.dir, Math.min(1, this.transT * 1.4)).normalize();
      this.radius = R_BALL_CENTER + (R_BALL_PIPE - R_BALL_CENTER) * easeIn;
      this.speed = 1.4;

      if (this.transT >= 1) {
        const node = this.grid.pipeNodes[shutter.pipeNodeId];
        const branch = this.pickNextPipeBranch(node.id, node.edgeIds[0], this.vel);
        this.pipeEdgeId = branch.edgeId;
        this.pipeT = branch.atStart ? 0.01 : 0.99;
        this.pipeSpeed = branch.atStart ? 0.34 : -0.34;
        this.lastEntryShutterId = shutter.id;
        this.suppressDwellShutterId = shutter.id;
        this.layer = 'pipe';
        this.radius = R_BALL_PIPE;
        this.portalCooldown = 0.38;
      }
      return;
    }

    // --- 2. RISING BACK UP THROUGH OPEN DIAPHRAGM SHUTTER (Half-Pipe -> Upper) ---
    if (this.layer === 'rising') {
      this.readyPortal = { kind: 'none' };
      this.clearReadyDwell();
      const shutter = this.grid.shutters[this.activeShutterId];
      this.transT = Math.min(1, this.transT + clampedDt / 0.21);
      const easeOut = 1 - Math.pow(1 - this.transT, 2);
      this.dir.copy(this.transStartDir).lerp(shutter.dir, Math.min(1, this.transT * 1.5)).normalize();
      this.radius = R_BALL_PIPE + (R_BALL_CENTER - R_BALL_PIPE) * easeOut;
      this.speed = 1.1;

      if (this.transT >= 1) {
        // Pop cleanly onto the upper surface centered on the open shutter so the player can glide smoothly away
        const gDot = this.localGravity.dot(shutter.dir);
        this.gTan.copy(this.localGravity).addScaledVector(shutter.dir, -gDot);
        this.dir.copy(shutter.dir);
        if (this.gTan.lengthSq() > 1e-4) {
          this.gTan.normalize();
          this.vel.copy(this.gTan).multiplyScalar(0.18);
        } else {
          this.vel.set(0, 0, 0);
        }
        this.layer = 'upper';
        this.radius = R_BALL_CENTER;
        this.lastEntryShutterId = -1;
        this.suppressDwellShutterId = shutter.id;
        this.portalCooldown = 0.42;
      }
      return;
    }

    // --- 3. ROLLING INSIDE THE UNDERNEATH HALF-PIPE TUBE SYSTEM ---
    if (this.layer === 'pipe') {
      const substeps = 6;
      const subDt = clampedDt / substeps;

      for (let s = 0; s < substeps; s++) {
        const edge = this.grid.pipeEdges[this.pipeEdgeId];
        const nodeA = this.grid.pipeNodes[edge.nodeA];
        const nodeB = this.grid.pipeNodes[edge.nodeB];
        const dA = nodeA.dir;
        const dB = nodeB.dir;
        slerpVec(dA, dB, this.pipeT, this.dir);
        this.edgeTangentAt(edge, this.pipeT, this.tmpTan);

        // Gravity projected along the curved half-pipe axis
        const accel = this.localGravity.dot(this.tmpTan) * 1.12;
        this.pipeSpeed += accel * subDt;

        // Subtle magnetic detent beneath open shutters along the rail: easy to glide past, effortless to rest under & tap!
        if (this.portalCooldown <= 0) {
          const detentRange = 0.115;
          const absSpd = Math.abs(this.pipeSpeed);
          const speedFactor = Math.max(0.14, 1 - absSpd / 1.75);
          const distA = this.pipeT * edge.arcLen;
          const distB = (1 - this.pipeT) * edge.arcLen;

          if (nodeA.shutterId >= 0 && shutterOpen[nodeA.shutterId] > 0.72 && distA < detentRange) {
            const prof = Math.sin(Math.min(1, distA / detentRange) * Math.PI);
            this.pipeSpeed -= 2.65 * speedFactor * prof * subDt;
            if (distA < 0.072 && absSpd < 0.92) {
              this.pipeSpeed *= Math.exp(-3.8 * subDt);
            }
          } else if (nodeB.shutterId >= 0 && shutterOpen[nodeB.shutterId] > 0.72 && distB < detentRange) {
            const prof = Math.sin(Math.min(1, distB / detentRange) * Math.PI);
            this.pipeSpeed += 2.65 * speedFactor * prof * subDt;
            if (distB < 0.072 && absSpd < 0.92) {
              this.pipeSpeed *= Math.exp(-3.8 * subDt);
            }
          }
        }

        this.pipeSpeed *= Math.exp(-0.92 * subDt);
        this.pipeSpeed = Math.max(-3.6, Math.min(3.6, this.pipeSpeed));

        this.pipeT += (this.pipeSpeed / Math.max(0.08, edge.arcLen)) * subDt;

        // Arrived at junction bowl or shutter port!
        if (this.pipeT <= 0 || this.pipeT >= 1) {
          const atA = this.pipeT <= 0;
          const nodeId = atA ? edge.nodeA : edge.nodeB;
          const node = this.grid.pipeNodes[nodeId];
          this.pipeT = atA ? 0 : 1;
          this.dir.copy(node.dir);

          if (node.shutterId !== this.lastEntryShutterId) {
            this.lastEntryShutterId = -1;
          }

          const isOpenShutterNode = node.shutterId >= 0 && shutterOpen[node.shutterId] > 0.72;

          // Route smoothly onto the best aligned outgoing half-pipe branch, or settle calmly at a dead-end shutter port
          const inDir = this.tmpTan.clone().multiplyScalar(this.pipeSpeed >= 0 ? 1 : -1);
          const next = this.pickNextPipeBranch(nodeId, this.pipeEdgeId, inDir);
          if (next.edgeId !== this.pipeEdgeId) {
            const gDot = this.localGravity.dot(node.dir);
            this.gTan.copy(this.localGravity).addScaledVector(node.dir, -gDot);
            // If gently pausing right beneath a pass-through open shutter with small tilt, seat calmly instead of drifting past
            if (isOpenShutterNode && this.portalCooldown <= 0 && Math.abs(this.pipeSpeed) < 0.32 && this.gTan.length() < 2.2) {
              this.pipeSpeed *= 0.25;
            } else {
              const preserved = Math.max(0.18, Math.abs(this.pipeSpeed) * Math.max(0.35, next.alignment));
              this.pipeEdgeId = next.edgeId;
              this.pipeT = next.atStart ? 0.008 : 0.992;
              this.pipeSpeed = next.atStart ? preserved : -preserved;
            }
          } else {
            if (isOpenShutterNode) {
              // Calmly cradle the steel ball under a dead-end open shutter so one tap exits cleanly
              if (Math.abs(this.pipeSpeed) > 0.65 && events?.onWallHit) {
                events.onWallHit(Math.min(0.45, Math.abs(this.pipeSpeed) / 3.8));
              }
              this.pipeSpeed = -this.pipeSpeed * 0.08;
            } else {
              if (Math.abs(this.pipeSpeed) > 0.45 && events?.onWallHit) {
                events.onWallHit(Math.min(0.65, Math.abs(this.pipeSpeed) / 3.2));
              }
              this.pipeSpeed = -this.pipeSpeed * 0.28;
            }
          }
        }
      }

      const finalEdge = this.grid.pipeEdges[this.pipeEdgeId];
      slerpVec(
        this.grid.pipeNodes[finalEdge.nodeA].dir,
        this.grid.pipeNodes[finalEdge.nodeB].dir,
        this.pipeT,
        this.dir,
      );
      this.edgeTangentAt(finalEdge, this.pipeT, this.tmpTan);
      this.vel.copy(this.tmpTan).multiplyScalar(this.pipeSpeed);
      this.speed = Math.abs(this.pipeSpeed);
      this.radius = R_BALL_PIPE;

      if (this.speed > 1e-4) {
        this.rollAxis.crossVectors(this.dir, this.vel);
        if (this.rollAxis.lengthSq() > 1e-10) {
          this.rollAxis.normalize();
          this.rollDelta.setFromAxisAngle(this.rollAxis, this.speed * clampedDt * (R_BALL_PIPE / R_BALL));
          this.ballQuat.premultiply(this.rollDelta).normalize();
        }
      }

      // Clear dwell suppression once the ball moves away from the shutter it just entered through
      if (this.suppressDwellShutterId >= 0) {
        const supSh = this.grid.shutters[this.suppressDwellShutterId];
        if (supSh && Math.acos(Math.max(-1, Math.min(1, this.dir.dot(supSh.dir)))) > 0.145) {
          this.suppressDwellShutterId = -1;
        }
      }

      // Detect if the steel ball is seated beneath an open diaphragm shutter ready for tap or 1s rest-to-exit
      this.readyPortal = { kind: 'none' };
      if (this.portalCooldown <= 0) {
        let bestAng = 0.112;
        let bestSid = -1;
        for (let i = 0; i < this.grid.shutters.length; i++) {
          if (shutterOpen[i] < 0.72) continue;
          const sh = this.grid.shutters[i];
          const dot = Math.max(-1, Math.min(1, this.dir.dot(sh.dir)));
          const ang = Math.acos(dot);
          if (ang < bestAng) {
            bestAng = ang;
            bestSid = sh.id;
          }
        }
        if (bestSid >= 0) {
          this.readyPortal = { kind: 'shutter-exit', shutterId: bestSid };
        }
      }

      this.checkCheckpoints('pipe', events);
      this.updateReadyPortalDwell(clampedDt, shutterOpen, events);
      return;
    }

    // --- 4. UPPER SURFACE LABYRINTH PHYSICS ---
    const substeps = 8;
    const subDt = clampedDt / substeps;
    let maxImpact = 0;
    const walls = this.grid.walls;
    const posts = this.grid.posts;
    const shutters = this.grid.shutters;
    const nextCpIdx = this.allCleared ? -1 : this.getNextCheckpointIndex();
    const finishCp =
      nextCpIdx >= 0 && this.level.checkpoints[nextCpIdx]?.isFinish ? this.level.checkpoints[nextCpIdx] : null;

    for (let s = 0; s < substeps; s++) {
      const gDotD = this.localGravity.dot(this.dir);
      this.gTan.copy(this.localGravity).addScaledVector(this.dir, -gDotD);

      this.vel.addScaledVector(this.gTan, subDt);
      this.vel.multiplyScalar(Math.exp(-this.linearDamp * subDt));
      this.vel.addScaledVector(this.dir, -this.vel.dot(this.dir));

      // Subtle bevel detent over open diaphragm shutters (and the open South Pole finish hole):
      // Small enough to glide straight over when rolling, tactile enough to gently seat & tap once to enter!
      if (this.portalCooldown <= 0) {
        const spdNow = this.vel.length();
        const speedFactor = Math.max(0.14, 1 - spdNow / 1.65);
        const detentOuter = R_IRIS_HOLE + 0.022;

        for (let i = 0; i < shutters.length; i++) {
          if (shutterOpen[i] < 0.72) continue;
          const sh = shutters[i];
          const dot = Math.max(-1, Math.min(1, this.dir.dot(sh.dir)));
          const ang = Math.acos(dot);
          if (ang < detentOuter) {
            this.tmpA.copy(sh.dir).addScaledVector(this.dir, -dot);
            if (this.tmpA.lengthSq() > 1e-8) {
              this.tmpA.normalize();
              const prof = Math.sin(Math.min(1, ang / detentOuter) * Math.PI);
              this.vel.addScaledVector(this.tmpA, 2.55 * speedFactor * prof * subDt);
            }
            if (ang < R_IRIS_HOLE * 0.92 && spdNow < 0.95) {
              this.vel.multiplyScalar(Math.exp(-3.6 * subDt));
            }
            break;
          }
        }

        if (finishCp) {
          const fOuter = 0.105;
          const dot = Math.max(-1, Math.min(1, this.dir.dot(finishCp.dir)));
          const ang = Math.acos(dot);
          if (ang < fOuter) {
            this.tmpA.copy(finishCp.dir).addScaledVector(this.dir, -dot);
            if (this.tmpA.lengthSq() > 1e-8) {
              this.tmpA.normalize();
              const prof = Math.sin(Math.min(1, ang / fOuter) * Math.PI);
              this.vel.addScaledVector(this.tmpA, 2.6 * speedFactor * prof * subDt);
            }
            if (ang < 0.082 && spdNow < 0.95) {
              this.vel.multiplyScalar(Math.exp(-3.6 * subDt));
            }
          }
        }
      }

      // Same gentle detent on floor switches (SW A / SW B): easy to roll past, effortless to rest 1s or tap!
      const toggles = this.level.toggles;
      if (toggles.length > 0 && this.toggleCooldown <= 0) {
        const spdNow = this.vel.length();
        const speedFactor = Math.max(0.14, 1 - spdNow / 1.65);
        const tOuter = 0.095;
        for (let i = 0; i < toggles.length; i++) {
          const tg = toggles[i];
          const dot = Math.max(-1, Math.min(1, this.dir.dot(tg.dir)));
          const ang = Math.acos(dot);
          if (ang < tOuter) {
            this.tmpA.copy(tg.dir).addScaledVector(this.dir, -dot);
            if (this.tmpA.lengthSq() > 1e-8) {
              this.tmpA.normalize();
              const prof = Math.sin(Math.min(1, ang / tOuter) * Math.PI);
              this.vel.addScaledVector(this.tmpA, 2.45 * speedFactor * prof * subDt);
            }
            if (ang < 0.072 && spdNow < 0.95) {
              this.vel.multiplyScalar(Math.exp(-3.6 * subDt));
            }
            break;
          }
        }
      }

      const spd = this.vel.length();
      if (spd > this.maxSpeed) {
        this.vel.multiplyScalar(this.maxSpeed / spd);
      }

      this.dir.addScaledVector(this.vel, subDt).normalize();
      this.vel.addScaledVector(this.dir, -this.vel.dot(this.dir));

      for (let iter = 0; iter < 2; iter++) {
        // Steady permanent corner poles
        for (let i = 0; i < posts.length; i++) {
          const pDir = posts[i].dir;
          const dot = Math.max(-1, Math.min(1, this.dir.dot(pDir)));
          const ang = Math.acos(dot);
          if (ang < this.minPostAngle) {
            this.normal.copy(this.dir).addScaledVector(pDir, -dot);
            const nLen = this.normal.length();
            if (nLen > 1e-6) {
              this.normal.multiplyScalar(1 / nLen);
              this.dir.addScaledVector(this.normal, this.minPostAngle - ang).normalize();
              this.normal.addScaledVector(this.dir, -this.normal.dot(this.dir));
              if (this.normal.lengthSq() > 1e-8) {
                this.normal.normalize();
                const vn = this.vel.dot(this.normal);
                if (vn < 0) {
                  if (-vn > maxImpact) maxImpact = -vn;
                  this.vel.addScaledVector(this.normal, -(1 + this.restitution) * vn);
                }
              }
            }
          }
        }

        // Retractable & locked wall blades
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          const ext = w.locked ? 1.0 : wallExtensions[i];
          if (ext < 0.22) continue;

          closestPointOnWall(this.dir, w, this.closest);
          const dot = Math.max(-1, Math.min(1, this.dir.dot(this.closest)));
          const ang = Math.acos(dot);
          const effectiveMin = this.minWallAngle * Math.min(1, 0.55 + ext * 0.45);

          if (ang < effectiveMin) {
            this.normal.copy(this.dir).addScaledVector(this.closest, -dot);
            let nLen = this.normal.length();
            if (nLen < 1e-6) {
              this.normal.set(1, 0, 0).cross(this.dir);
              if (this.normal.lengthSq() < 1e-6) this.normal.set(0, 1, 0).cross(this.dir);
              nLen = this.normal.length();
            }
            if (nLen > 1e-6) {
              this.normal.multiplyScalar(1 / nLen);
              this.dir.addScaledVector(this.normal, effectiveMin - ang).normalize();
              this.normal.addScaledVector(this.dir, -this.normal.dot(this.dir));
              if (this.normal.lengthSq() > 1e-8) {
                this.normal.normalize();
                const vn = this.vel.dot(this.normal);
                if (vn < 0) {
                  if (-vn > maxImpact && ext > 0.75) maxImpact = -vn;
                  this.vel.addScaledVector(this.normal, -(1 + this.restitution) * vn);
                  this.vel.multiplyScalar(0.996);
                }
              }
            }
          }
        }
      }
    }

    this.radius = R_BALL_CENTER;
    this.speed = this.vel.length();
    if (this.speed > 1e-4) {
      this.rollAxis.crossVectors(this.dir, this.vel);
      if (this.rollAxis.lengthSq() > 1e-10) {
        this.rollAxis.normalize();
        const rollAngle = this.speed * clampedDt * (R_BALL_CENTER / R_BALL);
        this.rollDelta.setFromAxisAngle(this.rollAxis, rollAngle);
        this.ballQuat.premultiply(this.rollDelta).normalize();
      }
    }

    if (maxImpact > 0.28 && events?.onWallHit) {
      events.onWallHit(Math.min(1, (maxImpact - 0.28) / 2.2));
    }

    this.checkCheckpoints('upper', events);

    // Clear dwell suppression once the ball rolls clear of the shutter or switch it just activated
    if (this.suppressDwellShutterId >= 0) {
      const supSh = this.grid.shutters[this.suppressDwellShutterId];
      if (supSh && Math.acos(Math.max(-1, Math.min(1, this.dir.dot(supSh.dir)))) > R_IRIS_HOLE + 0.042) {
        this.suppressDwellShutterId = -1;
      }
    }
    if (this.suppressDwellToggleId >= 0) {
      const supTg = this.level.toggles[this.suppressDwellToggleId];
      if (!supTg || Math.acos(Math.max(-1, Math.min(1, this.dir.dot(supTg.dir)))) > 0.125) {
        this.suppressDwellToggleId = -1;
      }
    }

    // Detect if the ball is seated on an open upper-deck hole or floor switch (SW A / SW B)
    this.readyPortal = { kind: 'none' };
    if (this.portalCooldown <= 0) {
      let bestAng = R_IRIS_HOLE * 1.02;
      let bestSid = -1;
      for (let i = 0; i < shutters.length; i++) {
        if (shutterOpen[i] < 0.72) continue;
        const sh = shutters[i];
        const dot = Math.max(-1, Math.min(1, this.dir.dot(sh.dir)));
        const ang = Math.acos(dot);
        if (ang < bestAng) {
          bestAng = ang;
          bestSid = sh.id;
        }
      }
      if (bestSid >= 0) {
        this.readyPortal = { kind: 'shutter-enter', shutterId: bestSid };
      } else if (!this.allCleared) {
        const curNext = this.getNextCheckpointIndex();
        const curCp = curNext >= 0 ? this.level.checkpoints[curNext] : null;
        if (curCp && curCp.isFinish) {
          const dot = Math.max(-1, Math.min(1, this.dir.dot(curCp.dir)));
          if (Math.acos(dot) < 0.112) {
            this.readyPortal = { kind: 'finish-drop' };
          }
        }
      }
    }

    if (this.readyPortal.kind === 'none' && this.toggleCooldown <= 0) {
      for (let i = 0; i < this.level.toggles.length; i++) {
        const tg = this.level.toggles[i];
        const dot = Math.max(-1, Math.min(1, this.dir.dot(tg.dir)));
        if (Math.acos(dot) < 0.095) {
          this.readyPortal = { kind: 'toggle', toggleId: tg.id, label: tg.label };
          break;
        }
      }
    }

    this.updateReadyPortalDwell(clampedDt, shutterOpen, events);
  }

  /**
   * STRICT SEQUENTIAL CHECKPOINT ORDER:
   * Only the next unlit checkpoint (`nextIdx`) can be activated; future checkpoints stay locked until their turn!
   */
  private checkCheckpoints(activeLayer: 'upper' | 'pipe', events?: PhysicsEvents) {
    if (this.allCleared) return;
    const nextIdx = this.getNextCheckpointIndex();
    if (nextIdx < 0) return;

    const cp = this.level.checkpoints[nextIdx];
    if (cp.layer !== activeLayer) return;
    // South Pole 13 END uses the same gentle detent + single-tap to drop mechanism as all other holes!
    if (cp.isFinish) return;

    const triggerAngle = activeLayer === 'pipe' ? 0.145 : 0.115;
    const dot = Math.max(-1, Math.min(1, this.dir.dot(cp.dir)));
    if (Math.acos(dot) < triggerAngle) {
      this.cleared[nextIdx] = true;
      this.allCleared = this.cleared.every(Boolean);
      events?.onCheckpoint?.(nextIdx, this.allCleared);
    }
  }
}
