"""Penguins and Potato Chips (from the GalaxySMP add-on packs).

Penguins (galaxysmp:penguin): tamed with fish. The first player to tame one owns it for good: nobody else can feed,
sit, leash, name or hurt it. A tamed penguin follows its owner and fights monsters and anyone who attacks them.
While your own penguin is within 16 blocks you get Penguin's Grace: faster in water (and no drowning), even faster on ice.
When your penguin is more than 16 blocks away, a penguin pointer above your hotbar shows the way (only you see it).

Potato Chips (galaxysmp:chips_*): four flavors, each with a strong custom-named power when eaten.
The powers are done by the plugin (not Minecraft effects), so only the power's name shows.

Both come from staff (/give) or as super rare Galaxy Crate prizes, and both can be traded and sold.
"""

import time

PENGUIN = "galaxysmp:penguin"
FISH = ("minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:cooked_cod", "minecraft:cooked_salmon")
OWNER_TAG = "gsmp_owner_"      # + xuid
NAME_TAG = "gsmp_ownername_"   # + gamertag (spaces as _)
GRACE_RANGE = 16
# mobs that can be tamed: they're kept just outside spawn (where mobs don't survive)
PETS = {PENGUIN, "minecraft:wolf", "minecraft:cat", "minecraft:parrot", "minecraft:horse", "minecraft:donkey", "minecraft:mule",
        "minecraft:llama", "minecraft:trader_llama", "minecraft:camel", "minecraft:skeleton_horse", "minecraft:ocelot", "minecraft:fox"}
DUMPLING = "galaxysmp:dumpling"
BLUB = "galaxysmp:blub"
# pets that only their owner can use: mob -> (what it's called, the food that tames it)
OWNABLE = {PENGUIN: ("Penguin", FISH), DUMPLING: ("Dumpling", ("galaxysmp:dumpling_treat",)), BLUB: ("Blub", ("minecraft:glow_berries",))}
PETS |= {DUMPLING, BLUB}
EDGE = 2   # blocks: a pet this close to spawn's edge (or inside) is moved back out

# flavor -> (power name, color, seconds, perks, description)
# The powers are made by the plugin itself (not Minecraft effects), so the effects list stays clean and only the
# power's name shows. Perks: strength = extra melee/arrow damage, resist = less damage taken, regen = health back every
# 2 seconds, hearts = extra hearts, speed = faster walking, fireproof / waterproof (no drowning) / nofall.
CHIPS = {
    "galaxysmp:chips_classic": ("Potato Power", "§6", 180, {"strength": 0.6, "resist": 0.3, "regen": 1, "hearts": 8},
                                "60% more damage, 30% less damage taken, fast healing and 8 extra hearts for 3 minutes"),
    "galaxysmp:chips_spicy": ("Fire Crunch", "§c", 180, {"strength": 0.9, "fireproof": True, "speed": 0.4},
                              "90% more damage, immune to fire and lava, and 40% faster for 3 minutes"),
    "galaxysmp:chips_sour": ("Sour Rush", "§a", 300, {"speed": 0.6, "nofall": True, "resist": 0.2},
                             "60% faster, no fall damage and 20% less damage taken for 5 minutes"),
    "galaxysmp:chips_galaxy": ("Cosmic Crunch", "§d", 300, {"strength": 0.7, "resist": 0.45, "regen": 2, "hearts": 10, "speed": 0.4,
                                                          "fireproof": True, "waterproof": True, "nofall": True},
                               "Everything at once: 70% more damage, 45% less damage taken, very fast healing, 10 extra hearts, "
                               "40% faster, and immune to fire, lava, drowning and fall damage for 5 minutes"),
}
WALK = 0.1   # Minecraft's normal walking speed

# what you see around you while a power is on (particles), and the icon in front of its name above the hotbar
LOOKS = {
    "Potato Power": ("", ["minecraft:critical_hit_emitter", "minecraft:villager_happy"]),
    "Fire Crunch": ("", ["minecraft:basic_flame_particle", "minecraft:lava_particle"]),
    "Sour Rush": ("", ["minecraft:villager_happy", "minecraft:electric_spark_particle"]),
    "Cosmic Crunch": ("", ["minecraft:endrod", "minecraft:totem_particle", "minecraft:obsidian_glow_dust_particle"]),
}
GRACE_LOOK = ("", ["minecraft:water_splash_particle_manual", "minecraft:snowflake_particle"])

# Super rare Galaxy Crate prizes (added once to the Galaxy Crate; staff can change them in /crates)
CRATE_PRIZES = [
    {"kind": "item", "item": "galaxysmp:penguin_spawn_egg", "count": 1, "weight": 1, "name": "Penguin Spawn Egg"},
    {"kind": "item", "item": "galaxysmp:chips_galaxy", "count": 1, "weight": 1, "name": "Potato Chips: Galaxy Flavor"},
    {"kind": "item", "item": "galaxysmp:chips_classic", "count": 2, "weight": 2, "name": "Potato Chips: Classic"},
]


def type_of(actor):
    try:
        return str(actor.type)
    except Exception:
        return ""


def owner_of(actor):
    """(xuid, name) of a tamed penguin's owner, or (None, None)."""
    xuid = name = None
    try:
        for t in actor.scoreboard_tags:
            if t.startswith(OWNER_TAG):
                xuid = t[len(OWNER_TAG):]
            elif t.startswith(NAME_TAG):
                name = t[len(NAME_TAG):].replace("_", " ")
    except Exception:
        pass
    return xuid, name


def item_id(stack):
    try:
        return str(getattr(stack.type, "id", stack.type))
    except Exception:
        return ""


class Penguins:
    def __init__(self, plugin):
        self.plugin = plugin
        self.powers = {}   # player uuid -> {power name: (color, until time, perks)}
        self.graced = {}   # player uuid -> "water" or "ice" while they have Penguin's Grace
        self.penguins_of = {}   # owner xuid -> where their penguins were last seen [(dimension, x, y, z)]
        self.ticks = 0
        self.hud = {}   # player uuid -> the power/grace/pointer line shown under the money display
        self.add_crate_prizes()

    # ---------- crates ----------
    def add_crate_prizes(self):
        """Once: add the penguin and chips to the Galaxy Crate as super rare prizes."""
        try:
            eco = self.plugin.economy
            if eco.get_config("penguins_crate_added"):
                return
            crates = getattr(self.plugin, "crates", None)
            if crates is None:
                return
            have = {p.get("item") for p in crates.rewards.get("galaxy", [])}
            for p in CRATE_PRIZES:
                if p["item"] not in have:
                    crates.rewards.setdefault("galaxy", []).append(dict(p))
            crates.save()
            eco.set_config("penguins_crate_added", True)
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't add penguins to the Galaxy Crate: {e}")

    # ---------- penguins ----------
    def on_interact_actor(self, event):
        """Taming and ownership. Returns True when it handled the event."""
        actor = event.actor
        kind = type_of(actor)
        if kind not in OWNABLE:
            return False
        what, food = OWNABLE[kind]
        player = event.player
        owner, owner_name = owner_of(actor)
        if owner is None:
            held = player.inventory.item_in_main_hand
            if held is not None and item_id(held) in food:
                # the first player to feed it tames it (the add-on tames it on the same tap)
                self.claim(actor, player)
                self.hearts(actor)
                pets = getattr(self.plugin, "pets", None)
                if pets is not None:
                    pets.remember(actor, player.xuid, what)
                    pets.ask_name(player, actor, what)   # "What would you like to name your Dumpling?"
            return False
        if owner != str(player.xuid) and not player.is_op:
            event.is_cancelled = True
            player.send_message(f"§cThis {what.lower()} belongs to {owner_name or 'someone else'}.")
            return True
        pets = getattr(self.plugin, "pets", None)
        if pets is not None and pets.on_owner_tap(player, actor, kind):
            event.is_cancelled = True
            return True
        return False

    @staticmethod
    def claim(actor, player):
        try:
            actor.add_scoreboard_tag(OWNER_TAG + str(player.xuid))
            actor.add_scoreboard_tag(NAME_TAG + player.name.replace(" ", "_"))
        except Exception:
            pass

    def hud_line(self, p):
        return self.hud.get(str(p.unique_id), "")

    # ---------- pets wait outside spawn (mobs don't survive in spawn) ----------
    def spawns(self):
        plots = getattr(getattr(self.plugin, "plots", None), "plots", None) or {}
        return [a for a in plots.values() if a.get("kind") == "area" and "spawn" in str(a.get("name") or "").lower()]

    @staticmethod
    def inside(area, dim, x, z, pad=0.0):
        return area["dim"] == dim and area["x1"] - pad <= x < area["x2"] + 1 + pad and area["z1"] - pad <= z < area["z2"] + 1 + pad

    @staticmethod
    def outside_spot(area, x, z, margin=4):
        """The nearest spot just outside the area's edge."""
        sides = [(x - area["x1"], area["x1"] - margin, z), (area["x2"] + 1 - x, area["x2"] + 1 + margin, z),
                 (z - area["z1"], x, area["z1"] - margin), (area["z2"] + 1 - z, x, area["z2"] + 1 + margin)]
        _, nx, nz = min(sides, key=lambda s: s[0])
        return nx, nz

    def keep_pets_out(self):
        """Tamed-type mobs (wolves, cats, parrots, horses, penguins...) that reach the edge of spawn are moved back
        a few blocks outside, so they wait there instead of following their owner in and dying."""
        spawns = self.spawns()
        if not spawns:
            return
        from endstone.level import Location
        for dim in self.plugin.server.level.dimensions:
            here = [a for a in spawns if a["dim"] == dim.name]
            if not here:
                continue
            try:
                actors = dim.actors
            except Exception:
                continue
            for a in actors:
                if type_of(a) not in PETS:
                    continue
                l = a.location
                for area in here:
                    if self.inside(area, dim.name, l.x, l.z, EDGE):
                        nx, nz = self.outside_spot(area, l.x, l.z)
                        try:
                            y = dim.get_highest_block_y_at(int(nx // 1), int(nz // 1)) + 1
                        except Exception:
                            y = l.y
                        try:
                            a.teleport(Location(dim, nx, y, nz))
                        except Exception:
                            pass
                        break

    def on_teleport(self, event):
        """A pet can't teleport to its owner inside spawn (it waits outside)."""
        try:
            if type_of(event.actor) not in PETS:
                return False
            to = event.to_location
            if any(self.inside(area, to.dimension.name, to.x, to.z, EDGE) for area in self.spawns()):
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False

    def hearts(self, actor):
        """Hearts float up from a penguin when it's tamed (like taming a wolf or a cat)."""
        try:
            from endstone_galaxylink.floating import dim_cmd
            l = actor.location
            where = dim_cmd(actor.dimension.name)
            server = self.plugin.server
            for i, (dx, dz) in enumerate(((0, 0), (0.3, 0.2), (-0.3, -0.1), (0.1, -0.3), (-0.2, 0.3), (0.25, -0.25), (-0.1, 0.1))):
                server.dispatch_command(server.command_sender,
                    f"execute in {where} run particle minecraft:heart_particle {l.x + dx:.2f} {l.y + 1.0 + (i % 3) * 0.3:.2f} {l.z + dz:.2f}")
        except Exception:
            pass

    # ---------- damage: penguin protection and chip powers ----------
    def on_damage(self, event):
        """Nobody but its owner can hurt a tamed penguin, and chip powers change damage.
        Returns True when it cancelled the damage."""
        pets = getattr(self.plugin, "pets", None)
        if pets is not None and pets.on_damage(event):   # no fall damage after a dumpling bounce
            return True
        try:
            victim = event.actor
            attacker = event.damage_source.actor
            kind = str(event.damage_source.type)
        except Exception:
            return False
        if type_of(victim) in OWNABLE:
            owner, _ = owner_of(victim)
            if owner and attacker is not None and hasattr(attacker, "xuid") and str(attacker.xuid) != owner:
                event.is_cancelled = True
                return True
            return False
        try:
            mine = self.perks(victim) if hasattr(victim, "xuid") else {}
            if mine:
                if (mine.get("nofall") and "fall" in kind) or \
                   (mine.get("fireproof") and any(k in kind for k in ("fire", "lava", "magma"))) or \
                   (mine.get("waterproof") and "drown" in kind):
                    event.is_cancelled = True
                    return True
                if mine.get("resist"):
                    event.damage = float(event.damage) * (1 - mine["resist"])
            if attacker is not None and hasattr(attacker, "xuid") and any(k in kind for k in ("attack", "projectile")):
                theirs = self.perks(attacker)
                if theirs.get("strength"):
                    event.damage = float(event.damage) * (1 + theirs["strength"])
        except Exception:
            pass
        return False

    def perks(self, player, now=None):
        """A player's chip perks right now (several powers at once: the strongest of each)."""
        now = now or time.time()
        out = {}
        for power, (color, until, perks) in (self.powers.get(str(player.unique_id)) or {}).items():
            if until <= now:
                continue
            for k, v in perks.items():
                out[k] = max(out.get(k, 0), v) if not isinstance(v, bool) else (out.get(k) or v)
        grace = self.graced.get(str(player.unique_id))
        if grace == "water":
            out["speed"] = max(out.get("speed", 0), 0.6)
            out["waterproof"] = True
        elif grace == "ice":
            out["speed"] = max(out.get("speed", 0), 1.0)
        return out

    def in_minigame(self, p):
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        try:
            return (bw is not None and bw.playing(p)) or (bc is not None and bc.building(p))
        except Exception:
            return False

    def apply_body(self, p, mine):
        """Extra hearts (only changed when they need to be). Speed is a hidden Speed effect (see speed_boost):
        changing a player's walking speed directly also changes how zoomed-in their view is, so it's never used."""
        try:
            want = 20 + 2 * int(mine.get("hearts", 0))
            if int(p.max_health) != want:
                p.max_health = want
                if p.health > want:
                    p.health = want
        except Exception:
            pass

    def speed_boost(self, p, speed):
        """Faster walking from a chip power or Penguin's Grace: a short Speed effect (no particles), refreshed while it lasts."""
        amp = 0 if speed < 0.5 else 1 if speed < 0.9 else 2
        name = p.name.replace('"', "")
        try:
            self.plugin.server.dispatch_command(self.plugin.server.command_sender, f'effect "{name}" speed 2 {amp} true')
        except Exception:
            pass

    def on_join(self, p):
        """Back to normal hearts (a power may have been on when the server restarted), and normal walking speed for
        anyone an older version slowed down."""
        self.apply_body(p, self.perks(p))
        try:
            if abs(float(p.walk_speed) - WALK) > 0.001:
                p.walk_speed = WALK
        except Exception:
            pass
        # a 1-second Speed effect makes the game send the player's movement speed again, which fixes a zoomed-in view
        self.speed_boost(p, 0.1)

    def on_quit(self, p):
        self.apply_body(p, {})
        self.graced.pop(str(p.unique_id), None)

    def tick(self):
        """Every half second: Penguin's Grace, chip powers (speed, hearts, healing), what you see while a power is on
        (a line above the hotbar with each power's name and time left, and particles around you), and a pointer to your
        penguin when it's lost."""
        self.ticks += 1
        server = self.plugin.server
        if self.ticks % 4 == 1:   # every 2 seconds is plenty (it looks through every entity, which is slow)
            try:
                self.keep_pets_out()
            except Exception:
                pass
        if self.ticks % 2 == 0:
            self.graced = self.grace_check()
        now = time.time()
        for p in server.online_players:
            uid = str(p.unique_id)
            mine = {k: v for k, v in (self.powers.get(uid) or {}).items() if v[1] > now}
            if mine and self.in_minigame(p):
                mine = {}
                p.send_message("§7Your chip power ended because you joined a minigame.")
            if mine:
                self.powers[uid] = mine
            else:
                self.powers.pop(uid, None)
            perks = self.perks(p, now)
            self.apply_body(p, perks)
            if perks.get("speed") and self.ticks % 2 == 0:
                self.speed_boost(p, perks["speed"])
            if perks.get("regen") and self.ticks % 4 == 0:
                try:
                    if 0 < p.health < p.max_health:
                        p.health = min(p.max_health, p.health + int(perks["regen"]))
                except Exception:
                    pass
            grace = self.graced.get(uid)
            pointer = self.pointer(p)
            if not mine and not grace and not pointer:
                self.hud.pop(uid, None)
                continue
            parts = [f"{v[0]}§l{k}§r §7{int((v[1] - now) // 60)}:{int((v[1] - now) % 60):02d}" for k, v in mine.items()]
            if grace:
                parts.append("§b§lPenguin's Grace")
            if pointer:
                parts.append(pointer)
            self.hud[uid] = "  ".join(parts)   # shown under your money above the hotbar (economy.py)
            # particles around you (everyone nearby sees them)
            looks = [LOOKS[k][1] for k in mine] + ([GRACE_LOOK[1]] if grace else [])
            if not looks:
                continue
            try:
                from endstone_galaxylink.floating import dim_cmd
                import random
                l = p.location
                where = dim_cmd(p.dimension.name)
                for names in looks:
                    for _ in range(2):
                        part = random.choice(names)
                        server.dispatch_command(server.command_sender,
                            f"execute in {where} run particle {part} {l.x + random.uniform(-0.6, 0.6):.2f} {l.y + random.uniform(0.2, 1.9):.2f} {l.z + random.uniform(-0.6, 0.6):.2f}")
            except Exception:
                pass

    def pointer(self, p):
        """When your penguin is more than 16 blocks away: a penguin icon, an arrow toward it and how far it is.
        Only you see it."""
        spots = self.penguins_of.get(str(p.xuid))
        if not spots:
            return ""
        try:
            l = p.location
            dname = p.dimension.name
        except Exception:
            return ""
        here = [s for s in spots if s[0] == dname]
        if not here:
            return f"§b{ICON} §7Your penguin is in another dimension"
        d, x, y, z = min(here, key=lambda s: (s[1] - l.x) ** 2 + (s[3] - l.z) ** 2)
        dist = ((x - l.x) ** 2 + (y - l.y) ** 2 + (z - l.z) ** 2) ** 0.5
        if dist <= GRACE_RANGE:
            return ""
        return f"§b{ICON} {arrow(x - l.x, z - l.z, getattr(l, 'yaw', 0))} §f{int(dist)} blocks"

    def grace_check(self):
        """Finds every tamed penguin, and gives Penguin's Grace to owners whose penguin is within 16 blocks and who
        are in water or on ice. Returns {uuid: "water" or "ice"}."""
        level = self.plugin.server.level
        near = {}   # owner xuid -> list of (dim, x, y, z)
        for dim in level.dimensions:
            try:
                actors = dim.actors
            except Exception:
                continue
            for a in actors:
                if type_of(a) != PENGUIN:
                    continue
                owner, _ = owner_of(a)
                if owner:
                    l = a.location
                    near.setdefault(owner, []).append((dim.name, l.x, l.y, l.z))
        # remember where each owner's penguins were last seen (for the pointer), even when its area isn't loaded
        for owner, spots in near.items():
            self.penguins_of[owner] = spots
        # a penguin that's gone (it died) while its owner stands next to where it was: forget it
        for p in self.plugin.server.online_players:
            x = str(p.xuid)
            if x in near or x not in self.penguins_of:
                continue
            try:
                l, dname = p.location, p.dimension.name
                self.penguins_of[x] = [s for s in self.penguins_of[x]
                                       if not (s[0] == dname and (s[1] - l.x) ** 2 + (s[3] - l.z) ** 2 < 32 ** 2)]
                if not self.penguins_of[x]:
                    del self.penguins_of[x]
            except Exception:
                pass
        out = {}
        if not near:
            return out
        for p in self.plugin.server.online_players:
            spots = near.get(str(p.xuid))
            if not spots:
                continue
            l = p.location
            dname = p.dimension.name
            if not any(d == dname and (x - l.x) ** 2 + (y - l.y) ** 2 + (z - l.z) ** 2 <= GRACE_RANGE ** 2 for d, x, y, z in spots):
                continue
            try:
                if p.is_in_water or "water" in self.block(p, 0):
                    out[str(p.unique_id)] = "water"
                elif "ice" in self.block(p, -1):
                    out[str(p.unique_id)] = "ice"
            except Exception:
                continue
        return out

    @staticmethod
    def block(p, dy):
        l = p.location
        return str(p.dimension.get_block_at(int(l.x // 1), int(l.y // 1) + dy, int(l.z // 1)).type)

    # ---------- potato chips ----------
    def on_consume(self, event):
        chip = CHIPS.get(item_id(event.item))
        if not chip:
            return False
        player = event.player
        if self.in_minigame(player):
            event.is_cancelled = True
            player.send_message("§cPotato chips can't be eaten during a minigame. Save them for later!")
            return True
        power, color, secs, perks, desc = chip
        server = self.plugin.server
        name = player.name.replace('"', "")

        def apply():
            p = server.get_player(player.unique_id)
            if p is None:
                return
            self.powers.setdefault(str(p.unique_id), {})[power] = (color, time.time() + secs, perks)
            mine = self.perks(p)
            self.apply_body(p, mine)
            if mine.get("hearts"):
                try:
                    p.health = p.max_health
                except Exception:
                    pass
            try:
                server.dispatch_command(server.command_sender, f'title "{name}" times 5 40 10')
                server.dispatch_command(server.command_sender, f'title "{name}" subtitle §7{power} activated!')
                server.dispatch_command(server.command_sender, f'title "{name}" title {color}§l{power}!')
                p.play_sound(p.location, "random.levelup", 1.0, 1.4)
            except Exception:
                pass
            p.send_message(f"{color}§l{power}!§r §7{desc}.")
        server.scheduler.run_task(self.plugin, apply, delay=1)   # after the food itself is eaten
        return False


ICON = ""   # penguin icon (resource pack, glyph_F7.png)
ARROWS = ["", "", "", "", "", "", "", ""]   # ahead, ahead-right, right ... ahead-left


def arrow(dx, dz, yaw):
    """Arrow from where you're looking toward (dx, dz). Minecraft yaw: 0 = south (+z), 90 = west (-x)."""
    import math
    target = math.degrees(math.atan2(-dx, dz))
    rel = (target - float(yaw)) % 360
    return ARROWS[int((rel + 22.5) // 45) % 8]
