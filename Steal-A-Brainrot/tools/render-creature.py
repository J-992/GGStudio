"""
Renders one 3D model to a game-ready creature sprite.

Sibling of TetherDash's tools/meshy/render.py, but this game is a faux-isometric
top-down arcade board, not a behind-the-runner runner, so three things differ:

  * The camera looks down at PITCH 24 degrees, which is roughly how the game's
    pedestals and base floors are drawn. A model rendered flat-on (pitch 0)
    looks like it is standing on a wall.
  * The framing puts the model's FEET on the bottom edge, because sprites are
    drawn with origin (0.5, 1) at the creature's ground position.
  * Shading is lit, not emission-only. The placeholders are flat vector fills
    and that is exactly the look we are replacing.

Usage:

  blender -b --factory-startup --python render-creature.py -- \
      model=<abs path>/tralalero.glb out=<abs path>/assets/creatures/tralalero.png

Find an unknown model's facing first:

  blender -b --factory-startup --python render-creature.py -- \
      model=<abs>/x.glb out=<abs>/contact/ turntable=1
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)

MODEL    = opts["model"]
OUT      = opts["out"]
W        = int(opts.get("w", 352))          # 4x the 88px logical size
H        = int(opts.get("h", 352))
PITCH    = float(opts.get("pitch", 24))     # degrees below horizontal
YAW      = float(opts.get("yaw", 0))        # 0 = camera in front of a -Y facing model
PAD      = float(opts.get("pad", 1.10))     # framing margin
FOOT     = float(opts.get("foot", 0.03))    # gap under the feet, as a fraction of frame
# Inverted-hull toon outline. Off by default: it reads beautifully on smooth
# organic models and stripes badly on stepped/voxel ones, so it is opt-in per
# model rather than a global default. Try outline=0.012 first.
OUTLINE  = float(opts.get("outline", 0))
TURNTBL  = opts.get("turntable", "")        # "1" = 8-view orientation sheet
EXPOSURE = float(opts.get("exposure", 0.0))

bpy.ops.wm.read_factory_settings(use_empty=True)

ext = os.path.splitext(MODEL)[1].lower()
if ext in (".glb", ".gltf"):
    bpy.ops.import_scene.gltf(filepath=MODEL)
elif ext == ".fbx":
    bpy.ops.import_scene.fbx(filepath=MODEL)
elif ext == ".obj":
    bpy.ops.wm.obj_import(filepath=MODEL)
else:
    raise SystemExit("unsupported model type: " + ext)

scene = bpy.context.scene

# ---- renderer ----
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = engine
        break
    except Exception:
        continue
scene.render.film_transparent = True
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filter_size = 1.5
# Filmic crushes the saturated toy palette these characters live in.
try:
    scene.view_settings.view_transform = 'Standard'
except Exception:
    pass
scene.view_settings.exposure = EXPOSURE

meshes = [o for o in scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit("no mesh in " + MODEL)

# ---- toon outline: inverted hull ----
# A solidified shell with flipped normals and a black material. Cheap, works in
# EEVEE, and it is what keeps a dark creature legible against the dark belt.
if OUTLINE > 0:
    zs = [(o.matrix_world @ Vector(c)).z for o in meshes for c in o.bound_box]
    span = max(max(zs) - min(zs), 1e-6)
    ink = bpy.data.materials.new("ink")
    ink.use_nodes = True
    nt = ink.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (0.02, 0.02, 0.04, 1)
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    # Culling the near side is the whole trick: only the far side of the
    # expanded shell survives, and it survives exactly where it pokes out past
    # the real silhouette. Without this the shell just paints the model black.
    ink.use_backface_culling = True
    for m in meshes:
        shell = m.copy()
        shell.data = m.data.copy()
        scene.collection.objects.link(shell)
        shell.data.materials.clear()
        shell.data.materials.append(ink)
        mod = shell.modifiers.new("hull", 'SOLIDIFY')
        # Complex mode keeps a constant offset on hard 90-degree edges. Simple
        # mode extrudes along vertex normals, which on a stepped/voxel mesh
        # spikes through the front faces and stripes the sprite.
        try:
            mod.solidify_mode = 'NON_MANIFOLD'
            mod.nonmanifold_thickness_mode = 'CONSTRAINTS'
        except Exception:
            pass
        mod.thickness = span * OUTLINE
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.material_offset = 0

# ---- lights: soft key / fill / rim, sitting in front of the model ----
def add_light(name, kind, loc, energy, size=6.0, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    d.color = color
    if kind == 'AREA':
        d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    scene.collection.objects.link(o)
    # aim at the origin-ish
    direction = Vector((0, 0, 0.6)) - Vector(loc)
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return o

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.60, 0.72, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.30   # ambient fill
scene.world = world


def bounds():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


lo, hi = bounds()
size = hi - lo
diag = max(size.length, 1e-6)
mid = (lo + hi) * 0.5

# Energies are tied to diag^2 because irradiance falls off with distance^2 and
# every light is placed at a multiple of diag — so a big model and a small one
# come out the same brightness. The constants are set for a 'Standard' view
# transform, which clips instead of rolling off, so they stay under 1.0.
add_light("key",  'AREA', (mid.x - diag, mid.y - diag * 1.3, mid.z + diag * 1.4), diag * diag * 55, diag * 1.6)
add_light("fill", 'AREA', (mid.x + diag * 1.4, mid.y - diag, mid.z + diag * 0.5), diag * diag * 20, diag * 2.0)
add_light("rim",  'AREA', (mid.x, mid.y + diag * 1.6, mid.z + diag * 1.5), diag * diag * 28, diag * 1.4)


def basis(pitch_deg, yaw_deg):
    """Camera forward / right / up for a given pitch+yaw."""
    p = math.radians(pitch_deg)
    y = math.radians(yaw_deg)
    fwd = Vector((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), -math.sin(p)))
    right = Vector((math.cos(y), -math.sin(y), 0.0))
    up = right.cross(fwd) * -1.0
    return fwd.normalized(), right.normalized(), up.normalized()


def frame(pitch_deg, yaw_deg):
    """Ortho box + aim point that puts the silhouette centred, feet on the floor."""
    fwd, right, up = basis(pitch_deg, yaw_deg)
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    us = [c.dot(right) for c in corners]
    vs = [c.dot(up) for c in corners]
    span_u, span_v = max(us) - min(us), max(vs) - min(vs)
    ortho = max(span_u, span_v) * PAD
    # centre horizontally; sit the bottom of the silhouette FOOT above the edge
    cu = (max(us) + min(us)) * 0.5
    cv = min(vs) + ortho * (0.5 - FOOT)
    aim = right * cu + up * cv
    # push the camera back along -forward from the aim point
    return ortho, aim - fwd * diag * 4.0, (pitch_deg, yaw_deg)


def make_camera(ortho, loc, pitch_deg, yaw_deg):
    for o in [o for o in scene.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o, do_unlink=True)
    cd = bpy.data.cameras.new("cam")
    cd.type = 'ORTHO'
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cd)
    cam.location = loc
    cam.rotation_euler = (math.radians(90 - pitch_deg), 0, math.radians(yaw_deg))
    scene.collection.objects.link(cam)
    scene.camera = cam


if TURNTBL == "1":
    os.makedirs(OUT, exist_ok=True)
    for i in range(8):
        yaw = i * 45
        ortho, loc, (p, y) = frame(PITCH, yaw)
        make_camera(ortho, loc, p, y)
        scene.render.filepath = os.path.join(OUT, "yaw%03d.png" % yaw)
        bpy.ops.render.render(write_still=True)
    print("TURNTABLE_DONE")
else:
    ortho, loc, (p, y) = frame(PITCH, YAW)
    make_camera(ortho, loc, p, y)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print("RENDER_DONE ortho=%.3f yaw=%.1f pitch=%.1f" % (ortho, YAW, PITCH))
