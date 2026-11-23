import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Vintage 1970s/80s Scandinavian orange telescoping desk lamp modeled in Blender
 * (`22/model/lamp.py` -> `22/public/lamp.glb`). Clicking anywhere on the lamp
 * toggles the warm tungsten desk lighting on/off.
 */
export class OrangeDeskLamp {
  readonly root = new THREE.Group();
  readonly interactiveMeshes: THREE.Object3D[] = [];

  readonly spotLight: THREE.SpotLight;
  readonly wallGlow: THREE.PointLight;

  private bulbMat: THREE.MeshStandardMaterial | null = null;
  private innerShadeMat: THREE.MeshStandardMaterial | null = null;
  private switchRocker: THREE.Object3D | null = null;

  lit = true;
  private lightAnim = 1.0;

  constructor(onReady?: () => void) {
    // Live warm tungsten SpotLight (re-parented onto Blender's `light_origin` / `light_target` once loaded)
    this.spotLight = new THREE.SpotLight(0xffdfb0, 28, 19, Math.PI * 0.46, 0.62, 1.4);
    this.spotLight.position.set(1.75, 3.25, 0.25);
    this.spotLight.castShadow = true;
    this.spotLight.shadow.mapSize.set(1024, 1024);
    this.spotLight.shadow.bias = -0.0004;
    this.spotLight.shadow.normalBias = 0.02;
    this.root.add(this.spotLight);

    const fallbackTarget = new THREE.Object3D();
    fallbackTarget.position.set(3.2, 0.2, 1.0);
    this.root.add(fallbackTarget);
    this.spotLight.target = fallbackTarget;

    // Warm wall bounce glow near the shade
    this.wallGlow = new THREE.PointLight(0xffcb88, 4.4, 12.5, 1.55);
    this.wallGlow.position.set(0.55, 3.65, -0.55);
    this.root.add(this.wallGlow);

    // Clamped off-screen to the left desk border so the full-size shade hangs big in the mid-left open space
    // cleanly below the title text and clear of both the 1702 monitor and cheat sheet
    this.root.position.set(-7.18, -1.78, 0.35);
    this.root.rotation.set(0, -0.06, -0.32);
    this.root.scale.setScalar(1.22);

    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}lamp.glb`;
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      this.root.add(model);

      let lightOrigin: THREE.Object3D | null = null;
      let lightTarget: THREE.Object3D | null = null;
      let shadeOuter: THREE.Object3D | null = null;

      model.traverse((obj) => {
        if (obj.name === 'light_origin') lightOrigin = obj;
        if (obj.name === 'light_target') lightTarget = obj;
        if (obj.name === 'switch_rocker') this.switchRocker = obj;
        if (obj.name === 'shade_outer') shadeOuter = obj;

        if (obj instanceof THREE.Mesh) {
          const skipShadow = obj.name === 'bulb' || obj.name === 'shade_inner' || obj.name.startsWith('cord_');
          obj.castShadow = !skipShadow;
          obj.receiveShadow = true;
          obj.userData.hit = { kind: 'lamp' };
          this.interactiveMeshes.push(obj);

          if (obj.name === 'bulb' && obj.material instanceof THREE.MeshStandardMaterial) {
            this.bulbMat = obj.material;
          }
          if (obj.name === 'shade_inner' && obj.material instanceof THREE.MeshStandardMaterial) {
            this.innerShadeMat = obj.material;
          }
        }
      });

      // Slap a slightly crooked, heat-curled 1980s Garbage Pail Kids sticker onto the flared orange shade!
      if (shadeOuter) {
        const sticker = buildLampShadeSticker();
        (shadeOuter as THREE.Object3D).add(sticker);
        this.interactiveMeshes.push(sticker);
      }

      // Attach live SpotLight precisely to the Blender shade's bulb origin & aim axis
      if (lightOrigin && lightTarget) {
        const originObj = lightOrigin as THREE.Object3D;
        const targetObj = lightTarget as THREE.Object3D;
        originObj.add(this.spotLight);
        this.spotLight.position.set(0, 0, 0);
        this.spotLight.target = targetObj;
      }

      onReady?.();
    }, undefined, (err) => {
      console.warn('Failed to load desk lamp model:', err);
    });
  }

  toggle(): boolean {
    this.lit = !this.lit;
    return this.lit;
  }

  update(dt: number) {
    const target = this.lit ? 1 : 0;
    this.lightAnim += (target - this.lightAnim) * Math.min(1, dt * 16);

    this.spotLight.intensity = this.lightAnim * 28;
    this.wallGlow.intensity = this.lightAnim * 4.4;
    if (this.bulbMat) {
      this.bulbMat.emissiveIntensity = this.lightAnim * 3.6;
    }
    if (this.innerShadeMat) {
      this.innerShadeMat.emissiveIntensity = this.lightAnim * 0.78;
    }
    if (this.switchRocker) {
      this.switchRocker.rotation.x = this.lit ? -0.28 : 0.28;
    }
  }
}

/**
 * Builds a curved conical vinyl sticker mesh wrapped tightly onto `shade_outer`'s flared cone,
 * slightly crooked with a subtle heat-curled top-right corner.
 */
function buildLampShadeSticker(): THREE.Mesh {
  const segU = 16;
  const segV = 16;
  const geo = new THREE.PlaneGeometry(1, 1, segU, segV);
  const pos = geo.attributes.position;

  // Exact conical flare coordinates of `shade_outer` (Y-up in glTF space)
  const yTop = -0.545;
  const rTop = 0.355;
  const yBot = -0.940;
  const rBot = 0.610;
  const flareLen = Math.hypot(rBot - rTop, yTop - yBot); // 0.470

  // Classic 250x350 (5:7) Garbage Pail Kids sticker card proportions
  const stickerH = 0.42;
  const stickerW = stickerH * (250 / 350);
  const sCenter = flareLen * 0.56;
  const thetaCenter = 0.34; // faces cleanly toward the camera on the burnt-orange shade
  const tilt = -0.14;       // playful hand-stuck 8-year-old crookedness!
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // -0.5..+0.5
    const v = pos.getY(i); // -0.5..+0.5 (+0.5 = top of sticker)

    const dx = u * stickerW * cosT - v * stickerH * sinT;
    const ds = u * stickerW * sinT + v * stickerH * cosT;

    const s = sCenter - ds;
    const t = s / flareLen;
    const r = rTop + (rBot - rTop) * t;
    const y = yTop + (yBot - yTop) * t;
    const theta = thetaCenter + dx / Math.max(0.15, r);

    // Subtle heat-peeled top-right corner lift from the warm tungsten bulb inside
    const peelU = Math.max(0, u - 0.16);
    const peelV = Math.max(0, v - 0.16);
    const peelLift = peelU * peelV * 0.14;

    const rOff = r + 0.005 + peelLift;
    pos.setXYZ(i, Math.sin(theta) * rOff, y, Math.cos(theta) * rOff);
  }
  geo.computeVertexNormals();

  const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}gpk-sticker.jpg`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: 0.30,
    metalness: 0.02,
    clearcoat: 0.45,
    clearcoatRoughness: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.hit = { kind: 'lamp' };
  return mesh;
}
