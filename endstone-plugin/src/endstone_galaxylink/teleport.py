"""Teleports: /tpa, /tpahere, /tpaccept, /tpdeny, /spawn, /setspawn, /home, /sethome,
/delhome, /homes, /back and /rtp (random teleport into the wild).

Teleports wait 3 seconds and are cancelled if the player moves (operators go instantly).
"""

import json
import math
import time
import uuid

REQUEST_SECONDS = 60
WARMUP_TICKS = 60  # 3 seconds
RTP_COOLDOWN = 60       # seconds between /rtp uses (each one makes the server generate new land)
RTP_MIN, RTP_MAX = 500, 5000   # /rtp: this many blocks from spawn
RTP_AVOID = 48                 # never land within this many blocks of a plot


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

    def go(self, player, get_spot, label, run=None):
        """Teleport after a 3-second wait. get_spot is called at the end, so it follows moving players."""
        if self.in_minigame(player):
            player.send_message("§cYou can't teleport during a minigame. Leave it first.")
            return
        # operators, and teleports from a command plate (people keep walking after stepping on one), go instantly
        from_plate = time.time() - getattr(self, "plate_at", {}).get(str(player.unique_id), 0) < 1.5
        if player.is_op or from_plate:
            return self._finish(player, get_spot, label, run)
        token = time.monotonic()
        self.waiting[str(player.unique_id)] = (where(player), token)
        player.send_message(f"§eTeleporting to {label} in 3 seconds. Don't move!")
        uid = player.unique_id
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._after_wait(uid, token, get_spot, label, run), delay=WARMUP_TICKS)

    def _after_wait(self, uid, token, get_spot, label, run=None):
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
        self._finish(player, get_spot, label, run)

    def in_minigame(self, player):
        """Players in Bedwars or building in the Build Contest can't teleport out (they'd keep the game's items)."""
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        try:
            return bool((bw is not None and bw.playing(player)) or (bc is not None and bc.building(player)))
        except Exception:
            return False

    def _finish(self, player, get_spot, label, run=None):
        if self.in_minigame(player):
            player.send_message("§cYou can't teleport during a minigame. Leave it first.")
            return
        pk = getattr(self.plugin, "parkour", None)
        if pk is not None and pk.runs.pop(str(player.unique_id), None):
            player.send_message("§7Parkour run stopped because you teleported.")
        if run is not None:   # a teleport that isn't to a fixed spot (/rtp)
            self.back[str(player.unique_id)] = where(player)
            return run(player)
        spot = get_spot()
        if spot is None:
            player.send_message("§cThat place isn't available any more.")
            return
        self.back[str(player.unique_id)] = where(player)
        player.teleport(self.location(spot))
        player.send_message(f"§aTeleported to {label}.")
        self.arrived(player)

    def arrived(self, player):
        """A soft whoosh and sparkles where you land (a moment later, once you're there)."""
        from endstone_galaxylink import fx
        uid = player.unique_id
        try:
            self.plugin.server.scheduler.run_task(self.plugin, lambda: (lambda p: p and fx.teleport(self.plugin, p))(
                self.plugin.server.get_player(uid)), delay=4)
        except Exception:
            pass

    # ---------- /rtp: a random safe spot in the wild ----------
    def rtp(self, player):
        if player.dimension.name.lower() not in ("overworld", "minecraft:overworld"):
            player.send_message("§cRandom teleport only works in the Overworld.")
            return
        # a random spot means brand-new land for the server to make (heavy work): once a minute per player
        wait = RTP_COOLDOWN - (time.time() - getattr(self, "rtp_used", {}).get(str(player.unique_id), 0))
        if wait > 0 and not player.is_op:
            player.send_message(f"§eYou can use /rtp again in {int(wait) + 1} seconds.")
            return
        self.go(player, lambda: None, "a random spot in the wild", run=self._rtp_now)

    def rtp_command(self, sender, args):
        """/rtp for yourself, or /rtp <player> from a command block, the console or an operator
        (e.g. a command block under a pressure plate: rtp @p). Those go instantly, without the countdown."""
        from endstone import Player
        name = " ".join(args).strip().strip('"')
        if not name:
            if not isinstance(sender, Player):
                sender.send_message("Usage from a command block or the console: rtp <player>  (e.g. rtp @p)")
                return
            return self.rtp(sender)
        if isinstance(sender, Player) and not sender.is_op:
            sender.send_message("§cYou can only random teleport yourself: just type /rtp.")
            return
        target = self.plugin.server.get_player(name)
        if target is None:
            sender.send_message(f"No online player called {name}.")
            return
        if not hasattr(self, "plate_at"):
            self.plate_at = {}
        self.plate_at[str(target.unique_id)] = time.time()   # sent by a block/staff: no "don't move" countdown
        self.rtp(target)

    def _rtp_pick(self):
        import random
        spawn = self.eco.get_config("spawn") or {"x": 0, "z": 0}
        plots = getattr(self.plugin, "plots", None)
        for _ in range(30):
            angle = random.uniform(0, 2 * math.pi)
            dist = random.uniform(RTP_MIN, RTP_MAX)
            x, z = int(spawn["x"] + math.cos(angle) * dist), int(spawn["z"] + math.sin(angle) * dist)
            near_plot = plots is not None and any(
                plots.at(dim, x + dx, -64, z + dz)   # -64: the bottom of the world, so any plot height counts
                for dim in ("Overworld", "overworld")
                for dx in (-RTP_AVOID, 0, RTP_AVOID) for dz in (-RTP_AVOID, 0, RTP_AVOID))
            if not near_plot:
                return x, z
        return None

    def _rtp_now(self, player, tries=2):
        pick = self._rtp_pick()
        if pick is None:
            player.send_message("§cCouldn't find a free spot. Try again.")
            return
        x, z = pick
        start = where(player)
        name = player.name.replace('"', "")
        server = self.plugin.server
        # Minecraft's own /spreadplayers finds the ground (and loads the area), so nobody lands in the air or underground
        ok = server.dispatch_command(server.command_sender, f'spreadplayers {x} {z} 0 1 "{name}"')
        uid = player.unique_id

        def check():
            p = server.get_player(uid)
            if p is None:
                return
            try:
                l = p.location
                below = str(p.dimension.get_block_at(math.floor(l.x), math.floor(l.y) - 1, math.floor(l.z)).type)
                at = str(p.dimension.get_block_at(math.floor(l.x), math.floor(l.y), math.floor(l.z)).type)
            except Exception:
                below = at = ""
            moved = math.dist((p.location.x, p.location.z), (start["x"], start["z"])) > 50
            if not moved:   # Minecraft didn't move them (e.g. no ground found there): another spot
                if tries > 1:
                    return self._rtp_now(p, tries - 1)
                p.send_message("§cCouldn't find a safe spot this time. Please try /rtp again.")
                return
            if any(w in below or w in at for w in ("water", "lava")) and tries > 1:
                return self._rtp_now(p, tries - 1)   # landed in the sea or lava: somewhere else
            if not hasattr(self, "rtp_used"):
                self.rtp_used = {}
            self.rtp_used[str(uid)] = time.time()
            l = p.location
            self.arrived(p)
            p.send_message(f"§aWhoosh! You're in the wild at §f{math.floor(l.x)} {math.floor(l.y)} {math.floor(l.z)}§a. §7Use /back to go back, /spawn to go home.")
        if ok is False:
            player.send_message("§cRandom teleport didn't work. Please tell staff.")
            return
        server.scheduler.run_task(self.plugin, check, delay=10)

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
