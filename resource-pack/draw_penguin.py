"""Draws the GalaxySMP penguin texture (64x32, box UV) and the four potato chip bag icons (16x16)."""
from PIL import Image, ImageDraw
import os
here = os.path.dirname(os.path.abspath(__file__))
DARK, DARK2, WHITE, CREAM, ORANGE, ORANGE2, BLACK, CYAN = (31, 35, 51), (44, 50, 72), (244, 246, 251), (226, 231, 242), (242, 155, 46), (214, 120, 26), (12, 12, 18), (79, 235, 253)

img = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def box(u, v, w, h, dp, color):
    """Fills every face of a box-UV cube."""
    d.rectangle([u + dp, v, u + dp + 2 * w - 1, v + dp - 1], fill=color)          # top + bottom
    d.rectangle([u, v + dp, u + 2 * dp + 2 * w - 1, v + dp + h - 1], fill=color)  # sides
def face(u, v, w, h, dp, which):
    """(x, y) of a face's top-left: north = front."""
    return {"top": (u + dp, v), "north": (u + dp, v + dp), "west": (u, v + dp), "east": (u + dp + w, v + dp), "south": (u + 2 * dp + w, v + dp)}[which]

# body 8x11x7 at (0,0): dark back and sides, white belly on the front
box(0, 0, 8, 11, 7, DARK)
fx, fy = face(0, 0, 8, 11, 7, "north")
d.ellipse([fx + 1, fy + 1, fx + 6, fy + 11], fill=WHITE)
d.rectangle([fx + 2, fy + 9, fx + 5, fy + 10], fill=CREAM)
sx, sy = face(0, 0, 8, 11, 7, "south")
for i in range(0, 8, 2): d.point((sx + i, sy + 2), fill=DARK2)
# head 7x6x6 at (0,18): dark, white face patch, eyes with a highlight, rosy cyan cheeks
box(0, 18, 7, 6, 6, DARK)
hx, hy = face(0, 18, 7, 6, 6, "north")
for x0 in (hx + 1, hx + 4):                      # white patches around the eyes
    d.rectangle([x0, hy + 1, x0 + 1, hy + 3], fill=WHITE)
d.point((hx + 2, hy + 2), fill=BLACK); d.point((hx + 4, hy + 2), fill=BLACK)   # eyes
d.point((hx + 1, hy + 4), fill=CYAN); d.point((hx + 5, hy + 4), fill=CYAN)     # cheeks
d.rectangle([hx + 2, hy + 4, hx + 4, hy + 5], fill=WHITE)                      # chin
# beak 2x1x2 at (30,0)
box(30, 0, 2, 1, 2, ORANGE)
# wings 1x7x5 at (30,4) and (42,4): dark, lighter edge
for u in (30, 42):
    box(u, 4, 1, 7, 5, DARK2)
    for y in range(4 + 5, 4 + 5 + 7): d.point((u + 5, y), fill=DARK)
# feet 3x1x4 at (30,18) and (44,18)
for u in (30, 44):
    box(u, 18, 3, 1, 4, ORANGE)
    d.rectangle([u + 4, 18, u + 6, 21], fill=ORANGE2)
os.makedirs(f"{here}/src/textures/entity", exist_ok=True)
img.save(f"{here}/src/textures/entity/galaxysmp_penguin.png")

# ---- chip bags ----
BAGS = {"classic": ((240, 196, 40), (196, 140, 20)), "spicy": ((226, 54, 44), (150, 24, 24)),
        "sour": ((60, 186, 90), (30, 120, 56)), "galaxy": ((110, 72, 230), (40, 30, 110))}
os.makedirs(f"{here}/src/textures/items", exist_ok=True)
for k, (c, c2) in BAGS.items():
    b = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    g = ImageDraw.Draw(b)
    g.polygon([(3, 2), (12, 2), (13, 4), (13, 13), (12, 14), (3, 14), (2, 13), (2, 4)], fill=c, outline=c2)
    for x in range(3, 13, 2): g.point((x, 2), fill=c2); g.point((x, 14), fill=c2)            # crimped ends
    g.ellipse([5, 6, 10, 10], fill=(250, 214, 120), outline=(196, 150, 60))                     # a chip on the front
    g.point((6, 8), fill=(210, 160, 70)); g.point((8, 7), fill=(210, 160, 70))
    g.line([(4, 4), (11, 4)], fill=(255, 255, 255))                                            # label stripe
    if k == "galaxy":
        for p in [(4, 11), (11, 12), (12, 6), (3, 7)]: g.point(p, fill=(79, 235, 253))
    if k == "spicy":
        g.point((11, 11), fill=(255, 200, 60)); g.point((12, 10), fill=(255, 140, 40))
    b.save(f"{here}/src/textures/items/galaxysmp_chips_{k}.png")
print("drawn")
