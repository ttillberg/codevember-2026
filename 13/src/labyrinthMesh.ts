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
  type PipeEdge,
  type PipeNode,
  type ShutterPort,
  type SphereGrid,
  type VertexPost,
  type WallSlot,
} from './maze';
import {
  createArrowGlyphTexture,
  createDecalLabelTexture,
  createLedHaloTexture,
  createMatteGrainTextures,
  createMetalBallTexture,
  createPadlockGlyphTexture,
  createPlasticScratchTextures,
  createTapeTexture,
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
  lastExt: number;
}

interface ShutterRig {
  port: ShutterPort;
  pivots: THREE.Group[];
  ringLedMat: THREE.MeshStandardMaterial;
  lastOpen: number;
}

const POST_RAD_BASE = WALL_HALF_WIDTH * 1.12;
const POST_RAD_UPPER = WALL_HALF_WIDTH * 1.04;
const POST_RAD_TOP = WALL_HALF_WIDTH * 0.8;
const POLE_SEAM_GAP = 0.0042;

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
  setLevelCheckpoints: (checkpoints: Checkpoint[]) => void;
  updateLeds: (time: number, clearedMask: boolean[], nextIndex: number, allCleared: boolean) => void;
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

  const phi0 = isNorthPole ? 0.002 : cell.phiMin;
  const phi1 = isSouthPole ? Math.PI - 0.002 : cell.phiMax;
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

  const rIn = 0.079; // cradles 0.068 steel ball cleanly with crisp visual clearance
  const rOut = 0.097; // sculpted physical wall thickness
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
  const hubTrimFrac = Math.min(0.24, 0.082 / Math.max(0.15, edge.arcLen));

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
  const rIn = 0.081;
  const rOut = 0.1;
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
    const lat = (vCoord - 0.5) * angularHeight;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let ix = 0; ix <= segX; ix++) {
      const uCoord = ix / segX;
      const lon = (uCoord - 0.5) * angularWidth;
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
  disposables.push(floorMat, steelMat, darkSlotMat);

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

  const irisBezelGeo = new THREE.TorusGeometry(holeWorldR * 1.01, 0.0085, 12, 36);
  irisBezelGeo.rotateX(Math.PI / 2);
  const irisLedRingGeo = new THREE.TorusGeometry(holeWorldR * 0.94, 0.0034, 8, 36);
  irisLedRingGeo.rotateX(Math.PI / 2);
  disposables.push(irisBladeGeo, irisBladeEdgesGeo, irisBladeMat, irisBladeLineMat, irisBezelGeo, irisLedRingGeo);

  const shutterRigs: ShutterRig[] = [];

  for (const port of grid.shutters) {
    const shutterGroup = new THREE.Group();
    shutterGroup.position.copy(port.dir).multiplyScalar(R_FLOOR - 0.001);
    shutterGroup.quaternion.setFromUnitVectors(upAxis, port.dir);
    root.add(shutterGroup);

    // Machined brushed-steel outer iris bezel flush with the beige floor
    const bezel = new THREE.Mesh(irisBezelGeo, steelMat);
    bezel.position.y = 0.002;
    shutterGroup.add(bezel);

    // Delicate recessed portal status LED ring right inside the iris rim
    const ringLedMat = new THREE.MeshStandardMaterial({
      color: 0xd0ffec,
      emissive: new THREE.Color(0x2ee69c),
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.05,
    });
    const ringLed = new THREE.Mesh(irisLedRingGeo, ringLedMat);
    ringLed.position.y = -0.002;
    shutterGroup.add(ringLed);
    disposables.push(ringLedMat);

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
      lastOpen: -1,
    });
  }

  // =========================================================================
  // 4. CRISP RECESSED FLOOR SEAM GRID + STEADY POLES + RETRACTABLE WALL BLADES
  // =========================================================================
  const seamGeo = buildSeamGridGeometry(grid);
  const seamMat = new THREE.MeshStandardMaterial({
    color: 0x867d70,
    roughness: 0.9,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const seamMesh = new THREE.Mesh(seamGeo, seamMat);
  seamMesh.receiveShadow = true;
  root.add(seamMesh);
  disposables.push(seamGeo, seamMat);

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
      const glyphGeo = buildWallTopGlyphPatch(wall, R_WALL + 0.0014, 0.044, 0.044);
      const glyphMesh = new THREE.Mesh(glyphGeo, padlockMat);
      mesh.add(glyphMesh);
      baseAoExcluded.push(glyphMesh);
      disposables.push(glyphGeo);
    } else if (wall.hasArrow) {
      const glyphGeo = buildWallTopGlyphPatch(wall, R_WALL + 0.0014, 0.084, 0.042);
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

    bladeRigs.push({ slot: wall, mesh, mat, arrowMat, lastExt: -1 });
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
    const screw = createMicroScrew(steelMat, darkSlotMat, 1.0);
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

  const startRingGeo = new THREE.TorusGeometry(0.038, 0.005, 10, 28);
  startRingGeo.rotateX(Math.PI / 2);
  const startRing = new THREE.Mesh(startRingGeo, steelMat);
  startRing.position.copy(startDir).multiplyScalar(R_FLOOR + 0.003);
  startRing.quaternion.setFromUnitVectors(upAxis, startDir);
  root.add(startRing);
  disposables.push(startRingGeo);

  // =========================================================================
  // 6. DYNAMIC PER-LEVEL CHECKPOINT LEDs (BOTH UPPER SURFACE & UNDER-DECK HALF-PIPE!)
  // =========================================================================
  const haloTex = createLedHaloTexture();
  const bezelGeo = new THREE.TorusGeometry(0.029, 0.0058, 10, 24);
  bezelGeo.rotateX(Math.PI / 2);
  const domeGeo = new THREE.SphereGeometry(0.022, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const haloGeo = new THREE.PlaneGeometry(0.24, 0.24);
  disposables.push(haloTex, bezelGeo, domeGeo, haloGeo);

  const checkpointGroup = new THREE.Group();
  root.add(checkpointGroup);

  let leds: LedVisual[] = [];
  let checkpointDisposables: { dispose: () => void }[] = [];
  let lastClearedIdx = -1;

  function setLevelCheckpoints(checkpoints: Checkpoint[]) {
    for (const d of checkpointDisposables) d.dispose();
    checkpointDisposables = [];
    checkpointGroup.clear();
    dynamicAoExcluded.length = 0;
    leds = [];
    lastClearedIdx = -1;

    for (const cp of checkpoints) {
      const qAlign = new THREE.Quaternion().setFromUnitVectors(upAxis, cp.dir);
      const baseR = cp.layer === 'pipe' ? R_PIPE_FLOOR : R_FLOOR;

      if (cp.layer === 'upper') {
        const labelTex = createDecalLabelTexture(cp.label, cp.isFinish ? 'END' : 'CHK');
        const decalGeo = buildFloorDecalPatch(cp.dir, baseR + 0.0024, 0.145);
        const decalMat = new THREE.MeshStandardMaterial({
          map: labelTex,
          transparent: true,
          roughness: 0.78,
          depthWrite: false,
        });
        const decalMesh = new THREE.Mesh(decalGeo, decalMat);
        checkpointGroup.add(decalMesh);
        dynamicAoExcluded.push(decalMesh);
        checkpointDisposables.push(labelTex, decalGeo, decalMat);
      }

      const bezel = new THREE.Mesh(bezelGeo, steelMat);
      bezel.position.copy(cp.dir).multiplyScalar(baseR + 0.002);
      bezel.quaternion.copy(qAlign);
      checkpointGroup.add(bezel);

      const domeMat = new THREE.MeshStandardMaterial({
        color: 0xffe4c4,
        emissive: new THREE.Color(0xff741e),
        emissiveIntensity: 0.7,
        roughness: 0.22,
        metalness: 0.04,
      });
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.copy(cp.dir).multiplyScalar(baseR - 0.001);
      dome.quaternion.copy(qAlign);
      checkpointGroup.add(dome);
      checkpointDisposables.push(domeMat);

      const haloMat = new THREE.MeshBasicMaterial({
        map: haloTex,
        color: 0xff8c2b,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.copy(cp.dir).multiplyScalar(baseR + 0.022);
      haloMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cp.dir);
      checkpointGroup.add(haloMesh);
      dynamicAoExcluded.push(haloMesh);
      checkpointDisposables.push(haloMat);

      leds.push({
        checkpoint: cp,
        domeMat,
        haloMat,
        haloMesh,
        localPos: cp.dir.clone().multiplyScalar(baseR + 0.075),
      });
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
        if (b.arrowMat) {
          b.arrowMat.opacity = Math.max(0, (ext - 0.35) / 0.65);
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

      // Rotate all 6 diaphragm leaves outward in unison + tuck radially into the bezel pocket!
      const pivotAngle = open * 0.96; // 55° outward camera-iris swing
      const tuckScale = 1.0 - open * 0.42; // retracts cleanly beneath the bezel collar when 100% open
      for (let k = 0; k < s.pivots.length; k++) {
        const holder = s.pivots[k];
        holder.rotation.y = pivotAngle;
        holder.scale.set(tuckScale, 1, tuckScale);
        holder.visible = open < 0.985;
      }

      // Soft mint/cyan bezel halo indicates open portal; quiet dark collar when shut
      s.ringLedMat.emissiveIntensity = open * 1.55;
      s.ringLedMat.color.setHex(open > 0.35 ? 0xd2ffed : 0x9b9488);
    }
  }

  const colorAmber = new THREE.Color(0xff6e18);
  const colorStandby = new THREE.Color(0xe69044);
  const colorCleared = new THREE.Color(0x2ce391);
  const colorFinishGlow = new THREE.Color(0x46f0a5);
  const colorPipeTarget = new THREE.Color(0x2ad9c6); // distinct crisp Scandinavian aqua-mint for under-deck pipe LEDs!

  function updateLeds(time: number, clearedMask: boolean[], nextIndex: number, allCleared: boolean) {
    let newestCleared = -1;
    for (let i = 0; i < leds.length; i++) {
      if (clearedMask[i]) newestCleared = i;
    }
    if (newestCleared !== -1) lastClearedIdx = newestCleared;

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
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
        const isPipe = led.checkpoint.layer === 'pipe';
        const col = isPipe ? colorPipeTarget : colorAmber;
        led.domeMat.color.setHex(isPipe ? 0xd0fff8 : 0xffe1c2);
        led.domeMat.emissive.copy(col);
        led.domeMat.emissiveIntensity = (isPipe ? 1.5 : 2.0) + pulse * (isPipe ? 1.1 : 1.9);
        led.haloMat.color.copy(col);
        led.haloMat.opacity = (isPipe ? 0.25 : 0.42) + pulse * (isPipe ? 0.18 : 0.32);
        led.haloMesh.scale.setScalar((isPipe ? 0.78 : 0.98) + pulse * 0.22);
      } else if (led.checkpoint.layer === 'pipe') {
        // Under-deck pipe LEDs glow cleanly aqua-mint through the transparent window panels without blowing out!
        const idle = 0.5 + 0.5 * Math.sin(time * 2.0 + i);
        led.domeMat.color.setHex(0xd6fffa);
        led.domeMat.emissive.copy(colorPipeTarget);
        led.domeMat.emissiveIntensity = 1.05 + idle * 0.45;
        led.haloMat.color.copy(colorPipeTarget);
        led.haloMat.opacity = 0.2 + idle * 0.1;
        led.haloMesh.scale.setScalar(0.75);
      } else if (led.checkpoint.isFinish) {
        const idle = 0.5 + 0.5 * Math.sin(time * 1.4);
        led.domeMat.color.setHex(0xd8ffed);
        led.domeMat.emissive.copy(colorCleared);
        led.domeMat.emissiveIntensity = 0.95 + idle * 0.45;
        led.haloMat.color.copy(colorCleared);
        led.haloMat.opacity = 0.24 + idle * 0.12;
        led.haloMesh.scale.setScalar(0.85);
      } else {
        const idle = 0.5 + 0.5 * Math.sin(time * 1.2 + i * 1.7);
        led.domeMat.color.setHex(0xf6dec4);
        led.domeMat.emissive.copy(colorStandby);
        led.domeMat.emissiveIntensity = 0.65 + idle * 0.45;
        led.haloMat.color.copy(colorStandby);
        led.haloMat.opacity = 0.18 + idle * 0.1;
        led.haloMesh.scale.setScalar(0.76);
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
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
        const col = leds[nextIndex].checkpoint.layer === 'pipe' ? colorPipeTarget : colorAmber;
        activeLight.color.copy(col);
        activeLight.position.copy(leds[nextIndex].localPos);
        activeLight.intensity = 0.85 + pulse * 0.65;
      } else {
        activeLight.intensity = 0.0;
      }

      if (lastClearedIdx >= 0 && lastClearedIdx < leds.length && clearedMask[lastClearedIdx]) {
        const isPipe = leds[lastClearedIdx].checkpoint.layer === 'pipe';
        clearedLight.color.copy(colorCleared);
        clearedLight.position.copy(leds[lastClearedIdx].localPos);
        clearedLight.intensity = isPipe ? 0.56 : 0.85;
      } else {
        // Highlight first unlit pipe LED from below so the transparent window glows gently without overexposing!
        const pipeLed = leds.find((l) => l.checkpoint.layer === 'pipe');
        if (pipeLed) {
          clearedLight.color.copy(colorPipeTarget);
          clearedLight.position.copy(pipeLed.localPos);
          clearedLight.intensity = 0.46;
        } else {
          clearedLight.intensity = 0.0;
        }
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
    for (const d of checkpointDisposables) d.dispose();
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
    setLevelCheckpoints,
    updateLeds,
    setPlasticOpacity,
    setScratchStrength,
    dispose,
  };
}
