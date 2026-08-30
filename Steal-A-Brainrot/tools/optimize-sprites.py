"""
Squeezes assets/sprites/ so the build stays inside Poki's download budget.

Poki wants the initial download under 5 MB. Phaser alone is ~1.2 MB, which
leaves the sprite folder about 3.5 MB to live in -- and a folder of 352px
truecolour renders blows through that on its own. These are flat-shaded toy
models on a transparent background: they carry nowhere near 16.7M colours, so
an octree palette at 128 entries is visually free and roughly a 3x saving.

  python tools/optimize-sprites.py                    # report only
  python tools/optimize-sprites.py --apply
  python tools/optimize-sprites.py --apply --only=en_,dogecoin
  python tools/optimize-sprites.py --apply --colors=96

--only takes filename prefixes, so a pass can be limited to newly rendered art
instead of rewriting the whole folder.

Run it after render-props.py / render-art.mjs, before packaging.
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, "assets", "sprites")

args = sys.argv[1:]
APPLY = "--apply" in args
COLORS = next((int(a.split("=", 1)[1]) for a in args if a.startswith("--colors=")), 128)
ONLY = next((a.split("=", 1)[1].split(",") for a in args if a.startswith("--only=")), None)


def kb(n):
    return f"{n / 1024:.0f} KB"


def optimise(path):
    before = os.path.getsize(path)
    im = Image.open(path).convert("RGBA")
    # FASTOCTREE is the only PIL quantiser that keeps the alpha channel; the
    # default (median cut) drops it and every sprite gains a black box.
    out = im.quantize(colors=COLORS, method=Image.FASTOCTREE)
    if APPLY:
        out.save(path, optimize=True)
        after = os.path.getsize(path)
    else:
        tmp = path + ".probe.png"
        out.save(tmp, optimize=True)
        after = os.path.getsize(tmp)
        os.remove(tmp)
    return before, after


total_before = total_after = 0
for name in sorted(os.listdir(SPRITES)):
    if not name.lower().endswith(".png"):
        continue
    if ONLY and not any(name.startswith(p) for p in ONLY):
        continue
    b, a = optimise(os.path.join(SPRITES, name))
    total_before += b
    total_after += a
    print(f"  {name:24s} {kb(b):>9s} -> {kb(a):>9s}  ({100 - a * 100 // max(1, b)}% off)")

verb = "saved" if APPLY else "would save"
print(f"\n{verb} {kb(total_before - total_after)}: {kb(total_before)} -> {kb(total_after)}")
if not APPLY:
    print("(dry run -- pass --apply to write)")
