// The haze that the place fades into. Three's fog thickens with distance from the camera;
// this one thickens with distance from the middle of the map, so the edges of the world are lost in it
// from wherever the drone looks.
import { ShaderChunk } from 'three';

export const HAZE = 0xa3adb3;
export const CENTRE = { x: 10, y: -10 };
/** where it starts, and where nothing is left */
export const HAZE_FROM = 250, HAZE_TO = 430;

// measured per pixel, not per corner: the ground is one big quad
ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec2 vFogAt;
#endif
`;
ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogAt = (inverse(viewMatrix) * mvPosition).xz;
#endif
`;
ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec2 vFogAt;
  uniform float fogNear;
  uniform float fogFar;
#endif
`;
ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, length(vFogAt - vec2(${CENTRE.x.toFixed(1)}, ${CENTRE.y.toFixed(1)})));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;
