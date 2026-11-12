import * as THREE from 'three';
import type { Rig } from './rig';
import { SIDES, sideSign } from './rig';
import { buildSkinGeometry } from './plumageGeometry';
import { DEG, lerp, smoothstep } from './util';

// The hard and bare parts: skin under the feathers, bill, eyes, eyelids,
// nictitating membranes, legs and toes. Each is authored in its bone's local
// space and baked to bind space, weighted to that single bone.

class PartBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  constructor(private rig: Rig) {}

  /** Add a geometry authored in `bone` space. */
  /** `pick` may send a vertex to another bone, given its y in the authoring space. */
  add(g: THREE.BufferGeometry, bone: string, color: THREE.Color, pick?: (y: number) => string) {
    const r = this.rig.rest[bone];
    const m = new THREE.Matrix4().compose(r.worldPos, r.worldQuat, new THREE.Vector3(1, 1, 1));
    const gg = g.index ? g.toNonIndexed() : g.clone();
    const localY = pick ? Float32Array.from({ length: gg.getAttribute('position').count }, (_, i) => gg.getAttribute('position').getY(i)) : null;
    gg.applyMatrix4(m);
    const p = gg.getAttribute('position');
    const n = gg.getAttribute('normal');
    const uv = gg.getAttribute('uv');
    const start = this.pos.length / 3;
    const bi = this.rig.index(bone);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(color.r, color.g, color.b);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.si.push(pick && localY ? this.rig.index(pick(localY[i])) : bi, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
      this.idx.push(start + i);
    }
    gg.dispose();
    g.dispose();
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 2.5);
    return g;
  }
}

/** Tube along a path with a per-point radius and an elliptical section. */
function tube(points: THREE.Vector3[], radius: (t: number) => [number, number], up: THREE.Vector3, segs = 10) {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = points.length;
  const T = new THREE.Vector3();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    T.copy(points[Math.min(i + 1, n - 1)]).sub(points[Math.max(i - 1, 0)]).normalize();
    X.crossVectors(up, T).normalize();
    Y.crossVectors(T, X);
    const [rx, ry] = radius(i / (n - 1));
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(
        points[i].x + X.x * Math.cos(a) * rx + Y.x * Math.sin(a) * ry,
        points[i].y + X.y * Math.cos(a) * rx + Y.y * Math.sin(a) * ry,
        points[i].z + X.z * Math.cos(a) * rx + Y.z * Math.sin(a) * ry,
      );
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Patch of a sphere: alpha sweeps around X (0 = +Z, toward +Y), beta is the latitude toward ±X. */
function lidShell(r: number, a0: number, a1: number, beta: number, aboutY = false) {
  const na = 12;
  const nb = 12;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= na; i++) {
    const a = lerp(a0, a1, i / na);
    for (let j = 0; j <= nb; j++) {
      const b = lerp(-beta, beta, j / nb);
      let x = Math.sin(b);
      let y = Math.cos(b) * Math.sin(a);
      const z = Math.cos(b) * Math.cos(a);
      if (aboutY) {
        // same patch, but sweeping around Y (toward +X)
        const t = x;
        x = y;
        y = t;
      }
      pos.push(x * r, y * r, z * r);
      nor.push(x, y, z);
    }
  }
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const a = i * (nb + 1) + j;
      const b = a + nb + 1;
      if (aboutY) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export interface Parts {
  meshes: THREE.SkinnedMesh[];
  eyeMaterial: THREE.MeshPhysicalMaterial;
  dispose(): void;
}

/** Lid travel, shared with the pose solver. Angles in radians around the eye's X axis. */
export const LID = {
  upperOpen: 62 * DEG,
  lowerOpen: -72 * DEG,
  nictOpen: 150 * DEG,
};

export function buildParts(rig: Rig): Parts {
  const sp = rig.species;
  const R = sp.eye.radius;
  const skinCol = new THREE.Color(sp.skin);
  const up = new THREE.Vector3(0, 1, 0);

  // --- skin: loft + lids + orbital ring + legs ---------------------------------
  const skinB = new PartBuilder(rig);
  const lidCol = new THREE.Color(0x151312);
  for (const side of SIDES) {
    const ring = new THREE.TorusGeometry(R * 0.8, R * 0.11, 8, 28);
    ring.translate(0, 0, R * 0.64);
    skinB.add(ring, `eye.${side}`, new THREE.Color(0x0c0b0b));
    skinB.add(lidShell(R * 1.045, 14 * DEG, 112 * DEG, 78 * DEG), `lidUpper.${side}`, lidCol);
    skinB.add(lidShell(R * 1.04, -106 * DEG, 20 * DEG, 78 * DEG), `lidLower.${side}`, lidCol);
  }
  // legs
  const legCol = new THREE.Color(sp.legs.color);
  const Rp = sp.legs.perchRadius;
  for (const side of SIDES) {
    const sg = sideSign(side);
    const len = rig.tarsusLength;
    skinB.add(
      tube([0, 0.25, 0.5, 0.75, 1, 1.15].map((t) => new THREE.Vector3(0, 0, t * len)), (t) => [lerp(0.011, 0.017, t), lerp(0.011, 0.017, t)], up, 8),
      `tarsus.${side}`,
      legCol,
    );
    // toes wrap the perch: theta 0 = top, positive forward
    const rt = 0.0085;
    const toe = (i: number, th0: number, th1: number, x0: number, x1: number) => {
      const pts: THREE.Vector3[] = [];
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const th = lerp(th0, th1, t);
        // the claw hooks in past the pad
        const hook = smoothstep(0.78, 1, t) * 0.012;
        const lift = (1 - smoothstep(0, 0.2, t)) * 0.012;
        const rr = Rp + rt * 0.9 - hook + lift;
        pts.push(new THREE.Vector3(lerp(x0, x1, t), -Rp + rr * Math.cos(th), rr * Math.sin(th)));
      }
      skinB.add(
        tube(pts, (t) => {
          const taper = t > 0.78 ? lerp(0.75, 0.08, (t - 0.78) / 0.22) : 1 + 0.12 * Math.sin(t * 22);
          return [rt * taper, rt * taper * 0.9];
        }, new THREE.Vector3(1, 0, 0), 7),
        `toe.${side}.${i}`,
        t3(legCol, i),
      );
    };
    const fwd = sp.legs.toe / (Rp + rt);
    toe(1, -0.12, fwd * 0.95, 0, -0.03 * sg);
    toe(2, -0.12, fwd * 1.1, 0, 0.002 * sg);
    toe(3, -0.12, fwd * 0.98, 0, 0.034 * sg);
    toe(4, 0.05, -fwd * 0.8, 0, -0.006 * sg);
  }
  const loftGeo = buildSkinGeometry(rig);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, envMapIntensity: 0.4, side: THREE.DoubleSide });
  const loftMat = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.95 });
  const loftMesh = new THREE.SkinnedMesh(loftGeo, loftMat);
  loftMesh.name = 'bird.skin';
  const bare = new THREE.SkinnedMesh(skinB.build(), skinMat);
  bare.name = 'bird.bare';

  // --- bill ------------------------------------------------------------------------
  const billB = new PartBuilder(rig);
  const B = sp.bill;
  const billCol = new THREE.Color(B.color);
  // one closed needle, slightly decurved. The lower half is weighted to the jaw, so it can
  // still open, but at rest there is no seam to see.
  {
    const pts: THREE.Vector3[] = [];
    const N = 26;
    for (let k = 0; k <= N; k++) {
      const z = lerp(-0.07, B.length, k / N);
      const tt = Math.max(z / B.length, 0);
      pts.push(new THREE.Vector3(0, -B.droop * tt * tt, z));
    }
    const needle = tube(pts, (t) => {
      const tt = Math.max((t * (B.length + 0.07) - 0.07) / B.length, 0);
      const taper = lerp(1, 0.17, Math.pow(tt, 0.8)) * (tt > 0.95 ? lerp(1, 0.05, (tt - 0.95) / 0.05) : 1);
      return [B.radius * taper, B.radius * 0.94 * taper];
    }, up, 12);
    billB.add(needle, 'bill', billCol, (y) => (y < -B.radius * 0.12 ? 'jaw' : 'bill'));
  }
  const billMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.68, envMapIntensity: 0.35 });
  const bill = new THREE.SkinnedMesh(billB.build(), billMat);
  bill.name = 'bird.bill';

  // --- eyes ------------------------------------------------------------------------
  const eyeB = new PartBuilder(rig);
  for (const side of SIDES) {
    const g = new THREE.SphereGeometry(R, 40, 28);
    g.rotateX(Math.PI / 2); // pole on +Z, the eye's outward axis
    // cornea bulge
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) / R;
      const k = 1 + 0.07 * smoothstep(0.55, 1, z);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    // uv.x = cos of the angle from the eye axis, for the iris
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / R, 0);
    eyeB.add(g, `eye.${side}`, new THREE.Color(1, 1, 1));
  }
  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.5,
    specularIntensity: 1,
    ior: 1.4,
  });
  eyeMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEyeCos;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvEyeCos = uv.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEyeCos;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  // a near-black eye: pupil, a very dark umber iris you only catch in strong light, dark limbus
  float iris = smoothstep(0.93, 0.86, vEyeCos) * smoothstep(0.55, 0.7, vEyeCos);
  diffuseColor.rgb = mix(vec3(0.001), vec3(0.012, 0.006, 0.003), iris);
}`,
      )
      .replace(
        '#include <aomap_fragment>',
        /* glsl */ `#include <aomap_fragment>
{
  // catchlight: the sky as a soft window high in the cornea, always there, like wet eyes have
  vec3 skyV = normalize((viewMatrix * vec4(-0.25, 1.0, 0.35, 0.0)).xyz);
  vec3 R = reflect(-geometryViewDir, normal);
  float w = smoothstep(0.86, 0.97, dot(R, skyV));
  float pin = smoothstep(0.985, 0.997, dot(R, normalize(skyV + vec3(0.12, 0.05, 0.0))));
  totalEmissiveRadiance += vec3(0.75, 0.9, 0.8) * (w * 0.1 + pin * 1.6);
}`,
      );
  };
  const eyes = new THREE.SkinnedMesh(eyeB.build(), eyeMaterial);
  eyes.name = 'bird.eyes';

  // --- nictitating membranes ---------------------------------------------------
  const nictB = new PartBuilder(rig);
  for (const side of SIDES) nictB.add(lidShell(R * 1.085, -100 * DEG, 100 * DEG, 80 * DEG, true), `nict.${side}`, new THREE.Color(0x8e98a6));
  const nictMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.25, transparent: true, opacity: 0.82, clearcoat: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const nict = new THREE.SkinnedMesh(nictB.build(), nictMat);
  nict.name = 'bird.nict';
  nict.renderOrder = 2;

  const meshes = [loftMesh, bare, bill, eyes, nict];
  for (const m of meshes) {
    m.frustumCulled = false;
    m.bind(rig.skeleton, new THREE.Matrix4());
  }
  loftMesh.castShadow = true;
  bill.castShadow = true;
  bare.castShadow = true;
  bare.receiveShadow = true;
  bill.receiveShadow = true;
  return {
    meshes,
    eyeMaterial,
    dispose() {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
  };
}

function t3(c: THREE.Color, i: number) {
  return c.clone().multiplyScalar(1 - (i % 2) * 0.12);
}
