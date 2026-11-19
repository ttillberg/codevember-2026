// Shared by the simulation and the picture. main.ts puts GX, GY, GZ, PAL, SOFT and BG in front.
// Whoever includes this declares `cells`.

const AIR = 0u;
const WATER = 1u;
const SED = 2u;
const ROCK = 3u;
const GROUND = 4u;
const WALL = 7u;

struct U {
  camO: vec4f, // where the middle of the screen starts, far outside the grid
  camR: vec4f, // right, w: voxels per pixel
  camU: vec4f, // up
  camF: vec4f, // forward, every ray's direction (orthographic)
  res: vec4f,  // width, height, time, wind radius
  sun: vec4f,  // towards the light
  rayO: vec4f, // pointer ray, w: tool held down
  rayD: vec4f, // w: tool (1 rain, 2 water, 3 wind)
  wind: vec4f, // direction, w: rain radius
  p0: vec4f,   // erosion rate, sediment yield, evaporation, rain rate
  p1: vec4f,   // wind rate, hose rate, support limit, pointer over the scene
};

struct Pick {
  pos: vec4f, // centre of the cell under the pointer, w: hit
  n: vec4f,
};

struct Hit {
  hit: bool,
  cell: vec3i,
  n: vec3f,
  c: u32,
  water: f32,   // water cells crossed on the way
  wn: vec3f,    // the face of the first one
  wcell: vec3i,
};

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

// Walk the grid cell by cell (Amanatides and Woo). Water is seen through, and counted.
fn march(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.hit = false;
  h.water = 0.0;
  let g = vec3f(f32(GX), f32(GY), f32(GZ));
  let inv = 1.0 / rd;
  let ta = (vec3f(0.0) - ro) * inv;
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
  var cell = vec3i(clamp(floor(p), vec3f(0.0), g - 1.0));
  let stp = vec3i(sg);
  let td = abs(inv);
  var tm = (vec3f(cell) + max(sg, vec3f(0.0)) - ro) * inv;

  for (var i = 0; i < 560; i++) {
    if (!inGrid(cell)) { break; }
    let c = cells[idx(cell)];
    let t = c & 7u;
    if (t == WATER) {
      if (h.water == 0.0) { h.wn = n; h.wcell = cell; }
      h.water += 1.0;
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
