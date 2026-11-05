// Miniatures of every glyph, each a low-detail bare rounded letter in the rock's white material,
// rendered one per frame in the background so the picker fills in without a hitch.
import * as THREE from 'three';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { buildWord } from './objects';
import { shellVertex, shellFragment } from './shaders';
import { renderToDataURL } from './render';

const SIZE = 96;
const SHELLS = 10;

export function renderGlyphThumbs(
  renderer: THREE.WebGLRenderer,
  font: Font,
  chars: string[],
  lightDir: THREE.Vector3,
  onThumb: (char: string, url: string) => void,
) {
  const material = new THREE.ShaderMaterial({
    vertexShader: shellVertex,
    fragmentShader: shellFragment,
    defines: { SHELLS },
    uniforms: {
      uHeight: { value: 0.05 },
      uBulge: { value: 0.09 },
      uLightDir: { value: lightDir },
      uHideRock: { value: 0 },
      uScale: { value: 2.2 },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
    },
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  const rt = new THREE.WebGLRenderTarget(SIZE * 2, SIZE * 2, { colorSpace: THREE.SRGBColorSpace, samples: 4 });

  let k = 0;
  const step = () => {
    if (k >= chars.length) {
      rt.dispose();
      material.dispose();
      return;
    }
    const c = chars[k++];
    const surface = buildWord(c, font, 1, 1);
    const geo = surface.geometry;
    const n = geo.attributes.position.count;
    geo.setAttribute('moss', new THREE.BufferAttribute(new Float32Array(n), 1)); // bare: the letter itself, no moss
    // the shell shader still wants species weights, any will do with no moss: one-hot cushion
    const w = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) w[i * 5 + 3] = 1;
    const wb = new THREE.InterleavedBuffer(w, 5);
    geo.setAttribute('speciesW', new THREE.InterleavedBufferAttribute(wb, 4, 0));
    geo.setAttribute('speciesW2', new THREE.InterleavedBufferAttribute(wb, 1, 4));
    geo.setAttribute('dead', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('pillow', new THREE.BufferAttribute(surface.pillow, 1));
    geo.setAttribute('puff', new THREE.BufferAttribute(new Float32Array(n), 1));
    // bare letters only need the base pass: one instance, the fuzz shells above it would all discard
    const mesh = new THREE.InstancedMesh(geo, material, 1);
    mesh.frustumCulled = false;
    scene.add(mesh);

    // front and a little above, framing the glyph's bounding box
    const bb = geo.boundingBox!;
    const center = bb.getCenter(new THREE.Vector3());
    const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) * 1.25;
    const dist = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(center.x + dist * 0.18, center.y + dist * 0.22, center.z + dist);
    camera.lookAt(center);

    onThumb(c, renderToDataURL(renderer, scene, camera, rt));

    scene.remove(mesh);
    geo.dispose();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
