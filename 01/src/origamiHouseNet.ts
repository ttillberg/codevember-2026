/**
 * Parametric flat-net generator for minimal architectural white-paper houses.
 *
 * Every generated house is a true, non-overlapping flat pre-cut paper net that folds
 * watertightly into 3D with zero glue tabs and zero scaling:
 *   - 6 architectural roof types: `gable`, `hip`, `mansard` (with hinged top cap!), `shed`, `flat`, `spire`
 *   - Varied footprints (`W`, `D`), heights (`H`), story counts (`1..3`), and orientation (`yawOffset`)
 *   - Per-story punched window styles (`rect`, `tall`, `arched`, `pair`, `ribbon`, `oculus`) & doors (`arched`, `rect`, `double`, `arcade`)
 *   - Flat-folded kirigami details (`awning`, `chimney`, `dormer`, `belfry` louvers) that lie flat at fold=0 and pop into 3D!
 */

export type V2 = [number, number];

export const MM = 0.1; // 1 mm = 0.1 Three.js world units

export type RoofType = 'gable' | 'hip' | 'mansard' | 'shed' | 'flat' | 'spire';
export type WindowStyle = 'rect' | 'tall' | 'arched' | 'pair' | 'ribbon';
export type DoorStyle = 'arched' | 'rect' | 'double' | 'arcade' | 'none';

export type PanelId =
  | 'base'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'roofL'
  | 'roofR'
  | 'roofF'
  | 'roofB'
  | 'roofCap';

export type FoldablePanelId = Exclude<PanelId, 'base'>;

export interface HouseNetSpec {
  generation: number;
  label: string;
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
 * Curated matte Japanese/Nordic architectural paper palette (same serene gallery theme):
 * Sumi black -> Indigo ink -> Brick terracotta -> Deep spruce -> Raw ochre -> Basalt taupe -> Ink plum -> Slate teal
 */
export const ARCHITECTURAL_PAPER_PALETTE: readonly string[] = [
  '#28282b', // 1. Sumi black
  '#263547', // 2. Indigo ink
  '#6e372d', // 3. Brick terracotta
  '#2f4438', // 4. Deep spruce
  '#8c6a3e', // 5. Raw ochre
  '#4c4843', // 6. Basalt taupe
  '#492f3e', // 7. Ink plum
  '#2d4b52', // 8. Slate teal
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
  /** Local rotation axis ('x' | 'z') and sign (+1 | -1) for folding inward/upward */
  axis: 'x' | 'z';
  sign: 1 | -1;
  /** Target fold angle in radians (positive magnitude) */
  targetAngle: number;
  /** Stage group for smooth scrub ordering */
  stage: 'base' | 'wall' | 'roof' | 'cap';
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
 * Generate a distinct architectural white-paper house spec for each recursive layer!
 * Layer 1 is the iconic balanced silver-ratio gabled house; each subsequent layer explores
 * a fresh combination of footprint size, height, roof architecture, windows, details, and angle.
 */
export function generateHouseSpec(generation: number): HouseNetSpec {
  // Layer 1: iconic balanced silver-ratio gabled house (pure, serene starting point!)
  if (generation <= 1) {
    const W = 42;
    const D = W * Math.SQRT2;
    const H = 24.301515;
    return {
      generation: 1,
      label: 'Gable cottage',
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

  // Rotate cleanly through all 6 roof archetypes so consecutive houses ALWAYS look strikingly different!
  const roofCycle: RoofType[] = ['mansard', 'spire', 'hip', 'shed', 'flat', 'gable'];
  const roofType = roofCycle[(generation - 2) % roofCycle.length];
  const outsideColor = ARCHITECTURAL_PAPER_PALETTE[(generation - 1) % ARCHITECTURAL_PAPER_PALETTE.length];
  const rng = makeRng(generation * 7919 + 202611);

  // Scale variation across generations: Gen 2, 3, 4, 6, 7 are noticeably BIGGER (larger sheets + zoom-out!),
  // punctuated by occasional compact studios so every layer genuinely surprises in scale!
  const scalePreset =
    generation === 2
      ? 1.38
      : generation === 3
        ? 1.24
        : generation === 4
          ? 1.44
          : generation === 5
            ? 1.04
            : generation === 6
              ? 1.36
              : rng.pick([0.94, 1.18, 1.42, 1.56]);

  const winPool: WindowStyle[] = ['rect', 'tall', 'arched', 'pair', 'ribbon'];
  const doorPool: DoorStyle[] = ['arched', 'rect', 'double', 'arcade'];

  // Subtle varied rotation so the new flat net slices across the previous projected house interestingly!
  const yawChoices = [-0.42, 0.35, Math.PI * 0.5, -0.26, 0.52, -Math.PI * 0.5];
  const yawOffset = yawChoices[(generation - 2) % yawChoices.length] + rng.range(-0.08, 0.08);

  if (roofType === 'spire') {
    const span = rng.range(30, 34) * Math.min(1.32, scalePreset);
    const H = rng.range(44, 50) * Math.min(1.32, scalePreset);
    return {
      generation,
      label: scalePreset >= 1.2 ? 'Cathedral spire' : 'Bell tower',
      W: span,
      D: span,
      H,
      levels: 3,
      roofType: 'spire',
      pitch: rng.range(1.16, 1.25), // Steep 66°..72° needle spire
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
      W,
      D,
      H,
      levels,
      roofType: 'mansard',
      pitch: rng.range(1.06, 1.18), // Crisp French mansard steepness
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

/**
 * Construct the exact flat pre-cut paper net for ANY `HouseNetSpec` (all 6 roof types!).
 */
export function buildHouseNet(spec: HouseNetSpec): BuiltHouseNet {
  const { W, D, H, roofType, pitch, mansardRatio, parapetH } = spec;
  const hw = W * 0.5;
  const hd = D * 0.5;
  const minSpan = Math.min(W, D);

  const panels: PanelNetDef[] = [];
  const add = (p: Omit<PanelNetDef, 'poly'> & { poly: V2[] }) => {
    panels.push({ ...p, poly: ensureCCW(p.poly) });
  };

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
    axis: 'x',
    sign: 1,
    targetAngle: 0,
    stage: 'base',
    label: 'Floor',
  });

  let roofRise = 0;
  let roofSlant = 0;

  if (roofType === 'gable') {
    const R = hw * Math.tan(pitch);
    const L = Math.hypot(hw, R);
    roofRise = R;
    roofSlant = L;
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
      axis: 'x',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'x',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: -1,
      targetAngle: roofFold,
      stage: 'roof',
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
      axis: 'z',
      sign: 1,
      targetAngle: roofFold,
      stage: 'roof',
      label: 'Right roof',
    });
  } else if (roofType === 'shed') {
    const R = W * Math.tan(pitch);
    const L = Math.hypot(W, R);
    roofRise = R;
    roofSlant = L;
    const roofFold = Math.PI * 0.5 - pitch;

    // Front & back right-trapezoids: low H on left (-hw), high H+R on right (+hw)!
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
      axis: 'x',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'x',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      label: 'High wall',
    });

    // Single mono-pitch roof sheet hinged along low left wall eave -> lands flush on high right wall!
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
      axis: 'z',
      sign: -1,
      targetAngle: roofFold,
      stage: 'roof',
      label: 'Shed roof',
    });
  } else if (roofType === 'flat') {
    roofRise = parapetH;
    roofSlant = W;
    const wallTop = H + parapetH;

    // Front, back, and right rise slightly above deck H to form crisp recessed modernist parapet walls!
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
      axis: 'x',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'x',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      label: 'Right wall',
    });

    // Flat roof deck hinged on left wall at height H -> folds 90° shut horizontally!
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
      axis: 'z',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'roof',
      label: 'Roof deck',
    });
  } else {
    // 4-sided pitched roofs: `hip`, `mansard`, and `spire`!
    // All 4 walls are crisp rectangles of height H, each carrying a matched trapezoid/triangle roof flap!
    const isMansard = roofType === 'mansard';
    const isSpire = roofType === 'spire';
    const run = isMansard ? minSpan * 0.5 * (1 - mansardRatio) : minSpan * 0.5;
    const hwTop = isSpire ? 0 : Math.max(0, hw - run);
    const hdTop = isSpire ? 0 : Math.max(0, hd - run);

    const R = run * Math.tan(pitch);
    const L = Math.hypot(run, R);
    roofRise = R;
    roofSlant = L;
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
      axis: 'x',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'x',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: -1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
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
      axis: 'z',
      sign: 1,
      targetAngle: Math.PI * 0.5,
      stage: 'wall',
      label: 'Right wall',
    });

    // On mansard roofs, extend the 3 non-hinge roof slopes slightly (+1.8 mm cornice lip) above the horizontal deck
    // so the top deck casts a crisp architectural rim against pure white-on-white sky (just like a recessed parapet!).
    const lip = isMansard ? 1.8 : 0;
    const Llip = L + lip;
    const hwTopLip = isMansard ? Math.max(2, hwTop - (lip / Math.max(L, 1)) * (hw - hwTop)) : hwTop;
    const hdTopLip = isMansard ? Math.max(2, hdTop - (lip / Math.max(L, 1)) * (hd - hdTop)) : hdTop;

    // Helper for trapezoid or triangle (when topHalf <= 1e-4)
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
      axis: 'x',
      sign: -1,
      targetAngle: roofFold,
      stage: 'roof',
      label: isSpire ? 'Front spire' : 'Front roof',
    });

    add({
      id: 'roofB',
      parent: 'back',
      poly: backRoofPoly,
      hingeOrigin: [0, hd + H],
      crease: [[-hw, hd + H], [hw, hd + H]],
      axis: 'x',
      sign: 1,
      targetAngle: roofFold,
      stage: 'roof',
      label: isSpire ? 'Back spire' : 'Back roof',
    });

    add({
      id: 'roofL',
      parent: 'left',
      poly: leftRoofPoly,
      hingeOrigin: [-(hw + H), 0],
      crease: [[-(hw + H), -hd], [-(hw + H), hd]],
      axis: 'z',
      sign: -1,
      targetAngle: roofFold,
      stage: 'roof',
      label: isSpire ? 'Left spire' : 'Left roof',
    });

    add({
      id: 'roofR',
      parent: 'right',
      poly: rightRoofPoly,
      hingeOrigin: [hw + H, 0],
      crease: [[hw + H, -hd], [hw + H, hd]],
      axis: 'z',
      sign: 1,
      targetAngle: roofFold,
      stage: 'roof',
      label: isSpire ? 'Right spire' : 'Right roof',
    });

    // Mansard flat top cap hinged directly onto the top edge of `roofB`!
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
        axis: 'x',
        sign: 1,
        targetAngle: pitch, // Total angle: 90 + (90 - pitch) + pitch = 180° (exact horizontal top cap!)
        stage: 'cap',
        label: 'Mansard deck',
      });
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
    if (p.id !== 'base') foldableIds.push(p.id);
    for (const [px, py] of p.poly) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  const maxAbs = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY));
  // Baseline square origami sheet is 150x150 mm (half = 75); bigger houses automatically get a bigger sheet!
  const sheetHalfMm = Math.max(75, Math.ceil(maxAbs));
  const foldedHeightMm = H + roofRise;
  const foldedRadiusMm = Math.hypot(W, D) * 0.5;

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
 * (used by Vitest to prove 0.0000 mm watertight closure across all 6 roof types!).
 */
export function evaluateFoldedPoint(
  net: BuiltHouseNet,
  panelId: PanelId,
  sheetPt: V2,
  fold01 = 1,
): [number, number, number] {
  // Walk chain from panel up to root
  const chain: PanelNetDef[] = [];
  let cur: PanelNetDef | undefined = net.panelMap.get(panelId);
  while (cur) {
    chain.push(cur);
    cur = cur.parent ? net.panelMap.get(cur.parent) : undefined;
  }
  chain.reverse(); // root -> leaf

  // Convert sheet (sx, sy) to flat world (x, y=0, z=-sy)
  let x = sheetPt[0];
  let y = 0;
  let z = -sheetPt[1];

  // Apply rotations from leaf back up to root!
  for (let i = chain.length - 1; i >= 1; i--) {
    const p = chain[i];
    const hx = p.hingeOrigin[0];
    const hz = -p.hingeOrigin[1];
    const dx = x - hx;
    const dy = y;
    const dz = z - hz;
    const ang = p.targetAngle * fold01 * p.sign;
    const c = Math.cos(ang);
    const s = Math.sin(ang);

    if (p.axis === 'x') {
      x = hx + dx;
      y = dy * c - dz * s;
      z = hz + dy * s + dz * c;
    } else {
      x = hx + dx * c - dy * s;
      y = dx * s + dy * c;
      z = hz + dz;
    }
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
