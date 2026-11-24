# Builds the two snake heads, a python's and a colubrid's, and exports them to ../public/python.glb
# and ../public/corn.glb. The other species of each family get only their own colour map on the same
# scales: ../public/heads/<species>.jpg.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 24/model/heads.py            build + export + save heads.blend
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P 24/model/heads.py -- render  same, plus preview renders
#
# Each head is a parametric surface: u runs from the neck ring (u = 0, x = 0) to the snout tip
# (u = 1, x = L), theta round the cross-section (0 = left cheek, pi/2 = top). Big features
# (eye sockets, brows, the lower jaw tucked under the lip) are in the mesh. The scales are a
# weighted Voronoi on the surface: hand-placed shields (rostral, labials, and for the corn
# snake the colubrid plates on top), Poisson granules elsewhere, relaxed twice. They are baked
# into a colour and a tangent-space normal map in the head's own (theta, u) UV layout, with the
# fine features (heat pits, nostrils, the mouth line) only in the maps.
#
# Blender axes: +X forward (snout), +Z up, +Y left. The exporter turns that into glTF's Y-up.
import bpy, bmesh, math, os, sys, random
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'public'))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = 'render' in ARGS
ONLY = [a for a in ARGS if a in ('python', 'corn')]

TEX_W, TEX_H = 2048, 1024  # x round the head (theta), y along it (u)
NU, NT = 150, 192          # mesh grid
TAU = math.tau


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def spow(a, p):
    return np.sign(a) * np.abs(a) ** p


def mix(a, b, t):
    return a + (b - a) * t


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


SPECIES = {
    'python': dict(
        L=0.056, rn=0.0122, wmax=0.0215, wtip=0.0108, zt=0.0112, zb=0.0090, uw=0.27,
        snoutDrop=0.38, topNarrow=0.24, nSide=3.3, nBot=3.4,
        eye=dict(u=0.64, th=0.34, r=0.0040, brow=0.0008, rim=0.0003),
        nostril=dict(u=0.93, phi=0.62, r=0.0010),
        mouth=dict(front=0.18, back=0.42, end=0.10),
        jaw=0.00045, small=0.00125, gular=0.0016,
        upper=13, lower=16, labialH=0.0027, rostralR=0.0032,
        pits=True,
    ),
    'corn': dict(
        L=0.034, rn=0.0098, wmax=0.0127, wtip=0.0064, zt=0.0080, zb=0.0060, uw=0.22,
        snoutDrop=0.36, topNarrow=0.16, nSide=2.9, nBot=3.2,
        eye=dict(u=0.655, th=0.32, r=0.0025, brow=0.0003, rim=0.0002),
        nostril=dict(u=0.92, phi=0.78, r=0.0006),
        mouth=dict(front=0.20, back=0.40, end=0.12),
        jaw=0.0003, small=0.00165, gular=0.0019,
        upper=8, lower=10, labialH=0.0017, rostralR=0.0022,
        pits=False,
    ),
}


# every species painted on a head: its family's own first
LOOKS = {
    'python': ['python', 'burmese', 'ball', 'carpet'],
    'corn': ['corn', 'king', 'milk', 'garter'],
}


# --- the surface ----------------------------------------------------------------

def profile(u, s):
    a0 = ss(0, 0.3, u)
    w = (s['rn'] + (s['wmax'] - s['rn']) * ss(0, s['uw'], u))
    t = np.clip((u - s['uw'] * 0.7) / (1 - s['uw'] * 0.7), 0, 1)
    w = w * (1 + (s['wtip'] / s['wmax'] - 1) * t ** 1.15)
    zt = (s['rn'] + (s['zt'] - s['rn']) * ss(0, s['uw'] * 1.5, u)) * (1 - s['snoutDrop'] * ss(0.42, 1.0, u))
    zb = (s['rn'] + (s['zb'] - s['rn']) * ss(0, s['uw'], u)) * (1 - 0.22 * ss(0.6, 1.0, u))
    uc = 0.83
    c = np.where(u > uc, np.sqrt(np.clip(1 - ((u - uc) / (1 - uc)) ** 2, 0, 1)), 1.0)
    hh = (zt + zb) / 2 * c
    z0 = (zt - zb) / 2
    w = w * c
    return w, hh, z0, a0


def base(u, th, s):
    w, hh, z0, a0 = profile(u, s)
    cs, sn = np.cos(th), np.sin(th)
    n = np.where(sn > 0, mix(2.0, s['nSide'], a0), mix(2.0, s['nBot'], a0))
    y = w * spow(cs, 2 / n) * (1 - s['topNarrow'] * a0 * np.clip(sn, 0, 1))
    z = z0 + hh * spow(sn, 2 / n)
    x = u * s['L']
    return np.stack([x, y, z], -1)


def frame(u, th, s, eps=1e-4):
    p = base(u, th, s)
    pu = (base(np.clip(u + eps, 0, 1), th, s) - base(np.clip(u - eps, 0, 1), th, s))
    pt = (base(u, th + eps, s) - base(u, th - eps, s)) / (2 * eps)
    n = np.cross(pt, pu)
    ln = np.linalg.norm(n, axis=-1, keepdims=True)
    n = np.where(ln > 1e-12, n / np.maximum(ln, 1e-12), np.array([1.0, 0, 0]))
    return p, n


def mouth_theta(u, s, side):
    # the lip line, as a level under the head's mid line: higher at the snout, lower at the jaw angle
    m = s['mouth']
    lev = mix(m['back'], m['front'], ss(0.1, 0.9, u))
    a0 = ss(0, 0.3, u)
    n = mix(2.0, s['nBot'], a0)
    th = -np.arcsin(np.clip(lev ** (n / 2), 0, 1))
    return th if side > 0 else math.pi - th


def theta_offset(u, th0, dist, s, sign):
    # walk the cross-section from th0 until the arc length is dist (sign +1: theta up)
    ths = th0 + sign * np.linspace(0, 1.2, 400)
    p = base(np.full_like(ths, u), ths, s)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=-1)
    arc = np.concatenate([[0], np.cumsum(seg)])
    return float(np.interp(dist, arc, ths))


def eye_center(s, side):
    e = s['eye']
    th = e['th'] if side > 0 else math.pi - e['th']
    p, n = frame(np.array([e['u']]), np.array([th]), s)
    return p[0] - n[0] * e['r'] * 0.52, p[0], n[0]


def mesh_disp(p, u, th, s):
    """features that are in the mesh: eye sockets and rims, brows, the lower jaw under the lip"""
    d = np.zeros(len(p))
    e = s['eye']
    for side in (1, -1):
        c, sp, sn = eye_center(s, side)
        r = np.linalg.norm(p - c, axis=-1)
        d -= (1 - ss(e['r'] * 0.9, e['r'] * 1.05, r)) * (e['r'] * 0.35)
        d += e['rim'] * np.exp(-((r - e['r'] * 1.1) / (e['r'] * 0.22)) ** 2)
        bth = theta_offset(e['u'], e['th'] if side > 0 else math.pi - e['th'], e['r'] * 1.05, s, 1 if side > 0 else -1)
        b = base(np.array([e['u'] + 0.012]), np.array([bth]), s)[0]
        rb = np.linalg.norm(p - b, axis=-1)
        d += e['brow'] * np.exp(-(rb / (e['r'] * 0.75)) ** 2)
    # lower jaw tucked under the upper labials
    for side in (1, -1):
        tm = mouth_theta(u, s, side)
        below = (th - tm) * side  # negative under the lip on that side
        sidew = np.where(side > 0, np.cos(th) > 0, np.cos(th) < 0)
        step = (1 - ss(-0.06, 0.02, below)) * ss(-1.2, -0.6, below)
        d -= s['jaw'] * step * sidew * ss(s['mouth']['end'], s['mouth']['end'] + 0.08, u) * (1 - ss(0.95, 1.0, u))
    return d


def surface(u, th, s):
    p, n = frame(u, th, s)
    d = mesh_disp(p, u, th, s)
    return p + n * d[:, None], n


# --- scales ---------------------------------------------------------------------

def explicit_seeds(s, name):
    """hand-placed shields: (u, theta, weight, kind)"""
    seeds = []
    L = s['L']

    def at(u, phi, w, kind, both=True):
        # phi from the top centre, + toward the left cheek
        seeds.append((u, math.pi / 2 - phi, w, kind))
        if both and abs(phi) > 1e-6:
            seeds.append((u, math.pi / 2 + phi, w, kind))

    at(0.997, 0.0, s['rostralR'], 'rostral', both=False)
    # labials along both lips
    for side in (1, -1):
        for k in range(s['upper']):
            u = mix(0.965, 0.33 if name == 'python' else 0.40, k / (s['upper'] - 1))
            tm = float(mouth_theta(np.array([u]), s, side))
            th = theta_offset(u, tm, s['labialH'] * 0.55, s, side)
            w = s['labialH'] * 0.55 * (1 - 0.25 * k / s['upper'])
            seeds.append((u, th, w, 'upper%d' % k))
        for k in range(s['lower']):
            u = mix(0.955, 0.22 if name == 'python' else 0.28, k / (s['lower'] - 1))
            tm = float(mouth_theta(np.array([u]), s, side))
            th = theta_offset(u, tm, s['labialH'] * 0.5, s, -side)
            w = s['labialH'] * 0.5 * (1 - 0.3 * k / s['lower'])
            seeds.append((u, th, w, 'lower%d' % k))
    if name == 'corn':
        # the colubrid crown: internasals, prefrontals, frontal, supraoculars, parietals
        at(0.935, 0.30, 0.0019, 'internasal')
        at(0.845, 0.36, 0.0026, 'prefrontal')
        at(0.69, 0.0, 0.0029, 'frontal')
        at(0.665, 0.92, 0.0020, 'supraocular')
        at(0.515, 0.38, 0.0034, 'parietal')
        at(0.915, 1.08, 0.0016, 'nasal')
        at(0.835, 1.22, 0.0012, 'loreal')
        at(0.745, 1.18, 0.0012, 'preocular')
        at(0.575, 1.10, 0.0010, 'postocular')
        at(0.585, 1.36, 0.0010, 'postocular')
        at(0.445, 1.22, 0.0016, 'temporal')
        at(0.39, 0.95, 0.0016, 'temporal')
        at(0.33, 0.62, 0.0018, 'temporal')
        # chin shields
        at(0.86, math.pi - 0.22, 0.0021, 'chin')
        at(0.72, math.pi - 0.26, 0.0021, 'chin')
        at(0.985, math.pi - 0.0, 0.0016, 'mental', both=False)
    else:
        at(0.985, math.pi, 0.0018, 'mental', both=False)
        # a pair of slightly bigger internasals behind the rostral
        at(0.945, 0.28, 0.0014, 'internasal')
    return seeds


def spacing(u, th, s):
    sn = np.sin(th)
    sp = np.full(np.shape(u), s['small'])
    sp = mix(sp, s['gular'], ss(-0.4, -0.85, sn))
    sp = sp * (1 - 0.12 * ss(0.75, 1.0, u))
    return sp


def poisson(s, name, rng):
    ex = explicit_seeds(s, name)
    eu = np.array([e[0] for e in ex])
    et = np.array([e[1] for e in ex])
    ep, _ = surface(eu, et, s)
    ew = np.array([e[2] for e in ex])
    # candidates, area weighted
    n0 = 400000
    cu = rng.random(n0) ** 0.9
    ct = -math.pi / 2 + rng.random(n0) * TAU
    cp, _ = surface(cu, ct, s)
    # area element via neighbours on a coarse grid is overkill: thin out by the profile size
    w, hh, z0, _ = profile(cu, s)
    keep = rng.random(n0) < np.clip((w + hh) / (2 * s['wmax']), 0.05, 1)
    cu, ct, cp = cu[keep], ct[keep], cp[keep]
    csp = spacing(cu, ct, s)
    cell = 0.0012
    grid = {}
    out_p, out_u, out_t, out_w = [], [], [], []

    def key(q):
        return (int(math.floor(q[0] / cell)), int(math.floor(q[1] / cell)), int(math.floor(q[2] / cell)))

    # exclusion round the shields
    dmin_big = np.full(len(cp), 1e9)
    for i in range(len(ep)):
        dmin_big = np.minimum(dmin_big, np.linalg.norm(cp - ep[i], axis=-1) - ew[i] * 1.05)
    ok = dmin_big > csp * 0.45
    order = rng.permutation(np.nonzero(ok)[0])
    for i in order:
        q = cp[i]
        r = csp[i]
        k = key(q)
        reach = int(math.ceil(r / cell))
        bad = False
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for dz in range(-reach, reach + 1):
                    for j in grid.get((k[0] + dx, k[1] + dy, k[2] + dz), ()):
                        if np.sum((out_p[j] - q) ** 2) < (min(r, out_w[j]) ** 2):
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
            if bad:
                break
        if bad:
            continue
        grid.setdefault(k, []).append(len(out_p))
        out_p.append(q)
        out_u.append(cu[i])
        out_t.append(ct[i])
        out_w.append(r)
    nsmall = len(out_p)
    su = np.concatenate([eu, np.array(out_u)])
    st = np.concatenate([et, np.array(out_t)])
    sw = np.concatenate([ew, np.array(out_w) * 0.56])
    kinds = [e[3] for e in ex] + ['small'] * nsmall
    fixed = np.array([True] * len(ex) + [False] * nsmall)
    return su, st, sw, kinds, fixed


def voronoi(tp, sp, sw, tile=(32, 64)):
    """weighted nearest two seeds for every texel. tp: (H, W, 3)"""
    H, W, _ = tp.shape
    i1 = np.zeros((H, W), np.int32)
    d1 = np.zeros((H, W))
    d2 = np.zeros((H, W))
    marg = sw * 2.8 + 0.0015
    for y0 in range(0, H, tile[0]):
        for x0 in range(0, W, tile[1]):
            blk = tp[y0:y0 + tile[0], x0:x0 + tile[1]].reshape(-1, 3)
            lo, hi = blk.min(0), blk.max(0)
            gap = np.linalg.norm(np.maximum(0, np.maximum(lo - sp, sp - hi)), axis=-1)
            cand = np.nonzero(gap < marg)[0]
            if len(cand) < 2:
                cand = np.argsort(gap)[:8]
            dist = np.linalg.norm(blk[:, None, :] - sp[None, cand, :], axis=-1) / sw[None, cand]
            part = np.argpartition(dist, 1, axis=1)[:, :2]
            a = np.take_along_axis(dist, part, 1)
            sw_ = a[:, 0] > a[:, 1]
            first = np.where(sw_, part[:, 1], part[:, 0])
            da = np.minimum(a[:, 0], a[:, 1])
            db = np.maximum(a[:, 0], a[:, 1])
            h, w = min(tile[0], H - y0), min(tile[1], W - x0)
            i1[y0:y0 + h, x0:x0 + w] = cand[first].reshape(h, w)
            d1[y0:y0 + h, x0:x0 + w] = da.reshape(h, w)
            d2[y0:y0 + h, x0:x0 + w] = db.reshape(h, w)
    return i1, d1, d2


# --- colour ---------------------------------------------------------------------

def phi_of(th):
    # angle from the top centre, + on the left; |phi| = pi at the chin
    p = math.pi / 2 - th
    return (p + math.pi) % TAU - math.pi


def colours(look, s, su, st, kinds, rng):
    n = len(su)
    phi = phi_of(st)
    aphi = np.abs(phi)
    jit = rng.normal(0, 1, (n, 3))
    col = np.zeros((n, 3))
    rough = np.full(n, 0.36)
    is_up = np.array([k.startswith('upper') for k in kinds])
    is_lo = np.array([k.startswith('lower') for k in kinds])
    lab = is_up | is_lo
    labn = np.array([int(k[5:]) if k.startswith(('upper', 'lower')) else 0 for k in kinds])
    C = lambda *c: srgb_to_lin(list(c))[None]
    if look == 'python':
        top = srgb_to_lin([18, 104, 46])
        side = srgb_to_lin([58, 150, 46])
        lip = srgb_to_lin([214, 226, 128])
        chin = srgb_to_lin([226, 232, 150])
        t = ss(0.5, 1.5, aphi)
        col = top[None] * (1 - t[:, None]) + side[None] * t[:, None]
        col = np.where(ss(2.0, 2.4, aphi)[:, None] > 0.5, chin[None], col)
        col = np.where((is_up | is_lo)[:, None], lip[None] * (0.94 + 0.06 * rng.random((n, 1))), col)
        # the odd white or pale blue scale on the crown, as adults have
        fleck = (rng.random(n) < 0.012) & (aphi < 0.9) & (su > 0.15) & (su < 0.85)
        col = np.where(fleck[:, None], srgb_to_lin([226, 236, 230])[None], col)
        col = col * (1 + 0.07 * jit[:, :1]) + 0.012 * jit * col
    elif look == 'ball':
        # dark brown, a tan stripe from the nostril over the eye to the nape, a dark one through the eye
        col = np.repeat(C(54, 38, 26), n, 0)
        stripe = (np.abs(aphi - (0.95 + 0.25 * (1 - su))) < 0.17) & (su > 0.08) & (su < 0.95)
        col = np.where(stripe[:, None], C(184, 138, 78), col)
        eyeband = (np.abs(aphi - 1.5) < 0.16) & (su < 0.62) & (su > 0.1)
        col = np.where(eyeband[:, None], C(28, 19, 13), col)
        col = np.where((aphi > 1.85)[:, None] | lab[:, None], C(228, 214, 182), col)
        col = col * (1 + 0.06 * jit[:, :1])
    elif look == 'carpet':
        # black and yellow in blotches, a black stripe back from the eye, the lips barred
        v = np.sin(su * 22 + phi * 3.2) + np.sin(su * 9 - aphi * 5) * 0.6 + rng.normal(0, 0.5, n)
        col = np.where((v > 0.55)[:, None], C(228, 182, 40), C(24, 20, 14))
        col = np.where(((np.abs(aphi - 1.4) < 0.14) & (su < 0.62))[:, None], C(20, 16, 12), col)
        col = np.where(lab[:, None], np.where((labn % 2 == 0)[:, None], C(230, 200, 90), C(30, 24, 16)), col)
        col = np.where(((aphi > 2.0) & ~lab)[:, None], C(226, 206, 130), col)
        col = col * (1 + 0.06 * jit[:, :1])
    elif look == 'burmese':
        # albino: cream, a butter-yellow arrowhead on the crown and a stripe back from the eye
        col = np.repeat(C(244, 234, 208), n, 0)
        spear = np.maximum(np.abs(phi) - (0.75 - su) * 1.0, su - 0.75)
        spear = np.maximum(spear, 0.1 - su) < 0
        col = np.where(spear[:, None], C(242, 196, 78), col)
        col = np.where(((np.abs(aphi - 1.4) < 0.15) & (su < 0.64) & (su > 0.05))[:, None], C(236, 172, 56), col)
        col = np.where(lab[:, None] | (aphi > 2.0)[:, None], C(250, 244, 228), col)
        col = col * (1 + 0.04 * jit[:, :1])
    elif look == 'king':
        # chocolate black, white lips and chin, white flecks on the snout
        col = np.repeat(C(30, 22, 18), n, 0)
        fleck = (su > 0.82) & (rng.random(n) < 0.45)
        col = np.where(fleck[:, None], C(232, 226, 204), col)
        col = np.where(lab[:, None] | (aphi > 1.95)[:, None], C(236, 230, 208), col)
        col = np.where((lab & (labn % 3 == 2))[:, None], C(60, 46, 36), col)
        col = col * (1 + 0.05 * jit[:, :1])
        rough[:] = 0.26
    elif look == 'milk':
        # black head, a yellow band across the back of it, the lips barred black and yellow
        col = np.repeat(C(18, 14, 12), n, 0)
        band = (su > 0.1) & (su < 0.3)
        col = np.where(band[:, None], C(236, 198, 96), col)
        col = np.where(lab[:, None], np.where((labn % 2 == 0)[:, None], C(232, 210, 150), C(20, 16, 14)), col)
        col = np.where(((aphi > 2.15) & ~lab)[:, None], C(226, 210, 160), col)
        col = col * (1 + 0.05 * jit[:, :1])
        rough[:] = 0.26
    elif look == 'garter':
        # olive, two pale dots on the crown, yellow lips barred black at the sutures, a pale chin
        col = np.repeat(C(78, 70, 42), n, 0)
        dots = (np.abs(su - 0.47) < 0.05) & (np.abs(aphi - 0.16) < 0.12)
        col = np.where(dots[:, None], C(222, 204, 116), col)
        col = np.where(lab[:, None], np.where((labn % 2 == 0)[:, None], C(216, 206, 140), C(30, 28, 18)), col)
        col = np.where(((aphi > 2.05) & ~lab)[:, None], C(212, 214, 162), col)
        col = col * (1 + 0.07 * jit[:, :1])
        rough[:] = 0.4
    else:
        ground = srgb_to_lin([214, 128, 66])
        pale = srgb_to_lin([232, 176, 118])
        red = srgb_to_lin([186, 52, 26])
        black = srgb_to_lin([30, 16, 12])
        white = srgb_to_lin([236, 228, 212])
        x = su  # along
        y = phi  # across, + left
        t = ss(0.9, 1.6, aphi)
        col = ground[None] * (1 - t[:, None]) + pale[None] * t[:, None]
        # signed fields (negative inside) for the marks, in (u, phi)
        band = np.maximum(np.abs(x - 0.80) - 0.06, aphi - 1.75)  # across the snout through the eyes
        spear = np.maximum(np.abs(y) - (0.62 - x) * 1.1, x - 0.62)  # arrowhead pointing forward
        spear = np.maximum(spear, 0.28 - x)
        stem = np.minimum(np.abs(np.abs(y) - (0.25 + (0.28 - x) * 1.6)) - 0.17, 1)  # two arms down the neck
        stem = np.maximum(stem, x - 0.3)
        post = np.abs((aphi - 1.2) - (0.6 - x) * 0.9) - 0.14  # behind the eye, down to the jaw angle
        post = np.maximum(post, np.maximum(x - 0.6, 0.14 - x))
        f = np.minimum(np.minimum(band, spear), np.minimum(stem, post))
        inside = f < 0
        edge = (f >= 0) & (f < 0.035)
        col = np.where(inside[:, None], red[None], col)
        col = np.where(edge[:, None], black[None], col)
        col = np.where(lab[:, None], mix(white, pale, 0.35)[None], col)
        col = np.where((aphi > 2.15)[:, None] & ~lab[:, None], white[None], col)
        col = col * (1 + 0.06 * jit[:, :1]) + 0.015 * jit * col
        rough[:] = 0.32
    return np.clip(col, 0, 1), rough, is_up, is_lo


# --- maps -----------------------------------------------------------------------

def bake(name, s, rng):
    H, W = TEX_H, TEX_W
    tu = (np.arange(H) + 0.5) / H
    tt = -math.pi / 2 + (np.arange(W) + 0.5) / W * TAU
    U, T = np.meshgrid(tu, tt, indexing='ij')
    tp, tn = surface(U.ravel(), T.ravel(), s)
    tp = tp.reshape(H, W, 3)

    su, st, sw, kinds, fixed = poisson(s, name, rng)
    sp, _ = surface(su, st, s)
    print(name, 'seeds', len(su))
    # relax the granules twice toward the middle of their cells
    for it in range(2):
        i1, d1, d2 = voronoi(tp, sp, sw)
        idx = i1.ravel()
        cnt = np.bincount(idx, minlength=len(su)).astype(float)
        mu = np.bincount(idx, U.ravel(), len(su))
        cx = np.bincount(idx, np.cos(T.ravel()), len(su))
        cy = np.bincount(idx, np.sin(T.ravel()), len(su))
        has = (cnt > 0) & ~fixed
        su = np.where(has, mu / np.maximum(cnt, 1), su)
        ang = np.arctan2(cy, cx)
        ang = np.where(ang < -math.pi / 2, ang + TAU, ang)
        st = np.where(has, ang, st)
        sp, _ = surface(su, st, s)
    i1, d1, d2 = voronoi(tp, sp, sw)

    col_c, rough_c, is_up, is_lo = colours(name, s, su, st, kinds, rng)
    # the other species of this family on the same scales, each with a dice of its own
    others = {look: colours(look, s, su, st, kinds, np.random.default_rng(sum(map(ord, look))))[0]
              for look in LOOKS[name][1:]}

    # metric per texel step
    du = np.linalg.norm(np.gradient(tp, axis=0), axis=-1) + 1e-9
    dtp = (np.roll(tp, -1, 1) - np.roll(tp, 1, 1)) / 2
    dt = np.linalg.norm(dtp, axis=-1) + 1e-9
    rloc = dt / (TAU / W)  # |dP/dtheta|

    w1 = sw[i1]
    gap = (d2 - d1) * w1 * 0.5
    big = ~np.array([k == 'small' for k in kinds])[i1]
    groove = np.where(big, 0.00009, 0.00006)
    edge = ss(0.0, 1.0, gap / groove)
    dome = 1 - 0.55 * np.clip(d1, 0, 1.4) ** 2
    amp = np.where(big, 0.00020, 0.00015)
    h = amp * dome * edge
    # micro relief on the keratin
    h += 0.000004 * np.sin(tp[..., 0] * 9000 + np.sin(tp[..., 1] * 7000) * 2) * np.sin(tp[..., 2] * 8000 + np.sin(tp[..., 0] * 5000) * 3)

    cav = np.zeros((H, W))
    # the lip line
    for side in (1, -1):
        tm = mouth_theta(U, s, side)
        dist = np.abs(T - tm) * rloc
        g = np.exp(-(dist / 0.00028) ** 2) * ss(s['mouth']['end'], s['mouth']['end'] + 0.05, U) * (1 - ss(0.985, 1.0, U))
        h -= 0.00030 * g
        cav = np.maximum(cav, g * 0.8)
    # chin groove
    dist = np.abs(T - 3 * math.pi / 2 + TAU * (T > math.pi)) * rloc
    dist = np.minimum(np.abs(T + math.pi / 2), np.abs(T - 3 * math.pi / 2)) * rloc
    g = np.exp(-(dist / 0.0003) ** 2) * ss(0.55, 0.7, U) * (1 - ss(0.96, 1.0, U))
    h -= 0.00015 * g
    cav = np.maximum(cav, g * 0.5)

    def pit(u0, th0, ru, rt, depth, dark):
        nonlocal h, cav
        dx = (U - u0) * du * H
        dy = ((T - th0 + math.pi) % TAU - math.pi) * rloc
        m = np.exp(-((dx / ru) ** 2 + (dy / rt) ** 2) ** 1.4)
        h -= depth * m
        cav = np.maximum(cav, m * dark)

    nz = s['nostril']
    for side in (1, -1):
        pit(nz['u'], math.pi / 2 - side * nz['phi'], nz['r'] * 0.8, nz['r'], 0.0008, 0.92)
    if s['pits']:
        for side in (1, -1):
            # the rostral pits: two deep slits either side of the snout tip
            tm = float(mouth_theta(np.array([0.975]), s, side))
            pit(0.978, theta_offset(0.975, tm, 0.0014, s, side), 0.0009, 0.0005, 0.0010, 0.9)
            for k, u in enumerate([0.905, 0.84, 0.775, 0.71]):
                tm = float(mouth_theta(np.array([u]), s, side))
                pit(u, theta_offset(u, tm, 0.0011, s, side), 0.00085, 0.00045, 0.0009, 0.88)
            for u in [0.48, 0.42, 0.36, 0.30, 0.245]:
                tm = float(mouth_theta(np.array([u]), s, side)[0])
                pit(u, theta_offset(u, tm, 0.0012, s, -side), 0.0009, 0.0006, 0.0008, 0.8)

    # colour: the scale's own, darker in the joints and the cavities
    joint = 1 - edge
    lab = (is_up | is_lo)[i1]

    def paint(cc):
        col = cc[i1]
        col = col * (1 - 0.28 * joint[..., None]) * (0.88 + 0.12 * dome[..., None])
        if name == 'corn':
            col = np.where((lab & (joint > 0.3))[..., None], srgb_to_lin([40, 22, 16])[None, None], col)
        col = col * (1 - cav[..., None] * 0.92)
        return lin_to_srgb(col)

    # normal map, tangent space: x along +theta (image x), y along +u (image y)
    gh_u = np.gradient(h, axis=0) / du
    gh_t = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2 / dt
    pole = 1 - ss(0.985, 1.0, U)
    nx = -gh_t * pole
    ny = -gh_u * pole
    nzz = np.ones_like(nx)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nzz ** 2)
    nm = np.stack([nx / ln, ny / ln, nzz / ln], -1) * 0.5 + 0.5

    rough = rough_c[i1] + 0.25 * joint + 0.4 * cav
    return paint(col_c), {k: paint(v) for k, v in others.items()}, nm, np.clip(rough, 0, 1)


def to_image(name, arr, colorspace):
    H, W, _ = arr.shape
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.concatenate([arr, np.ones((H, W, 1))], -1).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(HERE, 'tex', name + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


# --- mesh -----------------------------------------------------------------------

def build_head(name, s, col_img, nrm_img, rough_img, root):
    u = np.linspace(0, 1, NU)
    u = 1 - (1 - u) ** 1.08
    th = -math.pi / 2 + np.linspace(0, 1, NT + 1) * TAU
    UU, TT = np.meshgrid(u, th, indexing='ij')
    p, _ = surface(UU.ravel(), TT.ravel(), s)
    p = p.reshape(NU, NT + 1, 3)
    me = bpy.data.meshes.new(name + '_head')
    verts = [tuple(v) for v in p.reshape(-1, 3)]
    faces = []
    uvs = []
    for i in range(NU - 1):
        for j in range(NT):
            a = i * (NT + 1) + j
            b = a + 1
            c = a + (NT + 1) + 1
            d = a + (NT + 1)
            faces.append((a, b, c, d))
            uvs.append([(j / NT, u[i]), ((j + 1) / NT, u[i]), ((j + 1) / NT, u[i + 1]), (j / NT, u[i + 1])])
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    flat = [c for f in uvs for c in f]
    uvl.data.foreach_set('uv', np.array(flat, dtype=np.float32).ravel())
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-8)
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = True
    ob = bpy.data.objects.new(name + '_head', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root

    mat = bpy.data.materials.new(name + '_skin')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col_img
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm_img
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = rough_img
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tr.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    bsdf.inputs['Coat Weight'].default_value = 0.4
    bsdf.inputs['Coat Roughness'].default_value = 0.18
    me.materials.append(mat)
    return ob


def build_eyes(name, s, root):
    mat = bpy.data.materials.new(name + '_eye')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.3, 0.2, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.05
    out = []
    for side, tag in ((1, 'L'), (-1, 'R')):
        c, sp, sn = eye_center(s, side)
        me = bpy.data.meshes.new(name + '_eye_' + tag)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=s['eye']['r'], calc_uvs=True)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = True
        me.materials.append(mat)
        ob = bpy.data.objects.new(name + '_eye_' + tag, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = root
        ob.location = tuple(c)
        # local +Z of the eye looks out along the socket normal
        z = np.array(sn) / np.linalg.norm(sn)
        from mathutils import Vector
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = Vector(tuple(z)).to_track_quat('Z', 'X')
        out.append(ob)
    return out


def build_tongue(name, s, root):
    from mathutils import Vector
    L = s['L'] * (0.62 if name == 'python' else 0.75)
    r0 = s['L'] * (0.022 if name == 'python' else 0.028)
    verts, faces = [], []
    ring = 10

    def tube(path, radii):
        start = len(verts)
        for i, (p, r) in enumerate(zip(path, radii)):
            t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            n = t.cross(Vector((0, 0, 1))).normalized()
            b = t.cross(n)
            for k in range(ring):
                a = k / ring * TAU
                verts.append(tuple(p + (n * math.cos(a) * 1.25 + b * math.sin(a) * 0.8) * r))
        for i in range(len(path) - 1):
            for k in range(ring):
                a = start + i * ring + k
                b2 = start + i * ring + (k + 1) % ring
                faces.append((a, b2, b2 + ring, a + ring))
        tip = len(verts)
        verts.append(tuple(path[-1] + (path[-1] - path[-2]).normalized() * radii[-1]))
        last = start + (len(path) - 1) * ring
        for k in range(ring):
            faces.append((last + k, last + (k + 1) % ring, tip))

    nb = 14
    fork = 0.58
    stem = [Vector((-0.4 * L + (fork + 0.4) * L * i / (nb - 1), 0, 0)) for i in range(nb)]
    tube(stem, [r0 * (1 - 0.2 * i / (nb - 1)) for i in range(nb)])
    for side in (1, -1):
        nt_ = 12
        path, radii = [], []
        for i in range(nt_):
            t = i / (nt_ - 1)
            x = fork * L - r0 * 0.6 + (1 - fork) * L * t + r0 * 0.6 * t
            y = side * (r0 * 0.55 + r0 * 3.2 * t ** 1.6)
            path.append(Vector((x, y, 0)))
            radii.append(r0 * 0.62 * (1 - 0.85 * t ** 1.3))
        tube(path, radii)
    me = bpy.data.meshes.new(name + '_tongue')
    me.from_pydata(verts, [], faces)
    me.update()
    for f in me.polygons:
        f.use_smooth = True
    mat = bpy.data.materials.new(name + '_tongue')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1) if name == 'python' else (0.25, 0.015, 0.02, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.25
    me.materials.append(mat)
    ob = bpy.data.objects.new(name + '_tongue', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = root
    w, hh, z0, _ = profile(np.array([0.985]), s)
    ob.location = (s['L'] * 0.985 - 0.0015, 0, float(z0[0] - hh[0] * 0.35))
    return ob


def build(name, rng):
    s = SPECIES[name]
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    col, others, nrm, rough = bake(name, s, rng)
    ci = to_image(name + '_color', col, 'sRGB')
    for look, c in others.items():
        img = to_image(look + '_color', c, 'sRGB')
        path = os.path.join(PUBLIC, 'heads', look + '.jpg')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.filepath_raw = path
        img.file_format = 'JPEG'
        img.save()
        print('painted', look)
    ni = to_image(name + '_normal', nrm, 'Non-Color')
    ri = to_image(name + '_rough', np.stack([rough * 0, rough, rough * 0], -1), 'Non-Color')
    head = build_head(name, s, ci, ni, ri, root)
    eyes = build_eyes(name, s, root)
    tongue = build_tongue(name, s, root)
    return root, [head, tongue] + eyes


def export(name, root, obs):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    os.makedirs(PUBLIC, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(PUBLIC, name + '.glb'), export_format='GLB', use_selection=True,
        export_image_format='JPEG', export_jpeg_quality=90, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_animations=False,
    )


def preview(name, root):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 48
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 1000, 700
    s = SPECIES[name]
    L = s['L']
    if 'cam' not in bpy.data.objects:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = 3.5
        sun.data.angle = 0.2
        sun.rotation_euler = (0.7, 0.2, 0.9)
        sc.collection.objects.link(sun)
        world = bpy.data.worlds.new('w')
        world.use_nodes = True
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
        sc.world = world
    cam = bpy.data.objects['cam']
    cam.data.lens = 80
    cam.data.clip_start = 0.001
    sc.camera = cam
    from mathutils import Vector
    for tag, pos in (('three', Vector((L * 1.9, L * 1.3, L * 1.0))), ('side', Vector((L * 0.55, L * 2.6, L * 0.25))), ('top', Vector((L * 0.5, 0.0001, L * 2.8))), ('front', Vector((L * 3.2, L * 0.5, L * 0.3)))):
        cam.location = root.location + pos
        d = root.location + Vector((L * 0.55, 0, 0)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(HERE, 'renders', '%s_%s.png' % (name, tag))
        bpy.ops.render.render(write_still=True)


def main():
    # empty scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    rng = np.random.default_rng(4)
    built = {}
    for name in ONLY or ['python', 'corn']:
        built[name] = build(name, rng)
        export(name, *built[name])
    # side by side in the .blend
    if 'corn' in built:
        built['corn'][0].location = (0, 0.12, 0)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'heads.blend'))
    if RENDER:
        for name, (root, obs) in built.items():
            for other, (r2, o2) in built.items():
                for o in [r2] + o2:
                    o.hide_render = other != name
            preview(name, root)


main()
