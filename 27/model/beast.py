# What lives further in: a low burrowing mammal with a deep-sea fish's mouth, built parametrically, rigged and
# animated, for public/beast.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 27/model/beast.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 27/model/beast.py -- render   # and process/beast-*.png
#   ... -- blockout   only the fused hide in clay, no teeth, claws or rig, and its three views
#   ... -- crawl      build, export, and only the crawl's frames (process/beast-crawl-*.png)
#
# How it is made. Everything is written in the page's axes (metres, Y up, facing +Z, origin on the ground under
# the chest) and turned into Blender's (Z up, facing -Y) on the way in; the exporter turns it back.
#   1. The hide is a pile of closed shapes that overlap (lofts, capsules, ellipsoids): body, skull with a
#      vaulted palate, lower jaw with a trough, lips, limbs, paws, knobs. A voxel remesh fuses them into one
#      skin, which is smoothed (the body more, the head less) and decimated.
#   2. Every vertex of that skin asks the pile which shape it came from, and gets from the answer its material,
#      colour, fur weight and bones. Those are then smoothed over the mesh, so they blend where shapes met.
#   3. Teeth, claws, eyes and tongue are added as they are, rigid on their bones.
#   4. The armature, and six clips baked a key per frame from small pose functions. The legs are solved here
#      (two bones and a pole), so planted paws stay planted while the body moves over them.
#
# The bind pose is the idle one: crouched flat, elbows out, the mouth a third open (35 degrees).
#
# In the file: one mesh, a primitive per material (skin, fur_base, mouth, teeth, claws, eye, all untextured and
# white, the tone is in COLOR_0, linear), `_FUR` a float per vertex (1 where fur grows, 0 on head, mouth, paws
# and the ridge down the back), JOINTS_0/WEIGHTS_0 (four influences), and the clips idle, crouch, leap, bite,
# land, crawl, sampled at 60 a second.

import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'public', 'beast.glb'))
PROC = os.path.abspath(os.path.join(HERE, '..', 'process'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
BLOCKOUT = 'blockout' in ARGS
RENDER = 'render' in ARGS
TAU = math.pi * 2
rnd = random.Random(27)

VOXEL = 0.0034        # the remesh grid
SKIN_TRIS = 21000     # the fused skin after decimation
FPS = 60


def B(v):
    """page axes (x left, y up, z forward) to Blender's (x, -z, y)"""
    return Vector((v[0], -v[2], v[1]))


def V(*a):
    return np.array(a, dtype=float)


def unit(v):
    return v / np.linalg.norm(v)


def ss(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def spline(keys, u):
    """Catmull-Rom through rows of numbers, u in 0..len-1"""
    n = len(keys)
    i = min(n - 2, max(0, int(math.floor(u))))
    f = u - i
    p0, p1, p2, p3 = (np.array(keys[min(n - 1, max(0, j))], dtype=float) for j in (i - 1, i, i + 1, i + 2))
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


# ---- the measures ----------------------------------------------------------------------------------------------
X = V(1, 0, 0)
HINGE = V(0, 0.100, 0.100)            # the jaw's hinge, far back, inside the front of the body
NECK = V(0, 0.112, 0.085)             # where the head turns
SKULL_A = math.radians(9)             # the skull's tooth line, tipped up
JAW_A = math.radians(-26)             # the lower jaw's, hanging: 35 degrees between them at rest
REST_GAPE = 35.0
SKULL_LEN, JAW_LEN = 0.140, 0.160     # the lower jaw is the longer, its fangs pass in front of the snout

# body: z, centre height, half width, height above the centre, below it
BODY = [
    (-0.335, 0.098, 0.030, 0.030, 0.030),
    (-0.310, 0.102, 0.072, 0.066, 0.060),
    (-0.250, 0.108, 0.100, 0.086, 0.076),
    (-0.150, 0.112, 0.107, 0.088, 0.082),
    (-0.030, 0.113, 0.105, 0.087, 0.083),
    (0.050, 0.116, 0.098, 0.084, 0.080),
    (0.100, 0.114, 0.078, 0.064, 0.064),
    (0.130, 0.106, 0.045, 0.042, 0.040),
]
# skull: along the tooth line from the hinge, half width, height above the tooth line. Tall and blunt, a
# fangtooth's rather than a snout
SKULL = [(-0.040, 0.050, 0.050), (0.0, 0.072, 0.072), (0.036, 0.072, 0.071), (0.076, 0.062, 0.058), (0.112, 0.050, 0.043), (SKULL_LEN, 0.040, 0.030)]
# jaw: along its tooth line, half width, depth below it. Narrower than the skull all the way, so the upper
# teeth pass outside it, and a narrow chin, so the four upper fangs pass beside it
JAW = [(-0.035, 0.044, 0.034), (0.0, 0.063, 0.048), (0.045, 0.058, 0.041), (0.090, 0.040, 0.031), (0.128, 0.0170, 0.022), (JAW_LEN, 0.0115, 0.015)]
PALATE, TROUGH = 0.42, 0.34           # how far the palate is vaulted and the jaw hollowed, of their heights

# limbs, the left one (+x); the right is mirrored
SHOULDER, ELBOW, WRIST, KNUCKLE = V(0.070, 0.118, 0.050), V(0.112, 0.088, 0.030), V(0.100, 0.030, 0.125), V(0.100, 0.018, 0.176)
HIP, KNEE, ANKLE, TOE = V(0.060, 0.105, -0.250), V(0.105, 0.065, -0.175), V(0.100, 0.030, -0.255), V(0.105, 0.012, -0.190)
TAIL0, TAIL1 = V(0, 0.100, -0.322), V(0, 0.086, -0.360)
EYE_S, EYE_U, EYE_V, EYE_R = 0.048, 0.0615, 0.033, 0.0145


def frame(angle):
    """a jaw's own axes: along the tooth line, and square to it upwards"""
    return V(0, math.sin(angle), math.cos(angle)), V(0, math.cos(angle), -math.sin(angle))


SK_F, SK_N = frame(SKULL_A)
JW_F, JW_N = frame(JAW_A)


def skull_pt(s, u, v):
    return HINGE + SK_F * s + SK_N * v + V(u, 0, 0)


def jaw_pt(s, u, v):
    return HINGE + JW_F * s + JW_N * v + V(u, 0, 0)


def table(rows, s):
    """a section table read at s (its first column), linear"""
    if s <= rows[0][0]:
        return np.array(rows[0][1:], dtype=float)
    for a, b in zip(rows, rows[1:]):
        if s <= b[0]:
            return lerp(np.array(a[1:], dtype=float), np.array(b[1:], dtype=float), (s - a[0]) / (b[0] - a[0]))
    return np.array(rows[-1][1:], dtype=float)


def body_at(z):
    """centre height, half width, up, down at z, as the loft has it"""
    zs = [r[0] for r in BODY]
    for i in range(len(zs) - 1):
        if z <= zs[i + 1] or i == len(zs) - 2:
            f = min(1.0, max(0.0, (z - zs[i]) / (zs[i + 1] - zs[i])))
            return spline(BODY, i + f)[1:]


def eye(sx):
    """an eye's centre and the way it looks: out, a little forward and up"""
    return skull_pt(EYE_S, sx * EYE_U, EYE_V), unit(V(sx * 1.0, 0.22, 0.40))


def finger(i, sx):
    """a forepaw's finger, base and tip: four, fanned. 0 is the inner one"""
    k = i - 1.5
    yaw = math.radians(9 * k)
    p0 = V(sx * (0.100 + 0.0170 * k), 0.0170, 0.170 - 0.004 * abs(k))
    d = V(sx * math.sin(yaw), -0.10, math.cos(yaw))
    return p0, p0 + unit(d) * 0.024


def toe(i, sx):
    k = i - 1.5
    yaw = math.radians(8 * k)
    p0 = V(sx * (0.104 + 0.0115 * k), 0.0115, -0.186 - 0.003 * abs(k))
    return p0, p0 + unit(V(sx * math.sin(yaw), -0.08, math.cos(yaw))) * 0.014


# ---- the pile of shapes ------------------------------------------------------------------------------------------
PARTS = {}


def part_id(name):
    return PARTS.setdefault(name, len(PARTS))


class Pile:
    """closed shapes, each vertex knowing its part, how far along it (0..1) and whether it faces into the mouth"""

    def __init__(self):
        self.v, self.f, self.part, self.t, self.inside = [], [], [], [], []

    def rings(self, rings, part, caps=(None, None)):
        """rings: lists of (position, t, inside), all the same length; caps: a point to fan each end to"""
        pid = part_id(part)
        base = len(self.v)
        n = len(rings[0])
        for ring in rings:
            for p, t, ins in ring:
                self.v.append(tuple(p)); self.part.append(pid); self.t.append(t); self.inside.append(ins)
        for i in range(len(rings) - 1):
            for j in range(n):
                a, b = base + i * n + j, base + i * n + (j + 1) % n
                self.f.append((a, b, b + n, a + n))
        for end, cap in enumerate(caps):
            if cap is None:
                continue
            ring = rings[-1] if end else rings[0]
            ring0 = base + (len(rings) - 1) * n * end
            c = len(self.v)
            self.v.append(tuple(cap)); self.part.append(pid); self.t.append(ring[0][1]); self.inside.append(0)
            for j in range(n):
                self.f.append((ring0 + j, ring0 + (j + 1) % n, c))

    def capsule(self, p0, r0, p1, r1, part, n=18, t0=0.0, t1=1.0):
        """a tapered capsule, t running t0..t1 from p0 to p1"""
        d = p1 - p0
        L = np.linalg.norm(d)
        d = d / L
        ax = unit(np.cross(d, V(0, 1, 0) if abs(d[1]) < 0.9 else V(1, 0, 0)))
        ay = np.cross(d, ax)
        rows = []
        for k in range(1, 5):            # the cap at p0
            ph = math.radians(90 - 22.5 * k)
            rows.append((p0 - d * r0 * math.sin(ph), r0 * math.cos(ph), t0))
        for k in range(1, 6):
            f = k / 6
            rows.append((p0 + d * L * f, lerp(r0, r1, f), lerp(t0, t1, f)))
        for k in range(0, 4):            # the cap at p1
            ph = math.radians(22.5 * k)
            rows.append((p1 + d * r1 * math.sin(ph), r1 * math.cos(ph), t1))
        rings = [[(c + (ax * math.cos(TAU * j / n) + ay * math.sin(TAU * j / n)) * r, t, 0) for j in range(n)] for c, r, t in rows]
        self.rings(rings, part, caps=(p0 - d * r0, p1 + d * r1))

    def ellipsoid(self, c, radii, part, axes=None, n=16, m=10, t=0.0):
        ax = axes if axes is not None else (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1))
        rings = []
        for i in range(1, m):
            ph = math.pi * i / m
            rings.append([(c + ax[0] * radii[0] * math.sin(ph) * math.cos(TAU * j / n) + ax[1] * radii[1] * math.sin(ph) * math.sin(TAU * j / n) + ax[2] * radii[2] * math.cos(ph), t, 0) for j in range(n)])
        self.rings(rings, part, caps=(c + ax[2] * radii[2], c - ax[2] * radii[2]))

    def torus(self, c, axis, R, r, part, n=20, m=8, squash=1.0):
        ax = unit(np.cross(axis, V(0, 1, 0)))
        ay = np.cross(axis, ax)
        rings = []
        for i in range(n + 1):
            a = TAU * i / n
            out = ax * math.cos(a) + ay * math.sin(a)
            rings.append([(c + out * (R + r * math.cos(TAU * j / m)) + axis * r * squash * math.sin(TAU * j / m), 0.0, 0) for j in range(m)])
        self.rings(rings, part)


def build_pile():
    P = Pile()
    N = 32

    # the barrel
    rings = []
    steps = (len(BODY) - 1) * 5
    for i in range(steps + 1):
        z, cy, a, bt, bb = spline(BODY, i / 5)
        ring = []
        for j in range(N):
            th = TAU * j / N
            c, s = math.cos(th), math.sin(th)
            u = a * math.copysign(abs(c) ** 0.9, c)
            v = (bt if s >= 0 else bb) * math.copysign(abs(s) ** 0.9, s)
            ring.append((V(u, cy + v, z), 0.0, 0))
        rings.append(ring)
    P.rings(rings, 'body', caps=(V(0, BODY[0][1], BODY[0][0] - 0.012), V(0, BODY[-1][1], BODY[-1][0] + 0.012)))

    # shoulders and haunches, the muscle over each
    for sx, side in ((1, 'L'), (-1, 'R')):
        P.ellipsoid(V(sx * 0.050, 0.148, 0.030), (0.050, 0.046, 0.075), 'shoulder_' + side)
        P.ellipsoid(V(sx * 0.062, 0.112, -0.225), (0.056, 0.062, 0.078), 'haunch_' + side)
    P.capsule(TAIL0, 0.024, TAIL1, 0.010, 'tail')

    # the ridge down the back: bare knobs, a big one and a small one each side, from the skull to the rump
    z, i = -0.305, 0
    while z < 0.094:
        cy, a, bt, bb = body_at(z)
        top = cy + bt
        big = 1.0 + 0.22 * math.sin(i * 2.4)
        P.ellipsoid(V(rnd.uniform(-0.002, 0.002), top - 0.002, z), (0.0105 * big, 0.0090 * big, 0.0145 * big), 'ridge', n=12, m=8)
        for sx in (1, -1):
            P.ellipsoid(V(sx * (0.0170 + rnd.uniform(-0.002, 0.002)), top - 0.0055, z + 0.013), (0.0078, 0.0064, 0.0108), 'ridge', n=10, m=6)
        z += 0.0265
        i += 1

    # skull and jaw: a dome over the tooth line and hollow on the other side of it
    def shell(rows, length, pt, sign, hollow, crown):
        out = []
        steps = (len(rows) - 1) * 5
        for i in range(steps + 1):
            s, a, h = spline(rows, i / 5)
            ring = []
            for j in range(N):
                th = TAU * (j + 0.5) / N
                c, sn = math.cos(th), math.sin(th)
                u = a * math.copysign(abs(c) ** 0.95, c)
                if sn >= 0:
                    v, ins = h * min(1.0, crown * sn ** 0.9), 0
                else:
                    v, ins = hollow * h * sn * sn, 1 if sn < -0.10 and i < steps - 1 else 0
                ring.append((pt(s, u, sign * v), s / length, ins))
            out.append(ring)
        return out

    P.rings(shell(SKULL, SKULL_LEN, skull_pt, 1, PALATE, 1.04), 'skull', caps=(skull_pt(SKULL[0][0] - 0.01, 0, 0.02), skull_pt(SKULL_LEN + 0.008, 0, 0.012)))
    P.rings(shell(JAW, JAW_LEN, jaw_pt, -1, TROUGH, 1.0), 'jaw', caps=(jaw_pt(JAW[0][0] - 0.01, 0, -0.012), jaw_pt(JAW_LEN + 0.006, 0, -0.006)))

    # lips: a round gum along each tooth line, which also buries the shells' knife edge
    def lip(rows, length, pt, vv, r0, r1, part, inset):
        for sx in (1, -1):
            pts, k = [], 10
            for i in range(k + 1):
                s = lerp(0.004, length, i / k)
                pts.append((pt(s, sx * (table(rows, s)[0] - inset), vv), lerp(r0, r1, i / k), s / length))
            for (p0, ra, t0), (p1, rb, t1) in zip(pts, pts[1:]):
                P.capsule(p0, ra, p1, rb, part, n=10, t0=t0, t1=t1)
        a = table(rows, length)[0] - inset
        P.capsule(pt(length, a, vv), r1, pt(length, -a, vv), r1, part, n=10, t0=1.0, t1=1.0)

    # the ends of both made solid: the hollow would leave the snout and the chin paper thin
    P.ellipsoid(skull_pt(SKULL_LEN - 0.006, 0, 0.012), (0.034, 0.013, 0.013), 'skull', axes=(X, SK_N, SK_F), n=14, m=8, t=1.0)
    lip(SKULL, SKULL_LEN, skull_pt, -0.002, 0.0064, 0.0054, 'lip_u', 0.0040)
    lip(JAW, JAW_LEN, jaw_pt, 0.002, 0.0060, 0.0050, 'lip_l', 0.0035)

    # the skull's plates: a crest down the middle that runs on into the back's ridge, brows over the eyes, a
    # ridge from brow to snout, a cheek plate, the angle of the jaw
    sk_axes, jw_axes = (X, SK_N, SK_F), (X, JW_N, JW_F)
    for i, s in enumerate((-0.014, 0.010, 0.034, 0.058, 0.082, 0.105)):
        h = table(SKULL, s)[1]
        P.ellipsoid(skull_pt(s, 0, h - 0.002), (0.0090 - 0.0005 * i, 0.0080 - 0.0006 * i, 0.0125), 'plate', axes=sk_axes, n=12, m=8)
    for sx in (1, -1):
        for s, u, v, r in ((0.024, 0.054, 0.058, 0.011), (0.047, 0.057, 0.056, 0.012), (0.070, 0.053, 0.048, 0.010)):
            P.ellipsoid(skull_pt(s, sx * u, v), (r, r * 0.75, r * 1.25), 'plate', axes=sk_axes, n=12, m=8)
        P.capsule(skull_pt(0.078, sx * 0.050, 0.044), 0.0078, skull_pt(0.134, sx * 0.032, 0.027), 0.0056, 'plate', n=10)
        P.ellipsoid(skull_pt(0.030, sx * 0.0690, 0.008), (0.0070, 0.0110, 0.0240), 'plate', axes=sk_axes, n=12, m=8)
        P.ellipsoid(skull_pt(0.085, sx * 0.0565, 0.012), (0.0060, 0.0085, 0.0170), 'plate', axes=sk_axes, n=12, m=8)
        P.ellipsoid(jaw_pt(0.022, sx * 0.058, -0.018), (0.0080, 0.0140, 0.0260), 'plate_j', axes=jw_axes, n=12, m=8)
        P.ellipsoid(jaw_pt(0.075, sx * 0.043, -0.014), (0.0060, 0.0090, 0.0180), 'plate_j', axes=jw_axes, n=12, m=8)
        # the socket: a thick wrinkled lid round the eye, and a fold outside that
        c, ax = eye(sx)
        P.torus(c + ax * 0.0040, ax, EYE_R - 0.0006, 0.0056, 'socket')
        P.torus(c - ax * 0.0030, ax, EYE_R + 0.0080, 0.0046, 'socket', squash=0.8)
    P.ellipsoid(jaw_pt(0.150, 0, -0.012), (0.0100, 0.0080, 0.0130), 'plate_j', axes=jw_axes, n=12, m=8)   # the chin

    for sx in (1, -1):
        side = 'L' if sx > 0 else 'R'
        mx = V(sx, 1, 1)
        # foreleg: out and down to the elbow, forward and down to the wrist, a broad flat paw
        P.capsule(SHOULDER * mx, 0.040, ELBOW * mx, 0.030, 'arm_upper_' + side)
        P.capsule(ELBOW * mx, 0.030, WRIST * mx, 0.022, 'arm_lower_' + side)
        P.ellipsoid(V(0.107, 0.064, 0.072) * mx, (0.024, 0.026, 0.038), 'arm_lower_' + side, t=0.4)
        P.ellipsoid(V(0.100, 0.021, 0.153) * mx, (0.035, 0.0145, 0.036), 'paw_' + side)
        for i in range(4):
            p0, p1 = finger(i, sx)
            P.capsule(p0, 0.0098, p1, 0.0080, f'finger{i}_' + side, n=12)
        # hind leg: thigh forward to the knee, shank back to the hock, the foot flat and forward
        P.capsule(HIP * mx, 0.050, KNEE * mx, 0.034, 'leg_upper_' + side)
        P.capsule(KNEE * mx, 0.032, ANKLE * mx, 0.019, 'leg_lower_' + side)
        P.ellipsoid(V(0.103, 0.015, -0.218) * mx, (0.024, 0.0125, 0.044), 'foot_' + side)
        for i in range(4):
            p0, p1 = toe(i, sx)
            P.capsule(p0, 0.0075, p1, 0.0062, 'foot_' + side, n=10, t0=1.0, t1=1.0)
    return P


class Lookup:
    """which shape of the pile a point of the fused skin belongs to"""

    def __init__(self, pile):
        self.pile = pile
        self.names = {v: k for k, v in PARTS.items()}
        self.tree = BVHTree.FromPolygons([Vector(v) for v in pile.v], pile.f)
        self.pv = np.array(pile.v)

    def at(self, p):
        """part name, t along it, facing into the mouth"""
        co, _, fi, _ = self.tree.find_nearest(Vector(p))
        f = self.pile.f[fi]
        w = np.array([1.0 / (1e-5 + np.linalg.norm(self.pv[i] - np.array(co))) for i in f])
        w /= w.sum()
        t = sum(self.pile.t[i] * wi for i, wi in zip(f, w))
        ins = sum(self.pile.inside[i] * wi for i, wi in zip(f, w))
        return self.names[self.pile.part[f[0]]], t, ins > 0.5


# ---- into Blender --------------------------------------------------------------------------------------------------
def mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(B(v)) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def evaluated_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    return bpy.data.meshes.new_from_object(ob.evaluated_get(dg))


def mesh_arrays(me):
    """vertices in the page's axes, and edges"""
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(n, 3)
    ed = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', ed)
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1), ed.reshape(-1, 2)


def relax(val, edges, factor, iters):
    """each value towards the mean of its neighbours' over the mesh, by factor (one for all or one each)"""
    n = len(val)
    val = np.array(val, dtype=float).reshape(n, -1)
    deg = (np.bincount(edges[:, 0], minlength=n) + np.bincount(edges[:, 1], minlength=n)).astype(float)
    deg[deg == 0] = 1
    f = np.broadcast_to(np.asarray(factor, dtype=float).reshape(-1, 1), (n, 1))
    for _ in range(iters):
        s = np.zeros_like(val)
        for k in range(val.shape[1]):
            s[:, k] = np.bincount(edges[:, 0], weights=val[edges[:, 1], k], minlength=n) + np.bincount(edges[:, 1], weights=val[edges[:, 0], k], minlength=n)
        val = val + f * (s / deg[:, None] - val)
    return val


SOFTEN = {'body': 1.0, 'shoulder': 1.0, 'haunch': 1.0, 'tail': 0.8, 'arm': 0.8, 'leg': 0.8, 'paw': 0.45, 'finger': 0.35, 'foot': 0.4, 'skull': 0.3, 'jaw': 0.3, 'lip': 0.3, 'plate': 0.3, 'ridge': 0.55, 'socket': 0.22}


def fuse(pile, look):
    """the pile as one skin: voxel remesh, smoothed (the body more than the head), decimated"""
    src = mesh_object('pile', pile.v, pile.f)
    m = src.modifiers.new('fuse', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = VOXEL
    m.adaptivity = 0.0
    me = evaluated_mesh(src)
    bpy.data.objects.remove(src)

    # only the outer skin: where shapes overlap they seal off pockets, which come out as loose bubbles inside
    bm = bmesh.new()
    bm.from_mesh(me)
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        island, stack = [], [v]
        seen.add(v.index)
        while stack:
            a = stack.pop()
            island.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        islands.append(island)
    islands.sort(key=len)
    for island in islands[:-1]:
        bmesh.ops.delete(bm, geom=island, context='VERTS')
    print(f'fused: {len(islands) - 1} pockets dropped')
    bm.to_mesh(me)
    bm.free()
    me.update()

    pos, edges = mesh_arrays(me)
    soft = np.array([next(v for k, v in SOFTEN.items() if look.at(p)[0].startswith(k)) for p in pos])
    soft = relax(soft, edges, 0.5, 4)[:, 0]
    pos = relax(pos, edges, 0.5 * soft, 12)
    me.vertices.foreach_set('co', np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], axis=1).ravel())
    me.update()

    ob = bpy.data.objects.new('fused', me)
    bpy.context.scene.collection.objects.link(ob)
    quads = len(me.polygons)
    d = ob.modifiers.new('thin', 'DECIMATE')
    d.ratio = min(1.0, SKIN_TRIS / (quads * 2))
    me2 = evaluated_mesh(ob)
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    bm.from_mesh(me2)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me2)
    bm.free()
    pos, edges = mesh_arrays(me2)
    pos = relax(pos, edges, 0.22, 2)       # the decimation leaves a few needles of its own
    me2.vertices.foreach_set('co', np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], axis=1).ravel())
    me2.update()
    print(f'skin: {quads} quads fused, {len(me2.polygons)} triangles kept')
    return me2


# ---- what each vertex is ---------------------------------------------------------------------------------------------
MATS = ['skin', 'fur_base', 'mouth', 'teeth', 'claws', 'eye']
SKIN, FUR_BASE, MOUTH, TEETH, CLAWS, EYE = range(6)
ROUGH = {'skin': 0.6, 'fur_base': 0.9, 'mouth': 0.25, 'teeth': 0.2, 'claws': 0.35, 'eye': 0.08}


def srgb(r, g, b):
    return V(r, g, b) ** 2.2


C_SKIN, C_SKIN_PALE, C_KNOB, C_SOCKET, C_PAW = srgb(0.36, 0.32, 0.28), srgb(0.44, 0.39, 0.34), srgb(0.40, 0.37, 0.33), srgb(0.07, 0.055, 0.05), srgb(0.34, 0.28, 0.25)
C_HIDE = srgb(0.10, 0.08, 0.07)
C_GUM, C_THROAT, C_TONGUE = srgb(0.80, 0.42, 0.44), srgb(0.34, 0.08, 0.10), srgb(0.86, 0.47, 0.50)
C_TOOTH0, C_TOOTH1 = srgb(0.84, 0.74, 0.52), srgb(0.95, 0.92, 0.82)
C_CLAW0, C_CLAW1 = srgb(0.30, 0.22, 0.15), srgb(0.70, 0.60, 0.42)
C_EYE, C_IRIS, C_PUPIL = srgb(0.86, 0.87, 0.84), srgb(0.66, 0.72, 0.71), srgb(0.50, 0.56, 0.58)

BONES = []   # filled by rig()


def spine_weights(z):
    a, b, c = ss(-0.18, -0.08, z), ss(-0.045, 0.045, z), ss(0.070, 0.125, z)
    return {'spine1': 1 - a, 'spine2': a * (1 - b), 'spine3': b * (1 - c), 'head': c}


def describe(part, t, ins, p):
    """a skin vertex from its shape: (into the mouth, fur, colour without fur, bones)"""
    x, y, z = p
    side = part[-1]
    rel = p - HINGE
    if part in ('body', 'ridge'):
        w = spine_weights(z)
        if part == 'ridge':
            return False, 0.0, C_KNOB, w
        cy = body_at(z)[0]
        fur = 1.0 - ss(0.090, 0.125, z)
        if y > cy:
            fur *= ss(0.013, 0.030, abs(x))
        # the front of the barrel between the jaws is the back of the mouth
        s = rel @ unit(SK_F + JW_F)
        mouth = s > 0.004 and rel @ SK_N < 0.010 and rel @ JW_N > -0.010 and abs(x) < table(JAW, s)[0] + 0.004
        return mouth, fur, C_SKIN, w
    if part.startswith('shoulder'):
        # the muscle over the limb goes part of the way with it
        return False, ss(0.013, 0.030, abs(x)), C_SKIN, {**{k: v * 0.65 for k, v in spine_weights(z).items()}, 'arm_upper_' + side: 0.35}
    if part.startswith('haunch'):
        return False, 1.0, C_SKIN, {**{k: v * 0.6 for k, v in spine_weights(z).items()}, 'leg_upper_' + side: 0.4}
    if part == 'tail':
        return False, 0.7, C_SKIN, {'tail': ss(0.0, 0.5, t), 'spine1': 1 - ss(0.0, 0.5, t)}
    if part in ('skull', 'plate', 'socket'):
        return bool(ins), 0.0, C_SOCKET if part == 'socket' else C_KNOB if part == 'plate' else C_SKIN, {'head': 1}
    if part in ('jaw', 'plate_j'):
        return bool(ins), 0.0, C_KNOB if part == 'plate_j' else C_SKIN_PALE, {'jaw': 1}
    if part in ('lip_u', 'lip_l'):
        # gum on the inner face and the crest, hide on the outer face
        F, N, rows, length, inset, sign = (SK_F, SK_N, SKULL, SKULL_LEN, 0.0040, -1) if part == 'lip_u' else (JW_F, JW_N, JAW, JAW_LEN, 0.0035, 1)
        s = rel @ F
        outside = max(abs(x) - (table(rows, min(s, length))[0] - inset), s - length)
        gum = outside < -0.0012 or (sign * (rel @ N) > 0.0060 and outside < 0.0030)
        return gum, 0.0, C_SKIN if part == 'lip_u' else C_SKIN_PALE, {'head' if part == 'lip_u' else 'jaw': 1}
    if part.startswith('arm_upper'):
        s3, lo = 1 - ss(0.05, 0.40, t), 0.5 * ss(0.75, 1.0, t)
        return False, lerp(1.0, 0.45, ss(0.2, 1.0, t)), C_SKIN, {'spine3': s3, 'arm_lower_' + side: lo * (1 - s3), 'arm_upper_' + side: (1 - lo) * (1 - s3)}
    if part.startswith('arm_lower'):
        up, pw = 0.5 * (1 - ss(0.0, 0.25, t)), 0.5 * ss(0.8, 1.0, t)
        return False, 0.45 * (1 - ss(0.0, 0.6, t)), C_SKIN, {'arm_upper_' + side: up, 'paw_' + side: pw, 'arm_lower_' + side: 1 - up - pw}
    if part.startswith('paw'):
        return False, 0.0, C_PAW, {'paw_' + side: 1}
    if part.startswith('finger'):
        claws = ('claws_in_' if part[6] in '01' else 'claws_out_') + side
        return False, 0.0, C_PAW, {'paw_' + side: 1 - ss(0.1, 0.7, t), claws: ss(0.1, 0.7, t)}
    if part.startswith('leg_upper'):
        s1, lo = 1 - ss(0.05, 0.45, t), 0.5 * ss(0.75, 1.0, t)
        return False, 1.0, C_SKIN, {'spine1': s1, 'leg_lower_' + side: lo * (1 - s1), 'leg_upper_' + side: (1 - lo) * (1 - s1)}
    if part.startswith('leg_lower'):
        up, ft = 0.5 * (1 - ss(0.0, 0.25, t)), 0.5 * ss(0.8, 1.0, t)
        return False, lerp(1.0, 0.12, ss(0.1, 1.0, t)), C_SKIN, {'leg_upper_' + side: up, 'foot_' + side: ft, 'leg_lower_' + side: 1 - up - ft}
    if part.startswith('foot'):
        return False, 0.0, C_PAW, {'foot_' + side: 1}
    raise KeyError(part)


class Model:
    """the whole animal as arrays: the skin first, then what is added to it"""

    def __init__(self):
        self.v, self.f, self.mat, self.col, self.fur, self.w = [], [], [], [], [], []

    def add(self, verts, faces, mat, cols, weights):
        """a closed or nearly closed piece, turned inside out if it has to be so that it faces out"""
        verts = [np.array(v, dtype=float) for v in verts]
        c = sum(verts) / len(verts)
        vol = 0.0
        for f in faces:
            for k in range(1, len(f) - 1):
                vol += (verts[f[0]] - c) @ np.cross(verts[f[k]] - c, verts[f[k + 1]] - c)
        base = len(self.v)
        for i, v in enumerate(verts):
            self.v.append(v)
            self.col.append(cols[i] if isinstance(cols, list) else cols)
            self.fur.append(0.0)
            self.w.append(weights[i] if isinstance(weights, list) else weights)
        for f in faces:
            f = f if vol > 0 else f[::-1]
            self.f.append(tuple(base + i for i in f))
            self.mat.append(mat)

    def tube(self, rows, n, mat, cols, weights, tip=None, tail=None):
        """rows of (centre, x axis, y axis, x radius, y radius), a ring each, closed to a point at either end"""
        verts, faces, cc, ww = [], [], [], []
        for i, (c, ax, ay, rx, ry) in enumerate(rows):
            for j in range(n):
                a = TAU * j / n
                verts.append(c + ax * rx * math.cos(a) + ay * ry * math.sin(a))
                cc.append(cols[i]); ww.append(weights[i])
        for i in range(len(rows) - 1):
            for j in range(n):
                a, b = i * n + j, i * n + (j + 1) % n
                faces.append((a, b, b + n, a + n))
        for point, ring, k in ((tail, 0, 0), (tip, len(rows) - 1, -1)):
            if point is None:
                continue
            verts.append(point); cc.append(cols[k]); ww.append(weights[k])
            for j in range(n):
                a, b = ring * n + j, ring * n + (j + 1) % n
                faces.append((b, a, len(verts) - 1) if ring == 0 else (a, b, len(verts) - 1))
        self.add(verts, faces, mat, cc, ww)


def skin(model, me, look):
    """the fused skin into the model, every vertex described by the shape it came from"""
    pos, edges = mesh_arrays(me)
    n = len(pos)
    idx = {b: i for i, b in enumerate(BONES)}
    mouth, fur, col, W = np.zeros(n), np.zeros(n), np.zeros((n, 3)), np.zeros((n, len(BONES)))
    part = []
    for i, p in enumerate(pos):
        name, t, ins = look.at(p)
        part.append(name)
        mouth[i], fur[i], col[i], w = describe(name, t, ins, p)
        for b, x in w.items():
            W[i, idx[b]] = x
    head = np.array([p.startswith(('skull', 'jaw', 'lip', 'plate', 'socket', 'paw', 'finger', 'foot', 'ridge')) for p in part])
    fur = relax(fur, edges, 0.5, 6)[:, 0]
    fur = np.where(head, np.minimum(fur, 0.35) * (fur > 0.02), fur)   # only a fringe of it reaches on to bare parts
    fur[mouth > 0.5] = 0.0
    fur = np.clip(relax(fur, edges, 0.5, 1)[:, 0], 0, 1)
    fur[(mouth > 0.5) | (fur < 0.02)] = 0.0
    # bones: blended well where limbs meet the body, hardly at all on the head, where the jaw has to stay the jaw
    stiff = np.array([p.startswith(('skull', 'jaw', 'lip', 'plate', 'socket')) for p in part])
    W = relax(W, edges, np.where(stiff, 0.2, 0.5), 9)
    col = relax(col, edges, 0.5, 2)
    # the mouth: pink at the gums, dark down the throat
    depth = (pos - HINGE) @ unit(SK_F + JW_F)
    for i in range(n):
        if mouth[i] > 0.5:
            col[i] = lerp(C_THROAT, C_GUM, ss(0.015, 0.085, depth[i]))
        else:
            col[i] = lerp(col[i], C_HIDE, ss(0.0, 0.6, fur[i]))
    tri = np.empty(len(me.polygons) * 3, dtype=np.int64)
    me.polygons.foreach_get('vertices', tri)
    tri = tri.reshape(-1, 3)
    base = len(model.v)
    for i in range(n):
        model.v.append(pos[i]); model.col.append(col[i]); model.fur.append(float(fur[i]))
        model.w.append({BONES[k]: W[i, k] for k in np.nonzero(W[i] > 1e-4)[0]})
    # winding: the remesh and the turn of axes both keep it outward
    for a, b, c in tri:
        model.f.append((base + a, base + b, base + c))
        m = mouth[a] + mouth[b] + mouth[c]
        model.mat.append(MOUTH if m >= 2 else FUR_BASE if (fur[a] + fur[b] + fur[c]) / 3 > 0.22 else SKIN)
        if m >= 2:
            for i in (a, b, c):
                model.fur[base + i] = 0.0


# ---- teeth, claws, eyes, tongue ---------------------------------------------------------------------------------------
def tooth(model, base, d, length, r, bend, bone, n=5):
    """a needle: from base along d, leaning over towards bend as it goes, sunk a little into the gum"""
    d = unit(d)
    rows, cols = [], []
    for u in (-0.2, 0.0, 0.3, 0.6, 0.85):
        c = base + d * length * u + bend * length * 0.5 * u * abs(u)
        tg = unit(d + bend * abs(u))
        ax = unit(np.cross(tg, X if abs(tg[0]) < 0.8 else V(0, 0, 1)))
        ay = np.cross(tg, ax)
        rr = r * (1.0 if u <= 0 else (1 - u) ** 0.72 * (1 - 0.25 * u))
        rows.append((c, ax, ay, rr, rr))
        cols.append(lerp(C_TOOTH0, C_TOOTH1, ss(0.0, 0.5, u)))
    tip = base + d * length + bend * length * 0.5
    model.tube(rows, n, TEETH, cols, [{bone: 1.0}] * len(rows), tip=tip)


def teeth(model):
    # upper: four long fangs at the front of the snout, then a row down each side, no two the same length
    back = -SK_F
    for sx in (1, -1):
        out = X * sx
        a = table(SKULL, 0.128)[0]
        tooth(model, skull_pt(0.139, sx * 0.0200, -0.005), -SK_N + SK_F * 0.30 + out * 0.10, 0.062, 0.0038, back * 0.42, 'head', n=6)
        tooth(model, skull_pt(0.128, sx * (a - 0.0035), -0.005), -SK_N + SK_F * 0.18 + out * 0.16, 0.052, 0.0036, back * 0.40, 'head', n=6)
        k = 11
        for i in range(k):
            s = lerp(0.112, 0.020, i / (k - 1)) + rnd.uniform(-0.002, 0.002)
            a = table(SKULL, s)[0]
            length = (0.009 + 0.014 * rnd.random() ** 1.5) * lerp(1.15, 0.6, i / (k - 1)) * (1.35 if i % 3 == 0 else 1.0)
            tooth(model, skull_pt(s, sx * (a - 0.0040), -0.006), -SK_N + SK_F * 0.10 + out * rnd.uniform(0.08, 0.24), length, 0.0013 + length * 0.055, back * 0.35, 'head')
    # lower: two long fangs from the tip of the jaw, then the rows, shorter
    back = -JW_F
    for sx in (1, -1):
        out = X * sx
        tooth(model, jaw_pt(0.155, sx * 0.0062, 0.004), JW_N + JW_F * 0.12 + out * 0.10, 0.056, 0.0036, back * 0.38, 'jaw', n=6)
        k = 11
        for i in range(k):
            s = lerp(0.138, 0.028, i / (k - 1)) + rnd.uniform(-0.002, 0.002)
            a = table(JAW, s)[0]
            length = (0.007 + 0.011 * rnd.random() ** 1.5) * lerp(1.25, 0.6, i / (k - 1)) * (1.4 if i % 3 == 1 else 1.0)
            tooth(model, jaw_pt(s, sx * (a - 0.0035), 0.006), JW_N + JW_F * 0.06 + out * rnd.uniform(0.02, 0.16), length, 0.0013 + length * 0.055, back * 0.32, 'jaw')


def claw(model, base, fwd, up, length, rw, rh, e0, turn, bone, n=6):
    """a claw: an arc in the plane of fwd and up, setting out e0 above fwd and turning down through `turn`"""
    R = length / turn
    side = unit(np.cross(up, fwd))
    rows, cols = [], []
    for u in (-0.14, 0.0, 0.2, 0.4, 0.6, 0.8, 0.94):
        e = e0 - turn * u
        c = base + fwd * R * (math.sin(e0) - math.sin(e)) + up * R * (math.cos(e) - math.cos(e0))
        tg = fwd * math.cos(e) + up * math.sin(e)
        k = 1.0 if u <= 0 else (1 - u) ** 0.62
        rows.append((c, side, np.cross(tg, side), rw * k, rh * k))
        cols.append(lerp(C_CLAW0, C_CLAW1, ss(-0.1, 0.7, u)))
    e = e0 - turn
    tip = base + fwd * R * (math.sin(e0) - math.sin(e)) + up * R * (math.cos(e) - math.cos(e0))
    model.tube(rows, n, CLAWS, cols, [{bone: 1.0}] * len(rows), tip=tip)


def claws(model):
    up = V(0, 1, 0)
    for sx, side in ((1, 'L'), (-1, 'R')):
        for i in range(4):
            p0, p1 = finger(i, sx)
            d = unit((p1 - p0) * V(1, 0, 1))
            length = 0.050 * (1.0 if i in (1, 2) else 0.9)
            claw(model, p1 - d * 0.003 + up * 0.0012, d, up, length, 0.0056, 0.0074, math.radians(24), math.radians(84), ('claws_in_' if i < 2 else 'claws_out_') + side)
            p0, p1 = toe(i, sx)
            d = unit((p1 - p0) * V(1, 0, 1))
            claw(model, p1 - d * 0.002 + up * 0.0008, d, up, 0.021, 0.0040, 0.0050, math.radians(20), math.radians(75), 'foot_' + side, n=5)


def eyes(model):
    """a milky ball each side, its iris and pupil only a shade in the colour"""
    for sx in (1, -1):
        c, ax = eye(sx)
        ex = unit(np.cross(ax, V(0, 1, 0)))
        ey = np.cross(ax, ex)
        rows, cols, m = [], [], 9
        for i in range(1, m):
            ph = math.pi * i / m * 0.92
            rr = EYE_R * math.sin(ph)
            rows.append((c + ax * EYE_R * math.cos(ph), ex, ey, rr, rr))
            cols.append(C_PUPIL if ph < 0.26 else lerp(lerp(C_IRIS, C_PUPIL, ss(0.5, 0.72, ph)), C_EYE, ss(0.72, 0.80, ph)))
        model.tube(rows, 14, EYE, cols, [{'head': 1.0}] * len(rows), tail=c + ax * EYE_R)


TONGUE_S = (0.006, 0.070, 0.134)      # where the tongue starts, bends and ends, along the jaw


def tongue_at(s):
    """the tongue's centre line: lying in the trough, its tip lifted"""
    d = table(JAW, s)[1]
    return jaw_pt(s, 0, -TROUGH * d + 0.0090 + 0.014 * ss(0.090, 0.134, s) ** 1.5)


def tongue(model):
    rows, cols, ws = [], [], []
    k = 15
    for i in range(k + 1):
        f = i / k
        s = lerp(TONGUE_S[0], TONGUE_S[2] - 0.004, f)
        c, c2 = tongue_at(s), tongue_at(s + 0.002)
        tg = unit(c2 - c)
        end = math.sqrt(1 - f ** 5 * 0.92)     # rounded off at the tip
        w = 0.0185 * (1 - 0.25 * f) * end * min(1.0, table(JAW, s)[0] / 0.022)
        rows.append((c, X, np.cross(tg, X), max(w, 0.0035), 0.0062 * (1 - 0.35 * f) * (0.5 + 0.5 * end)))
        cols.append(lerp(C_THROAT, C_TONGUE, ss(0.0, 0.3, f)))
        b = ss(TONGUE_S[1] - 0.02, TONGUE_S[1] + 0.02, s)
        j = 1 - ss(0.0, 0.2, f)
        ws.append({'jaw': j, 'tongue1': (1 - j) * (1 - b), 'tongue2': (1 - j) * b})
    model.tube(rows, 10, MOUTH, cols, ws, tip=tongue_at(TONGUE_S[2]), tail=tongue_at(TONGUE_S[0] - 0.004))


# ---- the bones ---------------------------------------------------------------------------------------------------------
def bone_table():
    tv = lambda s: tongue_at(s)
    rows = [
        ('root', None, V(0, 0, 0), V(0, 0, 0.06)),
        ('spine1', 'root', V(0, 0.108, -0.270), V(0, 0.112, -0.130)),
        ('spine2', 'spine1', V(0, 0.112, -0.130), V(0, 0.114, 0.0)),
        ('spine3', 'spine2', V(0, 0.114, 0.0), NECK),
        ('head', 'spine3', NECK, skull_pt(0.110, 0, 0.030)),
        ('jaw', 'head', HINGE, jaw_pt(JAW_LEN, 0, 0)),
        ('tongue1', 'jaw', tv(0.012), tv(TONGUE_S[1])),
        ('tongue2', 'tongue1', tv(TONGUE_S[1]), tv(TONGUE_S[2])),
        ('tail', 'spine1', TAIL0, TAIL1),
    ]
    for sx, s in ((1, 'L'), (-1, 'R')):
        mx = V(sx, 1, 1)
        rows += [
            ('arm_upper_' + s, 'spine3', SHOULDER * mx, ELBOW * mx),
            ('arm_lower_' + s, 'arm_upper_' + s, ELBOW * mx, WRIST * mx),
            ('paw_' + s, 'arm_lower_' + s, WRIST * mx, KNUCKLE * mx),
        ]
        for name, pair in (('claws_in_', (0, 1)), ('claws_out_', (2, 3))):
            tips = [finger(i, sx)[1] for i in pair]
            h = (tips[0] + tips[1]) / 2 - V(0, 0, 0.012)
            rows.append((name + s, 'paw_' + s, h, h + V(sx * 0.004 * (-1 if pair[0] == 0 else 1), -0.004, 0.045)))
        rows += [
            ('leg_upper_' + s, 'spine1', HIP * mx, KNEE * mx),
            ('leg_lower_' + s, 'leg_upper_' + s, KNEE * mx, ANKLE * mx),
            ('foot_' + s, 'leg_lower_' + s, ANKLE * mx, TOE * mx),
        ]
    return rows


class Rig:
    def __init__(self):
        rows = bone_table()
        BONES[:] = [r[0] for r in rows]
        arm = bpy.data.armatures.new('beast')
        self.ob = ob = bpy.data.objects.new('beast', arm)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode='EDIT')
        for name, parent, head, tail in rows:
            eb = arm.edit_bones.new(name)
            eb.head, eb.tail = B(head), B(tail)
            if parent:
                eb.parent = arm.edit_bones[parent]
            # roll: the bone's own x is the animal's left wherever the bone allows it
            z = Vector((1, 0, 0)).cross((eb.tail - eb.head).normalized())
            eb.align_roll(z if z.length > 1e-3 else Vector((0, 0, 1)))
        bpy.ops.object.mode_set(mode='OBJECT')
        self.parent = {r[0]: r[1] for r in rows}
        self.M = {b.name: b.matrix_local.copy() for b in arm.bones}
        self.L = {n: (self.M[self.parent[n]].inverted() @ m if self.parent[n] else m.copy()) for n, m in self.M.items()}
        for pb in ob.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.limbs = {}
        for s in 'LR':
            self.limbs['arm_' + s] = ('arm_upper_' + s, 'arm_lower_' + s, 'paw_' + s)
            self.limbs['leg_' + s] = ('leg_upper_' + s, 'leg_lower_' + s, 'foot_' + s)

    # ---- posing. A pose is a dict in the page's axes:
    #   'bone': (pitch, yaw, roll) degrees about the animal's own left, up and forward axes as they lie at rest
    #           (pitch + is nose down, yaw + turns to its left, roll + lifts its left side)
    #   'bone@': (x, y, z) metres moved, 'bone*': (x, y, z) scale in the bone's own axes (y along it)
    #   'arm_L>': where the wrist goes, from where it rests; 'arm_L^': added to the pole the elbow points along;
    #   and 'paw_L' / 'foot_L' turn the planted end from how it lies at rest, whatever the leg above it does
    @staticmethod
    def quat(pyr):
        p, y, r = (math.radians(a) for a in pyr)
        return Quaternion((0, 0, 1), y) @ Quaternion((1, 0, 0), p) @ Quaternion((0, -1, 0), r)

    def solve(self, pose):
        """the pose as each bone's own (location, quaternion, scale), and where that puts it"""
        W, out = {}, {}
        ident = Matrix.Identity(4)

        def fk(name):
            rr = self.M[name].to_quaternion()
            q = rr.conjugated() @ self.quat(pose.get(name, (0, 0, 0))) @ rr
            loc = rr.conjugated() @ B(pose.get(name + '@', (0, 0, 0)))
            scl = Vector(pose.get(name + '*', (1, 1, 1)))
            out[name] = (loc, q, scl)
            W[name] = (W[self.parent[name]] if self.parent[name] else ident) @ self.L[name] @ Matrix.LocRotScale(loc, q, scl)

        def aim(name, to):
            """turn the bone, by the shortest way, to point along `to`"""
            c = (W[self.parent[name]] @ self.L[name])
            cq = c.to_quaternion()
            arc = (cq @ Vector((0, 1, 0))).rotation_difference(to.normalized())
            q = cq.conjugated() @ arc @ cq
            out[name] = (Vector((0, 0, 0)), q, Vector((1, 1, 1)))
            W[name] = c @ q.to_matrix().to_4x4()

        limb_bones = {b for l in self.limbs.values() for b in l}
        for name in BONES:
            if name not in limb_bones and not name.startswith('claws'):
                fk(name)
        for limb, (up, lo, end) in self.limbs.items():
            s0, e0, t0 = self.M[up].translation, self.M[lo].translation, self.M[end].translation
            l1, l2 = (e0 - s0).length, (t0 - e0).length
            S = (W[self.parent[up]] @ self.L[up]).translation
            T = t0 + B(pose.get(limb + '>', (0, 0, 0)))
            n = T - S
            d = min(max(n.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
            n.normalize()
            # the pole: where the joint points at rest, square to the line from shoulder to wrist
            rest = (e0 - s0) - (t0 - s0).normalized() * (e0 - s0).dot((t0 - s0).normalized())
            pole = rest.normalized() + B(pose.get(limb + '^', (0, 0, 0)))
            pole = (pole - n * pole.dot(n)).normalized()
            ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
            E = S + n * (l1 * ca) + pole * (l1 * math.sqrt(max(0.0, 1 - ca * ca)))
            aim(up, E - S)
            aim(lo, S + n * d - E)
            c = W[lo] @ self.L[end]
            q = c.to_quaternion().conjugated() @ (self.quat(pose.get(end, (0, 0, 0))) @ self.M[end].to_quaternion())
            out[end] = (Vector((0, 0, 0)), q, Vector((1, 1, 1)))
            W[end] = c @ q.to_matrix().to_4x4()
        for name in BONES:
            if name.startswith('claws'):
                fk(name)
        return out, W

    def apply(self, pose):
        out, W = self.solve(pose)
        for name, (loc, q, scl) in out.items():
            pb = self.ob.pose.bones[name]
            pb.location, pb.rotation_quaternion, pb.scale = loc, q, scl
        return W

    def check(self, pose):
        """the script's idea of where the bones are against Blender's"""
        W = self.apply(pose)
        bpy.context.view_layer.update()
        worst = max((self.ob.pose.bones[n].matrix.translation - W[n].translation).length for n in BONES)
        print(f'pose check: bones within {worst * 1000:.3f} mm of where the script puts them')

    def bake(self, name, seconds, fn):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad = self.ob.animation_data or self.ob.animation_data_create()
        ad.action = act
        prev = {}
        for f in range(round(seconds * FPS) + 1):
            out, _ = self.solve(fn(f / FPS))
            for b, (loc, q, scl) in out.items():
                if b in prev and prev[b].dot(q) < 0:
                    q = -q
                prev[b] = q
                pb = self.ob.pose.bones[b]
                pb.location, pb.rotation_quaternion, pb.scale = loc, q, scl
                for path in ('location', 'rotation_quaternion', 'scale'):
                    pb.keyframe_insert(path, frame=f, group=b)
        return act

    def show(self, act, seconds):
        ad = self.ob.animation_data
        ad.action = act
        if act is not None and hasattr(ad, 'action_slot') and ad.action_slot is None and len(act.slots):
            ad.action_slot = act.slots[0]
        bpy.context.scene.frame_set(round(seconds * FPS))
        bpy.context.view_layer.update()

    def rest(self):
        if self.ob.animation_data:
            self.ob.animation_data.action = None
        for pb in self.ob.pose.bones:
            pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)


# ---- the poses and the clips ------------------------------------------------------------------------------------------
def sym(d):
    """a pose given for the left side, the right side its mirror"""
    out = dict(d)
    for k, v in d.items():
        if '_L' in k:
            mirrored = (-v[0], v[1], v[2]) if k[-1] in '>^@' else (v[0], -v[1], -v[2])
            out.setdefault(k.replace('_L', '_R'), mirrored)
    return out


def blend(a, b, t):
    out = {}
    for k in set(a) | set(b):
        zero = (1, 1, 1) if k.endswith('*') else (0, 0, 0)
        out[k] = tuple(lerp(np.array(a.get(k, zero), dtype=float), np.array(b.get(k, zero), dtype=float), t))
    return out


def over(a, **b):
    """pose a with some of it replaced"""
    out = dict(a)
    out.update(sym({k.replace('__', '>').replace('_at', '@'): v for k, v in b.items()}))
    return out


EASE = {
    'io': lambda t: t * t * (3 - 2 * t),
    'in': lambda t: t * t,
    'out': lambda t: 1 - (1 - t) ** 2,
    'snap': lambda t: t ** 3,
    'lin': lambda t: t,
}


def keyed(keys):
    """keys of (time, pose, the ease into it) as a function of time"""
    def fn(t):
        if t <= keys[0][0]:
            return keys[0][1]
        for (t0, p0, _), (t1, p1, e) in zip(keys, keys[1:]):
            if t <= t1 + 1e-9:
                return blend(p0, p1, EASE[e]((t - t0) / (t1 - t0)))
        return keys[-1][1]
    return fn


IDLE_T = 2.5


def idle(t):
    """breathing, the head never quite still, the jaw working a little"""
    ph = TAU * t / IDLE_T
    br = 0.5 - 0.5 * math.cos(ph)
    s2, s3 = 1 + 0.045 * br, 1 + 0.018 * br
    return sym({
        'spine1@': (0, 0.0025 * br, 0),
        'spine2*': (s2, 1, s2), 'spine3*': (s3 / s2, 1, s3 / s2),
        'spine3': (-0.8 * br, 0, 0),
        'head': (-1.5 * br + 1.0 * math.sin(2 * ph + 0.6), 2.4 * math.sin(ph + 1.0), 1.2 * math.sin(2 * ph + 2.0)),
        'jaw': (-12 + 4.5 * br + 1.5 * math.sin(3 * ph), 0, 0),
        'tongue1': (-3 * br, 3 * math.sin(ph), 0), 'tongue2': (-5 * math.sin(2 * ph), 4 * math.sin(ph + 0.8), 0),
        'tail': (4 * math.sin(2 * ph), 7 * math.sin(ph), 0),
        'claws_in_L': (3 * math.sin(ph + 0.5), 0, 0), 'claws_out_L': (3 * math.sin(ph + 1.1), 0, 0),
        'claws_in_R': (3 * math.sin(ph + 2.5), 0, 0), 'claws_out_R': (3 * math.sin(ph + 3.1), 0, 0),
    })


IDLE0 = idle(0)
# low and gathered: the weight back over loaded hind legs, the chest down between planted paws, eyes up
CROUCH = sym({
    'spine1@': (0, -0.010, -0.044), 'spine1': (4, 0, 0), 'spine2': (1, 0, 0), 'spine3': (-5, 0, 0),
    'head': (-9, 0, 0), 'jaw': (-24, 0, 0), 'tail': (-24, 0, 0), 'arm_L^': (0.3, 0.3, 0),
    'claws_in_L': (7, 0, 0), 'claws_out_L': (7, 0, 0), 'tongue1': (2, 0, 0),
})
# the hind legs have driven it forward and up, the forepaws are leaving the ground
PUSH = sym({
    'spine1@': (0, 0.014, 0.050), 'spine1': (-13, 0, 0), 'spine2': (-4, 0, 0), 'spine3': (-3, 0, 0),
    'head': (-5, 0, 0), 'jaw': (-6, 0, 0), 'tail': (-28, 0, 0),
    'arm_L>': (0.012, 0.085, 0.060), 'paw_L': (-28, 0, 0), 'foot_L': (22, 0, 0),
    'claws_in_L': (-6, -6, 0), 'claws_out_L': (-6, 6, 0),
})
# in the air, stretched: forepaws thrown out either side of the head, claws spread, the mouth as wide as it goes
LEAP = sym({
    'spine1@': (0, 0.050, 0.045), 'spine1': (-14, 0, 0), 'spine2': (-6, 0, 0), 'spine3': (-5, 0, 0),
    'head': (-11, 0, 0), 'jaw': (53, 0, 0), 'tail': (12, 0, 0),
    'tongue1': (-14, 0, 0), 'tongue2': (-22, 0, 0),
    'arm_L>': (0.030, 0.235, 0.105), 'arm_L^': (0.6, 0.5, 0.0), 'paw_L': (-52, 14, 0),
    'claws_in_L': (-18, -15, 0), 'claws_out_L': (-18, 15, 0),
    'leg_L>': (-0.020, 0.050, -0.150), 'foot_L': (72, 0, 0),
})
GAPE = sym({'spine3': (-6, 0, 0), 'head': (-22, 0, 0), 'jaw': (50, 0, 0), 'tongue2': (-10, 0, 0)})   # for a look at the mouth
SHUT_JAW = -28                        # as far as it closes: the needles cross, the lips never meet

BITE_BACK = over(LEAP, spine3=(-8, 0, 0), head=(-15, 0, 0), jaw=(57, 0, 0), spine1_at=(0, 0.050, 0.035))
BITE_SHUT = over(LEAP, spine3=(2, 0, 0), head=(20, 0, 0), jaw=(SHUT_JAW, 0, 0), spine1_at=(0, 0.046, 0.072),
                 arm_L__=(0.012, 0.215, 0.125), claws_in_L=(8, -4, 0), claws_out_L=(8, 4, 0), tongue1=(0, 0, 0), tongue2=(0, 0, 0))
BITE_END = over(LEAP, jaw=(14, 0, 0))
# the forepaws have it, the chest comes down between them, the hind legs are still coming
IMPACT = sym({
    'spine1@': (0, 0.016, 0.026), 'spine1': (8.5, 0, 0), 'spine2': (2, 0, 0), 'spine3': (-5, 0, 0),
    'head': (-11, 0, 0), 'jaw': (-10, 0, 0), 'tail': (-22, 0, 0),
    'claws_in_L': (8, 0, 0), 'claws_out_L': (8, 0, 0),
    'leg_L>': (0.0, 0.034, -0.050), 'foot_L': (32, 0, 0),
})
SETTLE = sym({'spine1@': (0, -0.011, -0.004), 'spine3': (-2, 0, 0), 'head': (-4, 0, 0), 'jaw': (-17, 0, 0), 'tail': (-6, 0, 0)})

# ---- the crawl: a slow stalk, in place. The page moves the root forward at CRAWL_STRIDE / CRAWL_T (or scales the
# clip's speed to its own), and then every planted paw stands still on the ground.
# A lizard's walk: diagonal pairs, the hind paw of each pair a little ahead of its forepaw, all four down between
# the pairs; the spine bends from side to side with it, hips one way and shoulders the other.
CRAWL_T = 1.1                         # seconds a cycle
CRAWL_STRIDE = 0.264                  # metres of ground a cycle
CRAWL_DUTY = 0.64                     # of the cycle each paw is on the ground
CRAWL_LIFT = {'arm_L': 0.10, 'leg_R': 0.04, 'arm_R': 0.60, 'leg_L': 0.54}   # when each paw leaves the ground, of the cycle
CRAWL_MID = {'arm': 0.090 - WRIST[2], 'leg': -0.270 - ANKLE[2]}             # the middle of its stance, from where it rests


def crawl_foot(limb, tau):
    """a paw at tau of the cycle: forward of where it rests, and how far through its swing (None while planted)"""
    swing = 1 - CRAWL_DUTY
    u = (tau - CRAWL_LIFT[limb]) % 1.0
    half = CRAWL_STRIDE * CRAWL_DUTY / 2
    mid = CRAWL_MID[limb[:3]]
    if u >= swing - 1e-9:
        # planted: straight back, at the speed the ground goes by
        return mid + half - CRAWL_STRIDE * (u - swing), None
    s = u / swing
    q = s * s * s * (s * (6 * s - 15) + 10)          # over the ground it leaves and arrives at rest
    return mid - half + CRAWL_STRIDE * (q - u), s


def crawl(t):
    tau = t / CRAWL_T
    wave = lambda lag: math.cos(TAU * (tau - lag))
    # each girdle is turned furthest as its paw comes down: the hip or shoulder of the reaching leg forward
    hips, chest = 7.5 * wave(0.40), -8.5 * wave(0.46)
    roll1, roll3 = 2.0 * math.sin(TAU * (tau - 0.04)), -2.5 * math.sin(TAU * (tau - 0.10))   # dipping to the lifted paw
    pose = {
        # low, and kept over its feet: the bend alone would throw the chest sideways
        'spine1@': (-0.07 * math.sin(math.radians(hips)), -0.008 + 0.0018 * math.cos(2 * TAU * tau), 0),
        'spine1': (1.0, hips, roll1), 'spine2': (0, (chest - hips) / 2, -roll1), 'spine3': (1.5, (chest - hips) / 2, roll3),
        # the head low, level and pointed where it is going, whatever the shoulders do
        'head': (-2.0 + 0.6 * math.sin(2 * TAU * tau), -0.85 * chest, -0.7 * roll3),
        'jaw': (-14 + 3.0 * math.sin(2 * TAU * tau + 0.5), 0, 0),
        'tongue1': (-2, 2 * wave(0.2), 0), 'tongue2': (-3 * math.sin(2 * TAU * tau), 3 * wave(0.3), 0),
        'tail': (-5, -13 * wave(0.47), 0),
    }
    for limb in CRAWL_LIFT:
        side = limb[-1]
        sx = 1 if side == 'L' else -1
        arm = limb.startswith('arm')
        z, s = crawl_foot(limb, tau)
        a = 0.0 if s is None else math.sin(math.pi * s) ** 2
        up = 0.0 if s is None else math.sin(math.pi * s ** 0.85) ** 2      # up early, down late
        if arm:
            # the forepaw swings out round (under the shoulder there is no room for it) and comes down flat,
            # claws lifted clear on the way
            pose[limb + '>'] = (sx * 0.028 * a, 0.032 * up, z)
            pose[limb + '^'] = (sx * 0.15 * a, 0.35 * a, 0)
            pose['paw_' + side] = (-16 * a, 0, 0)
            pose['claws_in_' + side] = (4 - 15 * a, -sx * 4 * a, 0)
            pose['claws_out_' + side] = (4 - 15 * a, sx * 4 * a, 0)
        else:
            pose[limb + '>'] = (0, 0.030 * up, z)
            # the knee out to the side, the more so the further forward the paw is: up, it stands off the flank
            fold = ss(-0.06, 0.10, z)
            pose[limb + '^'] = (sx * (0.5 + 0.9 * fold), -0.45 * fold, 0)
            pose['foot_' + side] = (-9 * a, 0, 0)
    return pose


def crawl_check(rig):
    """how far each planted paw wanders over the ground, the root carried forward at the crawl's speed"""
    n = round(CRAWL_T * FPS)
    speed = CRAWL_STRIDE / CRAWL_T
    print(f'crawl: {CRAWL_T} s a cycle, {CRAWL_STRIDE} m of ground a cycle, {speed:.4f} m/s, paws down {CRAWL_DUTY:.0%} of it')
    for limb, (_, _, end) in rig.limbs.items():
        joint, tip, miss, lift, run, z = 0.0, 0.0, 0.0, 0.0, None, []
        for f in range(2 * n + 1):                   # twice round, so that no stance is cut by the loop
            pose = crawl(f / FPS)
            _, W = rig.solve(pose)
            fwd, s = crawl_foot(limb, f / n)
            at = W[end].translation
            target = rig.M[end].translation + B(pose.get(limb + '>', (0, 0, 0)))
            miss = max(miss, (at - target).length)
            lift = max(lift, at.z - rig.M[end].translation.z)
            z.append(-at.y)
            # on the ground: the joint, and the far end of the paw (which also tells if it turns)
            ground = [p + Vector((0, -speed * f / FPS, 0)) for p in (at, W[end] @ Vector((0, 0.05, 0)))]
            if s is None:
                run = run or ground
                joint, tip = max(joint, (ground[0] - run[0]).length), max(tip, (ground[1] - run[1]).length)
            else:
                run = None
        print(f'  {limb}: planted joint moves {joint * 1000:.3f} mm, paw end {tip * 1000:.3f} mm; reach missed by {miss * 1000:.3f} mm; '
              f'lifted {lift * 1000:.0f} mm; from {min(z):.3f} to {max(z):.3f} m forward')


CLIPS = [
    ('idle', IDLE_T, idle),
    ('crouch', 0.4, keyed([(0, IDLE0, 'io'), (0.4, CROUCH, 'io')])),
    ('leap', 0.5, keyed([(0, CROUCH, 'io'), (0.14, PUSH, 'in'), (0.32, over(blend(PUSH, LEAP, 0.72), jaw=(12, 0, 0)), 'lin'), (0.5, LEAP, 'out')])),
    ('bite', 0.6, keyed([
        (0, LEAP, 'io'), (0.07, BITE_BACK, 'out'), (0.14, BITE_SHUT, 'snap'), (0.19, BITE_SHUT, 'lin'),
        (0.31, BITE_BACK, 'out'), (0.34, BITE_BACK, 'lin'), (0.41, BITE_SHUT, 'snap'), (0.47, BITE_SHUT, 'lin'), (0.6, BITE_END, 'io'),
    ])),
    ('land', 0.5, keyed([(0, BITE_END, 'io'), (0.16, IMPACT, 'in'), (0.31, SETTLE, 'out'), (0.5, IDLE0, 'io')])),
    ('crawl', CRAWL_T, crawl),
]


# ---- putting it together ------------------------------------------------------------------------------------------------
def material(name):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, 'use_nodes') and not mat.node_tree:
        mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if mat.node_tree else None
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
        bsdf.inputs['Roughness'].default_value = ROUGH[name]
        bsdf.inputs['Metallic'].default_value = 0.0
    mat.roughness = ROUGH[name]
    return mat


def assemble(model, rig):
    me = bpy.data.meshes.new('beast')
    me.from_pydata([tuple(B(v)) for v in model.v], [], model.f)
    for name in MATS:
        me.materials.append(material(name))
    me.polygons.foreach_set('material_index', model.mat)
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    fur = me.attributes.new('_FUR', 'FLOAT', 'POINT')
    fur.data.foreach_set('value', model.fur)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.array(model.col), np.ones((len(model.col), 1))], axis=1).ravel())
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new('beast_skin', me)
    bpy.context.scene.collection.objects.link(ob)
    groups = {b: ob.vertex_groups.new(name=b) for b in BONES}
    most = 0
    for i, w in enumerate(model.w):
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        total = sum(x for _, x in top)
        most = max(most, len(w))
        for b, x in top:
            if x / total > 1e-3:
                groups[b].add([i], x / total, 'REPLACE')
    ob.parent = rig.ob
    ob.modifiers.new('rig', 'ARMATURE').object = rig.ob
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    per = {m: sum(len(f) - 2 for f, k in zip(model.f, model.mat) if k == i) for i, m in enumerate(MATS)}
    print(f'beast: {len(me.vertices)} vertices, {tris} triangles {per}, most bones on one vertex before the cut to four: {most}')
    return ob


def export(ob, rig, acts):
    ad = rig.ob.animation_data
    ad.action = None
    for name, act in acts.items():
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        strip.name = name
        if hasattr(strip, 'action_slot') and strip.action_slot is None and len(act.slots):
            strip.action_slot = act.slots[0]
    rig.rest()
    rig.ob.location = (0, 0, 0)
    bpy.context.scene.frame_set(0)
    for o in bpy.context.scene.objects:
        o.select_set(o in (ob, rig.ob))
    bpy.context.view_layer.objects.active = rig.ob
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_attributes=True, export_morph=False, export_cameras=False, export_lights=False, export_extras=False,
        export_skins=True, export_influence_nb=4, export_all_influences=False, export_def_bones=False, export_leaf_bone=False,
        export_rest_position_armature=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_anim_slide_to_zero=True, export_reset_pose_bones=True, export_bake_animation=False,
    )
    print('wrote', OUT, f'{os.path.getsize(OUT) / 1024:.0f} kB')


# ---- looking at it ---------------------------------------------------------------------------------------------------------
VIEWS = {
    # the three views of the reference: straight on and a little above, three-quarter side, from above-front
    'front': (V(0, 0.34, 1.30), V(0, 0.115, 0.10), 85),
    'side': (V(0.82, 0.30, 0.86), V(0, 0.085, -0.03), 75),
    'above': (V(0.24, 1.20, 0.80), V(0, 0.05, -0.04), 62),
    'ahead': (V(0, 0.22, 1.30), V(0, 0.21, 0.10), 85),          # the leap, from where it is going
    'profile': (V(1.2, 0.12, 0.10), V(0, 0.11, 0.10), 110),     # the head from the side
    'flank': (V(1.05, 0.30, 0.45), V(0, 0.17, -0.02), 60),
    'back': (V(0.25, 0.75, -0.25), V(0, 0.15, -0.08), 50),
    'walk': (V(1.70, 0.13, -0.05), V(0, 0.10, -0.05), 88),       # square on from its left
    'oncoming': (V(0, 0.17, 1.30), V(0, 0.10, 0.10), 85),        # the crawl, from where it is going
    'walk-above': (V(0.0, 2.00, -0.04), V(0, 0, -0.05), 70),     # straight down on the spine
}


def setup_render(colour):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = colour
    sh.show_shadows = False
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.curvature_ridge_factor, sh.curvature_valley_factor = 0.8, 0.5
    sh.show_specular_highlight = True
    sh.show_object_outline = False
    sc.display.render_aa = '8'
    world = bpy.data.worlds.new('dark')
    world.color = (0.012, 0.012, 0.014)
    sc.world = world
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.resolution_x, sc.render.resolution_y = 1200, 900
    sc.render.fps = FPS
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shoot(cam, name, view):
    eye_, at, lens = VIEWS[view]
    cam.location = B(eye_)
    cam.rotation_euler = (B(at) - B(eye_)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    cam.data.clip_start, cam.data.clip_end = 0.01, 10
    os.makedirs(PROC, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PROC, name + '.png')
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    pile = build_pile()
    look = Lookup(pile)
    fused = fuse(pile, look)
    if BLOCKOUT:
        ob = bpy.data.objects.new('blockout', fused)
        bpy.context.scene.collection.objects.link(ob)
        fused.polygons.foreach_set('use_smooth', [True] * len(fused.polygons))
        clay = bpy.data.materials.new('clay')
        clay.diffuse_color = (0.42, 0.38, 0.34, 1)
        fused.materials.append(clay)
        cam = setup_render('MATERIAL')
        for view in ('front', 'side', 'above'):
            shoot(cam, 'beast-blockout-' + view, view)
        return

    rig = Rig()
    model = Model()
    skin(model, fused, look)
    teeth(model)
    claws(model)
    eyes(model)
    tongue(model)
    ob = assemble(model, rig)
    lo, hi = np.min(model.v, axis=0), np.max(model.v, axis=0)
    print('bounds (x, y, z):', np.round(lo, 3), np.round(hi, 3))

    rig.check(LEAP)
    crawl_check(rig)
    rig.rest()
    acts = {name: rig.bake(name, seconds, fn) for name, seconds, fn in CLIPS}
    rig.rest()

    if RENDER:
        cam = setup_render('VERTEX')
        shoot(cam, 'beast-side', 'side')
        shoot(cam, 'beast-above', 'above')
        shoot(cam, 'beast-rest-front', 'front')
        shoot(cam, 'beast-back', 'back')
        rig.apply(GAPE)
        shoot(cam, 'beast-front', 'front')
        shoot(cam, 'beast-gape-profile', 'profile')
        rig.apply(sym({'jaw': (SHUT_JAW, 0, 0)}))
        shoot(cam, 'beast-shut-profile', 'profile')
        for name, clip, t, view in (
            ('crouch', 'crouch', 0.4, 'side'), ('leap', 'leap', 0.36, 'ahead'), ('leap-end', 'leap', 0.5, 'ahead'), ('leap-flank', 'leap', 0.5, 'flank'),
            ('bite-open', 'bite', 0.07, 'ahead'), ('bite', 'bite', 0.16, 'ahead'), ('land', 'land', 0.16, 'side'), ('idle', 'idle', 1.25, 'side'),
        ):
            rig.show(acts[clip], t)
            shoot(cam, 'beast-' + name, view)
        rig.rest()
    if RENDER or 'crawl' in ARGS:
        # the crawl: from the side, with posts in the ground a tenth of a metre apart going by at its speed, so a
        # planted paw can be seen to stay by its post; from the front and from above
        cam = bpy.context.scene.camera or setup_render('VERTEX')
        posts = [mesh_object('post', [V(x, y, z) for z in (k * 0.1 - 0.003, k * 0.1 + 0.003) for x, y in ((0.20, 0), (0.21, 0), (0.21, 0.012), (0.20, 0.012))],
                             [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]) for k in range(-6, 9)]
        for k in range(8):
            t = CRAWL_T * k / 8
            rig.show(acts['crawl'], t)
            for post in posts:
                post.location = B(V(0, 0, -CRAWL_STRIDE / CRAWL_T * t))
            shoot(cam, f'beast-crawl-side-{k:02d}', 'walk')
            if k % 2 == 0:
                for post in posts:
                    post.location = (0, 0, -10)
                shoot(cam, f'beast-crawl-front-{k // 2:02d}', 'oncoming')
                shoot(cam, f'beast-crawl-above-{k // 2:02d}', 'walk-above')
        for post in posts:
            bpy.data.objects.remove(post)
        rig.rest()
    export(ob, rig, acts)


main()
