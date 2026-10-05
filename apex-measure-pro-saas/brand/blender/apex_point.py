"""
Apex Measure Pro - "The Apex Point" 3D sculpture. Parametric and deterministic.

Geometry is lifted 1:1 from brand/mark-on-dark.svg (128x128 viewBox, 1 svg unit = 0.1 Blender unit):
  left facet  (14,100) (64,20) (64,60) (40,100)
  right facet (64,20) (114,100) (88,100) (64,60)
  laser point at (64,20), dashed laser line (64,66)->(64,112) 3 on / 3 off,
  ruler along y=112, x 14..114, 8 divisions (1/8" scale).

Usage (Blender 4.x / 5.x, or `pip install bpy`):
  python apex_point.py --mode hero  --out brand/renders/hero-3d-2400x1120.png
  python apex_point.py --mode icon  --out brand/renders/icon-3d-1024.png
  python apex_point.py --mode loop  --out /tmp/loop_frames          # PNG sequence, then ffmpeg (see README)
  blender -b -P apex_point.py -- --mode hero --out hero.png
Options: --samples N  --scale F (resolution multiplier)  --frames N (loop, default 96)
"""
import sys, math, argparse
import bpy, bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--mode", default="hero", choices=["hero", "icon", "loop"])
ap.add_argument("--out", required=True)
ap.add_argument("--samples", type=int, default=0)
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--frames", type=int, default=96)
A = ap.parse_args(argv)
import os as _os
A.out = _os.path.abspath(A.out)

# ------------------------------------------------------------------ parameters
S = 0.1                      # svg unit -> blender unit
DEPTH = 1.1                  # sculpture thickness (y)
BEVEL = 0.075                # ~ "2 mm" chamfer feel
ALU = (0.93, 0.95, 0.98)     # satin aluminum
GRAPHITE = (0.045, 0.052, 0.068)
LASER = (1.0, 0.353, 0.122)  # #FF5A1F
NIGHT = (0.0033, 0.0052, 0.0080)  # linear #0B1016 -> sRGB 11,16,22 (approx linear values)
FLOOR_Z = -0.9


def srgb2lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


NIGHT = tuple(srgb2lin(v) for v in (11, 16, 22))


def P(sx, sy):
    return ((sx - 64) * S, (112 - sy) * S)


# ------------------------------------------------------------------ scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.use_denoising = True
try:
    scn.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    pass
scn.cycles.seed = 7
scn.cycles.use_animated_seed = False
scn.view_settings.view_transform = "Standard"
scn.view_settings.look = "None"
scn.render.film_transparent = False
scn.cycles.max_bounces = 8
scn.cycles.glossy_bounces = 6
scn.cycles.sample_clamp_indirect = 8.0


def mat(name, base, metal=0.0, rough=0.5, emission=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = strength
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.2
    return m


def link_obj(o):
    bpy.context.collection.objects.link(o)
    return o


def prism(name, pts, depth, material, bevel=BEVEL):
    """Extrude a convex/simple polygon (x,z svg-derived) along y, centered on y=0."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(front[::1])
    bm.faces.new(back[::-1])
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    o = link_obj(bpy.data.objects.new(name, me))
    o.data.materials.append(material)
    if bevel:
        bv = o.modifiers.new("bevel", "BEVEL")
        bv.width = bevel
        bv.segments = 3
        bv.limit_method = "ANGLE"
        bv.angle_limit = math.radians(20)
        bv.profile = 0.6
    for p in o.data.polygons:
        p.use_smooth = False
    return o


def box(name, x0, x1, y0, y1, z0, z1, material, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    bm.free()
    o = link_obj(bpy.data.objects.new(name, me))
    o.scale = (x1 - x0, y1 - y0, z1 - z0)
    o.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    o.data.materials.append(material)
    if bevel:
        bv = o.modifiers.new("bevel", "BEVEL")
        bv.width = bevel / max(o.scale)  # object scale applies after modifier -> keep small
        bv.segments = 2
    return o


# ------------------------------------------------------------------ sculpture
def hexlin(h):
    return tuple(srgb2lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))


def gradient_base(m, z_top, z_bot, c_top, c_bot):
    """Z-gradient base color, same stops as the SVG facet gradients (mL / mR)."""
    n = m.node_tree
    tcn = n.nodes.new("ShaderNodeTexCoord")
    sp = n.nodes.new("ShaderNodeSeparateXYZ")
    rp = n.nodes.new("ShaderNodeValToRGB")
    rp.color_ramp.elements[0].position = 0.0
    rp.color_ramp.elements[0].color = (*c_bot, 1)
    rp.color_ramp.elements[1].position = 1.0
    rp.color_ramp.elements[1].color = (*c_top, 1)
    mr = n.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = z_bot
    mr.inputs["From Max"].default_value = z_top
    n.links.new(tcn.outputs["Object"], sp.inputs["Vector"])
    n.links.new(sp.outputs["Z"], mr.inputs["Value"])
    n.links.new(mr.outputs["Result"], rp.inputs["Fac"])
    n.links.new(rp.outputs["Color"], n.nodes["Principled BSDF"].inputs["Base Color"])


m_alu = mat("satin_aluminum", ALU, 0.85, 0.28)
gradient_base(m_alu, 9.2, 1.2, hexlin("#FFFFFF"), hexlin("#B8C0CA"))
m_graph = mat("graphite_anodized", GRAPHITE, 0.55, 0.5)
gradient_base(m_graph, 9.2, 1.2, hexlin("#5F6B79"), hexlin("#1F2833"))
left = [P(14, 100), P(64, 20), P(64, 60), P(40, 100)]
right = [P(64, 20), P(114, 100), P(88, 100), P(64, 60)]
GAP = 0.012
left_o = prism("facet_left", [(x - (GAP if x > 0 and False else 0), z) for x, z in left], DEPTH, m_alu)
right_o = prism("facet_right", right, DEPTH, m_graph)
# keep a hairline channel between the facets (like the white highlight line in the SVG)
left_o.location.x -= 0.02
right_o.location.x += 0.02
# raise the sculpture so it floats above the ruler exactly as in the logo (svg already encodes it)

# ruler: brushed steel slab, 8 divisions, ticks engraved dark
m_steel = mat("brushed_steel", (0.62, 0.65, 0.70), 1.0, 0.34)
nt = m_steel.node_tree
tc = nt.nodes.new("ShaderNodeTexCoord")
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Scale"].default_value = (2.0, 400.0, 400.0)
nz = nt.nodes.new("ShaderNodeTexNoise")
nz.inputs["Scale"].default_value = 1.0
nz.inputs["Detail"].default_value = 6
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.12
nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])
x0, x1 = P(14, 112)[0], P(114, 112)[0]
ruler = box("ruler", x0, x1, -0.45, 0.45, FLOOR_Z, 0.0, m_steel)
bv = ruler.modifiers.new("bevel", "BEVEL")
bv.width = 0.03
bv.segments = 2
m_tick = mat("tick_ink", (0.012, 0.015, 0.02), 0.0, 0.5)
tick_len = [9, 3, 5, 3, 7, 3, 5, 3, 9]  # svg: majors at ends, mid taller (see mark)
for k in range(9):
    tx = P(14 + 12.5 * k, 112)[0]
    L = tick_len[k] * S * (0.9 / 0.9)
    box(f"tick{k}", tx - 0.022, tx + 0.022, -0.452, -0.43, -L, -0.03, m_tick)

# laser point + dashed line
m_laser = mat("laser", LASER, 0.0, 0.4, emission=LASER, strength=7.0)
m_core = mat("laser_core", (1, 0.9, 0.8), 0.0, 0.4, emission=(1.0, 0.89, 0.83), strength=14.0)
tipx, tipz = P(64, 20)


def sphere(name, loc, r, material, sx=1, sy=1, sz=1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=48, ring_count=24)
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sy, sz)
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


tip = sphere("laser_point", (tipx, -DEPTH / 2 - 0.02, tipz - 0.03), 0.17, m_laser)
sphere("laser_core", (tipx, -DEPTH / 2 - 0.03, tipz - 0.03), 0.075, m_core)
dash_mat = mat("laser_dash", (0.02, 0.005, 0.0), 0.0, 0.4, emission=LASER, strength=1.7)
sy0 = 66.0
while sy0 < 112.0:
    sy1 = min(sy0 + 3.0, 112.0)
    zA, zB = (112 - sy1) * S, (112 - sy0) * S
    bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=zB - zA, location=(0, 0, (zA + zB) / 2), vertices=16)
    d = bpy.context.active_object
    d.name = "dash"
    d.data.materials.append(dash_mat)
    sy0 += 6.0
land = sphere("laser_land", (0, 0, 0.012), 0.11, m_laser, 1, 1, 0.35)


# soft glow billboards (bloom stand-in: works identically in Eevee/Cycles, deterministic)
def glow(name, loc, size, strength, tint=LASER):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc)
    g = bpy.context.active_object
    g.name = name
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree
    for nd in list(n.nodes):
        n.nodes.remove(nd)
    out = n.nodes.new("ShaderNodeOutputMaterial")
    tcn = n.nodes.new("ShaderNodeTexCoord")
    gr = n.nodes.new("ShaderNodeTexGradient")
    gr.gradient_type = "SPHERICAL"
    mp2 = n.nodes.new("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (2, 2, 2)
    mp2.inputs["Location"].default_value = (-1, -1, 0)
    ramp = n.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    # inverse-square-ish falloff via power
    pw = n.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.6
    sep = n.nodes.new("ShaderNodeSeparateColor")
    em = n.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*tint, 1)
    tr = n.nodes.new("ShaderNodeBsdfTransparent")
    mix = n.nodes.new("ShaderNodeMixShader")
    mulv = n.nodes.new("ShaderNodeMath")
    mulv.operation = "MULTIPLY"
    mulv.inputs[1].default_value = 1.0
    n.links.new(tcn.outputs["UV"], mp2.inputs["Vector"])
    n.links.new(mp2.outputs["Vector"], gr.inputs["Vector"])
    n.links.new(gr.outputs["Fac"], pw.inputs[0])
    n.links.new(pw.outputs["Value"], mix.inputs["Fac"])
    n.links.new(tr.outputs["BSDF"], mix.inputs[1])
    n.links.new(em.outputs["Emission"], mix.inputs[2])
    em.inputs["Strength"].default_value = strength
    n.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    g.data.materials.append(m)
    g.visible_shadow = False
    g.visible_glossy = False
    g.visible_diffuse = False
    g.visible_transmission = False
    return g, em


glow_tip, em_tip = glow("glow_tip", (tipx, -DEPTH / 2 - 0.05, tipz - 0.03), 3.4, 3.0)
glow_land, em_land = glow("glow_land", (0, -0.5, 0.15), 1.9, 1.6)

# ------------------------------------------------------------------ studio
floor_mat = mat("floor", (0.008, 0.011, 0.016), 0.0, 0.38 if A.mode == "icon" else 0.16, coat=0.0 if A.mode == "icon" else 0.6)
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, FLOOR_Z - 0.001))
floor = bpy.context.active_object
floor.name = "floor"
floor.data.materials.append(floor_mat)

grid_mat = mat("grid", (0.020, 0.032, 0.048), 0.0, 0.5, emission=(0.03, 0.06, 0.10), strength=0.5)
if A.mode != "icon":
    gz = FLOOR_Z + 0.001
    for i in range(-30, 31):
        c = i * 1.0
        fade = 1.0
        box(f"gx{i}", c - 0.012, c + 0.012, -40, 40, gz, gz + 0.0005, grid_mat)
        box(f"gy{i}", -40, 40, c - 0.012, c + 0.012, gz, gz + 0.0005, grid_mat)
else:
    floor.hide_render = True
    ruler.hide_render = False

# back wall (graphite-blue gradient)
wall_mat = bpy.data.materials.new("wall")
wall_mat.use_nodes = True
wn = wall_mat.node_tree
b = wn.nodes["Principled BSDF"]
b.inputs["Roughness"].default_value = 0.9
tcw = wn.nodes.new("ShaderNodeTexCoord")
sepw = wn.nodes.new("ShaderNodeSeparateXYZ")
rw = wn.nodes.new("ShaderNodeValToRGB")
wn.links.new(tcw.outputs["Generated"], sepw.inputs["Vector"])
wn.links.new(sepw.outputs["Y"], rw.inputs["Fac"])
rw.color_ramp.elements[0].color = (*NIGHT, 1)
rw.color_ramp.elements[1].color = (0.0075, 0.0125, 0.0200, 1)
wn.links.new(rw.outputs["Color"], b.inputs["Base Color"])
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 14, 20), rotation=(math.radians(90), 0, 0))
wall = bpy.context.active_object
wall.data.materials.append(wall_mat)
if A.mode == "icon":
    wall.hide_render = True

# world: studio reflections for the metals, flat Apex Night for camera rays
w = bpy.data.worlds.new("w")
scn.world = w
w.use_nodes = True
wnt = w.node_tree
for nd in list(wnt.nodes):
    wnt.nodes.remove(nd)
wo = wnt.nodes.new("ShaderNodeOutputWorld")
bg_cam = wnt.nodes.new("ShaderNodeBackground")
bg_cam.inputs["Color"].default_value = (*NIGHT, 1)
bg_env = wnt.nodes.new("ShaderNodeBackground")
bg_env.inputs["Strength"].default_value = 1.0
lp = wnt.nodes.new("ShaderNodeLightPath")
mixw = wnt.nodes.new("ShaderNodeMixShader")
tcx = wnt.nodes.new("ShaderNodeTexCoord")
sepz = wnt.nodes.new("ShaderNodeSeparateXYZ")
ramp = wnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = (0.012, 0.017, 0.026, 1)
ramp.color_ramp.elements[1].position = 0.85
ramp.color_ramp.elements[1].color = (0.20, 0.25, 0.33, 1)
wnt.links.new(tcx.outputs["Generated"], sepz.inputs["Vector"])
wnt.links.new(sepz.outputs["Z"], ramp.inputs["Fac"])
wnt.links.new(ramp.outputs["Color"], bg_env.inputs["Color"])
wnt.links.new(lp.outputs["Is Camera Ray"], mixw.inputs["Fac"])
wnt.links.new(bg_env.outputs["Background"], mixw.inputs[1])
wnt.links.new(bg_cam.outputs["Background"], mixw.inputs[2])
wnt.links.new(mixw.outputs["Shader"], wo.inputs["Surface"])


def area(name, loc, size, energy, color, target=Vector((0, 0, 4.2)), shape="RECTANGLE", sy=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    ld.shape = shape
    ld.size = size
    if shape == "RECTANGLE":
        ld.size_y = sy or size
    o = link_obj(bpy.data.objects.new(name, ld))
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o


area("key", (-9, -12, 12), 7, 6500, (1.0, 0.97, 0.93), sy=10)           # upper-left key
area("rim", (11, 8, 7), 9, 2600, (0.45, 0.65, 1.0), sy=3)               # cool rim from back-right
area("rim2", (-12, 9, 6), 5, 1500, (0.55, 0.70, 1.0), sy=2.5)           # faint left kicker
area("top", (0, -4, 16), 8, 60, (0.85, 0.9, 1.0), sy=4)                # overhead sheen on the ruler
ptl = bpy.data.lights.new("laser_light", "POINT")
ptl.color = LASER
ptl.energy = 110
ptl.shadow_soft_size = 0.2
pl = link_obj(bpy.data.objects.new("laser_light", ptl))
pl.location = (tipx, -DEPTH / 2 - 0.5, tipz - 0.2)
ptl2 = bpy.data.lights.new("land_light", "POINT")
ptl2.color = LASER
ptl2.energy = 60
ptl2.shadow_soft_size = 0.2
pl2 = link_obj(bpy.data.objects.new("land_light", ptl2))
pl2.location = (0, -0.9, 0.5)


# ------------------------------------------------------------------ v2 polish (hero + loop only)
# depth of field, a whisper of volumetric haze that catches the rim lights, and seeded
# bokeh dust (cool + warm motes). All deterministic: same seed -> same frame.
if A.mode != "icon":
    import random
    rnd = random.Random(11)
    m_mote_c = mat("mote_cool", (0.2, 0.3, 0.45), 0.0, 0.5, emission=(0.35, 0.55, 1.0), strength=5.0)
    m_mote_w = mat("mote_warm", LASER, 0.0, 0.5, emission=LASER, strength=9.0)
    for i in range(70):
        warm = rnd.random() < 0.28
        loc = (rnd.uniform(-9, 6), rnd.uniform(-14, 5), rnd.uniform(-0.4, 11))
        r = rnd.uniform(0.012, 0.07) * (1.25 if warm else 1.0)
        o = sphere(f"mote{i}", loc, r, m_mote_w if warm else m_mote_c)
        o.visible_shadow = False
    # haze: a box volume around the set, very thin
    bpy.ops.mesh.primitive_cube_add(size=1, location=(3, -6, 5))
    haze = bpy.context.active_object
    haze.name = "haze"
    haze.scale = (40, 22, 12)
    hm = bpy.data.materials.new("haze")
    hm.use_nodes = True
    hn = hm.node_tree
    for nd in list(hn.nodes):
        hn.nodes.remove(nd)
    ho = hn.nodes.new("ShaderNodeOutputMaterial")
    hv = hn.nodes.new("ShaderNodeVolumeScatter")
    hv.inputs["Density"].default_value = 0.0022
    hv.inputs["Anisotropy"].default_value = 0.55
    hn.links.new(hv.outputs["Volume"], ho.inputs["Volume"])
    haze.data.materials.append(hm)
    haze.display_type = "WIRE"
    haze.visible_shadow = False
    scn.cycles.volume_bounces = 1
    scn.cycles.volume_step_rate = 2.0

# ------------------------------------------------------------------ camera
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 85
cam_d.sensor_width = 36
cam_d.sensor_fit = "HORIZONTAL"
cam = link_obj(bpy.data.objects.new("cam", cam_d))
scn.camera = cam
TARGET = Vector((0, 0, 4.15))

# subject-aware framing: frame_h = world height shown (vertical) at TARGET plane
if A.mode == "hero":
    W, H = 2400, 1120
    az0, el0 = -17.0, 7.5
    frame_w = 28.5
    cam_d.shift_x = 0.265
    cam_d.shift_y = -0.02
    TARGET = Vector((0, 0, 4.3))
elif A.mode == "icon":
    W, H = 1024, 1024
    az0, el0 = -14.0, 6.0
    frame_w = 17.6
    cam_d.shift_x = 0.0
    TARGET = Vector((0, 0, 4.15))
else:
    W, H = 1280, 600
    az0, el0 = -17.0, 7.5
    frame_w = 28.5
    cam_d.shift_x = 0.265
    cam_d.shift_y = -0.02
    TARGET = Vector((0, 0, 4.3))
dist = frame_w * cam_d.lens / cam_d.sensor_width


def place_camera(az, el):
    a, e = math.radians(az), math.radians(el)
    cam.location = TARGET + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (TARGET - cam.location).to_track_quat("-Z", "Y").to_euler()


def set_focus():
    if A.mode == "icon":
        return
    cam_d.dof.use_dof = True
    cam_d.dof.aperture_fstop = 2.8
    cam_d.dof.focus_distance = (TARGET - cam.location).length


def billboards():
    for g in (glow_tip, glow_land):
        g.rotation_euler = (cam.location - g.location).to_track_quat("Z", "Y").to_euler()


scn.render.resolution_x = int(W * A.scale)
scn.render.resolution_y = int(H * A.scale)
scn.render.resolution_percentage = 100
scn.cycles.samples = A.samples or (160 if A.mode != "loop" else 40)
scn.cycles.use_adaptive_sampling = True
scn.render.image_settings.file_format = "PNG"
scn.render.image_settings.color_mode = "RGB"
scn.render.image_settings.compression = 15

if A.mode == "icon":
    # fixed face-on frame; no floor/wall so the ground is exactly #0B1016
    glow_tip.scale = (1.5, 1.5, 1.5)
    em_tip.inputs["Strength"].default_value = 2.2
    place_camera(az0, el0)
    billboards()
    scn.render.filepath = A.out
    bpy.ops.render.render(write_still=True)
elif A.mode == "hero":
    place_camera(az0, el0)
    set_focus()
    billboards()
    scn.render.filepath = A.out
    bpy.ops.render.render(write_still=True)
else:
    N = A.frames
    import os
    os.makedirs(A.out, exist_ok=True)
    for f in range(N):
        t = 2 * math.pi * f / N                      # exactly one period -> seamless
        place_camera(az0 + 5.0 * math.sin(t), el0 + 1.2 * math.sin(t + math.pi / 2))
        set_focus()
        pulse = 1.0 + 0.45 * (0.5 - 0.5 * math.cos(t))
        m_laser.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 7.0 * pulse
        em_tip.inputs["Strength"].default_value = 3.0 * (0.8 + 0.45 * (0.5 - 0.5 * math.cos(t)))
        em_land.inputs["Strength"].default_value = 1.6 * (0.8 + 0.45 * (0.5 - 0.5 * math.cos(t)))
        ptl.energy = 110 * pulse
        billboards()
        scn.render.filepath = os.path.join(A.out, f"f{f:03d}.png")
        bpy.ops.render.render(write_still=True)
