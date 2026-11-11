// Shared contract for day 09. Every module reads and writes this (and film.ts), nothing
// else is shared.
//
// The idea: a sphere of millimetre paper wrapped in one thin film. Tools cut the film, the
// pieces are peeled off by hand.
//
// Spaces
//   Everything here is in SPHERE-LOCAL space: unit sphere at the origin, radius R.
//   Orbiting rotates the sphere (world.rotation), the camera never moves, so convert
//   pointer rays into local space before touching the film or pieces.
//
// Film and pieces
//   The film is a pair of atlases (film.ts): cover says where film is left, id says which
//   piece each texel belongs to. A cut paints a groove into cover. Pieces are the connected
//   regions of what is left; ids are relabelled whenever the film was cut or peeled.
//   Peeling removes film for good: letting go paints everything behind the fold out of
//   cover, and the fold line is the new edge. Nothing ever lies back down.
//
// Peeling (peel.ts simulates it, membrane.ts draws it, lift.ts is their contract)
//   The film round a grab is a lattice of particles. Each one is stuck to the sphere until
//   the film pulling on it is stretched too far, then it lets go for good. Loose particles
//   are a little elastic sheet tied to the finger. The peel front is wherever loose meets
//   stuck: it bends round the finger and hangs on the ends of cuts by itself.

import { Quaternion, Vector3 } from 'three';
import type { Layer } from './layers';
import type { Film } from './film';
import type { Lift } from './lift';

export const R = 1;

/** hand: peel from an edge, or turn the sphere. line: a straight cut through the whole
 *  sphere along a dragged line. free: draw a cut on the surface. */
export type Tool = 'hand' | 'line' | 'free';

export interface Piece {
  /** Its value in the id atlas, 1..65535. Changes when the film is relabelled. */
  id: number;
  /** Unit vector, roughly the middle of the piece. */
  centroid: Vector3;
  /** Fraction of the sphere this piece covers, 0..1. */
  area: number;
}

/** The line being aimed with the line tool, in CSS pixels, before it cuts. */
export interface Aim {
  active: boolean;
  x0: number; y0: number; x1: number; y1: number;
  /** false when the line misses the sphere. */
  valid: boolean;
}

export interface WorldEvents {
  /** Film was peeled away. */
  peeled: {};
  /** No film is left. */
  filmGone: {};
}

export type Listener<K extends keyof WorldEvents> = (e: WorldEvents[K]) => void;

export interface World {
  /** The film's look. */
  layer: Layer;
  /** The sphere underneath. */
  next: Layer;
  film: Film;
  /** The film being pulled right now. */
  lift: Lift;
  /** Keyed by id. Every piece with film left. */
  pieces: Map<number, Piece>;
  /** Orientation of the sphere in world space. */
  rotation: Quaternion;
  tool: Tool;
  aim: Aim;
  /** The piece a press would grab right now (hand tool): id 0 when there is none. ok is
   *  always true today. Drawn as a debug outline of that piece. */
  hover: { id: number; ok: boolean };
  /** Where the finger really is while it pulls: the edge point it took hold of and the point
   *  it has carried that to (unit, sphere-local; it rolls on over the back of the sphere past
   *  the silhouette), and how high it holds the film. Drawn as a cross bent round the sphere. */
  finger: { active: boolean; from: Vector3; at: Vector3; height: number };
  /** Debug: where the pull is, as line segments in sphere-local space (two points a
   *  segment, xyz) with a colour a point (rgb). Blue slack, yellow taut, red about to let
   *  go. `count` is the number of points in use this frame. */
  tension: { pos: Float32Array; col: Float32Array; count: number };
  /** Seconds. */
  time: number;
  on<K extends keyof WorldEvents>(type: K, fn: Listener<K>): void;
  emit<K extends keyof WorldEvents>(type: K, e: WorldEvents[K]): void;
}

/** Everything a module gets at creation. */
export interface Ctx {
  world: World;
  renderer: import('three').WebGLRenderer;
  scene: import('three').Scene;
  camera: import('three').PerspectiveCamera;
  canvas: HTMLCanvasElement;
}

/** What every module returns. */
export interface Module {
  update(dt: number): void;
  resize?(w: number, h: number): void;
}
