// A tiny post stack: the scene renders into a target with a depth texture, then one fullscreen pass
// adds depth-only ambient occlusion and a gentle colour grade. Depth-only on purpose: three's SAO/GTAO
// re-render the scene with an override material, which ignores the shell discard and the frond bending.
import * as THREE from 'three';

export interface Post {
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  setSize(w: number, h: number, dpr: number): void;
  material: THREE.ShaderMaterial;
}

export function createPost(renderer: THREE.WebGLRenderer): Post {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    // 8-bit sRGB is plenty for a grade and half the bandwidth of half-float; MSAA here was most of the cost
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    samples: 2, // the thin grass straws need some; 4 cost another 10 fps here
    depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uProjInv: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0.12 }, // world units
      uStrength: { value: 1.1 },
      uAO: { value: 1 },
      uGrade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform mat4 uProjInv;
      uniform mat4 uProj;
      uniform vec2 uResolution;
      uniform float uRadius;
      uniform float uStrength;
      uniform float uAO;
      uniform float uGrade;
      varying vec2 vUv;

      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        vec3 col = texture2D(tColor, vUv).rgb;
        float depth = texture2D(tDepth, vUv).r;
        float ao = 1.0;
        if (uAO > 0.5 && depth < 1.0) {
          vec3 P = viewPos(vUv);
          vec3 N = normalize(cross(dFdx(P), dFdy(P)));
          // radius in pixels at this depth
          float px = uRadius * uProj[1][1] / -P.z * 0.5 * uResolution.y;
          float occ = 0.0;
          float rot = hash(gl_FragCoord.xy) * 6.2831853;
          const int TAPS = 12;
          for (int i = 0; i < TAPS; i++) {
            float fi = (float(i) + 0.5) / float(TAPS);
            float a = rot + fi * 6.2831853 * 2.618; // golden-angle spiral
            vec2 off = vec2(cos(a), sin(a)) * sqrt(fi) * px / uResolution;
            vec3 S = viewPos(vUv + off);
            vec3 v = S - P;
            float dist = length(v);
            float falloff = 1.0 - smoothstep(uRadius * 0.6, uRadius * 1.4, dist);
            occ += max(dot(N, v / max(dist, 1e-4)) - 0.08, 0.0) * falloff;
          }
          ao = clamp(1.0 - uStrength * occ / float(TAPS), 0.0, 1.0);
        }
        col *= ao;

        // grade: a touch of contrast and saturation, slightly warm highlights, a soft vignette
        if (uGrade > 0.5) {
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, 1.08);
        col = (col - 0.18) * 1.06 + 0.18;
        col *= mix(vec3(1.0), vec3(1.02, 1.0, 0.97), smoothstep(0.3, 0.9, l));
        vec2 q = vUv - 0.5;
        col *= 1.0 - 0.22 * smoothstep(0.35, 0.85, length(q * vec2(uResolution.x / uResolution.y, 1.0)));
        }
        gl_FragColor = vec4(max(col, 0.0), 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    material,
    setSize(w, h, dpr) {
      target.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
      material.uniforms.uResolution.value.set(Math.floor(w * dpr), Math.floor(h * dpr));
    },
    render(scene, camera) {
      material.uniforms.uProj.value.copy(camera.projectionMatrix);
      material.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
    },
  };
}
