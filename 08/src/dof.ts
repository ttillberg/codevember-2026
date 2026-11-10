import * as THREE from 'three';

// Depth of field, by hand: the eye's lens is drawn first and the machine over it with the page showing through, so a
// ready-made post-processing pass, which draws the whole frame opaque, would cover both. Instead the machine alone
// goes into a buffer with its depth, then onto the page through a blur as wide as each point is out of focus. The
// buffer keeps its alpha, premultiplied, so the blur feathers the machine's edges into whatever is behind it.
// The focus is a point in the world (the beetle when following, the look's point otherwise), its distance along the
// camera's view; the blur grows as 1 - focus / depth, the thin lens's, to MAX_R pixels at most.

export const dof = {
  on: true,
  focus: new THREE.Vector3(),
  /** the blur at twice the focus distance, against the page's height */
  aperture: 0.006,
};
const MAX_R = 10; // CSS pixels, the widest blur
const TAPS = 48;

const MAT = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tDepth: { value: null },
    near: { value: 0.1 }, far: { value: 1000 }, focus: { value: 10 },
    coc: { value: 10 }, maxR: { value: MAX_R }, texel: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor, tDepth;
    uniform float near, far, focus, coc, maxR;
    uniform vec2 texel;
    varying vec2 vUv;
    // the blur's radius in pixels at a point, and its depth
    float radiusAt(vec2 uv, out float z) {
      z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far);
      return min(maxR, coc * abs(1.0 - focus / z));
    }
    void main() {
      float zc;
      float rc = radiusAt(vUv, zc);
      vec4 sum = texture2D(tColor, vUv);
      float wsum = 1.0;
      // a golden-angle spiral over the widest blur; each tap counts as far as its own blur reaches back to here, so
      // a sharp point is not smeared out and a blurred one is; behind a sharper point a tap's blur is held to that
      // point's, so the background does not bleed over what is in focus
      for (int i = 1; i < ${TAPS}; i++) {
        float f = float(i) / float(${TAPS});
        float r = sqrt(f) * maxR, a = float(i) * 2.39996;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * texel;
        float z;
        float rs = radiusAt(uv, z);
        if (z > zc) rs = min(rs, rc);
        float w = clamp(rs - r + 1.0, 0.0, 1.0);
        sum += texture2D(tColor, uv) * w;
        wsum += w;
      }
      gl_FragColor = sum / wsum;
      // the buffer is linear and premultiplied: straightened, tone-mapped and into the page's colours, then
      // premultiplied back
      gl_FragColor.rgb /= max(gl_FragColor.a, 1e-4);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;
    }`,
  premultipliedAlpha: true,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const QUAD = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), MAT);
QUAD.frustumCulled = false;
const FLAT = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const SCENE = new THREE.Scene().add(QUAD);
let rt: THREE.WebGLRenderTarget | null = null;
const size = new THREE.Vector2(), dir = new THREE.Vector3(), to = new THREE.Vector3(), clear = new THREE.Color();

/** The scene through the depth of field onto the screen, over what is there already. */
export function renderDof(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const cam = camera as THREE.PerspectiveCamera;
  if (!dof.on || !cam.isPerspectiveCamera) { gl.render(scene, camera); return; }
  gl.getDrawingBufferSize(size);
  if (!rt || rt.width !== size.x || rt.height !== size.y) {
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  }
  const u = MAT.uniforms;
  cam.getWorldDirection(dir);
  u.focus.value = Math.max(cam.near * 2, dir.dot(to.subVectors(dof.focus, cam.position)));
  u.near.value = cam.near; u.far.value = cam.far;
  u.coc.value = dof.aperture * size.y * 2; // 1 - focus / depth is a half at twice the focus
  u.maxR.value = MAX_R * gl.getPixelRatio();
  u.texel.value.set(1 / size.x, 1 / size.y);
  u.tColor.value = rt.texture; u.tDepth.value = rt.depthTexture;
  // the machine into the buffer, on nothing, then through the blur onto the page
  const wasA = gl.getClearAlpha();
  gl.getClearColor(clear);
  gl.setRenderTarget(rt);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, camera);
  gl.setRenderTarget(null);
  gl.setClearColor(clear, wasA);
  gl.render(SCENE, FLAT);
}
