# Writes the GalaxySMP animal drop: Dumplings (8 colors, babies), Blubs, Seedlings, Trills, Baby/Bearded Sifters,
# Nesters, the Sifter orb, and the picture portal screen. For each: the behavior pack entity, the resource pack
# client entity, model (geometry), animations and pixel-art texture. Penguins get babies and breeding too.
#   python3 make_mobs.py        (run from resource-pack/; writes into src/ and ../behavior-pack/src/)
import json, math, os, random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.join(HERE, "src")
BP = os.path.join(HERE, "..", "behavior-pack", "src")


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)


# ------------------------------------------------------------------ textures (box UV painting)
class Tex:
    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def box(self, u, v, w, h, dp, col, top=None, front=None, shade=True):
        """Paints a box-UV cube: sides `col`, top lighter, bottom darker, optional front colour."""
        d = self.d
        def sh(c, k): return tuple(max(0, min(255, int(x * k))) for x in c[:3]) + (255,)
        d.rectangle([u + dp, v, u + dp + w - 1, v + dp - 1], fill=sh(top or col, 1.12 if shade else 1))          # top
        d.rectangle([u + dp + w, v, u + dp + 2 * w - 1, v + dp - 1], fill=sh(col, 0.75 if shade else 1))       # bottom
        d.rectangle([u, v + dp, u + dp - 1, v + dp + h - 1], fill=sh(col, 0.9 if shade else 1))                # west
        d.rectangle([u + dp, v + dp, u + dp + w - 1, v + dp + h - 1], fill=sh(front or col, 1.0))             # north (front)
        d.rectangle([u + dp + w, v + dp, u + 2 * dp + w - 1, v + dp + h - 1], fill=sh(col, 0.9 if shade else 1))   # east
        d.rectangle([u + 2 * dp + w, v + dp, u + 2 * dp + 2 * w - 1, v + dp + h - 1], fill=sh(col, 0.85 if shade else 1))  # south

    @staticmethod
    def front(u, v, w, h, dp):
        return u + dp, v + dp

    def speckle(self, u, v, w, h, dp, col, n, seed):
        r = random.Random(seed)
        for _ in range(n):
            x = r.randrange(u, u + 2 * dp + 2 * w); y = r.randrange(v, v + dp + h)
            if self.im.getpixel((x, y))[3]:
                self.d.point((x, y), fill=col)

    def save(self, name):
        p = os.path.join(RP, "textures", "entity", name + ".png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        self.im.save(p)


def cube(origin, size, uv, inflate=0, pivot=None, rotation=None):
    c = {"origin": origin, "size": size, "uv": uv}
    if inflate:
        c["inflate"] = inflate
    if rotation:
        c["pivot"] = pivot; c["rotation"] = rotation
    return c


def geo(name, tw, th, bones, bounds=(2, 2)):
    write(os.path.join(RP, "models", "entity", f"{name}.geo.json"), {
        "format_version": "1.12.0",
        "minecraft:geometry": [{"description": {"identifier": f"geometry.galaxysmp_{name}", "texture_width": tw, "texture_height": th,
                                                "visible_bounds_width": bounds[0], "visible_bounds_height": bounds[1], "visible_bounds_offset": [0, bounds[1] / 2, 0]},
                                "bones": bones}]})


def bone(name, parent=None, pivot=(0, 0, 0), cubes=None, rotation=None):
    b = {"name": name, "pivot": list(pivot)}
    if parent:
        b["parent"] = parent
    if cubes:
        b["cubes"] = cubes
    if rotation:
        b["rotation"] = rotation
    return b


def anims(name, a):
    write(os.path.join(RP, "animations", f"{name}.animation.json"), {"format_version": "1.8.0", "animations": a})


def client(ident, textures, geometry, animations, scripts, controllers=("controller.render.default",), material="entity_alphatest",
           egg=None, sounds=None, extra=None):
    desc = {"identifier": f"galaxysmp:{ident}", "materials": {"default": material}, "textures": textures,
            "geometry": {"default": f"geometry.galaxysmp_{geometry}"}, "animations": animations,
            "scripts": {"animate": scripts}, "render_controllers": list(controllers)}
    if egg:
        desc["spawn_egg"] = {"base_color": egg[0], "overlay_color": egg[1]}
    if sounds:
        desc["sound_effects"] = sounds
    if extra:
        desc.update(extra)
    write(os.path.join(RP, "entity", f"{ident}.entity.json"), {"format_version": "1.10.0", "minecraft:client_entity": {"description": desc}})


def entity(ident, components, groups=None, events=None, spawnable=True, properties=None):
    desc = {"identifier": f"galaxysmp:{ident}", "is_spawnable": spawnable, "is_summonable": True, "is_experimental": False}
    if properties:
        desc["properties"] = properties
    write(os.path.join(BP, "entities", f"{ident}.json"), {"format_version": "1.21.40", "minecraft:entity": {
        "description": desc, "component_groups": groups or {}, "components": components, "events": events or {}}})


COMMON = {
    "minecraft:physics": {}, "minecraft:jump.static": {}, "minecraft:nameable": {}, "minecraft:persistent": {},
    "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
    "minecraft:behavior.float": {"priority": 0},
    "minecraft:behavior.look_at_player": {"priority": 9, "look_distance": 6, "probability": 0.02},
    "minecraft:behavior.random_look_around": {"priority": 10},
}


def pet_groups(tame_items, family, heal, follow_speed=1.2, attack=None, extra_tame=None):
    """Wild + tame + baby/adult groups for a tameable, breedable pet (owner set by Minecraft's tameable)."""
    tame = {
        "minecraft:is_tamed": {}, "minecraft:sittable": {},
        "minecraft:type_family": {"family": [family, "galaxysmp_pet", "galaxysmp_tamed", "mob"] + (extra_tame or [])},
        "minecraft:behavior.stay_while_sitting": {"priority": 3},
        "minecraft:behavior.follow_owner": {"priority": 5, "speed_multiplier": follow_speed, "start_distance": 8, "stop_distance": 2},
        "minecraft:healable": {"items": [{"item": i, "heal_amount": heal} for i in tame_items]},
        "minecraft:breedable": {"require_tame": True, "inherit_tamed": True, "breed_items": tame_items, "love_filters": {"test": "is_sitting", "value": False},
                                "breeds_with": {"mate_type": f"galaxysmp:{family}", "baby_type": f"galaxysmp:{family}", "breed_event": {"event": "minecraft:entity_born", "target": "baby"}},
                                "mutation_factor": {"variant": 0.15}},
    }
    if attack:
        tame.update(attack)
    return {
        "galaxysmp:wild": {
            "minecraft:tameable": {"probability": 1.0, "tame_items": tame_items, "tame_event": {"event": "galaxysmp:on_tame", "target": "self"}},
            "minecraft:behavior.tempt": {"priority": 4, "speed_multiplier": 1.1, "items": tame_items},
            "minecraft:type_family": {"family": [family, "galaxysmp_pet", "mob"]},
        },
        "galaxysmp:tame": tame,
        "galaxysmp:baby": {"minecraft:is_baby": {}, "minecraft:scale": {"value": 0.55},
                           "minecraft:ageable": {"duration": 1200, "feed_items": tame_items, "grow_up": {"event": "galaxysmp:grow_up", "target": "self"}},
                           "minecraft:behavior.follow_parent": {"priority": 6, "speed_multiplier": 1.1}},
        "galaxysmp:adult": {"minecraft:scale": {"value": 1.0}},
    }


def pet_events(variants=0, baby_chance=12):
    spawn = {"sequence": [{"randomize": [{"weight": 100 - baby_chance, "add": {"component_groups": ["galaxysmp:wild", "galaxysmp:adult"]}},
                                         {"weight": baby_chance, "add": {"component_groups": ["galaxysmp:wild", "galaxysmp:baby"]}}]}]}
    if variants:
        spawn["sequence"].insert(0, {"randomize": [{"weight": 1, "add": {"component_groups": [f"galaxysmp:v{i}"]}} for i in range(variants)]})
    return {
        "minecraft:entity_spawned": spawn,
        "minecraft:entity_born": {"add": {"component_groups": ["galaxysmp:baby", "galaxysmp:tame"]}},
        "galaxysmp:on_tame": {"remove": {"component_groups": ["galaxysmp:wild"]}, "add": {"component_groups": ["galaxysmp:tame"]}},
        "galaxysmp:grow_up": {"remove": {"component_groups": ["galaxysmp:baby"]}, "add": {"component_groups": ["galaxysmp:adult"]}},
    }


# ================================================================== DUMPLINGS
COLORS = [("red", (232, 92, 92)), ("blue", (96, 150, 235)), ("green", (110, 200, 110)), ("yellow", (245, 214, 92)),
          ("purple", (170, 120, 225)), ("pink", (245, 150, 190)), ("white", (240, 236, 228)), ("orange", (245, 160, 80))]


def dumpling_texture(name, col):
    t = Tex(64, 32)
    dough = tuple(int(c * 0.55 + 255 * 0.45) for c in col)   # soft pastel dough in that colour
    t.box(0, 0, 12, 5, 9, dough)                               # body 12x5x9
    t.box(0, 14, 10, 2, 7, tuple(int(c * 1.04) for c in dough))   # top 10x2x7
    t.box(42, 0, 1, 2, 1, dough)                               # pleat 1x2x1
    fx, fy = Tex.front(0, 0, 12, 5, 9)
    eye = (40, 30, 40, 255); blush = (255, 140, 150, 255)
    t.d.rectangle([fx + 3, fy + 1, fx + 3, fy + 2], fill=eye); t.d.rectangle([fx + 8, fy + 1, fx + 8, fy + 2], fill=eye)
    t.d.point((fx + 2, fy + 3), fill=blush); t.d.point((fx + 9, fy + 3), fill=blush)
    t.d.line([fx + 5, fy + 3, fx + 6, fy + 3], fill=eye)
    t.speckle(0, 0, 12, 5, 9, tuple(int(c * 0.93) for c in dough) + (255,), 40, name)
    t.save(f"galaxysmp_dumpling_{name}")


for n, c in COLORS:
    dumpling_texture(n, c)

pleats = [cube([-4.5 + i * 1.5, 7, -0.5], [1, 2, 1], [42, 0]) for i in range(7)]
geo("dumpling", 64, 32, [
    bone("root"),
    bone("body", "root", (0, 0, 0), [cube([-6, 0, -4.5], [12, 5, 9], [0, 0])]),
    bone("top", "body", (0, 5, 0), [cube([-5, 5, -3.5], [10, 2, 7], [0, 14])]),
    bone("pleats", "top", (0, 7, 0), pleats),
], bounds=(1.5, 1))
anims("dumpling", {
    "animation.galaxysmp_dumpling.idle": {"loop": True, "bones": {
        "body": {"scale": ["1 + math.sin(query.life_time * 200) * 0.03", "1 - math.sin(query.life_time * 200) * 0.04", "1 + math.sin(query.life_time * 200) * 0.03"]}}},
    "animation.galaxysmp_dumpling.air": {"loop": True, "bones": {"body": {"scale": [0.86, 1.28, 0.86]}}},
    "animation.galaxysmp_dumpling.land": {"animation_length": 0.3, "bones": {"body": {"scale": {
        "0.0": [1.3, 0.62, 1.3], "0.12": [0.92, 1.12, 0.92], "0.3": [1.0, 1.0, 1.0]}}}, "sound_effects": {"0.0": {"effect": "boing"}}},
    "animation.galaxysmp_dumpling.sit": {"loop": True, "bones": {"body": {"scale": [1.15, 0.8, 1.15]}}},
})
write(os.path.join(RP, "animation_controllers", "dumpling.animation_controllers.json"), {"format_version": "1.10.0", "animation_controllers": {
    "controller.animation.galaxysmp_dumpling.bounce": {"initial_state": "ground", "states": {
        "ground": {"animations": [{"idle": "!query.is_sitting"}, {"sit": "query.is_sitting"}], "transitions": [{"air": "!query.is_on_ground"}]},
        "air": {"animations": ["air"], "transitions": [{"land": "query.is_on_ground"}]},
        "land": {"animations": ["land"], "transitions": [{"ground": "query.all_animations_finished"}, {"air": "!query.is_on_ground"}]}}}}})
client("dumpling", {n: f"textures/entity/galaxysmp_dumpling_{n}" for n, _ in COLORS}, "dumpling",
       {"idle": "animation.galaxysmp_dumpling.idle", "air": "animation.galaxysmp_dumpling.air", "land": "animation.galaxysmp_dumpling.land",
        "sit": "animation.galaxysmp_dumpling.sit", "bounce": "controller.animation.galaxysmp_dumpling.bounce"},
       ["bounce"], controllers=["controller.render.galaxysmp_dumpling"], egg=("#f3e6c8", "#e85c5c"), sounds={"boing": "mob.slime.jump"})
write(os.path.join(RP, "render_controllers", "dumpling.render_controllers.json"), {"format_version": "1.8.0", "render_controllers": {
    "controller.render.galaxysmp_dumpling": {"arrays": {"textures": {"Array.skins": [f"Texture.{n}" for n, _ in COLORS]}},
                                             "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
                                             "textures": ["Array.skins[query.variant]"]}}})
dgroups = pet_groups(["galaxysmp:dumpling_treat"], "dumpling", 6)
for i in range(len(COLORS)):
    dgroups[f"galaxysmp:v{i}"] = {"minecraft:variant": {"value": i}}
entity("dumpling", {
    **COMMON,
    "minecraft:type_family": {"family": ["dumpling", "galaxysmp_pet", "mob"]},
    "minecraft:variant": {"value": 0},   # spawned ones pick a color; babies take a parent's color
    "minecraft:collision_box": {"width": 0.7, "height": 0.5},
    "minecraft:health": {"value": 14, "max": 14},
    "minecraft:movement": {"value": 0.28},
    "minecraft:movement.skip": {},
    "minecraft:jump.dynamic": {},
    "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_water": True, "avoid_damage_blocks": True},
    "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
    "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.4},
    "minecraft:behavior.breed": {"priority": 2, "speed_multiplier": 1.0},
    "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 0.9},
}, dgroups, pet_events(variants=len(COLORS)))

# the Dumpling Treat (tames, heals and breeds dumplings) and its recipe
write(os.path.join(BP, "items", "dumpling_treat.json"), {"format_version": "1.21.40", "minecraft:item": {
    "description": {"identifier": "galaxysmp:dumpling_treat", "menu_category": {"category": "items"}},
    "components": {"minecraft:icon": {"textures": {"default": "galaxysmp_dumpling_treat"}},
                   "minecraft:display_name": {"value": "§fDumpling Treat"}, "minecraft:max_stack_size": 64}}})
write(os.path.join(BP, "recipes", "dumpling_treat.json"), {"format_version": "1.21.40", "minecraft:recipe_shapeless": {
    "description": {"identifier": "galaxysmp:dumpling_treat"}, "tags": ["crafting_table"],
    "ingredients": [{"item": "minecraft:wheat"}, {"item": "minecraft:kelp"}, {"item": "minecraft:sugar"}],
    "result": {"item": "galaxysmp:dumpling_treat", "count": 4}}})
im = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(im)
d.ellipse((2, 5, 13, 13), fill=(70, 50, 40, 255)); d.ellipse((3, 5, 12, 11), fill=(245, 235, 215, 255))   # bowl + rice
for x in (5, 8, 10):
    d.point((x, 7), fill=(255, 255, 255, 255))
d.rectangle((7, 2, 8, 6), fill=(60, 40, 30, 255)); d.point((9, 3), fill=(60, 40, 30, 255))                 # soy drop
d.ellipse((4, 8, 6, 9), fill=(232, 92, 92, 255))
im.save(os.path.join(RP, "textures", "items", "galaxysmp_dumpling_treat.png"))

# ================================================================== PENGUIN: babies + breeding
pp = os.path.join(BP, "entities", "penguin.json")
pen = json.load(open(pp))
pg = pen["minecraft:entity"]["component_groups"]
fish = ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:cooked_cod", "minecraft:cooked_salmon"]
pg["galaxysmp:tame"]["minecraft:breedable"] = {"require_tame": True, "inherit_tamed": True, "breed_items": fish, "love_filters": {"test": "is_sitting", "value": False},
                                              "breeds_with": {"mate_type": "galaxysmp:penguin", "baby_type": "galaxysmp:penguin", "breed_event": {"event": "minecraft:entity_born", "target": "baby"}}}
pg["galaxysmp:tame"]["minecraft:type_family"] = {"family": ["penguin", "galaxysmp_pet", "galaxysmp_tamed", "mob"]}
pg["galaxysmp:baby"] = {"minecraft:is_baby": {}, "minecraft:scale": {"value": 0.55},
                        "minecraft:ageable": {"duration": 1200, "feed_items": fish, "grow_up": {"event": "galaxysmp:grow_up", "target": "self"}},
                        "minecraft:behavior.follow_parent": {"priority": 6, "speed_multiplier": 1.1}}
pg["galaxysmp:adult"] = {"minecraft:scale": {"value": 1.0}}
pen["minecraft:entity"]["components"]["minecraft:behavior.breed"] = {"priority": 2, "speed_multiplier": 1.0}
pe = pen["minecraft:entity"]["events"]
pe["minecraft:entity_spawned"] = {"randomize": [{"weight": 88, "add": {"component_groups": ["galaxysmp:wild", "galaxysmp:adult"]}},
                                                {"weight": 12, "add": {"component_groups": ["galaxysmp:wild", "galaxysmp:baby"]}}]}
pe["minecraft:entity_born"] = {"add": {"component_groups": ["galaxysmp:baby", "galaxysmp:tame"]}}
pe["galaxysmp:grow_up"] = {"remove": {"component_groups": ["galaxysmp:baby"]}, "add": {"component_groups": ["galaxysmp:adult"]}}
json.dump(pen, open(pp, "w"), indent=1)

# ================================================================== BLUB (blue cube with bunny ears, teal belly, stubby feet)
def hx(c):
    c = c.lstrip("#"); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def paint(t, u, v, w, h, d, face, rows):
    """Paints one face of a box-UV cube from rows of colors (each row a list, or a single color for the whole row)."""
    ox, oy, fw, fh = {"top": (u + d, v, w, d), "bottom": (u + d + w, v, w, d), "west": (u, v + d, d, h),
                      "north": (u + d, v + d, w, h), "east": (u + d + w, v + d, d, h), "south": (u + 2 * d + w, v + d, w, h)}[face]
    for y in range(fh):
        row = rows[min(y, len(rows) - 1)]
        for x in range(fw):
            c = row[min(x, len(row) - 1)] if isinstance(row, list) else row
            t.im.putpixel((ox + x, oy + y), hx(c))


t = Tex(64, 32)
rnd = random.Random("blub")
mid = lambda: rnd.choice(["#5487b6", "#5286b5", "#4f86b5", "#5689b6", "#5387b7"])
light = lambda: rnd.choice(["#5d90c0", "#5b8fbd", "#5f92c1"])
W, H, D = 10, 10, 12   # a square face, and a body just a little longer from the side
front = [["#7193b8"] * (W - 1) + ["#8fa4b3"]]
for r in range(H - 5):   # blue, with a slightly lighter patch in the middle
    front.append(["#7193b8"] + [light() if 1 <= r <= 3 and 2 <= x <= W - 5 else mid() for x in range(W - 2)] + ["#7495b8"])
eyes = ["#4b9cb1"] + ["#5286b5"] * (W - 2) + ["#4fa1b4"]
eyes[1] = eyes[2] = "#333367"; eyes[W - 3] = eyes[W - 2] = "#353365"
front.append(eyes)
mouth = ["#60a4b1"] + ["#4690b3"] * (W - 2) + ["#63a6b5"]
mouth[W // 2 - 1] = mouth[W // 2] = "#4a4a80"
front.append(mouth)
front.append(["#60a2b2", "#60a2b2", "#60a1b2", "#459caf", "#479eb2", "#469db1", "#479cb1", "#60a3b3", "#61a3b2", "#63a3b1"])
front.append(["#5ea0b0", "#4a98ad", "#479cb1", "#459caf", "#469db1", "#479eb2", "#459caf", "#479cb1", "#4a98ad", "#5ea0b0"])
side = ["#54769a", "#436e98", "#456f99", "#476f99", "#456f99", "#436e98", "#3d7a92", "#3e7d90", "#4b8495", "#3e7d90"]
back = ["#5a84ad", "#4f80ad", "#4f80ad", "#4f80ad", "#4f80ad", "#4f80ad", "#4590a8", "#4a98ad", "#55a0b0", "#4a98ad"]
paint(t, 0, 0, W, H, D, "north", front)
paint(t, 0, 0, W, H, D, "west", side)
paint(t, 0, 0, W, H, D, "east", side)
paint(t, 0, 0, W, H, D, "south", back)
paint(t, 0, 0, W, H, D, "top", [[rnd.choice(["#7193b8", "#7a9bbd", "#7596ba"]) for _ in range(W)] for _ in range(D)])
paint(t, 0, 0, W, H, D, "bottom", ["#2f6a80"])
ear_front = [["#92a4b8", "#93a4b7", "#869fbe"], ["#8da2b9", "#839eb9", "#7898ba"], ["#809bb8", "#5484b4", "#6792b7"],
             ["#7193b8", "#5583b7", "#4b96b5"], ["#6e91b7", "#5287b6", "#509cb4"]]
EU = 2 * D + 2 * W   # ears and feet go to the right of the body on the texture
paint(t, EU, 0, 3, 5, 2, "north", ear_front)
paint(t, EU, 0, 3, 5, 2, "south", ["#7e98b5", "#6a8cb3", "#5f8ab3", "#5583b0", "#5283b0"])
paint(t, EU, 0, 3, 5, 2, "west", ["#8ea3b8", "#7193b8", "#6e91b7", "#5f88b3", "#5a86b2"])
paint(t, EU, 0, 3, 5, 2, "east", ["#70849d", "#6a88a6", "#56759f", "#4a6e95", "#3d7692"])
paint(t, EU, 0, 3, 5, 2, "top", ["#95a8bb"])
paint(t, EU, 0, 3, 5, 2, "bottom", ["#5283b0"])
for f, c in (("north", [["#5ba3af", "#5ca0ae", "#2f5c74"], ["#5a8895", "#5a8895", "#245b70"]]), ("south", ["#214f66"]), ("west", ["#4d808f", "#2f5c74"]),
             ("east", ["#1e5772", "#18465c"]), ("top", ["#3e7d90"]), ("bottom", ["#18465c"])):
    paint(t, EU, 12, 3, 2, 3, f, c)
t.save("galaxysmp_blub")
geo("blub", 64, 32, [
    bone("root"),
    bone("body", "root", (0, 2, 0), [cube([-W / 2, 2, -D / 2], [W, H, D], [0, 0])]),
    bone("ear1", "body", (-2.5, 2 + H, 0), [cube([-4, 2 + H, -1], [3, 5, 2], [EU, 0])]),
    bone("ear2", "body", (2.5, 2 + H, 0), [cube([1, 2 + H, -1], [3, 5, 2], [EU, 0])]),
    bone("leg1", "root", (-3, 2, -4), [cube([-4.5, 0, -5.5], [3, 2, 3], [EU, 12])]),
    bone("leg2", "root", (3, 2, -4), [cube([1.5, 0, -5.5], [3, 2, 3], [EU, 12])]),
    bone("leg3", "root", (-3, 2, 4), [cube([-4.5, 0, 2.5], [3, 2, 3], [EU, 12])]),
    bone("leg4", "root", (3, 2, 4), [cube([1.5, 0, 2.5], [3, 2, 3], [EU, 12])]),
], bounds=(1.5, 1.5))
legwalk = lambda s: [f"{s}math.cos(query.modified_distance_moved * 60) * 40 * query.modified_move_speed", 0, 0]
anims("blub", {
    "animation.galaxysmp_blub.move": {"loop": True, "bones": {"leg1": {"rotation": legwalk("")}, "leg4": {"rotation": legwalk("")},
                                                               "leg2": {"rotation": legwalk("-")}, "leg3": {"rotation": legwalk("-")}}},
    "animation.galaxysmp_blub.idle": {"loop": True, "bones": {
        "ear1": {"rotation": ["math.sin(query.life_time * 150) * 6", 0, "math.max(0, math.sin(query.life_time * 40)) * 10"]},
        "ear2": {"rotation": ["math.sin(query.life_time * 150 + 40) * 6", 0, 0]},
        "body": {"scale": [1, "1 + math.sin(query.life_time * 180) * 0.03", 1]}}},
    "animation.galaxysmp_blub.air": {"loop": True, "bones": {"body": {"scale": [0.92, 1.12, 0.92]}, "leg1": {"rotation": [-40, 0, 0]}, "leg2": {"rotation": [-40, 0, 0]},
                                                              "leg3": {"rotation": [40, 0, 0]}, "leg4": {"rotation": [40, 0, 0]}}},
    "animation.galaxysmp_blub.sit": {"loop": True, "bones": {"root": {"position": [0, -1.5, 0]}}},
})
client("blub", {"default": "textures/entity/galaxysmp_blub"}, "blub",
       {"move": "animation.galaxysmp_blub.move", "idle": "animation.galaxysmp_blub.idle", "air": "animation.galaxysmp_blub.air", "sit": "animation.galaxysmp_blub.sit"},
       ["idle", {"move": "query.is_on_ground && !query.is_sitting"}, {"air": "!query.is_on_ground && !query.is_riding"}, {"sit": "query.is_sitting"}],
       egg=("#5487b6", "#60a2b2"))
bgroups = pet_groups(["minecraft:glow_berries"], "blub", 6, extra_tame=["parrot_tame"])
entity("blub", {
    **COMMON,
    "minecraft:type_family": {"family": ["blub", "galaxysmp_pet", "mob"]},
    "minecraft:collision_box": {"width": 0.7, "height": 0.75},
    "minecraft:health": {"value": 10, "max": 10},
    "minecraft:movement": {"value": 0.3},
    "minecraft:movement.skip": {}, "minecraft:jump.dynamic": {},
    "minecraft:navigation.walk": {"avoid_water": True, "avoid_damage_blocks": True},
    "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
    "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.5},
    "minecraft:behavior.breed": {"priority": 2, "speed_multiplier": 1.0},
    "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 1.0},
}, bgroups, pet_events())

# ================================================================== PORTAL SCREEN (a picture in a portal, sized by properties)
PICS = ["wilderness", "copper", "sift", "chaos"]
props = {"galaxysmp:w": {"type": "int", "range": [1, 32], "default": 3, "client_sync": True},
         "galaxysmp:h": {"type": "int", "range": [1, 32], "default": 4, "client_sync": True},
         "galaxysmp:img": {"type": "int", "range": [0, 7], "default": 0, "client_sync": True}}
pev = {}
for n in range(1, 33):
    pev[f"galaxysmp:w{n}"] = {"set_property": {"galaxysmp:w": n}}
    pev[f"galaxysmp:h{n}"] = {"set_property": {"galaxysmp:h": n}}
for n in range(8):
    pev[f"galaxysmp:img{n}"] = {"set_property": {"galaxysmp:img": n}}
pev["minecraft:entity_spawned"] = {}

# the Portal Axe (operators make picture portals with it)
write(os.path.join(BP, "items", "portal_axe.json"), {"format_version": "1.21.40", "minecraft:item": {
    "description": {"identifier": "galaxysmp:portal_axe", "menu_category": {"category": "equipment", "is_hidden_in_commands": False}},
    "components": {"minecraft:icon": {"textures": {"default": "galaxysmp_portal_axe"}}, "minecraft:display_name": {"value": "§dPortal Axe"},
                   "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True, "minecraft:glint": True}}})
im = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(im)
for i in range(11):
    d.point((3 + i, 13 - i), fill=(110, 75, 45, 255)); d.point((4 + i, 13 - i), fill=(80, 55, 35, 255))   # handle
d.polygon([(9, 1), (14, 2), (15, 6), (12, 7), (9, 4)], fill=(150, 90, 230, 255))                           # head
d.line([(10, 2), (14, 3)], fill=(110, 220, 255, 255)); d.point((13, 5), fill=(255, 255, 255, 255))
im.save(os.path.join(RP, "textures", "items", "galaxysmp_portal_axe.png"))

# the Border Axe (operators draw world borders with it)
write(os.path.join(BP, "items", "border_axe.json"), {"format_version": "1.21.40", "minecraft:item": {
    "description": {"identifier": "galaxysmp:border_axe", "menu_category": {"category": "equipment", "is_hidden_in_commands": False}},
    "components": {"minecraft:icon": {"textures": {"default": "galaxysmp_border_axe"}}, "minecraft:display_name": {"value": "§bBorder Axe"},
                   "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True, "minecraft:glint": True}}})
im = Image.new("RGBA", (16, 16)); d = ImageDraw.Draw(im)
for i in range(11):
    d.point((3 + i, 13 - i), fill=(110, 75, 45, 255)); d.point((4 + i, 13 - i), fill=(80, 55, 35, 255))
d.polygon([(9, 1), (14, 2), (15, 6), (12, 7), (9, 4)], fill=(40, 150, 230, 255))
d.line([(10, 2), (14, 3)], fill=(150, 240, 255, 255)); d.point((13, 5), fill=(255, 255, 255, 255))
im.save(os.path.join(RP, "textures", "items", "galaxysmp_border_axe.png"))

# the world border wall: flat blue striped squares (2 x 2 blocks), one kind facing z (a wall along x), one facing x
im = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
for k in range(-32, 64, 8):
    d.polygon([(k, 32), (k + 4, 32), (k + 36, 0), (k + 32, 0)], fill=(70, 160, 255, 170))
d.rectangle([0, 0, 31, 31], outline=None)
os.makedirs(os.path.join(RP, "textures", "particle"), exist_ok=True)
im.save(os.path.join(RP, "textures", "particle", "galaxysmp_border.png"))
for kind, facing in (("x", "emitter_transform_xy"), ("z", "emitter_transform_yz")):
    write(os.path.join(RP, "particles", f"galaxysmp_border_{kind}.json"), {"format_version": "1.10.0", "particle_effect": {
        "description": {"identifier": f"galaxysmp:border_{kind}",
                        "basic_render_parameters": {"material": "particles_blend", "texture": "textures/particle/galaxysmp_border"}},
        "components": {
            "minecraft:emitter_rate_instant": {"num_particles": 1},
            "minecraft:emitter_lifetime_once": {"active_time": 0.05},
            "minecraft:emitter_shape_point": {},
            "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
            "minecraft:particle_appearance_billboard": {"size": [1.0, 1.0], "facing_camera_mode": facing,
                                                        "uv": {"texture_width": 32, "texture_height": 32, "uv": [0, 0], "uv_size": [32, 32]}},
            "minecraft:particle_appearance_tinting": {"color": [1, 1, 1, "math.clamp(math.sin(variable.particle_age / variable.particle_lifetime * 180) * 1.4, 0, 1)"]}}}})

# the Sift's teal sky (the plugin turns this fog on while you're in the Sift)
write(os.path.join(RP, "fogs", "galaxysmp_sift.json"), {"format_version": "1.16.100", "minecraft:fog_settings": {
    "description": {"identifier": "galaxysmp:sift"},
    "distance": {"air": {"fog_start": 0.25, "fog_end": 1.0, "fog_color": "#5ED6C6", "render_distance_type": "render"},
                 "weather": {"fog_start": 0.2, "fog_end": 0.9, "fog_color": "#5ED6C6", "render_distance_type": "render"}}}})
entity("portal_screen", {
    "minecraft:type_family": {"family": ["inanimate", "galaxysmp_portal"]},
    "minecraft:collision_box": {"width": 0.01, "height": 0.01},
    "minecraft:physics": {"has_gravity": False, "has_collision": False},
    "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
    "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": "no"}},
    "minecraft:knockback_resistance": {"value": 1.0}, "minecraft:health": {"value": 1, "max": 1}, "minecraft:fire_immune": {},
    "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False}, "minecraft:persistent": {},
}, events=pev, spawnable=False, properties=props)
geo("portal_screen", 16, 16, [bone("plane", None, (0, 0, 0), [{"origin": [-8, 0, 0], "size": [16, 16, 0], "uv": {
    "north": {"uv": [0, 0], "uv_size": [16, 16]}, "south": {"uv": [16, 0], "uv_size": [-16, 16]}}}])], bounds=(32, 32))
anims("portal_screen", {"animation.galaxysmp_portal_screen.size": {"loop": True, "bones": {"plane": {
    "scale": ["query.property('galaxysmp:w')", "query.property('galaxysmp:h')", 1]}}}})
client("portal_screen", {p: f"textures/ui/gsmp_bg_{p}" for p in PICS}, "portal_screen", {"size": "animation.galaxysmp_portal_screen.size"}, ["size"],
       controllers=["controller.render.galaxysmp_portal_screen"], material="entity_alphatest")
write(os.path.join(RP, "render_controllers", "portal_screen.render_controllers.json"), {"format_version": "1.8.0", "render_controllers": {
    "controller.render.galaxysmp_portal_screen": {"arrays": {"textures": {"Array.pics": [f"Texture.{p}" for p in PICS]}},
                                                  "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
                                                  "textures": ["Array.pics[query.property('galaxysmp:img')]"],
                                                  "light_color_multiplier": 1.0, "ignore_lighting": True}}})

# ------------------------------------------------------------------ sounds (squeaks, songs) and names
write(os.path.join(RP, "sounds.json"), {"entity_sounds": {"entities": {
    "galaxysmp:blub": {"volume": 0.6, "pitch": [1.5, 1.8], "events": {"ambient": "mob.rabbit.idle", "hurt": "mob.rabbit.hurt", "death": "mob.rabbit.death"}},
    "galaxysmp:dumpling": {"volume": 0.7, "pitch": [1.3, 1.6], "events": {"hurt": "mob.slime.small", "death": "mob.slime.small"}},
}}})
NAMES = {"dumpling": "Dumpling", "blub": "Blub", "portal_screen": "Portal"}
REMOVED = ["seedling", "trill", "baby_sifter", "bearded_sifter", "nester", "sift_orb"]   # taken out (owner's choice)
lang = os.path.join(RP, "texts", "en_US.lang")
lines = [l for l in open(lang).read().splitlines() if not any(f"galaxysmp:{k}." in l for k in list(NAMES) + REMOVED) and "dumpling_treat" not in l and "portal_axe" not in l]
for k, v in NAMES.items():
    lines.append(f"entity.galaxysmp:{k}.name={v}")
    if k != "portal_screen":
        lines.append(f"item.spawn_egg.entity.galaxysmp:{k}.name={v} Spawn Egg")
lines += ["item.galaxysmp:dumpling_treat=Dumpling Treat", "item.galaxysmp:portal_axe=Portal Axe", "item.galaxysmp:border_axe=Border Axe"]
open(lang, "w").write("\n".join(lines) + "\n")
it = json.load(open(os.path.join(RP, "textures", "item_texture.json")))
it["texture_data"]["galaxysmp_dumpling_treat"] = {"textures": "textures/items/galaxysmp_dumpling_treat"}
it["texture_data"]["galaxysmp_portal_axe"] = {"textures": "textures/items/galaxysmp_portal_axe"}
it["texture_data"]["galaxysmp_border_axe"] = {"textures": "textures/items/galaxysmp_border_axe"}
json.dump(it, open(os.path.join(RP, "textures", "item_texture.json"), "w"), indent=1)
for k in REMOVED:
    for f in (os.path.join(BP, "entities", f"{k}.json"), os.path.join(RP, "entity", f"{k}.entity.json"),
              os.path.join(RP, "models", "entity", f"{k}.geo.json"), os.path.join(RP, "textures", "entity", f"galaxysmp_{k}.png"),
              os.path.join(RP, "animations", f"{k}.animation.json"), os.path.join(RP, "animations", "sifters.animation.json"),
              os.path.join(BP, "loot_tables", "entities", f"galaxysmp_{k}.json"), os.path.join(BP, "loot_tables", "entities", "galaxysmp_sifter.json")):
        if os.path.exists(f):
            os.remove(f)
print("mobs written")
