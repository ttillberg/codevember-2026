import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { clock } from './clock';
import { pickedNow, usePicked } from './selection';
import { planetPositions } from './world';
import { ORBIT_Y, planetAt, SUN } from './scale';
import { PLANETS } from './planets';

// How the picked planet is framed, read by the post processing: the distance to keep sharp, and how much the rest
// is blurred (0 none, 1 full), eased in and out with the flight.
export const focus = { distance: 30, amount: 0, depth: 1.5 };
// How far each planet reaches out from its middle (rings, clumps of moons), so the depth of field is opened up to
// keep all of it sharp.
const DEPTH: Record<string, number> = { Saturn: 3, Jupiter: 2, Uranus: 2.4, Neptune: 1.6 };
// Focusing on a planet always puts time into slow motion (days a second, the ×0.5 step); the speed from before
// comes back on the way home.
const FOCUS_SPEED = 0.4;

// How far out the camera circles each planet, bigger for the ones with rings or clumps of moons round them.
const VIEW: Record<string, number> = { Jupiter: 10, Saturn: 12, Uranus: 10, Neptune: 8.5 };
const DEFAULT_VIEW = 8.5;
const HOME_TARGET = SUN;
// The default view: low, just outside the furthest planet and a little to its right and above, looking in past the
// sun, so the furthest one sits big in the bottom left corner and the rest of the system fills the screen behind it.
// Worked out from where that planet is now, so it moves with it.
const FURTHEST = 'Neptune';
const HOME_BACK = 13, HOME_RIGHT = 6.5, HOME_UP = 6; // from the furthest planet
const HOME_LOOK_RIGHT = 4, HOME_LOOK_DOWN = 2; // where it looks, from the sun
const homeOut = new Vector3(), homeRight = new Vector3(), homeFrom = new Vector3();
const FURTHEST_PLANET = PLANETS.find((p) => p.name === FURTHEST)!;
function homeView(position: Vector3, target: Vector3) {
  // Where the planet is, or (still loading) where its orbit puts it, so the view is right from the first frame.
  const far = planetPositions.get(FURTHEST) ?? planetAt(FURTHEST_PLANET, clock.jd, homeFrom);
  homeOut.set(far.x, 0, far.z).normalize();
  homeRight.set(-homeOut.z, 0, homeOut.x).negate(); // to the right, looking in towards the sun
  position.copy(far).addScaledVector(homeOut, HOME_BACK).addScaledVector(homeRight, HOME_RIGHT);
  position.y += HOME_UP;
  target.set(0, ORBIT_Y - HOME_LOOK_DOWN, 0).addScaledVector(homeRight, HOME_LOOK_RIGHT);
  return true;
}
const home = new Vector3(), homeTarget = new Vector3();
const UP = new Vector3(0, 1, 0);
// The camera sits out beyond the planet, looking in past it at the sun, swung this far round to one side (radians)
const FLY = 2.2; // per second: how quickly the camera closes on where it's going
// Flying to a newly picked planet: slowly, rising first, then across and down onto it. Seconds for the trip (longer
// the further it goes), and how high it climbs for a given distance.
const TRIP_MIN = 3, TRIP_MAX = 6, TRIP_PER_UNIT = 0.08;
const LIFT = 0.35, LIFT_MIN = 3;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Left at the default view, the camera starts a slow orbit round the sun after this many seconds.
const ORBIT_AFTER = 3;
export const ORBIT_SPEED = 0.25; // the orbit controls' auto rotate speed: a full turn in about four minutes

// Picking a planet flies the camera out to it and follows it along its orbit, from a little behind and above;
// unpicking flies it home to the default view. While it's away the orbit controls are off, and they're handed back
// once it's home.
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
      if (!drag.down || !pickedNow()) return;
      drag.yaw -= (e.clientX - drag.x) * 0.006;
      drag.pitch = Math.min(1.35, Math.max(-0.5, drag.pitch + (e.clientY - drag.y) * 0.005));
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = () => (drag.down = false);
    el.addEventListener('pointerdown', down);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return () => (
      el.removeEventListener('pointerdown', down),
      removeEventListener('pointermove', move),
      removeEventListener('pointerup', up)
    );
  }, [gl, drag]);
  const s = useMemo(() => ({ target: HOME_TARGET.clone(), want: new Vector3(), out: new Vector3(), following: null as string | null, away: false, speed: 30, started: false, home: performance.now(), from: new Vector3(), lookFrom: new Vector3(), trip: { start: 0, time: 0, lift: 0 } }), []);

  useFrame((_, dt) => {
    const orbit = controls as unknown as { enabled: boolean; autoRotate: boolean; target: Vector3; update: () => void } | undefined;
    if (orbit && (picked || s.away)) orbit.autoRotate = false; // the rig flies the camera then
    // On the first frame the planets are placed, start at the default view.
    if (!s.started && homeView(home, homeTarget)) {
      s.started = true;
      camera.position.copy(home);
      camera.lookAt(homeTarget);
      if (orbit) {
        orbit.target.copy(homeTarget);
        orbit.update();
      }
      s.home = performance.now();
    }
    const close = 1 - Math.exp(-dt * FLY);
    const p = picked ? planetPositions.get(picked) : undefined;
    if (picked && p) {
      camera.up.copy(UP);
      if (s.following !== picked) {
        // Look from wherever the camera is aiming now, so it swings across rather than jumping; into slow motion,
        // remembering how fast it was.
        if (!s.away && orbit) s.target.copy(orbit.target);
        // The trip starts from here, aiming from what it's looking at now.
        const far = camera.position.distanceTo(p);
        s.from.copy(camera.position);
        s.lookFrom.copy(s.target);
        s.trip.start = performance.now();
        s.trip.time = Math.min(TRIP_MAX, TRIP_MIN + far * TRIP_PER_UNIT);
        s.trip.lift = Math.max(LIFT_MIN, far * LIFT);
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
      // Behind it along the way it's going (its orbit runs anticlockwise seen from above: the sun-out direction
      // turned a quarter), a little up, then wherever a drag has swung it round to.
      const a = Math.atan2(s.out.z, s.out.x) - Math.PI / 2 - 0.25 + drag.yaw;
      const up = Math.atan2(0.35, 0.9) + drag.pitch, d = r * Math.hypot(0.9, 0.35);
      s.want.set(p.x + Math.cos(a) * Math.cos(up) * d, p.y + Math.sin(up) * d, p.z + Math.sin(a) * Math.cos(up) * d);
      const u = (performance.now() - s.trip.start) / 1000 / s.trip.time;
      if (u < 1) {
        // Up first, then across and down: the climb peaks early, and the move across only gets going once it's up.
        camera.position.lerpVectors(s.from, s.want, ease((u - 0.2) / 0.8));
        camera.position.y += s.trip.lift * Math.sin(Math.PI * Math.pow(u, 0.6));
        s.target.lerpVectors(s.lookFrom, p, ease(u * 1.25));
      } else {
        camera.position.lerp(s.want, close);
        s.target.lerp(p, 1 - Math.exp(-dt * FLY * 2));
      }
      camera.lookAt(s.target);
      orbit?.target.copy(s.target);
      focus.distance = camera.position.distanceTo(p);
      focus.depth = DEPTH[picked] ?? 1.5;
      focus.amount += (1 - focus.amount) * close;
    } else if (s.away) {
      if (s.following) clock.speed = s.speed; // back to how fast it was going
      s.following = null;
      homeView(home, homeTarget);
      camera.position.lerp(home, close);
      s.target.lerp(homeTarget, close);
      camera.lookAt(s.target);
      orbit?.target.copy(s.target);
      focus.amount *= 1 - close * 2;
      if (camera.position.distanceTo(home) < 0.2) {
        camera.position.copy(home);
        s.away = false;
        focus.amount = 0;
        if (orbit) {
          orbit.target.copy(homeTarget);
          orbit.enabled = true;
          orbit.update();
        }
        s.home = performance.now(); // a moment at home before the slow orbit starts
      }
    } else if (orbit) {
      // At the default view: after a few seconds, a slow orbit round the sun, still facing it. A drag takes over
      // for as long as it lasts; the orbit carries on after.
      orbit.autoRotate = (performance.now() - s.home) / 1000 > ORBIT_AFTER;
    }
  });
  return null;
}
