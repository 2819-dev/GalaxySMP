# The joining animation (like the website's loading screen): a block shakes, cracks, then bursts into pieces with
# sparkles in its colour. One flip book per block: textures/ui/gsmp_join_<theme>.png (24 frames of 160x160, stacked).
#   python3 draw_join.py <block texture folder> <output folder> [preview.png]
import math, os, random, sys
from PIL import Image, ImageDraw, ImageFilter

TEX, OUT = sys.argv[1], sys.argv[2]
F, S, N = 160, 3, 24          # frame size, texel size in pixels, frames

THEMES = {   # name: (top texture, side texture, tint, glow colour)
    "grass": ("grass_top", "grass_side_carried", (0.50, 0.76, 0.33), (120, 230, 120)),
    "diamond": ("diamond_block", "diamond_block", None, (110, 240, 255)),
    "gold": ("gold_block", "gold_block", None, (255, 215, 80)),
    "emerald": ("emerald_block", "emerald_block", None, (77, 255, 138)),
    "netherite": ("netherite_block", "netherite_block", None, (199, 125, 255)),
    "amethyst": ("amethyst_block", "amethyst_block", None, (212, 156, 255)),
    "lava": ("lava_still", "lava_still", None, (255, 138, 61)),
    "ice": ("ice", "ice", None, (169, 230, 255)),
    "galaxy": ("obsidian", "obsidian", None, (150, 120, 255)),
    "ender": ("end_stone", "end_stone", None, (93, 245, 201)),
    "rainbow": ("wool_colored_red", "wool_colored_red", None, (255, 255, 255)),
}
RAINBOW = [(255, 77, 77), (255, 159, 64), (255, 225, 77), (92, 230, 92), (77, 195, 255), (122, 107, 255), (214, 92, 255)]


def tex(name, tint):
    im = Image.open(os.path.join(TEX, name + ".png")).convert("RGBA").crop((0, 0, 16, 16))
    px = [[im.getpixel((x, y)) for x in range(16)] for y in range(16)]
    if tint:
        px = [[(int(r * tint[0]), int(g * tint[1]), int(b * tint[2]), a) for (r, g, b, a) in row] for row in px]
    return px


def themed(theme, px, x, y):
    r, g, b, a = px[y][x]
    if theme == "galaxy":   # obsidian with stars and a purple-cyan glow
        rnd = ((x * 73856093) ^ (y * 19349663)) % 17
        if rnd == 0:
            return (240, 240, 255, 255)
        k = (x + y) / 30
        return (int(r * 0.6 + 70 * (1 - k)), int(g * 0.6 + 40), int(b * 0.6 + 150 * k + 60), 255)
    if theme == "rainbow":
        c = RAINBOW[(x // 2 + y // 2) % len(RAINBOW)]
        return c + (255,)
    return (r, g, b, 255)


def iso(cx, cy, size, u, v, face):
    """Corner of texel (u, v) on a face of an isometric cube (top, left, right)."""
    h = size / 2
    if face == "top":
        x = cx + (u - v) * h / 16; y = cy - h + (u + v) * h / 32
    elif face == "left":
        x = cx - h + u * h / 16; y = cy + (u * h / 32) + v * h / 16 - h / 2
    else:
        x = cx + u * h / 16; y = cy + h / 2 - u * h / 32 + v * h / 16 - h / 2
    return x, y


def draw_cube(d, cx, cy, size, top, side, theme, crack=0.0, shade=(1.0, 0.78, 0.6), cracks=None):
    for face, px, sh in (("top", top, shade[0]), ("left", side, shade[1]), ("right", side, shade[2])):
        for v in range(16):
            for u in range(16):
                r, g, b, a = themed(theme, px, u, v)
                quad = [iso(cx, cy, size, u, v, face), iso(cx, cy, size, u + 1, v, face),
                        iso(cx, cy, size, u + 1, v + 1, face), iso(cx, cy, size, u, v + 1, face)]
                c = (int(r * sh), int(g * sh), int(b * sh), 255)
                if cracks and (face, u, v) in cracks and cracks[(face, u, v)] < crack:
                    c = (int(c[0] * 0.25), int(c[1] * 0.25), int(c[2] * 0.25), 255)
                d.polygon(quad, fill=c)


def crack_map(seed):
    """Crack lines across the faces: each texel gets the moment (0..1) it cracks."""
    rnd = random.Random(seed)
    out = {}
    for face in ("top", "left", "right"):
        for _ in range(4):
            u, v = rnd.randrange(16), rnd.randrange(16)
            t0 = rnd.random() * 0.5
            for step in range(18):
                out[(face, u, v)] = min(out.get((face, u, v), 1), t0 + step / 30)
                u = max(0, min(15, u + rnd.choice((-1, 0, 1, 1))))
                v = max(0, min(15, v + rnd.choice((-1, 0, 1))))
    return out


def frames(theme):
    topn, siden, tint, glow = THEMES[theme]
    top, side = tex(topn, tint), tex(siden, tint)
    sheet = Image.new("RGBA", (F, F * N), (0, 0, 0, 0))
    cracks = crack_map(len(theme))
    rnd = random.Random(theme)
    pieces = []
    for _ in range(34):
        a = rnd.random() * math.tau
        sp = rnd.uniform(1.8, 4.2)
        pieces.append(dict(dx=math.cos(a) * sp, dy=math.sin(a) * sp - 2.2, s=rnd.uniform(9, 17), u=rnd.randrange(12), v=rnd.randrange(12),
                           face=rnd.choice(("top", "left", "right")), spin=rnd.uniform(-0.3, 0.3)))
    sparks = [(rnd.random() * math.tau, rnd.uniform(2.5, 6.5), rnd.uniform(1.5, 3.5)) for _ in range(40)]
    for f in range(N):
        im = Image.new("RGBA", (F, F), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        cx, cy = F / 2, F / 2 + 6
        # soft glow behind
        g = Image.new("RGBA", (F, F), (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
        strength = 0.35 + 0.5 * (f / 9 if f < 10 else max(0, 1 - (f - 10) / 12))
        gd.ellipse((cx - 52, cy - 52, cx + 52, cy + 52), fill=glow + (int(120 * strength),))
        im.alpha_composite(g.filter(ImageFilter.GaussianBlur(18)))
        if f < 10:   # shake and crack
            sh = (math.sin(f * 2.7) * min(f, 6) * 0.5, math.cos(f * 3.1) * min(f, 6) * 0.3)
            size = 96 + (f / 9) * 8
            draw_cube(d, cx + sh[0], cy + sh[1], size, top, side, theme, crack=f / 9, cracks=cracks)
            if f == 9:
                fl = Image.new("RGBA", (F, F), (255, 255, 255, 0)); fd = ImageDraw.Draw(fl)
                fd.ellipse((cx - 58, cy - 58, cx + 58, cy + 58), fill=(255, 255, 255, 170))
                im.alpha_composite(fl.filter(ImageFilter.GaussianBlur(6)))
        else:        # burst
            t = f - 9
            fade = max(0, 1 - t / 15)
            for pc in pieces:
                x = cx + pc["dx"] * t * 4.2; y = cy + pc["dy"] * t * 4.2 + 0.55 * t * t
                s = pc["s"] * (1 - t / 22)
                if s < 2:
                    continue
                px = top if pc["face"] == "top" else side
                r, gg, b, _ = themed(theme, px, pc["u"], pc["v"])
                sh = {"top": 1.0, "left": 0.78, "right": 0.6}[pc["face"]]
                c = (int(r * sh), int(gg * sh), int(b * sh), int(255 * fade))
                a = pc["spin"] * t
                pts = [(x + math.cos(a + k * math.pi / 2) * s * 0.7, y + math.sin(a + k * math.pi / 2) * s * 0.7) for k in range(4)]
                d.polygon(pts, fill=c)
            for a, sp, sz in sparks:
                x = cx + math.cos(a) * sp * t * 3.2; y = cy + math.sin(a) * sp * t * 3.2
                al = int(255 * max(0, 1 - t / 13))
                col = RAINBOW[int(a * 3) % 7] if theme == "rainbow" else glow
                d.rectangle((x - sz / 2, y - sz / 2, x + sz / 2, y + sz / 2), fill=(min(255, col[0] + 60), min(255, col[1] + 60), min(255, col[2] + 60), al))
        sheet.paste(im, (0, f * F))
    return sheet


os.makedirs(OUT, exist_ok=True)
for th in THEMES:
    frames(th).save(os.path.join(OUT, f"gsmp_join_{th}.png"), optimize=True)
if len(sys.argv) > 3:
    prev = Image.new("RGBA", (F * 8, F * 2), (16, 18, 40, 255))
    sh = Image.open(os.path.join(OUT, "gsmp_join_diamond.png"))
    for i, f in enumerate((0, 4, 8, 9, 10, 12, 15, 19)):
        prev.alpha_composite(sh.crop((0, f * F, F, f * F + F)), (i * F, 0))
    sh = Image.open(os.path.join(OUT, "gsmp_join_galaxy.png"))
    for i, f in enumerate((0, 4, 8, 9, 10, 12, 15, 19)):
        prev.alpha_composite(sh.crop((0, f * F, F, f * F + F)), (i * F, F))
    prev.save(sys.argv[3])
print("join animations drawn:", ", ".join(THEMES))
