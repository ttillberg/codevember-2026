// Shared contract for day 09. Every module reads and writes this (and film.ts), nothing
// else is shared.
//
// The idea: a sphere of millimetre paper wrapped in thin films, one over the other. Tools
// cut the film on top, the pieces are peeled off by hand.
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
//   Peeling removes film for good: what has let go is painted out of cover, and the front
//   is the new edge. Nothing ever lies back down.
//
// Layers
//   world.films is a stack, films[0] on top. Each film is its own pair of atlases with its
//   own pieces. Three rules tie them together:
//     - only the film on top at a point can be cut there: a cut never goes through two;
//     - only one film is pulled at a time;
//     - film with another film over it cannot let go. A lower film peels as far as the
//       film above has been removed and no further: the edge of the film above is a hard
//       edge for it, and that is where it parts.
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
/** peel: take hold of the film and pull (with Cmd or Ctrl held: the knife on the sphere, the
 *  ruler off it; with Shift held: a scratch). knife: a cut drawn by hand. ruler: a straight cut right round, aimed as a
 *  line. scratch: a few cuts side by side, like a paw. */
export type Tool = 'peel' | 'knife' | 'ruler' | 'scratch';

export interface Piece {
  /** Its value in the id atlas, 1..65535. Changes when the film is relabelled. */
  id: number;
  /** Unit vector, roughly the middle of the piece. */
  centroid: Vector3;
  /** Fraction of the sphere this piece covers, 0..1. */
  area: number;
}

/** The line being aimed with the ruler, in CSS pixels, before it cuts. */
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
  /** The films, from the one on top down. Between 1 and FILMS_MAX (layers.ts) of them:
   *  films can be added on top and taken away while it runs, so the length of this array,
   *  of layers and of pieces changes (always together, the arrays themselves stay). */
  films: Film[];
  /** Their looks, in the same order. An entry is replaced by a new object when its look
   *  changes, never changed in place. */
  layers: Layer[];
  /** The sphere underneath them all. */
  next: Layer;
  /** The film being pulled right now (lift.layer says which of films). */
  lift: Lift;
  /** Per film, in the same order: its pieces keyed by id. Every piece with film left. */
  pieces: Array<Map<number, Piece>>;
  /** Orientation of the sphere in world space. */
  rotation: Quaternion;
  tool: Tool;
  aim: Aim;
  /** The piece a press would grab right now (peeling): which film, and its id there, 0
   *  when there is none. ok is always true today. Drawn as a debug outline of that piece. */
  hover: { layer: number; id: number; ok: boolean };
  /** Where the finger really is while it pulls: the edge point it took hold of and the point
   *  it has carried that to (unit, sphere-local; it rolls on over the back of the sphere past
   *  the silhouette), and how high it holds the film. Drawn as a cross bent round the sphere. */
  finger: { active: boolean; from: Vector3; at: Vector3; height: number };
  /** Where the pointer is, in CSS pixels, and whether anyone is there (the mouse over the
   *  page, or a finger down). The eye inside watches it. */
  look: { x: number; y: number; on: boolean };
  /** What is drawn. debug: the outline of the piece a press would grab, the finger marker
   *  and the tension lines. grid: the millimetre grid on the sphere. films: the films at all;
   *  off, the bare sphere shows and nothing can be grabbed or cut (the films are still
   *  there, only hidden). */
  show: { debug: boolean; grid: boolean; films: boolean };
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
