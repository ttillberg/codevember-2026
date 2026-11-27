import * as THREE from 'three';
import type { BaseKind, FlavorId, ToppingId } from './recipe';
import { FLAVOR_LIST, FLAVOR_MAP, TOPPING_LIST } from './recipe';
import { createToppingThumbSpecimen } from './fruits';

export interface CustomizeIconSet {
  bases: Record<BaseKind, string>;
  /** Textured circular taste medallions — visual texture adapts to Water (icy translucent) vs Milk (creamy marbled)! */
  flavors: Record<BaseKind, Record<FlavorId, string>>;
  toppings: Record<ToppingId, string>;
}

/**
 * Generates an organically beveled rounded 3D ice cube geometry for the Water & Concentrated Milk bases.
 */
function createRoundedIceCubeGeometry(subdiv = 22): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1, subdiv, subdiv, subdiv);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const radius = 0.24;
  const halfInner = 0.5 - radius;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = Math.max(-halfInner, Math.min(halfInner, v.x));
    const cy = Math.max(-halfInner, Math.min(halfInner, v.y));
    const cz = Math.max(-halfInner, Math.min(halfInner, v.z));
    const dx = v.x - cx;
    const dy = v.y - cy;
    const dz = v.z - cz;
    const dLen = Math.hypot(dx, dy, dz) || 1e-6;
    const nx = dx / dLen;
    const ny = dy / dLen;
    const nz = dz / dLen;

    let x = cx + nx * radius;
    let y = cy + ny * radius;
    let z = cz + nz * radius;

    const undul =
      0.012 * Math.sin(x * 5.8 + y * 3.2) * Math.cos(z * 5.1) +
      0.008 * Math.cos(y * 7.4 - z * 4.6);
    x += nx * undul;
    y += ny * undul;
    z += nz * undul;

    pos.setXYZ(i, x * 1.18, y * 1.14, z * 1.18);
  }
  geo.computeVertexNormals();
  return geo;
}

const SHARED_NOISE_GLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0,0,0));
    float n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0));
    float n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1));
    float n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1));
    float n111 = hash31(i + vec3(1,1,1));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }
  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.52;
    for (int i = 0; i < 3; i++) {
      v += a * noise3(p);
      p = p * 2.07 + vec3(13.1, -7.4, 5.9);
      a *= 0.5;
    }
    return v;
  }
`;

/**
 * Sparkling crystal-clear studio ice cube shader for the Water base icon.
 */
function createWaterIceCubeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      ${SHARED_NOISE_GLSL}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.05 + 0.95 * pow(1.0 - ndv, 3.0);

        vec3 pIn = vLocalPos * 4.4 - V * 0.35;
        float frost1 = noise3(pIn * 1.4);
        float frost2 = noise3(pIn * 3.2 + vec3(2.3, -1.7, 0.8));
        float internalCore = smoothstep(0.70, 0.14, length(vLocalPos));
        float frostCloud = smoothstep(0.40, 0.76, frost1 * 0.65 + frost2 * 0.35) * internalCore;
        float bubbles = smoothstep(0.76, 0.88, noise3(vLocalPos * 16.0 + vec3(4.1, 1.2, -3.5))) * internalCore;

        vec3 iceDeep   = vec3(0.66, 0.84, 0.95);
        vec3 iceGlass  = vec3(0.90, 0.96, 1.00);
        vec3 iceWhite  = vec3(1.00, 1.00, 1.00);

        vec3 lKey = normalize(vec3(-0.54, 0.78, 0.62));
        vec3 lRim = normalize(vec3(0.76, 0.46, -0.28));
        vec3 lBot = normalize(vec3(0.18, -0.82, 0.50));

        float wrapKey = clamp((dot(N, lKey) + 0.58) / 1.58, 0.0, 1.0);
        float botCaustic = pow(max(dot(N, lBot), 0.0), 1.8) * 0.75;
        float topFacet = smoothstep(0.42, 0.90, N.y);
        float refractStreak = pow(clamp(sin((vLocalPos.x * 4.6 - vLocalPos.y * 3.8 + vLocalPos.z * 2.4)) * 0.5 + 0.5, 0.0, 1.0), 3.0) * internalCore;

        vec3 col = mix(iceDeep, iceGlass, wrapKey * 0.66 + 0.34);
        col = mix(col, iceWhite, clamp(frostCloud * 0.62 + botCaustic * 0.86 + topFacet * 0.48 + refractStreak * 0.42 + bubbles * 0.95, 0.0, 0.97));

        float darkContour = smoothstep(0.48, 0.15, ndv) * smoothstep(0.02, 0.18, ndv);
        col = mix(col, vec3(0.42, 0.66, 0.82), darkContour * 0.42);
        col = mix(col, vec3(1.0, 1.0, 1.0), fresnel * 0.92);

        vec3 h1 = normalize(lKey + V);
        vec3 h2 = normalize(lRim + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 105.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 40.0);
        float windowGlint = smoothstep(0.72, 0.94, dot(reflect(-V, N), lKey));
        col += vec3(1.9, 1.96, 2.0) * (spec1 + windowGlint * 0.45) + vec3(0.95, 1.0, 1.08) * spec2 * 0.60;

        float alpha = clamp(0.42 + fresnel * 0.52 + frostCloud * 0.25 + botCaustic * 0.26 + bubbles * 0.38 + spec1 * 0.55 + windowGlint * 0.30, 0.0, 0.98);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Velvety creamy frozen concentrated-milk cube shader for the Concentrated Milk base icon.
 */
function createMilkIceCubeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      ${SHARED_NOISE_GLSL}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 3.0);

        vec3 milkShadow = vec3(0.73, 0.64, 0.52);
        vec3 milkMid    = vec3(0.95, 0.89, 0.78);
        vec3 milkLit    = vec3(1.00, 0.97, 0.90);
        vec3 milkSss    = vec3(1.05, 0.93, 0.74);

        vec3 lKey = normalize(vec3(-0.52, 0.76, 0.62));
        vec3 lFill = normalize(vec3(0.66, 0.25, 0.55));
        vec3 lRim = normalize(vec3(0.45, -0.40, -0.70));

        float nKey = clamp((dot(N, lKey) + 0.42) / 1.42, 0.0, 1.0);
        float nFill = clamp((dot(N, lFill) + 0.35) / 1.35, 0.0, 1.0);
        float sssWrap = pow(clamp(1.0 - abs(dot(N, lKey)), 0.0, 1.0), 1.6) * 0.28 + fresnel * 0.34;
        float grain = (noise3(vLocalPos * 14.0) - 0.5) * 0.035;

        vec3 col = mix(milkShadow, milkMid, smoothstep(0.05, 0.78, nKey * 0.78 + nFill * 0.28));
        col = mix(col, milkLit, smoothstep(0.62, 1.0, nKey) * 0.65);
        col += milkSss * sssWrap * 0.22 + vec3(grain);

        vec3 h1 = normalize(lKey + V);
        vec3 h2 = normalize(lRim + V);
        float spec1 = pow(max(dot(N, h1), 0.0), 34.0);
        float spec2 = pow(max(dot(N, h2), 0.0), 22.0);
        col += vec3(1.0, 0.98, 0.94) * (spec1 * 0.42 + spec2 * 0.16);

        float edgeShade = smoothstep(0.32, 0.02, ndv);
        col = mix(col, vec3(0.68, 0.58, 0.46), edgeShade * 0.28);

        gl_FragColor = vec4(col, 0.99);
      }
    `,
  });
}

/**
 * Single shared ShaderMaterial for rendering textured circular 3D taste medallions!
 * Adapts texture dramatically to the active main ingredient:
 * - Water base (`uIsMilk = 0`): crystal-translucent backlit fruit-ice orb with crystalline frost grain,
 *   sparkling trapped air micro-bubbles, lower backlit caustic glow & crisp studio window reflections.
 * - Concentrated Milk base (`uIsMilk = 1`): velvety creamy marbled paleta orb with rich condensed-milk
 *   swirl pockets, soft micro-grain & warm matte-satin sheen (zero glass glare!).
 * - Kiwi (`uSeeds = 1`): automatically embeds crisp dark kiwi seeds inside the green texture!
 */
function createTasteCircleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uIsMilk: { value: 0.0 },
      uCore: { value: new THREE.Vector3(1.4, 0.5, 0.4) },
      uMid: { value: new THREE.Vector3(1.1, 0.2, 0.2) },
      uDeep: { value: new THREE.Vector3(0.7, 0.04, 0.08) },
      uCreamAlb: { value: new THREE.Vector3(0.8, 0.12, 0.15) },
      uCreamSss: { value: new THREE.Vector3(1.0, 0.22, 0.25) },
      uCreamDeep: { value: new THREE.Vector3(0.35, 0.03, 0.05) },
      uCloudiness: { value: 0.1 },
      uSeeds: { value: 0.0 },
      uSeed: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uIsMilk;
      uniform vec3 uCore;
      uniform vec3 uMid;
      uniform vec3 uDeep;
      uniform vec3 uCreamAlb;
      uniform vec3 uCreamSss;
      uniform vec3 uCreamDeep;
      uniform float uCloudiness;
      uniform float uSeeds;
      uniform float uSeed;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      ${SHARED_NOISE_GLSL}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = pow(1.0 - ndv, 3.0);

        vec3 lKey = normalize(vec3(-0.56, 0.72, 0.64));
        vec3 lFill = normalize(vec3(0.68, 0.24, 0.56));
        vec3 lBot = normalize(vec3(0.24, -0.78, 0.56));
        float nKey = clamp((dot(N, lKey) + 0.45) / 1.45, 0.0, 1.0);
        float nFill = clamp((dot(N, lFill) + 0.35) / 1.35, 0.0, 1.0);

        vec3 pSeed = vLocalPos + vec3(uSeed * 2.1, -uSeed * 1.3, uSeed * 0.9);
        vec3 col;

        if (uIsMilk < 0.5) {
          // === WATER ICE TEXTURED CIRCLE: translucent backlit fruit ice + crystalline grain + micro-bubbles ===
          float radialDepth = pow(ndv, 0.85);
          float crystalGrain = fbm3(pSeed * 4.8 - V * 0.25);
          float iceFrost = smoothstep(0.36, 0.82, crystalGrain) * (0.32 + uCloudiness * 0.55);
          float microIce = (noise3(pSeed * 16.0) - 0.5) * 0.10;
          float bubbles = smoothstep(0.75, 0.87, noise3(pSeed * 12.5 + vec3(3.1, -2.2, 4.7))) * smoothstep(0.18, 0.75, ndv);

          // Rich sunlit translucent fruit gradient: deep saturated outer lens -> luminous glowing backlit core!
          vec3 iceCol = mix(uDeep, uMid, smoothstep(0.06, 0.52, radialDepth));
          iceCol = mix(iceCol, uCore, smoothstep(0.38, 0.95, radialDepth) * (0.72 + 0.28 * nKey));

          // Lower backlit caustic lens glow + delicate frosty ice-crystal clouds
          float caustic = pow(clamp(dot(N, lBot) * 0.75 + 0.35, 0.0, 1.0), 2.4) * smoothstep(0.14, 0.72, ndv) * (1.0 - uCloudiness * 0.55);
          iceCol += uCore * caustic * 0.30;
          iceCol = mix(iceCol, mix(uCore * 1.12, vec3(1.12, 1.09, 1.05), 0.32), iceFrost * 0.30);
          iceCol += vec3(microIce) * (0.55 + uCloudiness * 0.5);
          iceCol = mix(iceCol, vec3(1.32, 1.29, 1.25), bubbles * 0.78);

          // Crisp glass-ice contour & studio window specular catchlight (extra definition for pale citrus/vanilla orbs!)
          float contour = smoothstep(0.50, 0.06, ndv);
          iceCol = mix(iceCol, uDeep * 0.66, contour * 0.44);

          vec3 h1 = normalize(lKey + V);
          vec3 h2 = normalize(lFill + V);
          float spec1 = pow(max(dot(N, h1), 0.0), 96.0);
          float spec2 = pow(max(dot(N, h2), 0.0), 34.0);
          float glint = smoothstep(0.78, 0.95, dot(reflect(-V, N), lKey));
          iceCol += vec3(1.52, 1.49, 1.45) * (spec1 * 0.92 + glint * 0.28) + uCore * spec2 * 0.16;
          iceCol += mix(uCore, vec3(1.02), 0.42) * fresnel * 0.26;
          col = iceCol;
        } else {
          // === CONCENTRATED MILK TEXTURED CIRCLE: velvety creamy marbled paleta swirl + matte satin sheen ===
          vec3 warp = vec3(
            fbm3(pSeed * 2.2 + vec3(1.7, 3.2, -1.1)),
            fbm3(pSeed * 2.2 + vec3(-2.4, 1.1, 4.3)),
            0.0
          ) - 0.5;
          float swirlVal = fbm3((pSeed + warp * 0.85) * 2.45 + vec3(0.0, 1.2, 0.0));
          // Organic condensed-milk cream pockets swirled into rich fruit cream!
          float creamPocket = smoothstep(0.56, 0.74, swirlVal);
          float microCream = (noise3(pSeed * 18.0) - 0.5) * 0.045;

          vec3 creamWhiteAlb = vec3(0.92, 0.85, 0.72);
          vec3 creamWhiteDeep = vec3(0.66, 0.56, 0.42);
          vec3 alb = mix(uCreamAlb, creamWhiteAlb, creamPocket * 0.82);
          vec3 dp = mix(uCreamDeep, creamWhiteDeep, creamPocket * 0.78);

          vec3 milkCol = mix(dp, alb, smoothstep(0.06, 0.82, nKey * 0.76 + nFill * 0.28));
          milkCol = mix(milkCol, mix(uCreamSss, vec3(1.04, 0.96, 0.82), creamPocket * 0.78), smoothstep(0.55, 1.0, nKey) * 0.42);
          // Warm velvety subsurface scatter + delicate creamy ice-crystal micro-grain
          float sss = pow(clamp(1.0 - abs(dot(N, lKey)), 0.0, 1.0), 1.7) * 0.22 + fresnel * 0.22;
          milkCol += mix(uCreamSss, vec3(1.02, 0.93, 0.76), creamPocket * 0.65) * sss * 0.26 + vec3(microCream);

          // Soft matte-satin milk sheen (zero harsh glassy highlights!)
          vec3 h1 = normalize(lKey + V);
          float satin = pow(max(dot(N, h1), 0.0), 26.0);
          milkCol += vec3(1.0, 0.97, 0.92) * satin * 0.24;
          milkCol = mix(milkCol, dp * 0.82, smoothstep(0.32, 0.02, ndv) * 0.28);
          col = milkCol;
        }

        // Embedded crisp black kiwi seeds inside green Kiwi orbs (both water & milk bases!)
        if (uSeeds > 0.5) {
          vec3 sp = vLocalPos * 4.9 + vec3(uSeed * 1.4, 0.6, -0.8);
          vec3 cell = floor(sp);
          vec3 f = fract(sp);
          float h = hash31(cell);
          if (h > 0.42) {
            vec3 jitter = vec3(
              hash31(cell + vec3(11.3, 4.7, 2.1)),
              hash31(cell + vec3(3.1, 17.9, 8.3)),
              hash31(cell + vec3(7.7, 2.3, 13.7))
            );
            vec3 d = f - (0.24 + 0.52 * jitter);
            d.y *= 0.72;
            float r = length(d.xy);
            float seedDot = (1.0 - smoothstep(0.085, 0.145, r)) * smoothstep(0.18, 0.55, ndv);
            col = mix(col, vec3(0.014, 0.011, 0.008), seedDot * 0.92);
          }
        }

        // Crisp anti-aliased circular silhouette edge
        float edgeAlpha = smoothstep(0.02, 0.14, ndv);
        gl_FragColor = vec4(col, edgeAlpha);
      }
    `,
  });
}

function readTargetToDataUrl(
  renderer: THREE.WebGLRenderer,
  rt: THREE.WebGLRenderTarget,
  size: number,
  pixels: Uint8Array,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  imgData: ImageData,
  applyLinearToSrgb: boolean,
): string {
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
  const dst = imgData.data;
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    for (let x = 0; x < size; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      const a = pixels[si + 3];
      if (a === 0) {
        dst[di] = 0;
        dst[di + 1] = 0;
        dst[di + 2] = 0;
        dst[di + 3] = 0;
        continue;
      }
      if (applyLinearToSrgb) {
        for (let c = 0; c < 3; c++) {
          const lin = pixels[si + c] / 255;
          const mapped = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
          dst[di + c] = Math.max(0, Math.min(255, Math.round(mapped * 255)));
        }
      } else {
        dst[di] = pixels[si];
        dst[di + 1] = pixels[si + 1];
        dst[di + 2] = pixels[si + 2];
      }
      dst[di + 3] = a;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

let cachedIcons: CustomizeIconSet | null = null;

/**
 * Lazily renders crisp 128×128 (2× retina for 30–56px dock & popover slots) studio-lit 3D icons for:
 * - 2 Base material cubes (Water crystal ice & Concentrated Milk)
 * - 10 × 2 Textured circular taste medallions (Water icy-translucent orbs AND Milk creamy-marbled orbs!)
 * - 7 Real 3D topping specimens (reusing the exact procedural fruit/chunk/Tajín meshes & materials)
 */
export function getCustomizeIcons(
  renderer: THREE.WebGLRenderer,
  envMap: THREE.Texture | null,
): CustomizeIconSet {
  if (cachedIcons) return cachedIcons;

  const SIZE = 128;
  const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    samples: 0,
    depthBuffer: true,
    stencilBuffer: false,
  });

  const scene = new THREE.Scene();
  if (envMap) scene.environment = envMap;

  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  cam.position.set(0, 0.16, 3.65);
  cam.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xfff6eb, 2.55);
  key.position.set(-2.4, 3.2, 2.8);
  const fill = new THREE.DirectionalLight(0xffe7d6, 1.15);
  fill.position.set(2.8, 1.0, 2.4);
  const rim = new THREE.DirectionalLight(0xffffff, 1.45);
  rim.position.set(0.4, 2.0, -3.2);
  const amb = new THREE.HemisphereLight(0xfff8f0, 0xd8c3b4, 0.95);
  scene.add(key, fill, rim, amb);

  const prevRT = renderer.getRenderTarget();
  const prevClearCol = new THREE.Color();
  renderer.getClearColor(prevClearCol);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevTone = renderer.toneMapping;
  const prevExp = renderer.toneMappingExposure;

  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(SIZE, SIZE);

  const bases = {} as Record<BaseKind, string>;
  const flavorsWater = {} as Record<FlavorId, string>;
  const flavorsMilk = {} as Record<FlavorId, string>;
  const toppings = {} as Record<ToppingId, string>;

  try {
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);

    // 1. Two 3D base cubes (Water & Concentrated Milk)
    const cubeGeo = createRoundedIceCubeGeometry(22);
    const waterMat = createWaterIceCubeMaterial();
    const milkMat = createMilkIceCubeMaterial();
    const cubeMesh = new THREE.Mesh(cubeGeo, waterMat);
    cubeMesh.rotation.set(0.42, -0.62, 0.14);
    scene.add(cubeMesh);

    renderer.toneMapping = THREE.NoToneMapping;
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    bases.water = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, false);

    cubeMesh.material = milkMat;
    cubeMesh.rotation.set(0.42, -0.58, 0.12);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    bases.coconut = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, false);

    scene.remove(cubeMesh);
    cubeGeo.dispose();
    waterMat.dispose();
    milkMat.dispose();

    // 2. Textured circular 3D taste medallions for BOTH Water (translucent icy) & Milk (creamy marbled) bases!
    const orbGeo = new THREE.SphereGeometry(0.68, 36, 28);
    const orbMat = createTasteCircleMaterial();
    const orbMesh = new THREE.Mesh(orbGeo, orbMat);
    scene.add(orbMesh);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    cam.position.set(0, 0, 3.25);
    cam.lookAt(0, 0, 0);

    for (let i = 0; i < FLAVOR_LIST.length; i++) {
      const flv = FLAVOR_LIST[i];
      const spec = FLAVOR_MAP[flv.id];
      orbMat.uniforms.uCore.value.set(...spec.core);
      orbMat.uniforms.uMid.value.set(...spec.mid);
      orbMat.uniforms.uDeep.value.set(...spec.deep);
      orbMat.uniforms.uCreamAlb.value.set(...spec.creamAlbedo);
      orbMat.uniforms.uCreamSss.value.set(...spec.creamSss);
      orbMat.uniforms.uCreamDeep.value.set(...spec.creamDeep);
      orbMat.uniforms.uCloudiness.value = spec.waterCloudiness;
      orbMat.uniforms.uSeeds.value = flv.id === 'kiwi' ? 1.0 : 0.0;
      orbMat.uniforms.uSeed.value = i * 3.17 + 1.1;

      // Water-base icy translucent circle
      orbMat.uniforms.uIsMilk.value = 0.0;
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      flavorsWater[flv.id] = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, true);

      // Milk-base velvety creamy marbled circle
      orbMat.uniforms.uIsMilk.value = 1.0;
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      flavorsMilk[flv.id] = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, true);
    }

    scene.remove(orbMesh);
    orbGeo.dispose();
    orbMat.dispose();

    // 3. Seven real 3D topping specimens with photographic ACES tone mapping
    renderer.toneMappingExposure = 1.18;
    cam.position.set(0, 0.08, 3.25);
    cam.lookAt(0, 0, 0);
    for (const top of TOPPING_LIST) {
      const spec = createToppingThumbSpecimen(top.id, 1);
      scene.add(spec.object);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      toppings[top.id] = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, true);
      scene.remove(spec.object);
      spec.dispose();
    }
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClearCol, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.toneMapping = prevTone;
    renderer.toneMappingExposure = prevExp;
    rt.dispose();
  }

  cachedIcons = {
    bases,
    flavors: { water: flavorsWater, coconut: flavorsMilk },
    toppings,
  };
  return cachedIcons;
}
