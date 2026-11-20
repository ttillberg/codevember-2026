# A parrot waxcap, papegojvaxskivling (Gliophorus psittacinus), built parametrically, its growth as shape keys, for
# public/waxcap.glb. One model for its colours: olive green, yellow, pink (the shader, per fungus).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/waxcap.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/waxcap.py -- render   # and model/renders/waxcap*.png
#
# After the references (a pink one, conical, and two green ones, convex): a small bell of a cap, thin, glossy with
# slime, on a slender tall stem, slimy too; thick waxy gills under it, well apart. The stages:
#   egg     a tiny bell on a stub
#   button  a bell, the stem rising
#   dome    the bell opening, convex
#   (basis) grown: broadly convex, a low boss
#   wither  limp, the rim down, the stem bent
#   round   a fuller, rounder bun (the green ones)
#   upturn  conical, pointed, the rim lifting and splitting (the pink one)
#
# Parts, in `_part`: 15.0 the cap, 15.1 the rim's edge, 15.2 the gills, 15.6 the stem. UV0: (along the stem,
# around). UV1: (out across the cap 0..1, 0).
#
# Sizes in metres, a grown one: a cap 4 cm across on a stem 9 mm thick, 6.5 cm to the top.

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'waxcap.glb')

AS = 96   # around the cap
SS = 48   # around the stem
RS = 34   # rings up the stem
CT = 28   # rings over the cap, centre to rim
CL = 6    # round the rim
CU = 16   # under it, the pores, rim to stem
RG = 8    # down the ring

OPEN = dict(R=0.02, th=1.0, H=0.065, rs=0.0046, bulb=0.0, sink=0.0, keel=0.0, curl=0.0, thick=0.16, tube=0.1, wave=1.0,
            umbo=0.08, cone=0.0)
STAGES = {
    'egg': dict(R=0.005, th=1.6, H=0.012, rs=0.0028, thick=0.3, tube=0.05, umbo=0.0, cone=0.4),
    'button': dict(R=0.009, th=1.45, H=0.03, rs=0.0035, thick=0.24, tube=0.07, umbo=0.04, cone=0.3),
    'dome': dict(R=0.015, th=1.2, H=0.052, rs=0.0042, thick=0.18, tube=0.09, umbo=0.06),
    'wither': dict(R=0.019, th=0.9, H=0.055, rs=0.0042, sink=0.004, keel=1.6, curl=1.0, thick=0.12),
    'round': dict(R=0.019, th=1.35, H=0.066, thick=0.2, umbo=0.02),
    'upturn': dict(R=0.021, th=1.05, H=0.07, curl=-0.4, thick=0.12, wave=2.2, umbo=0.0, cone=1.0),
}


def build(S):
    R, th, H, rs, bulb, sink, keel, curl = (S[k] for k in ('R', 'th', 'H', 'rs', 'bulb', 'sink', 'keel', 'curl'))
    thick, tube, wave = S['thick'] * R, S['tube'] * R, S['wave']
    m = Mesh()
    Rc = R / math.sin(th)

    def at(p):
        """bent over by the keel, sunk"""
        x, y, z = p
        zz = max(0.0, z)
        k = keel * (zz / max(H, 1e-4)) ** 3 * H * 0.15
        return (x + k, y, z - sink - keel * k * 0.3)

    def capPt(t, a):
        """the cap's top at t (0 centre .. 1 rim), round a: (r, z, nr, nz)"""
        ang = t * th
        r = Rc * math.sin(ang)
        z = H - Rc * (1 - math.cos(ang)) + S['umbo'] * R * math.exp(-(t / 0.5) ** 2) + S['cone'] * R * 0.5 * (1 - t) ** 1.6
        nr, nz = math.sin(ang), math.cos(ang)
        if curl != 0 and t > 0.45:
            ah = 0.45 * th
            rh, zh = Rc * math.sin(ah), H - Rc * (1 - math.cos(ah))
            b = curl * 0.6 * smooth(0.45, 1.0, t)
            cb, sb = math.cos(b), math.sin(b)
            dr, dz = r - rh, z - zh
            r, z = rh + dr * cb + dz * sb, zh - dr * sb + dz * cb
            nr, nz = nr * cb + nz * sb, -nr * sb + nz * cb
        # a bun's crust: lumpy, a little uneven all over, the rim wavy
        r += 0.02 * R * wob(a, t * 3) * t * t
        z += 0.015 * R * wob(a * 1.0 + 0.4, t * 5, 2) * t + 0.02 * R * (wave - 1) * wob(a * 0.5 + 0.7, 2.0, 9) * t * t
        return r, z, nr, nz

    def flesh(t):
        """how thick the cap's flesh is at t: thick to the rim, a bun"""
        return thick * (1 - 0.55 * t ** 1.5)

    # where the pores meet the stem
    tS = min(0.95, math.asin(min(1.0, rs * 1.05 / Rc)) / th)

    def porePt(t, a):
        """the pore surface under t: below the flesh, the tubes bulging down, sunk in a groove round the stem"""
        r, z, nr, nz = capPt(t, a)
        d = flesh(t)
        u = (t - tS) / max(1e-4, 1 - tS)
        tb = tube * math.sin(math.pi * min(1.0, max(0.0, u)) ** 0.7)
        # the gills: thick and blunt, about thirty, every other one short (not reaching the stem)
        g = abs(math.sin(a * 15)) ** 0.35
        short = 1.0 if math.sin(a * 15) > 0 else smooth(0.35, 0.55, u)
        return r - nr * d * 0.6, z - d - tb * g * short

    # -- the stem: a barrel, swollen low, narrowing to the cap
    s0 = len(m.V)
    zTop = porePt(tS, 0.0)[1] + thick * 0.2
    for i in range(RS):
        u = i / (RS - 1)
        z = lerp(-0.012, zTop, u)
        uz = max(0.0, z) / max(zTop, 1e-4)
        r = rs * (0.92 + 0.08 * smooth(-0.1, 0.05, z)) * (1 - 0.12 * uz) * (1 + 0.15 * math.exp(-((uz - 0.02) / 0.1) ** 2))
        for k in range(SS):
            a = k / SS * TAU
            rr = r * (1 + 0.035 * wob(a, z * 30, 1))
            m.push(at((math.cos(a) * rr, math.sin(a) * rr, z)), 15.6, (min(1.0, uz), k / SS), (0.0, 0.0))
    m.strip(s0, RS, SS)

    # -- the cap: over the top, round the thick rim, under it (the pores) back to the stem: one strip
    c0 = len(m.V)
    rows = 0
    for i in range(CT):
        t = (i / (CT - 1)) ** 0.85
        for k in range(AS):
            a = k / AS * TAU
            r, z, nr, nz = capPt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 15.0, (1.0, k / AS), (t, 0.0))
        rows += 1
    # round the rim: a rounded lip from the skin to the pores, bulging out a little
    for j in range(1, CL):
        v = j / CL
        for k in range(AS):
            a = k / AS * TAU
            r0, z0, nr, nz = capPt(1.0, a)
            r1, z1 = porePt(1.0, a)
            r = lerp(r0, r1, v) + flesh(1.0) * 0.35 * math.sin(v * math.pi)
            z = lerp(z0, z1, v)
            # the brown skin goes on round the lip, then a narrow pale edge before the pores
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 15.0 if v < 0.6 else 15.1, (1.0, k / AS), (1.0 + v * 0.1, 0.0))
        rows += 1
    for i in range(CU):
        t = lerp(1.0, tS, (i / (CU - 1)) ** 0.9)
        for k in range(AS):
            a = k / AS * TAU
            r, z = porePt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 15.2, (1.0, k / AS), (t, 0.0))
        rows += 1
    m.strip(c0, rows, AS)

    return m


ob = make('waxcap', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'waxcap'),
           {15.0: (0.36, 0.42, 0.12, 1), 15.1: (0.5, 0.55, 0.2, 1), 15.2: (0.62, 0.66, 0.3, 1), 15.6: (0.42, 0.55, 0.18, 1)},
           spacing=0.05, cam=(0, -0.55, 0.06))
