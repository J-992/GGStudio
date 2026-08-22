#!/usr/bin/env python3
"""Alpha decontamination for the standalone character strips.

The extraction pipeline flood-keys white from the sheet edges and erodes
halos afterwards, but JPEG-sourced pixels keep semi-transparent fringes
whose RGB is still white-ish -> white halos around characters on bright
backgrounds. This tool fixes both problems:

1. Unpremultiply: every pixel with 0 < alpha < 255 gets its RGB divided by
   (alpha / 255) and clamped, so fringe pixels carry real colour instead of
   leftover white matte.
2. Conservative edge shave: ONE pass that clears the alpha of semi-
   transparent pixels directly adjacent (4-neighbourhood) to a fully
   transparent pixel. Opaque pixels are never touched, so intentional
   white outlines/highlights INSIDE the art survive untouched.

Dry-run (default) prints changed-pixel counts per file; --apply rewrites
the PNGs in place. Dimensions and frame layouts are never altered.

Usage:
    python3 tools/defringe.py            # dry run
    python3 tools/defringe.py --apply    # rewrite files
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"

PATTERNS = [
    "ninja-catalog-*.png",
    "ninja-motion-t*.png",
    "ninja-ready-t*.png",
    "provided-*.png",
    "boss-catalog-*.png",
    "boss-rig-*.png",
    "boss-ready-*.png",
    "samurai-ready.png",
]


def collect_files() -> list[Path]:
    seen: set[Path] = set()
    files: list[Path] = []
    for pattern in PATTERNS:
        for path in sorted(ASSETS.glob(pattern)):
            if path not in seen:
                seen.add(path)
                files.append(path)
    return files


def defringe(path: Path) -> tuple[int, int]:
    """Returns (pixels changed, total pixels examined)."""
    im = Image.open(path).convert("RGBA")
    data = np.asarray(im).copy()
    rgb = data[..., :3].astype(np.float32)
    alpha = data[..., 3]

    semi = (alpha > 0) & (alpha < 255)

    # 1. Unpremultiply: undo the alpha falloff so fringe RGB carries real
    #    colour instead of the white matte it was keyed against.
    safe_alpha = np.maximum(alpha, 1).astype(np.float32)
    factor = 255.0 / safe_alpha[..., None]
    unpremultiplied = np.clip(rgb * factor, 0.0, 255.0)
    rgb_changed = np.zeros_like(semi)
    rgb_changed[semi] = np.abs(unpremultiplied - rgb)[semi].max(axis=-1) > 0.5

    # 2. One-pass conservative shave: kill only semi-transparent pixels that
    #    touch a fully transparent neighbour (the visible fringe ring).
    transparent = alpha == 0
    touches_transparent = np.zeros_like(transparent)
    touches_transparent[1:, :] |= transparent[:-1, :]
    touches_transparent[:-1, :] |= transparent[1:, :]
    touches_transparent[:, 1:] |= transparent[:, :-1]
    touches_transparent[:, :-1] |= transparent[:, 1:]
    shaved = semi & touches_transparent

    changed = int((rgb_changed & ~shaved).sum() + shaved.sum())

    if APPLY:
        merged = np.empty_like(data)
        merged[..., :3] = np.where(
            semi[..., None], unpremultiplied.round().astype(np.uint8), data[..., :3]
        )
        merged[..., 3] = np.where(shaved, 0, alpha)
        Image.fromarray(merged, "RGBA").save(path, optimize=True)
    return changed, data.shape[0] * data.shape[1]


def main() -> None:
    global APPLY
    APPLY = "--apply" in sys.argv
    total_files = 0
    total_pixels = 0
    print(f"{'file':<34} {'changed':>9} {'of px':>11}")
    for path in collect_files():
        changed, total = defringe(path)
        total_files += 1
        total_pixels += changed
        flag = "written" if APPLY and changed else ("clean" if changed == 0 else "")
        print(f"{path.name:<34} {changed:>9} {total:>11} {flag}")
    print(f"\nfiles: {total_files}  pixels changed: {total_pixels}  mode: {'APPLY' if APPLY else 'DRY-RUN'}")


if __name__ == "__main__":
    main()
