# An old oak for the clearings, as a model, after the open-grown reference (process/ref/oak-open-grown.jpg): its
# wood, with the bark's coordinates in metres for the shader (oak.ts), and its leaves, red oak's, in cards at the
# ends of the twigs.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/oak.py -- render   # and model/renders/oak*.png
#
# An old pedunculate oak grown in the open: a short thick bole, its foot spread in buttresses into the ground,
# splitting a few metres up into three or four heavy limbs that go out more than up, crooked, elbowed, each forking
# again and again, the crown wider than it is tall. Tubes along crooked paths, a ring of vertices every step, each
# child starting inside its parent so the joins close without welding. One mesh, y up after the glTF export.
# Part (the _part attribute): 0 the bole, 1 a limb, 2 a twig, 3 a leaf. The wood's uv: round the tube (0..1, a ring
# has a seam vertex so it does not smear back), along it in metres; _girth its radius there, so the shader can
# have the bark in metres round too. A leaf's uv: across (-1..1) and along (0 at the stalk, 1 at the tip), its
# _girth a seed (its colour, its turn of autumn).

import bpy, math, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TAU = math.pi * 2
R = random.Random(11)
RL = random.Random(23)  # the leaves' own: drawing from R, they changed the form of the tree itself


def v_add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def v_sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def v_mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def v_cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def v_len(a): return math.sqrt(v_dot(a, a))
def v_norm(a):
    l = v_len(a) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


class Mesh:
    def __init__(self):
        self.V, self.F, self.part, self.uv, self.girth = [], [], [], [], []

    def leaf(self, base, d, side, size, seed):
        """a leaf card from its stalk at base out along d, side across it: four corners (its outline is the
        shader's, so the card can be plain)"""
        start = len(self.V)
        for v in (0.0, 1.0):
            for c in (-1.0, 1.0):
                p = v_add(base, v_add(v_mul(d, v * size), v_mul(side, c * size * 0.34)))
                self.V.append(p); self.part.append(3); self.uv.append((c, v)); self.girth.append(seed)
        self.F.append((start, start + 1, start + 3, start + 2))

    def tube(self, pts, radii, part, sides, cap=True, flare=None):
        """rings along pts (z up), frames carried along so they do not twist; flare(i, a) scales a ring's radius"""
        n = len(pts)
        t0 = v_norm(v_sub(pts[1], pts[0]))
        ref = (0.0, 0.0, 1.0) if abs(t0[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = v_norm(v_cross(t0, ref))
        start = len(self.V)
        along = 0.0
        ring = sides + 1  # the seam vertex again at the end of each ring, its uv 1
        for i in range(n):
            if i > 0:
                along += v_len(v_sub(pts[i], pts[i - 1]))
            t = v_norm(v_sub(pts[min(i + 1, n - 1)], pts[max(i - 1, 0)]))
            u = v_norm(v_sub(u, v_mul(t, v_dot(u, t))))  # parallel transport
            w = v_cross(t, u)
            for k in range(ring):
                a = k / sides * TAU
                r = radii[i] * (flare(i, a % TAU) if flare else 1.0)
                d = v_add(v_mul(u, math.cos(a) * r), v_mul(w, math.sin(a) * r))
                self.V.append(v_add(pts[i], d))
                self.part.append(part); self.uv.append((k / sides, along)); self.girth.append(radii[i])
        for i in range(n - 1):
            for k in range(sides):
                a = start + i * ring + k
                self.F.append((a, a + 1, a + 1 + ring, a + ring))
        if cap:
            self.V.append(pts[-1])
            self.part.append(part); self.uv.append((0.5, along)); self.girth.append(0.0)
            c = len(self.V) - 1
            last = start + (n - 1) * ring
            for k in range(sides):
                self.F.append((last + k, last + k + 1, c))


M = Mesh()


def path(p0, yaw0, pitch0, pitch1, length, steps, wander, phase):
    """a limb's line: its pitch going from pitch0 to pitch1 along it (an oak limb rises, levels and hangs down at
    the end under its own weight), its heading wandering in a slow S, never below the head height of a deer"""
    pts, p = [p0], p0
    seg = length / steps
    for i in range(steps):
        t = (i + 0.5) / steps
        pitch = pitch0 + (pitch1 - pitch0) * t ** 1.4 + 0.08 * math.sin(t * 7.0 + phase * 2.0)
        yaw = yaw0 + wander * (math.sin(t * 4.2 + phase) - math.sin(phase))
        d = (math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch))
        p = v_add(p, v_mul(d, seg))
        if p[2] < 1.8:
            p = (p[0], p[1], 1.8 + 0.3 * (p[2] - 1.8))
        pts.append(p)
    return pts


# for each level: how many children, their length to the parent's, their pitch at the start and at the end, and how
# far round from the parent's heading they leave
LEVELS = {
    3: dict(kids=7, len=(0.85, 1.15), p0=(0.05, 0.35), p1=(-0.8, -0.5), yaw=(0.6, 1.4)),  # leader -> long limbs
    2: dict(kids=6, len=(0.3, 0.45), p0=(-0.1, 0.4), p1=(-0.9, -0.4), yaw=(0.5, 1.1)),  # limb -> branches
    1: dict(kids=4, len=(0.35, 0.55), p0=(-0.2, 0.5), p1=(-1.0, -0.3), yaw=(0.4, 1.0)),  # branch -> twigs
}


def limb(p0, yaw, pitch0, pitch1, length, r0, depth):
    """a limb and its children; depth 0 is a twig"""
    steps = max(4, int(length / 0.4))
    phase = R.uniform(0, TAU)
    # (a gentle wander: more and the long limbs curled round into loops)
    pts = path(p0, yaw, pitch0, pitch1, length, steps, 0.15 if depth >= 2 else 0.3, phase)
    # tapering slowly, then to a point: a limb ends in its twigs, not a sawn-off pipe
    radii = [r0 * (1.0 - 0.88 * (i / steps) ** 0.9) for i in range(len(pts))]
    M.tube(pts, radii, 1 if depth > 0 else 2, 12 if r0 > 0.2 else 8 if r0 > 0.06 else 5)
    # leaves: in clusters along the outer part of the twigs and the small branches, spreading out from them and
    # turned up to the light, hanging a little at the tips
    if depth <= 1:
        nl = 22 if depth == 0 else 13
        for j in range(nl):
            i = min(len(pts) - 2, int(len(pts) * RL.uniform(0.35 if depth == 0 else 0.6, 1.0)))
            t = v_norm(v_sub(pts[i + 1], pts[i]))
            a = RL.uniform(0, TAU)
            out = v_norm(v_cross(t, (math.cos(a), math.sin(a), RL.uniform(-0.3, 0.3))))
            d = v_norm(v_add(v_add(out, v_mul(t, 0.6)), (0.0, 0.0, RL.uniform(-0.35, 0.15))))
            side = v_norm(v_cross(d, (0.0, 0.0, 1.0))) if abs(d[2]) < 0.95 else (1.0, 0.0, 0.0)
            side = v_norm(v_add(side, (0.0, 0.0, RL.uniform(-0.4, 0.4))))
            M.leaf(pts[i], d, side, RL.uniform(0.21, 0.31), RL.random())  # (the page scales the tree up 1.3-1.6)
    if depth == 0:
        return
    L = LEVELS[depth]
    for f in range(L['kids']):
        t = 0.25 + 0.7 * (f + R.uniform(0.2, 0.8)) / L['kids']
        i = min(int(t * steps), steps - 1)
        h = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
        side = 1 if f % 2 == 0 else -1
        limb(pts[i], h + side * R.uniform(*L['yaw']), R.uniform(*L['p0']), R.uniform(*L['p1']),
             length * R.uniform(*L['len']) * (1.0 - 0.35 * t), radii[i] * R.uniform(0.6, 0.8), depth - 1)


def oak():
    # the bole: tall and thick for its height, barely tapering, about 1.5 m across at breast height
    H = 5.0
    base_r = 0.75
    bole = [(0.0, 0.0, -0.4)]
    for i in range(1, 15):
        z = -0.4 + (H + 0.4) * i / 14
        bole.append((0.06 * math.sin(z * 0.9), 0.05 * math.sin(z * 1.3 + 1.0), z))
    # barely tapering, then swelling into the crotch where it splits
    radii = [base_r * (1.0 - 0.1 * (p[2] / H) + 0.25 * max(0.0, (p[2] - H + 1.2) / 1.2) ** 2) for p in bole]
    buttress = [R.uniform(0, TAU) for _ in range(5)]

    def flare(i, a):
        z = bole[i][2]
        low = math.exp(-max(z, 0.0) / 0.6)
        b = sum(max(0.0, math.cos(a - ba)) ** 6 for ba in buttress)
        return 1.0 + low * (0.35 + 0.9 * b)

    # (open at the top: the leaders rise out of it and cover it; a cap had shown as a flat lid between them)
    M.tube(bole, radii, 0, 24, cap=False, flare=flare)
    top = bole[-1]
    # it splits into three leaders, heavy, going up and out at forty to sixty degrees, then levelling: the long
    # limbs leave them and go out level, hanging down at their ends
    n = 3
    for k in range(n):
        yaw = k / n * TAU + R.uniform(-0.35, 0.35)
        # (from deep in the bole, as thick as it there, so the bole seems to split rather than sprout them)
        start = v_add(top, (math.cos(yaw) * 0.25, math.sin(yaw) * 0.25, -1.6))
        limb(start, yaw, R.uniform(0.8, 1.0), R.uniform(0.25, 0.45), R.uniform(12.0, 14.0), base_r * R.uniform(0.7, 0.8), 3)


def make():
    oak()
    me = bpy.data.meshes.new('oak')
    me.from_pydata(M.V, [], M.F)
    me.validate()
    attr = me.attributes.new('_part', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', [float(p) for p in M.part])
    g = me.attributes.new('_girth', 'FLOAT', 'POINT')
    g.data.foreach_set('value', [float(x) for x in M.girth])
    uvl = me.uv_layers.new(name='uv')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = M.uv[me.loops[li].vertex_index]
    ob = bpy.data.objects.new('oak', me)
    bpy.context.scene.collection.objects.link(ob)
    for poly in me.polygons:
        poly.use_smooth = True
    return ob


def render(ob):
    out = os.path.join(HERE, 'renders')
    os.makedirs(out, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'SINGLE'
    sc.display.shading.single_color = (0.42, 0.38, 0.33)
    sc.display.shading.show_cavity = True
    sc.display.shading.show_shadows = True
    sc.world = sc.world or bpy.data.worlds.new('w')
    # ground, so you see where it stands
    bpy.ops.mesh.primitive_plane_add(size=80)
    ground = bpy.context.object
    cam = bpy.data.cameras.new('cam')
    cam.lens = 18
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co

    def shot(name, loc, look, w, h):
        co.location = loc
        d = v_sub(look, loc)
        co.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0.0, math.atan2(d[1], d[0]) - math.pi / 2)
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.filepath = os.path.join(out, name + '.png')
        bpy.ops.render.render(write_still=True)

    cam.lens = 24
    shot('oak-open', (0.0, -30.0, 1.6), (0.0, 0.0, 7.0), 1600, 1040)  # as the open-grown reference: from the field
    cam.lens = 14
    shot('oak-worm', (1.6, -1.8, 0.3), (-1.0, 1.5, 14.0), 1200, 1200)  # from its foot, looking up the bole
    ground.hide_render = True


def export(ob):
    path = os.path.join(HERE, '..', 'public', 'oak.glb')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_attributes=True,
                              export_materials='NONE', export_yup=True)


if __name__ == '__main__':
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    ob = make()
    print('oak', len(M.V), 'vertices', len(M.F), 'faces')
    if 'render' in sys.argv:
        render(ob)
    else:
        export(ob)
