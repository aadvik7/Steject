"""Draw the STEJECT icon (an eject symbol on a navy tile) at every size the app needs.
Run: python3 scripts/make-icons.py   (needs Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
NAVY, ORANGE = (20, 32, 51, 255), (255, 106, 43, 255)


def draw(size, maskable=False):
    s = 4  # supersample for smooth edges
    W = size * s
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, W, W], fill=NAVY)
        pad = W * 0.24
    else:
        m = W * 0.06
        d.rounded_rectangle([m, m, W - m, W - m], radius=W * 0.22, fill=NAVY)
        pad = W * 0.24
    inner = W - 2 * pad
    # triangle
    top, base_y = pad + inner * 0.02, pad + inner * 0.60
    d.polygon([(W / 2, top), (pad + inner * 0.98, base_y), (pad + inner * 0.02, base_y)], fill=ORANGE)
    # bar
    by0, by1 = pad + inner * 0.74, pad + inner * 0.96
    d.rounded_rectangle([pad + inner * 0.02, by0, pad + inner * 0.98, by1], radius=inner * 0.04, fill=ORANGE)
    return img.resize((size, size), Image.LANCZOS)


icons = ROOT / "app" / "icons"
icons.mkdir(parents=True, exist_ok=True)
for n in (32, 192, 512):
    draw(n).save(icons / f"icon-{n}.png")
draw(512, maskable=True).save(icons / "maskable-512.png")
(ROOT / "build").mkdir(exist_ok=True)
draw(1024).save(ROOT / "build" / "icon.png")
draw(256).save(ROOT / "build" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect x="6" y="6" width="88" height="88" rx="22" fill="#142033"/>
<path d="M50 25 L74.5 54 L25.5 54 Z" fill="#ff6a2b"/>
<rect x="25.5" y="61.5" width="49" height="11" rx="2" fill="#ff6a2b"/>
</svg>
"""
(icons / "icon.svg").write_text(svg)
print("icons written")
