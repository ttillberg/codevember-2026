# Bakes PBR maps for the brass cap and the black glass insulator from procedural shaders.
# Run after bulb.py, in the same Blender session: exec(open('06/blender/bake.py').read())
import bpy, math
from mathutils import Vector


def image(name, w, h, data=False):
    old = bpy.data.images.get(name)
    if old: bpy.data.images.remove(old)
    im = bpy.data.images.new(name, w, h, alpha=False)
    if data: im.colorspace_settings.name = 'Non-Color'
    return im


def apply_solidify(ob):
    """Apply the shell, then park the inner wall's UVs in a corner so it does not fight the outer wall for texels."""
    m = ob.modifiers.get('Solidify')
    if not m: return
    vg = ob.vertex_groups.get('shell') or ob.vertex_groups.new(name='shell')
    m.shell_vertex_group = 'shell'
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    me = ob.data; gi = ob.vertex_groups['shell'].index
    inner = {v.index for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}
    uv = me.uv_layers.active.data
    for p in me.polygons:
        if all(i in inner for i in p.vertices):
            for li in p.loop_indices: uv[li].uv = (0.999, 0.999)


def gltf_output_group():
    """The node group the glTF exporter reads the occlusion map from."""
    g = bpy.data.node_groups.get('glTF Material Output')
    if g: return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput')
    return g


def bake_object(ob, prefix, size, build_shader, passes):
    """build_shader(nt, ao_image) -> dict of output sockets {'color','rough','metal','normal'}.
    AO is baked first with many samples; the other passes read it back and need only a few."""
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.render.bake.margin = 8
    s.world.light_settings.distance = 2.5  # AO reach in mm, about a thread pitch

    bake_mat = bpy.data.materials.new(prefix + 'Bake')
    bake_mat.use_nodes = True
    nt = bake_mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    nt.nodes.active = tex

    old = list(ob.data.materials)
    ob.data.materials.clear(); ob.data.materials.append(bake_mat)

    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); bpy.context.view_layer.objects.active = ob

    imgs = {}
    w, h = size
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    ao = image(f'{prefix}_ao', w, h, data=True)
    tex.image = ao
    s.cycles.samples = 64
    bpy.ops.object.bake(type='AO')
    ao.pack()
    if 'ao' in passes: imgs['ao'] = ao

    socks = build_shader(nt, ao)
    if 'normal' in socks: nt.links.new(socks['normal'], bsdf.inputs['Normal'])
    nt.nodes.active = tex
    s.cycles.samples = 4
    for kind in passes:
        if kind == 'ao': continue
        im = image(f'{prefix}_{kind}', w, h, data=kind != 'color')
        tex.image = im
        if kind in ('color', 'rough', 'metal'):
            nt.links.new(socks[kind], emit.inputs['Color'])
            nt.links.new(emit.outputs[0], out.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT')
        elif kind == 'normal':
            nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
        im.pack()
        imgs[kind] = im

    ob.data.materials.clear()
    for m in old: ob.data.materials.append(m)
    bpy.data.materials.remove(bake_mat)
    return imgs


def baked_material(name, imgs, metal=None, rough=None, color=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    def tex(im):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; return t
    if 'color' in imgs: nt.links.new(tex(imgs['color']).outputs['Color'], b.inputs['Base Color'])
    elif color: b.inputs['Base Color'].default_value = (*color, 1)
    if 'rough' in imgs: nt.links.new(tex(imgs['rough']).outputs['Color'], b.inputs['Roughness'])
    elif rough is not None: b.inputs['Roughness'].default_value = rough
    if 'metal' in imgs: nt.links.new(tex(imgs['metal']).outputs['Color'], b.inputs['Metallic'])
    elif metal is not None: b.inputs['Metallic'].default_value = metal
    if 'normal' in imgs:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex(imgs['normal']).outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if 'ao' in imgs:
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = gltf_output_group()
        nt.links.new(tex(imgs['ao']).outputs['Color'], g.inputs['Occlusion'])
    return m


# ---------- shaders ----------

def brass_shader(nt, ao_img):
    N = nt.nodes.new; L = nt.links.new
    tc = N('ShaderNodeTexCoord')
    xyz = N('ShaderNodeSeparateXYZ'); L(tc.outputs['Object'], xyz.inputs[0])

    # Lathe marks: fine rings along z, wobbled by noise so they are not perfect.
    wob = N('ShaderNodeTexNoise'); wob.inputs['Scale'].default_value = 0.6; wob.inputs['Detail'].default_value = 4
    L(tc.outputs['Object'], wob.inputs['Vector'])
    zz = N('ShaderNodeMath'); zz.operation = 'MULTIPLY_ADD'; zz.inputs[1].default_value = 4.0 * math.tau
    L(xyz.outputs['Z'], zz.inputs[0]); L(wob.outputs['Fac'], zz.inputs[2])
    sine = N('ShaderNodeMath'); sine.operation = 'SINE'; L(zz.outputs[0], sine.inputs[0])

    # Pits and dings.
    pits = N('ShaderNodeTexVoronoi'); pits.inputs['Scale'].default_value = 3.0
    L(tc.outputs['Object'], pits.inputs['Vector'])
    pr = N('ShaderNodeMapRange'); pr.inputs['From Min'].default_value = 0.0; pr.inputs['From Max'].default_value = 0.08
    L(pits.outputs['Distance'], pr.inputs['Value'])

    h = N('ShaderNodeMath'); h.operation = 'MULTIPLY_ADD'; h.inputs[1].default_value = 0.25
    L(sine.outputs[0], h.inputs[0]); L(pr.outputs['Result'], h.inputs[2])
    bump = N('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.18; bump.inputs['Distance'].default_value = 0.015
    L(h.outputs[0], bump.inputs['Height'])

    # Tarnish: in the thread valleys (AO) and in big soft patches.
    ao = N('ShaderNodeTexImage'); ao.image = ao_img
    aor = N('ShaderNodeMapRange'); aor.inputs['From Min'].default_value = 0.9; aor.inputs['From Max'].default_value = 0.3
    aor.inputs['To Max'].default_value = 0.7
    L(ao.outputs['Color'], aor.inputs['Value'])
    big = N('ShaderNodeTexNoise'); big.inputs['Scale'].default_value = 0.12; big.inputs['Detail'].default_value = 6; big.inputs['Roughness'].default_value = 0.6
    L(tc.outputs['Object'], big.inputs['Vector'])
    bigr = N('ShaderNodeMapRange'); bigr.inputs['From Min'].default_value = 0.45; bigr.inputs['From Max'].default_value = 0.7
    bigr.inputs['To Max'].default_value = 0.22
    L(big.outputs['Fac'], bigr.inputs['Value'])
    mask = N('ShaderNodeMath'); mask.operation = 'MAXIMUM'; mask.use_clamp = True
    L(aor.outputs['Result'], mask.inputs[0]); L(bigr.outputs['Result'], mask.inputs[1])

    col = N('ShaderNodeMix'); col.data_type = 'RGBA'
    col.inputs['A'].default_value = (0.92, 0.77, 0.46, 1)
    col.inputs['B'].default_value = (0.5, 0.36, 0.19, 1)
    L(mask.outputs[0], col.inputs['Factor'])

    rough = N('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.16; rough.inputs['To Max'].default_value = 0.45
    L(mask.outputs[0], rough.inputs['Value'])
    rjit = N('ShaderNodeMath'); rjit.operation = 'MULTIPLY_ADD'; rjit.inputs[1].default_value = 0.04
    L(sine.outputs[0], rjit.inputs[0]); L(rough.outputs['Result'], rjit.inputs[2])

    metal = N('ShaderNodeMapRange'); metal.inputs['To Min'].default_value = 1.0; metal.inputs['To Max'].default_value = 0.8
    L(mask.outputs[0], metal.inputs['Value'])

    return {'color': col.outputs['Result'], 'rough': rjit.outputs[0], 'metal': metal.outputs['Result'], 'normal': bump.outputs['Normal']}


def vitrite_shader(nt, ao_img):
    N = nt.nodes.new; L = nt.links.new
    tc = N('ShaderNodeTexCoord')
    n = N('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 0.5; n.inputs['Detail'].default_value = 8
    L(tc.outputs['Object'], n.inputs['Vector'])
    r = N('ShaderNodeMapRange'); r.inputs['To Min'].default_value = 0.08; r.inputs['To Max'].default_value = 0.3
    L(n.outputs['Fac'], r.inputs['Value'])
    return {'rough': r.outputs['Result']}


def bake_all():
    cap = bpy.data.objects['Cap']
    apply_solidify(cap)
    imgs = bake_object(cap, 'Cap', (2048, 1024), brass_shader, ['color', 'rough', 'metal', 'normal', 'ao'])
    cap.data.materials.clear(); cap.data.materials.append(baked_material('BrassBaked', imgs))

    ins = bpy.data.objects['Insulator']
    imgs = bake_object(ins, 'Insulator', (1024, 512), vitrite_shader, ['rough', 'ao'])
    ins.data.materials.clear()
    ins.data.materials.append(baked_material('VitriteBaked', imgs, metal=0.0, color=(0.012, 0.012, 0.014)))


bake_all()
