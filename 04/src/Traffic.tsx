// Ways of reading the traffic: where it stands, and where the cars on one stretch are going.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage } from 'three';
import { deck, pointOn, type Lane, type Net, type Road, type V } from './net';
import { PARKED, type Sim } from './sim';

/** How high a lane is, s metres along it: on the ground, on a deck, or through a junction up on one. */
function laneZ(l: Lane, s: number) {
  if (!l.road) return l.from.z;
  if (!l.road.bridge) return 0;
  const d = s + l.from.trim;
  return deck(l.road, l.dir === 1 ? d : l.road.len - d);
}

const BIN = 9; // metres of lane to a cell of the heat map
const TAU = 25; // seconds of traffic time a cell remembers

/** cold to hot: an empty lane, one that flows, one that is slow, one that stands */
const RAMP: [number, number, number, number, number][] = [
  [0, 0.1, 0.22, 0.5, 0.35],
  [0.08, 0.1, 0.75, 0.4, 0.8],
  [0.4, 1, 0.82, 0.1, 0.9],
  [0.8, 1, 0.12, 0.05, 0.95],
];
function ramp(v: number, out: Float32Array, o: number) {
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1];
  const t = Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0])));
  for (let k = 0; k < 4; k++) out[o + k] = a[k + 1] + (b[k + 1] - a[k + 1]) * t;
}

/**
 * Every lane painted by how the traffic on it is doing. A car leaves a little heat where it is, more the slower it goes;
 * the heat fades in half a minute, so a queue glows and a free road hardly shows.
 */
export function Heat({ sim, net, speed }: { sim: Sim; net: Net; speed: number }) {
  const rate = useRef(speed);
  rate.current = speed;
  const map = useMemo(() => {
    const where = new Map<Lane, { off: number; n: number; v0: number }>();
    const pos: number[] = [], idx: number[] = [];
    let cells = 0;
    for (const l of net.lanes) {
      if (l.len < 1) continue;
      const n = Math.max(1, Math.ceil(l.len / BIN)), v0 = pos.length / 3;
      where.set(l, { off: cells, n, v0 });
      cells += n;
      const hw = l.road ? l.road.lw * 0.46 : 1.2;
      for (let i = 0; i <= n; i++) {
        const s = (l.len * i) / n;
        const p = pointOn(l.pts, l.cum, s), q = pointOn(l.pts, l.cum, Math.min(l.len, s + 0.5)), b = pointOn(l.pts, l.cum, Math.max(0, s - 0.5));
        const dx = q.x - b.x, dy = q.y - b.y, d = Math.hypot(dx, dy) || 1;
        const z = laneZ(l, s) + 0.22;
        pos.push(p.x - (dy / d) * hw, z, p.y + (dx / d) * hw, p.x + (dy / d) * hw, z, p.y - (dx / d) * hw);
        if (i < n) { const a = v0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    const col = new BufferAttribute(new Float32Array((pos.length / 3) * 4), 4);
    col.setUsage(DynamicDrawUsage);
    geo.setAttribute('color', col);
    geo.setIndex(idx);
    return { where, geo, col, heat: new Float32Array(cells) };
  }, [net]);
  useEffect(() => () => map.geo.dispose(), [map]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * rate.current;
    const { where, heat, col } = map;
    if (dt > 0) {
      const keep = Math.exp(-dt / TAU);
      for (let i = 0; i < heat.length; i++) heat[i] *= keep;
      for (const c of sim.cars) {
        const l = c.lane as Lane | null;
        if (!l || c.state === PARKED) continue;
        const w = where.get(l);
        if (!w) continue;
        const i = w.off + Math.min(w.n - 1, Math.max(0, ((c.s - c.len / 2) / l.len * w.n) | 0));
        const slow = 1 - Math.min(1, c.v / (l.speed || 1));
        heat[i] = Math.min(1, heat[i] + (1 - keep) * (0.3 + 1.4 * slow));
      }
    }
    const a = col.array as Float32Array;
    for (const [, w] of where) {
      for (let i = 0; i <= w.n; i++) {
        // a vertex sits between two cells
        const v = (heat[w.off + Math.max(0, i - 1)] + heat[w.off + Math.min(w.n - 1, i)]) / 2;
        const o = (w.v0 + i * 2) * 4;
        ramp(v, a, o);
        a[o + 4] = a[o]; a[o + 5] = a[o + 1]; a[o + 6] = a[o + 2]; a[o + 7] = a[o + 3];
      }
    }
    col.needsUpdate = true;
  });

  return (
    <mesh geometry={map.geo} frustumCulled={false} renderOrder={5}>
      <meshBasicMaterial vertexColors transparent side={DoubleSide} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  );
}

/** The road under a point, if there is one. */
export function roadAt(net: Net, p: V): Road | null {
  let best: Road | null = null, bd = 8;
  for (const r of net.roads) {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) - r.hw;
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}

const MAX = 40000; // pieces of line, each a thin quad
const tint = new Color();

/**
 * One stretch of road is picked out, and every vehicle on it right now shows its whole journey: where it came in,
 * where it is going. One colour for each way out of town, white for those on their way to park.
 * Each car's line lies a little to one side of the next, so the thick bundles are where most of this road's traffic goes.
 */
export function Journeys({ sim, net, at, note }: { sim: Sim; net: Net; at: V; note?: (text: string) => void }) {
  const road = useMemo(() => roadAt(net, at), [net, at]);
  const lines = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(MAX * 12), 3), col = new BufferAttribute(new Float32Array(MAX * 12), 3);
    pos.setUsage(DynamicDrawUsage); col.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('color', col);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    return { geo, pos, col };
  }, []);
  useEffect(() => () => lines.geo.dispose(), [lines]);
  // the stretch itself, lit up
  const mark = useMemo(() => {
    const pos: number[] = [], idx: number[] = [];
    if (road) {
      for (const l of net.lanes) {
        if (l.road !== road || l.len < 1) continue;
        const n = Math.max(1, Math.ceil(l.len / 8)), v0 = pos.length / 3, hw = road.lw * 0.5;
        for (let i = 0; i <= n; i++) {
          const s = (l.len * i) / n;
          const p = pointOn(l.pts, l.cum, s), q = pointOn(l.pts, l.cum, Math.min(l.len, s + 0.5)), b = pointOn(l.pts, l.cum, Math.max(0, s - 0.5));
          const dx = q.x - b.x, dy = q.y - b.y, d = Math.hypot(dx, dy) || 1, z = laneZ(l, s) + 0.3;
          pos.push(p.x - (dy / d) * hw, z, p.y + (dx / d) * hw, p.x + (dy / d) * hw, z, p.y - (dx / d) * hw);
          if (i < n) { const a = v0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    return geo;
  }, [net, road]);
  useEffect(() => () => mark.dispose(), [mark]);

  const tick = useRef(0), said = useRef('');
  useFrame(() => {
    // the routes change slowly: a few times a second is plenty
    if (tick.current++ % 8) return;
    const p = lines.pos.array as Float32Array, c = lines.col.array as Float32Array;
    let n = 0, cars = 0;
    if (road) {
      for (const car of sim.cars) {
        const on = car.lane as Lane | null;
        if (!on || on.road !== road || car.state === PARKED) continue;
        cars++;
        const route = car.route as Lane[];
        const end = route[route.length - 1];
        if (car.stall) tint.setRGB(0.9, 0.9, 0.9);
        else tint.setHSL(((end ? end.to.id : 0) * 0.381966) % 1, 1, 0.55);
        // its own place across the lane, so that lines side by side read as a bundle
        const side = (((car.id * 0.618034) % 1) - 0.5) * 2.4, W = 0.42;
        for (let k = 0; k < route.length; k++) {
          const l = route[k];
          // what is behind it is fainter than what is ahead
          const g = k < car.ri ? 0.35 : 1;
          for (let i = 1; i < l.pts.length && n < MAX; i++) {
            const a = l.pts[i - 1], b = l.pts[i];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
            const za = laneZ(l, l.cum[i - 1]) + 0.5, zb = laneZ(l, l.cum[i]) + 0.5, o = n * 12;
            p[o] = a.x + nx * (side - W); p[o + 1] = za; p[o + 2] = a.y + ny * (side - W);
            p[o + 3] = a.x + nx * (side + W); p[o + 4] = za; p[o + 5] = a.y + ny * (side + W);
            p[o + 6] = b.x + nx * (side - W); p[o + 7] = zb; p[o + 8] = b.y + ny * (side - W);
            p[o + 9] = b.x + nx * (side + W); p[o + 10] = zb; p[o + 11] = b.y + ny * (side + W);
            for (let q = 0; q < 12; q += 3) { c[o + q] = tint.r * g; c[o + q + 1] = tint.g * g; c[o + q + 2] = tint.b * g; }
            n++;
          }
        }
      }
    }
    lines.geo.setDrawRange(0, n * 6);
    // only what is drawn is sent to the card, not the whole of a buffer made for the worst case
    for (const a of [lines.pos, lines.col]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(12, n * 12)); a.needsUpdate = true; }
    const text = road ? `${cars} on this stretch` : 'no road there';
    if (note && text !== said.current) note((said.current = text));
  });

  return (
    <>
      <mesh geometry={mark} frustumCulled={false} renderOrder={6}>
        <meshBasicMaterial color={0xffffff} transparent opacity={0.3} side={DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
      <mesh geometry={lines.geo} frustumCulled={false} renderOrder={7}>
        <meshBasicMaterial vertexColors transparent opacity={0.92} side={DoubleSide} depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
    </>
  );
}
