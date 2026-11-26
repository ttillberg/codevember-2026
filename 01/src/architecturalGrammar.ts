/**
 * Recursive, compositional architectural parameter grammar for origami paper buildings.
 *
 * Every visual & geometric property is parameterized and owned hierarchically so types can be
 * shared, inherited, overridden, or mixed-and-matched across any level of the tree:
 *
 *   CompoundArchitecture (1..4 buildings + compound consistency)
 *    └── BuildingArchitecture (building consistency)
 *         ├── shape: ShapeParams (topology, W, D, H, levels, yawOffset)
 *         ├── roof: RoofParams (type, pitch, mansardRatio, parapetH, oculus, skylights, chimney, dormers)
 *         └── facades: FacadeSetParams (facade-to-facade consistency)
 *              └── FacadeParams (front / back / left / right / polygonal facets / upper tier / wing)
 *                   └── levels: LevelParams[] (level-to-level consistency)
 *                        ├── heightWeight, belfry, arcade
 *                        ├── door: DoorParams | null (style, position, widthRatio, heightRatio, awning)
 *                        └── windowRow: WindowRowParams (row-level consistency)
 *                             ├── count, rhythm, marginRatio, sillRatio
 *                             └── slots: WindowParams[] (per-bay window shape, widthScale, heightScale, mullions)
 *
 * The `consistency` parameter (`0..1`) flows recursively down the tree:
 *   - `1.0` (Strict classical): facades, levels, window rows, and companion buildings align strictly
 *     in style, bay count, symmetry, and proportions.
 *   - `0.65` (Balanced architectural): cohesive primary language with natural ground/upper hierarchy.
 *   - `0.0..0.35` (Eclectic mix-and-match): independent window shapes within rows, varied bay counts
 *     and story heights per level, off-center doors, distinct side/rear facades, and contrasting roofs.
 */

export type NetTopology = 'cross' | 'ribbon' | 'hex' | 'oct' | 'lwing' | 'setback' | 'village';
export type RoofType = 'gable' | 'hip' | 'mansard' | 'shed' | 'flat' | 'spire' | 'butterfly' | 'sawtooth';
export type GableProfile = 'classic' | 'gambrel' | 'stepped' | 'barrel' | 'saltbox';
export type WindowStyle = 'rect' | 'tall' | 'arched' | 'pair' | 'ribbon' | 'round' | 'lancet' | 'slit';
export type WindowOpeningMode = 'punched' | 'awning' | 'shutters' | 'casement' | 'louver';
export type WindowOpenMode = 'closed' | 'open' | 'random';
export type WindowDetail = 'clean' | 'six' | 'twelve' | 'cross' | 'transom' | 'triple' | 'sill';
export type DoorStyle = 'arched' | 'rect' | 'double' | 'arcade' | 'none';
export type DoorPosition = 'center' | 'left' | 'right';
export type WindowRowRhythm = 'uniform' | 'paired' | 'alternating' | 'center-weighted' | 'sparse';
export type FacadeRole = 'front' | 'back' | 'left' | 'right' | 'side' | 'upper' | 'wing';

export const ALL_GABLE_PROFILES: readonly GableProfile[] = [
  'classic',
  'gambrel',
  'stepped',
  'barrel',
  'saltbox',
];

export const ALL_WINDOW_STYLES: readonly WindowStyle[] = [
  'rect',
  'tall',
  'arched',
  'pair',
  'ribbon',
  'round',
  'lancet',
  'slit',
];

export const ALL_WINDOW_OPENINGS: readonly WindowOpeningMode[] = [
  'punched',
  'awning',
  'shutters',
  'casement',
  'louver',
];

export const ALL_WINDOW_OPEN_MODES: readonly WindowOpenMode[] = [
  'closed',
  'open',
  'random',
];

export const ALL_WINDOW_DETAILS: readonly WindowDetail[] = [
  'clean',
  'six',
  'twelve',
  'cross',
  'transom',
  'triple',
  'sill',
];

export const ALL_DOOR_STYLES: readonly DoorStyle[] = ['arched', 'rect', 'double', 'arcade', 'none'];

export interface WindowParams {
  shape: WindowStyle;
  /** Relative width multiplier (`0.72..1.28`) */
  widthScale: number;
  /** Relative height multiplier (`0.72..1.25`) */
  heightScale: number;
  /** Vertical mullion splits inside a bay (`0` = single opening, `1` = twin pane, `2` = triple lancet/pane) */
  mullions: 0 | 1 | 2;
  /** Kirigami hinge / opening mechanic (`punched`, `awning` from above, `shutters`, `casement`, `louver`) */
  openingMode: WindowOpeningMode;
  /** Real punched mullion / transom / sill architectural craftsmanship */
  detail: WindowDetail;
  /** Allows intentional blank wall bay when rhythm is `'sparse'` */
  blank?: boolean;
}

export interface WindowRowParams {
  /** Requested bay count (`'auto'` derives from wall width, or explicit `1..6`) */
  count: number | 'auto';
  /** Horizontal compositional pattern across bays */
  rhythm: WindowRowRhythm;
  /** Horizontal edge margin ratio relative to wall width (`0.08..0.22`) */
  marginRatio: number;
  /** Vertical centerline ratio within the level (`0.46..0.58`) */
  sillRatio: number;
  /** Row-level consistency (`0..1`): `1` = identical bays, `0` = per-bay variation */
  consistency: number;
  /** Primary window archetype owned by this row */
  baseWindow: WindowParams;
  /** Optional secondary accent window (used for alternating / center-weighted / low-consistency rows) */
  accentWindow: WindowParams;
  /** Pre-resolved per-bay window overrides (indexed `0..5`) for deterministic fine-grained composition */
  slots: WindowParams[];
}

export interface DoorParams {
  style: DoorStyle;
  position: DoorPosition;
  widthRatio: number;
  heightRatio: number;
  awning: boolean;
}

export interface LevelParams {
  /** 0 = ground floor, 1 = second floor, 2 = third/attic floor */
  index: number;
  /** Relative vertical height weight (`0.72..1.40`); normalized across all levels on a facade */
  heightWeight: number;
  /** Louvered belfry slits on tall top tower levels */
  belfry: boolean;
  /** Ground-floor arched colonnade replacing individual bays */
  arcade: boolean;
  /** Entrance doorway owned by this level (normally only on `index === 0` of front/entrance facades) */
  door: DoorParams | null;
  /** Window row owned by this level */
  windowRow: WindowRowParams;
}

export interface FacadeParams {
  role: FacadeRole;
  /** Level-to-level consistency within this facade (`0..1`) */
  consistency: number;
  /** Ordered story levels owned by this facade (bottom -> top) */
  levels: LevelParams[];
  /** Punched attic circular oculus in gable triangles on this facade */
  hasOculus: boolean;
}

export interface FacadeSetParams {
  /** Facade-to-facade consistency around the building (`0..1`) */
  consistency: number;
  /** Canonical primary facade (front entrance) */
  front: FacadeParams;
  /** Back facade (inherits from `front` without door when consistency is high) */
  back: FacadeParams;
  /** Left & right side facades (can diverge independently when consistency is lower) */
  left: FacadeParams;
  right: FacadeParams;
  /** Upper setback tier & L-wing secondary facades */
  upper: FacadeParams;
  wing: FacadeParams;
}

export interface ShapeParams {
  topology: Exclude<NetTopology, 'village'>;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  levels: 1 | 2 | 3;
  yawOffset: number;
}

export interface RoofParams {
  type: RoofType;
  /** Ceiling cross-section profile when `type === 'gable'` (`classic`, `gambrel` 2×, `stepped` 3× ladder, `barrel` 3×, `saltbox`) */
  gableProfile: GableProfile;
  pitch: number;
  mansardRatio: number;
  parapetH: number;
  hasOculus: boolean;
  hasSkylights: boolean;
  hasChimney: boolean;
  dormerCount: 0 | 1 | 2;
}

export interface BuildingArchitecture {
  /** Master coherence dial (`0..1`) recursively propagated to facades, levels, and window rows */
  consistency: number;
  shape: ShapeParams;
  roof: RoofParams;
  facades: FacadeSetParams;
}

export interface GrammarOverrides {
  /** Global consistency dial (`0..1`, default `0.72`) */
  consistency?: number | null;
  /** Explicit gable ceiling cross-section override */
  gableProfile?: GableProfile | null;
  /** Explicit window shape override (applied to base windows, blended by consistency) */
  windowStyle?: WindowStyle | null;
  /** Explicit kirigami window opening / hinge mode override */
  windowOpening?: WindowOpeningMode | null;
  /** Explicit window mullion / sill detail override */
  windowDetail?: WindowDetail | null;
  /** Explicit bays-per-row override (`1..5`) */
  windowCount?: number | null;
  /** Explicit door style override */
  doorStyle?: DoorStyle | null;
  /** Explicit story-count override (`1..3`) */
  levels?: 1 | 2 | 3 | null;
  /** Relative building height multiplier (`0.72..1.35`) */
  heightScale?: number | null;
}

function makeGrammarRng(seed: number) {
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Curated harmonious secondary window pairings so mixed rows stay architecturally legible */
const WINDOW_COMPANIONS: Record<WindowStyle, readonly WindowStyle[]> = {
  rect: ['tall', 'pair', 'ribbon', 'round'],
  tall: ['arched', 'lancet', 'rect', 'slit'],
  arched: ['round', 'tall', 'lancet', 'pair'],
  pair: ['rect', 'arched', 'ribbon', 'round'],
  ribbon: ['rect', 'slit', 'round', 'pair'],
  round: ['arched', 'rect', 'lancet', 'slit'],
  lancet: ['arched', 'round', 'tall', 'slit'],
  slit: ['tall', 'ribbon', 'round', 'rect'],
};

function pickNaturalOpeningMode(
  shape: WindowStyle,
  roofType: RoofType,
  rng: ReturnType<typeof makeGrammarRng>,
): WindowOpeningMode {
  if (shape === 'round' || shape === 'slit') return 'punched';
  if (shape === 'ribbon') {
    return rng.pick(['awning', 'awning', 'louver', 'punched'] as const);
  }
  if (shape === 'lancet') {
    return rng.pick(['punched', 'punched', 'casement', 'shutters'] as const);
  }
  if (roofType === 'sawtooth' || roofType === 'butterfly' || roofType === 'shed' || roofType === 'flat') {
    return rng.pick(['awning', 'awning', 'louver', 'casement', 'punched'] as const);
  }
  return rng.pick(['punched', 'shutters', 'awning', 'casement', 'louver', 'shutters'] as const);
}

function pickNaturalWindowDetail(
  shape: WindowStyle,
  openingMode: WindowOpeningMode,
  roofType: RoofType,
  rng: ReturnType<typeof makeGrammarRng>,
): WindowDetail {
  if (shape === 'round' || shape === 'slit') return 'clean';
  if (openingMode !== 'punched') {
    // Every hinged window is a hollow paper frame: mostly 1 crisp cutout inside (`clean` / `sill`),
    // and occasionally divided into 6 (`2×3`) or 12 (`3×4`) muntin panes!
    const r = rng.next();
    if (r < 0.54) return 'clean';
    if (r < 0.72) return 'sill';
    if (r < 0.87) return 'six';
    if (r < 0.94) return 'twelve';
    return 'cross';
  }
  if (shape === 'ribbon') {
    const r = rng.next();
    if (r < 0.44) return 'clean';
    if (r < 0.68) return 'triple';
    if (r < 0.82) return 'six';
    if (r < 0.92) return 'sill';
    return 'twelve';
  }
  if (shape === 'arched' || shape === 'lancet') {
    const r = rng.next();
    if (r < 0.50) return 'clean';
    if (r < 0.68) return 'sill';
    if (r < 0.82) return 'six';
    if (r < 0.92) return 'transom';
    return 'cross';
  }
  if (roofType === 'mansard' || roofType === 'gable' || roofType === 'hip') {
    const r = rng.next();
    if (r < 0.46) return 'clean';
    if (r < 0.62) return 'sill';
    if (r < 0.80) return 'six';
    if (r < 0.89) return 'twelve';
    if (r < 0.95) return 'cross';
    return 'transom';
  }
  const r = rng.next();
  if (r < 0.54) return 'clean';
  if (r < 0.72) return 'sill';
  if (r < 0.86) return 'six';
  if (r < 0.93) return 'twelve';
  return rng.pick(['cross', 'transom', 'triple'] as const);
}

function composeWindow(
  baseShape: WindowStyle,
  consistency: number,
  rng: ReturnType<typeof makeGrammarRng>,
  allowShapeDrift: boolean,
  baseOpening: WindowOpeningMode,
  baseDetail: WindowDetail,
  roofType: RoofType,
  explicitOpening: WindowOpeningMode | null,
  explicitDetail: WindowDetail | null,
): WindowParams {
  const c = clamp01(consistency);
  const driftProb = allowShapeDrift ? (1 - c) * 0.62 : 0;
  const shape: WindowStyle =
    driftProb > 0 && rng.chance(driftProb)
      ? rng.chance(0.72)
        ? rng.pick(WINDOW_COMPANIONS[baseShape])
        : rng.pick(ALL_WINDOW_STYLES)
      : baseShape;

  const spread = (1 - c) * 0.24;
  const widthScale = clamp(1 + rng.range(-spread, spread), 0.76, 1.24);
  const heightScale = clamp(1 + rng.range(-spread, spread), 0.76, 1.22);
  const mullions: 0 | 1 | 2 =
    shape === 'pair'
      ? 1
      : shape === 'rect' || shape === 'tall' || shape === 'arched'
        ? rng.chance((1 - c) * 0.22)
          ? 1
          : 0
        : 0;

  const openingMode: WindowOpeningMode =
    explicitOpening ??
    (shape === 'round' || shape === 'slit'
      ? 'punched'
      : allowShapeDrift && c < 0.55 && rng.chance((0.55 - c) * 0.75)
        ? pickNaturalOpeningMode(shape, roofType, rng)
        : baseOpening);

  const detail: WindowDetail =
    explicitDetail ??
    (shape === 'round' || shape === 'slit'
      ? 'clean'
      : allowShapeDrift && c < 0.55 && rng.chance((0.55 - c) * 0.75)
        ? pickNaturalWindowDetail(shape, openingMode, roofType, rng)
        : baseDetail);

  return { shape, widthScale, heightScale, mullions, openingMode, detail };
}

function composeWindowRow(
  baseShape: WindowStyle,
  requestedCount: number | 'auto',
  rowConsistency: number,
  rng: ReturnType<typeof makeGrammarRng>,
  isGround: boolean,
  hasDoor: boolean,
  baseOpening: WindowOpeningMode,
  baseDetail: WindowDetail,
  roofType: RoofType,
  explicitOpening: WindowOpeningMode | null,
  explicitDetail: WindowDetail | null,
): WindowRowParams {
  const c = clamp01(rowConsistency);
  const rowOpening: WindowOpeningMode =
    explicitOpening ??
    (c < 0.62 && rng.chance((0.62 - c) * 0.70) ? pickNaturalOpeningMode(baseShape, roofType, rng) : baseOpening);
  const rowDetail: WindowDetail =
    explicitDetail ??
    (c < 0.62 && rng.chance((0.62 - c) * 0.70)
      ? pickNaturalWindowDetail(baseShape, rowOpening, roofType, rng)
      : baseDetail);

  const baseWindow = composeWindow(
    baseShape,
    Math.max(c, 0.5),
    rng,
    false,
    rowOpening,
    rowDetail,
    roofType,
    explicitOpening,
    explicitDetail,
  );
  const accentShape =
    c < 0.78
      ? rng.pick(WINDOW_COMPANIONS[baseShape])
      : baseShape;
  const accentWindow = composeWindow(
    accentShape,
    c,
    rng,
    c < 0.35,
    rowOpening,
    rowDetail,
    roofType,
    explicitOpening,
    explicitDetail,
  );

  // Higher consistency -> clean uniform/paired rhythm; lower consistency -> alternating, center-weighted, sparse
  let rhythm: WindowRowRhythm = 'uniform';
  if (c < 0.85) {
    const r = rng.next();
    if (c < 0.35) {
      rhythm = r < 0.36 ? 'alternating' : r < 0.62 ? 'sparse' : r < 0.82 ? 'center-weighted' : 'paired';
    } else if (c < 0.65) {
      rhythm = r < 0.45 ? 'uniform' : r < 0.72 ? 'alternating' : r < 0.90 ? 'center-weighted' : 'paired';
    } else {
      rhythm = r < 0.72 ? 'uniform' : 'center-weighted';
    }
  }

  let count: number | 'auto' = requestedCount;
  if (requestedCount === 'auto' && c < 0.52 && rng.chance((0.52 - c) * 0.85)) {
    count = rng.pick(isGround && hasDoor ? [3, 5] : [2, 3, 4]);
  } else if (typeof requestedCount === 'number' && c < 0.32 && rng.chance((0.32 - c) * 0.7)) {
    count = clamp(requestedCount + rng.pick([-1, 1]), 1, 5);
  }

  const marginRatio = clamp(0.13 + rng.range(-(1 - c) * 0.04, (1 - c) * 0.05), 0.09, 0.20);
  const sillRatio = clamp(
    (baseShape === 'tall' ? 0.50 : 0.52) + rng.range(-(1 - c) * 0.05, (1 - c) * 0.05),
    0.46,
    0.58,
  );

  // Pre-generate 6 deterministic per-bay window slots owned by this row
  const slots: WindowParams[] = [];
  for (let i = 0; i < 6; i++) {
    let slotWin: WindowParams;
    if (rhythm === 'alternating' && i % 2 === 1) {
      slotWin = { ...accentWindow };
    } else if (rhythm === 'center-weighted' && (i === 1 || i === 2)) {
      slotWin = { ...accentWindow, heightScale: clamp(accentWindow.heightScale * 1.08, 0.8, 1.24) };
    } else if (rhythm === 'sparse' && !hasDoor && i % 2 === 1 && rng.chance(0.45 * (1 - c))) {
      slotWin = { ...baseWindow, blank: true };
    } else if (c < 0.40 && rng.chance((0.40 - c) * 0.85)) {
      slotWin = composeWindow(
        baseShape,
        c,
        rng,
        true,
        rowOpening,
        rowDetail,
        roofType,
        explicitOpening,
        explicitDetail,
      );
    } else {
      slotWin = { ...baseWindow };
    }
    slots.push(slotWin);
  }

  return {
    count,
    rhythm,
    marginRatio,
    sillRatio,
    consistency: c,
    baseWindow,
    accentWindow,
    slots,
  };
}

function composeFacade(
  role: FacadeRole,
  levelsCount: 1 | 2 | 3,
  groundStyle: WindowStyle,
  upperStyle: WindowStyle,
  doorStyle: DoorStyle,
  hasAwning: boolean,
  hasBelfry: boolean,
  hasOculus: boolean,
  requestedCount: number | 'auto',
  facadeConsistency: number,
  rng: ReturnType<typeof makeGrammarRng>,
  baseOpening: WindowOpeningMode,
  baseDetail: WindowDetail,
  roofType: RoofType,
  explicitOpening: WindowOpeningMode | null,
  explicitDetail: WindowDetail | null,
): FacadeParams {
  const c = clamp01(facadeConsistency);
  const isEntrance = role === 'front';
  const levels: LevelParams[] = [];

  // Optional subtle per-level variation when consistency is reduced
  const baseUpperStyle: WindowStyle =
    c < 0.55 && rng.chance((0.55 - c) * 0.75)
      ? rng.pick(WINDOW_COMPANIONS[upperStyle])
      : upperStyle;

  for (let li = 0; li < levelsCount; li++) {
    const isGround = li === 0;
    const isTop = li === levelsCount - 1;

    // Ground floor can be slightly taller ("piano nobile") as consistency relaxes
    const weightJitter = (1 - c) * 0.28;
    const heightWeight =
      levelsCount === 1
        ? 1
        : clamp(
            (isGround ? 1.0 + (1 - c) * 0.14 : isTop ? 1.0 - (1 - c) * 0.08 : 1.0) +
              rng.range(-weightJitter, weightJitter),
            0.74,
            1.36,
          );

    const doorPos: DoorPosition =
      isEntrance && isGround && doorStyle !== 'none' && doorStyle !== 'arcade'
        ? c < 0.36 && rng.chance((0.36 - c) * 0.9)
          ? rng.pick(['left', 'right'] as const)
          : 'center'
        : 'center';

    const door: DoorParams | null =
      isEntrance && isGround && doorStyle !== 'none'
        ? {
            style: doorStyle,
            position: doorPos,
            widthRatio: clamp(1 + rng.range(-(1 - c) * 0.12, (1 - c) * 0.12), 0.84, 1.16),
            heightRatio: clamp(0.66 + rng.range(-(1 - c) * 0.06, (1 - c) * 0.06), 0.58, 0.74),
            awning: hasAwning && doorStyle !== 'arcade',
          }
        : null;

    const levelStyle: WindowStyle = isGround
      ? groundStyle
      : li === 2 && c < 0.48 && rng.chance((0.48 - c) * 0.85)
        ? rng.pick(WINDOW_COMPANIONS[baseUpperStyle])
        : baseUpperStyle;

    // Level-level consistency gently loosens on upper stories if global consistency is low
    const rowConsistency = clamp01(c + (isGround ? 0.04 : -0.04));
    const windowRow = composeWindowRow(
      levelStyle,
      requestedCount,
      rowConsistency,
      rng,
      isGround,
      Boolean(door),
      baseOpening,
      baseDetail,
      roofType,
      explicitOpening,
      explicitDetail,
    );

    levels.push({
      index: li,
      heightWeight,
      belfry: isTop && hasBelfry,
      arcade: isGround && isEntrance && doorStyle === 'arcade',
      door,
      windowRow,
    });
  }

  return {
    role,
    consistency: c,
    levels,
    hasOculus,
  };
}

export interface BuildingGrammarInput {
  topology: Exclude<NetTopology, 'village'>;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  levels: 1 | 2 | 3;
  yawOffset: number;
  roofType: RoofType;
  gableProfile?: GableProfile;
  pitch: number;
  mansardRatio: number;
  parapetH: number;
  windowGround: WindowStyle;
  windowUpper: WindowStyle;
  door: DoorStyle;
  hasOculus: boolean;
  hasBelfry: boolean;
  hasAwning: boolean;
  hasChimney: boolean;
  dormerCount: 0 | 1 | 2;
  seed: number;
  consistency: number;
  windowCount?: number | 'auto';
  windowOpening?: WindowOpeningMode | null;
  windowDetail?: WindowDetail | null;
  /** When true (pure Layer 1 default), keep windows minimalist punched/clean unless overridden */
  keepMinimalDetails?: boolean;
}

/**
 * Recursively synthesize a complete `BuildingArchitecture` tree from high-level parameters + consistency dial.
 */
export function buildBuildingArchitecture(input: BuildingGrammarInput): BuildingArchitecture {
  const c = clamp01(input.consistency);
  const rng = makeGrammarRng((input.seed * 2654435761 + 97531) >>> 0);
  const reqCount: number | 'auto' =
    typeof input.windowCount === 'number' && input.windowCount >= 1 && input.windowCount <= 6
      ? Math.round(input.windowCount)
      : 'auto';

  const explicitOpening = input.windowOpening ?? null;
  const explicitDetail = input.windowDetail ?? null;
  const baseOpening: WindowOpeningMode =
    explicitOpening ??
    (input.keepMinimalDetails ? 'punched' : pickNaturalOpeningMode(input.windowGround, input.roofType, rng));
  const baseDetail: WindowDetail =
    explicitDetail ??
    (input.keepMinimalDetails
      ? 'clean'
      : pickNaturalWindowDetail(input.windowGround, baseOpening, input.roofType, rng));

  const front = composeFacade(
    'front',
    input.levels,
    input.windowGround,
    input.windowUpper,
    input.door,
    input.hasAwning,
    input.hasBelfry,
    input.hasOculus,
    reqCount,
    c,
    rng,
    baseOpening,
    baseDetail,
    input.roofType,
    explicitOpening,
    explicitDetail,
  );

  // Side & rear facades inherit `front`'s window styles when consistency is high, or branch independently when low!
  const deriveSideStyle = (base: WindowStyle): WindowStyle =>
    c >= 0.72 || !rng.chance((0.72 - c) * 1.15) ? base : rng.pick(WINDOW_COMPANIONS[base]);

  const sideGroundL = deriveSideStyle(input.windowGround);
  const sideUpperL = deriveSideStyle(input.windowUpper);
  const sideGroundR = c >= 0.55 ? sideGroundL : deriveSideStyle(input.windowGround);
  const sideUpperR = c >= 0.55 ? sideUpperL : deriveSideStyle(input.windowUpper);
  const backGround = c >= 0.65 ? input.windowGround : deriveSideStyle(input.windowGround);
  const backUpper = c >= 0.65 ? input.windowUpper : deriveSideStyle(input.windowUpper);

  const left = composeFacade(
    'left',
    input.levels,
    sideGroundL,
    sideUpperL,
    'none',
    false,
    input.hasBelfry,
    false,
    reqCount,
    c,
    rng,
    baseOpening,
    baseDetail,
    input.roofType,
    explicitOpening,
    explicitDetail,
  );
  const right =
    c >= 0.78
      ? { ...left, role: 'right' as const }
      : composeFacade(
          'right',
          input.levels,
          sideGroundR,
          sideUpperR,
          'none',
          false,
          input.hasBelfry,
          false,
          reqCount,
          c,
          rng,
          baseOpening,
          baseDetail,
          input.roofType,
          explicitOpening,
          explicitDetail,
        );
  const back = composeFacade(
    'back',
    input.levels,
    backGround,
    backUpper,
    'none',
    false,
    input.hasBelfry,
    input.hasOculus,
    reqCount,
    c,
    rng,
    baseOpening,
    baseDetail,
    input.roofType,
    explicitOpening,
    explicitDetail,
  );
  const upper = composeFacade(
    'upper',
    Math.min(2, input.levels) as 1 | 2,
    input.windowUpper,
    deriveSideStyle(input.windowUpper),
    'none',
    false,
    input.hasBelfry,
    false,
    reqCount,
    c,
    rng,
    baseOpening,
    baseDetail,
    input.roofType,
    explicitOpening,
    explicitDetail,
  );
  const wing = composeFacade(
    'wing',
    1,
    sideGroundR,
    sideUpperR,
    'none',
    false,
    false,
    false,
    reqCount,
    c,
    rng,
    baseOpening,
    baseDetail,
    input.roofType,
    explicitOpening,
    explicitDetail,
  );

  return {
    consistency: c,
    shape: {
      topology: input.topology,
      widthMm: input.widthMm,
      depthMm: input.depthMm,
      heightMm: input.heightMm,
      levels: input.levels,
      yawOffset: input.yawOffset,
    },
    roof: {
      type: input.roofType,
      gableProfile: input.gableProfile ?? 'classic',
      pitch: input.pitch,
      mansardRatio: input.mansardRatio,
      parapetH: input.parapetH,
      hasOculus: input.hasOculus,
      hasSkylights: input.roofType === 'mansard' || input.roofType === 'sawtooth',
      hasChimney: input.hasChimney,
      dormerCount: input.dormerCount,
    },
    facades: {
      consistency: c,
      front,
      back,
      left,
      right,
      upper,
      wing,
    },
  };
}

/**
 * Resolve the exact `FacadeParams` for a wall panel given its local id & stage.
 */
export function resolveFacadeForPanel(
  arch: BuildingArchitecture,
  localId: string,
  stage: string,
  isFront: boolean,
): FacadeParams {
  if (stage === 'upperWall') return arch.facades.upper;
  if (localId.startsWith('wing')) return arch.facades.wing;
  if (isFront) return arch.facades.front;
  if (localId === 'front' || localId === 'back') return arch.facades.back;
  if (localId === 'left') return arch.facades.left;
  if (localId === 'right') return arch.facades.right;
  // Polygonal facets alternate left / right / back deterministically around the perimeter
  const match = /\d+$/.exec(localId);
  if (match) {
    const idx = Number(match[0]);
    if (idx % 3 === 1) return arch.facades.left;
    if (idx % 3 === 2) return arch.facades.right;
    return arch.facades.back;
  }
  return arch.facades.left;
}

/**
 * Compute horizontal door center `uMm` on a front wall (so kirigami awnings always stay locked above the door!).
 */
export function computeDoorCenterU(
  wallLenMm: number,
  level: LevelParams,
): number | null {
  const door = level.door;
  if (!door || door.style === 'none' || door.style === 'arcade') return null;

  const row = level.windowRow;
  const style = row.baseWindow.shape;
  const baySpacing = style === 'ribbon' ? 15.5 : style === 'pair' ? 14.5 : 12.2;
  let bays =
    typeof row.count === 'number'
      ? Math.max(1, Math.min(5, row.count))
      : wallLenMm < 26
        ? 1
        : Math.max(2, Math.min(5, Math.floor((wallLenMm - 6) / baySpacing)));

  if (door.position === 'center' && bays % 2 === 0) {
    bays = wallLenMm >= 28 ? Math.min(5, bays + 1) : 1;
  }
  const margin =
    wallLenMm < 26
      ? Math.max(3.2, wallLenMm * 0.16)
      : Math.max(4.5, Math.min(7.5, wallLenMm * row.marginRatio));
  const usable = Math.max(8, wallLenMm - margin * 2);
  const cellW = usable / bays;
  const doorIdx =
    door.position === 'left'
      ? 0
      : door.position === 'right'
        ? bays - 1
        : Math.floor(bays / 2);

  return -wallLenMm * 0.5 + margin + cellW * (doorIdx + 0.5);
}
