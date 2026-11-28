// What grows on the burrow, after day 16's moss (day 05's engine): a surface drawn again and again in shells pushed
// out along its normal, each strand a cell of noise that thins towards its tip; and instanced strands that are
// brushed aside by whoever comes through. Three things grow here, each where it would:
//   moss       where there is light: the bank round the mouth, and the first body length or two inside
//   root felt  the mat of fine root hair on roofs and upper walls, thickest round the roots themselves, hanging
//   mould      where it is damp and dark, round roots and stones and whatever is rotting
// and from the roof, tufts of all three hang down into the way.
import * as THREE from 'three';
import { Perlin } from './noise';
import { strataY, sstep, type World } from './world';
import { shellMaterial, tuftMaterial } from './gfx';
import { turf } from './outside';

const sat = (x: number) => Math.min(1, Math.max(0, x));

/** a thing something can grow round: a stone or a stretch of root */
interface Thing { x: number; y: number; z: number; r: number; root: boolean }

export class Growth {
  private P = new Perlin(1605);
  private cells = new Map<number, Thing[]>();
  private readonly CELL = 0.2;
  private mouth = new THREE.Vector3();

  constructor(private world: World, rocks: { c: THREE.Vector3; s: number }[], rootPts: number[]) {
    this.mouth.copy(world.entrance).add(new THREE.Vector3(0, 0.1, 0.1));
    for (const r of rocks) this.add({ x: r.c.x, y: r.c.y, z: r.c.z, r: r.s * 0.85, root: false });
    for (let i = 0; i < rootPts.length; i += 4) this.add({ x: rootPts[i], y: rootPts[i + 1], z: rootPts[i + 2], r: rootPts[i + 3], root: true });
  }

  private key(i: number, j: number, k: number) { return (i + 512) | ((j + 512) << 10) | ((k + 512) << 20); }
  private add(t: Thing) {
    const c = this.CELL, m = t.r + 0.14;
    for (let i = Math.floor((t.x - m) / c); i <= Math.floor((t.x + m) / c); i++)
      for (let j = Math.floor((t.y - m) / c); j <= Math.floor((t.y + m) / c); j++)
        for (let k = Math.floor((t.z - m) / c); k <= Math.floor((t.z + m) / c); k++) {
          const key = this.key(i, j, k);
          let l = this.cells.get(key);
          if (!l) this.cells.set(key, (l = []));
          l.push(t);
        }
  }
  /** how close to a root, and to a stone: 1 touching, 0 a hand's breadth off */
  private near(x: number, y: number, z: number): [number, number] {
    const l = this.cells.get(this.key(Math.floor(x / this.CELL), Math.floor(y / this.CELL), Math.floor(z / this.CELL)));
    let root = 0, rock = 0;
    if (l)
      for (const t of l) {
        const v = 1 - sstep(0.01, 0.12, Math.hypot(x - t.x, y - t.y, z - t.z) - t.r);
        if (t.root) root = Math.max(root, v); else rock = Math.max(rock, v);
      }
    return [root, rock];
  }

  /** What grows at a point of a surface facing n, and how much: moss, root felt, mould. */
  at(x: number, y: number, z: number, ny: number, open: number, out: number[]): number[] {
    const P = this.P;
    const dm = Math.hypot(x - this.mouth.x, y - this.mouth.y, z - this.mouth.z);
    const lightIn = Math.exp(-Math.max(0, dm - 0.35) / 0.75);
    const n1 = P.n(x * 1.7, y * 1.7 + 3.1, z * 1.7), n2 = P.n(x * 4.6 + 9.2, y * 4.6, z * 4.6), n3 = P.n(x * 0.7, y * 0.7, z * 0.7 + 5.5);
    const [root, rock] = this.near(x, y, z);
    const floor = sstep(0.55, 0.85, ny);
    // moss: outside wherever the turf has hold, and thick round the rim of the hole; inside for as far as the day
    // gets, more of it round stones and roots, less where feet go
    let moss: number;
    if (open > 0.5) {
      const rim = 1 - sstep(0.45, 0.95, dm);
      // (it has the trodden earth in front of the hole too, only thinner: all but the lip itself)
      const hold = Math.max(turf(x, y, z, P.n(x * 2.1, 0.5, z * 2.1)), 0.6 * sstep(0.3, 0.6, dm));
      moss = sat(hold * (0.68 + 0.7 * n1 + 0.3 * n2) + rim * sat(0.1 + 1.3 * n2 + 0.5 * n1) * 0.8 + 0.5 * rock);
    } else moss = sat(lightIn * (0.35 + 0.9 * n1 + 0.5 * n2 + 0.7 * Math.max(root, rock)) * 1.5) * (1 - 0.7 * floor);
    const dark = (1 - open) * (1 - lightIn);
    // root felt: under the roof and high on the walls; round every root, and in patches of its own
    const high = sat(0.55 - ny * 0.9);
    // (the roof proper carries most of it: ny near -1)
    const roof = sat(-ny * 1.4 - 0.1);
    const felt = dark * high * sat(1.1 * root + sat(n1 * 1.5 + 0.1 + 0.35 * roof) * 0.85 + 0.3 * n2 + 0.2 * roof - 0.08);
    // mould: the deeper and damper the more; it starts on what is there to feed on
    const yy = strataY(x, y, z);
    const damp = sat(sstep(-0.75, -1.45, yy) * 0.75 + sat(n3 * 2.2 - 0.35));
    // where water stands the air is wet: how near is a puddle, and are we above its surface
    let wet = 0;
    for (const p of this.world.puddles) {
      if (y < p.y + 0.004) continue;
      wet = Math.max(wet, 1 - sstep(0.12, 0.75, Math.hypot(x - p.x, (y - p.y) * 0.7, z - p.z)));
    }
    let mould = dark * (1 - 0.6 * floor) * sat(damp * (0.25 + 0.9 * Math.max(root, rock) + sat(n2 * 2.4 - 0.5)) + 0.45 * rock * sat(n1 + 0.3) - 0.12);
    if (wet > 0) {
      // mould on everything round it, and a moss that needs no day: a dark felt of it on the wet ground and low walls
      mould = sat(mould + dark * wet * (0.35 + 0.6 * sat(n2 + 0.5)));
      moss = Math.max(moss, dark * wet * sat(0.25 + 0.9 * n1 + 0.5 * n3) * (1 - 0.5 * floor) * 0.9);
    }
    out[0] = moss < 0.08 ? 0 : moss;
    out[1] = felt < 0.08 ? 0 : felt;
    out[2] = mould < 0.08 ? 0 : mould;
    return out;
  }

  /** Give a mesh its growth per vertex (for its own shader to stain by), and cut out the part of it anything grows on. */
  dress(geo: THREE.BufferGeometry, isRoot: boolean): THREE.BufferGeometry | null {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const sky = geo.getAttribute('aSky') as THREE.BufferAttribute | undefined, ao = geo.getAttribute('aAO') as THREE.BufferAttribute;
    const n = pos.count;
    const grow = new Float32Array(n * 3);
    const g = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      this.at(x, y, z, nrm.getY(i), sky ? sky.getX(i) : 0, g);
      if (isRoot) {
        // on the roots themselves: the short hair every root has, moss in the light, mould in the damp
        g[1] = sat(0.25 + 0.5 * this.P.n(x * 9, y * 9, z * 9)) * (1 - g[0]);
        g[2] *= 1.3;
      }
      grow.set(g, i * 3);
    }
    geo.setAttribute('aGrow', new THREE.BufferAttribute(grow, 3));
    // the patch: every triangle with something on it, its vertices packed
    const idx = geo.index!.array;
    const remap = new Int32Array(n).fill(-1);
    const oi: number[] = [], op: number[] = [], on: number[] = [], og: number[] = [], oa: number[] = [], os: number[] = [];
    const some = (i: number) => grow[i * 3] + grow[i * 3 + 1] + grow[i * 3 + 2] > 0.1;
    for (let t = 0; t < idx.length; t += 3) {
      if (!some(idx[t]) && !some(idx[t + 1]) && !some(idx[t + 2])) continue;
      for (let k = 0; k < 3; k++) {
        const i = idx[t + k];
        if (remap[i] < 0) {
          remap[i] = op.length / 3;
          op.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          on.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
          og.push(grow[i * 3], grow[i * 3 + 1], grow[i * 3 + 2]);
          oa.push(ao.getX(i));
          os.push(sky ? sky.getX(i) : 0);
        }
        oi.push(remap[i]);
      }
    }
    if (!oi.length) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(op), 3));
    out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(on), 3));
    out.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(og), 3));
    out.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(oa), 1));
    out.setAttribute('aSky', new THREE.BufferAttribute(new Float32Array(os), 1));
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(oi), 1));
    return out;
  }

  /** The shells over a dressed patch. */
  shells(patch: THREE.BufferGeometry, layers: number, scale: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(patch, shellMaterial(layers, scale), layers);
    m.frustumCulled = false;
    return m;
  }

  /**
   * What hangs from the roof into the way: beards of root hair, strands of moss and dead grass by the mouth,
   * threads of mould. One blade each, a bent strip, all one instanced mesh. The head parts them as it comes through.
   */
  tufts(rnd: () => number): THREE.Mesh {
    const { world } = this;
    const SEG = 5;
    const lp: number[] = [], li: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      lp.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
      if (i < SEG) { const k = i * 2; li.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    geo.setIndex(li);
    const aRoot: number[] = [], aDir: number[] = [], aShape: number[] = [], aLook: number[] = [];
    const c = new THREE.Vector3(), T = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
    const g = [0, 0, 0];
    const blade = (p: THREE.Vector3, nrm: THREE.Vector3, len: number, w: number, kind: number) => {
      aRoot.push(p.x + nrm.x * 0.004, p.y + nrm.y * 0.004, p.z + nrm.z * 0.004);
      // out of the surface a little way, and then gravity has it
      aDir.push(nrm.x * 0.5 + (rnd() - 0.5) * 0.7, nrm.y * 0.5 - 0.75, nrm.z * 0.5 + (rnd() - 0.5) * 0.7);
      aShape.push(len, w, (rnd() - 0.5) * 0.8, kind);
      aLook.push(rnd(), rnd());
    };
    for (const e of world.edges) {
      const tries = Math.round(e.len * (e.open ? 80 : 560));
      for (let i = 0; i < tries; i++) {
        const s = e.open ? e.len - rnd() * 0.35 : rnd() * e.len;
        world.railPoint(e, s, c);
        world.railTangent(e, s, T);
        side.crossVectors(T, up).normalize();
        up2.crossVectors(side, T);
        const phi = (rnd() * 2 - 1) * 1.35;
        d.copy(up2).multiplyScalar(Math.cos(phi)).addScaledVector(side, Math.sin(phi));
        const t = world.march(c, d, 0.9);
        if (t >= 0.9) continue;
        c.addScaledVector(d, t);
        world.normalAt(c.x, c.y, c.z, n);
        if (n.y > 0.25) continue; // roofs and overhangs only
        const open = e.open || c.z > -0.2 ? 1 : 0;
        this.at(c.x, c.y, c.z, n.y, open, g);
        // how far it may hang before it lies on the floor
        const room = world.march(c.clone().addScaledVector(n, 0.02), down, 0.5) - 0.03;
        if (room < 0.025) continue;
        const u = rnd();
        if (g[1] > 0.3 && u < g[1]) {
          // a beard of root hair: several from one spot. And every third or so is a clump of something softer,
          // moss-like: short, thick with strands, a darker olive-brown down here where it has never seen the day
          if (rnd() < 0.36) for (let k = 5 + Math.floor(rnd() * 9); k > 0; k--) blade(c, n, Math.min(room, 0.015 + rnd() * 0.055), 0.0016 + rnd() * 0.0022, 4);
          else for (let k = 2 + Math.floor(rnd() * 5); k > 0; k--) blade(c, n, Math.min(room, 0.03 + rnd() * rnd() * 0.16), 0.0009 + rnd() * 0.0014, 0);
        } else if (g[0] > 0.3 && u < g[0] * 0.8) {
          // by the mouth: moss in strands, and now and then a dead grass that has come through the roof
          if (rnd() < 0.25) blade(c, n, Math.min(room, 0.06 + rnd() * 0.16), 0.0016 + rnd() * 0.0016, 3);
          else for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) blade(c, n, Math.min(room, 0.02 + rnd() * 0.07), 0.0014 + rnd() * 0.0018, 1);
        } else if (g[2] > 0.35 && u < g[2] * 0.7) {
          // mould: pale threads, fine, short
          for (let k = 2 + Math.floor(rnd() * 4); k > 0; k--) blade(c, n, Math.min(room, 0.012 + rnd() * 0.045), 0.0005 + rnd() * 0.0007, 2);
        }
      }
    }
    geo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(aRoot), 3));
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(aDir), 3));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(aShape), 4));
    geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(aLook), 2));
    geo.instanceCount = aRoot.length / 3;
    const mesh = new THREE.Mesh(geo, tuftMaterial());
    mesh.frustumCulled = false;
    console.log(`growth: ${geo.instanceCount} hanging strands`);
    return mesh;
  }
}
