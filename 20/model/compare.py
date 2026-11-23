"""Hold the model up against the turnaround sheet. Run after build.py, in the same Blender:

    Blender -b cocoon.blend --python build.py --python compare.py -- OUT.png

For each view in sheet.py it renders the pod at the sheet's own scale and angle, draws the model's outline in
cyan over the sheet's picture and the traced outline in yellow, and puts the plain render under it. It prints
how much the model's outline and the traced one overlap (intersection over union) per view.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sheet

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else os.path.join(HERE, 'compare.png')
scene = bpy.context.scene

# the pod hangs straight for this
pod = bpy.data.objects.get('pod')
if pod: pod.rotation_euler = (0, 0, 0)
for o in bpy.data.objects:
    if o.type == 'MESH' and o.users_collection and o.users_collection[0].name != 'cocoon':
        o.hide_render = True

src = bpy.data.images.load(os.path.join(HERE, 'ref', 'sheet.webp'))
W, H = src.size
SHEET = np.empty(W * H * 4, np.float32); src.pixels.foreach_get(SHEET)
SHEET = SHEET.reshape(H, W, 4)[::-1]  # row 0 at the top


def crop(view):
    v = sheet.VIEWS[view]
    x0, y0, x1, y1 = v['crop']
    c = SHEET[y0:y1, x0:x1][::-1].copy()
    img = bpy.data.images.new('crop_' + view, c.shape[1], c.shape[0])
    img.pixels.foreach_set(c.ravel())
    img.scale(c.shape[1] * v['zoom'], c.shape[0] * v['zoom'])
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].copy()


def fill(poly, w, h):
    """rasterise a polygon, even-odd"""
    m = np.zeros((h, w), bool)
    P = np.array(poly, float)
    for y in range(h):
        yc = y + 0.5
        xs = []
        for (x0, y0), (x1, y1) in zip(P, np.roll(P, -1, axis=0)):
            if (y0 <= yc) != (y1 <= yc):
                xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            m[y, max(0, int(round(a))):min(w, int(round(b)))] = True
    return m


def edge(m):
    e = m.copy()
    e[1:-1, 1:-1] = m[1:-1, 1:-1] & ~(m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:])
    return e | np.roll(e, 1, 0) | np.roll(e, 1, 1)


cam = bpy.data.objects.get('compare_cam') or bpy.data.objects.new('compare_cam', bpy.data.cameras.new('compare_cam'))
if not cam.users_collection: scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.show_shadows = False
scene.render.film_transparent = True
scene.render.resolution_percentage = 100
scene.render.image_settings.color_mode = 'RGBA'

tiles, scores = [], {}
tmp = os.path.join(bpy.app.tempdir or '/tmp', 'compare_tile.png')
for view in ('front', 'right', 'back', 'left'):
    v = sheet.VIEWS[view]
    ref = crop(view)
    h, w = ref.shape[:2]
    k = sheet.scale(view)
    r, t = Vector(v['right']), Vector(v['toward'])
    u0, w0 = sheet.to_view(view, w / 2, h / 2)
    cam.location = r * u0 + Vector((0, 0, w0)) + t * 30
    cam.rotation_euler = (-t).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = max(w, h) * k
    cam.data.clip_end = 100
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp, check_existing=False)
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    mine = px.reshape(h, w, 4)[::-1]
    mask = mine[:, :, 3] > 0.5
    traced = fill(sheet.SILHOUETTE[view], w, h)
    scores[view] = (mask & traced).sum() / max(1, (mask | traced).sum())
    top = ref.copy()
    top[:, :, :3] *= 0.75
    top[edge(traced), :3] = (1.0, 0.85, 0.1)
    top[edge(mask), :3] = (0.1, 0.95, 1.0)
    bottom = np.zeros_like(ref); bottom[:, :, :3] = 0.12; bottom[:, :, 3] = 1
    a = mine[:, :, 3:4]
    bottom[:, :, :3] = bottom[:, :, :3] * (1 - a) + mine[:, :, :3] * a
    tiles.append(np.concatenate([top, bottom], axis=0))

h = max(t.shape[0] for t in tiles)
tiles = [np.pad(t, ((0, h - t.shape[0]), (0, 8), (0, 0))) for t in tiles]
out = np.concatenate(tiles, axis=1)
out[:, :, 3] = 1
img = bpy.data.images.new('compare', out.shape[1], out.shape[0])
img.pixels.foreach_set(out[::-1].ravel())
img.filepath_raw = OUT; img.file_format = 'PNG'; img.save()
print('COMPARE', ' '.join('%s %.3f' % kv for kv in scores.items()), 'mean %.3f' % np.mean(list(scores.values())))
