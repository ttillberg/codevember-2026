# Thins the perch in branch.blend (as first modelled) by THIN about its own axis, and moves what grows on it
# (twiglets, the shoot with its buds and hairs) in with the bark so nothing floats.
# Then shifts it all so the top of the twig at x = 0 is back at the origin.
# Runs once: each run thins again. Run in Blender with branch.blend open.
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

THIN = 0.45

perch = bpy.data.objects['perch']
bm = bmesh.new()
bm.from_mesh(perch.data)
bm.verts.ensure_lookup_table()
bm.normal_update()
bvh = BVHTree.FromBMesh(bm)

# the axis under each vertex: halfway to the far wall along the inward normal
center = []
for v in bm.verts:
    n = v.normal
    hit = bvh.ray_cast(v.co - n * 0.002, -n, 1.5)
    center.append(v.co - n * (hit[3] * 0.5 + 0.001) if hit[0] is not None else None)
# fill misses from neighbours, then smooth the field so bumps and knots don't kink it
for _ in range(3):
    for v in bm.verts:
        if center[v.index] is None:
            got = [center[e.other_vert(v).index] for e in v.link_edges if center[e.other_vert(v).index] is not None]
            if got:
                center[v.index] = sum(got, Vector()) / len(got)
center = [c if c is not None else bm.verts[i].co.copy() for i, c in enumerate(center)]
for _ in range(12):
    nxt = []
    for v in bm.verts:
        s = center[v.index].copy()
        for e in v.link_edges:
            s += center[e.other_vert(v).index]
        nxt.append(s / (len(v.link_edges) + 1))
    center = nxt

old = [v.co.copy() for v in bm.verts]
move = [center[i] + (old[i] - center[i]) * THIN - old[i] for i in range(len(old))]
faces = [[v.index for v in f.verts] for f in bm.faces]


def move_at(p):
    """how far the bark nearest p moves"""
    _, _, fi, _ = bvh.find_nearest(p)
    vs = faces[fi]
    return sum((move[i] for i in vs), Vector()) / len(vs)


for v in bm.verts:
    v.co = old[v.index] + move[v.index]

# twiglets: each loose piece moves with the bark at its root
tw = bpy.data.objects['twiglets']
tb = bmesh.new()
tb.from_mesh(tw.data)
tb.verts.ensure_lookup_table()
seen = set()
for v0 in tb.verts:
    if v0.index in seen:
        continue
    island, stack = [], [v0]
    seen.add(v0.index)
    while stack:
        v = stack.pop()
        island.append(v)
        for e in v.link_edges:
            o = e.other_vert(v)
            if o.index not in seen:
                seen.add(o.index)
                stack.append(o)
    root = min(island, key=lambda v: (bvh.find_nearest(v.co)[3]))
    d = move_at(root.co)
    for v in island:
        v.co += d
tb.to_mesh(tw.data)
tb.free()

# the shoot, its buds and hairs: all move with the bark under the shoot's root
sh = bpy.data.objects['shoot']
root = min(sh.data.vertices, key=lambda v: bvh.find_nearest(v.co)[3])
d = move_at(root.co.copy())
for name in ('shoot', 'buds', 'hairs'):
    for v in bpy.data.objects[name].data.vertices:
        v.co += d

bm.to_mesh(perch.data)
bm.free()

# top of the twig at x = 0 back to the origin
hit = BVHTree.FromObject(perch, bpy.context.evaluated_depsgraph_get()).ray_cast(Vector((0, 0, 2)), Vector((0, 0, -1)))
lift = -hit[0].z if hit[0] is not None else 0.0
for name in ('perch', 'twiglets', 'shoot', 'buds', 'hairs'):
    for v in bpy.data.objects[name].data.vertices:
        v.co.z += lift
    bpy.data.objects[name].data.update()
result = {'lift': lift, 'shoot_move': list(d)}
