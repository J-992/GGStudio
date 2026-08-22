"""Pack the real pixel-art sprites into the game's texture atlas (PNG + JSON Hash).

Frame names must match `src/render/atlasConfig.ts` exactly — that file is the art
swap seam, and the game renders every sprite as (ATLAS_KEY, frameName).

Character frames are padded to a uniform CHAR_FRAME box with the sprite standing on
the bottom edge, so every tier's feet land on the same line whatever its art height.
The stage-6 boss keeps its native size: it is drawn free-standing and much larger
than the rest, and squeezing it into the box would waste its scale.

Tier order is chosen so neighbouring tiers never share a dominant colour — the
player should read tier from hue and silhouette before the badge.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path("/Users/derek/Desktop/crazygames/merge-ninja")
SRC = ROOT / "assets-staging/sprites"
OUT_PNG = ROOT / "public/assets/game.png"
OUT_JSON = ROOT / "public/assets/game.json"
CHAR_FRAME = 128
PAD = 4          # gutter; without it upscaled frames bleed into their neighbours
SS = 4           # supersample factor for the smooth (non-pixel-art) FX shapes

NINJAS = [
    ("b_14", "Ninja Trainee"), ("a_12", "Rookie Ninja"), ("a_16", "Scout Ninja"),
    ("a_10", "Falcon Ninja"), ("b_10", "Storm Ninja"), ("b_00", "Venom Ninja"),
    ("b_04", "Frost Ninja"), ("b_07", "Wolf Ninja"), ("b_01", "Arcane Ninja"),
    ("b_22", "Radiant Ninja"), ("b_13", "Void Ninja"), ("b_06", "Flame Shogun"),
]
# Ordered to match the boss names in src/data/enemies.ts.
BOSSES = [
    ("a_02", "Dojo Master"), ("a_04", "Crimson Ronin"), ("b_11", "Storm Oni"),
    ("a_14", "Iron Shogun"), ("b_25", "Moonblade Queen"), ("b_boss", "Dragon Sensei"),
]


def boxed(sprite: Image.Image) -> Image.Image:
    """Centre a sprite in the standard character box, standing on the bottom edge."""
    if sprite.width > CHAR_FRAME or sprite.height > CHAR_FRAME:
        s = min(CHAR_FRAME / sprite.width, CHAR_FRAME / sprite.height)
        sprite = sprite.resize((max(1, int(sprite.width * s)), max(1, int(sprite.height * s))), Image.LANCZOS)
    box = Image.new("RGBA", (CHAR_FRAME, CHAR_FRAME), (0, 0, 0, 0))
    box.paste(sprite, ((CHAR_FRAME - sprite.width) // 2, CHAR_FRAME - sprite.height), sprite)
    return box


def fx_frames() -> dict[str, Image.Image]:
    """Effect sprites. All white for runtime tinting except the coin, which is drawn
    untinted by the currency display and buy button."""
    out: dict[str, Image.Image] = {}
    W = (255, 255, 255, 255)

    def canvas(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    def done(name: str, im: Image.Image, w: int, h: int) -> None:
        out[name] = im.resize((w, h), Image.LANCZOS)

    im, d = canvas(32, 32)
    d.ellipse((2 * SS, 2 * SS, 30 * SS, 30 * SS), fill=(214, 158, 46, 255))
    d.ellipse((5 * SS, 5 * SS, 27 * SS, 27 * SS), fill=(247, 201, 72, 255))
    d.ellipse((10 * SS, 9 * SS, 16 * SS, 15 * SS), fill=(255, 236, 168, 255))
    done("fx_coin", im, 32, 32)

    def star(size: int, points: int, inner: float) -> Image.Image:
        import math
        im, d = canvas(size, size)
        c, r = size * SS / 2, size * SS / 2 - SS
        pts = []
        for i in range(points * 2):
            a = math.pi * i / points - math.pi / 2
            rad = r if i % 2 == 0 else r * inner
            pts.append((c + rad * math.cos(a), c + rad * math.sin(a)))
        d.polygon(pts, fill=W)
        return im

    done("fx_star", star(32, 4, 0.38), 32, 32)
    done("fx_spark", star(16, 4, 0.30), 16, 16)

    im, d = canvas(48, 48)
    for cx, cy, r in ((17, 28, 13), (30, 27, 14), (24, 19, 15), (34, 34, 10), (14, 35, 9)):
        d.ellipse(((cx - r) * SS, (cy - r) * SS, (cx + r) * SS, (cy + r) * SS), fill=W)
    done("fx_puff", im, 48, 48)

    im, d = canvas(64, 64)
    d.ellipse((2 * SS, 2 * SS, 62 * SS, 62 * SS), outline=W, width=5 * SS)
    done("fx_ring", im, 64, 64)

    # Crescent: a wide arc with a second ellipse punched out of its inner edge.
    im, d = canvas(96, 48)
    d.ellipse((0, -22 * SS, 96 * SS, 48 * SS), fill=W)
    d.ellipse((6 * SS, -30 * SS, 90 * SS, 40 * SS), fill=(0, 0, 0, 0))
    done("fx_slash", im, 96, 48)
    return out


def main() -> None:
    images: dict[str, Image.Image] = {}
    names: dict[str, str] = {}
    for i, (src, name) in enumerate(NINJAS, start=1):
        images[f"ninja_t{i}"] = boxed(Image.open(SRC / f"{src}.png").convert("RGBA"))
        names[f"ninja_t{i}"] = name
    for i, (src, name) in enumerate(BOSSES):
        sprite = Image.open(SRC / f"{src}.png").convert("RGBA")
        images[f"enemy_{i}"] = sprite if src == "b_boss" else boxed(sprite)
        names[f"enemy_{i}"] = name
    for key, im in fx_frames().items():
        images[key] = im
        names[key] = key
    # UI, props and environment pieces sliced from the interface sheet. Textures are
    # deliberately excluded: they ship as standalone files because a tiling sprite
    # needs its own texture, not an atlas frame.
    ui_dir = ROOT / "assets-staging/ui"
    for path in sorted(ui_dir.glob("*.png")):
        if path.stem.startswith("tex_"):
            continue
        images[path.stem] = Image.open(path).convert("RGBA")
        names[path.stem] = path.stem

    width = 1024
    x = y = shelf = 0
    frames = {}
    placements = {}
    for key, im in images.items():
        if x + im.width + PAD > width:
            x, y, shelf = 0, y + shelf + PAD, 0
        placements[key] = (x, y)
        x += im.width + PAD
        shelf = max(shelf, im.height)
    height = y + shelf + PAD

    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for key, im in images.items():
        px, py = placements[key]
        sheet.paste(im, (px, py), im)
        frames[key] = {
            "frame": {"x": px, "y": py, "w": im.width, "h": im.height},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
            "sourceSize": {"w": im.width, "h": im.height},
        }

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PNG)
    OUT_JSON.write_text(json.dumps({
        "frames": frames,
        "meta": {"image": OUT_PNG.name, "size": {"w": width, "h": height}, "scale": "1"},
    }, indent=1))
    (SRC.parent / "MANIFEST.json").write_text(json.dumps(
        [{"key": k, "name": names[k], "frame": frames[k]["frame"]} for k in images], indent=1))
    print(f"{len(frames)} frames -> {OUT_PNG} ({width}x{height}, {OUT_PNG.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
