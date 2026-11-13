"""Build Contest: a minigame Galaxy+ / Pro+ players can host (through the Minigame Center, accepted by
Minigame Staff like any other hosted game).

The host picks a theme, a build time and a prize (their own money, held until the end). When sign-ups
close, every player who joined gets their own 15 x 15 plot in the Build Contest arena and builds in
Creative. Their own items, armour and game mode are saved first and given back afterwards (also after a
disconnect or a server restart), and nothing can leave the arena: no dropping items, no ender chests,
no teleport commands.

Then the vote: everyone in the arena is taken to each build in turn (builders' names hidden) and rates
it from 1 to 5. The best average wins; 1st, 2nd and 3rd split the prize 50 / 30 / 20. Results go to
chat and to the website (Build Contest wins on profiles), and the arena is cleared for the next one.

Admins build the arena once: Minigame Center > Minigame Staff > Set up minigames > Build Contest arena.
"""

import json
import random
import time

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput

from endstone_galaxylink import money

GRID = 4                    # 4 x 4 = 16 plots
SIZE = 15                   # build area per plot
PITCH = 19                  # plot + border + path
HEIGHT = 40                 # build height above the floor
WIDTH = 2 + GRID * PITCH    # the whole arena (78 blocks)
MAX_PLAYERS = GRID * GRID
MIN_PLAYERS = 2
BUILD_MINUTES = [10, 15, 20, 30, 45, 60]
VOTE_SECONDS = 25
SHARES = [0.5, 0.3, 0.2]
ALLOWED_COMMANDS = {"leave", "report", "dm", "r", "tell", "msg", "w", "guide", "me", "minigames"}
RATINGS = [(5, "§a§l5 · Legendary"), (4, "§2§l4 · Great"), (3, "§e§l3 · Good"), (2, "§6§l2 · Okay"), (1, "§c§l1 · Needs work")]


def usd(cents):
    return f"${cents / 100:,.2f}".replace(".00", "")


class BuildContest:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("CREATE TABLE IF NOT EXISTS bc_saved (xuid TEXT PRIMARY KEY, data TEXT)")
        self.db.commit()
        self.cfg = self.eco.get_config("build_contest") or {}
        self.jobs = []        # [generator, ticks left to wait]
        self.reminded = {}    # event id -> set of reminders sent
        self.allow_tp = set() # player uuids we're teleporting ourselves
        money.GIVE_HOOK = self.keep_for_later

    # ---------- setup ----------
    def save_cfg(self):
        self.eco.set_config("build_contest", self.cfg)

    def ready(self):
        return bool(self.cfg.get("arena") and self.cfg.get("built"))

    def arena(self):
        a = self.cfg["arena"]
        return a["dim"], a["x"], a["y"], a["z"]

    def plot_area(self, idx):
        """(x0, z0): the north-west corner of plot idx's build area."""
        _, ox, _, oz = self.arena()
        r, c = divmod(idx, GRID)
        return ox + 2 + c * PITCH, oz + 2 + r * PITCH

    def in_arena(self, dim, x, y, z):
        if not self.cfg.get("arena"):
            return False
        d, ox, oy, oz = self.arena()
        return str(dim).lower() == str(d).lower() and ox <= x <= ox + WIDTH and oz <= z <= oz + WIDTH and oy - 1 <= y <= oy + HEIGHT + 2

    def plot_at(self, x, y, z):
        """The plot whose build space (above the floor) holds this block, or None."""
        _, ox, oy, oz = self.arena()
        if not (oy < y <= oy + HEIGHT):
            return None
        for idx in range(MAX_PLAYERS):
            x0, z0 = self.plot_area(idx)
            if x0 <= x < x0 + SIZE and z0 <= z < z0 + SIZE:
                return idx
        return None

    def loc(self, x, y, z, yaw=0.0, pitch=0.0):
        from endstone.level import Location
        d = self.arena()[0]
        return Location(self.plugin.server.level.get_dimension(d), x, y, z, pitch, yaw)

    def lobby_spot(self):
        if self.cfg.get("lobby"):
            return self.cfg["lobby"]
        d, ox, oy, oz = self.arena()
        return {"dim": d, "x": ox + 1.0, "y": oy + 1.0, "z": oz + 1.0, "yaw": 0.0, "pitch": 0.0}

    def cmd(self, line):
        from endstone_galaxylink.plots import dim_cmd
        server = self.plugin.server
        try:
            server.dispatch_command(server.command_sender, f"execute in {dim_cmd(self.arena()[0])} run {line}")
        except Exception:
            pass

    def setup_menu(self, player):
        if not player.is_op:
            return
        if self.cfg.get("arena"):
            d, ox, oy, oz = self.arena()
            where = f"{d} {ox}, {oy}, {oz} ({WIDTH} x {WIDTH}, {MAX_PLAYERS} plots)" + ("" if self.cfg.get("built") else " §c(still building)")
        else:
            where = "§cnot built yet"
        form = ActionForm(title="Build Contest arena", content=f"Arena: {where}§r\n\nHosts can pick Build Contest once the arena "
                          "is built. Build it on flat open ground, away from players' builds.")
        form.add_button("§2§lBuild the arena here§r\n§8Starts at your feet, goes south-east", on_click=self.confirm_build)
        if self.cfg.get("arena"):
            form.add_button("Set the lobby to where I'm standing", on_click=self.set_lobby)
            form.add_button("Clear all plots now", on_click=lambda p: (self.reset_all(), p.send_message("§aClearing the contest plots.")))
        form.add_button("§l< Back", on_click=lambda p: self.plugin.minigames.setup_menu(p))
        player.send_form(form)

    def confirm_build(self, player):
        if self.running():
            player.send_message("§cA Build Contest is running. Build the arena when it's over.")
            return
        form = ActionForm(title="Build the arena here?", content=f"Everything in a {WIDTH} x {WIDTH} area from your feet towards the "
                          f"south-east (+X, +Z), up to {HEIGHT} blocks high, is replaced by the arena. This can't be undone.")
        form.add_button("§2§lYes, build it", on_click=self.build_here)
        form.add_button("Cancel", on_click=self.setup_menu)
        player.send_form(form)

    def build_here(self, player):
        l = player.location
        self.cfg = {"arena": {"dim": player.dimension.name, "x": int(l.x // 1), "y": int(l.y // 1) - 1, "z": int(l.z // 1)}, "built": False}
        self.save_cfg()
        self.jobs.append([self._job_build(str(player.unique_id)), 0])
        player.send_message("§aBuilding the Build Contest arena... §7This takes a few seconds.")

    def set_lobby(self, player):
        l = player.location
        self.cfg["lobby"] = {"dim": player.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch}
        self.save_cfg()
        player.send_message("§aBuild Contest lobby set. §7Players wait and watch from here.")

    def _keep_loaded(self, on):
        d, ox, oy, oz = self.arena()
        if on:
            self.cmd(f"tickingarea add {ox} {oy} {oz} {ox + WIDTH} {oy} {oz + WIDTH} gsmp_contest true")
        else:
            self.cmd("tickingarea remove gsmp_contest")

    def _job_build(self, admin_uid):
        _, ox, oy, oz = self.arena()
        self._keep_loaded(True)
        yield 60
        for x in range(ox, ox + WIDTH + 1, 16):
            for z in range(oz, oz + WIDTH + 1, 16):
                self.cmd(f"fill {x} {oy + 1} {z} {min(x + 15, ox + WIDTH)} {oy + HEIGHT} {min(z + 15, oz + WIDTH)} air")
            yield 2
        self.cmd(f"fill {ox} {oy} {oz} {ox + WIDTH} {oy} {oz + WIDTH} stone_bricks")
        for idx in range(MAX_PLAYERS):
            x0, z0 = self.plot_area(idx)
            self.cmd(f"fill {x0 - 1} {oy} {z0 - 1} {x0 + SIZE} {oy} {z0 + SIZE} quartz_block")
            self.cmd(f"fill {x0} {oy} {z0} {x0 + SIZE - 1} {oy} {z0 + SIZE - 1} grass_block")
        yield 10
        self._keep_loaded(False)
        self.cfg["built"] = True
        self.save_cfg()
        import uuid
        admin = self.plugin.server.get_player(uuid.UUID(admin_uid))
        if admin is not None:
            admin.send_message("§a§lThe Build Contest arena is ready! §r§7Hosts can now pick Build Contest. "
                               "Set a lobby where players wait (optional).")

    def _job_reset(self, plots):
        _, ox, oy, oz = self.arena()
        self._keep_loaded(True)
        yield 40
        self.cmd(f"kill @e[type=!player,x={ox},y={oy},z={oz},dx={WIDTH},dy={HEIGHT + 2},dz={WIDTH}]")
        for idx in plots:
            x0, z0 = self.plot_area(idx)
            self.cmd(f"fill {x0} {oy + 1} {z0} {x0 + SIZE - 1} {oy + HEIGHT} {z0 + SIZE - 1} air")
            self.cmd(f"fill {x0} {oy} {z0} {x0 + SIZE - 1} {oy} {z0 + SIZE - 1} grass_block")
            yield 1
        self._keep_loaded(False)

    def reset_all(self):
        if self.ready():
            self.jobs.append([self._job_reset(list(range(MAX_PLAYERS))), 0])

    # ---------- hosting (called from the Minigame Center) ----------
    def details_form(self, player, base):
        """Second step of hosting a Build Contest: theme, build time and prize."""
        controls = [
            TextInput("Theme", "e.g. Treehouse, Castle, Spaceship", ""),
            Dropdown("Build time", [f"{m} minutes" for m in BUILD_MINUTES], 2),
            TextInput("Prize from your money (split 50/30/20 for the top 3). 0 for none", "e.g. 1000", "0"),
        ]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            theme = " ".join(str(v[0]).split())[:40]
            if not theme:
                p.send_message("§cType a theme for your Build Contest.")
                return
            try:
                prize = max(0, int(round(float(str(v[2]).replace("$", "").replace(",", "") or 0) * 100)))
            except ValueError:
                p.send_message("§cThe prize must be a number, like 1000.")
                return
            if prize and not self.eco.charge(p, prize):
                p.send_message(f"§cYou don't have {usd(prize)} for the prize.")
                return
            base["contest"] = {"theme": theme, "minutes": BUILD_MINUTES[int(v[1])], "prize": prize, "phase": None}
            self.plugin.minigames.create_event(p, base)
            if prize:
                p.send_message(f"§7{usd(prize)} is held for the prize. You get it back if the contest doesn't happen.")

        player.send_form(ModalForm(title="Build Contest", controls=controls, submit_button="Send request", on_submit=submit))

    def refund(self, e):
        c = e.get("contest")
        if not c or c.get("refunded") or c.get("paid") or not c.get("prize"):
            return
        c["refunded"] = True
        self.eco.add(e["host"], e["host_name"], c["prize"])
        self.plugin.minigames.mail(e["host"], f"§7The {usd(c['prize'])} prize for your Build Contest was given back to you.")

    def running(self):
        return next((e for e in self.plugin.minigames.live() if e.get("contest")), None)

    # ---------- the contest ----------
    def contest(self):
        e = self.running()
        return (e, e["contest"]) if e else (None, None)

    def building(self, player):
        """True while this player is building in the contest."""
        e, c = self.contest()
        return bool(c and c.get("phase") == "building" and str(player.xuid) in (c.get("plots") or {}))

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def broadcast(self, text):
        for p in self.plugin.server.online_players:
            p.send_message(text)

    def teleport(self, player, location):
        self.allow_tp.add(str(player.unique_id))
        try:
            player.teleport(location)
        finally:
            self.allow_tp.discard(str(player.unique_id))

    def plot_center(self, idx):
        _, _, oy, _ = self.arena()
        x0, z0 = self.plot_area(idx)
        return self.loc(x0 + SIZE / 2, oy + 1, z0 + SIZE / 2)

    def start(self, e):
        c = e["contest"]
        mg = self.plugin.minigames
        players = [p for p in (self.online(x) for x in e["players"]) if p is not None][:MAX_PLAYERS]
        if len(players) < MIN_PLAYERS:
            self.broadcast(f"§eThe Build Contest was cancelled: it needs at least {MIN_PLAYERS} players.")
            self.refund(e)
            e.update({"status": "ended", "ended_at": time.time()})
            mg.save(e["id"])
            return
        from endstone import GameMode
        c.update({"phase": "building", "build_ends": time.time() + c["minutes"] * 60, "plots": {}, "names": {}, "votes": {}})
        for idx, p in enumerate(players):
            self.save_player(p)
            c["plots"][str(p.xuid)] = idx
            c["names"][str(p.xuid)] = p.name
            p.game_mode = GameMode.CREATIVE
            self.teleport(p, self.plot_center(idx))
            try:
                p.send_title("§d§lBuild Contest", f"§fTheme: §e{c['theme']}§f · {c['minutes']} minutes", 10, 80, 20)
            except Exception:
                pass
            p.send_message(f"§d§lBuild Contest started! §r§fTheme: §e{c['theme']}§f. You have {c['minutes']} minutes. "
                           "§7Build inside your plot. Your own items are safe and come back at the end. /leave to quit.")
        mg.save(e["id"])
        self.broadcast(f"§d{len(players)} players are building §e{c['theme']}§d in the Build Contest. §7Watch from /minigames.")

    def tick(self):
        """Every second."""
        for job in list(self.jobs):
            if job[1] > 0:
                job[1] -= 20
                continue
            try:
                job[1] = next(job[0])
            except StopIteration:
                self.jobs.remove(job)
            except Exception as ex:
                self.plugin.logger.warning(f"Build Contest arena job failed: {ex}")
                self.jobs.remove(job)
        e, c = self.contest()
        if not c:
            return
        now = time.time()
        phase = c.get("phase")
        if phase is None and e.get("signup_ends", now + 1) <= now:
            self.start(e)
        elif phase == "building":
            self.keep_inside(c)
            left = c["build_ends"] - now
            sent = self.reminded.setdefault(e["id"], set())
            for mark, text in ((300, "5 minutes"), (60, "1 minute"), (10, "10 seconds")):
                if left <= mark and mark not in sent and c["minutes"] * 60 > mark:
                    sent.add(mark)
                    for x in c["plots"]:
                        p = self.online(x)
                        if p is not None:
                            p.send_message(f"§e{text} left to build!")
            if left <= 0:
                self.finish_building(e)
        elif phase == "voting" and now >= c.get("tour_next", 0):
            self.next_plot(e)

    def keep_inside(self, c):
        from endstone import GameMode
        _, _, oy, _ = self.arena()
        for x, idx in c["plots"].items():
            p = self.online(x)
            if p is None:
                continue
            x0, z0 = self.plot_area(idx)
            l = p.location
            if not (x0 - 1 <= l.x <= x0 + SIZE + 1 and z0 - 1 <= l.z <= z0 + SIZE + 1 and oy - 1 <= l.y <= oy + HEIGHT + 4) \
                    or p.dimension.name != self.arena()[0]:
                self.teleport(p, self.plot_center(idx))
                p.send_message("§eStay inside your plot while you build.")
            if p.game_mode != GameMode.CREATIVE:
                p.game_mode = GameMode.CREATIVE

    def finish_building(self, e):
        c = e["contest"]
        _, ox, oy, oz = self.arena()
        for x in c["plots"]:
            p = self.online(x)
            if p is not None:
                self.restore_player(p, teleport=False)
        self.cmd(f"kill @e[type=item,x={ox},y={oy},z={oz},dx={WIDTH},dy={HEIGHT + 2},dz={WIDTH}]")
        voters = set(c["plots"])
        for p in self.plugin.server.online_players:
            l = p.location
            if self.in_arena(p.dimension.name, l.x, l.y, l.z):
                voters.add(str(p.xuid))
        order = list(c["plots"].values())
        random.shuffle(order)
        c.update({"phase": "voting", "order": order, "tour_i": -1, "tour_next": 0, "voters": sorted(voters)})
        self.plugin.minigames.save(e["id"])
        for x in voters:
            p = self.online(x)
            if p is not None:
                p.send_message(f"§d§lTime's up! §r§fNow rate every build from 1 to 5. §7The names stay hidden until the results.")

    def next_plot(self, e):
        c = e["contest"]
        c["tour_i"] += 1
        if c["tour_i"] >= len(c["order"]):
            return self.results(e)
        idx = c["order"][c["tour_i"]]
        c["tour_next"] = time.time() + VOTE_SECONDS
        self.plugin.minigames.save(e["id"])
        owner = next((x for x, i in c["plots"].items() if i == idx), None)
        _, _, oy, _ = self.arena()
        x0, z0 = self.plot_area(idx)
        view = self.loc(x0 + SIZE / 2, oy + 1, z0 + SIZE + 2.5, yaw=180.0)
        n, total = c["tour_i"] + 1, len(c["order"])
        for x in c["voters"]:
            p = self.online(x)
            if p is None:
                continue
            self.teleport(p, view)
            try:
                p.send_title(f"§lBuild {n} of {total}", f"§7{c['theme']}", 5, 50, 10)
            except Exception:
                pass
            if x == owner:
                p.send_message("§7This is your build. You can't vote for it.")
                continue
            self.vote_form(p, e["id"], idx, n, total)

    def vote_form(self, player, eid, idx, n, total):
        form = ActionForm(title=f"Rate build {n} of {total}", content="How good is this build for the theme?")
        for score, label in RATINGS:
            form.add_button(label, on_click=lambda p, s=score: self.vote(p, eid, idx, s))
        player.send_form(form)

    def vote(self, player, eid, idx, score):
        e = self.plugin.minigames.events.get(eid)
        c = (e or {}).get("contest")
        if not c or c.get("phase") != "voting" or c["order"][c["tour_i"]] != idx:
            player.send_message("§7Voting for that build has finished.")
            return
        c["votes"].setdefault(str(idx), {})[str(player.xuid)] = score
        self.plugin.minigames.save(eid)
        player.send_message(f"§aYou gave this build {score}/5.")

    def results(self, e):
        c = e["contest"]
        mg = self.plugin.minigames
        rows = []
        for x, idx in c["plots"].items():
            v = list((c["votes"].get(str(idx)) or {}).values())
            rows.append({"xuid": x, "name": c["names"].get(x, "?"), "score": round(sum(v) / len(v), 2) if v else 0.0, "votes": len(v)})
        rows.sort(key=lambda r: (-r["score"], -r["votes"], r["name"].lower()))
        prize = c.get("prize") or 0
        places = rows[:3]
        shares = SHARES[:len(places)]
        if places:
            shares[0] += 1 - sum(shares)  # fewer than 3 builders: the rest goes to 1st
        paid = 0
        for i, r in enumerate(places):
            r["place"] = i + 1
            r["prize"] = int(prize * shares[i]) if i else 0
            paid += r["prize"]
        if places:
            places[0]["prize"] = prize - paid
        for r in places:
            if r["prize"]:
                self.eco.add(r["xuid"], r["name"], r["prize"])
        c.update({"phase": "done", "paid": True, "results": rows})
        medals = ["§6§l1st", "§7§l2nd", "§c§l3rd"]
        lines = [f"§d§lBuild Contest results §r§7({c['theme']}, hosted by {e['host_name']})"]
        for i, r in enumerate(places):
            lines.append(f"{medals[i]}§r §f{r['name']} §7· {r['score']:.1f}/5 from {r['votes']} vote{'s' if r['votes'] != 1 else ''}"
                         + (f" §a+{usd(r['prize'])}" if r["prize"] else ""))
        self.broadcast("\n".join(lines))
        if places:
            for x in c.get("voters", []):
                p = self.online(x)
                if p is not None:
                    try:
                        p.send_title(f"§6§l{places[0]['name']} wins!", f"§7{places[0]['score']:.1f}/5 · {c['theme']}", 10, 80, 20)
                    except Exception:
                        pass
        lobby = self.lobby_spot()
        for x in c.get("voters", []):
            p = self.online(x)
            if p is not None:
                self.teleport(p, self.loc(lobby["x"], lobby["y"], lobby["z"], lobby.get("yaw", 0.0), lobby.get("pitch", 0.0)))
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "build_contest", "theme": c["theme"], "host": e["host_name"], "hostXuid": e["host"],
                             "minutes": c["minutes"], "prize": prize, "results": rows})
        e.update({"status": "ended", "ended_at": time.time()})
        mg.save(e["id"])
        self.jobs.append([self._job_reset(list(c["plots"].values())), 100])

    def stop(self, e, by=None):
        """The host or staff ended the game early."""
        c = e.get("contest")
        if not c:
            return
        phase = c.get("phase")
        if phase == "voting":
            self.results(e)
            return
        if phase == "building":
            for x in c["plots"]:
                p = self.online(x)
                if p is not None:
                    self.restore_player(p)
                    p.send_message("§eThe Build Contest was ended early. Your items are back.")
            self.jobs.append([self._job_reset(list(c["plots"].values())), 20])
        if phase in (None, "building"):
            self.refund(e)
        c["phase"] = "done"

    def leave(self, player):
        e, c = self.contest()
        if not c or str(player.xuid) not in (c.get("plots") or {}) or c.get("phase") != "building":
            return False
        c["plots"].pop(str(player.xuid), None)
        self.plugin.minigames.save(e["id"])
        self.restore_player(player)
        player.send_message("§7You left the Build Contest. Your items are back.")
        return True

    # ---------- saving and giving back a player's own things ----------
    def save_player(self, player):
        inv = player.inventory
        data = {
            "items": {str(i): money.snapshot(inv.get_item(i)) for i in range(inv.size) if inv.get_item(i) is not None},
            "armor": {k: money.snapshot(getattr(inv, k)) for k in ("helmet", "chestplate", "leggings", "boots") if getattr(inv, k) is not None},
            "offhand": money.snapshot(inv.item_in_off_hand) if inv.item_in_off_hand is not None else None,
            "loc": {"dim": player.dimension.name, "x": player.location.x, "y": player.location.y, "z": player.location.z},
            "mode": int(player.game_mode.value),
        }
        self.db.execute("INSERT OR REPLACE INTO bc_saved (xuid, data) VALUES (?, ?)", (str(player.xuid), json.dumps(data)))
        self.db.commit()
        self.clear(player)

    def keep_for_later(self, player, stacks):
        """Items given to someone who is building (a trade, the Auction House, a crate...) would be wiped with the
        Creative inventory at the end, so they're added to their saved items instead."""
        try:
            if not self.building(player):
                return False
            row = self.db.execute("SELECT data FROM bc_saved WHERE xuid = ?", (str(player.xuid),)).fetchone()
            if not row:
                return False
            data = json.loads(row[0])
            data.setdefault("extra", []).extend(money.snapshot(s) for s in stacks if s is not None)
            self.db.execute("UPDATE bc_saved SET data = ? WHERE xuid = ?", (json.dumps(data), str(player.xuid)))
            self.db.commit()
            player.send_message("§7You got items while building. They're kept safe and you get them after the contest.")
            return True
        except Exception:
            return False

    @staticmethod
    def clear(player):
        inv = player.inventory
        inv.clear()
        for k in ("helmet", "chestplate", "leggings", "boots"):
            try:
                setattr(inv, k, None)
            except Exception:
                pass
        try:
            inv.item_in_off_hand = None
        except Exception:
            pass

    def has_saved(self, player):
        return self.db.execute("SELECT 1 FROM bc_saved WHERE xuid = ?", (str(player.xuid),)).fetchone() is not None

    def restore_player(self, player, teleport=True):
        from endstone import GameMode
        from endstone.level import Location
        row = self.db.execute("SELECT data FROM bc_saved WHERE xuid = ?", (str(player.xuid),)).fetchone()
        self.clear(player)  # nothing built with Creative leaves the contest
        if not row:
            player.game_mode = GameMode.SURVIVAL
            return
        data = json.loads(row[0])
        inv = player.inventory
        for slot, snap in data.get("items", {}).items():
            try:
                inv.set_item(int(slot), money.rebuild(snap))
            except Exception as ex:
                self.plugin.logger.warning(f"Build Contest: couldn't give back an item to {player.name}: {ex}")
        for k, snap in data.get("armor", {}).items():
            try:
                setattr(inv, k, money.rebuild(snap))
            except Exception:
                pass
        if data.get("offhand"):
            try:
                inv.item_in_off_hand = money.rebuild(data["offhand"])
            except Exception:
                pass
        self.db.execute("DELETE FROM bc_saved WHERE xuid = ?", (str(player.xuid),))
        self.db.commit()
        extra = [money.rebuild(x) for x in data.get("extra", [])]
        if extra:
            money.give(player, extra)
        try:
            mode = GameMode(int(data.get("mode", 0)))
            player.game_mode = GameMode.SURVIVAL if mode == GameMode.CREATIVE and not player.is_op else mode
        except Exception:
            player.game_mode = GameMode.SURVIVAL
        if teleport and data.get("loc"):
            l = data["loc"]
            try:
                self.teleport(player, Location(self.plugin.server.level.get_dimension(l["dim"]), l["x"], l["y"], l["z"], 0.0, 0.0))
            except Exception:
                pass
        plots = getattr(self.plugin, "plots", None)
        if plots is not None:
            plots.ensure_tool(player)

    # ---------- events ----------
    def on_join(self, player):
        """Back after a disconnect: still building -> back to your plot; otherwise your items come back."""
        def later():
            p = self.online(player.xuid)
            if p is None:
                return
            e, c = self.contest()
            if c and c.get("phase") == "building" and str(p.xuid) in c["plots"]:
                from endstone import GameMode
                p.game_mode = GameMode.CREATIVE
                self.teleport(p, self.plot_center(c["plots"][str(p.xuid)]))
                p.send_message(f"§dYou're back in the Build Contest. §fTheme: §e{c['theme']}")
            elif self.has_saved(p):
                self.restore_player(p)
                p.send_message("§aThe Build Contest ended while you were away. Your items are back.")
        self.plugin.server.scheduler.run_task(self.plugin, later, delay=40)

    def recover(self):
        """At start: a contest that was going on when the server stopped is ended (prize refunded)."""
        mg = self.plugin.minigames
        for e in mg.live():
            c = e.get("contest")
            if c and c.get("phase") in ("building", "voting"):
                self.refund(e)
                c["phase"] = "done"
                e.update({"status": "ended", "ended_at": time.time()})
                mg.save(e["id"])
                self.jobs.append([self._job_reset(list((c.get("plots") or {}).values())), 200])
                mg.mail(e["host"], "§eYour Build Contest stopped because the server restarted. Sorry! The prize was given back.")

    def on_block(self, event, placing):
        """Returns True when the contest handled it (allowed or refused)."""
        b = event.block
        p = event.player
        if not self.in_arena(b.dimension.name, b.x, b.y, b.z):
            return False
        e, c = self.contest()
        if c and c.get("phase") == "building" and str(p.xuid) in c["plots"]:
            if self.plot_at(b.x, b.y, b.z) == c["plots"][str(p.xuid)]:
                return True  # building in your own plot
            event.is_cancelled = True
            p.send_message("§cBuild inside your own plot.")
            return True
        if p.is_op and not (c and c.get("phase") in ("building", "voting")):
            return False  # admins can fix the arena between contests
        event.is_cancelled = True
        p.send_message("§cThis is the Build Contest arena.")
        return True

    def on_interact(self, event):
        if not self.building(event.player):
            return False
        try:
            blocked = event.has_block and "ender_chest" in str(event.block.type)
        except Exception:
            blocked = False
        if blocked:
            event.is_cancelled = True
            event.player.send_message("§cEnder chests can't be used during the Build Contest.")
            return True
        return False

    def on_drop(self, event):
        if self.building(event.player):
            event.is_cancelled = True
            return True
        return False

    def on_command(self, event):
        if not self.building(event.player):
            return False
        name = event.command.lstrip("/").split(" ")[0].lower().split(":")[-1]
        if name in ALLOWED_COMMANDS:
            return False
        event.is_cancelled = True
        event.player.send_message("§cYou can't use that during the Build Contest. §7/leave to quit the contest.")
        return True

    def on_explode(self, event):
        try:
            keep = [b for b in event.block_list if not self.in_arena(b.dimension.name, b.x, b.y, b.z)]
            if len(keep) != len(event.block_list):
                event.block_list = keep
        except Exception:
            pass

    def on_flow(self, event):
        a, b = event.block, event.to_block
        if self.cfg.get("arena") and self.in_arena(b.dimension.name, b.x, b.y, b.z):
            if self.plot_at(b.x, b.y, b.z) is None or self.plot_at(b.x, b.y, b.z) != self.plot_at(a.x, a.y, a.z):
                event.is_cancelled = True
                return True
        return False
