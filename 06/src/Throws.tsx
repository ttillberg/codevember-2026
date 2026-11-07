import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BallCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { MeshPhysicalMaterial, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { clock, daysPerSecond } from './clock';
import { PLANETS } from './planets';
import { planetAt } from './scale';
import { planetPositions } from './world';

// Cmd (or ctrl) click (a click, not a drag) throws a gumball, hard, from the camera the way you clicked. Pointing near a
// planet, it leads that planet, aiming where it will be when the gumball gets there. Heavy, so a hit knocks the
// planet off its track for a while; gone after a few seconds.
const SPEED = 60; // scene units a second
const CLICK = 6; // pixels: moved further than this between press and release, it's a drag, not a throw
const RADIUS = 0.28;
const LIFE = 6; // seconds
const AIM = 3.5; // how near the ray a planet must be to be aimed at
const COLOURS = ['#f29aa8', '#f08a7e', '#f5a04e', '#f2cc66', '#a9bde8', '#9fc7a8', '#f7b6c8'];
const GEOMETRY = new SphereGeometry(RADIUS, 24, 16);
const MATERIALS = COLOURS.map((c) => new MeshPhysicalMaterial({ color: c, roughness: 0.3, clearcoat: 0.75, emissive: c, emissiveIntensity: 0.25 }));

type Throw = { id: number; from: Vector3; vel: Vector3; colour: number };
let ids = 0;

// A click that's a throw rather than a pick: with cmd (or ctrl) held.
export const isThrowClick = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

export function Throws() {
  const { camera, gl } = useThree();
  const [throws, setThrows] = useState<Throw[]>([]);
  const ray = useMemo(() => new Raycaster(), []);
  useEffect(() => {
    const el = gl.domElement, ndc = new Vector2(), to = new Vector3(), at = new Vector3(), press = { x: 0, y: 0, on: false };
    const down = (e: PointerEvent) => void ((press.on = e.button === 0 && isThrowClick(e)), (press.x = e.clientX), (press.y = e.clientY));
    const up = (e: PointerEvent) => {
      if (!press.on || !isThrowClick(e) || Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK) return;
      press.on = false;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const from = camera.position.clone().addScaledVector(ray.ray.direction, 1.5);
      let dir = ray.ray.direction.clone();
      // The planet nearest the ray, if near enough: lead it.
      let best = AIM;
      for (const p of PLANETS) {
        const now = planetPositions.get(p.name);
        if (!now) continue;
        const miss = ray.ray.distanceToPoint(now);
        if (miss >= best) continue;
        best = miss;
        let t = from.distanceTo(now) / SPEED;
        for (let i = 0; i < 3; i++) {
          planetAt(p, clock.jd + t * daysPerSecond(), at);
          t = from.distanceTo(at) / SPEED;
        }
        dir = to.subVectors(at, from).normalize().clone();
      }
      setThrows((list) => [...list.slice(-12), { id: ids++, from, vel: dir.multiplyScalar(SPEED), colour: ids % COLOURS.length }]);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => (el.removeEventListener('pointerdown', down), el.removeEventListener('pointerup', up));
  }, [gl, camera, ray]);
  return (
    <>
      {throws.map((t) => (
        <Gumball key={t.id} t={t} done={() => setThrows((list) => list.filter((x) => x.id !== t.id))} />
      ))}
    </>
  );
}

function Gumball({ t, done }: { t: Throw; done: () => void }) {
  const body = useRef<RapierRigidBody>(null!);
  const life = useRef(0);
  useEffect(() => body.current?.setLinvel(t.vel, true), [t]);
  useFrame((_, dt) => {
    life.current += dt;
    if (life.current > LIFE) done();
  });
  return (
    <RigidBody ref={body} position={t.from.toArray()} gravityScale={0} colliders={false} linearDamping={0.05} ccd>
      <BallCollider args={[RADIUS]} density={900} restitution={0.7} />
      <mesh geometry={GEOMETRY} material={MATERIALS[t.colour]} />
    </RigidBody>
  );
}
