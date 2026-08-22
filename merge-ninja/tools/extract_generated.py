"""Turn the generated background art into game-ready assets.

The generated pieces arrive at 2048px on a black field. Each is keyed off that
black, trimmed, and scaled down to the size the arena actually draws it at —
downscaling also tightens the pixel grid, which the generator only approximates.
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/derek/Desktop/crazygames/merge-ninja")
SRC = ROOT / "assets-staging/source"
OUT = ROOT / "assets-staging/ui"

# name: (source file, target width). Height follows the aspect ratio.
PIECES = {
    "bg_floor": ("hf_floor.png", 900),
    "bg_ledge_desert": ("hf_desert.png", 300),
    "bg_ledge_jungle": ("hf_jungle.png", 300),
}
BLACK_CUTOFF = 34
WALL_SOURCE = "hf_wall3.png"
WALL_SIZE = 256


def key_black(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(int)
    dark = rgb.max(axis=2) <= BLACK_CUTOFF

    # Only black connected to the edge is background; dark pixels inside the art
    # (a shadowed rock face) must survive.
    seeds = np.zeros(dark.shape, bool)
    seeds[0, :] = seeds[-1, :] = seeds[:, 0] = seeds[:, -1] = True
    labels, count = ndimage.label(dark)
    background = np.isin(labels, np.unique(labels[seeds & dark])) if count else np.zeros(dark.shape, bool)

    keep = ~background
    # Shave the compression halo the generator leaves around the silhouette.
    murky = rgb.max(axis=2) <= 70
    for _ in range(2):
        exposed = keep & ~ndimage.binary_erosion(keep, border_value=0)
        keep &= ~(exposed & murky)

    out = Image.fromarray(np.dstack([rgb.astype(np.uint8), (keep * 255).astype(np.uint8)]), "RGBA")
    box = out.getbbox()
    return out.crop(box) if box else out


def make_tileable(img: Image.Image, size: int) -> Image.Image:
    """Build a seam-free tile by mirroring one quadrant four ways.

    The generator never quite closes a texture's edges, and a visible seam repeated
    across a whole wall is far more noticeable than the symmetry mirroring costs.
    """
    quadrant = img.convert("RGB").crop((0, 0, min(img.width, img.height), min(img.width, img.height)))
    quadrant = quadrant.resize((size // 2, size // 2), Image.LANCZOS)
    tile = Image.new("RGB", (size, size))
    tile.paste(quadrant, (0, 0))
    tile.paste(quadrant.transpose(Image.FLIP_LEFT_RIGHT), (size // 2, 0))
    tile.paste(quadrant.transpose(Image.FLIP_TOP_BOTTOM), (0, size // 2))
    tile.paste(quadrant.transpose(Image.ROTATE_180), (size // 2, size // 2))
    return tile


def main() -> None:
    for name, (filename, width) in PIECES.items():
        source = SRC / filename
        if not source.exists():
            print(f"  !! missing {filename}")
            continue
        piece = key_black(Image.open(source))
        height = max(1, round(piece.height * width / piece.width))
        piece.resize((width, height), Image.LANCZOS).save(OUT / f"{name}.png")
        print(f"{name} {width}x{height} (from {piece.size})")

    wall = SRC / WALL_SOURCE
    if wall.exists():
        target = ROOT / "public/assets/tex/tex_wall.png"
        make_tileable(Image.open(wall), WALL_SIZE).save(target)
        print(f"tex_wall {WALL_SIZE}x{WALL_SIZE} -> {target.name}")


if __name__ == "__main__":
    main()
