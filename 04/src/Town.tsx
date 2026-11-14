// Where people live: compounds of slab blocks in rows, a few towers at the edges, and the concrete between them.
// Planted once, from the place as it stood. Nothing takes them down: roads go round.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { pavingGeometry, rectClear } from './geo';
import { rng, type Net, type Rect, type V } from './net';

export interface Block extends Rect {
  h: number;
  wall: number;
  roof: number;
  /** the footpath from its door to the next block, or out to the road */
  path: V[];
}

const WALLS = [0xd8d4c8, 0xcfc9b8, 0xd9cfc4, 0xc4c9cc, 0xe0dcd2, 0xd2c3b4, 0xbfc6c2];
const ROOFS = [0x6f8fb0, 0x5f7f9f, 0xb9b6ae, 0xa9a69e, 0x8d6a58, 0x7d93a8];

/** Is this block still standing on this network? A bridge may pass over it. */
export const stands = (net: Net, b: Rect, margin = 0) => rectClear(net, b, margin);

export function plantTown(net: Net): Block[] {
  const r = rng(41);
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
  for (let tries = 0; tries < 1600 && out.length < 60; tries++) {
    // the middle fills first, then the edges
    const reach = tries < 800 ? 0.72 : 1;
    const ox = (r() - 0.5) * 700 * reach, oy = (r() - 0.5) * 640 * reach;
    const cols = 1 + ((r() * 2) | 0), rows = 2 + ((r() * 3) | 0);
    const w = 32 + r() * 14, d = 11 + r() * 2.5, floors = 6 + ((r() * 4) | 0);
    const wall = WALLS[(r() * WALLS.length) | 0], roof = ROOFS[(r() * ROOFS.length) | 0];
    const made: Block[] = [];
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < rows; k++) {
        const x0 = ox + c * (w + 12), y0 = oy + k * (d + 17);
        const b: Block = { x0, y0, x1: x0 + w, y1: y0 + d, h: floors * 3 + (r() < 0.3 ? 3 : 0), wall, roof, path: [] };
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
  for (let tries = 0, made = 0; tries < 900 && made < 50; tries++) {
    const x = (r() - 0.5) * 680, y = (r() - 0.5) * 620;
    const w = 9 + r() * 12, d = 8 + r() * 8;
    const b: Block = { x0: x, y0: y, x1: x + w, y1: y + d, h: (1 + ((r() * 4) | 0)) * 3.2, wall: WALLS[(r() * WALLS.length) | 0], roof: ROOFS[(r() * ROOFS.length) | 0], path: [] };
    if (!free(b, 3)) continue;
    const door = { x: (b.x0 + b.x1) / 2, y: b.y1 };
    const g = gate(door);
    if (Math.hypot(g.x - door.x, g.y - door.y) < 90) b.path = [door, g];
    out.push(b);
    made++;
  }
  // a few towers further out, pale in the haze
  for (let tries = 0; tries < 200 && out.length < 122; tries++) {
    const x = (r() - 0.5) * 780, y = (r() - 0.5) * 720;
    if (Math.abs(x) < 230 && Math.abs(y) < 200) continue;
    const s = 17 + r() * 5;
    const b: Block = { x0: x, y0: y, x1: x + s, y1: y + s * (0.8 + r() * 0.4), h: 36 + r() * 18, wall: WALLS[(r() * WALLS.length) | 0], roof: 0xb9b6ae, path: [] };
    if (!free(b)) continue;
    const door = { x: (b.x0 + b.x1) / 2, y: b.y1 };
    b.path = [door, gate(door)];
    out.push(b);
  }
  return out;
}

const HASH = /* glsl */ `float wh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`;

/** Walls with rows of windows, sized in metres whatever the box is scaled to. */
function walls() {
  const m = new MeshStandardMaterial({ roughness: 0.85 });
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp; varying vec3 vSz; varying vec3 vOn;\n' + HASH)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vOn.y) < 0.5) {
          float u = abs(vOn.x) > 0.5 ? vLp.z : vLp.x;
          float v = vLp.y + vSz.y * 0.5;
          vec2 cell = vec2(u / 3.1, v / 3.0), f = fract(cell), id = floor(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.74) * step(v, vSz.y - 0.6);
          float lit = wh(id + vSz.xz);
          vec3 glass = mix(vec3(0.16, 0.2, 0.25), vec3(0.5, 0.56, 0.6), step(0.72, lit));
          // the floor slab shows as a line under each row, and the rain has run down the wall
          diffuseColor.rgb *= 1.0 - 0.1 * step(f.y, 0.08);
          diffuseColor.rgb *= 0.9 + 0.1 * wh(vec2(id.x, 3.0) + vSz.xz);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.8);
        }`);
  };
  m.customProgramCacheKey = () => 'walls';
  return m;
}

export function Town({ net, blocks, paving }: { net: Net; blocks: Block[]; paving: MeshStandardMaterial }) {
  const body = useRef<InstancedMesh>(null), cap = useRef<InstancedMesh>(null), kit = useRef<InstancedMesh>(null);
  const wall = useMemo(walls, []);
  // every house stays up: the roads are the ones that give way
  const up = blocks;

  const ground = useMemo(
    () => pavingGeometry(
      [
        ...up.map((b) => ({ x0: b.x0 - 3.5, y0: b.y0 - 3.5, x1: b.x1 + 3.5, y1: b.y1 + 3.5 })),
        // where a road ends at a building, the ground between them is paved: a forecourt
        ...net.nodes.filter((n) => n.stub && !n.edge).flatMap((n) =>
          up.filter((b) => Math.hypot(Math.max(b.x0 - n.p.x, 0, n.p.x - b.x1), Math.max(b.y0 - n.p.y, 0, n.p.y - b.y1)) < 34)
            .map((b) => ({ x0: Math.min(b.x0 - 3.5, n.p.x - 9), y0: Math.min(b.y0 - 3.5, n.p.y - 9), x1: Math.max(b.x1 + 3.5, n.p.x + 9), y1: Math.max(b.y1 + 3.5, n.p.y + 9) }))),
      ],
      up.filter((b) => b.path.length > 1).map((b) => ({ pts: b.path, hw: 1.3 })),
    ),
    [up, net],
  );
  useEffect(() => () => ground.dispose(), [ground]);

  useLayoutEffect(() => {
    const o = new Object3D(), c = new Color(), r = rng(9);
    let k = 0;
    up.forEach((b, i) => {
      const w = b.x1 - b.x0, d = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2;
      o.position.set(cx, b.h / 2, cz); o.scale.set(w, b.h, d); o.updateMatrix();
      body.current!.setMatrixAt(i, o.matrix);
      body.current!.setColorAt(i, c.setHex(b.wall));
      // the roof sits inside a low parapet
      o.position.set(cx, b.h + 0.25, cz); o.scale.set(w - 1, 0.5, d - 1); o.updateMatrix();
      cap.current!.setMatrixAt(i, o.matrix);
      cap.current!.setColorAt(i, c.setHex(b.roof));
      // stair heads and water tanks
      for (let n = 0; n < 4; n++) {
        const s = 1.6 + r() * 2.2;
        o.position.set(b.x0 + 3 + r() * (w - 6), b.h + 0.5 + s * 0.4, b.y0 + 2.5 + r() * (d - 5));
        o.scale.set(s * 1.3, s * 0.8, s); o.updateMatrix();
        kit.current!.setMatrixAt(k, o.matrix);
        kit.current!.setColorAt(k++, c.setHex(r() < 0.35 ? 0x7f9fc0 : 0xcfd0cc));
      }
    });
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
      <instancedMesh ref={cap} args={[undefined, undefined, n]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={kit} args={[undefined, undefined, n * 4]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.6} metalness={0.2} />
      </instancedMesh>
    </group>
  );
}
