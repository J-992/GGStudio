"""
Grades a Meshy render to the game's palette and packs a walk cycle into one
horizontal sprite sheet.

Meshy's basecolor comes out muted (the body reads S=0.33 V=0.56) next to a game
drawn from flat saturated fills, so the body hue is pushed onto the Config.js
colour and its mean saturation/value scaled to match. Only the body band is
touched: the near-grey visor and joints and the yellow accents keep their own
colour, which is what stops the grade turning the whole robot into a silhouette.
"""
from PIL import Image, ImageFilter
import numpy as np, colorsys, os, sys

FRAMES = [1, 5, 9, 13, 17, 21, 25, 29]          # even 8 of the 32-frame cycle
BODY_HUE_BAND = (150 / 360, 215 / 360)          # the teal Meshy gave us
MIN_SAT = 0.10                                  # below this it is a grey, leave it

rgb2hsv = np.vectorize(colorsys.rgb_to_hsv)
hsv2rgb = np.vectorize(colorsys.hsv_to_rgb)

def grade(im, target_hex, target_s, target_v):
    a = np.array(im).astype(np.float64) / 255.0
    rgb, alpha = a[:, :, :3], a[:, :, 3]
    h, s, v = rgb2hsv(rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2])

    body = (alpha > 0.03) & (s > MIN_SAT) & (h >= BODY_HUE_BAND[0]) & (h <= BODY_HUE_BAND[1])
    if body.sum() == 0:
        return im

    tr, tg, tb = (int(target_hex[i:i+2], 16) / 255 for i in (0, 2, 4))
    th, _, _ = colorsys.rgb_to_hsv(tr, tg, tb)

    # Scale rather than replace, so the model's own shading survives the grade.
    s_gain = target_s / s[body].mean()
    v_gain = target_v / v[body].mean()
    h = np.where(body, th, h)
    s = np.where(body, np.clip(s * s_gain, 0, 1), s)
    v = np.where(body, np.clip(v * v_gain, 0, 1), v)

    r, g, b = hsv2rgb(h, s, v)
    out = np.dstack([r, g, b, alpha])
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")

def outline(im, hex_color, grow=3):
    """Dark rim so the runner survives any surface it crosses.

    Bea's orange against the floor's yellow is the case that needs it: without
    a rim the two values are close enough that her silhouette dissolves at
    100px. A darker shade of the body colour reads better here than black.
    """
    a = im.getchannel("A")
    grown = a.filter(ImageFilter.MaxFilter(grow * 2 + 1))
    rim = Image.new("RGBA", im.size, tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4)) + (255,))
    rim.putalpha(grown)
    rim.alpha_composite(im)
    return rim

def sheet(src_dir, out_path, target_hex, target_s, target_v, rim_hex):
    ims = [outline(grade(Image.open(f"{src_dir}/f{f:03d}.png").convert("RGBA"),
                         target_hex, target_s, target_v), rim_hex)
           for f in FRAMES]
    w, h = ims[0].size
    out = Image.new("RGBA", (w * len(ims), h), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        out.paste(im, (i * w, 0))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # Flat shaded colour quantises almost losslessly and roughly quarters the
    # file; the alpha is kept separate so the rim does not get dithered.
    alpha = out.getchannel("A")
    q = out.convert("RGB").quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE)
    q = q.convert("RGBA")
    q.putalpha(alpha)
    q.save(out_path, optimize=True)
    out = q
    return out.size, os.path.getsize(out_path), w, h

if __name__ == "__main__":
    dest = sys.argv[1]
    for src, name, hexc, s, v, rim in [
        ("volt", "runnerA", "53c8d6", 0.58, 0.86, "1f5f6b"),   # Volt - bright teal
        ("bea2", "runnerB", "ff9a3d", 0.72, 0.88, "8f3f0d"),   # Bea  - warm orange
    ]:
        size, nbytes, fw, fh = sheet(src, f"{dest}/{name}.png", hexc, s, v, rim)
        print(f"  {name}.png  sheet {size[0]}x{size[1]}  frame {fw}x{fh} x{len(FRAMES)}  {nbytes/1024:.1f} KB")
