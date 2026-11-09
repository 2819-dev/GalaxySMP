# Draws the Minigame Computer texture: one block shaped like a shop till. The big staff screen
# faces the staff; a small customer screen sticks out of its back, facing the players.
# 32x32 texture:  (0,0)-(16,12)  staff screen: black bezel, galaxy wallpaper, silver chin
#                 (16,0)-(26,7)  customer screen (small)
#                 (0,16)-(8,24)  silver (backs, sides)   (8,16)-(16,24) darker silver (stand, arm)
# Usage: python3 draw_computer.py src/textures/blocks/galaxysmp_computer.png
import sys
from PIL import Image, ImageDraw

im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
SILVER, SILVER_D, SILVER_L = (201, 204, 210, 255), (170, 174, 181, 255), (226, 228, 232, 255)

# Staff screen
d.rectangle((0, 0, 15, 8), fill=(18, 18, 22, 255))
for y in range(1, 8):  # galaxy wallpaper: purple at the top to blue at the bottom
    t = (y - 1) / 6
    d.line((1, y, 14, y), fill=(int(90 - 60 * t), int(40 + 50 * t), int(170 + 60 * t), 255))
for x, y in ((3, 2), (10, 1), (12, 4), (6, 5), (2, 6), (13, 7), (8, 3)):
    d.point((x, y), fill=(240, 240, 255, 255))  # stars
d.point((7, 4), fill=(111, 211, 251, 255)); d.point((8, 4), fill=(111, 211, 251, 255))  # a little planet
d.rectangle((0, 9, 15, 11), fill=SILVER_L)  # chin
d.point((7, 10), fill=SILVER_D); d.point((8, 10), fill=SILVER_D)

# Customer screen (10 x 7): bezel, teal-to-blue screen with a title bar and two buttons
d.rectangle((16, 0, 25, 6), fill=(18, 18, 22, 255))
for y in range(1, 6):
    t = (y - 1) / 4
    d.line((17, y, 24, y), fill=(int(20 + 20 * t), int(170 - 60 * t), int(200 + 30 * t), 255))
d.line((18, 1, 23, 1), fill=(240, 244, 255, 255))      # title bar
d.rectangle((18, 3, 19, 4), fill=(255, 210, 70, 255))  # "Join"
d.rectangle((22, 3, 23, 4), fill=(120, 230, 160, 255)) # "Watch"

# Silver parts
d.rectangle((0, 16, 7, 23), fill=SILVER)
d.ellipse((2, 18, 5, 21), fill=SILVER_D)  # a little detail on the big screen's back
d.rectangle((8, 16, 15, 23), fill=SILVER_D)
d.line((8, 16, 15, 16), fill=SILVER_L)

im.save(sys.argv[1])
print("drew", sys.argv[1])
