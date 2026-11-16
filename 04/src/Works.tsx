// Road works, drawn from what the traffic knows of them: cones along a lane that is closed, barriers across a road that is,
// a patch of dug-up earth, a truck and a digger parked inside, and amber lamps that blink.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { at, cumLen, type Lane, type Net } from './net';
import { NIGHT, NOW } from './haze';
import type { Sim, Site } from './sim';
import { wet } from './wet';

/** How many boxes all the sites together may be made of. */
const CAP = 480;
const CONE = 0xf26a12, WHITE = 0xecebe6, RED = 0xcf2418, EARTH = 0x96603a, PIT = 0x2b2019, HEAP = 0x6b452e;
const TRUCK = 0xe3b21c, DIGGER = 0xe07814, DARK = 0x1c1d20, STEEL = 0x8f959c, LAMP = 0x5a3a08;
/** What an amber lamp gives off, and how much of its own colour a thing under the work lights gives back after dark. */
const AMBER = [7, 2.9, 0.25], LIT = 0.55;

/** `lamp`: 0 for none, 1 or 2 for an amber lamp that blinks in the first turn or the second, -1 for something the work lights shine on. */
type Box = { x: number; y: number; h: number; l: number; t: number; w: number; ang: number; color: number; lamp: number };

/**
 * Everything is a box, painted. Some of them are lamps, which blink in two turns, by day too. The dig and what stands in it
 * is under work lights after dark: no light, it shines a little by itself.
 */
function paint() {
  const m = new MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNow = NOW;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aLamp; uniform float uNow, uDark; varying vec3 vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = aLamp.rgb * (aLamp.w < 0.0 ? uDark : step(0.5, fract(uNow * 1.3 + aLamp.w * 0.5)) * (0.3 + 0.7 * uDark));');
    s.uniforms.uDark = NIGHT;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLamp;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLamp;');
  };
  m.customProgramCacheKey = () => 'works';
  return m;
}

const P = { x: 0, y: 0, ax: 0, ay: 0 };

/** The boxes of one site. `d` is metres to the right of the line it is laid along. */
function build(w: Site, out: Box[]) {
  let line: Lane, s0: number, s1: number, half: number;
  if (w.lane) { line = w.lane; s0 = w.s0; s1 = w.s1; half = w.lane.road!.lw / 2; }
  else if (w.road) {
    // down the middle of the road, between its junctions
    const pts = w.road.base, cum = cumLen(pts);
    line = { pts, cum, len: cum[cum.length - 1] } as Lane;
    const mid = line.len / 2, reach = Math.min(16, line.len / 2 - 12);
    s0 = mid - reach; s1 = mid + reach; half = w.road.hw;
  } else return;
  // a few lots of its own, so that no two sites are laid out alike
  let seed = w.seed || 1;
  const r = () => ((seed = (seed * 16807) % 2147483647) & 0xffff) / 0x10000;
  const put = (s: number, d: number, h: number, l: number, t: number, wd: number, color: number, lamp = 0, turn = 0) => {
    at(line, s, P);
    out.push({ x: P.x - P.ay * d, y: P.y + P.ax * d, h: h + t / 2, l, t, w: wd, ang: Math.atan2(P.ay, P.ax) + turn, color, lamp });
  };
  const cone = (s: number, d: number, lit = false) => {
    put(s, d, 0, 0.8, 1.05, 0.8, CONE, -1);
    put(s, d, 1.05, 0.5, lit ? 0.4 : 0.16, 0.5, lit ? LAMP : WHITE, lit ? 1 + (out.length & 1) : -1);
  };
  /** red and white boards across the way, with lamps on them */
  const barrier = (s: number, from: number, to: number) => {
    const n = Math.max(2, Math.round((to - from) / 1.3)), step = (to - from) / n;
    for (let i = 0; i < n; i++) {
      put(s, from + (i + 0.5) * step, 0.25, 0.5, 1.0, step, i & 1 ? WHITE : RED, -1);
      if (i % 3 === 0 || i === n - 1) put(s, from + (i + 0.5) * step, 1.25, 0.6, 0.45, 0.6, LAMP, 1 + ((i / 3) & 1));
    }
  };
  /** a tipper: cab, bed with a load, a beacon on the cab */
  const truck = (s: number, d: number, turn: number) => {
    const c = Math.cos(turn), sn = Math.sin(turn), on = (k: number) => [s + k * c, d + k * sn] as const;
    let q = on(1.9);
    put(q[0], q[1], 0.5, 1.8, 1.9, 2.2, TRUCK, -1, turn);
    put(q[0], q[1], 2.4, 0.5, 0.35, 0.5, LAMP, 1, turn);
    q = on(-1.1);
    put(q[0], q[1], 0.6, 4.0, 1.2, 2.3, STEEL, -1, turn);
    put(q[0], q[1], 1.8, 3.5, 0.3, 1.9, HEAP, -1, turn);
  };
  /** a digger: body, cab, and its arm out over the trench */
  const digger = (s: number, d: number, turn: number) => {
    const c = Math.cos(turn), sn = Math.sin(turn);
    put(s, d, 0, 3.0, 0.7, 2.4, DARK, 0, turn);
    put(s, d, 0.7, 2.6, 1.3, 2.1, DIGGER, -1, turn);
    put(s - 0.3 * c, d - 0.3 * sn, 2.0, 1.2, 0.9, 1.1, DARK, 0, turn);
    put(s - 0.3 * c, d - 0.3 * sn, 2.9, 0.5, 0.35, 0.5, LAMP, 2, turn);
    put(s + 3.0 * c, d + 3.0 * sn, 1.9, 3.6, 0.4, 0.45, DIGGER, -1, turn);
  };

  const wide = 2 * half;
  if (w.lane) {
    // cones lead the traffic out of the lane, run along the line beside it, and close it again at the far end
    const line0 = -half + 0.15, TAPER = 10;
    for (let i = 0; i <= 5; i++) cone(s0 + (i / 5) * TAPER, half - 0.4 + (line0 - half + 0.4) * (i / 5), i % 2 === 0);
    for (let s = s0 + TAPER + 2.2; s < s1 - 0.5; s += 2.2) cone(s, line0, Math.round(s / 2.2) % 3 === 0);
    for (let i = 0; i <= 2; i++) cone(s1 + 0.5, line0 + (half - 0.4 - line0) * (i / 2));
    // a board with lamps on a trailer, where the lane ends
    put(s0 + TAPER + 1.5, 0.2, 0.3, 1.9, 1.3, 1.7, TRUCK, -1);
    put(s0 + TAPER + 1.5, 0.2 - 0.45, 1.6, 0.6, 0.45, 0.6, LAMP, 1);
    put(s0 + TAPER + 1.5, 0.2 + 0.45, 1.6, 0.6, 0.45, 0.6, LAMP, 2);
  } else {
    // a barrier across each end of the road, and cones round the dig in the middle
    barrier(3.5, -half + 0.3, half - 0.3);
    barrier(line.len - 3.5, -half + 0.3, half - 0.3);
    for (let d = -half + 0.7; d <= half - 0.6; d += 1.7) { cone(s0 - 2, d, true); cone(s1 + 2, d, true); }
  }
  // the dig: the asphalt is off and the earth shows, with a trench in it and what came out heaped beside
  const a = w.lane ? s0 + 14 : s0, b = w.lane ? s1 - 2 : s1, inner = wide - (w.lane ? 0.9 : 1.6), off = w.lane ? 0.15 : 0;
  const n = Math.max(1, Math.round((b - a) / 5)), step = (b - a) / n;
  for (let i = 0; i < n; i++) put(a + (i + 0.5) * step, off, 0.02, step + 0.3, 0.07, inner, EARTH, -1);
  const side = w.lane ? 0 : (r() < 0.5 ? -1 : 1) * (half * 0.4);
  const t0 = a + (b - a) * 0.45, t1 = b - 1.5, tn = Math.max(1, Math.round((t1 - t0) / 4)), ts = (t1 - t0) / tn;
  for (let i = 0; i < tn; i++) put(t0 + (i + 0.5) * ts, off + side, 0.03, ts + 0.2, 0.09, Math.min(1.3, inner * 0.4), PIT);
  if (w.lane) {
    truck(a + 3.2, off, 0);
    if (b - a > 17) digger(t0 - 3.4, off, 0);
    put(t1 - 1, off + 0.9, 0.05, 2.2, 0.9, 1.0, HEAP, 0, 0.2);
  } else {
    truck(a + 4, -side * 1.3 - (side ? 0 : 2), (r() - 0.5) * 0.5);
    digger((t0 + t1) / 2, side - Math.sign(side || 1) * 3.4, Math.sign(side || 1) * (Math.PI / 2));
    put(t0 + 2, side + Math.sign(side || 1) * 2.2, 0.05, 3.2, 1.1, 1.8, HEAP, 0, 0.3);
    put(t1 - 2, side + Math.sign(side || 1) * 2.0, 0.05, 2.4, 0.8, 1.5, HEAP, 0, -0.2);
  }
}

/** The sites of the traffic, laid out again whenever one opens, closes or moves with its road. */
export function Works({ sim, net }: { sim: Sim; net: Net }) {
  const mesh = useRef<InstancedMesh>(null);
  const made = useMemo(() => {
    const geo = new BoxGeometry(1, 1, 1), lamp = new InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    geo.setAttribute('aLamp', lamp);
    return { geo, lamp, mat: wet(paint(), 'traffic') };
  }, []);
  useEffect(() => () => { made.geo.dispose(); made.mat.dispose(); }, [made]);
  const rev = useRef(-1);
  // a new network, or a new simulation after a hot reload: lay them out again
  useEffect(() => { rev.current = -1; }, [sim, net]);
  useFrame(() => {
    const m = mesh.current;
    if (!m || rev.current === sim.worksRev) return;
    rev.current = sim.worksRev;
    const boxes: Box[] = [];
    for (const w of sim.works) if (w.live) build(w, boxes);
    const o = new Object3D(), c = new Color(), lamp = made.lamp.array;
    const n = Math.min(CAP, boxes.length);
    for (let i = 0; i < n; i++) {
      const b = boxes[i];
      o.position.set(b.x, b.h, b.y); o.rotation.set(0, -b.ang, 0); o.scale.set(b.l, b.t, b.w);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.setHex(b.color));
      const k = b.lamp < 0 ? LIT : 0;
      lamp[i * 4] = b.lamp > 0 ? AMBER[0] : c.r * k; lamp[i * 4 + 1] = b.lamp > 0 ? AMBER[1] : c.g * k; lamp[i * 4 + 2] = b.lamp > 0 ? AMBER[2] : c.b * k; lamp[i * 4 + 3] = b.lamp - 1;
    }
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    made.lamp.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[made.geo, made.mat, CAP]} castShadow receiveShadow frustumCulled={false} visible={false} />;
}
