# Draws 16x16 pixel-art voice icons in the style of Simple Voice Chat:
# shapes in a fill color, then an automatic 1px dark outline.
from PIL import Image, ImageDraw
import os, sys
OUT = sys.argv[1]
W, G, Y, R, GR = (255,255,255,255), (85,255,85,255), (255,213,74,255), (255,72,72,255), (170,170,170,255)
K = (24,24,32,255)

def outline(img):
    px = img.load(); out = img.copy(); po = out.load()
    for y in range(16):
        for x in range(16):
            if px[x,y][3]: continue
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < 16 and 0 <= ny < 16 and px[nx,ny][3] and px[nx,ny] != K:
                        po[x,y] = K
    return out

def speaker(c):
    im = Image.new("RGBA", (16,16)); d = ImageDraw.Draw(im)
    d.rectangle((2,6,4,9), fill=c)
    d.polygon([(5,6),(8,3),(8,12),(5,9)], fill=c)
    for p in [(10,6),(10,7),(10,8),(10,9)]: d.point(p, fill=c)
    for p in [(12,4),(13,5),(13,6),(13,7),(13,8),(13,9),(13,10),(12,11)]: d.point(p, fill=c)
    return im

def mic(c):
    im = Image.new("RGBA", (16,16)); d = ImageDraw.Draw(im)
    d.rectangle((6,2,9,8), fill=c); d.line((7,1,8,1), fill=c)          # capsule
    for y in (5,6,7): d.point((4,y), fill=c); d.point((11,y), fill=c)  # holder sides
    d.point((5,8), fill=c); d.point((10,8), fill=c)
    d.line((6,9,9,9), fill=c)                                        # holder bottom
    d.line((7,10,7,11), fill=c); d.line((8,10,8,11), fill=c)         # stand
    d.line((5,12,10,12), fill=c)                                     # base
    return im

def headphones(c):
    im = Image.new("RGBA", (16,16)); d = ImageDraw.Draw(im)
    d.line((5,2,10,2), fill=c); d.point((4,3), fill=c); d.point((11,3), fill=c)
    d.line((3,4,3,8), fill=c); d.line((12,4,12,8), fill=c)            # band
    d.rectangle((2,9,4,13), fill=c); d.rectangle((11,9,13,13), fill=c)  # ear cups
    return im

def slash(im, c=R):
    # Dark border first, then the red line on top, drawn after the outline.
    d = ImageDraw.Draw(im)
    for i in range(1, 15):
        for dx, dy in ((0, -1), (1, -1), (-1, 1), (0, 1), (-1, 0), (1, 0)):
            x, y = i + dx, i + dy
            if 0 <= x < 16 and 0 <= y < 16 and im.getpixel((x, y))[3] == 0:
                d.point((x, y), fill=K)
    for i in range(1, 15):
        d.point((i, i), fill=c)
    return im

def plug():
    im = Image.new("RGBA", (16,16)); d = ImageDraw.Draw(im)
    # cable and plug (left), gap, socket (right)
    d.line((0,8,2,8), fill=GR); d.line((0,9,2,9), fill=GR)
    d.rectangle((3,6,6,11), fill=W)
    d.line((7,7,8,7), fill=W); d.line((7,10,8,10), fill=W)
    d.rectangle((11,5,13,12), fill=W)
    d.line((14,8,15,8), fill=GR); d.line((14,9,15,9), fill=GR)
    return im

icons = {
    "talking": speaker(W),
    "talking_group": speaker(G),
    "talking_global": speaker(Y),
    "muted": ("slash", mic(W)),
    "deafened": ("slash", headphones(W)),
    "voice_muted": ("slash", mic(GR)),
    "disconnected": plug(),
}
os.makedirs(OUT, exist_ok=True)
sheet = Image.new("RGBA", (16*len(icons)*8 + 8*len(icons), 16*8), (60,140,60,255))
for i, (name, im) in enumerate(icons.items()):
    if isinstance(im, tuple):
        im = slash(outline(im[1]))
    else:
        im = outline(im)
    im.save(os.path.join(OUT, name + ".png"))
    sheet.paste(im.resize((128,128), Image.NEAREST), (i*136, 0), im.resize((128,128), Image.NEAREST))
sheet.save(os.path.join(OUT, "_preview.png"))
print("drew", list(icons))
