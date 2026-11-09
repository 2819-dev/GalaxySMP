# Draws the galaxy-themed pause menu textures (buttons, panels, divider) into src/textures/ui/.
# Buttons are 9-slice: the border stays sharp at any size (see the .json next to each png).
# Usage: python3 draw_menu.py src/textures/ui
import json, os, random, sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(w, h, top, bottom):
    im = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        d.line((0, y, w, y), fill=lerp(top, bottom, y / max(1, h - 1)))
    return im


def stars(im, n, seed, colors=((255, 255, 255, 255), (190, 220, 255, 255), (255, 230, 255, 200)), margin=2):
    r = random.Random(seed)
    px = im.load()
    w, h = im.size
    for _ in range(n):
        x, y = r.randint(margin, w - 1 - margin), r.randint(margin, h - 1 - margin)
        px[x, y] = r.choice(colors)


def button(name, top, bottom, border, glow, seed):
    """32x16 button: dark glassy space fill, glowing rim, a few stars. 9-slice border 4px."""
    w, h = 32, 16
    im = gradient(w, h, top, bottom)  # no stars here: the middle stretches, stars would smear
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w - 1, h - 1), outline=(6, 6, 18, 255))      # dark outer edge
    d.rectangle((1, 1, w - 2, h - 2), outline=border)                 # glowing rim
    d.line((2, 2, w - 3, 2), fill=glow)                               # shine along the top
    d.line((2, h - 3, w - 3, h - 3), fill=lerp(bottom, (0, 0, 0, 255), 0.4))  # shade at the bottom
    im.save(os.path.join(OUT, f"{name}.png"))
    json.dump({"nineslice_size": 4, "base_size": [w, h]}, open(os.path.join(OUT, f"{name}.json"), "w"))


# normal / hover / pressed, purple-blue like the logo, with a cyan rim
button("gsmp_button", (44, 26, 104, 255), (18, 30, 86, 255), (61, 170, 244, 255), (120, 200, 255, 255), 1)
button("gsmp_button_hover", (70, 40, 150, 255), (30, 60, 150, 255), (111, 230, 255, 255), (190, 240, 255, 255), 2)
button("gsmp_button_pressed", (24, 16, 64, 255), (12, 20, 60, 255), (33, 73, 221, 255), (61, 120, 230, 255), 3)
# toggle "on" (a panel is open)
button("gsmp_button_on", (60, 30, 130, 255), (30, 50, 140, 255), (255, 210, 90, 255), (255, 235, 160, 255), 4)
# leave button: red-pink nebula
button("gsmp_button_exit", (110, 24, 70, 255), (60, 14, 60, 255), (255, 90, 140, 255), (255, 170, 200, 255), 5)
button("gsmp_button_exit_hover", (150, 36, 96, 255), (90, 20, 84, 255), (255, 150, 190, 255), (255, 210, 230, 255), 6)

# Menu card: deep space with a nebula glow and stars, glowing border. 9-slice border 6px.
W, H = 96, 128
card = gradient(W, H, (26, 14, 62, 242), (8, 18, 52, 242))  # purple to blue; stars are a separate tiled layer
d = ImageDraw.Draw(card)
d.rectangle((0, 0, W - 1, H - 1), outline=(6, 6, 18, 255))
d.rectangle((1, 1, W - 2, H - 2), outline=(61, 170, 244, 255))
d.rectangle((2, 2, W - 3, H - 3), outline=(70, 60, 160, 160))
card.save(os.path.join(OUT, "gsmp_panel.png"))
json.dump({"nineslice_size": 6, "base_size": [W, H]}, open(os.path.join(OUT, "gsmp_panel.json"), "w"))

# Small info box (help / goodbye): darker, gold-ish rim. 9-slice border 4px.
box = gradient(48, 32, (14, 10, 36, 240), (8, 12, 32, 240))
d = ImageDraw.Draw(box)
d.rectangle((0, 0, 47, 31), outline=(6, 6, 18, 255))
d.rectangle((1, 1, 46, 30), outline=(150, 110, 255, 255))
box.save(os.path.join(OUT, "gsmp_box.png"))
json.dump({"nineslice_size": 4, "base_size": [48, 32]}, open(os.path.join(OUT, "gsmp_box.json"), "w"))

# Starfield: repeats (tiles) across the card without stretching. Transparent between stars.
sky = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
r = random.Random(11)
spx = sky.load()
for _ in range(26):
    x, y = r.randrange(64), r.randrange(64)
    spx[x, y] = r.choice(((255, 255, 255, 230), (180, 215, 255, 200), (230, 190, 255, 170), (255, 255, 255, 120)))
for x, y in ((12, 20), (44, 50)):  # two brighter twinkles
    for dx, dy, a in ((0, 0, 255), (1, 0, 110), (-1, 0, 110), (0, 1, 110), (0, -1, 110)):
        spx[(x + dx) % 64, (y + dy) % 64] = (220, 235, 255, a)
sky.save(os.path.join(OUT, "gsmp_stars.png"))

# Soft nebula glow: one smooth blob, stretched over the card (smooth, so stretching is fine).
neb = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
npx = neb.load()
for y in range(64):
    for x in range(64):
        a = max(0.0, 1 - (((x - 20) / 30) ** 2 + ((y - 22) / 26) ** 2)) * 60
        b = max(0.0, 1 - (((x - 46) / 26) ** 2 + ((y - 48) / 22) ** 2)) * 55
        if a + b > 0:
            c = lerp((140, 70, 230), (50, 140, 240), b / (a + b))
            npx[x, y] = c + (int(min(255, a + b)),)
neb.save(os.path.join(OUT, "gsmp_nebula.png"))

# Divider under the logo: a glowing line that fades out at both ends.
div = Image.new("RGBA", (128, 3), (0, 0, 0, 0))
px = div.load()
for x in range(128):
    a = 1 - abs(x - 63.5) / 64
    c = lerp((150, 80, 255), (79, 235, 253), x / 127)
    px[x, 1] = c + (int(255 * a),)
    px[x, 0] = c + (int(90 * a),)
    px[x, 2] = c + (int(90 * a),)
div.save(os.path.join(OUT, "gsmp_divider.png"))

# Preview sheet (not packed)
prev = Image.new("RGBA", (360, 260), (30, 30, 34, 255))
for i, n in enumerate(["gsmp_button", "gsmp_button_hover", "gsmp_button_pressed", "gsmp_button_on", "gsmp_button_exit", "gsmp_button_exit_hover"]):
    b = Image.open(os.path.join(OUT, n + ".png")).resize((128, 64), Image.NEAREST)
    prev.paste(b, (8 + (i % 2) * 140, 8 + (i // 2) * 72), b)
p = card.resize((72, 96), Image.NEAREST); prev.paste(p, (285, 8), p)
prev.save(os.path.join(OUT, "_menu_preview.png"))
print("drew menu textures")
