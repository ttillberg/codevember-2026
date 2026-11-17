import { Matrix4, Vector3 } from 'three';
import type { Net, Panel, V2 } from './net';

// World matrix of every panel, folding each hinge by amount(panel) × its rest fold.
// Sheet space: printed side +z. A positive fold swings the panel to -z.
export function foldMatrices(house: Net, amount: (p: Panel) => number = () => 1) {
  const out = new Map<string, Matrix4>();
  const byId = new Map(house.panels.map((p) => [p.id, p]));
  const get = (p: Panel): Matrix4 => {
    const hit = out.get(p.id);
    if (hit) return hit;
    let m = new Matrix4();
    if (p.parent && p.hinge) {
      const [a, b] = p.hinge;
      const axis = new Vector3(b[0] - a[0], b[1] - a[1], 0).normalize();
      const [cx, cy] = centroid(p.poly);
      // swing to -z: flip the axis when the panel lies on its left
      if (axis.x * (cy - a[1]) - axis.y * (cx - a[0]) > 0) axis.negate();
      const angle = (p.fold * amount(p) * Math.PI) / 180;
      const local = new Matrix4()
        .makeTranslation(a[0], a[1], 0)
        .multiply(new Matrix4().makeRotationAxis(axis, angle))
        .multiply(new Matrix4().makeTranslation(-a[0], -a[1], 0));
      m = get(byId.get(p.parent)!).clone().multiply(local);
    }
    out.set(p.id, m);
    return m;
  };
  house.panels.forEach(get);
  return out;
}

export function centroid(poly: V2[]): V2 {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

// Every tab, fully folded, should lie flat against the panel it is glued to, inside its outline.
export function checkGlue(house: Net, eps = 1e-3) {
  const mats = foldMatrices(house);
  const byId = new Map(house.panels.map((p) => [p.id, p]));
  const problems: string[] = [];
  for (const t of house.panels) {
    if (!t.glue) continue;
    const target = byId.get(t.glue)!;
    const inv = mats.get(target.id)!.clone().invert();
    for (const [x, y] of t.poly) {
      const v = new Vector3(x, y, 0).applyMatrix4(mats.get(t.id)!).applyMatrix4(inv);
      if (Math.abs(v.z) > eps) problems.push(`${t.id} floats ${v.z.toFixed(2)}mm off ${target.id}`);
      else if (!(target.parts ?? [target.poly]).some((q) => inside(q, [v.x, v.y], eps))) problems.push(`${t.id} sticks out of ${target.id} at ${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    }
  }
  return problems;
}

function inside(poly: V2[], [x, y]: V2, eps: number) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -eps) return false;
  }
  return true;
}
