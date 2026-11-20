# The funnel fungi, built parametrically, their growth as shape keys: one surface of revolution from the foot of the
# stem up the stem, out under the cap (its ridges, false gills, running down into the stem), round the margin and
# back over the top to the middle. Two kinds from it:
#   chanterelle (Cantharellus cibarius) -> public/chanterelle.glb: fleshy, a shallow dip, the margin thick, rolled
#     in when young, lobed and wavy later; a stout stem narrowing down; blunt forking ridges
#   yellowfoot (Craterellus tubaeformis) -> public/yellowfoot.glb: thin, a deep funnel on a slender stem, the margin
#     wavy and turned down, the ridges low and grey
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/funnel.py             # build and export both
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/funnel.py -- render   # and model/renders/*.png
#
# The stages, as the other models: egg (a knob), button (a small rolled cap), dome (opening), (basis) grown, wither
# (limp, the margin hanging), round (a fuller, flatter one), upturn (the funnel deeper, the margin flaring).
#
# Parts, in `_part`: P.0 the top, P.1 the margin, P.2 the ridges under it, P.6 the stem; P 12 the chanterelle, 13
# the yellowfoot. UV0: (along the stem 0..1, 1 off it; around). UV1: (out from the stem 0..1 on the cap, 0).

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))

N = 96    # around
RS = 18   # up the stem
CU = 22   # under the cap, stem to margin
CL = 6    # round the margin
CT = 18   # over the top, margin to middle

KINDS = {
    'chanterelle': dict(
        P=12.0,
        OPEN=dict(R=0.035, H=0.055, rs=0.009, dip=0.006, roll=0.15, wave=1.0, thick=0.007, fl=0.8, ridge=1.0, taper=0.3, jn=0.35),
        STAGES={
            'egg': dict(R=0.007, H=0.013, rs=0.0045, dip=-0.002, roll=1.0, wave=0.0, thick=0.003, ridge=0.2),
            'button': dict(R=0.013, H=0.026, rs=0.007, dip=-0.003, roll=0.9, wave=0.2, thick=0.005, ridge=0.5),
            'dome': dict(R=0.024, H=0.042, rs=0.008, dip=-0.001, roll=0.6, wave=0.5, thick=0.006),
            'wither': dict(R=0.033, H=0.045, dip=0.004, roll=-0.6, wave=1.4, thick=0.005),
            'round': dict(R=0.032, H=0.05, dip=0.0, roll=0.35, wave=0.7),
            'upturn': dict(R=0.038, H=0.056, dip=0.013, roll=-0.35, wave=1.6),
        },
        cols={12.0: (0.9, 0.58, 0.1, 1), 12.1: (0.92, 0.62, 0.14, 1), 12.2: (0.94, 0.66, 0.2, 1), 12.6: (0.9, 0.64, 0.2, 1)},
    ),
    'yellowfoot': dict(
        P=13.0,
        OPEN=dict(R=0.02, H=0.06, rs=0.0042, dip=0.013, roll=0.25, wave=1.2, thick=0.0028, fl=1.4, ridge=0.7, taper=-0.1, jn=0.55),
        STAGES={
            'egg': dict(R=0.004, H=0.012, rs=0.003, dip=-0.001, roll=1.0, wave=0.0, thick=0.002, ridge=0.2),
            'button': dict(R=0.008, H=0.028, rs=0.0035, dip=0.001, roll=0.8, wave=0.3),
            'dome': dict(R=0.014, H=0.045, dip=0.006, roll=0.5, wave=0.7),
            'wither': dict(H=0.05, dip=0.01, roll=-0.5, wave=1.7),
            'round': dict(R=0.018, dip=0.006, wave=0.9),
            'upturn': dict(R=0.023, dip=0.02, roll=-0.3, wave=1.7),
        },
        cols={13.0: (0.32, 0.24, 0.15, 1), 13.1: (0.36, 0.28, 0.18, 1), 13.2: (0.55, 0.52, 0.46, 1), 13.6: (0.78, 0.6, 0.18, 1)},
    ),
}


def build(S, P):
    R, H, rs, dip, roll, wave, thick, fl, ridge, taper, jn = (S[k] for k in ('R', 'H', 'rs', 'dip', 'roll', 'wave', 'thick', 'fl', 'ridge', 'taper', 'jn'))
    m = Mesh()
    zRim = H - thick
    zJ = zRim * jn  # where the stem flares into the cap

    def rimAt(a):
        """the margin's radius and height round a: lobed and undulating"""
        rr = R * (1 + wave * (0.09 * math.sin(5 * a + 0.7) + 0.05 * math.sin(3 * a + 2.1) + 0.03 * wob(a, 1.0, 3)))
        zz = zRim + wave * R * (0.14 * math.sin(4 * a + 1.3) + 0.06 * math.sin(7 * a + 0.4))
        return rr, zz

    def curl(r, z, t, pr, pz):
        """the outer quarter bent about (pr, pz): positive roll rolls the margin in and down"""
        if roll == 0 or t <= 0.7:
            return r, z
        b = roll * 1.1 * smooth(0.7, 1.0, t)
        cb, sb = math.cos(b), math.sin(b)
        dr, dz = r - pr, z - pz
        return pr + dr * cb + dz * sb, pz - dr * sb + dz * cb

    def under(t, a):
        """the underside (the ridged side) at t from the stem (0) to the margin (1)"""
        rr, zz = rimAt(a)
        r = rs + (rr - rs) * t ** fl
        z = zJ + (zz - zJ) * t ** 0.7
        # the ridges: blunt, forking outward (more of them toward the margin), standing down from the surface
        nr = 13 + 9 * t
        rid = ridge * 0.07 * R * abs(math.sin(a * nr)) ** 0.6 * smooth(0.03, 0.3, t) * (1 - smooth(0.92, 1.0, t))
        z -= rid
        pr, pz = rs + (rr - rs) * 0.7 ** fl, zJ + (zz - zJ) * 0.7 ** 0.7
        return curl(r, z, t, pr, pz)

    def top(t, a):
        """the top at t from the middle (0) to the margin (1): dipped (dip > 0) or domed"""
        rr, zz = rimAt(a)
        r = rr * t
        z = zz + thick - dip * (1 - t * t) + 0.08 * R * wave * wob(a, t * 3, 7) * t * (1 - t)
        pr, pz = rr * 0.7, zz + thick - dip * (1 - 0.49)
        return curl(r, z, t, pr, pz)

    # one strip: the stem up, under the cap out, round the margin, over the top in
    s0 = len(m.V)
    rows = 0
    for i in range(RS):
        u = i / (RS - 1)
        z = lerp(-0.01, zJ, u)
        r = rs * (1 - taper * (1 - u)) * (1 + 0.04 * wob(0.0, z * 40, 1))
        for k in range(N):
            a = k / N * TAU
            # the ridges run down onto the top of the stem
            rr = r * (1 + 0.04 * wob(a, z * 30, 2)) - ridge * 0.25 * rs * abs(math.sin(a * 13)) ** 0.6 * smooth(0.7, 1.0, u)
            m.push((math.cos(a) * rr, math.sin(a) * rr, z), P + 0.6, (u, k / N), (0.0, 0.0))
        rows += 1
    for i in range(1, CU):
        t = i / (CU - 1)
        for k in range(N):
            a = k / N * TAU
            r, z = under(t, a)
            m.push((math.cos(a) * r, math.sin(a) * r, z), P + 0.2, (1.0, k / N), (t, 0.0))
        rows += 1
    for j in range(1, CL):
        v = j / CL
        for k in range(N):
            a = k / N * TAU
            r0, z0 = under(1.0, a)
            r1, z1 = top(1.0, a)
            r = lerp(r0, r1, v) + thick * 0.45 * math.sin(v * math.pi)
            z = lerp(z0, z1, v)
            m.push((math.cos(a) * r, math.sin(a) * r, z), P + 0.1, (1.0, k / N), (1.0, 0.0))
        rows += 1
    for i in range(CT):
        t = 1.0 - i / (CT - 1)
        for k in range(N):
            a = k / N * TAU
            r, z = top(max(t, 0.002), a)
            m.push((math.cos(a) * r, math.sin(a) * r, z), P + 0.0, (1.0, k / N), (t, 0.0))
        rows += 1
    m.strip(s0, rows, N)
    return m


want = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for name, K in KINDS.items():
    P = K['P']
    ob = make(name, lambda S, P=P: build(S, P), K['OPEN'], K['STAGES'])
    export(ob, os.path.join(HERE, '..', 'public', name + '.glb'))
    if 'render' in want:
        render(ob, os.path.join(HERE, 'renders', name), K['cols'], spacing=0.07, cam=(0, -0.75, 0.07))
