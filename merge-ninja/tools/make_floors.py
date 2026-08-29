#!/usr/bin/env python3
"""Procedural pixel-art arena floor strips for Merge Ninja, one per act theme.

Original art (c) Reaper8202. Deterministic (fixed seed per theme id). The
floor palettes are parsed straight out of src/data/arenaThemes.ts so the
strips always match the runtime theme data — single source of truth.

Outputs palette-quantised PNGs (<= 64 colours) into public/assets/:
    floor-dojo.png floor-temple.png floor-storm.png floor-rift.png floor-shrine.png

Textures are drawn at 512x96 and upscaled NEAREST to 1024x192 for a chunky
pixel look that matches the 128px character art. The top rows carry a light
highlight lip so characters read planted.

Usage: python3 tools/make_floors.py
"""

from __future__ import annotations

import hashlib
import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "assets"
THEMES_TS = ROOT / "src" / "data" / "arenaThemes.ts"

W, H = 512, 96
SCALE = 2
MAX_COLORS = 64

# theme id -> texture key BootScene preloads (floor-<file>.png)
KEYS = {
    "dojo-dusk": "floor_dojo",
    "mountain-temple": "floor_temple",
    "storm-sea": "floor_storm",
    "rift": "floor_rift",
    "dragon-shrine": "floor_shrine",
}


def parse_themes() -> dict[str, dict]:
    src = THEMES_TS.read_text()
    themes: dict[str, dict] = {}
    for m in re.finditer(r"id: '([^']+)',[\s\S]*?floor: \{ baseColor: (0x[0-9a-fA-F]+), "
                         r"lightColor: (0x[0-9a-fA-F]+), shadowColor: (0x[0-9a-fA-F]+), "
                         r"plankOrStone: '(\w+)' \}", src):
        themes[m.group(1)] = {
            "base": int(m.group(2), 16),
            "light": int(m.group(3), 16),
            "shadow": int(m.group(4), 16),
            "style": m.group(5),
        }
    missing = set(KEYS) - set(themes)
    if missing:
        raise SystemExit(f"could not parse floors for: {sorted(missing)}")
    return themes


def _c(v: int) -> tuple[int, int, int]:
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def _mix(a: tuple, b: tuple, f: float) -> tuple:
    return tuple(max(0, min(255, round(x + (y - x) * f))) for x, y in zip(a, b))


def seed_for(theme_id: str) -> int:
    return int.from_bytes(hashlib.sha256(theme_id.encode()).digest()[:4], "big")


def row_bounds(rows: int, gamma: float) -> list[int]:
    """Perspective row boundaries: near rows (bottom) taller than far rows."""
    return [round(H * (i / rows) ** gamma) for i in range(rows + 1)]


def base_gradient(img: Image.Image, base: tuple, shadow: tuple) -> None:
    dr = ImageDraw.Draw(img)
    for y in range(H):
        f = (y / (H - 1)) ** 1.35
        dr.line([(0, y), (W, y)], fill=_mix(base, shadow, 0.16 + 0.5 * f))


def top_lip(dr: ImageDraw.ImageDraw, light: tuple, shadow: tuple, rng: random.Random) -> None:
    """Highlight lip + dark seam so the floor edge reads on any backdrop."""
    dr.rectangle([0, 0, W, 1], fill=_mix(light, (255, 255, 255), 0.25))
    dr.rectangle([0, 2, W, 4], fill=light)
    for x in range(W):
        if rng.random() < 0.35:
            dr.point((x, 4), fill=_mix(light, (255, 255, 255), 0.18))
    dr.line([(0, 5), (W, 5)], fill=shadow)
    dr.line([(0, 6), (W, 6)], fill=_mix(shadow, (0, 0, 0), 0.25))


def bottom_fade(img: Image.Image, shadow: tuple) -> None:
    px = img.load()
    for y in range(H - 10, H):
        f = (y - (H - 11)) / 11.0
        for x in range(W):
            px[x, y] = _mix(px[x, y], _mix(shadow, (0, 0, 0), 0.45), f * 0.8)


def planks(img: Image.Image, rng: random.Random, base, light, shadow) -> None:
    base, light, shadow = _c(base), _c(light), _c(shadow)
    base_gradient(img, base, shadow)
    dr = ImageDraw.Draw(img)
    top_lip(dr, light, shadow, rng)
    # Plank seams converge toward a vanishing point far above centre.
    vp_x, vp_y = W / 2, -H * 2.6
    seams = []
    for i in range(-9, 10):
        bx = W / 2 + i * (W / 9.5)
        seams.append(bx)
    for bx in seams:
        # line from vp through bottom point, drawn only inside the strip
        x_top = vp_x + (bx - vp_x) * (6 - vp_y) / (H - vp_y)
        x_bot = bx
        dr.line([(x_top, 6), (x_bot, H)], fill=_mix(shadow, (0, 0, 0), 0.2), width=1)
    # Horizontal board joints, staggered per plank column, perspective-spaced.
    bounds = row_bounds(6, 1.7)
    for r in range(1, len(bounds) - 1):
        y = bounds[r]
        dr.line([(0, y), (W, y)], fill=_mix(shadow, (0, 0, 0), 0.12))
        for x in range(0, W, 46):
            jx = x + rng.randrange(-14, 15)
            if rng.random() < 0.5:
                span = rng.randrange(10, 30)
                dr.line([(jx, bounds[r - 1] + 2), (jx, y)], fill=_mix(shadow, (0, 0, 0), 0.18))
                dr.line([(jx, bounds[r - 1] + 2), (jx + span, bounds[r - 1] + 2)],
                        fill=_mix(light, shadow, 0.35))
    # Grain streaks along the planks.
    for _ in range(150):
        x, y = rng.randrange(W), rng.randrange(7, H)
        ln = rng.randrange(4, 18)
        col = light if rng.random() < 0.4 else shadow
        dr.line([(x, y), (x + ln, y + rng.randrange(-1, 1))], fill=_mix(col, base, 0.55))
    # Warm knots
    for _ in range(6):
        x, y = rng.randrange(20, W - 20), rng.randrange(14, H - 8)
        r = rng.randrange(2, 4)
        dr.ellipse([x - r, y - r // 2, x + r, y + r // 2], fill=_mix(shadow, (0, 0, 0), 0.25))
        dr.ellipse([x - r + 1, y - r // 2 + 1, x + r - 1, y + r // 2 - 1], fill=base)
    bottom_fade(img, shadow)


def stone_slabs(img: Image.Image, rng: random.Random, base, light, shadow,
                gilt: bool = False, accent_color: int | None = None) -> None:
    base, light, shadow = _c(base), _c(light), _c(shadow)
    base_gradient(img, base, shadow)
    dr = ImageDraw.Draw(img)
    top_lip(dr, light, shadow, rng)
    gold = _c(accent_color) if accent_color is not None else (212, 164, 84)
    bounds = row_bounds(5, 1.75)
    # Vertical joints fan out from the centre line for perspective.
    for r in range(len(bounds) - 1):
        y0, y1 = max(bounds[r], 6), bounds[r + 1]
        if y1 - y0 < 3:
            continue
        depth = r / max(1, len(bounds) - 2)
        spacing = 40 + 46 * depth
        for i in range(-8, 9):
            x = W / 2 + i * spacing + rng.randrange(-3, 4)
            dr.line([(x, y0), (x + (x - W / 2) * 0.06, y1)], fill=_mix(shadow, (0, 0, 0), 0.22))
        # Slab top highlight + bottom shade per row.
        dr.line([(0, y0 + 1), (W, y0 + 1)], fill=_mix(light, base, 0.25))
        dr.line([(0, y1 - 1), (W, y1 - 1)], fill=_mix(shadow, (0, 0, 0), 0.3))
        if gilt and r % 2 == 1:
            dr.line([(0, y0 + 2), (W, y0 + 2)], fill=_mix(gold, shadow, 0.25))
    # Chips and pits.
    for _ in range(120):
        x, y = rng.randrange(W), rng.randrange(8, H - 4)
        s = rng.randrange(1, 3)
        col = shadow if rng.random() < 0.6 else light
        dr.rectangle([x, y, x + s, y + rng.randrange(1, 2)], fill=_mix(col, base, 0.4))
    if gilt:
        for _ in range(70):  # gold flecks
            x, y = rng.randrange(W), rng.randrange(8, H)
            dr.point((x, y), fill=_mix(gold, light, rng.random() * 0.5))
        dr.rectangle([0, 0, W, 1], fill=_mix(gold, (255, 255, 255), 0.3))
    bottom_fade(img, shadow)


def wet_rock(img: Image.Image, rng: random.Random, base, light, shadow) -> None:
    base, light, shadow = _c(base), _c(light), _c(shadow)
    base_gradient(img, base, shadow)
    dr = ImageDraw.Draw(img)
    top_lip(dr, light, shadow, rng)
    # Irregular slab plates.
    bounds = row_bounds(5, 1.6)
    for r in range(len(bounds) - 1):
        y0, y1 = max(bounds[r], 6), bounds[r + 1]
        x = rng.randrange(-20, 0)
        while x < W:
            w = rng.randrange(34, 80)
            pts = [(x, y1), (x + rng.randrange(4, 14), y0 + 2),
                   (x + w - rng.randrange(4, 14), y0 + rng.randrange(0, 4)), (x + w, y1)]
            fill = _mix(base, light if rng.random() < 0.3 else shadow, rng.random() * 0.35)
            dr.polygon(pts, fill=fill)
            dr.line(pts[:2], fill=_mix(light, fill, 0.5))
            x += w + rng.randrange(-6, 6)
    # Wet specular streaks + puddle glints.
    for _ in range(60):
        x, y = rng.randrange(W), rng.randrange(10, H - 6)
        ln = rng.randrange(6, 22)
        dr.line([(x, y), (x + ln, y)], fill=_mix(light, (255, 255, 255), 0.35))
    for _ in range(14):
        x, y = rng.randrange(W), rng.randrange(16, H - 8)
        w, h = rng.randrange(10, 30), rng.randrange(2, 4)
        glint = _mix(light, (210, 240, 255), 0.55)
        dr.ellipse([x, y, x + w, y + h], fill=_mix(base, shadow, 0.4))
        dr.line([(x + 2, y + 1), (x + w - 3, y + 1)], fill=glint)
    # Sea spray speckle near the top edge.
    for _ in range(90):
        x, y = rng.randrange(W), rng.randrange(6, 16)
        if rng.random() < 0.5:
            dr.point((x, y), fill=_mix(light, (230, 245, 255), 0.5))
    bottom_fade(img, shadow)


def void_shards(img: Image.Image, rng: random.Random, base, light, shadow) -> None:
    base, light, shadow = _c(base), _c(light), _c(shadow)
    void = _mix(shadow, (0, 0, 0), 0.55)
    base_gradient(img, base, shadow)
    dr = ImageDraw.Draw(img)
    top_lip(dr, light, shadow, rng)
    bounds = row_bounds(4, 1.8)
    # Cracked plates with glowing rift seams between them.
    for r in range(len(bounds) - 1):
        y0, y1 = max(bounds[r], 6), bounds[r + 1]
        x = rng.randrange(-16, 0)
        while x < W:
            w = rng.randrange(40, 90)
            pts = [(x, y1), (x + rng.randrange(6, 18), y0 + 1),
                   (x + w - rng.randrange(6, 18), y0 + rng.randrange(0, 5)), (x + w, y1)]
            fill = _mix(base, light, rng.random() * 0.3)
            dr.polygon(pts, fill=fill)
            dr.line(pts[:2], fill=_mix(light, (255, 255, 255), 0.15))
            x += w + rng.randrange(2, 10)
    # Glowing shard teeth pointing up from the depths + floating fragments.
    glow = _mix(light, (255, 255, 255), 0.25)
    for _ in range(26):
        x = rng.randrange(6, W - 6)
        y = rng.randrange(20, H - 2)
        h = rng.randrange(5, 16)
        w = rng.randrange(3, 7)
        dr.polygon([(x, y), (x + w, y), (x + w // 2, y - h)], fill=fill_shard(rng, base, shadow, void))
        dr.line([(x + w // 2, y - h), (x, y)], fill=glow)
    for _ in range(16):  # floating fragments (small diamonds)
        x, y = rng.randrange(W), rng.randrange(12, H - 6)
        s = rng.randrange(2, 5)
        dr.polygon([(x, y - s), (x + s, y), (x, y + s), (x - s, y)],
                   fill=fill_shard(rng, base, light, void))
        dr.point((x, y - s), fill=glow)
    # Rift glow seams between plates.
    for _ in range(22):
        x = rng.randrange(W)
        y0 = rng.randrange(10, H - 14)
        y1 = y0 + rng.randrange(6, 16)
        dr.line([(x, y0), (x + rng.randrange(-4, 5), y1)], fill=glow)
    bottom_fade(img, void)


def fill_shard(rng: random.Random, base: tuple, alt: tuple, void: tuple) -> tuple:
    return _mix(base, alt if rng.random() < 0.4 else void, rng.random() * 0.5)


def save(img: Image.Image, key: str) -> int:
    out = img.resize((W * SCALE, H * SCALE), Image.NEAREST).convert("RGB")
    path = OUT_DIR / f"{key.replace('_', '-')}.png"
    q = out.quantize(colors=MAX_COLORS, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(path, optimize=True)
    return path.stat().st_size


BUILDERS = {
    "dojo-dusk": lambda img, rng, t: planks(img, rng, t["base"], t["light"], t["shadow"]),
    "mountain-temple": lambda img, rng, t: stone_slabs(img, rng, t["base"], t["light"], t["shadow"]),
    # Stable shrine slabs keep the storm foreground quiet enough for waves,
    # rain and combat silhouettes to remain readable.
    "storm-sea": lambda img, rng, t: stone_slabs(
        img, rng, t["base"], t["light"], t["shadow"], gilt=True, accent_color=t["light"]
    ),
    # The Rift shares the Dragon Shrine's stable slab silhouette. Its former
    # spike/shard teeth read as a broken platform once stretched in the arena;
    # purple highlights preserve the act identity without changing footing.
    "rift": lambda img, rng, t: stone_slabs(
        img, rng, t["base"], t["light"], t["shadow"], gilt=True, accent_color=t["light"]
    ),
    "dragon-shrine": lambda img, rng, t: stone_slabs(img, rng, t["base"], t["light"], t["shadow"], gilt=True),
}


def main() -> None:
    themes = parse_themes()
    print(f"{'asset':<22} {'size':>9} {'bytes':>8}")
    for theme_id, build in BUILDERS.items():
        t = themes[theme_id]
        img = Image.new("RGB", (W, H))
        rng = random.Random(seed_for(theme_id))
        build(img, rng, t)
        digest = hashlib.sha256(img.tobytes()).hexdigest()[:10]
        img2 = Image.new("RGB", (W, H))
        build(img2, random.Random(seed_for(theme_id)), t)
        if hashlib.sha256(img2.tobytes()).hexdigest()[:10] != digest:
            raise SystemExit(f"{theme_id}: generator not deterministic")
        size = save(img, KEYS[theme_id])
        print(f"{KEYS[theme_id]:<22} {W*SCALE}x{H*SCALE:<4} {size:>8}")
    print("done")


if __name__ == "__main__":
    main()
