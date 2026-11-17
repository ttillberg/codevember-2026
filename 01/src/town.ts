// The board's print: a cobbled town square with streets running out of it, lanes round the
// blocks about it, one block of green card, at the houses' own scale (a stone about 3 mm, a
// street a house wide), so what stands on it looks at home. Board mm, the board's middle at
// 0,0. Buildings stand round the square, not on it, nor on the streets or the green.

export const MAP = { w: 1200, d: 900 };

type R = { x0: number; z0: number; x1: number; z1: number };
const box = (x0: number, z0: number, x1: number, z1: number): R => ({ x0, z0, x1, z1 });

// the square, and the streets going out of it: kept clear when a building is put down
export const SQUARE = box(-74, -54, 74, 54);
const ST = 13; // half a street
const LN = 10; // half a lane
const RING = { x: 330, z: 230 }; // the lanes round the blocks about the square
export const STREETS: R[] = [
  box(-ST + 20, -MAP.d / 2, ST + 20, SQUARE.z0), // north, a little off the middle
  box(-ST - 10, SQUARE.z1, ST - 10, MAP.d / 2), // south
  box(SQUARE.x1, -ST, MAP.w / 2, ST), // east
  box(-MAP.w / 2, -ST - 6, SQUARE.x0, ST - 6), // west
  // lanes across them: the blocks round the square, and more out beyond
  box(-MAP.w / 2, -RING.z - LN, MAP.w / 2, -RING.z + LN),
  box(-MAP.w / 2, RING.z - LN, MAP.w / 2, RING.z + LN),
  box(-RING.x - LN, -MAP.d / 2, -RING.x + LN, MAP.d / 2),
  box(RING.x - LN, -MAP.d / 2, RING.x + LN, MAP.d / 2),
];
// a little green: the whole block north-east of the square, a sheet of green card laid on it
const PAVE = 7, CURB = 1.6;
const EDGE = PAVE + CURB;
export const PARK = box(ST + 20 + EDGE, -RING.z + LN + EDGE, RING.x - LN - EDGE, -ST - EDGE);
export const OPEN = [SQUARE, ...STREETS, PARK];

const C = {
  ground: '#cdbf9f',
  stone: ['#a39c90', '#9a9286', '#aca598', '#958d80', '#b2ab9f'],
  joint: '#6f685d',
  curb: '#c9c6bd',
  curb2: '#8f8b82',
  slab: '#c4bba8',
  slab2: '#a89f8c',
  gravel: '#d3c7a9',
};

export function drawMap(g: CanvasRenderingContext2D, px: number) {
  const W = MAP.w * px, D = MAP.d * px;
  const X = (x: number) => (x + MAP.w / 2) * px;
  const Z = (z: number) => (z + MAP.d / 2) * px;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // the blocks: packed gravel, speckled
  g.fillStyle = C.ground;
  g.fillRect(0, 0, W, D);
  for (let i = 0; i < MAP.w * MAP.d * 0.08; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(110, 92, 60, 0.14)' : 'rgba(245, 235, 210, 0.16)';
    g.fillRect(rnd() * W, rnd() * D, (0.4 + rnd()) * px * 0.6, (0.4 + rnd()) * px * 0.5);
  }

  // a stone: a rounded block, a little uneven
  const stone = (cx: number, cz: number, w: number, d: number, a = 0) => {
    g.save();
    g.translate(X(cx), Z(cz));
    g.rotate(a);
    g.fillStyle = C.stone[Math.floor(rnd() * C.stone.length)];
    const ww = (w - 0.45) * px * (0.9 + 0.1 * rnd()), dd = (d - 0.45) * px * (0.9 + 0.1 * rnd());
    g.beginPath();
    g.roundRect(-ww / 2, -dd / 2, ww, dd, Math.min(ww, dd) * 0.3);
    g.fill();
    g.restore();
  };
  const joints = (r: R) => { g.fillStyle = C.joint; g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * px, (r.z1 - r.z0) * px); };

  // the green: card, its fibres, faint flutes showing through, a darker cut edge (the
  // square's pavement runs over its corner)
  {
    const P = PARK;
    const x = X(P.x0), z = Z(P.z0), w = (P.x1 - P.x0) * px, d = (P.z1 - P.z0) * px;
    g.fillStyle = 'rgba(60, 50, 30, 0.25)';
    g.fillRect(x + 0.8 * px, z + 0.8 * px, w, d);
    g.fillStyle = '#8f9f6a';
    g.fillRect(x, z, w, d);
    for (let fz = P.z0 + 2; fz < P.z1; fz += 4) {
      g.fillStyle = 'rgba(255, 255, 230, 0.05)';
      g.fillRect(x, Z(fz), w, 2 * px);
    }
    for (let i = 0; i < (P.x1 - P.x0) * (P.z1 - P.z0) * 0.25; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(50, 60, 30, 0.16)' : 'rgba(235, 240, 200, 0.16)';
      g.fillRect(x + rnd() * w, z + rnd() * d, (0.5 + rnd() * 1.5) * px, 0.3 * px);
    }
    g.strokeStyle = '#6d7c4c';
    g.lineWidth = 0.8 * px;
    g.strokeRect(x, z, w, d);
  }

  // pavements of flagstones along each street, a granite curb between
  const pavement = (r: R, alongX: boolean) => {
    g.fillStyle = C.slab;
    g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * px, (r.z1 - r.z0) * px);
    g.strokeStyle = C.slab2;
    g.lineWidth = 0.35 * px;
    const step = 7;
    if (alongX) for (let x = r.x0; x < r.x1; x += step) { g.beginPath(); g.moveTo(X(x), Z(r.z0)); g.lineTo(X(x), Z(r.z1)); g.stroke(); }
    else for (let z = r.z0; z < r.z1; z += step) { g.beginPath(); g.moveTo(X(r.x0), Z(z)); g.lineTo(X(r.x1), Z(z)); g.stroke(); }
  };
  for (const s of STREETS) {
    const alongX = s.x1 - s.x0 > s.z1 - s.z0;
    if (alongX) {
      pavement(box(s.x0, s.z0 - PAVE - CURB, s.x1, s.z0 - CURB), true);
      pavement(box(s.x0, s.z1 + CURB, s.x1, s.z1 + CURB + PAVE), true);
    } else {
      pavement(box(s.x0 - PAVE - CURB, s.z0, s.x0 - CURB, s.z1), false);
      pavement(box(s.x1 + CURB, s.z0, s.x1 + CURB + PAVE, s.z1), false);
    }
  }
  // round the square too
  const ring = box(SQUARE.x0 - PAVE - CURB, SQUARE.z0 - PAVE - CURB, SQUARE.x1 + PAVE + CURB, SQUARE.z1 + PAVE + CURB);
  pavement(ring, true);

  // granite curbs down both sides of every street (where streets cross, the cobbles cover them)
  g.strokeStyle = C.curb;
  g.lineWidth = CURB * px;
  for (const s of STREETS) {
    const alongX = s.x1 - s.x0 > s.z1 - s.z0;
    g.beginPath();
    if (alongX) {
      g.moveTo(X(s.x0), Z(s.z0 - CURB / 2)); g.lineTo(X(s.x1), Z(s.z0 - CURB / 2));
      g.moveTo(X(s.x0), Z(s.z1 + CURB / 2)); g.lineTo(X(s.x1), Z(s.z1 + CURB / 2));
    } else {
      g.moveTo(X(s.x0 - CURB / 2), Z(s.z0)); g.lineTo(X(s.x0 - CURB / 2), Z(s.z1));
      g.moveTo(X(s.x1 + CURB / 2), Z(s.z0)); g.lineTo(X(s.x1 + CURB / 2), Z(s.z1));
    }
    g.stroke();
  }

  // the streets: cobbles in rows across them
  for (const s of STREETS) {
    joints(s);
    const alongX = s.x1 - s.x0 > s.z1 - s.z0;
    const sw = 3.2, sd = 2.6;
    if (alongX) {
      for (let x = s.x0; x < s.x1; x += sd) {
        const off = (Math.round((x - s.x0) / sd) % 2) * sw * 0.5;
        for (let z = s.z0 - off; z < s.z1; z += sw) if (z + sw / 2 > s.z0 && z - sw / 2 < s.z1) stone(x + sd / 2, z + sw / 2, sd, sw);
      }
    } else {
      for (let z = s.z0; z < s.z1; z += sd) {
        const off = (Math.round((z - s.z0) / sd) % 2) * sw * 0.5;
        for (let x = s.x0 - off; x < s.x1; x += sw) if (x + sw / 2 > s.x0 && x - sw / 2 < s.x1) stone(x + sw / 2, z + sd / 2, sw, sd);
      }
    }
  }


  // the square: cobbles laid in fans, rows of arcs across it
  joints(SQUARE);
  g.save();
  g.beginPath();
  g.rect(X(SQUARE.x0), Z(SQUARE.z0), (SQUARE.x1 - SQUARE.x0) * px, (SQUARE.z1 - SQUARE.z0) * px);
  g.clip();
  const FAN = 16; // a fan's radius
  for (let row = 0, z0 = SQUARE.z0 - FAN; z0 < SQUARE.z1 + FAN; row++, z0 += FAN * 0.5) {
    for (let x0 = SQUARE.x0 - FAN + (row % 2) * FAN; x0 < SQUARE.x1 + FAN; x0 += FAN * 2) {
      for (let rr = FAN; rr > 1; rr -= 2.7) {
        const n = Math.max(2, Math.round((Math.PI * rr * 0.55) / 3));
        for (let k = 0; k < n; k++) {
          const a = Math.PI * (0.22 + (0.56 * (k + 0.5)) / n);
          stone(x0 + Math.cos(a) * rr, z0 + Math.sin(a) * rr, 3, 2.5, a - Math.PI / 2);
        }
      }
    }
  }
  g.restore();

  // granite curb round the square
  g.strokeStyle = C.curb;
  g.lineWidth = CURB * px;
  g.strokeRect(X(SQUARE.x0 - CURB / 2), Z(SQUARE.z0 - CURB / 2), (SQUARE.x1 - SQUARE.x0 + CURB) * px, (SQUARE.z1 - SQUARE.z0 + CURB) * px);
  // the streets run on into the square: open the curb where they meet it
  for (const s of STREETS) {
    g.fillStyle = C.joint;
    const pad = CURB + 0.3;
    if (Math.abs(s.z1 - SQUARE.z0) < 0.1) g.fillRect(X(s.x0), Z(SQUARE.z0 - pad), (s.x1 - s.x0) * px, pad * 2 * px);
    if (Math.abs(s.z0 - SQUARE.z1) < 0.1) g.fillRect(X(s.x0), Z(SQUARE.z1 - pad), (s.x1 - s.x0) * px, pad * 2 * px);
    if (Math.abs(s.x0 - SQUARE.x1) < 0.1) g.fillRect(X(SQUARE.x1 - pad), Z(s.z0), pad * 2 * px, (s.z1 - s.z0) * px);
    if (Math.abs(s.x1 - SQUARE.x0) < 0.1) g.fillRect(X(SQUARE.x0 - pad), Z(s.z0), pad * 2 * px, (s.z1 - s.z0) * px);
  }

  // a statue on its plinth in the middle, a ring of granite round it
  g.fillStyle = C.curb2;
  g.beginPath(); g.arc(X(0), Z(0), 9 * px, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.curb;
  g.beginPath(); g.arc(X(0), Z(0), 7.6 * px, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5f7a6c';
  g.fillRect(X(-3.5), Z(-2.5), 7 * px, 5 * px);
}
