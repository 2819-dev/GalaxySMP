"""Minigame Center.

Players use a Minigame Computer (the galaxysmp:computer block, an iMac-style block from the
GalaxySMP Blocks behavior pack) or /minigames:
  - Host a Minigame (Galaxy+ and Pro+): a request form. Minigame Staff accept or decline it on
    their computers. When accepted, the host types /tpd to teleport to that staff member.
  - Join a Minigame: games accepting participants (sign-up time and who can join are set by the
    host). Enter teleports you to the game's backstage room.
  - Watch a Minigame: teleports you to the game's entrance.
Admins set up the list of minigames (name, backstage room, entrance). Hosts can also pick
"Custom": the accepting staff member's position becomes its backstage room and entrance, which
staff can change in Manage.
"""

import json
import time

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput

COMPUTER = "galaxysmp:computer"
STAFF_PERMISSION = "galaxylink.minigames.staff"
ACCESS = [("all", "Everyone"), ("plus", "Galaxy+ and Pro+"), ("pro", "Galaxy Pro+ only")]
ACCESS_LEVEL = {"all": 0, "plus": 1, "pro": 2}
PLAN_LEVEL = {"free": 0, "plus": 1, "pro": 2}
SIGNUP_MINUTES = [2, 5, 10, 15, 30]
MAX_HOURS = 3        # games end by themselves after this long
TPD_MINUTES = 10     # how long a /tpd stays waiting


def spot(player):
    l = player.location
    return {"dim": player.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch}


def mins_left(t):
    s = max(0, int(t - time.time()))
    return f"{s // 60}m {s % 60:02d}s" if s < 3600 else f"{s // 3600}h {(s % 3600) // 60}m"


class Minigames:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS minigame_types (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
            CREATE TABLE IF NOT EXISTS minigame_events (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
            CREATE TABLE IF NOT EXISTS mail (id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, text TEXT);
        """)
        self.db.commit()
        self.types = {i: json.loads(d) for i, d in self.db.execute("SELECT id, data FROM minigame_types").fetchall()}
        self.events = {i: json.loads(d) for i, d in self.db.execute("SELECT id, data FROM minigame_events").fetchall()}
        self.tpd = {}  # player uuid -> {"to": uuid str, "name": str, "until": time}
        self._ticks = 0

    # ---------- storage ----------
    def save_type(self, tid):
        self.db.execute("UPDATE minigame_types SET data = ? WHERE id = ?", (json.dumps(self.types[tid]), tid))
        self.db.commit()

    def save(self, eid):
        self.db.execute("UPDATE minigame_events SET data = ? WHERE id = ?", (json.dumps(self.events[eid]), eid))
        self.db.commit()
        self.push()

    def mail(self, xuid, text):
        """A message for a player; shown now if online, otherwise when they next join."""
        p = self.online(xuid)
        if p is not None:
            p.send_message(text)
            return
        self.db.execute("INSERT INTO mail (xuid, text) VALUES (?, ?)", (str(xuid), text))
        self.db.commit()

    def on_join(self, player):
        rows = self.db.execute("SELECT id, text FROM mail WHERE xuid = ?", (str(player.xuid),)).fetchall()
        for _, text in rows:
            player.send_message(text)
        if rows:
            self.db.execute("DELETE FROM mail WHERE xuid = ?", (str(player.xuid),))
            self.db.commit()
        # A host whose game was accepted while they were offline can still /tpd to the staff member.
        for e in self.live():
            if e["host"] == str(player.xuid) and time.time() - e["accepted_at"] < TPD_MINUTES * 60 and e.get("accepted_uuid"):
                self.tpd[str(player.unique_id)] = {"to": e["accepted_uuid"], "name": e["accepted_by"], "until": e["accepted_at"] + TPD_MINUTES * 60}
        if self.is_staff(player):
            n = len(self.pending())
            if n:
                player.send_message(f"§d{n} minigame host request{'s' if n != 1 else ''} waiting. §7Use a Minigame Computer or /minigames.")

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    # ---------- who's who ----------
    def is_staff(self, player):
        if player.is_op:
            return True
        try:
            return bool(player.has_permission(STAFF_PERMISSION))
        except Exception:
            return False

    def plan_level(self, player):
        plans = getattr(self.plugin, "plans", None)
        return PLAN_LEVEL.get(plans.plan_key(player) if plans else "free", 0)

    def game_name(self, ev):
        if ev.get("type_id") and ev["type_id"] in self.types:
            return self.types[ev["type_id"]]["name"]
        return ev.get("custom") or "Minigame"

    def pending(self):
        return [e for e in self.events.values() if e["status"] == "pending"]

    def live(self):
        return [e for e in self.events.values() if e["status"] == "accepted"]

    def open_for_signup(self):
        now = time.time()
        return [e for e in self.live() if e.get("signup_ends", 0) > now and e.get("backstage")]

    # ---------- computer ----------
    def on_interact(self, event):
        """Right-clicking a Minigame Computer opens the menu."""
        from endstone.event import PlayerInteractEvent
        if event.action != PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK or not event.has_block:
            return False
        if event.block.type != COMPUTER:
            return False
        event.is_cancelled = True
        self.open(event.player)
        return True

    def open(self, player):
        form = ActionForm(title="§l§bMinigame Center", content="What would you like to do?")
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None:
            state = ("game running" if bw.game else f"{len(bw.queue)} waiting") if bw.ready() else "coming soon"
            form.add_button(f"§c§lBedwars§r\n§8{state}", icon="textures/items/bed_red", on_click=bw.menu)
        locked = "" if self.plan_level(player) >= 1 or player.is_op else " §c(Galaxy+ only)"
        form.add_button(f"§lHost a Minigame{locked}§r\n§8Ask staff to run your own game", icon="textures/ui/icon_crown",
                        on_click=self.host_form)
        n = len(self.open_for_signup())
        form.add_button(f"§lJoin a Minigame§r\n§8{n} taking players" if n else "§lJoin a Minigame§r\n§8None open right now",
                        icon="textures/ui/sword", on_click=self.join_menu)
        form.add_button(f"§lWatch a Minigame§r\n§8{len(self.live())} going on", icon="textures/ui/camera-yo",
                        on_click=self.watch_menu)
        if self.is_staff(player):
            p = len(self.pending())
            form.add_button(f"§d§lMinigame Staff§r\n§8{p} request{'s' if p != 1 else ''} waiting" if p else "§d§lMinigame Staff§r\n§8Requests and running games",
                            icon="textures/ui/permissions_op_crown", on_click=self.staff_menu)
        player.send_form(form)

    def staff_menu(self, player):
        """Only Minigame Staff see this button."""
        if not self.is_staff(player):
            return
        p = len(self.pending())
        form = ActionForm(title="§l§dMinigame Staff", content="Accept or decline host requests and manage running games.")
        form.add_button(f"§lHost requests ({p})§r\n§8Accept or decline", icon="textures/ui/mail_icon", on_click=self.review_menu)
        form.add_button("§lManage minigames§r\n§8Rooms, close sign-ups, end a game", icon="textures/ui/settings_glyph_color_2x",
                        on_click=self.manage_menu)
        if player.is_op:
            form.add_button("§6§lSet up minigames§r\n§8Names, backstage rooms, entrances", icon="textures/ui/hammer_l",
                            on_click=self.setup_menu)
        form.add_button("§l< Back", on_click=self.open)
        player.send_form(form)

    # ---------- hosting ----------
    def host_form(self, player):
        if self.plan_level(player) < 1 and not player.is_op:
            player.send_message("§cHosting minigames is for Galaxy+ and Pro+ players. §7galaxymc.us/store")
            return
        mine = [e for e in self.events.values() if e["host"] == str(player.xuid) and e["status"] in ("pending", "accepted")]
        if mine:
            e = mine[0]
            if e["status"] == "accepted":
                return self.manage(player, e["id"])  # your running game: close sign-ups, end it
            form = ActionForm(title="Your request", content=f"Your {self.game_name(e)} is waiting for Minigame Staff to accept it.")
            form.add_button("§cCancel my request", on_click=lambda p: self._cancel_request(p, e["id"]))
            form.add_button("§l< Back", on_click=self.open)
            player.send_form(form)
            return
        types = sorted(self.types.values(), key=lambda t: t["name"].lower())
        choices = [t["name"] for t in types] + ["Custom (type a name below)"]
        controls = [
            Dropdown("Minigame", choices, 0),
            TextInput("Custom minigame name (only for Custom)", "e.g. Hide and Seek", ""),
            Dropdown("Who can join", [n for _, n in ACCESS], 0),
            Dropdown("Sign-up time (starts when staff accept)", [f"{m} minutes" for m in SIGNUP_MINUTES], 1),
            TextInput("Notes for staff (optional)", "e.g. Need 4+ players, prizes $500", ""),
        ]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            pick = int(v[0])
            custom = " ".join(str(v[1]).split())[:32]
            if pick >= len(types) and not custom:
                p.send_message("§cType a name for your custom minigame.")
                return
            ev = {
                "host": str(p.xuid), "host_name": p.name, "host_uuid": str(p.unique_id),
                "type_id": types[pick]["id"] if pick < len(types) else None,
                "custom": custom if pick >= len(types) else "",
                "access": ACCESS[int(v[2])][0], "signup_minutes": SIGNUP_MINUTES[int(v[3])],
                "notes": str(v[4]).strip()[:120], "status": "pending", "created": time.time(), "players": [],
            }
            cur = self.db.execute("INSERT INTO minigame_events (data) VALUES (?)", (json.dumps(ev),))
            self.db.commit()
            ev["id"] = cur.lastrowid
            self.events[ev["id"]] = ev
            self.save(ev["id"])
            p.send_message(f"§aRequest sent! §7Minigame Staff will accept or decline your {self.game_name(ev)}. You'll get a message.")
            for s in self.plugin.server.online_players:
                if self.is_staff(s) and s is not p:
                    s.send_message(f"§d{p.name} wants to host {self.game_name(ev)}. §7Open a Minigame Computer to review.")
                    try:
                        s.send_toast("Minigame request", f"{p.name}: {self.game_name(ev)}")
                    except Exception:
                        pass

        player.send_form(ModalForm(title="Host a Minigame", controls=controls, submit_button="Send request", on_submit=submit))

    def _cancel_request(self, player, eid):
        e = self.events.get(eid)
        if e and e["status"] == "pending" and e["host"] == str(player.xuid):
            e.update({"status": "declined", "declined_by": player.name, "ended_at": time.time()})
            self.save(eid)
            player.send_message("§7Request cancelled.")

    # ---------- staff: requests ----------
    def review_menu(self, player):
        if not self.is_staff(player):
            return
        reqs = sorted(self.pending(), key=lambda e: e["created"])
        form = ActionForm(title="Host requests", content="Tap a request to accept or decline it." if reqs else "No requests right now.")
        for e in reqs:
            form.add_button(f"§l{self.game_name(e)}§r\n§8by {e['host_name']} · {dict(ACCESS)[e['access']]} · {e['signup_minutes']}m sign-up",
                            on_click=lambda p, eid=e["id"]: self.review(p, eid))
        form.add_button("§l< Back", on_click=self.staff_menu)
        player.send_form(form)

    def review(self, player, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "pending":
            player.send_message("§eThat request was already handled.")
            return
        custom = not e.get("type_id")
        lines = [f"§l{self.game_name(e)}§r{' §7(custom)' if custom else ''}", f"Host: §f{e['host_name']}",
                 f"Who can join: §f{dict(ACCESS)[e['access']]}", f"Sign-up time: §f{e['signup_minutes']} minutes"]
        if e.get("notes"):
            lines.append(f"Notes: §f{e['notes']}")
        if custom:
            lines += ["", "§eCustom game: if you accept, where you're standing now becomes its backstage room and "
                          "entrance. You can change them in Manage minigames."]
        form = ActionForm(title="Host request", content="\n".join(lines))
        form.add_button("§2§lAccept", on_click=lambda p: self.accept(p, eid))
        form.add_button("§c§lDecline", on_click=lambda p: self.decline_form(p, eid))
        form.add_button("§l< Back", on_click=self.review_menu)
        player.send_form(form)

    def accept(self, staff, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "pending":
            staff.send_message("§eThat request was already handled.")
            return
        now = time.time()
        e.update({"status": "accepted", "accepted_by": staff.name, "accepted_uuid": str(staff.unique_id),
                  "accepted_at": now, "signup_ends": now + e["signup_minutes"] * 60, "ends": now + MAX_HOURS * 3600})
        t = self.types.get(e.get("type_id"))
        e["backstage"] = (t or {}).get("backstage") or spot(staff)
        e["entrance"] = (t or {}).get("entrance") or spot(staff)
        self.save(eid)
        host = self.online(e["host"])
        if host is not None:
            self.tpd[str(host.unique_id)] = {"to": str(staff.unique_id), "name": staff.name, "until": now + TPD_MINUTES * 60}
        self.mail(e["host"], f"§a§lYour {self.game_name(e)} was accepted by {staff.name}! §r§7Type §e/tpd§7 to teleport to them. "
                             f"Sign-ups are open for {e['signup_minutes']} minutes.")
        staff.send_message(f"§aAccepted {e['host_name']}'s {self.game_name(e)}. §7They can /tpd to you.")
        for p in self.plugin.server.online_players:
            if p is not staff and str(p.xuid) != e["host"] and self.plan_level(p) >= ACCESS_LEVEL[e["access"]]:
                p.send_message(f"§b§l{self.game_name(e)}§r§b is taking players for {e['signup_minutes']} minutes! "
                               "§7Join at a Minigame Computer or /minigames.")

    def decline_form(self, staff, eid):
        def submit(p, data):
            try:
                reason = str(json.loads(data)[0]).strip()[:120]
            except (ValueError, IndexError):
                reason = ""
            e = self.events.get(eid)
            if not e or e["status"] != "pending":
                return
            e.update({"status": "declined", "declined_by": p.name})
            self.save(eid)
            self.mail(e["host"], f"§cYour {self.game_name(e)} request was declined by {p.name}." + (f" §7Reason: {reason}" if reason else ""))
            p.send_message("§7Request declined.")
        staff.send_form(ModalForm(title="Decline request", controls=[TextInput("Reason (optional, the host sees it)", "e.g. Not enough staff right now", "")],
                                  submit_button="Decline", on_submit=submit))

    # ---------- /tpd ----------
    def tpd_command(self, player):
        t = self.tpd.get(str(player.unique_id))
        if not t or t["until"] < time.time():
            self.tpd.pop(str(player.unique_id), None)
            player.send_message("§eYou have no teleport waiting. §7/tpd is used when something sends you somewhere, "
                                "like a staff member accepting your minigame.")
            return
        import uuid as _uuid
        target = self.plugin.server.get_player(_uuid.UUID(t["to"]))
        if target is None:
            player.send_message(f"§c{t['name']} isn't online right now.")
            return
        self.tpd.pop(str(player.unique_id), None)
        self.teleport(player, spot(target), t["name"])

    def teleport(self, player, where, label):
        tp = getattr(self.plugin, "teleports", None)
        if tp is None:
            return
        tp.back[str(player.unique_id)] = spot(player)
        player.teleport(tp.location(where))
        player.send_message(f"§aTeleported to {label}.")

    # ---------- joining and watching ----------
    def join_menu(self, player):
        games = sorted(self.open_for_signup(), key=lambda e: e["signup_ends"])
        level = self.plan_level(player)
        form = ActionForm(title="Join a Minigame", content="Games taking players right now." if games else
                          "No games are taking players right now. §7Watch for announcements in chat!")
        for e in games:
            ok = level >= ACCESS_LEVEL[e["access"]] or player.is_op
            lock = "" if ok else f" §c({dict(ACCESS)[e['access']]})"
            form.add_button(f"§l{self.game_name(e)}{lock}§r\n§8by {e['host_name']} · {len(e['players'])} joined · {mins_left(e['signup_ends'])} left",
                            on_click=lambda p, eid=e["id"]: self.join_detail(p, eid))
        form.add_button("§l< Back", on_click=self.open)
        player.send_form(form)

    def join_detail(self, player, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "accepted":
            return self.join_menu(player)
        content = (f"§l{self.game_name(e)}§r\nHost: §f{e['host_name']}§r\nWho can join: §f{dict(ACCESS)[e['access']]}§r\n"
                   f"Players: §f{len(e['players'])}§r\nSign-ups close in: §f{mins_left(e['signup_ends'])}§r\n\n"
                   "§7Enter teleports you to the players' room backstage.")
        form = ActionForm(title="Join a Minigame", content=content)
        form.add_button("§2§lEnter", on_click=lambda p: self.enter(p, eid))
        form.add_button("§l< Back", on_click=self.join_menu)
        player.send_form(form)

    def enter(self, player, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "accepted" or e.get("signup_ends", 0) < time.time():
            player.send_message("§cSign-ups for that game have closed.")
            return
        if self.plan_level(player) < ACCESS_LEVEL[e["access"]] and not player.is_op:
            player.send_message(f"§cThis game is for {dict(ACCESS)[e['access']]} players. §7galaxymc.us/store")
            return
        if str(player.xuid) not in e["players"]:
            e["players"].append(str(player.xuid))
            e.setdefault("player_names", {})[str(player.xuid)] = player.name
            self.save(eid)
        self.teleport(player, e["backstage"], f"{self.game_name(e)} (backstage)")
        host = self.online(e["host"])
        if host is not None and host is not player:
            host.send_message(f"§7{player.name} joined your {self.game_name(e)} ({len(e['players'])} players).")

    def watch_menu(self, player):
        games = sorted(self.live(), key=lambda e: e["accepted_at"])
        form = ActionForm(title="Watch a Minigame", content="Tap a game to go to its entrance." if games else "No games are going on right now.")
        for e in games:
            state = f"sign-ups {mins_left(e['signup_ends'])}" if e["signup_ends"] > time.time() else "in progress"
            form.add_button(f"§l{self.game_name(e)}§r\n§8by {e['host_name']} · {len(e['players'])} players · {state}",
                            on_click=lambda p, eid=e["id"]: self.watch(p, eid))
        form.add_button("§l< Back", on_click=self.open)
        player.send_form(form)

    def watch(self, player, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "accepted":
            player.send_message("§eThat game has ended.")
            return
        self.teleport(player, e.get("entrance") or e["backstage"], f"{self.game_name(e)} (entrance)")

    # ---------- staff / host: managing games ----------
    def manage_menu(self, player):
        games = [e for e in self.live() if self.is_staff(player) or e["host"] == str(player.xuid)]
        form = ActionForm(title="Manage minigames", content="Running games." if games else "No games are running.")
        for e in games:
            form.add_button(f"§l{self.game_name(e)}§r\n§8by {e['host_name']} · {len(e['players'])} players",
                            on_click=lambda p, eid=e["id"]: self.manage(p, eid))
        form.add_button("§l< Back", on_click=lambda p: self.staff_menu(p) if self.is_staff(p) else self.open(p))
        player.send_form(form)

    def manage(self, player, eid):
        e = self.events.get(eid)
        if not e or e["status"] != "accepted":
            return
        names = ", ".join((e.get("player_names") or {}).values()) or "nobody yet"
        form = ActionForm(title=self.game_name(e), content=f"Host: {e['host_name']} · accepted by {e.get('accepted_by')}\nPlayers: {names}")
        if self.is_staff(player):
            form.add_button("Set backstage room to where I'm standing", on_click=lambda p: self._set_room(p, eid, "backstage"))
            form.add_button("Set entrance to where I'm standing", on_click=lambda p: self._set_room(p, eid, "entrance"))
        if e["signup_ends"] > time.time():
            form.add_button("Close sign-ups now", on_click=lambda p: self._close_signups(p, eid))
        form.add_button("§c§lEnd this minigame", on_click=lambda p: self.end(p, eid))
        form.add_button("§l< Back", on_click=self.manage_menu)
        player.send_form(form)

    def _set_room(self, player, eid, which):
        self.events[eid][which] = spot(player)
        self.save(eid)
        player.send_message(f"§a{'Backstage room' if which == 'backstage' else 'Entrance'} set.")

    def _close_signups(self, player, eid):
        self.events[eid]["signup_ends"] = time.time()
        self.save(eid)
        player.send_message("§aSign-ups closed.")

    def end(self, player, eid):
        e = self.events.get(eid)
        if not e:
            return
        e.update({"status": "ended", "ended_at": time.time()})
        self.save(eid)
        player.send_message(f"§a{self.game_name(e)} ended. Thanks for hosting!")
        if e["host"] != str(player.xuid):
            self.mail(e["host"], f"§7Your {self.game_name(e)} was ended by {player.name}.")

    # ---------- admins: the minigame list ----------
    def setup_menu(self, player):
        if not player.is_op:
            return
        form = ActionForm(title="Set up minigames", content="Hosts pick from these. Each needs a backstage room "
                          "(where players wait) and an entrance (where watchers go).")
        form.add_button("§2§lAdd a minigame", on_click=self.add_type_form)
        for t in sorted(self.types.values(), key=lambda t: t["name"].lower()):
            ready = "ready" if t.get("backstage") and t.get("entrance") else "§cneeds rooms"
            form.add_button(f"§l{t['name']}§r\n§8{ready}", on_click=lambda p, tid=t["id"]: self.type_menu(p, tid))
        form.add_button("§l< Back", on_click=self.staff_menu)
        player.send_form(form)

    def add_type_form(self, player):
        def submit(p, data):
            try:
                name = " ".join(str(json.loads(data)[0]).split())[:32]
            except (ValueError, IndexError):
                return
            if not name:
                return
            cur = self.db.execute("INSERT INTO minigame_types (data) VALUES (?)", (json.dumps({"name": name}),))
            self.db.commit()
            tid = cur.lastrowid
            self.types[tid] = {"id": tid, "name": name, "backstage": None, "entrance": None}
            self.save_type(tid)
            p.send_message(f"§aAdded {name}. §7Now go to its backstage room and entrance and set them.")
            self.type_menu(p, tid)
        player.send_form(ModalForm(title="Add a minigame", controls=[TextInput("Name", "e.g. Spleef", "")],
                                   submit_button="Add", on_submit=submit))

    def type_menu(self, player, tid):
        t = self.types.get(tid)
        if not t:
            return
        def fmt(s):
            return f"{s['dim']} {round(s['x'])}, {round(s['y'])}, {round(s['z'])}" if s else "§cnot set"
        form = ActionForm(title=t["name"], content=f"Backstage room: {fmt(t.get('backstage'))}§r\nEntrance: {fmt(t.get('entrance'))}")

        def set_room(p, which):
            t[which] = spot(p)
            self.save_type(tid)
            p.send_message(f"§a{t['name']}: {'backstage room' if which == 'backstage' else 'entrance'} set to here.")
            self.type_menu(p, tid)

        def delete(p):
            self.types.pop(tid, None)
            self.db.execute("DELETE FROM minigame_types WHERE id = ?", (tid,))
            self.db.commit()
            p.send_message(f"§7Removed {t['name']}.")
            self.setup_menu(p)
        form.add_button("Set backstage room to where I'm standing", on_click=lambda p: set_room(p, "backstage"))
        form.add_button("Set entrance to where I'm standing", on_click=lambda p: set_room(p, "entrance"))
        form.add_button("§cRemove this minigame", on_click=delete)
        form.add_button("§l< Back", on_click=self.setup_menu)
        player.send_form(form)

    # ---------- housekeeping + website ----------
    def tick(self):
        now = time.time()
        for e in list(self.events.values()):
            if e["status"] == "accepted" and e.get("ends", now + 1) < now:
                e.update({"status": "ended", "ended_at": now})
                self.save(e["id"])
            elif e["status"] == "pending" and now - e["created"] > 24 * 3600:
                e["status"] = "declined"
                self.save(e["id"])
                self.mail(e["host"], f"§7Your {self.game_name(e)} request expired (no staff answered within a day).")
        old = [i for i, e in self.events.items() if e["status"] in ("ended", "declined") and now - e.get("ended_at", e["created"]) > 7 * 86400]
        for i in old:
            self.events.pop(i, None)
            self.db.execute("DELETE FROM minigame_events WHERE id = ?", (i,))
        if old:
            self.db.commit()
        self.push()

    def payload(self):
        out = []
        for e in sorted(self.live(), key=lambda e: e["accepted_at"]):
            out.append({"id": e["id"], "game": self.game_name(e), "host": e["host_name"], "access": e["access"],
                        "players": len(e["players"]), "signupEnds": int(e["signup_ends"]), "acceptedBy": e.get("accepted_by")})
        return out

    def push(self):
        voice = getattr(self.plugin, "_voice", None)
        if voice and voice.ws:
            voice.send_json({"type": "events", "events": self.payload()})
