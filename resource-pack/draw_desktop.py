# Draws the decorative Computer (galaxysmp:desktop_computer). Same model and texture layout as
# the Minigame Computer (see draw_computer.py), with a different screen so players can tell them
# apart: a daytime desktop (sky, hills, app icons, taskbar) instead of the galaxy wallpaper,
# and a lock screen showing the time on the small back screen.
# Also draws a flat front-view icon used by the /shop menu.
# Usage: python3 draw_desktop.py <block texture.png> <shop icon.png>
import sys
from PIL import Image, ImageDraw

SILVER, SILVER_D, SILVER_L = (201, 204, 210, 255), (170, 174, 181, 255), (226, 228, 232, 255)
BEZEL = (18, 18, 22, 255)
WHITE = (245, 247, 252, 255)


def desktop(d, x0, y0, w, h):
    """A small desktop: sky gradient, a green hill, three app icons and a taskbar."""
    for y in range(h):
        t = y / max(1, h - 1)
        d.line((x0, y0 + y, x0 + w - 1, y0 + y), fill=(int(110 + 60 * t), int(180 + 40 * t), int(245 - 10 * t), 255))
    # hill
    for x in range(w):
        top = int(h * 0.62 + ((x - w * 0.65) ** 2) / (w * 1.4))
        for y in range(max(0, top), h - 1):
            d.point((x0 + x, y0 + y), fill=(86, 176, 92, 255) if y > top else (120, 205, 110, 255))
    # app icons (top-left column)
    for i, c in enumerate(((255, 196, 60, 255), (240, 96, 96, 255), (80, 120, 240, 255))):
        if 1 + i * 2 < h - 2:
            d.point((x0 + 1, y0 + 1 + i * 2), fill=c)
    # sun
    if w > 8:
        d.point((x0 + w - 3, y0 + 1), fill=(255, 236, 140, 255))
    # taskbar
    d.line((x0, y0 + h - 1, x0 + w - 1, y0 + h - 1), fill=(40, 44, 56, 255))
    d.point((x0 + w // 2, y0 + h - 1), fill=(120, 200, 255, 255))


def block_texture(path):
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # Big screen: bezel, desktop, silver chin
    d.rectangle((0, 0, 15, 8), fill=BEZEL)
    desktop(d, 1, 1, 14, 7)
    d.rectangle((0, 9, 15, 11), fill=SILVER_L)
    d.point((7, 10), fill=SILVER_D); d.point((8, 10), fill=SILVER_D)
    # Small back screen: lock screen with a clock
    d.rectangle((16, 0, 25, 6), fill=BEZEL)
    for y in range(1, 6):
        t = (y - 1) / 4
        d.line((17, y, 24, y), fill=(int(40 + 20 * t), int(60 + 30 * t), int(110 + 40 * t), 255))
    d.line((19, 2, 22, 2), fill=WHITE)                      # the time
    d.line((20, 4, 21, 4), fill=(190, 205, 235, 255))       # the date
    # Silver parts (identical to the Minigame Computer)
    d.rectangle((0, 16, 7, 23), fill=SILVER)
    d.ellipse((2, 18, 5, 21), fill=SILVER_D)
    d.rectangle((8, 16, 15, 23), fill=SILVER_D)
    d.line((8, 16, 15, 16), fill=SILVER_L)
    im.save(path)
    print("drew", path)


def shop_icon(path):
    """32x32 front view: monitor with the desktop, chin and stand."""
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((2, 3, 29, 23), radius=2, fill=BEZEL)
    desktop(d, 4, 5, 24, 14)
    d.rectangle((2, 20, 29, 23), fill=SILVER_L)
    d.rectangle((14, 21, 17, 22), fill=SILVER_D)
    d.polygon(((12, 24), (19, 24), (21, 28), (10, 28)), fill=SILVER_D)
    d.rectangle((8, 28, 23, 29), fill=SILVER)
    im.save(path)
    print("drew", path)


block_texture(sys.argv[1])
shop_icon(sys.argv[2])
