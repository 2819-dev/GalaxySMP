"""Cosmetics and WebShop effects.

/cosmetics  pick a particle trail and switch join effects on or off.
Owned cosmetics come from the website (bought in the WebShop or given by admins) plus the ones a
plan includes (plans.json "cosmetics"). Night Vision bought in the WebShop is kept on until it ends.
"""

import json
import time

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
        form.add_button("Close")
        player.send_form(form)

    def pick_trail(self, player, cid):
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
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self.firework(player), delay=40)
        if self.night.get(str(player.xuid), 0) > time.time():
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self.night_vision_for(player), delay=40)

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
