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
    // (16 each: at 24 and 28 they were a quarter of the frame, the beams' field is smooth and the shafts' start jittered,
    // and the picture is the same to the eye)
    defines: { SHAFT_STEPS: coarse ? 10 : 16, VOL_STEPS: coarse ? 10 : 16 },
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
      uGroundY: { value: 0 }, // the ground under the eye: the mist lies on it, not on y = 0
      uBeam: { value: 0.9 }, // the beams in the air: how much brighter the lit air, darker the shaded
      uCanopyMap: { value: null as THREE.Texture | null }, // the crowns' shade from above (foliage.ts), as the floor's
      uCanopyBox: { value: new THREE.Vector3(0, 0, 1) },
      uCanopyAmt: { value: 1 }, // shared with the scene's (main.ts)
      // the shafts: bright, hard edged (open sky counted to a power, so the trunks cut clean wedges out of them,
      // beams as in the splash rather than a glow), reaching a long way from the sun on screen
      uShaft: { value: 1.1 },
      uShaftPow: { value: 2.5 },
      uShaftReach: { value: 1.4 },
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
      uniform float uSunOn, uAspect, uMist, uMistStart, uShaft, uShaftPow, uShaftReach, uGroundY, uBeam;
      uniform sampler2D uCanopyMap;
      uniform vec3 uCanopyBox;
      uniform float uCanopyAmt;
      varying vec2 vUv;

      float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      // the canopy's light, as shaders.ts canopyAt: pools and spots of sun projected down along the light, so the
      // air between the crowns and the floor is lit in the same columns the floor is
      float cNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
      }
      // (only its pools and the larger spots, softly: with the finest spots, neighbouring pixels sampled light and
      // dark and the beams came out as a dither)
      float beamAt(vec3 wp, vec3 L, vec3 A, vec3 B) {
        vec2 q = vec2(dot(wp, A), dot(wp, B));
        vec2 sway = vec2(sin(uTime * 0.35), cos(uTime * 0.27)) * 0.04;
        float big = cNoise(q * 0.9 + 3.0);
        float n = cNoise(q * 3.2 + sway) * 0.62 + cNoise(q * 7.5 - sway * 1.7 + 9.0) * 0.38;
        // the crowns' shade where they are, as on the floor: the beams come down through the gaps between the
        // pines' clumps and not through a spruce (a softer level of the map: the air is lit in columns, not specks)
        vec2 g = (wp.xz - (10.0 + (wp.y - 10.0) * 0.3) * L.xz / max(L.y, 0.05) - uCanopyBox.xy) / uCanopyBox.z; // heights squeezed as the map's
        float open = (g.x > 0.0 && g.y > 0.0 && g.x < 1.0 && g.y < 1.0) ? texture2D(uCanopyMap, g, 1.5).r : 0.55;
        open = mix(open, 0.55, smoothstep(14.0, 26.0, length(g - 0.5) * uCanopyBox.z));
        return smoothstep(0.4, 0.62, n + (big - 0.5) * mix(0.45, 0.25, min(uCanopyAmt, 1.0)) + (open - 0.55) * 0.45 * uCanopyAmt); // a nudge, as the floor's
      }
      // what is behind everything: plain golden air, a broad glow all round the sun's side and brighter towards it
      // (bright canopy gaps were here once, but between the trunks they read as patches cut out of paper)
      vec3 sky(vec3 r) {
        float s = max(dot(r, uSunDir), 0.0);
        vec3 gold = vec3(1.0, 0.68, 0.24);
        // (the gold reaching down to eye level and round to the side away from the sun: fading out above the
        // horizon, the depth of the wood at eye level was a dark brown the grade turned khaki grey)
        return uHaze * 1.7 * vec3(1.15, 1.0, 0.72) + gold * (0.13 + 0.3 * s * s * s) * smoothstep(-0.45, 0.3, r.y) + uSunCol * pow(s, 10.0) * 0.8;
      }
      // the air between: thicker low down, lit warm towards the sun
      vec3 haze(vec3 r) {
        float s = max(dot(r, uSunDir), 0.0);
        vec3 h = uHaze * (1.1 + 1.1 * smoothstep(-0.3, 0.5, r.y)) + vec3(0.05, 0.032, 0.01); // warm at eye level too
        return h + uSunCol * (pow(s, 8.0) * 0.22 + pow(s, 32.0) * 0.8);
      }
      // the ground mist's own colour: the haze lit warm by the sun, more so toward it, the way you face across the
      // ground rather than up or down (mixed toward the sky's colour, looking level or down it took the sky's dark
      // low half: a dull grey-brown band, flat and dirty, unlike the golden air above it)
      vec3 mistCol(vec3 r) {
        vec2 f = normalize(r.xz + 1e-5), sl = normalize(uSunDir.xz + 1e-5);
        float s = max(dot(f, sl), 0.0);
        return uHaze * 1.6 * vec3(1.15, 1.0, 0.75) + vec3(1.0, 0.72, 0.36) * (0.07 + 0.25 * s * s * s);
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
          float y0 = max(cam.y - uGroundY, 0.0), y1 = max(cam.y + r.y * z - uGroundY, 0.0);
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
          // the mist first, in its own colour, then the haze over distance in the sky's
          c = mix(c, mistCol(r), mist);
          c = mix(c, hz, 1.0 - exp(-max(z - 1.2, 0.0) * uFog * thin));
        }
        // beams in the air: step along the view ray through the air, out to thirty metres, and at each step ask whether
        // the sun gets down through the crowns there. Lit air brighter, shaded air darker, the difference from the
        // average put on the picture: columns of light through the wood seen from anywhere, the sun on screen or not.
        // The air is far thicker low down, a mist on the moss, so the beams light up most where they reach it.
        {
          vec3 cam = uCamWorld[3].xyz;
          vec3 L = normalize(uSunDir);
          vec3 A = normalize(cross(L, vec3(0.0, 0.0, 1.0))), B = cross(L, A);
          float maxD = min(z, 30.0) * step(0.0001, uBeam); // (beams off: no march at all)
          // no jitter: the field is smooth enough now for the steps not to band (jittered per pixel, white noise read
          // as grain and an interleaved gradient as a fine hatching)
          float jit = 0.5;
          float lit = 0.0, wsum = 0.0, dens = 0.0;
          for (int i = 0; i < VOL_STEPS; i++) {
            if (maxD <= 0.0) break;
            float s = (float(i) + jit) / float(VOL_STEPS);
            float d = 0.25 + s * s * maxD; // closer together near the eye
            vec3 p = cam + r * d;
            float h = max(p.y - uGroundY, 0.0);
            float rho = 0.25 + 2.2 * exp(-h / 0.7); // thin air, thick on the moss
            float w = rho * (2.0 * s + 0.05) * exp(-d * 0.05);
            lit += beamAt(p, L, A, B) * w;
            wsum += w;
            dens += rho * (2.0 * s + 0.05) / float(VOL_STEPS);
          }
          float frac = lit / max(wsum, 1e-4); // how much of the air on the way is in the sun
          float fwd = 0.4 + 0.9 * pow(max(dot(r, L), 0.0), 3.0); // fine haze scatters forward
          float amount = (1.0 - exp(-maxD * 0.15)) * min(dens, 1.5);
          c = max(c + uSunCol * (frac - 0.38) * uBeam * fwd * amount, vec3(0.0));
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
          float open = pow(acc / wsum, uShaftPow);
          float glow = exp(-len * uShaftReach);
          // (softer right at the sun: looking straight into it, the full beams washed everything out to white)
          c += uSunCol * open * glow * uSunOn * uShaft * (1.0 - 0.6 * exp(-len * 5.0));
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
      // the grade, in uniforms for the look panel (?debug), its defaults the look as it is
      uBright: { value: 1 }, // exposure after everything
      uSat: { value: 1 }, // saturation
      uGreen: { value: 0.45 }, // greens pulled to olive and calmed
      uWarm: { value: 0.35 }, // grey midtones leaning amber
      uSplit: { value: 1 }, // split toning: teal shadows, cream highlights
      uContrast: { value: 0.55 }, // the soft S
      uLift: { value: 1 }, // lifted blacks
      uVignette: { value: 0.45 }, // how dark the corners
    },
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; // rgb: the scene in its haze, a: view depth
      uniform vec2 uRes;
      uniform float uFocus, uAperture, uMaxBlur;
      uniform float uBright, uSat, uGreen, uWarm, uSplit, uContrast, uLift, uVignette;
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
        // how far out a tap can still count: this pixel's own blur, or a blurry thing nearer than it bleeding over
        // it (a probe of six round it says how blurry the near things about are). Past that every tap weighs 0, so
        // stop there: in focus that is a few taps, not forty (all forty everywhere were a fifth of the frame)
        float reach = cc;
        for (int k = 0; k < 6; k++) {
          float a = float(k) * 1.0472 + 0.5;
          vec4 s = texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * uMaxBlur * 0.6 / uRes);
          if (s.a < zc) reach = max(reach, coc(s.a));
        }
        reach = min(reach + 1.5, uMaxBlur);
        for (int i = 1; i < N; i++) {
          float fi = float(i);
          float r = sqrt(fi / float(N)) * uMaxBlur;
          if (r > reach) break;
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
        col *= uBright;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        // greens pulled towards olive and calmed: the moss was a loud lime next to the golden ferns
        float green = max(col.g - max(col.r, col.b), 0.0);
        col.r += green * uGreen;
        col = mix(vec3(l), col, 1.0 - uGreen * smoothstep(0.0, 0.12, green));
        // the grey haze warmed: unsaturated midtones lean amber instead of sitting a flat green-grey
        float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
        col = mix(col, l * vec3(1.1, 1.0, 0.8), (1.0 - smoothstep(0.03, 0.16, sat)) * smoothstep(0.04, 0.3, l) * uWarm);
        // split toning: shadows a deep blue-teal, highlights a cream gold
        col = mix(col, mix(col * vec3(0.86, 0.95, 1.06), col * vec3(1.08, 0.99, 0.86), smoothstep(0.03, 0.45, l)), uSplit);
        // a soft S: deeper shadows, a rounded shoulder so the sunlit fronds do not burn out to white
        l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float lc = l < 0.5 ? 2.0 * l * l * (1.5 - l) + l * 0.25 : l;
        lc = mix(lc, 0.82 + 0.18 * (1.0 - exp(-(l - 0.72) * 4.0)), step(0.72, l));
        col *= mix(1.0, lc / max(l, 1e-4), uContrast);
        col += vec3(0.005, 0.007, 0.009) * uLift; // lifted blacks, like a lens in haze
        vec2 v = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        col *= mix(1.0, 1.0 - uVignette, smoothstep(0.35, 1.05, length(v)));
        gl_FragColor = vec4(col, 1.0);
        // the last pass: out to sRGB on screen itself (an OutputPass after it was a whole screen more, only for this)
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}
