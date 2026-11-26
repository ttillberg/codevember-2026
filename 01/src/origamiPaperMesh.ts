import * as THREE from 'three';
import {
  MM,
  type BuiltHouseNet,
  type DoorStyle,
  type FoldablePanelId,
  type HouseNetSpec,
  type PanelId,
  type PanelNetDef,
  type V2,
  type WindowStyle,
} from './origamiHouseNet';

/**
 * Dynamic pure white-on-white tactile paper 3D mesh builder with GPU perspective-exact camera projection.
 *
 * Builds ANY generated `BuiltHouseNet` (all 6 roof types, multi-story punched windows/doors/louvers,
 * plus flat-folded kirigami pop-up awnings, chimneys, and roof dormers!) and bakes every vertex's
 * exact rotated flat-sheet world position (`aFlatPos` at `fold = 0`) so live-camera anamorphic
 * projection matches 1:1 from the viewer's angle even when the newly spawned house underneath has a
 * completely different size, roof, window layout, and orientation!
 */

export const PAPER_THICK = 0.056; // 0.56 mm cotton-rag paper casting crisp minimal ridge shadows

export interface ProjectionUniforms {
  uHasProj: { value: number };
  uGroundProjAlpha: { value: number };
  uProjTex: { value: THREE.Texture | null };
  uProjMatrix: { value: THREE.Matrix4 };
}

export interface OrigamiMaterials {
  inside: THREE.MeshStandardMaterial;
  outside: THREE.MeshStandardMaterial;
  edge: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  foldLine: THREE.LineDashedMaterial;
  foldLineActive: THREE.LineBasicMaterial;
  projUniforms: ProjectionUniforms;
  setProjection(tex: THREE.Texture | null, viewProjMatrix?: THREE.Matrix4): void;
  setGroundProjectionAlpha(alpha: number): void;
  setOutsideColor(hex: string): void;
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

  ctx.lineWidth = 0.85;
  for (let k = 0; k < 640; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 5 + rand() * 18;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(218,212,200,0.14)' : 'rgba(255,255,255,0.22)';
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

function attachProjectiveShader(
  mat: THREE.MeshStandardMaterial,
  uniforms: ProjectionUniforms,
  useFlatAttr: boolean,
): void {
  mat.customProgramCacheKey = () => (useFlatAttr ? 'origami-cam-proj-house-v3' : 'origami-cam-proj-ground-v3');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHasProj = uniforms.uHasProj;
    shader.uniforms.uGroundProjAlpha = uniforms.uGroundProjAlpha;
    shader.uniforms.uProjTex = uniforms.uProjTex;
    shader.uniforms.uProjMatrix = uniforms.uProjMatrix;

    if (useFlatAttr) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aFlatPos;
varying vec3 vProjWorldPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vProjWorldPos = aFlatPos;`,
        );
    } else {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vProjWorldPos;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vProjWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
    }

    const alphaExpr = useFlatAttr ? '1.0' : 'uGroundProjAlpha';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHasProj;
uniform float uGroundProjAlpha;
uniform sampler2D uProjTex;
uniform mat4 uProjMatrix;
varying vec3 vProjWorldPos;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float projAlpha = ${alphaExpr};
if (uHasProj > 0.5 && projAlpha > 0.001) {
  vec4 pClip = uProjMatrix * vec4(vProjWorldPos, 1.0);
  if (pClip.w > 0.0001) {
    vec2 pUv = (pClip.xy / pClip.w) * 0.5 + 0.5;
    if (pUv.x > 0.002 && pUv.x < 0.998 && pUv.y > 0.002 && pUv.y < 0.998) {
      vec3 c0 = texture2D(uProjTex, vec2(0.015, 0.015)).rgb;
      vec3 c1 = texture2D(uProjTex, vec2(0.985, 0.015)).rgb;
      vec3 c2 = texture2D(uProjTex, vec2(0.015, 0.985)).rgb;
      vec3 c3 = texture2D(uProjTex, vec2(0.985, 0.985)).rgb;
      vec3 groundRef = max(vec3(0.05), max(max(c0, c1), max(c2, c3)));
      vec3 captured = texture2D(uProjTex, pUv).rgb;
      vec3 projAlbedo = clamp(captured / groundRef, vec3(0.0), vec3(1.45));
      float fx = smoothstep(0.002, 0.035, pUv.x) * smoothstep(0.002, 0.035, 1.0 - pUv.x);
      float fy = smoothstep(0.002, 0.035, pUv.y) * smoothstep(0.002, 0.035, 1.0 - pUv.y);
      diffuseColor.rgb *= mix(vec3(1.0), projAlbedo, fx * fy * projAlpha);
    }
  }
}`,
      );
  };
}

export function createOrigamiMaterials(maxAniso = 8): OrigamiMaterials {
  const tex = createWashiFiberTextures(maxAniso);
  const paperColor = new THREE.Color('#ffffff');

  const projUniforms: ProjectionUniforms = {
    uHasProj: { value: 0 },
    uGroundProjAlpha: { value: 1 },
    uProjTex: { value: null },
    uProjMatrix: { value: new THREE.Matrix4() },
  };

  const inside = new THREE.MeshStandardMaterial({
    color: paperColor,
    map: tex.map,
    bumpMap: tex.bumpMap,
    bumpScale: 0.005,
    roughness: 0.93,
    metalness: 0.0,
  });

  // Duplex Japanese origami paper:
  // - `inside` (top face when flat): pure cotton white -> melts seamlessly into the white studio sheet & carries 1:1 projections!
  // - `outside` (bottom face when flat -> exterior walls & roof when folded!): rich matte charcoal-black kuro-washi!
  const outside = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#28282b'),
    bumpMap: tex.bumpMap,
    bumpScale: 0.009,
    roughness: 0.85,
    metalness: 0.0,
  });

  const edge = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fbfaf7'),
    roughness: 0.95,
    metalness: 0.0,
  });

  const groundTex = tex.map.clone();
  groundTex.needsUpdate = true;
  // Matches house paper fiber scale (0.16 / 0.28 per world unit) across a generous 900x900 seamless sheet
  groundTex.repeat.set(144, 144);
  const groundBump = tex.bumpMap.clone();
  groundBump.needsUpdate = true;
  groundBump.repeat.set(252, 252);

  const ground = new THREE.MeshStandardMaterial({
    color: paperColor,
    map: groundTex,
    bumpMap: groundBump,
    bumpScale: 0.004,
    roughness: 0.93,
    metalness: 0.0,
  });

  attachProjectiveShader(inside, projUniforms, true);
  attachProjectiveShader(edge, projUniforms, true);
  attachProjectiveShader(ground, projUniforms, false);

  const foldLine = new THREE.LineDashedMaterial({
    color: 0x8f8c86,
    dashSize: 0.24,
    gapSize: 0.20,
    transparent: true,
    opacity: 0.14,
  });

  const foldLineActive = new THREE.LineBasicMaterial({
    color: 0x3a3835,
    transparent: true,
    opacity: 0.45,
  });

  return {
    inside,
    outside,
    edge,
    ground,
    foldLine,
    foldLineActive,
    projUniforms,
    setProjection(nextTex: THREE.Texture | null, viewProjMatrix?: THREE.Matrix4) {
      if (nextTex && viewProjMatrix) {
        projUniforms.uProjTex.value = nextTex;
        projUniforms.uProjMatrix.value.copy(viewProjMatrix);
        projUniforms.uHasProj.value = 1;
        projUniforms.uGroundProjAlpha.value = 1;
      } else {
        projUniforms.uHasProj.value = 0;
        projUniforms.uGroundProjAlpha.value = 0;
        projUniforms.uProjTex.value = null;
      }
    },
    setGroundProjectionAlpha(alpha: number) {
      projUniforms.uGroundProjAlpha.value = Math.max(0, Math.min(1, alpha));
    },
    setOutsideColor(hex: string) {
      outside.color.set(hex);
    },
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
 * Extrude flat XZ paper geometry into 3 non-overlapping material groups AND bake each vertex's
 * exact world-space position at `fold = 0` (including the house's `yawOffset` Y-rotation!) into `aFlatPos`.
 */
function buildDualSidedPaperGeometry(
  shape: THREE.Shape,
  flatOriginX: number,
  flatOriginZ: number,
  yawOffset: number,
  flatOriginY = PAPER_THICK,
  thick = PAPER_THICK,
): THREE.BufferGeometry {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: false,
    curveSegments: 14,
  });
  raw.translate(0, 0, -thick);
  raw.rotateX(-Math.PI * 0.5);

  const nonIdx = raw.index ? raw.toNonIndexed() : raw;
  nonIdx.computeVertexNormals();

  const pos = nonIdx.attributes.position;
  const nrm = nonIdx.attributes.normal;
  const triCount = pos.count / 3;

  const cy = Math.cos(yawOffset);
  const sy = Math.sin(yawOffset);

  const buckets: [number[], number[], number[]] = [[], [], []];
  const nBuckets: [number[], number[], number[]] = [[], [], []];
  const uvBuckets: [number[], number[], number[]] = [[], [], []];
  const flatBuckets: [number[], number[], number[]] = [[], [], []];

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3;
    const ny = (nrm.getY(i0) + nrm.getY(i0 + 1) + nrm.getY(i0 + 2)) / 3;
    const g = ny > 0.5 ? 0 : ny < -0.5 ? 2 : 1;

    for (let k = 0; k < 3; k++) {
      const idx = i0 + k;
      const vx = pos.getX(idx);
      const vy = pos.getY(idx);
      const vz = pos.getZ(idx);

      // Exact unrotated flat coordinates inside house root, then rotated by `yawOffset` around Y!
      const ux = flatOriginX + vx;
      const uy = flatOriginY + vy;
      const uz = flatOriginZ + vz;
      const wx = ux * cy + uz * sy;
      const wz = -ux * sy + uz * cy;

      buckets[g].push(vx, vy, vz);
      nBuckets[g].push(nrm.getX(idx), nrm.getY(idx), nrm.getZ(idx));
      uvBuckets[g].push(ux, uz);
      flatBuckets[g].push(wx, uy, wz);
    }
  }

  const totalFloats = buckets[0].length + buckets[1].length + buckets[2].length;
  const finalPos = new Float32Array(totalFloats);
  const finalNrm = new Float32Array(totalFloats);
  const finalUv = new Float32Array((totalFloats / 3) * 2);
  const finalFlat = new Float32Array(totalFloats);

  const out = new THREE.BufferGeometry();
  let vOffset = 0;
  for (let g = 0; g < 3; g++) {
    const count = buckets[g].length / 3;
    if (count > 0) {
      finalPos.set(buckets[g], vOffset * 3);
      finalNrm.set(nBuckets[g], vOffset * 3);
      finalUv.set(uvBuckets[g], vOffset * 2);
      finalFlat.set(flatBuckets[g], vOffset * 3);
      out.addGroup(vOffset, count, g);
      vOffset += count;
    }
  }

  out.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(finalNrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(finalUv, 2));
  out.setAttribute('aFlatPos', new THREE.BufferAttribute(finalFlat, 3));

  if (nonIdx !== raw) nonIdx.dispose();
  raw.dispose();
  return out;
}

// ----------------------------------------------------------------------------
// Parametric Punched Window, Door, Oculus & Belfry Louver Cutouts (Universal 2D Wall Frame!)
// ----------------------------------------------------------------------------
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

type FrameMapper = (uMm: number, vMm: number) => [number, number];

function addFramedRectHole(
  shape: THREE.Shape,
  toShape: FrameMapper,
  uCenter: number,
  vCenter: number,
  wMm: number,
  hMm: number,
): void {
  const hw = wMm * 0.5;
  const hh = hMm * 0.5;
  const pts: [number, number][] = [
    toShape(uCenter - hw, vCenter - hh),
    toShape(uCenter + hw, vCenter - hh),
    toShape(uCenter + hw, vCenter + hh),
    toShape(uCenter - hw, vCenter + hh),
  ];
  const p = new THREE.Path();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.closePath();
  shape.holes.push(p);
}

function addFramedArchHole(
  shape: THREE.Shape,
  toShape: FrameMapper,
  uCenter: number,
  vBase: number,
  wMm: number,
  hMm: number,
): void {
  const hw = wMm * 0.5;
  const r = Math.min(hw, hMm * 0.42);
  const springV = vBase + (hMm - r);
  const p = new THREE.Path();
  const [x0, y0] = toShape(uCenter - hw, vBase);
  const [x1, y1] = toShape(uCenter + hw, vBase);
  const [x2, y2] = toShape(uCenter + hw, springV);
  p.moveTo(x0, y0);
  p.lineTo(x1, y1);
  p.lineTo(x2, y2);
  const segs = 12;
  for (let i = 1; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    const [ax, ay] = toShape(uCenter + Math.cos(a) * r, springV + Math.sin(a) * r);
    p.lineTo(ax, ay);
  }
  p.lineTo(x0, y0);
  p.closePath();
  shape.holes.push(p);
}

function addFramedCircleHole(
  shape: THREE.Shape,
  toShape: FrameMapper,
  uCenter: number,
  vCenter: number,
  rMm: number,
): void {
  const p = new THREE.Path();
  const segs = 20;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const [cx, cy] = toShape(uCenter + Math.cos(a) * rMm, vCenter + Math.sin(a) * rMm);
    if (i === 0) p.moveTo(cx, cy);
    else p.lineTo(cx, cy);
  }
  p.closePath();
  shape.holes.push(p);
}

/**
 * Punch crisp multi-story architectural windows, doorways, arcades, attic oculi & belfry louvers
 * directly into ANY wall panel using its sheet-space `wallFrame` (works across cross, ribbon, and polygonal nets!).
 */
function punchWallOpenings(
  shape: THREE.Shape,
  def: PanelNetDef,
  spec: HouseNetSpec,
  roofRise: number,
): void {
  const wf = def.wallFrame;
  if (!wf) return;

  const isFront = Boolean(def.isFront || def.id === 'front');
  const isGableEnd = Boolean(def.isGableEnd || def.id === 'front' || def.id === 'back');
  const wallLenMm = wf.widthMm;
  const wallH = wf.heightMm;
  const levels = spec.levels;
  const storyH = wallH / levels;

  const toShape: FrameMapper = (uMm, vMm) => [
    (wf.origin[0] + uMm * wf.uAxis[0] + vMm * wf.vAxis[0] - def.hingeOrigin[0]) * MM,
    (wf.origin[1] + uMm * wf.uAxis[1] + vMm * wf.vAxis[1] - def.hingeOrigin[1]) * MM,
  ];

  for (let li = 0; li < levels; li++) {
    const baseH = li * storyH;
    const isGround = li === 0;
    const isTop = li === levels - 1;

    // On tall spire bell towers / octagonal lighthouses, punch crisp horizontal belfry louver slots on top level!
    if (isTop && spec.hasBelfry && wallH >= 36) {
      const slotW = Math.max(6.5, wallLenMm - Math.min(10, wallLenMm * 0.34));
      const slotH = Math.min(3.2, storyH * 0.22);
      const y1 = baseH + storyH * 0.36;
      const y2 = baseH + storyH * 0.68;
      addFramedRectHole(shape, toShape, 0, y1, slotW, slotH);
      addFramedRectHole(shape, toShape, 0, y2, slotW, slotH);
      continue;
    }

    // Ground-floor arched arcade on wide front facade
    if (isGround && isFront && spec.door === 'arcade' && wallLenMm >= 38) {
      const count = Math.max(3, Math.min(5, Math.floor((wallLenMm - 8) / 10)));
      const margin = 4.5;
      const pitch = (wallLenMm - margin * 2) / count;
      const aw = Math.min(pitch * 0.66, 7.6);
      const ah = Math.min(storyH * 0.68, 13.8);
      for (let k = 0; k < count; k++) {
        const u = -wallLenMm * 0.5 + margin + pitch * (k + 0.5);
        addFramedArchHole(shape, toShape, u, 0.8, aw, ah);
      }
      continue;
    }

    const style: WindowStyle = isGround ? spec.windowGround : spec.windowUpper;
    const baySpacing = style === 'ribbon' ? 15.5 : style === 'pair' ? 14.5 : 12.2;
    // Allow single centered architectural bay on narrower hexagonal/octagonal facets (`wallLenMm < 26`)!
    let bays =
      wallLenMm < 26
        ? 1
        : Math.max(2, Math.min(5, Math.floor((wallLenMm - 6) / baySpacing)));
    if (isFront && isGround && spec.door !== 'none' && bays % 2 === 0) {
      // Keep doorway strictly centered (`u = 0`, aligned beneath front awning!)
      bays = wallLenMm >= 28 ? Math.min(5, bays + 1) : 1;
    }
    const margin = wallLenMm < 26 ? Math.max(3.2, wallLenMm * 0.16) : Math.max(4.5, Math.min(7.5, wallLenMm * 0.13));
    const usable = Math.max(8, wallLenMm - margin * 2);
    const cellW = usable / bays;
    const doorIdx = isFront && isGround && spec.door !== 'none' ? Math.floor(bays / 2) : -1;

    for (let b = 0; b < bays; b++) {
      const u = -wallLenMm * 0.5 + margin + cellW * (b + 0.5);

      if (b === doorIdx) {
        const dw = Math.min(cellW * 0.66, spec.door === 'double' ? 9.6 : 7.8);
        const dh = Math.min(storyH * 0.66, 13.8);
        if (spec.door === 'arched') {
          addFramedArchHole(shape, toShape, u, 0.6, dw, dh);
        } else {
          addFramedRectHole(shape, toShape, u, 0.6 + dh * 0.5, dw, dh);
        }
        continue;
      }

      if (style === 'pair' && cellW >= 11) {
        const pw = Math.min(cellW * 0.30, 3.8);
        const ph = Math.min(storyH * 0.48, 8.2);
        const gap = Math.max(1.4, pw * 0.32);
        const vh = baseH + storyH * 0.52;
        for (const sgn of [-1, 1]) {
          addFramedRectHole(shape, toShape, u + sgn * (pw * 0.5 + gap * 0.5), vh, pw, ph);
        }
        continue;
      }

      const ww =
        style === 'ribbon'
          ? Math.min(cellW * 0.78, 12.5)
          : style === 'tall'
            ? Math.min(cellW * 0.48, 5.4)
            : Math.min(cellW * 0.52, 6.8);
      const wh =
        style === 'tall'
          ? Math.min(storyH * 0.60, 10.6)
          : style === 'ribbon'
            ? Math.min(storyH * 0.36, 5.6)
            : Math.min(storyH * 0.46, 8.2);

      if (ww < 2.6 || wh < 3.0) continue;
      const vh = baseH + storyH * (style === 'tall' ? 0.50 : 0.52);

      if (style === 'arched') {
        addFramedArchHole(shape, toShape, u, vh - wh * 0.5, ww, wh);
      } else {
        addFramedRectHole(shape, toShape, u, vh, ww, wh);
      }
    }
  }

  // Crisp attic circular oculus in front & back gable triangles!
  if (spec.roofType === 'gable' && isGableEnd && spec.hasOculus && roofRise >= 11) {
    const r = Math.min(roofRise * 0.17, spec.W * 0.085, 3.8);
    if (r >= 2.0) {
      addFramedCircleHole(shape, toShape, 0, spec.H + roofRise * 0.43, r);
    }
  }
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
  stage: PanelNetDef['stage'];
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  foldLine: THREE.Line;
  hingeAxis3D: THREE.Vector3;
  targetAngle: number;
}

export interface KirigamiDetailRig {
  pivot: THREE.Group;
  axis: 'x' | 'z';
  /** Angle when flat (`0`) -> popped into 3D (`targetAngle`) */
  targetAngle: number;
  /** Which parent panel fold drives this detail popping upright */
  driverPanel: FoldablePanelId;
}

export interface OrigamiHouseRig {
  net: BuiltHouseNet;
  root: THREE.Group;
  baseMesh: THREE.Mesh;
  panelIds: FoldablePanelId[];
  panels: Map<FoldablePanelId, PanelVisual>;
  details: KirigamiDetailRig[];
  updatePanelVisual(id: FoldablePanelId, fold01: number, peekRad: number, hovered: boolean): void;
  setFoldLinesVisible(visible: boolean): void;
  setPaperRelief(relief01: number): void;
  dispose(): void;
}

export function buildOrigamiHouseRig(net: BuiltHouseNet, mats: OrigamiMaterials): OrigamiHouseRig {
  const { spec, roofRise } = net;
  const root = new THREE.Group();
  root.position.y = PAPER_THICK;
  root.rotation.y = spec.yawOffset;

  const triMats = [mats.inside, mats.edge, mats.outside];
  const exteriorDetailMats = [mats.outside, mats.edge, mats.outside];
  const groupByPanel = new Map<PanelId, THREE.Group>();
  const panels = new Map<FoldablePanelId, PanelVisual>();
  const details: KirigamiDetailRig[] = [];

  const makeFoldLine = (a: [number, number, number], b: [number, number, number]): THREE.Line => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...a),
      new THREE.Vector3(...b),
    ]);
    const line = new THREE.Line(g, mats.foldLine);
    line.computeLineDistances();
    return line;
  };

  let baseMesh!: THREE.Mesh;

  // Build every panel in parent -> child order
  const allMeshes: THREE.Mesh[] = [];
  for (const def of net.panels) {
    const shape = makeLocalShape(def.poly, def.hingeOrigin[0], def.hingeOrigin[1]);
    punchWallOpenings(shape, def, spec, roofRise);

    // Crisp architectural skylight in mansard / polygonal pavilion top deck:
    // circular Pantheon oculus for hexagonal/octagonal caps, rectangular skylight for mansards!
    if (def.id === 'roofCap') {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let sumX = 0, sumY = 0;
      for (const [px, py] of def.poly) {
        const lx = (px - def.hingeOrigin[0]) * MM;
        const ly = (py - def.hingeOrigin[1]) * MM;
        sumX += lx;
        sumY += ly;
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
      }
      const capW = maxX - minX;
      const capD = maxY - minY;
      if (def.poly.length >= 6) {
        const cx = sumX / def.poly.length;
        const cy = sumY / def.poly.length;
        const r = Math.min(capW, capD) * 0.24;
        if (r > 0.22) {
          const p = new THREE.Path();
          p.absarc(cx, cy, r, 0, Math.PI * 2, false);
          shape.holes.push(p);
        }
      } else if (capW > 1.4 && capD > 1.4) {
        addRectHole(shape, (minX + maxX) * 0.5, (minY + maxY) * 0.5, capW * 0.42, capD * 0.42);
      }
    }

    const flatOriginX = def.hingeOrigin[0] * MM;
    const flatOriginZ = -def.hingeOrigin[1] * MM;
    const geo = buildDualSidedPaperGeometry(shape, flatOriginX, flatOriginZ, spec.yawOffset);
    const mesh = new THREE.Mesh(geo, triMats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'panel', id: def.id };
    allMeshes.push(mesh);

    if (def.id === 'base') {
      baseMesh = mesh;
      root.add(baseMesh);
      groupByPanel.set('base', root);
      continue;
    }

    const parentDef = net.panelMap.get(def.parent!)!;
    const parentGroup = groupByPanel.get(def.parent!)!;

    const pivot = new THREE.Group();
    pivot.position.set(
      (def.hingeOrigin[0] - parentDef.hingeOrigin[0]) * MM,
      0,
      -(def.hingeOrigin[1] - parentDef.hingeOrigin[1]) * MM,
    );
    parentGroup.add(pivot);
    pivot.add(mesh);

    let foldLine: THREE.Line;
    if (def.crease) {
      const [ca, cb] = def.crease;
      foldLine = makeFoldLine(
        [(ca[0] - def.hingeOrigin[0]) * MM, 0.004, -(ca[1] - def.hingeOrigin[1]) * MM],
        [(cb[0] - def.hingeOrigin[0]) * MM, 0.004, -(cb[1] - def.hingeOrigin[1]) * MM],
      );
    } else {
      foldLine = makeFoldLine([0, 0.004, 0], [0, 0.004, 0]);
    }
    pivot.add(foldLine);

    groupByPanel.set(def.id, pivot);
    const hingeAxis3D = new THREE.Vector3(def.hingeAxis[0], 0, -def.hingeAxis[1]).normalize();
    panels.set(def.id, {
      id: def.id,
      stage: def.stage,
      pivot,
      mesh,
      foldLine,
      hingeAxis3D,
      targetAngle: def.targetAngle,
    });
  }

  // ---- Flat-Folded Kirigami Architectural Details (Awning, Chimney, Roof Dormers!) ----
  // Every detail mounts via `wallFrame` / `roofFrame`, working identically on cross, ribbon, and polygonal nets!

  // A. Front entry paper canopy awning (hinged right above front doorway, sweeps 98° outward with gentle rain slope!)
  const frontDef = net.panels.find((p) => p.isFront) ?? net.panelMap.get('front');
  const frontPv = frontDef ? panels.get(frontDef.id) : undefined;
  if (spec.hasAwning && frontPv && frontDef?.wallFrame && spec.door !== 'none' && spec.door !== 'arcade') {
    const wf = frontDef.wallFrame;
    const storyH = wf.heightMm / spec.levels;
    const awningYmm = Math.min(storyH * 0.72, 15.2);
    const awW = Math.min(wf.widthMm * 0.42, 15.5);
    const awD = Math.min(6.4, Math.max(4.4, wf.widthMm * 0.14));

    const sx = wf.origin[0] + wf.vAxis[0] * awningYmm;
    const sy = wf.origin[1] + wf.vAxis[1] * awningYmm;
    const frameGroup = new THREE.Group();
    frameGroup.position.set(
      (sx - frontDef.hingeOrigin[0]) * MM,
      -PAPER_THICK,
      -(sy - frontDef.hingeOrigin[1]) * MM,
    );
    // Align frameGroup local +Z with wall up-vector `v3 = (vAxis[0], 0, -vAxis[1])`!
    frameGroup.rotation.y = Math.atan2(wf.vAxis[0], -wf.vAxis[1]);
    frontPv.pivot.add(frameGroup);

    const aPivot = new THREE.Group();
    frameGroup.add(aPivot);

    const aShape = new THREE.Shape();
    aShape.moveTo(-awW * 0.5 * MM, 0);
    aShape.lineTo(awW * 0.5 * MM, 0);
    aShape.lineTo(awW * 0.5 * MM, -awD * MM);
    aShape.lineTo(-awW * 0.5 * MM, -awD * MM);
    aShape.closePath();

    const aGeo = buildDualSidedPaperGeometry(aShape, sx * MM, -sy * MM, spec.yawOffset, 0, PAPER_THICK * 0.75);
    const aMesh = new THREE.Mesh(aGeo, exteriorDetailMats);
    aMesh.castShadow = true;
    aMesh.receiveShadow = true;
    allMeshes.push(aMesh);
    aPivot.add(aMesh);

    details.push({
      pivot: aPivot,
      axis: 'x',
      targetAngle: 1.72,
      driverPanel: frontDef.id,
    });
  }

  // B. Kirigami folded L-corner 3D chimney stack on roof (placed on `roofL` when `roofR` has dormers!)
  const wantsDormersOnR =
    spec.dormerCount > 0 && panels.has('roofR') && (spec.roofType === 'gable' || spec.roofType === 'mansard');
  const chimneyHostId: FoldablePanelId | null = wantsDormersOnR
    ? panels.has('roofL')
      ? 'roofL'
      : 'roofR'
    : panels.has('roofR')
      ? 'roofR'
      : panels.has('roofL')
        ? 'roofL'
        : null;
  const chimneyHost = chimneyHostId ? panels.get(chimneyHostId) : undefined;
  const chimneyDef = chimneyHostId ? net.panelMap.get(chimneyHostId) : undefined;
  if (spec.hasChimney && chimneyHost && chimneyHostId && chimneyDef?.roofFrame) {
    const rf = chimneyDef.roofFrame;
    const chW = Math.min(6.4, Math.max(4.4, rf.widthMm * 0.085));
    const chH =
      spec.roofType === 'flat'
        ? Math.min(10.5, Math.max(7.2, spec.H * 0.2))
        : Math.min(12.5, Math.max(8.2, rf.slantMm * 0.34));
    const offSlope = Math.min(rf.slantMm * 0.46, Math.max(10.5, rf.slantMm * 0.36));
    const offRidge = -rf.widthMm * 0.20;

    const sx = rf.origin[0] + rf.slopeAxis[0] * offSlope + rf.ridgeAxis[0] * offRidge;
    const sy = rf.origin[1] + rf.slopeAxis[1] * offSlope + rf.ridgeAxis[1] * offRidge;

    const frameGroup = new THREE.Group();
    frameGroup.position.set(
      (sx - chimneyDef.hingeOrigin[0]) * MM,
      -PAPER_THICK,
      -(sy - chimneyDef.hingeOrigin[1]) * MM,
    );
    // Align frameGroup local +X with roof up-slope `s3 = (slopeAxis[0], 0, -slopeAxis[1])`!
    frameGroup.rotation.y = Math.atan2(rf.slopeAxis[1], rf.slopeAxis[0]);
    chimneyHost.pivot.add(frameGroup);

    const cPivot = new THREE.Group();
    frameGroup.add(cPivot);

    const cShape = new THREE.Shape();
    cShape.moveTo(0, -chW * 0.5 * MM);
    cShape.lineTo(chH * MM, -chW * 0.5 * MM);
    cShape.lineTo(chH * MM, chW * 0.5 * MM);
    cShape.lineTo(0, chW * 0.5 * MM);
    cShape.closePath();

    const cGeo = buildDualSidedPaperGeometry(cShape, sx * MM, -sy * MM, spec.yawOffset, 0, PAPER_THICK * 0.85);
    const cMesh = new THREE.Mesh(cGeo, exteriorDetailMats);
    cMesh.castShadow = true;
    cMesh.receiveShadow = true;
    allMeshes.push(cMesh);
    cPivot.add(cMesh);

    const cheekPivot = new THREE.Group();
    cheekPivot.position.set(0, 0, chW * 0.5 * MM);
    cPivot.add(cheekPivot);

    const cheekShape = new THREE.Shape();
    cheekShape.moveTo(0, 0);
    cheekShape.lineTo(chH * MM, 0);
    cheekShape.lineTo(chH * MM, -chW * 0.85 * MM);
    cheekShape.lineTo(0, -chW * 0.85 * MM);
    cheekShape.closePath();

    const cheekGeo = buildDualSidedPaperGeometry(
      cheekShape,
      sx * MM,
      -sy * MM + chW * 0.5 * MM,
      spec.yawOffset,
      0,
      PAPER_THICK * 0.85,
    );
    const cheekMesh = new THREE.Mesh(cheekGeo, exteriorDetailMats);
    cheekMesh.castShadow = true;
    cheekMesh.receiveShadow = true;
    allMeshes.push(cheekMesh);
    cheekPivot.add(cheekMesh);

    details.push({
      pivot: cPivot,
      axis: 'z',
      targetAngle: spec.roofType === 'flat' ? -Math.PI * 0.5 : -(Math.PI * 0.5 - spec.pitch),
      driverPanel: chimneyHostId,
    });
    details.push({
      pivot: cheekPivot,
      axis: 'x',
      targetAngle: -Math.PI * 0.5,
      driverPanel: chimneyHostId,
    });
  }

  // C. Kirigami pop-up roof dormers on `roofR` (gable & mansard, safely clamped inside trapezoid top!)
  const dormerHost = panels.get('roofR');
  const dormerDef = net.panelMap.get('roofR');
  if (wantsDormersOnR && dormerHost && dormerDef?.roofFrame) {
    const rf = dormerDef.roofFrame;
    const dW = Math.min(9.4, Math.max(6.8, rf.widthMm * 0.125));
    const dH = Math.min(rf.slantMm * 0.34, Math.max(7.2, spec.H * 0.24));
    const offSlope = Math.min(rf.slantMm * 0.26, Math.max(6.5, rf.slantMm * 0.22));
    const topHalfD =
      spec.roofType === 'mansard'
        ? Math.max(0, rf.widthMm * 0.5 - Math.min(spec.W, spec.D) * 0.5 * (1 - spec.mansardRatio))
        : rf.widthMm * 0.5;
    const safeHalfR = topHalfD - dW * 0.72;
    const ridgePositions =
      spec.dormerCount === 2 && safeHalfR >= dW * 0.78
        ? [-Math.min(rf.widthMm * 0.21, safeHalfR), Math.min(rf.widthMm * 0.21, safeHalfR)]
        : [0];

    for (const offR of ridgePositions) {
      const sx = rf.origin[0] + rf.slopeAxis[0] * offSlope + rf.ridgeAxis[0] * offR;
      const sy = rf.origin[1] + rf.slopeAxis[1] * offSlope + rf.ridgeAxis[1] * offR;

      const frameGroup = new THREE.Group();
      frameGroup.position.set(
        (sx - dormerDef.hingeOrigin[0]) * MM,
        -PAPER_THICK,
        -(sy - dormerDef.hingeOrigin[1]) * MM,
      );
      frameGroup.rotation.y = Math.atan2(rf.slopeAxis[1], rf.slopeAxis[0]);
      dormerHost.pivot.add(frameGroup);

      const dPivot = new THREE.Group();
      frameGroup.add(dPivot);

      const dShape = new THREE.Shape();
      dShape.moveTo(0, -dW * 0.5 * MM);
      dShape.lineTo(dH * 0.72 * MM, -dW * 0.5 * MM);
      dShape.lineTo(dH * MM, 0);
      dShape.lineTo(dH * 0.72 * MM, dW * 0.5 * MM);
      dShape.lineTo(0, dW * 0.5 * MM);
      dShape.closePath();
      addRectHole(dShape, dH * 0.38 * MM, 0, dH * 0.40 * MM, dW * 0.44 * MM);

      const dGeo = buildDualSidedPaperGeometry(dShape, sx * MM, -sy * MM, spec.yawOffset, 0, PAPER_THICK * 0.8);
      const dMesh = new THREE.Mesh(dGeo, exteriorDetailMats);
      dMesh.castShadow = true;
      dMesh.receiveShadow = true;
      allMeshes.push(dMesh);
      dPivot.add(dMesh);

      details.push({
        pivot: dPivot,
        axis: 'z',
        targetAngle: -(Math.PI * 0.5 - spec.pitch),
        driverPanel: 'roofR',
      });
    }
  }

  let linesAllowed = true;

  const updatePanelVisual = (
    id: FoldablePanelId,
    fold01: number,
    peekRad: number,
    hovered: boolean,
  ) => {
    const pv = panels.get(id);
    if (!pv) return;
    const baseAngle = Math.max(0, Math.min(1, fold01)) * pv.targetAngle;
    const effective = Math.max(0, Math.min(pv.targetAngle + 0.04, baseAngle + peekRad));
    pv.pivot.quaternion.setFromAxisAngle(pv.hingeAxis3D, effective);

    pv.foldLine.material = hovered ? mats.foldLineActive : mats.foldLine;
    pv.foldLine.visible = linesAllowed && (fold01 < 0.96 || hovered);

    // Drive any attached kirigami pop-up details smoothly as their host panel folds shut!
    for (const det of details) {
      if (det.driverPanel !== id) continue;
      // Pop details gently during the second half of the host panel's fold (`0.35 -> 1.0`)
      const dt = Math.max(0, Math.min(1, (fold01 - 0.35) / 0.65));
      const eased = dt * dt * (3 - 2 * dt);
      const ang = det.targetAngle * eased;
      if (det.axis === 'x') det.pivot.rotation.x = ang;
      else det.pivot.rotation.z = ang;
    }
  };

  const setFoldLinesVisible = (visible: boolean) => {
    linesAllowed = visible;
    panels.forEach((pv) => {
      if (!visible) pv.foldLine.visible = false;
    });
  };

  // Controls flat-sheet paper thickness & edge-shadow relief:
  // 0 on the exact projection swap frame -> 100% invisible cut edges (ZERO transition!),
  // smoothly rising to 1 the moment the user hovers, orbits, or folds!
  const setPaperRelief = (relief01: number) => {
    const r = Math.max(0, Math.min(1, relief01));
    const sy = 0.02 + 0.98 * r;
    root.scale.y = sy;
    root.position.y = PAPER_THICK * sy;
    const cast = r > 0.14;
    for (const m of allMeshes) {
      m.castShadow = cast;
    }
  };

  return {
    net,
    root,
    baseMesh,
    panelIds: net.foldableIds,
    panels,
    details,
    updatePanelVisual,
    setFoldLinesVisible,
    setPaperRelief,
    dispose() {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
        }
      });
    },
  };
}
