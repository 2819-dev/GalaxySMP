# Draws the Minigame Computer texture (an all-in-one desktop computer, iMac style).
# 32x32 texture:  (0,0)-(16,12) front: black bezel, galaxy wallpaper, silver chin
#                 (16,0)-(32,12) back: silver   (0,16)-(8,24) sides   (8,16)-(16,24) stand
# Usage: python3 draw_computer.py src/textures/blocks/galaxysmp_computer.png
import sys
from PIL import Image, ImageDraw

im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
SILVER, SILVER_D, SILVER_L = (201, 204, 210, 255), (170, 174, 181, 255), (226, 228, 232, 255)

# Front: bezel and screen
d.rectangle((0, 0, 15, 8), fill=(18, 18, 22, 255))
for y in range(1, 8):  # galaxy wallpaper: purple at the top to blue at the bottom
    t = (y - 1) / 6
    c = (int(90 - 60 * t), int(40 + 50 * t), int(170 + 60 * t), 255)
    d.line((1, y, 14, y), fill=c)
for x, y in ((3, 2), (10, 1), (12, 4), (6, 5), (2, 6), (13, 7), (8, 3)):
    d.point((x, y), fill=(240, 240, 255, 255))  # stars
d.point((7, 4), fill=(111, 211, 251, 255)); d.point((8, 4), fill=(111, 211, 251, 255))  # a little planet
d.rectangle((0, 9, 15, 11), fill=SILVER_L)  # chin
d.point((7, 10), fill=SILVER_D); d.point((8, 10), fill=SILVER_D)
# Back
d.rectangle((16, 0, 31, 11), fill=SILVER)
d.ellipse((21, 3, 26, 8), fill=SILVER_D)
d.rectangle((16, 11, 31, 11), fill=SILVER_D)
# Sides and stand
d.rectangle((0, 16, 7, 23), fill=SILVER)
d.rectangle((8, 16, 15, 23), fill=SILVER_D)
d.line((8, 16, 15, 16), fill=SILVER_L)

im.save(sys.argv[1])
im.resize((256, 256), Image.NEAREST).save(sys.argv[1].replace(".png", "_preview.png")) if len(sys.argv) > 2 else None
print("drew", sys.argv[1])
