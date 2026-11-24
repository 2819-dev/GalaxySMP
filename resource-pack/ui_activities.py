# Activity picture cards on the Play > Servers screen (like a big picture + title, subtitle and text).
# The plugin sends each activity of the chosen server as a button whose text has "§j§v"; these cards show only those.
# Also draws the preset activity pictures (textures/ui/gsmp_act_*.png, 64x64) and copies them to the website.
# Run once: python3 ui_activities.py
import json, os, re, shutil
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "src", "ui", "server_form.json")
UI = os.path.join(HERE, "src", "textures", "ui")
WEB = os.path.join(HERE, "..", "public", "img", "activities")
s = open(P).read()
head = "".join(l for l in s.splitlines(True) if l.lstrip().startswith("//"))
d = json.loads(re.sub(r"^\s*//.*$", "", s, flags=re.M))

COL = {"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}
TEX = [{"binding_name": "#form_button_texture", "binding_name_override": "#texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
       {"binding_name": "#form_button_texture_file_system", "binding_name_override": "#texture_file_system", "binding_type": "collection",
        "binding_collection_name": "form_buttons"}]
HAS_V = {"binding_type": "view", "source_property_name": "(not ((#form_button_text - '§j§v') = #form_button_text))", "target_property_name": "#visible"}

d["gsmp_activity_card"] = {"type": "panel", "size": ["100%", 74], "bindings": [COL, HAS_V], "controls": [
    {"row": {"type": "stack_panel", "orientation": "horizontal", "size": ["100% - 6px", 66], "anchor_from": "top_left", "anchor_to": "top_left",
             "offset": [3, 4], "controls": [
        {"frame": {"type": "image", "texture": "textures/ui/Black", "alpha": 0.55, "size": [66, 66], "controls": [
            {"picture": {"type": "image", "size": [64, 64], "bilinear": False, "layer": 1, "anchor_from": "center", "anchor_to": "center", "bindings": TEX}}]}},
        {"gap": {"type": "panel", "size": [8, "100%"]}},
        {"text": {"type": "panel", "size": ["fill", "100%"], "controls": [
            {"label": {"type": "label", "text": "#form_button_text", "shadow": True, "color": [1, 1, 1], "size": ["100%", "default"],
                       "anchor_from": "top_left", "anchor_to": "top_left", "bindings": [COL]}}]}}]}}]}
d["gsmp_activity_cards"] = {"type": "stack_panel", "orientation": "vertical", "size": ["100%", "100%c"],
                            "factory": {"name": "buttons", "control_ids": {"button": "@server_form.gsmp_activity_card"}},
                            "collection_name": "form_buttons",
                            "bindings": [{"binding_name": "#form_button_contents", "binding_name_override": "#collection_length"}]}
d["gsmp_detail_content"] = {"type": "stack_panel", "orientation": "vertical", "size": ["100%", "100%c"], "controls": [
    {"text@server_form.gsmp_text": {}}, {"cards@server_form.gsmp_activity_cards": {}}]}


def swap(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k.startswith("scroll@common.scrolling_panel") and isinstance(v, dict) and v.get("$scrolling_content") == "server_form.gsmp_text":
                v["$scrolling_content"] = "server_form.gsmp_detail_content"
                return True
            if swap(v):
                return True
    elif isinstance(node, list):
        return any(swap(x) for x in node)
    return False


assert swap(d["gsmp_servers_screen"]), "description scroll not found"
open(P, "w").write(head + json.dumps(d, indent=1, ensure_ascii=False) + "\n")

# ---------- preset pictures: a colored tile with a big pixel icon (icons from glyph_F7) ----------
glyphs = Image.open(os.path.join(HERE, "src", "font", "glyph_F7.png")).convert("RGBA")


def glyph(code):
    r, c = code >> 4, code & 15
    return glyphs.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16))


def drawn(rows, pal):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in pal:
                im.putpixel((x, y), pal[ch])
    return im


PAW = drawn(["................", "....kk....kk....", "...kppk..kppk...", "...kppk..kppk...", "....kk....kk....", ".kk..........kk.",
             "kppk...kk...kppk", "kppk..kppk..kppk", ".kk..kppppk..kk.", "....kppppppk....", "...kppppppppk...", "...kppppppppk...",
             "...kpppkkpppk...", "....kkk..kkk....", "................", "................"], {"k": (40, 20, 30, 255), "p": (250, 210, 225, 255)})
MAP = drawn(["................", ".kkkkkkkkkkkkkk.", ".kyyyyyyyyyyyyk.", ".kyggyyyybbyyyk.", ".kygggyybbbbyyk.", ".kyyggyyybbyyyk.", ".kyyyyyrryyyyyk.",
             ".kyyyyrrrryyyyk.", ".kyybbyrryyggyk.", ".kybbbbyyygggyk.", ".kyybbyyyyyggyk.", ".kyyyyyyyyyyyyk.", ".kkkkkkkkkkkkkk.", "................",
             "................", "................"], {"k": (60, 40, 20, 255), "y": (235, 215, 160, 255), "g": (90, 170, 80, 255), "b": (80, 140, 220, 255), "r": (210, 60, 60, 255)})
PRESETS = {   # key: (icon, background top, background bottom)
    "survival": (glyph(0x57), (70, 170, 90), (30, 110, 60)),
    "pvp": (glyph(0x58), (220, 70, 70), (140, 30, 40)),
    "bedwars": (glyph(0x59), (240, 140, 50), (180, 80, 30)),
    "build": (glyph(0x5A), (60, 150, 230), (30, 90, 170)),
    "event": (glyph(0x5B), (170, 80, 220), (100, 40, 160)),
    "parkour": (glyph(0x5C), (60, 200, 210), (20, 130, 150)),
    "plots": (glyph(0x5D), (120, 190, 70), (70, 130, 40)),
    "shop": (glyph(0x5E), (240, 200, 60), (190, 140, 30)),
    "pets": (PAW, (240, 120, 170), (180, 60, 120)),
    "adventure": (MAP, (60, 180, 160), (25, 115, 110)),
}
os.makedirs(WEB, exist_ok=True)
for key, (icon, top, bot) in PRESETS.items():
    im = Image.new("RGBA", (64, 64))
    dr = ImageDraw.Draw(im)
    for y in range(64):
        t = y / 63
        dr.line([(0, y), (63, y)], fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)) + (255,))
    for (x, y) in [(6, 8), (50, 12), (12, 50), (46, 46), (30, 6), (56, 34), (4, 30)]:   # small squares, like a pattern
        dr.rectangle([x, y, x + 3, y + 3], fill=tuple(min(255, c + 25) for c in bot) + (255,))
    dr.rectangle([0, 0, 63, 63], outline=(255, 255, 255, 200))
    dr.rectangle([2, 2, 61, 61], outline=tuple(max(0, c - 40) for c in bot) + (255,))
    big = icon.resize((48, 48), Image.NEAREST)
    shadow = Image.new("RGBA", big.size, (0, 0, 0, 90)); shadow.putalpha(big.split()[3].point(lambda a: 90 if a else 0))
    im.alpha_composite(shadow, (10, 10)); im.alpha_composite(big, (8, 8))
    im.save(os.path.join(UI, f"gsmp_act_{key}.png"))
    shutil.copy(os.path.join(UI, f"gsmp_act_{key}.png"), os.path.join(WEB, f"{key}.png"))
print("activity cards added;", len(PRESETS), "pictures")
