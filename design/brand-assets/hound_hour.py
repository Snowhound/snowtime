"""Draw concept 02, Hound Hour, from the silhouette traced off the concept board.

The hound outline in source/02-hound-hour-trace.txt is a potrace trace of
source/02-hound-hour-mask.png, which was thresholded from the 02 tile of
input/early-exploration.png at 8x. The clock arc, hands, and tick are exact
geometry fitted to that mask. Coordinates share the mask's 1520 x 1200 space.
"""

from pathlib import Path
import math

ROOT = Path(__file__).parent
HOUND_D = (ROOT / "source" / "02-hound-hour-trace.txt").read_text().strip()

# Circles fitted to the outer and inner edges of the arc; the arc tapers.
OUTER_C, OUTER_R = (969.0, 533.5), 491.0
INNER_C, INNER_R = (943.2, 549.1), 435.8
MID_C = (956.0, 541.0)

THEMES = {
    "dark": dict(
        bg="#0f1f2e", bg2="#17293b", h0="#ffffff", h1="#cfe2f6",
        lift=("#ffffff", .5), shade=("#b9d4f0", .22), deep=("#a8c9ec", .3),
        a0="#e8f2fd", a1="#78ade2", hands="#ffffff", tick="#8dbdea",
    ),
    "light": dict(
        bg="#f4faff", bg2="#eaf4fe", h0="#2b6aa6", h1="#78addf",
        lift=("#5b97d0", .35), shade=("#1f5c97", .25), deep=("#9cc6ee", .45),
        a0="#a9cdef", a1="#5f98cf", hands="#0f1f2e", tick="#5f98cf",
    ),
}

# Low-poly planes clipped to the hound, echoing the board's faceted shading.
FACETS = [
    ("M430 160 L860 300 L700 560 L420 470Z", "lift"),        # muzzle and brow
    ("M150 600 L420 470 L560 900 L60 1080Z", "shade"),       # neck ruff
    ("M700 560 L760 780 L1000 1000 L620 1000Z", "shade"),    # chest
    ("M620 1000 L1000 1000 L1420 1160 L700 1180Z", "deep"),  # tail sweep
    ("M440 840 L660 930 L560 1180Z", "lift"),
]


def _vertical_hit(c, r, x):
    return (x, c[1] - math.sqrt(r * r - (x - c[0]) ** 2))


def _ray_hit(c, r, origin, angle):
    dx, dy = math.cos(angle), math.sin(angle)
    fx, fy = origin[0] - c[0], origin[1] - c[1]
    b = fx * dx + fy * dy
    t = -b + math.sqrt(b * b - (fx * fx + fy * fy - r * r))
    return (origin[0] + t * dx, origin[1] + t * dy)


def _arc():
    # Flat vertical cut at the top, radial cut at the lower end.
    p = lambda q: f"{q[0]:.1f} {q[1]:.1f}"
    end = math.radians(38.6)
    o0, i0 = _vertical_hit(OUTER_C, OUTER_R, 914), _vertical_hit(INNER_C, INNER_R, 914)
    o1, i1 = _ray_hit(OUTER_C, OUTER_R, MID_C, end), _ray_hit(INNER_C, INNER_R, MID_C, end)
    return (f"M{p(o0)} A{OUTER_R} {OUTER_R} 0 0 1 {p(o1)} L{p(i1)} "
            f"A{INNER_R} {INNER_R} 0 0 0 {p(i0)} Z")


def mark(theme, uid, small=False):
    """Return the mark's SVG elements in mask space, without an <svg> wrapper."""
    t = THEMES[theme]
    hound = f'<path d="{HOUND_D}"/>'
    facets = "" if small else "".join(
        f'<path d="{d}" fill="{t[k][0]}" opacity="{t[k][1]}"/>' for d, k in FACETS)
    hand_width = 78 if small else 54
    return (
        f'<defs><linearGradient id="h{uid}" x1="300" y1="150" x2="1200" y2="1150" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{t["h0"]}"/><stop offset=".5" stop-color="{t["h0"]}"/>'
        f'<stop offset="1" stop-color="{t["h1"]}"/></linearGradient>'
        f'<linearGradient id="a{uid}" x1="950" y1="40" x2="1350" y2="860" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{t["a0"]}"/><stop offset="1" stop-color="{t["a1"]}"/></linearGradient>'
        f'<clipPath id="c{uid}">{hound}</clipPath></defs>'
        f'<g fill="url(#h{uid})">{hound}</g>'
        f'<g clip-path="url(#c{uid})">{facets}</g>'
        f'<path d="{_arc()}" fill="url(#a{uid})"/>'
        f'<path d="M1001 318 L998 588 L1188 469" fill="none" stroke="{t["hands"]}" '
        f'stroke-width="{hand_width}" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<rect x="-40" y="-25" width="80" height="50" rx="9" fill="{t["tick"]}" '
        f'transform="translate(1257 887) rotate(43)"/>'
    )


def icon(small=False, size=128, label="Snowtime 02 hound hour", theme="dark"):
    """App-icon tile: the white mark on navy, or with theme="light" the slate-blue mark on the ice
    tile of the other light-tile concepts. The small variant zooms in and drops the facets."""
    side = 1500 if small else 1720
    # Mark bounds are about x 79..1460, y 38..1160; nudge left and down to center optically.
    ox = (side - 1381) / 2 - 79 - 20
    oy = (side - 1122) / 2 - 38 + 10
    t = THEMES[theme]
    uid = ("s" if small else "f") + ("l" if theme == "light" else "")
    # Top and bottom of the tile gradient, and the light tile's border, match build.py's TILES.
    top, bottom, border = (t["bg2"], t["bg"], None) if theme == "dark" else ("#f9fcff", "#e6f1fc", "#d7ecfc")
    inset = side * .006 if border else 0
    rect = f'width="{side}" height="{side}"' if not border else (
        f'x="{inset:.0f}" y="{inset:.0f}" width="{side - 2 * inset:.0f}" height="{side - 2 * inset:.0f}" '
        f'stroke="{border}" stroke-width="{side * .012:.0f}"')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" width="{size}" height="{size}" '
        f'role="img" aria-label="{label}"><defs><linearGradient id="bg{uid}" x1="0" y1="0" x2="0" y2="{side}" '
        f'gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{top}"/>'
        f'<stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
        f'<rect {rect} rx="{side * .225:.0f}" fill="url(#bg{uid})"/>'
        f'<g transform="translate({ox:.0f} {oy:.0f})">{mark(theme, uid, small)}</g></svg>'
    )


def bare_mark(theme):
    """The mark alone on a transparent background, as on the board's lockups."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 20 1420 1160" width="1420" height="1160" '
            f'role="img" aria-label="Snowtime">{mark(theme, "m" + theme)}</svg>')


def lockup(theme, wordmark_svg):
    """Horizontal mark + wordmark, laid out like the asset board's hero."""
    inner = wordmark_svg.split(">", 1)[1].rsplit("</svg>", 1)[0]
    view = wordmark_svg.split('viewBox="', 1)[1].split('"', 1)[0].split()
    ww, wh = float(view[2]), float(view[3])
    ink = THEMES[theme]["hands"]
    # Mark 1420 x 1160 scaled to 128 high; the board's cap height is about 37% of that.
    ms = 128 / 1160
    ws = .74
    wx = 1420 * ms + 18
    width = wx + ww * ws
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 128" width="{width:.0f}" height="128" '
        f'role="img" aria-label="Snowtime"><g transform="scale({ms:.5f}) translate(-60 -20)">{mark(theme, "l" + theme)}</g>'
        f'<g transform="translate({wx:.1f} {(128 - wh * ws) / 2 + 4:.1f}) scale({ws})" fill="{ink}">{inner}</g></svg>'
    )
