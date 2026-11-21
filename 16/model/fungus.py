# What the fungus models share (porcini.py and the ones after it; agaric.py came first and keeps its own copy):
# a deterministic wobble, a mesh being filled, its stages as shape keys, the glb out and a preview render.
#
# Every model has the same shape keys in the same order (the page blends them by name order, see models.ts):
# egg, button, dome, wither, round, upturn, over the basis, the grown one, open.

import bpy, math, os, random

TAU = math.pi * 2
KEYS = ('egg', 'button', 'dome', 'wither', 'round', 'upturn')

_rnd = random.Random(7)
WAVES = [(_rnd.randint(2, 9), _rnd.uniform(0, TAU), _rnd.uniform(-4, 4), _rnd.uniform(0.4, 1.0)) for _ in range(6)]


def wob(a, t, seed=0.0):
    """sums of sines with fixed phases, periodic round the axis (a), smooth along t; about -1..1"""
    s = 0.0
    for k, p, f, amp in WAVES:
        s += amp * math.sin(k * a + p + f * t + seed * 1.7)
    return s / 3.0


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


class Mesh:
    """vertices with their part, two uv channels, and faces"""

    def __init__(self):
        self.V, self.F, self.part, self.uv0, self.uv1 = [], [], [], [], []

    def push(self, p, part, u0, u1):
        self.V.append(p)
        self.part.append(part)
        self.uv0.append(u0)
        self.uv1.append(u1)
        return len(self.V) - 1

    def ring(self, z, r, n, part, along, t, xy=(0.0, 0.0), rr=None):
        """a ring of n round the axis at height z; rr(a) a radius per angle if given"""
        s = len(self.V)
        for k in range(n):
            a = k / n * TAU
            rad = rr(a) if rr else r
            self.push((xy[0] + math.cos(a) * rad, xy[1] + math.sin(a) * rad, z), part, (along, k / n), (t, 0.0))
        return s

    def strip(self, start, rows, n):
        for i in range(rows - 1):
            for k in range(n):
                a = start + i * n + k
                c = start + i * n + (k + 1) % n
                self.F.append((a, c, c + n, a + n))


def make(name, build, basis, stages):
    """the mesh from build(basis), with a shape key per stage built the same way (the same vertices)"""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    m = build(basis)
    me = bpy.data.meshes.new(name)
    me.from_pydata(m.V, [], m.F)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    at = me.attributes.new('_part', 'FLOAT', 'POINT')
    at.data.foreach_set('value', m.part)
    for lname, uvs in (('UVMap', m.uv0), ('UV1', m.uv1)):
        lay = me.uv_layers.new(name=lname)
        loops = [0.0] * (len(me.loops) * 2)
        for li, l in enumerate(me.loops):
            loops[li * 2], loops[li * 2 + 1] = uvs[l.vertex_index]
        lay.data.foreach_set('uv', loops)
    ob.shape_key_add(name='Basis', from_mix=False)
    for key in KEYS:
        Vs = build({**basis, **stages[key]}).V
        assert len(Vs) == len(m.V), (key, len(Vs), len(m.V))
        kb = ob.shape_key_add(name=key, from_mix=False)
        kb.data.foreach_set('co', [c for v in Vs for c in v])
    print(f'{name}: {len(m.V)} vertices, {len(m.F)} faces, {len(KEYS)} shape keys')
    return ob


def export(ob, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path), export_format='GLB', use_selection=True,
        export_attributes=True, export_morph=True, export_morph_normal=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
    )
    print('wrote', os.path.abspath(path))


def render(ob, out, cols, spacing=0.15, under_x=0.45, cam=(0, -1.5, 0.22)):
    """the stages side by side (egg, button, dome, open, wither, round, upturn) and one close from below"""
    os.makedirs(os.path.dirname(out), exist_ok=True)
    me = ob.data
    mats = {}
    for k, c in cols.items():
        mm = bpy.data.materials.new(str(k))
        mm.diffuse_color = c
        me.materials.append(mm)
        mats[k] = len(me.materials) - 1
    vp = [0.0] * len(me.vertices)
    me.attributes['_part'].data.foreach_get('value', vp)
    for p in me.polygons:
        me.polygons[p.index].material_index = mats.get(round(vp[p.vertices[0]], 1), 0)
    looks = [('egg', 1), ('button', 1), ('dome', 1), (None, 0), ('wither', 1), ('round', 1), ('upturn', 1)]
    for i, (key, v) in enumerate(looks):
        o = ob.copy()
        o.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(o)
        for kb in o.data.shape_keys.key_blocks:
            kb.value = 0.0
        if key:
            o.data.shape_keys.key_blocks[key].value = v
        o.location.x = (i - 3) * spacing
    ob.hide_render = True
    c = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(c)
    c.location = cam
    c.rotation_euler = (math.radians(84), 0, 0)
    c.data.lens = 50
    sc = bpy.context.scene
    sc.camera = c
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_shadows = True
    sc.display.shading.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1800, 600
    sc.render.filepath = out + '.png'
    bpy.ops.render.render(write_still=True)
    # close, from a little below: the underside
    c.location = (under_x + 0.03, -0.22, 0.05)
    c.rotation_euler = (math.radians(100), 0, 0)
    for o in sc.objects:
        if o.type == 'MESH':
            o.hide_render = abs(o.location.x - (0 * spacing)) > 1e-6 or o is ob
    c.location = (0.03, -0.24, 0.05)
    sc.render.resolution_x, sc.render.resolution_y = 900, 900
    sc.render.filepath = out + '-under.png'
    bpy.ops.render.render(write_still=True)
