"""
Authors the UI icons that were not part of the licensed art drop.

Everything here is drawn pixel by pixel at 1x with flat colours and a single
dark outline, matching the rest of the interface art. Sources land in
`assets-staging/ui/` and the frames are spliced straight into the packed atlas.

    python3 tools/make_icons.py

icon_trash  the sell target on the board rail. The previous bin was drawn in
            light greys, so on the dark deck it read as a white wireframe.
icon_book   opens the almanac.
icon_coin   the currency chip; the old one was a low-contrast blur.
icon_clock  the golden clock power-up that drifts across the screen.
icon_potion the red health flask that drifts across alongside it.

power_shuriken, power_smoke, power_charm, power_ward
            The four data-driven powerup tokens, which had been borrowing fx
            placeholder frames. Same 30x30 family as the clock and potion,
            each with the warm dark rim so the set reads as one family.
            Splice just these with:
                python3 tools/make_icons.py power_shuriken power_smoke power_charm power_ward

banner_name_9, panel_frame_9
            The nine-slice plates behind tier badges, title bars and almanac
            cells. The drop-in versions were bordered in light grey, which on
            the dark board read as a white wireframe around everything.

The icons are spliced into the packed atlas in place -- see patch_atlas().
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets-staging/ui"

OUTLINE = (33, 24, 20, 255)
SHADOW = (58, 44, 38, 255)


def canvas(width: int, height: int) -> Image.Image:
    return Image.new("RGBA", (width, height), (0, 0, 0, 0))


def row(image: Image.Image, y: int, x0: int, x1: int, color: tuple[int, int, int, int]) -> None:
    """Fill an inclusive horizontal run. Clipped to the canvas."""
    pixels = image.load()
    for x in range(max(0, x0), min(image.width - 1, x1) + 1):
        if 0 <= y < image.height:
            pixels[x, y] = color


def column(image: Image.Image, x: int, y0: int, y1: int, color: tuple[int, int, int, int]) -> None:
    pixels = image.load()
    for y in range(max(0, y0), min(image.height - 1, y1) + 1):
        if 0 <= x < image.width:
            pixels[x, y] = color


def trash_icon() -> Image.Image:
    """A dark-outlined bin with a red lid: reads as 'discard' at 24px."""
    body = (96, 92, 104, 255)
    body_lit = (126, 122, 136, 255)
    body_dark = (68, 64, 76, 255)
    lid = (198, 62, 58, 255)
    lid_lit = (232, 104, 92, 255)
    lid_dark = (150, 42, 42, 255)

    image = canvas(24, 27)

    # Handle.
    row(image, 0, 9, 14, OUTLINE)
    row(image, 1, 9, 14, lid)
    row(image, 2, 9, 14, lid_dark)

    # Lid: a flat slab a little wider than the bin.
    row(image, 3, 2, 21, OUTLINE)
    row(image, 4, 1, 22, OUTLINE)
    for y, fill in ((5, lid_lit), (6, lid), (7, lid_dark)):
        row(image, y, 1, 22, OUTLINE)
        row(image, y, 2, 21, fill)
    row(image, 8, 1, 22, OUTLINE)

    # Body: straight sides with a slight taper, ribbed.
    for y in range(9, 26):
        inset = 3 + (y - 9) // 8
        row(image, y, inset, 23 - inset, OUTLINE)
        row(image, y, inset + 1, 22 - inset, body)
        row(image, y, inset + 1, inset + 2, body_lit)
        row(image, y, 21 - inset, 22 - inset, body_dark)
    row(image, 26, 5, 18, OUTLINE)

    # Ribs.
    for x in (9, 13, 17):
        column(image, x, 11, 24, body_dark)
        column(image, x + 1, 11, 24, body_lit)

    return image


def book_icon() -> Image.Image:
    """A closed tome with a ribbon, for the almanac button."""
    cover = (170, 58, 54, 255)
    cover_lit = (208, 88, 78, 255)
    cover_dark = (124, 38, 40, 255)
    page = (238, 226, 188, 255)
    page_dark = (198, 180, 138, 255)
    gold = (247, 200, 84, 255)

    image = canvas(26, 26)

    # Outline box.
    row(image, 1, 3, 22, OUTLINE)
    row(image, 24, 3, 22, OUTLINE)
    column(image, 2, 2, 23, OUTLINE)
    column(image, 23, 2, 23, OUTLINE)

    # Cover.
    for y in range(2, 24):
        row(image, y, 3, 22, cover)
    for y in range(2, 24):
        row(image, y, 3, 4, cover_dark)  # spine side
        row(image, y, 21, 22, cover_lit)
    row(image, 2, 5, 22, cover_lit)
    row(image, 23, 3, 22, cover_dark)

    # Page block along the fore edge and foot.
    for y in range(3, 23):
        row(image, y, 19, 20, page)
    row(image, 22, 5, 20, page_dark)
    row(image, 21, 19, 20, page_dark)
    column(image, 18, 3, 22, OUTLINE)

    # Spine bands and a gold emblem.
    for y in (5, 11, 17):
        row(image, y, 3, 4, gold)
    for y in (10, 11, 12, 13):
        row(image, y, 10, 15, gold)
    row(image, 10, 10, 15, OUTLINE)
    row(image, 13, 10, 15, OUTLINE)
    column(image, 10, 10, 13, OUTLINE)
    column(image, 15, 10, 13, OUTLINE)

    # Ribbon marker.
    for y in range(24, 26):
        row(image, y, 13, 15, cover_dark)
    row(image, 25, 13, 15, SHADOW)

    return image


def disc(image: Image.Image, cx: float, cy: float, radius: float, color: tuple[int, int, int, int]) -> None:
    """Fill a hard-edged circle -- no anti-aliasing, so it stays pixel art."""
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
                pixels[x, y] = color


def coin_icon() -> Image.Image:
    """
    A bright gold mon coin -- round, dark-rimmed, square hole in the middle.

    The drop-in art was a soft low-contrast blob that dulled out against the
    bottom rail. Flat saturated gold with one hard highlight keeps it legible
    at 17px and on brand for a ninja game.
    """
    rim = (86, 48, 10, 255)
    gold_dark = (206, 132, 26, 255)
    gold = (250, 190, 44, 255)
    gold_lit = (255, 226, 122, 255)
    shine = (255, 252, 226, 255)

    size = 22
    image = canvas(size, size)
    center = (size - 1) / 2

    disc(image, center, center, 10.4, rim)
    disc(image, center, center, 9.3, gold_dark)
    disc(image, center, center, 8.4, gold)
    disc(image, center - 1.1, center - 1.3, 6.4, gold_lit)

    # Square hole, with its own dark edge so it never fills in visually.
    for y in range(8, 14):
        row(image, y, 8, 13, rim)
    for y in range(9, 13):
        row(image, y, 9, 12, gold_dark)
    for y in range(9, 13):
        row(image, y, 9, 12, rim)

    # One hard specular streak on the upper-left rim.
    row(image, 4, 8, 11, shine)
    row(image, 5, 6, 8, shine)
    row(image, 6, 5, 6, shine)

    return image


def clock_icon() -> Image.Image:
    """A golden pocket clock: bright rim, pale face, bold hands, top ring."""
    rim_dark = (92, 56, 12, 255)
    gold = (250, 190, 44, 255)
    gold_lit = (255, 228, 128, 255)
    face = (255, 248, 214, 255)
    face_shade = (226, 206, 152, 255)
    hands = (58, 38, 16, 255)

    size = 30
    image = canvas(size, size)
    center_x = (size - 1) / 2
    center_y = 17.0

    # Crown and ring on top.
    row(image, 0, 13, 16, rim_dark)
    row(image, 1, 13, 16, gold_lit)
    row(image, 2, 12, 17, gold)
    row(image, 3, 12, 17, rim_dark)

    disc(image, center_x, center_y, 12.4, rim_dark)
    disc(image, center_x, center_y, 11.2, gold)
    disc(image, center_x - 1.4, center_y - 1.6, 9.4, gold_lit)
    disc(image, center_x, center_y, 8.6, rim_dark)
    disc(image, center_x, center_y, 7.8, face)
    disc(image, center_x + 1.2, center_y + 1.4, 6.4, face_shade)
    disc(image, center_x, center_y, 6.6, face)

    # Hour marks at 12, 3, 6, 9.
    column(image, int(center_x), int(center_y) - 7, int(center_y) - 6, hands)
    column(image, int(center_x), int(center_y) + 6, int(center_y) + 7, hands)
    row(image, int(center_y), int(center_x) - 7, int(center_x) - 6, hands)
    row(image, int(center_y), int(center_x) + 6, int(center_x) + 7, hands)

    # Hands: one up, one to the right, so it reads as a clock at a glance.
    for offset in range(0, 6):
        row(image, int(center_y) - offset, int(center_x) - 1, int(center_x), hands)
    for offset in range(0, 5):
        column(image, int(center_x) + offset, int(center_y) - 1, int(center_y), hands)
    disc(image, center_x, center_y, 1.2, rim_dark)

    return image


def potion_icon() -> Image.Image:
    """
    A red healing flask: cork stopper, narrow neck, round belly, white cross.

    Drawn the same way as the clock so the two pickups read as a matched pair
    when they drift past each other. The cross is what makes it legible as
    health rather than as any other consumable, so it stays bright and blocky.
    """
    liquid_dark = (168, 32, 44, 255)
    liquid = (216, 52, 60, 255)
    liquid_lit = (248, 108, 104, 255)
    glass = (232, 236, 240, 255)
    cork = (168, 116, 62, 255)
    cork_dark = (118, 78, 40, 255)
    cross = (255, 252, 244, 255)

    size = 30
    image = canvas(size, size)
    center_x = (size - 1) / 2

    # Cork stopper.
    for y in (0, 4):
        row(image, y, 11, 18, OUTLINE)
    for y in (1, 2, 3):
        row(image, y, 11, 18, OUTLINE)
        row(image, y, 12, 17, cork if y < 3 else cork_dark)

    # Neck, with a glass highlight down its left side.
    for y in range(5, 11):
        row(image, y, 11, 18, OUTLINE)
        row(image, y, 12, 17, glass if y < 7 else liquid)
        column(image, 12, y, y, glass)

    # Belly: a disc with a dark rim, filled to just under the shoulders.
    disc(image, center_x, 19.5, 10.4, OUTLINE)
    disc(image, center_x, 19.5, 9.2, glass)
    disc(image, center_x, 19.5, 8.6, liquid)
    disc(image, center_x + 1.4, 21.0, 7.0, liquid_dark)
    disc(image, center_x, 19.5, 7.4, liquid)
    disc(image, center_x - 3.0, 16.4, 2.6, liquid_lit)

    # A cross, the universal "this heals you".
    for y in range(15, 24):
        row(image, y, 13, 16, cross)
    for y in range(18, 21):
        row(image, y, 10, 19, cross)

    return image


def shuriken_icon() -> Image.Image:
    """
    A four-point throwing star for the shuriken-frenzy powerup.

    The arms come from a taper formula so all four stay symmetric, then get
    the house one-pixel warm outline by dilating the body mask. Glints sit
    only on the two upper-left points so the light direction matches the
    coin's shine and the clock's bright rim.
    """
    rim = (58, 38, 20, 255)
    steel = (152, 158, 170, 255)
    steel_dark = (104, 110, 124, 255)
    glint = (240, 244, 250, 255)
    hub = (44, 32, 22, 255)

    size = 30
    image = canvas(size, size)
    pixels = image.load()

    def star(half: float) -> set[tuple[int, int]]:
        """Pixels of a four-armed star: wide bases tapering to needle tips."""
        points = set()
        for y in range(size):
            for x in range(size):
                dx, dy = x - 14.5, y - 14.5
                along, across = max(abs(dx), abs(dy)), min(abs(dx), abs(dy))
                if along <= 13.5 and across <= max(0.5, half * (1.0 - along / 14.2)):
                    points.add((x, y))
        return points

    body = star(5.2)
    outline = {
        (x + ox, y + oy)
        for x, y in body
        for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1))
        if 0 <= x + ox < size and 0 <= y + oy < size and (x + ox, y + oy) not in body
    }
    for x, y in outline:
        pixels[x, y] = rim
    for x, y in body:
        # Light from the upper-left, so the lower-right flank falls to shade.
        dx, dy = x - 14.5, y - 14.5
        pixels[x, y] = steel_dark if dx + dy >= 1 else steel
    for x, y in body:
        dx, dy = x - 14.5, y - 14.5
        if max(abs(dx), abs(dy)) >= 12.5 and dx + dy <= -12:
            pixels[x, y] = glint

    # Riveted hub where the four arms meet.
    disc(image, 14.5, 14.5, 2.5, rim)
    disc(image, 14.4, 14.4, 1.2, hub)

    return image


def smoke_bomb_icon() -> Image.Image:
    """
    A round smoke bomb for the boss-pause powerup.

    Cool slate so it stands apart from the gold clock and red potion in the
    same drift lane, but it keeps the warm brown outline so the pickup family
    still reads as one set. The spark is the only hot colour on it, which is
    where the eye should land.
    """
    rim = (58, 38, 20, 255)
    slate = (88, 100, 124, 255)
    slate_dark = (58, 66, 88, 255)
    slate_lit = (130, 148, 180, 255)
    edge = (176, 198, 228, 255)
    cord = (152, 104, 52, 255)
    cord_dark = (106, 70, 34, 255)
    spark = (255, 214, 84, 255)
    spark_hot = (255, 160, 48, 255)
    spark_core = (255, 248, 214, 255)
    wisp = (198, 202, 210, 255)
    wisp_soft = (152, 156, 166, 255)

    size = 30
    image = canvas(size, size)

    # A soft grey curl drifting off the spark.
    for x, y, color in ((20, 2, wisp_soft), (21, 1, wisp), (22, 1, wisp),
                        (23, 2, wisp), (23, 3, wisp_soft)):
        row(image, y, x, x, color)

    # Short fuse leaning right, spark burning at its tip.
    row(image, 3, 16, 19, rim)
    row(image, 3, 17, 18, spark)
    row(image, 4, 15, 18, rim)
    row(image, 4, 16, 16, spark_core)
    row(image, 4, 17, 17, spark_hot)
    for y, fill in ((5, cord), (6, cord_dark), (7, cord)):
        row(image, y, 14, 17, rim)
        row(image, y, 15, 16, fill)

    # Pellet: shaded low-right, with a cool rim-light hugging the upper-left.
    disc(image, 14.5, 18.0, 10.5, rim)
    disc(image, 14.5, 18.0, 9.4, slate)
    disc(image, 16.2, 20.0, 7.8, slate_dark)
    disc(image, 14.0, 17.3, 7.0, slate)
    disc(image, 11.0, 14.4, 2.4, slate_lit)
    for x, y in ((11, 10), (9, 11), (8, 13), (7, 15), (6, 17)):
        row(image, y, x, x, edge)

    return image


def charm_icon() -> Image.Image:
    """
    An omamori lucky charm for the coin-multiplier powerup.

    The warm red body and gold trim are the same family as the book cover and
    the coin, so "lucky" reads at a glance next to the currency chip it
    boosts. The single diamond stitch keeps the front from reading as a plain
    red blob once Phaser scales it down onto the HUD chip.
    """
    rim = (74, 42, 14, 255)
    red = (198, 62, 52, 255)
    red_lit = (232, 100, 84, 255)
    red_dark = (142, 40, 38, 255)
    gold = (247, 200, 84, 255)
    gold_lit = (255, 228, 128, 255)
    gold_dark = (206, 132, 26, 255)

    size = 30
    image = canvas(size, size)

    # Cord loop at the top, lit along its upper-left edge.
    disc(image, 14.5, 3.9, 3.3, rim)
    disc(image, 14.5, 3.9, 2.2, gold_dark)
    disc(image, 14.5, 3.9, 0.8, rim)
    row(image, 2, 13, 13, gold_lit)
    row(image, 3, 12, 12, gold_lit)

    # Pouch silhouette: rounded shoulders, gentle taper, rounded foot.
    rows = {
        8: (11, 18), 9: (9, 20), 10: (8, 21), 11: (7, 22), 12: (7, 22),
        13: (6, 23), 14: (6, 23), 15: (6, 23), 16: (6, 23), 17: (6, 23),
        18: (6, 23), 19: (6, 23), 20: (6, 23), 21: (6, 23), 22: (6, 23),
        23: (7, 22), 24: (8, 21), 25: (9, 20), 26: (11, 18), 27: (13, 16),
    }
    for y, (x0, x1) in rows.items():
        row(image, y, x0, x1, rim)
        row(image, y, x0 + 1, x1 - 1, red)
        row(image, y, x0 + 1, x0 + 1, red_lit)
        row(image, y, x1 - 1, x1 - 1, red_dark)
    for y in range(13, 22):
        row(image, y, rows[y][0] + 2, rows[y][0] + 2, red_lit)
    for y in range(24, 28):
        x0, x1 = rows[y]
        row(image, y, x0 + 1, x0 + 1, red_lit)
        row(image, y, x0 + 2, x1 - 1, red_dark)

    # Gold trim band under the shoulders.
    row(image, 12, rows[12][0] + 1, rows[12][1] - 1, gold_lit)
    row(image, 13, rows[13][0] + 1, rows[13][1] - 1, gold)
    row(image, 14, rows[14][0] + 1, rows[14][1] - 1, gold_dark)

    # One gold diamond stitch on the front.
    row(image, 18, 14, 15, gold)
    row(image, 19, 13, 16, gold)
    row(image, 20, 14, 15, gold)
    row(image, 19, 14, 14, gold_lit)

    return image


def ward_icon() -> Image.Image:
    """
    A ward talisman: jade face inside a gold border, for the charge-blocking
    protective ward.

    Jade leans on the powerup's green hud accent while the gold border ties it
    to the clock and charm; the pale chevron is the one mark that has to
    survive the HUD chip scale, so it stays blocky and centred.
    """
    rim = (74, 42, 14, 255)
    gold = (247, 200, 84, 255)
    jade = (56, 164, 108, 255)
    jade_lit = (104, 208, 148, 255)
    jade_dark = (34, 118, 80, 255)
    rune = (222, 246, 226, 255)

    size = 30
    image = canvas(size, size)

    # Shield silhouette: broad shoulders tapering to a foot point.
    rows = {
        3: (13, 16), 4: (11, 18), 5: (9, 20), 6: (8, 21), 7: (7, 22),
        8: (6, 23), 9: (6, 23), 10: (6, 23), 11: (6, 23), 12: (6, 23),
        13: (6, 23), 14: (6, 23), 15: (7, 22), 16: (7, 22), 17: (8, 21),
        18: (8, 21), 19: (9, 20), 20: (10, 19), 21: (11, 18), 22: (12, 17),
        23: (13, 16), 24: (14, 15),
    }
    for y, (x0, x1) in rows.items():
        row(image, y, x0, x1, rim)  # warm outline around the gold band
        row(image, y, x0 + 1, x1 - 1, gold)
        if x0 + 3 <= x1 - 3:
            row(image, y, x0 + 3, x0 + 3, jade_lit if y <= 14 else jade)
            row(image, y, x0 + 4, x1 - 4, jade)
            row(image, y, x1 - 3, x1 - 3, jade_dark if y >= 6 else jade)

    # Pale rune chevron engraved on the face.
    row(image, 10, 10, 11, rune)
    row(image, 10, 18, 19, rune)
    row(image, 11, 11, 12, rune)
    row(image, 11, 17, 18, rune)
    row(image, 12, 12, 13, rune)
    row(image, 12, 16, 17, rune)
    row(image, 13, 13, 16, rune)

    return image


def favicon() -> Image.Image:
    """
    The browser-tab mark: the Orbit Gate arch with its portal, at 32px.

    Drawn rather than downscaled from the logo -- the logo's fine detail turns
    to mush at tab size, so this keeps only the three shapes that read small:
    arch, portal, keystone.
    """
    space = (13, 19, 39, 255)
    stone = (94, 108, 134, 255)
    stone_lit = (140, 156, 184, 255)
    cyan = (78, 226, 226, 255)
    portal_dark = (58, 22, 96, 255)
    portal = (126, 58, 208, 255)
    portal_lit = (176, 108, 240, 255)
    core = (232, 196, 255, 255)
    gold = (240, 185, 63, 255)

    size = 32
    image = canvas(size, size)
    for y in range(size):
        row(image, y, 0, size - 1, space)

    center = 15.5
    # Arch: a stone ring with a cyan inner rim.
    disc(image, center, 16, 13.2, stone)
    disc(image, center, 16, 12.0, stone_lit)
    disc(image, center, 16, 10.6, cyan)
    disc(image, center, 16, 9.4, space)

    # Portal.
    disc(image, center, 16, 8.4, portal_dark)
    disc(image, center, 16, 7.0, portal)
    disc(image, center - 0.8, 15.2, 4.6, portal_lit)
    disc(image, center, 16, 2.0, core)
    disc(image, center + 0.6, 16.6, 1.2, portal_dark)

    # Pillars planted either side, and a gold keystone on top.
    for x0 in (2, 27):
        for y in range(17, 30):
            row(image, y, x0, x0 + 2, stone)
            row(image, y, x0 + 1, x0 + 1, stone_lit)
    row(image, 30, 2, 4, stone_lit)
    row(image, 30, 27, 29, stone_lit)
    row(image, 1, 13, 18, gold)
    row(image, 2, 12, 19, gold)
    row(image, 3, 13, 18, stone_lit)

    return image


def plate(width: int, height: int, border: int) -> Image.Image:
    """
    A nine-slice plate: dark outline, warm bronze border, dark wood fill.

    Uniform along each edge so the middle bands stretch cleanly, and rounded by
    a single pixel at the corners to match the rest of the interface art.
    """
    outline = (20, 15, 10, 255)
    edge_top = (154, 106, 62, 255)
    edge = (122, 82, 48, 255)
    edge_bottom = (74, 47, 26, 255)
    fill = (43, 31, 22, 255)
    fill_top = (58, 42, 30, 255)

    image = canvas(width, height)
    for y in range(height):
        for x in range(width):
            depth = min(x, y, width - 1 - x, height - 1 - y)
            if depth == 0:
                color = outline
            elif depth <= border:
                color = edge_top if y <= border else edge_bottom if y >= height - 1 - border else edge
            else:
                color = fill_top if y == border + 1 else fill
            image.load()[x, y] = color

    # Nip the corners so the plate reads as rounded, not as a hard box.
    pixels = image.load()
    for cx, cy in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        pixels[cx, cy] = (0, 0, 0, 0)

    return image


def patch_atlas(icons: dict[str, Image.Image]) -> None:
    """
    Splice the icons into the shipped atlas instead of repacking it.

    `pack_atlas.py` rebuilds every frame from `assets-staging/rigs`, which now
    holds a different character set than the one in the shipped sheet -- a full
    repack would silently swap all twelve ninjas and six bosses. Adding a shelf
    at the bottom of the existing page touches nothing else.
    """
    atlas_png = ROOT / "public/assets/game.png"
    atlas_json = ROOT / "public/assets/game.json"
    data = json.loads(atlas_json.read_text())
    sheet = Image.open(atlas_png).convert("RGBA")

    pad = 4
    shelf_height = max(image.height for image in icons.values())
    page = Image.new("RGBA", (sheet.width, sheet.height + shelf_height + pad), (0, 0, 0, 0))
    page.paste(sheet, (0, 0))

    x = pad
    top = sheet.height + pad
    for key, image in icons.items():
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
    print(f"atlas: {len(data['frames'])} frames, {page.width}x{page.height}, {atlas_png.stat().st_size // 1024} KB")


def export_textures(icons: dict[str, Image.Image]) -> None:
    """
    Mirror the powerup icons out as standalone textures.

    `src/data/powerups.ts` points BootScene at one PNG per powerup under
    `public/assets/powerups/`, so each of these ships twice: as an atlas
    frame and as its own file. Keeping both outputs in this one tool is what
    stops the two copies from drifting apart.
    """
    out = ROOT / "public/assets/powerups"
    out.mkdir(parents=True, exist_ok=True)
    for key, name in (
        ("power_shuriken", "shuriken-frenzy"),
        ("power_smoke", "smoke-bomb"),
        ("power_charm", "lucky-charm"),
        ("power_ward", "protective-ward"),
    ):
        if key in icons:
            icons[key].save(out / f"{name}.png")
            print(f"{key}: {icons[key].width}x{icons[key].height} -> {out / f'{name}.png'}")


def main() -> None:
    only = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    icons = {
        "icon_trash": trash_icon(),
        "icon_book": book_icon(),
        "icon_coin": coin_icon(),
        "icon_clock": clock_icon(),
        "icon_potion": potion_icon(),
        "power_shuriken": shuriken_icon(),
        "power_smoke": smoke_bomb_icon(),
        "power_charm": charm_icon(),
        "power_ward": ward_icon(),
        # Same frame sizes and slice margins as the art they replace.
        "banner_name_9": plate(32, 25, 2),
        "panel_frame_9": plate(28, 28, 3),
    }
    if only:
        # Naming icons on the command line splices just those into the shipped
        # atlas, leaving every other frame untouched.
        unknown = [name for name in only if name not in icons]
        if unknown:
            raise SystemExit(f"no such icon: {', '.join(unknown)}")
        icons = {name: icons[name] for name in only}
    for name, image in icons.items():
        image.save(OUT / f"{name}.png")
        print(f"{name}: {image.width}x{image.height} -> {OUT / f'{name}.png'}")
    patch_atlas(icons)
    export_textures(icons)
    if only:
        return

    # The tab icon is not an atlas frame; it ships as its own file.
    mark = favicon()
    favicon_path = ROOT / "public/favicon.png"
    mark.save(favicon_path)
    mark.resize((mark.width * 4, mark.height * 4), Image.NEAREST).save(ROOT / "public/favicon-128.png")
    print(f"favicon: {mark.width}x{mark.height} -> {favicon_path}")


if __name__ == "__main__":
    main()
