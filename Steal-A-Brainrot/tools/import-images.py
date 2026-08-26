"""
Turns character artwork into game sprites.

Source images are whatever size the artist exported at, with the character
floating somewhere inside a big transparent square. The game needs the opposite:
a known frame with the character filling it and its feet on the bottom edge,
because creature sprites are drawn with origin (0.5, 1) at their ground point.

So: crop to the alpha bounding box, fit inside a SIZE square, centre
horizontally, sit it on the floor.

Runs under Blender purely for its image I/O and numpy — no scene, no render.

  blender -b --factory-startup --python import-images.py -- jobs=<json> size=352

jobs json: [{"src": "<abs path>", "dest": "<abs path>"}, ...]
"""
import bpy, sys, os, json
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
opts = dict(a.split("=", 1) for a in argv)

JOBS = json.load(open(opts["jobs"], encoding="utf8"))
SIZE = int(opts.get("size", 352))
FOOT = float(opts.get("foot", 0.0))     # gap under the feet, fraction of frame
CUT  = float(opts.get("cut", 0.02))     # alpha below this is "not the character"


def load_rgba(path):
    """(h, w, 4) float array. Blender's row 0 is the BOTTOM of the image."""
    img = bpy.data.images.load(path)
    img.alpha_mode = 'STRAIGHT'
    # Raw values in, raw values out — anything else double-applies gamma.
    try:
        img.colorspace_settings.name = 'Non-Color'
    except Exception:
        pass
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)


def resize(a, nw, nh):
    """Bilinear, on premultiplied colour so edge pixels do not halo."""
    h, w = a.shape[:2]
    p = a.copy()
    p[:, :, :3] *= p[:, :, 3:4]

    ys = (np.arange(nh) + 0.5) * h / nh - 0.5
    xs = (np.arange(nw) + 0.5) * w / nw - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    wy = np.clip(ys - np.floor(ys), 0, 1)[:, None, None]
    wx = np.clip(xs - np.floor(xs), 0, 1)[None, :, None]

    top = p[y0][:, x0] * (1 - wx) + p[y0][:, x1] * wx
    bot = p[y1][:, x0] * (1 - wx) + p[y1][:, x1] * wx
    out = top * (1 - wy) + bot * wy

    alpha = out[:, :, 3:4]
    np.divide(out[:, :, :3], alpha, out=out[:, :, :3], where=alpha > 1e-5)
    return np.clip(out, 0.0, 1.0)


def process(src, dest):
    a = load_rgba(src)
    h, w = a.shape[:2]

    rows = np.where(a[:, :, 3].max(axis=1) > CUT)[0]
    cols = np.where(a[:, :, 3].max(axis=0) > CUT)[0]
    if len(rows) == 0 or len(cols) == 0:
        raise SystemExit("fully transparent: " + src)
    a = a[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    ch, cw = a.shape[:2]

    # Fit inside the square by the LONGER side, so a wide character stays inside
    # one pedestal cell instead of sprawling over its neighbours.
    pad = int(round(SIZE * FOOT))
    box = SIZE - pad
    k = min(box / cw, box / ch)
    nw, nh = max(1, int(round(cw * k))), max(1, int(round(ch * k)))
    scaled = resize(a, nw, nh)

    canvas = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    x0 = (SIZE - nw) // 2
    canvas[pad:pad + nh, x0:x0 + nw] = scaled     # row 0 is the bottom: feet down

    out = bpy.data.images.new(os.path.basename(dest), SIZE, SIZE, alpha=True)
    out.alpha_mode = 'STRAIGHT'
    try:
        out.colorspace_settings.name = 'Non-Color'
    except Exception:
        pass
    out.pixels.foreach_set(canvas.ravel())
    out.file_format = 'PNG'
    out.filepath_raw = dest
    out.save()
    bpy.data.images.remove(out)
    return cw, ch, nw, nh


for job in JOBS:
    os.makedirs(os.path.dirname(job["dest"]) or ".", exist_ok=True)
    cw, ch, nw, nh = process(job["src"], job["dest"])
    print("IMPORTED %s crop=%dx%d -> %dx%d" % (os.path.basename(job["dest"]), cw, ch, nw, nh))

print("IMPORT_DONE %d" % len(JOBS))
