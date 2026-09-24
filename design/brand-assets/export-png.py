"""Render the SVGs with headless Chrome and export PNGs using ImageMagick."""

from pathlib import Path
import subprocess
from build import NAMES

root = Path(__file__).parent
sheet = root / "render.png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def chrome(html, output, width, height):
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--default-background-color=00000000", f"--window-size={width},{height}",
         f"--screenshot={output}", html.resolve().as_uri()],
        check=True, capture_output=True,
    )


def chrome_svg(svg, output, width, height):
    page = root / ".render-one.html"
    page.write_text(
        '<!doctype html><style>html,body{margin:0;background:transparent}'
        f'img{{display:block;width:{width}px;height:{height}px}}</style>'
        f'<img src="{svg.relative_to(root)}">')
    output.parent.mkdir(parents=True, exist_ok=True)
    chrome(page, output, width, height)
    page.unlink()


chrome(root / "render.html", sheet, 2048, 1536)


def export(index, size, output):
    x = (index % 4) * 512
    y = (index // 4) * 512
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["magick", str(sheet), "-crop", f"512x512+{x}+{y}", "+repage",
         "-filter", "Lanczos", "-resize", f"{size}x{size}",
         "-strip", str(output)],
        check=True,
    )


for index, name in enumerate(NAMES):
    key = f"{index+1:02d}-{name}"
    for size in (16, 32):
        export(index, size, root / "favicon" / "variants" / f"{key}-{size}.png")

for size, filename in (
    (16, "favicon-16x16.png"), (32, "favicon-32x32.png"),
    (180, "apple-touch-icon.png"), (192, "icon-192.png"),
    (512, "icon-512.png"),
):
    export(1, size, root / "favicon" / filename)

for size in (20, 24, 64):
    for index, name in enumerate(NAMES):
        export(index, size, root / "qa" / f"{index+1:02d}-{name}-{size}.png")

# Full-resolution rasters: every app icon, plus 02's bare marks and lockups.
png = root / "png"
for index, name in enumerate(NAMES):
    key = f"{index+1:02d}-{name}"
    chrome_svg(root / "icons" / f"{key}.svg", png / f"{key}-app-1024.png", 1024, 1024)
for theme in ("light", "dark"):
    chrome_svg(root / "marks" / f"02-hound-hour-{theme}.svg", png / f"02-hound-hour-mark-{theme}.png", 710, 580)
for name in ("02-hound-hour", "02-hound-hour-dark"):
    svg = root / "lockups" / f"{name}.svg"
    width = int(svg.read_text().split('width="', 1)[1].split('"', 1)[0])
    chrome_svg(svg, png / f"{name}-lockup@4x.png", width * 4, 128 * 4)

# 02's ice-tile version is not on the sheet, so it renders on its own at the sheet's 512 px.
for icons, sizes, folder in (("icons-small", (16, 32), "favicon/variants"), ("icons-small", (20, 24, 64), "qa")):
    tile = root / ".render-02-light.png"
    chrome_svg(root / icons / "02-hound-hour-light.svg", tile, 512, 512)
    for size in sizes:
        subprocess.run(["magick", str(tile), "-filter", "Lanczos", "-resize", f"{size}x{size}", "-strip",
                        str(root / folder / f"02-hound-hour-light-{size}.png")], check=True)
    tile.unlink()
chrome_svg(root / "icons" / "02-hound-hour-light.svg", png / "02-hound-hour-light-app-1024.png", 1024, 1024)
