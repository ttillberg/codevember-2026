// What makes it a city and not a model of one: people on the sidewalks, bikes along the kerb, and signs on everything.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, InstancedMesh, MeshStandardMaterial, Object3D, ShaderMaterial } from 'three';
import { onRoad, WALK, zebraAt } from './geo';
import { HOUR, NIGHT, bakeGlow, type Spot } from './haze';
import { cumLen, deck, offset, place, pointOn, rng, type Net, type V } from './net';
import { turned, type Block } from './Town';
import { settle, SOAKED, wet } from './wet';

// ---------- people and bikes ----------

const NO_WAYS: V[][] = [];

interface Line {
  pts: V[];
  cum: number[];
  len: number;
  /** a walk or the cycle way of the park */
  park?: boolean;
}

const MORE = place.on ? 4 : 1;
const WALKERS = 460 * MORE, RIDERS = 130 * MORE;
/** How many of them never leave the park: they turn round at its ends. The rest come through it as they come through anywhere. */
const STROLLERS = 34, PARK_RIDERS = 7;

/** How many of the people are out at this hour, of all there are: everyone by day, a third in the evening, next to no one at night. */
const ABROAD: [number, number][] = [[0, 0.03], [5, 0.03], [7.5, 1], [17, 1], [19, 0.45], [21, 0.25], [23, 0.03], [24, 0.03]];
function abroad(h: number) {
  for (let i = 1; i < ABROAD.length; i++) {
    const [h0, v0] = ABROAD[i - 1], [h1, v1] = ABROAD[i];
    if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return ABROAD[0][1];
}
const CLOTHES = [0x22252b, 0x2c3340, 0xe9e6de, 0xd9d4c8, 0xb8322a, 0x2f5fa8, 0xe0b23a, 0x4a6b4a, 0x8a8d92, 0xd98aa0];
const RIDES = [0x1e2126, 0xc23a2a, 0x2a5ea0, 0xe8e5dc, 0xe2b33a, 0x3a7a5a];

function line(pts: V[]): Line {
  const cum = cumLen(pts);
  return { pts, cum, len: cum[cum.length - 1] };
}

/**
 * Cut the line that passes nearest to p, there, so that something can begin or end at that point:
 * people only change lines where a line ends. Returns the point, or null if nothing passes within reach.
 */
function cut(lines: Line[], p: V, reach: number): V | null {
  let best = reach, li = -1, at = 0, q = p;
  lines.forEach((l, i) => {
    for (let k = 0; k < l.pts.length - 1; k++) {
      const a = l.pts[k], b = l.pts[k + 1], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const x = a.x + dx * t, y = a.y + dy * t, d = Math.hypot(x - p.x, y - p.y);
      if (d < best) { best = d; li = i; at = k; q = { x, y }; }
    }
  });
  if (li < 0) return null;
  const pts = lines[li].pts;
  lines.splice(li, 1, line([...pts.slice(0, at + 1), q]), line([q, ...pts.slice(at + 1)]));
  return q;
}

/** A way through the park, tied at both ends to whatever passes there: the sidewalk for a walk, the kerb for the cycle way. */
function tied(lines: Line[], pts: V[], reach: number): Line {
  const a = cut(lines, pts[0], reach), b = cut(lines, pts[pts.length - 1], reach);
  return { ...line([...(a ? [a] : []), ...pts, ...(b ? [b] : [])]), park: true };
}

export function People({ net, blocks, speed, shade = true, walks = NO_WAYS, rides = NO_WAYS }: {
  net: Net; blocks: Block[]; speed: number; shade?: boolean;
  /** the walks of the park, and its cycle way once in each direction */
  walks?: V[][]; rides?: V[][];
}) {
  const rate = useRef(speed);
  rate.current = speed;
  const walkMesh = useRef<InstancedMesh>(null), rideMesh = useRef<InstancedMesh>(null);

  // where they can go: the sidewalks and the footpaths for those on foot, the edge of the road for those on wheels
  const ways = useMemo(() => {
    const walk: Line[] = [], ride: Line[] = [];
    for (const r of net.roads) {
      if (r.rank < 1 || r.bridge || r.base.length < 2) continue;
      for (const side of [1, -1]) {
        if (!r.ring) walk.push(line(offset(r.base, side * (r.hw + 0.95 + WALK / 2))));
        if (r.ring && side < 0) continue;
        // on the right, going the way the traffic goes
        const edge = offset(r.base, side * (r.hw - 0.55));
        ride.push(line(side > 0 ? edge : edge.reverse()));
      }
    }
    for (const b of blocks) if (b.path.length > 1) walk.push(line(b.path));
    // the park's own ways begin and end on these
    const strolls = walks.map((w) => tied(walk, w, 6)), spins = rides.map((w) => tied(ride, w, 9));
    // and from one sidewalk to the next, so that nobody has to vanish at a kerb: over the zebra where an arm has one,
    // and round the corner to the arm beside it
    const link: Line[] = [];
    const afoot = (r: (typeof net.roads)[number]) => r.rank >= 1 && !r.bridge && !r.ring && r.base.length > 1;
    for (const n of net.nodes) {
      if (n.stub) continue;
      const arms = n.roads.map((r) => {
        const b = r.base, end = r.a === n ? 0 : 1, p = end ? b[b.length - 1] : b[0], q = end ? b[b.length - 2] : b[1];
        const d = Math.hypot(p.x - q.x, p.y - q.y) || 1, tx = (p.x - q.x) / d, ty = (p.y - q.y) / d, w = r.hw + 0.95 + WALK / 2;
        // the two ends of its sidewalks here: the one on the side the angles grow towards, and the other
        return { r, end, tx, ty, ang: Math.atan2(-ty, -tx), up: { x: p.x + ty * w, y: p.y - tx * w }, down: { x: p.x - ty * w, y: p.y + tx * w } };
      }).sort((a, b) => a.ang - b.ang);
      arms.forEach((a, i) => {
        if (!afoot(a.r)) return;
        if (zebraAt(a.r, a.end)) link.push(line([a.up, { x: a.up.x + a.tx * 2.7, y: a.up.y + a.ty * 2.7 }, { x: a.down.x + a.tx * 2.7, y: a.down.y + a.ty * 2.7 }, a.down]));
        const b = arms[(i + 1) % arms.length];
        if (b !== a && afoot(b.r) && Math.hypot(b.down.x - a.up.x, b.down.y - a.up.y) < 70) link.push(line([a.up, b.down]));
      });
    }
    return { walk: [...walk.filter((l) => l.len > 6), ...link.filter((l) => l.len > 0.5), ...strolls], ride: [...ride.filter((l) => l.len > 6), ...spins] };
  }, [net, blocks, walks, rides]);

  // each one: which line, how far along, which way, how fast
  const who = useMemo(() => {
    const r = rng(57);
    const mk = (n: number, v0: number, v1: number) => Array.from({ length: n }, () => ({ l: 0, s: 0, dir: 1, v: v0 + r() * (v1 - v0), k: r(), x: 0, y: 0, a: 0 }));
    return { walk: mk(WALKERS, 1.0, 1.7), ride: mk(RIDERS, 4.5, 8) };
  }, []);

  // what is shown now stands on these roads: nobody is pushed with a smear any further than the hand has moved since
  useLayoutEffect(() => settle('street', net), [ways, net]);
  // when the roads change, everyone is set down again on what is there now
  useLayoutEffect(() => {
    const r = rng(91);
    for (const [list, lines] of [[who.walk, ways.walk], [who.ride, ways.ride]] as const) {
      const total = lines.reduce((a, l) => a + l.len, 0);
      // the first few belong to the park, if there is one
      const fond = lines === ways.ride ? PARK_RIDERS : STROLLERS;
      const park = lines.flatMap((q, k) => (q.park ? [k] : [])), green = park.reduce((a, k) => a + lines[k].len, 0);
      list.forEach((p, i) => {
        let at = r() * total, l = 0;
        if (i < fond && park.length) {
          let n = 0;
          for (at = (at / total) * green; n < park.length - 1 && at > lines[park[n]].len; n++) at -= lines[park[n]].len;
          l = park[n];
        } else while (l < lines.length - 1 && at > lines[l].len) at -= lines[l++].len;
        p.l = l; p.s = Math.min(at, lines[l]?.len ?? 0); p.dir = lines === ways.ride || r() < 0.5 ? 1 : -1;
      });
    }
    const c = new Color();
    who.walk.forEach((p, i) => walkMesh.current!.setColorAt(i, c.setHex(CLOTHES[(p.k * CLOTHES.length) | 0])));
    who.ride.forEach((p, i) => rideMesh.current!.setColorAt(i, c.setHex(RIDES[(p.k * RIDES.length) | 0])));
    walkMesh.current!.instanceColor!.needsUpdate = true;
    rideMesh.current!.instanceColor!.needsUpdate = true;
  }, [ways, who]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * rate.current;
    const out = abroad(HOUR.value);
    const move = (list: typeof who.walk, lines: Line[], mesh: InstancedMesh, oneWay: boolean, sx: number, sy: number, sz: number) => {
      const a = mesh.instanceMatrix.array, fond = oneWay ? PARK_RIDERS : STROLLERS;
      list.forEach((p, i) => {
        const L = lines[p.l];
        const o = i * 16;
        // each has an hour to go in at, spread evenly over them all: whoever is past it is not there
        if (!L || (i * 0.618034) % 1 > out) { a.fill(0, o, o + 16); return; }
        p.s += p.dir * p.v * dt;
        if (p.s > L.len || p.s < 0) {
          // at the end of the block: carry on along whatever starts nearby, or turn back
          const end = p.s > L.len ? L.pts[L.pts.length - 1] : L.pts[0];
          let pick = -1, pe = 0, seen = 0;
          // first whatever begins right here, a crossing or a corner; only failing that a hop to something close by
          for (const near of oneWay ? [34] : [1.5, 34]) {
            for (let k = 0; k < lines.length; k++) {
              if (k === p.l) continue;
              const M = lines[k];
              // whoever belongs to the park stays on its ways
              if (i < fond && L.park && !M.park) continue;
              for (const e of oneWay ? [0] : [0, 1]) {
                const q = e ? M.pts[M.pts.length - 1] : M.pts[0];
                if (Math.abs(q.x - end.x) + Math.abs(q.y - end.y) > near) continue;
                // one of them, by a fair draw that needs no dice
                seen++;
                if (((i * 7 + seen * 13 + ((p.s * 3) | 0)) % seen) === 0) { pick = k; pe = e; }
              }
            }
            if (pick >= 0) break;
          }
          if (pick >= 0) { p.l = pick; p.dir = pe ? -1 : 1; p.s = pe ? lines[pick].len : 0; }
          else if (oneWay) p.s = 0;
          else { p.dir = -p.dir; p.s = Math.max(0, Math.min(L.len, p.s)); }
        }
        const M = lines[p.l];
        const s = Math.max(0, Math.min(M.len, p.s));
        const q = pointOn(M.pts, M.cum, s), q2 = pointOn(M.pts, M.cum, Math.min(M.len, s + 1));
        if (q2.x !== q.x || q2.y !== q.y) p.a = Math.atan2(q2.y - q.y, q2.x - q.x) + (p.dir < 0 ? Math.PI : 0);
        // a step to one side, so two do not walk through each other
        const off = oneWay ? 0 : (p.k - 0.5) * 2.2;
        const cs = Math.cos(p.a), sn = Math.sin(p.a);
        a[o] = cs * sx; a[o + 1] = 0; a[o + 2] = sn * sx; a[o + 3] = 0;
        a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = -sn * sz; a[o + 9] = 0; a[o + 10] = cs * sz; a[o + 11] = 0;
        a[o + 12] = q.x - sn * off; a[o + 13] = sy / 2 + 0.05; a[o + 14] = q.y + cs * off; a[o + 15] = 1;
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    if (walkMesh.current) move(who.walk, ways.walk, walkMesh.current, false, 0.5, 1.7, 0.55);
    if (rideMesh.current) move(who.ride, ways.ride, rideMesh.current, true, 1.8, 1.45, 0.65);
  });

  return (
    <>
      <instancedMesh ref={walkMesh} args={[undefined, undefined, WALKERS]} castShadow={shade} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.9} {...SOAKED.street} />
      </instancedMesh>
      <instancedMesh ref={rideMesh} args={[undefined, undefined, RIDERS]} castShadow={shade} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.7} {...SOAKED.street} />
      </instancedMesh>
    </>
  );
}

// ---------- signs ----------

const INKS = [0xd42a20, 0xd42a20, 0xc81e1e, 0xf0c020, 0xf0c020, 0x1d5fbd, 0x1a8a4c, 0xf2efe6, 0xf2efe6, 0xee7a1c, 0xc8206e];

/** A board with writing on it: rows of made-up characters on its two faces, a little brighter than the day. At night most of them are lit from inside. */
function board() {
  const m = new MeshStandardMaterial({ roughness: 0.6 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = NIGHT;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp; varying vec3 vSz; varying vec3 vOn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSz = vec3(1.0);
        #ifdef USE_INSTANCING
          vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vLp = position * vSz; vOn = normal;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vLp; varying vec3 vSz; varying vec3 vOn;
        float sh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        bool flatX = vSz.x < vSz.z;
        float lamp = 0.0;
        if (flatX ? abs(vOn.x) > 0.5 : abs(vOn.z) > 0.5) {
          float W = max(vSz.x, vSz.z), H = vSz.y;
          vec2 q = vec2((flatX ? vLp.z : vLp.x) + W * 0.5, vLp.y + H * 0.5);
          // one character to a square, as many as fit
          float cell = min(W, H) * 0.9;
          vec2 g = q / cell, id = floor(g), f = fract(g);
          float stroke = step(0.42, sh(id * 7.3 + floor(f * 5.0) + vSz.xy));
          float inside = step(0.14, f.x) * step(f.x, 0.86) * step(0.14, f.y) * step(f.y, 0.86);
          float pale = step(0.5, dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)));
          vec3 ink = mix(vec3(0.97, 0.94, 0.84), vec3(0.72, 0.09, 0.07), pale);
          diffuseColor.rgb = mix(diffuseColor.rgb, ink, stroke * inside * step(1.2, cell));
          // three boards in four have a light in them, each a little stronger or weaker; a post has none
          float k = sh(vSz.xy + 1.0);
          lamp = step(0.9, cell) * step(k, 0.75) * (1.6 + 1.6 * k);
        } else diffuseColor.rgb *= 0.45;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.32 + lamp * uNight);');
  };
  m.customProgramCacheKey = () => 'board-lit';
  return m;
}

interface Sign { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; ink: number }

export function Signs({ net, blocks }: { net: Net; blocks: Block[] }) {
  const ref = useRef<InstancedMesh>(null);
  const mat = useMemo(board, []);
  const CAP = 2000 * MORE;

  const signs = useMemo(() => {
    const out: Sign[] = [];
    const r = rng(77);
    const ink = () => INKS[(r() * INKS.length) | 0];
    // on the houses: a hoarding on the roof, banners down the ends, a shop front where it is low enough to have a shop
    for (const b of blocks) {
      const q = b.inner ?? b, from = out.length;
      const w = q.x1 - q.x0, d = q.y1 - q.y0, cx = (q.x0 + q.x1) / 2;
      for (const z of [q.y1 - 0.5, q.y0 + 0.5]) {
        if (r() > (z > q.y0 + 1 ? 0.85 : 0.45)) continue;
        const W = w * (0.4 + r() * 0.45), H = 2.6 + r() * 2.8;
        out.push({ x: cx + (r() - 0.5) * (w - W), y: b.h + 1.2 + H / 2, z, sx: W, sy: H, sz: 0.35, rot: 0, ink: ink() });
      }
      for (const side of [0, 1]) {
        const n = r() < 0.85 ? 1 + ((r() * 3) | 0) : 0;
        for (let k = 0; k < n; k++) {
          const H = Math.min(b.h * 0.7, 4 + r() * 8);
          out.push({ x: side ? q.x1 + 0.45 : q.x0 - 0.45, y: Math.max(H / 2 + 2.6, b.h * (0.4 + r() * 0.25)), z: q.y0 + d * (0.2 + r() * 0.6), sx: 0.35, sy: H, sz: 1.3 + r() * 0.6, rot: 0, ink: ink() });
        }
      }
      // the ground floor is shops
      const n = Math.max(1, Math.floor(w / 9));
      for (let k = 0; k < n; k++) {
        if (r() < 0.25) continue;
        out.push({ x: q.x0 + (w * (k + 0.5)) / n, y: 3.3, z: q.y1 + 0.2, sx: (w / n) * 0.86, sy: 1.1, sz: 0.25, rot: 0, ink: ink() });
      }
      // a turned house takes its signs round with it
      if (b.turn) for (let k = from; k < out.length; k++) { [out[k].x, out[k].z] = turned(b, out[k].x, out[k].z); out[k].rot = b.turn; }
    }
    // on the big sheds: the name across the front, twice
    for (const b of net.buildings) {
      const w = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2;
      for (const z of [b.y1 + 0.25, b.y0 - 0.25]) out.push({ x: cx + (r() - 0.5) * w * 0.2, y: Math.max(2.4, b.h - 1.6), z, sx: w * (0.35 + r() * 0.3), sy: Math.min(2.6, b.h * 0.34), sz: 0.3, rot: 0, ink: ink() });
      if (!b.canopy && r() < 0.7) out.push({ x: b.x0 + 4 + r() * (w - 8), y: b.h + 4, z: (b.y0 + b.y1) / 2, sx: 9 + r() * 6, sy: 4.5, sz: 0.4, rot: 0, ink: ink() });
    }
    // along the roads: hoardings on poles, facing the traffic
    const solid = [...net.pads, ...net.buildings, ...blocks];
    const taken = (x: number, y: number, m = 3) => solid.some((q) => x > q.x0 - m && x < q.x1 + m && y > q.y0 - m && y < q.y1 + m);
    for (const road of net.roads) {
      if (road.rank < 2 || road.bridge || road.ring) continue;
      for (const side of [1, -1]) {
        const ln = offset(road.base, side * (road.hw + WALK + 3));
        const cum = cumLen(ln);
        for (let dd = 18; dd < cum[cum.length - 1] - 12; dd += 30) {
          const p = pointOn(ln, cum, dd), p2 = pointOn(ln, cum, dd + 2);
          const h = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1;
          if (h < 0.2 || taken(p.x, p.y) || onRoad(net, p.x, p.y, road, 2)) continue;
          const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
          const W = 5 + h * 5, H = 2.6 + h * 2;
          out.push({ x: p.x, y: 6.5 + H / 2, z: p.y, sx: W, sy: H, sz: 0.3, rot: -(ang + Math.PI / 2), ink: INKS[(h * 97) % INKS.length | 0] });
          out.push({ x: p.x, y: 3.3, z: p.y, sx: 0.35, sy: 6.6, sz: 0.35, rot: 0, ink: 0x6d7074 });
        }
      }
    }
    // road signs: a blue board over the lanes before every signal, a red one where a road gives way
    for (const road of net.roads) {
      if (road.rank < 1 || road.bridge || road.ring || road.base.length < 2) continue;
      const cum = cumLen(road.base), run = cum[cum.length - 1];
      for (const end of [0, 1]) {
        const node = end ? road.b : road.a;
        if (node.stub) continue;
        const top = Math.max(...node.roads.map((q) => q.rank));
        // the frame of the approach: p on the centreline, t towards the junction, n to the right of travel
        const frame = (back: number) => {
          const d = end ? run - back : back;
          const p = pointOn(road.base, cum, d), p2 = pointOn(road.base, cum, end ? d - 1 : d + 1);
          const tx = p.x - p2.x, ty = p.y - p2.y;
          return { p, tx, ty, nx: -ty, ny: tx, rot: -(Math.atan2(ty, tx) + Math.PI / 2) };
        };
        if (node.signal && road.rank >= 2 && run >= 50) {
          const f = frame(Math.min(34, run * 0.42)), reach = road.hw + 1.6;
          const post = { x: f.p.x + f.nx * reach, y: f.p.y + f.ny * reach };
          if (!taken(post.x, post.y) && !onRoad(net, post.x, post.y, road)) {
            out.push({ x: post.x, y: 3.9, z: post.y, sx: 0.4, sy: 7.8, sz: 0.4, rot: f.rot, ink: 0x6d7074 });
            out.push({ x: f.p.x + f.nx * reach / 2, y: 7.6, z: f.p.y + f.ny * reach / 2, sx: reach, sy: 0.28, sz: 0.28, rot: f.rot, ink: 0x6d7074 });
            out.push({ x: f.p.x + f.nx * road.hw * 0.5 - f.tx * 0.3, y: 7.3, z: f.p.y + f.ny * road.hw * 0.5 - f.ty * 0.3, sx: road.hw * 0.86, sy: 2.5, sz: 0.2, rot: f.rot, ink: road.rank >= 3 ? 0x1a6a44 : 0x1a4f9e });
          }
        } else if (!node.signal && road.rank < top && run >= 20) {
          const f = frame(3), reach = road.hw + 1.3;
          const x = f.p.x + f.nx * reach, y = f.p.y + f.ny * reach;
          if (!taken(x, y, 0) && !onRoad(net, x, y, road)) {
            out.push({ x, y: 1.3, z: y, sx: 0.14, sy: 2.6, sz: 0.14, rot: f.rot, ink: 0x6d7074 });
            out.push({ x: x - f.tx * 0.12, y: 2.9, z: y - f.ty * 0.12, sx: 0.95, sy: 0.95, sz: 0.1, rot: f.rot, ink: 0xd42a20 });
          }
        }
      }
    }
    return out.slice(0, CAP);
  }, [net, blocks]);

  useLayoutEffect(() => {
    const m = ref.current!, o = new Object3D(), c = new Color();
    signs.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z); o.scale.set(s.sx, s.sy, s.sz); o.rotation.set(0, s.rot, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.setHex(s.ink));
    });
    m.count = signs.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [signs]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CAP]} material={mat} castShadow frustumCulled={false}>
      <boxGeometry />
    </instancedMesh>
  );
}

// ---------- street lights and screens ----------

const LAMP_DAY = new Color(0xffe9c0), LAMP_NIGHT = new Color(0xff9a3c);

/** A screen showing whatever screens show: blocks of colour that keep changing, on a grid of lamps. */
function screen() {
  const m = new MeshStandardMaterial({ roughness: 0.4, color: 0x0c0d10 });
  m.userData.time = { value: 0 };
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = m.userData.time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp; varying vec3 vSz; varying vec3 vOn; varying vec3 vSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSz = vec3(1.0); vSeed = vec3(0.5);
        #ifdef USE_INSTANCING
          vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        #ifdef USE_INSTANCING_COLOR
          vSeed = instanceColor;
        #endif
        vLp = position * vSz; vOn = normal;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec3 vLp; varying vec3 vSz; varying vec3 vOn; varying vec3 vSeed;
        float th(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(0.05, 0.055, 0.065);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (abs(vOn.z) > 0.5) {
          vec2 uv = vec2(vLp.x / vSz.x + 0.5, vLp.y / vSz.y + 0.5);
          float t = uTime * (0.6 + vSeed.x) + vSeed.y * 40.0;
          // a new advert every few seconds, each with its own colours and its own way of moving
          float ad = floor(t / 3.5), k = fract(t / 3.5);
          float h0 = th(vec2(ad, vSeed.z * 9.0));
          vec3 a = hue(h0), b = hue(h0 + 0.33 + 0.3 * th(vec2(ad, 3.0)));
          float kind = th(vec2(ad, 7.0));
          float band = kind < 0.33 ? step(0.5, fract(uv.x * 3.0 + k * 2.0))
            : kind < 0.66 ? step(length(uv - vec2(0.5 + 0.3 * sin(t), 0.5)) , 0.18 + 0.25 * k)
            : step(0.5, th(floor(uv * vec2(8.0, 4.5)) + floor(t * 3.0)));
          vec3 pic = mix(a * 0.55, b, band);
          // a white line of writing along the bottom
          pic = mix(pic, vec3(1.0), step(uv.y, 0.2) * step(0.06, uv.y) * step(0.45, th(vec2(floor(uv.x * 22.0), ad))));
          // the cut between adverts
          pic *= smoothstep(0.0, 0.04, k);
          // lamps
          vec2 led = fract(vLp.xy / 0.35);
          pic *= 0.75 + 0.25 * step(0.2, led.x) * step(0.2, led.y);
          totalEmissiveRadiance += pic * 1.15;
        }`);
  };
  m.customProgramCacheKey = () => 'screen';
  return m;
}

/** The light a street lamp throws on the ground: no light at all, only a round glow laid over the road, there when it is dark. */
function pool() {
  return new ShaderMaterial({
    uniforms: { uNight: NIGHT },
    vertexShader: /* glsl */ `
      varying vec2 vP; varying vec3 vInk;
      void main() {
        vP = position.xy; vInk = vec3(1.0, 0.5, 0.13);
        #ifdef USE_INSTANCING_COLOR
          vInk = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying vec2 vP; varying vec3 vInk;
      void main() {
        float a = max(0.0, 1.0 - length(vP));
        gl_FragColor = vec4(vInk * a * a * (0.25 + 0.75 * a) * uNight * POOL, 1.0);
      }`,
    defines: { POOL: '0.34' },
    blending: AdditiveBlending, transparent: true, depthWrite: false,
  });
}

/** Lamp posts down every proper road, and screens where the most people will see them: big junctions, big roads. */
export function Street({ net, blocks, speed }: { net: Net; blocks: Block[]; speed: number }) {
  const posts = useRef<InstancedMesh>(null), lamps = useRef<InstancedMesh>(null), pools = useRef<InstancedMesh>(null), tv = useRef<InstancedMesh>(null);
  const head = useRef<MeshStandardMaterial>(null);
  const shine = useMemo(() => wet(pool(), 'street'), []);
  const glass = useMemo(() => wet(screen(), 'street'), []);
  const POSTS = 6400 * MORE, TVS = 90 * MORE;

  const plan = useMemo(() => {
    const post: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number }[] = [];
    const lamp: typeof post = [];
    // what each lamp lights: a round of ground under its head
    const lit: (typeof post[number] & { ink: [number, number, number] })[] = [];
    /** No two lamps are the same lamp: most are deep sodium, some paler with age, and now and then one has been changed for a white one. */
    const warmth = (x: number, y: number): [number, number, number] => {
      const k = hash(x * 1.7 + 3, y * 0.9 - 5), t = hash(x, y) ** 2;
      return k < 0.06 ? [0.78, 0.86, 0.95] : [1, 0.4 + 0.3 * t, 0.06 + 0.3 * t];
    };
    const tvs: (typeof post[number] & { seed: number })[] = [];
    const solid = [...net.pads, ...net.buildings, ...blocks];
    const taken = (x: number, y: number, m = 2) => solid.some((q) => x > q.x0 - m && x < q.x1 + m && y > q.y0 - m && y < q.y1 + m);
    const hash = (x: number, y: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const stand = (x: number, z: number, W: number, H: number, rot: number, up: number) => {
      // two legs and the screen on top of them
      const cx = Math.cos(rot), sn = Math.sin(rot);
      for (const e of [-1, 1]) post.push({ x: x + cx * e * W * 0.32, y: up / 2, z: z - sn * e * W * 0.32, sx: 0.45, sy: up, sz: 0.45, rot });
      tvs.push({ x, y: up + H / 2, z, sx: W, sy: H, sz: 0.5, rot, seed: hash(x, z) });
    };

    // A lamp on a bridge throws half as much, and they stand as close as on the ground: where decks lie over each other
    // and over a road their light adds up, and fewer lamps would leave dark stretches where a deck is alone
    const dim = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
    for (const r of net.roads) {
      if (r.base.length < 2) continue;
      // lamp posts on every road: both sides, staggered, the arm reaching in over the road; a lane has a lower one, on one side.
      // The bigger the road the closer they stand: an arterial is lit from end to end, a lane has a lamp now and then
      const small = r.rank < 2 && !r.ring, H = small ? 6.4 : 9.2, apart = small ? 46 : r.rank < 3 && !r.ring ? 40 : 26;
      for (const side of r.ring || small ? [1] : [1, -1]) {
        // on a bridge they stand on the edge of the deck
        const ln = offset(r.base, side * (r.bridge ? r.hw - 0.3 : r.hw + 1.3));
        const cum = cumLen(ln);
        for (let d = side > 0 ? 8 : 8 + apart / 2; d < cum[cum.length - 1] - 4; d += apart) {
          const p = pointOn(ln, cum, d), p2 = pointOn(ln, cum, d + 1);
          const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
          if (!r.bridge && (taken(p.x, p.y, 0) || onRoad(net, p.x, p.y, r))) continue;
          const z = r.bridge ? deck(r, d) : 0;
          // the arm points across the road: to the left of travel on the right side, and the other way round
          const nx = Math.sin(ang) * side, ny = -Math.cos(ang) * side;
          post.push({ x: p.x, y: z + H / 2, z: p.y, sx: 0.55, sy: H, sz: 0.55, rot: 0 });
          post.push({ x: p.x + nx * 1.3, y: z + H, z: p.y + ny * 1.3, sx: 2.6, sy: 0.3, sz: 0.36, rot: -Math.atan2(ny, nx) });
          // the lamp itself: a small round source at the end of the arm, not a slab
          lamp.push({ x: p.x + nx * 2.5, y: z + H - 0.25, z: p.y + ny * 2.5, sx: 0.95, sy: 0.7, sz: 0.95, rot: 0 });
          lit.push({ x: p.x + nx * 2.5, y: z + 0.22, z: p.y + ny * 2.5, sx: H * 1.6, sy: H * 1.6, sz: 1, rot: 0, ink: dim(warmth(p.x, p.y), r.bridge ? 0.5 : 1) });
        }
      }
      // screens along the biggest roads
      if (r.rank >= 3 && !r.bridge) {
        const side = hash(r.base[0].x, r.base[0].y) < 0.5 ? 1 : -1;
        const ln = offset(r.base, side * (r.hw + WALK + 7));
        const cum = cumLen(ln);
        for (let d = 40; d < cum[cum.length - 1] - 30; d += 130) {
          const p = pointOn(ln, cum, d), p2 = pointOn(ln, cum, d + 2);
          if (taken(p.x, p.y, 7) || onRoad(net, p.x, p.y, r, 5)) continue;
          stand(p.x, p.y, 11, 6, -(Math.atan2(p2.y - p.y, p2.x - p.x) + Math.PI / 2), 9);
        }
      }
    }
    // and at the crossings: in a corner between two arms, turned to face the middle
    for (const n of net.nodes) {
      const top = Math.max(...n.roads.map((q) => q.rank));
      if (n.stub || n.roads.length < 3 || top < 2 || n.roads.some((q) => q.ring || q.bridge)) continue;
      if (!n.signal && top < 3) continue;
      const angs = n.roads.map((q) => {
        const [a, b] = q.a === n ? [q.raw[0], q.raw[1]] : [q.raw[q.raw.length - 1], q.raw[q.raw.length - 2]];
        return Math.atan2(b.y - a.y, b.x - a.x);
      }).sort((a, b) => a - b);
      let placed = 0;
      for (let i = 0; i < angs.length && placed < (n.signal ? 2 : 1); i++) {
        const a0 = angs[i], a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
        if (a1 - a0 < 1.0 || a1 - a0 > 2.4) continue;
        const mid = (a0 + a1) / 2, R = n.trim + 15;
        const x = n.p.x + Math.cos(mid) * R, z = n.p.y + Math.sin(mid) * R;
        if (taken(x, z, 6) || hash(x, z) < 0.25 || onRoad(net, x, z, undefined, 5)) continue;
        // its face looks back at the junction
        stand(x, z, 13, 7, Math.atan2(n.p.x - x, n.p.y - z), 10);
        placed++;
      }
    }
    // And the small lights nobody planned: one by a door here and there, and a few out in the green, by a path, in a yard,
    // at the back of a shed. Low, weak, each its own colour.
    const small = (x: number, y: number, up: number, reach: number, ink: [number, number, number]) => {
      lamp.push({ x, y: up, z: y, sx: 0.5, sy: 0.4, sz: 0.5, rot: 0 });
      lit.push({ x, y: 0.2, z: y, sx: reach, sy: reach, sz: 1, rot: 0, ink });
    };
    for (const b of blocks) {
      const door = b.path[0], k = hash(b.x0 * 0.31, b.y0 * 0.47);
      if (!door || k > 0.45) continue;
      const t = hash(b.y1, b.x1);
      small(door.x, door.y, Math.min(b.h, 2.6), 5 + 3 * t, [0.75, 0.42 + 0.3 * t, 0.12 + 0.3 * t]);
    }
    // the same lattice however far the place reaches, so a light stands where it stood
    const lo = (from: number, min: number) => (place.on ? from + 34 * Math.ceil((min - from) / 34) : from);
    const X0 = lo(-420, place.x - place.half), X1 = place.on ? place.x + place.half : 420, Y0 = lo(-400, place.y - place.half), Y1 = place.on ? place.y + place.half : 400;
    for (let gx = X0; gx < X1; gx += 34) {
      for (let gy = Y0; gy < Y1; gy += 34) {
        const k = hash(gx * 0.173 + 9, gy * 0.291 - 4);
        if (k > 0.2) continue;
        const x = gx + hash(gx, gy + 1) * 30, y = gy + hash(gx + 1, gy) * 30;
        if (taken(x, y, 2) || onRoad(net, x, y)) continue;
        // out here a lamp is as likely white or greenish as warm
        const t = hash(x, y), c = hash(y, x);
        small(x, y, 1.2 + 2 * t, 6 + 5 * t, c < 0.35 ? [0.5, 0.62, 0.55] : c < 0.6 ? [0.6, 0.6, 0.5] : [0.8, 0.45 + 0.2 * t, 0.15]);
      }
    }
    return { post: post.slice(0, POSTS), lamp: lamp.slice(0, POSTS / 2), lit: lit.slice(0, POSTS / 2), tvs: tvs.slice(0, TVS) };
  }, [net, blocks]);
  useLayoutEffect(() => settle('street', net), [plan, net]);

  useLayoutEffect(() => {
    const o = new Object3D(), c = new Color();
    const put = (m: InstancedMesh, list: typeof plan.post, flat = false) => {
      list.forEach((s, i) => {
        o.position.set(s.x, s.y, s.z); o.scale.set(s.sx, s.sy, s.sz); o.rotation.set(flat ? -Math.PI / 2 : 0, s.rot, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
    };
    put(posts.current!, plan.post);
    put(lamps.current!, plan.lamp);
    put(pools.current!, plan.lit, true);
    plan.lit.forEach((l, i) => pools.current!.setColorAt(i, c.setRGB(...l.ink)));
    if (pools.current!.instanceColor) pools.current!.instanceColor.needsUpdate = true;
    put(tv.current!, plan.tvs);
    // the map of where light is: every lamp, every house with lit rooms, every screen
    // sodium along the roads: deep amber, strong under the lamp and gone a few steps off the road
    const spots: Spot[] = plan.lit.map((l) => ({ x: l.x, z: l.z, r: l.sx * 1.65, c: [l.ink[0], l.ink[1] * 1.05, l.ink[2] * 0.9] }));
    for (const b of blocks) spots.push({ x: (b.x0 + b.x1) / 2, z: (b.y0 + b.y1) / 2, r: Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 8, c: [0.2, 0.16, 0.1] });
    for (const t of plan.tvs) spots.push({ x: t.x, z: t.z, r: 34, c: [0.3, 0.34, 0.42] });
    // where roads meet there is always more light than along them, and a car park is lit from end to end
    for (const n of net.nodes) if (n.roads.length >= 3 && n.z < 1) spots.push({ x: n.p.x, z: n.p.y, r: 26 + 5 * n.roads.length, c: [0.85, 0.42, 0.1] });
    // a car park is lit white, as they are now: cold beside the amber of the streets
    net.stalls.forEach((st, i) => { if (i % 5 === 0) spots.push({ x: st.p.x, z: st.p.y, r: 22, c: [0.3, 0.36, 0.4] }); });
    bakeGlow(spots);
    // each screen runs its own programme
    plan.tvs.forEach((s, i) => tv.current!.setColorAt(i, c.setRGB(s.seed, (s.seed * 7.3) % 1, (s.seed * 3.1) % 1)));
    if (tv.current!.instanceColor) tv.current!.instanceColor.needsUpdate = true;
  }, [plan, blocks, net]);

  // the screens run at their own pace, not the timelapse's, and hold still in a still
  useFrame((_, delta) => {
    if (speed > 0) glass.userData.time.value += Math.min(delta, 0.1);
    // the lamps: hardly a light of their own by day, sodium at night, and then the ground under them shows it
    const n = NIGHT.value;
    head.current!.emissiveIntensity = 0.2 + 7 * n;
    head.current!.emissive.copy(LAMP_DAY).lerp(LAMP_NIGHT, n);
    pools.current!.visible = n > 0.01;
  });

  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, POSTS]} castShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0x4a4e54} roughness={0.6} metalness={0.4} {...SOAKED.street} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, POSTS / 2]} frustumCulled={false}>
        <sphereGeometry args={[0.5, 10, 6]} />
        {/* the heads are pale, with only a little light of their own: enough to be found, not to shine */}
        <meshStandardMaterial ref={head} color={0xe8e6dc} emissive={0xffe9c0} emissiveIntensity={0.2} roughness={0.4} {...SOAKED.street} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, POSTS / 2]} material={shine} frustumCulled={false}>
        <circleGeometry args={[1, 12]} />
      </instancedMesh>
      <instancedMesh ref={tv} args={[undefined, undefined, TVS]} material={glass} castShadow frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
    </>
  );
}
