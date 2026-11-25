# Every other menu (the plain pop-up forms: shops, moderation, naming a home, confirmations, Settings-style forms...)
# in the modern GalaxySMP style (2.88): a dark navy glass window with rounded corners, white title and text, glass
# buttons with the gradient edge on hover, a gradient Submit button, a soft dim behind the window and a quick rise-in.
# The forms keep Minecraft's own layout and controls (so every form still works exactly the same); only the look changes.
# Edits src/ui/server_form.json in place (safe to run again). Copies of Minecraft's own controls are from 1.21.
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "src", "ui", "server_form.json")
s = open(P).read()
head = "".join(l for l in s.splitlines(True) if l.lstrip().startswith("//"))
d = json.loads(re.sub(r"^\s*//.*$", "", s, flags=re.M))
MARK = "§g§s§m§p"
COLL = lambda name: {"binding_name": name, "binding_type": "collection", "binding_collection_name": "form_buttons"}

d["gsmp_in_pop"] = {"anim_type": "offset", "easing": "out_cubic", "duration": 0.22, "from": [0, 10], "to": [0, 0]}

# the window: Minecraft's dialog background, with our textures
d["gsmp_dialog_bg@common_dialogs.dialog_background_hollow_common"] = {
    "size": ["100%", "100%c + 31px"], "texture": "textures/ui/gsmp_dialog",
    "$dialog_background_texture": "textures/ui/gsmp_dialog_fill", "$fill_alpha": 1.0}

LOOK = {"$custom_background": "server_form.gsmp_dialog_bg", "$title_text_color": [1, 1, 1], "$main_header_text_color": [0.9, 0.93, 1.0],
        "offset": "@server_form.gsmp_in_pop"}
FORM = {"$title_panel": "common_dialogs.standard_title_label", "$title_size": ["100% - 15px", 10], "$title_max_size": ["100% - 15px", 10],
        "size": [225, 200], "$text_name": "#title_text", "$title_text_binding_type": "none", "layer": 2}
d["gsmp_vanilla_long_form@common_dialogs.main_panel_no_buttons"] = dict(FORM, **LOOK, **{"$child_control": "server_form.long_form_panel"})
for k in [k for k in d if k.split("@")[0] == "custom_form"]:
    del d[k]
d["custom_form@common_dialogs.main_panel_no_buttons"] = dict(FORM, **LOOK, **{"$child_control": "server_form.custom_form_panel"})

# glass buttons with white text (Minecraft's light text button, our textures)
GLASS = {"$default_button_texture": "textures/ui/gsmp_button", "$hover_button_texture": "textures/ui/gsmp_button_hover",
         "$pressed_button_texture": "textures/ui/gsmp_button_pressed", "$locked_button_texture": "textures/ui/gsmp_button_pressed",
         "$default_text_color": [1, 1, 1], "$hover_text_color": [1, 1, 1], "$pressed_text_color": [0.85, 0.9, 1], "$locked_text_color": [0.55, 0.58, 0.68]}
PRIMARY = dict(GLASS, **{"$default_button_texture": "textures/ui/gsmp_button_primary", "$hover_button_texture": "textures/ui/gsmp_button_primary_hover",
                         "$pressed_button_texture": "textures/ui/gsmp_button_primary_pressed"})
d["dynamic_button"] = {"type": "stack_panel", "size": ["100%", 32], "orientation": "horizontal", "controls": [
    {"panel_name": {"type": "panel", "size": [34, "100%c"], "bindings": [
        {"binding_type": "view", "source_control_name": "image", "resolve_sibling_scope": True, "source_property_name": "(not (#texture = ''))",
         "target_property_name": "#visible"}], "controls": [
        {"image": {"type": "image", "layer": 2, "size": [32, 32], "offset": [0, 0], "bindings": [
            dict(COLL("#form_button_texture"), binding_name_override="#texture"),
            dict(COLL("#form_button_texture_file_system"), binding_name_override="#texture_file_system"),
            {"binding_type": "view", "source_property_name": "(not ((#texture = '') or (#texture = 'loading')))", "target_property_name": "#visible"}]}},
        {"progress@progress.progress_loading_bars": {"size": [30, 4], "offset": [-2, 16], "bindings": [
            {"binding_type": "view", "source_control_name": "image", "resolve_sibling_scope": True, "source_property_name": "(#texture = 'loading')",
             "target_property_name": "#visible"}]}}]}},
    {"form_button@common_buttons.light_text_button": dict(GLASS, **{
        "$pressed_button_name": "button.form_button_click", "anchor_from": "top_left", "anchor_to": "top_left", "size": ["fill", 30],
        "$button_text": "#form_button_text", "$button_text_binding_type": "collection", "$button_text_grid_collection_name": "form_buttons",
        "$button_text_max_size": ["100%", 20], "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}]})}]}

d["custom_form_scrolling_content"] = {"type": "stack_panel", "size": ["100% - 4px", "100%c"], "offset": [2, 0], "orientation": "vertical",
                                      "anchor_from": "top_left", "anchor_to": "top_left", "controls": [
    {"generated_form@server_form.generated_contents": {}},
    {"submit_gap": {"type": "panel", "size": ["100%", 4]}},
    {"submit_button@common_buttons.light_text_button": dict(PRIMARY, **{
        "$pressed_button_name": "button.submit_custom_form", "anchor_from": "top_left", "anchor_to": "top_left", "size": ["100%", 28],
        "$button_text": "#submit_text", "$button_text_binding_type": "global", "$button_binding_condition": "once",
        "bindings": [{"binding_name": "#submit_button_visible", "binding_name_override": "#visible"}]})}]}

# a soft dim behind plain forms (the Main Menu screens have their own backgrounds)
bg = d["gsmp_screen_bg"]["controls"]
bg[:] = [c for c in bg if "form_dim" not in c]
bg.append({"form_dim": {"type": "image", "texture": "textures/ui/Black", "alpha": 0.35, "size": ["100%", "100%"], "layer": 3, "bindings": [
    {"binding_name": "#title_text"},
    {"binding_type": "view", "source_property_name": f"((#title_text - '{MARK}') = #title_text)", "target_property_name": "#visible"}]}})

open(P, "w").write(head + json.dumps(d, indent=1, ensure_ascii=False) + "\n")
print("modern forms written")
