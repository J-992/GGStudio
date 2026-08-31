"""Build NINJA FLOW's original enemy cast as web-ready rigged GLBs.

The models are intentionally generated from primitives rather than downloaded:
the source of every silhouette, material, joint, and weapon socket lives here.
All variants share the same compact humanoid skeleton and explicit WeaponGripR
socket, so the runtime can attach the full armoury without per-model offsets.

Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-enemies.py
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "enemies"

PARTS: list[bpy.types.Object] = []
MATERIALS: dict[str, bpy.types.Material] = {}


PALETTES = {
    "ronin": {
        "cloth": (0.20, 0.018, 0.025, 1),
        "cloth2": (0.045, 0.052, 0.07, 1),
        "armor": (0.075, 0.085, 0.11, 1),
        "metal": (0.34, 0.38, 0.44, 1),
        "accent": (0.78, 0.09, 0.06, 1),
        "skin": (0.30, 0.18, 0.12, 1),
        "eye": (1.0, 0.12, 0.025, 1),
    },
    "oni": {
        "cloth": (0.055, 0.07, 0.11, 1),
        "cloth2": (0.16, 0.025, 0.035, 1),
        "armor": (0.18, 0.20, 0.23, 1),
        "metal": (0.46, 0.27, 0.09, 1),
        "accent": (0.72, 0.13, 0.055, 1),
        "skin": (0.18, 0.28, 0.34, 1),
        "eye": (1.0, 0.28, 0.015, 1),
    },
    "tengu": {
        "cloth": (0.055, 0.05, 0.065, 1),
        "cloth2": (0.25, 0.035, 0.025, 1),
        "armor": (0.10, 0.09, 0.095, 1),
        "metal": (0.38, 0.33, 0.27, 1),
        "accent": (0.68, 0.045, 0.03, 1),
        "skin": (0.24, 0.20, 0.18, 1),
        "eye": (0.95, 0.08, 0.015, 1),
    },
}


def clear_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for block in list(datablocks):
            datablocks.remove(block)
    PARTS.clear()
    MATERIALS.clear()


def material(role: str, color: tuple[float, float, float, float], *, metal=0.0, rough=0.72, emission=0.0):
    name = f"Enemy_{role.capitalize()}"
    if name in MATERIALS:
        return MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = color if emission > 0 else (0, 0, 0, 1)
        if strength_input:
            strength_input.default_value = emission
    MATERIALS[name] = mat
    return mat


def apply_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def finish(obj: bpy.types.Object, bone: str, mat: bpy.types.Material, name: str) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.data.materials.append(mat)
    apply_transform(obj)
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    PARTS.append(obj)
    return obj


def ellipsoid(name, location, scale, bone, mat, subdivisions=1, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.scale = scale
    return finish(obj, bone, mat, name)


def box(name, location, scale, bone, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = scale
    bevel = obj.modifiers.new("Small forged bevel", "BEVEL")
    bevel.width = min(scale) * 0.18
    bevel.segments = 1
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return finish(obj, bone, mat, name)


def cylinder_between(name, start, end, radius, bone, mat, vertices=8, radius2=None):
    a, b = Vector(start), Vector(end)
    direction = b - a
    midpoint = (a + b) * 0.5
    if radius2 is None or abs(radius2 - radius) < 1e-5:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=midpoint)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius2, depth=direction.length, location=midpoint)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    return finish(obj, bone, mat, name)


def cone_between(name, start, end, radius, bone, mat, vertices=8):
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius,
        radius2=0,
        depth=direction.length,
        location=(a + b) * 0.5,
    )
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    return finish(obj, bone, mat, name)


def torus(name, location, major, minor, bone, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=10,
        minor_segments=4,
        location=location,
        rotation=rotation,
    )
    return finish(bpy.context.object, bone, mat, name)


def create_rig(variant: str) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"{variant.title()}EnemyRig")
    rig = bpy.data.objects.new(f"{variant.title()}EnemyRig", data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones: dict[str, bpy.types.EditBone] = {}

    def add(name, head, tail, parent=None, connected=False):
        bone = data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.roll = 0
        if parent:
            bone.parent = bones[parent]
            bone.use_connect = connected
        bones[name] = bone

    add("Hips", (0, 0, 0.70), (0, 0, 0.84))
    add("Spine", (0, 0, 0.84), (0, 0, 0.96), "Hips", True)
    add("Spine01", (0, 0, 0.96), (0, 0, 1.09), "Spine", True)
    add("Spine02", (0, 0, 1.09), (0, 0, 1.22), "Spine01", True)
    add("neck", (0, 0, 1.22), (0, 0, 1.31), "Spine02", True)
    add("Head", (0, 0, 1.31), (0, 0, 1.56), "neck", True)

    for side, sign in (("Left", 1), ("Right", -1)):
        add(f"{side}Shoulder", (0, 0, 1.18), (0.18 * sign, 0, 1.17), "Spine02")
        add(f"{side}Arm", (0.18 * sign, 0, 1.17), (0.39 * sign, 0, 1.02), f"{side}Shoulder", True)
        add(f"{side}ForeArm", (0.39 * sign, 0, 1.02), (0.55 * sign, 0, 0.82), f"{side}Arm", True)
        add(f"{side}Hand", (0.55 * sign, 0, 0.82), (0.62 * sign, -0.01, 0.75), f"{side}ForeArm", True)
        add(f"{side}UpLeg", (0.13 * sign, 0, 0.72), (0.15 * sign, 0, 0.40), "Hips")
        add(f"{side}Leg", (0.15 * sign, 0, 0.40), (0.14 * sign, 0, 0.14), f"{side}UpLeg", True)
        add(f"{side}Foot", (0.14 * sign, 0, 0.14), (0.14 * sign, -0.13, 0.07), f"{side}Leg", True)
        add(f"{side}ToeBase", (0.14 * sign, -0.13, 0.07), (0.14 * sign, -0.27, 0.06), f"{side}Foot", True)

    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    rig["enemy_variant"] = variant
    rig["weapon_units"] = "metres"
    return rig


def common_body(variant: str, rig: bpy.types.Object) -> None:
    p = PALETTES[variant]
    cloth = material("cloth", p["cloth"], rough=0.9)
    cloth2 = material("cloth_secondary", p["cloth2"], rough=0.88)
    armor = material("armor", p["armor"], metal=0.52, rough=0.34)
    metal = material("metal", p["metal"], metal=0.82, rough=0.24)
    accent = material("accent", p["accent"], metal=0.24, rough=0.4)
    skin = material("skin", p["skin"], rough=0.78)
    eye = material("eyes", p["eye"], rough=0.2, emission=2.4)

    broad = 1.16 if variant == "oni" else 1.0
    lean = 0.90 if variant == "tengu" else 1.0

    # Layered torso and split battle skirt: clear silhouettes at game distance.
    cylinder_between("Torso", (-0.0, 0, 0.78), (0, 0, 1.17), 0.22 * broad * lean, "Spine01", cloth, 10, 0.29 * broad * lean)
    box("ChestPlate", (0, -0.115, 1.08), (0.26 * broad, 0.055, 0.19), "Spine02", armor)
    box("ChestSlash", (0, -0.177, 1.08), (0.19 * broad, 0.018, 0.025), "Spine02", accent, rotation=(0, 0.42, 0.22))
    cylinder_between("Waist", (0, 0, 0.72), (0, 0, 0.86), 0.24 * broad, "Hips", cloth2, 10, 0.19 * broad)
    torus("Obi", (0, 0, 0.78), 0.23 * broad, 0.035, "Hips", accent)
    for sign in (-1, 1):
        box(f"Skirt_{sign}", (0.12 * sign, 0, 0.59), (0.14 * broad, 0.16, 0.26), "Hips", cloth, rotation=(0, sign * 0.08, sign * 0.08))

    # Articulated limbs are rigidly weighted to named bones. This deliberately
    # preserves a crisp low-poly style while remaining fully poseable.
    for side, sign in (("Left", 1), ("Right", -1)):
        cylinder_between(f"{side}UpperArm", (0.19 * sign, 0, 1.16), (0.39 * sign, 0, 1.02), 0.075 * broad, f"{side}Arm", cloth2, 8, 0.09 * broad)
        cylinder_between(f"{side}ForeArm", (0.39 * sign, 0, 1.02), (0.55 * sign, 0, 0.82), 0.070 * broad, f"{side}ForeArm", armor, 8, 0.085 * broad)
        gripping_hand(side, sign, skin)
        torus(f"{side}WristGuard", (0.515 * sign, 0, 0.865), 0.085, 0.022, f"{side}ForeArm", metal, rotation=(0, math.pi / 2, 0))
        ellipsoid(f"{side}Pauldron", (0.22 * sign, 0.0, 1.17), (0.17 * broad, 0.12, 0.11), f"{side}Arm", armor)

        cylinder_between(f"{side}Thigh", (0.13 * sign, 0, 0.70), (0.15 * sign, 0, 0.40), 0.095 * broad, f"{side}UpLeg", cloth2, 8, 0.115 * broad)
        cylinder_between(f"{side}Shin", (0.15 * sign, 0, 0.40), (0.14 * sign, 0, 0.14), 0.078 * broad, f"{side}Leg", armor, 8, 0.10 * broad)
        box(f"{side}Boot", (0.14 * sign, -0.075, 0.09), (0.10 * broad, 0.18, 0.085), f"{side}Foot", cloth2)
        box(f"{side}ShinPlate", (0.15 * sign, -0.075, 0.31), (0.085 * broad, 0.035, 0.13), f"{side}Leg", metal)

    # A layered face reads at gameplay distance: recessed sockets and slanted
    # eye slits under separate brows, cheek planes around a shaped lower mask,
    # and a central nose ridge. This preserves the low-poly language without
    # reducing every variant to a sphere with two glowing dots.
    ellipsoid("Head", (0, 0, 1.42), (0.235 * broad, 0.205, 0.24), "Head", skin, subdivisions=2)
    ellipsoid("Jaw", (0, -0.025, 1.345), (0.19 * broad, 0.19, 0.12), "Head", skin)
    box("FaceMask", (0, -0.195, 1.39), (0.25 * broad, 0.045, 0.145), "Head", armor)
    for sign in (-1, 1):
        ellipsoid(f"EyeSocket_{sign}", (0.082 * sign, -0.215, 1.475), (0.10, 0.025, 0.055), "Head", cloth2)
        ellipsoid(
            f"Eye_{sign}",
            (0.082 * sign, -0.239, 1.472),
            (0.055, 0.014, 0.014),
            "Head",
            eye,
            rotation=(0, 0.22 * sign, 0),
        )
        box(
            f"BrowPlate_{sign}",
            (0.085 * sign, -0.232, 1.522),
            (0.105, 0.025, 0.032),
            "Head",
            metal,
            rotation=(0, 0.20 * sign, 0),
        )
        ellipsoid(f"CheekGuard_{sign}", (0.115 * sign, -0.225, 1.39), (0.095, 0.025, 0.075), "Head", armor)
    box("MaskNoseRidge", (0, -0.242, 1.425), (0.045, 0.034, 0.15), "Head", metal)


def gripping_hand(side: str, sign: int, skin: bpy.types.Material) -> None:
    """Builds a palm, curled fingers and thumb around the vertical grip axis."""
    x = 0.55 * sign
    bone = f"{side}Hand"
    ellipsoid(f"{side}Palm", (x, 0.018, 0.82), (0.105, 0.082, 0.10), bone, skin, subdivisions=2)
    # Three front knuckles visibly overlap a 3–5 cm handle at the socket.
    for index, z in enumerate((0.775, 0.82, 0.865)):
        ellipsoid(
            f"{side}GripFinger_{index}",
            (x, -0.058, z),
            (0.075, 0.043, 0.025),
            bone,
            skin,
        )
    # The thumb crosses from the body's side of the fist toward the handle.
    ellipsoid(
        f"{side}GripThumb",
        (x - sign * 0.062, -0.045, 0.835),
        (0.034, 0.044, 0.072),
        bone,
        skin,
        rotation=(0, sign * 0.42, sign * 0.18),
    )


def ronin_details() -> None:
    armor = MATERIALS["Enemy_Armor"]
    metal = MATERIALS["Enemy_Metal"]
    accent = MATERIALS["Enemy_Accent"]
    cloth = MATERIALS["Enemy_Cloth_secondary"]
    # Broken crescent kabuto and asymmetric shoulder armour.
    for sign in (-1, 1):
        cone_between(f"RoninHorn_{sign}", (0.11 * sign, 0, 1.57), (0.23 * sign, 0, 1.76 if sign > 0 else 1.69), 0.042, "Head", metal, 7)
    box("RoninBrow", (0, -0.205, 1.51), (0.22, 0.035, 0.035), "Head", accent)
    ellipsoid("RoninShoulder", (-0.24, 0, 1.19), (0.22, 0.15, 0.13), "RightArm", armor)
    # Ragged back banners read in motion without simulating cloth.
    for sign in (-1, 1):
        box(f"RoninBanner_{sign}", (0.11 * sign, 0.12, 0.96), (0.06, 0.025, 0.30), "Spine02", cloth, rotation=(0.08 * sign, 0, 0.10 * sign))


def oni_details() -> None:
    armor = MATERIALS["Enemy_Armor"]
    metal = MATERIALS["Enemy_Metal"]
    accent = MATERIALS["Enemy_Accent"]
    skin = MATERIALS["Enemy_Skin"]
    # A heavy jaw, paired horns, tusks, and studded cuirass.
    box("OniJaw", (0, -0.19, 1.34), (0.20, 0.055, 0.09), "Head", skin)
    for sign in (-1, 1):
        cone_between(f"OniHorn_{sign}", (0.12 * sign, 0, 1.58), (0.27 * sign, 0.015, 1.80), 0.065, "Head", metal, 8)
        cone_between(f"OniTusk_{sign}", (0.10 * sign, -0.23, 1.35), (0.12 * sign, -0.26, 1.47), 0.025, "Head", metal, 6)
        ellipsoid(f"OniKnot_{sign}", (0.19 * sign, -0.13, 0.79), (0.07, 0.07, 0.07), "Hips", accent)
    for x in (-0.13, 0, 0.13):
        ellipsoid(f"OniStud_{x}", (x, -0.176, 1.10), (0.025, 0.018, 0.025), "Spine02", metal)
    torus("OniRope", (0, 0, 0.82), 0.29, 0.055, "Hips", accent)


def tengu_details() -> None:
    armor = MATERIALS["Enemy_Armor"]
    metal = MATERIALS["Enemy_Metal"]
    accent = MATERIALS["Enemy_Accent"]
    cloth = MATERIALS["Enemy_Cloth_secondary"]
    # Long beaked war mask, swept brow, and layered feather mantle.
    cone_between("TenguBeak", (0, -0.20, 1.43), (0, -0.48, 1.39), 0.10, "Head", accent, 8)
    box("TenguBrow", (0, -0.207, 1.51), (0.20, 0.03, 0.03), "Head", metal, rotation=(0, 0, 0.08))
    for side, sign in (("Left", 1), ("Right", -1)):
        for i in range(3):
            start = (0.18 * sign, 0.03 + i * 0.025, 1.16 - i * 0.035)
            end = ((0.34 + i * 0.035) * sign, 0.10 + i * 0.025, 1.05 - i * 0.05)
            cone_between(f"{side}Feather_{i}", start, end, 0.055 - i * 0.006, f"{side}Arm", cloth, 6)
    # Three blade-like tail feathers mounted to the pelvis.
    for i, x in enumerate((-0.09, 0, 0.09)):
        cone_between(f"TenguTail_{i}", (x, 0.12, 0.72), (x * 1.5, 0.28, 0.30 + 0.04 * i), 0.065, "Hips", armor, 6)


def create_grip_socket(rig: bpy.types.Object, bone: str, name: str, world_position) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = 0.12
    empty.parent = rig
    empty.parent_type = "BONE"
    empty.parent_bone = bone
    bpy.context.view_layer.update()
    # Keep a world-upright frame in the bind pose. The weapon GLBs use +Y as
    # blade direction in Three.js; Blender's +Z maps to that glTF axis.
    empty.matrix_world = Matrix.Translation(Vector(world_position))
    empty["socket"] = "weapon_primary" if name.endswith("R") else "weapon_secondary"
    return empty


def join_and_bind(variant: str, rig: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = f"{variant.title()}EnemyBody"
    body.data.name = f"{variant.title()}EnemyBodyMesh"
    body.parent = rig
    body.matrix_parent_inverse = rig.matrix_world.inverted()
    modifier = body.modifiers.new("EnemyRig", "ARMATURE")
    modifier.object = rig
    for polygon in body.data.polygons:
        polygon.use_smooth = False
    return body


def render_preview(variant: str) -> None:
    """Optional close-up used to review facial readability after generation."""
    preview_dir = os.environ.get("NINJAFLOW_PREVIEW_DIR")
    if not preview_dir:
        return
    Path(preview_dir).mkdir(parents=True, exist_ok=True)

    camera_data = bpy.data.cameras.new("EnemyPreviewCamera")
    camera = bpy.data.objects.new("EnemyPreviewCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, -2.55, 1.46)
    camera.rotation_euler = (Vector((0, 0, 1.42)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 72
    bpy.context.scene.camera = camera

    for name, location, energy, size in (
        ("Key", (-1.4, -2.1, 2.8), 850, 2.2),
        ("Rim", (1.5, 0.2, 2.3), 650, 1.6),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 1.35)) - light.location).to_track_quat("-Z", "Y").to_euler()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.018, 0.022, 0.035)
    scene.render.filepath = str(Path(preview_dir) / f"enemy-{variant}.png")
    bpy.ops.render.render(write_still=True)


def export_variant(variant: str) -> dict[str, object]:
    clear_scene()
    rig = create_rig(variant)
    common_body(variant, rig)
    if variant == "ronin":
        ronin_details()
    elif variant == "oni":
        oni_details()
    else:
        tengu_details()
    body = join_and_bind(variant, rig)
    right = create_grip_socket(rig, "RightHand", "WeaponGripR", (-0.55, 0, 0.82))
    left = create_grip_socket(rig, "LeftHand", "WeaponGripL", (0.55, 0, 0.82))

    bpy.context.scene["enemy_authoring"] = "Original NINJA FLOW procedural Blender source"
    bpy.context.scene["weapon_contract"] = "grip at socket; metres; blade +Y after glTF export"

    bpy.ops.object.select_all(action="DESELECT")
    for obj in (rig, body, right, left):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = OUT / f"enemy-{variant}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )
    render_preview(variant)
    return {
        "id": variant,
        "file": path.name,
        "bytes": path.stat().st_size,
        "vertices": len(body.data.vertices),
        "triangles": sum(len(p.vertices) - 2 for p in body.data.polygons),
        "materials": len(body.data.materials),
        "sockets": ["WeaponGripR", "WeaponGripL"],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    reports = [export_variant(variant) for variant in ("ronin", "oni", "tengu")]
    (OUT / "manifest.json").write_text(json.dumps(reports, indent=2) + "\n")
    print("ENEMY_EXPORT_REPORT=" + json.dumps(reports))


if __name__ == "__main__":
    main()
