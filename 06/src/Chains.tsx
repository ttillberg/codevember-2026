import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { tilts } from './clock';
import { planetRadius, type Scale } from './kepler';
import { deckHeight, isFine, ringPath } from './layout';
import { PLANETS } from './planets';
import { ANCHORS, anchorIndex, bracket } from './Rail';

export const CHAIN_SCALE = 0.7; // shrinks every chain, links get smaller and more numerous
const LINK = 0.34 * CHAIN_SCALE; // link length at gauge 1
const HOLE = 0.2; // link wire thickness relative to the link's width: low means big holes, an airy chain
const BALL = 0.06 * CHAIN_SCALE; // ball chain bead radius at gauge 1
const CEILING = 90; // where the winches are, out of sight above
const MAX_LINKS = 90000;
const MAX_BALLS = 30000;

type Kind = 'link' | 'ball';

// Deterministic per-chain variety: most are fine link chain, some are ball chain, a few are heavier.
function spec(i: number): { kind: Kind; gauge: number } {
  const h = (k: number) => {
    const x = Math.sin(i * 91.7 + k * 13.3) * 43758.5453;
    return x - Math.floor(x);
  };
  const roll = h(1);
  if (roll < 0.15) return { kind: 'ball', gauge: 0.6 + 0.25 * h(2) };
  if (roll < 0.3) return { kind: 'link', gauge: 0.9 + 0.2 * h(2) };
  return { kind: 'link', gauge: 0.45 + 0.2 * h(2) };
}

// Tiny steel chains of a few kinds (mostly fine link chain, some ball chain, a few heavier), each ring on its own CHAINS_PER_RING, straight up from the brackets to the ceiling. As a ring tilts,
// each chain rides up or down in its own phase. Links are laid from the bracket upwards at a fixed pitch, so the
// chain moves with the ring like it is being reeled, rather than stretching.
export function Chains({ mode }: { mode: Scale }) {
  const mesh = useRef<InstancedMesh>(null!);

  const anchors = useMemo(
    () =>
      PLANETS.flatMap((p) => {
        const path = ringPath(p, mode);
        const r = planetRadius(p, mode);
        return ANCHORS.map((a) => ({ name: p.name, eye: bracket(path, r, anchorIndex(path, a), isFine(p.name)).eye }));
      }).map((c, i) => ({ ...c, ...spec(i) })),
    [mode],
  );
  const balls = useRef<InstancedMesh>(null!);

  const s = useMemo(
    () => ({ a: new Vector3(), p: new Vector3(), sc: new Vector3(),
      q0: new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
      q: new Quaternion(), twist: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), m: new Matrix4() }),
    [],
  );

  useFrame(() => {
    let n = 0, b = 0;
    for (const c of anchors) {
      s.a.copy(c.eye);
      const t = tilts.get(c.name);
      if (t) s.a.applyQuaternion(t);
      s.a.y += deckHeight(c.name, mode);
      const g = c.gauge;
      if (c.kind === 'link') {
        const pitch = LINK * g * 0.72; // links overlap so they interlock
        s.sc.set(LINK * g * 0.5, LINK * g * 0.28, LINK * g * 0.28);
        const links = Math.max(0, Math.floor((CEILING - s.a.y) / pitch));
        for (let i = 0; i < links && n < MAX_LINKS; i++, n++) {
          s.p.set(s.a.x, s.a.y + (i + 0.5) * pitch, s.a.z);
          s.q.copy(s.q0);
          if (i % 2) s.q.multiply(s.twist);
          s.m.compose(s.p, s.q, s.sc);
          mesh.current.setMatrixAt(n, s.m);
        }
      } else {
        const rad = BALL * g;
        const pitch = rad * 3.4; // beads with a visible gap
        s.sc.setScalar(rad);
        const beads = Math.max(0, Math.floor((CEILING - s.a.y) / pitch));
        for (let i = 0; i < beads && b < MAX_BALLS; i++, b++) {
          s.p.set(s.a.x, s.a.y + (i + 0.5) * pitch, s.a.z);
          s.m.compose(s.p, s.q0, s.sc);
          balls.current.setMatrixAt(b, s.m);
        }
      }
    }
    mesh.current.count = n;
    mesh.current.instanceMatrix.needsUpdate = true;
    balls.current.count = b;
    balls.current.instanceMatrix.needsUpdate = true;
  });

  // A torus stretched along x is one oval link; the tube is thin relative to the link. Ball chain is spheres.
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_LINKS]} frustumCulled={false} castShadow>
        <torusGeometry args={[1, HOLE, 4, 12]} />
        <meshStandardMaterial color="#cfd2d6" metalness={1} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={balls} args={[undefined, undefined, MAX_BALLS]} frustumCulled={false} castShadow>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#d6d8dc" metalness={1} roughness={0.2} />
      </instancedMesh>
    </>
  );
}
