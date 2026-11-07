import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { motion } from './clock';
import { AdditiveBlending, CapsuleGeometry, Color, ConeGeometry, type Group, type InstancedMesh, Matrix4, MeshBasicMaterial, MeshPhysicalMaterial, Quaternion, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { rng } from './random';
import { SUN } from './scale';

// The stars are sweets: gumballs, jelly beans, flat lentils and sprinkles hanging all round the solar system in a
// thick shell, some near, some far, so they part against each other as the camera moves. Each tumbled its own way,
// mostly small, now and then a big one, the far ones darker. Lit by the sun like everything else; no physics.
const NEAR = 45, FAR = 140; // the shell, out from the sun (the camera's far plane is 250 from it)
const SCALE = 0.65; // all of them, against the planets
const DIM = 0.75; // colours a little darker, so they stay behind the planets
const FAR_DIM = 0.25; // and at the far side of the shell, this much of that
const COLOURS = ['#f29aa8', '#f08a7e', '#f5a04e', '#f2cc66', '#a9bde8', '#9fc7a8', '#f7b6c8', '#e0262e', '#ffffff', '#7a4bd0'];

type Kind = { count: number; geometry: () => SphereGeometry | CapsuleGeometry; size: [number, number] };
const KINDS: Kind[] = [
  { count: 220, geometry: () => new SphereGeometry(0.5, 20, 14), size: [0.5, 1.6] }, // gumballs
  { count: 240, geometry: () => new CapsuleGeometry(0.28, 0.5, 6, 14), size: [0.8, 1.8] }, // jelly beans
  { count: 220, geometry: () => new SphereGeometry(0.5, 20, 10).scale(1, 0.38, 1), size: [0.6, 1.5] }, // lentils
  { count: 800, geometry: () => new CapsuleGeometry(0.05, 0.22, 3, 6), size: [1, 2] }, // sprinkles
];

const MATERIAL = new MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.18 });

function Scatter({ kind, seed }: { kind: Kind; seed: number }) {
  const ref = useRef<InstancedMesh>(null!);
  const geometry = useMemo(kind.geometry, [kind]);
  useLayoutEffect(() => {
    const rnd = rng(seed), m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), c = new Color();
    for (let i = 0; i < kind.count; i++) {
      // A direction even over the sphere, and a depth anywhere through the shell.
      const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, ring = Math.sqrt(1 - y * y);
      const depth = rnd(), r = NEAR + (FAR - NEAR) * depth;
      p.set(Math.cos(a) * ring, y, Math.sin(a) * ring).multiplyScalar(r).add(SUN);
      // Tumbled any way at all.
      q.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const k = (kind.size[0] + rnd() ** 3 * (kind.size[1] - kind.size[0])) * SCALE;
      ref.current.setMatrixAt(i, m.compose(p, q, s.setScalar(k)));
      const tint = DIM * (1 - (1 - FAR_DIM) * depth);
      ref.current.setColorAt(i, c.set(COLOURS[Math.floor(rnd() * COLOURS.length)]).multiplyScalar(tint));
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [kind, seed]);
  return <instancedMesh ref={ref} args={[geometry, MATERIAL, kind.count]} frustumCulled={false} />;
}

// Now and then a shooting star: a bright little sweet streaking down across the sky at a slant, a fading tail
// behind it, somewhere out in front of the camera so it's seen. None while paused.
const SHOOT_EVERY = [5, 12]; // seconds between them, at random in this range
const SHOOT_SPEED = 45, SHOOT_LIFE = 1.4, SHOOT_TAIL = 14; // units a second, seconds, tail length
const SHOOT_AWAY = 70; // how far out in front of the camera
const TAIL_GEOMETRY = new ConeGeometry(0.3, 1, 8, 1, true).translate(0, -0.5, 0); // tip at the head, along -y
const tailMaterial = (colour: string) =>
  new ShaderMaterial({
    uniforms: { uColour: { value: new Color(colour) }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      void main() {
        vAlong = -position.y; // 0 at the head, 1 at the end of the tail
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      uniform float uFade;
      varying float vAlong;
      void main() { gl_FragColor = vec4(uColour * pow(1.0 - vAlong, 2.0) * uFade * 1.6, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
function ShootingStar() {
  const group = useRef<Group>(null!);
  const { head, tail } = useMemo(
    () => ({ head: new MeshBasicMaterial({ color: '#fff4f8', toneMapped: false, transparent: true, depthWrite: false }), tail: tailMaterial(COLOURS[0]) }),
    [],
  );
  const s = useMemo(() => ({ wait: 3, age: Infinity, at: new Vector3(), vel: new Vector3(), q: new Quaternion(), rnd: rng(7) }), []);
  const right = useMemo(() => new Vector3(), []), up = useMemo(() => new Vector3(), []), ahead = useMemo(() => new Vector3(), []);
  const along = useMemo(() => new Vector3(0, 1, 0), []);
  useFrame(({ camera }, dt) => {
    const g = group.current;
    const live = motion() > 0;
    if (s.age > SHOOT_LIFE) {
      g.visible = false;
      if (!live) return;
      s.wait -= dt;
      if (s.wait > 0) return;
      // A new one: up in the view, off to one side, falling down and across towards the other side.
      const r = s.rnd, side = r() < 0.5 ? -1 : 1;
      camera.getWorldDirection(ahead);
      right.crossVectors(ahead, camera.up).normalize();
      up.crossVectors(right, ahead).normalize();
      s.at.copy(camera.position).addScaledVector(ahead, SHOOT_AWAY * (0.8 + r() * 0.4))
        .addScaledVector(right, side * SHOOT_AWAY * (0.1 + r() * 0.3))
        .addScaledVector(up, SHOOT_AWAY * (0.08 + r() * 0.14)); // inside the top of the view
      s.vel.copy(right).multiplyScalar(-side).addScaledVector(up, -(0.6 + r() * 0.5)).normalize().multiplyScalar(SHOOT_SPEED);
      s.q.setFromUnitVectors(along, s.vel.clone().normalize());
      tail.uniforms.uColour.value.set(COLOURS[Math.floor(r() * COLOURS.length)]);
      s.age = 0;
      s.wait = SHOOT_EVERY[0] + r() * (SHOOT_EVERY[1] - SHOOT_EVERY[0]);
    }
    s.age += dt;
    s.at.addScaledVector(s.vel, dt);
    g.visible = true;
    g.position.copy(s.at);
    g.quaternion.copy(s.q);
    // In and out: quickly bright, then burning away.
    const t = s.age / SHOOT_LIFE;
    head.opacity = tail.uniforms.uFade.value = Math.min(1, t * 6) * (1 - t * t);
  });
  return (
    <group ref={group} visible={false}>
      <mesh material={head}>
        <sphereGeometry args={[0.4, 12, 8]} />
      </mesh>
      <mesh geometry={TAIL_GEOMETRY} material={tail} scale={[1, SHOOT_TAIL, 1]} frustumCulled={false} />
    </group>
  );
}

export function Sky() {
  return (
    <>
      <ShootingStar />
      {KINDS.map((k, i) => (
        <Scatter key={i} kind={k} seed={101 + i * 17} />
      ))}
    </>
  );
}
