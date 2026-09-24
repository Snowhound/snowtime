"""Build the Snowtime concept pack from the shapes traced off the concept board.

trace_board.py writes each concept's outline and shading to source/; this
script clips the shading to the outline and sets it on a tile. Concept 02 is
drawn by hound_hour.py. Runs on the standard library alone.
"""

from pathlib import Path
import base64
import json
import xml.etree.ElementTree as ET

import hound_hour

ROOT = Path(__file__).parent
NAVY = "#0f1f2e"
WHITE = "#ffffff"

# Concepts drawn on a navy tile; the rest sit on an ice tile.
DARK = {2, 4, 5, 7, 10, 12}

NAMES = [
    "frost-clock", "hound-hour", "peak-time", "progress-flurry",
    "snow-s-monogram", "crystal-time", "tracking-together", "new-day",
    "st-monogram", "north-star", "the-trail", "snow-crystal",
]

TILES = {
    True: ("#17293b", "#0f1f2e", "none"),     # top, bottom, border
    False: ("#f9fcff", "#e6f1fc", "#d7ecfc"),
}


def traced_mark(key, uid):
    """The traced mark in 8x crop pixels, and its bounds."""
    meta = json.loads((ROOT / "source" / f"{key}.json").read_text())
    trace = (ROOT / "source" / f"{key}-trace.txt").read_text().strip()
    fill = base64.b64encode((ROOT / "source" / f"{key}-fill.webp").read_bytes()).decode()
    body = (f'<clipPath id="c{uid}"><path d="{trace}"/></clipPath>'
            f'<image width="{meta["width"]}" height="{meta["height"]}" clip-path="url(#c{uid})" '
            f'href="data:image/webp;base64,{fill}"/>')
    return body, meta["bounds"]


# Light-page marks: the board's shading is pale, drawn for a navy or ice tile, so on a light page
# its luminance is mapped onto brand blues. Dark inks such as clock hands stay navy; the palest
# parts, most of each mark, become the deepest blue. Table stops at luminance 0, .25, .5, .75, 1.
LIGHT_RAMP = ["#0f1f2e", "#1f5c97", "#5b92c8", "#3b82b8", "#1f5c97"]
# Dark-page marks of the light-tile concepts: their navy inks (clock hands) would vanish on a dark
# page, so dark tones turn pale and the rest keep a pale-blue ramp. Navy-tile concepts need none.
DARK_RAMP = ["#e8f2fd", "#a9cdef", "#78ade2", "#b9d4f0", "#ffffff"]


def _ramp_filter(uid, ramp):
    rgb = [[int(c[k:k + 2], 16) / 255 for c in ramp] for k in (1, 3, 5)]
    funcs = "".join(f'<feFunc{ch} type="table" tableValues="{" ".join(f"{v:.3f}" for v in vals)}"/>'
                    for ch, vals in zip("RGB", rgb))
    lum = "0.2126 0.7152 0.0722 0 0 "
    return (f'<filter id="r{uid}" color-interpolation-filters="sRGB">'
            f'<feColorMatrix type="matrix" values="{lum * 3}0 0 0 1 0"/>'
            f'<feComponentTransfer>{funcs}</feComponentTransfer></filter>')


def traced_bare(i, theme):
    """The traced mark alone, for a light or a dark page, recolored where the board's shading
    would be too faint for that page."""
    key = f"{i:02d}-{NAMES[i - 1]}"
    uid = f"{i:02d}m{theme[0]}"
    body, (x0, y0, x1, y1) = traced_mark(key, uid)
    ramp = LIGHT_RAMP if theme == "light" else None if i in DARK else DARK_RAMP
    if ramp:
        body = f'<defs>{_ramp_filter(uid, ramp)}</defs><g filter="url(#r{uid})">{body}</g>'
    pad = max(x1 - x0, y1 - y0) * .02
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0 - pad:.0f} {y0 - pad:.0f} {w:.0f} {h:.0f}" '
            f'width="{w / 10:.0f}" height="{h / 10:.0f}" role="img" aria-label="Snowtime">{body}</svg>')


def traced_icon(i, small=False, size=128):
    """A traced concept on its tile. The small variant zooms in for tab sizes."""
    key = f"{i:02d}-{NAMES[i - 1]}"
    uid = f"{i:02d}{'s' if small else 'f'}"
    body, (x0, y0, x1, y1) = traced_mark(key, uid)
    side = max(x1 - x0, y1 - y0) / (.84 if small else .72)
    ox, oy = (side - (x1 - x0)) / 2 - x0, (side - (y1 - y0)) / 2 - y0
    top, bottom, border = TILES[i in DARK]
    edge = (f' stroke="{border}" stroke-width="{side * .012:.0f}"' if border != "none" else "")
    inset = side * .006 if border != "none" else 0
    label = f"Snowtime {i:02d} small icon" if small else f"Snowtime {i:02d} {NAMES[i - 1].replace('-', ' ')}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side:.0f} {side:.0f}" width="{size}" height="{size}" '
        f'role="img" aria-label="{label}"><defs><linearGradient id="bg{uid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
        f'<rect x="{inset:.0f}" y="{inset:.0f}" width="{side - 2 * inset:.0f}" height="{side - 2 * inset:.0f}" '
        f'rx="{side * .225:.0f}" fill="url(#bg{uid})"{edge}/>'
        f'<g transform="translate({ox:.0f} {oy:.0f})">{body}</g></svg>'
    )


def traced_lockup(i, wordmark, on_dark):
    """Bare mark + wordmark, as on the board: navy text on light, white on dark."""
    key = f"{i:02d}-{NAMES[i - 1]}"
    uid = f"{i:02d}l{'d' if on_dark else ''}"
    word_inner = wordmark.split(">", 1)[1].rsplit("</svg>", 1)[0]
    word_w = float(wordmark.split('width="', 1)[1].split('"', 1)[0])
    ink = WHITE if on_dark else NAVY
    if i in DARK and not on_dark:
        # Pale marks vanish on a light page, so the light lockup keeps the navy tile.
        mark = traced_icon(i).split(">", 1)[1].rsplit("</svg>", 1)[0].replace('id="bg', 'id="lbg').replace("url(#bg", "url(#lbg")
        side = float(traced_icon(i).split('viewBox="0 0 ', 1)[1].split()[0])
        scale, mark_w, tx, ty = 128 / side, 128, 0, 0
    else:
        mark, (x0, y0, x1, y1) = traced_mark(key, uid)
        scale = 128 / (y1 - y0)
        mark_w = min((x1 - x0) * scale, 190)
        scale = min(scale, 190 / (x1 - x0))
        tx, ty = -x0, -y0 + (128 / scale - (y1 - y0)) / 2
    ws = .74
    wx = mark_w + 18
    width = wx + word_w * ws
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 128" width="{width:.0f}" height="128" '
        f'role="img" aria-label="Snowtime {i:02d} lockup">'
        f'<g transform="scale({scale:.5f}) translate({tx:.0f} {ty:.0f})">{mark}</g>'
        f'<g transform="translate({wx:.1f} {(128 - 88 * ws) / 2 + 4:.1f}) scale({ws})" fill="{ink}">{word_inner}</g></svg>'
    )


def save(pathname, content):
    pathname.parent.mkdir(parents=True, exist_ok=True)
    pathname.write_text(content + "\n")


def make_wordmark():
    # Outlined Plus Jakarta Sans Bold, generated by wordmark.py.
    return (ROOT / "wordmark.svg").read_text().strip()


def main():
    for i,name in enumerate(NAMES,1):
        key = f"{i:02d}-{name}"
        dark = i in DARK
        if i == 2:
            # Hound Hour is drawn from the board trace; see hound_hour.py.
            save(ROOT / "icons" / f"{key}.svg", hound_hour.icon())
            save(ROOT / "icons-small" / f"{key}.svg", hound_hour.icon(small=True, label="Snowtime 02 small icon"))
            # The ice-tile version, which the prototypes show on light pages.
            save(ROOT / "icons" / f"{key}-light.svg", hound_hour.icon(label="Snowtime 02 hound hour light", theme="light"))
            save(ROOT / "icons-small" / f"{key}-light.svg", hound_hour.icon(small=True, label="Snowtime 02 small icon light", theme="light"))
            save(ROOT / "lockups" / f"{key}.svg", hound_hour.lockup("light", make_wordmark()))
            save(ROOT / "lockups" / f"{key}-dark.svg", hound_hour.lockup("dark", make_wordmark()))
            for theme in ("light", "dark"):
                save(ROOT / "marks" / f"{key}-{theme}.svg", hound_hour.bare_mark(theme))
                save(ROOT / "marks-small" / f"{key}-{theme}.svg", hound_hour.bare_mark(theme, small=True))
            continue
        for theme in ("light", "dark"):
            save(ROOT / "marks" / f"{key}-{theme}.svg", traced_bare(i, theme))
        save(ROOT / "icons" / f"{key}.svg", traced_icon(i))
        save(ROOT / "icons-small" / f"{key}.svg", traced_icon(i, small=True))
        save(ROOT / "lockups" / f"{key}.svg", traced_lockup(i, make_wordmark(), on_dark=False))
        if dark:
            save(ROOT / "lockups" / f"{key}-dark.svg", traced_lockup(i, make_wordmark(), on_dark=True))
    default = ROOT / "icons-small" / "02-hound-hour.svg"
    save(ROOT / "favicon" / "favicon.svg", default.read_text().strip())
    save(ROOT / "site.webmanifest", '{"name":"Snowtime","short_name":"Snowtime","icons":[{"src":"favicon/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"favicon/icon-512.png","sizes":"512x512","type":"image/png"}],"theme_color":"#0f1f2e","background_color":"#f4faff","display":"standalone"}')
    tiles = "".join(f'<img src="icons-small/{i:02d}-{name}.svg" width="512" height="512">' for i,name in enumerate(NAMES,1))
    save(ROOT / "render.html", f'<!doctype html><html><head><meta charset="utf-8"><style>*{{box-sizing:border-box}}html,body{{margin:0;width:2048px;height:1536px}}body{{display:grid;grid-template-columns:repeat(4,512px);grid-template-rows:repeat(3,512px)}}img{{display:block;width:512px;height:512px}}</style></head><body>{tiles}</body></html>')
    cards = []
    for i,name in enumerate(NAMES,1):
        key = f"{i:02d}-{name}"
        title = name.replace("-", " ").title()
        cards.append(f'<article class="card"><h2>{i:02d} <span>{title}</span>{" <em>default</em>" if i == 2 else ""}</h2>'
                     f'<div class="art"><img class="full" src="icons/{key}.svg" alt="Full {title} icon">'
                     f'<img class="small" src="icons-small/{key}.svg" alt="Small {title} icon">'
                     f'<img class="pixel" src="favicon/variants/{key}-16.png" width="16" height="16" alt="16 px favicon">'
                     f'<img class="pixel" src="favicon/variants/{key}-32.png" width="32" height="32" alt="32 px favicon"></div>'
                     f'<img class="lockup" src="lockups/{key}.svg" alt="Snowtime {title} lockup">'
                     f'<div class="tabs"><div class="tab light"><i></i><img src="favicon/variants/{key}-16.png" width="16" height="16" alt=""> Snowtime – Timer <b>×</b></div>'
                     f'<div class="tab dark"><i></i><img src="favicon/variants/{key}-16.png" width="16" height="16" alt=""> Snowtime – Timer <b>×</b></div></div></article>')
    review = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snowtime brand asset review</title><link rel="icon" type="image/svg+xml" href="favicon/favicon.svg"><style>
*{box-sizing:border-box}body{margin:0;background:#eef6ff;color:#0f1f2e;font:14px/1.4 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;gap:32px;margin-bottom:24px}header img{width:390px;max-width:50%}h1{font-size:17px;letter-spacing:.18em;text-transform:uppercase}p{color:#315f89}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{background:white;border:1px solid #d7ecfc;border-radius:15px;padding:15px}.card h2{font-size:15px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px}.card h2 span{margin-left:10px}.card em{background:#3b82b8;color:white;border-radius:20px;padding:3px 8px;font-size:10px;font-style:normal;letter-spacing:.05em}.art{display:flex;align-items:center;gap:14px;min-height:105px}.full{width:90px;height:90px}.small{width:48px;height:48px}.lockup{width:250px;max-width:90%;height:auto;margin:12px 0}.tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tab{display:flex;align-items:center;gap:7px;border-radius:8px 8px 0 0;padding:7px;font-size:11px;white-space:nowrap;overflow:hidden}.tab i{width:6px;height:6px;border-radius:50%;background:#ed6a70;flex:none}.tab img{flex:none}.tab b{margin-left:auto;font-size:15px;font-weight:400}.light{background:#e6f4ff;color:#0f1f2e}.dark{background:#1e2f45;color:#e6f4ff}@media(max-width:950px){.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.grid{grid-template-columns:1fr}header{display:block}header img{max-width:100%}}
</style></head><body><main><header><div><h1>Asset system + icon picker</h1><p>12 reconstructed concepts · 02 Hound Hour is the default · real SVG and PNG exports</p></div><img src="wordmark.svg" alt="Snowtime"></header><div class="grid">''' + "".join(cards) + '</div></main></body></html>'
    save(ROOT / "review.html", review)
    for svg in ROOT.rglob("*.svg"):
        ET.parse(svg)


if __name__ == "__main__":
    main()
