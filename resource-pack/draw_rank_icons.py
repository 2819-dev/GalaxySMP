# 16x16 pixel-art rank icons (crown, star...), same outline style as the voice icons.
from PIL import Image, ImageDraw
import os, sys
OUT = sys.argv[1]
K = (24, 24, 32, 255)

def outline(img):
    px = img.load(); out = img.copy(); po = out.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][3]: continue
            if any(0 <= x+dx < 16 and 0 <= y+dy < 16 and px[x+dx, y+dy][3] and px[x+dx, y+dy] != K
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                po[x, y] = K
    return out

def new():
    im = Image.new("RGBA", (16, 16)); return im, ImageDraw.Draw(im)

def crown():
    im, d = new(); g = (255, 200, 40, 255)
    d.polygon([(2,11),(2,5),(5,8),(8,3),(11,8),(14,5),(14,11)], fill=g)
    d.rectangle((2,11,14,13), fill=(230,170,20,255))
    d.point((8,9), fill=(230,40,60,255)); d.point((5,11), fill=(80,170,255,255)); d.point((11,11), fill=(80,170,255,255))
    return im
def star():
    im, d = new()
    d.polygon([(8,1),(10,6),(15,6),(11,9),(13,14),(8,11),(3,14),(5,9),(1,6),(6,6)], fill=(255,225,70,255))
    return im
def shield():
    im, d = new()
    d.polygon([(2,2),(14,2),(14,8),(8,14),(2,8)], fill=(70,130,255,255))
    d.line((8,4,8,11), fill=(255,255,255,255)); d.line((5,6,11,6), fill=(255,255,255,255))
    return im
def sword():
    im, d = new(); blade = (215,225,240,255)
    for i in range(7): d.point((13-i, 2+i), fill=blade); d.point((12-i, 2+i), fill=blade)
    d.line((3,8,7,12), fill=(255,200,40,255))
    d.line((2,13,4,11), fill=(140,90,50,255)); d.point((2,14), fill=(140,90,50,255))
    return im
def gem():
    im, d = new()
    d.polygon([(4,3),(12,3),(15,7),(8,14),(1,7)], fill=(80,230,240,255))
    d.line((1,7,15,7), fill=(40,170,200,255)); d.line((8,7,8,13), fill=(170,250,255,255))
    return im
def heart():
    im, d = new(); r = (240,60,90,255)
    d.ellipse((1,2,8,9), fill=r); d.ellipse((8,2,15,9), fill=r)
    d.polygon([(1,6),(15,6),(8,14)], fill=r); d.point((4,4), fill=(255,170,190,255))
    return im
def hammer():
    im, d = new()
    d.rectangle((3,2,12,5), fill=(170,175,190,255)); d.rectangle((7,6,8,14), fill=(150,100,55,255))
    return im
def flame():
    im, d = new()
    d.polygon([(8,1),(12,6),(13,10),(11,14),(5,14),(3,10),(4,6),(6,8)], fill=(255,120,30,255))
    d.polygon([(8,7),(10,10),(10,13),(6,13),(6,10)], fill=(255,220,80,255))
    return im
def bolt():
    im, d = new()
    d.polygon([(10,1),(4,9),(8,9),(6,15),(13,6),(9,6),(11,1)], fill=(255,230,60,255))
    return im
def rocket():
    im, d = new()
    d.polygon([(8,1),(11,5),(11,11),(5,11),(5,5)], fill=(235,238,250,255))
    d.point((8,6), fill=(80,170,255,255)); d.point((8,7), fill=(80,170,255,255))
    d.polygon([(5,8),(3,12),(5,12)], fill=(230,60,70,255)); d.polygon([(11,8),(13,12),(11,12)], fill=(230,60,70,255))
    d.rectangle((7,12,9,14), fill=(255,150,40,255))
    return im
def planet():
    im, d = new()
    d.ellipse((4,4,12,12), fill=(150,100,255,255))
    d.line((1,11,15,5), fill=(220,200,255,255)); d.line((1,12,15,6), fill=(220,200,255,255))
    return im
def leaf():
    im, d = new()
    d.polygon([(13,2),(14,7),(10,12),(4,13),(3,9),(7,4)], fill=(80,210,90,255))
    d.line((3,14,12,4), fill=(40,140,50,255))
    return im

ICONS = [("crown", crown), ("star", star), ("shield", shield), ("sword", sword), ("gem", gem), ("heart", heart),
         ("hammer", hammer), ("flame", flame), ("bolt", bolt), ("rocket", rocket), ("planet", planet), ("leaf", leaf)]
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    prev = Image.new("RGBA", (len(ICONS) * 72, 72), (60, 60, 60, 255))
    for i, (name, fn) in enumerate(ICONS):
        im = outline(fn()); im.save(os.path.join(OUT, f"rank_{name}.png"))
        big = im.resize((64, 64), Image.NEAREST); prev.paste(big, (i * 72 + 4, 4), big)
    prev.save(os.path.join(OUT, "_rank_preview.png"))
    print("drew", [n for n, _ in ICONS])


def add_to_sheet(sheet_path):
    """Rank icons go in row 1 of glyph_E2.png: U+E210 (crown) to U+E21B (leaf)."""
    sheet = Image.open(sheet_path).convert("RGBA")
    for i, (name, fn) in enumerate(ICONS):
        im = outline(fn())
        sheet.paste(Image.new("RGBA", (16, 16)), (i * 16, 16))
        sheet.paste(im, (i * 16, 16), im)
    sheet.save(sheet_path)
    print("added rank icons to", sheet_path)


if __name__ == "__main__" and len(sys.argv) > 2:
    add_to_sheet(sys.argv[2])
