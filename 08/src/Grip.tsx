import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VERTS, EDGES, project } from './tesseract';
import { pose } from './state';
import { drone } from './drone';

// Picking an edge of the machine with the pointer, on its own (the attract mode) and only with alt held: the strut under the pointer gets an
// outline, and a drag on it turns the machine by that strut (App). No raycast: the 16 joints are projected to the
// page each frame and the nearest strut, as a line between its two joints, within a few pixels of the pointer wins;
// near a joint the ball counts as the joint's, not the strut's.

const PICK = 14; // px from a strut's line that still picks it
export const PICK_TOUCH = 28; // a finger's: wider, a finger hides what it is on
const R_OUTLINE = 0.115; // the outline's radius: round the sleeves (0.09) with a band to spare
export const LIME = '#c9e35b';

export const grip = {
  x: 0, y: 0, in: false, // the pointer on the page
  alt: false, // alt held: the only way to a strut
  hover: -1, // the strut under it, or -1
  held: -1, // the strut being dragged, or -1
  /** Where the held or hovered strut is in 4D after the turn: w out of the projection, + toward the eye. */
  w: 0,
};

if (import.meta.env.DEV) Object.assign(window, { __grip: grip });

/** The joints on the page last frame, for picking a strut at once where a finger lands (a touch has no hover). */
const S = VERTS.map(() => new THREE.Vector2());
/** The nearest strut to (x, y) within `pick` px, by its line between the joints, a joint's ball left to the joint; -1, none. */
export function strutAt(x: number, y: number, pick = PICK) {
  let best = -1, bd = pick;
  EDGES.forEach((e, i) => {
    const A = S[e.a], B = S[e.b], abx = B.x - A.x, aby = B.y - A.y, l2 = abx * abx + aby * aby || 1;
    const u = ((x - A.x) * abx + (y - A.y) * aby) / l2;
    if (u < 0.08 || u > 0.92) return; // by a joint: the ball's
    const dx = A.x + abx * u - x, dy = A.y + aby * u - y, dd = Math.hypot(dx, dy);
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}
/** A strut's w in 4D after the turn, its middle's: + toward the eye. */
export function strutW(i: number) {
  const m = pose(), e = EDGES[i];
  return m[3].reduce((s, x, j) => s + x * (VERTS[e.a][j] + VERTS[e.b][j]) / 2, 0);
}

export function Grip() {
  const ref = useRef<THREE.Group>(null);
  const t = useMemo(() => {
    const geo = new THREE.CylinderGeometry(R_OUTLINE, R_OUTLINE, 1, 24, 1, true).translate(0, 0.5, 0); // from the origin up its y, unit long
    const mat = new THREE.MeshBasicMaterial({ color: LIME, side: THREE.BackSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    return { mesh, mat, P: VERTS.map(() => new THREE.Vector3()), S: VERTS.map(() => new THREE.Vector2()), v: new THREE.Vector3(), d: new THREE.Vector3(), last: -2 };
  }, []);

  useFrame(({ camera, size }) => {
    const g = ref.current;
    if (!g) return;
    const m = pose();
    VERTS.forEach((v, k) => {
      project(m, v, t.P[k]);
      t.v.copy(t.P[k]).applyMatrix4(g.matrixWorld).project(camera);
      t.S[k].set((t.v.x + 1) / 2 * size.width, (1 - t.v.y) / 2 * size.height);
      S[k].copy(t.S[k]);
    });
    // the nearest strut under the pointer, on its own only, and not while a strut is held
    if (grip.held < 0) {
      grip.hover = !drone.pilot && grip.in && grip.alt ? strutAt(grip.x, grip.y) : -1;
    }
    const i = grip.held >= 0 ? grip.held : grip.hover;
    if (i !== t.last) { document.querySelector('.stage')?.classList.toggle('edge', i >= 0); t.last = i; }
    t.mesh.visible = i >= 0;
    if (i < 0) return;
    const e = EDGES[i], A = t.P[e.a], B = t.P[e.b];
    grip.w = strutW(i);
    t.d.subVectors(B, A);
    t.mesh.position.copy(A);
    t.mesh.quaternion.setFromUnitVectors(Y, t.v.copy(t.d).normalize());
    t.mesh.scale.set(1, t.d.length(), 1);
    t.mat.color.set(grip.held >= 0 ? LIME : '#e6f29e'); // paler on hover, full lime in the hand
  });

  return <group ref={ref}><primitive object={t.mesh} /></group>;
}

const Y = new THREE.Vector3(0, 1, 0);
