// Renders a tiny real sample of each brush with the actual moss shaders, once at startup,
// and puts the image on the swatch button. No fake gradients.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildFronds } from './fronds';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { domeAt, pillowAt } from './rock';
import { fbm3 } from './noise';
import { shellVertex, shellFragment } from './shaders';
import { renderToDataURL } from './render';

export function renderSwatches(renderer: THREE.WebGLRenderer, shells: number, lightDir: THREE.Vector3) {
  const size = 128;
  const SPECIES = 5;

  // a small sphere stands in for the rock; we look at a patch of its top
  // small core, big moss: the ball is mostly fuzz and fronds
  const geo = mergeVertices(new THREE.IcosahedronGeometry(0.6, 5));
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // a pea: the whole sphere is moss. Fronds and fuzz are scaled up ~25x so they read
  // in proportion to a pea-sized stone, the noise fields stay in unit-sphere space.
  const moss = new Float32Array(n).fill(1);
  const weights = new Float32Array(n * SPECIES);
  const dead = new Float32Array(n);
  const pillow = new Float32Array(n);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    pillow[i] = pillowAt(p.x / 0.6, p.y / 0.6, p.z / 0.6);
  }
  geo.setAttribute('moss', new THREE.BufferAttribute(moss, 1));
  const weightsAttr = new THREE.InterleavedBuffer(weights, SPECIES);
  geo.setAttribute('speciesW', new THREE.InterleavedBufferAttribute(weightsAttr, 4, 0));
  geo.setAttribute('speciesW2', new THREE.InterleavedBufferAttribute(weightsAttr, 1, 4));
  geo.setAttribute('dead', new THREE.BufferAttribute(dead, 1));
  geo.setAttribute('pillow', new THREE.BufferAttribute(pillow, 1));
  geo.setAttribute('mossNormal', geo.attributes.normal.clone());
  geo.setAttribute('cavity', new THREE.BufferAttribute(new Float32Array(n), 1)); // a ball has no hollows
  {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) { p.fromBufferAttribute(pos, i); d[i] = domeAt(p.x * 0.5, p.y * 0.5, p.z * 0.5); }
    geo.setAttribute('dome', new THREE.BufferAttribute(d, 1));
  }

  const mat = new THREE.ShaderMaterial({
    vertexShader: shellVertex,
    fragmentShader: shellFragment,
    defines: { SHELLS: shells },
    uniforms: {
      uHeight: { value: 0.3 },
      uBulge: { value: 0.1 },
      uLightDir: { value: lightDir },
      uHideRock: { value: 0 },
      uScale: { value: 3 }, // the ball's moss is scaled up a lot, so are its fuzz features
    },
  });
  const shellMesh = new THREE.InstancedMesh(geo, mat, shells);
  shellMesh.frustumCulled = false;
  const fronds = buildFronds(geo, new Float32Array(n).fill(1), 700, 11);
  const fu = (fronds.mesh.material as THREE.ShaderMaterial).uniforms;
  fu.uLen.value = 0.8;
  fu.uStarLen.value = 0.8;
  fu.uLichenLen.value = 0.85;
  fu.uWidth.value = 0.104;
  fu.uBulge.value = 0.1;

  const scene = new THREE.Scene();
  scene.add(shellMesh, fronds.mesh);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(2.9, 2.6, 5.8);
  camera.lookAt(0, 0, 0);

  const rt = new THREE.WebGLRenderTarget(size * 2, size * 2, { colorSpace: THREE.SRGBColorSpace, samples: 4 });

  // the frond shader reads its pillow field from the puff texture's G channel
  {
    const pt = fronds.puffTexture.image.data as Float32Array;
    for (let i = 0; i < n; i++) pt[i * 4 + 1] = pillow[i];
    fronds.puffTexture.needsUpdate = true;
  }
  const setWeights = (pick: (i: number) => number) => {
    for (let i = 0; i < n; i++) {
      const k = pick(i);
      for (let c = 0; c < SPECIES; c++) weights[i * SPECIES + c] = c === k ? 1 : 0;
    }
    weightsAttr.needsUpdate = true;
    const tex = fronds.ageTexture.image.data as Float32Array;
    for (let i = 0; i < n; i++) {
      tex[i * 4] = moss[i];
      tex[i * 4 + 1] = weights[i * SPECIES];
      tex[i * 4 + 2] = weights[i * SPECIES + 1];
      tex[i * 4 + 3] = weights[i * SPECIES + 2];
    }
    fronds.ageTexture.needsUpdate = true;
    const pt = fronds.puffTexture.image.data as Float32Array;
    for (let i = 0; i < n; i++) pt[i * 4 + 2] = weights[i * SPECIES + 3];
    fronds.puffTexture.needsUpdate = true;
  };

  // cushion has no fronds, so its ball is only the core plus a short fuzz: get closer so it reads as big as the rest
  const eye = camera.position.clone();
  const shoot = (zoom = 1): string => {
    camera.position.copy(eye).multiplyScalar(1 / zoom);
    return renderToDataURL(renderer, scene, camera, rt);
  };

  const apply = (selector: string, url: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = 'contain';
    }
  };

  const names = ['feather', 'star', 'lichen', 'cushion', 'coral'];
  for (let k = 0; k < SPECIES; k++) {
    setWeights(() => k);
    apply(`.sw i.${names[k]}`, shoot(k === 3 ? 1.7 : 1));
  }
  // mix: patches of each species from a noise field
  setWeights((i) => {
    p.fromBufferAttribute(pos, i);
    const v = fbm3(p.x * 2.5, p.y * 2.5, p.z * 2.5, 2, 3);
    return v < -0.2 ? 1 : v < -0.02 ? 0 : v < 0.12 ? 4 : v < 0.25 ? 3 : 2;
  });
  apply('.sw i.auto', shoot());

  rt.dispose();
  geo.dispose();
  mat.dispose();
  fronds.mesh.geometry.dispose();
  (fronds.mesh.material as THREE.Material).dispose();
  fronds.ageTexture.dispose();
}

/** A little two-tone rubber eraser, rendered once and put on the scrape button. */
export function renderEraser(renderer: THREE.WebGLRenderer) {
  const size = 128;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777770, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const red = new THREE.MeshStandardMaterial({ color: 0x9a4a35, roughness: 0.75 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x4f6fae, roughness: 0.75 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
  const L = 2.3, H = 0.55, D = 0.85, r = 0.1;
  const g = new THREE.Group();
  const redPart = new THREE.Mesh(new RoundedBoxGeometry(L * 0.62, H, D, 4, r), red);
  redPart.position.x = -L * 0.19;
  const bluePart = new THREE.Mesh(new RoundedBoxGeometry(L * 0.36, H, D, 4, r), blue);
  bluePart.position.x = L * 0.32;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, H * 0.96, D * 0.96), white);
  band.position.x = L * 0.14 - 0.01;
  g.add(redPart, bluePart, band);
  g.rotation.set(0.35, -0.55, -0.15);
  scene.add(g);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0.6, 2.4, 4.6);
  camera.lookAt(0, 0, 0);

  const rt = new THREE.WebGLRenderTarget(size * 2, size * 2, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  const url = renderToDataURL(renderer, scene, camera, rt);
  const el = document.querySelector<HTMLElement>('.scrape-btn i');
  if (el) el.style.backgroundImage = `url(${url})`;

  rt.dispose();
  [redPart, bluePart, band].forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
}
