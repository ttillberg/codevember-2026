import { Vec3, cross3, dot3, len3, norm3, sub3 } from './math';
import { Face, Plane, Poly, clipPoly, finalizePoly, makeBoxPoly } from './poly';

export type CarveId =
  | 'free'
  | 'gem'
  | 'vase'
  | 'crystal'
  | 'prism'
  | 'A'
  | 'S'
  | 'O'
  | 'V'
  | 'X'
  | 'H'
  | 'T'
  | 'M'
  | 'K'
  | 'E'
  | 'C'
  | 'Z'
  | '2';

export interface CarvePreset {
  id: CarveId;
  label: string;
  group: 'mode' | 'shape' | 'letter';
}

export const CARVE_PRESETS: CarvePreset[] = [
  { id: 'free', label: 'Free', group: 'mode' },
  { id: 'gem', label: 'Gem', group: 'shape' },
  { id: 'vase', label: 'Vase', group: 'shape' },
  { id: 'crystal', label: 'Crystal', group: 'shape' },
  { id: 'prism', label: 'Prism', group: 'shape' },
  { id: 'A', label: 'A', group: 'letter' },
  { id: 'S', label: 'S', group: 'letter' },
  { id: 'O', label: 'O', group: 'letter' },
  { id: 'V', label: 'V', group: 'letter' },
  { id: 'X', label: 'X', group: 'letter' },
  { id: 'H', label: 'H', group: 'letter' },
  { id: 'T', label: 'T', group: 'letter' },
  { id: 'M', label: 'M', group: 'letter' },
  { id: 'K', label: 'K', group: 'letter' },
  { id: 'E', label: 'E', group: 'letter' },
  { id: 'C', label: 'C', group: 'letter' },
  { id: 'Z', label: 'Z', group: 'letter' },
  { id: '2', label: '2', group: 'letter' },
];

/**
 * One interactive carving step.
 * - `kind: 'plane'`: clips the current convex block(s) with 1 or 2 (symmetrical!) half-space planes in local space.
 * - `kind: 'pockets'`: removes 1 or 2 pre-fitted convex waste chunks directly out of the slab,
 *   leaving the exact remaining solid letter parts + remaining pockets!
 */
export type CarveStep =
  | {
      kind: 'plane';
      planes: Plane[]; // 1 plane, or 2 symmetrical opposing planes!
    }
  | {
      kind: 'pockets';
      /** 1 or 2 convex chunks to cleave & shatter simultaneously */
      chunks: Array<{ poly: Poly; pushDir: Vec3; cutPlane: Plane }>;
      /** Exact remaining solid parts (final letter parts + uncarved pockets) after this step */
      nextParts: Poly[];
    };

export interface CarvePlan {
  id: CarveId;
  steps: CarveStep[];
}

/** Build an extruded convex 2D polygon (in XY, extruded along Z in [-hz, +hz]) as a watertight Poly. */
function extrudePoly2D(ptsCCW: Array<[number, number]>, hz: number): Poly {
  // Ensure CCW winding in XY
  let area2 = 0;
  for (let i = 0; i < ptsCCW.length; i++) {
    const a = ptsCCW[i];
    const b = ptsCCW[(i + 1) % ptsCCW.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area2 < 0 ? [...ptsCCW].reverse() : ptsCCW;

  const faces: Face[] = [];
  // Front (+hz) CCW
  faces.push({
    n: [0, 0, 1],
    d: hz,
    verts: pts.map(([x, y]) => [x, y, hz] as Vec3),
  });
  // Back (-hz) reversed for CCW from -Z
  faces.push({
    n: [0, 0, -1],
    d: hz,
    verts: [...pts].reverse().map(([x, y]) => [x, y, -hz] as Vec3),
  });
  // Side walls
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    if (l < 1e-5) continue;
    const nx = dy / l;
    const ny = -dx / l;
    const n: Vec3 = [nx, ny, 0];
    const d = nx * x0 + ny * y0;
    const verts: Vec3[] = [
      [x0, y0, -hz],
      [x1, y1, -hz],
      [x1, y1, hz],
      [x0, y0, hz],
    ];
    // Verify CCW against n
    const e1 = sub3(verts[1], verts[0]);
    const e2 = sub3(verts[2], verts[0]);
    if (dot3(cross3(e1, e2), n) < 0) verts.reverse();
    faces.push({ n, d, verts });
  }
  return finalizePoly(faces);
}

/** Convenience: axis-aligned convex box [x0..x1] x [y0..y1] x [-hz..+hz]. */
function rectBar(x0: number, y0: number, x1: number, y1: number, hz: number): Poly {
  return extrudePoly2D(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    hz,
  );
}

/** Clip an extruded polygon against optional bevel planes so letter pieces match the trimmed outer slab. */
function clipAll(p: Poly, planes: Plane[]): Poly {
  let cur: Poly | null = p;
  for (const pl of planes) {
    if (!cur) break;
    cur = clipPoly(cur, pl.n, pl.d, false);
  }
  return cur ?? p;
}

function plane(nx: number, ny: number, nz: number, d: number): Plane {
  return { n: norm3([nx, ny, nz]), d };
}

/** Build a symmetrical 2-plane carve step from a base plane mirrored across X (or Z). */
function symX(nx: number, ny: number, nz: number, d: number): CarveStep {
  return {
    kind: 'plane',
    planes: [plane(nx, ny, nz, d), plane(-nx, ny, nz, d)],
  };
}

function symZ(nx: number, ny: number, nz: number, d: number): CarveStep {
  return {
    kind: 'plane',
    planes: [plane(nx, ny, nz, d), plane(nx, ny, -nz, d)],
  };
}

function symXZ(nx: number, ny: number, nz: number, d: number): CarveStep {
  return {
    kind: 'plane',
    planes: [plane(nx, ny, nz, d), plane(-nx, ny, -nz, d)],
  };
}

/**
 * Helper to assemble a volume-conserving letter carve plan:
 * 1. Symmetrical front/back slab cleave -> glass monolith of thickness 2*hz
 * 2. Optional symmetrical outer margin & corner/diagonal trims
 * 3. Pocket groups (1 or 2 pockets cleaved simultaneously) until only `finalParts` remain!
 */
function buildLetterPlan(
  id: CarveId,
  hz: number,
  outerSteps: CarveStep[],
  finalParts: Poly[],
  pocketGroups: Array<Array<{ poly: Poly; pushDir: Vec3; cutPlane: Plane }>>,
): CarvePlan {
  const steps: CarveStep[] = [
    // Step 1: Symmetrical front + back cleave into a sculptural glass slab!
    symZ(0, 0, 1, hz),
    ...outerSteps,
  ];

  for (let gi = 0; gi < pocketGroups.length; gi++) {
    const group = pocketGroups[gi];
    // Remaining solid parts after carving this group = final letter parts + all later uncarved pockets!
    const remaining: Poly[] = [...finalParts];
    for (let later = gi + 1; later < pocketGroups.length; later++) {
      for (const p of pocketGroups[later]) remaining.push(p.poly);
    }
    steps.push({
      kind: 'pockets',
      chunks: group,
      nextParts: remaining,
    });
  }

  return { id, steps };
}

/**
 * Build the exact step-by-step carving plan for any sculptural shape or architectural letter.
 * Starts from the initial cube (0.56 x 0.605 x 0.56 -> half extents [0.28, 0.302, 0.28]).
 */
export function buildCarvePlan(id: CarveId): CarvePlan | null {
  if (id === 'free') return null;

  // =========================================================================
  // SCULPTURAL 3D CRYSTAL SHAPES (pure symmetrical planar facet carving!)
  // =========================================================================
  if (id === 'gem') {
    // Brilliant-cut faceted Sommerso gemstone: crown bevels + pavilion point + girdle facets!
    return {
      id,
      steps: [
        symX(1, 0.85, 0, 0.24),
        symZ(0, 0.85, 1, 0.24),
        symXZ(1, 0.9, 1, 0.25),
        symXZ(1, 0.9, -1, 0.25),
        symX(1, -0.78, 0, 0.22),
        symZ(0, -0.78, 1, 0.22),
        symXZ(1, -0.82, 1, 0.23),
        symXZ(1, -0.82, -1, 0.23),
        { kind: 'plane', planes: [plane(0, 1, 0, 0.21)] },
      ],
    };
  }

  if (id === 'vase') {
    // Inspired directly by the uploaded Murano Sommerso vase: slender faceted monolith with sharp bevelled base!
    return {
      id,
      steps: [
        symX(1, 0, 0, 0.175),
        symZ(0, 0, 1, 0.165),
        symXZ(1, 0, 1, 0.205),
        symXZ(1, 0, -1, 0.205),
        symX(0.82, -0.58, 0, 0.215),
        symZ(0, -0.58, 0.82, 0.210),
        symXZ(0.7, -0.7, 0.7, 0.225),
        symXZ(0.7, -0.7, -0.7, 0.225),
      ],
    };
  }

  if (id === 'crystal') {
    // Sharp 8-sided octahedral crystal carved symmetrically off all 8 corners!
    return {
      id,
      steps: [
        symXZ(1, 0.95, 1, 0.235),
        symXZ(1, 0.95, -1, 0.235),
        symXZ(1, -0.95, 1, 0.235),
        symXZ(1, -0.95, -1, 0.235),
        symX(1, 0, 0, 0.23),
        symZ(0, 0, 1, 0.23),
      ],
    };
  }

  if (id === 'prism') {
    // Hexagonal bevelled crystal prism with crisp crown & foot chamfers
    const c30 = Math.cos(Math.PI / 6);
    const s30 = Math.sin(Math.PI / 6);
    return {
      id,
      steps: [
        symX(1, 0, 0, 0.22),
        symXZ(s30, 0, c30, 0.22),
        symXZ(-s30, 0, c30, 0.22),
        symX(0.65, 0.76, 0, 0.28),
        symX(0.65, -0.76, 0, 0.28),
      ],
    };
  }

  // =========================================================================
  // ARCHITECTURAL CARVED GLASS LETTERS (exact volume-conserving multi-convex!)
  // Bounds after Step 1 slab trim: X in [-W, +W], Y in [-H, +H], Z in [-T, +T]
  // =========================================================================
  const W = 0.24;
  const H = 0.29;
  const T = 0.11;
  const marginTrim: CarveStep = symX(1, 0, 0, W);

  if (id === 'H') {
    const sw = 0.088; // pillar width
    const barH = 0.046; // half crossbar height
    const ix = W - sw; // inner x = 0.152
    const finalParts = [
      rectBar(-W, -H, -ix, H, T),
      rectBar(ix, -H, W, H, T),
      rectBar(-ix, -barH, ix, barH, T),
    ];
    const topPocket = rectBar(-ix, barH, ix, H, T);
    const botPocket = rectBar(-ix, -H, ix, -barH, T);
    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [
        { poly: topPocket, pushDir: [0, 1, 0.2], cutPlane: plane(0, 1, 0, barH) },
        { poly: botPocket, pushDir: [0, -1, 0.2], cutPlane: plane(0, -1, 0, barH) },
      ],
    ]);
  }

  if (id === 'T') {
    const topBarY = H - 0.105; // 0.185
    const stemHalf = 0.056;
    const finalParts = [
      rectBar(-W, topBarY, W, H, T),
      rectBar(-stemHalf, -H, stemHalf, topBarY, T),
    ];
    const leftPocket = rectBar(-W, -H, -stemHalf, topBarY, T);
    const rightPocket = rectBar(stemHalf, -H, W, topBarY, T);
    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [
        { poly: leftPocket, pushDir: [-1, -0.25, 0.15], cutPlane: plane(-1, 0, 0, stemHalf) },
        { poly: rightPocket, pushDir: [1, -0.25, 0.15], cutPlane: plane(1, 0, 0, stemHalf) },
      ],
    ]);
  }

  if (id === 'V') {
    // Outer silhouette tapers from top [-W, +W] down to bottom [-0.075, +0.075]
    const botW = 0.072;
    const legW = 0.095;
    // Left outer edge from (-W, H) to (-botW, -H): outward normal points left-down
    const dx = W - botW;
    const dy = 2 * H;
    const nl = Math.hypot(dy, dx);
    const nx = dy / nl;
    const ny = -dx / nl;
    const dDiag = nx * W + ny * H;

    const finalParts = [
      extrudePoly2D([[-W, H], [-W + legW, H], [0, -H + 0.115], [0, -H], [-botW, -H]], T),
      extrudePoly2D([[W - legW, H], [W, H], [botW, -H], [0, -H], [0, -H + 0.115]], T),
    ];
    const centerNotch = extrudePoly2D([[-W + legW, H], [W - legW, H], [0, -H + 0.115]], T);
    return buildLetterPlan(
      id,
      T,
      [marginTrim, symX(nx, ny, 0, dDiag)],
      finalParts,
      [[{ poly: centerNotch, pushDir: [0, 1, 0.25], cutPlane: plane(0, 1, 0, 0.0) }]],
    );
  }

  if (id === 'A') {
    const topW = 0.072;
    const legW = 0.092;
    const crossY0 = -0.105;
    const crossY1 = -0.02;
    const dx = W - topW;
    const dy = 2 * H;
    const nl = Math.hypot(dy, dx);
    const nx = dy / nl;
    const ny = dx / nl; // outward normal points left/right + up
    const dDiag = nx * topW + ny * H;

    // Inner x of legs at crossY0, crossY1, and apex
    const xAt = (y: number) => topW + ((H - y) / (2 * H)) * (W - topW);
    const inBot = W - legW;
    const inC0 = xAt(crossY0) - legW * 0.92;
    const inC1 = xAt(crossY1) - legW * 0.92;
    const apexY = 0.145;

    const finalParts = [
      extrudePoly2D([[-W, -H], [-inBot, -H], [-topW + 0.012, H], [-topW, H]], T),
      extrudePoly2D([[inBot, -H], [W, -H], [topW, H], [topW - 0.012, H]], T),
      extrudePoly2D([[-inC0 - 0.02, crossY0], [inC0 + 0.02, crossY0], [inC1 + 0.02, crossY1], [-inC1 - 0.02, crossY1]], T),
      extrudePoly2D([[-topW, H], [topW, H], [0, apexY]], T),
    ];
    const botArch = extrudePoly2D([[-inBot, -H], [inBot, -H], [inC0, crossY0], [-inC0, crossY0]], T);
    const topTri = extrudePoly2D([[-inC1, crossY1], [inC1, crossY1], [0, apexY]], T);

    return buildLetterPlan(
      id,
      T,
      [marginTrim, symX(nx, ny, 0, dDiag)],
      finalParts,
      [
        [{ poly: botArch, pushDir: [0, -1, 0.25], cutPlane: plane(0, -1, 0, -crossY0) }],
        [{ poly: topTri, pushDir: [0, 0.15, 1.0], cutPlane: plane(0, 0, 1, 0) }],
      ],
    );
  }

  if (id === 'X') {
    const arm = 0.088;
    const cx = 0.068;
    const cy = 0.082;
    const finalParts = [
      extrudePoly2D([[-W, H], [-W + arm, H], [0, cy], [-cx, 0]], T),
      extrudePoly2D([[W - arm, H], [W, H], [cx, 0], [0, cy]], T),
      extrudePoly2D([[-cx, 0], [0, -cy], [-W + arm, -H], [-W, -H]], T),
      extrudePoly2D([[0, -cy], [cx, 0], [W, -H], [W - arm, -H]], T),
      extrudePoly2D([[0, cy], [cx, 0], [0, -cy], [-cx, 0]], T),
    ];
    const leftWedge = extrudePoly2D([[-W, -H], [-cx, 0], [-W, H]], T);
    const rightWedge = extrudePoly2D([[W, H], [cx, 0], [W, -H]], T);
    const topWedge = extrudePoly2D([[-W + arm, H], [W - arm, H], [0, cy]], T);
    const botWedge = extrudePoly2D([[-W + arm, -H], [0, -cy], [W - arm, -H]], T);

    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [
        { poly: leftWedge, pushDir: [-1, 0, 0.2], cutPlane: plane(-1, 0, 0, cx) },
        { poly: rightWedge, pushDir: [1, 0, 0.2], cutPlane: plane(1, 0, 0, cx) },
      ],
      [
        { poly: topWedge, pushDir: [0, 1, 0.2], cutPlane: plane(0, 1, 0, cy) },
        { poly: botWedge, pushDir: [0, -1, 0.2], cutPlane: plane(0, -1, 0, cy) },
      ],
    ]);
  }

  if (id === 'O') {
    const sw = 0.088;
    const sh = 0.095;
    const ix = W - sw;
    const iy = H - sh;
    const c = 0.095; // outer corner chamfer
    const bevels = [
      plane(1, 1, 0, (W + H - c) * Math.SQRT1_2),
      plane(-1, 1, 0, (W + H - c) * Math.SQRT1_2),
      plane(1, -1, 0, (W + H - c) * Math.SQRT1_2),
      plane(-1, -1, 0, (W + H - c) * Math.SQRT1_2),
    ];
    const finalParts = [
      clipAll(rectBar(-W, iy, W, H, T), bevels),
      clipAll(rectBar(-W, -H, W, -iy, T), bevels),
      rectBar(-W, -iy, -ix, iy, T),
      rectBar(ix, -iy, W, iy, T),
    ];
    const core = rectBar(-ix, -iy, ix, iy, T);
    return buildLetterPlan(
      id,
      T,
      [
        marginTrim,
        { kind: 'plane', planes: [bevels[0], bevels[3]] },
        { kind: 'plane', planes: [bevels[1], bevels[2]] },
      ],
      finalParts,
      [[{ poly: core, pushDir: [0, 0.2, 1.0], cutPlane: plane(0, 0, 1, 0) }]],
    );
  }

  if (id === 'C') {
    const sw = 0.092;
    const sh = 0.098;
    const ix = W - sw;
    const iy = H - sh;
    const c = 0.09;
    const bevels = [
      plane(-1, 1, 0, (W + H - c) * Math.SQRT1_2),
      plane(-1, -1, 0, (W + H - c) * Math.SQRT1_2),
    ];
    const finalParts = [
      clipAll(rectBar(-W, iy, W, H, T), bevels),
      clipAll(rectBar(-W, -H, W, -iy, T), bevels),
      rectBar(-W, -iy, -ix, iy, T),
    ];
    const rightBay = rectBar(-ix, -iy, W, iy, T);
    return buildLetterPlan(
      id,
      T,
      [marginTrim, { kind: 'plane', planes: bevels }],
      finalParts,
      [[{ poly: rightBay, pushDir: [1, 0, 0.2], cutPlane: plane(1, 0, 0, -ix) }]],
    );
  }

  if (id === 'E') {
    const sw = 0.09;
    const bar = 0.088;
    const midH = 0.044;
    const ix = -W + sw;
    const finalParts = [
      rectBar(-W, -H, ix, H, T),
      rectBar(ix, H - bar, W, H, T),
      rectBar(ix, -midH, W - 0.03, midH, T),
      rectBar(ix, -H, W, -H + bar, T),
    ];
    const topBay = rectBar(ix, midH, W, H - bar, T);
    const botBay = rectBar(ix, -H + bar, W, -midH, T);
    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [
        { poly: topBay, pushDir: [1, 0.35, 0.2], cutPlane: plane(1, 0, 0, ix) },
        { poly: botBay, pushDir: [1, -0.35, 0.2], cutPlane: plane(1, 0, 0, ix) },
      ],
    ]);
  }

  if (id === 'S' || id === '2') {
    const sw = 0.092;
    const bar = 0.086;
    const midH = 0.044;
    const c = 0.075;
    const bevels = [
      plane(1, 1, 0, (W + H - c) * Math.SQRT1_2),
      plane(-1, 1, 0, (W + H - c) * Math.SQRT1_2),
      plane(1, -1, 0, (W + H - c) * Math.SQRT1_2),
      plane(-1, -1, 0, (W + H - c) * Math.SQRT1_2),
    ];

    if (id === 'S') {
      const finalParts = [
        clipAll(rectBar(-W, H - bar, W, H, T), bevels),
        rectBar(-W, midH, -W + sw, H - bar, T),
        rectBar(-W, -midH, W, midH, T),
        rectBar(W - sw, -H + bar, W, -midH, T),
        clipAll(rectBar(-W, -H, W, -H + bar, T), bevels),
      ];
      const upperRight = rectBar(-W + sw, midH, W, H - bar, T);
      const lowerLeft = rectBar(-W, -H + bar, W - sw, -midH, T);
      return buildLetterPlan(
        id,
        T,
        [
          marginTrim,
          { kind: 'plane', planes: [bevels[0], bevels[3]] },
          { kind: 'plane', planes: [bevels[1], bevels[2]] },
        ],
        finalParts,
        [
          [
            { poly: upperRight, pushDir: [1, 0.25, 0.2], cutPlane: plane(1, 0, 0, -W + sw) },
            { poly: lowerLeft, pushDir: [-1, -0.25, 0.2], cutPlane: plane(-1, 0, 0, -(W - sw)) },
          ],
        ],
      );
    } else {
      // '2' (mirrored bays compared to S!)
      const finalParts = [
        clipAll(rectBar(-W, H - bar, W, H, T), bevels),
        rectBar(W - sw, midH, W, H - bar, T),
        rectBar(-W, -midH, W, midH, T),
        rectBar(-W, -H + bar, -W + sw, -midH, T),
        rectBar(-W, -H, W, -H + bar, T),
      ];
      const upperLeft = rectBar(-W, midH, W - sw, H - bar, T);
      const lowerRight = rectBar(-W + sw, -H + bar, W, -midH, T);
      return buildLetterPlan(
        id,
        T,
        [marginTrim, { kind: 'plane', planes: [bevels[0], bevels[1]] }],
        finalParts,
        [
          [
            { poly: upperLeft, pushDir: [-1, 0.25, 0.2], cutPlane: plane(-1, 0, 0, -(W - sw)) },
            { poly: lowerRight, pushDir: [1, -0.25, 0.2], cutPlane: plane(1, 0, 0, -W + sw) },
          ],
        ],
      );
    }
  }

  if (id === 'Z') {
    const bar = 0.088;
    const diagW = 0.11;
    const yTop = H - bar;
    const yBot = -H + bar;
    const finalParts = [
      rectBar(-W, yTop, W, H, T),
      rectBar(-W, -H, W, yBot, T),
      extrudePoly2D([[W - diagW, yTop], [W, yTop], [-W + diagW, yBot], [-W, yBot]], T),
    ];
    const upperLeft = extrudePoly2D([[-W, yBot], [-W, yTop], [W - diagW, yTop]], T);
    const lowerRight = extrudePoly2D([[-W + diagW, yBot], [W, yBot], [W, yTop]], T);
    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [
        { poly: upperLeft, pushDir: [-1, 0.35, 0.2], cutPlane: plane(-1, 0.4, 0, 0) },
        { poly: lowerRight, pushDir: [1, -0.35, 0.2], cutPlane: plane(1, -0.4, 0, 0) },
      ],
    ]);
  }

  if (id === 'M') {
    const sw = 0.082;
    const ix = W - sw;
    const vBot = -0.04;
    const finalParts = [
      rectBar(-W, -H, -ix, H, T),
      rectBar(ix, -H, W, H, T),
      extrudePoly2D([[-ix, H], [-ix + 0.055, H], [0, vBot + 0.095], [0, vBot], [-ix, H - 0.13]], T),
      extrudePoly2D([[ix - 0.055, H], [ix, H], [ix, H - 0.13], [0, vBot], [0, vBot + 0.095]], T),
    ];
    const topV = extrudePoly2D([[-ix + 0.055, H], [ix - 0.055, H], [0, vBot + 0.095]], T);
    const botLeft = extrudePoly2D([[-ix, -H], [0, -H], [0, vBot], [-ix, H - 0.13]], T);
    const botRight = extrudePoly2D([[0, -H], [ix, -H], [ix, H - 0.13], [0, vBot]], T);
    return buildLetterPlan(id, T, [marginTrim], finalParts, [
      [{ poly: topV, pushDir: [0, 1, 0.25], cutPlane: plane(0, 1, 0, vBot + 0.095) }],
      [
        { poly: botLeft, pushDir: [-0.45, -1, 0.2], cutPlane: plane(0, -1, 0, -vBot) },
        { poly: botRight, pushDir: [0.45, -1, 0.2], cutPlane: plane(0, -1, 0, -vBot) },
      ],
    ]);
  }

  // 'K'
  const sw = 0.092;
  const ix = -W + sw;
  const armW = 0.10;
  const finalParts = [
    rectBar(-W, -H, ix, H, T),
    extrudePoly2D([[ix, -0.02], [W - armW, H], [W, H], [ix + 0.065, 0.0]], T),
    extrudePoly2D([[ix, 0.02], [ix + 0.065, 0.0], [W, -H], [W - armW, -H]], T),
  ];
  const topTri = extrudePoly2D([[ix, 0.0], [ix, H], [W - armW, H]], T);
  const botTri = extrudePoly2D([[ix, -H], [W - armW, -H], [ix, 0.0]], T);
  const rightWedge = extrudePoly2D([[ix + 0.065, 0.0], [W, -H], [W, H]], T);
  return buildLetterPlan(id, T, [marginTrim], finalParts, [
    [
      { poly: topTri, pushDir: [0.25, 1, 0.2], cutPlane: plane(0, 1, 0, 0) },
      { poly: botTri, pushDir: [0.25, -1, 0.2], cutPlane: plane(0, -1, 0, 0) },
    ],
    [{ poly: rightWedge, pushDir: [1, 0, 0.2], cutPlane: plane(1, 0, 0, ix + 0.065) }],
  ]);
}
