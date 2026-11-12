"""Server control from the website (Control Panel > Server control, owner only).

Maintenance mode: only the owner can join; everyone else is kept out with the owner's message, and anyone online
                  when it's switched on is moved out. It's saved here too, so it stays on if the website is away.
Scheduled restart: one-time. Warnings in chat and on screen (10 min, 5 min, 2 min, 1 min, 30 s, then a 10-second
                  countdown), then everyone is moved out and the server stops. The host starts it again.
Welcome kit:      items and money for brand-new players on their very first join (editable on the website).
"""

import time

from endstone_galaxylink import money

WARN_AT = [600, 300, 120, 60, 30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
DEFAULT_KIT = {"enabled": True, "money": 25000, "message": "Welcome to GalaxySMP! Here's a starter kit to get you going.",
               "items": [{"id": "minecraft:stone_sword", "count": 1}, {"id": "minecraft:stone_pickaxe", "count": 1},
                         {"id": "minecraft:stone_axe", "count": 1}, {"id": "minecraft:bread", "count": 16},
                         {"id": "minecraft:red_bed", "count": 1}]}


def when_text(secs):
    secs = int(round(secs))
    if secs >= 60:
        m = secs // 60
        return f"{m} minute{'s' if m != 1 else ''}"
    return f"{secs} second{'s' if secs != 1 else ''}"


class ServerControl:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        saved = self.eco.get_config("server_control") or {}
        self.maintenance = saved.get("maintenance") or {"on": False, "message": ""}
        self.owners = set(saved.get("owners") or [])
        self.kit = saved.get("kit") or DEFAULT_KIT
        self.restart = saved.get("restart")        # {"at": epoch seconds, "reason": str} or None
        self.warned = set()
        self.stopping = False

    def save(self):
        self.eco.set_config("server_control", {"maintenance": self.maintenance, "owners": sorted(self.owners), "kit": self.kit, "restart": self.restart})

    # ---------- from the website ----------
    def update(self, msg):
        was_on = bool(self.maintenance.get("on"))
        if isinstance(msg.get("owners"), list):
            self.owners = {str(x) for x in msg["owners"] if str(x).isdigit()}
        if isinstance(msg.get("maintenance"), dict):
            m = msg["maintenance"]
            self.maintenance = {"on": bool(m.get("on")), "message": str(m.get("message") or "")[:300]}
        if isinstance(msg.get("kit"), dict):
            self.kit = msg["kit"]
        if "restart" in msg:
            r = msg.get("restart")
            new = {"at": float(r["at"]), "reason": str(r.get("reason") or "")[:120]} if isinstance(r, dict) and r.get("at") else None
            if new != self.restart:
                self.warned = set()
                if new and not self.restart:
                    self.broadcast(f"§eThe server will restart in §f{when_text(new['at'] - time.time())}§e." + (f" §7{new['reason']}" if new["reason"] else ""))
                elif not new and self.restart:
                    self.broadcast("§aThe scheduled restart was cancelled.")
            self.restart = new
        self.save()
        if self.maintenance["on"] and not was_on:
            self.plugin.logger.info("[Website] Maintenance mode is on: only the owner can join.")
            for p in list(self.plugin.server.online_players):
                if not self.allowed(p):
                    p.kick(self.kick_text())
        elif was_on and not self.maintenance["on"]:
            self.plugin.logger.info("[Website] Maintenance mode is off.")

    # ---------- maintenance ----------
    def allowed(self, player):
        return str(player.xuid) in self.owners

    def kick_text(self):
        return "§eGalaxySMP is down for maintenance.\n§7" + (self.maintenance.get("message") or "We'll be back soon. Check galaxymc.us for updates.")

    def can_login(self, player):
        """False when maintenance mode keeps this player out."""
        return not (self.maintenance.get("on") and not self.allowed(player))

    # ---------- scheduled restart (every second) ----------
    def broadcast(self, text):
        for p in list(self.plugin.server.online_players):
            p.send_message(text)

    def tick(self):
        r = self.restart
        if not r or self.stopping:
            return
        left = r["at"] - time.time()
        if left < -120:      # a restart that was due long ago (e.g. the server was off): forget it
            self.restart = None
            self.save()
            return
        for mark in WARN_AT:
            if left <= mark and mark not in self.warned:
                self.warned.add(mark)
                if left < mark - 5 and mark > 10:
                    continue  # skipped past this warning (scheduled at short notice)
                if mark > 10:
                    self.broadcast(f"§eServer restart in §f{when_text(mark)}§e." + (f" §7{r['reason']}" if r.get("reason") else ""))
                for p in list(self.plugin.server.online_players):
                    p.send_title("§eRestarting", f"§fin {when_text(mark)}", 0, 30 if mark <= 10 else 60, 10)
        if left <= 0:
            self.stopping = True
            self.restart = None
            self.save()
            self.plugin.logger.info("[Website] Scheduled restart: stopping the server now.")
            for p in list(self.plugin.server.online_players):
                p.kick("§eGalaxySMP is restarting.\n§7Please join again in a few minutes.")
            self.plugin.server.scheduler.run_task(self.plugin, self.plugin.server.shutdown, delay=40)

    # ---------- welcome kit ----------
    def welcome(self, player):
        kit = self.kit or {}
        if not kit.get("enabled"):
            return
        given = []
        for it in (kit.get("items") or [])[:12]:
            item, count = str(it.get("id") or ""), max(1, min(int(it.get("count") or 1), 640))
            try:
                money.give(player, money.make_stacks(item, count))
                given.append(f"{count}x {money.pretty_id(item)}")
            except Exception as e:
                self.plugin.logger.warning(f"Welcome kit item {item} couldn't be given: {e}")
        cents = max(0, int(kit.get("money") or 0))
        if cents:
            self.eco.add(str(player.xuid), player.name, cents)
        player.send_message(f"§a{kit.get('message') or 'Welcome to GalaxySMP!'}")
        if given or cents:
            player.send_message("§7You got: §f" + ", ".join(given + ([money.fmt(cents)] if cents else [])))
        for p in list(self.plugin.server.online_players):
            if p is not player:
                p.send_message(f"§d✦ §fWelcome to GalaxySMP, §b{player.name}§f! Say hi!")
