# Makes public/js/badge-pixels-data.js: the in-game badge font (letters) and the 8x8 colored rank icons, so the
# website can draw a rank badge exactly like the game does (public/js/badge-pixels.js).
# Run after changing the icons or the badge font:  python3 scripts/make_badge_pixel_js.py
import base64, json, os, sys, zlib
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(root, "endstone-plugin/src"))
from endstone_galaxylink import ranktags, badges
from endstone_galaxylink.badge_icons import ICONS8

chars = set(ranktags.FONT_ROWS) | set(ranktags.FONT_LOWER)
font = {}
for ch in sorted(chars):
    g = ranktags.font_char(ch)
    if g:
        font[ch] = g
icons = {}
for name, data in ICONS8.items():
    raw = zlib.decompress(base64.b64decode(data))
    px = []
    for i in range(64):
        r, g, b, a = raw[i * 4:i * 4 + 4]
        px.append("" if a < 128 else "%02x%02x%02x" % (r, g, b))
    icons[name] = px
out = os.path.join(root, "public/js/badge-pixels-data.js")
consts = {k: getattr(badges, k) for k in ("HEIGHT", "RADIUS", "TEXT_TOP", "ICON", "ICON_TOP", "PAD", "GAP", "MAX_LUMA", "SCALE")}
with open(out, "w") as f:
    f.write("// Made by scripts/make_badge_pixel_js.py from the plugin's badge font and icons. Do not edit.\n")
    f.write("export const C = " + json.dumps(consts) + ";\n")
    f.write("export const FONT = " + json.dumps(font, separators=(",", ":")) + ";\n")
    f.write("export const ICONS8 = " + json.dumps(icons, separators=(",", ":")) + ";\n")
print(out, len(font), "letters,", len(icons), "icons")
