# A slippery jack, smörsopp (Suillus luteus), built parametrically, its growth as shape keys, for public/slippery.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/slippery.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/slippery.py -- render   # and model/renders/slippery*.png
#
# After porcini.py, a lighter bolete: a slimy chestnut cap, convex then flat with a low boss, its flesh thinner; a
# sponge of yellow pores under it; a slender stem, pale yellow, with a ring halfway up, a skirt of the veil that
# hung from the cap's rim over the young pores, brownish violet underneath. The stages:
#   egg     a knob in the needles, the cap a dark wet button
#   button  the cap round and tight on the stem, the veil still across the pores (the skirt drawn up to the rim)
#   dome    convex, the veil torn free, hanging as a ring
#   (basis) grown: broadly convex to flat, a low boss
#   wither  slumped, the rim down, sunk a little
#   round   the grown one still convex
#   upturn  old: flat, the rim lifting
#
# Parts, in `_part`: 11.0 the cap's skin, 11.1 the rim's edge, 11.2 the pores, 11.6 the stem (dotted above the
# ring in the shader), 11.7 the ring. UV0: (along the stem, around). UV1: (out across the cap 0..1, 0; down the
# ring 0..1).
#
# Sizes in metres, a grown one: a cap 9 cm across on a stem 1.6 cm thick, 7 cm to the top of the cap.

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'slippery.glb')

AS = 96   # around the cap
SS = 48   # around the stem
RS = 34   # rings up the stem
CT = 28   # rings over the cap, centre to rim
CL = 6    # round the rim
CU = 16   # under it, the pores, rim to stem
RG = 8    # down the ring

OPEN = dict(R=0.045, th=0.8, H=0.07, rs=0.008, bulb=0.12, sink=0.0, keel=0.0, curl=0.0, thick=0.3, tube=0.14, wave=1.0,
            umbo=0.04, ringAt=0.55, ringOut=1.0, ringLen=0.45)
STAGES = {
    'egg': dict(R=0.013, th=1.7, H=0.022, rs=0.006, bulb=0.1, sink=0.008, thick=0.45, tube=0.08, umbo=0.0, ringAt=0.85, ringOut=0.0, ringLen=0.15),
    'button': dict(R=0.022, th=1.55, H=0.04, rs=0.0075, bulb=0.12, sink=0.003, thick=0.42, tube=0.1, umbo=0.02, ringAt=0.85, ringOut=0.0, ringLen=0.2),
    'dome': dict(R=0.036, th=1.2, H=0.062, rs=0.008, thick=0.36, tube=0.12, umbo=0.04, ringAt=0.65, ringOut=0.6, ringLen=0.35),
    'wither': dict(R=0.044, th=0.75, H=0.058, rs=0.0075, sink=0.006, keel=1.0, curl=1.0, thick=0.24, tube=0.13, ringOut=0.4, ringLen=0.35),
    'round': dict(R=0.04, th=1.15, H=0.072, thick=0.34),
    'upturn': dict(R=0.047, th=0.5, H=0.066, curl=-0.35, thick=0.26, wave=2.0, umbo=0.05),
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
        z = H - Rc * (1 - math.cos(ang)) + S['umbo'] * R * math.exp(-(t / 0.5) ** 2)  # a low broad boss (narrow, it was a coolie hat)
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
        r = rs * (0.92 + 0.08 * smooth(-0.1, 0.05, z)) * (1 - 0.08 * uz) * (1 + bulb * math.exp(-((uz - 0.1) / 0.2) ** 2))
        for k in range(SS):
            a = k / SS * TAU
            rr = r * (1 + 0.035 * wob(a, z * 30, 1))
            m.push(at((math.cos(a) * rr, math.sin(a) * rr, z)), 11.6, (min(1.0, uz), k / SS), (0.0, 0.0))
    m.strip(s0, RS, SS)

    # -- the cap: over the top, round the thick rim, under it (the pores) back to the stem: one strip
    c0 = len(m.V)
    rows = 0
    for i in range(CT):
        t = (i / (CT - 1)) ** 0.85
        for k in range(AS):
            a = k / AS * TAU
            r, z, nr, nz = capPt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 11.0, (1.0, k / AS), (t, 0.0))
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
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 11.0 if v < 0.6 else 11.1, (1.0, k / AS), (1.0 + v * 0.1, 0.0))
        rows += 1
    for i in range(CU):
        t = lerp(1.0, tS, (i / (CU - 1)) ** 0.9)
        for k in range(AS):
            a = k / AS * TAU
            r, z = porePt(t, a)
            m.push(at((math.cos(a) * r, math.sin(a) * r, z)), 11.2, (1.0, k / AS), (t, 0.0))
        rows += 1
    m.strip(c0, rows, AS)

    # -- the ring: the veil's skirt, from the stem at ringAt down and out; young (ringOut 0) drawn up tight
    # against the stem under the cap, as the veil still across the pores
    g0 = len(m.V)
    zr = zTop * S['ringAt']
    L = S['ringLen'] * R
    for j in range(RG):
        v = j / (RG - 1)
        for k in range(SS):
            a = k / SS * TAU
            # hanging close round the stem, its hem flaring a little (standing out level, it was a lampshade)
            rr = rs * 1.03 + L * (0.06 * v + 0.22 * S['ringOut'] * v * v) * (1 + 0.2 * wob(a, v * 3, 5))
            z = zr - v * L * 0.85
            m.push(at((math.cos(a) * rr, math.sin(a) * rr, z)), 11.7, (zr / max(zTop, 1e-4), k / SS), (v, 0.0))
    m.strip(g0, RG, SS)
    return m


ob = make('slippery', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'slippery'),
           {11.0: (0.33, 0.17, 0.07, 1), 11.1: (0.8, 0.72, 0.5, 1), 11.2: (0.82, 0.7, 0.22, 1), 11.6: (0.85, 0.78, 0.5, 1),
            11.7: (0.55, 0.45, 0.5, 1)},
           spacing=0.11, cam=(0, -1.1, 0.12))
