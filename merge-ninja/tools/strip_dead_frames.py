#!/usr/bin/env python3
"""
Empties the atlas frames nothing draws any more.

The packed sheet still carried the game's first-pass scenery -- a 900x409
floor, two ledges, a gate, props, and the UI plates that authored art replaced.
Two thirds of every pixel the atlas covered belonged to frames with no
reference anywhere in the source, and the atlas is the single largest file the
game loads before its first frame.

They are blanked rather than repacked out. Repacking would renumber every rect
in game.json and re-derive the sheet from source art that is no longer in the
tree; blanking leaves both the sheet's dimensions and every coordinate in the
JSON exactly as they were, and a fully transparent rect costs almost nothing to
compress. It also fails softly: if a frame listed here turns out to be drawn
after all, it draws as nothing rather than as the wrong art or a crash, and
`tests/atlas.test.ts` fails before that can ship.

A frame counts as live if the source mentions it literally, or if it matches one
of the two names the code builds at runtime (`ninjaFrame`, `enemyFrame` in
render/atlasConfig.ts). Anything else is dead.

    python3 tools/strip_dead_frames.py
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / "public" / "assets" / "game.webp"
ATLAS_JSON = ROOT / "public" / "assets" / "game.json"
DEAD_LIST = ROOT / "tools" / "atlas-dead-frames.json"

# Names the code assembles at runtime rather than writing out; see atlasConfig.
DYNAMIC = (re.compile(r"ninja_t\d+"), re.compile(r"enemy_\d+"))


def source_text() -> str:
    files = [p for d in ("src", "tests") for p in (ROOT / d).rglob("*.ts")]
    return "\n".join(p.read_text() for p in files)


def dead_frames(frames: dict, src: str) -> list[str]:
    dead = []
    for name in frames:
        if any(p.fullmatch(name) for p in DYNAMIC):
            continue
        if f"'{name}'" in src or f'"{name}"' in src or f"`{name}`" in src:
            continue
        dead.append(name)
    return sorted(dead)


def main() -> int:
    frames = json.loads(ATLAS_JSON.read_text())["frames"]
    dead = dead_frames(frames, source_text())

    art = Image.open(ATLAS).convert("RGBA")
    blank_px = 0
    for name in dead:
        r = frames[name]["frame"]
        art.paste((0, 0, 0, 0), (r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
        blank_px += r["w"] * r["h"]

    before = ATLAS.stat().st_size
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        art.save(tmp.name)
        # Same encoding tools/optimize_assets.sh uses for this file, and applied
        # once: re-encoding an already near-lossless file would stack a second
        # pass of error on top of the first.
        subprocess.run(
            ["cwebp", "-quiet", "-near_lossless", "20", "-z", "9", "-lossless",
             tmp.name, "-o", str(ATLAS)],
            check=True,
        )
    after = ATLAS.stat().st_size

    DEAD_LIST.write_text(json.dumps(dead, indent=2) + "\n")

    print(f"  {len(dead)} of {len(frames)} frames blanked ({blank_px:,} px)")
    print(f"  game.webp  {before / 1024:.0f} KB -> {after / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
