// The picture: one orthographic ray per pixel through the grid, one flat tone per voxel face.

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<storage, read> pk: Pick;
// the saucer on its own, upright, in a small grid (world.ts MODEL): what flies when it flies
@group(0) @binding(3) var<storage, read> model: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn solid(p: vec3i) -> f32 {
  if (!inGrid(p)) { return 0.0; }
  return f32(ty(cells[idx(p)]) >= SED);
}

// The backdrop: a sky, cool and pale at the top, the paper of the page in the middle, warm
// towards the ground. Drawn the way the rest is, in whole pixels: a dozen flat bands, each
// stippled into the next (ordered dither), not a smooth ramp.
const SKY_TOP = vec3f(0.800, 0.862, 0.878);
const SKY_LOW = vec3f(0.953, 0.847, 0.741);

fn bayer(p: vec2f) -> f32 {
  let m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[(u32(p.x) & 3u) + ((u32(p.y) & 3u) << 2u)] + 0.5) / 16.0;
}

fn backdrop(px: vec2f) -> vec3f {
  let bands = 12.0;
  let v = clamp(px.y / u.res.y, 0.0, 1.0) * bands;
  // which band this pixel takes: the one it is in, or the next, by the dither
  let t = (floor(v) + step(bayer(px), fract(v))) / bands;
  let c = mix(SKY_TOP, BG, smoothstep(0.0, 0.5, t));
  return mix(c, SKY_LOW, smoothstep(0.45, 1.0, t));
}

const WATER_SHALLOW = vec3f(0.16, 0.62, 0.66);
const WATER_DEEP = vec3f(0.04, 0.33, 0.42);

fn h2(p: vec2f, t: u32) -> f32 {
  return unit(pcg(u32(p.x) + pcg(u32(p.y) + pcg(t))));
}

// The end of the hose's jet, drawn over the picture. The jet goes along the line of sight, so
// all there is to see of it is where it lands: a white core the width of the jet, and spray
// flying out from it in streaks, thinning with distance.
fn hoseJet(col: vec3f, px: vec2f) -> vec3f {
  if (!working() || toolNow() != HOSE) { return col; }
  let core = max(u.tool.y / u.camR.w * 0.45, 2.0); // the jet's radius where it lands, in pixels
  let d = px - u.pointer.xy;
  let r = length(d);
  if (r > core * 4.5) { return col; }
  let tick = u32(u.res.z * 30.0);
  if (r < core) {
    // the core, boiling
    return mix(vec3f(0.97, 1.0, 1.0), vec3f(0.62, 0.88, 0.92), step(0.7, h2(px, tick)));
  }
  // the spray: spokes round the core, each a run of specks moving outward
  let out = (r - core) / (core * 3.5); // 0 at the core's edge, 1 where the spray gives out
  let spoke = floor((atan2(d.y, d.x) + 3.1416) * 5.0);
  let run = fract(out * 2.2 - u.res.z * 3.5 + h2(vec2f(spoke, 1.0), 3u));
  if (h2(vec2f(spoke, 5.0), 9u) < 0.75 && run < 0.4 * (1.0 - out) && h2(px, tick) < 0.85) {
    return mix(vec3f(0.92, 0.98, 0.98), vec3f(0.45, 0.8, 0.85), out);
  }
  return col;
}

// A voxel's own tone: its layer's colour, its shade, a grain.
fn tone(c: u32, cell: vec3i) -> vec3f {
  let layer = layerOf(c);
  var bcol = PAL[layer];
  if (ty(c) != GROUND) {
    bcol *= 0.88 + 0.05 * f32((c >> 8u) & 3u);
    if (layer != METAL) { bcol *= 0.96 + 0.08 * grain(cell); } // metal is smooth
  }
  if (ty(c) == SED) { bcol = mix(bcol, vec3f(0.86, 0.68, 0.52), 0.3); }
  return bcol;
}

// What gives light of its own, over the lit tone: lamps, a glint.
fn lights(lit: vec3f, c: u32, cell: vec3i, rate: f32) -> vec3f {
  let layer = layerOf(c);
  let shade = (c >> 8u) & 3u;
  var col = lit;
  // the saucer's lamps: one in four lit, and the light runs round the rim
  if (layer == LAMP) {
    col = select(PAL[LAMP] * 0.5, vec3f(1.0, 0.97, 0.78), shade == (u32(u.res.z * rate) & 3u));
  }
  // gold glints: a voxel here, a voxel there, a moment each
  if (layer == GOLD && h2(vec2f(cell.xy) + vec2f(0.0, f32(cell.z) * 191.0), u32(u.res.z * 5.0)) > 0.93) {
    col = mix(col, vec3f(1.0), 0.75);
  }
  return col;
}

// The saucer in flight is not in the block's grid. It is a small grid of its own, walked the
// same way, in its own frame: wherever it is and however it is turned, its voxels stay voxels.
struct Craft {
  hit: bool,
  t: f32,      // how far along the ray
  cell: vec3i,
  n: vec3f,    // the face, turned back into the world
  c: u32,
  glass: f32,  // glass cells crossed on the way, and how far along the first was
  gt: f32,
  gn: vec3f,
};

fn marchCraft(ro: vec3f, rd: vec3f) -> Craft {
  var h: Craft;
  h.hit = false;
  h.glass = 0.0;
  let ax = u.craftX.xyz;
  let ay = u.craftY.xyz;
  let az = u.craftZ.xyz;
  let rel = ro - u.craft.xyz;
  let o = vec3f(dot(rel, ax), dot(rel, ay), dot(rel, az)) + MODEL_AT;
  var d = vec3f(dot(rd, ax), dot(rd, ay), dot(rd, az));
  d = select(d, vec3f(1e-5), abs(d) < vec3f(1e-5)); // the walk divides by these
  let g = vec3f(MODEL);
  let inv = 1.0 / d;
  let ta = (vec3f(0.0) - o) * inv;
  let tb = (g - o) * inv;
  let t0 = min(ta, tb);
  let t1 = max(ta, tb);
  let tn = max(max(t0.x, t0.y), t0.z);
  let tf = min(min(t1.x, t1.y), t1.z);
  if (tn >= tf || tf <= 0.0) { return h; }

  let sg = sign(d);
  var n = vec3f(0.0, 1.0, 0.0);
  if (t0.x >= t0.y && t0.x >= t0.z) { n = vec3f(-sg.x, 0.0, 0.0); }
  else if (t0.y >= t0.z) { n = vec3f(0.0, -sg.y, 0.0); }
  else { n = vec3f(0.0, 0.0, -sg.z); }
  var t = max(tn, 0.0);
  var cell = vec3i(clamp(floor(o + d * (t + 0.001)), vec3f(0.0), g - 1.0));
  let stp = vec3i(sg);
  let td = abs(inv);
  var tm = (vec3f(cell) + max(sg, vec3f(0.0)) - o) * inv;
  for (var i = 0; i < 130; i++) {
    if (any(cell < vec3i(0)) || any(cell >= MODEL)) { break; }
    let c = model[cell.x + MODEL.x * (cell.z + MODEL.z * cell.y)];
    if (c != 0u) {
      if (layerOf(c) == GLASS) {
        if (h.glass == 0.0) { h.gt = t; h.gn = ax * n.x + ay * n.y + az * n.z; }
        h.glass += 1.0;
      } else {
        h.hit = true;
        h.t = t;
        h.cell = cell;
        h.n = ax * n.x + ay * n.y + az * n.z;
        h.c = c;
        break;
      }
    }
    if (tm.x < tm.y && tm.x < tm.z) {
      t = tm.x; cell.x += stp.x; tm.x += td.x; n = vec3f(-sg.x, 0.0, 0.0);
    } else if (tm.y < tm.z) {
      t = tm.y; cell.y += stp.y; tm.y += td.y; n = vec3f(0.0, -sg.y, 0.0);
    } else {
      t = tm.z; cell.z += stp.z; tm.z += td.z; n = vec3f(0.0, 0.0, -sg.z);
    }
  }
  return h;
}

const SHADE = vec3f(0.5, 0.47, 0.58); // what is not in the sun

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = floor(fc.xy) + 0.5;
  let sx = (px.x - u.res.x * 0.5) * u.camR.w;
  let sy = (u.res.y * 0.5 - px.y) * u.camR.w;
  let ro = u.camO.xyz + u.camR.xyz * sx + u.camU.xyz * sy;
  let h = march(ro, u.camF.xyz);

  var col = backdrop(px);
  if (h.hit) {
    let bcol = tone(h.c, h.cell);

    // the whole face gets one light: asked from its centre, not from the pixel
    let cen = vec3f(h.cell) + 0.5;
    let ni = vec3i(h.n);
    let lam = max(dot(h.n, u.sun.xyz), 0.0);
    var lit = lam > 0.0;
    if (lit) { lit = !march(cen + h.n * 0.52, u.sun.xyz).hit; }

    // corners: the four cells that lean over this face
    let ta = vec3i(abs(h.n).yzx);
    let tb = vec3i(abs(h.n).zxy);
    let ao = solid(h.cell + ni + ta) + solid(h.cell + ni - ta) + solid(h.cell + ni + tb) + solid(h.cell + ni - tb);

    if (lit) {
      col = bcol * (0.62 + 0.5 * lam);
    } else {
      col = bcol * SHADE;
    }
    col *= 1.0 - 0.07 * ao;
    col = lights(col, h.c, h.cell, 5.0);

    // the brush, drawn on the rock
    if (pk.pos.w > 0.5) {
      let tool = toolNow();
      if (tool == WIND) {
        // The wind blows straight in, so what there is to see of it is the air spreading over
        // what it hits: dashes running outward from where it is aimed, fainter where it is
        // weaker. Faint while only aimed, plain while it blows.
        let on = windOn(cen, pk.pos.xyz, u.camF.xyz, u.tool.y);
        let d = px - u.pointer.xy;
        let reach = length(d) * u.camR.w; // in voxels, on the screen
        let turn = (atan2(d.y, d.x) + 3.1416) * 14.0;
        let spoke = floor(turn);
        let run = fract(reach * 0.035 - u.res.z * 1.6 + h2(vec2f(spoke, 2.0), 5u));
        // thin spokes, or far out a dash is a slab
        if (h2(vec2f(spoke, 7.0), 11u) < 0.6 && run < 0.22 && fract(turn) * reach < 1.6) {
          col = mix(col, vec3f(1.0), on * select(0.14, 0.38, u.pointer.w > 0.5));
        }
      } else {
        var d = distance(cen, pk.pos.xyz);
        var show = true;
        // rain falls in a column: its ring only on what faces up
        if (tool == RAIN) { d = distance(cen.xz, pk.pos.xz); show = h.n.y > 0.5; }
        if (show && abs(d - u.tool.y) < 0.6) { col = mix(col, vec3f(1.0), 0.45); }
      }
    }
  }

  // glass: a pale wash over what is behind it, lighter on the faces the sun is on
  if (h.glass > 0.0) {
    col = mix(col, PAL[GLASS], 0.2 + 0.3 * max(dot(h.gn, u.sun.xyz), 0.0));
  }
  if (h.water > 0.0) {
    // how much water the ray went through: whole voxels, and how full the first one is
    let first = cells[idx(h.wcell)];
    let through = h.water - 1.0 + f32((first >> 8u) & 15u) / 15.0;
    let depth = clamp(through / 10.0, 0.0, 1.0);
    var wcol = mix(WATER_SHALLOW, WATER_DEEP, depth);
    if (h.wn.y > 0.5) { wcol *= 1.12; } else { wcol *= 0.92; }
    // white water: what runs or falls is lighter than what lies still
    let rush = f32((first >> 12u) & 15u) / 15.0;
    wcol = mix(wcol, vec3f(0.78, 0.94, 0.93), 0.5 * rush);
    // a film is a sheen, a hand's depth is water
    col = mix(col, wcol, (0.45 + 0.5 * depth) * min(through * 2.5, 1.0));
  }
  // the saucer, flying: over whatever of the block is behind it
  if (u.craft.w > 0.5) {
    let k = marchCraft(ro, u.camF.xyz);
    var behind = 1e9; // how far along this ray the block is
    if (h.hit) { behind = dot(vec3f(h.cell) + 0.5 - ro, u.camF.xyz); }
    if (k.hit && k.t < behind) {
      let lam = max(dot(k.n, u.sun.xyz), 0.0);
      let bcol = tone(k.c, k.cell);
      col = lights(select(bcol * SHADE, bcol * (0.62 + 0.5 * lam), lam > 0.0), k.c, k.cell, 16.0); // its lamps racing
    }
    if (k.glass > 0.0 && k.gt < behind) {
      col = mix(col, PAL[GLASS], 0.2 + 0.3 * max(dot(k.gn, u.sun.xyz), 0.0));
    }
  }
  col = hoseJet(col, floor(fc.xy));
  return vec4f(col, 1.0);
}
