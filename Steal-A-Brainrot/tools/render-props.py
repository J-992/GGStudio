"""
Builds and renders the props this game owns outright -- the doge coin and the
monster horde -- straight from primitives, with no .glb to import.

render-creature.py is the sibling for the brainrot cast: those are authored
models that arrive in art/models/. The monsters and the coin have no source
model and never will, so instead of shipping flat vector placeholders for them
this script MODELS them here and renders them through the same camera, the same
lights and the same 'Standard' view transform. The output drops into
assets/sprites/ next to the character renders and reads as the same game.

Conventions kept identical to render-creature.py on purpose:

  * ortho camera, PITCH 24 degrees below horizontal, models face -Y
  * feet on the bottom edge (sprites draw with origin 0.5, 1)
  * transparent film, 'Standard' view transform, key / fill / rim area lights
  * 352px square -- 4x the 88px logical size

The coin is the one exception: it is framed centred rather than feet-down,
because it is a floating token, not something standing on the lawn.

Usage:

  blender -b --factory-startup --python tools/render-props.py -- \
      out=<abs path>/assets/sprites
  blender -b --factory-startup --python tools/render-props.py -- \
      out=<abs>/assets/sprites only=en_gloopo,dogecoin
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)

OUT = opts["out"]
ONLY = [s.strip() for s in opts.get("only", "").split(",") if s.strip()]
W = int(opts.get("w", 352))
H = int(opts.get("h", 352))
PITCH = float(opts.get("pitch", 24))
PAD = float(opts.get("pad", 1.10))
FOOT = float(opts.get("foot", 0.03))

os.makedirs(OUT, exist_ok=True)


# --------------------------------------------------------------- materials

def _set(bsdf, names, value):
    """Principled socket names moved between 3.x, 4.x and 5.x. Try them all."""
    for n in names:
        if n in bsdf.inputs:
            bsdf.inputs[n].default_value = value
            return True
    return False


def mat(name, rgb, rough=0.55, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    _set(bsdf, ["Base Color"], (rgb[0], rgb[1], rgb[2], 1.0))
    _set(bsdf, ["Roughness"], rough)
    _set(bsdf, ["Metallic"], metal)
    _set(bsdf, ["Specular IOR Level", "Specular"], 0.4)
    if emit > 0:
        _set(bsdf, ["Emission Color", "Emission"], (rgb[0], rgb[1], rgb[2], 1.0))
        _set(bsdf, ["Emission Strength"], emit)
    return m


# ---------------------------------------------------------------- premitives

def _finish(o, m, smooth=True):
    if smooth:
        bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


def ball(loc, scale, m, smooth=True, segs=32):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=loc,
                                         segments=segs, ring_count=max(8, segs // 2))
    o = bpy.context.object
    o.scale = scale
    return _finish(o, m, smooth)


def cone(loc, r1, r2, depth, m, rot=(0, 0, 0), scale=(1, 1, 1), verts=24):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth,
                                    location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.scale = scale
    return _finish(o, m)


def cyl(loc, r, depth, m, rot=(0, 0, 0), scale=(1, 1, 1), verts=32, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc,
                                        rotation=rot, vertices=verts)
    o = bpy.context.object
    o.scale = scale
    return _finish(o, m, smooth)


def box(loc, scale, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = scale
    return _finish(o, m, smooth=False)


def torus(loc, R, r, m, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r,
                                     location=loc, rotation=rot,
                                     major_segments=32, minor_segments=14)
    o = bpy.context.object
    o.scale = scale
    return _finish(o, m)


def bevel(o, amount=0.02, segments=3):
    md = o.modifiers.new("bevel", 'BEVEL')
    md.width = amount
    md.segments = segments
    md.limit_method = 'ANGLE'
    return o


# The models face -Y, so "toward the camera" is negative Y. Every eye, tooth
# and horn is placed with that in mind.
WHITE = None
INK = None


def eyes(cx, cz, y, r, m_white, m_ink, spread=None, pupil=0.5, look=(0.0, 0.0)):
    """A symmetric pair of cartoon eyeballs, pupils nudged toward the camera."""
    s = spread if spread is not None else cx
    for sx in (-s, s):
        ball((sx, y, cz), (r, r * 0.85, r), m_white)
        ball((sx + look[0] * r, y - r * 0.62, cz + look[1] * r),
             (r * pupil, r * pupil * 0.7, r * pupil), m_ink)


def eye_one(cx, cz, y, r, m_white, m_ink, pupil=0.5):
    ball((cx, y, cz), (r, r * 0.85, r), m_white)
    ball((cx, y - r * 0.62, cz), (r * pupil, r * pupil * 0.7, r * pupil), m_ink)


def teeth(y, cz, m, n=4, spread=0.30, size=0.055, down=True):
    for i in range(n):
        tx = -spread + (2 * spread) * (i / max(1, n - 1))
        cone((tx, y, cz), size, 0.0, size * 2.4, m,
             rot=(math.pi if down else 0, 0, 0))


# ------------------------------------------------------------------ monsters
# Each builder returns nothing; it just fills the empty scene. Bodies stand on
# z = 0 because the camera framing puts the lowest point on the sprite's
# bottom edge, which is where the game's origin (0.5, 1) expects the feet.

def build_gloopo():
    """Slime blob. The chaff: soft, googly, faintly revolting."""
    skin = mat("slime", (0.32, 0.78, 0.30), rough=0.22)
    dark = mat("slime_dark", (0.16, 0.48, 0.18), rough=0.30)
    m_w = mat("w", (0.97, 0.97, 0.95), rough=0.35)
    m_k = mat("k", (0.05, 0.05, 0.07), rough=0.45)

    ball((0, 0, 0.42), (0.52, 0.48, 0.44), skin)          # body puddle
    ball((0, 0, 0.72), (0.34, 0.32, 0.30), skin)          # head lump
    ball((0, -0.02, 0.06), (0.58, 0.52, 0.12), dark)      # the puddle it sits in
    # drips running down the sides
    for sx, sz in ((-0.40, 0.52), (0.44, 0.44), (0.10, 0.86)):
        ball((sx, -0.06, sz), (0.09, 0.09, 0.15), skin)
    eyes(0.16, 0.78, -0.30, 0.13, m_w, m_k, look=(0.10, -0.10))
    ball((0, -0.32, 0.60), (0.13, 0.07, 0.09), m_k)       # gawping mouth
    # stubby arms
    for sx in (-0.52, 0.52):
        ball((sx, -0.08, 0.44), (0.14, 0.14, 0.18), skin)


def build_sporeling():
    """Mushroom trooper. Reads as 'tougher than the slime' at a glance."""
    stalk = mat("stalk", (0.94, 0.90, 0.78), rough=0.62)
    cap = mat("cap", (0.82, 0.20, 0.22), rough=0.42)
    spot = mat("spot", (0.98, 0.96, 0.90), rough=0.50)
    m_w = mat("w", (0.97, 0.97, 0.95), rough=0.35)
    m_k = mat("k", (0.05, 0.05, 0.07), rough=0.45)

    cyl((0, 0, 0.40), 0.26, 0.80, stalk, scale=(1.0, 1.0, 1.0))
    ball((0, 0, 0.80), (0.28, 0.28, 0.16), stalk)          # shoulder of the stalk
    ball((0, 0, 0.98), (0.60, 0.58, 0.34), cap)            # the cap
    for sx, sy, sz, r in ((-0.30, -0.22, 1.12, 0.09), (0.26, -0.26, 1.06, 0.075),
                          (0.02, -0.34, 1.20, 0.065), (-0.42, -0.04, 0.98, 0.06)):
        ball((sx, sy, sz), (r, r, r * 0.5), spot)
    eyes(0.14, 0.56, -0.28, 0.13, m_w, m_k, look=(0.0, -0.12))
    ball((0, -0.28, 0.36), (0.10, 0.06, 0.06), m_k)        # grim little mouth
    # feet
    for sx in (-0.16, 0.16):
        ball((sx, -0.04, 0.05), (0.14, 0.18, 0.06), stalk)


def build_zippet():
    """Bat imp. Small, thin, wings out -- the fast one."""
    skin = mat("imp", (0.55, 0.33, 0.72), rough=0.45)
    wing = mat("wing", (0.34, 0.19, 0.48), rough=0.55)
    m_w = mat("w", (0.97, 0.97, 0.95), rough=0.35)
    m_k = mat("k", (0.05, 0.05, 0.07), rough=0.45)

    ball((0, 0, 0.52), (0.26, 0.24, 0.30), skin)           # body
    ball((0, -0.04, 0.82), (0.30, 0.28, 0.26), skin)       # head
    # big pointed ears
    for sx in (-1, 1):
        cone((sx * 0.26, 0.02, 1.10), 0.14, 0.0, 0.40, skin,
             rot=(0, sx * 0.45, 0), scale=(0.7, 0.35, 1.0))
    # wings: flattened cones swept back
    for sx in (-1, 1):
        cone((sx * 0.52, 0.16, 0.66), 0.34, 0.0, 0.62, wing,
             rot=(math.pi / 2, 0, sx * 0.5), scale=(1.0, 0.9, 0.16), verts=3)
    eyes(0.13, 0.86, -0.24, 0.10, m_w, m_k, look=(0.0, -0.10))
    teeth(-0.26, 0.70, m_w, n=3, spread=0.09, size=0.035)
    # skinny legs
    for sx in (-0.11, 0.11):
        cyl((sx, 0, 0.14), 0.045, 0.30, skin)
        ball((sx, -0.06, 0.03), (0.10, 0.13, 0.05), skin)


def build_crustacle():
    """Armour-plated beetle. The bucket-head: a wall that walks."""
    shell = mat("shell", (0.36, 0.40, 0.50), rough=0.30, metal=0.45)
    plate = mat("plate", (0.24, 0.27, 0.34), rough=0.35, metal=0.55)
    flesh = mat("flesh", (0.72, 0.44, 0.32), rough=0.60)
    m_w = mat("w", (0.97, 0.97, 0.95), rough=0.35)
    m_k = mat("k", (0.05, 0.05, 0.07), rough=0.45)

    ball((0, 0, 0.48), (0.52, 0.46, 0.40), flesh)          # squat body
    ball((0, 0.02, 0.60), (0.56, 0.50, 0.38), shell)       # carapace over the top
    # ridge plates down the shell
    for i, sz in enumerate((0.86, 0.74, 0.60)):
        ball((0, 0.06 + i * 0.05, sz), (0.34 - i * 0.05, 0.22, 0.09), plate)
    # brow plate the shooters have to get under -- kept high enough that the
    # eyes still read underneath it
    ball((0, -0.30, 0.82), (0.42, 0.16, 0.12), plate)
    eyes(0.19, 0.56, -0.44, 0.13, m_w, m_k, look=(0.0, -0.10))
    ball((0, -0.46, 0.36), (0.16, 0.07, 0.07), m_k)        # mandible slot
    # pincers
    for sx in (-1, 1):
        ball((sx * 0.56, -0.16, 0.40), (0.16, 0.20, 0.12), shell)
        cone((sx * 0.68, -0.30, 0.44), 0.10, 0.0, 0.26, plate,
             rot=(-math.pi / 2, 0, 0), scale=(1.0, 1.0, 0.7))
        cone((sx * 0.68, -0.30, 0.30), 0.09, 0.0, 0.24, plate,
             rot=(-math.pi / 2, 0, 0), scale=(1.0, 1.0, 0.7))
    # six little legs
    for sx in (-1, 1):
        for sy in (-0.20, 0.02, 0.24):
            cyl((sx * 0.44, sy, 0.14), 0.045, 0.30, plate,
                rot=(0, sx * 0.4, 0))
            ball((sx * 0.50, sy, 0.03), (0.07, 0.09, 0.04), plate)


def build_wispa():
    """Ghost. Floats, so it gets a tail instead of feet -- and it is the
    lightest silhouette on the lawn, which is what sells 'fast and fragile'."""
    veil = mat("veil", (0.80, 0.88, 0.98), rough=0.18, emit=0.35)
    deep = mat("deep", (0.42, 0.56, 0.82), rough=0.30)
    m_k = mat("k", (0.05, 0.05, 0.10), rough=0.45)

    ball((0, 0, 0.90), (0.40, 0.38, 0.42), veil)           # head/hood
    cone((0, 0, 0.42), 0.42, 0.10, 0.86, veil, rot=(math.pi, 0, 0))
    # ragged hem
    for i in range(5):
        a = -0.34 + i * 0.17
        ball((a, -0.04, 0.06), (0.09, 0.10, 0.07), veil)
    # hollow eye sockets: recessed dark, no eyeball
    for sx in (-0.16, 0.16):
        ball((sx, -0.30, 0.96), (0.10, 0.07, 0.13), m_k)
    ball((0, -0.30, 0.74), (0.09, 0.06, 0.11), m_k)        # wailing mouth
    # trailing wisps
    for sx, sz in ((-0.44, 0.62), (0.46, 0.54)):
        ball((sx, 0.06, sz), (0.11, 0.10, 0.16), deep)


def build_grumblor():
    """Horned brute. Wide shoulders, tusks, fists -- it should look like it
    costs you a lane if you ignore it."""
    hide = mat("hide", (0.44, 0.34, 0.52), rough=0.58)
    dark = mat("hide_dark", (0.28, 0.21, 0.36), rough=0.62)
    horn = mat("horn", (0.90, 0.86, 0.74), rough=0.42)
    m_w = mat("w", (0.97, 0.97, 0.95), rough=0.35)
    m_k = mat("k", (0.05, 0.05, 0.07), rough=0.45)

    ball((0, 0, 0.62), (0.56, 0.48, 0.46), hide)           # barrel chest
    ball((0, -0.10, 0.52), (0.40, 0.32, 0.28), dark)       # gut
    ball((0, -0.02, 1.02), (0.38, 0.36, 0.32), hide)       # head, sunk in
    # brow shelf
    ball((0, -0.24, 1.12), (0.36, 0.14, 0.11), dark)
    # horns curving up and back
    for sx in (-1, 1):
        cone((sx * 0.32, 0.04, 1.34), 0.12, 0.0, 0.46, horn,
             rot=(0.5, sx * 0.60, 0))
    eyes(0.16, 1.00, -0.40, 0.12, m_w, m_k, look=(0.0, -0.10))
    # tusks up from the jaw
    for sx in (-1, 1):
        cone((sx * 0.17, -0.34, 0.86), 0.06, 0.0, 0.26, horn, rot=(-0.25, 0, 0))
    ball((0, -0.38, 0.86), (0.17, 0.07, 0.06), m_k)        # scowl
    # arms and fists, hanging forward
    for sx in (-1, 1):
        ball((sx * 0.58, -0.04, 0.66), (0.19, 0.19, 0.26), hide)
        ball((sx * 0.60, -0.14, 0.32), (0.20, 0.20, 0.18), hide)
    # tree-trunk legs
    for sx in (-0.24, 0.24):
        cyl((sx, 0, 0.18), 0.15, 0.38, hide)
        ball((sx, -0.06, 0.05), (0.19, 0.24, 0.07), dark)


def build_cyclomunch():
    """One-eyed giant. The mini-boss silhouette: one huge eye, one huge mouth,
    and it has to read at a glance from the far end of the lane."""
    hide = mat("hide", (0.66, 0.30, 0.30), rough=0.52)
    dark = mat("hide_dark", (0.44, 0.18, 0.20), rough=0.58)
    tooth = mat("tooth", (0.95, 0.93, 0.86), rough=0.38)
    m_w = mat("w", (0.98, 0.98, 0.96), rough=0.28)
    m_k = mat("k", (0.04, 0.04, 0.06), rough=0.40)

    ball((0, 0, 0.78), (0.62, 0.54, 0.66), hide)           # one big body-head
    ball((0, -0.14, 0.56), (0.48, 0.40, 0.34), dark)       # belly
    # the eye, front and centre
    ball((0, -0.40, 1.00), (0.30, 0.22, 0.30), m_w)
    ball((0, -0.56, 0.98), (0.15, 0.11, 0.15), m_k)
    ball((-0.06, -0.62, 1.06), (0.05, 0.04, 0.05), m_w)    # catchlight
    # brow
    ball((0, -0.40, 1.26), (0.32, 0.14, 0.09), dark)
    # gaping mouth with teeth
    ball((0, -0.44, 0.56), (0.30, 0.14, 0.16), m_k)
    teeth(-0.54, 0.66, tooth, n=5, spread=0.22, size=0.05)
    teeth(-0.54, 0.46, tooth, n=4, spread=0.18, size=0.045, down=False)
    # arms
    for sx in (-1, 1):
        ball((sx * 0.64, -0.06, 0.72), (0.20, 0.20, 0.30), hide)
        ball((sx * 0.66, -0.18, 0.38), (0.22, 0.22, 0.20), hide)
    # stubby legs
    for sx in (-0.26, 0.26):
        cyl((sx, 0, 0.16), 0.17, 0.34, hide)
        ball((sx, -0.08, 0.05), (0.21, 0.26, 0.07), dark)


def build_slimeking():
    """The boss: everything the grunt is, four times over, wearing a crown."""
    skin = mat("king", (0.30, 0.72, 0.42), rough=0.20)
    dark = mat("king_dark", (0.15, 0.44, 0.24), rough=0.30)
    gold = mat("crown", (0.98, 0.76, 0.18), rough=0.18, metal=0.9)
    gem = mat("gem", (0.90, 0.16, 0.30), rough=0.10)
    m_w = mat("w", (0.98, 0.98, 0.96), rough=0.30)
    m_k = mat("k", (0.04, 0.04, 0.06), rough=0.42)

    ball((0, 0, 0.60), (0.78, 0.70, 0.62), skin)           # vast body
    ball((0, 0, 1.02), (0.52, 0.48, 0.44), skin)           # head lobe
    ball((0, -0.02, 0.08), (0.88, 0.78, 0.16), dark)       # spreading base
    # drips
    for sx, sz in ((-0.62, 0.70), (0.66, 0.62), (-0.20, 1.28), (0.30, 1.30)):
        ball((sx, -0.06, sz), (0.12, 0.12, 0.20), skin)
    # crown: band plus points
    cyl((0, 0, 1.44), 0.40, 0.14, gold)
    for i in range(6):
        a = i * math.pi / 3
        cone((math.sin(a) * 0.36, math.cos(a) * 0.36, 1.60), 0.09, 0.0, 0.26, gold)
    ball((0, -0.38, 1.46), (0.08, 0.06, 0.08), gem)
    eyes(0.23, 1.08, -0.46, 0.19, m_w, m_k, look=(0.0, -0.10))
    # brows: the angry boss read, angled down toward the middle
    for sx in (-1, 1):
        box((sx * 0.24, -0.56, 1.30), (0.26, 0.07, 0.08), dark,
            rot=(0, sx * 0.35, 0))
    ball((0, -0.52, 0.84), (0.26, 0.11, 0.14), m_k)        # roaring mouth
    teeth(-0.60, 0.93, m_w, n=5, spread=0.18, size=0.055)
    # arms
    for sx in (-1, 1):
        ball((sx * 0.80, -0.04, 0.62), (0.22, 0.22, 0.30), skin)
        ball((sx * 0.84, -0.16, 0.30), (0.24, 0.24, 0.22), skin)


# ---------------------------------------------------------------- the coin

def build_dogecoin():
    """A struck gold coin with a shiba in relief.

    The face is COLOURED, not gold-on-gold: this token is drawn at roughly 50px
    on a phone, and a same-metal relief turns to mush at that size. Tan head,
    cream muzzle, dark eyes -- it survives the downscale, which is the only
    test that matters for a currency icon.
    """
    # Metallic 1.0 gold goes olive under a dim world: a metal surface is
    # almost entirely reflection, and there is nothing here to reflect. Half
    # metal keeps the specular kick while the base colour still carries.
    gold = mat("gold", (0.97, 0.72, 0.11), rough=0.26, metal=0.50)
    gold_d = mat("gold_dark", (0.74, 0.50, 0.06), rough=0.32, metal=0.45)
    # The shiba has to hold its own against the gold field it sits on, so it
    # is a saturated fox-tan, not the washed-out cream a real shiba would be.
    tan = mat("tan", (0.88, 0.44, 0.12), rough=0.48)
    cream = mat("cream", (0.99, 0.90, 0.74), rough=0.50)
    ink = mat("ink", (0.16, 0.10, 0.06), rough=0.40)
    nose = mat("nose", (0.12, 0.08, 0.06), rough=0.30)

    # The blank, lying in the XZ plane, face toward -Y.
    blank = cyl((0, 0, 0), 1.00, 0.20, gold, rot=(math.pi / 2, 0, 0), verts=64)
    bevel(blank, amount=0.05, segments=4)
    # raised rim ring, sitting on the front face rather than inside the blank
    torus((0, -0.09, 0), 0.88, 0.045, gold_d, rot=(math.pi / 2, 0, 0))
    # milled edge: fine and shallow, or it reads as a cog instead of a coin
    for i in range(72):
        a = i * math.pi * 2 / 72
        box((math.sin(a) * 1.01, 0, math.cos(a) * 1.01), (0.028, 0.20, 0.028), gold_d,
            rot=(0, -a, 0))

    Y = -0.12          # relief sits proud of the face
    # a shallow darker medallion under the head: relief alone is too soft an
    # edge to separate tan from gold once this is 50px on a phone
    cyl((0, -0.095, -0.02), 0.70, 0.03, gold_d, rot=(math.pi / 2, 0, 0), verts=48)
    # head
    ball((0, Y, 0.02), (0.50, 0.16, 0.48), tan)
    # ears
    for sx in (-1, 1):
        cone((sx * 0.34, Y + 0.02, 0.50), 0.19, 0.0, 0.34, tan,
             rot=(0, sx * 0.30, 0), scale=(1.0, 0.5, 1.0))
        cone((sx * 0.33, Y - 0.05, 0.46), 0.10, 0.0, 0.20, ink,
             rot=(0, sx * 0.30, 0), scale=(1.0, 0.4, 1.0))
    # cheek fluff, the bit that makes it a shiba and not a bear
    for sx in (-1, 1):
        ball((sx * 0.44, Y + 0.01, -0.06), (0.16, 0.12, 0.20), tan)
    # muzzle + brow markings in cream
    ball((0, Y - 0.06, -0.16), (0.28, 0.12, 0.20), cream)
    for sx in (-1, 1):
        ball((sx * 0.20, Y - 0.04, 0.20), (0.11, 0.09, 0.07), cream)
    # eyes, nose, and the smug little mouth
    for sx in (-1, 1):
        ball((sx * 0.20, Y - 0.10, 0.08), (0.075, 0.06, 0.085), ink)
    ball((0, Y - 0.14, -0.08), (0.09, 0.07, 0.06), nose)
    ball((0, Y - 0.12, -0.22), (0.13, 0.06, 0.035), ink)


PROPS = {
    'en_gloopo':     (build_gloopo,     'ground'),
    'en_sporeling':  (build_sporeling,  'ground'),
    'en_zippet':     (build_zippet,     'ground'),
    'en_crustacle':  (build_crustacle,  'ground'),
    'en_wispa':      (build_wispa,      'ground'),
    'en_grumblor':   (build_grumblor,   'ground'),
    'en_cyclomunch': (build_cyclomunch, 'ground'),
    'en_slimeking':  (build_slimeking,  'ground'),
    'dogecoin':      (build_dogecoin,   'centre'),
}


# ------------------------------------------------------------- render rig

def basis(pitch_deg, yaw_deg):
    p = math.radians(pitch_deg)
    y = math.radians(yaw_deg)
    fwd = Vector((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), -math.sin(p)))
    right = Vector((math.cos(y), -math.sin(y), 0.0))
    up = right.cross(fwd) * -1.0
    return fwd.normalized(), right.normalized(), up.normalized()


def bounds(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def add_light(scene, name, loc, energy, size, aim=Vector((0, 0, 0.6))):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    scene.collection.objects.link(o)
    o.rotation_euler = (aim - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def render(key, build, mode):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

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
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.60, 0.72, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.30 if mode != 'centre' else 0.60
    scene.world = world

    build()

    meshes = [o for o in scene.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit("nothing built for " + key)

    lo, hi = bounds(meshes)
    diag = max((hi - lo).length, 1e-6)
    mid = (lo + hi) * 0.5

    add_light(scene, "key", (mid.x - diag, mid.y - diag * 1.3, mid.z + diag * 1.4),
              diag * diag * 55, diag * 1.6, aim=mid)
    add_light(scene, "fill", (mid.x + diag * 1.4, mid.y - diag, mid.z + diag * 0.5),
              diag * diag * 20, diag * 2.0, aim=mid)
    add_light(scene, "rim", (mid.x, mid.y + diag * 1.6, mid.z + diag * 1.5),
              diag * diag * 28, diag * 1.4, aim=mid)

    # A coin is a token in the air, so it gets a gentler pitch than a monster
    # standing on the lawn -- just enough tilt to show its thickness.
    pitch = 10.0 if mode == 'centre' else PITCH
    fwd, right, up = basis(pitch, 0.0)
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    us = [c.dot(right) for c in corners]
    vs = [c.dot(up) for c in corners]
    ortho = max(max(us) - min(us), max(vs) - min(vs)) * PAD
    cu = (max(us) + min(us)) * 0.5
    cv = ((max(vs) + min(vs)) * 0.5 if mode == 'centre'
          else min(vs) + ortho * (0.5 - FOOT))
    aim = right * cu + up * cv

    cd = bpy.data.cameras.new("cam")
    cd.type = 'ORTHO'
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cd)
    cam.location = aim - fwd * diag * 4.0
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.filepath = os.path.join(OUT, key + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote " + scene.render.filepath)


for key, (build, mode) in PROPS.items():
    if ONLY and key not in ONLY:
        continue
    render(key, build, mode)
