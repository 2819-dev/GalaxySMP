# Main Menu v4 (layout for ui/server_form.json):
#   Title (§1): GalaxySMP logo + splash, buttons Play / Settings / Tutorial & Commands / Help, your character on the right,
#               Social (top-right corner), Mail and Profile (bottom-left corner).
#               Buttons: 0 Social, 1 Mail, 2 Profile, 3 restart notice (text only), 4+ the main buttons.
#   Play (§2):  tabs Homes / Warps / Servers; a list on the left; on the right the selected item: a big picture with a
#               dark strip (ping/players or coordinates), its name, small icon buttons and a big green button.
#               Buttons: 0-2 tabs, 3 the green button (its icon is the big picture), 4 the strip text, 5 the name,
#               6-8 small icon buttons, 9+ the list. "§j§-" hides a slot; "§j§h" list items are section headers.
# Run once: python3 ui_menu_v4.py   (edits src/ui/server_form.json in place; keeps its header comment)
import json, os, re
from PIL import Image, ImageDraw

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


# ---------- small slot buttons (a fixed button of the menu, placed anywhere) ----------
d["gsmp_slot_text_face"] = {"type": "image", "texture": "$face_texture", "size": ["100%", "100%"], "controls": [
    {"sel": {"type": "image", "texture": "textures/ui/gsmp_button_on", "size": ["100%", "100%"], "layer": 1, "bindings": [COL, view(has("§q§s"))]}},
    {"label": {"type": "label", "text": "#form_button_text", "shadow": True, "color": [1, 1, 1], "text_alignment": "center", "layer": 2,
               "size": ["100% - 6px", "default"], "anchor_from": "center", "anchor_to": "center", "bindings": [COL]}}]}
d["gsmp_slot_icon_face"] = {"type": "image", "texture": "$face_texture", "size": ["100%", "100%"], "controls": [
    {"icon": {"type": "image", "size": [16, 16], "bilinear": False, "layer": 2, "anchor_from": "center", "anchor_to": "center", "bindings": TEX}}]}


def slot(face, tex):
    return {"$pressed_button_name": "button.form_button_click", "size": ["100%", "100%"],
            "bindings": [DETAILS, COL, view(lacks("§j§-"))],
            "controls": [{f"default@server_form.{face}": {"$face_texture": tex[0]}},
                         {f"hover@server_form.{face}": {"$face_texture": tex[1]}},
                         {f"pressed@server_form.{face}": {"$face_texture": tex[2]}}]}


BLUE = ("textures/ui/gsmp_button", "textures/ui/gsmp_button_hover", "textures/ui/gsmp_button_pressed")
GREEN = ("textures/ui/gsmp_button_green", "textures/ui/gsmp_button_green_hover", "textures/ui/gsmp_button_green_pressed")
d["gsmp_slot_text@common.button"] = slot("gsmp_slot_text_face", BLUE)
d["gsmp_slot_green@common.button"] = slot("gsmp_slot_text_face", GREEN)
d["gsmp_slot_icon@common.button"] = slot("gsmp_slot_icon_face", BLUE)


def put(name, template, index, size, **extra):
    return {f"{name}@server_form.{template}": dict({"collection_index": index, "size": size}, **extra)}


def label(index, color=(1, 1, 1), **extra):
    return dict({"type": "label", "text": "#form_button_text", "shadow": True, "color": list(color), "collection_index": index,
                 "bindings": [COL]}, **extra)


# ---------- the title screen ----------
t = d["gsmp_title_screen"]
for c in t["controls"]:
    if "middle" in c:
        c["middle"]["controls"] = [x for x in c["middle"]["controls"] if not ({"friends_gap", "friends_box"} & set(x))]
    if "site" in c:
        c["site"]["anchor_from"] = c["site"]["anchor_to"] = "bottom_middle"
        c["site"]["offset"] = [0, -3]
    if "restart_banner" in c:
        c["restart_banner"]["controls"][0]["label"]["collection_index"] = 3
t["controls"] = [c for c in t["controls"] if "corners" not in c]
t["controls"].append({"corners": {"type": "panel", "size": ["100%", "100%"], "layer": 14, "collection_name": "form_buttons", "controls": [
    put("social", "gsmp_slot_text", 0, [92, 22], anchor_from="top_right", anchor_to="top_right", offset=[-6, 6]),
    put("mail", "gsmp_slot_text", 1, [70, 22], anchor_from="bottom_left", anchor_to="bottom_left", offset=[6, -6]),
    put("profile", "gsmp_slot_text", 2, [70, 22], anchor_from="bottom_left", anchor_to="bottom_left", offset=[80, -6]),
]}})

# ---------- the list: cards, and section headers ----------
card = d["gsmp_server_card"]
card["bindings"] = [COL, view(f"({lacks('§j§')} or {has('§j§h')})")]
inner = card["controls"][0]["card@common.button"]
inner["bindings"] = [DETAILS, COL, view(lacks("§j§h"))]
card["controls"] = [{"card@common.button": inner},
                    {"header": dict(label(None, (1, 0.9, 0.45)), size=["100% - 4px", "default"], anchor_from="bottom_left", anchor_to="bottom_left",
                                    offset=[2, -6], font_scale_factor=1.1, bindings=[COL, view(has("§j§h"))])}]
del card["controls"][1]["header"]["collection_index"]

# ---------- the Play screen ----------
tabs = {"tabs": {"type": "stack_panel", "orientation": "horizontal", "size": ["100%", 24], "collection_name": "form_buttons", "controls": [
    put("tab0", "gsmp_slot_text", 0, ["33%", 22]), {"g0": {"type": "panel", "size": ["0.5%", 22]}},
    put("tab1", "gsmp_slot_text", 1, ["33%", 22]), {"g1": {"type": "panel", "size": ["0.5%", 22]}},
    put("tab2", "gsmp_slot_text", 2, ["33%", 22])]}}
banner = {"banner_box": {"type": "panel", "size": ["100%", "38%x"], "clips_children": True, "collection_name": "form_buttons", "controls": [
    {"banner": {"type": "image", "size": ["100%", "56.25%x"], "bilinear": True, "anchor_from": "center", "anchor_to": "center",
                "collection_index": 3, "bindings": TEX}},
    {"strip": {"type": "image", "texture": "textures/ui/Black", "alpha": 0.6, "size": ["100%", 15], "anchor_from": "bottom_middle",
               "anchor_to": "bottom_middle", "layer": 2}},
    {"stats": label(4, size=["100% - 8px", "default"], anchor_from="bottom_left", anchor_to="bottom_left", offset=[4, -3], layer=3)}]}}
row = {"row": {"type": "stack_panel", "orientation": "horizontal", "size": ["100%", 24], "collection_name": "form_buttons", "controls": [
    {"name_box": {"type": "panel", "size": ["fill", "100%"], "collection_name": "form_buttons", "controls": [
        {"name": label(5, size=["100%", "default"], anchor_from="left_middle", anchor_to="left_middle", font_scale_factor=1.1)}]}},
    put("act6", "gsmp_slot_icon", 6, [22, 22]), {"ga": {"type": "panel", "size": [2, 22]}},
    put("act7", "gsmp_slot_icon", 7, [22, 22]), {"gb": {"type": "panel", "size": [2, 22]}},
    put("act8", "gsmp_slot_icon", 8, [22, 22]), {"gc": {"type": "panel", "size": [3, 22]}},
    put("go", "gsmp_slot_green", 3, [84, 22])]}}
desc = {"desc": {"type": "panel", "size": ["100%", "fill"], "controls": [{"scroll@common.scrolling_panel": {
    "size": ["100%", "100%"], "$show_background": False, "$scrolling_content": "server_form.gsmp_text", "$scroll_size": [4, "100% - 4px"],
    "$scrolling_pane_size": ["100% - 6px", "100%"], "$scrolling_pane_offset": [2, 0], "$scroll_bar_right_padding_size": [0, 0]}}]}}
detail = {"detail": {"type": "image", "texture": "textures/ui/gsmp_card", "size": ["fill", "100%"], "controls": [
    {"stack": {"type": "stack_panel", "orientation": "vertical", "size": ["100% - 8px", "100% - 8px"], "anchor_from": "center", "anchor_to": "center",
               "collection_name": "form_buttons", "controls": [banner, {"g1": {"type": "panel", "size": ["100%", 3]}}, row,
                                                              {"g2": {"type": "panel", "size": ["100%", 3]}}, desc]}}]}}
lst = {"list": {"type": "panel", "size": ["40%", "100%"], "controls": [{"scroll@common.scrolling_panel": {
    "size": ["100%", "100%"], "$show_background": False, "$scrolling_content": "server_form.gsmp_server_cards", "$scroll_size": [4, "100% - 4px"],
    "$scrolling_pane_size": ["100% - 6px", "100%"], "$scrolling_pane_offset": [0, 0], "$scroll_bar_right_padding_size": [0, 0]}}]}}
d["gsmp_servers_screen"] = {"type": "panel", "size": ["100%", "100%"], "layer": 2, "controls": [
    {"page": {"type": "stack_panel", "orientation": "vertical", "size": ["100% - 20px", "100% - 8px"], "anchor_from": "center", "anchor_to": "center",
              "layer": 10, "controls": [
                  {"header@server_form.gsmp_header": {"$header_text": "Play"}}, tabs, {"gap": {"type": "panel", "size": ["100%", 4]}},
                  {"body": {"type": "stack_panel", "orientation": "horizontal", "size": ["100%", "fill"], "controls": [
                      lst, {"gap": {"type": "panel", "size": [6, "100%"]}}, detail]}}]}}]}

open(P, "w").write(head + json.dumps(d, indent=1, ensure_ascii=False) + "\n")

# ---------- pictures: the green button and small icons ----------
def nine(name, fill, edge, light):
    im = Image.new("RGBA", (32, 16), fill); dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 31, 15], outline=edge); dr.line([(1, 1), (30, 1)], fill=light)
    im.save(os.path.join(UI, name + ".png"))
    json.dump({"nineslice_size": 4, "base_size": [32, 16]}, open(os.path.join(UI, name + ".json"), "w"))


nine("gsmp_button_green", (46, 140, 52, 255), (22, 70, 26, 255), (110, 210, 110, 255))
nine("gsmp_button_green_hover", (62, 168, 68, 255), (22, 70, 26, 255), (150, 235, 150, 255))
nine("gsmp_button_green_pressed", (34, 110, 40, 255), (18, 55, 20, 255), (60, 150, 64, 255))


def icon(name, draw):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); draw(ImageDraw.Draw(im)); im.save(os.path.join(UI, name + ".png"))


W, R, G, Y, B = (240, 244, 255, 255), (235, 80, 80, 255), (90, 220, 110, 255), (250, 210, 80, 255), (110, 190, 255, 255)
icon("gsmp_icon_trash", lambda d: (d.rectangle([4, 5, 11, 14], fill=R), d.rectangle([3, 3, 12, 4], fill=R), d.rectangle([6, 1, 9, 2], fill=R),
                                   d.line([(6, 7), (6, 12)], fill=(150, 40, 40, 255)), d.line([(9, 7), (9, 12)], fill=(150, 40, 40, 255))))
icon("gsmp_icon_rename", lambda d: (d.line([(3, 12), (11, 4)], fill=Y, width=3), d.polygon([(2, 14), (2, 11), (5, 14)], fill=W),
                                    d.rectangle([11, 2, 13, 4], fill=R)))
icon("gsmp_icon_move", lambda d: (d.ellipse([4, 1, 11, 8], fill=B), d.polygon([(4, 6), (11, 6), (7, 14)], fill=B), d.ellipse([6, 3, 9, 6], fill=W)))
icon("gsmp_icon_star", lambda d: d.polygon([(8, 1), (10, 6), (15, 6), (11, 9), (13, 14), (8, 11), (3, 14), (5, 9), (1, 6), (6, 6)], fill=Y))
icon("gsmp_icon_home", lambda d: (d.polygon([(8, 1), (15, 8), (1, 8)], fill=R), d.rectangle([3, 8, 12, 14], fill=W), d.rectangle([7, 10, 9, 14], fill=(120, 80, 50, 255))))
icon("gsmp_icon_warp", lambda d: (d.ellipse([1, 1, 14, 14], fill=(150, 90, 230, 255)), d.ellipse([4, 4, 11, 11], fill=B), d.ellipse([6, 6, 9, 9], fill=W)))
icon("gsmp_icon_add", lambda d: (d.rectangle([7, 2, 8, 13], fill=G), d.rectangle([2, 7, 13, 8], fill=G)))
print("menu v4 layout written")
