"""
Authors the game's bitmap font page from scratch.

The old sheet was carved out of a UI art PNG (tools/extract_ui.py). Slicing
letters out of raster art gave uneven stems, ragged baselines and advances that
ran words together ("DOJOMASTER"), and it only had a 17px page that every call
site then downscaled to 12-14px -- with pixelArt nearest filtering that drops
whole pixel rows and mangles the glyphs.

This file replaces it: hand-authored 7-row pixel letterforms, drawn at an exact
2x so every stem is 2px, packed with uniform advances. Native size is 14px, the
size the UI already asks for, so text renders at scale 1.0 and stays crisp.
Glyphs are solid white; call sites tint them.

    python3 tools/make_font.py

Writes public/assets/font.png + public/assets/font.xml.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FONT_PNG = ROOT / "public/assets/font.png"
FONT_XML = ROOT / "public/assets/font.xml"

SCALE = 2
ROWS = 7
GAP = 1  # core-pixel gap baked into every advance

# Every glyph is 7 rows of '#' (ink) and '.' (empty). Widths vary per glyph;
# the packer reads the width from the strings.
GLYPHS: dict[str, list[str]] = {
    " ": ["..."] * 7,
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    "J": ["..###", "...#.", "...#.", "...#.", "#..#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": [".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", "..#..", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    "!": ["#", "#", "#", "#", "#", ".", "#"],
    "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
    "$": ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
    "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.###", ".##.#"],
    "&": [".##..", "#..#.", "#..#.", ".##..", "#.#.#", "#..#.", ".##.#"],
    "(": [".#", "#.", "#.", "#.", "#.", "#.", ".#"],
    ")": ["#.", ".#", ".#", ".#", ".#", ".#", "#."],
    "+": ["...", ".#.", ".#.", "###", ".#.", ".#.", "..."],
    ",": ["..", "..", "..", "..", "..", ".#", "#."],
    "-": ["...", "...", "...", "###", "...", "...", "..."],
    ".": ["#", "#", "#", "#", "#", "#", "#"],  # trimmed below to a foot dot
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    ":": [".", "#", ".", ".", ".", "#", "."],
    "<": ["...#", "..#.", ".#..", "#...", ".#..", "..#.", "...#"],
    "=": ["....", "....", "####", "....", "####", "....", "...."],
    ">": ["#...", ".#..", "..#.", "...#", "..#.", ".#..", "#..."],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
    "[": ["###", "#..", "#..", "#..", "#..", "#..", "###"],
    "]": ["###", "..#", "..#", "..#", "..#", "..#", "###"],
    "{": [".##", ".#.", ".#.", "##.", ".#.", ".#.", ".##"],
    "}": ["##.", ".#.", ".#.", ".##", ".#.", ".#.", "##."],
    "'": ["#", "#", ".", ".", ".", ".", "."],
    "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
}

# The period is a foot dot, not a bar.
GLYPHS["."] = [".", ".", ".", ".", ".", "#", "#"]

# Advances that would otherwise leave a hole. Space carries its own width.
ADVANCE_OVERRIDE = {" ": 4}


def render(pattern: list[str]) -> Image.Image:
    width = len(pattern[0])
    image = Image.new("RGBA", (width * SCALE, ROWS * SCALE), (255, 255, 255, 0))
    pixels = image.load()
    for row, line in enumerate(pattern):
        if len(line) != width:
            raise ValueError(f"ragged glyph row: {line!r}")
        for col, cell in enumerate(line):
            if cell != "#":
                continue
            for dy in range(SCALE):
                for dx in range(SCALE):
                    pixels[col * SCALE + dx, row * SCALE + dy] = (255, 255, 255, 255)
    return image


def main() -> None:
    for pattern in GLYPHS.values():
        if len(pattern) != ROWS:
            raise ValueError("every glyph must have exactly 7 rows")

    rendered = {char: render(pattern) for char, pattern in GLYPHS.items()}
    cell_h = ROWS * SCALE
    pad = 1
    columns = 16
    col_w = max(image.width for image in rendered.values()) + pad
    page_w = columns * col_w + pad
    page_h = ((len(rendered) + columns - 1) // columns) * (cell_h + pad) + pad
    page = Image.new("RGBA", (page_w, page_h), (255, 255, 255, 0))

    entries: list[tuple[str, int, int, int, int]] = []
    for index, (char, image) in enumerate(rendered.items()):
        x = pad + (index % columns) * col_w
        y = pad + (index // columns) * (cell_h + pad)
        page.paste(image, (x, y), image)
        entries.append((char, x, y, image.width, image.height))

    FONT_PNG.parent.mkdir(parents=True, exist_ok=True)
    page.save(FONT_PNG)

    chars_xml = "\n".join(
        f'    <char id="{ord(c)}" x="{gx}" y="{gy}" width="{gw}" height="{gh}"'
        f' xoffset="0" yoffset="0"'
        f' xadvance="{ADVANCE_OVERRIDE.get(c, len(GLYPHS[c][0])) * SCALE + GAP * SCALE}"'
        f' page="0" chnl="15"/>'
        for c, gx, gy, gw, gh in entries
    )
    FONT_XML.write_text(
        '<?xml version="1.0"?>\n<font>\n'
        f'  <info face="MergeNinjaPixel" size="{cell_h}" bold="1"/>\n'
        f'  <common lineHeight="{cell_h + 4}" base="{cell_h}"'
        f' scaleW="{page.width}" scaleH="{page.height}" pages="1"/>\n'
        f'  <pages><page id="0" file="{FONT_PNG.name}"/></pages>\n'
        f'  <chars count="{len(entries)}">\n{chars_xml}\n  </chars>\n</font>\n'
    )
    print(f"font: {len(entries)} glyphs -> {FONT_PNG.name} ({page.width}x{page.height}), size {cell_h}")


if __name__ == "__main__":
    main()
