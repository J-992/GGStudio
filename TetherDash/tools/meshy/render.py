"""
Renders a Meshy character to game-ready sprites.

The camera is not a taste call: Tether Dash's camera is a pinhole looking
along +z from CAM_HEIGHT 4.4 up and CAM_BACK 8.5 back, so the sightline to a
runner is depressed atan(4.4/8.5) = 27.4 degrees. We match that, orthographic
so there is no perspective the game's own projection would disagree with.

Shading is deliberately flat: the game's world is drawn from solid fills, so a
PBR-lit render would sit in it like a photograph in a cartoon. Base colour is
piped straight to emission.
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:]
opts = dict(a.split("=", 1) for a in argv)

FBX      = opts["fbx"]
OUT      = opts["out"]
W        = int(opts.get("w", 192))
H        = int(opts.get("h", 232))
PITCH    = float(opts.get("pitch", 27.4))     # degrees below horizontal
YAW      = float(opts.get("yaw", 0))          # 0 = camera behind the character
FRAMES   = opts.get("frames", "")             # "" = single still
CONTACT  = opts.get("contact", "")            # "1" = 8-view orientation sheet
MARGIN   = float(opts.get("margin", 1.02))
SCALE    = tuple(float(x) for x in opts.get("scale", "1,1,1").split(","))
ORTHO    = float(opts.get("ortho", 0))        # >0 forces the camera box
TZ       = float(opts.get("tz", 0))           # world Z the camera aims at

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FBX)

scene = bpy.context.scene

# ---- renderer: EEVEE with a transparent film ----
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
scene.render.filter_size = 1.2          # slight AA, keeps small sprites crisp
if hasattr(scene.render, "use_high_quality_normals"):
    scene.render.use_high_quality_normals = True

# ---- flat shading: base colour -> emission ----
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    nt = mat.node_tree
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image
                and 'basecolor' in n.image.name.lower()), None)
    if not (out and tex):
        continue
    tex.interpolation = 'Closest'       # the atlas is flat colour; no blurring
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.location = (out.location.x - 200, out.location.y)
    nt.links.new(tex.outputs['Color'], emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])

meshes = [o for o in scene.objects if o.type == 'MESH']
arms   = [o for o in scene.objects if o.type == 'ARMATURE']
root   = arms[0] if arms else meshes[0]

# Bea is the same rig reproportioned: shorter and wider, so the pair still
# reads as two different characters at 100px. Scaling the top-level parent
# takes the skinned mesh with it.
if SCALE != (1.0, 1.0, 1.0):
    # Object scale on a skinned mesh is cancelled by the armature deform, so
    # the reproportion goes on an empty that everything hangs off instead.
    empty = bpy.data.objects.new("scaler", None)
    scene.collection.objects.link(empty)
    for o in list(scene.objects):
        if o.parent is None and o is not empty:
            o.parent = empty
    empty.scale = SCALE
    bpy.context.view_layer.update()

def bounds(frame=None):
    """World-space bbox of the evaluated (posed) mesh."""
    if frame is not None:
        scene.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

def make_camera(target, ortho_scale, pitch, yaw):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    p = math.radians(pitch)
    y = math.radians(yaw)
    dist = 10.0
    # yaw 0 puts the camera on -Y looking toward +Y
    d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = target + d * dist
    cam.rotation_euler = (math.radians(90) - p, 0, y)
    return cam

# ---- lights: none needed (emission), but a dim world stops pure black ----
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
scene.world = world

if CONTACT == "1":
    # Eight yaws around the character, tiled by the caller.
    lo, hi = bounds(scene.frame_start)
    target = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, (lo.z+hi.z)/2))
    height = hi.z - lo.z
    os.makedirs(OUT, exist_ok=True)
    for i in range(8):
        yaw = i * 45
        for o in list(scene.objects):
            if o.type == 'CAMERA':
                bpy.data.objects.remove(o, do_unlink=True)
        make_camera(target, height * MARGIN, PITCH, yaw)
        scene.render.filepath = os.path.join(OUT, f"yaw{yaw:03d}.png")
        bpy.ops.render.render(write_still=True)
    print("CONTACT_DONE")
else:
    if FRAMES:
        first, last = (int(x) for x in FRAMES.split("-"))
        frame_list = list(range(first, last + 1))
    else:
        frame_list = [scene.frame_start]

    # One camera framing for every frame: the sprite must not swim as the
    # walk cycle changes the silhouette's bounding box.
    lo = Vector(( 1e9,  1e9,  1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for f in frame_list:
        l, h = bounds(f)
        lo = Vector((min(lo.x,l.x), min(lo.y,l.y), min(lo.z,l.z)))
        hi = Vector((max(hi.x,h.x), max(hi.y,h.y), max(hi.z,h.z)))
    target = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, (lo.z+hi.z)/2))

    # A forced camera box is what keeps two characters comparable: same
    # pixels per world unit and the same ground line, so the game can scale
    # both sprites by one constant and have the short one come out short.
    if ORTHO > 0:
        ortho = ORTHO
        target = Vector((0.0, 0.0, TZ))
    else:
        span_v = (hi.z - lo.z)
        span_h = max(hi.x - lo.x, hi.y - lo.y)
        ortho = max(span_v, span_h * H / W) * MARGIN

    make_camera(target, ortho, PITCH, YAW)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    for f in frame_list:
        scene.frame_set(f)
        scene.render.filepath = OUT if len(frame_list) == 1 else f"{OUT}{f:03d}"
        bpy.ops.render.render(write_still=True)
    print(f"RENDER_DONE frames={len(frame_list)} ortho={ortho:.3f} target={tuple(round(v,3) for v in target)}")
