import * as THREE from 'three';

// the haze is lit from above: fog thickens to a brighter grey the higher up it is, so the steel stands dark
// against it up there and sinks into the dark below
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogAt = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogAt = instanceMatrix * fogAt;
  #endif
  vFogY = (modelMatrix * fogAt).y;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n varying float vFogY;');
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogLit = mix( fogColor, ${hazeHigh()}, smoothstep( -6.0, 48.0, vFogY ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogLit, fogFactor );
#endif`;
function hazeHigh() {
  return 'vec3(0.042, 0.048, 0.056)';
}

/**
 * The hall, made up: lattice steel going up into the haze (towers, girders, catwalks, a roof of trusses with
 * skylights), the girder the pod hangs from, light from the roof and from windows in the sides, and the shafts of
 * that light in the fog, faked as soft additive cones with dust drifting through.
 */
export function buildHall(scene: THREE.Scene, hang: THREE.Vector3) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ROOF = 52;

  // ---------- steel: every bar one instance of a unit box, stretched from a to b

  const bars: THREE.Matrix4[] = [];
  const up = V(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const bar = (a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) => {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return;
    q.setFromUnitVectors(up, d.divideScalar(len));
    bars.push(m4.compose(a.clone().add(b).multiplyScalar(0.5), q, V(w, len, h)).clone());
  };

  /** a box truss from a to b, `side` its half width, `rise` its height, panels about `panel` long */
  const truss = (a: THREE.Vector3, b: THREE.Vector3, side: THREE.Vector3, rise: THREE.Vector3, panel: number, chord = 0.16, web = 0.07) => {
    const corners = [side.clone().negate(), side.clone(), side.clone().negate().add(rise), side.clone().add(rise)];
    for (const c of corners) bar(a.clone().add(c), b.clone().add(c), chord);
    const n = Math.max(1, Math.round(a.distanceTo(b) / panel));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      const [l0, r0, l1, r1] = corners.map((c) => p.clone().add(c));
      bar(l0, l1, web); bar(r0, r1, web); bar(l0, r0, web); bar(l1, r1, web);
      if (i === n) continue;
      const p2 = a.clone().lerp(b, (i + 1) / n);
      const [l2, r2, l3, r3] = corners.map((c) => p2.clone().add(c));
      if (i % 2) { bar(l0, l3, web); bar(r0, r3, web); } else { bar(l1, l2, web); bar(r1, r2, web); }
    }
  };

  /** a lattice tower, w wide, from y0 to y1 */
  const tower = (x: number, z: number, y0: number, y1: number, w: number) => {
    const h = w / 2;
    const cs = [V(-h, 0, -h), V(h, 0, -h), V(h, 0, h), V(-h, 0, h)];
    for (const c of cs) bar(V(x + c.x, y0, z + c.z), V(x + c.x, y1, z + c.z), 0.22);
    const step = w * 1.2;
    for (let y = y0, k = 0; y < y1; y += step, k++) {
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4];
        bar(V(x + a.x, y, z + a.z), V(x + b.x, y, z + b.z), 0.1);
        const flip = (k + i) % 2 ? 1 : 0;
        bar(V(x + a.x, y + step * flip, z + a.z), V(x + b.x, y + step * (1 - flip), z + b.z), 0.07);
      }
    }
  };

  const TX = 12; // towers either side
  const rows = [24, -6, -21, -36]; // none near the eye
  for (const z of rows) {
    tower(-TX, z, -45, ROOF, 2.4);
    tower(TX, z, -45, ROOF, 2.4);
    for (const y of [-14, 22, 36]) truss(V(-TX, y, z), V(TX, y, z), V(0, 0, 0.8), V(0, 2.2, 0), 2.2);
    // the roof's trusses, deep ones
    truss(V(-TX - 4, ROOF - 4, z), V(TX + 4, ROOF - 4, z), V(0, 0, 0.6), V(0, 4, 0), 3, 0.2, 0.09);
  }
  for (const x of [-TX, TX]) {
    for (const y of [-14, 22, 36]) truss(V(x, y, rows[0]), V(x, y, rows[rows.length - 1]), V(0.8, 0, 0), V(0, 2.2, 0), 2.2);
    // a catwalk along the inside of each row of towers, rails and all
    const cx = x - Math.sign(x) * 2.2;
    for (const y of [-6, 12]) {
      const z0 = rows[0] + 2, z1 = rows[rows.length - 1] - 2;
      bar(V(cx - 0.6, y, z0), V(cx - 0.6, y, z1), 0.12, 0.25);
      bar(V(cx + 0.6, y, z0), V(cx + 0.6, y, z1), 0.12, 0.25);
      for (let z = z0; z > z1; z -= 1.5) {
        bar(V(cx - 0.6, y, z), V(cx + 0.6, y, z), 0.05);
        bar(V(cx - 0.6, y, z), V(cx - 0.6, y + 1.1, z), 0.04);
        bar(V(cx + 0.6, y, z), V(cx + 0.6, y + 1.1, z), 0.04);
      }
      bar(V(cx - 0.6, y + 1.1, z0), V(cx - 0.6, y + 1.1, z1), 0.05);
      bar(V(cx + 0.6, y + 1.1, z0), V(cx + 0.6, y + 1.1, z1), 0.05);
    }
  }
  // the girder it hangs from, across the hall, and the rails between the roof trusses
  const gy = hang.y + 0.35;
  truss(V(-TX, gy, hang.z), V(TX, gy, hang.z), V(0, 0, 0.6), V(0, 1.8, 0), 1.8, 0.2, 0.08);
  for (const x of [-7, 0, 7]) bar(V(x, ROOF - 4, rows[0]), V(x, ROOF - 4, rows[rows.length - 1]), 0.3, 0.5);
  // a frame round the hang point where the hoses come down from, a grating hung under the girder
  {
    const y = gy - 0.15, s = 1.9;
    const c = [V(-s, y, -s), V(s, y, -s), V(s, y, s), V(-s, y, s)].map((p) => p.add(V(hang.x, 0, hang.z)));
    for (let i = 0; i < 4; i++) bar(c[i], c[(i + 1) % 4], 0.14, 0.2);
    for (let i = 1; i < 6; i++) {
      const t = -s + (2 * s * i) / 6;
      bar(V(hang.x + t, y, hang.z - s), V(hang.x + t, y, hang.z + s), 0.06);
    }
    for (const p of c) bar(p, V(p.x, gy, hang.z + Math.sign(p.z - hang.z) * 0.6), 0.06);
  }

  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e32, roughness: 0.62, metalness: 0.55 });
  const lattice = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, bars.length);
  bars.forEach((m, i) => lattice.setMatrixAt(i, m));
  lattice.instanceMatrix.needsUpdate = true;
  lattice.receiveShadow = true;
  scene.add(lattice);

  // the block at the hang point: a sheave in a frame
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.45, metalness: 0.8 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), mat);
    frame.position.set(hang.x, hang.y + 0.12, hang.z);
    const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 20), mat);
    sheave.rotation.x = Math.PI / 2;
    sheave.position.set(hang.x, hang.y + 0.15, hang.z);
    frame.castShadow = sheave.castShadow = true;
    scene.add(frame, sheave);
  }

  // skylights in the roof, and windows high in the sides: only seen as glow through the haze
  {
    const glow = new THREE.MeshBasicMaterial({ color: 0xb8c4d0, fog: false });
    const pane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < rows.length - 1; i++) {
      for (const x of [-7, 0, 7]) {
        const m = new THREE.Mesh(pane, glow);
        m.scale.set(5, 12, 1);
        m.rotation.x = Math.PI / 2;
        m.position.set(x + 3.5, ROOF + 0.5, (rows[i] + rows[i + 1]) / 2);
        scene.add(m);
      }
    }
  }

  // the haze beyond everything, the same grey as the fog at each height
  {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { low: { value: (scene.fog as THREE.FogExp2).color } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 low; varying vec3 vDir;
          void main() { gl_FragColor = vec4(mix(low, ${hazeHigh()}, smoothstep(-0.05, 0.35, vDir.y)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -1;
    scene.add(dome);
  }

  // ---------- light: the roof and the sides

  const roof = new THREE.SpotLight(0xe6edf5, 7, 0, 0.06, 0.55, 0); // one skylight right over it, through the girder's gap
  roof.position.set(-8.5, ROOF - 4, 9);
  roof.target.position.set(0, 0.4, 0);
  roof.castShadow = true;
  roof.shadow.mapSize.set(2048, 2048);
  roof.shadow.camera.near = 30;
  roof.shadow.camera.far = 70;
  roof.shadow.bias = -0.0004;
  roof.shadow.normalBias = 0.02;
  const left = new THREE.SpotLight(0x9fb4c8, 1.6, 0, 0.12, 0.8, 0); // cold, from a window in the left wall
  left.position.set(-34, 12, -6);
  left.target.position.set(0, 0.5, 0);
  const right = new THREE.SpotLight(0xd8cbb8, 0.9, 0, 0.14, 0.8, 0); // warmer, low from the right
  right.position.set(32, 5, -14);
  right.target.position.set(0, 0.2, 0);
  scene.add(roof, roof.target, left, left.target, right, right.target);

  // ---------- shafts: cones of light in the fog

  const shaftMat = (color: number, strength: number) =>
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: strength }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying float vAlong;
        void main() {
          vLocal = position;
          vAlong = 1.0 - uv.y;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float strength;
        uniform float time;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        varying float vAlong;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        void main() {
          vec3 toEye = cameraPosition - vWorld;
          float dist = length(toEye);
          float edge = pow(abs(dot(normalize(vNormal), toEye / dist)), 2.2); // thin at the rim, as a lit column of haze is
          float along = smoothstep(0.0, 0.06, vAlong) * (1.0 - smoothstep(0.3, 1.0, vAlong));
          // streaks that run down the shaft, drifting
          float n = noise(vec3(vLocal.x * 1.6, vLocal.y * 0.05 - time * 0.04, vLocal.z * 1.6)) * 0.6
                  + noise(vec3(vLocal.x * 4.0 + time * 0.1, vLocal.y * 0.2, vLocal.z * 4.0)) * 0.4;
          float a = strength * edge * along * (0.45 + 0.75 * n);
          a *= smoothstep(0.6, 4.0, dist) * (1.0 - 0.7 * smoothstep(25.0, 90.0, dist));
          gl_FragColor = vec4(color * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });

  const shafts: THREE.ShaderMaterial[] = [];
  /** a cone of light from `from` along `dir`, r0 wide where it starts, r1 where it ends `len` on */
  const shaft = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, color: number, strength: number) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 40, 1, true);
    g.translate(0, -len / 2, 0); // the top at the source
    const mat = shaftMat(color, strength);
    shafts.push(mat);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(V(0, -1, 0), dir.clone().normalize());
    m.renderOrder = 2;
    scene.add(m);
  };
  const toPod = roof.target.position.clone().sub(roof.position);
  shaft(roof.position, toPod, toPod.length() * 1.25, 0.5, 3.6, 0xc8d4e0, 0.14);
  // the other skylights' light, falling slanted through the hall behind
  const fall = V(0.22, -1, -0.12);
  for (const [x, z, r] of [[-4, -13, 2.2], [6, -14, 1.8], [-6, -28, 2.6], [5, -29, 2], [12, -3, 1.6]] as const) {
    shaft(V(x, ROOF, z), fall, 95, r * 0.7, r * 1.6, 0xaab6c4, 0.06);
  }
  // and the windows in the sides
  shaft(left.position, left.target.position.clone().sub(left.position), 48, 1.6, 4.2, 0x8fa4b8, 0.08);
  shaft(V(-34, 18, -22), V(1, -0.32, 0.14), 50, 1.4, 3.6, 0x8fa4b8, 0.07);
  shaft(right.position, right.target.position.clone().sub(right.position), 45, 1.4, 3.4, 0xc8b8a0, 0.06);

  // ---------- dust in the light over the pod

  const DUST = 700;
  const dust = new Float32Array(DUST * 3);
  const seeds = new Float32Array(DUST);
  const dustAt = (i: number, fresh: boolean) => {
    // somewhere in the roof shaft, between the girder and well below the pod
    const y = fresh ? -6 + Math.random() * 17 : 11;
    const t = (roof.position.y - y) / -toPod.y;
    const r = Math.sqrt(Math.random()) * 0.9 * (0.5 + (3.1 * t) / 1.25);
    const a = Math.random() * Math.PI * 2;
    dust[i * 3] = roof.position.x + toPod.x * t + Math.cos(a) * r;
    dust[i * 3 + 1] = y;
    dust[i * 3 + 2] = roof.position.z + toPod.z * t + Math.sin(a) * r;
    seeds[i] = Math.random() * 100;
  };
  for (let i = 0; i < DUST; i++) dustAt(i, true);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  {
    const g = dot.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  const motes = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ size: 0.035, map: new THREE.CanvasTexture(dot), color: 0x9aa4ae, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  scene.add(motes);

  return {
    roof,
    update(time: number, dt: number) {
      for (const s of shafts) s.uniforms.time.value = time;
      for (let i = 0; i < DUST; i++) {
        const s = seeds[i];
        dust[i * 3] += Math.sin(time * 0.3 + s) * 0.05 * dt;
        dust[i * 3 + 1] -= (0.03 + 0.03 * Math.sin(s)) * dt;
        dust[i * 3 + 2] += Math.cos(time * 0.27 + s * 1.3) * 0.05 * dt;
        if (dust[i * 3 + 1] < -6) dustAt(i, false);
      }
      dustGeo.attributes.position.needsUpdate = true;
    },
  };
}
