// The letters to grow moss on: one rounded glyph standing on the ground plane at y = -0.72.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { finishSurface, subdivide, type Surface } from './rock';

const GROUND = -0.72;

function densify(geo: THREE.BufferGeometry, linear: number, smooth: number) {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  let g = mergeVertices(geo, 1e-4);
  let sub = {
    pos: new Float32Array((g.attributes.position as THREE.BufferAttribute).array as Float32Array),
    idx: Uint32Array.from(g.index!.array),
  };
  for (let i = 0; i < linear; i++) sub = subdivide(sub.pos, sub.idx, false);
  for (let i = 0; i < smooth; i++) sub = subdivide(sub.pos, sub.idx, true);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(sub.pos, 3));
  out.setIndex(new THREE.BufferAttribute(sub.idx, 1));
  return out;
}

/** A word in a sans, extruded, bevelled and Loop-rounded into soft pillowy letters, standing on the ground. */
export function buildWord(text: string, font: Font, detail = 2, loopsOverride?: number): Surface {
  const size = 2.0;
  const depth = 0.6;
  const bevel = 0.18;
  const geo0 = new TextGeometry(text, {
    font,
    size,
    depth,
    curveSegments: 3,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo0.computeBoundingBox();
  const bb = geo0.boundingBox!;
  // centre horizontally and in depth, stand on the ground
  geo0.translate(-(bb.min.x + bb.max.x) / 2, GROUND - bb.min.y, -(bb.min.z + bb.max.z) / 2);
  // longer words get one Loop pass less so the triangle budget stays sane
  const loops = loopsOverride ?? (text.length <= 2 ? 3 : 2);
  const geo = densify(geo0, Math.max(0, detail - 1), loops);
  return finishSurface(geo, 17 + text.length);
}

/**
 * Helvetica's M runs its middle vertex all the way to the baseline, which turns into a heavy V once the
 * letter is rounded. Lift the flat bottom of the V and the notch above it by the same amount. Matched on
 * the outline text of helvetiker_regular, so it warns if the font ever changes under it.
 */
export function fixGlyphs(font: Font) {
  const lift = 300;
  const M = (font.data as { glyphs: Record<string, { o: string }> }).glyphs['M'];
  for (const [from, to] of [
    ['l 537 0', `l 537 ${lift}`],
    ['l 405 0', `l 405 ${lift}`],
    ['l 472 160', `l 472 ${160 + lift}`],
  ]) {
    if (!M.o.includes(from)) console.warn(`fixGlyphs: M outline has no "${from}", font changed?`);
    M.o = M.o.replace(from, to);
  }
}
