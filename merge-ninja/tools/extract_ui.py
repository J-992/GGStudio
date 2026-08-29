"""Slice the supplied UI/environment sheet into game-ready assets.

Outputs
  assets-staging/ui/*.png     UI panels, buttons, props and environment pieces
  public/assets/font.png      bitmap font page
  public/assets/font.xml      BMFont descriptor for Phaser's bitmapFont loader

The sheet is a screenshot on white, so every piece is keyed the same way the
character sheets are: flood the near-white background inward from the crop edge,
then shave the JPEG/scaling halo that hugs the art.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path("/Users/derek/Desktop/crazygames/merge-ninja")
SHEET = ROOT / "assets-staging/source/ui_sheet.png"
OUT = ROOT / "assets-staging/ui"
FONT_PNG = ROOT / "public/assets/font.png"
FONT_XML = ROOT / "public/assets/font.xml"

WHITE_CUTOFF = 206
HALO_CUTOFF = 210

# name: (x, y, w, h) on the sheet.
PIECES = {
    "panel_portrait": (722, 35, 69, 70),
    "banner_stage": (799, 37, 188, 25),
    "banner_name": (800, 64, 186, 26),
    "plate_title": (800, 95, 186, 18),
    "panel_board": (720, 142, 291, 157),
    "icon_coin": (725, 311, 20, 21),
    "btn_buy": (795, 310, 38, 22),
    "field_text": (753, 357, 81, 39),
    "icon_trash": (723, 364, 25, 30),
    "btn_back": (988, 34, 30, 30),
    # The page-flip chevrons sit one row below the filled arrows: two 9x12
    # outline glyphs (< at x758, > at x820, y341-352). The boxes hug them
    # loosely and let key_out trim back to the ink.
    "arrow_down": (721, 338, 22, 14),
    "arrow_left": (752, 336, 18, 20),
    "arrow_right": (814, 336, 20, 20),
    "env_platform": (20, 257, 383, 140),
    "env_desert": (11, 114, 156, 133),
    "env_island": (247, 96, 178, 145),
"vfx_portal": (451, 265, 123, 127),
"props_a": (458, 34, 88, 143),
"blades": (618, 279, 92, 118),
}
# The texture strip is one row of square swatches.
TEXTURE_STRIP = (11, 34, 414, 66)
TEXTURE_COUNT = 6

# Icon grids sit on flat grey cells rather than white, so they key differently.
# `None` skips a cell the game has no use for.
ICON_GRIDS = [
    ("prop", (551, 34, 143, 143), 3, 3,
     ["mushroom_red", "mushroom_tan", "mushroom_gold",
      "mushroom_purple", "mushroom_blue", "mushroom_green",
      "lantern_stone", "lantern_iron", "lantern_wall"]),
    # Gears are grey art on a grey cell: nothing separates them from the backdrop,
    # so only the cacti in this grid are extractable.
    ("prop", (458, 34, 88, 143), 2, 3,
     [None, None, None, None, "cactus_tall", "cactus_round"]),
    ("vfx", (578, 190, 112, 137), 2, 3,
     ["flame", "bolt_a", "bolt_b", "bolt_c", "bolt_d", "bolt_e"]),
]

FONT_REGION = (845, 318, 179, 91)
FONT_ROWS = ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "0123456789", "?!@#$%&()+=>{}"]


def key_out(cell: Image.Image) -> Image.Image | None:
    rgb = np.asarray(cell.convert("RGB")).astype(int)
    light = rgb.min(axis=2) >= WHITE_CUTOFF
    seeds = np.zeros_like(light)
    seeds[0, :] = seeds[-1, :] = seeds[:, 0] = seeds[:, -1] = True
    labels, count = ndimage.label(light)
    background = np.isin(labels, np.unique(labels[seeds & light])) if count else np.zeros_like(light)

    solid = ~background
    light_edge = rgb.min(axis=2) >= HALO_CUTOFF
    for _ in range(2):
        exposed = solid & ~ndimage.binary_erosion(solid, border_value=0)
        solid &= ~(exposed & light_edge)
    if not solid.any():
        return None

    out = np.dstack([np.asarray(cell.convert("RGB")), (solid * 255).astype(np.uint8)])
    img = Image.fromarray(out.astype(np.uint8), "RGBA")
    box = img.getbbox()
    if not box:
        return None
    piece = img.crop(box)
    # A sliver means the crop box clipped its glyph. Those used to ship
    # silently and render as broken pixel fragments in game.
    if piece.width < 6 or piece.height < 6:
        print("  ?? keyed piece is tiny -- its crop box likely clips the art")
    return piece


def trim_pale_border(cell: Image.Image) -> Image.Image:
    """Eat rows/columns left over from the gap between swatches, so the texture tiles."""
    rgb = np.asarray(cell.convert("RGB")).astype(int)
    pale = rgb.min(axis=2) >= 200
    left, right = 0, cell.width
    while left < right and pale[:, left].mean() > 0.5:
        left += 1
    while right - 1 > left and pale[:, right - 1].mean() > 0.5:
        right -= 1
    top, bottom = 0, cell.height
    while top < bottom and pale[top, :].mean() > 0.5:
        top += 1
    while bottom - 1 > top and pale[bottom - 1, :].mean() > 0.5:
        bottom -= 1
    return cell.crop((left, top, right, bottom))


def key_grey(cell: Image.Image) -> Image.Image | None:
    """Key an icon off its flat grey cell, sampling the actual corner colour."""
    # Drop the cell's drawn border first; its lighter line blocks a flood that
    # starts at the very edge.
    cell = cell.crop((4, 4, max(5, cell.width - 4), max(5, cell.height - 4)))
    rgb = np.asarray(cell.convert("RGB")).astype(int)
    ring = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    backdrop = np.median(ring, axis=0)
    near = np.abs(rgb - backdrop).max(axis=2) <= 24

    seeds = np.zeros(near.shape, bool)
    seeds[0, :] = seeds[-1, :] = seeds[:, 0] = seeds[:, -1] = True
    labels, count = ndimage.label(near)
    background = np.isin(labels, np.unique(labels[seeds & near])) if count else np.zeros(near.shape, bool)

    solid = ~background
    # Backdrop sealed inside the art (the middle of a fire ring) never reaches the
    # border. Tolerance is tighter here so icon bodies are not mistaken for it.
    sealed = np.abs(rgb - backdrop).max(axis=2) <= 20
    pockets, pocket_count = ndimage.label(sealed & solid)
    for index in range(1, pocket_count + 1):
        pocket = pockets == index
        if pocket.sum() >= 20:
            solid &= ~pocket
    if solid.sum() < 24:
        return None
    out = np.dstack([rgb.astype(np.uint8), (solid * 255).astype(np.uint8)])
    img = Image.fromarray(out, "RGBA")
    box = img.getbbox()
    return img.crop(box) if box else None


def split_row(band: np.ndarray, expected: int) -> list[tuple[int, int]]:
    """Column runs for one font row, splitting runs that swallowed two glyphs."""
    columns = band.sum(axis=0)
    runs, start = [], None
    for i, value in enumerate(columns):
        if value > 0 and start is None:
            start = i
        elif value == 0 and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(columns)))

    # Neighbouring glyphs sometimes touch and come back as one run. Split the widest
    # run at its thinnest column rather than its midpoint: the seam between two
    # letters carries the least ink, and cutting at the midpoint clips a stroke.
    while len(runs) < expected:
        widest = max(range(len(runs)), key=lambda i: runs[i][1] - runs[i][0])
        a, b = runs[widest]
        interior = range(a + 2, b - 1)
        cut = min(interior, key=lambda x: columns[x]) if len(interior) else (a + b) // 2
        runs[widest:widest + 1] = [(a, cut), (cut, b)]
    return runs


def solidify(outline: np.ndarray) -> np.ndarray:
    """Turn an outline-only glyph into a filled one without closing its counters.

    The sheet's alphabet draws each letter as a stroke around white paper, so a
    plain hole-fill turns B and O into solid blocks. Holes are separated by depth
    instead: the letter body sits one stroke in from the outside and gets filled,
    while a counter sits two strokes in and stays open.
    """
    hollow = ~outline
    labels, count = ndimage.label(hollow)
    if not count:
        return outline
    border = set(labels[0]) | set(labels[-1]) | set(labels[:, 0]) | set(labels[:, -1])
    exterior = np.isin(labels, [i for i in border if i])

    # Strokes that face the outside world.
    outer_stroke = outline & ndimage.binary_dilation(exterior)

    solid = outline.copy()
    for index in range(1, count + 1):
        region = labels == index
        if (region & exterior).any():
            continue
        if (ndimage.binary_dilation(region) & outer_stroke).any():
            solid |= region
    return solid


def punctuation(line: int) -> list[tuple[str, Image.Image]]:
    """Glyphs the sheet's alphabet leaves out.

    Without a space the font runs words together ("IRON SHOGUN" drew as
    IRONXSHOGUN) and without a slash an HP readout cannot show "hp / max", so
    these are drawn to match the alphabet's weight.
    """
    stroke = max(2, line // 8)
    dot = stroke

    def blank(width: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        im = Image.new("RGBA", (width, line), (255, 255, 255, 0))
        return im, ImageDraw.Draw(im)

    out: list[tuple[str, Image.Image]] = []

    im, _ = blank(max(4, line // 3))
    out.append((" ", im))

    im, d = blank(stroke * 4)
    d.line([(im.width - stroke, stroke), (stroke - 1, line - stroke)], fill="white", width=stroke)
    out.append(("/", im))

    im, d = blank(dot * 2)
    for y in (line // 3, line - dot * 2 - 1):
        d.rectangle([0, y, dot - 1, y + dot - 1], fill="white")
    out.append((":", im))

    im, d = blank(dot * 2)
    d.rectangle([0, line - dot * 2 - 1, dot - 1, line - dot - 1], fill="white")
    d.rectangle([0, line - dot - 1, dot - 1, line - 1], fill="white")
    out.append((",", im))

    im, d = blank(dot * 2)
    d.rectangle([0, line - dot * 2, dot - 1, line - dot - 1], fill="white")
    out.append((".", im))

    im, d = blank(stroke * 3)
    d.rectangle([0, line // 2 - stroke // 2, im.width - stroke, line // 2 + stroke // 2], fill="white")
    out.append(("-", im))
    return out


def build_font() -> None:
    x0, y0, w, h = FONT_REGION
    sheet = Image.open(SHEET).convert("RGB")
    region = sheet.crop((x0, y0, x0 + w, y0 + h))
    dark = np.asarray(region).astype(int).min(axis=2) < 150

    bands, start = [], None
    for i, value in enumerate(dark.sum(axis=1)):
        if value > 0 and start is None:
            start = i
        elif value == 0 and start is not None:
            if i - start >= 6:
                bands.append((start, i))
            start = None
    if start is not None:
        bands.append((start, len(dark)))

    glyphs: list[tuple[str, Image.Image]] = []
    for (top, bottom), chars in zip(bands, FONT_ROWS):
        for (left, right), char in zip(split_row(dark[top:bottom], len(chars)), chars):
            cell = region.crop((left, top, right, bottom))
            outline = np.asarray(cell).astype(int).min(axis=2) < 170
            mask = solidify(outline).astype(np.uint8) * 255
            rgba = np.dstack([np.full((*mask.shape, 3), 255, np.uint8), mask])
            glyph = Image.fromarray(rgba, "RGBA")
            box = glyph.getbbox()
            if box:
                glyphs.append((char, glyph.crop((box[0], 0, box[2], glyph.height))))

    line = max(g.height for _, g in glyphs)
    glyphs.extend(punctuation(line))

    pad = 2
    width = sum(g.width + pad for _, g in glyphs) + pad
    page = Image.new("RGBA", (width, line + pad * 2), (0, 0, 0, 0))
    entries, x = [], pad
    for char, glyph in glyphs:
        page.paste(glyph, (x, pad), glyph)
        entries.append((char, x, pad, glyph.width, glyph.height))
        x += glyph.width + pad

    FONT_PNG.parent.mkdir(parents=True, exist_ok=True)
    page.save(FONT_PNG)

    chars_xml = "\n".join(
        f'    <char id="{ord(c)}" x="{gx}" y="{gy}" width="{gw}" height="{gh}"'
        f' xoffset="0" yoffset="{line - gh}" xadvance="{gw + 1}" page="0" chnl="15"/>'
        for c, gx, gy, gw, gh in entries
    )
    FONT_XML.write_text(
        '<?xml version="1.0"?>\n<font>\n'
        f'  <info face="MergeNinja" size="{line}"/>\n'
        f'  <common lineHeight="{line + 2}" base="{line}" scaleW="{page.width}" scaleH="{page.height}" pages="1"/>\n'
        f'  <pages><page id="0" file="{FONT_PNG.name}"/></pages>\n'
        f'  <chars count="{len(entries)}">\n{chars_xml}\n  </chars>\n</font>\n'
    )
    print(f"font: {len(entries)} glyphs -> {FONT_PNG.name} ({page.width}x{page.height})")


def patch_atlas(pieces: dict[str, Image.Image]) -> None:
    """Splice extracted pieces into the shipped atlas instead of repacking it.

    pack_atlas.py rebuilds every frame from assets-staging, which no longer
    matches the shipped character art wholesale. A shelf added under the
    existing page replaces just the named frames and touches nothing else.
    """
    atlas_png = ROOT / "public/assets/game.png"
    atlas_json = ROOT / "public/assets/game.json"
    data = json.loads(atlas_json.read_text())
    sheet = Image.open(atlas_png).convert("RGBA")

    pad = 4
    shelf_height = max(image.height for image in pieces.values())
    page = Image.new("RGBA", (sheet.width, sheet.height + shelf_height + pad), (0, 0, 0, 0))
    page.paste(sheet, (0, 0))

    x, top = pad, sheet.height + pad
    for key, image in pieces.items():
        page.paste(image, (x, top), image)
        data["frames"][key] = {
            "frame": {"x": x, "y": top, "w": image.width, "h": image.height},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height},
            "sourceSize": {"w": image.width, "h": image.height},
        }
        x += image.width + pad

    data["meta"]["size"] = {"w": page.width, "h": page.height}
    page.save(atlas_png)
    atlas_json.write_text(json.dumps(data, indent=1))
    print(f"atlas: {len(data['frames'])} frames, {page.width}x{page.height}")


def main() -> None:
    only = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGB")
    written = {}

    for name, (x, y, w, h) in PIECES.items():
        if only and name not in only:
            continue
        piece = key_out(sheet.crop((x, y, x + w, y + h)))
        if piece is None:
            print(f"  !! {name} keyed to nothing")
            continue
        piece.save(OUT / f"{name}.png")
        written[name] = piece.size

    if only:
        # Naming pieces on the command line splices just those into the shipped
        # atlas, leaving the font and every other frame untouched.
        if not written:
            raise SystemExit(f"no requested piece keyed out: {', '.join(only)}")
        patch_atlas({name: Image.open(OUT / f"{name}.png") for name in written})
        return

    tx, ty, tw, th = TEXTURE_STRIP
    step = tw / TEXTURE_COUNT
    for i in range(TEXTURE_COUNT):
        # Inset well past the swatch seam, otherwise the neighbour's light edge
        # bleeds in as a stripe and ruins the texture when it tiles.
        cell = sheet.crop((round(tx + i * step) + 6, ty + 5, round(tx + (i + 1) * step) - 6, ty + th - 5))
        cell = trim_pale_border(cell)
        cell.save(OUT / f"tex_{i}.png")
        written[f"tex_{i}"] = cell.size

    for name, (gx, gy, gw, gh), cols, rows, labels in ICON_GRIDS:
        for index, label in enumerate(labels):
            if label is None:
                continue
            cw, ch = gw / cols, gh / rows
            col, row = index % cols, index // cols
            cell = sheet.crop((round(gx + col * cw) + 7, round(gy + row * ch) + 7,
                               round(gx + (col + 1) * cw) - 7, round(gy + (row + 1) * ch) - 7))
            icon = key_grey(cell)
            if icon is None:
                continue
            icon.save(OUT / f"{name}_{label}.png")
            written[f"{name}_{label}"] = icon.size

    (OUT / "MANIFEST.json").write_text(json.dumps(
        [{"key": k, "w": v[0], "h": v[1]} for k, v in written.items()], indent=1))
    print(f"{len(written)} ui pieces -> {OUT}")
    build_font()


if __name__ == "__main__":
    main()
