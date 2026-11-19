// The weather. The rock and what falls off it live in the voxel grid; the water lives on top
// of it, as a depth per column. Entry points:
//   skyline   every column's highest rock (what lies open to the sky) and its bed (where water stands)
//   pickMain  one ray from the pointer, where the tool lands
//   sim       falling sediment, the wind, the hose and the scratch, in 2x2x2 blocks
//   support   rock that has lost its way to the ground turns to rubble
//   flow      water: how much leaves each column for each neighbour
//   settle    water: the new depth, the rain and the spring, and the bed it wears down
//   grow      what is green: where the ground has been wet and is then left alone
//   stamp     water and plants drawn into the grid as voxels: the surface, the falls, the rain, grass and trees

struct StepU {
  off: vec4u,  // block offset per axis (0 or 1), w: step
  seed: vec4u,
};

@group(0) @binding(0) var<storage, read_write> cells: array<u32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<uniform> su: StepU;
@group(0) @binding(3) var<storage, read_write> pk: Pick;
@group(0) @binding(4) var<storage, read_write> sky: array<u32>;
// per column: x water depth, y wear (the part of a voxel worn off so far), z bed height,
// w the drop to the lowest neighbour (left by flow) and then the discharge (left by settle)
@group(0) @binding(5) var<storage, read_write> col: array<vec4f>;
// per column: what flows out each step, to -x, +x, -z, +z
@group(0) @binding(6) var<storage, read_write> flux: array<vec4f>;
// per column: how much water has run through lately. It fades over a second or so: a lip the
// water shoots over holds no depth to speak of, but it is where the water runs.
@group(0) @binding(7) var<storage, read_write> ran: array<f32>;
// per column, what grows: x how far along the ground cover is (0 bare, grass, bushes, then a
// tree growing, up to 3), y the bed it grew on, z moisture, w how far along the tufts on a wall beside it are
@group(0) @binding(8) var<storage, read_write> veg: array<vec4f>;

fn ty(c: u32) -> u32 { return c & 7u; }
fn solid(t: u32) -> bool { return t == ROCK || t == GROUND || t == SED; }

// Weather comes from above. Rain and the spring only land on what has no rock over it: the sides of
// the block and what is under an overhang are out of reach until what covers them is gone.
// The bed is where water stands: the top of the rock, or of the sediment lying on it (a grain
// still falling, with nothing under it, is not ground yet).
@compute @workgroup_size(8, 8, 1)
fn skyline(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let z = i32(gid.y);
  if (x >= GX || z >= GZ) { return; }
  var bed = -1;
  var y = GY - 1;
  while (y > 0) {
    let t = ty(cells[idx(vec3i(x, y, z))]);
    if (t == ROCK || t == GROUND) { break; }
    if (t == SED && bed < 0 && solid(ty(cells[idx(vec3i(x, y - 1, z))]))) { bed = y; }
    y--;
  }
  if (bed < 0) { bed = y; }
  let i = x + GX * z;
  sky[i] = u32(y);
  col[i].z = f32(bed + 1);
}

fn openToSky(p: vec3i) -> bool {
  return p.y >= i32(sky[p.x + GX * p.z]);
}

@compute @workgroup_size(1)
fn pickMain() {
  let before = pk.pos;
  var pos = vec4f(0.0);
  var n = vec4f(0.0);
  if (u.p1.w > 0.5) {
    let h = march(u.rayO.xyz, u.rayD.xyz);
    // the wind and the hose are aimed at whatever is there, top or side; rain comes from above
    if (h.hit && (u32(u.rayD.w) >= 2u || openToSky(h.cell))) {
      pos = vec4f(vec3f(h.cell) + 0.5, 1.0);
      n = vec4f(h.n, 0.0);
    } else if (h.hit && abs(h.n.y) < 0.5) {
      // a wall: the weather lands at its foot, on the open ground under the point it was aimed at
      // (the far side of a pit seen at a slant, the side of the block)
      let q = h.cell + vec3i(h.n);
      if (q.x >= 0 && q.x < GX && q.z >= 0 && q.z < GZ) {
        let floorY = i32(sky[q.x + GX * q.z]);
        if (floorY <= q.y) {
          pos = vec4f(vec3f(vec3i(q.x, floorY, q.z)) + 0.5, 1.0);
          n = vec4f(0.0, 1.0, 0.0, 0.0);
        }
      }
    }
  }
  pk.pos = pos;
  pk.was = before;
}

// A water voxel is only a picture of the water, a plant voxel of a plant (see stamp): to what falls, they are air.
fn open(c: u32) -> bool {
  let t = c & 7u;
  return t == AIR || t == WATER || t == PLANT;
}

fn rnd(st: ptr<function, u32>) -> f32 {
  *st = pcg(*st);
  return f32(*st >> 8u) / 16777216.0;
}

// rock to sediment of the same layer and shade, or to nothing
fn crumble(c: u32, st: ptr<function, u32>, yield_: f32) -> u32 {
  if (rnd(st) < yield_) { return (c & 0x378u) | SED; }
  return AIR;
}

// how rotten a rock voxel is, 0 sound to 1 (world.ts bakes it in: pockets, lenses along the beds)
fn rotOf(c: u32) -> f32 {
  return f32((c >> 12u) & 15u) / 15.0;
}

// how easily a rock voxel wears: its layer, a joint, and above all how rotten it is. Sound rock
// goes at a third of its layer's rate, a rotten pocket at six times it.
fn softOf(c: u32) -> f32 {
  var s = SOFT[(c >> 3u) & 15u];
  if ((c & 0x400u) != 0u) { s *= 4.0; }
  let r = rotOf(c);
  return s * (0.35 + 6.0 * r * r * r);
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
  let windR = u.res.w;

  var c: array<u32, 8>;
  var o: array<u32, 8>;
  var inb: array<bool, 8>;
  var air = false;

  for (var k = 0; k < 8; k++) {
    let p = cellPos(b0, k);
    let ib = inGrid(p);
    inb[k] = ib;
    var v = WALL;
    if (ib) { v = cells[idx(p)]; }
    o[k] = v;
    // sediment goes over the edge of the tray: off the side of the grid, or down past the tray's rim to the bottom of it
    if (ib && ty(v) == SED && (p.x == 0 || p.z == 0 || p.x == GX - 1 || p.z == GZ - 1 || p.y == 0)) { v = AIR; }
    if (open(v)) { air = true; }
    c[k] = v;
  }

  // The two jets, both in the hand of whoever is looking, both along the line of sight through
  // the pointer, on whatever is there, top or side. The hose: a pressure washer, narrow and
  // hard. The wind: a hair dryer, wide and gentle (windOn). Either only wears what faces it:
  // rock with nothing in front of it on the side the jet comes from.
  let jet = u.rayD.xyz; // the way the jet goes
  let w = normalize(vec3f(jet.x, 0.0, jet.z)); // and the way the wind carries what is loose
  let centre = vec3f(b0) + 1.0;
  var blast = false;  // is this block in it
  var f = 0.0;        // how much of it is left here
  var rate = u.p1.x;
  if (held && tool == 3u) {
    f = windOn(centre, pk.pos.xyz, jet, windR);
    blast = f > 0.03;
  }
  if (held && tool == 2u) {
    let r = distance(centre, pk.pos.xyz);
    blast = r < u.sun.w;
    f = 1.0 - r / u.sun.w;
    rate = u.p1.y;
  }
  // The scratch: nothing but a point dragged over the rock. It takes what is under it, there and
  // then, whatever it is made of (nearly), and what comes loose falls. It comes in pulses (main.ts
  // holds it down a frame at a time): each is one short mark, along the stroke from where the
  // pointer was the frame before to where it is (unless it jumped: from one face to another, say).
  if (held && tool == 4u) {
    var a = pk.was.xyz;
    let b = pk.pos.xyz;
    if (pk.was.w < 0.5 || distance(a, b) > 40.0) { a = b; }
    let ab = b - a;
    let r = distance(centre, a + ab * clamp(dot(centre - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0));
    blast = r < u.sun.w;
    f = min(2.0 * (1.0 - r / u.sun.w), 1.0); // a clean edge: full across most of its width
    rate = u.p1.y;
  }
  // the axis this block feels the jet along, one of the three (0 x, 1 z, 2 y), and for what the
  // wind pushes one of the two level ones
  let windX = rnd(&st) < abs(w.x) / (abs(w.x) + abs(w.z) + 1e-5);
  var axis = 2;
  let pickAxis = rnd(&st) * (abs(jet.x) + abs(jet.y) + abs(jet.z));
  if (pickAxis < abs(jet.x)) { axis = 0; } else if (pickAxis < abs(jet.x) + abs(jet.z)) { axis = 1; }
  // The wind only reaches the surface: what whoever is looking can see. Rock that faces the right
  // way but has something between it and the eye, the far wall of a canyon, the back of a pit,
  // a ledge behind a tree, is in the lee. One look back along the line of sight per block.
  if (blast && air && tool == 3u) {
    blast = !march(centre - jet * 2.6, -jet).hit;
  }
  if (blast && air) {
    for (var k = 0; k < 8; k++) {
      // the cell in front of this one, on the side the jet comes from, when it is in this block
      // (half the time, hence the 2)
      var nb = -1;
      if (axis == 0) {
        if (jet.x > 0.0 && (k & 1) == 1) { nb = k - 1; }
        if (jet.x < 0.0 && (k & 1) == 0) { nb = k + 1; }
      } else if (axis == 1) {
        if (jet.z > 0.0 && (k & 2) == 2) { nb = k - 2; }
        if (jet.z < 0.0 && (k & 2) == 0) { nb = k + 2; }
      } else {
        if (jet.y < 0.0 && k < 4) { nb = k + 4; }
        if (jet.y > 0.0 && k >= 4) { nb = k - 4; }
      }
      var soft = softOf(c[k]);
      if (tool == 4u) {
        soft = pow(soft, 0.3); // a hard bed slows the scratch a little, it does not stop it
        if (((c[k] >> 3u) & 15u) == BONE) { soft = 0.001; } // bone does: a scratch cleans a skeleton, it does not cut it
      }
      // what is in front of it must be open; and for the wind, not water: it does not reach a lake's bed
      var faced = false;
      if (nb >= 0) { faced = open(c[nb]) && !(tool == 3u && ty(c[nb]) == WATER); }
      if (faced && inb[k] && ty(c[k]) == ROCK && rnd(&st) < rate * 2.0 * soft * f) {
        c[k] = crumble(c[k], &st, select(0.3, 0.6, tool == 4u));
      } else if ((tool == 2u || tool == 4u) && ty(c[k]) == SED && rnd(&st) < select(0.3, 0.5, tool == 4u) * f) {
        // the hose flushes out what it has knocked loose, or it would plug its own hole; the
        // scratch sweeps its groove
        c[k] = AIR;
      }
    }
  }

  // straight down: sediment falls, through water a little slower
  for (var k = 0; k < 4; k++) {
    let a = c[k + 4];
    let b = c[k];
    if (ty(a) == SED && open(b)) {
      if (ty(b) == WATER && rnd(&st) < 0.5) { continue; }
      c[k] = a;
      c[k + 4] = b;
    }
  }

  // down a slope: blocked below, free beside and below that
  for (var k = 4; k < 8; k++) {
    let a = c[k];
    if (ty(a) != SED || open(c[k - 4])) { continue; }
    let j = (k - 4) ^ select(1, 2, rnd(&st) < 0.5);
    if (open(c[j + 4]) && open(c[j]) && rnd(&st) > 0.35) {
      let b = c[j];
      c[j] = a;
      c[k] = b;
    }
  }

  // the wind pushes what is loose, and takes some of the dust away
  if (blast && tool == 3u) {
    for (var fl = 0; fl < 2; fl++) {
      for (var q = 0; q < 2; q++) {
        var i = fl * 4 + q;
        var j = i + 2;
        var fwd = w.z > 0.0;
        if (windX) { i = fl * 4 + q * 2; j = i + 1; fwd = w.x > 0.0; }
        if (!fwd) { let tmp = i; i = j; j = tmp; }
        if (ty(c[i]) == SED && open(c[j]) && rnd(&st) < 0.9) {
          let b = c[j];
          c[j] = c[i];
          c[i] = b;
          if (rnd(&st) < 0.03) { c[j] = AIR; }
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
  // Bone holds itself up, and what hangs on it: a skeleton dug free stands where it stood. (A
  // rib has no rock under it once the rock is gone, and would be rubble by the rule below.)
  if (((c >> 3u) & 15u) == BONE) {
    if (((c >> 16u) & 0xFFFu) != 1u) { cells[i] = (c & 0xF000FFFFu) | (1u << 16u); }
    return;
  }
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

// ---------- water ----------
//
// Virtual pipes (Mei, Decaudin and Hu 2007): every column holds a depth of water and is joined to
// its four neighbours by pipes. What drives the water through a pipe is the difference between
// the two water surfaces, bed plus depth: so it runs downhill, fills a hollow to its lowest rim
// and spills there, and levels out, all from one rule. The flow keeps some of its speed from
// step to step, which is why a pool sloshes before it lies still.

fn grain(x: i32, y: i32, z: i32) -> f32 {
  return f32(pcg(u32(x) + pcg(u32(y) + pcg(u32(z)))) >> 8u) / 16777216.0;
}

// how easily the top voxel of a column wears. Loose sediment goes easily, the ground not at all.
fn softTop(x: i32, top: i32, z: i32) -> f32 {
  if (top <= 0) { return 0.0; }
  let c = cells[idx(vec3i(x, top, z))];
  if (ty(c) == ROCK) { return softOf(c); }
  if (ty(c) == SED) { return 3.0; }
  return 0.0;
}

fn onBlock(x: i32, z: i32) -> bool {
  let lo = (vec2i(GX, GZ) - CUBE) / 2;
  return x >= lo.x && z >= lo.y && x < lo.x + CUBE && z < lo.y + CUBE;
}

// what leaves each column for each neighbour, and the banks
@compute @workgroup_size(8, 8, 1)
fn flow(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let z = i32(gid.y);
  if (x >= GX || z >= GZ) { return; }
  let i = u32(x + GX * z);
  let d = col[i].x;
  let bed = col[i].z;
  // the neighbours: their beds and their water; off the grid nothing holds the water back
  var nb = vec4f(bed);
  var nd = vec4f(0.0);
  var nr = vec4f(0.0);
  if (x > 0) { nb.x = col[i - 1u].z; nd.x = col[i - 1u].x; nr.x = ran[i - 1u]; }
  if (x < GX - 1) { nb.y = col[i + 1u].z; nd.y = col[i + 1u].x; nr.y = ran[i + 1u]; }
  if (z > 0) { nb.z = col[i - u32(GX)].z; nd.z = col[i - u32(GX)].x; nr.z = ran[i - u32(GX)]; }
  if (z < GZ - 1) { nb.w = col[i + u32(GX)].z; nd.w = col[i + u32(GX)].x; nr.w = ran[i + u32(GX)]; }

  // The banks. Water wears its own column, and left at that every column would be cut on its
  // own: slots a voxel wide, spikes left standing between them, a hole with walls straight
  // down. So a column that stands too high above a neighbour where water runs or has just run
  // wears too, the higher the faster: the bank comes down after the bed. A channel opens into
  // a valley, a hole into a funnel, and nothing is left standing in the wet.
  if (onBlock(x, z)) {
    // How high a bank can stand is the rock's business: rotten rock slumps to a slope, sound
    // rock stands as a wall, and a hard bed holds a ledge. So a valley's sides are not one
    // slope from top to bottom, they step and bulge with what they are cut through.
    var stand = 2.0;
    let topCell = cells[idx(vec3i(x, max(i32(bed) - 1, 0), z))];
    if (ty(topCell) == ROCK) {
      stand = 1.0 + 5.0 * (1.0 - rotOf(topCell));
      if (SOFT[(topCell >> 3u) & 15u] < 0.3) { stand += 3.0; }
    }
    var over = 0.0;
    for (var a = 0; a < 4; a++) {
      // only beside water that runs or has just run: a bank stands over a still pond for good
      if (nr[a] > 0.003) { over = max(over, bed - nb[a] - stand); }
    }
    if (over > 0.0) {
      // As fast as the bed can sink (settle), so a cut never gets ahead of its banks. Hard rock
      // holds a bank up longer, but not by as much as it holds up a bed: the square root.
      let hold = sqrt(4.0 * softTop(x, i32(bed) - 1, z));
      col[i].y += min(0.012 * min(u.p0.x * 10.0, 3.0) * hold * min(over, 3.0), 0.03);
    }
  }

  if (d <= 0.0) { flux[i] = vec4f(0.0); col[i].w = 0.0; return; }
  let h = bed + d;
  let nh = nb + nd;
  // a film clings: thin water is slow to get going, so it gathers before it runs
  let grip = d / (d + u.p0.y);
  var f = max(vec4f(0.0), flux[i] * u.wind.z + u.wind.x * grip * (vec4f(h) - nh));
  // never more than is there
  let total = f.x + f.y + f.z + f.w;
  if (total > d) { f *= d / total; }
  flux[i] = f;
  // how far the water drops from here to its lowest neighbour: what settle wears the bed by
  col[i].w = max(h - min(min(nh.x, nh.y), min(nh.z, nh.w)), 0.0);
}

// the new depth, the weather, and the bed
@compute @workgroup_size(8, 8, 1)
fn settle(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let z = i32(gid.y);
  if (x >= GX || z >= GZ) { return; }
  let i = u32(x + GX * z);
  var me = col[i];
  // Off the block there is no water: what goes over the side is gone. (stamp still draws it
  // falling down the wall, from what flows over the lip.)
  if (!onBlock(x, z)) {
    col[i] = vec4f(0.0, 0.0, me.z, 0.0);
    ran[i] = 0.0;
    return;
  }
  let f = flux[i];
  var inn = 0.0;
  if (x > 0) { inn += flux[i - 1u].y; }
  if (x < GX - 1) { inn += flux[i + 1u].x; }
  if (z > 0) { inn += flux[i - u32(GX)].w; }
  if (z < GZ - 1) { inn += flux[i + u32(GX)].z; }
  let out = f.x + f.y + f.z + f.w;
  var d = me.x + inn - out;

  // rain falls in a column around the pointer
  if (u.rayO.w > 0.5 && pk.pos.w > 0.5) {
    let tool = u32(u.rayD.w);
    let r = distance(vec2f(f32(x), f32(z)) + 0.5, pk.pos.xz);
    // the cloud has no edge: it rains hardest in the middle and thins out, so it leaves no circle
    if (tool == 1u && r < u.wind.w) { d += u.p0.w * 2.0 * (1.0 - r * r / (u.wind.w * u.wind.w)); }
    // the hose leaves its water on the ground it hits (on a wall it has nowhere to stand: stamp draws the spray)
    if (tool == 2u && r < u.sun.w && abs(me.z - pk.pos.y) < u.sun.w + 2.0) { d += 0.02; }
  }
  // Only a film dries. Water with any depth to it stays: a hollow that has filled is a lake
  // until something lets it out.
  d = max(d - u.p0.z * (1.0 - smoothstep(0.15, 0.4, d)), 0.0);

  // Running water wears its bed, by how much of it goes through and by how far it drops there.
  // Where a little more runs, the bed sinks a little faster, so more runs there: that is how a
  // sheet of rain gathers into a watercourse. And a lip the water falls over wears fastest of
  // all, so a fall eats its way back upstream: that is how a gully is cut into the block from
  // its edge.
  // What counts is the water that goes on from here, not what arrives: the bottom of a hollow
  // takes water in and passes none on, and wears nothing. Whatever is worn has to be carried away.
  // And it is the drop that does the work: rain does not dig where it lands. On level ground it
  // runs off as a sheet and leaves it be; it cuts where it goes down, a slope, a step, a lip.
  // So a flat top is taken apart from its edges inward, along the ways the water finds, and
  // not drilled through under the cloud. Deep water shelters what is under it.
  // A column can only sink so fast, however hard it rains: slower than the water can follow,
  // or every column would be cut on its own.
  let top = i32(me.z) - 1;
  let soft = softTop(x, top, z);
  if (out > u.wind.y) {
    let steep = min(me.w, 3.0) / (1.0 + 0.1 * d * d);
    me.y += min(u.p0.x * soft * 4.5 * (out - u.wind.y) * steep, 0.03);
  }
  // One thing does go where the water does not drop: rot. Under water that runs or has just
  // run, a pocket of rotten rock is eaten out where it is, a pit a few voxels across, while
  // the sound rock round it is left. That is where it starts. The pit's rim is a bank and a
  // lip, and the rest gnaws on from there. Under a pond that lies still, nothing: when the
  // rain stops, so does this.
  if (d > 0.01 && ran[i] > 0.003) {
    let c = cells[idx(vec3i(x, max(top, 0), z))];
    if (ty(c) == ROCK) {
      let r = rotOf(c);
      me.y += min(u.p0.x * soft * 0.25 * max(r - 0.7, 0.0) / (1.0 + d * d), 0.03);
    }
  }
  // The wear, the bed's and the bank's (flow), adds up until a whole voxel is gone. Only ever
  // the top one: water cuts down, never sideways.
  if (me.y >= 1.0) {
    me.y -= 1.0;
    if (softTop(x, top, z) > 0.0) {
      cells[idx(vec3i(x, top, z))] = AIR;
      me.z -= 1.0;
    }
  }
  col[i] = vec4f(d, me.y, me.z, 0.5 * (inn + out));
  // It spreads sideways too, weaker a column at a time: the bank of a bank is still a bank, a
  // valley is wider than its stream. (The neighbours may be a step ahead or behind in this
  // pass; a fading maximum does not care.)
  var beside = 0.0;
  if (x > 0) { beside = max(beside, ran[i - 1u]); }
  if (x < GX - 1) { beside = max(beside, ran[i + 1u]); }
  if (z > 0) { beside = max(beside, ran[i - u32(GX)]); }
  if (z < GZ - 1) { beside = max(beside, ran[i + u32(GX)]); }
  ran[i] = max(max(ran[i] * 0.99, 0.5 * (inn + out)), beside * 0.8);
}

// ---------- green ----------
//
// Things grow where water has been and the ground is then left alone. A column has moisture:
// it fills while water is on it or runs past, and takes a minute or so to dry. On moist ground
// that is level enough to stand on (two of its four neighbours within a step: a flat, or a
// ledge on a steep side), that has soil (loose sediment, or rock rotten enough to root in) and
// that nothing disturbs, the cover grows: grass, then bushes, then a tree getting taller. Flood it, scour it or take the ground from under it, and it is gone.
// On a wall, tufts take root in the rotten pockets, below ground that has been wet.

@compute @workgroup_size(8, 8, 1)
fn grow(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let z = i32(gid.y);
  if (x >= GX || z >= GZ) { return; }
  let i = u32(x + GX * z);
  let me = col[i];
  var v = veg[i];
  let bed = me.z;
  let on = onBlock(x, z);

  // the neighbours: how many are level with this column, is there a wet wall beside it, is
  // there water standing beside it, and how moist they are
  var level = 0;
  var wetWall = false;
  var shore = false;
  var seep = 0.0;
  for (var a = 0; a < 4; a++) {
    var j = i;
    var ok = false;
    if (a == 0 && x > 0) { j = i - 1u; ok = true; }
    if (a == 1 && x < GX - 1) { j = i + 1u; ok = true; }
    if (a == 2 && z > 0) { j = i - u32(GX); ok = true; }
    if (a == 3 && z < GZ - 1) { j = i + u32(GX); ok = true; }
    if (!ok) { continue; }
    let nb = col[j].z;
    if (abs(nb - bed) <= 1.0) { level++; }
    if (nb - bed >= 3.0 && (col[j].x > 0.01 || ran[j] > 0.002)) { wetWall = true; }
    if (col[j].x > 0.3) { shore = true; }
    seep = max(seep, veg[j].z);
  }

  // Moisture: full where water is or runs or lies alongside, and it seeps out sideways from
  // there, a little less each column, so standing water keeps a belt round it green. Away from
  // all that the ground dries in a minute or so.
  let wet = on && (me.x > 0.01 || ran[i] > 0.002 || shore);
  v.z = clamp(max(v.z + select(-0.0002, 0.02, wet), select(0.0, seep * 0.93, on)), 0.0, 1.0);
  v.w = clamp(v.w + select(-0.0002, 0.004, wetWall), 0.0, 1.0);

  let top = cells[idx(vec3i(x, max(i32(bed) - 1, 0), z))];
  // soil is what has fallen and lies loose, or rock rotten enough to root in: sound rock stays bare
  let soil = ty(top) == SED || (ty(top) == ROCK && rotOf(top) > 0.45);
  // Low down it is desert: what grows there (stamp draws cactus) asks for neither soil nor
  // water, only somewhere to stand and to be left alone, and takes its time.
  let desert = f32(TOP) - bed > DESERT && (ty(top) == SED || ty(top) == ROCK);
  if (bed != v.y) {
    // the ground it stood on is gone, or new ground has come down on it
    v.x = 0.0;
    v.y = bed;
  } else if (!on || (!soil && !desert) || me.x > 0.3 || me.w > 0.02) {
    v.x = max(v.x - 0.05, 0.0); // under water, or in the way of it
  } else if (level < 2) {
    v.x = max(v.x - 0.02, 0.0); // nothing to stand on
  } else if (v.z > 0.1 && soil) {
    v.x = min(v.x + 0.002, 3.0);
  } else if (desert) {
    v.x = min(v.x + 0.0012, 3.0);
  } else {
    // dried out: the trees and bushes die back, slowly, the grass holds on
    v.x = max(v.x - 0.0005, min(v.x, 0.5));
  }
  veg[i] = v;
}

const DESERT = 12.0; // this far below the top of the block, it is desert

// Cactus stands on its own, closer lattice, one site per 5x5 columns, and the further down the
// more of the sites have one: quite a few, by the floor of a canyon.
const CSITE = 5;
fn cactusSite(cx: i32, cz: i32) -> vec2i {
  let h = pcg(u32(cx) * 83492791u + u32(cz) * 2971215073u);
  return vec2i(cx * CSITE + i32(h % u32(CSITE)), cz * CSITE + i32((h >> 8u) % u32(CSITE)));
}

fn rootable(c: u32) -> bool {
  return ty(c) == SED || (ty(c) == ROCK && rotOf(c) > 0.45);
}

// Trees stand on a loose lattice of sites, one per 8x8 columns, each at its own spot in its
// square. A site grows a tree when its own column's cover gets that far. Every column draws
// the part of each nearby tree that passes through it, so no column writes outside itself.
const SITE = 8;
fn siteOf(cx: i32, cz: i32) -> vec2i {
  let h = pcg(u32(cx) * 73856093u + u32(cz) * 19349663u);
  return vec2i(cx * SITE + i32(h % u32(SITE)), cz * SITE + i32((h >> 8u) % u32(SITE)));
}

// The water as voxels, for the picture: the grid is what gets drawn, so the depth is stamped
// into it, a column at a time. Nothing reads these voxels back as water.
@compute @workgroup_size(8, 8, 1)
fn stamp(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let z = i32(gid.y);
  if (x >= GX || z >= GZ) { return; }
  let i = u32(x + GX * z);
  let me = col[i];
  let base = i32(me.z);
  // the water's voxels, and how full the top one is (1..15, for how faintly a film is drawn)
  var surf = base;
  var full = 15u;
  if (me.x > 0.03) {
    surf = base + i32(ceil(me.x));
    full = u32(clamp((me.x - floor(me.x - 0.001)) * 15.0, 1.0, 15.0));
  }

  // a fall: water coming in over an edge well above this column's own surface
  var fallTop = 0;
  var fallQ = 0.0;
  for (var a = 0; a < 4; a++) {
    var j = i;
    var fin = 0.0;
    if (a == 0 && x > 0) { j = i - 1u; fin = flux[j].y; }
    if (a == 1 && x < GX - 1) { j = i + 1u; fin = flux[j].x; }
    if (a == 2 && z > 0) { j = i - u32(GX); fin = flux[j].w; }
    if (a == 3 && z < GZ - 1) { j = i + u32(GX); fin = flux[j].z; }
    let lip = i32(col[j].z);
    if (fin > 0.003 && lip > surf + 1) {
      fallTop = max(fallTop, lip + 1);
      fallQ += fin;
    }
  }

  var raining = false;
  if (u.rayO.w > 0.5 && pk.pos.w > 0.5 && u32(u.rayD.w) == 1u) {
    raining = distance(vec2f(f32(x), f32(z)) + 0.5, pk.pos.xz) < u.wind.w;
  }
  // the hose: spray round where it lands
  let hosing = u.rayO.w > 0.5 && pk.pos.w > 0.5 && u32(u.rayD.w) == 2u
    && distance(vec2f(f32(x), f32(z)) + 0.5, pk.pos.xz) < u.sun.w * 1.4;
  let drop = pcg(u32(x) * 7919u + u32(z) * 104729u);
  let tick = u32(u.res.z * 40.0);
  // white water: the faster it runs, the lighter it is drawn
  let rush = u32(clamp(me.w / max(me.x, 0.2) * 14.0, 0.0, 15.0));

  // what grows here: the cover on the ground, the trees that reach over this column, and the
  // walls beside it that tufts can hang on
  let v = veg[i];
  var treeN = 0;
  var treeAt: array<vec4i, 9>; // site x, top of the trunk, site z, foot of the trunk
  var treeR: array<f32, 9>;    // the crown's radius
  for (var a = 0; a < 9; a++) {
    let s = siteOf(x / SITE + a % 3 - 1, z / SITE + a / 3 - 1);
    if (!onBlock(s.x, s.y)) { continue; }
    let si = u32(s.x + GX * s.y);
    let g = veg[si].x;
    let h = pcg(u32(s.x) * 2654435761u + u32(s.y) * 40503u);
    if (g <= 1.0 || (h % 10u) >= 4u) { continue; } // not that far along, or a site where none will
    let foot = i32(col[si].z);
    // a tree wants water and soil under it, wherever it is (the desert's cover grows without)
    if (veg[si].z <= 0.1 || !rootable(cells[idx(vec3i(s.x, max(foot - 1, 0), s.y))])) { continue; }
    let size = clamp((g - 1.0) / 2.0, 0.0, 1.0);
    let tall = i32(2.0 + size * (3.0 + 3.0 * f32((h >> 4u) & 15u) / 15.0));
    treeAt[treeN] = vec4i(s.x, foot + tall, s.y, foot);
    treeR[treeN] = 1.2 + size * (1.2 + 1.2 * f32((h >> 8u) & 15u) / 15.0);
    treeN++;
  }
  // cactus: a trunk, an arm out to one side that turns up, and on a tall one a second arm
  var cacN = 0;
  var cacAt: array<vec4i, 9>;  // site x, foot, site z, height
  var cacArm: array<vec4i, 9>; // which way the arm goes (0..3), how far out, at what height, how far up
  for (var a = 0; a < 9; a++) {
    let s = cactusSite(x / CSITE + a % 3 - 1, z / CSITE + a / 3 - 1);
    if (!onBlock(s.x, s.y)) { continue; }
    let si = u32(s.x + GX * s.y);
    let foot = i32(col[si].z);
    let down = f32(TOP - foot);
    let g = veg[si].x;
    let h = pcg(u32(s.x) * 362437u + u32(s.y) * 1000003u);
    if (down <= DESERT || g <= 0.6 || f32(h & 255u) / 255.0 > clamp(0.2 + down / 60.0, 0.0, 0.85)) { continue; }
    let tall = i32(2.0 + clamp((g - 0.6) / 2.4, 0.0, 1.0) * (2.0 + 5.0 * f32((h >> 8u) & 15u) / 15.0));
    let armAt = 1 + tall / 3;
    cacAt[cacN] = vec4i(s.x, foot, s.y, tall);
    cacArm[cacN] = vec4i(i32((h >> 12u) & 3u), select(0, 1 + i32((h >> 14u) & 1u), tall >= 4), armAt, max(tall - armAt - 1 - i32((h >> 15u) & 1u), 1));
    cacN++;
  }
  let fertile = rootable(cells[idx(vec3i(x, max(base - 1, 0), z))]);
  var wallTop = 0; // the highest bed among the neighbours: up to there, there may be a wall beside
  var wallAt: array<u32, 4>;
  var wallBed: array<i32, 4>;
  for (var a = 0; a < 4; a++) {
    var j = i;
    if (a == 0 && x > 0) { j = i - 1u; }
    if (a == 1 && x < GX - 1) { j = i + 1u; }
    if (a == 2 && z > 0) { j = i - u32(GX); }
    if (a == 3 && z < GZ - 1) { j = i + u32(GX); }
    wallAt[a] = j;
    wallBed[a] = select(i32(col[j].z), 0, j == i);
    wallTop = max(wallTop, wallBed[a]);
  }

  for (var y = base; y < GY; y++) {
    let k = idx(vec3i(x, y, z));
    let c = cells[k];
    let t = ty(c);
    if (t == ROCK || t == GROUND) { break; }
    if (t == SED) { continue; }
    var want = AIR;
    if (y < surf) {
      want = WATER | (rush << 12u) | (select(15u, full, y == surf - 1) << 8u);
    } else if (y < fallTop) {
      // the fall is a curtain of drops going down, denser the more water comes over
      if (grain(x, y + i32(tick), z) < clamp(fallQ * 8.0, 0.2, 1.0)) { want = WATER | 0xFF00u; }
    } else if (raining && (drop & 15u) == 0u && ((u32(y) + tick + (drop >> 8u)) % 28u) < 2u) {
      want = WATER | 0xFF00u;
    }
    if (hosing && want == AIR && distance(vec3f(f32(x), f32(y), f32(z)) + 0.5, pk.pos.xyz) < u.sun.w * 1.4
        && grain(x + i32(tick), y, z) < 0.22) {
      want = WATER | 0xFF00u;
    }
    // green goes where there is no water. Layers 8 and 9 are grass, 10 and 11 leaves, 12 wood, 14 cactus.
    if (y >= surf) {
      var green = 0u;
      let g = grain(x, y, z);
      // the cover: grass on the bed where there is soil, and a bush here and there once it is thick and moist
      if (surf == base && fertile) {
        if (y == base && v.x > 0.3) { green = 8u + u32(g < 0.4); }
        if (y == base + 1 && v.x > 0.8 && v.z > 0.1 && g < 0.2) { green = 10u; }
      }
      // tufts on a wall beside: where the wall's rock is rotten, the more the longer it has been wet
      if (green == 0u && y < wallTop && y > base && v.w > 0.0) {
        for (var a = 0; a < 4; a++) {
          if (y >= wallBed[a]) { continue; }
          let wc = cells[idx(vec3i(i32(wallAt[a]) % GX, y, i32(wallAt[a]) / GX))];
          if (ty(wc) == ROCK && rotOf(wc) > 0.65 && g < v.w * 0.22) { green = 9u + u32(g < v.w * 0.08); }
        }
      }
      // trees: the trunk in the site's own column, the crown a ball round its top
      for (var a = 0; a < treeN; a++) {
        let tr = treeAt[a];
        let dx = f32(x - tr.x);
        let dz = f32(z - tr.z);
        let dy = f32(y - tr.y) * 1.15;
        if (dx * dx + dy * dy + dz * dz < treeR[a] * treeR[a]) { green = 10u + u32(g < 0.45); }
        else if (x == tr.x && z == tr.z && y >= tr.w && y < tr.y) { green = 12u; }
      }
      for (var a = 0; a < cacN; a++) {
        let ca = cacAt[a];
        let ar = cacArm[a];
        let rx = x - ca.x;
        let rz = z - ca.z;
        let ry = y - ca.y;
        if (rx == 0 && rz == 0 && ry >= 0 && ry < ca.w) { green = 14u; }
        var d = vec2i(1, 0);
        if (ar.x == 1) { d = vec2i(-1, 0); }
        if (ar.x == 2) { d = vec2i(0, 1); }
        if (ar.x == 3) { d = vec2i(0, -1); }
        // out along the arm, then up at its end
        let k = rx * d.x + rz * d.y;
        if (rx == k * d.x && rz == k * d.y && k >= 1 && k <= ar.y) {
          if (ry == ar.z || (k == ar.y && ry > ar.z && ry <= ar.z + ar.w)) { green = 14u; }
        }
        // the second arm, the other way and a little higher, one column out
        if (ca.w >= 6 && rx == -d.x && rz == -d.y && ry >= ar.z + 2 && ry <= ar.z + 2 + max(ar.w - 2, 1)) { green = 14u; }
      }
      if (green != 0u) { want = PLANT | (green << 3u); }
    }
    if (want != c) { cells[k] = want; }
  }
}
