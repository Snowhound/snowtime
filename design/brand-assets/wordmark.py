"""Outline the Snowtime wordmark in Plus Jakarta Sans Bold.

Plus Jakarta Sans (SIL OFL 1.1, fonts/PlusJakartaSans-OFL.txt) is the closest
open font to the concept board lettering. Needs fonttools and uharfbuzz:
pip install fonttools uharfbuzz
"""

from pathlib import Path
import io

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).parent
FONT = ROOT / "fonts" / "PlusJakartaSans[wght].ttf"
TEXT = "Snowtime"
WEIGHT = 700
TRACKING = -20   # font units, about -0.02 em
CAP = 64         # cap height in the 88-unit-high viewBox
HEIGHT = 88


def build():
    font = instantiateVariableFont(TTFont(FONT), {"wght": WEIGHT})
    buf = io.BytesIO()
    font.save(buf)
    hb_font = hb.Font(hb.Face(buf.getvalue()))
    text = hb.Buffer()
    text.add_str(TEXT)
    text.guess_segment_properties()
    hb.shape(hb_font, text)

    scale = CAP / font["OS/2"].sCapHeight
    baseline = (HEIGHT + CAP) / 2
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    x = 0
    paths = []
    for info, pos in zip(text.glyph_infos, text.glyph_positions):
        pen = SVGPathPen(glyphs, lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        glyphs[order[info.codepoint]].draw(
            TransformPen(pen, (scale, 0, 0, -scale, (x + pos.x_offset) * scale, baseline)))
        paths.append(f'<path d="{pen.getCommands()}"/>')
        x += pos.x_advance + TRACKING
    width = (x - TRACKING) * scale
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {HEIGHT}" '
            f'width="{width:.0f}" height="{HEIGHT}" fill="#0f1f2e" role="img" aria-label="Snowtime">'
            f'{"".join(paths)}</svg>')


if __name__ == "__main__":
    (ROOT / "wordmark.svg").write_text(build() + "\n")
