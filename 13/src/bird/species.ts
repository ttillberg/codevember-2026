// Everything that makes this bird *this* bird lives here as data: body
// proportions, feather tracts and their looks, wing and tail formulae, and the
// tempo of its behaviour. Dial another species in by writing another object.
//
// Space: root-local, 1 unit ≈ 10 cm, +Z forward, +Y up, +X is the bird's left.

/** One cross-section of the body loft, in the sagittal (YZ) plane. */
export interface Section {
  y: number;
  z: number;
  /** axis direction in degrees: 90 = straight up, 0 = straight forward */
  a: number;
  /** half width (X) */
  w: number;
  /** dorsal and ventral radii */
  rd: number;
  rv: number;
}

export interface FeatherLook {
  /** feather width in units; length = width * aspect */
  width: number;
  aspect: number;
  /** how far one row sits from the next, as a fraction of length (smaller = more overlap) */
  rowStep: number;
  /** resting lift off the skin, degrees */
  tilt: number;
  /** how strongly the feather answers the fluff/ruffle channels */
  lift: number;
  /** transverse curl of the vane */
  cup: number;
  /** tip roundness 0 pointed … 1 round scale */
  round: number;
  /** pigment at the base and at the tip (sRGB hex) */
  base: number;
  tip: number;
  /** structural colour seen head-on, and what it shifts to at a glancing angle */
  iri: number;
  iriGraze: number;
  iriStrength: number;
  /** lobe exponent: higher = narrower flash */
  iriPower: number;
  /** 0 = platelets follow the skin, 1 = all aim along iriAim (bind space) */
  iriAlign: number;
  iriAim?: [number, number, number];
  /** per-feather tilt noise of the platelet, radians-ish */
  jitter: number;
  /** extra ruffle channel this tract listens to */
  channel?: 'gorget' | 'crown';
  /** sideways pitch between neighbours as a fraction of width (default 0.6) */
  spacing?: number;
  /**
   * 0 = a crisp closed vane (show scales) … 1 = down: barbs stand apart, the feather is
   * tousled, its outline dissolves. Drives both the geometry jitter and the shader.
   */
  loose?: number;
  /** how thickly the fuzz shells cover this tract, 0…1 (default: follows `loose`) */
  fuzz?: number;
  /** 0 = every feather shines alike, 1 = only a scattering of them do */
  sparkle?: number;
  /** more vertices for the big showy scales */
  fine?: boolean;
}

export type Region =
  /** band in loft space: s = section index range, phi = 0 (belly line) … 1 (back line) */
  | { kind: 'band'; s: [number, number]; phi: [number, number]; /** ragged edge, in s units */ soft?: number }
  /** ellipse in loft space */
  | { kind: 'blob'; at: [number, number]; r: [number, number]; /** superellipse exponent, 2 = ellipse */ pow?: number; /** 0 crisp … 1 dissolves into its surroundings */ soft?: number }
  /** capsule in loft space, radius given per axis */
  | { kind: 'streak'; from: [number, number]; to: [number, number]; r: [number, number] };

export interface Tract {
  name: string;
  look: string;
  region: Region;
}

export interface WingDef {
  shoulder: [number, number, number];
  /** bone lengths */
  upper: number;
  fore: number;
  hand: number;
  primaries: number;
  secondaries: number;
  /** primary length, innermost → outermost */
  primaryLen: [number, number];
  secondaryLen: [number, number];
  primaryWidth: number;
  secondaryWidth: number;
  /**
   * At rest the folded wing is part of the body: a raised strip of the loft, feathered with
   * its own tracts. from/to = [section, degrees round from the belly line] of the shoulder
   * and rump ends, width = half-widths at shoulder / widest point / rump end, height = bulge.
   * cross = where the free primary tips meet over the tail [fraction of tail length, x].
   */
  rest: { from: [number, number]; to: [number, number]; width: [number, number, number]; height: number; cross: [number, number] };
  color: number;
  sheen: number;
}

export interface TailDef {
  rectrices: number; // per side
  length: [number, number]; // central → outer
  width: number;
  /** direction the folded tail points, degrees below horizontal (toward -Z) */
  droop: number;
  restFan: number; // degrees per feather, folded
  maxFan: number; // degrees per feather, fully fanned
  color: number;
}

export interface BehaviourDef {
  /** breaths per second at rest / alert */
  breathHz: [number, number];
  /** fixation hold, seconds: [min, max] calm and alert */
  holdCalm: [number, number];
  holdAlert: [number, number];
  /** saccade duration = a + b * degrees */
  saccade: [number, number];
  /** neck share of a head turn: neck1, neck2 (head takes the rest) */
  neckShare: [number, number];
  blinkEvery: [number, number];
  ruffleEvery: [number, number];
  tailEvery: [number, number];
  wingEvery: [number, number];
  /** resting bill elevation in degrees */
  billUp: number;
  /** idle tongue flicks (a nectar feeder habit); default true */
  tongueFlicks?: boolean;
}

export interface Species {
  name: string;
  seed: number;
  sections: Section[];
  /** where each spine bone sits along the loft (section index) */
  /**
   * The front of the neck is one sheet of skin from the breast to the chin, not a stack of
   * neck joints: between these two sections it runs from the throat bone (the chest, turned
   * with the head) through the gular bone to the head, so a nod is shared out over its whole
   * length instead of creasing at a joint. See Loft.skin and the solver.
   */
  throat: [number, number];
  spine: { tail: number; hips: number; spine: number; chest: number; neck1: number; neck2: number; head: number };
  eye: { s: number; phi: number; radius: number; inset: number; /** iris colour (sRGB hex); left out = a near-black eye */ iris?: number; /** bare skin round the eye (sRGB hex); left out = slate with a dark outer edge */ ring?: number };
  /** how much the hind crown feathers stand up and straggle: 0 sleek, 1 (default) the hummingbird haircut */
  crest?: number;
  bill: { length: number; radius: number; droop: number; color: number };
  looks: Record<string, FeatherLook>;
  tracts: Tract[];
  skin: number;
  /** pigment value falloff over the body: flanks, underside, and low-frequency mottling */
  shading: { flank: number; under: number; patch: number; /** bronze-gold wash that comes and goes over the plain feathers */ gold: number; goldAmount: number };
  wing: WingDef;
  tail: TailDef;
  legs: { spread: number; hip: [number, number, number]; toe: number; perchRadius: number; color: number };
  behaviour: BehaviourDef;
}

const scale = { round: 1, cup: 0.5, fine: true, spacing: 0.8, fuzz: 0 };

/** Purple-throated mountain-gem, Lampornis calolaemus (male). */
export const MOUNTAIN_GEM: Species = {
  name: 'Lampornis calolaemus',
  seed: 1207,
  //            y      z      a    w      rd     rv
  sections: [
    { y: -0.07, z: -0.32, a: 60, w: 0.035, rd: 0.03, rv: 0.035 }, // 0 vent / tail root
    { y: 0.04, z: -0.245, a: 60, w: 0.15, rd: 0.105, rv: 0.13 }, // 1 rump
    { y: 0.17, z: -0.165, a: 63, w: 0.225, rd: 0.16, rv: 0.2 }, // 2 hips
    { y: 0.34, z: -0.09, a: 68, w: 0.262, rd: 0.185, rv: 0.25 }, // 3 belly
    { y: 0.52, z: -0.035, a: 76, w: 0.258, rd: 0.185, rv: 0.245 }, // 4 chest
    { y: 0.67, z: -0.005, a: 84, w: 0.236, rd: 0.185, rv: 0.212 }, // 5 shoulders
    { y: 0.775, z: 0.008, a: 80, w: 0.205, rd: 0.182, rv: 0.19 }, // 6 neck
    { y: 0.887, z: 0.052, a: 62, w: 0.15, rd: 0.17, rv: 0.17 }, // 7 head
    { y: 0.926, z: 0.116, a: 38, w: 0.117, rd: 0.14, rv: 0.14 }, // 8 crown / chin
    { y: 0.925, z: 0.195, a: 18, w: 0.066, rd: 0.09, rv: 0.07 }, // 9 forehead / face
    { y: 0.905, z: 0.245, a: 8, w: 0.03, rd: 0.032, rv: 0.028 }, // 10 bill base
  ],
  throat: [4.5, 7.3],
  spine: { tail: 0.3, hips: 1.9, spine: 3.0, chest: 4.1, neck1: 5.3, neck2: 5.95, head: 6.55 },
  eye: { s: 7.8, phi: 0.535, radius: 0.037, inset: 0.84 },
  bill: { length: 0.44, radius: 0.02, droop: 0.022, color: 0x070707 },
  skin: 0x1c1616,
  shading: { flank: 0.6, under: 0.6, patch: 0.3, gold: 0x5a5a2c, goldAmount: 0.22 },
  looks: {
    // --- soft contour feathers: fibrous, matte, a little unruly ---------------------------
    body: {
      width: 0.03, aspect: 2.1, rowStep: 0.3, tilt: 13, lift: 1, cup: 0.3, round: 0.7, loose: 0.55, fuzz: 0.3,
      base: 0x201c24, tip: 0x4f4656, iri: 0x4a8a2c, iriGraze: 0x8a6a1c, iriStrength: 0.12, iriPower: 6,
      iriAlign: 0, jitter: 0.5, sparkle: 0.6,
    },
    belly: {
      width: 0.033, aspect: 2.5, rowStep: 0.24, tilt: 11, lift: 1.2, cup: 0.25, round: 0.65, loose: 0.75,
      base: 0x28222f, tip: 0x6a5c75, iri: 0x6a8a2a, iriGraze: 0x8a6a2a, iriStrength: 0.10, iriPower: 5,
      iriAlign: 0, jitter: 0.5, sparkle: 0.6,
    },
    flank: {
      width: 0.036, aspect: 2.8, rowStep: 0.24, tilt: 12, lift: 1.3, cup: 0.2, round: 0.55, loose: 0.9,
      base: 0x231d2a, tip: 0x60546a, iri: 0x5a6a3a, iriGraze: 0x6a4a2a, iriStrength: 0.06, iriPower: 4,
      iriAlign: 0, jitter: 0.5, sparkle: 0.7,
    },
    down: {
      width: 0.04, aspect: 2.6, rowStep: 0.24, tilt: 26, lift: 1.4, cup: 0.15, round: 0.5, loose: 1,
      base: 0x1c1618, tip: 0x40353a, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, iriPower: 2,
      iriAlign: 0, jitter: 0.3,
    },
    back: {
      width: 0.03, aspect: 2.0, rowStep: 0.31, tilt: 11, lift: 0.9, cup: 0.35, round: 0.75, loose: 0.45, fuzz: 0.3,
      base: 0x1f1d26, tip: 0x4a4655, iri: 0x3a9a3a, iriGraze: 0x8a6a18, iriStrength: 0.24, iriPower: 7,
      iriAlign: 0, jitter: 0.5, sparkle: 0.45,
    },
    scapular: {
      width: 0.042, aspect: 3.3, rowStep: 0.24, tilt: 21, lift: 0.8, cup: 0.3, round: 0.6, loose: 0.6, fuzz: 0.4,
      base: 0x211e28, tip: 0x514c5c, iri: 0x3a8a3a, iriGraze: 0x8a6a18, iriStrength: 0.2, iriPower: 6,
      iriAlign: 0, jitter: 0.5, sparkle: 0.5,
    },
    collar: {
      // small rounded fans in neat staggered rows, each a comb of bright strands
      width: 0.027, aspect: 1.45, rowStep: 0.36, tilt: 12, lift: 0.8, cup: 0.35, round: 1, loose: 0.3, spacing: 0.7, fuzz: 0.12,
      base: 0x121318, tip: 0x24282c, iri: 0x1fa060, iriGraze: 0x0a5a5a, iriStrength: 0.32, iriPower: 12,
      iriAlign: 0.3, iriAim: [0, 0.1, 1], jitter: 0.55, sparkle: 0.6,
    },
    head: {
      width: 0.017, aspect: 1.8, rowStep: 0.34, tilt: 12, lift: 0.45, cup: 0.35, round: 0.9, loose: 0.4, fuzz: 0.22,
      base: 0x121217, tip: 0x2a2a33, iri: 0x1c7a50, iriGraze: 0x50501a, iriStrength: 0.28, iriPower: 7,
      iriAlign: 0, jitter: 0.45, sparkle: 0.4,
    },
    mask: {
      width: 0.012, aspect: 1.7, rowStep: 0.36, tilt: 10, lift: 0.2, cup: 0.3, round: 0.9, loose: 0.35, fuzz: 0.25,
      base: 0x040405, tip: 0x0c0c0d, iri: 0x101820, iriGraze: 0x000000, iriStrength: 0.04, iriPower: 4,
      iriAlign: 0, jitter: 0.2,
    },
    velvet: {
      // the dark face: short, soft, matte down between the gorget and the bill and eyes
      width: 0.015, aspect: 1.6, rowStep: 0.28, tilt: 6, lift: 0.15, cup: 0.2, round: 0.7, loose: 0.8, fuzz: 0.7,
      base: 0x040303, tip: 0x0f0b09, iri: 0x000000, iriGraze: 0x000000, iriStrength: 0, iriPower: 2,
      iriAlign: 0, jitter: 0.2,
    },
    stripe: {
      // white down, short and soft, lying flush with the cheek
      width: 0.012, aspect: 2.6, rowStep: 0.24, tilt: 6, lift: 0.2, cup: 0.15, round: 0.5, loose: 0.95, fuzz: 1,
      base: 0xb4b1aa, tip: 0xecebe5, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0.0, iriPower: 2,
      iriAlign: 0, jitter: 0.2,
    },
    covert: {
      width: 0.046, aspect: 2.6, rowStep: 0.33, tilt: 9, lift: 0.7, cup: 0.3, round: 0.7, loose: 0.4,
      base: 0x211d27, tip: 0x4e4658, iri: 0x3a7a50, iriGraze: 0x5a4a2a, iriStrength: 0.18, iriPower: 6,
      iriAlign: 0, jitter: 0.4, sparkle: 0.5,
    },
    undertail: {
      // pale undertail coverts: soft, off-white, lying down over the base of the tail
      width: 0.04, aspect: 2.9, rowStep: 0.26, tilt: 10, lift: 0.8, cup: 0.2, round: 0.6, loose: 0.8,
      base: 0x77706c, tip: 0xcfc8be, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, iriPower: 2,
      iriAlign: 0, jitter: 0.3,
    },
    wingCovert: {
      width: 0.03, aspect: 2.3, rowStep: 0.4, tilt: 7, lift: 0, cup: 0.3, round: 0.8, loose: 0.22, fuzz: 0,
      base: 0x17151c, tip: 0x3d3848, iri: 0x4a5a78, iriGraze: 0x5a4a3a, iriStrength: 0.06, iriPower: 6,
      iriAlign: 0, jitter: 0.4, sparkle: 0.6,
    },
    // --- show scales: crisp, closed, glossy ------------------------------------------------
    gorget: {
      ...scale, width: 0.052, aspect: 1.0, rowStep: 0.3, tilt: 8, lift: 0.5, spacing: 0.6,
      base: 0x1a0a0e, tip: 0x45171c, iri: 0x7a30ff, iriGraze: 0xc0308a, iriStrength: 2.0, iriPower: 4.2,
      iriAlign: 0.74, iriAim: [0, -0.5, 0.87], jitter: 0.34, channel: 'gorget',
    },
    crown: {
      // small, a little ragged, and uneven: a scatter of glints more than a cap
      ...scale, width: 0.019, aspect: 1.3, rowStep: 0.34, tilt: 10, lift: 0.4, fuzz: 0.45, sparkle: 0.5, loose: 0.12,
      base: 0x050b0b, tip: 0x0a1c1a, iri: 0x14e2c4, iriGraze: 0x1a58d8, iriStrength: 2.3, iriPower: 5,
      iriAlign: 0.8, iriAim: [0, -0.24, 1], jitter: 0.55, channel: 'crown',
    },
  },
  // later entries win
  tracts: [
    { name: 'belly', look: 'belly', region: { kind: 'band', s: [0, 3.7], phi: [0, 0.45], soft: 0.6 } },
    { name: 'flank', look: 'flank', region: { kind: 'band', s: [1.2, 4.2], phi: [0.3, 0.52], soft: 0.5 } },
    { name: 'back', look: 'back', region: { kind: 'band', s: [0.9, 6.2], phi: [0.55, 1] } },
    { name: 'scapular', look: 'scapular', region: { kind: 'band', s: [3.7, 5.6], phi: [0.56, 0.84], soft: 0.3 } },
    { name: 'wingPit', look: 'down', region: { kind: 'blob', at: [3.8, 0.44], r: [0.3, 0.035], soft: 0.5 } },
    { name: 'tailCoverts', look: 'covert', region: { kind: 'band', s: [0, 1.15], phi: [0, 1] } },
    { name: 'undertail', look: 'undertail', region: { kind: 'band', s: [0, 1.35], phi: [0, 0.4], soft: 0.3 } },
    { name: 'collar', look: 'collar', region: { kind: 'blob', at: [4.5, 0], r: [0.72, 0.44], soft: 0.6 } },
    { name: 'head', look: 'head', region: { kind: 'band', s: [6.0, 11], phi: [0, 1] } },
    { name: 'velvet', look: 'velvet', region: { kind: 'blob', at: [8.0, 0], r: [2.25, 0.63], pow: 3, soft: 0.2 } },
    { name: 'mask', look: 'mask', region: { kind: 'blob', at: [8.3, 0.5], r: [1.0, 0.11] } },
    { name: 'gorget', look: 'gorget', region: { kind: 'blob', at: [6.35, 0], r: [1.4, 0.27], pow: 3.0 } },
    { name: 'chin', look: 'gorget', region: { kind: 'blob', at: [7.7, 0], r: [1.05, 0.17] } },
    { name: 'crown', look: 'crown', region: { kind: 'blob', at: [8.5, 1], r: [1.3, 0.4] } },
    { name: 'postocular', look: 'stripe', region: { kind: 'streak', from: [7.5, 0.57], to: [6.3, 0.6], r: [0.12, 0.025] } },
  ],
  wing: {
    shoulder: [0.185, 0.64, -0.06],
    upper: 0.1,
    fore: 0.13,
    hand: 0.17,
    primaries: 10,
    secondaries: 6,
    primaryLen: [0.34, 0.9],
    secondaryLen: [0.27, 0.2],
    primaryWidth: 0.062,
    secondaryWidth: 0.064,
    rest: { from: [5.1, 93], to: [0.6, 147], width: [0.05, 0.105, 0.04], height: 0.034, cross: [0.8, -0.02] },
    color: 0x3b2d31,
    sheen: 0x7a6672,
  },
  tail: { rectrices: 5, length: [0.61, 0.66], width: 0.13, droop: 62, restFan: 0.35, maxFan: 11, color: 0x1d222c },
  legs: { spread: 0.075, hip: [0.085, 0.11, -0.05], toe: 0.085, perchRadius: 0.0405, color: 0x16110f },
  behaviour: {
    breathHz: [3.4, 5.2],
    holdCalm: [0.4, 1.8],
    holdAlert: [0.22, 0.9],
    saccade: [0.038, 0.00042],
    neckShare: [0.22, 0.3],
    blinkEvery: [1.8, 5.5],
    ruffleEvery: [60, 110],
    tailEvery: [3, 9],
    wingEvery: [9, 22],
    billUp: 14,
  },
};

const soft = { cup: 0.3, round: 0.75, iriAlign: 0, jitter: 0.45, sparkle: 0.25, iriPower: 4 };

/** European bee-eater, Merops apiaster. Pigment colours, a satin sheen, no structural flash. */
export const BEE_EATER: Species = {
  name: 'Merops apiaster',
  seed: 2611,
  // same spine as the mountain-gem (so the rig, legs and perch hold), a little sleeker,
  // with a deeper face for the stout bill
  //            y      z      a    w      rd     rv
  sections: [
    { y: -0.07, z: -0.32, a: 60, w: 0.035, rd: 0.03, rv: 0.035 }, // 0 vent / tail root
    { y: 0.04, z: -0.245, a: 60, w: 0.135, rd: 0.1, rv: 0.115 }, // 1 rump
    { y: 0.17, z: -0.165, a: 63, w: 0.2, rd: 0.15, rv: 0.175 }, // 2 hips
    { y: 0.34, z: -0.09, a: 68, w: 0.238, rd: 0.175, rv: 0.22 }, // 3 belly
    { y: 0.52, z: -0.035, a: 76, w: 0.24, rd: 0.18, rv: 0.225 }, // 4 chest
    { y: 0.67, z: -0.005, a: 84, w: 0.222, rd: 0.18, rv: 0.2 }, // 5 shoulders
    { y: 0.775, z: 0.008, a: 80, w: 0.19, rd: 0.172, rv: 0.18 }, // 6 neck
    { y: 0.887, z: 0.052, a: 62, w: 0.148, rd: 0.16, rv: 0.165 }, // 7 head
    { y: 0.926, z: 0.116, a: 38, w: 0.118, rd: 0.13, rv: 0.14 }, // 8 crown / chin
    { y: 0.925, z: 0.195, a: 18, w: 0.074, rd: 0.085, rv: 0.078 }, // 9 forehead / face
    { y: 0.905, z: 0.245, a: 8, w: 0.04, rd: 0.04, rv: 0.036 }, // 10 bill base
  ],
  throat: [4.5, 7.3],
  spine: { tail: 0.3, hips: 1.9, spine: 3.0, chest: 4.1, neck1: 5.3, neck2: 5.95, head: 6.55 },
  eye: { s: 7.8, phi: 0.535, radius: 0.031, inset: 0.84, iris: 0xa8160f },
  crest: 0,
  bill: { length: 0.34, radius: 0.05, droop: 0.055, color: 0x0b0b0d },
  skin: 0x1c1616,
  shading: { flank: 0.88, under: 0.85, patch: 0.14, gold: 0xd9a030, goldAmount: 0 },
  looks: {
    // breast: green-turquoise
    body: {
      ...soft, width: 0.03, aspect: 2.2, rowStep: 0.3, tilt: 10, lift: 1, loose: 0.38, fuzz: 0.3,
      base: 0x0f5a58, tip: 0x33b39a, iri: 0x7fe6cf, iriGraze: 0x4fb0d0, iriStrength: 0.07,
    },
    // belly: bluer, looser
    belly: {
      ...soft, width: 0.034, aspect: 2.5, rowStep: 0.24, tilt: 11, lift: 1.2, cup: 0.25, round: 0.65, loose: 0.75,
      base: 0x17707e, tip: 0x4bb4c2, iri: 0x9fe6ee, iriGraze: 0x5fa0d8, iriStrength: 0.06,
    },
    flank: {
      ...soft, width: 0.036, aspect: 2.8, rowStep: 0.24, tilt: 12, lift: 1.3, cup: 0.2, round: 0.55, loose: 0.9,
      base: 0x176a72, tip: 0x56b6bc, iri: 0x9fe6ee, iriGraze: 0x5fa0d8, iriStrength: 0.04,
    },
    down: {
      ...soft, width: 0.04, aspect: 2.6, rowStep: 0.24, tilt: 26, lift: 1.4, cup: 0.15, round: 0.5, loose: 1,
      base: 0x3b6f72, tip: 0x9ccfcc, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, jitter: 0.3,
    },
    // lower back and rump: golden
    gold: {
      ...soft, width: 0.032, aspect: 2.1, rowStep: 0.31, tilt: 11, lift: 0.9, cup: 0.35, loose: 0.45, fuzz: 0.3,
      base: 0xb9741c, tip: 0xf0b848, iri: 0xffe08a, iriGraze: 0xe89030, iriStrength: 0.08,
    },
    // nape and mantle: chestnut running to orange
    mantle: {
      ...soft, width: 0.03, aspect: 2.0, rowStep: 0.31, tilt: 11, lift: 0.9, cup: 0.35, loose: 0.4, fuzz: 0.3,
      base: 0x8a3410, tip: 0xd06a1c, iri: 0xffa050, iriGraze: 0xc04818, iriStrength: 0.07,
    },
    // scapulars: long, pale straw-gold, lying over the wing
    scapular: {
      ...soft, width: 0.044, aspect: 3.3, rowStep: 0.24, tilt: 19, lift: 0.8, round: 0.6, loose: 0.55, fuzz: 0.4,
      base: 0xd9982e, tip: 0xf7d680, iri: 0xfff0b8, iriGraze: 0xf0b050, iriStrength: 0.09,
    },
    // crown and neck sides: deep chestnut
    head: {
      ...soft, width: 0.017, aspect: 1.8, rowStep: 0.34, tilt: 9, lift: 0.45, cup: 0.35, round: 0.9, loose: 0.35, fuzz: 0.22,
      base: 0x6e2409, tip: 0xb24a14, iri: 0xf08a40, iriGraze: 0xa03a10, iriStrength: 0.06,
    },
    // forehead: white, going pale green toward the brow
    frons: {
      ...soft, width: 0.013, aspect: 1.8, rowStep: 0.32, tilt: 7, lift: 0.2, round: 0.8, loose: 0.6, fuzz: 0.6,
      base: 0xb9c9b4, tip: 0xf0f2e2, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, jitter: 0.2,
    },
    // the brow over the mask: pale turquoise
    stripe: {
      ...soft, width: 0.012, aspect: 2.4, rowStep: 0.26, tilt: 6, lift: 0.2, cup: 0.15, round: 0.5, loose: 0.8, fuzz: 0.8,
      base: 0x5fb4a4, tip: 0xbfe8d6, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, jitter: 0.2,
    },
    // the black line through the eye, and the black bar under the throat
    mask: {
      ...soft, width: 0.013, aspect: 1.7, rowStep: 0.34, tilt: 8, lift: 0.2, round: 0.9, loose: 0.4, fuzz: 0.35,
      base: 0x040405, tip: 0x0d0d0f, iri: 0x101820, iriGraze: 0x000000, iriStrength: 0.03, jitter: 0.2,
    },
    throat: {
      ...soft, width: 0.02, aspect: 1.8, rowStep: 0.32, tilt: 9, lift: 0.5, round: 0.85, loose: 0.45, fuzz: 0.3,
      base: 0xd29a0c, tip: 0xfbd638, iri: 0xfff0a0, iriGraze: 0xf0a020, iriStrength: 0.07,
    },
    // rump end and upper tail coverts: green
    covert: {
      ...soft, width: 0.046, aspect: 2.6, rowStep: 0.33, tilt: 9, lift: 0.7, round: 0.7, loose: 0.4,
      base: 0x1c6f58, tip: 0x49ae8c, iri: 0x9fe6c8, iriGraze: 0x50a0c0, iriStrength: 0.08,
    },
    undertail: {
      ...soft, width: 0.04, aspect: 2.9, rowStep: 0.26, tilt: 10, lift: 0.8, cup: 0.2, round: 0.6, loose: 0.8,
      base: 0x4f9ea8, tip: 0xa8dce0, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, jitter: 0.3,
    },
    // the folded wing coverts: rufous-chestnut
    wingCovert: {
      ...soft, width: 0.03, aspect: 2.3, rowStep: 0.4, tilt: 7, lift: 0, round: 0.8, loose: 0.22, fuzz: 0,
      base: 0x94400f, tip: 0xcf6c1e, iri: 0xffa860, iriGraze: 0xb85018, iriStrength: 0.07, jitter: 0.4,
    },
  },
  // later entries win
  tracts: [
    { name: 'belly', look: 'belly', region: { kind: 'band', s: [0, 3.7], phi: [0, 0.45], soft: 0.6 } },
    { name: 'flank', look: 'flank', region: { kind: 'band', s: [1.2, 4.2], phi: [0.3, 0.52], soft: 0.5 } },
    { name: 'lowerBack', look: 'gold', region: { kind: 'band', s: [0.9, 4.4], phi: [0.55, 1], soft: 0.4 } },
    { name: 'mantle', look: 'mantle', region: { kind: 'band', s: [4.1, 6.2], phi: [0.55, 1], soft: 0.5 } },
    { name: 'scapular', look: 'scapular', region: { kind: 'band', s: [3.0, 5.3], phi: [0.56, 0.84], soft: 0.3 } },
    { name: 'wingPit', look: 'down', region: { kind: 'blob', at: [3.8, 0.44], r: [0.3, 0.035], soft: 0.5 } },
    { name: 'tailCoverts', look: 'covert', region: { kind: 'band', s: [0, 1.3], phi: [0, 1], soft: 0.3 } },
    { name: 'undertail', look: 'undertail', region: { kind: 'band', s: [0, 1.35], phi: [0, 0.4], soft: 0.3 } },
    // chestnut from the crown down the nape and the sides of the neck; the breast colour runs up under it to the throat bar
    { name: 'head', look: 'head', region: { kind: 'band', s: [6.0, 11], phi: [0.5, 1], soft: 0.3 } },
    { name: 'face', look: 'head', region: { kind: 'band', s: [7.6, 11], phi: [0, 1] } },
    { name: 'frons', look: 'frons', region: { kind: 'blob', at: [10.0, 1], r: [0.6, 0.3] } },
    { name: 'brow', look: 'stripe', region: { kind: 'streak', from: [9.2, 0.64], to: [7.5, 0.64], r: [0.25, 0.022] } },
    // the black bar across the lower throat, the yellow above it up to the mask
    { name: 'throatBar', look: 'mask', region: { kind: 'band', s: [5.7, 6.5], phi: [0, 0.47] } },
    { name: 'throat', look: 'throat', region: { kind: 'blob', at: [8.2, 0], r: [1.8, 0.475], pow: 5 } },
    { name: 'mask', look: 'mask', region: { kind: 'streak', from: [9.9, 0.52], to: [7.0, 0.545], r: [0.3, 0.07] } },
  ],
  wing: {
    shoulder: [0.175, 0.64, -0.06],
    upper: 0.1,
    fore: 0.13,
    hand: 0.17,
    primaries: 10,
    secondaries: 6,
    primaryLen: [0.34, 0.98],
    secondaryLen: [0.27, 0.2],
    primaryWidth: 0.062,
    secondaryWidth: 0.064,
    rest: { from: [5.1, 93], to: [0.6, 147], width: [0.05, 0.105, 0.04], height: 0.034, cross: [0.7, -0.02] },
    color: 0x1d7f80,
    sheen: 0x7fd0c0,
  },
  // the central pair runs past the rest
  tail: { rectrices: 5, length: [1.08, 0.84], width: 0.105, droop: 62, restFan: 0.3, maxFan: 9, color: 0x226f5e },
  legs: { spread: 0.075, hip: [0.085, 0.11, -0.05], toe: 0.085, perchRadius: 0.0405, color: 0x2a221e },
  behaviour: {
    breathHz: [1.7, 2.8],
    holdCalm: [0.9, 3.2],
    holdAlert: [0.35, 1.3],
    saccade: [0.05, 0.0006],
    neckShare: [0.22, 0.3],
    blinkEvery: [2.5, 7],
    ruffleEvery: [50, 100],
    tailEvery: [5, 14],
    wingEvery: [12, 28],
    billUp: 6,
    tongueFlicks: false,
  },
};

const black = {
  ...soft, base: 0x040405, tip: 0x121216, iri: 0x30384a, iriGraze: 0x2a3440, iriStrength: 0.03, sparkle: 0.4,
};
const white = {
  ...soft, base: 0xb9b7b0, tip: 0xf6f4ee, iri: 0xffffff, iriGraze: 0xffffff, iriStrength: 0, jitter: 0.3,
};

/** Oriental magpie, Pica serica: black and white, the wings and the long tail glossed blue. */
export const MAGPIE: Species = {
  name: 'Pica serica',
  seed: 808,
  // A crow's build, not a hummingbird's: the body long and carried leaning forward, a deep
  // chest, a real neck, a small flat-crowned head. The feet stay at the origin.
  //            y      z      a    w      rd     rv
  sections: [
    { y: -0.02, z: -0.5, a: 40, w: 0.035, rd: 0.03, rv: 0.035 }, // 0 vent / tail root
    { y: 0.08, z: -0.4, a: 42, w: 0.13, rd: 0.1, rv: 0.115 }, // 1 rump
    { y: 0.2, z: -0.28, a: 46, w: 0.2, rd: 0.15, rv: 0.18 }, // 2 hips
    { y: 0.36, z: -0.14, a: 52, w: 0.245, rd: 0.18, rv: 0.23 }, // 3 belly
    { y: 0.54, z: -0.02, a: 60, w: 0.255, rd: 0.19, rv: 0.24 }, // 4 chest
    { y: 0.7, z: 0.07, a: 70, w: 0.225, rd: 0.18, rv: 0.2 }, // 5 shoulders
    { y: 0.84, z: 0.12, a: 74, w: 0.165, rd: 0.15, rv: 0.155 }, // 6 neck
    { y: 0.97, z: 0.17, a: 58, w: 0.135, rd: 0.14, rv: 0.14 }, // 7 head
    { y: 1.02, z: 0.24, a: 34, w: 0.115, rd: 0.122, rv: 0.125 }, // 8 crown / chin
    { y: 1.015, z: 0.32, a: 16, w: 0.078, rd: 0.085, rv: 0.078 }, // 9 forehead / face
    { y: 0.995, z: 0.375, a: 8, w: 0.045, rd: 0.044, rv: 0.04 }, // 10 bill base
  ],
  throat: [4.5, 7.3],
  spine: { tail: 0.3, hips: 1.9, spine: 3.0, chest: 4.1, neck1: 5.3, neck2: 5.95, head: 6.55 },
  // (a pale ring round the eye, so it does not drown in the black of the head)
  eye: { s: 7.8, phi: 0.535, radius: 0.033, inset: 0.84, ring: 0xf2f0ea },
  crest: 0,
  bill: { length: 0.29, radius: 0.054, droop: 0.024, color: 0x2e2e33 },
  skin: 0x141214,
  shading: { flank: 0.74, under: 0.66, patch: 0.2, gold: 0x6a6420, goldAmount: 0 },
  looks: {
    body: { ...black, width: 0.03, aspect: 2.2, rowStep: 0.3, tilt: 10, lift: 1, loose: 0.4, fuzz: 0.3 },
    belly: { ...white, width: 0.034, aspect: 2.5, rowStep: 0.24, tilt: 11, lift: 1.2, cup: 0.25, round: 0.65, loose: 0.75 },
    flank: { ...white, width: 0.036, aspect: 2.8, rowStep: 0.24, tilt: 12, lift: 1.3, cup: 0.2, round: 0.55, loose: 0.9 },
    scapular: { ...white, width: 0.044, aspect: 3.2, rowStep: 0.24, tilt: 17, lift: 0.8, round: 0.6, loose: 0.5, fuzz: 0.4 },
    // the lower edge of the black breast: long loose feathers hanging ragged over the white
    bib: { ...black, width: 0.034, aspect: 3.0, rowStep: 0.26, tilt: 15, lift: 1.2, round: 0.5, loose: 0.9, fuzz: 0.5 },
    back: { ...black, width: 0.03, aspect: 2.0, rowStep: 0.31, tilt: 10, lift: 0.9, cup: 0.35, loose: 0.4, fuzz: 0.3 },
    // the head a shade off black, glossed grey-blue where the light catches the crown and cheek
    head: { ...black, width: 0.018, aspect: 1.8, rowStep: 0.34, tilt: 8, lift: 0.45, cup: 0.35, round: 0.9, loose: 0.35, fuzz: 0.25, tip: 0x1f2128, iri: 0x8a98b4, iriGraze: 0x56627c, iriStrength: 0.3, iriPower: 3, sparkle: 0.2 },
    stripe: { ...black, width: 0.014, aspect: 1.8, rowStep: 0.34, tilt: 8, lift: 0.3, round: 0.9, loose: 0.35, fuzz: 0.25 },
    covert: { ...black, width: 0.046, aspect: 2.6, rowStep: 0.33, tilt: 9, lift: 0.7, round: 0.7, loose: 0.4 },
    undertail: { ...black, width: 0.04, aspect: 2.9, rowStep: 0.26, tilt: 10, lift: 0.8, cup: 0.2, round: 0.6, loose: 0.8 },
    // the folded wing: blue-black coverts with a strong blue gloss
    wingCovert: {
      ...soft, width: 0.032, aspect: 2.3, rowStep: 0.4, tilt: 7, lift: 0, round: 0.8, loose: 0.2, fuzz: 0,
      base: 0x0b111a, tip: 0x24384c, iri: 0x6f8fb0, iriGraze: 0x486684, iriStrength: 0.12, jitter: 0.4, sparkle: 0.3,
    },
  },
  // later entries win; everything not named here is black
  tracts: [
    { name: 'belly', look: 'belly', region: { kind: 'band', s: [1.15, 5.0], phi: [0, 0.42], soft: 0.3 } },
    { name: 'flank', look: 'flank', region: { kind: 'band', s: [1.4, 4.9], phi: [0.3, 0.53], soft: 0.3 } },
    // the black breast comes down over it as a bib: round, lower in the middle, its edge ragged
    { name: 'bibEdge', look: 'bib', region: { kind: 'blob', at: [6.25, 0], r: [1.8, 0.66], soft: 0.5 } },
    { name: 'bib', look: 'body', region: { kind: 'blob', at: [6.35, 0], r: [1.4, 0.62], soft: 0.25 } },
    { name: 'back', look: 'back', region: { kind: 'band', s: [0.9, 6.2], phi: [0.55, 1] } },
    { name: 'scapular', look: 'scapular', region: { kind: 'band', s: [3.3, 5.25], phi: [0.57, 0.83], soft: 0.25 } },
    { name: 'tailCoverts', look: 'covert', region: { kind: 'band', s: [0, 1.15], phi: [0, 1] } },
    { name: 'undertail', look: 'undertail', region: { kind: 'band', s: [0, 1.15], phi: [0, 0.4], soft: 0.2 } },
    { name: 'head', look: 'head', region: { kind: 'band', s: [6.0, 11], phi: [0, 1] } },
  ],
  wing: {
    shoulder: [0.17, 0.67, 0.015],
    upper: 0.1,
    fore: 0.13,
    hand: 0.17,
    primaries: 10,
    secondaries: 6,
    primaryLen: [0.34, 0.8],
    secondaryLen: [0.27, 0.2],
    primaryWidth: 0.07,
    secondaryWidth: 0.07,
    rest: { from: [5.1, 93], to: [0.6, 147], width: [0.05, 0.105, 0.04], height: 0.034, cross: [0.72, -0.02] },
    color: 0x1c2d42,
    sheen: 0x6a88a8,
  },
  // long and graduated: the central pair more than twice the outer ones
  tail: { rectrices: 5, length: [1.6, 0.72], width: 0.115, droop: 44, restFan: 0.3, maxFan: 9, color: 0x1b2a3a },
  legs: { spread: 0.075, hip: [0.085, 0.14, -0.06], toe: 0.085, perchRadius: 0.0405, color: 0x0b0b0b },
  behaviour: {
    breathHz: [1.4, 2.4],
    holdCalm: [0.7, 2.6],
    holdAlert: [0.3, 1.1],
    saccade: [0.048, 0.00055],
    neckShare: [0.22, 0.3],
    blinkEvery: [2.5, 7],
    ruffleEvery: [50, 100],
    tailEvery: [3, 9],
    wingEvery: [12, 28],
    billUp: 10,
    tongueFlicks: false,
  },
};
