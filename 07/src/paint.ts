// The paint on the balloon lives in UV space as two half float textures, rendered ping-pong between two targets:
//   color: premultiplied rgb, coverage in a
//   props: thickness, wetness, roughness * coverage, metalness * coverage
// Each frame: the queued dabs are splatted into the current target (one instanced draw, never cleared between
// strokes), scrapes are multiplied in (a second draw), then a full-screen pass reads the current target and writes
// the next: wet, thick paint runs down the balloon, paint dries. Dab width is stretched by 1 / sin(pi v) so a dab
// stays round near the poles, and dabs near the u seam are drawn again a full turn over so a stroke crosses it.
import {
  CustomBlending, DoubleSide, HalfFloatType, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial,
  NodeMaterial, OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera, PlaneGeometry, QuadMesh, RenderTarget,
  RepeatWrapping, Scene, ZeroFactor, NoBlending, BlendMode, MaterialBlending, Vector3, type Texture, type WebGPURenderer,
} from 'three/webgpu';
import {
  abs, cos, float, floor, hash, instancedBufferAttribute, length, max, min, mix, mrt, mx_noise_float, positionLocal, pow,
  select, sign, sin,
  screenUV, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4, Fn,
} from 'three/tsl';

export const PAINT_W = 2048, PAINT_H = 1024;
const v4 = vec4 as any; // the typings lack the (vec3, float) overload
const MAX_DABS = 2048; // per frame, per kind
const TRAIL = 0.3;     // coverage a run leaves behind it, whatever the paint did

export type Brush = 'round' | 'spray' | 'bristle' | 'glaze' | 'scrape';
const STYLE: Record<Brush, number> = { round: 0, spray: 1, bristle: 2, scrape: 3, glaze: 4 };
// How much paint each brush leaves: above the run threshold it drips while wet.
export const LOAD: Record<Brush, number> = { round: 0.85, spray: 0.9, bristle: 0.65, scrape: 0, glaze: 0 };

export type Dab = {
  u: number; v: number;
  size: number;      // diameter in v units (0..1 is pole to pole)
  angle: number;     // radians, along the stroke
  rgb: [number, number, number];
  flow: number;      // alpha per dab
  brush: Brush;
  seed: number;
  rough: number;     // the finish
  metal: number;
  load?: number;     // thickness laid, instead of the brush's
  wet?: number;      // wetness laid, instead of 0.85 (0 lays dry paint the run pass leaves alone)
};

// Tunables, live.
export const sim = {
  runAt: 0.5,    // thickness above which wet paint runs, in the easiest lanes
  runNoise: 0.35, // how much higher the threshold is in the stiffest lanes: big, and only a few lanes run, far
  lane: 14,      // lane width in texels
  laneSharp: 1,  // 1 lanes evenly spread, 4 most lanes stiff and a few runny
  runRate: 0.5,  // texels per step (120 a second) of excess paint moving down
  dry: 0.0008,   // wetness lost per step
  gravity: 1,    // 0 freezes the paint
  gravityObj: new Vector3(0, -1, 0), // the room's down in the balloon's own frame, set each frame
  bump: 22,      // slope per unit of thickness across a texel
  grain: 0.05,   // fine texture in the paint's height
  spread: 0.12,  // smoothing of wet paint across the flow, per step
  bleed: 0.06,   // how fast a wet wash floats out, per step
  flushes: 0,    // dev counter
};
const uRunAt = uniform(sim.runAt);
const uRunNoise = uniform(sim.runNoise);
const uLane = uniform(sim.lane);
const uLaneSharp = uniform(sim.laneSharp);
const uRunRate = uniform(sim.runRate);
const uDry = uniform(sim.dry);
const uGravity = uniform(sim.gravity);
const uGravityObj = uniform(new Vector3(0, -1, 0));
const uSpread = uniform(sim.spread);
const uBleed = uniform(sim.bleed);

// MRT outputs default to no blending; these take the material's.
function materialBlended(m: ReturnType<typeof mrt>) {
  m.setBlendMode('color', new BlendMode(MaterialBlending));
  m.setBlendMode('props', new BlendMode(MaterialBlending));
  return m;
}

function makeTarget() {
  const rt = new RenderTarget(PAINT_W, PAINT_H, { count: 2, depthBuffer: false, type: HalfFloatType });
  rt.textures[0].name = 'color';
  rt.textures[1].name = 'props';
  for (const t of rt.textures) { t.wrapS = RepeatWrapping; t.generateMipmaps = false; }
  return rt;
}

// One instanced draw of quads in UV space: the dab buffers and their geometry.
class Splats {
  geo: InstancedBufferGeometry;
  dab = new Float32Array(MAX_DABS * 4);   // u v size angle
  col = new Float32Array(MAX_DABS * 4);   // r g b flow
  misc = new Float32Array(MAX_DABS * 4);  // style seed rough metal
  extra = new Float32Array(MAX_DABS * 2); // load wet (negative load: the brush's)
  aDab: InstancedBufferAttribute; aCol: InstancedBufferAttribute; aMisc: InstancedBufferAttribute; aExtra: InstancedBufferAttribute;
  count = 0;
  mesh: Mesh;

  constructor(build: (dab: any, col: any, misc: any, extra: any, mat: MeshBasicNodeMaterial) => void) {
    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    this.aDab = new InstancedBufferAttribute(this.dab, 4);
    this.aCol = new InstancedBufferAttribute(this.col, 4);
    this.aMisc = new InstancedBufferAttribute(this.misc, 4);
    this.aExtra = new InstancedBufferAttribute(this.extra, 2);
    geo.setAttribute('aDab', this.aDab);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aMisc', this.aMisc);
    geo.setAttribute('aExtra', this.aExtra);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new MeshBasicNodeMaterial();
    mat.transparent = true; mat.depthTest = false; mat.depthWrite = false;
    mat.side = DoubleSide; // the quad is mirrored in v, which turns its winding
    mat.blending = CustomBlending;
    build(
      instancedBufferAttribute(this.aDab, 'vec4') as any,
      instancedBufferAttribute(this.aCol, 'vec4') as any,
      instancedBufferAttribute(this.aMisc, 'vec4') as any,
      instancedBufferAttribute(this.aExtra, 'vec2') as any,
      mat,
    );
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  push(d: Dab, shift: number) {
    if (this.count >= MAX_DABS) return;
    const i = this.count++;
    this.dab.set([d.u + shift, d.v, d.size, d.angle], i * 4);
    this.col.set([d.rgb[0], d.rgb[1], d.rgb[2], d.flow], i * 4);
    this.misc.set([STYLE[d.brush], d.seed, d.rough, d.metal], i * 4);
    this.extra.set([d.load ?? -1, d.wet ?? 0.85], i * 2);
  }

  /** Arms the draw for this frame, or hides it. */
  prepare() {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) {
      this.aDab.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aMisc.needsUpdate = true;
      this.aExtra.needsUpdate = true;
    }
  }
}

// Quad corner in dab space, rotated along the stroke, squeezed in u by the sphere's circumference at this v.
const dabPosition = (dab: any) => Fn(() => {
  const c = dab.xy, size = dab.z, a = dab.w;
  const p: any = positionLocal.xy.mul(size);
  const r = vec2(p.x.mul(a.cos()).sub(p.y.mul(a.sin())), p.x.mul(a.sin()).add(p.y.mul(a.cos())));
  const circ = max(sin(c.y.mul(Math.PI)), 0.02);
  // A v unit is pole to pole (pi r), a u unit is a full turn (2 pi r sin): half as wide at the equator.
  const o = vec2(r.x.div(circ).mul(0.5), r.y);
  // The target's rows run the other way from the sphere's v: mirror the quad.
  return vec3(c.x.add(o.x), float(1).sub(c.y.add(o.y)), 0);
})();

// The dab's footprint, 0..1, by brush style.
const dabShape = (style: any, seed: any, watery: any) => Fn(() => {
  const q = uv().mul(2).sub(1);
  const d = length(q);
  const round = smoothstep(1, 0.6, d);
  // Spray: a round cloud of speckles, denser at the middle.
  const cell = floor(uv().mul(48));
  const n = hash(cell.x.add(cell.y.mul(131)).add(seed.mul(7919)));
  const spray = select(n.greaterThan(mix(0.55, 1.0, d)), float(1), float(0)).mul(smoothstep(1, 0.3, d));
  // Bristle: streaks along the stroke, broken up along it.
  const lane = hash(floor(uv().y.mul(14)).add(seed.mul(1013)));
  const along = hash(floor(uv().x.mul(6)).add(floor(uv().y.mul(14)).mul(17)).add(seed.mul(331)));
  const bristle = smoothstep(1, 0.8, d).mul(select(lane.greaterThan(0.35), float(1), float(0))).mul(mix(0.6, 1, along));
  // Scrape: a flat blade, hard edged across, soft along.
  const scrape = smoothstep(1, 0.85, q.x.abs()).mul(smoothstep(1, 0.5, q.y.abs()));
  // Glaze: colour fused into the glass, a smooth soft-edged blob, softer the more watery (that rides in the
  // rough slot); the balloon shader gathers its pigment at the edge and lenses it.
  // The outline wanders: noise in target space pushes the rim in and out, so the wash's edge is ragged the way a
  // wet edge dries, and the same across every dab of the stroke.
  const tt = screenUV.mul(vec2(PAINT_W, PAINT_H));
  const rim = mx_noise_float(vec3(tt.x.div(40), tt.y.div(40), 3.7)).mul(0.5).add(0.5);
  const glaze = smoothstep(1, float(0.5).sub(watery.mul(0.4)), d.add(rim.sub(0.5).mul(0.2)));
  return select(style.lessThan(0.5), round, select(style.lessThan(1.5), spray, select(style.lessThan(2.5), bristle,
    select(style.lessThan(3.5), scrape, glaze))));
})();

export class PaintLayer {
  private targets = [makeTarget(), makeTarget()];
  private cur = 0;
  private scene = new Scene();
  private camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
  private paint: Splats;
  private scrape: Splats;
  private simQuads: QuadMesh[];
  private zero: QuadMesh;
  private cleared = false;
  /** The balloon reads these; they point at the current target after every flush. */
  readonly colorNode = texture(this.targets[0].textures[0]);
  readonly propsNode = texture(this.targets[0].textures[1]);
  private readers: { node: any; index: number }[] = [];

  /** A props read at another uv, for neighbours; follows the swap like propsNode. */
  propsAt(uvNode: any) {
    const node = texture(this.targets[this.cur].textures[1], uvNode);
    this.readers.push({ node, index: 1 });
    return node as any;
  }

  /** A colour read at another uv, likewise. */
  colorAt(uvNode: any) {
    const node = texture(this.targets[this.cur].textures[0], uvNode);
    this.readers.push({ node, index: 0 });
    return node as any;
  }

  constructor() {
    // Paint dabs: premultiplied, One / OneMinusSrcAlpha into both targets, so thickness, roughness and metalness
    // are set to the brush's where it covers and kept where it doesn't.
    this.paint = new Splats((dab, col, misc, extra, mat) => {
      mat.blendSrc = OneFactor; mat.blendDst = OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = OneFactor; mat.blendDstAlpha = OneMinusSrcAlphaFactor;
      const vCol: any = varying(col), vMisc: any = varying(misc), vExtra: any = varying(extra);
      mat.positionNode = dabPosition(dab);
      const a = dabShape(vMisc.x, vMisc.y, vMisc.z).mul(vCol.w).toVar();
      const isGlaze = vMisc.x.greaterThan(3.5);
      const brushLoad = select(vMisc.x.lessThan(0.5), float(LOAD.round), select(vMisc.x.lessThan(1.5), float(LOAD.spray),
        select(vMisc.x.lessThan(2.5), float(LOAD.bristle), float(0)))); // scrape and glaze lay no thickness
      const load = select(vExtra.x.lessThan(0), brushLoad, vExtra.x);
      // Impasto: the paint is laid thicker and thinner across the dab, in ridges along the stroke.
      // In target space (the ortho pass fills the target, so screenUV is it), so overlapping dabs agree.
      const ridge = mx_noise_float(vec3(screenUV.x.mul(PAINT_W / 10), screenUV.y.mul(PAINT_H / 10), vMisc.y.mul(0.01))).mul(0.35).add(1);
      mat.colorNode = v4(vCol.xyz.mul(a), a);
      mat.mrtNode = materialBlended(mrt({
        color: v4(vCol.xyz.mul(a), a),
        props: v4(load.mul(ridge).mul(a), select(isGlaze, (select as any)(a.greaterThan(0.002), vExtra.y, float(0)), min(a.mul(4), vExtra.y)), select(isGlaze, float(0.04), vMisc.z).mul(a), vMisc.w.mul(a)),
      }));
    });
    // Scrapes: Zero / OneMinusSrcAlpha, everything in both targets scaled down where the blade passes.
    this.scrape = new Splats((dab, col, misc, _extra, mat) => {
      mat.blendSrc = ZeroFactor; mat.blendDst = OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = ZeroFactor; mat.blendDstAlpha = OneMinusSrcAlphaFactor;
      const vCol: any = varying(col), vMisc: any = varying(misc);
      mat.positionNode = dabPosition(dab);
      const a = dabShape(vMisc.x, vMisc.y, float(0)).mul(vCol.w).toVar();
      mat.colorNode = v4(0, 0, 0, a);
      mat.mrtNode = materialBlended(mrt({ color: v4(0, 0, 0, a), props: v4(0, 0, 0, a) }));
    });
    this.scene.add(this.paint.mesh, this.scrape.mesh);

    // Zeroes both attachments: renderer.clear() leaves alpha 1 on the second.
    {
      const mat = new NodeMaterial();
      mat.blending = NoBlending; mat.depthTest = false; mat.depthWrite = false;
      mat.colorNode = v4(0, 0, 0, 0);
      mat.mrtNode = mrt({ color: v4(0, 0, 0, 0), props: v4(0, 0, 0, 0) });
      this.zero = new QuadMesh(mat);
    }

    // The run pass, one material per direction since the texture nodes are fixed at build time.
    this.simQuads = [0, 1].map((from) => {
      const src = this.targets[from];
      const mat = new NodeMaterial();
      mat.blending = NoBlending; mat.depthTest = false; mat.depthWrite = false;
      const px = vec2(1 / PAINT_W, 1 / PAINT_H);
      const here = uv();
      // Where paint starts to run varies a little across the surface, in lanes along the flow, so sheets break
      // into drips whichever way they run: fine noise across the flow, coarse along it.
      // The lanes: noise 0..1, raised so that most lanes sit high (hold) and a few dip low (run), the more so the
      // sharper; lane width in texels.
      const lanes = (p: any, dir: any) => {
        const t = p.mul(vec2(PAINT_W, PAINT_H));
        const along = t.dot(dir), across = t.dot(vec2(dir.y.negate(), dir.x));
        const n = mx_noise_float(vec3(across.div(uLane), along.div(uLane.mul(30)), 0)).mul(0.5).add(0.5); // long lanes along the flow
        const open = pow(n, uLaneSharp).toVar(); // 1 in the runniest lanes, 0 in the stiffest
        return { hold: uRunAt.add(float(1).sub(open).mul(uRunNoise)), open };
      };
      // Gravity on the sphere at a texel, in texture space: the object-space gravity projected on the tangents
      // of three's sphere mapping (u round the y axis, v from the bottom pole up), scaled to texels. Its
      // strength is what is left after the part straight into or out of the surface.
      const downAt = (p: any) => {
        const phi = p.x.mul(2 * Math.PI), theta = float(1).sub(p.y).mul(Math.PI);
        const tu = vec3(sin(phi), 0, cos(phi));
        const tv = vec3(cos(phi).mul(cos(theta)), sin(theta), sin(phi).negate().mul(cos(theta)));
        const g = vec2(uGravityObj.dot(tu), uGravityObj.dot(tv));
        const strength = length(g);
        const dir = g.div(max(strength, 1e-5));
        // Share of the flow that goes to the x neighbour and to the y neighbour, by the direction's components.
        const ax = abs(dir.x), ay = abs(dir.y);
        const share = vec2(ax, ay).div(max(ax.add(ay), 1e-5));
        return { dir, strength, share };
      };
      // The long legs are particles (drips.ts); this pass only makes the soft tongues along a stroke's edge.
      const flowOf = (p: any, props: any, d: any) =>
        max(props.x.sub(lanes(p, d.dir).hold), 0).mul(props.y).mul(uRunRate).mul(uGravity).mul(d.strength);
      const c: any = texture(src.textures[0], here).toVar(), p: any = texture(src.textures[1], here).toVar();
      const d = downAt(here);
      const sx = sign(d.dir.x).toVar(), sy = sign(d.dir.y).toVar();
      // Upstream neighbours: the ones gravity points from, in x and in y.
      const upX = here.sub(vec2(sx.mul(px.x), 0)).toVar(), upY = here.sub(vec2(0, sy.mul(px.y))).toVar();
      const cX: any = texture(src.textures[0], upX).toVar(), pX: any = texture(src.textures[1], upX).toVar();
      const cY: any = texture(src.textures[0], upY).toVar(), pY: any = texture(src.textures[1], upY).toVar();
      const dX = downAt(upX), dY = downAt(upY);
      const leaving: any = min(flowOf(here, p, d), p.x).toVar();
      // What the neighbours send our way: their flow, times the share they send along this axis towards us.
      const towardX = max(dX.dir.x.mul(sx), 0).div(max(abs(dX.dir.x).add(abs(dX.dir.y)), 1e-5));
      const towardY = max(dY.dir.y.mul(sy), 0).div(max(abs(dY.dir.x).add(abs(dY.dir.y)), 1e-5));
      const inX: any = min(flowOf(upX, pX, dX), pX.x).mul(towardX).toVar();
      const inY: any = select(upY.y.greaterThanEqual(0).and(upY.y.lessThanEqual(1)), min(flowOf(upY, pY, dY), pY.x).mul(towardY), float(0)).toVar();
      const arriving = inX.add(inY).toVar();
      const fOut = leaving.div(max(p.x, 1e-4));
      const fInX = inX.div(max(pX.x, 1e-4)).toVar(), fInY = inY.div(max(pY.x, 1e-4)).toVar();
      // Pigment stains: the paint leaves, but the colour it leaves behind never drops under a trail's worth.
      const keep = max(float(1).sub(fOut), min(float(1), float(TRAIL).div(max(c.w, 1e-4)))).toVar();
      const moved: any = c.mul(keep).add(cX.mul(fInX)).add(cY.mul(fInY)).toVar();
      // Coverage can't pass 1: scale the premultiplied colour back with it.
      const over = max(moved.w, 1).toVar();
      const color = moved.div(over);
      // A high cap: a drop collects a column's worth of paint on its way down and must keep it, or it is lost.
      const thick = min(p.x.sub(leaving).add(arriving), 8);
      const wetIn = max(select(inX.greaterThan(0), pX.y, float(0)), select(inY.greaterThan(0), pY.y, float(0)));
      const wet = min(max(max(p.y.sub(uDry), 0), wetIn), 1);
      const rough = p.z.mul(keep).add(pX.z.mul(fInX)).add(pY.z.mul(fInY)).div(over);
      const metal = p.w.mul(keep).add(pX.w.mul(fInX)).add(pY.w.mul(fInY)).div(over);
      // Wet paint also evens out across the flow, so runs round off instead of staying in texel lanes.
      const across = vec2(d.dir.y.negate(), d.dir.x).mul(px).toVar();
      const cL: any = texture(src.textures[0], here.sub(across)), cR: any = texture(src.textures[0], here.add(across));
      const pL: any = texture(src.textures[1], here.sub(across)), pR: any = texture(src.textures[1], here.add(across));
      const k = uSpread.mul(wet).toVar();
      const colorRun: any = v4(mix(color, cL.add(cR).mul(0.5), k)).toVar(); // vec4, whatever the typing thinks
      const propsRun: any = v4(mix(v4(thick, wet, rough, metal), v4(pL.x.add(pR.x).mul(0.5), wet, pL.z.add(pR.z).mul(0.5), pL.w.add(pR.w).mul(0.5)), k)).toVar();
      // Wet on wet: a thin wash floats out while it is wet. Its colour (and finish) diffuses into the four
      // neighbours a few texels off, through a water field of noise so the edge fingers rather than fans, and the
      // wetness goes along, a little less each hop, so the front keeps moving until it dries. Where there is
      // colour already it mixes in; thick paint is left alone.
      const b = vec2(4 / PAINT_W, 4 / PAINT_H);
      const cN = [vec2(b.x, 0), vec2(b.x, 0).negate(), vec2(0, b.y), vec2(0, b.y).negate()].map((o) => texture(src.textures[0], here.add(o)));
      const pN = [vec2(b.x, 0), vec2(b.x, 0).negate(), vec2(0, b.y), vec2(0, b.y).negate()].map((o) => texture(src.textures[1], here.add(o)));
      const cAvg: any = cN[0].add(cN[1]).add(cN[2]).add(cN[3]).mul(0.25);
      const pAvg: any = pN[0].add(pN[1]).add(pN[2]).add(pN[3]).mul(0.25);
      // Clamped: laid wetness blends on top of what is there and can read over 1 straight after a dab.
      const wetN: any = min(max(max(pN[0].y, pN[1].y), max(pN[2].y, pN[3].y)), 1);
      const water = mx_noise_float(vec3(here.x.mul(PAINT_W / 22), here.y.mul(PAINT_H / 22), 11)).mul(0.5).add(0.5).mul(0.85).add(0.15);
      const thin = float(1).sub(min(max(propsRun.x.mul(4), 0), 1));
      const wetBleed: any = min(max(propsRun.y, wetN.mul(0.9)), 1).mul(thin); // the water reaches out, a tenth less each hop
      const kB = uBleed.mul(wetBleed).mul(thin).mul(water).toVar();
      // Grows, never thins: a texel takes on what its neighbours have more of, capped lower the further the water
      // has carried it, so a bloom fades out towards its edge and keeps its heart. Two washes meeting bleed into
      // each other the same way, channel by channel.
      const reach = wetBleed.mul(wetBleed).mul(wetBleed).mul(wetBleed).toVar();
      const want: any = cAvg.mul(reach).toVar();
      const grow = v4(max(want.x.sub(colorRun.x), 0), max(want.y.sub(colorRun.y), 0), max(want.z.sub(colorRun.z), 0), max(want.w.sub(colorRun.w), 0));
      const colorOut = colorRun.add(grow.mul(kB));
      const propsOut = v4(propsRun.x, select(thin.greaterThan(0.5), wetBleed, propsRun.y),
        propsRun.z.add(max(pAvg.z.mul(reach).sub(propsRun.z), 0).mul(kB)), propsRun.w.add(max(pAvg.w.mul(reach).sub(propsRun.w), 0).mul(kB)));
      mat.colorNode = colorOut;
      mat.mrtNode = mrt({ color: colorOut, props: propsOut });
      return new QuadMesh(mat);
    });
    this.point();
  }

  /** Queue one dab. Wraps across the u seam when the dab reaches it. */
  add(d: Dab) {
    const halfU = d.size / Math.max(Math.sin(d.v * Math.PI), 0.02) * 0.25;
    const s = d.brush === 'scrape' ? this.scrape : this.paint;
    s.push(d, 0);
    if (d.u - halfU < 0) s.push(d, 1);
    if (d.u + halfU > 1) s.push(d, -1);
  }

  clear() { this.cleared = false; }

  /** Dev: total thickness and coverage over the whole target, to check the run keeps its paint. */
  async total(renderer: WebGPURenderer) {
    const t = this.targets[this.cur];
    const half = (h: number) => { const s = (h >> 15) & 1, e = (h >> 10) & 31, f = h & 1023; const m = e === 0 ? f / 1024 * 2 ** -14 : (1 + f / 1024) * 2 ** (e - 15); return (s ? -1 : 1) * m; };
    const p = await renderer.readRenderTargetPixelsAsync(t, 0, 0, PAINT_W, PAINT_H, 1);
    const c = await renderer.readRenderTargetPixelsAsync(t, 0, 0, PAINT_W, PAINT_H, 0);
    let thick = 0, cov = 0, wet = 0;
    for (let i = 0; i < PAINT_W * PAINT_H; i++) { thick += half(p[i * 4]); wet += half(p[i * 4 + 1]); cov += half(c[i * 4 + 3]); }
    return { thick: +thick.toFixed(1), wet: +wet.toFixed(1), cov: +cov.toFixed(1) };
  }

  /** Dev: one texel's colour and props at (u, v). */
  async probeAt(renderer: WebGPURenderer, u: number, v: number) {
    const t = this.targets[this.cur];
    const x = Math.round(u * PAINT_W), y = Math.round(v * PAINT_H);
    const half = (h: number) => { const s = (h >> 15) & 1, e = (h >> 10) & 31, f = h & 1023; const m = e === 0 ? f / 1024 * 2 ** -14 : (1 + f / 1024) * 2 ** (e - 15); return (s ? -1 : 1) * m; };
    const c = await renderer.readRenderTargetPixelsAsync(t, x, y, 1, 1, 0);
    const p = await renderer.readRenderTargetPixelsAsync(t, x, y, 1, 1, 1);
    return { a: +half(c[3]).toFixed(3), t: +half(p[0]).toFixed(3), w: +half(p[1]).toFixed(3) };
  }

  /** Dev: read one texel of colour and props at (u, v). */
  async probe(renderer: WebGPURenderer, v: number) {
    const t = this.targets[this.cur];
    const y = Math.round(v * PAINT_H);
    const half = (h: number) => { // fp16 bits to number
      const s = (h >> 15) & 1, e = (h >> 10) & 31, f = h & 1023;
      const m = e === 0 ? f / 1024 * 2 ** -14 : (1 + f / 1024) * 2 ** (e - 15);
      return (s ? -1 : 1) * m;
    };
    const c = await renderer.readRenderTargetPixelsAsync(t, 0, y, PAINT_W, 1, 0);
    const p = await renderer.readRenderTargetPixelsAsync(t, 0, y, PAINT_W, 1, 1);
    let best = 0, bx = -1;
    for (let x = 0; x < PAINT_W; x++) { const a = half(c[x * 4 + 3]); if (a > best) { best = a; bx = x; } }
    const px = (arr: ArrayLike<number>, x: number) => [0, 1, 2, 3].map((i) => +half(arr[x * 4 + i]).toFixed(3));
    return { bx, u: bx / PAINT_W, color: px(c, Math.max(bx, 0)), props: px(p, Math.max(bx, 0)), empty: { color: px(c, 10), props: px(p, 10) } };
  }

  private point() {
    const t = this.targets[this.cur];
    this.colorNode.value = t.textures[0] as Texture;
    this.propsNode.value = t.textures[1] as Texture;
    for (const r of this.readers) r.node.value = t.textures[r.index];
  }

  /** Splat the queued dabs, run the paint, swap. Call once per frame before the main render. */
  flush(renderer: WebGPURenderer, dt = 1 / 120) {
    sim.flushes++;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    if (!this.cleared) {
      for (const t of this.targets) { renderer.setRenderTarget(t); this.zero.render(renderer); }
      this.cleared = true;
    }
    renderer.autoClear = false;
    // 1. dabs and scrapes into the current target
    this.paint.prepare();
    this.scrape.prepare();
    if (this.paint.count > 0 || this.scrape.count > 0) {
      renderer.setRenderTarget(this.targets[this.cur]);
      renderer.render(this.scene, this.camera);
      this.paint.count = 0;
      this.scrape.count = 0;
    }
    // 2. run and dry: current -> next, then swap
    uRunAt.value = sim.runAt; uRunNoise.value = sim.runNoise; uLane.value = sim.lane; uLaneSharp.value = sim.laneSharp; uRunRate.value = sim.runRate; uDry.value = sim.dry; uGravity.value = sim.gravity; uSpread.value = sim.spread; uBleed.value = sim.bleed; uGravityObj.value.copy(sim.gravityObj);
    // The run moves at most a texel a step, so slow frames take more steps: the pace is the same at 60 and 120.
    const steps = Math.max(1, Math.min(4, Math.round(dt * 120)));
    for (let i = 0; i < steps; i++) {
      const next = 1 - this.cur;
      renderer.setRenderTarget(this.targets[next]);
      this.simQuads[this.cur].render(renderer);
      this.cur = next;
    }
    this.point();
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
  }
}
