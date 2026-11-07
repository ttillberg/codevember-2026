import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { focus } from './CameraRig';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Vector3 } from 'three';

// Colour grade, applied last, on the tone mapped image: a little more contrast and saturation, a faint warm cast.
const GRADE = {
  brightness: 0.0,
  contrast: 0.08, // -1 to 1
  saturation: 0.12, // -1 to 1
  mul: [1.03, 1.0, 0.96], // per channel gain: warmer
  pow: [1.0, 1.0, 1.0], // per channel gamma
};

// The grade in one full screen pass (what three's brightness/contrast, hue/saturation and colour correction
// passes do, one after another, without three trips over the screen).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    brightness: { value: GRADE.brightness },
    contrast: { value: GRADE.contrast },
    saturation: { value: GRADE.saturation },
    mulRGB: { value: new Vector3(...GRADE.mul) },
    powRGB: { value: new Vector3(...GRADE.pow) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float brightness, contrast, saturation;
    uniform vec3 mulRGB, powRGB;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += brightness;
      c.rgb = contrast > 0.0 ? (c.rgb - 0.5) / (1.0 - contrast) + 0.5 : (c.rgb - 0.5) * (1.0 + contrast) + 0.5;
      float average = (c.r + c.g + c.b) / 3.0;
      c.rgb += saturation > 0.0 ? (average - c.rgb) * (1.0 - 1.0 / (1.001 - saturation)) : (average - c.rgb) * (-saturation);
      gl_FragColor = vec4(mulRGB * pow(max(c.rgb, 0.0), powRGB), c.a);
    }`,
};

// Post processing with three's own passes: SSAO, so the sweets darken where they touch and in the hollows between
// them; OutputPass for the renderer's tone mapping and colour space; then a colour grade. Takes over rendering from
// R3F (priority 1).
export function AO() {
  const { gl, scene, camera, size } = useThree();
  const { composer, bokeh } = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    // Half resolution and a smaller kernel: soft contact shadows don't need more, and it's the costliest pass.
    const ao = new SSAOPass(scene, camera, size.width, size.height, 16);
    const fullSize = ao.setSize.bind(ao);
    ao.setSize = (w: number, h: number) => fullSize(Math.ceil(w / 2), Math.ceil(h / 2));
    // Radius in scene units; min and max are in depth normalised over the camera's near to far (1 to 250), so
    // 0.01 is about 2.5 units: occluders closer than a bean or two count, the sun far below does not.
    ao.kernelRadius = 1.6;
    ao.minDistance = 0.0002;
    ao.maxDistance = 0.01;
    c.addPass(ao);
    // Depth of field round a picked planet: sharp at its distance, the rest of the system soft. Off when nothing's
    // picked, as it costs a depth render of its own.
    const bokeh = new BokehPass(scene, camera, { focus: 30, aperture: 0, maxblur: 0.009 });
    bokeh.enabled = false;
    c.addPass(bokeh);
    c.addPass(new OutputPass());
    c.addPass(new ShaderPass(GradeShader));
    if (import.meta.env.DEV) (window as any).__passes = { ao, bokeh, composer: c }; // dev: switch passes off to measure
    return { composer: c, bokeh };
  }, [gl, scene, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);
  useEffect(() => () => composer.dispose(), [composer]);

  useFrame(() => {
    bokeh.enabled = focus.amount > 0.02;
    const u = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    u.focus.value = focus.distance;
    // Opened up for the big ones, so a whole ringed planet stays sharp while the rest of the system goes soft.
    u.aperture.value = 0.0016 * focus.amount * Math.min(1, 1.5 / focus.depth) ** 1.6;
    composer.render();
  }, 1);
  return null;
}
