# Procedural A60 / E27 incandescent bulb. Units are millimetres (1 BU = 1 mm), z up, base contact at z ~ 0.
# Run inside Blender: exec(open('06/blender/bulb.py').read())
import bpy, bmesh, math
from mathutils import Vector

TAU = math.pi * 2
COLL = 'Bulb'
Q = 1.0  # density: profile step and segment counts scale with this, 1 = web


# ---------- helpers ----------

def collection():
    coll = bpy.data.collections.get(COLL)
    if coll:
        for o in list(coll.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        coll = bpy.data.collections.new(COLL)
        bpy.context.scene.collection.children.link(coll)
    for c in list(bpy.data.curves):
        if c.users == 0: bpy.data.curves.remove(c)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    return coll


def catmull(pts, step):
    """Uniform Catmull-Rom through pts (tuples), resampled so segments are ~step long."""
    P = [Vector(p) for p in pts]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def mesh_obj(name, verts, faces, coll, mat=None, smooth=True, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs:
        layer = me.uv_layers.new(name='UVMap')
        i = 0
        for poly, fuv in zip(me.polygons, uvs):
            for li, uv in zip(poly.loop_indices, fuv):
                layer.data[li].uv = uv
    me.validate()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat: me.materials.append(mat)
    return ob


def lathe(name, prof, coll, mat=None, seg=192, deform=None):
    seg = int(seg * Q)
    """Revolve a (z, r) profile. r == 0 at either end becomes a pole. deform(z, th, r) -> (x, y, z) overrides placement."""
    verts, faces, uvs, rings = [], [], [], []
    vs, acc = [], 0.0
    for k, (z, r) in enumerate(prof):
        if k: acc += math.hypot(z - prof[k - 1][0], r - prof[k - 1][1])
        vs.append(acc)
    vs = [v / (acc or 1) for v in vs]
    for (z, r) in prof:
        if r < 1e-6:
            rings.append([len(verts)]); verts.append((0, 0, z)); continue
        ring = []
        for j in range(seg):
            th = TAU * j / seg
            ring.append(len(verts))
            verts.append(deform(z, th, r) if deform else (r * math.cos(th), r * math.sin(th), z))
        rings.append(ring)
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        va, vb = vs[i], vs[i + 1]
        if len(a) == 1 and len(b) == 1: continue
        for j in range(seg):
            u0, u1 = j / seg, (j + 1) / seg
            if len(a) == 1:
                faces.append((a[0], b[j], b[(j + 1) % seg])); uvs.append(((u0 + 0.5 / seg, va), (u0, vb), (u1, vb)))
            elif len(b) == 1:
                faces.append((a[j], a[(j + 1) % seg], b[0])); uvs.append(((u0, va), (u1, va), (u0 + 0.5 / seg, vb)))
            else:
                faces.append((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j])); uvs.append(((u0, va), (u1, va), (u1, vb), (u0, vb)))
    return mesh_obj(name, verts, faces, coll, mat, uvs=uvs)


def profile(pts, step=0.25):
    return [(v.x, v.y) for v in catmull(pts, step / Q)]


def solidify(ob, t, rim=True):
    # No even offset: on an open rim it can shoot a whole ring off along a bad normal.
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = t; m.offset = -1; m.use_even_offset = False; m.use_rim = rim
    return m


def tube(name, pts, radius, coll, mat=None, res=2, step=0.4):
    """Wire along a smooth 3D path."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = res; cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    path = catmull(pts, step) if len(pts) > 2 else [Vector(p) for p in pts]
    sp.points.add(len(path) - 1)
    for p, v in zip(sp.points, path): p.co = (v.x, v.y, v.z, 1)
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    if mat: cu.materials.append(mat)
    return ob


def raw_tube(name, path, radius, coll, mat=None, res=2):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = res; cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(path) - 1)
    for p, v in zip(sp.points, path): p.co = (v[0], v[1], v[2], 1)
    ob = bpy.data.objects.new(name, cu)
    coll.objects.link(ob)
    if mat: cu.materials.append(mat)
    return ob


def material(name, color=(0.8, 0.8, 0.8), metallic=0.0, rough=0.5, transmission=0.0, ior=1.5,
             emission=None, strength=0.0, coat=0.0, spec=0.5):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['IOR'].default_value = ior
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Specular IOR Level'].default_value = spec
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def smoothstep(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------- materials ----------

M = dict(
    glass=material('Glass', (1, 1, 1), rough=0.0, transmission=1.0, ior=1.52),
    tungsten=material('Tungsten', (0.55, 0.52, 0.5), metallic=1, rough=0.35, emission=(1.0, 0.56, 0.24), strength=60),
    nickel=material('Nickel', (0.66, 0.61, 0.53), metallic=1, rough=0.25),
    dumet=material('Dumet', (0.72, 0.36, 0.22), metallic=1, rough=0.35),
    moly=material('Molybdenum', (0.58, 0.58, 0.6), metallic=1, rough=0.3),
    brass=material('Brass', (0.91, 0.76, 0.45), metallic=1, rough=0.28),
    vitrite=material('Vitrite', (0.012, 0.012, 0.014), rough=0.12, coat=0.6),
    solder=material('Solder', (0.78, 0.78, 0.76), metallic=1, rough=0.38),
    cement=material('Cement', (0.82, 0.79, 0.72), rough=0.85),
)


# ---------- build ----------

def build():
    coll = collection()

    # Envelope: A60 profile, 0.55 mm wall. The neck runs down into the cap.
    env = profile([(12, 12.3), (26, 12.6), (30, 13.4), (36, 15.8), (45, 21), (55, 26.4), (65, 29.5), (73, 30),
                   (82, 28.8), (90, 25.5), (97, 19), (101.5, 11.5), (104.2, 4.5), (105, 0)], 0.6)
    ob = lathe('Envelope', env, coll, M['glass'], seg=160)
    solidify(ob, 0.55)

    # Flare: the stem tube that fuses with the neck, hollow.
    flare = profile([(12.2, 11.6), (13.5, 10.6), (16, 7.6), (19, 5.2), (23, 4.0), (29, 3.6), (35, 3.6)], 0.4)
    ob = lathe('Flare', flare, coll, M['glass'], seg=64)
    solidify(ob, 0.45)

    # Press: solid glass pinch, round tube morphing into a flat slab, rounded on top.
    def press_deform(z, th, r):
        k = smoothstep(34, 38.5, z)
        a = 3.6 + (5.2 - 3.6) * k
        b = 3.6 + (1.5 - 3.6) * k
        s = r / 3.6
        c, sn = math.cos(th), math.sin(th)
        n = 2 + 2 * k  # circle -> superellipse
        x = a * s * math.copysign(abs(c) ** (2 / n), c)
        y = b * s * math.copysign(abs(sn) ** (2 / n), sn)
        return (x, y, z)
    press = [(34, 3.6), (36, 3.6), (38.5, 3.6), (43.4, 3.6), (44.4, 3.3), (45.0, 2.4), (45.35, 1.2), (45.45, 0)]
    press = [(z, r) for z, r in profile(press, 0.3)]
    lathe('Press', press, coll, M['glass'], seg=64, deform=press_deform)

    # Arbor rod and button: glass, carries the support wires.
    lathe('Arbor', profile([(44.8, 0), (44.9, 1.0), (46, 0.9), (60, 0.85), (62.4, 0.9), (62.8, 1.6), (63.6, 1.85),
                            (64.4, 1.6), (64.8, 0.9), (64.95, 0)], 0.3), coll, M['glass'], seg=24)

    # Filament crown: r = 9 mm ring at z = 68 from 200 deg round the back to -20 deg, sagging between supports.
    R, ZF = 9.0, 68.0
    a0, a1 = math.radians(200), math.radians(-20)
    nsup = 4
    def crown(u):  # u in [0, 1]
        a = a0 + (a1 - a0) * u
        seg_u = (u * (nsup + 1)) % 1
        z = ZF - 1.1 * math.sin(math.pi * seg_u)
        return Vector((R * math.cos(a), R * math.sin(a), z))

    # Coiled tungsten: helix around the crown path.
    N = 6000
    path = [crown(i / N) for i in range(N + 1)]
    length = sum((b - a).length for a, b in zip(path, path[1:]))
    pitch, rc = 0.2, 0.3
    turns = length / pitch
    coil, s = [], 0.0
    legs = 0.9  # straight uncoiled legs at each end, clamped by the leads
    for i, p in enumerate(path):
        if i: s += (p - path[i - 1]).length
        t = (path[min(i + 1, N)] - path[max(i - 1, 0)]).normalized()
        nrm = (Vector((0, 0, 1)) - t * t.z).normalized()
        bi = t.cross(nrm)
        w = smoothstep(0, legs, s) * smoothstep(0, legs, length - s)
        ps = TAU * s / pitch
        coil.append(p + (math.cos(ps) * nrm + math.sin(ps) * bi) * rc * w)
    # Thin the polyline to ~14 points per turn.
    keep = max(1, int(len(coil) / (turns * 10)))
    raw_tube('Filament', [tuple(v) for v in coil[::keep]] + [tuple(coil[-1])], 0.055, coll, M['tungsten'], res=1)

    # Lead wires: copper-clad dumet below the press top, nickel above, ending in a little clamp on the filament leg.
    for side, a in ((-1, a0), (1, a1)):
        end = Vector((R * math.cos(a), R * math.sin(a), ZF))
        x0 = 2.4 * side
        tube(f'LeadInner{side:+d}', [(x0 * 0.9, 0, 6), (x0 * 0.9, 0, 20), (x0, 0, 34), (x0, 0, 44.6)], 0.22, coll, M['dumet'])
        tube(f'Lead{side:+d}', [(x0, 0, 44.4), (x0 * 1.05, 0, 47), (x0 * 1.4, end.y * 0.2, 53), (end.x * 0.7, end.y * 0.65, 62),
                                (end.x * 0.97, end.y * 0.97, ZF - 0.8), (end.x, end.y, ZF)], 0.24, coll, M['nickel'])
        # clamp: a short loop around the filament leg
        t = Vector((-math.sin(a), math.cos(a), 0)) * (1 if side < 0 else -1)
        nrm = Vector((0, 0, 1)); bi = t.cross(nrm)
        loop = [end + (math.cos(q) * nrm + math.sin(q) * bi) * 0.32 + t * (q / TAU) * 0.5 for q in [i * TAU / 24 for i in range(31)]]
        raw_tube(f'Clamp{side:+d}', [tuple(v) for v in loop], 0.12, coll, M['nickel'], res=2)

    # Support wires: molybdenum, from the button out to each crown peak, ending in a hook round the coil.
    for k in range(1, nsup + 1):
        u = k / (nsup + 1)
        p = crown(u)
        d = Vector((p.x, p.y, 0)).normalized()
        start = Vector((0, 0, 63.6)) + d * 1.5
        tube(f'Support{k}', [tuple(start), tuple(Vector((0, 0, 64.1)) + d * 3.2), tuple(Vector((0, 0, 65.8)) + d * 6.6),
                             tuple(Vector((0, 0, ZF - 0.55)) + d * (R - 0.05))], 0.1, coll, M['moly'])
        t = Vector((-d.y, d.x, 0))
        hook = [p + (math.cos(q) * Vector((0, 0, -1)) + math.sin(q) * d) * 0.55 for q in [math.pi * i / 16 for i in range(-8, 25)]]
        hook = [h + t * (i - 16) * 0.004 for i, h in enumerate(hook)]
        raw_tube(f'Hook{k}', [tuple(v) for v in hook], 0.1, coll, M['moly'], res=2)

    # Screw cap: brass shell with a rolled Edison thread (E27, pitch 3.629 mm), crimp dimples, rolled lip.
    PITCH, AMP = 3.629, 0.85
    def shell_deform(z, th, r):
        w = smoothstep(5.2, 7.0, z) * (1 - smoothstep(18.8, 20.6, z))
        r2 = r + AMP * w * (0.5 + 0.5 * math.cos(TAU * (z / PITCH - th / TAU)))
        for k in range(3):
            d = (th - TAU * k / 3 + math.pi) % TAU - math.pi
            r2 -= 0.45 * math.exp(-(d / 0.12) ** 2) * math.exp(-((z - 23.4) / 0.6) ** 2)
        return (r2 * math.cos(th), r2 * math.sin(th), z)
    shell = profile([(2.7, 10.2), (3.2, 11.4), (3.9, 12.3), (4.8, 12.75), (6, 12.8), (20, 12.8), (21.6, 12.75),
                     (22.8, 12.55), (24.2, 12.7), (25.2, 13.05), (25.8, 13.35), (26.15, 13.2), (26.25, 12.9)], 0.2)
    ob = lathe('Cap', shell, coll, M['brass'], seg=160, deform=shell_deform)
    solidify(ob, 0.28)

    # Basing cement, the off-white ring where glass meets brass.
    lathe('Cement', profile([(24.6, 12.55), (25.6, 12.62), (26.2, 12.75), (26.45, 12.9), (26.4, 13.05), (25.9, 13.1)], 0.15),
          coll, M['cement'], seg=96)

    # Black glass insulator and the solder contact.
    lathe('Insulator', profile([(0.75, 0), (0.75, 4.5), (1.0, 5.8), (1.8, 8.8), (2.7, 10.4), (3.6, 11.6), (4.6, 12.4),
                                (5.6, 12.55), (6.2, 12.2), (6.4, 0)], 0.3), coll, M['vitrite'], seg=96)
    lathe('Contact', profile([(-0.7, 0), (-0.66, 1.6), (-0.45, 3.0), (0.0, 3.9), (0.6, 4.35), (1.0, 4.1), (1.1, 0)], 0.2),
          coll, M['solder'], seg=48)

    return coll



def export(path):
    """Curves become meshes, everything parented to one empty, written as GLB in millimetres."""
    coll = bpy.data.collections[COLL]
    root = bpy.data.objects.new('Bulb', None)
    coll.objects.link(root)
    for o in list(coll.objects):
        if o is root: continue
        o.parent = root
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_meshopt_compression_enable=True,
                              export_image_format='WEBP')


coll = build()
