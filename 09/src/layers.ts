import { Color } from 'three';

// Two layers, nothing else: a lightly tinted, semi-transparent film (index 0) over the root
// sphere (index 1): light paper, rough, with a millimetre grid drawn in membrane.ts.

export interface Layer {
  index: number;
  name: string;
  /** Base colour, linear. */
  color: Color;
  /** 0.05 mirror gloss .. 0.9 dead matte. */
  roughness: number;
  /** 1 opaque. Below 1 a milky film: its colour is laid over what is underneath. */
  opacity: number;
  /** In the hand (film only): how far it stretches before it passes the pull on (0 none,
   *  0.3 rubbery), and how hard it clings, in particle cells of overdrawn pull. */
  elastic: number;
  adhesion: number;
  /** The sphere only: a frosted, see-through jelly instead of something solid. tint is the
   *  colour light takes on going through it, depth how far it gets (radii) before it has
   *  taken it, ior how much it bends. null for a solid sphere. */
  jelly: { tint: Color; depth: number; ior: number } | null;
  /** 0 a dielectric (film, paper), 1 a metal: its colour is then the colour of its reflections. */
  metalness: number;
  /** What is printed on the film: nothing, 'label' the protective-film text, or 'net' a
   *  labyrinth of veins like a frog's inner eyelid; and the colour of it. */
  print: 'none' | 'label' | 'net';
  ink: Color;
  /** Which recipe of FILMS (or ROOTS) it started as. Its values may have been changed since. */
  preset: number;
  /** The sphere only: it is the eye itself, right under the films (eye.ts draws it). */
  eye: boolean;
}

interface Recipe {
  name: string; color: number; roughness: number; opacity: number; elastic?: number; adhesion?: number;
  jelly?: { tint: number; depth: number; ior: number };
  eye?: boolean;
  print?: 'net';
  ink?: number;
}

/** The most films the sphere can carry at once. Each is 18 MB of atlas. */
export const FILMS_MAX = 4;

/** Finishes to try. The first of each is the default. */
export const FILMS: Recipe[] = [
  // the inner eyelid of a tree frog: pale gold, see-through, veined in red-brown
  { name: 'lid', color: 0xf0dfa6, roughness: 0.14, opacity: 0.36, elastic: 0.15, adhesion: 1.2, print: 'net', ink: 0x7c1d10 },
  { name: 'milk', color: 0xf3f2ec, roughness: 0.3, opacity: 0.72, elastic: 0.08, adhesion: 2.0 },
  { name: 'tint', color: 0x7fc8e6, roughness: 0.03, opacity: 0.42, elastic: 0.12, adhesion: 1.2 },
  { name: 'clear', color: 0xffffff, roughness: 0.03, opacity: 0.16, elastic: 0.3, adhesion: 0.6 },
  { name: 'frost', color: 0xcfe6ee, roughness: 0.6, opacity: 0.5, elastic: 0.04, adhesion: 1.4 },
  { name: 'amber', color: 0xf2a53c, roughness: 0.05, opacity: 0.5, elastic: 0.2, adhesion: 2.6 },
  { name: 'smoke', color: 0x1a1c20, roughness: 0.06, opacity: 0.8, elastic: 0.15, adhesion: 1.0 },
  { name: 'white', color: 0xf6f6f4, roughness: 0.2, opacity: 1, elastic: 0.02, adhesion: 1.6 },
];
export const ROOTS: Recipe[] = [
  { name: 'eye', color: 0xf3efe8, roughness: 0.2, opacity: 1, eye: true },
  { name: 'jelly', color: 0xffcdbd, roughness: 0.5, opacity: 1, jelly: { tint: 0xffb7a4, depth: 0.9, ior: 1.2 } },
  { name: 'kraft', color: 0xb89466, roughness: 0.88, opacity: 1 },
  { name: 'paper', color: 0xf1ede2, roughness: 0.92, opacity: 1 },
  { name: 'slate', color: 0x30343b, roughness: 0.7, opacity: 1 },
  { name: 'enamel', color: 0xf4f4f2, roughness: 0.12, opacity: 1 },
  { name: 'red', color: 0xc63f2c, roughness: 0.45, opacity: 1 },
];

export function makeLayer(index: number, variant = 0): Layer {
  const list = index === 0 ? FILMS : ROOTS;
  const r = list[variant % list.length];
  return {
    index,
    name: r.name,
    color: new Color(r.color),
    roughness: r.roughness,
    opacity: r.opacity,
    elastic: r.elastic ?? 0.1,
    adhesion: r.adhesion ?? 1,
    eye: r.eye === true,
    metalness: 0,
    print: r.print ?? 'label',
    preset: variant % list.length,
    ink: new Color(r.ink ?? 0x0a2040),
    jelly: r.jelly ? { tint: new Color(r.jelly.tint), depth: r.jelly.depth, ior: r.jelly.ior } : null,
  };
}

/** What of a film's look can be changed by hand (the layer list in ui.ts). Colours as hex. */
export interface LayerEdit {
  color?: number;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  print?: 'none' | 'label' | 'net';
  ink?: number;
}

/** A copy of `layer` with the edit applied. A new object, so whoever draws it sees it changed. */
export function editLayer(layer: Layer, e: LayerEdit): Layer {
  const color = e.color !== undefined ? new Color(e.color) : layer.color.clone();
  return {
    ...layer,
    color,
    opacity: e.opacity ?? layer.opacity,
    roughness: e.roughness ?? layer.roughness,
    metalness: e.metalness ?? layer.metalness,
    print: e.print ?? layer.print,
    ink: e.ink !== undefined ? new Color(e.ink) : layer.ink.clone(),
  };
}
