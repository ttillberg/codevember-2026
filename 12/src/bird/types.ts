import type * as THREE from 'three';

// Contract between the scene (src/main.ts, src/env/*) and the bird (src/bird/*).
//
// Space: 1 unit ≈ 10 cm. The bird's local origin is the grip point between the
// two feet, on top of the perch. Forward is +Z, up is +Y. A perched
// hummingbird is about 1.1 units from feet to crown, the tail hangs below.
// The scene puts the perch so that its top surface passes through the origin.

export interface BirdContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export interface Bird {
  /** Add this to the scene. Already placed at its perch grip point. */
  root: THREE.Object3D;
  /** dt in seconds (clamped by the caller to ≤ 1/20), t in seconds since start. */
  update(dt: number, t: number): void;
  /**
   * World-space point the bird may pay attention to (the camera, the pointer).
   * null = nothing in particular. The bird decides when and how to look.
   */
  setAttention(target: THREE.Vector3 | null): void;
  /** Something sudden happened near the bird (click, key). */
  startle(strength?: number): void;
  dispose(): void;
}
