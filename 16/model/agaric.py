# A fly agaric (Amanita muscaria), built parametrically, with its growth as shape keys, for public/agaric.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/agaric.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/agaric.py -- render   # and model/renders/agaric.png
#
# One mesh, the same vertices in every stage, so the stages are shape keys (glTF morph targets) and the page only
# blends them: no geometry is built while it grows. The basis is the grown one, open; the keys are the stages on
# the way there and the end:
#   egg     an egg in the moss, the cap pressed down round the bulb, under the white veil (the veil is the shader's)
#   button  the stem stretching, the cap a tight dome, the partial veil still spread over the gills
#   dome    the cap half open, the veil torn from the rim and starting to hang
#   wither  slumped: the stem shorter and keeled over, the rim curled down again, sunk a little
#   round   the grown one, its cap still a round dome (mixed in per fungus, or upturn)
#   upturn  the grown one flattened, the rim turned up and waving
# The page blends egg → button → dome → basis as it grows, and wither on top as it goes.
#
# Parts, in the `_part` attribute (the shader's colour and surface for each): 9.0 cap skin, 9.1 the cap's
# flesh at the rim and underside, 9.2 a wart, 9.4 a gill, 9.6 the stem and bulb, 9.8 the ring (skirt).
# UV0: (along the stem for the dark foot, 1 off the stem; around). UV1: (out across the cap 0..1, a per-piece
# random).
#
# Sizes in metres, a grown one: a cap 13 cm across on a stem 16 cm tall; the page scales each.

import bpy, math, os, sys, random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'agaric.glb')
TAU = math.pi * 2

AS = 96   # around the cap
SS = 40   # around the stem
RS = 40   # rings up the stem
CT = 30   # rings over the cap, centre to rim
CU = 14   # rings under it, rim back to the stem
NG = 104  # gills, all lengths
GS = 12   # segments along a gill
RK = 7    # rings out across the skirt
KS = 64   # around the skirt
NW = 120  # warts

# ---- the stages ---------------------------------------------------------------------------------------------
# R cap radius, th the cap's sphere angle (past a right angle the rim is tucked under), H the top of the cap,
# rs the stem's radius, bulb how swollen the foot, sink how far it is down in the moss, tear 0 the ring spread
# under the gills .. 1 hanging, keel how far it has fallen over, curl the rim turning down, thick the cap's flesh
OPEN = dict(R=0.065, th=0.7, H=0.165, rs=0.0095, bulb=1.0, sink=0.0, tear=1.0, keel=0.0, curl=0.0, thick=0.2)
STAGES = {
    'egg': dict(R=0.025, th=2.05, H=0.046, rs=0.0075, bulb=1.5, sink=0.012, tear=0.0, keel=0.0, curl=0.0, thick=0.34),
    'button': dict(R=0.032, th=1.7, H=0.078, rs=0.0078, bulb=1.2, sink=0.008, tear=0.0, keel=0.0, curl=0.0, thick=0.3),
    'dome': dict(R=0.05, th=1.12, H=0.14, rs=0.009, bulb=1.05, sink=0.0, tear=0.45, keel=0.0, curl=0.0, thick=0.24),
    'wither': dict(R=0.06, th=0.8, H=0.135, rs=0.0088, bulb=0.95, sink=0.008, tear=1.0, keel=1.0, curl=1.0, thick=0.16),
    # the grown one's other shapes, one or the other mixed in per fungus as it opens: a round dome to the end,
    # or flattened with the rim turned up and waving, as old ones do
    'round': dict(R=0.058, th=1.25, H=0.17, rs=0.0095, bulb=1.0, sink=0.0, tear=1.0, keel=0.0, curl=0.0, thick=0.24),
    'upturn': dict(R=0.064, th=0.38, H=0.16, rs=0.0095, bulb=1.0, sink=0.0, tear=1.0, keel=0.0, curl=-0.85, thick=0.17, wave=3.0),
}

# ---- deterministic wobble: sums of sines with fixed phases, periodic round the axis ----------------------------
rnd = random.Random(7)
WAVES = [(rnd.randint(2, 9), rnd.uniform(0, TAU), rnd.uniform(-4, 4), rnd.uniform(0.4, 1.0)) for _ in range(6)]


def wob(a, t, seed=0.0):
    s = 0.0
    for k, p, f, amp in WAVES:
        s += amp * math.sin(k * a + p + f * t + seed * 1.7)
    return s / 3.0


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---- the build: the same pieces in the same order for every stage ----------------------------------------------
def build(S):
    R, th, H, rs, bulb, sink, tear, keel, curl, thickK = (S[k] for k in ('R', 'th', 'H', 'rs', 'bulb', 'sink', 'tear', 'keel', 'curl', 'thick'))
    V, F, part, uv0, uv1 = [], [], [], [], []
    thick = R * thickK
    wave = S.get('wave', 1.0)
    Rc = R / math.sin(th)

    def at(x, y, z):
        """a point in the stem's frame (z up from the foot) bent over by the keel, and sunk"""
        zz = max(0.0, z)
        k = keel * (zz / max(H, 1e-4)) ** 3 * H * 0.18
        return (x + k, y, z - sink - keel * k * 0.35)

    def capPt(t, a, inset=0.0):
        """the cap's top at t (0 centre .. 1 rim), round a; inset pushes in along the surface normal"""
        ang = t * th
        r = Rc * math.sin(ang)
        z = H - Rc * (1 - math.cos(ang))
        nr, nz = math.sin(ang), math.cos(ang)
        # withering, the outer half bends down about a hinge halfway out (a bend, so it keeps its size); turned up
        # the other way for an old upturned one
        if curl != 0 and t > 0.45:
            ah = 0.45 * th
            rh, zh = Rc * math.sin(ah), H - Rc * (1 - math.cos(ah))
            b = curl * 0.6 * smooth(0.45, 1.0, t)
            cb, sb = math.cos(b), math.sin(b)
            dr, dz = r - rh, z - zh
            r, z = rh + dr * cb + dz * sb, zh - dr * sb + dz * cb
            nr, nz = nr * cb + nz * sb, -nr * sb + nz * cb
        # a wavy rim, a slightly irregular dome (an upturned one waves more, up and down)
        w = wob(a, t * 3) * (0.025 * R) * t * t
        r += w
        z += 0.012 * R * wob(a + 1.3, 1.0) * t * wave + 0.02 * R * (wave - 1) * wob(a * 0.5 + 0.7, 2.0, 9) * t * t
        return (r - nr * inset, z - nz * inset, nr, nz)

    def ring(cx, cy, cz, r, a):
        return (cx + math.cos(a) * r, cy + math.sin(a) * r, cz)

    def strip(start, rows, n, flip=False):
        for i in range(rows - 1):
            for k in range(n):
                a = start + i * n + k
                c = start + i * n + (k + 1) % n
                F.append((a, c, c + n, a + n) if not flip else (a, a + n, c + n, c))

    def push(p, pt, u0, u1):
        V.append(at(*p))
        part.append(pt)
        uv0.append(u0)
        uv1.append(u1)

    # where the underside meets the stem
    tS = min(1.0, math.asin(min(1.0, rs * 1.15 / Rc)) / th)
    stemTop = capPt(tS, 0.0)[1] - thick * 0.6

    # -- the stem and its bulb: from below the moss to up inside the cap
    bh = rs * 2.3
    s0 = len(V)
    zTop = capPt(0.0, 0.0)[1] - thick * 0.5
    for i in range(RS):
        u = i / (RS - 1)
        z = lerp(-0.012, zTop, u)
        e = math.exp(-max(0.0, z + 0.004) / bh)
        r = rs * (1.0 - 0.1 * min(1.0, z / max(stemTop, 1e-4))) * (1 + 0.85 * bulb * e)
        # the veil's leftovers on the bulb: ragged rings, a few, round its top
        rag = max(0.0, math.sin((z + 0.004) / bh * 8.0 + 0.6)) * math.exp(-max(0.0, z) / (bh * 1.6))
        for k in range(SS):
            a = k / SS * TAU
            rr = r * (1 + 0.1 * rag * (0.6 + 0.4 * wob(a * 2, z * 90, 3))) + rs * 0.025 * wob(a, z * 40, 1)
            push(ring(0, 0, z, rr, a), 9.6, (min(1.0, max(0.0, z) / max(stemTop, 1e-4)), k / SS), (0.0, 0.0))
    strip(s0, RS, SS)
    # (the bottom is down in the moss, left open)

    # -- the cap: over the top from the centre to the rim, round the rim, under it back to the stem: one strip
    c0 = len(V)
    rows = []
    for i in range(CT):
        t = (i / (CT - 1)) ** 0.85
        rows.append((t, 0.0, 9.0))
    # round the rim: the flesh turning under
    for j in (0.35, 0.7):
        rows.append((1.0, j, 9.1))
    for i in range(CU):
        t = lerp(1.0, tS, i / (CU - 1))
        rows.append((t, 1.0, 9.1))
    for (t, inset, pt) in rows:
        # the flesh is thick in the middle and thin at the rim
        d = thick * (1 - 0.82 * t) * inset
        for k in range(AS):
            a = k / AS * TAU
            r, z, nr, nz = capPt(t, a, d)
            if inset > 0 and inset < 1:
                # the rounded lip: out a little past the rim
                r += thick * 0.14 * math.sin(inset * math.pi) * (1 - 0.82 * t)
            push(ring(0, 0, z, r, a), pt, (1.0, k / AS), (t, 0.0))
    strip(c0, len(rows), AS)

    # -- the gills: thin blades under the cap, radial, full ones and shorter ones between
    gr = random.Random(11)
    for gi in range(NG):
        a = gi / NG * TAU + gr.uniform(-0.25, 0.25) * TAU / NG
        L = 1.0 if gi % 4 == 0 else (0.7 if gi % 2 == 0 else 0.45)
        tin = lerp(tS + 0.02, 1.0, 1 - L)
        g0 = len(V)
        for i in range(GS):
            t = lerp(tin, 0.985, i / (GS - 1))
            d = thick * (1 - 0.82 * t)
            r, z, nr, nz = capPt(t, a, d * 0.98)
            # deepest a third of the way in, nothing where it starts
            # (still a little deep at the rim: they run out to the edge as a pale band, not a ring of teeth)
            u = i / (GS - 1)
            depth = R * 0.13 * (0.78 * math.sin(math.pi * u ** 0.8) + 0.22 * u ** 2) * (0.7 + 0.3 * L)
            # hang straight down from the underside, a little toward the stem
            lo = (r - nr * 0.0 - 0.15 * depth, z - depth)
            push(ring(0, 0, z, r, a), 9.4, (1.0, a / TAU), (t, gi / NG))
            push(ring(0, 0, lo[1], lo[0], a), 9.4, (1.0, a / TAU), (t, gi / NG))
        for i in range(GS - 1):
            p = g0 + i * 2
            F.append((p, p + 2, p + 3, p + 1))

    # -- the ring: the partial veil, spread from the stem to the rim, then torn off it and hanging as a skirt
    k0 = len(V)
    zr = stemTop - (stemTop - bh) * 0.16
    rimR, rimZ = capPt(0.96, 0.0, thick * 0.1)[0], capPt(0.96, 0.0, thick * 0.1)[1]
    for i in range(RK):
        u = i / (RK - 1)
        for k in range(KS):
            a = k / KS * TAU
            # spread: a sagging membrane out to the rim
            rS = lerp(rs * 1.04, rimR * 0.97, u)
            zS = lerp(zr, rimZ - thick * 0.3, u) - math.sin(u * math.pi) * R * 0.05
            # hanging: out and down off the stem, a wavy hem
            rH = rs * (1.03 + 0.5 * math.sin(u * math.pi * 0.5) ** 1.5) + rs * u * (0.16 * wob(a, 2.0, 5) + 0.07 * math.sin(a * 13 + 2 * wob(a, 1.0, 8)))
            zH = zr - u * H * 0.12 - u * u * H * 0.05 * max(0.0, 0.6 + wob(a * 1.0, 0.5, 6))
            # torn, the outer part is first loose: tear runs from the rim inward
            tt = smooth(1 - u - 0.3, 1 - u + 0.3, tear * 1.6 - 0.3)
            push(ring(0, 0, lerp(zS, zH, tt), lerp(rS, rH, tt), a), 9.8, (1.0, k / KS), (u, 0.0))
    strip(k0, RK, KS)

    # -- the warts: what is left of the universal veil, little pyramids on the cap, crowded in the middle
    wr = random.Random(23)
    pts = []
    tries = 0
    while len(pts) < NW and tries < 40000:
        tries += 1
        x, y = wr.uniform(-1, 1), wr.uniform(-1, 1)
        t = math.hypot(x, y)
        if t > 0.9:
            continue
        md = 0.065 + 0.08 * t
        if any(math.hypot(x - px, y - py) < md for px, py, _ in pts):
            continue
        pts.append((x, y, wr.random()))
    for wi, (x, y, h) in enumerate(pts):
        t = math.hypot(x, y)
        a = math.atan2(y, x)
        # a fixed size: they do not grow, the cap grows out from under them; bigger in the middle
        w = (0.0052 - 0.0034 * t) * (0.7 + 0.6 * h)
        ht = w * (0.28 + 0.2 * h)
        r, z, nr, nz = capPt(t, a)
        # the surface frame: n out of the cap, e round it, f across
        n = (math.cos(a) * nr, math.sin(a) * nr, nz)
        e = (-math.sin(a), math.cos(a), 0.0)
        f = (n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0])
        c = (math.cos(a) * r, math.sin(a) * r, z)
        # an irregular footprint: seven corners at their own distances, a little stretched round the cap
        jr = random.Random(1000 + wi)
        corners = [(j / 7 * TAU + jr.uniform(-0.3, 0.3), jr.uniform(0.7, 1.2)) for j in range(7)]
        stretch = 1.0 + 0.5 * t

        def pt(rad, ang, up):
            ce, cf = math.cos(ang) * rad * stretch, math.sin(ang) * rad
            return tuple(c[i] + e[i] * ce + f[i] * cf + n[i] * up for i in range(3))
        w0 = len(V)
        rot = h * TAU
        for (ang, k) in corners:
            push(pt(w * k, rot + ang, -w * 0.2), 9.2, (1.0, a / TAU), (t, h))
        for (ang, k) in corners:
            # a flat, lumpy top: the shoulder near the edge, nearly as high as the middle
            push(pt(w * k * 0.72, rot + ang, ht * (0.75 + 0.2 * jr.random())), 9.2, (1.0, a / TAU), (t, h))
        push(pt(w * 0.1, rot, ht), 9.2, (1.0, a / TAU), (t, h))
        for j in range(7):
            a0, a1 = w0 + j, w0 + (j + 1) % 7
            m0, m1 = w0 + 7 + j, w0 + 7 + (j + 1) % 7
            F.append((a0, a1, m1, m0))
            F.append((m0, m1, w0 + 14))
    return V, F, part, uv0, uv1


# ---- into Blender -----------------------------------------------------------------------------------------------
def make():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    V, F, part, uv0, uv1 = build(OPEN)
    me = bpy.data.meshes.new('agaric')
    me.from_pydata(V, [], F)
    me.update()
    ob = bpy.data.objects.new('agaric', me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    at = me.attributes.new('_part', 'FLOAT', 'POINT')
    at.data.foreach_set('value', part)
    for name, uvs in (('UVMap', uv0), ('UV1', uv1)):
        lay = me.uv_layers.new(name=name)
        loops = [0.0] * (len(me.loops) * 2)
        for li, l in enumerate(me.loops):
            loops[li * 2], loops[li * 2 + 1] = uvs[l.vertex_index]
        lay.data.foreach_set('uv', loops)
    ob.shape_key_add(name='Basis', from_mix=False)
    for name, S in STAGES.items():
        Vs = build(S)[0]
        assert len(Vs) == len(V), (name, len(Vs), len(V))
        kb = ob.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set('co', [c for v in Vs for c in v])
    print(f'agaric: {len(V)} vertices, {len(F)} faces, {len(STAGES)} shape keys')
    return ob


def export(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True,
        export_attributes=True, export_morph=True, export_morph_normal=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
    )
    print('wrote', os.path.abspath(OUT))


def render(ob):
    """the stages side by side: egg, button, dome, open, withered"""
    out = os.path.join(HERE, 'renders')
    os.makedirs(out, exist_ok=True)
    cols = {9.0: (0.75, 0.05, 0.02, 1), 9.1: (0.9, 0.86, 0.78, 1), 9.2: (0.92, 0.9, 0.82, 1), 9.4: (0.95, 0.93, 0.86, 1), 9.6: (0.9, 0.88, 0.82, 1), 9.8: (0.93, 0.92, 0.86, 1)}
    me = ob.data
    mats = {}
    for k, c in cols.items():
        m = bpy.data.materials.new(str(k))
        m.diffuse_color = c
        me.materials.append(m)
        mats[k] = len(me.materials) - 1
    vp = [0.0] * len(me.vertices)
    me.attributes['_part'].data.foreach_get('value', vp)
    for p in me.polygons:
        me.polygons[p.index].material_index = mats[round(vp[p.vertices[0]], 1)]
    looks = [('egg', 1), ('button', 1), ('dome', 1), (None, 0), ('wither', 1), ('round', 1), ('upturn', 1)]
    for i, (key, v) in enumerate(looks):
        o = ob.copy()
        o.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(o)
        for kb in o.data.shape_keys.key_blocks:
            kb.value = 0.0
        if key:
            o.data.shape_keys.key_blocks[key].value = v
        o.location.x = (i - 3) * 0.15
    ob.hide_render = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0, -1.5, 0.22)
    cam.rotation_euler = (math.radians(84), 0, 0)
    cam.data.lens = 50
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_shadows = True
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1800, 600
    sc.render.filepath = os.path.join(out, 'agaric.png')
    bpy.ops.render.render(write_still=True)
    # and close in under one, the gills and the skirt
    cam.location = (0.03, -0.2, 0.06)
    cam.rotation_euler = (math.radians(98), 0, 0)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.hide_render = abs(o.location.x - 0.45) > 1e-6 or o is ob
    cam.location = (0.45 + 0.03, -0.2, 0.08)
    sc.render.resolution_x, sc.render.resolution_y = 900, 900
    sc.render.filepath = os.path.join(out, 'agaric-under.png')
    bpy.ops.render.render(write_still=True)


ob = make()
export(ob)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob)
