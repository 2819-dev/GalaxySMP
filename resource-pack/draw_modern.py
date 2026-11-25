# The modern GalaxySMP menu style (2.88): dark navy glass with soft rounded corners, a thin light edge, and the
# GalaxySMP cyan -> blue -> purple gradient for hover, selected tabs and the main button.
# Writes the shared button / card / panel / tile textures into src/textures/ui/ (all nine-sliced, see each .json).
# These replace the older chunky pixel-art versions from draw_menu.py / draw_title.py, so run this one last.
# Usage: python3 draw_modern.py [src/textures/ui]
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "src", "textures", "ui")

CYAN, BLUE, PURPLE = (56, 214, 255), (70, 120, 255), (156, 92, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def brand(t):
    """The GalaxySMP gradient at 0..1 (cyan -> blue -> purple)."""
    return lerp(CYAN, BLUE, t * 2) if t < 0.5 else lerp(BLUE, PURPLE, (t - 0.5) * 2)


def coverage(x, y, w, h, r):
    """How much of pixel (x, y) is inside a w x h rounded rectangle with corner radius r (0..1, 4x4 samples)."""
    if r <= 0:
        return 1.0
    hit = 0
    for sy in range(4):
        for sx in range(4):
            px, py = x + (sx + 0.5) / 4, y + (sy + 0.5) / 4
            cx = min(max(px, r), w - r)
            cy = min(max(py, r), h - r)
            hit += (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return hit / 16


def rounded(w, h, r, fill, edge=None, top=None, bottom=None, edge_fn=None, fill_fn=None):
    """A rounded rectangle: fill (or fill_fn(x, y) -> rgba), a 1px edge (or edge_fn(x, y) -> rgba),
    a highlight line under the top edge and a shade line above the bottom edge."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y in range(h):
        for x in range(w):
            c = coverage(x, y, w, h, r)
            if c <= 0:
                continue
            inner = coverage(x, y, w, h, r) if (1 <= x < w - 1 and 1 <= y < h - 1) else 0
            # an edge pixel: inside, but its neighbour toward the outside isn't fully inside
            on_edge = x == 0 or y == 0 or x == w - 1 or y == h - 1 or min(
                coverage(x - 1, y, w, h, r), coverage(x + 1, y, w, h, r), coverage(x, y - 1, w, h, r), coverage(x, y + 1, w, h, r)) < 1
            col = fill_fn(x, y) if fill_fn else fill
            if top and y == 1 and not on_edge:
                col = blend(col, top)
            if bottom and y == h - 2 and not on_edge:
                col = blend(col, bottom)
            if on_edge and (edge or edge_fn):
                e = edge_fn(x, y) if edge_fn else edge
                col = blend(col, e)
            px[x, y] = col[:3] + (round(col[3] * c),)
    return im


def blend(base, over):
    """over (rgba) on top of base (rgba)."""
    a = over[3] / 255
    rgb = tuple(round(base[i] * (1 - a) + over[i] * a) for i in range(3))
    return rgb + (max(base[3], over[3]),)


def save(name, im, nine):
    im.save(os.path.join(OUT, name + ".png"))
    json.dump({"nineslice_size": nine, "base_size": list(im.size)}, open(os.path.join(OUT, name + ".json"), "w"))


GLASS = (14, 18, 42, 215)
EDGE = (150, 175, 255, 70)
HI = (255, 255, 255, 26)
LOW = (0, 0, 0, 40)

# ---- buttons (32 x 16, corner radius 3) ----
W, H = 32, 16
across = lambda x, y: brand(x / (W - 1)) + (235,)
save("gsmp_button", rounded(W, H, 3, GLASS, EDGE, HI, LOW), 4)
save("gsmp_button_hover", rounded(W, H, 3, (30, 44, 104, 235), edge_fn=across, top=(255, 255, 255, 40), bottom=LOW), 4)
save("gsmp_button_pressed", rounded(W, H, 3, (9, 11, 30, 240), (70, 120, 255, 190), None, None), 4)
save("gsmp_button_on", rounded(W, H, 3, None, (200, 225, 255, 150), (255, 255, 255, 50), LOW,
                               fill_fn=lambda x, y: lerp(brand(x / (W - 1)), (20, 24, 60), 0.45) + (240,)), 4)
save("gsmp_button_exit", rounded(W, H, 3, (60, 16, 28, 220), (255, 110, 130, 90), HI, LOW), 4)
save("gsmp_button_exit_hover", rounded(W, H, 3, (120, 28, 48, 235), (255, 140, 160, 220), (255, 255, 255, 40), LOW), 4)

# the main button (Play, Continue...): the GalaxySMP gradient
save("gsmp_button_primary", rounded(W, H, 3, None, (210, 235, 255, 120), (255, 255, 255, 70), (0, 0, 0, 50),
                                    fill_fn=lambda x, y: lerp(brand(x / (W - 1)), (10, 14, 40), 0.25 + y * 0.012) + (245,)), 4)
save("gsmp_button_primary_hover", rounded(W, H, 3, None, (255, 255, 255, 220), (255, 255, 255, 90), (0, 0, 0, 40),
                                          fill_fn=lambda x, y: lerp(brand(x / (W - 1)), (255, 255, 255), 0.08) + (250,)), 4)
save("gsmp_button_primary_pressed", rounded(W, H, 3, None, (120, 160, 255, 200), None, None,
                                            fill_fn=lambda x, y: lerp(brand(x / (W - 1)), (6, 8, 24), 0.45) + (250,)), 4)

# the green "go" button (Join, Teleport...)
G1, G2 = (40, 200, 120), (24, 160, 110)
green = lambda k: (lambda x, y: lerp(lerp(G1, G2, x / (W - 1)), (6, 30, 20) if k < 0 else (255, 255, 255), abs(k)) + (245,))
save("gsmp_button_green", rounded(W, H, 3, None, (160, 255, 200, 110), (255, 255, 255, 60), (0, 0, 0, 50), fill_fn=green(0.0)), 4)
save("gsmp_button_green_hover", rounded(W, H, 3, None, (220, 255, 235, 220), (255, 255, 255, 80), (0, 0, 0, 40), fill_fn=green(0.12)), 4)
save("gsmp_button_green_pressed", rounded(W, H, 3, None, (100, 220, 160, 200), None, None, fill_fn=green(-0.35)), 4)

# ---- cards (24 x 24, radius 5) and the big panel (96 x 128, radius 6) ----
save("gsmp_card", rounded(24, 24, 5, (12, 16, 38, 205), (150, 175, 255, 55), HI, None), 6)
save("gsmp_card_hover", rounded(24, 24, 5, (26, 38, 90, 225), edge_fn=lambda x, y: brand(x / 23) + (230,), top=(255, 255, 255, 36)), 6)
save("gsmp_card_pressed", rounded(24, 24, 5, (8, 10, 28, 235), (70, 120, 255, 190)), 6)
save("gsmp_panel", rounded(96, 128, 6, None, (150, 175, 255, 60), HI, None,
                           fill_fn=lambda x, y: lerp((14, 18, 44), (9, 11, 28), y / 127) + (228,)), 6)

# ---- plain pop-up forms: the window and the darker content area inside it ----
save("gsmp_dialog", rounded(32, 32, 6, None, (150, 175, 255, 80), (255, 255, 255, 30), None,
                            fill_fn=lambda x, y: lerp((20, 26, 62), (12, 15, 38), y / 31) + (242,)), 7)
save("gsmp_dialog_fill", rounded(16, 16, 3, (6, 8, 22, 150), (255, 255, 255, 16)), 4)

# ---- live info tiles on the Main Menu (24 x 24, radius 4) ----
save("gsmp_tile", rounded(24, 24, 4, (10, 14, 34, 210), (150, 175, 255, 50), HI, None), 5)
save("gsmp_tile_hover", rounded(24, 24, 4, (26, 38, 90, 220), edge_fn=lambda x, y: brand(x / 23) + (230,), top=(255, 255, 255, 36)), 5)
save("gsmp_tile_pressed", rounded(24, 24, 4, (8, 10, 28, 235), (70, 120, 255, 190)), 5)

# the action bar and item-name pill above the hotbar (Minecraft's "hud_tip_text_background"): a rounded navy pill
save("hud_tip_text_background", rounded(16, 12, 3, (8, 10, 30, 255), (130, 160, 255, 150), (255, 255, 255, 30), None), 4)

# a soft dark shade behind the menu (left to right) and along the bottom, so text reads well on any wallpaper
sh = Image.new("RGBA", (64, 4), (0, 0, 0, 0))
for x in range(64):
    t = x / 63
    for y in range(4):
        sh.putpixel((x, y), (4, 6, 20, round(150 * (1 - t) ** 1.6)))
sh.save(os.path.join(OUT, "gsmp_shade_left.png"))
sb = Image.new("RGBA", (4, 32), (0, 0, 0, 0))
for y in range(32):
    for x in range(4):
        sb.putpixel((x, y), (4, 6, 20, round(170 * (y / 31) ** 1.8)))
sb.save(os.path.join(OUT, "gsmp_shade_bottom.png"))

# the accent line under the splash text and a small glowing dot (live, online)
ln = Image.new("RGBA", (64, 1), (0, 0, 0, 0))
for x in range(64):
    t = x / 63
    ln.putpixel((x, 0), brand(t) + (round(255 * min(1, 4 * t, 4 * (1 - t))),))
ln.save(os.path.join(OUT, "gsmp_accent_line.png"))
print("modern menu textures written")
