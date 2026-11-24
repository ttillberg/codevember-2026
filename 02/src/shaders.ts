// WGSL shaders for 02 / Shatter (WebGPU)
// - Sommerso volumetric glass (multi-bounce convex polyhedron raytracing + chromatic dispersion)
// - Animated 3D internal Voronoi cracks with crystal edge veins & TIR flashes
// - Glossy cut-crystal Rapier rigid-body shards
// - WebGPU compute shader for 4096 glittering splinters
// - Real-time dispersive fake floor caustics + bright-field white studio cyclorama

export const COMMON_WGSL = /* wgsl */ `
struct SceneUniforms {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  camPos: vec4<f32>,        // xyz = eye, w = time
  lightDir: vec4<f32>,      // xyz = unit dir TO light, w = causticStrength
  blockCenter: vec4<f32>,   // xyz = world center, w = cutRadius
  blockQuat: vec4<f32>,     // xyzw = rotation quat
  halfSize: vec4<f32>,      // xyz = initial cube half extents, w = ior
  palBottom: vec4<f32>,     // rgb, w = density
  palCore: vec4<f32>,       // rgb, w = dispersion
  palTop: vec4<f32>,        // rgb, w = crackProgress
  palEdge: vec4<f32>,       // rgb, w = planeHover
  cutOffset: vec4<f32>,     // xyz = world offset of severed piece, w = hasCutPiece
  causticBounds: vec4<f32>, // x = minX, y = minZ, z = invSpan, w = floorY
  params: vec4<f32>,        // x = planeAlpha, y = canCut, z = exposure, w = dt
  cutQuat: vec4<f32>,       // xyzw = rotation quat of severed cracking piece(s)
  cutPlaneN: vec4<f32>,     // xyz = outward unit normal of primary cutting plane
  cutPlane2N: vec4<f32>,    // xyz = outward unit normal of 2nd symmetrical cutting plane, w = radius (<0 = hidden)
};

struct PolyPlanes {
  info: vec4<u32>,              // x = planeCount, y = isCutPiece (0 = main, 1 = cut chunk), z = 0, w = 0
  offset: vec4<f32>,            // xyz = world position when isCutPiece == 1
  quat: vec4<f32>,              // xyzw = world rotation quat when isCutPiece == 1
  planes: array<vec4<f32>, 64>, // xyz = outward normal in local cube space, w = d
};

struct ShardPose {
  pos: vec4<f32>,  // xyz = world pos, w = active (>0.5)
  quat: vec4<f32>, // xyzw = world quat
};

fn qRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn qInvRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let qc = vec4<f32>(-q.xyz, q.w);
  return qRot(qc, v);
}

/**
 * Venetian Sommerso 3D volumetric colour tint at a point inside the original glass cube.
 * Rich ruby-amber base, glowing chartreuse-gold inner vessel, smoky sapphire-blue upper glass.
 */
fn sommersoTint(localPos: vec3<f32>, u: SceneUniforms) -> vec3<f32> {
  let h = max(u.halfSize.xyz, vec3<f32>(0.05));
  let p = localPos / h; // approx -1..+1
  let r = length(p.xz);

  // Fiery amber/vermilion base wrapping up the bottom bevels
  let tBase = smoothstep(-0.18, -0.56, p.y + 0.15 * r * r);
  // Luminous chartreuse/golden inner belly (concentrated inside the block!)
  let dyCore = (p.y + 0.08) / 0.48;
  let tCore = exp(-dyCore * dyCore) * exp(-r * r * 0.65);
  // Smoky sapphire-blue upper body, deepening to rich navy near outer vertical edges
  let tTop = smoothstep(-0.20, 0.62, p.y);
  let tRim = smoothstep(0.52, 1.18, r) * smoothstep(-0.32, 0.38, p.y);

  var col = mix(u.palTop.rgb * 0.78 + vec3<f32>(0.20), u.palTop.rgb, tTop);
  col = mix(col, u.palEdge.rgb, tRim * 0.72);
  col = mix(col, u.palCore.rgb, clamp(tCore * 0.98, 0.0, 0.94));
  col = mix(col, u.palBottom.rgb, tBase);

  return clamp(col, vec3<f32>(0.02), vec3<f32>(0.98));
}

/** Beer-Lambert absorption coefficients sigma = -ln(tint) * density */
fn sommersoSigma(localPos: vec3<f32>, u: SceneUniforms) -> vec3<f32> {
  let tint = sommersoTint(localPos, u);
  return -log(max(tint, vec3<f32>(0.012))) * u.palBottom.w;
}

/**
 * Bright-field museum glass photography studio (no walls: pure white luminous cyclorama,
 * sharp overhead & side softbox light strips, and crisp dark negative-fill side flags
 * that carve obsidian dark contours along steep glass facets just like the Murano reference!).
 */
fn sampleStudioEnv(ro: vec3<f32>, rd: vec3<f32>, u: SceneUniforms) -> vec3<f32> {
  let d = normalize(rd);

  // Luminous bright-field white studio cyclorama
  let upGrad = smoothstep(-0.18, 0.65, d.y);
  var col = mix(vec3<f32>(0.94, 0.938, 0.932), vec3<f32>(1.04, 1.04, 1.05), upGrad);

  // Crisp negative-fill dark studio flags on left & right (essential for clear crystal contrast!)
  let sideAbs = abs(d.x);
  let flagLeftRight = smoothstep(0.50, 0.68, sideAbs) * smoothstep(-0.28, 0.10, d.y) * smoothstep(0.84, 0.42, d.y);
  col = mix(col, vec3<f32>(0.018, 0.022, 0.032), flagLeftRight * 0.96);

  // Narrow secondary rear-side negative fill strip for internal bevel depth & chromatic fire
  let rearFlag = smoothstep(0.32, 0.54, sideAbs) * smoothstep(0.10, 0.52, -d.z) * smoothstep(-0.18, 0.22, d.y);
  col = mix(col, vec3<f32>(0.035, 0.042, 0.058), rearFlag * 0.80);

  // Crisp low dark negative-fill studio strip near horizon behind glass to outline clear crystal bases
  let lowBand = smoothstep(0.08, -0.02, d.y) * smoothstep(-0.28, -0.10, d.y) * smoothstep(0.05, 0.45, abs(d.x));
  col = mix(col, vec3<f32>(0.06, 0.07, 0.09), lowBand * 0.55);

  // Razor-sharp overhead softbox
  let topBox = smoothstep(0.74, 0.88, d.y) * smoothstep(0.56, 0.18, abs(d.x)) * smoothstep(0.58, 0.18, abs(d.z));
  col += vec3<f32>(2.4, 2.38, 2.35) * topBox;

  // Tall vertical left softbox window (creates the classic vertical glass reflection streak!)
  let vStrip = smoothstep(0.92, 0.975, dot(normalize(vec3<f32>(d.x, d.y * 0.25, d.z)), normalize(vec3<f32>(-0.56, 0.1, 0.82))))
               * smoothstep(-0.25, 0.05, d.y) * smoothstep(0.75, 0.45, d.y);
  col += vec3<f32>(2.6, 2.62, 2.68) * vStrip;

  // Front-left key studio softbox
  let keyDir = normalize(u.lightDir.xyz);
  let keyDot = max(0.0, dot(d, keyDir));
  col += vec3<f32>(1.8, 1.76, 1.68) * pow(keyDot, 28.0);
  col += vec3<f32>(3.8, 3.72, 3.60) * smoothstep(0.962, 0.990, keyDot);

  // Subtle right rim softbox for catching cut facets
  let rimDir = normalize(vec3<f32>(0.68, 0.42, 0.60));
  let rimDot = max(0.0, dot(d, rimDir));
  col += vec3<f32>(1.9, 1.92, 1.98) * smoothstep(0.945, 0.985, rimDot);

  // Matte white studio floor reflection when looking downward
  if (d.y < -0.005) {
    let tFloor = (u.causticBounds.w - ro.y) / d.y;
    if (tFloor > 0.0 && tFloor < 18.0) {
      let hit = ro + d * tFloor;
      let rFloor = length(hit.xz);
      let floorFade = exp(-rFloor * rFloor * 0.05);
      let floorCol = mix(vec3<f32>(0.96, 0.958, 0.952), vec3<f32>(0.88, 0.878, 0.872), floorFade * 0.5);
      let underBlock = exp(-dot(hit.xz - u.blockCenter.xz, hit.xz - u.blockCenter.xz) * 4.2);
      let shadedFloor = floorCol * (1.0 - underBlock * 0.22);
      col = mix(col, shadedFloor, smoothstep(-0.005, -0.08, d.y));
    }
  }

  return col;
}

fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  let x = clamp(1.0 - cosTheta, 0.0, 1.0);
  let x2 = x * x;
  return f0 + (1.0 - f0) * (x2 * x2 * x);
}

fn studioGrade(hdr: vec3<f32>, exposure: f32) -> vec3<f32> {
  // High-key photographic tone curve: crisp deep darks, punchy saturated midtones, pure studio whites
  let c = max(vec3<f32>(0.0), hdr * exposure);
  let shoulder = (c * (1.0 + c * 0.12)) / (1.0 + c * 0.26);
  let srgb = pow(clamp(shoulder, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  return srgb;
}

/**
 * Smooth 3D transparent-to-color crystal gradient mask [0 = crystal clear, 1 = deep jewel color].
 * Each gemstone has a slightly distinct optical axis & dip depth ("more or less" clear vs saturated)
 * like natural bicolored quartz/tourmaline or dipped Venetian Sommerso crystal.
 */
fn gemGradient(gemId: u32, p: vec3<f32>, u: SceneUniforms) -> f32 {
  let h = max(u.halfSize.xyz, vec3<f32>(0.05));
  let q = p / h; // approx -1..+1 in crystal local space
  let r2 = dot(q.xz, q.xz);

  // Per-gem tilted optical axis & dip window so gems show organic clear->color variation as they tumble
  var axis = vec3<f32>(0.18, -0.96, 0.14);
  var lo = -0.68;
  var hi = 0.58;
  if (gemId == 3u) {
    // Cool Rhodolite Ruby: clear crown melting smoothly into purplish crimson-berry
    axis = normalize(vec3<f32>(0.24, -0.95, 0.18));
    lo = -0.62;
    hi = 0.58;
  } else if (gemId == 4u) {
    // Cyan-Emerald: translucent clear diagonal fading into cool cyan-emerald tourmaline
    axis = normalize(vec3<f32>(-0.28, -0.92, 0.24));
    lo = -0.70;
    hi = 0.54;
  } else if (gemId == 5u) {
    // Sapphire: crystalline clear side sweeping into deep royal blue
    axis = normalize(vec3<f32>(0.36, -0.88, -0.26));
    lo = -0.56;
    hi = 0.62;
  } else if (gemId == 6u) {
    // Amethyst: natural quartz clear base growing into cool imperial violet point
    axis = normalize(vec3<f32>(-0.18, 0.96, 0.18));
    lo = -0.58;
    hi = 0.58;
  } else if (gemId == 7u) {
    // Tanzanite / Periwinkle: luminous clear crystal dipped in cool indigo-periwinkle
    axis = normalize(vec3<f32>(0.22, -0.94, -0.22));
    lo = -0.62;
    hi = 0.56;
  } else if (gemId == 8u) {
    // Aquamarine: icy clear crystal blushing into crisp glacial cyan
    axis = normalize(vec3<f32>(-0.32, 0.90, -0.24));
    lo = -0.52;
    hi = 0.64;
  } else if (gemId == 9u) {
    // Orchid-Mist Crystal: mostly water-clear glass with a cool rose-plum nudge at one end
    axis = normalize(vec3<f32>(0.34, -0.90, 0.24));
    lo = 0.08;
    hi = 0.95;
  } else if (gemId == 10u) {
    // Ice-Mist Crystal: mostly pure clear glass kissed with pale glacier blue along one tip
    axis = normalize(vec3<f32>(-0.38, 0.88, 0.22));
    lo = 0.10;
    hi = 0.96;
  } else if (gemId == 11u) {
    // Mint-Frost Crystal: luminous clear glass with a delicate icy cyan-mint blush at one corner
    axis = normalize(vec3<f32>(0.26, -0.92, -0.28));
    lo = 0.06;
    hi = 0.94;
  } else if (gemId == 12u) {
    // Lilac-Mist Crystal: water-clear quartz with a cool lavender-periwinkle whisper at the tip
    axis = normalize(vec3<f32>(-0.24, 0.94, -0.22));
    lo = 0.08;
    hi = 0.95;
  }

  // Subtle curved meniscus (like hand-dipped glass) keeps the gradient organic across faceted bevels
  let proj = dot(q, axis) + 0.10 * (r2 - 0.45);
  let t = smoothstep(lo, hi, proj);
  return pow(t, 1.12);
}

/**
 * Physical Beer-Lambert volumetric absorption sigma (m^-1) per gemstone ID (cool mineral spectrum):
 *  0 = Palette default (Sommerso/Crystal)
 *  2 = Pure Clear Diamond (100% transparent optical crystal)
 *  3 = Rhodolite Ruby (clear crystal -> cool purplish crimson-berry)
 *  4 = Cyan-Emerald (clear crystal -> cool cyan-green tourmaline)
 *  5 = Sapphire (clear crystal -> Ceylon royal blue)
 *  6 = Amethyst (clear crystal -> cool imperial violet)
 *  7 = Tanzanite (clear crystal -> cool indigo-periwinkle)
 *  8 = Aquamarine (clear crystal -> crisp glacial cyan)
 *  9 = Orchid-Mist Crystal (mostly transparent, cool rose-plum nudge)
 * 10 = Ice-Mist Crystal (mostly transparent, pale glacier-blue nudge)
 * 11 = Mint-Frost Crystal (mostly transparent, cool cyan-mint nudge)
 * 12 = Lilac-Mist Crystal (mostly transparent, cool lavender nudge)
 */
fn gemSigma(gemId: u32, p: vec3<f32>, u: SceneUniforms) -> vec3<f32> {
  if (gemId == 0u) { return sommersoSigma(p, u); }
  let clearSig = vec3<f32>(0.048, 0.044, 0.040);
  if (gemId == 2u) {
    // 100% pure water-clear crystal diamond (zero tint, pure refraction & chromatic dispersion)
    return clearSig;
  }
  var richSig = clearSig;
  if (gemId == 3u) { richSig = vec3<f32>(1.15, 4.65, 2.15); }      // Smoky Plum / Mauve-Wine
  else if (gemId == 4u) { richSig = vec3<f32>(4.80, 1.10, 1.45); } // Sea-Glass Teal / Fjord Spruce
  else if (gemId == 5u) { richSig = vec3<f32>(4.80, 2.55, 0.92); } // Arctic Slate-Cobalt
  else if (gemId == 6u) { richSig = vec3<f32>(2.15, 4.55, 1.25); } // Smoky Iris / Dusty Amethyst
  else if (gemId == 7u) { richSig = vec3<f32>(3.30, 2.75, 1.05); } // Storm Periwinkle
  else if (gemId == 8u) { richSig = vec3<f32>(4.35, 1.35, 0.95); } // Pale Glacier Petrol-Cyan
  else if (gemId == 9u) { richSig = vec3<f32>(0.55, 1.85, 0.95); } // Dusty Mauve-Mist
  else if (gemId == 10u) { richSig = vec3<f32>(1.80, 1.05, 0.42); }// Glacier-Slate Mist
  else if (gemId == 11u) { richSig = vec3<f32>(1.85, 0.55, 0.72); }// Sea-Glass Mist
  else if (gemId == 12u) { richSig = vec3<f32>(1.00, 1.80, 0.58); }// Smoke-Lilac Mist
  else { return sommersoSigma(p, u); }

  let g = gemGradient(gemId, p, u);
  return mix(clearSig, richSig, g);
}

/** Luminous transmission tint for colored gem caustics & razor bevel glints (inherits clear->color gradient). */
fn gemTint(gemId: u32, p: vec3<f32>, u: SceneUniforms) -> vec3<f32> {
  if (gemId == 0u) { return sommersoTint(p, u); }
  let clearTint = vec3<f32>(1.00, 1.00, 1.00);
  if (gemId == 2u) { return clearTint; }
  var richTint = clearTint;
  if (gemId == 3u) { richTint = vec3<f32>(0.84, 0.44, 0.68); }
  else if (gemId == 4u) { richTint = vec3<f32>(0.36, 0.82, 0.76); }
  else if (gemId == 5u) { richTint = vec3<f32>(0.42, 0.62, 0.88); }
  else if (gemId == 6u) { richTint = vec3<f32>(0.68, 0.50, 0.88); }
  else if (gemId == 7u) { richTint = vec3<f32>(0.56, 0.64, 0.88); }
  else if (gemId == 8u) { richTint = vec3<f32>(0.40, 0.80, 0.88); }
  else if (gemId == 9u) { richTint = vec3<f32>(0.90, 0.76, 0.86); }
  else if (gemId == 10u) { richTint = vec3<f32>(0.76, 0.86, 0.94); }
  else if (gemId == 11u) { richTint = vec3<f32>(0.74, 0.90, 0.88); }
  else if (gemId == 12u) { richTint = vec3<f32>(0.84, 0.78, 0.94); }
  else { return sommersoTint(p, u); }

  let g = gemGradient(gemId, p, u);
  let baseMix = select(0.15, 0.0, gemId >= 9u);
  return mix(clearTint, richTint, baseMix + (1.0 - baseMix) * g);
}
`;

export const FLOOR_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var causticTex: texture_2d<f32>;
@group(0) @binding(2) var causticSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var pts = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(pts[vi], 0.9999, 1.0);
  out.uv = pts[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0);
  let pNear = u.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let pFar = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let ro = pNear.xyz / pNear.w;
  let rd = normalize(pFar.xyz / pFar.w - ro);

  // Super-soft pure vertical studio gradient:
  // airy pastel sky-mist at top -> luminous warm alabaster center -> silky warm sand-porcelain floor
  let sy = clamp(in.uv.y, 0.0, 1.0);
  let topCol = vec3<f32>(0.68, 0.78, 0.93);    // soft airy sky-mist
  let midCol = vec3<f32>(0.97, 0.955, 0.94);   // luminous studio ivory horizon
  let botCol = vec3<f32>(0.92, 0.83, 0.77);    // soft warm cream-sand cove
  var col = mix(botCol, midCol, smoothstep(0.0, 0.50, sy));
  col = mix(col, topCol, smoothstep(0.46, 1.0, sy));

  if (rd.y < -0.002) {
    let t = (u.causticBounds.w - ro.y) / rd.y;
    if (t > 0.0 && t < 45.0) {
      let hit = ro + rd * t;
      let dist = length(hit.xz);

      let stageMask = exp(-dist * dist * 0.05);
      // Keep the floor seamlessly blended into the soft cyclorama gradient with subtle grounding warmth
      var floorCol = mix(col, col * vec3<f32>(0.975, 0.972, 0.968), stageMask * 0.72);

      let grain = fract(sin(dot(floor(hit.xz * 280.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
      floorCol *= 0.995 + 0.010 * grain;

      let cuv = (hit.xz - u.causticBounds.xy) * u.causticBounds.z;
      if (cuv.x > 0.005 && cuv.x < 0.995 && cuv.y > 0.005 && cuv.y < 0.995) {
        let texel = 1.0 / 1024.0;

        // Soft studio shadow penumbra (alpha channel)
        var shadow = 0.0;
        let rS = texel * 6.5;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv, 0.0).a * 0.24;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(rS, 0.0), 0.0).a * 0.11;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(-rS, 0.0), 0.0).a * 0.11;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(0.0, rS), 0.0).a * 0.11;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(0.0, -rS), 0.0).a * 0.11;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(rS * 0.72, rS * 0.72), 0.0).a * 0.08;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(-rS * 0.72, rS * 0.72), 0.0).a * 0.08;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(rS * 0.72, -rS * 0.72), 0.0).a * 0.08;
        shadow += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(-rS * 0.72, -rS * 0.72), 0.0).a * 0.08;
        shadow = clamp(shadow, 0.0, 1.0);

        // Crisp chromatic caustic sample (rgb)
        let rC = texel * 1.6;
        var caust = textureSampleLevel(causticTex, causticSamp, cuv, 0.0).rgb * 0.44;
        caust += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(rC, 0.0), 0.0).rgb * 0.14;
        caust += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(-rC, 0.0), 0.0).rgb * 0.14;
        caust += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(0.0, rC), 0.0).rgb * 0.14;
        caust += textureSampleLevel(causticTex, causticSamp, cuv + vec2<f32>(0.0, -rC), 0.0).rgb * 0.14;

        let edgeFade = smoothstep(0.0, 0.06, cuv.x) * smoothstep(1.0, 0.94, cuv.x) *
                       smoothstep(0.0, 0.06, cuv.y) * smoothstep(1.0, 0.94, cuv.y);
        shadow *= edgeFade;
        caust *= edgeFade * u.lightDir.w;

        // Soft studio occlusion + vivid stained-glass transmission & bright caustic focus bands!
        let shadowFactor = 1.0 - shadow * 0.30;
        let maxC = max(max(caust.r, caust.g), max(caust.b, 0.001));
        let caustHue = caust / maxC;
        let caustLum = dot(caust, vec3<f32>(0.299, 0.587, 0.114));
        // Stained-glass tinting inside shadow + luminous chromatic ridges!
        let stainMix = clamp(caustLum * 0.72, 0.0, 0.72);
        let stained = mix(floorCol * shadowFactor, floorCol * mix(vec3<f32>(0.72), caustHue, 0.92), stainMix);
        // Focused hot caustic bands (where facets overlap!) glow vividly
        let hotspot = max(vec3<f32>(0.0), caust - vec3<f32>(0.18));
        floorCol = stained + caust * 0.32 + hotspot * 0.65;
      }

      // Soft ambient grounding shadow under suspended block (fades out cleanly when block is below frame)
      let underDist = length(hit.xz - u.blockCenter.xz);
      let blockAbove = smoothstep(-0.15, 0.25, u.blockCenter.y);
      let ao = exp(-underDist * underDist * 4.2) * 0.095 * blockAbove;
      floorCol *= (1.0 - ao);

      let farFade = smoothstep(3.6, 10.5, dist);
      col = mix(floorCol, col, farFade);
    }
  }

  // Tiny interleaved-gradient-noise dither eliminates 8-bit banding across soft studio gradients
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2<f32>(0.06711056, 0.00583715))));
  let graded = clamp(studioGrade(col, u.params.z) + vec3<f32>((ign - 0.5) / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(graded, 1.0);
}
`;

export const CAUSTICS_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> poses: array<ShardPose>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
  @location(2) localPos: vec3<f32>,
};

fn projectFloorNDC(xz: vec2<f32>) -> vec2<f32> {
  let uv = (xz - u.causticBounds.xy) * u.causticBounds.z;
  return vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

@vertex
fn vs_block(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  var out: VSOut;
  let wp = u.blockCenter.xyz + qRot(u.blockQuat, localPos);
  let wn = normalize(qRot(u.blockQuat, localNorm));
  let L = normalize(u.lightDir.xyz);
  let h = max(0.0, wp.y - u.causticBounds.w);
  let above = smoothstep(-0.12, 0.22, u.blockCenter.y);
  out.localPos = localPos;

  if (inst == 0u) {
    let t = h / max(0.14, L.y);
    let xz = wp.xz - L.xz * t;
    out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
    out.color = vec3<f32>(0.0);
    out.alpha = 0.45 * above;
    return out;
  }

  let disp = u.palCore.w;
  var ior = u.halfSize.w;
  var mask = vec3<f32>(1.0, 0.0, 0.0);
  if (inst == 1u) {
    ior -= disp * 0.85;
    mask = vec3<f32>(1.0, 0.0, 0.0);
  } else if (inst == 2u) {
    mask = vec3<f32>(0.0, 1.0, 0.0);
  } else {
    ior += disp * 1.05;
    mask = vec3<f32>(0.0, 0.0, 1.0);
  }

  let nFacing = select(-wn, wn, dot(wn, L) > 0.0);
  var refr = refract(-L, nFacing, 1.0 / ior);
  if (length(refr) < 0.01) { refr = -L; }
  // Tight realistic caustic focusing around the shadow footprint
  let rayDir = normalize(mix(-L, refr, 0.92));
  let t = h / max(0.22, -rayDir.y);
  let xz = wp.xz + rayDir.xz * t;

  let tint = sommersoTint(localPos, u);
  let ndl = abs(dot(wn, L));
  let focusBoost = 0.25 + 0.75 * pow(1.0 - abs(ndl - 0.52), 2.0);
  let energy = focusBoost * (0.26 + 0.34 * ndl);

  out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
  out.color = tint * mask * energy * 1.18 * above;
  out.alpha = 0.0;
  return out;
}

@vertex
fn vs_cut(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  var out: VSOut;
  let wp = u.blockCenter.xyz + u.cutOffset.xyz + qRot(u.cutQuat, localPos);
  let wn = normalize(qRot(u.cutQuat, localNorm));
  let L = normalize(u.lightDir.xyz);
  let h = max(0.0, wp.y - u.causticBounds.w);
  out.localPos = localPos;

  if (inst == 0u) {
    let t = h / max(0.14, L.y);
    let xz = wp.xz - L.xz * t;
    out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
    out.color = vec3<f32>(0.0);
    out.alpha = 0.42;
    return out;
  }

  let disp = u.palCore.w;
  var ior = u.halfSize.w;
  var mask = vec3<f32>(1.0, 0.0, 0.0);
  if (inst == 1u) {
    ior -= disp * 0.85;
    mask = vec3<f32>(1.0, 0.0, 0.0);
  } else if (inst == 2u) {
    mask = vec3<f32>(0.0, 1.0, 0.0);
  } else {
    ior += disp * 1.05;
    mask = vec3<f32>(0.0, 0.0, 1.0);
  }

  let nFacing = select(-wn, wn, dot(wn, L) > 0.0);
  var refr = refract(-L, nFacing, 1.0 / ior);
  if (length(refr) < 0.01) { refr = -L; }
  let rayDir = normalize(mix(-L, refr, 0.92));
  let t = h / max(0.22, -rayDir.y);
  let xz = wp.xz + rayDir.xz * t;

  let tint = sommersoTint(localPos, u);
  let ndl = abs(dot(wn, L));
  let focusBoost = 0.25 + 0.75 * pow(1.0 - abs(ndl - 0.52), 2.0);
  let energy = focusBoost * (0.26 + 0.34 * ndl);

  out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
  out.color = tint * mask * energy * 1.18;
  out.alpha = 0.0;
  return out;
}

@vertex
fn vs_shards(
  @location(0) relPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @location(2) origPos: vec3<f32>,
  @location(3) shardIdF: f32,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  var out: VSOut;
  let sid = u32(shardIdF + 0.5);
  let pose = poses[sid];
  out.localPos = origPos;
  if (pose.pos.w < 0.5) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.alpha = 0.0;
    return out;
  }

  let wp = pose.pos.xyz + qRot(pose.quat, relPos);
  let wn = normalize(qRot(pose.quat, localNorm));
  let L = normalize(u.lightDir.xyz);
  let h = max(0.008, wp.y - u.causticBounds.w);

  if (inst == 0u) {
    let t = h / max(0.14, L.y);
    let xz = wp.xz - L.xz * t;
    out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
    out.color = vec3<f32>(0.0);
    out.alpha = 0.32;
    return out;
  }

  let disp = u.palCore.w;
  var ior = u.halfSize.w;
  var mask = vec3<f32>(1.0, 0.0, 0.0);
  if (inst == 1u) {
    ior -= disp;
    mask = vec3<f32>(1.0, 0.0, 0.0);
  } else if (inst == 2u) {
    mask = vec3<f32>(0.0, 1.0, 0.0);
  } else {
    ior += disp * 1.15;
    mask = vec3<f32>(0.0, 0.0, 1.0);
  }

  let nFacing = select(-wn, wn, dot(wn, L) > 0.0);
  var refr = refract(-L, nFacing, 1.0 / ior);
  if (length(refr) < 0.01) { refr = -L; }
  let hEff = max(0.045, h + 0.03);
  let rayDir = normalize(mix(-L, refr, 1.18));
  let t = hEff / max(0.20, -rayDir.y);
  let xz = wp.xz + rayDir.xz * t;

  let gemId = u32(max(0.0, pose.pos.w - 0.5));
  let tint = gemTint(gemId, origPos, u);
  let ndl = abs(dot(wn, L));
  let energy = 0.30 + 0.58 * ndl;

  out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
  // Poisoned black diamond shards (gemId == 1u) cast zero rainbow caustics — only dark obsidian shadows!
  out.color = select(tint * mask * energy * 1.15, vec3<f32>(0.0), gemId == 1u);
  out.alpha = 0.0;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Subtle organic optical caustic ribbon modulation so flat faces don't look like plain flat rectangles
  let wave = 0.78 + 0.34 * sin(in.localPos.x * 24.0 + in.localPos.z * 19.0) * cos(in.localPos.y * 22.0);
  return vec4<f32>(in.color * wave, in.alpha);
}
`;

/** Dedicated per-slot caustic + shadow pass for each independently tumbling cut crystal chunk! */
export const CAUSTICS_CUT_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<uniform> poly: PolyPlanes;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
  @location(2) localPos: vec3<f32>,
};

fn projectFloorNDC(xz: vec2<f32>) -> vec2<f32> {
  let uv = (xz - u.causticBounds.xy) * u.causticBounds.z;
  return vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

@vertex
fn vs_cut(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @builtin(instance_index) inst: u32,
) -> VSOut {
  var out: VSOut;
  let wp = poly.offset.xyz + qRot(poly.quat, localPos);
  let wn = normalize(qRot(poly.quat, localNorm));
  let L = normalize(u.lightDir.xyz);
  let h = max(0.0, wp.y - u.causticBounds.w);
  let above = smoothstep(-0.12, 0.16, poly.offset.y);
  out.localPos = localPos;

  if (inst == 0u) {
    let t = h / max(0.14, L.y);
    let xz = wp.xz - L.xz * t;
    out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
    out.color = vec3<f32>(0.0);
    // Poisoned black diamonds cast a darker, crisper shadow!
    let shadowAlpha = select(0.42, 0.78, poly.info.z == 1u);
    out.alpha = shadowAlpha * above;
    return out;
  }

  // Poisoned black diamonds absorb all light (zero prismatic floor caustics)
  if (poly.info.z == 1u) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = vec3<f32>(0.0);
    out.alpha = 0.0;
    return out;
  }

  let disp = u.palCore.w;
  var ior = u.halfSize.w;
  var mask = vec3<f32>(1.0, 0.0, 0.0);
  if (inst == 1u) {
    ior -= disp * 0.85;
    mask = vec3<f32>(1.0, 0.0, 0.0);
  } else if (inst == 2u) {
    mask = vec3<f32>(0.0, 1.0, 0.0);
  } else {
    ior += disp * 1.05;
    mask = vec3<f32>(0.0, 0.0, 1.0);
  }

  let nFacing = select(-wn, wn, dot(wn, L) > 0.0);
  var refr = refract(-L, nFacing, 1.0 / ior);
  if (length(refr) < 0.01) { refr = -L; }
  let rayDir = normalize(mix(-L, refr, 0.92));
  let t = h / max(0.22, -rayDir.y);
  let xz = wp.xz + rayDir.xz * t;

  let tint = gemTint(poly.info.z, localPos, u);
  let ndl = abs(dot(wn, L));
  let focusBoost = 0.25 + 0.75 * pow(1.0 - abs(ndl - 0.52), 2.0);
  let energy = focusBoost * (0.26 + 0.34 * ndl);

  out.pos = vec4<f32>(projectFloorNDC(xz), 0.5, 1.0);
  out.color = tint * mask * energy * 1.24 * above;
  out.alpha = 0.0;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let wave = 0.78 + 0.34 * sin(in.localPos.x * 24.0 + in.localPos.z * 19.0) * cos(in.localPos.y * 22.0);
  return vec4<f32>(in.color * wave, in.alpha);
}
`;

export const GLASS_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<uniform> poly: PolyPlanes;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) localPos: vec3<f32>,
  @location(3) localNorm: vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
) -> VSOut {
  var out: VSOut;
  let isCut = poly.info.y == 1u;
  let q = select(u.blockQuat, poly.quat, isCut);
  let basePos = select(u.blockCenter.xyz, poly.offset.xyz, isCut);
  let wp = basePos + qRot(q, localPos);
  let wn = normalize(qRot(q, localNorm));
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.localPos = localPos;
  out.localNorm = normalize(localNorm);
  return out;
}

struct Hit {
  t: f32,
  n: vec3<f32>,
  planeIdx: i32,
};

/** Exact ray exit from inside a convex polyhedron, ignoring skipPlane so corner bounces have zero seam dots. */
fn traceExit(ro: vec3<f32>, rd: vec3<f32>, skipPlane: i32) -> Hit {
  var bestT = 1e6;
  var bestN = rd;
  var bestIdx: i32 = -1;
  let count = poly.info.x;
  for (var i = 0u; i < count; i = i + 1u) {
    let ii = i32(i);
    if (ii == skipPlane) { continue; }
    let pl = poly.planes[i];
    let denom = dot(pl.xyz, rd);
    if (denom > 1e-6) {
      let t = (pl.w - dot(pl.xyz, ro)) / denom;
      if (t > -1e-4 && t < bestT) {
        bestT = max(0.0, t);
        bestN = pl.xyz;
        bestIdx = ii;
      }
    }
  }
  return Hit(bestT, bestN, bestIdx);
}

fn traceChannel(
  localRo: vec3<f32>,
  localInDir: vec3<f32>,
  localN: vec3<f32>,
  worldCenter: vec3<f32>,
  objQuat: vec4<f32>,
  ior: f32,
  ch: u32,
) -> f32 {
  var rd = refract(localInDir, localN, 1.0 / ior);
  if (length(rd) < 0.001) {
    let wRefl = qRot(objQuat, reflect(localInDir, localN));
    return sampleStudioEnv(worldCenter, wRefl, u)[ch];
  }
  rd = normalize(rd);
  var ro = localRo;
  var skip: i32 = -1;
  var throughput = 1.0;
  var accum = 0.0;

  for (var bounce = 0; bounce < 4; bounce = bounce + 1) {
    let h = traceExit(ro, rd, skip);
    if (h.planeIdx < 0 || h.t > 100.0) { break; }

    // 3-point Beer-Lambert volumetric integration through the gemstone / Sommerso body
    let p1 = ro + rd * (h.t * 0.22);
    let p2 = ro + rd * (h.t * 0.50);
    let p3 = ro + rd * (h.t * 0.78);
    let s1 = gemSigma(poly.info.z, p1, u)[ch];
    let s2 = gemSigma(poly.info.z, p2, u)[ch];
    let s3 = gemSigma(poly.info.z, p3, u)[ch];
    let avgSigma = (s1 + s2 * 1.4 + s3) / 3.4;
    throughput *= exp(-avgSigma * h.t);

    let hitP = ro + rd * h.t;
    let outN = normalize(h.n);

    let exitDir = refract(rd, -outN, ior);
    if (length(exitDir) < 0.001) {
      // Total Internal Reflection!
      rd = normalize(reflect(rd, -outN));
      ro = hitP;
      skip = h.planeIdx;
      throughput *= 0.95;
    } else {
      let cosOut = clamp(dot(rd, outN), 0.0, 1.0);
      let F = fresnelSchlick(cosOut, 0.048);
      let wExitPos = worldCenter + qRot(objQuat, hitP);
      let wExitDir = normalize(qRot(objQuat, exitDir));
      let env = sampleStudioEnv(wExitPos, wExitDir, u);
      accum += throughput * (1.0 - F) * env[ch];

      throughput *= F * 0.92;
      if (throughput < 0.015) { break; }
      rd = normalize(reflect(rd, -outN));
      ro = hitP;
      skip = h.planeIdx;
    }
  }

  if (throughput > 0.015) {
    let wDir = normalize(qRot(objQuat, rd));
    accum += throughput * sampleStudioEnv(worldCenter, wDir, u)[ch] * 0.30;
  }
  return accum;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNorm);
  let V = normalize(u.camPos.xyz - in.worldPos);
  let inDirWorld = -V;
  let cosV = max(0.0, dot(N, V));
  let L = normalize(u.lightDir.xyz);
  let H = normalize(L + V);

  // Poisoned Black Diamond (poly.info.z == 1u): lethal jet-obsidian faceted diamond with mirror studio flashes!
  if (poly.info.z == 1u) {
    let F = fresnelSchlick(cosV, 0.17);
    let reflDir = reflect(inDirWorld, N);
    let envRefl = sampleStudioEnv(in.worldPos, reflDir, u);
    // High-contrast mirror reflection on flat diamond facets (crisp dark flags vs dazzling white softboxes!)
    let mirror = pow(max(envRefl, vec3<f32>(0.0)), vec3<f32>(1.85)) * 0.52;
    let ndl = max(0.0, dot(N, L));
    let edgeGrad = length(fwidth(in.worldNorm));
    let edgeGlint = clamp(edgeGrad * 2.8, 0.0, 1.0);
    let spec1 = pow(max(0.0, dot(N, H)), 260.0) * 4.2;
    let H2 = normalize(normalize(vec3<f32>(0.68, 0.42, 0.60)) + V);
    let spec2 = pow(max(0.0, dot(N, H2)), 140.0) * 1.8;
    let H3 = normalize(normalize(vec3<f32>(-0.55, 0.65, 0.50)) + V);
    let spec3 = pow(max(0.0, dot(N, H3)), 90.0) * 0.75;
    // Deep jet-black core with subtle cool graphite facet separation & whisper of crimson at extreme grazing angle
    let baseObsidian = vec3<f32>(0.004, 0.0045, 0.0065) + vec3<f32>(0.012, 0.013, 0.017) * ndl;
    let grazingEdge = pow(clamp(1.0 - cosV, 0.0, 1.0), 5.0) * vec3<f32>(0.18, 0.025, 0.045);
    let col = mix(baseObsidian, mirror, F * 0.92)
            + vec3<f32>(0.96, 0.98, 1.0) * (spec1 + spec2 + spec3)
            + vec3<f32>(0.55, 0.58, 0.64) * edgeGlint * (0.45 + 0.55 * F)
            + grazingEdge;
    // Tiny interleaved-gradient-noise dither eliminates 8-bit banding across soft studio gradients
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2<f32>(0.06711056, 0.00583715))));
  let graded = clamp(studioGrade(col, u.params.z) + vec3<f32>((ign - 0.5) / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(graded, 1.0);
  }

  let isCut = poly.info.y == 1u;
  let objQuat = select(u.blockQuat, poly.quat, isCut);
  let center = select(u.blockCenter.xyz, poly.offset.xyz, isCut);

  let localInDir = normalize(qInvRot(objQuat, inDirWorld));
  let localN = normalize(in.localNorm);

  let baseIor = u.halfSize.w;
  let disp = u.palCore.w;

  let rCol = traceChannel(in.localPos, localInDir, localN, center, objQuat, baseIor - disp, 0u);
  let gCol = traceChannel(in.localPos, localInDir, localN, center, objQuat, baseIor, 1u);
  let bCol = traceChannel(in.localPos, localInDir, localN, center, objQuat, baseIor + disp * 1.15, 2u);
  let refracted = vec3<f32>(rCol, gCol, bCol);

  // Crisp glossy Fresnel reflection of the bright-field studio softboxes & dark flags
  let F = fresnelSchlick(cosV, 0.052);
  let reflDir = reflect(inDirWorld, N);
  let reflected = sampleStudioEnv(in.worldPos, reflDir, u);

  // Sharp studio key specular highlight
  let spec = pow(max(0.0, dot(N, H)), 180.0) * 2.6;

  var col = mix(refracted, reflected, F * 0.94) + vec3<f32>(1.0, 0.99, 0.98) * spec;

  // Razor-sharp glowing score line(s) where the cutting plane(s) slice the glass
  if (poly.info.y == 0u && u.cutOffset.w < 0.5 && u.params.y > 0.5 && u.params.x > 0.5) {
    let relW = in.worldPos - u.blockCenter.xyz;
    let planeDist = dot(relW, normalize(u.cutPlaneN.xyz)) - u.blockCenter.w;
    var cutLine = exp(-abs(planeDist) * 320.0);
    var inOuter = planeDist > 0.0;
    if (u.cutPlane2N.w >= 0.0) {
      let planeDist2 = dot(relW, normalize(u.cutPlane2N.xyz)) - u.cutPlane2N.w;
      cutLine = max(cutLine, exp(-abs(planeDist2) * 320.0));
      inOuter = inOuter || (planeDist2 > 0.0);
    }
    col = mix(col, vec3<f32>(1.8, 1.85, 1.95), cutLine * 0.88);
    if (inOuter) {
      col = mix(col, col * vec3<f32>(1.05, 1.06, 1.09) + vec3<f32>(0.025), 0.30);
    }
  }

  // Tiny interleaved-gradient-noise dither eliminates 8-bit banding across soft studio gradients
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2<f32>(0.06711056, 0.00583715))));
  let graded = clamp(studioGrade(col, u.params.z) + vec3<f32>((ign - 0.5) / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(graded, 1.0);
}
`;

export const CRACKS_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<uniform> poly: PolyPlanes;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) localPos: vec3<f32>,
  @location(3) delay: f32,
  @location(4) edgeFlag: f32,
};

fn hash31(p: vec3<f32>) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn vnoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  return mix(mix(nx00, nx10, s.y), mix(nx01, nx11, s.y), s.z);
}

@vertex
fn vs_main(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @location(2) delay: f32,
  @location(3) edgeFlag: f32,
) -> VSOut {
  var out: VSOut;
  let wp = poly.offset.xyz + qRot(poly.quat, localPos);
  let wn = normalize(qRot(poly.quat, localNorm));
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.localPos = localPos;
  out.delay = delay;
  out.edgeFlag = edgeFlag;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Subtle internal 3D Voronoi fracture planes sweeping outward from the cutting plane
  // in exact sync with the exterior shard fracture seams!
  let arrival = clamp(in.delay * 0.27, 0.0, 0.29);
  let tNow = u.palTop.w;
  if (tNow < arrival) {
    discard;
  }

  let age = tNow - arrival;
  // Progressive internal mirror brightening as air enters the widening 3D fracture planes
  let openUp = smoothstep(0.0, 0.22, age);
  let hp = in.localPos * 95.0;
  let hackle = vec3<f32>(
    vnoise3(hp) - 0.5,
    vnoise3(hp + vec3<f32>(17.3, 9.1, 4.7)) - 0.5,
    vnoise3(hp + vec3<f32>(5.2, 23.7, 13.9)) - 0.5
  );
  let N = normalize(in.worldNorm + hackle * 0.18);
  let V = normalize(u.camPos.xyz - in.worldPos);
  let ndv = abs(dot(N, V));

  let L = normalize(u.lightDir.xyz);
  let H = normalize(L + V);
  let spec = pow(max(0.0, abs(dot(N, H))), 96.0);
  let refl = sampleStudioEnv(in.worldPos, reflect(-V, N), u);
  let tint = sommersoTint(in.localPos, u);

  let tir = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0);
  let waveFlash = exp(-age / 0.045) * 0.38;

  let darkRefr = tint * 0.18;
  let mirrorCol = mix(darkRefr, refl * (0.58 + 0.42 * tint), 0.55) + vec3<f32>(1.8) * (spec + waveFlash);
  let alpha = clamp((0.012 + tir * (0.10 + 0.14 * openUp) + spec * 0.26 + waveFlash * 0.22), 0.0, 0.28);

  return vec4<f32>(studioGrade(mirrorCol, u.params.z), alpha);
}
`;

export const SURFACE_CRACKS_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<uniform> poly: PolyPlanes;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) localPos: vec3<f32>,
  @location(3) across: f32,
  @location(4) crackTime: f32,
  @location(5) slant: f32,
  @location(6) boldness: f32,
};

fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn vnoise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), s.x),
    mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), s.x),
    s.y
  );
}

@vertex
fn vs_main(
  @location(0) localPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @location(2) across: f32,
  @location(3) crackTime: f32,
  @location(4) slant: f32,
  @location(5) boldness: f32,
) -> VSOut {
  var out: VSOut;
  let wp = poly.offset.xyz + qRot(poly.quat, localPos);
  let wn = normalize(qRot(poly.quat, localNorm));
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.localPos = localPos;
  out.across = across;
  out.crackTime = crackTime;
  out.slant = slant;
  out.boldness = boldness;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Directional fracture wave: Voronoi shard seams unzip outward from the cutting plane
  // and progressively widen + brighten with air-gap mirror sheen as breaking tension builds!
  let tNow = u.palTop.w;
  if (tNow < in.crackTime) {
    discard;
  }

  let age = tNow - in.crackTime;
  let openProg = smoothstep(0.0, 0.26, age); // 0 right as tip unzips -> 1 as cleft widens under tension
  let fw = max(0.06, fwidth(in.across));
  let sgn = select(-1.0, 1.0, in.slant >= 0.0);

  let chipCoord = in.localPos.xy * 460.0 + in.localPos.z * 380.0 + vec2<f32>(in.slant * 17.0, 0.0);
  let jag = (vnoise2(chipCoord * 0.65) - 0.5) * 0.24;
  // Crack starts razor-thin at the advancing tip and opens progressively wider!
  let widthGrow = 0.52 + 0.58 * openProg;
  let a = (in.across + jag) / widthGrow;

  // High-contrast double-walled crystal fracture seam:
  // crisp dark obsidian TIR cleft paired with view-dependent silver-white glints!
  let darkBand = 1.0 - smoothstep(0.05, 0.38 + fw, abs(a + sgn * 0.22));
  let whiteBand = 1.0 - smoothstep(0.04, 0.44 + fw, abs(a - sgn * 0.22));

  let N = normalize(in.worldNorm);
  let V = normalize(u.camPos.xyz - in.worldPos);
  // View-dependent slant glint: some seams flash dazzling silver-white, others sit dark obsidian TIR, shifting as the glass tumbles!
  let angleCatch = smoothstep(0.15, 0.92, sin(in.slant * 3.1 + dot(V, N) * 4.2 + in.localPos.y * 8.0) * 0.5 + 0.5);
  let glint = pow(vnoise2(chipCoord * 1.8 + V.xy * 12.0), 3.6);
  let tipFlash = exp(-age / 0.065);
  let spall = (1.0 - smoothstep(0.0, 1.0, abs(a))) * in.boldness * (0.20 + 0.80 * vnoise2(chipCoord * 1.4)) * (0.35 + 0.65 * openProg) * angleCatch;

  let tint = sommersoTint(in.localPos, u);
  let darkCol = tint * 0.08 + vec3<f32>(0.015, 0.020, 0.028);
  let whiteCol = vec3<f32>(1.45, 1.50, 1.58) + vec3<f32>(1.85) * (glint + tipFlash);

  let whiteWeight = clamp(whiteBand * (0.22 + 0.62 * angleCatch * (0.45 + 0.55 * openProg) + 0.75 * glint) + spall * 0.42 + tipFlash * 0.95, 0.0, 1.0);
  let darkWeight = darkBand * (0.88 - 0.35 * tipFlash);

  let totalA = clamp((max(whiteWeight, darkWeight) + spall * 0.22) * (0.62 + 0.38 * in.boldness), 0.0, 0.96);
  if (totalA < 0.02) { discard; }

  let mixRatio = whiteWeight / max(0.001, whiteWeight + darkWeight * 1.35);
  let col = mix(darkCol, whiteCol, mixRatio);

  return vec4<f32>(studioGrade(col, u.params.z), totalA);
}
`;

export const SHARDS_BACK_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> poses: array<ShardPose>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) origPos: vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) relPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @location(2) origPos: vec3<f32>,
  @location(3) shardIdF: f32,
) -> VSOut {
  var out: VSOut;
  let sid = u32(shardIdF + 0.5);
  let pose = poses[sid];
  if (pose.pos.w < 0.5) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNorm = vec3<f32>(0.0, 1.0, 0.0);
    out.origPos = origPos;
    return out;
  }

  let wp = pose.pos.xyz + qRot(pose.quat, relPos);
  let wn = normalize(qRot(pose.quat, localNorm));
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.origPos = origPos;
  return out;
}

/** Offscreen pass: stores nearest back-face world normal (rgb) and camera distance (a) for exact shard thickness & TIR! */
@fragment
fn fs_depth(in: VSOut) -> @location(0) vec4<f32> {
  let dist = length(u.camPos.xyz - in.worldPos);
  return vec4<f32>(normalize(in.worldNorm), dist);
}

/** Translucent internal back-facet pass drawn into main scene before shard front faces so crystal depth & interior edges show through! */
@fragment
fn fs_inner(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNorm);
  let V = normalize(u.camPos.xyz - in.worldPos);
  let ndv = abs(dot(N, V));
  let tint = sommersoTint(in.origPos, u);
  let refl = sampleStudioEnv(in.worldPos, reflect(-V, -N), u);

  // Back facets inside glass catch grazing TIR dark/jewel bands and bright softbox streaks
  let grazing = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.9);
  let L = normalize(u.lightDir.xyz);
  let H = normalize(L + V);
  let spec = pow(max(0.0, abs(dot(N, H))), 80.0) * 1.4;

  let col = mix(tint * 0.45, refl * (0.45 + 0.55 * tint), 0.55) + vec3<f32>(1.15) * spec;
  let alpha = clamp(0.08 + grazing * 0.44 + spec * 0.25, 0.0, 0.62);
  return vec4<f32>(studioGrade(col, u.params.z), alpha);
}
`;

export const SHARDS_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> poses: array<ShardPose>;
@group(0) @binding(2) var bgTex: texture_2d<f32>;
@group(0) @binding(3) var backTex: texture_2d<f32>;
@group(0) @binding(4) var linearSamp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) origPos: vec3<f32>,
  @location(3) relPos: vec3<f32>,
  @location(4) gemIdF: f32,
};

@vertex
fn vs_main(
  @location(0) relPos: vec3<f32>,
  @location(1) localNorm: vec3<f32>,
  @location(2) origPos: vec3<f32>,
  @location(3) shardIdF: f32,
) -> VSOut {
  var out: VSOut;
  let sid = u32(shardIdF + 0.5);
  let pose = poses[sid];
  if (pose.pos.w < 0.5) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNorm = vec3<f32>(0.0, 1.0, 0.0);
    out.origPos = origPos;
    out.relPos = relPos;
    out.gemIdF = 0.0;
    return out;
  }

  let wp = pose.pos.xyz + qRot(pose.quat, relPos);
  let wn = normalize(qRot(pose.quat, localNorm));
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.origPos = origPos;
  out.relPos = relPos;
  out.gemIdF = max(0.0, floor(pose.pos.w - 0.5));
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Compute implicit screen-space derivatives in UNIFORM control flow before branching on per-shard gemId!
  let edgeGrad = length(fwidth(in.worldNorm));
  let gemId = u32(in.gemIdF + 0.5);
  if (gemId == 1u) {
    let N = normalize(in.worldNorm);
    let V = normalize(u.camPos.xyz - in.worldPos);
    let cosV = max(0.0, dot(N, V));
    let F = fresnelSchlick(cosV, 0.17);
    let envRefl = sampleStudioEnv(in.worldPos, reflect(-V, N), u);
    let mirror = pow(max(envRefl, vec3<f32>(0.0)), vec3<f32>(1.8)) * 0.50;
    let L = normalize(u.lightDir.xyz);
    let H = normalize(L + V);
    let spec = pow(max(0.0, dot(N, H)), 220.0) * 3.6;
    let bevel = clamp(edgeGrad * 2.4, 0.0, 1.0) * 0.45;
    let col = mix(vec3<f32>(0.005, 0.005, 0.008), mirror, F * 0.9)
            + vec3<f32>(0.96, 0.98, 1.0) * spec
            + vec3<f32>(0.5, 0.52, 0.58) * bevel;
    // Tiny interleaved-gradient-noise dither eliminates 8-bit banding across soft studio gradients
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2<f32>(0.06711056, 0.00583715))));
  let graded = clamp(studioGrade(col, u.params.z) + vec3<f32>((ign - 0.5) / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(graded, 1.0);
  }
  // Subtle conchoidal fracture micro-ripple breaks flat plastic glare into real liquid-glass reflections
  let rp = in.origPos * 28.0 + in.relPos * 19.0;
  let ripple = vec3<f32>(
    sin(rp.y * 1.3 + rp.z * 0.9),
    cos(rp.z * 1.1 - rp.x * 1.4),
    sin(rp.x * 1.2 + rp.y * 0.8)
  ) * 0.032;
  let N = normalize(in.worldNorm + ripple);
  let V = normalize(u.camPos.xyz - in.worldPos);
  let inDir = -V;
  let cosV = max(0.0, dot(N, V));
  let F = fresnelSchlick(cosV, 0.052);

  // Sample exact back-face depth & normal from shardBackTex
  let dims = vec2<f32>(textureDimensions(bgTex));
  let screenUV = in.pos.xy / max(dims, vec2<f32>(1.0));
  let backSample = textureSampleLevel(backTex, linearSamp, screenUV, 0.0);
  let frontDist = length(u.camPos.xyz - in.worldPos);
  let hasBack = backSample.a > frontDist + 0.001;
  let rawThick = select(0.055, clamp(backSample.a - frontDist, 0.004, 0.34), hasBack);
  let backN = select(-N, normalize(backSample.rgb), hasBack && length(backSample.rgb) > 0.1);

  // First refraction: air -> glass
  let ior = u.halfSize.w;
  var rd1 = refract(inDir, N, 1.0 / ior);
  if (length(rd1) < 0.01) { rd1 = inDir; }
  rd1 = normalize(rd1);

  // Second refraction at the shard's actual back facet: glass -> air (or Total Internal Reflection!)
  let rd2 = refract(rd1, -backN, ior);
  let isTIR = length(rd2) < 0.01;

  // Beer-Lambert volumetric absorption scaled by TRUE geometric shard thickness!
  // Colored gemstone shards get a modest path boost so small scattered facets stay vibrant on the white studio floor.
  let sigma = gemSigma(gemId, in.origPos, u);
  let gemBoost = select(1.0, 1.65, gemId >= 3u && gemId <= 8u);
  let opticalPath = rawThick * (1.25 + 0.65 * (1.0 - cosV)) * gemBoost;
  let transmit = exp(-sigma * opticalPath);

  var refrCol: vec3<f32>;
  if (isTIR) {
    // True Total Internal Reflection inside the shard -> crisp dark jewel mirror + bright softbox glint!
    let tirDir = normalize(reflect(rd1, -backN));
    let tirEnv = sampleStudioEnv(in.worldPos, tirDir, u);
    // Longer internal bounce path intensifies the Murano glass jewel tone
    let deepAbsorb = exp(-sigma * (opticalPath * 1.9 + 0.06));
    refrCol = tirEnv * deepAbsorb * 0.92;
  } else {
    // Refracted exit ray samples the REAL studio floor, rainbow caustics & background behind the shard
    // with chromatic R/G/B dispersion!
    let bend = rd2 - inDir;
    // Project 3D bend into screen UV offset (stronger for thicker glass!)
    let refrScale = clamp(rawThick * 0.55 + 0.018, 0.014, 0.095);
    let disp = u.palCore.w * 0.55;
    let uvG = clamp(screenUV + vec2<f32>(bend.x, -bend.y) * refrScale, vec2<f32>(0.002), vec2<f32>(0.998));
    let uvR = clamp(screenUV + vec2<f32>(bend.x, -bend.y) * refrScale * (1.0 - disp * 3.0), vec2<f32>(0.002), vec2<f32>(0.998));
    let uvB = clamp(screenUV + vec2<f32>(bend.x, -bend.y) * refrScale * (1.0 + disp * 3.5), vec2<f32>(0.002), vec2<f32>(0.998));

    // Convert sRGB bgTex samples back to linear before Beer-Lambert tinting!
    let bgR = pow(textureSampleLevel(bgTex, linearSamp, uvR, 0.0).r, 2.2);
    let bgG = pow(textureSampleLevel(bgTex, linearSamp, uvG, 0.0).g, 2.2);
    let bgB = pow(textureSampleLevel(bgTex, linearSamp, uvB, 0.0).b, 2.2);
    let bgLin = vec3<f32>(bgR, bgG, bgB);

    // Subtle internal back-face reflection layered inside the shard
    let innerReflDir = normalize(reflect(rd1, -backN));
    let innerRefl = sampleStudioEnv(in.worldPos, innerReflDir, u);
    let cosBack = clamp(dot(rd1, backN), 0.0, 1.0);
    let fBack = fresnelSchlick(cosBack, 0.05);

    refrCol = mix(bgLin, innerRefl * 0.85, fBack * 0.55) * transmit;
  }

  // Sharp glossy outer studio Fresnel reflection (curbed slightly on flat faces so no solid-white plastic blowouts!)
  let reflDir = reflect(inDir, N);
  let envRefl = sampleStudioEnv(in.worldPos, reflDir, u);
  let softRefl = envRefl / (vec3<f32>(1.0) + envRefl * 0.35);

  // Tight crystal specular glint from key light & secondary rim light
  let L = normalize(u.lightDir.xyz);
  let H = normalize(L + V);
  let spec1 = pow(max(0.0, dot(N, H)), 220.0) * 2.8;
  let L2 = normalize(vec3<f32>(0.65, 0.55, 0.52));
  let H2 = normalize(L2 + V);
  let spec2 = pow(max(0.0, dot(N, H2)), 160.0) * 1.1;

  // Razor-thin edge definition where shard faces meet (dark TIR edge + bright jewel rim)
  let bevelGlint = clamp(edgeGrad * 1.8, 0.0, 1.0);
  let rimTint = gemTint(gemId, in.origPos, u);

  var col = mix(refrCol, softRefl, F * 0.88);
  col += vec3<f32>(1.0, 0.99, 0.98) * (spec1 + spec2);
  // Subtle sparkling crystal edge catch
  col += (rimTint * 0.35 + vec3<f32>(0.45)) * bevelGlint * (0.25 + 0.75 * F);

  // Blend slightly with the translucent back-facet pass already in the framebuffer along ultra-thin edges
  let edgeAlpha = clamp(0.76 + 0.24 * smoothstep(0.004, 0.035, rawThick) + F * 0.22, 0.0, 0.98);
  return vec4<f32>(studioGrade(col, u.params.z), edgeAlpha);
}
`;

export const SPLINTERS_COMPUTE_WGSL = /* wgsl */ `
${COMMON_WGSL}

struct Splinter {
  pos: vec4<f32>,   // xyz = world pos, w = size (0 = inactive)
  vel: vec4<f32>,   // xyz = world vel, w = age
  rot: vec4<f32>,   // xyz = spin euler angles, w = maxAge
  color: vec4<f32>, // rgb = Sommerso tint, w = spinSpeed
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read_write> splinters: array<Splinter>;

fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&splinters)) { return; }

  var s = splinters[idx];
  if (s.pos.w <= 0.0) { return; }

  let dt = clamp(u.params.w, 0.0, 0.04);
  if (dt <= 0.0) { return; }

  s.vel.w += dt;
  if (s.vel.w >= s.rot.w) {
    s.pos.w = 0.0;
    splinters[idx] = s;
    return;
  }

  let floorY = u.causticBounds.w + s.pos.w * 0.32;
  let onFloor = s.pos.y <= floorY + 0.0005 && abs(s.vel.y) < 0.22;

  if (onFloor) {
    // Resting/sliding on the studio floor: no gravity jitter, rapid friction & complete rest!
    s.pos.y = floorY;
    s.vel.y = 0.0;
    let slideDecay = exp(-dt * 18.0);
    s.vel.x *= slideDecay;
    s.vel.z *= slideDecay;
    s.color.w *= exp(-dt * 22.0);
    if (length(s.vel.xz) < 0.035) {
      s.vel.x = 0.0;
      s.vel.z = 0.0;
      s.color.w = 0.0;
    } else {
      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;
    }
  } else {
    let drag = exp(-dt * (0.45 + 0.014 / max(0.004, s.pos.w)));
    s.vel.y -= 9.81 * dt;
    s.vel = vec4<f32>(s.vel.xyz * drag, s.vel.w);
    s.pos = vec4<f32>(s.pos.xyz + s.vel.xyz * dt, s.pos.w);

    if (s.pos.y <= floorY) {
      s.pos.y = floorY;
      if (abs(s.vel.y) > 0.26) {
        let r1 = hash11(f32(idx) * 1.7 + u.camPos.w * 13.3) - 0.5;
        let r2 = hash11(f32(idx) * 2.9 + u.camPos.w * 7.1) - 0.5;
        s.vel.y = -s.vel.y * (0.24 + 0.14 * abs(r1));
        s.vel.x = s.vel.x * 0.58 + r1 * 0.22;
        s.vel.z = s.vel.z * 0.58 + r2 * 0.22;
        s.color.w *= 0.45;
      } else {
        s.vel.y = 0.0;
        s.vel.x *= 0.4;
        s.vel.z *= 0.4;
        s.color.w *= 0.15;
      }
    }

    // Rotate only while actually airborne/moving
    let spd = length(s.vel.xyz);
    if (spd > 0.06 && s.color.w > 0.1) {
      let spin = s.color.w * clamp(spd * 0.7, 0.0, 1.0);
      s.rot = vec4<f32>(
        s.rot.x + spin * dt * 1.3,
        s.rot.y + spin * dt * 1.7,
        s.rot.z + spin * dt * 0.9,
        s.rot.w
      );
    }
  }

  splinters[idx] = s;
}
`;

export const SPLINTERS_RENDER_WGSL = /* wgsl */ `
${COMMON_WGSL}

struct Splinter {
  pos: vec4<f32>,
  vel: vec4<f32>,
  rot: vec4<f32>,
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: SceneUniforms;
@group(0) @binding(1) var<storage, read> splinters: array<Splinter>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNorm: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) fade: f32,
};

fn rotEuler(e: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  let cx = cos(e.x); let sx = sin(e.x);
  let cy = cos(e.y); let sy = sin(e.y);
  let cz = cos(e.z); let sz = sin(e.z);
  var p = vec3<f32>(v.x, v.y * cx - v.z * sx, v.y * sx + v.z * cx);
  p = vec3<f32>(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  return vec3<f32>(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32,
) -> VSOut {
  var out: VSOut;
  let s = splinters[ii];
  if (s.pos.w <= 0.0) {
    out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNorm = vec3<f32>(0.0, 1.0, 0.0);
    out.color = vec3<f32>(0.0);
    out.fade = 0.0;
    return out;
  }

  var corners = array<vec3<f32>, 4>(
    vec3<f32>(0.0, 1.4, 0.0),
    vec3<f32>(-0.52, -0.42, 0.40),
    vec3<f32>(0.58, -0.36, 0.28),
    vec3<f32>(-0.08, -0.48, -0.64)
  );
  var idx = array<u32, 12>(
    0u, 1u, 2u,
    0u, 2u, 3u,
    0u, 3u, 1u,
    1u, 3u, 2u
  );
  let triBase = (vi / 3u) * 3u;
  let a = corners[idx[triBase]];
  let b = corners[idx[triBase + 1u]];
  let c = corners[idx[triBase + 2u]];
  let nLocal = normalize(cross(b - a, c - a));
  let vLocal = corners[idx[vi]];

  let fade = clamp((s.rot.w - s.vel.w) / 1.8, 0.0, 1.0);
  let sz = s.pos.w * fade;
  let wp = s.pos.xyz + rotEuler(s.rot.xyz, vLocal * sz);
  let wn = normalize(rotEuler(s.rot.xyz, nLocal));

  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.worldPos = wp;
  out.worldNorm = wn;
  out.color = s.color.rgb;
  out.fade = fade;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNorm);
  let V = normalize(u.camPos.xyz - in.worldPos);
  let L = normalize(u.lightDir.xyz);
  let H = normalize(L + V);

  let spec = pow(max(0.0, abs(dot(N, H))), 48.0) * 4.5;
  let fres = fresnelSchlick(abs(dot(N, V)), 0.10);
  let envRefl = sampleStudioEnv(in.worldPos, reflect(-V, N), u);
  let col = in.color * mix(envRefl * 0.68, vec3<f32>(0.24 + 0.62 * abs(dot(N, L))), 0.45) + vec3<f32>(1.4, 1.38, 1.36) * (spec + fres * 0.35);
  return vec4<f32>(studioGrade(col, u.params.z), in.fade * 0.94);
}
`;

export const PLANE_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>, // x = along line (-1..+1), y = across line (-1..+1)
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VSOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
  );
  let uv = quad[vi];
  var n = normalize(u.cutPlaneN.xyz);
  var rad = u.blockCenter.w;
  if (inst == 1u) {
    if (u.cutPlane2N.w < 0.0) {
      var hidden: VSOut;
      hidden.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
      hidden.uv = vec2<f32>(2.0, 2.0);
      return hidden;
    }
    n = normalize(u.cutPlane2N.xyz);
    rad = u.cutPlane2N.w;
  }

  let center = u.blockCenter.xyz + n * rad;
  let toCam = normalize(u.camPos.xyz - center);
  // Line direction lies strictly inside the cutting plane and perpendicular to the camera ray
  var lineDir = cross(n, toCam);
  if (length(lineDir) < 0.02) {
    lineDir = cross(n, vec3<f32>(0.0, 1.0, 0.0));
  }
  lineDir = normalize(lineDir);
  // Screen-facing thin ribbon width axis perpendicular to both lineDir and view ray
  let sideDir = normalize(cross(toCam, lineDir));

  let halfLen = 0.50;
  let halfThick = 0.0028;
  let wp = center + lineDir * (uv.x * halfLen) + sideDir * (uv.y * halfThick);

  var out: VSOut;
  out.pos = u.viewProj * vec4<f32>(wp, 1.0);
  out.uv = uv;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  if (abs(in.uv.x) > 1.0 || abs(in.uv.y) > 1.0) { discard; }

  let hover = u.palEdge.w;
  let canCut = u.params.y;
  let vis = u.params.x;

  // Razor-sharp anti-aliased architectural hairline that tapers softly at its two ends
  let fw = max(0.08, fwidth(in.uv.y));
  let core = 1.0 - smoothstep(0.18 + 0.16 * hover, 0.55 + 0.15 * hover + fw, abs(in.uv.y));
  let endFade = 1.0 - smoothstep(0.68, 1.0, abs(in.uv.x));
  let alpha = clamp(core * endFade * (0.58 + 0.28 * hover + 0.14 * canCut) * vis, 0.0, 0.92);
  if (alpha < 0.01) { discard; }

  let col = mix(vec3<f32>(0.12, 0.12, 0.13), vec3<f32>(0.02, 0.02, 0.02), hover);
  return vec4<f32>(col, alpha);
}
`;

export const SECTION_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: SceneUniforms;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@location(0) worldPos: vec3<f32>) -> VSOut {
  var out: VSOut;
  out.pos = u.viewProj * vec4<f32>(worldPos, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.06, 0.06, 0.07, 0.85 * u.params.x);
}
`;
