# Main Menu v5 (2.88): the modern look, entrance animations and live info tiles. Edits src/ui/server_form.json in
# place (run after ui_menu_v4.py; safe to run again).
#   Main buttons: rounded glass buttons that slide right a little on hover; the button whose text has "§p§f" (Play) is
#                 the big GalaxySMP-gradient button.
#   Live tiles:   buttons whose text has "§j§i" show as a row of small tiles under the main buttons (any position in the
#                 form; the plugin adds them after the main buttons). "§j§i§1".."§j§i§4" picks the caption:
#                 1 Friends, 2 Daily, 3 Event, 4 Playing. The button's icon is the tile's little picture.
#   Animation:    the logo drops in and fades in, the buttons slide in from the left, the tiles rise, the corner buttons
#                 slide in from the edges and your character slides in from the right.
import json, os, re
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "src", "ui", "server_form.json")
UI = os.path.join(HERE, "src", "textures", "ui")
s = open(P).read()
head = "".join(l for l in s.splitlines(True) if l.lstrip().startswith("//"))
d = json.loads(re.sub(r"^\s*//.*$", "", s, flags=re.M))

COL = {"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}
DETAILS = {"binding_type": "collection_details", "binding_collection_name": "form_buttons"}
TEX = [{"binding_name": "#form_button_texture", "binding_name_override": "#texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
       {"binding_name": "#form_button_texture_file_system", "binding_name_override": "#texture_file_system", "binding_type": "collection",
        "binding_collection_name": "form_buttons"}]


def has(code):
    return f"(not ((#form_button_text - '{code}') = #form_button_text))"


def lacks(code):
    return f"((#form_button_text - '{code}') = #form_button_text)"


def view(expr):
    return {"binding_type": "view", "source_property_name": expr, "target_property_name": "#visible"}


def anim(name, kind, frm, to, duration, easing="out_cubic"):
    d[name] = {"anim_type": kind, "easing": easing, "duration": duration, "from": frm, "to": to}
    return f"@server_form.{name}"


# ---------- entrance animations (each plays once when the screen opens) ----------
FADE = anim("gsmp_in_fade", "alpha", 0, 1, 0.45)
LOGO = anim("gsmp_in_logo", "offset", [0, -14], [0, 0], 0.55, "out_back")
BUTTONS = anim("gsmp_in_buttons", "offset", [-26, 0], [0, 0], 0.4)
TILES = anim("gsmp_in_tiles", "offset", [0, 14], [0, 0], 0.6)
PLAYER = anim("gsmp_in_player", "offset", ["4%", "4%"], ["-3%", "4%"], 0.6)
SOCIAL = anim("gsmp_in_social", "offset", [-6, -32], [-6, 6], 0.5)
MAIL = anim("gsmp_in_mail", "offset", [6, 32], [6, -6], 0.5)
PROFILE = anim("gsmp_in_profile", "offset", [80, 32], [80, -6], 0.55)

# ---------- main buttons ----------
d["gsmp_main_face"] = {"type": "image", "texture": "$face_texture", "size": ["100%", "100%"], "offset": "$face_offset", "controls": [
    {"label": {"type": "label", "text": "#form_button_text", "shadow": True, "color": [1, 1, 1], "text_alignment": "center",
               "size": ["100% - 8px", "default"], "anchor_from": "center", "anchor_to": "center", "layer": 2, "bindings": [COL]}}]}


def main_button(tex, show):
    return {"$pressed_button_name": "button.form_button_click", "size": ["100%", 20], "anchor_from": "top_middle", "anchor_to": "top_middle",
            "bindings": [DETAILS, COL, view(show)],
            "controls": [{"default@server_form.gsmp_main_face": {"$face_texture": tex[0], "$face_offset": [0, 0]}},
                         {"hover@server_form.gsmp_main_face": {"$face_texture": tex[1], "$face_offset": [3, 0]}},
                         {"pressed@server_form.gsmp_main_face": {"$face_texture": tex[2], "$face_offset": [3, 1]}}]}


PLAIN = ("textures/ui/gsmp_button", "textures/ui/gsmp_button_hover", "textures/ui/gsmp_button_pressed")
PRIMARY = ("textures/ui/gsmp_button_primary", "textures/ui/gsmp_button_primary_hover", "textures/ui/gsmp_button_primary_pressed")
d["gsmp_mc_button"] = {"type": "panel", "size": ["100%", 22], "bindings": [COL, view(lacks("§j§"))], "controls": [
    {"plain@common.button": main_button(PLAIN, lacks("§p§f"))},
    {"primary@common.button": main_button(PRIMARY, has("§p§f"))}]}

# ---------- live tiles ----------
CAPTIONS = ["Friends", "Daily", "Event", "Playing"]
d["gsmp_tile_face"] = {"type": "image", "texture": "$face_texture", "size": ["100%", "100%"], "offset": "$face_offset", "controls": [
    {"value": {"type": "label", "text": "#form_button_text", "shadow": True, "color": [1, 1, 1], "size": ["100% - 8px", "default"],
               "anchor_from": "top_left", "anchor_to": "top_left", "offset": [5, 4], "layer": 2, "bindings": [COL]}},
    {"icon": {"type": "image", "size": [8, 8], "bilinear": False, "anchor_from": "bottom_left", "anchor_to": "bottom_left", "offset": [5, -5],
              "layer": 2, "bindings": TEX}}]
    + [{f"cap{i}": {"type": "label", "text": c, "shadow": True, "color": [0.75, 0.8, 0.9], "font_scale_factor": 0.8, "anchor_from": "bottom_left",
                    "anchor_to": "bottom_left", "offset": [15, -5], "layer": 2, "bindings": [COL, view(has(f"§j§i§{i}"))]}}
       for i, c in enumerate(CAPTIONS, 1)]}
TILE = ("textures/ui/gsmp_tile", "textures/ui/gsmp_tile_hover", "textures/ui/gsmp_tile_pressed")
d["gsmp_tile_button@common.button"] = {"$pressed_button_name": "button.form_button_click", "size": [50, 28], "anchor_from": "left_middle",
                                       "anchor_to": "left_middle", "bindings": [DETAILS, COL],
                                       "controls": [{"default@server_form.gsmp_tile_face": {"$face_texture": TILE[0], "$face_offset": [0, 0]}},
                                                    {"hover@server_form.gsmp_tile_face": {"$face_texture": TILE[1], "$face_offset": [0, -1]}},
                                                    {"pressed@server_form.gsmp_tile_face": {"$face_texture": TILE[2], "$face_offset": [0, 0]}}]}
d["gsmp_tile_item"] = {"type": "panel", "size": [52, 28], "bindings": [COL, view(has("§j§i"))],
                       "controls": [{"tile@server_form.gsmp_tile_button": {}}]}
d["gsmp_tiles"] = {"type": "stack_panel", "orientation": "horizontal", "size": ["100%c", 28], "anchor_from": "center", "anchor_to": "center",
                   "factory": {"name": "buttons", "control_ids": {"button": "@server_form.gsmp_tile_item"}}, "collection_name": "form_buttons",
                   "bindings": [{"binding_name": "#form_button_contents", "binding_name_override": "#collection_length"}]}

# ---------- the title screen: shades, animations, tiles ----------
t = d["gsmp_title_screen"]
t["controls"] = [c for c in t["controls"] if not ({"shade_left", "shade_bottom"} & set(c))]
t["controls"][:0] = [
    {"shade_left": {"type": "image", "texture": "textures/ui/gsmp_shade_left", "size": ["75%", "100%"], "anchor_from": "left_middle",
                    "anchor_to": "left_middle", "layer": 3}},
    {"shade_bottom": {"type": "image", "texture": "textures/ui/gsmp_shade_bottom", "size": ["100%", 70], "anchor_from": "bottom_middle",
                      "anchor_to": "bottom_middle", "layer": 3}}]
for c in t["controls"]:
    if "middle" in c:
        mid = c["middle"]["controls"]
        mid[:] = [x for x in mid if not ({"tiles_gap", "tiles_box", "accent"} & set(x))]
        for x in mid:
            if "logo_row" in x:
                x["logo_row"]["offset"] = LOGO
                for y in x["logo_row"]["controls"]:
                    if "logo" in y:
                        y["logo"]["alpha"] = FADE
            if "buttons_box" in x:
                x["buttons_box"]["offset"] = BUTTONS
            if "splash_box" in x:
                sb = x["splash_box"]
                sb["controls"] = [y for y in sb["controls"] if "accent" not in y]
                sb["controls"].append({"accent": {"type": "image", "texture": "textures/ui/gsmp_accent_line", "size": [120, 1],
                                                  "anchor_from": "bottom_middle", "anchor_to": "bottom_middle", "offset": [0, 1], "alpha": FADE}})
        mid += [{"tiles_gap": {"type": "panel", "size": ["100%", 4]}},
                {"tiles_box": {"type": "panel", "size": [210, 28], "offset": TILES, "controls": [{"tiles@server_form.gsmp_tiles": {}}]}}]
    if "player" in c:
        c["player"]["offset"] = PLAYER
    if "corners" in c:
        for x in c["corners"]["controls"]:
            for k, v in x.items():
                if k.startswith("social@"):
                    v["offset"] = SOCIAL
                elif k.startswith("mail@"):
                    v["offset"] = MAIL
                elif k.startswith("profile@"):
                    v["offset"] = PROFILE

# ---------- the Play screen: the selected item's picture fades in ----------
QUICK = anim("gsmp_in_fade_quick", "alpha", 0, 1, 0.25)


def walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "banner" and isinstance(v, dict) and v.get("type") == "image":
                v["alpha"] = QUICK
            walk(v)
    elif isinstance(node, list):
        for x in node:
            walk(x)


walk(d["gsmp_servers_screen"])

open(P, "w").write(head + json.dumps(d, indent=1, ensure_ascii=False) + "\n")

# ---------- tile pictures (8 x 8) ----------
def icon(name, rows, colors):
    im = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                im.putpixel((x, y), colors[ch])
    im.save(os.path.join(UI, name + ".png"))


icon("gsmp_live_friends", ["..a.....", ".aaa..b.", ".aaa.bbb", "..a..bbb", ".aaa..b.", "aaaaabbb", "aaaaabbb", "........"],
     {"a": (120, 255, 160, 255), "b": (80, 200, 255, 255)})
icon("gsmp_live_daily", ["..y..y..", "...yy...", "rrrrrrrr", "rrrryrrr", ".rrryrr.", ".rrryrr.", ".rrryrr.", ".rrrrrr."],
     {"r": (235, 85, 110, 255), "y": (255, 215, 90, 255)})
icon("gsmp_live_event", [".w....w.", "bbbbbbbb", "bwwwwwwb", "bwwwwwwb", "bwwbbwwb", "bwwbbwwb", "bwwwwwwb", "bbbbbbbb"],
     {"b": (80, 170, 255, 255), "w": (235, 240, 255, 255)})
icon("gsmp_live_online", ["........", "..gggg..", ".gggggg.", ".gghhgg.", ".gghhgg.", ".gggggg.", "..gggg..", "........"],
     {"g": (70, 220, 120, 255), "h": (190, 255, 210, 255)})
print("menu v5 written")
