"""Day 20's pod, built from the turnaround sheet in ref/. Run in Blender, with or without its window:

    cd 20/model && Blender -b cocoon.blend --python build.py                     # all of it, baked
    COCOON_STAGE=hull Blender -b cocoon.blend --python build.py --python compare.py -- out.png

It empties the `cocoon` collection, builds everything, saves the blend and writes ../public/cocoon.glb.
The names the web side reads (pod, door, plug.NNN, socket.NNN, hang, lift.NNN, drip.NNN) are in ../README.md.

The form: the body's outline in the front view and in the side view, both traced off the sheet (sheet.py),
stood up as two prisms and intersected, then cut by a few slanted planes where the sheet shows big facets.
"""
import bpy, bmesh, math, os, sys, random
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


def simplify(poly, eps):
    """Douglas-Peucker on a closed outline: drop the corners that bend it less than eps pixels. Every corner
    left is a facet edge on the form, and a corner that hardly bends draws a band across the plates."""
    def dp(pts):
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        L = math.hypot(x1 - x0, y1 - y0) or 1e-9
        d = [abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L for x, y in pts[1:-1]]
        if not d or max(d) < eps: return [pts[0], pts[-1]]
        i = d.index(max(d)) + 1
        return dp(pts[:i + 1])[:-1] + dp(pts[i:])
    top = min(range(len(poly)), key=lambda i: poly[i][1])
    bot = max(range(len(poly)), key=lambda i: poly[i][1])
    ring = poly[top:] + poly[:top]
    k = (bot - top) % len(poly)
    a, b = ring[:k + 1], ring[k:] + ring[:1]
    return dp(a)[:-1] + dp(b)[:-1]


def outline_planes(view, even=False):
    """the traced outline of a view as planes: each edge, stood up along the view's line of sight"""
    v = sheet.VIEWS[view]
    r = Vector(v['right'])
    up = Vector((0, 0, 1))
    poly = sheet.SILHOUETTE[view]
    poly = simplify(symmetric(poly, v['cx']) if even else list(poly), 5.0)
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
# The shield is not flat: it folds along a line that runs from its top down past the left of the 03 to its foot,
# leaning forward as it goes (side view, (349, 218) to (479, 678)), the part behind turned 7 degrees more to the
# side; and again across its upper stepped part, which turns up towards the cap.
def _on_shield(px, py):
    y, z = sheet.to_view('right', px, py)
    return on_x(-58, -11, A, -y, z)
F1, F2 = _on_shield(349, 218), _on_shield(479, 678)
_d = (F2 - F1).normalized()
_n = facing(-58, -11)
_back = Vector((0, 1, 0)); _back = (_back - _n * _back.dot(_n) - _d * _back.dot(_d)).normalized()
FOLD_N = max((Matrix.Rotation(sg * math.radians(7), 3, _d) @ _n for sg in (1, -1)), key=lambda m: (m - _n).dot(_back))
FOLD = F1
_y, _z = sheet.to_view('right', 290, 300)
UPPER = Vector((F1.x - ((-_y - F1.y) * FOLD_N.y + (_z - F1.z) * FOLD_N.z) / FOLD_N.x, -_y, _z))
RIGHT = Vector((0.93, 0.05, 0.0))   # the right flank at its widest

# Big facets, as (name, az, el, where): where is a point it goes through, or how far in from where the
# outlines alone would put it.
FACETS = [
    ('strip', -25, 9, SEAM),      # left of the seam, down the front
    ('door', 30, 9, SEAM),       # right of the seam: the hatch
    ('shield_l', -58, -11, A),      # the 03 shield on the left flank
    ('shield_l2', FOLD_N, None, FOLD),  # its back part, folded along that slanting line
    ('shield_l3', -78, 16, UPPER),  # its upper stepped part, turned up
    ('skirt_lf', -42, -30, 0.03),   # a small facet low on the front corner
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
        n = az if isinstance(az, Vector) else facing(az, el)
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
            name = 'open' if f.normal.z < -0.85 or sector(c) == 'b' else 'under_' + sector(c)   # the bottom: machinery
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
PANELS = []      # the pieces the plates are cut into, for the details laid on them
CUT = 0.005      # half a fine seam, where a plate is cut into panels

def subpanels(b, name):
    """Cut a plate's surface into panels, as the sheet's plates have fine seams across them, following the
    plate's own lines, not the world's: the direction its edges run most (summed by length) sets the way; one
    seam runs along it, parallel to those edges, where the plate is wide enough, and one or two cross it square.
    Returns the faces of each panel and the planes, to tell the panels apart."""
    faces = list(b.faces)
    area = sum(f.calc_area() for f in faces)
    if area < 0.3: return [faces], [], None
    n = sum((f.normal * f.calc_area() for f in faces), Vector()).normalized()
    c = sum((f.calc_center_median() * f.calc_area() for f in faces), Vector()) / area
    # the way its edges run: boundary edges in the plate's plane, folded to one half circle, weighed by length
    bins = {}
    for e in b.edges:
        if not e.is_boundary: continue
        d = e.verts[1].co - e.verts[0].co
        d = d - n * d.dot(n)
        if d.length < 1e-6: continue
        a = int(math.degrees(math.atan2(d.dot(n.orthogonal().normalized().cross(n)), d.dot(n.orthogonal().normalized()))) % 180 // 10)
        for k in (a - 1, a, a + 1):   # a little blur, so a bend of a few degrees still counts as one line
            bins.setdefault(k % 18, []).append(d)
    best = max(bins.values(), key=lambda ds: sum(d.length for d in ds))
    ref = max(best, key=lambda d: d.length).normalized()
    along = sum((d if d.dot(ref) > 0 else -d for d in best), Vector()).normalized()
    across = n.cross(along).normalized()
    us = [(v.co - c).dot(along) for v in b.verts]
    ss = [(v.co - c).dot(across) for v in b.verts]
    rnd = random.Random(sum(map(ord, name)) * 7 + 3)
    planes = []
    lo, hi = min(us), max(us)
    # across it, square to its lines: near both ends on a long plate, through the middle of a short one
    for t in ((rnd.uniform(0.18, 0.26), rnd.uniform(0.74, 0.82)) if hi - lo > 1.0 else (rnd.uniform(0.4, 0.6),)):
        planes.append((c + along * (lo + (hi - lo) * t), along))
    slo, shi = min(ss), max(ss)
    if shi - slo > 0.7 and area > 0.6:   # along it down the middle, parallel to its lines
        planes.append((c + across * (slo + (shi - slo) * rnd.uniform(0.45, 0.55)), across))
    for co, no in planes:
        bmesh.ops.bisect_plane(b, geom=b.verts[:] + b.edges[:] + b.faces[:], dist=0.004, plane_co=co, plane_no=no)
    bmesh.ops.dissolve_degenerate(b, dist=0.002, edges=b.edges[:])   # slivers would spike the even solidify
    groups = {}
    for f in b.faces:
        m = f.calc_center_median()
        groups.setdefault(tuple((m - co).dot(no) > 0 for co, no in planes), []).append(f)
    return list(groups.values()), planes, along


RIMS = []        # the edges of the panels, for the bolts along them

def loops_of(edges, own):
    """boundary edges walked into loops: each a list of (point, inward) with inward the way into the panel"""
    left, loops = set(edges), []
    at = {}
    for e in edges:
        for v in e.verts: at.setdefault(v, []).append(e)
    while left:
        e = left.pop(); v = e.verts[1]; chain = [e.verts[0], v]; es = [e]
        while True:
            nxt = [x for x in at[v] if x in left]
            if not nxt: break
            e = nxt[0]; left.discard(e); v = e.other_vert(v); chain.append(v); es.append(e)
        pts = []
        for i, e in enumerate(es):
            a, b = chain[i].co, chain[i + 1].co
            f = next(lf for lf in e.link_faces if lf in own)
            d = (b - a).normalized(); inward = f.normal.cross(d)
            if inward.dot(f.calc_center_median() - (a + b) / 2) < 0: inward = -inward
            pts.append((a.copy(), b.copy(), inward, f.normal.copy()))
        loops.append(pts)
    return loops


def plate(name, parent, transform=None, thick=T, gap=GAP):
    b = region({name}, transform)
    if not b.faces: b.free(); return None
    rim = bmesh.ops.inset_region(b, faces=b.faces[:], thickness=gap, depth=0, use_even_offset=True)['faces']
    bmesh.ops.delete(b, geom=rim, context='FACES')
    groups, planes, along = subpanels(b, name)
    for g in groups:
        area = sum(f.calc_area() for f in g)
        if area > 0.05:
            c = sum((f.calc_center_median() * f.calc_area() for f in g), Vector()) / area
            mid = min(g, key=lambda f: (f.calc_center_median() - c).length)   # the face nearest its middle
            PANELS.append(dict(name=name, parent=parent, transform=transform, thick=thick, area=area, planes=planes,
                               key=tuple((mid.calc_center_median() - co).dot(no) > 0 for co, no in planes),
                               at=mid.calc_center_median(), n=mid.normal.copy(), along=along))
    # each panel's edge, as loops in order: where the bolts go
    for g in groups:
        if sum(f.calc_area() for f in g) < 0.05: continue
        own = set(g)
        edge = [e for f in g for e in f.edges if sum(1 for lf in e.link_faces if lf in own) == 1]
        if edge: RIMS.append(dict(name=name, parent=parent, transform=transform, thick=thick, loops=loops_of(edge, own),
                                  planes=planes, key=tuple((g[0].calc_center_median() - co).dot(no) > 0 for co, no in planes)))
    if planes:
        for g in groups:
            if sum(f.calc_area() for f in g) < 0.01: continue   # a sliver: an even inset would shoot its corners out
            rim = bmesh.ops.inset_region(b, faces=[f for f in g if f.is_valid], thickness=CUT, depth=0, use_even_offset=False)['faces']
            bmesh.ops.delete(b, geom=rim, context='FACES')
    me = bpy.data.meshes.new('plate.' + name); b.to_mesh(me); b.free(); me.materials.append(PAINT)
    o = obj('plate.' + name, me, parent)
    s = o.modifiers.new('shell', 'SOLIDIFY'); s.thickness = thick; s.offset = 1; s.use_even_offset = True
    e = o.modifiers.new('edge', 'BEVEL'); e.width = 0.016; e.segments = 1; e.limit_method = 'ANGLE'; e.angle_limit = math.radians(35)
    PLATES.append(o)
    return o

# The plates either side of the seam stand well out, thick, with a wide gap between them: the seam is a channel
# with walls, deep enough to be dark in, as the hall picture has it. The skirts along the foot are thick too.
THICK = {'shield_l': 0.075, 'shield_r': 0.075, 'cap_l': 0.07, 'strip': 0.15, 'door': 0.16, 'door_low': 0.16, 'bottom': 0.04,
         'skirt_fl': 0.1, 'skirt_fr': 0.1, 'skirt_ls': 0.1, 'skirt_rs': 0.1, 'panel_m': 0.09}
WIDE = {'strip': 0.032, 'door': 0.032, 'door_low': 0.032}   # half the gap round these
for name in sorted(ALL - {'open'}):
    if name in DOOR: plate(name, door, DOOR_INV, THICK.get(name, T), WIDE.get(name, GAP))
    else: plate(name, pod, None, THICK.get(name, T), 0.06 if name == 'bottom' else WIDE.get(name, GAP))



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
def frosted(name):
    """dirty frosted glass: lets light through, blurred, and little else"""
    m = mat(name, (0.62, 0.64, 0.6), 0.62)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Transmission Weight'].default_value = 1.0
    b.inputs['IOR'].default_value = 1.45
    return m
FROST = frosted('frost')
LED_RED = mat('led_red', (0.02, 0.0, 0.0), 0.4, 0.0, ((1.0, 0.08, 0.04), 3.0))
LED_GREEN = mat('led_green', (0.0, 0.02, 0.0), 0.4, 0.0, ((0.2, 1.0, 0.35), 2.5))
DARK = mat('dark', (0.012, 0.012, 0.014), 0.7)
STEEL = mat('steel', (0.2, 0.205, 0.21), 0.38, 0.85)   # clamps and collars, catching the light
BOLT = mat('bolt', (0.12, 0.125, 0.13), 0.42, 0.9)
LED = mat('led', (0.02, 0.01, 0.0), 0.4, 0.0, ((1.0, 0.55, 0.18), 3.0))   # warm, not burnt white


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


    def tube(self, pts, r, seg=10, smooth=True):
        """a hose through some points (already smooth, or smoothed here)"""
        pts = [Vector(p) for p in pts]
        path = [] if smooth else pts[:-1]
        for i in range(len(pts) - 1 if smooth else 0):
            p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
            for j in range(6):
                t = j / 6
                path.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
        path.append(pts[-1])
        rings, nrm = [], Vector((1, 0.2, 0.3)).normalized()
        # uv: round the hose, and along it in ribs (one rib every 1.3 radii), for the web side's corrugation
        along, s = [], 0.0
        for i, p in enumerate(path):
            if i: s += (p - path[i - 1]).length
            along.append(s / (1.3 * r))
        for i, p in enumerate(path):
            t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            nrm = nrm - t * nrm.dot(t)
            nrm = nrm.normalized() if nrm.length > 1e-6 else t.orthogonal().normalized()
            b = t.cross(nrm)
            rings.append([self.bm.verts.new(p + (nrm * math.cos(k * TAU / seg) + b * math.sin(k * TAU / seg)) * r) for k in range(seg)])
        uv = self.bm.loops.layers.uv.verify()
        for i in range(len(rings) - 1):
            for k in range(seg):
                f = self.bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
                f.smooth = True
                for l, (ii, kk) in zip(f.loops, ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k))):
                    l[uv].uv = (kk / seg, along[ii])
        self.bm.faces.new(list(reversed(rings[0]))); self.bm.faces.new(rings[-1])


def block(soup, view, x0, y0, x1, y1, out, depth=None, tilt=0.0, flush=False):
    """a box over a pixel rectangle of a view, its face `out` metres proud of the surface there, turned by
    `tilt` (radians, anticlockwise as the view sees it) about its middle. Square to the view, or with `flush`
    laid in the surface's own plane, where the surface is turned away from the view"""
    h = hit(view, (x0 + x1) / 2, (y0 + y1) / 2)
    if not h: return None
    k = sheet.scale(view)
    depth = depth or out + 0.06
    if flush:
        soup.box(((x1 - x0) * k, (y1 - y0) * k, depth), h[0] + h[1] * (out - depth / 2),
                 frame_at(h[1]).to_4x4() @ Matrix.Rotation(tilt, 4, 'Z'))
    else:
        soup.box(((x1 - x0) * k, (y1 - y0) * k, depth), h[0] + VIEW_DIRS[view] * (out - depth / 2),
                 view_frame(view) @ Matrix.Rotation(tilt, 4, 'Z'))
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

def spline(pts, n=8):
    """Catmull-Rom through points"""
    pts = [Vector(p) for p in pts]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for j in range(n):
            t = j / n
            out.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


EVERY = 0.28   # a collar on every hose, this far apart


COLLARS = []   # the collars along the hoses: where, which way, how big; drawn on the web side, instanced


def placements(items):
    """(point, direction[, size]) in Blender's space to a flat list in the glb's (y up), four decimals: x y z, dx dy
    dz[, size] each"""
    out = []
    for it in items:
        p, d = it[0], it[1]
        out += [round(p.x, 4), round(p.z, 4), round(-p.y, 4), round(d.x, 4), round(d.z, 4), round(-d.y, 4)] + [round(x, 4) for x in it[2:]]
    return out


def line(hose, steel, mech, path, r, cap_start=True, cap_end=True):
    """A hose, fitted the one way every hose on the pod is: along a path of world points; each end it has goes
    into a steel coupling on a foot down to the surface, and a collar every EVERY metres, bolted to the surface
    by a bracket. A path that leaves the pod (to a cable) has no coupling at that end."""
    if len(path) < 2: return
    dense = spline(path, 6)
    hose.tube(dense, r, 10, smooth=False)
    def rot(d): return d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    def foot(p, w):
        loc, n, i, dist = BVH.find_nearest(p)
        if loc is None or dist < 1e-3: return
        d = loc - p
        mech.box((w, w, d.length + 0.02), (p + loc) / 2, rot(d))
    for cap, end, nxt in ((cap_start, dense[0], dense[1]), (cap_end, dense[-1], dense[-2])):
        if not cap: continue
        d = (end - nxt).normalized()
        steel.box((r * 2.9, r * 2.9, 0.1), end + d * 0.03, rot(d))
        steel.box((r * 3.4, r * 3.4, 0.025), end + d * 0.09, rot(d))
        foot(end + d * 0.03, r * 2.2)
    walked, next_at = 0.0, EVERY * 0.6
    for a, b in zip(dense, dense[1:]):
        seg = (b - a).length
        while walked + seg >= next_at:
            t = (next_at - walked) / seg
            p = a.lerp(b, t)
            COLLARS.append((p.copy(), (b - a).normalized(), r + 0.02))   # (hundreds of them: instanced, web side)
            foot(p, 0.03)
            next_at += EVERY
        walked += seg


def surface_path(view, pts, out, step=25):
    """pixels of a view to world points `out` metres off the surface under them. The pixel line is sampled
    every `step` pixels, so a hose drawn straight in the view follows the rounded surface instead of cutting
    through it between two far points"""
    dense = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        dense += [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n)]
    dense.append(pts[-1])
    hits = [h for h in (hit(view, *q) for q in dense) if h]
    path = [h[0] + h[1] * out for h in hits]
    # the surface folds; a hose does not: ease out the kinks the folds put in it, the ends held
    for _ in range(4):
        path = path[:1] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + path[-1:]
    return path


def run(hose, steel, view, pts, r, out):
    """a hose along pixels of a view that comes out of the body and goes back into it: both ends dive under the
    surface, through a steel grommet, so no end hangs in the air"""
    hits = [h for h in (hit(view, *q) for q in pts) if h]
    if len(hits) < 2: return
    path = [h[0] + h[1] * out for h in hits]
    a, b = hits[0], hits[-1]
    hose.tube([a[0] - a[1] * 0.06] + path + [b[0] - b[1] * 0.06], r)
    for p, n in ((a[0], a[1]), (b[0], b[1])):
        steel.cyl(r + 0.018, p - n * 0.01, p + n * (out + r * 0.6), 12)


def collar(soup, view, x, y, r, out, length, seg=8):
    """a ring round a hose that runs up the surface at pixel (x, y): its axis the surface's up"""
    h = hit(view, x, y)
    if not h: return
    n = h[1]
    up = Vector((0, 0, 1)); up = (up - n * up.dot(n)).normalized()
    c = h[0] + n * out
    soup.cyl(r, c - up * length / 2, c + up * length / 2, seg)


def boss(soup, view, x, y, r_px, out):
    """a round fitting standing out of the surface at pixel (x, y), a ring round its face"""
    h = hit(view, x, y)
    if not h: return
    k = sheet.scale(view)
    p, n = h[0], h[1]
    soup.cyl(r_px * k, p, p + n * out, 16)
    soup.cyl(r_px * k * 0.6, p + n * out, p + n * (out + 0.015), 16)


def greebles(view, hoses, m, panel, lamps, hose, steel, tilt, seed):
    """The machinery in a flank's open part, behind the shield, in layers: base plates under everything, ribbed
    panels, boxes, round fittings, thin hoses, a few lamps. Every piece lies in the surface's own plane, its
    whole footprint on open surface (never on a plate, never over an edge), and anything that stands taller
    than the base keeps clear of the hoses. Placed by a seeded random, so every build is the same."""
    rng = random.Random(seed)
    x_lo, x_hi = (95, 450) if view == 'right' else (250, 605)
    y_lo, y_hi = 240, 815
    def corners(cx, cy, w, h, t, grow=0.0):
        c, s_ = math.cos(t), math.sin(t)
        out = []
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, -1), (0, 1), (-1, 0), (1, 0)):
            dx, dy = dx * (w / 2 + grow), dy * (h / 2 + grow)
            out.append((cx + dx * c + dy * s_, cy - dx * s_ + dy * c))
        return out
    def is_open(x, y):
        h = hit(view, x, y)
        return h is not None and h[3] == 'open'
    def seg_d(px, py, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy or 1)))
        return math.hypot(px - (ax + vx * t), py - (ay + vy * t))
    def hose_d(x, y):
        return min((seg_d(x, y, *a, *b) for pts in hoses for a, b in zip(pts, pts[1:])), default=1e9)
    taken = []
    def fits(cx, cy, w, h, t, clear_hoses, layer):
        pts = corners(cx, cy, w, h, t, 5)
        if not all(is_open(x, y) for x, y in pts + [(cx, cy)]): return False
        if clear_hoses and min(hose_d(x, y) for x, y in pts + [(cx, cy)]) < 14: return False
        for (ox, oy, orad, ol) in taken:
            if ol == layer and math.hypot(cx - ox, cy - oy) < orad + math.hypot(w, h) / 2 * 0.8: return False
        return True
    def place(n, size, layer, clear_hoses, tries=400):
        got = []
        for _ in range(tries):
            if len(got) >= n: break
            w, h = size()
            t = tilt if rng.random() < 0.7 else 0.0
            cx, cy = rng.uniform(x_lo, x_hi), rng.uniform(y_lo, y_hi)
            if fits(cx, cy, w, h, t, clear_hoses, layer):
                taken.append((cx, cy, math.hypot(w, h) / 2, layer))
                got.append((cx, cy, w, h, t))
        return got
    def box(soup, cx, cy, w, h, t, out, depth):
        block(soup, view, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, out, depth, t, flush=True)
    # base plates, under everything (the hoses run over them)
    for cx, cy, w, h, t in place(22, lambda: (rng.uniform(40, 75), rng.uniform(60, 130)), 0, False):
        box(m, cx, cy, w, h, t, 0.022, 0.05)
    # ribbed panels
    for cx, cy, w, h, t in place(5, lambda: (rng.uniform(28, 38), rng.uniform(90, 130)), 1, True):
        box(panel, cx, cy, w, h, t, 0.045, 0.05)
        c, s_ = math.cos(t), math.sin(t)
        for j in range(6):
            dy = -h / 2 + h * (j + 0.5) / 6
            box(m, cx + dy * s_, cy + dy * c, w + 6, 4, t, 0.056, 0.03)
    # boxes, some of them grey plates
    for cx, cy, w, h, t in place(44, lambda: (rng.uniform(12, 40), rng.uniform(12, 52)), 1, True):
        out = rng.uniform(0.04, 0.085)
        box(panel if rng.random() < 0.25 else m, cx, cy, w, h, t, out, 0.08)
        if rng.random() < 0.55:   # a smaller one on top, off its middle: a cap, a terminal, a valve block
            k = rng.uniform(0.35, 0.6)
            ox, oy = rng.uniform(-0.2, 0.2) * w, rng.uniform(-0.2, 0.2) * h
            box(steel if rng.random() < 0.3 else panel, cx + ox, cy + oy, w * k, h * k, t, out + rng.uniform(0.012, 0.03), 0.05)
    # round fittings
    for cx, cy, w, h, t in place(30, lambda: (12, 12), 2, True):
        boss(steel, view, cx, cy, rng.uniform(4, 8), rng.uniform(0.045, 0.075))
    # thin hoses along the diagonal, fitted like every other hose
    n = 0
    for _ in range(200):
        if n >= 5: break
        L = rng.uniform(70, 170)
        x0, y0 = rng.uniform(x_lo, x_hi), rng.uniform(y_lo, y_hi - L)
        x1, y1 = x0 + L * math.sin(-tilt) * -1, y0 + L * math.cos(tilt)
        pts = [(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6) for i in range(7)]
        if all(is_open(x, y) and hose_d(x, y) > 20 for x, y in pts):
            line(hose, steel, m, surface_path(view, [pts[0], pts[-1]], 0.05), 0.016)
            hoses.append(pts)
            n += 1
    # a few lamps
    for cx, cy, w, h, t in place(7, lambda: (5, 9), 3, True):
        box(lamps, cx, cy, w, h, t, 0.06, 0.02)


def mirror(pts, w=555):
    """the back view's pixels, the other side"""
    return [(w - x, y) for x, y in pts]


def machinery():
    """everything that is not shell, where the sheet has it. Returns the two hoses' tops, which go on up to the
    ceiling as cables."""
    m, lamps, white, plate_, hose, steel = Soup(), Soup(), Soup(), Soup(), Soup(), Soup()
    # the back. Plates on a spine: the block with two lamps, the maker's plate (tall, a seam across it), the foot
    for rect, out in (((198, 345, 368, 470), 0.10), ((231, 474, 339, 690), 0.08), ((210, 712, 354, 786), 0.085)):
        block(plate_, 'back', *rect, out)
    block(plate_, 'back', 229, 622, 341, 632, 0.09)
    # the spine, three ribs on it above the block, the manifold up top, a bar across, brackets in the pockets,
    # blocks either side of the foot
    for rect, out in (((240, 140, 320, 700), 0.035), ((205, 95, 360, 150), 0.06), ((150, 330, 405, 344), 0.05),
                      ((120, 740, 205, 798), 0.05), ((350, 740, 435, 798), 0.05),
                      ((180, 690, 385, 704), 0.04), ((241, 240, 259, 345), 0.075), ((271, 240, 289, 345), 0.08),
                      ((301, 240, 319, 345), 0.075)):
        block(m, 'back', *rect, out)
    # round fittings either side of the spine's head, bosses either side of the maker's plate
    for x, y, r, out in ((234, 219, 18, 0.07), (354, 219, 18, 0.07), (207, 636, 14, 0.1), (358, 636, 14, 0.1)):
        boss(steel, 'back', x, y, r, out)
    # hoses: two pairs of heavy ones from the top down, sleeved in rings, bending in to the foot; thinner ones
    # down the pockets, two from the manifold into the block
    tops = []
    for x, dx in ((162, 0), (186, 6)):
        pts = [(x, 200), (x, 400), (x, 630), (x + 14 + dx, 684), (x + 40 + dx, 698)]
        for side in (pts, mirror(pts)):
            # from the back the top of the pod slopes away, so a hose drawn up to the top edge would dive
            # into it: it runs up the back and leaves it straight up, to its cable; at the foot, a coupling
            path = surface_path('back', side, 0.09)
            if len(path) < 2: continue
            up = path[0] + Vector((0, 0, 0.42))
            line(hose, steel, m, [up] + path, 0.04, cap_start=False)
            tops.append((up, 0.04))
    for pts, r, out in (([(140, 240), (140, 640), (150, 684), (172, 700)], 0.026, 0.05),
                        ([(258, 205), (258, 340)], 0.022, 0.07)):
        for side in (pts, mirror(pts)):
            path = surface_path('back', side, out)
            if r > 0.025 and len(path) >= 2:
                # (the ones down the pockets leave the pod upwards too: every cable comes in at the back now)
                up = path[0] + Vector((0, 0, 0.34))
                line(hose, steel, m, [up] + path, r, cap_start=False)
                tops.append((up, r))
            else:
                line(hose, steel, m, path, r)
    # up top a block that holds each pair, with a lamp in it
    for x0, x1 in ((150, 200), (355, 405)):
        block(steel, 'back', x0, 250, x1, 282, 0.15)
    # lamps: two on the block, one in the right clamp, little ones on the shell's steps, specks in the pockets
    for rect, out in (((204, 378, 216, 420), 0.102), ((348, 378, 360, 420), 0.102), ((396, 252, 406, 280), 0.152),
                      ((187, 794, 197, 802), 0.052), ((367, 794, 377, 802), 0.052)):
        block(lamps, 'back', *rect, out, 0.02)
    for x, y in ((180, 558), (180, 594), (192, 678), (360, 558), (366, 594), (390, 630), (130, 500), (425, 500)):
        block(lamps, 'back', x - 3, y - 3, x + 3, y + 3, 0.04, 0.01)
    # the flanks, behind the shields: two hoses side by side down near the back edge, straight and steep,
    # then a sharp bend forward into a box at the foot (the inner one comes straight down from above first),
    # boxes, clamps, two lamps. The side view's front is on its right, so the other flank is drawn the other way.
    for view, rects, hoses, clamps, lights in (
        ('right', [((292, 680, 360, 745), 0.11)],
         [([(140, 366), (205, 640), (221, 677), (240, 692), (330, 722)], 0.036, 0.06),
          ([(157, 253), (155, 330), (168, 385), (238, 632), (254, 668), (272, 681), (326, 698)], 0.036, 0.06)],
         [(128, 380, 158, 392), (140, 520, 170, 532)], [(315, 733, 332, 746)]),
        ('left', [((340, 680, 408, 745), 0.11)],
         [([(560, 366), (495, 640), (479, 677), (460, 692), (370, 722)], 0.036, 0.06),
          ([(543, 253), (545, 330), (532, 385), (462, 632), (446, 668), (428, 681), (374, 698)], 0.036, 0.06)],
         [(550, 380, 580, 392), (545, 520, 575, 532)], [(388, 733, 405, 746)])):
        # the boxes lean with the shield's stepped edge, which runs down towards the front a third off upright
        tilt = 0.57 if view == 'right' else -0.57
        for rect, out in rects: block(m, view, *rect, out, None, 0.0, flush=True)
        greebles(view, [pts for pts, r, out in hoses], m, plate_, lamps, hose, steel, tilt, 20 if view == 'right' else 21)
        for pts, r, out in hoses:
            # the flank's hoses too: up off their top ends, each to a cable
            path = surface_path(view, pts, out)
            if len(path) < 2: continue
            up = path[0] + Vector((0, 0, 0.3))
            line(hose, steel, m, [up] + path, r, cap_start=False)
            tops.append((up, r))
        # (clamps out at the flank's back edge stood off the side: left off)
        for rect in lights: block(lamps, view, *rect, 0.05, 0.02, flush=True)
    # the seam: a white latch across it with a lamp, a smaller block, dark things in it
    # (out past the thick plates either side of the seam, which they bridge)
    block(white, 'front', 376, 385, 424, 472, 0.2)
    block(white, 'front', 406, 520, 436, 575, 0.18)
    for rect, out in (((398, 150, 418, 260), 0.03), ((418, 620, 440, 700), 0.03), ((404, 300, 422, 370), 0.05)):
        block(m, 'front', *rect, out)
    block(lamps, 'front', 384, 398, 398, 410, 0.202, 0.02)
    m.done('mech', MECH, pod, None, 0.008)
    hose.done('hoses', HOSE, pod, None, 0)
    steel.done('clamps', STEEL, pod, None, 0)   # (the couplings at the hoses' ends; no bevel, for nothing seen)
    empty('collars_hoses', Vector((0, 0, 0)), None, pod, 0.05, at=placements(COLLARS))
    lamps.done('lamps', LED, pod, None, 0)
    white.done('blocks', BLOCK, pod, None, 0.008)
    plate_.done('spine_plate', PANEL, pod, None, 0.006)
    return tops


# ---------------------------------------------------------------- the small things on the plates

def details(clear):
    """Twice the detail on the plates: on each panel the plates are cut into, one thing, picked by a seeded
    random: a raised hatch with a connector on it, a dark slot in a steel frame (as the sheet has on the hatch), a
    vent of slats, a small tag with two diodes, or nothing. Each is laid flat on its panel and only where its
    whole footprint lands on that panel, flat enough, clear of the window; never on the top or the bottom,
    where the lugs and the machinery are. And the door's hinge: knuckles along it, leaves onto door and flank."""
    rnd = random.Random(20)
    plug = random.Random(31)   # the connectors' own, so the rest is laid out as it was
    soups = {}
    def soup(kind, parent):
        return soups.setdefault((kind, parent.name), (Soup(), parent))[0]
    hatches = {}
    for P in PANELS:
        n = P['n']
        if abs(n.z) > 0.6: continue
        M = P['transform'].inverted() if P['transform'] else Matrix.Identity(4)   # panel space to the pod's
        # square to the panel's seams where it has them, else upright
        up = P['along'] if P['along'] is not None else Vector((0, 0, 1)) if P['transform'] is None else (P['transform'].to_3x3() @ Vector((0, 0, 1))).normalized()
        if P['along'] is not None and up.z < 0: up = -up
        up = (up - n * up.dot(n)).normalized()
        side = up.cross(n)   # (right-handed with up and n: the other way round every box was inside out, and dark)
        R = Matrix((side, up, n)).transposed().to_4x4()
        size = min(0.6, math.sqrt(P['area']) * 0.42)
        kind = rnd.choices(['hatch', 'slot', 'vent', 'tag', None], [4, 3, 3, 2, 2])[0]
        if not kind: continue
        w, h = {'hatch': (size, size * rnd.uniform(0.6, 1.1)), 'slot': (size * 0.35, size * 0.7),
                'vent': (size * 0.8, size * 0.35), 'tag': (size * 0.4, size * 0.22)}[kind]
        ou, ov = rnd.uniform(-0.15, 0.15) * size, rnd.uniform(-0.15, 0.15) * size
        def fits(w, h):
            for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, -1), (0, 1), (-1, 0), (1, 0)):
                q = P['at'] + side * (ou + x * w / 2) + up * (ov + y * h / 2)
                got = BVH.ray_cast(M @ (q + n * 0.25), (M.to_3x3() @ -n).normalized(), 0.5)
                if got[0] is None: return False
                local = M.inverted() @ got[0]
                if abs((local - q).dot(n)) > 0.012: return False                 # not flat there
                if plate_of(hull.faces[got[2]]) != P['name']: return False      # off the plate
                if tuple((local - co).dot(no) > 0 for co, no in P['planes']) != P['key']: return False   # over a seam
                if any(((M @ q) - c).length < r for c, r in clear): return False
            return True
        if not fits(w, h):
            w, h = w * 0.65, h * 0.65
            if not fits(w, h): continue
        # (nothing bolted onto the door: on the sheet it is one clean slab leaning along the seam, three dark
        # squares on it and no more; hatches and vents all over it hid its shape. Left out here, after the dice
        # are thrown, so every other plate keeps what it had)
        if P['name'] in DOOR: continue
        base = P['at'] + side * ou + up * ov + n * P['thick']
        at = lambda x, y, z: base + side * x + up * y + n * z
        par = P['parent']
        if kind == 'hatch':
            hatches.setdefault(par.name, (Soup(), par, P['transform']))[0].box((w, h, 0.014), at(0, 0, 0.004), R)
            for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                b0 = at(x * (w / 2 - 0.016), y * (h / 2 - 0.016), 0.011)
                soup('bolt', par).cyl(0.005, b0, b0 + n * 0.004, 6)
            # no handle: connectors. A round one (flange, knurled nut, a dark face with pins), two side by side,
            # or a flat multi-pin block in a frame
            z0 = 0.011
            def round_one(cx, cy, r):
                soup('mech', par).box((r * 2.6, r * 2.6, 0.006), at(cx, cy, z0), R)                       # its flange
                for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    b0 = at(cx + x * r * 1.05, cy + y * r * 1.05, z0 + 0.003)
                    soup('bolt', par).cyl(0.0032, b0, b0 + n * 0.003, 6)
                soup('steel', par).cyl(r, at(cx, cy, z0), at(cx, cy, z0 + 0.026), 18)                  # the shell
                soup('steel', par).cyl(r * 1.22, at(cx, cy, z0 + 0.008), at(cx, cy, z0 + 0.02), 12)     # the nut
                soup('dark', par).cyl(r * 0.78, at(cx, cy, z0 + 0.026), at(cx, cy, z0 + 0.029), 18)     # its face
                for k in range(5):
                    a = k * 2 * math.pi / 5
                    p0 = at(cx + math.cos(a) * r * 0.42, cy + math.sin(a) * r * 0.42, z0 + 0.027)
                    soup('bolt', par).cyl(0.0022, p0, p0 + n * 0.004, 5)
            pick = plug.random()
            r = min(0.03, min(w, h) * 0.12)
            if pick < 0.45:
                round_one(w * 0.18, h * 0.12, r)
            elif pick < 0.75:
                round_one(-w * 0.2, h * 0.1, r * 0.85)
                round_one(w * 0.2, h * 0.1, r * 0.85)
            else:
                bw, bh = min(0.13, w * 0.5), min(0.035, h * 0.18)
                soup('steel', par).box((bw + 0.012, bh + 0.012, 0.01), at(0, h * 0.15, z0 + 0.003), R)
                soup('dark', par).box((bw, bh, 0.012), at(0, h * 0.15, z0 + 0.004), R)
                k = max(4, int(bw / 0.011))
                for row in (-1, 1):
                    for i in range(k):
                        p0 = at(-bw / 2 + bw * (i + 0.5) / k, h * 0.15 + row * bh * 0.22, z0 + 0.01)
                        soup('bolt', par).box((0.003, 0.003, 0.006), p0, R)
        elif kind == 'slot':
            soup('dark', par).box((w, h, 0.01), at(0, 0, 0.0), R)
            b = 0.014
            for (cx, cy, sx, sy) in ((0, (h + b) / 2, w + 2 * b, b), (0, -(h + b) / 2, w + 2 * b, b), (-(w + b) / 2, 0, b, h), ((w + b) / 2, 0, b, h)):
                soup('steel', par).box((sx, sy, 0.014), at(cx, cy, 0.002), R)
        elif kind == 'vent':
            soup('dark', par).box((w, h, 0.012), at(0, 0, 0.0), R)
            b = 0.018
            for (cx, cy, sx, sy) in ((0, (h + b) / 2, w + 2 * b, b), (0, -(h + b) / 2, w + 2 * b, b), (-(w + b) / 2, 0, b, h), ((w + b) / 2, 0, b, h)):
                soup('mech', par).box((sx, sy, 0.02), at(cx, cy, 0.004), R)
            for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                b0 = at(x * (w / 2 + b / 2), y * (h / 2 + b / 2), 0.014)
                soup('bolt', par).cyl(0.0045, b0, b0 + n * 0.0035, 6)
            k = max(3, int(h / 0.03))
            for i in range(k):
                y = -h / 2 + h * (i + 0.5) / k
                soup('mech', par).box((w, h / k * 0.9, 0.006), at(0, y, 0.008), R @ Matrix.Rotation(-0.5, 4, 'X'))
        elif kind == 'tag':
            soup('block', par).box((w, h, 0.012), at(0, 0, 0.002), R)
            for x in (-w * 0.25, w * 0.25):
                soup('led', par).box((0.012, 0.012, 0.006), at(x, -h * 0.15, 0.011), R)

    # the hinge: knuckles on the line, the door's and the pod's taking turns, a leaf from each onto its side
    door_y = sum((DOOR_INV @ f.calc_center_median()).y for f in hull.faces if plate_of(f) in DOOR)
    sgn = 1 if door_y > 0 else -1
    L = (H0 - H1).length
    for i, z in enumerate((-0.42, -0.3, -0.1, 0.02, 0.22, 0.34)):
        z0, z1 = z * L, (z + 0.1) * L
        if i % 2 == 0:
            soup('steel', door).cyl(0.032, (0, 0, z0), (0, 0, z1), 14)
            soup('steel', door).box((0.016, 0.12, (z1 - z0) * 0.9), Vector((0.012, sgn * 0.07, (z0 + z1) / 2)))
        else:
            m = DOOR_M
            soup('steel', pod).cyl(0.032, m @ Vector((0, 0, z0)), m @ Vector((0, 0, z1)), 14)
            soup('steel', pod).box((0.016, 0.12, (z1 - z0) * 0.9), m @ Vector((0.012, -sgn * 0.07, (z0 + z1) / 2)), DOOR_M.to_3x3().to_4x4())
    mats = {'steel': STEEL, 'dark': DARK, 'mech': MECH, 'block': BLOCK, 'led': LED, 'bolt': BOLT}
    for (kind, _), (sp, par) in soups.items():
        sp.done('detail_%s_%s' % (kind, par.name), mats[kind], par, None, 0 if kind in ('led', 'bolt') else 0.004)
    for name, (sp, par, _) in hatches.items():
        PLATES.append(sp.done('hatches_' + name, PAINT, par, None, 0.004))


def bolts(clear):
    """Bolts round every panel, a little in from its edge, one every 13 cm or so along it: a hex head on a washer,
    only where it lands flat on its own panel, not too near another edge (at the corners) or the window."""
    rnd = random.Random(31)
    EVERY, IN = 0.13, 0.026
    soups, count = {}, 0
    for P in RIMS:
        M = P['transform'].inverted() if P['transform'] else Matrix.Identity(4)
        sp = soups.setdefault(P['parent'].name, ([], P['parent']))[0]
        segs = [(a, b) for loop in P['loops'] for a, b, _, _ in loop]
        def near_edge(q):
            for a, b in segs:
                ab = b - a; t = max(0.0, min(1.0, (q - a).dot(ab) / max(ab.length_squared, 1e-12)))
                if (a + ab * t - q).length < IN * 0.75: return True
            return False
        for loop in P['loops']:
            total = sum((b - a).length for a, b, _, _ in loop)
            if total < 0.3: continue
            k = max(3, round(total / EVERY)); step = total / k
            marks = [rnd.uniform(0, step) + i * step for i in range(k)]
            acc, j = 0.0, 0
            for a, b, inward, n in loop:
                L = (b - a).length
                while j < len(marks) and marks[j] <= acc + L:
                    q = a + (b - a) * ((marks[j] - acc) / max(L, 1e-9)) + inward * IN
                    j += 1
                    got = BVH.ray_cast(M @ (q + n * 0.25), (M.to_3x3() @ -n).normalized(), 0.5)
                    if got[0] is None: continue
                    local = M.inverted() @ got[0]
                    if abs((local - q).dot(n)) > 0.012: continue
                    if plate_of(hull.faces[got[2]]) != P['name']: continue
                    if tuple((local - co).dot(no) > 0 for co, no in P['planes']) != P['key']: continue
                    if any((got[0] - c).length < r for c, r in clear): continue
                    if near_edge(q): continue
                    p = q + n * P['thick']
                    sp.append((p, n))   # one small hex head here, nearly flush: drawn on the web side, instanced
                    count += 1
                acc += L
    # not geometry: where each bolt goes, on an empty, for the web side to draw them all as one instanced mesh
    # (449 copies of one small hexagon were a sixth of the glb)
    for name, (sp, par) in soups.items():
        empty('bolts_' + name, Vector((0, 0, 0)), None, par, 0.05, at=placements(sp))
    return count


# ---------------------------------------------------------------- a window in the hatch

def window():
    """Not on the sheet: a window high in the hatch, dirty frosted glass in a low frame, let in near flush so the
    hatch still reads as one leaning slab. Behind it a dark
    board of diodes, most off, a few lit; through the glass only their glow comes, blurred. Built flat in the
    hatch's own plane, around where the front view's pixel (478, 278) lands."""
    T_DOOR = THICK['door']
    h = hit('front', 478, 278)
    F = frame_at(h[1])
    R = F.to_4x4()
    k = sheet.scale('front') / abs(h[1].dot(VIEW_DIRS['front']))   # the hatch is turned: a pixel is wider on it
    W, H = 52 * sheet.scale('front') / 0.87, 211 * sheet.scale('front')   # the glass, metres
    def at(u, v, w): return h[0] + F @ Vector((u, v, T_DOOR + w))
    frame, back, glass = Soup(), Soup(), Soup()
    lit = {'amber': Soup(), 'red': Soup(), 'green': Soup(), 'off': Soup()}
    b = 0.03                                   # the frame's width
    for (cu, cv, su, sv) in ((0, (H + b) / 2, W + 2 * b, b), (0, -(H + b) / 2, W + 2 * b, b),
                             (-(W + b) / 2, 0, b, H), ((W + b) / 2, 0, b, H)):
        frame.box((su, sv, 0.024), at(cu, cv, 0.004), R)
    back.box((W, H, 0.004), at(0, 0, 0.002), R)
    glass.box((W, H, 0.004), at(0, 0, 0.012), R)
    # the board: three columns of diodes; which are lit is fixed, not random, so every build is the same
    pattern = 'aoaoooaoo' 'ooraoooao' 'aoogoaooa' 'oaooaoroo' 'ooaoooaoo' 'aooaoogoa' 'oooaoaooo' 'aoooraooa' 'ooaoooaoo'
    i = 0
    for row in range(9):
        for col in range(3):
            u, v = (col - 1) * W * 0.3, H / 2 - H * (row + 0.5) / 9
            kind = {'a': 'amber', 'r': 'red', 'g': 'green', 'o': 'off'}[pattern[i % len(pattern)]]
            lit[kind].box((0.016, 0.016, 0.004), at(u, v, 0.006), R)
            i += 1
    frame.done('door_frame', STEEL, door, DOOR_INV, 0.006)
    back.done('door_board', DARK, door, DOOR_INV, 0)
    for kind, material in (('amber', LED), ('red', LED_RED), ('green', LED_GREEN), ('off', MECH)):
        lit[kind].done('door_diodes_' + kind, material, door, DOOR_INV, 0)
    glass.done('door_window', FROST, door, DOOR_INV, 0.001)


# ---------------------------------------------------------------- the deck on top, where the cables go in

def deck():
    tops = [f for f in hull.faces if plate_of(f) == 'open' and f.normal.z > 0.85]
    c = sum((f.calc_center_median() for f in tops), Vector()) / len(tops)
    m, brass = Soup(), Soup()
    m.box((0.5, 0.4, 0.08), c + Vector((0, 0.02, 0.0)))
    # (the nine ports that stood here, where the cables came in, are gone: the cables all come in at the back, onto
    # the hoses' upper ends; the deck is a plain cover)
    ports = []
    m.done('deck', MECH, pod, None, 0.005)
    brass.bm.free()
    lamps = Soup()
    for x in (-0.12, 0.12):
        lamps.box((0.03, 0.012, 0.05), c + Vector((x, -0.26, 0.04)))
    lamps.done('deck_lamps', LED, pod, None, 0)
    return ports, c


# ---------------------------------------------------------------- under it

def underside():
    """the bottom is open machinery: a frame round a sunk block, ribs, a ring of boxes, hoses under it"""
    m, hose, lamps = Soup(), Soup(), Soup()
    under = [f for f in hull.faces if plate_of(f) == 'open' and f.normal.z < -0.85]
    c = sum((f.calc_center_median() for f in under), Vector()) / max(1, len(under))
    zb = min(v.co.z for v in hull.verts)
    m.box((0.62, 0.5, 0.06), Vector((c.x, c.y, zb - 0.01)))            # the frame
    m.box((0.34, 0.24, 0.05), Vector((c.x, c.y - 0.02, zb - 0.055)))    # the block sunk in it
    for dx in (-0.2, -0.07, 0.07, 0.2):                                  # ribs across
        m.box((0.035, 0.62, 0.04), Vector((c.x + dx, c.y, zb - 0.025)))
    for a, rx, ry in ((0.6, 0.42, 0.32), (2.5, 0.42, 0.32), (3.8, 0.4, 0.3), (5.6, 0.4, 0.3)):
        m.box((0.14, 0.12, 0.08), Vector((c.x + rx * math.cos(a), c.y + ry * math.sin(a), zb + 0.0)))
    for x in (-0.3, 0.3):
        hose.tube([Vector((c.x + x, c.y - 0.3, zb + 0.02)), Vector((c.x + x * 1.05, c.y, zb - 0.03)), Vector((c.x + x, c.y + 0.3, zb + 0.02))], 0.035)
    for x in (-0.11, 0.11):
        lamps.box((0.05, 0.02, 0.012), Vector((c.x + x, c.y - 0.15, zb - 0.083)))
    m.done('under', MECH, pod, None, 0.006)
    hose.done('under_hoses', HOSE, pod, None, 0)
    lamps.done('under_lamps', LED, pod, None, 0)
    return Vector((c.x - 0.15, c.y + 0.1, zb - 0.09))


# ---------------------------------------------------------------- markings

# the Mac's own face, San Francisco, bold (SF Pro if it is installed, else the system's; else Blender's Inter)
fonts = next((f for f in ('/Library/Fonts/SF-Pro-Display-Bold.otf', os.path.expanduser('~/Library/Fonts/SF-Pro-Display-Bold.otf'), '/System/Library/Fonts/SFNS.ttf',
                          os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources', '%d.%d' % bpy.app.version[:2], 'datafiles', 'fonts', 'Inter.woff2'))
              if os.path.exists(f)), None)
FONT = bpy.data.fonts.load(fonts, check_existing=True) if fonts else None

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
    def svg(self, path, width, where):
        """a drawing from an svg file, centred on where, so wide"""
        before, cols = set(bpy.data.objects), set(bpy.data.collections)
        bpy.ops.import_curve.svg(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        bm = bmesh.new()
        for o in new:
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); me.transform(o.matrix_world)
            bm.from_mesh(me); bpy.data.meshes.remove(me)
        for o in new:
            cu = o.data; bpy.data.objects.remove(o); bpy.data.curves.remove(cu)
        for c in set(bpy.data.collections) - cols: bpy.data.collections.remove(c)
        xs, ys = [v.co.x for v in bm.verts], [v.co.y for v in bm.verts]
        k = width / (max(xs) - min(xs))
        c = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, 0))
        bmesh.ops.transform(bm, matrix=Matrix.Diagonal((k, k, k, 1)) @ Matrix.Translation(-c), verts=bm.verts)
        me = bpy.data.meshes.new('svg'); bm.to_mesh(me); bm.free()
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
        at = place(*((a[1], a[2]) if kind in ('text', 'svg') else (a[0], a[3]) if kind in ('rect', 'icon', 'bars', 'slash', 'tri', 'vee') else (a[0], a[1])))
        if at is None: continue
        if kind == 'text':
            body, x, y, cap, bold = a
            ink.text(body, cap * k / 0.727, at, bold=bold, spacing=1.12)
        elif kind == 'svg': ink.svg(a[0], a[3] * k, at)
        elif kind == 'rect': ink.rect(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at)
        elif kind == 'cross': ink.cross(0, 0, a[2] * k, at)
        elif kind == 'split': ink.split_disc(0, 0, a[2] * k, at @ Matrix.Rotation(0.45, 4, 'Z'))
        elif kind == 'icon': ink.icon(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at)
        elif kind == 'bars': ink.bars(0, 0, (a[2] - a[0]) * k, (a[3] - a[1]) * k, at, a[4])
        elif kind == 'tri':
            w, h = (a[2] - a[0]) * k, (a[3] - a[1]) * k
            ink.poly([(0, 0), (w, 0), (w / 2, h)], at)
        elif kind == 'vee':
            w, h, t = (a[2] - a[0]) * k, (a[3] - a[1]) * k, (a[2] - a[0]) * k * 0.18
            ink.poly([(0, h), (t, h), (w / 2, t * 1.4), (w - t, h), (w, h), (w / 2, 0)], at)
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
        ('text', 'DAY-20', 405, 384, 36, 0.0),   # (the only words on it: every other text was taken off)
        ('icon', 445, 460, 492, 530), ('bars', 505, 460, 570, 530, 3),   # (the bars kept this side of the seam)
        ('cross', 418, 582, 22), ('cross', 456, 588, 22), ('cross', 446, 624, 24),
        ('cross', 310, 265, 30)], shift=-45)
    # and on the right flank, slid back onto the flank proper: where the side view has it, it would sit on
    # the corner and show from the front, which the front view does not
    lay(ink, 'left', (210, 380), [
        ('text', 'DAY-20', 210, 384, 36, 0.0),
        ('icon', 160, 462, 212, 530), ('bars', 225, 462, 322, 530, 3),
        ('cross', 290, 621, 28), ('cross', 430, 268, 30)], shift=60)
    # the marks on the caps
    lay(ink, 'front', (245, 140), [('split', 245, 140, 32)])
    # (the side view's own mark here landed on the same facet as the front view's, and the two made a blot)
    lay(ink, 'left', (298, 172), [('split', 298, 172, 28)])
    # low on the right of the front
    lay(ink, 'front', (505, 728), [('slash', 476, 722, 486, 758)])
    # the maker's plate on the spine
    lay(ink, 'back', (240, 500), [('tri', 240, 486, 254, 500), ('tri', 316, 486, 330, 500)], out=0.08)
    lay(ink, 'back', (270, 760), [('vee', 270, 728, 294, 752)], out=0.085)
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


def mount(top):
    """What it hangs by, all of it at the back: a plate bolted to the spine's head, two cheeks standing off it and
    up past the top of the pod, a pin through them. The hoist's block locks onto the pin (drawn on the web side);
    no eyes, no slings. Returns the pin's middle. (It hung by four lugs on its shoulders and slings to a ring: that
    read as rigged up for the day.)"""
    steel, base = Soup(), Soup()
    B, Z = VIEW_DIRS['back'], Vector((0, 0, 1))
    X = Z.cross(B).normalized()
    k = sheet.scale('back')
    h = block(base, 'back', 226, 100, 329, 200, 0.1)
    p = h[0]
    zt = top.z - p.z + 0.14                      # the pin, over the top of the pod
    def at(x, d, z): return p + X * x + B * d + Z * z
    for x in (-0.17, 0.17):                       # bolts down both edges of the plate
        for z in (-0.14, -0.05, 0.05, 0.14):
            steel.cyl(0.016, at(x, 0.1, z), at(x, 0.118, z), 6)
    # the cheeks: one outline, cut from plate
    side = [(0.05, -0.17), (0.17, -0.17), (0.33, zt - 0.2), (0.33, zt + 0.05), (0.27, zt + 0.12), (0.15, zt + 0.12),
            (0.09, zt + 0.05), (0.05, zt - 0.25)]
    for x in (-0.11, 0.11):
        a = [steel.bm.verts.new(at(x - 0.02, d, z)) for d, z in side]
        b = [steel.bm.verts.new(at(x + 0.02, d, z)) for d, z in side]
        n = len(side)
        for i in range(n): steel.bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        steel.bm.faces.new(list(reversed(a))); steel.bm.faces.new(b)
    bmesh.ops.recalc_face_normals(steel.bm, faces=steel.bm.faces[:])
    # the pin, a collar on each end; a tube between the cheeks lower down, and a web across their backs
    eye = at(0, 0.21, zt)
    steel.cyl(0.036, at(-0.17, 0.21, zt), at(0.17, 0.21, zt), 16)
    for x in (-1, 1): steel.cyl(0.055, at(0.13 * x, 0.21, zt), at(0.155 * x, 0.21, zt), 16)
    steel.cyl(0.03, at(-0.11, 0.17, 0.05), at(0.11, 0.17, 0.05), 12)
    steel.box((0.2, 0.025, max(0.1, zt - 0.3)), at(0, 0.3, (zt - 0.3) / 2 + 0.02),
              Matrix((X, B, Z)).transposed().to_4x4())
    base.done('mount_plate', MECH, pod, None, 0.008)
    steel.done('mount', STEEL, pod, None, 0.005)
    return eye, k


def hooks(ports, top, drip_seam, drip_under, eyes):
    # straight above the pin it hangs by, at its back; and it hangs plumb all the same
    hang = Vector((eyes[0].x, eyes[0].y, top.z + 7.2))
    ports = sorted(ports, key=lambda t: -t[0].x)   # (round the arc in the order they stand, so no two cross)
    for i, (p, d, r) in enumerate(ports):
        # they hang slack: the hoses carry nothing
        empty('plug.%03d' % i, p, d, pod, radius=r, slack=1.08 + 0.1 * ((i * 37) % 5) / 4)
        # (in an arc over the back, where they all go down to: none comes across the top of the pod)
        a = math.pi / 2 + (i / max(1, len(ports) - 1) - 0.5) * math.pi * 1.15
        empty('socket.%03d' % i, hang + Vector((1.5 * math.cos(a), 0.1 + 1.5 * math.sin(a), 0.4 * math.sin(3 * a))), (0, 0, -1))
    for i, e in enumerate(eyes):
        empty('lift.%03d' % i, e, (0, 0, 1), pod, size=0.1)
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
    scene.world.light_settings.distance = 0.22

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

    # grime: heavier towards the foot (the pod's own up is its object Z), dust settled on what faces up
    tc = node('ShaderNodeTexCoord')
    nz = node('ShaderNodeSeparateXYZ'); K.new(tc.outputs['Normal'], nz.inputs[0])
    pz = node('ShaderNodeSeparateXYZ'); K.new(P, pz.inputs[0])
    low = ramp(pz.outputs['Z'], 0.2, -1.3)
    dirt = op('ADD', dirt, op('MULTIPLY', low, op('MULTIPLY', ramp(noise(mapping(P, (6, 6, 1.5)), 1.0, 4, 0.6), 0.35, 0.7), 0.6)), True)
    dust = op('MULTIPLY', ramp(nz.outputs['Z'], 0.35, 0.85), ramp(noise(P, 6, 4, 0.6), 0.3, 0.6))
    # Only what is soft is baked: the white, where the dirt lies in broad patches, the dust on what faces up. At
    # 2.4 mm a texel anything fine (chips, scratches, specks) came out as mush; all of that is drawn on the web
    # side (materials.ts), sharp at any distance, from the edge mask and the AO that go out with the textures
    colour = mix(op('MULTIPLY', dirt, 0.34), (0.74, 0.74, 0.72), (0.3, 0.27, 0.23))
    colour = mix(op('MULTIPLY', dust, 0.4), colour, (0.55, 0.52, 0.47))
    rough = op('ADD', op('ADD', 0.42, op('MULTIPLY', dirt, 0.3)), op('MULTIPLY', dust, 0.25))
    _unused = (speck, scratch, chip)

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
    flat = [o for o in col.objects if o.name in ('marks', 'door_marks', 'decals', 'blood', 'door_window')]
    for o in flat: o.hide_render = True  # a hair above the plate, they would shadow it black
    c = bake('b_colour', colour)
    r = bake('b_rough', rough)[:, :, :1]
    mt = bake('b_metal', edge)[:, :, :1]   # (not metal: how near a panel's edge, 0..1, for the web side's chips)
    scene.cycles.samples = 48
    ao = np.clip(bake('b_ao', None, 'AO')[:, :, :1], 0, 1)
    for o in flat: o.hide_render = False

    # (the AO goes out in the ORM's red, not into the colour: the web side darkens with it, and can leave it off)
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


def bake_vertex_ao(skip):
    """The dark in the corners for everything on the pod but the plates (whose paint has it baked in): an AO bake
    to a colour on each vertex, the web side darkens with it. One bake for all of them, the modifiers applied first
    so the colours land on the vertices that are exported."""
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    if not scene.world: scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = 0.22
    def on_pod(o):
        while o:
            if o in (pod, door): return True
            o = o.parent
        return False
    objs = [o for o in col.objects if o.type == 'MESH' and on_pod(o) and o.name not in skip and not o.name.startswith('door_diodes')]
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        old = o.data; o.modifiers.clear(); o.data = me
        if old.users == 0: bpy.data.meshes.remove(old)
        attr = me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = attr
        me.attributes.active_color = attr
    hidden = [o for o in col.objects if o.name in skip and o.type == 'MESH' and o.name not in ('plates', 'door_plates')]
    for o in hidden: o.hide_render = True  # (a hair above the surface: they would shadow it black)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    for o in hidden: o.hide_render = False
    return len(objs)


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
    window()
    keep_clear = [(Vector(hit('front', 478, 278)[0]), 0.55)]
    details(keep_clear)
    result['bolts'] = bolts(keep_clear)
    ports, top = deck()
    ports += [(p, Vector((0, 0.25, 1)).normalized(), r) for p, r in hose_tops]
    under = underside()
    # the markings, back on: the 03s, the texts, crosses, stripes, the split disc, the hatch's squares, UEC, the
    # warning marks (they were taken off for a while)
    markings()
    seam_drip = blood()
    inside()
    eye, back_scale = mount(top)
    result['mount'] = [round(v, 3) for v in (*eye, top.z, back_scale)]
    hooks(ports, top, seam_drip, under, [eye])
    # it hangs straight. (It once hung askew as the hall picture has it, head to the left by 24 degrees, and that
    # read as wrong)
    pod.rotation_euler = (0, 0, 0)

if STAGE == 'all':
    on_body, on_door = [o for o in PLATES if o.parent == pod], [o for o in PLATES if o.parent == door]
    body_plates = freeze(on_body, 'plates', pod)
    door_plates = freeze(on_door, 'door_plates', door)
    baked = bake_paint([body_plates, door_plates]) if BAKE else None
    if BAKE: result['vertex_ao'] = bake_vertex_ao({'plates', 'door_plates', 'marks', 'door_marks', 'decals', 'blood', 'door_window'})
    os.makedirs(os.path.join(ROOT, 'public'), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects: o.select_set(True)
    bpy.context.view_layer.objects.active = pod
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'public', 'cocoon.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_extras=True, export_image_format='AUTO',
                              export_vertex_color='ACTIVE')
    bpy.ops.wm.save_mainfile()
    tris = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in col.objects:
        if o.type == 'MESH':
            e = o.evaluated_get(dg).to_mesh(); e.calc_loop_triangles(); tris += len(e.loop_triangles)
    result.update(objects=len(col.objects), tris=tris, glb_kb=os.path.getsize(os.path.join(ROOT, 'public', 'cocoon.glb')) // 1024, baked=baked)
print('RESULT', result)
