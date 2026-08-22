"""Slice the two ninja sprite sheets into individual transparent PNGs.

The sheets are JPEGs: 8 columns x 3 rows of chibi sprites on white, with thin grid
lines and a small index number in each cell. Sheet 2's last two rows of column 8
hold one double-height boss.

Per cell: flood-fill near-white inward from the border (so white *inside* a sprite,
like a fox mask, survives), drop leftover specks such as the index number and grid
fragments, then trim to the sprite's bounding box.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

COLS, ROWS = 8, 3
INSET = 5                   # px trimmed off each cell to clear the printed grid line
WHITE_CUTOFF = 206          # JPEG ringing spreads "white" well below 255
HALO_CUTOFF = 200           # edge pixels at least this light are compression halo
HALO_PASSES = 2             # each pass shaves one ring of halo off the silhouette
SPECK_FRACTION = 0.04       # keep blobs >= 4% of the biggest blob in the cell
# Sheet b's boss is drawn free-standing across the last two rows, wider than a cell.
BOSS_BOX = (828, 140, 1024, 409)
OUT = Path("/Users/derek/Desktop/crazygames/merge-ninja/assets-staging/sprites")


def cut(sheet: Image.Image, col: int, row: int, row_span: int = 1) -> Image.Image:
    cw, ch = sheet.width / COLS, sheet.height / ROWS
    # Inset past the printed grid lines: left intact they close a frame around the
    # cell, and the border flood fill can never reach the white inside it.
    box = (round(col * cw) + INSET, round(row * ch) + INSET,
           round((col + 1) * cw) - INSET, round((row + row_span) * ch) - INSET)
    return sheet.crop(box)


def isolate(cell: Image.Image) -> Image.Image | None:
    rgb = np.asarray(cell.convert("RGB")).astype(np.int16)
    light = rgb.min(axis=2) >= WHITE_CUTOFF

    # Background = light pixels reachable from the cell border.
    seeds = np.zeros_like(light)
    seeds[0, :] = seeds[-1, :] = seeds[:, 0] = seeds[:, -1] = True
    labels, n = ndimage.label(light)
    background = np.isin(labels, np.unique(labels[seeds & light])) if n else np.zeros_like(light)

    solid = ~background

    # The flood stops at the first pixel too dark to count as background, which on a
    # JPEG leaves a bright halo hugging the silhouette. Shave rings of light pixels
    # that touch transparency; real art sits behind a dark outline and survives.
    light_edge = rgb.min(axis=2) >= HALO_CUTOFF
    for _ in range(HALO_PASSES):
        exposed = solid & ~ndimage.binary_erosion(solid, border_value=0)
        solid &= ~(exposed & light_edge)

    # Background sealed inside the silhouette (between the boss's flames, under its
    # base) never touches the border, so the flood misses it. Drop pockets that are
    # uniformly paper-white; painted whites like ice armour carry shading and stay.
    paper = rgb.min(axis=2) >= 245
    pockets, pocket_count = ndimage.label(paper & solid)
    for index in range(1, pocket_count + 1):
        pocket = pockets == index
        if pocket.sum() >= 12 and not (light_edge & ~paper & ndimage.binary_dilation(pocket) & solid).any():
            solid &= ~pocket

    blobs, count = ndimage.label(solid)
    if not count:
        return None

    # Index numbers and grid slivers survive the fill as tiny islands; drop them.
    sizes = ndimage.sum(solid, blobs, range(1, count + 1))
    keep = {i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * SPECK_FRACTION}
    solid = np.isin(blobs, list(keep))
    if not solid.any():
        return None

    out = np.dstack([np.asarray(cell.convert("RGB")), (solid * 255).astype(np.uint8)])
    img = Image.fromarray(out, "RGBA")
    return img.crop(img.getbbox())


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {
        "a": Image.open("/Users/derek/Downloads/assset_ninja_1.jpeg"),
        "b": Image.open("/Users/derek/Downloads/asset_ninja_2.jpeg"),
    }

    written = 0
    for tag, sheet in sheets.items():
        for row in range(ROWS):
            for col in range(COLS):
                if tag == "b" and col == COLS - 1 and row in (1, 2):
                    if row == 2:
                        continue
                    sprite, name = isolate(sheet.crop(BOSS_BOX)), f"{tag}_boss"
                else:
                    sprite, name = isolate(cut(sheet, col, row)), f"{tag}_{row}{col}"
                if sprite is None:
                    continue
                sprite.save(OUT / f"{name}.png")
                print(f"{name}.png {sprite.width}x{sprite.height}")
                written += 1

    print(f"\n{written} sprites -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
