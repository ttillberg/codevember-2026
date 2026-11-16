// The brush. Drag on the ground and a road follows; let go and it is built.
import { useEffect, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, Vector3, type Ray } from 'three';
import { strokeGeometry } from './geo';
import { CROSS, cumLen, deck, pointOn, type Net, type V } from './net';

export type Tool = 'road' | 'bridge' | 'smear' | 'trace';

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

interface Props {
  net: Net;
  tool: Tool;
  /** air: whether the stroke began and ended on a bridge deck */
  onStroke: (pts: V[], bridge: boolean, air?: [boolean, boolean], done?: (ok: boolean) => void) => void;
  /** start, every move, and the end of a smear; null ends it */
  onSmear: (phase: 'start' | 'move' | 'end', p: V) => void;
  /** a stretch was pointed at, to follow its traffic */
  onTrace: (p: V) => void;
}

export function Painter({ net, tool, onStroke, onSmear, onTrace }: Props) {
  const preview = useRef<Mesh>(null);
  const draw = useRef<{ id: number; pts: V[]; bridge: boolean; smear: boolean; up: boolean } | null>(null);

  const mesh = useRef<Mesh>(null);
  /** `ghost`: the stroke has been let go and is waiting to be built: a pale mesh where the road will be */
  const show = (pts: V[], ghost = false) => {
    const m = preview.current!, g = mesh.current!;
    m.geometry.dispose();
    m.geometry = g.geometry = strokeGeometry(pts, CROSS.lanes * CROSS.lw + 0.45);
    m.visible = pts.length > 1;
    g.visible = m.visible && ghost;
    const mat = m.material as MeshBasicMaterial;
    mat.color.setHex(ghost ? 0xf4f4f2 : 0x1d1e21);
    mat.opacity = ghost ? 0.3 : 0.85;
  };
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
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    // a second finger means the map is being moved, not painted
    if (draw.current) return cancel();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = { x: e.point.x, y: e.point.z };
    if (tool === 'trace') return onTrace(onDeck(net, e.ray) ?? p);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const smear = tool === 'smear' || e.shiftKey;
    // a stroke that starts on a deck starts up there
    const top = smear ? null : onDeck(net, e.ray);
    draw.current = { id: e.pointerId, pts: [top ?? p], bridge: !smear && (tool === 'bridge' || e.metaKey || e.ctrlKey), smear, up: !!top };
    if (smear) onSmear('start', p);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
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
    show(d.pts);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const d = draw.current;
    if (!d || d.id !== e.pointerId) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    cancel();
    if (d.smear) return;
    // and one that is let go over a deck ends on it
    const top = onDeck(net, e.ray);
    if (top && Math.hypot(top.x - d.pts[0].x, top.y - d.pts[0].y) > 25) d.pts.push(top);
    if (d.pts.length < 2) return;
    show(d.pts, true);
    waiting.current = true;
    // nothing came of it: the ghost goes at once
    onStroke(d.pts, d.bridge, [d.up, !!top && d.pts[d.pts.length - 1] === top], (ok) => {
      if (!ok && !draw.current) { waiting.current = false; show([]); }
    });
  };

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
        <planeGeometry args={[5000, 5000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={preview} visible={false} raycast={() => null}>
        <bufferGeometry />
        <meshBasicMaterial color={0x1d1e21} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh ref={mesh} visible={false} raycast={() => null}>
        <bufferGeometry />
        <meshBasicMaterial color={0xffffff} wireframe transparent opacity={0.8} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}
