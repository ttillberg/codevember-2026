import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  CELLS, CONTENTS, DOOR_FACES, DOOR_JOIN_T, DOOR_STEP, EDGES, FACES, HANDLE, STEPS, centreAt, corner, foldPoint, project,
  stepProgress, zoomAt, DOOR, type V4,
} from './fold';
import { state, labels, STEP_TIME, UNFOLD_TIME, advance } from './state';

// Assembly manual drawing: white paper, black line work. Faces are opaque white so they hide what is behind them;
// the edges are drawn twice, solid where they are in front of every face, and again as thin grey dashes where a face
// covers them (depth test reversed). The cells about to turn are shaded grey, an arrow shows where they go.

const TAU = Math.PI * 2;
const SPIN_T = DOOR_STEP / STEPS; // page 5, the closed wardrobe
const SPIN = [0.37, 0.23, 0.15]; // rad/s in XW, YW, ZW
const INK = '#1a1a1a';
const SHADE = new THREE.Color('#e4e4e4');
const PAPER = new THREE.Color('#ffffff');
const ARROW_SAMPLES = 32;

const damp = (a: number, b: number, k: number, dt: number) => b + (a - b) * Math.exp(-k * dt);

function step(dt: number) {
  const s = state;
  if (s.auto && s.t === s.target) {
    s.wait -= dt;
    if (s.wait <= 0) advance();
  }
  // The 4D turn only lives on the closed wardrobe's page: open, the door swings out far enough to cross the eye.
  // Anywhere else it unwinds to the nearest whole turn, and nothing folds on until it has.
  // it rests a moment first, so the page is seen as printed, with its arrow
  s.rest = s.t === s.target ? s.rest + dt : 0;
  const at = s.t === SPIN_T && s.target === SPIN_T && s.rest > 2.5;
  let home = true;
  if (!at) {
    for (let i = 0; i < 3; i++) {
      const a = s.angles[i], to = Math.round(a / TAU) * TAU;
      s.angles[i] = Math.abs(a - to) < 1e-3 ? to : damp(a, to, 3, dt);
      if (s.angles[i] !== to) home = false;
    }
  } else if (s.spin) {
    for (let i = 0; i < 3; i++) s.angles[i] += SPIN[i] * dt;
  }
  s.still = s.angles.every((a) => a === Math.round(a / TAU) * TAU);
  if (s.t !== s.target && (home || s.t !== SPIN_T)) {
    s.t = s.target > s.t
      ? Math.min(s.target, s.t + dt / (STEP_TIME * STEPS))
      : Math.max(s.target, s.t - dt / UNFOLD_TIME);
  }
}

/** The cells that turn in step s. The far cell's lid is left out: its arrow runs on the bottom arm's. */
const leaders = (s: number) => CELLS.filter((c) => !c.noArrow && c.hinges.some((hg) => hg.step === s));
const OFF = 1e4; // where hidden segments go, outside the camera's depth range

/** The arrow for a cell in its step: the path of a point just off the middle of its outer face. */
function arrowPath(ci: number, s: number): Float32Array {
  const cell = CELLS[ci];
  const o = cell.offset;
  const len = Math.hypot(o[0], o[1], o[2]);
  const n = o.map((x) => x / len);
  const from = cell.arrow ?? o.map((x, a) => x + n[a] * 1.45);
  const pts = new Float32Array(ARROW_SAMPLES * 3);
  const p: V4 = [0, 0, 0, 0], c: V4 = [0, 0, 0, 0];
  for (let i = 0; i < ARROW_SAMPLES; i++) {
    const t = (s + 0.04 + 0.9 * (i / (ARROW_SAMPLES - 1))) / STEPS;
    for (let a = 0; a < 3; a++) p[a] = from[a];
    p[3] = 0;
    foldPoint(cell, p, t);
    project(p, centreAt(t, c), [0, 0, 0], zoomAt(t), pts, i * 3);
  }
  return pts;
}

function lineMat(color: string, width: number, extra: Partial<LineMaterial> = {}) {
  const m = new LineMaterial({ color, linewidth: width * Math.min(devicePixelRatio, 2) });
  Object.assign(m, extra);
  return m;
}

/** A polyline as segments, for LineSegmentsGeometry. */
function polySegments(pts: Float32Array, count: number, out: Float32Array) {
  for (let i = 0; i < count - 1; i++) out.set(pts.subarray(i * 3, i * 3 + 6), i * 6);
}

export function Tesseract() {
  const { scene } = useThree();
  const faces = useRef<(THREE.Mesh | null)[]>([]);

  const geos = useMemo(
    () =>
      CELLS.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FACES.length * 6 * 3), 3));
        return g;
      }),
    [],
  );
  const mats = useMemo(
    () =>
      CELLS.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: '#fff', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          }),
      ),
    [],
  );

  // edge lines: solid in front, dashed behind, sharing one geometry
  const lines = useMemo(() => {
    const segs = new Float32Array((CELLS.length * EDGES.length + (CONTENTS.length + HANDLE.length) / 2) * 6);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(segs);
    const front = new LineSegments2(geo, lineMat(INK, 2.2));
    const back = new LineSegments2(
      geo,
      lineMat('#9a9a9a', 1.2, {
        dashed: true, dashSize: 0.09, gapSize: 0.07, depthFunc: THREE.GreaterDepth, depthWrite: false,
      }),
    );
    front.frustumCulled = back.frustumCulled = false;
    back.renderOrder = 1;
    return { segs, geo, front, back };
  }, []);

  // two arrows at most (a step folds a pair), a line and a cone each
  const arrows = useMemo(
    () =>
      [0, 1].map(() => {
        const segs = new Float32Array((ARROW_SAMPLES - 1) * 6);
        const geo = new LineSegmentsGeometry();
        geo.setPositions(segs);
        const mat = lineMat(INK, 2.6, { transparent: true, depthTest: false });
        const line = new LineSegments2(geo, mat);
        const headMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, depthTest: false });
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 20), headMat);
        line.frustumCulled = head.frustumCulled = false;
        line.renderOrder = head.renderOrder = 2;
        return { segs, geo, line, mat, head, headMat, key: '' };
      }),
    [],
  );

  useEffect(() => {
    scene.add(lines.front, lines.back);
    for (const a of arrows) scene.add(a.line, a.head);
    return () => void scene.remove(lines.front, lines.back, ...arrows.flatMap((a) => [a.line, a.head]));
  }, [scene, lines, arrows]);

  const tmp = useMemo(
    () => ({
      p: [0, 0, 0, 0] as V4, c: [0, 0, 0, 0] as V4, pts: new Float32Array(CELLS.length * 8 * 3),
      a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame(({ camera, size }, dt) => {
    step(Math.min(dt, 0.05));
    const { p, c, pts } = tmp;
    const t = state.t;

    centreAt(t, c);
    const zoom = zoomAt(t);
    CELLS.forEach((cell, ci) => {
      for (let k = 0; k < 8; k++) project(corner(cell, k, t, p), c, state.angles, zoom, pts, (ci * 8 + k) * 3);
    });

    // faces
    const s = Math.min(STEPS - 1, Math.floor(t * STEPS + 1e-6)); // the step we're at or in
    const frac = t * STEPS - s;
    // arrows, shading and letters are for the drawing as printed, not while it turns in 4D
    const folding = state.still && (state.target > t || (state.target === t && t < 1));
    const open = stepProgress(t, DOOR_STEP);
    CELLS.forEach((cell, ci) => {
      const pos = geos[ci].attributes.position as THREE.BufferAttribute;
      let o = 0;
      FACES.forEach((f, fi) => {
        const gone = (open > 0.01 || t >= DOOR_JOIN_T[ci] - 1e-6) && DOOR_FACES[ci].includes(fi); // the door's, not ours
        for (const k of [f[0], f[1], f[2], f[0], f[2], f[3]]) {
          const i = (ci * 8 + k) * 3;
          pos.array[o++] = gone ? OFF : pts[i]; pos.array[o++] = gone ? OFF : pts[i + 1]; pos.array[o++] = gone ? OFF : pts[i + 2];
        }
      });
      pos.needsUpdate = true;
      const active = folding && t < 1 && cell.hinges.some((hg) => hg.step === s);
      mats[ci].color.lerp(active ? SHADE : PAPER, 1 - Math.exp(-8 * dt));
    });

    // part letters on the cells this page is about
    CELLS.forEach((cell, ci) => {
      const l = labels[ci];
      l.on = folding && t < 1 && cell.hinges.some((hg) => hg.step === s) || (t === 0 && ci === 0);
      if (!l.on) return;
      tmp.a.set(0, 0, 0);
      for (let k = 0; k < 8; k++) tmp.a.x += pts[(ci * 8 + k) * 3] / 8, tmp.a.y += pts[(ci * 8 + k) * 3 + 1] / 8, tmp.a.z += pts[(ci * 8 + k) * 3 + 2] / 8;
      tmp.a.project(camera);
      l.x = (tmp.a.x * 0.5 + 0.5) * size.width;
      l.y = (-tmp.a.y * 0.5 + 0.5) * size.height;
    });

    // edges
    let o = 0;
    for (let ci = 0; ci < CELLS.length; ci++) for (const [i, j] of EDGES) {
      lines.segs.set(pts.subarray((ci * 8 + i) * 3, (ci * 8 + i) * 3 + 3), o);
      lines.segs.set(pts.subarray((ci * 8 + j) * 3, (ci * 8 + j) * 3 + 3), o + 3);
      o += 6;
    }
    // what's inside, once the door is half open, and the handle, once it's on
    const put = (src: V4[], show: boolean, frame: (p: V4) => void) => {
      for (const q of src) {
        if (!show) { lines.segs.fill(OFF, o, o + 3); o += 3; continue; }
        p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; p[3] = q[3];
        frame(p);
        project(p, c, state.angles, zoom, lines.segs, o);
        o += 3;
      }
    };
    put(CONTENTS, open > 0.3, () => {});
    put(HANDLE, t >= DOOR_STEP / STEPS - 1e-6, (q) => foldPoint(CELLS[DOOR], q, t));
    const start = lines.geo.attributes.instanceStart as THREE.InterleavedBufferAttribute;
    (start.data.array as Float32Array).set(lines.segs);
    start.data.needsUpdate = true;
    lines.back.computeLineDistances();

    // arrows: shown at rest before a step, fading as the step gets going
    const show = folding && t < 1 ? Math.max(0, 1 - frac * 3) : 0;
    const who = leaders(s);
    arrows.forEach((ar, i) => {
      const cell = who[i];
      const op = cell ? show : 0;
      ar.mat.opacity = ar.headMat.opacity = damp(ar.mat.opacity, op, 10, dt);
      ar.line.visible = ar.head.visible = ar.mat.opacity > 0.01;
      if (!cell) return;
      const key = `${cell.name}:${s}`;
      if (ar.key !== key) {
        ar.key = key;
        const path = arrowPath(CELLS.indexOf(cell), s);
        polySegments(path, ARROW_SAMPLES, ar.segs);
        const st = ar.geo.attributes.instanceStart as THREE.InterleavedBufferAttribute;
        (st.data.array as Float32Array).set(ar.segs);
        st.data.needsUpdate = true;
        const n = ARROW_SAMPLES - 1;
        tmp.a.fromArray(path, n * 3);
        tmp.b.fromArray(path, (n - 2) * 3);
        const dir = tmp.a.clone().sub(tmp.b).normalize();
        ar.head.position.copy(tmp.a).addScaledVector(dir, 0.1);
        ar.head.quaternion.setFromUnitVectors(tmp.up, dir);
      }
    });
  });

  return (
    <group>
      {CELLS.map((_, i) => (
        <mesh key={i} ref={(el) => void (faces.current[i] = el)} geometry={geos[i]} material={mats[i]} frustumCulled={false} />
      ))}
    </group>
  );
}
