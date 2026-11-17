// Two full-screen passes after the scene, both from the scene's own depth. A depth pass with three's depth
// material would drop the shells' and fronds' vertex shaders, so nothing is re-rendered.
//  1. atmosphere: haze over distance, the canopy sky behind everything, light shafts from a low sun through
//     whatever stands in front of it. Writes the view depth into alpha.
//  2. lens: depth of field gathered from that, then a grade and a vignette.
// The haze used to be computed inside the gather, once per tap: 56 times per pixel. Now it is once.
import * as THREE from 'three';

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function makeAtmosPass(depth: THREE.DepthTexture, coarse = false) {
  return new THREE.ShaderMaterial({
    defines: { SHAFT_STEPS: coarse ? 12 : 24 },
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: depth },
      cameraNear: { value: 0.05 },
      cameraFar: { value: 80 },
      uHaze: { value: new THREE.Color(0.085, 0.066, 0.036) }, // autumn: golden-brown air
      uSunCol: { value: new THREE.Color(1.0, 0.68, 0.34) },
      uFog: { value: 0.13 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uTime: { value: 0 },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, // the sun on screen
      uSunOn: { value: 0 }, // 1 facing the sun, 0 with it behind you
      uAspect: { value: 1 },
      uMist: { value: 0.0 }, // ground mist density
      uMistStart: { value: 0.6 }, // clear air out to here
    },
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform float cameraNear, cameraFar, uFog, uTime;
      uniform vec3 uHaze, uSunCol, uSunDir;
      uniform mat4 uInvProj, uCamWorld;
      uniform vec2 uSunUv;
      uniform float uSunOn, uAspect, uMist, uMistStart;
      varying vec2 vUv;

      float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      // what is behind everything: plain golden air, a broad glow all round the sun's side and brighter towards it
      // (bright canopy gaps were here once, but between the trunks they read as patches cut out of paper)
      vec3 sky(vec3 r) {
        float s = max(dot(r, uSunDir), 0.0);
        vec3 gold = vec3(1.0, 0.68, 0.24);
        return uHaze * 1.7 * vec3(1.35, 0.95, 0.42) + gold * (0.12 + 0.3 * s * s) * smoothstep(-0.1, 0.4, r.y) + uSunCol * pow(s, 6.0) * 0.7;
      }
      // the air between: thicker low down, lit warm towards the sun
      vec3 haze(vec3 r) {
        float s = max(dot(r, uSunDir), 0.0);
        vec3 h = uHaze * (0.8 + 1.4 * smoothstep(-0.1, 0.5, r.y));
        return h + uSunCol * (pow(s, 4.0) * 0.35 + pow(s, 24.0) * 0.8);
      }
      void main() {
        float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, cameraNear, cameraFar);
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 r = normalize(mat3(uCamWorld) * (v.xyz / v.w));
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        // the background, and what the fog fades everything into: the same colour, so far trunks melt into it
        vec3 bg = mix(sky(r), haze(r), 0.35);
        if (z > cameraFar * 0.99) c = bg;
        else {
          // ground mist: a layer lying on the moss, thick at the bottom and thinning out a metre up; the light in
          // it is the haze's, so it glows towards the sun. Integrated along the ray through an exponential layer.
          vec3 cam = uCamWorld[3].xyz;
          float H = 0.35;
          float y0 = max(cam.y, 0.0), y1 = max(cam.y + r.y * z, 0.0);
          float dy = y1 - y0;
          float layer = abs(dy) > 1e-3 ? H * (exp(-y0 / H) - exp(-y1 / H)) / dy : exp(-y0 / H);
          // clear right around you: the mist only starts a little way off, easing in
          float zm = max(z - uMistStart, 0.0) * smoothstep(uMistStart, uMistStart * 2.5, z);
          float mist = 1.0 - exp(-zm * uMist * layer);
          // a cheat: what the sun lights brighter than the air shows through it a little further (a trunk's sunny
          // side a few steps off was lost in the haze like its shaded one): thinner air for it, so it still goes
          // in the end (a share of it kept at any distance left far trunks standing out of the fog)
          vec3 hz = bg;
          float lum = dot(c, vec3(0.3, 0.55, 0.15)), hl = dot(hz, vec3(0.3, 0.55, 0.15));
          float thin = 1.0 - 0.4 * smoothstep(1.0, 2.5, lum / max(hl, 1e-3));
          float f = 1.0 - (1.0 - mist) * exp(-max(z - 1.2, 0.0) * uFog * thin);
          c = mix(c, hz, f);
        }
        // light shafts: march towards the sun on screen and count how much of the way is open sky or far,
        // hazy air. Grass, stalks, stems and trunks in between cut dark wedges out of the glow.
        if (uSunOn > 0.0) {
          vec2 d = (uSunUv - vUv);
          float len = length(d * vec2(uAspect, 1.0));
          vec2 stp = d / float(SHAFT_STEPS) * min(1.0, 0.7 / max(len, 1e-3));
          vec2 uv = vUv + stp * h2(vUv * 917.0); // jittered start: no banding
          float acc = 0.0, wsum = 0.0, wgt = 1.0;
          for (int i = 0; i < SHAFT_STEPS; i++) {
            float zz = -perspectiveDepthToViewZ(texture2D(tDepth, clamp(uv, 0.0, 1.0)).x, cameraNear, cameraFar);
            acc += smoothstep(3.0, 9.0, zz) * wgt;
            wsum += wgt;
            wgt *= 0.95;
            uv += stp;
          }
          float open = acc / wsum;
          float glow = exp(-len * 2.2);
          c += uSunCol * open * glow * uSunOn * 0.55;
        }
        gl_FragColor = vec4(c, z); // half float alpha: plenty for a depth used only for blur sizes
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

export function makeLensPass(coarse = false) {
  return new THREE.ShaderMaterial({
    defines: { TAPS: coarse ? 24 : 40 },
    uniforms: {
      tDiffuse: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: 1.6 }, // focus distance, world units
      uAperture: { value: 1.0 }, // blur radius in px at one dioptre of defocus, times uMaxBlur
      uMaxBlur: { value: 14 }, // px, at the drawing buffer's size
    },
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; // rgb: the scene in its haze, a: view depth
      uniform vec2 uRes;
      uniform float uFocus, uAperture, uMaxBlur;
      varying vec2 vUv;

      // blur radius in px: thin lens, proportional to the difference in dioptres from the focus
      float coc(float z) { return min(abs(1.0 / uFocus - 1.0 / max(z, 0.01)) * uAperture * uMaxBlur, uMaxBlur); }

      void main() {
        vec4 c0 = texture2D(tDiffuse, vUv);
        float zc = c0.a;
        float cc = coc(zc);
        vec3 acc = c0.rgb;
        float wsum = 1.0;
        const int N = TAPS;
        for (int i = 1; i < N; i++) {
          float fi = float(i);
          float r = sqrt(fi / float(N)) * uMaxBlur;
          float a = fi * 2.39996323;
          vec4 s = texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r / uRes);
          float sc = coc(s.a);
          // a blurry background must not bleed over a sharp thing in front of it
          if (s.a > zc) sc = min(sc, cc);
          float w = smoothstep(r - 1.0, r + 0.5, sc);
          acc += s.rgb * w;
          wsum += w;
        }
        vec3 col = acc / wsum;

        // grade, one look over everything: an autumn dusk on film
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // greens pulled towards olive and calmed: the moss was a loud lime next to the golden ferns
        float green = max(col.g - max(col.r, col.b), 0.0);
        col.r += green * 0.45;
        col = mix(vec3(l), col, 1.0 - 0.45 * smoothstep(0.0, 0.12, green));
        // the grey haze warmed: unsaturated midtones lean amber instead of sitting a flat green-grey
        float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
        col = mix(col, l * vec3(1.14, 1.0, 0.74), (1.0 - smoothstep(0.03, 0.16, sat)) * smoothstep(0.04, 0.3, l) * 0.65);
        // split toning: shadows a deep blue-teal, highlights a cream gold
        col = mix(col * vec3(0.86, 0.95, 1.06), col * vec3(1.08, 0.99, 0.86), smoothstep(0.03, 0.45, l));
        // a soft S: deeper shadows, a rounded shoulder so the sunlit fronds do not burn out to white
        l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float lc = l < 0.5 ? 2.0 * l * l * (1.5 - l) + l * 0.25 : l;
        lc = mix(lc, 0.82 + 0.18 * (1.0 - exp(-(l - 0.72) * 4.0)), step(0.72, l));
        col *= mix(1.0, lc / max(l, 1e-4), 0.55);
        col += vec3(0.005, 0.007, 0.009); // lifted blacks, like a lens in haze
        vec2 v = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        col *= mix(1.0, 0.55, smoothstep(0.35, 1.05, length(v)));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}
