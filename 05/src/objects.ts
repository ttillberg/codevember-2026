// The thing to grow moss on: a big rounded M standing on the ground plane at y = -0.72.
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

export function buildLetterM(detail = 2): Surface {
  // a chunky M, bevelled so every edge is rounded
  const h = 2.4, half = 1.55, stem = 0.66;
  const shape = new THREE.Shape();
  const pts: [number, number][] = [
    [-half, 0], [-half, h], [-half + stem, h], [0, h * 0.42], [half - stem, h], [half, h],
    [half, 0], [half - stem, 0], [half - stem, h * 0.62], [0, h * 0.1 + 0.03], [-half + stem, h * 0.62], [-half + stem, 0],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const depth = 0.7;
  const extruded = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.22,
    bevelSize: 0.22,
    bevelSegments: 2,
    steps: 1,
  });
  extruded.translate(0, GROUND + 0.22, -depth / 2);
  // three Loop passes: soft, pillowy edges. Smooth-normal lighting hides what little faceting is left.
  const geo = densify(extruded, Math.max(0, detail - 1), 3);
  return finishSurface(geo, 17);
}

/** A word in a bold sans, extruded, bevelled and Loop-rounded into soft pillowy letters, standing on the ground. */
export function buildWord(text: string, font: Font, detail = 2): Surface {
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
  const loops = text.length <= 2 ? 3 : 2;
  const geo = densify(geo0, Math.max(0, detail - 1), loops);
  return finishSurface(geo, 17 + text.length);
}
