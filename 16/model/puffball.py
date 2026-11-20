# A common puffball, vårtig röksvamp (Lycoperdon perlatum), built parametrically, its growth as shape keys, for
# public/puffball.glb.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/puffball.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/puffball.py -- render   # and model/renders/puffball*.png
#
# A pear: a round head on a short stem that narrows into the moss, all of it covered in little cone-shaped warts,
# bigger ones on top with a ring of tiny ones round each. White, going buff and brown as it ripens (the shader, by
# its age), when a pore opens at the top. The stages:
#   egg     a small white ball just out of the moss
#   button  a little pear
#   dome    nearly grown
#   (basis) grown: the pear
#   wither  old: the head collapsed, sunk and wrinkled, a soft sack
#   round   a rounder head on less stem
#   upturn  not a stage here: pressed, the head squashed down and bulging out (the page sets it as you press it,
#           and the spores puff out of the pore)
#
# Parts, in `_part`: 16.0 the head, 16.6 the stem. UV0: (up it 0..1, around). UV1: (from the top 0..1, wart 0..1).
#
# Sizes in metres, a grown one: the head 3.6 cm across, 5.5 cm tall.

import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'puffball.glb')

N = 112   # around
ROWS = 64  # from the foot over the head to the top

OPEN = dict(R=0.018, H=0.055, stem=0.45, neck=0.45, sag=0.0, squash=0.0, wart=1.0)
STAGES = {
    'egg': dict(R=0.006, H=0.011, stem=0.15, neck=0.8, wart=0.5),
    'button': dict(R=0.011, H=0.028, stem=0.35, neck=0.55, wart=0.8),
    'dome': dict(R=0.016, H=0.046, stem=0.42, neck=0.5),
    'wither': dict(R=0.019, H=0.04, sag=1.0, wart=0.4),
    'round': dict(R=0.02, H=0.048, stem=0.3, neck=0.6),
    'upturn': dict(R=0.022, H=0.034, squash=1.0),
}


def wartAt(a, u):
    """the warts at a, u up the pear (0 foot .. 1 top): cones on a jittered grid, bigger on the head"""
    nu = 22.0
    na = 26.0
    y = u * nu
    row = math.floor(y)
    x = a / TAU * na + 0.5 * (row % 2) + 0.3 * math.sin(row * 1.7)
    fx, fy = x - math.floor(x) - 0.5, y - row - 0.5
    d = math.sqrt(fx * fx + fy * fy * 1.2)
    big = max(0.0, 1.0 - d / 0.32)
    # a ring of tiny ones round each
    x2, y2 = x * 3.0, y * 3.0
    sx, sy = x2 - math.floor(x2) - 0.5, y2 - math.floor(y2) - 0.5
    small = max(0.0, 1.0 - math.sqrt(sx * sx + sy * sy) / 0.4) * 0.35
    return max(big ** 1.4, small)


def build(S):
    R, H, stem, neck, sag, squash, wart = (S[k] for k in ('R', 'H', 'stem', 'neck', 'sag', 'squash', 'wart'))
    m = Mesh()
    # the profile: the head nearly a ball on top, its widest a little below its middle; under it the stem narrowing
    # down into the moss (stem: how much of the height is stem)
    zw = max(H - R * 1.05, H * stem)
    s0 = len(m.V)
    for i in range(ROWS):
        u = i / (ROWS - 1)
        if u < 0.5:
            v = u / 0.5  # up the stem to the widest
            z = lerp(-0.006, zw, v)
            r = R * (neck + (1 - neck) * math.sin(v * math.pi / 2) ** 2.2)
        else:
            v = (u - 0.5) / 0.5  # over the head to the top
            ang = v * math.pi / 2
            # (squashed: pressed down, the head lower and wider; old: lower, the top sunk in a little and soft)
            hh = (H - zw) * (1 - 0.45 * squash) * (1 - 0.35 * sag)
            z = zw * (1 - 0.2 * squash) + hh * math.sin(ang) - sag * hh * 0.35 * smooth(0.7, 1.0, v)
            r = R * math.cos(ang) * (1 + 0.28 * squash * math.cos(ang) + 0.1 * sag)
        if u < 0.5:
            # the stem's top widening as the head does, so they meet without a step
            z *= 1 - 0.2 * squash
            r *= 1 + (0.28 * squash + 0.1 * sag) * smooth(0.55, 1.0, u / 0.5)
        for k in range(N):
            a = k / N * TAU
            w = wartAt(a, u) * wart * smooth(0.15, 0.4, u)
            rr = max(r * (1 + 0.035 * w) + 0.0006 * w + R * (0.03 * wob(a, u * 4, 2) + sag * 0.08 * wob(a * 2, u * 9, 5) * smooth(0.5, 1.0, u)), 0.0001)
            zz = z + (0.0006 * w if u > 0.97 else 0.0)
            part = 16.6 if u < 0.32 else 16.0
            m.push((math.cos(a) * rr, math.sin(a) * rr, zz), part, (u, k / N), (1 - u, w))
    m.strip(s0, ROWS, N)
    return m


ob = make('puffball', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'puffball'), {16.0: (0.88, 0.85, 0.78, 1), 16.6: (0.84, 0.8, 0.72, 1)},
           spacing=0.06, cam=(0, -0.55, 0.05))
