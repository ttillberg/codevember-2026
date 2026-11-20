# A crested coral, kamfingersvamp (Clavulina cristata), built parametrically, its growth as shape keys, for
# public/coral.glb. One tuft is one model; its colour is the cluster's (white, golden, orange: the shader).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/coral.py             # build and export
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 16/model/coral.py -- render   # and model/renders/coral*.png
#
# A small bush: branches from one short foot, leaning out, each forking once or twice, flattened a little, the
# ends split into crests of fine sharp points. Tubes along curved paths, every one with the same rings in every
# stage, so the stages can be shape keys:
#   egg     a knot of stubs just out of the moss
#   button  short fingers
#   dome    the branches up, forking, the crests starting
#   (basis) grown
#   wither  limp: the branches sagging, the tips drooping, thinner
#   round   bushier, lower, spread wider
#   upturn  taller and narrower
#
# Parts, in `_part`: 17.0 a branch, 17.1 a crest's points. UV0: (along the whole tuft from the foot 0..1, around).
#
# Sizes in metres, a grown one: 5 cm tall, as wide.

import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fungus import TAU, wob, lerp, smooth, Mesh, make, export, render

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'coral.glb')

SIDES = 8
ROWS = 9
R = random.Random(5)
# the plan, the same for every stage: each main branch its heading, lean, length, and its forks
PLAN = []
for i in range(7):
    a = i / 7 * TAU + R.uniform(-0.35, 0.35)
    kids = []
    for j in range(2 if R.random() < 0.7 else 3):
        kids.append(dict(da=R.uniform(-1.0, 1.0), dl=R.uniform(-0.25, 0.25), ln=R.uniform(0.45, 0.7), at=R.uniform(0.45, 0.7),
                         tips=[dict(da=R.uniform(-1.0, 1.0), tilt=R.uniform(-0.3, 0.4), ln=R.uniform(0.15, 0.3)) for _ in range(3)]))
    PLAN.append(dict(a=a, lean=R.uniform(0.5, 0.95), ln=R.uniform(0.7, 1.0), r=R.uniform(0.8, 1.2), kids=kids))

OPEN = dict(L=0.028, r=0.0024, spread=1.0, droop=0.0, crest=1.0, foot=0.006)
STAGES = {
    'egg': dict(L=0.004, r=0.0018, spread=0.5, crest=0.0, foot=0.003),
    'button': dict(L=0.012, r=0.002, spread=0.7, crest=0.2, foot=0.004),
    'dome': dict(L=0.022, r=0.0022, spread=0.9, crest=0.6, foot=0.005),
    'wither': dict(L=0.026, r=0.0017, droop=1.0, crest=0.7),
    'round': dict(L=0.024, spread=1.4, foot=0.005),
    'upturn': dict(L=0.033, spread=0.75, foot=0.007),
}


def tube(m, p0, d0, length, r0, r1, part, droop, along0, along1):
    """a tube from p0 along d0 (bending down by droop toward its end); returns its end and direction"""
    pts, dirs = [], []
    p, d = p0, d0
    for i in range(ROWS):
        t = i / (ROWS - 1)
        pts.append(p)
        dirs.append(d)
        step = length / (ROWS - 1)
        # curving up toward the light, or sagging when it withers
        dz = 0.035 - droop * 0.22 * t
        d = (d[0], d[1], d[2] + dz)
        n = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
        d = (d[0] / n, d[1] / n, d[2] / n)
        p = (p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step)
    start = len(m.V)
    for i, (pt, dv) in enumerate(zip(pts, dirs)):
        t = i / (ROWS - 1)
        ref = (0.0, 0.0, 1.0) if abs(dv[2]) < 0.95 else (1.0, 0.0, 0.0)
        ux, uy, uz = dv[1] * ref[2] - dv[2] * ref[1], dv[2] * ref[0] - dv[0] * ref[2], dv[0] * ref[1] - dv[1] * ref[0]
        un = math.sqrt(ux * ux + uy * uy + uz * uz) or 1.0
        u = (ux / un, uy / un, uz / un)
        w = (dv[1] * u[2] - dv[2] * u[1], dv[2] * u[0] - dv[0] * u[2], dv[0] * u[1] - dv[1] * u[0])
        rr = lerp(r0, r1, t ** 0.8)
        for k in range(SIDES):
            a = k / SIDES * TAU
            # a little flattened, as the branches are
            ca, sa = math.cos(a) * rr * 1.25, math.sin(a) * rr * 0.8
            m.push((pt[0] + u[0] * ca + w[0] * sa, pt[1] + u[1] * ca + w[1] * sa, pt[2] + u[2] * ca + w[2] * sa),
                   part, (lerp(along0, along1, t), k / SIDES), (t, 0.0))
    for i in range(ROWS - 1):
        for k in range(SIDES):
            a = start + i * SIDES + k
            b = start + i * SIDES + (k + 1) % SIDES
            m.F.append((a, b, b + SIDES, a + SIDES))
    return pts[-1], dirs[-1], pts, dirs


def build(S):
    L, rad, spread, droop, crest, foot = (S[k] for k in ('L', 'r', 'spread', 'droop', 'crest', 'foot'))
    m = Mesh()
    # the foot: a short thick stub the branches leave from
    fe, fd, _, _ = tube(m, (0.0, 0.0, -0.004), (0.0, 0.0, 1.0), foot + 0.004, rad * 2.6, rad * 2.2, 17.0, 0.0, 0.0, 0.1)
    for b in PLAN:
        lean = min(1.2, b['lean'] * spread)
        d = (math.cos(b['a']) * math.sin(lean), math.sin(b['a']) * math.sin(lean), math.cos(lean))
        start = (fe[0] + d[0] * rad, fe[1] + d[1] * rad, fe[2] - rad)
        e, de, pts, dirs = tube(m, start, d, L * b['ln'], rad * 1.6 * b['r'], rad * 0.9 * b['r'], 17.0, droop, 0.1, 0.6)
        for k in b['kids']:
            i = int(k['at'] * (ROWS - 1))
            p0, d0 = pts[i], dirs[i]
            ca, sa = math.cos(k['da'] * spread), math.sin(k['da'] * spread)
            dk = (d0[0] * ca - d0[1] * sa, d0[0] * sa + d0[1] * ca, d0[2] + k['dl'])
            n = math.sqrt(sum(c * c for c in dk))
            dk = tuple(c / n for c in dk)
            ke, kd, _, _ = tube(m, p0, dk, L * b['ln'] * k['ln'], rad * 0.95 * b['r'], rad * 0.6 * b['r'], 17.0, droop, 0.5, 0.9)
            # the crest: a few fine sharp points splaying from the end
            for tp in k['tips']:
                ca, sa = math.cos(tp['da']), math.sin(tp['da'])
                dt = (kd[0] * ca - kd[1] * sa, kd[0] * sa + kd[1] * ca, kd[2] + tp['tilt'])
                n = math.sqrt(sum(c * c for c in dt))
                dt = tuple(c / n for c in dt)
                tube(m, ke, dt, max(L * tp['ln'] * 0.5 * crest, 0.0004), rad * 0.5 * b['r'], rad * 0.05, 17.1, droop * 1.5, 0.9, 1.0)
    return m


ob = make('coral', build, OPEN, STAGES)
export(ob, OUT)
if '--' in sys.argv and 'render' in sys.argv[sys.argv.index('--') + 1:]:
    render(ob, os.path.join(HERE, 'renders', 'coral'), {17.0: (0.86, 0.84, 0.78, 1), 17.1: (0.8, 0.76, 0.66, 1)},
           spacing=0.07, cam=(0, -0.75, 0.035))
