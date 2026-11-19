// The weather. Three entry points over the same grid:
//   pickMain  one ray from the pointer, where the tool lands
//   sim       falling water and sediment, and the wearing, in 2x2x2 blocks
//   support   rock that has lost its way to the ground turns to rubble

struct StepU {
  off: vec4u,  // block offset per axis (0 or 1), w: step
  seed: vec4u,
};

@group(0) @binding(0) var<storage, read_write> cells: array<u32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<uniform> su: StepU;
@group(0) @binding(3) var<storage, read_write> pk: Pick;

@compute @workgroup_size(1)
fn pickMain() {
  var pos = vec4f(0.0);
  var n = vec4f(0.0);
  if (u.p1.w > 0.5) {
    let h = march(u.rayO.xyz, u.rayD.xyz);
    if (h.hit) {
      pos = vec4f(vec3f(h.cell) + 0.5, 1.0);
      n = vec4f(h.n, 0.0);
    }
  }
  pk.pos = pos;
  pk.n = n;
}

fn ty(c: u32) -> u32 { return c & 7u; }

fn dens(c: u32) -> u32 {
  let t = c & 7u;
  if (t == AIR) { return 0u; }
  if (t == WATER) { return 1u; }
  if (t == SED) { return 2u; }
  return 9u;
}

fn loose(c: u32) -> bool {
  let t = c & 7u;
  return t == WATER || t == SED;
}

fn getE(c: u32) -> u32 { return (c >> 12u) & 15u; }
fn setE(c: u32, e: u32) -> u32 { return (c & 0xFFFF0FFFu) | (e << 12u); }

fn rnd(st: ptr<function, u32>) -> f32 {
  *st = pcg(*st);
  return f32(*st >> 8u) / 16777216.0;
}

// rock to sediment of the same layer and shade, or to nothing
fn crumble(c: u32, st: ptr<function, u32>, yield_: f32) -> u32 {
  if (rnd(st) < yield_) { return (c & 0x378u) | SED; }
  return AIR;
}

fn softOf(c: u32) -> f32 {
  var s = SOFT[(c >> 3u) & 15u];
  if ((c & 0x400u) != 0u) { s *= 4.0; }
  return s;
}

fn cellPos(b0: vec3i, k: i32) -> vec3i {
  return b0 + vec3i(k & 1, (k >> 2) & 1, (k >> 1) & 1);
}

// Margolus blocks: the grid is cut in 2x2x2 blocks, the cut shifts every step. A block only
// ever touches its own eight cells, so every block can run at once and nothing is lost or doubled.
// In a block, k = dx + 2 dz + 4 dy: 0-3 is the lower floor, 4-7 the upper.
@compute @workgroup_size(4, 4, 4)
fn sim(@builtin(global_invocation_id) gid: vec3u) {
  let b0 = vec3i(gid) * 2 - vec3i(su.off.xyz);
  if (b0.x >= GX || b0.y >= GY || b0.z >= GZ) { return; }
  var st = pcg(gid.x + pcg(gid.y + pcg(gid.z + su.seed.x)));

  let held = u.rayO.w > 0.5 && pk.pos.w > 0.5;
  let tool = u32(u.rayD.w);
  let rainR = u.wind.w;
  let windR = u.res.w;

  var c: array<u32, 8>;
  var o: array<u32, 8>;
  var inb: array<bool, 8>;

  for (var k = 0; k < 8; k++) {
    let p = cellPos(b0, k);
    let ib = inGrid(p);
    inb[k] = ib;
    var v = WALL;
    if (ib) { v = cells[idx(p)]; }
    o[k] = v;
    if (ib) {
      let t = v & 7u;
      let edge = p.x == 0 || p.z == 0 || p.x == GX - 1 || p.z == GZ - 1;
      if (edge && (t == WATER || t == SED)) {
        // over the edge of the plinth
        v = AIR;
      } else if (t == WATER) {
        let e = getE(v);
        if (rnd(&st) < u.p0.z) { v = AIR; }
        else if (e > 0u) { v = setE(v, e - 1u); }
      } else if (t == AIR && held) {
        let fp = vec3f(p) + 0.5;
        if (tool == 1u && p.y >= GY - 2) {
          if (distance(fp.xz, pk.pos.xz) < rainR && rnd(&st) < u.p0.w) { v = WATER | 0xF000u; }
        } else if (tool == 2u) {
          if (distance(fp, pk.pos.xyz + pk.n.xyz * 3.0) < 3.2 && rnd(&st) < u.p1.y) { v = WATER | 0xF000u; }
        }
      }
    }
    c[k] = v;
  }

  // what the block holds
  var air = false;
  var we = 0.0;
  var nw = 0;
  var lone = 0;
  for (var k = 0; k < 8; k++) {
    let t = ty(c[k]);
    if (t == AIR) { air = true; }
    if (t == WATER) { we += f32(getE(c[k])); nw++; lone = k; }
  }
  we /= 15.0;

  // a single drop left lying dries up fast: no film of specks on everything
  if (nw == 1 && getE(c[lone]) == 0u && rnd(&st) < u.p0.z * 25.0) { c[lone] = AIR; }

  // water wears rock, moving water more, and a stream far more than its drops would one by one
  // (the square: the stream power law, what cuts gullies instead of pitting every wall)
  if (we > 0.0) {
    for (var k = 0; k < 8; k++) {
      if (ty(c[k]) == ROCK && rnd(&st) < u.p0.x * softOf(c[k]) * we * we * 0.5) {
        c[k] = crumble(c[k], &st, u.p0.y);
      }
    }
  }

  // the jet: wind is a wide sandblast around the pointer that leaves little behind,
  // the water tool a narrow hard one. On rock that has air or water next to it.
  var jetR = 0.0;
  var jetRate = 0.0;
  var jetYield = 0.3;
  if (held && tool == 3u) { jetR = windR; jetRate = u.p1.x; }
  if (held && tool == 2u) { jetR = 3.6; jetRate = u.p1.x * 1.5; jetYield = u.p0.y; }
  let centre = vec3f(b0) + 1.0;
  let jetD = distance(centre, pk.pos.xyz);
  let blast = jetD < jetR;
  if (blast && (air || nw > 0)) {
    let f = 1.0 - jetD / jetR;
    for (var k = 0; k < 8; k++) {
      if (ty(c[k]) == ROCK && rnd(&st) < jetRate * softOf(c[k]) * f) {
        c[k] = crumble(c[k], &st, jetYield);
      } else if (tool == 2u && ty(c[k]) == SED && rnd(&st) < 0.2 * f) {
        // the water jet flushes its own hole, or the sediment would plug it
        c[k] = AIR;
      }
    }
  }

  // straight down: the heavier one sinks
  for (var k = 0; k < 4; k++) {
    let a = c[k + 4];
    let b = c[k];
    if (loose(a) && dens(b) < dens(a)) {
      if (ty(b) == WATER && rnd(&st) < 0.5) { continue; }
      var na = a;
      if (ty(a) == WATER) { na = setE(a, 15u); }
      c[k] = na;
      c[k + 4] = b;
    }
  }

  // down a slope: blocked below, free beside and below that
  for (var k = 4; k < 8; k++) {
    let a = c[k];
    if (!loose(a) || dens(c[k - 4]) < dens(a)) { continue; }
    let j = (k - 4) ^ select(1, 2, rnd(&st) < 0.5);
    if (dens(c[j + 4]) < dens(a) && dens(c[j]) < dens(a)) {
      if (ty(a) == SED && rnd(&st) < 0.35) { continue; }
      var na = a;
      if (ty(a) == WATER) { na = setE(a, 15u); }
      let b = c[j];
      c[j] = na;
      c[k] = b;
    }
  }

  // sideways: water spreads, and running water carries sediment with it
  for (var fl = 0; fl < 2; fl++) {
    let alongX = rnd(&st) < 0.5;
    for (var q = 0; q < 2; q++) {
      var i = fl * 4 + q;
      var j = i + 2;
      if (alongX) { i = fl * 4 + q * 2; j = i + 1; }
      let a = c[i];
      let b = c[j];
      let ta = ty(a);
      let tb = ty(b);
      if ((ta == WATER && tb == AIR) || (ta == AIR && tb == WATER)) {
        c[i] = b;
        c[j] = a;
      } else if ((ta == SED && tb == WATER) || (ta == WATER && tb == SED)) {
        let e = max(getE(a) * u32(ta == WATER), getE(b) * u32(tb == WATER));
        if (e > 4u && rnd(&st) < 0.25) {
          c[i] = b;
          c[j] = a;
        }
      }
    }
  }

  // the wind pushes what is loose, and takes some of the dust away
  if (blast && tool == 3u) {
    let w = u.wind.xyz;
    let alongX = rnd(&st) < abs(w.x) / (abs(w.x) + abs(w.z) + 1e-5);
    for (var fl = 0; fl < 2; fl++) {
      for (var q = 0; q < 2; q++) {
        var i = fl * 4 + q;
        var j = i + 2;
        var fwd = w.z > 0.0;
        if (alongX) { i = fl * 4 + q * 2; j = i + 1; fwd = w.x > 0.0; }
        if (!fwd) { let tmp = i; i = j; j = tmp; }
        if (loose(c[i]) && ty(c[j]) == AIR && rnd(&st) < 0.8) {
          c[j] = c[i];
          c[i] = AIR;
          if (ty(c[j]) == SED && rnd(&st) < 0.03) { c[j] = AIR; }
        }
      }
    }
  }

  for (var k = 0; k < 8; k++) {
    if (inb[k] && c[k] != o[k]) { cells[idx(cellPos(b0, k))] = c[k]; }
  }
}

// Every rock cell keeps its distance to the ground, counted through rock: one more than its
// nearest neighbour's. Cut a piece loose and its numbers have nothing to hold on to, they
// climb a step each pass. Past the limit, it is not standing on anything: rubble.
@compute @workgroup_size(4, 4, 4)
fn support(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec3i(gid);
  if (p.x >= GX || p.y >= GY || p.z >= GZ) { return; }
  let i = idx(p);
  let c = cells[i];
  if ((c & 7u) != ROCK) { return; }
  var m = 4094u;
  for (var a = 0; a < 6; a++) {
    var d = vec3i(0);
    d[a >> 1] = (a & 1) * 2 - 1;
    let q = p + d;
    if (!inGrid(q)) { continue; }
    let nb = cells[idx(q)];
    let t = nb & 7u;
    if (t == GROUND) { m = 0u; }
    else if (t == ROCK) { m = min(m, (nb >> 16u) & 0xFFFu); }
  }
  let dist = m + 1u;
  if (f32(dist) >= u.p1.z) {
    cells[i] = (c & 0x378u) | SED;
  } else if (dist != ((c >> 16u) & 0xFFFu)) {
    cells[i] = (c & 0xF000FFFFu) | (dist << 16u);
  }
}
