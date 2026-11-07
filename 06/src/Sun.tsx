import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { sunGlow, sunLight } from './intro';
import { type Mesh, type PointLight, SphereGeometry } from 'three';
import { gumMaterial, type Gum } from './Beans';
import { motion } from './clock';
import { ORBIT_Y } from './scale';

// The sun: a big sugared jelly ball at the middle of the orbits, orange gum with the light inside it, so the planets
// are lit from the sun's side and throw their shadows away from it.
const RADIUS = 3.3;
const JELLY: Gum = { deep: [255, 120, 0], pale: [255, 200, 40], bands: 0, size: 2048, grains: 70000 };

function SunLight() {
  const light = useRef<PointLight>(null!);
  useFrame(() => void (light.current.intensity = 260 * sunLight()));
  return (
    <pointLight
      ref={light}
      color="#ffe2b8"
      intensity={260}
      decay={1}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0005}
      shadow-radius={4}
      shadow-camera-near={RADIUS + 0.1}
      shadow-camera-far={90}
    />
  );
}

// The jelly ball: sugared gum glowing from inside, as the light is in it. The glow goes through the colour map, so
// the sugar grains shine paler than the gum, and it's faked subsurface: looking straight in there's least gum to get
// through, so the middle is bright and pale; towards the rim it crosses more, so it dims and deepens to amber.
// It casts no shadow of its own.
const JELLY_TIME = { value: 0 };
function jellyMaterial() {
  const m = gumMaterial('Sun', JELLY, RADIUS, '#ff8a00', 1, -1);
  m.emissive.set('#ffffff');
  m.emissiveMap = m.map;
  m.emissiveIntensity = 1.5;
  m.clearcoat = 0.7; // a wet, glassy gloss over the gum, like clear jelly
  m.clearcoatRoughness = 0.12;
  m.transmission = 0.15; // mostly glowing gum; much more and the pale room shows through and bleaches it
  m.needsUpdate = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = JELLY_TIME;
    // A slow wobble: the surface pushed in and out along its radius by a few long, slow, overlapping waves that
    // drift with time, so it never quite holds a shape. The normal is tipped by the wobble's slope to match.
    sh.vertexShader = sh.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float uTime;
  float jellyWobble(vec3 p, float t) {
    return 0.035 * sin(p.x * 1.8 + t * 0.7) * sin(p.y * 2.2 - t * 0.5)
         + 0.025 * sin(p.z * 2.6 + p.x * 1.2 + t * 0.9)
         + 0.015 * sin(p.y * 4.2 + p.z * 3.4 - t * 1.3);
  }
void main() {`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
  vec3 jellyDir = normalize(position);
  float jellyW = jellyWobble(jellyDir, uTime);
  {
    float e = 0.01;
    vec3 g = vec3(jellyWobble(jellyDir + vec3(e, 0, 0), uTime), jellyWobble(jellyDir + vec3(0, e, 0), uTime), jellyWobble(jellyDir + vec3(0, 0, e), uTime)) - jellyW;
    g /= e;
    g -= dot(g, jellyDir) * jellyDir; // only its slope along the surface tips the normal
    objectNormal = normalize(objectNormal - g / (1.0 + jellyW));
  }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= 1.0 + jellyW;')
      .replace(
        '#include <uv_vertex>',
        /* glsl */ `#include <uv_vertex>
  // The sugar slides about on the jelly as it wobbles: every map's coordinates drift by a slow field over the ball.
  {
    vec3 d = normalize(position);
    vec2 drift = vec2(0.006 * sin(d.y * 3.0 + uTime * 0.6) * sin(d.z * 2.5 - uTime * 0.4),
                      0.004 * sin(d.x * 2.8 - uTime * 0.5) * sin(d.y * 3.3 + uTime * 0.7));
    #ifdef USE_MAP
      vMapUv += drift;
    #endif
    #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv += drift;
    #endif
    #ifdef USE_BUMPMAP
      vBumpMapUv += drift;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv += drift;
    #endif
  }`,
      );
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
  float facing = abs(dot(normal, normalize(vViewPosition)));
  vec3 core = vec3(1.0, 0.95, 0.7), deep = vec3(1.0, 0.4, 0.02);
  totalEmissiveRadiance *= mix(deep, core, pow(facing, 2.0)) * (0.55 + 1.1 * pow(facing, 1.5));`,
    );
  };
  return m;
}

export function Sun() {
  const { geometry, material } = useMemo(() => ({ geometry: new SphereGeometry(RADIUS, 128, 64), material: jellyMaterial() }), []);
  const ball = useRef<Mesh>(null!);
  useFrame(({ camera }, dt) => {
    material.emissiveIntensity = 1.5 * sunGlow();
    JELLY_TIME.value += dt * motion(); // the wobble stops with the clock, and slows with it
  });
  return (
    <group position={[0, ORBIT_Y, 0]}>
      <mesh ref={ball} geometry={geometry} material={material} />
      <SunLight />
    </group>
  );
}
