import { CELL_HEX } from './drone';

// The eight cells, as a little hairline drawing of the tesseract at rest, and their colours under it. Seen along w,
// the +w cell is the outer cube and the -w cell the inner one; the six between, the frustums, are the cells held on x,
// y and z, a dot at the middle of each. Cells are numbered held axis * 2 + (side > 0), as in drone.ts. Drawn turned
// and tilted a little off true isometric: square on, the two cubes' near and far corners fall on one point and the
// dots on top of each other.
const OUT = 1, IN = 0.42; // the two cubes' half sizes
const YAW = 0.52, TILT = 0.42; // radians: turned about the vertical, then tipped towards the eye
const cy = Math.cos(YAW), sy = Math.sin(YAW), ct = Math.cos(TILT), st = Math.sin(TILT);
/** A point in 3D to the drawing's plane, orthographic: x right, y up, z towards the eye; the plane's y down. */
const view = (x: number, y: number, z: number): [number, number] => {
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; // turned
  return [x1, -(y * ct - z1 * st)]; // tipped
};
const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)));
/** The cube's 12 edges at half size h, each a pair of corners one coordinate apart. */
const edges = (h: number) => CORNERS.flatMap((a, i) => CORNERS.slice(i + 1).filter((b) => a.filter((v, k) => v !== b[k]).length === 1)
  .map((b) => [view(a[0] * h, a[1] * h, a[2] * h), view(b[0] * h, b[1] * h, b[2] * h)] as const));
const MID = (OUT + IN) / 2; // a frustum's middle, on its axis
const DOTS: [number, [number, number]][] = [
  [0, view(-MID, 0, 0)], [1, view(MID, 0, 0)], [2, view(0, -MID, 0)], [3, view(0, MID, 0)], [4, view(0, 0, -MID)], [5, view(0, 0, MID)],
];
const LABELS = ['−x', '+x', '−y', '+y', '−z', '+z', '−w inner', '+w outer'];
const line = ([a, b]: readonly [[number, number], [number, number]]) => `M${a[0].toFixed(3)} ${a[1].toFixed(3)}L${b[0].toFixed(3)} ${b[1].toFixed(3)}`;

export function CellMap({ className = '' }: { className?: string }) {
  const links = CORNERS.map((c) => line([view(c[0] * IN, c[1] * IN, c[2] * IN), view(c[0] * OUT, c[1] * OUT, c[2] * OUT)]));
  return (
    <figure className={`cellmap ${className}`} aria-label="The eight cells of the tesseract and their colours">
      <svg viewBox="-1.75 -1.75 3.5 3.5" width={140} height={140} fill="none" strokeWidth={1} aria-hidden>
        <path d={links.join('')} stroke="var(--ui)" vectorEffect="non-scaling-stroke" />
        <path d={edges(OUT).map(line).join('')} stroke={CELL_HEX[7]} vectorEffect="non-scaling-stroke" />
        <path d={edges(IN).map(line).join('')} stroke={CELL_HEX[6]} vectorEffect="non-scaling-stroke" />
        {DOTS.map(([id, [x, y]]) => <circle key={id} cx={x} cy={y} r={0.07} fill={CELL_HEX[id]} />)}
      </svg>
      <figcaption>
        {LABELS.map((l, id) => <span key={id}><i style={{ background: CELL_HEX[id] }} />{l}</span>)}
      </figcaption>
    </figure>
  );
}
