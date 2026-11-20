import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Cable } from './cables';
import { Blood } from './blood';

// A pod hanging in a hall. The model comes from Blender (model/cocoon.blend → public/cocoon.glb) and says by
// name what is what:
//   pod          the body, everything that swings is its child
//   door         child of pod, origin on the hinge, hinge along its local Z (Blender)
//   plug.NNN     empties on the pod, local Z the way the cable leaves; custom props radius, slack
//   socket.NNN   empties in the ceiling, one per plug
//   hang         empty, the point the whole thing swings from
//   drip.NNN     empties where it bleeds
// Nothing here knows the shape of the pod: remodel it, keep the names.

const query = new URLSearchParams(location.search);
// ?clean: no page furniture, the scene alone (screengrabs, clips)
if (query.has('clean')) document.body.classList.add('clean');
// ?silk: the first take on the word, a silk cocoon spun from one thread
if (query.has('silk')) import('./silk');
else start();

function start() {
  const FOG = 0x565b60;
  const G = 9.8;
  const STEP = 1 / 120;

  const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.04);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  scene.add(new THREE.HemisphereLight(0xd4dbe0, 0x17191b, 1.3));
  const sky = new THREE.DirectionalLight(0xffffff, 2.4); // the skylights, high and behind
  sky.position.set(5, 10, -4);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200); // the debug panel's iso: same eye, no perspective
  let eye: THREE.Camera = camera;
  const target = new THREE.Vector3(0.1, 0.35, 0);
  const home = new THREE.Vector3(0.1, 0.35, 0); // where the target rests in the view people get
  const YAW0 = -0.3;
  const PITCH0 = -0.42;
  let yaw = YAW0;
  let pitch = PITCH0;
  let vyaw = 0;
  let vpitch = 0;
  let radius = 5.6;
  let homeRadius = 5.6;
  // a view the camera is easing to (the debug panel's), null while it is yours
  let goal: null | { yaw: number; pitch: number; radius: number; target: THREE.Vector3 } = null;
  let still = false; // the debug panel's hold still: no swing
  const podRest = new THREE.Quaternion(); // how the pod hangs, askew, as it comes from Blender

  // the hall, a stand-in: columns and beams going into the haze
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x131517, roughness: 0.9 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      scene.add(m);
    };
    for (let i = 0; i < 5; i++) {
      const z = -16 - i * 11;
      add(1.6, 90, 1.6, -13 - i * 1.5, 0, z);
      add(1.6, 90, 1.6, 12 + i * 2.5, 0, z);
      add(40 + i * 8, 0.9, 1.2, 0, 6 + i * 5, z);
      add(40 + i * 8, 0.6, 0.9, 0, -9 - i * 3, z + 3);
    }
  }

  // ---------- the pod: a pendulum under `hang`, with a twist of its own

  const swing = new THREE.Group(); // at the hang point, leans two ways
  const twist = new THREE.Group(); // at the pod, turns about the vertical
  swing.add(twist);
  scene.add(swing);
  let L = 8;
  let ax = 0; // lean about x: towards and away from the eye
  let az = 0.04; // lean about z: left and right
  let tw = 0;
  let vax = 0;
  let vaz = 0;
  let vtw = 0.03;

  let pod: THREE.Object3D | null = null;
  const podInverse = new THREE.Matrix4();
  const podCentre = new THREE.Vector3();
  const podRadii = new THREE.Vector3(1, 1, 1);

  // the door: a plate on a hinge under gravity, in a pod that swings, with a strut that pulls it to. It cannot quite shut.
  const AJAR = 0.06; // as shut as it gets
  const WIDE = 1.9;
  const STICK = 0.5; // rad/s² the hinge holds against
  const STRUT = 7; // rad/s² per radian open, the pull back to
  let door: THREE.Object3D | null = null;
  const doorRest = new THREE.Quaternion();
  const doorCom = new THREE.Vector3(); // door local
  let doorSign = 1; // which way round the hinge is open
  let doorArm2 = 0.2; // (distance of its centre from the hinge) squared
  let open = 0.08;
  let vopen = 0;
  const hinge = new THREE.Vector3();
  const hingeWas = new THREE.Vector3();
  const hingeVel = new THREE.Vector3();
  const hingeAcc = new THREE.Vector3();
  let hingeKnown = false;

  const cables: Cable[] = [];
  let blood: Blood | null = null;
  const inside = new THREE.PointLight(0xff2410, 1.6, 1.3, 2);

  const Y = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();

  /** bounds of everything under `root`, in root's own space */
  function localBox(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
    });
    return box;
  }

  function setDoor() {
    if (!door) return;
    door.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, doorSign * open));
  }

  new GLTFLoader().load(`${import.meta.env.BASE_URL}cocoon.glb`, (gltf) => {
    const root = gltf.scene;
    scene.add(root);
    root.updateWorldMatrix(true, true);
    const named = (re: RegExp) => {
      const out: THREE.Object3D[] = [];
      root.traverse((o) => re.test(o.name) && out.push(o));
      return out.sort((a, b) => a.name.localeCompare(b.name));
    };
    pod = root.getObjectByName('pod')!;
    door = root.getObjectByName('door') ?? null;
    const hang = root.getObjectByName('hang');
    const plugs = named(/^plug[._]?\d+$/);
    const sockets = named(/^socket[._]?\d+$/);
    const drips = named(/^drip[._]?\d+$/);

    const box = localBox(pod);
    box.getCenter(podCentre);
    box.getSize(podRadii).multiplyScalar(0.5 * 1.04).addScalar(0.07);

    // hang the pod: swing at the hang point, twist at the pod, the pod keeps its place and its tilt
    const at = pod.getWorldPosition(new THREE.Vector3());
    if (hang) hang.getWorldPosition(swing.position);
    else swing.position.set(at.x, at.y + 8, at.z);
    L = swing.position.distanceTo(at);
    twist.position.copy(at).sub(swing.position);
    swing.updateWorldMatrix(true, true);
    twist.attach(pod);
    podRest.copy(pod.quaternion);
    inside.position.copy(podCentre);
    pod.add(inside);

    if (door) {
      doorRest.copy(door.quaternion);
      localBox(door).getCenter(doorCom);
      doorArm2 = Math.max(0.01, doorCom.x * doorCom.x + doorCom.z * doorCom.z);
      // open is the way that takes the door away from the pod
      const far = (sign: number) => {
        door!.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, sign * 0.4));
        door!.updateWorldMatrix(true, false);
        return v1.copy(doorCom).applyMatrix4(door!.matrixWorld).distanceTo(v2.copy(podCentre).applyMatrix4(pod!.matrixWorld));
      };
      doorSign = far(1) > far(-1) ? 1 : -1;
      setDoor();
    }

    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.5, metalness: 0.25 });
    plugs.forEach((plug, i) => {
      const socket = sockets[i];
      if (!socket) return;
      const cable = new Cable(socket.getWorldPosition(new THREE.Vector3()), plug, plug.userData.radius ?? 0.045, plug.userData.slack ?? 1.1, rubber);
      cables.push(cable);
      scene.add(cable.mesh);
    });
    blood = new Blood(drips);
    scene.add(blood.mesh);

    // let the cables fall into place before anyone looks
    for (let i = 0; i < 400; i++) physics(STEP, 0);
  });

  /** push a rope point out of the pod, taken as an ellipsoid */
  function collide(p: Float32Array, i: number) {
    v1.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(podInverse).sub(podCentre).divide(podRadii);
    const d = v1.lengthSq();
    if (d >= 1 || d < 1e-8) return;
    v1.divideScalar(Math.sqrt(d)).multiply(podRadii).add(podCentre).applyMatrix4(pod!.matrixWorld);
    p[i] = v1.x;
    p[i + 1] = v1.y;
    p[i + 2] = v1.z;
  }

  // ---------- hands

  type Grab = null | 'orbit' | 'pod' | 'door';
  let grab: Grab = null;
  let px = 0;
  let py = 0;
  let axTo = 0; // where the hand holds the pod
  let azTo = 0;
  let openTo = 0; // where the hand holds the door
  const doorPull = new THREE.Vector2(); // px on screen per radian of door, where it was grabbed
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const toScreen = (v: THREE.Vector3) => {
    v.project(eye);
    return new THREE.Vector2((v.x * 0.5 + 0.5) * canvas.clientWidth, (-v.y * 0.5 + 0.5) * canvas.clientHeight);
  };

  canvas.addEventListener('pointerdown', (e) => {
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    grab = 'orbit';
    if (!pod) return;
    goal = null;
    ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, eye);
    const hit = ray.intersectObject(pod, true)[0];
    if (!hit) return;
    let o: THREE.Object3D | null = hit.object;
    while (o && o !== door) o = o.parent;
    if (o && door) {
      // how the grabbed point moves on screen as the door opens: drag along that
      grab = 'door';
      openTo = open;
      const local = door.worldToLocal(hit.point.clone());
      const a = toScreen(hit.point.clone());
      door.quaternion.copy(doorRest).multiply(q.setFromAxisAngle(Y, doorSign * (open + 0.05)));
      door.updateWorldMatrix(false, false);
      const b = toScreen(local.applyMatrix4(door.matrixWorld));
      setDoor();
      door.updateWorldMatrix(false, true);
      doorPull.subVectors(b, a).divideScalar(0.05);
      if (doorPull.length() < 60) doorPull.setLength(60);
    } else {
      grab = 'pod';
      axTo = ax;
      azTo = az;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    if (grab === 'orbit') {
      vyaw = -dx * 0.004;
      vpitch = -dy * 0.004;
      yaw += vyaw;
      pitch += vpitch;
    } else if (grab === 'pod') {
      // the drag as a push in the world: sideways along the screen, down the screen is towards the eye
      const wpp = (2 * radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
      const wx = (Math.cos(yaw) * dx + Math.sin(yaw) * dy) * wpp;
      const wz = (-Math.sin(yaw) * dx + Math.cos(yaw) * dy) * wpp;
      azTo = THREE.MathUtils.clamp(azTo + wx / L, -0.3, 0.3);
      axTo = THREE.MathUtils.clamp(axTo - wz / L, -0.3, 0.3);
    } else if (grab === 'door') {
      openTo = THREE.MathUtils.clamp(openTo + (dx * doorPull.x + dy * doorPull.y) / doorPull.lengthSq(), AJAR, WIDE);
    }
  });
  const release = () => (grab = null);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // dev only: a look at the state from the console
  if (import.meta.env.DEV) Object.assign(window, { cocoon: () => ({ grab, open, vopen, ax, az, tw, doorSign, cables: cables.length }), scene, camera });

  // ---------- physics, in fixed steps

  function physics(h: number, time: number) {
    if (!pod) return;
    const w2 = G / L;
    if (still && grab !== 'pod') {
      ax = az = tw = vax = vaz = vtw = 0;
    } else if (grab === 'pod') {
      // the hand: a stiff, dead-beat spring
      vax += (140 * (axTo - ax) - 24 * vax) * h;
      vaz += (140 * (azTo - az) - 24 * vaz) * h;
    } else {
      // free: gravity, a little loss, and the air of the hall never quite still
      vax += (-w2 * ax - 0.12 * vax + 0.004 * Math.sin(time * 0.47 + 2)) * h;
      vaz += (-w2 * az - 0.12 * vaz + 0.005 * Math.sin(time * 0.31) + 0.003 * Math.sin(time * 0.73 + 1)) * h;
    }
    vtw += (-0.3 * tw - 0.15 * vtw + 0.004 * Math.sin(time * 0.19) - 0.5 * vaz * vax) * h;
    ax += vax * h;
    az += vaz * h;
    tw += vtw * h;
    swing.rotation.set(ax, 0, az);
    twist.rotation.y = tw;
    swing.updateMatrixWorld(true);
    podInverse.copy(pod.matrixWorld).invert();

    if (door) {
      // gravity as the door feels it: less whatever the hinge is being thrown about with
      door.getWorldPosition(hinge);
      if (hingeKnown) {
        v1.subVectors(hinge, hingeWas).divideScalar(h);
        v2.subVectors(v1, hingeVel).divideScalar(h);
        hingeVel.copy(v1);
        hingeAcc.lerp(v2, 0.15);
      }
      hingeWas.copy(hinge);
      hingeKnown = true;
      if (grab === 'door') {
        vopen += (220 * (openTo - open) - 30 * vopen) * h;
      } else {
        v1.copy(doorCom).applyMatrix4(door.matrixWorld).sub(hinge); // arm
        v2.set(0, -G, 0).sub(hingeAcc); // pull
        v3.set(0, 1, 0).transformDirection(door.matrixWorld); // hinge
        // gravity and the swing throw it about, a tired strut pulls it to: whichever way the pod hangs it
        // comes to rest nearly shut
        const pull = doorSign * v1.cross(v2).dot(v3) * (3 / (4 * doorArm2)) * 0.35 - STRUT * (open - AJAR);
        // a dry hinge: it stays where it is left until the pull is more than the hinge holds, and drags while it moves
        if (Math.abs(vopen) < 0.02 && Math.abs(pull) < STICK) vopen = 0;
        else vopen += (pull - Math.sign(vopen || pull) * STICK * 0.6 - 0.6 * vopen) * h;
      }
      open += vopen * h;
      if (open < AJAR) {
        open = AJAR;
        vopen = Math.abs(vopen) * 0.25; // it knocks, it does not latch
      } else if (open > WIDE) {
        open = WIDE;
        vopen = -Math.abs(vopen) * 0.2;
      }
      setDoor();
      door.updateMatrixWorld(true);
    }
    for (const c of cables) c.step(h, collide);
  }

  // ---------- the debug panel: views as on a turnaround sheet, iso or perspective, hold still

  const panel = document.querySelector<HTMLElement>('.debug');
  const showDebug = import.meta.env.DEV || query.has('settings') || query.has('debug');
  type View = 'front' | 'side' | 'back' | 'persp';
  let side = -1; // which flank Side shows: -1 the 03 shield's (the sheet's right view), 1 the other
  const debug = panel && showDebug ? (() => {
    panel.hidden = false;
    const gear = panel.querySelector<HTMLButtonElement>('.gear')!;
    const menu = panel.querySelector<HTMLElement>('.menu')!;
    const readout = panel.querySelector<HTMLElement>('.readout')!;
    const views = [...panel.querySelectorAll<HTMLButtonElement>('[data-view]')];
    const projs = [...panel.querySelectorAll<HTMLButtonElement>('[data-proj]')];
    const stillBtn = panel.querySelector<HTMLButtonElement>('[data-still]')!;
    const refs = [...panel.querySelectorAll<HTMLButtonElement>('[data-ref]')];
    const pane = document.querySelector<HTMLCanvasElement>('.ref')!;
    // the reference: the turnaround sheet's view for front, flanks and back, the hall picture for perspective.
    // It lives in model/ref, out of the repo, so only the dev server has it.
    const load = (name: string) => { const i = new Image(); i.src = `${import.meta.env.BASE_URL}model/ref/${name}.webp`; i.onload = () => drawRef(); return i; };
    const sheet = load('sheet');
    const hall = load('hall');
    // where each view sits on the sheet, in its pixels (model/sheet.py)
    const CROPS: Record<string, [number, number, number, number]> = {
      front: [40, 0, 280, 300], 'side-1': [315, 0, 560, 300], side1: [805, 0, 1045, 300], back: [585, 0, 780, 300],
    };
    let split: 'off' | 'side' | 'down' = 'off';
    const drawRef = () => {
      if (split === 'off') return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = pane.clientWidth, h = pane.clientHeight;
      pane.width = w * dpr; pane.height = h * dpr;
      const g = pane.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h);
      const key = current === 'side' ? `side${side}` : current ?? 'persp';
      const crop = CROPS[key];
      const img = crop ? sheet : hall;
      if (!img.complete || !img.naturalWidth) {
        g.fillStyle = '#f4f4f2'; g.font = '600 11px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText('NO REFERENCE: MODEL/REF IS ONLY ON THE DEV SERVER', w / 2, h / 2);
        return;
      }
      const [sx, sy, sx1, sy1] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
      const sw = sx1 - sx, sh = sy1 - sy;
      const k = Math.min((w - 32) / sw, (h - 32) / sh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
    };
    const setSplit = (s: typeof split) => {
      split = s;
      document.body.classList.toggle('split-side', s === 'side');
      document.body.classList.toggle('split-down', s === 'down');
      pane.hidden = s === 'off';
      resize();
      drawRef();
      mark();
    };
    window.addEventListener('resize', () => drawRef());
    let current: View | null = 'persp';
    // open unless it was folded away last time
    const FOLDED = 'day20.debug.folded';
    const fold = panel.querySelector<HTMLButtonElement>('.fold')!;
    const setOpen = (o: boolean) => {
      menu.hidden = !o;
      gear.hidden = o;
      gear.setAttribute('aria-expanded', String(o));
      try { localStorage.setItem(FOLDED, o ? '0' : '1'); } catch { /* no storage */ }
    };
    let folded = false;
    try { folded = localStorage.getItem(FOLDED) === '1'; } catch { /* no storage */ }
    setOpen(!folded);
    const mark = () => {
      views.forEach((b) => b.classList.toggle('on', goal !== null && b.dataset.view === current));
      projs.forEach((b) => b.classList.toggle('on', (b.dataset.proj === 'ortho') === (eye === ortho)));
      stillBtn.classList.toggle('on', still);
      refs.forEach((b) => b.classList.toggle('on', b.dataset.ref === split));
      drawRef();
    };
    const look = (view: View) => {
      if (view === 'side' && current === 'side' && goal) side = -side;
      current = view;
      if (view === 'persp' || !pod) {
        // back to the pod as it hangs, swinging
        if (pod) pod.quaternion.copy(podRest);
        still = false;
        goal = { yaw: YAW0, pitch: PITCH0, radius: homeRadius, target: home.clone() };
      } else {
        // the sheet draws it hanging straight and still: so does this, while you compare
        pod.quaternion.identity();
        pod.updateWorldMatrix(true, false); // the view is worked out from the pod straightened, not as it hung last frame
        still = true;
        // straight at the pod's own front, flank or back, however it hangs, its middle in the middle
        const local = view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'back' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(side, 0, 0);
        const d = local.transformDirection(pod.matrixWorld);
        const c = podCentre.clone().applyMatrix4(pod.matrixWorld);
        goal = { yaw: Math.atan2(d.x, d.z), pitch: 0, radius: 4.3 / Math.min(1, camera.aspect / 0.85), target: c };
      }
      mark();
    };
    const project = (o: boolean) => { eye = o ? ortho : camera; mark(); };
    gear.addEventListener('pointerdown', (e) => e.preventDefault());
    gear.addEventListener('click', () => setOpen(true));
    fold.addEventListener('pointerdown', (e) => e.preventDefault());
    fold.addEventListener('click', () => setOpen(false));
    views.forEach((b) => b.addEventListener('click', () => look(b.dataset.view as View)));
    projs.forEach((b) => b.addEventListener('click', () => project(b.dataset.proj === 'ortho')));
    stillBtn.addEventListener('click', () => { still = !still; mark(); });
    refs.forEach((b) => b.addEventListener('click', () => setSplit(b.dataset.ref as typeof split)));
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1') look('front');
      else if (e.key === '3') look('side');
      else if (e.key === '9') look('back');
      else if (e.key === '0') look('persp');
      else if (e.key === '5') project(eye !== ortho);
      else if (e.key === 'h' || e.key === 'H') { still = !still; mark(); }
      else if (e.key === 'r' || e.key === 'R') setSplit(split === 'off' ? 'side' : split === 'side' ? 'down' : 'off');
    });
    canvas.addEventListener('pointerdown', () => queueMicrotask(mark));
    mark();
    return {
      tick() {
        if (menu.hidden) return;
        const deg = THREE.MathUtils.radToDeg;
        readout.textContent = `door ${deg(open).toFixed(0)}°  swing ${deg(Math.hypot(ax, az)).toFixed(1)}°  ${eye === ortho ? 'iso' : 'pers'}`;
      },
    };
  })() : null;

  // ---------- frame

  function resize() {
    const w = canvas.clientWidth; // the whole window, or half of it with the reference beside
    const h = canvas.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wasHome = radius === homeRadius && target.equals(home);
    homeRadius = 5.6 / Math.min(1, camera.aspect / 0.85); // step back on a narrow screen
    home.x = 0.1 + 0.9 * THREE.MathUtils.clamp((camera.aspect - 1) / 0.7, 0, 1); // on a wide one the pod hangs left of centre, the hall to its right
    if (wasHome) { radius = homeRadius; target.copy(home); }
  }
  window.addEventListener('resize', resize);
  resize();

  let then = performance.now();
  let owed = 0;
  let time = 0;
  function frame(now: number) {
    const dt = Math.min(0.05, (now - then) / 1000);
    then = now;

    if (grab !== 'orbit') {
      yaw += vyaw;
      pitch += vpitch;
      vyaw *= 0.92;
      vpitch *= 0.92;
    }
    if (goal) {
      const k = 1 - Math.exp(-dt * 6);
      yaw += Math.atan2(Math.sin(goal.yaw - yaw), Math.cos(goal.yaw - yaw)) * k;
      pitch += (goal.pitch - pitch) * k;
      radius += (goal.radius - radius) * k;
      target.lerp(goal.target, k);
      vyaw = vpitch = 0;
    }
    pitch = THREE.MathUtils.clamp(pitch, -0.85, 0.6);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(radius).add(target);
    camera.lookAt(target);
    if (eye === ortho) {
      // as big as the perspective one shows things at the target
      const h = radius * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      ortho.top = h; ortho.bottom = -h; ortho.left = -h * camera.aspect; ortho.right = h * camera.aspect;
      ortho.position.copy(camera.position); ortho.quaternion.copy(camera.quaternion);
      ortho.updateProjectionMatrix();
    }
    debug?.tick();

    owed += dt;
    while (owed >= STEP) {
      owed -= STEP;
      time += STEP;
      physics(STEP, time);
    }
    for (const c of cables) c.skin();
    blood?.update(dt);

    renderer.render(scene, eye);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
