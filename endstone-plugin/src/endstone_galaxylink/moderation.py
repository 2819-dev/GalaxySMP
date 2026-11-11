"""In-game moderation: /report for players, and the /mod panel for staff.

/report             pick a player, a reason and details. Staff in game get an alert right away,
                    and the report shows on galaxymc.us (Staff Tools > Reports).
/mod                staff panel: online players, find a player, open reports, block logs.
                    For a player: warn, mute / unmute, kick, ban / unban (needs /modban), history,
                    teleport to them, their recent block changes.
/modban <player>    straight to the ban screen.

Mutes and bans work even when the website is down: the server keeps them itself (bans use
Endstone's ban list, so banned players can't join). Every action is also sent to the website's
audit log; if the website can't be reached, it's kept and sent later.

Staff can't moderate themselves, server operators (unless they're one too, or it's the console),
or other staff (unless they're an operator).
"""

import datetime
import json
import threading
import time

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput
from endstone_galaxylink.announcements import show_title

REPORT_REASONS = ["Cheating or hacking", "Griefing", "Stealing", "Bad language", "Bullying or harassment", "Spam", "Other"]
MUTE_CHOICES = [(10, "10 minutes"), (60, "1 hour"), (1440, "1 day"), (10080, "7 days"), (43200, "30 days")]
BAN_CHOICES = [(1440, "1 day"), (10080, "7 days"), (43200, "30 days"), (None, "Permanent")]
REPORT_COOLDOWN = 60
MOD_PERMISSION = "galaxylink.command.mod"
BAN_PERMISSION = "galaxylink.command.modban"
CHAT_COMMANDS = {"msg", "tell", "w", "whisper", "me", "say", "tellraw"}
WEBSITE = "galaxymc.us"


def length_text(minutes):
    if minutes is None:
        return "permanently"
    for m, label in MUTE_CHOICES + BAN_CHOICES:
        if m == minutes:
            return f"for {label}"
    return f"for {minutes} minutes"


def time_left(until):
    s = max(0, int(until - time.time()))
    if s >= 86400:
        return f"{s // 86400}d {(s % 86400) // 3600}h"
    if s >= 3600:
        return f"{s // 3600}h {(s % 3600) // 60}m"
    return f"{max(1, s // 60)}m"


def ago(t):
    s = max(0, int(time.time() - t))
    if s < 3600:
        return f"{max(1, s // 60)}m ago"
    if s < 86400:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


def clean(text, n):
    return " ".join(str(text or "").split())[:n]


class Moderation:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("""CREATE TABLE IF NOT EXISTS mod_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, xuid TEXT, name TEXT, kind TEXT, reason TEXT, minutes INTEGER, by TEXT, t REAL)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS mod_history_xuid ON mod_history (xuid, t)")
        self.db.commit()
        self.mutes = self.eco.get_config("mutes") or {}        # xuid -> {until, reason, by, name}
        self.outbox = self.eco.get_config("web_outbox") or []  # website calls waiting to be sent
        self.sending = False
        self.last_report = {}

    # ---------- helpers ----------
    def is_staff(self, p):
        if getattr(p, "is_op", False):
            return True
        try:
            return bool(p.has_permission(MOD_PERMISSION))
        except Exception:
            return False

    def can_ban(self, p):
        if getattr(p, "is_op", False):
            return True
        try:
            return bool(p.has_permission(BAN_PERMISSION))
        except Exception:
            return False

    def staff_online(self):
        return [p for p in self.plugin.server.online_players if self.is_staff(p)]

    def online(self, xuid):
        for p in self.plugin.server.online_players:
            if str(p.xuid) == str(xuid):
                return p
        return None

    def known(self, name):
        """(xuid, exact name) of a player who has been on the server, online or not."""
        low = clean(name, 32).lower().lstrip(".")
        if not low:
            return None
        for p in self.plugin.server.online_players:
            if p.name.lower() == low:
                return str(p.xuid), p.name
        row = self.db.execute("SELECT xuid, name FROM balances WHERE lower(name) = ?", (low,)).fetchone()
        if row:
            return str(row[0]), row[1]
        row = self.db.execute("SELECT xuid, name FROM mod_history WHERE lower(name) = ? ORDER BY t DESC LIMIT 1", (low,)).fetchone()
        if row:
            return str(row[0]), row[1]
        matches = [p for p in self.plugin.server.online_players if p.name.lower().startswith(low)]
        if len(matches) == 1:
            return str(matches[0].xuid), matches[0].name
        return None

    def protected(self, actor, xuid):
        """Why actor can't act on this player, or None if they can."""
        if not hasattr(actor, "xuid"):
            return None  # the console
        if str(actor.xuid) == str(xuid):
            return "You can't do that to yourself."
        target = self.online(xuid)
        if target is not None:
            if target.is_op and not actor.is_op:
                return "You can't moderate a server operator."
            if target.is_op and actor.is_op:
                return "Operators can't moderate each other in game. Use the console."
            if self.is_staff(target) and not actor.is_op:
                return "Only operators can moderate other staff."
        return None

    def record(self, kind, xuid, name, actor, reason="", minutes=None):
        by = getattr(actor, "name", "Console")
        self.db.execute("INSERT INTO mod_history (xuid, name, kind, reason, minutes, by, t) VALUES (?,?,?,?,?,?,?)",
                        (str(xuid), name, kind, reason, minutes, by, time.time()))
        self.db.commit()
        self.send("/api/plugin/punish", {"kind": kind, "xuid": str(xuid), "name": name, "reason": reason, "minutes": minutes,
                                         "by": by, "byXuid": str(getattr(actor, "xuid", "") or ""), "at": time.time()})
        for s in self.staff_online():
            if s is not actor:
                s.send_message(f"§7[Staff] {by} {self.describe(kind, minutes)} {name}{f': {reason}' if reason else ''}")

    @staticmethod
    def describe(kind, minutes):
        return {"warn": "warned", "mute": f"muted ({length_text(minutes)})", "unmute": "unmuted", "kick": "kicked",
                "ban": f"banned ({length_text(minutes)})", "unban": "unbanned"}.get(kind, kind)

    # ---------- talking to the website (on a background thread) ----------
    def _thread(self, fn):
        threading.Thread(target=fn, daemon=True).start()

    def _main(self, fn):
        self.plugin.server.scheduler.run_task(self.plugin, fn)

    def web(self, path, body, done):
        """Calls the website and hands (ok, data) to done() on the main thread."""
        def work():
            try:
                status, data = self.plugin._request(path, body)
                ok = status == 200 and data.get("ok", True)
            except Exception:
                ok, data = False, {}
            self._main(lambda: done(ok, data))
        self._thread(work)

    def send(self, path, body):
        """Fire-and-forget website call that is retried until it gets through."""
        self.outbox.append({"path": path, "body": body})
        self.outbox = self.outbox[-500:]
        self.eco.set_config("web_outbox", self.outbox)
        self.flush()

    def flush(self):
        if self.sending or not self.outbox or not getattr(self.plugin, "_voice", None):
            return
        self.sending = True
        batch = list(self.outbox)

        def work():
            sent = []
            for item in batch:
                try:
                    status, _ = self.plugin._request(item["path"], item["body"])
                except Exception:
                    break
                if status in (200, 400):  # 400 = the website will never accept it; drop it
                    sent.append(item)
                else:
                    break

            def finish():
                self.outbox = [i for i in self.outbox if i not in sent]
                self.eco.set_config("web_outbox", self.outbox)
                self.sending = False
            self._main(finish)
        self._thread(work)

    def tick(self):
        """Every 30 seconds: unmute expired mutes, retry website calls."""
        now = time.time()
        expired = [x for x, m in self.mutes.items() if m.get("until") and m["until"] <= now]
        for x in expired:
            self.mutes.pop(x, None)
            p = self.online(x)
            if p:
                p.send_message("§aYour mute is over. You can chat again.")
        if expired:
            self.eco.set_config("mutes", self.mutes)
        self.flush()

    # ---------- enforcement ----------
    def muted(self, player):
        m = self.mutes.get(str(player.xuid))
        if m and m.get("until", 0) > time.time():
            return m
        return None

    def on_chat(self, event):
        m = self.muted(event.player)
        if m:
            event.cancel()
            event.player.send_message(f"§cYou are muted for {time_left(m['until'])} more.{' Reason: ' + m['reason'] if m.get('reason') else ''}")
            return True
        return False

    def on_command(self, event):
        word = str(event.command).lstrip("/").split(" ")[0].lower()
        if word in CHAT_COMMANDS and self.muted(event.player):
            event.cancel()
            event.player.send_message("§cYou can't send messages while you're muted.")

    def on_join(self, player):
        m = self.muted(player)
        if m:
            player.send_message(f"§cYou are muted for {time_left(m['until'])} more.")
        if self.is_staff(player):
            def done(ok, data):
                n = len(data.get("reports") or []) if ok else 0
                if n and self.online(player.xuid):
                    player.send_message(f"§e[Staff] {n} open report{'s' if n != 1 else ''}. §7Type /mod to see them.")
            self.web("/api/plugin/reports", None, done)

    # ---------- actions ----------
    def warn(self, actor, xuid, name, reason):
        why = self.protected(actor, xuid)
        if why:
            return actor.send_message("§c" + why)
        p = self.online(xuid)
        if p:
            p.send_message(f"§c§l[Warning]§r§c {reason or 'Please follow the server rules.'}§7 (from {getattr(actor, 'name', 'staff')})")
            try:
                show_title(self.plugin, p, "§c§lWarning", reason or "Please follow the rules", 10, 80, 20)
            except Exception:
                pass
        self.record("warn", xuid, name, actor, reason)
        n = self.db.execute("SELECT count(*) FROM mod_history WHERE xuid = ? AND kind = 'warn'", (str(xuid),)).fetchone()[0]
        actor.send_message(f"§aWarned {name}. §7They now have {n} warning{'s' if n != 1 else ''}.")

    def mute(self, actor, xuid, name, minutes, reason):
        why = self.protected(actor, xuid)
        if why:
            return actor.send_message("§c" + why)
        self.mutes[str(xuid)] = {"until": time.time() + minutes * 60, "reason": reason, "by": getattr(actor, "name", "Console"), "name": name}
        self.eco.set_config("mutes", self.mutes)
        p = self.online(xuid)
        if p:
            p.send_message(f"§cYou have been muted {length_text(minutes)}.{' Reason: ' + reason if reason else ''}")
        self.record("mute", xuid, name, actor, reason, minutes)
        actor.send_message(f"§aMuted {name} {length_text(minutes)}.")

    def unmute(self, actor, xuid, name):
        if self.mutes.pop(str(xuid), None) is None:
            return actor.send_message(f"§7{name} isn't muted.")
        self.eco.set_config("mutes", self.mutes)
        p = self.online(xuid)
        if p:
            p.send_message("§aYou have been unmuted.")
        self.record("unmute", xuid, name, actor)
        actor.send_message(f"§aUnmuted {name}.")

    def kick(self, actor, xuid, name, reason):
        why = self.protected(actor, xuid)
        if why:
            return actor.send_message("§c" + why)
        p = self.online(xuid)
        if not p:
            return actor.send_message(f"§7{name} isn't online.")
        p.kick(f"§cYou were kicked from GalaxySMP.\n§7{reason or 'Please follow the server rules.'}")
        self.record("kick", xuid, name, actor, reason)
        actor.send_message(f"§aKicked {name}.")

    def ban(self, actor, xuid, name, minutes, reason):
        if hasattr(actor, "xuid") and not self.can_ban(actor):
            return actor.send_message("§cYou don't have permission to ban.")
        why = self.protected(actor, xuid)
        if why:
            return actor.send_message("§c" + why)
        expires = None if minutes is None else datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=minutes)
        text = f"Banned from GalaxySMP {length_text(minutes)}. Reason: {reason or 'Breaking the rules'}"
        try:
            self.plugin.server.ban_list.add_ban(name, xuid=str(xuid), reason=text, expires=expires, source=getattr(actor, "name", "Console"))
        except Exception as e:
            self.plugin.logger.warning(f"Ban failed: {e}")
            return actor.send_message("§cCouldn't ban that player. Check the server log.")
        p = self.online(xuid)
        if p:
            p.kick(f"§c{text}\n§7Questions? Visit {WEBSITE}")
        self.record("ban", xuid, name, actor, reason, minutes)
        actor.send_message(f"§aBanned {name} {length_text(minutes)}.")

    def unban(self, actor, xuid, name):
        if hasattr(actor, "xuid") and not self.can_ban(actor):
            return actor.send_message("§cYou don't have permission to unban.")
        bl = self.plugin.server.ban_list
        if not bl.is_banned(name, xuid=str(xuid)):
            return actor.send_message(f"§7{name} isn't banned.")
        bl.remove_ban(name, xuid=str(xuid))
        self.record("unban", xuid, name, actor)
        actor.send_message(f"§aUnbanned {name}.")

    def is_banned(self, xuid, name):
        try:
            return self.plugin.server.ban_list.is_banned(name, xuid=str(xuid))
        except Exception:
            return False

    # ---------- /report ----------
    def report_command(self, player, args):
        wait = REPORT_COOLDOWN - (time.time() - self.last_report.get(str(player.xuid), 0))
        if wait > 0:
            return player.send_message(f"§ePlease wait {int(wait)}s before sending another report.")
        others = [p.name for p in self.plugin.server.online_players if p is not player]
        typed = clean(" ".join(args), 32)
        names = others + ["Someone else (type their name below)"]
        pick = names.index(typed) if typed in others else len(names) - 1

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            i = int(v[0])
            target = clean(v[1], 32) if i >= len(others) or clean(v[1], 32) else others[i]
            if not target:
                return p.send_message("§cType the name of the player you're reporting.")
            if target.lower() == p.name.lower():
                return p.send_message("§cYou can't report yourself.")
            self.submit_report(p, target, REPORT_REASONS[int(v[2])], clean(v[3], 300))

        player.send_form(ModalForm(
            title="§l§cReport a player",
            controls=[
                Dropdown("Who are you reporting?", names, pick),
                TextInput("Their name (only if they're not in the list)", "Gamertag", typed if typed and typed not in others else ""),
                Dropdown("What happened?", REPORT_REASONS, 0),
                TextInput("Details (optional)", "e.g. They broke my house at my plot", ""),
            ],
            submit_button="Send report", on_submit=submit))

    def submit_report(self, player, target, reason, details):
        self.last_report[str(player.xuid)] = time.time()
        found = self.known(target)
        l = player.location
        body = {"reporter": player.name, "reporterXuid": str(player.xuid), "target": found[1] if found else target,
                "targetXuid": found[0] if found else None, "reason": reason, "details": details,
                "world": player.dimension.name, "x": int(l.x), "y": int(l.y), "z": int(l.z)}
        self.send("/api/plugin/report", body)
        player.send_message("§aReport sent. §7Thank you for helping keep GalaxySMP safe. Staff will look into it.")
        for s in self.staff_online():
            if s is player:
                continue
            s.send_message(f"§c[Report] §f{player.name}§7 reported §f{body['target']}§7: {reason}{' - ' + details if details else ''}. §eType /mod to handle it.")
            try:
                s.send_toast("§cNew report", f"{body['target']}: {reason}")
                s.play_sound(s.location, "note.pling", 1.0, 1.2)
            except Exception:
                pass

    # ---------- /mod panel ----------
    def panel(self, player):
        if not self.is_staff(player):
            return player.send_message("§cOnly staff can use /mod.")
        form = ActionForm(title="§l§cModeration", content="Choose a player or check reports.")
        form.add_button(f"§lOnline players§r\n§8{len(self.plugin.server.online_players)} online", icon="textures/ui/multiplayer_glyph_color",
                        on_click=self.online_menu)
        form.add_button("§lFind a player§r\n§8Works for offline players too", icon="textures/ui/magnifyingGlass", on_click=self.find_form)
        form.add_button("§lReports§r\n§8Made with /report", icon="textures/ui/mail_icon", on_click=self.reports_menu)
        form.add_button(f"§lMuted players§r\n§8{len(self.mutes)} muted", icon="textures/ui/mute_on", on_click=self.muted_menu)
        bl = getattr(self.plugin, "blocklog", None)
        if bl:
            form.add_button("§lBlock logs§r\n§8Inspector and rollback", icon="textures/ui/magnifying_glass", on_click=bl.menu)
        player.send_form(form)

    def online_menu(self, player):
        form = ActionForm(title="Online players", content="Tap a player.")
        for p in sorted(self.plugin.server.online_players, key=lambda x: x.name.lower()):
            tag = " §c(muted)" if self.muted(p) else ""
            form.add_button(f"{p.name}{tag}", on_click=lambda s, x=str(p.xuid), n=p.name: self.player_menu(s, x, n))
        form.add_button("§l< Back", on_click=self.panel)
        player.send_form(form)

    def find_form(self, player):
        def submit(p, data):
            try:
                name = clean(json.loads(data)[0], 32)
            except (ValueError, IndexError):
                return
            found = self.known(name)
            if not found:
                return p.send_message(f"§cNo player called {name} has been on the server.")
            self.player_menu(p, *found)
        player.send_form(ModalForm(title="Find a player", controls=[TextInput("Gamertag", "e.g. Steve123", "")],
                                   submit_button="Find", on_submit=submit))

    def muted_menu(self, player):
        form = ActionForm(title="Muted players", content="Tap a player to unmute them." if self.mutes else "Nobody is muted.")
        for x, m in self.mutes.items():
            form.add_button(f"{m.get('name', x)}\n§8{time_left(m['until'])} left", on_click=lambda s, x=x, n=m.get("name", x): self.player_menu(s, x, n))
        form.add_button("§l< Back", on_click=self.panel)
        player.send_form(form)

    def player_menu(self, player, xuid, name):
        if not self.is_staff(player):
            return
        online = self.online(xuid)
        m = self.mutes.get(str(xuid))
        banned = self.is_banned(xuid, name)
        warns = self.db.execute("SELECT count(*) FROM mod_history WHERE xuid = ? AND kind = 'warn'", (str(xuid),)).fetchone()[0]
        status = [("§aOnline" if online else "§7Offline"), f"{warns} warning{'s' if warns != 1 else ''}"]
        if m:
            status.append(f"§cMuted ({time_left(m['until'])} left)")
        if banned:
            status.append("§4Banned")
        form = ActionForm(title=f"§l{name}", content=" · ".join(status))
        form.add_button("§lWarn", icon="textures/ui/WarningGlyph", on_click=lambda s: self.reason_form(s, "Warn " + name, lambda r: self.warn(s, xuid, name, r)))
        if m:
            form.add_button("§lUnmute", icon="textures/ui/mute_off", on_click=lambda s: self.unmute(s, xuid, name))
        else:
            form.add_button("§lMute", icon="textures/ui/mute_on", on_click=lambda s: self.length_form(s, "Mute " + name, MUTE_CHOICES,
                                                                                                    lambda mins, r: self.mute(s, xuid, name, mins, r)))
        if online:
            form.add_button("§lKick", icon="textures/ui/cancel", on_click=lambda s: self.reason_form(s, "Kick " + name, lambda r: self.kick(s, xuid, name, r)))
        if self.can_ban(player):
            if banned:
                form.add_button("§lUnban", icon="textures/ui/check", on_click=lambda s: self.unban(s, xuid, name))
            else:
                form.add_button("§4§lBan", icon="textures/ui/hammer_l", on_click=lambda s: self.ban_form(s, xuid, name))
        form.add_button("§lHistory", icon="textures/ui/book_edit_default", on_click=lambda s: self.history(s, xuid, name))
        if online:
            form.add_button("§lTeleport to them", icon="textures/ui/move", on_click=lambda s: self.tp_to_player(s, xuid))
        bl = getattr(self.plugin, "blocklog", None)
        if bl:
            form.add_button("§lTheir block changes", icon="textures/ui/magnifying_glass", on_click=lambda s: bl.player_changes(s, xuid, name))
        form.add_button("§l< Back", on_click=self.panel)
        player.send_form(form)

    def reason_form(self, player, title, then):
        def submit(p, data):
            try:
                then(clean(json.loads(data)[0], 300))
            except (ValueError, IndexError):
                pass
        player.send_form(ModalForm(title=title, controls=[TextInput("Reason (the player sees it)", "e.g. Spamming chat", "")],
                                   submit_button="Confirm", on_submit=submit))

    def length_form(self, player, title, choices, then):
        def submit(p, data):
            try:
                v = json.loads(data)
                then(choices[int(v[0])][0], clean(v[1], 300))
            except (ValueError, IndexError):
                pass
        player.send_form(ModalForm(title=title, controls=[Dropdown("How long?", [c[1] for c in choices], 1),
                                                          TextInput("Reason (the player sees it)", "e.g. Bad language", "")],
                                   submit_button="Confirm", on_submit=submit))

    def ban_form(self, player, xuid, name):
        self.length_form(player, "§4Ban " + name, BAN_CHOICES, lambda mins, r: self.ban(player, xuid, name, mins, r))

    def ban_command(self, sender, args):
        name = clean(" ".join(args), 32)
        found = self.known(name) if name else None
        if not found:
            return sender.send_message("§cUsage: /modban <player> (they must have been on the server before).")
        if not hasattr(sender, "send_form"):
            return self.ban(sender, found[0], found[1], None, "Banned by the console")
        self.ban_form(sender, *found)

    def history(self, player, xuid, name):
        rows = self.db.execute("SELECT kind, reason, minutes, by, t FROM mod_history WHERE xuid = ? ORDER BY t DESC LIMIT 15", (str(xuid),)).fetchall()
        lines = [f"§l{self.describe(k, m).capitalize()}§r by {b}, {ago(t)}{f': {r}' if r else ''}" for k, r, m, b, t in rows]
        form = ActionForm(title=f"History: {name}", content="\n".join(lines) if lines else "No warnings, mutes, kicks or bans.")
        form.add_button("§l< Back", on_click=lambda s: self.player_menu(s, xuid, name))
        player.send_form(form)

    def tp_to_player(self, player, xuid):
        target = self.online(xuid)
        if not target:
            return player.send_message("§7They're not online any more.")
        self.plugin.teleports.back[str(player.unique_id)] = self._spot(player)
        player.teleport(target.location)

    @staticmethod
    def _spot(p):
        l = p.location
        return {"dim": p.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch}

    # ---------- reports in game ----------
    def reports_menu(self, player):
        def done(ok, data):
            if not ok:
                return player.send_message("§cCouldn't reach the website. §7Reports are also on galaxymc.us (Staff Tools > Reports).")
            reports = data.get("reports") or []
            self._reports = {r["id"]: r for r in reports}
            form = ActionForm(title="§lReports", content=f"{len(reports)} open report{'s' if len(reports) != 1 else ''}." if reports else "There are no open reports.")
            for r in reports:
                form.add_button(f"§l{r['target']}§r: {r['reason']}\n§8by {r['reporter']}", on_click=lambda s, i=r["id"]: self.report_menu(s, i))
            form.add_button("§l< Back", on_click=self.panel)
            player.send_form(form)
        self.web("/api/plugin/reports", None, done)

    def report_menu(self, player, rid):
        r = getattr(self, "_reports", {}).get(rid)
        if not r:
            return self.reports_menu(player)
        where = f"\n§7Where: {r.get('world') or 'Overworld'} {r['x']}, {r['y']}, {r['z']}" if r.get("x") is not None else ""
        form = ActionForm(title=f"Report: {r['target']}",
                          content=f"§l{r['reason']}§r\n{r.get('details') or '(no details)'}\n\n§7Reported by {r['reporter']}{where}")
        found = self.known(r["target"])
        if found:
            form.add_button(f"§lModerate {found[1]}", icon="textures/ui/permissions_op_crown", on_click=lambda s: self.player_menu(s, *found))
        if r.get("x") is not None:
            form.add_button("§lGo to where it was reported", icon="textures/ui/move", on_click=lambda s: self.tp_to_report(s, r))
        form.add_button("§a§lMark resolved", on_click=lambda s: self.resolve(s, rid, "resolved"))
        form.add_button("§7§lDismiss", on_click=lambda s: self.resolve(s, rid, "dismissed"))
        form.add_button("§l< Back", on_click=self.reports_menu)
        player.send_form(form)

    def tp_to_report(self, player, r):
        spot = {"dim": r.get("world") or "Overworld", "x": r["x"] + 0.5, "y": r["y"], "z": r["z"] + 0.5}
        try:
            loc = self.plugin.teleports.location(spot)
        except Exception:
            return player.send_message("§cCouldn't find that place.")
        self.plugin.teleports.back[str(player.unique_id)] = self._spot(player)
        player.teleport(loc)

    def resolve(self, player, rid, outcome):
        def done(ok, data):
            if ok:
                player.send_message("§aReport resolved." if outcome == "resolved" else "§7Report dismissed.")
            else:
                player.send_message("§c" + (data.get("message") or "Couldn't reach the website. Try again."))
            self.reports_menu(player)
        self.web("/api/plugin/reports/resolve", {"id": rid, "outcome": outcome, "by": player.name, "byXuid": str(player.xuid)}, done)
