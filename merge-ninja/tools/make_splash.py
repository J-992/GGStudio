#!/usr/bin/env python3
"""Build the three portrait loading screens and their instant placeholders.

The source artwork is kept losslessly in ``art-source/`` at its native 9:16
ratio.  The live loading bar is deliberately HTML rather than baked into the
art, so it can animate honestly while the game boots. Re-run this script after
replacing any source artwork:

    python3 tools/make_splash.py
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The full images must remain small enough to load before Phaser, while the
# 96px placeholders are inlined so the chosen screen paints immediately.
INLINE_BUDGET = 3 * 1024
INLINE_WIDTH = 96
INLINE_QUALITY = 38
INLINE_BLUR = 1.2
FULL_WIDTH = 560
FULL_QUALITY = 62

# Crop is (left, top, width, height). Each source is a standalone 941x1672
# portrait image. The track is a quiet lower-area rectangle for the live DOM
# progress bar, measured in that source image.
SPLASHES = (
    {
        "id": "1",
        "source": "loading-screen-01.png",
        "crop": (0, 0, 941, 1672),
        "track": (150, 1510, 641, 34),
    },
    {
        "id": "2",
        "source": "loading-screen-02.png",
        "crop": (0, 0, 941, 1672),
        "track": (150, 1510, 641, 34),
    },
    {
        "id": "3",
        "source": "loading-screen-03.png",
        "crop": (0, 0, 941, 1672),
        "track": (150, 1510, 641, 34),
    },
)


def crop_screen(spec: dict[str, object]) -> tuple[Path, tuple[int, int, int, int]]:
    source = ROOT / "art-source" / str(spec["source"])
    if not source.exists():
        raise SystemExit(f"missing splash source: {source}")
    left, top, width, height = spec["crop"]  # type: ignore[misc]
    dimensions = subprocess.run(
        ["magick", "identify", "-format", "%w %h", str(source)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    image_width, image_height = (int(value) for value in dimensions)
    if left + width > image_width or top + height > image_height:
        raise SystemExit(f"crop is outside {source}: {spec['crop']}")
    return source, (left, top, width, height)


def render(
    source: Path,
    crop: tuple[int, int, int, int],
    width: int,
    quality: int,
    dest: Path,
    blur: float = 0,
) -> int:
    """Crop, resize, and write a WebP in one pass without distorting art."""
    left, top, crop_width, crop_height = crop
    args = [
        "magick", str(source), "-crop", f"{crop_width}x{crop_height}+{left}+{top}",
        "+repage", "-resize", f"{width}x",
    ]
    if blur > 0:
        args.extend(["-blur", f"0x{blur}"])
    args.extend(["-quality", str(quality), str(dest)])
    subprocess.run(args, check=True)
    return dest.stat().st_size


def main() -> int:
    screens: list[dict[str, object]] = []
    for spec in SPLASHES:
        source, crop = crop_screen(spec)
        track = spec["track"]  # type: ignore[assignment]
        x, y, width, height = track
        _, _, crop_width, crop_height = crop
        if x < 0 or y < 0 or x + width > crop_width or y + height > crop_height:
            raise SystemExit(f"track is outside splash {spec['id']}: {track}")
        full_path = ROOT / "public" / "assets" / f"loading-splash-{spec['id']}.webp"
        full_size = render(source, crop, FULL_WIDTH, FULL_QUALITY, full_path)

        inline_path = ROOT / "art-source" / f"splash-inline-{spec['id']}.webp"
        inline_size = render(
            source, crop, INLINE_WIDTH, INLINE_QUALITY,
            inline_path, INLINE_BLUR,
        )
        if inline_size > INLINE_BUDGET:
            print(
                f"placeholder {spec['id']} is {inline_size} bytes, over the "
                f"{INLINE_BUDGET} byte budget",
                file=sys.stderr,
            )
            return 1
        b64 = base64.b64encode(inline_path.read_bytes()).decode()
        (ROOT / "src" / f"splash-inline-{spec['id']}.b64").write_text(b64)
        inline_path.unlink()

        screens.append({
            "id": spec["id"],
            "aspect": round(crop_width / crop_height, 6),
            "track": {
                "left": round(x / crop_width, 6),
                "top": round(y / crop_height, 6),
                "width": round(width / crop_width, 6),
                "height": round(height / crop_height, 6),
            },
        })
        print(
            f"loading-splash-{spec['id']}.webp  {full_size / 1024:6.1f} KB "
            f"q{FULL_QUALITY}, {FULL_WIDTH}x{round(FULL_WIDTH * crop_height / crop_width)}; "
            f"inline {len(b64) / 1024:.1f} KB",
        )

    (ROOT / "src" / "splash-screens.json").write_text(json.dumps(screens, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
