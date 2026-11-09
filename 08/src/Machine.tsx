import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EDGES, VERTS, project, turn } from './tesseract';
import { st, SPIN, CRANK, TURNTABLE } from './state';
import { sleeveDecal, ACCENTS } from './decals';

// The mechanism. Every edge is a strut in three stages: a sleeve fixed to each ball joint, a stanchion sliding out of
// each sleeve, a rod between the stanchions. Radii are constant, as on a real part; only the lengths change. The sleeves
// along w are sand, the others graphite, so the eye can follow which edges are which as the thing turns inside out.

const R_NODE = 0.13;
const SINK = 0.5; // how far into the ball a sleeve sinks, as a fraction of its radius
const SLEEVE = 0.26, R_SLEEVE = 0.09; // shortest strut is 0.73: two sleeves nearly meet, fully compressed
const STAGE = 0.8, R_STAGE = 0.07;
const R_ROD = 0.05;
const OVER = 0.1; // hidden overlap of a stage inside the one round it
const SEAL = 0.03;

const Y = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Quaternion(1, 0, 0, 0); // y → -y

const SAND = '#d9b985', GRAPHITE = '#3a3a3d', INK = '#1a1a1a', PAPER = '#efe9dd';

export function Machine() {
  const parts = useMemo(() => {
    const group = new THREE.Group();
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 48, 1);
    const sph = new THREE.SphereGeometry(1, 40, 28);
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.55, metalness: 0.1 });
    const silver = new THREE.MeshStandardMaterial({ color: '#dedede', roughness: 0.28, metalness: 0.75 });
    const stageMats = [
      new THREE.MeshStandardMaterial({ color: '#2f2f32', roughness: 0.5, metalness: 0.15 }),
      new THREE.MeshStandardMaterial({ color: '#c8a874', roughness: 0.7, metalness: 0.05 }),
    ];
    const accents = ACCENTS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));

    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const o = new THREE.Mesh(g, m);
      o.frustumCulled = false;
      group.add(o);
      return o;
    };
    const nodes = VERTS.map(() => mesh(sph, black));
    let seed = 8;
    const struts = EDGES.map((e, i) => {
      const sand = e.axis === 3;
      const axis = 'XYZW'[e.axis];
      const sleeves = [0, 1].map((end) => {
        const serial = `SYS—${String(i + 1).padStart(2, '0')}${end ? 'B' : 'A'}`;
        const accent = ACCENTS[(i * 3 + end) % ACCENTS.length];
        const map = sleeveDecal({ base: sand ? SAND : GRAPHITE, ink: sand ? INK : PAPER, serial, axis, seed: seed++, accent });
        return mesh(cyl, new THREE.MeshStandardMaterial({ map, roughness: sand ? 0.78 : 0.62, metalness: 0.05 }));
      });
      // one in five sleeve mouths gets a coloured ring instead of a black seal
      const seals = [0, 1].map((end) => mesh(cyl, (i * 2 + end) % 5 === 0 ? accents[(i + end) % accents.length] : black));
      const stages = [0, 1].map(() => mesh(cyl, stageMats[sand ? 1 : 0]));
      const wipers = [0, 1].map(() => mesh(cyl, black));
      const rod = mesh(cyl, silver);
      return { sleeves, seals, stages, wipers, rod };
    });
    return { group, nodes, struts };
  }, []);

  const tmp = useMemo(() => ({
    P: VERTS.map(() => new THREE.Vector3()),
    dir: new THREE.Vector3(),
    back: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    qb: new THREE.Quaternion(),
  }), []);

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.05);
    if (st.spin) st.angle += SPIN * dt;
    st.angle += st.crank * CRANK * dt;
    if (st.turntable) parts.group.rotation.y += TURNTABLE * dt;

    const m = turn([st.angle, 0, 0]);
    const { P, dir, back, q, qb } = tmp;
    VERTS.forEach((v, k) => project(m, v, P[k]));
    parts.nodes.forEach((n, k) => { n.position.copy(P[k]); n.scale.setScalar(R_NODE); });

    const place = (o: THREE.Mesh, from: THREE.Vector3, d: THREE.Vector3, rot: THREE.Quaternion, at: number, len: number, r: number) => {
      o.position.copy(from).addScaledVector(d, at + len / 2);
      o.quaternion.copy(rot);
      o.scale.set(r, len, r);
    };
    let min = Infinity, max = 0;
    EDGES.forEach((e, i) => {
      const a = P[e.a], b = P[e.b];
      dir.subVectors(b, a);
      const L = dir.length();
      dir.divideScalar(L);
      back.copy(dir).negate();
      min = Math.min(min, L); max = Math.max(max, L);
      q.setFromUnitVectors(Y, dir);
      qb.copy(q).multiply(FLIP);
      const s = parts.struts[i];
      const start = R_NODE * SINK; // sleeve begins inside the ball
      const mouth = start + SLEEVE;
      const ext = THREE.MathUtils.clamp((L - 2 * mouth) / 2, 0, STAGE);
      for (const end of [0, 1] as const) {
        const from = end ? b : a, d = end ? back : dir, rot = end ? qb : q;
        place(s.sleeves[end], from, d, rot, start, SLEEVE, R_SLEEVE);
        place(s.seals[end], from, d, rot, mouth - SEAL, SEAL, R_SLEEVE * 1.07);
        place(s.stages[end], from, d, rot, mouth - OVER, ext + OVER, R_STAGE);
        place(s.wipers[end], from, d, rot, mouth + ext - SEAL, SEAL, R_STAGE * 1.1);
      }
      const rodFrom = mouth + ext - OVER;
      place(s.rod, a, dir, q, rodFrom, L - 2 * rodFrom, R_ROD);
    });
    st.lengths.min = min; st.lengths.max = max;
  });

  return <primitive object={parts.group} />;
}
