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
  /** The back of the film once it is lifted. */
  under: { color: Color; roughness: number };
  /** In the hand (film only): how far it stretches before it passes the pull on (0 none,
   *  0.3 rubbery), and how hard it clings, in particle cells of overdrawn pull. */
  elastic: number;
  adhesion: number;
}

interface Recipe { name: string; color: number; roughness: number; opacity: number; elastic?: number; adhesion?: number }

/** Finishes to try. The first of each is the default. */
export const FILMS: Recipe[] = [
  { name: 'milk', color: 0xf3f2ec, roughness: 0.3, opacity: 0.72, elastic: 0.08, adhesion: 2.0 },
  { name: 'tint', color: 0x7fc8e6, roughness: 0.03, opacity: 0.42, elastic: 0.12, adhesion: 1.2 },
  { name: 'clear', color: 0xffffff, roughness: 0.03, opacity: 0.16, elastic: 0.3, adhesion: 0.6 },
  { name: 'frost', color: 0xcfe6ee, roughness: 0.6, opacity: 0.5, elastic: 0.04, adhesion: 1.4 },
  { name: 'amber', color: 0xf2a53c, roughness: 0.05, opacity: 0.5, elastic: 0.2, adhesion: 2.6 },
  { name: 'smoke', color: 0x1a1c20, roughness: 0.06, opacity: 0.8, elastic: 0.15, adhesion: 1.0 },
  { name: 'white', color: 0xf6f6f4, roughness: 0.2, opacity: 1, elastic: 0.02, adhesion: 1.6 },
];
export const ROOTS: Recipe[] = [
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
    under: { color: new Color(r.color), roughness: 0.4 },
    elastic: r.elastic ?? 0.1,
    adhesion: r.adhesion ?? 1,
  };
}
