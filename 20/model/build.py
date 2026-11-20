"""Day 20's pod, built from the turnaround sheet in ref/. Run in Blender, with or without its window:

    cd 20/model && Blender -b cocoon.blend --python build.py                     # all of it, baked
    COCOON_STAGE=hull Blender -b cocoon.blend --python build.py --python compare.py -- out.png

It empties the `cocoon` collection, builds everything, saves the blend and writes ../public/cocoon.glb.
The names the web side reads (pod, door, plug.NNN, socket.NNN, hang, drip.NNN) are in ../README.md.

The form: the body's outline in the front view and in the side view, both traced off the sheet (sheet.py),
stood up as two prisms and intersected, then cut by a few slanted planes where the sheet shows big facets.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import importlib, sheet
importlib.reload(sheet)

STAGE = os.environ.get('COCOON_STAGE', 'all')   # 'hull': the form alone, nothing saved
TAU = math.tau

scene = bpy.context.scene
col = bpy.data.collections.get('cocoon')
if col:
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
else:
    col = bpy.data.collections.new('cocoon')
    scene.collection.children.link(col)
lc = bpy.context.view_layer.layer_collection.children.get('Collection')
if lc: lc.exclude = True
for block in (bpy.data.meshes, bpy.data.curves):
    for d in list(block):
        if d.users == 0: block.remove(d)


def mat(name, color, rough, metal=0.0, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    b = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    m.node_tree.links.new(b.outputs[0], m.node_tree.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    m.diffuse_color = (*color, 1)
    return m


CORE = mat('core', (0.03, 0.032, 0.035), 0.55, 0.7)
PAINT = mat('paint', (0.74, 0.74, 0.71), 0.5)


def obj(name, me, parent=None):
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    if parent: o.parent = parent
    return o


# ---------------------------------------------------------------- the form

def hull2d(pts):
    """convex hull of 2d points, counter-clockwise"""
    pts = sorted(set(pts))
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out
    lo, hi = half(pts), half(list(reversed(pts)))
    return lo[:-1] + hi[:-1]


def symmetric(poly, cx):
    """an outline made even about cx: at the height of each of its corners, half as wide as it is, both
    sides. The sheet's front is lopsided (wide low on one side, mid-height on the other) and the pod
    leaned like a parallelogram from behind, where the sheet has it even."""
    def across(y):
        xs = []
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            if (y0 - y) * (y1 - y) <= 0 and y0 != y1:
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
        return (max(xs) - min(xs)) / 2 if xs else 0.0
    top, bottom = min(y for _, y in poly), max(y for _, y in poly)
    ys = sorted({min(max(y, top + 0.5), bottom - 0.5) for _, y in poly})
    right = [(cx + across(y), y) for y in ys]
    return right + [(2 * cx - x, y) for x, y in reversed(right)]


def outline_planes(view, even=False):
    """the traced outline of a view as planes: each edge, stood up along the view's line of sight"""
    v = sheet.VIEWS[view]
    r = Vector(v['right'])
    up = Vector((0, 0, 1))
    poly = sheet.SILHOUETTE[view]
    if even: poly = symmetric(poly, v['cx'])
    pts = hull2d([sheet.to_view(view, *p) for p in poly])
    planes = []
    for (u0, w0), (u1, w1) in zip(pts, pts[1:] + pts[:1]):
        nu, nw = w1 - w0, -(u1 - u0)   # outward for a counter-clockwise loop
        L = math.hypot(nu, nw)
        n = (r * nu + up * nw) / L
        planes.append((n, n.dot(r * u0 + up * w0)))
    return planes


def facing(az, el):
    """az degrees round from the front towards +X, el degrees up"""
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


# Points read off the sheet that the big facets go through. The seam is the ridge down the front; A is where
# the strip along it meets the 03 shield, halfway down that line, which runs from the top left in towards the
# seam (front view). The front leans out 9 degrees towards the bottom, as the side view's front edge does;
# the shield looks 11 degrees down, which is what lays that line on the slant.
SEAM = Vector((0.164, -0.834, 0.0))
def on(az, el, p, x, z):
    """the point at (x, z) on the plane facing (az, el) through p"""
    n = facing(az, el)
    return Vector((x, p.y - ((x - p.x) * n.x + (z - p.z) * n.z) / n.y, z))
A = on(-25, 9, SEAM, *sheet.to_view('front', 290, 420))
def on_x(az, el, p, y, z):
    """the point at (y, z) on the plane facing (az, el) through p"""
    n = facing(az, el)
    return Vector((p.x - ((y - p.y) * n.y + (z - p.z) * n.z) / n.x, y, z))
# where the shield's stepped back edge runs down to its foot, side view: halfway along it, on the shield
_y, _z = sheet.to_view('right', 370, 520)
STEP = on_x(-58, -11, A, -_y, _z)
RIGHT = Vector((0.93, 0.05, 0.0))   # the right flank at its widest

# Big facets, as (name, az, el, where): where is a point it goes through, or how far in from where the
# outlines alone would put it.
FACETS = [
    ('strip', -25, 9, SEAM),      # left of the seam, down the front
    ('door', 30, 9, SEAM),       # right of the seam: the hatch
    ('shield_l', -58, -11, A),      # the 03 shield on the left flank
    ('shield_r', 85, 2, RIGHT),       # and on the right flank
    ('back_l', -152, 0, 0.12),    # the white strips down the back corners
    ('back_r', 152, 0, 0.12),
    ('cap_f', 0, 58, 0.06), ('cap_l', -70, 50, 0.06), ('cap_r', 70, 50, 0.06), ('cap_b', 180, 55, 0.05),
    ('skirt_f', 0, -50, 0.05), ('skirt_l', -65, -45, 0.06), ('skirt_r', 65, -45, 0.06), ('skirt_b', 180, -48, 0.04),
]


SHRINK = 0.065   # every plane comes in by a plate's thickness: the plates' outsides are the outline


def make_hull():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=8.0)
    names = bm.faces.layers.string.new('name')
    def clip(n, d, name):
        r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=n * d, plane_no=n, clear_outer=True)
        edges = [g for g in r['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
        if len(edges) >= 3:
            for f in bmesh.ops.edgeloop_fill(bm, edges=edges)['faces']: f[names] = name.encode()
    for view in ('front', 'right'):
        for i, (n, d) in enumerate(outline_planes(view, even=view == 'front')):
            clip(n, d - SHRINK, '%s.%02d' % (view, i))
    for name, az, el, where in FACETS:
        n = facing(az, el)
        d = n.dot(where) - SHRINK if isinstance(where, Vector) else max(v.co.dot(n) for v in bm.verts) - where
        clip(n, d, name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


hull = make_hull()
NAME = hull.faces.layers.string['name']


# ---------------------------------------------------------------- which plate each piece of surface is

T = 0.06       # plate thickness
GAP = 0.016    # half a seam between plates
DOOR = ('door', 'door_low')

VIEW_DIRS = {view: Vector(v['toward']) for view, v in sheet.VIEWS.items()}
VIEW_DIRS.update(top=Vector((0, 0, 1)), bottom=Vector((0, 0, -1)))


def view_of(f):
    return max(VIEW_DIRS, key=lambda k: f.normal.dot(VIEW_DIRS[k]))


def inside(poly, x, y):
    c = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def to_pixel(view, p):
    """a world point to a pixel of a view"""
    v = sheet.VIEWS[view]
    k = sheet.scale(view)
    u = p.dot(Vector(v['right']))
    return u / k + v['cx'], (v['top'] + v['bottom']) / 2 - p.z / k


def cut_plates(bm):
    """cut the surface along every traced outline, each in its own view, and name the pieces"""
    plate = bm.faces.layers.string.new('plate')
    for view, plates in sheet.PLATES.items():
        t = VIEW_DIRS[view]
        for _, poly in plates:
            for a, b in zip(poly, poly[1:] + poly[:1]):
                p0, p1 = Vector(sheet.to_world(view, *a)), Vector(sheet.to_world(view, *b))
                n = (p1 - p0).cross(t)
                if n.length < 1e-9: continue
                faces = [f for f in bm.faces if view_of(f) == view or (view == 'front' and f.normal.dot(t) > 0.3)]
                geom = set(faces)
                for f in faces: geom.update(f.edges); geom.update(f.verts)
                bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=p0, plane_no=n.normalized())
    for f in bm.faces:
        view = view_of(f)
        c = f.calc_center_median()
        name = None
        if view in sheet.PLATES:
            px, py = to_pixel(view, c)
            name = next((n for n, poly in sheet.PLATES[view] if inside(poly, px, py)), sheet.OTHERWISE[view])
            # where a side view sees machinery but the front sees plates, on a face turned to the front, the
            # front wins: the sheet does not agree with itself there, and the front is how the pod is met
            # (only on a face turned to the front more than to the side: the shield's own facet, behind its
            # stepped edge, is the side view's machinery, as the sheet's side view has it)
            if name == 'open' and view in ('right', 'left') and f.normal.dot(VIEW_DIRS['front']) > 0.6:
                px, py = to_pixel('front', c)
                name = next((n for n, poly in sheet.PLATES['front'] if inside(poly, px, py)), 'open')
        elif view == 'top':
            name = 'open' if f.normal.z > 0.85 else 'top_' + sector(c)
        else:
            name = 'bottom' if f.normal.z < -0.85 else 'open' if sector(c) == 'b' else 'under_' + sector(c)
        f[plate] = name.encode()
    return plate


def sector(c):
    a = math.degrees(math.atan2(c.x, -c.y))
    return 'f' if abs(a) < 45 else 'b' if abs(a) > 135 else 'r' if a > 0 else 'l'


PLATE = cut_plates(hull)
def plate_of(f): return f[PLATE].decode()


# ---------------------------------------------------------------- the hinge

def hinge():
    """the door turns about its own outer edge, as the front view draws it"""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromBMesh(hull)
    ends = []
    for px, py in ((506, 175), (560, 668)):
        o = Vector(sheet.to_world('front', px, py, 10.0))
        loc, n, i, _ = bvh.ray_cast(o, -VIEW_DIRS['front'])
        ends.append(loc)
    return ends

H0, H1 = hinge()
door_n = next(f.normal for f in hull.faces if f[NAME].decode() == 'door')
# (the hinge sits on the outside of the plates)
hz = (H0 - H1).normalized()
hx = (door_n - hz * door_n.dot(hz)).normalized()
DOOR_M = Matrix((hx, hz.cross(hx), hz)).transposed().to_4x4()
DOOR_M.translation = (H0 + H1) / 2 + door_n * T
DOOR_INV = DOOR_M.inverted()


# ---------------------------------------------------------------- core and plates

def region(names, transform=None):
    """a copy of the surface, only the pieces with these names"""
    b = hull.copy()
    layer = b.faces.layers.string['plate']
    bmesh.ops.delete(b, geom=[f for f in b.faces if f[layer].decode() not in names], context='FACES')
    if transform: b.transform(transform)
    for l in list(b.faces.layers.string.values()): b.faces.layers.string.remove(l)   # Blender cannot join string attributes
    return b


ALL = {plate_of(f) for f in hull.faces}
INNER = mat('inner', (0.018, 0.016, 0.016), 0.85)

def core(name, names, parent=None, transform=None):
    b = region(names, transform)
    me = bpy.data.meshes.new(name); b.to_mesh(me); b.free()
    me.materials.append(CORE); me.materials.append(INNER)
    o = obj(name, me, parent)
    s = o.modifiers.new('shell', 'SOLIDIFY'); s.thickness = 0.05; s.offset = -1; s.material_offset = 1; s.use_even_offset = True
    return o

pod = core('pod', ALL - set(DOOR))
door = core('door', set(DOOR), pod, DOOR_INV)
door.matrix_local = DOOR_M

PLATES = []
def plate(name, parent, transform=None, thick=T, gap=GAP):
    b = region({name}, transform)
    if not b.faces: b.free(); return None
    rim = bmesh.ops.inset_region(b, faces=b.faces[:], thickness=gap, depth=0, use_even_offset=True)['faces']
    bmesh.ops.delete(b, geom=rim, context='FACES')
    me = bpy.data.meshes.new('plate.' + name); b.to_mesh(me); b.free(); me.materials.append(PAINT)
    o = obj('plate.' + name, me, parent)
    s = o.modifiers.new('shell', 'SOLIDIFY'); s.thickness = thick; s.offset = 1; s.use_even_offset = True
    e = o.modifiers.new('edge', 'BEVEL'); e.width = 0.01; e.segments = 1; e.limit_method = 'ANGLE'; e.angle_limit = math.radians(35)
    PLATES.append(o)
    return o

THICK = {'shield_l': 0.075, 'shield_r': 0.075, 'cap_l': 0.07, 'strip': 0.08, 'door': 0.065, 'bottom': 0.04}
for name in sorted(ALL - {'open'}):
    if name in DOOR: plate(name, door, DOOR_INV, THICK.get(name, T))
    else: plate(name, pod, None, THICK.get(name, T), 0.06 if name == 'bottom' else GAP)



# ---------------------------------------------------------------- finding places off the sheet

from mathutils.bvhtree import BVHTree
hull.faces.ensure_lookup_table()
BVH = BVHTree.FromBMesh(hull)
LIFT = 0.0015  # marks above the plate

MECH = mat('mech', (0.075, 0.08, 0.085), 0.48, 0.45)
BLOCK = mat('block', (0.62, 0.62, 0.6), 0.5)
PANEL = mat('panel', (0.22, 0.225, 0.23), 0.5, 0.35)
BRASS = mat('brass', (0.55, 0.38, 0.16), 0.32, 1.0)
INK = mat('ink', (0.022, 0.023, 0.026), 0.6)
BLOOD = mat('blood', (0.16, 0.004, 0.006), 0.14)
SHROUD = mat('shroud', (0.55, 0.5, 0.42), 0.75)
HOSE = mat('hose', (0.03, 0.032, 0.035), 0.5, 0.15)
LED = mat('led', (0.02, 0.01, 0.0), 0.4, 0.0, ((1.0, 0.62, 0.25), 8.0))


def bevel(o, width):
    b = o.modifiers.new('edge', 'BEVEL'); b.width = width; b.segments = 1; b.limit_method = 'ANGLE'; b.angle_limit = math.radians(35)


def ray(origin, direction):
    loc, n, i, _ = BVH.ray_cast(origin, direction)
    if loc is None: return None
    name = plate_of(hull.faces[i])
    return loc, n, 0.0 if name == 'open' else THICK.get(name, T), name


def hit(view, px, py):
    """where a pixel of a view meets the surface: point, normal, the plate's thickness there, the plate"""
    return ray(Vector(sheet.to_world(view, px, py, 10.0)), -VIEW_DIRS[view])


def frame_at(n):
    """right, up, out on a surface facing n, as you would read it"""
    up = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((0, 1, 0))
    up = (up - n * up.dot(n)).normalized()
    return Matrix((up.cross(n), up, n)).transposed()


def view_frame(view):
    v = sheet.VIEWS[view]
    return Matrix((Vector(v['right']), Vector((0, 0, 1)), Vector(v['toward']))).transposed().to_4x4()


class Soup:
    """boxes and cylinders thrown into one mesh"""
    def __init__(self): self.bm = bmesh.new()
    def cyl(self, r, a, b, seg=12, r2=None):
        a, b = Vector(a), Vector(b)
        m = Matrix.Translation((a + b) / 2) @ (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=(b - a).length, matrix=m)
    def box(self, size, at, rot=None):
        m = Matrix.Translation(at) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(self.bm, size=1, matrix=m)
    def done(self, name, material, parent, matrix=None, bevel=0.004):
        if matrix: self.bm.transform(matrix)
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free(); me.materials.append(material)
        o = obj(name, me, parent)
        if bevel: globals()['bevel'](o, bevel)
        return o
    def prism(self, poly, z0, z1, k):
        """a slab with the outline of poly, scaled by k about its middle"""
        c = sum(poly, Vector()) / len(poly)
        ring = lambda z: [self.bm.verts.new((c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, z)) for p in poly]
        a, b = ring(z0), ring(z1)
        n = len(poly)
        for i in range(n):
            self.bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
        self.bm.faces.new(a); self.bm.faces.new(list(reversed(b)))


    def tube(self, pts, r, seg=10):
        """a hose through some points"""
        pts = [Vector(p) for p in pts]
        path = []
        for i in range(len(pts) - 1):
            p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
            for j in range(6):
                t = j / 6
                path.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
        path.append(pts[-1])
        rings, nrm = [], Vector((1, 0.2, 0.3)).normalized()
        for i, p in enumerate(path):
            t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            nrm = nrm - t * nrm.dot(t)
            nrm = nrm.normalized() if nrm.length > 1e-6 else t.orthogonal().normalized()
            b = t.cross(nrm)
            rings.append([self.bm.verts.new(p + (nrm * math.cos(k * TAU / seg) + b * math.sin(k * TAU / seg)) * r) for k in range(seg)])
        for i in range(len(rings) - 1):
            for k in range(seg):
                self.bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k])).smooth = True
        self.bm.faces.new(list(reversed(rings[0]))); self.bm.faces.new(rings[-1])


def block(soup, view, x0, y0, x1, y1, out, depth=None):
    """a box over a pixel rectangle of a view, its face `out` metres proud of the surface there"""
    h = hit(view, (x0 + x1) / 2, (y0 + y1) / 2)
    if not h: return None
    k = sheet.scale(view)
    depth = depth or out + 0.06
    soup.box(((x1 - x0) * k, (y1 - y0) * k, depth), h[0] + VIEW_DIRS[view] * (out - depth / 2), view_frame(view))
    return h


def pipe(soup, view, pts, r, out):
    """a hose along pixels of a view, `out` metres off the surface under it (along the surface's own normal, so
    near an edge it follows the surface round instead of standing off it). Returns its ends."""
    path = []
    for px, py in pts:
        h = hit(view, px, py)
        if h: path.append(h[0] + h[1] * out)
    if len(path) >= 2: soup.tube(path, r)
    return path


# ---------------------------------------------------------------- machinery: the open back, the flanks behind the shields, the seam

def mirror(pts, w=555):
    """the back view's pixels, the other side"""
    return [(w - x, y) for x, y in pts]


def machinery():
    """everything that is not shell, where the sheet has it. Returns the two hoses' tops, which go on up to the
    ceiling as cables."""
    m, lamps, white, plate_, hose = Soup(), Soup(), Soup(), Soup(), Soup()
    # the back. Plates on a spine: the block with two lamps, the middle plate, the maker's plate, the foot
    for rect, out in (((198, 345, 368, 470), 0.10), ((228, 470, 342, 620), 0.07), ((228, 620, 342, 692), 0.085),
                      ((205, 705, 355, 765), 0.08)):
        block(plate_, 'back', *rect, out)
    # the spine, the manifold up top, clamp boxes, a bar across, brackets in the pockets either side, the base
    for rect, out in (((240, 140, 320, 700), 0.035), ((205, 95, 360, 150), 0.06), ((150, 245, 215, 292), 0.085),
                      ((350, 245, 420, 292), 0.085), ((112, 330, 455, 344), 0.05), ((66, 420, 120, 436), 0.03),
                      ((66, 560, 120, 576), 0.03), ((445, 420, 499, 436), 0.03), ((445, 560, 499, 576), 0.03),
                      ((130, 712, 205, 775), 0.05), ((360, 712, 435, 775), 0.05), ((180, 690, 385, 704), 0.04)):
        block(m, 'back', *rect, out)
    # hoses: two heavy ones from the top down, bending in to the foot, thinner ones down the pockets, two from
    # the manifold into the block
    tops = []
    for pts, r, out in (([(185, 112), (185, 400), (185, 630), (200, 685), (240, 700)], 0.045, 0.085),
                        ([(140, 230), (140, 640), (152, 690), (185, 705)], 0.026, 0.045),
                        ([(160, 240), (160, 620)], 0.018, 0.06),
                        ([(258, 150), (258, 345)], 0.022, 0.07)):
        for side in (pts, mirror(pts)):
            path = pipe(hose, 'back', side, r, out)
            if r > 0.04 and path: tops.append((path[0], r))
    for y in (265, 420, 560):   # clamps on the heavy ones
        for x in (185, 370):
            block(m, 'back', x - 16, y - 9, x + 16, y + 9, 0.085 + 0.045 + 0.012)
    for rect, out in (((204, 378, 216, 420), 0.102), ((348, 378, 360, 420), 0.102), ((400, 250, 410, 282), 0.09),
                      ((104, 346, 113, 356), 0.065), ((442, 346, 451, 356), 0.065)):
        block(lamps, 'back', *rect, out, 0.02)
    # the flanks, behind the shields: a heavy hose down and bending forward at the foot, a thin one by it,
    # boxes, clamps, two lamps. The side view's front is on its right, so the other flank is drawn the other way.
    for view, rects, hoses, clamps, lights in (
        ('right', [((200, 440, 245, 560), 0.05), ((250, 470, 300, 580), 0.045), ((205, 735, 330, 790), 0.035), ((128, 250, 178, 330), 0.045)],
         [([(130, 270), (140, 420), (150, 560), (200, 650), (280, 690), (340, 670)], 0.042, 0.05),
          ([(112, 300), (118, 520), (160, 660), (240, 710)], 0.026, 0.03)],
         [(128, 380, 158, 392), (140, 520, 170, 532)], [(315, 733, 332, 746), (118, 265, 128, 280)]),
        ('left', [((430, 430, 480, 560), 0.05), ((470, 470, 525, 590), 0.045), ((400, 735, 520, 790), 0.035), ((545, 250, 592, 330), 0.045)],
         [([(565, 250), (565, 420), (560, 560), (510, 650), (430, 690), (370, 680)], 0.042, 0.05),
          ([(588, 300), (590, 520), (545, 660), (470, 710)], 0.026, 0.03)],
         [(550, 380, 580, 392), (545, 520, 575, 532)], [(388, 733, 405, 746), (590, 265, 600, 280)])):
        for rect, out in rects: block(m, view, *rect, out)
        for pts, r, out in hoses: pipe(hose, view, pts, r, out)
        for rect in clamps: block(m, view, *rect, 0.1)
        for rect in lights: block(lamps, view, *rect, 0.05, 0.02)
    # the seam: a white latch across it with a lamp, a smaller block, dark things in it
    block(white, 'front', 376, 385, 424, 472, 0.11)
    block(white, 'front', 406, 520, 436, 575, 0.09)
    for rect, out in (((398, 150, 418, 260), 0.03), ((418, 620, 440, 700), 0.03), ((404, 300, 422, 370), 0.05)):
        block(m, 'front', *rect, out)
    block(lamps, 'front', 384, 398, 398, 410, 0.112, 0.02)
    m.done('mech', MECH, pod, None, 0.006)
    hose.done('hoses', HOSE, pod, None, 0)
    lamps.done('lamps', LED, pod, None, 0)
    white.done('blocks', BLOCK, pod, None, 0.008)
    plate_.done('spine_plate', PANEL, pod, None, 0.006)
    return tops


# ---------------------------------------------------------------- the deck on top, where the cables go in

def deck():
    tops = [f for f in hull.faces if plate_of(f) == 'open' and f.normal.z > 0.85]
    c = sum((f.calc_center_median() for f in tops), Vector()) / len(tops)
    m, brass = Soup(), Soup()
    m.box((0.5, 0.4, 0.08), c + Vector((0, 0.02, 0.0)))
    ports = []
    for row, y in enumerate((-0.17, 0.0, 0.17)):
        for x in (-0.2, 0.0, 0.2):
            p = c + Vector((x - 0.02 * row, y, 0.05))
            lean = Vector((x * 0.5, y * 0.4, 1)).normalized()
            m.cyl(0.07, p, p + lean * 0.06, 14)
            brass.cyl(0.062, p + lean * 0.06, p + lean * 0.11, 14)
            ports.append((p + lean * 0.11, lean, 0.05))
    m.done('deck', MECH, pod, None, 0.005)
    brass.done('collars', BRASS, pod, None, 0.003)
    lamps = Soup()
    for x in (-0.12, 0.12):
        lamps.box((0.03, 0.012, 0.05), c + Vector((x, -0.26, 0.04)))
    lamps.done('deck_lamps', LED, pod, None, 0)
    return ports, c


# ---------------------------------------------------------------- under it

def underside():
    m = Soup()
    c = sum((f.calc_center_median() for f in hull.faces if plate_of(f) == 'bottom'), Vector())
    n = sum(1 for f in hull.faces if plate_of(f) == 'bottom')
    c /= max(1, n)
    zb = min(v.co.z for v in hull.verts)
    m.box((0.3, 0.16, 0.05), Vector((c.x, c.y - 0.05, zb - 0.015)))
    m.done('under', MECH, pod, None, 0.004)
    return Vector((c.x - 0.15, c.y + 0.1, zb - 0.07))


# ---------------------------------------------------------------- markings

fonts = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources', '%d.%d' % bpy.app.version[:2], 'datafiles', 'fonts', 'Inter.woff2')
FONT = bpy.data.fonts.load(fonts, check_existing=True) if os.path.exists(fonts) else None

class Marks:
    """flat shapes laid on plates, gathered into one mesh"""
    def __init__(self): self.bm = bmesh.new()
    def _take(self, me, matrix):
        n0, f0 = len(self.bm.verts), len(self.bm.faces)
        self.bm.from_mesh(me)
        self.bm.verts.ensure_lookup_table(); self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[f0:]:  # face up, whichever way it was drawn
            f.normal_update()
            if f.normal.z < 0: f.normal_flip()
        bmesh.ops.transform(self.bm, matrix=matrix, verts=self.bm.verts[n0:])
        bpy.data.meshes.remove(me)
    def text(self, body, size, where, bold=0.0, spacing=1.0, align='LEFT'):
        cu = bpy.data.curves.new('t', 'FONT')
        cu.body, cu.size, cu.align_x, cu.space_character, cu.offset, cu.resolution_u = body, size, align, spacing, bold * size, 3
        cu.space_line = 1.12
        if FONT: cu.font = FONT
        o = bpy.data.objects.new('t', cu); col.objects.link(o)
        me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(o); bpy.data.curves.remove(cu)
        self._take(me, where)
    def poly(self, pts, where):
        me = bpy.data.meshes.new('p'); me.from_pydata([(x, y, 0) for x, y in pts], [], [list(range(len(pts)))])
        self._take(me, where)
    def rect(self, x, y, w, h, where): self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], where)
    def cross(self, x, y, s, where, t=0.26):
        self.rect(x - s / 2, y - s * t / 2, s, s * t, where); self.rect(x - s * t / 2, y - s / 2, s * t, s, where)
    def disc(self, x, y, r, where, a0=0.0, a1=TAU, seg=28):
        n = max(3, int(seg * (a1 - a0) / TAU))
        self.poly([(x + r * math.cos(a0 + (a1 - a0) * i / n), y + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)], where)
    def split_disc(self, x, y, r, where, gap=0.14):
        g = math.asin(gap)
        self.disc(x, y, r, where, math.pi / 2 + g, math.pi * 1.5 - g)
        self.disc(x, y, r, where, -math.pi / 2 + g, math.pi / 2 - g)
    def stripes(self, x, y, w, h, where, n=3):
        """a block of slanted bars, the left end a solid square with a notch of light in it"""
        self.rect(x, y, h, h, where)
        step = (w - h * 1.1) / n
        for i in range(n):
            x0 = x + h * 1.1 + i * step
            self.poly([(x0, y), (x0 + step * 0.55, y), (x0 + step * 0.55 + h * 0.6, y + h), (x0 + h * 0.6, y + h)], where)
    def done(self, name, material, parent, matrix=None):
        self.bm.normal_update()
        for f in self.bm.faces: f.smooth = False
        if matrix: self.bm.transform(matrix)
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free(); me.materials.append(material)
        return obj(name, me, parent)

    def icon(self, x, y, w, h, where):
        """the stasis mark: a black square with a white dome let into it, on a white line"""
        r, cx, base = w * 0.3, x + w / 2, y + h * 0.2
        self.rect(x, y, w, h * 0.15, where)
        arc = [(cx + r * math.cos(math.pi * i / 12), base + r * math.sin(math.pi * i / 12)) for i in range(13)]
        self.poly([(x, base), (cx - r, base)] + arc[::-1][1:-1] + [(cx + r, base), (x + w, base), (x + w, y + h), (x, y + h)], where)
    def bars(self, x, y, w, h, where, n=3):
        step = w / n
        for i in range(n):
            x0 = x + i * step
            self.poly([(x0, y), (x0 + step * 0.55, y), (x0 + step * 0.55 + h * 0.5, y + h), (x0 + h * 0.5, y + h)], where)


def lay(ink, view, anchor, items, shift=0, out=None):
    """marks drawn in a view's pixels, each shot onto the surface along that view's line of sight, so it lands
    where the sheet draws it, and laid flat on the face it lands on. `shift` slides them across the view."""
    k = sheet.scale(view)
    def place(x, y):
        """a 4x4 at pixel (x, y), on the face there, Z out"""
        g = hit(view, x + shift, y)
        if g is None: return None
        th = g[2] if out is None else out
        M = frame_at(g[1]).to_4x4(); M.translation = g[0] + g[1] * (th + LIFT)
        return M
    for kind, *a in items:
        at = place(*((a[1], a[2]) if kind == 'text' else (a[0], a[3]) if kind in ('rect', 'icon', 'bars', 'slash') else (a[0], a[1])))
        if at is None: continue
        if kind == 'text':
            body, x, y, cap, bold = a
            ink.text(body, cap * k / 0.727, at, bold=bold, spacing=1.12)
        elif kind == 'rect': ink.rect(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at)
        elif kind == 'cross': ink.cross(0, 0, a[2] * k, at)
        elif kind == 'split': ink.split_disc(0, 0, a[2] * k, at @ Matrix.Rotation(0.45, 4, 'Z'))
        elif kind == 'icon': ink.icon(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at)
        elif kind == 'bars': ink.bars(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at, a[4])
        elif kind == 'slash':
            x0, y0, x1, y1 = a
            M = at
            for dx in (0, 9):
                ink.poly([(dx * k, 0), ((dx + 5) * k, 0), ((x1 - x0 + dx + 5) * k, (y1 - y0) * k), ((x1 - x0 + dx) * k, (y1 - y0) * k)], M)


def markings():
    ink = Marks()
    # the 03 shield on the left flank, as the side view has it, slid a little back: the front view has it
    # further left than the side view puts it, and this is halfway
    lay(ink, 'right', (405, 380), [
        ('text', '03', 405, 380, 64, 0.03), ('text', 'TYPE-A', 405, 412, 11, 0.008),
        ('text', 'STASIS PRESERVATION', 405, 430, 11, 0.006),
        ('icon', 445, 460, 492, 530), ('bars', 505, 460, 592, 530, 3),
        ('cross', 418, 582, 22), ('cross', 456, 588, 22), ('cross', 446, 624, 24),
        ('text', 'RETECH\nHUMAN\nFURTHER', 486, 597, 10, 0.006), ('cross', 310, 265, 30)], shift=-45)
    # and on the right flank, slid back onto the flank proper: where the side view has it, it would sit on
    # the corner and show from the front, which the front view does not
    lay(ink, 'left', (210, 380), [
        ('text', '03', 210, 380, 66, 0.03), ('text', 'TYPE-A', 186, 412, 11, 0.008),
        ('text', 'STASIS PRESERVATION', 178, 430, 11, 0.006),
        ('icon', 160, 462, 212, 530), ('bars', 225, 462, 322, 530, 3),
        ('text', 'UEC', 190, 628, 22, 0.012), ('cross', 290, 621, 28), ('cross', 430, 268, 30)], shift=60)
    # the marks on the caps
    lay(ink, 'front', (245, 140), [('split', 245, 140, 32), ('text', 'LES\nSOMMES\nPLUS\nLOIN', 284, 132, 7, 0.004)])
    lay(ink, 'right', (448, 168), [('split', 448, 168, 30)])
    lay(ink, 'left', (298, 172), [('split', 298, 172, 28)])
    # low on the right of the front
    lay(ink, 'front', (505, 728), [('text', 'CONTAIN\nPRESERVE\nITERATE', 505, 728, 10, 0.006), ('slash', 476, 722, 486, 758)])
    # the maker's plate on the spine
    lay(ink, 'back', (245, 672), [('text', 'UEC', 245, 672, 22, 0.012)], out=0.085)
    ink.done('marks', INK, pod)
    # on the hatch
    ink = Marks()
    lay(ink, 'front', (455, 410), [('rect', 455, 410, 508, 498), ('rect', 522, 480, 575, 540), ('rect', 590, 470, 620, 552),
                                   ('cross', 498, 402, 16)])
    ink.done('door_marks', INK, door, DOOR_INV)


# ---------------------------------------------------------------- blood: down the seam and off the skirt

def blood():
    bm = bmesh.new()
    ends = []
    for pts, width in (([(406, 472), (409, 520), (412, 580), (417, 646)], 0.014), ([(398, 480), (399, 512)], 0.007),
                       ([(425, 662), (427, 720), (431, 802)], 0.012), ([(415, 666), (416, 700)], 0.007),
                       ([(392, 476), (390, 492)], 0.006)):
        path = []
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            for j in range(6):
                t = j / 6
                h = hit('front', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
                if h: path.append((h[0] + h[1] * (h[2] + LIFT * 1.5), h[1]))
        h = hit('front', *pts[-1])
        path.append((h[0] + h[1] * (h[2] + LIFT * 1.5), h[1]))
        left, right = [], []
        N = len(path)
        for i, (p, n) in enumerate(path):
            d = (path[min(i + 1, N - 1)][0] - path[max(i - 1, 0)][0]).normalized()
            across = n.cross(d).normalized()
            s = i / (N - 1)
            w = width * (1 - 0.5 * s) * (0.75 + 0.25 * math.sin(i * 1.7))
            if s > 0.85: w = width * (0.6 + 1.4 * math.sin((s - 0.85) / 0.15 * math.pi))
            left.append(p - across * w / 2); right.append(p + across * w / 2)
        bm.faces.new([bm.verts.new(q) for q in left + right[::-1]])
        ends.append(path[-1][0])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('blood'); bm.to_mesh(me); bm.free(); me.materials.append(BLOOD)
    obj('blood', me, pod)
    return min(ends, key=lambda p: p.z)


# ---------------------------------------------------------------- inside: something wrapped

def lofted(name, profile, seg, material, parent, ridge=0.0, turns=0.0):
    """rings along Z: (z, rx, ry, y). ridge and turns wind a band round it, like wrapping"""
    bm = bmesh.new()
    rows = []
    for z, rx, ry, y in profile:
        row = []
        for j in range(seg):
            a = j * TAU / seg
            k = 1 + ridge * math.sin(turns * z * TAU + a) ** 3
            row.append(bm.verts.new((rx * k * math.cos(a), y + ry * k * math.sin(a), z)))
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(seg):
            j1 = (j + 1) % seg
            bm.faces.new((rows[i][j], rows[i][j1], rows[i + 1][j1], rows[i + 1][j]))
    bm.faces.new(list(reversed(rows[0]))); bm.faces.new(rows[-1])
    for f in bm.faces: f.smooth = True
    bm.normal_update()
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(material)
    return obj(name, me, parent)

def smooth_profile(keys, n):
    """Catmull-Rom through (z, rx, ry, y) keys"""
    out = []
    for i in range(len(keys) - 1):
        p0, p1, p2, p3 = keys[max(i - 1, 0)], keys[i], keys[i + 1], keys[min(i + 2, len(keys) - 1)]
        for j in range(n):
            t = j / n
            out.append(tuple(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(keys[-1])
    return out

BODY = [(-1.02, 0.03, 0.03, 0.02), (-0.98, 0.09, 0.075, 0.0), (-0.86, 0.105, 0.085, 0.04), (-0.55, 0.13, 0.10, 0.06), (-0.25, 0.17, 0.115, 0.07),
        (0.0, 0.21, 0.125, 0.07), (0.28, 0.215, 0.13, 0.08), (0.52, 0.255, 0.125, 0.09), (0.63, 0.20, 0.10, 0.07),
        (0.70, 0.085, 0.08, 0.04), (0.78, 0.10, 0.105, 0.0), (0.90, 0.108, 0.118, -0.02), (1.0, 0.085, 0.095, -0.01), (1.045, 0.02, 0.02, 0.0)]


def inside():
    at = Vector((-0.05, 0.08, -0.02))
    lofted('body', smooth_profile(BODY, 8), 28, SHROUD, pod, ridge=0.035, turns=5.5).location = at
    m = Soup()
    for i, (z, rx, ry, y) in enumerate(((0.5, 0.275, 0.145, 0.09), (0.05, 0.23, 0.145, 0.07), (-0.5, 0.155, 0.12, 0.06))):
        lofted('strap.%d' % i, [(z - 0.028, rx, ry, y), (z + 0.028, rx, ry, y)], 24, MECH, pod).location = at
        m.box((0.07, 0.42, 0.05), (0, 0.34, z))
    m.box((0.2, 0.05, 1.9), (0, 0.56, 0.0))
    m.done('cradle', MECH, pod, None, 0.003).location = at


# ---------------------------------------------------------------- hooks for the web side

def empty(name, loc, direction=None, parent=None, size=0.2, **props):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type, o.empty_display_size = 'SINGLE_ARROW', size
    o.location = loc
    if direction: o.rotation_euler = Vector(direction).to_track_quat('Z', 'Y').to_euler()
    for k, v in props.items(): o[k] = v
    col.objects.link(o)
    if parent: o.parent = parent
    return o


def hooks(ports, top, drip_seam, drip_under):
    hang = top + Vector((-0.6, 0.15, 7.2))
    for i, (p, d, r) in enumerate(ports):
        empty('plug.%03d' % i, p, d, pod, radius=r, slack=1.02 + 0.05 * ((i * 37) % 5) / 4)
        a = i * TAU / len(ports) + 0.3
        empty('socket.%03d' % i, hang + Vector((0.55 * math.cos(a), 0.55 * math.sin(a), 0)), (0, 0, -1))
    empty('hang', hang, (0, 0, -1), size=0.6)
    empty('drip.000', drip_seam - Vector((0, 0, 0.004)), (0, 0, -1), pod, size=0.12)
    empty('drip.001', drip_under, (0, 0, -1), pod, size=0.12)


# ---------------------------------------------------------------- wear, baked

SIZE = 2048
BAKE = os.environ.get('COCOON_BAKE', '1') != '0'

def bake_paint(objs):
    """The paint as it is after years in the hall, drawn with noise in object space and baked to two textures:
    colour, and roughness + metal. Chips follow the edges (the Bevel node finds them), dirt follows the dark
    corners (an AO bake) and runs down."""
    import numpy as np
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 6
    if not scene.world: scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = 0.3

    # the bevel becomes real, then one atlas for both
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        old = o.data; o.modifiers.clear(); o.data = me; bpy.data.meshes.remove(old)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')

    nt = PAINT.node_tree; N, K = nt.nodes, nt.links
    N.clear()
    def node(kind, **props):
        n = N.new(kind)
        for k, v in props.items(): setattr(n, k, v)
        return n
    def feed(x, socket):
        if hasattr(x, 'node'): K.new(x, socket)
        else: socket.default_value = x
    def op(operation, a, b=None, clamp=False):
        n = node('ShaderNodeMath', operation=operation, use_clamp=clamp)
        feed(a, n.inputs[0])
        if b is not None: feed(b, n.inputs[1])
        return n.outputs[0]
    def mapping(vec, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        n = node('ShaderNodeMapping')
        K.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value, n.inputs['Rotation'].default_value, n.inputs['Location'].default_value = scale, rot, loc
        return n.outputs[0]
    def noise(vec, scale, detail=4.0, rough=0.55):
        n = node('ShaderNodeTexNoise')
        K.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value, n.inputs['Detail'].default_value, n.inputs['Roughness'].default_value = scale, detail, rough
        return n.outputs[0]
    def ramp(x, lo, hi, a=0.0, b=1.0):
        n = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        feed(x, n.inputs[0])
        for i, v in enumerate((lo, hi, a, b)): n.inputs[i + 1].default_value = v
        return n.outputs[0]
    def mix(f, a, b):
        n = node('ShaderNodeMix', data_type='RGBA')
        feed(f, n.inputs[0])
        for i, x in ((6, a), (7, b)): feed(x if hasattr(x, 'node') else (*x, 1), n.inputs[i])
        return n.outputs[2]
    def cracks(vec, scale, width):
        n = node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE')
        K.new(vec, n.inputs['Vector']); n.inputs['Scale'].default_value = scale
        return ramp(n.outputs[0], 0.0, width, 1.0, 0.0)

    P = node('ShaderNodeTexCoord').outputs['Object']
    big = noise(P, 2.2, 5, 0.6)
    runs = noise(mapping(P, (17, 17, 0.8)), 1.0, 4, 0.6)
    fine = noise(P, 95, 2, 0.5)
    dirt = op('ADD', op('MULTIPLY', ramp(big, 0.46, 0.76), 0.55), op('MULTIPLY', ramp(runs, 0.52, 0.8), 0.6), True)
    # edges: where the rounded normal leaves the real one
    geo = node('ShaderNodeNewGeometry')
    bev = node('ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = 0.02
    d = node('ShaderNodeVectorMath', operation='SUBTRACT'); K.new(bev.outputs[0], d.inputs[0]); K.new(geo.outputs['Normal'], d.inputs[1])
    ln = node('ShaderNodeVectorMath', operation='LENGTH'); K.new(d.outputs[0], ln.inputs[0])
    edge = ramp(ln.outputs['Value'], 0.02, 0.45)
    chip = ramp(op('ADD', op('MULTIPLY', edge, 0.8), op('MULTIPLY', noise(P, 34, 4, 0.7), 0.62)), 0.80, 0.86)
    chip = op('MAXIMUM', chip, ramp(noise(mapping(P, loc=(3, 1, 7)), 9, 5, 0.72), 0.735, 0.76))
    scratch = op('MULTIPLY', cracks(mapping(P, rot=(0.4, 0.9, 0.2)), 7.0, 0.006), ramp(noise(mapping(P, loc=(5, 2, 1)), 3.2, 3), 0.5, 0.68))
    scratch = op('MAXIMUM', scratch, op('MULTIPLY', op('MULTIPLY', cracks(mapping(P, rot=(1.1, 0.2, 0.7)), 19.0, 0.012), ramp(noise(mapping(P, loc=(1, 8, 2)), 5.0, 3), 0.52, 0.7)), 0.7))
    speck = op('MULTIPLY', ramp(fine, 0.7, 0.8), 0.4)

    colour = mix(op('MULTIPLY', dirt, 0.5), (0.74, 0.74, 0.71), (0.27, 0.24, 0.2))
    colour = mix(speck, colour, (0.2, 0.2, 0.2))
    colour = mix(op('MULTIPLY', scratch, 0.7), colour, (0.36, 0.36, 0.37))
    colour = mix(chip, colour, (0.05, 0.05, 0.055))
    rough = op('SUBTRACT', op('ADD', op('ADD', 0.42, op('MULTIPLY', dirt, 0.3)), op('MULTIPLY', fine, 0.1)), op('MULTIPLY', scratch, 0.12))
    rough = op('ADD', op('MULTIPLY', rough, op('SUBTRACT', 1.0, chip)), op('MULTIPLY', chip, 0.34))

    emit = node('ShaderNodeEmission'); out = node('ShaderNodeOutputMaterial'); K.new(emit.outputs[0], out.inputs['Surface'])
    target = node('ShaderNodeTexImage'); N.active = target
    def bake(name, source, kind='EMIT'):
        img = bpy.data.images.get(name)
        if img: bpy.data.images.remove(img)
        img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        target.image = img
        if source is not None:
            for l in list(emit.inputs['Color'].links): K.remove(l)
            K.new(source, emit.inputs['Color'])
        for i, o in enumerate(objs):
            bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.bake(type=kind, use_clear=(i == 0), margin=6)
        px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        return px.reshape(SIZE, SIZE, 4)[:, :, :3]
    flat = [o for o in col.objects if o.name in ('marks', 'door_marks', 'blood', 'door_glass')]
    for o in flat: o.hide_render = True  # a hair above the plate, they would shadow it black
    c = bake('b_colour', colour)
    r = bake('b_rough', rough)[:, :, :1]
    mt = bake('b_metal', chip)[:, :, :1]
    scene.cycles.samples = 48
    ao = np.clip(bake('b_ao', None, 'AO')[:, :, :1], 0, 1)
    for o in flat: o.hide_render = False

    # dirt gathers where the light does not
    shade = 1 - ao
    c = c * (1 - 0.7 * shade) * (1 - 0.35 * shade) + np.array([0.2, 0.17, 0.13], np.float32) * 0.25 * shade
    r = np.clip(r + 0.25 * shade, 0, 1)
    srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 1e-6, 1), 1 / 2.4) - 0.055)
    def image(name, rgb, space):
        img = bpy.data.images.get(name)
        if img: bpy.data.images.remove(img)
        img = bpy.data.images.new(name, SIZE, SIZE, alpha=False)
        img.colorspace_settings.name = space
        px = np.ones((SIZE, SIZE, 4), np.float32); px[:, :, :3] = np.clip(rgb, 0, 1)
        img.pixels.foreach_set(px.ravel()); img.pack()
        return img
    i_colour = image('cocoon_paint', srgb, 'sRGB')
    i_orm = image('cocoon_paint_orm', np.concatenate([ao, r, mt], axis=2), 'Non-Color')

    # the material as it ships: two textures
    N.clear()
    bsdf = node('ShaderNodeBsdfPrincipled'); out = node('ShaderNodeOutputMaterial'); K.new(bsdf.outputs[0], out.inputs['Surface'])
    tc = node('ShaderNodeTexImage', image=i_colour); K.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    to = node('ShaderNodeTexImage', image=i_orm)
    sep = node('ShaderNodeSeparateColor'); K.new(to.outputs['Color'], sep.inputs[0])
    K.new(sep.outputs[1], bsdf.inputs['Roughness']); K.new(sep.outputs[2], bsdf.inputs['Metallic'])
    return {'ao_mean': float(ao.mean()), 'chip_mean': float(mt.mean()), 'colour_mean': [float(x) for x in c.reshape(-1, 3).mean(axis=0)]}


def freeze(objs, name, parent):
    """apply the modifiers and make one object of them"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        old = o.data; o.modifiers.clear(); o.data = me; bpy.data.meshes.remove(old)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


# ---------------------------------------------------------------- all of it

result = {'faces': len(hull.faces), 'plates': sorted(ALL)}
if STAGE != 'hull':
    hose_tops = machinery()
    ports, top = deck()
    ports += [(p, Vector((0, 0.25, 1)).normalized(), r) for p, r in hose_tops]
    under = underside()
    markings()
    seam_drip = blood()
    inside()
    hooks(ports, top, seam_drip, under)
    # it hangs askew, head to the left and a little towards you
    pod.rotation_euler = (math.radians(6), math.radians(-14), math.radians(-12))

if STAGE == 'all':
    on_body, on_door = [o for o in PLATES if o.parent == pod], [o for o in PLATES if o.parent == door]
    body_plates = freeze(on_body, 'plates', pod)
    door_plates = freeze(on_door, 'door_plates', door)
    baked = bake_paint([body_plates, door_plates]) if BAKE else None
    os.makedirs(os.path.join(ROOT, 'public'), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = pod
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'public', 'cocoon.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_extras=True, export_image_format='JPEG', export_jpeg_quality=88)
    bpy.ops.wm.save_mainfile()
    tris = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in col.objects:
        if o.type == 'MESH':
            e = o.evaluated_get(dg).to_mesh(); e.calc_loop_triangles(); tris += len(e.loop_triangles)
    result.update(objects=len(col.objects), tris=tris, glb_kb=os.path.getsize(os.path.join(ROOT, 'public', 'cocoon.glb')) // 1024, baked=baked)
print('RESULT', result)
