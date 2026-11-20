"""What the turnaround sheet (ref/sheet.webp) says, read off it by hand.

Each view is a box cut out of the sheet and blown up `zoom` times; every coordinate below is a pixel in that
blown-up crop, read off a grid laid over it. `top` and `bottom` are where the shell starts and stops, without
the cables; the shell is HEIGHT metres between them, and that sets each view's scale. `cx` is the middle of the
body across the view.

World axes: Z up, front is -Y, and +X is on your right when you face the front.
`right` is the world direction that runs to the right of a view's picture, `toward` the one from the pod to
its camera.
"""
HEIGHT = 2.6

VIEWS = {
    'front': dict(crop=(40, 0, 280, 300), zoom=3, top=72, bottom=832, cx=367, right=(1, 0, 0), toward=(0, -1, 0)),
    'right': dict(crop=(315, 0, 560, 300), zoom=3, top=92, bottom=828, cx=370, right=(0, -1, 0), toward=(-1, 0, 0)),
    'left': dict(crop=(805, 0, 1045, 300), zoom=3, top=95, bottom=830, cx=334, right=(0, 1, 0), toward=(1, 0, 0)),
    'back': dict(crop=(585, 0, 780, 300), zoom=3, top=95, bottom=815, cx=277.5, right=(-1, 0, 0), toward=(0, 1, 0)),
}

# The outline of the body in each view, cables and the box sticking off the back left out.
SILHOUETTE = {
    'front': [(215, 80), (390, 72), (500, 90), (560, 170), (595, 260), (620, 400), (636, 560), (640, 690), (600, 775),
              (560, 815), (440, 832), (300, 820), (200, 790), (160, 720), (130, 640), (100, 520), (95, 400), (100, 300),
              (125, 230), (160, 185), (205, 110)],
    'right': [(175, 170), (380, 92), (440, 95), (500, 150), (535, 195), (575, 310), (600, 420), (612, 550), (632, 650),
              (640, 722), (597, 806), (560, 820), (480, 828), (330, 828), (220, 805), (160, 730), (125, 640), (105, 520),
              (100, 400), (110, 290), (140, 230)],
    'left': [(240, 115), (330, 95), (365, 108), (505, 148), (550, 195), (585, 240), (600, 330), (605, 480), (600, 640),
             (570, 750), (500, 830), (300, 832), (130, 815), (80, 760), (68, 700), (70, 620), (90, 550), (105, 430),
             (150, 300), (190, 200)],
    'back': [(130, 105), (210, 95), (395, 95), (470, 105), (500, 185), (530, 300), (540, 450), (540, 600), (520, 650),
             (480, 720), (410, 800), (300, 815), (170, 810), (90, 740), (40, 660), (15, 580), (20, 420), (40, 300),
             (70, 190)],
}


def scale(view):
    v = VIEWS[view]
    return HEIGHT / (v['bottom'] - v['top'])


def to_view(view, px, py):
    """a pixel of a view to metres in its picture plane: (along `right`, up)"""
    v = VIEWS[view]
    k = scale(view)
    return (px - v['cx']) * k, ((v['top'] + v['bottom']) / 2 - py) * k


def to_world(view, px, py, depth=0.0):
    """a pixel of a view to a world point, `depth` metres toward its camera"""
    v = VIEWS[view]
    u, w = to_view(view, px, py)
    r, t = v['right'], v['toward']
    return tuple(r[i] * u + t[i] * depth + (w if i == 2 else 0.0) for i in range(3))


# The plates, traced in the view each is seen best in, as (name, outline). Read in order: the first outline a
# piece of the surface falls in decides what it is. 'open' is no plate: the dark core, the machinery.
# The seam down the front is left open on purpose, a hand wide, with the blocks in it.
PLATES = {
    'front': [
        ('open', [(390, 60), (410, 60), (425, 300), (435, 470), (447, 650), (457, 845), (437, 845), (427, 650),
                  (415, 470), (405, 300)]),
        ('cap_l', [(150, 175), (205, 86), (390, 72), (405, 300), (410, 418), (345, 424), (298, 300), (268, 212)]),
        ('strip', [(345, 424), (410, 418), (415, 470), (427, 650), (398, 652)]),
        ('panel_l', [(92, 300), (120, 230), (150, 175), (268, 212), (298, 300), (345, 424), (398, 652), (130, 640),
                     (100, 520), (88, 400)]),
        ('skirt_fl', [(130, 640), (398, 652), (427, 650), (437, 845), (300, 830), (190, 800), (140, 720)]),
        ('door', [(410, 72), (500, 88), (518, 160), (532, 300), (546, 450), (558, 578), (452, 594), (435, 470),
                  (425, 300)]),
        ('door_low', [(452, 594), (558, 578), (566, 690), (458, 700), (447, 650)]),
        ('flank_rf', [(500, 88), (565, 160), (600, 260), (625, 400), (642, 560), (645, 690), (566, 690), (558, 578),
                      (546, 450), (532, 300), (518, 160)]),
        ('skirt_fr', [(458, 700), (645, 690), (610, 780), (565, 822), (460, 845)]),
    ],
    'right': [
        ('cap_ls', [(160, 160), (380, 85), (450, 88), (510, 145), (545, 200), (450, 212), (395, 186), (330, 184),
                    (215, 262), (190, 205)]),
        ('shield_l', [(215, 262), (330, 184), (395, 186), (450, 212), (545, 200), (585, 320), (610, 430), (620, 560),
                      (632, 650), (640, 724), (442, 632), (300, 410), (185, 395), (180, 345)]),
        ('skirt_ls', [(442, 632), (640, 724), (650, 730), (600, 812), (560, 825), (480, 840), (390, 815), (350, 720)]),
    ],
    'left': [
        ('cap_rs', [(230, 105), (330, 88), (370, 100), (510, 140), (560, 195), (520, 215), (400, 185), (360, 185),
                    (210, 262), (185, 210)]),
        ('shield_r', [(210, 262), (360, 185), (400, 185), (510, 238), (540, 290), (540, 385), (412, 408), (405, 590),
                      (330, 660), (95, 712), (85, 550), (100, 430), (145, 300)]),
        ('skirt_rs', [(95, 712), (330, 660), (405, 620), (425, 700), (480, 835), (300, 840), (125, 820), (75, 760),
                      (62, 700)]),
    ],
    # (white strips down the back corners, as the sheet's back view has them, were tried and taken off: they
    # stood off the back like wings. The back is machinery out to the flanks' plates.)
    'back': [],
}
# What a piece of surface is when no outline of its view takes it.
OTHERWISE = {'front': 'panel_m', 'right': 'open', 'left': 'open', 'back': 'open'}
