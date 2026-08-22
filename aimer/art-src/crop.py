"""
Turns the original images in this folder into the round target skins the game
ships in `public/skins`.

The originals are megabytes of full scenes; a target is never drawn wider than
about 108 design pixels, so shipping the originals would cost the player most
of a megabyte each to show a face fifty pixels across. This script frames each
one on its subject, squares it, and writes a 256px file -- which is still twice
the size anything is drawn at.

    python3 art-src/crop.py sheet.png           # preview the framing
    python3 art-src/crop.py sheet.png --write   # write public/skins/*.png

Every entry is (id, source, focusX, focusY, zoom). Focus is 0..1 in the
source's own space and marks what the crop should centre on; zoom is the
fraction of the short side to take, so smaller means tighter. The id is also
the texture key and the `art` field of the matching entry in data/skins.ts.

Adding an image: drop it here, add a row, run with --write, then add a
PHOTO_SKINS entry in core/photoskins.ts and a SKINS entry in data/skins.ts.
"""

from PIL import Image, ImageDraw
import os
import sys

RES = 256
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'skins')

PLAN = [
    #  id          source               focusX focusY zoom
    ('liquid',   'image.png',           0.50,  0.50,  1.00),
    ('ember',    'image copy 5.png',    0.50,  0.50,  1.00),
    ('capybara', 'image copy.png',      0.50,  0.44,  0.82),
    ('doge',     'image copy 2.png',    0.50,  0.46,  0.92),
    ('nyan',     'image copy 3.png',    0.50,  0.33,  0.72),
    ('boots',    'image copy 4.png',    0.535, 0.44,  0.70),
    ('sticky',   'image copy 6.png',    0.53,  0.27,  0.48),
    ('treeman',  'image copy 7.png',    0.50,  0.33,  0.44),
    ('sharky',   'image copy 8.png',    0.29,  0.43,  0.44),
    ('latte',    'image copy 9.png',    0.52,  0.34,  0.62),
    ('johnPork', 'johnPork.png',        0.40,  0.42,  0.88),
]


def bake(src, fx, fy, zoom):
    """The framed square. The circle and the vignette are applied at runtime."""
    im = Image.open(os.path.join(HERE, src)).convert('RGB')
    w, h = im.size
    take = int(min(w, h) * zoom)
    cx, cy = int(w * fx), int(h * fy)

    #  Keep the window on the image, so a focal point near an edge still gives
    #  a full square instead of a letterboxed one.
    x = max(0, min(w - take, cx - take // 2))
    y = max(0, min(h - take, cy - take // 2))

    return im.crop((x, y, x + take, y + take)).resize((RES, RES), Image.LANCZOS)


def preview(im):
    """What core/photoskins will make of it: circle-cropped and vignetted."""
    vig = Image.new('L', (RES, RES), 0)
    d = ImageDraw.Draw(vig)

    for i in range(RES // 2, 0, -1):
        t = (RES / 2 - i) / (RES / 2)
        inner = 0.34
        d.ellipse([RES/2 - i, RES/2 - i, RES/2 + i, RES/2 + i],
                  outline=0 if t < inner else int(255 * 0.38 * ((t - inner) / (1 - inner))))

    im = Image.composite(Image.new('RGB', (RES, RES), (0, 0, 0)), im, vig)

    mask = Image.new('L', (RES, RES), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, RES - 1, RES - 1], fill=255)

    out = Image.new('RGBA', (RES, RES), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def main():
    dest = next((a for a in sys.argv[1:] if not a.startswith('--')), 'sheet.png')
    write = '--write' in sys.argv

    if write:
        os.makedirs(OUT, exist_ok=True)

    cols = 6
    rows = (len(PLAN) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * 140 + 20, rows * 210 + 20), (8, 11, 28, 255))
    total = 0

    for i, (sid, src, fx, fy, z) in enumerate(PLAN):
        square = bake(src, fx, fy, z)

        if write:
            #  These are photographs and flat vector art both; 128 colours is
            #  invisible at target size and roughly a third of the bytes.
            path = os.path.join(OUT, sid + '.png')
            square.quantize(colors=128, method=Image.MEDIANCUT).save(path, optimize=True)
            total += os.path.getsize(path)
            print('%-28s %3d KB' % (os.path.relpath(path), os.path.getsize(path) // 1024))

        #  Shown at the two sizes that matter: a level-1 target and a level-40 one.
        round_ = preview(square)
        ox, oy = 20 + (i % cols) * 140, 20 + (i // cols) * 210
        sheet.alpha_composite(round_.resize((110, 110), Image.LANCZOS), (ox, oy))
        sheet.alpha_composite(round_.resize((50, 50), Image.LANCZOS), (ox + 30, oy + 122))
        ImageDraw.Draw(sheet).text((ox, oy + 184), sid, fill=(200, 210, 235))

    sheet.convert('RGB').save(dest)

    if write:
        print('%-28s %3d KB' % ('total', total // 1024))


if __name__ == '__main__':
    main()
