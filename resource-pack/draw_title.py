# Draws the welcome screen art (pixel art, original):
#   textures/ui/gsmp_title_bg.png     wide night landscape behind the title screen (it pans slowly)
#   textures/ui/gsmp_srv_<key>.png    banner pictures for the Featured Servers list
#   textures/ui/gsmp_card*.png        server card backgrounds (nine-sliced)
# Usage: python3 draw_title.py src/textures/ui [preview.png]
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def sky(w, h, stops):
    im = Image.new("RGBA", (w, h))
    px = im.load()
    for y in range(h):
        t = y / (h - 1)
        for i in range(len(stops) - 1):
            if stops[i][0] <= t <= stops[i + 1][0]:
                k = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0])
                c = lerp(stops[i][1], stops[i + 1][1], k)
        for x in range(w):
            px[x, y] = c + (255,)
    return im


def stars(im, n, seed, top=1.0):
    r = random.Random(seed)
    d = ImageDraw.Draw(im)
    w, h = im.size
    for _ in range(n):
        x, y = r.randrange(w), r.randrange(int(h * top))
        c = r.choice([(255, 255, 255), (200, 230, 255), (255, 240, 200), (190, 200, 255)])
        a = r.randint(120, 255)
        d.point((x, y), fill=c + (a,))
        if r.random() < 0.06 and 0 < x < w - 1 and 0 < y < h - 1:   # a bright one
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                d.point((x + dx, y + dy), fill=c + (110,))


def nebula(im, blobs, seed):
    r = random.Random(seed)
    w, h = im.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for color, n in blobs:
        for _ in range(n):
            x, y, s = r.randrange(w), r.randrange(int(h * 0.7)), r.randint(w // 14, w // 6)
            d.ellipse((x - s, y - s // 2, x + s, y + s // 2), fill=color + (40,))
    layer = layer.filter(ImageFilter.GaussianBlur(w / 40))
    im.alpha_composite(layer)


def planet(im, cx, cy, r, base, shade, ring=None):
    d = ImageDraw.Draw(im)
    if ring:
        d.ellipse((cx - r * 2.0, cy - r * 0.45, cx + r * 2.0, cy + r * 0.45), outline=ring + (200,), width=max(1, r // 6))
    for y in range(-r, r + 1):
        for x in range(-r, r + 1):
            if x * x + y * y <= r * r:
                t = max(0.0, min(1.0, (x + y) / (2 * r) + 0.5))
                c = lerp(base, shade, t)
                band = (y + r) // max(2, r // 3) % 2
                if band:
                    c = lerp(c, shade, 0.18)
                d.point((cx + x, cy + y), fill=c + (255,))
    if ring:   # front half of the ring
        d.arc((cx - r * 2.0, cy - r * 0.45, cx + r * 2.0, cy + r * 0.45), 0, 180, fill=ring + (230,), width=max(1, r // 6))


def ridge(im, base_y, rough, step, color, seed, top=None):
    """Blocky (stepped) hills: columns `step` wide, heights from a few sine waves."""
    r = random.Random(seed)
    w, h = im.size
    d = ImageDraw.Draw(im)
    ph = [r.random() * 6.28 for _ in range(3)]
    heights = []
    for x0 in range(0, w, step):
        t = x0 / w
        y = base_y - rough * (0.55 * math.sin(t * 6.28 * 1.3 + ph[0]) + 0.3 * math.sin(t * 6.28 * 3.1 + ph[1]) + 0.15 * math.sin(t * 6.28 * 7.7 + ph[2]))
        y = int(y // step * step)
        heights.append((x0, y))
        d.rectangle((x0, y, x0 + step - 1, h), fill=color + (255,))
        if top:
            d.rectangle((x0, y, x0 + step - 1, y + max(1, step // 2) - 1), fill=top + (255,))
    return heights


def tree(d, x, y, s, leaf, trunk):
    d.rectangle((x, y - s * 2, x + s - 1, y), fill=trunk + (255,))
    d.rectangle((x - s, y - s * 4, x + s * 2 - 1, y - s * 2), fill=leaf + (255,))
    d.rectangle((x, y - s * 5, x + s - 1, y - s * 4), fill=leaf + (255,))


def house(d, x, y, s, wall, roof, lit):
    d.rectangle((x, y - s * 4, x + s * 6 - 1, y), fill=wall + (255,))
    for i in range(4):
        d.rectangle((x - s + i * s, y - s * (5 + i), x + s * 7 - 1 - i * s, y - s * (4 + i)), fill=roof + (255,))
    d.rectangle((x + s, y - s * 3, x + s * 2 - 1, y - s * 2), fill=lit + (255,))
    d.rectangle((x + s * 4, y - s * 3, x + s * 5 - 1, y - s * 2), fill=lit + (255,))


NIGHT = [(0, (8, 10, 36)), (0.45, (32, 22, 84)), (0.8, (92, 46, 140)), (1, (170, 80, 150))]


def title_bg():
    w, h = 320, 120
    im = sky(w, h, NIGHT)
    nebula(im, [((80, 200, 255), 5), ((170, 90, 255), 6), ((255, 110, 200), 3)], 3)
    stars(im, 260, 7, 0.75)
    planet(im, 238, 30, 13, (120, 180, 255), (70, 60, 170), ring=(200, 220, 255))
    planet(im, 52, 20, 5, (235, 235, 245), (150, 150, 185))
    ridge(im, 88, 16, 4, (54, 34, 104), 11)                       # far mountains
    ridge(im, 98, 10, 3, (36, 26, 76), 12)                        # nearer hills
    hs = ridge(im, 108, 6, 2, (52, 38, 30), 13, top=(58, 140, 70))  # grass blocks
    d = ImageDraw.Draw(im)
    r = random.Random(5)
    for x, y in hs[::9]:
        if 40 < x < 280 and r.random() < 0.75:
            tree(d, x, y, 3 if r.random() < 0.5 else 2, (40, 110, 60), (80, 56, 40))
    hx, hy = min(hs, key=lambda q: abs(q[0] - 160))
    house(d, 152, hy, 2, (140, 110, 80), (90, 50, 60), (255, 210, 110))
    return im.resize((w * 2, h * 2), Image.NEAREST)


def banner(kind):
    w, h = 96, 54
    if kind == "galaxysmp":
        im = sky(w, h, NIGHT); nebula(im, [((90, 200, 255), 3), ((180, 90, 255), 3)], 1); stars(im, 70, 2, 0.8)
        planet(im, 72, 14, 7, (120, 180, 255), (70, 60, 170), ring=(200, 220, 255))
        d = ImageDraw.Draw(im)
        d.polygon([(18, 34), (62, 34), (54, 44), (44, 50), (30, 46)], fill=(70, 50, 40, 255))   # floating island
        d.rectangle((18, 31, 61, 34), fill=(70, 160, 80, 255))
        tree(d, 22, 31, 2, (50, 130, 70), (90, 60, 40))
        house(d, 36, 31, 2, (150, 120, 85), (100, 55, 65), (255, 215, 120))
    elif kind == "event":
        im = sky(w, h, [(0, (10, 8, 30)), (1, (60, 20, 70))]); stars(im, 40, 4)
        d = ImageDraw.Draw(im)
        r = random.Random(9)
        for cx, cy, c in ((24, 16, (255, 90, 120)), (52, 12, (255, 220, 90)), (76, 20, (90, 220, 255)), (40, 26, (170, 120, 255))):
            for i in range(14):
                a = i / 14 * 6.28
                for k in range(2, 9, 2):
                    d.point((cx + math.cos(a) * k, cy + math.sin(a) * k), fill=c + (255 - k * 18,))
        for x in range(0, w, 5):   # crowd
            hh = r.randint(4, 7)
            d.rectangle((x, h - hh, x + 3, h), fill=(20, 14, 34, 255))
            d.rectangle((x + 1, h - hh - 2, x + 2, h - hh), fill=(20, 14, 34, 255))
    elif kind == "bedwars":
        im = sky(w, h, [(0, (20, 30, 70)), (1, (90, 60, 140))]); stars(im, 30, 5)
        d = ImageDraw.Draw(im)
        for x0, col in ((8, (220, 60, 60)), (58, (60, 120, 230))):
            d.polygon([(x0, 36), (x0 + 30, 36), (x0 + 24, 46), (x0 + 6, 46)], fill=(80, 60, 45, 255))
            d.rectangle((x0, 33, x0 + 29, 36), fill=(90, 170, 90, 255))
            d.rectangle((x0 + 9, 29, x0 + 21, 33), fill=col + (255,))       # bed
            d.rectangle((x0 + 9, 29, x0 + 12, 33), fill=(240, 240, 240, 255))
        d.rectangle((38, 34, 57, 35), fill=(230, 220, 200, 255))           # bridge
        d.rectangle((44, 18, 51, 25), fill=(80, 255, 200, 255))             # gem
    elif kind == "parkour":
        im = sky(w, h, [(0, (90, 170, 255)), (1, (200, 230, 255))])
        d = ImageDraw.Draw(im)
        for i, (x, y) in enumerate(((6, 44), (22, 38), (38, 32), (54, 26), (70, 20), (84, 14))):
            c = [(120, 200, 120), (230, 200, 90), (110, 170, 240), (240, 120, 140), (170, 120, 240), (255, 230, 120)][i]
            d.rectangle((x, y, x + 8, y + 5), fill=c + (255,))
            d.rectangle((x, y + 5, x + 8, y + 6), fill=lerp(c, (0, 0, 0), 0.35) + (255,))
        d.rectangle((88, 6, 89, 14), fill=(250, 250, 250, 255)); d.rectangle((90, 6, 94, 9), fill=(80, 220, 120, 255))   # flag
    else:   # build
        im = sky(w, h, [(0, (255, 170, 110)), (1, (130, 90, 170))])
        d = ImageDraw.Draw(im)
        d.rectangle((0, 46, w, h), fill=(70, 150, 80, 255))
        for i in range(5):
            d.rectangle((20 + i * 8, 46 - (i + 1) * 6, 27 + i * 8, 46), fill=[(200, 90, 70), (230, 200, 120), (110, 160, 230), (230, 230, 230), (160, 110, 200)][i] + (255,))
        d.rectangle((74, 8, 75, 46), fill=(250, 200, 60, 255)); d.rectangle((56, 8, 88, 9), fill=(250, 200, 60, 255))
        d.line((62, 10, 62, 22), fill=(60, 60, 60, 255)); d.rectangle((60, 22, 64, 25), fill=(200, 90, 70, 255))
    return im.resize((w * 2, h * 2), Image.NEAREST)


def card(fill, border, glow):
    im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, 23, 23), radius=4, fill=fill, outline=border)
    d.line((3, 1, 20, 1), fill=glow)
    return im


os.makedirs(OUT, exist_ok=True)
title_bg().save(os.path.join(OUT, "gsmp_title_bg.png"))
for k in ("galaxysmp", "event", "bedwars", "parkour", "build"):
    banner(k).save(os.path.join(OUT, f"gsmp_srv_{k}.png"))
card((14, 18, 44, 215), (90, 110, 190, 255), (140, 170, 255, 160)).save(os.path.join(OUT, "gsmp_card.png"))
card((26, 34, 80, 230), (110, 220, 255, 255), (170, 235, 255, 200)).save(os.path.join(OUT, "gsmp_card_hover.png"))
card((40, 30, 90, 235), (190, 140, 255, 255), (220, 190, 255, 200)).save(os.path.join(OUT, "gsmp_card_pressed.png"))
for n in ("gsmp_card", "gsmp_card_hover", "gsmp_card_pressed"):
    open(os.path.join(OUT, n + ".json"), "w").write('{"nineslice_size": 6, "base_size": [24, 24]}')
if len(sys.argv) > 2:
    bg = Image.open(os.path.join(OUT, "gsmp_title_bg.png"))
    prev = Image.new("RGBA", (bg.width, bg.height + 230), (20, 20, 20, 255))
    prev.paste(bg, (0, 0))
    for i, k in enumerate(("galaxysmp", "event", "bedwars", "parkour", "build")):
        b = Image.open(os.path.join(OUT, f"gsmp_srv_{k}.png"))
        prev.paste(b, (6 + i * 128 if i < 5 else 0, bg.height + 10))
    prev.save(sys.argv[2])
print("title art drawn")
