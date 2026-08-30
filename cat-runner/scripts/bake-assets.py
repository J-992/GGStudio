#!/usr/bin/env python3
"""
Bakes the shipped assets in `public/assets/` down to a size a web game can load.

Run occasionally, by hand, when a new source asset lands - not part of
`npm run build`. It rewrites files in place and is idempotent: anything already
at or under its target is left byte-for-byte alone, so a second run is a no-op
and repeated runs never re-compress an already-lossy image.

    python scripts/bake-assets.py            # rewrite public/assets
    python scripts/bake-assets.py --dry-run  # report what would change

Requires Pillow (`pip install Pillow`) and, for the audio step only, `ffmpeg` on
PATH or in FFMPEG. Both are developer tools; nothing here runs on a player's
machine and the game has no runtime dependency on either.

--------------------------------------------------------------------------------
Why each step is safe
--------------------------------------------------------------------------------

**Dropping PBR maps.** `AssetRegistry.toLambert()` converts every loaded glTF and
FBX material to `MeshLambertMaterial`, which samples exactly one texture: the
base colour map. The metallic-roughness, normal and emissive maps in these
exports are therefore downloaded, decoded, uploaded to the GPU and then dropped
on the floor at load. That is 17.6 MB across four models, spent on maps this
renderer has no code path to read. This script removes them from the file so
they are never fetched at all; if the game ever moves to a PBR material, they
come back from source, not from here.

**Resizing base colour maps.** The props these belong to are metre-scale objects
passed at speed on a rooftop - a crate covers a couple of hundred pixels at the
follow camera's distance. `scripts/png-resize.mjs` already makes this argument
for the character and building maps and caps them at 1024; the same reasoning
caps prop maps lower, at `PROP_TEXTURE_SIZE`.

**PNG to WebP.** The standalone colour maps are photographic-ish fur and brick.
WebP at quality 82 is visually indistinguishable from the PNG at gameplay
distance and roughly a fifteenth of the size. `THREE.TextureLoader` decodes it
through an `<img>`, so every browser Poki supports handles it natively.

**WAV to OGG.** An 87-second stereo 44.1 kHz WAV is 14.65 MB, over half the
entire budget, for one music loop. Vorbis takes it to about a megabyte.
`THREE.AudioLoader` hands the bytes to `decodeAudioData`, which handles Ogg
Vorbis everywhere the game runs.
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------

#: Longest side for a prop's base colour map, embedded in a GLB. These are small
#: objects seen briefly and at distance; 512 is already generous for a crate.
PROP_TEXTURE_SIZE = 512

#: Longest side for the cat coats. The cat is roughly 90 px tall on screen at the
#: follow camera's distance, and the shop preview shows it at maybe 300.
SKIN_TEXTURE_SIZE = 512

#: Longest side for everything else - building finishes tile across a whole wall
#: and pickup maps are seen close during a collect, so they keep more detail.
DEFAULT_TEXTURE_SIZE = 1024

#: WebP quality for colour maps. 82 is the knee of the curve on this material.
WEBP_QUALITY = 82

#: JPEG quality for base colour maps re-embedded into a GLB.
JPEG_QUALITY = 85

#: Vorbis quality for the music bed. -q:a 4 is ~128 kbps VBR.
OGG_QUALITY = "4"

#: Files whose byte-for-byte contents must not change - sound effects are already
#: tiny, and re-encoding a 12 KB blip costs more in artefacts than it saves.
AUDIO_MIN_BYTES = 1_000_000


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


class Report:
    def __init__(self, dry_run: bool):
        self.dry_run = dry_run
        self.rows: list[tuple[str, int, int, str]] = []

    def add(self, path: Path, before: int, after: int, note: str = "") -> None:
        self.rows.append((rel(path), before, after, note))

    def print(self) -> None:
        if not self.rows:
            print("Nothing to do - every asset is already within budget.")
            return
        before_total = sum(r[1] for r in self.rows)
        after_total = sum(r[2] for r in self.rows)
        width = max(len(r[0]) for r in self.rows)
        for name, before, after, note in sorted(self.rows, key=lambda r: r[1] - r[2], reverse=True):
            print(f"  {name:<{width}}  {before/1048576:7.2f} -> {after/1048576:6.2f} MB   {note}")
        verb = "would save" if self.dry_run else "saved"
        print(
            f"\n{len(self.rows)} files, {before_total/1048576:.2f} MB -> "
            f"{after_total/1048576:.2f} MB ({verb} {(before_total-after_total)/1048576:.2f} MB)"
        )


# ===========================================================================
# GLB
# ===========================================================================

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def glb_read(path: Path):
    data = path.read_bytes()
    magic, version, _ = struct.unpack("<III", data[:12])
    if magic != GLB_MAGIC:
        raise ValueError(f"{path} is not a GLB")
    if version != 2:
        raise ValueError(f"{path} is glTF {version}, only 2 is handled")

    offset, gltf, buffer = 12, None, b""
    while offset < len(data):
        length, kind = struct.unpack("<II", data[offset : offset + 8])
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == CHUNK_JSON:
            gltf = json.loads(chunk.decode("utf-8"))
        elif kind == CHUNK_BIN:
            buffer = chunk
        offset += 8 + length
        offset += (4 - offset % 4) % 4
    if gltf is None:
        raise ValueError(f"{path} has no JSON chunk")
    return gltf, buffer


def glb_write(path: Path, gltf: dict, buffer: bytes) -> bytes:
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    buf = buffer + b"\0" * ((4 - len(buffer) % 4) % 4)

    total = 12 + 8 + len(js) + (8 + len(buf) if buf else 0)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(js), CHUNK_JSON) + js
    if buf:
        out += struct.pack("<II", len(buf), CHUNK_BIN) + buf
    return bytes(out)


def base_colour_images(gltf: dict) -> set[int]:
    """
    Image indices reachable from a material's base colour slot.

    Everything else is unreachable from `MeshLambertMaterial`, which is what
    every model in this game ends up wearing.
    """
    textures = gltf.get("textures", [])
    kept = set()
    for material in gltf.get("materials", []):
        ref = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not ref:
            continue
        source = textures[ref["index"]].get("source")
        if source is not None:
            kept.add(source)
    return kept


def resize_encode(raw: bytes, max_size: int, mime: str) -> tuple[bytes, str, str] | None:
    """
    Downsizes an encoded image and re-encodes it, returning (bytes, mime, note).

    Returns None when the image already fits, so a second run leaves it byte for
    byte alone. Re-encoding an in-budget JPEG would cost a generation of quality
    for no bytes, and doing that on every run compounds.

    Keeps PNG for anything with real transparency - a base colour map with an
    alpha channel is doing cutout work, and JPEG would fill the cut-out region
    with black. Everything else becomes JPEG, which every glTF loader reads
    without an extension declaration.
    """
    from io import BytesIO

    image = Image.open(BytesIO(raw))
    before = image.size
    image.load()

    if max(image.size) <= max_size:
        return None

    has_alpha = image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )

    longest = max(image.size)
    if longest > max_size:
        scale = max_size / longest
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    out = BytesIO()
    if has_alpha:
        image.convert("RGBA").save(out, format="PNG", optimize=True)
        mime_out = "image/png"
    else:
        image.convert("RGB").save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        mime_out = "image/jpeg"

    note = f"{before[0]}x{before[1]}->{image.width}x{image.height}"
    return out.getvalue(), mime_out, note


def compact(gltf: dict, buffer: bytes, replacements: dict[int, bytes]) -> tuple[dict, bytes]:
    """
    Rebuilds the binary chunk from only the buffer views still referenced.

    Dropping an image leaves its bytes stranded in the middle of the buffer, so
    the views have to be re-laid-out and every index that points at one remapped.
    `replacements` supplies new bytes for an image's view, keyed by image index.
    """
    views = gltf.get("bufferViews", [])
    accessors = gltf.get("accessors", [])
    images = gltf.get("images", [])

    live: list[int] = []
    for accessor in accessors:
        if "bufferView" in accessor:
            live.append(accessor["bufferView"])
        sparse = accessor.get("sparse")
        if sparse:
            live.append(sparse["indices"]["bufferView"])
            live.append(sparse["values"]["bufferView"])
    for image in images:
        if "bufferView" in image:
            live.append(image["bufferView"])

    order = sorted(set(live))
    remap: dict[int, int] = {}
    new_views: list[dict] = []
    blob = bytearray()

    image_view = {img["bufferView"]: i for i, img in enumerate(images) if "bufferView" in img}

    for old in order:
        view = dict(views[old])
        img_index = image_view.get(old)
        if img_index is not None and img_index in replacements:
            payload = replacements[img_index]
        else:
            start = view.get("byteOffset", 0)
            payload = buffer[start : start + view["byteLength"]]

        blob += b"\0" * ((4 - len(blob) % 4) % 4)
        view["byteOffset"] = len(blob)
        view["byteLength"] = len(payload)
        # A view that once described interleaved vertex data keeps its stride;
        # an image view must not have one at all.
        if img_index is not None:
            view.pop("byteStride", None)
        blob += payload

        remap[old] = len(new_views)
        new_views.append(view)

    for accessor in accessors:
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]
        sparse = accessor.get("sparse")
        if sparse:
            sparse["indices"]["bufferView"] = remap[sparse["indices"]["bufferView"]]
            sparse["values"]["bufferView"] = remap[sparse["values"]["bufferView"]]
    for image in images:
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]

    gltf["bufferViews"] = new_views
    gltf["buffers"] = [{"byteLength": len(blob)}] if blob else []
    return gltf, bytes(blob)


def bake_glb(path: Path, report: Report, dry_run: bool) -> None:
    before = path.stat().st_size
    gltf, buffer = glb_read(path)

    keep = base_colour_images(gltf)
    images = gltf.get("images", [])
    textures = gltf.get("textures", [])
    if not images:
        return

    # --- strip every texture slot Lambert cannot sample -------------------
    dropped_maps = 0
    for material in gltf.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        for holder, key in (
            (pbr, "metallicRoughnessTexture"),
            (material, "normalTexture"),
            (material, "occlusionTexture"),
            (material, "emissiveTexture"),
        ):
            if holder.pop(key, None) is not None:
                dropped_maps += 1
        # An emissive factor with no map left would tint the whole prop.
        material.pop("emissiveFactor", None)

    # --- drop the images and textures nothing points at any more ----------
    keep_textures = {
        m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        for m in gltf.get("materials", [])
    }
    keep_textures.discard(None)

    tex_remap: dict[int, int] = {}
    new_textures = []
    for i, tex in enumerate(textures):
        if i in keep_textures:
            tex_remap[i] = len(new_textures)
            new_textures.append(tex)

    img_remap: dict[int, int] = {}
    new_images = []
    for i, img in enumerate(images):
        if i in keep:
            img_remap[i] = len(new_images)
            new_images.append(img)

    for tex in new_textures:
        if "source" in tex:
            tex["source"] = img_remap[tex["source"]]
    for material in gltf.get("materials", []):
        ref = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if ref:
            ref["index"] = tex_remap[ref["index"]]

    gltf["textures"] = new_textures
    gltf["images"] = new_images

    # --- resize whatever base colour maps survived ------------------------
    views = gltf["bufferViews"]
    replacements: dict[int, bytes] = {}
    notes = []
    for i, img in enumerate(new_images):
        if "bufferView" not in img:
            continue
        view = views[img["bufferView"]]
        start = view.get("byteOffset", 0)
        raw = buffer[start : start + view["byteLength"]]
        try:
            resized = resize_encode(raw, PROP_TEXTURE_SIZE, img.get("mimeType", ""))
        except Exception as err:  # a map we cannot read ships untouched
            print(f"    ! {rel(path)} image {i}: {err}", file=sys.stderr)
            continue
        if resized is None:
            continue
        encoded, mime, note = resized
        if len(encoded) < len(raw):
            replacements[i] = encoded
            img["mimeType"] = mime
            notes.append(note)

    gltf, blob = compact(gltf, buffer, replacements)
    out = glb_write(path, gltf, blob)

    if len(out) >= before:
        return

    detail = f"dropped {dropped_maps} unsampled maps"
    if notes:
        detail += f", base colour {notes[0]}"
    report.add(path, before, len(out), detail)
    if not dry_run:
        path.write_bytes(out)


# ===========================================================================
# Standalone textures
# ===========================================================================

def texture_budget(path: Path) -> int:
    if path.parent.name == "skins":
        return SKIN_TEXTURE_SIZE
    return DEFAULT_TEXTURE_SIZE


def referenced_by_sibling(path: Path) -> bool:
    """
    True when a `.gltf`, `.mtl` or `.obj` beside this texture names it by URI.

    Those references live inside the model files, not in `src/`, so renaming the
    texture would break them silently at load. The KayKit packs share one atlas
    across 88 `.gltf` files - rewriting all of them to save 20 KB is not a trade
    worth making, so the atlas simply stays a PNG.
    """
    name = path.name.encode("utf-8")
    for sibling in path.parent.rglob("*"):
        if sibling.suffix.lower() in (".gltf", ".mtl", ".obj"):
            if name in sibling.read_bytes():
                return True
    return False


def bake_texture(path: Path, report: Report, dry_run: bool) -> Path | None:
    """
    Rewrites a PNG as WebP beside itself and removes the PNG.

    Returns the new path so the caller can report the rename that the source
    tree needs - the `.png` in `AssetRegistry` has to follow the file.
    """
    before = path.stat().st_size
    target = path.with_suffix(".webp")

    if referenced_by_sibling(path):
        return None

    image = Image.open(path)
    image.load()
    original = image.size

    budget = texture_budget(path)
    longest = max(image.size)
    if longest > budget:
        scale = budget / longest
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    has_alpha = image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")

    from io import BytesIO

    out = BytesIO()
    image.save(out, format="WEBP", quality=WEBP_QUALITY, method=6)
    encoded = out.getvalue()

    if len(encoded) >= before:
        return None

    note = f"{original[0]}x{original[1]}->{image.width}x{image.height} webp"
    report.add(path, before, len(encoded), note)
    if not dry_run:
        target.write_bytes(encoded)
        path.unlink()
    return target


# ===========================================================================
# FBX
# ===========================================================================
#
# `townhouse.fbx` is 5.25 MB, of which 5.46 MB - all but about 50 KB - is five
# textures embedded in `Video` nodes. Four of them (normal, roughness, metallic,
# emissive) are maps `toLambert` has no code path to sample, exactly as in the
# GLB props. The fifth, base colour, is a real fallback: `buildingMaterial()`
# returns null until the five wall finishes have loaded, and until then the
# tiles wear the model's own material.
#
# So the four unsampled maps shrink to a placeholder and the base colour is
# resized, rather than any of them being deleted. Removing a `Video` node would
# orphan the `Connections` entry that binds it to its `Texture`, and an FBX with
# a dangling connection is a parse error, not a smaller file.

FBX_MAGIC = b"Kaydara FBX Binary  \x00"

#: Longest side for the townhouse's base colour fallback.
FBX_BASE_TEXTURE_SIZE = 512

#: Everything Lambert cannot read becomes this - a valid image, and 4x4 of it.
FBX_PLACEHOLDER_SIZE = 4

#: Substring identifying the one map that is actually sampled.
FBX_BASE_TEXTURE_HINT = "base_color"


class FbxNode:
    __slots__ = ("name", "props", "children", "nprops", "nested")

    def __init__(self, name: bytes, props: bytes, children: list, nprops: int, nested: bool):
        self.name = name
        self.props = props
        self.children = children
        #: Declared property count. Held separately because a rewritten property
        #: list has to keep the count the original header advertised.
        self.nprops = nprops
        #: Whether the source node carried a nested list *at all*. A node can
        #: have an empty one - a bare 13-byte null record and no children - and
        #: exporters do write those. Reconstructing the file without them
        #: shortens every enclosing EndOffset by 13 bytes a time, which is a
        #: silently corrupt file rather than a smaller one.
        self.nested = nested


def fbx_parse(data: bytes) -> tuple[list, int, bytes]:
    """Parses an FBX 7.x binary into a node tree, its version, and its footer."""
    if not data.startswith(FBX_MAGIC):
        raise ValueError("not a binary FBX")
    version = struct.unpack("<I", data[23:27])[0]
    wide = version >= 7500
    head = struct.Struct("<QQQ") if wide else struct.Struct("<III")

    def read_list(offset: int) -> tuple[list, int]:
        nodes = []
        while True:
            end, nprops, plen = head.unpack(data[offset : offset + head.size])
            namelen = data[offset + head.size]
            if end == 0 and nprops == 0 and plen == 0 and namelen == 0:
                return nodes, offset + head.size + 1
            name_at = offset + head.size + 1
            name = data[name_at : name_at + namelen]
            props_at = name_at + namelen
            props = data[props_at : props_at + plen]
            children: list = []
            nested = props_at + plen < end
            if nested:
                children, _ = read_list(props_at + plen)
            nodes.append(FbxNode(name, props, children, nprops, nested))
            offset = end

    roots, after = read_list(27)
    return roots, version, data[after:]


def fbx_write(roots: list, version: int, footer: bytes) -> bytes:
    """
    Re-serialises a node tree, recomputing every `EndOffset`.

    Those offsets are absolute positions in the finished file, so a node's
    header cannot be written until everything nested inside it has been sized -
    hence the two-pass shape here: lay the body out first, then patch.
    """
    wide = version >= 7500
    head = struct.Struct("<QQQ") if wide else struct.Struct("<III")

    out = bytearray()
    out += FBX_MAGIC + b"\x1a\x00" + struct.pack("<I", version)

    def write_list(nodes: list) -> None:
        # `out.extend` rather than `out +=`: the augmented assignment would bind
        # `out` as a local of this closure and shadow the buffer being built.
        for node in nodes:
            start = len(out)
            out.extend(b"\0" * head.size)     # EndOffset, patched once sized
            out.append(len(node.name))
            out.extend(node.name)
            out.extend(node.props)
            if node.nested:
                write_list(node.children)
                out.extend(b"\0" * (head.size + 1))  # nested null record
            head.pack_into(out, start, len(out), node.nprops, len(node.props))

    write_list(roots)
    out += b"\0" * (head.size + 1)  # top-level null record

    # Footer: 16-byte id, zero padding to a 16-byte boundary, version, 120
    # zeros, 16-byte magic. The id and magic are exporter-specific, so they are
    # carried over from the source file rather than invented.
    # The footer is 16 bytes of exporter id, a run of zero padding, the version,
    # 120 more zeros and a 16-byte magic. Both the id and the magic are
    # exporter-specific and are carried over rather than invented.
    #
    # The padding is the awkward part: exporters disagree about how much to
    # write - some pad to the next 16-byte boundary, some add a further 16 on
    # top - and guessing a rule gets one family of files right and corrupts the
    # rest. So the source's own padding length is measured and then shifted by
    # however much the body moved, modulo 16. An untouched file therefore comes
    # back byte for byte, which is the property the round-trip test checks.
    body_end = len(out)
    # 156 = 16 (id) + 4 (version) + 120 (zeros) + 16 (magic); whatever is left
    # over in the source footer was its padding.
    pad = max(len(footer) - 156, 0)
    # Then re-align, which is a no-op when the body did not move.
    pad += (-(body_end + 16 + pad)) % 16

    out += footer[:16]
    out += b"\0" * pad
    out += struct.pack("<I", version)
    out += b"\0" * 120
    out += footer[-16:]
    return bytes(out)


def fbx_raw_property(payload: bytes) -> bytes:
    return b"R" + struct.pack("<I", len(payload)) + payload


def fbx_string_property(props: bytes) -> str:
    if not props.startswith(b"S"):
        return ""
    length = struct.unpack("<I", props[1:5])[0]
    return props[5 : 5 + length].decode("latin1")


def shrink_embedded(raw: bytes, max_size: int) -> bytes | None:
    """Resizes an image embedded in an FBX, or None when it already fits."""
    from io import BytesIO

    image = Image.open(BytesIO(raw))
    image.load()
    fmt = (image.format or "PNG").upper()

    longest = max(image.size)
    if longest <= max_size:
        return None

    scale = max_size / longest
    image = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.LANCZOS,
    )

    out = BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    else:
        image.convert("RGBA").save(out, format="PNG", optimize=True)
    return out.getvalue()


def bake_fbx(path: Path, report: Report, dry_run: bool) -> None:
    before = path.stat().st_size
    data = path.read_bytes()
    if b"Content" not in data:
        return

    roots, version, footer = fbx_parse(data)

    shrunk = 0
    placeholders = 0

    def visit(nodes: list) -> None:
        nonlocal shrunk, placeholders
        for node in nodes:
            if node.name == b"Video":
                filename = ""
                content = None
                for child in node.children:
                    if child.name == b"RelativeFilename":
                        filename = fbx_string_property(child.props)
                    elif child.name == b"Content":
                        content = child
                if content is not None and content.props.startswith(b"R"):
                    length = struct.unpack("<I", content.props[1:5])[0]
                    raw = content.props[5 : 5 + length]
                    sampled = FBX_BASE_TEXTURE_HINT in filename.lower()
                    budget = FBX_BASE_TEXTURE_SIZE if sampled else FBX_PLACEHOLDER_SIZE
                    try:
                        smaller = shrink_embedded(raw, budget)
                    except Exception as err:
                        print(f"    ! {rel(path)} {filename}: {err}", file=sys.stderr)
                        smaller = None
                    if smaller is not None and len(smaller) < len(raw):
                        content.props = fbx_raw_property(smaller)
                        if sampled:
                            shrunk += 1
                        else:
                            placeholders += 1
            visit(node.children)

    visit(roots)
    if not shrunk and not placeholders:
        return

    out = fbx_write(roots, version, footer)
    if len(out) >= before:
        return

    report.add(
        path, before, len(out),
        f"{placeholders} unsampled maps to {FBX_PLACEHOLDER_SIZE}px, {shrunk} base colour resized",
    )
    if not dry_run:
        path.write_bytes(out)


# ===========================================================================
# Audio
# ===========================================================================

def ffmpeg_path() -> str | None:
    return os.environ.get("FFMPEG") or shutil.which("ffmpeg")


def bake_audio(path: Path, report: Report, dry_run: bool) -> Path | None:
    before = path.stat().st_size
    if before < AUDIO_MIN_BYTES:
        return None

    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        print(f"    ! ffmpeg not found; {rel(path)} left as WAV", file=sys.stderr)
        return None

    target = path.with_suffix(".ogg")
    # ffmpeg picks its muxer from the extension, so the scratch file has to end
    # in .ogg too - a `.ogg.tmp` suffix makes it refuse to choose a format.
    tmp = path.with_name(path.stem + ".bake-tmp.ogg")
    result = subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(path),
         "-c:a", "libvorbis", "-q:a", OGG_QUALITY, str(tmp)],
        capture_output=True,
    )
    if result.returncode != 0 or not tmp.exists():
        print(f"    ! ffmpeg failed on {rel(path)}: {result.stderr.decode()}", file=sys.stderr)
        tmp.unlink(missing_ok=True)
        return None

    after = tmp.stat().st_size
    report.add(path, before, after, f"ogg vorbis q{OGG_QUALITY}")
    if dry_run:
        tmp.unlink()
    else:
        tmp.replace(target)
        path.unlink()
    return target


# ===========================================================================

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    parser.add_argument("--skip-audio", action="store_true")
    parser.add_argument("--skip-textures", action="store_true")
    parser.add_argument("--skip-models", action="store_true")
    args = parser.parse_args()

    if not ASSETS.is_dir():
        sys.exit(f"no such directory: {ASSETS}")

    report = Report(args.dry_run)
    renamed: list[tuple[Path, Path]] = []

    if not args.skip_models:
        print("Models")
        for path in sorted(ASSETS.rglob("*.glb")):
            try:
                bake_glb(path, report, args.dry_run)
            except Exception as err:
                print(f"    ! {rel(path)}: {err}", file=sys.stderr)
        for path in sorted(ASSETS.rglob("*.fbx")):
            try:
                bake_fbx(path, report, args.dry_run)
            except Exception as err:
                print(f"    ! {rel(path)}: {err}", file=sys.stderr)

    if not args.skip_textures:
        print("Textures")
        for path in sorted(ASSETS.rglob("*.png")):
            try:
                target = bake_texture(path, report, args.dry_run)
                if target:
                    renamed.append((path, target))
            except Exception as err:
                print(f"    ! {rel(path)}: {err}", file=sys.stderr)

    if not args.skip_audio:
        print("Audio")
        for path in sorted(ASSETS.rglob("*.wav")):
            try:
                target = bake_audio(path, report, args.dry_run)
                if target:
                    renamed.append((path, target))
            except Exception as err:
                print(f"    ! {rel(path)}: {err}", file=sys.stderr)

    print()
    report.print()

    if renamed:
        print(f"\n{len(renamed)} files changed extension - update the paths in src/:")
        exts = sorted({f"{a.suffix} -> {b.suffix}" for a, b in renamed})
        for e in exts:
            print(f"  {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
