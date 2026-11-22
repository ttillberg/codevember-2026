import * as THREE from 'three';

// Two lamps on the door, red and green (main.ts turns them). (There was a note by hand under the window too,
// "knock before opening" in a white paint marker on the black square: taken off.)

/** the door's face, from its window: which way is out (n), up along it (up), across it (across), the window's
 * middle (c) and how far down from that its bottom edge is (low, negative); and a way to find a point on the door's
 * plates at (down, across) metres from the window's middle (null if the ray finds none) */
function face(door: THREE.Object3D) {
  const glass = door.getObjectByName('door_window');
  const plates = door.getObjectByName('door_plates');
  if (!glass || !plates) return null;
  door.updateWorldMatrix(true, true);
  // the window's face that looks out the front (the window is a thin box let into the door), its up the long way
  const front = new THREE.Vector3(Math.sin(0.26), 0, Math.cos(0.26)); // (the way the pod is met from)
  const g = (glass as THREE.Mesh).geometry;
  const nAttr = g.getAttribute('normal');
  const pAttr = g.getAttribute('position');
  const nm = new THREE.Matrix3().getNormalMatrix(glass.matrixWorld);
  let n = new THREE.Vector3(), best = -2;
  const v = new THREE.Vector3();
  for (let i = 0; i < nAttr.count; i++) {
    v.fromBufferAttribute(nAttr, i).applyMatrix3(nm).normalize();
    if (v.dot(front) > best) { best = v.dot(front); n = v.clone(); }
  }
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const across = new THREE.Vector3().crossVectors(up, n).normalize();
  const c = new THREE.Box3().setFromObject(glass).getCenter(new THREE.Vector3());
  let low = 0;
  for (let i = 0; i < pAttr.count; i++) low = Math.min(low, v.fromBufferAttribute(pAttr, i).applyMatrix4(glass.matrixWorld).sub(c).dot(up));
  const on = (u: number, x: number) => {
    const target = c.clone().addScaledVector(up, u).addScaledVector(across, x);
    const hit = new THREE.Raycaster(target.clone().addScaledVector(n, 1), n.clone().negate()).intersectObject(plates, true)[0];
    return hit ? hit.point : null;
  };
  /** an object's turn to face out of the door, upright along it */
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, new THREE.Vector3().crossVectors(n, across).normalize(), n));
  return { n, up, across, c, low, on, turn };
}

/** Two lamps on the door, side by side under its window: red, and green. Red to begin with; the first time the eye
 * goes to the door, red goes out and green comes on, blinking twice first, and stays. Small lamps in black bezels,
 * the lit one glowing (no light of their own: the pod's red light does that) */
export function doorLamps(door: THREE.Object3D) {
  const f = face(door);
  if (!f) return null;
  const bezel = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.45, metalness: 0.8 });
  const make = (hex: number, x: number) => {
    const hit = f.on(f.low - 0.075, x);
    if (!hit) return null;
    const g = new THREE.Group();
    g.quaternion.copy(f.turn);
    g.position.copy(hit);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.012, 24).rotateX(Math.PI / 2).translate(0, 0, 0.006), bezel);
    const lens = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.12), roughness: 0.25, metalness: 0, emissive: hex, emissiveIntensity: 0.04 });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 12).scale(1, 1, 0.45).translate(0, 0, 0.012), lens);
    g.add(b, l);
    door.attach(g);
    return lens;
  };
  const red = make(0xff0800, -0.026), green = make(0x18ff40, 0.026);
  // (lit, bright, but not so bright that the tone curve washes the red to orange and the green to white)
  const set = (m: THREE.MeshStandardMaterial | null, on: boolean) => { if (m) m.emissiveIntensity = on ? (m === red ? 0.8 : 0.9) : 0.03; };
  set(red, true);
  let done = false;
  return {
    /** red out, green on: once */
    green() {
      if (done) return false;
      done = true;
      set(red, false);
      [[0, true], [140, false], [280, true], [420, false], [600, true]].forEach(([ms, on]) => setTimeout(() => set(green, on as boolean), ms as number));
      return true;
    },
  };
}
