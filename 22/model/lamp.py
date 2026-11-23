"""
Day 22 — Vintage 1970s/80s Scandinavian orange telescoping desk lamp, built in Blender.

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender -b --python 22/model/lamp.py

Generates:
    22/public/lamp.glb      (Y-up GLB loaded by 22/src/lamp.ts)
    22/model/lamp.blend     (editable Blender scene)
"""

import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_GLB = os.path.join(ROOT, "public", "lamp.glb")
OUT_BLEND = os.path.join(HERE, "lamp.blend")
PREVIEW_PNG = os.path.join(HERE, "lamp-preview.png")

# Reset scene cleanly
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

col = bpy.data.collections.new("lamp")
scene.collection.children.link(col)

# Root empty (scale in scene units: 1 unit = 10 cm, matching the 1702 monitor)
# Lamp faces +X in Blender (which becomes +X in Three.js with Y-up export: Blender Z -> Three Y, Blender -Y -> Three Z).
root_obj = bpy.data.objects.new("lamp_root", None)
col.objects.link(root_obj)


# ------------------------------------------------------------------ Helpers

def link_obj(name, mesh, mat=None, parent=root_obj, smooth=True):
    o = bpy.data.objects.new(name, mesh)
    col.objects.link(o)
    if parent:
        o.parent = parent
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat:
                o.data.materials.append(m)
        else:
            o.data.materials.append(mat)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return o


def add_bevel(o, width, segments=3, angle_limit=math.radians(32)):
    mod = o.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = angle_limit
    mod.harden_normals = False
    return mod


def add_weighted_normal(o):
    mod = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    return mod


def make_rod(name, p0, p1, radius, mat, segs=24):
    v0 = Vector(p0)
    v1 = Vector(p1)
    diff = v1 - v0
    length = diff.length
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=radius,
        radius2=radius,
        depth=length,
    )
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = link_obj(name, me, mat)
    o.location = (v0 + v1) * 0.5
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(diff.normalized())
    return o


def make_tube_curve(name, pts, radius, mat, res=20, bevel_res=8):
    curve_data = bpy.data.curves.new(name + "_curve", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = res
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = bevel_res
    curve_data.use_fill_caps = True

    spline = curve_data.splines.new("NURBS")
    spline.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        spline.points[i].co = (p[0], p[1], p[2], 1.0)
    spline.use_endpoint_u = True
    spline.order_u = min(4, len(pts))

    c_obj = bpy.data.objects.new(name, curve_data)
    col.objects.link(c_obj)
    c_obj.parent = root_obj
    c_obj.data.materials.append(mat)
    return c_obj


# ------------------------------------------------------------------ Procedural Worn Textures (packed into GLB!)

def make_enamel_images():
    """Generate authentic 1970s glossy burnt-orange baked-enamel textures with scratches & steel chips."""
    size = 1024
    col_img = bpy.data.images.new("enamel_color", width=size, height=size, alpha=False)
    rgh_img = bpy.data.images.new("enamel_rough", width=size, height=size, alpha=False)
    bmp_img = bpy.data.images.new("enamel_bump", width=size, height=size, alpha=False)
    rgh_img.colorspace_settings.name = "Non-Color"
    bmp_img.colorspace_settings.name = "Non-Color"

    # Build buffers as flat Python lists (RGBA) — fast & deterministic
    rng = random.Random(19780422)
    col = [0.0] * (size * size * 4)
    rgh = [0.0] * (size * size * 4)
    bmp = [0.0] * (size * size * 4)

    # 1. Base baked 1970s burnt-tangerine enamel (rich smooth vintage orange, zero periodic stripes!)
    for y in range(size):
        v = y / (size - 1)
        # Subtle natural baked-enamel depth gradient (slightly deeper at rolled rim & top neck)
        shade = 0.92 + 0.10 * math.sin(v * math.pi)
        base_r = 0.90 * shade
        base_g = 0.31 * shade
        base_b = 0.045 * shade
        row_off = y * size * 4
        for x in range(size):
            grain = (rng.random() - 0.5) * 0.022
            idx = row_off + x * 4
            col[idx] = min(1.0, max(0.0, base_r + grain))
            col[idx + 1] = min(1.0, max(0.0, base_g + grain * 0.6))
            col[idx + 2] = min(1.0, max(0.0, base_b + grain * 0.3))
            col[idx + 3] = 1.0

            # Glossy baked enamel roughness (~0.18..0.24)
            rv = 0.20 + (rng.random() - 0.5) * 0.03
            rgh[idx] = rgh[idx + 1] = rgh[idx + 2] = rv
            rgh[idx + 3] = 1.0

            # Very flat smooth steel base (scratches & chips carve subtly below 0.5)
            bv = 0.50 + (rng.random() - 0.5) * 0.012
            bmp[idx] = bmp[idx + 1] = bmp[idx + 2] = bv
            bmp[idx + 3] = 1.0

    def plot_px(px, py, cr, cg, cb, alpha, rv_val, bv_val):
        if px < 0 or px >= size or py < 0 or py >= size:
            return
        idx = (py * size + px) * 4
        inv = 1.0 - alpha
        col[idx] = col[idx] * inv + cr * alpha
        col[idx + 1] = col[idx + 1] * inv + cg * alpha
        col[idx + 2] = col[idx + 2] * inv + cb * alpha
        rgh[idx] = rgh[idx + 1] = rgh[idx + 2] = rgh[idx] * inv + rv_val * alpha
        bmp[idx] = bmp[idx + 1] = bmp[idx + 2] = bmp[idx] * inv + bv_val * alpha

    # 2. Soft handled fingerprint / scuff patches (slightly duller sheen)
    for _ in range(90):
        cx = rng.randint(0, size - 1)
        cy = rng.randint(0, size - 1)
        rad = rng.randint(18, 46)
        r2 = rad * rad
        for dy in range(-rad, rad + 1, 2):
            py = (cy + dy) % size
            for dx in range(-rad, rad + 1, 2):
                d2 = dx * dx + dy * dy
                if d2 < r2:
                    fall = (1.0 - d2 / r2) ** 2 * 0.14
                    px = (cx + dx) % size
                    idx = (py * size + px) * 4
                    rgh[idx] = rgh[idx + 1] = rgh[idx + 2] = min(0.75, rgh[idx] + fall)

    # 3. Crisp hairline surface scratches & wear streaks across the baked enamel!
    for _ in range(140):
        x0 = rng.uniform(0, size)
        y0 = rng.uniform(0, size)
        ang = rng.uniform(-math.pi, math.pi)
        length = rng.uniform(16, 95)
        curve = rng.uniform(-12, 12)
        deep = rng.random() > 0.72
        steps = int(length * 1.4)
        for s in range(steps):
            t = s / max(1, steps - 1)
            fade = math.sin(t * math.pi)
            nx = -math.sin(ang)
            ny = math.cos(ang)
            bend = math.sin(t * math.pi) * curve
            px = int((x0 + math.cos(ang) * length * t + nx * bend) % size)
            py = int(y0 + math.sin(ang) * length * t + ny * bend)
            if deep:
                # Exposed pale primer/steel core + faint dark groove
                plot_px(px, py, 0.72, 0.68, 0.64, 0.62 * fade, 0.68, 0.18)
                plot_px(px + 1, py, 0.94, 0.62, 0.42, 0.28 * fade, 0.48, 0.62)
            else:
                # Subtle clearcoat scuff (lighter sheen, rougher)
                plot_px(px, py, 0.95, 0.58, 0.36, 0.24 * fade, 0.56, 0.36)

    # 4. Tiny realistic bare-steel paint chips & dings along edges / rim
    for _ in range(75):
        cx = rng.randint(0, size - 1)
        # Concentrate chips near bottom rim & top cap, plus a few scattered dings
        rpick = rng.random()
        if rpick < 0.55:
            cy = rng.randint(0, 42)
        elif rpick < 0.80:
            cy = rng.randint(size - 48, size - 1)
        else:
            cy = rng.randint(60, size - 60)
        rx = rng.uniform(2.0, 6.5)
        ry = rng.uniform(1.5, 4.2)
        for dy in range(-int(ry) - 2, int(ry) + 3):
            for dx in range(-int(rx) - 2, int(rx) + 3):
                dist = (dx / rx) ** 2 + (dy / ry) ** 2
                px = (cx + dx) % size
                py = cy + dy
                if dist < 0.72:
                    # Bare steel metal fleck
                    plot_px(px, py, 0.62, 0.60, 0.58, 0.88, 0.42, 0.12)
                elif dist < 1.25:
                    # Dark oxidized paint chip lip
                    plot_px(px, py, 0.26, 0.08, 0.03, 0.65, 0.65, 0.32)

    col_img.pixels.foreach_set(col)
    rgh_img.pixels.foreach_set(rgh)
    bmp_img.pixels.foreach_set(bmp)
    col_img.pack()
    rgh_img.pack()
    bmp_img.pack()
    return col_img, rgh_img, bmp_img


def make_materials():
    col_img, rgh_img, bmp_img = make_enamel_images()

    # 1. Glossy 1970s scratched burnt-orange baked enamel
    m_enamel = bpy.data.materials.new("OrangeEnamel")
    m_enamel.use_nodes = True
    nt = m_enamel.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.16
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.45
        bsdf.inputs["Coat Roughness"].default_value = 0.14
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex_col = nt.nodes.new("ShaderNodeTexImage")
    tex_col.image = col_img
    nt.links.new(tex_col.outputs["Color"], bsdf.inputs["Base Color"])

    tex_rgh = nt.nodes.new("ShaderNodeTexImage")
    tex_rgh.image = rgh_img
    nt.links.new(tex_rgh.outputs["Color"], bsdf.inputs["Roughness"])

    # Clean, smooth baked enamel without bumpy artifacts (scratches & chips live in Color + Roughness!)
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.65
        bsdf.inputs["Coat Roughness"].default_value = 0.12

    def simple_mat(name, rgba, rough, metal=0.0, coat=0.0, emit=None, emit_str=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = rgba
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        if coat and "Coat Weight" in b.inputs:
            b.inputs["Coat Weight"].default_value = coat
            b.inputs["Coat Roughness"].default_value = 0.15
        if emit:
            b.inputs["Emission Color"].default_value = emit
            b.inputs["Emission Strength"].default_value = emit_str
        return m

    m_white_in = simple_mat("ShadeInterior", (0.92, 0.89, 0.82, 1.0), 0.42, 0.0, 0.0, (1.0, 0.78, 0.46, 1.0), 0.7)
    m_chrome = simple_mat("BrushedChrome", (0.82, 0.81, 0.78, 1.0), 0.20, 0.94)
    m_brass = simple_mat("NickelBrass", (0.76, 0.67, 0.48, 1.0), 0.28, 0.88)
    m_black_plastic = simple_mat("BlackMoldedPlastic", (0.045, 0.043, 0.042, 1.0), 0.36, 0.04, 0.15)
    m_black_steel = simple_mat("BlackPowderSteel", (0.04, 0.04, 0.042, 1.0), 0.56, 0.35)
    m_rubber = simple_mat("RubberCord", (0.035, 0.035, 0.036, 1.0), 0.72, 0.0)
    m_bulb = simple_mat("TungstenBulb", (1.0, 0.96, 0.88, 1.0), 0.22, 0.0, 0.0, (1.0, 0.80, 0.48, 1.0), 3.6)

    return {
        "enamel": m_enamel,
        "white_in": m_white_in,
        "chrome": m_chrome,
        "brass": m_brass,
        "plastic": m_black_plastic,
        "steel": m_black_steel,
        "rubber": m_rubber,
        "bulb": m_bulb,
    }


MATS = make_materials()


# ------------------------------------------------------------------ 1. Heavy Black Desk Clamp / Base

def build_base():
    # Folded matte-black powder-coated sheet-steel desk mount + heavy circular weighted pad
    # Weighted low-profile steel foot resting cleanly on y=0 (Z=0 in Blender)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=0.62, radius2=0.55, depth=0.14)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0.0, 0.0, 0.07))
    me = bpy.data.meshes.new("base_foot")
    bm.to_mesh(me)
    bm.free()
    foot = link_obj("base_foot", me, MATS["steel"])
    add_bevel(foot, 0.025, 3)

    # Folded L-bracket steel clamp socket (matches reference photo's crisp black clamp!)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(0.30, 0.32, 0.34))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0.02, 0.0, 0.24))
    me = bpy.data.meshes.new("base_bracket")
    bm.to_mesh(me)
    bm.free()
    br = link_obj("base_bracket", me, MATS["steel"])
    add_bevel(br, 0.022, 3)

    # Top horizontal flange lip jutting slightly forward (+X) just like the reference clamp!
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(0.46, 0.34, 0.045))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0.12, 0.0, 0.39))
    me = bpy.data.meshes.new("base_flange")
    bm.to_mesh(me)
    bm.free()
    fl = link_obj("base_flange", me, MATS["steel"])
    add_bevel(fl, 0.010, 2)


# ------------------------------------------------------------------ 2. Stamped Hollow U-Channel Orange Lower Arm

def build_lower_arm():
    """
    Faithfully builds the iconic bent sheet-metal U-channel arm from the reference photo:
    - Two side cheeks + rear spine (OPEN on the front/inner side so you see the hollow stamped steel!)
    - Leans slightly back from base (0, 0.38) up to lower bend (-0.30, 1.88)
    - Kicks sharply forward-up to upper knuckle (+0.26, 2.34) with rounded ends!
    """
    # Centerline points in X-Z plane (Blender Z is up, X is forward toward the monitor)
    p_base = Vector((0.02, 0.0, 0.39))
    p_bend = Vector((-0.36, 0.0, 2.12))
    p_top = Vector((0.26, 0.0, 2.62))

    half_w = 0.135  # half width in Y
    thick = 0.026   # stamped steel gauge thickness
    arm_depth = 0.23

    def build_u_segment(name, a, b, width_a, width_b, rounded_b=True):
        """Extrude a hollow U-channel segment from point a to b in X-Z plane."""
        d = (b - a)
        length = d.length
        dir_v = d.normalized()
        # Outward normal pointing toward rear (-X/+Z side)
        rear_n = Vector((-dir_v.z, 0.0, dir_v.x)).normalized()

        # Build U-profile cross section (open toward +front_n, closed spine on rear_n)
        bm = bmesh.new()
        steps = 8
        rings = []
        # Cross-section U points (local u along rear_n, y along Y):
        # 8 points tracing outer & inner walls of U-channel
        for s in range(steps + 1):
            t = s / steps
            center = a.lerp(b, t)
            depth_t = width_a * (1 - t) + width_b * t
            # Slight rounding pinch at the very tip if rounded_b
            hd = depth_t * 0.5
            # 8 points around U-section: front-left outer -> rear-left outer -> rear-right outer -> front-right outer
            # -> front-right inner -> rear-right inner -> rear-left inner -> front-left inner
            profile = [
                (-hd, -half_w),
                (hd, -half_w),
                (hd, half_w),
                (-hd, half_w),
                (-hd, half_w - thick),
                (hd - thick, half_w - thick),
                (hd - thick, -half_w + thick),
                (-hd, -half_w + thick),
            ]
            ring = []
            for pu, py in profile:
                pos = center + rear_n * pu + Vector((0, py, 0))
                ring.append(bm.verts.new(pos))
            rings.append(ring)

        for s in range(steps):
            r0 = rings[s]
            r1 = rings[s + 1]
            n = len(r0)
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((r0[i], r0[j], r1[j], r1[i]))

        # Cap start & end cross-sections cleanly
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            # 3 quads forming the U end-cap
            quads = [(0, 1, 6, 7), (1, 2, 5, 6), (2, 3, 4, 5)]
            for q in quads:
                vs = [ring[i] for i in (reversed(q) if flip else q)]
                bm.faces.new(vs)

        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()

        # Simple box-project UVs so the scratched enamel texture maps cleanly with zero stretching!
        uv_layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            n = poly.normal
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                if abs(n.y) > 0.5:
                    uv_layer.data[li].uv = (co.x * 0.65 + 0.5, co.z * 0.55)
                else:
                    uv_layer.data[li].uv = (co.y * 0.8 + 0.5, co.z * 0.55)

        o = link_obj(name, me, MATS["enamel"], smooth=False)
        add_bevel(o, 0.008, 2)
        return o

    build_u_segment("lower_arm_stem", p_base, p_bend, 0.25, 0.28)
    build_u_segment("lower_arm_elbow", p_bend, p_top, 0.28, 0.25)

    # Rounded stamped-steel end knuckles at the bend and upper tip (smoothly joining the two U-arms!)
    for kname, pt, rad in (("knuckle_bend", p_bend, 0.145), ("knuckle_top", p_top, 0.135)):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=rad, radius2=rad, depth=half_w * 2.02)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
        bmesh.ops.translate(bm, verts=bm.verts, vec=pt)
        me = bpy.data.meshes.new(kname)
        bm.to_mesh(me)
        bm.free()
        # Clean planar UVs
        uv_layer = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv_layer.data[li].uv = (co.x * 0.7 + 0.5, co.z * 0.7 + 0.2)
        k = link_obj(kname, me, MATS["enamel"])
        add_bevel(k, 0.012, 2)

        # Iconic recessed black molded plastic pivot caps on BOTH sides of each knuckle!
        bm2 = bmesh.new()
        bmesh.ops.create_cone(bm2, cap_ends=True, segments=24, radius1=0.072, radius2=0.064, depth=half_w * 2.32)
        bmesh.ops.rotate(bm2, verts=bm2.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
        bmesh.ops.translate(bm2, verts=bm2.verts, vec=pt)
        me2 = bpy.data.meshes.new(kname + "_cap")
        bm2.to_mesh(me2)
        bm2.free()
        cap = link_obj(kname + "_cap", me2, MATS["plastic"])
        add_bevel(cap, 0.010, 2)

    # Small black rubber strain-relief bushing poking out the rear of the upper knuckle (like photo!)
    grommet_dir = Vector((-0.82, 0.0, -0.58)).normalized()
    make_rod(
        "cord_grommet",
        p_top + grommet_dir * 0.08,
        p_top + grommet_dir * 0.26,
        0.042,
        MATS["plastic"],
        segs=18,
    )

    return p_bend, p_top


# ------------------------------------------------------------------ 3. Twin Chrome Telescoping Rods & Wing Collar

def build_rods_and_collar(p_bend, p_top):
    """
    Long graceful twin chrome steel rods reaching diagonally forward & up toward the desk
    (at the exact airy architectural angle from the reference photo!), joined ~62% out by
    the sculpted black locking collar & wing-nut thumbscrew.
    """
    # Shade swivel point in Blender coordinates (X forward, Y depth, Z up)
    # Taller reach arching cleanly ABOVE the Commodore 1702 (monitor top is z ~ 3.35) without cutting across it!
    p_shade_swivel = Vector((1.76, -0.14, 4.38))

    # Main upper telescoping chrome rod
    make_rod("rod_upper", p_top, p_shade_swivel, 0.024, MATS["chrome"], segs=24)

    # Locking collar sits ~60% along the upper rod
    p_collar = p_top.lerp(p_shade_swivel, 0.58)

    # Slender lower brace rod from bend pivot up to the locking collar (tight triangulation!)
    p_brace_start = p_bend + Vector((0.06, 0.0, 0.06))
    p_brace_end = p_collar + Vector((0.0, 0.0, -0.055))
    make_rod("rod_lower", p_brace_start, p_brace_end, 0.017, MATS["chrome"], segs=20)

    # Sculpted black locking collar housing (wraps both rods)
    rod_dir = (p_shade_swivel - p_top).normalized()
    collar_q = Vector((0, 0, 1)).rotation_difference(rod_dir)

    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=22, radius1=0.068, radius2=0.068, depth=0.17)
    me = bpy.data.meshes.new("collar_body")
    bm.to_mesh(me)
    bm.free()
    collar = link_obj("collar_body", me, MATS["plastic"])
    collar.location = p_collar + Vector((0, 0, -0.025))
    collar.rotation_mode = "QUATERNION"
    collar.rotation_quaternion = collar_q
    add_bevel(collar, 0.014, 3)

    # Sculpted ergonomic black wing-nut lever hanging beneath the locking collar (signature detail!)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(0.085, 0.16, 0.18))
    me = bpy.data.meshes.new("collar_wing")
    bm.to_mesh(me)
    bm.free()
    wing = link_obj("collar_wing", me, MATS["plastic"])
    wing.location = p_collar + Vector((0.02, 0.0, -0.135))
    wing.rotation_euler = Euler((0.0, math.radians(-26), math.radians(15)))
    add_bevel(wing, 0.018, 3)

    # Machined nickel/brass hex nut + threaded swivel ball joint at the shade neck!
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.052, radius2=0.052, depth=0.065)
    me = bpy.data.meshes.new("swivel_hexnut")
    bm.to_mesh(me)
    bm.free()
    hexnut = link_obj("swivel_hexnut", me, MATS["brass"])
    hexnut.location = p_shade_swivel - rod_dir * 0.03
    hexnut.rotation_mode = "QUATERNION"
    hexnut.rotation_quaternion = collar_q
    add_bevel(hexnut, 0.005, 2)

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=12, radius=0.044)
    me = bpy.data.meshes.new("swivel_ball")
    bm.to_mesh(me)
    bm.free()
    ball = link_obj("swivel_ball", me, MATS["brass"])
    ball.location = p_shade_swivel + rod_dir * 0.035

    return p_shade_swivel


# ------------------------------------------------------------------ 4. Iconic Spun-Steel Conical Lampshade & Bulb

def build_shade_and_bulb(p_swivel):
    """
    Builds the exact Scandinavian spun-metal conical shade from the reference photo:
    - Tall slightly tapered cylindrical socket neck (~44% of height)
    - Smooth spun-metal shoulder fillet flaring into a wide conical reflector with rolled lip
    - Real recessed/cut circular cooling vent holes in the flat top cap (1 center + 6 ring)
    - Separate matte-white reflective inner lining + frosted pear-shaped A60 tungsten bulb
    """
    shade_root = bpy.data.objects.new("shade_pivot", None)
    col.objects.link(shade_root)
    shade_root.parent = root_obj
    # Attach shade neck right onto the swivel joint, angled warmly down toward the monitor & desk!
    shade_root.location = p_swivel + Vector((0.14, -0.04, 0.12))
    shade_root.rotation_euler = Euler((math.radians(12), math.radians(-34), math.radians(-6)))

    # Lathe profile (r, z) from flat top cap (z=0) down to rolled bottom mouth (z=-1.04)
    # Proportions carefully matched to the reference photo!
    profile = [
        (0.002, 0.000),   # top cap center
        (0.185, 0.000),   # top cap edge
        (0.212, -0.022),  # crisp top shoulder fillet
        (0.222, -0.055),
        (0.258, -0.390),  # tall slightly-tapered upper cylindrical socket neck!
        (0.285, -0.455),  # smooth spun-metal flare transition
        (0.355, -0.545),
        (0.610, -0.940),  # classic straight conical flare
        (0.648, -0.995),  # subtle rolled bead rim
        (0.654, -1.018),
        (0.635, -1.032),  # tucked bottom lip
        (0.612, -1.018),
    ]

    segs = 64
    bm = bmesh.new()
    rings = []
    # Compute arc-length V for clean undistorted UV mapping of our scratched enamel!
    arc_v = [0.0]
    for i in range(1, len(profile)):
        dr = profile[i][0] - profile[i - 1][0]
        dz = profile[i][1] - profile[i - 1][1]
        arc_v.append(arc_v[-1] + math.hypot(dr, dz))
    total_v = arc_v[-1]

    for r, z in profile:
        ring = []
        for s in range(segs):
            a = (s / segs) * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)

    # Create quads winding outward
    for i in range(len(rings) - 1):
        r0 = rings[i]
        r1 = rings[i + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            bm.faces.new((r0[s], r1[s], r1[sn], r0[sn]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("shade_outer")
    bm.to_mesh(me)
    bm.free()

    # Assign clean cylindrical UVs (u around circumference, v along profile from rim=0 to cap=1)
    uv_layer = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            ang = math.atan2(co.y, co.x)
            u = (ang / math.tau) % 1.0
            # Map z from -1.032..0.0 -> 0..1 so bottom rim chips land right along the rolled lip!
            v = max(0.0, min(1.0, (co.z + 1.032) / 1.032))
            uv_layer.data[li].uv = (u, v)

    link_obj("shade_outer", me, MATS["enamel"], parent=shade_root)

    # Reflective off-white inner shade lining (tucked cleanly inside outer shell!)
    inner_profile = [
        (0.604, -1.014),
        (0.580, -0.940),
        (0.328, -0.545),
        (0.242, -0.440),
        (0.185, -0.120),
        (0.002, -0.080),
    ]
    bm = bmesh.new()
    irings = []
    for r, z in inner_profile:
        ring = []
        for s in range(segs):
            a = (s / segs) * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        irings.append(ring)
    for i in range(len(irings) - 1):
        r0 = irings[i]
        r1 = irings[i + 1]
        for s in range(segs):
            sn = (s + 1) % segs
            # Winding INWARD so normals point inside the cone!
            bm.faces.new((r0[s], r0[sn], r1[sn], r1[s]))

    me_in = bpy.data.meshes.new("shade_inner")
    bm.to_mesh(me_in)
    bm.free()
    link_obj("shade_inner", me_in, MATS["white_in"], parent=shade_root)

    # Top cap cooling vent holes (1 center + 6 outer dark recessed rings, matches photo!)
    bm = bmesh.new()
    hole_positions = [(0.0, 0.0)]
    for i in range(6):
        a = (i / 6.0) * math.tau
        hole_positions.append((math.cos(a) * 0.098, math.sin(a) * 0.098))
    for hx, hy in hole_positions:
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.025, radius2=0.025, depth=0.014)
        bmesh.ops.translate(bm, verts=ret["verts"], vec=(hx, hy, 0.001))
    me_h = bpy.data.meshes.new("shade_vents")
    bm.to_mesh(me_h)
    bm.free()
    link_obj("shade_vents", me_h, MATS["steel"], parent=shade_root)

    # Frosted pear-shaped A60 tungsten bulb tucked inside the reflector
    bulb_prof = [
        (0.002, -0.78),
        (0.075, -0.76),
        (0.148, -0.70),
        (0.172, -0.60),
        (0.155, -0.50),
        (0.095, -0.40),
        (0.068, -0.32),
    ]
    bm = bmesh.new()
    brings = []
    for r, z in bulb_prof:
        ring = []
        for s in range(28):
            a = (s / 28) * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        brings.append(ring)
    for i in range(len(brings) - 1):
        r0, r1 = brings[i], brings[i + 1]
        for s in range(28):
            sn = (s + 1) % 28
            bm.faces.new((r0[s], r0[sn], r1[sn], r1[s]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_b = bpy.data.meshes.new("bulb")
    bm.to_mesh(me_b)
    bm.free()
    link_obj("bulb", me_b, MATS["bulb"], parent=shade_root)

    # Empty markers so Three.js places the exact SpotLight origin & target inside the shade!
    lo = bpy.data.objects.new("light_origin", None)
    lo.parent = shade_root
    lo.location = (0.0, 0.0, -0.64)
    col.objects.link(lo)

    lt = bpy.data.objects.new("light_target", None)
    lt.parent = shade_root
    lt.location = (0.0, 0.0, -4.5)
    col.objects.link(lt)


# ------------------------------------------------------------------ 5. Dangling Cord & Sculpted Inline Rocker Switch

def build_cord_and_switch(p_top):
    # Cord exits strain-relief grommet at rear of upper knuckle, drops smoothly through the inline switch,
    # and trails onto the desk behind!
    grommet_out = p_top + Vector((-0.82, 0.0, -0.58)).normalized() * 0.24
    switch_pos = Vector((-0.66, -0.02, 1.56))

    # Upper cord loop (grommet -> inline switch top)
    make_tube_curve(
        "cord_upper",
        [
            grommet_out,
            grommet_out + Vector((-0.18, -0.01, -0.14)),
            Vector((-0.66, -0.02, 1.98)),
            switch_pos + Vector((0.0, 0.0, 0.16)),
        ],
        0.020,
        MATS["rubber"],
    )

    # Lower cord draping down to desk & trailing behind
    make_tube_curve(
        "cord_lower",
        [
            switch_pos + Vector((0.0, 0.0, -0.16)),
            Vector((-0.60, -0.03, 0.72)),
            Vector((-0.66, -0.06, 0.24)),
            Vector((-0.82, -0.26, 0.03)),
            Vector((-1.15, -0.95, 0.025)),
            Vector((-1.45, -2.10, 0.025)),
        ],
        0.020,
        MATS["rubber"],
    )

    # Classic European rounded-rectangle beveled inline torpedo switch housing!
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(0.145, 0.115, 0.34))
    me = bpy.data.meshes.new("switch_body")
    bm.to_mesh(me)
    bm.free()
    sw = link_obj("switch_body", me, MATS["plastic"])
    sw.location = switch_pos
    add_bevel(sw, 0.026, 4)

    # Separate named rocker toggle button so Three.js animates it rocking on click!
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(0.068, 0.055, 0.115))
    me = bpy.data.meshes.new("switch_rocker")
    bm.to_mesh(me)
    bm.free()
    rk = link_obj("switch_rocker", me, MATS["steel"])
    rk.location = switch_pos + Vector((0.0, -0.046, 0.0))
    rk.rotation_euler = Euler((math.radians(-16), 0.0, 0.0))
    add_bevel(rk, 0.010, 2)


# ------------------------------------------------------------------ Build, Preview & Export GLB

build_base()
p_bend, p_top = build_lower_arm()
p_swivel = build_rods_and_collar(p_bend, p_top)
build_shade_and_bulb(p_swivel)
build_cord_and_switch(p_top)

# Apply all modifiers cleanly before GLB export
bpy.ops.object.select_all(action="DESELECT")
for o in list(col.objects):
    if o.type == "CURVE":
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.convert(target="MESH")
        o.select_set(False)

# Export GLB (Three.js Y-up, embedded textures)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for o in col.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = root_obj

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="WEBP",
    export_image_quality=90,
)

# Save editable .blend
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

# Stats
dg = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in col.objects:
    if o.type == "MESH":
        em = o.evaluated_get(dg).to_mesh()
        em.calc_loop_triangles()
        tris += len(em.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()

print(
    f"BUILT lamp.glb: {len(col.objects)} objects, {tris} tris, {os.path.getsize(OUT_GLB) // 1024} KB"
)
