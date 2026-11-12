# White rank icons for the website's rank badges (public/img/badge/rank_*.png), drawn exactly like the
# icons inside the in-game badges. Run after make_badge_icons.py:  python3 scripts/make_badge_web_icons.py
import os, sys
from PIL import Image
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, "endstone-plugin/src"))
import importlib.util
spec = importlib.util.spec_from_file_location("badges", os.path.join(root, "endstone-plugin/src/endstone_galaxylink/badges.py"))
badges = importlib.util.module_from_spec(spec); spec.loader.exec_module(badges)
from endstone_galaxylink.badge_icons import ICONS
out = os.path.join(root, "public/img/badge"); os.makedirs(out, exist_ok=True)
for name in ICONS:
    im = Image.new("RGBA", (16, 16))
    for xy, c in badges.icon_pixels(name).items():
        im.putpixel(xy, c)
    im.save(os.path.join(out, f"rank_{name}.png"), optimize=True)
print(len(ICONS), "icons ->", out)
