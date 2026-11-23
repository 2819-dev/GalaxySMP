# Draws the penguin pointer glyphs into glyph_F7.png (row 0):
#   U+F707 penguin icon, U+F708..U+F70F arrows (ahead, ahead-right, right, behind-right, behind, behind-left, left, ahead-left)
# Usage: python3 draw_pointer.py src/font/glyph_F7.png
import math, sys
from PIL import Image, ImageDraw

K, W, O, B = (24, 24, 32, 255), (255, 255, 255, 255), (255, 170, 40, 255), (40, 52, 80, 255)
C = (90, 220, 255, 255)

def outline(img):
    px = img.load(); out = img.copy(); po = out.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][3]:
                continue
            if any(0 <= x + dx < 16 and 0 <= y + dy < 16 and px[x + dx, y + dy][3] and px[x + dx, y + dy] != K
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                po[x, y] = K
    return out

def penguin():
    im = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(im)
    d.ellipse((3, 2, 12, 14), fill=B)           # body
    d.ellipse((5, 6, 10, 14), fill=W)           # belly
    d.ellipse((5, 3, 10, 7), fill=W)            # face
    d.point((6, 5), fill=K); d.point((9, 5), fill=K)   # eyes
    d.polygon([(7, 6), (8, 6), (7, 8)], fill=O)  # beak
    d.line((5, 15, 6, 15), fill=O); d.line((9, 15, 10, 15), fill=O)   # feet
    return outline(im)

def arrow(deg):
    """deg 0 = pointing up (ahead), 90 = right."""
    im = Image.new("RGBA", (64, 64)); d = ImageDraw.Draw(im)
    pts = [(0, -26), (18, 4), (6, 0), (6, 24), (-6, 24), (-6, 0), (-18, 4)]
    a = math.radians(deg)
    d.polygon([(32 + x * math.cos(a) - y * math.sin(a), 32 + x * math.sin(a) + y * math.cos(a)) for x, y in pts], fill=C)
    small = im.resize((14, 14), Image.LANCZOS)
    px = small.load()
    for y in range(14):
        for x in range(14):
            px[x, y] = C if px[x, y][3] > 110 else (0, 0, 0, 0)
    cell = Image.new("RGBA", (16, 16)); cell.paste(small, (1, 1))
    return outline(cell)

sheet = Image.open(sys.argv[1]).convert("RGBA")
cells = [penguin()] + [arrow(i * 45) for i in range(8)]
for i, c in enumerate(cells):
    col = 7 + i
    sheet.paste(Image.new("RGBA", (16, 16)), (col * 16, 0))
    sheet.paste(c, (col * 16, 0))
sheet.save(sys.argv[1])
prev = Image.new("RGBA", (16 * 9, 16), (60, 60, 60, 255))
for i, c in enumerate(cells):
    prev.alpha_composite(c, (i * 16, 0))
prev.resize((16 * 9 * 8, 128), Image.NEAREST).save(sys.argv[2] if len(sys.argv) > 2 else "/dev/null", "PNG")
print("penguin pointer glyphs: U+F707 to U+F70F")
