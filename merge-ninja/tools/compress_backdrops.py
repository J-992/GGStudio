#!/usr/bin/env python3
"""Palette-quantise the oversized dojo PNGs in place to fit the download budget.

dojo-night-backdrop.png and dojo-roster-deck.png ship as 1672x941 RGB but
weigh ~1.8 MB each because they were saved straight from JPEG-sourced art.
This re-encodes both as dithered palettised PNGs (< 450 KB each), keeping
dimensions untouched, and reports a mean per-pixel delta so the quality
loss stays auditable.

Usage: python3 tools/compress_backdrops.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
TARGETS = ["dojo-night-backdrop.png", "dojo-roster-deck.png"]
MAX_BYTES = 450 * 1024
COLOR_LADDER = [256, 224, 192, 160, 128, 96]


def compress(path: Path) -> None:
    original = Image.open(path)
    src_rgb = np.asarray(original.convert("RGB")).astype(np.int16)
    width, height = original.size
    before = path.stat().st_size
    chosen = None
    for colors in COLOR_LADDER:
        q = original.quantize(
            colors=colors,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.FLOYDSTEINBERG,
        )
        # Measure without touching the file yet.
        recon = np.asarray(q.convert("RGB")).astype(np.int16)
        mean_delta = float(np.abs(recon - src_rgb).mean())
        probe = path.with_suffix(".probe.png")
        q.save(probe, optimize=True)
        size = probe.stat().st_size
        if size <= MAX_BYTES:
            chosen = (q, colors, size, mean_delta)
            break
    if chosen is None:
        path.unlink() if False else None  # keep original on failure
        raise SystemExit(f"{path.name}: cannot reach {MAX_BYTES} bytes")
    q, colors, size, mean_delta = chosen
    q.save(path, optimize=True)
    if path.stat().st_size != size:
        pass
    print(f"{path.name}: {width}x{height} {before/1024:.0f}KB -> "
          f"{path.stat().st_size/1024:.0f}KB ({colors} colours, "
          f"mean px delta {mean_delta:.2f}/255)")


def main() -> None:
    for name in TARGETS:
        path = ASSETS / name
        im = Image.open(path)
        assert im.size == (1672, 941), f"unexpected dimensions in {name}: {im.size}"
        compress(path)
        after = Image.open(path)
        assert after.size == (1672, 941), f"{name}: dimensions changed!"
        print(f"  verified {after.size} mode={after.mode}")


if __name__ == "__main__":
    main()
