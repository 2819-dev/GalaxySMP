# Small icons for the Featured Servers sidebar, drawn into glyph_F7.png:
#   U+F752..F755  ping bars (great / good / okay / bad), U+F756 players
#   U+F757 survival (pickaxe), F758 pvp (sword), F759 minigames (bed), F75A building (bricks), F75B events (star),
#   F75C parkour (boot), F75D plots (house), F75E economy (coin), F75F other (diamond)
# Usage: python3 draw_ui_icons.py src/font/glyph_F7.png
import sys
from PIL import Image, ImageDraw
K = (20, 20, 30, 255)

def outline(img):
    px = img.load(); out = img.copy(); po = out.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][3]:
                continue
            if any(0 <= x + dx < 16 and 0 <= y + dy < 16 and px[x + dx, y + dy][3] and px[x + dx, y + dy] != K for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                po[x, y] = K
    return out

def new():
    im = Image.new("RGBA", (16, 16)); return im, ImageDraw.Draw(im)

def bars(n, col):
    im, d = new()
    for i in range(4):
        h = 3 + i * 3
        d.rectangle((2 + i * 3, 14 - h, 3 + i * 3, 13), fill=col if i < n else (90, 90, 100, 255))
    return outline(im)

def players():
    im, d = new(); c = (235, 240, 255, 255)
    d.ellipse((5, 2, 10, 7), fill=c); d.rectangle((3, 9, 12, 13), fill=c); d.ellipse((3, 7, 12, 12), fill=c)
    return outline(im)

def pickaxe():
    im, d = new()
    d.line((3, 13, 11, 5), fill=(140, 95, 50, 255), width=2)
    d.arc((2, 1, 14, 11), 200, 340, fill=(120, 230, 240, 255), width=3)
    return outline(im)

def sword():
    im, d = new()
    d.line((4, 12, 13, 3), fill=(200, 235, 255, 255), width=2)
    d.line((3, 9, 7, 13), fill=(140, 95, 50, 255), width=2); d.point((2, 14), fill=(140, 95, 50, 255))
    return outline(im)

def bed():
    im, d = new()
    d.rectangle((2, 7, 13, 11), fill=(220, 60, 60, 255)); d.rectangle((2, 6, 5, 9), fill=(240, 240, 240, 255))
    d.rectangle((2, 11, 3, 13), fill=(140, 95, 50, 255)); d.rectangle((12, 11, 13, 13), fill=(140, 95, 50, 255))
    return outline(im)

def bricks():
    im, d = new(); c, m = (190, 85, 65, 255), (230, 210, 190, 255)
    d.rectangle((2, 3, 13, 13), fill=c)
    for y in (6, 9, 12): d.line((2, y, 13, y), fill=m)
    for y, xs in ((4, (7,)), (7, (4, 10)), (10, (7,))):
        for x in xs: d.line((x, y, x, y + 1), fill=m)
    return outline(im)

def star():
    im, d = new(); import math
    pts = [(8 + math.cos(math.radians(-90 + i * 36)) * (6 if i % 2 == 0 else 2.6), 8.5 + math.sin(math.radians(-90 + i * 36)) * (6 if i % 2 == 0 else 2.6)) for i in range(10)]
    d.polygon(pts, fill=(255, 215, 80, 255))
    return outline(im)

def boot():
    im, d = new(); c = (110, 200, 255, 255)
    d.rectangle((5, 2, 9, 11), fill=c); d.rectangle((5, 10, 13, 13), fill=c); d.line((5, 12, 13, 12), fill=(255, 255, 255, 255))
    return outline(im)

def house():
    im, d = new()
    d.polygon([(8, 2), (14, 8), (2, 8)], fill=(200, 80, 80, 255)); d.rectangle((4, 8, 12, 13), fill=(210, 170, 110, 255))
    d.rectangle((7, 10, 9, 13), fill=(110, 70, 40, 255))
    return outline(im)

def coin():
    im, d = new()
    d.ellipse((2, 2, 13, 13), fill=(255, 205, 60, 255)); d.ellipse((5, 5, 10, 10), outline=(200, 140, 20, 255))
    return outline(im)

def gem():
    im, d = new()
    d.polygon([(8, 2), (14, 7), (8, 14), (2, 7)], fill=(120, 235, 245, 255)); d.line((2, 7, 14, 7), fill=(200, 250, 255, 255))
    return outline(im)

icons = [bars(4, (90, 230, 90, 255)), bars(3, (200, 230, 80, 255)), bars(2, (250, 180, 60, 255)), bars(1, (240, 80, 70, 255)), players(),
         pickaxe(), sword(), bed(), bricks(), star(), boot(), house(), coin(), gem()]
sheet = Image.open(sys.argv[1]).convert("RGBA")
for i, ic in enumerate(icons):
    code = 0x52 + i
    r, c = code >> 4, code & 15
    sheet.paste(Image.new("RGBA", (16, 16)), (c * 16, r * 16)); sheet.paste(ic, (c * 16, r * 16))
sheet.save(sys.argv[1])
print("sidebar icons: U+F752 to U+%X" % (0xF752 + len(icons) - 1))
