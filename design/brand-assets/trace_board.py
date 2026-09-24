"""Trace concepts 01 and 03-12 off the concept board into source/.

For each concept this crops the large mark from input/early-exploration.png,
separates it from the tile background, and writes:

- source/NN-name-trace.txt: a potrace outline of the mark, in 8x crop pixels.
- source/NN-name-fill.webp: the mark's own shading at 8x, with colors pushed
  outward past the outline so no background halo shows at the edge.
- source/NN-name.json: crop size and mark bounds.

build.py clips the fill to the outline. Needs numpy, scipy, pillow, and the
potrace CLI (brew install potrace). Concept 02 is drawn by hound_hour.py.
"""

from pathlib import Path
import io
import json
import re
import subprocess

import numpy as np
from PIL import Image
from scipy import ndimage as nd

from build import NAMES, DARK

ROOT = Path(__file__).parent
BOARD = ROOT.parent / "input" / "early-exploration.png"
SCALE = 8
TILE_X = (14, 373, 729, 1085)
TILE_Y = (165, 442, 719)
# Crop inside each tile: the large mark, above the wordmark (which starts 174 px
# down in every tile), left of the small icon.
CROP = (6, 2, 226, 170)
# 06's bottom gem reaches just past the wordmark's top.
CROP_OVERRIDES = {6: (6, 2, 226, 178)}


def background(im):
    """Fit a linear gradient to the crop border, ignoring shapes that touch it."""
    h, w, _ = im.shape
    yy, xx = np.mgrid[0:h, 0:w]
    border = np.zeros((h, w), bool)
    border[:3] = border[-3:] = True
    border[:, :3] = border[:, -3:] = True
    a = np.c_[xx[border], yy[border], np.ones(border.sum())]
    values = im[border]
    keep = np.ones(len(a), bool)
    for _ in range(4):
        coef = np.linalg.lstsq(a[keep], values[keep], rcond=None)[0]
        res = np.sqrt(((a @ coef - values) ** 2).sum(-1))
        keep = res < max(6, np.percentile(res, 60))
    return (np.c_[xx.ravel(), yy.ravel(), np.ones(h * w)] @ coef).reshape(h, w, 3)


def potrace(mask):
    pbm = io.BytesIO()
    Image.fromarray(~mask).convert("1").save(pbm, "PPM")
    out = subprocess.run(
        ["potrace", "-s", "-a", "1.0", "-O", "0.8", "-t", "40", "-o", "-", "-"],
        input=pbm.getvalue(), capture_output=True, check=True).stdout.decode()
    height = mask.shape[0]
    paths = re.findall(r'<path d="([^"]+)"', out, re.S)
    return "".join(bake(d.replace("\n", " "), height) for d in paths)


def bake(d, height):
    # Apply potrace's translate(0 height) scale(.1 -.1) to the path data.
    out = []
    for cmd, args in re.findall(r"([MmLlCcZz])([^MmLlCcZz]*)", d):
        nums = [float(n) for n in re.findall(r"-?[\d.]+", args)]
        pts = []
        for i in range(0, len(nums), 2):
            x, y = nums[i] * .1, nums[i + 1] * -.1
            if cmd.isupper():
                y += height
            pts.append(f"{x:.1f} {y:.1f}")
        out.append(cmd + " ".join(pts))
    return "".join(out)


def trace(index):
    col, row = (index - 1) % 4, (index - 1) // 4
    crop = CROP_OVERRIDES.get(index, CROP)
    x, y = TILE_X[col] + crop[0], TILE_Y[row] + crop[1]
    src = Image.open(BOARD).convert("RGB").crop((x, y, x + crop[2], y + crop[3]))
    im = nd.median_filter(np.asarray(src, float), size=(3, 3, 1))
    dist = np.sqrt(((im - background(im)) ** 2).sum(-1))
    threshold = 28 if index in DARK else 14

    # Upscale color and distance, then threshold a smoothed distance for the outline.
    size = (crop[2] * SCALE, crop[3] * SCALE)
    color = np.asarray(Image.fromarray(im.clip(0, 255).astype(np.uint8)).resize(size, Image.LANCZOS), float)
    big = np.asarray(Image.fromarray(dist.astype(np.float32)).resize(size, Image.BICUBIC))
    big = nd.gaussian_filter(big, 5)
    mask = big > threshold
    labels, count = nd.label(mask)
    areas = nd.sum(mask, labels, range(1, count + 1))
    bottom = set(np.unique(labels[-1]))
    for label, area in enumerate(areas, 1):
        # Drop specks, and wordmark slivers poking up through the bottom edge.
        if area < 600 or (label in bottom and area < 8000):
            mask[labels == label] = False

    # Push solid interior colors outward over the anti-aliased rim.
    core = big > threshold * 2.2
    _, (iy, ix) = nd.distance_transform_edt(~core, return_indices=True)
    fill = color[iy, ix]
    alpha = nd.binary_dilation(mask, iterations=12)

    ys, xs = np.nonzero(mask)
    key = f"{index:02d}-{NAMES[index - 1]}"
    rgba = np.dstack([fill.clip(0, 255), alpha * 255]).astype(np.uint8)
    Image.fromarray(rgba).save(ROOT / "source" / f"{key}-fill.webp", quality=90, method=6)
    (ROOT / "source" / f"{key}-trace.txt").write_text(potrace(mask) + "\n")
    (ROOT / "source" / f"{key}.json").write_text(json.dumps({
        "width": size[0], "height": size[1],
        "bounds": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    }) + "\n")
    Image.fromarray((mask * 255).astype(np.uint8)).save(ROOT / "source" / f"{key}-mask.png")


if __name__ == "__main__":
    for i in range(1, 13):
        if i != 2:
            trace(i)
            print(f"{i:02d} traced")
