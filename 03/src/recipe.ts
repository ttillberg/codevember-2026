export type BaseKind = 'water' | 'coconut';

export type FlavorId =
  | 'mango'
  | 'lemon'
  | 'orange'
  | 'watermelon'
  | 'strawberry'
  | 'raspberry'
  | 'blueberry'
  | 'banana'
  | 'chocolate';

export type ToppingId =
  | 'blueberry'
  | 'chocolate'
  | 'shaved-lemon'
  | 'strawberry'
  | 'raspberry'
  | 'kaksmulor';

export interface PopsicleRecipe {
  base: BaseKind;
  /** Up to 2 basic tastes defining the popsicle's colors & juice tint (0 allowed on coconut for pure coconut milk!) */
  flavors: FlavorId[];
  /** Any subset of the 6 embedded 3D toppings */
  toppings: ToppingId[];
}

export interface OpticalSpec {
  /** Beer-Lambert spectral absorption coefficients for translucent water-based ice */
  sigma: [number, number, number];
  /** Luminous backlit translucent core color (linear HDR) */
  core: [number, number, number];
  /** Rich saturated translucent mid-body color (linear HDR) */
  mid: [number, number, number];
  /** Deep thick-edge / bottom-rim color (linear HDR) */
  deep: [number, number, number];
  /** Natural pulp cloudiness in water base (0 = crystal clear juice, ~0.6 = rich cocoa/banana puree) */
  waterCloudiness: number;
  /** Creamy opaque coconut-milk albedo (linear) */
  creamAlbedo: [number, number, number];
  /** Warm coconut-cream subsurface scatter rim glow (linear HDR) */
  creamSss: [number, number, number];
  /** Soft coconut-cream shadow / bottom richness (linear) */
  creamDeep: [number, number, number];
  /** Melted juice/cream stain tint for wooden stick, shadows, and surface/pendant drops (linear) */
  stain: [number, number, number];
  /** Drop optical absorption sigma for translucent droplets */
  dropSigma: [number, number, number];
}

export interface FlavorOpticalSpec extends OpticalSpec {
  id: FlavorId;
  label: string;
  swatch: string;
}

export interface ResolvedOpticalPalette {
  isCoconut: boolean;
  /** Overall creamy opacity [0 = pure crystal water ice .. 0.92 = rich opaque coconut milk] */
  opacity: number;
  /** True when two distinct tastes are active for organic layered/swirled dual-color blending */
  isDual: boolean;
  // Flavor A (top / primary)
  sigmaA: [number, number, number];
  coreA: [number, number, number];
  midA: [number, number, number];
  deepA: [number, number, number];
  creamAlbedoA: [number, number, number];
  creamSssA: [number, number, number];
  creamDeepA: [number, number, number];
  // Flavor B (bottom / secondary; equals A when single flavor)
  sigmaB: [number, number, number];
  coreB: [number, number, number];
  midB: [number, number, number];
  deepB: [number, number, number];
  creamAlbedoB: [number, number, number];
  creamSssB: [number, number, number];
  creamDeepB: [number, number, number];
  // Shared melt runoff / drops / stick stain / shadow tint
  stainColor: [number, number, number];
  dropSigma: [number, number, number];
  dropCreamColor: [number, number, number];
  shadowTint: [number, number, number];
}

export const FLAVOR_LIST: FlavorOpticalSpec[] = [
  {
    id: 'mango',
    label: 'Mango',
    swatch: '#f5a61c',
    sigma: [0.22, 1.52, 8.60],
    core: [1.68, 1.18, 0.20],
    mid: [1.46, 0.72, 0.06],
    deep: [0.98, 0.30, 0.02],
    waterCloudiness: 0.22,
    creamAlbedo: [0.92, 0.46, 0.035],
    creamSss: [1.14, 0.64, 0.09],
    creamDeep: [0.56, 0.20, 0.010],
    stain: [0.95, 0.60, 0.10],
    dropSigma: [0.22, 1.20, 4.40],
  },
  {
    id: 'lemon',
    label: 'Lemon',
    swatch: '#f2de41',
    sigma: [0.26, 0.40, 6.80],
    core: [1.62, 1.56, 0.44],
    mid: [1.38, 1.24, 0.16],
    deep: [0.96, 0.78, 0.05],
    waterCloudiness: 0.08,
    creamAlbedo: [0.92, 0.74, 0.16],
    creamSss: [1.12, 0.94, 0.28],
    creamDeep: [0.60, 0.43, 0.05],
    stain: [0.94, 0.84, 0.22],
    dropSigma: [0.20, 0.32, 3.20],
  },
  {
    id: 'orange',
    label: 'Orange',
    swatch: '#f26d1d',
    sigma: [0.20, 3.05, 9.40],
    core: [1.66, 0.82, 0.16],
    mid: [1.44, 0.40, 0.05],
    deep: [0.98, 0.14, 0.02],
    waterCloudiness: 0.10,
    creamAlbedo: [0.90, 0.28, 0.045],
    creamSss: [1.14, 0.44, 0.10],
    creamDeep: [0.54, 0.11, 0.014],
    stain: [0.94, 0.42, 0.09],
    dropSigma: [0.20, 2.05, 4.80],
  },
  {
    id: 'watermelon',
    label: 'Watermelon',
    swatch: '#f24d64',
    sigma: [0.28, 5.15, 4.15],
    core: [1.58, 0.58, 0.56],
    mid: [1.32, 0.22, 0.30],
    deep: [0.84, 0.05, 0.14],
    waterCloudiness: 0.02,
    creamAlbedo: [0.84, 0.15, 0.22],
    creamSss: [1.08, 0.26, 0.34],
    creamDeep: [0.42, 0.048, 0.09],
    stain: [0.93, 0.28, 0.38],
    dropSigma: [0.24, 3.00, 2.50],
  },
  {
    id: 'strawberry',
    label: 'Strawberry',
    swatch: '#e83845',
    sigma: [0.40, 6.15, 5.80],
    core: [1.48, 0.54, 0.40],
    mid: [1.20, 0.20, 0.19],
    deep: [0.76, 0.03, 0.08],
    waterCloudiness: 0.0,
    creamAlbedo: [0.76, 0.085, 0.115],
    creamSss: [1.04, 0.18, 0.20],
    creamDeep: [0.34, 0.024, 0.042],
    stain: [0.88, 0.26, 0.32],
    dropSigma: [0.26, 3.45, 3.25],
  },
  {
    id: 'raspberry',
    label: 'Raspberry',
    swatch: '#c81c5b',
    sigma: [0.68, 7.60, 4.15],
    core: [1.40, 0.26, 0.52],
    mid: [1.04, 0.07, 0.28],
    deep: [0.54, 0.02, 0.14],
    waterCloudiness: 0.08,
    creamAlbedo: [0.40, 0.052, 0.102],
    creamSss: [0.64, 0.11, 0.19],
    creamDeep: [0.15, 0.016, 0.036],
    stain: [0.78, 0.14, 0.36],
    dropSigma: [0.44, 4.30, 2.35],
  },
  {
    id: 'blueberry',
    label: 'Blueberry',
    swatch: '#4a3da8',
    sigma: [4.55, 6.20, 1.15],
    core: [0.56, 0.42, 1.36],
    mid: [0.24, 0.16, 0.90],
    deep: [0.10, 0.05, 0.44],
    waterCloudiness: 0.14,
    creamAlbedo: [0.10, 0.36, 0.72],
    creamSss: [0.24, 0.54, 0.94],
    creamDeep: [0.035, 0.15, 0.42],
    stain: [0.30, 0.22, 0.64],
    dropSigma: [2.75, 3.60, 0.72],
  },
  {
    id: 'banana',
    label: 'Banana',
    swatch: '#ebd367',
    sigma: [0.40, 0.78, 3.90],
    core: [1.54, 1.40, 0.76],
    mid: [1.28, 1.08, 0.38],
    deep: [0.88, 0.68, 0.18],
    waterCloudiness: 0.42,
    creamAlbedo: [0.90, 0.72, 0.24],
    creamSss: [1.10, 0.90, 0.36],
    creamDeep: [0.58, 0.40, 0.08],
    stain: [0.86, 0.74, 0.36],
    dropSigma: [0.32, 0.62, 2.15],
  },
  {
    id: 'chocolate',
    label: 'Chocolate',
    swatch: '#57301e',
    sigma: [5.20, 8.90, 13.0],
    core: [0.46, 0.21, 0.10],
    mid: [0.24, 0.10, 0.04],
    deep: [0.10, 0.035, 0.015],
    waterCloudiness: 0.66,
    creamAlbedo: [0.21, 0.092, 0.045],
    creamSss: [0.36, 0.165, 0.085],
    creamDeep: [0.075, 0.028, 0.012],
    stain: [0.32, 0.15, 0.08],
    dropSigma: [2.80, 4.90, 6.80],
  },
];

export const FLAVOR_MAP: Record<FlavorId, FlavorOpticalSpec> = Object.fromEntries(
  FLAVOR_LIST.map((f) => [f.id, f]),
) as Record<FlavorId, FlavorOpticalSpec>;

export const TOPPING_LIST: Array<{ id: ToppingId; label: string; swatch: string }> = [
  { id: 'blueberry', label: 'Blueberry', swatch: '#272452' },
  { id: 'chocolate', label: 'Chocolate', swatch: '#3d2013' },
  { id: 'shaved-lemon', label: 'Shaved lemon', swatch: '#f5d738' },
  { id: 'strawberry', label: 'Strawberry', swatch: '#d92836' },
  { id: 'raspberry', label: 'Raspberry', swatch: '#b9164d' },
  { id: 'kaksmulor', label: 'Kaksmulor', swatch: '#302420' },
];

export const DEFAULT_RECIPE: PopsicleRecipe = {
  base: 'water',
  flavors: ['strawberry'],
  toppings: ['strawberry', 'blueberry'],
};

export interface PopsiclePreset {
  id: string;
  name: string;
  seed: number;
  recipe: PopsicleRecipe;
}

export const POPSICLE_PRESETS: PopsiclePreset[] = [
  {
    id: 'berry-classic',
    name: 'Berry Classic',
    seed: 1,
    recipe: { base: 'water', flavors: ['strawberry'], toppings: ['strawberry', 'blueberry'] },
  },
  {
    id: 'mango-sunrise',
    name: 'Mango Sunrise',
    seed: 4,
    recipe: { base: 'water', flavors: ['mango', 'orange'], toppings: ['raspberry', 'shaved-lemon'] },
  },
  {
    id: 'pink-lemonade',
    name: 'Pink Lemonade',
    seed: 7,
    recipe: { base: 'water', flavors: ['raspberry', 'lemon'], toppings: ['raspberry', 'shaved-lemon'] },
  },
  {
    id: 'blueberry-ice',
    name: 'Blueberry Ice',
    seed: 9,
    recipe: { base: 'water', flavors: ['blueberry'], toppings: ['blueberry', 'shaved-lemon'] },
  },
  {
    id: 'watermelon-rush',
    name: 'Watermelon',
    seed: 12,
    recipe: { base: 'water', flavors: ['watermelon'], toppings: ['strawberry', 'chocolate'] },
  },
  {
    id: 'cookies-milk',
    name: 'Cookies & Milk',
    seed: 3,
    recipe: { base: 'coconut', flavors: [], toppings: ['kaksmulor'] },
  },
  {
    id: 'berry-cream',
    name: 'Berry Milk',
    seed: 6,
    recipe: { base: 'coconut', flavors: ['strawberry'], toppings: ['strawberry', 'raspberry'] },
  },
  {
    id: 'choco-banana',
    name: 'Choco Banana',
    seed: 11,
    recipe: { base: 'coconut', flavors: ['banana', 'chocolate'], toppings: ['chocolate', 'kaksmulor'] },
  },
  {
    id: 'dark-fudge',
    name: 'Dark Fudge',
    seed: 14,
    recipe: { base: 'coconut', flavors: ['chocolate'], toppings: ['chocolate', 'raspberry'] },
  },
];

export function recipesMatch(a: PopsicleRecipe, b: PopsicleRecipe): boolean {
  if (a.base !== b.base) return false;
  if (a.flavors.length !== b.flavors.length || a.toppings.length !== b.toppings.length) return false;
  for (let i = 0; i < a.flavors.length; i++) {
    if (a.flavors[i] !== b.flavors[i]) return false;
  }
  const setB = new Set(b.toppings);
  for (let i = 0; i < a.toppings.length; i++) {
    if (!setB.has(a.toppings[i])) return false;
  }
  return true;
}

const PURE_COCONUT_SPEC: OpticalSpec = {
  sigma: [0.45, 0.55, 0.72],
  core: [1.34, 1.26, 1.06],
  mid: [1.08, 0.99, 0.80],
  deep: [0.76, 0.66, 0.48],
  waterCloudiness: 0.96,
  // Warm golden-ivory sweetened condensed milk paleta (truly opaque, never flat bleached white!)
  creamAlbedo: [0.90, 0.80, 0.56],
  creamSss: [1.05, 0.92, 0.64],
  creamDeep: [0.60, 0.48, 0.28],
  stain: [0.88, 0.78, 0.54],
  dropSigma: [0.38, 0.44, 0.54],
};

function avg3(a: [number, number, number], b: [number, number, number], t = 0.5): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function normalizeRecipe(recipe: PopsicleRecipe): PopsicleRecipe {
  const base: BaseKind = recipe.base === 'coconut' ? 'coconut' : 'water';
  const uniqueFlavors: FlavorId[] = [];
  for (const f of recipe.flavors) {
    if (f in FLAVOR_MAP && !uniqueFlavors.includes(f)) {
      uniqueFlavors.push(f);
    }
    if (uniqueFlavors.length >= 2) break;
  }
  if (base === 'water' && uniqueFlavors.length === 0) {
    uniqueFlavors.push('strawberry');
  }
  const validToppings = new Set(TOPPING_LIST.map((t) => t.id));
  const uniqueToppings: ToppingId[] = [];
  for (const t of recipe.toppings) {
    if (validToppings.has(t) && !uniqueToppings.includes(t)) {
      uniqueToppings.push(t);
    }
  }
  return { base, flavors: uniqueFlavors, toppings: uniqueToppings };
}

export function resolveOpticalPalette(rawRecipe: PopsicleRecipe): ResolvedOpticalPalette {
  const recipe = normalizeRecipe(rawRecipe);
  const isCoconut = recipe.base === 'coconut';

  const specA: OpticalSpec =
    recipe.flavors.length > 0
      ? FLAVOR_MAP[recipe.flavors[0]]
      : isCoconut
        ? PURE_COCONUT_SPEC
        : FLAVOR_MAP.strawberry;
  const specB: OpticalSpec = recipe.flavors.length > 1 ? FLAVOR_MAP[recipe.flavors[1]] : specA;
  const isDual = recipe.flavors.length > 1 && recipe.flavors[0] !== recipe.flavors[1];

  const opacity = isCoconut
    ? 1.0
    : Math.max(specA.waterCloudiness, specB.waterCloudiness * 0.85 + specA.waterCloudiness * 0.15);

  const creamAlbedoA: [number, number, number] = isCoconut
    ? specA.creamAlbedo
    : avg3(specA.creamAlbedo, [specA.mid[0] * 0.72, specA.mid[1] * 0.72, specA.mid[2] * 0.72], 0.45);
  const creamAlbedoB: [number, number, number] = isCoconut
    ? specB.creamAlbedo
    : avg3(specB.creamAlbedo, [specB.mid[0] * 0.72, specB.mid[1] * 0.72, specB.mid[2] * 0.72], 0.45);

  // Runoff, underside pools & stick stain naturally lean slightly toward the lower flavor (B) when dual-flavored
  const stainBase = avg3(specA.stain, specB.stain, isDual ? 0.62 : 0.0);
  const stainColor: [number, number, number] = isCoconut
    ? avg3(stainBase, PURE_COCONUT_SPEC.stain, recipe.flavors.length === 0 ? 1.0 : 0.34)
    : stainBase;

  const dropSigma = avg3(specA.dropSigma, specB.dropSigma, isDual ? 0.58 : 0.0);
  const dropCreamColor = avg3(creamAlbedoA, creamAlbedoB, isDual ? 0.58 : 0.0);

  // Soft cast shadow tint matching flavor hue (keeps dark chocolate / blueberry / mango shadows natural!)
  const shadowTint: [number, number, number] = isCoconut
    ? [
        0.34 + dropCreamColor[0] * 0.24,
        0.32 + dropCreamColor[1] * 0.24,
        0.30 + dropCreamColor[2] * 0.24,
      ]
    : [
        0.24 + stainColor[0] * 0.28,
        0.16 + stainColor[1] * 0.26,
        0.16 + stainColor[2] * 0.26,
      ];

  return {
    isCoconut,
    opacity,
    isDual,
    sigmaA: specA.sigma,
    coreA: specA.core,
    midA: specA.mid,
    deepA: specA.deep,
    creamAlbedoA,
    creamSssA: specA.creamSss,
    creamDeepA: specA.creamDeep,
    sigmaB: specB.sigma,
    coreB: specB.core,
    midB: specB.mid,
    deepB: specB.deep,
    creamAlbedoB,
    creamSssB: specB.creamSss,
    creamDeepB: specB.creamDeep,
    stainColor,
    dropSigma,
    dropCreamColor,
    shadowTint,
  };
}
