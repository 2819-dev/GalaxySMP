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
        self.graced = {}   # player uuid -> last time Penguin's Grace was shown (to avoid spamming the tip)
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
                player.send_message("§b🐧 You tamed a penguin! §7It follows you and fights for you. Keep it close for §bPenguin's Grace§7.")
            return False
        if owner != str(player.xuid) and not player.is_op:
            event.is_cancelled = True
            player.send_message(f"§cThis penguin belongs to {owner_name or 'someone else'}.")
            return True
        return False

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
        """Every second: Penguin's Grace for owners whose penguin is close."""
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
        if not near:
            return
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
            boost = None
            try:
                if p.is_in_water:
                    boost = "water"
                    server.dispatch_command(server.command_sender, f'effect "{name}" dolphins_grace 3 0 true')
                    server.dispatch_command(server.command_sender, f'effect "{name}" speed 3 1 true')
                else:
                    below = str(p.dimension.get_block_at(int(l.x // 1), int(l.y // 1) - 1, int(l.z // 1)).type)
                    if "ice" in below:
                        boost = "ice"
                        server.dispatch_command(server.command_sender, f'effect "{name}" speed 3 4 true')
            except Exception:
                continue
            if boost:
                try:
                    p.send_tip("§b🐧 Penguin's Grace §7· " + ("swimming fast" if boost == "water" else "sliding fast on ice"))
                except Exception:
                    pass

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
        server.scheduler.run_task(self.plugin, apply, delay=1)   # after the food itself is eaten
        return False
