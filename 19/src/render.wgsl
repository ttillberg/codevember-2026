// The picture: one orthographic ray per pixel through the grid, one flat tone per voxel face.

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<storage, read> pk: Pick;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn h3(p: vec3i) -> f32 {
  return f32(pcg(u32(p.x) + pcg(u32(p.y) + pcg(u32(p.z)))) >> 8u) / 16777216.0;
}

fn solid(p: vec3i) -> f32 {
  if (!inGrid(p)) { return 0.0; }
  return f32((cells[idx(p)] & 7u) >= SED);
}

const WATER_SHALLOW = vec3f(0.16, 0.62, 0.66);
const WATER_DEEP = vec3f(0.04, 0.33, 0.42);

@fragment
fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = floor(fc.xy) + 0.5;
  let sx = (px.x - u.res.x * 0.5) * u.camR.w;
  let sy = (u.res.y * 0.5 - px.y) * u.camR.w;
  let ro = u.camO.xyz + u.camR.xyz * sx + u.camU.xyz * sy;
  let h = march(ro, u.camF.xyz);

  var col = BG;
  if (h.hit) {
    let t = h.c & 7u;
    var bcol = PAL[(h.c >> 3u) & 15u];
    if (t != GROUND) {
      bcol *= 0.88 + 0.05 * f32((h.c >> 8u) & 3u);
      bcol *= 0.96 + 0.08 * h3(h.cell);
    }
    if (t == SED) { bcol = mix(bcol, vec3f(0.86, 0.68, 0.52), 0.3); }

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
      col = bcol * vec3f(0.5, 0.47, 0.58);
    }
    col *= 1.0 - 0.07 * ao;

    // the brush, a ring on the rock
    if (pk.pos.w > 0.5) {
      var r = 2.6;
      let tool = u32(u.rayD.w);
      if (tool == 1u) { r = u.wind.w; }
      if (tool == 3u) { r = u.res.w; }
      var d = distance(cen, pk.pos.xyz);
      var show = true;
      // rain falls in a column: its ring only on what faces up
      if (tool == 1u) { d = distance(cen.xz, pk.pos.xz); show = h.n.y > 0.5; }
      if (show && abs(d - r) < 0.6) { col = mix(col, vec3f(1.0), 0.45); }
    }
  }

  if (h.water > 0.0) {
    let depth = clamp(h.water / 10.0, 0.0, 1.0);
    var wcol = mix(WATER_SHALLOW, WATER_DEEP, depth);
    if (h.wn.y > 0.5) { wcol *= 1.12; } else { wcol *= 0.92; }
    col = mix(col, wcol, 0.45 + 0.5 * depth);
  }
  return vec4f(col, 1.0);
}
