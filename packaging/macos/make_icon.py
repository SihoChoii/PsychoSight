"""Rasterize the PsychoSight symbol SVG into PsychoSight.icns.

The symbol is white LEDs (``currentColor`` / ``color="#ffffff"``) on a clear canvas.
The icon paints them on black, which is the mark's background.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SVG = ROOT / "web" / "public" / "logos" / "black" / "psychosigh-symbol.svg"
OUT = Path(__file__).resolve().parent / "PsychoSight.icns"
SIZES = (16, 32, 64, 128, 256, 512, 1024)
ICONSET_NAMES = {
    16: "icon_16x16.png",
    32: "icon_16x16@2x.png",
    64: "icon_32x32@2x.png",
    128: "icon_128x128.png",
    256: "icon_128x128@2x.png",
    512: "icon_256x256@2x.png",
    1024: "icon_512x512@2x.png",
}
# 32pt @1x and 256pt @1x and 512pt @1x share pixels with the @2x of the size below.
ICONSET_ALIASES = {
    32: "icon_32x32.png",
    256: "icon_256x256.png",
    512: "icon_512x512.png",
}


def render(svg_text: str, size: int = 1024) -> Image.Image:
    rects = re.findall(
        r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"',
        svg_text,
    )
    if len(rects) < 10:
        raise SystemExit(f"no symbol rectangles in {SVG}")
    view = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text)
    canvas = float(view.group(1)) if view else 256.0
    scale = size / canvas
    image = Image.new("RGB", (size, size), "#000000")
    draw = ImageDraw.Draw(image)
    for x, y, w, h in rects:
        left = float(x) * scale
        top = float(y) * scale
        draw.rectangle([left, top, left + float(w) * scale, top + float(h) * scale], fill="#ffffff")
    return image


def main() -> int:
    master = render(SVG.read_text(encoding="utf-8"))
    iconset = OUT.with_suffix(".iconset")
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    for size in SIZES:
        resized = master.resize((size, size), Image.Resampling.NEAREST)
        resized.save(iconset / ICONSET_NAMES[size])
        alias = ICONSET_ALIASES.get(size)
        if alias:
            resized.save(iconset / alias)
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(OUT)], check=True)
    shutil.rmtree(iconset)
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
