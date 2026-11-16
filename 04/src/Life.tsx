// What makes it a city and not a model of one: people on the sidewalks, bikes along the kerb, and signs on everything.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { onRoad, WALK } from './geo';
import { cumLen, deck, offset, pointOn, rng, type Net, type V } from './net';
import { turned, type Block } from './Town';

// ---------- people and bikes ----------

interface Line {
  pts: V[];
  cum: number[];
  len: number;
}

const WALKERS = 460, RIDERS = 130;
const CLOTHES = [0x22252b, 0x2c3340, 0xe9e6de, 0xd9d4c8, 0xb8322a, 0x2f5fa8, 0xe0b23a, 0x4a6b4a, 0x8a8d92, 0xd98aa0];
const RIDES = [0x1e2126, 0xc23a2a, 0x2a5ea0, 0xe8e5dc, 0xe2b33a, 0x3a7a5a];

function line(pts: V[]): Line {
  const cum = cumLen(pts);
  return { pts, cum, len: cum[cum.length - 1] };
}

export function People({ net, blocks, speed }: { net: Net; blocks: Block[]; speed: number }) {
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
    return { walk: walk.filter((l) => l.len > 6), ride: ride.filter((l) => l.len > 6) };
  }, [net, blocks]);

  // each one: which line, how far along, which way, how fast
  const who = useMemo(() => {
    const r = rng(57);
    const mk = (n: number, v0: number, v1: number) => Array.from({ length: n }, () => ({ l: 0, s: 0, dir: 1, v: v0 + r() * (v1 - v0), k: r(), x: 0, y: 0, a: 0 }));
    return { walk: mk(WALKERS, 1.0, 1.7), ride: mk(RIDERS, 4.5, 8) };
  }, []);

  // when the roads change, everyone is set down again on what is there now
  useLayoutEffect(() => {
    const r = rng(91);
    for (const [list, lines] of [[who.walk, ways.walk], [who.ride, ways.ride]] as const) {
      const total = lines.reduce((a, l) => a + l.len, 0);
      for (const p of list) {
        let at = r() * total, l = 0;
        while (l < lines.length - 1 && at > lines[l].len) at -= lines[l++].len;
        p.l = l; p.s = Math.min(at, lines[l]?.len ?? 0); p.dir = lines === ways.ride || r() < 0.5 ? 1 : -1;
      }
    }
    const c = new Color();
    who.walk.forEach((p, i) => walkMesh.current!.setColorAt(i, c.setHex(CLOTHES[(p.k * CLOTHES.length) | 0])));
    who.ride.forEach((p, i) => rideMesh.current!.setColorAt(i, c.setHex(RIDES[(p.k * RIDES.length) | 0])));
    walkMesh.current!.instanceColor!.needsUpdate = true;
    rideMesh.current!.instanceColor!.needsUpdate = true;
  }, [ways, who]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * rate.current;
    const move = (list: typeof who.walk, lines: Line[], mesh: InstancedMesh, oneWay: boolean, sx: number, sy: number, sz: number) => {
      const a = mesh.instanceMatrix.array;
      list.forEach((p, i) => {
        const L = lines[p.l];
        const o = i * 16;
        if (!L) { a.fill(0, o, o + 16); return; }
        p.s += p.dir * p.v * dt;
        if (p.s > L.len || p.s < 0) {
          // at the end of the block: carry on along whatever starts nearby, or turn back
          const end = p.s > L.len ? L.pts[L.pts.length - 1] : L.pts[0];
          let pick = -1, pe = 0, seen = 0;
          for (let k = 0; k < lines.length; k++) {
            if (k === p.l) continue;
            const M = lines[k];
            for (const e of oneWay ? [0] : [0, 1]) {
              const q = e ? M.pts[M.pts.length - 1] : M.pts[0];
              if (Math.abs(q.x - end.x) + Math.abs(q.y - end.y) > 34) continue;
              // one of them, by a fair draw that needs no dice
              seen++;
              if (((i * 7 + seen * 13 + ((p.s * 3) | 0)) % seen) === 0) { pick = k; pe = e; }
            }
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
      <instancedMesh ref={walkMesh} args={[undefined, undefined, WALKERS]} castShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={rideMesh} args={[undefined, undefined, RIDERS]} castShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
    </>
  );
}

// ---------- signs ----------

const INKS = [0xd42a20, 0xd42a20, 0xc81e1e, 0xf0c020, 0xf0c020, 0x1d5fbd, 0x1a8a4c, 0xf2efe6, 0xf2efe6, 0xee7a1c, 0xc8206e];

/** A board with writing on it: rows of made-up characters on its two faces, a little brighter than the day. */
function board() {
  const m = new MeshStandardMaterial({ roughness: 0.6 });
  m.onBeforeCompile = (s) => {
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
        varying vec3 vLp; varying vec3 vSz; varying vec3 vOn;
        float sh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        bool flatX = vSz.x < vSz.z;
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
        } else diffuseColor.rgb *= 0.45;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.32;');
  };
  m.customProgramCacheKey = () => 'board';
  return m;
}

interface Sign { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; ink: number }

export function Signs({ net, blocks }: { net: Net; blocks: Block[] }) {
  const ref = useRef<InstancedMesh>(null);
  const mat = useMemo(board, []);
  const CAP = 2000;

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

/** Lamp posts down every proper road, and screens where the most people will see them: big junctions, big roads. */
export function Street({ net, blocks, speed }: { net: Net; blocks: Block[]; speed: number }) {
  const posts = useRef<InstancedMesh>(null), lamps = useRef<InstancedMesh>(null), tv = useRef<InstancedMesh>(null);
  const glass = useMemo(screen, []);
  const POSTS = 6400, TVS = 90;

  const plan = useMemo(() => {
    const post: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number }[] = [];
    const lamp: typeof post = [];
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

    for (const r of net.roads) {
      if (r.base.length < 2) continue;
      // lamp posts on every road: both sides, staggered, the arm reaching in over the road; a lane has a lower one, on one side
      const small = r.rank < 2 && !r.ring, H = small ? 6.4 : 9.2;
      for (const side of r.ring || small ? [1] : [1, -1]) {
        // on a bridge they stand on the edge of the deck
        const ln = offset(r.base, side * (r.bridge ? r.hw - 0.3 : r.hw + 1.3));
        const cum = cumLen(ln);
        for (let d = side > 0 ? 8 : 20; d < cum[cum.length - 1] - 4; d += small ? 22 : 24) {
          const p = pointOn(ln, cum, d), p2 = pointOn(ln, cum, d + 1);
          const ang = Math.atan2(p2.y - p.y, p2.x - p.x);
          if (!r.bridge && (taken(p.x, p.y, 0) || onRoad(net, p.x, p.y, r))) continue;
          const z = r.bridge ? deck(r, d) : 0;
          // the arm points across the road: to the left of travel on the right side, and the other way round
          const nx = Math.sin(ang) * side, ny = -Math.cos(ang) * side;
          post.push({ x: p.x, y: z + H / 2, z: p.y, sx: 0.55, sy: H, sz: 0.55, rot: 0 });
          post.push({ x: p.x + nx * 1.3, y: z + H, z: p.y + ny * 1.3, sx: 2.6, sy: 0.3, sz: 0.36, rot: -Math.atan2(ny, nx) });
          lamp.push({ x: p.x + nx * 2.5, y: z + H - 0.1, z: p.y + ny * 2.5, sx: 2.3, sy: 0.4, sz: 1.0, rot: -Math.atan2(ny, nx) });
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
    return { post: post.slice(0, POSTS), lamp: lamp.slice(0, POSTS / 2), tvs: tvs.slice(0, TVS) };
  }, [net, blocks]);

  useLayoutEffect(() => {
    const o = new Object3D(), c = new Color();
    const put = (m: InstancedMesh, list: typeof plan.post) => {
      list.forEach((s, i) => {
        o.position.set(s.x, s.y, s.z); o.scale.set(s.sx, s.sy, s.sz); o.rotation.set(0, s.rot, 0);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
    };
    put(posts.current!, plan.post);
    put(lamps.current!, plan.lamp);
    put(tv.current!, plan.tvs);
    // each screen runs its own programme
    plan.tvs.forEach((s, i) => tv.current!.setColorAt(i, c.setRGB(s.seed, (s.seed * 7.3) % 1, (s.seed * 3.1) % 1)));
    if (tv.current!.instanceColor) tv.current!.instanceColor.needsUpdate = true;
  }, [plan]);

  // the screens run at their own pace, not the timelapse's, and hold still in a still
  useFrame((_, delta) => { if (speed > 0) glass.userData.time.value += Math.min(delta, 0.1); });

  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, POSTS]} castShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color={0x4a4e54} roughness={0.6} metalness={0.4} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, POSTS / 2]} frustumCulled={false}>
        <boxGeometry />
        {/* the heads are pale, with only a little light of their own: enough to be found, not to shine */}
        <meshStandardMaterial color={0xe8e6dc} emissive={0xffe9c0} emissiveIntensity={0.2} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={tv} args={[undefined, undefined, TVS]} material={glass} castShadow frustumCulled={false}>
        <boxGeometry />
      </instancedMesh>
    </>
  );
}
