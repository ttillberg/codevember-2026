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
const ROOM = new THREE.Color('#e9e6df');

export function makeLaser() {
  const mat = new LineMaterial({ linewidth: 1.6, vertexColors: true, toneMapped: false, worldUnits: false });
  const line = new Line2(new LineGeometry(), mat);
  line.frustumCulled = false;
  line.renderOrder = 4;
  line.visible = false;
  const p4: V4[] = [], hex: string[] = [], born: number[] = [];
  let last = -1e9;
  const v = new THREE.Vector3(), c = new THREE.Color();
  return {
    line,
    /** The device is at `p` now, in the cell coloured `hex`: a sample, if it is time for one. */
    sample(p: V4, now: number, h: string) {
      if (now - last < EVERY) return;
      last = now;
      p4.push(p.slice() as V4); hex.push(h); born.push(now);
      while (p4.length > N || (born.length && now - born[0] > LIFE)) { p4.shift(); hex.shift(); born.shift(); }
    },
    /** Redraw under the pose `m`. */
    update(m: M4, now: number, width: number, height: number) {
      const n = p4.length;
      line.visible = n > 1;
      if (n < 2) return;
      const ps = new Float32Array(n * 3), cs = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        project(m, p4[i], v);
        ps[i * 3] = v.x; ps[i * 3 + 1] = v.y; ps[i * 3 + 2] = v.z;
        const age = (now - born[i]) / LIFE, k = Math.max(0, 1 - age) ** 1.5;
        c.set(hex[i]).lerp(ROOM, 1 - k);
        cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b;
      }
      line.geometry.dispose();
      line.geometry = new LineGeometry();
      line.geometry.setPositions(ps);
      line.geometry.setColors(cs);
      mat.resolution.set(width, height);
    },
  };
}
