"""Slice the supplied asset atlas (bezel, stone tiles, dark backdrop, gears).

Each piece needs a different key: the bezel and its corners sit on light grey and
must also lose the hollow middle, the stone tiles sit on a transparency
checkerboard, the gears sit on magenta, and the seamless backdrop is cropped
whole because keying a dark texture off a dark sheet would eat it.
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/derek/Desktop/crazygames/merge-ninja")
SHEET = ROOT / "assets-staging/source/atlas_v1.png"
GATE_SHEET = ROOT / "assets-staging/source/atlas_gate.png"
OUT = ROOT / "assets-staging/ui"
TEX = ROOT / "public/assets/tex"

BOXES = {
    "frame_bezel": ((584, 76, 238, 176), "light"),
    "frame_corner_l": ((833, 76, 38, 42), "light"),
    "frame_corner_r": ((973, 77, 38, 41), "light"),
    "tile_stone": ((17, 77, 71, 58), "checker"),
    "tile_stone_grid": ((275, 76, 138, 142), "checker"),
    "gears": ((865, 211, 147, 182), "magenta"),
}
BG_TEXTURE = (17, 185, 205, 206)

# Second sheet: the orbital gate that frames the portal.
# The full gate is a complete hollow structure, so the separate pillar and arch
# components are not needed; their crops also overlap the sheet's caption boxes.
GATE_BOXES = {
    "gate_full": ((17, 138, 298, 253), "gate"),
}

# Gears are found by connected component rather than by hand-measured cells, which
# clipped them; they are then named small/large by area.


def alpha_from(mask: np.ndarray, rgb: np.ndarray) -> Image.Image | None:
    img = Image.fromarray(np.dstack([rgb.astype(np.uint8), (mask * 255).astype(np.uint8)]), "RGBA")
    box = img.getbbox()
    return img.crop(box) if box else None


def key(cell: Image.Image, mode: str) -> Image.Image | None:
    rgb = np.asarray(cell.convert("RGB")).astype(int)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)

    if mode == "magenta":
        magenta = (rgb[:, :, 0] > 140) & (rgb[:, :, 2] > 140) & (rgb[:, :, 1] < 125)
        keep = ~magenta
        # Anti-aliasing leaves a pink rim; shave rings of near-magenta pixels that
        # touch transparency until the edge is clean art.
        rim = (rgb[:, :, 0] > 100) & (rgb[:, :, 2] > 100) & (rgb[:, :, 1] < 160)
        for _ in range(3):
            exposed = keep & ~ndimage.binary_erosion(keep, border_value=0)
            keep &= ~(exposed & rim)
    elif mode == "gate":
        # Drawn on a transparency checkerboard whose grid lines cross the art, so
        # the neutral light colour is removed everywhere rather than by component.
        keep = ~((rgb.min(axis=2) > 176) & (saturation < 30))
        # Leftover checkerboard dots survive as specks; keep only real structure.
        labels, count = ndimage.label(keep, np.ones((3, 3)))
        if count:
            areas = np.bincount(labels.ravel())
            areas[0] = 0
            keep = np.isin(labels, np.flatnonzero(areas > areas.max() * 0.02))
    elif mode == "checker":
        # The checkerboard is neutral; the stone is warm, so saturation separates them.
        keep = (saturation >= 12) | (rgb.min(axis=2) < 150)
        keep = ndimage.binary_closing(keep, np.ones((3, 3)))
        keep = ndimage.binary_fill_holes(keep)
        # The checkerboard blends into the tile's edge; shave the pale rim it leaves.
        pale = (rgb.min(axis=2) > 178) & (saturation < 30)
        for _ in range(2):
            exposed = keep & ~ndimage.binary_erosion(keep, border_value=0)
            keep &= ~(exposed & pale)
    else:
        # Frame art is mid grey on a near-white sheet; the hollow middle is near-white
        # too and must drop out, so this keys globally rather than flooding inward.
        keep = ~((rgb.min(axis=2) > 195) & (saturation < 22))
        keep = ndimage.binary_closing(keep, np.ones((3, 3)))
        biggest = ndimage.label(keep)[0]
        if biggest.max():
            counts = np.bincount(biggest.ravel())
            counts[0] = 0
            keep = biggest == counts.argmax()
    return alpha_from(keep, rgb)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TEX.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGB")

    for name, ((x, y, w, h), mode) in BOXES.items():
        piece = key(sheet.crop((x, y, x + w, y + h)), mode)
        if piece is None:
            print(f"  !! {name} keyed to nothing")
            continue
        if name == "gears":
            alpha = np.asarray(piece)[:, :, 3] > 0
            labels, count = ndimage.label(alpha, np.ones((3, 3)))
            found = []
            for index, slices in enumerate(ndimage.find_objects(labels), start=1):
                if (labels[slices] == index).sum() < 250:
                    continue
                cut = piece.crop((slices[1].start, slices[0].start, slices[1].stop, slices[0].stop))
                found.append(cut)
            found.sort(key=lambda c: c.width * c.height)
            sizes = ["small_a", "small_b", "large_a", "large_b"]
            for cut, label in zip(found, sizes):
                cut.save(OUT / f"prop_gear_{label}.png")
                print(f"prop_gear_{label} {cut.size}")
            continue
        piece.save(OUT / f"{name}.png")
        print(f"{name} {piece.size}")

    gate_sheet = Image.open(GATE_SHEET).convert("RGB")
    for name, ((x, y, w, h), mode) in GATE_BOXES.items():
        piece = key(gate_sheet.crop((x, y, x + w, y + h)), mode)
        if piece is None:
            print(f"  !! {name} keyed to nothing")
            continue
        piece.save(OUT / f"{name}.png")
        print(f"{name} {piece.size}")

    x, y, w, h = BG_TEXTURE
    sheet.crop((x + 3, y + 3, x + w - 3, y + h - 3)).save(TEX / "tex_industrial.png")
    print(f"tex_industrial {(w - 6, h - 6)}")


if __name__ == "__main__":
    main()
