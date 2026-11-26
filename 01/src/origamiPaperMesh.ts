import * as THREE from 'three';
import {
  MM,
  computeDoorCenterU,
  computeNetOuterPerimeter,
  resolveFacadeForPanel,
  type BuiltHouseNet,
  type FoldablePanelId,
  type HouseNetSpec,
  type LevelParams,
  type PanelId,
  type PanelNetDef,
  type V2,
  type WindowDetail,
  type WindowOpenMode,
  type WindowOpeningMode,
  type WindowParams,
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
  uProjTex: { value: THREE.Texture | null };
  uProjMatrix: { value: THREE.Matrix4 };
  uPaperReveal: { value: number };
  uProjGain: { value: number };
  uProjFade: { value: number };
  /** `+1` when Camera B projects onto top (`inside`) face; `-1` when Camera B projects from underneath onto bottom (`outside`) face */
  uProjSide: { value: number };
}

export interface OrigamiMaterials {
  inside: THREE.MeshStandardMaterial;
  outside: THREE.MeshStandardMaterial;
  outsideSlots: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  /** Single-pass duplex paper materials (`normal.y` switches white inside / edge / colored outside in 1 draw call!) */
  duplexSlots?: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  edge: THREE.MeshStandardMaterial;
  cutoutInside: THREE.MeshStandardMaterial;
  cutoutOutside: THREE.MeshStandardMaterial;
  cutoutEdge: THREE.MeshStandardMaterial;
  chadInside: THREE.MeshStandardMaterial;
  chadOutside: THREE.MeshStandardMaterial;
  chadEdge: THREE.MeshStandardMaterial;
  foldLine: THREE.LineDashedMaterial;
  foldLineMountain: THREE.LineDashedMaterial;
  foldLineActive: THREE.LineBasicMaterial;
  projUniforms: ProjectionUniforms;
  setProjection(tex: THREE.Texture | null, viewProjMatrix?: THREE.Matrix4, side?: 1 | -1): void;
  setProjectionFade(fade01: number): void;
  setCutoutOpacity(opacity: number): void;
  setOutsideColor(hex: string): void;
  setOutsideColors(hexes: readonly string[]): void;
  dispose(): void;
}

export interface WashiFiberTextures {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export interface CreateOrigamiMaterialsOptions {
  /** Attach live projective-camera shader (only needed in Fold View; disable in City & Catalog for faster native shaders!) */
  enableProjection?: boolean;
  /** Reuse a shared washi fiber texture pair instead of allocating duplicate 512×512 procedural canvases */
  sharedTextures?: WashiFiberTextures;
  /** Build single-pass duplex materials so City LOD0 panels draw inside+edge+outside in 1 draw call instead of 3 */
  singlePassDuplex?: boolean;
  /** Live ground-terrain color reference so flat floor-lying City panels blend cleanly without hard edges */
  flatGroundColor?: THREE.Color;
}

export function createWashiFiberTextures(maxAniso: number): WashiFiberTextures {
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

interface ProjectiveShaderOpts {
  /** Clip fragments whose projected capture matches the empty studio background (no giant blank outer sheet!) */
  clipToSilhouette?: boolean;
  /** Which face receives the projected print: `+1` top (`inside`), `-1` bottom (`outside`), `0` edges (both sides) */
  face?: 1 | -1 | 0;
}

function attachProjectiveShader(
  mat: THREE.MeshStandardMaterial,
  uniforms: ProjectionUniforms,
  opts: ProjectiveShaderOpts = {},
): void {
  const clip = Boolean(opts.clipToSilhouette);
  const face = opts.face ?? 1;
  const sideExpr = face === 0 ? '1.0' : face > 0 ? 'step(0.0, uProjSide)' : 'step(0.0, -uProjSide)';
  mat.customProgramCacheKey = () => `origami-cam-proj-v10-${clip ? 'clip' : 'full'}-f${face}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHasProj = uniforms.uHasProj;
    shader.uniforms.uProjTex = uniforms.uProjTex;
    shader.uniforms.uProjMatrix = uniforms.uProjMatrix;
    shader.uniforms.uPaperReveal = uniforms.uPaperReveal;
    shader.uniforms.uProjGain = uniforms.uProjGain;
    shader.uniforms.uProjFade = uniforms.uProjFade;
    shader.uniforms.uProjSide = uniforms.uProjSide;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aFlatPos;
varying vec3 vProjWorldPos;
varying vec3 vLiveWorldPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vProjWorldPos = aFlatPos;
vLiveWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    const clipBlock = clip
      ? `
      float bgDiff = length(captured - groundRef);
      if (bgDiff < 0.012) discard;`
      : `
      float bgDiff = length(captured - groundRef);
      projIsBlank = 1.0 - smoothstep(0.008, 0.024, bgDiff);`;
    const clipOutside = clip ? ` else { discard; }` : ` else { projIsBlank = 1.0; }`;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHasProj;
uniform sampler2D uProjTex;
uniform mat4 uProjMatrix;
uniform float uPaperReveal;
uniform float uProjGain;
uniform float uProjFade;
uniform float uProjSide;
varying vec3 vProjWorldPos;
varying vec3 vLiveWorldPos;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float projSideMatch = ${sideExpr};
float projIsBlank = 0.0;
if (uHasProj > 0.5) {
  vec4 pClip = uProjMatrix * vec4(vProjWorldPos, 1.0);
  if (pClip.w > 0.0001) {
    vec2 pUv = (pClip.xy / pClip.w) * 0.5 + 0.5;
    if (pUv.x > 0.002 && pUv.x < 0.998 && pUv.y > 0.002 && pUv.y < 0.998) {
      vec3 c0 = texture2D(uProjTex, vec2(0.015, 0.015)).rgb;
      vec3 c1 = texture2D(uProjTex, vec2(0.985, 0.015)).rgb;
      vec3 c2 = texture2D(uProjTex, vec2(0.015, 0.985)).rgb;
      vec3 c3 = texture2D(uProjTex, vec2(0.985, 0.985)).rgb;
      vec3 groundRef = max(vec3(0.05), max(max(c0, c1), max(c2, c3)));
      vec3 captured = texture2D(uProjTex, pUv).rgb;${clipBlock}
      if (projSideMatch > 0.5) {
        vec3 projAlbedo = clamp((captured / groundRef) * uProjGain, vec3(0.0), vec3(1.65));
        float fx = smoothstep(0.002, 0.035, pUv.x) * smoothstep(0.002, 0.035, 1.0 - pUv.x);
        float fy = smoothstep(0.002, 0.035, pUv.y) * smoothstep(0.002, 0.035, 1.0 - pUv.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, projAlbedo, fx * fy * uProjFade);
      }
    }${clipOutside}
  }${clipOutside}
}${clip ? ' else { discard; }' : ''}`,
      );

    if (!clip) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
if (uHasProj > 0.5 && projSideMatch > 0.5 && projIsBlank > 0.001 && uPaperReveal < 0.999) {
  vec3 studioBg = vec3(0.960784, 0.956863, 0.941176);
  float liftReveal = smoothstep(0.14, 1.25, abs(vLiveWorldPos.y));
  float localReveal = clamp(max(uPaperReveal, liftReveal), 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, studioBg, projIsBlank * (1.0 - localReveal));
}`,
      );
    }
  };
}

export function createOrigamiMaterials(
  maxAniso = 8,
  opts: CreateOrigamiMaterialsOptions = {},
): OrigamiMaterials {
  const enableProjection = opts.enableProjection ?? true;
  const ownsTextures = !opts.sharedTextures;
  const tex = opts.sharedTextures ?? createWashiFiberTextures(maxAniso);
  const paperColor = new THREE.Color('#ffffff');

  const projUniforms: ProjectionUniforms = {
    uHasProj: { value: 0 },
    uProjTex: { value: null },
    uProjMatrix: { value: new THREE.Matrix4() },
    uPaperReveal: { value: 1 },
    uProjGain: { value: 1 },
    uProjFade: { value: 1 },
    uProjSide: { value: 1 },
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
  // - `inside` (top face when flat): pure cotton white carrying exact 1:1 camera projections
  // - `outside` (bottom face when flat -> exterior walls & roof): curated matte pastel cotton stock
  const outside = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#9bb7cc'),
    bumpMap: tex.bumpMap,
    bumpScale: 0.008,
    roughness: 0.88,
    metalness: 0.0,
  });

  const outsideSlots: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ] = [outside, outside.clone(), outside.clone(), outside.clone()];

  const edge = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fbfaf7'),
    roughness: 0.95,
    metalness: 0.0,
  });

  // Optional single-pass duplex paper material for City LOD0 rigs: switches white inside / paper edge /
  // colored exterior directly from flat-extruded object `normal.y`, cutting panel draw calls 3×!
  let duplexSlots:
    | [
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
      ]
    | undefined;
  if (opts.singlePassDuplex && !enableProjection) {
    const duplexUniforms = {
      uInsideColor: { value: inside.color },
      uEdgeColor: { value: edge.color },
      uFlatGroundColor: { value: opts.flatGroundColor ?? new THREE.Color('#f5f4f0') },
    };
    const makeDuplexMat = () => {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#9bb7cc'),
        bumpMap: tex.bumpMap,
        bumpScale: 0.008,
        roughness: 0.91,
        metalness: 0.0,
      });
      m.customProgramCacheKey = () => 'origami-duplex-single-pass-v2';
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uInsideColor = duplexUniforms.uInsideColor;
        shader.uniforms.uEdgeColor = duplexUniforms.uEdgeColor;
        shader.uniforms.uFlatGroundColor = duplexUniforms.uFlatGroundColor;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
varying float vPaperFaceY;
varying float vPanelAngle;`,
          )
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
vPaperFaceY = objectNormal.y;
vec3 panelWorldUp = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vPanelAngle = acos(clamp(panelWorldUp.y, -1.0, 1.0));`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
// Collapse extruded thickness to 0 while flat on the floor (zero perimeter or window-rim edges!),
// then smoothly inflate back to full cotton-rag thickness as the wall lifts off the ground.
transformed.y *= smoothstep(0.05, 0.30, vPanelAngle);`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
uniform vec3 uInsideColor;
uniform vec3 uEdgeColor;
uniform vec3 uFlatGroundColor;
varying float vPaperFaceY;
varying float vPanelAngle;`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (vPaperFaceY > 0.5) {
  // Blend flat floor-lying inside faces softly to the ground tone until walls begin lifting
  diffuseColor.rgb = mix(uFlatGroundColor, uInsideColor, smoothstep(0.04, 0.28, vPanelAngle));
} else if (vPaperFaceY > -0.5) {
  // Hide all extruded perimeter & punched window-rim edges while laying flat on the floor!
  if (vPanelAngle < 0.14) discard;
  diffuseColor.rgb = uEdgeColor;
}`,
          );
      };
      return m;
    };
    duplexSlots = [makeDuplexMat(), makeDuplexMat(), makeDuplexMat(), makeDuplexMat()];
  }

  // Outer falling cutout shards: silhouette-clipped strictly to the sliced-off previous house
  // so NO blank surrounding sheet or giant outer border ever appears!
  const cutoutInside = inside.clone();
  const cutoutOutside = outside.clone();
  const cutoutEdge = edge.clone();

  // Punched window/door/skylight chads: full real paper cutouts falling right out of the house's openings!
  const chadInside = inside.clone();
  const chadOutside = outside.clone();
  const chadEdge = edge.clone();

  if (enableProjection) {
    attachProjectiveShader(inside, projUniforms, { face: 1 });
    for (const m of outsideSlots) {
      attachProjectiveShader(m, projUniforms, { face: -1 });
    }
    attachProjectiveShader(edge, projUniforms, { face: 0 });
    attachProjectiveShader(cutoutInside, projUniforms, { clipToSilhouette: true, face: 1 });
    attachProjectiveShader(cutoutEdge, projUniforms, { clipToSilhouette: true, face: 0 });
    attachProjectiveShader(cutoutOutside, projUniforms, { clipToSilhouette: true, face: -1 });
    attachProjectiveShader(chadInside, projUniforms, { face: 1 });
    attachProjectiveShader(chadEdge, projUniforms, { face: 0 });
    attachProjectiveShader(chadOutside, projUniforms, { face: -1 });
  }

  const foldLine = new THREE.LineDashedMaterial({
    color: 0x8f8c86,
    dashSize: 0.24,
    gapSize: 0.20,
    transparent: true,
    opacity: 0.14,
  });

  const foldLineMountain = new THREE.LineDashedMaterial({
    color: 0x6c6860,
    dashSize: 0.14,
    gapSize: 0.13,
    transparent: true,
    opacity: 0.22,
  });

  const foldLineActive = new THREE.LineBasicMaterial({
    color: 0x3a3835,
    transparent: true,
    opacity: 0.45,
  });

  const fadeGroup = [cutoutInside, cutoutOutside, cutoutEdge, chadInside, chadOutside, chadEdge];
  // Keep `transparent = true` permanently on cutout & chad materials so Three.js compiles ONE
  // shader variant upfront (never toggling `#define OPAQUE` or setting `needsUpdate = true` mid-fall!).
  for (const m of fadeGroup) {
    m.transparent = true;
    m.depthWrite = true;
    m.opacity = 1;
  }

  const setCutoutOpacity = (opacity: number) => {
    const o = Math.max(0, Math.min(1, opacity));
    const writeDepth = o >= 0.995;
    for (const m of fadeGroup) {
      m.opacity = o;
      m.depthWrite = writeDepth;
    }
  };

  return {
    inside,
    outside,
    outsideSlots,
    duplexSlots,
    edge,
    cutoutInside,
    cutoutOutside,
    cutoutEdge,
    chadInside,
    chadOutside,
    chadEdge,
    foldLine,
    foldLineMountain,
    foldLineActive,
    projUniforms,
    setProjection(nextTex: THREE.Texture | null, viewProjMatrix?: THREE.Matrix4, side: 1 | -1 = 1) {
      if (nextTex && viewProjMatrix) {
        projUniforms.uProjTex.value = nextTex;
        projUniforms.uProjMatrix.value.copy(viewProjMatrix);
        projUniforms.uHasProj.value = 1;
        projUniforms.uProjFade.value = 1;
        projUniforms.uProjSide.value = side;
      } else {
        projUniforms.uHasProj.value = 0;
        projUniforms.uProjTex.value = null;
        projUniforms.uProjFade.value = 1;
        projUniforms.uProjSide.value = 1;
      }
    },
    setProjectionFade(fade01: number) {
      projUniforms.uProjFade.value = Math.max(0, Math.min(1, fade01));
    },
    setCutoutOpacity,
    setOutsideColor(hex: string) {
      for (const m of outsideSlots) m.color.set(hex);
      if (duplexSlots) {
        for (const m of duplexSlots) m.color.set(hex);
      }
      cutoutOutside.color.set(hex);
      chadOutside.color.set(hex);
    },
    setOutsideColors(hexes: readonly string[]) {
      const primary = hexes[0] ?? '#9bb7cc';
      for (let i = 0; i < outsideSlots.length; i++) {
        const col = hexes[i] ?? primary;
        outsideSlots[i].color.set(col);
        if (duplexSlots) duplexSlots[i].color.set(col);
      }
      cutoutOutside.color.set(primary);
      chadOutside.color.set(primary);
    },
    dispose() {
      if (ownsTextures) {
        tex.map.dispose();
        tex.bumpMap.dispose();
      }
      inside.dispose();
      for (const m of outsideSlots) m.dispose();
      if (duplexSlots) {
        for (const m of duplexSlots) m.dispose();
      }
      edge.dispose();
      for (const m of fadeGroup) m.dispose();
      foldLine.dispose();
      foldLineMountain.dispose();
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
  curveSegments = 14,
  singleGroup = false,
): THREE.BufferGeometry {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: false,
    curveSegments,
  });
  raw.translate(0, 0, -thick);
  raw.rotateX(-Math.PI * 0.5);

  // Fast single-draw-call path for City LOD0 rigs (skips 3-group bucketing & unused `aFlatPos` allocation!)
  if (singleGroup) {
    raw.clearGroups();
    raw.computeVertexNormals();
    return raw;
  }

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

function addFramedLancetHole(
  shape: THREE.Shape,
  toShape: FrameMapper,
  uCenter: number,
  vBase: number,
  wMm: number,
  hMm: number,
): void {
  const hw = wMm * 0.5;
  const springV = vBase + hMm * 0.56;
  const topV = vBase + hMm;
  const archH = Math.max(0.5, topV - springV);
  const p = new THREE.Path();
  const [x0, y0] = toShape(uCenter - hw, vBase);
  const [x1, y1] = toShape(uCenter + hw, vBase);
  const [x2, y2] = toShape(uCenter + hw, springV);
  p.moveTo(x0, y0);
  p.lineTo(x1, y1);
  p.lineTo(x2, y2);
  const segs = 6;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const u = uCenter + hw * Math.cos(t * Math.PI * 0.5);
    const v = springV + archH * Math.pow(Math.sin(t * Math.PI * 0.5), 0.72);
    const [ax, ay] = toShape(u, v);
    p.lineTo(ax, ay);
  }
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const u = uCenter - hw * Math.sin(t * Math.PI * 0.5);
    const v = springV + archH * Math.pow(Math.cos(t * Math.PI * 0.5), 0.72);
    const [ax, ay] = toShape(u, v);
    p.lineTo(ax, ay);
  }
  p.lineTo(x0, y0);
  p.closePath();
  shape.holes.push(p);
}

function addFramedGridHoles(
  shape: THREE.Shape,
  toShape: FrameMapper,
  uCenter: number,
  vCenter: number,
  wMm: number,
  hMm: number,
  reqCols: number,
  reqRows: number,
  barMm: number,
): boolean {
  let cols = Math.max(1, reqCols);
  let rows = Math.max(1, reqRows);
  const minPane = 0.62;
  while (cols > 1 && (wMm - barMm * (cols - 1)) / cols < minPane) cols--;
  while (rows > 1 && (hMm - barMm * (rows - 1)) / rows < minPane) rows--;
  const paneW = (wMm - barMm * (cols - 1)) / cols;
  const paneH = (hMm - barMm * (rows - 1)) / rows;
  if (paneW < 0.55 || paneH < 0.55) return false;
  const uStart = uCenter - wMm * 0.5 + paneW * 0.5;
  const vStart = vCenter - hMm * 0.5 + paneH * 0.5;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      addFramedRectHole(shape, toShape, uStart + c * (paneW + barMm), vStart + r * (paneH + barMm), paneW, paneH);
    }
  }
  return true;
}

interface WallHingedFeature {
  mode: WindowOpeningMode | 'sill' | 'door-single' | 'door-double';
  style: WindowStyle | 'arched' | 'rect';
  /** Frame glass cutout pattern (`clean` = 1 cut, `six` = 6 panes, `twelve` = 12 panes, etc.) */
  detail: WindowDetail;
  /** Center horizontal coordinate along wall `uAxis` (mm) */
  u: number;
  /** Center vertical coordinate along wall `vAxis` (mm) */
  vCenter: number;
  /** Opening width (mm) */
  w: number;
  /** Opening height (mm) */
  h: number;
}

interface PunchedWallResult {
  features: WallHingedFeature[];
  /** Hole indices in `shape.holes` covered by hinged paper flaps (not dropped as loose chads!) */
  hingedHoleIndices: Set<number>;
}

/**
 * Punch crisp multi-story architectural windows (including `+` cross-mullions, transoms, triple bays),
 * doorways, arcades, attic oculi & belfry louvers directly into ANY wall panel using its `wallFrame`
 * and recursive `BuildingArchitecture` tree, returning any attached hinged kirigami window/door leaves!
 */
function punchWallOpenings(
  shape: THREE.Shape,
  def: PanelNetDef,
  fallbackSpec: HouseNetSpec,
  fallbackRoofRise: number,
  embedMuntinsInWall = false,
): PunchedWallResult {
  const features: WallHingedFeature[] = [];
  const hingedHoleIndices = new Set<number>();
  const wf = def.wallFrame;
  if (!wf || def.skipOpenings) return { features, hingedHoleIndices };

  const spec = def.panelSpec ?? fallbackSpec;
  const roofRise = def.panelRoofRise ?? fallbackRoofRise;
  const localId = def.localId ?? def.id;
  const isFront = Boolean(def.isFront || localId === 'front');
  const isGableEnd = Boolean(def.isGableEnd || localId === 'front' || localId === 'back');
  const wallLenMm = wf.widthMm;
  const wallH = wf.heightMm;

  const arch = spec.architecture;
  const facade = arch ? resolveFacadeForPanel(arch, localId, def.stage, isFront) : null;
  const levelCount = wf.wallLevels ?? (facade ? facade.levels.length : spec.levels);

  const levelList: (LevelParams | null)[] = Array.from({ length: levelCount }, (_, li) =>
    facade ? (facade.levels[Math.min(li, facade.levels.length - 1)] ?? null) : null,
  );
  const weightSum = levelList.reduce((acc, lv) => acc + (lv ? lv.heightWeight : 1), 0) || levelCount;

  const toShape: FrameMapper = (uMm, vMm) => [
    (wf.origin[0] + uMm * wf.uAxis[0] + vMm * wf.vAxis[0] - def.hingeOrigin[0]) * MM,
    (wf.origin[1] + uMm * wf.uAxis[1] + vMm * wf.vAxis[1] - def.hingeOrigin[1]) * MM,
  ];

  const markNextHoleHinged = () => {
    hingedHoleIndices.add(shape.holes.length);
  };

  let curBaseH = 0;
  for (let li = 0; li < levelCount; li++) {
    const lv = levelList[li];
    const storyH = wallH * ((lv ? lv.heightWeight : 1) / weightSum);
    const baseH = curBaseH;
    curBaseH += storyH;
    const isGround = li === 0;
    const isTop = li === levelCount - 1;

    const allowBelfry = spec.topology === 'setback' ? def.stage === 'upperWall' : wallH >= 28;
    const wantBelfry = lv ? lv.belfry : isTop && spec.hasBelfry;
    if (isTop && wantBelfry && allowBelfry) {
      const slotW = Math.max(6.5, wallLenMm - Math.min(10, wallLenMm * 0.34));
      const slotH = Math.min(3.2, storyH * 0.22);
      const y1 = baseH + storyH * 0.36;
      const y2 = baseH + storyH * 0.68;
      addFramedRectHole(shape, toShape, 0, y1, slotW, slotH);
      addFramedRectHole(shape, toShape, 0, y2, slotW, slotH);
      continue;
    }

    const doorParam =
      isGround && isFront
        ? lv
          ? lv.door
          : spec.door !== 'none'
            ? {
                style: spec.door,
                position: 'center' as const,
                widthRatio: 1,
                heightRatio: 0.66,
                awning: spec.hasAwning,
              }
            : null
        : null;

    if (isGround && isFront && doorParam?.style === 'arcade' && wallLenMm >= 38) {
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

    const row = lv?.windowRow;
    const baseStyle: WindowStyle = row ? row.baseWindow.shape : isGround ? spec.windowGround : spec.windowUpper;
    const baySpacing = baseStyle === 'ribbon' ? 15.5 : baseStyle === 'pair' ? 14.5 : 12.2;
    let bays =
      row && typeof row.count === 'number'
        ? Math.max(1, Math.min(5, row.count))
        : wallLenMm < 26
          ? 1
          : Math.max(2, Math.min(5, Math.floor((wallLenMm - 6) / baySpacing)));

    const maxSafeBays = Math.max(1, Math.floor((wallLenMm - 4) / 7.5));
    bays = Math.min(bays, maxSafeBays);

    if (doorParam && doorParam.style !== 'none' && doorParam.position === 'center' && bays % 2 === 0) {
      bays = wallLenMm >= 28 ? Math.min(Math.min(5, maxSafeBays), bays + 1) : 1;
    }

    const marginRatio = row ? row.marginRatio : 0.13;
    const margin =
      wallLenMm < 26
        ? Math.max(3.2, wallLenMm * 0.16)
        : Math.max(4.2, Math.min(7.5, wallLenMm * marginRatio));
    const usable = Math.max(8, wallLenMm - margin * 2);
    const cellW = usable / bays;
    const doorIdx =
      doorParam && doorParam.style !== 'none'
        ? doorParam.position === 'left'
          ? 0
          : doorParam.position === 'right'
            ? bays - 1
            : Math.floor(bays / 2)
        : -1;

    // Only mount hinged doors on non-minimal buildings (keeps Layer 1 pure cottage iconic & crisp)
    const allowHingedDoor = Boolean(row && (row.baseWindow.openingMode !== 'punched' || row.baseWindow.detail !== 'clean'));

    for (let b = 0; b < bays; b++) {
      const u = -wallLenMm * 0.5 + margin + cellW * (b + 0.5);

      if (b === doorIdx && doorParam) {
        const dw = Math.min(cellW * 0.68, (doorParam.style === 'double' ? 9.6 : 7.8) * doorParam.widthRatio);
        const dh = Math.min(storyH * doorParam.heightRatio, 13.8);
        if (allowHingedDoor) {
          markNextHoleHinged();
          features.push({
            mode: doorParam.style === 'double' ? 'door-double' : 'door-single',
            style: doorParam.style === 'arched' ? 'arched' : 'rect',
            detail: row?.baseWindow.detail ?? 'clean',
            u,
            vCenter: 0.6 + dh * 0.5,
            w: dw,
            h: dh,
          });
        }
        if (doorParam.style === 'arched') {
          addFramedArchHole(shape, toShape, u, 0.6, dw, dh);
        } else {
          addFramedRectHole(shape, toShape, u, 0.6 + dh * 0.5, dw, dh);
        }
        continue;
      }

      const slot: WindowParams = row
        ? (row.slots[b % row.slots.length] ?? row.baseWindow)
        : {
            shape: baseStyle,
            widthScale: 1,
            heightScale: 1,
            mullions: baseStyle === 'pair' ? 1 : 0,
            openingMode: 'punched',
            detail: 'clean',
          };

      if (slot.blank) continue;

      const style = slot.shape;
      const openingMode: WindowOpeningMode = slot.openingMode ?? 'punched';
      const detail: WindowDetail = slot.detail ?? 'clean';
      const sillRatio = row ? row.sillRatio : style === 'tall' ? 0.50 : 0.52;
      const vh = baseH + storyH * sillRatio;

      if ((style === 'pair' || slot.mullions >= 1) && cellW >= 10.5 && style !== 'round' && style !== 'ribbon') {
        const pw = Math.min(cellW * 0.30 * slot.widthScale, 3.9);
        const ph = Math.min(storyH * 0.48 * slot.heightScale, 8.6);
        const gap = Math.max(1.3, pw * 0.30);
        if (pw >= 1.8 && ph >= 2.8) {
          for (const sgn of [-1, 1]) {
            const pu = u + sgn * (pw * 0.5 + gap * 0.5);
            if (openingMode === 'awning' || openingMode === 'casement') {
              markNextHoleHinged();
              features.push({
                mode: openingMode,
                style: style === 'arched' || style === 'lancet' ? 'rect' : style,
                detail,
                u: pu,
                vCenter: vh,
                w: pw,
                h: ph,
              });
            }
            if (style === 'arched') {
              addFramedArchHole(shape, toShape, pu, vh - ph * 0.5, pw, ph);
            } else if (style === 'lancet') {
              addFramedLancetHole(shape, toShape, pu, vh - ph * 0.5, pw, ph);
            } else {
              addFramedRectHole(shape, toShape, pu, vh, pw, ph);
            }
          }
          if (detail === 'sill') {
            features.push({ mode: 'sill', style: 'rect', detail: 'clean', u, vCenter: vh, w: pw * 2 + gap + 0.8, h: ph });
          }
          continue;
        }
      }

      if (style === 'round') {
        const r = Math.min(cellW * 0.30, storyH * 0.24, 3.8) * Math.min(slot.widthScale, slot.heightScale);
        if (r >= 1.55) {
          addFramedCircleHole(shape, toShape, u, vh, r);
        }
        continue;
      }

      if (style === 'slit') {
        const ww = Math.max(2.1, Math.min(cellW * 0.24 * slot.widthScale, 3.0));
        const wh = Math.min(storyH * 0.64 * slot.heightScale, 11.4);
        if (wh >= 3.2) {
          addFramedRectHole(shape, toShape, u, vh, ww, wh);
        }
        continue;
      }

      const ww =
        (style === 'ribbon'
          ? Math.min(cellW * 0.78, 12.5)
          : style === 'tall' || style === 'lancet'
            ? Math.min(cellW * 0.48, 5.4)
            : Math.min(cellW * 0.52, 6.8)) * slot.widthScale;
      const wh =
        (style === 'tall' || style === 'lancet'
          ? Math.min(storyH * 0.60, 10.6)
          : style === 'ribbon'
            ? Math.min(storyH * 0.36, 5.6)
            : Math.min(storyH * 0.46, 8.2)) * slot.heightScale;

      const clampedW = Math.min(ww, cellW * 0.84);
      const clampedH = Math.min(wh, storyH * 0.72);
      if (clampedW < 2.4 || clampedH < 2.8) continue;

      // 1. Hinged kirigami windows (`awning` top-hung from above, `shutters`, `casement`, `louver`)!
      // In City mode (`embedMuntinsInWall`), punch multi-pane muntin grids directly into the wall mesh (0 extra draw calls!)
      const canHinge = !embedMuntinsInWall && openingMode !== 'punched' && clampedW >= 2.8 && clampedH >= 3.2;
      if (canHinge) {
        if ((openingMode === 'awning' || openingMode === 'louver') && (style === 'arched' || style === 'lancet') && clampedH >= 5.2) {
          // Authentic arched/lancet top-hung window: open curved fanlight above a horizontal paper transom bar,
          // and a rectangular top-hung sash / louver hinged cleanly from the transom bar below!
          const bar = 0.85;
          const archR = Math.min(clampedW * 0.5, clampedH * 0.34);
          const lowerH = Math.max(2.4, clampedH - archR - bar);
          const vBase = vh - clampedH * 0.5;
          const lowerCenter = vBase + lowerH * 0.5;
          const fanBase = vBase + lowerH + bar;
          const fanH = Math.max(1.8, clampedH - lowerH - bar);

          markNextHoleHinged();
          addFramedRectHole(shape, toShape, u, lowerCenter, clampedW, lowerH);
          features.push({
            mode: openingMode,
            style: 'rect',
            detail,
            u,
            vCenter: lowerCenter,
            w: clampedW,
            h: lowerH,
          });
          if (style === 'arched') {
            addFramedArchHole(shape, toShape, u, fanBase, clampedW, fanH);
          } else {
            addFramedLancetHole(shape, toShape, u, fanBase, clampedW, fanH);
          }
        } else {
          markNextHoleHinged();
          if (style === 'arched') {
            addFramedArchHole(shape, toShape, u, vh - clampedH * 0.5, clampedW, clampedH);
          } else if (style === 'lancet') {
            addFramedLancetHole(shape, toShape, u, vh - clampedH * 0.5, clampedW, clampedH);
          } else {
            addFramedRectHole(shape, toShape, u, vh, clampedW, clampedH);
          }
          features.push({
            mode: openingMode,
            style,
            detail,
            u,
            vCenter: vh,
            w: clampedW,
            h: clampedH,
          });
        }

        if (detail === 'sill') {
          features.push({ mode: 'sill', style: 'rect', detail: 'clean', u, vCenter: vh, w: clampedW + 1.0, h: clampedH });
        }
        continue;
      }

      // 2. Detailed punched architectural openings (`six` 6-pane, `twelve` 12-pane, `cross` 4-pane, `transom`, `triple`, `sill`, `clean`)!
      const bar = 0.85;
      if ((detail === 'six' || detail === 'twelve') && clampedW >= 3.6 && clampedH >= 4.0) {
        const isTwelve = detail === 'twelve';
        const fineBar = isTwelve ? 0.42 : 0.50;
        const landscape = clampedW > clampedH * 1.15;
        const reqCols = isTwelve ? (landscape ? 4 : 3) : landscape ? 3 : 2;
        const reqRows = isTwelve ? (landscape ? 3 : 4) : landscape ? 2 : 3;
        if (style === 'arched' || style === 'lancet') {
          const vBase = vh - clampedH * 0.5;
          const topH = Math.min(clampedH * 0.34, Math.max(1.8, clampedW * 0.42));
          const botH = clampedH - topH - fineBar;
          if (botH >= 2.2 && topH >= 1.5) {
            addFramedGridHoles(
              shape,
              toShape,
              u,
              vBase + botH * 0.5,
              clampedW,
              botH,
              reqCols,
              Math.max(1, reqRows - 1),
              fineBar,
            );
            if (style === 'arched') {
              addFramedArchHole(shape, toShape, u, vBase + botH + fineBar, clampedW, topH);
            } else {
              addFramedLancetHole(shape, toShape, u, vBase + botH + fineBar, clampedW, topH);
            }
            continue;
          }
        } else if (addFramedGridHoles(shape, toShape, u, vh, clampedW, clampedH, reqCols, reqRows, fineBar)) {
          continue;
        }
      }
      if (detail === 'cross' && clampedW >= 4.4 && clampedH >= 4.8) {
        const subW = (clampedW - bar) * 0.5;
        const vBase = vh - clampedH * 0.5;
        if (style === 'arched' || style === 'lancet') {
          // Palladian / Georgian arched cross-window: twin lower panes + open curved fanlight above!
          const topH = Math.min(clampedH * 0.36, Math.max(2.0, clampedW * 0.45));
          const botH = clampedH - topH - bar;
          if (subW >= 1.5 && botH >= 2.0 && topH >= 1.7) {
            for (const sgn of [-1, 1]) {
              addFramedRectHole(shape, toShape, u + sgn * (subW * 0.5 + bar * 0.5), vBase + botH * 0.5, subW, botH);
            }
            if (style === 'arched') {
              addFramedArchHole(shape, toShape, u, vBase + botH + bar, clampedW, topH);
            } else {
              addFramedLancetHole(shape, toShape, u, vBase + botH + bar, clampedW, topH);
            }
            continue;
          }
        } else {
          // Crisp 2×2 four-pane window leaving a real paper `+` muntin cross!
          const subH = (clampedH - bar) * 0.5;
          if (subW >= 1.5 && subH >= 1.6) {
            for (const sx of [-1, 1]) {
              for (const sy of [-1, 1]) {
                addFramedRectHole(
                  shape,
                  toShape,
                  u + sx * (subW * 0.5 + bar * 0.5),
                  vh + sy * (subH * 0.5 + bar * 0.5),
                  subW,
                  subH,
                );
              }
            }
            continue;
          }
        }
      }

      if (detail === 'transom' && clampedH >= 5.0) {
        const vBase = vh - clampedH * 0.5;
        const botH = (clampedH - bar) * 0.64;
        const topH = clampedH - bar - botH;
        if (botH >= 2.2 && topH >= 1.5) {
          addFramedRectHole(shape, toShape, u, vBase + botH * 0.5, clampedW, botH);
          if (style === 'arched') {
            addFramedArchHole(shape, toShape, u, vBase + botH + bar, clampedW, topH);
          } else if (style === 'lancet') {
            addFramedLancetHole(shape, toShape, u, vBase + botH + bar, clampedW, topH);
          } else {
            addFramedRectHole(shape, toShape, u, vBase + botH + bar + topH * 0.5, clampedW, topH);
          }
          continue;
        }
      }

      if (detail === 'triple' && clampedW >= 6.4 && style !== 'arched' && style !== 'lancet') {
        const st = 0.78;
        const subW = (clampedW - st * 2) / 3;
        if (subW >= 1.5) {
          for (const idx of [-1, 0, 1]) {
            addFramedRectHole(shape, toShape, u + idx * (subW + st), vh, subW, clampedH);
          }
          continue;
        }
      }

      if (style === 'arched') {
        addFramedArchHole(shape, toShape, u, vh - clampedH * 0.5, clampedW, clampedH);
      } else if (style === 'lancet') {
        addFramedLancetHole(shape, toShape, u, vh - clampedH * 0.5, clampedW, clampedH);
      } else {
        addFramedRectHole(shape, toShape, u, vh, clampedW, clampedH);
      }

      if (detail === 'sill') {
        features.push({ mode: 'sill', style: 'rect', detail: 'clean', u, vCenter: vh, w: clampedW + 1.0, h: clampedH });
      }
    }
  }

  // Crisp attic circular oculus in front & back gable crowns (centered, or ridge-aligned on saltbox)!
  const allowOculus = facade ? facade.hasOculus : spec.hasOculus;
  if (spec.roofType === 'gable' && isGableEnd && allowOculus && roofRise >= 11) {
    const profile = spec.gableProfile ?? spec.architecture?.roof.gableProfile ?? 'classic';
    const r = Math.min(roofRise * 0.17, spec.W * 0.085, 3.8);
    if (r >= 2.0) {
      const uOculus = profile === 'saltbox' ? (wf.uAxis[0] < 0 ? -spec.W * 0.08 : spec.W * 0.08) : 0;
      addFramedCircleHole(shape, toShape, uOculus, spec.H + roofRise * 0.43, r);
    }
  }

  return { features, hingedHoleIndices };
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
  isMountain: boolean;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  foldLine?: THREE.Line;
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
  /** `'fixed'` = architectural pop-ups (awnings, chimneys, dormers, sills); `'window'` = live-adjustable hinged leaves! */
  kind?: 'fixed' | 'window';
  /** Stratified deterministic rank `[0, 1)` deciding which windows crack open in `'random'` ventilation mode */
  openRank?: number;
  /** Classification for window kinematics (`top-hung` capped to 20-30%, `side-hung`, or `door`) */
  windowType?: 'top-hung' | 'side-hung' | 'door';
}

export interface OrigamiHouseRig {
  net: BuiltHouseNet;
  root: THREE.Group;
  baseMesh: THREE.Mesh;
  panelIds: FoldablePanelId[];
  panels: Map<FoldablePanelId, PanelVisual>;
  details: KirigamiDetailRig[];
  hasCutout: boolean;
  updatePanelVisual(id: FoldablePanelId, fold01: number, peekRad: number, hovered: boolean): void;
  setWindowOpen(mode: WindowOpenMode, ratio?: number): void;
  updateCutoutDrop(elapsedSec: number): boolean;
  setFoldLinesVisible(visible: boolean): void;
  setPaperRelief(relief01: number, forceFlatShadow?: boolean): void;
  dispose(): void;
}

export type RigDetailLevel = 'full' | 'city';

export function buildOrigamiHouseRig(
  net: BuiltHouseNet,
  mats: OrigamiMaterials,
  includeCutout = false,
  detailLevel: RigDetailLevel = 'full',
): OrigamiHouseRig {
  const isCityDetail = detailLevel === 'city';
  const useSingleGroup = isCityDetail && Boolean(mats.duplexSlots);
  const curveSegs = isCityDetail ? 9 : 14;
  const { spec, roofRise } = net;
  const root = new THREE.Group();
  root.position.y = PAPER_THICK;
  root.rotation.y = spec.yawOffset;

  const cutoutMats = [mats.cutoutInside, mats.cutoutEdge, mats.cutoutOutside];
  const chadMats = [mats.chadInside, mats.chadEdge, mats.chadOutside];
  const triMatsForSlot = (slot: 0 | 1 | 2 | 3 = 0) => [mats.inside, mats.edge, mats.outsideSlots[slot]];
  const panelMatForSlot = (slot: 0 | 1 | 2 | 3 = 0): THREE.Material | THREE.Material[] =>
    useSingleGroup ? mats.duplexSlots![slot] : triMatsForSlot(slot);
  const detailMatsForSlot = (slot: 0 | 1 | 2 | 3 = 0): THREE.Material | THREE.Material[] =>
    useSingleGroup ? mats.outsideSlots[slot] : [mats.outsideSlots[slot], mats.edge, mats.outsideSlots[slot]];
  const groupByPanel = new Map<PanelId, THREE.Group>();
  const panels = new Map<FoldablePanelId, PanelVisual>();
  const details: KirigamiDetailRig[] = [];

  // Optional physical cutout group: complementary outer paper sheet + punched window/door/skylight chads!
  // Sits 100% flush with the house net on the JIT swap frame, then breaks free and falls into the void just before folding!
  interface FallingChad {
    mesh: THREE.Mesh;
    baseX: number;
    baseZ: number;
    delay: number;
    grav: number;
    driftX: number;
    driftZ: number;
    spinX: number;
    spinZ: number;
  }
  let cutoutRoot: THREE.Group | null = null;
  let outerCutoutMesh: THREE.Mesh | null = null;
  const fallingChads: FallingChad[] = [];
  if (includeCutout) {
    cutoutRoot = new THREE.Group();
    root.add(cutoutRoot);
  }

  const makeFoldLine = (a: [number, number, number], b: [number, number, number], isMountain = false): THREE.Line => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...a),
      new THREE.Vector3(...b),
    ]);
    const line = new THREE.Line(g, isMountain ? mats.foldLineMountain : mats.foldLine);
    line.computeLineDistances();
    return line;
  };

  let baseMesh!: THREE.Mesh;

  // Build every panel in parent -> child order
  const allMeshes: THREE.Mesh[] = [];
  const wallHingedByPanel = new Map<PanelId, WallHingedFeature[]>();
  for (const def of net.panels) {
    const shape = makeLocalShape(def.poly, def.hingeOrigin[0], def.hingeOrigin[1]);
    const punched = punchWallOpenings(shape, def, spec, roofRise, isCityDetail);
    if (punched.features.length > 0) {
      wallHingedByPanel.set(def.id, punched.features);
    }

    // Crisp industrial north-light skylight bays punched into steep sawtooth roof clerestories!
    if (def.hasRoofSkylights && def.roofFrame) {
      const rf = def.roofFrame;
      const toRoofShape: FrameMapper = (uMm, vMm) => [
        (rf.origin[0] + uMm * rf.ridgeAxis[0] + vMm * rf.slopeAxis[0] - def.hingeOrigin[0]) * MM,
        (rf.origin[1] + uMm * rf.ridgeAxis[1] + vMm * rf.slopeAxis[1] - def.hingeOrigin[1]) * MM,
      ];
      const count = Math.max(2, Math.min(5, Math.floor((rf.widthMm - 8) / 13)));
      const margin = 5.5;
      const cellW = Math.max(6, (rf.widthMm - margin * 2) / count);
      const sw = Math.min(cellW * 0.72, 10.5);
      const sh = Math.min(rf.slantMm * 0.54, 6.2);
      if (sw >= 3.0 && sh >= 2.0) {
        for (let k = 0; k < count; k++) {
          const u = -rf.widthMm * 0.5 + margin + cellW * (k + 0.5);
          addFramedRectHole(shape, toRoofShape, u, rf.slantMm * 0.50, sw, sh);
        }
      }
    }

    // Crisp architectural skylight in mansard / polygonal pavilion top deck:
    // circular Pantheon oculus for hexagonal/octagonal caps, rectangular skylight for mansards!
    if ((def.localId ?? def.id) === 'roofCap') {
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

    // Collect every genuinely punched window/door/oculus/skylight opening (skipping hinged flaps!) as a real falling chad!
    if (cutoutRoot && shape.holes.length > 0) {
      for (let hi = 0; hi < shape.holes.length; hi++) {
        if (punched.hingedHoleIndices.has(hi)) continue;
        const holePath = shape.holes[hi];
        const pts = holePath.getPoints(10);
        if (pts.length < 3) continue;
        let cx = 0;
        let cy = 0;
        for (const pt of pts) {
          cx += pt.x;
          cy += pt.y;
        }
        cx /= pts.length;
        cy /= pts.length;

        const chadShape = new THREE.Shape();
        pts.forEach((pt, idx) => {
          const x = pt.x - cx;
          const y = pt.y - cy;
          if (idx === 0) chadShape.moveTo(x, y);
          else chadShape.lineTo(x, y);
        });
        chadShape.closePath();

        const chadFlatX = flatOriginX + cx;
        const chadFlatZ = flatOriginZ - cy;
        const chadGeo = buildDualSidedPaperGeometry(chadShape, chadFlatX, chadFlatZ, spec.yawOffset);
        const chadMesh = new THREE.Mesh(chadGeo, chadMats);
        chadMesh.position.set(chadFlatX, 0, chadFlatZ);
        chadMesh.castShadow = false;
        chadMesh.receiveShadow = false;
        cutoutRoot.add(chadMesh);

        const idx = fallingChads.length;
        const hash = Math.sin((idx + 1) * 127.1 + spec.generation * 31.7);
        const hash2 = Math.cos((idx + 1) * 269.5 + spec.generation * 17.3);
        fallingChads.push({
          mesh: chadMesh,
          baseX: chadFlatX,
          baseZ: chadFlatZ,
          delay: 0.02 + (idx % 7) * 0.018,
          grav: 34 + (idx % 5) * 3.5,
          driftX: hash * 1.1,
          driftZ: hash2 * 1.1,
          spinX: hash * 2.6,
          spinZ: hash2 * 2.4,
        });
      }
    }

    const geo = buildDualSidedPaperGeometry(
      shape,
      flatOriginX,
      flatOriginZ,
      spec.yawOffset,
      PAPER_THICK,
      PAPER_THICK,
      curveSegs,
      useSingleGroup,
    );
    const mesh = new THREE.Mesh(geo, panelMatForSlot(def.colorSlot ?? 0));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'panel', id: def.id };
    allMeshes.push(mesh);

    if (def.parent === null) {
      const baseGroup = new THREE.Group();
      baseGroup.position.set(flatOriginX, 0, flatOriginZ);
      baseGroup.add(mesh);
      root.add(baseGroup);
      groupByPanel.set(def.id, baseGroup);
      if (!baseMesh || def.id === 'base') baseMesh = mesh;
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

    const isMountain = Boolean(def.isMountain);
    let foldLine: THREE.Line | undefined;
    if (!isCityDetail) {
      if (def.crease) {
        const [ca, cb] = def.crease;
        foldLine = makeFoldLine(
          [(ca[0] - def.hingeOrigin[0]) * MM, 0.004, -(ca[1] - def.hingeOrigin[1]) * MM],
          [(cb[0] - def.hingeOrigin[0]) * MM, 0.004, -(cb[1] - def.hingeOrigin[1]) * MM],
          isMountain,
        );
      } else {
        foldLine = makeFoldLine([0, 0.004, 0], [0, 0.004, 0], isMountain);
      }
      pivot.add(foldLine);
    }

    groupByPanel.set(def.id, pivot);
    const hingeAxis3D = new THREE.Vector3(def.hingeAxis[0], 0, -def.hingeAxis[1]).normalize();
    panels.set(def.id, {
      id: def.id,
      stage: def.stage,
      isMountain,
      pivot,
      mesh,
      foldLine,
      hingeAxis3D,
      targetAngle: def.targetAngle,
    });
  }

  // Build exact complementary outer cutout carrier (shader silhouette-clips strictly to the previous house,
  // so ONLY the sliced-off portions of the previous house exist & fall — ZERO outer sheet borders!)
  if (cutoutRoot) {
    const outerPerim = computeNetOuterPerimeter(net);
    const S = Math.max(520, net.sheetHalfMm + 240);
    const sheetShape = new THREE.Shape();
    sheetShape.moveTo(-S * MM, -S * MM);
    sheetShape.lineTo(S * MM, -S * MM);
    sheetShape.lineTo(S * MM, S * MM);
    sheetShape.lineTo(-S * MM, S * MM);
    sheetShape.closePath();

    if (outerPerim.length >= 3) {
      // Hole must wind CW inside CCW outer square
      const hole = new THREE.Path();
      for (let i = outerPerim.length - 1; i >= 0; i--) {
        const [px, py] = outerPerim[i];
        if (i === outerPerim.length - 1) hole.moveTo(px * MM, py * MM);
        else hole.lineTo(px * MM, py * MM);
      }
      hole.closePath();
      sheetShape.holes.push(hole);
    }

    const outerGeo = buildDualSidedPaperGeometry(sheetShape, 0, 0, spec.yawOffset);
    outerCutoutMesh = new THREE.Mesh(outerGeo, cutoutMats);
    outerCutoutMesh.castShadow = false;
    outerCutoutMesh.receiveShadow = false;
    cutoutRoot.add(outerCutoutMesh);
  }

  // ---- Flat-Folded Kirigami Window Flaps, Shutters, Top-Hung Awnings, Louvers, Sills & Hinged Doors! ----
  const makeLeafShape = (
    x0: number,
    x1: number,
    yTop: number,
    yBot: number,
    archKind: 'rect' | 'arched-full' | 'arched-left' | 'arched-right' | 'lancet-full' | 'lancet-left' | 'lancet-right',
  ): THREE.Shape => {
    // Remember in buildDualSidedPaperGeometry: local Z = -shapeY, so top (+Z) is yTop (smaller Y), bottom (-Z) is yBot (larger Y)!
    const s = new THREE.Shape();
    const w = x1 - x0;
    const h = yBot - yTop;
    if (archKind === 'rect' || h < 0.1 || w < 0.05) {
      s.moveTo(x0, yTop);
      s.lineTo(x1, yTop);
      s.lineTo(x1, yBot);
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    if (archKind === 'arched-full') {
      const r = Math.min(w * 0.5, h * 0.42);
      const springY = yTop + r;
      const cx = (x0 + x1) * 0.5;
      s.moveTo(x0, yBot);
      s.lineTo(x1, yBot);
      s.lineTo(x1, springY);
      const segs = 10;
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * Math.PI;
        s.lineTo(cx + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    if (archKind === 'arched-left') {
      const r = Math.min(w, h * 0.42);
      const springY = yTop + r;
      s.moveTo(x0, yBot);
      s.lineTo(x1, yBot);
      s.lineTo(x1, yTop);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const a = Math.PI * 0.5 + (i / segs) * Math.PI * 0.5;
        s.lineTo(x1 + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    if (archKind === 'arched-right') {
      const r = Math.min(w, h * 0.42);
      const springY = yTop + r;
      s.moveTo(x0, yBot);
      s.lineTo(x1, yBot);
      s.lineTo(x1, springY);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 0.5;
        s.lineTo(x0 + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    // Lancet full / left / right
    const springY = yBot - h * 0.56;
    const archH = Math.max(0.05, springY - yTop);
    const segs = 5;
    if (archKind === 'lancet-full') {
      const cx = (x0 + x1) * 0.5;
      const hw = w * 0.5;
      s.moveTo(x0, yBot);
      s.lineTo(x1, yBot);
      s.lineTo(x1, springY);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        s.lineTo(cx + hw * Math.cos(t * Math.PI * 0.5), springY - archH * Math.pow(Math.sin(t * Math.PI * 0.5), 0.72));
      }
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        s.lineTo(cx - hw * Math.sin(t * Math.PI * 0.5), springY - archH * Math.pow(Math.cos(t * Math.PI * 0.5), 0.72));
      }
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    if (archKind === 'lancet-left') {
      s.moveTo(x0, yBot);
      s.lineTo(x1, yBot);
      s.lineTo(x1, yTop);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        s.lineTo(x1 - w * Math.sin(t * Math.PI * 0.5), springY - archH * Math.pow(Math.cos(t * Math.PI * 0.5), 0.72));
      }
      s.lineTo(x0, yBot);
      s.closePath();
      return s;
    }
    s.moveTo(x0, yBot);
    s.lineTo(x1, yBot);
    s.lineTo(x1, springY);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      s.lineTo(x0 + w * Math.cos(t * Math.PI * 0.5), springY - archH * Math.pow(Math.sin(t * Math.PI * 0.5), 0.72));
    }
    s.lineTo(x0, yBot);
    s.closePath();
    return s;
  };

  type LeafArchKind =
    | 'rect'
    | 'arched-full'
    | 'arched-left'
    | 'arched-right'
    | 'lancet-full'
    | 'lancet-left'
    | 'lancet-right';

  const makeInsetArchHole = (
    x0: number,
    x1: number,
    yTop: number,
    yBot: number,
    archKind: LeafArchKind,
    outerR: number,
    frame: number,
  ): THREE.Path => {
    const p = new THREE.Path();
    const w = x1 - x0;
    const h = yBot - yTop;
    if (archKind === 'rect' || w < 0.04 || h < 0.04) {
      p.moveTo(x0, yTop);
      p.lineTo(x0, yBot);
      p.lineTo(x1, yBot);
      p.lineTo(x1, yTop);
      p.closePath();
      return p;
    }
    if (archKind === 'arched-full') {
      const r = Math.max(0.02, Math.min(w * 0.5, h * 0.44, Math.max(0.02, outerR - frame)));
      const springY = yTop + r;
      const cx = (x0 + x1) * 0.5;
      p.moveTo(x0, yBot);
      p.lineTo(x0, springY);
      const segs = 10;
      for (let i = 1; i <= segs; i++) {
        const a = Math.PI - (i / segs) * Math.PI;
        p.lineTo(cx + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      p.lineTo(x1, yBot);
      p.closePath();
      return p;
    }
    if (archKind === 'arched-left') {
      const r = Math.max(0.02, Math.min(w, h * 0.44, Math.max(0.02, outerR - frame)));
      const springY = yTop + r;
      p.moveTo(x0, yBot);
      p.lineTo(x0, springY);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const a = Math.PI - (i / segs) * Math.PI * 0.5;
        p.lineTo(x1 + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      p.lineTo(x1, yBot);
      p.closePath();
      return p;
    }
    if (archKind === 'arched-right') {
      const r = Math.max(0.02, Math.min(w, h * 0.44, Math.max(0.02, outerR - frame)));
      const springY = yTop + r;
      p.moveTo(x0, yBot);
      p.lineTo(x0, yTop);
      const segs = 6;
      for (let i = 1; i <= segs; i++) {
        const a = Math.PI * 0.5 - (i / segs) * Math.PI * 0.5;
        p.lineTo(x0 + Math.cos(a) * r, springY - Math.sin(a) * r);
      }
      p.lineTo(x1, yBot);
      p.closePath();
      return p;
    }
    const springY = yBot - h * 0.56;
    const archH = Math.max(0.04, springY - yTop);
    const segs = 5;
    if (archKind === 'lancet-full') {
      const cx = (x0 + x1) * 0.5;
      const hw = w * 0.5;
      p.moveTo(x0, yBot);
      p.lineTo(x0, springY);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        p.lineTo(cx - hw * Math.cos(t * Math.PI * 0.5), springY - archH * Math.pow(Math.sin(t * Math.PI * 0.5), 0.72));
      }
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        p.lineTo(cx + hw * Math.sin(t * Math.PI * 0.5), springY - archH * Math.pow(Math.cos(t * Math.PI * 0.5), 0.72));
      }
      p.lineTo(x1, yBot);
      p.closePath();
      return p;
    }
    if (archKind === 'lancet-left') {
      p.moveTo(x0, yBot);
      p.lineTo(x0, springY);
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        p.lineTo(x1 - w * Math.cos(t * Math.PI * 0.5), springY - archH * Math.pow(Math.sin(t * Math.PI * 0.5), 0.72));
      }
      p.lineTo(x1, yBot);
      p.closePath();
      return p;
    }
    p.moveTo(x0, yBot);
    p.lineTo(x0, yTop);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      p.lineTo(x0 + w * Math.sin(t * Math.PI * 0.5), springY - archH * Math.pow(Math.cos(t * Math.PI * 0.5), 0.72));
    }
    p.lineTo(x1, yBot);
    p.closePath();
    return p;
  };

  /**
   * Punch real hollow glass cutout(s) inside every hinged window leaf so every moving leaf is a true
   * architectural frame — mostly 1 crisp glass cutout, and occasionally 6 (`2×3`) or 12 (`3×4`) muntin panes!
   */
  const punchLeafFrameCutouts = (
    leafShape: THREE.Shape,
    x0: number,
    x1: number,
    yTop: number,
    yBot: number,
    archKind: LeafArchKind,
    detail: WindowDetail,
    isHalfLeaf: boolean,
    isDoor: boolean,
    isLouverSlat = false,
  ): void => {
    const w = x1 - x0;
    const h = yBot - yTop;
    const frame = isLouverSlat
      ? Math.min(0.042, Math.max(0.026, Math.min(w * 0.08, h * 0.20)))
      : Math.min(0.058, Math.max(0.032, Math.min(w, h) * 0.115));

    const ix0 = x0 + frame;
    const ix1 = x1 - frame;
    const iyTop = yTop + frame;
    // Doors keep a solid bottom kick-panel (~34% of door height) with a framed upper glass lite!
    const iyBot = isDoor ? yTop + Math.max(h * 0.58, frame + 0.10) : yBot - frame;
    const gw = ix1 - ix0;
    const gh = iyBot - iyTop;
    if (gw < 0.055 || gh < 0.055) return;

    const addBoxGrid = (bx0: number, bx1: number, by0: number, by1: number, reqCols: number, reqRows: number, isTransom = false) => {
      const bw = bx1 - bx0;
      const bh = by1 - by0;
      const bar = Math.min(0.030, Math.max(0.019, Math.min(bw, bh) * 0.058));
      let cols = Math.max(1, reqCols);
      let rows = Math.max(1, reqRows);
      const minPane = 0.044;
      while (cols > 1 && (bw - bar * (cols - 1)) / cols < minPane) cols--;
      while (rows > 1 && (bh - bar * (rows - 1)) / rows < minPane) rows--;
      if (isTransom && cols === 1 && rows === 2 && bh >= minPane * 2 + bar) {
        const topH = (bh - bar) * 0.34;
        const botH = bh - bar - topH;
        addRectHole(leafShape, (bx0 + bx1) * 0.5, by0 + topH * 0.5, bw, topH);
        addRectHole(leafShape, (bx0 + bx1) * 0.5, by0 + topH + bar + botH * 0.5, bw, botH);
        return;
      }
      const paneW = (bw - bar * (cols - 1)) / cols;
      const paneH = (bh - bar * (rows - 1)) / rows;
      if (paneW < 0.036 || paneH < 0.036) return;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = bx0 + paneW * 0.5 + c * (paneW + bar);
          const cy = by0 + paneH * 0.5 + r * (paneH + bar);
          addRectHole(leafShape, cx, cy, paneW, paneH);
        }
      }
    };

    let reqCols = 1;
    let reqRows = 1;
    if (isLouverSlat) {
      if (detail === 'twelve') reqCols = 4;
      else if (detail === 'six') reqCols = 3;
      else if (detail === 'triple') reqCols = 3;
      else if (detail === 'cross') reqCols = 2;
    } else if (isDoor) {
      if (detail === 'twelve') {
        reqCols = isHalfLeaf ? 2 : 3;
        reqRows = 2;
      } else if (detail === 'six') {
        reqCols = isHalfLeaf ? 1 : 2;
        reqRows = 2;
      }
    } else if (detail === 'twelve') {
      if (isHalfLeaf) {
        reqCols = 2;
        reqRows = 3;
      } else {
        const landscape = gw > gh * 1.15;
        reqCols = landscape ? 4 : 3;
        reqRows = landscape ? 3 : 4;
      }
    } else if (detail === 'six') {
      if (isHalfLeaf) {
        reqCols = 1;
        reqRows = 3;
      } else {
        const landscape = gw > gh * 1.15;
        reqCols = landscape ? 3 : 2;
        reqRows = landscape ? 2 : 3;
      }
    } else if (detail === 'cross') {
      reqCols = isHalfLeaf ? 1 : 2;
      reqRows = 2;
    } else if (detail === 'triple') {
      reqCols = isHalfLeaf ? 1 : 3;
      reqRows = isHalfLeaf ? 2 : 1;
    } else if (detail === 'transom') {
      reqCols = 1;
      reqRows = 2;
    }

    if (archKind === 'rect') {
      addBoxGrid(ix0, ix1, iyTop, iyBot, reqCols, reqRows, detail === 'transom');
      return;
    }

    const outerR = Math.min(archKind === 'arched-full' ? w * 0.5 : w, h * 0.42);
    if (reqCols === 1 && reqRows === 1) {
      leafShape.holes.push(makeInsetArchHole(ix0, ix1, iyTop, iyBot, archKind, outerR, frame));
      return;
    }

    const springY = archKind.startsWith('lancet') ? yBot - h * 0.56 : yTop + outerR;
    const bar = 0.024;
    const fanBot = springY - bar * 0.5;
    const lowTop = springY + bar * 0.5;
    if (fanBot - iyTop >= 0.055 && iyBot - lowTop >= 0.065) {
      leafShape.holes.push(makeInsetArchHole(ix0, ix1, iyTop, fanBot, archKind, outerR, frame));
      addBoxGrid(ix0, ix1, lowTop, iyBot, reqCols, Math.max(1, reqRows - 1), false);
    } else {
      leafShape.holes.push(makeInsetArchHole(ix0, ix1, iyTop, iyBot, archKind, outerR, frame));
    }
  };

  // Deterministic PRNG for organic per-window open angles & stratified ventilation subset selection
  let winRngState =
    ((spec.generation * 2654435761) ^
      ((spec.village?.seed ?? 0) * 1597334677) ^
      (Math.round(spec.W * 10) * 3812015801) ^
      (Math.round(spec.H * 10) * 2246822519)) >>>
    0;
  if (winRngState === 0) winRngState = 1337;
  const nextWinRand = () => {
    winRngState = (winRngState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(winRngState ^ (winRngState >>> 15), 1 | winRngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const windowDetailGroups: KirigamiDetailRig[][] = [];
  const doorDetailGroups: KirigamiDetailRig[][] = [];

  // Skip per-window micro shutter/louver sub-meshes in `'city'` LOD0 mode (punched wall openings +
  // roof dormers/chimneys remain crisp while cutting draw calls per city house ~6.5×!)
  if (!isCityDetail) for (const [panelId, feats] of wallHingedByPanel) {
    const def = net.panelMap.get(panelId);
    const pv = panels.get(panelId);
    if (!def || !pv || !def.wallFrame) continue;
    const wf = def.wallFrame;
    const wallTriMats = triMatsForSlot(def.colorSlot ?? 0);
    const wallDetailMats = [mats.outsideSlots[def.colorSlot ?? 0], mats.edge, mats.outsideSlots[def.colorSlot ?? 0]];
    const rotY = Math.atan2(wf.vAxis[0], -wf.vAxis[1]);
    const kerf = 0.24; // Crisp 0.24 mm laser-cut paper clearance

    for (const f of feats) {
      const sx = wf.origin[0] + wf.uAxis[0] * f.u + wf.vAxis[0] * f.vCenter;
      const sy = wf.origin[1] + wf.uAxis[1] * f.u + wf.vAxis[1] * f.vCenter;
      const fg = new THREE.Group();
      fg.position.set(
        (sx - def.hingeOrigin[0]) * MM,
        0,
        -(sy - def.hingeOrigin[1]) * MM,
      );
      fg.rotation.y = rotY;
      pv.pivot.add(fg);

      const hw = f.w * 0.5 * MM;
      const hh = f.h * 0.5 * MM;
      const kw = Math.max(0.12, (f.w - kerf) * MM);
      const kh = Math.max(0.12, (f.h - kerf) * MM);

      const mountLeaf = (
        px: number,
        py: number,
        pz: number,
        leafShape: THREE.Shape,
        axis: 'x' | 'z',
        targetAngle: number,
        kind: 'fixed' | 'window',
        matsArr: THREE.Material[],
        windowType?: 'top-hung' | 'side-hung' | 'door',
      ): KirigamiDetailRig => {
        const lPivot = new THREE.Group();
        lPivot.position.set(px, py, pz);
        fg.add(lPivot);
        const geo = buildDualSidedPaperGeometry(leafShape, sx * MM, -sy * MM, spec.yawOffset, 0, PAPER_THICK * 0.85);
        const m = new THREE.Mesh(geo, matsArr);
        m.castShadow = true;
        m.receiveShadow = true;
        allMeshes.push(m);
        lPivot.add(m);
        const entry: KirigamiDetailRig = {
          pivot: lPivot,
          axis,
          targetAngle,
          driverPanel: panelId,
          kind,
          windowType,
        };
        details.push(entry);
        return entry;
      };

      if (f.mode === 'sill') {
        const sillD = Math.min(2.6, Math.max(1.5, f.w * 0.24)) * MM;
        const sShape = makeLeafShape(-hw, hw, -sillD, 0, 'rect');
        mountLeaf(0, -PAPER_THICK, -hh, sShape, 'x', 1.57, 'fixed', wallDetailMats);
        continue;
      }

      if (f.mode === 'awning') {
        // Top-hung kirigami window opening FROM ABOVE: strictly 20%–30% tilt (`18°–27°`)!
        const aShape = makeLeafShape(-kw * 0.5, kw * 0.5, 0, kh, 'rect');
        punchLeafFrameCutouts(aShape, -kw * 0.5, kw * 0.5, 0, kh, 'rect', f.detail, false, false);
        const tiltRad = -(0.20 + nextWinRand() * 0.10) * (Math.PI * 0.5);
        const det = mountLeaf(0, 0, hh, aShape, 'x', tiltRad, 'window', wallTriMats, 'top-hung');
        windowDetailGroups.push([det]);
        continue;
      }

      if (f.mode === 'louver') {
        // Two stacked horizontal top-hung framed slats tilting outward 20%–30% (`18°–27°`) in parallel unison!
        const slatH = Math.max(0.10, (f.h * 0.45 - 0.14) * MM);
        const sShape1 = makeLeafShape(-kw * 0.5, kw * 0.5, 0, slatH, 'rect');
        const sShape2 = makeLeafShape(-kw * 0.5, kw * 0.5, 0, slatH, 'rect');
        punchLeafFrameCutouts(sShape1, -kw * 0.5, kw * 0.5, 0, slatH, 'rect', f.detail, false, false, true);
        punchLeafFrameCutouts(sShape2, -kw * 0.5, kw * 0.5, 0, slatH, 'rect', f.detail, false, false, true);
        const tiltRad = -(0.20 + nextWinRand() * 0.10) * (Math.PI * 0.5);
        const d1 = mountLeaf(0, 0, hh, sShape1, 'x', tiltRad, 'window', wallTriMats, 'top-hung');
        const d2 = mountLeaf(0, 0, 0.01 * MM, sShape2, 'x', tiltRad, 'window', wallTriMats, 'top-hung');
        windowDetailGroups.push([d1, d2]);
        continue;
      }

      if (f.mode === 'shutters' || f.mode === 'door-double') {
        const isDoor = f.mode === 'door-double';
        const leafW = Math.max(0.10, (f.w * 0.5 - kerf * 0.75) * MM);
        const leftKind: LeafArchKind =
          f.style === 'arched' ? 'arched-left' : f.style === 'lancet' ? 'lancet-left' : 'rect';
        const rightKind: LeafArchKind =
          f.style === 'arched' ? 'arched-right' : f.style === 'lancet' ? 'lancet-right' : 'rect';
        const lShape = makeLeafShape(0, leafW, -kh * 0.5, kh * 0.5, leftKind);
        const rShape = makeLeafShape(-leafW, 0, -kh * 0.5, kh * 0.5, rightKind);
        punchLeafFrameCutouts(lShape, 0, leafW, -kh * 0.5, kh * 0.5, leftKind, f.detail, true, isDoor);
        punchLeafFrameCutouts(rShape, -leafW, 0, -kh * 0.5, kh * 0.5, rightKind, f.detail, true, isDoor);
        const maxAng = isDoor ? 0.52 + nextWinRand() * 0.34 : 1.42 + nextWinRand() * 0.42;
        const wType = isDoor ? 'door' : 'side-hung';
        const dL = mountLeaf(-hw, 0, 0, lShape, 'z', -maxAng, 'window', wallTriMats, wType);
        const dR = mountLeaf(hw, 0, 0, rShape, 'z', maxAng, 'window', wallTriMats, wType);
        if (isDoor) doorDetailGroups.push([dL, dR]);
        else windowDetailGroups.push([dL, dR]);
        continue;
      }

      if (f.mode === 'casement' || f.mode === 'door-single') {
        const isDoor = f.mode === 'door-single';
        const fullKind: LeafArchKind =
          f.style === 'arched' ? 'arched-full' : f.style === 'lancet' ? 'lancet-full' : 'rect';
        const cShape = makeLeafShape(0, kw, -kh * 0.5, kh * 0.5, fullKind);
        punchLeafFrameCutouts(cShape, 0, kw, -kh * 0.5, kh * 0.5, fullKind, f.detail, false, isDoor);
        const maxAng = isDoor ? 0.48 + nextWinRand() * 0.32 : 0.52 + nextWinRand() * 0.36;
        const wType = isDoor ? 'door' : 'side-hung';
        const det = mountLeaf(-hw, 0, 0, cShape, 'z', -maxAng, 'window', wallTriMats, wType);
        if (isDoor) doorDetailGroups.push([det]);
        else windowDetailGroups.push([det]);
      }
    }
  }

  // Assign stratified shuffled `openRank` across all hinged window groups so `% random` opens
  // an exact, spatially scattered fraction of windows to air out the house!
  for (let i = windowDetailGroups.length - 1; i > 0; i--) {
    const j = Math.floor(nextWinRand() * (i + 1));
    const tmp = windowDetailGroups[i];
    windowDetailGroups[i] = windowDetailGroups[j];
    windowDetailGroups[j] = tmp;
  }
  const winGroupCount = windowDetailGroups.length;
  for (let i = 0; i < winGroupCount; i++) {
    const rank = (i + 0.5) / winGroupCount;
    for (const det of windowDetailGroups[i]) det.openRank = rank;
  }
  // Doors stay neatly closed at low/moderate ventilation ratios and crack open at high `%` or `All open`
  const doorGroupCount = doorDetailGroups.length;
  for (let i = 0; i < doorGroupCount; i++) {
    const rank = 0.58 + ((i + 0.5) / Math.max(1, doorGroupCount)) * 0.38;
    for (const det of doorDetailGroups[i]) det.openRank = rank;
  }

  // ---- Flat-Folded Kirigami Architectural Details (Awning, Chimney, Roof Dormers!) ----
  // Every detail mounts via `wallFrame` / `roofFrame`, working identically on single houses AND multi-house villages!

  // A. Front entry paper canopy awnings (works for every building in a village & tracks off-center doors!)
  for (const frontDef of net.panels) {
    if (!frontDef.isFront || !frontDef.wallFrame || frontDef.skipOpenings) continue;
    const frontPv = panels.get(frontDef.id);
    const bSpec = frontDef.panelSpec ?? spec;
    const groundLv = bSpec.architecture?.facades.front.levels[0] ?? null;
    const wantsAwning = groundLv ? Boolean(groundLv.door?.awning) : bSpec.hasAwning && bSpec.door !== 'none' && bSpec.door !== 'arcade';
    if (!frontPv || !wantsAwning) continue;

    const wf = frontDef.wallFrame;
    const frontLevels = bSpec.architecture?.facades.front.levels;
    const levels = wf.wallLevels ?? (frontLevels ? frontLevels.length : bSpec.levels);
    const weightSum = frontLevels
      ? frontLevels.slice(0, levels).reduce((acc, lv) => acc + lv.heightWeight, 0) || levels
      : levels;
    const groundStoryH = wf.heightMm * ((groundLv ? groundLv.heightWeight : 1) / weightSum);
    const awningYmm = Math.min(groundStoryH * 0.72, 15.2);
    const doorU = groundLv ? (computeDoorCenterU(wf.widthMm, groundLv) ?? 0) : 0;
    const maxAwW = Math.max(6.5, (wf.widthMm * 0.5 - Math.abs(doorU)) * 1.75);
    const awW = Math.min(wf.widthMm * 0.40, 14.5, maxAwW);
    const awD = Math.min(6.4, Math.max(4.0, wf.widthMm * 0.14));

    const sx = wf.origin[0] + wf.uAxis[0] * doorU + wf.vAxis[0] * awningYmm;
    const sy = wf.origin[1] + wf.uAxis[1] * doorU + wf.vAxis[1] * awningYmm;
    const frameGroup = new THREE.Group();
    frameGroup.position.set(
      (sx - frontDef.hingeOrigin[0]) * MM,
      -PAPER_THICK,
      -(sy - frontDef.hingeOrigin[1]) * MM,
    );
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

    const aGeo = buildDualSidedPaperGeometry(
      aShape,
      sx * MM,
      -sy * MM,
      spec.yawOffset,
      0,
      PAPER_THICK * 0.75,
      curveSegs,
      useSingleGroup,
    );
    const aMesh = new THREE.Mesh(aGeo, detailMatsForSlot(frontDef.colorSlot ?? 0));
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

  // Group panels by building (`islandIndex ?? 0`) so each house in a village gets its own chimney & dormers!
  const buildingPanels = new Map<number, PanelNetDef[]>();
  for (const def of net.panels) {
    const idx = def.islandIndex ?? 0;
    const list = buildingPanels.get(idx);
    if (list) list.push(def);
    else buildingPanels.set(idx, [def]);
  }

  for (const [, bList] of buildingPanels) {
    const roofLDef = bList.find((p) => (p.localId ?? p.id) === 'roofL');
    const roofRDef = bList.find((p) => (p.localId ?? p.id) === 'roofR');
    const bSpec = roofLDef?.panelSpec ?? roofRDef?.panelSpec ?? spec;
    const bSlot = roofLDef?.colorSlot ?? roofRDef?.colorSlot ?? 0;
    const bDetailMats = detailMatsForSlot(bSlot);

    // B. Kirigami folded L-corner 3D chimney stack on roof
    const wantsDormersOnR =
      bSpec.dormerCount > 0 && Boolean(roofRDef) && (bSpec.roofType === 'gable' || bSpec.roofType === 'mansard');
    const chimneyDef =
      bSpec.topology === 'lwing'
        ? roofLDef
        : wantsDormersOnR
          ? (roofLDef ?? roofRDef)
          : (roofRDef ?? roofLDef);
    const chimneyHost = chimneyDef ? panels.get(chimneyDef.id) : undefined;

    if (bSpec.hasChimney && chimneyHost && chimneyDef?.roofFrame) {
      const rf = chimneyDef.roofFrame;
      const chW = Math.min(6.4, Math.max(4.0, rf.widthMm * 0.085));
      const chH =
        bSpec.roofType === 'flat'
          ? Math.min(10.5, Math.max(7.2, bSpec.H * 0.2))
          : Math.min(12.5, Math.max(7.4, rf.slantMm * 0.34));
      const offSlope = Math.min(rf.slantMm * 0.46, Math.max(8.5, rf.slantMm * 0.36));
      const offRidge = -rf.widthMm * 0.20;

      const sx = rf.origin[0] + rf.slopeAxis[0] * offSlope + rf.ridgeAxis[0] * offRidge;
      const sy = rf.origin[1] + rf.slopeAxis[1] * offSlope + rf.ridgeAxis[1] * offRidge;

      const frameGroup = new THREE.Group();
      frameGroup.position.set(
        (sx - chimneyDef.hingeOrigin[0]) * MM,
        -PAPER_THICK,
        -(sy - chimneyDef.hingeOrigin[1]) * MM,
      );
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

      const cGeo = buildDualSidedPaperGeometry(
        cShape,
        sx * MM,
        -sy * MM,
        spec.yawOffset,
        0,
        PAPER_THICK * 0.85,
        curveSegs,
        useSingleGroup,
      );
      const cMesh = new THREE.Mesh(cGeo, bDetailMats);
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
        curveSegs,
        useSingleGroup,
      );
      const cheekMesh = new THREE.Mesh(cheekGeo, bDetailMats);
      cheekMesh.castShadow = true;
      cheekMesh.receiveShadow = true;
      allMeshes.push(cheekMesh);
      cheekPivot.add(cheekMesh);

      details.push({
        pivot: cPivot,
        axis: 'z',
        targetAngle: bSpec.roofType === 'flat' ? -Math.PI * 0.5 : -(Math.PI * 0.5 - bSpec.pitch),
        driverPanel: chimneyDef.id,
      });
      details.push({
        pivot: cheekPivot,
        axis: 'x',
        targetAngle: -Math.PI * 0.5,
        driverPanel: chimneyDef.id,
      });
    }

    // C. Kirigami pop-up roof dormers on `roofR`
    const dormerHost = roofRDef ? panels.get(roofRDef.id) : undefined;
    if (wantsDormersOnR && dormerHost && roofRDef?.roofFrame) {
      const rf = roofRDef.roofFrame;
      const dW = Math.min(9.4, Math.max(6.2, rf.widthMm * 0.125));
      const dH = Math.min(rf.slantMm * 0.34, Math.max(6.4, bSpec.H * 0.24));
      const offSlope = Math.min(rf.slantMm * 0.26, Math.max(5.5, rf.slantMm * 0.22));
      const topHalfD =
        bSpec.roofType === 'mansard'
          ? Math.max(0, rf.widthMm * 0.5 - Math.min(bSpec.W, bSpec.D) * 0.5 * (1 - bSpec.mansardRatio))
          : rf.widthMm * 0.5;
      const safeHalfR = topHalfD - dW * 0.72;
      const ridgePositions =
        bSpec.dormerCount === 2 && safeHalfR >= dW * 0.78
          ? [-Math.min(rf.widthMm * 0.21, safeHalfR), Math.min(rf.widthMm * 0.21, safeHalfR)]
          : [0];

      for (const offR of ridgePositions) {
        const sx = rf.origin[0] + rf.slopeAxis[0] * offSlope + rf.ridgeAxis[0] * offR;
        const sy = rf.origin[1] + rf.slopeAxis[1] * offSlope + rf.ridgeAxis[1] * offR;

        const frameGroup = new THREE.Group();
        frameGroup.position.set(
          (sx - roofRDef.hingeOrigin[0]) * MM,
          -PAPER_THICK,
          -(sy - roofRDef.hingeOrigin[1]) * MM,
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

        const dGeo = buildDualSidedPaperGeometry(
          dShape,
          sx * MM,
          -sy * MM,
          spec.yawOffset,
          0,
          PAPER_THICK * 0.8,
          curveSegs,
          useSingleGroup,
        );
        const dMesh = new THREE.Mesh(dGeo, bDetailMats);
        dMesh.castShadow = true;
        dMesh.receiveShadow = true;
        allMeshes.push(dMesh);
        dPivot.add(dMesh);

        details.push({
          pivot: dPivot,
          axis: 'z',
          targetAngle: -(Math.PI * 0.5 - bSpec.pitch),
          driverPanel: roofRDef.id,
        });
      }
    }
  }

  let linesAllowed = true;
  let curRelief = 1;
  let forceFlatShadows = false;
  let windowOpenMode: WindowOpenMode = 'random';
  let windowOpenRatio = 0.35;
  const lastPanelFold = new Map<FoldablePanelId, number>();

  const syncShadowsForPanels = () => {
    let anyRaised = false;
    panels.forEach((pv, pid) => {
      const f = lastPanelFold.get(pid) ?? 0;
      const raised = forceFlatShadows || f > 0.065;
      if (raised) anyRaised = true;
      pv.mesh.castShadow = raised;
    });
    for (const det of details) {
      const f = lastPanelFold.get(det.driverPanel) ?? 0;
      const raised = forceFlatShadows || f > 0.065;
      det.pivot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = raised;
      });
    }
    if (baseMesh) {
      baseMesh.castShadow = forceFlatShadows || (anyRaised && curRelief > 0.45);
    }
  };

  const applyDetailAngle = (det: KirigamiDetailRig, fold01: number) => {
    const start = det.kind === 'window' ? 0.52 : 0.35;
    const dt = Math.max(0, Math.min(1, (fold01 - start) / (1 - start)));
    const eased = dt * dt * (3 - 2 * dt);
    let scale = 1;
    if (det.kind === 'window') {
      if (windowOpenMode === 'closed') {
        scale = 0;
      } else if (windowOpenMode === 'open') {
        scale = 1;
      } else {
        scale = (det.openRank ?? 0) < windowOpenRatio ? 1 : 0;
      }
    }
    const ang = det.targetAngle * eased * scale;
    if (det.axis === 'x') det.pivot.rotation.x = ang;
    else det.pivot.rotation.z = ang;
  };

  const updatePanelVisual = (
    id: FoldablePanelId,
    fold01: number,
    peekRad: number,
    hovered: boolean,
  ) => {
    const pv = panels.get(id);
    if (!pv) return;
    lastPanelFold.set(id, fold01);
    const baseAngle = Math.max(0, Math.min(1, fold01)) * pv.targetAngle;
    const effective = Math.max(0, Math.min(pv.targetAngle + 0.04, baseAngle + peekRad));
    pv.pivot.quaternion.setFromAxisAngle(pv.hingeAxis3D, effective);

    if (pv.foldLine) {
      pv.foldLine.material = hovered
        ? mats.foldLineActive
        : pv.isMountain
          ? mats.foldLineMountain
          : mats.foldLine;
      // Keep fold lines hidden on untouched flat projected sheets until this panel actually begins raising!
      const lineActive = curRelief > 0.38 ? fold01 < 0.96 : fold01 > 0.018 && fold01 < 0.96;
      pv.foldLine.visible = linesAllowed && (lineActive || hovered);
    }

    // Shadows ONLY appear on a panel once it genuinely starts lifting off the flat plane!
    const raised = fold01 > 0.065;
    pv.mesh.castShadow = raised;

    // Drive any attached kirigami pop-up details & hinged window leaves smoothly as their host panel folds shut!
    for (const det of details) {
      if (det.driverPanel !== id) continue;
      applyDetailAngle(det, fold01);
      det.pivot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.castShadow = raised;
      });
    }
  };

  const setWindowOpen = (mode: WindowOpenMode, ratio = windowOpenRatio) => {
    windowOpenMode = mode;
    windowOpenRatio = Math.max(0, Math.min(1, ratio));
    for (const det of details) {
      if (det.kind !== 'window') continue;
      applyDetailAngle(det, lastPanelFold.get(det.driverPanel) ?? 0);
    }
  };

  const setFoldLinesVisible = (visible: boolean) => {
    linesAllowed = visible;
    panels.forEach((pv) => {
      if (pv.foldLine && !visible) pv.foldLine.visible = false;
    });
  };

  // Controls flat-sheet blank-paper reveal, fold-line fade, & shadow gating:
  // 0 on the exact projection swap frame -> 100% invisible flat sheet, edges, & shadows while keeping
  // true 3D height (`scale.y = 1`) so raising walls emerge organically from white space as they lift!
  const setPaperRelief = (relief01: number, forceFlatShadow = false) => {
    const r = Math.max(0, Math.min(1, relief01));
    curRelief = r;
    forceFlatShadows = forceFlatShadow;
    mats.projUniforms.uPaperReveal.value = r;
    mats.foldLine.opacity = 0.14 * r;
    mats.foldLineMountain.opacity = 0.22 * r;
    root.scale.y = 1;
    root.position.y = PAPER_THICK;
    syncShadowsForPanels();
  };

  // Animate the die-cut outer paper sheet + punched window chads falling cleanly down into the void!
  // Returns `true` while still falling, `false` once completely faded & hidden below.
  const updateCutoutDrop = (elapsedSec: number): boolean => {
    if (!cutoutRoot || !outerCutoutMesh) return false;
    if (elapsedSec <= 0) {
      cutoutRoot.visible = true;
      outerCutoutMesh.position.set(0, 0, 0);
      outerCutoutMesh.rotation.set(0, 0, 0);
      outerCutoutMesh.castShadow = false;
      for (const ch of fallingChads) {
        ch.mesh.position.set(ch.baseX, 0, ch.baseZ);
        ch.mesh.rotation.set(0, 0, 0);
        ch.mesh.castShadow = false;
      }
      mats.setCutoutOpacity(1);
      return true;
    }

    const fadeStart = 0.42;
    const fadeEnd = 0.96;
    if (elapsedSec >= fadeEnd) {
      cutoutRoot.visible = false;
      outerCutoutMesh.castShadow = false;
      for (const ch of fallingChads) ch.mesh.castShadow = false;
      mats.setCutoutOpacity(0);
      return false;
    }

    cutoutRoot.visible = true;
    const ft = Math.max(0, elapsedSec - 0.05);
    const ft2 = ft * ft;
    const dropDir = mats.projUniforms.uProjSide.value < 0 ? 1 : -1;
    const dropScale = mats.projUniforms.uProjSide.value < 0 ? 22 : 30;
    outerCutoutMesh.castShadow = ft > 0.08;
    outerCutoutMesh.position.set(0.65 * ft2, dropDir * dropScale * ft2, 0.45 * ft2);
    outerCutoutMesh.rotation.set(0.14 * ft2, 0, -0.10 * ft2);

    for (const ch of fallingChads) {
      const ct = Math.max(0, elapsedSec - ch.delay);
      const ct2 = ct * ct;
      ch.mesh.castShadow = ct > 0.08;
      ch.mesh.position.set(
        ch.baseX + ch.driftX * ct2,
        dropDir * ch.grav * (dropDir > 0 ? 0.75 : 1) * ct2,
        ch.baseZ + ch.driftZ * ct2,
      );
      ch.mesh.rotation.set(ch.spinX * ct, 0, ch.spinZ * ct);
    }

    if (elapsedSec > fadeStart) {
      const u = (elapsedSec - fadeStart) / (fadeEnd - fadeStart);
      mats.setCutoutOpacity(1 - u * u * (3 - 2 * u));
    } else {
      mats.setCutoutOpacity(1);
    }
    return true;
  };

  return {
    net,
    root,
    baseMesh,
    panelIds: net.foldableIds,
    panels,
    details,
    hasCutout: Boolean(cutoutRoot),
    updatePanelVisual,
    setWindowOpen,
    updateCutoutDrop,
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
