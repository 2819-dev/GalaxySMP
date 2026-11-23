"""Penguins and Potato Chips (from the GalaxySMP add-on packs).

Penguins (galaxysmp:penguin): tamed with fish. The first player to tame one owns it for good: nobody else can feed,
sit, leash, name or hurt it. A tamed penguin follows its owner and fights monsters and anyone who attacks them.
While your own penguin is within 16 blocks you get Penguin's Grace: fast swimming in water and even faster on ice.

Potato Chips (galaxysmp:chips_*): four flavors, each with a strong custom-named power when eaten.

Both come from staff (/give) or as super rare Galaxy Crate prizes, and both can be traded and sold.
"""

import time

PENGUIN = "galaxysmp:penguin"
FISH = ("minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:cooked_cod", "minecraft:cooked_salmon")
OWNER_TAG = "gsmp_owner_"      # + xuid
NAME_TAG = "gsmp_ownername_"   # + gamertag (spaces as _)
GRACE_RANGE = 16

# flavor -> (power name, color, [(effect, seconds, amplifier)], description)
CHIPS = {
    "galaxysmp:chips_classic": ("Potato Power", "§6", [("strength", 180, 2), ("resistance", 180, 1), ("regeneration", 180, 1), ("absorption", 180, 3)],
                                "Strength III, Resistance II, Regeneration II and 8 extra hearts for 3 minutes"),
    "galaxysmp:chips_spicy": ("Fire Crunch", "§c", [("strength", 180, 3), ("fire_resistance", 180, 0), ("speed", 180, 1)],
                              "Strength IV, Fire Resistance and Speed II for 3 minutes"),
    "galaxysmp:chips_sour": ("Sour Rush", "§a", [("speed", 300, 2), ("haste", 300, 2), ("jump_boost", 300, 1)],
                             "Speed III, Haste III and Jump Boost II for 5 minutes"),
    "galaxysmp:chips_galaxy": ("Cosmic Crunch", "§d", [("strength", 300, 2), ("resistance", 300, 2), ("regeneration", 300, 2), ("speed", 300, 1),
                                                     ("haste", 300, 1), ("fire_resistance", 300, 0), ("water_breathing", 300, 0),
                                                     ("night_vision", 300, 0), ("health_boost", 300, 4), ("absorption", 300, 4)],
                               "Everything at once: Strength III, Resistance III, Regeneration III, Speed II, Haste II, Fire Resistance, "
                               "Water Breathing, Night Vision and 20 extra hearts for 5 minutes"),
}

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
        self.powers = {}   # player uuid -> {power name: (color, until time)}
        self.graced = set()   # players with Penguin's Grace right now
        self.ticks = 0
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
        if type_of(actor) != PENGUIN:
            return False
        player = event.player
        owner, owner_name = owner_of(actor)
        if owner is None:
            held = player.inventory.item_in_main_hand
            if held is not None and item_id(held) in FISH:
                # the first player to feed it fish tames it (the add-on tames it on the same tap)
                try:
                    actor.add_scoreboard_tag(OWNER_TAG + str(player.xuid))
                    actor.add_scoreboard_tag(NAME_TAG + player.name.replace(" ", "_"))
                except Exception:
                    pass
                self.hearts(actor)
            return False
        if owner != str(player.xuid) and not player.is_op:
            event.is_cancelled = True
            player.send_message(f"§cThis penguin belongs to {owner_name or 'someone else'}.")
            return True
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

    def on_damage(self, event):
        """Nobody but its owner can hurt a tamed penguin. Returns True when it cancelled the damage."""
        try:
            victim = event.actor
            if type_of(victim) != PENGUIN:
                return False
            owner, _ = owner_of(victim)
            attacker = event.damage_source.actor
        except Exception:
            return False
        if owner and attacker is not None and hasattr(attacker, "xuid") and str(attacker.xuid) != owner:
            event.is_cancelled = True
            return True
        return False

    def tick(self):
        """Every half second: Penguin's Grace for owners whose penguin is close, and what you see while a power is on
        (a line above the hotbar with each power's name and time left, and particles around you)."""
        self.ticks += 1
        server = self.plugin.server
        if self.ticks % 2 == 0:
            self.graced = self.grace_check()
        now = time.time()
        for p in server.online_players:
            uid = str(p.unique_id)
            mine = {k: v for k, v in (self.powers.get(uid) or {}).items() if v[1] > now}
            if mine:
                self.powers[uid] = mine
            else:
                self.powers.pop(uid, None)
            grace = uid in self.graced
            if not mine and not grace:
                continue
            parts = [f"{v[0]}§l{k}§r §7{int((v[1] - now) // 60)}:{int((v[1] - now) % 60):02d}" for k, v in mine.items()]
            if grace:
                parts.append("§b§lPenguin's Grace")
            try:
                p.send_tip("  ".join(parts))
            except Exception:
                pass
            # particles around you (everyone nearby sees them)
            looks = [LOOKS[k][1] for k in mine] + ([GRACE_LOOK[1]] if grace else [])
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

    def grace_check(self):
        """Gives Penguin's Grace to owners whose penguin is within 16 blocks. Returns their uuids."""
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
        out = set()
        if not near:
            return out
        server = self.plugin.server
        for p in server.online_players:
            spots = near.get(str(p.xuid))
            if not spots:
                continue
            l = p.location
            dname = p.dimension.name
            if not any(d == dname and (x - l.x) ** 2 + (y - l.y) ** 2 + (z - l.z) ** 2 <= GRACE_RANGE ** 2 for d, x, y, z in spots):
                continue
            name = p.name.replace('"', "")
            try:
                if p.is_in_water:
                    server.dispatch_command(server.command_sender, f'effect "{name}" dolphins_grace 3 0 true')
                    server.dispatch_command(server.command_sender, f'effect "{name}" speed 3 1 true')
                    out.add(str(p.unique_id))
                else:
                    below = str(p.dimension.get_block_at(int(l.x // 1), int(l.y // 1) - 1, int(l.z // 1)).type)
                    if "ice" in below:
                        server.dispatch_command(server.command_sender, f'effect "{name}" speed 3 4 true')
                        out.add(str(p.unique_id))
            except Exception:
                continue
        return out

    # ---------- potato chips ----------
    def on_consume(self, event):
        chip = CHIPS.get(item_id(event.item))
        if not chip:
            return False
        player = event.player
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        if (bw is not None and bw.playing(player)) or (bc is not None and bc.building(player)):
            event.is_cancelled = True
            player.send_message("§cPotato chips can't be eaten during a minigame. Save them for later!")
            return True
        power, color, effects, desc = chip
        server = self.plugin.server
        name = player.name.replace('"', "")

        def apply():
            p = server.get_player(player.unique_id)
            if p is None:
                return
            for effect, secs, amp in effects:
                server.dispatch_command(server.command_sender, f'effect "{name}" {effect} {secs} {amp} true')
            try:
                server.dispatch_command(server.command_sender, f'title "{name}" times 5 40 10')
                server.dispatch_command(server.command_sender, f'title "{name}" subtitle §7{power} activated!')
                server.dispatch_command(server.command_sender, f'title "{name}" title {color}§l{power}!')
                p.play_sound(p.location, "random.levelup", 1.0, 1.4)
            except Exception:
                pass
            p.send_message(f"{color}§l{power}!§r §7{desc}.")
            secs = max(s for _, s, _ in effects)
            self.powers.setdefault(str(p.unique_id), {})[power] = (color, time.time() + secs)
        server.scheduler.run_task(self.plugin, apply, delay=1)   # after the food itself is eaten
        return False
