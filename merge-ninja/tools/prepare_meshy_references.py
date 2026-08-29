#!/usr/bin/env python3
"""Export one clean, square image reference for every Meshy roster folder.

The game has static portrait files plus horizontal animation strips.  Meshy
needs one character per upload, so strips are cropped to their first idle pose
before being point-upscaled to 512 px. Re-run after the current roster art is
changed:

    python3 tools/prepare_meshy_references.py
"""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
WORKSPACE = ROOT / "meshy-models"
OUTPUT_SIZE = 256

# (asset filename, source frame size). A frame size of None means the asset is
# already one square portrait; otherwise it is a horizontal animation strip.
NINJA_REFERENCES: dict[int, tuple[str, int | None]] = {
    **{tier: (f"ninja-motion-t{tier:02d}.webp", 128) for tier in range(1, 12)},
    12: ("samurai-ready.webp", 128),
    **{tier: (f"ninja-motion-t{tier:02d}.webp", 128) for tier in range(13, 29)},
    29: ("ninja-motion-t29.webp", 256),
}

BOSS_REFERENCES: dict[int, tuple[str, int | None]] = {
    1: ("boss-catalog-26.webp", None),
    2: ("boss-catalog-39.webp", None),
    3: ("boss-catalog-25.webp", None),
    4: ("ninja-catalog-28.webp", None),
    5: ("boss-catalog-31.webp", None),
    6: ("ninja-catalog-30.webp", None),
    7: ("ninja-catalog-31.webp", None),
    8: ("boss-catalog-33.webp", None),
    9: ("ninja-catalog-35.webp", None),
    10: ("boss-catalog-34.webp", None),
    11: ("boss-catalog-38.webp", None),
    12: ("boss-catalog-35.webp", None),
    13: ("boss-catalog-28.webp", None),
    14: ("ninja-catalog-32.webp", None),
    15: ("ninja-catalog-33.webp", None),
    16: ("ninja-catalog-34.webp", None),
    17: ("boss-catalog-32.webp", None),
    18: ("ninja-catalog-29.webp", None),
    19: ("boss-catalog-37.webp", None),
    20: ("boss-catalog-27.webp", None),
    21: ("boss-catalog-36.webp", None),
    22: ("boss-motion-a22.webp", 256),
    23: ("boss-motion-a23.webp", 256),
    24: ("boss-motion-a24.webp", 256),
    25: ("ninja-catalog-39.webp", None),
    **{appearance: (f"boss-motion-a{appearance:02d}.webp", 256) for appearance in range(26, 38)},
}


def roster_folder(category: str, number: int) -> Path:
    matches = list((WORKSPACE / category).glob(f"{number:02d}-*"))
    if len(matches) != 1:
        raise SystemExit(f"expected one {category} folder for {number:02d}, found {matches}")
    return matches[0]


def export_reference(
    category: str,
    number: int,
    asset_name: str,
    frame_size: int | None,
) -> None:
    source = ASSETS / asset_name
    if not source.exists():
        raise SystemExit(f"missing source asset: {source}")
    destination = roster_folder(category, number) / "reference.png"
    command = ["magick", str(source)]
    if frame_size is not None:
        command.extend(["-crop", f"{frame_size}x{frame_size}+0+0", "+repage"])
    command.extend([
        "-filter", "point", "-resize", f"{OUTPUT_SIZE}x{OUTPUT_SIZE}",
        str(destination),
    ])
    subprocess.run(command, check=True)
    print(destination.relative_to(ROOT))


def main() -> int:
    for tier, (asset_name, frame_size) in NINJA_REFERENCES.items():
        export_reference("ninjas", tier, asset_name, frame_size)
    for appearance, (asset_name, frame_size) in BOSS_REFERENCES.items():
        export_reference("bosses", appearance, asset_name, frame_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
