// Lightweight optical GLSL for the human eyeball, patched into MeshPhysicalMaterial.
// All fine iris structure (fibers, crypts, collarette, furrows, freckles, limbal ring)
// and scleral anatomy (vascular blush, deep & superficial veins) are pre-baked in eyeBake.ts.
//
// Runtime shader computes only view- and state-dependent optics (zero procedural noise loops):
// - corneal refraction (IOR 1.376) onto the recessed iris plane with subtle parallax
// - radial biomechanical iris stretch as uPupil expands and contracts
// - corneal caustic focusing directional light onto the far crescent of the iris
// - soft feathered translucent corneoscleral limbus overlap with horizontal ellipticity
// - dual-layer wetness: glassy corneal clearcoat over 3D fibrous iris & subtle vein normals
// - subtle warm subsurface wrap scattering on sclera and iris stroma

export const eyeVertexPars = /* glsl */ `
varying vec3 vEyePos;
varying vec3 vEyeNrm;
`;

export const eyeVertexMain = /* glsl */ `
vEyePos = transformed;
vEyeNrm = normal;
`;

export const eyeFragmentPars = /* glsl */ `
varying vec3 vEyePos;
varying vec3 vEyeNrm;

uniform sampler2D tIrisCol;
uniform sampler2D tIrisData;
uniform sampler2D tScleraCol;
uniform sampler2D tScleraNrm;

uniform vec3 uCam;        // camera position in eye object space
uniform vec3 uLight;      // direction towards key light in eye object space
uniform mat3 uToView;     // object normal -> view normal
uniform float uPupil;     // current pupil radius in iris radii (0.16 .. 0.58)
uniform float uPupilRef;  // baked reference pupil radius (0.28)
uniform float uGlow;      // red retinal reflex alignment (0..1)
uniform float uLimbAngle; // limbus half-angle (rad)
uniform float uLimbR;     // iris outer radius in object-space xy at limbus plane
uniform float uIrisZ;     // z of the iris plane in object space
uniform float uIor;       // cornea/aqueous refractive index (~1.376)

struct EyeS {
  vec3 alb;
  vec3 n;
  vec3 ccN;
  vec3 emit;
  vec3 sssCol;
  float rough;
  float ccRough;
  float spec;
  float lit;
  float indLit;
  float wrap;
};
EyeS eS;

// Minimal-twist orthonormal basis (T, B) on the sphere matching (+X, +Y) at +Z.
void eyeBasis(vec3 n, out vec3 T, out vec3 B) {
  float inv1z = 1.0 / max(1.0 + n.z, 1e-3);
  T = vec3(1.0 - n.x * n.x * inv1z, -n.x * n.y * inv1z, -n.x);
  B = vec3(-n.x * n.y * inv1z, 1.0 - n.y * n.y * inv1z, -n.y);
}

EyeS evalIris(vec3 pos, vec3 nSurf, vec3 V) {
  EyeS s;
  // 1. Refract view ray through the curved corneal dome onto the recessed iris plane
  vec3 T = refract(V, nSurf, 1.0 / uIor);
  float tz = min(T.z, -0.10);
  float tPlane = max((uIrisZ - pos.z) / tz, 0.0);
  vec3 h = pos + T * tPlane;

  // Subtle anterior iris bow (real iris sits slightly forward near the crystalline lens)
  vec2 hu0 = h.xy / uLimbR;
  float rho0 = length(hu0);
  float bowZ = uIrisZ + 0.018 * max(0.0, 1.0 - rho0 * rho0);
  h = pos + T * max((bowZ - pos.z) / tz, 0.0);
  vec2 hu = h.xy / uLimbR;

  // Tiny anatomical nasal-superior pupil decentration (~1.2% of iris radius)
  vec2 pCenter = vec2(-0.012, 0.008);
  vec2 hp = hu - pCenter;
  float rho = length(hu);
  float rhoP = length(hp);
  float phi = atan(hp.y, hp.x);

  // Subtle organic micro-irregularity on the pupil rim (real pupils aren't laser circles)
  float pWob = 1.0 + 0.007 * sin(phi * 5.0 + 0.8) + 0.004 * cos(phi * 9.0 - 1.4);
  float pRad = uPupil * pWob;

  // 2. Biomechanical radial stretch: remap [pRad, 1.0] -> baked rest space [uPupilRef, 1.0]
  float span = clamp((rhoP - pRad) / max(1.0 - pRad, 0.06), 0.0, 1.0);
  float rRef = mix(uPupilRef, 1.0, pow(span, 0.92));
  vec2 dirP = hp / max(rhoP, 1e-4);
  vec2 irisUV = vec2(0.5) + dirP * (rRef * 0.485);

  // Subtle micro-parallax inside the iris stroma using baked height (alpha channel)
  vec4 idata0 = texture2D(tIrisData, irisUV);
  float hDepth = (idata0.a - 0.5) * 0.014;
  vec2 uvPar = clamp(irisUV + (T.xy / max(-tz, 0.25)) * hDepth, vec2(0.01), vec2(0.99));

  vec3 col = texture2D(tIrisCol, uvPar).rgb;
  vec4 idata = texture2D(tIrisData, uvPar);

  // Tangent-space iris stroma normal: deepens gently as pupil dilates & folds compress
  float compress = mix(0.88, 1.28, smoothstep(0.18, 0.54, uPupil));
  vec2 nxy = (idata.rg * 2.0 - 1.0) * (0.76 * compress);
  vec3 nIris = normalize(vec3(nxy, 1.0) + vec3(hu * 0.06, 0.0));

  // Baked multi-scale crypt/furrow AO, deepened gently on dilation
  float ao = mix(1.0, idata.b, mix(0.80, 1.08, smoothstep(0.20, 0.52, uPupil)));
  col *= ao;

  // 3. Pupil edge & velvety optical interior
  float sd = rhoP - pRad;
  float aaP = max(fwidth(sd) * 1.15, 0.0022);
  float hole = 1.0 - smoothstep(-aaP, aaP, sd);
  // Dark pupillary ruff margin shadow right at the pupil rim
  col *= mix(0.38, 1.0, smoothstep(0.0, 0.032, sd));

  // 4. Corneal caustic: curved corneal lens focuses light onto the FAR crescent of the iris
  // while casting soft corneal-limbal shade onto the near rim.
  vec2 l2 = uLight.xy;
  float ll = length(l2);
  vec2 lDir = ll > 1e-3 ? l2 / ll : vec2(0.0);
  float farSide = dot(hu / max(rho, 1e-4), -lDir) * smoothstep(0.05, 0.65, ll);
  float causticArc = smoothstep(-0.18, 0.95, farSide) * smoothstep(0.16, 0.88, rho);
  float nearShade  = smoothstep(0.08, 0.95, -farSide) * smoothstep(0.45, 1.0, rho);
  float lit = (1.0 + 1.55 * causticArc) * (1.0 - 0.58 * nearShade);
  float indLit = (1.0 + 0.14 * causticArc) * (1.0 - 0.34 * nearShade);

  // Luminous translucent scatter inside the sunlit caustic crescent
  col = mix(col, col * vec3(1.10, 1.12, 1.06), causticArc * 0.42);

  // Deep anterior chamber angle shadow at the peripheral iris root
  float rimDark = smoothstep(0.84, 1.02, rho);
  col *= 1.0 - 0.58 * rimDark;

  // Deep velvety pupil cavity + ultra-subtle retinal reflex only when aligned with light + view
  float insideMask = smoothstep(0.0, -0.05, sd);
  vec3 retina = vec3(0.45, 0.055, 0.025) * (0.0005 + uGlow * 0.042) * insideMask;
  vec3 voidAlb = vec3(0.001, 0.0014, 0.0018);

  s.alb = mix(col, voidAlb, hole);
  s.n = mix(nIris, vec3(0.0, 0.0, 1.0), hole);
  s.ccN = nSurf; // smooth optical-grade corneal tear film
  s.emit = retina * hole;
  s.sssCol = vec3(0.82, 0.94, 0.88);
  s.rough = mix(0.58, 0.35, hole);
  s.ccRough = 0.022; // crisp optical corneal gloss
  s.spec = mix(0.11, 0.0, hole);
  s.lit = mix(lit, 0.15, hole);
  s.indLit = mix(indLit, 0.08, hole);
  s.wrap = 0.40 * (1.0 - hole);
  return s;
}

EyeS evalSclera(vec3 pDir, vec3 nSurf) {
  EyeS s;
  // Lambert azimuthal equal-area UV centered on +z (matches bakeSclera)
  float k = inversesqrt(max(2.0 * (1.0 + pDir.z), 1e-4));
  vec2 sUV = vec2(0.5) + 0.49 * pDir.xy * k;

  vec3 col = texture2D(tScleraCol, sUV).rgb;
  vec4 nSample = texture2D(tScleraNrm, sUV);
  vec2 nxy = nSample.rg * 2.0 - 1.0;

  vec3 T, B;
  eyeBasis(nSurf, T, B);
  vec3 nSclera = normalize(nSurf + (T * nxy.x + B * nxy.y) * 0.22);
  vec3 ccSclera = normalize(nSurf + (T * nxy.x + B * nxy.y) * 0.07);

  s.alb = col;
  s.n = nSclera;
  s.ccN = ccSclera;
  s.emit = vec3(0.0);
  s.sssCol = vec3(1.0, 0.66, 0.56);
  s.rough = 0.36;
  s.ccRough = 0.068;
  s.spec = 0.30;
  s.lit = 1.0;
  s.indLit = 1.0;
  s.wrap = 0.48;
  return s;
}

void eyeShade() {
  vec3 pDir = normalize(vEyePos);
  vec3 nSurf = normalize(vEyeNrm);
  vec3 V = normalize(vEyePos - uCam);

  // Subtle horizontal ellipticity: superior & inferior sclera overlaps the limbus slightly
  vec2 eXY = vec2(pDir.x * 0.985, pDir.y * 1.022);
  float ang = atan(length(eXY), pDir.z) - uLimbAngle;

  // Soft translucent corneoscleral limbus overlap (~0.045 rad feathered frosted-glass blend)
  float feather = max(0.044, fwidth(ang) * 2.0);
  float blend = smoothstep(-feather, feather, ang);

  // Always evaluate both unconditionally so 2x2 pixel quad derivatives (texture2D mipmaps
  // & fwidth) are 100% artifact-free right across the limbus transition!
  EyeS ir = evalIris(vEyePos, nSurf, V);
  EyeS sc = evalSclera(pDir, nSurf);

  // Subtle translucent milky-blue scleral overhang haze across the limbal border
  float haze = 4.0 * blend * (1.0 - blend);
  vec3 mixedAlb = mix(ir.alb, sc.alb, smoothstep(0.0, 1.0, blend));
  mixedAlb = mix(mixedAlb, vec3(0.58, 0.63, 0.66), haze * 0.16);

  eS.alb     = mixedAlb;
  eS.n       = normalize(mix(ir.n, sc.n, blend));
  eS.ccN     = normalize(mix(ir.ccN, sc.ccN, blend));
  eS.emit    = mix(ir.emit, sc.emit, blend);
  eS.sssCol  = mix(ir.sssCol, sc.sssCol, blend);
  eS.rough   = mix(ir.rough, sc.rough, blend);
  eS.ccRough = mix(ir.ccRough, sc.ccRough, blend);
  eS.spec    = mix(ir.spec, sc.spec, blend);
  eS.lit     = mix(ir.lit, sc.lit, blend);
  eS.indLit  = mix(ir.indLit, sc.indLit, blend);
  eS.wrap    = mix(ir.wrap, sc.wrap, blend);
}
`;

// Patch hooks into Three.js MeshPhysicalMaterial's fragment shader.
export const eyeFragmentHooks: Array<[string, string]> = [
  ['#include <color_fragment>', `
  eyeShade();
  diffuseColor.rgb = eS.alb;`],
  ['#include <normal_fragment_maps>', `
  normal = normalize(uToView * eS.n);`],
  ['#include <clearcoat_normal_fragment_maps>', `
  #ifdef USE_CLEARCOAT
  clearcoatNormal = normalize(uToView * eS.ccN);
  #endif`],
  ['#include <emissivemap_fragment>', `
  totalEmissiveRadiance += eS.emit;`],
  ['#include <lights_physical_fragment>', `
  material.roughness = clamp(eS.rough + geometryRoughness, 0.045, 1.0);
  #ifdef USE_CLEARCOAT
  material.clearcoatRoughness = clamp(eS.ccRough + geometryRoughness, 0.022, 1.0);
  #endif
  material.specularColor *= eS.spec;
  material.specularColorBlended *= eS.spec;
  material.specularF90 *= eS.spec;`],
  ['#include <lights_fragment_end>', `
  reflectedLight.indirectDiffuse *= eS.indLit;
  #if NUM_DIR_LIGHTS > 0
  {
    // Subtle subcutaneous wrap scatter round the terminator + corneal caustic focus
    vec3 ld = directionalLights[0].direction;
    float ndl = dot(normal, ld);
    float wr = max(0.0, (ndl + eS.wrap) / (1.0 + eS.wrap)) - max(ndl, 0.0);
    reflectedLight.directDiffuse *= eS.lit;
    reflectedLight.directDiffuse += directionalLights[0].color * wr * RECIPROCAL_PI * material.diffuseContribution * eS.sssCol * eS.lit;
  }
  #endif`],
];
