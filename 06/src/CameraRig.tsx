import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { clock } from './clock';
import { pickedNow, usePicked } from './selection';
import { planetPositions } from './world';

// How the picked planet is framed, read by the post processing: the distance to keep sharp, and how much the rest
// is blurred (0 none, 1 full), eased in and out with the flight.
export const focus = { distance: 30, amount: 0 };
// While a planet is in focus time slows down to this (days a second), so following one, Mercury above all, doesn't
// swing the camera round dizzyingly; the speed from before comes back on the way home.
export const FOCUS_SPEED = 3;

// How far out the camera circles each planet, bigger for the ones with rings or clumps of moons round them.
const VIEW: Record<string, number> = { Jupiter: 15, Saturn: 19, Uranus: 15, Neptune: 12 };
const DEFAULT_VIEW = 8.5;
const HOME = new Vector3(0, 85, 0.001);
const HOME_TARGET = new Vector3(0, 12.6, 0);
const SUN = new Vector3(0, 12.6, 0);
// The camera sits out beyond the planet, looking in past it at the sun, swung this far round to one side (radians)
// so a crescent of the planet's lit side shows, and raised a little.
const SWING = 0.45;
const RAISE = 0.3;
const FLY = 2.2; // per second: how quickly the camera closes on where it's going

// Ways of looking at the picked planet: from beyond it facing the sun, from the sun's side looking out at it,
// chasing it from behind along its orbit (the default), or from straight above. Keys 1 to 4 switch, for testing.
export const MODES = ['Facing sun', 'From sun', 'Follow', 'Above'] as const;
export type Mode = (typeof MODES)[number];
export const cameraMode = { value: 'Follow' as Mode };

// Picking a planet flies the camera out to it, behind it as seen from the sun, so the camera always faces the sun
// with the planet in front of it, following it along its orbit; unpicking flies it home to the view straight down. While it's away the orbit controls are off, and they're handed back once it's home.
export function CameraRig() {
  const picked = usePicked();
  const { camera, controls, gl } = useThree();
  // Following, a drag turns the camera round the planet (sideways) and up or down over it; it then keeps that
  // angle to the planet's heading as it follows. Reset when another planet is picked.
  const drag = useMemo(() => ({ yaw: 0, pitch: 0, down: false, x: 0, y: 0 }), []);
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => ((drag.down = true), (drag.x = e.clientX), (drag.y = e.clientY));
    const move = (e: PointerEvent) => {
      if (!drag.down || !pickedNow() || cameraMode.value !== 'Follow') return;
      drag.yaw -= (e.clientX - drag.x) * 0.006;
      drag.pitch = Math.min(1.35, Math.max(-0.5, drag.pitch + (e.clientY - drag.y) * 0.005));
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = () => (drag.down = false);
    el.addEventListener('pointerdown', down);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return () => (el.removeEventListener('pointerdown', down), removeEventListener('pointermove', move), removeEventListener('pointerup', up));
  }, [gl, drag]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < MODES.length) cameraMode.value = MODES[i];
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const s = useMemo(() => ({ target: HOME_TARGET.clone(), want: new Vector3(), out: new Vector3(), following: null as string | null, away: false, speed: 30 }), []);

  useFrame((_, dt) => {
    const orbit = controls as unknown as { enabled: boolean; target: Vector3; update: () => void } | undefined;
    const close = 1 - Math.exp(-dt * FLY);
    const p = picked ? planetPositions.get(picked) : undefined;
    if (picked && p) {
      if (s.following !== picked) {
        // Look from wherever the camera is aiming now, so it swings across rather than jumping; slow time down,
        // remembering how fast it was.
        if (!s.away && orbit) s.target.copy(orbit.target);
        if (!s.following) {
          s.speed = clock.speed;
          clock.speed = FOCUS_SPEED;
        }
        s.following = picked;
        s.away = true;
        drag.yaw = drag.pitch = 0;
      }
      if (orbit) orbit.enabled = false;
      const r = VIEW[picked] ?? DEFAULT_VIEW;
      s.out.set(p.x - SUN.x, 0, p.z - SUN.z).normalize();
      const mode = cameraMode.value;
      if (mode === 'Above') {
        s.want.set(p.x, p.y + r * 1.3, p.z + 0.001);
      } else if (mode === 'Follow') {
        // Behind it along the way it's going (its orbit runs anticlockwise seen from above: the sun-out direction
        // turned a quarter), a little up, then wherever a drag has swung it round to.
        const a = Math.atan2(s.out.z, s.out.x) - Math.PI / 2 - 0.25 + drag.yaw;
        const up = Math.atan2(0.35, 0.9) + drag.pitch, d = r * Math.hypot(0.9, 0.35);
        s.want.set(p.x + Math.cos(a) * Math.cos(up) * d, p.y + Math.sin(up) * d, p.z + Math.sin(a) * Math.cos(up) * d);
      } else {
        // Out from the sun through the planet (or, from the sun's side, back in towards it), in the orbits' plane,
        // swung a little round and lifted.
        const a = Math.atan2(s.out.z, s.out.x) + SWING + (mode === 'From sun' ? Math.PI : 0);
        s.want.set(p.x + Math.cos(a) * r, p.y + r * RAISE, p.z + Math.sin(a) * r);
      }
      camera.position.lerp(s.want, close);
      s.target.lerp(p, 1 - Math.exp(-dt * FLY * 2));
      camera.lookAt(s.target);
      orbit?.target.copy(s.target);
      focus.distance = camera.position.distanceTo(p);
      focus.amount += (1 - focus.amount) * close;
    } else if (s.away) {
      if (s.following) {
        clock.speed = s.speed; // back to how fast it was going
        s.following = null;
      }
      camera.position.lerp(HOME, close);
      s.target.lerp(HOME_TARGET, close);
      camera.lookAt(s.target);
      orbit?.target.copy(s.target);
      focus.amount *= 1 - close * 2;
      if (camera.position.distanceTo(HOME) < 0.2) {
        camera.position.copy(HOME);
        s.away = false;
        focus.amount = 0;
        if (orbit) {
          orbit.target.copy(HOME_TARGET);
          orbit.enabled = true;
          orbit.update();
        }
      }
    }
  });
  return null;
}
