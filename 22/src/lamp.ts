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
    this.spotLight.shadow.mapSize.set(2048, 2048);
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

    // Positioned further left so the base sits slightly outside the default screen edge (heat safe from CRT!)
    this.root.position.set(-5.95, 0, 0.45);
    this.root.rotation.y = -0.14;

    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}lamp.glb`;
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      this.root.add(model);

      let lightOrigin: THREE.Object3D | null = null;
      let lightTarget: THREE.Object3D | null = null;

      model.traverse((obj) => {
        if (obj.name === 'light_origin') lightOrigin = obj;
        if (obj.name === 'light_target') lightTarget = obj;
        if (obj.name === 'switch_rocker') this.switchRocker = obj;

        if (obj instanceof THREE.Mesh) {
          obj.castShadow = obj.name !== 'bulb' && obj.name !== 'shade_inner';
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

      // Attach live SpotLight precisely to the Blender shade's bulb origin & aim axis
      if (lightOrigin && lightTarget) {
        const originObj = lightOrigin as THREE.Object3D;
        const targetObj = lightTarget as THREE.Object3D;
        originObj.add(this.spotLight);
        this.spotLight.position.set(0, 0, 0);
        this.spotLight.target = targetObj;
      }

      onReady?.();
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
