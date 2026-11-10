"""Teleports: /tpa, /tpahere, /tpaccept, /tpdeny, /spawn, /setspawn, /home, /sethome,
/delhome, /homes and /back.

Teleports wait 3 seconds and are cancelled if the player moves (operators go instantly).
"""

import json
import math
import time
import uuid

REQUEST_SECONDS = 60
WARMUP_TICKS = 60  # 3 seconds


def where(player):
    l = player.location
    return {"dim": player.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch}


class Teleports:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("CREATE TABLE IF NOT EXISTS homes (xuid TEXT, name TEXT, data TEXT, PRIMARY KEY (xuid, name))")
        self.db.commit()
        self.requests = {}   # target uuid -> {sender uuid: (kind, time)}
        self.back = {}       # player uuid -> spot
        self.waiting = {}    # player uuid -> (start spot, token)

    # ---------- moving players ----------
    def location(self, spot):
        from endstone.level import Location
        dim = self.plugin.server.level.get_dimension(spot["dim"])
        return Location(dim, spot["x"], spot["y"], spot["z"], spot.get("pitch", 0.0), spot.get("yaw", 0.0))

    def go(self, player, get_spot, label):
        """Teleport after a 3-second wait. get_spot is called at the end, so it follows moving players."""
        if player.is_op:
            return self._finish(player, get_spot, label)
        token = time.monotonic()
        self.waiting[str(player.unique_id)] = (where(player), token)
        player.send_message(f"§eTeleporting to {label} in 3 seconds. Don't move!")
        uid = player.unique_id
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._after_wait(uid, token, get_spot, label), delay=WARMUP_TICKS)

    def _after_wait(self, uid, token, get_spot, label):
        start, t = self.waiting.get(str(uid), (None, None))
        if t != token:
            return
        self.waiting.pop(str(uid), None)
        player = self.plugin.server.get_player(uid)
        if player is None:
            return
        now = where(player)
        if now["dim"] != start["dim"] or math.dist((now["x"], now["y"], now["z"]), (start["x"], start["y"], start["z"])) > 1.0:
            player.send_message("§cTeleport cancelled because you moved.")
            return
        self._finish(player, get_spot, label)

    def _finish(self, player, get_spot, label):
        spot = get_spot()
        if spot is None:
            player.send_message("§cThat place isn't available any more.")
            return
        self.back[str(player.unique_id)] = where(player)
        player.teleport(self.location(spot))
        player.send_message(f"§aTeleported to {label}.")

    def on_death(self, player):
        self.back[str(player.unique_id)] = where(player)

    def on_quit(self, player):
        key = str(player.unique_id)
        self.requests.pop(key, None)
        self.waiting.pop(key, None)
        for reqs in self.requests.values():
            reqs.pop(key, None)

    # ---------- /tpa ----------
    def request(self, sender, args, kind):
        target = self.eco.find_player(sender, " ".join(args))
        if not target:
            sender.send_message(f"§eUsage: /{'tpa' if kind == 'to' else 'tpahere'} <player>  §7(they must be online)")
            return
        if target.unique_id == sender.unique_id:
            sender.send_message("§cYou can't send a request to yourself.")
            return
        self.requests.setdefault(str(target.unique_id), {})[str(sender.unique_id)] = (kind, time.time())
        sender.send_message(f"§aRequest sent to {target.name}. §7It expires in {REQUEST_SECONDS} seconds.")
        if kind == "to":
            target.send_message(f"§e{sender.name}§a wants to teleport to you. §7Type §a/tpaccept§7 or §c/tpdeny§7.")
        else:
            target.send_message(f"§e{sender.name}§a wants you to teleport to them. §7Type §a/tpaccept§7 or §c/tpdeny§7.")

    def _pending(self, player, args):
        reqs = self.requests.get(str(player.unique_id), {})
        now = time.time()
        for k in [k for k, (_, t) in reqs.items() if now - t > REQUEST_SECONDS]:
            del reqs[k]
        server = self.plugin.server
        live = [(k, v) for k, v in reqs.items() if server.get_player(uuid.UUID(k)) is not None]
        if not live:
            return None, None
        name = " ".join(args).strip().strip('"').lower()
        if name:
            for k, v in live:
                p = server.get_player(uuid.UUID(k))
                if p.name.lower().startswith(name):
                    return p, v
            return None, None
        k, v = max(live, key=lambda kv: kv[1][1])
        return server.get_player(uuid.UUID(k)), v

    def accept(self, player, args):
        sender, req = self._pending(player, args)
        if not sender:
            player.send_message("§cYou have no teleport requests right now.")
            return
        del self.requests[str(player.unique_id)][str(sender.unique_id)]
        kind = req[0]
        player.send_message(f"§aAccepted {sender.name}'s request.")
        progress = getattr(self.plugin, "progress", None)
        if progress:
            progress.add(sender if kind == "to" else player, "tpas")
        if kind == "to":
            sender.send_message(f"§a{player.name} accepted your request.")
            uid = player.unique_id
            self.go(sender, lambda: self._spot_of(uid), player.name)
        else:
            sender.send_message(f"§a{player.name} accepted and is coming to you.")
            uid = sender.unique_id
            self.go(player, lambda: self._spot_of(uid), sender.name)

    def _spot_of(self, uid):
        p = self.plugin.server.get_player(uid)
        return where(p) if p is not None else None

    def deny(self, player, args):
        sender, _ = self._pending(player, args)
        if not sender:
            player.send_message("§cYou have no teleport requests right now.")
            return
        del self.requests[str(player.unique_id)][str(sender.unique_id)]
        player.send_message(f"§7Denied {sender.name}'s request.")
        sender.send_message(f"§c{player.name} said no to your teleport request.")

    # ---------- spawn ----------
    def spawn(self, player):
        spot = self.eco.get_config("spawn")
        if not spot:
            player.send_message("§cSpawn hasn't been set yet. §7An operator can stand there and type /setspawn.")
            return
        self.go(player, lambda: spot, "spawn")

    def set_spawn(self, player):
        self.eco.set_config("spawn", where(player))
        player.send_message("§aSpawn set to where you're standing.")

    # ---------- homes ----------
    def max_homes(self, player):
        plans = getattr(self.plugin, "plans", None)
        return plans.plan_for(player)["homes"] if plans else 1

    def homes(self, player):
        rows = self.db.execute("SELECT name FROM homes WHERE xuid = ? ORDER BY name", (str(player.xuid),)).fetchall()
        return [r[0] for r in rows]

    @staticmethod
    def home_name(args):
        name = "_".join(" ".join(args).split()).lower()[:16]
        return name or "home"

    def set_home(self, player, args):
        name = self.home_name(args)
        existing = self.homes(player)
        limit = self.max_homes(player)
        if name not in existing and len(existing) >= limit and not player.is_op:
            more = "" if limit >= 10 else " §7More homes come with Galaxy+ and Pro+ (galaxymc.us/store)."
            player.send_message(f"§cYou can have up to {limit} home{'s' if limit != 1 else ''}. §7Delete one with /delhome <name>.{more}")
            return
        self.db.execute("INSERT OR REPLACE INTO homes (xuid, name, data) VALUES (?, ?, ?)",
                        (str(player.xuid), name, json.dumps(where(player))))
        self.db.commit()
        player.send_message(f"§aHome §f{name}§a set. §7Go back with /home{'' if name == 'home' else ' ' + name}.")

    def home(self, player, args):
        existing = self.homes(player)
        if not existing:
            player.send_message("§cYou don't have a home yet. §7Stand somewhere and type /sethome.")
            return
        name = self.home_name(args) if args and " ".join(args).strip() else ("home" if "home" in existing else existing[0])
        row = self.db.execute("SELECT data FROM homes WHERE xuid = ? AND name = ?", (str(player.xuid), name)).fetchone()
        if not row:
            player.send_message(f"§cNo home called {name}. §7Your homes: {', '.join(existing)}")
            return
        spot = json.loads(row[0])
        self.go(player, lambda: spot, f"home {name}")

    def del_home(self, player, args):
        name = self.home_name(args)
        cur = self.db.execute("DELETE FROM homes WHERE xuid = ? AND name = ?", (str(player.xuid), name))
        self.db.commit()
        player.send_message(f"§aDeleted home {name}." if cur.rowcount else f"§cNo home called {name}.")

    def list_homes(self, player):
        existing = self.homes(player)
        player.send_message(f"§7Your homes ({len(existing)}/{self.max_homes(player)}): §f{', '.join(existing)}" if existing
                            else "§7You have no homes. Stand somewhere and type /sethome.")

    # ---------- back ----------
    def go_back(self, player):
        spot = self.back.get(str(player.unique_id))
        if not spot:
            player.send_message("§cThere's nowhere to go back to yet.")
            return
        self.go(player, lambda: spot, "your last location")
