# 16x16 pixel-art rank icons (crown, star...), same outline style as the voice icons.
from PIL import Image, ImageDraw
import os, sys
OUT = sys.argv[1]
K = (24, 24, 32, 255)

def _mix(c, t, k):
    return tuple(round(a + (b - a) * k) for a, b in zip(c[:3], t)) + (c[3],)


def shade(img):
    """Light from the top-left: brighten pixels facing up-left, darken pixels facing down-right.
    Thin 1-pixel lines are left alone so they stay crisp."""
    px = img.load(); out = img.copy(); po = out.load()
    clear = lambda x, y: not (0 <= x < 16 and 0 <= y < 16) or px[x, y][3] == 0
    for y in range(16):
        for x in range(16):
            c = px[x, y]
            if not c[3]:
                continue
            lit = clear(x, y - 1) or clear(x - 1, y)
            dark = clear(x, y + 1) or clear(x + 1, y)
            if lit and dark:
                continue
            if lit:
                po[x, y] = _mix(c, (255, 255, 255), 0.35)
            elif dark:
                po[x, y] = _mix(c, (0, 0, 0), 0.30)
    return out


def outline(img):
    img = shade(img)
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
    d.polygon([(2,2),(14,2),(14,8),(8,14),(2,8)], fill=(255,200,40,255))      # gold rim
    d.polygon([(4,4),(12,4),(12,8),(8,12),(4,8)], fill=(70,130,255,255))      # blue face
    d.polygon([(8,4),(12,4),(12,8),(8,12)], fill=(45,95,215,255))             # right half in shadow
    d.ellipse((6,6,10,10), fill=(255,200,40,255))                             # gold boss
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

def pickaxe():
    im, d = new()
    d.arc((1,1,15,11), 200, 340, fill=(90,220,230,255), width=2)
    d.line((8,3,8,3), fill=(90,220,230,255))
    d.line((5,14,10,5), fill=(150,100,55,255), width=2)
    return im
def axe():
    im, d = new()
    d.line((4,14,11,3), fill=(150,100,55,255), width=2)
    d.polygon([(9,2),(14,3),(14,8),(11,7)], fill=(190,195,210,255))
    return im
def bow():
    im, d = new()
    d.arc((-4,2,10,14), 270, 90, fill=(150,100,55,255), width=2)
    d.line((3,2,3,14), fill=(230,230,230,255))
    d.line((3,8,14,8), fill=(200,200,210,255)); d.polygon([(12,6),(15,8),(12,10)], fill=(190,195,210,255))
    return im
def potion():
    im, d = new()
    d.rectangle((7,1,9,4), fill=(200,220,240,255)); d.rectangle((7,1,9,1), fill=(150,100,55,255))
    d.ellipse((3,5,13,15), fill=(230,80,200,255)); d.point((6,8), fill=(255,200,240,255)); d.point((5,9), fill=(255,200,240,255))
    return im
def book():
    im, d = new()
    d.rectangle((3,2,13,14), fill=(150,60,40,255)); d.rectangle((4,3,12,12), fill=(190,80,55,255))
    d.rectangle((4,13,13,14), fill=(240,235,220,255)); d.line((6,6,10,6), fill=(255,210,80,255))
    return im
def key():
    im, d = new(); g = (255,200,40,255)
    d.ellipse((1,2,7,8), fill=g); d.point((4,5), fill=(0,0,0,0))
    d.line((6,7,14,15), fill=g, width=2); d.line((11,12,13,10), fill=g, width=2)
    return im
def trophy():
    im, d = new(); g = (255,200,40,255)
    d.rectangle((4,2,12,7), fill=g); d.ellipse((4,4,12,11), fill=g)
    d.point((2,4), fill=g); d.point((3,6), fill=g); d.point((14,4), fill=g); d.point((13,6), fill=g)
    d.rectangle((7,11,9,12), fill=g); d.rectangle((5,13,11,14), fill=(200,140,30,255))
    return im
def medal():
    im, d = new()
    d.polygon([(4,1),(7,1),(9,7),(6,7)], fill=(60,120,240,255)); d.polygon([(9,1),(12,1),(10,7),(7,7)], fill=(230,60,70,255))
    d.ellipse((4,7,12,15), fill=(255,200,40,255)); d.point((8,11), fill=(255,240,160,255))
    return im
def code():
    im, d = new(); c = (120,240,140,255)
    d.line((5,4,1,8), fill=c, width=2); d.line((1,8,5,12), fill=c, width=2)
    d.line((11,4,15,8), fill=c, width=2); d.line((15,8,11,12), fill=c, width=2)
    d.line((9,3,7,13), fill=(200,255,210,255))
    return im
def music():
    im, d = new(); c = (120,200,255,255)
    d.rectangle((6,2,14,3), fill=c); d.line((6,2,6,12), fill=c, width=2); d.line((13,2,13,10), fill=c, width=2)
    d.ellipse((2,10,7,14), fill=c); d.ellipse((9,8,14,12), fill=c)
    return im
def paw():
    im, d = new(); c = (255,170,90,255)
    d.ellipse((4,8,12,15), fill=c)
    for x, y in ((1,5),(4,2),(9,2),(12,5)): d.ellipse((x,y,x+3,y+3), fill=c)
    return im
def fish():
    im, d = new()
    d.ellipse((1,4,11,12), fill=(80,170,255,255)); d.polygon([(10,8),(15,4),(15,12)], fill=(60,130,230,255))
    d.point((4,7), fill=(20,20,30,255))
    return im
def mushroom():
    im, d = new()
    d.pieslice((1,2,15,16), 180, 360, fill=(230,50,50,255)); d.rectangle((6,9,10,14), fill=(240,230,210,255))
    for x, y in ((4,5),(9,4),(12,7)): d.point((x,y), fill=(255,255,255,255)); d.point((x+1,y), fill=(255,255,255,255))
    return im
def flower():
    im, d = new(); p = (255,140,200,255)
    for x, y in ((6,1),(2,5),(10,5),(6,9)): d.ellipse((x,y,x+5,y+5), fill=p)
    d.ellipse((6,5,10,9), fill=(255,220,60,255))
    return im
def moon():
    im, d = new()
    d.ellipse((2,2,14,14), fill=(240,230,150,255)); d.ellipse((6,0,16,10), fill=(0,0,0,0))
    return im
def sun():
    im, d = new(); y = (255,210,50,255)
    d.ellipse((4,4,12,12), fill=y)
    for a, b, c, e in ((8,0,8,2),(8,14,8,15),(0,8,2,8),(14,8,15,8),(2,2,3,3),(13,2,12,3),(2,13,3,12),(13,13,12,12)): d.line((a,b,c,e), fill=y)
    return im
def snowflake():
    im, d = new(); c = (180,230,255,255)
    d.line((8,1,8,15), fill=c); d.line((2,4,14,12), fill=c); d.line((2,12,14,4), fill=c)
    for x, y in ((7,2),(9,2),(7,14),(9,14)): d.point((x,y), fill=c)
    return im
def skull():
    im, d = new(); w = (235,235,225,255)
    d.ellipse((2,1,14,12), fill=w); d.rectangle((5,11,11,14), fill=w)
    d.rectangle((4,6,6,8), fill=(30,30,40,255)); d.rectangle((10,6,12,8), fill=(30,30,40,255))
    d.point((7,13), fill=(120,120,120,255)); d.point((9,13), fill=(120,120,120,255))
    return im
def ghost():
    im, d = new(); w = (230,235,255,255)
    d.pieslice((2,1,14,13), 180, 360, fill=w); d.rectangle((2,7,14,13), fill=w)
    d.polygon([(2,13),(4,15),(6,13),(8,15),(10,13),(12,15),(14,13)], fill=w)
    d.rectangle((5,5,6,7), fill=(40,40,60,255)); d.rectangle((10,5,11,7), fill=(40,40,60,255))
    return im
def eye():
    im, d = new()
    d.ellipse((1,4,15,12), fill=(240,240,245,255)); d.ellipse((5,4,11,12), fill=(130,90,220,255))
    d.ellipse((7,6,9,10), fill=(20,20,30,255)); d.point((6,6), fill=(255,255,255,255))
    return im

def coin():
    im, d = new()
    d.ellipse((2,2,14,14), fill=(255,200,40,255)); d.ellipse((4,4,12,12), fill=(240,170,30,255))
    d.arc((5,5,11,11), 200, 290, fill=(255,235,140,255))  # shine, no symbol
    return im
def moneybag():
    im, d = new()
    d.ellipse((2,5,14,15), fill=(170,130,70,255)); d.polygon([(6,2),(10,2),(9,5),(7,5)], fill=(170,130,70,255))
    d.line((6,5,10,5), fill=(120,80,40,255))
    s_ = (90,200,90,255)  # a little "S" for money, no crossing lines
    for x, y in ((9,8),(8,8),(7,9),(8,10),(9,11),(8,12),(7,12)): d.point((x,y), fill=s_)
    return im
def gift():
    im, d = new()
    d.rectangle((2,6,14,14), fill=(230,60,80,255)); d.rectangle((1,4,15,7), fill=(240,80,100,255))
    d.rectangle((7,4,9,14), fill=(255,210,60,255))
    d.polygon([(8,4),(4,1),(4,4)], fill=(255,210,60,255)); d.polygon([(8,4),(12,1),(12,4)], fill=(255,210,60,255))
    return im
def cake():
    im, d = new()
    d.rectangle((2,8,14,14), fill=(240,200,150,255)); d.rectangle((2,6,14,9), fill=(250,250,250,255))
    d.point((4,10), fill=(250,250,250,255)); d.point((9,10), fill=(250,250,250,255))
    d.line((8,2,8,5), fill=(120,200,255,255)); d.point((8,1), fill=(255,180,40,255))
    for x in (4,7,11): d.point((x,7), fill=(230,50,60,255))
    return im
def cookie():
    im, d = new()
    d.ellipse((2,2,14,14), fill=(215,160,90,255))
    for x, y in ((5,5),(9,4),(10,9),(5,10),(8,7)): d.rectangle((x,y,x+1,y), fill=(90,55,30,255))
    return im
def apple():
    im, d = new()
    d.ellipse((2,4,9,14), fill=(225,40,50,255)); d.ellipse((7,4,14,14), fill=(225,40,50,255))
    d.line((8,1,8,4), fill=(120,80,40,255)); d.polygon([(9,3),(12,1),(12,3)], fill=(80,190,70,255))
    return im
def bell():
    im, d = new(); g = (255,200,40,255)
    d.pieslice((3,1,13,13), 180, 360, fill=g); d.rectangle((3,7,13,11), fill=g)
    d.rectangle((1,11,15,12), fill=g); d.ellipse((7,12,9,14), fill=(200,140,30,255))
    return im
def lightbulb():
    im, d = new()
    d.ellipse((3,1,13,11), fill=(255,235,110,255)); d.rectangle((6,10,10,11), fill=(255,235,110,255))
    d.rectangle((6,12,10,14), fill=(170,175,190,255)); d.line((6,13,10,13), fill=(120,125,140,255))
    d.point((6,4), fill=(255,255,230,255)); d.point((5,5), fill=(255,255,230,255))
    return im
def magnet():
    im, d = new(); r = (225,50,60,255)
    d.arc((2,2,14,14), 180, 360, fill=r, width=3); d.rectangle((2,8,4,11), fill=r); d.rectangle((12,8,14,11), fill=r)
    d.rectangle((2,12,4,14), fill=(220,225,235,255)); d.rectangle((12,12,14,14), fill=(220,225,235,255))
    return im
def compass():
    im, d = new()
    d.ellipse((1,1,15,15), fill=(200,205,215,255)); d.ellipse((3,3,13,13), fill=(245,240,225,255))
    d.polygon([(8,3),(10,8),(6,8)], fill=(225,50,60,255)); d.polygon([(8,13),(10,8),(6,8)], fill=(90,95,110,255))
    return im
def clock():
    im, d = new()
    d.ellipse((1,1,15,15), fill=(255,200,40,255)); d.ellipse((3,3,13,13), fill=(250,248,240,255))
    d.line((8,4,8,8), fill=(40,40,50,255)); d.line((8,8,11,10), fill=(40,40,50,255))
    return im
def hourglass():
    im, d = new(); w = (150,100,55,255)
    d.rectangle((3,1,13,2), fill=w); d.rectangle((3,14,13,15), fill=w)
    d.polygon([(4,3),(12,3),(8,8)], fill=(200,230,250,255)); d.polygon([(8,8),(12,13),(4,13)], fill=(200,230,250,255))
    d.polygon([(6,5),(10,5),(8,7)], fill=(240,200,100,255)); d.polygon([(8,10),(11,13),(5,13)], fill=(240,200,100,255))
    return im
def flag():
    im, d = new()
    d.line((3,1,3,15), fill=(170,175,190,255), width=2)
    d.polygon([(5,2),(14,2),(12,5),(14,8),(5,8)], fill=(60,200,120,255))
    return im
def anchor():
    im, d = new(); c = (150,160,185,255)
    d.ellipse((6,1,10,5), fill=c); d.point((8,3), fill=(0,0,0,0))
    d.line((8,5,8,14), fill=c, width=2)
    d.arc((2,6,14,15), 20, 160, fill=c, width=2)
    return im
def feather():
    im, d = new()
    d.polygon([(14,1),(13,6),(8,11),(4,12),(5,8),(10,3)], fill=(240,245,255,255))
    d.line((2,14,13,3), fill=(160,170,200,255))
    return im
def droplet():
    im, d = new()
    d.ellipse((3,6,13,15), fill=(70,150,255,255)); d.polygon([(8,1),(13,10),(3,10)], fill=(70,150,255,255))
    d.point((6,10), fill=(200,230,255,255)); d.point((6,11), fill=(200,230,255,255))
    return im
def tree():
    im, d = new()
    d.rectangle((7,10,9,15), fill=(140,90,50,255))
    d.ellipse((2,1,14,12), fill=(60,170,70,255)); d.ellipse((5,0,11,6), fill=(80,195,85,255))
    return im
def cactus():
    im, d = new(); g = (70,170,80,255)
    d.rectangle((6,2,10,15), fill=g); d.rectangle((2,6,4,10), fill=g); d.rectangle((4,9,6,10), fill=g)
    d.rectangle((12,4,14,8), fill=g); d.rectangle((10,7,12,8), fill=g)
    for x, y in ((8,4),(7,8),(9,11)): d.point((x,y), fill=(200,240,180,255))
    return im
def cloud():
    im, d = new(); w = (240,245,255,255)
    d.ellipse((1,6,8,13), fill=w); d.ellipse((5,3,12,11), fill=w); d.ellipse((9,6,15,13), fill=w); d.rectangle((4,9,12,13), fill=w)
    return im
def rainbow():
    im, d = new()
    for i, c in enumerate([(230,50,60,255),(255,150,40,255),(255,220,60,255),(80,200,90,255),(70,140,255,255)]):
        d.arc((i, i + 3, 15 - i, 18 - i), 180, 360, fill=c, width=1)
    return im
def cat():
    im, d = new(); c = (255,160,60,255)
    d.ellipse((2,4,14,15), fill=c); d.polygon([(2,7),(3,1),(7,4)], fill=c); d.polygon([(14,7),(13,1),(9,4)], fill=c)
    d.point((5,9), fill=(30,30,40,255)); d.point((11,9), fill=(30,30,40,255)); d.point((8,11), fill=(240,110,130,255))
    return im
def slime():
    im, d = new()
    d.rectangle((2,2,14,14), fill=(120,210,90,255)); d.rectangle((4,4,12,12), fill=(100,190,75,255))
    d.rectangle((4,6,5,7), fill=(30,60,30,255)); d.rectangle((10,6,11,7), fill=(30,60,30,255)); d.point((9,10), fill=(30,60,30,255))
    return im
def dice():
    im, d = new()
    d.rectangle((2,2,14,14), fill=(250,250,250,255))
    for x, y in ((4,4),(11,4),(7,7),(4,11),(11,11)): d.rectangle((x,y,x+1,y+1), fill=(220,40,60,255))
    return im
def gamepad():
    im, d = new()
    d.ellipse((1,4,8,13), fill=(110,110,140,255)); d.ellipse((8,4,15,13), fill=(110,110,140,255)); d.rectangle((4,4,12,11), fill=(110,110,140,255))
    d.ellipse((3,7,6,10), fill=(60,60,80,255))
    d.point((11,7), fill=(80,200,90,255)); d.point((13,9), fill=(230,60,70,255))
    return im

ICONS = [("crown", crown), ("star", star), ("shield", shield), ("sword", sword), ("gem", gem), ("heart", heart),
         ("hammer", hammer), ("flame", flame), ("bolt", bolt), ("rocket", rocket), ("planet", planet), ("leaf", leaf),
         ("pickaxe", pickaxe), ("axe", axe), ("bow", bow), ("potion", potion), ("book", book), ("key", key),
         ("trophy", trophy), ("medal", medal), ("code", code), ("music", music), ("paw", paw), ("fish", fish),
         ("mushroom", mushroom), ("flower", flower), ("moon", moon), ("sun", sun), ("snowflake", snowflake),
         ("skull", skull), ("ghost", ghost), ("eye", eye),
         ("coin", coin), ("moneybag", moneybag), ("gift", gift), ("cake", cake), ("cookie", cookie), ("apple", apple),
         ("bell", bell), ("lightbulb", lightbulb), ("magnet", magnet), ("compass", compass), ("clock", clock),
         ("hourglass", hourglass), ("flag", flag), ("anchor", anchor), ("feather", feather), ("droplet", droplet),
         ("tree", tree), ("cactus", cactus), ("cloud", cloud), ("rainbow", rainbow), ("cat", cat), ("slime", slime),
         ("dice", dice), ("gamepad", gamepad)]
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    prev = Image.new("RGBA", (len(ICONS) * 72, 72), (60, 60, 60, 255))
    for i, (name, fn) in enumerate(ICONS):
        im = outline(fn()); im.save(os.path.join(OUT, f"rank_{name}.png"))
        big = im.resize((64, 64), Image.NEAREST); prev.paste(big, (i * 72 + 4, 4), big)
    prev.save(os.path.join(OUT, "_rank_preview.png"))
    print("drew", [n for n, _ in ICONS])


def add_to_sheet(sheet_path):
    """Rank icons start at row 1 of glyph_E2.png: U+E210 (crown), U+E211 (star) ... U+E247 and so on (up to 240 icons fit)."""
    sheet = Image.open(sheet_path).convert("RGBA")
    for i, (name, fn) in enumerate(ICONS):
        im = outline(fn())
        x, y = (i % 16) * 16, (1 + i // 16) * 16
        sheet.paste(Image.new("RGBA", (16, 16)), (x, y))
        sheet.paste(im, (x, y), im)
    sheet.save(sheet_path)
    print("added rank icons to", sheet_path)


if __name__ == "__main__" and len(sys.argv) > 2:
    add_to_sheet(sys.argv[2])
