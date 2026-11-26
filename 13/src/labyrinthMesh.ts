import * as THREE from 'three';
import {
  BANDS,
  R_BALL,
  R_BALL_PIPE,
  R_CORE_INNER,
  R_FLOOR,
  R_FLOOR_INNER,
  R_IRIS_HOLE,
  R_PIPE_FLOOR,
  R_SHELL,
  R_WALL,
  WALL_HALF_WIDTH,
  sphToDir,
  type Cell,
  type Checkpoint,
  type LevelConfig,
  type PipeEdge,
  type PipeNode,
  type ShutterPort,
  type SphereGrid,
  type TogglePad,
  type VertexPost,
  type WallSlot,
} from './maze';
import {
  createArrowGlyphTexture,
  createDecalLabelTexture,
  createLedHaloTexture,
  createMatteGrainTextures,
  createMetalBallTexture,
  createNeonTubeTexture,
  createPadlockGlyphTexture,
  createPlasticScratchTextures,
  createTapeTexture,
  createTogglePadDecalTexture,
} from './textures';

export interface LedVisual {
  checkpoint: Checkpoint;
  domeMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
  haloMesh: THREE.Mesh;
  localPos: THREE.Vector3;
}

interface WallBladeRig {
  slot: WallSlot;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  arrowMat: THREE.MeshStandardMaterial | null;
  gateColorId: number; // -1 none, 0 red, 1 blue
  lastExt: number;
}

interface ShutterRig {
  port: ShutterPort;
  pivots: THREE.Group[];
  ringLedMat: THREE.MeshStandardMaterial;
  outerNeonMesh: THREE.Mesh;
  outerNeonMat: THREE.MeshStandardMaterial;
  outerHaloMesh: THREE.Mesh;
  outerHaloMat: THREE.MeshBasicMaterial;
  linkedColorId: number; // -1 none, 0 red, 1 blue
  lastOpen: number;
}

interface ToggleVisual {
  pad: TogglePad;
  capMesh: THREE.Mesh;
  capMat: THREE.MeshStandardMaterial;
  pipMat: THREE.MeshStandardMaterial;
  baseY: number;
}

interface GateNeonVisual {
  colorId: 0 | 1;
  wallId: number;
  barMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
  floorBarMat: THREE.MeshStandardMaterial;
}

const POST_RAD_BASE = WALL_HALF_WIDTH * 1.12;
const POST_RAD_UPPER = WALL_HALF_WIDTH * 1.04;
const POST_RAD_TOP = WALL_HALF_WIDTH * 0.8;
const POLE_SEAM_GAP = 0.0034;

export interface LabyrinthRig {
  root: THREE.Group;
  ballMesh: THREE.Mesh;
  plasticShell: THREE.Mesh;
  plasticMat: THREE.MeshPhysicalMaterial;
  scratchOverlayMesh: THREE.Mesh;
  scratchOverlayMat: THREE.MeshStandardMaterial;
  aoExcluded: THREE.Object3D[];
  applyWallExtensions: (wallExt: Float32Array) => void;
  applyShutterOpenings: (shutterOpen: Float32Array) => void;
  applyPoleShutters: (northOpen: number, southOpen: number) => void;
  setReadyHole: (shutterId: number, finishReady: boolean, dwell?: number, toggleId?: number) => void;
  setLevelVisuals: (level: LevelConfig) => void;
  updateLeds: (
    time: number,
    clearedMask: boolean[],
    nextIndex: number,
    allCleared: boolean,
    toggleMask: number,
    togglePulse: Float32Array,
  ) => void;
  setPlasticOpacity: (scale: number) => void;
  setScratchStrength: (scale: number) => void;
  dispose: () => void;
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIdx);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    const count = pos.count;

    positions.set(pos.array as Float32Array, vOffset * 3);
    normals.set(norm.array as Float32Array, vOffset * 3);
    if (uv) {
      uvs.set(uv.array as Float32Array, vOffset * 2);
    }

    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        indices[iOffset + i] = idx[i] + vOffset;
      }
      iOffset += idx.length;
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    }
    vOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Builds a solid curved spherical shell tile for a cell with real thickness (R_FLOOR -> R_FLOOR_INNER).
 */
function buildSolidCellShell(cell: Cell): THREE.BufferGeometry {
  const isNorthPole = cell.band === 0;
  const isSouthPole = cell.band === BANDS.length - 1;
  const segPhi = isNorthPole || isSouthPole ? 8 : 8;
  const segTheta = isNorthPole || isSouthPole ? 36 : 8;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();

  const phi0 = isNorthPole ? 0.072 : cell.phiMin;
  const phi1 = isSouthPole ? Math.PI - 0.072 : cell.phiMax;
  const t0 = cell.thetaMin;
  const t1 = cell.thetaMax;

  // Outer surface (R_FLOOR) + Inner underside surface (R_FLOOR_INNER)
  const stride = segTheta + 1;
  const layerVerts = (segPhi + 1) * stride;

  for (let layer = 0; layer < 2; layer++) {
    const r = layer === 0 ? R_FLOOR : R_FLOOR_INNER;
    for (let ip = 0; ip <= segPhi; ip++) {
      const fp = ip / segPhi;
      const phi = phi0 + (phi1 - phi0) * fp;
      for (let it = 0; it <= segTheta; it++) {
        const ft = it / segTheta;
        const theta = t0 + (t1 - t0) * ft;
        sphToDir(phi, theta, v);
        positions.push(v.x * r, v.y * r, v.z * r);
        uvs.push(ft * 2, fp * 2);
      }
    }
  }

  // Outer faces (outward normal: +phi x +theta? Wait: at phi=PI/2, theta=0: d/dphi=(0,-1,0), d/dtheta=(0,0,1) => d/dtheta x d/dphi = (1,0,0) = +r!)
  for (let ip = 0; ip < segPhi; ip++) {
    for (let it = 0; it < segTheta; it++) {
      const a = ip * stride + it;
      const b = a + 1; // +theta
      const c = (ip + 1) * stride + it; // +phi
      const d = c + 1;
      indices.push(a, b, c, b, d, c);

      // Inner underside faces (inward normal)
      const ia = layerVerts + a;
      const ib = layerVerts + b;
      const ic = layerVerts + c;
      const id = layerVerts + d;
      indices.push(ia, ic, ib, ib, ic, id);
    }
  }

  // Side walls along cell perimeter (gives crisp physical shell thickness where solid panels border windows!)
  if (!isNorthPole && !isSouthPole) {
    // North edge (ip = 0)
    for (let it = 0; it < segTheta; it++) {
      const o0 = it;
      const o1 = it + 1;
      const i0 = layerVerts + o0;
      const i1 = layerVerts + o1;
      indices.push(o0, i0, o1, o1, i0, i1);
    }
    // South edge (ip = segPhi)
    const rowOff = segPhi * stride;
    for (let it = 0; it < segTheta; it++) {
      const o0 = rowOff + it;
      const o1 = rowOff + it + 1;
      const i0 = layerVerts + o0;
      const i1 = layerVerts + o1;
      indices.push(o0, o1, i0, o1, i1, i0);
    }
    // West edge (it = 0)
    for (let ip = 0; ip < segPhi; ip++) {
      const o0 = ip * stride;
      const o1 = (ip + 1) * stride;
      const i0 = layerVerts + o0;
      const i1 = layerVerts + o1;
      indices.push(o0, o1, i0, o1, i1, i0);
    }
    // East edge (it = segTheta)
    for (let ip = 0; ip < segPhi; ip++) {
      const o0 = ip * stride + segTheta;
      const o1 = (ip + 1) * stride + segTheta;
      const i0 = layerVerts + o0;
      const i1 = layerVerts + o1;
      indices.push(o0, i0, o1, o1, i0, i1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a window frame bezel (opaque perimeter margin around the cell) + clear flush polycarbonate window pane.
 */
function buildWindowCellParts(cell: Cell): { frameGeo: THREE.BufferGeometry; paneGeo: THREE.BufferGeometry } {
  const marginPhi = (cell.phiMax - cell.phiMin) * 0.145;
  const marginTheta = (cell.thetaMax - cell.thetaMin) * 0.145;
  const pMin = cell.phiMin;
  const pMax = cell.phiMax;
  const tMin = cell.thetaMin;
  const tMax = cell.thetaMax;
  const pIn0 = pMin + marginPhi;
  const pIn1 = pMax - marginPhi;
  const tIn0 = tMin + marginTheta;
  const tIn1 = tMax - marginTheta;

  const v = new THREE.Vector3();

  // Helper for rectangular solid bezel strip with thickness
  const makeStrip = (aPhi: number, bPhi: number, aTheta: number, bTheta: number, sp: number, st: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const stride = st + 1;
    const lv = (sp + 1) * stride;
    for (let layer = 0; layer < 2; layer++) {
      const r = layer === 0 ? R_FLOOR : R_FLOOR_INNER;
      for (let ip = 0; ip <= sp; ip++) {
        const phi = aPhi + ((bPhi - aPhi) * ip) / sp;
        for (let it = 0; it <= st; it++) {
          const theta = aTheta + ((bTheta - aTheta) * it) / st;
          sphToDir(phi, theta, v);
          pos.push(v.x * r, v.y * r, v.z * r);
          uv.push(it / st, ip / sp);
        }
      }
    }
    for (let ip = 0; ip < sp; ip++) {
      for (let it = 0; it < st; it++) {
        const a = ip * stride + it;
        const b = a + 1;
        const c = (ip + 1) * stride + it;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
        idx.push(lv + a, lv + c, lv + b, lv + b, lv + c, lv + d);
      }
    }
    // Inner & outer edges
    for (let it = 0; it < st; it++) {
      idx.push(it, lv + it, it + 1, it + 1, lv + it, lv + it + 1);
      const r0 = sp * stride;
      idx.push(r0 + it, r0 + it + 1, lv + r0 + it, r0 + it + 1, lv + r0 + it + 1, lv + r0 + it);
    }
    for (let ip = 0; ip < sp; ip++) {
      const a = ip * stride;
      const b = (ip + 1) * stride;
      idx.push(a, b, lv + a, b, lv + b, lv + a);
      const ae = a + st;
      const be = b + st;
      idx.push(ae, lv + ae, be, be, lv + ae, lv + be);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // 4 frame bezel strips around the clear window opening
  const frameGeo = mergeGeometries([
    makeStrip(pMin, pIn0, tMin, tMax, 2, 6),
    makeStrip(pIn1, pMax, tMin, tMax, 2, 6),
    makeStrip(pIn0, pIn1, tMin, tIn0, 5, 2),
    makeStrip(pIn0, pIn1, tIn1, tMax, 5, 2),
  ]);

  // Flush clear polycarbonate window pane sitting cleanly inside the frame
  const seg = 6;
  const pPos: number[] = [];
  const pNorm: number[] = [];
  const pUv: number[] = [];
  const pIdx: number[] = [];
  const rPane = R_FLOOR - 0.0025;
  for (let ip = 0; ip <= seg; ip++) {
    const phi = pIn0 + ((pIn1 - pIn0) * ip) / seg;
    for (let it = 0; it <= seg; it++) {
      const theta = tIn0 + ((tIn1 - tIn0) * it) / seg;
      sphToDir(phi, theta, v);
      pPos.push(v.x * rPane, v.y * rPane, v.z * rPane);
      pNorm.push(v.x, v.y, v.z);
      pUv.push(it / seg, ip / seg);
    }
  }
  const stride = seg + 1;
  for (let ip = 0; ip < seg; ip++) {
    for (let it = 0; it < seg; it++) {
      const a = ip * stride + it;
      const b = a + 1;
      const c = (ip + 1) * stride + it;
      const d = c + 1;
      pIdx.push(a, b, c, b, d, c);
    }
  }
  const paneGeo = new THREE.BufferGeometry();
  paneGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  paneGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pNorm, 3));
  paneGeo.setAttribute('uv', new THREE.Float32BufferAttribute(pUv, 2));
  paneGeo.setIndex(pIdx);

  return { frameGeo, paneGeo };
}

/**
 * Builds a curved spherical cell panel with a mathematically smooth CIRCULAR HOLE cut through it
 * (outer surface R_FLOOR, inner underside R_FLOOR_INNER, plus cylindrical hole bore wall).
 */
function buildPerforatedShutterCell(cell: Cell): THREE.BufferGeometry {
  const segA = 36;
  const segR = 4;
  const cDir = cell.centerDir;
  const cPhi = cell.centerPhi;
  const cTheta = cell.centerTheta;
  const halfPhi = (cell.phiMax - cell.phiMin) * 0.5;
  const halfTheta = (cell.thetaMax - cell.thetaMin) * 0.5;

  // Orthonormal tangent frame aligned with (+theta, +phi): tx x ty = +cDir
  const tx = new THREE.Vector3(-Math.sin(cTheta), 0, Math.cos(cTheta)).normalize();
  const ty = new THREE.Vector3(
    Math.cos(cPhi) * Math.cos(cTheta),
    -Math.sin(cPhi),
    Math.cos(cPhi) * Math.sin(cTheta),
  ).normalize();

  const cosHole = Math.cos(R_IRIS_HOLE);
  const sinHole = Math.sin(R_IRIS_HOLE);

  const pIn = new THREE.Vector3();
  const pOut = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const ringStride = segA + 1;
  const layerVerts = (segR + 1) * ringStride;

  for (let layer = 0; layer < 2; layer++) {
    const rad = layer === 0 ? R_FLOOR : R_FLOOR_INNER;
    for (let ir = 0; ir <= segR; ir++) {
      const fr = ir / segR;
      for (let ia = 0; ia <= segA; ia++) {
        const ang = (ia / segA) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);

        // Inner circular hole edge
        pIn
          .copy(cDir)
          .multiplyScalar(cosHole)
          .addScaledVector(tx, ca * sinHole)
          .addScaledVector(ty, sa * sinHole)
          .normalize();

        // Outer square cell boundary mapped onto sphere
        const s = 1 / Math.max(Math.abs(ca), Math.abs(sa));
        const uSq = ca * s;
        const vSq = sa * s;
        sphToDir(cPhi + vSq * halfPhi, cTheta + uSq * halfTheta, pOut);

        dir.copy(pIn).lerp(pOut, fr).normalize();
        positions.push(dir.x * rad, dir.y * rad, dir.z * rad);
        uvs.push(fr * ca * 0.5 + 0.5, fr * sa * 0.5 + 0.5);
      }
    }
  }

  for (let ir = 0; ir < segR; ir++) {
    for (let ia = 0; ia < segA; ia++) {
      const a = ir * ringStride + ia;
      const b = a + 1; // +angle (CCW viewed from outside)
      const c = (ir + 1) * ringStride + ia; // +radial outward
      const d = c + 1;
      // (+r) x (+angle) = +cDir outward!
      indices.push(a, c, b, c, d, b);

      // Inner underside (facing inward)
      const ia0 = layerVerts + a;
      const ib0 = layerVerts + b;
      const ic0 = layerVerts + c;
      const id0 = layerVerts + d;
      indices.push(ia0, ib0, ic0, ic0, ib0, id0);
    }
  }

  // Circular hole bore wall connecting outer ring (ir=0) to inner underside ring (ir=0) — faces inward toward hole center
  for (let ia = 0; ia < segA; ia++) {
    const o0 = ia;
    const o1 = ia + 1;
    const i0 = layerVerts + ia;
    const i1 = layerVerts + ia + 1;
    indices.push(o0, o1, i0, o1, i1, i0);
  }

  // Outer perimeter side walls connecting solid thickness cleanly to adjacent transparent window panels
  const outerRow = segR * ringStride;
  for (let ia = 0; ia < segA; ia++) {
    const o0 = outerRow + ia;
    const o1 = outerRow + ia + 1;
    const i0 = layerVerts + o0;
    const i1 = layerVerts + o1;
    indices.push(o0, i0, o1, o1, i0, i1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds ONE curved overlapping mechanical diaphragm iris blade (in local XZ plane, pivoted at origin).
 * Six copies placed around R_PIVOT form a crisp camera-lens rosette when closed and retract cleanly
 * into the circular bezel collar when rotated open!
 */
function buildIrisBladeGeometry(holeWorldRadius: number): THREE.BufferGeometry {
  const pivotR = holeWorldRadius * 1.04;
  // Crescent petal spanning cleanly from the pivot rim across the aperture center (0,0)
  const shape = new THREE.Shape();
  // Local coordinates: pivot is at (0, 0), hole center is at (-pivotR, 0) when closed!
  shape.moveTo(-pivotR * 0.03, -pivotR * 0.16);
  // Outer rim curve hugging the circular bezel pocket
  shape.quadraticCurveTo(pivotR * 0.08, pivotR * 0.5, -pivotR * 0.42, pivotR * 0.94);
  // Tip sweeping neatly past the hole center for a tight zero-pinhole seal when closed
  shape.quadraticCurveTo(-pivotR * 0.9, pivotR * 0.8, -pivotR * 1.14, pivotR * 0.02);
  // Crisp curved inner iris cutting edge (creates iconic 6-blade spiral rosette!)
  shape.quadraticCurveTo(-pivotR * 0.64, -pivotR * 0.14, -pivotR * 0.03, -pivotR * 0.16);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0042,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0008,
    bevelSegments: 2,
    curveSegments: 14,
  });
  // Rotate so the blade lies flat in the local XZ plane (normal along +Y radial outward)
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Builds the sculpted U-shaped half-pipe trough geometry for a single spherical great-circle pipe edge,
 * complete with subtle external structural clamping ribs and inner core support struts!
 */
function buildHalfPipeEdgeGeometry(
  edge: PipeEdge,
  nodes: PipeNode[],
): { troughGeo: THREE.BufferGeometry; ribGeo: THREE.BufferGeometry } {
  const dA = nodes[edge.nodeA].dir;
  const dB = nodes[edge.nodeB].dir;
  const steps = Math.max(12, Math.ceil(edge.arcLen * 28));

  const rIn = 0.068; // cradles 0.056 steel ball cleanly with crisp visual clearance
  const rOut = 0.084; // sculpted physical wall thickness
  const arcSegs = 14;
  // Open U-profile: bottom at -radial, walls sweeping ±105° up toward the transparent window ceiling!
  const maxTheta = (105 * Math.PI) / 180;

  // Build closed 2D cross-section loop: inner arc (-maxTheta..+maxTheta) -> outer arc (+maxTheta..-maxTheta)
  const crossPts: [number, number][] = []; // [sideOffset, radialOffsetFromPipeCenter]
  for (let i = 0; i <= arcSegs; i++) {
    const a = -maxTheta + (2 * maxTheta * i) / arcSegs;
    crossPts.push([Math.sin(a) * rIn, -Math.cos(a) * rIn]);
  }
  for (let i = arcSegs; i >= 0; i--) {
    const a = -maxTheta + (2 * maxTheta * i) / arcSegs;
    crossPts.push([Math.sin(a) * rOut, -Math.cos(a) * rOut]);
  }
  const profN = crossPts.length;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const nextDir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const pt = new THREE.Vector3();

  // Compute exact great-circle plane normal so side vector stays rock steady along the whole arc
  const planeNormal = new THREE.Vector3().crossVectors(dA, dB).normalize();
  const omega = Math.acos(Math.max(-1, Math.min(1, dA.dot(dB))));
  const sinOmega = Math.sin(omega);

  const slerpDir = (t: number, out: THREE.Vector3) => {
    if (sinOmega < 1e-5) return out.copy(dA);
    const wA = Math.sin((1 - t) * omega) / sinOmega;
    const wB = Math.sin(t * omega) / sinOmega;
    return out.set(dA.x * wA + dB.x * wB, dA.y * wA + dB.y * wB, dA.z * wA + dB.z * wB).normalize();
  };

  // Trim pipe ends cleanly to the outer rim of each spherical junction bowl so pipes never slice across hub centers!
  const hubTrimFrac = Math.min(0.24, 0.072 / Math.max(0.15, edge.arcLen));

  for (let s = 0; s <= steps; s++) {
    const rawT = s / steps;
    const t = hubTrimFrac + rawT * (1 - hubTrimFrac * 2);
    slerpDir(t, dir);
    slerpDir(Math.min(1, t + 0.01), nextDir);
    tangent.subVectors(nextDir, dir).normalize();
    side.copy(planeNormal); // perpendicular to great circle plane!

    for (let p = 0; p < profN; p++) {
      const [sOff, rOff] = crossPts[p];
      pt.copy(dir)
        .multiplyScalar(R_BALL_PIPE + rOff)
        .addScaledVector(side, sOff);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(rawT * edge.arcLen * 3, p / profN);
    }
  }

  for (let s = 0; s < steps; s++) {
    for (let p = 0; p < profN; p++) {
      const pNext = (p + 1) % profN;
      const a = s * profN + p;
      const b = (s + 1) * profN + p;
      const c = (s + 1) * profN + pNext;
      const d = s * profN + pNext;
      // Outward normals on outer shell + upward-facing normals inside the U-shaped half-pipe trough!
      indices.push(a, b, d, b, c, d);
    }
  }

  const troughGeo = new THREE.BufferGeometry();
  troughGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  troughGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  troughGeo.setIndex(indices);
  troughGeo.computeVertexNormals();

  // Subtle machined external structural ribs along the underside of the half-pipe (visible through clear windows!)
  const ribGeos: THREE.BufferGeometry[] = [];
  const ribCount = Math.max(2, Math.floor(edge.arcLen * 3.8));
  const ribArc = new THREE.TorusGeometry(rOut + 0.005, 0.0075, 8, 18, maxTheta * 2);
  // Orient torus arc around bottom (-Y)
  ribArc.rotateZ(-Math.PI / 2 - maxTheta);
  for (let r = 1; r <= ribCount; r++) {
    const t = r / (ribCount + 1);
    slerpDir(t, dir);
    const t2 = Math.min(1, t + 0.01);
    slerpDir(t2, nextDir);
    tangent.subVectors(nextDir, dir).normalize();
    const basis = new THREE.Matrix4().makeBasis(planeNormal, dir, tangent);
    const g = ribArc.clone();
    g.applyMatrix4(basis);
    g.translate(dir.x * R_BALL_PIPE, dir.y * R_BALL_PIPE, dir.z * R_BALL_PIPE);
    ribGeos.push(g);
  }
  ribArc.dispose();

  return { troughGeo, ribGeo: mergeGeometries(ribGeos) };
}

/**
 * Builds a smooth hemispherical junction bowl + core support stanchion at each pipe node,
 * and for shutter nodes adds the crisp vertical entry throat sleeve up to the iris bezel!
 */
function buildPipeNodeGeometry(node: PipeNode): { bowlGeo: THREE.BufferGeometry; metalGeo: THREE.BufferGeometry } {
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, node.dir);

  const bowlParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];

  // Hemispherical U-bowl cradle around node center at R_BALL_PIPE
  const rIn = 0.07;
  const rOut = 0.086;
  const bowlPts: THREE.Vector2[] = [];
  const segs = 10;
  const maxAng = (102 * Math.PI) / 180;
  for (let i = 0; i <= segs; i++) {
    const a = (maxAng * i) / segs;
    bowlPts.push(new THREE.Vector2(Math.max(0.0001, Math.sin(a) * rIn), R_BALL_PIPE - Math.cos(a) * rIn));
  }
  for (let i = segs; i >= 0; i--) {
    const a = (maxAng * i) / segs;
    bowlPts.push(new THREE.Vector2(Math.max(0.0001, Math.sin(a) * rOut), R_BALL_PIPE - Math.cos(a) * rOut));
  }
  // Reverse lathe points so inner cup normals face UP/INWARD toward the window and outer shell faces OUTWARD!
  bowlPts.reverse();
  const bowl = new THREE.LatheGeometry(bowlPts, 24);
  bowl.applyQuaternion(q);
  bowl.computeVertexNormals();
  bowlParts.push(bowl);

  // Structural stanchion column anchoring the pipe bowl down to the inner core hub (R_CORE_INNER)
  const stanchionH = R_PIPE_FLOOR - R_CORE_INNER + 0.02;
  const stanchion = new THREE.CylinderGeometry(0.036, 0.048, stanchionH, 16);
  stanchion.translate(0, R_CORE_INNER + stanchionH * 0.5 - 0.01, 0);
  stanchion.applyQuaternion(q);
  metalParts.push(stanchion);

  // For shutter ports, add a crisp machined guide ring right beneath the circular iris bore
  if (node.shutterId >= 0) {
    const holeWorldR = R_IRIS_HOLE * R_FLOOR;
    const throatR = holeWorldR * 0.99;
    const throatH = 0.048;
    const throat = new THREE.CylinderGeometry(throatR, throatR * 0.94, throatH, 28, 1, true);
    throat.translate(0, R_FLOOR_INNER - throatH * 0.45, 0);
    // Flip normals inward so looking down through the iris hole reveals a crisp metallic collar throat!
    const idx = throat.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const tmp = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, tmp);
    }
    throat.computeVertexNormals();
    throat.applyQuaternion(q);
    metalParts.push(throat);
  }

  return {
    bowlGeo: mergeGeometries(bowlParts),
    metalGeo: mergeGeometries(metalParts),
  };
}

/**
 * Builds an individual retractable wall blade concavely sculpted around the steady corner poles.
 */
function buildWallBladeGeometry(wall: WallSlot): THREE.BufferGeometry {
  const rBase = R_FLOOR - 0.016; // stays tucked cleanly inside floor bezel thickness!
  const rBevelStart = R_WALL - 0.02;
  const rTop = R_WALL;

  const hwBase = WALL_HALF_WIDTH * 1.02;
  const hwUpper = WALL_HALF_WIDTH * 0.94;
  const hwTop = WALL_HALF_WIDTH * 0.68;

  const profile: [number, number, number][] = [
    [-hwBase, rBase, POST_RAD_BASE],
    [-hwUpper, rBevelStart, POST_RAD_UPPER],
    [-hwTop, rTop, POST_RAD_TOP],
    [hwTop, rTop, POST_RAD_TOP],
    [hwUpper, rBevelStart, POST_RAD_UPPER],
    [hwBase, rBase, POST_RAD_BASE],
  ];

  const arcLen =
    wall.kind === 'lat'
      ? Math.abs(wall.thetaEnd - wall.thetaStart) * Math.sin(wall.phiStart)
      : Math.abs(wall.phiEnd - wall.phiStart);
  const innerSteps = Math.max(6, Math.ceil(arcLen * 24));

  const chamferFrac = Math.min(0.075, 0.011 / Math.max(0.12, arcLen - 2 * (POST_RAD_BASE + POLE_SEAM_GAP)));
  const ringU: { u: number; topDrop: number }[] = [{ u: 0, topDrop: 0.0065 }];
  for (let i = 0; i <= innerSteps; i++) {
    const u = chamferFrac + (i / innerSteps) * (1 - chamferFrac * 2);
    ringU.push({ u, topDrop: 0 });
  }
  ringU.push({ u: 1, topDrop: 0.0065 });

  const profCount = profile.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const pt = new THREE.Vector3();

  const totalPhiSpan = wall.phiEnd - wall.phiStart;
  const totalThetaSpan = wall.thetaEnd - wall.thetaStart;

  for (let s = 0; s < ringU.length; s++) {
    const { u, topDrop } = ringU[s];

    for (let p = 0; p < profCount; p++) {
      const [offset, baseRadius, poleRad] = profile[p];
      const isCrown = p === 2 || p === 3;
      const radius = isCrown ? baseRadius - topDrop : baseRadius;

      const hugRad = poleRad + POLE_SEAM_GAP;
      const trimArc = Math.sqrt(Math.max(0.00001, hugRad * hugRad - offset * offset));
      const trimFrac = Math.min(0.32, trimArc / Math.max(0.05, arcLen));

      const t = trimFrac + u * (1 - trimFrac * 2);
      const phi = wall.kind === 'lat' ? wall.phiStart : wall.phiStart + totalPhiSpan * t;
      const theta = wall.kind === 'lon' ? wall.thetaStart : wall.thetaStart + totalThetaSpan * t;

      sphToDir(phi, theta, dir);
      if (wall.kind === 'lat') {
        tangent.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
      } else {
        tangent.set(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
      }
      binormal.crossVectors(dir, tangent).normalize();

      pt.copy(dir).multiplyScalar(radius).addScaledVector(binormal, offset * radius);
      pt.normalize().multiplyScalar(radius);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(u * arcLen * 2.2, p / (profCount - 1));
    }
  }

  for (let s = 0; s < ringU.length - 1; s++) {
    for (let p = 0; p < profCount - 1; p++) {
      const a = s * profCount + p;
      const b = (s + 1) * profCount + p;
      const c = (s + 1) * profCount + (p + 1);
      const d = s * profCount + (p + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const addEndCap = (ringStart: number, flip: boolean) => {
    const i0 = ringStart + 0;
    const i1 = ringStart + 1;
    const i2 = ringStart + 2;
    const i3 = ringStart + 3;
    const i4 = ringStart + 4;
    const i5 = ringStart + 5;
    if (!flip) {
      indices.push(i0, i1, i5, i1, i4, i5, i1, i2, i4, i2, i3, i4);
    } else {
      indices.push(i0, i5, i1, i1, i5, i4, i1, i4, i2, i2, i4, i3);
    }
  };
  addEndCap(0, false);
  addEndCap((ringU.length - 1) * profCount, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Steady permanent cylindrical corner pole with a crisp chamfered flat crown.
 */
function buildPostGeometry(post: VertexPost): THREE.BufferGeometry {
  const rBase = R_FLOOR_INNER; // cleanly seats through the shell thickness without sticking into the pipe cavity
  const rBevelStart = R_WALL - 0.02;
  const rTop = R_WALL;

  const hwBase = POST_RAD_BASE * rBase;
  const hwUpper = POST_RAD_UPPER * rBevelStart;
  const hwTop = POST_RAD_TOP * rTop;

  const lathePts = [
    new THREE.Vector2(hwBase, rBase),
    new THREE.Vector2(hwUpper, rBevelStart),
    new THREE.Vector2(hwTop, rTop),
    new THREE.Vector2(0.0001, rTop),
  ];
  const geo = new THREE.LatheGeometry(lathePts, 20);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), post.dir);
  geo.applyQuaternion(q);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Hairline recessed panel seam grid on the sphere floor (terminates cleanly at steady pole collars).
 */
function buildSeamGridGeometry(grid: SphereGrid): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const rSeam = R_FLOOR + 0.0011;
  const railHalf = 0.0016;
  const slotEdge = WALL_HALF_WIDTH * 1.04;

  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  const railTrimArc = Math.sqrt(Math.max(0.0001, (POST_RAD_BASE + POLE_SEAM_GAP) ** 2 - slotEdge * slotEdge));

  for (const wall of grid.walls) {
    const arcLen =
      wall.kind === 'lat'
        ? Math.abs(wall.thetaEnd - wall.thetaStart) * Math.sin(wall.phiStart)
        : Math.abs(wall.phiEnd - wall.phiStart);
    const steps = Math.max(5, Math.ceil(arcLen * 22));
    const trimFrac = Math.min(0.32, railTrimArc / Math.max(0.05, arcLen));

    for (const side of [-1, 1]) {
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const t = trimFrac + u * (1 - trimFrac * 2);
        const phi = wall.kind === 'lat' ? wall.phiStart : wall.phiStart + (wall.phiEnd - wall.phiStart) * t;
        const theta = wall.kind === 'lon' ? wall.thetaStart : wall.thetaStart + (wall.thetaEnd - wall.thetaStart) * t;
        sphToDir(phi, theta, dir);
        if (wall.kind === 'lat') {
          tangent.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
        } else {
          tangent.set(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
        }
        binormal.crossVectors(dir, tangent).normalize();

        const centerOff = side * slotEdge;
        pA.copy(dir).addScaledVector(binormal, centerOff - railHalf).normalize();
        pB.copy(dir).addScaledVector(binormal, centerOff + railHalf).normalize();

        positions.push(pA.x * rSeam, pA.y * rSeam, pA.z * rSeam);
        normals.push(pA.x, pA.y, pA.z);
        uvs.push(u, 0);

        positions.push(pB.x * rSeam, pB.y * rSeam, pB.z * rSeam);
        normals.push(pB.x, pB.y, pB.z);
        uvs.push(u, 1);
      }

      for (let s = 0; s < steps; s++) {
        const a = s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geos.push(geo);
    }
  }

  const ringSegs = 22;
  const rInner = POST_RAD_BASE;
  const rOuter = POST_RAD_BASE + POLE_SEAM_GAP + railHalf * 1.4;
  const up = new THREE.Vector3(0, 1, 0);
  for (const post of grid.posts) {
    const ring = new THREE.RingGeometry(rInner * rSeam, rOuter * rSeam, ringSegs);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, rSeam, 0);
    const pos = ring.attributes.position;
    const norm = ring.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      pos.setXYZ(i, v.x * rSeam, v.y * rSeam, v.z * rSeam);
      norm.setXYZ(i, v.x, v.y, v.z);
    }
    const q = new THREE.Quaternion().setFromUnitVectors(up, post.dir);
    ring.applyQuaternion(q);
    geos.push(ring);
  }

  return mergeGeometries(geos);
}

/**
 * Builds a sleek 3D curved diffused neon LED bar seated along the spine of a gate wall (or flush in its floor seam).
 * Domed cross-section catches visibility from both straight-on AND grazing side angles around the sphere.
 */
function buildNeonBarGeometry(
  wall: WallSlot,
  baseRadius: number,
  halfWidth: number,
  domeHeight: number,
  endPadding = 0.018,
): THREE.BufferGeometry {
  const arcLen =
    wall.kind === 'lat'
      ? Math.abs(wall.thetaEnd - wall.thetaStart) * Math.sin(wall.phiStart)
      : Math.abs(wall.phiEnd - wall.phiStart);
  const trimArc = POST_RAD_TOP + POLE_SEAM_GAP + endPadding;
  const trimFrac = Math.min(0.36, trimArc / Math.max(0.05, arcLen));
  const steps = Math.max(8, Math.ceil(arcLen * 28));

  // 5-point domed light-pipe diffuser profile (left base -> left shoulder -> apex -> right shoulder -> right base)
  const profile: [number, number][] = [
    [-halfWidth, baseRadius - 0.002],
    [-halfWidth * 0.78, baseRadius + domeHeight * 0.72],
    [0, baseRadius + domeHeight],
    [halfWidth * 0.78, baseRadius + domeHeight * 0.72],
    [halfWidth, baseRadius - 0.002],
  ];
  const profN = profile.length;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const totalPhiSpan = wall.phiEnd - wall.phiStart;
  const totalThetaSpan = wall.thetaEnd - wall.thetaStart;

  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const t = trimFrac + u * (1 - trimFrac * 2);
    const phi = wall.kind === 'lat' ? wall.phiStart : wall.phiStart + totalPhiSpan * t;
    const theta = wall.kind === 'lon' ? wall.thetaStart : wall.thetaStart + totalThetaSpan * t;
    sphToDir(phi, theta, dir);
    if (wall.kind === 'lat') {
      tangent.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
    } else {
      tangent.set(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
    }
    binormal.crossVectors(dir, tangent).normalize();

    // Gently taper height to 0 at both ends for sleek molded LED end-caps
    const endTaper = s === 0 || s === steps ? 0.15 : 1.0;

    for (let p = 0; p < profN; p++) {
      const [offset, rawRad] = profile[p];
      const rad = baseRadius + (rawRad - baseRadius) * endTaper;
      pt.copy(dir).multiplyScalar(rad).addScaledVector(binormal, offset * rad);
      pt.normalize().multiplyScalar(rad);
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(u, p / (profN - 1));
    }
  }

  for (let s = 0; s < steps; s++) {
    for (let p = 0; p < profN - 1; p++) {
      const a = s * profN + p;
      const b = (s + 1) * profN + p;
      const c = (s + 1) * profN + (p + 1);
      const d = s * profN + (p + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  // Cap both ends cleanly
  const cap = (start: number, flip: boolean) => {
    if (!flip) {
      indices.push(start, start + 1, start + 4, start + 1, start + 3, start + 4, start + 1, start + 2, start + 3);
    } else {
      indices.push(start, start + 4, start + 1, start + 1, start + 4, start + 3, start + 1, start + 3, start + 2);
    }
  };
  cap(0, false);
  cap(steps * profN, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Soft glowing neon halo strip hugging a curved gate wall neon bar.
 */
function buildNeonHaloStripGeometry(wall: WallSlot, radius: number, halfWidth: number): THREE.BufferGeometry {
  const arcLen =
    wall.kind === 'lat'
      ? Math.abs(wall.thetaEnd - wall.thetaStart) * Math.sin(wall.phiStart)
      : Math.abs(wall.phiEnd - wall.phiStart);
  const trimArc = POST_RAD_TOP + POLE_SEAM_GAP + 0.008;
  const trimFrac = Math.min(0.35, trimArc / Math.max(0.05, arcLen));
  const steps = Math.max(8, Math.ceil(arcLen * 24));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const totalPhiSpan = wall.phiEnd - wall.phiStart;
  const totalThetaSpan = wall.thetaEnd - wall.thetaStart;

  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const t = trimFrac + u * (1 - trimFrac * 2);
    const phi = wall.kind === 'lat' ? wall.phiStart : wall.phiStart + totalPhiSpan * t;
    const theta = wall.kind === 'lon' ? wall.thetaStart : wall.thetaStart + totalThetaSpan * t;
    sphToDir(phi, theta, dir);
    if (wall.kind === 'lat') {
      tangent.set(-Math.sin(theta), 0, Math.cos(theta)).normalize();
    } else {
      tangent.set(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
    }
    binormal.crossVectors(dir, tangent).normalize();

    for (let side = 0; side < 2; side++) {
      const off = side === 0 ? -halfWidth : halfWidth;
      pt.copy(dir).addScaledVector(binormal, off).normalize();
      positions.push(pt.x * radius, pt.y * radius, pt.z * radius);
      normals.push(pt.x, pt.y, pt.z);
      uvs.push(u, side);
    }
  }

  for (let s = 0; s < steps; s++) {
    const a = s * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildWallTopGlyphPatch(
  wall: WallSlot,
  radius: number,
  tangentSpan: number,
  widthSpan: number,
): THREE.BufferGeometry {
  const segX = 4;
  const segY = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const phi = 0.5 * (wall.phiStart + wall.phiEnd);
  const theta = 0.5 * (wall.thetaStart + wall.thetaEnd);
  const dir = sphToDir(phi, theta);
  const tangent =
    wall.kind === 'lat'
      ? new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta)).normalize()
      : new THREE.Vector3(Math.cos(phi) * Math.cos(theta), -Math.sin(phi), Math.cos(phi) * Math.sin(theta)).normalize();
  const binormal = new THREE.Vector3().crossVectors(dir, tangent).normalize();
  const v = new THREE.Vector3();

  for (let iy = 0; iy <= segY; iy++) {
    const ty = (iy / segY) * 2 - 1;
    for (let ix = 0; ix <= segX; ix++) {
      const tx = (ix / segX) * 2 - 1;
      v.copy(dir)
        .addScaledVector(tangent, tx * tangentSpan * 0.5)
        .addScaledVector(binormal, ty * widthSpan * 0.5)
        .normalize();
      normals.push(v.x, v.y, v.z);
      positions.push(v.x * radius, v.y * radius, v.z * radius);
      uvs.push(ix / segX, 1 - iy / segY);
    }
  }

  const stride = segX + 1;
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildCurvedTapePatch(
  radius: number,
  centerTheta: number,
  angularWidth: number,
  angularHeight: number,
  tiltRad: number,
  baseLatRad = 0,
): THREE.BufferGeometry {
  const segX = 40;
  const segY = 10;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltRad);
  const qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), centerTheta);
  const v = new THREE.Vector3();

  for (let iy = 0; iy <= segY; iy++) {
    const vCoord = iy / segY;
    const lat = baseLatRad + (vCoord - 0.5) * angularHeight;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let ix = 0; ix <= segX; ix++) {
      const uCoord = ix / segX;
      // Scale longitude inversely by cos(baseLatRad) so polar tapes preserve exact true aspect ratio!
      const lon = ((uCoord - 0.5) * angularWidth) / Math.max(0.35, Math.cos(baseLatRad));
      v.set(cosLat * Math.sin(lon), sinLat, cosLat * Math.cos(lon));
      v.applyQuaternion(qTilt);
      v.applyQuaternion(qSpin);
      normals.push(v.x, v.y, v.z);
      positions.push(v.x * radius, v.y * radius, v.z * radius);
      uvs.push(uCoord, vCoord);
    }
  }

  const stride = segX + 1;
  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildFloorDecalPatch(dir: THREE.Vector3, radius: number, angularRadius: number): THREE.BufferGeometry {
  const seg = 8;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangentX = new THREE.Vector3().crossVectors(up, dir).normalize();
  const tangentY = new THREE.Vector3().crossVectors(dir, tangentX).normalize();
  const v = new THREE.Vector3();

  for (let iy = 0; iy <= seg; iy++) {
    const ty = (iy / seg) * 2 - 1;
    for (let ix = 0; ix <= seg; ix++) {
      const tx = (ix / seg) * 2 - 1;
      v.copy(dir)
        .addScaledVector(tangentX, tx * angularRadius)
        .addScaledVector(tangentY, ty * angularRadius)
        .normalize();
      normals.push(v.x, v.y, v.z);
      positions.push(v.x * radius, v.y * radius, v.z * radius);
      uvs.push(ix / seg, iy / seg);
    }
  }

  const stride = seg + 1;
  for (let iy = 0; iy < seg; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + ix;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function createMicroScrew(
  steelMat: THREE.MeshStandardMaterial,
  darkSlotMat: THREE.MeshStandardMaterial,
  scale = 1,
): THREE.Group {
  const g = new THREE.Group();
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scale, 0.028 * scale, 0.008 * scale, 18), darkSlotMat);
  collar.position.y = -0.002 * scale;
  g.add(collar);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * scale, 0.021 * scale, 0.01 * scale, 18), steelMat);
  head.position.y = 0.001 * scale;
  g.add(head);

  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.032 * scale, 0.005 * scale, 0.0055 * scale), darkSlotMat);
  slot.position.y = 0.005 * scale;
  g.add(slot);

  return g;
}

export function buildLabyrinthRig(grid: SphereGrid): LabyrinthRig {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const baseAoExcluded: THREE.Object3D[] = [];
  const dynamicAoExcluded: THREE.Object3D[] = [];
  const aoExcluded: THREE.Object3D[] = [];

  const syncAoExcluded = () => {
    aoExcluded.length = 0;
    aoExcluded.push(...baseAoExcluded, ...dynamicAoExcluded);
  };

  const { roughnessMap: matteRough, bumpMap: matteBump } = createMatteGrainTextures();
  disposables.push(matteRough, matteBump);

  const COLOR_FLOOR = new THREE.Color(0xd7cebe);
  const COLOR_WALL_RAISED = new THREE.Color(0xf3efe7);
  const upAxis = new THREE.Vector3(0, 1, 0);

  const floorMat = new THREE.MeshStandardMaterial({
    color: COLOR_FLOOR,
    roughness: 0.78,
    roughnessMap: matteRough,
    bumpMap: matteBump,
    bumpScale: 0.002,
    metalness: 0.0,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xd6d8dc,
    metalness: 0.92,
    roughness: 0.24,
  });
  const darkSlotMat = new THREE.MeshStandardMaterial({
    color: 0x3b3935,
    metalness: 0.45,
    roughness: 0.65,
  });
  const seamMat = new THREE.MeshStandardMaterial({
    color: 0x867d70,
    roughness: 0.9,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const holeChamferMat = new THREE.MeshStandardMaterial({
    color: 0xded6c8, // slightly brighter satin alabaster bevel lip catching studio light around every hole
    roughness: 0.56,
    roughnessMap: matteRough,
    metalness: 0.02,
  });
  disposables.push(floorMat, steelMat, darkSlotMat, seamMat, holeChamferMat);

  const buildHoleChamferGeo = (rHole: number) => {
    const pts = [
      new THREE.Vector2(rHole * 0.97, -0.009),
      new THREE.Vector2(rHole * 1.015, -0.003),
      new THREE.Vector2(rHole * 1.09, 0.0028),
      new THREE.Vector2(rHole * 1.18, 0.0004),
    ];
    const g = new THREE.LatheGeometry(pts, 44);
    g.computeVertexNormals();
    return g;
  };
  const buildHoleSeamGeo = (rHole: number) => {
    const g = new THREE.RingGeometry(rHole * 1.175, rHole * 1.205, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  };

  // =========================================================================
  // 1. UNDERNEATH INTERIOR CAVITY + SCULPTED HALF-PIPE TUBE SYSTEM
  // =========================================================================
  const innerCoreGeo = new THREE.SphereGeometry(R_CORE_INNER, 48, 36);
  const innerCoreMat = new THREE.MeshStandardMaterial({
    color: 0xa49b8d, // deeper warm stone-taupe inner chamber so ivory half-pipe troughs pop through clear windows
    roughness: 0.88,
    roughnessMap: matteRough,
    metalness: 0.0,
  });
  const innerCoreMesh = new THREE.Mesh(innerCoreGeo, innerCoreMat);
  innerCoreMesh.receiveShadow = true;
  root.add(innerCoreMesh);
  disposables.push(innerCoreGeo, innerCoreMat);

  // Sculpted matte warm-ivory half-pipe U-troughs + junction bowls
  const pipeTroughGeos: THREE.BufferGeometry[] = [];
  const pipeMetalGeos: THREE.BufferGeometry[] = [];
  for (const edge of grid.pipeEdges) {
    const { troughGeo, ribGeo } = buildHalfPipeEdgeGeometry(edge, grid.pipeNodes);
    pipeTroughGeos.push(troughGeo);
    pipeMetalGeos.push(ribGeo);
  }
  for (const node of grid.pipeNodes) {
    const { bowlGeo, metalGeo } = buildPipeNodeGeometry(node);
    pipeTroughGeos.push(bowlGeo);
    pipeMetalGeos.push(metalGeo);
  }

  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0xebe4d7, // clean matte warm ivory half-pipe troughs contrasting crisply over the deeper core
    roughness: 0.54,
    roughnessMap: matteRough,
    bumpMap: matteBump,
    bumpScale: 0.0014,
    metalness: 0.0,
  });
  const pipeHardwareMat = new THREE.MeshStandardMaterial({
    color: 0xa9a296, // anodized warm titanium clamping ribs & stanchions
    roughness: 0.42,
    metalness: 0.55,
  });

  const mergedPipeGeo = mergeGeometries(pipeTroughGeos);
  const pipeMesh = new THREE.Mesh(mergedPipeGeo, pipeMat);
  pipeMesh.castShadow = true;
  pipeMesh.receiveShadow = true;
  root.add(pipeMesh);

  const mergedPipeMetalGeo = mergeGeometries(pipeMetalGeos);
  const pipeMetalMesh = new THREE.Mesh(mergedPipeMetalGeo, pipeHardwareMat);
  pipeMetalMesh.castShadow = true;
  pipeMetalMesh.receiveShadow = true;
  root.add(pipeMetalMesh);
  disposables.push(mergedPipeGeo, mergedPipeMetalGeo, pipeMat, pipeHardwareMat);

  // =========================================================================
  // 2. MODULAR PER-CELL UPPER FLOOR SHELL (SOLID + TRANSPARENT WINDOWS + SHUTTER HOLES)
  // =========================================================================
  const solidFloorGeos: THREE.BufferGeometry[] = [];
  const windowPaneGeos: THREE.BufferGeometry[] = [];

  for (const cell of grid.cells) {
    if (cell.panelKind === 'solid') {
      solidFloorGeos.push(buildSolidCellShell(cell));
    } else if (cell.panelKind === 'window') {
      const { frameGeo, paneGeo } = buildWindowCellParts(cell);
      solidFloorGeos.push(frameGeo);
      windowPaneGeos.push(paneGeo);
    } else if (cell.panelKind === 'shutter') {
      solidFloorGeos.push(buildPerforatedShutterCell(cell));
    }
  }

  const mergedFloorGeo = mergeGeometries(solidFloorGeos);
  const floorMesh = new THREE.Mesh(mergedFloorGeo, floorMat);
  floorMesh.castShadow = true;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(mergedFloorGeo);

  // Flush crystal-clear polycarbonate inspection windows (excluded from GTAO so lower half-pipes get full SSAO!)
  const mergedWindowGeo = mergeGeometries(windowPaneGeos);
  const windowPaneMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7f5ef,
    roughness: 0.08,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    reflectivity: 0.75,
    ior: 1.49,
    envMapIntensity: 1.45,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const windowPaneMesh = new THREE.Mesh(mergedWindowGeo, windowPaneMat);
  windowPaneMesh.renderOrder = 4;
  root.add(windowPaneMesh);
  baseAoExcluded.push(windowPaneMesh);
  disposables.push(mergedWindowGeo, windowPaneMat);

  // =========================================================================
  // 3. SIX 6-BLADE MECHANICAL DIAPHRAGM IRIS SHUTTERS
  // =========================================================================
  const holeWorldR = R_IRIS_HOLE * R_FLOOR;
  const irisBladeGeo = buildIrisBladeGeometry(holeWorldR);
  const irisBladeEdgesGeo = new THREE.EdgesGeometry(irisBladeGeo, 32);
  const irisBladeMat = new THREE.MeshStandardMaterial({
    color: 0xe2dbd0, // satin warm alabaster-titanium diaphragm leaves
    roughness: 0.44,
    metalness: 0.14,
  });
  const irisBladeLineMat = new THREE.LineBasicMaterial({
    color: 0x5c554c,
    transparent: true,
    opacity: 0.78,
  });

  const irisBezelGeo = new THREE.TorusGeometry(holeWorldR * 1.0, 0.0052, 12, 36);
  irisBezelGeo.rotateX(Math.PI / 2);
  const irisChamferGeo = buildHoleChamferGeo(holeWorldR);
  const irisSeamGeo = buildHoleSeamGeo(holeWorldR);
  const irisLedRingGeo = new THREE.TorusGeometry(holeWorldR * 0.905, 0.0036, 10, 36);
  irisLedRingGeo.rotateX(Math.PI / 2);
  // Delicate recessed outer LED light-pipe ring + soft glow halo for toggle-linked shutters (no dark outline!)
  const irisOuterNeonGeo = new THREE.TorusGeometry(holeWorldR * 1.13, 0.0038, 12, 42);
  irisOuterNeonGeo.rotateX(Math.PI / 2);
  const shutterHaloGeo = new THREE.PlaneGeometry(holeWorldR * 3.1, holeWorldR * 3.1);
  shutterHaloGeo.rotateX(-Math.PI / 2);
  // Hollow-center circular ring glow texture so the open shutter aperture stays crystal clear while the outer bezel softly glows!
  const shutterRingCanvas = document.createElement('canvas');
  shutterRingCanvas.width = 128;
  shutterRingCanvas.height = 128;
  const srCtx = shutterRingCanvas.getContext('2d')!;
  const srImg = srCtx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    const dy = (y + 0.5) / 64 - 1;
    for (let x = 0; x < 128; x++) {
      const dx = (x + 0.5) / 64 - 1;
      const r = Math.hypot(dx, dy); // bezel outer LED sits around r ≈ 0.72
      // Completely clear inside the shutter bore (r < 0.58), smooth peak at LED ring (0.72), soft falloff to 1.0
      let alpha = 0;
      if (r >= 0.58 && r < 1.0) {
        const innerFade = Math.min(1, (r - 0.58) / 0.14);
        const outerFade = Math.pow(Math.max(0, 1 - Math.abs(r - 0.72) / 0.28), 1.9);
        alpha = innerFade * outerFade;
      }
      const p = (y * 128 + x) * 4;
      srImg.data[p] = srImg.data[p + 1] = srImg.data[p + 2] = 255;
      srImg.data[p + 3] = Math.round(alpha * 255);
    }
  }
  srCtx.putImageData(srImg, 0, 0);
  const shutterRingHaloTex = new THREE.CanvasTexture(shutterRingCanvas);
  shutterRingHaloTex.colorSpace = THREE.SRGBColorSpace;
  const haloTex = createLedHaloTexture();
  disposables.push(
    irisBladeGeo,
    irisBladeEdgesGeo,
    irisBladeMat,
    irisBladeLineMat,
    irisBezelGeo,
    irisChamferGeo,
    irisSeamGeo,
    irisLedRingGeo,
    irisOuterNeonGeo,
    shutterHaloGeo,
    shutterRingHaloTex,
    haloTex,
  );

  const shutterRigs: ShutterRig[] = [];

  for (const port of grid.shutters) {
    const shutterGroup = new THREE.Group();
    shutterGroup.position.copy(port.dir).multiplyScalar(R_FLOOR - 0.001);
    shutterGroup.quaternion.setFromUnitVectors(upAxis, port.dir);
    root.add(shutterGroup);

    // Sculpted beige chamfer collar + crisp hairline perimeter seam around the diaphragm aperture
    const chamfer = new THREE.Mesh(irisChamferGeo, holeChamferMat);
    chamfer.position.y = 0.001;
    chamfer.receiveShadow = true;
    shutterGroup.add(chamfer);

    const holeSeam = new THREE.Mesh(irisSeamGeo, seamMat);
    holeSeam.position.y = 0.0015;
    shutterGroup.add(holeSeam);

    // Machined brushed-steel inner iris lip seated cleanly inside the chamfer
    const bezel = new THREE.Mesh(irisBezelGeo, steelMat);
    bezel.position.y = 0.0016;
    shutterGroup.add(bezel);

    // Inner portal status LED ring seated cleanly along the inner chamfer of the iris rim
    const ringLedMat = new THREE.MeshStandardMaterial({
      color: 0xd0ffec,
      emissive: new THREE.Color(0x2ee69c),
      emissiveIntensity: 1.4,
      roughness: 0.22,
      metalness: 0.05,
      envMapIntensity: 0.25,
    });
    const ringLed = new THREE.Mesh(irisLedRingGeo, ringLedMat);
    ringLed.position.y = 0.0026;
    shutterGroup.add(ringLed);

    // Sleek glowing outer LED ring + soft floor light bleed (shown only when linked to SW A / SW B)
    const outerNeonMat = new THREE.MeshStandardMaterial({
      color: 0xff5a54,
      emissive: new THREE.Color(0xff0a0a),
      emissiveIntensity: 2.3,
      roughness: 0.16,
      metalness: 0.0,
      envMapIntensity: 0.35,
    });
    const outerNeonMesh = new THREE.Mesh(irisOuterNeonGeo, outerNeonMat);
    outerNeonMesh.position.y = 0.0032;
    outerNeonMesh.visible = false;
    shutterGroup.add(outerNeonMesh);

    const outerHaloMat = new THREE.MeshBasicMaterial({
      map: shutterRingHaloTex,
      color: 0xff1414,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const outerHaloMesh = new THREE.Mesh(shutterHaloGeo, outerHaloMat);
    outerHaloMesh.position.y = 0.0022;
    outerHaloMesh.visible = false;
    shutterGroup.add(outerHaloMesh);
    baseAoExcluded.push(outerHaloMesh);

    disposables.push(ringLedMat, outerNeonMat, outerHaloMat);

    // 6 overlapping mechanical aperture blades mounted on radial pivot pins around the bezel rim!
    const pivots: THREE.Group[] = [];
    const pivotR = holeWorldR * 1.04;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI * 2) / 6;
      const pivot = new THREE.Group();
      // Slight stacked elevation per leaf avoids z-fighting & gives real camera-shutter overlap depth!
      pivot.position.set(Math.cos(a) * pivotR, -0.011 + k * 0.0007, Math.sin(a) * pivotR);
      pivot.rotation.y = -a;

      const bladeHolder = new THREE.Group();
      const bladeMesh = new THREE.Mesh(irisBladeGeo, irisBladeMat);
      bladeMesh.castShadow = true;
      bladeMesh.receiveShadow = true;
      bladeHolder.add(bladeMesh);

      const bladeLines = new THREE.LineSegments(irisBladeEdgesGeo, irisBladeLineMat);
      bladeHolder.add(bladeLines);

      pivot.add(bladeHolder);
      shutterGroup.add(pivot);
      pivots.push(bladeHolder);
    }

    shutterRigs.push({
      port,
      pivots,
      ringLedMat,
      outerNeonMesh,
      outerNeonMat,
      outerHaloMesh,
      outerHaloMat,
      linkedColorId: -1,
      lastOpen: -1,
    });
  }

  // =========================================================================
  // 4. CRISP RECESSED FLOOR SEAM GRID + STEADY POLES + RETRACTABLE WALL BLADES
  // =========================================================================
  const seamGeo = buildSeamGridGeometry(grid);
  const seamMesh = new THREE.Mesh(seamGeo, seamMat);
  seamMesh.receiveShadow = true;
  root.add(seamMesh);
  disposables.push(seamGeo);

  const baseWallMat = new THREE.MeshStandardMaterial({
    color: COLOR_WALL_RAISED,
    roughness: 0.48,
    roughnessMap: matteRough,
    bumpMap: matteBump,
    bumpScale: 0.0014,
    metalness: 0.0,
  });
  disposables.push(baseWallMat);

  const padlockTex = createPadlockGlyphTexture();
  const arrowTex = createArrowGlyphTexture();
  const padlockMat = new THREE.MeshStandardMaterial({
    map: padlockTex,
    transparent: true,
    roughness: 0.75,
    depthWrite: false,
  });
  disposables.push(padlockTex, arrowTex, padlockMat);

  const bladeRigs: WallBladeRig[] = [];
  for (const wall of grid.walls) {
    const geo = buildWallBladeGeometry(wall);
    const mat = wall.locked ? baseWallMat : baseWallMat.clone();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    disposables.push(geo);
    if (!wall.locked) disposables.push(mat);

    let arrowMat: THREE.MeshStandardMaterial | null = null;
    if (wall.locked) {
      const glyphGeo = buildWallTopGlyphPatch(wall, R_WALL + 0.0014, 0.034, 0.034);
      const glyphMesh = new THREE.Mesh(glyphGeo, padlockMat);
      mesh.add(glyphMesh);
      baseAoExcluded.push(glyphMesh);
      disposables.push(glyphGeo);
    } else if (wall.hasArrow) {
      const glyphGeo = buildWallTopGlyphPatch(wall, R_WALL + 0.0014, 0.066, 0.033);
      arrowMat = new THREE.MeshStandardMaterial({
        map: arrowTex,
        transparent: true,
        opacity: 1,
        roughness: 0.75,
        depthWrite: false,
      });
      const glyphMesh = new THREE.Mesh(glyphGeo, arrowMat);
      mesh.add(glyphMesh);
      baseAoExcluded.push(glyphMesh);
      disposables.push(glyphGeo, arrowMat);
    }

    bladeRigs.push({ slot: wall, mesh, mat, arrowMat, gateColorId: -1, lastExt: -1 });
  }

  // Steady permanent corner poles merged into a single clean mesh
  const postGeos = grid.posts.map((post) => buildPostGeometry(post));
  const mergedPostsGeo = mergeGeometries(postGeos);
  const steadyPostsMesh = new THREE.Mesh(mergedPostsGeo, baseWallMat);
  steadyPostsMesh.castShadow = true;
  steadyPostsMesh.receiveShadow = true;
  root.add(steadyPostsMesh);
  disposables.push(mergedPostsGeo);

  // =========================================================================
  // 5. PRECISION MICRO-SCREWS + NORTH START MARKER
  // =========================================================================
  const lockedPosts = grid.posts.filter((p) => p.locked && p.phi > 0.35 && p.phi < Math.PI - 0.35);
  const screwPosts: VertexPost[] = [];
  for (const post of lockedPosts) {
    if (screwPosts.length >= 6) break;
    const tooClose = screwPosts.some((other) => other.dir.dot(post.dir) > 0.48);
    if (!tooClose) screwPosts.push(post);
  }
  for (let i = 0; i < screwPosts.length; i++) {
    const post = screwPosts[i];
    const screw = createMicroScrew(steelMat, darkSlotMat, 0.78);
    screw.position.copy(post.dir).multiplyScalar(R_WALL - 0.002);
    screw.quaternion.setFromUnitVectors(upAxis, post.dir);
    screw.rotateY(i * 1.17 + 0.4);
    root.add(screw);
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const microPin = createMicroScrew(steelMat, darkSlotMat, 0.72);
    microPin.position.copy(dir).multiplyScalar(R_SHELL - 0.003);
    microPin.quaternion.setFromUnitVectors(upAxis, dir);
    microPin.rotateY(i * 0.9 + 0.2);
    root.add(microPin);
  }

  const startDir = grid.cells[0].centerDir;
  const startDecalTex = createDecalLabelTexture('00', 'START');
  const startDecalGeo = buildFloorDecalPatch(startDir, R_FLOOR + 0.0024, 0.17);
  const startDecalMat = new THREE.MeshStandardMaterial({
    map: startDecalTex,
    transparent: true,
    roughness: 0.78,
    depthWrite: false,
  });
  const startDecalMesh = new THREE.Mesh(startDecalGeo, startDecalMat);
  root.add(startDecalMesh);
  baseAoExcluded.push(startDecalMesh);
  disposables.push(startDecalTex, startDecalGeo, startDecalMat);

  // Precision machined polar ball wells + 6-blade diaphragm shutters + chamfered seams at BOTH North & South Poles!
  const poleHoleR = Math.sin(0.072) * R_FLOOR; // ~0.0626 world radius (cradles 0.056 steel ball cleanly)
  const poleRimGeo = new THREE.TorusGeometry(poleHoleR * 1.01, 0.0048, 12, 36);
  poleRimGeo.rotateX(Math.PI / 2);
  const poleChamferGeo = buildHoleChamferGeo(poleHoleR);
  const poleSeamGeo = buildHoleSeamGeo(poleHoleR);
  const poleIrisBladeGeo = buildIrisBladeGeometry(poleHoleR);
  const poleIrisBladeEdgesGeo = new THREE.EdgesGeometry(poleIrisBladeGeo, 32);

  const poleShaftH = 0.155;
  const poleShaftGeo = new THREE.CylinderGeometry(poleHoleR * 0.99, poleHoleR * 0.92, poleShaftH, 28, 1, true);
  // Flip shaft normals inward so looking down into the pole hole shows a clean machined metallic bore
  const psIdx = poleShaftGeo.index!;
  for (let i = 0; i < psIdx.count; i += 3) {
    const tmp = psIdx.getX(i + 1);
    psIdx.setX(i + 1, psIdx.getX(i + 2));
    psIdx.setX(i + 2, tmp);
  }
  poleShaftGeo.computeVertexNormals();

  const poleFloorGeo = new THREE.CircleGeometry(poleHoleR * 0.93, 28);
  poleFloorGeo.rotateX(-Math.PI / 2);
  const poleWellMat = new THREE.MeshStandardMaterial({
    color: 0x3b3834,
    metalness: 0.45,
    roughness: 0.62,
  });

  const endDir = grid.cells[grid.cells.length - 1].centerDir;
  const poleIrisPivots: THREE.Group[][] = [[], []];
  const poleDirs = [startDir, endDir];

  for (let pi = 0; pi < poleDirs.length; pi++) {
    const pDir = poleDirs[pi];
    const qPole = new THREE.Quaternion().setFromUnitVectors(upAxis, pDir);
    const poleGroup = new THREE.Group();
    poleGroup.quaternion.copy(qPole);

    const chamfer = new THREE.Mesh(poleChamferGeo, holeChamferMat);
    chamfer.position.y = R_FLOOR + 0.0005;
    chamfer.receiveShadow = true;
    poleGroup.add(chamfer);

    const pSeam = new THREE.Mesh(poleSeamGeo, seamMat);
    pSeam.position.y = R_FLOOR + 0.0014;
    poleGroup.add(pSeam);

    const rim = new THREE.Mesh(poleRimGeo, steelMat);
    rim.position.y = R_FLOOR + 0.0014;
    poleGroup.add(rim);

    const shaft = new THREE.Mesh(poleShaftGeo, steelMat);
    shaft.position.y = R_FLOOR - poleShaftH * 0.5;
    poleGroup.add(shaft);

    const wellFloor = new THREE.Mesh(poleFloorGeo, poleWellMat);
    wellFloor.position.y = R_FLOOR - poleShaftH + 0.002;
    poleGroup.add(wellFloor);

    // 6-blade mechanical camera-diaphragm iris inside each polar socket!
    const pPivotR = poleHoleR * 1.04;
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI * 2) / 6;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * pPivotR, R_FLOOR - 0.01 + k * 0.0006, Math.sin(a) * pPivotR);
      pivot.rotation.y = -a;

      const bladeHolder = new THREE.Group();
      const bladeMesh = new THREE.Mesh(poleIrisBladeGeo, irisBladeMat);
      bladeMesh.castShadow = true;
      bladeMesh.receiveShadow = true;
      bladeHolder.add(bladeMesh);

      const bladeLines = new THREE.LineSegments(poleIrisBladeEdgesGeo, irisBladeLineMat);
      bladeHolder.add(bladeLines);

      pivot.add(bladeHolder);
      poleGroup.add(pivot);
      poleIrisPivots[pi].push(bladeHolder);
    }

    root.add(poleGroup);
  }
  const finishLedRingGeo = new THREE.TorusGeometry(poleHoleR * 1.13, 0.0044, 12, 36);
  finishLedRingGeo.rotateX(Math.PI / 2);
  disposables.push(
    poleRimGeo,
    poleChamferGeo,
    poleSeamGeo,
    poleIrisBladeGeo,
    poleIrisBladeEdgesGeo,
    poleShaftGeo,
    poleFloorGeo,
    poleWellMat,
    finishLedRingGeo,
  );

  // =========================================================================
  // 6. DYNAMIC PER-LEVEL PUZZLE ELEMENTS: SEQUENTIAL LEDs, TOGGLE PADS & NEON GATES
  // =========================================================================
  const bezelGeo = new THREE.TorusGeometry(0.024, 0.0048, 10, 24);
  bezelGeo.rotateX(Math.PI / 2);
  const domeGeo = new THREE.SphereGeometry(0.0185, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const haloGeo = new THREE.PlaneGeometry(0.21, 0.21);

  // Tactile floor Toggle Switch Pad geometry (Signal Red A & Electric Blue B)
  const toggleBezelGeo = new THREE.TorusGeometry(0.046, 0.006, 10, 28);
  toggleBezelGeo.rotateX(Math.PI / 2);
  const toggleCapGeo = new THREE.CylinderGeometry(0.036, 0.039, 0.014, 24);
  const togglePipGeo = new THREE.SphereGeometry(0.008, 12, 8);
  const TOGGLE_HEX = ['#d61010', '#1054f5'];
  const TOGGLE_COLORS = [new THREE.Color(0xe60c0c), new THREE.Color(0x145eff)];
  const NEON_TUBE_COLORS = [new THREE.Color(0xff524c), new THREE.Color(0x6eb2ff)];
  const NEON_EMISSIVE_COLORS = [new THREE.Color(0xff0808), new THREE.Color(0x004eff)];
  const NEON_AURA_COLORS = [new THREE.Color(0xff1414), new THREE.Color(0x1466ff)];
  const GATE_WALL_GLOW = [new THREE.Color(0xf20808), new THREE.Color(0x084eff)];
  const neonTubeTextures = [createNeonTubeTexture(0), createNeonTubeTexture(1)];

  // Soft transverse gradient halo texture for the neon light bars (bright center, smooth fade at edges & ends)
  const neonHaloCanvas = document.createElement('canvas');
  neonHaloCanvas.width = 128;
  neonHaloCanvas.height = 64;
  const nhCtx = neonHaloCanvas.getContext('2d')!;
  const nhImg = nhCtx.createImageData(128, 64);
  for (let y = 0; y < 64; y++) {
    const vy = Math.abs((y + 0.5) / 64 - 0.5) * 2; // 0 at center, 1 at edge
    const fallY = Math.pow(Math.max(0, 1 - vy), 2.35);
    for (let x = 0; x < 128; x++) {
      const vx = Math.abs((x + 0.5) / 128 - 0.5) * 2;
      const fallX = Math.min(1, (1 - vx) * 4.0);
      const a = Math.round(fallY * fallX * 255);
      const p = (y * 128 + x) * 4;
      nhImg.data[p] = nhImg.data[p + 1] = nhImg.data[p + 2] = 255;
      nhImg.data[p + 3] = a;
    }
  }
  nhCtx.putImageData(nhImg, 0, 0);
  const neonHaloTex = new THREE.CanvasTexture(neonHaloCanvas);
  neonHaloTex.colorSpace = THREE.SRGBColorSpace;

  disposables.push(
    neonHaloTex,
    neonTubeTextures[0],
    neonTubeTextures[1],
    bezelGeo,
    domeGeo,
    haloGeo,
    toggleBezelGeo,
    toggleCapGeo,
    togglePipGeo,
  );

  const levelGroup = new THREE.Group();
  root.add(levelGroup);

  let leds: LedVisual[] = [];
  let toggleVisuals: ToggleVisual[] = [];
  let gateNeonVisuals: GateNeonVisual[] = [];
  let levelDisposables: { dispose: () => void }[] = [];
  let attachedGateOverlays: { parent: THREE.Object3D; mesh: THREE.Mesh }[] = [];
  let lastClearedIdx = -1;

  function setLevelVisuals(level: LevelConfig) {
    for (const d of levelDisposables) d.dispose();
    levelDisposables = [];
    for (const o of attachedGateOverlays) {
      o.parent.remove(o.mesh);
    }
    attachedGateOverlays = [];
    levelGroup.clear();
    dynamicAoExcluded.length = 0;
    leds = [];
    toggleVisuals = [];
    gateNeonVisuals = [];
    lastClearedIdx = -1;

    // Reset shutter & wall gate color links
    for (const s of shutterRigs) {
      s.linkedColorId = -1;
      s.lastOpen = -1; // force ring color refresh
    }
    for (const b of bladeRigs) {
      if (!b.slot.locked) {
        b.gateColorId = -1;
        b.lastExt = -1;
        b.mat.emissive.setHex(0x000000);
        b.mat.emissiveIntensity = 0;
      }
    }

    // 1. Sequential Checkpoint LEDs (upper surface + under-deck half-pipe!)
    for (const cp of level.checkpoints) {
      const qAlign = new THREE.Quaternion().setFromUnitVectors(upAxis, cp.dir);
      const baseR = cp.layer === 'pipe' ? R_PIPE_FLOOR : R_FLOOR;

      if (cp.layer === 'upper') {
        const labelTex = createDecalLabelTexture(cp.label, cp.isFinish ? 'END' : 'CHK');
        const decalGeo = buildFloorDecalPatch(cp.dir, baseR + 0.0022, cp.isFinish ? 0.17 : 0.112);
        const decalMat = new THREE.MeshStandardMaterial({
          map: labelTex,
          transparent: true,
          roughness: 0.78,
          depthWrite: false,
        });
        const decalMesh = new THREE.Mesh(decalGeo, decalMat);
        levelGroup.add(decalMesh);
        dynamicAoExcluded.push(decalMesh);
        levelDisposables.push(labelTex, decalGeo, decalMat);
      }

      const domeMat = new THREE.MeshStandardMaterial({
        color: 0xd0cbc2,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0,
        roughness: 0.24,
        metalness: 0.05,
      });
      if (cp.isFinish) {
        // South Pole 13 END: luminous LED ring framing the open polar drop socket!
        const finishRing = new THREE.Mesh(finishLedRingGeo, domeMat);
        finishRing.position.copy(cp.dir).multiplyScalar(baseR + 0.0032);
        finishRing.quaternion.copy(qAlign);
        levelGroup.add(finishRing);
      } else {
        const bezel = new THREE.Mesh(bezelGeo, steelMat);
        bezel.position.copy(cp.dir).multiplyScalar(baseR + 0.002);
        bezel.quaternion.copy(qAlign);
        levelGroup.add(bezel);

        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.copy(cp.dir).multiplyScalar(baseR - 0.001);
        dome.quaternion.copy(qAlign);
        levelGroup.add(dome);
      }
      levelDisposables.push(domeMat);

      const haloMat = new THREE.MeshBasicMaterial({
        map: haloTex,
        color: 0xff8c2b,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.copy(cp.dir).multiplyScalar(baseR + 0.02);
      haloMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cp.dir);
      levelGroup.add(haloMesh);
      dynamicAoExcluded.push(haloMesh);
      levelDisposables.push(haloMat);

      leds.push({
        checkpoint: cp,
        domeMat,
        haloMat,
        haloMesh,
        localPos: cp.dir.clone().multiplyScalar(baseR + 0.07),
      });
    }

    // 2. Mechanical Floor Toggle Switch Pads + Color-Linked Gate Wall Stripes & Shutter Links
    for (const tg of level.toggles) {
      const qAlign = new THREE.Quaternion().setFromUnitVectors(upAxis, tg.dir);
      const hexStr = TOGGLE_HEX[tg.colorId];
      const accentCol = TOGGLE_COLORS[tg.colorId];

      // Pad-printed dashed ring ("SW A ⇄" / "SW B ⇄")
      const padTex = createTogglePadDecalTexture(tg.label, hexStr);
      const padDecalGeo = buildFloorDecalPatch(tg.dir, R_FLOOR + 0.0022, 0.115);
      const padDecalMat = new THREE.MeshStandardMaterial({
        map: padTex,
        transparent: true,
        roughness: 0.75,
        depthWrite: false,
      });
      const padDecal = new THREE.Mesh(padDecalGeo, padDecalMat);
      levelGroup.add(padDecal);
      dynamicAoExcluded.push(padDecal);
      levelDisposables.push(padTex, padDecalGeo, padDecalMat);

      const padGroup = new THREE.Group();
      padGroup.position.copy(tg.dir).multiplyScalar(R_FLOOR);
      padGroup.quaternion.copy(qAlign);
      levelGroup.add(padGroup);

      // Machined stainless collar bezel
      const bezel = new THREE.Mesh(toggleBezelGeo, steelMat);
      bezel.position.y = 0.002;
      padGroup.add(bezel);

      // Tactile spring-loaded circular push button cap
      const capMat = new THREE.MeshStandardMaterial({
        color: accentCol.clone(),
        emissive: accentCol.clone(),
        emissiveIntensity: 0.08,
        roughness: 0.42,
        metalness: 0.06,
      });
      const capMesh = new THREE.Mesh(toggleCapGeo, capMat);
      const baseY = 0.003;
      capMesh.position.y = baseY;
      capMesh.castShadow = true;
      capMesh.receiveShadow = true;
      padGroup.add(capMesh);

      // Center LED status pip on the switch button
      const pipMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: accentCol.clone(),
        emissiveIntensity: 0.35,
        roughness: 0.2,
      });
      const pipMesh = new THREE.Mesh(togglePipGeo, pipMat);
      pipMesh.position.y = 0.007;
      capMesh.add(pipMesh);

      levelDisposables.push(capMat, pipMat);
      toggleVisuals.push({ pad: tg, capMesh, capMat, pipMat, baseY });

      // Embed a sleek, borderless frosted LED NEON LIGHT BAR along every linked gate wall + flush floor LED bar!
      const tubeTex = neonTubeTextures[tg.colorId];
      const auraCol = NEON_AURA_COLORS[tg.colorId];
      for (const wid of tg.wallIds) {
        const blade = bladeRigs[wid];
        if (!blade || blade.slot.locked) continue;
        blade.gateColorId = tg.colorId;
        blade.lastExt = -1;

        // 1. Sleek domed frosted-acrylic LED neon light bar seated directly in the alabaster wall crown (no dark frame!)
        const barGeo = buildNeonBarGeometry(blade.slot, R_WALL - 0.0005, WALL_HALF_WIDTH * 0.46, 0.0092, 0.015);
        const barMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: tubeTex,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: tubeTex,
          emissiveIntensity: 2.35,
          roughness: 0.14,
          metalness: 0.0,
          envMapIntensity: 0.45,
        });
        const barMesh = new THREE.Mesh(barGeo, barMat);
        blade.mesh.add(barMesh);
        attachedGateOverlays.push({ parent: blade.mesh, mesh: barMesh });
        levelDisposables.push(barGeo, barMat);

        // 2. Soft diffused LED glow aura spilling gently onto the white wall shoulders
        const haloStripGeo = buildNeonHaloStripGeometry(blade.slot, R_WALL + 0.0018, WALL_HALF_WIDTH * 1.48);
        const haloMat = new THREE.MeshBasicMaterial({
          map: neonHaloTex,
          color: auraCol.clone(),
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const haloStripMesh = new THREE.Mesh(haloStripGeo, haloMat);
        blade.mesh.add(haloStripMesh);
        attachedGateOverlays.push({ parent: blade.mesh, mesh: haloStripMesh });
        dynamicAoExcluded.push(haloStripMesh);
        levelDisposables.push(haloStripGeo, haloMat);

        // 3. Slender flush LED indicator bar embedded cleanly between the floor seams (visible when gate retracts open!)
        const floorBarGeo = buildNeonBarGeometry(blade.slot, R_FLOOR + 0.0012, WALL_HALF_WIDTH * 0.32, 0.0032, 0.017);
        const floorBarMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: tubeTex,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: tubeTex,
          emissiveIntensity: 1.65,
          roughness: 0.16,
          metalness: 0.0,
          envMapIntensity: 0.4,
        });
        const floorBarMesh = new THREE.Mesh(floorBarGeo, floorBarMat);
        levelGroup.add(floorBarMesh);
        levelDisposables.push(floorBarGeo, floorBarMat);

        // Subtle soft floor LED spill beneath the flush floor indicator bar
        const floorHaloGeo = buildNeonHaloStripGeometry(blade.slot, R_FLOOR + 0.0016, WALL_HALF_WIDTH * 1.12);
        const floorHaloMat = new THREE.MeshBasicMaterial({
          map: neonHaloTex,
          color: auraCol.clone(),
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const floorHaloMesh = new THREE.Mesh(floorHaloGeo, floorHaloMat);
        levelGroup.add(floorHaloMesh);
        dynamicAoExcluded.push(floorHaloMesh);
        levelDisposables.push(floorHaloGeo, floorHaloMat);

        gateNeonVisuals.push({
          colorId: tg.colorId,
          wallId: wid,
          barMat,
          haloMat,
          floorBarMat,
        });
      }

      // Link controlled diaphragm shutters so their recessed bezel ring displays this switch's accent color!
      for (const sid of tg.shutterIds) {
        if (shutterRigs[sid]) {
          shutterRigs[sid].linkedColorId = tg.colorId;
          shutterRigs[sid].lastOpen = -1;
        }
      }
    }

    syncAoExcluded();
  }

  const activeLight = new THREE.PointLight(0xff7820, 0.72, 0.92, 1.8);
  const clearedLight = new THREE.PointLight(0x32e896, 0.0, 0.92, 1.8);
  // Subtle interior studio fill light revealing half-pipe curvature beneath the transparent floor windows
  const pipeAmbientLight = new THREE.PointLight(0xf6efe2, 0.24, 1.4, 1.3);
  pipeAmbientLight.position.set(0.15, 0.1, 0.72);
  root.add(activeLight);
  root.add(clearedLight);
  root.add(pipeAmbientLight);

  // =========================================================================
  // 7. CHROME BEARING BALL + THIN CLEAR PLASTIC SHELL + LIGHT SCRATCHES + SWEDEN TAPE
  // =========================================================================
  const ballGeo = new THREE.SphereGeometry(R_BALL, 36, 28);
  const ballRoughTex = createMetalBallTexture();
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xd9dce2,
    metalness: 0.99,
    roughness: 0.09,
    roughnessMap: ballRoughTex,
    envMapIntensity: 2.15,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  root.add(ballMesh);
  disposables.push(ballGeo, ballRoughTex, ballMat);

  const { roughnessMap: scratchRough, bumpMap: scratchBump, scratchAlphaMap } = createPlasticScratchTextures();
  disposables.push(scratchRough, scratchBump, scratchAlphaMap);

  const shellGeo = new THREE.SphereGeometry(R_SHELL, 88, 64);
  const plasticOpacityUniform = { value: 1.0 };

  const plasticMat = new THREE.MeshPhysicalMaterial({
    color: 0xfdfcf9,
    roughness: 0.055,
    roughnessMap: scratchRough,
    bumpMap: scratchBump,
    bumpScale: 0.0032,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.048,
    reflectivity: 0.92,
    ior: 1.49,
    envMapIntensity: 2.35,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  });

  plasticMat.onBeforeCompile = (shader) => {
    shader.uniforms.uPlasticScale = plasticOpacityUniform;
    shader.fragmentShader =
      'uniform float uPlasticScale;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        vec3 viewDir = normalize(vViewPosition);
        float ndotv = clamp(abs(dot(normalize(normal), viewDir)), 0.0, 1.0);
        float fresnel = pow(1.0 - ndotv, 2.55);
        float specEnergy = max(max(reflectedLight.directSpecular.r, reflectedLight.directSpecular.g), reflectedLight.directSpecular.b)
                         + max(max(reflectedLight.indirectSpecular.r, reflectedLight.indirectSpecular.g), reflectedLight.indirectSpecular.b) * 0.65;
        float shellAlpha = clamp((0.022 + fresnel * 0.44 + specEnergy * 0.36) * uPlasticScale, 0.0, 0.8);
        gl_FragColor.a = shellAlpha;
        #include <dithering_fragment>
        `,
      );
  };

  const plasticShell = new THREE.Mesh(shellGeo, plasticMat);
  plasticShell.renderOrder = 10;
  root.add(plasticShell);
  baseAoExcluded.push(plasticShell);
  disposables.push(shellGeo, plasticMat);

  const scratchOverlayMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    alphaMap: scratchAlphaMap,
    transparent: true,
    opacity: 0.56,
    roughness: 0.22,
    metalness: 0.14,
    depthWrite: false,
  });
  const scratchOverlayMesh = new THREE.Mesh(shellGeo, scratchOverlayMat);
  scratchOverlayMesh.scale.setScalar(1.0008);
  scratchOverlayMesh.renderOrder = 11;
  root.add(scratchOverlayMesh);
  baseAoExcluded.push(scratchOverlayMesh);
  disposables.push(scratchOverlayMat);

  const outerSeamGeo = new THREE.TorusGeometry(R_SHELL + 0.001, 0.0038, 10, 120);
  outerSeamGeo.rotateX(Math.PI / 2);
  const outerSeamMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8d3c9,
    roughness: 0.32,
    metalness: 0.0,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const outerSeam = new THREE.Mesh(outerSeamGeo, outerSeamMat);
  outerSeam.renderOrder = 12;
  root.add(outerSeam);
  baseAoExcluded.push(outerSeam);
  disposables.push(outerSeamGeo, outerSeamMat);

  const primaryTape = createTapeTexture('primary');
  const primaryTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0042, 0.38, 0.96, 0.21, 0.11);
  const primaryTapeMat = new THREE.MeshPhysicalMaterial({
    map: primaryTape.map,
    roughnessMap: primaryTape.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.3,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const primaryTapeMesh = new THREE.Mesh(primaryTapeGeo, primaryTapeMat);
  primaryTapeMesh.renderOrder = 14;
  root.add(primaryTapeMesh);
  baseAoExcluded.push(primaryTapeMesh);
  disposables.push(primaryTape.map, primaryTape.roughnessMap, primaryTapeGeo, primaryTapeMat);

  const secondaryTape = createTapeTexture('secondary');
  const secondaryTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0042, Math.PI + 0.18, 0.78, 0.17, -0.075);
  const secondaryTapeMat = new THREE.MeshPhysicalMaterial({
    map: secondaryTape.map,
    roughnessMap: secondaryTape.roughnessMap,
    roughness: 0.44,
    metalness: 0.0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.35,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const secondaryTapeMesh = new THREE.Mesh(secondaryTapeGeo, secondaryTapeMat);
  secondaryTapeMesh.renderOrder = 14;
  root.add(secondaryTapeMesh);
  baseAoExcluded.push(secondaryTapeMesh);
  disposables.push(secondaryTape.map, secondaryTape.roughnessMap, secondaryTapeGeo, secondaryTapeMat);

  // Small calibration tapes near North Pole & South Pole (same frosted serrated adhesive style as MADE IN SWEDEN)
  const northTape = createTapeTexture('north');
  const northTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0044, 0.34, 0.44, 0.135, 0.0, 1.16);
  const northTapeMat = new THREE.MeshPhysicalMaterial({
    map: northTape.map,
    roughnessMap: northTape.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.3,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const northTapeMesh = new THREE.Mesh(northTapeGeo, northTapeMat);
  northTapeMesh.renderOrder = 14;
  root.add(northTapeMesh);
  baseAoExcluded.push(northTapeMesh);
  disposables.push(northTape.map, northTape.roughnessMap, northTapeGeo, northTapeMat);

  const southTape = createTapeTexture('south');
  const southTapeGeo = buildCurvedTapePatch(R_SHELL + 0.0044, 0.34, 0.44, 0.135, 0.0, -1.16);
  const southTapeMat = new THREE.MeshPhysicalMaterial({
    map: southTape.map,
    roughnessMap: southTape.roughnessMap,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.3,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const southTapeMesh = new THREE.Mesh(southTapeGeo, southTapeMat);
  southTapeMesh.renderOrder = 14;
  root.add(southTapeMesh);
  baseAoExcluded.push(southTapeMesh);
  disposables.push(southTape.map, southTape.roughnessMap, southTapeGeo, southTapeMat);

  syncAoExcluded();

  // =========================================================================
  // 8. LIVE MORPHING UPDATERS (WALL BLADES + 6-BLADE DIAPHRAGM SHUTTERS + LEDS)
  // =========================================================================
  const FLUSH_SCALE = (R_FLOOR + 0.00025) / R_WALL;

  function applyWallExtensions(wallExt: Float32Array) {
    for (let i = 0; i < bladeRigs.length; i++) {
      const b = bladeRigs[i];
      const ext = b.slot.locked ? 1.0 : wallExt[b.slot.id];
      if (Math.abs(ext - b.lastExt) < 1e-4) continue;
      b.lastExt = ext;

      // Retract smoothly down to flush floor level (R_FLOOR) without protruding below transparent windows!
      const scale = FLUSH_SCALE + (1.0 - FLUSH_SCALE) * ext;
      b.mesh.scale.setScalar(scale);
      b.mesh.visible = b.slot.locked || ext > 0.015;
      b.mesh.castShadow = ext > 0.08;

      if (!b.slot.locked) {
        const blend = Math.pow(ext, 0.65);
        b.mat.color.lerpColors(COLOR_FLOOR, COLOR_WALL_RAISED, blend);
        b.mat.roughness = 0.78 + (0.48 - 0.78) * blend;
        if (b.gateColorId >= 0) {
          // Subtle internal red/blue backlight bleed through the matte-white gate body
          b.mat.emissive.copy(GATE_WALL_GLOW[b.gateColorId]);
          b.mat.emissiveIntensity = 0.14 * blend;
        } else {
          b.mat.emissive.setHex(0x000000);
          b.mat.emissiveIntensity = 0;
        }
        if (b.arrowMat) {
          b.arrowMat.opacity = b.gateColorId >= 0 ? 0 : Math.max(0, (ext - 0.35) / 0.65);
        }
      }
    }
  }

  function applyShutterOpenings(shutterOpen: Float32Array) {
    for (let i = 0; i < shutterRigs.length; i++) {
      const s = shutterRigs[i];
      const open = shutterOpen[s.port.id];
      if (Math.abs(open - s.lastOpen) < 1e-4) continue;
      s.lastOpen = open;

      const pivotAngle = open * 0.96;
      const tuckScale = 1.0 - open * 0.42;
      for (let k = 0; k < s.pivots.length; k++) {
        const holder = s.pivots[k];
        holder.rotation.y = pivotAngle;
        holder.scale.set(tuckScale, 1, tuckScale);
        holder.visible = open < 0.985;
      }

      if (s.linkedColorId >= 0) {
        // Toggle-controlled shutter: delicate glowing Red/Blue LED ring + soft floor light halo
        const tubeCol = NEON_TUBE_COLORS[s.linkedColorId];
        const emCol = NEON_EMISSIVE_COLORS[s.linkedColorId];
        const auraCol = NEON_AURA_COLORS[s.linkedColorId];
        s.outerNeonMesh.visible = true;
        s.outerNeonMat.color.copy(tubeCol);
        s.outerNeonMat.emissive.copy(emCol);
        s.outerNeonMat.emissiveIntensity = 1.9 + open * 0.9;

        s.outerHaloMesh.visible = true;
        s.outerHaloMat.color.copy(auraCol);
        s.outerHaloMat.opacity = 0.2 + open * 0.14;

        s.ringLedMat.color.copy(tubeCol);
        s.ringLedMat.emissive.copy(emCol);
        s.ringLedMat.emissiveIntensity = 1.3 + open * 1.1;
      } else {
        s.outerNeonMesh.visible = false;
        s.outerHaloMesh.visible = false;
        s.ringLedMat.emissive.setHex(0x2ee69c);
        s.ringLedMat.emissiveIntensity = open * 1.55;
        s.ringLedMat.color.setHex(open > 0.35 ? 0xd2ffed : 0x9b9488);
      }
    }
  }

  const lastPoleOpen = [-1, -1];
  let readyShutterId = -1;
  let readyFinish = false;
  let readyDwell = 0;
  let readyToggleId = -1;

  function applyPoleShutters(northOpen: number, southOpen: number) {
    const opens = [northOpen, southOpen];
    for (let pi = 0; pi < 2; pi++) {
      const open = Math.max(0, Math.min(1, opens[pi]));
      if (Math.abs(open - lastPoleOpen[pi]) < 1e-4) continue;
      lastPoleOpen[pi] = open;

      const pivotAngle = open * 0.96;
      const tuckScale = 1.0 - open * 0.42;
      const pivots = poleIrisPivots[pi];
      for (let k = 0; k < pivots.length; k++) {
        const holder = pivots[k];
        holder.rotation.y = pivotAngle;
        holder.scale.set(tuckScale, 1, tuckScale);
        holder.visible = open < 0.985;
      }
    }
  }

  function setReadyHole(shutterId: number, finishReady: boolean, dwell = 0, toggleId = -1) {
    readyShutterId = shutterId;
    readyFinish = finishReady;
    readyDwell = dwell;
    readyToggleId = toggleId;
  }

  const colorAmber = new THREE.Color(0xff6e18);
  const colorCleared = new THREE.Color(0x2ce391);
  const colorFinishGlow = new THREE.Color(0x46f0a5);
  const colorPipeTarget = new THREE.Color(0x2ad9c6);
  const colorLockedDim = new THREE.Color(0x6e6a64);

  function updateLeds(
    time: number,
    clearedMask: boolean[],
    nextIndex: number,
    allCleared: boolean,
    toggleMask: number,
    togglePulse: Float32Array,
  ) {
    let newestCleared = -1;
    for (let i = 0; i < leds.length; i++) {
      if (clearedMask[i]) newestCleared = i;
    }
    if (newestCleared !== -1) lastClearedIdx = newestCleared;

    // 1. Sequential Checkpoint LEDs (only NEXT pulses bright; future checkpoints stay clearly locked/dim!)
    for (let i = 0; i < leds.length; i++) {
      const led = leds[i];
      const cleared = clearedMask[i];

      if (allCleared) {
        const wave = 0.5 + 0.5 * Math.sin(time * 3.4 - i * 0.9);
        led.domeMat.color.setHex(0xd2ffeb);
        led.domeMat.emissive.copy(colorFinishGlow);
        led.domeMat.emissiveIntensity = 2.2 + wave * 2.0;
        led.haloMat.color.copy(colorFinishGlow);
        led.haloMat.opacity = 0.38 + wave * 0.34;
        led.haloMesh.scale.setScalar(1.0 + wave * 0.24);
      } else if (cleared) {
        const breathe = 0.5 + 0.5 * Math.sin(time * 1.6 + i * 1.3);
        const isPipe = led.checkpoint.layer === 'pipe';
        led.domeMat.color.setHex(0xd2ffeb);
        led.domeMat.emissive.copy(colorCleared);
        led.domeMat.emissiveIntensity = (isPipe ? 1.55 : 2.1) + breathe * 0.4;
        led.haloMat.color.copy(colorCleared);
        led.haloMat.opacity = (isPipe ? 0.24 : 0.4) + breathe * 0.08;
        led.haloMesh.scale.setScalar((isPipe ? 0.78 : 1.0) + breathe * 0.08);
      } else if (i === nextIndex) {
        const pulse = 0.5 + 0.5 * Math.sin(time * (led.checkpoint.isFinish && readyFinish ? 6.2 : 3.6));
        const isPipe = led.checkpoint.layer === 'pipe';
        const isSeatedFinish = led.checkpoint.isFinish && readyFinish;
        const col = isSeatedFinish ? colorFinishGlow : isPipe ? colorPipeTarget : colorAmber;
        led.domeMat.color.setHex(isSeatedFinish ? 0xf2fff8 : isPipe ? 0xd0fff8 : 0xffe1c2);
        led.domeMat.emissive.copy(col);
        led.domeMat.emissiveIntensity = isSeatedFinish
          ? 3.4 + readyDwell * 2.1 + pulse * 1.9
          : (isPipe ? 1.7 : 2.2) + pulse * (isPipe ? 1.2 : 2.1);
        led.haloMat.color.copy(col);
        led.haloMat.opacity = isSeatedFinish
          ? 0.58 + pulse * 0.28
          : (isPipe ? 0.28 : 0.46) + pulse * (isPipe ? 0.2 : 0.36);
        led.haloMesh.scale.setScalar(
          isSeatedFinish ? 1.18 + pulse * 0.22 : (isPipe ? 0.82 : 1.02) + pulse * 0.26,
        );
      } else {
        // Locked future checkpoint in strict sequence: clearly dimmed/off so next target is unmistakable!
        led.domeMat.color.setHex(0xc8c2b7);
        led.domeMat.emissive.copy(colorLockedDim);
        led.domeMat.emissiveIntensity = 0.05;
        led.haloMat.opacity = 0.0;
        led.haloMesh.scale.setScalar(0.5);
      }
    }

    // 2. Tactile Toggle Switch Button Depress & Status Pip Animation
    for (let i = 0; i < toggleVisuals.length; i++) {
      const tv = toggleVisuals[i];
      const active = (toggleMask & (1 << tv.pad.id)) !== 0;
      const press = togglePulse[tv.pad.id] || 0;
      const isReady = tv.pad.id === readyToggleId;
      const seatDepress = isReady ? 0.0016 + readyDwell * 0.0034 : 0;
      tv.capMesh.position.y = tv.baseY - press * 0.0065 - (active ? 0.0028 : 0) - seatDepress;
      const breathe = 0.5 + 0.5 * Math.sin(time * (isReady ? 6.2 : 2.8) + i);
      const readyBoost = isReady ? 0.45 + readyDwell * 0.85 + breathe * 0.35 : 0;
      tv.capMat.emissiveIntensity = (active ? 0.72 + breathe * 0.24 : 0.22 + breathe * 0.08) + readyBoost;
      tv.pipMat.emissiveIntensity = (active ? 3.2 : 0.9 + breathe * 0.4) + readyBoost * 1.8;
    }

    // 3. Gentle living LED neon pulse on color-coded gate bars, retracted floor slots, and linked shutter rings
    for (let i = 0; i < gateNeonVisuals.length; i++) {
      const gn = gateNeonVisuals[i];
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.6 + gn.colorId * 2.1);
      gn.barMat.emissiveIntensity = 2.0 + pulse * 0.7;
      gn.haloMat.opacity = 0.28 + pulse * 0.14;
      gn.floorBarMat.emissiveIntensity = 1.45 + pulse * 0.45;
    }
    const readyPulse = 0.5 + 0.5 * Math.sin(time * 6.4);
    for (let i = 0; i < shutterRigs.length; i++) {
      const s = shutterRigs[i];
      const isReady = s.port.id === readyShutterId && s.lastOpen > 0.5;
      if (s.linkedColorId >= 0) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.6 + s.linkedColorId * 2.1);
        const openBoost = s.lastOpen > 0 ? s.lastOpen * 0.75 : 0;
        const readyBoost = isReady ? 1.35 + readyDwell * 1.65 + readyPulse * 0.95 : 0;
        s.outerNeonMat.emissiveIntensity = 1.85 + openBoost + pulse * 0.55 + readyBoost;
        s.outerHaloMat.opacity = Math.min(0.62, 0.18 + (s.lastOpen > 0 ? s.lastOpen * 0.12 : 0) + pulse * 0.08 + (isReady ? 0.16 + readyDwell * 0.1 : 0));
        s.ringLedMat.emissiveIntensity = 1.3 + Math.max(0, s.lastOpen) * 1.1 + readyBoost * 1.2;
      } else if (isReady) {
        s.ringLedMat.color.setHex(0xf2fff9);
        s.ringLedMat.emissive.setHex(0x3af0a2);
        s.ringLedMat.emissiveIntensity = 2.85 + readyDwell * 2.1 + readyPulse * 1.65;
      } else {
        const open = Math.max(0, s.lastOpen);
        s.ringLedMat.emissive.setHex(0x2ee69c);
        s.ringLedMat.emissiveIntensity = open * 1.55;
        s.ringLedMat.color.setHex(open > 0.35 ? 0xd2ffed : 0x9b9488);
      }
    }

    if (allCleared && leds.length > 0) {
      const idx = Math.floor(time * 1.8) % leds.length;
      activeLight.color.copy(colorFinishGlow);
      activeLight.position.copy(leds[idx].localPos);
      activeLight.intensity = 1.25;
      clearedLight.intensity = 0.0;
    } else {
      if (nextIndex >= 0 && nextIndex < leds.length) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.6);
        const isPipe = leds[nextIndex].checkpoint.layer === 'pipe';
        const col = isPipe ? colorPipeTarget : colorAmber;
        activeLight.color.copy(col);
        activeLight.position.copy(leds[nextIndex].localPos);
        activeLight.intensity = (isPipe ? 0.65 : 0.9) + pulse * 0.65;
      } else {
        activeLight.intensity = 0.0;
      }

      if (lastClearedIdx >= 0 && lastClearedIdx < leds.length && clearedMask[lastClearedIdx]) {
        const isPipe = leds[lastClearedIdx].checkpoint.layer === 'pipe';
        clearedLight.color.copy(colorCleared);
        clearedLight.position.copy(leds[lastClearedIdx].localPos);
        clearedLight.intensity = isPipe ? 0.52 : 0.78;
      } else {
        clearedLight.intensity = 0.0;
      }
    }
  }

  function setPlasticOpacity(scale: number) {
    plasticOpacityUniform.value = scale;
  }

  function setScratchStrength(scale: number) {
    scratchOverlayMat.opacity = 0.56 * scale;
    plasticMat.bumpScale = 0.0032 * scale;
  }

  function dispose() {
    for (const d of levelDisposables) d.dispose();
    for (const d of disposables) d.dispose();
  }

  return {
    root,
    ballMesh,
    plasticShell,
    plasticMat,
    scratchOverlayMesh,
    scratchOverlayMat,
    aoExcluded,
    applyWallExtensions,
    applyShutterOpenings,
    applyPoleShutters,
    setReadyHole,
    setLevelVisuals,
    updateLeds,
    setPlasticOpacity,
    setScratchStrength,
    dispose,
  };
}
