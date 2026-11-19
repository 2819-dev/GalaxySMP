"""Cosmetics and Store effects.

/cosmetics  pick a particle trail and switch join effects on or off.
Owned cosmetics come from the website (bought in the Store or given by admins) plus the ones a
plan includes (plans.json "cosmetics"). Night Vision bought in the Store is kept on until it ends.
"""

import json
import time

from endstone_galaxylink.safety import later
from endstone.form import ActionForm, ModalForm, TextInput, Toggle

TRAILS = {
    "trail_hearts": ("Hearts", "minecraft:heart_particle", "textures/items/apple_golden"),
    "trail_flames": ("Flames", "minecraft:basic_flame_particle", "textures/items/blaze_powder"),
    "trail_notes": ("Music Notes", "minecraft:note_particle", "textures/items/record_cat"),
    "trail_stars": ("Starlight", "minecraft:endrod", "textures/items/end_crystal"),
    "trail_soul": ("Soul Fire", "minecraft:soul_particle", "textures/items/soul_campfire"),
    "trail_cherry": ("Cherry Blossom", "minecraft:cherry_leaves_particle", "textures/blocks/cherry_leaves"),
    "trail_sparkle": ("Sparkle", "minecraft:villager_happy", "textures/items/emerald"),
    "trail_galaxy": ("Galaxy", "minecraft:obsidian_glow_dust_particle", "textures/items/nether_star"),
}
JOIN = {
    "join_firework": "Firework when you join",
    "join_sound": "Chime for everyone when you join",
    "join_message": "Your own join message",
}
# Bedwars effects: (name, how to get it). Unlocked in the Store, the Season Pass or by winning games.
BW_WIN = {
    "bw_win_fireworks": "Firework Show",
    "bw_win_lightning": "Thunder Strike",
    "bw_win_rainbow": "Rainbow Burst",
    "bw_win_dragon": "Dragon Roar",
}
BW_KILL = {
    "bw_kill_hearts": "Hearts",
    "bw_kill_lightning": "Lightning",
    "bw_kill_smoke": "Puff of Smoke",
    "bw_kill_notes": "Music Notes",
}
WIN_EARNED = {"bw_win_fireworks": 10, "bw_kill_hearts": 25, "bw_win_lightning": 50}  # unlocked by Bedwars wins
TRAIL_TICKS = 4
VIEW = 48  # blocks: how far away others see your trail


class Cosmetics:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.owned = self.eco.get_config("cosmetics_owned") or {}       # xuid -> [ids] (from the website)
        self.night = self.eco.get_config("night_vision") or {}          # xuid -> epoch seconds it ends
        self.choice = self.eco.get_config("cosmetics_choice") or {}     # xuid -> {"trail", "firework", "sound", "message"}
        self.last = {}  # xuid -> (x, y, z) last trail position
        self._nv_ticks = 0

    # ---------- from the website ----------
    def update(self, cosmetics, night):
        if isinstance(cosmetics, dict):
            self.owned = {str(k): [str(x) for x in v][:50] for k, v in cosmetics.items() if isinstance(v, list)}
            self.eco.set_config("cosmetics_owned", self.owned)
        if isinstance(night, dict):
            self.night = {str(k): float(v) for k, v in night.items() if v}
            self.eco.set_config("night_vision", self.night)
            self.apply_night_vision()

    # ---------- what a player has ----------
    # ---------- Bedwars effects ----------
    def bw_owned(self, player):
        owned = set(self.owned.get(str(player.xuid), []))
        prog = getattr(self.plugin, "progress", None)
        wins = 0
        if prog is not None:
            try:
                wins = prog.stats(player).get("bw_wins", 0)
            except Exception:
                wins = 0
        owned |= {cid for cid, need in WIN_EARNED.items() if wins >= need}
        if player.is_op:
            owned |= set(BW_WIN) | set(BW_KILL)
        return owned

    def bw_effect(self, player, kind, loc):
        """Plays this player's chosen Bedwars effect (kind "win" or "kill") at loc."""
        cfg = self.settings(player)
        cid = cfg.get("bw_win" if kind == "win" else "bw_kill")
        if not cid or cid not in self.bw_owned(player):
            return
        dim = player.dimension.name.lower()
        where = "nether" if "nether" in dim else "the_end" if "end" in dim else "overworld"
        x, y, z = f"{loc.x:.1f}", f"{loc.y:.1f}", f"{loc.z:.1f}"
        run = lambda c: self.plugin.server.dispatch_command(self.plugin.server.command_sender, f"execute in {where} run {c}")
        if cid == "bw_win_fireworks":
            for dx, dz in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                run(f"summon fireworks_rocket {loc.x + dx:.1f} {y} {loc.z + dz:.1f}")
        elif cid in ("bw_win_lightning", "bw_kill_lightning"):
            run(f"particle minecraft:electric_spark_particle {x} {float(y) + 1:.1f} {z}")
            run(f"playsound ambient.weather.thunder @a[x={x},y={y},z={z},r=24] {x} {y} {z} 0.6 1.2")
            for i in range(6):
                run(f"particle minecraft:electric_spark_particle {x} {float(y) + i * 0.5:.1f} {z}")
        elif cid == "bw_win_rainbow":
            for p in ("minecraft:totem_particle", "minecraft:villager_happy", "minecraft:endrod"):
                run(f"particle {p} {x} {float(y) + 1:.1f} {z}")
            run(f"playsound random.totem @a[x={x},y={y},z={z},r=24] {x} {y} {z} 0.5 1.0")
        elif cid == "bw_win_dragon":
            run(f"particle minecraft:dragon_breath_trail {x} {float(y) + 1:.1f} {z}")
            run(f"playsound mob.enderdragon.growl @a[x={x},y={y},z={z},r=32] {x} {y} {z} 0.5 1.0")
        elif cid == "bw_kill_hearts":
            for i in range(3):
                run(f"particle minecraft:heart_particle {x} {float(y) + 1 + i * 0.4:.1f} {z}")
        elif cid == "bw_kill_smoke":
            run(f"particle minecraft:large_explosion {x} {float(y) + 1:.1f} {z}")
        elif cid == "bw_kill_notes":
            for i in range(3):
                run(f"particle minecraft:note_particle {x} {float(y) + 1.5 + i * 0.3:.1f} {z}")

    def bw_menu(self, player):
        owned = self.bw_owned(player)
        cfg = self.settings(player)
        form = ActionForm(title="§l§cBedwars effects", content=(
            "§7Victory effects play when your team wins; kill effects when you knock someone out.\n"
            "§7Get more in the Store, the Season Pass, or by winning Bedwars games (10, 25 and 50 wins)."))
        for kind, table, key in (("Victory", BW_WIN, "bw_win"), ("Kill", BW_KILL, "bw_kill")):
            for cid, name in table.items():
                if cid in owned:
                    on = cfg.get(key) == cid
                    form.add_button(f"§l{kind}: {name}§r\n{'§aSelected' if on else '§8Tap to use'}", on_click=lambda p, k=key, c=cid: self.bw_pick(p, k, c))
                else:
                    need = WIN_EARNED.get(cid)
                    form.add_button(f"§7{kind}: {name}§r\n§8{f'Win {need} Bedwars games' if need else 'Store or Season Pass'}", on_click=self.bw_menu)
        form.add_button("§lNo effects", on_click=lambda p: self.bw_pick(p, None, None))
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def bw_pick(self, player, key, cid):
        cfg = self.settings(player)
        if key is None:
            cfg.pop("bw_win", None)
            cfg.pop("bw_kill", None)
        else:
            cfg[key] = cid
        self.save()
        player.send_message("§aBedwars effects saved.")
        self.bw_menu(player)

    def has(self, player):
        items = set(self.owned.get(str(player.xuid), []))
        plans = getattr(self.plugin, "plans", None)
        if plans:
            items.update(plans.plan_for(player).get("cosmetics", []))
        if player.is_op:
            items.update(TRAILS)
            items.update(JOIN)
        return items

    def settings(self, player):
        return self.choice.setdefault(str(player.xuid), {"trail": None, "firework": True, "sound": True, "message": ""})

    def save(self):
        self.eco.set_config("cosmetics_choice", self.choice)

    # ---------- /cosmetics ----------
    def menu(self, player):
        if not hasattr(player, "xuid"):
            return player.send_message("Only players can use /cosmetics.")
        mine = self.has(player)
        s = self.settings(player)
        trail = TRAILS.get(s.get("trail") or "", (None,))[0]
        nv = self.night.get(str(player.xuid), 0)
        lines = [f"Trail: §l{trail or 'off'}§r"]
        if nv > time.time():
            left = int(nv - time.time())
            lines.append(f"Night Vision: §a{left // 86400}d {left % 86400 // 3600}h left")
        if not mine:
            lines.append("\n§7You don't have any cosmetics yet. Get trails and join effects at galaxymc.us/store "
                         "(Galaxy+ and Pro+ include some).")
        form = ActionForm(title="§l§dCosmetics", content="\n".join(lines))
        for cid, (name, _, icon) in TRAILS.items():
            if cid in mine:
                on = s.get("trail") == cid
                form.add_button(f"{'§a✔ ' if on else ''}§l{name} trail§r\n§8{'Tap to turn off' if on else 'Tap to use'}", icon=icon,
                                on_click=lambda p, c=cid: self.pick_trail(p, c))
        if any(j in mine for j in JOIN):
            form.add_button("§lJoin effects§r\n§8Firework, chime, message", icon="textures/items/fireworks", on_click=self.join_form)
        form.add_button("§lBedwars effects§r\n§8Victory and kill effects", icon="textures/items/bed_red", on_click=self.bw_menu)
        form.add_button("Close")
        player.send_form(form)

    def pick_trail(self, player, cid):
        if cid not in self.has(player):
            return player.send_message("§cYou don't have that trail. Get it at galaxymc.us/store.")
        s = self.settings(player)
        s["trail"] = None if s.get("trail") == cid else cid
        self.save()
        player.send_message(f"§dTrail: §f{TRAILS[s['trail']][0] if s['trail'] else 'off'}")

    def join_form(self, player):
        mine = self.has(player)
        s = self.settings(player)
        controls = []
        keys = []
        if "join_firework" in mine:
            controls.append(Toggle(JOIN["join_firework"], bool(s.get("firework", True))))
            keys.append("firework")
        if "join_sound" in mine:
            controls.append(Toggle(JOIN["join_sound"], bool(s.get("sound", True))))
            keys.append("sound")
        if "join_message" in mine:
            controls.append(TextInput("Join message (shown after your name, e.g. 'has entered the galaxy!')",
                                      "has entered the galaxy!", s.get("message") or ""))
            keys.append("message")

        def submit(p, data):
            values = json.loads(data) if isinstance(data, str) else data
            for k, v in zip(keys, values):
                if k == "message":
                    text = " ".join(str(v or "").split())[:60]
                    cf = getattr(self.plugin, "chatfilter", None)
                    if text and cf and cf.bad_spans(text):
                        p.send_message("§cThat message isn't allowed.")
                        continue
                    s["message"] = text.replace("§", "")
                else:
                    s[k] = bool(v)
            self.save()
            p.send_message("§aJoin effects saved.")

        player.send_form(ModalForm(title="§lJoin effects", controls=controls, on_submit=submit))

    # ---------- joining ----------
    def on_join(self, player):
        mine = self.has(player)
        s = self.settings(player)
        if s.get("trail") and s["trail"] not in mine:  # e.g. their plan ended
            s["trail"] = None
        if "join_message" in mine and s.get("message"):
            for p in self.plugin.server.online_players:
                p.send_message(f"§d✦ §f{player.name}§d {s['message']}")
        if "join_sound" in mine and s.get("sound", True):
            for p in self.plugin.server.online_players:
                try:
                    p.play_sound(p.location, "random.levelup", 0.6, 1.4)
                except Exception:
                    pass
        if "join_firework" in mine and s.get("firework", True):
            later(self.plugin, player, self.firework, 40)
        if self.night.get(str(player.xuid), 0) > time.time():
            later(self.plugin, player, self.night_vision_for, 40)

    def firework(self, player):
        try:
            if not player.is_valid:
                return
        except Exception:
            pass
        name = player.name.replace('"', "")
        server = self.plugin.server
        server.dispatch_command(server.command_sender, f'execute as "{name}" at @s run summon fireworks_rocket ~ ~1 ~')
        l = player.location
        for p in server.online_players:
            try:
                if p.dimension.name == player.dimension.name:
                    for dy in (1.0, 1.6, 2.2):
                        p.spawn_particle("minecraft:totem_particle", l.x, l.y + dy, l.z)
                    p.play_sound(l, "firework.launch", 1.0, 1.0)
            except Exception:
                pass

    # ---------- Night Vision ----------
    def night_vision_for(self, player):
        until = self.night.get(str(player.xuid), 0)
        left = int(until - time.time())
        if left <= 0:
            return
        name = player.name.replace('"', "")
        secs = min(left, 60)
        self.plugin.server.dispatch_command(self.plugin.server.command_sender, f'effect "{name}" night_vision {secs} 0 true')

    def apply_night_vision(self):
        now = time.time()
        for p in self.plugin.server.online_players:
            until = self.night.get(str(p.xuid), 0)
            if until > now:
                self.night_vision_for(p)
            elif until and now - until < 120:  # just ended
                self.plugin.server.dispatch_command(self.plugin.server.command_sender, f'effect "{p.name.replace(chr(34), "")}" clear')
                p.send_message("§7Your Night Vision has ended. Get more at galaxymc.us/store.")
                self.night.pop(str(p.xuid), None)
                self.eco.set_config("night_vision", self.night)

    # ---------- every 4 ticks: trails; every 30 s: Night Vision ----------
    def tick(self):
        self._nv_ticks += TRAIL_TICKS
        if self._nv_ticks >= 600:
            self._nv_ticks = 0
            self.apply_night_vision()
        players = list(self.plugin.server.online_players)
        if not players or not self.choice:
            return
        for p in players:
            s = self.choice.get(str(p.xuid))
            if not s or not s.get("trail"):
                continue
            trail = TRAILS.get(s["trail"])
            if not trail:
                continue
            l = p.location
            pos = (round(l.x, 1), round(l.y, 1), round(l.z, 1))
            if self.last.get(str(p.xuid)) == pos:  # only while moving
                continue
            self.last[str(p.xuid)] = pos
            if s["trail"] not in self.has(p):
                s["trail"] = None
                continue
            dim = p.dimension.name
            for viewer in players:
                try:
                    if viewer.dimension.name != dim:
                        continue
                    v = viewer.location
                    if (v.x - l.x) ** 2 + (v.z - l.z) ** 2 > VIEW * VIEW:
                        continue
                    viewer.spawn_particle(trail[1], l.x, l.y + 0.2, l.z)
                except Exception:
                    pass
