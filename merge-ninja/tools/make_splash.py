#!/usr/bin/env python3
"""
Prepares the loading screen from the authored key art.

The art in `art-source/loading-screen.png` arrives with a progress bar painted
into it, frozen at about 70%. That bar is the one thing on the screen that has
to be alive, so this script does two jobs:

  1. Empties the bar. The painted fill is repainted with the track colour the
     art already uses for the unfilled remainder, so the shipped image has an
     empty groove and nothing else changes.

  2. Reports where the groove is. `index.html` draws the real bar as a DOM
     element sitting exactly on top of that groove, which only registers if the
     coordinates come from the image itself rather than from someone eyeballing
     it. They are written to `src/splash-track.json` and read at build time.

The screen ships in two stages, because "instant" and "good" cannot be the
same file. This art is dense pixel work; inlining it at any watchable quality
costs ~64 KB of base64, and 64 KB in the document is 64 KB before the browser
paints anything at all -- on a slow phone that is worse than the blank screen
it replaces.

  src/splash-inline.b64          A 96px blur, about 1 KB of base64. Inlined in
                                 the document, so it paints on the first frame
                                 with no request. Nobody reads it as an image;
                                 they read it as the screen already being there.

  public/assets/loading-splash   The real art, one ordinary request, preloaded
                                 so it goes out ahead of the bundle. It fades
                                 over the blur when it lands, well before
                                 Phaser has finished parsing.

Re-run after replacing the key art:

    python3 tools/make_splash.py
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "art-source" / "loading-screen.png"

# The placeholder is paid for before the browser paints anything, so it is held
# to roughly one packet. It is never looked at directly -- it is what is on
# screen for the few hundred milliseconds before the real art lands.
INLINE_BUDGET = 3 * 1024
INLINE_WIDTH = 96
INLINE_QUALITY = 38
INLINE_BLUR = 1.2

# The real art. This request competes with the game's own boot art on the same
# connection, so its size is taken out of time-to-playable directly. 560 square
# is softer than the window can show on a desktop and indistinguishable on the
# phones that actually feel the download; it costs 56 KB instead of 91 KB.
FULL_WIDTH = 560
FULL_QUALITY = 62

# The bar groove, measured off the source art (see `measure_track`). Pixel
# coordinates in the 1024-square original.
TRACK = {"x": 186, "y": 903, "w": 651, "h": 45}

# The colour the art uses for the unfilled part of the groove, sampled from the
# right-hand end of the bar.
TRACK_COLOUR = (50, 46, 69)


def measure_track(img: Image.Image) -> dict[str, int]:
    """
    Re-derives the groove rectangle from the art, so replacing the key art with
    a differently-laid-out one fails loudly here instead of silently drawing the
    live bar in the wrong place.

    Works off the unfilled remainder, which is a flat colour. That colour also
    appears in the caption plates above and below the bar, so a plain "longest
    run" search finds a plate instead. The groove is the only one of them with
    the painted fill beside it, so rows are only considered when they also carry
    a wide band of saturated colour.
    """
    pixels = img.convert("RGB").load()
    width, height = img.size

    def is_track(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return (abs(r - TRACK_COLOUR[0]) < 16
                and abs(g - TRACK_COLOUR[1]) < 16
                and abs(b - TRACK_COLOUR[2]) < 18)

    def is_fill(x: int, y: int) -> bool:
        px = pixels[x, y]
        return max(px) - min(px) > 70 and max(px) > 120

    best_row, best_run = None, 0
    for y in range(height // 2, height):
        if sum(is_fill(x, y) for x in range(width)) < width // 8:
            continue
        run = 0
        for x in range(width):
            if is_track(x, y):
                run += 1
                if run > best_run:
                    best_run, best_row = run, (y, x)
            else:
                run = 0

    if best_row is None or best_run < width // 12:
        raise SystemExit("  could not find the bar groove in the key art")
    return {"row": best_row[0], "right": best_row[1]}


def empty_the_bar(img: Image.Image) -> Image.Image:
    """Repaints the painted-in fill with the groove's own empty colour."""
    out = img.convert("RGB").copy()
    out.paste(
        Image.new("RGB", (TRACK["w"], TRACK["h"]), TRACK_COLOUR),
        (TRACK["x"], TRACK["y"]),
    )
    return out


def encode(img: Image.Image, quality: int, dest: Path) -> int:
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        img.save(tmp.name)
        subprocess.run(
            ["cwebp", "-quiet", "-q", str(quality), tmp.name, "-o", str(dest)],
            check=True,
        )
    return dest.stat().st_size


def main() -> int:
    if not SOURCE.exists():
        raise SystemExit(f"  missing key art: {SOURCE}")

    art = Image.open(SOURCE)
    found = measure_track(art)
    if not (TRACK["y"] <= found["row"] <= TRACK["y"] + TRACK["h"]
            and abs(found["right"] - (TRACK["x"] + TRACK["w"])) < 12):
        raise SystemExit(
            "  the bar groove moved -- re-measure TRACK against the new art "
            f"(found row {found['row']}, right edge {found['right']})"
        )

    emptied = empty_the_bar(art)

    full = emptied.resize(
        (FULL_WIDTH, round(FULL_WIDTH * art.height / art.width)), Image.LANCZOS,
    )
    full_path = ROOT / "public" / "assets" / "loading-splash.webp"
    full_size = encode(full, FULL_QUALITY, full_path)

    # Blurred before downscaling as well as by it: the groove has to survive as
    # a recognisable dark band so the live bar, which is already on screen at
    # full sharpness, does not appear to be floating over nothing.
    placeholder = emptied.resize(
        (INLINE_WIDTH, round(INLINE_WIDTH * art.height / art.width)),
        Image.LANCZOS,
    ).filter(ImageFilter.GaussianBlur(INLINE_BLUR))

    inline_path = ROOT / "art-source" / "splash-inline.webp"
    size = encode(placeholder, INLINE_QUALITY, inline_path)
    if size > INLINE_BUDGET:
        print(f"  placeholder is {size} bytes, over the {INLINE_BUDGET} "
              "byte budget", file=sys.stderr)
        return 1

    b64 = base64.b64encode(inline_path.read_bytes()).decode()
    (ROOT / "src" / "splash-inline.b64").write_text(b64)
    inline_path.unlink()

    # Fractions of the image, not pixels: the splash is scaled to whatever
    # window it lands in, and only a proportional rectangle stays registered
    # with the groove underneath it.
    (ROOT / "src" / "splash-track.json").write_text(json.dumps({
        "left": round(TRACK["x"] / art.width, 5),
        "top": round(TRACK["y"] / art.height, 5),
        "width": round(TRACK["w"] / art.width, 5),
        "height": round(TRACK["h"] / art.height, 5),
    }, indent=2) + "\n")

    print(f"  loading-splash.webp  {full_size / 1024:6.1f} KB  "
          f"q{FULL_QUALITY}, {full.width}x{full.height}")
    print(f"  splash-inline.b64    {len(b64) / 1024:6.1f} KB  "
          f"q{INLINE_QUALITY}, {placeholder.width}x{placeholder.height}")
    print(f"  splash-track.json    groove at {TRACK}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
