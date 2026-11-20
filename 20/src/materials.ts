import * as THREE from 'three';
import { NOISE3D } from './noise';

/**
 * What things are made of. The glb only names its materials (paint, mech, steel, panel, block, hose ...); here each
 * gets what it is: painted plate under a thin worn clearcoat, gunmetal machinery, bare steel, two plastics, rubber
 * hoses with ribs, brass. Nothing is quite even: a grit of noise in object space (world space for instances) breaks
 * up how rough each surface is and its tone a little, so the light catches some of it and not the rest.
 */

// Two suns, the same light: the wide one, its shadow map over the whole hall, and a tight one that follows the pod
// with a map only round it (hall.ts). Each material takes its sun from one of them and leaves the other out of
// three's light loop altogether, its shadow lookup and all: SUN_SKIP is the loop index skipped, 1 (the tight sun)
// for everything, 0 (the wide one) for the pod's materials (POD_SUN). Both suns cast shadows and are the only
// directional lights, so they are the first two in that loop, in the order they were added.
{
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const a = chunk.indexOf('\t\tdirectionalLight = directionalLights[ i ];');
  const end = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const b = chunk.indexOf(end, a) + end.length;
  if (a < 0 || b < end.length) throw new Error('lights_fragment_begin: the directional loop moved');
  THREE.ShaderChunk.lights_fragment_begin =
    '#ifndef SUN_SKIP\n#define SUN_SKIP 1\n#endif\n' + chunk.slice(0, a) + '#if UNROLLED_LOOP_INDEX != SUN_SKIP\n' + chunk.slice(a, b) + '\n#endif' + chunk.slice(b);
}
export const POD_SUN = { SUN_SKIP: '0' };

// value noise from a tiling 3D texture (noise.ts): one fetch where it was eight hashes with a sine each, on every
// pixel of every surface; the octaves at odd scales keep its 32-cell period from showing
const NOISE = /* glsl */ `
uniform highp sampler3D gNoiseTex;
float gNoise(vec3 p) { return texture(gNoiseTex, p / 32.0).r; }
float gFbm(vec3 p) { return gNoise(p) * 0.55 + gNoise(p * 2.7 + 3.1) * 0.3 + gNoise(p * 7.3 + 1.7) * 0.15; }
// three's bump, under another name so it does not clash when a material has a bump map of its own
vec3 gPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

type Grit = {
  scale: number; // noise per metre
  rough: [number, number]; // roughness times this, from the clean bits to the worn
  tint: number; // how much the tone wanders
  ribs?: boolean; // a hose's corrugation: ribs along uv.y, one per unit
  wear?: number; // worn through: how much of it is gone, in flakes (a painted mark)
};

const f = (x: number) => x.toFixed(4);

/** the grit (and ribs) into a standard or physical material */
function grit(m: THREE.MeshStandardMaterial, g: Grit) {
  if (g.ribs) m.defines = { ...m.defines, USE_UV: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.gNoiseTex = { value: NOISE3D };
    sh.vertexShader = 'varying vec3 vGrit;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 gritAt = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        gritAt = modelMatrix * instanceMatrix * gritAt;
      #endif
      vGrit = gritAt.xyz;`,
    );
    let frag = 'varying vec3 vGrit;\n' + NOISE + sh.fragmentShader;
    frag = frag.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= 1.0 + ${f(g.tint)} * (gFbm(vGrit * ${f(g.scale * 0.35)} + 11.0) - 0.5) * 2.0;${
        g.wear
          ? `
      // flaked off: big patches where it has worn, and fine pits all over
      if (gFbm(vGrit * ${f(g.scale * 0.12)} + 5.0) * 0.75 + gNoise(vGrit * ${f(g.scale * 2.5)}) * 0.25 < ${f(g.wear)}) discard;`
          : ''
      }`,
    );
    frag = frag.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor * mix(${f(g.rough[0])}, ${f(g.rough[1])}, smoothstep(0.25, 0.75, gFbm(vGrit * ${f(g.scale)}))), 0.04, 1.0);`,
    );
    if (g.ribs) {
      frag = frag.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // ribs: their slope, the same however near they are, gone where they get finer than the pixels
          float w = max(fwidth(vUv.y), 1e-4);
          float h = 0.16 * (0.5 - 0.5 * cos(6.2831853 * vUv.y)) * (1.0 - smoothstep(0.2, 0.6, w));
          normal = gPerturb(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) / w * 0.35, faceDirection);
        }`,
      );
    }
    sh.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `grit:${g.scale}:${g.rough}:${g.tint}:${!!g.ribs}:${g.wear ?? 0}`;
  m.needsUpdate = true;
  return m;
}

/** a physical material in place of a glTF one, keeping its maps */
function physical(old: THREE.MeshStandardMaterial, p: THREE.MeshPhysicalMaterialParameters) {
  const m = new THREE.MeshPhysicalMaterial({
    name: old.name,
    color: old.color,
    map: old.map,
    roughness: old.roughness,
    roughnessMap: old.roughnessMap,
    metalness: old.metalness,
    metalnessMap: old.metalnessMap,
    normalMap: old.normalMap,
    emissive: old.emissive,
    emissiveMap: old.emissiveMap,
    emissiveIntensity: old.emissiveIntensity,
    side: old.side,
    ...p,
  });
  return m;
}

/** black rubber, ribbed: the hoses on the pod and the cables to the ceiling */
export const rubber = grit(
  new THREE.MeshPhysicalMaterial({ name: 'hose', color: 0x111214, roughness: 0.58, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: 0x3c4248 }),
  { scale: 6, rough: [0.85, 1.2], tint: 0.12, ribs: true },
);

/** steel wire: the slings and the wire it hangs by */
export const wire = grit(new THREE.MeshStandardMaterial({ color: 0x80858a, metalness: 1, roughness: 0.32 }), { scale: 30, rough: [0.7, 1.4], tint: 0.08 });

/** the hall's steel, painted long ago */
export function hallSteel(m: THREE.MeshStandardMaterial) {
  return grit(m, { scale: 0.7, rough: [0.75, 1.3], tint: 0.3 });
}

/** every material in the glb, by name, to what it is */
export function dress(root: THREE.Object3D) {
  const done = new Map<THREE.Material, THREE.Material>();
  const make = (old: THREE.MeshStandardMaterial): THREE.Material => {
    const name = old.name.replace(/[._]\d+$/, '');
    switch (name) {
      case 'paint': // painted plate: the baked wear, under a thin satin clearcoat
        return grit(physical(old, { clearcoat: 0.35, clearcoatRoughness: 0.42 }), { scale: 40, rough: [0.85, 1.15], tint: 0.03 });
      case 'mech': // gunmetal machinery
        return grit(physical(old, { color: 0x2b2f34, metalness: 0.85, roughness: 0.4 }), { scale: 9, rough: [0.65, 1.4], tint: 0.14 });
      case 'core': // the dark raw metal under the plates
        return grit(physical(old, { color: 0x15171a, metalness: 0.65, roughness: 0.55 }), { scale: 7, rough: [0.7, 1.4], tint: 0.18 });
      case 'steel': // bare steel: clamps, collars, couplings, lugs
        return grit(physical(old, { color: 0x9da1a6, metalness: 1, roughness: 0.26 }), { scale: 25, rough: [0.6, 1.7], tint: 0.07 });
      case 'bolt': // zinc-plated bolt heads, dulled
        return grit(physical(old, { color: 0x6a6e73, metalness: 1, roughness: 0.4 }), { scale: 60, rough: [0.7, 1.5], tint: 0.18 });
      case 'brass':
        return grit(physical(old, { roughness: 0.3, metalness: 1 }), { scale: 20, rough: [0.7, 1.6], tint: 0.12 });
      case 'panel': // dark plastic: ribbed panels, boxes
        return grit(physical(old, { color: 0x313438, metalness: 0, roughness: 0.55, specularIntensity: 0.6 }), { scale: 14, rough: [0.8, 1.25], tint: 0.08 });
      case 'block': // light plastic housings, a little gloss
        return grit(physical(old, { color: 0xbdbdb6, metalness: 0, roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.5 }), { scale: 12, rough: [0.8, 1.3], tint: 0.06 });
      case 'dark': // matte black plastic
        return grit(physical(old, { color: 0x0f1011, metalness: 0, roughness: 0.72 }), { scale: 10, rough: [0.85, 1.15], tint: 0.1 });
      case 'shroud': // cloth, wrapped round what is inside
        return physical(old, { metalness: 0, roughness: 0.85, sheen: 1, sheenRoughness: 0.7, sheenColor: 0x8a8070 });
      case 'ink': // the painted marks: flat black, worn through in flakes
        return grit(physical(old, { color: 0x0b0c0d, metalness: 0, roughness: 0.62 }), { scale: 30, rough: [0.85, 1.2], tint: 0.15, wear: 0.37 });
      case 'hose':
        return rubber;
      default:
        return old;
    }
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
      if (!done.has(m)) {
      const made = make(m as THREE.MeshStandardMaterial);
      // the pod's own (not the rubber, shared with the cables that run up out of the tight sun's reach)
      if (made !== rubber) made.defines = { ...made.defines, ...POD_SUN };
      done.set(m, made);
    }
      return done.get(m)!;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}
