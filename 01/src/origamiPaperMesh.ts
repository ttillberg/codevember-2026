import * as THREE from 'three';
import {
  HALF_D,
  HALF_W,
  HOUSE_PANELS,
  MM,
  ROOF_R,
  WALL_H,
  type FoldablePanelId,
  type HousePanelId,
  type V2,
} from './origamiHouseNet';

/**
 * Pure white tactile origami/washi paper 3D mesh builder for Day 01 (Fold · 折り).
 *
 * The 4 corner off-cuts of the 150 × 150 mm square are pre-cut away, leaving the pure
 * 7-panel symmetric cross net with real punched doorway, flanking windows, side windows,
 * circular attic oculi, and 6 crisp interior scored fold creases.
 */

export const PAPER_THICK = 0.056; // 0.56 mm fine cotton-rag paper: casts crisp minimal micro-shadows along cut ridges!

export interface OrigamiMaterials {
  inside: THREE.MeshStandardMaterial;
  outside: THREE.MeshStandardMaterial;
  edge: THREE.MeshStandardMaterial;
  /** Matching seamless white paper material for the endless background sheet */
  ground: THREE.MeshStandardMaterial;
  foldLine: THREE.LineDashedMaterial;
  foldLineActive: THREE.LineBasicMaterial;
  dispose(): void;
}

function createWashiFiberTextures(maxAniso: number): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const b = document.createElement('canvas');
  b.width = b.height = size;
  const bCtx = b.getContext('2d')!;
  const bImg = bCtx.createImageData(size, size);

  let s = 202601;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * 16;
    const o = i * 4;
    const v = Math.max(0, Math.min(255, 128 + n * 3.1));
    bImg.data[o] = v;
    bImg.data[o + 1] = v;
    bImg.data[o + 2] = v;
    bImg.data[o + 3] = 255;
  }
  bCtx.putImageData(bImg, 0, 0);

  // Subtle kozo washi fiber flecks
  ctx.lineWidth = 0.85;
  for (let k = 0; k < 640; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 5 + rand() * 18;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(218,212,200,0.15)' : 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a + 0.35) * len * 0.5,
      y + Math.sin(a + 0.35) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(0.16, 0.16);
  map.anisotropy = Math.min(16, maxAniso);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(b);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(0.28, 0.28);

  return { map, bumpMap };
}

export function createOrigamiMaterials(maxAniso = 8): OrigamiMaterials {
  const tex = createWashiFiberTextures(maxAniso);

  // Pure white-on-white cotton rag paper: house & ground share the exact same luminous white material!
  const paperColor = new THREE.Color('#ffffff');

  const inside = new THREE.MeshStandardMaterial({
    color: paperColor,
    map: tex.map,
    bumpMap: tex.bumpMap,
    bumpScale: 0.005,
    roughness: 0.93,
    metalness: 0.0,
  });

  const outside = new THREE.MeshStandardMaterial({
    color: paperColor,
    map: tex.map,
    bumpMap: tex.bumpMap,
    bumpScale: 0.005,
    roughness: 0.93,
    metalness: 0.0,
  });

  const edge = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fbfaf7'),
    roughness: 0.95,
    metalness: 0.0,
  });

  // Endless background sheet using the EXACT same white cotton paper color & fiber texture so flat paper melts together!
  const groundTex = tex.map.clone();
  groundTex.needsUpdate = true;
  groundTex.repeat.set(30, 30);
  const groundBump = tex.bumpMap.clone();
  groundBump.needsUpdate = true;
  groundBump.repeat.set(48, 48);

  const ground = new THREE.MeshStandardMaterial({
    color: paperColor,
    map: groundTex,
    bumpMap: groundBump,
    bumpScale: 0.004,
    roughness: 0.93,
    metalness: 0.0,
  });

  // Whisper-minimal debossed fold crease hints (almost invisible until you look closely or hover)
  const foldLine = new THREE.LineDashedMaterial({
    color: 0x8f8c86,
    dashSize: 0.24,
    gapSize: 0.20,
    transparent: true,
    opacity: 0.16,
  });

  const foldLineActive = new THREE.LineBasicMaterial({
    color: 0x3a3835,
    transparent: true,
    opacity: 0.48,
  });

  return {
    inside,
    outside,
    edge,
    ground,
    foldLine,
    foldLineActive,
    dispose() {
      tex.map.dispose();
      tex.bumpMap.dispose();
      groundTex.dispose();
      groundBump.dispose();
      inside.dispose();
      outside.dispose();
      edge.dispose();
      ground.dispose();
      foldLine.dispose();
      foldLineActive.dispose();
    },
  };
}

/**
 * Partition an extruded flat XZ paper geometry into 3 non-overlapping material groups:
 *   0 = Top cap (+Y, inside face)
 *   1 = Cut edges (side rims & punched window frames)
 *   2 = Bottom cap (-Y, exterior face)
 */
function buildDualSidedPaperGeometry(shape: THREE.Shape, thick = PAPER_THICK): THREE.BufferGeometry {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: false,
    curveSegments: 16,
  });
  raw.translate(0, 0, -thick);
  raw.rotateX(-Math.PI * 0.5);

  const nonIdx = raw.index ? raw.toNonIndexed() : raw;
  nonIdx.computeVertexNormals();

  const pos = nonIdx.attributes.position;
  const nrm = nonIdx.attributes.normal;
  const triCount = pos.count / 3;

  const buckets: [number[], number[], number[]] = [[], [], []];
  const nBuckets: [number[], number[], number[]] = [[], [], []];
  const uvBuckets: [number[], number[], number[]] = [[], [], []];

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const ny = (nrm.getY(i0) + nrm.getY(i0 + 1) + nrm.getY(i0 + 2)) / 3;
    const g = ny > 0.5 ? 0 : ny < -0.5 ? 2 : 1;

    for (let k = 0; k < 3; k++) {
      const idx = i0 + k;
      const vx = pos.getX(idx);
      const vy = pos.getY(idx);
      const vz = pos.getZ(idx);
      buckets[g].push(vx, vy, vz);
      nBuckets[g].push(nrm.getX(idx), nrm.getY(idx), nrm.getZ(idx));
      uvBuckets[g].push(vx, vz);
    }
  }

  const totalFloats = buckets[0].length + buckets[1].length + buckets[2].length;
  const finalPos = new Float32Array(totalFloats);
  const finalNrm = new Float32Array(totalFloats);
  const finalUv = new Float32Array((totalFloats / 3) * 2);

  const out = new THREE.BufferGeometry();
  let vOffset = 0;
  for (let g = 0; g < 3; g++) {
    const count = buckets[g].length / 3;
    if (count > 0) {
      finalPos.set(buckets[g], vOffset * 3);
      finalNrm.set(nBuckets[g], vOffset * 3);
      finalUv.set(uvBuckets[g], vOffset * 2);
      out.addGroup(vOffset, count, g);
      vOffset += count;
    }
  }

  out.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(finalNrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(finalUv, 2));

  if (nonIdx !== raw) nonIdx.dispose();
  raw.dispose();
  return out;
}

function addRectHole(shape: THREE.Shape, cx: number, cy: number, w: number, h: number): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const p = new THREE.Path();
  p.moveTo(cx - hw, cy - hh);
  p.lineTo(cx + hw, cy - hh);
  p.lineTo(cx + hw, cy + hh);
  p.lineTo(cx - hw, cy + hh);
  p.closePath();
  shape.holes.push(p);
}

function addArchHole(shape: THREE.Shape, cx: number, yBase: number, w: number, h: number, dirY: 1 | -1): void {
  const hw = w * 0.5;
  const r = Math.min(hw, h * 0.42);
  const springY = yBase + dirY * (h - r);
  const p = new THREE.Path();
  if (dirY < 0) {
    p.moveTo(cx - hw, yBase);
    p.lineTo(cx + hw, yBase);
    p.lineTo(cx + hw, springY);
    p.absarc(cx, springY, r, 0, -Math.PI, true);
    p.lineTo(cx - hw, yBase);
  } else {
    p.moveTo(cx - hw, yBase);
    p.lineTo(cx + hw, yBase);
    p.lineTo(cx + hw, springY);
    p.absarc(cx, springY, r, 0, Math.PI, false);
    p.lineTo(cx - hw, yBase);
  }
  p.closePath();
  shape.holes.push(p);
}

function addCircleHole(shape: THREE.Shape, cx: number, cy: number, r: number): void {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  shape.holes.push(p);
}

function makeLocalShape(polyMm: V2[], oxMm: number, oyMm: number): THREE.Shape {
  const s = new THREE.Shape();
  polyMm.forEach(([x, y], i) => {
    const lx = (x - oxMm) * MM;
    const ly = (y - oyMm) * MM;
    if (i === 0) s.moveTo(lx, ly);
    else s.lineTo(lx, ly);
  });
  s.closePath();
  return s;
}

export interface PanelVisual {
  id: FoldablePanelId;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  foldLine: THREE.Line;
  axis: 'x' | 'z';
  sign: 1 | -1;
  targetAngle: number;
}

export interface OrigamiHouseRig {
  root: THREE.Group;
  baseMesh: THREE.Mesh;
  panels: Record<FoldablePanelId, PanelVisual>;
  updatePanelVisual(id: FoldablePanelId, fold01: number, peekRad: number, hovered: boolean): void;
  dispose(): void;
}

export function buildOrigamiHouseRig(mats: OrigamiMaterials): OrigamiHouseRig {
  const root = new THREE.Group();
  root.position.y = PAPER_THICK;

  const triMats = [mats.inside, mats.edge, mats.outside];

  // 1. Central floor panel (`base`)
  const baseShape = makeLocalShape(HOUSE_PANELS.base.poly, 0, 0);
  const baseGeo = buildDualSidedPaperGeometry(baseShape);
  const baseMesh = new THREE.Mesh(baseGeo, triMats);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  baseMesh.userData = { kind: 'panel', id: 'base' as HousePanelId };
  root.add(baseMesh);

  const makeFoldLine = (a: [number, number, number], b: [number, number, number]): THREE.Line => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...a),
      new THREE.Vector3(...b),
    ]);
    const line = new THREE.Line(g, mats.foldLine);
    line.computeLineDistances();
    return line;
  };

  // 2. Four walls & two roof slopes (pre-cut pure white symmetric cross net!)
  const createPanel = (
    id: FoldablePanelId,
    parent: THREE.Object3D,
    hingeSheetMm: V2,
    localPos: [number, number, number],
    axis: 'x' | 'z',
    sign: 1 | -1,
    creaseA: [number, number, number],
    creaseB: [number, number, number],
    addHoles?: (shape: THREE.Shape) => void,
  ): PanelVisual => {
    const def = HOUSE_PANELS[id];
    const pivot = new THREE.Group();
    pivot.position.set(...localPos);
    parent.add(pivot);

    const shape = makeLocalShape(def.poly, hingeSheetMm[0], hingeSheetMm[1]);
    if (addHoles) addHoles(shape);

    const geo = buildDualSidedPaperGeometry(shape);
    const mesh = new THREE.Mesh(geo, triMats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'panel', id };
    pivot.add(mesh);

    const foldLine = makeFoldLine(creaseA, creaseB);
    pivot.add(foldLine);

    return {
      id,
      pivot,
      mesh,
      foldLine,
      axis,
      sign,
      targetAngle: def.targetAngle,
    };
  };

  const front = createPanel(
    'front',
    root,
    [0, -HALF_D],
    [0, 0, HALF_D * MM],
    'x',
    -1,
    [-HALF_W * MM, 0.004, 0],
    [HALF_W * MM, 0.004, 0],
    (shape) => {
      addArchHole(shape, 0, -0.6 * MM, 8.4 * MM, 13.8 * MM, -1);
      addRectHole(shape, -12.6 * MM, -12.2 * MM, 5.4 * MM, 7.6 * MM);
      addRectHole(shape, 12.6 * MM, -12.2 * MM, 5.4 * MM, 7.6 * MM);
      addCircleHole(shape, 0, -(WALL_H + ROOF_R * 0.44) * MM, 3.6 * MM);
    },
  );

  const back = createPanel(
    'back',
    root,
    [0, HALF_D],
    [0, 0, -HALF_D * MM],
    'x',
    1,
    [-HALF_W * MM, 0.004, 0],
    [HALF_W * MM, 0.004, 0],
    (shape) => {
      addRectHole(shape, -9.2 * MM, 12.2 * MM, 6.2 * MM, 8.2 * MM);
      addRectHole(shape, 9.2 * MM, 12.2 * MM, 6.2 * MM, 8.2 * MM);
      addCircleHole(shape, 0, (WALL_H + ROOF_R * 0.44) * MM, 3.6 * MM);
    },
  );

  const left = createPanel(
    'left',
    root,
    [-HALF_W, 0],
    [-HALF_W * MM, 0, 0],
    'z',
    -1,
    [0, 0.004, -HALF_D * MM],
    [0, 0.004, HALF_D * MM],
    (shape) => {
      for (const wy of [-16.5, 0, 16.5]) {
        addRectHole(shape, -12.4 * MM, wy * MM, 8.2 * MM, 7.4 * MM);
      }
    },
  );

  const right = createPanel(
    'right',
    root,
    [HALF_W, 0],
    [HALF_W * MM, 0, 0],
    'z',
    1,
    [0, 0.004, -HALF_D * MM],
    [0, 0.004, HALF_D * MM],
    (shape) => {
      for (const wy of [-16.5, 0, 16.5]) {
        addRectHole(shape, 12.4 * MM, wy * MM, 8.2 * MM, 7.4 * MM);
      }
    },
  );

  const roofL = createPanel(
    'roofL',
    left.pivot,
    [-(HALF_W + WALL_H), 0],
    [-WALL_H * MM, 0, 0],
    'z',
    -1,
    [0, 0.004, -HALF_D * MM],
    [0, 0.004, HALF_D * MM],
  );

  const roofR = createPanel(
    'roofR',
    right.pivot,
    [HALF_W + WALL_H, 0],
    [WALL_H * MM, 0, 0],
    'z',
    1,
    [0, 0.004, -HALF_D * MM],
    [0, 0.004, HALF_D * MM],
  );

  const panels: Record<FoldablePanelId, PanelVisual> = {
    front,
    back,
    left,
    right,
    roofL,
    roofR,
  };

  const updatePanelVisual = (
    id: FoldablePanelId,
    fold01: number,
    peekRad: number,
    hovered: boolean,
  ) => {
    const pv = panels[id];
    const baseAngle = Math.max(0, Math.min(1, fold01)) * pv.targetAngle;
    const effective = Math.max(0, Math.min(pv.targetAngle + 0.04, baseAngle + peekRad));
    const signed = effective * pv.sign;
    if (pv.axis === 'x') pv.pivot.rotation.x = signed;
    else pv.pivot.rotation.z = signed;

    pv.foldLine.material = hovered ? mats.foldLineActive : mats.foldLine;
    pv.foldLine.visible = fold01 < 0.96 || hovered;
  };

  return {
    root,
    baseMesh,
    panels,
    updatePanelVisual,
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
        }
      });
    },
  };
}
