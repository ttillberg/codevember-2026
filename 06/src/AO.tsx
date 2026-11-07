import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { focus } from './CameraRig';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BrightnessContrastShader } from 'three/examples/jsm/shaders/BrightnessContrastShader.js';
import { ColorCorrectionShader } from 'three/examples/jsm/shaders/ColorCorrectionShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';

// Colour grade, applied last, on the tone mapped image: a little more contrast and saturation, a faint warm cast.
const GRADE = {
  brightness: 0.0,
  contrast: 0.08, // -1 to 1
  saturation: 0.12, // -1 to 1
  hue: 0.0, // -1 to 1
  mul: [1.03, 1.0, 0.96], // per channel gain: warmer
  pow: [1.0, 1.0, 1.0], // per channel gamma
};

// Post processing with three's own passes: SSAO, so the sweets darken where they touch and in the hollows between
// them; OutputPass for the renderer's tone mapping and colour space; then a colour grade. Takes over rendering from
// R3F (priority 1).
export function AO() {
  const { gl, scene, camera, size } = useThree();
  const { composer, bokeh } = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const ao = new SSAOPass(scene, camera, size.width, size.height);
    // Radius in scene units; min and max are in depth normalised over the camera's near to far (1 to 250), so
    // 0.01 is about 2.5 units: occluders closer than a bean or two count, the sun far below does not.
    ao.kernelRadius = 1.6;
    ao.minDistance = 0.0002;
    ao.maxDistance = 0.01;
    c.addPass(ao);
    // Depth of field round a picked planet: sharp at its distance, the rest of the system soft. Off when nothing's
    // picked, as it costs a depth render of its own.
    const bokeh = new BokehPass(scene, camera, { focus: 30, aperture: 0, maxblur: 0.012 });
    bokeh.enabled = false;
    c.addPass(bokeh);
    c.addPass(new OutputPass());
    const bc = new ShaderPass(BrightnessContrastShader);
    bc.uniforms.brightness.value = GRADE.brightness;
    bc.uniforms.contrast.value = GRADE.contrast;
    c.addPass(bc);
    const hs = new ShaderPass(HueSaturationShader);
    hs.uniforms.hue.value = GRADE.hue;
    hs.uniforms.saturation.value = GRADE.saturation;
    c.addPass(hs);
    const cc = new ShaderPass(ColorCorrectionShader);
    cc.uniforms.mulRGB.value.set(...GRADE.mul);
    cc.uniforms.powRGB.value.set(...GRADE.pow);
    c.addPass(cc);
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
    u.aperture.value = 0.0016 * focus.amount;
    composer.render();
  }, 1);
  return null;
}
