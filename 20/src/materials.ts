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
// The roof's shutter (hall.ts) is not in the wide sun's map, which is drawn once: where it is, it is worked out.
// Up the sun's light from the point to the shutter's height; under the shutter if it gets there between the
// shutter's two ends, along x. On both suns (the only directional lights): the pod's own has it in its map too, but
// that map is a column 4.4 m across, and this is the same answer everywhere.
export const COVER = {
  /** the shutter along x: from, to, a soft edge, 1 if it is there at all */
  x: { value: new THREE.Vector4(0, 0, 1, 0) },
  /** towards the sun (xyz), the shutter's height (w) */
  sun: { value: new THREE.Vector4(0, 1, 0, 0) },
  /** where the roof's glass is: from and to along x, from and to along z (the rest of the roof is deck) */
  glass: { value: new THREE.Vector4(-1e3, 1e3, -1e3, 1e3) },
};
THREE.ShaderChunk.lights_pars_begin += /* glsl */ `
uniform vec4 coverX, coverSun;
float coverLight( vec3 viewPos ) {
  if ( coverX.w < 0.5 ) return 1.0;
  // the world from the view: the view matrix is a turn and a move, so its inverse is its transpose
  vec3 w = transpose( mat3( viewMatrix ) ) * ( viewPos - viewMatrix[ 3 ].xyz );
  float t = ( coverSun.w - w.y ) / max( coverSun.y, 0.05 );
  if ( t < 0.0 ) return 1.0;
  float hx = w.x + coverSun.x * t;
  return 1.0 - smoothstep( coverX.x - coverX.z, coverX.x + coverX.z, hx ) * ( 1.0 - smoothstep( coverX.y - coverX.z, coverX.y + coverX.z, hx ) );
}
`;
{
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const a = chunk.indexOf('directionalLight = directionalLights[ i ];');
  const b = chunk.indexOf('RE_Direct(', a);
  if (a < 0 || b < 0) throw new Error('lights_fragment_begin: the directional loop moved');
  THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, b) + 'directLight.color *= coverLight( geometryPosition );\n\t\t' + chunk.slice(b);
}
/** every lit material in the scene takes the shutter's uniforms (three gives a chunk no uniforms of its own) */
export function shareCover(root: THREE.Object3D, spare: THREE.Material[] = []) {
  const seen = new Set<THREE.Material>();
  const all: THREE.Material[] = [...spare];
  root.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) all.push(...(Array.isArray(m) ? m : [m])); });
  {
    for (const x of all) {
      if (seen.has(x) || !(x as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      seen.add(x);
      const before = x.onBeforeCompile;
      x.onBeforeCompile = (sh, r) => {
        before.call(x, sh, r);
        sh.uniforms.coverX = COVER.x;
        sh.uniforms.coverSun = COVER.sun;
      };
      x.needsUpdate = true;
    }
  }
}
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
  paint?: boolean; // worn white paint: grime, pits, scratches, chipped edges, drawn here
};

/** the baked dark in the corners (the paint's AO, the colour on the other parts' vertices): 1 on, 0 off (the debug panel) */
export const SHADE = { value: 1 };

// The wear on the white paint. The textures carry only what is soft (the white, broad dirt, the AO in the ORM's
// red, how near a panel's edge in its blue: 2.4 mm a texel); everything fine is drawn here, in the plates' own
// space, so it is sharp however near the eye is, and fades out before it gets finer than the pixels.
const PAINT = /* glsl */ `
      #ifdef USE_ROUGHNESSMAP
        vec3 gOrm = texture2D( roughnessMap, vRoughnessMapUv ).rgb;
      #else
        vec3 gOrm = vec3( 1.0, 0.5, 0.3 );
        #ifdef USE_COLOR
          gOrm.r = vColor.r;
        #endif
      #endif
      float gShade = ( 1.0 - gOrm.r ) * uShade;
      vec3 P = vGrit;
      float gPx = length( fwidth( P ) );
      // The paint is clean, on the whole, and what dirt there is is small: that is the look. (It was big: soft
      // patches of grime, streaks, flecks a centimetre or two across all over it, long scratches.) What is left:
      // the dark where the light does not get, from the baked shade; a thin broken line of worn paint right on a
      // panel's edge, nibbled into here and there; and in the middle of a panel pinpricks, a few nicks and a few
      // hairlines, in drifts, where it has been knocked.
      float gFine = 1.0 - smoothstep( 0.0025, 0.008, gPx );   // gone before it is finer than the pixels
      float gMid = 1.0 - smoothstep( 0.008, 0.03, gPx );
      float gWorn = smoothstep( 0.4, 0.66, gFbm( P * 2.6 + 31.0 ) );   // where it has been knocked about
      // grime: in the corners, and a little of it running down from there; soot along the seams
      float gRun = smoothstep( 0.45, 0.8, gFbm( vec3( P.x * 22.0, P.y * 1.1, P.z * 22.0 ) + 3.0 ) );
      float gSeam = gOrm.b * ( 0.3 + 0.7 * gFbm( P * 11.0 + 23.0 ) );
      float gSmudge = smoothstep( 0.5, 0.76, gFbm( P * 5.5 + 41.0 ) ) * gWorn;   // a little, where hands and hoses have been
      gGrime = clamp( gShade * 0.85 + gRun * ( 0.09 + 0.36 * gShade ) + 0.32 * gSeam + 0.14 * gSmudge, 0.0, 1.0 );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.34, 0.31, 0.28 ), gGrime );
      diffuseColor.rgb *= 1.0 + 0.05 * ( gFbm( P * 1.7 + 17.0 ) - 0.5 );
      // pinpricks, a couple of millimetres, and a few nicks of a centimetre
      // (few in the clean middle of a panel, more where it is worn, most near its edges: fewer of them, not fainter)
      float gMany = clamp( 0.17 + 0.55 * gWorn * gWorn + 0.8 * smoothstep( 0.15, 0.65, gOrm.b ), 0.0, 1.0 );
      float gAt = mix( 0.91, 0.8, gMany );
      float gSpeck = smoothstep( gAt, gAt + 0.04, gNoise( P * 560.0 + 7.0 ) ) * gFine;
      float gNick = smoothstep( 0.86, 0.885, gNoise( P * 100.0 + 2.0 ) * 0.78 + gNoise( P * 370.0 ) * 0.22 ) * gWorn * gMid;
      // hairlines, a hand long, two ways, few
      float gScr = smoothstep( 0.825, 0.865, gNoise( vec3( dot( P, vec3( 0.62, 0.74, 0.26 ) ) * 12.0, dot( P, vec3( -0.74, 0.66, -0.12 ) ) * 1100.0, dot( P, vec3( -0.26, -0.12, 0.96 ) ) * 12.0 ) ) );
      gScr = max( gScr, smoothstep( 0.835, 0.875, gNoise( vec3( dot( P, vec3( 0.3, -0.5, 0.81 ) ) * 1000.0, dot( P, vec3( 0.9, 0.4, -0.1 ) ) * 10.0, dot( P, vec3( -0.3, 0.77, 0.56 ) ) * 10.0 ) + 9.0 ) ) );
      gScr *= gWorn * ( 1.0 - smoothstep( 0.0015, 0.005, gPx ) );
      // the edge: a line of paint worn through right on it, fine and broken, more in some stretches than others,
      // and small bites out of the paint beside it
      float gWhere = smoothstep( 0.32, 0.6, gFbm( P * 4.3 + 51.0 ) );
      float gRag = gFbm( P * 75.0 ) * 0.5 + gNoise( P * 280.0 + 5.0 ) * 0.5;
      float gLine = smoothstep( 0.66, 0.78, gOrm.b + ( gRag - 0.5 ) * 0.46 ) * ( 0.5 + 0.5 * gWhere );
      float gBite = smoothstep( 0.77, 0.83, gOrm.b * 0.6 + gNoise( P * 85.0 + 9.0 ) * 0.42 + gNoise( P * 300.0 + 1.0 ) * 0.12 ) * gWhere;
      gChip = max( gLine, gBite ) * gMid;
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.5, gScr * 0.6 );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.095, 0.09 ), max( gSpeck * 0.85, gNick ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.072, 0.07 ), gChip );`;

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
    sh.uniforms.uShade = SHADE;
    let frag = 'varying vec3 vGrit;\nuniform float uShade;\nfloat gGrime = 0.0, gChip = 0.0;\n' + NOISE + sh.fragmentShader;
    frag = frag.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_COLOR
        diffuseColor.rgb *= mix( 1.0 / max( vColor.r, 0.05 ), 1.0, uShade ); // (the baked shade on the vertices, off)
      #endif
      diffuseColor.rgb *= 1.0 + ${f(g.tint)} * (gFbm(vGrit * ${f(g.scale * 0.35)} + 11.0) - 0.5) * 2.0;${g.paint ? PAINT : ''}${
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
      roughnessFactor = clamp(roughnessFactor * mix(${f(g.rough[0])}, ${f(g.rough[1])}, smoothstep(0.25, 0.75, gFbm(vGrit * ${f(g.scale)}))), 0.04, 1.0);
      roughnessFactor = mix( min( roughnessFactor + 0.3 * gGrime, 1.0 ), 0.34, gChip );`,
    );
    if (g.paint) frag = frag.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n      metalnessFactor = gChip; // (the map\'s blue is the edge mask, not metal: bare metal only where the paint has chipped)');
    if (g.ribs) {
      frag = frag.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // ribs: their slope, the same however near they are, gone where they get finer than the pixels
          float w = max(fwidth(vUv.y), 1e-4);
          float h = 0.1 * (0.5 - 0.5 * cos(6.2831853 * vUv.y)) * (1.0 - smoothstep(0.2, 0.6, w));
          normal = gPerturb(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) / w * 0.35, faceDirection);
        }`,
      );
    }
    sh.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `grit:${g.scale}:${g.rough}:${g.tint}:${!!g.ribs}:${g.wear ?? 0}:${!!g.paint}`;
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

/** black rubber, smooth: the hoses on the pod and the cables to the ceiling */
export const rubber = grit(
  // (black, smooth: little sheen, dull, and no ribs any more, so it is a dark line with a soft edge of light)
  new THREE.MeshPhysicalMaterial({ name: 'hose', color: 0x060607, roughness: 0.74, metalness: 0, sheen: 0.18, sheenRoughness: 0.6, sheenColor: 0x1c1e22 }),
  { scale: 6, rough: [0.9, 1.15], tint: 0.06 },
);

/** steel wire: the slings and the wire it hangs by */
export const wire = grit(new THREE.MeshStandardMaterial({ color: 0x1e1f22, metalness: 1, roughness: 0.36 }), { scale: 30, rough: [0.75, 1.35], tint: 0.06 }); // brushed black, as the pod's

/** the hall's steel, painted long ago */
export function hallSteel(m: THREE.MeshStandardMaterial) {
  return grit(m, { scale: 0.7, rough: [0.75, 1.3], tint: 0.3 });
}

/** what glows red from inside the pod: the frosted window, the lamp in there (main.ts pulses them). (The raw metal
 * under the plates glowed too, round the door, to read as light in the seams: but the door is a slab of metal,
 * light does not come through it or out of its edge, and with the door open its rim was a band of orange.) */
export const GLOWING: { material: THREE.MeshStandardMaterial; gain: number }[] = [];

// the plates' paint without their textures, for the small things painted with them
const WHITE = grit(
  new THREE.MeshPhysicalMaterial({ name: 'paint_plain', color: 0xd6d6d1, roughness: 0.5, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.45 }),
  { scale: 40, rough: [0.85, 1.15], tint: 0.03, paint: true },
);
WHITE.defines = { ...WHITE.defines, ...POD_SUN, NO_POINT: '' };
const MADE = new Map<string, THREE.Material>(); // what dress() made of each of the glb's materials, by name

/** every material in the glb, by name, to what it is */
export function dress(root: THREE.Object3D) {
  const done = new Map<THREE.Material, THREE.Material>();
  const make = (old: THREE.MeshStandardMaterial): THREE.Material => {
    const name = old.name.replace(/[._]\d+$/, '');
    switch (name) {
      case 'paint': // painted plate: the baked wear, under a thin satin clearcoat
        return grit(physical(old, { clearcoat: 0.3, clearcoatRoughness: 0.45 }), { scale: 40, rough: [0.85, 1.15], tint: 0.03, paint: true });
      case 'mech': // gunmetal machinery
        return grit(physical(old, { color: 0x2b2f34, metalness: 0.85, roughness: 0.4 }), { scale: 9, rough: [0.65, 1.4], tint: 0.14 });
      case 'core': // the dark raw metal under the plates
        return grit(physical(old, { color: 0x15171a, metalness: 0.65, roughness: 0.55 }), { scale: 7, rough: [0.7, 1.4], tint: 0.18 });
      case 'steel': // clamps, collars, couplings, lugs, connectors: brushed black metal, a dull sheen and no shine
        return grit(physical(old, { color: 0x1c1d20, metalness: 1, roughness: 0.38 }), { scale: 25, rough: [0.75, 1.35], tint: 0.06 });
      case 'bolt': // zinc-plated bolt heads, dulled
        return grit(physical(old, { color: 0x6a6e73, metalness: 1, roughness: 0.4 }), { scale: 60, rough: [0.7, 1.5], tint: 0.18 });
      case 'brass': // (was brass: now a dark worn metal, as the rest of the fittings)
        return grit(physical(old, { color: 0x34363a, roughness: 0.46, metalness: 1 }), { scale: 20, rough: [0.7, 1.5], tint: 0.14 });
      case 'panel': // dark plastic: ribbed panels, boxes
        return grit(physical(old, { color: 0x313438, metalness: 0, roughness: 0.55, specularIntensity: 0.6 }), { scale: 14, rough: [0.8, 1.25], tint: 0.08 });
      case 'block': // light plastic housings, a little gloss
        return grit(physical(old, { color: 0xbdbdb6, metalness: 0, roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.5 }), { scale: 12, rough: [0.8, 1.3], tint: 0.06 });
      case 'dark': // matte black plastic
        return grit(physical(old, { color: 0x0f1011, metalness: 0, roughness: 0.72 }), { scale: 10, rough: [0.85, 1.15], tint: 0.1 });
      case 'shroud': // cloth, wrapped round what is inside
        return physical(old, { metalness: 0, roughness: 0.85, sheen: 1, sheenRoughness: 0.7, sheenColor: 0x8a8070 });
      case 'ink': // the painted marks: flat black, worn through in flakes
        return grit(physical(old, { color: 0x0b0c0d, metalness: 0, roughness: 0.62 }), { scale: 30, rough: [0.85, 1.2], tint: 0.15, wear: 0.27 });
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
      // the red light inside comes out through the window, and nowhere else
      const name = m.name.replace(/[._]\d+$/, '');
      MADE.set(name, made);
      if (name === 'frost') {
        const g = made as THREE.MeshStandardMaterial;
        g.emissive = new THREE.Color(0xff1a0a);
        g.emissiveIntensity = 0;
        GLOWING.push({ material: g, gain: 0.25 });
      }
      // the pod's own (not the rubber, shared with the cables that run up out of the tight sun's reach)
      if (made !== rubber) made.defines = { ...made.defines, ...POD_SUN };
      if (!INSIDE.has(m.name.replace(/[._]\d+$/, ''))) made.defines = { ...made.defines, NO_POINT: '' };
      done.set(m, made);
    }
      return done.get(m)!;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    // worn white all over: what is bolted onto the plates (hinges, vents' frames, slots' frames, the connectors, the
    // window's frame) is painted as they are, not black; the dark behind a vent or in a slot stays dark
    if (/^(detail_(steel|mech)_|door_frame)/.test(mesh.name)) mesh.material = WHITE;
  });
  // the dark in the corners, baked in Blender to a colour on each vertex of everything but the plates (whose paint
  // has it): their materials take it. A little lifted, so a corner is dim, not black
  const shaded = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const ao = mesh.isMesh ? (mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
    if (!ao) return;
    if (!mesh.geometry.userData.lifted) {
      for (let i = 0; i < ao.count; i++) {
        const v = 0.3 + 0.7 * ao.getX(i);
        ao.setXYZ(i, v, v, v);
      }
      ao.needsUpdate = true;
      mesh.geometry.userData.lifted = true;
    }
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) shaded.add(m);
  });
  for (const m of shaded) { m.vertexColors = true; m.needsUpdate = true; }
}
/** white on every vertex: for what is drawn with a material that takes the baked shade and has none of its own */
export function unshaded(geo: THREE.BufferGeometry) {
  if (!geo.getAttribute('color')) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3).fill(1), 3));
  return geo;
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
  const bolt = unshaded(new THREE.CylinderGeometry(0.0042, 0.0042, 0.005, 6).translate(0, 0.0005, 0));
  const collar = unshaded(new THREE.CylinderGeometry(1, 1, 0.06, 6));
  const found: THREE.Object3D[] = [];
  root.traverse((o) => { if (/^(bolts_|collars_hoses)/.test(o.name) && o.userData.at) found.push(o); });
  for (const o of found) {
    if (o.name.startsWith('bolts_')) make(o, bolt, MADE.get('bolt'), 6, () => 1);
    else make(o, collar, MADE.get('steel'), 7, (at, k) => at[k + 6]);
  }
}
