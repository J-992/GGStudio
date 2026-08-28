"""
Draws the locked-slot tile: the board's own stone pad, chained shut.

    python3 tools/make_locked_tile.py

The slot the player has not earned yet used to be the ordinary bright stone pad
with two brown bars laid over it in `Graphics`. Playtesting killed it: the bars
read as decoration on a perfectly usable tile, not as a barrier, because the
stone underneath was exactly as warm and inviting as the eleven live ones.

So the state is drawn into the art instead of over it. Three things carry it,
in the order a player notices them:

  1. the stone goes cold and dark -- a dead slot, before any icon is read;
  2. a heavy iron chain crosses it along the tile's own isometric axes, so it
     lies *on* the slab rather than floating in screen space;
  3. a padlock sits on the crossing, which is the word "locked" with no text.

Authored at 69x48 -- byte for byte the footprint of `tile_stone` -- so the
locked pad is a texture swap on the same image at the same scale, and every
pixel lands on the same grid as the rest of the board art.

Output: `public/assets/slot-locked.webp` (lossless).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS_WEBP = ROOT / "public/assets/game.webp"
ATLAS_JSON = ROOT / "public/assets/game.json"
OUT = ROOT / "public/assets/slot-locked.webp"

# --- palette -----------------------------------------------------------------
# Iron, not the dojo's warm woods: the chain is the one thing on the board that
# is deliberately foreign to the skin, because it is the one thing that is not
# part of the dojo.
OUTLINE = (24, 18, 16, 255)
IRON_DARK = (58, 56, 62, 255)
IRON = (98, 96, 104, 255)
IRON_LIT = (168, 170, 180, 255)
GOLD = (214, 165, 60, 255)

# How far the cold stone is pushed from the live pad's warm ivory.
CHILL = 0.56
COOL = (0.86, 0.92, 1.06)


def cold_stone() -> Image.Image:
    """The live pad, drained: darker, and pulled from ivory towards slate."""
    frames = json.loads(ATLAS_JSON.read_text())["frames"]
    box = frames["tile_stone"]["frame"]
    tile = Image.open(ATLAS_WEBP).convert("RGBA").crop(
        (box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]),
    )
    px = tile.load()
    for y in range(tile.height):
        for x in range(tile.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (
                min(255, int(r * CHILL * COOL[0])),
                min(255, int(g * CHILL * COOL[1])),
                min(255, int(b * CHILL * COOL[2])),
                a,
            )
    return tile


# --- chain -------------------------------------------------------------------
# The tile is 69x48 with its top face spanning the full width, so one step
# right is half a step down: the two chain runs travel (2, 1) and (2, -1) and
# therefore sit flat on the slab instead of lying across the screen.
CROSS = (34.0, 20.0)
REACH = 42.0
RUNS = ((2.0, 1.0), (2.0, -1.0))
LINK_PITCH = 5.8

# A link lying face-on and the next one stood on edge. Alternating the two is
# the whole trick: a chain drawn as one repeated shape reads as a dashed line.
# Both were grown once the first cut shipped -- at four pixels across, the
# links were reading as grit on the stone rather than as iron holding it shut.
FLAT = (4.4, 2.9)
EDGE = (2.7, 3.1)
RING = (1.5, 1.1)


def draw_chain(canvas: Image.Image) -> None:
    px = canvas.load()
    w, h = canvas.size

    def link(cx: float, cy: float, angle: float, axes: tuple[float, float]) -> None:
        a, b = axes
        cos, sin = math.cos(-angle), math.sin(-angle)
        for iy in range(int(cy) - 6, int(cy) + 7):
            for ix in range(int(cx) - 7, int(cx) + 8):
                if not (0 <= ix < w and 0 <= iy < h) or px[ix, iy][3] == 0:
                    continue
                dx, dy = ix - cx, iy - cy
                u = dx * cos - dy * sin
                v = dx * sin + dy * cos
                outer = (u / a) ** 2 + (v / b) ** 2
                inner = (u / (a - RING[0])) ** 2 + (v / (b - RING[1])) ** 2
                if outer > 1.0:
                    # A dark rim on every link, so links touching each other
                    # still read as two objects and not as one blob.
                    if outer < 1.55:
                        px[ix, iy] = OUTLINE
                elif inner >= 1.0:
                    px[ix, iy] = IRON_LIT if v < -0.6 else (IRON if v < 1.1 else IRON_DARK)

    for dx, dy in RUNS:
        angle = math.atan2(dy, dx)
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        count = int(REACH / LINK_PITCH)
        for i in range(-count, count + 1):
            travel = i * LINK_PITCH
            flat = i % 2 == 0
            link(
                CROSS[0] + ux * travel,
                CROSS[1] + uy * travel,
                angle if flat else angle + math.pi / 2,
                FLAT if flat else EDGE,
            )


# --- padlock -----------------------------------------------------------------
# Drawn as a grid, because a padlock this small has no room for a pixel in the
# wrong place. Deliberately flat: five colours, a symmetrical body, and no
# shading inside the shackle. The first cut carried a highlight ramp and an
# off-centre keyhole, which at fifteen pixels across read as a smudge rather
# than as an object -- detail is what distorts a sprite this size, not what
# saves it.
LOCK_ART = (
    ".....OOOOO.....",
    "....OsssssO....",
    "...OssOOOssO...",
    "...OsO...OsO...",
    "...OsO...OsO...",
    "...OsO...OsO...",
    "...OsO...OsO...",
    "OOOOOOOOOOOOOOO",
    "OsssssssssssssO",
    "OsDDDDDDDDDDDsO",
    "OsDDDDKKKDDDDsO",
    "OsDDDDKKKDDDDsO",
    "OsDDDDDKDDDDDsO",
    "OsDDDDDKDDDDDsO",
    "OsDDDDDDDDDDDsO",
    "OsssssssssssssO",
    "OOOOOOOOOOOOOOO",
)
LOCK_COLOURS = {
    "O": OUTLINE,
    "s": IRON_LIT,
    "D": IRON_DARK,
    "K": GOLD,
}
# Just right of the crossing and just below it, the way a lock hangs off the
# chain it closes rather than sitting on top of it like a badge.
LOCK_AT = (30, 13)


def draw_lock(canvas: Image.Image, stone: Image.Image) -> None:
    """
    The lock is in front of the chain, so it clears what it stands on.

    Blank cells in the grid are painted back from the bare stone rather than
    left alone: without that, chain links show through the gap inside the
    shackle and the whole silhouette collapses into one dark smudge.
    """
    px = canvas.load()
    bare = stone.load()
    w, h = canvas.size
    for row, line in enumerate(LOCK_ART):
        for col, key in enumerate(line):
            x, y = LOCK_AT[0] + col, LOCK_AT[1] + row
            if not (0 <= x < w and 0 <= y < h) or px[x, y][3] == 0:
                continue
            colour = LOCK_COLOURS.get(key)
            px[x, y] = bare[x, y] if colour is None else colour


def main() -> None:
    tile = cold_stone()
    stone = tile.copy()
    draw_chain(tile)
    draw_lock(tile, stone)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tile.save(OUT, "WEBP", lossless=True)
    print(f"{OUT.relative_to(ROOT)}  {tile.width}x{tile.height}  {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
