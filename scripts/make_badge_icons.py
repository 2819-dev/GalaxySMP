# Packs the 16x16 rank icons (public/img/ranks/rank_*.png) into the plugin, so it can draw them inside
# the rank badges it builds. Run after changing the icons:  python3 scripts/make_badge_icons.py
import base64, glob, os, zlib
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, "endstone-plugin/src/endstone_galaxylink/badge_icons.py")
lines = ['"""16x16 rank icons (RGBA, zlib + base64). Made by scripts/make_badge_icons.py; do not edit."""', "", "ICONS = {"]
for f in sorted(glob.glob(os.path.join(root, "public/img/ranks/rank_*.png"))):
    name = os.path.basename(f)[5:-4]
    im = Image.open(f).convert("RGBA")
    assert im.size == (16, 16), f
    lines.append(f'    "{name}": "{base64.b64encode(zlib.compress(im.tobytes(), 9)).decode()}",')
lines.append("}")
open(out, "w").write("\n".join(lines) + "\n")
print(out, len(lines) - 4, "icons")
