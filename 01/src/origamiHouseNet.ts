/**
 * Parametric flat-net generator for minimal architectural duplex-paper houses.
 *
 * Every generated house is a true, non-overlapping flat pre-cut paper net that folds
 * watertightly into 3D with zero glue tabs and zero scaling:
 *   - Multiple flat-net topologies:
 *       - `cross`: classic 4-arm star net around a central floor
 *       - `ribbon`: wrap-around horizontal wall strip (`left <- back -> right -> front`)
 *         that lifts off the floor and wraps 90° -> 90° -> 90° around the corners like a folding screen!
 *   - Universal 2D crease-vector hinges (`hingeAxis: V2`) supporting horizontal, vertical, and angled folds
 *   - 6 architectural roof types: `gable`, `hip`, `mansard` (with hinged skylight deck), `shed`, `flat`, `spire`
 *   - Varied footprints (`W`, `D`), heights (`H`), story counts (`1..3`), yaw, and curated matte exterior colors
 *   - Universal wall/roof local frames (`wallFrame`, `roofFrame`) for punched openings & kirigami pop-up details
 */

import {
  ALL_DOOR_STYLES,
  ALL_GABLE_PROFILES,
  ALL_WINDOW_DETAILS,
  ALL_WINDOW_OPEN_MODES,
  ALL_WINDOW_OPENINGS,
  ALL_WINDOW_STYLES,
  buildBuildingArchitecture,
  computeDoorCenterU,
  resolveFacadeForPanel,
  type BuildingArchitecture,
  type DoorPosition,
  type DoorParams,
  type DoorStyle,
  type FacadeParams,
  type FacadeRole,
  type FacadeSetParams,
  type GableProfile,
  type GrammarOverrides,
  type LevelParams,
  type NetTopology,
  type RoofParams,
  type RoofType,
  type ShapeParams,
  type WindowDetail,
  type WindowOpenMode,
  type WindowOpeningMode,
  type WindowParams,
  type WindowRowParams,
  type WindowRowRhythm,
  type WindowStyle,
} from './architecturalGrammar';

export {
  ALL_DOOR_STYLES,
  ALL_GABLE_PROFILES,
  ALL_WINDOW_DETAILS,
  ALL_WINDOW_OPEN_MODES,
  ALL_WINDOW_OPENINGS,
  ALL_WINDOW_STYLES,
  buildBuildingArchitecture,
  computeDoorCenterU,
  resolveFacadeForPanel,
  type BuildingArchitecture,
  type DoorPosition,
  type DoorParams,
  type DoorStyle,
  type FacadeParams,
  type FacadeRole,
  type FacadeSetParams,
  type GableProfile,
  type GrammarOverrides,
  type LevelParams,
  type NetTopology,
  type RoofParams,
  type RoofType,
  type ShapeParams,
  type WindowDetail,
  type WindowOpenMode,
  type WindowOpeningMode,
  type WindowParams,
  type WindowRowParams,
  type WindowRowRhythm,
  type WindowStyle,
};

export type V2 = [number, number];

export const MM = 0.1; // 1 mm = 0.1 Three.js world units

export type PanelId = string;
export type FoldablePanelId = string;

export interface WallLocalFrame {
  /** Bottom-center of wall along floor edge in sheet mm */
  origin: V2;
  /** Unit vector running horizontally along wall width in sheet mm */
  uAxis: V2;
  /** Unit vector pointing UP the wall from floor to eave in sheet mm */
  vAxis: V2;
  widthMm: number;
  heightMm: number;
  /** Optional story-count override for multi-tier setback or lower side-wing walls */
  wallLevels?: 1 | 2 | 3;
}

export interface RoofLocalFrame {
  /** Midpoint of eave hinge crease in sheet mm */
  origin: V2;
  /** Unit vector along eave/ridge in sheet mm */
  ridgeAxis: V2;
  /** Unit vector pointing UP the roof slope from eave toward ridge in sheet mm */
  slopeAxis: V2;
  widthMm: number;
  slantMm: number;
}

export interface VillageConfig {
  /** Number of buildings in the single-cutout compound (2, 3, or 4) */
  count: 2 | 3 | 4;
  /** Deterministic seed driving building roofs, sizes, details & bridges (`0` = curated default preset) */
  seed: number;
  /** Optional explicit roof override for the main house (`b0`) */
  mainRoof?: RoofType;
  /** Compound-level architectural consistency (`0..1`) controlling how tightly buildings match */
  consistency?: number;
  /** Shared recursive grammar overrides propagated to every building in the compound */
  grammar?: GrammarOverrides;
}

export interface HouseMixOptions extends GrammarOverrides {
  /** Force a curated preset slot (`1..14`) */
  slot?: number | null;
  /** Force exact building count (`1` single building, or `2`/`3`/`4` single-cutout village!) */
  houses?: 1 | 2 | 3 | 4 | null;
  /** Force a specific unfolding net topology */
  topology?: NetTopology | null;
  /** Force a specific roof archetype */
  roofType?: RoofType | null;
  /** Extra remix seed offset (0 = curated sequence, >0 = deterministic seeded sequence!) */
  seed?: number;
}

export interface HouseNetSpec {
  generation: number;
  label: string;
  /** Unfolding net topology */
  topology: NetTopology;
  /** Optional parametric multi-house village configuration (for `topology === 'village'`) */
  village?: VillageConfig;
  /** Architectural consistency dial (`0..1`) driving facade, level, window-row & village coherence */
  consistency?: number;
  /** Full recursive compositional architectural grammar tree owned by this building */
  architecture?: BuildingArchitecture;
  /** Footprint width (X, mm) and depth (Y/Z, mm) */
  W: number;
  D: number;
  /** Wall height at low eave (mm) */
  H: number;
  /** Number of window stories (1..3) */
  levels: 1 | 2 | 3;
  /** Roof architecture */
  roofType: RoofType;
  /** Ceiling cross-section profile for gable roofs (`classic`, `gambrel` 2×, `stepped` 3× ladder, `barrel` 3×, `saltbox`) */
  gableProfile?: GableProfile;
  /** Roof slope angle above horizontal (radians) */
  pitch: number;
  /** Mansard top deck ratio (0 for non-mansard) */
  mansardRatio: number;
  /** Parapet lip height above deck on flat roofs (mm) */
  parapetH: number;
  /** Ground-level and upper-story window styles */
  windowGround: WindowStyle;
  windowUpper: WindowStyle;
  door: DoorStyle;
  /** Punched attic circular oculus in gable ends */
  hasOculus: boolean;
  /** Punched belfry louver slots near top of spire towers */
  hasBelfry: boolean;
  /** Fold-out kirigami canopy awning over front door */
  hasAwning: boolean;
  /** Fold-out kirigami chimney tab on roof */
  hasChimney: boolean;
  /** Fold-out kirigami roof dormers (0, 1, or 2) */
  dormerCount: 0 | 1 | 2;
  /** Subtle orientation rotation (radians around Y) so consecutive projected layers cross dynamically! */
  yawOffset: number;
  /** Curated matte architectural duplex-paper exterior color (hex) for walls, roof & details */
  outsideColor: string;
  /** Internal flag: mirror a `ribbon` net across X (`front <- left <- back -> right`) for flush wall-to-wall packing */
  mirrorRibbon?: boolean;
}

/**
 * Curated matte Japanese/Nordic pastel architectural paper palette (Takeo / Colorplan cotton stock):
 * Powder blue -> Dusty rose -> Sage celadon -> Butter ochre -> Misty lilac -> Apricot peach -> Seafoam -> Dove stone
 */
export const ARCHITECTURAL_PAPER_PALETTE: readonly string[] = [
  '#9bb7cc', // 1. Powder blue
  '#d8a49c', // 2. Dusty rose
  '#9bb69f', // 3. Sage celadon
  '#dcc08a', // 4. Butter ochre
  '#baa6c4', // 5. Misty lilac
  '#dbb094', // 6. Apricot peach
  '#93b8b4', // 7. Seafoam slate
  '#bbb4a7', // 8. Dove stone
];

export interface PanelNetDef {
  id: PanelId;
  parent: PanelId | null;
  /** Counter-clockwise polygon in sheet space (mm, center at (0,0), +y = world -Z, -y = world +Z) */
  poly: V2[];
  /** Hinge origin point in sheet space (mm) */
  hingeOrigin: V2;
  /** Hinge crease endpoints in sheet space (mm) */
  crease: [V2, V2] | null;
  /**
   * Unit 2D crease direction `(ax, ay)` in sheet space; maps to flat 3D rotation axis `(ax, 0, -ay)`.
   * Rotating right-hand-rule by `+targetAngle` around `(ax, 0, -ay)` folds the panel into 3D!
   */
  hingeAxis: V2;
  /** Target fold angle in radians (positive magnitude around `hingeAxis`) */
  targetAngle: number;
  /** Stage group for choreographed wave & scrub ordering */
  stage: 'base' | 'wall' | 'terrace' | 'upperWall' | 'roof' | 'cap';
  /** Marks outward/reverse mountain creases (setback upper tier, L-wing inside corner, sawtooth pleats) */
  isMountain?: boolean;
  /** Marks steep sawtooth north-light clerestory slopes that receive punched skylight bays */
  hasRoofSkylights?: boolean;
  /** Wall local 2D frame in sheet space for universal window/door/awning placement */
  wallFrame?: WallLocalFrame;
  /** Roof local 2D frame in sheet space for universal chimney/dormer placement */
  roofFrame?: RoofLocalFrame;
  /** Marks the primary entrance wall (receives doorway / arcade / awning) */
  isFront?: boolean;
  /** Marks a triangular gable-end wall (eligible for attic circular oculus) */
  isGableEnd?: boolean;
  /** Suppresses window/door/awning cutouts on shared interior walls pressed flush against a neighboring volume */
  skipOpenings?: boolean;
  /** Building index within a multi-house `village` compound (`0 = main house`, `1..3 = annexes/towers`) */
  islandIndex?: number;
  /** Exterior pastel swatch slot (`0..3`) so multi-house villages harmonize across complementary tones */
  colorSlot?: 0 | 1 | 2 | 3;
  /** Optional per-building spec & roof rise for compound villages so each house gets its own windows/details */
  panelSpec?: HouseNetSpec;
  panelRoofRise?: number;
  /** Original local panel id before village prefixing (`front`, `back`, `left`, `right`, `roofL`, `roofR`, `roofCap`, ...) */
  localId?: string;
  label: string;
}

export interface BuiltHouseNet {
  spec: HouseNetSpec;
  /** Roof vertical rise above low eave H (mm) */
  roofRise: number;
  /** Roof slope slant length (mm) */
  roofSlant: number;
  /** Unfolded flat net bounding box in sheet space (mm) */
  flatBounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Half-extent of the square paper sheet that fits this flat net (mm; >= 75 mm -> 150 mm baseline, larger for big houses!) */
  sheetHalfMm: number;
  /** Folded 3D total height from floor to roof peak/parapet (mm) */
  foldedHeightMm: number;
  /** Folded 3D horizontal footprint radius (mm) */
  foldedRadiusMm: number;
  /** Ordered panels (parents always precede children!) */
  panels: PanelNetDef[];
  panelMap: Map<PanelId, PanelNetDef>;
  foldableIds: FoldablePanelId[];
}

export function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a * 0.5;
}

function ensureCCW(poly: V2[]): V2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

// Fast deterministic PRNG (Mulberry32)
function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a: number, b: number) => a + (b - a) * next(),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}

export interface ModelPresetInfo {
  slot: number;
  label: string;
}

export const MODEL_PRESETS: readonly ModelPresetInfo[] = [
  { slot: 1, label: 'Gable cottage' },
  { slot: 2, label: 'Grand mansard' },
  { slot: 3, label: 'Octagonal lighthouse' },
  { slot: 4, label: 'Stepped tower' },
  { slot: 5, label: 'L-wing villa' },
  { slot: 6, label: 'Sawtooth atelier' },
  { slot: 7, label: 'Hexagonal pavilion' },
  { slot: 8, label: 'Butterfly pavilion' },
  { slot: 9, label: 'Stepped pagoda' },
  { slot: 10, label: 'Composite manor' },
  { slot: 11, label: 'Grand hip hall' },
  { slot: 12, label: 'Modernist tower' },
  { slot: 13, label: 'Studio loft' },
  { slot: 14, label: 'Composite estate' },
];

/**
 * Deterministic Fisher-Yates permutation of slots `1..count` for a given seed & cycle index.
 * Seed `0` preserves the curated canonical sequence `[1, 2, ..., count]`.
 */
function resolveArchetypeSlot(generation: number, seed: number, presetCount: number): number {
  const g = Math.max(1, Math.floor(generation));
  const idx = (g - 1) % presetCount;
  if (seed <= 0) return idx + 1;
  const cycle = Math.floor((g - 1) / presetCount);
  const deck = Array.from({ length: presetCount }, (_, i) => i + 1);
  const deckRng = makeRng(((seed >>> 0) * 2654435761 + (cycle + 1) * 1013904223) >>> 0);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(deckRng.next() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck[idx];
}

/**
 * Generate a distinct architectural duplex-paper house spec for each recursive layer!
 * Accepts either a numeric `forcedSlot` (`1..14`) or a full `HouseMixOptions` object for live mix-and-match.
 * When `seed > 0` (and no explicit `slot` lock is active), the entire generational sequence is
 * deterministically re-seeded with a permuted archetype deck and fresh architectural proportions.
 */
export function generateHouseSpec(
  generation: number,
  optOrSlot?: number | null | HouseMixOptions,
): HouseNetSpec {
  const opts: HouseMixOptions =
    typeof optOrSlot === 'number'
      ? { slot: optOrSlot }
      : optOrSlot && typeof optOrSlot === 'object'
        ? optOrSlot
        : {};

  const raw = generateRawHouseSpec(generation, opts);
  const extraSeed = Math.max(0, Math.floor(opts.seed ?? 0));
  const hasGrammarOverride = Boolean(
    opts.gableProfile ||
      opts.windowStyle ||
      opts.windowOpening ||
      opts.windowDetail ||
      opts.windowCount ||
      opts.doorStyle ||
      opts.levels ||
      (opts.heightScale !== undefined && opts.heightScale !== null) ||
      (opts.consistency !== undefined && opts.consistency !== null),
  );

  // Layer 1 curated cottage stays strictly classical unless consistency or overrides are active
  const isPureCuratedLayer1 =
    !hasGrammarOverride &&
    extraSeed === 0 &&
    !opts.houses &&
    !opts.topology &&
    !opts.roofType &&
    ((generation <= 1 && !opts.slot) || opts.slot === 1);

  const consistency =
    opts.consistency !== undefined && opts.consistency !== null
      ? Math.max(0, Math.min(1, opts.consistency))
      : isPureCuratedLayer1
        ? 1.0
        : 0.72;

  const grammar: GrammarOverrides = {
    consistency,
    gableProfile: opts.gableProfile ?? null,
    windowStyle: opts.windowStyle ?? null,
    windowOpening: opts.windowOpening ?? null,
    windowDetail: opts.windowDetail ?? null,
    windowCount: opts.windowCount ?? null,
    doorStyle: opts.doorStyle ?? null,
    levels: opts.levels ?? null,
    heightScale: opts.heightScale ?? null,
  };

  if (raw.topology === 'village') {
    const villageSpec: HouseNetSpec = {
      ...raw,
      consistency,
      village: {
        count: raw.village?.count ?? 3,
        seed: raw.village?.seed ?? 0,
        mainRoof: raw.village?.mainRoof,
        consistency,
        grammar,
      },
    };
    return villageSpec;
  }

  // Apply explicit compositional overrides cleanly to single buildings
  const heightMult =
    opts.heightScale !== undefined && opts.heightScale !== null
      ? Math.max(0.72, Math.min(1.35, opts.heightScale))
      : 1.0;
  const H = raw.H * heightMult;
  const levels: 1 | 2 | 3 = opts.levels ?? raw.levels;
  const windowGround: WindowStyle = opts.windowStyle ?? raw.windowGround;
  const windowUpper: WindowStyle = opts.windowStyle ?? raw.windowUpper;
  const door: DoorStyle = opts.doorStyle ?? raw.door;
  const hasAwning = door === 'none' || door === 'arcade' ? false : raw.hasAwning;

  const grammarSeed = (generation * 7919 + extraSeed * 104729 + Math.round(raw.W * 31) + Math.round(H * 17)) >>> 0;
  const gableProfile: GableProfile =
    raw.roofType === 'gable' ? (opts.gableProfile ?? raw.gableProfile ?? 'classic') : 'classic';
  const architecture = buildBuildingArchitecture({
    topology: raw.topology,
    widthMm: raw.W,
    depthMm: raw.D,
    heightMm: H,
    levels,
    yawOffset: raw.yawOffset,
    roofType: raw.roofType,
    gableProfile,
    pitch: raw.pitch,
    mansardRatio: raw.mansardRatio,
    parapetH: raw.parapetH,
    windowGround,
    windowUpper,
    door,
    hasOculus: raw.hasOculus,
    hasBelfry: raw.hasBelfry,
    hasAwning,
    hasChimney: gableProfile === 'stepped' ? false : raw.hasChimney,
    dormerCount: gableProfile === 'stepped' || gableProfile === 'barrel' ? 0 : raw.dormerCount,
    seed: grammarSeed,
    consistency,
    windowCount: opts.windowCount ?? 'auto',
    windowOpening: opts.windowOpening ?? null,
    windowDetail: opts.windowDetail ?? null,
    keepMinimalDetails: isPureCuratedLayer1,
  });

  return {
    ...raw,
    H,
    levels,
    gableProfile,
    windowGround,
    windowUpper,
    door,
    hasAwning,
    hasChimney: gableProfile === 'stepped' ? false : raw.hasChimney,
    dormerCount: gableProfile === 'stepped' || gableProfile === 'barrel' ? 0 : raw.dormerCount,
    consistency,
    architecture,
  };
}

function generateRawHouseSpec(
  generation: number,
  opts: HouseMixOptions,
): HouseNetSpec {
  const presetCount = MODEL_PRESETS.length;
  const effectiveSlot = opts.slot && opts.slot >= 1 && opts.slot <= presetCount ? opts.slot : null;
  const extraSeed = Math.max(0, Math.floor(opts.seed ?? 0));
  const hasExplicitMix = Boolean(
    opts.houses ||
      opts.topology ||
      opts.roofType ||
      opts.gableProfile ||
      opts.windowStyle ||
      opts.windowOpening ||
      opts.windowDetail ||
      opts.windowCount ||
      opts.doorStyle ||
      opts.levels ||
      (opts.heightScale !== undefined && opts.heightScale !== null) ||
      (opts.consistency !== undefined && opts.consistency !== null),
  );
  const hasCustomMix = hasExplicitMix || extraSeed > 0;
  const mod14 = effectiveSlot ?? resolveArchetypeSlot(generation, extraSeed, presetCount);
  const colorIdx = effectiveSlot
    ? (effectiveSlot - 1 + Math.max(0, generation - 1) + extraSeed) % ARCHITECTURAL_PAPER_PALETTE.length
    : (Math.max(1, generation) - 1 + extraSeed * 3 + (extraSeed > 0 ? mod14 : 0)) % ARCHITECTURAL_PAPER_PALETTE.length;
  const outsideColor = ARCHITECTURAL_PAPER_PALETTE[colorIdx];

  // Layer 1 (or forced slot 1 with no mix/seed overrides): iconic balanced silver-ratio gabled house on classic cross net!
  if (!hasCustomMix && ((generation <= 1 && !effectiveSlot) || effectiveSlot === 1)) {
    const W = 42;
    const D = W * Math.SQRT2;
    const H = 24.301515;
    return {
      generation,
      label: 'Gable cottage',
      topology: 'cross',
      W,
      D,
      H,
      levels: 1,
      roofType: 'gable',
      pitch: Math.PI / 4,
      mansardRatio: 0,
      parapetH: 0,
      windowGround: 'rect',
      windowUpper: 'rect',
      door: 'arched',
      hasOculus: true,
      hasBelfry: false,
      hasAwning: false,
      hasChimney: false,
      dormerCount: 0,
      yawOffset: 0,
      outsideColor,
    };
  }

  const seedGen = (effectiveSlot ? effectiveSlot + (generation - 1) * presetCount : generation) + extraSeed * 997;
  const rng = makeRng((seedGen * 7919 + extraSeed * 104729 + 202611) >>> 0);
  const yawChoices = [-0.42, 0.24, Math.PI * 0.5, -0.22, 0.44, -0.18, 0.52, -Math.PI * 0.5, 0.32];
  const yawOffset =
    (effectiveSlot || hasExplicitMix) && generation <= 1
      ? 0
      : yawChoices[Math.abs(seedGen - 2) % yawChoices.length] + rng.range(-0.08, 0.08);

  const scalePreset =
    hasCustomMix
      ? rng.range(1.04, 1.32)
      : mod14 === 2
        ? 1.38
        : mod14 === 3
          ? 1.26
          : mod14 === 4
            ? 1.24
            : mod14 === 5
              ? 1.18
              : mod14 === 6
                ? 1.26
                : mod14 === 7
                  ? 1.24
                  : mod14 === 8
                    ? 1.22
                    : mod14 === 9
                      ? 1.20
                      : mod14 === 10
                        ? 1.08
                        : mod14 === 11
                          ? 1.36
                          : mod14 === 12
                            ? 1.32
                            : mod14 === 13
                              ? 1.12
                              : mod14 === 14
                                ? 1.05
                                : rng.pick([0.98, 1.18, 1.34, 1.46]);

  // Resolve target topology cleanly from mix overrides OR natural/seeded layer cycle
  const wantMultiHouse =
    (opts.houses !== undefined && opts.houses !== null && opts.houses >= 2) ||
    opts.topology === 'village';

  const isVillageLayer =
    wantMultiHouse ||
    (!opts.topology && opts.houses !== 1 && (mod14 === 10 || mod14 === 14));
  const isSetbackLayer =
    !isVillageLayer &&
    (opts.topology === 'setback' || (!opts.topology && (mod14 === 4 || mod14 === 9)));
  const isLWingLayer =
    !isVillageLayer &&
    (opts.topology === 'lwing' || (!opts.topology && mod14 === 5));
  const isOctLayer =
    !isVillageLayer &&
    (opts.topology === 'oct' || (!opts.topology && mod14 === 3));
  const isHexLayer =
    !isVillageLayer &&
    (opts.topology === 'hex' || (!opts.topology && mod14 === 7));

  if (isVillageLayer) {
    const isCuratedArchipelago = !wantMultiHouse && extraSeed === 0 && generation <= presetCount && mod14 === 14;
    const isCuratedEstate = !wantMultiHouse && extraSeed === 0 && generation <= presetCount && mod14 === 10;
    const count: 2 | 3 | 4 =
      opts.houses && opts.houses >= 2
        ? (opts.houses as 2 | 3 | 4)
        : isCuratedArchipelago
          ? 4
          : isCuratedEstate
            ? 3
            : rng.pick([2, 3, 4] as const);
    const villageSeed =
      isCuratedEstate || isCuratedArchipelago
        ? 0
        : Math.max(1, ((seedGen * 97 + extraSeed * 313 + count * 13) & 0x7fffffff));
    const villageMainRoofs: RoofType[] = ['gable', 'mansard', 'spire', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
    const mainRoof =
      opts.roofType ??
      (isCuratedArchipelago
        ? 'gable'
        : isCuratedEstate
          ? 'mansard'
          : rng.pick(villageMainRoofs));
    const label = isCuratedArchipelago
      ? 'Composite estate'
      : isCuratedEstate
        ? 'Composite manor'
        : count === 2
          ? 'Twin composite house'
          : count === 3
            ? 'Composite row house'
            : 'Composite estate';
    return {
      generation,
      label,
      topology: 'village',
      village: { count, seed: villageSeed, mainRoof },
      W: 32,
      D: 34,
      H: 22,
      levels: 2,
      roofType: mainRoof ?? 'gable',
      pitch: 0.78,
      mansardRatio: mainRoof === 'mansard' ? 0.48 : 0,
      parapetH: 0,
      windowGround: 'arched',
      windowUpper: 'rect',
      door: 'arched',
      hasOculus: true,
      hasBelfry: false,
      hasAwning: true,
      hasChimney: true,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  const preferCrowned = (r?: RoofType | null): boolean | null => {
    if (!r) return null;
    if (r === 'spire' || r === 'gable' || r === 'hip') return false;
    return true;
  };

  const seededWinPool: WindowStyle[] =
    extraSeed > 0 || (opts.consistency !== undefined && opts.consistency !== null && opts.consistency < 0.7)
      ? ['rect', 'tall', 'arched', 'pair', 'ribbon', 'round', 'lancet', 'slit']
      : ['rect', 'tall', 'arched', 'pair', 'ribbon'];
  const seededDoorPool: DoorStyle[] = ['arched', 'rect', 'double', 'arcade'];

  if (isSetbackLayer) {
    const crownedOverride = preferCrowned(opts.roofType);
    const isCrownedPagoda = crownedOverride !== null ? crownedOverride : mod14 === 9;
    const span = (extraSeed > 0 ? rng.range(38, 52) : rng.range(42, 48)) * Math.min(1.26, scalePreset);
    const H =
      (extraSeed > 0
        ? isCrownedPagoda
          ? rng.range(34, 52)
          : rng.range(40, 60)
        : isCrownedPagoda
          ? rng.range(40, 46)
          : rng.range(46, 54)) * Math.min(1.24, scalePreset);
    const levels: 1 | 2 | 3 = extraSeed > 0 && H >= 56 ? 3 : 2;
    return {
      generation,
      label: isCrownedPagoda ? 'Stepped pagoda' : 'Stepped tower',
      topology: 'setback',
      W: span,
      D: span,
      H,
      levels,
      roofType: isCrownedPagoda ? 'mansard' : 'spire',
      pitch: isCrownedPagoda ? rng.range(0.76, 1.08) : rng.range(0.98, 1.26),
      mansardRatio: isCrownedPagoda ? (extraSeed > 0 ? rng.range(0.34, 0.54) : 0.44) : 0,
      parapetH: 0,
      windowGround: extraSeed > 0 ? rng.pick(seededWinPool) : 'arched',
      windowUpper: extraSeed > 0 ? rng.pick(seededWinPool) : 'tall',
      door: extraSeed > 0 ? rng.pick(seededDoorPool) : 'arched',
      hasOculus: false,
      hasBelfry: extraSeed > 0 ? !isCrownedPagoda && rng.chance(0.7) : !isCrownedPagoda,
      hasAwning: extraSeed > 0 ? rng.chance(0.4) : false,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (isLWingLayer) {
    const W = (extraSeed > 0 ? rng.range(34, 48) : rng.range(38, 44)) * Math.min(1.24, scalePreset);
    const D = (extraSeed > 0 ? rng.range(46, 62) : rng.range(52, 58)) * Math.min(1.24, scalePreset);
    const H = (extraSeed > 0 ? rng.range(22, 38) : rng.range(26, 32)) * Math.min(1.24, scalePreset);
    return {
      generation,
      label: 'L-wing villa',
      topology: 'lwing',
      W,
      D,
      H,
      levels: H >= 34 ? 2 : 1,
      roofType: 'gable',
      pitch: extraSeed > 0 ? rng.range(0.56, 0.96) : rng.range(0.68, 0.86),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: extraSeed > 0 ? rng.pick(seededWinPool) : rng.pick(['arched', 'rect']),
      windowUpper: extraSeed > 0 ? rng.pick(seededWinPool) : rng.pick(['rect', 'pair']),
      door: extraSeed > 0 ? rng.pick(seededDoorPool) : 'arched',
      hasOculus: extraSeed > 0 ? rng.chance(0.75) : true,
      hasBelfry: false,
      hasAwning: extraSeed > 0 ? rng.chance(0.65) : true,
      hasChimney: extraSeed > 0 ? rng.chance(0.75) : true,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (isOctLayer) {
    const crownedOverride = preferCrowned(opts.roofType);
    const isCrownedRotunda =
      crownedOverride !== null ? crownedOverride : (extraSeed > 0 || generation > 3) && rng.chance(0.45);
    const span = (extraSeed > 0 ? rng.range(32, 46) : rng.range(36, 42)) * Math.min(1.3, scalePreset);
    const H =
      (extraSeed > 0
        ? isCrownedRotunda
          ? rng.range(24, 40)
          : rng.range(36, 56)
        : isCrownedRotunda
          ? rng.range(28, 34)
          : rng.range(44, 52)) * Math.min(1.26, scalePreset);
    return {
      generation,
      label: isCrownedRotunda ? 'Octagonal rotunda' : 'Octagonal lighthouse',
      topology: 'oct',
      W: span,
      D: span,
      H,
      levels: H >= 44 ? 3 : H >= 28 ? 2 : 1,
      roofType: isCrownedRotunda ? 'mansard' : 'spire',
      pitch: isCrownedRotunda ? rng.range(0.68, 1.02) : rng.range(0.96, 1.24),
      mansardRatio: isCrownedRotunda ? (extraSeed > 0 ? rng.range(0.32, 0.50) : 0.42) : 0,
      parapetH: 0,
      windowGround: extraSeed > 0 ? rng.pick(seededWinPool) : 'arched',
      windowUpper: extraSeed > 0 ? rng.pick(seededWinPool) : 'tall',
      door: extraSeed > 0 ? rng.pick(['arched', 'rect', 'double'] as const) : 'arched',
      hasOculus: false,
      hasBelfry: extraSeed > 0 ? !isCrownedRotunda && rng.chance(0.65) : !isCrownedRotunda,
      hasAwning: extraSeed > 0 ? rng.chance(0.35) : false,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (isHexLayer) {
    const crownedOverride = preferCrowned(opts.roofType);
    const isPointedPagoda =
      crownedOverride !== null ? !crownedOverride : (extraSeed > 0 || generation > 7) && rng.chance(0.45);
    const span = (extraSeed > 0 ? rng.range(36, 50) : rng.range(42, 48)) * Math.min(1.32, scalePreset);
    const H = (extraSeed > 0 ? rng.range(20, 42) : rng.range(24, 30)) * Math.min(1.28, scalePreset);
    return {
      generation,
      label: isPointedPagoda ? 'Hexagonal spire' : 'Hexagonal pavilion',
      topology: 'hex',
      W: span,
      D: span,
      H,
      levels: H >= 44 ? 3 : H >= 31 ? 2 : 1,
      roofType: isPointedPagoda ? 'spire' : 'mansard',
      pitch: isPointedPagoda ? rng.range(0.84, 1.16) : rng.range(0.62, 0.96),
      mansardRatio: isPointedPagoda ? 0 : extraSeed > 0 ? rng.range(0.32, 0.50) : 0.40,
      parapetH: 0,
      windowGround: extraSeed > 0 ? rng.pick(seededWinPool) : rng.pick(['arched', 'tall']),
      windowUpper: extraSeed > 0 ? rng.pick(seededWinPool) : 'rect',
      door: extraSeed > 0 ? rng.pick(['arched', 'rect', 'double'] as const) : 'arched',
      hasOculus: false,
      hasBelfry: extraSeed > 0 ? isPointedPagoda && H >= 36 && rng.chance(0.5) : false,
      hasAwning: extraSeed > 0 ? rng.chance(0.55) : !isPointedPagoda,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  // Rectangular layers cycle cleanly across all 8 roof archetypes & mix `ribbon` + `cross` nets!
  const rectByMod14: Record<number, RoofType> = {
    1: 'gable',
    2: 'mansard',
    6: 'sawtooth',
    8: 'butterfly',
    11: 'hip',
    12: 'flat',
    13: 'shed',
  };
  const allRoofs: RoofType[] = ['gable', 'mansard', 'spire', 'hip', 'shed', 'flat', 'butterfly', 'sawtooth'];
  const roofType: RoofType =
    opts.roofType ??
    (hasCustomMix && !effectiveSlot
      ? rng.pick(allRoofs)
      : generation > presetCount && mod14 === 1
        ? 'spire'
        : (rectByMod14[mod14] ?? 'gable'));

  const topology: NetTopology =
    opts.topology === 'cross' || opts.topology === 'ribbon'
      ? opts.topology
      : mod14 === 2 || mod14 === 8 || mod14 === 11 || mod14 === 13
        ? 'ribbon'
        : mod14 === 6 || mod14 === 12
          ? 'cross'
          : rng.chance(0.55)
            ? 'ribbon'
            : 'cross';

  const winPool: WindowStyle[] =
    extraSeed > 0 || (opts.consistency !== undefined && opts.consistency !== null && opts.consistency < 0.7)
      ? ['rect', 'tall', 'arched', 'pair', 'ribbon', 'round', 'lancet', 'slit']
      : ['rect', 'tall', 'arched', 'pair', 'ribbon'];
  const doorPool: DoorStyle[] = ['arched', 'rect', 'double', 'arcade'];

  if (roofType === 'spire') {
    const span = rng.range(30, 34) * Math.min(1.32, scalePreset);
    const H = rng.range(44, 50) * Math.min(1.32, scalePreset);
    return {
      generation,
      label: scalePreset >= 1.2 ? 'Cathedral spire' : 'Bell tower',
      topology,
      W: span,
      D: span,
      H,
      levels: 3,
      roofType: 'spire',
      pitch: rng.range(1.16, 1.25),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: 'arched',
      windowUpper: 'tall',
      door: 'arched',
      hasOculus: false,
      hasBelfry: true,
      hasAwning: false,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'mansard') {
    const W = rng.range(42, 46) * scalePreset;
    const D = rng.range(52, 58) * scalePreset;
    const H = rng.range(28, 33) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 46 ? 3 : 2;
    return {
      generation,
      label: scalePreset >= 1.28 ? 'Grand mansard' : 'Mansard pavilion',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'mansard',
      pitch: rng.range(1.06, 1.18),
      mansardRatio: 0.52,
      parapetH: 0,
      windowGround: rng.pick(['arched', 'tall']),
      windowUpper: rng.pick(['tall', 'pair']),
      door: rng.pick(['arched', 'double']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: true,
      hasChimney: true,
      dormerCount: D >= 52 ? 2 : 1,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'hip') {
    const W = rng.range(40, 46) * scalePreset;
    const D = rng.range(50, 58) * scalePreset;
    const H = rng.range(24, 29) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 44 ? 3 : H >= 30 ? 2 : 1;
    return {
      generation,
      label: scalePreset >= 1.3 ? 'Grand hip hall' : 'Hip villa',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'hip',
      pitch: rng.range(0.56, 0.76),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: rng.pick(['arched', 'rect', 'tall']),
      windowUpper: rng.pick(['rect', 'pair']),
      door: rng.pick(['arcade', 'arched', 'double']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: rng.chance(0.55),
      hasChimney: true,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'shed') {
    const W = rng.range(36, 44) * scalePreset;
    const D = rng.range(46, 56) * scalePreset;
    const H = rng.range(24, 31) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 44 ? 3 : H >= 29 ? 2 : 1;
    return {
      generation,
      label: scalePreset >= 1.3 ? 'Grand loft' : 'Studio loft',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'shed',
      pitch: rng.range(0.28, 0.40),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: rng.pick(['ribbon', 'rect', 'tall']),
      windowUpper: rng.pick(['ribbon', 'pair']),
      door: rng.pick(['rect', 'double']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: true,
      hasChimney: true,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'sawtooth') {
    const W = rng.range(46, 54) * scalePreset;
    const D = rng.range(48, 56) * scalePreset;
    const H = rng.range(24, 30) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 36 ? 2 : 1;
    return {
      generation,
      label: scalePreset >= 1.24 ? 'Sawtooth atelier' : 'Sawtooth studio',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'sawtooth',
      pitch: rng.range(0.44, 0.56),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: rng.pick(['ribbon', 'rect']),
      windowUpper: 'ribbon',
      door: rng.pick(['double', 'rect']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: true,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'butterfly') {
    const W = rng.range(44, 52) * scalePreset;
    const D = rng.range(46, 54) * scalePreset;
    const H = rng.range(28, 34) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 34 ? 2 : 1;
    return {
      generation,
      label: scalePreset >= 1.26 ? 'Butterfly villa' : 'Butterfly pavilion',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'butterfly',
      pitch: rng.range(0.28, 0.38),
      mansardRatio: 0,
      parapetH: 0,
      windowGround: rng.pick(['ribbon', 'tall']),
      windowUpper: 'ribbon',
      door: rng.pick(['double', 'rect']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: true,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (roofType === 'flat') {
    const W = rng.range(38, 45) * scalePreset;
    const D = rng.range(44, 52) * scalePreset;
    const H = rng.range(32, 39) * scalePreset;
    const levels: 1 | 2 | 3 = H >= 42 ? 3 : 2;
    return {
      generation,
      label: scalePreset >= 1.28 ? 'Modernist tower' : 'Modernist cube',
      topology,
      W,
      D,
      H,
      levels,
      roofType: 'flat',
      pitch: 0,
      mansardRatio: 0,
      parapetH: Math.min(5.2, 3.2 * scalePreset),
      windowGround: rng.pick(['arched', 'ribbon', 'tall']),
      windowUpper: rng.pick(['ribbon', 'pair', 'rect']),
      door: rng.pick(['arcade', 'double', 'rect']),
      hasOculus: false,
      hasBelfry: false,
      hasAwning: rng.chance(0.6),
      hasChimney: true,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  // Varied gable townhouse / grand hall / gambrel barn / 3x stepped trappgavel / barrel vault / saltbox!
  const gableProfile: GableProfile =
    opts.gableProfile ??
    (extraSeed > 0 || generation > presetCount
      ? rng.pick(ALL_GABLE_PROFILES)
      : 'classic');
  const tallTownhouse = rng.chance(0.55);
  const W = (tallTownhouse ? rng.range(34, 42) : rng.range(42, 48)) * scalePreset;
  const D = (tallTownhouse ? rng.range(44, 52) : rng.range(54, 62)) * scalePreset;
  const H = (tallTownhouse ? rng.range(30, 37) : rng.range(22, 27)) * scalePreset;
  const levels: 1 | 2 | 3 = H >= 44 ? 3 : H >= 30 ? 2 : 1;
  const gableLabel =
    gableProfile === 'gambrel'
      ? 'Gambrel barn'
      : gableProfile === 'stepped'
        ? 'Stepped gable'
        : gableProfile === 'barrel'
          ? 'Barrel gable'
          : gableProfile === 'saltbox'
            ? 'Saltbox house'
            : scalePreset >= 1.3
              ? 'Grand gable hall'
              : tallTownhouse
                ? 'Gable townhouse'
                : 'Long gable house';
  return {
    generation,
    label: gableLabel,
    topology,
    W,
    D,
    H,
    levels,
    roofType: 'gable',
    gableProfile,
    pitch: rng.range(0.64, 0.92),
    mansardRatio: 0,
    parapetH: 0,
    windowGround: rng.pick(winPool),
    windowUpper: rng.pick(winPool),
    door: rng.pick(doorPool),
    hasOculus: rng.chance(0.85),
    hasBelfry: false,
    hasAwning: rng.chance(0.55),
    hasChimney: gableProfile === 'stepped' ? false : rng.chance(0.85),
    dormerCount: gableProfile === 'stepped' || gableProfile === 'barrel' ? 0 : D >= 48 ? (rng.chance(0.55) ? 2 : 1) : 1,
    yawOffset,
    outsideColor,
  };
}

// ----------------------------------------------------------------------------
// Universal Piecewise Gable Ceiling Profile Geometry (`classic`, `gambrel` 2×, `stepped` 3× ladder, `barrel` 3×, `saltbox`)
// ----------------------------------------------------------------------------
interface GableRoofSeg {
  /** Exact flat paper width of this roof strip (mm) */
  length: number;
  /** Magnitude of relative fold angle at hinge crease (radians >= 0) */
  targetAngle: number;
  /** True for outward mountain creases (e.g. vertical ladder risers in `stepped` 3× trappgavel!) */
  isMountain: boolean;
  label: string;
}

interface BuiltGableProfile {
  leftSegs: GableRoofSeg[];
  rightSegs: GableRoofSeg[];
  /** Ordered `(worldX, riseAboveH)` crown points from `(-hw, 0)` across roof profile to `(+hw, 0)` */
  wallCrown: V2[];
  roofRise: number;
  roofSlant: number;
  ridgeX: number;
}

function buildGableProfileGeometry(hw: number, pitch: number, profile: GableProfile): BuiltGableProfile {
  const toSegs = (pts: V2[], sideLabel: string): GableRoofSeg[] => {
    const segs: GableRoofSeg[] = [];
    let prevTheta = 0; // vertical wall pointing straight UP (+Y)
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      const length = Math.hypot(dx, dy);
      const theta = Math.atan2(dx, dy);
      const delta = theta - prevTheta;
      segs.push({
        length,
        targetAngle: Math.abs(delta),
        isMountain: delta < 0,
        label: i === 1 ? `${sideLabel} roof` : `${sideLabel} roof ${i}`,
      });
      prevTheta = theta;
    }
    return segs;
  };

  let leftPts: V2[];
  let rightPts: V2[];
  let ridgeX = 0;

  if (profile === 'gambrel') {
    // Cut twice: steep lower skirt (~62°) + gentler upper pitch (~24°)
    const lowerRun = hw * 0.42;
    const lowerPitch = Math.max(1.02, Math.min(1.22, pitch + 0.34));
    const rise1 = lowerRun * Math.tan(lowerPitch);
    const upperRun = hw - lowerRun;
    const upperPitch = Math.max(0.32, Math.min(0.52, pitch * 0.50));
    const rise2 = rise1 + upperRun * Math.tan(upperPitch);
    leftPts = [
      [0, 0],
      [lowerRun, rise1],
      [hw, rise2],
    ];
    rightPts = leftPts;
  } else if (profile === 'barrel') {
    // 3-cut arched faceted barrel vault along a smooth quarter-ellipse
    const R = hw * Math.max(0.72, Math.min(1.05, Math.tan(pitch) * 0.92));
    leftPts = [
      [0, 0],
      [hw * (1 - Math.cos(Math.PI / 6)), R * Math.sin(Math.PI / 6)],
      [hw * (1 - Math.cos(Math.PI / 3)), R * Math.sin(Math.PI / 3)],
      [hw, R],
    ];
    rightPts = leftPts;
  } else if (profile === 'stepped') {
    // 3× ladder crow-stepped gable (*trappgavel*): 3 alternating tread (valley) + riser (mountain) steps + crown half!
    const stepW = hw * 0.25;
    const stepH = Math.max(4.5, Math.min(9.2, hw * 0.28));
    leftPts = [
      [0, 0],
      [stepW, 0],
      [stepW, stepH],
      [stepW * 2, stepH],
      [stepW * 2, stepH * 2],
      [stepW * 3, stepH * 2],
      [stepW * 3, stepH * 3],
      [hw, stepH * 3],
    ];
    rightPts = leftPts;
  } else if (profile === 'saltbox') {
    // Asymmetric offset-ridge gable: long sweeping left slope + steeper shorter right slope
    ridgeX = hw * 0.30;
    const R = hw * Math.tan(pitch) * 0.92;
    leftPts = [
      [0, 0],
      [hw + ridgeX, R],
    ];
    rightPts = [
      [0, 0],
      [hw - ridgeX, R],
    ];
  } else {
    // Classic single-cut pitched gable
    const R = hw * Math.tan(pitch);
    leftPts = [
      [0, 0],
      [hw, R],
    ];
    rightPts = leftPts;
  }

  // Combine leftPts (-hw + run, rise) + reversed interior rightPts (+hw - run, rise) into one clean crown polyline
  const wallCrown: V2[] = [];
  for (let i = 0; i < leftPts.length; i++) {
    wallCrown.push([-hw + leftPts[i][0], leftPts[i][1]]);
  }
  for (let i = rightPts.length - 2; i >= 0; i--) {
    const wx = hw - rightPts[i][0];
    const wy = rightPts[i][1];
    const prev = wallCrown[wallCrown.length - 1];
    if (Math.hypot(wx - prev[0], wy - prev[1]) > 1e-4) {
      wallCrown.push([wx, wy]);
    }
  }

  const leftSegs = toSegs(leftPts, 'Left');
  const rightSegs = toSegs(rightPts, 'Right');
  const roofRise = leftPts[leftPts.length - 1][1];
  const roofSlant = leftSegs[0]?.length ?? hw;

  return { leftSegs, rightSegs, wallCrown, roofRise, roofSlant, ridgeX };
}

// ----------------------------------------------------------------------------
// Classic `+` Cross Star Net Builder (all 6 roof types)
// ----------------------------------------------------------------------------
function buildCrossPanels(
  spec: HouseNetSpec,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number } {
  const { W, D, H, roofType, pitch, mansardRatio, parapetH } = spec;
  const hw = W * 0.5;
  const hd = D * 0.5;
  const minSpan = Math.min(W, D);

  const frontFrame = (h = H): WallLocalFrame => ({
    origin: [0, -hd],
    uAxis: [1, 0],
    vAxis: [0, -1],
    widthMm: W,
    heightMm: h,
  });
  const backFrame = (h = H): WallLocalFrame => ({
    origin: [0, hd],
    uAxis: [1, 0],
    vAxis: [0, 1],
    widthMm: W,
    heightMm: h,
  });
  const leftFrame = (h = H): WallLocalFrame => ({
    origin: [-hw, 0],
    uAxis: [0, 1],
    vAxis: [-1, 0],
    widthMm: D,
    heightMm: h,
  });
  const rightFrame = (h = H): WallLocalFrame => ({
    origin: [hw, 0],
    uAxis: [0, 1],
    vAxis: [1, 0],
    widthMm: D,
    heightMm: h,
  });

  if (roofType === 'gable') {
    const profile: GableProfile = spec.gableProfile ?? spec.architecture?.roof.gableProfile ?? 'classic';
    const gp = buildGableProfileGeometry(hw, pitch, profile);
    const R = gp.roofRise;
    const L = gp.roofSlant;

    // Front gable wall (`y <= -hd`): world `(wx, H + ry)` -> sheet `(wx, -(hd + H + ry))`
    const frontPoly: V2[] = [
      [-hw, -hd],
      ...gp.wallCrown.map(([wx, ry]): V2 => [wx, -(hd + H + ry)]),
      [hw, -hd],
    ];

    add({
      id: 'front',
      parent: 'base',
      poly: frontPoly,
      hingeOrigin: [0, -hd],
      crease: [[-hw, -hd], [hw, -hd]],
      hingeAxis: [-1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: frontFrame(),
      isFront: true,
      isGableEnd: true,
      label: 'Front gable',
    });

    // Back gable wall (`y >= +hd`): world `(wx, H + ry)` -> sheet `(wx, +(hd + H + ry))`
    const backPoly: V2[] = [
      [-hw, hd],
      [hw, hd],
      ...gp.wallCrown.slice().reverse().map(([wx, ry]): V2 => [wx, hd + H + ry]),
    ];

    add({
      id: 'back',
      parent: 'base',
      poly: backPoly,
      hingeOrigin: [0, hd],
      crease: [[-hw, hd], [hw, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: backFrame(),
      isGableEnd: true,
      label: 'Back gable',
    });

    add({
      id: 'left',
      parent: 'base',
      poly: [
        [-(hw + H), -hd],
        [-hw, -hd],
        [-hw, hd],
        [-(hw + H), hd],
      ],
      hingeOrigin: [-hw, 0],
      crease: [[-hw, -hd], [-hw, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: leftFrame(),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'base',
      poly: [
        [hw, -hd],
        [hw + H, -hd],
        [hw + H, hd],
        [hw, hd],
      ],
      hingeOrigin: [hw, 0],
      crease: [[hw, -hd], [hw, hd]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: rightFrame(),
      label: 'Right wall',
    });

    // Chain left ceiling segments outward along `-X` from `left` wall top edge
    let xCurL = -(hw + H);
    let parentL: PanelId = 'left';
    gp.leftSegs.forEach((seg, idx) => {
      const id = idx === 0 ? 'roofL' : `roofL${idx + 1}`;
      const xNext = xCurL - seg.length;
      add({
        id,
        parent: parentL,
        poly: [
          [xNext, -hd],
          [xCurL, -hd],
          [xCurL, hd],
          [xNext, hd],
        ],
        hingeOrigin: [xCurL, 0],
        crease: [[xCurL, -hd], [xCurL, hd]],
        hingeAxis: seg.isMountain ? [0, -1] : [0, 1],
        targetAngle: seg.targetAngle,
        stage: 'roof',
        isMountain: seg.isMountain || undefined,
        roofFrame: { origin: [xCurL, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: seg.length },
        label: seg.label,
      });
      parentL = id;
      xCurL = xNext;
    });

    // Chain right ceiling segments outward along `+X` from `right` wall top edge
    let xCurR = hw + H;
    let parentR: PanelId = 'right';
    gp.rightSegs.forEach((seg, idx) => {
      const id = idx === 0 ? 'roofR' : `roofR${idx + 1}`;
      const xNext = xCurR + seg.length;
      add({
        id,
        parent: parentR,
        poly: [
          [xCurR, -hd],
          [xNext, -hd],
          [xNext, hd],
          [xCurR, hd],
        ],
        hingeOrigin: [xCurR, 0],
        crease: [[xCurR, -hd], [xCurR, hd]],
        hingeAxis: seg.isMountain ? [0, 1] : [0, -1],
        targetAngle: seg.targetAngle,
        stage: 'roof',
        isMountain: seg.isMountain || undefined,
        roofFrame: { origin: [xCurR, 0], ridgeAxis: [0, -1], slopeAxis: [1, 0], widthMm: D, slantMm: seg.length },
        label: seg.label,
      });
      parentR = id;
      xCurR = xNext;
    });

    return { roofRise: R, roofSlant: L };
  }

  if (roofType === 'shed') {
    const R = W * Math.tan(pitch);
    const L = Math.hypot(W, R);
    const roofFold = Math.PI * 0.5 - pitch;

    add({
      id: 'front',
      parent: 'base',
      poly: [
        [-hw, -hd],
        [-hw, -(hd + H)],
        [hw, -(hd + H + R)],
        [hw, -hd],
      ],
      hingeOrigin: [0, -hd],
      crease: [[-hw, -hd], [hw, -hd]],
      hingeAxis: [-1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: frontFrame(H),
      isFront: true,
      label: 'Front facade',
    });

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [-hw, hd],
        [hw, hd],
        [hw, hd + H + R],
        [-hw, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[-hw, hd], [hw, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: backFrame(H),
      label: 'Back facade',
    });

    add({
      id: 'left',
      parent: 'base',
      poly: [
        [-(hw + H), -hd],
        [-hw, -hd],
        [-hw, hd],
        [-(hw + H), hd],
      ],
      hingeOrigin: [-hw, 0],
      crease: [[-hw, -hd], [-hw, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: leftFrame(H),
      label: 'Low wall',
    });

    add({
      id: 'right',
      parent: 'base',
      poly: [
        [hw, -hd],
        [hw + H + R, -hd],
        [hw + H + R, hd],
        [hw, hd],
      ],
      hingeOrigin: [hw, 0],
      crease: [[hw, -hd], [hw, hd]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: rightFrame(H + R),
      label: 'High wall',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [-(hw + H + L), -hd],
        [-(hw + H), -hd],
        [-(hw + H), hd],
        [-(hw + H + L), hd],
      ],
      hingeOrigin: [-(hw + H), 0],
      crease: [[-(hw + H), -hd], [-(hw + H), hd]],
      hingeAxis: [0, 1],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [-(hw + H), 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: L },
      label: 'Shed roof',
    });

    return { roofRise: R, roofSlant: L };
  }

  if (roofType === 'flat') {
    const wallTop = H + parapetH;

    add({
      id: 'front',
      parent: 'base',
      poly: [
        [-hw, -hd],
        [-hw, -(hd + wallTop)],
        [hw, -(hd + wallTop)],
        [hw, -hd],
      ],
      hingeOrigin: [0, -hd],
      crease: [[-hw, -hd], [hw, -hd]],
      hingeAxis: [-1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: frontFrame(H),
      isFront: true,
      label: 'Front wall',
    });

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [-hw, hd],
        [hw, hd],
        [hw, hd + wallTop],
        [-hw, hd + wallTop],
      ],
      hingeOrigin: [0, hd],
      crease: [[-hw, hd], [hw, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: backFrame(H),
      label: 'Back wall',
    });

    add({
      id: 'left',
      parent: 'base',
      poly: [
        [-(hw + H), -hd],
        [-hw, -hd],
        [-hw, hd],
        [-(hw + H), hd],
      ],
      hingeOrigin: [-hw, 0],
      crease: [[-hw, -hd], [-hw, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: leftFrame(H),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'base',
      poly: [
        [hw, -hd],
        [hw + wallTop, -hd],
        [hw + wallTop, hd],
        [hw, hd],
      ],
      hingeOrigin: [hw, 0],
      crease: [[hw, -hd], [hw, hd]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: rightFrame(H),
      label: 'Right wall',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [-(hw + H + W), -hd],
        [-(hw + H), -hd],
        [-(hw + H), hd],
        [-(hw + H + W), hd],
      ],
      hingeOrigin: [-(hw + H), 0],
      crease: [[-(hw + H), -hd], [-(hw + H), hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'roof',
      roofFrame: { origin: [-(hw + H), 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: W },
      label: 'Roof deck',
    });

    return { roofRise: parapetH, roofSlant: W };
  }

  if (roofType === 'butterfly') {
    const R = Math.min(H * 0.36, hw * Math.tan(pitch));
    const effPitch = Math.atan2(R, hw);
    const L = Math.hypot(hw, R);
    const roofFold = Math.PI * 0.5 + effPitch;

    add({
      id: 'front',
      parent: 'base',
      poly: [
        [-hw, -hd],
        [-hw, -(hd + H)],
        [0, -(hd + H - R)],
        [hw, -(hd + H)],
        [hw, -hd],
      ],
      hingeOrigin: [0, -hd],
      crease: [[-hw, -hd], [hw, -hd]],
      hingeAxis: [-1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: frontFrame(H - R),
      isFront: true,
      label: 'Front facade',
    });

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [-hw, hd],
        [hw, hd],
        [hw, hd + H],
        [0, hd + H - R],
        [-hw, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[-hw, hd], [hw, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: backFrame(H - R),
      label: 'Back facade',
    });

    add({
      id: 'left',
      parent: 'base',
      poly: [
        [-(hw + H), -hd],
        [-hw, -hd],
        [-hw, hd],
        [-(hw + H), hd],
      ],
      hingeOrigin: [-hw, 0],
      crease: [[-hw, -hd], [-hw, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: leftFrame(H),
      label: 'Left wing wall',
    });

    add({
      id: 'right',
      parent: 'base',
      poly: [
        [hw, -hd],
        [hw + H, -hd],
        [hw + H, hd],
        [hw, hd],
      ],
      hingeOrigin: [hw, 0],
      crease: [[hw, -hd], [hw, hd]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: rightFrame(H),
      label: 'Right wing wall',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [-(hw + H + L), -hd],
        [-(hw + H), -hd],
        [-(hw + H), hd],
        [-(hw + H + L), hd],
      ],
      hingeOrigin: [-(hw + H), 0],
      crease: [[-(hw + H), -hd], [-(hw + H), hd]],
      hingeAxis: [0, 1],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [-(hw + H), 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: L },
      label: 'Left butterfly wing',
    });

    add({
      id: 'roofR',
      parent: 'right',
      poly: [
        [hw + H, -hd],
        [hw + H + L, -hd],
        [hw + H + L, hd],
        [hw + H, hd],
      ],
      hingeOrigin: [hw + H, 0],
      crease: [[hw + H, -hd], [hw + H, hd]],
      hingeAxis: [0, -1],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [hw + H, 0], ridgeAxis: [0, -1], slopeAxis: [1, 0], widthMm: D, slantMm: L },
      label: 'Right butterfly wing',
    });

    return { roofRise: 0, roofSlant: L };
  }

  if (roofType === 'sawtooth') {
    const bayW = W * 0.5;
    const wA = bayW * 0.72;
    const wB = bayW - wA;
    const R = wA * Math.tan(pitch);
    const La = Math.hypot(wA, R);
    const Lb = Math.hypot(wB, R);
    const alpha = Math.atan2(R, wA);
    const beta = Math.atan2(R, wB);
    const pleatTurn = alpha + beta;

    add({
      id: 'front',
      parent: 'base',
      poly: [
        [-hw, -hd],
        [-hw, -(hd + H)],
        [-hw + wA, -(hd + H + R)],
        [0, -(hd + H)],
        [wA, -(hd + H + R)],
        [hw, -(hd + H)],
        [hw, -hd],
      ],
      hingeOrigin: [0, -hd],
      crease: [[-hw, -hd], [hw, -hd]],
      hingeAxis: [-1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: frontFrame(H),
      isFront: true,
      label: 'Front sawtooth facade',
    });

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [-hw, hd],
        [hw, hd],
        [hw, hd + H],
        [wA, hd + H + R],
        [0, hd + H],
        [-hw + wA, hd + H + R],
        [-hw, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[-hw, hd], [hw, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: backFrame(H),
      label: 'Back sawtooth facade',
    });

    add({
      id: 'left',
      parent: 'base',
      poly: [
        [-(hw + H), -hd],
        [-hw, -hd],
        [-hw, hd],
        [-(hw + H), hd],
      ],
      hingeOrigin: [-hw, 0],
      crease: [[-hw, -hd], [-hw, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: leftFrame(H),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'base',
      poly: [
        [hw, -hd],
        [hw + H, -hd],
        [hw + H, hd],
        [hw, hd],
      ],
      hingeOrigin: [hw, 0],
      crease: [[hw, -hd], [hw, hd]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: rightFrame(H),
      label: 'Right wall',
    });

    // 4-panel concertina sawtooth accordion strip: valley -> valley -> MOUNTAIN -> valley!
    const x0 = -(hw + H);
    const x1 = x0 - La;
    const x2 = x1 - Lb;
    const x3 = x2 - La;
    const x4 = x3 - Lb;

    add({
      id: 'roofS0',
      parent: 'left',
      poly: [[x1, -hd], [x0, -hd], [x0, hd], [x1, hd]],
      hingeOrigin: [x0, 0],
      crease: [[x0, -hd], [x0, hd]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5 - alpha,
      stage: 'roof',
      roofFrame: { origin: [x0, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: La },
      label: 'Sawtooth slope 1',
    });

    add({
      id: 'roofS1',
      parent: 'roofS0',
      poly: [[x2, -hd], [x1, -hd], [x1, hd], [x2, hd]],
      hingeOrigin: [x1, 0],
      crease: [[x1, -hd], [x1, hd]],
      hingeAxis: [0, 1],
      targetAngle: pleatTurn,
      stage: 'roof',
      hasRoofSkylights: true,
      roofFrame: { origin: [x1, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: Lb },
      label: 'North skylight 1',
    });

    add({
      id: 'roofS2',
      parent: 'roofS1',
      poly: [[x3, -hd], [x2, -hd], [x2, hd], [x3, hd]],
      hingeOrigin: [x2, 0],
      crease: [[x2, -hd], [x2, hd]],
      hingeAxis: [0, -1],
      targetAngle: pleatTurn,
      stage: 'roof',
      isMountain: true,
      roofFrame: { origin: [x2, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: La },
      label: 'Sawtooth slope 2',
    });

    add({
      id: 'roofS3',
      parent: 'roofS2',
      poly: [[x4, -hd], [x3, -hd], [x3, hd], [x4, hd]],
      hingeOrigin: [x3, 0],
      crease: [[x3, -hd], [x3, hd]],
      hingeAxis: [0, 1],
      targetAngle: pleatTurn,
      stage: 'roof',
      hasRoofSkylights: true,
      roofFrame: { origin: [x3, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: Lb },
      label: 'North skylight 2',
    });

    return { roofRise: R, roofSlant: La };
  }

  // 4-sided pitched roofs on cross net: `hip`, `mansard`, `spire`
  const isMansard = roofType === 'mansard';
  const isSpire = roofType === 'spire';
  const run = isMansard ? minSpan * 0.5 * (1 - mansardRatio) : minSpan * 0.5;
  const hwTop = isSpire ? 0 : Math.max(0, hw - run);
  const hdTop = isSpire ? 0 : Math.max(0, hd - run);

  const R = run * Math.tan(pitch);
  const L = Math.hypot(run, R);
  const roofFold = Math.PI * 0.5 - pitch;

  add({
    id: 'front',
    parent: 'base',
    poly: [
      [-hw, -hd],
      [-hw, -(hd + H)],
      [hw, -(hd + H)],
      [hw, -hd],
    ],
    hingeOrigin: [0, -hd],
    crease: [[-hw, -hd], [hw, -hd]],
    hingeAxis: [-1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: frontFrame(),
    isFront: true,
    label: 'Front wall',
  });

  add({
    id: 'back',
    parent: 'base',
    poly: [
      [-hw, hd],
      [hw, hd],
      [hw, hd + H],
      [-hw, hd + H],
    ],
    hingeOrigin: [0, hd],
    crease: [[-hw, hd], [hw, hd]],
    hingeAxis: [1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: backFrame(),
    label: 'Back wall',
  });

  add({
    id: 'left',
    parent: 'base',
    poly: [
      [-(hw + H), -hd],
      [-hw, -hd],
      [-hw, hd],
      [-(hw + H), hd],
    ],
    hingeOrigin: [-hw, 0],
    crease: [[-hw, -hd], [-hw, hd]],
    hingeAxis: [0, 1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: leftFrame(),
    label: 'Left wall',
  });

  add({
    id: 'right',
    parent: 'base',
    poly: [
      [hw, -hd],
      [hw + H, -hd],
      [hw + H, hd],
      [hw, hd],
    ],
    hingeOrigin: [hw, 0],
    crease: [[hw, -hd], [hw, hd]],
    hingeAxis: [0, -1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: rightFrame(),
    label: 'Right wall',
  });

  const lip = isMansard ? 1.8 : 0;
  const Llip = L + lip;
  const hwTopLip = isMansard ? Math.max(2, hwTop - (lip / Math.max(L, 1)) * (hw - hwTop)) : hwTop;
  const hdTopLip = isMansard ? Math.max(2, hdTop - (lip / Math.max(L, 1)) * (hd - hdTop)) : hdTop;

  const frontRoofPoly: V2[] =
    hwTop > 1e-3
      ? [
          [-hw, -(hd + H)],
          [-hwTopLip, -(hd + H + Llip)],
          [hwTopLip, -(hd + H + Llip)],
          [hw, -(hd + H)],
        ]
      : [
          [-hw, -(hd + H)],
          [0, -(hd + H + L)],
          [hw, -(hd + H)],
        ];

  const backRoofPoly: V2[] =
    hwTop > 1e-3
      ? [
          [-hw, hd + H],
          [hw, hd + H],
          [hwTop, hd + H + L],
          [-hwTop, hd + H + L],
        ]
      : [
          [-hw, hd + H],
          [hw, hd + H],
          [0, hd + H + L],
        ];

  const leftRoofPoly: V2[] =
    hdTop > 1e-3
      ? [
          [-(hw + H), -hd],
          [-(hw + H), hd],
          [-(hw + H + Llip), hdTopLip],
          [-(hw + H + Llip), -hdTopLip],
        ]
      : [
          [-(hw + H), -hd],
          [-(hw + H), hd],
          [-(hw + H + L), 0],
        ];

  const rightRoofPoly: V2[] =
    hdTop > 1e-3
      ? [
          [hw + H, -hd],
          [hw + H + Llip, -hdTopLip],
          [hw + H + Llip, hdTopLip],
          [hw + H, hd],
        ]
      : [
          [hw + H, -hd],
          [hw + H + L, 0],
          [hw + H, hd],
        ];

  add({
    id: 'roofF',
    parent: 'front',
    poly: frontRoofPoly,
    hingeOrigin: [0, -(hd + H)],
    crease: [[-hw, -(hd + H)], [hw, -(hd + H)]],
    hingeAxis: [-1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [0, -(hd + H)], ridgeAxis: [-1, 0], slopeAxis: [0, -1], widthMm: W, slantMm: L },
    label: isSpire ? 'Front spire' : 'Front roof',
  });

  add({
    id: 'roofB',
    parent: 'back',
    poly: backRoofPoly,
    hingeOrigin: [0, hd + H],
    crease: [[-hw, hd + H], [hw, hd + H]],
    hingeAxis: [1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [0, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: W, slantMm: L },
    label: isSpire ? 'Back spire' : 'Back roof',
  });

  add({
    id: 'roofL',
    parent: 'left',
    poly: leftRoofPoly,
    hingeOrigin: [-(hw + H), 0],
    crease: [[-(hw + H), -hd], [-(hw + H), hd]],
    hingeAxis: [0, 1],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [-(hw + H), 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: L },
    label: isSpire ? 'Left spire' : 'Left roof',
  });

  add({
    id: 'roofR',
    parent: 'right',
    poly: rightRoofPoly,
    hingeOrigin: [hw + H, 0],
    crease: [[hw + H, -hd], [hw + H, hd]],
    hingeAxis: [0, -1],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [hw + H, 0], ridgeAxis: [0, -1], slopeAxis: [1, 0], widthMm: D, slantMm: L },
    label: isSpire ? 'Right spire' : 'Right roof',
  });

  if (isMansard && hwTop > 1e-3 && hdTop > 1e-3) {
    const capY0 = hd + H + L;
    const capY1 = capY0 + hdTop * 2;
    add({
      id: 'roofCap',
      parent: 'roofB',
      poly: [
        [-hwTop, capY0],
        [hwTop, capY0],
        [hwTop, capY1],
        [-hwTop, capY1],
      ],
      hingeOrigin: [0, capY0],
      crease: [[-hwTop, capY0], [hwTop, capY0]],
      hingeAxis: [1, 0],
      targetAngle: pitch,
      stage: 'cap',
      label: 'Mansard deck',
    });
  }

  return { roofRise: R, roofSlant: L };
}

// ----------------------------------------------------------------------------
// Wrap-Around Ribbon Net Builder (`left <- back -> right -> front`, all 6 roof types!)
// ----------------------------------------------------------------------------
function buildRibbonPanels(
  spec: HouseNetSpec,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number } {
  const { W, D, H, roofType, pitch, mansardRatio, parapetH } = spec;
  const hw = W * 0.5;
  const hd = D * 0.5;
  const minSpan = Math.min(W, D);

  // Horizontal ribbon X-intervals along `y >= hd`:
  //   left:  [-(hw + D), -hw]       (child of `back`, wraps -90° around left-back corner)
  //   back:  [-hw, +hw]             (child of `base`, lifts +90° off floor!)
  //   right: [+hw, hw + D]          (child of `back`, wraps +90° around right-back corner)
  //   front: [hw + D, hw + D + W]   (child of `right`, wraps +90° across the front to kiss `left`!)
  const xL0 = -(hw + D);
  const xL1 = -hw;
  const xB0 = -hw;
  const xB1 = hw;
  const xR0 = hw;
  const xR1 = hw + D;
  const xF0 = hw + D;
  const xF1 = hw + D + W;

  const cxL = (xL0 + xL1) * 0.5;
  const cxB = 0;
  const cxR = (xR0 + xR1) * 0.5;
  const cxF = (xF0 + xF1) * 0.5;

  const ribbonWallFrame = (cx: number, widthMm: number, heightMm: number, flipU = false): WallLocalFrame => ({
    origin: [cx, hd],
    uAxis: [flipU ? -1 : 1, 0],
    vAxis: [0, 1],
    widthMm,
    heightMm,
  });

  if (roofType === 'gable') {
    const profile: GableProfile = spec.gableProfile ?? spec.architecture?.roof.gableProfile ?? 'classic';
    const gp = buildGableProfileGeometry(hw, pitch, profile);
    const R = gp.roofRise;
    const L = gp.roofSlant;

    // Back wall (`x ∈ [xB0, xB1]`): worldX maps directly to sheetX (`wx`)
    const backPoly: V2[] = [
      [xB0, hd],
      [xB1, hd],
      ...gp.wallCrown.slice().reverse().map(([wx, ry]): V2 => [wx, hd + H + ry]),
    ];

    add({
      id: 'back',
      parent: 'base',
      poly: backPoly,
      hingeOrigin: [0, hd],
      crease: [[xB0, hd], [xB1, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxB, W, H),
      isGableEnd: true,
      label: 'Back gable',
    });

    add({
      id: 'left',
      parent: 'back',
      poly: [
        [xL0, hd],
        [xL1, hd],
        [xL1, hd + H],
        [xL0, hd + H],
      ],
      hingeOrigin: [xL1, hd + H * 0.5],
      crease: [[xL1, hd], [xL1, hd + H]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxL, D, H),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'back',
      poly: [
        [xR0, hd],
        [xR1, hd],
        [xR1, hd + H],
        [xR0, hd + H],
      ],
      hingeOrigin: [xR0, hd + H * 0.5],
      crease: [[xR0, hd], [xR0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxR, D, H),
      label: 'Right wall',
    });

    // Front wall (`xF0 -> +hw`, `xF1 -> -hw`): worldX maps to `cxF - wx`
    const frontPoly: V2[] = [
      [xF0, hd],
      [xF1, hd],
      ...gp.wallCrown.map(([wx, ry]): V2 => [cxF - wx, hd + H + ry]),
    ];

    add({
      id: 'front',
      parent: 'right',
      poly: frontPoly,
      hingeOrigin: [xF0, hd + H * 0.5],
      crease: [[xF0, hd], [xF0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxF, W, H, true),
      isFront: true,
      isGableEnd: true,
      label: 'Front gable',
    });

    // Chain left ceiling segments upward along `+Y` from `left` wall top edge
    let yCurL = hd + H;
    let parentL: PanelId = 'left';
    gp.leftSegs.forEach((seg, idx) => {
      const id = idx === 0 ? 'roofL' : `roofL${idx + 1}`;
      const yNext = yCurL + seg.length;
      add({
        id,
        parent: parentL,
        poly: [
          [xL0, yCurL],
          [xL1, yCurL],
          [xL1, yNext],
          [xL0, yNext],
        ],
        hingeOrigin: [cxL, yCurL],
        crease: [[xL0, yCurL], [xL1, yCurL]],
        hingeAxis: seg.isMountain ? [-1, 0] : [1, 0],
        targetAngle: seg.targetAngle,
        stage: 'roof',
        isMountain: seg.isMountain || undefined,
        roofFrame: { origin: [cxL, yCurL], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: seg.length },
        label: seg.label,
      });
      parentL = id;
      yCurL = yNext;
    });

    // Chain right ceiling segments upward along `+Y` from `right` wall top edge
    let yCurR = hd + H;
    let parentR: PanelId = 'right';
    gp.rightSegs.forEach((seg, idx) => {
      const id = idx === 0 ? 'roofR' : `roofR${idx + 1}`;
      const yNext = yCurR + seg.length;
      add({
        id,
        parent: parentR,
        poly: [
          [xR0, yCurR],
          [xR1, yCurR],
          [xR1, yNext],
          [xR0, yNext],
        ],
        hingeOrigin: [cxR, yCurR],
        crease: [[xR0, yCurR], [xR1, yCurR]],
        hingeAxis: seg.isMountain ? [-1, 0] : [1, 0],
        targetAngle: seg.targetAngle,
        stage: 'roof',
        isMountain: seg.isMountain || undefined,
        roofFrame: { origin: [cxR, yCurR], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: seg.length },
        label: seg.label,
      });
      parentR = id;
      yCurR = yNext;
    });

    return { roofRise: R, roofSlant: L };
  }

  if (roofType === 'shed') {
    const R = W * Math.tan(pitch);
    const L = Math.hypot(W, R);
    const roofFold = Math.PI * 0.5 - pitch;

    // Continuous sloped ribbon profile: left[H] -> back[H ↗ H+R] -> right[H+R] -> front[H+R ↘ H]!
    add({
      id: 'back',
      parent: 'base',
      poly: [
        [xB0, hd],
        [xB1, hd],
        [xB1, hd + H + R],
        [xB0, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[xB0, hd], [xB1, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxB, W, H),
      label: 'Back facade',
    });

    add({
      id: 'left',
      parent: 'back',
      poly: [
        [xL0, hd],
        [xL1, hd],
        [xL1, hd + H],
        [xL0, hd + H],
      ],
      hingeOrigin: [xL1, hd + H * 0.5],
      crease: [[xL1, hd], [xL1, hd + H]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxL, D, H),
      label: 'Low wall',
    });

    add({
      id: 'right',
      parent: 'back',
      poly: [
        [xR0, hd],
        [xR1, hd],
        [xR1, hd + H + R],
        [xR0, hd + H + R],
      ],
      hingeOrigin: [xR0, hd + (H + R) * 0.5],
      crease: [[xR0, hd], [xR0, hd + H + R]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxR, D, H + R),
      label: 'High wall',
    });

    add({
      id: 'front',
      parent: 'right',
      poly: [
        [xF0, hd],
        [xF1, hd],
        [xF1, hd + H],
        [xF0, hd + H + R],
      ],
      hingeOrigin: [xF0, hd + (H + R) * 0.5],
      crease: [[xF0, hd], [xF0, hd + H + R]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxF, W, H, true),
      isFront: true,
      label: 'Front facade',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [xL0, hd + H],
        [xL1, hd + H],
        [xL1, hd + H + L],
        [xL0, hd + H + L],
      ],
      hingeOrigin: [cxL, hd + H],
      crease: [[xL0, hd + H], [xL1, hd + H]],
      hingeAxis: [1, 0],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [cxL, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: L },
      label: 'Shed roof',
    });

    return { roofRise: R, roofSlant: L };
  }

  if (roofType === 'flat') {
    const wallTop = H + parapetH;

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [xB0, hd],
        [xB1, hd],
        [xB1, hd + wallTop],
        [xB0, hd + wallTop],
      ],
      hingeOrigin: [0, hd],
      crease: [[xB0, hd], [xB1, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxB, W, H),
      label: 'Back wall',
    });

    add({
      id: 'left',
      parent: 'back',
      poly: [
        [xL0, hd],
        [xL1, hd],
        [xL1, hd + H],
        [xL0, hd + H],
      ],
      hingeOrigin: [xL1, hd + H * 0.5],
      crease: [[xL1, hd], [xL1, hd + H]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxL, D, H),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'back',
      poly: [
        [xR0, hd],
        [xR1, hd],
        [xR1, hd + wallTop],
        [xR0, hd + wallTop],
      ],
      hingeOrigin: [xR0, hd + wallTop * 0.5],
      crease: [[xR0, hd], [xR0, hd + wallTop]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxR, D, H),
      label: 'Right wall',
    });

    add({
      id: 'front',
      parent: 'right',
      poly: [
        [xF0, hd],
        [xF1, hd],
        [xF1, hd + wallTop],
        [xF0, hd + wallTop],
      ],
      hingeOrigin: [xF0, hd + wallTop * 0.5],
      crease: [[xF0, hd], [xF0, hd + wallTop]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxF, W, H, true),
      isFront: true,
      label: 'Front wall',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [xL0, hd + H],
        [xL1, hd + H],
        [xL1, hd + H + W],
        [xL0, hd + H + W],
      ],
      hingeOrigin: [cxL, hd + H],
      crease: [[xL0, hd + H], [xL1, hd + H]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'roof',
      roofFrame: { origin: [cxL, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: W },
      label: 'Roof deck',
    });

    return { roofRise: parapetH, roofSlant: W };
  }

  if (roofType === 'butterfly') {
    const R = Math.min(H * 0.36, hw * Math.tan(pitch));
    const effPitch = Math.atan2(R, hw);
    const L = Math.hypot(hw, R);
    const roofFold = Math.PI * 0.5 + effPitch;

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [xB0, hd],
        [xB1, hd],
        [xB1, hd + H],
        [cxB, hd + H - R],
        [xB0, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[xB0, hd], [xB1, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxB, W, H - R),
      label: 'Back facade',
    });

    add({
      id: 'left',
      parent: 'back',
      poly: [
        [xL0, hd],
        [xL1, hd],
        [xL1, hd + H],
        [xL0, hd + H],
      ],
      hingeOrigin: [xL1, hd + H * 0.5],
      crease: [[xL1, hd], [xL1, hd + H]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxL, D, H),
      label: 'Left wing wall',
    });

    add({
      id: 'right',
      parent: 'back',
      poly: [
        [xR0, hd],
        [xR1, hd],
        [xR1, hd + H],
        [xR0, hd + H],
      ],
      hingeOrigin: [xR0, hd + H * 0.5],
      crease: [[xR0, hd], [xR0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxR, D, H),
      label: 'Right wing wall',
    });

    add({
      id: 'front',
      parent: 'right',
      poly: [
        [xF0, hd],
        [xF1, hd],
        [xF1, hd + H],
        [cxF, hd + H - R],
        [xF0, hd + H],
      ],
      hingeOrigin: [xF0, hd + H * 0.5],
      crease: [[xF0, hd], [xF0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxF, W, H - R, true),
      isFront: true,
      label: 'Front facade',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: [
        [xL0, hd + H],
        [xL1, hd + H],
        [xL1, hd + H + L],
        [xL0, hd + H + L],
      ],
      hingeOrigin: [cxL, hd + H],
      crease: [[xL0, hd + H], [xL1, hd + H]],
      hingeAxis: [1, 0],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [cxL, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: L },
      label: 'Left butterfly wing',
    });

    add({
      id: 'roofR',
      parent: 'right',
      poly: [
        [xR0, hd + H],
        [xR1, hd + H],
        [xR1, hd + H + L],
        [xR0, hd + H + L],
      ],
      hingeOrigin: [cxR, hd + H],
      crease: [[xR0, hd + H], [xR1, hd + H]],
      hingeAxis: [1, 0],
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: { origin: [cxR, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: L },
      label: 'Right butterfly wing',
    });

    return { roofRise: 0, roofSlant: L };
  }

  if (roofType === 'sawtooth') {
    const bayW = W * 0.5;
    const wA = bayW * 0.72;
    const wB = bayW - wA;
    const R = wA * Math.tan(pitch);
    const La = Math.hypot(wA, R);
    const Lb = Math.hypot(wB, R);
    const alpha = Math.atan2(R, wA);
    const beta = Math.atan2(R, wB);
    const pleatTurn = alpha + beta;

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [xB0, hd],
        [xB1, hd],
        [xB1, hd + H],
        [xB0 + bayW + wA, hd + H + R],
        [xB0 + bayW, hd + H],
        [xB0 + wA, hd + H + R],
        [xB0, hd + H],
      ],
      hingeOrigin: [0, hd],
      crease: [[xB0, hd], [xB1, hd]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxB, W, H),
      label: 'Back sawtooth facade',
    });

    add({
      id: 'left',
      parent: 'back',
      poly: [
        [xL0, hd],
        [xL1, hd],
        [xL1, hd + H],
        [xL0, hd + H],
      ],
      hingeOrigin: [xL1, hd + H * 0.5],
      crease: [[xL1, hd], [xL1, hd + H]],
      hingeAxis: [0, 1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxL, D, H),
      label: 'Left wall',
    });

    add({
      id: 'right',
      parent: 'back',
      poly: [
        [xR0, hd],
        [xR1, hd],
        [xR1, hd + H],
        [xR0, hd + H],
      ],
      hingeOrigin: [xR0, hd + H * 0.5],
      crease: [[xR0, hd], [xR0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxR, D, H),
      label: 'Right wall',
    });

    // Front wraps in reverse X (`xF0 -> +hw`, `xF1 -> -hw`) so sawtooth peaks mirror cleanly along `xF1 - s`!
    add({
      id: 'front',
      parent: 'right',
      poly: [
        [xF0, hd],
        [xF1, hd],
        [xF1, hd + H],
        [xF1 - wA, hd + H + R],
        [xF1 - bayW, hd + H],
        [xF1 - bayW - wA, hd + H + R],
        [xF0, hd + H],
      ],
      hingeOrigin: [xF0, hd + H * 0.5],
      crease: [[xF0, hd], [xF0, hd + H]],
      hingeAxis: [0, -1],
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: ribbonWallFrame(cxF, W, H, true),
      isFront: true,
      label: 'Front sawtooth facade',
    });

    const y0 = hd + H;
    const y1 = y0 + La;
    const y2 = y1 + Lb;
    const y3 = y2 + La;
    const y4 = y3 + Lb;

    add({
      id: 'roofS0',
      parent: 'left',
      poly: [[xL0, y0], [xL1, y0], [xL1, y1], [xL0, y1]],
      hingeOrigin: [cxL, y0],
      crease: [[xL0, y0], [xL1, y0]],
      hingeAxis: [1, 0],
      targetAngle: Math.PI * 0.5 - alpha,
      stage: 'roof',
      roofFrame: { origin: [cxL, y0], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: La },
      label: 'Sawtooth slope 1',
    });

    add({
      id: 'roofS1',
      parent: 'roofS0',
      poly: [[xL0, y1], [xL1, y1], [xL1, y2], [xL0, y2]],
      hingeOrigin: [cxL, y1],
      crease: [[xL0, y1], [xL1, y1]],
      hingeAxis: [1, 0],
      targetAngle: pleatTurn,
      stage: 'roof',
      hasRoofSkylights: true,
      roofFrame: { origin: [cxL, y1], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: Lb },
      label: 'North skylight 1',
    });

    add({
      id: 'roofS2',
      parent: 'roofS1',
      poly: [[xL0, y2], [xL1, y2], [xL1, y3], [xL0, y3]],
      hingeOrigin: [cxL, y2],
      crease: [[xL0, y2], [xL1, y2]],
      hingeAxis: [-1, 0],
      targetAngle: pleatTurn,
      stage: 'roof',
      isMountain: true,
      roofFrame: { origin: [cxL, y2], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: La },
      label: 'Sawtooth slope 2',
    });

    add({
      id: 'roofS3',
      parent: 'roofS2',
      poly: [[xL0, y3], [xL1, y3], [xL1, y4], [xL0, y4]],
      hingeOrigin: [cxL, y3],
      crease: [[xL0, y3], [xL1, y3]],
      hingeAxis: [1, 0],
      targetAngle: pleatTurn,
      stage: 'roof',
      hasRoofSkylights: true,
      roofFrame: { origin: [cxL, y3], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: Lb },
      label: 'North skylight 2',
    });

    return { roofRise: R, roofSlant: La };
  }

  // 4-sided pitched roofs on ribbon net: `hip`, `mansard`, `spire`
  const isMansard = roofType === 'mansard';
  const isSpire = roofType === 'spire';
  const run = isMansard ? minSpan * 0.5 * (1 - mansardRatio) : minSpan * 0.5;
  const hwTop = isSpire ? 0 : Math.max(0, hw - run);
  const hdTop = isSpire ? 0 : Math.max(0, hd - run);

  const R = run * Math.tan(pitch);
  const L = Math.hypot(run, R);
  const roofFold = Math.PI * 0.5 - pitch;

  add({
    id: 'back',
    parent: 'base',
    poly: [
      [xB0, hd],
      [xB1, hd],
      [xB1, hd + H],
      [xB0, hd + H],
    ],
    hingeOrigin: [0, hd],
    crease: [[xB0, hd], [xB1, hd]],
    hingeAxis: [1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: ribbonWallFrame(cxB, W, H),
    label: 'Back wall',
  });

  add({
    id: 'left',
    parent: 'back',
    poly: [
      [xL0, hd],
      [xL1, hd],
      [xL1, hd + H],
      [xL0, hd + H],
    ],
    hingeOrigin: [xL1, hd + H * 0.5],
    crease: [[xL1, hd], [xL1, hd + H]],
    hingeAxis: [0, 1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: ribbonWallFrame(cxL, D, H),
    label: 'Left wall',
  });

  add({
    id: 'right',
    parent: 'back',
    poly: [
      [xR0, hd],
      [xR1, hd],
      [xR1, hd + H],
      [xR0, hd + H],
    ],
    hingeOrigin: [xR0, hd + H * 0.5],
    crease: [[xR0, hd], [xR0, hd + H]],
    hingeAxis: [0, -1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: ribbonWallFrame(cxR, D, H),
    label: 'Right wall',
  });

  add({
    id: 'front',
    parent: 'right',
    poly: [
      [xF0, hd],
      [xF1, hd],
      [xF1, hd + H],
      [xF0, hd + H],
    ],
    hingeOrigin: [xF0, hd + H * 0.5],
    crease: [[xF0, hd], [xF0, hd + H]],
    hingeAxis: [0, -1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: ribbonWallFrame(cxF, W, H, true),
    isFront: true,
    label: 'Front wall',
  });

  const lip = isMansard ? 1.8 : 0;
  const Llip = L + lip;
  const hwTopLip = isMansard ? Math.max(2, hwTop - (lip / Math.max(L, 1)) * (hw - hwTop)) : hwTop;
  const hdTopLip = isMansard ? Math.max(2, hdTop - (lip / Math.max(L, 1)) * (hd - hdTop)) : hdTop;

  const trapOrTri = (x0: number, x1: number, topHalf: number, slant: number): V2[] => {
    const cx = (x0 + x1) * 0.5;
    const y0 = hd + H;
    return topHalf > 1e-3
      ? [
          [x0, y0],
          [x1, y0],
          [cx + topHalf, y0 + slant],
          [cx - topHalf, y0 + slant],
        ]
      : [
          [x0, y0],
          [x1, y0],
          [cx, y0 + slant],
        ];
  };

  add({
    id: 'roofB',
    parent: 'back',
    poly: trapOrTri(xB0, xB1, hwTop, L),
    hingeOrigin: [cxB, hd + H],
    crease: [[xB0, hd + H], [xB1, hd + H]],
    hingeAxis: [1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [cxB, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: W, slantMm: L },
    label: isSpire ? 'Back spire' : 'Back roof',
  });

  add({
    id: 'roofL',
    parent: 'left',
    poly: trapOrTri(xL0, xL1, isMansard ? hdTopLip : hdTop, isMansard ? Llip : L),
    hingeOrigin: [cxL, hd + H],
    crease: [[xL0, hd + H], [xL1, hd + H]],
    hingeAxis: [1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [cxL, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: L },
    label: isSpire ? 'Left spire' : 'Left roof',
  });

  add({
    id: 'roofR',
    parent: 'right',
    poly: trapOrTri(xR0, xR1, isMansard ? hdTopLip : hdTop, isMansard ? Llip : L),
    hingeOrigin: [cxR, hd + H],
    crease: [[xR0, hd + H], [xR1, hd + H]],
    hingeAxis: [1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [cxR, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: D, slantMm: L },
    label: isSpire ? 'Right spire' : 'Right roof',
  });

  add({
    id: 'roofF',
    parent: 'front',
    poly: trapOrTri(xF0, xF1, isMansard ? hwTopLip : hwTop, isMansard ? Llip : L),
    hingeOrigin: [cxF, hd + H],
    crease: [[xF0, hd + H], [xF1, hd + H]],
    hingeAxis: [1, 0],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [cxF, hd + H], ridgeAxis: [1, 0], slopeAxis: [0, 1], widthMm: W, slantMm: L },
    label: isSpire ? 'Front spire' : 'Front roof',
  });

  if (isMansard && hwTop > 1e-3 && hdTop > 1e-3) {
    const capY0 = hd + H + L;
    const capY1 = capY0 + hdTop * 2;
    add({
      id: 'roofCap',
      parent: 'roofB',
      poly: [
        [-hwTop, capY0],
        [hwTop, capY0],
        [hwTop, capY1],
        [-hwTop, capY1],
      ],
      hingeOrigin: [0, capY0],
      crease: [[-hwTop, capY0], [hwTop, capY0]],
      hingeAxis: [1, 0],
      targetAngle: pitch,
      stage: 'cap',
      label: 'Mansard deck',
    });
  }

  return { roofRise: R, roofSlant: L };
}

// ----------------------------------------------------------------------------
// Regular N-gon Radial Lotus Petal Net Builder (`hex` = 6 sides, `oct` = 8 sides!)
// ----------------------------------------------------------------------------
function buildPolygonPetalNet(
  spec: HouseNetSpec,
  sides: 6 | 8,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number; baseRadiusMm: number } {
  const { W, H, roofType, pitch, mansardRatio } = spec;
  const isCrowned = roofType === 'mansard' && mansardRatio > 0.05;
  const step = (Math.PI * 2) / sides;
  // Treat `W * 0.5` as the inradius (apothem `a`) so overall diameter matches rectangular houses!
  const a = W * 0.5;
  const hs = a * Math.tan(Math.PI / sides);
  const s = hs * 2;
  const circumR = a / Math.cos(Math.PI / sides);

  // Regular N-gon base vertices in strict CCW order (edge `k=0` faces front `-Y` sheet = `+Z` world!)
  const baseVerts: V2[] = [];
  for (let k = 0; k < sides; k++) {
    const phi = -Math.PI * 0.5 + k * step;
    const nx = Math.cos(phi);
    const ny = Math.sin(phi);
    const tx = -ny;
    const ty = nx;
    baseVerts.push([a * nx - hs * tx, a * ny - hs * ty]);
  }

  add({
    id: 'base',
    parent: null,
    poly: baseVerts,
    hingeOrigin: [0, 0],
    crease: null,
    hingeAxis: [1, 0],
    targetAngle: 0,
    stage: 'base',
    label: 'Floor',
  });

  const run = isCrowned ? a * (1 - mansardRatio) : a;
  const aTop = isCrowned ? a * mansardRatio : 0;
  const hsTop = isCrowned ? hs * mansardRatio : 0;
  const R = run * Math.tan(pitch);
  const L = Math.hypot(run, R);
  const roofFold = Math.PI * 0.5 - pitch;
  const capHostIdx = sides / 2; // Straight back (`phi = +pi/2`, `+Y` sheet) carries the hinged N-gon crown cap!

  const lip = isCrowned ? 1.5 : 0;
  const Llip = L + lip;
  const hsTopLip = isCrowned ? Math.max(1.5, hsTop - (lip / Math.max(L, 1)) * (hs - hsTop)) : 0;

  for (let k = 0; k < sides; k++) {
    const phi = -Math.PI * 0.5 + k * step;
    const nx = Math.cos(phi);
    const ny = Math.sin(phi);
    const tx = -ny;
    const ty = nx;
    // Universal outward crease axis: `[+sin(phi), -cos(phi)]` folds `+90°` straight UP for any angle!
    const hingeAxis: V2 = [ny, -nx];

    const v0 = baseVerts[k];
    const v1 = baseVerts[(k + 1) % sides];
    const e0: V2 = [v0[0] + H * nx, v0[1] + H * ny];
    const e1: V2 = [v1[0] + H * nx, v1[1] + H * ny];
    const mBase: V2 = [a * nx, a * ny];
    const mEave: V2 = [(a + H) * nx, (a + H) * ny];

    const wallId = `wall${k}`;
    const roofId = `roof${k}`;

    add({
      id: wallId,
      parent: 'base',
      poly: [v0, v1, e1, e0],
      hingeOrigin: mBase,
      crease: [v0, v1],
      hingeAxis,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: {
        origin: mBase,
        uAxis: [tx, ty],
        vAxis: [nx, ny],
        widthMm: s,
        heightMm: H,
      },
      isFront: k === 0,
      label: k === 0 ? 'Front wall' : `Wall ${k + 1}`,
    });

    const isCapHost = isCrowned && k === capHostIdx;
    const petalSlant = isCrowned && !isCapHost ? Llip : L;
    const petalTopHalf = isCrowned ? (isCapHost ? hsTop : hsTopLip) : 0;

    const roofPoly: V2[] =
      petalTopHalf > 1e-3
        ? [
            e0,
            e1,
            [mEave[0] + petalSlant * nx + petalTopHalf * tx, mEave[1] + petalSlant * ny + petalTopHalf * ty],
            [mEave[0] + petalSlant * nx - petalTopHalf * tx, mEave[1] + petalSlant * ny - petalTopHalf * ty],
          ]
        : [
            e0,
            e1,
            [mEave[0] + L * nx, mEave[1] + L * ny],
          ];

    add({
      id: roofId,
      parent: wallId,
      poly: roofPoly,
      hingeOrigin: mEave,
      crease: [e0, e1],
      hingeAxis,
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: {
        origin: mEave,
        ridgeAxis: [tx, ty],
        slopeAxis: [nx, ny],
        widthMm: s,
        slantMm: L,
      },
      label: isCrowned ? `Crown petal ${k + 1}` : `Spire petal ${k + 1}`,
    });
  }

  // Regular N-gon crown deck hinged cleanly onto the back petal (`roof{sides/2}`)!
  if (isCrowned && aTop > 1e-3) {
    const capY0 = a + H + L;
    const capCenterY = capY0 + aTop;
    const capVerts: V2[] = [];
    for (let k = 0; k < sides; k++) {
      const phi = -Math.PI * 0.5 + k * step;
      const nx = Math.cos(phi);
      const ny = Math.sin(phi);
      const tx = -ny;
      const ty = nx;
      capVerts.push([aTop * nx - hsTop * tx, capCenterY + aTop * ny - hsTop * ty]);
    }
    add({
      id: 'roofCap',
      parent: `roof${capHostIdx}`,
      poly: capVerts,
      hingeOrigin: [0, capY0],
      crease: [[-hsTop, capY0], [hsTop, capY0]],
      hingeAxis: [1, 0],
      targetAngle: pitch,
      stage: 'cap',
      label: sides === 6 ? 'Hexagon deck' : 'Octagon deck',
    });
  }

  return { roofRise: R, roofSlant: L, baseRadiusMm: circumR };
}

// ----------------------------------------------------------------------------
// Setback / Stepped Tower Net Builder (`wall -> terrace -> MOUNTAIN upperWall -> roof [-> roofCap]`)
// True 4-to-5-hinges-deep duplex origami combining valley AND reverse mountain creases!
// ----------------------------------------------------------------------------
function buildSetbackTowerNet(
  spec: HouseNetSpec,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number; baseRadiusMm: number } {
  const { W, H, roofType, pitch, mansardRatio } = spec;
  const hw = W * 0.5;
  const H1 = H * 0.50;
  const H2 = H - H1;
  const W2 = W * 0.56;
  const hw2 = W2 * 0.5;
  const step = hw - hw2;
  const isCrowned = roofType === 'mansard' && mansardRatio > 0.05;

  add({
    id: 'base',
    parent: null,
    poly: [
      [-hw, -hw],
      [hw, -hw],
      [hw, hw],
      [-hw, hw],
    ],
    hingeOrigin: [0, 0],
    crease: null,
    hingeAxis: [1, 0],
    targetAngle: 0,
    stage: 'base',
    label: 'Floor',
  });

  const run = isCrowned ? hw2 * (1 - mansardRatio) : hw2;
  const hwTop = isCrowned ? hw2 * mansardRatio : 0;
  const R2 = run * Math.tan(pitch);
  const L2 = Math.hypot(run, R2);
  const roofFold = Math.PI * 0.5 - pitch;
  const lip = isCrowned ? 1.5 : 0;
  const Llip = L2 + lip;
  const hwTopLip = isCrowned ? Math.max(1.5, hwTop - (lip / Math.max(L2, 1)) * (hw2 - hwTop)) : 0;

  // 4 cardinal arms: k = 0 front (-Y), k = 1 right (+X), k = 2 back (+Y), k = 3 left (-X)
  const arms: Array<{ id: string; nx: number; ny: number; isFront?: boolean; name: string }> = [
    { id: '0', nx: 0, ny: -1, isFront: true, name: 'Front' },
    { id: '1', nx: 1, ny: 0, name: 'Right' },
    { id: '2', nx: 0, ny: 1, name: 'Back' },
    { id: '3', nx: -1, ny: 0, name: 'Left' },
  ];

  for (const arm of arms) {
    const { nx, ny } = arm;
    const tx = -ny;
    const ty = nx;
    const valleyAxis: V2 = [ny, -nx];
    const mountainAxis: V2 = [-ny, nx];
    const pt = (r: number, u: number): V2 => [r * nx + u * tx, r * ny + u * ty];

    const r0 = hw;
    const r1 = r0 + H1;
    const r2 = r1 + step;
    const r3 = r2 + H2;

    const wallId = `wall${arm.id}`;
    const terraceId = `terrace${arm.id}`;
    const upperId = `upper${arm.id}`;
    const roofId = `roof${arm.id}`;

    // Stage 1: Ground wall (+90° valley)
    add({
      id: wallId,
      parent: 'base',
      poly: [pt(r0, -hw), pt(r0, hw), pt(r1, hw), pt(r1, -hw)],
      hingeOrigin: pt(r0, 0),
      crease: [pt(r0, -hw), pt(r0, hw)],
      hingeAxis: valleyAxis,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      wallFrame: {
        origin: pt(r0, 0),
        uAxis: [tx, ty],
        vAxis: [nx, ny],
        widthMm: W,
        heightMm: H1,
        wallLevels: H1 >= 25 ? 2 : 1,
      },
      isFront: arm.isFront,
      label: `${arm.name} podium`,
    });

    // Stage 2: Mitered horizontal setback terrace ledge (+90° valley inward)
    add({
      id: terraceId,
      parent: wallId,
      poly: [pt(r1, -hw), pt(r1, hw), pt(r2, hw2), pt(r2, -hw2)],
      hingeOrigin: pt(r1, 0),
      crease: [pt(r1, -hw), pt(r1, hw)],
      hingeAxis: valleyAxis,
      targetAngle: Math.PI * 0.5,
      stage: 'terrace',
      label: `${arm.name} terrace`,
    });

    // Stage 3: Narrower upper tower wall (-90° MOUNTAIN fold back straight UP!)
    add({
      id: upperId,
      parent: terraceId,
      poly: [pt(r2, -hw2), pt(r2, hw2), pt(r3, hw2), pt(r3, -hw2)],
      hingeOrigin: pt(r2, 0),
      crease: [pt(r2, -hw2), pt(r2, hw2)],
      hingeAxis: mountainAxis,
      targetAngle: Math.PI * 0.5,
      stage: 'upperWall',
      isMountain: true,
      wallFrame: {
        origin: pt(r2, 0),
        uAxis: [tx, ty],
        vAxis: [nx, ny],
        widthMm: W2,
        heightMm: H2,
        wallLevels: H2 >= 24 ? 2 : 1,
      },
      label: `${arm.name} tower`,
    });

    // Stage 4: Upper spire petal or crowned mansard roof (+(90° - pitch) valley)
    const isCapHost = isCrowned && arm.id === '2';
    const slant = isCrowned && !isCapHost ? Llip : L2;
    const topHalf = isCrowned ? (isCapHost ? hwTop : hwTopLip) : 0;

    const roofPoly: V2[] =
      topHalf > 1e-3
        ? [pt(r3, -hw2), pt(r3, hw2), pt(r3 + slant, topHalf), pt(r3 + slant, -topHalf)]
        : [pt(r3, -hw2), pt(r3, hw2), pt(r3 + L2, 0)];

    add({
      id: roofId,
      parent: upperId,
      poly: roofPoly,
      hingeOrigin: pt(r3, 0),
      crease: [pt(r3, -hw2), pt(r3, hw2)],
      hingeAxis: valleyAxis,
      targetAngle: roofFold,
      stage: 'roof',
      roofFrame: {
        origin: pt(r3, 0),
        ridgeAxis: [tx, ty],
        slopeAxis: [nx, ny],
        widthMm: W2,
        slantMm: L2,
      },
      label: isCrowned ? `${arm.name} crown` : `${arm.name} spire`,
    });
  }

  // Stage 5 (5 hinges deep!): Hinged skylight deck on back arm (`roof2`) for crowned setback pagoda!
  if (isCrowned && hwTop > 1e-3) {
    const capY0 = hw + H1 + step + H2 + L2;
    const capY1 = capY0 + hwTop * 2;
    add({
      id: 'roofCap',
      parent: 'roof2',
      poly: [
        [-hwTop, capY0],
        [hwTop, capY0],
        [hwTop, capY1],
        [-hwTop, capY1],
      ],
      hingeOrigin: [0, capY0],
      crease: [[-hwTop, capY0], [hwTop, capY0]],
      hingeAxis: [1, 0],
      targetAngle: pitch,
      stage: 'cap',
      label: 'Crown deck',
    });
  }

  return { roofRise: R2, roofSlant: L2, baseRadiusMm: hw * Math.SQRT2 };
}

// ----------------------------------------------------------------------------
// L-Shaped Compound Villa Net Builder (main gable house + sloping side wing + MOUNTAIN inside corner!)
// ----------------------------------------------------------------------------
function buildLWingNet(
  spec: HouseNetSpec,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number; baseRadiusMm: number } {
  const { W, D, H, pitch } = spec;
  const hw = W * 0.5;
  const hd = D * 0.5;
  const Ww = W * 0.62;
  const Dw = D * 0.52;
  const Hw = H * 0.66;
  const ySplit = -hd + Dw;
  const remD = hd - ySplit;

  // Center the asymmetric L-footprint cleanly around (0, 0) for balanced 360° orbit!
  const ox = Ww * 0.22;
  const x0 = -hw - ox;
  const x1 = hw - ox;
  const x2 = hw + Ww - ox;
  const cxMain = -ox;

  const R = hw * Math.tan(pitch);
  const L = Math.hypot(hw, R);
  const roofFold = Math.PI * 0.5 - pitch;

  const wingRise = H - Hw;
  const wingPitch = Math.atan2(wingRise, Ww);
  const wingSlant = Math.hypot(Ww, wingRise);
  const wingRoofFold = Math.PI * 0.5 - wingPitch;

  // 1. Single unbroken 6-vertex L-shaped floor (`base`)
  add({
    id: 'base',
    parent: null,
    poly: [
      [x0, -hd],
      [x2, -hd],
      [x2, ySplit],
      [x1, ySplit],
      [x1, hd],
      [x0, hd],
    ],
    hingeOrigin: [0, 0],
    crease: null,
    hingeAxis: [1, 0],
    targetAngle: 0,
    stage: 'base',
    label: 'L-floor',
  });

  // 2. Main house front gable (`-Y`) & back gable (`+Y`)
  add({
    id: 'front',
    parent: 'base',
    poly: [
      [x0, -hd],
      [x0, -(hd + H)],
      [cxMain, -(hd + H + R)],
      [x1, -(hd + H)],
      [x1, -hd],
    ],
    hingeOrigin: [cxMain, -hd],
    crease: [[x0, -hd], [x1, -hd]],
    hingeAxis: [-1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: { origin: [cxMain, -hd], uAxis: [1, 0], vAxis: [0, -1], widthMm: W, heightMm: H },
    isFront: true,
    isGableEnd: true,
    label: 'Main front gable',
  });

  add({
    id: 'back',
    parent: 'base',
    poly: [
      [x0, hd],
      [x1, hd],
      [x1, hd + H],
      [cxMain, hd + H + R],
      [x0, hd + H],
    ],
    hingeOrigin: [cxMain, hd],
    crease: [[x0, hd], [x1, hd]],
    hingeAxis: [1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: { origin: [cxMain, hd], uAxis: [1, 0], vAxis: [0, 1], widthMm: W, heightMm: H },
    isGableEnd: true,
    label: 'Main back gable',
  });

  // 3. Main left wall + continuous 2-panel waterfall gable roof (`roofL` -> ridge hinge `roofR`!)
  add({
    id: 'left',
    parent: 'base',
    poly: [
      [x0 - H, -hd],
      [x0, -hd],
      [x0, hd],
      [x0 - H, hd],
    ],
    hingeOrigin: [x0, 0],
    crease: [[x0, -hd], [x0, hd]],
    hingeAxis: [0, 1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: { origin: [x0, 0], uAxis: [0, 1], vAxis: [-1, 0], widthMm: D, heightMm: H },
    label: 'Left wall',
  });

  add({
    id: 'roofL',
    parent: 'left',
    poly: [
      [x0 - H - L, -hd],
      [x0 - H, -hd],
      [x0 - H, hd],
      [x0 - H - L, hd],
    ],
    hingeOrigin: [x0 - H, 0],
    crease: [[x0 - H, -hd], [x0 - H, hd]],
    hingeAxis: [0, 1],
    targetAngle: roofFold,
    stage: 'roof',
    roofFrame: { origin: [x0 - H, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: L },
    label: 'Main left roof',
  });

  // `roofR` hinges right off `roofL`'s ridge (+2*pitch valley!) to drape cleanly over the L-junction!
  add({
    id: 'roofR',
    parent: 'roofL',
    poly: [
      [x0 - H - 2 * L, -hd],
      [x0 - H - L, -hd],
      [x0 - H - L, hd],
      [x0 - H - 2 * L, hd],
    ],
    hingeOrigin: [x0 - H - L, 0],
    crease: [[x0 - H - L, -hd], [x0 - H - L, hd]],
    hingeAxis: [0, 1],
    targetAngle: 2 * pitch,
    stage: 'cap',
    roofFrame: { origin: [x0 - H - L, 0], ridgeAxis: [0, 1], slopeAxis: [-1, 0], widthMm: D, slantMm: L },
    label: 'Main right roof',
  });

  // 4. Side studio wing front wall (sloped trapezoid flush from `H` at main block down to `Hw` at wing end!)
  add({
    id: 'wingFront',
    parent: 'base',
    poly: [
      [x1, -hd],
      [x1, -(hd + H)],
      [x2, -(hd + Hw)],
      [x2, -hd],
    ],
    hingeOrigin: [(x1 + x2) * 0.5, -hd],
    crease: [[x1, -hd], [x2, -hd]],
    hingeAxis: [-1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: {
      origin: [(x1 + x2) * 0.5, -hd],
      uAxis: [1, 0],
      vAxis: [0, -1],
      widthMm: Ww,
      heightMm: Hw,
      wallLevels: 1,
    },
    label: 'Wing front wall',
  });

  // 5. Side wing outer end wall + shed roof sloping right up to the main block's eave at `(x1, H)`!
  add({
    id: 'wingEnd',
    parent: 'base',
    poly: [
      [x2, -hd],
      [x2 + Hw, -hd],
      [x2 + Hw, ySplit],
      [x2, ySplit],
    ],
    hingeOrigin: [x2, (-hd + ySplit) * 0.5],
    crease: [[x2, -hd], [x2, ySplit]],
    hingeAxis: [0, -1],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: {
      origin: [x2, (-hd + ySplit) * 0.5],
      uAxis: [0, 1],
      vAxis: [1, 0],
      widthMm: Dw,
      heightMm: Hw,
      wallLevels: 1,
    },
    label: 'Wing end wall',
  });

  add({
    id: 'wingRoof',
    parent: 'wingEnd',
    poly: [
      [x2 + Hw, -hd],
      [x2 + Hw + wingSlant, -hd],
      [x2 + Hw + wingSlant, ySplit],
      [x2 + Hw, ySplit],
    ],
    hingeOrigin: [x2 + Hw, (-hd + ySplit) * 0.5],
    crease: [[x2 + Hw, -hd], [x2 + Hw, ySplit]],
    hingeAxis: [0, -1],
    targetAngle: wingRoofFold,
    stage: 'roof',
    roofFrame: {
      origin: [x2 + Hw, (-hd + ySplit) * 0.5],
      ridgeAxis: [0, -1],
      slopeAxis: [1, 0],
      widthMm: Dw,
      slantMm: wingSlant,
    },
    label: 'Wing roof',
  });

  // 6. Wing back wall wraps around outer wing corner (+90° valley off `wingEnd`), climbing from `Hw` to `H`
  add({
    id: 'wingBack',
    parent: 'wingEnd',
    poly: [
      [x2, ySplit],
      [x2 + Hw, ySplit],
      [x2 + H, ySplit + Ww],
      [x2, ySplit + Ww],
    ],
    hingeOrigin: [x2 + Hw * 0.5, ySplit],
    crease: [[x2, ySplit], [x2 + Hw, ySplit]],
    hingeAxis: [1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    wallFrame: {
      origin: [x2, ySplit + Ww * 0.5],
      uAxis: [0, 1],
      vAxis: [1, 0],
      widthMm: Ww,
      heightMm: Hw,
      wallLevels: 1,
    },
    label: 'Wing back wall',
  });

  // 7. Re-entrant courtyard right wall of main house: TRUE -90° MOUNTAIN FOLD off `wingBack`!
  //    Folds outward around the concave L-corner so pastel exterior stays continuous with ZERO sheet collision!
  add({
    id: 'rightLower',
    parent: 'wingBack',
    poly: [
      [x2, ySplit + Ww],
      [x2 + H, ySplit + Ww],
      [x2 + H, ySplit + Ww + remD],
      [x2, ySplit + Ww + remD],
    ],
    hingeOrigin: [x2 + H * 0.5, ySplit + Ww],
    crease: [[x2, ySplit + Ww], [x2 + H, ySplit + Ww]],
    hingeAxis: [-1, 0],
    targetAngle: Math.PI * 0.5,
    stage: 'wall',
    isMountain: true,
    wallFrame: {
      origin: [x2, ySplit + Ww + remD * 0.5],
      uAxis: [0, 1],
      vAxis: [1, 0],
      widthMm: remD,
      heightMm: H,
    },
    label: 'Courtyard wall',
  });

  const maxR = Math.max(Math.hypot(x0, hd), Math.hypot(x2, -hd), Math.hypot(x2, ySplit));
  return { roofRise: R, roofSlant: L, baseRadiusMm: maxR };
}

// ----------------------------------------------------------------------------
// Parametric Single-Cutout Wall-to-Wall Composite House Builder (`topology: 'village'`)
// Presses ANY 2, 3, or 4 watertight ribbon buildings FLUSH WALL-TO-WALL (no courtyard, no bridges!)
// into ONE monumental composite house cut from ONE SINGLE UNBROKEN FLAT SHEET:
//   - `b2` (Left, +90° -> unfolds WEST), `b0` (Center-Left, 0° -> unfolds NORTH),
//     `b1` (Center-Right, 180° -> unfolds SOUTH), `b3` (Right, -90° -> unfolds EAST).
//   - Guaranteed >= 4.5 mm flat-sheet clearance across ALL 8 roof types & 5 gable ceilings!
//   - Automatically suppresses openings on shared interior walls & aligns front doors to street (+Z).
// ----------------------------------------------------------------------------
function buildVillageNet(
  spec: HouseNetSpec,
  add: (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => void,
): { roofRise: number; roofSlant: number; baseRadiusMm: number; foldedHeightMm: number } {
  const vcfg = spec.village ?? {
    count: spec.label === 'Composite estate' || spec.label === 'Coastal village' ? 4 : 3,
    seed: 0,
    mainRoof: spec.roofType,
  };
  const count = vcfg.count;
  const isCurated = vcfg.seed === 0;
  const isEstate4 = isCurated && count === 4;

  const baseCommon = {
    generation: spec.generation,
    topology: 'ribbon' as const,
    mansardRatio: 0,
    parapetH: 0,
    hasOculus: false,
    hasBelfry: false,
    hasAwning: false,
    hasChimney: false,
    dormerCount: 0 as const,
    yawOffset: 0,
    outsideColor: spec.outsideColor,
  };

  const villageConsistency = Math.max(0, Math.min(1, vcfg.consistency ?? spec.consistency ?? 0.72));
  const vGrammar = vcfg.grammar ?? {};

  const attachSubArchitecture = (sub: HouseNetSpec, subSeed: number, sharedWin?: WindowStyle, sharedDoor?: DoorStyle): HouseNetSpec => {
    const heightMult =
      vGrammar.heightScale !== undefined && vGrammar.heightScale !== null
        ? Math.max(0.75, Math.min(1.25, vGrammar.heightScale))
        : 1.0;
    const H = sub.H * heightMult;
    const levels: 1 | 2 | 3 = vGrammar.levels ?? sub.levels;
    const windowGround: WindowStyle = vGrammar.windowStyle ?? sharedWin ?? sub.windowGround;
    const windowUpper: WindowStyle = vGrammar.windowStyle ?? sharedWin ?? sub.windowUpper;
    const door: DoorStyle = vGrammar.doorStyle ?? sharedDoor ?? sub.door;
    const hasAwning = door === 'none' || door === 'arcade' ? false : sub.hasAwning;
    const gableProfile: GableProfile =
      sub.roofType === 'gable' ? (vGrammar.gableProfile ?? sub.gableProfile ?? 'classic') : 'classic';
    const hasChimney = gableProfile === 'stepped' ? false : sub.hasChimney;
    const dormerCount = gableProfile === 'stepped' || gableProfile === 'barrel' ? 0 : sub.dormerCount;
    const arch = buildBuildingArchitecture({
      topology: 'ribbon',
      widthMm: sub.W,
      depthMm: sub.D,
      heightMm: H,
      levels,
      yawOffset: 0,
      roofType: sub.roofType,
      gableProfile,
      pitch: sub.pitch,
      mansardRatio: sub.mansardRatio,
      parapetH: sub.parapetH,
      windowGround,
      windowUpper,
      door,
      hasOculus: sub.hasOculus,
      hasBelfry: sub.hasBelfry,
      hasAwning,
      hasChimney,
      dormerCount,
      seed: subSeed,
      consistency: villageConsistency,
      windowCount: vGrammar.windowCount ?? 'auto',
      windowOpening: vGrammar.windowOpening ?? null,
      windowDetail: vGrammar.windowDetail ?? null,
    });
    return {
      ...sub,
      H,
      levels,
      gableProfile,
      windowGround,
      windowUpper,
      door,
      hasAwning,
      hasChimney,
      dormerCount,
      consistency: villageConsistency,
      architecture: arch,
    };
  };

  const makeCompositeSubSpec = (
    rng: ReturnType<typeof makeRng>,
    role: 'centerL' | 'centerR' | 'wingL' | 'wingR',
    roofType: RoofType,
    W: number,
    D: number,
    sharedWin?: WindowStyle,
    sharedDoor?: DoorStyle,
  ): HouseNetSpec => {
    const winPool: WindowStyle[] =
      villageConsistency < 0.65
        ? ['rect', 'arched', 'tall', 'ribbon', 'round', 'lancet', 'slit', 'pair']
        : ['rect', 'arched', 'tall', 'ribbon'];
    const doorPool: DoorStyle[] = ['arched', 'rect', 'double'];
    const isTower = roofType === 'spire';
    const isMain = role === 'centerL';

    const H = isTower
      ? rng.range(28, 35)
      : isMain
        ? rng.range(24, 30)
        : role === 'centerR'
          ? rng.range(18, 25)
          : rng.range(16, 23);

    const levels: 1 | 2 | 3 = H >= 29 ? 3 : H >= 20 ? 2 : 1;
    const pitch =
      roofType === 'spire'
        ? rng.range(1.08, 1.20)
        : roofType === 'mansard'
          ? rng.range(1.02, 1.14)
          : roofType === 'sawtooth'
            ? rng.range(0.42, 0.52)
            : roofType === 'butterfly'
              ? rng.range(0.28, 0.36)
              : roofType === 'shed'
                ? rng.range(0.30, 0.38)
                : roofType === 'hip'
                  ? rng.range(0.58, 0.72)
                  : roofType === 'flat'
                    ? 0
                    : rng.range(0.70, 0.86);

    const useSharedStyle = sharedWin !== undefined && rng.chance(villageConsistency * 0.92);
    const wGround = useSharedStyle ? sharedWin : rng.pick(winPool);
    const wUpper = useSharedStyle ? sharedWin : rng.pick(['rect', 'tall', 'ribbon', 'round', 'lancet'] as const);
    const dStyle = sharedDoor !== undefined && rng.chance(villageConsistency * 0.88) ? sharedDoor : rng.pick(doorPool);
    const subGableProfile: GableProfile =
      roofType === 'gable' ? (vGrammar.gableProfile ?? rng.pick(ALL_GABLE_PROFILES)) : 'classic';

    return {
      ...baseCommon,
      label:
        role === 'centerL'
          ? 'Main hall'
          : role === 'centerR'
            ? 'Center annex'
            : role === 'wingL'
              ? 'West wing'
              : 'East tower',
      W,
      D,
      H,
      levels,
      roofType,
      gableProfile: subGableProfile,
      pitch,
      mansardRatio: roofType === 'mansard' ? 0.48 : 0,
      parapetH: roofType === 'flat' ? 2.8 : 0,
      windowGround: wGround,
      windowUpper: wUpper,
      door: dStyle,
      hasOculus: roofType === 'gable' && rng.chance(0.8),
      hasBelfry: roofType === 'spire' && H >= 28,
      hasAwning: roofType !== 'spire' && rng.chance(0.75),
      hasChimney:
        subGableProfile !== 'stepped' &&
        (roofType === 'gable' || roofType === 'mansard' || roofType === 'hip' || roofType === 'flat') &&
        rng.chance(0.75),
      dormerCount:
        (roofType === 'mansard' || (roofType === 'gable' && subGableProfile !== 'stepped' && subGableProfile !== 'barrel')) &&
        isMain
          ? 1
          : 0,
    };
  };

  interface CompositeVolume {
    prefix: string;
    islandIdx: number;
    colorSlot: 0 | 1 | 2 | 3;
    rot: number;
    tx: number;
    ty: number;
    worldW: number;
    worldD: number;
    subSpec: HouseNetSpec;
  }

  // Tight flush wall-to-wall seam (`0.72 mm`): adjacent folded walls kiss with zero Z-fighting
  // while keeping the floor weld strip area strictly `> 10 mm²` (`>= 14.5 mm` overlap) as ONE single cutout!
  const SEAM = 0.72;
  const GAP = 2.0;
  const vrng = makeRng((isCurated ? (isEstate4 ? 404 : 303) : vcfg.seed * 6151) + 104729);

  // Pick companion roof types FIRST so any `spire` wing can lock `W === D` for exact 0.0000 mm apex closure
  // and the 4-compass floor-edge invariants hold mathematically across every seed and roof mix!
  const mainPool: RoofType[] = ['mansard', 'gable', 'hip', 'sawtooth', 'butterfly', 'flat', 'shed'];
  const annexPool: RoofType[] = ['shed', 'butterfly', 'gable', 'flat', 'hip', 'sawtooth', 'mansard'];
  const towerPool: RoofType[] = ['spire', 'mansard', 'gable', 'flat', 'hip'];

  let roof0: RoofType;
  let roof1: RoofType;
  let roof2: RoofType;
  let roof3: RoofType;
  let sharedWin: WindowStyle | undefined;
  let sharedDoor: DoorStyle | undefined;

  if (isCurated) {
    roof0 = isEstate4 ? 'gable' : 'mansard';
    roof1 = 'gable';
    roof2 = 'shed';
    roof3 = isEstate4 ? 'spire' : 'shed';
  } else {
    roof0 = vcfg.mainRoof ?? vrng.pick(mainPool);
    const pickCompanionRoof = (pool: RoofType[], used: RoofType[]): RoofType => {
      if (villageConsistency >= 0.88 && vrng.chance((villageConsistency - 0.80) * 4.5)) {
        return roof0;
      }
      const fresh = pool.filter((r) => !used.includes(r));
      return vrng.pick(fresh.length > 0 ? fresh : pool);
    };
    const usedRoofs: RoofType[] = [roof0];
    roof1 = pickCompanionRoof(annexPool, usedRoofs);
    usedRoofs.push(roof1);
    roof2 = pickCompanionRoof(annexPool, usedRoofs);
    usedRoofs.push(roof2);
    roof3 = villageConsistency >= 0.94 ? roof0 : pickCompanionRoof(towerPool, usedRoofs);

    const sharedWinPool: WindowStyle[] =
      villageConsistency < 0.65
        ? ['rect', 'arched', 'tall', 'ribbon', 'round', 'lancet', 'slit', 'pair']
        : ['rect', 'arched', 'tall', 'ribbon'];
    sharedWin = vGrammar.windowStyle ?? vrng.pick(sharedWinPool);
    sharedDoor = vGrammar.doorStyle ?? vrng.pick(['arched', 'rect', 'double'] as const);
  }

  let W0: number, D0: number, W1: number, D1: number, W2: number, D2: number, W3: number, D3: number;
  let ty0 = 0;
  let ty1 = 0;
  let ty2 = 0;
  let ty3 = 0;

  if (isCurated) {
    if (isEstate4) {
      // 4-wing flush composite estate (`[shed] | [stepped 3x] | [gambrel 2x] | [square spire]`)
      W0 = 24;
      D0 = 22;
      W1 = 24;
      D1 = 22;
      W2 = 22;
      D2 = 25;
      W3 = 25;
      D3 = 25; // strictly square for 0.0000 mm spire apex!
      ty0 = 2.5;
      ty1 = -2.5;
      ty2 = 1.0;
      ty3 = 0.0;
    } else {
      // 3-wing flush composite manor (`[shed] | [mansard] | [gambrel 2x]`)
      W0 = 26;
      D0 = 22;
      W1 = 24;
      D1 = 22;
      W2 = 23;
      D2 = 25;
      W3 = 23;
      D3 = 25;
      ty0 = 2.5;
      ty1 = -2.5;
      ty2 = 1.0;
      ty3 = 0.0;
    }
  } else {
    D0 = Math.round(vrng.range(22, 23));
    D1 = Math.round(vrng.range(22, 23));
    W0 = roof0 === 'spire' ? D0 : Math.round(vrng.range(count >= 3 ? 22 : 24, count >= 3 ? 25 : 30));
    W1 = roof1 === 'spire' ? D1 : Math.round(vrng.range(count >= 3 ? 22 : 22, count >= 3 ? 25 : 28));
    if (count >= 3 && Math.abs(W0 - W1) > 2) {
      if (roof0 !== 'spire') {
        W0 = Math.max(W1 - 2, Math.min(W1 + 2, W0));
      } else if (roof1 !== 'spire') {
        W1 = Math.max(W0 - 2, Math.min(W0 + 2, W1));
      }
    }

    // Exact X-clearance bounds so b2_ribbon (-X) and b3_ribbon (+X) strictly clear b0_ribbon & b1_ribbon
    const minD2 = Math.ceil(Math.max(D0 - SEAM, W1 + D1 - W0 - 2 * SEAM) + GAP);
    const minD3 = Math.ceil(Math.max(D0 + W0 - W1 - 2 * SEAM, D1 - SEAM) + GAP);
    D2 = roof2 === 'spire' ? minD2 : Math.round(Math.max(minD2, vrng.range(minD2, minD2 + 3)));
    D3 = roof3 === 'spire' ? minD3 : Math.round(Math.max(minD3, vrng.range(minD3, minD3 + 3)));
    W2 = roof2 === 'spire' ? D2 : Math.round(vrng.range(20, 24));
    W3 = roof3 === 'spire' ? D3 : Math.round(vrng.range(20, 24));

    // Exact Floor-Edge Invariant:
    //   yTop0 >= max(yTop1, yTop2, yTop3) + 0.5   (every floor clears b0's North ribbon)
    //   yBot1 <= min(yBot0, yBot2, yBot3) - 0.5   (every floor clears b1's South ribbon)
    //   shared wall Y-overlaps >= 14.5 mm         (seam area >= 0.72 * 14.1 > 10 mm²)
    const avgD01 = (D0 + D1) * 0.5;
    const reqWingW = Math.max(count >= 3 ? W2 : 0, count >= 4 ? W3 : 0);
    const minS = Math.max(Math.abs(D0 - D1) * 0.5 + 1.0, reqWingW > 0 ? reqWingW + 1.2 - avgD01 : 1.0);
    const maxS = Math.max(minS, avgD01 - 14.5);
    const desiredS =
      count === 2
        ? vrng.range(1.6, Math.min(4.8, maxS))
        : minS + (1 - villageConsistency * 0.55) * (maxS - minS) * vrng.next();
    const S = Math.max(minS, Math.min(maxS, desiredS));
    ty0 = S * 0.5;
    ty1 = -S * 0.5;

    const yTop0 = ty0 + D0 * 0.5;
    const yBot0 = ty0 - D0 * 0.5;
    const yTop1 = ty1 + D1 * 0.5;
    const yBot1 = ty1 - D1 * 0.5;

    let lo2 = Math.max(yBot1 + 0.5 + W2 * 0.5, yBot0 + 14.5 - W2 * 0.5);
    const hi2 = yTop0 - 0.5 - W2 * 0.5;
    lo2 = Math.min(lo2, hi2);
    ty2 = lo2 + (hi2 - lo2) * vrng.range(0.25, 0.85);

    const lo3 = yBot1 + 0.5 + W3 * 0.5;
    let hi3 = Math.min(yTop0 - 0.5 - W3 * 0.5, yTop1 - 14.5 + W3 * 0.5);
    hi3 = Math.max(lo3, hi3);
    ty3 = lo3 + (hi3 - lo3) * vrng.range(0.15, 0.75);
  }

  let sub0: HouseNetSpec;
  let sub1: HouseNetSpec;
  let sub2: HouseNetSpec;
  let sub3: HouseNetSpec;

  if (isCurated) {
    if (isEstate4) {
      sub0 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'Stepped manor',
          W: W0,
          D: D0,
          H: 26,
          levels: 2,
          roofType: 'gable',
          gableProfile: 'stepped',
          pitch: 0.78,
          windowGround: 'arched',
          windowUpper: 'rect',
          door: 'arched',
          hasOculus: true,
          hasAwning: true,
        },
        (spec.generation * 3137 + 17) >>> 0,
      );
      sub1 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'Gambrel wing',
          W: W1,
          D: D1,
          H: 20,
          levels: 2,
          roofType: 'gable',
          gableProfile: 'gambrel',
          pitch: 0.74,
          windowGround: 'rect',
          windowUpper: 'rect',
          door: 'double',
          hasOculus: true,
          hasAwning: true,
          hasChimney: true,
        },
        (spec.generation * 3137 + 1008) >>> 0,
      );
      sub2 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'Studio loft wing',
          W: W2,
          D: D2,
          H: 18,
          levels: 1,
          roofType: 'shed',
          pitch: 0.34,
          windowGround: 'ribbon',
          windowUpper: 'rect',
          door: 'rect',
          hasAwning: true,
        },
        (spec.generation * 3137 + 1999) >>> 0,
      );
      sub3 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'Corner tower',
          W: W3,
          D: D3,
          H: 30,
          levels: 2,
          roofType: 'spire',
          pitch: 1.12,
          windowGround: 'arched',
          windowUpper: 'tall',
          door: 'arched',
          hasBelfry: true,
        },
        (spec.generation * 3137 + 2990) >>> 0,
      );
    } else {
      sub0 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'Central mansard',
          W: W0,
          D: D0,
          H: 26,
          levels: 2,
          roofType: 'mansard',
          pitch: 1.08,
          mansardRatio: 0.48,
          windowGround: 'arched',
          windowUpper: 'tall',
          door: 'arched',
          hasAwning: true,
          hasChimney: true,
          dormerCount: 1,
        },
        (spec.generation * 3137 + 17) >>> 0,
      );
      sub1 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'East gable wing',
          W: W1,
          D: D1,
          H: 20,
          levels: 2,
          roofType: 'gable',
          gableProfile: 'gambrel',
          pitch: 0.76,
          windowGround: 'rect',
          windowUpper: 'rect',
          door: 'double',
          hasOculus: true,
          hasChimney: true,
        },
        (spec.generation * 3137 + 1008) >>> 0,
      );
      sub2 = attachSubArchitecture(
        {
          ...baseCommon,
          label: 'West shed atelier',
          W: W2,
          D: D2,
          H: 17,
          levels: 1,
          roofType: 'shed',
          pitch: 0.34,
          windowGround: 'ribbon',
          windowUpper: 'rect',
          door: 'rect',
          hasAwning: true,
        },
        (spec.generation * 3137 + 1999) >>> 0,
      );
      sub3 = sub2;
    }
  } else {
    sub0 = attachSubArchitecture(
      makeCompositeSubSpec(vrng, 'centerL', roof0, W0, D0, sharedWin, sharedDoor),
      (vcfg.seed * 733 + 11) >>> 0,
    );
    sub1 = attachSubArchitecture(
      makeCompositeSubSpec(vrng, 'centerR', roof1, W1, D1, sharedWin, sharedDoor),
      (vcfg.seed * 733 + 29) >>> 0,
    );
    sub2 = attachSubArchitecture(
      makeCompositeSubSpec(vrng, 'wingL', roof2, W2, D2, sharedWin, sharedDoor),
      (vcfg.seed * 733 + 47) >>> 0,
    );
    sub3 = attachSubArchitecture(
      makeCompositeSubSpec(vrng, 'wingR', roof3, W3, D3, sharedWin, sharedDoor),
      (vcfg.seed * 733 + 71) >>> 0,
    );
  }

  // Lay out flush wall-to-wall volumes along X: [b2] | [b0] | [b1] | [b3]
  const hw0 = W0 * 0.5;
  const hw1 = W1 * 0.5;
  const vol0: CompositeVolume = {
    prefix: 'b0',
    islandIdx: 0,
    colorSlot: 0,
    rot: 0,
    tx: 0,
    ty: ty0,
    worldW: W0,
    worldD: D0,
    subSpec: sub0,
  };
  const vol1: CompositeVolume = {
    prefix: 'b1',
    islandIdx: 1,
    colorSlot: 1,
    rot: Math.PI,
    tx: hw0 + SEAM + hw1,
    ty: ty1,
    worldW: W1,
    worldD: D1,
    subSpec: sub1,
  };
  const vol2: CompositeVolume = {
    prefix: 'b2',
    islandIdx: 2,
    colorSlot: 2,
    rot: Math.PI * 0.5,
    tx: -(hw0 + SEAM + D2 * 0.5),
    ty: ty2,
    worldW: D2,
    worldD: W2,
    subSpec: sub2,
  };
  const vol3: CompositeVolume = {
    prefix: 'b3',
    islandIdx: 3,
    colorSlot: 3,
    rot: -Math.PI * 0.5,
    tx: hw0 + SEAM + W1 + SEAM + D3 * 0.5,
    ty: ty3,
    worldW: D3,
    worldD: W3,
    subSpec: sub3,
  };

  const rawVolumes: CompositeVolume[] =
    count === 2 ? [vol0, vol1] : count === 3 ? [vol0, vol1, vol2] : [vol0, vol1, vol2, vol3];

  // Center the entire composite house horizontally around `(0, 0)` so camera orbit stays balanced!
  let minFX = Infinity;
  let maxFX = -Infinity;
  let minFY = Infinity;
  let maxFY = -Infinity;
  for (const v of rawVolumes) {
    minFX = Math.min(minFX, v.tx - v.worldW * 0.5);
    maxFX = Math.max(maxFX, v.tx + v.worldW * 0.5);
    minFY = Math.min(minFY, v.ty - v.worldD * 0.5);
    maxFY = Math.max(maxFY, v.ty + v.worldD * 0.5);
  }
  const shiftX = (minFX + maxFX) * 0.5;
  const shiftY = (minFY + maxFY) * 0.5;
  const volumes = rawVolumes.map((v) => ({ ...v, tx: v.tx - shiftX, ty: v.ty - shiftY }));

  const addFloorWeld = (id: string, a: CompositeVolume, b: CompositeVolume, islandIdx: number) => {
    const aMinX = a.tx - a.worldW * 0.5;
    const aMaxX = a.tx + a.worldW * 0.5;
    const bMinX = b.tx - b.worldW * 0.5;
    const bMaxX = b.tx + b.worldW * 0.5;
    const x0 = Math.min(aMaxX, bMaxX);
    const x1 = Math.max(aMinX, bMinX);
    const y0 = Math.max(a.ty - a.worldD * 0.5, b.ty - b.worldD * 0.5) + 0.2;
    const y1 = Math.min(a.ty + a.worldD * 0.5, b.ty + b.worldD * 0.5) - 0.2;
    if (x1 - x0 <= 1e-3 || y1 - y0 <= 1.0) return;
    add({
      id,
      parent: null,
      poly: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      hingeOrigin: [(x0 + x1) * 0.5, (y0 + y1) * 0.5],
      crease: null,
      hingeAxis: [1, 0],
      targetAngle: 0,
      stage: 'base',
      islandIndex: islandIdx,
      colorSlot: 0,
      label: 'Shared wall seam',
    });
  };

  addFloorWeld('seam_b0_b1', volumes[0], volumes[1], 0);
  if (count >= 3) addFloorWeld('seam_b2_b0', volumes[2], volumes[0], 2);
  if (count >= 4) addFloorWeld('seam_b1_b3', volumes[1], volumes[3], 3);

  let maxHeightMm = 0;
  let maxRoofRise = 0;
  let maxRoofSlant = 0;
  let maxFoldedR = 0;

  for (const vol of volumes) {
    const sub = buildHouseNet(vol.subSpec);
    if (sub.foldedHeightMm > maxHeightMm) maxHeightMm = sub.foldedHeightMm;
    if (sub.roofRise > maxRoofRise) maxRoofRise = sub.roofRise;
    if (sub.roofSlant > maxRoofSlant) maxRoofSlant = sub.roofSlant;

    const c = Math.cos(vol.rot);
    const s = Math.sin(vol.rot);
    const xformPt = ([x, y]: V2): V2 => [vol.tx + x * c - y * s, vol.ty + x * s + y * c];
    const xformDir = ([dx, dy]: V2): V2 => [dx * c - dy * s, dx * s + dy * c];

    // Automatically suppress openings on shared interior walls & orient front entrance doors to street (+Z)!
    const wallMeta = new Map<string, { skipOpenings: boolean; streetScore: number }>();
    let bestFrontWallId: string | null = null;
    let bestStreetScore = -Infinity;

    for (const p of sub.panels) {
      if (p.stage !== 'wall' || !p.wallFrame) continue;
      const wf = p.wallFrame;
      const localMidPt: V2 = [
        wf.origin[0] + wf.vAxis[0] * (wf.heightMm * 0.5),
        wf.origin[1] + wf.vAxis[1] * (wf.heightMm * 0.5),
      ];
      const [fx, , fz] = evaluateFoldedPoint(sub, p.id, localMidPt, 1);
      const [wx, wy] = xformPt([fx, -fz]);
      const nx = wx - vol.tx;
      const ny = wy - vol.ty;

      let kissing = false;
      for (const other of volumes) {
        if (other === vol) continue;
        const oMinX = other.tx - other.worldW * 0.5;
        const oMaxX = other.tx + other.worldW * 0.5;
        const oMinY = other.ty - other.worldD * 0.5;
        const oMaxY = other.ty + other.worldD * 0.5;
        if (wx >= oMinX - 1.2 && wx <= oMaxX + 1.2 && wy >= oMinY - 1.2 && wy <= oMaxY + 1.2) {
          const toOtherX = other.tx - vol.tx;
          const toOtherY = other.ty - vol.ty;
          if (nx * toOtherX + ny * toOtherY > 0) {
            kissing = true;
            break;
          }
        }
      }

      const nLen = Math.hypot(nx, ny) || 1;
      const streetScore = -ny / nLen;
      wallMeta.set(p.id, { skipOpenings: kissing, streetScore });
      if (!kissing && streetScore > bestStreetScore) {
        bestStreetScore = streetScore;
        bestFrontWallId = p.id;
      }
    }

    for (const p of sub.panels) {
      const poly = p.poly.map(xformPt);
      if (p.stage === 'base') {
        for (const [bx, by] of poly) {
          const r = Math.hypot(bx, by);
          if (r > maxFoldedR) maxFoldedR = r;
        }
      }

      const wm = wallMeta.get(p.id);
      const isFrontWall = p.stage === 'wall' ? p.id === bestFrontWallId : Boolean(p.isFront);

      add({
        ...p,
        id: `${vol.prefix}_${p.id}`,
        parent: p.parent ? `${vol.prefix}_${p.parent}` : null,
        poly,
        hingeOrigin: xformPt(p.hingeOrigin),
        crease: p.crease ? [xformPt(p.crease[0]), xformPt(p.crease[1])] : null,
        hingeAxis: xformDir(p.hingeAxis),
        wallFrame: p.wallFrame
          ? {
              ...p.wallFrame,
              origin: xformPt(p.wallFrame.origin),
              uAxis: xformDir(p.wallFrame.uAxis),
              vAxis: xformDir(p.wallFrame.vAxis),
            }
          : undefined,
        roofFrame: p.roofFrame
          ? {
              ...p.roofFrame,
              origin: xformPt(p.roofFrame.origin),
              ridgeAxis: xformDir(p.roofFrame.ridgeAxis),
              slopeAxis: xformDir(p.roofFrame.slopeAxis),
            }
          : undefined,
        isFront: isFrontWall,
        skipOpenings: wm?.skipOpenings || undefined,
        islandIndex: vol.islandIdx,
        colorSlot: vol.colorSlot,
        panelSpec: vol.subSpec,
        panelRoofRise: sub.roofRise,
        localId: p.id,
      });
    }
  }

  return {
    roofRise: maxRoofRise,
    roofSlant: maxRoofSlant,
    baseRadiusMm: maxFoldedR,
    foldedHeightMm: maxHeightMm,
  };
}

/**
 * Construct the exact flat pre-cut paper net for ANY `HouseNetSpec`
 * (`cross`, `ribbon`, `hex`, `oct`, `lwing`, `setback`, `village`).
 */
export function buildHouseNet(spec: HouseNetSpec): BuiltHouseNet {
  const { W, D, H } = spec;
  const hw = W * 0.5;
  const hd = D * 0.5;

  const panels: PanelNetDef[] = [];
  const add = (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => {
    panels.push({ ...p, poly: ensureCCW(p.poly) });
  };

  let roofRise = 0;
  let roofSlant = 0;
  let foldedRadiusMm = Math.hypot(W, D) * 0.5;
  let customFoldedHeightMm: number | null = null;

  if (spec.topology === 'hex' || spec.topology === 'oct') {
    const res = buildPolygonPetalNet(spec, spec.topology === 'hex' ? 6 : 8, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;
    foldedRadiusMm = res.baseRadiusMm;
  } else if (spec.topology === 'setback') {
    const res = buildSetbackTowerNet(spec, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;
    foldedRadiusMm = res.baseRadiusMm;
  } else if (spec.topology === 'lwing') {
    const res = buildLWingNet(spec, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;
    foldedRadiusMm = res.baseRadiusMm;
  } else if (spec.topology === 'village') {
    const res = buildVillageNet(spec, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;
    foldedRadiusMm = res.baseRadiusMm;
    customFoldedHeightMm = res.foldedHeightMm;
  } else {
    // 1. Central rectangular floor (`base`)
    add({
      id: 'base',
      parent: null,
      poly: [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ],
      hingeOrigin: [0, 0],
      crease: null,
      hingeAxis: [1, 0],
      targetAngle: 0,
      stage: 'base',
      label: 'Floor',
    });

    const res = spec.topology === 'ribbon' ? buildRibbonPanels(spec, add) : buildCrossPanels(spec, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;

    // Optional horizontal mirror across X (`front <- left <- back -> right`) for flush wall-to-wall composite packing!
    if (spec.topology === 'ribbon' && spec.mirrorRibbon) {
      for (const p of panels) {
        p.poly = ensureCCW(p.poly.map(([px, py]): V2 => [-px, py]));
        p.hingeOrigin = [-p.hingeOrigin[0], p.hingeOrigin[1]];
        if (p.crease) {
          p.crease = [
            [-p.crease[0][0], p.crease[0][1]],
            [-p.crease[1][0], p.crease[1][1]],
          ];
        }
        p.hingeAxis = [p.hingeAxis[0], -p.hingeAxis[1]];
        if (p.wallFrame) {
          p.wallFrame = {
            ...p.wallFrame,
            origin: [-p.wallFrame.origin[0], p.wallFrame.origin[1]],
            uAxis: [-p.wallFrame.uAxis[0], p.wallFrame.uAxis[1]],
            vAxis: [-p.wallFrame.vAxis[0], p.wallFrame.vAxis[1]],
          };
        }
        if (p.roofFrame) {
          p.roofFrame = {
            ...p.roofFrame,
            origin: [-p.roofFrame.origin[0], p.roofFrame.origin[1]],
            ridgeAxis: [-p.roofFrame.ridgeAxis[0], p.roofFrame.ridgeAxis[1]],
            slopeAxis: [-p.roofFrame.slopeAxis[0], p.roofFrame.slopeAxis[1]],
          };
        }
      }
    }
  }

  const panelMap = new Map<PanelId, PanelNetDef>();
  const foldableIds: FoldablePanelId[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    panelMap.set(p.id, p);
    if (p.parent !== null) foldableIds.push(p.id);
    for (const [px, py] of p.poly) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  const maxAbs = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
  const sheetHalfMm = Math.max(75, Math.ceil(maxAbs));
  const foldedHeightMm = customFoldedHeightMm ?? H + roofRise;

  return {
    spec,
    roofRise,
    roofSlant,
    flatBounds: { minX, maxX, minY, maxY },
    sheetHalfMm,
    foldedHeightMm,
    foldedRadiusMm,
    panels,
    panelMap,
    foldableIds,
  };
}

/**
 * Evaluate exact 3D world-mm coordinates of a sheet-space point on any panel at fold = 1
 * using Rodrigues' rotation around each ancestor's arbitrary 2D crease vector `hingeAxis`.
 */
export function evaluateFoldedPoint(
  net: BuiltHouseNet,
  panelId: PanelId,
  sheetPt: V2,
  fold01: number | ((id: PanelId) => number) = 1,
): [number, number, number] {
  const chain: PanelNetDef[] = [];
  let cur: PanelNetDef | undefined = net.panelMap.get(panelId);
  while (cur) {
    chain.push(cur);
    cur = cur.parent ? net.panelMap.get(cur.parent) : undefined;
  }
  chain.reverse(); // root -> leaf

  let x = sheetPt[0];
  let y = 0;
  let z = -sheetPt[1];

  for (let i = chain.length - 1; i >= 1; i--) {
    const p = chain[i];
    const hx = p.hingeOrigin[0];
    const hz = -p.hingeOrigin[1];
    const dx = x - hx;
    const dy = y;
    const dz = z - hz;

    const len = Math.hypot(p.hingeAxis[0], p.hingeAxis[1]) || 1;
    const ux = p.hingeAxis[0] / len;
    const uz = -p.hingeAxis[1] / len;
    const f = typeof fold01 === 'function' ? fold01(p.id) : fold01;
    const ang = p.targetAngle * f;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const oneMinusC = 1 - c;

    const dot = ux * dx + uz * dz;
    const cx = -uz * dy;
    const cy = uz * dx - ux * dz;
    const cz = ux * dy;

    x = hx + dx * c + cx * s + ux * dot * oneMinusC;
    y = dy * c + cy * s;
    z = hz + dz * c + cz * s + uz * dot * oneMinusC;
  }

  return [x, y, z];
}

/**
 * Compute the exact single simple CCW outer perimeter loop of the union of all panels in `net`
 * (by subdividing panel edges at touching neighbor vertices and canceling opposite interior hinge creases).
 * Used to punch an airtight complementary house-net hole out of the falling outer paper sheet!
 */
export function computeNetOuterPerimeter(net: BuiltHouseNet): V2[] {
  const allVerts: V2[] = [];
  for (const p of net.panels) {
    for (const v of p.poly) allVerts.push(v);
  }

  // 1. Subdivide every panel edge at any collinear vertex from another panel
  const subEdges: Array<[V2, V2]> = [];
  for (const p of net.panels) {
    const n = p.poly.length;
    for (let i = 0; i < n; i++) {
      const a = p.poly[i];
      const b = p.poly[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-8) continue;
      const len = Math.sqrt(lenSq);

      const splits: Array<{ t: number; pt: V2 }> = [];
      for (const q of allVerts) {
        const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / lenSq;
        if (t <= 1e-4 || t >= 1 - 1e-4) continue;
        const dist = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / len;
        if (dist < 1e-2) {
          splits.push({ t, pt: q });
        }
      }

      if (splits.length === 0) {
        subEdges.push([a, b]);
      } else {
        splits.sort((u, v) => u.t - v.t);
        const pts: V2[] = [a];
        let prevT = 0;
        for (const s of splits) {
          if (s.t - prevT > 1e-4) {
            pts.push(s.pt);
            prevT = s.t;
          }
        }
        pts.push(b);
        for (let k = 0; k < pts.length - 1; k++) {
          subEdges.push([pts[k], pts[k + 1]]);
        }
      }
    }
  }

  // 2. Cancel every interior shared crease pair (u -> v cancels v -> u)
  const boundary: Array<[V2, V2]> = [];
  const near = (p: V2, q: V2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2e-2;
  for (const [u, v] of subEdges) {
    const revIdx = boundary.findIndex(([p, q]) => near(p, v) && near(q, u));
    if (revIdx >= 0) {
      boundary.splice(revIdx, 1);
    } else {
      boundary.push([u, v]);
    }
  }

  if (boundary.length < 3) return [];

  // 3. Chain remaining directed boundary edges into a single closed CCW loop
  const used = new Uint8Array(boundary.length);
  const loop: V2[] = [boundary[0][0], boundary[0][1]];
  used[0] = 1;

  for (let step = 1; step < boundary.length; step++) {
    const cur = loop[loop.length - 1];
    let bestIdx = -1;
    let bestDist = 5e-2;
    for (let i = 0; i < boundary.length; i++) {
      if (used[i]) continue;
      const d = Math.hypot(boundary[i][0][0] - cur[0], boundary[i][0][1] - cur[1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    used[bestIdx] = 1;
    loop.push(boundary[bestIdx][1]);
  }

  // Drop closing duplicate vertex
  if (loop.length > 2 && near(loop[0], loop[loop.length - 1])) {
    loop.pop();
  }

  // 4. Prune redundant collinear vertices along straight exterior edges
  const clean: V2[] = [];
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    const prev = loop[(i + m - 1) % m];
    const curr = loop[i];
    const next = loop[(i + 1) % m];
    const ax = curr[0] - prev[0];
    const ay = curr[1] - prev[1];
    const bx = next[0] - curr[0];
    const by = next[1] - curr[1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-4 || lb < 1e-4) continue;
    const cross = Math.abs((ax * by - ay * bx) / (la * lb));
    const dot = (ax * bx + ay * by) / (la * lb);
    if (cross < 1e-4 && dot > 0) continue;
    clean.push(curr);
  }

  return ensureCCW(clean);
}

function convexPolygonsOverlap(A: V2[], B: V2[], eps = 1e-3): boolean {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const nx = b[1] - a[1];
      const ny = a[0] - b[0];
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) continue;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [x, y] of A) {
        const d = (x * nx + y * ny) / len;
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      for (const [x, y] of B) {
        const d = (x * nx + y * ny) / len;
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      if (aMax <= bMin + eps || bMax <= aMin + eps) return false;
    }
  }
  return true;
}

function isConvexCCW(poly: V2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) return false;
  }
  return true;
}

function pointInTri(p: V2, a: V2, b: V2, c: V2): boolean {
  const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7;
}

function decomposeToConvex(poly: V2[]): V2[][] {
  const ccw = ensureCCW(poly);
  if (ccw.length <= 3 || isConvexCCW(ccw)) return [ccw];

  const verts = [...ccw];
  const tris: V2[][] = [];
  let guard = 0;
  while (verts.length > 3 && guard < 200) {
    guard++;
    let clipped = false;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const a = verts[(i + n - 1) % n];
      const b = verts[i];
      const c = verts[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross <= 1e-6) continue;
      let containsOther = false;
      for (let j = 0; j < n; j++) {
        if (j === (i + n - 1) % n || j === i || j === (i + 1) % n) continue;
        if (pointInTri(verts[j], a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) {
        tris.push([a, b, c]);
        verts.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break;
  }
  if (verts.length === 3) tris.push(verts);
  return tris.length > 0 ? tris : [ccw];
}

/** Check exact non-overlap between any two simple polygons (convex OR concave, e.g. L-floors & sawtooth walls!) */
export function polygonsOverlap(A: V2[], B: V2[], eps = 1e-3): boolean {
  const partsA = decomposeToConvex(A);
  const partsB = decomposeToConvex(B);
  for (const pa of partsA) {
    for (const pb of partsB) {
      if (convexPolygonsOverlap(pa, pb, eps)) return true;
    }
  }
  return false;
}
