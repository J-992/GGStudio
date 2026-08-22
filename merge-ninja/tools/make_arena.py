#!/usr/bin/env python3
"""Legacy procedural arena concept backdrops for Merge Ninja.

Original art (c) Reaper8202. Every backdrop is generated deterministically
from a fixed seed; the only external input is the project's own
public/assets/arena-cloud-bank.png, which is composited into the storm theme.

The shipping later-act backdrops are now authored high-detail images matching
the stage-1 dojo. To prevent this prototype generator from overwriting them,
it writes palette studies under public/review/procedural-arenas/ only.

Usage: python3 tools/make_arena.py
"""

from __future__ import annotations

import hashlib
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "review" / "procedural-arenas"
W, H = 960, 540
MAX_COLORS = 64
MAX_BYTES = 350 * 1024

SEEDS = {"mountain": 20260822, "storm": 20260823, "shrine": 20260824}


def _clamp(v: float) -> int:
    return max(0, min(255, int(v)))


def _mix(a: tuple, b: tuple, f: float) -> tuple:
    return tuple(_clamp(x + (y - x) * f) for x, y in zip(a[:3], b[:3]))


def _sample_stops(stops: list[tuple[float, tuple]], t: float) -> tuple:
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            f = 0.0 if t1 <= t0 else (t - t0) / (t1 - t0)
            return _mix(c0, c1, f)
    return stops[-1][1]


def overlay() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return layer, ImageDraw.Draw(layer)


def banded_sky(stops: list[tuple[float, tuple]], bands: int, seed: int) -> Image.Image:
    """Hard colour bands with checkerboard dithering at every seam."""
    rng = random.Random(seed ^ 0xBAADF00D)
    img = Image.new("RGB", (W, H))
    band_h = H / bands
    cols = [_sample_stops(stops, ((b + 0.5) * band_h) / (H - 1)) for b in range(bands)]
    dr = ImageDraw.Draw(img)
    for b, col in enumerate(cols):
        y0, y1 = round(b * band_h), round((b + 1) * band_h)
        dr.rectangle([0, y0, W, y1], fill=col)
    px = img.load()
    for b in range(bands - 1):
        edge = round((b + 1) * band_h)
        c_up, c_dn = cols[b], cols[b + 1]
        for dy in (-2, -1, 0, 1, 2):
            y = edge + dy
            if not 0 <= y < H:
                continue
            f = (0.32, 0.6, 0.5, 0.6, 0.32)[dy + 2]
            base, other = (c_up, c_dn) if dy < 0 else (c_dn, c_up)
            for x in range(0, W, 2):
                if (x // 2 + y + rng.randrange(2)) % 2 == 0:
                    px[x, y] = _mix(base, other, f)
    return img


def scatter_stars(dr: ImageDraw.ImageDraw, rng: random.Random, count: int,
                  max_frac: float, palette: list[tuple]) -> None:
    for _ in range(count):
        x, y = rng.randrange(W), rng.randrange(int(H * max_frac))
        c = rng.choice(palette)
        if rng.random() > 0.88:
            dr.rectangle([x, y, x + 1, y], fill=c)
        else:
            dr.point((x, y), fill=c)


def ridge(dr: ImageDraw.ImageDraw, rng: random.Random, base_y: int, amp: int,
          color: tuple, step: int = 4) -> list[tuple[int, int]]:
    """Stepped mountain silhouette; returns its top edge for placing props."""
    phases = [rng.uniform(0, math.tau) for _ in range(3)]
    freqs = (1.6, 3.4, 6.2)
    amps = (1.0, 0.42, 0.18)
    pts: list[tuple[int, int]] = []
    for x in range(0, W + step, step):
        y = float(base_y)
        for f, p, a in zip(freqs, phases, amps):
            y -= amp * a * abs(math.sin(x / W * math.pi * f + p))
        pts.append((x, round(y / step) * step))
    dr.polygon(pts + [(W, H), (0, H)], fill=color)
    return pts


def ridge_y_at(pts: list[tuple[int, int]], x: int) -> int:
    xi = max(0, min(len(pts) - 1, round(x / W * (len(pts) - 1))))
    return pts[xi][1]


def pagoda(dr: ImageDraw.ImageDraw, cx: int, base_y: int, s: float, color: tuple) -> None:
    roof_h, wall_h = max(6, round(11 * s)), max(4, round(7 * s))
    flare = max(4, round(7 * s))
    y = base_y
    for i in range(3):
        w = round(s * (58 - 13 * (2 - i)))
        top = y - roof_h
        dr.polygon([
            (cx - w // 2 - flare, y), (cx - w // 6, top),
            (cx + w // 6, top), (cx + w // 2 + flare, y),
        ], fill=color)
        ww = max(6, round(w * 0.58))
        dr.rectangle([cx - ww // 2, y, cx + ww // 2, y + wall_h], fill=color)
        y = top - wall_h
    spire_top = y - max(6, round(9 * s))
    dr.line([(cx, spire_top), (cx, y + 2)], fill=color, width=max(1, round(2 * s)))
    tip = spire_top - max(2, round(4 * s))
    dr.polygon([(cx, tip), (cx + round(2 * s), spire_top),
                (cx, spire_top + round(2 * s)), (cx - round(2 * s), spire_top)], fill=color)


def torii(dr: ImageDraw.ImageDraw, cx: int, base_y: int, s: float, color: tuple) -> None:
    span, h = round(84 * s), round(64 * s)
    lw = max(3, round(6 * s))
    pl, pr = cx - span // 2, cx + span // 2
    dr.rectangle([pl, base_y - h, pl + lw, base_y], fill=color)
    dr.rectangle([pr - lw, base_y - h, pr, base_y], fill=color)
    ny = base_y - round(h * 0.72)
    tie_h = max(2, round(3.4 * s))
    dr.rectangle([pl - round(4 * s), ny, pr + round(4 * s), ny + tie_h], fill=color)
    dr.rectangle([cx - max(1, round(2 * s)), base_y - h, cx + max(1, round(2 * s)), ny], fill=color)
    dr.rectangle([pl - round(9 * s), base_y - h, pr + round(9 * s), base_y - h + lw], fill=color)
    dr.rectangle([pl - round(6 * s), base_y - h - lw, pr + round(6 * s), base_y - h], fill=color)


def mist_band(ov: ImageDraw.ImageDraw, rng: random.Random, y: int,
              color: tuple, alpha: int) -> None:
    x = rng.randrange(-80, 40)
    while x < W:
        seg_w = rng.randrange(140, 380)
        seg_h = rng.randrange(5, 13)
        ov.rectangle([x, y, min(W, x + seg_w), y + seg_h], fill=color + (alpha,))
        x += seg_w + rng.randrange(30, 130)


def grain(img: Image.Image, rng: random.Random, amount: int = 900) -> None:
    px = img.load()
    for _ in range(amount):
        x, y = rng.randrange(W), rng.randrange(H)
        r, g, b = px[x, y][:3]
        d = rng.choice((-14, -9, 9, 14))
        px[x, y] = (_clamp(r + d), _clamp(g + d), _clamp(b + d))


def vignette(img: Image.Image, strength: int = 56) -> None:
    grad = Image.radial_gradient("L").resize((W, H))
    mask = grad.point(lambda v: int(((v / 255.0) ** 1.7) * strength))
    img.paste(Image.new("RGB", (W, H), (5, 6, 12)), (0, 0), mask)


def save_optimized(img: Image.Image, path: Path) -> tuple[int, int]:
    size = MAX_BYTES + 1
    for colors in (MAX_COLORS, 48, 36, 28):
        q = img.convert("RGB").quantize(
            colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        q.save(path, optimize=True)
        size = path.stat().st_size
        if size <= MAX_BYTES:
            return colors, size
    raise SystemExit(f"{path.name} still {size} bytes after quantising to 28 colours")


# --------------------------------------------------------------------------
# Theme builders
# --------------------------------------------------------------------------

def build_mountain() -> Image.Image:
    rng = random.Random(SEEDS["mountain"])
    img = banded_sky([
        (0.00, (7, 10, 26)),
        (0.34, (18, 30, 62)),
        (0.58, (52, 78, 118)),
        (0.66, (104, 134, 168)),
        (1.00, (10, 16, 34)),
    ], bands=13, seed=SEEDS["mountain"]).convert("RGBA")
    dr = ImageDraw.Draw(img)
    scatter_stars(dr, rng, 130, 0.52,
                  [(206, 222, 245), (156, 178, 214), (232, 240, 252)])

    ov, od = overlay()
    mx, my, mr = round(W * 0.76), round(H * 0.19), 30
    for hr, ha in ((round(mr * 2.3), 22), (round(mr * 1.6), 30), (round(mr * 1.22), 40)):
        od.ellipse([mx - hr, my - hr, mx + hr, my + hr], fill=(198, 218, 244, ha))
    od.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(228, 238, 250, 255))
    for cxo, cyo, cw, chh in ((-8, -6, 12, 8), (6, 2, 10, 7), (-2, 9, 7, 5)):
        od.ellipse([mx + cxo, my + cyo, mx + cxo + cw, my + cyo + chh],
                   fill=(186, 204, 228, 255))

    far = ridge(dr, rng, round(H * 0.60), 62, (27, 44, 78))
    mid = ridge(dr, rng, round(H * 0.69), 84, (17, 28, 56))
    temple_col = (9, 15, 33)
    pagoda(dr, round(W * 0.30), ridge_y_at(mid, round(W * 0.30)) + 6, 1.05, temple_col)
    pagoda(dr, round(W * 0.63), ridge_y_at(mid, round(W * 0.63)) + 4, 0.8, temple_col)
    near = ridge(dr, rng, round(H * 0.79), 92, (10, 16, 34))
    torii(dr, round(W * 0.22), round(H * 0.88), 1.15, (6, 9, 22))
    dr.rectangle([0, round(H * 0.88), W, H], fill=(6, 9, 20, 255))

    mist_band(od, rng, ridge_y_at(far, W // 2) + 8, (188, 208, 232), 30)
    mist_band(od, rng, round(H * 0.70), (168, 192, 222), 24)
    mist_band(od, rng, ridge_y_at(near, W // 3) + 10, (148, 174, 208), 18)

    img.alpha_composite(ov)
    out = img.convert("RGB")
    grain(out, rng)
    vignette(out, 52)
    return out


def _cloud_bank_layer(path: Path, tint: tuple, scale: float) -> Image.Image:
    src = Image.open(path).convert("RGBA")
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.NEAREST)
    mask = ImageChops.multiply(src.convert("L"), src.getchannel("A"))
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", src.size, tint + (255,)), (0, 0), mask)
    return out


def build_storm() -> Image.Image:
    rng = random.Random(SEEDS["storm"])
    img = banded_sky([
        (0.00, (9, 12, 22)),
        (0.30, (18, 26, 44)),
        (0.52, (32, 44, 70)),
        (0.66, (47, 65, 96)),
        (1.00, (13, 19, 31)),
    ], bands=11, seed=SEEDS["storm"]).convert("RGBA")
    dr = ImageDraw.Draw(img)
    horizon = round(H * 0.66)
    dr.rectangle([0, horizon, W, H], fill=(14, 21, 34, 255))

    ov, od = overlay()
    for y_base, col in ((round(H * 0.17), (23, 31, 51)), (round(H * 0.07), (16, 23, 40))):
        x = -40
        while x < W + 40:
            rw, rh = rng.randrange(70, 150), rng.randrange(26, 52)
            od.ellipse([x, y_base - rh // 2, x + rw, y_base + rh], fill=col + (255,))
            x += round(rw * 0.62)

    bank_path = OUT_DIR / "arena-cloud-bank.png"
    if bank_path.exists():
        img.alpha_composite(_cloud_bank_layer(bank_path, (92, 112, 152), 1.6),
                            (-70, round(H * 0.24)))
        img.alpha_composite(_cloud_bank_layer(bank_path, (48, 62, 94), 2.1),
                            (-180, round(H * 0.36)))

    strike_x = rng.randrange(round(W * 0.56), round(W * 0.72))
    bolt: list[tuple[int, int]] = [(strike_x, round(H * 0.20))]
    y = bolt[0][1]
    while y < horizon:
        y += rng.randrange(18, 34)
        bolt.append((max(8, min(W - 8, bolt[-1][0] + rng.randrange(-16, 17))), min(y, horizon)))
    for width, col in ((9, (159, 216, 255, 60)), (4, (200, 232, 255, 130)), (2, (240, 250, 255, 255))):
        od.line(bolt, fill=col, width=width, joint="curve")
        for idx in (len(bolt) // 3, 2 * len(bolt) // 3):
            bx, by = bolt[idx]
            branch = [(bx, by)]
            bxx, byy = bx, by
            for _ in range(3):
                bxx += rng.randrange(-18, 19)
                byy += rng.randrange(8, 20)
                branch.append((bxx, byy))
            od.line(branch, fill=col, width=max(1, width // 2))
    ex = bolt[-1][0]
    for sy in range(horizon + 4, H, 7):
        fade = 1 - (sy - horizon) / (H - horizon)
        sw = max(1, round(7 * fade))
        jx = ex + rng.randrange(-4, 5)
        od.rectangle([jx - sw, sy, jx + sw, sy + 3],
                     fill=(207, 230, 255, int(150 * fade)))

    for row in range(horizon + 6, H, 7):
        shade = (30, 44, 66) if row % 14 == 0 else (22, 33, 52)
        for _ in range(3):
            wx = rng.randrange(-40, W)
            wl = rng.randrange(60, 220)
            od.rectangle([wx, row, wx + wl, row + 1], fill=shade + (255,))
    for _ in range(90):
        fx, fy = rng.randrange(W), rng.randrange(horizon + 4, H)
        od.point((fx, fy), fill=(127, 168, 200, 200))

    for _ in range(400):
        rx, ry = rng.randrange(W), rng.randrange(H)
        ln = rng.randrange(9, 21)
        od.line([(rx, ry), (rx + round(ln * 0.22), ry + ln)],
                fill=(109, 132, 166, rng.randrange(24, 44)), width=1)

    img.alpha_composite(ov)
    out = img.convert("RGB")
    grain(out, rng)
    vignette(out, 58)
    return out


def build_shrine() -> Image.Image:
    rng = random.Random(SEEDS["shrine"])
    img = banded_sky([
        (0.00, (26, 14, 44)),
        (0.30, (66, 30, 66)),
        (0.55, (128, 56, 50)),
        (0.75, (196, 108, 46)),
        (1.00, (94, 46, 34)),
    ], bands=14, seed=SEEDS["shrine"]).convert("RGBA")
    dr = ImageDraw.Draw(img)
    scatter_stars(dr, rng, 42, 0.24, [(176, 190, 226), (226, 210, 240)])

    ov, od = overlay()
    gx, gy = round(W * 0.46), round(H * 0.42)
    for gr, ha in ((300, 22), (215, 30), (145, 40)):
        od.ellipse([gx - gr, gy - gr * 0.72, gx + gr, gy + gr * 0.72],
                   fill=(255, 190, 106, ha))

    ground_y = round(H * 0.87)
    for step_i, (sw_, sy, col) in enumerate((
            (300, ground_y, (122, 76, 42)),
            (360, ground_y + 12, (92, 56, 34)),
            (430, ground_y + 26, (64, 40, 26)))):
        od.rectangle([gx - sw_ // 2, sy, gx + sw_ // 2, min(H, sy + 14)], fill=col + (255,))
    dr.rectangle([0, ground_y + 38, W, H], fill=(40, 20, 26, 255))
    for jx in range(30, W, 96):
        dr.line([(jx, ground_y + 38), (jx, H)], fill=(28, 12, 18, 255), width=2)

    gate_gold, gate_dark = (198, 136, 58), (58, 26, 20)
    torii(dr, gx, ground_y, 2.35, gate_gold)
    dr.rectangle([gx - round(112), ground_y - round(150),
                  gx + round(112), ground_y - round(144)], fill=(255, 216, 138, 255))

    px_, ptop = round(W * 0.80), round(H * 0.28)
    dr.rectangle([px_ - 13, ptop, px_ + 13, ground_y + 38], fill=(43, 20, 34, 255))
    dr.line([(px_ - 13, ptop), (px_ - 13, ground_y + 38)], fill=(255, 190, 106, 255), width=2)

    pts: list[tuple[float, float, float]] = []
    n = 26
    for i in range(n + 1):
        t = i / n
        py = (ground_y + 20) + (ptop - ground_y - 20) * t
        amp = 12 + 20 * math.sin(math.pi * min(1.0, t * 1.12))
        qx = px_ + math.sin(t * math.tau * 1.15 + 0.6) * amp
        pts.append((qx, py, 7 + 6 * math.sin(math.pi * t) ** 0.8))
    for dx, dy, col in ((2, 1, (255, 190, 106)), (0, 0, (36, 16, 30))):
        for qx, qy, qr in pts:
            ri = max(3, round(qr))
            od.ellipse([qx + dx - ri, qy + dy - ri, qx + dx + ri, qy + dy + ri], fill=col)
    hx, hy, hr = pts[-1]
    hr = round(hr) + 3
    for dx, dy, col in ((2, 1, (255, 190, 106)), (0, 0, (36, 16, 30))):
        od.ellipse([hx + dx - hr, hy + dy - hr, hx + dx + hr, hy + dy + hr], fill=col)
        od.polygon([(hx + dx, hy + dy - hr), (hx + dx + round(hr * 1.9), hy + dy - round(hr * 0.2)),
                    (hx + dx, hy + dy + round(hr * 0.5))], fill=col)
        od.polygon([(hx + dx - hr // 5, hy + dy - hr), (hx + dx + hr // 4, hy + dy - round(hr * 2.1)),
                    (hx + dx + round(hr * 0.7), hy + dy - round(hr * 0.9))], fill=col)
    od.line([(hx + round(hr * 1.6), hy + round(hr * 0.4)),
             (hx + round(hr * 3.1), hy + round(hr * 1.8))], fill=(255, 190, 106, 255), width=2)
    od.ellipse([hx + hr // 3, hy - round(hr * 0.5), hx + round(hr * 0.75), hy - hr // 6],
               fill=(255, 214, 120, 255))

    ember_cols = [(255, 185, 94), (255, 138, 60), (255, 230, 160)]
    for _ in range(170):
        ex = int(rng.gauss(gx, W * 0.16))
        ey = rng.randrange(round(H * 0.18), H - 8)
        col = rng.choice(ember_cols) + (rng.randrange(140, 235),)
        if rng.random() > 0.85:
            od.rectangle([ex, ey, ex + 1, ey], fill=col)
        else:
            od.point((ex, ey), fill=col)

    img.alpha_composite(ov)
    out = img.convert("RGB")
    grain(out, rng)
    vignette(out, 54)
    return out


BUILDERS = {"mountain": build_mountain, "storm": build_storm, "shrine": build_shrine}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"{'asset':<28} {'size':>10} {'bytes':>8} {'colours':>8}")
    for name, build in BUILDERS.items():
        img = build()
        digest = hashlib.sha256(img.tobytes()).hexdigest()[:12]
        again = hashlib.sha256(build().tobytes()).hexdigest()[:12]
        if digest != again:
            raise SystemExit(f"{name}: generator is not deterministic")
        colors, size = save_optimized(img, OUT_DIR / f"arena-{name}.png")
        print(f"arena-{name:<21} {W}x{H:>4} {size:>8} {colors:>8}")
    print("done")


if __name__ == "__main__":
    main()
