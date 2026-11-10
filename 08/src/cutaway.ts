import * as THREE from 'three';

/**
 * The cutaway: whatever of the machine stands between the camera and the probe is dithered away in a soft disc round
 * the probe on the page, so the probe is never lost behind a strut. One small addition to each of the machine's
 * materials, in the same pass: a fragment nearer than the probe and inside the disc is discarded against a 4 x 4
 * Bayer pattern, most in the middle and none at the rim; discarded, it writes no depth, so the depth of field sees
 * through it too. No raycast, no sorting, no extra pass.
 */
export const cut = {
  at: { value: new THREE.Vector3(0, 0, 2) }, // the probe in NDC: xy on the page, z its depth
  r: { value: 0.24 }, // the disc's radius, in NDC height (2 is the page's height)
  aspect: { value: 1 },
  on: { value: 0 }, // 0 to 1, eased: none of it to all of it
  px: { value: 1.5 }, // the dither's dot, in device pixels (DITHER_PX CSS px)
};
export const DITHER_PX = 1.5; // the dot in CSS px, times the pixel ratio each frame (one device pixel at first, read as a plain fade; 3, too hard; a honeycomb of hexagonal holes for a moment)
export const CUT_MOST = 0.6; // the most that goes, in the middle: a shade of the strut stays, so it still reads (0.85 for a moment)

const VERT = `varying vec4 vCutClip;\n`;
const FRAG = `
uniform vec3 uCutAt; uniform float uCutR; uniform float uCutAspect; uniform float uCutOn; uniform float uCutPx;
varying vec4 vCutClip;
const float CUT_BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
`;
const CUT = `
  if (uCutOn > 0.0) {
    vec3 cutNdc = vCutClip.xyz / vCutClip.w;
    float cutD = length((cutNdc.xy - uCutAt.xy) * vec2(uCutAspect, 1.0)) / uCutR;
    if (cutNdc.z < uCutAt.z && cutD < 1.0) {
      float cutA = uCutOn * ${CUT_MOST.toFixed(2)} * (1.0 - smoothstep(0.5, 1.0, cutD));
      ivec2 cutQ = ivec2(mod(floor(gl_FragCoord.xy / uCutPx), 4.0));
      if (cutA > (CUT_BAYER[cutQ.x + cutQ.y * 4] + 0.5) / 16.0) discard;
    }
  }
`;

/** Every material under `root` gets the cutaway, once; a material it already has is left alone. */
export function withCut(root: THREE.Object3D) {
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      if (m.userData.cut) continue;
      m.userData.cut = true;
      const before = m.onBeforeCompile.bind(m);
      m.onBeforeCompile = (sh, gl) => {
        before(sh, gl);
        sh.uniforms.uCutAt = cut.at; sh.uniforms.uCutR = cut.r; sh.uniforms.uCutAspect = cut.aspect; sh.uniforms.uCutOn = cut.on; sh.uniforms.uCutPx = cut.px;
        sh.vertexShader = VERT + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vCutClip = gl_Position;');
        sh.fragmentShader = FRAG + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + CUT);
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => key() + '|cut';
      m.needsUpdate = true;
    }
  });
}
