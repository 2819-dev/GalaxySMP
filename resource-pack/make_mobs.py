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

# ================================================================== BLUB
t = Tex(64, 32)
ice = (190, 232, 245); ice2 = (160, 214, 236); dark = (110, 40, 50, 255)
t.box(0, 0, 8, 7, 8, ice, top=(214, 242, 250))       # body 8x7x8
t.speckle(0, 0, 8, 7, 8, ice2 + (255,), 30, "blub")
fx, fy = Tex.front(0, 0, 8, 7, 8)
t.d.rectangle([fx + 1, fy + 2, fx + 2, fy + 3], fill=dark); t.d.rectangle([fx + 5, fy + 2, fx + 6, fy + 3], fill=dark)
t.d.rectangle([fx + 3, fy + 5, fx + 4, fy + 5], fill=dark)
t.box(32, 0, 2, 3, 2, (205, 238, 248))                 # ear spike 2x3x2
t.box(32, 8, 2, 2, 2, ice2)                            # leg 2x2x2
t.save("galaxysmp_blub")
geo("blub", 64, 32, [
    bone("root"),
    bone("body", "root", (0, 2, 0), [cube([-4, 2, -4], [8, 7, 8], [0, 0])]),
    bone("ear1", "body", (-2.5, 9, -1), [cube([-3.5, 9, -2], [2, 3, 2], [32, 0])], rotation=[0, 0, 12]),
    bone("ear2", "body", (0, 9, 1), [cube([-1, 9, 0], [2, 3, 2], [32, 0])]),
    bone("ear3", "body", (2.5, 9, -1), [cube([1.5, 9, -2], [2, 3, 2], [32, 0])], rotation=[0, 0, -12]),
    bone("leg1", "root", (-2.5, 2, -2.5), [cube([-3.5, 0, -3.5], [2, 2, 2], [32, 8])]),
    bone("leg2", "root", (2.5, 2, -2.5), [cube([1.5, 0, -3.5], [2, 2, 2], [32, 8])]),
    bone("leg3", "root", (-2.5, 2, 2.5), [cube([-3.5, 0, 1.5], [2, 2, 2], [32, 8])]),
    bone("leg4", "root", (2.5, 2, 2.5), [cube([1.5, 0, 1.5], [2, 2, 2], [32, 8])]),
], bounds=(1.5, 1.5))
legwalk = lambda s: [f"{s}math.cos(query.modified_distance_moved * 60) * 40 * query.modified_move_speed", 0, 0]
anims("blub", {
    "animation.galaxysmp_blub.move": {"loop": True, "bones": {"leg1": {"rotation": legwalk("")}, "leg4": {"rotation": legwalk("")},
                                                               "leg2": {"rotation": legwalk("-")}, "leg3": {"rotation": legwalk("-")}}},
    "animation.galaxysmp_blub.idle": {"loop": True, "bones": {
        "ear1": {"rotation": [0, 0, "12 + math.sin(query.life_time * 150) * 8"]}, "ear3": {"rotation": [0, 0, "-12 - math.sin(query.life_time * 150) * 8"]},
        "body": {"scale": [1, "1 + math.sin(query.life_time * 180) * 0.03", 1]}}},
    "animation.galaxysmp_blub.air": {"loop": True, "bones": {"body": {"scale": [0.92, 1.12, 0.92]}, "leg1": {"rotation": [-40, 0, 0]}, "leg2": {"rotation": [-40, 0, 0]},
                                                              "leg3": {"rotation": [40, 0, 0]}, "leg4": {"rotation": [40, 0, 0]}}},
    "animation.galaxysmp_blub.sit": {"loop": True, "bones": {"root": {"position": [0, -1.5, 0]}}},
})
client("blub", {"default": "textures/entity/galaxysmp_blub"}, "blub",
       {"move": "animation.galaxysmp_blub.move", "idle": "animation.galaxysmp_blub.idle", "air": "animation.galaxysmp_blub.air", "sit": "animation.galaxysmp_blub.sit"},
       ["idle", {"move": "query.is_on_ground && !query.is_sitting"}, {"air": "!query.is_on_ground && !query.is_riding"}, {"sit": "query.is_sitting"}],
       egg=("#bee8f5", "#6e2832"))
bgroups = pet_groups(["minecraft:glow_berries"], "blub", 6, extra_tame=["parrot_tame"])
entity("blub", {
    **COMMON,
    "minecraft:type_family": {"family": ["blub", "galaxysmp_pet", "mob"]},
    "minecraft:collision_box": {"width": 0.5, "height": 0.6},
    "minecraft:health": {"value": 10, "max": 10},
    "minecraft:movement": {"value": 0.3},
    "minecraft:movement.skip": {}, "minecraft:jump.dynamic": {},
    "minecraft:navigation.walk": {"avoid_water": True, "avoid_damage_blocks": True},
    "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
    "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.5},
    "minecraft:behavior.breed": {"priority": 2, "speed_multiplier": 1.0},
    "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 1.0},
}, bgroups, pet_events())

# ================================================================== SEEDLING (tiny plant critter, runs from players)
t = Tex(32, 16)
t.box(0, 0, 4, 4, 4, (110, 190, 90), top=(140, 215, 110))
fx, fy = Tex.front(0, 0, 4, 4, 4)
t.d.point((fx + 1, fy + 1), fill=(30, 40, 30, 255)); t.d.point((fx + 2, fy + 1), fill=(30, 40, 30, 255))
t.d.rectangle([18, 0, 20, 1], fill=(90, 220, 120, 255)); t.d.rectangle([21, 0, 23, 1], fill=(70, 190, 100, 255))
t.box(16, 4, 1, 1, 1, (70, 120, 60))                 # leg
t.save("galaxysmp_seedling")
geo("seedling", 32, 16, [
    bone("root"),
    bone("body", "root", (0, 1, 0), [cube([-2, 1, -2], [4, 4, 4], [0, 0])]),
    bone("leaf1", "body", (0, 5, 0), [cube([0, 5, -1], [3, 0, 2], [16, 0])], rotation=[0, 0, -30]),
    bone("leaf2", "body", (0, 5, 0), [cube([-3, 5, -1], [3, 0, 2], [16, 0])], rotation=[0, 0, 30]),
    bone("legl", "root", (-1, 1, 0), [cube([-1.5, 0, -0.5], [1, 1, 1], [16, 4])]),
    bone("legr", "root", (1, 1, 0), [cube([0.5, 0, -0.5], [1, 1, 1], [16, 4])]),
], bounds=(1, 1))
anims("seedling", {
    "animation.galaxysmp_seedling.walk": {"loop": True, "bones": {"legl": {"rotation": legwalk("")}, "legr": {"rotation": legwalk("-")},
                                                                   "body": {"position": [0, "math.abs(math.sin(query.modified_distance_moved * 60)) * 0.6", 0]}}},
    "animation.galaxysmp_seedling.idle": {"loop": True, "bones": {"leaf1": {"rotation": [0, 0, "-30 - math.sin(query.life_time * 160) * 10"]},
                                                                   "leaf2": {"rotation": [0, 0, "30 + math.sin(query.life_time * 160) * 10"]}}},
})
client("seedling", {"default": "textures/entity/galaxysmp_seedling"}, "seedling",
       {"walk": "animation.galaxysmp_seedling.walk", "idle": "animation.galaxysmp_seedling.idle"}, ["walk", "idle"], egg=("#6ebe5a", "#5adc78"))
entity("seedling", {
    **COMMON,
    "minecraft:type_family": {"family": ["seedling", "sift_wildlife", "mob"]},
    "minecraft:collision_box": {"width": 0.35, "height": 0.4},
    "minecraft:health": {"value": 4, "max": 4},
    "minecraft:movement": {"value": 0.3},
    "minecraft:movement.basic": {}, "minecraft:navigation.walk": {"avoid_water": True},
    "minecraft:behavior.avoid_mob_type": {"priority": 1, "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 6, "walk_speed_multiplier": 1.2, "sprint_speed_multiplier": 1.6}]},
    "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8},
    "minecraft:loot": {"table": "loot_tables/entities/galaxysmp_seedling.json"},
}, spawnable=True)
write(os.path.join(BP, "loot_tables", "entities", "galaxysmp_seedling.json"), {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": "minecraft:wheat_seeds", "weight": 1,
                                                                                                                     "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]}]}]})

# ================================================================== TRILL (little blue songbird, flies in flocks)
t = Tex(64, 32)
blue = (70, 120, 230); cyan = (110, 220, 250)
t.box(0, 0, 4, 4, 6, blue, front=cyan)          # body 4x4x6
t.box(0, 10, 4, 4, 4, (90, 145, 240))           # head 4x4x4
fx, fy = Tex.front(0, 10, 4, 4, 4)
t.d.point((fx, fy + 1), fill=(20, 20, 30, 255)); t.d.point((fx + 3, fy + 1), fill=(20, 20, 30, 255))
t.box(20, 0, 1, 1, 2, (250, 200, 80))           # beak 1x1x2
t.box(20, 4, 1, 3, 5, (50, 95, 200))            # wing 1x3x5
t.box(20, 13, 2, 1, 3, (40, 80, 180))           # tail 2x1x3
t.save("galaxysmp_trill")
geo("trill", 64, 32, [
    bone("root"),
    bone("body", "root", (0, 2, 0), [cube([-2, 2, -3], [4, 4, 6], [0, 0])]),
    bone("head", "body", (0, 6, -2), [cube([-2, 5, -5], [4, 4, 4], [0, 10])]),
    bone("beak", "head", (0, 6, -5), [cube([-0.5, 6, -7], [1, 1, 2], [20, 0])]),
    bone("wingl", "body", (2, 6, 0), [cube([2, 3, -2], [1, 3, 5], [20, 4])]),
    bone("wingr", "body", (-2, 6, 0), [cube([-3, 3, -2], [1, 3, 5], [20, 4])]),
    bone("tail", "body", (0, 4, 3), [cube([-1, 3, 3], [2, 1, 3], [20, 13])]),
], bounds=(1, 1))
anims("trill", {
    "animation.galaxysmp_trill.fly": {"loop": True, "bones": {"wingl": {"rotation": [0, 0, "-math.sin(query.life_time * 1300) * 55"]},
                                                               "wingr": {"rotation": [0, 0, "math.sin(query.life_time * 1300) * 55"]}}},
    "animation.galaxysmp_trill.perch": {"loop": True, "bones": {"head": {"rotation": ["math.sin(query.life_time * 240) * 8", 0, 0]}}},
})
client("trill", {"default": "textures/entity/galaxysmp_trill"}, "trill",
       {"fly": "animation.galaxysmp_trill.fly", "perch": "animation.galaxysmp_trill.perch"},
       [{"fly": "!query.is_on_ground"}, {"perch": "query.is_on_ground"}], egg=("#4678e6", "#6edcfa"))
entity("trill", {
    **COMMON,
    "minecraft:type_family": {"family": ["trill", "sift_wildlife", "mob"]},
    "minecraft:collision_box": {"width": 0.4, "height": 0.5},
    "minecraft:health": {"value": 6, "max": 6},
    "minecraft:movement": {"value": 0.2}, "minecraft:flying_speed": {"value": 0.35},
    "minecraft:can_fly": {}, "minecraft:movement.basic": {},
    "minecraft:navigation.fly": {"can_path_from_air": True, "can_path_over_water": True},
    "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
    "minecraft:behavior.random_fly": {"priority": 3, "xz_dist": 10, "y_dist": 5, "y_offset": 0, "speed_multiplier": 1.0, "can_land_on_trees": True},
    "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.4},
})

# ================================================================== HOSTILE SIFTERS
def sifter_tex(name, base, accent, w, h, dp, legs=True):
    t = Tex(64, 64)
    t.box(0, 0, w, h, dp, base)
    t.speckle(0, 0, w, h, dp, tuple(int(c * 0.8) for c in base) + (255,), 60, name)
    fx, fy = Tex.front(0, 0, w, h, dp)
    glow = accent + (255,)
    t.d.rectangle([fx + 1, fy + 1, fx + 2, fy + 2], fill=glow); t.d.rectangle([fx + w - 3, fy + 1, fx + w - 2, fy + 2], fill=glow)
    t.d.rectangle([fx + 1, fy + h - 2, fx + w - 2, fy + h - 1], fill=(30, 10, 15, 255))
    for x in range(fx + 1, fx + w - 1, 2):
        t.d.point((x, fy + h - 2), fill=(235, 230, 220, 255))     # teeth
    return t

# Baby Sifter: small biter
t = sifter_tex("baby_sifter", (150, 60, 70), (90, 240, 230), 6, 5, 6)
t.box(32, 0, 2, 2, 2, (110, 45, 55))
t.box(32, 8, 1, 2, 1, (90, 240, 230))     # little glowing spike
t.save("galaxysmp_baby_sifter")
geo("baby_sifter", 64, 64, [
    bone("root"),
    bone("body", "root", (0, 2, 0), [cube([-3, 2, -3], [6, 5, 6], [0, 0])]),
    bone("spike", "body", (0, 7, 0), [cube([-0.5, 7, -0.5], [1, 2, 1], [32, 8])]),
    *[bone(f"leg{i}", "root", (x, 2, z), [cube([x - 1, 0, z - 1], [2, 2, 2], [32, 0])]) for i, (x, z) in enumerate([(-2, -2), (2, -2), (-2, 2), (2, 2)])],
], bounds=(1, 1))

# Bearded Sifter: tall, shoots tracking blue orbs from its beard
t = sifter_tex("bearded_sifter", (120, 70, 110), (110, 190, 255), 8, 10, 6)
t.box(32, 0, 7, 6, 6, (140, 85, 125))
hx, hy = Tex.front(32, 0, 7, 6, 6)
t.d.rectangle([hx + 1, hy + 2, hx + 2, hy + 3], fill=(110, 190, 255, 255)); t.d.rectangle([hx + 4, hy + 2, hx + 5, hy + 3], fill=(110, 190, 255, 255))
t.box(0, 20, 2, 8, 2, (90, 50, 80))       # leg 2x8x2
t.box(16, 20, 1, 6, 1, (80, 150, 240))    # beard tentacle 1x6x1
t.save("galaxysmp_bearded_sifter")
geo("bearded_sifter", 64, 64, [
    bone("root"),
    bone("body", "root", (0, 8, 0), [cube([-4, 8, -3], [8, 10, 6], [0, 0])]),
    bone("head", "body", (0, 18, 0), [cube([-3.5, 18, -3], [7, 6, 6], [32, 0])]),
    *[bone(f"beard{i}", "head", (x, 18, -3), [cube([x - 0.5, 12, -3.5], [1, 6, 1], [16, 20])]) for i, x in enumerate([-2, -0.7, 0.7, 2])],
    bone("legl", "root", (-2, 8, 0), [cube([-3, 0, -1], [2, 8, 2], [0, 20])]),
    bone("legr", "root", (2, 8, 0), [cube([1, 0, -1], [2, 8, 2], [0, 20])]),
], bounds=(1.5, 2.5))

# Nester: lean pouncer
t = sifter_tex("nester", (95, 80, 65), (255, 170, 60), 10, 6, 14)
t.box(0, 40, 6, 6, 7, (115, 95, 75))
nx, ny = Tex.front(0, 40, 6, 6, 7)
t.d.rectangle([nx + 1, ny + 2, nx + 1, ny + 2], fill=(255, 170, 60, 255)); t.d.rectangle([nx + 4, ny + 2, nx + 4, ny + 2], fill=(255, 170, 60, 255))
t.box(48, 0, 3, 8, 3, (80, 65, 55))
t.box(48, 20, 1, 3, 1, (230, 220, 200))   # spike
t.save("galaxysmp_nester")
geo("nester", 64, 64, [
    bone("root"),
    bone("body", "root", (0, 8, 0), [cube([-5, 8, -7], [10, 6, 14], [0, 0])]),
    bone("head", "body", (0, 12, -7), [cube([-3, 9, -14], [6, 6, 7], [0, 40])]),
    *[bone(f"spike{i}", "body", (0, 14, z), [cube([-0.5, 14, z], [1, 3, 1], [48, 20])]) for i, z in enumerate([-5, -2, 1, 4])],
    *[bone(f"leg{i}", "root", (x, 8, z), [cube([x - 1.5, 0, z - 1.5], [3, 8, 3], [48, 0])]) for i, (x, z) in enumerate([(-3.5, -5), (3.5, -5), (-3.5, 5), (3.5, 5)])],
], bounds=(2, 2))
walk4 = {f"leg{i}": {"rotation": [f"{'' if i in (0, 3) else '-'}math.cos(query.modified_distance_moved * 38) * 35 * query.modified_move_speed", 0, 0]} for i in range(4)}
anims("sifters", {
    "animation.galaxysmp_baby_sifter.walk": {"loop": True, "bones": {**walk4, "body": {"rotation": [0, 0, "math.sin(query.life_time * 500) * 4"]}}},
    "animation.galaxysmp_bearded_sifter.walk": {"loop": True, "bones": {
        "legl": {"rotation": ["math.cos(query.modified_distance_moved * 38) * 30 * query.modified_move_speed", 0, 0]},
        "legr": {"rotation": ["-math.cos(query.modified_distance_moved * 38) * 30 * query.modified_move_speed", 0, 0]},
        **{f"beard{i}": {"rotation": [f"math.sin(query.life_time * 200 + {i * 40}) * 12", 0, 0]} for i in range(4)}}},
    "animation.galaxysmp_nester.walk": {"loop": True, "bones": {**walk4, "head": {"rotation": ["query.target_x_rotation", "query.target_y_rotation", 0]}}},
})
for ident, egg in (("baby_sifter", ("#963c46", "#5af0e6")), ("bearded_sifter", ("#78466e", "#6ebeff")), ("nester", ("#5f5041", "#ffaa3c"))):
    client(ident, {"default": f"textures/entity/galaxysmp_{ident}"}, ident, {"walk": f"animation.galaxysmp_{ident}.walk"}, ["walk"], egg=egg)

hostile = {
    **COMMON,
    "minecraft:movement.basic": {}, "minecraft:navigation.walk": {"avoid_water": True, "can_pass_doors": True},
    "minecraft:behavior.hurt_by_target": {"priority": 1},
    "minecraft:behavior.nearest_attackable_target": {"priority": 2, "must_see": True, "reselect_targets": True,
        "entity_types": [{"filters": {"any_of": [{"test": "is_family", "subject": "other", "value": "player"},
                                                 {"test": "is_family", "subject": "other", "value": "galaxysmp_pet"}]}, "max_dist": 16}]},
    "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.9},
    "minecraft:experience_reward": {"on_death": "query.last_hit_by_player ? 5 : 0"},
    "minecraft:despawn": {"despawn_from_distance": {"min_distance": 48, "max_distance": 96}},
}
del hostile["minecraft:persistent"]
entity("baby_sifter", {**hostile, "minecraft:type_family": {"family": ["sifter", "sift_hostile", "monster", "mob"]},
                       "minecraft:collision_box": {"width": 0.5, "height": 0.55}, "minecraft:health": {"value": 10, "max": 10},
                       "minecraft:movement": {"value": 0.33}, "minecraft:attack": {"damage": 2},
                       "minecraft:behavior.melee_attack": {"priority": 3, "speed_multiplier": 1.3, "track_target": True},
                       "minecraft:loot": {"table": "loot_tables/entities/galaxysmp_sifter.json"}})
entity("bearded_sifter", {**hostile, "minecraft:type_family": {"family": ["sifter", "sift_hostile", "monster", "mob"]},
                          "minecraft:collision_box": {"width": 0.7, "height": 1.6}, "minecraft:health": {"value": 24, "max": 24},
                          "minecraft:movement": {"value": 0.23},
                          "minecraft:shooter": {"def": "galaxysmp:sift_orb"},
                          "minecraft:behavior.ranged_attack": {"priority": 3, "attack_interval_min": 2.5, "attack_interval_max": 4.0, "attack_radius": 14, "speed_multiplier": 1.0},
                          "minecraft:loot": {"table": "loot_tables/entities/galaxysmp_sifter.json"}})
entity("nester", {**hostile, "minecraft:type_family": {"family": ["nester", "sift_hostile", "monster", "mob"]},
                  "minecraft:collision_box": {"width": 0.9, "height": 1.0}, "minecraft:health": {"value": 20, "max": 20},
                  "minecraft:movement": {"value": 0.3}, "minecraft:attack": {"damage": 5},
                  "minecraft:behavior.leap_at_target": {"priority": 3, "yd": 0.45, "must_be_on_ground": True},
                  "minecraft:behavior.melee_attack": {"priority": 4, "speed_multiplier": 1.2, "track_target": True, "cooldown_time": 1.5},
                  "minecraft:loot": {"table": "loot_tables/entities/galaxysmp_sifter.json"}})
write(os.path.join(BP, "loot_tables", "entities", "galaxysmp_sifter.json"), {"pools": [
    {"rolls": 1, "entries": [{"type": "item", "name": "minecraft:amethyst_shard", "weight": 3, "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]},
                             {"type": "item", "name": "minecraft:bone", "weight": 3, "functions": [{"function": "set_count", "count": {"min": 1, "max": 3}}]},
                             {"type": "item", "name": "minecraft:glow_berries", "weight": 2}]},
    {"rolls": 1, "conditions": [{"condition": "killed_by_player"}, {"condition": "random_chance_with_looting", "chance": 0.05, "looting_multiplier": 0.02}],
     "entries": [{"type": "item", "name": "galaxysmp:dumpling_treat", "weight": 1}]}]})

# the Sifter orb: a slow, homing blue bolt
t = Tex(16, 16)
t.box(0, 0, 4, 4, 4, (120, 200, 255), shade=False)
t.save("galaxysmp_sift_orb")
geo("sift_orb", 16, 16, [bone("root", None, (0, 2, 0), [cube([-2, 0, -2], [4, 4, 4], [0, 0])])], bounds=(0.5, 0.5))
anims("sift_orb", {"animation.galaxysmp_sift_orb.spin": {"loop": True, "bones": {"root": {"rotation": ["query.life_time * 400", "query.life_time * 300", 0]}}}})
client("sift_orb", {"default": "textures/entity/galaxysmp_sift_orb"}, "sift_orb", {"spin": "animation.galaxysmp_sift_orb.spin"}, ["spin"])
entity("sift_orb", {
    "minecraft:collision_box": {"width": 0.3, "height": 0.3},
    "minecraft:projectile": {"on_hit": {"impact_damage": {"damage": 4, "knockback": True}, "remove_on_hit": {}},
                             "power": 0.6, "gravity": 0.0, "inertia": 1.0, "liquid_inertia": 1.0, "uncertainty_base": 1, "uncertainty_multiplier": 0,
                             "anchor": 1, "offset": [0, 0.5, 0], "homing": True, "reflect_on_hurt": True, "hit_sound": "bow.hit"},
    "minecraft:physics": {}, "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
    "minecraft:despawn": {"filters": {"test": "actor_health", "operator": "<", "value": 0}},
}, spawnable=False)

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
    "galaxysmp:trill": {"volume": 0.5, "pitch": [1.4, 1.8], "events": {"ambient": "mob.parrot.idle", "hurt": "mob.parrot.hurt", "death": "mob.parrot.death"}},
    "galaxysmp:seedling": {"volume": 0.4, "pitch": [1.6, 2.0], "events": {"hurt": "mob.rabbit.hurt", "death": "mob.rabbit.death"}},
    "galaxysmp:baby_sifter": {"volume": 0.7, "pitch": [1.3, 1.5], "events": {"ambient": "mob.endermite.say", "hurt": "mob.endermite.hit", "death": "mob.endermite.kill"}},
    "galaxysmp:bearded_sifter": {"volume": 0.8, "pitch": [0.8, 1.0], "events": {"ambient": "mob.evocation_illager.ambient", "hurt": "mob.zombie.hurt", "death": "mob.zombie.death"}},
    "galaxysmp:nester": {"volume": 0.8, "pitch": [0.9, 1.1], "events": {"ambient": "mob.ravager.ambient", "hurt": "mob.ravager.hurt", "death": "mob.ravager.death"}},
}}})
NAMES = {"dumpling": "Dumpling", "blub": "Blub", "seedling": "Seedling", "trill": "Trill", "baby_sifter": "Baby Sifter",
         "bearded_sifter": "Bearded Sifter", "nester": "Nester", "sift_orb": "Sifter Orb", "portal_screen": "Portal"}
lang = os.path.join(RP, "texts", "en_US.lang")
lines = [l for l in open(lang).read().splitlines() if not any(f"galaxysmp:{k}." in l for k in NAMES) and "dumpling_treat" not in l and "portal_axe" not in l]
for k, v in NAMES.items():
    lines.append(f"entity.galaxysmp:{k}.name={v}")
    if k not in ("sift_orb", "portal_screen"):
        lines.append(f"item.spawn_egg.entity.galaxysmp:{k}.name={v} Spawn Egg")
lines += ["item.galaxysmp:dumpling_treat=Dumpling Treat", "item.galaxysmp:portal_axe=Portal Axe"]
open(lang, "w").write("\n".join(lines) + "\n")
it = json.load(open(os.path.join(RP, "textures", "item_texture.json")))
it["texture_data"]["galaxysmp_dumpling_treat"] = {"textures": "textures/items/galaxysmp_dumpling_treat"}
it["texture_data"]["galaxysmp_portal_axe"] = {"textures": "textures/items/galaxysmp_portal_axe"}
json.dump(it, open(os.path.join(RP, "textures", "item_texture.json"), "w"), indent=1)
print("mobs written")
