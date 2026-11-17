// Where people live: compounds of slab blocks in rows, a few towers at the edges, and the concrete between them.
// Planted once, from the place as it stood. Nothing takes them down: roads go round.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three';
import { BANDED, BAY, CELLS, FLOOR, GALLERY, GLOW, LOW, PAINTED, STRIPED, facades } from './facade';
import { NIGHT, glowing } from './haze';
import { pavingGeometry, rectClear } from './geo';
import { rng, type Building, type Net, type Rect, type V } from './net';

export interface Block extends Rect {
  h: number;
  wall: number;
  roof: number;
  /** which face it wears, see facade.ts */
  style: number;
  /** the footpath from its door to the next block, or out to the road */
  path: V[];
  /** turned out of the grid: radians about its middle. Its own rect is then what it covers, and `inner` the house */
  turn?: number;
  inner?: Rect;
  /** one of the little ones by the road: a road painted through it takes it down, where a big house stops the road */
  small?: boolean;
  /** a filling station's roof over the pumps, and the yard both stand on */
  pumps?: Building;
  pad?: Rect;
}

/** A point of a house, turned with it. */
export function turned(b: Block, x: number, y: number): [number, number] {
  if (!b.turn) return [x, y];
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, c = Math.cos(b.turn), n = Math.sin(b.turn);
  return [cx + (x - cx) * c + (y - cy) * n, cy - (x - cx) * n + (y - cy) * c];
}

/** What the little ones by the road are, and what they look like from above: walls, roof, floor to floor. */
const SMALL = {
  house: { w: [7, 11], d: [6, 9], h: 3.2 },
  // made up, all three: a burger place under a red roof, a coffee drive-through under a green one, a filling station in white
  food: { w: [13, 16], d: [9, 11], h: 4.2, wall: 0xe6d6a4, roof: 0xb5352b },
  coffee: { w: [9, 12], d: [7, 9], h: 4, wall: 0xd9cfbb, roof: 0x2f5e48 },
  fuel: { w: [8, 10], d: [6, 7], h: 3.6, wall: 0xe9e7e1, roof: 0xd9d6cf },
} as const;

/**
 * The little ones: houses, and along the bigger roads a burger place, a coffee place, a filling station. Each stands by a road,
 * square to it, wherever the big ones and the roads have left room. `taken` is what stands already.
 */
export function plantSmall(net: Net, taken: Block[], many = 210, salt = 0, wide = false): Block[] {
  const r = rng(91 + salt), out: Block[] = [];
  // a tile among others is built on to its edge; the place on its own thins out into the haze
  const fx = wide ? 590 : 400, fy = wide ? 590 : 380;
  if (wide) many = Math.round(many * 2.2);
  const roads = net.roads.filter((o) => !o.bridge && !o.ring && o.rank >= 1 && o.len > 30);
  if (!roads.length) return out;
  const clash = (b: Rect, gap: number) => [...taken, ...out].some((o) => b.x0 < o.x1 + gap && b.x1 > o.x0 - gap && b.y0 < o.y1 + gap && b.y1 > o.y0 - gap);
  for (let tries = 0; tries < many * 30 && out.length < many; tries++) {
    const road = roads[(r() * roads.length) | 0], i = (r() * (road.pts.length - 1)) | 0, t = r();
    const a = road.pts[i], b = road.pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, side = r() < 0.5 ? -1 : 1;
    const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
    if (Math.abs(px) > fx || Math.abs(py) > fy) continue;
    const k = r(), square = Math.abs(dx) > 0.985 || Math.abs(dy) > 0.985;
    // trade wants a road with traffic on it; a filling station is only built square to the map, since its roof cannot be turned
    const kind = road.rank < 2 || k > 0.3 ? 'house' : k < 0.1 && square ? 'fuel' : k < 0.2 ? 'food' : 'coffee';
    const s = SMALL[kind], w = s.w[0] + r() * (s.w[1] - s.w[0]), d = s.d[0] + r() * (s.d[1] - s.d[0]);
    // a filling station stands back behind its pumps
    const back = road.hw + (kind === 'fuel' ? 17 : kind === 'house' ? 7 + r() * 5 : 9) + d / 2;
    const cx = px - dy * side * back, cy = py + dx * side * back;
    const turn = square ? 0 : Math.atan2(-dy, dx);
    const along = square && Math.abs(dy) > 0.5;
    const hw = (along ? d : w) / 2, hd = (along ? w : d) / 2;
    const c = Math.abs(Math.cos(turn)), n = Math.abs(Math.sin(turn));
    const box = { x0: cx - (hw * c + hd * n), y0: cy - (hw * n + hd * c), x1: cx + (hw * c + hd * n), y1: cy + (hw * n + hd * c) };
    // the whole plot of a filling station has to be free: from the road back to the shop
    const plot = kind === 'fuel'
      ? { x0: Math.min(box.x0, px - dy * side * (road.hw + 5) - 9 * Math.abs(dx)), y0: Math.min(box.y0, py + dx * side * (road.hw + 5) - 9 * Math.abs(dy)), x1: Math.max(box.x1, px - dy * side * (road.hw + 5) + 9 * Math.abs(dx)), y1: Math.max(box.y1, py + dx * side * (road.hw + 5) + 9 * Math.abs(dy)) }
      : box;
    if (!stands(net, box, 3) || clash(plot, kind === 'house' ? 2 : 4)) continue;
    const look = 'wall' in s ? { wall: s.wall, roof: s.roof } : { wall: WALLS[(r() * WALLS.length) | 0], roof: ROOFS[(r() * ROOFS.length) | 0] };
    const house: Block = { ...box, h: s.h * (kind === 'house' && r() < 0.35 ? 2 : 1), style: LOW, ...look, path: [], small: true };
    if (turn) { house.turn = turn; house.inner = { x0: cx - hw, y0: cy - hd, x1: cx + hw, y1: cy + hd }; }
    // the door looks at the road, and the path goes straight to its edge
    house.path = [{ x: cx + dy * side * (d / 2), y: cy - dx * side * (d / 2) }, { x: px - dy * side * (road.hw + 1), y: py + dx * side * (road.hw + 1) }];
    if (kind === 'fuel') {
      // the roof over the pumps, between the shop and the road, and the yard under all of it
      const mx = px - dy * side * (road.hw + 8), my = py + dx * side * (road.hw + 8);
      const rw = along ? 4 : 8, rd = along ? 8 : 4;
      house.pumps = { x0: mx - rw, y0: my - rd, x1: mx + rw, y1: my + rd, h: 5.2, wall: 0xcfd2d4, roof: 0xf1efe9, canopy: true };
      house.pad = { x0: plot.x0 - 1, y0: plot.y0 - 1, x1: plot.x1 + 1, y1: plot.y1 + 1 };
    }
    out.push(house);
  }
  return out;
}

/** A quarter of the houses stand at an angle, where there is room to: nothing is built to one grid. */
export function turnSome(net: Net, blocks: Block[], share = 0.25, salt = 0): Block[] {
  const r = rng(53 + salt), out = [...blocks];
  const order = out.map((_, i) => i).sort(() => r() - 0.5);
  let left = Math.round(out.length * share);
  for (const i of order) {
    if (left <= 0) break;
    const b = out[i], w = b.x1 - b.x0, d = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    for (let tries = 0; tries < 4; tries++) {
      const turn = (r() < 0.5 ? -1 : 1) * (0.26 + r() * 0.52);
      const c = Math.abs(Math.cos(turn)), n = Math.abs(Math.sin(turn));
      const hx = (w * c + d * n) / 2, hy = (w * n + d * c) / 2;
      const box = { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
      if (!stands(net, box, 5) || out.some((o, k) => k !== i && box.x0 < o.x1 + 6 && box.x1 > o.x0 - 6 && box.y0 < o.y1 + 6 && box.y1 > o.y0 - 6)) continue;
      const t: Block = { ...b, ...box, turn, inner: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } };
      if (b.path.length) { const [x, y] = turned(t, b.path[0].x, b.path[0].y); t.path = [{ x, y }, ...b.path.slice(1)]; }
      out[i] = t;
      left--;
      break;
    }
  }
  return out;
}

const WALLS = [0xd8d4c8, 0xcfc9b8, 0xd9cfc4, 0xc4c9cc, 0xe0dcd2, 0xd2c3b4, 0xbfc6c2];
/** the strong paints of an estate, faded by the sun */
const PAINTS = [0xe391a6, 0xc9534a, 0xe3bf5c, 0x8fc7b3, 0x86abd1, 0xdf9257, 0xd9a3a0, 0xa6c48a];
const ROOFS = [0x6f8fb0, 0x5f7f9f, 0xb9b6ae, 0xa9a69e, 0x8d6a58, 0x7d93a8];

/** Is this block still standing on this network? A bridge may pass over it. */
export const stands = (net: Net, b: Rect, margin = 0) => rectClear(net, b, margin);

export function plantTown(net: Net, salt = 0, wide = false): Block[] {
  const r = rng(41 + salt);
  // the looks have their own dice, so the town stands where it stood
  const q = rng(77 + salt);
  // a tile among others is built on to its edge, with as many more houses as there is more ground
  const W = wide ? 1.62 : 1, N = wide ? 2.6 : 1;
  const look = (style: number, wall: number) => ({ style, wall: style === GALLERY || (style === LOW && q() < 0.6) ? wall : PAINTS[(q() * PAINTS.length) | 0] });
  const out: Block[] = [];
  const free = (b: Rect, gap = 10) => stands(net, b, 5) && !out.some((o) => b.x0 < o.x1 + gap && b.x1 > o.x0 - gap && b.y0 < o.y1 + gap && b.y1 > o.y0 - gap);
  /** the nearest point of any road, for the way out */
  const gate = (p: V): V => {
    let best = p, bd = Infinity;
    for (const road of net.roads) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const a = road.pts[i], b = road.pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const q = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; best = q; }
      }
    }
    return best;
  };

  // compounds: rows of slabs, all facing the same way, as they are built
  for (let tries = 0; tries < 1600 * N && out.length < 34 * N; tries++) {
    // the middle fills first, then the edges
    const reach = (tries < 800 ? 0.72 : 1) * W;
    const ox = (r() - 0.5) * 700 * reach, oy = (r() - 0.5) * 640 * reach;
    const cols = 1 + ((r() * 2) | 0), rows = 2 + ((r() * 3) | 0);
    const w = 32 + r() * 14, d = 11 + r() * 2.5, floors = 6 + ((r() * 4) | 0);
    const pale = WALLS[(r() * WALLS.length) | 0], roof = ROOFS[(r() * ROOFS.length) | 0];
    const k = q();
    const { style, wall } = look(k < 0.4 ? GALLERY : k < 0.65 ? PAINTED : k < 0.87 ? BANDED : STRIPED, pale);
    const made: Block[] = [];
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < rows; k++) {
        const x0 = ox + c * (w + 12), y0 = oy + k * (d + 17);
        const b: Block = { x0, y0, x1: x0 + w, y1: y0 + d, h: floors * 3 + (r() < 0.3 ? 3 : 0), wall, roof, style, path: [] };
        if (free(b)) made.push(b);
      }
    }
    if (made.length < 2) continue;
    made.forEach((b, i) => {
      const door = { x: (b.x0 + b.x1) / 2, y: b.y1 };
      const nx = made[i + 1];
      // down the middle to the next row; the last one walks out to the road
      b.path = nx && Math.abs(nx.x0 - b.x0) < 1 ? [door, { x: door.x, y: nx.y0 }] : [door, { x: door.x, y: door.y + 6 }, gate({ x: door.x, y: door.y + 6 })];
    });
    out.push(...made);
  }
  // and the odd ones: shops, workshops, a house someone built where there was room
  for (let tries = 0, made = 0; tries < 900 * N && made < 28 * N; tries++) {
    const x = (r() - 0.5) * 680 * W, y = (r() - 0.5) * 620 * W;
    const w = 9 + r() * 12, d = 8 + r() * 8;
    const b: Block = { x0: x, y0: y, x1: x + w, y1: y + d, h: (1 + ((r() * 4) | 0)) * 3.2, roof: ROOFS[(r() * ROOFS.length) | 0], ...look(LOW, WALLS[(r() * WALLS.length) | 0]), path: [] };
    if (!free(b, 3)) continue;
    const door = { x: (b.x0 + b.x1) / 2, y: b.y1 };
    const g = gate(door);
    if (Math.hypot(g.x - door.x, g.y - door.y) < 90) b.path = [door, g];
    out.push(b);
    made++;
  }
  // a few towers further out, pale in the haze
  for (let tries = 0, cap = out.length + 12 * N; tries < 200 * N && out.length < cap; tries++) {
    const x = (r() - 0.5) * 780 * (wide ? 1.45 : 1), y = (r() - 0.5) * 720 * (wide ? 1.55 : 1);
    if (Math.abs(x) < 230 && Math.abs(y) < 200) continue;
    const s = 17 + r() * 5;
    const b: Block = { x0: x, y0: y, x1: x + s, y1: y + s * (0.8 + r() * 0.4), h: 36 + r() * 18, roof: 0xb9b6ae, ...look(q() < 0.6 ? STRIPED : PAINTED, WALLS[(r() * WALLS.length) | 0]), path: [] };
    if (!free(b)) continue;
    const door = { x: (b.x0 + b.x1) / 2, y: b.y1 };
    b.path = [door, gate(door)];
    out.push(b);
  }
  return out;
}

const HASH = /* glsl */ `float wh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`;

/** Walls that wear a sheet from facade.ts: whole bays and whole floors, whatever the box is scaled to. After dark some of the rooms are lit. */
function walls() {
  const m = new MeshStandardMaterial({ roughness: 0.85 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uFacade = { value: facades() };
    s.uniforms.uNight = NIGHT;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStyle; varying float vStyle; varying vec3 vLp; varying vec3 vSz; varying vec3 vOn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSz = vec3(1.0);
        #ifdef USE_INSTANCING
          vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vLp = position * vSz; vOn = normal; vStyle = aStyle;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray uFacade; uniform float uNight; varying float vStyle; varying vec3 vLp; varying vec3 vSz; varying vec3 vOn;\n' + HASH)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 rooms = vec3(0.0);
        if (abs(vOn.y) < 0.5) {
          bool side = abs(vOn.x) > 0.5;
          float len = side ? vSz.z : vSz.x;
          float u = (side ? vLp.z : vLp.x) / len + 0.5, v = vLp.y / vSz.y + 0.5;
          float seed = wh(vSz.xz);
          vec3 paint = diffuseColor.rgb;
          if (side && vSz.x > vSz.z * 1.8) {
            // the end of a slab is a blank wall, with the rain run down it
            diffuseColor.rgb = paint * (0.8 + 0.14 * wh(vec2(floor(u * len / 0.8), seed)));
            diffuseColor.rgb *= 1.0 - 0.12 * step(fract(v * vSz.y / ${FLOOR.toFixed(1)}), 0.07);
          } else {
            vec2 n = max(vec2(1.0), floor(vec2(len / ${BAY.toFixed(1)}, vSz.y / ${FLOOR.toFixed(1)}) + 0.5));
            vec2 st = (vec2(u, v) * n + floor(vec2(seed, fract(seed * 7.3)) * ${CELLS.toFixed(1)})) / ${CELLS.toFixed(1)};
            vec4 t = texture(uFacade, vec3(st, vStyle));
            diffuseColor.rgb = t.rgb * mix(vec3(1.0), paint, t.a);
            if (uNight > 0.0) {
              // somebody is home in half of the rooms, and they do not all reach for the switch at once
              float home = wh(floor(vec2(u, v) * n) * 1.7 + vSz.xz + 3.0) / 0.5;
              rooms = texture(uFacade, vec3(st, vStyle + ${GLOW.toFixed(1)})).rgb * step(home, 1.0) * smoothstep(home * 0.7, home * 0.7 + 0.3, uNight) * 2.4;
            }
          }
          // no two stretches of wall have weathered alike
          diffuseColor.rgb *= 0.9 + 0.1 * wh(vec2(floor(u * len / 6.4), floor(v * vSz.y / 6.0)) + vSz.xz);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += rooms;');
  };
  m.customProgramCacheKey = () => 'walls-lit';
  return glowing(m);
}

export function Town({ net, blocks, paving, roofing }: { net: Net; blocks: Block[]; paving: MeshStandardMaterial; roofing: MeshStandardMaterial }) {
  const body = useRef<InstancedMesh>(null), cap = useRef<InstancedMesh>(null), kit = useRef<InstancedMesh>(null), tank = useRef<InstancedMesh>(null);
  const wall = useMemo(walls, []);
  // every house stays up: the roads are the ones that give way
  const up = blocks;

  const ground = useMemo(
    () => pavingGeometry(
      [
        // the big ones stand on a slab of concrete; a little one stands on the grass, with only its path to the road
        ...up.filter((b) => !b.small).map((b) => ({ x0: b.x0 - 3.5, y0: b.y0 - 3.5, x1: b.x1 + 3.5, y1: b.y1 + 3.5 })),
        // where a road ends at a building, the ground between them is paved: a forecourt
        ...net.nodes.filter((n) => n.stub && !n.edge).flatMap((n) =>
          up.filter((b) => !b.small && Math.hypot(Math.max(b.x0 - n.p.x, 0, n.p.x - b.x1), Math.max(b.y0 - n.p.y, 0, n.p.y - b.y1)) < 34)
            .map((b) => ({ x0: Math.min(b.x0 - 3.5, n.p.x - 9), y0: Math.min(b.y0 - 3.5, n.p.y - 9), x1: Math.max(b.x1 + 3.5, n.p.x + 9), y1: Math.max(b.y1 + 3.5, n.p.y + 9) }))),
      ],
      up.filter((b) => b.path.length > 1).map((b) => ({ pts: b.path, hw: b.small ? 0.8 : 1.3 })),
    ),
    [up, net],
  );
  useEffect(() => () => ground.dispose(), [ground]);

  useLayoutEffect(() => {
    const o = new Object3D(), c = new Color(), r = rng(9), spin = new Matrix4();
    let k = 0, t = 0;
    body.current!.geometry.setAttribute('aStyle', new InstancedBufferAttribute(Float32Array.from(up, (b) => b.style), 1));
    up.forEach((b, i) => {
      // a turned house is laid out straight and then swung round its middle
      const q = b.inner ?? b;
      const fix = () => {
        o.updateMatrix();
        if (!b.turn) return;
        // where the turn leaves the origin is all the shift there is
        const [tx, tz] = turned(b, 0, 0);
        o.matrix.premultiply(spin.makeRotationY(b.turn).setPosition(tx, 0, tz));
      };
      const w = q.x1 - q.x0, d = q.y1 - q.y0, cx = (q.x0 + q.x1) / 2, cz = (q.y0 + q.y1) / 2;
      o.position.set(cx, b.h / 2, cz); o.scale.set(w, b.h, d); fix();
      body.current!.setMatrixAt(i, o.matrix);
      body.current!.setColorAt(i, c.setHex(b.wall));
      // the roof deck, down inside its parapet
      o.position.set(cx, b.h + 0.05, cz); o.scale.set(w - 0.6, 0.1, d - 0.6); fix();
      cap.current!.setMatrixAt(i, o.matrix);
      cap.current!.setColorAt(i, c.setHex(b.roof));
      const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: number, tilt = 0) => {
        o.position.set(x, b.h + y + sy / 2, z); o.scale.set(sx, sy, sz); o.rotation.set(tilt, 0, 0); fix();
        kit.current!.setMatrixAt(k, o.matrix);
        kit.current!.setColorAt(k++, c.setHex(col));
        o.rotation.set(0, 0, 0);
      };
      const rim = 0xd9d7cf;
      put(cx, 0, q.y0 + 0.2, w, 0.9, 0.4, rim); put(cx, 0, q.y1 - 0.2, w, 0.9, 0.4, rim);
      put(q.x0 + 0.2, 0, cz, 0.4, 0.9, d - 0.8, rim); put(q.x1 - 0.2, 0, cz, 0.4, 0.9, d - 0.8, rim);
      // how much there is room for
      const room = Math.min(1, (w * d) / 380);
      const at = (mx: number, mz: number) => [q.x0 + mx + r() * Math.max(0, w - 2 * mx), q.y0 + mz + r() * Math.max(0, d - 2 * mz)];
      // stair heads
      for (let n = 0; n < (w > 24 ? 2 : 1); n++) {
        const [x, z] = at(3, 2.6);
        put(x, 0, z, 3.4, 2.5 + r() * 0.5, 3.8, r() < 0.5 ? 0xd4d1c6 : 0xbdb9ae);
      }
      // a room somebody added, under a roof of blue tin
      if (r() < 0.75 * room + 0.1) {
        const [x, z] = at(5, 3);
        const sx = 4 + r() * 6 * room, sz = 3 + r() * 2.5;
        put(x, 0, z, sx, 2.2, sz, 0xcfcabd);
        put(x, 2.2, z, sx + 0.8, 0.18, sz + 0.8, [0x3f74b5, 0x3f74b5, 0x4a86c6, 0x9a4a35, 0x3d7a66, 0xb9bcc0][(r() * 6) | 0]);
      }
      // tubs of earth: greens, and a tree gone yellow
      for (let n = (r() * 4 * room) | 0; n > 0; n--) {
        const [x, z] = at(2, 2);
        put(x, 0, z, 1.5 + r() * 4, 0.5 + r() * 0.5, 1.2 + r() * 1.6, [0x4f6a2c, 0x5d7430, 0x3f5a2a, 0xb08a2a, 0x8a5a2a][(r() * 5) | 0]);
      }
      // sun heaters: a rack of dark tubes leaning south, each with its tank
      for (let n = (r() * 5 * room) | 0; n > 0; n--) {
        const [x, z] = at(2.5, 2.5);
        put(x, 0.5, z, 2 + r() * 0.8, 0.12, 2.2, 0x1c2640, -0.55);
        o.position.set(x, b.h + 1.75, z - 1); o.scale.set(0.42, 2.2 + r() * 0.6, 0.42); o.rotation.set(0, 0, Math.PI / 2); fix();
        tank.current!.setMatrixAt(t++, o.matrix);
        o.rotation.set(0, 0, 0);
      }
      // and water kept on the roof, in steel
      for (let n = r() < 0.7 ? 1 + ((r() * 2 * room) | 0) : 0; n > 0; n--) {
        const [x, z] = at(2.5, 2.5);
        const s = 1 + r() * 0.6;
        o.position.set(x, b.h + 0.6 + s, z); o.scale.set(s, s * 2, s); fix();
        tank.current!.setMatrixAt(t++, o.matrix);
      }
    });
    tank.current!.count = t;
    tank.current!.instanceMatrix.needsUpdate = true;
    for (const m of [body.current!, cap.current!, kit.current!]) {
      m.count = m === kit.current ? k : up.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [up]);

  const n = Math.max(1, blocks.length);
  return (
    <group>
      <mesh geometry={ground} material={paving} receiveShadow />
      <instancedMesh ref={body} args={[undefined, undefined, n]} material={wall} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
      <instancedMesh ref={cap} args={[undefined, undefined, n]} material={roofing} receiveShadow frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
      <instancedMesh ref={kit} args={[undefined, undefined, n * 18]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.7} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={tank} args={[undefined, undefined, n * 8]} castShadow receiveShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshStandardMaterial color={0xc9cdd0} roughness={0.35} metalness={0.7} />
      </instancedMesh>
    </group>
  );
}

/** A house and all that belongs to it, moved: a tile's town is planted round 0, 0 and set down where the tile lies. */
export function shifted(b: Block, dx: number, dy: number): Block {
  if (!dx && !dy) return b;
  const box = <T extends Rect>(q: T): T => ({ ...q, x0: q.x0 + dx, y0: q.y0 + dy, x1: q.x1 + dx, y1: q.y1 + dy });
  return { ...box(b), path: b.path.map((p) => ({ x: p.x + dx, y: p.y + dy })), inner: b.inner && box(b.inner), pumps: b.pumps && box(b.pumps), pad: b.pad && box(b.pad) };
}
