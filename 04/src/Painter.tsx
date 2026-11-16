// The brush. Drag on the ground and a road follows; let go and it is built.
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type LineSegments, type Points, type Ray } from 'three';
import { strokeGeometry } from './geo';
import { CROSS, cumLen, deck, pointOn, type Net, type Road, type V } from './net';

/** How many points of strokes the sketch of a smear can hold. */
const SKETCH = 6000;

/**
 * What a smear shows while it is dragged: not the town pushed about, only the strokes it has moved, as thin lines
 * with a dot at every point. The town itself is made again when the hand lets go. `api` is given a function that
 * takes the moved strokes, or nothing to wipe it.
 */
export function Sketch({ api }: { api: MutableRefObject<(strokes: { pts: V[] }[] | null) => void> }) {
  const lines = useRef<LineSegments>(null), dots = useRef<Points>(null);
  useEffect(() => {
    const seg = new Float32Array(SKETCH * 6), dot = new Float32Array(SKETCH * 3);
    const lg = new BufferGeometry(), dg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(seg, 3));
    dg.setAttribute('position', new BufferAttribute(dot, 3));
    lines.current!.geometry = lg;
    dots.current!.geometry = dg;
    api.current = (strokes) => {
      let n = 0, d = 0;
      for (const s of strokes ?? []) {
        for (let i = 0; i < s.pts.length && d < SKETCH; i++) {
          const p = s.pts[i];
          dot.set([p.x, 0.9, p.y], d++ * 3);
          if (i && n < SKETCH) { const q = s.pts[i - 1]; seg.set([q.x, 0.9, q.y, p.x, 0.9, p.y], n++ * 6); }
        }
      }
      lg.setDrawRange(0, n * 2); dg.setDrawRange(0, d);
      lg.attributes.position.needsUpdate = dg.attributes.position.needsUpdate = true;
      lines.current!.visible = dots.current!.visible = n > 0;
    };
    return () => { api.current = () => {}; lg.dispose(); dg.dispose(); };
  }, [api]);
  return (
    <>
      <lineSegments ref={lines} visible={false} frustumCulled={false} renderOrder={21}>
        <lineBasicMaterial color={0xf4f4f2} transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <points ref={dots} visible={false} frustumCulled={false} renderOrder={22}>
        <pointsMaterial color={NEON} size={7} sizeAttenuation={false} transparent depthTest={false} depthWrite={false} toneMapped={false} />
      </points>
    </>
  );
}

export type Tool = 'road' | 'bridge' | 'smear' | 'erase' | 'trace';
/** the tools that paint or push: what the brush is when trace is not on */
export type Brush = Exclude<Tool, 'trace'>;

const AT = new Vector3();

/**
 * The point of a bridge deck under the finger, if there is one. The brush paints on the ground,
 * and a deck is not where its ground is: seen from the drone it stands well off to one side.
 */
function onDeck(net: Net, ray: Ray): V | null {
  let best: V | null = null, bd = Infinity;
  for (const r of net.roads) {
    if (!r.bridge) continue;
    const cum = cumLen(r.pts);
    for (let d = 0; d <= r.len; d += 3) {
      const h = deck(r, d);
      if (h < 3) continue;
      const p = pointOn(r.pts, cum, d);
      const far = ray.distanceSqToPoint(AT.set(p.x, h, p.y));
      if (far < (r.hw + 1.5) ** 2 && far < bd) { bd = far; best = p; }
    }
  }
  return best;
}

/** What the brush would take hold of here: a stretch of road, on the ground or up on a deck, and how high that is. */
interface Hold { p: V; h: number; road: Road; d: number }

/** The road under the finger: a deck if the eye meets one first, or else the nearest road on the ground within reach. */
function under(net: Net, ray: Ray, ground: V): Hold | null {
  let best: Hold | null = null, bd = Infinity;
  for (const r of net.roads) {
    if (!r.bridge) continue;
    const cum = cumLen(r.pts);
    for (let d = 0; d <= r.len; d += 3) {
      const h = deck(r, d);
      if (h < 3) continue;
      const p = pointOn(r.pts, cum, d);
      const far = ray.distanceSqToPoint(AT.set(p.x, h, p.y));
      if (far < (r.hw + 1.5) ** 2 && far < bd) { bd = far; best = { p, h, road: r, d }; }
    }
  }
  if (best) return best;
  for (const r of net.roads) {
    const cum = cumLen(r.pts);
    for (let d = 0; d <= r.len; d += 3) {
      if (r.bridge && deck(r, d) >= 3) continue;
      const p = pointOn(r.pts, cum, d), far = Math.hypot(p.x - ground.x, p.y - ground.y);
      if (far < r.hw + 5 && far < bd) { bd = far; best = { p, h: 0, road: r, d }; }
    }
  }
  return best;
}

/** On the ground the marks are pale; up on a deck, and for a bridge, they are a green no lamp has, and stand on a stem so the height shows. What is rubbed out is red. */
const PALE = 0xf4f4f2, NEON = 0x39ff14, RED = 0xff2d2d;

interface Props {
  net: Net;
  tool: Tool;
  /** air: whether the stroke began and ended on a bridge deck */
  onStroke: (pts: V[], bridge: boolean, air?: [boolean, boolean], done?: (ok: boolean) => void) => void;
  /** start, every move, and the end of a smear; null ends it */
  onSmear: (phase: 'start' | 'move' | 'end', p: V) => void;
  /** a stretch was pointed at, to follow its traffic */
  onTrace: (p: V) => void;
  /** the ground an erase drag passed over; it takes a size off what is there */
  onErase: (pts: V[]) => void;
}

export function Painter({ net, tool, onStroke, onSmear, onTrace, onErase }: Props) {
  const preview = useRef<Mesh>(null);
  const draw = useRef<{ id: number; pts: V[]; bridge: boolean; smear: boolean; erase: boolean; up: boolean } | null>(null);

  const mesh = useRef<Mesh>(null);
  /** `ghost`: the stroke has been let go and is waiting to be built: a pale mesh where the road will be. `erase`: the drag, in red */
  // The stroke as it is drawn has to be seen by day and after dark: a bright ribbon, the colour of the brush, in a wider
  // faint one. It is not toned down with the picture, so at night it is the brightest thing in it.
  const halo = useRef<Mesh>(null);
  const show = (pts: V[], mode: 'paint' | 'bridge' | 'ghost' | 'erase' = 'paint') => {
    const m = preview.current!, g = mesh.current!, h = halo.current!;
    h.geometry.dispose();
    h.geometry = strokeGeometry(pts, CROSS.lanes * CROSS.lw + 4.5);
    h.visible = pts.length > 1 && mode !== 'ghost';
    // whatever is being laid is green, road or bridge; what is rubbed out is red; the ghost left waiting is pale
    const ink = mode === 'erase' ? RED : mode === 'ghost' ? PALE : NEON;
    (h.material as MeshBasicMaterial).color.setHex(ink);
    m.geometry.dispose();
    m.geometry = g.geometry = strokeGeometry(pts, CROSS.lanes * CROSS.lw + 0.45);
    m.visible = pts.length > 1;
    g.visible = m.visible && mode === 'ghost';
    const mat = m.material as MeshBasicMaterial;
    mat.color.setHex(ink);
    mat.opacity = mode === 'ghost' ? 0.3 : 0.7;
    if (pts.length < 2) link(null);
  };
  // What the stroke joins: every road it has touched on its way lit up from end to end (a bridge only touches what it
  // starts and ends on). Up to a dozen, each its own ribbon at its own height.
  const links = useRef<Group>(null);
  const joined = useRef(new Set<Road>());
  const link = (p: V | null, bridge = false, first = false) => {
    const set = joined.current, g = links.current!;
    if (!p) { if (set.size) { set.clear(); g.children.forEach((c) => { c.visible = false; }); } return; }
    // a bridge in the air touches nothing: only its first point counts here, its last is added when it is let go over a road
    if (bridge && !first) return;
    let grew = false;
    for (const r of net.roads) {
      if (set.has(r) || set.size >= g.children.length) continue;
      const cum = cumLen(r.pts);
      for (let d = 0; d <= r.len; d += 4) {
        const q = pointOn(r.pts, cum, d);
        if (Math.hypot(q.x - p.x, q.y - p.y) < r.hw + 5) { set.add(r); grew = true; break; }
      }
    }
    if (!grew) return;
    [...set].forEach((r, i) => {
      const c = g.children[i] as Mesh, up = r.bridge ? deck(r, r.len / 2) : 0;
      c.geometry.dispose();
      c.geometry = strokeGeometry(r.pts, r.hw + 0.8);
      c.position.y = up + 0.3;
      (c.material as MeshBasicMaterial).color.setHex(up > 0 ? NEON : PALE);
      c.visible = true;
    });
  };
  // Where the brush is and what it would take hold of: a ring under the finger, the stretch of road it is on lit up,
  // and while a stroke is drawn another ring left standing where it began
  const here = useRef<Group>(null), from = useRef<Group>(null), near = useRef<Mesh>(null);
  const mark = (g: Group, p: V | null, h = 0) => {
    g.visible = !!p;
    if (!p) return;
    g.position.set(p.x, 0, p.y);
    const [ring, stem] = g.children as Mesh[], color = h > 0 ? NEON : PALE;
    ring.position.y = h + 0.5;
    stem.visible = h > 0;
    stem.position.y = h / 2;
    stem.scale.y = Math.max(h, 0.01);
    (ring.material as MeshBasicMaterial).color.setHex(color);
    (stem.material as MeshBasicMaterial).color.setHex(color);
  };
  const point = (e: ThreeEvent<PointerEvent>) => {
    const ground = { x: e.point.x, y: e.point.z };
    // the brushes that push or rub out work on the ground as it lies: they take hold of nothing
    const hold = tool === 'smear' || tool === 'erase' || draw.current?.smear || draw.current?.erase ? null : under(net, e.ray, ground);
    mark(here.current!, hold ? hold.p : ground, hold ? hold.h : 0);
    const n = near.current!;
    n.visible = !!hold;
    if (!hold) return;
    // the stretch it is on: a few metres either way, laid over the road at its height
    const cum = cumLen(hold.road.pts), pts: V[] = [];
    for (let d = Math.max(0, hold.d - 14); d <= Math.min(hold.road.len, hold.d + 14); d += 3.5) pts.push(pointOn(hold.road.pts, cum, d));
    n.geometry.dispose();
    n.geometry = strokeGeometry(pts, hold.road.hw + 0.6);
    n.position.y = hold.h + 0.25;
    (n.material as MeshBasicMaterial).color.setHex(hold.h > 0 ? NEON : PALE);
  };
  const leave = () => { if (!draw.current) { mark(here.current!, null); near.current!.visible = false; } };
  // the road it was on may be gone when the roads change
  useEffect(() => { if (near.current) near.current.visible = false; }, [net]);

  // the ghost stays until the road it stands for is there
  const waiting = useRef(false);
  useEffect(() => {
    if (waiting.current && !draw.current) { waiting.current = false; show([]); }
  }, [net]);
  const cancel = () => {
    const d = draw.current;
    if (d && d.smear) onSmear('end', d.pts[d.pts.length - 1]);
    draw.current = null;
    show([]);
    mark(from.current!, null);
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    // a second finger means the map is being moved, not painted
    if (draw.current) return cancel();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = { x: e.point.x, y: e.point.z };
    if (tool === 'trace') return onTrace(onDeck(net, e.ray) ?? p);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // erase works on the ground under the drag, so it never starts on a deck
    const erase = tool === 'erase';
    const smear = !erase && (tool === 'smear' || e.shiftKey);
    // a stroke that starts on a deck starts up there
    const top = smear || erase ? null : onDeck(net, e.ray);
    draw.current = { id: e.pointerId, pts: [top ?? p], bridge: !smear && !erase && (tool === 'bridge' || e.metaKey || e.ctrlKey), smear, erase, up: !!top };
    if (smear) onSmear('start', p);
    // where it began stays marked for as long as it is drawn
    const hold = smear || erase ? null : under(net, e.ray, p);
    mark(from.current!, top ?? hold?.p ?? p, top && hold ? hold.h : 0);
    if (!smear && !erase) link(top ?? p, tool === 'bridge' || e.metaKey || e.ctrlKey, true);
    point(e);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    point(e);
    const d = draw.current;
    if (!d || d.id !== e.pointerId) return;
    const p = { x: e.point.x, y: e.point.z };
    if (d.smear) {
      d.pts[1] = p;
      return onSmear('move', p);
    }
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 5) return;
    d.pts.push(p);
    show(d.pts, d.erase ? 'erase' : d.bridge ? 'bridge' : 'paint');
    if (!d.erase) link(p, d.bridge);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = draw.current;
    if (!d || d.id !== e.pointerId) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    cancel();
    if (d.smear) return;
    if (d.erase) return d.pts.length > 1 && onErase(d.pts);
    // and one that is let go over a deck ends on it
    const top = onDeck(net, e.ray);
    if (top && Math.hypot(top.x - d.pts[0].x, top.y - d.pts[0].y) > 25) d.pts.push(top);
    if (d.pts.length < 2) return;
    show(d.pts, 'ghost');
    waiting.current = true;
    // nothing came of it: the ghost goes at once
    onStroke(d.pts, d.bridge, [d.up, !!top && d.pts[d.pts.length - 1] === top], (ok) => {
      if (!ok && !draw.current) { waiting.current = false; show([]); }
    });
  };

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={leave}>
        <planeGeometry args={[5000, 5000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={halo} visible={false} raycast={() => null} renderOrder={17}>
        <bufferGeometry />
        <meshBasicMaterial transparent opacity={0.22} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={preview} visible={false} raycast={() => null} renderOrder={18}>
        <bufferGeometry />
        <meshBasicMaterial color={PALE} transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={links}>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} visible={false} raycast={() => null} renderOrder={16}>
            <bufferGeometry />
            <meshBasicMaterial transparent opacity={0.3} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {[here, from].map((ref, i) => (
        <group key={i} ref={ref} visible={false}>
          <mesh rotation-x={-Math.PI / 2} raycast={() => null} renderOrder={20}>
            <ringGeometry args={[i ? 2.2 : 3.4, i ? 3.6 : 4.6, 40]} />
            <meshBasicMaterial transparent opacity={0.9} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh raycast={() => null} renderOrder={20}>
            <cylinderGeometry args={[0.3, 0.3, 1, 6]} />
            <meshBasicMaterial transparent opacity={0.7} depthTest={false} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={near} visible={false} raycast={() => null} renderOrder={19}>
        <bufferGeometry />
        <meshBasicMaterial transparent opacity={0.28} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={mesh} visible={false} raycast={() => null}>
        <bufferGeometry />
        <meshBasicMaterial color={0xffffff} wireframe transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}
