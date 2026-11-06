import { useLayoutEffect, useMemo, useRef } from "react";
import {
  CapsuleCollider,
  InstancedRigidBodies,
  RigidBody,
  RoundCylinderCollider,
  TrimeshCollider,
  type InstancedRigidBodyProps,
} from "@react-three/rapier";
import { Color, DoubleSide, InstancedMesh, LatheGeometry, MeshPhysicalMaterial, SphereGeometry, Vector2 } from "three";
import { BEAN_CAPSULE, beanGeometry } from "./Beans";
import SEA from "./sea.json";

// A glass ball, its lower half filled with a flat sea of Smarties-like sweets and jelly beans. The heap was settled
// once with a physics run (Rapier, rounded disc colliders, low friction so it levelled out, in a bowl the shape of
// the ball's lower half) and its resting poses saved to sea.json, each entry [x, y, z, qx, qy, qz, qw, colour]. Here
// it is fixed: it never moves, it is only a floor. A few loose sweets rain down from the top of the ball, bounce off
// the planets circling through the middle and land on it.
const SWEET_RADIUS = 1.3; // a flattened sphere, a lentil
const SWEET_HALF_HEIGHT = 0.5;
// The sweets were settled in a bowl cut from a sphere: 28 wide at a rim 20 above its bottom. The ball is that whole
// sphere, so the heap still sits snug in its lower half.
const BOWL_RADIUS = 28;
const BOWL_DEPTH = 20;
const BOTTOM = -17;
const WALL = 1.2; // glass thickness
const SPHERE = (BOWL_RADIUS ** 2 + BOWL_DEPTH ** 2) / (2 * BOWL_DEPTH);

type Pose = [number, number, number, number, number, number, number, string];
const POSES = SEA as Pose[];
// Pastel: each saved colour mixed this far towards white (in linear light, so the mid tones lift gently).
const PASTEL = 0.22;
const WHITE = new Color(1, 1, 1);

// Jelly beans mixed in: about one sweet in BEANS takes a jelly bean's place, at the same resting pose. A bean a
// little longer than a Smartie is wide and flattened a touch, so it lies in the heap like the lentil it replaces.
const BEANS = 0.25;
const BEAN_LENGTH = 3.4;
const BEAN_FLAT = 0.75;
const BEAN_PALETTE = ["#c8102e", "#f26b1d", "#9bc53d", "#6b3e26", "#1f5fbf", "#f4a6b7", "#f3e6c8", "#c9b040", "#7a1022", "#ff9e1b"];
// Stable per sweet pseudo random in [0, 1), so the mix is the same every load.
const pick = (i: number, salt: number) => (((i + 1) * 2654435761 + salt * 40503) % 4294967296) / 4294967296;
const IS_BEAN = POSES.map((_, i) => pick(i, 1) < BEANS);
const LENTIL_PALETTE = ["#e3001b", "#ff7a00", "#ffd200", "#3aa935", "#0072ce", "#f06eaa", "#7b3fa0", "#6b3a1e"];
const SHOW_SEA = false;
const SHOW_GLASS = false; // the ball still holds the sweets in, only its glass is hidden
const LOOSE_BEAN_COUNT = 0; // loose jelly beans falling in from the top, none for now
const LOOSE_LENTIL_COUNT = 0; // and loose Smarties, none for now
const SWEET_ROUND = 0.35; // the lentil collider's rounded edge

const SEA_BEANS: InstancedRigidBodyProps[] = [];
const SEA_LENTILS: InstancedRigidBodyProps[] = [];
const SEA_BEAN_COLOURS: string[] = [];
const SEA_LENTIL_COLOURS: string[] = [];
POSES.forEach(([x, y, z, qx, qy, qz, qw, colour], i) => {
  const body = { key: i, position: [x, y, z] as [number, number, number], quaternion: [qx, qy, qz, qw] as [number, number, number, number] };
  if (IS_BEAN[i]) {
    SEA_BEANS.push(body);
    SEA_BEAN_COLOURS.push(BEAN_PALETTE[Math.floor(pick(i, 2) * BEAN_PALETTE.length)]);
  } else {
    SEA_LENTILS.push(body);
    SEA_LENTIL_COLOURS.push(colour);
  }
});

// The loose ones start in a loose block high in the ball, alternating bean and lentil, apart enough not to overlap.
const LOOSE_BEANS: InstancedRigidBodyProps[] = [];
const LOOSE_LENTILS: InstancedRigidBodyProps[] = [];
const LOOSE_BEAN_COLOURS: string[] = [];
const LOOSE_LENTIL_COLOURS: string[] = [];
for (let k = 0; LOOSE_BEANS.length + LOOSE_LENTILS.length < LOOSE_BEAN_COUNT + LOOSE_LENTIL_COUNT; k++) {
  const x = ((k % 6) - 2.5) * 4.6, z = ((Math.floor(k / 6) % 6) - 2.5) * 4.6, y = 26 + Math.floor(k / 36) * 4.6;
  const rotation = [pick(k, 3) * 3, pick(k, 4) * 6.3, pick(k, 5) * 3] as [number, number, number];
  const lentil = k % 2 === 1 && LOOSE_LENTILS.length < LOOSE_LENTIL_COUNT;
  const list = lentil ? LOOSE_LENTILS : LOOSE_BEANS;
  if (!lentil && LOOSE_BEANS.length >= LOOSE_BEAN_COUNT) continue;
  list.push({ key: k, position: [x, y, z], rotation });
  if (lentil) LOOSE_LENTIL_COLOURS.push(LENTIL_PALETTE[Math.floor(pick(k, 6) * LENTIL_PALETTE.length)]);
  else LOOSE_BEAN_COLOURS.push(BEAN_PALETTE[Math.floor(pick(k, 6) * BEAN_PALETTE.length)]);
}

// Glossy candy shell. Fake subsurface scattering: the sweet glows a little in its own, deepened colour, most at the
// thin grazing edges.
function candy() {
  const m = new MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `#include <emissivemap_fragment>
  float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * (0.18 + 0.9 * edge);`,
    );
  };
  return m;
}

// One kind of sweet as instanced rigid bodies: fixed for the settled sea, dynamic for the loose ones.
function Sweets({
  kind,
  instances,
  colours,
  fixed,
}: {
  kind: "bean" | "lentil";
  instances: InstancedRigidBodyProps[];
  colours: string[];
  fixed?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null!);
  const { geometry, material } = useMemo(
    () => ({
      geometry:
        kind === "bean"
          ? beanGeometry(32, 20).scale(BEAN_LENGTH, BEAN_LENGTH * BEAN_FLAT, BEAN_LENGTH)
          : new SphereGeometry(1, 32, 16).scale(SWEET_RADIUS, SWEET_HALF_HEIGHT, SWEET_RADIUS),
      material: candy(),
    }),
    [kind],
  );
  useLayoutEffect(() => {
    const c = new Color();
    colours.forEach((colour, i) => mesh.current.setColorAt(i, c.set(colour).lerp(WHITE, PASTEL)));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [colours]);
  const collider =
    kind === "bean" ? (
      // A capsule along the bean, squashed a little in height like the bean itself.
      <CapsuleCollider
        args={[BEAN_CAPSULE.half * BEAN_LENGTH, BEAN_CAPSULE.radius * BEAN_LENGTH * BEAN_FLAT]}
        position={[0, BEAN_CAPSULE.lift * BEAN_LENGTH * BEAN_FLAT, 0]}
        rotation={[0, 0, Math.PI / 2]}
        friction={0.3}
        restitution={0.2}
      />
    ) : (
      // A rounded disc, close to the lentil's shape.
      <RoundCylinderCollider
        args={[SWEET_HALF_HEIGHT - SWEET_ROUND, SWEET_RADIUS - SWEET_ROUND, SWEET_ROUND]}
        friction={0.3}
        restitution={0.2}
      />
    );
  return (
    <InstancedRigidBodies
      instances={instances}
      type={fixed ? "fixed" : "dynamic"}
      colliders={false}
      colliderNodes={[collider]}
      linearDamping={0.2}
      angularDamping={0.4}
    >
      <instancedMesh ref={mesh} args={[geometry, material, instances.length]} castShadow={!fixed} receiveShadow frustumCulled={false} />
    </InstancedRigidBodies>
  );
}

export function Sea() {
  return (
    <>
      {/* The settled sea from sea.json, hidden for now. */}
      {SHOW_SEA && <Sweets kind="lentil" instances={SEA_LENTILS} colours={SEA_LENTIL_COLOURS} fixed />}
      {SHOW_SEA && <Sweets kind="bean" instances={SEA_BEANS} colours={SEA_BEAN_COLOURS} fixed />}
      {LOOSE_LENTIL_COUNT > 0 && <Sweets kind="lentil" instances={LOOSE_LENTILS} colours={LOOSE_LENTIL_COLOURS} />}
      {LOOSE_BEAN_COUNT > 0 && <Sweets kind="bean" instances={LOOSE_BEANS} colours={LOOSE_BEAN_COLOURS} />}
      <Ball />
    </>
  );
}

// The ball: clear glass, turned on a lathe. The whole sphere the old bowl's inside was cut from, closed over the
// top, its outside a wall's thickness out, standing on the same foot ring underneath.
function Ball() {
  const { geometry, vertices, indices } = useMemo(() => {
    const profile: Vector2[] = [];
    const n = 128;
    const centre = BOTTOM + SPHERE, outer = SPHERE + WALL, foot = BOWL_RADIUS * 0.4;
    // Inside, from the bottom pole up over the top.
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      profile.push(new Vector2(Math.max(SPHERE * Math.cos(a), 0.001), centre + SPHERE * Math.sin(a)));
    }
    // Outside, from the top back down to where the foot ring meets it.
    const low = -Math.acos(foot / outer);
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (i / n) * (low - Math.PI / 2);
      profile.push(new Vector2(Math.max(outer * Math.cos(a), 0.001), centre + outer * Math.sin(a)));
    }
    const footY = centre - Math.sqrt(outer * outer - foot * foot) - 1.5;
    profile.push(new Vector2(foot, footY), new Vector2(foot - 1, footY), new Vector2(0.001, footY + 0.6));
    const g = new LatheGeometry(profile, 128);
    g.computeVertexNormals();
    // Collider: just the inside, as a lathe of its own, so loose sweets bounce off the glass.
    const inside = new LatheGeometry(profile.slice(0, n + 1), 48);
    return {
      geometry: g,
      vertices: new Float32Array(inside.attributes.position.array),
      indices: new Uint32Array(inside.index!.array),
    };
  }, []);
  return (
    <RigidBody type="fixed" colliders={false}>
      <TrimeshCollider args={[vertices, indices]} friction={0.3} />
      {/* Clear glass: it lets the light through, so it casts no shadow. */}
      <mesh geometry={geometry} visible={SHOW_GLASS}>
      <meshPhysicalMaterial
        color="#ffffff"
        transmission={1}
        roughness={0.04}
        thickness={WALL}
        ior={1.5}
        attenuationColor="#e6f4f1"
        attenuationDistance={12}
        specularIntensity={1}
        side={DoubleSide}
      />
      </mesh>
    </RigidBody>
  );
}
