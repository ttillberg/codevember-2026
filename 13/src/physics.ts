import * as THREE from 'three';
import { R_BALL, R_BALL_CENTER, WALL_HALF_WIDTH, sphToDir, type SphereMaze, type WallSegment } from './maze';

export interface PhysicsEvents {
  onWallHit?: (strength: number) => void;
  onCheckpoint?: (index: number, allCleared: boolean) => void;
}

const TWO_PI = Math.PI * 2;

function clampAngleToArc(theta: number, start: number, end: number): number {
  const span = end - start;
  let rel = ((theta - start) % TWO_PI + TWO_PI) % TWO_PI;
  if (rel <= span) return start + rel;
  const distToEnd = rel - span;
  const distToStart = TWO_PI - rel;
  return distToEnd < distToStart ? end : start;
}

function closestPointOnWall(dir: THREE.Vector3, wall: WallSegment, out: THREE.Vector3): THREE.Vector3 {
  if (wall.kind === 'lat') {
    let theta = Math.atan2(dir.z, dir.x);
    if (theta < 0) theta += TWO_PI;
    const tc = clampAngleToArc(theta, wall.thetaStart, wall.thetaEnd);
    return sphToDir(wall.phiStart, tc, out);
  }
  // Meridian wall at constant theta = wall.thetaStart
  const cosT = Math.cos(wall.thetaStart);
  const sinT = Math.sin(wall.thetaStart);
  const horiz = Math.max(0, dir.x * cosT + dir.z * sinT);
  const phi = Math.atan2(horiz, dir.y);
  const pc = Math.max(wall.phiStart, Math.min(wall.phiEnd, phi));
  return sphToDir(pc, wall.thetaStart, out);
}

export class SphereBallPhysics {
  readonly dir = new THREE.Vector3(0, 1, 0);
  readonly vel = new THREE.Vector3(0, 0, 0);
  readonly ballQuat = new THREE.Quaternion();
  readonly cleared: boolean[];
  allCleared = false;
  speed = 0;

  private readonly minWallAngle = WALL_HALF_WIDTH * 1.01 + R_BALL / R_BALL_CENTER;
  private readonly gravityMag = 6.2; // responsive, weighty steel bearing feel
  private readonly linearDamp = 1.65; // smooth matte-ABS rolling resistance
  private readonly restitution = 0.24; // subtle tactile steel-on-ABS tap
  private readonly maxSpeed = 3.4;

  // Scratch vectors to avoid GC churn
  private readonly invQuat = new THREE.Quaternion();
  private readonly localGravity = new THREE.Vector3();
  private readonly gTan = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly rollAxis = new THREE.Vector3();
  private readonly rollDelta = new THREE.Quaternion();

  constructor(private maze: SphereMaze) {
    this.cleared = maze.checkpoints.map(() => false);
    this.reset();
  }

  setMaze(maze: SphereMaze) {
    this.maze = maze;
    this.cleared.length = maze.checkpoints.length;
    this.cleared.fill(false);
    this.allCleared = false;
    this.reset();
  }

  reset() {
    this.dir.copy(this.maze.startCell.centerDir).normalize();
    this.vel.set(0, 0, 0);
    this.ballQuat.identity();
    this.cleared.fill(false);
    this.allCleared = false;
    this.speed = 0;
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

  step(dt: number, sphereQuat: THREE.Quaternion, events?: PhysicsEvents) {
    const clampedDt = Math.min(dt, 0.04);
    const substeps = 8;
    const subDt = clampedDt / substeps;

    this.invQuat.copy(sphereQuat).invert();
    // World gravity points straight down in studio space (-Y)
    this.localGravity.set(0, -this.gravityMag, 0).applyQuaternion(this.invQuat);

    let maxImpact = 0;
    const solidWalls = this.maze.solidWalls;

    for (let s = 0; s < substeps; s++) {
      // Tangential component of local gravity on the unit sphere
      const gDotD = this.localGravity.dot(this.dir);
      this.gTan.copy(this.localGravity).addScaledVector(this.dir, -gDotD);

      // Integrate angular velocity with viscous rolling damping
      this.vel.addScaledVector(this.gTan, subDt);
      const damp = Math.exp(-this.linearDamp * subDt);
      this.vel.multiplyScalar(damp);

      // Keep velocity strictly tangent to unit sphere
      this.vel.addScaledVector(this.dir, -this.vel.dot(this.dir));

      const spd = this.vel.length();
      if (spd > this.maxSpeed) {
        this.vel.multiplyScalar(this.maxSpeed / spd);
      }

      // Advance position along great circle
      this.dir.addScaledVector(this.vel, subDt).normalize();
      this.vel.addScaledVector(this.dir, -this.vel.dot(this.dir));

      // Two relaxation iterations for crisp corner handling
      for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < solidWalls.length; i++) {
          const w = solidWalls[i];
          closestPointOnWall(this.dir, w, this.closest);
          const dot = Math.max(-1, Math.min(1, this.dir.dot(this.closest)));
          const ang = Math.acos(dot);

          if (ang < this.minWallAngle) {
            // Tangent vector pushing ball away from wall point
            this.normal.copy(this.dir).addScaledVector(this.closest, -dot);
            const nLen = this.normal.length();
            if (nLen > 1e-6) {
              this.normal.multiplyScalar(1 / nLen);
              const push = this.minWallAngle - ang;
              this.dir.addScaledVector(this.normal, push).normalize();

              // Re-project normal tangent to updated dir
              this.normal.addScaledVector(this.dir, -this.normal.dot(this.dir));
              if (this.normal.lengthSq() > 1e-8) {
                this.normal.normalize();
                const vn = this.vel.dot(this.normal);
                if (vn < 0) {
                  if (-vn > maxImpact) maxImpact = -vn;
                  this.vel.addScaledVector(this.normal, -(1 + this.restitution) * vn);
                  // Slight wall friction when sliding along a barrier
                  this.vel.multiplyScalar(0.996);
                }
              }
            }
          }
        }
      }
    }

    // Visual rolling rotation of the steel ball
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

    // Check checkpoint proximity
    if (!this.allCleared) {
      const triggerAngle = 0.165;
      for (let i = 0; i < this.maze.checkpoints.length; i++) {
        if (this.cleared[i]) continue;
        const cp = this.maze.checkpoints[i];
        const dot = Math.max(-1, Math.min(1, this.dir.dot(cp.dir)));
        if (Math.acos(dot) < triggerAngle) {
          this.cleared[i] = true;
          this.allCleared = this.cleared.every(Boolean);
          events?.onCheckpoint?.(i, this.allCleared);
        }
      }
    }
  }
}
