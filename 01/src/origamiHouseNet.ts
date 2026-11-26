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

export type V2 = [number, number];

export const MM = 0.1; // 1 mm = 0.1 Three.js world units

export type NetTopology = 'cross' | 'ribbon' | 'hex' | 'oct';
export type RoofType = 'gable' | 'hip' | 'mansard' | 'shed' | 'flat' | 'spire';
export type WindowStyle = 'rect' | 'tall' | 'arched' | 'pair' | 'ribbon';
export type DoorStyle = 'arched' | 'rect' | 'double' | 'arcade' | 'none';

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

export interface HouseNetSpec {
  generation: number;
  label: string;
  /** Unfolding net topology (`cross` star net vs `ribbon` wrap-around horizontal strip) */
  topology: NetTopology;
  /** Footprint width (X, mm) and depth (Y/Z, mm) */
  W: number;
  D: number;
  /** Wall height at low eave (mm) */
  H: number;
  /** Number of window stories (1..3) */
  levels: 1 | 2 | 3;
  /** Roof architecture */
  roofType: RoofType;
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
  stage: 'base' | 'wall' | 'roof' | 'cap';
  /** Wall local 2D frame in sheet space for universal window/door/awning placement */
  wallFrame?: WallLocalFrame;
  /** Roof local 2D frame in sheet space for universal chimney/dormer placement */
  roofFrame?: RoofLocalFrame;
  /** Marks the primary entrance wall (receives doorway / arcade / awning) */
  isFront?: boolean;
  /** Marks a triangular gable-end wall (eligible for attic circular oculus) */
  isGableEnd?: boolean;
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

/**
 * Generate a distinct architectural duplex-paper house spec for each recursive layer!
 * Alternates between classic `cross` star nets and wrap-around `ribbon` folding-screen nets,
 * cycling through all 6 roof types, scales, windows, details, yaw angles, and matte paper colors.
 */
export function generateHouseSpec(generation: number): HouseNetSpec {
  // Layer 1: iconic balanced silver-ratio gabled house on classic cross net (pure serene starting point!)
  if (generation <= 1) {
    const W = 42;
    const D = W * Math.SQRT2;
    const H = 24.301515;
    return {
      generation: 1,
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
      outsideColor: ARCHITECTURAL_PAPER_PALETTE[0],
    };
  }

  // Rotate cleanly through varied silhouettes & unfolding mechanics right from the first layers:
  //   1: Gable cottage (cross)          2: Grand mansard (ribbon)
  //   3: Octagonal lighthouse (oct)     4: Grand hip hall (ribbon)
  //   5: Hexagonal pavilion (hex)       6: Modernist tower (cross)
  //   7: Grand gable hall (ribbon)      8: Studio loft (ribbon)
  //   9+: rich mix across all 4 topologies & all 6 roof types!
  const outsideColor = ARCHITECTURAL_PAPER_PALETTE[(generation - 1) % ARCHITECTURAL_PAPER_PALETTE.length];
  const rng = makeRng(generation * 7919 + 202611);
  const yawChoices = [-0.42, 0.24, Math.PI * 0.5, -0.18, 0.52, -Math.PI * 0.5, 0.32];
  const yawOffset = yawChoices[(generation - 2) % yawChoices.length] + rng.range(-0.08, 0.08);

  const scalePreset =
    generation === 2
      ? 1.38
      : generation === 3
        ? 1.26
        : generation === 4
          ? 1.44
          : generation === 5
            ? 1.24
            : generation === 6
              ? 1.36
              : generation === 8
                ? 1.06
                : rng.pick([0.96, 1.18, 1.38, 1.52]);

  // Dedicated polygonal petal blooms (`oct` lighthouse/rotunda & `hex` pavilion/pagoda)
  const isOctLayer = generation === 3 || (generation > 8 && generation % 7 === 3);
  const isHexLayer = generation === 5 || (generation > 8 && generation % 7 === 5);

  if (isOctLayer) {
    const isCrownedRotunda = generation > 3 && rng.chance(0.45);
    const span = rng.range(36, 42) * Math.min(1.3, scalePreset);
    const H = (isCrownedRotunda ? rng.range(28, 34) : rng.range(44, 52)) * Math.min(1.26, scalePreset);
    return {
      generation,
      label: isCrownedRotunda ? 'Octagonal rotunda' : 'Octagonal lighthouse',
      topology: 'oct',
      W: span,
      D: span,
      H,
      levels: isCrownedRotunda ? 2 : 3,
      roofType: isCrownedRotunda ? 'mansard' : 'spire',
      pitch: isCrownedRotunda ? rng.range(0.76, 0.96) : rng.range(1.06, 1.20),
      mansardRatio: isCrownedRotunda ? 0.42 : 0,
      parapetH: 0,
      windowGround: 'arched',
      windowUpper: 'tall',
      door: 'arched',
      hasOculus: false,
      hasBelfry: !isCrownedRotunda,
      hasAwning: false,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  if (isHexLayer) {
    const isPointedPagoda = generation > 5 && rng.chance(0.45);
    const span = rng.range(42, 48) * Math.min(1.32, scalePreset);
    const H = rng.range(24, 30) * Math.min(1.28, scalePreset);
    return {
      generation,
      label: isPointedPagoda ? 'Hexagonal spire' : 'Hexagonal pavilion',
      topology: 'hex',
      W: span,
      D: span,
      H,
      levels: H >= 33 ? 2 : 1,
      roofType: isPointedPagoda ? 'spire' : 'mansard',
      pitch: isPointedPagoda ? rng.range(0.88, 1.05) : rng.range(0.68, 0.88),
      mansardRatio: isPointedPagoda ? 0 : 0.40,
      parapetH: 0,
      windowGround: rng.pick(['arched', 'tall']),
      windowUpper: 'rect',
      door: 'arched',
      hasOculus: false,
      hasBelfry: false,
      hasAwning: !isPointedPagoda,
      hasChimney: false,
      dormerCount: 0,
      yawOffset,
      outsideColor,
    };
  }

  // Rectangular layers cycle cleanly across the 6 roof archetypes & mix `ribbon` + `cross` nets!
  const rectCycle: RoofType[] = ['mansard', 'hip', 'flat', 'gable', 'shed', 'spire'];
  const rectIdx =
    generation === 2
      ? 0
      : generation === 4
        ? 1
        : generation === 6
          ? 2
          : generation === 7
            ? 3
            : generation === 8
              ? 4
              : (generation - 2) % rectCycle.length;
  const roofType = rectCycle[rectIdx];

  const topology: NetTopology =
    generation === 2 || generation === 4 || generation === 7 || generation === 8
      ? 'ribbon'
      : generation === 6
        ? 'cross'
        : rng.chance(0.55)
          ? 'ribbon'
          : 'cross';

  const winPool: WindowStyle[] = ['rect', 'tall', 'arched', 'pair', 'ribbon'];
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

  // Varied gable townhouse / grand hall
  const tallTownhouse = rng.chance(0.55);
  const W = (tallTownhouse ? rng.range(32, 38) : rng.range(42, 48)) * scalePreset;
  const D = (tallTownhouse ? rng.range(44, 52) : rng.range(54, 62)) * scalePreset;
  const H = (tallTownhouse ? rng.range(32, 38) : rng.range(22, 27)) * scalePreset;
  const levels: 1 | 2 | 3 = H >= 44 ? 3 : H >= 30 ? 2 : 1;
  return {
    generation,
    label: scalePreset >= 1.3 ? 'Grand gable hall' : tallTownhouse ? 'Gable townhouse' : 'Long gable house',
    topology,
    W,
    D,
    H,
    levels,
    roofType: 'gable',
    pitch: rng.range(0.64, 0.92),
    mansardRatio: 0,
    parapetH: 0,
    windowGround: rng.pick(winPool),
    windowUpper: rng.pick(winPool),
    door: rng.pick(doorPool),
    hasOculus: rng.chance(0.85),
    hasBelfry: false,
    hasAwning: rng.chance(0.55),
    hasChimney: rng.chance(0.85),
    dormerCount: D >= 48 ? (rng.chance(0.55) ? 2 : 1) : 1,
    yawOffset,
    outsideColor,
  };
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
    const R = hw * Math.tan(pitch);
    const L = Math.hypot(hw, R);
    const roofFold = Math.PI * 0.5 - pitch;

    add({
      id: 'front',
      parent: 'base',
      poly: [
        [-hw, -hd],
        [-hw, -(hd + H)],
        [0, -(hd + H + R)],
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
      isGableEnd: true,
      label: 'Front gable',
    });

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [-hw, hd],
        [hw, hd],
        [hw, hd + H],
        [0, hd + H + R],
        [-hw, hd + H],
      ],
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
      label: 'Left roof',
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
      label: 'Right roof',
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
    const R = hw * Math.tan(pitch);
    const L = Math.hypot(hw, R);
    const roofFold = Math.PI * 0.5 - pitch;

    add({
      id: 'back',
      parent: 'base',
      poly: [
        [xB0, hd],
        [xB1, hd],
        [xB1, hd + H],
        [cxB, hd + H + R],
        [xB0, hd + H],
      ],
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

    add({
      id: 'front',
      parent: 'right',
      poly: [
        [xF0, hd],
        [xF1, hd],
        [xF1, hd + H],
        [cxF, hd + H + R],
        [xF0, hd + H],
      ],
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
      label: 'Left roof',
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
      label: 'Right roof',
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

/**
 * Construct the exact flat pre-cut paper net for ANY `HouseNetSpec` (`cross`, `ribbon`, `hex`, `oct`).
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

  if (spec.topology === 'hex' || spec.topology === 'oct') {
    const res = buildPolygonPetalNet(spec, spec.topology === 'hex' ? 6 : 8, add);
    roofRise = res.roofRise;
    roofSlant = res.roofSlant;
    foldedRadiusMm = res.baseRadiusMm;
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
  }

  const panelMap = new Map<PanelId, PanelNetDef>();
  const foldableIds: FoldablePanelId[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    panelMap.set(p.id, p);
    if (p.id !== 'base') foldableIds.push(p.id);
    for (const [px, py] of p.poly) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  const maxAbs = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
  const sheetHalfMm = Math.max(75, Math.ceil(maxAbs));
  const foldedHeightMm = H + roofRise;

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
  fold01 = 1,
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
    const ang = p.targetAngle * fold01;
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

/** Check separating-axis non-overlap between two convex polygons in sheet mm */
export function polygonsOverlap(A: V2[], B: V2[], eps = 1e-3): boolean {
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
