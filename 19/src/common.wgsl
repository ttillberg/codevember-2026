// Shared by the simulation and the picture. main.ts puts a header in front: the grid's size, the
// block's place in it (CUBE, TOP, LO), the cell types, the tools, the layers that are not rock,
// and PAL, SOFT and BG. Whoever includes this declares `cells`, `u` and `pk`.

struct U {
  camO: vec4f,    // where the middle of the screen starts, far outside the grid
  camR: vec4f,    // right, w: voxels per pixel
  camU: vec4f,    // up
  camF: vec4f,    // forward: every ray's direction (orthographic), so the line of sight, and the way the jets go
  res: vec4f,     // width, height, time
  sun: vec4f,     // towards the light
  rayO: vec4f,    // where the pointer's ray starts
  pointer: vec4f, // x, y in picture pixels, over the scene, tool held down
  tool: vec4f,    // the tool in hand (RAIN, HOSE, WIND, SCRATCH), its radius in voxels, its rate
  water: vec4f,   // gravity, the least flow that wears, inertia, the depth of a film that clings
  wear: vec4f,    // erosion rate, evaporation, support limit, the saucer has left
  craft: vec4f,   // the saucer in flight: where it is, w: that it is flying
  craftX: vec4f,  // and its own three axes: how it is turned
  craftY: vec4f,
  craftZ: vec4f,
};

struct Pick {
  pos: vec4f, // centre of the cell under the pointer, w: hit
  was: vec4f, // where that was the frame before, w: that there was one. A stroke runs from one to the other.
  n: vec4f,   // face normal of the cell under the pointer
};

const MAX_STICKS: u32 = 16u;
const MAX_BLASTS: u32 = 8u;
// collectible dynamite box perched high on a minimalistic shelf on the far side of the black board
const SHELF_AT = vec3f(88.0, 8.0, 16.0);
const SHELF_H: f32 = 18.9;
const CRATE_AT = vec3f(88.0, 26.9, 16.0);

struct Dyn {
  counts: vec4u,            // x: planted stick count, y: active blast count, z: crate (0 gone, 1 on board, 2 hovered)
  detPos: vec4f,            // detonation center xyz, w: blast radius
  detInfo: vec4f,           // x: force (0..1), y: seed
  sticks: array<vec4f, 32>, // 2*i = (pos.xyz, fuse 0..1), 2*i+1 = (dir.xyz, radius)
  blasts: array<vec4f, 16>, // 2*i = (pos.xyz, age s), 2*i+1 = (radius, force, seed, 0)
};

struct Hit {
  hit: bool,
  cell: vec3i,
  n: vec3f,
  c: u32,
  water: f32,   // water cells crossed on the way
  wn: vec3f,    // the face of the first one
  wcell: vec3i,
  glass: f32,   // and glass cells
  gn: vec3f,
};

fn toolNow() -> u32 { return u32(u.tool.x); }
// the tool is held down, and on something
fn working() -> bool { return u.pointer.w > 0.5 && pk.pos.w > 0.5; }

// a cell's bits (world.ts has the list)
fn ty(c: u32) -> u32 { return c & 7u; }
fn layerOf(c: u32) -> u32 { return (c >> 3u) & 31u; }

fn idx(p: vec3i) -> u32 {
  return u32(p.x + GX * (p.z + GZ * p.y));
}

fn inGrid(p: vec3i) -> bool {
  return all(p >= vec3i(0)) && all(p < vec3i(GX, GY, GZ));
}

fn pcg(v: u32) -> u32 {
  let x = v * 747796405u + 2891336453u;
  let w = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (w >> 22u) ^ w;
}

// a hash as a number, 0..1
fn unit(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }

// one number per cell, always the same one
fn grain(p: vec3i) -> f32 {
  return unit(pcg(u32(p.x) + pcg(u32(p.y) + pcg(u32(p.z)))));
}

// The wind is a hair dryer in the hand of whoever is looking: it blows straight in along the
// line of sight, at where the pointer is. It is wide, it takes in most of the block, and it is
// strongest where it is aimed: it falls off with the distance from the line it is aimed along
// (which is the distance from the pointer, on the screen), and a little with how far past the
// aim it has to go.
fn windOn(p: vec3f, aim: vec3f, jet: vec3f, radius: f32) -> f32 {
  let rel = p - aim;
  let along = dot(rel, jet);
  let off = length(rel - jet * along);
  return exp(-off * off / (radius * radius)) * exp(-max(along, 0.0) / 120.0);
}

// What is at a cell. In the grid, what the grid holds. Past its sides the tray goes on, round,
// for as far as it reaches: there is nothing there but that.
fn cellAt(p: vec3i) -> u32 {
  if (inGrid(p)) { return cells[idx(p)]; }
  if (p.y >= 0 && p.y < LO.y && distance(vec2f(p.xz) + 0.5, vec2f(f32(GX), f32(GZ)) * 0.5) <= TRAY) {
    return GROUND | (GROUND_LAYER << 3u);
  }
  return AIR;
}

// Walk the grid cell by cell (Amanatides and Woo), and BEYOND cells past its sides. Water is seen through, and counted; so is glass.
fn march(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.hit = false;
  h.water = 0.0;
  h.glass = 0.0;
  let lo = vec3f(-f32(BEYOND), 0.0, -f32(BEYOND));
  let g = vec3f(f32(GX + BEYOND), f32(GY), f32(GZ + BEYOND));
  let inv = 1.0 / rd;
  let ta = (lo - ro) * inv;
  let tb = (g - ro) * inv;
  let t0 = min(ta, tb);
  let t1 = max(ta, tb);
  let tn = max(max(t0.x, t0.y), t0.z);
  let tf = min(min(t1.x, t1.y), t1.z);
  if (tn >= tf || tf <= 0.0) { return h; }

  let sg = sign(rd);
  var n = vec3f(0.0, 1.0, 0.0);
  if (tn > 0.0) {
    if (t0.x >= t0.y && t0.x >= t0.z) { n = vec3f(-sg.x, 0.0, 0.0); }
    else if (t0.y >= t0.z) { n = vec3f(0.0, -sg.y, 0.0); }
    else { n = vec3f(0.0, 0.0, -sg.z); }
  }
  let p = ro + rd * (max(tn, 0.0) + 0.001);
  var cell = vec3i(clamp(floor(p), lo, g - 1.0));
  let stp = vec3i(sg);
  let td = abs(inv);
  var tm = (vec3f(cell) + max(sg, vec3f(0.0)) - ro) * inv;

  for (var i = 0; i < 580; i++) {
    if (any(cell < vec3i(lo)) || any(cell >= vec3i(g))) { break; }
    let c = cellAt(cell);
    let t = ty(c);
    if (t == WATER) {
      if (h.water == 0.0) { h.wn = n; h.wcell = cell; }
      h.water += 1.0;
    } else if (t == ROCK && layerOf(c) == GLASS) {
      if (h.glass == 0.0) { h.gn = n; }
      h.glass += 1.0;
    } else if (t != AIR) {
      h.hit = true;
      h.cell = cell;
      h.n = n;
      h.c = c;
      break;
    }
    if (tm.x < tm.y && tm.x < tm.z) {
      cell.x += stp.x; tm.x += td.x; n = vec3f(-sg.x, 0.0, 0.0);
    } else if (tm.y < tm.z) {
      cell.y += stp.y; tm.y += td.y; n = vec3f(0.0, -sg.y, 0.0);
    } else {
      cell.z += stp.z; tm.z += td.z; n = vec3f(0.0, 0.0, -sg.z);
    }
  }
  return h;
}
