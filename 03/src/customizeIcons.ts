import * as THREE from 'three';
import type { BaseKind, FlavorId, ToppingId } from './recipe';
import { FLAVOR_LIST, TOPPING_LIST } from './recipe';
import { createToppingThumbSpecimen } from './fruits';

export interface CustomizeIconSet {
  bases: Record<BaseKind, string>;
  flavors: Record<FlavorId, string>;
  toppings: Record<ToppingId, string>;
}

/**
 * Generates an organically beveled rounded 3D ice cube geometry for the Water & Concentrated Milk bases.
 */
function createRoundedIceCubeGeometry(subdiv = 26): THREE.BufferGeometry {
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

        // Luminous clear glacial crystal (bright white-aqua clarity, never muddy grey!)
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

        float alpha = clamp(0.40 + fresnel * 0.54 + frostCloud * 0.25 + botCaustic * 0.26 + bubbles * 0.38 + spec1 * 0.55 + windowGlint * 0.30, 0.0, 0.98);
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

interface JuiceDropSpec {
  core: [number, number, number];
  mid: [number, number, number];
  deep: [number, number, number];
  caustic: [number, number, number];
  creaminess: number;
  pulp: number;
  bendX: number;
  beadSide: number;
}

const JUICE_DROP_SPECS: Record<FlavorId, JuiceDropSpec> = {
  mango: {
    core: [1.26, 0.72, 0.04],
    mid: [0.92, 0.38, 0.012],
    deep: [0.52, 0.14, 0.004],
    caustic: [1.75, 1.18, 0.18],
    creaminess: 0.38,
    pulp: 0.44,
    bendX: -0.18,
    beadSide: 1,
  },
  lemon: {
    core: [1.38, 1.30, 0.12],
    mid: [0.98, 0.86, 0.03],
    deep: [0.56, 0.46, 0.010],
    caustic: [1.90, 1.82, 0.46],
    creaminess: 0.10,
    pulp: 0.22,
    bendX: 0.16,
    beadSide: -1,
  },
  orange: {
    core: [1.38, 0.40, 0.025],
    mid: [0.98, 0.17, 0.008],
    deep: [0.58, 0.050, 0.003],
    caustic: [1.88, 0.80, 0.12],
    creaminess: 0.20,
    pulp: 0.40,
    bendX: -0.14,
    beadSide: 1,
  },
  watermelon: {
    core: [1.38, 0.28, 0.38],
    mid: [0.98, 0.10, 0.19],
    deep: [0.56, 0.026, 0.075],
    caustic: [1.85, 0.72, 0.78],
    creaminess: 0.04,
    pulp: 0.06,
    bendX: 0.20,
    beadSide: -1,
  },
  strawberry: {
    core: [1.18, 0.08, 0.09],
    mid: [0.76, 0.028, 0.036],
    deep: [0.36, 0.008, 0.014],
    caustic: [1.72, 0.36, 0.28],
    creaminess: 0.08,
    pulp: 0.10,
    bendX: -0.16,
    beadSide: 1,
  },
  raspberry: {
    core: [0.98, 0.038, 0.30],
    mid: [0.58, 0.012, 0.15],
    deep: [0.24, 0.004, 0.060],
    caustic: [1.58, 0.26, 0.64],
    creaminess: 0.08,
    pulp: 0.12,
    bendX: 0.15,
    beadSide: -1,
  },
  blueberry: {
    core: [0.24, 0.16, 1.12],
    mid: [0.095, 0.055, 0.66],
    deep: [0.032, 0.014, 0.28],
    caustic: [0.68, 0.54, 1.72],
    creaminess: 0.12,
    pulp: 0.10,
    bendX: -0.20,
    beadSide: 1,
  },
  banana: {
    core: [1.16, 0.96, 0.36],
    mid: [0.90, 0.70, 0.20],
    deep: [0.52, 0.35, 0.070],
    caustic: [1.34, 1.16, 0.58],
    creaminess: 0.76,
    pulp: 0.28,
    bendX: 0.17,
    beadSide: -1,
  },
  chocolate: {
    core: [0.22, 0.095, 0.042],
    mid: [0.115, 0.044, 0.017],
    deep: [0.036, 0.012, 0.004],
    caustic: [0.40, 0.20, 0.095],
    creaminess: 0.94,
    pulp: 0.04,
    bendX: -0.15,
    beadSide: 1,
  },
};

/**
 * Sculpted floating 3D liquid droplet with organic surface-tension curves & orbiting micro-splash beads.
 * All 9 flavors share the exact same hero bounding footprint so tastes read as a uniform, crisp set.
 */
function createJuiceDropGeometry(bendX: number, phase: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 48, 36);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const yn = v.y; // [-1, 1]
    const up = Math.max(0, yn);
    const dn = Math.max(0, -yn);

    // Classic plump suspended teardrop: full rounded lower belly tapering into a smooth curved liquid peak
    const belly = 1.0 + 0.18 * dn * (1.0 - 0.42 * dn);
    const taper = Math.pow(Math.max(0.0, 1.0 - up * 0.78), 0.70);
    const radialScale = (yn >= 0 ? taper : belly) * 0.56;

    // Gentle organic fluid wobble so each flavor drop feels alive in mid-air
    const ang = Math.atan2(v.z, v.x);
    const wobble = 1.0 + 0.026 * Math.sin(ang * 2.0 + phase) * (1.0 - up * 0.65);

    const x = v.x * radialScale * wobble + bendX * up * up * 0.88;
    const y = (yn * 0.68 + up * up * 0.14) - 0.07;
    const z = v.z * radialScale * (0.94 + 0.04 * dn);

    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Photorealistic macro-studio liquid juice shader:
 * - Translucent fruit juices: backlit lower caustic lens glow, Beer-Lambert depth rim, subtle natural pulp,
 *   razor-crisp curved studio softbox reflections & pinpoint specular catchlights
 * - Creamy banana puree & melted dark-chocolate ganache: rich glossy velvety liquid sheen
 */
function createJuiceDropMaterial(spec: JuiceDropSpec, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uCore: { value: new THREE.Vector3(...spec.core) },
      uMid: { value: new THREE.Vector3(...spec.mid) },
      uDeep: { value: new THREE.Vector3(...spec.deep) },
      uCaustic: { value: new THREE.Vector3(...spec.caustic) },
      uCreaminess: { value: spec.creaminess },
      uPulp: { value: spec.pulp },
      uSeed: { value: seed },
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
      uniform vec3 uCore;
      uniform vec3 uMid;
      uniform vec3 uDeep;
      uniform vec3 uCaustic;
      uniform float uCreaminess;
      uniform float uPulp;
      uniform float uSeed;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      ${SHARED_NOISE_GLSL}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fresnel = 0.03 + 0.97 * pow(1.0 - ndv, 3.6);

        vec3 lKey = normalize(vec3(-0.56, 0.72, 0.66));
        vec3 lRim = normalize(vec3(0.76, 0.36, -0.34));
        vec3 lCaustic = normalize(vec3(0.32, -0.82, 0.48));

        float wrapKey = clamp((dot(N, lKey) + 0.46) / 1.46, 0.0, 1.0);
        float centerThick = pow(ndv, 1.15);

        // Refracted internal volume color: luminous translucent heart -> saturated deep jewel edge
        vec3 jewelCol = mix(uDeep, uMid, smoothstep(0.08, 0.62, ndv));
        jewelCol = mix(jewelCol, uCore, smoothstep(0.36, 0.95, centerThick * 0.78 + wrapKey * 0.32));

        // Signature macro-photography backlit liquid caustic crescent concentrated in the lower-right belly!
        float causticZone = pow(max(dot(N, lCaustic), 0.0), 1.65) * smoothstep(0.06, 0.56, ndv);
        float bellyFocus = smoothstep(0.38, -0.42, vLocalPos.y);
        float causticAmt = causticZone * (0.55 + 0.55 * bellyFocus) * (1.0 - uCreaminess * 0.82);
        jewelCol = mix(jewelCol, uCaustic, clamp(causticAmt * 0.78, 0.0, 0.84));

        // Subtle organic suspended juice pulp shimmer (mango / orange / lemon)
        if (uPulp > 0.02) {
          float pN = noise3(vLocalPos * 12.5 + vec3(uSeed, -uSeed * 0.7, uSeed * 1.3));
          float pulpGlow = smoothstep(0.46, 0.86, pN) * uPulp * smoothstep(0.18, 0.72, ndv);
          jewelCol = mix(jewelCol, uCore * 1.16 + vec3(0.06), pulpGlow * 0.28);
        }

        // Creamy glossy liquid shading for banana puree & melted dark chocolate ganache
        vec3 creamCol = mix(uDeep, uMid, smoothstep(0.05, 0.65, wrapKey));
        creamCol = mix(creamCol, uCore, smoothstep(0.55, 1.0, wrapKey) * 0.72);
        creamCol += uCaustic * pow(1.0 - ndv, 2.4) * 0.22;

        vec3 col = mix(jewelCol, creamCol, uCreaminess);

        // Crisp dark refractive TIR inner contour (makes floating clear drops pop like liquid jewels on warm taupe!)
        float tirRing = smoothstep(0.46, 0.14, ndv) * smoothstep(0.01, 0.16, ndv);
        col = mix(col, uDeep * 0.52, tirRing * mix(0.62, 0.28, uCreaminess));

        // Crisp refined studio softbox highlight crescent + pinpoint liquid catchlight (never washes out jewel color!)
        vec3 R = reflect(-V, N);
        float softbox = smoothstep(0.89, 0.975, dot(R, lKey));
        float rimStrip = smoothstep(0.84, 0.96, dot(R, lRim)) * (0.40 + 0.60 * fresnel);

        vec3 h1 = normalize(lKey + V);
        vec3 h2 = normalize(lRim + V);
        float specSharp = pow(max(dot(N, h1), 0.0), mix(180.0, 110.0, uCreaminess));
        float specBroad = pow(max(dot(N, h1), 0.0), mix(44.0, 30.0, uCreaminess));
        float specRim = pow(max(dot(N, h2), 0.0), 68.0);

        vec3 specTint = mix(vec3(1.0, 0.99, 0.97), vec3(1.04, 0.94, 0.86), uCreaminess);
        col += specTint * (specSharp * 1.85 + softbox * 0.58 + specBroad * 0.16 + rimStrip * 0.30 + specRim * 0.36);

        // Delicate luminous studio rim bounce along silhouette
        col = mix(col, mix(uCaustic * 0.72 + vec3(0.32), vec3(1.0, 0.98, 0.95), 0.40), fresnel * mix(0.32, 0.16, uCreaminess));

        float alpha = clamp(
          mix(0.84 + fresnel * 0.15 + causticAmt * 0.12 + specSharp * 0.40 + softbox * 0.20, 0.99, uCreaminess),
          0.0,
          0.995
        );
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function createJuiceDropSpecimen(flavorId: FlavorId, idx: number): { object: THREE.Group; dispose(): void } {
  const spec = JUICE_DROP_SPECS[flavorId];
  const group = new THREE.Group();
  const mat = createJuiceDropMaterial(spec, idx * 3.7 + 1.3);

  const mainGeo = createJuiceDropGeometry(spec.bendX, idx * 1.45);
  const mainMesh = new THREE.Mesh(mainGeo, mat);
  group.add(mainMesh);

  // Orbiting liquid micro-splash bead hovering gracefully beside the curved peak
  const bead1Geo = new THREE.SphereGeometry(0.115, 22, 16);
  const bead1 = new THREE.Mesh(bead1Geo, mat);
  bead1.scale.set(0.95, 1.18, 0.95);
  bead1.position.set(spec.beadSide * 0.44, 0.44, 0.08);
  bead1.rotation.z = -spec.beadSide * 0.42;
  group.add(bead1);

  const bead2Geo = new THREE.SphereGeometry(0.062, 16, 12);
  const bead2 = new THREE.Mesh(bead2Geo, mat);
  bead2.position.set(spec.beadSide * 0.58, 0.16, 0.12);
  group.add(bead2);

  // Gentle studio presentation angle
  group.rotation.set(0.08, spec.beadSide * -0.14, 0);

  return {
    object: group,
    dispose() {
      mainGeo.dispose();
      bead1Geo.dispose();
      bead2Geo.dispose();
      mat.dispose();
    },
  };
}

let cachedIcons: CustomizeIconSet | null = null;
let cachedDockRaspberry: string | null = null;

/**
 * Renders just the single crisp 3D translucent ruby raspberry icon for the Customize dock button (<3ms).
 */
export function getCustomizeDockRaspberryIcon(
  renderer: THREE.WebGLRenderer,
  envMap: THREE.Texture | null,
): string {
  if (cachedDockRaspberry) return cachedDockRaspberry;
  if (cachedIcons) {
    cachedDockRaspberry = cachedIcons.toppings.raspberry;
    return cachedDockRaspberry;
  }

  const SIZE = 192;
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
  cam.position.set(0, 0.08, 3.25);
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

  try {
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const spec = createToppingThumbSpecimen('raspberry', 1);
    scene.add(spec.object);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    cachedDockRaspberry = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, true);
    scene.remove(spec.object);
    spec.dispose();
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClearCol, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.toneMapping = prevTone;
    renderer.toneMappingExposure = prevExp;
    rt.dispose();
  }

  return cachedDockRaspberry;
}

/**
 * Lazily renders crisp supersampled 256×256 studio-lit 3D icons for:
 * - 2 Base material cubes (Water crystal ice & Concentrated Milk)
 * - 9 Odd-shaped colored frozen-juice ice chunks (one unique sculpted shape per taste!)
 * - 6 Real 3D topping specimens (reusing the exact procedural fruit/chunk meshes & materials)
 */
export function getCustomizeIcons(
  renderer: THREE.WebGLRenderer,
  envMap: THREE.Texture | null,
): CustomizeIconSet {
  if (cachedIcons) return cachedIcons;

  const SIZE = 256;
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
  cam.position.set(0, 0.18, 3.7);
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
  const flavors = {} as Record<FlavorId, string>;
  const toppings = {} as Record<ToppingId, string>;

  try {
    renderer.autoClear = true;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);

    // 1. Two 3D base cubes (Water & Concentrated Milk)
    const cubeGeo = createRoundedIceCubeGeometry(26);
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

    // 2. Nine uniform-size 3D glossy floating juice droplets / splashes!
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    cam.position.set(0, 0.06, 3.35);
    cam.lookAt(0, 0.02, 0);

    for (let i = 0; i < FLAVOR_LIST.length; i++) {
      const flv = FLAVOR_LIST[i];
      const spec = createJuiceDropSpecimen(flv.id, i);
      scene.add(spec.object);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      flavors[flv.id] = readTargetToDataUrl(renderer, rt, SIZE, pixels, canvas, ctx, imgData, true);
      scene.remove(spec.object);
      spec.dispose();
    }

    // 3. Six real 3D topping specimens with photographic ACES tone mapping
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

  cachedIcons = { bases, flavors, toppings };
  return cachedIcons;
}
