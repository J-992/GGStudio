"""Rebuild UI frames as clean nine-slice sources.

The supplied sheet draws its panels with sample text inside ("STAGE 40", "BUY",
"text"). Stretching those frames smears the sample text across the interface, so
each frame is rebuilt here: corners and edges are kept, and every middle pixel is
resampled from a column and row that hold only panel material. Whatever the game
then stretches, it stretches blank panel.

Also splits the board panel into a nine-sliceable frame plus one empty slot cell,
since the sheet's panel bakes in a 7x3 grid the game does not use.
"""

from pathlib import Path

from PIL import Image

ROOT = Path("/Users/derek/Desktop/crazygames/merge-ninja")
UI = ROOT / "assets-staging/ui"

# frame: (left, right, top, bottom) cap sizes. The tiling column is chosen
# automatically -- hand-picked ones kept clipping the sample text's leading glyph.
FRAMES = {
    "banner_name": (11, 11, 7, 8),
    "plate_title": (9, 9, 4, 5),
    "btn_buy": (8, 8, 6, 7),
    "field_text": (10, 10, 9, 10),
    "panel_portrait": (12, 12, 12, 13),
}

BOARD_BORDER = 5
BOARD_COLS, BOARD_ROWS = 7, 3


def nine_slice(img: Image.Image, caps: tuple[int, int, int, int], mid: int = 10) -> Image.Image:
    """Corners and edge caps from the source; every stretchable pixel synthesised.

    These frames are mostly sample text - on a 36x19 button the word BUY leaves no
    clean column to tile - so the middles are filled with the median colour of the
    band they belong to. Text is a minority of any band, so the median is panel.
    """
    left, right, top, bottom = caps
    src = img.convert("RGBA")
    pixels = src.load()

    def median(samples: list[tuple[int, ...]]) -> tuple[int, ...]:
        return tuple(sorted(s[i] for s in samples)[len(samples) // 2] for i in range(4))

    interior = [pixels[x, y]
                for y in range(top, src.height - bottom)
                for x in range(left, src.width - right)]
    fill = median(interior) if interior else (0, 0, 0, 255)
    row_fill = {y: median([pixels[x, y] for x in range(left, src.width - right)])
                for y in list(range(top)) + list(range(src.height - bottom, src.height))}
    col_fill = {x: median([pixels[x, y] for y in range(top, src.height - bottom)])
                for x in list(range(left)) + list(range(src.width - right, src.width))}

    out = Image.new("RGBA", (left + mid + right, top + mid + bottom), (0, 0, 0, 0))
    target = out.load()
    for y in range(out.height):
        in_cap_y = y < top or y >= out.height - bottom
        sy = y if y < top else src.height - (out.height - y)
        for x in range(out.width):
            in_cap_x = x < left or x >= out.width - right
            sx = x if x < left else src.width - (out.width - x)
            if in_cap_x and in_cap_y:
                target[x, y] = pixels[sx, sy]
            elif in_cap_y:
                target[x, y] = row_fill[sy]
            elif in_cap_x:
                target[x, y] = col_fill[sx]
            else:
                target[x, y] = fill
    return out


def main() -> None:
    for name, caps in FRAMES.items():
        src = Image.open(UI / f"{name}.png")
        out = nine_slice(src, caps)
        out.save(UI / f"{name}_9.png")
        print(f"{name}_9 {out.size} from {src.size}")

    board = Image.open(UI / "panel_board.png").convert("RGBA")
    inner_w = board.width - BOARD_BORDER * 2
    inner_h = board.height - BOARD_BORDER * 2
    cw, ch = inner_w / BOARD_COLS, inner_h / BOARD_ROWS

    # A middle cell, away from the panel's own border shading.
    cx, cy = BOARD_BORDER + cw, BOARD_BORDER + ch
    board.crop((round(cx), round(cy), round(cx + cw), round(cy + ch))).save(UI / "slot_cell.png")

    # The panel frame with the grid removed: keep the border, fill the middle with
    # the flat colour found in the gutter between two cells.
    gutter = board.getpixel((round(BOARD_BORDER + cw) - 2, round(BOARD_BORDER + ch) - 2))
    caps = (BOARD_BORDER + 3,) * 4
    frame = nine_slice(board, caps, mid=12)
    fill = Image.new("RGBA", (frame.width - caps[0] - caps[1], frame.height - caps[2] - caps[3]), gutter)
    frame.paste(fill, (caps[0], caps[2]))
    frame.save(UI / "panel_frame_9.png")
    print(f"slot_cell {round(cw)}x{round(ch)}, panel_frame_9 {frame.size}, fill {gutter}")


if __name__ == "__main__":
    main()
