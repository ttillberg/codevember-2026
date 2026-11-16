// Runs the traffic and draws it: one instanced mesh per vehicle type, plus the signal heads.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import type { Net, V } from './net';
import { Heat, Journeys } from './Traffic';
import { PARKED, Sim, signal } from './sim';
import { makeTypes } from './vehicles';

/** How much faster than life the traffic runs, as a timelapse. */
export const TIMELAPSE = 60;

const tmp = new Color();
const SIG = { G: new Color(0x2dff7a), Y: new Color(0xffc21a), R: new Color(0xff2a1a) };

/** `speed` is how fast time goes: TIMELAPSE, or 0 for a still. */
export function Cars({ net, speed, target, heat = false, trace = null, onNote }: {
  net: Net; speed: number;
  /** roughly how many vehicles to keep on the roads */
  target: number;
  heat?: boolean;
  /** a point on the stretch whose traffic is being followed */
  trace?: V | null;
  onNote?: (text: string) => void;
}) {
  const rate = useRef(speed);
  rate.current = speed;
  const types = useMemo(makeTypes, []);
  // one simulation for the life of the page: when the roads change, the traffic moves over to them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sim = useMemo(() => new Sim(net, types), [types]);
  useLayoutEffect(() => sim.setNet(net), [sim, net]);
  useEffect(() => { sim.target = target; }, [sim, target]);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const paint = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 }), []);

  // a fresh simulation (first mount, or a hot reload of sim.ts) starts from empty buffers
  useEffect(() => {
    for (const m of meshes.current) {
      if (!m) continue;
      m.instanceMatrix.array.fill(0);
      m.instanceMatrix.needsUpdate = true;
      for (const c of sim.cars) if (meshes.current[c.type] === m) c.fresh = c.dirty = true;
    }
    (window as any).sim = sim;
  }, [sim]);

  const heads = useMemo(() => {
    const out: { x: number; y: number; z: number; phase: number; off: number }[] = [];
    for (const l of net.lanes) {
      if (!l.road || !l.to.signal || !l.next.length) continue;
      const a = l.pts[l.pts.length - 2], b = l.pts[l.pts.length - 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = l.to.trim * 2 + 1;
      out.push({ x: b.x + ((b.x - a.x) / d) * k, y: 6.4, z: b.y + ((b.y - a.y) / d) * k, phase: l.next[0].conn!.phase, off: l.to.sigOff });
    }
    return out;
  }, [net]);
  const headMesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const o = new Object3D();
    heads.forEach((h, i) => {
      o.position.set(h.x, h.y, h.z);
      o.updateMatrix();
      headMesh.current!.setMatrixAt(i, o.matrix);
      headMesh.current!.setColorAt(i, SIG.R);
    });
    headMesh.current!.instanceMatrix.needsUpdate = true;
  }, [heads]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05) * rate.current;
    const n = Math.ceil(dt / 0.1);
    for (let i = 0; i < n; i++) sim.step(dt / n);

    const ms = meshes.current;
    for (const f of sim.freed) {
      const m = ms[f.type];
      if (m) m.instanceMatrix.array.fill(0, f.slot * 16, f.slot * 16 + 16);
    }
    sim.freed.length = 0;
    for (const c of sim.cars) {
      if (!c.dirty) continue;
      const m = ms[c.type];
      if (!m) continue;
      if (c.fresh) {
        m.setColorAt(c.slot, tmp.setHex(c.color));
        c.fresh = false;
        m.instanceColor!.needsUpdate = true;
      }
      const a = m.instanceMatrix.array, o = c.slot * 16;
      const cs = Math.cos(c.ang), sn = Math.sin(c.ang);
      a[o] = cs * c.sx; a[o + 1] = 0; a[o + 2] = sn * c.sx; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = c.sy; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = -sn * c.sz; a[o + 9] = 0; a[o + 10] = cs * c.sz; a[o + 11] = 0;
      a[o + 12] = c.x; a[o + 13] = c.h; a[o + 14] = c.y; a[o + 15] = 1;
      if (c.state === PARKED) c.dirty = false;
    }
    for (const m of ms) if (m) m.instanceMatrix.needsUpdate = true;

    const hm = headMesh.current;
    if (hm && hm.instanceColor) {
      heads.forEach((h, i) => hm.setColorAt(i, SIG[signal(sim.time + h.off, h.phase)]));
      hm.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {types.map((t, i) => (
        <instancedMesh
          key={t.name}
          ref={(m) => { meshes.current[i] = m; }}
          args={[t.geo, paint, t.cap]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {heat && <Heat sim={sim} net={net} speed={speed} />}
      {trace && <Journeys sim={sim} net={net} at={trace} note={onNote} />}
      <instancedMesh ref={headMesh} args={[undefined, undefined, heads.length]} frustumCulled={false}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
