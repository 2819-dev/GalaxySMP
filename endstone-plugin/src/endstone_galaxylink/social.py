"""Social (Main Menu > Social): friends, friend requests, parties, recent players and your profile card.

Friends are the same friends as on galaxymc.us (website accounts), so a player has to link their account first
(Main Menu > Link Account). The website is asked in a background thread and the answer is kept for each player.

Parties are shared with Bedwars (the same party data): up to 4 players. When the leader joins a server from the
Main Menu, the party comes along. /p <message> is party chat. Party invites last 5 minutes.

Recent players: every 30 seconds, players within 24 blocks of each other (or in the same Bedwars game) are remembered
(the last 20 for each player), so they can be added as friends later.

Profile card: rank, playtime, money, achievements, plots, friends; "Show my card to friends" can be switched off.
"""

import json
import threading
import time

from endstone.form import ActionForm, ModalForm, TextInput

PARTY_MAX = 4
RECENT_KEEP = 20
RECENT_RANGE = 24


def fmt_time(seconds):
    h = int(seconds // 3600)
    return f"{h}h {int(seconds % 3600 // 60)}m" if h else f"{int(seconds // 60)}m"


class Social:
    def __init__(self, plugin):
        self.plugin = plugin
        self.state = {}       # player uuid -> website state {linked, friends, incoming, outgoing} (or {} while loading)
        self.links = {}       # player uuid -> {"code", "qr", "url"} for Link Account
        self.db = plugin.economy.db
        self.db.execute("CREATE TABLE IF NOT EXISTS recent_players (xuid TEXT, other TEXT, other_name TEXT, at REAL, PRIMARY KEY (xuid, other))")
        self.db.execute("CREATE TABLE IF NOT EXISTS card_privacy (xuid TEXT PRIMARY KEY, hidden INTEGER)")
        self.db.commit()

    # ---------- the website ----------
    def _bg(self, fn, done):
        def run():
            try:
                res = fn()
            except Exception as e:
                res = {"ok": False, "error": str(e)}
            self.plugin.server.scheduler.run_task(self.plugin, lambda: done(res))
        threading.Thread(target=run, daemon=True).start()

    def refresh(self, players, then=None):
        """Asks the website for these players' friends and requests."""
        uuids = [str(p.unique_id) for p in players]
        if not uuids:
            return

        def done(res):
            for uid, st in ((res or {}).get("players") or {}).items():
                self.state[uid] = st
            if then:
                then()
        self._bg(lambda: self.plugin._request("/api/plugin/social", {"uuids": uuids}), done)

    def link_info(self, player, then=None):
        """Asks the website for a link code (or learns the player is already linked)."""
        uid = str(player.unique_id)

        def done(res):
            if res and res.get("linked"):
                self.state.setdefault(uid, {})["linked"] = True
                self.links.pop(uid, None)
            elif res and res.get("code"):
                self.links[uid] = {"code": res["code"], "qr": res.get("qr"), "url": res.get("url")}
            if then:
                then()
        body = {"uuid": uid, "xuid": str(player.xuid), "name": player.name, "bedrock": True}
        self._bg(lambda: self.plugin._request("/api/plugin/link-code", body), done)

    def on_join(self, player):
        self.refresh([player])
        self.link_info(player)

    def on_quit(self, player):
        uid = str(player.unique_id)
        self.state.pop(uid, None)
        self.links.pop(uid, None)
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None and self.party_of(uid):
            try:
                self.leave_party(player, quiet=True, moving=False)
            except Exception:
                pass

    def linked(self, player):
        return bool((self.state.get(str(player.unique_id)) or {}).get("linked"))

    def friends(self, player):
        return (self.state.get(str(player.unique_id)) or {}).get("friends") or []

    def online_friends(self, player):
        online = {str(p.xuid): p for p in self.plugin.server.online_players}
        return [(f, online[f["xuid"]]) for f in self.friends(player) if f.get("xuid") in online]

    def act(self, player, action, then=None, **target):
        body = {"uuid": str(player.unique_id), "action": action, **target}

        def done(res):
            if not res or res.get("ok") is False:
                player.send_message(f"§c{(res or {}).get('error') or 'That didn’t work. Please try again.'}")
            self.refresh([player] + [p for f, p in self.online_friends(player)], then)
        self._bg(lambda: self.plugin._request("/api/plugin/social/act", body), done)

    # ---------- where someone is ----------
    def where(self, p):
        try:
            bw = getattr(self.plugin, "bedwars", None)
            if bw is not None and bw.playing(p):
                return "Playing Bedwars"
            bc = getattr(self.plugin, "buildcontest", None)
            if bc is not None and bc.building(p):
                return "In the Build Contest"
            wl = getattr(self.plugin, "welcome", None)
            if wl is not None and wl.waiting(p):
                return "On the Main Menu"
            dim = p.dimension.name.lower()
            if "nether" in dim:
                return "In the Nether"
            if "end" in dim:
                return "In the End"
            plots = getattr(self.plugin, "plots", None)
            plot = plots.at_player(p) if plots is not None else None
            if plot is not None:
                return f"At {plots.label(plot)}"
            return "Exploring the Overworld"
        except Exception:
            return "Online"

    # ---------- parties (shared with Bedwars) ----------
    def bw(self):
        return getattr(self.plugin, "bedwars", None)

    def party_of(self, uid):
        bw = self.bw()
        return bw.party_of(uid) if bw is not None else []

    def online(self, uid):
        return next((p for p in self.plugin.server.online_players if str(p.unique_id) == uid), None)

    def invite(self, player, target):
        uid, tid = str(player.unique_id), str(target.unique_id)
        bw = self.bw()
        party = self.party_of(uid)
        if party and party[0] != uid:
            return player.send_message("§cOnly the party leader can invite players.")
        if len(party) >= PARTY_MAX:
            return player.send_message(f"§cYour party is full ({PARTY_MAX} players).")
        if tid in party:
            return player.send_message(f"§7{target.name} is already in your party.")
        if not party:
            bw.parties[uid] = []
        bw.invites[tid] = (uid, time.time())
        player.send_message(f"§aInvited {target.name} to your party.")
        target.send_message(f"§d✦ §f{player.name} invited you to their party. §7Open §e/menu§7 > Social > Party, or type §e/party accept§7.")
        try:
            target.play_sound(target.location, "note.pling", 0.8, 1.4)
        except Exception:
            pass

    def accept(self, player):
        bw = self.bw()
        bw.party_accept(player)

    def leave_party(self, player, quiet=False, moving=True):
        bw = self.bw()
        uid = str(player.unique_id)
        party = self.party_of(uid)
        if not party:
            return
        if uid in bw.parties:
            members = bw.parties.pop(uid)
            if members:
                bw.parties[members[0]] = members[1:]
        else:
            for leader, members in bw.parties.items():
                if uid in members:
                    members.remove(uid)
                    break
        for k in [k for k, v in bw.parties.items() if not v]:
            del bw.parties[k]
        if not quiet:
            player.send_message("§7You left the party.")
        for m in party:
            mp = self.online(m)
            if mp is not None and m != uid:
                mp.send_message(f"§7{player.name} left the party.")

    def kick(self, leader, target_uid):
        bw = self.bw()
        members = bw.parties.get(str(leader.unique_id)) or []
        if target_uid in members:
            members.remove(target_uid)
            tp = self.online(target_uid)
            if tp is not None:
                tp.send_message(f"§7{leader.name} removed you from the party.")
            leader.send_message("§7Removed from the party.")

    def party_chat(self, player, text):
        party = self.party_of(str(player.unique_id))
        if not party:
            return player.send_message("§7You're not in a party. Make one in §e/menu§7 > Social > Party.")
        mod = getattr(self.plugin, "moderation", None)
        if mod and mod.muted(player):
            return player.send_message("§cYou can't chat while you're muted.")
        filt = getattr(self.plugin, "chatfilter", None)
        if filt is not None and filt.bad_spans(text):
            return player.send_message("§cThat message isn't allowed.")
        for m in party:
            mp = self.online(m)
            if mp is not None:
                mp.send_message(f"§d[Party] §f{player.name}§7: §f{text[:300]}")

    def follow_leader(self, leader, spot=None, label=None):
        """The leader joined a server from the Main Menu: the party comes along."""
        uid = str(leader.unique_id)
        party = self.party_of(uid)
        if not party or party[0] != uid:
            return
        tp = getattr(self.plugin, "teleports", None)
        wl = getattr(self.plugin, "welcome", None)
        for m in party[1:]:
            mp = self.online(m)
            if mp is None or (wl is not None and wl.in_minigame(mp)):
                continue
            try:
                if wl is not None and wl.waiting(mp):
                    wl.done(mp)
                    mp.close_form()
                dest = tp.location(spot) if (spot and tp is not None) else leader.location
                mp.teleport(dest)
                mp.send_message(f"§d✦ §fYour party followed {leader.name} to {label or 'GalaxySMP'}.")
            except Exception as e:
                self.plugin.logger.warning(f"Party follow: {e}")

    # ---------- recent players ----------
    def tick(self):
        """Every 30 seconds: remember who's playing near whom."""
        players = list(self.plugin.server.online_players)
        now = time.time()
        bw = self.bw()
        rows = []
        for i, a in enumerate(players):
            try:
                la, da = a.location, a.dimension.name
            except Exception:
                continue
            for b in players[i + 1:]:
                try:
                    lb = b.location
                    near = b.dimension.name == da and (la.x - lb.x) ** 2 + (la.z - lb.z) ** 2 <= RECENT_RANGE ** 2
                    same_game = bw is not None and bw.playing(a) and bw.playing(b)
                except Exception:
                    continue
                if near or same_game:
                    rows.append((str(a.xuid), str(b.xuid), b.name, now))
                    rows.append((str(b.xuid), str(a.xuid), a.name, now))
        if not rows:
            return
        self.db.executemany("INSERT OR REPLACE INTO recent_players (xuid, other, other_name, at) VALUES (?, ?, ?, ?)", rows)
        for x in {r[0] for r in rows}:
            self.db.execute("DELETE FROM recent_players WHERE xuid = ? AND other NOT IN "
                            "(SELECT other FROM recent_players WHERE xuid = ? ORDER BY at DESC LIMIT ?)", (x, x, RECENT_KEEP))
        self.db.commit()

    def recent(self, player):
        return self.db.execute("SELECT other, other_name, at FROM recent_players WHERE xuid = ? ORDER BY at DESC LIMIT ?",
                               (str(player.xuid), RECENT_KEEP)).fetchall()

    # ---------- profile card ----------
    def card_hidden(self, xuid):
        r = self.db.execute("SELECT hidden FROM card_privacy WHERE xuid = ?", (str(xuid),)).fetchone()
        return bool(r and r[0])

    def set_card_hidden(self, player, hidden):
        self.db.execute("INSERT OR REPLACE INTO card_privacy (xuid, hidden) VALUES (?, ?)", (str(player.xuid), 1 if hidden else 0))
        self.db.commit()

    def card_text(self, xuid, name, online_player=None):
        pr = getattr(self.plugin, "progress", None)
        st = {}
        try:
            st = (pr.stats(online_player) if online_player is not None else pr.load(xuid)) or {}
        except Exception:
            pass
        lines = [f"§l§f{name}§r"]
        try:
            lines.append(f"§7Rank: §f{self.plugin.ranks.rank_names(xuid)}")
        except Exception:
            pass
        lines.append(f"§7Playtime: §f{fmt_time(st.get('playtime', 0))}")
        try:
            from endstone_galaxylink import money
            lines.append(f"§7Money: §e{money.fmt(self.plugin.economy.get(xuid))}")
        except Exception:
            pass
        lines.append(f"§7Achievements: §f{len(st.get('achievements') or {})}")
        try:
            plots = self.plugin.plots.owned(xuid)
            lines.append(f"§7Plots: §f{len(plots)}")
        except Exception:
            pass
        lines.append(f"§7Blocks mined: §f{st.get('mined', 0)}   §7Kills: §f{st.get('kills', 0)}")
        if online_player is not None:
            lines.append(f"§7Friends: §f{len(self.friends(online_player))}")
            lines.append(f"§aOnline §7· {self.where(online_player)}")
        return "\n".join(lines)

    # ---------- small forms ----------
    def ask_name(self, player, title, label, then):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            name = str(v[0] if v else "").strip()[:32]
            if name:
                then(p, name)
        player.send_form(ModalForm(title=title, controls=[TextInput(label, "e.g. Steve", "")], submit_button="OK", on_submit=submit))

    def ask_message(self, player, to_name, then=None):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            text = str(v[0] if v else "").strip()
            if text:
                dms = getattr(self.plugin, "dms", None)
                if dms is not None:
                    dms.send(p, to_name, text)
            if then:
                then(p)
        player.send_form(ModalForm(title=f"Message {to_name}", controls=[TextInput("Message (they see it in game and on galaxymc.us)", "Hi!", "")],
                                   submit_button="Send", on_submit=submit))
