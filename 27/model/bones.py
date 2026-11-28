# What is left of the meals: small bones of birds and lizards, each one a clean parametric mesh, for
# public/bones.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 27/model/bones.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 27/model/bones.py -- render   # and process/bones-*.png
#   ... -- only bird_skull,lizard_skull   just those (with render: only their close-ups; nothing is exported)
#
# No sculpting and no remeshing: every bone is drawn from sections. Three ways of drawing do nearly all of it:
#   sweep   a ring carried along a line, its radii (and lobes, for condyles) changing on the way: long bones,
#           ribs, toes, bars
#   grid    a surface as rows and columns from a function of two parameters. Holes are cut along rows and
#           columns and their rim is then moved on to an ellipse on that same surface, so an orbit is round
#           without a boolean. A closed grid (the bird's skull) gets its holes bridged from side to side; an
#           open one (the lizard's skull, a pelvis, a breastbone) is given thickness afterwards
#   strings vertebrae, toes: the same small part placed again and again along a line
# Built in millimetres in the page's axes (Y up, a bone's front towards +Z), then turned the way it would lie:
# the piece is set down on the face of its convex hull that it balances on, nearest to the side it is meant to
# lie on, its lowest point at y = 0, centred in x and z. Then into metres.
#
# In the file: one node and one mesh for each bone, no skin, no animation, one white untextured material; the
# tone is in COLOR_0 (linear): old ivory to tan, greyer and darker in the hollows (measured: rays from every
# vertex), earth-stained underneath, a few gone a little green on top.

import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_tri

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'public', 'bones.glb'))
PROC = os.path.abspath(os.path.join(HERE, '..', 'process'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = 'render' in ARGS
SHEET, CLOSE = RENDER or 'sheet' in ARGS, RENDER or 'close' in ARGS
ONLY = ARGS[ARGS.index('only') + 1].split(',') if 'only' in ARGS else None
TAU = math.pi * 2
rnd = random.Random(27)


def V(*a):
    return np.array(a, dtype=float)


def unit(v):
    return v / np.linalg.norm(v)


def ss(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def curve(rows):
    """a smooth function through rows of (x, value...), x rising: Hermite, flat past the ends"""
    xs = [r[0] for r in rows]
    ys = [np.array(r[1:], dtype=float) for r in rows]
    n = len(xs)
    m = [(ys[min(n - 1, k + 1)] - ys[max(0, k - 1)]) / (xs[min(n - 1, k + 1)] - xs[max(0, k - 1)]) for k in range(n)]

    def f(x):
        if x <= xs[0]:
            y = ys[0]
        elif x >= xs[-1]:
            y = ys[-1]
        else:
            k = max(i for i in range(n - 1) if xs[i] <= x)
            h = xs[k + 1] - xs[k]
            t = (x - xs[k]) / h
            y = (2 * t ** 3 - 3 * t * t + 1) * ys[k] + (t ** 3 - 2 * t * t + t) * h * m[k] + (-2 * t ** 3 + 3 * t * t) * ys[k + 1] + (t ** 3 - t * t) * h * m[k + 1]
        return float(y[0]) if len(y) == 1 else y
    return f


def dense(rows, steps):
    """rows of numbers, `steps` rows for each one, through them (Catmull-Rom)"""
    rows = [np.array(r, dtype=float) for r in rows]
    n = len(rows)
    out = []
    for i in range(n - 1):
        p0, p1, p2, p3 = rows[max(0, i - 1)], rows[i], rows[i + 1], rows[min(n - 1, i + 2)]
        for s in range(steps):
            f = s / steps
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3))
    out.append(rows[-1])
    return out


def rot(axis, deg):
    """a 3x3 turn about x, y or z"""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return {'x': V((1, 0, 0), (0, c, -s), (0, s, c)), 'y': V((c, 0, s), (0, 1, 0), (-s, 0, c)), 'z': V((c, -s, 0), (s, c, 0), (0, 0, 1))}[axis]


# ---- drawing ---------------------------------------------------------------------------------------------------
class Part:
    """vertices (mm) and faces; which way the faces look is put right at the end, shell by shell"""

    def __init__(self):
        self.v, self.f = [], []

    def add(self, verts, faces):
        base = len(self.v)
        self.v += [np.array(p, dtype=float) for p in verts]
        self.f += [tuple(base + i for i in f) for f in faces]
        return base

    def merge(self, other, R=None, t=(0, 0, 0), scale=1.0):
        R = np.eye(3) if R is None else R
        self.add([R @ (p * scale) + np.array(t, dtype=float) for p in other.v], other.f)
        return self

    def moved(self, R=None, t=(0, 0, 0), scale=1.0):
        return Part().merge(self, R, t, scale)

    def sweep(self, pts, rx, ry, n=8, up=(0, 1, 0), cap=(0.6, 0.6), l2=None, l1=None, ph=0.0, dome=True):
        """a ring along pts: radius rx across (square to `up`) and ry along `up`, each a number or one per point;
        l2 squeezes it into two lobes, l1 pushes it out one way (towards ph); the ends are domed by `cap` radii"""
        pts = [np.array(p, dtype=float) for p in pts]
        m = len(pts)
        each = lambda a: [a] * m if np.isscalar(a) else list(a)
        rx, ry = each(rx), each(ry)
        l2, l1 = each(0.0 if l2 is None else l2), each(0.0 if l1 is None else l1)
        up = np.array(up, dtype=float)
        frames = []
        for k in range(m):
            T = unit(pts[min(m - 1, k + 1)] - pts[max(0, k - 1)])
            N = unit(up - T * (up @ T))
            frames.append((T, N, np.cross(T, N)))

        def ring(k, scale=1.0, shift=0.0):
            T, N, B = frames[k]
            out = []
            for j in range(n):
                th = TAU * j / n
                r = scale * (1 + l2[k] * math.cos(2 * th) + l1[k] * math.cos(th - ph))
                out.append(pts[k] + T * shift + B * (rx[k] * r * math.cos(th)) + N * (ry[k] * r * math.sin(th)))
            return out

        rings = []
        ends = []
        for k, sign, c in ((0, -1, cap[0]), (m - 1, 1, cap[1])):
            r = min(rx[k], ry[k])
            ends.append((ring(k, 0.66, sign * c * r * 0.62) if (c and dome) else None, pts[k] + frames[k][0] * sign * c * r))
        if ends[0][0]:
            rings.append(ends[0][0])
        rings += [ring(k) for k in range(m)]
        if ends[1][0]:
            rings.append(ends[1][0])
        verts = [p for r in rings for p in r] + [ends[0][1], ends[1][1]]
        faces = []
        for i in range(len(rings) - 1):
            for j in range(n):
                a, b = i * n + j, i * n + (j + 1) % n
                faces.append((a, b, b + n, a + n))
        last = (len(rings) - 1) * n
        for j in range(n):
            faces.append(((j + 1) % n, j, len(verts) - 2))
            faces.append((last + j, last + (j + 1) % n, len(verts) - 1))
        self.add(verts, faces)
        return self

    def bone(self, keys, steps=3, n=8, up=(0, 1, 0), cap=(0.6, 0.6), ph=0.0, dome=True):
        """a sweep through keys of (x, y, z, rx, ry[, l2[, l1]])"""
        rows = dense([list(k) + [0.0] * (7 - len(k)) for k in keys], steps)
        return self.sweep([r[:3] for r in rows], [r[3] for r in rows], [r[4] for r in rows], n, up, cap, [r[5] for r in rows], [r[6] for r in rows], ph, dome)

    def ball(self, c, radii, n=8, m=5, R=None):
        R = np.eye(3) if R is None else R
        c = np.array(c, dtype=float)
        verts = []
        for i in range(1, m):
            ph = math.pi * i / m
            verts += [c + R @ V(radii[0] * math.sin(ph) * math.cos(TAU * j / n), radii[1] * math.cos(ph), radii[2] * math.sin(ph) * math.sin(TAU * j / n)) for j in range(n)]
        verts += [c + R @ V(0, radii[1], 0), c - R @ V(0, radii[1], 0)]
        faces = []
        for i in range(m - 2):
            for j in range(n):
                a, b = i * n + j, i * n + (j + 1) % n
                faces.append((a, b, b + n, a + n))
        for j in range(n):
            faces.append((j, (j + 1) % n, len(verts) - 2))
            faces.append(((m - 2) * n + j, (m - 2) * n + (j + 1) % n, len(verts) - 1))
        self.add(verts, faces)
        return self


class Grid:
    """rows (i, along u) and columns (j, along v) of a surface; wrap: the columns close into a ring"""

    def __init__(self, surf, U, Vv, wrap=False):
        self.surf, self.U, self.Vv, self.wrap = surf, list(U), list(Vv), wrap
        self.I, self.J = len(U), len(Vv)
        self.P = [[np.array(surf(u, v), dtype=float) for v in Vv] for u in U]
        self.dead = set()
        self.extra = []

    def at(self, i, j):
        return i * self.J + j % self.J

    def hole(self, i0, i1, j0, j1, open_side=None, grow=1.0):
        """take the quads between rows i0..i1 and columns j0..j1 out, and put the rim on an ellipse in (u, v);
        open_side 'j0', 'j1', 'i0' or 'i1': the hole runs out over that edge of the grid, a notch"""
        for i in range(i0, i1):
            for j in range(j0, j1):
                self.dead.add((i, j))
        U, Vv = self.U, self.Vv
        uc, ru, vc, rv = (U[i0] + U[i1]) / 2, (U[i1] - U[i0]) / 2, (Vv[j0] + Vv[j1]) / 2, (Vv[j1] - Vv[j0]) / 2
        loop = [(i0, j) for j in range(j0, j1 + 1)] + [(i, j1) for i in range(i0 + 1, i1 + 1)] + [(i1, j) for j in range(j1 - 1, j0 - 1, -1)] + [(i, j0) for i in range(i1 - 1, i0, -1)]
        for i, j in loop:
            a, b = (U[i] - uc) / ru, (Vv[j] - vc) / rv
            if open_side in ('j0', 'j1'):
                edge = j0 if open_side == 'j0' else j1
                sign = 1 if open_side == 'j0' else -1
                if j == edge and i0 < i < i1:
                    continue
                b2 = (b + sign) / 2
                h = math.hypot(a, b2)
                u, v = uc + a / h * ru * grow, Vv[edge] + b2 / h * 2 * rv * grow
            elif open_side in ('i0', 'i1'):
                edge = i0 if open_side == 'i0' else i1
                sign = 1 if open_side == 'i0' else -1
                if i == edge and j0 < j < j1:
                    continue
                a2 = (a + sign) / 2
                h = math.hypot(a2, b)
                u, v = U[edge] + a2 / h * 2 * ru * grow, vc + b / h * rv * grow
            else:
                h = math.hypot(a, b)
                u, v = uc + a / h * ru * grow, vc + b / h * rv * grow
            self.P[i][j] = np.array(self.surf(u, v), dtype=float)
        return loop

    def emit(self, part):
        faces = []
        for i in range(self.I - 1):
            for j in range(self.J if self.wrap else self.J - 1):
                if (i, j) not in self.dead:
                    faces.append((self.at(i, j), self.at(i, j + 1), self.at(i + 1, j + 1), self.at(i + 1, j)))
        return part.add([p for row in self.P for p in row], faces + self.extra)


def finish(part):
    """a part as a bmesh: loose vertices dropped, doubled ones welded, every shell facing out"""
    bm = bmesh.new()
    vs = [bm.verts.new(tuple(p)) for p in part.v]
    for f in part.f:
        if len(set(f)) >= 3:
            try:
                bm.faces.new([vs[i] for i in dict.fromkeys(f)])
            except ValueError:
                pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def thicken(part, thickness):
    """an open sheet into a plate of this thickness, grown inwards (Blender's solidify, even)"""
    bm = finish(part)
    me = bpy.data.meshes.new('sheet')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('sheet', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('thick', 'SOLIDIFY')
    m.thickness, m.offset, m.use_even_offset, m.use_rim, m.use_quality_normals = thickness, -1.0, True, True, True
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg).to_mesh()
    out = Part()
    out.add([tuple(v.co) for v in ev.vertices], [tuple(p.vertices) for p in ev.polygons])
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


# ---- the skulls ----------------------------------------------------------------------------------------------------
def bird_skull(s=1.0, beak=15.5, bw=4.7, btop=5.3, bbot=-3.4, tip=-3.7, hook=1.6, nostril=(1, 5, 6, 8), jaw=0.0):
    """A perching bird's skull, front towards +z, the hinge of the beak at 24.5 s.
    One closed surface drawn as sections: a round braincase, then only a roof, a thin wall down the middle and a
    rod underneath (the orbits are the two bays this leaves, and the wall has its window), then the beak, whose
    nostrils go right through. The cheek bars, quadrates and the struts of the palate are swept on."""
    zh = 24.5 * s
    L = zh + beak
    T = [0, .05, .11, .22, .34, .47, .60, .72, .82, .89, .95, 1]
    M = len(T) - 1
    CZ = [-0.3, 0.4, 1.4, 2.6, 4, 5.5, 7, 8.5, 10, 11.2, 12.2, 13.2, 14.1, 15, 16, 17, 18, 19, 20, 21, 22, 23, 23.8, 24.6]
    BU = [0.04, 0.10, 0.16, 0.22, 0.29, 0.37, 0.47, 0.60, 0.74, 0.87, 0.96]
    Z = [z * s for z in CZ] + [zh + u * beak for u in BU]
    roof = curve([(12.5, 7.6, 8.0, -5.0), (14.5, 5.2, 7.85, -4.75), (16.5, 3.3, 7.5, -4.4), (19, 2.5, 6.9, -4.05), (21.5, 2.9, 6.2, -3.7), (24.5, 4.2, 5.2, -3.4)])

    def section(z):
        """half width, top and bottom of each of the three kinds of section, and how much of each there is here"""
        zz = z / s
        wb, wk = 1 - ss(10.5, 16.5, zz), ss(21.8, 25.2, zz)
        e = math.sqrt(max(0.0, 1 - ((zz - 8.2) / 8.6) ** 2))
        o = roof(zz)
        u = min(1.0, max(0.0, (z - zh) / beak))
        return (wb, 1 - wb - wk, wk), (9.4 * e * s, (1.0 + 7.4 * e) * s, (1.0 - 6.6 * e) * s), (o[0] * s, o[1] * s, o[2] * s), \
            (bw * (1 - u) ** 0.8, tip + (btop - tip) * (1 - u ** hook), bbot + (tip - 0.25 - bbot) * u * u)

    def surf(z, v):
        """v runs 0..1 up the right side and 1..2 down the left"""
        t, side = (v, 1) if v <= 1 else (2 - v, -1)
        (wb, wo, wk), b, o, k = section(z)
        top, bot = wb * b[1] + wo * o[1] + wk * k[1], wb * b[2] + wo * o[2] + wk * k[2]
        if t <= 0 or t >= 1:
            x = 0.0
        else:
            xb = b[0] * math.sin(math.pi * t) ** 0.6
            xo = s * 0.45 + (o[0] - s * 0.45) * ss(.66, .96, t) ** 1.25 + s * 0.5 * (1 - ss(.04, .12, t))
            xk = k[0] * (1 - t ** 1.7) ** 0.8
            x = wb * xb + wo * xo + wk * xk
        return V(side * x, bot + (top - bot) * t, z)

    g = Grid(surf, Z, T + [2 - t for t in T[-2:0:-1]], wrap=True)
    mirror = lambda loop: [(i, (2 * M - j) % (2 * M)) for i, j in loop]

    def through(i0, i1, j0, j1):
        """a hole in the right side, the same in the left, and a wall round between them"""
        right = g.hole(i0, i1, j0, j1)
        g.hole(i0, i1, 2 * M - j1, 2 * M - j0)
        left = mirror(right)
        for k in range(len(right)):
            a, b = right[k], right[(k + 1) % len(right)]
            c, d = left[(k + 1) % len(left)], left[k]
            g.extra.append((g.at(*a), g.at(*b), g.at(*c), g.at(*d)))

    through(CZ.index(15), CZ.index(23), 2, 8)                                        # the orbits: the wall between them is mostly window
    through(len(CZ) + nostril[0], len(CZ) + nostril[1], nostril[2], nostril[3])   # the nostrils
    part = Part()
    base = g.emit(part)
    back, front = len(part.v), len(part.v) + 1
    part.v += [V(0, 1.0 * s, -0.42 * s), V(0, tip - 0.35, L + 0.35)]
    for j in range(2 * M):
        part.f.append((base + g.at(0, j + 1), base + g.at(0, j), back))
        part.f.append((base + g.at(g.I - 1, j), base + g.at(g.I - 1, j + 1), front))

    for sx in (1, -1):
        q = lambda x, y, z: V(sx * x * s, y * s, z * s)
        # quadrate, the cheek bar from it to the corner of the beak, the strut of the palate
        part.bone([list(q(5.0, 0.6, 12.2)) + [0.9 * s, 1.1 * s], list(q(6.6, -3.2, 12.8)) + [0.62 * s, 0.8 * s], list(q(7.1, -5.4, 13.2)) + [0.8 * s, 0.75 * s]], steps=3, n=8, up=(0, 0, 1), cap=(0.6, 0.8))
        part.bone([list(q(7.6, -5.3, 13.2)) + [0.36 * s, 0.42 * s], list(q(6.9, -5.0, 18.5)) + [0.30 * s, 0.36 * s], list(V(sx * (bw - 0.35), bbot + 0.25, zh + 0.6)) + [0.34 * s, 0.42 * s]], steps=4, n=5, cap=(0.4, 0.4), dome=False)
        part.bone([list(q(6.2, -5.2, 13.4)) + [0.34 * s, 0.30 * s], list(q(1.5, -4.6, 18.5)) + [0.42 * s, 0.30 * s], list(V(sx * min(1.7 * s, bw * 0.4), bbot + 0.1, zh + 1.0)) + [0.5 * s, 0.3 * s]], steps=4, n=5, cap=(0.4, 0.4), dome=False)
    if jaw:
        # the lower jaw: two thin blades that meet at the tip, hung from the quadrates and dropped open a little
        lower = Part()
        tipz = L - 1.2
        for sx in (1, -1):
            lower.bone([
                [sx * 7.6 * s, -6.3 * s, 10.6 * s, 0.50 * s, 0.75 * s], [sx * 7.3 * s, -6.2 * s, 13.0 * s, 0.42 * s, 1.0 * s],
                [sx * 5.6 * s, -5.9 * s, 19.0 * s, 0.34 * s, 1.25 * s], [sx * bw * 0.72, bbot - 1.5, zh + 1.0, 0.34 * s, 1.15 * s],
                [sx * bw * 0.3, bbot - 1.3, zh + beak * 0.55, 0.42 * s, 0.95 * s], [0, tip - 0.75, tipz, 0.45 * s, 0.5 * s],
            ], steps=4, n=6, cap=(0.5, 0.7))
        pivot = V(0, -6.0 * s, 12.6 * s)
        R = rot('x', jaw)
        part.add([R @ (p - pivot) + pivot + V(0, -0.2, 0.3) for p in lower.v], lower.f)
    return part


def lizard_skull():
    """A lizard's skull, 30 mm, snout towards +z: a low wedge of thin bone, open underneath. One sheet from rim to
    rim over the top, with the nostrils, the orbits and the upper temporal windows cut in it and the cheek behind
    the eye cut away to the rim (lizards have no bar there); then given thickness. Teeth along the rims."""
    S = [0, 0.14, 0.28, 0.42, 0.52, 0.62, 0.72, 0.82, 0.91, 1.0]
    Z = [0, 1.2, 2.4, 3.6, 4.8, 6.0, 7.2, 8.4, 9.6, 10.8, 12, 13.2, 14.4, 15.6, 16.8, 18, 19.2, 20.5, 22, 23.5, 25, 26.2, 27.4, 28.6, 29.6]
    # half width at the rim, half width of the flat top, height of the top, height of the rim
    sec = curve([(0, 9.6, 7.0, 7.0, -0.9), (4, 9.9, 7.3, 7.6, -0.3), (9.6, 9.3, 5.4, 7.8, 0.0), (14.4, 8.0, 2.5, 7.4, 0.0), (19.2, 6.0, 2.4, 6.0, 0.0),
                 (24, 4.2, 2.2, 4.4, 0.0), (28, 2.5, 1.1, 2.9, 0.1), (29.6, 1.5, 0.6, 2.1, 0.5)])
    sc = 0.42

    def surf(z, v):
        W, Tw, H, rim = sec(z)
        a = abs(v)
        if a <= sc:
            x, y = Tw * a / sc, H - 0.45 * (a / sc) ** 2
        else:
            t = (a - sc) / (1 - sc)
            x, y = Tw + (W - Tw) * (1 - (1 - t) ** 1.7), (H - 0.45) + (rim - (H - 0.45)) * t ** 1.35
        return V(math.copysign(x, v), y, z)

    Vv = [-a for a in S[:0:-1]] + S
    n = len(S) - 1                      # the middle column
    g = Grid(surf, Z, Vv)
    for side in (1, -1):
        col = lambda a, b: (n + a, n + b) if side > 0 else (n - b, n - a)
        g.hole(2, 7, *col(1, 3))                                    # upper temporal window
        g.hole(1, 8, *col(4, 9), open_side='j1' if side > 0 else 'j0')     # the cheek behind the eye, open to the rim
        g.hole(9, 15, *col(2, 8))                                   # orbit, looking up as much as out
        g.hole(20, 22, *col(2, 4))                                  # nostril
    g.hole(0, 1, n - 1, n + 1, open_side='i0')                      # the back edge of the roof, notched
    sheet = Part()
    base = g.emit(sheet)
    nose = len(sheet.v)
    sheet.v.append(V(0, 1.2, 30.25))
    for j in range(g.J - 1):
        sheet.f.append((base + g.at(g.I - 1, j), base + g.at(g.I - 1, j + 1), nose))
    part = thicken(sheet, 0.55)
    # the braincase under the back of the roof, and its knob
    part.ball((0, 3.5, 2.6), (3.7, 2.7, 3.3), n=10, m=6)
    part.ball((0, 1.7, -0.5), (0.9, 0.8, 0.9), n=6, m=4)
    for sx in (1, -1):                                               # its two arms out to the corners of the skull
        part.bone([[sx * 2.6, 4.2, 1.8, 0.7, 0.6], [sx * 5.6, 4.6, 1.3, 0.42, 0.5], [sx * 8.2, 4.4, 0.9, 0.5, 0.6]], steps=3, n=7, up=(0, 0, 1), cap=(0, 0.3))
    # teeth: a row of fine pegs down each upper rim
    z = 11.8
    while z < 28.4:
        W, Tw, H, rim = sec(z)
        for sx in (1, -1):
            peg(part, V(sx * (W - 0.28), rim + 0.15, z), V(sx * 0.05, -1, 0.05), 0.95 - 0.25 * ss(22, 28.4, z), 0.21)
        z += 0.78
    return part


def peg(part, base, d, length, r, n=4):
    """a tooth: a small cone"""
    d = unit(np.array(d, dtype=float))
    ax = unit(np.cross(d, V(0, 0, 1) if abs(d[2]) < 0.9 else V(1, 0, 0)))
    ay = np.cross(d, ax)
    b = part.add([base + (ax * math.cos(TAU * j / n) + ay * math.sin(TAU * j / n)) * r for j in range(n)] + [base + d * length], [(j, (j + 1) % n, n) for j in range(n)])


def lizard_jaw():
    """the lower jaw: two bars joined at the chin, each rising to a point behind the teeth, a row of pegs on top"""
    part = Part()
    for sx in (1, -1):
        keys = [[sx * 9.3, 0.9, -2.6, 0.40, 0.55], [sx * 9.4, 1.0, -0.6, 0.55, 0.95], [sx * 9.3, 1.1, 1.2, 0.62, 0.85], [sx * 9.2, 1.6, 4.5, 0.50, 1.55],
                [sx * 9.0, 2.4, 7.6, 0.45, 2.35], [sx * 8.7, 1.75, 10.2, 0.48, 1.70], [sx * 7.6, 1.45, 15.0, 0.50, 1.40], [sx * 5.6, 1.25, 21.0, 0.48, 1.20],
                [sx * 3.2, 1.05, 26.0, 0.45, 1.00], [sx * 1.0, 0.9, 29.0, 0.50, 0.85], [0, 0.85, 29.7, 0.5, 0.75]]
        part.bone(keys, steps=2, n=6, cap=(0.6, 0.5))
        path = curve([(k[2], k[0], k[1] + k[4]) for k in keys])
        z = 11.2
        while z < 29.0:
            x, y = path(z)
            peg(part, V(x - sx * 0.12, y - 0.12, z), V(sx * 0.05, 1, 0.03), 0.9 - 0.2 * ss(22, 29, z), 0.2)
            z += 0.8
    return part


# ---- vertebrae and what hangs on them -------------------------------------------------------------------------------
def vertebra(length, r, spine=1.6, wings=0.0, n=6, canal=False):
    """one vertebra, its axis along z, its back upwards: the spool of the body, the arch over it rising to a
    ridge that leans back, and the processes out to the sides. canal: the arch is a real arch, open through"""
    part = Part()
    h = length / 2
    part.bone([[0, 0, -h, r * 1.12, r * 1.05], [0, 0, -h * 0.4, r * 0.86, r * 0.84], [0, 0, h * 0.4, r * 0.86, r * 0.84], [0, 0, h, r * 1.15, r * 1.08]],
              steps=1 if not canal else 2, n=n if not canal else 12, cap=(0.3, 0.3) if not canal else (0.3, 0.45), dome=canal)
    if canal:
        # the arch as a bent bar from one side of the body over to the other, and the spine as a blade on top
        rows = [[math.cos(math.pi * a / 10) * r * 0.86, r * 0.45 + math.sin(math.pi * a / 10) * r * 1.2, -h * 0.02, r * 0.3, h * 0.74] for a in range(11)]
        part.sweep([q[:3] for q in rows], [q[3] for q in rows], [q[4] for q in rows], n=8, up=(0, 0, 1), cap=(0, 0))
        top = r * 1.62
        part.bone([[0, top - r * 0.15, -h * 0.62, r * 0.28, r * 0.3], [0, top + spine * 0.45, -h * 0.2, r * 0.19, spine * 0.55], [0, top + spine * 0.62, h * 0.5, r * 0.19, spine * 0.68],
                   [0, top + spine * 0.7, h * 1.05, r * 0.15, spine * 0.4]], steps=3, n=8, cap=(0.6, 0.8))
        for sx in (1, -1):
            part.bone([[sx * r * 0.7, r * 0.95, -h * 0.1, r * 0.5, r * 0.36], [sx * (r * 1.4 + wings * 0.5), r * 1.05, -h * 0.05, r * 0.3, r * 0.17], [sx * (r * 1.3 + wings), r * 1.0, 0.05, r * 0.36, r * 0.15]],
                      steps=2, n=8, up=(0, 1, 0), cap=(0, 0.9))
            # the facets that lock it to its neighbours: two reaching forward and out, two back
            part.bone([[sx * r * 0.62, r * 1.3, -h * 0.5, r * 0.4, r * 0.3], [sx * r * 0.9, r * 1.5, -h * 0.95, r * 0.42, r * 0.2], [sx * r * 1.08, r * 1.62, -h * 1.3, r * 0.34, r * 0.16]],
                      steps=2, n=6, up=(0, 1, 0), cap=(0, 0.8))
            part.bone([[sx * r * 0.5, r * 1.5, h * 0.5, r * 0.4, r * 0.3], [sx * r * 0.62, r * 1.66, h * 0.95, r * 0.4, r * 0.2], [sx * r * 0.7, r * 1.74, h * 1.3, r * 0.32, r * 0.16]],
                      steps=2, n=6, up=(0, 1, 0), cap=(0, 0.8))
        return part
    # the arch and its ridge as one small hull over the body: wide at the two ends, where it locks to its neighbours
    T = [0, 0.28, 0.62, 0.86, 1] if n >= 8 else [0, 0.3, 0.7, 1]
    zs = [-h * 0.95, -h * 0.25, h * 0.45, h * 1.05] if n >= 8 else [-h * 0.95, h * 0.1, h * 1.05]

    def arch(z, v):
        t, side = (v, 1) if v <= 1 else (2 - v, -1)
        f = (z + h) / length
        top = r * 1.15 + spine * (0.5 + 0.5 * ss(0.0, 0.85, f))
        flare = 1.0 + 0.45 * abs(2 * f - 0.95) ** 2
        x = 0 if (t < 1e-6 or t > 1 - 1e-6) else r * 1.0 * flare * (1 - t) ** 1.8 + r * 0.13
        return V(side * x, r * 0.35 + (top - r * 0.35) * t, z)
    g = Grid(arch, zs, T + [2 - t for t in T[-2:0:-1]], wrap=True)
    base = g.emit(part)
    for i, zc in ((0, zs[0] - 0.12 * r), (g.I - 1, zs[-1] + 0.12 * r)):
        c = len(part.v)
        part.v.append(V(0, r * 0.9, zc))
        for j in range(g.J):
            part.f.append((base + g.at(i, j), base + g.at(i, j + 1), c))
    if wings > 0.25 * r:
        for sx in (1, -1):         # a flat blade out to each side
            part.sweep([V(sx * r * 0.6, r * 0.5, -h * 0.15), V(sx * (r * 0.95 + wings), r * 0.42, -h * 0.02)],
                       [r * 0.5, r * 0.22], [r * 0.3, r * 0.15], n=4, up=(0, 1, 0), cap=(0, 0.8), dome=False)
    return part


def along(path, k, heading=True):
    """where and which way the k-th point of a path of points faces: a turn about y from +z"""
    p = np.array(path[k], dtype=float)
    d = np.array(path[min(len(path) - 1, k + 1)], dtype=float) - np.array(path[max(0, k - 1)], dtype=float)
    return p, rot('y', math.degrees(math.atan2(d[0], d[2])))


def lizard_spine():
    """fourteen vertebrae of the trunk in a gentle curve, the front ones (+z) with their ribs still on"""
    part = Part()
    count, pitch = 12, 6.3
    path = [V(11 * math.sin(k / (count - 1) * 2.2 - 0.7), 0, k * pitch * 0.985) for k in range(count)]
    for k in range(count):
        p, R = along(path, k)
        R = R @ rot('z', rnd.uniform(-5, 5)) @ rot('x', rnd.uniform(-3, 3))
        part.merge(vertebra(5.5, 1.5, spine=1.5, wings=1.1), R, p)
        if k >= 6:
            for sx in (1, -1):
                if k == 8 and sx < 0:
                    continue                      # one lost
                length = 13.5 - 0.9 * abs(k - 9) + rnd.uniform(-0.5, 0.5)
                swing = rnd.uniform(-6, 6) + (22 if (k == 10 and sx > 0) else 0)
                rib = Part().bone([[sx * 2.3, 0.8, -0.3, 0.42, 0.42], [sx * (2.3 + length * 0.42), 0.2, -0.9, 0.3, 0.3], [sx * (2.3 + length * 0.66), -length * 0.34, -1.9, 0.27, 0.27],
                                   [sx * (2.3 + length * 0.64), -length * 0.72, -2.7, 0.22, 0.22]], steps=2, n=3, cap=(0.4, 0.8), dome=False)
                part.merge(rib, R @ rot('y', sx * swing), p)
    return part


def lizard_tail():
    """the tail: a string of ever smaller vertebrae, curled, broken once"""
    part = Part()
    p = V(0, 0, 0)
    heading = 20.0
    for k in range(13):
        f = k / 12
        length, r = lerp(4.6, 1.7, f ** 0.8), lerp(1.25, 0.42, f ** 0.7)
        heading += -10 - 15 * f + (38 if k == 8 else 0)
        R = rot('y', heading) @ rot('z', rnd.uniform(-8, 8))
        d = R @ V(0, 0, 1)
        p = p + d * length * 0.53
        part.merge(vertebra(length * 0.9, r, spine=lerp(1.1, 0.25, f), wings=lerp(1.5, 0.0, min(1, f * 1.8))), R, p + V(0, 0, 0) + (V(1.2, 0, -0.6) if k >= 8 else 0))
        p = p + d * length * 0.53
    return part


def bird_rib(length=22.0, hook=True, n=6):
    """a bird's rib, its head at the origin, hanging down -y and out +x, flat fore and aft, with the little
    flat hook that points back over the next rib"""
    part = Part()
    keys = [[-0.6, 0.5, 0.0, 0.32, 0.55], [1.2, 0.2, 0.0, 0.3, 0.6], [length * 0.30, -length * 0.16, -0.4, 0.3, 0.72], [length * 0.43, -length * 0.50, -1.0, 0.3, 0.78],
            [length * 0.40, -length * 0.80, -1.4, 0.3, 0.7], [length * 0.30, -length * 1.0, -1.5, 0.34, 0.6]]
    part.bone(keys, steps=2 if n < 8 else 3, n=n, up=(0, 0, 1), cap=(0.5, 0.7), dome=False)
    part.bone([[0.9, 0.3, 0.3, 0.3, 0.3], [0.2, 1.3, 0.5, 0.36, 0.36]], steps=1, n=5, up=(0, 0, 1), cap=(0, 0.6), dome=False)      # its second head
    if hook:
        part.bone([[length * 0.42, -length * 0.48, -0.9, 0.95, 0.2], [length * 0.44, -length * 0.41, -3.0, 0.85, 0.18], [length * 0.435, -length * 0.35, -5.2, 0.45, 0.15]],
                  steps=1, n=5, up=(1, 0, 0), cap=(0, 0.9), dome=False)
    return part


def bird_ribcage():
    """a stretch of a bird's back, six vertebrae with their tall ridge, ribs still on: four on one side, two on
    the other, one of them sprung"""
    part = Part()
    pitch = 4.3
    for k in range(6):
        p = V(0, 0, (k - 2.5) * pitch)
        part.merge(vertebra(4.5, 1.2, spine=3.0, wings=2.2), None, p)
        for sx, there in ((1, k in (1, 2, 3, 4)), (-1, k in (2, 4))):
            if not there:
                continue
            rib = bird_rib(length=19 + 2.2 * math.sin(k * 0.9), hook=True, n=4)
            sprung = sx < 0 and k == 4
            R = (rot('z', -24 if sprung else rnd.uniform(-4, 4)) @ rot('y', 18 if sprung else rnd.uniform(-4, 4)))
            flip = np.diag([sx, 1.0, 1.0])
            part.add([p + V(sx * 3.3, 0.7, 0) + flip @ (R @ q) for q in rib.v], rib.f)
    return part


def loose_vertebra():
    return vertebra(6.6, 1.9, spine=3.0, wings=3.4, canal=True)


def loose_rib():
    return bird_rib(length=26.0, hook=True, n=8)


# ---- plates ------------------------------------------------------------------------------------------------------------
def bird_sternum():
    """a breastbone: a shallow dish, notched at the back, with the deep keel the flight muscles pulled on"""
    S = [0, 0.25, 0.45, 0.62, 0.8, 1.0]
    Z = [0, 1.5, 3.0, 4.6, 6.4, 8.4, 10.6, 13, 15.5, 18, 20.4, 22.4, 23.8]
    width = curve([(0, 7.6), (3, 7.8), (8, 6.4), (14, 5.6), (20, 6.6), (23.8, 5.6)])

    def dish(z, v):
        w = width(z)
        return V(v * w, 2.4 * v * v * (0.7 + 0.3 * z / 24), z)
    n = len(S) - 1
    g = Grid(dish, Z, [-a for a in S[:0:-1]] + S)
    g.hole(0, 4, n + 2, n + 4, open_side='i0')
    g.hole(0, 4, n - 4, n - 2, open_side='i0')
    part = thicken(Part().merge(_emit(g)), 0.5)
    depth = lambda z: 9.6 * (z / 23.8) ** 0.85

    def keel(z, v):
        lean = 1.6 * v * (z / 23.8) ** 2
        return V(0, 0.15 - depth(z) * v, z + lean - 1.2 * v * v * (z > 23))
    k = Grid(keel, Z[1:], [0, 0.34, 0.68, 1.0])
    part.merge(thicken(Part().merge(_emit(k)), 0.42), t=(0.21, 0, 0))
    part.bone([[0, 0.3, 23.6, 0.5, 0.5], [0, -0.6, 25.3, 0.36, 0.45], [0, -1.0, 26.6, 0.2, 0.25]], steps=2, n=6, cap=(0, 0.6), dome=False)     # the spike in front
    for sx in (1, -1):                                                                                                                    # the corners
        part.bone([[sx * 5.0, 1.4, 23.2, 0.5, 0.4], [sx * 6.6, 2.4, 24.6, 0.4, 0.3], [sx * 7.6, 3.4, 25.2, 0.22, 0.2]], steps=2, n=5, cap=(0, 0.6), dome=False)
    return part


def _emit(g):
    p = Part()
    g.emit(p)
    return p


def bird_pelvis():
    """hips and fused back as one long shield: narrow sloping blades in front, pinched at the hips, then a broad
    low roof whose sides turn down as walls; the hip socket goes right through each wall and behind it the long
    window; the thin pubic rods trail along underneath and out behind"""
    S = [0, 0.1, 0.28, 0.5, 0.62, 0.74, 0.87, 1.0]
    sk = 0.5
    Z = [0, 1.6, 3.2, 4.8, 6.4, 8.0, 9.6, 11.2, 12.6, 13.9, 15.2, 16.5, 18, 20, 22.2, 24.6, 27, 29.4, 31.6, 33]
    # ridge height, half width of the roof, half width at the lower edge, fall of the roof, depth of the wall
    sec = curve([(0, 4.4, 4.2, 6.2, 1.5, 3.6), (6, 5.8, 6.4, 8.6, 1.8, 5.4), (12, 6.5, 5.6, 7.6, 1.6, 5.0), (15.2, 6.8, 4.3, 5.6, 1.5, 3.4), (18, 6.8, 3.6, 4.0, 2.2, 0.7),
                 (24, 6.2, 4.4, 4.6, 3.1, 0.3), (30, 5.3, 5.5, 5.7, 3.3, 0.3), (33, 4.6, 4.4, 4.5, 2.4, 0.2)])

    def roof(z, v):
        ridge, wt, w, d1, d2 = sec(z)
        a = abs(v)
        if a <= sk:
            x, y = wt * a / sk, ridge - d1 * (a / sk) ** 1.5 + 0.7 * max(0.0, 1 - a / 0.11) ** 2
        else:
            t = (a - sk) / (1 - sk)
            x, y = wt + (w - wt) * t ** 0.8, ridge - d1 - d2 * t ** 1.1
        return V(math.copysign(x, v), y, z)
    n = len(S) - 1
    g = Grid(roof, Z, [-a for a in S[:0:-1]] + S)
    for side in (1, -1):
        col = lambda a, b: (n + a, n + b) if side > 0 else (n - b, n - a)
        g.hole(9, 11, *col(4, 6))                 # hip socket
        g.hole(2, 8, *col(4, 7))                  # the long window behind it
    g.hole(0, 2, n - 3, n + 3, open_side='i0')    # and the back edge is cut in where the tail went on
    part = thicken(_emit(g), 0.5)
    ridge = lambda z: sec(z)[0]
    part.bone([[0, ridge(1) - 2.2, 0.8, 0.8, 0.7], [0, ridge(9) - 2.5, 9, 1.2, 0.95], [0, ridge(18) - 2.6, 18, 1.4, 1.1], [0, ridge(32) - 2.3, 32.6, 1.1, 1.0]], steps=3, n=8, cap=(0.5, 0.5))
    for z in (4.0, 7.5, 11.0, 14.5, 19.0, 23.5, 28.0):               # the fused back's ribs, as struts under the roof
        _, wt, w, d1, d2 = sec(z)
        for sx in (1, -1):
            part.sweep([V(sx * 0.9, ridge(z) - 2.5, z), V(sx * wt * 0.8, ridge(z) - d1 * 0.8 ** 1.5 - 0.5, z)], 0.4, 0.3, n=4, up=(0, 0, 1), cap=(0, 0), dome=False)
    for sx in (1, -1):
        part.bone([[sx * 5.5, 1.5, 14.2, 0.42, 0.42], [sx * 7.4, -0.3, 8.0, 0.3, 0.32], [sx * 8.0, -1.0, 1.5, 0.28, 0.3], [sx * 6.6, -0.9, -4.5, 0.3, 0.26]], steps=4, n=5, cap=(0.4, 0.8), dome=False)
    return part


def wishbone():
    part = Part()
    rows = []
    for k in range(-13, 14):
        a = k / 13
        rows.append([8.4 * math.copysign(abs(a) ** 0.8, a), 0, 21 * abs(a) ** 1.7, lerp(0.42, 0.85, ss(0.75, 1.0, abs(a))), lerp(0.55, 0.36, ss(0.75, 1.0, abs(a)))])
    part.sweep([r[:3] for r in rows], [r[3] for r in rows], [r[4] for r in rows], n=7, cap=(0.9, 0.9))
    part.bone([[0, 0, 0.5, 0.7, 0.45], [0, -0.1, -1.4, 0.8, 0.26], [0, -0.1, -2.9, 0.45, 0.2]], steps=3, n=8, cap=(0, 0.6))
    return part


def bird_femur():
    part = Part()
    part.bone([[0, 0, 0, 2.1, 1.5, 0.24], [0, 0, 1.4, 2.0, 1.45, 0.16], [0.1, 0.25, 4.0, 1.25, 1.1], [0.1, 0.5, 11, 0.95, 0.95], [0, 0.3, 17.5, 1.1, 1.0],
               [-0.35, 0, 20.4, 1.7, 1.2], [-0.5, 0, 22.0, 1.4, 1.05]], steps=3, n=8, cap=(0.9, 0.9))
    part.bone([[0.4, 0, 20.0, 0.8, 0.8], [1.5, 0, 20.5, 0.72, 0.72], [2.35, 0, 20.9, 1.05, 1.05], [2.9, 0, 21.1, 0.95, 0.95]], steps=3, n=8, up=(0, 0, 1), cap=(0, 0.9))
    return part


def bird_tibia():
    part = Part()
    part.bone([[0, 0, 0, 1.75, 1.3, 0.28], [0, 0, 1.6, 1.6, 1.25, 0.2], [0, 0.1, 4.2, 0.92, 0.86], [0, 0.4, 20, 0.76, 0.76], [0, 0.3, 36, 0.95, 0.9],
               [0, 0.4, 42, 1.45, 1.3, 0, 0.22], [0, 0.6, 45, 2.0, 1.7, 0, 0.3], [0, 0.4, 46.2, 1.8, 1.5, 0, 0.2]], steps=3, n=8, cap=(0.9, 0.7), ph=math.pi / 2)
    part.bone([[1.95, 0.3, 45.2, 0.5, 0.5], [1.5, 0.3, 40, 0.36, 0.36], [1.05, 0.35, 31, 0.26, 0.26], [0.8, 0.4, 22, 0.14, 0.14]], steps=3, n=5, cap=(0.6, 0.6), dome=False)
    return part


def bird_humerus():
    part = Part()
    part.bone([[0, 0, 0, 2.3, 1.2, 0.24], [0.1, 0, 1.6, 2.0, 1.1, 0.14], [0.5, 0.1, 6, 1.1, 0.95], [0.3, 0.3, 14, 1.05, 1.0], [-0.3, 0.2, 21, 1.9, 1.1],
               [-0.5, 0, 25, 3.1, 1.2, 0, 0.22], [-0.3, 0, 27.2, 2.7, 1.05]], steps=3, n=10, cap=(0.9, 0.9), ph=0.0)
    return part


def bird_forearm():
    """ulna and radius as they lie together: the stouter bowed one and the thin straight one, touching at their ends"""
    part = Part()
    part.bone([[0, 0, 0, 1.25, 0.95, 0.12], [0.5, 0, 3, 0.95, 0.9], [1.9, 0, 12, 0.86, 0.86], [2.3, 0, 19, 0.86, 0.86], [1.6, 0, 29, 0.95, 0.9],
               [0.4, 0, 35, 1.5, 1.25], [0.2, 0, 36.6, 1.2, 1.0]], steps=3, n=8, cap=(0.9, 0.9))
    part.bone([[-1.6, 0, 0.8, 0.85, 0.7], [-1.5, 0, 3, 0.5, 0.5], [-1.2, 0, 17, 0.46, 0.46], [-1.3, 0, 31, 0.5, 0.5], [-1.5, 0, 34.3, 0.8, 0.75]], steps=3, n=6, cap=(0.9, 0.9))
    return part


def claw(length, r, n=6):
    """a claw, its root at the origin, pointing +z and hooking round towards +x"""
    rows = []
    for k in range(5):
        f = k / 4
        a = math.radians(70) * f
        R = length / math.radians(70)
        rows.append([R * (1 - math.cos(a)), 0, R * math.sin(a), r * (1 - f) ** 0.7 + 0.03, r * 1.25 * (1 - f) ** 0.7 + 0.03])
    return Part().sweep([q[:3] for q in rows], [q[3] for q in rows], [q[4] for q in rows], n=n, cap=(0.4, 0.3), dome=False)


def toe(part, start, heading, lengths, r, curl, claw_length, n=6, hook=1, steps=2):
    """a toe as a chain in the ground plane: each joint turns `curl` further, and a claw at the end"""
    p = np.array(start, dtype=float)
    for k, length in enumerate(lengths):
        heading += curl * (1 if k else 0.4)
        R = rot('y', heading)
        rr = r * (1 - 0.13 * k)
        b = Part().bone([[0, 0, 0, rr * 1.2, rr * 1.05, 0.12], [0, 0, length * 0.25, rr * 0.74, rr * 0.72], [0, 0, length * 0.7, rr * 0.7, rr * 0.68], [0, 0, length, rr * 1.05, rr * 0.9, 0.16]],
                        steps=steps, n=n, cap=(0.5, 0.6), dome=False)
        part.merge(b, R, p)
        p = p + R @ V(0, 0, length + rr * 0.35)
    if claw_length:
        part.merge(claw(claw_length, r * 0.78, n), rot('y', heading + curl * 0.6) @ np.diag([hook, 1.0, 1.0]), p - rot('y', heading) @ V(0, 0, r * 0.2))
    return p


def bird_foot():
    """the long foot bone and the four toes, three forward and one back, lying flat with the claws hooked over"""
    part = Part()
    part.bone([[0, 0, -24, 1.7, 1.3, 0, 0.2], [0, 0, -22.3, 1.55, 1.2, 0, 0.14], [0, 0, -19, 0.95, 0.8], [0, 0, -9, 0.85, 0.72], [0, 0, -3.4, 1.25, 0.8, 0.1], [0, 0, -1.6, 1.8, 0.85, 0.2]],
              steps=3, n=8, cap=(0.8, 0.2), ph=math.pi / 2)
    for x, r in ((-1.25, 0.62), (0.0, 0.7), (1.25, 0.62)):                           # the three pulleys the toes run on
        part.bone([[x, 0, -1.8, r, r * 1.05], [x * 1.25, 0, -0.2, r * 1.05, r * 1.1], [x * 1.3, 0, 0.5, r * 0.9, r]], steps=2, n=6, cap=(0, 0.9))
    toe(part, (-1.9, 0, 1.0), -30, [5.6, 4.6], 0.62, -9, 4.2, n=5, hook=-1)
    toe(part, (0, 0, 1.4), 2, [6.2, 5.2, 4.3], 0.66, 7, 4.6, n=5, hook=1)
    end = toe(part, (1.9, 0, 1.0), 31, [3.7, 3.1, 2.9], 0.56, 8, 0, n=5, hook=1)
    # the outer toe has come apart: its last joint and claw lie a little way off
    toe(part, end + V(1.4, 0, 0.8), 78, [2.8], 0.48, 10, 3.8, n=5, hook=1)
    toe(part, (-0.9, 0, -3.2), -152, [4.8], 0.56, -12, 4.6, n=5, hook=-1)                 # the hind toe
    return part


def lizard_limb():
    """a lizard's hind leg lying bent: thigh, the two shin bones, and the long five-toed foot, the fourth toe longest"""
    part = Part()
    part.bone([[0, 0, 0, 1.15, 0.95], [0.6, 0, 1.5, 0.8, 0.75], [1.3, 0, 6.5, 0.6, 0.6], [0.7, 0, 11.5, 0.75, 0.7], [0.2, 0, 13.4, 1.3, 0.9, 0.2]], steps=3, n=8, cap=(0.7, 0.5))
    knee = V(0.2, 0, 14.0)
    Rs = rot('y', 112)
    for off, r, bow in ((-0.75, 0.52, 0.0), (0.8, 0.3, 0.5)):
        shin = Part().bone([[off, 0, 0, r * 1.5, r * 1.3], [off + bow * 0.6, 0, 3.0, r * 0.95, r * 0.95], [off + bow, 0, 7.0, r * 0.9, r * 0.9], [off * 0.9, 0, 10.2, r * 1.4, r * 1.2]], steps=3, n=7, cap=(0.6, 0.6))
        part.merge(shin, Rs, knee)
    ankle = knee + Rs @ V(0, 0, 10.9)
    part.ball(ankle + Rs @ V(-0.5, 0, 0.1), (0.75, 0.5, 0.55), n=7, m=4)
    part.ball(ankle + Rs @ V(0.6, 0, 0.2), (0.6, 0.45, 0.5), n=7, m=4)
    # five toes fanned from the ankle: a long bone each, then 2, 3, 4, 5 and 4 joints, the last a small claw
    for k, (count, meta, joint, turn) in enumerate(((2, 3.0, 1.9, -62), (3, 4.2, 2.0, -34), (4, 5.0, 2.1, -10), (5, 5.4, 2.1, 14), (4, 3.4, 2.0, 58))):
        heading = 112 + turn
        start = ankle + Rs @ V((k - 2) * 0.55, 0, 0.9)
        lengths = [meta] + [joint * (1 - 0.12 * j) for j in range(count - 1)]
        toe(part, start, heading, lengths, 0.36, rnd.uniform(3, 9) * (1 if k < 3 else -1), 1.5, n=4, hook=1 if k < 3 else -1, steps=1)
    return part


# ---- the set -------------------------------------------------------------------------------------------------------------
# name, how it is drawn, which of its sides it lies on (the way that is down, in the axes it is drawn in),
# its tone (0 ivory .. 1 tan), how green
PIECES = [
    ('bird_skull', lambda: bird_skull(), (0, -1, 0), 0.25, 0.0),
    ('bird_skull_small', lambda: bird_skull(s=0.74, beak=10.5, bw=4.3, btop=4.4, bbot=-2.6, tip=-2.3, hook=1.9, nostril=(1, 4, 6, 8)), (0.3, -1, 0), 0.55, 0.5),
    ('lizard_skull', lizard_skull, (0, -1, 0), 0.4, 0.0),
    ('lizard_jaw', lizard_jaw, (0, -1, 0), 0.6, 0.0),
    ('bird_sternum', bird_sternum, (0.15, 1, 0), 0.3, 0.0),
    ('bird_ribcage', bird_ribcage, (1, -0.4, 0), 0.5, 0.35),
    ('lizard_spine', lizard_spine, (0, -1, 0), 0.45, 0.0),
    ('lizard_tail', lizard_tail, (0, -1, 0), 0.7, 0.0),
    ('bird_pelvis', bird_pelvis, (0, -1, 0), 0.35, 0.6),
    ('wishbone', wishbone, (0, -1, 0), 0.2, 0.0),
    ('bird_femur', bird_femur, (0, -1, 0), 0.5, 0.0),
    ('bird_tibia', bird_tibia, (0, -1, 0), 0.3, 0.0),
    ('bird_humerus', bird_humerus, (0, -1, 0), 0.65, 0.4),
    ('bird_forearm', bird_forearm, (0, -1, 0), 0.4, 0.0),
    ('bird_foot', bird_foot, (0, -1, 0), 0.55, 0.0),
    ('vertebra', loose_vertebra, (0.3, -0.4, -1), 0.3, 0.0),
    ('rib', loose_rib, (0, 0, -1), 0.45, 0.0),
    ('lizard_limb', lizard_limb, (0, -1, 0), 0.6, 0.0),
]


def srgb(r, g, b):
    return V(r, g, b) ** 2.2


IVORY, TAN, HOLLOW, EARTH, GREEN = srgb(0.87, 0.82, 0.68), srgb(0.64, 0.52, 0.35), srgb(0.27, 0.24, 0.21), srgb(0.31, 0.21, 0.13), srgb(0.47, 0.53, 0.33)
RAYS = 28


def settle(bm, down):
    """turn the piece on to the face of its hull that it balances on, the nearest to `down`; on the ground, centred"""
    hull = bmesh.new()
    for v in bm.verts:
        hull.verts.new(v.co)
    bmesh.ops.convex_hull(hull, input=hull.verts)
    bmesh.ops.recalc_face_normals(hull, faces=hull.faces)
    c = sum((f.calc_center_median() * f.calc_area() for f in bm.faces), Vector()) / sum(f.calc_area() for f in bm.faces)
    down = Vector(down).normalized()
    best, score = None, -2
    for f in hull.faces:
        n = f.normal
        p = c - n * (c - f.verts[0].co).dot(n)
        vs = [v.co for v in f.verts]
        if any(intersect_point_tri(p, vs[0], vs[k], vs[k + 1]) for k in range(1, len(vs) - 1)) and n.dot(down) > score:
            best, score = n.copy(), n.dot(down)
    hull.free()
    R = best.rotation_difference(Vector((0, -1, 0))).to_matrix()
    bmesh.ops.transform(bm, matrix=R.to_4x4(), verts=bm.verts)
    lo = Vector((min(v.co[k] for v in bm.verts) for k in range(3)))
    hi = Vector((max(v.co[k] for v in bm.verts) for k in range(3)))
    bmesh.ops.translate(bm, vec=(-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2), verts=bm.verts)
    return math.degrees(math.acos(max(-1, min(1, score))))


def tone(bm, base, green, seed):
    """a colour for every vertex: the bone's own, darker and greyer where little sky reaches, stained below"""
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    tris = bm.calc_loop_triangles()
    span = max(max(v.co[k] for v in bm.verts) - min(v.co[k] for v in bm.verts) for k in range(3))
    ground = [Vector((-900, -0.05, -900)), Vector((900, -0.05, -900)), Vector((900, -0.05, 900)), Vector((-900, -0.05, 900))]
    pts = [v.co.copy() for v in bm.verts] + ground
    n = len(bm.verts)
    tree = BVHTree.FromPolygons(pts, [tuple(l.vert.index for l in t) for t in tris] + [(n, n + 1, n + 2, n + 3)])
    r = random.Random(seed)
    wave = lambda lo, hi: (Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))).normalized() * r.uniform(lo, hi), r.uniform(0, TAU))
    waves, fine = [wave(0.10, 0.35) for _ in range(4)], [wave(0.7, 1.8) for _ in range(4)]
    cols = []
    golden = math.pi * (3 - math.sqrt(5))
    for v in bm.verts:
        nrm = v.normal
        t1 = nrm.orthogonal().normalized()
        t2 = nrm.cross(t1)
        hit = 0.0
        for k in range(RAYS):
            z = math.sqrt((k + 0.5) / RAYS)                      # more rays near the normal, as the light falls
            rr = math.sqrt(1 - z * z)
            d = t1 * (rr * math.cos(k * golden)) + t2 * (rr * math.sin(k * golden)) + nrm * z
            h = tree.ray_cast(v.co + nrm * 0.02, d, max(4.0, span * 0.45))
            if h[0] is not None:
                hit += 1
        open_ = 1 - hit / RAYS
        noise = sum(math.sin(v.co.dot(w) + ph) for w, ph in waves) / 2.2          # broad patches
        grain = sum(math.sin(v.co.dot(w) + ph) for w, ph in fine) / 2.4           # mottling
        c = lerp(IVORY, TAN, min(1, max(0, base + 0.55 * noise + 0.22 * grain)))
        c = lerp(c, HOLLOW, 0.85 * (1 - open_) ** 1.15)
        # earth: underneath, along the line where it lies on the ground, and a little in every pocket
        under = max(ss(0.15, -0.6, nrm.y) * (1 - ss(1.0, 6.0, v.co.y)), 0.75 * (1 - ss(0.2, 2.2, v.co.y)))
        c = lerp(c, EARTH, min(0.8, 0.7 * under + 0.35 * (1 - open_) + 0.12 * max(0.0, grain)))
        if green:
            c = lerp(c, GREEN, green * 0.6 * ss(-0.2, 0.5, noise + 0.6 * nrm.y - 0.25) * open_)
        cols.append(c)
    return cols


def make(name, draw, down, base, green, seed):
    bm = finish(draw())
    tilt = settle(bm, down)
    cols = tone(bm, base, green, seed)
    # into metres and Blender's axes; smooth, but an edge sharper than this stays an edge
    bmesh.ops.transform(bm, matrix=Matrix(((0.001, 0, 0, 0), (0, 0, -0.001, 0), (0, 0.001, 0, 0), (0, 0, 0, 1))), verts=bm.verts)
    for e in bm.edges:
        e.smooth = len(e.link_faces) != 2 or e.calc_face_angle(0) < math.radians(70)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    col.data.foreach_set('color', np.concatenate([np.array(cols), np.ones((len(cols), 1))], axis=1).ravel())
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3) * 1000
    size = co.max(axis=0) - co.min(axis=0)
    print(f'{name:18s} {tris:5d} triangles {len(me.vertices):5d} vertices, {size[0]:5.1f} x {size[2]:5.1f} x {size[1]:5.1f} mm (x, y up, z), turned {tilt:4.0f} deg from the side asked')
    return ob, tris


# ---- looking at them --------------------------------------------------------------------------------------------------
def studio(obs):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 28
        sc.cycles.use_denoising = True
    except Exception as e:
        print('no cycles:', e)
    bone = bpy.data.materials.new('bone')
    bone.use_nodes = True
    bsdf = next(n for n in bone.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.55
    att = bone.node_tree.nodes.new('ShaderNodeVertexColor')
    att.layer_name = 'Col'
    bone.node_tree.links.new(att.outputs['Color'], bsdf.inputs['Base Color'])
    for ob in obs:
        ob.data.materials.append(bone)
    earth = bpy.data.materials.new('earth')
    earth.use_nodes = True
    e = next(n for n in earth.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    e.inputs['Base Color'].default_value = (0.05, 0.036, 0.026, 1)
    e.inputs['Roughness'].default_value = 0.9
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-2, -2, 0), (2, -2, 0), (2, 2, 0), (-2, 2, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new('ground', me)
    me.materials.append(earth)
    sc.collection.objects.link(ground)
    world = bpy.data.worlds.new('dim')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.035, 0.045, 1)
    sc.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(3)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.view_settings.view_transform = 'Standard'
    return cam, sun, ground


def aim(ob, eye, at):
    """page axes, metres"""
    b = lambda p: Vector((p[0], -p[2], p[1]))
    ob.location = b(eye)
    ob.rotation_euler = (b(at) - b(eye)).to_track_quat('-Z', 'Y').to_euler()


def shoot(name, size=(1600, 1200)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = size
    os.makedirs(PROC, exist_ok=True)
    sc.render.filepath = os.path.join(PROC, name + '.png')
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    made = []
    total = 0
    for k, (name, draw, down, base, green) in enumerate(PIECES):
        if ONLY and name not in ONLY:
            continue
        ob, tris = make(name, draw, down, base, green, 100 + k)
        made.append(ob)
        total += tris
    print(f'{len(made)} pieces, {total} triangles')

    if SHEET or CLOSE or 'each' in ARGS:
        cam, sun, ground = studio(made)
        # close-ups of the skulls: three quarters from the front, and from the other side and above
        for ob in made:
            views = (('a', (0.62, 0.42, 0.66), (0.6, 0.45, 0.2)), ('b', (-0.72, 0.66, -0.2), (-0.2, 0.5, 0.8)), ('c', (0.95, 0.12, 0.05), (0.5, 0.5, 0.7)), ('d', (0.02, 1.0, 0.02), (-0.6, 0.4, 0.5)))
            if 'skull' not in ob.name or not CLOSE:
                views = ()
            if 'each' in ARGS:
                views += (('each', (0.45, 0.8, 0.5), (-0.6, 0.5, 0.4)),)
            for o in made:
                o.hide_render = o is not ob
            top = max(v.co.z for v in ob.data.vertices)
            reach = max(math.hypot(v.co.x, v.co.y, v.co.z - top * 0.4) for v in ob.data.vertices) * 3.6
            for tag, eye, sunfrom in views:
                aim(cam, tuple(c * reach for c in eye), (0, top * 0.4, 0))
                cam.data.lens = 55
                cam.data.clip_start, cam.data.clip_end = 0.001, 5
                aim(sun, sunfrom, (0, 0, 0))
                shoot(f'bones-{ob.name}-{tag}', (1200, 900) if tag != 'each' else (800, 600))
        # the sheet: everything laid out, a low light across it
        cols = 6 if len(made) > 6 else max(1, len(made))
        for ob in made:
            ob.hide_render = False
        rows = math.ceil(len(made) / cols)
        for k, ob in enumerate(made):
            ob.location = (((k % cols) - (cols - 1) / 2) * 0.066, ((k // cols) - (rows - 1) / 2) * 0.062, 0)     # the first row furthest away
        aim(cam, (0, 0.80, 0.30), (0, 0, 0.004))
        cam.data.lens = 74 if cols == 6 else 110
        aim(sun, (-0.7, 0.36, 0.5), (0, 0, 0))
        if SHEET:
            shoot('bones-sheet' if not ONLY else 'bones-sheet-some', (2400, 1200))
        for ob in made:
            ob.location = (0, 0, 0)
            ob.data.materials.clear()
        for o in (cam, sun, ground):
            bpy.data.objects.remove(o)
    if ONLY:
        return
    bone = bpy.data.materials.new('bone')
    bone.use_nodes = True
    bsdf = next(n for n in bone.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    for ob in made:
        ob.data.materials.append(bone)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_attributes=False, export_morph=False, export_cameras=False, export_lights=False, export_extras=False,
        export_skins=False, export_animations=False,
    )
    print('wrote', OUT, f'{os.path.getsize(OUT) / 1024:.0f} kB')


main()
