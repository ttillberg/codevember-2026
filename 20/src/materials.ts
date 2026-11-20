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
// and the red light inside the pod (main.ts) has no shadows: it would light the plates' seams and the machinery
// on the flanks through the shell. Only what is in there takes it (the wrapped thing, the shell's inside):
// everything else is compiled with NO_POINT, the point lights left out of its loop
{
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const at = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';
  if (!chunk.includes(at)) throw new Error('lights_fragment_begin: the point light loop moved');
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(at, at + ' && !defined( NO_POINT )');
}
const INSIDE = new Set(['shroud', 'inner']);

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
export const wire = grit(new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 1, roughness: 0.36 }), { scale: 30, rough: [0.75, 1.35], tint: 0.06 }); // brushed black, as the pod's

/** the hall's steel, painted long ago */
export function hallSteel(m: THREE.MeshStandardMaterial) {
  return grit(m, { scale: 0.7, rough: [0.75, 1.3], tint: 0.3 });
}

/** what glows red from inside the pod: the raw metal seen through the seams, the frosted window (main.ts pulses them) */
export const GLOWING: { material: THREE.MeshStandardMaterial; gain: number }[] = [];
/** the raw metal glows only round the door, in the door's own space: a box round it (main.ts sets it, and `inv`,
 * the door's world matrix inverted, every frame); the rest of it, the open flanks, stays dark */
export const DOOR_GLOW = { inv: { value: new THREE.Matrix4() }, lo: { value: new THREE.Vector3() }, hi: { value: new THREE.Vector3() } };

const MADE = new Map<string, THREE.Material>(); // what dress() made of each of the glb's materials, by name

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
      case 'steel': // clamps, collars, couplings, lugs, connectors: brushed black metal, a dull sheen and no shine
        return grit(physical(old, { color: 0x1c1d20, metalness: 1, roughness: 0.38 }), { scale: 25, rough: [0.75, 1.35], tint: 0.06 });
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
      // the red light inside comes out where the plates part and through the window
      const name = m.name.replace(/[._]\d+$/, '');
      MADE.set(name, made);
      if (name === 'core' || name === 'frost') {
        const g = made as THREE.MeshStandardMaterial;
        g.emissive = new THREE.Color(0xff1a0a);
        g.emissiveIntensity = 0;
        GLOWING.push({ material: g, gain: name === 'core' ? 1 : 0.25 });
        if (name === 'core') {
          const before = g.onBeforeCompile;
          g.onBeforeCompile = (sh, r) => {
            before.call(g, sh, r);
            Object.assign(sh.uniforms, { doorInv: DOOR_GLOW.inv, doorLo: DOOR_GLOW.lo, doorHi: DOOR_GLOW.hi });
            sh.vertexShader = sh.vertexShader
              .replace('void main() {', 'varying vec3 vGlowAt;\nvoid main() {')
              .replace('#include <project_vertex>', '#include <project_vertex>\n  vGlowAt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            sh.fragmentShader = sh.fragmentShader
              .replace('void main() {', 'varying vec3 vGlowAt;\nuniform mat4 doorInv;\nuniform vec3 doorLo, doorHi;\nvoid main() {')
              .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 d = (doorInv * vec4(vGlowAt, 1.0)).xyz;
    float out_ = length(max(max(doorLo - d, d - doorHi), 0.0));
    totalEmissiveRadiance *= 1.0 - smoothstep(0.015, 0.06, out_);
  }`);
          };
          const key = g.customProgramCacheKey.bind(g);
          g.customProgramCacheKey = () => key() + ':doorglow';
        }
      }
      // the pod's own (not the rubber, shared with the cables that run up out of the tight sun's reach)
      if (made !== rubber) made.defines = { ...made.defines, ...POD_SUN };
      if (!INSIDE.has(m.name.replace(/[._]\d+$/, ''))) made.defines = { ...made.defines, NO_POINT: '' };
      done.set(m, made);
    }
      return done.get(m)!;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

/**
 * The small things there are hundreds of, which the glb has only as where they go (on an empty each: `at`, a flat
 * list of x y z, then the way they face, then for some a size): the bolts round the panels, one small hex head
 * each, and the collars along the hoses. Each set one instanced mesh, under the empty's parent, in its material.
 */
export function instances(root: THREE.Object3D) {
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3(), d = new THREE.Vector3(), s = new THREE.Vector3();
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const make = (o: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | undefined, stride: number, size: (at: number[], i: number) => number) => {
    const at = o.userData.at as number[] | undefined;
    if (!at?.length || !mat) return;
    const n = Math.floor(at.length / stride);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      const k = i * stride;
      p.set(at[k], at[k + 1], at[k + 2]);
      d.set(at[k + 3], at[k + 4], at[k + 5]).normalize();
      q.setFromUnitVectors(up, d);
      const r = size(at, k);
      mesh.setMatrixAt(i, m.compose(p, q, s.set(r, 1, r)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = o.name;
    // (under the empty: it was made at its parent's origin, so its space is the list's, whatever packing the glb did
    // to the parent's own transform)
    o.add(mesh);
  };
  // a bolt: from 2 mm under the plate's face to 3 mm out, its base at the point
  const bolt = new THREE.CylinderGeometry(0.0042, 0.0042, 0.005, 6).translate(0, 0.0005, 0);
  const collar = new THREE.CylinderGeometry(1, 1, 0.06, 6);
  const found: THREE.Object3D[] = [];
  root.traverse((o) => { if (/^(bolts_|collars_hoses)/.test(o.name) && o.userData.at) found.push(o); });
  for (const o of found) {
    if (o.name.startsWith('bolts_')) make(o, bolt, MADE.get('bolt'), 6, () => 1);
    else make(o, collar, MADE.get('steel'), 7, (at, k) => at[k + 6]);
  }
}
