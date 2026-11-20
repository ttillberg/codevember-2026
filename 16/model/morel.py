# A black morel, toppmurkla (Morchella elata), built parametrically, its growth as shape keys, for public/morel.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/morel.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/morel.py -- render   # and model/renders/morel*.png
#
# After the reference (a few standing in moss): a tall cone of honeycomb, its ridges running up it in long wavy
# ribs, the pits between them cut across by lower ridges, brown, the pits darker; set straight on a pale cream stem,
# thick, a little wider and wrinkled at the foot, a groove where the cap meets it. The ridges and pits are geometry;
# the shader colours them by how deep they are (UV1.y).
# The stages:
#   egg     a small dark cone just out of the moss, almost no stem
#   button  the cone taller, the stem showing
#   dome    nearly grown, the cap still the larger part
#   (basis) grown: the stem as tall as the cap or taller
#   wither  slumped, the tip bent over, shrunken
#   round   the grown one with a blunter, egg-shaped cap
#   upturn  a slenderer, sharper cone
#
# Parts, in `_part`: 14.0 the cap, 14.6 the stem. UV0: (along the stem 0..1, around). UV1: (up the cap 0..1, how
# deep in a pit 0..1).
#
# Sizes in metres, a grown one: 8 cm tall, the cap 4.5 cm of it and 3 cm across at its foot.

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'morel.glb')

N = 128   # around (the ribs need it)
RS = 26   # up the stem
CR = 70   # up the cap

# (after the reference: the cap the larger part, a long blunt cone, the stem short and thick, nearly as wide)
OPEN = dict(R=0.016, capH=0.05, H=0.078, rs=0.0115, tp=1.9, bend=0.0, pit=1.0, foot=0.18)
STAGES = {
    'egg': dict(R=0.006, capH=0.016, H=0.018, rs=0.0045, tp=1.5, pit=0.6, foot=0.1),
    'button': dict(R=0.01, capH=0.03, H=0.038, rs=0.0075, tp=1.7, pit=0.8, foot=0.12),
    'dome': dict(R=0.014, capH=0.044, H=0.062, rs=0.0105),
    'wither': dict(R=0.014, capH=0.045, H=0.068, rs=0.01, bend=1.0, pit=1.2),
    'round': dict(R=0.018, capH=0.044, H=0.072, tp=2.8),
    'upturn': dict(R=0.015, capH=0.056, H=0.084, tp=1.4),
}


def pitAt(a, u, depth):
    """how deep in a pit at angle a, u up the cap (0..1): long wavy ribs up the cone, cross-ridges between them at
    uneven heights; 0 on a ridge, 1 at the bottom of a pit"""
    ribs = 12
    x = a / TAU * ribs + 0.25 * math.sin(u * 7.0 + a * 3.0) + 0.12 * math.sin(u * 17.0 + a)
    d_rib = abs(x - math.floor(x) - 0.5) * 2  # 1 on a rib, 0 between
    cell = math.floor(x)
    # the cross-ridges: in each column at their own heights, about four up the cap
    y = u * (5.0 + 1.5 * math.sin(cell * 2.3)) + 0.5 * math.sin(cell * 1.7) + 0.15 * math.sin(a * 5 + u * 9)
    d_cross = abs(y - math.floor(y) - 0.5) * 2
    ridge = max(smooth(0.66, 0.86, d_rib), smooth(0.74, 0.92, d_cross))  # (thin ridges, deep pits between)
    return (1 - ridge) * depth


def build(S):
    R, capH, H, rs, tp, bend, pit, foot = (S[k] for k in ('R', 'capH', 'H', 'rs', 'tp', 'bend', 'pit', 'foot'))
    m = Mesh()
    zc = H - capH  # where the cap starts

    def bent(x, y, z):
        """the wither: the tip bent over to one side"""
        if bend == 0:
            return (x, y, z)
        u = max(0.0, (z - zc) / capH)
        return (x + bend * 0.35 * capH * u ** 2.5, y, z - bend * 0.12 * capH * u ** 3)

    s0 = len(m.V)
    for i in range(RS):
        u = i / (RS - 1)
        z = lerp(-0.01, zc + 0.002, u)
        r = rs * (1 + foot * (1 - u) ** 2) * (1 + 0.04 * wob(0.0, z * 60, 3))
        for k in range(N):
            a = k / N * TAU
            # wrinkled and a little furrowed at the foot, granular all over (the shader)
            rr = r * (1 + 0.06 * (1 - u) * wob(a * 2, z * 80, 4))
            m.push(bent(math.cos(a) * rr, math.sin(a) * rr, z), 14.6, (u, k / N), (0.0, 0.0))
    m.strip(s0, RS, N)

    c0 = len(m.V)
    for i in range(CR):
        u = i / (CR - 1)
        z = zc + capH * u
        # the profile: from the groove at the foot out to the cap's width, a belly low down, tapering to the tip
        g = smooth(0.0, 0.06, u)
        # a long blunt cone, full below, rounding over at the tip (not a needle): tp the fuller the higher
        prof = max(1 - u ** tp, 0.0) ** 0.55
        r = R * (0.72 + 0.28 * g) * prof
        for k in range(N):
            a = k / N * TAU
            d = pitAt(a, u, pit) * smooth(0.02, 0.1, u) * (1 - smooth(0.9, 1.0, u))
            rr = max(r * (1 - 0.32 * d), 0.0002)
            m.push(bent(math.cos(a) * rr, math.sin(a) * rr, z), 14.0, (1.0, k / N), (u, d / max(pit, 1e-4)))
    m.strip(c0, CR, N)
    return m


ob = make('morel', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'morel'), {14.0: (0.3, 0.2, 0.12, 1), 14.6: (0.86, 0.8, 0.68, 1)},
           spacing=0.06, cam=(0, -0.65, 0.07))
