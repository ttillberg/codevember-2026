// What is left around the sphere: the guide line while aiming a cut, and a marker for where
// the finger really is while it pulls. No beam, no sparks, no rewards, no sound.

import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import { R } from './state';
import type { Ctx, Module } from './state';

const ARM = 0.13;      // rad, half an arm of the cross
const ARM_SEGS = 10;   // per arm pair
const TRAIL_SEGS = 48; // the arc back to where the film was taken hold of
const DASH = 7;        // px, a dash of the guide line, and the gap after it
const DASH_SPEED = 42; // px/s, how fast the dashes march

export function createFx(ctx: Ctx): Module {
  const { world, canvas } = ctx;

  // ---------------------------------------------------- aim overlay
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;mix-blend-mode:difference;';
  canvas.after(overlay);
  const g2 = overlay.getContext('2d');
  let ow = window.innerWidth, oh = window.innerHeight, dpr = 1;
  let overlayDrawn = false;
  const ink = '#fff'; // blended as a difference: dark over the pale backdrop, pale over the sphere

  function line(ax: number, ay: number, bx: number, by: number) {
    g2!.beginPath();
    g2!.moveTo(ax, ay);
    g2!.lineTo(bx, by);
    g2!.stroke();
  }

  /** A dashed line across the whole screen through the two points, its dashes marching from
   *  the first point to the second. Faint while it cannot cut. A dot marks the first point. */
  function guide(x0: number, y0: number, x1: number, y1: number, valid: boolean) {
    if (!g2) return;
    g2.fillStyle = g2.strokeStyle = ink;
    g2.globalAlpha = valid ? 0.9 : 0.4;
    g2.beginPath();
    g2.arc(x0, y0, 2.5, 0, Math.PI * 2);
    g2.fill();
    let dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len >= 1) {
      dx /= len; dy /= len;
      const far = (ow + oh) * 2;
      g2.lineCap = 'butt';
      g2.lineWidth = 1.25;
      g2.setLineDash([DASH, DASH]);
      // the line is drawn from far behind the first point: keep the dashes still against it
      g2.lineDashOffset = far - ((performance.now() / 1000) * DASH_SPEED) % (DASH * 2);
      g2.globalAlpha = valid ? 0.85 : 0.25;
      line(x0 - dx * far, y0 - dy * far, x1 + dx * far, y1 + dy * far);
      g2.setLineDash([]);
    }
    g2.globalAlpha = 1;
  }

  function drawOverlay() {
    if (!g2) return;
    const aim = world.aim;
    if (!aim.active && !overlayDrawn) return;
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.clearRect(0, 0, overlay.width, overlay.height);
    overlayDrawn = aim.active;
    if (!aim.active) return;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    guide(aim.x0, aim.y0, aim.x1, aim.y1, aim.valid);
  }

  // ---------------------------------------------------- finger marker
  // The pointer is flat, the pull is not: past the silhouette the grabbed point rolls on over
  // the back of the sphere. A cross bent to the surface shows where it is, one arm along the
  // pull, and a hairline runs back to where the film was taken hold of. Drawn twice: solid
  // where it is in view, faint through the sphere where it is behind.
  const SEGS = ARM_SEGS * 2 + TRAIL_SEGS;
  const geo = new BufferGeometry();
  const pts = new Float32Array(SEGS * 6);
  geo.setAttribute('position', new BufferAttribute(pts, 3));
  const marker = new Group();
  marker.visible = false;
  for (const through of [false, true]) {
    const mat = new LineBasicMaterial({ color: 0xff2a8a, transparent: true, opacity: through ? 0.45 : 1, depthTest: !through, depthWrite: false });
    const lines = new LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = through ? 9 : 10;
    marker.add(lines);
  }
  ctx.scene.add(marker);
  const u = new Vector3(), v = new Vector3(), a = new Vector3(), b = new Vector3();
  let n = 0;
  /** Segment of the great circle through `c` along tangent `t`, from angle a0 to a1, at radius r. */
  function arc(c: Vector3, t: Vector3, a0: number, a1: number, segs: number, r: number) {
    for (let i = 0; i < segs; i++) {
      const p = a0 + ((a1 - a0) * i) / segs, q = a0 + ((a1 - a0) * (i + 1)) / segs;
      a.copy(c).multiplyScalar(Math.cos(p)).addScaledVector(t, Math.sin(p)).multiplyScalar(r);
      b.copy(c).multiplyScalar(Math.cos(q)).addScaledVector(t, Math.sin(q)).multiplyScalar(r);
      pts.set([a.x, a.y, a.z, b.x, b.y, b.z], n);
      n += 6;
    }
  }

  function drawMarker() {
    const f = world.finger;
    marker.visible = f.active && world.show.debug;
    if (!f.active) return;
    marker.quaternion.copy(world.rotation);
    // u: along the pull at the finger (back towards the grab), v: across it
    u.copy(f.from).addScaledVector(f.at, -f.from.dot(f.at));
    if (u.lengthSq() < 1e-8) u.set(-f.at.y, f.at.x, 0).addScaledVector(f.at, 0);
    if (u.lengthSq() < 1e-8) u.set(0, -f.at.z, f.at.y);
    u.normalize();
    v.crossVectors(f.at, u);
    const r = R + f.height + 0.008;
    n = 0;
    arc(f.at, u, -ARM, ARM, ARM_SEGS, r);
    arc(f.at, v, -ARM, ARM, ARM_SEGS, r);
    arc(f.at, u, 0, f.at.angleTo(f.from), TRAIL_SEGS, R + 0.006);
    geo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------- tension
  // Debug: what the peel front feels (world.tension, written by peel.ts). Ticks across the
  // front and the tethers they hang by: blue slack, yellow taut, red about to let go.
  const tGeo = new BufferGeometry();
  tGeo.setAttribute('position', new BufferAttribute(world.tension.pos, 3));
  tGeo.setAttribute('color', new BufferAttribute(world.tension.col, 3));
  const tLines = new LineSegments(tGeo, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  tLines.frustumCulled = false;
  tLines.renderOrder = 8;
  ctx.scene.add(tLines);

  function drawTension() {
    const t = world.tension;
    tLines.visible = world.show.debug && world.finger.active && t.count > 0;
    if (!tLines.visible) return;
    tLines.quaternion.copy(world.rotation);
    tGeo.setDrawRange(0, t.count);
    tGeo.attributes.position.needsUpdate = true;
    tGeo.attributes.color.needsUpdate = true;
  }

  return {
    update() {
      drawOverlay();
      drawMarker();
      drawTension();
    },
    resize(w, h) {
      ow = w; oh = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
      overlayDrawn = true; // resizing cleared it; let the next frame settle
    },
  };
}
