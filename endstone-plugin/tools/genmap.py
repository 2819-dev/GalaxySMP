"""Builds mapcolors.json: a Minecraft map colour for EVERY Bedrock block.
1) the hand-made rules in livemap.py (they follow Minecraft's own map colours: wool, concrete, woods, terracotta, plants...)
2) otherwise the block's top texture from Mojang's sample resource pack, averaged and snapped to the nearest map colour
3) otherwise keywords; anything left is reported."""
import json, re, sys, os
from PIL import Image
sys.path.insert(0, "/home/user/GalaxySMP/endstone-plugin/src")
from endstone_galaxylink import livemap as lm

RP = "bsamples/resource_pack"
strip = lambda t: re.sub(r"^\s*//.*$", "", t, flags=re.M)
blocks_json = json.loads(strip(open(f"{RP}/blocks.json").read()))
terrain = json.loads(strip(open(f"{RP}/textures/terrain_texture.json").read()))["texture_data"]
names = json.load(open("allblocks.json"))
for n in blocks_json:
    if n != "format_version" and n not in names: names.append(n)

PALETTE = dict(lm.MC)
PALETTE["white"] = lm.MC["snow"]   # white concrete, carpet, glass... (Minecraft uses snow white)
PALETTE.update({"crimson_stem": (148, 63, 97), "crimson_hyphae": (92, 25, 29), "warped_stem": (58, 142, 140),
                "warped_hyphae": (86, 44, 62), "glow_lichen": (127, 167, 150)})
PAL = [(k, v) for k, v in PALETTE.items() if k not in ("fire",)]   # bright red is only for lava/fire/tnt (rules)

# Families whose real Minecraft map colour isn't what their texture averages to (checked before textures)
FAMILY = [("oxidized_", "warped"), ("weathered_", "warped_stem"), ("exposed_", "t_light_gray"), ("copper", "orange"),
          ("purpur", "magenta"), ("redstone_block", "fire"), ("amethyst", "purple"), ("pale_moss", "light_gray"), ("end_brick", "sand"),
          ("end_stone", "sand"), ("nether_brick", "nether"), ("red_nether", "nether"), ("prismarine_brick", "diamond"), ("dark_prismarine", "diamond"),
          ("prismarine", "cyan"), ("tuff", "t_gray"), ("blackstone", "black"), ("basalt", "black"), ("sculk", "black"), ("mud_brick", "t_light_gray"),
          ("packed_mud", "dirt"), ("deepslate", "deepslate"), ("calcite", "t_white"), ("dripstone", "t_brown"), ("quartz", "quartz"),
          ("smooth_stone", "stone"), ("stone_brick", "stone"), ("cobbled", "deepslate"), ("andesite", "stone"), ("diorite", "quartz"),
          ("granite", "dirt"), ("sandstone", "sand"), ("glass", "wool"), ("ice", "ice"), ("snow", "snow"), ("coral", "pink"),
          ("crimson_nylium", "crimson"), ("warped_nylium", "warped"), ("warped_wart", "warped_wart"), ("glow_lichen", "glow_lichen"),
          ("leaf_litter", "plant"), ("wildflowers", "plant"), ("chorus", "purple"), ("sea_pickle", "green"), ("wet_sponge", "yellow"), ("sponge", "yellow"), ("composter", "wood"), ("crimson_", "crimson_stem"), ("warped_", "warped_stem"),
          ("bamboo", "yellow"), ("hay", "yellow"), ("honey", "orange"), ("bee_nest", "yellow"), ("beehive", "wood"), ("ore", "stone"),
          ("raw_iron", "raw_iron"), ("raw_copper", "orange"), ("raw_gold", "gold"), ("gold_block", "gold"), ("iron", "metal"),
          ("anvil", "metal"), ("lantern", "metal"), ("chain", "metal"), ("cauldron", "stone"), ("furnace", "stone"), ("smoker", "stone"),
          ("dispenser", "stone"), ("dropper", "stone"), ("observer", "stone"), ("piston", "stone"), ("crafter", "stone"), ("obsidian", "black"),
          ("netherite", "black"), ("ancient_debris", "black"), ("lodestone", "metal"), ("target", "quartz"), ("shroomlight", "red"),
          ("mushroom", "brown"), ("pumpkin", "orange"), ("melon", "lime"), ("moss", "green"), ("azalea", "plant"), ("dirt", "dirt"),
          ("mud", "t_cyan"), ("clay", "clay"), ("gravel", "stone"), ("sand", "sand"), ("terracotta", "orange"), ("bricks", "red")]

def rule(name):
    """The hand-made rules only (None if no rule matches)."""
    r = rule0(name)
    if r: return r
    return next((k for w, k in FAMILY if w in name), None)

def rule0(name):
    key = lm.BLOCKS.get(name)
    if key is None and any(w in name for w in ("_log", "_wood", "_planks", "_slab", "_stairs", "_fence", "_stem", "_hyphae", "_trapdoor", "_door", "_button", "_pressure_plate", "_sign")):
        for wood in sorted(lm.WOODS, key=len, reverse=True):
            if name.startswith(wood + "_") or name.startswith("stripped_" + wood + "_"):
                return lm.WOODS[wood]
    if key is None and any(name.endswith(s) for s in ("_wool", "_concrete", "_carpet", "_stained_glass", "_stained_glass_pane", "_concrete_powder", "_terracotta",
                                                      "_glazed_terracotta", "_shulker_box", "_candle", "_bed", "_banner", "_candle_cake")):
        for dye in lm.DYES:
            if name.startswith(dye + "_"):
                d = "light_gray" if dye == "silver" else dye
                return ("t_" + d) if name.endswith("_terracotta") and "glazed" not in name else ("snow" if d == "white" and name.endswith("_wool") else d)
    if key is None and "leaves" in name and name.startswith("cherry"):
        return "pink"
    if key is None and any(w in name for w in ("leaves", "grass", "fern", "vine", "lily_pad", "waterlily", "sapling", "bush", "kelp", "seagrass")):
        return next((k for w, k in lm.KEYWORDS if w in name), None)
    return key

INVISIBLE = {"air", "structure_void", "light_block", "barrier", "invisible_bedrock", "border_block", "deny", "allow", "camera",
             "unknown", "info_update", "info_update2", "moving_block", "reserved6", "client_request_placeholder_block", "chalkboard"}
INVISIBLE |= {f"light_block_{i}" for i in range(16)}
MANUAL = {"block_of_coal": "black", "block_of_diamond": "diamond", "block_of_emerald": "emerald", "block_of_gold": "gold", "lapis_lazuli_block": "lapis",
  "hay_bale": "yellow", "melon": "lime", "slime_block": "grass", "sugar_cane": "plant", "potato": "plant", "red_shrub": "plant", "cobweb": "wool",
  "note_block": "wood", "monster_spawner": "stone", "mob_head": "stone", "enchantment_table": "red", "daylight_sensor": "wood",
  "inverted_daylight_sensor": "wood", "item_frame": "wood", "jack_o'lantern": "orange", "glowing_obsidian": "black", "icicle": "ice",
  "frog_egg": "water", "concrete_powder": "light_gray", "stained_clay": "orange", "wood_planks": "wood", "wooden_double_slab": "wood",
  "straw_bed": "yellow", "chemical_heat": "metal", "chemistry_table": "metal", "compound_creator": "metal", "lab_table": "metal",
  "material_reducer": "metal", "disc_press": "metal", "weighted_pressure_plate": "metal", "piston_head": "wood",
  "mangrove_propagule_hanging": "plant", "mysterious_frame": "black", "mysterious_frame_slot": "black", "tinted_glass": "gray"}
INVISIBLE |= {"block_moved_by_piston", "piston_arm_collision", "sticky_piston_arm_collision", "trip_wire", "tripwire", "update_game_block", "info_reserved6"}
SPECIAL = {"water": "water", "flowing_water": "water", "bubble_column": "water", "lava": "fire", "flowing_lava": "fire", "fire": "fire",
           "soul_fire": "light_blue", "end_portal": "black", "end_gateway": "black", "portal": "purple", "end_portal_frame": "t_green"}

def texture_path(tex):
    ent = terrain.get(tex)
    if ent is None: return None
    t = ent.get("textures")
    if isinstance(t, list): t = t[0]
    if isinstance(t, dict): t = t.get("path")
    for ext in (".png", ".tga"):
        if t and os.path.exists(f"{RP}/{t}{ext}"): return f"{RP}/{t}{ext}"
    return None

def top_texture(name):
    b = blocks_json.get(name) or blocks_json.get(name.replace("minecraft:", ""))
    if not b: return None
    t = b.get("textures") or b.get("carried_textures")
    if isinstance(t, dict): t = t.get("up") or t.get("side") or next(iter(t.values()))
    return texture_path(t) if t else None

def avg(path):
    im = Image.open(path).convert("RGBA")
    im = im.crop((0, 0, im.width, min(im.height, im.width)))   # animated strips: first frame
    px = [p for p in im.getdata() if p[3] >= 128]
    if not px: return None
    return tuple(sum(p[i] for p in px) / len(px) for i in range(3))

SHADES = (1.0, 220 / 255, 180 / 255, 135 / 255)   # how Minecraft draws each map colour (light to dark)
def nearest(c):
    r, g, b = c
    def d(v):
        best = None
        for f in SHADES:
            x = (v[0] * f, v[1] * f, v[2] * f)
            rm = (r + x[0]) / 2
            e = (2 + rm / 256) * (r - x[0]) ** 2 + 4 * (g - x[1]) ** 2 + (2 + (255 - rm) / 256) * (b - x[2]) ** 2
            best = e if best is None else min(best, e)
        return best
    return min(PAL, key=lambda kv: d(kv[1]))[0]

# Minecraft maps don't draw these (no map colour): they show the block underneath
SEE_THROUGH_WORDS = ("redstone_wire", "rail", "torch", "lever", "tripwire_hook", "button", "flower_pot", "ladder", "string",
                     "redstone_repeater", "redstone_comparator", "powered_repeater", "unpowered_repeater", "powered_comparator", "unpowered_comparator")
def see_through(n):
    return n in ("glass", "glass_pane", "hard_glass", "hard_glass_pane") or (any(w in n for w in SEE_THROUGH_WORDS) and "block" not in n)

out, how, missing = {}, {"rule": 0, "texture": 0, "keyword": 0, "invisible": 0, "special": 0}, []
for n in sorted(set(names)):
    if n in INVISIBLE or n.startswith("element_") or n.endswith("_air"):
        out[n] = None; how["invisible"] += 1; continue
    if see_through(n):
        out[n] = "below"; how["invisible"] += 1; continue
    if n in MANUAL:
        out[n] = PALETTE[MANUAL[n]]; how["special"] += 1; continue
    if n in SPECIAL:
        out[n] = PALETTE[SPECIAL[n]]; how["special"] += 1; continue
    k = rule(n)
    if k:
        out[n] = PALETTE[k]; how["rule"] += 1; continue
    p = top_texture(n)
    c = avg(p) if p else None
    if c:
        out[n] = PALETTE[nearest(c)]; how["texture"] += 1; continue
    k = next((k for w, k in lm.KEYWORDS if w in n), None)
    if k:
        out[n] = PALETTE[k]; how["keyword"] += 1; continue
    missing.append(n)

print(len(out), "blocks", how)
print("MISSING", len(missing), missing)
json.dump({k: (v if isinstance(v, str) else list(v) if v else None) for k, v in sorted(out.items())}, open("mapcolors.json", "w"), separators=(",", ":"))
