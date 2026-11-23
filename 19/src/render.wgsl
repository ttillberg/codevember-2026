// The picture: one orthographic ray per pixel through the grid, one flat tone per voxel face.

@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<storage, read> pk: Pick;
// the saucer on its own, upright, in a small grid (world.ts MODEL): what flies when it flies
@group(0) @binding(3) var<storage, read> model: array<u32>;
// planted dynamite sticks and active explosions
@group(0) @binding(4) var<uniform> dyn: Dyn;

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

fn hitBox(ro: vec3f, rd: vec3f, lo: vec3f, hi: vec3f) -> vec4f {
  let d = select(rd, vec3f(1e-5), abs(rd) < vec3f(1e-5));
  let inv = 1.0 / d;
  let ta = (lo - ro) * inv;
  let tb = (hi - ro) * inv;
  let t0 = min(ta, tb);
  let t1 = max(ta, tb);
  let tn = max(max(t0.x, t0.y), t0.z);
  let tf = min(min(t1.x, t1.y), t1.z);
  if (tn >= tf || tf <= 0.0) { return vec4f(1e9, 0.0, 1.0, 0.0); }
  let sg = sign(d);
  var n = vec3f(0.0, 0.0, -sg.z);
  if (t0.x >= t0.y && t0.x >= t0.z) { n = vec3f(-sg.x, 0.0, 0.0); }
  else if (t0.y >= t0.z) { n = vec3f(0.0, -sg.y, 0.0); }
  return vec4f(max(tn, 0.0), n);
}

fn litFlat(bcol: vec3f, n: vec3f) -> vec3f {
  let lam = max(dot(n, u.sun.xyz), 0.0);
  return select(bcol * SHADE, bcol * (0.62 + 0.5 * lam), lam > 0.0);
}

// Planted dynamite sticks (taped red voxel bundle, burning fuse, flying sparks, fuse smoke) and
// active explosions (brief fiery flash, tiny flying sandstone grit/embers, and billowing
// dither-shaded smoke & dust plumes), depth-tested against the rock.
fn drawDynamite(ro: vec3f, rd: vec3f, behind: f32, baseCol: vec3f, px: vec2f) -> vec3f {
  var bestT = behind;
  var col = baseCol;
  let time = u.res.z;
  let dith = bayer(px);

  // accumulated smoke & fire wisps blended over the scene
  var smokeW = 0.0;
  var smokeSum = vec3f(0.0);
  var fireW = 0.0;
  var fireSum = vec3f(0.0);

  // --- minimalistic high shelf on the far side of the black board (keeps the dynamite out of kids' reach) ---
  {
    let sc = SHELF_AT + vec3f(0.0, 12.0, 0.0);
    let tcS = dot(sc - ro, rd);
    let perpS = ro + rd * tcS - sc;
    if (dot(perpS, perpS) < 340.0) {
      let loS = ro - SHELF_AT;
      // four slim dark-steel legs rising from the black board
      let legCol = vec3f(0.36, 0.35, 0.34);
      for (var lx = 0; lx < 2; lx++) {
        for (var lz = 0; lz < 2; lz++) {
          let x = select(-4.8, 4.8, lx == 1);
          let z = select(-1.85, 1.85, lz == 1);
          let lh = hitBox(loS, rd, vec3f(x - 0.38, 0.0, z - 0.38), vec3f(x + 0.38, SHELF_H - 1.0, z + 0.38));
          if (lh.x < bestT) {
            bestT = lh.x;
            col = litFlat(legCol, lh.yzw);
          }
        }
      }
      // crisp thin pale minimalist shelf top
      let th = hitBox(loS, rd, vec3f(-5.5, SHELF_H - 1.05, -2.4), vec3f(5.5, SHELF_H, 2.4));
      if (th.x < bestT) {
        bestT = th.x;
        col = litFlat(vec3f(0.84, 0.81, 0.76), th.yzw);
      }
    }
  }

  // --- collectible dynamite box perched on top of the shelf ---
  if (dyn.counts.z > 0u) {
    let hovered = dyn.counts.z == 2u;
    let lift = select(0.0, 0.8, hovered);
    let cOrig = CRATE_AT + vec3f(0.0, lift, 0.0);
    let tcC = dot(cOrig + vec3f(0.0, 2.6, 0.0) - ro, rd);
    let perpC = ro + rd * tcC - (cOrig + vec3f(0.0, 2.6, 0.0));
    if (dot(perpC, perpC) < 120.0) {
      let lo = ro - cOrig;
      let hiBoost = select(1.0, 1.16, hovered);
      // closed rectangular wooden box (8.4 x 5.2 x 3.4 voxels)
      let ch = hitBox(lo, rd, vec3f(-4.2, 0.0, -1.7), vec3f(4.2, 5.2, 1.7));
      if (ch.x < bestT) {
        bestT = ch.x;
        let lp = lo + rd * ch.x;
        let n = ch.yzw;
        // warm weathered wood planks with horizontal seams
        let plank = floor(lp.y / 1.73);
        var ccol = mix(vec3f(0.68, 0.45, 0.25), vec3f(0.58, 0.37, 0.20), fract(plank * 0.618));
        if (abs(n.y) < 0.5 && (abs(lp.y - 1.73) < 0.16 || abs(lp.y - 3.46) < 0.16)) {
          ccol *= 0.65;
        }
        if (n.y > 0.5 && abs(lp.z) < 0.16) {
          ccol *= 0.7;
        }
        // dark stenciled text hint in the middle of the long faces
        if (abs(n.z) > 0.5 && abs(lp.x) < 1.65 && lp.y > 1.3 && lp.y < 3.9) {
          let gx = i32(floor((lp.x + 1.65) * 2.2));
          let gy = i32(floor((lp.y - 1.3) * 1.9));
          if ((gy == 1 || gy == 3) && ((gx + gy) & 1) == 0) {
            ccol = vec3f(0.22, 0.14, 0.09);
          }
        }
        col = litFlat(ccol, n) * hiBoost;
      }
      // two slightly raised vertical wooden straps wrapping around left and right ends
      for (var s = 0; s < 2; s++) {
        let sx = select(-2.7, 2.7, s == 1);
        let sh = hitBox(lo, rd, vec3f(sx - 0.55, 0.0, -1.95), vec3f(sx + 0.55, 5.42, 1.95));
        if (sh.x < bestT) {
          bestT = sh.x;
          let lp = lo + rd * sh.x;
          let scol = mix(vec3f(0.76, 0.52, 0.30), vec3f(0.62, 0.40, 0.21), step(0.3, abs(lp.x - sx)));
          col = litFlat(scol, sh.yzw) * hiBoost;
        }
      }
    }
  }

  // --- planted sticks ---
  let nSticks = min(dyn.counts.x, MAX_STICKS);
  for (var i = 0u; i < nSticks; i++) {
    let sp = dyn.sticks[i * 2u];
    let sd = dyn.sticks[i * 2u + 1u];
    let sPos = sp.xyz;
    let fuse = clamp(sp.w, 0.0, 1.0);
    let sDir = normalize(sd.xyz);

    // quick reject sphere around stick + fuse + sparks + fuse smoke
    let approxC = sPos + sDir * 6.0 + vec3f(0.0, 4.0, 0.0);
    let tc0 = dot(approxC - ro, rd);
    let perp0 = ro + rd * tc0 - approxC;
    if (dot(perp0, perp0) > 420.0) { continue; }

    let upRef = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(sDir.y) > 0.9);
    let ax = normalize(cross(upRef, sDir));
    let az = cross(sDir, ax);
    let origin = sPos - sDir * 0.6;
    let rel = ro - origin;
    let lo = vec3f(dot(rel, ax), dot(rel, sDir), dot(rel, az));
    let ld = vec3f(dot(rd, ax), dot(rd, sDir), dot(rd, az));

    // bundled red dynamite stick body
    let bh = hitBox(lo, ld, vec3f(-1.65, 0.0, -1.65), vec3f(1.65, 8.2, 1.65));
    if (bh.x < bestT) {
      bestT = bh.x;
      let lp = lo + ld * bh.x;
      let wn = ax * bh.y + sDir * bh.z + az * bh.w;
      var bcol = vec3f(0.88, 0.19, 0.13);
      if (abs(lp.x) < 0.28 || abs(lp.z) < 0.28) { bcol *= 0.74; }
      if ((lp.y > 1.6 && lp.y < 2.7) || (lp.y > 5.5 && lp.y < 6.6)) {
        bcol = vec3f(0.16, 0.15, 0.15);
      } else if (abs(bh.z) > 0.5) {
        bcol = select(vec3f(0.72, 0.22, 0.14), vec3f(0.24, 0.20, 0.18), length(lp.xz) < 0.65);
      }
      col = litFlat(bcol, wn);
    }

    // curved hemp fuse shrinking as it burns
    let fuseLen = 0.8 + 4.8 * fuse;
    for (var s = 0; s < 5; s++) {
      let fFrac = (f32(s) + 0.5) / 5.0;
      let dist = fFrac * fuseLen;
      let fp = origin + sDir * (8.2 + dist) + ax * (dist * dist * 0.14);
      let fh = hitBox(ro, rd, fp - vec3f(0.55), fp + vec3f(0.55));
      if (fh.x < bestT) {
        bestT = fh.x;
        col = litFlat(vec3f(0.84, 0.76, 0.58), fh.yzw);
      }
    }

    // sizzling spark at the burning tip
    let tip = origin + sDir * (8.2 + fuseLen) + ax * (fuseLen * fuseLen * 0.14);
    let tick = u32(time * 28.0) + i * 31u;
    let flick = unit(pcg(tick));
    let urgent = 1.0 - fuse;
    let sparkR = 1.05 + 0.45 * flick + 0.45 * urgent;
    let sh = hitBox(ro, rd, tip - vec3f(sparkR), tip + vec3f(sparkR));
    if (sh.x < bestT) {
      bestT = sh.x;
      let hot = step(0.35, flick);
      col = mix(vec3f(1.0, 0.52, 0.10), vec3f(1.0, 0.98, 0.78), hot);
    }

    // tiny flying spark pixels popping off the tip
    for (var k = 0u; k < 5u; k++) {
      let kh = pcg(i * 97u + k * 53u + 13u);
      let phase = fract(time * (3.2 + 1.4 * unit(kh)) + f32(k) * 0.23 + f32(i) * 0.41);
      let ang = unit(pcg(kh)) * 6.2832 + floor(time * 3.5) * 1.7;
      let spDir = normalize(sDir * 0.65 + ax * cos(ang) + az * sin(ang) + vec3f(0.0, 0.5, 0.0));
      let spPos = tip + spDir * (phase * 6.8) - vec3f(0.0, phase * phase * 3.6, 0.0);
      let sz = 0.52 * (1.0 - phase * 0.6);
      let ph = hitBox(ro, rd, spPos - vec3f(sz), spPos + vec3f(sz));
      if (ph.x < bestT) {
        bestT = ph.x;
        col = mix(vec3f(1.0, 0.96, 0.65), vec3f(0.98, 0.36, 0.08), phase);
      }
    }

    // delicate curl of grey smoke drifting up from the burning fuse
    for (var k = 0u; k < 4u; k++) {
      let phase = fract(time * 0.9 + f32(k) * 0.25 + f32(i) * 0.31);
      let sw = sin(time * 2.4 + f32(k) * 1.9) * 1.4 * phase;
      let pc = tip + vec3f(sw, 1.5 + phase * 11.0, cos(time * 1.9 + f32(k)) * 1.1 * phase);
      let pr = 1.2 + phase * 2.4;
      let tc = dot(pc - ro, rd);
      let q = ro + rd * tc - pc;
      let d2 = dot(q, q);
      if (d2 < pr * pr && tc - pr < bestT) {
        let vis = clamp((bestT - (tc - pr)) / pr, 0.0, 1.0);
        let w = (1.0 - d2 / (pr * pr)) * (1.0 - phase) * 0.45 * vis;
        smokeW += w;
        smokeSum += vec3f(0.82, 0.80, 0.78) * w;
      }
    }
  }

  // --- active explosions ---
  let nBlasts = min(dyn.counts.y, MAX_BLASTS);
  for (var i = 0u; i < nBlasts; i++) {
    let bp = dyn.blasts[i * 2u];
    let bi = dyn.blasts[i * 2u + 1u];
    let bPos = bp.xyz;
    let age = bp.w;
    if (age < 0.0 || age > 2.25) { continue; }
    let R = bi.x;
    let bForce = bi.y;
    let seed = u32(bi.z);

    // quick bounding-sphere reject for pixels far from this explosion
    let approxC = bPos + vec3f(0.0, age * 18.0, 0.0);
    let tc0 = dot(approxC - ro, rd);
    let perp0 = ro + rd * tc0 - approxC;
    let boundR = R * 3.0 + 36.0;
    if (dot(perp0, perp0) > boundR * boundR) { continue; }

    // 1. Small flying sandstone pebbles & glowing embers (tiny crisp specks, no big blocks)
    if (age < 0.95) {
      let shrink = clamp((0.95 - age) / 0.25, 0.0, 1.0);
      for (var k = 0u; k < 20u; k++) {
        let h1 = pcg(seed + k * 7919u + 17u);
        let h2 = pcg(h1);
        let h3 = pcg(h2);
        let az = unit(h1) * 6.2832;
        let el = 0.18 + 1.15 * unit(h2);
        let dir = vec3f(cos(az) * cos(el), sin(el), sin(az) * cos(el));
        let spd = (24.0 + 42.0 * unit(h3)) * (0.65 + 0.55 * bForce) * clamp(R / 15.0, 0.65, 1.5);
        let p = bPos + dir * (spd * age) - vec3f(0.0, 48.0 * age * age, 0.0);
        if (p.y < f32(LO.y)) { continue; }
        let isEmber = (k % 3u) == 0u && age < 0.55;
        let sz = (0.45 + 0.42 * unit(pcg(h3))) * shrink;
        let ch = hitBox(ro, rd, p - vec3f(sz), p + vec3f(sz));
        if (ch.x < bestT) {
          bestT = ch.x;
          if (isEmber) {
            col = mix(vec3f(1.0, 0.94, 0.62), vec3f(1.0, 0.38, 0.08), age / 0.55);
          } else {
            col = litFlat(PAL[k % 7u], ch.yzw);
          }
        }
      }
    }

    // 2. Brief fiery flash burst inside the crater (soft billowing fire puffs)
    if (age < 0.38) {
      let tNorm = age / 0.38;
      let pop = min(1.0, age / 0.045);
      let fade = 1.0 - smoothstep(0.10, 0.38, age);
      for (var k = 0u; k < 10u; k++) {
        let h1 = pcg(seed + k * 3571u + 101u);
        let h2 = pcg(h1);
        let h3 = pcg(h2);
        var off = vec3f(0.0);
        var rad = R * 0.72;
        if (k > 0u) {
          let az = unit(h1) * 6.2832;
          let z = unit(h2) * 1.6 - 0.5;
          let xy = sqrt(max(0.0, 1.0 - clamp(z, -1.0, 1.0) * clamp(z, -1.0, 1.0)));
          off = vec3f(cos(az) * xy, z, sin(az) * xy) * R * (0.28 + 0.48 * unit(h3)) * (0.3 + 0.7 * tNorm);
          rad = R * (0.34 + 0.24 * unit(pcg(h3)));
        }
        let pc = bPos + off + vec3f(0.0, age * 14.0, 0.0);
        let pr = rad * pop * (0.65 + 0.45 * fade);
        if (pr < 0.8) { continue; }
        let tc = dot(pc - ro, rd);
        let q = ro + rd * tc - pc;
        let d2 = dot(q, q);
        if (d2 >= pr * pr || tc - pr >= bestT) { continue; }
        let vis = clamp((bestT - (tc - pr)) / max(pr * 0.8, 1.0), 0.0, 1.0);
        let u2 = 1.0 - d2 / (pr * pr);
        let w = u2 * u2 * fade * 1.4 * vis;
        let hot = clamp(u2 * (1.0 - tNorm * 0.85), 0.0, 1.0);
        let fcol = mix(vec3f(0.96, 0.32, 0.08), vec3f(1.0, 0.96, 0.76), smoothstep(0.15, 0.75, hot));
        fireW += w;
        fireSum += fcol * w;
      }
    }

    // 3. Billowing smoke & sandstone dust plume (soft sunlit clouds, rising and thinning into wisps)
    if (age > 0.02 && age < 2.22) {
      let sAge = age - 0.02;
      let sNorm = sAge / 2.20;
      let envIn = smoothstep(0.0, 0.07, sNorm);
      let envOut = 1.0 - smoothstep(0.32, 1.0, sNorm);
      let hotGlow = (1.0 - smoothstep(0.04, 0.48, age));

      // 24 overlapping puffs: 8 low dust-ring puffs + 16 rising mushrooming smoke puffs
      for (var k = 0u; k < 24u; k++) {
        let h1 = pcg(seed + k * 6133u + 313u);
        let h2 = pcg(h1);
        let h3 = pcg(h2);
        let h4 = pcg(h3);
        let isRing = k < 8u;
        let az = unit(h1) * 6.2832;
        let gust = sin(sAge * 1.6 + f32(k)) * 2.2 * sNorm;
        var pc: vec3f;
        var pr: f32;
        var puffFade: f32;
        if (isRing) {
          // low dusty shockwave skirt rolling outward around the crater rim
          let rNorm = min(1.0, sAge / 1.35);
          let spread = R * (0.45 + 1.15 * pow(rNorm, 0.55)) * (0.75 + 0.4 * unit(h2));
          let lift = (2.0 + 7.5 * unit(h3)) * pow(rNorm, 0.7);
          pc = bPos + vec3f(cos(az) * spread + gust, lift, sin(az) * spread);
          pr = R * (0.34 + 0.24 * unit(h4)) * (0.55 + 0.85 * pow(rNorm, 0.5));
          puffFade = envIn * (1.0 - smoothstep(0.28, 1.0, rNorm)) * 0.72;
        } else {
          // main rising smoke plume, curling outward as it climbs
          let delay = 0.04 * unit(h4);
          let la = max(0.0, sAge - delay);
          let ln = clamp(la / 2.15, 0.0, 1.0);
          let climb = pow(la, 0.78) * (14.0 + 26.0 * unit(h3)) * (0.75 + 0.35 * bForce);
          let spread = R * (0.18 + 0.75 * unit(h2)) * (0.35 + 1.05 * pow(ln, 0.65));
          pc = bPos + vec3f(cos(az) * spread + gust, climb + R * 0.18, sin(az) * spread);
          pr = R * (0.38 + 0.32 * unit(h4)) * (0.55 + 0.95 * pow(ln, 0.55));
          puffFade = smoothstep(0.0, 0.08, ln) * (1.0 - smoothstep(0.30, 1.0, ln));
        }
        if (puffFade <= 0.01 || pr < 1.0) { continue; }
        let tc = dot(pc - ro, rd);
        let q = ro + rd * tc - pc;
        let d2 = dot(q, q);
        if (d2 >= pr * pr || tc - pr >= bestT) { continue; }

        let vis = clamp((bestT - (tc - pr)) / max(pr * 0.9, 1.0), 0.0, 1.0);
        let u2 = 1.0 - d2 / (pr * pr);
        // subtle pixel-dithered break-up at the fringes so puffs read as crisp pixel smoke
        let wisp = clamp(u2 * 1.25 - 0.18 * dith, 0.0, 1.0);
        let w = wisp * puffFade * vis * 0.85;
        if (w <= 0.005) { continue; }

        // directional lighting on the smoke puff, lightly stepped into crisp bands with Bayer dither
        let zFront = sqrt(max(0.0, pr * pr - d2));
        let pn = normalize(q - rd * zFront);
        let lamRaw = clamp(dot(pn, u.sun.xyz) * 0.5 + 0.5, 0.0, 1.0);
        let lamBand = (floor(lamRaw * 3.0) + step(dith, fract(lamRaw * 3.0))) / 3.0;

        // warm sandstone-tinted dust near the base, classic grey-ash smoke higher up
        var baseSmoke = mix(vec3f(0.42, 0.38, 0.37), vec3f(0.84, 0.80, 0.75), smoothstep(0.05, 0.72, sNorm));
        if (isRing) {
          baseSmoke = mix(vec3f(0.76, 0.58, 0.46), vec3f(0.84, 0.77, 0.70), smoothstep(0.0, 0.7, sNorm));
        }
        var scol = mix(baseSmoke * SHADE * 1.15, baseSmoke * 1.08, lamBand);

        // warm fiery under-glow lighting the smoke from inside the blast during the first half-second
        if (hotGlow > 0.01) {
          let nearCore = clamp(1.0 - distance(pc, bPos) / (R * 1.9), 0.0, 1.0);
          scol = mix(scol, vec3f(1.0, 0.58, 0.18), hotGlow * nearCore * 0.65);
        }
        smokeW += w;
        smokeSum += scol * w;
      }
    }
  }

  // composite billowing smoke over scene (dither-clipped at very faint edges for crisp big pixels)
  if (smokeW > 0.02) {
    let alpha = 1.0 - exp(-smokeW * 1.45);
    let edge = step(dith * 0.16, alpha);
    col = mix(col, smokeSum / smokeW, min(alpha, 0.90) * edge);
  }
  // composite fiery blast core on top
  if (fireW > 0.03) {
    let fAlpha = 1.0 - exp(-fireW * 1.8);
    let fEdge = step(dith * 0.18, fAlpha);
    col = mix(col, fireSum / fireW, min(fAlpha, 0.96) * fEdge);
  }

  return col;
}

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

    // brief warm flash on nearby rock walls when dynamite detonates
    let nBlasts = min(dyn.counts.y, MAX_BLASTS);
    for (var bi = 0u; bi < nBlasts; bi++) {
      let bp = dyn.blasts[bi * 2u];
      let age = bp.w;
      if (age >= 0.0 && age < 0.24) {
        let R = dyn.blasts[bi * 2u + 1u].x;
        let bd = distance(cen, bp.xyz);
        if (bd < R * 2.2) {
          let att = (1.0 - bd / (R * 2.2)) * (1.0 - age / 0.24);
          col = mix(col, vec3f(1.0, 0.80, 0.42), clamp(att * 0.75, 0.0, 0.75));
        }
      }
    }

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
        // dynamite: also mark the exact spot where the stick will be planted
        if (tool == DYNAMITE && d < 1.35) { col = mix(col, vec3f(0.95, 0.25, 0.16), 0.75); }
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
  var behind = 1e9; // how far along this ray the block is
  if (h.hit) { behind = dot(vec3f(h.cell) + 0.5 - ro, u.camF.xyz); }
  if (u.craft.w > 0.5) {
    let k = marchCraft(ro, u.camF.xyz);
    if (k.hit && k.t < behind) {
      let lam = max(dot(k.n, u.sun.xyz), 0.0);
      let bcol = tone(k.c, k.cell);
      col = lights(select(bcol * SHADE, bcol * (0.62 + 0.5 * lam), lam > 0.0), k.c, k.cell, 16.0); // its lamps racing
      behind = k.t;
    }
    if (k.glass > 0.0 && k.gt < behind) {
      col = mix(col, PAL[GLASS], 0.2 + 0.3 * max(dot(k.gn, u.sun.xyz), 0.0));
    }
  }
  col = drawDynamite(ro, u.camF.xyz, behind, col, px);
  col = hoseJet(col, floor(fc.xy));
  return vec4f(col, 1.0);
}
