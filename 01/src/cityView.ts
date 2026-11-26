import * as THREE from 'three';
import {
  ARCHITECTURAL_PAPER_PALETTE,
  buildHouseNet,
  type WindowOpenMode,
} from './origamiHouseNet';
import {
  buildOrigamiHouseRig,
  createOrigamiMaterials,
  type OrigamiHouseRig,
  type OrigamiMaterials,
} from './origamiPaperMesh';
import {
  generateCityLayout,
  type CityBuildOptions,
  type CityBuildingPlot,
  type CityLayout,
  type CityStreetStyle,
} from './cityGenerator';

const BACKDROP = '#f5f4f0';
const SUN_DIR_WHITE = new THREE.Vector3(24, 42, 19).normalize();
const SUN_DIR_COLOR = new THREE.Vector3(16, 46, 14).normalize();

function easePaperFold(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) * 0.5;
}

interface MountedCityBuilding {
  plot: CityBuildingPlot;
  rig: OrigamiHouseRig;
  wrapper: THREE.Group;
  plinth: THREE.Mesh;
  curFold: number;
  startFold: number;
  targetFold: number;
  delay: number;
  elapsed: number;
  duration: number;
  animating: boolean;
}

export interface CityViewCallbacks {
  onLayoutBuilt?: (layout: CityLayout) => void;
  onHoverPlot?: (plot: CityBuildingPlot | null) => void;
  onSelectPlot?: (plot: CityBuildingPlot) => void;
}

/**
 * Interactive 3D Architectural Paper City View sharing the main WebGLRenderer.
 * Renders sculpted cotton-rag paper topography, Marching Squares contour lines, terrain-hugging
 * randomized streets & plazas, fitted retaining plinths, origami trees, and real foldable paper houses!
 */
export class CityView {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public layout: CityLayout | null = null;

  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly cityRoot = new THREE.Group();
  private readonly hoverOutline: THREE.LineLoop;

  // Shared material palette pool (1 white-on-white + 6 pastel slots, zero redundant canvas textures!)
  private readonly matPool: OrigamiMaterials[] = [];
  private readonly terrainMat: THREE.MeshStandardMaterial;
  private readonly streetMat: THREE.MeshStandardMaterial;
  private readonly plazaMat: THREE.MeshStandardMaterial;
  private readonly plinthMat: THREE.MeshStandardMaterial;
  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly contourMinorMat: THREE.LineBasicMaterial;
  private readonly contourMajorMat: THREE.LineBasicMaterial;
  private readonly curbMat: THREE.LineBasicMaterial;

  private buildings: MountedCityBuilding[] = [];
  private pickableMeshes: THREE.Object3D[] = [];
  private disposedGeos: THREE.BufferGeometry[] = [];

  private colorEnabled = false;
  private spinEnabled = true;
  private winOpenMode: WindowOpenMode = 'random';
  private winOpenRatio = 0.35;
  private cityFoldTarget: 0 | 1 = 1;

  // Smooth orbital + pan + zoom camera state
  private curYaw = 0.62;
  private targetYaw = 0.62;
  private curPitch = 0.56;
  private targetPitch = 0.56;
  private curDist = 72;
  private targetDist = 72;
  private curTarget = new THREE.Vector3(0, 2.2, 0);
  private targetPos = new THREE.Vector3(0, 2.2, 0);

  private hoveredPlotIdx: number | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly callbacks: CityViewCallbacks;

  // Pointer interaction state
  private dragMode: 'none' | 'orbit' | 'pan' = 'none';
  private pointerId: number | null = null;
  private lastPx = 0;
  private lastPy = 0;
  private downPx = 0;
  private downPy = 0;
  private movedDist = 0;

  constructor(maxAnisotropy: number, envTexture: THREE.Texture | null, callbacks: CityViewCallbacks = {}) {
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.Fog(BACKDROP, 108, 235);
    if (envTexture) {
      this.scene.environment = envTexture;
      this.scene.environmentIntensity = 0.08;
    }

    this.camera = new THREE.PerspectiveCamera(28, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 420);

    this.hemi = new THREE.HemisphereLight('#fffef9', '#dfd9ce', 1.76);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fffdf6', 2.02);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00028;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.6;
    const ext = 50;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.near = 12;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);

    this.fill = new THREE.DirectionalLight('#f5f4f0', 0.28);
    this.fill.position.set(-34, 24, -26);
    this.scene.add(this.fill);

    // Infinite seamless white cotton studio ground outside the sculpted hillside skirt
    const outerGeo = new THREE.PlaneGeometry(520, 520);
    outerGeo.rotateX(-Math.PI * 0.5);
    const outerMat = new THREE.MeshStandardMaterial({
      color: '#f5f4f0',
      roughness: 0.97,
      metalness: 0.0,
    });
    const outerFloor = new THREE.Mesh(outerGeo, outerMat);
    outerFloor.position.y = -0.02;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    this.scene.add(this.cityRoot);

    // Build shared OrigamiMaterials pool across ALL 8 architectural paper tones (zero redundant texture churn!)
    const poolSize = ARCHITECTURAL_PAPER_PALETTE.length;
    for (let i = 0; i < poolSize; i++) {
      this.matPool.push(createOrigamiMaterials(maxAnisotropy));
    }

    this.terrainMat = new THREE.MeshStandardMaterial({
      color: '#f5f4f0',
      roughness: 0.95,
      metalness: 0.0,
    });
    this.streetMat = new THREE.MeshStandardMaterial({
      color: '#e7e4dc',
      roughness: 0.96,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.plazaMat = new THREE.MeshStandardMaterial({
      color: '#ebe8e0',
      roughness: 0.95,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.plinthMat = new THREE.MeshStandardMaterial({
      color: '#eeece5',
      roughness: 0.94,
      metalness: 0.0,
    });
    this.treeMat = new THREE.MeshStandardMaterial({
      color: '#ebe9e2',
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true,
    });

    this.contourMinorMat = new THREE.LineBasicMaterial({
      color: 0xcbc6bc,
      transparent: true,
      opacity: 0.45,
    });
    this.contourMajorMat = new THREE.LineBasicMaterial({
      color: 0xb1aca0,
      transparent: true,
      opacity: 0.72,
    });
    this.curbMat = new THREE.LineBasicMaterial({
      color: 0xbcb7ac,
      transparent: true,
      opacity: 0.65,
    });

    // Crisp architectural footprint highlight loop shown when hovering a building in City View
    const hoverGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, -1),
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(-1, 0, 1),
    ]);
    const hoverMat = new THREE.LineBasicMaterial({
      color: 0x1c1c1c,
      transparent: true,
      opacity: 0.72,
    });
    this.hoverOutline = new THREE.LineLoop(hoverGeo, hoverMat);
    this.hoverOutline.visible = false;
    this.scene.add(this.hoverOutline);

    this.applyLightingAndColors();
    this.syncCamera();
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public setColorEnabled(enabled: boolean): void {
    this.colorEnabled = enabled;
    this.applyLightingAndColors();
  }

  public setSpinEnabled(enabled: boolean): void {
    this.spinEnabled = enabled;
  }

  public setWindowOpen(mode: WindowOpenMode, ratio: number): void {
    this.winOpenMode = mode;
    this.winOpenRatio = Math.max(0, Math.min(1, ratio));
    for (const b of this.buildings) {
      b.rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
    }
  }

  public getFoldTarget(): 0 | 1 {
    return this.cityFoldTarget;
  }

  public setCityFold(target: 0 | 1, instant = false): void {
    this.cityFoldTarget = target;
    for (const b of this.buildings) {
      if (instant) {
        b.curFold = target;
        b.startFold = target;
        b.targetFold = target;
        b.animating = false;
        b.delay = 0;
        for (const id of b.rig.panelIds) {
          b.rig.updatePanelVisual(id, target, 0, false);
        }
        b.rig.setFoldLinesVisible(target < 0.5);
      } else {
        b.startFold = b.curFold;
        b.targetFold = target;
        b.delay = (target === 1 ? b.plot.foldOrder : 1 - b.plot.foldOrder) * 1.15;
        b.elapsed = 0;
        b.duration = 0.95;
        b.animating = true;
      }
    }
  }

  public replayFoldWave(): void {
    this.setCityFold(0, true);
    this.setCityFold(1, false);
  }

  public setCameraView(yaw: number, pitch: number, dist: number, tx = 0, ty = 2.2, tz = 0): void {
    this.curYaw = this.targetYaw = yaw;
    this.curPitch = this.targetPitch = Math.max(0.16, Math.min(1.38, pitch));
    this.curDist = this.targetDist = Math.max(16, Math.min(120, dist));
    this.curTarget.set(tx, ty, tz);
    this.targetPos.set(tx, ty, tz);
    this.syncCamera();
  }

  private applyLightingAndColors(): void {
    const sunDir = this.colorEnabled ? SUN_DIR_COLOR : SUN_DIR_WHITE;
    this.sun.position.copy(sunDir).multiplyScalar(92);

    if (this.colorEnabled) {
      this.hemi.color.set('#fffdf8');
      this.hemi.groundColor.set('#e0ddd6');
      this.hemi.intensity = 1.50;
      this.sun.color.set('#fffdf9');
      this.sun.intensity = 1.24;
      this.fill.intensity = 0.24;
      this.terrainMat.color.set('#f4f2ec');
      this.streetMat.color.set('#e5e2d9');
      this.plazaMat.color.set('#e9e6de');
      this.plinthMat.color.set('#ece9e1');
      this.treeMat.color.set('#a8b8a2');
      const len = ARCHITECTURAL_PAPER_PALETTE.length;
      for (let i = 0; i < this.matPool.length; i++) {
        const m = this.matPool[i];
        m.setOutsideColors([
          ARCHITECTURAL_PAPER_PALETTE[i % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 2) % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 5) % len],
          ARCHITECTURAL_PAPER_PALETTE[(i + 3) % len],
        ]);
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#fbfaf7');
      }
    } else {
      this.hemi.color.set('#fffef9');
      this.hemi.groundColor.set('#dfd9ce');
      this.hemi.intensity = 1.76;
      this.sun.color.set('#fffdf6');
      this.sun.intensity = 2.02;
      this.fill.intensity = 0.28;
      this.terrainMat.color.set('#f5f4f0');
      this.streetMat.color.set('#e7e4dc');
      this.plazaMat.color.set('#eae7df');
      this.plinthMat.color.set('#efede6');
      this.treeMat.color.set('#ebe9e2');
      for (const m of this.matPool) {
        m.setOutsideColor('#f5f4f0');
        m.inside.color.set('#fbfaf7');
        m.edge.color.set('#f8f7f3');
      }
    }
  }

  private clearCityMeshes(): void {
    for (const b of this.buildings) {
      b.rig.dispose();
    }
    this.buildings = [];
    this.pickableMeshes = [];
    for (const g of this.disposedGeos) {
      g.dispose();
    }
    this.disposedGeos = [];
    this.cityRoot.clear();
    this.hoveredPlotIdx = null;
    this.hoverOutline.visible = false;
    this.callbacks.onHoverPlot?.(null);
  }

  public rebuild(opts: CityBuildOptions, animateWave = true): CityLayout {
    this.clearCityMeshes();
    const layout = generateCityLayout(opts);
    this.layout = layout;
    const { terrain } = layout;

    // 1. Sculpted white cotton-rag paper terrain mesh (smoothly blending to y = 0 at fadeRadius)
    const tGeo = new THREE.PlaneGeometry(124, 124, 92, 92);
    tGeo.rotateX(-Math.PI * 0.5);
    const pos = tGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      pos.setY(i, terrain.heightAt(vx, vz));
    }
    pos.needsUpdate = true;
    tGeo.computeVertexNormals();
    this.disposedGeos.push(tGeo);

    const terrainMesh = new THREE.Mesh(tGeo, this.terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    this.cityRoot.add(terrainMesh);

    // 2. Crisp Marching Squares architectural topographic contour lines
    if (layout.contours.length > 0) {
      const minorPts: number[] = [];
      const majorPts: number[] = [];
      for (const seg of layout.contours) {
        const dst = seg.isMajor ? majorPts : minorPts;
        dst.push(seg.a[0], seg.y + 0.028, seg.a[1], seg.b[0], seg.y + 0.028, seg.b[1]);
      }
      if (minorPts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(minorPts, 3));
        this.disposedGeos.push(g);
        this.cityRoot.add(new THREE.LineSegments(g, this.contourMinorMat));
      }
      if (majorPts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(majorPts, 3));
        this.disposedGeos.push(g);
        this.cityRoot.add(new THREE.LineSegments(g, this.contourMajorMat));
      }
    }

    // 3. Terrain-draped randomized street ribbons + crisp curb lines
    const curbPts: number[] = [];
    for (const st of layout.streets) {
      const pts = st.points;
      if (pts.length < 2) continue;
      const halfW = st.width * 0.5;
      const verts: number[] = [];
      const indices: number[] = [];
      const leftEdge: [number, number, number][] = [];
      const rightEdge: [number, number, number][] = [];

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        let tx = next[0] - prev[0];
        let tz = next[1] - prev[1];
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const nx = -tz;
        const nz = tx;

        const lx = p[0] - nx * halfW;
        const lz = p[1] - nz * halfW;
        const rx = p[0] + nx * halfW;
        const rz = p[1] + nz * halfW;

        const ly = terrain.heightAt(lx, lz) + 0.055;
        const cy = terrain.heightAt(p[0], p[1]) + 0.062;
        const ry = terrain.heightAt(rx, rz) + 0.055;

        const base = i * 3;
        verts.push(lx, ly, lz, p[0], cy, p[1], rx, ry, rz);
        leftEdge.push([lx, ly + 0.014, lz]);
        rightEdge.push([rx, ry + 0.014, rz]);

        if (i < pts.length - 1) {
          const nBase = (i + 1) * 3;
          indices.push(base, base + 1, nBase, base + 1, nBase + 1, nBase);
          indices.push(base + 1, base + 2, nBase + 1, base + 2, nBase + 2, nBase + 1);
        }
      }

      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      rGeo.setIndex(indices);
      rGeo.computeVertexNormals();
      this.disposedGeos.push(rGeo);
      const rMesh = new THREE.Mesh(rGeo, this.streetMat);
      rMesh.receiveShadow = true;
      this.cityRoot.add(rMesh);

      for (let i = 0; i < leftEdge.length - 1; i++) {
        curbPts.push(...leftEdge[i], ...leftEdge[i + 1], ...rightEdge[i], ...rightEdge[i + 1]);
      }
    }

    // 4. Terrain-draped circular plazas & hilltop squares
    for (const pl of layout.plazas) {
      const segs = 28;
      const rings = 3;
      const verts: number[] = [pl.x, terrain.heightAt(pl.x, pl.z) + 0.072, pl.z];
      const indices: number[] = [];
      for (let r = 1; r <= rings; r++) {
        const rad = (r / rings) * pl.radius;
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const vx = pl.x + Math.cos(a) * rad;
          const vz = pl.z + Math.sin(a) * rad;
          verts.push(vx, terrain.heightAt(vx, vz) + 0.070, vz);
        }
      }
      for (let s = 0; s < segs; s++) {
        const next = (s + 1) % segs;
        indices.push(0, 1 + next, 1 + s);
      }
      for (let r = 1; r < rings; r++) {
        const inner = 1 + (r - 1) * segs;
        const outer = 1 + r * segs;
        for (let s = 0; s < segs; s++) {
          const next = (s + 1) % segs;
          indices.push(inner + s, inner + next, outer + s, inner + next, outer + next, outer + s);
        }
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      pGeo.setIndex(indices);
      pGeo.computeVertexNormals();
      this.disposedGeos.push(pGeo);
      const pMesh = new THREE.Mesh(pGeo, this.plazaMat);
      pMesh.receiveShadow = true;
      this.cityRoot.add(pMesh);

      // Subtle plaza ring outline
      const outerStart = 1 + (rings - 1) * segs;
      for (let s = 0; s < segs; s++) {
        const i0 = (outerStart + s) * 3;
        const i1 = (outerStart + ((s + 1) % segs)) * 3;
        curbPts.push(
          verts[i0],
          verts[i0 + 1] + 0.015,
          verts[i0 + 2],
          verts[i1],
          verts[i1 + 1] + 0.015,
          verts[i1 + 2],
        );
      }
    }

    if (curbPts.length > 0) {
      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPts, 3));
      this.disposedGeos.push(cGeo);
      this.cityRoot.add(new THREE.LineSegments(cGeo, this.curbMat));
    }

    // 5. Real Origami Paper Buildings on Fitted Architectural Retaining Plinths
    for (const plot of layout.plots) {
      const matSet = this.matPool[plot.index % this.matPool.length];
      const net = buildHouseNet(plot.spec);
      const rig = buildOrigamiHouseRig(net, matSet, false);
      rig.setWindowOpen(this.winOpenMode, this.winOpenRatio);
      rig.setPaperRelief(1);
      rig.setFoldLinesVisible(!animateWave && this.cityFoldTarget === 0);

      const wrapper = new THREE.Group();
      wrapper.position.set(plot.x, plot.baseY, plot.z);
      wrapper.rotation.y = plot.yaw;

      // Fitted retaining plinth extending smoothly below the lowest hillside corner so nothing ever floats!
      const plinthH = Math.max(0.28, plot.baseY - plot.groundMinY + 0.95);
      const plinthGeo = new THREE.BoxGeometry(plot.footprintW + 0.16, plinthH, plot.footprintD + 0.16);
      this.disposedGeos.push(plinthGeo);
      const plinth = new THREE.Mesh(plinthGeo, this.plinthMat);
      plinth.position.y = -plinthH * 0.5;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      plinth.userData.cityPlotIndex = plot.index;
      wrapper.add(plinth);

      rig.root.rotation.y = 0;
      rig.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.userData.cityPlotIndex = plot.index;
          this.pickableMeshes.push(obj);
        }
      });
      this.pickableMeshes.push(plinth);
      wrapper.add(rig.root);
      this.cityRoot.add(wrapper);

      const initFold = animateWave ? 0 : this.cityFoldTarget;
      for (const id of rig.panelIds) {
        rig.updatePanelVisual(id, initFold, 0, false);
      }

      this.buildings.push({
        plot,
        rig,
        wrapper,
        plinth,
        curFold: initFold,
        startFold: initFold,
        targetFold: animateWave ? 1 : this.cityFoldTarget,
        delay: animateWave ? plot.foldOrder * 1.15 : 0,
        elapsed: 0,
        duration: 0.95,
        animating: animateWave,
      });
    }
    if (animateWave) this.cityFoldTarget = 1;

    // 6. Grounded Minimalist Folded Origami Paper Trees tucked into plazas & hillside pockets
    if (layout.trees.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.95, 5);
      trunkGeo.translate(0, 0.18, 0);
      const cypressGeo = new THREE.ConeGeometry(0.46, 1.95, 6);
      cypressGeo.translate(0, 1.32, 0);
      const pineBotGeo = new THREE.ConeGeometry(0.62, 1.15, 6);
      pineBotGeo.translate(0, 0.92, 0);
      const pineTopGeo = new THREE.ConeGeometry(0.44, 0.95, 6);
      pineTopGeo.translate(0, 1.56, 0);
      const canopyGeo = new THREE.DodecahedronGeometry(0.58, 0);
      canopyGeo.scale(1.0, 0.88, 1.0);
      canopyGeo.translate(0, 1.06, 0);
      this.disposedGeos.push(trunkGeo, cypressGeo, pineBotGeo, pineTopGeo, canopyGeo);

      for (const tr of layout.trees) {
        const tg = new THREE.Group();
        tg.position.set(tr.x, tr.y, tr.z);
        tg.rotation.y = tr.rotY;
        tg.scale.setScalar(tr.scale);

        const trunk = new THREE.Mesh(trunkGeo, this.plinthMat);
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        tg.add(trunk);

        if (tr.variant === 0) {
          const m = new THREE.Mesh(cypressGeo, this.treeMat);
          m.castShadow = true;
          m.receiveShadow = true;
          tg.add(m);
        } else if (tr.variant === 1) {
          const m1 = new THREE.Mesh(pineBotGeo, this.treeMat);
          const m2 = new THREE.Mesh(pineTopGeo, this.treeMat);
          m1.castShadow = m2.castShadow = true;
          m1.receiveShadow = m2.receiveShadow = true;
          tg.add(m1, m2);
        } else {
          const m = new THREE.Mesh(canopyGeo, this.treeMat);
          m.castShadow = true;
          m.receiveShadow = true;
          tg.add(m);
        }
        this.cityRoot.add(tg);
      }
    }

    // Center focus gently toward average elevation of city plots
    const avgY =
      layout.plots.length > 0
        ? layout.plots.reduce((acc, p) => acc + p.baseY, 0) / layout.plots.length + 1.2
        : 2.0;
    this.targetPos.set(0, avgY, 0);
    this.curTarget.set(0, avgY, 0);
    this.applyLightingAndColors();
    this.syncCamera();
    this.callbacks.onLayoutBuilt?.(layout);
    return layout;
  }

  private syncCamera(): void {
    const cx = this.curTarget.x + this.curDist * Math.cos(this.curPitch) * Math.sin(this.curYaw);
    const cy = this.curTarget.y + this.curDist * Math.sin(this.curPitch);
    const cz = this.curTarget.z + this.curDist * Math.cos(this.curPitch) * Math.cos(this.curYaw);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.curTarget);
  }

  public update(dt: number): void {
    // 1. Advance city-wide origami fold wave
    for (const b of this.buildings) {
      if (!b.animating) continue;
      if (b.delay > 0) {
        b.delay = Math.max(0, b.delay - dt);
        continue;
      }
      b.elapsed += dt;
      const u = Math.min(1, b.elapsed / b.duration);
      b.curFold = b.startFold + (b.targetFold - b.startFold) * easePaperFold(u);
      for (const id of b.rig.panelIds) {
        b.rig.updatePanelVisual(id, b.curFold, 0, false);
      }
      if (u >= 1) {
        b.curFold = b.targetFold;
        b.animating = false;
        b.rig.setFoldLinesVisible(b.curFold < 0.5);
      }
    }

    // 2. Smooth orbital damping + gentle gallery rotation when idle
    if (this.spinEnabled && this.dragMode === 'none') {
      this.targetYaw += 0.055 * dt;
    }
    const k = 1 - Math.exp(-9.5 * dt);
    this.curYaw += (this.targetYaw - this.curYaw) * k;
    this.curPitch += (this.targetPitch - this.curPitch) * k;
    this.curDist += (this.targetDist - this.curDist) * k;
    this.curTarget.lerp(this.targetPos, k);
    this.syncCamera();
  }

  private pickPlotAt(clientX: number, clientY: number, canvas: HTMLCanvasElement): CityBuildingPlot | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickableMeshes, false);
    if (hits.length === 0) return null;
    const idx = hits[0].object.userData.cityPlotIndex;
    if (typeof idx !== 'number' || !this.layout) return null;
    return this.layout.plots[idx] ?? null;
  }

  private setHoverPlot(plot: CityBuildingPlot | null): void {
    const nextIdx = plot ? plot.index : null;
    if (nextIdx === this.hoveredPlotIdx) return;
    this.hoveredPlotIdx = nextIdx;
    if (plot) {
      const pos = this.hoverOutline.geometry.attributes.position as THREE.BufferAttribute;
      const pad = 0.24;
      const hw = plot.footprintW * 0.5 + pad;
      const hd = plot.footprintD * 0.5 + pad;
      const c = Math.cos(plot.yaw);
      const s = Math.sin(plot.yaw);
      const corners: [number, number][] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ];
      for (let i = 0; i < 4; i++) {
        const [lx, lz] = corners[i];
        pos.setXYZ(i, plot.x + lx * c + lz * s, plot.baseY + 0.08, plot.z - lx * s + lz * c);
      }
      pos.needsUpdate = true;
      this.hoverOutline.visible = true;
    } else {
      this.hoverOutline.visible = false;
    }
    this.callbacks.onHoverPlot?.(plot);
  }

  public onPointerDown(e: PointerEvent, canvas: HTMLCanvasElement): void {
    this.pointerId = e.pointerId;
    this.lastPx = this.downPx = e.clientX;
    this.lastPy = this.downPy = e.clientY;
    this.movedDist = 0;
    this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    canvas.setPointerCapture(e.pointerId);
  }

  public onPointerMove(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (this.dragMode === 'none') {
      const plot = this.pickPlotAt(e.clientX, e.clientY, canvas);
      this.setHoverPlot(plot);
      canvas.style.cursor = plot ? 'pointer' : 'grab';
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastPx;
    const dy = e.clientY - this.lastPy;
    this.lastPx = e.clientX;
    this.lastPy = e.clientY;
    this.movedDist += Math.hypot(dx, dy);

    if (this.dragMode === 'orbit') {
      this.targetYaw -= dx * 0.0065;
      this.targetPitch = Math.max(0.16, Math.min(1.38, this.targetPitch + dy * 0.0055));
    } else {
      const panScale = this.curDist * 0.0014;
      const rightX = Math.cos(this.curYaw);
      const rightZ = -Math.sin(this.curYaw);
      const fwdX = -Math.sin(this.curYaw);
      const fwdZ = -Math.cos(this.curYaw);
      this.targetPos.x = Math.max(-30, Math.min(30, this.targetPos.x - dx * panScale * rightX + dy * panScale * fwdX));
      this.targetPos.z = Math.max(-30, Math.min(30, this.targetPos.z - dx * panScale * rightZ + dy * panScale * fwdZ));
    }
    canvas.style.cursor = 'grabbing';
  }

  public onPointerUp(e: PointerEvent, canvas: HTMLCanvasElement): void {
    if (e.pointerId !== this.pointerId) return;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    const wasClick = this.movedDist < 6 && e.button === 0;
    this.dragMode = 'none';
    this.pointerId = null;
    canvas.style.cursor = 'grab';
    if (wasClick) {
      const plot = this.pickPlotAt(e.clientX, e.clientY, canvas);
      if (plot) {
        this.callbacks.onSelectPlot?.(plot);
      }
    }
  }

  public onWheel(e: WheelEvent): void {
    const scale = Math.exp(e.deltaY * 0.0011);
    this.targetDist = Math.max(16, Math.min(118, this.targetDist * scale));
  }

  public getStreetStyle(): CityStreetStyle {
    return this.layout?.style ?? 'organic';
  }

  public dispose(): void {
    this.clearCityMeshes();
    for (const m of this.matPool) m.dispose();
    this.terrainMat.dispose();
    this.streetMat.dispose();
    this.plazaMat.dispose();
    this.plinthMat.dispose();
    this.treeMat.dispose();
    this.contourMinorMat.dispose();
    this.contourMajorMat.dispose();
    this.curbMat.dispose();
    this.hoverOutline.geometry.dispose();
    (this.hoverOutline.material as THREE.Material).dispose();
  }
}
