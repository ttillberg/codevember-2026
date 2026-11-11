import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { project, type M4, type V4 } from './tesseract';

// A thin laser line along the way the device came, drawn through the vapour: sampled in 4D like the puffs, so it
// turns with the machine, in the full colour of the cell each stretch was flown in, fading out towards the far end
// over the life of the puffs. The room is light, so the fade runs towards the room's colour, not to black.

const EVERY = 0.05; // seconds between samples
const LIFE = 8; // seconds a sample stays, the puffs' life
const N = Math.ceil(LIFE / EVERY) + 2;
const MOVED = 0.012; // 4D: a sample only this far on from the last
// none of it the first second behind the device, then it fades in over the next, so the line starts a way back
// in the wake and is at its strongest there, not at the device's tail
const HIDE = 1, RISE = 1.2;
const ROOM = new THREE.Color('#e9e6df');

export function makeLaser() {
  const mat = new LineMaterial({ linewidth: 0.8, vertexColors: true, toneMapped: false, worldUnits: false });
  // one geometry for good, sized for every sample there can be: each frame the segments are written in place and
  // only as many drawn as there are
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array(N * 3)); geo.setColors(new Float32Array(N * 3));
  const segBuf = (geo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
  const colBuf = (geo.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
  const seg = segBuf.array as Float32Array, col = colBuf.array as Float32Array;
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 4;
  line.visible = false;
  const p4: V4[] = [], rgb: THREE.Color[] = [], born: number[] = [];
  let last = -1e9;
  const ps = new Float32Array(N * 3), cs = new Float32Array(N * 3), v = new THREE.Vector3(), c = new THREE.Color();
  return {
    line,
    /** The device is at `p` now, in the cell coloured `hex`: a sample, if it is time for one. */
    sample(p: V4, now: number, h: string) {
      if (now - last < EVERY) return;
      // only where it has moved on: standing still (a catch, a rest) the samples piled up at its tail and, a second
      // on, showed through its body
      const q = p4[p4.length - 1];
      if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2], p[3] - q[3]) < MOVED) { last = now; return; }
      last = now;
      p4.push(p.slice() as V4); rgb.push(new THREE.Color(h)); born.push(now);
      while (p4.length > N || (born.length && now - born[0] > LIFE)) { p4.shift(); rgb.shift(); born.shift(); }
    },
    /** Redraw under the pose `m`. */
    update(m: M4, now: number, width: number, height: number) {
      const n = p4.length;
      line.visible = n > 1;
      if (n < 2) return;
      for (let i = 0; i < n; i++) {
        project(m, p4[i], v);
        ps[i * 3] = v.x; ps[i * 3 + 1] = v.y; ps[i * 3 + 2] = v.z;
        const sec = now - born[i], age = sec / LIFE, k = Math.max(0, 1 - age) ** 1.5 * THREE.MathUtils.smoothstep(sec, HIDE, HIDE + RISE);
        c.copy(rgb[i]).lerp(ROOM, 1 - k);
        cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b;
      }
      // a polyline as segments, each from one sample to the next, as LineGeometry lays them out
      for (let i = 0; i < n - 1; i++) {
        seg.set(ps.subarray(i * 3, i * 3 + 6), i * 6);
        col.set(cs.subarray(i * 3, i * 3 + 6), i * 6);
      }
      segBuf.needsUpdate = true; colBuf.needsUpdate = true;
      geo.instanceCount = n - 1;
      mat.resolution.set(width, height);
    },
  };
}
