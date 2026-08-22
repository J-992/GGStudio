"""Hand-authored pixel-art icon for Merge Ninja.

The icon is drawn once on a 16x16 grid so every export is an integer
upscale of the same pixels. A tab favicon is rendered at 16 or 32 CSS
pixels; anything designed larger and shrunk turns to mush at that size,
so the small size is the source of truth and the big ones follow.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public"

# Palette keyed by the single characters used in the pixel maps below.
PALETTE = {
    " ": (0, 0, 0, 0),  # transparent (corner rounding)
    "r": (0xC0, 0x39, 0x33, 255),  # crimson field
    "R": (0x8E, 0x25, 0x21, 255),  # crimson shade
    "k": (0x14, 0x1C, 0x2B, 255),  # hood navy
    "K": (0x0A, 0x0E, 0x18, 255),  # hood shade
    "y": (0xFF, 0xD2, 0x3F, 255),  # gold (eyes / coin)
    "o": (0xE0, 0x8A, 0x1E, 255),  # gold shade
    "w": (0xEE, 0xF3, 0xF8, 255),  # steel highlight
    "s": (0xA8, 0xB8, 0xC8, 255),  # steel shade
    "n": (0x1B, 0x24, 0x36, 255),  # dark field
    "h": (0x27, 0x35, 0x50, 255),  # hood highlight
}

# Variant D - ninja bust, crimson field, steel headband trailing left.
BUST_RED = [
    " rrrrrrrrrrrrrr ",
    "rrrrrrkkkkrrrrrr",
    "rrrrrhkkkkkrrrrr",
    "rrrrhkkkkkkkrrrr",
    "rrrhkkkkkkkkkrrr",
    "rrrhkkkkkkkkkrrr",
    "rswwwwwwwwwwwwrr",
    "rwsrkkkkkkkkkkrr",
    "rrrhyykkkkkkyyrr",
    "rrrhkkyykkyykkrr",
    "rrrhkkkkkkkkkkrr",
    "rrrrhkkkkkkkkrrr",
    "rrrrhkkkkkkkkrrr",
    "rrrKKKKKKKKKKKrr",
    "rrKKKKKKKKKKKKKr",
    " rrrrrrrrrrrrrr ",
]

def recolor(rows: list[str], swaps: dict[str, str]) -> list[str]:
    return ["".join(swaps.get(ch, ch) for ch in row) for row in rows]


# Same bust on the deep navy field, headband turned crimson.
BUST_NAVY = recolor(BUST_RED, {"r": "n", "w": "r", "s": "R"})

VARIANTS = {"d": BUST_RED, "e": BUST_NAVY}


def render(rows: list[str]) -> Image.Image:
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(rows):
        if len(row) != 16:
            raise ValueError(f"row {y} is {len(row)} wide, expected 16")
        for x, ch in enumerate(row):
            px[x, y] = PALETTE[ch]
    return img


def scale(img: Image.Image, factor: int) -> Image.Image:
    return img.resize((16 * factor, 16 * factor), Image.NEAREST)


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if which == "preview":
        out = ROOT / "screenshots" / "icon-variants.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        keys = sys.argv[2] if len(sys.argv) > 2 else "abc"
        sheet = Image.new("RGBA", (len(keys) * 170 + 20, 200), (0x2B, 0x21, 0x18, 255))
        for i, key in enumerate(keys):
            base = render(VARIANTS[key])
            sheet.paste(scale(base, 8), (10 + i * 170, 10), scale(base, 8))
            sheet.paste(scale(base, 2), (10 + i * 170, 150), scale(base, 2))
            sheet.paste(base, (60 + i * 170, 150), base)
        sheet.save(out)
        print(out)
        return

    base = render(VARIANTS[which])
    for name, factor in (("favicon.png", 2), ("favicon-128.png", 8), ("logo-512.png", 32)):
        scale(base, factor).save(OUT / name)
        print(OUT / name)


if __name__ == "__main__":
    main()
