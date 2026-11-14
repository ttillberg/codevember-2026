// The brush. Drag on the ground and a road follows; let go and it is built.
import { useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Mesh } from 'three';
import { strokeGeometry } from './geo';
import { PAINTED, type V } from './net';

export type Tool = 'road' | 'bridge' | 'smear' | 'yield';

interface Props {
  tool: Tool;
  onStroke: (pts: V[], bridge: boolean) => void;
  onYield: (p: V) => void;
  /** start, every move, and the end of a smear; null ends it */
  onSmear: (phase: 'start' | 'move' | 'end', p: V) => void;
}

export function Painter({ tool, onStroke, onYield, onSmear }: Props) {
  const preview = useRef<Mesh>(null);
  const draw = useRef<{ id: number; pts: V[]; bridge: boolean; smear: boolean } | null>(null);

  const show = (pts: V[]) => {
    const m = preview.current!;
    m.geometry.dispose();
    m.geometry = strokeGeometry(pts, PAINTED.lanes * PAINTED.lw + 0.45);
    m.visible = pts.length > 1;
  };
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
    if (tool === 'yield' || e.altKey) return onYield(p);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const smear = tool === 'smear' || e.shiftKey;
    draw.current = { id: e.pointerId, pts: [p], bridge: !smear && (tool === 'bridge' || e.metaKey || e.ctrlKey), smear };
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
    if (!d.smear && d.pts.length > 1) onStroke(d.pts, d.bridge);
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
    </>
  );
}
