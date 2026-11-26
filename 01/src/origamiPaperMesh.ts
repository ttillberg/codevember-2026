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
// Parametric Punched Window, Door, Oculus & Belfry Louver Cutouts
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

function addArchHole(
  shape: THREE.Shape,
  cx: number,
  yBase: number,
  w: number,
  h: number,
  dir: 1 | -1,
  horizontalWall: boolean,
): void {
  const hw = w * 0.5;
  const r = Math.min(hw, h * 0.42);
  const p = new THREE.Path();

  if (horizontalWall) {
    // Wall extends along +/-Y (front = -1, back = +1); width along X
    const springY = yBase + dir * (h - r);
    p.moveTo(cx - hw, yBase);
    p.lineTo(cx + hw, yBase);
    p.lineTo(cx + hw, springY);
    if (dir < 0) {
      p.absarc(cx, springY, r, 0, -Math.PI, true);
    } else {
      p.absarc(cx, springY, r, 0, Math.PI, false);
    }
    p.lineTo(cx - hw, yBase);
  } else {
    // Wall extends along +/-X (left = -1, right = +1); width along Y (cx is Y center, yBase is X base!)
    const springX = yBase + dir * (h - r);
    p.moveTo(yBase, cx - hw);
    p.lineTo(yBase, cx + hw);
    p.lineTo(springX, cx + hw);
    if (dir < 0) {
      p.absarc(springX, cx, r, Math.PI * 0.5, Math.PI * 1.5, false);
    } else {
      p.absarc(springX, cx, r, Math.PI * 0.5, -Math.PI * 0.5, true);
    }
    p.lineTo(yBase, cx - hw);
  }

  p.closePath();
  shape.holes.push(p);
}

function addCircleHole(shape: THREE.Shape, cx: number, cy: number, r: number): void {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  shape.holes.push(p);
}

/**
 * Punch crisp multi-story architectural windows, doorways, arcades, attic oculi & belfry louvers
 * directly into a wall panel's 2D Shape (in world units = mm * MM).
 */
function punchWallOpenings(
  shape: THREE.Shape,
  panelId: PanelId,
  spec: HouseNetSpec,
  roofRise: number,
): void {
  const isFront = panelId === 'front';
  const isBack = panelId === 'back';
  const isLeft = panelId === 'left';
  const isRight = panelId === 'right';
  if (!isFront && !isBack && !isLeft && !isRight) return;

  const horizontalWall = isFront || isBack;
  const dir: 1 | -1 = isFront || isLeft ? -1 : 1;
  const wallLenMm = horizontalWall ? spec.W : spec.D;
  // On shed roofs, the high right wall has full height H + roofRise; front/back slope from H to H+roofRise!
  const wallH = isRight && spec.roofType === 'shed' ? spec.H + roofRise : spec.H;
  const levels = spec.levels;
  const storyH = wallH / levels;

  // Punch openings story by story (`li = 0 .. levels - 1`)
  for (let li = 0; li < levels; li++) {
    const baseH = li * storyH;
    const isGround = li === 0;
    const isTop = li === levels - 1;

    // On tall spire bell towers, punch iconic horizontal belfry louver slots on the top level!
    if (isTop && spec.hasBelfry && wallH >= 36) {
      const slotW = Math.max(8, wallLenMm - 10);
      const slotH = Math.min(3.2, storyH * 0.22);
      const y1 = baseH + storyH * 0.36;
      const y2 = baseH + storyH * 0.68;
      if (horizontalWall) {
        addRectHole(shape, 0, dir * y1 * MM, slotW * MM, slotH * MM);
        addRectHole(shape, 0, dir * y2 * MM, slotW * MM, slotH * MM);
      } else {
        addRectHole(shape, dir * y1 * MM, 0, slotH * MM, slotW * MM);
        addRectHole(shape, dir * y2 * MM, 0, slotH * MM, slotW * MM);
      }
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
        addArchHole(shape, u * MM, dir * 0.8 * MM, aw * MM, ah * MM, dir, true);
      }
      continue;
    }

    const style: WindowStyle = isGround ? spec.windowGround : spec.windowUpper;
    const baySpacing = style === 'ribbon' ? 15.5 : style === 'pair' ? 14.5 : 12.2;
    let bays = Math.max(2, Math.min(5, Math.floor((wallLenMm - 6) / baySpacing)));
    if (isFront && isGround && spec.door !== 'none' && bays % 2 === 0 && wallLenMm >= 34) {
      bays = Math.min(5, bays + 1); // Center doorway symmetrically!
    }
    const margin = Math.max(4.5, Math.min(7.5, wallLenMm * 0.13));
    const usable = Math.max(10, wallLenMm - margin * 2);
    const cellW = usable / bays;
    const doorIdx = isFront && isGround && spec.door !== 'none' ? Math.floor(bays / 2) : -1;

    for (let b = 0; b < bays; b++) {
      const u = -wallLenMm * 0.5 + margin + cellW * (b + 0.5);

      // Doorway bay
      if (b === doorIdx) {
        const dw = Math.min(cellW * 0.66, spec.door === 'double' ? 9.6 : 7.8);
        const dh = Math.min(storyH * 0.66, 13.8);
        if (spec.door === 'arched') {
          addArchHole(shape, u * MM, dir * 0.6 * MM, dw * MM, dh * MM, dir, true);
        } else {
          addRectHole(shape, u * MM, dir * (0.6 + dh * 0.5) * MM, dw * MM, dh * MM);
        }
        continue;
      }

      if (style === 'pair' && cellW >= 11) {
        const pw = Math.min(cellW * 0.30, 3.8);
        const ph = Math.min(storyH * 0.48, 8.2);
        const gap = Math.max(1.4, pw * 0.32);
        const vh = baseH + storyH * 0.52;
        for (const sgn of [-1, 1]) {
          const pu = u + sgn * (pw * 0.5 + gap * 0.5);
          if (horizontalWall) addRectHole(shape, pu * MM, dir * vh * MM, pw * MM, ph * MM);
          else addRectHole(shape, dir * vh * MM, pu * MM, ph * MM, pw * MM);
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
        addArchHole(shape, u * MM, dir * (vh - wh * 0.5) * MM, ww * MM, wh * MM, dir, horizontalWall);
      } else if (horizontalWall) {
        addRectHole(shape, u * MM, dir * vh * MM, ww * MM, wh * MM);
      } else {
        addRectHole(shape, dir * vh * MM, u * MM, wh * MM, ww * MM);
      }
    }
  }

  // Crisp attic circular oculus in front & back gable triangles!
  if (spec.roofType === 'gable' && horizontalWall && spec.hasOculus && roofRise >= 11) {
    const r = Math.min(roofRise * 0.17, spec.W * 0.085, 3.8);
    if (r >= 2.0) {
      addCircleHole(shape, 0, dir * (spec.H + roofRise * 0.43) * MM, r * MM);
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
  axis: 'x' | 'z';
  sign: 1 | -1;
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
    punchWallOpenings(shape, def.id, spec, roofRise);

    // Subtle crisp architectural skylight opening in the center of a mansard top deck!
    if (def.id === 'roofCap') {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [px, py] of def.poly) {
        const lx = (px - def.hingeOrigin[0]) * MM;
        const ly = (py - def.hingeOrigin[1]) * MM;
        if (lx < minX) minX = lx;
        if (lx > maxX) maxX = lx;
        if (ly < minY) minY = ly;
        if (ly > maxY) maxY = ly;
      }
      const capW = maxX - minX;
      const capD = maxY - minY;
      if (capW > 1.4 && capD > 1.4) {
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
    panels.set(def.id, {
      id: def.id,
      stage: def.stage,
      pivot,
      mesh,
      foldLine,
      axis: def.axis,
      sign: def.sign,
      targetAngle: def.targetAngle,
    });
  }

  // ---- Flat-Folded Kirigami Architectural Details (Awning, Chimney, Roof Dormers!) ----
  // Every detail lies 100% flat on its parent sheet at `fold = 0` and folds cleanly into 3D as the house folds!

  // A. Front entry paper canopy awning (hinged right above the front doorway, hidden behind solid spandrel at fold=0,
  //    sweeps 98° outward with a crisp architectural rainwater slope as the front wall rises!)
  const frontPv = panels.get('front');
  if (spec.hasAwning && frontPv && spec.door !== 'none' && spec.door !== 'arcade') {
    const storyH = spec.H / spec.levels;
    const awningYmm = Math.min(storyH * 0.72, 15.2);
    const awW = Math.min(spec.W * 0.34, 15.5);
    const awD = Math.min(6.4, Math.max(4.4, spec.W * 0.11));

    const aPivot = new THREE.Group();
    aPivot.position.set(0, -PAPER_THICK, awningYmm * MM);
    frontPv.pivot.add(aPivot);

    // Extends in local +Z (above doorway spandrel, so never peeks into the doorway cutout at fold=0!)
    const aShape = new THREE.Shape();
    aShape.moveTo(-awW * 0.5 * MM, 0);
    aShape.lineTo(awW * 0.5 * MM, 0);
    aShape.lineTo(awW * 0.5 * MM, -awD * MM);
    aShape.lineTo(-awW * 0.5 * MM, -awD * MM);
    aShape.closePath();

    const flatX = 0;
    const flatZ = (spec.D * 0.5 + awningYmm) * MM;
    const aGeo = buildDualSidedPaperGeometry(aShape, flatX, flatZ, spec.yawOffset, 0, PAPER_THICK * 0.75);
    const aMesh = new THREE.Mesh(aGeo, exteriorDetailMats);
    aMesh.castShadow = true;
    aMesh.receiveShadow = true;
    allMeshes.push(aMesh);
    aPivot.add(aMesh);

    // +98.6° swings local +Z outward (+Z world) with an 8.6° downward architectural rain pitch!
    details.push({
      pivot: aPivot,
      axis: 'x',
      targetAngle: 1.72,
      driverPanel: 'front',
    });
  }

  // B. Kirigami folded L-corner 3D chimney stack on roof (placed on `roofL` when `roofR` has dormers to avoid collisions!)
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
  if (spec.hasChimney && chimneyHost && chimneyHostId) {
    const isRightRoof = chimneyHostId === 'roofR';
    const hostDef = net.panelMap.get(chimneyHostId)!;
    const chW = Math.min(6.4, Math.max(4.4, spec.D * 0.085));
    const chH = spec.roofType === 'flat' ? Math.min(10.5, Math.max(7.2, spec.H * 0.2)) : Math.min(12.5, Math.max(8.2, net.roofSlant * 0.34));
    const localOffX = (isRightRoof ? 1 : -1) * Math.min(net.roofSlant * 0.46, Math.max(10.5, net.roofSlant * 0.36));
    const localOffZ = -spec.D * 0.20;

    const cPivot = new THREE.Group();
    cPivot.position.set(localOffX * MM, -PAPER_THICK, localOffZ * MM);
    chimneyHost.pivot.add(cPivot);

    const sgn = isRightRoof ? 1 : -1;
    const cShape = new THREE.Shape();
    cShape.moveTo(0, -chW * 0.5 * MM);
    cShape.lineTo(sgn * chH * MM, -chW * 0.5 * MM);
    cShape.lineTo(sgn * chH * MM, chW * 0.5 * MM);
    cShape.lineTo(0, chW * 0.5 * MM);
    cShape.closePath();

    const flatX = (hostDef.hingeOrigin[0] + localOffX) * MM;
    const flatZ = (-hostDef.hingeOrigin[1] + localOffZ) * MM;
    const cGeo = buildDualSidedPaperGeometry(cShape, flatX, flatZ, spec.yawOffset, 0, PAPER_THICK * 0.85);
    const cMesh = new THREE.Mesh(cGeo, exteriorDetailMats);
    cMesh.castShadow = true;
    cMesh.receiveShadow = true;
    allMeshes.push(cMesh);
    cPivot.add(cMesh);

    // Second perpendicular folded cheek wall turning the chimney into a crisp 3D L-corner stack from every angle!
    const cheekPivot = new THREE.Group();
    cheekPivot.position.set(0, 0, chW * 0.5 * MM);
    cPivot.add(cheekPivot);

    const cheekShape = new THREE.Shape();
    cheekShape.moveTo(0, 0);
    cheekShape.lineTo(sgn * chH * MM, 0);
    cheekShape.lineTo(sgn * chH * MM, -chW * 0.85 * MM);
    cheekShape.lineTo(0, -chW * 0.85 * MM);
    cheekShape.closePath();

    const cheekGeo = buildDualSidedPaperGeometry(
      cheekShape,
      flatX,
      flatZ + chW * 0.5 * MM,
      spec.yawOffset,
      0,
      PAPER_THICK * 0.85,
    );
    const cheekMesh = new THREE.Mesh(cheekGeo, exteriorDetailMats);
    cheekMesh.castShadow = true;
    cheekMesh.receiveShadow = true;
    allMeshes.push(cheekMesh);
    cheekPivot.add(cheekMesh);

    const chimTarget = isRightRoof ? -(Math.PI * 0.5 - spec.pitch) : Math.PI * 0.5 - spec.pitch;
    details.push({
      pivot: cPivot,
      axis: 'z',
      targetAngle: spec.roofType === 'flat' ? (isRightRoof ? -Math.PI * 0.5 : Math.PI * 0.5) : chimTarget,
      driverPanel: chimneyHostId,
    });
    details.push({
      pivot: cheekPivot,
      axis: 'x',
      targetAngle: -Math.PI * 0.5,
      driverPanel: chimneyHostId,
    });
  }

  // C. Kirigami pop-up roof dormers on right roof slope (gable & mansard, safely clamped inside trapezoid top!)
  const dormerHost = panels.get('roofR');
  if (wantsDormersOnR && dormerHost) {
    const hostDef = net.panelMap.get('roofR')!;
    const dW = Math.min(9.4, Math.max(6.8, spec.D * 0.125));
    const dH = Math.min(net.roofSlant * 0.34, Math.max(7.2, spec.H * 0.24));
    const localOffX = Math.min(net.roofSlant * 0.26, Math.max(6.5, net.roofSlant * 0.22));
    const topHalfD =
      spec.roofType === 'mansard'
        ? Math.max(0, spec.D * 0.5 - Math.min(spec.W, spec.D) * 0.5 * (1 - spec.mansardRatio))
        : spec.D * 0.5;
    const safeHalfZ = topHalfD - dW * 0.72;
    const zPositions =
      spec.dormerCount === 2 && safeHalfZ >= dW * 0.78
        ? [-Math.min(spec.D * 0.21, safeHalfZ), Math.min(spec.D * 0.21, safeHalfZ)]
        : [0];

    for (const lz of zPositions) {
      const dPivot = new THREE.Group();
      dPivot.position.set(localOffX * MM, -PAPER_THICK, lz * MM);
      dormerHost.pivot.add(dPivot);

      // Miniature gabled dormer facade tab with punched window!
      const dShape = new THREE.Shape();
      dShape.moveTo(0, -dW * 0.5 * MM);
      dShape.lineTo(dH * 0.72 * MM, -dW * 0.5 * MM);
      dShape.lineTo(dH * MM, 0);
      dShape.lineTo(dH * 0.72 * MM, dW * 0.5 * MM);
      dShape.lineTo(0, dW * 0.5 * MM);
      dShape.closePath();
      addRectHole(dShape, dH * 0.38 * MM, 0, dH * 0.40 * MM, dW * 0.44 * MM);

      const flatX = (hostDef.hingeOrigin[0] + localOffX) * MM;
      const flatZ = (-hostDef.hingeOrigin[1] + lz) * MM;
      const dGeo = buildDualSidedPaperGeometry(dShape, flatX, flatZ, spec.yawOffset, 0, PAPER_THICK * 0.8);
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
    const signed = effective * pv.sign;
    if (pv.axis === 'x') pv.pivot.rotation.x = signed;
    else pv.pivot.rotation.z = signed;

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
