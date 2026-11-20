# A porcini, karljohan (Boletus edulis), built parametrically, with its growth as shape keys, for public/porcini.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/porcini.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/porcini.py -- render   # and model/renders/porcini*.png
#
# A fat barrel of a stem, swollen low, under a thick brown bun of a cap; a sponge of pores under it (the pores
# themselves are the shader's), the tube layer bulging down and sunk round the stem. The stages:
#   egg     a knob just out of the moss, nearly all stem, the cap a small dark button pressed on it
#   button  a cork: a fat stem, the cap still small and round, not yet wider than the stem by much
#   dome    the bun opening, its rim still turned in over the pores
#   (basis) grown: a broad cushion, a little flatter, the rim thick and rounded
#   wither  slumped and sagging, the rim bent down, sunk a little
#   round   the grown one, still a high bun
#   upturn  old: flattened, the rim lifting and waving
#
# Parts, in `_part`: 10.0 the cap's skin, 10.1 the rim's edge, 10.2 the pores, 10.6 the stem (netted at the top in
# the shader). UV0: (along the stem for the dark foot, 1 off it; around). UV1: (out across the cap 0..1, 0).
#
# Sizes in metres, a grown one: a cap 13 cm across on a stem 4 cm thick, 12 cm to the top of the cap.

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'porcini.glb')

AS = 96   # around the cap
SS = 48   # around the stem
RS = 34   # rings up the stem
CT = 28   # rings over the cap, centre to rim
CL = 6    # round the rim
CU = 16   # under it, the pores, rim to stem

OPEN = dict(R=0.065, th=0.95, H=0.125, rs=0.02, bulb=0.55, sink=0.0, keel=0.0, curl=0.0, thick=0.5, tube=0.17, wave=1.0)
STAGES = {
    'egg': dict(R=0.017, th=1.75, H=0.035, rs=0.013, bulb=0.35, sink=0.012, thick=0.6, tube=0.08),
    'button': dict(R=0.03, th=1.55, H=0.07, rs=0.019, bulb=0.55, sink=0.004, thick=0.6, tube=0.1),
    'dome': dict(R=0.048, th=1.25, H=0.1, rs=0.02, bulb=0.55, thick=0.55, tube=0.14),
    'wither': dict(R=0.062, th=0.85, H=0.1, rs=0.019, bulb=0.5, sink=0.008, keel=1.0, curl=1.0, thick=0.36, tube=0.15),
    'round': dict(R=0.058, th=1.3, H=0.13, thick=0.58),
    'upturn': dict(R=0.067, th=0.6, H=0.118, curl=-0.35, thick=0.44, wave=2.5),
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
        z = H - Rc * (1 - math.cos(ang))
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
        tb = tube * math.sin(math.pi * min(1.0, max(0.0, u)) ** 0.7) * (1 - 0.6 * smooth(0.0, 0.15, -u + 0.15))
        return r - nr * d * 0.6, z - d - tb

    # -- the stem: a barrel, swollen low, narrowing to the cap
    s0 = len(m.V)
    zTop = porePt(tS, 0.0)[1] + thick * 0.2
    for i in range(RS):
        u = i / (RS - 1)
        z = lerp(-0.012, zTop, u)
        uz = max(0.0, z) / max(zTop, 1e-4)
        r = rs * (0.92 + 0.08 * smooth(-0.1, 0.05, z)) * (1 - 0.18 * uz) * (1 + bulb * math.exp(-((uz - 0.22) / 0.3) ** 2))
        for k in range(SS):
            a = k / SS * TAU
            rr = r * (1 + 0.035 * wob(a, z * 30, 1))
            m.push(at((math.cos(a) * rr, math.sin(a) * rr, z)), 10.6, (min(1.0, uz), k / SS), (0.0, 0.0))
    m.strip(s0, RS, SS)

    # -- the cap: over the top, round the thick rim, under it (the pores) back to the stem: one strip
    c0 = len(m.V)
    rows = 0
    for i in range(CT):
        t = (i / (CT - 1)) ** 0.85
        for k in range(AS):
            a = k / AS * TAU
            r, z, nr, nz = capPt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 10.0, (1.0, k / AS), (t, 0.0))
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
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 10.0 if v < 0.6 else 10.1, (1.0, k / AS), (1.0 + v * 0.1, 0.0))
        rows += 1
    for i in range(CU):
        t = lerp(1.0, tS, (i / (CU - 1)) ** 0.9)
        for k in range(AS):
            a = k / AS * TAU
            r, z = porePt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 10.2, (1.0, k / AS), (t, 0.0))
        rows += 1
    m.strip(c0, rows, AS)
    return m


ob = make('porcini', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'porcini'),
           {10.0: (0.42, 0.26, 0.13, 1), 10.1: (0.85, 0.8, 0.68, 1), 10.2: (0.86, 0.84, 0.66, 1), 10.6: (0.82, 0.77, 0.66, 1)},
           spacing=0.15, cam=(0, -1.5, 0.18))
