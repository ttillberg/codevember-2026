import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EDGES, VERTS, project } from './tesseract';
import { st, tick, pose, DEBUG, rig } from './state';
import { drone, cellId, CELL_HEX } from './drone';
import { sleeveDecal, scuffSleeve, scratchMap, wear, brushed, rng, ROD_SPAN, ACCENTS, SAND, GRAPHITE, type Brand } from './decals';
import { withLogos } from './logos';
import { cut, withCut, DITHER_PX } from './cutaway';

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
const LIP = 0.01; // a seal stands proud of the mouth it sits on, so their end caps never share a plane

const Y = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Quaternion(1, 0, 0, 0); // y → -y

const INK = '#1a1a1a', PAPER = '#efe9dd';

// A few status LEDs on the balls: which node, where on it, what colour, how it blinks.
const LEDS: { node: number; dir: [number, number, number]; color: string; blink: (t: number) => number }[] = [
  { node: 0, dir: [0.3, 0.8, 0.5], color: '#c9e35b', blink: (t) => (t % 2.4 < 0.08 || (t % 2.4 > 0.22 && t % 2.4 < 0.3) ? 1 : 0.04) }, // heartbeat
  { node: 5, dir: [-0.6, 0.6, 0.5], color: '#ef5f9f', blink: (t) => 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.3)) }, // breathe
  { node: 10, dir: [0.5, 0.7, -0.5], color: '#f2703f', blink: (t) => (t % 5.1 < 0.06 ? 1 : 0.02) }, // rare flash
  { node: 12, dir: [-0.4, 0.9, 0.2], color: '#c9e35b', blink: (t) => (Math.floor(t * 4) % 2 ? 1 : 0.1) }, // fast steady
  { node: 3, dir: [0.7, 0.3, 0.6], color: '#8e7cf0', blink: (t) => (t % 3.2 < 1.6 ? 1 : 0.05) }, // slow square
  { node: 15, dir: [-0.5, 0.5, -0.7], color: '#ef5f9f', blink: (t) => (t % 1.1 < 0.05 ? 1 : 0.03) }, // tick
];
const R_LED = 0.012; // a few pixels

// Assembly marks. A parting line round each ball, two screws on it; a groove round each sleeve by the ball, a screw
// beside it. Screws are a dark disc flush with the surface and a darker hex socket in it: the eye reads the recess.
const SEAM_T = 0.0045; // half-thickness of a seam line
const GROOVE_AT = 0.07; // along the sleeve from its start
const R_SCREW = 0.016, R_HEX = 0.0075;
const X = new THREE.Vector3(1, 0, 0);
const ROT_TORUS = new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2); // torus axis z → y

export function Machine() {
  const parts = useMemo(() => {
    const group = new THREE.Group();
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 48, 1);
    const sph = new THREE.SphereGeometry(1, 40, 28);
    const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6, metalness: 0.1, roughnessMap: scratchMap() });
    // the rods: brushed, and two of them carry a CE mark etched in
    const silver = new THREE.MeshStandardMaterial({ map: brushed('#dedede', 41), roughness: 0.3, metalness: 0.75 });
    const marked = [0, 1].map((k) => new THREE.MeshStandardMaterial({ map: brushed('#dedede', 43 + k, true), roughness: 0.3, metalness: 0.75 }));
    const CE_RODS = [7, 26];
    const ALL_CE = false; // debugging: every rod marked, to see it (on for a while; off, only CE_RODS carry it)
    // every painted part is a little worn, all over, the metal is not: a hand of wear textures per paint, dealt out
    const POOL = 6;
    const BUMP = new THREE.Vector2(0.35, 0.35); // the hard wear as tiny grooves
    // the sand lit up more by the room than the graphite, so it reads light, its shade side not muddy (as the graphite,
    // for a while: lots of shadow on it)
    const SAND_LIGHT = 1.5;
    const worn = (base: string, roughness: number, metalness: number, salt: number, light = 1) =>
      Array.from({ length: POOL }, (_, k) => { const map = wear(base, salt + k); return new THREE.MeshStandardMaterial({ map, normalMap: map.userData.bump, normalScale: BUMP, roughness, metalness, envMapIntensity: light }); });
    const paint = (map: THREE.Texture, sand: boolean) => new THREE.MeshStandardMaterial({ map, normalMap: map.userData.bump, normalScale: BUMP, roughness: sand ? 0.78 : 0.62, metalness: 0.05, envMapIntensity: sand ? SAND_LIGHT : 1 });
    const stageMats = [worn('#2f2f32', 0.5, 0.15, 700), worn('#c8a874', 0.7, 0.05, 800, SAND_LIGHT)];
    // the same six textures on a hundred parts would show: each part takes its own copy of one, shifted round the
    // tube by a random turn and mirrored either way. The copies share the image on the GPU; only the mapping differs.
    // A clone shares its image with the original but not its upload flag: when the sheets land and the originals are
    // redrawn, every clone has to be flagged too, or the GPU keeps the bare canvas it saw first.
    const clones: THREE.Texture[] = [];
    const dealt = (pool: THREE.MeshStandardMaterial[], k: number) => {
      const m = pool[k % pool.length].clone();
      const t = m.map!.clone(), n = m.normalMap!.clone();
      clones.push(t, n);
      t.offset.x = rnd();
      t.repeat.set(rnd() < 0.5 ? -1 : 1, rnd() < 0.5 ? -1 : 1);
      n.offset.copy(t.offset); n.repeat.copy(t.repeat); // the grooves must sit on the marks
      t.needsUpdate = n.needsUpdate = true;
      m.map = t; m.normalMap = n;
      return m;
    };
    const accents = ACCENTS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    // most sleeves are plain paint; one in three carries a decal
    const plain = [worn(GRAPHITE, 0.62, 0.05, 500), worn(SAND, 0.78, 0.05, 600, SAND_LIGHT)];
    // the marks: two of each on the decaled sleeves, wherever the shuffle puts them; a few wordmarks; the rest none
    const decaled = EDGES.flatMap((_, i) => [0, 1].filter((end) => (i * 2 + end) % 3 === 1).map((end) => i * 2 + end));
    const rnd = rng(8);
    for (let k = decaled.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [decaled[k], decaled[j]] = [decaled[j], decaled[k]]; }
    const hand: Brand[] = ['three', 'three', 'pmndrs', 'pmndrs', 'github', 'github', 'word', 'word', 'word'];
    const brandOf = new Map<number, Brand>(decaled.slice(0, hand.length).map((id, k) => [id, hand[k]]));

    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const o = new THREE.Mesh(g, m);
      o.frustumCulled = false;
      group.add(o);
      return o;
    };
    const nodes = VERTS.map(() => mesh(sph, black));

    const dark = new THREE.MeshStandardMaterial({ color: '#0c0c0c', roughness: 0.7 });
    const head = new THREE.MeshStandardMaterial({ color: '#8a8a90', roughness: 0.3, metalness: 0.85 });
    const hex = new THREE.MeshStandardMaterial({ color: '#070707', roughness: 0.9 });
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
      const o = new THREE.InstancedMesh(g, m, n);
      o.frustumCulled = false;
      group.add(o);
      return o;
    };
    const nScrews = VERTS.length * 2 + EDGES.length * 2;
    const marks = {
      seams: inst(new THREE.TorusGeometry(1, SEAM_T / R_NODE, 8, 64), dark, VERTS.length),
      grooves: inst(new THREE.TorusGeometry(1, SEAM_T / R_SLEEVE, 8, 48), dark, EDGES.length * 2),
      heads: inst(new THREE.CylinderGeometry(1, 1, 1, 24), head, nScrews),
      hexes: inst(new THREE.CylinderGeometry(1, 1, 1, 6), hex, nScrews),
    };
    const leds = LEDS.map((l) => {
      const m = new THREE.MeshStandardMaterial({ color: l.color, emissive: l.color, emissiveIntensity: 1, roughness: 0.3, toneMapped: false });
      const o = mesh(sph, m);
      const bezel = mesh(cyl, black); // a short black collar round it
      return { o, m, bezel, dir: new THREE.Vector3(...l.dir).normalize(), blink: l.blink, node: l.node };
    });
    // debugging: a lamp on each of the eight corners of the cell the device is in, in that cell's colour, blinking
    const cellLeds = DEBUG ? Array.from({ length: 8 }, () => {
      // drawn through the ball, so it reads from any side
      const m = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff', emissiveIntensity: 1, roughness: 0.3, toneMapped: false, depthTest: false });
      const o = mesh(sph, m); o.renderOrder = 11;
      return { o, m };
    }) : [];
    let seed = 8;
    const struts = EDGES.map((e, i) => {
      const sand = e.axis === 3;
      const axis = 'XYZW'[e.axis];
      const sleeves = [0, 1].map((end) => {
        if ((i * 2 + end) % 3 !== 1) {
          // most plain; one in six of these has been knocked about
          if ((i * 7 + end) % 6 !== 0) return mesh(cyl, dealt(plain[sand ? 1 : 0], i * 5 + end * 3));
          const map = scuffSleeve(sand ? SAND : GRAPHITE, i * 2 + end + 300);
          return mesh(cyl, paint(map, sand));
        }
        const serial = `SYS—${String(i + 1).padStart(2, '0')}${end ? 'B' : 'A'}`;
        const accent = ACCENTS[(i * 3 + end) % ACCENTS.length];
        const map = sleeveDecal({ base: sand ? SAND : GRAPHITE, ink: sand ? INK : PAPER, serial, axis, seed: seed++, accent, flip: end === 1, brand: brandOf.get(i * 2 + end) ?? null });
        return mesh(cyl, paint(map, sand));
      });
      // one in five sleeve mouths gets a coloured ring instead of a black seal
      const seals = [0, 1].map((end) => mesh(cyl, (i * 2 + end) % 5 === 0 ? accents[(i + end) % accents.length] : black));
      const stages = [0, 1].map((k) => mesh(cyl, dealt(stageMats[sand ? 1 : 0], i * 3 + k * 2)));
      const wipers = [0, 1].map(() => mesh(cyl, black));
      // the rod's texture is its own: the rod telescopes, and the mapping is reset every frame so the brushing and
      // the mark keep their size instead of squashing with it
      const rodMat = (ALL_CE ? marked[i % 2] : CE_RODS.includes(i) ? marked[CE_RODS.indexOf(i)] : silver).clone();
      const rodTex = rodMat.map!.clone();
      clones.push(rodTex);
      rodMat.map = rodTex;
      const rod = mesh(cyl, rodMat);
      return { sleeves, seals, stages, wipers, rod, rodTex };
    });
    withLogos(() => { for (const t of clones) t.needsUpdate = true; }); // after the sheets are drawn on: registered last, runs last
    return { group, nodes, struts, leds, cellLeds, marks };
  }, []);

  const tmp = useMemo(() => ({
    P: VERTS.map(() => new THREE.Vector3()),
    dir: new THREE.Vector3(),
    back: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    qb: new THREE.Quaternion(),
    dummy: new THREE.Object3D(),
    side: new THREE.Vector3(),
  }), []);

  const cutTmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size, gl }, dt) => {
    dt = Math.min(dt, 0.05);
    // the cutaway round the probe: where it is on the page, on while it is followed or flown, eased; every material
    // the machine has gets it (cheap once they have)
    withCut(parts.group);
    cutTmp.copy(drone.world).project(camera);
    cut.at.value.copy(cutTmp); cut.aspect.value = size.width / size.height; cut.px.value = DITHER_PX * gl.getPixelRatio();
    const cutOn = drone.on && (rig.follow || drone.pilot) ? 1 : 0;
    cut.on.value += (cutOn - cut.on.value) * Math.min(1, dt * 3);
    tick(drone.frozen ? 0 : dt); // P: no turn, no turntable

    const m = pose();
    const { P, dir, back, q, qb, dummy, side } = tmp;
    const { seams, grooves, heads, hexes } = parts.marks;
    let screw = 0;
    /** A screw at p, its axis along n (unit, pointing out of the surface). */
    const putScrew = (p: THREE.Vector3, n: THREE.Vector3) => {
      dummy.quaternion.setFromUnitVectors(Y, n);
      dummy.position.copy(p).addScaledVector(n, -0.004);
      dummy.scale.set(R_SCREW, 0.01, R_SCREW);
      dummy.updateMatrix();
      heads.setMatrixAt(screw, dummy.matrix);
      dummy.position.copy(p).addScaledVector(n, -0.0025);
      dummy.scale.set(R_HEX, 0.01, R_HEX);
      dummy.updateMatrix();
      hexes.setMatrixAt(screw, dummy.matrix);
      screw++;
    };
    VERTS.forEach((v, k) => project(m, v, P[k]));
    parts.nodes.forEach((n, k) => {
      n.position.copy(P[k]); n.scale.setScalar(R_NODE);
      // parting line round the ball, its axis y in the group's frame; two screws on it
      dummy.position.copy(P[k]);
      dummy.quaternion.copy(ROT_TORUS);
      dummy.scale.setScalar(R_NODE * 0.995);
      dummy.updateMatrix();
      seams.setMatrixAt(k, dummy.matrix);
      for (const a of [0.7, 0.7 + Math.PI]) {
        side.set(Math.cos(a), 0, Math.sin(a));
        putScrew(side.clone().multiplyScalar(R_NODE).add(P[k]), side);
      }
    });

    const place = (o: THREE.Mesh, from: THREE.Vector3, d: THREE.Vector3, rot: THREE.Quaternion, at: number, len: number, r: number) => {
      o.position.copy(from).addScaledVector(d, at + len / 2);
      o.quaternion.copy(rot);
      o.scale.set(r, len, r);
    };
    EDGES.forEach((e, i) => {
      const a = P[e.a], b = P[e.b];
      dir.subVectors(b, a);
      const L = dir.length();
      dir.divideScalar(L);
      back.copy(dir).negate();
      q.setFromUnitVectors(Y, dir);
      qb.copy(q).multiply(FLIP);
      const s = parts.struts[i];
      const start = R_NODE * SINK; // sleeve begins inside the ball
      const mouth = start + SLEEVE;
      const ext = THREE.MathUtils.clamp((L - 2 * mouth) / 2, 0, STAGE);
      for (const end of [0, 1] as const) {
        const from = end ? b : a, d = end ? back : dir, rot = end ? qb : q;
        place(s.sleeves[end], from, d, rot, start, SLEEVE, R_SLEEVE);
        // groove round the sleeve by the ball, a screw just past it
        dummy.position.copy(from).addScaledVector(d, start + GROOVE_AT);
        dummy.quaternion.copy(rot).multiply(ROT_TORUS);
        dummy.scale.setScalar(R_SLEEVE * 0.995);
        dummy.updateMatrix();
        grooves.setMatrixAt(i * 2 + end, dummy.matrix);
        side.copy(X).applyQuaternion(rot);
        putScrew(from.clone().addScaledVector(d, start + GROOVE_AT + 0.05).addScaledVector(side, R_SLEEVE), side);
        place(s.seals[end], from, d, rot, mouth - SEAL + LIP, SEAL, R_SLEEVE * 1.07);
        place(s.stages[end], from, d, rot, mouth - OVER, ext + OVER, R_STAGE);
        place(s.wipers[end], from, d, rot, mouth + ext - SEAL + LIP, SEAL, R_STAGE * 1.1);
      }
      const rodFrom = mouth + ext - OVER;
      const rodLen = L - 2 * rodFrom;
      place(s.rod, a, dir, q, rodFrom, rodLen, R_ROD);
      // the canvas spans ROD_SPAN circumferences of rod; show the window of it this length takes, centred
      s.rodTex.repeat.y = rodLen / (2 * Math.PI * R_ROD * ROD_SPAN);
      s.rodTex.offset.y = (1 - s.rodTex.repeat.y) / 2;
    });
    st.reach = Math.max(...P.map((p) => p.length())) + R_NODE;
    seams.instanceMatrix.needsUpdate = true;
    grooves.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    hexes.instanceMatrix.needsUpdate = true;

    const now = drone.clock; // the lamps on the probe's clock, so P holds them too
    for (const l of parts.leds) {
      const p = P[l.node];
      l.o.position.copy(p).addScaledVector(l.dir, R_NODE * 0.97);
      l.o.scale.setScalar(R_LED);
      l.bezel.position.copy(p).addScaledVector(l.dir, R_NODE * 0.9);
      l.bezel.quaternion.setFromUnitVectors(Y, l.dir);
      l.bezel.scale.set(R_LED * 2, R_NODE * 0.2, R_LED * 2);
      const b = l.blink(now);
      l.m.emissiveIntensity = 0.1 + 3 * b;
      l.m.color.set(l.m.emissive).multiplyScalar(0.2 + 0.8 * b);
    }
    if (parts.cellLeds.length) {
      // the cell's corners are the vertices on its side of its held axis; each lamp sits on its ball facing the cell's middle
      const centre4 = [0, 0, 0, 0] as [number, number, number, number];
      centre4[drone.held] = drone.sign;
      const centre = project(m, centre4, dir);
      const hex = CELL_HEX[cellId()];
      let n = 0;
      VERTS.forEach((v, k) => {
        if (v[drone.held] !== drone.sign) return;
        const l = parts.cellLeds[n++], p = P[k];
        const b = (now + n / 8) % 1 < 0.07 ? 1 : 0.08; // a quick blink each second, each corner in its turn
        back.copy(centre).sub(p).normalize();
        l.o.position.copy(p).addScaledVector(back, R_NODE * 0.97);
        l.o.scale.setScalar(R_LED * 0.8);
        l.m.emissive.set(hex);
        l.m.emissiveIntensity = 0.1 + 3 * b;
        l.m.color.set(l.m.emissive).multiplyScalar(0.2 + 0.8 * b);
      });
    }
  });

  return <primitive object={parts.group} />;
}
