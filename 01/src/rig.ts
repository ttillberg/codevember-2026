import * as THREE from 'three';

// The camera's aim: one orthographic iso corner, fitted to a box, plus the hand's zoom, pan and
// turn. World units are millimetres, y up. Sizes are read from the canvas as it really is.

export function makeRig(camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement) {
  const view = { elevation: 30, azimuth: 36, room: 1.12, zoom: 1, panX: 0, panY: 0, target: new THREE.Vector3() };
  let fitBox = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 10, 100));
  let mmPerPx = 1;
  let width = 1, height = 1;
  let fitHalf = 100;

  function measure() {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
  }

  function clampPan() {
    const room = 1 - 1 / view.zoom;
    const ax = fitHalf * (width / height) * room;
    const ay = fitHalf * room;
    view.panX = Math.max(-ax, Math.min(ax, view.panX));
    view.panY = Math.max(-ay, Math.min(ay, view.panY));
  }

  function aim() {
    measure();
    const phone = width < 640;
    const el = THREE.MathUtils.degToRad(view.elevation);
    const az = THREE.MathUtils.degToRad(view.azimuth);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(view.target).addScaledVector(dir, 1500);
    camera.lookAt(view.target);
    camera.updateMatrixWorld();

    // the box's extent in the camera's frame
    const inv = camera.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? fitBox.max.x : fitBox.min.x, i & 2 ? fitBox.max.y : fitBox.min.y, i & 4 ? fitBox.max.z : fitBox.min.z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const aspect = width / height;
    const pad = (phone ? 1.04 : 1.25) * view.room;
    fitHalf = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) * pad;
    // the hand's zoom and pan, inside the fitted frame: zoomed out all the way there is no pan
    clampPan();
    const half = fitHalf / view.zoom;
    const cx = (x0 + x1) / 2 + view.panX;
    // phones: room for the plate on top
    const cy = (y0 + y1) / 2 + (phone ? fitHalf * 0.06 : 0) + view.panY;
    camera.left = cx - half * aspect; camera.right = cx + half * aspect;
    camera.top = cy + half; camera.bottom = cy - half;
    camera.near = 10;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    mmPerPx = (2 * half) / height;
  }

  // zoom by a factor about a screen point: what is under it stays under it
  function zoomAt(factor: number, sx: number, sy: number) {
    const r = canvas.getBoundingClientRect();
    const z0 = view.zoom;
    const z1 = Math.max(1, Math.min(3, z0 * factor));
    const nx = ((sx - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((sy - r.top) / r.height) * 2;
    const d = fitHalf / z0 - fitHalf / z1;
    view.panX += nx * (width / height) * d;
    view.panY += ny * d;
    view.zoom = z1;
    aim();
  }

  // drag the view by screen pixels
  function panBy(dx: number, dy: number) {
    view.panX -= dx * mmPerPx;
    view.panY += dy * mmPerPx;
    aim();
  }

  return {
    view,
    aim,
    fit(box: THREE.Box3) { fitBox = box; aim(); },
    zoomAt,
    panBy,
    unzoom() { view.zoom = 1; view.panX = view.panY = 0; view.azimuth = 36; aim(); },
    // screen (client px) ↔ normalised device coordinates, from the canvas as it really is
    ndc(cx: number, cy: number) {
      const r = canvas.getBoundingClientRect();
      return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    },
    screen(p: THREE.Vector3) {
      const r = canvas.getBoundingClientRect();
      return new THREE.Vector2(r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height);
    },
    get mmPerPx() { return mmPerPx; },
  };
}
export type Rig = ReturnType<typeof makeRig>;
